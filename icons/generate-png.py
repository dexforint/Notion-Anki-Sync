#!/usr/bin/env python3
"""Rasterize the provided SVG icon (hardcoded shapes) into PNGs.
Run: python3 icons/generate-png.py
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

# --- PNG writer --------------------------------------------------------------


def chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def encode_png(
    width: int, height: int, pixels: list[tuple[int, int, int, int]]
) -> bytes:
    # RGBA, 8-bit, no interlace, filter=0 each row
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        row = pixels[y * width : (y + 1) * width]
        for r, g, b, a in row:
            raw.extend((r, g, b, a))
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)),
            chunk(b"IDAT", zlib.compress(bytes(raw), 9)),
            chunk(b"IEND", b""),
        ]
    )


# --- Simple rasterizer (premultiplied alpha) --------------------------------


def premul(r: int, g: int, b: int, a: int) -> tuple[int, int, int, int]:
    if a <= 0:
        return (0, 0, 0, 0)
    return (r * a // 255, g * a // 255, b * a // 255, a)


def over(
    dst: tuple[int, int, int, int], src: tuple[int, int, int, int]
) -> tuple[int, int, int, int]:
    # Porter-Duff "source over" in premultiplied space
    dr, dg, db, da = dst
    sr, sg, sb, sa = src
    inv = 255 - sa
    return (
        sr + dr * inv // 255,
        sg + dg * inv // 255,
        sb + db * inv // 255,
        sa + da * inv // 255,
    )


def clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def inside_round_rect(
    px: float, py: float, x0: float, y0: float, w: float, h: float, r: float
) -> bool:
    x1, y1 = x0 + w, y0 + h
    if px < x0 or px > x1 or py < y0 or py > y1:
        return False
    r = max(0.0, r)
    if r == 0.0:
        return True

    ix0, ix1 = x0 + r, x1 - r
    iy0, iy1 = y0 + r, y1 - r

    cx = clamp(px, ix0, ix1)
    cy = clamp(py, iy0, iy1)
    dx = px - cx
    dy = py - cy
    return dx * dx + dy * dy <= r * r


def draw_round_rect_over(
    buf: list[tuple[int, int, int, int]],
    W: int,
    H: int,
    x0: float,
    y0: float,
    w: float,
    h: float,
    r: float,
    rgba: tuple[int, int, int, int],
):
    # iterate bounding box only
    x_min = max(0, int(x0) - 1)
    y_min = max(0, int(y0) - 1)
    x_max = min(W, int(x0 + w) + 2)
    y_max = min(H, int(y0 + h) + 2)

    src = premul(*rgba)
    for y in range(y_min, y_max):
        py = y + 0.5
        row = y * W
        for x in range(x_min, x_max):
            px = x + 0.5
            if inside_round_rect(px, py, x0, y0, w, h, r):
                i = row + x
                buf[i] = over(buf[i], src)


def point_in_triangle(
    px: float,
    py: float,
    ax: float,
    ay: float,
    bx: float,
    by: float,
    cx: float,
    cy: float,
) -> bool:
    def edge(x0, y0, x1, y1, x, y):
        return (x - x0) * (y1 - y0) - (y - y0) * (x1 - x0)

    e1 = edge(ax, ay, bx, by, px, py)
    e2 = edge(bx, by, cx, cy, px, py)
    e3 = edge(cx, cy, ax, ay, px, py)
    has_neg = (e1 < 0) or (e2 < 0) or (e3 < 0)
    has_pos = (e1 > 0) or (e2 > 0) or (e3 > 0)
    return not (has_neg and has_pos)


def draw_triangle_over(
    buf: list[tuple[int, int, int, int]],
    W: int,
    H: int,
    ax: float,
    ay: float,
    bx: float,
    by: float,
    cx: float,
    cy: float,
    rgba: tuple[int, int, int, int],
):
    x_min = max(0, int(min(ax, bx, cx)) - 1)
    y_min = max(0, int(min(ay, by, cy)) - 1)
    x_max = min(W, int(max(ax, bx, cx)) + 2)
    y_max = min(H, int(max(ay, by, cy)) + 2)

    src = premul(*rgba)
    for y in range(y_min, y_max):
        py = y + 0.5
        row = y * W
        for x in range(x_min, x_max):
            px = x + 0.5
            if point_in_triangle(px, py, ax, ay, bx, by, cx, cy):
                i = row + x
                buf[i] = over(buf[i], src)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def render_icon_supersampled(size: int, ss: int = 4) -> list[tuple[int, int, int, int]]:
    # render into larger buffer (size*ss), then downsample
    W = H = size * ss
    s = W / 128.0

    # premultiplied buffer
    buf: list[tuple[int, int, int, int]] = [(0, 0, 0, 0)] * (W * H)

    # --- Background: rounded rect with diagonal gradient (x1=y1=0 -> x2=y2=1)
    # Gradient colors from SVG:
    c0 = (0x63, 0x66, 0xF1)  # #6366f1
    c1 = (0x8B, 0x5C, 0xF6)  # #8b5cf6
    rx = 28.0 * s

    for y in range(H):
        py = y + 0.5
        row = y * W
        for x in range(W):
            px = x + 0.5
            if not inside_round_rect(px, py, 0.0, 0.0, float(W), float(H), rx):
                continue
            # t along vector (1,1) across the box: approx (x+y)/(2*(W-1))
            t = (px + py) / (2.0 * (W - 1))
            t = 0.0 if t < 0.0 else 1.0 if t > 1.0 else t
            r = int(lerp(c0[0], c1[0], t) + 0.5)
            g = int(lerp(c0[1], c1[1], t) + 0.5)
            b = int(lerp(c0[2], c1[2], t) + 0.5)
            buf[row + x] = premul(r, g, b, 255)

    # --- Cards (exactly as in SVG order)
    # back 1: fill #c4b5fd opacity 0.5 at (42,34) 52x64 rx=10
    draw_round_rect_over(
        buf,
        W,
        H,
        42.0 * s,
        34.0 * s,
        52.0 * s,
        64.0 * s,
        10.0 * s,
        (0xC4, 0xB5, 0xFD, int(255 * 0.5)),
    )
    # back 2: fill #ddd6fe opacity 0.7 at (36,28)
    draw_round_rect_over(
        buf,
        W,
        H,
        36.0 * s,
        28.0 * s,
        52.0 * s,
        64.0 * s,
        10.0 * s,
        (0xDD, 0xD6, 0xFE, int(255 * 0.7)),
    )
    # front: white at (30,22)
    draw_round_rect_over(
        buf,
        W,
        H,
        30.0 * s,
        22.0 * s,
        52.0 * s,
        64.0 * s,
        10.0 * s,
        (255, 255, 255, 255),
    )

    # --- Triangle: M40 38 L40 52 L50 45 Z fill #6366f1
    draw_triangle_over(
        buf,
        W,
        H,
        40.0 * s,
        38.0 * s,
        40.0 * s,
        52.0 * s,
        50.0 * s,
        45.0 * s,
        (0x63, 0x66, 0xF1, 255),
    )

    # --- Text bars
    # rect x=40 y=60 width=32 height=5 rx=2.5 fill #c4b5fd
    draw_round_rect_over(
        buf,
        W,
        H,
        40.0 * s,
        60.0 * s,
        32.0 * s,
        5.0 * s,
        2.5 * s,
        (0xC4, 0xB5, 0xFD, 255),
    )
    # rect x=40 y=70 width=24 height=5 rx=2.5 fill #ddd6fe
    draw_round_rect_over(
        buf,
        W,
        H,
        40.0 * s,
        70.0 * s,
        24.0 * s,
        5.0 * s,
        2.5 * s,
        (0xDD, 0xD6, 0xFE, 255),
    )

    # --- Downsample ss*ss -> 1 pixel (average in premultiplied space)
    out: list[tuple[int, int, int, int]] = []
    area = ss * ss
    for y in range(size):
        for x in range(size):
            sr = sg = sb = sa = 0
            base_y = y * ss
            base_x = x * ss
            for yy in range(base_y, base_y + ss):
                row = yy * W
                for xx in range(base_x, base_x + ss):
                    r, g, b, a = buf[row + xx]
                    sr += r
                    sg += g
                    sb += b
                    sa += a
            sr //= area
            sg //= area
            sb //= area
            sa //= area

            if sa == 0:
                out.append((0, 0, 0, 0))
            else:
                # un-premultiply back to straight alpha
                r = min(255, sr * 255 // sa)
                g = min(255, sg * 255 // sa)
                b = min(255, sb * 255 // sa)
                out.append((r, g, b, sa))
    return out


def make_icon_png(size: int) -> bytes:
    pixels = render_icon_supersampled(size, ss=4 if size < 128 else 2)
    return encode_png(size, size, pixels)


def main() -> None:
    out = Path(__file__).resolve().parent
    for size in (16, 32, 48, 128):
        path = out / f"icon{size}.png"
        path.write_bytes(make_icon_png(size))
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
