/*
 * sync-webdav.js — WebDAV-Adapter für das Event-Log (Nextcloud, kDrive, Filen-CLI-
 * Server auf 127.0.0.1, ownCloud, HiDrive, MagentaCloud …).
 *
 * Adapter-Vertrag (gilt für alle Backends, siehe EVENTS.md):
 *   put(path, text) / get(path) / list(dir) / mkdirp(dir) / selfTest()
 * Alle Funktionen liefern { ok, … } und werfen NIE. Reiner fetch-Code — läuft
 * im Service-Worker, im Popup und in der Android-App (CapacitorHttp). `fetchFn`
 * ist injizierbar (Tests).
 */

function createWebdavAdapter(cfg) {
  const c = cfg || {};
  const baseUrl = String(c.baseUrl || '').replace(/\/+$/, '');
  const fetchFn = c.fetchFn || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  const auth = c.user ? 'Basic ' + toBase64(String(c.user) + ':' + String(c.password || '')) : null;

  function headers(extra) {
    const h = Object.assign({}, extra || {});
    if (auth) h['Authorization'] = auth;
    return h;
  }

  async function request(method, path, opts) {
    if (!fetchFn) return { ok: false, status: 0, error: 'fetch nicht verfügbar' };
    if (!baseUrl) return { ok: false, status: 0, error: 'Keine WebDAV-Adresse' };
    const o = opts || {};
    try {
      const res = await fetchFn(joinPath(baseUrl, path), {
        method,
        headers: headers(o.headers),
        body: o.body,
        credentials: 'omit',
        cache: 'no-store',
      });
      const text = o.wantText ? await res.text() : '';
      return { ok: res.ok, status: res.status, text };
    } catch (e) {
      return { ok: false, status: 0, error: String((e && e.message) || e) };
    }
  }

  function describe(method, path, r) {
    if (r.ok) return null;
    if (r.status === 401 || r.status === 403) return 'Anmeldung abgelehnt (' + r.status + ') – Benutzer/App-Passwort prüfen';
    if (r.status === 404) return 'Pfad nicht gefunden (404) – WebDAV-Adresse prüfen';
    if (r.status === 0) return 'Keine Verbindung' + (r.error ? ' (' + r.error + ')' : '');
    return method + ' ' + path + ' → HTTP ' + r.status;
  }

  // MKCOL je Segment; 405 (existiert bereits) und 301/302 gelten als vorhanden.
  async function mkdirp(dir) {
    const segs = String(dir || '').split('/').filter(Boolean);
    let cur = '';
    for (const s of segs) {
      cur += (cur ? '/' : '') + s;
      const r = await request('MKCOL', cur);
      if (r.ok || r.status === 405 || r.status === 301 || r.status === 302) continue;
      return { ok: false, status: r.status, error: describe('MKCOL', cur, r) };
    }
    return { ok: true };
  }

  async function put(path, text) {
    const r = await request('PUT', path, {
      body: text,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    if (r.ok) return { ok: true, status: r.status };
    // Übergeordneter Ordner fehlt (409/404) -> anlegen und einmal wiederholen.
    if (r.status === 409 || r.status === 404) {
      const dir = String(path).split('/').slice(0, -1).join('/');
      const m = await mkdirp(dir);
      if (!m.ok) return m;
      const r2 = await request('PUT', path, { body: text, headers: { 'Content-Type': 'application/octet-stream' } });
      if (r2.ok) return { ok: true, status: r2.status };
      return { ok: false, status: r2.status, error: describe('PUT', path, r2) };
    }
    return { ok: false, status: r.status, error: describe('PUT', path, r) };
  }

  // text: null bei 404 (existiert nicht) — kein Fehler.
  async function get(path) {
    const r = await request('GET', path, { wantText: true });
    if (r.ok) return { ok: true, status: r.status, text: r.text };
    if (r.status === 404) return { ok: true, status: 404, text: null };
    return { ok: false, status: r.status, error: describe('GET', path, r) };
  }

  // Namen der Einträge in dir (ohne dir selbst). PROPFIND Depth 1, minimaler
  // Regex-Parser über <d:href> (kein DOMParser im Worker).
  async function list(dir) {
    const r = await request('PROPFIND', dir, {
      wantText: true,
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
    });
    if (!r.ok && r.status !== 207) return { ok: false, status: r.status, error: describe('PROPFIND', dir, r) };
    const names = [];
    const own = decodeURIComponent(joinPath('', dir)).replace(/\/+$/, '');
    const re = /<[a-zA-Z0-9]*:?href>([^<]+)<\/[a-zA-Z0-9]*:?href>/g;
    let m;
    while ((m = re.exec(r.text))) {
      let href;
      try { href = decodeURIComponent(m[1].trim()); } catch (e) { href = m[1].trim(); }
      href = href.replace(/\/+$/, '');
      if (!href || href.endsWith(own)) continue; // der Ordner selbst
      const name = href.split('/').pop();
      if (name) names.push(name);
    }
    return { ok: true, names };
  }

  // Jeder Schritt einzeln benannt — WebDAV-Anbieter unterscheiden sich in Details.
  async function selfTest() {
    const steps = [];
    const m = await mkdirp(EVENTS_ROOT);
    steps.push({ step: 'Ordner anlegen (MKCOL)', ok: m.ok, error: m.error || null });
    if (!m.ok) return { ok: false, steps, error: m.error };
    const body = JSON.stringify({ schema: EVENTS_SCHEMA, writtenAt: new Date().toISOString() });
    const p = await put(formatPath(), body);
    steps.push({ step: 'Datei schreiben (PUT)', ok: p.ok, error: p.error || null });
    if (!p.ok) return { ok: false, steps, error: p.error };
    const g = await get(formatPath());
    const okRead = g.ok && typeof g.text === 'string' && g.text.indexOf(EVENTS_SCHEMA) >= 0;
    steps.push({ step: 'Datei lesen (GET)', ok: okRead, error: okRead ? null : g.error || 'Inhalt stimmt nicht' });
    if (!okRead) return { ok: false, steps, error: g.error || 'Gelesener Inhalt stimmt nicht' };
    return { ok: true, steps };
  }

  return { kind: 'webdav', put, get, list, mkdirp, selfTest };
}

// UTF-8-sicheres Base64 (Basic-Auth mit Umlauten im Passwort).
function toBase64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Nur https – außer Loopback (Filen-CLI-Server u. ä.) darf http.
function validateWebdavUrl(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch (e) { return { ok: false, error: 'Keine gültige Adresse' }; }
  const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]' || u.hostname === '::1';
  if (u.protocol === 'https:') return { ok: true, origin: u.origin, loopback };
  if (u.protocol === 'http:' && loopback) return { ok: true, origin: u.origin, loopback };
  return { ok: false, error: 'Nur https:// – http:// nur für 127.0.0.1/localhost' };
}

if (typeof globalThis !== 'undefined') {
  globalThis.createWebdavAdapter = createWebdavAdapter;
  globalThis.validateWebdavUrl = validateWebdavUrl;
  globalThis.webdavToBase64 = toBase64;
}
