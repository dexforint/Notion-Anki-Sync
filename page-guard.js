(() => {
	if (window.__NAS_KEYGUARD__) return;
	window.__NAS_KEYGUARD__ = true;

	function insideNas(el) {
		if (!el || typeof el.closest !== "function") return false;
		return Boolean(el.closest("#nas-root, #nas-handle-layer"));
	}

	function isTagInput(el) {
		return Boolean(el && el.classList && el.classList.contains("nas-tags-input"));
	}

	// НОВОЕ: copy/cut/paste не должны доходить до Notion
	for (const type of ["copy", "cut", "paste"]) {
		window.addEventListener(
			type,
			(e) => {
				if (insideNas(e.target)) e.stopPropagation();
			},
			true,
		);
	}

	window.addEventListener(
		"keydown",
		(e) => {
			if (!insideNas(e.target)) return;
			e.stopPropagation();
			if ((e.ctrlKey || e.metaKey) && (e.key === "x" || e.key === "X")) {
				e.stopImmediatePropagation();
				return;
			}
			if (!isTagInput(e.target)) return;
			if (["Enter", "ArrowDown", "ArrowUp", "Escape"].includes(e.key)) {
				e.preventDefault();
				window.postMessage({ source: "nas-guard", type: "tag-key", key: e.key }, "*");
			}
		},
		true,
	);

	window.addEventListener(
		"keyup",
		(e) => {
			if (insideNas(e.target)) e.stopPropagation();
		},
		true,
	);

	window.addEventListener(
		"keypress",
		(e) => {
			if (insideNas(e.target)) e.stopPropagation();
		},
		true,
	);
})();
