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
  { key: 'ring1',    label: 'Ring 1' },
  { key: 'ring2',    label: 'Ring 2' },
  { key: 'trinket1', label: 'Trinket 1' },
  { key: 'trinket2', label: 'Trinket 2' },
  { key: 'mainhand', label: 'Main Hand' },
  { key: 'offhand',  label: 'Off Hand' },
  { key: 'ranged',   label: 'Ranged / Relic' },
];

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
//     items: { itemId: { id, name, icon, quality, fetched, obtained, note } },
//     loadouts: [{ id, name, phases: { phaseId: { slotKey: [itemId] } } }],
//   }]
//
// Items are stored once per character, so `obtained` and `note` stay in
// sync across every loadout and phase that references the item.

const KEY = 'forever-bis/v1';

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function emptySlots() {
  const slots = {};
  for (const s of SLOTS) slots[s.key] = [];
  return slots;
}

export function makeLoadout(name) {
  const lo = { id: uid(), name, phases: {} };
  for (const p of state.phases) lo.phases[p.id] = emptySlots();
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
  };
}

function normalize(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.characters)) return defaultState();
  s.phases = Array.isArray(s.phases)
    ? s.phases.filter((p) => p && p.id && p.name).map((p) => ({ id: String(p.id), name: String(p.name) }))
    : [];
  s.activeLoadoutByChar = s.activeLoadoutByChar || {};

  // Migrate schema 1 (loadout.slots, per-character game versions) -> schema 2.
  const needsPhase = s.characters.some((c) =>
    (c.loadouts || []).some((lo) => lo && lo.slots));
  if (needsPhase && s.phases.length === 0) {
    s.phases.push({ id: uid(), name: 'Pre Raid' });
  }

  for (const ch of s.characters) {
    ch.items = ch.items && typeof ch.items === 'object' ? ch.items : {};
    delete ch.version;
    if (!CLASSES[ch.cls]) ch.cls = 'other';
    ch.loadouts = Array.isArray(ch.loadouts) ? ch.loadouts : [];
    for (const lo of ch.loadouts) {
      lo.phases = lo.phases && typeof lo.phases === 'object' ? lo.phases : {};
      if (lo.slots) { // schema 1: move the single slot set into the first phase
        if (s.phases[0]) lo.phases[s.phases[0].id] = lo.slots;
        delete lo.slots;
      }
      const clean = {};
      for (const p of s.phases) {
        const src = lo.phases[p.id];
        const slots = emptySlots();
        for (const sl of SLOTS) {
          const arr = src && Array.isArray(src[sl.key]) ? src[sl.key] : [];
          slots[sl.key] = arr
            .filter((id) => typeof id === 'string' || typeof id === 'number')
            .map(String);
        }
        clean[p.id] = slots;
      }
      lo.phases = clean;
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

export const state = load();
// Persist immediately so migrations (schema upgrades) are written back.
save();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save', e);
  }
}

export function replaceState(next) {
  const clean = normalize(next);
  Object.keys(state).forEach((k) => delete state[k]);
  Object.assign(state, clean);
  save();
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

// ---- Phase mutations (global: apply to all loadouts on all characters) ---

export function addPhase(name) {
  const p = { id: uid(), name };
  state.phases.push(p);
  for (const ch of state.characters) {
    for (const lo of ch.loadouts) lo.phases[p.id] = emptySlots();
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
    for (const lo of ch.loadouts) delete lo.phases[phase.id];
  }
  if (state.activePhaseId === phase.id) {
    state.activePhaseId = state.phases[0]?.id ?? null;
  }
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
