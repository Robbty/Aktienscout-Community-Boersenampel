/*
 * circle.test.mjs — prüft die Circle-Logik: Titel-Parser (alle live gesehenen
 * unsauberen Varianten), Body-Parser (offen/geschlossen/Dollar/Statistik),
 * Portfolio-Aggregation und inkrementelle Harvest-Auswahl.
 *
 *   node test/circle.test.mjs
 */
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Im selben Realm ausführen (circle.js exportiert auf globalThis) — sonst hätten
// die im vm-Kontext erzeugten Arrays fremde Prototypen und deepStrictEqual scheitert.
runInThisContext(readFileSync(join(here, '..', 'extension', 'lib', 'circle.js'), 'utf8'));
const {
  CIRCLE_CONFIG, parseGermanNumber, parseGermanDate, parseModuleTitle, proseMirrorText,
  buildCircleIndex, classifyCircleAccess, parseTradeBody, parseStatistik,
  computePortfolio, selectStaleModules, diffCircleModules, circleHiddenTitle,
} = globalThis;

// --- Konfiguration ------------------------------------------------------------
assert.equal(
  CIRCLE_CONFIG.joinUrl,
  'https://www.skool.com/der-circle-zur-ersten-million-6426/about?ref=5a2ff2ee6a214a479e3713e9b2d2bc5f',
  'Affiliate-Link ist fest hinterlegt',
);
assert.equal(CIRCLE_CONFIG.displayName, 'Circle Aktienengagement Echtzeit');

// --- Zahlen im deutschen Format -------------------------------------------------
assert.equal(parseGermanNumber('57,75'), 57.75);
assert.equal(parseGermanNumber('1.234,56'), 1234.56);
assert.equal(parseGermanNumber('509'), 509);
assert.equal(parseGermanNumber(' 944,90 '), 944.9);
assert.equal(parseGermanNumber('3.39'), 3.39, 'Dezimal-PUNKT des Autors ("zu 3.39€")');
assert.equal(parseGermanNumber('1.234'), 1234, 'drei Nachpunktstellen bleiben Tausendertrenner');
assert.equal(parseGermanNumber('785,'), 785, 'abgeschnittene Kommastellen ("785, €")');
assert.equal(parseGermanNumber('kein Betrag'), null);

// --- Deutsches Datum (für die Tage-Spalte der laufenden Positionen) --------------
assert.equal(parseGermanDate('03.08.2026'), new Date(2026, 7, 3).getTime());
assert.equal(parseGermanDate('3.8.26'), new Date(2026, 7, 3).getTime(), 'zweistelliges Jahr -> 20xx');
assert.equal(parseGermanDate(' 15.01.2025 '), new Date(2025, 0, 15).getTime(), 'Leerraum toleriert');
assert.equal(parseGermanDate('31.02.2026'), null, 'Datums-Überlauf ist ungültig');
assert.equal(parseGermanDate('2026-08-03'), null, 'nur deutsche Schreibweise');
assert.equal(parseGermanDate(null), null);

// --- Titel-Parser: alle live gesehenen Varianten ---------------------------------
const openCases = [
  ['LEG Immobilien SE [57,75 € ]', 'LEG Immobilien SE', 57.75],
  ['ASM International NV [ 944,90 €]', 'ASM International NV', 944.9],
  ['Fielmann Group AG [45,65€ ]', 'Fielmann Group AG', 45.65],
  ['Adidas (177,63€ ]', 'Adidas', 177.63], // Klammern gemischt
  ['Deutsche Telekom [29,60 €]', 'Deutsche Telekom', 29.6],
  ['AstraZeneca  [ 150,26 €]', 'AstraZeneca', 150.26], // Doppel-Leerzeichen
  // Doppel-Kurs-Varianten (live 08/2026): es zählt die €-Zahl, egal ob vorn oder hinten.
  ['Carnival Corporation [30,64 Dollar / 26,44 €]', 'Carnival Corporation', 26.44],
  ['Alibaba Group Holding Ltd [118.14 € / 136,67]', 'Alibaba Group Holding Ltd', 118.14],
];
for (const [title, name, price] of openCases) {
  const r = parseModuleTitle(title);
  assert.equal(r.kind, 'open', title + ' -> open');
  assert.equal(r.name, name, title + ' -> Name');
  assert.equal(r.currentPrice, price, title + ' -> Kurs');
}

