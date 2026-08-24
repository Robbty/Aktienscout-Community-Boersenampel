/*
 * events.test.mjs — prüft die Event-Log-Schnittstelle (lib/events.js):
 * Umschlag, Stock-/Ampel-Objekte, Delta -> Ereignisse, JSONL, Ordnung, Reducer.
 *
 *   node test/events.test.mjs
 */
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
for (const lib of ['quotes.js', 'ampel.js', 'circle.js', 'events.js']) {
  runInThisContext(readFileSync(join(here, '..', 'extension', 'lib', lib), 'utf8'));
}
const {
  EVENTS_SCHEMA, EVENT_V, makeEvent, isoDateFromGerman, buildAmpelStockExport,
  buildCircleStockExport, buildAmpelPayload, eventsFromAmpelDelta, eventsFromCircleDelta,
  encodeJsonl, parseJsonl, dayKey, eventPath, sortEvents, dedupeEvents, reduceEvents,
  joinPath, parseModuleTitle, parseTradeBody, diffSnapshots,
} = globalThis;

const producer = { id: 'p1', kind: 'extension', label: 'Peters Laptop', version: '0.7.0' };

// --- Umschlag: Schlüsselmenge ist das Stabilitätsversprechen ---------------------
{
  const e = makeEvent('ampel.stock.added', { stock: { id: 'x' } }, { producer, seq: 7, at: '2026-08-24T10:00:00.000Z', detectedAt: '2026-08-24T10:00:05.000Z' });
  assert.deepEqual(Object.keys(e), ['v', 'id', 'seq', 'at', 'detectedAt', 'producer', 'type', 'payload']);
  assert.equal(e.v, EVENT_V);
  assert.equal(e.id, 'p1:7');
  assert.equal(e.at, '2026-08-24T10:00:00.000Z');
  assert.deepEqual(e.producer, producer);
  assert.equal(EVENTS_SCHEMA, 'boersenampel-events/1');
  // Ohne Fachzeit gilt die Erkennungszeit.
  const e2 = makeEvent('x', null, { producer, seq: 1, detectedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(e2.at, '2026-01-01T00:00:00.000Z');
  assert.equal(e2.payload, null);
}

// --- Datum ----------------------------------------------------------------------
assert.equal(isoDateFromGerman('03.08.2026'), '2026-08-03');
assert.equal(isoDateFromGerman('3.8.26'), '2026-08-03');
assert.equal(isoDateFromGerman('?'), null);
assert.equal(isoDateFromGerman(null), null);

// --- Ampel-Aktie ohne Cache: alles null, verified false ----------------------------
const ampelStock = { id: 'a1', name: 'Ströer SE', section: 'grüne Ampel', color: 'green', updatedAt: '2026-08-20T08:00:00.000Z' };
{
  const s = buildAmpelStockExport(ampelStock, {});
  assert.deepEqual(Object.keys(s), ['scope', 'id', 'name', 'skoolUrl', 'updatedAt', 'ampel', 'identifiers', 'symbol', 'quote', 'trade']);
  assert.equal(s.scope, 'ampel');
  assert.equal(s.skoolUrl, 'https://www.skool.com/cybermoney-1123/classroom/8d4e7683?md=a1');
  assert.deepEqual(s.ampel, { color: 'green', section: 'grüne Ampel' });
  assert.deepEqual(s.identifiers, { isin: null, wkn: null, ticker: null, source: null });
  assert.deepEqual(s.symbol, { yahoo: null, resolved: null, verified: false, resolvedAt: null });
  assert.equal(s.quote, null);
  assert.equal(s.trade, null);
}

// --- Ampel-Aktie mit ampel:<id>-Cache, USD-Kurs + EURUSD=X -> priceEur -------------
{
  const ctx = {
    quoteSymbols: { 'ampel:a1': { symbol: 'SAX.DE', query: 'Ströer SE', resolvedAt: 1756000000000, v: 4 } },
    quotes: {
      'SAX.DE': { price: 110, currency: 'USD', previousClose: 100, at: 1756000000000 },
      'EURUSD=X': { price: 1.1, currency: 'USD', at: 1756000000000 },
    },
  };
  const s = buildAmpelStockExport(ampelStock, ctx);
  assert.equal(s.symbol.yahoo, 'SAX.DE');
  assert.equal(s.symbol.resolved, 'name-search');
  assert.equal(s.symbol.verified, false, 'Namenssuche ist unbestätigt');
  assert.equal(s.quote.priceEur, 100);
  assert.equal(s.quote.currency, 'USD');
  assert.equal(s.quote.previousClose, 100);
  assert.equal(s.quote.at, '2025-08-24T01:46:40.000Z');
}

// --- Circle-Position: ISIN-aufgelöst -> verified, targetPriceEur, ISO-buyDate ------
const circleModule = {
  id: 'c1', title: 'SLB N.V. [46,55 €]', updatedAt: '2026-08-03T09:00:00.000Z',
  titleInfo: parseModuleTitle('SLB N.V. [46,55 €]'),
  trade: parseTradeBody('ISIN: AN8068571086\nWKN: A1EWWW\nTicker: SLB\nKauf am 03.08.2026 zu 48,88 $ (42,32 €) je Aktie\nVerkauf am ?\n12 Stück zum Kaufpreis: 509 € - Verkaufspreis: ?'),
  statistik: null, parseError: null,
};
{
  const pf = globalThis.computePortfolio({ c1: circleModule });
  const ctx = {
    quoteSymbols: { c1: { symbol: 'SLB', query: 'AN8068571086', resolvedAt: 1756000000000, v: 4 } },
    quotes: { SLB: { price: 50, currency: 'USD', at: 1756000000000 }, 'EURUSD=X': { price: 1.25, at: 1756000000000 } },
  };
  const s = buildCircleStockExport(circleModule, pf.positions[0], ctx);
  assert.equal(s.scope, 'circle');
  assert.equal(s.ampel, null);
  assert.equal(s.skoolUrl, 'https://www.skool.com/der-circle-zur-ersten-million-6426/classroom/93493889?md=c1');
  assert.deepEqual(s.identifiers, { isin: 'AN8068571086', wkn: 'A1EWWW', ticker: 'SLB', source: 'circle-body' });
  assert.equal(s.symbol.resolved, 'isin');
  assert.equal(s.symbol.verified, true);
  assert.equal(s.quote.priceEur, 40);
  assert.equal(s.trade.status, 'open');
  assert.equal(s.trade.buyDate, '2026-08-03');
  assert.equal(s.trade.buyPriceEur, 42.32);
  assert.equal(s.trade.qty, 12);
  assert.equal(s.trade.totalBuyEur, 509);
  assert.equal(s.trade.targetPriceEur, 46.66, '559,90 / 12');
  assert.equal(s.trade.targetSource, 'computed');
  assert.equal(s.trade.incomplete, false);
  // WKN-Auflösung ebenfalls verified; Name nicht.
  assert.equal(buildCircleStockExport(circleModule, null, { quoteSymbols: { c1: { symbol: 'X', query: 'A1EWWW' } } }).symbol.resolved, 'wkn');
  assert.equal(buildCircleStockExport(circleModule, null, { quoteSymbols: { c1: { symbol: 'X', query: 'SLB N.V.' } } }).symbol.verified, false);
}

// --- Vollbild: Sortierung, stockCount, Platzhalter raus, Circle drin ---------------
{
  const current = {
    courseTitle: 'Die Aktien-Ampel', courseUpdatedAt: '2026-08-24T00:00:00.000Z', stockCount: 4,
    stocks: {
      r1: { id: 'r1', name: 'Zeta', section: 'rote Ampel', color: 'red', updatedAt: 'u' },
      g2: { id: 'g2', name: 'Beta', section: 'grüne Ampel', color: 'green', updatedAt: 'u' },
      g1: { id: 'g1', name: 'Alpha', section: 'grüne Ampel', color: 'green', updatedAt: 'u' },
      ph: { id: 'ph', name: 'Neue Seite', section: 'grüne Ampel', color: 'green', updatedAt: 'u' },
    },
    sections: {
      s1: { id: 's1', title: 'grüne Ampel', color: 'green', updatedAt: 'u', hasStocks: true },
      s2: { id: 's2', title: 'Neue Seite', color: 'other', updatedAt: 'u', hasStocks: false },
    },
  };
  const p = buildAmpelPayload({ current, circle: { modules: { c1: circleModule } } }, {});
  assert.deepEqual(Object.keys(p), ['courseTitle', 'courseUpdatedAt', 'stockCount', 'sections', 'stocks', 'circle']);
  assert.deepEqual(p.stocks.map((s) => s.id), ['g1', 'g2', 'r1'], 'Farbe -> Name, Platzhalter fehlt');
  assert.equal(p.stockCount, 3);
  assert.deepEqual(p.sections.map((s) => s.id), ['s1']);
  assert.equal(p.circle.positions.length, 1);
  assert.equal(p.circle.positions[0].trade.qty, 12);
  assert.equal(buildAmpelPayload({ current: null, circle: null }, {}).circle, null);
}

// --- Delta -> Ereignisse (moved mit from/to, Reihenfolge, seq) ---------------------
{
  const oldSnap = { stocks: { a: { id: 'a', name: 'A', section: 'gelbe Ampel', color: 'yellow', updatedAt: '2026-08-01T00:00:00.000Z' }, b: { id: 'b', name: 'B', section: 'rote Ampel', color: 'red', updatedAt: 'x' } }, sections: {} };
  const newSnap = { stocks: { a: { id: 'a', name: 'A', section: 'grüne Ampel', color: 'green', updatedAt: '2026-08-10T00:00:00.000Z' }, c: { id: 'c', name: 'C', section: 'rote Ampel', color: 'red', updatedAt: '2026-08-11T00:00:00.000Z' } }, sections: {} };
  const delta = diffSnapshots(oldSnap, newSnap);
  const r = eventsFromAmpelDelta(delta, { producer, seq: 10, detectedAt: '2026-08-12T00:00:00.000Z' });
  assert.deepEqual(r.events.map((e) => e.type), ['ampel.stock.added', 'ampel.stock.moved', 'ampel.stock.removed']);
  assert.deepEqual(r.events.map((e) => e.seq), [10, 11, 12]);
  assert.equal(r.nextSeq, 13);
  const mv = r.events[1];
  assert.equal(mv.at, '2026-08-10T00:00:00.000Z', 'Fachzeit = updatedAt der Aktie');
  assert.deepEqual(mv.payload.from, { color: 'yellow', section: 'gelbe Ampel' });
  assert.deepEqual(mv.payload.to, { color: 'green', section: 'grüne Ampel' });
  assert.equal(r.events[2].at, '2026-08-12T00:00:00.000Z', 'removed hat keine Quellzeit -> Erkennungszeit');
  assert.equal(r.events[2].payload.stock.name, 'B');
  // Platzhalter erzeugen keine Ereignisse.
  const ph = eventsFromAmpelDelta({ added: [{ id: 'p', name: 'Neue Seite', color: 'green' }] }, { producer, seq: 1 });
  assert.equal(ph.events.length, 0);
}

// --- Circle-Delta -----------------------------------------------------------------
{
  const fresh = [
    { id: 'c1', name: 'SLB N.V.', type: 'bought', at: '2026-08-03T09:00:00.000Z', detectedAt: 'd' },
    { id: 'gone', name: 'Alt', type: 'removed', at: null, detectedAt: 'd' },
    { id: 'ph', name: 'Neue Seite', type: 'bought', at: null },
  ];
  const r = eventsFromCircleDelta(fresh, { c1: circleModule }, { producer, seq: 1, detectedAt: '2026-08-04T00:00:00.000Z' });
  assert.deepEqual(r.events.map((e) => e.type), ['circle.bought', 'circle.removed']);
  assert.equal(r.events[0].payload.stock.trade.qty, 12);
  assert.equal(r.events[0].at, '2026-08-03T09:00:00.000Z');
  assert.equal(r.events[1].payload.stock.id, 'gone');
  assert.equal(r.events[1].payload.stock.trade, null);
}

// --- JSONL-Round-Trip, Umlaute, abgeschnittene Zeile -------------------------------
{
  const a = makeEvent('ampel.stock.added', { stock: { id: 'x', name: 'Ströer SE' } }, { producer, seq: 1, at: '2026-08-24T10:00:00.000Z' });
  const b = makeEvent('ampel.stock.edited', { stock: { id: 'y', name: 'Müller' } }, { producer, seq: 2, at: '2026-08-24T11:00:00.000Z' });
  const text = encodeJsonl([a, b]);
  assert.ok(text.endsWith('\n'));
  assert.equal(text.split('\n').length, 3);
  const back = parseJsonl(text);
  assert.deepEqual(back.events, [a, b]);
  assert.equal(back.skipped, 0);
  const cut = parseJsonl(text.slice(0, text.length - 20) + '\n' + 'nicht json\n');
  assert.equal(cut.events.length, 1, 'abgeschnittene Zeile wird übersprungen');
  assert.equal(cut.skipped, 2);
  assert.deepEqual(parseJsonl(''), { events: [], skipped: 0 });
}

// --- Tag/Pfad ----------------------------------------------------------------------
assert.equal(dayKey('2026-08-24T23:59:59.000Z'), '2026-08-24');
assert.equal(dayKey('2026-08-25T00:00:00.000Z'), '2026-08-25');
assert.equal(dayKey('2026-08-24T22:30:00.000+02:00'), '2026-08-24', 'UTC-Tag, nicht Ortszeit');
assert.equal(eventPath('p1', '2026-08-24T10:00:00.000Z'), 'boersenampel/events/p1/2026-08-24.jsonl');
assert.equal(joinPath('https://x.y/remote.php/dav/files/u/', 'boersenampel/events/p 1/a.jsonl'), 'https://x.y/remote.php/dav/files/u/boersenampel/events/p%201/a.jsonl');

// --- Ordnung + Dedup ------------------------------------------------------------------
{
  const p2 = { id: 'p0', kind: 'app' };
  const e1 = makeEvent('t', null, { producer, seq: 2, at: '2026-08-24T10:00:00.000Z' });
  const e2 = makeEvent('t', null, { producer, seq: 1, at: '2026-08-24T10:00:00.000Z' });
  const e3 = makeEvent('t', null, { producer: p2, seq: 9, at: '2026-08-24T10:00:00.000Z' });
  const e4 = makeEvent('t', null, { producer, seq: 3, at: '2026-08-24T09:00:00.000Z' });
  assert.deepEqual(sortEvents([e1, e2, e3, e4]).map((e) => e.id), ['p1:3', 'p0:9', 'p1:1', 'p1:2'], 'at, dann producer, dann seq');
  assert.equal(dedupeEvents([e1, e1, e2]).length, 2);
}

// --- Reducer ------------------------------------------------------------------------
{
  const st = (id, color, updatedAt) => ({ id, name: id.toUpperCase(), ampel: { color, section: color }, updatedAt });
  const snap = makeEvent('ampel.snapshot', {
    courseTitle: 'Ampel', sections: [{ id: 's1', title: 'grüne Ampel' }],
    stocks: [st('a', 'green', '2026-08-01T00:00:00.000Z'), st('b', 'red', '2026-08-01T00:00:00.000Z')],
    circle: { positions: [{ id: 'c1', name: 'SLB', trade: { status: 'open' } }] },
  }, { producer, seq: 5, at: '2026-08-10T00:00:00.000Z' });
  const older = makeEvent('ampel.stock.added', { stock: st('z', 'green', '2026-08-05T00:00:00.000Z') }, { producer, seq: 1, at: '2026-08-05T00:00:00.000Z' });
  const moved = makeEvent('ampel.stock.moved', { stock: st('b', 'green', '2026-08-12T00:00:00.000Z'), from: { color: 'red' }, to: { color: 'green' } }, { producer, seq: 6, at: '2026-08-12T00:00:00.000Z' });
  const removed = makeEvent('ampel.stock.removed', { stock: st('a', 'green', null) }, { producer, seq: 7, at: '2026-08-13T00:00:00.000Z' });
  const sold = makeEvent('circle.sold', { stock: { id: 'c1', name: 'SLB', updatedAt: '2026-08-14T00:00:00.000Z', trade: { status: 'closed' } } }, { producer, seq: 8, at: '2026-08-14T00:00:00.000Z' });
  // Zweiter Producer meldet denselben Wechsel (anderes Ereignis, gleiche Fachzeit).
  const movedDup = makeEvent('ampel.stock.moved', moved.payload, { producer: { id: 'p0' }, seq: 3, at: '2026-08-12T00:00:00.000Z' });
  const unknown = makeEvent('trader.order.placed', { x: 1 }, { producer: { id: 'p9' }, seq: 1, at: '2026-08-15T00:00:00.000Z' });
  const s = reduceEvents([removed, sold, moved, snap, older, moved, movedDup, unknown]);
  assert.equal(s.snapshotAt, '2026-08-10T00:00:00.000Z');
  assert.deepEqual(Object.keys(s.stocks).sort(), ['b'], 'z (älter als Snapshot) ignoriert, a entfernt, b bleibt');
  assert.equal(s.stocks.b.ampel.color, 'green');
  assert.equal(s.circle.c1.trade.status, 'closed');
  assert.deepEqual(s.sections, { s1: { id: 's1', title: 'grüne Ampel' } });
  assert.equal(s.history.length, 4, 'older, moved (Duplikat fachlich gededupt), removed, sold');
  assert.deepEqual(s.unknownTypes, { 'trader.order.placed': 1 });
  // Ohne Snapshot wirken Deltas trotzdem (reiner Delta-Strom).
  const s2 = reduceEvents([moved]);
  assert.equal(s2.stocks.b.ampel.color, 'green');
}

console.log('events.test.mjs: alle Assertions bestanden ✓');
