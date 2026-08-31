/*
 * portfolio.js — Gesamtübersicht des Circle als Kurvendiagramm (📈 Verlauf im
 * Block "Auswertung"). Zeitachse vom ersten Kauf bis heute; Bedienung wie der
 * Kurs-Chart (Brush + Presets, zusätzlich "1J"), aber mehrere Kurven mit
 * Schaltern — die y-Achse richtet sich nur nach den sichtbaren Kurven.
 *
 * Daten: der gespeicherte Circle-Stand (storage.local.circle -> computePortfolio)
 * und je Position der Kursverlauf von Yahoo (Tagesdaten seit Kauf, in € mit dem
 * HEUTIGEN Wechselkurs ≈). Die Symbole hat der Worker vorab in quoteSymbols
 * abgelegt (Nachricht circleSymbols, ausgelöst vom Popup-Knopf). Kursverläufe
 * werden in localStorage gecacht (Seiten-eigen, belastet den Add-on-Speicher
 * nicht). Rechenkern: lib/portfolio.js (buildPortfolioSeries).
 *
 * Privacy-Regel wie im Popup: ohne erfolgreichen letzten Abruf (circleMeta.
 * lastPollOk) wird nichts gezeigt.
 */

const api = globalThis.browser || globalThis.chrome;
const DAY = 86400;
const DAY_MS = 86400000;
const nowSec = () => Date.now() / 1000;

// Reihenfolge = Reihenfolge der Schalter in der Legende (Wunsch des Nutzers).
const CURVES = [
  { key: 'invested', label: 'Kaufvolumen (kumuliert)', color: '#5f6368' },
  { key: 'cashNeed', label: 'Eingesetztes Kapital (Untergrenze)', color: '#e8710a' },
  { key: 'deployed', label: 'Aktuell im Markt', color: '#1a73e8' },
  { key: 'value', label: 'Portfolio-Wert (Tageskurs ≈ €)', color: '#8e24aa' },
  { key: 'deposits', label: '1.500 €/Woche × 10', color: '#e8710a', dashed: true },
  { key: 'realized', label: 'Realisierte Gewinne', color: '#1e8e3e' },
  { key: 'potential', label: 'Potenzial (Kursziel)', color: '#d4a017' },
  { key: 'costs', label: 'Kosten (geschätzt)', color: '#d93025' },
];
const PRESETS = { '12h': 12 * 3600, tage: 7 * DAY, wochen: 21 * DAY, '1mo': 30 * DAY, '3mo': 91 * DAY, '1y': 365 * DAY };
const MIN_SPAN = 2 * 3600;
const VIS_KEY = 'portfolioCurves';
const HIST_KEY = 'portfolioHistory';
const HIST_MAX_AGE_MS = 60 * 60 * 1000; // offene Positionen: Verlauf höchstens 1 h alt

const canvas = document.getElementById('chart');
const ctx = canvas.getContext('2d');
const brushEl = document.getElementById('brush');
const brushCanvas = document.getElementById('brushCanvas');
const brushSelEl = document.getElementById('brushSel');

let positions = [];     // aus computePortfolio
let statistik = null;
let prices = {};        // posId -> { timestamps, closes(€) }
let result = null;      // buildPortfolioSeries(...)
let sel = null;         // { t0, t1 } Sekunden
let hoverT = null;      // Zeitpunkt unter der Maus (Sek.)
let layout = null;
let statusText = 'Lade Circle-Daten…';
let visible = {};
try { visible = JSON.parse(localStorage.getItem(VIS_KEY) || '{}') || {}; } catch (e) { visible = {}; }
const isVisible = (key) => visible[key] !== false;

const fmtNum = (n, digits = 2) =>
  Number(n).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtEur = (n) => fmtNum(n) + ' €';
const setMeta = (t) => { document.getElementById('chartMeta').textContent = t; };
// Dezenter Lade-Indikator (drehender Ring) über dem Chart; null = ausblenden.
function setLoading(text) {
  const el = document.getElementById('loadingInd');
  el.hidden = !text;
  if (text) document.getElementById('loadingText').textContent = text;
}