const closedCases = [
  ['SLB N.V. (Schlumberger) [8 Tage]', 'SLB N.V. (Schlumberger)', 8],
  ['Micron Technology [1 Tag]', 'Micron Technology', 1],
  ['NIBE Industrier AB [10 Tagen]', 'NIBE Industrier AB', 10],
  ['Amadeus IT Group SA [10 Tage)', 'Amadeus IT Group SA', 10], // Klammern gemischt
];
for (const [title, name, days] of closedCases) {
  const r = parseModuleTitle(title);
  assert.equal(r.kind, 'closed', title + ' -> closed');
  assert.equal(r.name, name, title + ' -> Name');
  assert.equal(r.holdingDays, days, title + ' -> Tage');
}

assert.equal(parseModuleTitle('Statistik').kind, 'meta');
assert.equal(parseModuleTitle('Statistik aktuell').kind, 'meta');
assert.equal(parseModuleTitle('Irgendein Modul ohne Klammer').kind, 'plain');

// --- ProseMirror-Body zu Text -----------------------------------------------------
// Nachbau der echten Skool-Struktur inkl. bold-Marks und hardBreak.
function pmBody(lines) {
  const paragraphs = lines.map((l) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: l }],
  }));
  return '[v2]' + JSON.stringify(paragraphs);
}

const withBreaks = '[v2]' + JSON.stringify([{
  type: 'paragraph',
  content: [
    { type: 'text', marks: [{ type: 'bold' }], text: 'WKN:' },
    { type: 'text', text: ' LEG111' },
    { type: 'hardBreak' },
    { type: 'text', marks: [{ type: 'bold' }], text: 'ISIN:' },
    { type: 'text', text: ' DE000LEG1110' },
  ],
}]);
assert.equal(proseMirrorText(withBreaks), 'WKN: LEG111\nISIN: DE000LEG1110', 'hardBreak -> Zeilenumbruch');
assert.equal(proseMirrorText('[v2]{kaputt'), null, 'kaputtes JSON -> null');
assert.equal(proseMirrorText(''), null);

// --- Body-Parser: offene Position (LEG, live gesehen) -----------------------------
const openText = proseMirrorText(pmBody([
  'WKN: LEG111',
  'ISIN: DE000LEG1110',
  'Ticker: LEG',
  'Heimatbörse: Frankfurt, Xetra',
  'Kauf am 10.08.2026 zu 52,50€ je Aktie',
  'erfüllt in ()',
  'Verkauf am ?',
  '8 Stück zum Kaufpreis: 420 € - Verkaufspreis: ?',
]));
const openTrade = parseTradeBody(openText);
assert.equal(openTrade.wkn, 'LEG111');
assert.equal(openTrade.isin, 'DE000LEG1110');
assert.equal(openTrade.ticker, 'LEG');
assert.equal(openTrade.buyDate, '10.08.2026');
assert.equal(openTrade.buyPriceEur, 52.5);
assert.equal(openTrade.qty, 8);
assert.equal(openTrade.totalBuyEur, 420);
assert.equal(openTrade.totalSellEur, undefined, 'Verkaufspreis "?" wird nicht als Zahl gelesen');
assert.equal(openTrade.closed, false, '"Verkauf am ?" -> offen');

// --- Body-Parser: Dollar-Kauf in Schrägstrich-Form (Carnival/Alibaba, live 08/2026) —
// "Kauf am … zu 27,85 $ / 24,03€ je Aktie": der €-Wert nach dem Schrägstrich ist
// der Kaufpreis je Aktie, der Dollar-Wert davor optional.
const slashText = proseMirrorText(pmBody([
  'WKN: A42BYX',
  'ISIN: BMG2004J1036',
  'Ticker: CCL',
  'Heimatbörse: New York Stock Exchange, NYSE',
  'Kauf am 17.08.2026 zu 27,85 $ / 24,03€ je Aktie',
  'erfüllt in ()',
  'Verkauf am ?',
  '22 Stück zum Kaufpreis: 529 € - Verkaufspreis: ?',
]));
const slashTrade = parseTradeBody(slashText);
assert.equal(slashTrade.buyDate, '17.08.2026');
assert.equal(slashTrade.buyPriceEur, 24.03, '€-Wert hinter dem Schrägstrich gewinnt');
assert.equal(slashTrade.qty, 22);
assert.equal(slashTrade.totalBuyEur, 529);
assert.equal(slashTrade.closed, false);

