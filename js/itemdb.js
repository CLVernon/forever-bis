// Local item search database.
//
// Wowhead's name-search endpoint blocks cross-origin requests, so instead we
// load the community WoW Forever item database (built daily from the game
// client's own data and served CORS-enabled from GitHub Pages):
//   https://gblaku.github.io/wow-forever-kb/
// The slimmed index is cached in IndexedDB keyed by game build, so the
// download (one to a few MB) happens once per game patch, and searches are
// instant and fully offline afterwards.

const KB_BASE = 'https://gblaku.github.io/wow-forever-kb/';
export const KB_HOME = KB_BASE;

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

/**
 * Load (or reuse) the item index. Safe to call repeatedly; concurrent calls
 * share one download. Throws when the database cannot be fetched.
 */
export function loadItemDb(onStatus) {
  if (itemIndex) return Promise.resolve(itemIndex);
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    let build = null;
    try {
      const meta = await (await fetch(`${KB_BASE}api/meta.json`)).json();
      build = meta?.build ?? null;
    } catch { /* offline or blocked; try the cache below */ }

    let cached = null;
    try { cached = await idbGet('itemdb'); } catch { /* no IndexedDB */ }
    if (cached?.items?.length && (build === null || cached.build === build)) {
      itemIndex = cached.items;
      return itemIndex;
    }
    if (build === null && !cached) throw new Error('Item database unreachable');

    onStatus?.('Downloading the item database (one-time, a few MB)…');
    const res = await fetch(`${KB_BASE}api/items.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    itemIndex = raw
      .filter((i) => i && i.id != null && i.name)
      .map((i) => ({
        id: String(i.id),
        name: String(i.name),
        q: typeof i.quality === 'number' ? i.quality : null,
        slot: i.slot || '',
        src: (i.source_summary || '').slice(0, 160),
      }));
    try { await idbSet('itemdb', { build: build ?? 'unknown', items: itemIndex }); } catch { /* cache is best-effort */ }
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

/**
 * Rank-ordered name search over the loaded index.
 * Prefers prefix > word-start > substring matches, then equippable items,
 * higher quality, and shorter names.
 */
export function searchItemDb(query, limit = 12) {
  if (!itemIndex) return [];
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const scored = [];
  for (const item of itemIndex) {
    const name = item.name.toLowerCase();
    const idx = name.indexOf(q);
    if (idx === -1) continue;
    const posScore = idx === 0 ? 0 : (name[idx - 1] === ' ' || name[idx - 1] === "'" ? 1 : 2);
    scored.push([
      posScore * 1000
        + (item.slot ? 0 : 400)          // equippable first
        + (10 - Math.min(item.q ?? 0, 9)) * 10
        + Math.min(item.name.length, 99) / 100,
      item,
    ]);
  }
  scored.sort((a, b) => a[0] - b[0]);
  return scored.slice(0, limit).map((s) => s[1]);
}
