importScripts("lib/notion.js", "lib/anki.js", "lib/highlight.js", "lib/converter.js");

const DEFAULTS = {
	notionToken: "",
	ankiUrl: "http://127.0.0.1:8765",
	deckName: "Default",
	tags: "notion",
	intervalMinutes: 10,
};

const NOTION_HOST = /(^|\.)notion\.(so|site|com)$/i;
let lastHydrateAt = 0;

async function readRawSettings() {
	const local = await chrome.storage.local.get("settings");
	let synced = {};
	try {
		synced = await chrome.storage.sync.get("settings");
	} catch (_) {}
	return { sLocal: local.settings || {}, sSync: synced.settings || {} };
}

function mergeSettings(sSync, sLocal) {
	const merged = { ...DEFAULTS, ...sSync, ...sLocal };
	if (!sLocal.notionToken && sSync.notionToken) merged.notionToken = sSync.notionToken;
	if (!sLocal.deckName && sSync.deckName) merged.deckName = sSync.deckName;
	if (!sLocal.tags && sSync.tags) merged.tags = sSync.tags;
	if (!sLocal.lastDeckName && sSync.lastDeckName) merged.lastDeckName = sSync.lastDeckName;
	if (sLocal.intervalMinutes == null && sSync.intervalMinutes != null) {
		merged.intervalMinutes = sSync.intervalMinutes;
	}
	merged.ankiUrl = sLocal.ankiUrl || DEFAULTS.ankiUrl;
	return merged;
}

async function saveSettings(settings) {
	await chrome.storage.local.set({ settings });
	try {
		const { ankiUrl, ...rest } = settings;
		await chrome.storage.sync.set({ settings: rest });
	} catch (_) {}
}

async function getState() {
	const data = await chrome.storage.local.get(["cards", "queue"]);
	const { sLocal, sSync } = await readRawSettings();
	return {
		settings: mergeSettings(sSync, sLocal),
		cards: data.cards || {},
		queue: data.queue || [],
	};
}

async function setCards(cards) {
	await chrome.storage.local.set({ cards });
}

async function setQueue(queue) {
	await chrome.storage.local.set({ queue });
}

function parseTags(str) {
	return String(str || "notion")
		.split(/[,\s]+/)
		.map((t) => t.trim())
		.filter(Boolean);
}

function isMissingNotionBlock(err, block) {
	if (block && (block.archived || block.in_trash)) return true;
	const code = err?.code || "";
	const status = err?.status;
	const msg = String(err?.message || "").toLowerCase();
	return code === "object_not_found" || status === 404 || msg.includes("object_not_found") || msg.includes("could not find") || msg.includes("not found");
}

async function enqueue(op) {
	const { queue } = await getState();
	const filtered = queue.filter((q) => !(q.type === op.type && q.blockId === op.blockId));
	filtered.push({ ...op, at: Date.now() });
	await setQueue(filtered);
}

async function ankiAvailable(url) {
	try {
		await NASAnki.ping(url);
		return true;
	} catch {
		return false;
	}
}

async function getMediaCache() {
	const data = await chrome.storage.local.get("mediaCache");
	return data.mediaCache || {};
}

async function setMediaCache(cache) {
	await chrome.storage.local.set({ mediaCache: cache });
}

