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

	async function getPage(token, pageId) {
		return api(token, `/pages/${normalizeBlockId(pageId)}`);
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

	async function fetchBlockTree(token, blockId) {
		const id = normalizeBlockId(blockId);
		try {
			const block = await getBlock(token, id);
			return attachContent(token, block, 0);
		} catch (e) {
			if (e.status !== 404 && e.code !== "object_not_found") throw e;
		}
		const page = await getPage(token, id);
		return attachContent(token, pageAsBlock(page), 0);
	}

	async function getContainingPageTitle(token, block) {
		try {
			let parent = block?.parent;
			for (let i = 0; i < 24 && parent; i += 1) {
				if (parent.type === "page_id" && parent.page_id) {
					const page = await getPage(token, parent.page_id);
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

	return {
		normalizeBlockId,
		getMe,
		getBlock,
		fetchBlockTree,
		getContainingPageTitle,
		headingLevel,
	};
})();
