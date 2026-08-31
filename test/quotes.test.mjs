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
  yahooSparkUrl, parseYahooSpark, dailyChangePct,
  pickYahooSymbolForName, nameSearchQueries, companyTokens,
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

// --- Sammelabruf (spark) für die Ampel-Kurse -------------------------------------
assert.equal(
  yahooSparkUrl(['ADS.DE', 'EURUSD=X']),
  'https://query1.finance.yahoo.com/v8/finance/spark?symbols=ADS.DE%2CEURUSD%3DX&range=1d&interval=1d',
  'alle Symbole in einem Request, URL-codiert',
);
// Live-Form (31.08.2026): unbekannte Symbole fehlen einfach, previousClose ist null,
// chartPreviousClose trägt den Vortagesschluss, close[] den aktuellen Kurs.
const spark = parseYahooSpark({
  'ADS.DE': { timestamp: [1788172620], symbol: 'ADS.DE', close: [152.9], previousClose: null, chartPreviousClose: 154.2 },
  'BABA': { symbol: 'BABA', close: [null, 118.9], chartPreviousClose: 116.31 },
  'LEER': { symbol: 'LEER', close: [null], chartPreviousClose: 1 },
  'OHNE': { symbol: 'OHNE', close: [10] },
});
assert.deepEqual(spark['ADS.DE'], { price: 152.9, previousClose: 154.2 });
assert.deepEqual(spark.BABA, { price: 118.9, previousClose: 116.31 }, 'Lücken (null) übersprungen, letzter Kurs zählt');
assert.equal(spark.LEER, undefined, 'ohne gültigen Kurs kein Eintrag');
assert.deepEqual(spark.OHNE, { price: 10, previousClose: null }, 'ohne Vortagesschluss trotzdem Kurs');
assert.deepEqual(parseYahooSpark(null), {});
assert.deepEqual(parseYahooSpark({ finance: { error: 'x' } }), {}, 'Fehlerantwort -> leer');

assert.equal(dailyChangePct(152.9, 154.2), -0.84, 'Adidas: -0,84 % zum Vortag');
assert.equal(dailyChangePct(118.9, 116.31), 2.23);
assert.equal(dailyChangePct(100, 100), 0);
assert.equal(dailyChangePct(100, null), null);
assert.equal(dailyChangePct(100, 0), null, 'Basis 0 ist ungültig');
assert.equal(dailyChangePct(NaN, 100), null);

// --- Namens-Auflösung für Ampel-Aktien (Treffer = Live-Mitschnitte 31.08.2026) ---
const hit = (symbol, shortname, exchange = 'GER', quoteType = 'EQUITY') => ({ symbol, shortname, exchange, quoteType });

assert.deepEqual(companyTokens('Fresenius SE & Co KGaA'), ['fresenius']);
assert.deepEqual(companyTokens('E.ON SE'), ['eon']);
assert.deepEqual(companyTokens('Muenchner Rückversicherung'), ['muenchner', 'rueckversicherung']);
assert.deepEqual(companyTokens('Bayer AG                      N'), ['bayer'], 'Gattungsbuchstabe von Yahoo fällt weg');

// Live-Fehler: "Bayer" -> die blinde .DE-Präferenz griff sich BMW.
const bayer = { quotes: [
  hit('BAYRY', 'Bayer A.G.', 'OQX'),
  hit('BMW.DE', 'BAYERISCHE MOTOREN WERKE AG   S'),
  hit('1BAYN.MI', 'BAYER', 'MIL'),
  hit('DE000SL0FKP0.SG', 'Solactive BAYER AR 2 Index', 'STU', 'INDEX'),
  hit('BAYN.DE', 'Bayer AG                      N'),
  hit('BAYA.F', 'BAYER AG                      N', 'FRA'),
] };
assert.equal(pickYahooSymbolForName(bayer, 'Bayer'), 'BAYN.DE', 'Bayer: XETRA-Listing der RICHTIGEN Firma');
assert.equal(pickYahooSymbol(bayer), 'BMW.DE', '(zum Vergleich: der Circle-Picker ohne Namensabgleich)');

