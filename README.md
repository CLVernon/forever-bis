# Forever BIS

A Best-in-Slot goal tracker for **World of Warcraft: Forever**.

Set up your characters, give each one any number of **loadouts** (e.g. Enhancement /
Elemental / Restoration), define global **phases** (e.g. Pre Raid, Tier 1), and add
goal items to every equipment slot per phase. Mark items as obtained and keep notes
on how to get them — items are stored once per character, so obtained status and
notes stay in sync across every loadout and phase that shares the item.

## Features

- **Characters** — name, race, and class (class-colored).
- **Phases** — global gearing stages (Pre Raid, Tier 1, …). Adding a phase adds it
  to every loadout on every character; each loadout has its own goal list per phase.
- **Loadouts** — any number per character, with progress per loadout + phase
  (items obtained / slots covered).
- **Item goals per slot** — any number of alternatives per slot, ordered by priority
  (the top one is marked **BIS**; reorder with ▲/▼).
- **Synced obtained status & notes** — shared across loadouts and phases by design;
  a ⇄ badge shows where else an item appears.
- **Wowhead integration** — add items by name search, item ID, or a pasted Wowhead
  link. Name, quality color, and icon are fetched from Wowhead's Forever tooltip
  API, and hovering an item shows the full Wowhead tooltip. If a lookup fails
  (offline, blocked), the item is still added and can be refreshed later with ↻.
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
| `js/store.js` | Data model (phases → loadouts → slots), localStorage persistence, game constants |
| `js/wowhead.js` | Wowhead URLs, tooltip-API fetch, name search, input parsing |
| `js/app.js` | Rendering and event handling |
| `css/style.css` | Theme and layout |

Item data and tooltips are provided by [Wowhead](https://www.wowhead.com/forever).