// --- Zeit -> Wert (Treppenkurve) ------------------------------------------------
function dayIndexAt(tSec) {
  const days = result.days;
  const ms = tSec * 1000;
  if (ms < days[0]) return 0;
  let lo = 0;
  let hi = days.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (days[mid] <= ms) lo = mid; else hi = mid - 1;
  }
  return lo;
}

function valueAt(key, tSec) {
  const arr = result.series[key];
  if (!arr) return null;
  return arr[dayIndexAt(tSec)];
}

// Punkte einer Kurve im Fenster [t0,t1]: Treppe mit Sprung an jedem Tagesbeginn.
function stepPoints(key, t0, t1) {
  const arr = result.series[key];
  if (!arr) return [];
  const pts = [{ t: t0, v: arr[dayIndexAt(t0)] }];
  for (let i = 0; i < result.days.length; i++) {
    const d = result.days[i] / 1000;
    if (d <= t0) continue;
    if (d > t1) break;
    pts.push({ t: d, v: arr[i - 1 >= 0 ? i - 1 : 0] }, { t: d, v: arr[i] });
  }
  pts.push({ t: t1, v: arr[dayIndexAt(t1)] });
  return pts;
}

function activeCurves() {
  return CURVES.filter((c) => result && result.series[c.key] && isVisible(c.key));
}

// --- Hauptchart ---------------------------------------------------------------
function draw() {
  const wrap = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const curves = result && sel ? activeCurves() : [];
  if (!curves.length) {
    layout = null;
    if (result && sel) {
      ctx.fillStyle = '#5f6368';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Keine Kurve ausgewählt – unten einschalten.', w / 2, h / 2);
    } else if (statusText) {
      // Ohne Daten: Text auf der Fläche; das Laden selbst zeigt der Ring an.
      ctx.fillStyle = '#5f6368';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(statusText, w / 2, h / 2);
    }
    return;
  }

  const { t0, t1 } = sel;
  const lines = curves.map((c) => ({ c, pts: stepPoints(c.key, t0, t1) }));
  let min = Infinity;
  let max = -Infinity;
  for (const l of lines) for (const p of l.pts) { if (p.v < min) min = p.v; if (p.v > max) max = p.v; }
  if (!isFinite(min)) { min = 0; max = 1; }
  const pad = (max - min) * 0.08 || Math.abs(max) * 0.05 || 1;
  min -= pad;
  max += pad;

  const M = { left: 72, right: 14, top: 14, bottom: 56 };
  const plotW = w - M.left - M.right;
  const plotH = h - M.top - M.bottom;
  const x = (t) => M.left + (plotW * (t - t0)) / Math.max(1, t1 - t0);
  const y = (v) => M.top + plotH * (1 - (v - min) / (max - min));
  layout = { M, plotW, plotH };

  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const v = min + ((max - min) * i) / steps;
    const yy = y(v);
    ctx.strokeStyle = '#f1f3f4';
    ctx.beginPath();
    ctx.moveTo(M.left, yy);
    ctx.lineTo(w - M.right, yy);
    ctx.stroke();
    ctx.fillStyle = '#5f6368';
    ctx.fillText(fmtNum(v, 0) + ' €', M.left - 6, yy);
  }

  const spanSec = t1 - t0;
  const labelOf = (t) => {
    const d = new Date(t * 1000);
    if (spanSec <= 26 * 3600) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (spanSec <= 8 * DAY) return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };
  const nLabels = Math.max(4, Math.floor(plotW / 60));
  const bottomY = h - M.bottom;
  for (let k = 0; k < nLabels; k++) {
    const t = t0 + (spanSec * k) / (nLabels - 1);
    const xx = x(t);
    ctx.strokeStyle = '#e0e0e0';
    ctx.beginPath();
    ctx.moveTo(xx, bottomY);
    ctx.lineTo(xx, bottomY + 4);
    ctx.stroke();
    ctx.save();
    ctx.translate(xx, bottomY + 7);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = '#5f6368';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelOf(t), 0, 0);
    ctx.restore();
  }

  // Nulllinie, falls im Bild (Kosten/Gewinne können nahe 0 liegen).
  if (min < 0 && max > 0) {
    ctx.strokeStyle = '#c6c6c6';
    ctx.beginPath();
    ctx.moveTo(M.left, y(0));
    ctx.lineTo(w - M.right, y(0));
    ctx.stroke();
  }

  for (const { c, pts } of lines) {
    ctx.save();
    ctx.strokeStyle = c.color;
    ctx.lineWidth = c.key === 'value' ? 2 : 1.6;
    if (c.dashed) ctx.setLineDash([5, 4]);
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(x(p.t), y(p.v)) : ctx.lineTo(x(p.t), y(p.v))));
    ctx.stroke();
    ctx.restore();
    const last = pts[pts.length - 1];
    ctx.beginPath();
    ctx.arc(x(last.t), y(last.v), 3, 0, 2 * Math.PI);
    ctx.fillStyle = c.color;
    ctx.fill();
  }

  // Hover: Tageslinie, Punkte je Kurve und Tooltip mit allen sichtbaren Werten.
  if (hoverT != null && hoverT >= t0 && hoverT <= t1) {
    const hx = x(hoverT);
    ctx.save();
    ctx.strokeStyle = '#c6c6c6';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(hx, M.top);
    ctx.lineTo(hx, M.top + plotH);
    ctx.stroke();
    ctx.restore();

    const rows = curves.map((c) => ({ c, v: valueAt(c.key, hoverT) }));
    for (const r of rows) {
      ctx.beginPath();
      ctx.arc(hx, y(r.v), 3.5, 0, 2 * Math.PI);
      ctx.fillStyle = r.c.color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
    const d = new Date(hoverT * 1000);
    const idx = dayIndexAt(hoverT);
    let title = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' });
    if (result.valueKnown && result.valueKnown[idx] === false && isVisible('value')) title += ' · Wert teils ohne Kurs';
    ctx.font = '11px system-ui, sans-serif';
    const texts = rows.map((r) => r.c.label + ': ' + fmtEur(r.v));
    const tw = Math.max(ctx.measureText(title).width, ...texts.map((t) => ctx.measureText(t).width + 14));
    const lineH = 14;
    const bw = tw + 16;
    const bh = 10 + lineH * (rows.length + 1);
    let bx = hx + 12;
    if (bx + bw > w - M.right) bx = hx - 12 - bw;
    let by = M.top + 4;
    if (by + bh > M.top + plotH) by = Math.max(M.top, M.top + plotH - bh);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 6);
    ctx.fill();
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#5f6368';
    ctx.fillText(title, bx + 8, by + 5 + lineH / 2);
    rows.forEach((r, i) => {
      const yy = by + 5 + lineH * (i + 1) + lineH / 2;
      ctx.fillStyle = r.c.color;
      ctx.fillRect(bx + 8, yy - 1, 8, 2);
      ctx.fillStyle = '#202124';
      ctx.fillText(texts[i], bx + 22, yy);
    });
  }
}