// Klammerzusatz zählt; ISIN-Symbole sind Zertifikate; Frankfurt schlägt US-OTC.
const porsche = { quotes: [
  hit('AT0000A35WS7.VI', 'RBI OETrackX5 s Porsche AG Vz', 'VIE'),
  hit('DRPRF', 'DR ING H C F PORSCHE AG', 'PNK'),
  hit('P911.F', 'Dr. Ing. h.c. F. Porsche AG   I', 'FRA'),
  hit('P911.HM', 'Dr. Ing. h.c. F. Porsche AG   I', 'HAM'),
] };
assert.equal(pickYahooSymbolForName(porsche, 'Dr. Ing. hc. F. Porsche AG (Porsche AG)'), 'P911.F');
// … aber die Holding ist eine andere Firma als der Sportwagenbauer.
const porscheHolding = { quotes: [hit('PAH3.DE', 'Porsche Automobil Holding SE  I'), ...porsche.quotes] };
assert.equal(pickYahooSymbolForName(porscheHolding, 'Porsche Automobil Holding SE'), 'PAH3.DE');

// Tippfehler des Autors + abgekürzter Yahoo-Name.
const munich = { quotes: [
  hit('MUV2.DE', 'MUENCHENER RUECKVERS.-GES. AG N'),
  hit('MUV2.F', 'MUENCHENER RUECKVERS.-GES. AG N', 'FRA'),
  hit('MURGF', 'Muenchener Rueckver Ges', 'PNK'),
] };
assert.equal(pickYahooSymbolForName(munich, 'Muenchner Rückversicherung'), 'MUV2.DE');

// Fremde Firma mit gleichem Allerweltswort -> lieber nichts.
const telekom = { quotes: [hit('DTE.DE', 'DEUTSCHE TELEKOM AG           N'), hit('DTEGY', 'Deutsche Telekom AG', 'OQX')] };
assert.equal(pickYahooSymbolForName(telekom, 'Deutsche Bank AG'), null, '"Deutsche" allein identifiziert keine Firma');
assert.equal(pickYahooSymbolForName(telekom, 'Deutsche Telekom AG'), 'DTE.DE');
assert.equal(pickYahooSymbolForName({ quotes: [] }, 'Bayer'), null);
assert.equal(pickYahooSymbolForName(null, 'Bayer'), null);

// Kürzel als erstes Wort reicht (Yahoo kürzt den Rest unkenntlich ab).
const acs = { quotes: [hit('OCI1.MU', 'ACS, Act.de Constr.y Serv. SA A', 'MUN')] };
assert.equal(pickYahooSymbolForName(acs, 'ACS Actividades de Construccion y Servicios SA'), 'OCI1.MU');
// Heimatbörse (EUR) schlägt US-OTC, deutsches Listing schlägt Heimatbörse.
const anheuser = { quotes: [hit('BUD', 'Anheuser-Busch Inbev SA', 'NYQ'), hit('ABI.BR', 'ANHEUSER-BUSCH INBEV', 'BRU'), hit('1NBA.DE', 'Anheuser-Busch Inbev SA Sponsor')] };
assert.equal(pickYahooSymbolForName(anheuser, 'Anheuser-Busch Inbev SA'), '1NBA.DE');
assert.equal(pickYahooSymbolForName({ quotes: [hit('BUD', 'Anheuser-Busch Inbev SA', 'NYQ'), hit('ABI.BR', 'ANHEUSER-BUSCH INBEV', 'BRU')] }, 'Anheuser-Busch Inbev SA'), 'ABI.BR');
// Gleiche Symbolbasis = gleiche Firma, auch wenn Yahoo den Namen anders schreibt.
const bmw = { quotes: [hit('BMW.SW', 'BMW AG', 'EBS'), hit('BMW.DE', 'BAYERISCHE MOTOREN WERKE AG   S'), hit('BMWYY', 'Bayerische Motoren Werke AG', 'PNK')] };
assert.equal(pickYahooSymbolForName(bmw, 'BMW AG'), 'BMW.DE', 'XETRA statt Zürich (CHF)');

assert.deepEqual(
  nameSearchQueries('Dr. Ing. hc. F. Porsche AG (Porsche AG)'),
  ['Dr. Ing. hc. F. Porsche AG (Porsche AG)', 'Porsche AG', 'dr ing hc porsche', 'porsche'],
  'Original, Klammerzusatz, bereinigt, letztes langes Wort (erstes Wort "dr" zu kurz)',
);
assert.deepEqual(
  nameSearchQueries('Muenchner Rückversicherung'),
  ['Muenchner Rückversicherung', 'muenchner rueckversicherung', 'muenchner', 'rueckversicherung'],
);
assert.deepEqual(nameSearchQueries('Bayer'), ['Bayer'], 'Groß/klein gleich -> keine Dublette');

console.log('quotes.test.mjs: alle Assertions bestanden ✓');
