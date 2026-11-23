// Local item search database.
//
// Wowhead's name-search endpoint blocks cross-origin requests, so search runs
// over a local index instead. The index is built from the community WoW
// Forever database (https://github.com/gBlaku/wow-forever-kb, generated daily
// from the game client's own data tables) by scripts/build_itemdb.py and
// shipped with this site at data/items.json (~2MB, ~400KB over the wire), so
// loading it is a same-origin fetch with no CORS exposure. The kb site itself
// is kept as a fallback source, and the last good index is cached in
// IndexedDB so search still works offline.

const LOCAL_URL = 'data/items.json';
const KB_BASE = 'https://gblaku.github.io/wow-forever-kb/';

let itemIndex = null;   // [{ id, name, q, slot, src }]
let loadPromise = null;

// ---- Tiny IndexedDB key-value helpers ------------------------------------

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('forever-bis-cache', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- Loading ---------------------------------------------------------------

export function itemDbReady() {
  return itemIndex !== null;
}

/** Slim same-origin index: { build, fields, items: [[id, name, quality, slot, source], …] }. */
async function fetchLocal() {
  const res = await fetch(LOCAL_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data?.items)) throw new Error('Bad index');
  return {
    build: data.build ?? 'unknown',
    items: data.items.map(([id, name, q, slot, src]) => ({
      id: String(id),
      name: String(name ?? ''),
      q: typeof q === 'number' ? q : null,
      slot: slot || '',
      src: src || '',
    })).filter((i) => i.name),
  };
}

/** Fallback: the community database site (12MB of full item objects). */
async function fetchRemote(onStatus) {
  onStatus?.('Downloading the item database (one-time, a few MB)…');
  const res = await fetch(`${KB_BASE}api/items.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();
  return {
    build: 'remote',
    items: raw
      .filter((i) => i && i.id != null && i.name)
      .map((i) => ({
        id: String(i.id),
        name: String(i.name),
        q: typeof i.quality === 'number' ? i.quality : null,
        slot: i.slot || '',
        src: (i.source_summary || '').slice(0, 160),
      })),
  };
}

/**
 * Load (or reuse) the item index: the site's own data/items.json first, the
 * community site as fallback, then the last good IndexedDB copy for offline.
 * Safe to call repeatedly; concurrent calls share one load. Throws when no
 * source is available.
 */
export function loadItemDb(onStatus) {
  if (itemIndex) return Promise.resolve(itemIndex);
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    let data = null;
    try { data = await fetchLocal(); } catch { /* fall through */ }
    if (!data) {
      try { data = await fetchRemote(onStatus); } catch { /* fall through */ }
    }
    if (!data) {
      let cached = null;
      try { cached = await idbGet('itemdb'); } catch { /* no IndexedDB */ }
      if (cached?.items?.length) {
        itemIndex = cached.items;
        return itemIndex;
      }
      throw new Error('Item database unreachable');
    }
    itemIndex = data.items;
    try { await idbSet('itemdb', data); } catch { /* cache is best-effort */ }
    return itemIndex;
  })();
  loadPromise.catch(() => { loadPromise = null; }); // allow retry after failure
  return loadPromise;
}

/** Entry for one item id, if the database is loaded and has it. */
export function itemDbGet(id) {
  return itemIndex?.find((i) => i.id === String(id)) ?? null;
}

// ---- Search ----------------------------------------------------------------

/** Which of the database's item slots fit each of the app's equipment slots. */
export const SLOT_ITEM_TYPES = {
  head: ['Head'],
  neck: ['Neck'],
  shoulder: ['Shoulder'],
  back: ['Back'],
  chest: ['Chest'],
  wrist: ['Wrist'],
  hands: ['Hands'],
  waist: ['Waist'],
  legs: ['Legs'],
  feet: ['Feet'],
  ring1: ['Finger'],
  ring2: ['Finger'],
  trinket1: ['Trinket'],
  trinket2: ['Trinket'],
  mainhand: ['Main Hand', 'One-Hand', 'Two-Hand'],
  offhand: ['Off Hand', 'One-Hand', 'Held In Off-hand', 'Shield'],
  ranged: ['Ranged', 'Relic', 'Thrown'],
};

/** Does this database item fit the given app slot? Unknown items pass. */
export function itemFitsSlot(dbItem, slotKey) {
  const allowed = SLOT_ITEM_TYPES[slotKey];
  if (!allowed || !dbItem) return true;
  return allowed.includes(dbItem.slot);
}

/**
 * Rank-ordered name search over the loaded index.
 * `slotKey` (an app slot) limits results to items that fit that slot.
 * Prefers prefix > word-start > substring matches, then equippable items,
 * higher quality, and shorter names.
 */
export function searchItemDb(query, { limit = 12, slotKey = null } = {}) {
  if (!itemIndex) return [];
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const allowed = slotKey ? SLOT_ITEM_TYPES[slotKey] : null;
  const scored = [];
  for (const item of itemIndex) {
    if (allowed && !allowed.includes(item.slot)) continue;
    const name = item.name.toLowerCase();
    const idx = name.indexOf(q);
    if (idx === -1) continue;
    const posScore = idx === 0 ? 0 : (name[idx - 1] === ' ' || name[idx - 1] === "'" ? 1 : 2);
    scored.push([
      posScore * 1000
        + (item.slot ? 0 : 400)          // equippable first
        + (item.src ? 0 : 5)             // entries with source info first
        + (10 - Math.min(item.q ?? 0, 9)) * 10
        + Math.min(item.name.length, 99) / 100,
      item,
    ]);
  }
  scored.sort((a, b) => a[0] - b[0]);
  // The game re-issues some items under new ids with no source data; show
  // each name/slot/quality once, keeping the best-ranked (sourced) entry.
  const seen = new Set();
  const out = [];
  for (const [, item] of scored) {
    const key = `${item.name}|${item.slot}|${item.q}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}
