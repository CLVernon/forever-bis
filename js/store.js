// ---- Static game data -------------------------------------------------

export const SLOTS = [
  { key: 'head',     label: 'Head' },
  { key: 'neck',     label: 'Neck' },
  { key: 'shoulder', label: 'Shoulders' },
  { key: 'back',     label: 'Back' },
  { key: 'chest',    label: 'Chest' },
  { key: 'wrist',    label: 'Wrist' },
  { key: 'hands',    label: 'Hands' },
  { key: 'waist',    label: 'Waist' },
  { key: 'legs',     label: 'Legs' },
  { key: 'feet',     label: 'Feet' },
  { key: 'finger',   label: 'Rings' },
  { key: 'trinket',  label: 'Trinkets' },
  { key: 'twohand',  label: 'Two Hand' },
  { key: 'mainhand', label: 'Main Hand' },
  { key: 'offhand',  label: 'Off Hand' },
  { key: 'ranged',   label: 'Ranged / Relic' },
];

export const SLOT_LABELS = Object.fromEntries(SLOTS.map((s) => [s.key, s.label]));

export const CLASSES = {
  druid:   { label: 'Druid',   color: '#ff7c0a' },
  hunter:  { label: 'Hunter',  color: '#aad372' },
  mage:    { label: 'Mage',    color: '#3fc7eb' },
  paladin: { label: 'Paladin', color: '#f48cba' },
  priest:  { label: 'Priest',  color: '#ffffff' },
  rogue:   { label: 'Rogue',   color: '#fff468' },
  shaman:  { label: 'Shaman',  color: '#0070dd' },
  warlock: { label: 'Warlock', color: '#8788ee' },
  warrior: { label: 'Warrior', color: '#c69b6d' },
  other:   { label: 'Other',   color: '#c8a24b' },
};

export const QUALITY_COLORS = {
  0: '#9d9d9d', // poor
  1: '#ffffff', // common
  2: '#1eff00', // uncommon
  3: '#0070dd', // rare
  4: '#a335ee', // epic
  5: '#ff8000', // legendary
  6: '#e6cc80', // artifact
  7: '#00ccff', // heirloom
};

// ---- State ------------------------------------------------------------
//
// Shape (schema 2):
//   phases: [{ id, name }]            -- GLOBAL: shared by all characters
//   characters: [{
//     id, name, race, cls,
//     items: { itemId: { id, name, icon, quality, source, fetched, obtained, note } },
//     loadouts: [{
//       id, name,
//       phases:   { phaseId: { slotKey: [itemId] } },
//       enchants: { phaseId: { slotKey: 'enchant text' } },
//     }],
//   }]
//
// Items are stored once per character, so `obtained` and `note` stay in
// sync across every loadout and phase that references the item.
// Enchants are deliberately NOT shared: they belong to a loadout+phase+slot.

const KEY = 'forever-bis/v1';

// Read-only mode (viewing a shared link): all persistence is disabled so the
// visitor's own data is never overwritten.
let readOnly = false;
export function setReadOnly(v) { readOnly = v; }
export function isReadOnly() { return readOnly; }

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function emptySlots() {
  const slots = {};
  for (const s of SLOTS) slots[s.key] = [];
  return slots;
}

export function makeLoadout(name) {
  const lo = { id: uid(), name, phases: {}, enchants: {} };
  for (const p of state.phases) {
    lo.phases[p.id] = emptySlots();
    lo.enchants[p.id] = {};
  }
  return lo;
}

export function makeCharacter({ name, race = '', cls = 'other' }) {
  return { id: uid(), name, race, cls, items: {}, loadouts: [] };
}

function defaultState() {
  return {
    schema: 2,
    phases: [],
    activePhaseId: null,
    characters: [],
    activeCharacterId: null,
    activeLoadoutByChar: {}, // charId -> loadoutId
    hideObtained: false,
  };
}

/** Fold the old ring1/ring2, trinket1/trinket2 keys into finger/trinket. */
function mergeLegacyPairs(map) {
  const fold = (a, b, into) => {
    if (!(a in map) && !(b in map)) return;
    const va = map[a], vb = map[b];
    if (Array.isArray(va) || Array.isArray(vb)) {
      map[into] = [...(Array.isArray(map[into]) ? map[into] : []),
        ...(Array.isArray(va) ? va : []), ...(Array.isArray(vb) ? vb : [])];
    } else if (!(into in map)) {
      map[into] = va ?? vb;
    }
    delete map[a];
    delete map[b];
  };
  fold('ring1', 'ring2', 'finger');
  fold('trinket1', 'trinket2', 'trinket');
}

