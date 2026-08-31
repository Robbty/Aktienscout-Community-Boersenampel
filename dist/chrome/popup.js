/*
 * popup.js — rendert den Zustand aus dem Service-Worker.
 */

// Frische-Fenster: war der letzte erfolgreiche Abruf jünger als das, zeigt das
// Popup sofort die gespeicherten Daten und prüft nur im Hintergrund nach —
// statt den Nutzer bei jedem Öffnen auf den Login-Check warten zu lassen.
// (Bewusster Kompromiss zur Privacy-Regel: maximal 3 Minuten alte Daten
// könnten kurz sichtbar sein, falls man sich exakt dazwischen ausgeloggt hat.)
const FRESH_MS = 3 * 60 * 1000;

const SECTION_ORDER = ['green', 'yellow', 'red', 'other'];
const SECTION_LABEL = { green: 'Grüne Ampel', yellow: 'Gelbe Ampel', red: 'Rote Ampel', other: 'Sonstige' };

let state = null;       // { baseline, current, settings, meta, diff, circle, circleMeta }
let changedIds = new Set();
let collapsed = { green: true, yellow: true, red: true, other: true };
let activeTab = 'ampel';   // 'ampel' | 'circle' — bewusst nicht persistiert
let circleChecked = false; // Zugang pro Popup-Öffnung nur einmal frisch prüfen

const api = globalThis.browser || globalThis.chrome;

// Standalone-Modus: dieselbe Seite läuft als eigenständiges Circle-Fenster
// (popup.html?standalone=1) — bleibt offen, bis der Nutzer sie schließt.
const STANDALONE = new URLSearchParams(location.search).get('standalone') === '1';
// Start-Tab des Standalone-Fensters: Circle (klassisch) oder Ampel (↗ im Ampel-Tab).
const STANDALONE_TAB = new URLSearchParams(location.search).get('tab') === 'ampel' ? 'ampel' : 'circle';
if (STANDALONE) document.body.classList.add('standalone');

// Nur das echte Action-Popup hält einen Port zum Worker. Fenster-Wünsche gehen
// über diesen Port (Zustellung vor dem Trennen garantiert), danach schließt
// sich das Popup selbst — der Worker erzeugt die Fenster erst nach dem Trennen
// (sonst hängt der Fenstermanager sie ans Popup und schließt sie mit ihm).
const popupPort = STANDALONE ? null : api.runtime.connect({ name: 'popup' });

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

  // Legende, sobald mindestens ein Kurs sichtbar ist: was die Zahlen bedeuten.
  if (Object.values(ampelQuotes).some((q) => q && q.priceEur != null)) {
    const legend = document.createElement('div');
    legend.className = 'quote-legend';
    legend.textContent = 'Kurs in € · darunter Veränderung 24 h (zum Vortagesschluss)';
    legend.title = 'Kurse von Yahoo Finance. Die Prozentzahl vergleicht den aktuellen Kurs mit dem Schlusskurs des Vortags.';
    root.appendChild(legend);
  }

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
    // "Kurse laden" holt die Kurse aller (ggf. gefilterten) Aktien der Gruppe —
    // bewusst nur auf Klick, die Ampel führt 50+ Aktien.
    const groupLoading = items.some((s) => ampelQuotesLoading.has(s.id));
    const qBtn = document.createElement('button');
    qBtn.type = 'button';
    qBtn.className = 'link-btn quotes-btn';
    qBtn.textContent = groupLoading ? 'Kurse laden…' : 'Kurse laden';
    qBtn.disabled = groupLoading;
    qBtn.title = 'Aktuelle Kurse (Yahoo Finance) für alle Aktien dieser Gruppe holen';
    qBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadAmpelQuotes(items.map((s) => s.id));
    });
    head.insertBefore(qBtn, head.querySelector('.group-count'));

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
      li.append(ampelQuoteCell(s), ampelChartButton(s));
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
    // Alte, bereits geloggte "Neue Seite"-Einträge ebenfalls ausblenden.
    .filter((e) => !hiddenPlaceholderTitle(e.name))
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
    // Snapshots aus alten Versionen könnten noch "Neue Seite"-Einträge tragen.
    .filter((id) => !hiddenPlaceholderTitle(stocks[id].name))
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

// --- Ampel-Kurse (v0.7.1) ---------------------------------------------------
// Kurs + Veränderung zum Vortag je Aktie und 📈-Knopf wie im Circle — aber
// NICHTS wird automatisch geholt: beim Öffnen kommt nur, was der Worker schon
// im Cache hat (`cachedOnly`), alles Weitere erst auf "Kurse laden" (Gruppe)
// bzw. 📈 (einzelne Aktie). Der Worker meldet Zwischenstände über
// storage `ampelQuotesLive`, sodass die Zeilen einzeln auffüllen.
let ampelQuotes = {};                 // stockId -> {symbol, priceEur, changePct, stale, …} | {symbol:null}
const ampelQuotesLoading = new Set(); // IDs, für die gerade ein Abruf läuft
let ampelQuotesCachedLoaded = false;

async function loadAmpelQuotesCached() {
  if (ampelQuotesCachedLoaded) return;
  ampelQuotesCachedLoaded = true;
  const r = await send({ type: 'ampelQuotes', cachedOnly: true });
  if (r && r.ok && r.quotes) {
    ampelQuotes = { ...r.quotes, ...ampelQuotes };
    if (isLoggedIn()) renderGroups();
  }
}

async function loadAmpelQuotes(ids) {
  const fresh = ids.filter((id) => !ampelQuotesLoading.has(id));
  if (!fresh.length) return;
  for (const id of fresh) ampelQuotesLoading.add(id);
  renderGroups();
  const r = await send({ type: 'ampelQuotes', ids: fresh });
  for (const id of fresh) ampelQuotesLoading.delete(id);
  if (r && r.ok && r.quotes) ampelQuotes = { ...ampelQuotes, ...r.quotes };
  if (isLoggedIn()) renderGroups();
}

