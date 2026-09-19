const statusEl = document.getElementById("status");

async function load() {
	const local = await chrome.storage.local.get("settings");
	let synced = {};
	try {
		synced = await chrome.storage.sync.get("settings");
	} catch (_) {}
	const s = { ...(synced.settings || {}), ...(local.settings || {}) };
	document.getElementById("notionToken").value = s.notionToken || local.settings?.notionToken || synced.settings?.notionToken || "";
	document.getElementById("ankiUrl").value = local.settings?.ankiUrl || "http://127.0.0.1:8765";
	document.getElementById("deckName").value = s.deckName || "Default";
	document.getElementById("tags").value = s.tags || "notion";
	document.getElementById("intervalMinutes").value = s.intervalMinutes || 10;
	document.getElementById("autoSync").checked = s.autoSync !== false;
}

document.getElementById("save").onclick = async () => {
	const settings = {
		notionToken: document.getElementById("notionToken").value.trim(),
		ankiUrl: document.getElementById("ankiUrl").value.trim(),
		deckName: document.getElementById("deckName").value.trim() || "Default",
		tags: document.getElementById("tags").value.trim() || "notion",
		intervalMinutes: Math.max(5, Number(document.getElementById("intervalMinutes").value) || 10),
		autoSync: document.getElementById("autoSync").checked,
	};
	await chrome.storage.local.set({ settings });
	try {
		const { ankiUrl, ...rest } = settings;
		await chrome.storage.sync.set({ settings: rest });
	} catch (_) {}
	statusEl.textContent = "Saved.";
};

function send(type) {
	chrome.runtime.sendMessage({ type }, (res) => {
		if (chrome.runtime.lastError) {
			statusEl.textContent = chrome.runtime.lastError.message;
			return;
		}
		statusEl.textContent = res?.ok ? JSON.stringify(res) : res?.error || "Failed";
	});
}

document.getElementById("testNotion").onclick = () => send("TEST_NOTION");
document.getElementById("testAnki").onclick = () => send("TEST_ANKI");
load();
