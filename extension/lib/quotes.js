/*
 * quotes.js — Kursdaten über die (inoffizielle) Yahoo-Finance-Chart-API.
 *
 * Wie ampel.js/circle.js bewusst KEIN ES-Modul: wird via importScripts
 * (Chrome-SW), background.scripts (Firefox), <script> (Popup/Chart-Fenster)
 * geladen; alles liegt auf globalThis.
 *
 * Warum Yahoo: einzige dauerhaft kostenlose Quelle ohne API-Key mit
 * Chart-Historie UND allen EU-Börsen (XETRA .DE, Paris .PA, Stockholm .ST …).
 * Inoffiziell -> alle Aufrufe defensiv, bei Ausfall zeigt das Popup "–".
 * Die Fetches laufen aus Extension-Kontexten mit host_permissions auf
 * query1/query2.finance.yahoo.com, dadurch greift CORS nicht.
 */

const QUOTES_CONFIG = {
  chartBase: 'https://query1.finance.yahoo.com/v8/finance/chart/',
  searchBase: 'https://query2.finance.yahoo.com/v1/finance/search',
};

function yahooChartUrl(symbol, range, interval) {
  return (
    QUOTES_CONFIG.chartBase + encodeURIComponent(symbol) +
    '?range=' + encodeURIComponent(range || '1d') +
    '&interval=' + encodeURIComponent(interval || '1d')
  );
}

// Chart-URL mit freiem Zeitfenster (Unix-Sekunden) statt fester range.
function yahooChartUrlPeriod(symbol, period1, period2, interval) {
  return (
    QUOTES_CONFIG.chartBase + encodeURIComponent(symbol) +
    '?period1=' + Math.floor(period1) +
    '&period2=' + Math.floor(period2) +
    '&interval=' + encodeURIComponent(interval || '1d')
  );
}

function yahooSearchUrl(query) {
  return QUOTES_CONFIG.searchBase + '?q=' + encodeURIComponent(query) + '&quotesCount=8&newsCount=0';
}

// --- Antwort-Parser (pur, testbar) -------------------------------------------

// Aktueller Kurs + Währung aus einer Chart-Antwort. null bei Fehlern.
function parseYahooChartMeta(json) {
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  const meta = r && r.meta;
  if (!meta || typeof meta.regularMarketPrice !== 'number') return null;
  return {
    symbol: meta.symbol || null,
    price: meta.regularMarketPrice,
    currency: meta.currency || null,
    previousClose: typeof meta.chartPreviousClose === 'number' ? meta.chartPreviousClose : null,
  };
}

// Zeitreihe (Schlusskurse) aus einer Chart-Antwort; Lücken (null) werden
// herausgefiltert. { timestamps: [Sekunden], closes: [] } oder null.
function parseYahooChartSeries(json) {
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  const ts = r && r.timestamp;
  const closes =
    r && r.indicators && r.indicators.quote && r.indicators.quote[0] &&
    r.indicators.quote[0].close;
  if (!Array.isArray(ts) || !Array.isArray(closes)) return null;
  const outT = [];
  const outC = [];
  for (let i = 0; i < ts.length; i++) {
    if (typeof closes[i] === 'number' && isFinite(closes[i])) {
      outT.push(ts[i]);
      outC.push(closes[i]);
    }
  }
  return outT.length ? { timestamps: outT, closes: outC } : null;
}

// Bestes Symbol aus einer Yahoo-Suchantwort wählen. Bevorzugt Aktien und
// darunter €-nahe Listings: XETRA (.DE) vor sonstigen deutschen Plätzen vor
// dem ersten Treffer (Heimatbörse). null, wenn nichts Brauchbares dabei ist.
function pickYahooSymbol(searchJson) {
  const quotes = (searchJson && searchJson.quotes) || [];
  const equities = quotes.filter(
    (q) => q && q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF'),
  );
  if (!equities.length) return null;
  const score = (q) => {
    const s = q.symbol;
    if (/\.DE$/.test(s)) return 3; // XETRA, EUR, liquide
    if (/\.(F|SG|BE|MU|DU|HM|HA)$/.test(s)) return 2; // sonstige dt. Plätze (EUR)
    return 1; // Heimatbörse / erster Treffer
  };
  let best = equities[0];
  for (const q of equities) if (score(q) > score(best)) best = q;
  return best.symbol;
}