function ampelQuoteCell(s) {
  const cell = document.createElement('span');
  cell.className = 'stock-quote';
  const q = ampelQuotes[s.id];
  if (ampelQuotesLoading.has(s.id) && !(q && q.priceEur != null)) {
    cell.textContent = '…';
    cell.classList.add('muted');
    return cell;
  }
  if (!q) return cell; // noch nichts geladen -> leer (Knopf "Kurse laden")
  if (!q.symbol || q.priceEur == null) {
    cell.textContent = '–';
    cell.classList.add('muted');
    cell.title = !q.symbol
      ? 'Kein Yahoo-Symbol zu diesem Namen gefunden – wird beim nächsten Laden erneut versucht.'
      : q.symbol + ': Kurs nicht in Euro umrechenbar (Wechselkurs fehlt).';
    return cell;
  }
  cell.textContent = fmtEur(q.priceEur);
  if (q.stale) cell.classList.add('stale');
  cell.title =
    q.symbol +
    (q.currency && q.currency !== 'EUR' ? ' · ' + q.price.toLocaleString('de-DE') + ' ' + q.currency : '') +
    ' · Stand ' + fmtTime(q.at) +
    (q.stale ? ' (älter als 5 Min. – „Kurse laden" aktualisiert)' : '') +
    ' · darunter: Veränderung 24 h (zum Vortagesschluss)';
  if (q.changePct != null) {
    const cls = signClass(q.changePct);
    if (cls) cell.classList.add(cls);
    appendPct(cell, q.changePct);
  }
  return cell;
}

function ampelChartButton(s) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chart-btn';
  btn.textContent = '📈';
  const q = ampelQuotes[s.id];
  btn.title = q && q.symbol
    ? 'Kurs-Chart öffnen (' + q.symbol + ')'
    : 'Kurs-Chart öffnen (Symbol wird beim Klick ermittelt)';
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    let quote = ampelQuotes[s.id];
    if (!quote || !quote.symbol) {
      // Symbol noch unbekannt -> jetzt (nur für diese Aktie) auflösen.
      btn.disabled = true;
      btn.textContent = '…';
      await loadAmpelQuotes([s.id]);
      quote = ampelQuotes[s.id];
      if (!quote || !quote.symbol) {
        btn.textContent = '📈';
        btn.disabled = false;
        btn.title = 'Kein Yahoo-Symbol zu diesem Namen gefunden';
        return;
      }
    }
    openAmpelChart(s, quote);
  });
  return btn;
}

// Chart ohne EK/Kursziel-Linien (die Ampel kennt keine eigenen Käufe). Aus dem
// Action-Popup heraus: erst das eigenständige Fenster im Ampel-Tab, dann der
// Chart obendrauf — dieselbe Choreografie wie beim Circle (siehe openChartWindow).
function openAmpelChart(s, q) {
  const chartParams = { symbol: q.symbol, name: s.name };
  if (STANDALONE || !popupPort) {
    send({ type: 'openChart', params: chartParams });
    return;
  }
  popupPort.postMessage({
    type: 'openChart',
    params: chartParams,
    spawnCircle: true,
    tab: 'ampel',
    pos: { left: window.screenX, top: window.screenY },
  });
  window.close();
}

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
    loadAmpelQuotesCached(); // nur Cache, kein Netz — füllt bekannte Kurse nach
  }
  const iv = document.getElementById('interval');
  if (state.settings && document.activeElement !== iv) iv.value = state.settings.intervalMinutes;
  const days = document.getElementById('activityDays');
  if (state.settings && document.activeElement !== days) days.value = state.settings.activityDays || 7;
  const blink = document.getElementById('blink');
  if (state.settings) blink.checked = state.settings.blinkEnabled !== false;
  renderSyncSettings();
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
const CIRCLE_BLOCKS = ['circleSummary', 'circleLog', 'circleSearchbar', 'circleOpen', 'circleClosed', 'circleUnparseable'];

// --- Suche & Spalten-Sortierung der Positions-Tabellen ------------------------
// Beides wirkt rein auf die Anzeige (inkl. Summenzeile, die dann die gefilterten
// Zeilen aufsummiert); die Daten selbst bleiben unangetastet.
let circleFilter = '';
const circleSort = { open: null, closed: null }; // je Tabelle {key, dir: 1|-1}

function daysHeldOf(p) {
  const ts = p.buyDate != null ? parseGermanDate(p.buyDate) : null;
  return ts != null ? Math.max(0, Math.floor((Date.now() - ts) / 86400000)) : null;
}

// Sortierwerte je Spalte. "Akt. Kurs" und "Kursziel" sortieren nach den
// %-Werten — absolute Kurse verschiedener Aktien sind nicht vergleichbar.
const CIRCLE_SORT_VALUE = {
  open: {
    name: (p) => (p.name || '').toLowerCase(),
    qty: (p) => p.qty,
    ek: (p) => p.buyPriceEur,
    einsatz: (p) => p.totalBuyEur,
    kurs: (p) => {
      const q = circleQuotes ? circleQuotes[p.id] : null;
      const ek = ekBaseOf(p);
      return q && q.priceEur != null && ek != null && ek > 0 ? q.priceEur / ek - 1 : null;
    },
    ziel: (p) => p.unrealizedPct,
    tage: (p) => daysHeldOf(p),
  },
  closed: {
    name: (p) => (p.name || '').toLowerCase(),
    einsatz: (p) => p.totalBuyEur,
    ertrag: (p) => p.ertragEur,
    dauer: (p) => p.holdingDays,
  },
};

