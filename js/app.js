import {
  SLOTS, CLASSES, QUALITY_COLORS,
  state, save, load, replaceState, snapshot, uid, onSave,
  setReadOnly, isReadOnly,
  makeCharacter, makeLoadout,
  activeCharacter, activeLoadout, activePhase,
  setActiveLoadout, setActivePhase, slotsOf, enchantsOf,
  addPhase, renamePhase, deletePhase, copyPhaseGoals,
  duplicateLoadout, setEnchant,
  addItemToSlot, removeItemFromSlot, moveItemInSlot, placesUsingItem,
  neededItems, phaseProgress,
} from './store.js';

import {
  itemUrl, searchUrl, iconUrl, fetchItem, parseItemInput,
} from './wowhead.js';

import {
  loadItemDb, searchItemDb, itemDbGet, itemDbReady, itemFitsSlot,
  loadSources, sourcesFor, sourcesReady,
  searchEnchants, hasEnchantCatalog,
} from './itemdb.js';

import { encodeShare, decodeShare } from './share.js';

import {
  syncConfig, saveSyncConfig, disconnectSync, hashString,
  findGist, fetchGistData, fetchGistMeta, createGist, updateGist,
} from './sync.js';

const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function qColor(quality) {
  return QUALITY_COLORS[quality] ?? '#d8d4cb';
}

// UI-only state (survives re-render, not reloads).
const openNotes = new Set();
const openEnchants = new Set();
let view = 'slots'; // slots | needed | overview
let neededAllLoadouts = true;
let sourcesFailed = false; // planner data unavailable -> flat grouping fallback

// ---- Rendering ----------------------------------------------------------

function renderAll() {
  renderTopbar();
  renderMain();
  refreshTooltips();
}

function renderTopbar() {
  const ro = isReadOnly();
  const sel = $('#charSelect');
  sel.innerHTML = state.characters.map((c) =>
    `<option value="${c.id}" ${c.id === state.activeCharacterId ? 'selected' : ''}>${esc(c.name)}</option>`
  ).join('');
  const hasChar = state.characters.length > 0;
  sel.hidden = !hasChar || ro;
  $('#newCharBtn').hidden = ro;
  $('#menuBtn').hidden = ro;
  $('[data-menu="edit-char"]').disabled = !hasChar;
  $('[data-menu="delete-char"]').disabled = !hasChar;
  $('[data-menu="share"]').disabled = !hasChar;
}

function renderMain() {
  const ro = isReadOnly();
  const ch = activeCharacter();

  const banner = ro ? `
    <div class="share-banner">
      <span>👁 Viewing a shared character — read-only.</span>
      <span class="share-banner-actions">
        <button class="btn" data-action="save-shared-copy">Save a copy to my tracker</button>
        <button class="btn btn-ghost" data-action="exit-share">Open my own tracker</button>
      </span>
    </div>` : '';

  if (!ch) {
    app.innerHTML = banner + `
      <section class="welcome">
        <h2>Track your Best-in-Slot goals</h2>
        <p>Create a character, set up loadouts (specs) and phases (e.g. Pre Raid,
           Tier 1), and add goal items to each equipment slot. Mark items obtained
           and keep notes on how to get them — shared items stay in sync across
           all loadouts and phases.</p>
        <button class="btn btn-primary btn-lg" data-action="new-char">Create your first character</button>
      </section>`;
    return;
  }

  if (view === 'overview') {
    app.innerHTML = banner + viewSwitchHtml() + overviewHtml();
    return;
  }

  const lo = activeLoadout(ch);
  const ph = activePhase();
  const cls = CLASSES[ch.cls];

  const phaseTabs = state.phases.map((p) => `
    <button class="tab ${ph && p.id === ph.id ? 'active' : ''}" data-action="pick-phase" data-id="${p.id}">
      ${esc(p.name)}
    </button>`).join('');

  const loadoutTabs = ch.loadouts.map((l) => `
    <button class="tab ${lo && l.id === lo.id ? 'active' : ''}" data-action="pick-loadout" data-id="${l.id}">
      ${esc(l.name)}
    </button>`).join('');

  let body;
  if (!lo) {
    body = `
      <section class="welcome">
        <p>No loadouts yet. A loadout is a goal set for one spec or purpose —
           e.g. <em>Enhancement</em>, <em>Elemental</em>, <em>Restoration</em>.</p>
        ${ro ? '' : '<button class="btn btn-primary" data-action="new-loadout">Create a loadout</button>'}
      </section>`;
  } else if (!ph) {
    body = `
      <section class="welcome">
        <p>No phases yet. A phase is a stage of gearing — e.g. <em>Pre Raid</em>,
           <em>Tier 1</em>. Phases are shared by every loadout on every character.</p>
        ${ro ? '' : '<button class="btn btn-primary" data-action="new-phase">Create a phase</button>'}
      </section>`;
  } else if (view === 'needed') {
    body = neededHtml(ch, lo, ph);
  } else {
    body = slotsHtml(ch, lo, ph);
  }

  app.innerHTML = banner + `
    <section class="char-head">
      <div class="char-id">
        <h2 style="color:${cls.color}">${esc(ch.name)}</h2>
        <span class="char-sub">${esc([ch.race, cls.label !== 'Other' ? cls.label : ''].filter(Boolean).join(' '))}</span>
      </div>
      ${lo && ph ? progressHtml(ch, lo, ph) : ''}
    </section>

    ${viewSwitchHtml()}

    <nav class="tabs tabs-phases">
      <span class="tabs-label">Phase</span>
      ${phaseTabs}
      ${ro ? '' : `<button class="tab tab-add" data-action="new-phase" title="Add a phase (added to all loadouts on all characters)">+ Phase</button>`}
      ${ph && !ro ? `
        <span class="tab-tools">
          <button class="icon-btn" data-action="copy-phase" title="Copy goals from another phase into ${esc(ph.name)}">⧉</button>
          <button class="icon-btn" data-action="rename-phase" title="Rename phase">✎</button>
          <button class="icon-btn danger" data-action="delete-phase" title="Delete phase">🗑</button>
        </span>` : ''}
    </nav>

    <nav class="tabs">
      <span class="tabs-label">Loadout</span>
      ${loadoutTabs}
      ${ro ? '' : `<button class="tab tab-add" data-action="new-loadout" title="Add loadout">+ Loadout</button>`}
      ${lo && !ro ? `
        <span class="tab-tools">
          <button class="icon-btn" data-action="duplicate-loadout" title="Duplicate loadout">⧉</button>
          <button class="icon-btn" data-action="rename-loadout" title="Rename loadout">✎</button>
          <button class="icon-btn danger" data-action="delete-loadout" title="Delete loadout">🗑</button>
        </span>` : ''}
    </nav>

    ${body}
  `;
}

