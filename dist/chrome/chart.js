/*
 * chart.js — Kurs-Chart-Fenster (geöffnet vom Circle-Tab, 📈-Knopf).
 *
 * URL-Parameter: symbol (Yahoo), name, buy (EK je Aktie in €), target
 * (Kursziel in €), buyTs (Kaufzeitpunkt in ms). Zeichnet mit reinem Canvas —
 * die Extension-CSP erlaubt keine fremden Chart-Bibliotheken.
 *
 * Aufbau: Hauptchart + darunter ein "Brush" (Mini-Übersicht über ~1 Jahr
 * Tagesdaten) mit frei ziehbarem Auswahlbereich. Presets (Seit Kauf, 12h, …)
 * setzen nur die Auswahl; die Detaildaten werden je Auswahl passend fein
 * aufgelöst nachgeladen (pickChartInterval in lib/quotes.js).
 *
 * Startansicht: Einkaufstag fast ganz links, heute ganz rechts.
 *
 * Der Chart läuft in der Währung der Börse (meta.currency). EK-/Kursziel-
 * Linien sind €-Werte: bei Fremdwährung werden sie mit dem aktuellen FX-Kurs
 * umgerechnet und als "≈" ausgewiesen.
 */

const params = new URLSearchParams(location.search);
const SYMBOL = params.get('symbol') || '';
const NAME = params.get('name') || SYMBOL;
const BUY_EUR = params.get('buy') != null ? Number(params.get('buy')) : null;
const TARGET_EUR = params.get('target') != null ? Number(params.get('target')) : null;
const BUY_TS = params.get('buyTs') != null ? Number(params.get('buyTs')) : null; // ms
const BUY_SEC = BUY_TS != null && isFinite(BUY_TS) ? BUY_TS / 1000 : null;

const DAY = 86400;
const nowSec = () => Date.now() / 1000;

// Preset-Fenster (Sekunden zurück ab jetzt); 'kauf' wird dynamisch berechnet.
const PRESETS = { '12h': 12 * 3600, tage: 7 * DAY, wochen: 21 * DAY, '1mo': 30 * DAY, '3mo': 91 * DAY };
const MIN_SPAN = 2 * 3600; // kleinste wählbare Auswahl: 2 Stunden

const canvas = document.getElementById('chart');
const ctx = canvas.getContext('2d');
const brushEl = document.getElementById('brush');
const brushCanvas = document.getElementById('brushCanvas');
const brushSelEl = document.getElementById('brushSel');

let overview = null;   // { timestamps, closes } — Tagesdaten, Zeitleiste des Brush
let series = null;     // Detailserie der aktuellen Auswahl
let quoteMeta = null;  // { price, currency, symbol }
let fxPerEur = null;   // Einheiten Chart-Währung je 1 EUR (null = EUR/unbekannt)
let sel = null;        // { t0, t1 } in Sekunden
let activePreset = null;
let loadSeq = 0;       // Race-Schutz: nur die jüngste Antwort zählt
let loading = false;

const fmtNum = (n, digits = 2) =>
  Number(n).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function setMeta(text) {
  document.getElementById('chartMeta').textContent = text;
}

// Zeitleiste des Brush: Beginn der Übersichtsdaten bis jetzt.
function brushRange() {
  const start = overview ? overview.timestamps[0] : nowSec() - 365 * DAY;
  return { start, end: nowSec() };
}

// €-Referenzwert in die Chart-Währung bringen (Pence-Skalierung beachten).
function refInChartCurrency(eur) {
  if (eur == null || isNaN(eur)) return null;
  if (!quoteMeta) return null;
  const norm = normalizeQuoteCurrency(quoteMeta.currency);
  if (norm.currency === 'EUR' || norm.currency === null) return eur;
  if (fxPerEur == null) return null;
  return (eur * fxPerEur) / norm.scale;
}

