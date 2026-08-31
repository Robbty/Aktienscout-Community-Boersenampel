/*
 * Tests für lib/portfolio.js — Zeitreihen der Circle-Gesamtübersicht.
 *
 *   node test/portfolio.test.mjs
 */
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
for (const f of ['circle.js', 'portfolio.js']) {
  runInThisContext(readFileSync(join(here, '..', 'extension', 'lib', f), 'utf8'));
}
const { buildPortfolioSeries, positionSpan, lastCloseAt, parseGermanDate } = globalThis;

const D = 86400000;
const day = (s) => parseGermanDate(s);

// --- positionSpan ------------------------------------------------------------------
assert.deepEqual(positionSpan({ buyDate: '03.08.2026', status: 'open' }), { buy: day('03.08.2026'), sell: null, sellEstimated: false });
assert.deepEqual(
  positionSpan({ buyDate: '03.08.2026', status: 'closed', sellDate: '11.08.2026' }),
  { buy: day('03.08.2026'), sell: day('11.08.2026'), sellEstimated: false },
);
assert.deepEqual(
  positionSpan({ buyDate: '03.08.2026', status: 'closed', holdingDays: 8 }),
  { buy: day('03.08.2026'), sell: day('03.08.2026') + 8 * D, sellEstimated: true },
  'ohne Verkaufsdatum: Haltedauer aus dem Titel',
);
assert.equal(positionSpan({ status: 'open' }), null, 'ohne Kaufdatum nicht datierbar');

// --- lastCloseAt --------------------------------------------------------------------
const ser = { timestamps: [100, 200, 300], closes: [1, 2, 3] };
assert.equal(lastCloseAt(ser, 50 * 1000), null);
assert.equal(lastCloseAt(ser, 100 * 1000), 1);
assert.equal(lastCloseAt(ser, 250 * 1000), 2);
assert.equal(lastCloseAt(ser, 999 * 1000), 3);
assert.equal(lastCloseAt(null, 1), null);

// --- buildPortfolioSeries -------------------------------------------------------------
// Drei Positionen: A gekauft Tag 1 (offen, 10 Stück à 50 € = 500 €, Ziel +10 %),
// B gekauft Tag 1, verkauft Tag 4 (400 € -> 440 €, Ertrag 40 €),
// C gekauft Tag 6 (offen, ohne Stück-Zeile: 300 €, Ziel 330 €).
const t1 = day('01.06.2026');
const now = t1 + 9 * D + 12 * 3600000; // Tag 10, mittags
const positions = [
  { id: 'a', status: 'open', buyDate: '01.06.2026', qty: 10, buyPriceEur: 50, totalBuyEur: 500, unrealizedEur: 50 },
  { id: 'b', status: 'closed', buyDate: '01.06.2026', sellDate: '04.06.2026', qty: 4, totalBuyEur: 400, totalSellEur: 440, ertragEur: 40 },
  { id: 'c', status: 'open', buyDate: '06.06.2026', qty: null, totalBuyEur: 300, unrealizedEur: 30 },
];
const prices = {
  // A: 50 € am Kauftag, 55 € ab Tag 5
  a: { timestamps: [t1 / 1000, (t1 + 4 * D) / 1000], closes: [50, 55] },
  // C ohne Kursdaten -> Kaufsumme als Platzhalter, valueKnown=false
};
const r = buildPortfolioSeries(positions, { now, prices, statistik: { zuwachs: 30 } });
assert.equal(r.days.length, 10, 'Tagesraster vom ersten Kauf bis heute');
assert.equal(r.days[0], t1);
const s = r.series;
// Tag 1: A+B gekauft
assert.equal(s.invested[0], 900);
assert.equal(s.deployed[0], 900);
assert.equal(s.realized[0], 0);
assert.equal(s.potential[0], 50 + 40, 'A: echtes Potenzial 50; B (später verkauft): damals Schema +10 % = 40');
assert.equal(s.value[0], 10 * 50 + 400, 'A zum Tageskurs, B ohne Kurs = Kaufsumme');
assert.equal(r.valueKnown[0], false);
// Tag 4: B verkauft
assert.equal(s.deployed[3], 500);
assert.equal(s.realized[3], 40);
assert.equal(s.invested[3], 900, 'kumuliert bleibt');
assert.equal(s.potential[3], 50);
// Tag 6: C dazu
assert.equal(s.invested[5], 1200);
assert.equal(s.deployed[5], 800);
assert.equal(s.potential[5], 80);
assert.equal(s.value[5], 10 * 55 + 300);
// Heute (Tag 10): Kurven enden bei den Summen der Auswertung
assert.equal(s.invested[9], 1200);
assert.equal(s.deployed[9], 800);
assert.equal(s.realized[9], 40);
assert.equal(s.potential[9], 80);
// Kapitalbedarf: Tag 1 900 €, nach Verkauf 460 € gebunden, Tag 6 +300 = 760 < 900 -> Maximum bleibt 900
assert.equal(s.cashNeed[0], 900);
assert.equal(s.cashNeed[3], 900);
assert.equal(s.cashNeed[9], 900);
// Einzahlungs-Annahme: Woche 1 = 1.500, Woche 2 (ab Tag 8) = 3.000
assert.equal(s.deposits[0], 1500);
assert.equal(s.deposits[6], 1500);
assert.equal(s.deposits[7], 3000);
// Kosten: realisiert 40 brutto, Zuwachs 30 -> Quote 25 %
assert.equal(r.costRate, 0.25);
assert.equal(s.costs[9], 10);
assert.equal(s.costs[0], 0);
assert.equal(r.priced, 1);
assert.equal(r.unpriced, 2);
assert.equal(r.estimatedSells, 0);

// Ohne Statistik keine Kostenkurve; ohne datierbare Position null.
assert.equal(buildPortfolioSeries(positions, { now, prices }).series.costs, null);
assert.equal(buildPortfolioSeries([{ id: 'x', status: 'open', totalBuyEur: 100 }], { now }), null);
// Undatierte Position wird am Anfang eingehängt und gezählt.
const r2 = buildPortfolioSeries([...positions, { id: 'x', status: 'open', totalBuyEur: 100, unrealizedEur: 10 }], { now, prices });
assert.equal(r2.undated, 1);
assert.equal(r2.series.invested[0], 1000);
// Einzahlungs-Annahme deckelt bei 10 Wochen.
const r3 = buildPortfolioSeries(positions, { now: t1 + 100 * D, prices });
assert.equal(r3.series.deposits[99], 15000);

console.log('portfolio.test.mjs: alle Assertions bestanden ✓');