function viewSwitchHtml() {
  const btn = (id, label) =>
    `<button class="view-btn ${view === id ? 'active' : ''}" data-action="set-view" data-id="${id}">${label}</button>`;
  return `
    <div class="view-switch">
      ${btn('slots', 'Gear slots')}
      ${btn('needed', 'Planner')}
      ${btn('overview', 'All characters')}
      ${view === 'slots' ? `
        <label class="hide-obtained" title="Hide obtained items in the slot lists">
          <input type="checkbox" data-action="toggle-hide-obtained" ${state.hideObtained ? 'checked' : ''}>
          Hide obtained
        </label>` : ''}
    </div>`;
}

function progressHtml(ch, lo, ph) {
  const slots = slotsOf(lo, ph);
  const ids = new Set(Object.values(slots).flat());
  const total = ids.size;
  let got = 0;
  for (const id of ids) if (ch.items[id]?.obtained) got++;
  const filledSlots = SLOTS.filter((s) => slots[s.key].length > 0);
  const doneSlots = filledSlots.filter((s) => slots[s.key].some((id) => ch.items[id]?.obtained));
  const pct = total ? Math.round((got / total) * 100) : 0;
  return `
    <div class="progress">
      <div class="progress-nums">
        <span><b>${got}</b>/${total} items obtained</span>
        <span><b>${doneSlots.length}</b>/${filledSlots.length} slots covered</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>`;
}

// ---- Gear slots view ------------------------------------------------------

function slotsHtml(ch, lo, ph) {
  const ro = isReadOnly();
  const slots = slotsOf(lo, ph);
  const enchants = enchantsOf(lo, ph);
  const cards = SLOTS.map((s) => {
    const all = slots[s.key];
    const shown = state.hideObtained && !ro
      ? all.filter((id) => !ch.items[id]?.obtained)
      : all;
    const items = shown.map((id) =>
      itemRowHtml(ch, lo, ph, s.key, id, all.indexOf(id), all.length)).join('');
    const hiddenCount = all.length - shown.length;
    const empty = all.length === 0
      ? '<p class="slot-empty">No goals yet</p>'
      : (shown.length === 0 ? `<p class="slot-empty">All ${all.length} obtained ✓</p>` : '');
    return `
      <article class="slot-card ${all.some((id) => ch.items[id]?.obtained) ? 'slot-done' : ''}">
        <header class="slot-head">
          <h3>${s.label}</h3>
          ${ro ? '' : `<button class="icon-btn add" data-action="add-item" data-slot="${s.key}" title="Add goal item to ${s.label}">+</button>`}
        </header>
        ${items}${empty}
        ${hiddenCount > 0 && shown.length > 0 ? `<p class="slot-empty">+ ${hiddenCount} obtained hidden</p>` : ''}
        ${enchantHtml(lo, ph, s.key, enchants[s.key])}
      </article>`;
  }).join('');
  return `<section class="slots">${cards}</section>`;
}

function enchantHtml(lo, ph, slotKey, ench) {
  const ro = isReadOnly();
  const editing = openEnchants.has(`${lo.id}/${ph.id}/${slotKey}`);
  const display = typeof ench === 'string' ? ench : ench?.name ?? '';
  if (editing && !ro) {
    return `
      <div class="enchant-line editing">
        <span class="enchant-star">✦</span>
        <input class="enchant-input" data-action="edit-enchant" data-slot="${slotKey}"
          data-initial="${esc(display)}"
          value="${esc(display)}" placeholder="${hasEnchantCatalog(slotKey) ? 'Pick an enchant, or type your own' : 'Enchant — free text'}" maxlength="80">
        <div class="enchant-sugs" data-slot="${slotKey}"></div>
      </div>`;
  }
  if (display) {
    const linked = typeof ench === 'object' && ench.id;
    const label = linked
      ? `<a class="enchant-text" href="${itemUrl(ench.id)}" target="_blank" rel="noopener"
           data-wh-icon-size="small" style="color:${qColor(ench.q)}">${esc(display)}</a>`
      : `<span class="enchant-text">${esc(display)}</span>`;
    return `
      <div class="enchant-line">
        <span class="enchant-star">✦</span>
        ${label}
        ${ro ? '' : `<button class="icon-btn" data-action="toggle-enchant" data-slot="${slotKey}" title="Edit enchant">✎</button>`}
      </div>`;
  }
  return ro ? '' : `
    <button class="enchant-add" data-action="toggle-enchant" data-slot="${slotKey}">+ enchant</button>`;
}

/** Fill the suggestion list under an enchant input from the item database. */
function updateEnchantSugs(input) {
  const box = input.parentElement.querySelector('.enchant-sugs');
  if (!box) return;
  const slotKey = input.dataset.slot;
  if (!hasEnchantCatalog(slotKey)) { box.innerHTML = ''; return; }
  if (!itemDbReady()) {
    box.innerHTML = '<span class="hint">Loading enchant list…</span>';
    loadItemDb().then(() => {
      if (document.contains(input)) updateEnchantSugs(input);
    }).catch(() => { box.innerHTML = ''; });
    return;
  }
  const results = searchEnchants(slotKey, input.value);
  box.innerHTML = results.slice(0, 10).map((r) => `
    <button type="button" class="search-result enchant-sug" data-ench-id="${r.id}"
      data-ench-name="${esc(r.name)}" data-ench-q="${r.q ?? ''}" data-slot="${slotKey}">
      <span class="sr-main"><span style="color:${qColor(r.q)}">${esc(r.name)}</span></span>
      ${r.src ? `<span class="sr-src">${esc(r.src)}</span>` : ''}
    </button>`).join('');
}

function itemRowHtml(ch, lo, ph, slotKey, itemId, index, count) {
  const ro = isReadOnly();
  const item = ch.items[itemId] ?? { id: itemId, name: `Item ${itemId}`, quality: null, icon: null };
  const elsewhere = placesUsingItem(ch, itemId, lo.id, ph.id);
  const noteOpen = openNotes.has(`${lo.id}/${ph.id}/${slotKey}/${itemId}`);
  const key = `data-slot="${slotKey}" data-item="${itemId}"`;
  const canRefresh = !ro && (!item.fetched || item.source == null);
  return `
  <div class="item-row ${item.obtained ? 'obtained' : ''}">
    <div class="item-main">
      <label class="obtain" title="${item.obtained ? 'Obtained — click to unmark' : 'Mark as obtained'}">
        <input type="checkbox" data-action="toggle-obtained" ${key} ${item.obtained ? 'checked' : ''} ${ro ? 'disabled' : ''}>
        <span class="obtain-box"></span>
      </label>
      <a class="item-link" href="${itemUrl(itemId)}" target="_blank" rel="noopener"
         data-wh-icon-size="medium">
        <img class="item-icon" src="${iconUrl(item.icon)}" alt="" loading="lazy">
        <span class="item-name" style="color:${qColor(item.quality)}">${esc(item.name)}</span>
      </a>
      ${index === 0 && count > 1 ? '<span class="bis-chip" title="Top priority for this slot">BIS</span>' : ''}
      ${elsewhere.length ? `<span class="sync-chip" title="Also in: ${esc(elsewhere.join(', '))} — obtained status and notes are shared">⇄ ${elsewhere.length}</span>` : ''}
      ${ro ? '' : `
      <span class="item-tools">
        ${canRefresh ? `<button class="icon-btn" data-action="refresh-item" ${key} title="Fetch item details from Wowhead">↻</button>` : ''}
        <button class="icon-btn ${item.note ? 'has-note' : ''}" data-action="toggle-note" ${key} title="${item.note ? 'Edit note' : 'Add note'}">🗒</button>
        <button class="icon-btn" data-action="move-up" ${key} title="Move up" ${index === 0 ? 'disabled' : ''}>▲</button>
        <button class="icon-btn" data-action="move-down" ${key} title="Move down" ${index === count - 1 ? 'disabled' : ''}>▼</button>
        <button class="icon-btn danger" data-action="remove-item" ${key} title="Remove from this slot">✕</button>
      </span>`}
    </div>
    ${item.source ? `<div class="item-source">${esc(item.source)}</div>` : ''}
    ${ro && item.note ? `<div class="item-source note-static">🗒 ${esc(item.note)}</div>` : ''}
    ${noteOpen && !ro ? `
      <div class="note-wrap">
        <textarea class="note" data-action="edit-note" ${key} rows="2"
          placeholder="How to obtain — boss, quest, cost, drop rate…">${esc(item.note)}</textarea>
        <span class="hint">Notes are shared wherever this item appears.</span>
      </div>` : ''}
  </div>`;
}

