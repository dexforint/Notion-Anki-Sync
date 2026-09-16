var NASNotion = (() => {
	const VERSION = "2022-06-28";
	let lastRequestAt = 0;

	function sleep(ms) {
		return new Promise((r) => setTimeout(r, ms));
	}

	async function throttledFetch(url, options) {
		let attempt = 0;
		while (true) {
			const wait = lastRequestAt + 350 - Date.now();
			if (wait > 0) await sleep(wait);
			lastRequestAt = Date.now();
			const res = await fetch(url, options);
			if (res.status !== 429 && res.status !== 503) return res;
			attempt += 1;
			if (attempt > 5) return res;
			const retryAfter = Number(res.headers.get("Retry-After"));
			const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(8000, 400 * 2 ** attempt);
			await sleep(delay);
		}
	}

	function headers(token) {
		return {
			Authorization: `Bearer ${token}`,
			"Notion-Version": VERSION,
			"Content-Type": "application/json",
		};
	}

	function normalizeBlockId(id) {
		if (!id) return id;
		const hex = String(id).replace(/-/g, "");
		if (hex.length !== 32) return id;
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	}

	async function api(token, path) {
		const res = await throttledFetch(`https://api.notion.com/v1${path}`, {
			headers: headers(token),
		});
		const json = await res.json().catch(() => ({}));
		if (!res.ok) {
			const code = json?.code || res.status;
			const msg = json?.message || res.statusText;
			const err = new Error(`Notion API: ${msg}`);
			err.code = code;
			err.status = res.status;
			throw err;
		}
		return json;
	}

	async function getMe(token) {
		return api(token, "/users/me");
	}

	async function getBlock(token, blockId) {
		return api(token, `/blocks/${normalizeBlockId(blockId)}`);
	}

	async function getChildren(token, blockId) {
		const results = [];
		let cursor = undefined;
		const id = normalizeBlockId(blockId);
		do {
			const qs = new URLSearchParams({ page_size: "100" });
			if (cursor) qs.set("start_cursor", cursor);
			const page = await api(token, `/blocks/${id}/children?${qs.toString()}`);
			results.push(...(page.results || []));
			cursor = page.has_more ? page.next_cursor : undefined;
		} while (cursor);
		return results;
	}

	async function fetchBlockTree(token, blockId, depth = 0) {
		const block = await getBlock(token, blockId);
		return attachChildren(token, block, depth);
	}

	async function attachChildren(token, block, depth) {
		if (depth > 12) return block;
		const skip = block.type === "child_page" || block.type === "child_database";
		if (!block.has_children || skip) {
			block._children = [];
			return block;
		}
		const children = await getChildren(token, block.id);
		const out = [];
		for (const child of children) {
			out.push(await attachChildren(token, child, depth + 1));
		}
		block._children = out;
		return block;
	}

	function titleFromPage(page) {
		const props = page?.properties || {};
		for (const prop of Object.values(props)) {
			if (prop?.type === "title") {
				return (prop.title || [])
					.map((t) => t.plain_text || "")
					.join("")
					.trim();
			}
		}
		return "";
	}

	async function getContainingPageTitle(token, block) {
		try {
			let parent = block?.parent;
			for (let i = 0; i < 24 && parent; i += 1) {
				if (parent.type === "page_id" && parent.page_id) {
					const page = await api(token, `/pages/${normalizeBlockId(parent.page_id)}`);
					return titleFromPage(page);
				}
				if (parent.type === "block_id" && parent.block_id) {
					const b = await getBlock(token, parent.block_id);
					parent = b.parent;
					continue;
				}
				break;
			}
		} catch (e) {
			console.warn("page title failed", e);
		}
		return "";
	}

	return { normalizeBlockId, getMe, getBlock, fetchBlockTree, getContainingPageTitle };
})();
