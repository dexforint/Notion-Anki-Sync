const $ = (id) => document.getElementById(id);

let cardsCache = {};

function setStatus(text, kind = "busy") {
	const el = $("syncStatus");
	el.hidden = !text;
	el.className = `status status-${kind}`;
	el.textContent = text || "";
}

function stripHtml(html) {
	const tmp = document.createElement("div");
	tmp.innerHTML = html || "";
	return (tmp.textContent || tmp.innerText || "").replace(/\s+/g, " ").trim();
}

function formatSummary(summary) {
	if (!summary) return "Sync finished.";
	const lines = [];
	if (!summary.anki) lines.push("Anki is closed — changes were queued.");
	lines.push(`Tracked: ${summary.total}`);
	if (summary.created) lines.push(`Created: ${summary.created}`);
	if (summary.updated) lines.push(`Updated: ${summary.updated}`);
	if (summary.unchanged) lines.push(`Unchanged: ${summary.unchanged}`);
	if (summary.skipped) lines.push(`Skipped (no changes): ${summary.skipped}`);
	if (summary.deleted) lines.push(`Deleted in Notion: ${summary.deleted}`);
	if (summary.orphaned) lines.push(`Removed (deleted in Anki): ${summary.orphaned}`);
	if (summary.queued) lines.push(`Queued: ${summary.queued}`);
	if (summary.queuedProcessed) lines.push(`Queue processed: ${summary.queuedProcessed}`);
	if (summary.errors) lines.push(`Errors: ${summary.errors}`);
	if (!summary.created && !summary.updated && !summary.deleted && !summary.orphaned && !summary.queued && !summary.queuedProcessed && !summary.errors) {
		lines.push(summary.total ? "Everything is already up to date." : "Nothing to sync yet.");
	}
	return lines.join("\n");
}

function summaryKind(summary) {
	if (!summary) return "ok";
	if (summary.errors) return "err";
	if (!summary.anki || summary.queued) return "warn";
	return "ok";
}

function cardEntries() {
	return Object.entries(cardsCache || {}).map(([id, card]) => {
		const title = stripHtml(card.front) || "Untitled";
		return {
			id,
			title,
			deck: card.deckName || "Default",
			status: card.status || "synced",
			error: card.error || "",
		};
	});
}

function filteredCards() {
	const q = ($("cardSearch").value || "").trim().toLowerCase();
	const items = cardEntries().sort((a, b) => a.title.localeCompare(b.title));
	if (!q) return items;
	return items.filter((c) => c.title.toLowerCase().includes(q) || c.deck.toLowerCase().includes(q));
}

function statusLabel(status) {
	if (status === "pending") return "queued";
	if (status === "error") return "error";
	return "synced";
}

function renderCards() {
	const items = filteredCards();
	const list = $("cardList");
	const empty = $("cardEmpty");
	const total = Object.keys(cardsCache || {}).length;
	$("cardsMeta").textContent = total ? `${items.length}/${total}` : "";
	list.innerHTML = "";
	if (!items.length) {
		empty.hidden = false;
		empty.textContent = total ? "No matches." : "No tracked blocks yet. Sync one from Notion.";
		return;
	}
	empty.hidden = true;
	for (const card of items) {
		const row = document.createElement("div");
		row.className = "card-row";
		const info = document.createElement("div");
		const title = document.createElement("div");
		title.className = "card-title";
		title.textContent = card.title;
		title.title = card.error ? card.error : card.title;
		const meta = document.createElement("div");
		meta.className = "card-meta";
		const deck = document.createElement("span");
		deck.className = "card-deck";
		deck.textContent = card.deck;
		const badge = document.createElement("span");
		badge.className = `badge badge-${card.status === "pending" ? "pending" : card.status === "error" ? "error" : "synced"}`;
		badge.textContent = statusLabel(card.status);
		meta.append(deck, badge);
		info.append(title, meta);
		const unsync = document.createElement("button");
		unsync.className = "unsync";
		unsync.type = "button";
		unsync.textContent = "Unsync";
		unsync.addEventListener("click", () => unsyncCard(card.id, card.title));
		row.append(info, unsync);
		list.appendChild(row);
	}
}