async function arrayBufferToBase64(buf) {
	const bytes = new Uint8Array(buf);
	const chunk = 0x8000;
	let binary = "";
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

async function storeMediaAll(ankiUrl, media) {
	if (!media?.length) return;
	const cache = await getMediaCache();
	let dirty = false;
	for (const file of media) {
		if (!file?.filename || !file.url) continue;
		const key = file.cacheKey || String(file.url).split("?")[0];
		const known = cache[key] === file.filename;
		if (known && (await NASAnki.mediaExists(ankiUrl, file.filename))) continue;
		if (await NASAnki.mediaExists(ankiUrl, file.filename)) {
			cache[key] = file.filename;
			dirty = true;
			continue;
		}
		const res = await fetch(file.url);
		if (!res.ok) throw new Error(`Failed to download media: ${res.status}`);
		const data = await arrayBufferToBase64(await res.arrayBuffer());
		await NASAnki.storeMedia(ankiUrl, file.filename, data);
		cache[key] = file.filename;
		dirty = true;
	}
	if (dirty) await setMediaCache(cache);
}

function resolveDeckName(settings, prev, options) {
	if (options.deckName) return options.deckName;
	if (prev?.deckName) return prev.deckName;
	if (!prev) return settings.lastDeckName || settings.deckName || "Default";
	return settings.deckName || "Default";
}

async function hydrateFromAnki(force = false) {
	if (!force && Date.now() - lastHydrateAt < 8000) return;
	const { settings, cards, queue } = await getState();
	if (!(await ankiAvailable(settings.ankiUrl))) return;
	let remote = {};
	try {
		remote = await NASAnki.listTracked(settings.ankiUrl);
	} catch (e) {
		console.warn("hydrateFromAnki failed", e);
		return;
	}
	lastHydrateAt = Date.now();
	const queued = new Set(queue.map((q) => q.blockId));
	const next = {};
	for (const [id, remoteCard] of Object.entries(remote)) {
		const local = cards[id];
		next[id] = {
			noteId: remoteCard.noteId,
			status: local?.status === "pending" && queued.has(id) ? "pending" : "synced",
			lastEdited: local?.lastEdited || null,
			contentHash: local?.contentHash || null,
			deckName: remoteCard.deckName || local?.deckName || "Default",
			front: remoteCard.front || local?.front || "",
			error: null,
		};
	}
	for (const [id, local] of Object.entries(cards)) {
		if (next[id]) continue;
		if (local.status === "pending" || queued.has(id)) next[id] = local;
	}
	if (JSON.stringify(next) !== JSON.stringify(cards)) await setCards(next);
}

async function syncBlock(blockId, options = {}) {
	const { settings, cards } = await getState();
	if (!settings.notionToken) throw new Error("Notion token is not set. Open extension settings.");

	const id = NASNotion.normalizeBlockId(blockId);
	const prev = cards[id];
	const deckName = resolveDeckName(settings, prev, options);
	const moveDeck = Boolean(options.deckName) || !prev?.noteId;

	let tree;
	try {
		tree = await NASNotion.fetchBlockTree(settings.notionToken, id);
	} catch (e) {
		if (isMissingNotionBlock(e)) {
			await deleteLocalAndRemote(id);
			return { ok: true, action: "deleted", reason: "missing_in_notion" };
		}
		throw e;
	}

	if (isMissingNotionBlock(null, tree)) {
		await deleteLocalAndRemote(id);
		return { ok: true, action: "deleted", reason: "trashed_in_notion" };
	}

	let pageTitle = "";
	try {
		pageTitle = await NASNotion.getContainingPageTitle(settings.notionToken, tree);
	} catch (_) {}

	const converted = await NASConverter.convertToggle(tree, { pageTitle });

	const contentHash = await NASConverter.hashText(converted.front + "\n" + converted.back);
	const live = await ankiAvailable(settings.ankiUrl);

	if (live && prev && (prev.noteId || prev.status === "synced")) {
		const existence = await NASAnki.noteExists(settings.ankiUrl, id, prev.noteId);
		if (!existence.exists) {
			const recreate = Boolean(options.deckName) && !options.fromReconcile;
			if (!recreate) {
				delete cards[id];
				await setCards(cards);
				const st = await getState();
				await setQueue(st.queue.filter((q) => q.blockId !== id));
				return { ok: true, action: "orphaned", reason: "missing_in_anki" };
			}
		} else if (existence.noteId && existence.noteId !== prev.noteId) {
			prev.noteId = existence.noteId;
		}
	}

	if (!live) {
		cards[id] = {
			noteId: prev?.noteId || null,
			status: "pending",
			lastEdited: converted.lastEdited,
			contentHash,
			deckName,
			front: converted.front,
			error: null,
		};
		await setCards(cards);
		await enqueue({ type: "sync", blockId: id, deckName, moveDeck });
		return { ok: true, action: "queued", status: "pending", deckName };
	}

	if (!options.force && prev?.noteId && prev.contentHash === contentHash && prev.status === "synced" && prev.deckName === deckName) {
		return { ok: true, action: "unchanged", noteId: prev.noteId, status: "synced", deckName };
	}

	await storeMediaAll(settings.ankiUrl, converted.media);
	const noteId = await NASAnki.addOrUpdate(settings.ankiUrl, {
		deckName,
		front: converted.front,
		back: converted.back,
		blockId: id,
		tags: parseTags(settings.tags),
		moveDeck,
	});

	cards[id] = {
		noteId,
		status: "synced",
		lastEdited: converted.lastEdited,
		contentHash,
		deckName,
		front: converted.front,
		error: null,
	};
	await setCards(cards);

	if (options.deckName) {
		await saveSettings({ ...settings, lastDeckName: options.deckName });
	}
	return { ok: true, action: prev?.noteId ? "updated" : "created", noteId, status: "synced", deckName };
}

async function unsyncBlock(blockId) {
	const { settings, cards, queue } = await getState();
	const id = NASNotion.normalizeBlockId(blockId);
	const prev = cards[id];
	const live = await ankiAvailable(settings.ankiUrl);
	if (!live) {
		await enqueue({ type: "unsync", blockId: id, noteId: prev?.noteId || null });
		delete cards[id];
		await setCards(cards);
		return { ok: true, action: "queued_delete", status: "pending" };
	}
	await NASAnki.deleteByBlockId(settings.ankiUrl, id, prev?.noteId);
	delete cards[id];
	await setCards(cards);
	await setQueue(queue.filter((q) => q.blockId !== id));
	return { ok: true, action: "deleted" };
}

async function deleteLocalAndRemote(blockId) {
	const { settings, cards } = await getState();
	const id = NASNotion.normalizeBlockId(blockId);
	const prev = cards[id];
	if (await ankiAvailable(settings.ankiUrl)) {
		try {
			await NASAnki.deleteByBlockId(settings.ankiUrl, id, prev?.noteId);
		} catch (e) {
			console.warn("Failed to delete Anki note", e);
		}
	} else {
		await enqueue({ type: "unsync", blockId: id, noteId: prev?.noteId || null });
	}
	delete cards[id];
	await setCards(cards);
}

async function processQueue() {
	const { settings, queue } = await getState();
	if (!queue.length) return { processed: 0 };
	if (!(await ankiAvailable(settings.ankiUrl))) return { processed: 0, anki: false };

	let processed = 0;
	const rest = [...queue];
	while (rest.length) {
		const op = rest.shift();
		await setQueue(rest);
		try {
			if (op.type === "unsync") {
				await NASAnki.deleteByBlockId(settings.ankiUrl, op.blockId, op.noteId);
				const st = await getState();
				delete st.cards[op.blockId];
				await setCards(st.cards);
			} else if (op.type === "sync") {
				await syncBlock(op.blockId, {
					force: true,
					deckName: op.deckName,
					moveDeck: op.moveDeck,
				});
			}
			processed += 1;
		} catch (e) {
			rest.push(op);
			await setQueue(rest);
			break;
		}
	}
	return { processed, anki: true };
}

async function backgroundReconcile() {
	await hydrateFromAnki(true);
	const { settings, cards } = await getState();
	const summary = {
		total: 0,
		updated: 0,
		created: 0,
		unchanged: 0,
		deleted: 0,
		queued: 0,
		orphaned: 0,
		errors: 0,
		anki: false,
	};
	if (!settings.notionToken) {
		const err = new Error("Notion token is not set. Open extension settings.");
		err.code = "no_token";
		throw err;
	}

	summary.anki = await ankiAvailable(settings.ankiUrl);
	const ids = Object.keys(cards);
	summary.total = ids.length;

	for (const id of ids) {
		try {
			const res = await syncBlock(id, { fromReconcile: true });
			if (res.action === "updated") summary.updated += 1;
			else if (res.action === "created") summary.created += 1;
			else if (res.action === "unchanged") summary.unchanged += 1;
			else if (res.action === "deleted") summary.deleted += 1;
			else if (res.action === "queued") summary.queued += 1;
			else if (res.action === "orphaned") summary.orphaned += 1;
		} catch (e) {
			summary.errors += 1;
			const st = await getState();
			if (st.cards[id]) {
				st.cards[id].status = "error";
				st.cards[id].error = e.message;
				await setCards(st.cards);
			}
		}
	}

	const queueRes = await processQueue();
	summary.queuedProcessed = queueRes.processed || 0;
	if (!summary.anki) summary.anki = Boolean(queueRes.anki);
	return summary;
}

function scheduleAlarm(intervalMinutes) {
	const period = Math.max(5, Number(intervalMinutes) || 10);
	chrome.alarms.create("nas-sync", { periodInMinutes: period });
}

function isNotionUrl(url) {
	try {
		return NOTION_HOST.test(new URL(url).hostname);
	} catch {
		return false;
	}
}

async function injectIntoTab(tabId) {
	try {
		await chrome.scripting.insertCSS({
			target: { tabId, allFrames: true },
			files: ["content.css"],
		});
	} catch (_) {}
	try {
		await chrome.scripting.executeScript({
			target: { tabId, allFrames: true },
			files: ["content.js"],
		});
	} catch (e) {
		console.warn("[NAS] inject failed", e.message);
	}
}

async function injectAllNotionTabs() {
	const tabs = await chrome.tabs.query({});
	for (const tab of tabs) {
		if (tab.id && tab.url && isNotionUrl(tab.url)) await injectIntoTab(tab.id);
	}
}

chrome.runtime.onInstalled.addListener(async () => {
	const { settings } = await getState();
	await saveSettings({ ...DEFAULTS, ...settings });
	scheduleAlarm(settings.intervalMinutes);
	injectAllNotionTabs();
});

chrome.runtime.onStartup.addListener(async () => {
	const { settings } = await getState();
	scheduleAlarm(settings.intervalMinutes);
	injectAllNotionTabs();
	await hydrateFromAnki(true);
	await processQueue();
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
	if (info.status === "complete" && tab.url && isNotionUrl(tab.url)) {
		injectIntoTab(tabId);
	}
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
	if (alarm.name === "nas-sync") await backgroundReconcile();
});

chrome.storage.onChanged.addListener((changes, area) => {
	if (changes.settings) {
		const next = changes.settings.newValue || {};
		scheduleAlarm(next.intervalMinutes);
	}
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	handleMessage(msg)
		.then(sendResponse)
		.catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
	return true;
});

async function handleMessage(msg) {
	switch (msg.type) {
		case "SYNC":
			return syncBlock(msg.blockId, {
				deckName: msg.deckName,
				force: Boolean(msg.deckName),
			});
		case "UNSYNC":
			return unsyncBlock(msg.blockId);
		case "GET_STATE": {
			await hydrateFromAnki();
			const st = await getState();
			const anki = await ankiAvailable(st.settings.ankiUrl);
			return {
				ok: true,
				cards: st.cards,
				queueLength: st.queue.length,
				anki,
				settings: {
					deckName: st.settings.deckName,
					intervalMinutes: st.settings.intervalMinutes,
					hasToken: Boolean(st.settings.notionToken),
				},
			};
		}
		case "GET_DECKS": {
			const { settings } = await getState();
			const fallbackDefault = settings.deckName || "Default";
			try {
				const decks = (await NASAnki.listDecks(settings.ankiUrl)).filter(Boolean);
				await chrome.storage.local.set({ deckCache: decks });
				let defaultDeck = settings.lastDeckName || fallbackDefault;
				if (!decks.includes(defaultDeck)) {
					defaultDeck = decks.includes(fallbackDefault) ? fallbackDefault : decks[0] || fallbackDefault;
					if (settings.lastDeckName && settings.lastDeckName !== defaultDeck) {
						await saveSettings({ ...settings, lastDeckName: defaultDeck });
					}
				}
				return { ok: true, anki: true, decks, defaultDeck };
			} catch {
				const extra = await chrome.storage.local.get("deckCache");
				return {
					ok: true,
					anki: false,
					decks: extra.deckCache || [],
					defaultDeck: settings.lastDeckName || fallbackDefault,
				};
			}
		}
		case "TEST_NOTION": {
			const { settings } = await getState();
			const me = await NASNotion.getMe(settings.notionToken);
			return { ok: true, name: me?.name || me?.bot?.owner?.user?.name || "OK" };
		}
		case "TEST_ANKI": {
			const { settings } = await getState();
			const ping = await NASAnki.ping(settings.ankiUrl);
			return { ok: true, version: ping.version };
		}
		case "SYNC_ALL": {
			const summary = await backgroundReconcile();
			return { ok: true, summary };
		}
		case "PROCESS_QUEUE":
			return { ok: true, ...(await processQueue()) };
		default:
			throw new Error(`Unknown message: ${msg.type}`);
	}
}