// ---- Still-needed view ------------------------------------------------------

function neededItemRowHtml(entry, chanceLabel) {
  const ro = isReadOnly();
  const { item, slots, loadouts } = entry;
  return `
    <div class="item-row needed-row">
      <div class="item-main">
        <label class="obtain" title="Mark as obtained">
          <input type="checkbox" data-action="toggle-obtained" data-item="${item.id}" ${ro ? 'disabled' : ''}>
          <span class="obtain-box"></span>
        </label>
        <a class="item-link" href="${itemUrl(item.id)}" target="_blank" rel="noopener" data-wh-icon-size="medium">
          <img class="item-icon" src="${iconUrl(item.icon)}" alt="" loading="lazy">
          <span class="item-name" style="color:${qColor(item.quality)}">${esc(item.name)}</span>
        </a>
        ${chanceLabel ? `<span class="chance-chip">${esc(chanceLabel)}</span>` : ''}
        <span class="needed-meta">${esc(slots.join(', '))}${neededAllLoadouts ? ` — ${esc(loadouts.join(', '))}` : ''}</span>
      </div>
      ${item.note ? `<div class="item-source note-static">🗒 ${esc(item.note)}</div>` : ''}
    </div>`;
}

/**
 * Group needed entries for the planner: dungeon/raid/zone sections with the
 * boss (or quest/vendor/recipe) nested inside, so one glance answers "which
 * instance gives me the most upgrades?".
 */
function plannerGroups(entries) {
  const groups = new Map(); // title -> { title, itemIds:Set, subs: Map<label, [{entry, chance, more}]> }
  const put = (title, sub, entry, chance = null, more = 0) => {
    let g = groups.get(title);
    if (!g) groups.set(title, (g = { title, itemIds: new Set(), subs: new Map() }));
    g.itemIds.add(entry.item.id);
    let rows = g.subs.get(sub);
    if (!rows) g.subs.set(sub, (rows = []));
    rows.push({ entry, chance, more });
  };

  for (const entry of entries) {
    const srcs = sourcesFor(entry.item.id);
    if (!srcs.length) {
      put('Other / unknown', entry.item.source || 'Unknown source', entry);
      continue;
    }
    const byKind = {};
    for (const s of srcs) (byKind[s.kind] ??= []).push(s);

    // Drops: one row per zone, under the best-chance dropper, with a
    // "+N more" hint when several bosses/mobs in the zone drop it.
    const byZone = new Map();
    for (const s of byKind.drop ?? []) {
      const z = s.zone || 'World drops';
      const cur = byZone.get(z);
      if (!cur) byZone.set(z, { best: s, count: 1 });
      else {
        cur.count++;
        if ((s.chance ?? 0) > (cur.best.chance ?? 0)) cur.best = s;
      }
    }
    for (const [zone, { best, count }] of byZone) {
      const sub = best.name + (best.extra && !/creatures/.test(best.extra) ? ` (${best.extra})` : '');
      put(zone, sub, entry, best.chance, count - 1);
    }
    for (const s of (byKind.object ?? []).slice(0, 3)) {
      put(s.zone || 'Chests & gathering', `${s.name} (chest/object)`, entry, s.chance);
    }
    for (const s of (byKind.container ?? []).slice(0, 2)) {
      put('Containers', s.name, entry, s.chance);
    }
    for (const s of byKind.quest ?? []) {
      put('Quests', `${s.name}${s.zone ? ` — ${s.zone}` : ''}${s.extra ? ` (${s.extra})` : ''}`, entry);
    }
    for (const s of byKind.crafted ?? []) {
      put('Crafted', s.name, entry);
    }
    const vendors = byKind.vendor ?? [];
    if (vendors.length > 2) {
      put('Vendors', `${vendors.length} vendors`, entry);
    } else {
      for (const s of vendors) {
        put('Vendors', `${s.name}${s.zone ? ` — ${s.zone}` : ''}`, entry);
      }
    }
  }

  const SINK = ['Vendors', 'Containers', 'Other / unknown'];
  return [...groups.values()].sort((a, b) => {
    const sa = SINK.indexOf(a.title), sb = SINK.indexOf(b.title);
    if ((sa !== -1) !== (sb !== -1)) return sa !== -1 ? 1 : -1;
    return b.itemIds.size - a.itemIds.size || a.title.localeCompare(b.title);
  });
}

