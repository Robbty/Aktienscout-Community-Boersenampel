/*
 * popup.js — rendert den Zustand aus dem Service-Worker.
 */

const SECTION_ORDER = ['green', 'yellow', 'red', 'other'];
const SECTION_LABEL = { green: 'Grüne Ampel', yellow: 'Gelbe Ampel', red: 'Rote Ampel', other: 'Sonstige' };

let state = null;       // { baseline, current, settings, meta, diff, circle, circleMeta }
let changedIds = new Set();
let collapsed = { green: true, yellow: true, red: true, other: true };
let activeTab = 'ampel';   // 'ampel' | 'circle' — bewusst nicht persistiert
let circleChecked = false; // Zugang pro Popup-Öffnung nur einmal frisch prüfen

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

function relDays(ts) {
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) return 'heute';
  if (d === 1) return 'gestern';
  return 'vor ' + d + ' Tagen';
}

function colorOf(stock) { return stock.color || 'other'; }

// --- Render: Statuszeile ----------------------------------------------------
function renderStatus() {
  if (activeTab !== 'ampel') return; // die Kopf-Statuszeile gehört gerade dem Circle-Tab
  const el = document.getElementById('status');
  const meta = state.meta || {};
  // Eingeloggt, aber kein Mitglied -> VIP-Hinweis (Block darunter zeigt den Link).
  if (meta.lastPollOk === false && meta.access === 'noAccess') {
    el.innerHTML =
      '<span class="status-head">Kein Zugang zur Börsenampel</span>' +
      '<span class="status-hint">Angemeldet bist du – es fehlt nur die Mitgliedschaft (VIP oder Circle).</span>';
    el.classList.add('error');
    return;
  }
  if (!state.current) {
    if (meta.lastPollOk === false) {
      el.innerHTML =
        '<span class="status-head">Eingeloggt?</span>' +
        '<span class="status-hint">Melde dich bei skool.com an – das genügt. ' +
        'Du musst weder auf der Börsenampel-Seite noch in der richtigen Community sein. ' +
        'Danach „Jetzt prüfen".</span>';
      el.classList.add('error');
    } else {
      el.textContent = 'Noch keine Daten – bei skool.com anmelden und „Jetzt prüfen".';
      el.classList.remove('error');
    }
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

// --- Render: Statuswechsel-Logbuch (letzte X Tage) --------------------------
function historyMeta(e) {
  switch (e.type) {
    case 'moved': return { label: 'Wechsel', cls: 'moved', detail: (SECTION_LABEL[e.from] || e.from) + ' → ' + (SECTION_LABEL[e.to] || e.to), openable: true };
    case 'added': return { label: 'Neu', cls: 'added', detail: SECTION_LABEL[e.color] || '', openable: true };
    case 'removed': return { label: 'Entfernt', cls: 'removed', detail: '', openable: false };
    case 'sectionAdded': return { label: 'Neu', cls: 'added', detail: 'Menüpunkt', openable: true };
    case 'sectionRemoved': return { label: 'Entfernt', cls: 'removed', detail: 'Menüpunkt', openable: false };
    default: return { label: '?', cls: '', detail: '', openable: false };
  }
}

// Ehrliche Leer-Meldung — abhängig davon, ob überhaupt schon etwas geloggt wurde
// und seit wann überwacht wird.
function emptyHistoryText(days) {
  const total = (state.history || []).length;
  if (total > 0) {
    return 'Keine Statuswechsel in den letzten ' + days + ' Tagen. Ältere sind vorhanden – Zeitraum erhöhen.';
  }
  const sinceTs = state.meta && state.meta.watchingSince ? Date.parse(state.meta.watchingSince) : NaN;
  if (!isNaN(sinceTs)) {
    const sinceDays = Math.floor((Date.now() - sinceTs) / 86400000);
    const seit = new Date(sinceTs).toLocaleDateString('de-DE');
    if (sinceDays >= 1) return 'Seit ' + seit + ' überwacht – bisher keine Statuswechsel.';
    return 'Überwachung läuft (seit heute) – bisher keine Statuswechsel.';
  }
  return 'Noch keine Statuswechsel aufgezeichnet (wird ab jetzt mitgeschrieben).';
}

function renderHistory() {
  const list = document.getElementById('historyList');
  const days = (state.settings && state.settings.activityDays) || 7;
  const cutoff = Date.now() - days * 86400000;
  const rows = (state.history || [])
    .map((e) => ({ e, ts: Date.parse(e.at) }))
    .filter((r) => !isNaN(r.ts) && r.ts >= cutoff)
    .sort((a, b) => b.ts - a.ts);

  list.innerHTML = '';
  if (rows.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = emptyHistoryText(days);
    list.appendChild(li);
    return;
  }
  for (const { e, ts } of rows) {
    const m = historyMeta(e);
    const li = document.createElement('li');
    const tag = document.createElement('span');
    tag.className = 'tag ' + m.cls;
    tag.textContent = m.label;
    const name = document.createElement('span');
    name.className = 'chg-name';
    name.textContent = e.name;
    const detail = document.createElement('span');
    detail.className = 'chg-detail';
    detail.textContent = m.detail;
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = relDays(ts) + ' · ' + new Date(ts).toLocaleDateString('de-DE');
    li.append(tag, name, detail, when);
    if (m.openable) {
      li.title = 'In Skool öffnen';
      li.addEventListener('click', () => openStock(e.id));
    } else {
      li.style.cursor = 'default';
    }
    list.appendChild(li);
  }
}

// --- Render: Aktivität (letzte X Tage) aus updatedAt ------------------------
function renderActivity() {
  const list = document.getElementById('activityList');
  const days = (state.settings && state.settings.activityDays) || 7;
  const cutoff = Date.now() - days * 86400000;
  const stocks = (state.current && state.current.stocks) || {};

  const rows = Object.keys(stocks)
    .map((id) => ({ s: stocks[id], ts: Date.parse(stocks[id].updatedAt) }))
    .filter((r) => !isNaN(r.ts) && r.ts >= cutoff)
    .sort((a, b) => b.ts - a.ts);

  list.innerHTML = '';
  if (rows.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Keine Aktie in den letzten ' + days + ' Tagen geändert.';
    list.appendChild(li);
    return;
  }
  for (const { s, ts } of rows) {
    const li = document.createElement('li');
    li.title = 'In Skool öffnen';
    const dot = document.createElement('span');
    dot.className = 'dot ' + colorOf(s);
    const name = document.createElement('span');
    name.className = 'stock-name';
    name.textContent = s.name;
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = relDays(ts) + ' · ' + new Date(ts).toLocaleDateString('de-DE');
    li.append(dot, name, when);
    li.addEventListener('click', () => openStock(s.id));
    list.appendChild(li);
  }
}

// --- Phase 2: Detailansicht -------------------------------------------------
// Klick auf eine Aktie öffnet die Analyse direkt im Popup (Tier-2-Body via
// Service-Worker, gecacht). Aktien, die es im aktuellen Snapshot nicht mehr
// gibt (z. B. "Entfernt"-Einträge), öffnen weiterhin Skool.
let detailStockId = null;

function closeStockDetail() {
  detailStockId = null;
  document.getElementById('stockDetail').hidden = true;
  document.getElementById('tab-ampel').classList.remove('detail-open');
}

async function openStock(id) {
  const stocks = (state.current && state.current.stocks) || {};
  const s = stocks[id];
  if (!s) {
    api.tabs.create({ url: stockUrl(id) });
    return;
  }
  detailStockId = id;
  document.getElementById('tab-ampel').classList.add('detail-open');
  document.getElementById('stockDetail').hidden = false;
  document.getElementById('detailName').textContent = s.name;
  document.getElementById('detailDot').className = 'dot ' + colorOf(s);
  document.getElementById('detailMeta').textContent =
    (SECTION_LABEL[colorOf(s)] || s.section) +
    ' · zuletzt bearbeitet ' + fmtTime(Date.parse(s.updatedAt));
  document.getElementById('detailOpenSkool').href = stockUrl(id);

  const body = document.getElementById('detailBody');
  body.className = 'detail-body loading';
  body.textContent = 'Lade Analyse…';
  const r = await send({ type: 'getStockBody', id });
  if (detailStockId !== id) return; // inzwischen weitergeklickt/geschlossen
  if (r && r.ok) {
    body.className = 'detail-body';
    body.textContent = r.text || 'Dieses Modul hat keinen Textinhalt.';
  } else {
    body.className = 'detail-body error';
    body.textContent =
      'Analyse konnte nicht geladen werden' +
      (r && r.error ? ' (' + r.error + ')' : '') +
      ' – „In Skool öffnen" oben rechts geht trotzdem.';
  }
}

document.getElementById('detailBack').addEventListener('click', closeStockDetail);

// Ampel-Daten nur zeigen, wenn der letzte Abruf erfolgreich war (= eingeloggt).
// So sind nach dem Ausloggen keine zwischengespeicherten Daten mehr sichtbar.
function isLoggedIn() {
  return !!(state && state.current && state.meta && state.meta.lastPollOk === true);
}

function setDataVisible(ok) {
  document.getElementById('changes').hidden = !ok;
  document.getElementById('history').hidden = !ok;
  document.getElementById('activity').hidden = !ok;
  document.querySelector('.searchbar').hidden = !ok;
  document.getElementById('groups').hidden = !ok;
}

function renderAll() {
  renderStatus();
  const ok = isLoggedIn();
  setDataVisible(ok);
  // VIP-Hinweis nur im "eingeloggt, aber kein Mitglied"-Fall.
  const noAccess = !ok && state.meta && state.meta.access === 'noAccess';
  document.getElementById('ampelNoAccess').hidden = !noAccess;
  document.getElementById('ampelJoin').href = AMPEL_CONFIG.joinUrl;
  // Auch eine Circle-Mitgliedschaft schaltet die Börsenampel frei.
  document.getElementById('ampelJoinCircle').href = CIRCLE_CONFIG.joinUrl;
  if (ok) {
    renderChanges();
    renderHistory();
    renderActivity();
    renderGroups();
  }
  const iv = document.getElementById('interval');
  if (state.settings && document.activeElement !== iv) iv.value = state.settings.intervalMinutes;
  const days = document.getElementById('activityDays');
  if (state.settings && document.activeElement !== days) days.value = state.settings.activityDays || 7;
  const blink = document.getElementById('blink');
  if (state.settings) blink.checked = state.settings.blinkEnabled !== false;
}

function showChecking() {
  const el = document.getElementById('status');
  el.classList.remove('error');
  el.textContent = 'Prüfe Login…';
  setDataVisible(false); // nichts Sensibles zeigen, bis der Login bestätigt ist
  document.getElementById('ampelNoAccess').hidden = true;
}

// --- Circle-Tab ---------------------------------------------------------------
// Die Auswertung (computePortfolio) läuft komplett hier im Popup über den vom
// Worker geernteten Modul-Stand — nichts Aggregiertes wird persistiert, damit
// Parser-Korrekturen rückwirkend alle Zahlen richtigstellen.
const CIRCLE_BLOCKS = ['circleSummary', 'circleLog', 'circleOpen', 'circleClosed', 'circleUnparseable'];

function fmtEur(n) {
  return Number(n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

function signClass(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : ''; }

function setCircleStatus(text, isError) {
  if (activeTab !== 'circle') return;
  const el = document.getElementById('status');
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}

function hideCircleBlocks() {
  for (const id of CIRCLE_BLOCKS.concat('circleNoAccess')) document.getElementById(id).hidden = true;
}

function openCircleModule(id) {
  api.tabs.create({ url: circleModuleUrl(id) });
}

function td(text, cls) {
  const el = document.createElement('td');
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

function posRow(p) {
  const tr = document.createElement('tr');
  if (p.incomplete) {
    tr.classList.add('incomplete');
    tr.title = '⚠ Unvollständige Angaben – nicht in den Summen enthalten. Klick öffnet das Modul.';
  } else {
    tr.title = 'In Skool öffnen';
  }
  tr.addEventListener('click', () => openCircleModule(p.id));
  return tr;
}

// Prozent-Unterzeile ("+10,3 %") an eine Zelle hängen.
function appendPct(cell, pctVal) {
  const pct = document.createElement('span');
  pct.className = 'pct';
  pct.textContent = (pctVal > 0 ? '+' : '') + pctVal.toLocaleString('de-DE') + ' %';
  cell.appendChild(pct);
}

// Spalten: Aktie | Stück | EK-Preis | Einsatz | Akt. Kurs | Kursziel | Tage | Chart.
// "Akt. Kurs" (echter Börsenkurs, mit % zum EK) und der Chart-Knopf sind
// Platzhalter, bis in Phase 3 eine Kurs-API angebunden ist. Das Kursziel ist
// der vom Autor im Modultitel gepflegte geplante Verkaufskurs.
function renderCircleOpenTable(rows) {
  const sec = document.getElementById('circleOpen');
  const tbody = sec.querySelector('tbody');
  tbody.innerHTML = '';
  sec.hidden = rows.length === 0;
  document.getElementById('circleOpenCount').textContent = String(rows.length);
  for (const p of rows) {
    const tr = posRow(p);
    tr.append(
      td(p.name, 'name'),
      td(p.qty != null ? String(p.qty) : '–', 'num'),
      td(p.buyPriceEur != null ? fmtEur(p.buyPriceEur) : '–', 'num'),
      td(p.totalBuyEur != null ? fmtEur(p.totalBuyEur) : '–', 'num'),
      td('–', 'num'), // Akt. Kurs: Kursquelle folgt in Phase 3
    );

    // Kursziel, darunter das Potenzial in % bezogen auf den Einsatz.
    const ziel = td(p.currentPrice != null ? fmtEur(p.currentPrice) : '–', 'num');
    if (p.unrealizedPct != null) {
      const cls = signClass(p.unrealizedPct);
      if (cls) ziel.classList.add(cls);
      appendPct(ziel, p.unrealizedPct);
    }
    tr.appendChild(ziel);

    const buyTs = p.buyDate != null ? parseGermanDate(p.buyDate) : null;
    const daysHeld = buyTs != null ? Math.max(0, Math.floor((Date.now() - buyTs) / 86400000)) : null;
    const tage = td(daysHeld != null ? daysHeld + ' T.' : '–', 'num');
    if (p.buyDate) tage.title = 'Kauf am ' + p.buyDate;
    tr.appendChild(tage);

    const chartCell = td('', 'chart-col');
    const chartBtn = document.createElement('button');
    chartBtn.className = 'chart-btn';
    chartBtn.type = 'button';
    chartBtn.textContent = '📈';
    chartBtn.disabled = true;
    chartBtn.title = 'Kurs-Chart – folgt in Phase 3';
    chartCell.appendChild(chartBtn);
    tr.appendChild(chartCell);

    tbody.appendChild(tr);
  }
}

function renderCircleClosedTable(rows) {
  const sec = document.getElementById('circleClosed');
  const tbody = sec.querySelector('tbody');
  tbody.innerHTML = '';
  sec.hidden = rows.length === 0;
  document.getElementById('circleClosedCount').textContent = String(rows.length);
  for (const p of rows) {
    const tr = posRow(p);
    tr.append(
      td(p.name, 'name'),
      td(p.totalBuyEur != null ? fmtEur(p.totalBuyEur) : '–', 'num'),
    );
    const er = td(p.ertragEur != null ? fmtEur(p.ertragEur) : '–', 'num');
    const cls = p.ertragEur != null ? signClass(p.ertragEur) : '';
    if (cls) er.classList.add(cls);
    if (p.ertragPct != null) {
      const pct = document.createElement('span');
      pct.className = 'pct';
      pct.textContent = (p.ertragPct > 0 ? '+' : '') + p.ertragPct.toLocaleString('de-DE') + ' %';
      er.appendChild(pct);
    }
    tr.appendChild(er);
    tr.appendChild(td(p.holdingDays != null ? p.holdingDays + ' T.' : '–', 'num'));
    tbody.appendChild(tr);
  }

  // Summenzeile: Einsatz- und Ertrag-Summe (= realisierter Gewinn) sowie die
  // Durchschnittsdauer — jeweils nur über die Positionen mit vorhandenem Wert.
  const buys = rows.filter((p) => p.totalBuyEur != null).map((p) => p.totalBuyEur);
  const gains = rows.filter((p) => p.ertragEur != null).map((p) => p.ertragEur);
  const days = rows.filter((p) => p.holdingDays != null).map((p) => p.holdingDays);
  const sum = (a) => a.reduce((x, y) => x + y, 0);

  document.getElementById('closedSumBuy').textContent = buys.length ? fmtEur(sum(buys)) : '–';
  const sumErtrag = document.getElementById('closedSumErtrag');
  sumErtrag.classList.remove('pos', 'neg');
  if (gains.length) {
    const total = sum(gains);
    sumErtrag.textContent = fmtEur(total);
    const totalCls = signClass(total);
    if (totalCls) sumErtrag.classList.add(totalCls);
    const totalBuy = sum(buys);
    if (totalBuy > 0) {
      const pct = document.createElement('span');
      pct.className = 'pct';
      const pctVal = Math.round((total / totalBuy) * 10000) / 100;
      pct.textContent = (pctVal > 0 ? '+' : '') + pctVal.toLocaleString('de-DE') + ' %';
      sumErtrag.appendChild(pct);
    }
  } else {
    sumErtrag.textContent = '–';
  }
  document.getElementById('closedAvgDays').textContent = days.length
    ? '⌀ ' + (sum(days) / days.length).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' T.'
    : '–';
}

// Logbuch der erkannten Käufe/Verkäufe (Ereignisse zwischen den Abrufen).
function renderCircleLog(pending) {
  const sec = document.getElementById('circleLog');
  const ul = document.getElementById('circleLogList');
  const rows = (state.circleHistory || [])
    .map((e) => ({ e, ts: Date.parse(e.at) || Date.parse(e.detectedAt) || 0 }))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 30); // die jüngsten 30 reichen im Popup

  ul.innerHTML = '';
  document.getElementById('circleLogCount').textContent = String((state.circleHistory || []).length);
  sec.hidden = false;
  // Bei unbestätigten Ereignissen automatisch aufklappen, sonst Zustand lassen.
  if (pending > 0) sec.classList.remove('collapsed');

  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Noch keine Käufe/Verkäufe beobachtet (wird ab jetzt mitgeschrieben).';
    ul.appendChild(li);
    return;
  }
  for (const { e, ts } of rows) {
    const li = document.createElement('li');
    const tag = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'chg-name';
    name.textContent = e.name;
    const detail = document.createElement('span');
    detail.className = 'chg-detail';
    if (e.type === 'bought') {
      tag.className = 'tag bought';
      tag.textContent = 'Gekauft';
      detail.textContent = e.totalBuyEur != null ? fmtEur(e.totalBuyEur) : '';
    } else if (e.type === 'sold') {
      tag.className = 'tag sold';
      tag.textContent = 'Verkauft';
      const parts = [];
      if (e.ertragEur != null) parts.push((e.ertragEur >= 0 ? '+' : '') + fmtEur(e.ertragEur));
      if (e.holdingDays != null) parts.push(e.holdingDays + ' T.');
      detail.textContent = parts.join(' · ');
    } else {
      tag.className = 'tag removed';
      tag.textContent = 'Entfernt';
      detail.textContent = '';
    }
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = ts ? relDays(ts) : '';
    li.append(tag, name, detail, when);
    if (e.type !== 'removed') {
      li.title = 'In Skool öffnen';
      li.addEventListener('click', () => openCircleModule(e.id));
    } else {
      li.style.cursor = 'default';
    }
    ul.appendChild(li);
  }
}

function renderCircleUnparseable(rows) {
  const sec = document.getElementById('circleUnparseable');
  const ul = sec.querySelector('ul');
  ul.innerHTML = '';
  sec.hidden = rows.length === 0;
  for (const u of rows) {
    const li = document.createElement('li');
    li.title = 'In Skool öffnen';
    const name = document.createElement('span');
    name.className = 'chg-name';
    name.textContent = u.title;
    const detail = document.createElement('span');
    detail.className = 'chg-detail';
    detail.textContent = u.reason;
    li.append(name, detail);
    li.addEventListener('click', () => openCircleModule(u.id));
    ul.appendChild(li);
  }
}

function renderCircle() {
  if (activeTab !== 'circle') return;
  const meta = state.circleMeta || {};
  const ok = !!(state.circle && state.circle.modules && meta.lastPollOk === true);

  document.getElementById('circleJoin').href = CIRCLE_CONFIG.joinUrl;

  if (!ok) {
    // Gleiche Privacy-Regel wie bei der Ampel: ohne bestätigten Zugang keine
    // zwischengespeicherten Bezahldaten anzeigen.
    hideCircleBlocks();
    if (meta.access === 'noAccess') {
      document.getElementById('circleNoAccess').hidden = false;
      setCircleStatus('Kein Zugang zum Circle-Kurs.', true);
    } else if (meta.access === 'loggedOut') {
      setCircleStatus('Eingeloggt? Melde dich bei skool.com an und öffne das Popup erneut.', true);
    } else {
      setCircleStatus('Abruf fehlgeschlagen' + (meta.lastError ? ': ' + meta.lastError : '') + '.', true);
    }
    return;
  }

  document.getElementById('circleNoAccess').hidden = true;
  const pf = computePortfolio(state.circle.modules);

  const setStat = (id, val, signed) => {
    const el = document.getElementById(id);
    el.textContent = fmtEur(val);
    el.classList.remove('pos', 'neg');
    if (signed) {
      const cls = signClass(val);
      if (cls) el.classList.add(cls);
    }
  };
  setStat('cInvested', pf.investedCumulative);
  setStat('cDeployed', pf.deployedOpen);
  setStat('cRealized', pf.realized, true);
  setStat('cUnrealized', pf.unrealizedTotal, true);

  // Gegenprobe: die vom Autor selbst gepflegten Summen aus "Statistik aktuell".
  const cc = document.getElementById('cCrosscheck');
  if (pf.statistik) {
    const parts = [];
    if (pf.statistik.eingesetztesKapital != null) parts.push('eingesetzt ' + fmtEur(pf.statistik.eingesetztesKapital));
    if (pf.statistik.zuwachs != null) parts.push('Zuwachs ' + fmtEur(pf.statistik.zuwachs));
    cc.textContent = 'Autor-Statistik: ' + parts.join(' · ');
    cc.hidden = parts.length === 0;
  } else {
    cc.hidden = true;
  }
  document.getElementById('circleSummary').hidden = false;

  const open = pf.positions.filter((p) => p.status === 'open');
  const closed = pf.positions.filter((p) => p.status === 'closed');
  renderCircleLog(meta.pending || 0);
  renderCircleClosedTable(closed); // steht im Popup vor den laufenden Positionen
  renderCircleOpenTable(open);
  renderCircleUnparseable(pf.unparseable);

  setCircleStatus(
    open.length + ' laufend · ' + closed.length + ' abgeschlossen · zuletzt ' + fmtTime(meta.lastPollAt),
    false,
  );

  // Angesehen -> goldenen Punkt auf dem Icon löschen.
  if ((meta.pending || 0) > 0) {
    state.circleMeta = { ...meta, pending: 0 };
    send({ type: 'circleSeen' });
  }
}

// Beim Öffnen des Circle-Tabs den Zugang frisch prüfen (und dabei nichts
// Sensibles zeigen) — danach rendern.
async function refreshCircle() {
  hideCircleBlocks();
  setCircleStatus('Prüfe Zugang…', false);
  const r = await send({ type: 'circlePollNow' });
  if (r) {
    state.circle = r.circle;
    state.circleMeta = r.circleMeta;
    state.circleHistory = r.circleHistory || state.circleHistory;
  }
  circleChecked = true;
  renderCircle();
}

function switchTab(tab) {
  activeTab = tab;
  document.getElementById('tab-ampel').hidden = tab !== 'ampel';
  document.getElementById('tab-circle').hidden = tab !== 'circle';
  document.getElementById('tabBtnAmpel').classList.toggle('active', tab === 'ampel');
  document.getElementById('tabBtnCircle').classList.toggle('active', tab === 'circle');
  document.getElementById('courseTitle').textContent =
    tab === 'circle' ? CIRCLE_CONFIG.displayName : 'Börsenampel';
  if (tab === 'ampel') {
    renderStatus();
  } else if (!circleChecked) {
    refreshCircle();
  } else {
    renderCircle();
  }
}

document.getElementById('tabBtnAmpel').addEventListener('click', () => switchTab('ampel'));
document.getElementById('tabBtnCircle').addEventListener('click', () => switchTab('circle'));

// Positions-Abschnitte auf-/zuklappen (Zustand hält für diese Popup-Öffnung,
// wie bei den Ampel-Gruppen).
document.getElementById('circleClosedToggle').addEventListener('click', () => {
  document.getElementById('circleClosed').classList.toggle('collapsed');
});
document.getElementById('circleOpenToggle').addEventListener('click', () => {
  document.getElementById('circleOpen').classList.toggle('collapsed');
});
document.getElementById('circleLogToggle').addEventListener('click', () => {
  document.getElementById('circleLog').classList.toggle('collapsed');
});

// --- Init + Events ----------------------------------------------------------
async function init() {
  state = await send({ type: 'getState' });
  // Bei jedem Öffnen den Login-Status frisch prüfen und dabei keine alten Daten
  // anzeigen, bevor der Abruf bestätigt, dass wir noch eingeloggt sind.
  showChecking();
  const r = await send({ type: 'pollNow' });
  if (r) state = r;
  renderAll();
}

function currentMatches() {
  const filter = document.getElementById('search').value.trim().toLowerCase();
  if (!filter) return [];
  const stocks = (state && state.current && state.current.stocks) || {};
  return Object.keys(stocks).map((id) => stocks[id]).filter((s) => s.name.toLowerCase().includes(filter));
}

const searchEl = document.getElementById('search');
searchEl.addEventListener('input', () => {
  // Beim Suchen oberen Bereich ausblenden, damit die Treffer sichtbar sind.
  document.body.classList.toggle('searching', searchEl.value.trim() !== '');
  renderGroups();
});
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const matches = currentMatches();
    if (matches.length === 1) openStock(matches[0].id); // genau ein Treffer -> öffnen
  }
});

document.getElementById('pollNow').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Prüfe…';
  if (activeTab === 'circle') {
    await refreshCircle();
  } else {
    const r = await send({ type: 'pollNow' });
    state = r;
    renderAll();
  }
  btn.disabled = false;
  btn.textContent = 'Jetzt prüfen';
});

document.getElementById('ackBtn').addEventListener('click', async () => {
  state = await send({ type: 'acknowledge' });
  renderAll();
});

document.getElementById('blink').addEventListener('change', async (e) => {
  const enabled = e.currentTarget.checked;
  await send({ type: 'setBlink', enabled });
  if (state.settings) state.settings.blinkEnabled = enabled;
});

document.getElementById('activityDays').addEventListener('input', async (e) => {
  const days = Math.max(1, Number(e.currentTarget.value) || 7);
  if (state.settings) state.settings.activityDays = days;
  renderHistory();                       // beide Listen sofort aktualisieren
  renderActivity();
  await send({ type: 'setActivityDays', days }); // und persistieren
});

document.getElementById('activityToggle').addEventListener('click', () => {
  document.getElementById('activity').classList.toggle('collapsed');
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
