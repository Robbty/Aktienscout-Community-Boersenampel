/*
 * background.js — Service-Worker (MV3).
 *
 * Aufgaben:
 *  - regelmäßiges Polling der Börsenampel via api.alarms
 *  - Abruf der Skool-Seite mit der eingeloggten Session (credentials: include)
 *  - Diff gegen den zuletzt gesehenen Zustand -> Badge + Benachrichtigung
 *  - bedient Anfragen von Popup und Content-Script
 *
 * Speicher (api.storage.local):
 *  - baseline   : Zustand, den der Nutzer zuletzt "als gesehen" bestätigt hat
 *  - current    : zuletzt abgerufener Zustand
 *  - settings   : { intervalMinutes }
 *  - meta       : { lastPollAt, lastPollOk, lastError, source }
 */

// Cross-Browser: Firefox stellt `browser` bereit, Chrome `chrome`. Beide liefern
// in MV3 Promises, sodass der restliche Code mit await unverändert funktioniert.
const api = globalThis.browser || globalThis.chrome;

// Chrome (Service-Worker) lädt die geteilte Logik via importScripts. In Firefox
// kommt sie über das background.scripts-Array; dort gibt es kein importScripts.
if (typeof importScripts === 'function') {
  importScripts('lib/ampel.js');
}

const DEFAULTS = { intervalMinutes: 60 };
const ALARM = 'poll';

// --- Storage-Helfer ---------------------------------------------------------
async function getState() {
  const s = await api.storage.local.get(['baseline', 'current', 'settings', 'meta']);
  return {
    baseline: s.baseline || null,
    current: s.current || null,
    settings: Object.assign({}, DEFAULTS, s.settings || {}),
    meta: s.meta || {},
  };
}

async function setMeta(patch) {
  const { meta } = await getState();
  await api.storage.local.set({ meta: Object.assign({}, meta, patch) });
}

// --- Badge ------------------------------------------------------------------
async function refreshBadge() {
  const { baseline, current } = await getState();
  const n = diffCount(diffSnapshots(baseline, current));
  await api.action.setBadgeBackgroundColor({ color: '#d93025' });
  await api.action.setBadgeText({ text: n > 0 ? String(n) : '' });
}

// --- Kernablauf: neuen Snapshot übernehmen ----------------------------------
// quelle: 'fetch' (Hintergrund) oder 'page' (Content-Script).
async function ingestSnapshot(snapshot, source) {
  if (!snapshot) return;
  const { baseline, current } = await getState();

  // Delta zum vorherigen Abruf -> nur dann benachrichtigen, wenn neu.
  const delta = diffSnapshots(current, snapshot);
  const isFirstEver = !baseline;

  const toSet = { current: snapshot };
  if (isFirstEver) {
    // Erstinstallation: aktuellen Zustand als Baseline setzen, nichts melden.
    toSet.baseline = snapshot;
  } else if (baseline && !baseline.sections && snapshot.sections) {
    // Migration nach Update: Sektions-Baseline einmalig nachziehen, ohne den
    // Aktien-Vergleichspunkt zu verändern -> verhindert "alle Menüpunkte neu".
    toSet.baseline = Object.assign({}, baseline, { sections: snapshot.sections });
  }
  await api.storage.local.set(toSet);
  await setMeta({ lastPollAt: Date.now(), lastPollOk: true, lastError: null, source });
  await refreshBadge();

  if (!isFirstEver && diffCount(delta) > 0) {
    await notifyChanges(delta);
  }
}