function neededHtml(ch, lo, ph) {
  const scopeLoadout = neededAllLoadouts ? null : lo.id;
  const entries = neededItems(ch, ph, scopeLoadout);

  const scopeToggle = `
    <label class="hide-obtained">
      <input type="checkbox" data-action="toggle-needed-scope" ${neededAllLoadouts ? 'checked' : ''}>
      All loadouts (not just ${esc(lo.name)})
    </label>`;

  if (entries.length === 0) {
    return `
      <section class="needed">
        <div class="needed-head"><h3>Nothing left to get in ${esc(ph.name)} 🎉</h3>${scopeToggle}</div>
        <p class="hint">Every goal item ${neededAllLoadouts ? 'across all loadouts' : `in ${esc(lo.name)}`} is either obtained or no goals are set.</p>
      </section>`;
  }

  // The planner needs the source index; load it lazily on first open.
  if (!sourcesReady() && !sourcesFailed) {
    loadSources().then(() => renderAll(), () => { sourcesFailed = true; renderAll(); });
    return `
      <section class="needed">
        <div class="needed-head"><h3>${entries.length} item${entries.length === 1 ? '' : 's'} still needed — ${esc(ph.name)}</h3>${scopeToggle}</div>
        <p class="hint">Loading planner data…</p>
      </section>`;
  }

  let groupHtml;
  if (sourcesFailed) {
    // Fallback: flat grouping by the stored source line.
    const flat = new Map();
    for (const e of entries) {
      const key = e.item.source || 'Unknown source';
      if (!flat.has(key)) flat.set(key, []);
      flat.get(key).push(e);
    }
    groupHtml = [...flat.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([source, list]) => `
      <article class="needed-group">
        <h4 class="needed-source">${esc(source)} <span class="hint">(${list.length})</span></h4>
        ${list.map((e) => neededItemRowHtml(e)).join('')}
      </article>`).join('');
  } else {
    groupHtml = plannerGroups(entries).map((g) => `
      <article class="needed-group">
        <h4 class="needed-source">${esc(g.title)}
          <span class="upgrade-chip">${g.itemIds.size} upgrade${g.itemIds.size === 1 ? '' : 's'}</span>
        </h4>
        ${[...g.subs.entries()]
          .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
          .map(([sub, rows]) => `
          <div class="planner-sub">
            <h5>${esc(sub)}</h5>
            ${rows.map(({ entry, chance, more }) => {
              const bits = [];
              if (chance != null) bits.push(`${chance}%`);
              if (more) bits.push(`+${more} more`);
              return neededItemRowHtml(entry, bits.join(' · '));
            }).join('')}
          </div>`).join('')}
      </article>`).join('');
  }

  return `
    <section class="needed">
      <div class="needed-head">
        <h3>${entries.length} item${entries.length === 1 ? '' : 's'} still needed — ${esc(ph.name)}</h3>
        ${scopeToggle}
      </div>
      ${groupHtml}
    </section>`;
}

// ---- Overview view ----------------------------------------------------------

function overviewHtml() {
  if (state.characters.length === 0) {
    return '<section class="welcome"><p>No characters yet.</p></section>';
  }
  const cards = state.characters.map((ch) => {
    const cls = CLASSES[ch.cls];
    const rows = state.phases.map((p) => {
      const { got, total } = phaseProgress(ch, p);
      const pct = total ? Math.round((got / total) * 100) : 0;
      return `
        <div class="ov-phase">
          <span class="ov-phase-name">${esc(p.name)}</span>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          <span class="ov-phase-nums">${got}/${total}</span>
        </div>`;
    }).join('');
    return `
      <article class="ov-card" data-action="open-char" data-id="${ch.id}" role="button" tabindex="0"
        title="Open ${esc(ch.name)}">
        <h3 style="color:${cls.color}">${esc(ch.name)}</h3>
        <span class="char-sub">${esc([ch.race, cls.label !== 'Other' ? cls.label : ''].filter(Boolean).join(' '))}
          · ${ch.loadouts.length} loadout${ch.loadouts.length === 1 ? '' : 's'}</span>
        ${state.phases.length ? rows : '<p class="slot-empty">No phases yet</p>'}
      </article>`;
  }).join('');
  return `<section class="overview">${cards}</section>`;
}

function refreshTooltips() {
  try { window.WH?.Tooltips?.refreshLinks?.(); } catch { /* widget optional */ }
}

// ---- Undo toast -----------------------------------------------------------

let toastTimer = null;
let toastUndoFn = null;

function showToast(msg, undoFn) {
  const toast = $('#toast');
  $('#toastMsg').textContent = msg;
  toastUndoFn = undoFn;
  $('#toastUndo').hidden = !undoFn;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 8000);
}

function hideToast() {
  $('#toast').hidden = true;
  toastUndoFn = null;
  clearTimeout(toastTimer);
}

/** Run a mutation with a one-click undo. */
function withUndo(label, fn) {
  const snap = snapshot();
  fn();
  renderAll();
  showToast(label, () => {
    replaceState(snap);
    renderAll();
  });
}

// ---- Dialog helpers -----------------------------------------------------

const charDialog = $('#charDialog');
const nameDialog = $('#nameDialog');
const addItemDialog = $('#addItemDialog');
const copyDialog = $('#copyDialog');
const shareDialog = $('#shareDialog');
let editingCharId = null;
let nameMode = 'new-loadout'; // new-loadout | rename-loadout | new-phase | rename-phase
let addItemSlot = null;

function fillCharForm(ch) {
  const f = $('#charForm');
  f.cls.innerHTML = Object.entries(CLASSES).map(([k, v]) =>
    `<option value="${k}">${v.label}</option>`).join('');
  f.name.value = ch?.name ?? '';
  f.race.value = ch?.race ?? '';
  f.cls.value = ch?.cls ?? 'other';
}

function openCharDialog(ch = null) {
  editingCharId = ch?.id ?? null;
  $('#charDialogTitle').textContent = ch ? 'Edit character' : 'New character';
  fillCharForm(ch);
  charDialog.showModal();
}

function openNameDialog(mode) {
  nameMode = mode;
  const titles = {
    'new-loadout': 'New loadout',
    'rename-loadout': 'Rename loadout',
    'new-phase': 'New phase',
    'rename-phase': 'Rename phase',
  };
  const isPhase = mode.endsWith('phase');
  const current = mode === 'rename-loadout' ? activeLoadout()?.name
    : mode === 'rename-phase' ? activePhase()?.name : '';
  const f = $('#nameForm');
  $('#nameDialogTitle').textContent = titles[mode];
  $('#nameDialogHint').hidden = !isPhase;
  f.name.placeholder = isPhase ? 'Pre Raid' : 'Enhancement';
  f.name.value = current ?? '';
  nameDialog.showModal();
}

function openCopyDialog() {
  const ph = activePhase();
  const others = state.phases.filter((p) => p.id !== ph.id);
  if (!others.length) {
    showToast('No other phase to copy from — create another phase first.', null);
    return;
  }
  $('#copyTargetName').textContent = ph.name;
  $('#copyForm').fromPhase.innerHTML = others.map((p) =>
    `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  copyDialog.showModal();
}

async function openShareDialog() {
  const ch = activeCharacter();
  if (!ch) return;
  $('#shareCharName').textContent = ch.name;
  $('#shareUrl').value = 'Generating…';
  shareDialog.showModal();
  try {
    const payload = await encodeShare({ v: 2, phases: state.phases, character: ch });
    const base = location.href.split('#')[0];
    $('#shareUrl').value = `${base}#share=${payload}`;
  } catch (e) {
    console.error(e);
    $('#shareUrl').value = 'Sorry — could not generate the link in this browser.';
  }
}

function openAddItemDialog(slotKey) {
  addItemSlot = slotKey;
  const label = SLOTS.find((s) => s.key === slotKey)?.label ?? slotKey;
  $('#addItemSlotName').textContent = label;
  $('#addItemSlotName2').textContent = label;
  $('#addItemAllSlots').checked = false;
  $('#addItemInput').value = '';
  $('#addItemResults').innerHTML = '';
  setAddStatus(null);
  $('#addItemWowheadLink').href = searchUrl('');
  addItemDialog.showModal();
  $('#addItemInput').focus();
}

