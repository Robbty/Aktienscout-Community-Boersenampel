/*
 * lifecycle.test.mjs — prüft die Änderungserkennung über den vollen Ablauf:
 * Login -> Bestätigen -> Logout (Abruf scheitert) -> Änderungen -> wieder Login.
 *
 * Repliziert die relevanten Background-Speicherregeln (ingest/acknowledge/fail)
 * und die Popup-Sichtbarkeit, damit die Logik ohne Browser testbar ist.
 *
 *   node test/lifecycle.test.mjs
 */
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// Im selben Realm ausführen (ampel.js exportiert auf globalThis) — sonst hätten
// die im vm-Kontext erzeugten Arrays fremde Prototypen und deepStrictEqual scheitert.
runInThisContext(readFileSync(join(here, '..', 'extension', 'lib', 'ampel.js'), 'utf8'));
const { buildSnapshot, diffSnapshots, diffCount } = globalThis;

// Minimaler __NEXT_DATA__-Nachbau in Skool-Form.
function nd(sections) {
  const children = sections.map((s) => ({
    course: { id: 'sec-' + s.title, metadata: { title: s.title }, updatedAt: s.up },
    children: (s.stocks || []).map((t) => ({ course: { id: t.id, metadata: { title: t.name }, updatedAt: t.up } })),
  }));
  return { props: { pageProps: { course: { course: { metadata: { title: 'Ampel' }, updatedAt: 'X' }, children } } } };
}

// --- Replik der Background-Regeln -------------------------------------------
function makeStore() { return { baseline: null, current: null, meta: {} }; }
function ingestSuccess(store, snap, source) {
  const { baseline, current } = store;
  const delta = diffSnapshots(current, snap);
  const firstEver = !baseline;
  if (firstEver) store.baseline = snap;
  else if (baseline && !baseline.sections && snap.sections) store.baseline = { ...baseline, sections: snap.sections };
  store.current = snap;
  store.meta = { lastPollOk: true, lastError: null, source };
  return { delta, notified: !firstEver && diffCount(delta) > 0 };
}
function pollFail(store, err) { store.meta = { ...store.meta, lastPollOk: false, lastError: err }; }
function acknowledge(store) { if (store.current) store.baseline = store.current; }
const popupShowsData = (store) => !!(store.current && store.meta && store.meta.lastPollOk === true);
const popupDiff = (store) => diffSnapshots(store.baseline, store.current);
const names = (a) => a.map((x) => x.name || x.title).sort();

// --- Szenario ---------------------------------------------------------------
const A = buildSnapshot(nd([
  { title: 'Achtung zuerst lesen:', up: 'a1', stocks: [] },
  { title: 'Folgt in Kürze', up: 'f1', stocks: [] },
  { title: 'grüne Ampel', up: 'g1', stocks: [{ id: 'bmw', name: 'BMW', up: 't1' }, { id: 'sap', name: 'SAP', up: 't1' }] },
  { title: 'gelbe Ampel', up: 'y1', stocks: [{ id: 'db', name: 'Deutsche Bank', up: 't1' }] },
  { title: 'rote Ampel', up: 'r1', stocks: [{ id: 'vw', name: 'VW', up: 't1' }] },
]));

const store = makeStore();

// 1) Eingeloggt, erster Abruf -> keine Meldung, Daten sichtbar, kein Diff.
let res = ingestSuccess(store, A, 'fetch');
assert.equal(res.notified, false, 'Erstabruf darf nicht benachrichtigen');
assert.equal(popupShowsData(store), true);
assert.equal(diffCount(popupDiff(store)), 0, 'frisch installiert: keine Änderungen');

// 2) Nutzer bestätigt.
acknowledge(store);

// 3) Ausloggen -> Abruf scheitert -> keine Daten sichtbar, current bleibt erhalten.
pollFail(store, 'Keine Ampel-Daten (eingeloggt?)');
assert.equal(popupShowsData(store), false, 'ausgeloggt: KEINE Ampel-Daten sichtbar');
assert.deepEqual(store.current, A, 'ausgeloggt: current bleibt erhalten (für späteren Diff)');

// 4) Während der Abwesenheit ändert sich die Ampel umfassend.
const B = buildSnapshot(nd([
  { title: 'Achtung zuerst lesen:', up: 'a1', stocks: [] },
  { title: 'Folgt in Kürze', up: 'f2', stocks: [] },                       // Info-Seite bearbeitet
  { title: 'Neuigkeiten', up: 'n1', stocks: [] },                          // neuer Menüpunkt
  { title: 'grüne Ampel', up: 'g2', stocks: [{ id: 'sap', name: 'SAP', up: 't2' }] }, // SAP bearbeitet; BMW raus
  { title: 'gelbe Ampel', up: 'y2', stocks: [
    { id: 'db', name: 'Deutsche Bank', up: 't1' },
    { id: 'bmw', name: 'BMW', up: 't1' },                                  // BMW grün -> gelb
    { id: 'alz', name: 'Allianz', up: 't1' },                             // neu
  ] },
  // rote Ampel entfällt -> VW entfernt + Menüpunkt weg
]));

// 5) Wieder einloggen -> Abruf B.
res = ingestSuccess(store, B, 'fetch');
assert.equal(popupShowsData(store), true, 'eingeloggt: Daten wieder sichtbar');
assert.equal(res.notified, true, 'Änderungen nach Login -> Benachrichtigung');

// 6) Änderungen seit letztem Bestätigen (vor dem Logout) sind vollständig sichtbar.
const d = popupDiff(store);
assert.deepEqual(d.moved.map((x) => x.name + ':' + x.from + '>' + x.to), ['BMW:green>yellow']);
assert.deepEqual(names(d.edited), ['SAP']);
assert.deepEqual(names(d.added), ['Allianz']);
assert.deepEqual(names(d.removed), ['VW']);
assert.deepEqual(names(d.sectionAdded), ['Neuigkeiten']);
assert.deepEqual(names(d.sectionRemoved), ['rote Ampel']);
assert.deepEqual(names(d.sectionEdited), ['Folgt in Kürze']);
assert.equal(diffCount(d), 7, 'alle 7 Änderungen seit letztem Bestätigen sichtbar');

console.log('lifecycle.test.mjs: alle Assertions bestanden ✓');