// --- Brush -------------------------------------------------------------------
function brushRange() {
  const start = result ? result.start / 1000 : nowSec() - 365 * DAY;
  return { start: Math.min(start, nowSec() - DAY), end: nowSec() };
}
function timeToX(t) { const { start, end } = brushRange(); return ((t - start) / (end - start)) * brushEl.clientWidth; }
function xToTime(px) { const { start, end } = brushRange(); return start + (px / brushEl.clientWidth) * (end - start); }

function drawBrush() {
  const dpr = window.devicePixelRatio || 1;
  const w = brushEl.clientWidth;
  const h = brushEl.clientHeight;
  brushCanvas.width = Math.max(1, Math.floor(w * dpr));
  brushCanvas.height = Math.max(1, Math.floor(h * dpr));
  const b = brushCanvas.getContext('2d');
  b.setTransform(dpr, 0, 0, dpr, 0, 0);
  b.clearRect(0, 0, w, h);
  if (!result) return;
  // Übersicht: die sichtbaren Kurven über den gesamten Zeitraum (dünn).
  const curves = activeCurves();
  if (!curves.length) return;
  const { start, end } = brushRange();
  let min = Infinity;
  let max = -Infinity;
  for (const c of curves) for (const v of result.series[c.key]) { if (v < min) min = v; if (v > max) max = v; }
  const y = (v) => 2 + (h - 4) * (1 - (v - min) / (max - min || 1));
  for (const c of curves) {
    const pts = stepPoints(c.key, start, end);
    b.save();
    b.strokeStyle = c.color;
    b.globalAlpha = 0.6;
    b.lineWidth = 1;
    if (c.dashed) b.setLineDash([3, 3]);
    b.beginPath();
    pts.forEach((p, i) => (i === 0 ? b.moveTo(timeToX(p.t), y(p.v)) : b.lineTo(timeToX(p.t), y(p.v))));
    b.stroke();
    b.restore();
  }
}

