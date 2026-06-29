/*
 * popup.js — rendert den Zustand aus dem Service-Worker.
 */

const SECTION_ORDER = ['green', 'yellow', 'red', 'other'];
const SECTION_LABEL = { green: 'Grüne Ampel', yellow: 'Gelbe Ampel', red: 'Rote Ampel', other: 'Sonstige' };

let state = null;       // { baseline, current, settings, meta, diff }
let changedIds = new Set();
let collapsed = { green: true, yellow: true, red: true, other: true };

const api = globalThis.browser || globalThis.chrome;

function send(msg) {
  // Promise-Form funktioniert in Chrome (MV3) und Firefox gleichermaßen.
  return api.runtime.sendMessage(msg);
}

function fmtTime(ts) {
  if (!ts) return '–';
  const d = new Date(ts);
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function colorOf(stock) { return stock.color || 'other'; }

// --- Render: Statuszeile ----------------------------------------------------
function renderStatus() {
  const el = document.getElementById('status');
  const meta = state.meta || {};
  if (!state.current) {
    if (meta.lastPollOk === false && meta.lastError) {
      el.textContent = 'Abruf fehlgeschlagen: ' + meta.lastError +
        ' – in Firefox bitte die Skool-Ampel-Seite öffnen (eingeloggt).';
    } else {
      el.textContent = 'Noch keine Daten – öffne die Skool-Ampel-Seite oder klicke „Jetzt prüfen".';
    }
    el.classList.toggle('error', meta.lastPollOk === false);
    return;
  }
  const src = meta.source === 'page' ? 'Seitenbesuch' : 'Abruf';
  let txt = state.current.stockCount + ' Aktien · zuletzt ' + fmtTime(meta.lastPollAt) + ' (' + src + ')';
  if (meta.lastPollOk === false && meta.lastError) txt = 'Fehler: ' + meta.lastError;
  el.textContent = txt;
  el.classList.toggle('error', meta.lastPollOk === false);
}

// --- Render: Änderungen seit letztem Besuch ---------------------------------
function renderChanges() {
  const list = document.getElementById('changesList');
  const ackBtn = document.getElementById('ackBtn');
  const empty = { added: [], removed: [], moved: [], edited: [], sectionAdded: [], sectionRemoved: [], sectionEdited: [] };
  const d = Object.assign({}, empty, state.diff || {});
  list.innerHTML = '';
  changedIds = new Set();

  const rows = [];
  // Menüpunkte zuerst, damit strukturelle Änderungen oben stehen.
  d.sectionAdded.forEach((s) => rows.push({ s: { id: s.id, name: s.title }, tag: 'added', label: 'Neu', detail: 'Menüpunkt' }));
  d.sectionRemoved.forEach((s) => rows.push({ s: { id: s.id, name: s.title }, tag: 'removed', label: 'Entfernt', detail: 'Menüpunkt' }));
  d.sectionEdited.forEach((s) => rows.push({ s: { id: s.id, name: s.title }, tag: 'edited', label: 'Bearbeitet', detail: 'Menüpunkt' }));
  d.moved.forEach((s) => rows.push({ s, tag: 'moved', label: 'Wechsel',
    detail: (SECTION_LABEL[s.from] || s.from) + ' → ' + (SECTION_LABEL[s.to] || s.to) }));
  d.added.forEach((s) => rows.push({ s, tag: 'added', label: 'Neu', detail: SECTION_LABEL[colorOf(s)] }));
  d.edited.forEach((s) => rows.push({ s, tag: 'edited', label: 'Bearbeitet', detail: SECTION_LABEL[colorOf(s)] }));
  d.removed.forEach((s) => rows.push({ s, tag: 'removed', label: 'Entfernt', detail: '' }));

  rows.forEach((r) => { if (r.s.id) changedIds.add(r.s.id); });

  if (rows.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Keine Änderungen seit deinem letzten Besuch.';
    list.appendChild(li);
    ackBtn.hidden = true;
    return;
  }

  ackBtn.hidden = false;
  for (const r of rows) {
    const li = document.createElement('li');
    li.title = 'In Skool öffnen';

    const tag = document.createElement('span');
    tag.className = 'tag ' + r.tag;
    tag.textContent = r.label;

    const name = document.createElement('span');
    name.className = 'chg-name';
    name.textContent = r.s.name;

    const detail = document.createElement('span');
    detail.className = 'chg-detail';
    detail.textContent = r.detail;

    li.append(tag, name, detail);
    if (r.s.id) li.addEventListener('click', () => openStock(r.s.id));
    list.appendChild(li);
  }
}

// --- Render: Ampel-Gruppen --------------------------------------------------
function groupedStocks() {
  const groups = { green: [], yellow: [], red: [], other: [] };
  const stocks = (state.current && state.current.stocks) || {};
  for (const id of Object.keys(stocks)) {
    const s = stocks[id];
    (groups[colorOf(s)] || groups.other).push(s);
  }
  for (const k of Object.keys(groups)) {
    groups[k].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }
  return groups;
}

function renderGroups() {
  const root = document.getElementById('groups');
  const filter = document.getElementById('search').value.trim().toLowerCase();
  const groups = groupedStocks();
  root.innerHTML = '';

  for (const color of SECTION_ORDER) {
    const all = groups[color];
    if (!all || all.length === 0) continue;
    const items = filter ? all.filter((s) => s.name.toLowerCase().includes(filter)) : all;
    if (filter && items.length === 0) continue;

    const group = document.createElement('section');
    group.className = 'group' + (collapsed[color] && !filter ? ' collapsed' : '');

    const changedInGroup = all.filter((s) => changedIds.has(s.id)).length;
    const head = document.createElement('div');
    head.className = 'group-head';
    head.innerHTML =
      '<span class="dot ' + color + '"></span>' +
      '<span class="group-title">' + SECTION_LABEL[color] + '</span>' +
      (changedInGroup ? '<span class="changed-chip" title="geänderte Aktien">' + changedInGroup + ' geändert</span>' : '') +
      '<span class="group-count">' + items.length + (filter ? '/' + all.length : '') + '</span>' +
      '<span class="chev">▾</span>';
    head.addEventListener('click', () => {
      collapsed[color] = !collapsed[color];
      group.classList.toggle('collapsed');
    });

    const ul = document.createElement('ul');
    ul.className = 'stock-list';
    for (const s of items) {
      const li = document.createElement('li');
      if (changedIds.has(s.id)) li.classList.add('changed');
      const name = document.createElement('span');
      name.className = 'stock-name';
      name.textContent = s.name;
      li.appendChild(name);
      if (changedIds.has(s.id)) {
        const cd = document.createElement('span');
        cd.className = 'changed-dot';
        cd.title = 'geändert';
        li.appendChild(cd);
      }
      li.title = 'In Skool öffnen';
      li.addEventListener('click', () => openStock(s.id));
      ul.appendChild(li);
    }

    group.append(head, ul);
    root.appendChild(group);
  }

  if (!root.children.length) {
    const p = document.createElement('p');
    p.style.cssText = 'color:var(--muted);padding:12px;text-align:center;';
    p.textContent = state.current ? 'Keine Treffer.' : 'Noch keine Daten geladen.';
    root.appendChild(p);
  }
}

function openStock(id) {
  api.tabs.create({ url: stockUrl(id) });
}

function renderAll() {
  renderStatus();
  renderChanges();
  renderGroups();
  const iv = document.getElementById('interval');
  if (document.activeElement !== iv) iv.value = state.settings.intervalMinutes;
}

// --- Init + Events ----------------------------------------------------------
async function init() {
  state = await send({ type: 'getState' });
  renderAll();
}

document.getElementById('search').addEventListener('input', renderGroups);

document.getElementById('pollNow').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Prüfe…';
  const r = await send({ type: 'pollNow' });
  state = r;
  renderAll();
  btn.disabled = false;
  btn.textContent = 'Jetzt prüfen';
});

document.getElementById('ackBtn').addEventListener('click', async () => {
  state = await send({ type: 'acknowledge' });
  renderAll();
});

document.getElementById('saveInterval').addEventListener('click', async () => {
  const minutes = Number(document.getElementById('interval').value) || state.settings.intervalMinutes;
  await send({ type: 'setInterval', minutes });
  state.settings.intervalMinutes = Math.max(1, minutes);
  const btn = document.getElementById('saveInterval');
  btn.textContent = 'Gespeichert ✓';
  setTimeout(() => (btn.textContent = 'Speichern'), 1500);
});

init();
