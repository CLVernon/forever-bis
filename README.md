# Forever BIS

A Best-in-Slot goal tracker for **World of Warcraft: Forever** (and Classic / Retail).

Set up your characters, give each one any number of **loadouts** (e.g. Enhancement /
Elemental / Restoration), and add goal items to every equipment slot. Mark items as
obtained and keep notes on how to get them — items are stored once per character, so
obtained status and notes stay in sync across every loadout that shares the item.

## Features

- **Characters** — name, race, class (class-colored), and game version
  (WoW: Forever, Classic Era / Anniversary, MoP Classic, Retail).
- **Loadouts** — any number per character, with per-loadout progress
  (items obtained / slots covered).
- **Item goals per slot** — any number of alternatives per slot, ordered by priority
  (the top one is marked **BIS**; reorder with ▲/▼).
- **Synced obtained status & notes** — shared across loadouts by design; a ⇄ badge
  shows when an item also appears in other loadouts.
- **Wowhead integration** — add items by name search, item ID, or a pasted Wowhead
  link. Name, quality color, and icon are fetched from Wowhead's tooltip API for the
  character's game version, and hovering an item shows the full Wowhead tooltip.
  If a lookup fails (offline, blocked), the item is still added and can be refreshed
  later with ↻.
- **Local & private** — everything is stored in your browser's `localStorage`.
  Use **⋯ → Export backup** for a JSON backup, and **Import backup** to restore it
  (e.g. on another device).

## Running it

It is a fully static site — no build step, no server-side code.

- Open it via any static host (GitHub Pages works out of the box: Settings →
  Pages → deploy from branch).
- Or locally:

```bash
python3 -m http.server 8000
```

then visit <http://localhost:8000>. (Use a local server rather than `file://` so the
ES modules load.)

## Code layout

| File | Purpose |
| --- | --- |
| `index.html` | App shell and dialogs |
| `js/store.js` | Data model, localStorage persistence, game constants |
| `js/wowhead.js` | Wowhead URLs, tooltip-API fetch, name search, input parsing |
| `js/app.js` | Rendering and event handling |
| `css/style.css` | Theme and layout |

Item data and tooltips are provided by [Wowhead](https://www.wowhead.com/forever).