function updateBrushSel() {
  if (!sel) return;
  const left = Math.max(0, timeToX(sel.t0));
  const right = Math.min(brushEl.clientWidth, timeToX(sel.t1));
  brushSelEl.style.left = left + 'px';
  brushSelEl.style.width = Math.max(4, right - left) + 'px';
}

function setActiveButton(key) {
  for (const btn of document.querySelectorAll('.ranges button')) btn.classList.toggle('active', btn.dataset.range === key);
}

function setSel(t0, t1, presetKey) {
  const { start, end } = brushRange();
  t0 = Math.max(start, Math.min(t0, end - MIN_SPAN));
  t1 = Math.min(end, Math.max(t1, t0 + MIN_SPAN));
  sel = { t0, t1 };
  setActiveButton(presetKey || null);
  updateBrushSel();
  draw();
}

function applyPreset(key) {
  const now = nowSec();
  if (key === 'gesamt') {
    const { start } = brushRange();
    setSel(start, now, 'gesamt');
  } else if (PRESETS[key]) {
    setSel(now - PRESETS[key], now, key);
  }
}

let dragMode = null;
let dragOffset = 0;
brushEl.addEventListener('pointerdown', (e) => {
  if (!sel) return;
  brushEl.setPointerCapture(e.pointerId);
  const px = e.clientX - brushEl.getBoundingClientRect().left;
  const t = xToTime(px);
  const target = e.target;
  if (target.classList.contains('left')) dragMode = 'left';
  else if (target.classList.contains('right')) dragMode = 'right';
  else if (target === brushSelEl) { dragMode = 'move'; dragOffset = t - sel.t0; }
  else {
    const span = sel.t1 - sel.t0;
    sel = { t0: t - span / 2, t1: t + span / 2 };
    dragMode = 'move';
    dragOffset = span / 2;
  }
  brushSelEl.classList.add('dragging');
  setActiveButton(null);
  e.preventDefault();
});
brushEl.addEventListener('pointermove', (e) => {
  if (!dragMode || !sel) return;
  const { start, end } = brushRange();
  const px = e.clientX - brushEl.getBoundingClientRect().left;
  const t = Math.max(start, Math.min(end, xToTime(px)));
  if (dragMode === 'left') sel.t0 = Math.min(t, sel.t1 - MIN_SPAN);
  else if (dragMode === 'right') sel.t1 = Math.max(t, sel.t0 + MIN_SPAN);
  else {
    const span = sel.t1 - sel.t0;
    let t0 = t - dragOffset;
    t0 = Math.max(start, Math.min(t0, end - span));
    sel = { t0, t1: t0 + span };
  }
  updateBrushSel();
  draw(); // kein Nachladen nötig — alles liegt lokal vor
});
function endDrag() {
  if (!dragMode) return;
  dragMode = null;
  brushSelEl.classList.remove('dragging');
  draw();
}
brushEl.addEventListener('pointerup', endDrag);
brushEl.addEventListener('pointercancel', endDrag);

document.getElementById('ranges').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-range]');
  if (btn) applyPreset(btn.dataset.range);
});

canvas.addEventListener('mousemove', (e) => {
  if (!layout || !sel) return;
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;
  const { M, plotW, plotH } = layout;
  let next = null;
  if (mx >= M.left && mx <= M.left + plotW && my >= M.top && my <= M.top + plotH) {
    next = sel.t0 + ((mx - M.left) / plotW) * (sel.t1 - sel.t0);
  }
  if (next !== hoverT) { hoverT = next; draw(); }
});
canvas.addEventListener('mouseleave', () => { if (hoverT != null) { hoverT = null; draw(); } });
window.addEventListener('resize', () => { draw(); drawBrush(); updateBrushSel(); });

