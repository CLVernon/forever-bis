// Cross-device sync via a secret GitHub Gist.
//
// The user supplies a classic GitHub token with only the "gist" scope; the
// app stores it in THIS browser only (a separate localStorage key, so it is
// never part of state exports or share links) and keeps the tracker data in
// one secret gist (file forever-bis.json). GitHub's API is CORS-enabled, so
// no server is involved.
//
// Divergence safety: we remember the gist's updated_at from our last
// successful sync and a hash of the state we synced. Before an automatic
// upload the remote timestamp is re-checked; if another device moved it,
// nothing is overwritten and the user resolves it in the sync dialog.

const CFG_KEY = 'forever-bis/sync-v1';
const FILENAME = 'forever-bis.json';
const API = 'https://api.github.com';

export function syncConfig() {
  try {
    return JSON.parse(localStorage.getItem(CFG_KEY)) ?? null;
  } catch {
    return null;
  }
}

export function saveSyncConfig(cfg) {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  } catch { /* storage unavailable */ }
}

export function disconnectSync() {
  localStorage.removeItem(CFG_KEY);
}

/** Cheap content fingerprint (djb2 + length) for "did it change" checks. */
export function hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}:${s.length}`;
}

async function gh(token, path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    },
  });
  if (res.status === 401 || res.status === 403) throw new Error('unauthorized');
  if (!res.ok) throw new Error(`GitHub API error ${res.status}`);
  return res.json();
}

/** Find the user's existing sync gist, if any. */
export async function findGist(token) {
  for (let page = 1; page <= 3; page++) {
    const gists = await gh(token, `/gists?per_page=100&page=${page}`);
    const hit = gists.find((g) => g.files && g.files[FILENAME]);
    if (hit) return hit;
    if (gists.length < 100) break;
  }
  return null;
}

/** The gist's current data + timestamp. */
export async function fetchGistData(token, gistId) {
  const gist = await gh(token, `/gists/${gistId}`);
  const file = gist.files?.[FILENAME];
  if (!file) throw new Error('Sync file missing from gist');
  let content = file.content;
  if (file.truncated) content = await (await fetch(file.raw_url)).text();
  return { data: JSON.parse(content), updatedAt: gist.updated_at, url: gist.html_url };
}

/** Only the gist's timestamp (for freshness checks). */
export async function fetchGistMeta(token, gistId) {
  const gist = await gh(token, `/gists/${gistId}`);
  return { updatedAt: gist.updated_at, url: gist.html_url };
}

export async function createGist(token, content) {
  return gh(token, '/gists', {
    method: 'POST',
    body: JSON.stringify({
      description: 'Forever BIS tracker data (synced)',
      public: false,
      files: { [FILENAME]: { content } },
    }),
  });
}

export async function updateGist(token, gistId, content) {
  return gh(token, `/gists/${gistId}`, {
    method: 'PATCH',
    body: JSON.stringify({ files: { [FILENAME]: { content } } }),
  });
}