// --- Hintergrund-Abruf ------------------------------------------------------
async function pollViaFetch() {
  try {
    const res = await fetch(AMPEL_CONFIG.classroomUrl, {
      credentials: 'include',
      headers: { 'Accept': 'text/html' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    const nextData = extractNextDataFromHtml(html);
    const snapshot = buildSnapshot(nextData);
    if (!snapshot || snapshot.stockCount === 0) {
      // Vermutlich ausgeloggt / kein Zugriff -> nicht als Erfolg werten.
      throw new Error('Keine Ampel-Daten (eingeloggt?)');
    }
    await ingestSnapshot(snapshot, 'fetch');
    return { ok: true };
  } catch (e) {
    await setMeta({ lastPollAt: Date.now(), lastPollOk: false, lastError: String(e.message || e) });
    await refreshBadge();
    return { ok: false, error: String(e.message || e) };
  }
}

// --- Benachrichtigung -------------------------------------------------------
async function notifyChanges(delta) {
  const sectionChanged = delta.sectionAdded.length + delta.sectionRemoved.length + delta.sectionEdited.length;
  const parts = [];
  if (delta.moved.length) parts.push(delta.moved.length + ' gewechselt');
  if (delta.added.length) parts.push(delta.added.length + ' neu');
  if (delta.edited.length) parts.push(delta.edited.length + ' bearbeitet');
  if (delta.removed.length) parts.push(delta.removed.length + ' entfernt');
  if (sectionChanged) parts.push(sectionChanged + ' Menüpunkt' + (sectionChanged > 1 ? 'e' : ''));

  // Bis zu drei konkrete Einträge als Vorschau.
  const sample = []
    .concat(delta.sectionAdded.map((s) => '+ ' + s.title + ' (Menüpunkt)'))
    .concat(delta.sectionRemoved.map((s) => '− ' + s.title + ' (Menüpunkt)'))
    .concat(delta.sectionEdited.map((s) => '✎ ' + s.title + ' (Menüpunkt)'))
    .concat(delta.moved.map((s) => '↔ ' + s.name))
    .concat(delta.added.map((s) => '+ ' + s.name))
    .concat(delta.edited.map((s) => '✎ ' + s.name))
    .slice(0, 3);

  await api.notifications.create('ampel-' + Date.now(), {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Börsenampel: ' + parts.join(', '),
    message: sample.join('\n') || 'Es gab Änderungen.',
    priority: 1,
  });
}

// --- "Als gesehen" markieren ------------------------------------------------
async function acknowledge() {
  const { current } = await getState();
  if (current) await api.storage.local.set({ baseline: current });
  await refreshBadge();
}

// --- Alarm / Lifecycle ------------------------------------------------------
async function ensureAlarm() {
  const { settings } = await getState();
  const period = Math.max(1, Number(settings.intervalMinutes) || DEFAULTS.intervalMinutes);
  await api.alarms.create(ALARM, { periodInMinutes: period });
}

async function setInterval(minutes) {
  const { settings } = await getState();
  const intervalMinutes = Math.max(1, Number(minutes) || DEFAULTS.intervalMinutes);
  await api.storage.local.set({ settings: Object.assign({}, settings, { intervalMinutes }) });
  await ensureAlarm();
}

api.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
  await pollViaFetch();
});

api.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await pollViaFetch();
});

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) pollViaFetch();
});

// Klick auf eine Benachrichtigung öffnet die Ampel-Seite.
api.notifications.onClicked.addListener((id) => {
  if (id.startsWith('ampel-')) api.tabs.create({ url: AMPEL_CONFIG.classroomUrl });
});

// --- Nachrichten von Popup / Content-Script ---------------------------------
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case 'getState': {
        const state = await getState();
        const diff = diffSnapshots(state.baseline, state.current);
        sendResponse({ ...state, diff });
        break;
      }
      case 'pollNow': {
        const r = await pollViaFetch();
        const state = await getState();
        sendResponse({ ...r, ...state, diff: diffSnapshots(state.baseline, state.current) });
        break;
      }
      case 'capture': {
        // Content-Script liefert einen garantiert eingeloggten Snapshot.
        await ingestSnapshot(msg.snapshot, 'page');
        sendResponse({ ok: true });
        break;
      }
      case 'acknowledge': {
        await acknowledge();
        const state = await getState();
        sendResponse({ ok: true, ...state, diff: diffSnapshots(state.baseline, state.current) });
        break;
      }
      case 'setInterval': {
        await setInterval(msg.minutes);
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'unknown message' });
    }
  })();
  return true; // async sendResponse
});