// --- Body-Parser: geschlossene Position mit Dollar-Kauf (SLB, live gesehen) -------
const closedText = proseMirrorText(pmBody([
  'WKN:   A1EWWW',
  'ISIN: AN8068571086',
  'Tickersymbol Ticker: SLB',
  'Heimatbörse: New York Stock Exchange (NYSE)',
  'Kauf am 03.08.2026 zu 48,88 $ (42,32 €) je Aktie',
  'erfüllt in 8 Tagen',
  'Verkauf am 11.08.2026 zu 53,83 Dollar - 46,65 €',
  '12 Stück zum Kaufpreis: 509 € - Verkaufspreis: 560 € = 51 € Ertrag',
]));
const closedTrade = parseTradeBody(closedText);
assert.equal(closedTrade.buyPriceEur, 42.32, 'Dollar-Kauf: €-Betrag aus der Klammer');
assert.equal(closedTrade.sellDate, '11.08.2026');
assert.equal(closedTrade.sellPriceEur, 46.65, 'Verkauf: €-Betrag nach dem Bindestrich');
assert.equal(closedTrade.qty, 12);
assert.equal(closedTrade.totalBuyEur, 509);
assert.equal(closedTrade.totalSellEur, 560);
assert.equal(closedTrade.ertragEur, 51);
assert.equal(closedTrade.closed, true);

// --- Body-Parser: weitere live gesehene Formate ------------------------------------
// Micron [1 Tag]: "verkauft zu … € Gewinn: … €" statt "Verkaufspreis … = … Ertrag".
const micronTrade = parseTradeBody(proseMirrorText(pmBody([
  'Kauf am 30.07.2026',
  'erfüllt in 1 Tag',
  'Verkauf am 30.07.2026',
  '1 Stück zum Kaufpreis: 645 € verkauft zu 712 € Gewinn: 47 €',
])));
assert.equal(micronTrade.qty, 1);
assert.equal(micronTrade.totalBuyEur, 645);
assert.equal(micronTrade.totalSellEur, 712, '"verkauft zu" liefert die Verkaufssumme');
assert.equal(micronTrade.ertragEur, 47, 'explizites "Gewinn:" gewinnt über die Differenz');
assert.equal(micronTrade.closed, true);

// Amadeus: ohne Stück-Zeile, Verkaufspreis ohne €-Zeichen.
const amadeusTrade = parseTradeBody(proseMirrorText(pmBody([
  'WKN: A1CXN0',
  'Kauf am 21.07.2026',
  'erfüllt in 10 Tagen',
  'Verkauf am 31.07.2026',
  'Kaufpreis: 49,28€ - Verkaufspreis: 54,54',
])));
assert.equal(amadeusTrade.qty, undefined);
assert.equal(amadeusTrade.totalBuyEur, 49.28);
assert.equal(amadeusTrade.totalSellEur, 54.54, 'fehlendes €-Zeichen wird toleriert');
assert.equal(amadeusTrade.closed, true);

// NIBE: Dezimalpunkt-Kaufkurs + abgeschnittener Verkaufspreis "785, €".
const nibeTrade = parseTradeBody(proseMirrorText(pmBody([
  'Kauf am 27.07.2026 zu 3.39€ je Aktie',
  'erfüllt in 10 Tagen',
  'Verkauf am 06.08.2026',
  '130 Stück zum Kaufpreis: 440,70€ - Verkaufspreis: 785, €',
])));
assert.equal(nibeTrade.buyPriceEur, 3.39, 'Dezimalpunkt wird nicht als Tausender gelesen');
assert.equal(nibeTrade.qty, 130);
assert.equal(nibeTrade.totalBuyEur, 440.7);
assert.equal(nibeTrade.totalSellEur, 785);

