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
 *  - circle     : { courseTitle, buildId, modules } — Circle-Engagements inkl.
 *                 geparster Bodies (Trade-Daten), inkrementell geerntet
 *  - circleMeta : { lastPollAt, lastPollOk, access, lastError }
 */

// Cross-Browser: Firefox stellt `browser` bereit, Chrome `chrome`. Beide liefern
// in MV3 Promises, sodass der restliche Code mit await unverändert funktioniert.
const api = globalThis.browser || globalThis.chrome;

// Chrome (Service-Worker) lädt die geteilte Logik via importScripts. In Firefox
// kommt sie über das background.scripts-Array; dort gibt es kein importScripts.
if (typeof importScripts === 'function') {
  importScripts('lib/debug.js', 'lib/ampel.js', 'lib/circle.js', 'lib/quotes.js',
    'lib/events.js', 'lib/sync-webdav.js', 'lib/sync-flush.js');
}

const DEFAULTS = {
  intervalMinutes: 60,
  blinkEnabled: true,
  activityDays: 7,
  // Event-Log-Sync (EVENTS.md): aus, bis der Nutzer ihn im Footer einschaltet.
  sync: { enabled: false, adapter: 'webdav', url: '', user: '', password: '', producerId: null, label: '' },
};
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
  await refreshIcon(); // Normal-Icon, ggf. mit goldenem Circle-Punkt
}

// --- Goldener Circle-Punkt auf dem Icon ---------------------------------------
// Zwei getrennte Zeichen: das rote Badge (Zahl) gehört der Ampel, der goldene
// Punkt meldet unbestätigte Circle-Käufe/-Verkäufe. Der Punkt sitzt OBEN LINKS,
// weil das Badge das Icon unten rechts überlagert — so bleiben beide gleichzeitig
// sichtbar.
let goldDotFrames = null; // Cache: einmal gezeichnet, dann wiederverwendet

async function buildGoldDotFrames() {
  const frames = {};
  for (const size of [16, 48, 128]) {
    const res = await fetch(api.runtime.getURL(ICON_ON[size]));
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, size, size);
    const r = Math.max(3.5, size * 0.21);
    const c = r + Math.max(1, size * 0.03); // obere linke Ecke
    ctx.beginPath();
    ctx.arc(c, c, r, 0, 2 * Math.PI);
    ctx.fillStyle = '#d4a017'; // gold
    ctx.fill();
    ctx.lineWidth = Math.max(1, size / 24);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    frames[size] = ctx.getImageData(0, 0, size, size);
  }
  return frames;
}

async function refreshIcon() {
  const { circleMeta } = await getState();
  if ((circleMeta.pending || 0) > 0) {
    try {
      if (!goldDotFrames) goldDotFrames = await buildGoldDotFrames();
      await api.action.setIcon({ imageData: goldDotFrames });
      return;
    } catch (e) { /* z. B. kein OffscreenCanvas -> normales Icon */ }
  }
  await setIcon(ICON_ON);
}

// --- Storage-Helfer ---------------------------------------------------------
async function getState() {
  const s = await api.storage.local.get(['baseline', 'current', 'settings', 'meta', 'history', 'circle', 'circleMeta', 'circleHistory']);
  return {
    baseline: s.baseline || null,
    current: s.current || null,
    settings: Object.assign({}, DEFAULTS, s.settings || {}),
    meta: s.meta || {},
    history: s.history || [],
    circle: s.circle || null,
    circleMeta: s.circleMeta || {},
    circleHistory: s.circleHistory || [],
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
  // Bereits bekannte Ereignisse (gleicher Schlüssel) werden verworfen; bei
  // Überlauf fallen die ältesten Änderungen (nach Datum) weg.
  await api.storage.local.set({ history: appendUniqueHistory(history, events, HISTORY_MAX) });
}

// Einmalige Bereinigung (v0.6.6): überlappende Polls konnten Ereignisse doppelt
// in die Logbücher schreiben, und leere Platzhalter-Seiten ("Neue Seite")
// wurden fälschlich als Kauf gemeldet. Bestehende Einträge einmalig heilen.
async function cleanupHistoryOnce() {
  const { meta, history, circleHistory } = await getState();
  if (meta.historyCleanupV1) return;
  const cleanCircle = dedupeHistory(circleHistory).filter(
    (e) => !(e.type === 'bought' && e.name === 'Neue Seite')
  );
  await api.storage.local.set({
    history: dedupeHistory(history),
    circleHistory: cleanCircle,
  });
  await setMeta({ historyCleanupV1: true });
}

// Einmalige Speicher-Bereinigung: "Neue Seite"-Platzhalter aus allen gespeicherten
// Altbeständen LÖSCHEN — Snapshots (baseline/current), beide Logbücher und die
// Circle-Module. Neu ankommende Daten sind durch die Filter in buildSnapshot und
// buildCircleIndex bereits sauber; das hier räumt nur auf, was ältere Versionen
// geschrieben haben.
async function cleanupPlaceholdersOnce() {
  const { meta, baseline, current, history, circleHistory, circle } = await getState();
  if (meta.placeholderCleanupV1) return;
  const toSet = {
    history: (history || []).filter((e) => !hiddenPlaceholderTitle(e.name)),
    circleHistory: (circleHistory || []).filter((e) => !hiddenPlaceholderTitle(e.name)),
  };
  if (baseline) toSet.baseline = stripHiddenFromSnapshot(baseline);
  if (current) toSet.current = stripHiddenFromSnapshot(current);
  if (circle && circle.modules) {
    const modules = {};
    for (const [id, m] of Object.entries(circle.modules)) {
      if (!hiddenPlaceholderTitle(m.title)) modules[id] = m;
    }
    toSet.circle = { ...circle, modules };
  }
  await api.storage.local.set(toSet);
  await setMeta({ placeholderCleanupV1: true });
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
    await refreshIcon();          // nicht aktiv am Blinken -> festgeklemmtes Frame heilen
  }
}

// --- Kernablauf: neuen Snapshot übernehmen ----------------------------------
// quelle: 'fetch' (Hintergrund) oder 'page' (Content-Script).
async function ingestSnapshot(snapshot, source, allowBlink = false) {
  if (!snapshot) return;
  const { baseline, current, settings, meta } = await getState();

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
  const metaPatch = { lastPollAt: Date.now(), lastPollOk: true, access: 'ok', lastError: null, source };
  // Beginn der Überwachung einmalig festhalten (für ehrliche "seit"-Anzeige).
  if (!meta.watchingSince) metaPatch.watchingSince = new Date().toISOString();
  await setMeta(metaPatch);
  await refreshBadge();

  if (!isFirstEver && diffCount(delta) > 0) {
    await notifyChanges(delta);
    await appendHistory(delta); // Strukturänderungen ins Logbuch
    syncOnAmpelDelta(delta).catch((e) => console.warn('[Sync] Ampel-Delta', e));
  }
  // Snapshot-Regel + langsame Symbolauflösung, nie im Poll-Pfad awaiten.
  afterSuccessfulAmpelPoll().catch((e) => console.warn('[Sync] Nachlauf', e));

  // Blink-Schub, wenn es seit dem letzten Bestätigen unbestätigte Änderungen
  // gibt (nicht bei Erstinstallation, nicht wenn vom Nutzer abgeschaltet).
  const pending = diffCount(diffSnapshots(toSet.baseline || baseline, snapshot));
  if (allowBlink && !isFirstEver && settings.blinkEnabled && pending > 0) {
    startBlink();
  }
}

