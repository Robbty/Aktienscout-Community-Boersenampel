/*
 * replay.mjs — Referenz-Leser für das Event-Log (EVENTS.md). Liest alle
 * events/<producer>/<tag>.jsonl unter <ordner>/boersenampel, dedupliziert,
 * sortiert, reduziert und druckt Ampel-Stand, Circle-Positionen und Historie.
 * Zugleich die Vorlage für die Leseseite der Trading-App.
 *
 *   node test/tools/replay.mjs <Sync-Ordner>            (Text)
 *   node test/tools/replay.mjs <Sync-Ordner> --json     (Zustand als JSON)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
for (const lib of ['quotes.js', 'ampel.js', 'circle.js', 'events.js']) {
  runInThisContext(readFileSync(join(here, '..', '..', 'extension', 'lib', lib), 'utf8'));
}
const { parseJsonl, reduceEvents, EVENTS_ROOT } = globalThis;

const arg = process.argv[2];
const asJson = process.argv.includes('--json');
if (!arg) {
  console.error('Aufruf: node test/tools/replay.mjs <Sync-Ordner> [--json]');
  process.exit(2);
}
const root = existsSync(join(arg, EVENTS_ROOT)) ? join(arg, EVENTS_ROOT) : arg;
const eventsDir = join(root, 'events');
if (!existsSync(eventsDir)) {
  console.error('Kein events/-Ordner unter ' + root);
  process.exit(1);
}

const all = [];
let skipped = 0;
const files = [];
for (const producer of readdirSync(eventsDir)) {
  const pd = join(eventsDir, producer);
  if (!statSync(pd).isDirectory()) continue;
  for (const f of readdirSync(pd)) {
    if (!f.endsWith('.jsonl')) continue;
    const r = parseJsonl(readFileSync(join(pd, f), 'utf8'));
    all.push(...r.events);
    skipped += r.skipped;
    files.push(producer + '/' + f + ' (' + r.events.length + ')');
  }
}

const state = reduceEvents(all);

if (asJson) {
  console.log(JSON.stringify(state, null, 2));
  process.exit(0);
}

console.log('Dateien: ' + files.length + (skipped ? ' · übersprungene Zeilen: ' + skipped : ''));
for (const f of files) console.log('  ' + f);
console.log('\nEreignisse gesamt: ' + all.length + ' · Vollbild: ' + (state.snapshotAt || '–') + (state.snapshotBy ? ' von ' + state.snapshotBy : ''));

const byColor = {};
for (const s of Object.values(state.stocks)) {
  const c = (s.ampel && s.ampel.color) || 'other';
  (byColor[c] = byColor[c] || []).push(s);
}
console.log('\nAmpel (' + Object.keys(state.stocks).length + ' Aktien)' + (state.courseTitle ? ' – ' + state.courseTitle : ''));
for (const c of ['green', 'yellow', 'red', 'other']) {
  const list = (byColor[c] || []).sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
  if (!list.length) continue;
  console.log('  ' + c + ' (' + list.length + ')');
  for (const s of list) {
    const sym = s.symbol && s.symbol.yahoo ? ' [' + s.symbol.yahoo + (s.symbol.verified ? '' : '?') + ']' : '';
    const q = s.quote && s.quote.priceEur != null ? ' ' + s.quote.priceEur + ' €' : '';
    console.log('    ' + s.name + sym + q);
  }
}

const circle = Object.values(state.circle);
if (circle.length) {
  console.log('\nCircle (' + circle.length + ' Positionen)');
  for (const s of circle) {
    const t = s.trade || {};
    console.log('    ' + (t.status || '?').padEnd(6) + ' ' + s.name + (t.qty != null ? ' · ' + t.qty + ' Stk' : '') +
      (t.totalBuyEur != null ? ' · ' + t.totalBuyEur + ' €' : '') + (t.targetPriceEur != null ? ' · Ziel ' + t.targetPriceEur + ' €' : ''));
  }
}

console.log('\nHistorie (' + state.history.length + ' Deltas, fachlich dedupliziert)');
for (const e of state.history.slice(-25)) {
  const p = e.payload || {};
  const name = (p.stock && p.stock.name) || (p.section && p.section.title) || '';
  const extra = e.type === 'ampel.stock.moved' && p.from && p.to ? ' ' + p.from.color + ' → ' + p.to.color : '';
  console.log('  ' + e.at + '  ' + e.type.padEnd(22) + ' ' + name + extra);
}
if (Object.keys(state.unknownTypes).length) console.log('\nUnbekannte Typen: ' + JSON.stringify(state.unknownTypes));
