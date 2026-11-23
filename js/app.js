import {
  SLOTS, CLASSES, QUALITY_COLORS,
  state, save, replaceState,
  makeCharacter, makeLoadout,
  activeCharacter, activeLoadout, activePhase,
  setActiveLoadout, setActivePhase, slotsOf,
  addPhase, renamePhase, deletePhase,
  addItemToSlot, removeItemFromSlot, moveItemInSlot, placesUsingItem,
} from './store.js';

import {
  itemUrl, searchUrl, iconUrl, fetchItem, searchItems, parseItemInput,
} from './wowhead.js';

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

// Set of item rows whose note editor is open (survives re-render).
const openNotes = new Set();

// ---- Rendering ----------------------------------------------------------

function renderAll() {
  renderTopbar();
  renderMain();
  refreshTooltips();
}

function renderTopbar() {
  const sel = $('#charSelect');
  sel.innerHTML = state.characters.map((c) =>
    `<option value="${c.id}" ${c.id === state.activeCharacterId ? 'selected' : ''}>${esc(c.name)}</option>`
  ).join('');
  const hasChar = state.characters.length > 0;
  sel.hidden = !hasChar;
  $('[data-menu="edit-char"]').disabled = !hasChar;
  $('[data-menu="delete-char"]').disabled = !hasChar;
}