// Verlust-Schreibweise defensiv abgedeckt.
const lossTrade = parseTradeBody('Kauf am 01.02.2026 zu 10 €\n5 Stück zum Kaufpreis: 50 € - Verkaufspreis: 40 € = 10 € Verlust');
assert.equal(lossTrade.ertragEur, -10, '"Verlust" wird negativ gewertet');
assert.equal(lossTrade.closed, true);

// Gar keine Trade-Daten -> null (landet als "nicht auswertbar").
assert.equal(parseTradeBody('Nur ein Begrüßungstext ohne Zahlen.'), null);
assert.equal(parseTradeBody(null), null);

// --- Autor-Statistik ----------------------------------------------------------------
const stat = parseStatistik(proseMirrorText(pmBody([
  'eingesetztes Kapital: 6000 €',
  'Zuwachs: 303 €, nach Abzug von Steuer & Kosten.',
])));
assert.deepEqual(stat, { eingesetztesKapital: 6000, zuwachs: 303 });
assert.equal(parseStatistik('kein Inhalt'), null);

// --- Kursbaum-Index: beide Antwortformen ---------------------------------------------
function treeShape(children) {
  return { course: { metadata: { title: 'Aktienengagement Echtzeit' }, updatedAt: 'c1' }, children };
}
const kids = [
  { course: { id: 'leg1', updatedAt: 'u1', metadata: { title: 'LEG Immobilien SE [57,75 € ]', hasAccess: 1, desc: pmBody(['Kauf am 10.08.2026 zu 52,50€']) } } },
  { course: { id: 'slb1', updatedAt: 'u2', metadata: { title: 'SLB N.V. (Schlumberger) [8 Tage]', hasAccess: 1 } } },
  // Leerer Platzhalter (live 08/2026): darf gar nicht erst in den Index gelangen.
  { course: { id: 'ph1', updatedAt: 'u3', metadata: { title: 'Neue Seite', hasAccess: 1 } } },
];
const fromHtml = buildCircleIndex({ props: { pageProps: { course: treeShape(kids) } } });
const fromDataRoute = buildCircleIndex({ pageProps: { course: treeShape(kids) } });
for (const idx of [fromHtml, fromDataRoute]) {
  assert.equal(idx.courseTitle, 'Aktienengagement Echtzeit');
  assert.deepEqual(Object.keys(idx.modules).sort(), ['leg1', 'slb1'], '"Neue Seite" nicht im Index');
  assert.equal(idx.modules.leg1.updatedAt, 'u1');
  assert.ok(idx.descs.leg1, 'bereits gefüllter Body wird mitgenommen');
  assert.equal(idx.descs.slb1, undefined);
}

// --- Zugangs-Klassifizierung ----------------------------------------------------------
assert.equal(classifyCircleAccess(fromHtml), 'ok');
assert.equal(classifyCircleAccess(null), 'loggedOut', 'kein Kursbaum -> wie ausgeloggt behandeln');
const locked = buildCircleIndex({ props: { pageProps: { course: treeShape([
  { course: { id: 'x', updatedAt: 'u', metadata: { title: 'Gesperrt', hasAccess: 0 } } },
]) } } });
assert.equal(classifyCircleAccess(locked), 'noAccess', 'Baum ohne freigeschaltete Module -> kein Zugang');

