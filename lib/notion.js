var NASNotion = (() => {
	const VERSION = "2022-06-28";

	// Notion даёт ~3 rps. Держим 300–350 мс, при 429 — сами раздвигаем интервал.
	const MIN_SPACING = 300;
	const MAX_SPACING = 1200;
	let spacing = 350;
	let lastRequestAt = 0;

	// --- Кэш в пределах одного прохода (beginPass/endPass) ---
	let passDepth = 0;
	let childrenCache = null;
	let pageTitleCache = null;
	let ancestorCache = null;

	let requestCount = 0;

	function sleep(ms) {
		return new Promise((r) => setTimeout(r, ms));
	}

	function beginPass() {
		passDepth += 1;
		if (passDepth === 1) {
			childrenCache = new Map();
			pageTitleCache = new Map();
			ancestorCache = new Map();
		}
	}

	function endPass() {
		passDepth = Math.max(0, passDepth - 1);
		if (passDepth === 0) {
			childrenCache = null;
			pageTitleCache = null;
			ancestorCache = null;
		}
	}

	async function throttledFetch(url, options) {
		let attempt = 0;
		while (true) {
			const wait = lastRequestAt + spacing - Date.now();
			if (wait > 0) await sleep(wait);
			lastRequestAt = Date.now();
			requestCount += 1;
			const res = await fetch(url, options);
			if (res.status !== 429 && res.status !== 503) {
				// медленно ужимаем интервал, пока Notion не жалуется
				spacing = Math.max(MIN_SPACING, spacing - 5);
				return res;
			}
			attempt += 1;
			spacing = Math.min(MAX_SPACING, Math.round(spacing * 1.5));
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

	async function getPage(token, pageId) {
		return api(token, `/pages/${normalizeBlockId(pageId)}`);
	}

	async function getChildren(token, blockId) {
		const id = normalizeBlockId(blockId);
		if (childrenCache && childrenCache.has(id)) return childrenCache.get(id);
		const results = [];
		let cursor = undefined;
		do {
			const qs = new URLSearchParams({ page_size: "100" });
			if (cursor) qs.set("start_cursor", cursor);
			const page = await api(token, `/blocks/${id}/children?${qs.toString()}`);
			results.push(...(page.results || []));
			cursor = page.has_more ? page.next_cursor : undefined;
		} while (cursor);
		if (childrenCache) childrenCache.set(id, results);
		return results;
	}

	function headingLevel(block) {
		const m = /^heading_(\d+)$/.exec(block?.type || "");
		return m ? Number(m[1]) : null;
	}

	function parentId(block) {
		const parent = block?.parent;
		if (!parent) return null;
		if (parent.type === "page_id") return parent.page_id;
		if (parent.type === "block_id") return parent.block_id;
		return null;
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

	function pageAsBlock(page) {
		return {
			id: page.id,
			type: "child_page",
			child_page: { title: titleFromPage(page) || "Untitled" },
			has_children: true,
			parent: page.parent,
			last_edited_time: page.last_edited_time,
			archived: page.archived,
			in_trash: page.in_trash,
		};
	}

	async function fetchFollowingSiblings(token, block) {
		const pid = parentId(block);
		if (!pid) return [];
		const level = headingLevel(block);
		const children = await getChildren(token, pid);
		const idx = children.findIndex((c) => c.id === block.id);
		if (idx < 0) return [];
		const collected = [];
		for (let i = idx + 1; i < children.length; i += 1) {
			const next = children[i];
			const nextLevel = headingLevel(next);
			if (level && nextLevel && nextLevel <= level) break;
			collected.push(next);
		}
		return collected;
	}

	async function attachChildren(token, block, depth) {
		if (depth > 12) {
			block._children = block._children || [];
			return block;
		}
		const skipNested = depth > 0 && (block.type === "child_page" || block.type === "child_database");
		if (!block.has_children || skipNested) {
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

	async function attachContent(token, block, depth) {
		const level = headingLevel(block);
		if (level && !block.has_children) {
			const siblings = await fetchFollowingSiblings(token, block);
			const out = [];
			for (const child of siblings) {
				out.push(await attachChildren(token, child, depth + 1));
			}
			block._children = out;
			return block;
		}
		return attachChildren(token, block, depth);
	}

	async function fetchBlockTreeMeta(token, blockId) {
		const id = normalizeBlockId(blockId);
		let rootBlock;
		try {
			rootBlock = await getBlock(token, id);
		} catch (e) {
			if (e.status !== 404 && e.code !== "object_not_found") throw e;
			const page = await getPage(token, id);
			rootBlock = pageAsBlock(page);
		}
		// Для карточки-страницы «контейнером» считаем саму страницу.
		const pageInfo =
			rootBlock.type === "child_page"
				? { id, title: rootBlock.child_page?.title || "", lastEdited: rootBlock.last_edited_time || null }
				: await getContainingPageInfo(token, rootBlock);
		const block = await attachContent(token, rootBlock, 0);
		return { block, pageInfo };
	}

	async function fetchBlockTree(token, blockId) {
		return (await fetchBlockTreeMeta(token, blockId)).block;
	}

	async function getContainingPageInfo(token, block) {
		try {
			let parent = block?.parent;
			for (let i = 0; i < 24 && parent; i += 1) {
				if (parent.type === "page_id" && parent.page_id) {
					const pid = normalizeBlockId(parent.page_id);
					if (pageTitleCache && pageTitleCache.has(pid)) return pageTitleCache.get(pid);
					const page = await getPage(token, parent.page_id);
					const info = { id: pid, title: titleFromPage(page), lastEdited: page.last_edited_time || null };
					if (pageTitleCache) pageTitleCache.set(pid, info);
					return info;
				}
				if (parent.type === "block_id" && parent.block_id) {
					const bid = normalizeBlockId(parent.block_id);
					if (ancestorCache?.has(bid)) {
						parent = ancestorCache.get(bid);
						continue;
					}
					const b = await getBlock(token, parent.block_id);
					if (ancestorCache) ancestorCache.set(bid, b.parent);
					parent = b.parent;
					continue;
				}
				break;
			}
		} catch (e) {
			console.warn("page info failed", e);
		}
		return { id: null, title: "", lastEdited: null };
	}

	async function getContainingPageTitle(token, block) {
		const info = await getContainingPageInfo(token, block);
		return info.title;
	}

	return {
		normalizeBlockId,
		getMe,
		getBlock,
		fetchBlockTree,
		getContainingPageTitle,
		headingLevel,
		beginPass,
		endPass,
		stats: () => ({ requests: requestCount, spacing }),
		resetStats: () => {
			requestCount = 0;
		},
		getContainingPageInfo,
		fetchBlockTreeMeta,
	};
})();