// --- Legende = Schalter ---------------------------------------------------------
function renderLegend() {
  const el = document.getElementById('chartLegend');
  el.innerHTML = '';
  for (const c of CURVES) {
    const available = !!(result && result.series[c.key]);
    const label = document.createElement('label');
    label.className = !available ? 'na' : isVisible(c.key) ? '' : 'off';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = available && isVisible(c.key);
    cb.disabled = !available;
    cb.addEventListener('change', () => {
      visible[c.key] = cb.checked;
      try { localStorage.setItem(VIS_KEY, JSON.stringify(visible)); } catch (e) {}
      label.className = cb.checked ? '' : 'off';
      draw();
      drawBrush();
    });
    const sw = document.createElement('span');
    sw.className = 'swatch' + (c.dashed ? ' dashed' : '');
    sw.style.borderTopColor = c.color;
    label.append(cb, sw, document.createTextNode(c.label));
    if (c.key === 'costs') {
      label.title = available
        ? 'Kostenquote ' + fmtNum(result.costRate * 100, 1) + ' % = (realisierte Gewinne brutto ' + fmtEur(result.realizedNow) +
          ' − Zuwachs laut Autor ' + fmtEur(result.zuwachs) + ') / brutto, proportional auf den Verlauf verteilt (Näherung).'
        : 'Nicht verfügbar: dafür braucht es die „Statistik"-Angabe „Zuwachs" des Autors und realisierte Gewinne.';
    } else if (c.key === 'invested') {
      label.title = 'Umschlag: Summe aller Kaufsummen – Käufe aus wieder angelegten Erlösen zählen erneut. Was tatsächlich von außen kam, zeigt „Eingesetztes Kapital".';
    } else if (c.key === 'cashNeed') {
      label.title = 'Harte Untergrenze der Einzahlungen: Maximum von (Käufe − Verkaufserlöse) bis zum jeweiligen Tag. Tatsächlich eingezahltes, ungenutztes Geld ist nicht erkennbar. Liegt die Kurve über der 1.500-€-Annahme, gab es Sonderzahlungen.';
    } else if (c.key === 'deposits') {
      label.title = 'Aussage des Circle-Inhabers: 10 Wochen je 1.500 € ab dem ersten Kauf. Liegt der Kapitalbedarf darüber, müssen Sonderzahlungen geflossen sein.';
    } else if (c.key === 'value') {
      label.title = 'Laufende Positionen bewertet mit dem Tageskurs (Yahoo Finance, Fremdwährungen mit dem HEUTIGEN Wechselkurs umgerechnet). Ohne Kursverlauf zählt die Kaufsumme.';
    } else if (c.key === 'potential') {
      label.title = 'Kursziel-Potenzial der laufenden Positionen; für inzwischen verkaufte Positionen rückwirkend nach dem Schema Kaufpreis +10 %.';
    }
    el.appendChild(label);
  }
  if (result) {
    const notes = [];
    if (result.unpriced) notes.push(result.unpriced + ' Position(en) ohne Kursverlauf (Wert = Kaufsumme)');
    if (result.estimatedSells) notes.push(result.estimatedSells + ' Verkaufsdatum/-daten aus der Haltedauer geschätzt');
    if (result.undated) notes.push(result.undated + ' Position(en) ohne Kaufdatum am Anfang eingehängt');
    if (notes.length) {
      const note = document.createElement('span');
      note.className = 'note';
      note.textContent = notes.join(' · ');
      el.appendChild(note);
    }
  }
}

// --- Daten ------------------------------------------------------------------------
function rebuild() {
  result = buildPortfolioSeries(positions, { prices, statistik });
  renderLegend();
  if (!result) {
    statusText = 'Keine datierbaren Positionen im Circle.';
    sel = null;
    draw();
    return;
  }
  if (!sel) applyPreset('gesamt'); // Startansicht: vom ersten Kauf bis heute
  drawBrush();
  updateBrushSel();
  draw();
}

function loadHistoryCache() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function saveHistoryCache(cache) {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(cache)); } catch (e) { /* zu groß/gesperrt -> ohne Cache */ }
}