// --- Portfolio-Aggregation -------------------------------------------------------------
const modules = {
  leg1: {
    id: 'leg1', title: 'LEG Immobilien SE [57,75 € ]', updatedAt: 'u1',
    titleInfo: parseModuleTitle('LEG Immobilien SE [57,75 € ]'),
    trade: openTrade, statistik: null, parseError: null,
  },
  slb1: {
    id: 'slb1', title: 'SLB N.V. (Schlumberger) [8 Tage]', updatedAt: 'u2',
    titleInfo: parseModuleTitle('SLB N.V. (Schlumberger) [8 Tage]'),
    trade: closedTrade, statistik: null, parseError: null,
  },
  broken: {
    id: 'broken', title: 'Kaputtes Modul [12,34 €]', updatedAt: 'u3',
    titleInfo: parseModuleTitle('Kaputtes Modul [12,34 €]'),
    trade: null, statistik: null, parseError: 'Body nicht lesbar',
  },
  stat1: {
    id: 'stat1', title: 'Statistik aktuell', updatedAt: 'u4',
    titleInfo: parseModuleTitle('Statistik aktuell'),
    trade: null, statistik: stat, parseError: null,
  },
};
const pf = computePortfolio(modules);
assert.equal(pf.investedCumulative, 929, 'kumuliert investiert = 420 + 509');
assert.equal(pf.deployedOpen, 420, 'aktuell gebunden = nur offene Position');
assert.equal(pf.realized, 51, 'realisiert = Ertrag der geschlossenen');
assert.equal(pf.unrealizedTotal, 42, 'unrealisiert = 8 × 57,75 − 420');
assert.equal(pf.positions.length, 2);
const leg = pf.positions.find((p) => p.id === 'leg1');
assert.equal(leg.status, 'open');
assert.equal(leg.unrealizedEur, 42);
assert.equal(leg.unrealizedPct, 10, '42 / 420 = 10 %');
assert.equal(leg.incomplete, false);
const slb = pf.positions.find((p) => p.id === 'slb1');
assert.equal(slb.status, 'closed');
assert.equal(slb.ertragEur, 51);
assert.equal(slb.ertragPct, 10.02, 'realisierter Prozentsatz = 51 / 509');
assert.equal(slb.holdingDays, 8);
assert.equal(pf.unparseable.length, 1, 'Parse-Fehler landet unter "nicht auswertbar"');
assert.equal(pf.unparseable[0].id, 'broken');

// "Neue Seite"-Platzhalter des Autors erscheinen NIRGENDS — auch nicht unter
// "Nicht auswertbar" (Nutzer-Wunsch, live: leere Seite vom 18.08.2026).
assert.equal(circleHiddenTitle('Neue Seite'), true);
assert.equal(circleHiddenTitle(' neue seite '), true, 'tolerant bei Groß-/Kleinschreibung und Leerraum');
assert.equal(circleHiddenTitle('Neue Aktie [50,00 €]'), false);
const pfPh = computePortfolio({
  ...modules,
  ph: {
    id: 'ph', title: 'Neue Seite', updatedAt: 'u9',
    titleInfo: parseModuleTitle('Neue Seite'),
    trade: null, statistik: null, parseError: 'Keine Trade-Daten erkannt',
  },
});
assert.equal(pfPh.unparseable.length, 1, '"Neue Seite" taucht nicht unter "Nicht auswertbar" auf');
assert.equal(pfPh.unparseable[0].id, 'broken');
assert.equal(pfPh.positions.length, 2, '"Neue Seite" wird auch keine Position');
assert.deepEqual(pf.statistik, { eingesetztesKapital: 6000, zuwachs: 303 }, 'Autor-Statistik als Gegenprobe');

// Geschlossene Position ohne explizites "Ertrag" -> Differenz Verkaufs-/Kaufsumme.
const noErtrag = computePortfolio({
  a: {
    id: 'a', title: 'X [3 Tage]', updatedAt: 'u',
    titleInfo: parseModuleTitle('X [3 Tage]'),
    trade: { closed: true, qty: 2, totalBuyEur: 100, totalSellEur: 110 },
    statistik: null, parseError: null,
  },
});
assert.equal(noErtrag.realized, 10, 'Ertrag-Fallback = Verkaufssumme − Kaufsumme');

// Widerspruch Titel offen / Body verkauft -> Body gewinnt, Position markiert.
const conflict = computePortfolio({
  a: {
    id: 'a', title: 'X [10,00 €]', updatedAt: 'u',
    titleInfo: parseModuleTitle('X [10,00 €]'),
    trade: { closed: true, qty: 1, totalBuyEur: 10, ertragEur: 1 },
    statistik: null, parseError: null,
  },
});
assert.equal(conflict.positions[0].status, 'closed', 'Body-Status gewinnt bei Widerspruch');
assert.equal(conflict.positions[0].incomplete, true, 'Widerspruch wird markiert');

