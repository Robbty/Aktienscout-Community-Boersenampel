/*
 * sync-flush.test.mjs — End-to-End ohne Browser: Outbox -> WebDAV-Adapter ->
 * lokaler Mini-WebDAV-Server (node:http, schreibt in ein Temp-Verzeichnis) ->
 * Rücklesen mit dem Referenz-Reducer. Prüft Tagesdateien, Producer-Datei,
 * format.json, Outbox-Leerung, Retry nach Fehler und Dedup bei Wiederholung.
 *
 *   node test/sync-flush.test.mjs
 */
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { runInThisContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
for (const lib of ['quotes.js', 'ampel.js', 'circle.js', 'events.js', 'sync-webdav.js', 'sync-flush.js']) {
  runInThisContext(readFileSync(join(here, '..', 'extension', 'lib', lib), 'utf8'));
}
const { createWebdavAdapter, flushOutboxWith, makeEvent, parseJsonl, reduceEvents, eventPath } = globalThis;

// --- Mini-WebDAV: MKCOL/PUT/GET/PROPFIND auf einem Temp-Ordner, Basic-Auth ----
const rootDir = mkdtempSync(join(tmpdir(), 'ba-dav-'));
let failNextPut = false;
const server = createServer((req, res) => {
  if (req.headers.authorization !== 'Basic ' + Buffer.from('peter:geheim').toString('base64')) {
    res.writeHead(401); res.end(); return;
  }
  const rel = decodeURIComponent(req.url.replace(/^\/dav\/?/, '')).replace(/\/+$/, '');
  const full = join(rootDir, rel);
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.method === 'MKCOL') {
      if (existsSync(full)) { res.writeHead(405); res.end(); return; }
      if (!existsSync(dirname(full))) { res.writeHead(409); res.end(); return; }
      mkdirSync(full); res.writeHead(201); res.end(); return;
    }
    if (req.method === 'PUT') {
      if (failNextPut) { failNextPut = false; res.writeHead(500); res.end(); return; }
      if (!existsSync(dirname(full))) { res.writeHead(409); res.end(); return; }
      writeFileSync(full, body); res.writeHead(201); res.end(); return;
    }
    if (req.method === 'GET') {
      if (!existsSync(full)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200); res.end(readFileSync(full)); return;
    }
    if (req.method === 'PROPFIND') {
      if (!existsSync(full)) { res.writeHead(404); res.end(); return; }
      const hrefs = ['/dav/' + rel + '/'].concat(readdirSync(full).map((n) => '/dav/' + rel + '/' + n));
      res.writeHead(207, { 'Content-Type': 'application/xml' });
      res.end('<d:multistatus xmlns:d="DAV:">' + hrefs.map((h) => '<d:response><d:href>' + h + '</d:href></d:response>').join('') + '</d:multistatus>');
      return;
    }
    res.writeHead(405); res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port + '/dav/';

// Fake storage.local wie im Browser (get liefert nur angefragte Schlüssel).
function fakeStorage() {
  const data = {};
  return {
    data,
    async get(keys) { const o = {}; for (const k of keys) if (k in data) o[k] = structuredClone(data[k]); return o; },
    async set(obj) { Object.assign(data, structuredClone(obj)); },
  };
}

const producer = { id: 'p-laptop', kind: 'extension', label: 'Laptop', version: '0.7.0' };
const adapter = createWebdavAdapter({ baseUrl: base, user: 'peter', password: 'geheim' });

// --- Selbsttest gegen den echten Server --------------------------------------
{
  const r = await adapter.selfTest();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(existsSync(join(rootDir, 'boersenampel', 'format.json')), true);
  const bad = createWebdavAdapter({ baseUrl: base, user: 'peter', password: 'falsch' });
  const r2 = await bad.selfTest();
  assert.equal(r2.ok, false);
  assert.match(r2.error, /Anmeldung/);
}

// --- Flush: zwei Tage, Producer-Datei, Outbox leer ----------------------------
const storage = fakeStorage();
const stock = (id, color) => ({ id, name: id, ampel: { color, section: color }, updatedAt: '2026-08-24T10:00:00.000Z' });
const e1 = makeEvent('ampel.snapshot', { stocks: [stock('a', 'green'), stock('b', 'red')], sections: [], circle: null }, { producer, seq: 1, at: '2026-08-23T22:00:00.000Z' });
const e2 = makeEvent('ampel.stock.moved', { stock: stock('b', 'green'), from: { color: 'red' }, to: { color: 'green' } }, { producer, seq: 2, at: '2026-08-24T08:00:00.000Z' });
storage.data.syncOutbox = [e1, e2];
storage.data.syncMeta = { seq: 2, formatWritten: true };
{
  const r = await flushOutboxWith(adapter, storage, producer);
  assert.deepEqual(r, { ok: true, flushed: 2 });
  assert.deepEqual(storage.data.syncOutbox, []);
  assert.equal(storage.data.syncMeta.lastError, null);
  assert.ok(storage.data.syncMeta.lastFlushAt > 0);
  const d23 = join(rootDir, eventPath('p-laptop', '2026-08-23T22:00:00.000Z'));
  const d24 = join(rootDir, eventPath('p-laptop', '2026-08-24T08:00:00.000Z'));
  assert.equal(existsSync(d23), true, 'Tagesdatei 23.');
  assert.equal(existsSync(d24), true, 'Tagesdatei 24.');
  assert.equal(parseJsonl(readFileSync(d23, 'utf8')).events.length, 1);
  const prod = JSON.parse(readFileSync(join(rootDir, 'boersenampel', 'producers', 'p-laptop.json'), 'utf8'));
  assert.equal(prod.label, 'Laptop');
  assert.equal(prod.seq, 2);
  assert.deepEqual(Object.keys(storage.data.syncDays).sort(), ['2026-08-23', '2026-08-24']);
}

// --- Fehler: Outbox bleibt, lastError gesetzt; nächster Flush heilt ------------
const e3 = makeEvent('ampel.stock.removed', { stock: stock('a', 'green') }, { producer, seq: 3, at: '2026-08-24T09:00:00.000Z' });
storage.data.syncOutbox = [e3];
storage.data.syncMeta.seq = 3;
{
  failNextPut = true;
  const r = await flushOutboxWith(adapter, storage, producer);
  assert.equal(r.ok, false);
  assert.equal(storage.data.syncOutbox.length, 1, 'bleibt in der Outbox');
  assert.match(storage.data.syncMeta.lastError, /HTTP 500/);
  const r2 = await flushOutboxWith(adapter, storage, producer);
  assert.equal(r2.ok, true);
  assert.equal(storage.data.syncOutbox.length, 0);
  assert.equal(storage.data.syncMeta.lastError, null);
  // Tagesdatei des 24. enthält jetzt BEIDE Ereignisse (komplett neu geschrieben).
  const d24 = readFileSync(join(rootDir, eventPath('p-laptop', '2026-08-24T09:00:00.000Z')), 'utf8');
  assert.deepEqual(parseJsonl(d24).events.map((e) => e.seq), [2, 3]);
}

// --- Zweiter Producer + Rücklesen über den Reducer --------------------------------
{
  const p2 = { id: 'p-handy', kind: 'app', label: 'Handy', version: '0.7.0' };
  const st2 = fakeStorage();
  // Meldet denselben Wechsel (gleiche Fachzeit) — darf in der Historie nicht doppelt sein.
  st2.data.syncOutbox = [makeEvent('ampel.stock.moved', e2.payload, { producer: p2, seq: 1, at: e2.at })];
  st2.data.syncMeta = { seq: 1, formatWritten: true };
  assert.equal((await flushOutboxWith(adapter, st2, p2)).ok, true);

  const all = [];
  const ev = join(rootDir, 'boersenampel', 'events');
  for (const p of readdirSync(ev)) for (const f of readdirSync(join(ev, p))) all.push(...parseJsonl(readFileSync(join(ev, p, f), 'utf8')).events);
  assert.equal(all.length, 4);
  const state = reduceEvents(all);
  assert.deepEqual(Object.keys(state.stocks), ['b'], 'a entfernt, b bleibt');
  assert.equal(state.stocks.b.ampel.color, 'green');
  assert.equal(state.history.length, 2, 'moved (einmal, trotz zwei Producern) + removed');
  const names = (await adapter.list('boersenampel/events')).names.sort();
  assert.deepEqual(names, ['p-handy', 'p-laptop']);
}

// --- Leere Outbox: kein Netz nötig ---------------------------------------------------
{
  const st = fakeStorage();
  st.data.syncOutbox = [];
  const r = await flushOutboxWith(adapter, st, producer);
  assert.deepEqual(r, { ok: true, flushed: 0 });
}

server.close();
rmSync(rootDir, { recursive: true, force: true });
console.log('sync-flush.test.mjs: alle Assertions bestanden ✓');