// --- Hintergrund-Abruf ------------------------------------------------------
// In-flight-Guard: Alarm, Popup, Standalone-Fenster und "Jetzt prüfen" können
// gleichzeitig anfragen. Ein zweiter Start während eines laufenden Polls würde
// gegen denselben alten Zustand diffen und Ereignisse doppelt ins Logbuch
// schreiben -> stattdessen hängen sich alle Aufrufer an den laufenden Poll.
let ampelPollInFlight = null;
function pollViaFetch(allowBlink = false) {
  if (ampelPollInFlight) return ampelPollInFlight;
  ampelPollInFlight = doPollViaFetch(allowBlink).finally(() => { ampelPollInFlight = null; });
  return ampelPollInFlight;
}

async function doPollViaFetch(allowBlink = false) {
  // Test-Schalter (lib/debug.js): fehlenden Zugang bzw. Logout simulieren.
  const sim = (globalThis.DEBUG_SIMULATE && globalThis.DEBUG_SIMULATE.ampel) || null;
  if (sim === 'noAccess' || sim === 'loggedOut') {
    await setMeta({
      lastPollAt: Date.now(),
      lastPollOk: false,
      access: sim,
      lastError: 'TEST-Schalter aktiv (lib/debug.js)',
    });
    await refreshBadge();
    return { ok: false, access: sim };
  }
  try {
    const res = await fetch(AMPEL_CONFIG.classroomUrl, {
      credentials: 'include',
      headers: { 'Accept': 'text/html' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    const nextData = extractNextDataFromHtml(html);
    // Eingeloggt, aber kein Mitglied? -> eigener Zustand mit VIP-Hinweis.
    const access = classifyAmpelAccess(nextData);
    if (access !== 'ok') {
      await setMeta({
        lastPollAt: Date.now(),
        lastPollOk: false,
        access,
        lastError: access === 'noAccess' ? 'Kein Zugang zur Aktienscout-Community' : 'Nicht eingeloggt',
      });
      await refreshBadge();
      return { ok: false, access };
    }
    const snapshot = buildSnapshot(nextData);
    if (!snapshot || snapshot.stockCount === 0) {
      // Vermutlich ausgeloggt / kein Zugriff -> nicht als Erfolg werten.
      throw new Error('Keine Ampel-Daten (eingeloggt?)');
    }
    // buildId für die Detail-Abrufe (Phase 2) merken; rotiert bei Skool-Deploys.
    if (nextData.buildId) await setMeta({ buildId: nextData.buildId });
    await ingestSnapshot(snapshot, 'fetch', allowBlink);
    return { ok: true };
  } catch (e) {
    const msg = String(e.message || e);
    // Ohne gültige Session antwortet Skool mit 401/403 -> "nicht eingeloggt".
    const access = /HTTP (401|403)/.test(msg) ? 'loggedOut' : 'error';
    await setMeta({ lastPollAt: Date.now(), lastPollOk: false, access, lastError: msg });
    await refreshBadge();
    return { ok: false, access, error: msg };
  }
}

// --- Circle: Poll mit inkrementellem Body-Harvest -----------------------------
// Die Beträge stehen nur in den Modul-Bodies, die Skool pro Modul liefert.
// Deshalb: Kursbaum holen (1 Request), dann nur die Module nachladen, deren
// updatedAt sich seit dem letzten geparsten Body geändert hat.
const CIRCLE_HARVEST_CAP = 25;      // max. Modul-Abrufe pro Lauf (Kurs hat ~20)
const CIRCLE_FETCH_DELAY_MS = 350;  // höflicher Abstand zwischen Modul-Abrufen
const CIRCLE_HISTORY_MAX = 500;     // Kauf-/Verkaufs-Logbuch begrenzen
// Bei Parser-Änderungen erhöhen: erzwingt einmalig das Neu-Holen/-Parsen aller
// bereits geernteten Modul-Bodies (gespeichert wird nur das Parse-Ergebnis,
// nicht der Rohtext — ohne Re-Harvest blieben alte Fehlparser-Stände liegen).
const CIRCLE_PARSE_VERSION = 3;     // v3: Währung auch als "Euro"/"euro"/"EUR"

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function setCircleMeta(patch) {
  const { circleMeta } = await getState();
  await api.storage.local.set({ circleMeta: Object.assign({}, circleMeta, patch) });
}

// Kursseite als HTML holen -> __NEXT_DATA__ (Baum + buildId + ggf. ein Body).
async function fetchCircleHtml() {
  const res = await fetch(CIRCLE_CONFIG.classroomUrl, {
    credentials: 'include',
    headers: { 'Accept': 'text/html' },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const nextData = extractNextDataFromHtml(await res.text());
  return { nextData, buildId: (nextData && nextData.buildId) || null };
}

// Body eines einzelnen Moduls über die Next.js-Datenroute holen.
// undefined = Route gescheitert (buildId veraltet?); null = Modul hat keinen Body.
async function fetchCircleModuleDesc(buildId, id) {
  if (!buildId) return undefined;
  try {
    const res = await fetch(circleDataUrl(buildId, id), {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return undefined;
    const index = buildCircleIndex(await res.json());
    if (!index) return undefined;
    return Object.prototype.hasOwnProperty.call(index.descs, id) ? index.descs[id] : null;
  } catch (e) {
    return undefined;
  }
}

// Geholten Body parsen und im Modul-Eintrag ablegen. bodyUpdatedAt merkt sich,
// zu welchem Stand der Body gehört -> Basis der inkrementellen Auswahl.
function applyCircleBody(entry, desc) {
  const text = proseMirrorText(desc);
  entry.trade = null;
  entry.statistik = null;
  entry.parseError = null;
  if (entry.titleInfo.kind === 'meta') {
    entry.statistik = text != null ? parseStatistik(text) : null;
  } else if (text == null) {
    entry.parseError = 'Inhalt nicht lesbar';
  } else {
    entry.trade = parseTradeBody(text);
    if (!entry.trade) entry.parseError = 'Keine Trade-Daten erkannt';
  }
  entry.bodyUpdatedAt = entry.updatedAt;
}

// Benachrichtigung über Circle-Käufe/-Verkäufe (nur die seltenen Ereignisse,
// keine Kurs-Aktualisierungen).
async function notifyCircleEvents(events) {
  const bought = events.filter((e) => e.type === 'bought').length;
  const sold = events.filter((e) => e.type === 'sold').length;
  const removed = events.filter((e) => e.type === 'removed').length;
  const parts = [];
  if (bought) parts.push(bought + (bought > 1 ? ' Käufe' : ' Kauf'));
  if (sold) parts.push(sold + (sold > 1 ? ' Verkäufe' : ' Verkauf'));
  if (removed) parts.push(removed + ' entfernt');

  const fmt = (n) => Number(n).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  const sample = events.slice(0, 3).map((e) => {
    if (e.type === 'bought') return '+ ' + e.name + (e.totalBuyEur != null ? ' (' + fmt(e.totalBuyEur) + ')' : '');
    if (e.type === 'sold') {
      let s = '✔ ' + e.name + ' verkauft';
      if (e.ertragEur != null) s += ': ' + (e.ertragEur >= 0 ? '+' : '') + fmt(e.ertragEur);
      if (e.holdingDays != null) s += ' nach ' + e.holdingDays + ' Tag' + (e.holdingDays === 1 ? '' : 'en');
      return s;
    }
    return '− ' + e.name;
  });

  await api.notifications.create('circle-' + Date.now(), {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Circle: ' + parts.join(', '),
    message: sample.join('\n') || 'Es gab Änderungen.',
    priority: 1,
  });
}

// Gleicher In-flight-Guard wie beim Ampel-Poll (siehe pollViaFetch): der
// Circle-Harvest läuft durch die gedrosselte Modul-Schleife 10–30 s — genug
// Zeit für einen zweiten Trigger, der sonst denselben Event-Batch nochmal
// anhängen würde (die live beobachteten Duplikate im Käufe-&-Verkäufe-Log).
let circlePollInFlight = null;
function pollCircle(allowBlink = false) {
  if (circlePollInFlight) return circlePollInFlight;
  circlePollInFlight = doPollCircle(allowBlink).finally(() => { circlePollInFlight = null; });
  return circlePollInFlight;
}

async function doPollCircle(allowBlink = false) {
  // Test-Schalter (lib/debug.js): fehlenden Zugang bzw. Logout simulieren.
  const sim = (globalThis.DEBUG_SIMULATE && globalThis.DEBUG_SIMULATE.circle) || null;
  if (sim === 'noAccess' || sim === 'loggedOut') {
    await setCircleMeta({
      lastPollAt: Date.now(),
      lastPollOk: false,
      access: sim,
      lastError: 'TEST-Schalter aktiv (lib/debug.js)',
    });
    return { ok: false, access: sim };
  }
  try {
    const { nextData, buildId } = await fetchCircleHtml();
    const index = buildCircleIndex(nextData);
    const access = classifyCircleAccess(index);
    if (access !== 'ok') {
      // Wie bei der Ampel: ein gescheiterter Abruf überschreibt NIE die Daten,
      // damit der Stand die Logout-Lücke überlebt.
      await setCircleMeta({
        lastPollAt: Date.now(),
        lastPollOk: false,
        access,
        lastError: access === 'noAccess' ? 'Kein Zugang zum Circle-Kurs' : 'Nicht eingeloggt',
      });
      return { ok: false, access };
    }

    const { circle, circleMeta: metaBefore } = await getState();
    const oldModules = (circle && circle.modules) || {};

    // Neuen Modul-Stand aufbauen; bereits geparste Bodies wandern mit.
    const modules = {};
    for (const m of Object.values(index.modules)) {
      const prev = oldModules[m.id];
      modules[m.id] = {
        id: m.id,
        title: m.title,
        updatedAt: m.updatedAt,
        titleInfo: parseModuleTitle(m.title),
        bodyUpdatedAt: prev ? prev.bodyUpdatedAt : null,
        trade: prev ? prev.trade : null,
        statistik: prev ? prev.statistik : null,
        parseError: prev ? prev.parseError : null,
      };
    }

    // Parser-Update: alle übernommenen Bodies als veraltet markieren, damit sie
    // unten neu geholt und mit dem aktuellen Parser gelesen werden. Bricht der
    // Harvest vorzeitig ab, bleibt bodyUpdatedAt null gespeichert und der Rest
    // heilt bei den nächsten Polls nach.
    if ((metaBefore.parseVersion || 1) < CIRCLE_PARSE_VERSION) {
      for (const m of Object.values(modules)) m.bodyUpdatedAt = null;
    }

    // Bodies, die der Seitenabruf gratis mitgeliefert hat, sofort übernehmen.
    for (const [id, desc] of Object.entries(index.descs)) {
      if (modules[id] && modules[id].bodyUpdatedAt !== modules[id].updatedAt) {
        applyCircleBody(modules[id], desc);
      }
    }

    // Fehlende/veraltete Bodies gezielt nachladen (gedrosselt, gedeckelt).
    let effectiveBuildId = buildId || (circle && circle.buildId) || null;
    const stale = selectStaleModules(index, modules).slice(0, CIRCLE_HARVEST_CAP);
    for (const id of stale) {
      await sleep(CIRCLE_FETCH_DELAY_MS);
      let desc = await fetchCircleModuleDesc(effectiveBuildId, id);
      if (desc === undefined) {
        // buildId vermutlich veraltet (Skool-Deploy) -> einmal frisch lesen.
        const fresh = await fetchCircleHtml();
        effectiveBuildId = fresh.buildId || effectiveBuildId;
        desc = await fetchCircleModuleDesc(effectiveBuildId, id);
        if (desc === undefined) break; // Rest heilt beim nächsten Poll
      }
      applyCircleBody(modules[id], desc);
    }

    // Kauf-/Verkaufs-Ereignisse gegenüber dem vorherigen Stand erkennen.
    // Beim allerersten Harvest gibt es keinen Vergleichspunkt -> nichts melden.
    const isFirstEver = Object.keys(oldModules).length === 0;
    const events = isFirstEver ? [] : diffCircleModules(oldModules, modules);

    const { circleMeta, circleHistory, settings } = await getState();
    // Bereits geloggte Ereignisse (gleicher fachlicher Schlüssel) nicht erneut
    // melden — heilt z. B. einen Zustands-Rollback nach Worker-Tod.
    const detectedAt = new Date().toISOString();
    const known = new Set(circleHistory.map(historyKey));
    const fresh = events
      .map((e) => ({ ...e, detectedAt, at: e.at || detectedAt }))
      .filter((e) => !known.has(historyKey(e)))
      // "Neue Seite"-Platzhalter nie loggen/melden (soll nirgends erscheinen).
      .filter((e) => !circleHiddenTitle(e.name));

    // Modul-Stand, Logbuch und Meta in EINEM Write: stirbt der Worker zwischen
    // getrennten Writes, gingen sonst Ereignisse still verloren.
    const toSet = {
      circle: { courseTitle: index.courseTitle, buildId: effectiveBuildId, modules },
      circleMeta: Object.assign({}, circleMeta,
        { lastPollAt: Date.now(), lastPollOk: true, access: 'ok', lastError: null,
          parseVersion: CIRCLE_PARSE_VERSION },
        fresh.length ? { pending: (circleMeta.pending || 0) + fresh.length } : null),
    };
    if (fresh.length) {
      toSet.circleHistory = pruneHistory(circleHistory.concat(fresh), CIRCLE_HISTORY_MAX);
    }
    await api.storage.local.set(toSet);

    if (fresh.length) {
      syncOnCircleDelta(fresh, modules, oldModules).catch((e) => console.warn('[Sync] Circle-Delta', e));
      await notifyCircleEvents(fresh);
      if (allowBlink && settings.blinkEnabled) startBlink();
    }
    await refreshIcon(); // goldener Punkt an/aus, je nach unbestätigten Ereignissen
    return { ok: true, access: 'ok', events: fresh.length };
  } catch (e) {
    const msg = String(e.message || e);
    // Ohne gültige Session antwortet Skool mit 401/403 (live geprüft) ->
    // als "nicht eingeloggt" ausweisen, nicht als technischer Fehler.
    const access = /HTTP (401|403)/.test(msg) ? 'loggedOut' : 'error';
    await setCircleMeta({
      lastPollAt: Date.now(),
      lastPollOk: false,
      access,
      lastError: msg,
    });
    return { ok: false, access, error: msg };
  }
}

// --- Phase 3: Yahoo-Kurse für die laufenden Circle-Positionen ------------------
// Auf Anfrage des Popups: je offener Position das Yahoo-Symbol auflösen
// (ISIN > WKN > Name, Ergebnis dauerhaft gecacht), den Kurs holen (5-Min-Cache)
// und nach Euro umrechnen. Alles defensiv — ohne Kurs zeigt das Popup "–".
const QUOTE_TTL_MS = 5 * 60 * 1000;        // Kurse kurz cachen (Popup-Öffnungen)
// Gescheiterte Auflösungen schon nach 2 Minuten erneut versuchen — praktisch
// also bei jeder neuen Popup-Sitzung. Ein einzelner Yahoo-Schluckauf soll
// keinen dauerhaft leeren Kurs hinterlassen (live gesehen bei Accor); die
// kurze Sperre verhindert nur das Hämmern bei schnell wiederholtem Öffnen.
const SYMBOL_RETRY_MS = 2 * 60 * 1000;
const QUOTE_FETCH_DELAY_MS = 250;          // höflicher Abstand (gegen 429-Drosselung)
// Bei Änderungen an der Auflösungslogik hochzählen -> alte Cache-Einträge
// werden neu aufgelöst (v2: Plausibilitätsprüfung; v3/v4: hängengebliebene
// Fehlversuche einmalig lösen).
const SYMBOL_RESOLVE_VERSION = 4;

async function resolveYahooSymbol(query) {
  let found = await fetchYahooSearch(query);
  if (found === undefined) {
    // Netz-/Drosselfehler (nicht "keine Treffer") -> einmal in Ruhe nachfassen.
    await sleep(800);
    found = await fetchYahooSearch(query);
  }
  return found ? pickYahooSymbol(found) : null;
}

// Kurs (mit TTL-Cache in `quotes`) holen; verändert das übergebene Objekt.
async function cachedYahooQuote(quotes, symbol, now) {
  const hit = quotes[symbol];
  if (hit && now - hit.at <= QUOTE_TTL_MS) return hit;
  await sleep(QUOTE_FETCH_DELAY_MS);
  const fresh = await fetchYahooQuote(symbol);
  if (!fresh) return hit || null; // lieber ein alter Kurs als gar keiner
  const entry = { ...fresh, at: now };
  quotes[symbol] = entry;
  return entry;
}

// Kurs eines Quote-Eintrags nach Euro bringen (FX aus demselben Cache).
async function quoteEur(quotes, qt, now) {
  const norm = normalizeQuoteCurrency(qt.currency);
  if (norm.currency === 'EUR' || norm.currency === null) {
    return convertToEur(qt.price, qt.currency, null);
  }
  const fx = await cachedYahooQuote(quotes, fxPairSymbol(norm.currency), now);
  return fx ? convertToEur(qt.price, qt.currency, fx.price) : null;
}

async function getCircleQuotes() {
  if (globalThis.DEBUG_SIMULATE && globalThis.DEBUG_SIMULATE.circle) {
    return { ok: false, error: 'TEST-Schalter aktiv (lib/debug.js)' };
  }
  const { circle } = await getState();
  if (!circle || !circle.modules) return { ok: false, error: 'Keine Circle-Daten' };

  const stored = await api.storage.local.get(['quoteSymbols', 'quotes']);
  const symbols = stored.quoteSymbols || {}; // moduleId -> {symbol|null, query, resolvedAt/failedAt}
  const quotes = stored.quotes || {};        // symbol -> {price, currency, at, …}
  const now = Date.now();
  const out = {};

  // Progressive Anzeige: `quotesLive` wird nach jedem ermittelten Kurs
  // geschrieben; das Popup lauscht per storage.onChanged und füllt die
  // jeweilige Zeile sofort — statt alles erst am Ende in einem Block.
  const isFresh = (q) => q && now - q.at <= QUOTE_TTL_MS;
  const round2 = (n) => Math.round(n * 100) / 100;

  // Vorbefüllung: alles, was ohne Netz-Abruf aus dem Cache beantwortbar ist,
  // sofort sichtbar machen — Nachzügler tröpfeln dann einzeln nach.
  for (const m of Object.values(circle.modules)) {
    const ti = m.titleInfo || parseModuleTitle(m.title || '');
    if (ti.kind === 'meta' || circleModuleClosed(m)) continue;
    const entry = symbols[m.id];
    if (!entry || entry.v !== SYMBOL_RESOLVE_VERSION || !entry.symbol) continue;
    const qt = quotes[entry.symbol];
    if (!isFresh(qt)) continue;
    const norm = normalizeQuoteCurrency(qt.currency);
    let priceEur;
    if (norm.currency === 'EUR' || norm.currency === null) {
      priceEur = convertToEur(qt.price, qt.currency, null);
    } else {
      const fx = quotes[fxPairSymbol(norm.currency)];
      priceEur = isFresh(fx) ? convertToEur(qt.price, qt.currency, fx.price) : null;
    }
    out[m.id] = {
      symbol: entry.symbol,
      price: qt.price,
      currency: qt.currency,
      priceEur: priceEur != null ? round2(priceEur) : null,
      at: qt.at,
    };
  }
  await api.storage.local.set({ quotesLive: out });

  for (const m of Object.values(circle.modules)) {
    const ti = m.titleInfo || parseModuleTitle(m.title || '');
    if (ti.kind === 'meta' || circleModuleClosed(m)) continue;

    // 1) Symbol auflösen (einmalig; Fehlschläge erst nach 24 h erneut).
    // Die Stammdaten der Module sind nicht immer sauber (live: Adidas-Modul
    // mit Allianz-ISIN) -> ISIN, WKN und Name werden ALLE probiert und der
    // Kandidat gewählt, dessen Kurs zum Titel-Tageskurs/EK der Position passt.
    let entry = symbols[m.id];
    const isStale =
      !entry ||
      entry.v !== SYMBOL_RESOLVE_VERSION ||
      (!entry.symbol && now - (entry.failedAt || 0) > SYMBOL_RETRY_MS);
    if (isStale) {
      const anchor =
        ti.currentPrice != null
          ? ti.currentPrice // Tageskurs laut Titel (je Aktie, €) — als Anker ideal
          : m.trade && m.trade.buyPriceEur != null
            ? m.trade.buyPriceEur
            : m.trade && m.trade.qty == null && m.trade.totalBuyEur != null
              ? m.trade.totalBuyEur // Format ohne Stück: Kaufpreis = Titeleinheit
              : null;
      const queries = [];
      if (m.trade && m.trade.isin) queries.push(m.trade.isin);
      if (m.trade && m.trade.wkn) queries.push(m.trade.wkn);
      if (ti.name) queries.push(ti.name);

      const seen = new Set();
      const candidates = [];
      for (const query of queries) {
        await sleep(QUOTE_FETCH_DELAY_MS);
        const symbol = await resolveYahooSymbol(query);
        if (!symbol || seen.has(symbol)) continue;
        seen.add(symbol);
        const qt = await cachedYahooQuote(quotes, symbol, now);
        const priceEur = qt ? await quoteEur(quotes, qt, now) : null;
        candidates.push({ symbol, priceEur, query });
        if (anchor == null) break; // ohne Anker entscheidet der erste Treffer
      }
      const best = pickPlausibleQuote(candidates, anchor);
      if (!best) {
        // Sichtbar machen, WORAN es scheiterte (Worker-Konsole via
        // chrome://extensions -> "Service Worker untersuchen").
        console.warn('[Kurse] Kein (plausibles) Yahoo-Symbol für "' + ti.name + '"',
          { versucht: queries, anker: anchor, kandidaten: candidates });
      }
      entry = best
        ? { symbol: best.symbol, query: best.query, resolvedAt: now, v: SYMBOL_RESOLVE_VERSION }
        : { symbol: null, failedAt: now, v: SYMBOL_RESOLVE_VERSION };
      symbols[m.id] = entry;
    }
    if (!entry.symbol) continue;

    // 2) Kurs holen (TTL-Cache) und nach Euro umrechnen.
    const qt = await cachedYahooQuote(quotes, entry.symbol, now);
    if (!qt) continue;
    const priceEur = await quoteEur(quotes, qt, now);

    out[m.id] = {
      symbol: entry.symbol,
      price: qt.price,
      currency: qt.currency,
      priceEur: priceEur != null ? round2(priceEur) : null,
      at: qt.at,
    };
    // Zwischenstand veröffentlichen -> die Zeile erscheint sofort im Popup.
    await api.storage.local.set({ quotesLive: out });
  }

  await api.storage.local.set({ quoteSymbols: symbols, quotes });
  return { ok: true, quotes: out };
}


// --- Event-Log-Sync (EVENTS.md) ------------------------------------------------
// Die Börsenampel schreibt Ereignisse (append-only) in einen Nutzer-eigenen
// Sync-Ordner. Ablauf: Poll erkennt Delta -> emitEvents() hängt an syncOutbox
// (mit fortlaufendem seq) -> flushOutbox() schreibt per Adapter. WebDAV läuft
// hier im Worker; der Adapter "lokaler Ordner" (File System Access API) ist nur
// in Seitenkontexten möglich -> der Worker markiert syncMeta.needsPageFlush und
// Popup/Standalone-Fenster schreiben (popup.js). Alles nur bei aktivem Schalter,
// nie bei DEBUG_SIMULATE, nie ohne erfolgreichen Poll (Privacy-Regel).
const SYNC_SNAPSHOT_MS = 24 * 60 * 60 * 1000;
const SYNC_AMPEL_SYMBOLS_PER_POLL = 3; // Namenssuchen je Poll (Yahoo-Drossel)

function syncActive(settings) {
  const sy = (settings && settings.sync) || {};
  if (!sy.enabled || !sy.producerId) return false;
  if (globalThis.DEBUG_SIMULATE && (globalThis.DEBUG_SIMULATE.ampel || globalThis.DEBUG_SIMULATE.circle)) return false;
  return true;
}

function appVersion() {
  try {
    if (globalThis.__appVersion) return String(globalThis.__appVersion);
    const mf = api.runtime.getManifest && api.runtime.getManifest();
    return mf && mf.version ? String(mf.version) : null;
  } catch (e) {
    return null;
  }
}

function producerInfo(settings) {
  const sy = (settings && settings.sync) || {};
  const isApp = !!globalThis.__appFireStartup;
  return {
    id: sy.producerId || null,
    kind: isApp ? 'app' : 'extension',
    label: sy.label || ('Börsenampel ' + (isApp ? 'App' : 'Add-on')),
    version: appVersion(),
  };
}

function makeProducerId() {
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function syncCtx(stored) {
  return { quotes: (stored && stored.quotes) || {}, quoteSymbols: (stored && stored.quoteSymbols) || {} };
}

// Alle Outbox-Änderungen laufen nacheinander (seq-Vergabe ist ein
// Read-Modify-Write auf storage.local).
let syncQueue = Promise.resolve();
function enqueueSync(fn) {
  const run = syncQueue.then(fn, fn);
  syncQueue = run.catch(() => {});
  return run;
}

// build(seq, producer, ctx) -> { events, nextSeq }
async function emitEvents(build) {
  return enqueueSync(async () => {
    const { settings } = await getState();
    if (!syncActive(settings)) return { ok: false, skipped: true };
    const stored = await api.storage.local.get(['syncOutbox', 'syncMeta', 'quotes', 'quoteSymbols']);
    const meta = stored.syncMeta || {};
    const producer = producerInfo(settings);
    const r = build((meta.seq || 0) + 1, producer, syncCtx(stored));
    if (!r || !r.events || !r.events.length) return { ok: true, added: 0 };
    let outbox = (stored.syncOutbox || []).concat(r.events);
    let lost = false;
    if (outbox.length > SYNC_OUTBOX_MAX) {
      outbox = outbox.slice(outbox.length - SYNC_OUTBOX_MAX);
      lost = true; // nächster Flush stellt ein Vollbild voran (needsSnapshot)
    }
    await api.storage.local.set({
      syncOutbox: outbox,
      syncMeta: Object.assign({}, meta, { seq: r.nextSeq - 1 }, lost ? { needsSnapshot: true } : null),
    });
    return { ok: true, added: r.events.length };
  });
}

async function syncOnAmpelDelta(delta) {
  const { settings } = await getState();
  if (!syncActive(settings)) return;
  await emitEvents((seq, producer, ctx) => eventsFromAmpelDelta(delta, { seq, producer, ctx, detectedAt: new Date().toISOString() }));
  flushOutbox().catch(() => {});
}

async function syncOnCircleDelta(fresh, modules, oldModules) {
  const { settings } = await getState();
  if (!syncActive(settings)) return;
  await emitEvents((seq, producer, ctx) => eventsFromCircleDelta(fresh, modules, { seq, producer, ctx, oldModules, detectedAt: new Date().toISOString() }));
  flushOutbox().catch(() => {});
}

// Vollbild: beim Aktivieren, bei Versionswechsel, nach Outbox-Verlust, sonst
// höchstens 1x/Tag; erzwungen durch "Jetzt synchronisieren".
async function maybeEmitSnapshot(force) {
  const state = await getState();
  if (!syncActive(state.settings)) return { ok: false, skipped: true };
  if (!(state.meta && state.meta.lastPollOk === true) || !state.current) return { ok: false, error: 'Kein erfolgreicher Ampel-Abruf' };
  const stored = await api.storage.local.get(['syncMeta']);
  const meta = stored.syncMeta || {};
  const version = appVersion();
  const due = force || meta.needsSnapshot || !meta.lastSnapshotAt ||
    Date.now() - meta.lastSnapshotAt > SYNC_SNAPSHOT_MS || meta.lastSnapshotVersion !== version;
  if (!due) return { ok: true, skipped: true };
  const circleOk = state.circleMeta && state.circleMeta.lastPollOk === true ? state.circle : null;
  const r = await emitEvents((seq, producer, ctx) => {
    const payload = buildAmpelPayload({ current: state.current, circle: circleOk }, ctx);
    const at = new Date().toISOString();
    return { events: [makeEvent('ampel.snapshot', payload, { producer, seq, at, detectedAt: at })], nextSeq: seq + 1 };
  });
  if (r && r.ok && !r.skipped) {
    const m = (await api.storage.local.get(['syncMeta'])).syncMeta || {};
    await api.storage.local.set({ syncMeta: Object.assign({}, m, { lastSnapshotAt: Date.now(), lastSnapshotVersion: version, needsSnapshot: false }) });
  }
  return r;
}

// Ampel-Aktien tragen keine ISIN/WKN -> Yahoo-Namenssuche ohne Anker, nur als
// unbestätigter Vorschlag (symbol.verified=false im Export). Häppchenweise,
// damit kein Poll spürbar bremst und Yahoo nicht drosselt.
async function resolveAmpelSymbolsSlowly() {
  const state = await getState();
  if (!syncActive(state.settings) || !state.current || !state.current.stocks) return;
  const stored = await api.storage.local.get(['quoteSymbols', 'quotes']);
  const symbols = stored.quoteSymbols || {};
  const quotes = stored.quotes || {};
  const now = Date.now();
  let done = 0;
  let changed = false;
  for (const st of sortedAmpelStocks(state.current)) {
    if (done >= SYNC_AMPEL_SYMBOLS_PER_POLL) break;
    if (hiddenPlaceholderTitle(st.name)) continue;
    const key = 'ampel:' + st.id;
    const entry = symbols[key];
    const stale = !entry || entry.v !== SYMBOL_RESOLVE_VERSION ||
      (!entry.symbol && now - (entry.failedAt || 0) > SYMBOL_RETRY_MS);
    if (!stale) continue;
    done++;
    await sleep(QUOTE_FETCH_DELAY_MS);
    const symbol = await resolveYahooSymbol(st.name);
    symbols[key] = symbol
      ? { symbol, query: st.name, resolvedAt: now, v: SYMBOL_RESOLVE_VERSION, via: 'name-search' }
      : { symbol: null, failedAt: now, v: SYMBOL_RESOLVE_VERSION };
    if (symbol) await cachedYahooQuote(quotes, symbol, now);
    changed = true;
  }
  if (changed) await api.storage.local.set({ quoteSymbols: symbols, quotes });
}

async function afterSuccessfulAmpelPoll() {
  const { settings } = await getState();
  if (!syncActive(settings)) return;
  await maybeEmitSnapshot(false);
  await flushOutbox();
  await resolveAmpelSymbolsSlowly();
}

function makeAdapter(sy) {
  if (sy.adapter === 'webdav') {
    const v = validateWebdavUrl(sy.url);
    if (!v.ok) return { error: v.error };
    return { adapter: createWebdavAdapter({ baseUrl: sy.url, user: sy.user, password: sy.password }) };
  }
  return { error: 'Adapter „' + sy.adapter + '“ wird im Hintergrund nicht unterstützt' };
}

let syncFlushInFlight = null;
function flushOutbox() {
  if (syncFlushInFlight) return syncFlushInFlight;
  syncFlushInFlight = doFlushOutbox().finally(() => { syncFlushInFlight = null; });
  return syncFlushInFlight;
}

async function doFlushOutbox() {
  const { settings } = await getState();
  if (!syncActive(settings)) return { ok: false, skipped: true };
  const sy = settings.sync;
  const stored = await api.storage.local.get(['syncOutbox', 'syncMeta']);
  if (!(stored.syncOutbox || []).length) return { ok: true, flushed: 0 };
  if (sy.adapter === 'folder') {
    // Nur Seitenkontexte können in den lokalen Ordner schreiben.
    await api.storage.local.set({ syncMeta: Object.assign({}, stored.syncMeta || {}, { needsPageFlush: true }) });
    return { ok: true, deferred: true };
  }
  const m = makeAdapter(sy);
  if (m.error) {
    await api.storage.local.set({ syncMeta: Object.assign({}, stored.syncMeta || {}, { lastError: m.error, lastErrorAt: Date.now() }) });
    return { ok: false, error: m.error };
  }
  return flushOutboxWith(m.adapter, api.storage.local, producerInfo(settings));
}

async function setSyncSettings(patch) {
  const { settings } = await getState();
  const cur = Object.assign({}, DEFAULTS.sync, settings.sync || {});
  const next = Object.assign({}, cur);
  for (const k of ['enabled', 'adapter', 'url', 'user', 'password', 'label']) {
    if (k in patch) next[k] = k === 'enabled' ? !!patch[k] : String(patch[k] == null ? '' : patch[k]);
  }
  if (next.adapter !== 'webdav' && next.adapter !== 'folder') next.adapter = 'webdav';
  next.url = next.url.trim();
  if (next.enabled && next.adapter === 'webdav') {
    const v = validateWebdavUrl(next.url);
    if (!v.ok) return { ok: false, error: v.error };
  }
  if (!next.producerId) next.producerId = makeProducerId();
  const wasEnabled = !!cur.enabled;
  await api.storage.local.set({ settings: Object.assign({}, settings, { sync: next }) });
  if (next.enabled && !wasEnabled) {
    // Frisch eingeschaltet -> sofort ein Vollbild.
    const m = (await api.storage.local.get(['syncMeta'])).syncMeta || {};
    await api.storage.local.set({ syncMeta: Object.assign({}, m, { needsSnapshot: true, lastError: null }) });
    maybeEmitSnapshot(true).then(() => flushOutbox()).catch(() => {});
  }
  return { ok: true, sync: publicSync(next) };
}

function publicSync(sy) {
  return Object.assign({}, sy, { password: sy.password ? '••••' : '', hasPassword: !!sy.password });
}

async function syncSelfTest() {
  const { settings } = await getState();
  const sy = Object.assign({}, DEFAULTS.sync, settings.sync || {});
  if (sy.adapter !== 'webdav') return { ok: false, error: 'Der Ordner-Test läuft im Popup' };
  const m = makeAdapter(sy);
  if (m.error) return { ok: false, error: m.error };
  const r = await m.adapter.selfTest();
  if (r.ok) {
    const meta = (await api.storage.local.get(['syncMeta'])).syncMeta || {};
    await api.storage.local.set({ syncMeta: Object.assign({}, meta, { formatWritten: true, lastError: null, lastErrorAt: null }) });
  }
  return r;
}

async function syncNow() {
  const { settings } = await getState();
  if (!syncActive(settings)) return { ok: false, error: 'Synchronisation ist ausgeschaltet' };
  const snap = await maybeEmitSnapshot(true);
  if (snap && snap.error) return { ok: false, error: snap.error };
  const r = await flushOutbox();
  return Object.assign({}, r, { status: await getSyncStatus() });
}

async function getSyncStatus() {
  const { settings } = await getState();
  const stored = await api.storage.local.get(['syncOutbox', 'syncMeta']);
  const meta = stored.syncMeta || {};
  return {
    ok: true,
    sync: publicSync(Object.assign({}, DEFAULTS.sync, settings.sync || {})),
    producer: producerInfo(settings),
    outboxCount: (stored.syncOutbox || []).length,
    seq: meta.seq || 0,
    lastFlushAt: meta.lastFlushAt || null,
    lastError: meta.lastError || null,
    lastErrorAt: meta.lastErrorAt || null,
    lastSnapshotAt: meta.lastSnapshotAt || null,
    needsPageFlush: !!meta.needsPageFlush,
  };
}

// Vollbild als Text (Support/Debug: "Snapshot kopieren" im Popup) — ohne
// Sync-Schalter nutzbar, aber ebenfalls nur eingeloggt.
async function syncSnapshotJson() {
  const state = await getState();
  if (!(state.meta && state.meta.lastPollOk === true) || !state.current) return { ok: false, error: 'Kein erfolgreicher Ampel-Abruf' };
  if (globalThis.DEBUG_SIMULATE && (globalThis.DEBUG_SIMULATE.ampel || globalThis.DEBUG_SIMULATE.circle)) return { ok: false, error: 'TEST-Schalter aktiv' };
  const stored = await api.storage.local.get(['quotes', 'quoteSymbols']);
  const circleOk = state.circleMeta && state.circleMeta.lastPollOk === true ? state.circle : null;
  const payload = buildAmpelPayload({ current: state.current, circle: circleOk }, syncCtx(stored));
  const at = new Date().toISOString();
  const ev = makeEvent('ampel.snapshot', payload, { producer: producerInfo(state.settings), seq: 0, at, detectedAt: at });
  return { ok: true, text: JSON.stringify(ev, null, 2) };
}

// --- Phase 2: Rich-Text-Body einer Aktie (Tier 2) -----------------------------
// Der Analyse-Text steckt NICHT im Kursbaum-JSON, sondern wird von Skool pro
// Modul geliefert (gleiches Muster wie die Circle-Bodies). Abruf auf Klick im
// Popup, gecacht in storage.local.stockBodies mit bodyUpdatedAt-Abgleich.
const STOCK_BODIES_MAX = 120; // Ampel hat ~40 Aktien; großzügig gedeckelt

// undefined = Route gescheitert (buildId veraltet?); null = Modul ohne Body.
async function fetchAmpelModuleDesc(buildId, id) {
  if (!buildId) return undefined;
  try {
    const res = await fetch(ampelDataUrl(buildId, id), {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return undefined;
    return findCourseDesc(await res.json(), id);
  } catch (e) {
    return undefined;
  }
}

async function getStockBody(id) {
  // Test-Schalter respektieren — sonst zeigt die Simulation "kein Zugang",
  // aber die Detailansicht würde weiterhin Bezahlinhalte liefern.
  if (globalThis.DEBUG_SIMULATE && globalThis.DEBUG_SIMULATE.ampel) {
    return { ok: false, error: 'TEST-Schalter aktiv (lib/debug.js)' };
  }
  const { current, meta } = await getState();
  const stock = current && current.stocks ? current.stocks[id] : null;
  const stored = (await api.storage.local.get('stockBodies')).stockBodies || {};
  const cached = stored[id];
  if (cached && stock && cached.bodyUpdatedAt === stock.updatedAt) {
    return { ok: true, text: cached.text, cached: true };
  }

  let desc = await fetchAmpelModuleDesc(meta.buildId || null, id);
  if (desc === undefined) {
    // buildId fehlt oder ist veraltet -> Modulseite als HTML holen; die trägt
    // den Body im __NEXT_DATA__ UND die frische buildId für kommende Abrufe.
    try {
      const res = await fetch(stockUrl(id), {
        credentials: 'include',
        headers: { 'Accept': 'text/html' },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const nextData = extractNextDataFromHtml(await res.text());
      if (nextData && nextData.buildId) await setMeta({ buildId: nextData.buildId });
      desc = findCourseDesc(nextData, id);
    } catch (e) {
      const msg = String(e.message || e);
      const access = /HTTP (401|403)/.test(msg) ? 'loggedOut' : 'error';
      return { ok: false, error: msg, access };
    }
  }
  if (desc === undefined) return { ok: false, error: 'Modul nicht gefunden (kein Zugang?)' };

  const text = desc === null ? null : proseMirrorText(desc);
  stored[id] = { text, bodyUpdatedAt: stock ? stock.updatedAt : null, fetchedAt: Date.now() };
  // Cache-Deckel: die am längsten nicht geholten Einträge verdrängen.
  const ids = Object.keys(stored);
  if (ids.length > STOCK_BODIES_MAX) {
    ids.sort((a, b) => (stored[a].fetchedAt || 0) - (stored[b].fetchedAt || 0));
    for (const drop of ids.slice(0, ids.length - STOCK_BODIES_MAX)) delete stored[drop];
  }
  await api.storage.local.set({ stockBodies: stored });
  return { ok: true, text };
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

// Bewusst NICHT "setInterval" nennen: eine Top-Level-Funktion dieses Namens
// würde das eingebaute setInterval überschreiben, das startBlink() braucht.
async function setPollInterval(minutes) {
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
  await cleanupHistoryOnce(); // Alt-Duplikate/Platzhalter-Käufe einmalig heilen
  await cleanupPlaceholdersOnce(); // "Neue Seite" aus dem Speicher löschen
  await setIcon(ICON_ON);
  await pollViaFetch(false); // beim Installieren nicht blinken
  await pollCircle();
});

api.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await cleanupHistoryOnce();
  await cleanupPlaceholdersOnce();
  await setIcon(ICON_ON);
  await pollViaFetch(false); // beim Browserstart nicht blinken
  await pollCircle();
});

api.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM) {
    await pollViaFetch(true); // Hintergrund-Abruf darf blinken
    await pollCircle(true);   // danach den Circle-Kurs, nacheinander bleibt es höflich
  }
});

// Klick auf eine Benachrichtigung öffnet die passende Kursseite.
api.notifications.onClicked.addListener((id) => {
  if (id.startsWith('ampel-')) api.tabs.create({ url: AMPEL_CONFIG.classroomUrl });
  if (id.startsWith('circle-')) api.tabs.create({ url: CIRCLE_CONFIG.classroomUrl });
});

// --- Fenster-Verwaltung: Charts + eigenständiges Circle-Fenster ----------------
// Rahmenlose type:'popup'-Fenster, die entstehen, WÄHREND das Action-Popup noch
// offen ist, hängt der Fenstermanager (beobachtet unter Linux) an das Popup und
// schließt sie mit ihm. Deshalb: das Popup hält einen Port; Fenster-Wünsche
// kommen über diesen Port (Zustellung vor dem Disconnect garantiert), das Popup
// schließt sich sofort selbst, und der Worker erzeugt die Fenster erst, wenn
// der Port getrennt — das Popup also wirklich zu — ist.
let popupPort = null;

function waitPopupClosed(timeoutMs = 400) {
  if (!popupPort) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeoutMs); // Sicherheitsnetz
    popupPort.onDisconnect.addListener(() => {
      clearTimeout(t);
      resolve();
    });
  });
}

// Das eigenständige Circle-Fenster ist die popup.html im Standalone-Modus —
// gleiche Ansicht, gleiche Daten, bleibt aber offen, bis der Nutzer es schließt.
// Die Fenster-ID liegt in storage.session (überlebt das Einschlafen des Workers),
// damit ein zweiter Aufruf das vorhandene Fenster fokussiert statt zu doppeln.
async function getCircleWindowId() {
  try {
    const s = await api.storage.session.get('circleWindowId');
    return s.circleWindowId != null ? s.circleWindowId : null;
  } catch (e) {
    return null;
  }
}

async function setCircleWindowId(id) {
  try { await api.storage.session.set({ circleWindowId: id }); } catch (e) { /* optional */ }
}

api.windows.onRemoved.addListener(async (id) => {
  if (id === await getCircleWindowId()) await setCircleWindowId(null);
});

async function openCircleWindow(pos) {
  await waitPopupClosed();
  const existing = await getCircleWindowId();
  if (existing != null) {
    try {
      await api.windows.update(existing, { focused: true });
      return;
    } catch (e) { await setCircleWindowId(null); } // Fenster gibt es nicht mehr
  }
  const createData = {
    url: api.runtime.getURL('popup.html') + '?standalone=1',
    type: 'popup', // rahmenlos wie das Add-on-Popup -> nahtloser Übergang
    width: 660,
    height: 620,
  };
  // An der Position des (soeben geschlossenen) Popups erscheinen lassen.
  if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
    createData.left = Math.max(0, Math.round(pos.left));
    createData.top = Math.max(0, Math.round(pos.top));
  }
  const win = await api.windows.create(createData);
  if (win && win.id != null) await setCircleWindowId(win.id);
}

async function createChartWindow(params) {
  // Nur eigene, bekannte Parameter übernehmen — keine fremden URLs.
  const allowed = ['symbol', 'name', 'buy', 'target', 'buyTs'];
  const qs = new URLSearchParams();
  for (const k of allowed) {
    const v = params && params[k];
    if (typeof v === 'string' && v) qs.set(k, v);
  }
  await api.windows.create({
    url: api.runtime.getURL('chart.html') + '?' + qs.toString(),
    type: 'popup',
    width: 560,
    height: 500,
  });
}

async function handleOpenChart(msg) {
  if (msg.spawnCircle) {
    // Erster Chart-Klick aus dem Popup: erst das Circle-Fenster als "Ersatz"
    // an der Popup-Position, dann den Chart fokussiert obendrauf.
    await openCircleWindow(msg.pos);
  } else {
    await waitPopupClosed();
  }
  await createChartWindow(msg.params);
}

api.runtime.onConnect.addListener((port) => {
  if (port.name !== 'popup') return;
  popupPort = port;
  port.onMessage.addListener((msg) => {
    if (msg && msg.type === 'openChart') handleOpenChart(msg);
    else if (msg && msg.type === 'openCircleWindow') openCircleWindow(msg.pos);
  });
  port.onDisconnect.addListener(() => {
    if (popupPort === port) popupPort = null;
  });
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
        // Bei aktivem Test-Schalter ignorieren, sonst hebelt ein offener
        // Ampel-Tab die Simulation sofort wieder aus.
        if (globalThis.DEBUG_SIMULATE && globalThis.DEBUG_SIMULATE.ampel) {
          sendResponse({ ok: false, error: 'TEST-Schalter aktiv (lib/debug.js)' });
          break;
        }
        await ingestSnapshot(msg.snapshot, 'page', true);
        sendResponse({ ok: true });
        break;
      }
      case 'openChart': {
        // Direktweg des Standalone-Fensters (das Popup nutzt den Port, s. o.).
        await handleOpenChart(msg);
        sendResponse({ ok: true });
        break;
      }
      case 'circleQuotes': {
        sendResponse(await getCircleQuotes());
        break;
      }
      case 'getStockBody': {
        sendResponse(await getStockBody(msg.id));
        break;
      }
      case 'circlePollNow': {
        // Vom Popup beim Öffnen des Circle-Tabs ausgelöst -> nicht blinken.
        const r = await pollCircle(false);
        const state = await getState();
        sendResponse({ ...r, circle: state.circle, circleMeta: state.circleMeta, circleHistory: state.circleHistory });
        break;
      }
      case 'circleSeen': {
        // Nutzer hat den Circle-Tab gesehen -> goldenen Punkt löschen.
        await setCircleMeta({ pending: 0 });
        await refreshIcon();
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
        await setPollInterval(msg.minutes);
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
      case 'setSync': {
        sendResponse(await setSyncSettings(msg.patch || {}));
        break;
      }
      case 'syncTest': {
        sendResponse(await syncSelfTest());
        break;
      }
      case 'syncNow': {
        sendResponse(await syncNow());
        break;
      }
      case 'getSyncStatus': {
        sendResponse(await getSyncStatus());
        break;
      }
      case 'syncFlushed': {
        // Ein Seitenkontext (Popup/Standalone) hat die Outbox in den lokalen
        // Ordner geschrieben bzw. ist dabei gescheitert -> nur Status spiegeln.
        sendResponse(await getSyncStatus());
        break;
      }
      case 'syncSnapshotJson': {
        sendResponse(await syncSnapshotJson());
        break;
      }
      default:
        sendResponse({ ok: false, error: 'unknown message' });
    }
  })();
  return true; // async sendResponse
});
