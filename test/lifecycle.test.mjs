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
const { AMPEL_CONFIG, buildSnapshot, diffSnapshots, diffCount, pruneHistory, classifyAmpelAccess } = globalThis;

// Minimaler __NEXT_DATA__-Nachbau in Skool-Form.
function nd(sections) {
  const children = sections.map((s) => ({
    course: { id: 'sec-' + s.title, metadata: { title: s.title }, updatedAt: s.up },
    children: (s.stocks || []).map((t) => ({ course: { id: t.id, metadata: { title: t.name }, updatedAt: t.up } })),
  }));
  return { props: { pageProps: { course: { course: { metadata: { title: 'Ampel' }, updatedAt: 'X' }, children } } } };
}

// --- Replik der Background-Regeln -------------------------------------------
function makeStore() { return { baseline: null, current: null, meta: {}, history: [] }; }
function appendHistory(store, delta) {                 // entspricht appendHistory()
  const detectedAt = 'now';
  const ev = [];
  for (const s of delta.moved) ev.push({ type: 'moved', name: s.name, at: s.updatedAt || detectedAt });
  for (const s of delta.added) ev.push({ type: 'added', name: s.name, at: s.updatedAt || detectedAt });
  for (const s of delta.removed) ev.push({ type: 'removed', name: s.name, at: detectedAt });
  for (const s of delta.sectionAdded) ev.push({ type: 'sectionAdded', name: s.title, at: s.updatedAt || detectedAt });
  for (const s of delta.sectionRemoved) ev.push({ type: 'sectionRemoved', name: s.title, at: detectedAt });
  store.history = store.history.concat(ev);            // edited/sectionEdited bewusst NICHT
}
function ingestSuccess(store, snap, source) {
  const { baseline, current } = store;
  const delta = diffSnapshots(current, snap);
  const firstEver = !baseline;
  if (firstEver) store.baseline = snap;
  else if (baseline && !baseline.sections && snap.sections) store.baseline = { ...baseline, sections: snap.sections };
  store.current = snap;
  const watchingSince = store.meta.watchingSince || 'start'; // einmalig festhalten
  store.meta = { lastPollOk: true, lastError: null, source, watchingSince };
  if (!firstEver && diffCount(delta) > 0) appendHistory(store, delta);
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

assert.equal(store.meta.watchingSince, 'start', 'Überwachungsbeginn beim Erstabruf gesetzt');

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

// --- Logbuch (History) ------------------------------------------------------
// Erstabruf A darf nichts loggen (keine echten Änderungen, nur Erstbefüllung).
// Nach A->B sind genau die 5 Strukturänderungen drin, KEINE Bearbeitungen.
assert.equal(store.history.length, 5, 'Logbuch: nur die 5 Strukturänderungen');
const byType = (t) => store.history.filter((e) => e.type === t).map((e) => e.name);
assert.deepEqual(byType('moved'), ['BMW']);
assert.deepEqual(byType('added'), ['Allianz']);
assert.deepEqual(byType('removed'), ['VW']);
assert.deepEqual(byType('sectionAdded'), ['Neuigkeiten']);
assert.deepEqual(byType('sectionRemoved'), ['rote Ampel']);
assert.equal(store.history.some((e) => e.name === 'SAP'), false, 'Bearbeitung SAP NICHT im Logbuch');
assert.equal(store.history.some((e) => e.name === 'Folgt in Kürze'), false, 'sectionEdited NICHT im Logbuch');
// Datum stammt aus Skools updatedAt, wo vorhanden (z. B. BMW-Wechsel).
assert.equal(store.history.find((e) => e.name === 'BMW').at, 't1', 'Wechsel-Datum = updatedAt der Aktie');

// Erneuter identischer Abruf B -> keine neuen Logbuch-Einträge (keine Doppelung).
ingestSuccess(store, B, 'fetch');
assert.equal(store.history.length, 5, 'identischer Abruf fügt nichts hinzu');
assert.equal(store.meta.watchingSince, 'start', 'Überwachungsbeginn bleibt stabil');

// --- Logbuch-Begrenzung: älteste ÄNDERUNG (nach Datum) zuerst löschen --------
// Bewusst NICHT nach Einfügereihenfolge: der zuletzt eingefügte Eintrag hat hier
// das älteste Datum und muss trotzdem als erster wegfallen.
const raw = [
  { name: 'neu',    at: '2026-06-10T00:00:00Z' },
  { name: 'mittel', at: '2026-06-05T00:00:00Z' },
  { name: 'alt',    at: '2026-06-01T00:00:00Z' }, // ältestes Datum, zuletzt eingefügt
];
const kept = pruneHistory(raw, 2);
assert.equal(kept.length, 2, 'auf max=2 begrenzt');
assert.equal(kept.some((e) => e.name === 'alt'), false, 'ältestes Datum ("alt") wurde verworfen');
assert.deepEqual(kept.map((e) => e.name).sort(), ['mittel', 'neu'], 'die zwei jüngsten bleiben');
assert.equal(pruneHistory(raw, 5), raw, 'unter dem Limit unverändert');

// --- Zugangs-Klassifizierung + fester VIP-Link -------------------------------
assert.equal(
  AMPEL_CONFIG.joinUrl,
  'https://www.skool.com/cybermoney-1123/about?ref=5a2ff2ee6a214a479e3713e9b2d2bc5f',
  'VIP-Affiliate-Link ist fest hinterlegt',
);

function accessNd(children) {
  return { props: { pageProps: { course: { course: { metadata: { title: 'Ampel' }, updatedAt: 'X' }, children } } } };
}
assert.equal(classifyAmpelAccess(null), 'loggedOut', 'kein Kursbaum -> wie ausgeloggt');
assert.equal(classifyAmpelAccess({ props: { pageProps: {} } }), 'loggedOut');
assert.equal(
  classifyAmpelAccess(accessNd([
    { course: { id: 's1', metadata: { title: 'grüne Ampel', hasAccess: 0 } }, children: [] },
  ])),
  'noAccess',
  'eingeloggt ohne Mitgliedschaft -> noAccess (VIP-Hinweis)',
);
assert.equal(
  classifyAmpelAccess(accessNd([
    { course: { id: 's1', metadata: { title: 'grüne Ampel', hasAccess: 1 } }, children: [] },
  ])),
  'ok',
);

console.log('lifecycle.test.mjs: alle Assertions bestanden ✓');