// Kursverlauf (Tagesdaten) eines Symbols in €; Fremdwährung mit heutigem FX.
const fxCache = {};
async function fetchHistoryEur(symbol, fromSec, toSec) {
  const res = await fetch(yahooChartUrlPeriod(symbol, fromSec, toSec, '1d'), { headers: { 'Accept': 'application/json' } });
  if (!res.ok) return null;
  const json = await res.json();
  const meta = parseYahooChartMeta(json);
  const ser = parseYahooChartSeries(json);
  if (!ser) return null;
  const norm = normalizeQuoteCurrency(meta && meta.currency);
  let factor = norm.scale;
  if (norm.currency && norm.currency !== 'EUR') {
    if (!(norm.currency in fxCache)) {
      const fx = await fetchYahooQuote(fxPairSymbol(norm.currency));
      fxCache[norm.currency] = fx && fx.price > 0 ? fx.price : null;
    }
    if (fxCache[norm.currency] == null) return null;
    factor = norm.scale / fxCache[norm.currency];
  }
  // Heutigen Kurs anhängen, falls die letzte Tageskerze älter ist.
  const timestamps = ser.timestamps.slice();
  const closes = ser.closes.map((c) => c * factor);
  if (meta && meta.price != null && timestamps[timestamps.length - 1] < nowSec() - DAY) {
    timestamps.push(nowSec());
    closes.push(meta.price * factor);
  }
  return { timestamps, closes, currency: norm.currency || 'EUR' };
}

async function loadPrices(symbols) {
  const cache = loadHistoryCache();
  const todo = positions.filter((p) => symbols[p.id] && positionSpan(p));
  let done = 0;
  let changed = false;
  for (const p of todo) {
    const symbol = symbols[p.id];
    const span = positionSpan(p);
    const fromSec = span.buy / 1000 - 5 * DAY;
    const toSec = span.sell != null ? span.sell / 1000 + 2 * DAY : nowSec();
    const key = symbol + '|' + Math.floor(fromSec);
    const hit = cache[key];
    const fresh = hit && hit.from <= fromSec && hit.to >= toSec - DAY &&
      (span.sell != null || Date.now() - (hit.fetchedAt || 0) < HIST_MAX_AGE_MS);
    let ser = fresh ? hit : null;
    if (!ser) {
      setLoading('Lade Kursverläufe ' + (done + 1) + '/' + todo.length + ' (' + symbol + ')');
      try { ser = await fetchHistoryEur(symbol, fromSec, toSec); } catch (e) { ser = null; }
      if (ser) {
        cache[key] = { ...ser, from: fromSec, to: toSec, fetchedAt: Date.now() };
        changed = true;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (ser) prices[p.id] = { timestamps: ser.timestamps, closes: ser.closes };
    done++;
    if (done % 3 === 0 || done === todo.length) rebuild();
  }
  if (changed) saveHistoryCache(cache);
  setLoading(null);
}

function metaLine(circleMeta) {
  const stand = circleMeta && circleMeta.lastPollAt
    ? new Date(circleMeta.lastPollAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '–';
  const open = positions.filter((p) => p.status === 'open').length;
  const closed = positions.length - open;
  return 'Stand ' + stand + ' · ' + open + ' laufende, ' + closed + ' abgeschlossene Positionen' +
    (result ? ' · Kursverlauf für ' + result.priced + ' von ' + positions.length : '') +
    ' · Fremdwährungen ≈ heutiger Wechselkurs';
}

async function init() {
  statusText = '';
  setLoading('Lade Circle-Daten…');
  draw();
  let stored;
  try {
    stored = await api.storage.local.get(['circle', 'circleMeta', 'quoteSymbols']);
  } catch (e) {
    statusText = 'Speicher nicht lesbar.';
    setLoading(null);
    draw();
    return;
  }
  const circleMeta = stored.circleMeta || {};
  if (circleMeta.lastPollOk !== true || !stored.circle || !stored.circle.modules) {
    statusText = 'Keine Circle-Daten – bitte im Popup anmelden bzw. „Jetzt prüfen".';
    setMeta('');
    setLoading(null);
    draw();
    return;
  }
  const pf = computePortfolio(stored.circle.modules);
  positions = pf.positions;
  statistik = pf.statistik;
  const symbols = {};
  const qs = stored.quoteSymbols || {};
  for (const p of positions) if (qs[p.id] && qs[p.id].symbol) symbols[p.id] = qs[p.id].symbol;

  rebuild(); // sofort: die Summen-Kurven brauchen keine Kurse
  setMeta(metaLine(circleMeta));
  await loadPrices(symbols);
  rebuild();
  setMeta(metaLine(circleMeta));
}

init();