// Plausibelsten Kandidaten wählen. Hintergrund: die Stammdaten der Module sind
// nicht immer sauber (live gesehen: Adidas-Modul mit Allianz-ISIN/-Ticker) —
// deshalb werden ISIN/WKN/Name ALLE aufgelöst und gegen einen Anker-Preis der
// Position (Kursziel bzw. EK je Aktie, in €) geprüft.
// candidates: [{symbol, priceEur, …}] in Prioritätsreihenfolge.
// Rückgabe: der Kandidat, dessen Kurs dem Anker am nächsten liegt — aber nur,
// wenn er um weniger als Faktor 2 abweicht; sonst null (lieber kein Kurs als
// der einer fremden Aktie). Ohne Anker oder ohne Kurse: erster Kandidat.
function pickPlausibleQuote(candidates, anchorEur) {
  const withSym = (candidates || []).filter((c) => c && c.symbol);
  if (!withSym.length) return null;
  if (anchorEur == null || !(anchorEur > 0)) return withSym[0];
  const priced = withSym.filter(
    (c) => typeof c.priceEur === 'number' && isFinite(c.priceEur) && c.priceEur > 0,
  );
  if (!priced.length) return withSym[0]; // ohne Kurs keine Prüfung möglich
  let best = priced[0];
  let bestDev = Math.abs(Math.log(best.priceEur / anchorEur));
  for (const c of priced) {
    const dev = Math.abs(Math.log(c.priceEur / anchorEur));
    if (dev < bestDev) { best = c; bestDev = dev; }
  }
  return bestDev <= Math.log(2) ? best : null;
}

// Passendes Yahoo-Intervall für ein freies Zeitfenster wählen.
// spanSec = Fensterbreite, startAgeSec = wie weit der Fensterbeginn zurückliegt.
// Yahoo-Limits: 5m-/15m-Daten reichen nur ~60 Tage zurück, 1h ~730 Tage.
function pickChartInterval(spanSec, startAgeSec) {
  const DAY = 86400;
  const intradayOk = startAgeSec <= 55 * DAY;
  if (spanSec <= 1.5 * DAY && intradayOk) return '5m';
  if (spanSec <= 10 * DAY && intradayOk) return '15m';
  if (spanSec <= 90 * DAY && startAgeSec <= 700 * DAY) return '1h';
  return '1d';
}

// --- Währung ------------------------------------------------------------------

// Yahoo notiert Londoner Kurse in Pence (GBp/GBX) -> auf GBP normalisieren.
function normalizeQuoteCurrency(currency) {
  if (currency === 'GBp' || currency === 'GBX') return { currency: 'GBP', scale: 0.01 };
  return { currency: currency || null, scale: 1 };
}

// FX-Symbol für die Umrechnung nach Euro: 'EURUSD=X' = USD je 1 EUR.
function fxPairSymbol(currency) {
  return 'EUR' + currency + '=X';
}

// Kurs in fremder Währung -> Euro. fxPerEur = Einheiten der (normalisierten)
// Währung je 1 EUR (Kurs von fxPairSymbol). null, wenn nicht umrechenbar.
function convertToEur(price, currency, fxPerEur) {
  if (typeof price !== 'number' || !isFinite(price)) return null;
  const norm = normalizeQuoteCurrency(currency);
  if (norm.currency === 'EUR' || norm.currency === null) return price * norm.scale;
  if (typeof fxPerEur !== 'number' || !isFinite(fxPerEur) || fxPerEur <= 0) return null;
  return (price * norm.scale) / fxPerEur;
}

// --- Fetch-Helfer (Extension-Kontexte) ----------------------------------------

async function fetchYahooQuote(symbol) {
  try {
    const res = await fetch(yahooChartUrl(symbol, '1d', '1d'), {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    return parseYahooChartMeta(await res.json());
  } catch (e) {
    return null;
  }
}

// undefined = Abruf gescheitert (Netz/Drossel — Wiederholung sinnvoll);
// Objekt = Antwort da (auch wenn sie keine Treffer enthält).
async function fetchYahooSearch(query) {
  try {
    const res = await fetch(yahooSearchUrl(query), {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return undefined;
    return await res.json();
  } catch (e) {
    return undefined;
  }
}

// In Service-Worker, Popup und Chart-Fenster gleichermaßen erreichbar machen.
if (typeof globalThis !== 'undefined') {
  globalThis.QUOTES_CONFIG = QUOTES_CONFIG;
  globalThis.yahooChartUrl = yahooChartUrl;
  globalThis.yahooChartUrlPeriod = yahooChartUrlPeriod;
  globalThis.pickPlausibleQuote = pickPlausibleQuote;
  globalThis.pickChartInterval = pickChartInterval;
  globalThis.yahooSearchUrl = yahooSearchUrl;
  globalThis.parseYahooChartMeta = parseYahooChartMeta;
  globalThis.parseYahooChartSeries = parseYahooChartSeries;
  globalThis.pickYahooSymbol = pickYahooSymbol;
  globalThis.normalizeQuoteCurrency = normalizeQuoteCurrency;
  globalThis.fxPairSymbol = fxPairSymbol;
  globalThis.convertToEur = convertToEur;
  globalThis.fetchYahooQuote = fetchYahooQuote;
  globalThis.fetchYahooSearch = fetchYahooSearch;
}
