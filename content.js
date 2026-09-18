(() => {
	if (window.__NAS_LOADED__) return;
	window.__NAS_LOADED__ = true;

	const TAG_COLORS = [
		["#9b1c1c", "#fdebec"],
		["#9a6700", "#fbf3db"],
		["#0f7b6c", "#edf3ea"],
		["#2383e2", "#e7f3f8"],
		["#6940a5", "#f4f0f7"],
		["#c14c8a", "#f9f2f5"],
		["#d9730d", "#fbecdd"],
		["#444441", "#f1f1ef"],
	];

	let lastBlockId = null;
	let cardsCache = {};
	let pickerEl = null;
	let pickerOpen = false;
	let titleBtn = null;
	let handleBtn = null;
	let handleHideAt = 0;
	let handleRect = null;
	let badgeMap = new Map();
	let badgeRaf = 0;
	let selectedTags = [];
	let tagCatalog = [];
	let ankiTagCatalog = [];
	let hiddenTags = [];
	let tagMenuOpen = false;
	let tagHighlight = 0;
	let renamingFrom = "";
	let tagMenuEl = null;

	console.log("[NAS] content script loaded", location.href);

	const root = document.createElement("div");
	root.id = "nas-root";
	root.setAttribute("data-nas-root", "1");
	(document.documentElement || document.body).appendChild(root);

	const handleLayer = document.createElement("div");
	handleLayer.id = "nas-handle-layer";
	(document.documentElement || document.body).appendChild(handleLayer);

	showBeacon();

	function iconImg(size) {
		const url = chrome.runtime.getURL("icons/icon.svg");
		return `<img class="nas-icon" src="${url}" width="${size}" height="${size}" alt="" draggable="false">`;
	}

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
		if (!el || el.nodeType !== 1 || el.closest?.("#nas-root, #nas-handle-layer")) return null;
		for (const attr of ["data-block-id", "data-id", "data-blockid"]) {
			const value = el.getAttribute?.(attr);
			if (isUuidLike(value)) return value;
		}
		return null;
	}

	function findBlockIdFromNode(node) {
		let el = node;
		while (el && el !== document.documentElement) {
			if (el.id === "nas-root" || el.id === "nas-handle-layer") return null;
			const id = extractBlockId(el);
			if (id) return id;
			el = el.parentElement;
		}
		return null;
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
		const nodes = [...document.querySelectorAll(`[data-block-id="${dashed}"], [data-block-id="${hex}"]`)].filter(
			(el) => !el.closest("#nas-root, #nas-handle-layer") && !el.classList.contains("notion-selectable-drag-handle"),
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

	function isRuUi() {
		return /Удалить|Дублировать|Превратить|Открыть/.test(document.body?.innerText?.slice(0, 400) || "") || document.documentElement.lang?.startsWith("ru");
	}

	function escapeHtml(s) {
		return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}

	function escapeAttr(s) {
		return escapeHtml(s).replace(/"/g, "&quot;");
	}

	function sanitizeTag(t) {
		return String(t || "")
			.trim()
			.replace(/\s+/g, "_")
			.replace(/,/g, "");
	}

	function sanitizeList(list) {
		return [...new Set((list || []).map(sanitizeTag).filter(Boolean))];
	}

	function tagColor(tag) {
		let h = 0;
		for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
		return TAG_COLORS[h % TAG_COLORS.length];
	}

	function isVisible(el) {
		if (!el) return false;
		const r = el.getBoundingClientRect();
		if (r.width < 4 || r.height < 4) return false;
		const s = getComputedStyle(el);
		return s.opacity !== "0" && s.visibility !== "hidden" && s.display !== "none";
	}

	function notionPopupOpen() {
		for (const d of document.querySelectorAll('[role="dialog"], [role="menu"]')) {
			if (d.closest("#nas-root, #nas-handle-layer")) continue;
			const r = d.getBoundingClientRect();
			if (r.width > 80 && r.height > 60 && isVisible(d)) return true;
		}
		return false;
	}

	function findHoverCluster() {
		const handle =
			document.querySelector('[aria-label="Drag to move, click to open menu"]') || document.querySelector(".notion-selectable-drag-handle [role='button']");
		if (!handle || !isVisible(handle)) return null;
		const plus = document.querySelector(".notion-block-add-button");
		const blockEl = handle.closest(".notion-selectable-drag-handle") || handle.closest("[data-block-id]");
		const raw = extractBlockId(blockEl) || findBlockIdFromNode(handle);
		if (!raw) return null;
		return { handle, plus: plus && isVisible(plus) ? plus : null, id: normalizeBlockId(raw) };
	}

	function hidePicker() {
		pickerOpen = false;
		tagMenuOpen = false;
		renamingFrom = "";
		tagHighlight = 0;
		const input = tagInputEl();
		if (input) input.value = "";
		if (pickerEl) {
			pickerEl.style.display = "none";
			pickerEl.dataset.tagsReady = "";
		}
		if (tagMenuEl) {
			tagMenuEl.hidden = true;
			tagMenuEl.innerHTML = "";
		}
	}

	function closeTagMenu() {
		tagMenuOpen = false;
		if (renamingFrom) {
			renamingFrom = "";
			const input = tagInputEl();
			if (input) input.value = "";
		}
		renderTagMenu();
	}

	function ensureTagMenu() {
		if (tagMenuEl) return tagMenuEl;
		tagMenuEl = document.createElement("div");
		tagMenuEl.className = "nas-tags-menu";
		tagMenuEl.hidden = true;
		root.appendChild(tagMenuEl);
		tagMenuEl.addEventListener("mousedown", (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
		tagMenuEl.addEventListener("pointerdown", (e) => e.stopPropagation());
		return tagMenuEl;
	}

	function tagInputEl() {
		return pickerEl?.querySelector(".nas-tags-input") || null;
	}

	function ensurePicker() {
		if (pickerEl) return pickerEl;
		pickerEl = document.createElement("div");
		pickerEl.className = "nas-picker";
		pickerEl.innerHTML = `
      <div class="nas-picker-title">Anki</div>
      <label class="nas-picker-label">Deck</label>
      <select class="nas-picker-select"></select>
      <input class="nas-picker-input" type="text" placeholder="Or type a new deck name" />
      <div class="nas-picker-hint"></div>
      <label class="nas-picker-label">Tags</label>
      <div class="nas-tags">
        <div class="nas-tags-control">
          <div class="nas-tags-chips"></div>
          <input class="nas-tags-input" type="text" autocomplete="off" spellcheck="false" />
        </div>
      </div>
      <div class="nas-picker-actions">
        <button type="button" class="nas-picker-unsync">Unsync</button>
        <button type="button" class="nas-picker-cancel">Cancel</button>
        <button type="button" class="nas-picker-ok">Sync</button>
      </div>
    `;
		root.appendChild(pickerEl);

		pickerEl.addEventListener("pointerdown", (e) => {
			e.stopPropagation();
			if (!e.target.closest(".nas-tags-control")) closeTagMenu();
		});
		pickerEl.addEventListener("mousedown", (e) => e.stopPropagation());

		pickerEl.querySelector(".nas-picker-cancel").addEventListener("click", (e) => {
			e.preventDefault();
			hidePicker();
		});
		pickerEl.querySelector(".nas-picker-unsync").addEventListener("click", (e) => {
			e.preventDefault();
			const id = pickerEl.dataset.blockId;
			hidePicker();
			if (id) sendSync("UNSYNC", id);
		});
		pickerEl.querySelector(".nas-picker-ok").addEventListener("click", (e) => {
			e.preventDefault();
			commitTagInput();
			const select = pickerEl.querySelector(".nas-picker-select");
			const input = pickerEl.querySelector(".nas-picker-input");
			const deck = (input.value || select.value || "Default").trim();
			const id = pickerEl.dataset.blockId;
			const tags = [...selectedTags];
			hidePicker();
			if (!id) return;
			sendSync("SYNC", id, { deckName: deck || "Default", tags });
		});

		const tagInput = pickerEl.querySelector(".nas-tags-input");
		pickerEl.querySelector(".nas-tags-control").addEventListener("click", () => {
			tagInput.focus();
			tagMenuOpen = true;
			tagHighlight = 0;
			renderTagMenu();
		});
		tagInput.addEventListener("focus", () => {
			tagMenuOpen = true;
			tagHighlight = 0;
			renderTagMenu();
		});
		tagInput.addEventListener("input", () => {
			tagMenuOpen = true;
			tagHighlight = 0;
			renderTagMenu();
		});
		tagInput.addEventListener("keydown", (e) => handleTagKey(e.key, e));
		return pickerEl;
	}

	function handleTagKey(key, e) {
		if (!pickerOpen) return false;
		if (key === "ArrowDown") {
			if (e) e.preventDefault();
			const items = currentTagSuggestions();
			if (!items.length) return true;
			tagMenuOpen = true;
			tagHighlight = (tagHighlight + 1) % items.length;
			renderTagMenu();
			return true;
		}
		if (key === "ArrowUp") {
			if (e) e.preventDefault();
			const items = currentTagSuggestions();
			if (!items.length) return true;
			tagMenuOpen = true;
			tagHighlight = (tagHighlight - 1 + items.length) % items.length;
			renderTagMenu();
			return true;
		}
		if (key === "Enter") {
			if (e) e.preventDefault();
			const items = currentTagSuggestions();
			const choice = items[tagHighlight] || items[0];
			const typed = tagInputEl()?.value || "";
			if (choice) addTag(choice.value);
			else addTag(typed);
			return true;
		}
		if (key === "Backspace") {
			const input = tagInputEl();
			if (input && !input.value && selectedTags.length) {
				if (e) e.preventDefault();
				selectedTags.pop();
				renderTagChips();
				renderTagMenu();
				return true;
			}
			return false;
		}
		if (key === "Escape") {
			if (e) e.preventDefault();
			if (tagMenuOpen) closeTagMenu();
			else hidePicker();
			return true;
		}
		return false;
	}

	function addTag(raw) {
		const tag = sanitizeTag(raw);
		if (!tag) return;
		if (renamingFrom && renamingFrom !== tag) {
			const from = renamingFrom;
			renamingFrom = "";
			chrome.runtime.sendMessage({ type: "RENAME_TAG", from, to: tag }, (res) => {
				if (res?.tags) tagCatalog = res.tags;
				if (res?.hiddenTags) hiddenTags = res.hiddenTags;
				selectedTags = selectedTags.filter((t) => t !== from);
				if (!selectedTags.includes(tag)) selectedTags.push(tag);
				renderTagChips();
				renderTagMenu();
			});
		}
		if (!selectedTags.includes(tag)) selectedTags.push(tag);
		hiddenTags = hiddenTags.filter((t) => t !== tag);
		if (!tagCatalog.includes(tag)) tagCatalog = [...tagCatalog, tag].sort((a, b) => a.localeCompare(b));
		const input = tagInputEl();
		if (input) input.value = "";
		tagHighlight = 0;
		tagMenuOpen = true;
		renderTagChips();
		renderTagMenu();
	}

	function removeTag(tag) {
		selectedTags = selectedTags.filter((t) => t !== tag);
		renderTagChips();
		renderTagMenu();
	}

	function commitTagInput() {
		const input = tagInputEl();
		if (input?.value) addTag(input.value);
	}

	function forgetCatalogTag(tag) {
		if (!confirm(isRuUi() ? `Удалить тег «${tag}» везде?` : `Delete tag “${tag}” everywhere?`)) return;
		selectedTags = selectedTags.filter((t) => t !== tag);
		tagCatalog = tagCatalog.filter((t) => t !== tag);
		ankiTagCatalog = ankiTagCatalog.filter((t) => t !== tag);
		if (!hiddenTags.includes(tag)) hiddenTags.push(tag);
		chrome.runtime.sendMessage({ type: "FORGET_TAG", tag }, (res) => {
			if (res?.tags) tagCatalog = res.tags;
			if (res?.hiddenTags) hiddenTags = res.hiddenTags;
			renderTagChips();
			renderTagMenu();
		});
		renderTagChips();
		renderTagMenu();
	}

	function startRename(tag) {
		renamingFrom = tag;
		const input = tagInputEl();
		input.value = tag;
		tagMenuOpen = true;
		input.focus();
		input.select();
		renderTagMenu();
	}

	function renderTagChips() {
		if (!pickerEl) return;
		const box = pickerEl.querySelector(".nas-tags-chips");
		box.innerHTML = "";
		for (const tag of selectedTags) {
			const [fg, bg] = tagColor(tag);
			const chip = document.createElement("button");
			chip.type = "button";
			chip.className = "nas-tag-chip";
			chip.style.background = bg;
			chip.style.color = fg;
			chip.title = isRuUi() ? "Убрать с этой карточки" : "Remove from this card";
			chip.innerHTML = `<span>${escapeHtml(tag)}</span><span class="nas-tag-x">×</span>`;
			chip.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				removeTag(tag);
			});
			box.appendChild(chip);
		}
	}

	function allKnownTags() {
		const hidden = new Set(hiddenTags);
		return [...new Set([...tagCatalog, ...ankiTagCatalog])].filter((t) => t && !hidden.has(t));
	}

	function currentTagSuggestions() {
		const q = sanitizeTag(tagInputEl()?.value || "").toLowerCase();
		const selected = new Set(selectedTags);
		const prefix = [];
		const rest = [];
		for (const t of allKnownTags()) {
			const low = t.toLowerCase();
			if (!q) {
				rest.push(t);
				continue;
			}
			if (low.startsWith(q)) prefix.push(t);
			else if (low.includes(q)) rest.push(t);
		}
		prefix.sort((a, b) => a.localeCompare(b));
		rest.sort((a, b) => a.localeCompare(b));
		const matches = [...prefix, ...rest].slice(0, 20).map((value) => ({
			value,
			create: false,
			selected: selected.has(value),
		}));
		const exact = allKnownTags().some((t) => t.toLowerCase() === q);
		if (q && !exact) matches.push({ value: q, create: true, selected: false });
		return matches;
	}

	function renderTagMenu() {
		const menu = ensureTagMenu();
		const ru = isRuUi();
		const items = currentTagSuggestions();
		if (!pickerOpen || !tagMenuOpen) {
			menu.hidden = true;
			menu.innerHTML = "";
			return;
		}
		menu.hidden = false;
		if (!items.length) {
			const q = tagInputEl()?.value || "";
			menu.innerHTML = `<div class="nas-tags-empty">${
				q
					? ru
						? "Нет совпадений. Enter создаст тег."
						: "No matches. Press Enter to create."
					: ru
						? "Пока нет тегов. Введите имя и нажмите Enter."
						: "No tags yet. Type a name and press Enter."
			}</div>`;
			placeTagMenu(menu);
			return;
		}
		if (tagHighlight < 0 || tagHighlight >= items.length) tagHighlight = 0;
		menu.innerHTML = items
			.map((item, idx) => {
				const [fg, bg] = tagColor(item.value);
				const label = item.create ? (ru ? `Создать «${escapeHtml(item.value)}»` : `Create “${escapeHtml(item.value)}”`) : escapeHtml(item.value);
				const tools = item.create
					? ""
					: `<span class="nas-tag-tools">
              <button type="button" class="nas-tag-rename" data-tag="${escapeAttr(item.value)}" title="${ru ? "Переименовать" : "Rename"}">✎</button>
              <button type="button" class="nas-tag-forget" data-tag="${escapeAttr(item.value)}" title="${ru ? "Удалить тег везде" : "Delete tag everywhere"}">×</button>
            </span>`;
				const check = item.selected ? `<span class="nas-tag-check" title="${ru ? "Уже выбран" : "Selected"}">✓</span>` : "";
				return `<div class="nas-tags-option${idx === tagHighlight ? " is-active" : ""}${item.selected ? " is-selected" : ""}" data-index="${idx}" data-tag="${escapeAttr(item.value)}">
          <span class="nas-tag-dot" style="background:${bg};color:${fg}">${escapeHtml(item.value.slice(0, 1).toUpperCase())}</span>
          <span class="nas-tag-name">${label}</span>
          ${check}
          ${tools}
        </div>`;
			})
			.join("");

		menu.querySelectorAll(".nas-tags-option").forEach((row) => {
			row.addEventListener("mouseenter", () => {
				tagHighlight = Number(row.getAttribute("data-index")) || 0;
				menu.querySelectorAll(".nas-tags-option").forEach((n) => n.classList.remove("is-active"));
				row.classList.add("is-active");
			});
			row.addEventListener("click", (e) => {
				if (e.target.closest(".nas-tag-tools")) return;
				e.preventDefault();
				e.stopPropagation();
				const idx = Number(row.getAttribute("data-index"));
				const item = items[idx];
				const value = row.getAttribute("data-tag");
				if (item?.selected) removeTag(value);
				else addTag(value);
				tagInputEl()?.focus();
			});
		});
		menu.querySelectorAll(".nas-tag-forget").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				forgetCatalogTag(btn.getAttribute("data-tag"));
			});
		});
		menu.querySelectorAll(".nas-tag-rename").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				startRename(btn.getAttribute("data-tag"));
			});
		});
		placeTagMenu(menu);
	}

	function placeTagMenu(menu) {
		const control = pickerEl.querySelector(".nas-tags-control");
		const rect = control.getBoundingClientRect();
		const estimated = Math.min(220, Math.max(88, 8 + menu.childElementCount * 34));
		const spaceBelow = window.innerHeight - rect.bottom - 16;
		const top = spaceBelow < estimated ? Math.max(8, rect.top - estimated - 4) : rect.bottom + 4;
		menu.style.left = `${rect.left}px`;
		menu.style.width = `${rect.width}px`;
		menu.style.top = `${top}px`;
	}

	function positionPanel(el, rect) {
		el.style.display = "block";
		el.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 300))}px`;
		el.style.width = `${Math.max(300, Math.min(rect.width || 300, 380))}px`;
		const height = el.offsetHeight || 280;
		let top = rect.bottom + 8;
		if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 8);
		el.style.top = `${top}px`;
	}

	function showPicker(blockId, anchor) {
		const el = ensurePicker();
		const id = normalizeBlockId(blockId);
		const synced = Boolean(cardsCache[id]);
		const ru = isRuUi();
		const rect = anchor.getBoundingClientRect();
		const sameCard = pickerOpen && el.dataset.blockId === id;
		pickerOpen = true;
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
		el.querySelector(".nas-tags-input").placeholder = ru ? "Найти или создать тег" : "Find or create a tag";
		el.querySelectorAll(".nas-picker-label")[0].textContent = ru ? "Колода" : "Deck";
		el.querySelectorAll(".nas-picker-label")[1].textContent = ru ? "Теги" : "Tags";
		if (!sameCard) {
			el.querySelector(".nas-picker-hint").textContent = ru ? "Загрузка колод…" : "Loading decks…";
			el.querySelector(".nas-picker-input").value = "";
			el.querySelector(".nas-tags-input").value = "";
			el.dataset.tagsReady = "";
			tagMenuOpen = false;
			tagHighlight = 0;
			renamingFrom = "";
			selectedTags = synced ? sanitizeList(cardsCache[id]?.tags) : [];
			renderTagChips();
			renderTagMenu();
		}
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
			hiddenTags = Array.isArray(res?.hiddenTags) ? res.hiddenTags : [];
			tagCatalog = Array.isArray(res?.tags) ? res.tags : [];
			ankiTagCatalog = Array.isArray(res?.ankiTags) ? res.ankiTags : [];
			if (!el.dataset.tagsReady) {
				el.dataset.tagsReady = "1";
				selectedTags = synced ? sanitizeList(cardsCache[id]?.tags) : sanitizeList(res?.defaultTags);
				renderTagChips();
			}
			el.querySelector(".nas-picker-hint").textContent = res?.anki
				? ru
					? "Колода и теги запоминаются для следующей карточки"
					: "Deck and tags are reused for the next card"
				: ru
					? "Anki закрыт. Список колод и тегов может быть неполным."
					: "Anki is closed. Deck and tag lists may be incomplete.";
			renderTagMenu();
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

	function ensureHandleBtn() {
		if (handleBtn) return handleBtn;
		handleBtn = document.createElement("button");
		handleBtn.type = "button";
		handleBtn.className = "nas-handle-btn";
		handleBtn.innerHTML = iconImg(18);
		handleBtn.title = "Sync with Anki";
		handleLayer.appendChild(handleBtn);
		const stop = (e) => {
			e.preventDefault();
			e.stopPropagation();
		};
		handleBtn.addEventListener("pointerdown", stop, true);
		handleBtn.addEventListener("mousedown", stop, true);
		handleBtn.addEventListener(
			"click",
			(e) => {
				stop(e);
				const id = handleBtn.dataset.blockId;
				if (!id) return;
				lastBlockId = id;
				showPicker(id, handleBtn);
			},
			true,
		);
		handleBtn.addEventListener("mouseenter", () => {
			handleHideAt = Date.now() + 800;
		});
		return handleBtn;
	}

	function updateHandleButton() {
		const btn = ensureHandleBtn();
		if (notionPopupOpen()) {
			btn.style.display = "none";
			return;
		}
		const cluster = findHoverCluster();
		const overSelf = btn.matches(":hover");
		if (cluster) {
			lastBlockId = cluster.id;
			handleHideAt = Date.now() + 500;
			const leftEl = cluster.plus || cluster.handle;
			handleRect = leftEl.getBoundingClientRect();
			btn.dataset.blockId = cluster.id;
			btn.classList.toggle("nas-handle-btn-synced", Boolean(cardsCache[cluster.id]));
			btn.title = cardsCache[cluster.id] ? "Anki · already synced" : "Sync with Anki";
		}
		if (overSelf) handleHideAt = Date.now() + 800;
		if (!handleRect || (Date.now() > handleHideAt && !overSelf && !cluster)) {
			btn.style.display = "none";
			return;
		}
		const size = 24;
		btn.style.display = "flex";
		btn.style.width = `${size}px`;
		btn.style.height = `${handleRect.height || size}px`;
		btn.style.left = `${Math.max(4, handleRect.left - size - 2)}px`;
		btn.style.top = `${handleRect.top}px`;
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
				showPicker(id, titleBtn);
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
		btn.querySelector(".nas-title-btn-label").textContent = synced ? (ru ? "В Anki" : "Synced") : ru ? "В Anki" : "Sync page";
		const trect = leaf.getBoundingClientRect();
		const height = 32;
		let left = trect.right + 10;
		const width = btn.offsetWidth || 120;
		if (left + width > window.innerWidth - 12) left = Math.max(8, window.innerWidth - width - 12);
		btn.style.left = `${left}px`;
		btn.style.top = `${Math.max(8, trect.top + (trect.height - height) / 2)}px`;
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
		updateHandleButton();
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
			badge.title = deck ? `Synced with Anki → ${deck}` : "Synced with Anki";
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

	function refreshState() {
		chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
			if (!res?.ok) return;
			cardsCache = res.cards || {};
			requestBadges();
		});
	}

	function isInsidePicker(target) {
		return Boolean(target?.closest?.("#nas-root, #nas-handle-layer"));
	}

	document.addEventListener(
		"pointerdown",
		(e) => {
			if (isInsidePicker(e.target)) return;
			if (pickerOpen) hidePicker();
		},
		true,
	);

	window.addEventListener("message", (e) => {
		if (e.source !== window || e.data?.source !== "nas-guard") return;
		if (e.data.type === "tag-key") handleTagKey(e.data.key);
	});

	document.addEventListener("scroll", requestBadges, true);
	window.addEventListener("resize", requestBadges);
	document.addEventListener("mousemove", requestBadges, { passive: true });

	chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
		if (msg?.type === "PING") {
			sendResponse({ ok: true, href: location.href, blockId: lastBlockId || pageTitleId() });
		}
	});

	refreshState();
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === "local" && changes.cards) {
			cardsCache = changes.cards.newValue || {};
			requestBadges();
		}
	});
	setInterval(requestBadges, 400);
})();