function setAddStatus(msg, kind = 'info') {
  const el = $('#addItemStatus');
  if (!msg) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = msg;
  el.className = `add-status ${kind}`;
}

// ---- Add-item flow ------------------------------------------------------

async function addItemById(id, fallback = {}) {
  const ch = activeCharacter();
  const lo = activeLoadout(ch);
  const ph = activePhase();
  if (!ch || !lo || !ph || !addItemSlot) return;
  setAddStatus('Fetching item details from Wowhead…');
  // The local database may know the item too (name, quality, source with drop chance).
  const kb = itemDbGet(id);
  // Warn (but don't refuse) when the item doesn't fit the slot it's added to.
  const slotLabel = SLOTS.find((s) => s.key === addItemSlot)?.label ?? addItemSlot;
  const misfit = kb && kb.slot && !itemFitsSlot(kb, addItemSlot)
    ? ` Note: ${kb.name} is a “${kb.slot}” item, added to ${slotLabel}.` : '';
  let item;
  try {
    item = await fetchItem(id);
    // Prefer the database's source line: it includes drop chances and zones.
    if (kb?.src) item.source = kb.src;
  } catch {
    item = {
      id: String(id),
      name: fallback.name ?? kb?.name ?? `Item ${id}`,
      quality: fallback.quality ?? kb?.q ?? null,
      icon: null,
      source: fallback.source ?? kb?.src ?? null,
      fetched: false,
    };
    setAddStatus(`Wowhead was unreachable — added with the info available. Use ↻ on the item to fetch its icon later.${misfit}`, 'warn');
  }
  if (slotsOf(lo, ph)[addItemSlot].includes(String(id))) {
    setAddStatus(`${item.name} is already in this slot.`, 'warn');
    return;
  }
  addItemToSlot(ch, lo, ph, addItemSlot, item);
  if (item.fetched) {
    setAddStatus(`Added ${item.name}.${misfit} Add another, or close.`, misfit ? 'warn' : 'ok');
  }
  renderAll();
}

function renderSearchResults(results) {
  $('#addItemResults').innerHTML = results.map((r) => `
    <button type="button" class="search-result" data-result-id="${r.id}"
      data-result-name="${esc(r.name)}" data-result-quality="${r.q ?? ''}"
      data-result-source="${esc(r.src)}">
      <span class="sr-main">
        <span style="color:${qColor(r.q)}">${esc(r.name)}</span>
        ${r.slot ? `<span class="sr-slot">${esc(r.slot)}</span>` : ''}
      </span>
      ${r.src ? `<span class="sr-src">${esc(r.src)}</span>` : ''}
    </button>`).join('');
}

async function runAddItemSearch(raw, { live = false } = {}) {
  const parsed = parseItemInput(raw);
  if (!parsed) { $('#addItemResults').innerHTML = ''; return; }
  if (parsed.id) {
    if (!live) await addItemById(parsed.id, { name: parsed.name });
    return;
  }

  $('#addItemWowheadLink').href = searchUrl(parsed.query);
  if (!itemDbReady()) {
    try {
      setAddStatus('Loading the item database…');
      await loadItemDb((msg) => setAddStatus(msg));
      setAddStatus(null);
    } catch {
      setAddStatus('Could not load the item database (offline?). ' +
        'Open the Wowhead link below, find your item, and paste its link or ID here.', 'warn');
      $('#addItemResults').innerHTML = '';
      return;
    }
  }
  const allSlots = $('#addItemAllSlots').checked;
  const results = searchItemDb(parsed.query, { slotKey: allSlots ? null : addItemSlot });
  if (!results.length) {
    const slotLabel = SLOTS.find((s) => s.key === addItemSlot)?.label ?? addItemSlot;
    if (!allSlots && searchItemDb(parsed.query, { slotKey: null }).length) {
      setAddStatus(`No ${slotLabel} items match — matches exist in other slots. Tick “Search all slots” to see them.`, 'warn');
    } else if (!live) {
      setAddStatus('No items found. Try part of the in-game name, or paste a Wowhead link / item ID.', 'warn');
    }
    $('#addItemResults').innerHTML = '';
    return;
  }
  setAddStatus(null);
  renderSearchResults(results);
}

// Re-run the search when the all-slots toggle changes.
$('#addItemAllSlots').addEventListener('change', () => {
  runAddItemSearch($('#addItemInput').value, { live: true });
});

// Live search while typing (the database is local, so this is instant).
let searchDebounce = null;
$('#addItemInput').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  const value = e.target.value;
  searchDebounce = setTimeout(() => runAddItemSearch(value, { live: true }), 200);
});

// ---- Share mode -----------------------------------------------------------

let sharedPayload = null; // decoded {v, phases, character} while viewing a share

function saveSharedCopy() {
  if (!sharedPayload) return;
  const local = load(); // the visitor's own data, untouched while read-only
  const phaseMap = {};
  for (const p of sharedPayload.phases ?? []) {
    const existing = local.phases.find((lp) => lp.name.toLowerCase() === p.name.toLowerCase());
    if (existing) {
      phaseMap[p.id] = existing.id;
    } else {
      const np = { id: uid(), name: p.name };
      local.phases.push(np);
      phaseMap[p.id] = np.id;
    }
  }
  const ch = structuredClone(sharedPayload.character);
  ch.id = uid();
  if (local.characters.some((c) => c.name === ch.name)) ch.name += ' (shared)';
  for (const lo of ch.loadouts ?? []) {
    lo.id = uid();
    lo.phases = Object.fromEntries(Object.entries(lo.phases ?? {})
      .map(([pid, slots]) => [phaseMap[pid] ?? pid, slots]));
    lo.enchants = Object.fromEntries(Object.entries(lo.enchants ?? {})
      .map(([pid, m]) => [phaseMap[pid] ?? pid, m]));
  }
  local.characters.push(ch);
  local.activeCharacterId = ch.id;
  setReadOnly(false);
  sharedPayload = null;
  history.replaceState(null, '', location.pathname + location.search);
  replaceState(local); // normalize backfills new phases onto existing loadouts
  renderAll();
  showToast(`Saved ${ch.name} to your tracker.`, null);
}

function exitShare() {
  history.replaceState(null, '', location.pathname + location.search);
  location.reload();
}

// ---- Cross-device sync (GitHub Gist) --------------------------------------

const syncDialog = $('#syncDialog');
let pendingCloud = null; // {data, updatedAt} awaiting a first-connect choice
let syncBusy = false;

function stateJson() {
  return JSON.stringify(state);
}

function localChanged(cfg) {
  return hashString(stateJson()) !== cfg.lastHash;
}

function setSyncStatus(msg, kind = 'info') {
  const el = $('#syncStatus');
  if (el) {
    el.textContent = msg;
    el.className = `add-status ${kind}`;
    el.hidden = !msg;
  }
}

