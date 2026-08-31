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
  sparkBase: 'https://query1.finance.yahoo.com/v8/finance/spark',
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

// Sammelabruf: EIN Request liefert den aktuellen Kurs + Vortagesschluss für
// viele Symbole (keyless wie die Chart-API). Genutzt für die Ampel-Kurse, wo
// ein Klick auf "Kurse laden" gleich 20–30 Aktien betrifft. Die Antwort trägt
// KEINE Währung — die kennt der Aufrufer aus dem ersten Einzelabruf je Symbol.
function yahooSparkUrl(symbols) {
  return (
    QUOTES_CONFIG.sparkBase + '?symbols=' + encodeURIComponent((symbols || []).join(',')) +
    '&range=1d&interval=1d'
  );
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

// Spark-Antwort (range=1d): { SYMBOL: { close: [..], chartPreviousClose, timestamp } }.
// Ergebnis: symbol -> { price, previousClose } — nur Symbole mit gültigem
// Kurs; unbekannte Symbole lässt Yahoo stillschweigend weg.
function parseYahooSpark(json) {
  const out = {};
  if (!json || typeof json !== 'object') return out;
  for (const sym of Object.keys(json)) {
    const r = json[sym];
    const closes = r && Array.isArray(r.close) ? r.close.filter((c) => typeof c === 'number' && isFinite(c)) : [];
    if (!closes.length) continue;
    const prev = typeof r.chartPreviousClose === 'number' && isFinite(r.chartPreviousClose)
      ? r.chartPreviousClose
      : typeof r.previousClose === 'number' && isFinite(r.previousClose) ? r.previousClose : null;
    out[r.symbol || sym] = { price: closes[closes.length - 1], previousClose: prev };
  }
  return out;
}

// Veränderung zum Vortagesschluss in Prozent (2 Nachkommastellen), null ohne
// brauchbare Basis. Währungsunabhängig — beide Werte stammen von derselben Börse.
function dailyChangePct(price, previousClose) {
  if (typeof price !== 'number' || !isFinite(price)) return null;
  if (typeof previousClose !== 'number' || !isFinite(previousClose) || previousClose <= 0) return null;
  return Math.round((price / previousClose - 1) * 10000) / 100;
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

// --- Namens-Auflösung (Ampel: nur der Firmenname, keine ISIN/WKN, kein Anker) --
// Die Ampel-Module tragen nur den Namen, wie der Autor ihn schreibt ("Muenchner
// Rückversicherung", "Dr. Ing. hc. F. Porsche AG (Porsche AG)"). Deshalb:
//  - mehrere Suchanfragen je Name (Original, Klammerzusatz, bereinigt, erstes/
//    letztes Wort) — die erste mit passendem Treffer gewinnt;
//  - Treffer werden gegen den Namen geprüft (Rechtsformen ignoriert, Umlaute
//    transliteriert, 1 Tippfehler erlaubt), damit kein fremdes Unternehmen
//    durchrutscht (live: "Bayer" -> Yahoo nennt Bayer zuerst, die blinde
//    .DE-Präferenz griff sich aber BMW = "Bayerische Motoren Werke").
const NAME_LEGAL_FORMS = new Set([
  'ag', 'se', 'sa', 'spa', 'nv', 'plc', 'ab', 'asa', 'oyj', 'kgaa', 'co', 'inc', 'corp',
  'ltd', 'lp', 'gmbh', 'kg', 'sca', 'bv', 'srl', 'pcl', 'the', 'aktiengesellschaft',
]);
// Erste Wörter, die allein KEINE Firma identifizieren (sonst wäre "Deutsche Bank"
// = "Deutsche Telekom").
const NAME_GENERIC_FIRST = new Set([
  'deutsche', 'deutsches', 'german', 'europe', 'european', 'international', 'global',
  'national', 'general', 'united', 'american', 'first', 'new', 'bank', 'group', 'holding',
  'holdings', 'industries', 'capital', 'energy', 'power', 'financial', 'technologies',
  'systems', 'solutions', 'partners', 'nordic', 'north', 'south', 'west', 'east', 'swiss',
  'royal', 'china', 'asia', 'dr', 'ing',
]);

function normalizeCompanyName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[éèê]/g, 'e').replace(/[áàâ]/g, 'a').replace(/[óòô]/g, 'o')
    .replace(/[.'’`´]/g, '')          // E.ON -> eon, S.p.A -> spa, h.c. -> hc
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Bedeutungstragende Wörter: ohne Rechtsformen und Einzelzeichen (Yahoo hängt
// an Kurznamen Buchstaben wie "N"/"I"/"A" für die Aktiengattung an).
function companyTokens(s) {
  return normalizeCompanyName(s).split(' ').filter((t) => t.length > 1 && !NAME_LEGAL_FORMS.has(t));
}

// Höchstens ein Tippfehler (einfügen/löschen/ersetzen) zwischen zwei Wörtern?
function withinOneEdit(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// Gleiches Wort? Exakt, als langer Wortanfang ("rueckvers" ~ "rueckversicherung",
// aber NICHT "bayer" ~ "bayerische") oder mit einem Tippfehler bei langen Wörtern.
function companyTokensMatch(a, b) {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.startsWith(short) && (short.length >= 8 || (short.length >= 5 && long.length - short.length <= 2))) return true;
  return short.length >= 6 && withinOneEdit(a, b);
}

// Referenz für den Abgleich: steht ein Klammerzusatz im Namen ("… (Porsche AG)"),
// meint der Autor damit den gebräuchlichen Namen -> der zählt.
function referenceCompanyName(name) {
  const paren = /\(([^)]+)\)/.exec(name || '');
  if (paren && companyTokens(paren[1]).length) return paren[1];
  return String(name || '').replace(/\([^)]*\)/g, ' ');
}

// Kurzes Kürzel als erstes Wort (ACS, AAK, E.ON, A2A, RWE) identifiziert die
// Firma allein — ein zweites Wort muss dann nicht zusätzlich passen.
function startsWithAcronym(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return /^[A-Z0-9][A-Z0-9.&]{1,4}$/.test(first) && /[A-Z]/.test(first);
}

// Ist der Treffer (Kurzname) dieselbe Firma wie der Ampel-Name?
function sameCompany(nameTokens, hitTokens, acronym) {
  if (!nameTokens.length || !hitTokens.length) return false;
  if (!hitTokens.some((h) => companyTokensMatch(nameTokens[0], h))) return false;
  if (nameTokens.length === 1 || hitTokens.length === 1 || acronym) return true;
  return nameTokens.slice(1).some((n) => hitTokens.slice(1).some((h) => companyTokensMatch(n, h)));
}

// Selbe Firma unter Treffern (für die Börsenwahl): die ersten beiden Wörter passen.
function sameFamily(a, b) {
  if (!a.length || !b.length || !companyTokensMatch(a[0], b[0])) return false;
  return a.length < 2 || b.length < 2 || companyTokensMatch(a[1], b[1]);
}

// Symbol für einen FIRMENNAMEN wählen. Anders als pickYahooSymbol gilt die
// Börsen-Präferenz nur INNERHALB derselben Firma: Yahoos bestplatzierter
// Aktien-Treffer, der zum Namen passt, bestimmt die Firma; darunter gewinnt das
// €-nächste Listing (XETRA > sonstige dt. Plätze > Heimatbörse > US-OTC).
// null, wenn kein Treffer zum Namen passt (lieber kein Kurs als ein fremder).
function pickYahooSymbolForName(searchJson, name) {
  const quotes = (searchJson && searchJson.quotes) || [];
  const equities = quotes.filter(
    (q) => q && q.symbol && (q.quoteType === 'EQUITY' || q.quoteType === 'ETF') &&
      !/^[A-Z]{2}[A-Z0-9]{9}\d\./.test(q.symbol), // ISIN-Symbole = Zertifikate, keine Aktien
  );
  const ref = referenceCompanyName(name);
  const nameTokens = companyTokens(ref);
  const acronym = startsWithAcronym(ref);
  const hitTokens = (q) => companyTokens(q.shortname || q.longname || '');
  const top = equities.find((q) => sameCompany(nameTokens, hitTokens(q), acronym));
  if (!top) return null;
  const family = hitTokens(top);
  // Gleiche Symbolbasis = gleiche Firma, auch wenn Yahoo den Namen je Börse
  // anders schreibt (live: "BMW AG" = BMW.SW, "BAYERISCHE MOTOREN WERKE" = BMW.DE).
  const base = (q) => q.symbol.replace(/\..*$/, '');
  const rank = (q) => {
    if (/\.DE$/.test(q.symbol)) return 4;                      // XETRA, EUR, liquide
    if (/\.(F|SG|BE|MU|DU|HM|HA)$/.test(q.symbol)) return 3;  // sonstige dt. Plätze (EUR)
    if (/\.(PA|MI|BR|AS|MC|LS|VI|HE|IR|AT)$/.test(q.symbol)) return 2; // Euro-Heimatbörsen
    if (q.exchange === 'PNK' || q.exchange === 'OQX' || q.exchange === 'OQB') return 0; // US-OTC (USD)
    return 1;                                                  // andere Heimatbörse / USA
  };
  let best = top;
  for (const q of equities) {
    if (q === top) continue;
    if (!sameFamily(family, hitTokens(q)) && base(q) !== base(top)) continue;
    if (rank(q) > rank(best)) best = q;
  }
  return best.symbol;
}

// Suchanfragen für einen Namen, in Prioritätsreihenfolge (höchstens 5).
function nameSearchQueries(name) {
  const out = [];
  const push = (q) => {
    q = String(q || '').trim();
    if (q.length >= 2 && !out.some((o) => o.toLowerCase() === q.toLowerCase())) out.push(q);
  };
  push(name);
  const paren = /\(([^)]+)\)/.exec(name || '');
  if (paren) push(paren[1]);
  const toks = companyTokens(String(name || '').replace(/\([^)]*\)/g, ' '));
  push(toks.join(' '));
  if (toks[0] && toks[0].length >= 4) push(toks[0]);
  const last = toks[toks.length - 1];
  if (toks.length > 1 && last.length >= 6) push(last);
  return out.slice(0, 5);
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

// Sammelabruf; null bei Fehler (Aufrufer fällt auf Einzelabrufe zurück).
async function fetchYahooSpark(symbols) {
  if (!symbols || !symbols.length) return {};
  try {
    const res = await fetch(yahooSparkUrl(symbols), {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    return parseYahooSpark(await res.json());
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
  globalThis.yahooSparkUrl = yahooSparkUrl;
  globalThis.parseYahooSpark = parseYahooSpark;
  globalThis.dailyChangePct = dailyChangePct;
  globalThis.fetchYahooSpark = fetchYahooSpark;
  globalThis.parseYahooChartMeta = parseYahooChartMeta;
  globalThis.parseYahooChartSeries = parseYahooChartSeries;
  globalThis.pickYahooSymbol = pickYahooSymbol;
  globalThis.pickYahooSymbolForName = pickYahooSymbolForName;
  globalThis.nameSearchQueries = nameSearchQueries;
  globalThis.companyTokens = companyTokens;
  globalThis.normalizeQuoteCurrency = normalizeQuoteCurrency;
  globalThis.fxPairSymbol = fxPairSymbol;
  globalThis.convertToEur = convertToEur;
  globalThis.fetchYahooQuote = fetchYahooQuote;
  globalThis.fetchYahooSearch = fetchYahooSearch;
}
