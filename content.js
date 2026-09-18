(() => {
	if (window.__NAS_LOADED__) return;
	window.__NAS_LOADED__ = true;

	function iconImg(size) {
		const url = chrome.runtime.getURL("icons/icon.svg");
		return `<img class="nas-icon" src="${url}" width="${size}" height="${size}" alt="" draggable="false">`;
	}

	const MENU_HINTS = [
		"Turn into",
		"Duplicate",
		"Delete",
		"Color",
		"Copy link",
		"Move to",
		"Comment",
		"Open",
		"Open in",
		"Rename",
		"Add to",
		"Favorite",
		"Search actions",
		"Превратить",
		"Дублировать",
		"Удалить",
		"Цвет",
		"Копировать",
		"Переместить",
		"Комментар",
		"Открыть",
		"Переименовать",
		"Поиск действий",
	];

	let lastBlockId = null;
	let lastHoveredBlockId = null;
	let cardsCache = {};
	let watchUntil = 0;
	let rafId = 0;
	let pickerEl = null;
	let pickerOpen = false;
	let pickerSource = null;
	let titleBtn = null;
	let badgeMap = new Map();
	let badgeRaf = 0;

	console.log("[NAS] content script loaded", location.href);

	const root = document.createElement("div");
	root.id = "nas-root";
	root.setAttribute("data-nas-root", "1");
	(document.documentElement || document.body).appendChild(root);

	showBeacon();

	function isUuidLike(value) {
		return !!value && /^[0-9a-f]{32}$/i.test(String(value).replace(/-/g, ""));
	}

	function normalizeBlockId(id) {
		if (!id) return id;
		const hex = String(id).replace(/-/g, "").toLowerCase();
		if (hex.length !== 32) return id;
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	}

	function extractBlockId(el) {
		if (!el || el.nodeType !== 1 || el.closest?.("#nas-root")) return null;
		for (const attr of ["data-block-id", "data-id", "data-blockid"]) {
			const value = el.getAttribute?.(attr);
			if (isUuidLike(value)) return value;
		}
		const cls = typeof el.className === "string" ? el.className : el.className?.baseVal || "";
		const m = cls.match(/notion-block-([0-9a-f]{32})/i);
		return m ? m[1] : null;
	}

	function findBlockIdFromNode(node) {
		let el = node;
		while (el && el !== document.documentElement) {
			if (el.id === "nas-root") return null;
			const id = extractBlockId(el);
			if (id) return id;
			el = el.parentElement;
		}
		return null;
	}

	function findBlockIdFromPoint(x, y) {
		const stack = document.elementsFromPoint(x, y) || [];
		for (const el of stack) {
			const id = findBlockIdFromNode(el);
			if (id) return id;
		}
		for (const dx of [16, 32, 48, 72, 96, 128, 168]) {
			const extra = document.elementsFromPoint(x + dx, y) || [];
			for (const el of extra) {
				const id = findBlockIdFromNode(el);
				if (id) return id;
			}
		}
		return null;
	}

	function currentBlockId() {
		return lastBlockId || lastHoveredBlockId;
	}

	function findPageTitleBlock() {
		const leaf = document.querySelector('[aria-roledescription="page title"]');
		return leaf?.closest("[data-block-id]") || null;
	}

	function pageTitleId() {
		const block = findPageTitleBlock();
		const raw = block?.getAttribute("data-block-id");
		return raw && isUuidLike(raw) ? normalizeBlockId(raw) : null;
	}

	function findBlockEl(id) {
		const dashed = normalizeBlockId(id);
		const hex = dashed.replace(/-/g, "");
		const nodes = [...document.querySelectorAll(`[data-block-id="${dashed}"], [data-block-id="${hex}"], [data-id="${dashed}"], [data-id="${hex}"]`)].filter(
			(el) => !el.closest("#nas-root"),
		);
		if (!nodes.length) return null;
		let best = null;
		let bestArea = 0;
		for (const el of nodes) {
			const r = el.getBoundingClientRect();
			if (r.width < 80 || r.height < 16) continue;
			const area = r.width * r.height;
			if (area > bestArea) {
				best = el;
				bestArea = area;
			}
		}
		return best;
	}

	function showBeacon() {
		const el = document.createElement("div");
		el.className = "nas-beacon";
		el.textContent = "NAS loaded";
		root.appendChild(el);
		setTimeout(() => el.remove(), 2500);
	}

	function showToast(message, kind = "ok") {
		root.querySelectorAll(".nas-toast").forEach((n) => n.remove());
		const el = document.createElement("div");
		el.className = `nas-toast nas-toast-${kind}`;
		el.textContent = message;
		root.appendChild(el);
		setTimeout(() => el.remove(), 3200);
	}

	function isRuUi(node) {
		const text = `${node?.textContent || ""} ${document.documentElement.lang || ""}`;
		return /Удалить|Дублировать|Превратить|Открыть|Копировать/.test(text);
	}

	function isBlockMenu(node) {
		if (!node || node.id === "nas-root") return false;
		const options = node.querySelectorAll('[role="option"], [role="menuitem"]');
		if (options.length < 2) return false;
		const text = node.textContent || "";
		if (/Search actions|Search for an action|Поиск действий/i.test(text)) return true;
		const hits = MENU_HINTS.filter((m) => text.includes(m)).length;
		return hits >= 2;
	}

	function findBlockMenu() {
		const nodes = document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"]');
		for (const node of nodes) {
			const rootMenu = node.closest('[role="dialog"]') || node;
			if (isBlockMenu(rootMenu)) return rootMenu;
		}
		return null;
	}

	function blockIdNearMenu(dialog) {
		const rect = dialog.getBoundingClientRect();
		const y = rect.top + Math.min(24, Math.max(8, rect.height / 2));
		return findBlockIdFromPoint(rect.left - 12, y) || findBlockIdFromPoint(rect.left - 40, y) || findBlockIdFromPoint(rect.left + 8, y);
	}

	function closeNotionMenu() {
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, which: 27, bubbles: true }));
	}

	function escapeHtml(s) {
		return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}

	function escapeAttr(s) {
		return escapeHtml(s).replace(/"/g, "&quot;");
	}

	function hidePicker() {
		pickerOpen = false;
		pickerSource = null;
		if (pickerEl) pickerEl.style.display = "none";
	}

	function ensurePicker() {
		if (pickerEl) return pickerEl;
		pickerEl = document.createElement("div");
		pickerEl.className = "nas-picker";
		pickerEl.innerHTML = `
      <div class="nas-picker-title">Anki</div>
      <label class="nas-picker-label">
        <select class="nas-picker-select"></select>
      </label>
      <input class="nas-picker-input" type="text" placeholder="Or type a new deck name" />
      <div class="nas-picker-hint"></div>
      <div class="nas-picker-actions">
        <button type="button" class="nas-picker-unsync">Unsync</button>
        <button type="button" class="nas-picker-cancel">Cancel</button>
        <button type="button" class="nas-picker-ok">Sync</button>
      </div>
    `;
		root.appendChild(pickerEl);
		pickerEl.addEventListener("pointerdown", (e) => e.stopPropagation(), true);
		pickerEl.addEventListener("mousedown", (e) => e.stopPropagation(), true);
		pickerEl.querySelector(".nas-picker-cancel").addEventListener("click", (e) => {
			e.preventDefault();
			hidePicker();
		});
		pickerEl.querySelector(".nas-picker-unsync").addEventListener("click", (e) => {
			e.preventDefault();
			const id = pickerEl.dataset.blockId;
			hidePicker();
			closeNotionMenu();
			if (id) sendSync("UNSYNC", id);
		});
		pickerEl.querySelector(".nas-picker-ok").addEventListener("click", (e) => {
			e.preventDefault();
			const select = pickerEl.querySelector(".nas-picker-select");
			const input = pickerEl.querySelector(".nas-picker-input");
			const deck = (input.value || select.value || "Default").trim();
			const id = pickerEl.dataset.blockId;
			hidePicker();
			closeNotionMenu();
			if (!id) return;
			sendSync("SYNC", id, { deckName: deck || "Default" });
		});
		return pickerEl;
	}

	function positionPanel(el, rect) {
		el.style.display = "block";
		el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 280))}px`;
		el.style.width = `${Math.max(260, Math.min(rect.width || 280, 360))}px`;
		const height = el.offsetHeight || 180;
		let top = rect.bottom + 8;
		if (top + height > window.innerHeight - 8) {
			top = Math.max(8, rect.top - height - 8);
		}
		el.style.top = `${top}px`;
	}

	function showPicker(blockId, anchor, source) {
		const el = ensurePicker();
		const id = normalizeBlockId(blockId);
		const synced = Boolean(cardsCache[id]);
		const ru = isRuUi(anchor);
		const rect = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
		pickerOpen = true;
		pickerSource = source || "menu";
		el.dataset.blockId = id;
		el.querySelector(".nas-picker-title").textContent = synced
			? ru
				? "Anki · уже синхронизирован"
				: "Anki · already synced"
			: ru
				? "Синхронизировать с Anki"
				: "Sync with Anki";
		el.querySelector(".nas-picker-ok").textContent = synced ? (ru ? "Обновить" : "Update") : "Sync";
		el.querySelector(".nas-picker-cancel").textContent = ru ? "Отмена" : "Cancel";
		el.querySelector(".nas-picker-unsync").textContent = ru ? "Отвязать" : "Unsync";
		el.querySelector(".nas-picker-unsync").style.display = synced ? "inline-flex" : "none";
		el.querySelector(".nas-picker-input").placeholder = ru ? "Или введите новую колоду" : "Or type a new deck name";
		el.querySelector(".nas-picker-hint").textContent = ru ? "Загрузка колод…" : "Loading decks…";
		el.querySelector(".nas-picker-input").value = "";
		positionPanel(el, rect);

		chrome.runtime.sendMessage({ type: "GET_DECKS" }, (res) => {
			if (!pickerOpen || el.dataset.blockId !== id) return;
			const live = Array.isArray(res?.decks) ? res.decks.filter(Boolean) : [];
			const preferred = cardsCache[id]?.deckName || res?.defaultDeck || "";
			const names = res?.anki ? live : Array.from(new Set(live.concat(preferred).filter(Boolean)));
			const select = el.querySelector(".nas-picker-select");
			if (!names.length) {
				select.innerHTML = `<option value="Default">Default</option>`;
				select.value = "Default";
			} else {
				select.innerHTML = names.map((d) => `<option value="${escapeAttr(d)}">${escapeHtml(d)}</option>`).join("");
				select.value = names.includes(preferred) ? preferred : names[0];
			}
			el.querySelector(".nas-picker-hint").textContent = res?.anki
				? ru
					? "Выберите колоду для этой карточки"
					: "Choose a deck for this card"
				: ru
					? "Anki закрыт. Список колод может быть неполным."
					: "Anki is closed. Deck list may be incomplete.";
			positionPanel(el, rect);
		});
	}

	function sendSync(type, blockId, extra = {}) {
		chrome.runtime.sendMessage({ type, blockId, ...extra }, (res) => {
			if (chrome.runtime.lastError) {
				showToast(chrome.runtime.lastError.message, "err");
				return;
			}
			if (!res?.ok && res?.error) {
				showToast(res.error, "err");
				return;
			}
			if (type === "UNSYNC") {
				showToast(res.action === "queued_delete" ? "Anki закрыт. Удаление в очереди." : "Карточка удалена из Anki");
			} else if (res.action === "queued") {
				showToast(`Anki закрыт. В очереди → ${res.deckName || extra.deckName || "Default"}`, "warn");
			} else if (res.action === "unchanged") {
				showToast("Уже актуально");
			} else if (res.action === "deleted") {
				showToast("Блок удалён в Notion, карточка удалена из Anki", "warn");
			} else {
				const deck = res.deckName ? ` → ${res.deckName}` : "";
				showToast(res.action === "updated" ? `Карточка обновлена${deck}` : `Карточка создана${deck}`);
			}
			refreshState();
		});
	}

	function ensureTitleBtn() {
		if (titleBtn) return titleBtn;
		titleBtn = document.createElement("button");
		titleBtn.type = "button";
		titleBtn.className = "nas-title-btn";
		titleBtn.innerHTML = `${iconImg(20)}<span class="nas-title-btn-label"></span>`;
		root.appendChild(titleBtn);
		const stop = (e) => {
			e.preventDefault();
			e.stopPropagation();
		};
		titleBtn.addEventListener("pointerdown", stop, true);
		titleBtn.addEventListener("mousedown", stop, true);
		titleBtn.addEventListener(
			"click",
			(e) => {
				stop(e);
				const id = titleBtn.dataset.blockId || pageTitleId();
				if (!id) {
					showToast("Не удалось определить страницу Notion.", "err");
					return;
				}
				lastBlockId = id;
				showPicker(id, titleBtn, "title");
			},
			true,
		);
		return titleBtn;
	}

	function updateTitleButton() {
		const block = findPageTitleBlock();
		const leaf = document.querySelector('[aria-roledescription="page title"]');
		if (!block || !leaf) {
			if (titleBtn) titleBtn.style.display = "none";
			return;
		}
		const id = normalizeBlockId(block.getAttribute("data-block-id"));
		const synced = Boolean(cardsCache[id]);
		const ru = isRuUi();
		const btn = ensureTitleBtn();
		btn.dataset.blockId = id;
		btn.style.display = "flex";
		btn.classList.toggle("nas-title-btn-synced", synced);
		const label = btn.querySelector(".nas-title-btn-label");
		if (synced) {
			const deck = cardsCache[id]?.deckName;
			label.textContent = ru ? "В Anki" : "Synced";
			btn.title = deck ? (ru ? `Страница в Anki → ${deck}` : `Page synced → ${deck}`) : ru ? "Страница синхронизирована с Anki" : "Page synced with Anki";
		} else {
			label.textContent = ru ? "В Anki" : "Sync page";
			btn.title = ru ? "Синхронизировать страницу с Anki" : "Sync this page with Anki";
		}
		const trect = leaf.getBoundingClientRect();
		const height = 32;
		let left = trect.right + 10;
		const width = btn.offsetWidth || 120;
		if (left + width > window.innerWidth - 12) left = Math.max(8, window.innerWidth - width - 12);
		const top = Math.max(8, trect.top + (trect.height - height) / 2);
		btn.style.left = `${left}px`;
		btn.style.top = `${top}px`;
	}

	function ensureBadge(id) {
		let badge = badgeMap.get(id);
		if (badge) return badge;
		badge = document.createElement("div");
		badge.className = "nas-badge";
		badge.innerHTML = iconImg(20);
		root.appendChild(badge);
		badgeMap.set(id, badge);
		return badge;
	}

	function updateBadges() {
		badgeRaf = 0;
		updateTitleButton();
		const ids = Object.keys(cardsCache || {});
		const used = new Set();
		const titleId = pageTitleId();
		for (const id of ids) {
			if (titleId && id === titleId) continue;
			const el = findBlockEl(id);
			if (!el) continue;
			const rect = el.getBoundingClientRect();
			if (rect.width < 80 || rect.height < 16) continue;
			if (rect.bottom < 0 || rect.top > window.innerHeight + 40) continue;
			const badge = ensureBadge(id);
			const status = cardsCache[id]?.status;
			const deck = cardsCache[id]?.deckName || "";
			badge.classList.toggle("nas-badge-pending", status === "pending");
			badge.classList.toggle("nas-badge-error", status === "error");
			badge.title =
				status === "pending"
					? `Queued for Anki${deck ? ` (${deck})` : ""}`
					: status === "error"
						? cardsCache[id]?.error || "Sync error"
						: `Synced with Anki${deck ? ` → ${deck}` : ""}`;
			const size = 20;
			const left = Math.min(rect.right - size - 8, window.innerWidth - size - 8);
			if (left < rect.left + 52) continue;
			badge.style.display = "flex";
			badge.style.left = `${Math.max(rect.left + 52, left)}px`;
			badge.style.top = `${Math.max(8, rect.top + 4)}px`;
			used.add(id);
		}
		for (const [id, badge] of badgeMap) {
			if (!used.has(id)) {
				badge.remove();
				badgeMap.delete(id);
			}
		}
	}

	function requestBadges() {
		if (!badgeRaf) badgeRaf = requestAnimationFrame(updateBadges);
	}

	function tick() {
		rafId = 0;
		const dialog = findBlockMenu();
		if (dialog) {
			const rawId = currentBlockId() || blockIdNearMenu(dialog);
			if (rawId) {
				lastBlockId = rawId;
				const id = normalizeBlockId(rawId);
				if (!pickerOpen || pickerEl?.dataset.blockId !== id || pickerSource !== "menu") {
					showPicker(id, dialog, "menu");
				} else {
					positionPanel(pickerEl, dialog.getBoundingClientRect());
				}
			}
			watchUntil = Date.now() + 2000;
		} else if (pickerOpen && pickerSource === "menu") {
			hidePicker();
		}
		if (Date.now() < watchUntil) rafId = requestAnimationFrame(tick);
	}

	function startWatch() {
		watchUntil = Date.now() + 5000;
		if (!rafId) rafId = requestAnimationFrame(tick);
	}

	function refreshState() {
		chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
			if (!res?.ok) return;
			cardsCache = res.cards || {};
			requestBadges();
		});
	}

	document.addEventListener(
		"pointerdown",
		(e) => {
			if (e.target?.closest?.("#nas-root")) return;
			if (pickerOpen && pickerSource === "title") hidePicker();
			const id = findBlockIdFromNode(e.target) || findBlockIdFromPoint(e.clientX, e.clientY);
			if (id) {
				lastBlockId = id;
				lastHoveredBlockId = id;
			}
			startWatch();
		},
		true,
	);

	document.addEventListener(
		"keydown",
		(e) => {
			if (e.key === "Escape") hidePicker();
		},
		true,
	);

	document.addEventListener("scroll", requestBadges, true);
	window.addEventListener("resize", requestBadges);

	chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
		if (msg?.type === "PING") {
			sendResponse({ ok: true, href: location.href, blockId: currentBlockId() || pageTitleId() });
		}
	});

	refreshState();
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === "local" && changes.cards) {
			cardsCache = changes.cards.newValue || {};
			requestBadges();
		}
	});
	setInterval(requestBadges, 1000);
})();