/**
 * An enchant is either free text (string) or a database-linked pick
 * ({ id, name, q }) that gets a Wowhead tooltip. Returns null for empty.
 */
function normalizeEnchant(v) {
  if (typeof v === 'string') return v.trim() || null;
  if (v && typeof v === 'object' && typeof v.name === 'string' && v.name.trim()) {
    return {
      id: v.id != null ? String(v.id) : null,
      name: v.name.trim(),
      q: typeof v.q === 'number' ? v.q : null,
    };
  }
  return null;
}

function normalize(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.characters)) return defaultState();
  s.phases = Array.isArray(s.phases)
    ? s.phases.filter((p) => p && p.id && p.name).map((p) => ({ id: String(p.id), name: String(p.name) }))
    : [];
  s.activeLoadoutByChar = s.activeLoadoutByChar || {};
  s.hideObtained = Boolean(s.hideObtained);

  // Migrate schema 1 (loadout.slots, per-character game versions) -> schema 2.
  const needsPhase = s.characters.some((c) =>
    (c.loadouts || []).some((lo) => lo && lo.slots));
  if (needsPhase && s.phases.length === 0) {
    s.phases.push({ id: uid(), name: 'Pre Raid' });
  }

  for (const ch of s.characters) {
    ch.items = ch.items && typeof ch.items === 'object' ? ch.items : {};
    delete ch.version;
    for (const it of Object.values(ch.items)) {
      if (typeof it.source !== 'string') it.source = null; // null = never parsed
      it.note = typeof it.note === 'string' ? it.note : '';
      it.obtained = Boolean(it.obtained);
    }
    if (!CLASSES[ch.cls]) ch.cls = 'other';
    ch.loadouts = Array.isArray(ch.loadouts) ? ch.loadouts : [];
    for (const lo of ch.loadouts) {
      lo.phases = lo.phases && typeof lo.phases === 'object' ? lo.phases : {};
      lo.enchants = lo.enchants && typeof lo.enchants === 'object' ? lo.enchants : {};
      if (lo.slots) { // schema 1: move the single slot set into the first phase
        if (s.phases[0]) lo.phases[s.phases[0].id] = lo.slots;
        delete lo.slots;
      }
      const cleanSlots = {};
      const cleanEnchants = {};
      for (const p of s.phases) {
        const src = lo.phases[p.id];
        if (src && typeof src === 'object') mergeLegacyPairs(src);
        const slots = emptySlots();
        for (const sl of SLOTS) {
          const arr = src && Array.isArray(src[sl.key]) ? src[sl.key] : [];
          slots[sl.key] = [...new Set(arr
            .filter((id) => typeof id === 'string' || typeof id === 'number')
            .map(String))];
        }
        cleanSlots[p.id] = slots;
        const esrc = lo.enchants[p.id];
        const m = {};
        if (esrc && typeof esrc === 'object') {
          mergeLegacyPairs(esrc);
          for (const sl of SLOTS) {
            const v = normalizeEnchant(esrc[sl.key]);
            if (v) m[sl.key] = v;
          }
        }
        cleanEnchants[p.id] = m;
      }
      lo.phases = cleanSlots;
      lo.enchants = cleanEnchants;
    }
  }

  if (!s.characters.some((c) => c.id === s.activeCharacterId)) {
    s.activeCharacterId = s.characters[0]?.id ?? null;
  }
  if (!s.phases.some((p) => p.id === s.activePhaseId)) {
    s.activePhaseId = s.phases[0]?.id ?? null;
  }
  s.schema = 2;
  return s;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return normalize(raw ? JSON.parse(raw) : null);
  } catch (e) {
    console.error('Failed to load saved data', e);
    return defaultState();
  }
}

const saveListeners = new Set();
/** Register a callback that runs after every successful save (e.g. auto-sync). */
export function onSave(fn) {
  saveListeners.add(fn);
}

export const state = load();
// Persist immediately so migrations (schema upgrades) are written back.
save();