function renderMain() {
  const ch = activeCharacter();
  if (!ch) {
    app.innerHTML = `
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
        <button class="btn btn-primary" data-action="new-loadout">Create a loadout</button>
      </section>`;
  } else if (!ph) {
    body = `
      <section class="welcome">
        <p>No phases yet. A phase is a stage of gearing — e.g. <em>Pre Raid</em>,
           <em>Tier 1</em>. Phases are shared by every loadout on every character.</p>
        <button class="btn btn-primary" data-action="new-phase">Create a phase</button>
      </section>`;
  } else {
    body = slotsHtml(ch, lo, ph);
  }

  app.innerHTML = `
    <section class="char-head">
      <div class="char-id">
        <h2 style="color:${cls.color}">${esc(ch.name)}</h2>
        <span class="char-sub">${esc([ch.race, cls.label !== 'Other' ? cls.label : ''].filter(Boolean).join(' '))}</span>
      </div>
      ${lo && ph ? progressHtml(ch, lo, ph) : ''}
    </section>

    <nav class="tabs tabs-phases">
      <span class="tabs-label">Phase</span>
      ${phaseTabs}
      <button class="tab tab-add" data-action="new-phase" title="Add a phase (added to all loadouts on all characters)">+ Phase</button>
      ${ph ? `
        <span class="tab-tools">
          <button class="icon-btn" data-action="rename-phase" title="Rename phase">✎</button>
          <button class="icon-btn danger" data-action="delete-phase" title="Delete phase">🗑</button>
        </span>` : ''}
    </nav>

    <nav class="tabs">
      <span class="tabs-label">Loadout</span>
      ${loadoutTabs}
      <button class="tab tab-add" data-action="new-loadout" title="Add loadout">+ Loadout</button>
      ${lo ? `
        <span class="tab-tools">
          <button class="icon-btn" data-action="rename-loadout" title="Rename loadout">✎</button>
          <button class="icon-btn danger" data-action="delete-loadout" title="Delete loadout">🗑</button>
        </span>` : ''}
    </nav>

    ${body}
  `;
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

function slotsHtml(ch, lo, ph) {
  const slots = slotsOf(lo, ph);
  const cards = SLOTS.map((s) => {
    const items = slots[s.key].map((id, i) =>
      itemRowHtml(ch, lo, ph, s.key, id, i, slots[s.key].length)).join('');
    return `
      <article class="slot-card ${slots[s.key].some((id) => ch.items[id]?.obtained) ? 'slot-done' : ''}">
        <header class="slot-head">
          <h3>${s.label}</h3>
          <button class="icon-btn add" data-action="add-item" data-slot="${s.key}" title="Add goal item to ${s.label}">+</button>
        </header>
        ${items || '<p class="slot-empty">No goals yet</p>'}
      </article>`;
  }).join('');
  return `<section class="slots">${cards}</section>`;
}

function itemRowHtml(ch, lo, ph, slotKey, itemId, index, count) {
  const item = ch.items[itemId] ?? { id: itemId, name: `Item ${itemId}`, quality: null, icon: null };
  const elsewhere = placesUsingItem(ch, itemId, lo.id, ph.id);
  const noteOpen = openNotes.has(`${lo.id}/${ph.id}/${slotKey}/${itemId}`);
  const key = `data-slot="${slotKey}" data-item="${itemId}"`;
  return `
  <div class="item-row ${item.obtained ? 'obtained' : ''}">
    <div class="item-main">
      <label class="obtain" title="${item.obtained ? 'Obtained — click to unmark' : 'Mark as obtained'}">
        <input type="checkbox" data-action="toggle-obtained" ${key} ${item.obtained ? 'checked' : ''}>
        <span class="obtain-box"></span>
      </label>
      <a class="item-link" href="${itemUrl(itemId)}" target="_blank" rel="noopener"
         data-wh-icon-size="medium">
        <img class="item-icon" src="${iconUrl(item.icon)}" alt="" loading="lazy">
        <span class="item-name" style="color:${qColor(item.quality)}">${esc(item.name)}</span>
      </a>
      ${index === 0 && count > 1 ? '<span class="bis-chip" title="Top priority for this slot">BIS</span>' : ''}
      ${elsewhere.length ? `<span class="sync-chip" title="Also in: ${esc(elsewhere.join(', '))} — obtained status and notes are shared">⇄ ${elsewhere.length}</span>` : ''}
      <span class="item-tools">
        ${!item.fetched ? `<button class="icon-btn" data-action="refresh-item" ${key} title="Retry fetching item details from Wowhead">↻</button>` : ''}
        <button class="icon-btn ${item.note ? 'has-note' : ''}" data-action="toggle-note" ${key} title="${item.note ? 'Edit note' : 'Add note'}">🗒</button>
        <button class="icon-btn" data-action="move-up" ${key} title="Move up" ${index === 0 ? 'disabled' : ''}>▲</button>
        <button class="icon-btn" data-action="move-down" ${key} title="Move down" ${index === count - 1 ? 'disabled' : ''}>▼</button>
        <button class="icon-btn danger" data-action="remove-item" ${key} title="Remove from this slot">✕</button>
      </span>
    </div>
    ${noteOpen ? `
      <div class="note-wrap">
        <textarea class="note" data-action="edit-note" ${key} rows="2"
          placeholder="How to obtain — boss, quest, cost, drop rate…">${esc(item.note)}</textarea>
        <span class="hint">Notes are shared wherever this item appears.</span>
      </div>` : ''}
  </div>`;
}

function refreshTooltips() {
  // Ask the Wowhead widget (if it loaded) to scan new links.
  try { window.WH?.Tooltips?.refreshLinks?.(); } catch { /* widget optional */ }
}

// ---- Dialog helpers -----------------------------------------------------

const charDialog = $('#charDialog');
const nameDialog = $('#nameDialog');
const addItemDialog = $('#addItemDialog');
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

function openAddItemDialog(slotKey) {
  addItemSlot = slotKey;
  $('#addItemSlotName').textContent = SLOTS.find((s) => s.key === slotKey)?.label ?? slotKey;
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

async function addItemById(id, fallbackName) {
  const ch = activeCharacter();
  const lo = activeLoadout(ch);
  const ph = activePhase();
  if (!ch || !lo || !ph || !addItemSlot) return;
  setAddStatus('Fetching item details from Wowhead…');
  let item;
  try {
    item = await fetchItem(id);
  } catch {
    item = { id: String(id), name: fallbackName || `Item ${id}`, quality: null, icon: null, fetched: false };
    setAddStatus('Could not fetch details (offline or blocked) — added with the info available. Use ↻ on the item to retry.', 'warn');
  }
  if (slotsOf(lo, ph)[addItemSlot].includes(String(id))) {
    setAddStatus(`${item.name} is already in this slot.`, 'warn');
    return;
  }
  addItemToSlot(ch, lo, ph, addItemSlot, item);
  if (item.fetched) setAddStatus(`Added ${item.name}. Add another, or close.`, 'ok');
  renderAll();
}

async function runAddItemSearch(raw) {
  const parsed = parseItemInput(raw);
  if (!parsed) return;
  if (parsed.id) { await addItemById(parsed.id, parsed.name); return; }

  // Name search
  $('#addItemWowheadLink').href = searchUrl(parsed.query);
  setAddStatus('Searching Wowhead…');
  try {
    const results = await searchItems(parsed.query);
    if (!results.length) {
      setAddStatus('No items found. Try the exact in-game name, or paste a Wowhead link / item ID.', 'warn');
      $('#addItemResults').innerHTML = '';
      return;
    }
    setAddStatus(null);
    $('#addItemResults').innerHTML = results.slice(0, 12).map((r) => `
      <button type="button" class="search-result" data-result-id="${r.id}" data-result-name="${esc(r.name)}">
        <img src="${iconUrl(r.icon, 'small')}" alt="" loading="lazy">
        <span style="color:${qColor(r.quality)}">${esc(r.name)}</span>
        <span class="hint">#${r.id}</span>
      </button>`).join('');
  } catch {
    setAddStatus('Name search is unavailable in this browser (blocked by Wowhead). ' +
      'Open the Wowhead link below, find your item, and paste its link or ID here.', 'warn');
    $('#addItemResults').innerHTML = '';
  }
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
  const menuWrap = e.target.closest('.menu-wrap');
  if (!menuWrap) $('#menu').hidden = true;
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
      if (ch && confirm(`Delete ${ch.name} and all their loadouts? This cannot be undone.`)) {
        state.characters = state.characters.filter((c) => c.id !== ch.id);
        delete state.activeLoadoutByChar[ch.id];
        state.activeCharacterId = state.characters[0]?.id ?? null;
        save();
        renderAll();
      }
      break;
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

// Dialog: add item (submit = search/add; don't close)
$('#addItemForm').addEventListener('submit', (e) => {
  e.preventDefault();
  runAddItemSearch($('#addItemInput').value);
});

$('#addItemResults').addEventListener('click', (e) => {
  const btn = e.target.closest('.search-result');
  if (btn) addItemById(btn.dataset.resultId, btn.dataset.resultName);
});

// Close buttons for all dialogs
for (const dlg of [charDialog, nameDialog, addItemDialog]) {
  dlg.addEventListener('click', (e) => {
    if (e.target.matches('[data-close]')) dlg.close();
  });
}

// Main app delegation
app.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.matches('input,textarea')) return;
  const ch = activeCharacter();
  const lo = activeLoadout(ch);
  const ph = activePhase();
  const { action, slot, item: itemId, id } = btn.dataset;

  switch (action) {
    case 'new-char': openCharDialog(); break;
    case 'new-loadout': openNameDialog('new-loadout'); break;
    case 'rename-loadout': openNameDialog('rename-loadout'); break;
    case 'new-phase': openNameDialog('new-phase'); break;
    case 'rename-phase': openNameDialog('rename-phase'); break;
    case 'delete-loadout':
      if (lo && confirm(`Delete loadout “${lo.name}”? Item notes and obtained status are kept.`)) {
        ch.loadouts = ch.loadouts.filter((l) => l.id !== lo.id);
        setActiveLoadout(ch, ch.loadouts[0]?.id ?? null);
        save();
        renderAll();
      }
      break;
    case 'delete-phase':
      if (ph && confirm(`Delete phase “${ph.name}” from ALL loadouts on ALL characters? Item notes and obtained status are kept.`)) {
        deletePhase(ph);
        renderAll();
      }
      break;
    case 'pick-loadout': setActiveLoadout(ch, id); renderAll(); break;
    case 'pick-phase': setActivePhase(id); renderAll(); break;
    case 'add-item': openAddItemDialog(slot); break;
    case 'remove-item': removeItemFromSlot(ch, lo, ph, slot, itemId); renderAll(); break;
    case 'move-up': moveItemInSlot(lo, ph, slot, itemId, -1); renderAll(); break;
    case 'move-down': moveItemInSlot(lo, ph, slot, itemId, +1); renderAll(); break;
    case 'toggle-note': {
      const key = `${lo.id}/${ph.id}/${slot}/${itemId}`;
      openNotes.has(key) ? openNotes.delete(key) : openNotes.add(key);
      renderAll();
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
  if (el.dataset.action === 'toggle-obtained') {
    const ch = activeCharacter();
    const item = ch?.items[el.dataset.item];
    if (item) {
      item.obtained = el.checked;
      save();
      renderAll();
    }
  }
});

app.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.action === 'edit-note') {
    const ch = activeCharacter();
    const item = ch?.items[el.dataset.item];
    if (item) {
      item.note = el.value;
      save(); // cheap; no re-render while typing
    }
  }
});

// ---- Boot ---------------------------------------------------------------

renderAll();
