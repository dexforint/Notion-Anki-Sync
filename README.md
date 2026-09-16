<p align="center">
  <img src="icons/icon.svg" width="96" height="96" alt="Notion Anki Sync">
</p>

# Notion Anki Sync

https://github.com/dexforint/Notion-Anki-Sync/raw/refs/heads/main/assets/demo.mp4

**English** · [Русский](README.ru.md)

Chrome extension that turns a Notion **toggle** into an Anki card from the block handle (six dots).

- **Front** = page name + toggle title
- **Back** = toggle children as Notion-like HTML (text, lists, quotes, callouts, code with highlighting, LaTeX, tables, nested toggles, images)
- Choose an Anki deck when syncing
- **Unsync** deletes the Anki note
- If Anki is closed, changes are queued
- **Sync all now** / background pass:
  - updates changed toggles
  - deletes the Anki note if the Notion block is gone
  - drops the badge if the Anki note was deleted
- Same cards and badges on a second PC via **AnkiWeb** (Anki is the source of truth)
- Images are reused if Anki already has them

AnkiWeb and mobile get cards through normal Anki desktop sync. There is no public AnkiWeb write API.

## Install

1. Install [Anki](https://apps.ankiweb.net/) and [AnkiConnect](https://foosoft.net/projects/anki-connect/) (code `2055492159`). Keep Anki running while you sync.
2. Notion → **Settings → Connections → Develop or manage integrations** → create an **Internal Integration** → copy the token.
3. On each page you want to sync: **••• → Connections** → add that integration.
4. Chrome → `chrome://extensions` → **Developer mode** → **Load unpacked** → this folder.
5. Extension **Settings**: paste the Notion token, **Test Notion** / **Test Anki**, save.

## Usage

1. Hover a **toggle** → six dots.
2. The Anki panel opens: pick a deck → **Sync**.
3. A badge on the right of the toggle means it is tracked.
4. Open the panel again to **Update** or **Unsync**.
5. Toolbar popup → **Sync all now** for a full pass, a summary, and the tracked-card list.

Type a new deck name in the panel to create it. Deleted decks disappear from the list while Anki is running.

## Two computers

Cards live in Anki. Sync them with **AnkiWeb**.

The extension reads every `Notion Toggle` note on startup and on **Sync all now**, then restores badges. You do not copy a local database.

On the second PC:

1. Anki + AnkiConnect, sync from AnkiWeb.
2. Load the extension. Same Notion token (or Chrome profile sync — token / default deck travel via `chrome.storage.sync`).
3. Open Notion → **Sync all now**.

The pending queue exists only on the machine that created it (Anki was closed there).

## Privacy

The Notion token stays in Chrome storage. Traffic goes only to `api.notion.com` and local AnkiConnect (`127.0.0.1:8765`). No extra server.

## Limits

- Notion web in Chrome. The menu is overlaid (Notion DOM is locked).
- Only **toggle** blocks.
- Anki desktop + AnkiConnect required for writes.
- If Anki is closed, the extension cannot see that you deleted a note there until the next sync with Anki open.

## License

MIT
