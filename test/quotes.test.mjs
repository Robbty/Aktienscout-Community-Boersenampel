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
  yahooChartUrl, yahooSearchUrl, parseYahooChartMeta, parseYahooChartSeries,
  pickYahooSymbol, normalizeQuoteCurrency, fxPairSymbol, convertToEur,
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