// Offene Position OHNE Stück-Angabe (Heidelberg/Accor-Format): Kaufpreis und
// Titel-Kurs sind dieselbe Einheit -> unrealisiert = Kurs − Kaufpreis.
const noQty = computePortfolio({
  a: {
    id: 'a', title: 'Heidelberg Materials [189,00 €]', updatedAt: 'u',
    titleInfo: parseModuleTitle('Heidelberg Materials [189,00 €]'),
    trade: { closed: false, totalBuyEur: 171.85 },
    statistik: null, parseError: null,
  },
});
assert.equal(noQty.positions[0].currentPrice, 189.04, 'ohne Stück: Ziel = Kaufpreis +10 % in derselben Einheit');
assert.equal(noQty.positions[0].unrealizedEur, 17.19);
assert.equal(noQty.positions[0].unrealizedPct, 10);
assert.equal(noQty.positions[0].incomplete, false);
assert.equal(noQty.unrealizedTotal, 17.19);

// Währung in allen Schreibweisen: €, Euro, euro, EUR — auch neben Dollar/USD.
{
  const v1 = parseTradeBody('Kauf am 17.08.2026 zu 124,25 $ / 107,40 Euro je Aktie\n5 Stück zum Kaufpreis: 537 Euro - Verkaufspreis: ?');
  assert.equal(v1.buyPriceEur, 107.4, 'Schrägstrich-Form mit "Euro"');
  assert.equal(v1.totalBuyEur, 537);
  const v2 = parseTradeBody('Kauf am 17.08.2026 zu 124,25 USD (107,40 EUR) je Aktie\n5 Stück zum Kaufpreis: 537 EUR - Verkaufspreis: 590 EUR = 53 EUR Ertrag');
  assert.equal(v2.buyPriceEur, 107.4, 'Klammer-Form mit "EUR"');
  assert.equal(v2.totalSellEur, 590);
  assert.equal(v2.ertragEur, 53);
  const v3 = parseTradeBody('Kauf am 24.08.2026 zu 116,20 euro je Aktie\nVerkauf am 30.08.2026\n5 Stück zum Kaufpreis: 581 euro verkauft zu 640 euro Gewinn: 59 euro');
  assert.equal(v3.buyPriceEur, 116.2, '"euro" klein');
  assert.equal(v3.totalSellEur, 640);
  assert.equal(v3.ertragEur, 59);
  const v4 = parseTradeBody('Kauf am 24.08.2026 zu 83,92 Dollar je Aktie\n7 Stück zum Kaufpreis: 575 € - Verkaufspreis: ?');
  assert.equal(v4.buyPriceEur, undefined, 'reiner Dollar-Kurs wird NICHT als Euro gelesen');
  assert.deepEqual(parseModuleTitle('KRONES AG [127,82 Euro]'), { name: 'KRONES AG', kind: 'open', currentPrice: 127.82 });
  assert.deepEqual(parseModuleTitle('Wells Fargo [92,32 USD / 79,11 EUR]'), { name: 'Wells Fargo', kind: 'open', currentPrice: 79.11 });
}

// Kursziel kommt aus der Stück-Zeile, nicht aus dem Titel (Wells Fargo 08/2026:
// Titel 79,11 €, aber "7 Stück zum Kaufpreis: 575 € - Verkaufspreis: ?").
const wfc = computePortfolio({
  a: {
    id: 'a', title: 'Wells Fargo & Company  [92,32 Dollar / 79,11 €]', updatedAt: 'u',
    titleInfo: parseModuleTitle('Wells Fargo & Company  [92,32 Dollar / 79,11 €]'),
    trade: parseTradeBody('Kauf am 24.08.2026 zu  83,92 Dollar / 71,91 € je Aktie\nVerkauf am ?\n7 Stück zum Kaufpreis: 575 € - Verkaufspreis: ? '),
    statistik: null, parseError: null,
  },
});
assert.equal(wfc.positions[0].targetSource, 'computed');
assert.equal(wfc.positions[0].targetTotalEur, 632.5, '575 +10 %');
assert.equal(wfc.positions[0].currentPrice, 90.36, '632,50 / 7 je Aktie');
assert.equal(wfc.positions[0].titlePrice, 79.11, 'Titel-Kurs bleibt erhalten');
assert.equal(wfc.positions[0].unrealizedEur, 57.5);
assert.equal(wfc.positions[0].unrealizedPct, 10);
assert.equal(wfc.positions[0].targetOff, false);