function applyCircleView(rows, table) {
  let out = rows;
  const f = circleFilter.trim().toLowerCase();
  if (f) out = out.filter((p) => (p.name || '').toLowerCase().includes(f));
  const s = circleSort[table];
  if (s) {
    const val = CIRCLE_SORT_VALUE[table][s.key];
    out = out.slice().sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // fehlende Werte immer ans Ende, egal welche Richtung
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * s.dir;
    });
  }
  return out;
}

// Pfeil-Anzeige im aktiven Spaltenkopf nachziehen.
function markSortHeaders(table, secId) {
  const s = circleSort[table];
  for (const th of document.getElementById(secId).querySelectorAll('th[data-sort]')) {
    th.classList.toggle('sort-asc', !!s && s.key === th.dataset.sort && s.dir === 1);
    th.classList.toggle('sort-desc', !!s && s.key === th.dataset.sort && s.dir === -1);
  }
}

function renderCircleTables() {
  renderCircleClosedTable(lastClosedRows);
  renderCircleOpenTable(lastOpenRows);
}

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

// --- Phase 3: Yahoo-Kurse -----------------------------------------------------
// Der Worker löst je offener Position das Yahoo-Symbol auf und liefert den
// aktuellen Kurs in Euro (circleQuotes-Nachricht, TTL-Cache im Worker). Das
// Popup rendert die Tabelle sofort ("…") und füllt die Kurs-Spalte nach.
let circleQuotes = null;   // moduleId -> {symbol, price, currency, priceEur, at}
let lastOpenRows = [];
let lastClosedRows = [];
let quotesRequested = false;
let quotesLoading = false; // Lauf aktiv -> fehlende Kurse zeigen "…" statt "–"

async function loadCircleQuotes() {
  if (quotesRequested) return;
  quotesRequested = true;
  quotesLoading = true;
  const r = await send({ type: 'circleQuotes' });
  quotesLoading = false;
  // Finale Antwort ist die Autorität; Zwischenstände kamen schon über den
  // storage.onChanged-Listener (quotesLive) herein.
  circleQuotes = r && r.ok ? r.quotes || {} : circleQuotes || {};
  if (activeTab === 'circle') renderCircleOpenTable(lastOpenRows);
}

// Basis der %-Angabe: EK je Aktie; ohne Stück-Angabe ist der Kaufpreis die
// Einheit des Titels (Heidelberg/Accor-Format, siehe computePortfolio).
function ekBaseOf(p) {
  return p.buyPriceEur != null ? p.buyPriceEur : p.qty == null ? p.totalBuyEur : null;
}

function openChartWindow(p, q) {
  const chartParams = { symbol: q.symbol, name: p.name };
  const ek = ekBaseOf(p);
  if (ek != null) chartParams.buy = String(ek);
  if (p.currentPrice != null) chartParams.target = String(p.currentPrice);
  // Kaufzeitpunkt mitgeben -> der Chart markiert "Kauf" auf der EK-Linie.
  const buyTs = p.buyDate != null ? parseGermanDate(p.buyDate) : null;
  if (buyTs != null) chartParams.buyTs = String(buyTs);

  if (STANDALONE || !popupPort) {
    // Eigenständiges Fenster: der Chart öffnet einfach fokussiert obendrauf.
    send({ type: 'openChart', params: chartParams });
    return;
  }
  // Action-Popup: der Worker öffnet an dieser Position ERST das eigenständige
  // Circle-Fenster (die nahtlose "Kopie" dieses Popups), DANN den Chart mit
  // Fokus — und dieses Popup verabschiedet sich sofort selbst.
  popupPort.postMessage({
    type: 'openChart',
    params: chartParams,
    spawnCircle: true,
    pos: { left: window.screenX, top: window.screenY },
  });
  window.close();
}

// Gesamtübersicht (portfolio.html): vorher im Worker die Symbole ALLER
// Positionen (auch verkaufter) auflösen — die Seite liest sie aus dem Speicher
// und lädt die Kursverläufe selbst. Fenster-Choreografie wie beim Chart.
document.getElementById('portfolioChartBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '… Symbole';
  try { await send({ type: 'circleSymbols' }); } catch (err) { /* Seite zeigt dann "ohne Kursverlauf" */ }
  btn.disabled = false;
  btn.textContent = label;
  if (STANDALONE || !popupPort) {
    send({ type: 'openPortfolio' });
    return;
  }
  popupPort.postMessage({
    type: 'openPortfolio',
    spawnCircle: true,
    tab: 'circle',
    pos: { left: window.screenX, top: window.screenY },
  });
  window.close();
});