export function save() {
  if (readOnly) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save', e);
    return;
  }
  for (const fn of saveListeners) {
    try { fn(); } catch { /* listener errors must not break saves */ }
  }
}

export function replaceState(next) {
  const clean = normalize(next);
  Object.keys(state).forEach((k) => delete state[k]);
  Object.assign(state, clean);
  save();
}

/** Deep snapshot of the current state, for undo. */
export function snapshot() {
  return structuredClone(state);
}

// ---- Selectors ----------------------------------------------------------

export function activeCharacter() {
  return state.characters.find((c) => c.id === state.activeCharacterId) ?? null;
}

export function activeLoadout(ch = activeCharacter()) {
  if (!ch) return null;
  const id = state.activeLoadoutByChar[ch.id];
  return ch.loadouts.find((l) => l.id === id) ?? ch.loadouts[0] ?? null;
}

export function activePhase() {
  return state.phases.find((p) => p.id === state.activePhaseId) ?? state.phases[0] ?? null;
}

export function setActiveLoadout(ch, loadoutId) {
  state.activeLoadoutByChar[ch.id] = loadoutId;
  save();
}

export function setActivePhase(phaseId) {
  state.activePhaseId = phaseId;
  save();
}

/** Slot map of a loadout for a phase (always defined after normalize/addPhase). */
export function slotsOf(loadout, phase) {
  return loadout.phases[phase.id] ?? (loadout.phases[phase.id] = emptySlots());
}

export function enchantsOf(loadout, phase) {
  return loadout.enchants[phase.id] ?? (loadout.enchants[phase.id] = {});
}

// ---- Phase mutations (global: apply to all loadouts on all characters) ---

export function addPhase(name) {
  const p = { id: uid(), name };
  state.phases.push(p);
  for (const ch of state.characters) {
    for (const lo of ch.loadouts) {
      lo.phases[p.id] = emptySlots();
      lo.enchants[p.id] = {};
    }
  }
  state.activePhaseId = p.id;
  save();
  return p;
}

export function renamePhase(phase, name) {
  phase.name = name;
  save();
}

export function deletePhase(phase) {
  state.phases = state.phases.filter((p) => p.id !== phase.id);
  for (const ch of state.characters) {
    for (const lo of ch.loadouts) {
      delete lo.phases[phase.id];
      delete lo.enchants[phase.id];
    }
  }
  if (state.activePhaseId === phase.id) {
    state.activePhaseId = state.phases[0]?.id ?? null;
  }
  save();
}

/**
 * Merge goals (and enchants, where the target has none) from one phase into
 * another. `loadoutId` limits the copy to one loadout of `ch`; null = all.
 */
export function copyPhaseGoals(ch, fromPhase, toPhase, loadoutId = null) {
  for (const lo of ch.loadouts) {
    if (loadoutId && lo.id !== loadoutId) continue;
    const from = slotsOf(lo, fromPhase);
    const to = slotsOf(lo, toPhase);
    for (const s of SLOTS) {
      for (const id of from[s.key]) {
        if (!to[s.key].includes(id)) to[s.key].push(id);
      }
    }
    const fromE = enchantsOf(lo, fromPhase);
    const toE = enchantsOf(lo, toPhase);
    for (const k of Object.keys(fromE)) {
      if (!toE[k]) toE[k] = fromE[k];
    }
  }
  save();
}

// ---- Loadout mutations ----------------------------------------------------

export function duplicateLoadout(ch, lo) {
  const copy = structuredClone(lo);
  copy.id = uid();
  copy.name = `${lo.name} (copy)`;
  ch.loadouts.splice(ch.loadouts.indexOf(lo) + 1, 0, copy);
  save();
  return copy;
}

/** `value` is free text (string) or a database pick ({ id, name, q }). */
export function setEnchant(loadout, phase, slotKey, value) {
  const m = enchantsOf(loadout, phase);
  const v = normalizeEnchant(value);
  if (v) m[slotKey] = v;
  else delete m[slotKey];
  save();
}

// ---- Item mutations ------------------------------------------------------

