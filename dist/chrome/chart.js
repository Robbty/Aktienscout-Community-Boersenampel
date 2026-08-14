/*
 * chart.js — Kurs-Chart-Fenster (geöffnet vom Circle-Tab, 📈-Knopf).
 *
 * URL-Parameter: symbol (Yahoo), name, buy (EK je Aktie in €), target
 * (Kursziel in €). Zeichnet mit reinem Canvas — die Extension-CSP erlaubt
 * keine fremden Chart-Bibliotheken, und nötig sind sie hier auch nicht.
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

// Zeiträume: kurze Fenster über period1/period2 (frei wählbar), lange über
// Yahoos range-Parameter. fallback greift, wenn das Fenster leer ist (Börse
// zu, z. B. "12h" nachts) -> dann letzter Handelstag.
const RANGES = {
  '12h': { hours: 12, interval: '5m', fallback: { range: '1d', interval: '5m' } },
  tage: { range: '5d', interval: '15m' },   // 5 Handelstage
  wochen: { hours: 21 * 24, interval: '1h' }, // ~3 Wochen
  '1mo': { range: '1mo', interval: '1d' },
  '3mo': { range: '3mo', interval: '1d' },
};

function rangeUrl(cfg) {
  if (cfg.range) return yahooChartUrl(SYMBOL, cfg.range, cfg.interval);
  const now = Date.now() / 1000;
  return yahooChartUrlPeriod(SYMBOL, now - cfg.hours * 3600, now, cfg.interval);
}

const canvas = document.getElementById('chart');
const ctx = canvas.getContext('2d');

let series = null;      // { timestamps, closes }
let quoteMeta = null;   // { price, currency, symbol }
let fxPerEur = null;    // Einheiten Chart-Währung je 1 EUR (null = EUR/unbekannt)
let currentRange = 'tage';

const fmtNum = (n, digits = 2) =>
  Number(n).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function setMeta(text) {
  document.getElementById('chartMeta').textContent = text;
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
    ctx.fillText('Lade Kursdaten…', w / 2, h / 2);
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

  const M = { left: 56, right: 14, top: 14, bottom: 26 }; // Ränder für Achsen
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

  // Beschriftung Anfang/Mitte/Ende — bei kurzen Fenstern Uhrzeit statt Datum.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const spanSec = timestamps[timestamps.length - 1] - timestamps[0];
  const labelOf = (i) => {
    const d = new Date(timestamps[i] * 1000);
    if (spanSec <= 26 * 3600) {
      return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }
    if (spanSec <= 8 * 86400) {
      return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
    }
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };
  const idxs = [0, Math.floor((timestamps.length - 1) / 2), timestamps.length - 1];
  for (const i of idxs) ctx.fillText(labelOf(i), x(i), h - M.bottom + 6);

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

  // Letzter Kurs als Punkt + Label.
  const li = closes.length - 1;
  ctx.beginPath();
  ctx.arc(x(li), y(closes[li]), 3, 0, 2 * Math.PI);
  ctx.fillStyle = '#1a73e8';
  ctx.fill();

  // Kauf-Markierung: Punkt samt "Kauf"-Label auf der EK-Linie am Kaufzeitpunkt
  // (nur wenn der Kauf im sichtbaren Zeitfenster liegt).
  if (buyLine != null && BUY_TS != null) {
    const buySec = BUY_TS / 1000;
    if (buySec >= timestamps[0] && buySec <= timestamps[timestamps.length - 1]) {
      let bi = 0;
      for (let i = 0; i < timestamps.length; i++) {
        if (timestamps[i] <= buySec) bi = i;
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

async function load(range) {
  currentRange = range;
  for (const b of document.querySelectorAll('.ranges button')) {
    b.classList.toggle('active', b.dataset.range === range);
  }
  series = null;
  draw();

  try {
    const cfg = RANGES[range] || RANGES.tage;
    let res = await fetch(rangeUrl(cfg), { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    let json = await res.json();
    quoteMeta = parseYahooChartMeta(json) || quoteMeta;
    let fresh = parseYahooChartSeries(json);

    // Leeres Fenster (Börse zu, z. B. "12h" nachts) -> letzter Handelstag.
    let usedFallback = false;
    if (!fresh && cfg.fallback) {
      res = await fetch(yahooChartUrl(SYMBOL, cfg.fallback.range, cfg.fallback.interval), {
        headers: { 'Accept': 'application/json' },
      });
      if (res.ok) {
        json = await res.json();
        quoteMeta = parseYahooChartMeta(json) || quoteMeta;
        fresh = parseYahooChartSeries(json);
        usedFallback = true;
      }
    }
    if (!fresh) throw new Error('keine Kursdaten');
    if (range !== currentRange) return; // Nutzer hat inzwischen umgeschaltet
    series = fresh;

    // FX einmalig nachladen, wenn die Börse nicht in Euro notiert.
    const norm = quoteMeta ? normalizeQuoteCurrency(quoteMeta.currency) : { currency: null };
    if (norm.currency && norm.currency !== 'EUR' && fxPerEur == null) {
      const fx = await fetchYahooQuote(fxPairSymbol(norm.currency));
      if (fx && fx.price > 0) fxPerEur = fx.price;
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
    setMeta(SYMBOL + ' · Kursdaten nicht ladbar (' + String(e.message || e) + ')');
    series = null;
    draw();
  }
}

document.getElementById('chartName').textContent = NAME;
document.title = NAME + ' – Kurs-Chart';
document.getElementById('ranges').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-range]');
  if (btn) load(btn.dataset.range);
});
window.addEventListener('resize', draw);

load(currentRange);