// Spalten: Aktie | Stück | EK-Preis | Einsatz | Akt. Kurs (Yahoo, mit % zum EK)
// | Kursziel (geplanter Verkaufskurs des Autors, mit Potenzial-%) | Tage | Chart.
function renderCircleOpenTable(allRows) {
  const sec = document.getElementById('circleOpen');
  const tbody = sec.querySelector('tbody');
  tbody.innerHTML = '';
  const rows = applyCircleView(allRows, 'open');
  // Bei aktivem Filter bleibt die Sektion sichtbar (auch mit 0 Treffern),
  // damit klar ist, dass gefiltert wird — Zähler zeigt dann "Treffer/gesamt".
  sec.hidden = allRows.length === 0;
  document.getElementById('circleOpenCount').textContent =
    rows.length === allRows.length ? String(allRows.length) : rows.length + '/' + allRows.length;
  markSortHeaders('open', 'circleOpen');
  // Summenzeile: Einsatz, aktueller Gesamtwert (nur Positionen mit Kurs) und
  // Durchschnitts-Haltedauer — unvollständige Positionen bleiben, wie überall,
  // außen vor.
  const sums = {
    buy: 0, buyAny: false,
    buyMatched: 0, cur: 0, curCount: 0,          // Akt. Kurs (nur Positionen mit Kurs)
    buyMatchedTgt: 0, tgt: 0, tgtCount: 0,       // Kursziel (nur Positionen mit Ziel)
    days: [],
  };
  for (const p of rows) {
    const tr = posRow(p);
    tr.append(
      td(p.name, 'name'),
      td(p.qty != null ? String(p.qty) : '–', 'num'),
      td(p.buyPriceEur != null ? fmtEur(p.buyPriceEur) : '–', 'num'),
      td(p.totalBuyEur != null ? fmtEur(p.totalBuyEur) : '–', 'num'),
    );

    // Akt. Kurs: "…" solange die Kurse noch laden, "–" wenn keiner ermittelbar.
    const q = circleQuotes ? circleQuotes[p.id] : null;
    const ek = ekBaseOf(p);
    const quotesPending = quotesLoading || circleQuotes === null;
    const kurs = td(!q && quotesPending ? '…' : '–', 'num');
    if (!q && !quotesPending) {
      kurs.title = 'Kein (plausibles) Yahoo-Symbol gefunden – wird beim nächsten Öffnen automatisch erneut versucht.';
    }
    if (q && q.priceEur != null) {
      kurs.textContent = fmtEur(q.priceEur);
      kurs.title =
        q.symbol +
        (q.currency && q.currency !== 'EUR'
          ? ' · ' + q.price.toLocaleString('de-DE') + ' ' + q.currency
          : '');
      if (ek != null && ek > 0) {
        const pctVal = Math.round((q.priceEur / ek - 1) * 10000) / 100;
        const cls = signClass(pctVal);
        if (cls) kurs.classList.add(cls);
        appendPct(kurs, pctVal);
      }
    }
    tr.appendChild(kurs);

    // Kursziel, darunter das Potenzial in % bezogen auf den Einsatz.
    // Quelle: Stück-Zeile im Body (Verkaufspreis "?" -> Kaufpreis +10 % gerechnet;
    // konkrete Zahl -> übernommen, bei starker Abweichung vom 10-%-Schema rot).
    const ziel = td(p.currentPrice != null ? fmtEur(p.currentPrice) : '–', 'num');
    if (p.unrealizedPct != null) {
      const cls = p.targetOff ? 'neg' : signClass(p.unrealizedPct);
      if (cls) ziel.classList.add(cls);
      appendPct(ziel, p.unrealizedPct);
    }
    if (p.targetSource) {
      ziel.title =
        (p.targetSource === 'computed'
          ? 'Kursziel berechnet: Kaufpreis +10 % (Verkaufspreis im Beitrag offen)'
          : p.targetOff
            ? 'Verkaufspreis laut Beitrag ' + fmtEur(p.targetTotalEur) + ' – weicht deutlich vom 10-%-Ziel ab!'
            : 'Verkaufspreis laut Beitrag ' + fmtEur(p.targetTotalEur)) +
        (p.titlePrice != null ? ' · Tageskurs laut Titel (Stand letzte Bearbeitung): ' + fmtEur(p.titlePrice) : '');
    }
    tr.appendChild(ziel);

    const buyTs = p.buyDate != null ? parseGermanDate(p.buyDate) : null;
    const daysHeld = buyTs != null ? Math.max(0, Math.floor((Date.now() - buyTs) / 86400000)) : null;
    const tage = td(daysHeld != null ? daysHeld + ' T.' : '–', 'num');
    if (p.buyDate) tage.title = 'Kauf am ' + p.buyDate;
    tr.appendChild(tage);

    if (!p.incomplete) {
      if (p.totalBuyEur != null) { sums.buy += p.totalBuyEur; sums.buyAny = true; }
      if (daysHeld != null) sums.days.push(daysHeld);
      if (q && q.priceEur != null && p.totalBuyEur != null) {
        // Gesamtwert heute: mit Stückzahl je Aktie, sonst Titeleinheit
        // (Heidelberg/Accor-Format: Kaufpreis und Kurs teilen die Einheit).
        sums.cur += p.qty != null ? p.qty * q.priceEur : q.priceEur;
        sums.buyMatched += p.totalBuyEur;
        sums.curCount++;
      }
      if (p.currentPrice != null && p.totalBuyEur != null) {
        // Gesamtwert bei Erreichen aller Kursziele (gleiche Einheiten-Logik).
        sums.tgt += p.qty != null ? p.qty * p.currentPrice : p.currentPrice;
        sums.buyMatchedTgt += p.totalBuyEur;
        sums.tgtCount++;
      }
    }

    const chartCell = td('', 'chart-col');
    const chartBtn = document.createElement('button');
    chartBtn.className = 'chart-btn';
    chartBtn.type = 'button';
    chartBtn.textContent = '📈';
    if (q && q.symbol) {
      chartBtn.title = 'Kurs-Chart öffnen (' + q.symbol + ')';
      chartBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // nicht zusätzlich das Skool-Modul öffnen
        openChartWindow(p, q);
      });
    } else {
      chartBtn.disabled = true;
      chartBtn.title = quotesPending ? 'Kurs-Chart – Kurse laden noch…' : 'Kurs-Chart – kein Yahoo-Symbol gefunden';
    }
    chartCell.appendChild(chartBtn);
    tr.appendChild(chartCell);

    tbody.appendChild(tr);
  }

  // Summenzeile füllen.
  document.getElementById('openSumBuy').textContent = sums.buyAny ? fmtEur(sums.buy) : '–';

  const sumCur = document.getElementById('openSumCur');
  sumCur.classList.remove('pos', 'neg');
  sumCur.textContent = '';
  sumCur.title = '';
  if (sums.curCount === 0 && (quotesLoading || circleQuotes === null)) {
    sumCur.textContent = '…';
  } else if (sums.curCount > 0) {
    sumCur.textContent = fmtEur(Math.round(sums.cur * 100) / 100);
    if (sums.buyMatched > 0) {
      const pctVal = Math.round((sums.cur / sums.buyMatched - 1) * 10000) / 100;
      const cls = signClass(pctVal);
      if (cls) sumCur.classList.add(cls);
      appendPct(sumCur, pctVal);
    }
    sumCur.title =
      sums.curCount < rows.length
        ? 'Heutiger Gesamtwert der ' + sums.curCount + ' von ' + rows.length +
          ' Positionen mit Kurs (Einsatz dieser Positionen: ' + fmtEur(sums.buyMatched) + ')'
        : 'Heutiger Gesamtwert aller laufenden Positionen';
  } else {
    sumCur.textContent = '–';
  }

  // Kursziel-Summe: Gesamtwert, wenn alle Positionen ihr Ziel erreichen.
  const sumTgt = document.getElementById('openSumTarget');
  sumTgt.classList.remove('pos', 'neg');
  sumTgt.title = '';
  if (sums.tgtCount > 0) {
    sumTgt.textContent = fmtEur(Math.round(sums.tgt * 100) / 100);
    if (sums.buyMatchedTgt > 0) {
      const pctVal = Math.round((sums.tgt / sums.buyMatchedTgt - 1) * 10000) / 100;
      const cls = signClass(pctVal);
      if (cls) sumTgt.classList.add(cls);
      appendPct(sumTgt, pctVal);
    }
    sumTgt.title =
      sums.tgtCount < rows.length
        ? 'Gesamtwert bei Erreichen aller Kursziele – ' + sums.tgtCount + ' von ' + rows.length +
          ' Positionen mit Kursziel (Einsatz dieser Positionen: ' + fmtEur(sums.buyMatchedTgt) + ')'
        : 'Gesamtwert, wenn alle laufenden Positionen ihr Kursziel erreichen';
  } else {
    sumTgt.textContent = '–';
  }

  document.getElementById('openAvgDays').textContent = sums.days.length
    ? '⌀ ' + (sums.days.reduce((a, b) => a + b, 0) / sums.days.length)
        .toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' T.'
    : '–';
}

