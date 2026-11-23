import {
  SLOTS, GAME_VERSIONS, CLASSES, QUALITY_COLORS,
  state, save, replaceState, uid,
  makeCharacter, makeLoadout,
  activeCharacter, activeLoadout, setActiveLoadout,
  addItemToSlot, removeItemFromSlot, moveItemInSlot, loadoutsUsingItem,
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
  $('#menuBtn').hidden = false;
  $('[data-menu="edit-char"]').disabled = !hasChar;
  $('[data-menu="delete-char"]').disabled = !hasChar;
}

function renderMain() {
  const ch = activeCharacter();
  if (!ch) {
    app.innerHTML = `
      <section class="welcome">
        <h2>Track your Best-in-Slot goals</h2>
        <p>Create a character, set up loadouts (specs), and add goal items to each
           equipment slot. Mark items obtained and keep notes on how to get them —
           shared items stay in sync across all loadouts.</p>
        <button class="btn btn-primary btn-lg" data-action="new-char">Create your first character</button>
      </section>`;
    return;
  }

  const lo = activeLoadout(ch);
  const cls = CLASSES[ch.cls];
  const verLabel = GAME_VERSIONS[ch.version]?.label ?? '';

  const tabs = ch.loadouts.map((l) => `
    <button class="tab ${lo && l.id === lo.id ? 'active' : ''}" data-action="pick-loadout" data-id="${l.id}">
      ${esc(l.name)}
    </button>`).join('');

  app.innerHTML = `
    <section class="char-head">
      <div class="char-id">
        <h2 style="color:${cls.color}">${esc(ch.name)}</h2>
        <span class="char-sub">${esc([ch.race, cls.label !== 'Other' ? cls.label : ''].filter(Boolean).join(' '))}
          <span class="ver-chip">${esc(verLabel)}</span></span>
      </div>
      ${lo ? progressHtml(ch, lo) : ''}
    </section>

    <nav class="tabs">
      ${tabs}
      <button class="tab tab-add" data-action="new-loadout" title="Add loadout">+ Loadout</button>
      ${lo ? `
        <span class="tab-tools">
          <button class="icon-btn" data-action="rename-loadout" title="Rename loadout">✎</button>
          <button class="icon-btn danger" data-action="delete-loadout" title="Delete loadout">🗑</button>
        </span>` : ''}
    </nav>

    ${lo ? slotsHtml(ch, lo) : `
      <section class="welcome">
        <p>No loadouts yet. A loadout is a goal set for one spec or purpose —
           e.g. <em>Enhancement</em>, <em>Elemental</em>, <em>Restoration</em>.</p>
        <button class="btn btn-primary" data-action="new-loadout">Create a loadout</button>
      </section>`}
  `;
}

