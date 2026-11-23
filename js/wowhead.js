// Wowhead integration: item page URLs, icon URLs, tooltip-JSON fetch and
// (best-effort) name search. Everything degrades gracefully — if the network
// or CORS blocks a request, the app falls back to manual entry and the
// official Wowhead hover-tooltip widget still works (it is script-based).

import { GAME_VERSIONS } from './store.js';

const PLACEHOLDER_ICON = 'inv_misc_questionmark';

function branchPath(version) {
  const path = GAME_VERSIONS[version]?.path ?? 'forever';
  return path ? `/${path}` : '';
}

/** Item page on Wowhead for the right game version (also drives the hover tooltip). */
export function itemUrl(version, id) {
  return `https://www.wowhead.com${branchPath(version)}/item=${id}`;
}

export function searchUrl(version, query) {
  return `https://www.wowhead.com${branchPath(version)}/search?q=${encodeURIComponent(query)}`;
}

export function iconUrl(icon, size = 'medium') {
  return `https://wow.zamimg.com/images/wow/icons/${size}/${icon || PLACEHOLDER_ICON}.jpg`;
}

async function fetchJson(url) {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetch item details (name, quality, icon) from Wowhead's tooltip endpoint —
 * the same endpoint the official widget uses, served with CORS headers.
 * Throws on failure.
 */
export async function fetchItem(version, id) {
  const data = await fetchJson(
    `https://nether.wowhead.com${branchPath(version)}/tooltip/item/${id}?locale=0`);
  let name = data.name;
  let quality = typeof data.quality === 'number' ? data.quality : null;
  if ((!name || quality === null) && typeof data.tooltip === 'string') {
    const m = data.tooltip.match(/<b class="q(\d+)">([^<]+)<\/b>/);
    if (m) {
      if (quality === null) quality = Number(m[1]);
      if (!name) name = m[2];
    }
  }
  if (!name) throw new Error('No item data');
  return { id: String(id), name, quality, icon: data.icon || null, fetched: true };
}

/**
 * Best-effort item search by name via Wowhead's suggestion endpoint.
 * May be blocked by CORS in some browsers — callers must handle rejection.
 * Returns [{ id, name, quality, icon }].
 */
export async function searchItems(version, query) {
  const url = `https://www.wowhead.com${branchPath(version)}/search/suggestions-template?q=${encodeURIComponent(query)}`;
  const data = await fetchJson(url);
  const out = [];
  for (const r of data?.results ?? []) {
    // type 3 = item in Wowhead's suggestion payloads
    if (r && r.type === 3 && r.id != null) {
      out.push({
        id: String(r.id),
        name: r.name?.replace(/^[0-9]/, '') ?? String(r.id),
        quality: typeof r.quality === 'number' ? r.quality : null,
        icon: r.icon || null,
      });
    }
  }
  return out;
}

/**
 * Interpret user input in the add-item box:
 *  - a Wowhead item URL  -> { id, name? }
 *  - a bare numeric ID   -> { id }
 *  - anything else       -> { query }
 */
export function parseItemInput(raw) {
  const text = raw.trim();
  if (!text) return null;
  const urlMatch = text.match(/item=(\d+)(?:\/([a-z0-9-]+))?/i);
  if (urlMatch) {
    const name = urlMatch[2] ? urlMatch[2].replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase()) : undefined;
    return { id: urlMatch[1], name };
  }
  if (/^\d+$/.test(text)) return { id: text };
  return { query: text };
}
