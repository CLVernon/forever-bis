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

export const GAME_VERSIONS = {
  forever:  { label: 'WoW: Forever',            path: 'forever' },
  classic:  { label: 'Classic Era / Anniversary', path: 'classic' },
  mop:      { label: 'Mists of Pandaria Classic', path: 'mop-classic' },
  retail:   { label: 'Retail',                  path: '' },
};

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
  return { id: uid(), name, slots: emptySlots() };
}

export function makeCharacter({ name, race = '', cls = 'other', version = 'forever' }) {
  return {
    id: uid(),
    name,
    race,
    cls,
    version,
    // Shared item store: keyed by itemId. `obtained` and `note` live here,
    // so every loadout that references the item sees the same values.
    items: {},
    loadouts: [],
  };
}

function defaultState() {
  return {
    schema: 1,
    characters: [],
    activeCharacterId: null,
    activeLoadoutByChar: {}, // charId -> loadoutId
  };
}

function normalize(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.characters)) return defaultState();
  state.schema = 1;
  state.activeLoadoutByChar = state.activeLoadoutByChar || {};
  for (const ch of state.characters) {
    ch.items = ch.items || {};
    ch.loadouts = Array.isArray(ch.loadouts) ? ch.loadouts : [];
    if (!GAME_VERSIONS[ch.version]) ch.version = 'forever';
    if (!CLASSES[ch.cls]) ch.cls = 'other';
    for (const lo of ch.loadouts) {
      const slots = emptySlots();
      for (const s of SLOTS) {
        const arr = lo.slots && Array.isArray(lo.slots[s.key]) ? lo.slots[s.key] : [];
        slots[s.key] = arr.filter((id) => typeof id === 'string' || typeof id === 'number').map(String);
      }
      lo.slots = slots;
    }
  }
  if (!state.characters.some((c) => c.id === state.activeCharacterId)) {
    state.activeCharacterId = state.characters[0]?.id ?? null;
  }
  return state;
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

// ---- Selectors / mutations --------------------------------------------

export function activeCharacter() {
  return state.characters.find((c) => c.id === state.activeCharacterId) ?? null;
}

export function activeLoadout(ch = activeCharacter()) {
  if (!ch) return null;
  const id = state.activeLoadoutByChar[ch.id];
  return ch.loadouts.find((l) => l.id === id) ?? ch.loadouts[0] ?? null;
}

export function setActiveLoadout(ch, loadoutId) {
  state.activeLoadoutByChar[ch.id] = loadoutId;
  save();
}

/** Add an item to a slot of a loadout, creating/updating the shared store entry. */
export function addItemToSlot(ch, loadout, slotKey, item) {
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
  if (!loadout.slots[slotKey].includes(id)) {
    loadout.slots[slotKey].push(id);
  }
  save();
  return ch.items[id];
}

export function removeItemFromSlot(ch, loadout, slotKey, itemId) {
  loadout.slots[slotKey] = loadout.slots[slotKey].filter((id) => id !== itemId);
  // Garbage-collect the shared entry only if nothing references it and it
  // holds no user data (note / obtained flag).
  const referenced = ch.loadouts.some((lo) =>
    Object.values(lo.slots).some((arr) => arr.includes(itemId)));
  const entry = ch.items[itemId];
  if (!referenced && entry && !entry.note && !entry.obtained) {
    delete ch.items[itemId];
  }
  save();
}

export function moveItemInSlot(loadout, slotKey, itemId, delta) {
  const arr = loadout.slots[slotKey];
  const i = arr.indexOf(itemId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  save();
}

/** Names of loadouts (other than `except`) that reference the item. */
export function loadoutsUsingItem(ch, itemId, exceptLoadoutId) {
  return ch.loadouts
    .filter((lo) => lo.id !== exceptLoadoutId &&
      Object.values(lo.slots).some((arr) => arr.includes(itemId)))
    .map((lo) => lo.name);
}