function renderSyncDialog() {
  const cfg = syncConfig();
  const body = $('#syncBody');
  if (pendingCloud) {
    const chars = (pendingCloud.data.characters ?? []).map((c) => c.name).join(', ') || 'no characters';
    body.innerHTML = `
      <p>A copy of your tracker already exists in the cloud
         (<b>${esc(chars)}</b>, last changed ${esc(new Date(pendingCloud.updatedAt).toLocaleString())}).
         Which data should this device use?</p>
      <div class="sync-choice">
        <button class="btn btn-primary" data-sync="use-cloud">Use the cloud data here</button>
        <button class="btn" data-sync="use-local">Replace the cloud with this device's data</button>
      </div>
      <div id="syncStatus" class="add-status" hidden></div>`;
    return;
  }
  if (!cfg) {
    body.innerHTML = `
      <p>Keep your tracker identical on every device using a <b>secret GitHub gist</b>
         — no account system, your data stays in your own GitHub.</p>
      <ol class="sync-steps">
        <li><a href="https://github.com/settings/tokens/new?scopes=gist&description=Forever%20BIS%20sync"
               target="_blank" rel="noopener">Create a GitHub token</a>
            (the <b>gist</b> scope is pre-selected — leave everything else off; pick a long expiration).</li>
        <li>Copy the token and paste it below.</li>
        <li>Paste the <em>same token</em> on your other devices — they find the same data automatically.</li>
      </ol>
      <label>GitHub token
        <input id="syncToken" type="password" placeholder="ghp_…" autocomplete="off">
      </label>
      <p class="hint">The token is stored only in this browser and is never part of backups or share links.
         It can do nothing on GitHub except read/write gists.</p>
      <div class="dialog-actions" style="justify-content:flex-start">
        <button class="btn btn-primary" data-sync="connect">Connect</button>
      </div>
      <div id="syncStatus" class="add-status" hidden></div>`;
    return;
  }
  const dirty = localChanged(cfg);
  body.innerHTML = `
    <p class="sync-connected">✓ Connected — data syncs through a
       <a href="${esc(cfg.gistUrl ?? '#')}" target="_blank" rel="noopener">secret gist</a> on your GitHub.</p>
    <ul class="sync-meta hint">
      <li>Changes on this device upload automatically a few seconds after you make them.</li>
      <li>Cloud changes from other devices are pulled in when the app loads.</li>
      <li>This device: ${dirty ? 'has changes not yet uploaded' : 'matches the last sync'}.</li>
    </ul>
    <div class="sync-choice">
      <button class="btn btn-primary" data-sync="sync-now">Sync now</button>
      <button class="btn" data-sync="upload" title="Overwrite the cloud with this device's data">Force upload</button>
      <button class="btn" data-sync="download" title="Overwrite this device with the cloud data">Force download</button>
      <button class="btn btn-ghost danger" data-sync="disconnect">Disconnect</button>
    </div>
    <div id="syncStatus" class="add-status" hidden></div>`;
}

function openSyncDialog() {
  renderSyncDialog();
  syncDialog.showModal();
}

/** Record a successful sync point (state and remote timestamp in agreement). */
function markSynced(cfg, updatedAt, extra = {}) {
  saveSyncConfig({ ...cfg, ...extra, lastHash: hashString(stateJson()), remoteUpdatedAt: updatedAt });
}

async function syncUpload(cfg) {
  const gist = await updateGist(cfg.token, cfg.gistId, stateJson());
  markSynced(cfg, gist.updated_at);
}

async function syncDownload(cfg) {
  const { data, updatedAt } = await fetchGistData(cfg.token, cfg.gistId);
  replaceState(data);
  markSynced(cfg, updatedAt);
  renderAll();
}

async function connectSync(token) {
  setSyncStatus('Connecting to GitHub…');
  const gist = await findGist(token);
  if (!gist) {
    setSyncStatus('Creating your sync gist…');
    const created = await createGist(token, stateJson());
    saveSyncConfig({ token, gistId: created.id, gistUrl: created.html_url });
    markSynced(syncConfig(), created.updated_at);
    renderSyncDialog();
    showToast('Sync connected — this device\'s data is now in the cloud.', null);
    return;
  }
  const cloud = await fetchGistData(token, gist.id);
  saveSyncConfig({ token, gistId: gist.id, gistUrl: cloud.url, lastHash: null, remoteUpdatedAt: null });
  const localHasData = state.characters.length > 0;
  const cloudHasData = (cloud.data?.characters ?? []).length > 0;
  if (cloudHasData && localHasData) {
    pendingCloud = cloud; // let the user choose a winner
    renderSyncDialog();
    return;
  }
  if (cloudHasData) {
    replaceState(cloud.data);
    markSynced(syncConfig(), cloud.updatedAt);
    renderAll();
  } else {
    await syncUpload(syncConfig());
  }
  renderSyncDialog();
  showToast('Sync connected.', null);
}

async function handleSyncAction(action) {
  if (syncBusy) return;
  syncBusy = true;
  const cfg = syncConfig();
  try {
    switch (action) {
      case 'connect': {
        const token = $('#syncToken').value.trim();
        if (!token) { setSyncStatus('Paste a token first.', 'warn'); break; }
        await connectSync(token);
        break;
      }
      case 'use-cloud':
        replaceState(pendingCloud.data);
        markSynced(syncConfig(), pendingCloud.updatedAt);
        pendingCloud = null;
        renderAll();
        renderSyncDialog();
        setSyncStatus('Using the cloud data on this device.', 'ok');
        break;
      case 'use-local':
        await syncUpload(syncConfig());
        pendingCloud = null;
        renderSyncDialog();
        setSyncStatus('Cloud replaced with this device\'s data.', 'ok');
        break;
      case 'sync-now': {
        setSyncStatus('Checking the cloud…');
        const meta = await fetchGistMeta(cfg.token, cfg.gistId);
        const remoteChanged = meta.updatedAt !== cfg.remoteUpdatedAt;
        const dirty = localChanged(cfg);
        if (!remoteChanged && !dirty) setSyncStatus('Everything is in sync.', 'ok');
        else if (remoteChanged && dirty) {
          setSyncStatus('Both this device and the cloud changed since the last sync — pick Force upload or Force download.', 'warn');
        } else if (dirty) {
          await syncUpload(cfg);
          renderSyncDialog();
          setSyncStatus('Uploaded this device\'s changes.', 'ok');
        } else {
          await syncDownload(cfg);
          renderSyncDialog();
          setSyncStatus('Downloaded the cloud changes.', 'ok');
        }
        break;
      }
      case 'upload':
        if (confirm('Overwrite the CLOUD data with this device\'s data?')) {
          await syncUpload(cfg);
          renderSyncDialog();
          setSyncStatus('Cloud overwritten with this device\'s data.', 'ok');
        }
        break;
      case 'download':
        if (confirm('Overwrite THIS DEVICE\'s data with the cloud data?')) {
          await syncDownload(cfg);
          renderSyncDialog();
          setSyncStatus('This device now matches the cloud.', 'ok');
        }
        break;
      case 'disconnect':
        if (confirm('Disconnect sync on this device? The cloud copy and other devices are unaffected.')) {
          disconnectSync();
          renderSyncDialog();
        }
        break;
    }
  } catch (e) {
    setSyncStatus(e.message === 'unauthorized'
      ? 'GitHub rejected the token. Create a new one (gist scope) and reconnect.'
      : 'Sync failed — are you online? Try again in a moment.', 'warn');
  } finally {
    syncBusy = false;
  }
}