function progressHtml(ch, lo) {
  const ids = new Set(Object.values(lo.slots).flat());
  const total = ids.size;
  let got = 0;
  for (const id of ids) if (ch.items[id]?.obtained) got++;
  const filledSlots = SLOTS.filter((s) => lo.slots[s.key].length > 0);
  const doneSlots = filledSlots.filter((s) => lo.slots[s.key].some((id) => ch.items[id]?.obtained));
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

function slotsHtml(ch, lo) {
  const cards = SLOTS.map((s) => {
    const items = lo.slots[s.key].map((id, i) =>
      itemRowHtml(ch, lo, s.key, id, i, lo.slots[s.key].length)).join('');
    return `
      <article class="slot-card ${lo.slots[s.key].some((id) => ch.items[id]?.obtained) ? 'slot-done' : ''}">
        <header class="slot-head">
          <h3>${s.label}</h3>
          <button class="icon-btn add" data-action="add-item" data-slot="${s.key}" title="Add goal item to ${s.label}">+</button>
        </header>
        ${items || '<p class="slot-empty">No goals yet</p>'}
      </article>`;
  }).join('');
  return `<section class="slots">${cards}</section>`;
}

function itemRowHtml(ch, lo, slotKey, itemId, index, count) {
  const item = ch.items[itemId] ?? { id: itemId, name: `Item ${itemId}`, quality: null, icon: null };
  const elsewhere = loadoutsUsingItem(ch, itemId, lo.id);
  const noteOpen = openNotes.has(`${lo.id}/${slotKey}/${itemId}`);
  const key = `data-slot="${slotKey}" data-item="${itemId}"`;
  return `
  <div class="item-row ${item.obtained ? 'obtained' : ''}">
    <div class="item-main">
      <label class="obtain" title="${item.obtained ? 'Obtained — click to unmark' : 'Mark as obtained'}">
        <input type="checkbox" data-action="toggle-obtained" ${key} ${item.obtained ? 'checked' : ''}>
        <span class="obtain-box"></span>
      </label>
      <a class="item-link" href="${itemUrl(ch.version, itemId)}" target="_blank" rel="noopener"
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
const loadoutDialog = $('#loadoutDialog');
const addItemDialog = $('#addItemDialog');
let editingCharId = null;
let loadoutMode = 'new'; // or 'rename'
let addItemSlot = null;

function fillCharForm(ch) {
  const f = $('#charForm');
  f.cls.innerHTML = Object.entries(CLASSES).map(([k, v]) =>
    `<option value="${k}">${v.label}</option>`).join('');
  f.version.innerHTML = Object.entries(GAME_VERSIONS).map(([k, v]) =>
    `<option value="${k}">${v.label}</option>`).join('');
  f.name.value = ch?.name ?? '';
  f.race.value = ch?.race ?? '';
  f.cls.value = ch?.cls ?? 'other';
  f.version.value = ch?.version ?? 'forever';
}

function openCharDialog(ch = null) {
  editingCharId = ch?.id ?? null;
  $('#charDialogTitle').textContent = ch ? 'Edit character' : 'New character';
  fillCharForm(ch);
  charDialog.showModal();
}

function openLoadoutDialog(mode) {
  loadoutMode = mode;
  const lo = activeLoadout();
  $('#loadoutDialogTitle').textContent = mode === 'rename' ? 'Rename loadout' : 'New loadout';
  $('#loadoutForm').name.value = mode === 'rename' ? (lo?.name ?? '') : '';
  loadoutDialog.showModal();
}

function openAddItemDialog(slotKey) {
  addItemSlot = slotKey;
  const ch = activeCharacter();
  $('#addItemSlotName').textContent = SLOTS.find((s) => s.key === slotKey)?.label ?? slotKey;
  $('#addItemInput').value = '';
  $('#addItemResults').innerHTML = '';
  setAddStatus(null);
  $('#addItemWowheadLink').href = searchUrl(ch.version, '');
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
  if (!ch || !lo || !addItemSlot) return;
  setAddStatus('Fetching item details from Wowhead…');
  let item;
  try {
    item = await fetchItem(ch.version, id);
  } catch {
    item = { id: String(id), name: fallbackName || `Item ${id}`, quality: null, icon: null, fetched: false };
    setAddStatus('Could not fetch details (offline or blocked) — added with the info available. Use ↻ on the item to retry.', 'warn');
  }
  if (lo.slots[addItemSlot].includes(String(id))) {
    setAddStatus(`${item.name} is already in this slot.`, 'warn');
    return;
  }
  addItemToSlot(ch, lo, addItemSlot, item);
  if (item.fetched) setAddStatus(`Added ${item.name}. Add another, or close.`, 'ok');
  renderAll();
}

async function runAddItemSearch(raw) {
  const ch = activeCharacter();
  const parsed = parseItemInput(raw);
  if (!parsed) return;
  if (parsed.id) { await addItemById(parsed.id, parsed.name); return; }

  // Name search
  $('#addItemWowheadLink').href = searchUrl(ch.version, parsed.query);
  setAddStatus('Searching Wowhead…');
  try {
    const results = await searchItems(ch.version, parsed.query);
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
    version: f.version.value,
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

// Dialog: loadout save
$('#loadoutForm').addEventListener('submit', () => {
  const name = $('#loadoutForm').name.value.trim();
  if (!name) return;
  const ch = activeCharacter();
  if (!ch) return;
  if (loadoutMode === 'rename') {
    const lo = activeLoadout(ch);
    if (lo) lo.name = name;
  } else {
    const lo = makeLoadout(name);
    ch.loadouts.push(lo);
    setActiveLoadout(ch, lo.id);
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
for (const dlg of [charDialog, loadoutDialog, addItemDialog]) {
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
  const { action, slot, item: itemId, id } = btn.dataset;

  switch (action) {
    case 'new-char': openCharDialog(); break;
    case 'new-loadout': openLoadoutDialog('new'); break;
    case 'rename-loadout': openLoadoutDialog('rename'); break;
    case 'delete-loadout':
      if (lo && confirm(`Delete loadout “${lo.name}”? Item notes and obtained status are kept.`)) {
        ch.loadouts = ch.loadouts.filter((l) => l.id !== lo.id);
        setActiveLoadout(ch, ch.loadouts[0]?.id ?? null);
        save();
        renderAll();
      }
      break;
    case 'pick-loadout': setActiveLoadout(ch, id); renderAll(); break;
    case 'add-item': openAddItemDialog(slot); break;
    case 'remove-item': removeItemFromSlot(ch, lo, slot, itemId); renderAll(); break;
    case 'move-up': moveItemInSlot(lo, slot, itemId, -1); renderAll(); break;
    case 'move-down': moveItemInSlot(lo, slot, itemId, +1); renderAll(); break;
    case 'toggle-note': {
      const key = `${lo.id}/${slot}/${itemId}`;
      openNotes.has(key) ? openNotes.delete(key) : openNotes.add(key);
      renderAll();
      break;
    }
    case 'refresh-item':
      fetchItem(ch.version, itemId).then((item) => {
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
