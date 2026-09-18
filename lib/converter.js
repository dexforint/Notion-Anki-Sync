var NASConverter = (() => {
	const HEADING_TYPES = ["heading_1", "heading_2", "heading_3", "heading_4"];
	const SUPPORTED_TYPES = new Set(["toggle", "child_page", ...HEADING_TYPES]);

	function escapeHtml(s) {
		return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	function richTextToHtml(arr) {
		if (!arr || !arr.length) return "";
		return arr
			.map((t) => {
				if (t.type === "equation") {
					return `\\(${escapeHtml(t.equation?.expression || t.plain_text || "")}\\)`;
				}
				let s = escapeHtml(t.plain_text || "");
				const a = t.annotations || {};
				if (a.code) s = `<code>${s}</code>`;
				if (a.bold) s = `<strong>${s}</strong>`;
				if (a.italic) s = `<em>${s}</em>`;
				if (a.strikethrough) s = `<s>${s}</s>`;
				if (a.underline) s = `<u>${s}</u>`;
				if (a.color && a.color !== "default") {
					const cls = a.color.includes("_background") ? `nas-bg-${a.color.replace("_background", "")}` : `nas-color-${a.color}`;
					s = `<span class="${cls}">${s}</span>`;
				}
				if (t.href) s = `<a href="${escapeHtml(t.href)}">${s}</a>`;
				return s;
			})
			.join("");
	}

	function rt(block) {
		const data = block[block.type] || {};
		return richTextToHtml(data.rich_text || []);
	}

	function extFromUrl(url, fallback = "bin") {
		try {
			const clean = url.split("?")[0];
			const m = clean.match(/\.([a-zA-Z0-9]{2,5})$/);
			return m ? m[1].toLowerCase() : fallback;
		} catch {
			return fallback;
		}
	}

	function fileUrl(fileObj) {
		if (!fileObj) return null;
		if (fileObj.type === "external") return fileObj.external?.url;
		if (fileObj.type === "file") return fileObj.file?.url;
		return fileObj.url || null;
	}

	function cacheKeyForUrl(url) {
		try {
			const u = new URL(url);
			return `${u.origin}${u.pathname}`;
		} catch {
			return String(url).split("?")[0];
		}
	}

	async function hashText(text) {
		const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
		return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
	}

	function blockTitleHtml(block) {
		if (block.type === "toggle") {
			return richTextToHtml(block.toggle?.rich_text || []) || "Untitled";
		}
		if (HEADING_TYPES.includes(block.type)) {
			return richTextToHtml(block[block.type]?.rich_text || []) || "Untitled";
		}
		if (block.type === "child_page") {
			return escapeHtml(block.child_page?.title || "Untitled");
		}
		return "Untitled";
	}

	function blockTitlePlain(block) {
		if (block.type === "child_page") return (block.child_page?.title || "").trim();
		const data = block[block.type] || {};
		return (data.rich_text || [])
			.map((t) => t.plain_text || "")
			.join("")
			.trim();
	}

	function renderChildren(blocks, ctx) {
		if (!blocks || !blocks.length) return "";
		let html = "";
		let i = 0;
		while (i < blocks.length) {
			const type = blocks[i].type;
			if (type === "bulleted_list_item" || type === "numbered_list_item" || type === "to_do") {
				const tag = type === "numbered_list_item" ? "ol" : "ul";
				const cls = type === "to_do" ? ' class="nas-todo"' : "";
				html += `<${tag}${cls}>`;
				while (i < blocks.length && blocks[i].type === type) {
					html += renderBlock(blocks[i], ctx);
					i += 1;
				}
				html += `</${tag}>`;
			} else {
				html += renderBlock(blocks[i], ctx);
				i += 1;
			}
		}
		return html;
	}

	function renderBlock(block, ctx) {
		const children = block._children || [];
		const type = block.type;
		const data = block[type] || {};

		switch (type) {
			case "paragraph":
				return `<p>${rt(block) || "&nbsp;"}</p>${renderChildren(children, ctx)}`;
			case "heading_1":
			case "heading_2":
			case "heading_3":
			case "heading_4": {
				const level = type.slice(-1);
				const title = rt(block);
				if (data.is_toggleable) {
					return `<details class="nas-toggle nas-toggle-h${level}"><summary><span class="nas-h">${title}</span></summary>${renderChildren(children, ctx)}</details>`;
				}
				return `<h${level}>${title}</h${level}>${renderChildren(children, ctx)}`;
			}
			case "bulleted_list_item":
			case "numbered_list_item":
				return `<li>${rt(block)}${renderChildren(children, ctx)}</li>`;
			case "to_do": {
				const checked = data.checked;
				const mark = checked ? "☑" : "☐";
				const cls = checked ? " nas-todo-checked" : "";
				return `<li class="${cls.trim()}">${mark} ${rt(block)}${renderChildren(children, ctx)}</li>`;
			}
			case "toggle":
				return `<details class="nas-toggle"><summary>${rt(block) || "Toggle"}</summary>${renderChildren(children, ctx)}</details>`;
			case "quote":
				return `<blockquote>${rt(block)}${renderChildren(children, ctx)}</blockquote>`;
			case "callout": {
				const icon = data.icon?.emoji || "💡";
				const color = data.color?.replace("_background", "") || "gray";
				return `<div class="callout callout-${escapeHtml(color)}"><div class="callout-icon">${icon}</div><div>${rt(block)}${renderChildren(children, ctx)}</div></div>`;
			}
			case "code": {
				const lang = data.language || "plain text";
				const raw = (data.rich_text || []).map((t) => t.plain_text).join("");
				const caption = richTextToHtml(data.caption || []);
				const highlighted = NASHighlight.highlight(raw, lang);
				const label = escapeHtml(lang);
				return `<div class="nas-code"><div class="nas-code-lang">${label}</div><pre>${highlighted}</pre></div>${
					caption ? `<div class="nas-caption">${caption}</div>` : ""
				}`;
			}
			case "equation":
				return `<p>\\[${escapeHtml(data.expression || "")}\\]</p>`;
			case "divider":
				return "<hr>";
			case "table":
				return renderTable(block);
			case "image":
				return renderImage(block, ctx);
			case "bookmark":
			case "link_preview":
			case "embed": {
				const url = data.url || "";
				const caption = richTextToHtml(data.caption || []);
				return `<p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>${caption ? `<div class="nas-caption">${caption}</div>` : ""}`;
			}
			case "file":
			case "pdf":
			case "video":
			case "audio": {
				const url = fileUrl(data) || data.url || "";
				const name = escapeHtml(data.name || type);
				return url ? `<p><a href="${escapeHtml(url)}">${name}</a></p>` : "";
			}
			case "column_list": {
				const cols = children.map((col) => `<div class="nas-column">${renderChildren(col._children || [], ctx)}</div>`).join("");
				return `<div class="nas-columns">${cols}</div>`;
			}
			case "column":
				return renderChildren(children, ctx);
			case "synced_block":
				return renderChildren(children, ctx);
			case "child_page":
				return `<p><em>Page: ${escapeHtml(data.title || "Untitled")}</em></p>`;
			case "child_database":
				return `<p><em>Database: ${escapeHtml(data.title || "Untitled")}</em></p>`;
			case "table_row":
				return "";
			default:
				return renderChildren(children, ctx);
		}
	}

	function renderTable(block) {
		const rows = block._children || [];
		const hasHeader = !!(block.table && block.table.has_column_header);
		let body = "";
		rows.forEach((row, idx) => {
			const cells = row.table_row?.cells || [];
			const tag = hasHeader && idx === 0 ? "th" : "td";
			const tds = cells.map((cell) => `<${tag}>${richTextToHtml(cell)}</${tag}>`).join("");
			body += `<tr>${tds}</tr>`;
		});
		return `<table>${body}</table>`;
	}

	function renderImage(block, ctx) {
		const data = block.image || {};
		const url = fileUrl(data);
		const caption = richTextToHtml(data.caption || []);
		if (!url) return "";
		const placeholder = `nas-media-${ctx.mediaPlan.length}.pending`;
		ctx.mediaPlan.push({ url, placeholder });
		const cap = caption ? `<div class="nas-caption">${caption}</div>` : "";
		return `<p><img src="${placeholder}" alt=""></p>${cap}`;
	}

	async function convertBlock(block, options = {}) {
		if (!SUPPORTED_TYPES.has(block.type)) {
			const err = new Error("Sync works with toggle, toggle heading, heading, or page");
			err.code = "unsupported_block";
			throw err;
		}
		const ctx = {
			blockId: String(block.id || "").replace(/-/g, ""),
			mediaPlan: [],
		};
		let front = blockTitleHtml(block);
		const pageTitle = String(options.pageTitle || "").trim();
		const ownTitle = blockTitlePlain(block);
		if (pageTitle && pageTitle !== ownTitle) {
			front = `<div class="nas-origin">${escapeHtml(pageTitle)}</div>${front}`;
		}
		let back = renderChildren(block._children || [], ctx) || "<p></p>";
		const media = [];
		for (const item of ctx.mediaPlan) {
			const cacheKey = cacheKeyForUrl(item.url);
			const hash = await hashText(cacheKey);
			const filename = `nas_${hash.slice(0, 16)}.${extFromUrl(item.url, "png")}`;
			back = back.split(item.placeholder).join(filename);
			media.push({ url: item.url, filename, cacheKey });
		}
		return { front, back, media, lastEdited: block.last_edited_time, pageTitle };
	}

	return {
		convertBlock,
		convertToggle: convertBlock,
		hashText,
		richTextToHtml,
	};
})();
