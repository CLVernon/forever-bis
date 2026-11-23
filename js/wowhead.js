// Wowhead integration (WoW: Forever database): item page URLs, icon URLs,
// tooltip-JSON fetch and (best-effort) name search. Everything degrades
// gracefully — if the network or CORS blocks a request, the app falls back
// to manual entry and the official Wowhead hover-tooltip widget still works
// (it is script-based).

const BRANCH = '/forever';
const PLACEHOLDER_ICON = 'inv_misc_questionmark';

/** Item page on Wowhead (also drives the hover tooltip). */
export function itemUrl(id) {
  return `https://www.wowhead.com${BRANCH}/item=${id}`;
}

export function searchUrl(query) {
  return `https://www.wowhead.com${BRANCH}/search?q=${encodeURIComponent(query)}`;
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
 * Pull "where does this come from" lines out of Wowhead's tooltip HTML —
 * e.g. "Drop: Golemagg the Incinerator", "Sold by: …", "Quest: …".
 * Returns '' when the tooltip has no source info (that is still a valid
 * parse result, distinct from null = never parsed).
 */
function extractSource(tooltipHtml) {
  if (typeof tooltipHtml !== 'string') return '';
  const text = tooltipHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|tr|td|th|table|p|li|span)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const pat = /^(Drop(?:ped by)?|Sold by|Vendor|Quest|Created by|Crafted by|Contained in|Pick ?Pocket(?:ed from)?|Fish(?:ing|ed)|Gathered|Mined|Reward from|Source|Zone)\s*:\s*\S/i;
  const hits = lines.filter((l) => pat.test(l));
  return hits.slice(0, 2).join(' · ').slice(0, 160);
}

/**
 * Fetch item details (name, quality, icon, source) from Wowhead's tooltip
 * endpoint — the same endpoint the official widget uses, served with CORS
 * headers. Throws on failure.
 */
export async function fetchItem(id) {
  const data = await fetchJson(
    `https://nether.wowhead.com${BRANCH}/tooltip/item/${id}?locale=0`);
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
  return {
    id: String(id), name, quality,
    icon: data.icon || null,
    source: extractSource(data.tooltip),
    fetched: true,
  };
}

/**
 * Best-effort item search by name via Wowhead's suggestion endpoint.
 * May be blocked by CORS in some browsers — callers must handle rejection.
 * Returns [{ id, name, quality, icon }].
 */
export async function searchItems(query) {
  const url = `https://www.wowhead.com${BRANCH}/search/suggestions-template?q=${encodeURIComponent(query)}`;
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
