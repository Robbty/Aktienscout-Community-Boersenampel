/*
 * sync-folder.js — Adapter "lokaler Ordner" über die File System Access API.
 *
 * Nur in Seitenkontexten von Chromium-Browsern (Popup, Standalone-Fenster) —
 * Firefox und Android-WebView kennen die API nicht, der Service-Worker hat
 * keinen Zugriff auf gespeicherte Handles. Der Nutzer wählt einen Ordner, den
 * sein Cloud-Client synchronisiert (Filen, Proton Drive, Nextcloud, Drive …).
 * Das Directory-Handle liegt in IndexedDB; Chrome ≥ 122 hält die Berechtigung
 * dauerhaft, ältere Versionen fragen je Sitzung einmal nach.
 *
 * Gleicher Vertrag wie sync-webdav.js: put/get/list/mkdirp/selfTest.
 */

const FOLDER_DB = 'boersenampel-sync';
const FOLDER_STORE = 'handles';
const FOLDER_KEY = 'dir';

function folderSupported() {
  return typeof globalThis.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined';
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FOLDER_DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(FOLDER_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDirHandle(handle) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(FOLDER_STORE, 'readwrite');
    tx.objectStore(FOLDER_STORE).put(handle, FOLDER_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadDirHandle() {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openDb();
    const h = await new Promise((resolve, reject) => {
      const tx = db.transaction(FOLDER_STORE, 'readonly');
      const req = tx.objectStore(FOLDER_STORE).get(FOLDER_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return h;
  } catch (e) {
    return null;
  }
}

async function clearDirHandle() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(FOLDER_STORE, 'readwrite');
      tx.objectStore(FOLDER_STORE).delete(FOLDER_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) { /* egal */ }
}

// Ordner wählen (braucht eine Nutzergeste) und merken.
async function pickFolder() {
  if (!folderSupported()) return { ok: false, error: 'Dieser Browser kann keine lokalen Ordner beschreiben' };
  try {
    const handle = await globalThis.showDirectoryPicker({ mode: 'readwrite', id: 'boersenampel-sync' });
    await saveDirHandle(handle);
    return { ok: true, name: handle.name };
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, error: 'Abgebrochen' };
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// 'granted' | 'prompt' | 'denied' | 'none' (kein Handle gespeichert).
async function folderPermission(request) {
  const h = await loadDirHandle();
  if (!h) return { state: 'none', name: null };
  try {
    let state = await h.queryPermission({ mode: 'readwrite' });
    if (state === 'prompt' && request) state = await h.requestPermission({ mode: 'readwrite' });
    return { state, name: h.name };
  } catch (e) {
    return { state: 'denied', name: h.name };
  }
}

async function getDir(root, dir, create) {
  let cur = root;
  for (const seg of String(dir || '').split('/').filter(Boolean)) {
    cur = await cur.getDirectoryHandle(seg, { create: !!create });
  }
  return cur;
}

function createFolderAdapter(root) {
  async function mkdirp(dir) {
    try { await getDir(root, dir, true); return { ok: true }; }
    catch (e) { return { ok: false, error: 'Ordner anlegen: ' + String((e && e.message) || e) }; }
  }

  async function put(path, text) {
    try {
      const segs = String(path).split('/').filter(Boolean);
      const name = segs.pop();
      const dir = await getDir(root, segs.join('/'), true);
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(text);
      await w.close();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Schreiben: ' + String((e && e.message) || e) };
    }
  }

  async function get(path) {
    try {
      const segs = String(path).split('/').filter(Boolean);
      const name = segs.pop();
      const dir = await getDir(root, segs.join('/'), false);
      const fh = await dir.getFileHandle(name);
      const f = await fh.getFile();
      return { ok: true, text: await f.text() };
    } catch (e) {
      if (e && e.name === 'NotFoundError') return { ok: true, text: null };
      return { ok: false, error: 'Lesen: ' + String((e && e.message) || e) };
    }
  }

  async function list(dir) {
    try {
      const d = await getDir(root, dir, false);
      const names = [];
      for await (const [name] of d.entries()) names.push(name);
      return { ok: true, names };
    } catch (e) {
      if (e && e.name === 'NotFoundError') return { ok: true, names: [] };
      return { ok: false, error: 'Auflisten: ' + String((e && e.message) || e) };
    }
  }

  async function selfTest() {
    const steps = [];
    const m = await mkdirp(EVENTS_ROOT);
    steps.push({ step: 'Ordner anlegen', ok: m.ok, error: m.error || null });
    if (!m.ok) return { ok: false, steps, error: m.error };
    const p = await put(formatPath(), JSON.stringify({ schema: EVENTS_SCHEMA, writtenAt: new Date().toISOString() }));
    steps.push({ step: 'Datei schreiben', ok: p.ok, error: p.error || null });
    if (!p.ok) return { ok: false, steps, error: p.error };
    const g = await get(formatPath());
    const okRead = g.ok && typeof g.text === 'string' && g.text.indexOf(EVENTS_SCHEMA) >= 0;
    steps.push({ step: 'Datei lesen', ok: okRead, error: okRead ? null : g.error || 'Inhalt stimmt nicht' });
    return okRead ? { ok: true, steps } : { ok: false, steps, error: g.error || 'Inhalt stimmt nicht' };
  }

  return { kind: 'folder', put, get, list, mkdirp, selfTest };
}

// Adapter aus dem gespeicherten Handle — null, wenn keins da oder nicht erlaubt.
async function openFolderAdapter(requestPermission) {
  const h = await loadDirHandle();
  if (!h) return null;
  const p = await folderPermission(requestPermission);
  if (p.state !== 'granted') return null;
  return createFolderAdapter(h);
}

if (typeof globalThis !== 'undefined') {
  globalThis.folderSupported = folderSupported;
  globalThis.pickFolder = pickFolder;
  globalThis.folderPermission = folderPermission;
  globalThis.clearDirHandle = clearDirHandle;
  globalThis.createFolderAdapter = createFolderAdapter;
  globalThis.openFolderAdapter = openFolderAdapter;
}