function renderLegend() {
  const el = document.getElementById('chartLegend');
  el.innerHTML = '';
  const item = (borderColor, dashed, label) => {
    const span = document.createElement('span');
    const sw = document.createElement('span');
    sw.className = 'swatch' + (dashed ? ' dashed' : '');
    sw.style.borderTopColor = borderColor;
    span.append(sw, document.createTextNode(label));
    el.appendChild(span);
  };
  item('#1a73e8', false, 'Kurs (' + ((quoteMeta && quoteMeta.currency) || '?') + ')');
  const approx = quoteMeta && normalizeQuoteCurrency(quoteMeta.currency).currency !== 'EUR' ? '≈ ' : '';
  if (refInChartCurrency(BUY_EUR) != null) item('#5f6368', true, approx + 'Einkauf ' + fmtNum(BUY_EUR) + ' €');
  if (refInChartCurrency(TARGET_EUR) != null) item('#d4a017', true, approx + 'Kursziel ' + fmtNum(TARGET_EUR) + ' €');
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

  if (!series) {
    ctx.fillStyle = '#5f6368';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(loading ? 'Lade Kursdaten…' : 'Keine Kursdaten im gewählten Bereich.', w / 2, h / 2);
    return;
  }

  const { timestamps, closes } = series;
  const buyLine = refInChartCurrency(BUY_EUR);
  const targetLine = refInChartCurrency(TARGET_EUR);

  // Wertebereich inkl. Referenzlinien, mit etwas Luft.
  let min = Math.min(...closes);
  let max = Math.max(...closes);
  for (const v of [buyLine, targetLine]) {
    if (v != null) { min = Math.min(min, v); max = Math.max(max, v); }
  }
  const pad = (max - min) * 0.08 || max * 0.05 || 1;
  min -= pad;
  max += pad;

  // Unten Platz für die um 45° gedrehten Beschriftungen.
  const M = { left: 56, right: 14, top: 14, bottom: 56 };
  const plotW = w - M.left - M.right;
  const plotH = h - M.top - M.bottom;
  const x = (i) => M.left + (plotW * i) / Math.max(1, timestamps.length - 1);
  const y = (v) => M.top + plotH * (1 - (v - min) / (max - min));

  // Horizontale Gitterlinien + Werte-Beschriftung.
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
    ctx.fillText(fmtNum(v), M.left - 6, yy);
  }

  // X-Beschriftung: so viele wie hinpassen, um 45° gedreht (kollisionsfrei),
  // je nach Fensterbreite Uhrzeit / Wochentag / Datum.
  const spanSec = timestamps[timestamps.length - 1] - timestamps[0];
  const labelOf = (i) => {
    const d = new Date(timestamps[i] * 1000);
    if (spanSec <= 26 * 3600) {
      return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }
    if (spanSec <= 8 * DAY) {
      return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    }
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };
  const nLabels = Math.max(4, Math.floor(plotW / 60));
  const bottomY = h - M.bottom;
  for (let k = 0; k < nLabels; k++) {
    const i = Math.round(((timestamps.length - 1) * k) / (nLabels - 1));
    const xx = x(i);
    ctx.strokeStyle = '#e0e0e0'; // kurzer Tick an der Achse
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
    ctx.fillText(labelOf(i), 0, 0);
    ctx.restore();
  }

  // Referenzlinien (gestrichelt): Einkauf grau, Kursziel gold.
  const dashLine = (v, color) => {
    if (v == null || v < min || v > max) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(M.left, y(v));
    ctx.lineTo(w - M.right, y(v));
    ctx.stroke();
    ctx.restore();
  };
  dashLine(buyLine, '#5f6368');
  dashLine(targetLine, '#d4a017');

  // Kurslinie mit leichter Flächenfüllung.
  ctx.beginPath();
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) ctx.moveTo(x(i), y(closes[i]));
    else ctx.lineTo(x(i), y(closes[i]));
  }
  ctx.strokeStyle = '#1a73e8';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.lineTo(x(closes.length - 1), M.top + plotH);
  ctx.lineTo(x(0), M.top + plotH);
  ctx.closePath();
  ctx.fillStyle = 'rgba(26, 115, 232, 0.08)';
  ctx.fill();

  // Letzter Kurs als Punkt.
  const li = closes.length - 1;
  ctx.beginPath();
  ctx.arc(x(li), y(closes[li]), 3, 0, 2 * Math.PI);
  ctx.fillStyle = '#1a73e8';
  ctx.fill();

  // Kauf-Markierung: Punkt samt "Kauf"-Label auf der EK-Linie am Kaufzeitpunkt
  // (nur wenn der Kauf im sichtbaren Zeitfenster liegt).
  if (buyLine != null && BUY_SEC != null) {
    if (BUY_SEC >= timestamps[0] && BUY_SEC <= timestamps[timestamps.length - 1]) {
      let bi = 0;
      for (let i = 0; i < timestamps.length; i++) {
        if (timestamps[i] <= BUY_SEC) bi = i;
        else break;
      }
      ctx.beginPath();
      ctx.arc(x(bi), y(buyLine), 4, 0, 2 * Math.PI);
      ctx.fillStyle = '#5f6368';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = '#5f6368';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('Kauf', x(bi), y(buyLine) - 6);
    }
  }
}