function renderCircleClosedTable(allRows) {
  const sec = document.getElementById('circleClosed');
  const tbody = sec.querySelector('tbody');
  tbody.innerHTML = '';
  const rows = applyCircleView(allRows, 'closed');
  sec.hidden = allRows.length === 0;
  document.getElementById('circleClosedCount').textContent =
    rows.length === allRows.length ? String(allRows.length) : rows.length + '/' + allRows.length;
  markSortHeaders('closed', 'circleClosed');
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
  // "Neue Seite"-Platzhalter auch aus alten, bereits gespeicherten Einträgen
  // herausfiltern — sie sollen nirgends erscheinen.
  const events = (state.circleHistory || []).filter((e) => !circleHiddenTitle(e.name));
  const rows = events
    .map((e) => ({ e, ts: Date.parse(e.at) || Date.parse(e.detectedAt) || 0 }))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 30); // die jüngsten 30 reichen im Popup

  ul.innerHTML = '';
  document.getElementById('circleLogCount').textContent = String(events.length);
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
  setStat('cCapital', pf.capitalNeed != null ? pf.capitalNeed : 0);
  if (pf.capitalNeedUndated) {
    document.getElementById('cCapital').title = pf.capitalNeedUndated + ' Position(en) ohne Kaufdatum – am Anfang eingerechnet';
  }
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
  document.getElementById('circleSearchbar').hidden = open.length + closed.length === 0;
  lastClosedRows = closed;
  renderCircleClosedTable(closed); // steht im Popup vor den laufenden Positionen
  lastOpenRows = open;
  renderCircleOpenTable(open);
  loadCircleQuotes(); // füllt die Akt.-Kurs-Spalte nach, sobald Yahoo antwortet
  renderCircleUnparseable(pf.unparseable);

  setCircleStatus(
    open.length + ' laufend · ' + closed.length + ' abgeschlossen · zuletzt ' + fmtTime(meta.lastPollAt),
    false,
  );

  // Angesehen -> goldenen Punkt auf dem Icon löschen. Im Standalone-Fenster
  // nur, wenn es wirklich im Vordergrund ist — ein tagelang im Hintergrund
  // offenes Fenster soll neue Käufe/Verkäufe nicht ungesehen quittieren.
  if ((meta.pending || 0) > 0 && (!STANDALONE || document.hasFocus())) {
    state.circleMeta = { ...meta, pending: 0 };
    send({ type: 'circleSeen' });
  }
}

// Beim Öffnen des Circle-Tabs den Zugang frisch prüfen (und dabei nichts
// Sensibles zeigen) — danach rendern.
async function refreshCircle() {
  quotesRequested = false; // manuelles Prüfen darf auch die Kurse auffrischen
  const meta = state.circleMeta || {};
  if (meta.lastPollOk === true && state.circle &&
      Date.now() - (meta.lastPollAt || 0) < FRESH_MS) {
    // Frisch genug -> sofort aus dem Speicher rendern, Abruf läuft nebenher
    // (der Harvest holt ohnehin nur geänderte Modul-Texte nach).
    circleChecked = true;
    renderCircle();
    send({ type: 'circlePollNow' }).then((r) => {
      if (r) {
        state.circle = r.circle;
        state.circleMeta = r.circleMeta;
        state.circleHistory = r.circleHistory || state.circleHistory;
      }
      if (activeTab === 'circle') renderCircle();
    });
    return;
  }

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
// --- Update-Historie (changelog.md im Extension-Ordner) ---------------------
// Minimaler Markdown-Renderer: "## " -> Überschrift, "- " -> Stichpunkt,
// "# " (Titel) und "> " (Wartungshinweise) werden übersprungen, sonst Absatz.
function renderChangelog(md) {
  const body = document.getElementById('changelogBody');
  body.innerHTML = '';
  let ul = null;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('# ') || line.startsWith('>')) { ul = null; continue; }
    if (line.startsWith('## ')) {
      ul = null;
      const h = document.createElement('h3');
      h.textContent = line.slice(3);
      body.appendChild(h);
    } else if (line.startsWith('- ')) {
      if (!ul) { ul = document.createElement('ul'); body.appendChild(ul); }
      const li = document.createElement('li');
      li.textContent = line.slice(2);
      ul.appendChild(li);
    } else {
      ul = null;
      const p = document.createElement('p');
      p.textContent = line;
      body.appendChild(p);
    }
  }
}

