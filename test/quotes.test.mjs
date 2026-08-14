/*
 * Tests für lib/quotes.js — die puren Parser/Umrechner (keine Netz-Aufrufe).
 *
 *   node test/quotes.test.mjs
 */
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
runInThisContext(readFileSync(join(here, '..', 'extension', 'lib', 'quotes.js'), 'utf8'));
const {
  yahooChartUrl, yahooChartUrlPeriod, yahooSearchUrl, parseYahooChartMeta,
  parseYahooChartSeries, pickYahooSymbol, pickPlausibleQuote, pickChartInterval,
  normalizeQuoteCurrency, fxPairSymbol, convertToEur,
} = globalThis;

// --- URLs ---------------------------------------------------------------------
assert.equal(
  yahooChartUrl('SAP.DE', '6mo', '1d'),
  'https://query1.finance.yahoo.com/v8/finance/chart/SAP.DE?range=6mo&interval=1d',
);
assert.equal(
  yahooChartUrl('EURUSD=X'),
  'https://query1.finance.yahoo.com/v8/finance/chart/EURUSD%3DX?range=1d&interval=1d',
  'Symbol wird URL-codiert (=X)',
);
assert.ok(yahooSearchUrl('DE0007164600').includes('q=DE0007164600'));
assert.equal(
  yahooChartUrlPeriod('SAP.DE', 1700000000.7, 1700100000.2, '1h'),
  'https://query1.finance.yahoo.com/v8/finance/chart/SAP.DE?period1=1700000000&period2=1700100000&interval=1h',
  'freies Zeitfenster, Sekunden abgerundet',
);

// --- Intervallwahl für freie Zeitfenster ----------------------------------------
const DAY = 86400;
assert.equal(pickChartInterval(12 * 3600, 12 * 3600), '5m', '12h-Fenster von heute');
assert.equal(pickChartInterval(7 * DAY, 7 * DAY), '15m', 'eine Woche zurück');
assert.equal(pickChartInterval(30 * DAY, 30 * DAY), '1h', 'ein Monat');
assert.equal(pickChartInterval(7 * DAY, 100 * DAY), '1h', 'kurzes Fenster, aber zu alt für 15m');
assert.equal(pickChartInterval(200 * DAY, 200 * DAY), '1d', 'lange Fenster in Tageskerzen');
assert.equal(pickChartInterval(30 * DAY, 800 * DAY), '1d', 'älter als die 1h-Historie');

// --- Plausibilitätsprüfung der Symbol-Kandidaten --------------------------------
// Live-Fall Adidas: das Modul trägt die Allianz-ISIN -> der ISIN-Kandidat (441 €)
// passt nicht zum Kursziel 177,63 €, der Namens-Kandidat (161 €) gewinnt.
assert.equal(
  pickPlausibleQuote(
    [{ symbol: 'ALV.DE', priceEur: 441.9 }, { symbol: 'ADS.DE', priceEur: 160.8 }],
    177.63,
  ).symbol,
  'ADS.DE',
);
assert.equal(
  pickPlausibleQuote([{ symbol: 'ALV.DE', priceEur: 441.9 }], 177.63),
  null,
  'einziger Kandidat weicht > Faktor 2 ab -> lieber kein Kurs',
);
assert.equal(
  pickPlausibleQuote([{ symbol: 'SAP.DE', priceEur: 183 }], 180).symbol,
  'SAP.DE',
  'passender Kandidat wird akzeptiert',
);
assert.equal(
  pickPlausibleQuote([{ symbol: 'X.DE', priceEur: 50 }, { symbol: 'Y.DE', priceEur: 99 }], null).symbol,
  'X.DE',
  'ohne Anker entscheidet die Reihenfolge',
);
assert.equal(
  pickPlausibleQuote([{ symbol: 'X.DE', priceEur: null }], 100).symbol,
  'X.DE',
  'ohne Kurs keine Prüfung möglich -> Kandidat bleibt nutzbar (Chart)',
);
assert.equal(pickPlausibleQuote([], 100), null);

// --- Chart-Meta (aktueller Kurs) ----------------------------------------------
const chartFixture = {
  chart: {
    result: [{
      meta: { symbol: 'SAP.DE', currency: 'EUR', regularMarketPrice: 231.45, chartPreviousClose: 229.9 },
      timestamp: [1700000000, 1700086400, 1700172800],
      indicators: { quote: [{ close: [229.9, null, 231.45] }] },
    }],
    error: null,
  },
};
assert.deepEqual(parseYahooChartMeta(chartFixture), {
  symbol: 'SAP.DE', price: 231.45, currency: 'EUR', previousClose: 229.9,
});
assert.equal(parseYahooChartMeta({ chart: { result: [] } }), null);
assert.equal(parseYahooChartMeta(null), null);

// --- Chart-Zeitreihe (Lücken herausfiltern) -----------------------------------
assert.deepEqual(parseYahooChartSeries(chartFixture), {
  timestamps: [1700000000, 1700172800],
  closes: [229.9, 231.45],
});
assert.equal(parseYahooChartSeries({ chart: { result: [{ meta: {} }] } }), null);

// --- Symbolwahl aus der Suche --------------------------------------------------
const searchFixture = {
  quotes: [
    { symbol: 'SAP', quoteType: 'EQUITY', exchange: 'NYQ' },      // US-Listing
    { symbol: 'SAP.DE', quoteType: 'EQUITY', exchange: 'GER' },   // XETRA -> gewinnt
    { symbol: 'SAP.F', quoteType: 'EQUITY', exchange: 'FRA' },
    { symbol: 'SAPGF', quoteType: 'OPTION' },                     // kein EQUITY
  ],
};
assert.equal(pickYahooSymbol(searchFixture), 'SAP.DE', 'XETRA-Listing bevorzugt');
assert.equal(
  pickYahooSymbol({ quotes: [{ symbol: 'NIBE-B.ST', quoteType: 'EQUITY' }] }),
  'NIBE-B.ST',
  'ohne deutsches Listing: Heimatbörse',
);
assert.equal(pickYahooSymbol({ quotes: [{ symbol: 'X', quoteType: 'OPTION' }] }), null);
assert.equal(pickYahooSymbol({}), null);

// --- Währung / Euro-Umrechnung --------------------------------------------------
assert.deepEqual(normalizeQuoteCurrency('EUR'), { currency: 'EUR', scale: 1 });
assert.deepEqual(normalizeQuoteCurrency('GBp'), { currency: 'GBP', scale: 0.01 }, 'Londoner Pence');
assert.equal(fxPairSymbol('USD'), 'EURUSD=X');

assert.equal(convertToEur(100, 'EUR', null), 100);
// 108 USD bei 1,08 USD/EUR -> 100 €
assert.equal(convertToEur(108, 'USD', 1.08), 100);
// 850 Pence bei 0,85 GBP/EUR -> 10 €
assert.equal(convertToEur(850, 'GBp', 0.85), 10);
assert.equal(convertToEur(100, 'USD', null), null, 'ohne FX-Kurs keine Umrechnung');
assert.equal(convertToEur(100, 'USD', 0), null, 'FX-Kurs 0 ist ungültig');
assert.equal(convertToEur(NaN, 'EUR', null), null);

console.log('quotes.test.mjs: alle Assertions bestanden ✓');