$('#syncBody').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-sync]');
  if (btn) handleSyncAction(btn.dataset.sync);
});

// Auto-upload a few seconds after local changes (never over newer cloud data).
let autoPushTimer = null;
let divergenceToastShown = false;
onSave(() => {
  const cfg = syncConfig();
  if (!cfg || isReadOnly()) return;
  clearTimeout(autoPushTimer);
  autoPushTimer = setTimeout(async () => {
    const current = syncConfig();
    if (!current || !localChanged(current)) return;
    try {
      const meta = await fetchGistMeta(current.token, current.gistId);
      if (meta.updatedAt !== current.remoteUpdatedAt) {
        if (!divergenceToastShown) {
          divergenceToastShown = true;
          showToast('Sync: the cloud has newer data from another device — open ⋯ → Sync to resolve.', null);
        }
        return;
      }
      await syncUpload(current);
    } catch { /* quietly retry on the next change */ }
  }, 4000);
});

// On load: pull cloud changes when this device has none of its own.
async function syncBootCheck() {
  const cfg = syncConfig();
  if (!cfg || isReadOnly()) return;
  try {
    const meta = await fetchGistMeta(cfg.token, cfg.gistId);
    if (meta.updatedAt === cfg.remoteUpdatedAt) return; // cloud unchanged
    if (!localChanged(cfg)) {
      await syncDownload(cfg);
      showToast('Synced: loaded the latest data from the cloud.', null);
    } else {
      showToast('Sync: this device and the cloud both changed — open ⋯ → Sync to resolve.', null);
    }
  } catch { /* offline is fine; local data stands */ }
}

