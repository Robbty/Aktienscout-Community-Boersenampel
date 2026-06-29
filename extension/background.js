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

const DEFAULTS = { intervalMinutes: 60, blinkEnabled: true, activityDays: 7 };
const ALARM = 'poll';

// Icon-Frames fürs Blinken (normal = Lichter an, off = erloschen).
const ICON_ON = { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' };
const ICON_OFF = { 16: 'icons/off16.png', 48: 'icons/off48.png', 128: 'icons/off128.png' };

// --- Icon / Blinken ---------------------------------------------------------
// In MV3 schläft der Worker nach ~30 s ein -> kein Dauerblinken. Wir blinken
// daher in kurzen Schüben (während der Worker ohnehin wach ist) und lassen
// danach das Badge als ruhigen Hinweis stehen.
let blinkTimer = null;
let blinkUntil = 0;
let blinkOn = true;

async function setIcon(frame) {
  try { await api.action.setIcon({ path: frame }); } catch (e) { /* Icon optional */ }
}

function startBlink(durationMs = 12000) {
  blinkUntil = Date.now() + durationMs;
  if (blinkTimer) return; // läuft bereits -> nur Dauer verlängert
  blinkOn = true;
  blinkTimer = setInterval(async () => {
    if (Date.now() >= blinkUntil) { await stopBlink(); return; }
    blinkOn = !blinkOn;
    await setIcon(blinkOn ? ICON_ON : ICON_OFF);
  }, 500);
}

async function stopBlink() {
  if (blinkTimer) { clearInterval(blinkTimer); blinkTimer = null; }
  await setIcon(ICON_ON); // immer mit sichtbarem Normal-Icon enden
}

// --- Storage-Helfer ---------------------------------------------------------
async function getState() {
  const s = await api.storage.local.get(['baseline', 'current', 'settings', 'meta', 'history']);
  return {
    baseline: s.baseline || null,
    current: s.current || null,
    settings: Object.assign({}, DEFAULTS, s.settings || {}),
    meta: s.meta || {},
    history: s.history || [],
  };
}

const HISTORY_MAX = 1000; // Logbuch begrenzen (Strukturänderungen sind selten)

// Erkannte Strukturänderungen (Wechsel/Neu/Entfernt) dauerhaft mitschreiben.
// Bewusst OHNE reine Bearbeitungen (edited/sectionEdited) -> die sind verrauscht.
async function appendHistory(delta) {
  const detectedAt = new Date().toISOString();
  const events = [];
  const push = (e) => events.push(Object.assign({ detectedAt }, e));
  for (const s of delta.moved) push({ type: 'moved', id: s.id, name: s.name, color: s.color, from: s.from, to: s.to, at: s.updatedAt || detectedAt });
  for (const s of delta.added) push({ type: 'added', id: s.id, name: s.name, color: s.color, at: s.updatedAt || detectedAt });
  for (const s of delta.removed) push({ type: 'removed', id: s.id, name: s.name, color: s.color, at: detectedAt });
  for (const s of delta.sectionAdded) push({ type: 'sectionAdded', id: s.id, name: s.title, at: s.updatedAt || detectedAt });
  for (const s of delta.sectionRemoved) push({ type: 'sectionRemoved', id: s.id, name: s.title, at: detectedAt });
  if (!events.length) return;
  const { history } = await getState();
  // Bei Überlauf die ältesten Änderungen (nach Datum) verwerfen, nicht nur die
  // zuerst eingefügten.
  await api.storage.local.set({ history: pruneHistory(history.concat(events), HISTORY_MAX) });
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
  if (n === 0) {
    await stopBlink();           // alles gesehen -> Icon normal, Blinken aus
  } else if (!blinkTimer) {
    await setIcon(ICON_ON);       // nicht aktiv am Blinken -> festgeklemmtes Frame heilen
  }
}

// --- Kernablauf: neuen Snapshot übernehmen ----------------------------------
// quelle: 'fetch' (Hintergrund) oder 'page' (Content-Script).
async function ingestSnapshot(snapshot, source, allowBlink = false) {
  if (!snapshot) return;
  const { baseline, current, settings } = await getState();

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
    await appendHistory(delta); // Strukturänderungen ins Logbuch
  }

  // Blink-Schub, wenn es seit dem letzten Bestätigen unbestätigte Änderungen
  // gibt (nicht bei Erstinstallation, nicht wenn vom Nutzer abgeschaltet).
  const pending = diffCount(diffSnapshots(toSet.baseline || baseline, snapshot));
  if (allowBlink && !isFirstEver && settings.blinkEnabled && pending > 0) {
    startBlink();
  }
}

// --- Hintergrund-Abruf ------------------------------------------------------
async function pollViaFetch(allowBlink = false) {
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
    await ingestSnapshot(snapshot, 'fetch', allowBlink);
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

async function setBlinkEnabled(enabled) {
  const { settings } = await getState();
  await api.storage.local.set({ settings: Object.assign({}, settings, { blinkEnabled: !!enabled }) });
  if (!enabled) await stopBlink();
}

async function setActivityDays(days) {
  const { settings } = await getState();
  const activityDays = Math.max(1, Number(days) || DEFAULTS.activityDays);
  await api.storage.local.set({ settings: Object.assign({}, settings, { activityDays }) });
}

api.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
  await setIcon(ICON_ON);
  await pollViaFetch(false); // beim Installieren nicht blinken
});

api.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await setIcon(ICON_ON);
  await pollViaFetch(false); // beim Browserstart nicht blinken
});

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) pollViaFetch(true); // Hintergrund-Abruf darf blinken
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
        // Vom Popup ausgelöst -> nicht blinken (Nutzer schaut ohnehin hin).
        const r = await pollViaFetch(false);
        const state = await getState();
        sendResponse({ ...r, ...state, diff: diffSnapshots(state.baseline, state.current) });
        break;
      }
      case 'capture': {
        // Content-Script liefert einen garantiert eingeloggten Snapshot.
        await ingestSnapshot(msg.snapshot, 'page', true);
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
      case 'setBlink': {
        await setBlinkEnabled(msg.enabled);
        sendResponse({ ok: true });
        break;
      }
      case 'setActivityDays': {
        await setActivityDays(msg.days);
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'unknown message' });
    }
  })();
  return true; // async sendResponse
});