async function openChangelog() {
  const sec = document.getElementById('changelog');
  const body = document.getElementById('changelogBody');
  sec.hidden = false;
  body.textContent = 'Lade…';
  try {
    const res = await fetch(api.runtime.getURL('changelog.md'));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    renderChangelog(await res.text());
  } catch (e) {
    body.textContent = 'Update-Historie nicht ladbar (' + String(e.message || e) + ').';
  }
}

function closeChangelog() {
  document.getElementById('changelog').hidden = true;
}

document.getElementById('version').addEventListener('click', openChangelog);
document.getElementById('changelogBack').addEventListener('click', closeChangelog);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('changelog').hidden) closeChangelog();
});

async function init() {
  // Versionsnummer aus dem Manifest (in der App fehlt getManifest im Shim ->
  // dort bleibt die Zeile leer, die App zeigt ihre Version selbst).
  try {
    const mf = api.runtime.getManifest && api.runtime.getManifest();
    if (mf && mf.version) document.getElementById('version').textContent = 'Version ' + mf.version;
  } catch (e) {}

  state = await send({ type: 'getState' });

  const meta = state.meta || {};
  if (meta.lastPollOk === true && Date.now() - (meta.lastPollAt || 0) < FRESH_MS) {
    // Letzter Abruf war gerade eben erfolgreich -> sofort anzeigen, im
    // Hintergrund trotzdem nachprüfen (aktualisiert die Anzeige still).
    renderAll();
    if (STANDALONE) switchTab(STANDALONE_TAB);
    send({ type: 'pollNow' }).then((r) => {
      if (r) { state = r; renderAll(); }
    });
    return;
  }

  // Sonst wie gehabt: erst den Login-Status prüfen und dabei keine alten Daten
  // anzeigen, bevor der Abruf bestätigt, dass wir noch eingeloggt sind.
  showChecking();
  const r = await send({ type: 'pollNow' });
  if (r) state = r;
  renderAll();
  // Das Standalone-Fenster ist die "Circle-Kopie" -> direkt dorthin.
  if (STANDALONE) switchTab(STANDALONE_TAB);
}

// Auf Speicheränderungen reagieren:
// - quotesLive (beide Ansichten): der Worker veröffentlicht jeden ermittelten
//   Kurs sofort -> die betreffende Zeile füllt sich, statt dass die Spalte
//   erst am Ende in einem Block umspringt.
// - circle-Daten (nur Standalone): das langlebige Fenster zieht neue Abrufe
//   automatisch nach; die Privacy-Regel bleibt wirksam (lastPollOk=false ->
//   Ansicht verbirgt sich).
api.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if ('quotesLive' in changes) {
    circleQuotes = { ...(changes.quotesLive.newValue || {}) };
    if (activeTab === 'circle') renderCircleOpenTable(lastOpenRows);
  }
  if ('ampelQuotesLive' in changes) {
    // Zwischenstand eines laufenden Ampel-Abrufs: nur ergänzen, nie ersetzen
    // (ein Lauf betrifft immer nur eine Gruppe bzw. eine Aktie).
    ampelQuotes = { ...ampelQuotes, ...(changes.ampelQuotesLive.newValue || {}) };
    if (activeTab === 'ampel' && isLoggedIn()) renderGroups();
  }
  if (STANDALONE && ('current' in changes || 'meta' in changes || 'baseline' in changes || 'history' in changes)) {
    // Das langlebige Fenster zieht auch Ampel-Abrufe des Workers nach.
    const s = await send({ type: 'getState' });
    if (!s) return;
    state = { ...state, ...s };
    if (activeTab === 'ampel') renderAll();
  }
  if (STANDALONE && ('circle' in changes || 'circleMeta' in changes || 'circleHistory' in changes)) {
    const s = await send({ type: 'getState' });
    if (!s) return;
    state.circle = s.circle;
    state.circleMeta = s.circleMeta;
    state.circleHistory = s.circleHistory;
    if (activeTab === 'circle') renderCircle();
  }
});

if (STANDALONE) {
  // Kommt das Fenster in den Vordergrund, ausstehende Ereignisse quittieren
  // (renderCircle löscht dann den goldenen Punkt).
  window.addEventListener('focus', () => {
    if (activeTab === 'circle' && state && (state.circleMeta || {}).pending > 0) renderCircle();
  });
}

// Positions-Suche: filtert beide Tabellen (inkl. Summenzeilen) nach dem Namen.
document.getElementById('circleSearch').addEventListener('input', (e) => {
  circleFilter = e.target.value;
  renderCircleTables();
});

// Klick auf einen Spaltenkopf sortiert; zweiter Klick dreht die Richtung.
// Name startet aufsteigend, Zahlenspalten absteigend (Größtes zuerst).
for (const [table, secId] of [['closed', 'circleClosed'], ['open', 'circleOpen']]) {
  for (const th of document.getElementById(secId).querySelectorAll('th[data-sort]')) {
    th.classList.add('sortable');
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      const cur = circleSort[table];
      circleSort[table] = cur && cur.key === key
        ? { key, dir: -cur.dir }
        : { key, dir: key === 'name' ? 1 : -1 };
      renderCircleTables();
    });
  }
}