// --- Brush (Mini-Übersicht + Auswahl) ------------------------------------------
function timeToX(t) {
  const { start, end } = brushRange();
  return ((t - start) / (end - start)) * brushEl.clientWidth;
}

function xToTime(px) {
  const { start, end } = brushRange();
  return start + (px / brushEl.clientWidth) * (end - start);
}

function drawBrush() {
  const dpr = window.devicePixelRatio || 1;
  const w = brushEl.clientWidth;
  const h = brushEl.clientHeight;
  brushCanvas.width = Math.max(1, Math.floor(w * dpr));
  brushCanvas.height = Math.max(1, Math.floor(h * dpr));
  const bctx = brushCanvas.getContext('2d');
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bctx.clearRect(0, 0, w, h);
  if (!overview) return;

  const { timestamps, closes } = overview;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const y = (v) => 2 + (h - 4) * (1 - (v - min) / (max - min || 1));

  bctx.beginPath();
  for (let i = 0; i < closes.length; i++) {
    const xx = timeToX(timestamps[i]);
    if (i === 0) bctx.moveTo(xx, y(closes[i]));
    else bctx.lineTo(xx, y(closes[i]));
  }
  bctx.strokeStyle = '#9ab8e8';
  bctx.lineWidth = 1;
  bctx.stroke();

  // Kaufzeitpunkt als dezente Markierung in der Übersicht.
  if (BUY_SEC != null && BUY_SEC >= timestamps[0]) {
    const xx = timeToX(BUY_SEC);
    bctx.strokeStyle = '#5f6368';
    bctx.setLineDash([2, 2]);
    bctx.beginPath();
    bctx.moveTo(xx, 0);
    bctx.lineTo(xx, h);
    bctx.stroke();
    bctx.setLineDash([]);
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
  activePreset = key;
  for (const b of document.querySelectorAll('.ranges button')) {
    b.classList.toggle('active', b.dataset.range === key);
  }
}

// Auswahl setzen (geklemmt auf die Brush-Zeitleiste) und Detaildaten laden.
function setSel(t0, t1, presetKey) {
  const { start, end } = brushRange();
  t0 = Math.max(start, Math.min(t0, end - MIN_SPAN));
  t1 = Math.min(end, Math.max(t1, t0 + MIN_SPAN));
  sel = { t0, t1 };
  setActiveButton(presetKey || null);
  updateBrushSel();
  loadDetail();
}

function applyPreset(key) {
  const now = nowSec();
  if (key === 'kauf') {
    if (BUY_SEC == null) return;
    const span = now - BUY_SEC;
    setSel(BUY_SEC - Math.max(DAY, span * 0.04), now, 'kauf'); // Kauf fast ganz links
  } else if (PRESETS[key]) {
    setSel(now - PRESETS[key], now, key);
  }
}

// Drag-Verhalten: Griffe ziehen = Kante ändern, Fläche ziehen = verschieben,
// Klick daneben = Auswahl dorthin zentrieren. Laden erst beim Loslassen.
let dragMode = null; // 'left' | 'right' | 'move'
let dragOffset = 0;  // beim Verschieben: Abstand Zeiger -> Auswahlbeginn (Sek.)

brushEl.addEventListener('pointerdown', (e) => {
  if (!sel) return;
  brushEl.setPointerCapture(e.pointerId);
  const px = e.clientX - brushEl.getBoundingClientRect().left;
  const t = xToTime(px);
  const target = e.target;
  if (target.classList.contains('left')) {
    dragMode = 'left';
  } else if (target.classList.contains('right')) {
    dragMode = 'right';
  } else if (target === brushSelEl) {
    dragMode = 'move';
    dragOffset = t - sel.t0;
  } else {
    // daneben geklickt -> Auswahl (gleiche Breite) dorthin zentrieren
    const span = sel.t1 - sel.t0;
    sel = { t0: t - span / 2, t1: t + span / 2 };
    dragMode = 'move';
    dragOffset = span / 2;
  }
  brushSelEl.classList.add('dragging');
  setActiveButton(null); // manuelle Auswahl -> kein Preset mehr aktiv
  e.preventDefault();
});

brushEl.addEventListener('pointermove', (e) => {
  if (!dragMode || !sel) return;
  const { start, end } = brushRange();
  const px = e.clientX - brushEl.getBoundingClientRect().left;
  const t = Math.max(start, Math.min(end, xToTime(px)));
  if (dragMode === 'left') {
    sel.t0 = Math.min(t, sel.t1 - MIN_SPAN);
  } else if (dragMode === 'right') {
    sel.t1 = Math.max(t, sel.t0 + MIN_SPAN);
  } else {
    const span = sel.t1 - sel.t0;
    let t0 = t - dragOffset;
    t0 = Math.max(start, Math.min(t0, end - span));
    sel = { t0, t1: t0 + span };
  }
  updateBrushSel();
});

function endDrag() {
  if (!dragMode) return;
  dragMode = null;
  brushSelEl.classList.remove('dragging');
  loadDetail(); // erst beim Loslassen nachladen
}
brushEl.addEventListener('pointerup', endDrag);
brushEl.addEventListener('pointercancel', endDrag);

// --- Daten laden ----------------------------------------------------------------
async function fetchSeries(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  quoteMeta = parseYahooChartMeta(json) || quoteMeta;
  return parseYahooChartSeries(json);
}

async function loadDetail() {
  if (!sel) return;
  const seq = ++loadSeq;
  loading = true;
  series = null;
  draw();

  try {
    const span = sel.t1 - sel.t0;
    const interval = pickChartInterval(span, nowSec() - sel.t0);
    let fresh = await fetchSeries(yahooChartUrlPeriod(SYMBOL, sel.t0, sel.t1, interval));

    // Kurzes, leeres Fenster (Börse zu, z. B. "12h" nachts) -> letzter Handelstag.
    let usedFallback = false;
    if (!fresh && span <= 1.5 * DAY) {
      fresh = await fetchSeries(yahooChartUrl(SYMBOL, '1d', '5m'));
      usedFallback = true;
    }
    if (seq !== loadSeq) return; // inzwischen neu ausgewählt
    loading = false;
    series = fresh || null;

    // FX einmalig nachladen, wenn die Börse nicht in Euro notiert.
    const norm = quoteMeta ? normalizeQuoteCurrency(quoteMeta.currency) : { currency: null };
    if (norm.currency && norm.currency !== 'EUR' && fxPerEur == null) {
      const fx = await fetchYahooQuote(fxPairSymbol(norm.currency));
      if (fx && fx.price > 0) fxPerEur = fx.price;
      if (seq !== loadSeq) return;
    }

    setMeta(
      SYMBOL +
      (quoteMeta && quoteMeta.price != null
        ? ' · aktuell ' + fmtNum(quoteMeta.price) + ' ' + (quoteMeta.currency || '')
        : '') +
      (usedFallback ? ' · Börse geschlossen – letzter Handelstag' : ''),
    );
    renderLegend();
    draw();
  } catch (e) {
    if (seq !== loadSeq) return;
    loading = false;
    series = null;
    setMeta(SYMBOL + ' · Kursdaten nicht ladbar (' + String(e.message || e) + ')');
    draw();
  }
}

// --- Init -----------------------------------------------------------------------
async function init() {
  document.getElementById('chartName').textContent = NAME;
  document.title = NAME + ' – Kurs-Chart';
  loading = true;
  draw();

  // Übersichtsdaten für den Brush: mindestens 1 Jahr, immer inkl. Kaufdatum.
  const now = nowSec();
  const start = Math.min(now - 365 * DAY, BUY_SEC != null ? BUY_SEC - 30 * DAY : Infinity);
  try {
    overview = await fetchSeries(yahooChartUrlPeriod(SYMBOL, start, now, '1d'));
  } catch (e) {
    overview = null; // Brush bleibt leer, Presets funktionieren trotzdem
  }
  drawBrush();

  // Startansicht: Einkaufstag fast ganz links, heute ganz rechts.
  if (BUY_SEC != null) applyPreset('kauf');
  else applyPreset('tage');
}

document.getElementById('ranges').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-range]');
  if (btn) applyPreset(btn.dataset.range);
});

window.addEventListener('resize', () => {
  draw();
  drawBrush();
  updateBrushSel();
});

// Ohne Kaufdatum ist "Seit Kauf" nicht anwendbar.
if (BUY_SEC == null) {
  const kaufBtn = document.querySelector('.ranges button[data-range="kauf"]');
  if (kaufBtn) kaufBtn.disabled = true;
}

init();