/** Add an item to a slot of a loadout+phase, creating/updating the shared store entry. */
export function addItemToSlot(ch, loadout, phase, slotKey, item) {
  const id = String(item.id);
  const existing = ch.items[id];
  ch.items[id] = {
    id,
    name: item.name ?? existing?.name ?? `Item ${id}`,
    icon: item.icon ?? existing?.icon ?? null,
    quality: item.quality ?? existing?.quality ?? null,
    source: typeof item.source === 'string' ? item.source : (existing?.source ?? null),
    fetched: Boolean(item.fetched || existing?.fetched),
    obtained: existing?.obtained ?? false,
    note: existing?.note ?? '',
  };
  const slots = slotsOf(loadout, phase);
  if (!slots[slotKey].includes(id)) slots[slotKey].push(id);
  save();
  return ch.items[id];
}

function itemReferenced(ch, itemId) {
  return ch.loadouts.some((lo) =>
    Object.values(lo.phases).some((slots) =>
      Object.values(slots).some((arr) => arr.includes(itemId))));
}

export function removeItemFromSlot(ch, loadout, phase, slotKey, itemId) {
  const slots = slotsOf(loadout, phase);
  slots[slotKey] = slots[slotKey].filter((id) => id !== itemId);
  // Garbage-collect the shared entry only if nothing references it anywhere
  // and it holds no user data (note / obtained flag).
  const entry = ch.items[itemId];
  if (entry && !entry.note && !entry.obtained && !itemReferenced(ch, itemId)) {
    delete ch.items[itemId];
  }
  save();
}

export function moveItemInSlot(loadout, phase, slotKey, itemId, delta) {
  const arr = slotsOf(loadout, phase)[slotKey];
  const i = arr.indexOf(itemId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  save();
}

/**
 * Labels of other places (loadout · phase) on this character that reference
 * the item, excluding the given loadout+phase.
 */
export function placesUsingItem(ch, itemId, exceptLoadoutId, exceptPhaseId) {
  const out = [];
  for (const lo of ch.loadouts) {
    for (const p of state.phases) {
      if (lo.id === exceptLoadoutId && p.id === exceptPhaseId) continue;
      const slots = lo.phases[p.id];
      if (slots && Object.values(slots).some((arr) => arr.includes(itemId))) {
        out.push(`${lo.name} · ${p.name}`);
      }
    }
  }
  return out;
}

// ---- Aggregations ----------------------------------------------------------

// How many of a slot's items are worn at once: a worse-ranked item is only
// superseded once this many better-ranked ones are obtained.
const SLOT_CAPACITY = { finger: 2, trinket: 2 };

/**
 * Items of a character still worth chasing for a phase, across all loadouts
 * (or one), annotated with the slots and loadouts that want them.
 *
 * Slot lists are priority-ordered (top = BIS), so an unobtained item only
 * counts as needed while fewer than the slot's capacity of better-ranked
 * items are obtained — once you have Helm 2, Helms 3 and 4 are superseded
 * and drop out, while Helm 1 remains an upgrade.
 *
 * Returns [{ item, slots: [label], loadouts: [name] }].
 */
export function neededItems(ch, phase, loadoutId = null) {
  const map = new Map();
  for (const lo of ch.loadouts) {
    if (loadoutId && lo.id !== loadoutId) continue;
    const slots = lo.phases[phase.id];
    if (!slots) continue;
    for (const s of SLOTS) {
      const capacity = SLOT_CAPACITY[s.key] ?? 1;
      let obtainedAbove = 0;
      for (const id of slots[s.key]) {
        const item = ch.items[id];
        if (!item) continue;
        if (item.obtained) { obtainedAbove++; continue; }
        if (obtainedAbove >= capacity) continue; // superseded by better items you have
        let entry = map.get(id);
        if (!entry) {
          entry = { item, slots: new Set(), loadouts: new Set() };
          map.set(id, entry);
        }
        entry.slots.add(s.label);
        entry.loadouts.add(lo.name);
      }
    }
  }
  return [...map.values()].map((e) => ({
    item: e.item, slots: [...e.slots], loadouts: [...e.loadouts],
  }));
}

/** Progress of a character for a phase across all loadouts: { got, total }. */
export function phaseProgress(ch, phase) {
  const ids = new Set();
  for (const lo of ch.loadouts) {
    const slots = lo.phases[phase.id];
    if (!slots) continue;
    for (const arr of Object.values(slots)) for (const id of arr) ids.add(id);
  }
  let got = 0;
  for (const id of ids) if (ch.items[id]?.obtained) got++;
  return { got, total: ids.size };
}