// Konkreter Verkaufspreis im Body: übernehmen; nahe am 10-%-Ziel -> ok,
// stark abweichend -> targetOff (Popup zeigt ihn rot).
function openWithSell(sell) {
  return computePortfolio({
    a: {
      id: 'a', title: 'X [12,00 €]', updatedAt: 'u', titleInfo: parseModuleTitle('X [12,00 €]'),
      trade: { closed: false, qty: 10, totalBuyEur: 100, totalSellEur: sell },
      statistik: null, parseError: null,
    },
  }).positions[0];
}
const near = openWithSell(112);
assert.equal(near.targetSource, 'author');
assert.equal(near.currentPrice, 11.2);
assert.equal(near.unrealizedPct, 12);
assert.equal(near.targetOff, false, '+12 % liegt in der 3-%-Toleranz');
const far = openWithSell(130);
assert.equal(far.currentPrice, 13, 'stark abweichender Verkaufspreis wird trotzdem übernommen');
assert.equal(far.targetOff, true, '+30 % ist kein 10-%-Ziel');

// Offene Position ohne Titel-Kurs: Ziel wird trotzdem aus dem Kaufpreis gerechnet.
const noPrice = computePortfolio({
  a: {
    id: 'a', title: 'X', updatedAt: 'u',
    titleInfo: parseModuleTitle('X'),
    trade: { closed: false, qty: 2, totalBuyEur: 100 },
    statistik: null, parseError: null,
  },
});
assert.equal(noPrice.positions[0].incomplete, false);
assert.equal(noPrice.positions[0].currentPrice, 55, '110 / 2 je Aktie');
assert.equal(noPrice.unrealizedTotal, 10, 'Kaufpreis +10 %');
assert.equal(noPrice.deployedOpen, 100, 'Kaufsumme zählt trotzdem als gebunden');

// --- Kauf-/Verkaufs-Ereignisse zwischen zwei Ständen ----------------------------------------
function circMod(id, title, extra) {
  return Object.assign(
    { id, title, updatedAt: 'u-' + id, titleInfo: parseModuleTitle(title), trade: null, statistik: null, parseError: null },
    extra,
  );
}
const before = {
  leg: circMod('leg', 'LEG Immobilien SE [57,75 € ]', { trade: { closed: false, qty: 8, totalBuyEur: 420 } }),
  slb: circMod('slb', 'SLB N.V. [48,88 €]', { trade: { closed: false, qty: 12, totalBuyEur: 509 } }),
  alt: circMod('alt', 'Alte Aktie [10,00 €]', { trade: { closed: false, totalBuyEur: 100 } }),
  stat: circMod('stat', 'Statistik aktuell'),
};
const after = {
  leg: { ...before.leg, updatedAt: 'u-leg2' }, // nur Kurs im Titel gepflegt -> KEIN Ereignis
  slb: circMod('slb', 'SLB N.V. [8 Tage]', { trade: { closed: true, qty: 12, totalBuyEur: 509, ertragEur: 51 } }),
  neu: circMod('neu', 'Neue Aktie [99,00 €]', { trade: { closed: false, qty: 5, totalBuyEur: 495 } }),
  stat: { ...before.stat, updatedAt: 'u-stat2' }, // Statistik-Modul -> nie ein Ereignis
  // 'alt' fehlt -> entfernt
};
const events = diffCircleModules(before, after);
const byType = (t) => events.filter((e) => e.type === t);
assert.equal(events.length, 3, 'genau Kauf + Verkauf + Entfernt, kein Kurs-Rauschen');
assert.equal(byType('sold').length, 1);
assert.equal(byType('sold')[0].name, 'SLB N.V.');
assert.equal(byType('sold')[0].ertragEur, 51, 'Verkauf trägt den Ertrag');
assert.equal(byType('sold')[0].holdingDays, 8, 'Verkauf trägt die Haltedauer');
assert.equal(byType('bought').length, 1);
assert.equal(byType('bought')[0].name, 'Neue Aktie');
assert.equal(byType('bought')[0].totalBuyEur, 495, 'Kauf trägt die Kaufsumme');
assert.equal(byType('removed').length, 1);
assert.equal(byType('removed')[0].name, 'Alte Aktie');