// ↗-Schalter (nur im Action-Popup sichtbar): Ansicht als eigenes Fenster öffnen —
// aus dem Circle-Tab startet es im Circle, aus dem Ampel-Tab in der Ampel.
function openStandaloneWindow(tab) {
  if (!popupPort) return;
  popupPort.postMessage({
    type: 'openCircleWindow',
    tab,
    pos: { left: window.screenX, top: window.screenY },
  });
  window.close();
}
document.getElementById('circleWindowBtn').addEventListener('click', () => openStandaloneWindow('circle'));
document.getElementById('ampelWindowBtn').addEventListener('click', () => openStandaloneWindow('ampel'));

// Gibt es das Fenster schon, fokussiert der Worker es nur und bittet per
// Nachricht um den gewünschten Tab.
if (STANDALONE && api.runtime.onMessage) {
  api.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'standaloneShowTab' && (msg.tab === 'ampel' || msg.tab === 'circle')) {
      switchTab(msg.tab);
    }
  });
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


// --- Synchronisation (Event-Log, EVENTS.md) -----------------------------------
// Einstellungen leben in state.settings.sync; der Worker schreibt per WebDAV,
// der Adapter "lokaler Ordner" (File System Access API) kann nur hier im
// Seitenkontext schreiben -> dieses Fenster flusht die Outbox, sobald der
// Worker syncMeta.needsPageFlush setzt (storage.onChanged) und beim Öffnen.
const syncEl = (id) => document.getElementById(id);
let syncUiDirty = false; // Nutzer tippt -> nicht von renderAll überschreiben

function syncSettingsView() {
  const sy = (state && state.settings && state.settings.sync) || {};
  return Object.assign({ enabled: false, adapter: 'webdav', url: '', user: '', label: '' }, sy);
}

function renderSyncSettings() {
  if (syncUiDirty) return;
  const sy = syncSettingsView();
  syncEl('syncEnabled').checked = !!sy.enabled;
  syncEl('syncAdapter').value = sy.adapter === 'folder' ? 'folder' : 'webdav';
  syncEl('syncUrl').value = sy.url || '';
  syncEl('syncUser').value = sy.user || '';
  syncEl('syncPassword').value = '';
  syncEl('syncPassword').placeholder = sy.password ? 'gespeichert – leer = unverändert' : 'App-Passwort';
  syncEl('syncLabel').value = sy.label || '';
  renderSyncAdapterFields();
  refreshSyncStatus();
}

function renderSyncAdapterFields() {
  const folder = syncEl('syncAdapter').value === 'folder';
  syncEl('syncWebdav').hidden = folder;
  syncEl('syncFolder').hidden = !folder;
  if (folder) {
    const supported = typeof folderSupported === 'function' && folderSupported();
    syncEl('syncFolderUnsupported').hidden = supported;
    syncEl('syncPickFolder').disabled = !supported;
    if (supported) {
      folderPermission(false).then((p) => {
        syncEl('syncFolderName').textContent =
          p.state === 'none' ? 'kein Ordner gewählt' :
          p.state === 'granted' ? p.name + ' ✓' :
          p.name + ' (Berechtigung beim nächsten Klick bestätigen)';
      });
    }
  }
}

