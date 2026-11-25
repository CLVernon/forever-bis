# Forever BIS

A Best-in-Slot goal tracker for **World of Warcraft: Forever**.

**Live app:** <https://clvernon.github.io/forever-bis/>

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
- **Planner view** — every unobtained item for the selected phase (current
  loadout or all loadouts), grouped by dungeon/raid/zone with the boss and drop
  chance nested inside, plus Quests / Crafted / Vendors sections — one glance
  answers "which instance gives me the most upgrades tonight?". Items are
  tickable right from the list.
- **Auto source info** — the drop/vendor/quest source is parsed from Wowhead's
  tooltip data and shown under each item, and drives the grouping above.
- **Enchants per slot** — an optional enchant line on every slot, per loadout
  and phase, with the same autofill as items: pick from the slot's enchant
  catalog (formulas, arcanums, Zandalar signets, Naxx shoulder enchants) and
  get quality colors, source info and a Wowhead tooltip — or type free text.
- **Copy forward & duplicate** — merge one phase's goals into another (current
  loadout or the whole character) and duplicate loadouts, so Tier 2 starts from
  Tier 1 instead of a blank page.
- **Share links** — ⋯ → *Share character link* packs the character into a
  compressed URL. Recipients get a read-only view (no server involved) and can
  save a copy into their own tracker.
- **All-characters overview** — progress per character per phase at a glance.
- **Hide obtained & undo** — declutter finished slots, and undo any delete or
  removal from a toast instead of relying on confirm dialogs.
- **Wowhead integration** — add items by name search, item ID, or a pasted Wowhead
  link. Name, quality color, icon, and source are fetched from Wowhead's Forever
  tooltip API, and hovering an item shows the full Wowhead tooltip. If a lookup
  fails (offline, blocked), the item is still added and can be refreshed later
  with ↻.
- **Move data between devices** — ⋯ → *Sync between devices*:
  - **Quick transfer (no accounts):** create a link that carries your whole
    tracker, open it on the other device (or scan the QR code with your
    phone) — it asks before replacing anything and offers Undo.
  - **Automatic sync (optional):** connect a secret GitHub gist in your own
    account (one gist-scope token, pasted once per device). Changes upload
    automatically, other devices pull on load, and divergence is never
    resolved silently.
- **Local & private** — everything is stored in your browser's `localStorage`.
  Use **⋯ → Export backup** for a JSON backup, and **Import backup** to restore
  it anywhere.

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
| `js/wowhead.js` | Wowhead URLs, tooltip-API fetch, source parsing, input parsing |
| `js/itemdb.js` | Item-search index: same-origin `data/items.json`, fallbacks, IndexedDB cache |
| `js/share.js` | Share-link encoding/decoding (deflate + base64url in the URL hash) |
| `js/sync.js` | Cross-device sync via a secret GitHub gist (token stays in the browser) |
| `js/app.js` | Rendering (slots / needed / overview views) and event handling |
| `data/items.json` | Slim item index (id, name, quality, slot, source) the search runs on |
| `data/sources.json` | Planner index: where each equippable item comes from (boss, zone, chance) |
| `scripts/build_itemdb.py` | Regenerates the `data/` indexes from the community database |
| `.github/workflows/itemdb.yml` | Weekly refresh of the `data/` indexes (also runnable manually) |

Item search data comes from [wow-forever-kb](https://github.com/gBlaku/wow-forever-kb),
a community database generated daily from the game client's own data tables.
| `css/style.css` | Theme and layout |

Item data and tooltips are provided by [Wowhead](https://www.wowhead.com/forever).