// Neues Modul, das schon verkauft ist (Kauf+Verkauf zwischen zwei Abrufen) -> als Verkauf melden.
const flash = diffCircleModules(before, {
  ...before,
  blitz: circMod('blitz', 'Blitz-Trade [2 Tage]', { trade: { closed: true, totalBuyEur: 300, ertragEur: 30 } }),
});
assert.equal(flash.length, 1);
assert.equal(flash[0].type, 'sold', 'bereits geschlossen aufgetaucht -> Verkauf');

// Identische Stände -> keine Ereignisse.
assert.deepEqual(diffCircleModules(before, before), [], 'nichts geändert -> nichts gemeldet');

// Platzhalter-Seiten ("Neue Seite"): ohne Titel-Preis/Tage und ohne Trade-Daten
// kein Ereignis — weder Kauf beim Auftauchen noch Entfernt beim Löschen.
const withPlaceholder = { ...before, ph: circMod('ph', 'Neue Seite') };
assert.deepEqual(diffCircleModules(before, withPlaceholder), [], 'Platzhalter taucht auf -> kein Kauf');
assert.deepEqual(diffCircleModules(withPlaceholder, before), [], 'Platzhalter gelöscht -> kein Entfernt');

// Platzhalter wird zur echten Position -> DAS ist der Kauf.
const phOpen = diffCircleModules(withPlaceholder, {
  ...before,
  ph: circMod('ph', 'Neue Aktie [50,00 €]', { trade: { closed: false, qty: 3, totalBuyEur: 135 } }),
});
assert.equal(phOpen.length, 1);
assert.equal(phOpen[0].type, 'bought', 'Platzhalter -> offene Position = Kauf');
assert.equal(phOpen[0].totalBuyEur, 135, 'Kauf trägt die Kaufsumme');

// Platzhalter, der direkt als geschlossen gepflegt wird -> Verkauf (Endereignis).
const phClosed = diffCircleModules(withPlaceholder, {
  ...before,
  ph: circMod('ph', 'Neue Aktie [3 Tage]', { trade: { closed: true, totalBuyEur: 135, ertragEur: 12 } }),
});
assert.equal(phClosed.length, 1);
assert.equal(phClosed[0].type, 'sold', 'Platzhalter -> geschlossen = Verkauf');

// Position ohne Titel-Preis, aber mit geparsten Trade-Daten, ist KEIN Platzhalter.
const bodyOnly = diffCircleModules(before, {
  ...before,
  bo: circMod('bo', 'Accor', { trade: { closed: false, totalBuyEur: 40 } }),
});
assert.equal(bodyOnly.length, 1);
assert.equal(bodyOnly[0].type, 'bought', 'Trade-Daten ohne Titel-Preis -> trotzdem Kauf');

// --- Inkrementelle Harvest-Auswahl --------------------------------------------------------
const idx = buildCircleIndex({ props: { pageProps: { course: treeShape([
  { course: { id: 'a', updatedAt: 'u1', metadata: { title: 'A', hasAccess: 1 } } },
  { course: { id: 'b', updatedAt: 'u2', metadata: { title: 'B', hasAccess: 1 } } },
  { course: { id: 'c', updatedAt: 'u3', metadata: { title: 'C', hasAccess: 1 } } },
]) } } });
assert.deepEqual(selectStaleModules(idx, {}), ['a', 'b', 'c'], 'Erst-Harvest: alle Module');
assert.deepEqual(
  selectStaleModules(idx, {
    a: { bodyUpdatedAt: 'u1' },
    b: { bodyUpdatedAt: 'ALT' }, // Modul wurde in Skool bearbeitet
    c: { bodyUpdatedAt: 'u3' },
  }),
  ['b'],
  'nur das geänderte Modul wird neu geholt',
);
assert.deepEqual(
  selectStaleModules(idx, { a: { bodyUpdatedAt: 'u1' }, b: { bodyUpdatedAt: 'u2' }, c: { bodyUpdatedAt: 'u3' } }),
  [],
  'alles aktuell -> keine Abrufe',
);

console.log('circle.test.mjs: alle Assertions bestanden ✓');