function unsyncCard(blockId, title) {
	if (!confirm(`Remove “${title}” from Anki?`)) return;
	chrome.runtime.sendMessage({ type: "UNSYNC", blockId }, (res) => {
		if (chrome.runtime.lastError || !res?.ok) {
			setStatus(chrome.runtime.lastError?.message || res?.error || "Unsync failed.", "err");
			return;
		}
		setStatus(res.action === "queued_delete" ? "Anki is closed. Delete queued." : "Removed from Anki.", res.action === "queued_delete" ? "warn" : "ok");
		refreshState();
	});
}

function refreshState() {
	chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
		if (!res?.ok) return;
		cardsCache = res.cards || {};
		const ankiPill = $("ankiPill");
		const tokenPill = $("tokenPill");
		ankiPill.textContent = res.anki ? "Anki online" : "Anki offline";
		ankiPill.className = `pill ${res.anki ? "pill-ok" : "pill-off"}`;
		tokenPill.textContent = res.settings.hasToken ? "Token set" : "Token missing";
		tokenPill.className = `pill ${res.settings.hasToken ? "pill-ok" : "pill-err"}`;
		$("countNum").textContent = String(Object.keys(cardsCache).length);
		$("queueNum").textContent = String(res.queueLength);
		renderCards();
	});
}

async function pingTab() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	$("page").textContent = `Page: ${tab?.url || "unknown"}`;
	if (!tab?.id) {
		$("cs").textContent = "Content script: no tab";
		return;
	}
	try {
		const res = await chrome.tabs.sendMessage(tab.id, { type: "PING" });
		$("cs").textContent = `Content script: connected (${res?.href || "ok"})`;
	} catch (e) {
		$("cs").textContent = `Content script: NOT running (${e.message})`;
	}
}

function sendJob(type) {
	const a = $("syncChanged");
	const b = $("syncAll");
	a.disabled = b.disabled = true;
	setStatus(type === "SYNC_CHANGED" ? "Checking pages for changes…" : "Full re-sync started…", "busy");
	chrome.runtime.sendMessage({ type }, (res) => {
		a.disabled = b.disabled = false;
		refreshState();
		if (chrome.runtime.lastError) {
			setStatus(chrome.runtime.lastError.message, "err");
			return;
		}
		if (!res?.ok) {
			setStatus(res?.error || "Sync failed.", "err");
			return;
		}
		if (res.partial) setStatus("Continues in the background. You can close this popup.", "busy");
		else setStatus(formatSummary(res.summary), summaryKind(res.summary));
	});
}

function renderJob(job) {
	if (!job) return;
	const label = job.mode === "fast" ? "Updating changed" : "Full re-sync";
	if (job.phase === "pages") {
		setStatus(`${label}: checking pages…`, "busy");
		return;
	}
	setStatus(job.total >= 30 ? `${label}… ${job.index}/${job.total}` : `${label}…`, "busy");
}

$("syncChanged").onclick = () => sendJob("SYNC_CHANGED");
$("syncAll").onclick = () => sendJob("SYNC_ALL");

$("cardSearch").addEventListener("input", renderCards);
$("options").onclick = () => chrome.runtime.openOptionsPage();
$("inject").onclick = async () => {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	try {
		await chrome.scripting.insertCSS({
			target: { tabId: tab.id, allFrames: true },
			files: ["content.css"],
		});
		await chrome.scripting.executeScript({
			target: { tabId: tab.id, allFrames: true },
			world: "MAIN",
			files: ["page-guard.js"],
		});
		await chrome.scripting.executeScript({
			target: { tabId: tab.id, allFrames: true },
			files: ["content.js"],
		});
		$("cs").textContent = "Content script: injected, pinging…";
		setTimeout(pingTab, 300);
	} catch (e) {
		$("cs").textContent = `Inject error: ${e.message}`;
	}
};

chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== "local") return;
	if (changes.cards) refreshState();
	if (changes.syncJob) renderJob(changes.syncJob.newValue);
	if (changes.lastSync) {
		const v = changes.lastSync.newValue;
		if (v?.summary) setStatus(formatSummary(v.summary), summaryKind(v.summary));
	}
});

refreshState();
pingTab();

(async () => {
	const { syncJob, lastSync } = await chrome.storage.local.get(["syncJob", "lastSync"]);
	if (syncJob) renderJob(syncJob);
	else if (lastSync?.summary) setStatus(formatSummary(lastSync.summary), summaryKind(lastSync.summary));
})();
