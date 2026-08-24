/*
 * sync-webdav.test.mjs — WebDAV-Adapter mit Fake-fetch: Pfade, Methoden, Header,
 * MKCOL-Toleranz, Fehlerobjekte, PROPFIND-Parser, URL-Validierung.
 *
 *   node test/sync-webdav.test.mjs
 */
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
for (const lib of ['quotes.js', 'ampel.js', 'circle.js', 'events.js', 'sync-webdav.js']) {
  runInThisContext(readFileSync(join(here, '..', 'extension', 'lib', lib), 'utf8'));
}
const { createWebdavAdapter, validateWebdavUrl, webdavToBase64 } = globalThis;

// Fake-Server: Antworten je "METHOD url" (Liste -> nacheinander), Log aller Calls.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const key = init.method + ' ' + url;
    let r = routes[key];
    if (Array.isArray(r)) r = r.shift();
    if (r === undefined) r = { status: 404 };
    if (r instanceof Error) throw r;
    const status = r.status;
    return { ok: status >= 200 && status < 300, status, text: async () => r.text || '' };
  };
  fn.calls = calls;
  return fn;
}

const base = 'https://cloud.example.org/remote.php/dav/files/peter/';

// --- Auth-Header, Pfad-Kodierung, Erfolg ------------------------------------------
{
  const f = fakeFetch({ ['PUT https://cloud.example.org/remote.php/dav/files/peter/boersenampel/events/p%201/2026-08-24.jsonl']: { status: 201 } });
  const a = createWebdavAdapter({ baseUrl: base, user: 'peter', password: 'pässwort', fetchFn: f });
  const r = await a.put('boersenampel/events/p 1/2026-08-24.jsonl', '{}\n');
  assert.deepEqual(r, { ok: true, status: 201 });
  assert.equal(f.calls[0].headers.Authorization, 'Basic ' + webdavToBase64('peter:pässwort'));
  assert.equal(f.calls[0].headers['Content-Type'], 'application/octet-stream');
  assert.equal(webdavToBase64('a:ä'), Buffer.from('a:ä', 'utf8').toString('base64'), 'UTF-8-Base64');
}

// --- PUT auf fehlenden Ordner: 409 -> MKCOL je Segment (405 = existiert) -> Retry ---
{
  const p = 'https://cloud.example.org/remote.php/dav/files/peter/';
  const f = fakeFetch({
    ['PUT ' + p + 'boersenampel/events/p1/d.jsonl']: [{ status: 409 }, { status: 201 }],
    ['MKCOL ' + p + 'boersenampel']: { status: 405 },
    ['MKCOL ' + p + 'boersenampel/events']: { status: 201 },
    ['MKCOL ' + p + 'boersenampel/events/p1']: { status: 201 },
  });
  const a = createWebdavAdapter({ baseUrl: base, fetchFn: f });
  const r = await a.put('boersenampel/events/p1/d.jsonl', 'x');
  assert.equal(r.ok, true);
  assert.deepEqual(f.calls.map((c) => c.method), ['PUT', 'MKCOL', 'MKCOL', 'MKCOL', 'PUT']);
  assert.equal(f.calls[0].headers.Authorization, undefined, 'ohne Benutzer kein Auth-Header');
}

// --- Fehlerobjekte, nie werfen -----------------------------------------------------
{
  const p = 'https://cloud.example.org/remote.php/dav/files/peter/';
  const f = fakeFetch({ ['PUT ' + p + 'x']: { status: 401 }, ['GET ' + p + 'y']: new Error('ECONNREFUSED') });
  const a = createWebdavAdapter({ baseUrl: base, fetchFn: f });
  const r = await a.put('x', '');
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
  assert.match(r.error, /Anmeldung abgelehnt/);
  const g = await a.get('y');
  assert.equal(g.ok, false);
  assert.match(g.error, /Keine Verbindung/);
  const notFound = await a.get('nope');
  assert.deepEqual(notFound, { ok: true, status: 404, text: null }, '404 beim Lesen ist kein Fehler');
  const empty = createWebdavAdapter({ baseUrl: '', fetchFn: f });
  assert.equal((await empty.put('x', '')).ok, false);
}

// --- PROPFIND-Parser ------------------------------------------------------------------
{
  const p = 'https://cloud.example.org/remote.php/dav/files/peter/';
  const xml = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">' +
    '<d:response><d:href>/remote.php/dav/files/peter/boersenampel/events/</d:href></d:response>' +
    '<d:response><d:href>/remote.php/dav/files/peter/boersenampel/events/p1/</d:href></d:response>' +
    '<d:response><d:href>/remote.php/dav/files/peter/boersenampel/events/p%202/</d:href></d:response>' +
    '</d:multistatus>';
  const f = fakeFetch({ ['PROPFIND ' + p + 'boersenampel/events']: { status: 207, text: xml } });
  const a = createWebdavAdapter({ baseUrl: base, fetchFn: f });
  const r = await a.list('boersenampel/events');
  assert.deepEqual(r, { ok: true, names: ['p1', 'p 2'] });
  assert.equal(f.calls[0].headers.Depth, '1');
}

// --- selfTest: Schritte einzeln ----------------------------------------------------
{
  const p = 'https://cloud.example.org/remote.php/dav/files/peter/';
  const f = fakeFetch({
    ['MKCOL ' + p + 'boersenampel']: { status: 201 },
    ['PUT ' + p + 'boersenampel/format.json']: { status: 201 },
    ['GET ' + p + 'boersenampel/format.json']: { status: 200, text: '{"schema":"boersenampel-events/1"}' },
  });
  const a = createWebdavAdapter({ baseUrl: base, fetchFn: f });
  const r = await a.selfTest();
  assert.equal(r.ok, true);
  assert.deepEqual(r.steps.map((s) => s.ok), [true, true, true]);
  const f2 = fakeFetch({ ['MKCOL ' + p + 'boersenampel']: { status: 401 } });
  const r2 = await createWebdavAdapter({ baseUrl: base, fetchFn: f2 }).selfTest();
  assert.equal(r2.ok, false);
  assert.equal(r2.steps.length, 1);
  assert.match(r2.error, /Anmeldung/);
}

// --- URL-Validierung -----------------------------------------------------------------
assert.equal(validateWebdavUrl('https://x.y/dav/').ok, true);
assert.equal(validateWebdavUrl('http://x.y/dav/').ok, false, 'http nur Loopback');
assert.deepEqual(validateWebdavUrl('http://127.0.0.1:8080/'), { ok: true, origin: 'http://127.0.0.1:8080', loopback: true });
assert.equal(validateWebdavUrl('http://localhost:1900/x').ok, true);
assert.equal(validateWebdavUrl('ftp://x').ok, false);
assert.equal(validateWebdavUrl('').ok, false);

console.log('sync-webdav.test.mjs: alle Assertions bestanden ✓');