// ---- Export / import ----------------------------------------------------

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `forever-bis-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!confirm('Importing replaces ALL current data with the backup. Continue?')) return;
      replaceState(data);
      renderAll();
    } catch {
      alert('That file is not a valid Forever BIS backup.');
    }
  };
  reader.readAsText(file);
}

// ---- Events -------------------------------------------------------------

document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-wrap')) $('#menu').hidden = true;
});

$('#menuBtn').addEventListener('click', () => {
  const m = $('#menu');
  m.hidden = !m.hidden;
});

$('#menu').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-menu]');
  if (!btn) return;
  $('#menu').hidden = true;
  const ch = activeCharacter();
  switch (btn.dataset.menu) {
    case 'edit-char': if (ch) openCharDialog(ch); break;
    case 'delete-char':
      if (ch && confirm(`Delete ${ch.name} and all their loadouts?`)) {
        withUndo(`Deleted ${ch.name}.`, () => {
          state.characters = state.characters.filter((c) => c.id !== ch.id);
          delete state.activeLoadoutByChar[ch.id];
          state.activeCharacterId = state.characters[0]?.id ?? null;
          save();
        });
      }
      break;
    case 'share': openShareDialog(); break;
    case 'sync': openSyncDialog(); break;
    case 'export': exportBackup(); break;
    case 'import': $('#importFile').click(); break;
  }
});

$('#importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) importBackup(file);
  e.target.value = '';
});

$('#charSelect').addEventListener('change', (e) => {
  state.activeCharacterId = e.target.value;
  save();
  renderAll();
});

$('#newCharBtn').addEventListener('click', () => openCharDialog());

$('#toastUndo').addEventListener('click', () => {
  toastUndoFn?.();
  hideToast();
});
$('#toastClose').addEventListener('click', hideToast);

$('#copyShareUrl').addEventListener('click', async () => {
  const input = $('#shareUrl');
  input.select();
  try {
    await navigator.clipboard.writeText(input.value);
    $('#copyShareUrl').textContent = 'Copied ✓';
    setTimeout(() => { $('#copyShareUrl').textContent = 'Copy link'; }, 1500);
  } catch {
    document.execCommand('copy'); // fallback; text is already selected
  }
});

// Dialog: character save
$('#charForm').addEventListener('submit', () => {
  const f = $('#charForm');
  const data = {
    name: f.name.value.trim(),
    race: f.race.value.trim(),
    cls: f.cls.value,
  };
  if (!data.name) return;
  if (editingCharId) {
    const ch = state.characters.find((c) => c.id === editingCharId);
    if (ch) Object.assign(ch, data);
  } else {
    const ch = makeCharacter(data);
    state.characters.push(ch);
    state.activeCharacterId = ch.id;
  }
  save();
  renderAll();
});

// Dialog: loadout / phase save
$('#nameForm').addEventListener('submit', () => {
  const name = $('#nameForm').name.value.trim();
  if (!name) return;
  const ch = activeCharacter();
  switch (nameMode) {
    case 'new-loadout': {
      if (!ch) return;
      const lo = makeLoadout(name);
      ch.loadouts.push(lo);
      setActiveLoadout(ch, lo.id);
      break;
    }
    case 'rename-loadout': {
      const lo = activeLoadout(ch);
      if (lo) lo.name = name;
      break;
    }
    case 'new-phase': addPhase(name); break;
    case 'rename-phase': {
      const ph = activePhase();
      if (ph) renamePhase(ph, name);
      break;
    }
  }
  save();
  renderAll();
});

// Dialog: copy goals between phases
$('#copyForm').addEventListener('submit', () => {
  const f = $('#copyForm');
  const ch = activeCharacter();
  const toPhase = activePhase();
  const fromPhase = state.phases.find((p) => p.id === f.fromPhase.value);
  if (!ch || !toPhase || !fromPhase) return;
  const scopeLoadout = f.scope.value === 'loadout' ? activeLoadout(ch)?.id : null;
  withUndo(`Copied goals from ${fromPhase.name} into ${toPhase.name}.`, () => {
    copyPhaseGoals(ch, fromPhase, toPhase, scopeLoadout);
  });
});

// Dialog: add item (submit = search/add; don't close)
$('#addItemForm').addEventListener('submit', (e) => {
  e.preventDefault();
  runAddItemSearch($('#addItemInput').value);
});

$('#addItemResults').addEventListener('click', (e) => {
  const btn = e.target.closest('.search-result');
  if (btn) {
    addItemById(btn.dataset.resultId, {
      name: btn.dataset.resultName,
      quality: btn.dataset.resultQuality === '' ? null : Number(btn.dataset.resultQuality),
      source: btn.dataset.resultSource || null,
    });
  }
});

// Close buttons for all dialogs
for (const dlg of [charDialog, nameDialog, addItemDialog, copyDialog, shareDialog, syncDialog]) {
  dlg.addEventListener('click', (e) => {
    if (e.target.matches('[data-close]')) dlg.close();
  });
}

// Keep the enchant input focused while clicking its suggestion list, so the
// click lands before any blur-driven re-render.
app.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.enchant-sugs')) e.preventDefault();
});

// Main app delegation
app.addEventListener('click', (e) => {
  // Enchant suggestion pick (database-linked, gets a tooltip).
  const sug = e.target.closest('.enchant-sug');
  if (sug) {
    const ch = activeCharacter();
    const lo = activeLoadout(ch);
    const ph = activePhase();
    if (lo && ph) {
      setEnchant(lo, ph, sug.dataset.slot, {
        id: sug.dataset.enchId,
        name: sug.dataset.enchName,
        q: sug.dataset.enchQ === '' ? null : Number(sug.dataset.enchQ),
      });
      openEnchants.delete(`${lo.id}/${ph.id}/${sug.dataset.slot}`);
      renderAll();
    }
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn || btn.matches('input,textarea')) return;
  const ro = isReadOnly();
  const ch = activeCharacter();
  const lo = activeLoadout(ch);
  const ph = activePhase();
  const { action, slot, item: itemId, id } = btn.dataset;

  // Navigation actions are always allowed; everything else is blocked read-only.
  const navActions = new Set(['pick-loadout', 'pick-phase', 'set-view', 'open-char',
    'save-shared-copy', 'exit-share']);
  if (ro && !navActions.has(action)) return;

  switch (action) {
    case 'new-char': openCharDialog(); break;
    case 'new-loadout': openNameDialog('new-loadout'); break;
    case 'rename-loadout': openNameDialog('rename-loadout'); break;
    case 'new-phase': openNameDialog('new-phase'); break;
    case 'rename-phase': openNameDialog('rename-phase'); break;
    case 'copy-phase': openCopyDialog(); break;
    case 'duplicate-loadout':
      if (lo) {
        const copy = duplicateLoadout(ch, lo);
        setActiveLoadout(ch, copy.id);
        renderAll();
      }
      break;
    case 'delete-loadout':
      if (lo && confirm(`Are you sure you want to delete the loadout “${lo.name}” and all its goals in every phase?`)) {
        withUndo(`Deleted loadout “${lo.name}”.`, () => {
          ch.loadouts = ch.loadouts.filter((l) => l.id !== lo.id);
          setActiveLoadout(ch, ch.loadouts[0]?.id ?? null);
          save();
        });
      }
      break;
    case 'delete-phase':
      if (ph && confirm(`Are you sure you want to delete the phase “${ph.name}”? It is removed from ALL loadouts on ALL characters, with all its goals.`)) {
        withUndo(`Deleted phase “${ph.name}”.`, () => deletePhase(ph));
      }
      break;
    case 'pick-loadout': setActiveLoadout(ch, id); renderAll(); break;
    case 'pick-phase': setActivePhase(id); renderAll(); break;
    case 'set-view': view = id; renderAll(); break;
    case 'open-char':
      state.activeCharacterId = id;
      save();
      view = 'slots';
      renderAll();
      break;
    case 'save-shared-copy': saveSharedCopy(); break;
    case 'exit-share': exitShare(); break;
    case 'add-item': openAddItemDialog(slot); break;
    case 'remove-item': {
      const name = ch.items[itemId]?.name ?? 'item';
      withUndo(`Removed ${name}.`, () => removeItemFromSlot(ch, lo, ph, slot, itemId));
      break;
    }
    case 'move-up': moveItemInSlot(lo, ph, slot, itemId, -1); renderAll(); break;
    case 'move-down': moveItemInSlot(lo, ph, slot, itemId, +1); renderAll(); break;
    case 'toggle-note': {
      const key = `${lo.id}/${ph.id}/${slot}/${itemId}`;
      openNotes.has(key) ? openNotes.delete(key) : openNotes.add(key);
      renderAll();
      break;
    }
    case 'toggle-enchant': {
      const key = `${lo.id}/${ph.id}/${slot}`;
      openEnchants.has(key) ? openEnchants.delete(key) : openEnchants.add(key);
      renderAll();
      if (openEnchants.has(key)) {
        const input = $(`.enchant-input[data-slot="${slot}"]`);
        if (input) {
          input.focus();
          updateEnchantSugs(input);
        }
      }
      break;
    }
    case 'refresh-item':
      fetchItem(itemId).then((item) => {
        Object.assign(ch.items[itemId], item);
        save();
        renderAll();
      }).catch(() => {
        btn.classList.add('shake');
        setTimeout(() => btn.classList.remove('shake'), 400);
      });
      break;
  }
});

app.addEventListener('change', (e) => {
  const el = e.target;
  if (isReadOnly()) return;
  const ch = activeCharacter();
  switch (el.dataset.action) {
    case 'toggle-obtained': {
      const item = ch?.items[el.dataset.item];
      if (item) {
        item.obtained = el.checked;
        save();
        renderAll();
      }
      break;
    }
    case 'toggle-hide-obtained':
      state.hideObtained = el.checked;
      save();
      renderAll();
      break;
    case 'toggle-needed-scope':
      neededAllLoadouts = el.checked;
      renderAll();
      break;
    case 'edit-enchant': {
      // change fires on blur/Enter: close the editor.
      const lo = activeLoadout(ch);
      const ph = activePhase();
      openEnchants.delete(`${lo.id}/${ph.id}/${el.dataset.slot}`);
      renderAll();
      break;
    }
  }
});

app.addEventListener('input', (e) => {
  const el = e.target;
  if (isReadOnly()) return;
  const ch = activeCharacter();
  if (el.dataset.action === 'edit-note') {
    const item = ch?.items[el.dataset.item];
    if (item) {
      item.note = el.value;
      save(); // cheap; no re-render while typing
    }
  } else if (el.dataset.action === 'edit-enchant') {
    const lo = activeLoadout(ch);
    const ph = activePhase();
    if (lo && ph) setEnchant(lo, ph, el.dataset.slot, el.value);
    updateEnchantSugs(el);
  }
});

// Close the enchant editor on Enter or Escape.
app.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === 'Escape') && e.target.dataset?.action === 'edit-enchant') {
    e.preventDefault();
    const ch = activeCharacter();
    const lo = activeLoadout(ch);
    const ph = activePhase();
    if (lo && ph) openEnchants.delete(`${lo.id}/${ph.id}/${e.target.dataset.slot}`);
    renderAll();
  }
});

// ---- Boot ---------------------------------------------------------------

async function boot() {
  const m = location.hash.match(/^#share=(.+)$/);
  if (m) {
    try {
      const data = await decodeShare(m[1]);
      if (!data || !data.character) throw new Error('bad payload');
      sharedPayload = data;
      setReadOnly(true);
      replaceState({
        schema: 2,
        phases: data.phases ?? [],
        characters: [data.character],
        activeCharacterId: data.character.id,
        activeLoadoutByChar: {},
      });
    } catch (e) {
      console.error('Could not open shared link', e);
      alert('Sorry — that shared link could not be opened.');
      history.replaceState(null, '', location.pathname + location.search);
    }
  }
  renderAll();
  syncBootCheck();
}

boot();
