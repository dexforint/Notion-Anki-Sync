var NASAnki = (() => {
	const MODEL_NAME = "Notion Toggle";

	async function invoke(url, action, params = {}) {
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action, version: 6, params }),
		});
		if (!res.ok) throw new Error(`AnkiConnect HTTP ${res.status}`);
		const json = await res.json();
		if (json.error) throw new Error(String(json.error));
		return json.result;
	}

	async function ping(url) {
		const version = await invoke(url, "version");
		return { version };
	}

	async function invokeBatched(url, action, key, ids) {
		const out = [];
		for (let i = 0; i < ids.length; i += 100) {
			const part = await invoke(url, action, { [key]: ids.slice(i, i + 100) });
			if (Array.isArray(part)) out.push(...part);
		}
		return out;
	}

	function fieldValue(note, name) {
		const f = note?.fields?.[name];
		if (f == null) return "";
		return typeof f === "string" ? f : String(f.value || "");
	}

	const MODEL_CSS = `
.card {
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  color: #37352f;
  background: #fff;
  text-align: left;
  max-width: 820px;
  margin: 0 auto;
  padding: 8px 12px;
}
img { max-width: 100%; height: auto; border-radius: 4px; }
a { color: #37352f; text-decoration: underline; }
h1, h2, h3 { line-height: 1.3; margin: 1em 0 0.4em; }
h1 { font-size: 1.6em; }
h2 { font-size: 1.35em; }
h3 { font-size: 1.15em; }
p { margin: 0.35em 0; }
ul, ol { margin: 0.35em 0; padding-left: 1.5em; }
li { margin: 0.15em 0; }
code {
  font-family: "SFMono-Regular", Consolas, Menlo, monospace;
  font-size: 85%;
  background: rgba(135,131,120,.15);
  border-radius: 4px;
  padding: 0.15em 0.4em;
}
pre {
  background: #f7f6f3;
  padding: 12px 14px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 14px;
}
pre code { background: none; padding: 0; }
blockquote {
  margin: 6px 0;
  padding: 2px 12px;
  border-left: 3px solid #37352f;
  color: #6b6b67;
}
hr { border: none; border-top: 1px solid #e3e2e0; margin: 14px 0; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; }
th, td { border: 1px solid #e3e2e0; padding: 6px 8px; vertical-align: top; }
th { background: #f7f6f3; }
.callout {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 6px;
  margin: 8px 0;
  background: #f1f1ef;
}
.callout-icon { flex: 0 0 auto; }
.callout-gray { background: #f1f1ef; }
.callout-brown { background: #f4eeee; }
.callout-orange { background: #fbecdd; }
.callout-yellow { background: #fbf3db; }
.callout-green { background: #edf3ea; }
.callout-blue { background: #e7f3f8; }
.callout-purple { background: #f4f0f7; }
.callout-pink { background: #f9f2f5; }
.callout-red { background: #fdebec; }
.nas-toggle {
  border: 1px solid #e3e2e0;
  border-radius: 6px;
  padding: 6px 10px;
  margin: 6px 0;
}
.nas-toggle > summary { cursor: pointer; font-weight: 600; }
.nas-todo-checked { text-decoration: line-through; opacity: 0.65; }
.nas-caption { font-size: 13px; color: #787774; margin-top: 4px; }
.nas-columns { display: flex; gap: 16px; }
.nas-column { flex: 1; min-width: 0; }
.nas-color-red { color: #e03e3e; }
.nas-color-blue { color: #2383e2; }
.nas-color-green { color: #0f7b6c; }
.nas-color-yellow { color: #dfab01; }
.nas-color-orange { color: #d9730d; }
.nas-color-purple { color: #9065b0; }
.nas-color-pink { color: #c14c8a; }
.nas-color-gray { color: #787774; }
.nas-color-brown { color: #9f6b53; }
.nas-bg-red { background: #fdebec; }
.nas-bg-blue { background: #e7f3f8; }
.nas-bg-green { background: #edf3ea; }
.nas-bg-yellow { background: #fbf3db; }
.nas-bg-orange { background: #fbecdd; }
.nas-bg-purple { background: #f4f0f7; }
.nas-bg-pink { background: #f9f2f5; }
.nas-bg-gray { background: #f1f1ef; }
.nas-bg-brown { background: #f4eeee; }
.nas-code {
  margin: 8px 0;
  border: 1px solid #e3e2e0;
  border-radius: 8px;
  overflow: hidden;
  background: #fbfbfa;
}
.nas-code-lang {
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #787774;
  padding: 6px 12px 0;
}
.nas-code pre {
  margin: 0;
  background: transparent;
  padding: 8px 12px 12px;
}
.nas-code code {
  background: none;
  padding: 0;
  font-size: 13px;
  color: #37352f;
}
.hl-keyword { color: #9a3412; font-weight: 600; }
.hl-built_in, .hl-class-name { color: #7c3aed; }
.hl-string, .hl-inserted { color: #0f7b6c; }
.hl-comment { color: #9b9a97; font-style: italic; }
.hl-number { color: #c4550a; }
.hl-function, .hl-decorator { color: #2563eb; }
.hl-attr, .hl-attribute, .hl-selector { color: #0b6e99; }
.hl-tag { color: #c026d3; }
.hl-variable { color: #0369a1; }
.hl-operator, .hl-punctuation { color: #57534e; }
.hl-heading { color: #1d4ed8; font-weight: 650; }
.hl-deleted { color: #b42318; }
.nas-origin {
  display: block;
  font-size: 0.72em;
  font-weight: 650;
  color: #787774;
  letter-spacing: 0.01em;
  margin: 0 0 0.45em;
}
`;

	async function ensureDeck(url, deckName) {
		const decks = await invoke(url, "deckNames");
		if (!decks.includes(deckName)) {
			await invoke(url, "createDeck", { deck: deckName });
		}
	}

	async function ensureModel(url) {
		const models = await invoke(url, "modelNames");
		if (!models.includes(MODEL_NAME)) {
			await invoke(url, "createModel", {
				modelName: MODEL_NAME,
				inOrderFields: ["Front", "Back", "NotionBlockId"],
				css: MODEL_CSS,
				cardTemplates: [
					{
						Name: "Card",
						Front: "{{Front}}",
						Back: '{{FrontSide}}\n<hr id="answer">\n{{Back}}',
					},
				],
			});
			return;
		}
		try {
			await invoke(url, "updateModelStyling", {
				model: { name: MODEL_NAME, css: MODEL_CSS },
			});
		} catch (e) {
			console.warn("updateModelStyling failed", e);
		}
	}

	async function findNoteId(url, blockId) {
		const dashed = String(blockId || "");
		const hex = dashed.replace(/-/g, "");
		const queries = [`NotionBlockId:"${dashed}"`];
		if (hex && hex !== dashed) queries.push(`NotionBlockId:"${hex}"`);
		for (const query of queries) {
			const ids = await invoke(url, "findNotes", { query });
			if (ids && ids.length) return ids[0];
		}
		return null;
	}

	async function noteExists(url, blockId, noteId) {
		if (noteId) {
			try {
				const info = await invoke(url, "notesInfo", { notes: [Number(noteId)] });
				if (Array.isArray(info) && info[0] && (info[0].noteId || info[0].fields)) {
					return { exists: true, noteId: info[0].noteId || Number(noteId) };
				}
			} catch (_) {}
		}
		const found = await findNoteId(url, blockId);
		if (found) return { exists: true, noteId: found };
		return { exists: false, noteId: null };
	}

	async function listTracked(url) {
		const noteIds = await invoke(url, "findNotes", {
			query: `note:"${MODEL_NAME}"`,
		});
		if (!noteIds?.length) return {};
		const notes = await invokeBatched(url, "notesInfo", "notes", noteIds);
		const cardIds = notes.flatMap((n) => n.cards || []);
		const deckByCard = {};
		if (cardIds.length) {
			try {
				const cards = await invokeBatched(url, "cardsInfo", "cards", cardIds);
				for (const c of cards) {
					if (c?.cardId) deckByCard[c.cardId] = c.deckName;
				}
			} catch (e) {
				console.warn("cardsInfo failed", e);
			}
		}
		const out = {};
		for (const note of notes) {
			const raw = fieldValue(note, "NotionBlockId").trim();
			if (!raw) continue;
			const hex = raw.replace(/-/g, "").toLowerCase();
			if (hex.length !== 32) continue;
			const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
			const firstCard = (note.cards || [])[0];
			out[id] = {
				noteId: note.noteId,
				deckName: (firstCard && deckByCard[firstCard]) || "Default",
				front: fieldValue(note, "Front"),
			};
		}
		return out;
	}

	async function addOrUpdate(url, { deckName, front, back, blockId, tags, moveDeck }) {
		await ensureDeck(url, deckName);
		await ensureModel(url);
		const existing = await findNoteId(url, blockId);
		if (existing) {
			await invoke(url, "updateNoteFields", {
				note: {
					id: existing,
					fields: { Front: front, Back: back, NotionBlockId: blockId },
				},
			});
			if (moveDeck) {
				try {
					const cardIds = await invoke(url, "findCards", { query: `nid:${existing}` });
					if (cardIds?.length) {
						await invoke(url, "changeDeck", { cards: cardIds, deck: deckName });
					}
				} catch (e) {
					console.warn("changeDeck failed", e);
				}
			}
			return existing;
		}
		return invoke(url, "addNote", {
			note: {
				deckName,
				modelName: MODEL_NAME,
				fields: { Front: front, Back: back, NotionBlockId: blockId },
				options: { allowDuplicate: true, duplicateScope: "deck" },
				tags: tags || ["notion"],
			},
		});
	}

	async function deleteByBlockId(url, blockId, noteId) {
		let id = noteId;
		if (!id) id = await findNoteId(url, blockId);
		if (id) await invoke(url, "deleteNotes", { notes: [id] });
		return id || null;
	}

	async function storeMedia(url, filename, data) {
		await invoke(url, "storeMediaFile", { filename, data });
		return filename;
	}

	async function listDecks(url) {
		return invoke(url, "deckNames");
	}

	async function mediaExists(url, filename) {
		if (!filename) return false;
		try {
			const names = await invoke(url, "getMediaFilesNames", { pattern: filename });
			if (Array.isArray(names) && names.includes(filename)) return true;
		} catch (_) {}
		try {
			const data = await invoke(url, "retrieveMediaFile", { filename });
			return Boolean(data);
		} catch {
			return false;
		}
	}

	return {
		MODEL_NAME,
		invoke,
		ping,
		addOrUpdate,
		deleteByBlockId,
		findNoteId,
		storeMedia,
		mediaExists,
		listDecks,
		noteExists,
		listTracked,
	};
})();