function fmtSyncTime(ts) {
  if (!ts) return '–';
  const d = new Date(ts);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function setSyncStatus(text, cls) {
  const el = syncEl('syncStatus');
  el.textContent = text || '';
  el.className = 'sync-status' + (cls ? ' ' + cls : '');
}

async function refreshSyncStatus() {
  const st = await send({ type: 'getSyncStatus' });
  if (!st || !st.ok) return;
  const badge = syncEl('syncBadge');
  if (!st.sync.enabled) {
    badge.textContent = '';
    setSyncStatus('Ausgeschaltet.', '');
    return;
  }
  const parts = ['zuletzt ' + fmtSyncTime(st.lastFlushAt), st.outboxCount + ' offen'];
  if (st.lastSnapshotAt) parts.push('Vollbild ' + fmtSyncTime(st.lastSnapshotAt));
  if (st.lastError) {
    badge.textContent = '⚠';
    badge.className = 'sync-badge error';
    setSyncStatus(parts.join(' · ') + ' – Fehler: ' + st.lastError, 'error');
  } else {
    badge.textContent = st.outboxCount ? st.outboxCount + ' offen' : '✓';
    badge.className = 'sync-badge';
    setSyncStatus(parts.join(' · '), '');
  }
}

// Outbox in den lokalen Ordner schreiben (nur Adapter "folder", nur hier möglich).
let pageFlushRunning = false;
async function pageFlushIfNeeded(requestPermission) {
  const sy = syncSettingsView();
  if (!sy.enabled || sy.adapter !== 'folder' || pageFlushRunning) return;
  if (typeof openFolderAdapter !== 'function') return;
  pageFlushRunning = true;
  try {
    const adapter = await openFolderAdapter(!!requestPermission);
    if (!adapter) return;
    const st = await send({ type: 'getSyncStatus' });
    if (!st || !st.ok || !st.outboxCount) return;
    const r = await flushOutboxWith(adapter, api.storage.local, st.producer);
    await send({ type: 'syncFlushed', ok: r.ok, error: r.error || null });
  } catch (e) {
    console.warn('[Sync] Ordner-Flush', e);
  } finally {
    pageFlushRunning = false;
    refreshSyncStatus();
  }
}

for (const id of ['syncUrl', 'syncUser', 'syncPassword', 'syncLabel']) {
  syncEl(id).addEventListener('input', () => { syncUiDirty = true; });
}
syncEl('syncAdapter').addEventListener('change', () => { syncUiDirty = true; renderSyncAdapterFields(); });
syncEl('syncToggle').addEventListener('click', () => {
  syncEl('syncBlock').classList.toggle('collapsed');
  if (!syncEl('syncBlock').classList.contains('collapsed')) refreshSyncStatus();
});

syncEl('syncPickFolder').addEventListener('click', async () => {
  const r = await pickFolder();
  if (!r.ok) { setSyncStatus(r.error, 'error'); return; }
  syncEl('syncFolderName').textContent = r.name + ' ✓';
  setSyncStatus('Ordner „' + r.name + '“ gewählt – jetzt „Speichern“.', 'ok');
});

async function ensureHostPermission(url) {
  const v = validateWebdavUrl(url);
  if (!v.ok) return { ok: false, error: v.error };
  if (!api.permissions || !api.permissions.request) return { ok: true }; // App-Shim
  const origins = [v.origin + '/*'];
  try {
    const has = await api.permissions.contains({ origins });
    if (has) return { ok: true };
    const granted = await api.permissions.request({ origins });
    return granted ? { ok: true } : { ok: false, error: 'Zugriff auf ' + v.origin + ' nicht erlaubt' };
  } catch (e) {
    return { ok: false, error: 'Berechtigung: ' + String((e && e.message) || e) };
  }
}

function syncPatchFromForm() {
  const patch = {
    enabled: syncEl('syncEnabled').checked,
    adapter: syncEl('syncAdapter').value,
    url: syncEl('syncUrl').value.trim(),
    user: syncEl('syncUser').value.trim(),
    label: syncEl('syncLabel').value.trim(),
  };
  const pw = syncEl('syncPassword').value;
  if (pw) patch.password = pw; // leer = gespeichertes Passwort behalten
  return patch;
}

syncEl('syncSave').addEventListener('click', async () => {
  const patch = syncPatchFromForm();
  if (patch.enabled && patch.adapter === 'webdav') {
    const perm = await ensureHostPermission(patch.url); // im Klick-Handler (Nutzergeste)
    if (!perm.ok) { setSyncStatus(perm.error, 'error'); return; }
  }
  if (patch.enabled && patch.adapter === 'folder') {
    const p = typeof folderPermission === 'function' ? await folderPermission(true) : { state: 'none' };
    if (p.state !== 'granted') { setSyncStatus('Bitte zuerst einen Ordner wählen und den Zugriff erlauben.', 'error'); return; }
  }
  const r = await send({ type: 'setSync', patch });
  if (!r || !r.ok) { setSyncStatus((r && r.error) || 'Speichern fehlgeschlagen', 'error'); return; }
  syncUiDirty = false;
  state = await send({ type: 'getState' });
  renderSyncSettings();
  const btn = syncEl('syncSave');
  btn.textContent = 'Gespeichert ✓';
  setTimeout(() => (btn.textContent = 'Speichern'), 1500);
  setTimeout(() => pageFlushIfNeeded(true), 600); // Vollbild des Workers abholen
});

syncEl('syncTest').addEventListener('click', async () => {
  const patch = syncPatchFromForm();
  setSyncStatus('Teste…', '');
  if (patch.adapter === 'folder') {
    const adapter = typeof openFolderAdapter === 'function' ? await openFolderAdapter(true) : null;
    if (!adapter) { setSyncStatus('Kein beschreibbarer Ordner gewählt.', 'error'); return; }
    const r = await adapter.selfTest();
    setSyncStatus(r.ok ? 'Ordner-Test erfolgreich (boersenampel/format.json geschrieben).' : 'Fehler: ' + r.error, r.ok ? 'ok' : 'error');
    return;
  }
  const perm = await ensureHostPermission(patch.url);
  if (!perm.ok) { setSyncStatus(perm.error, 'error'); return; }
  // Test mit den Formularwerten (Passwort ggf. gespeichert) — dazu erst speichern
  // ohne den Schalter zu verändern.
  const saved = await send({ type: 'setSync', patch: Object.assign({}, patch, { enabled: syncSettingsView().enabled }) });
  if (!saved || !saved.ok) { setSyncStatus((saved && saved.error) || 'Ungültige Angaben', 'error'); return; }
  const r = await send({ type: 'syncTest' });
  if (r && r.ok) setSyncStatus('Verbindung ok: ' + r.steps.map((s) => s.step).join(', ') + '.', 'ok');
  else {
    const failed = r && r.steps ? r.steps.find((s) => !s.ok) : null;
    setSyncStatus('Fehler' + (failed ? ' bei „' + failed.step + '“' : '') + ': ' + ((r && r.error) || 'unbekannt'), 'error');
  }
});

syncEl('syncNow').addEventListener('click', async () => {
  const btn = syncEl('syncNow');
  btn.disabled = true;
  setSyncStatus('Synchronisiere…', '');
  const r = await send({ type: 'syncNow' });
  await pageFlushIfNeeded(true);
  btn.disabled = false;
  if (r && r.ok) await refreshSyncStatus();
  else setSyncStatus('Fehler: ' + ((r && r.error) || 'unbekannt'), 'error');
});

syncEl('syncCopy').addEventListener('click', async () => {
  const r = await send({ type: 'syncSnapshotJson' });
  if (!r || !r.ok) { setSyncStatus('Snapshot nicht verfügbar: ' + ((r && r.error) || ''), 'error'); return; }
  try {
    await navigator.clipboard.writeText(r.text);
    setSyncStatus('Snapshot in die Zwischenablage kopiert (' + Math.round(r.text.length / 1024) + ' KB).', 'ok');
  } catch (e) {
    setSyncStatus('Zwischenablage nicht erreichbar.', 'error');
  }
});

// Worker signalisiert "bitte in den Ordner schreiben" bzw. neue Outbox-Einträge.
api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('syncMeta' in changes || 'syncOutbox' in changes) {
    const meta = (changes.syncMeta && changes.syncMeta.newValue) || null;
    if (!meta || meta.needsPageFlush) pageFlushIfNeeded(false);
    if (!syncEl('syncBlock').classList.contains('collapsed')) refreshSyncStatus();
  }
});
// Beim Öffnen: liegengebliebene Outbox in den Ordner schreiben (ohne Nachfrage).
setTimeout(() => pageFlushIfNeeded(false), 1500);

init();
