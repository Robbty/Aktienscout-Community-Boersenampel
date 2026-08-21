/*
 * runner.js — Hintergrund-Polling (Capacitor Background Runner).
 *
 * Läuft in einer EIGENEN JS-Umgebung (kein DOM, keine WebView, kein Zugriff
 * auf den Shim-Storage). Der Build (build-www.mjs) konkateniert lib/ampel.js
 * und lib/circle.js VOR diese Datei -> extractNextDataFromHtml, buildSnapshot,
 * diffSnapshots, buildCircleIndex, diffCircleModules usw. sind verfügbar.
 *
 * Bewusste Entkopplung: der Runner hält seinen EIGENEN Vergleichsstand in
 * CapacitorKV und dient nur den Benachrichtigungen. Beim Öffnen pollt die
 * WebView ohnehin selbst und zeigt den echten Diff gegen die Baseline.
 *
 * KV-Schlüssel: enabled ('1'/'0'), cookie (String), intervalMinutes,
 * lastRunAt, ampelSnap (JSON), circleMods (JSON), loggedOutNotified.
 */

var RUNNER_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';

function kvGet(key) {
  try {
    var r = CapacitorKV.get(key);
    return r && r.value != null ? r.value : null;
  } catch (e) {
    return null;
  }
}

function kvSet(key, value) {
  try { CapacitorKV.set(key, String(value)); } catch (e) { /* best effort */ }
}

function notify(id, title, body) {
  try {
    CapacitorNotifications.schedule([{ id: id, title: title, body: body }]);
  } catch (e) { /* ohne Permission still bleiben */ }
}

async function fetchPage(url, cookie) {
  var res = await fetch(url, {
    headers: { 'Accept': 'text/html', 'Cookie': cookie, 'User-Agent': RUNNER_UA },
  });
  return { status: res.status, html: res.status === 200 ? await res.text() : '' };
}

// Ampel: Snapshot-Diff gegen den KV-Stand -> eine Sammel-Benachrichtigung.
function checkAmpel(html) {
  var nextData = extractNextDataFromHtml(html);
  if (classifyAmpelAccess(nextData) !== 'ok') return;
  var snap = buildSnapshot(nextData);
  if (!snap || !snap.stockCount) return;
  var oldRaw = kvGet('ampelSnap');
  kvSet('ampelSnap', JSON.stringify(snap));
  if (!oldRaw) return; // erster Lauf: nur Stand merken
  var delta = diffSnapshots(JSON.parse(oldRaw), snap);
  var n = diffCount(delta);
  if (!n) return;
  var parts = [];
  var take = function (list, fmt) {
    for (var i = 0; i < list.length && parts.length < 4; i++) parts.push(fmt(list[i]));
  };
  take(delta.moved, function (s) { return s.name + ' → ' + (s.to || ''); });
  take(delta.added, function (s) { return s.name + ' neu'; });
  take(delta.removed, function (s) { return s.name + ' entfernt'; });
  notify(101, 'Börsenampel: ' + n + ' Änderung' + (n === 1 ? '' : 'en'),
    parts.join('\n') || 'Es gab Änderungen.');
}

// Circle: Nur-Titel-Diff (Kauf/Verkauf erkennbar am Titel; Beträge stehen in
// den Bodies, die der Runner bewusst nicht erntet).
function checkCircle(html) {
  var nextData = extractNextDataFromHtml(html);
  var index = buildCircleIndex(nextData);
  if (classifyCircleAccess(index) !== 'ok') return;
  var mods = {};
  var list = Object.values(index.modules);
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    mods[m.id] = { id: m.id, title: m.title, updatedAt: m.updatedAt, trade: null };
  }
  var oldRaw = kvGet('circleMods');
  kvSet('circleMods', JSON.stringify(mods));
  if (!oldRaw) return;
  var events = diffCircleModules(JSON.parse(oldRaw), mods);
  if (!events.length) return;
  var lines = [];
  for (var j = 0; j < events.length && lines.length < 4; j++) {
    var e = events[j];
    var label = e.type === 'bought' ? 'Kauf' : e.type === 'sold' ? 'Verkauf' : 'Entfernt';
    lines.push(label + ': ' + e.name);
  }
  notify(102, 'Circle: ' + events.length + ' Ereignis' + (events.length === 1 ? '' : 'se'),
    lines.join('\n'));
}

async function doPoll() {
  if (kvGet('enabled') !== '1') return;
  var cookie = kvGet('cookie') || '';
  if (!cookie) return;

  // Nutzer-Intervall respektieren (der Runner selbst feuert fest alle 60 min).
  var interval = Math.max(15, Number(kvGet('intervalMinutes')) || 60);
  var last = Number(kvGet('lastRunAt')) || 0;
  if (Date.now() - last < interval * 60 * 1000 - 60 * 1000) return;
  kvSet('lastRunAt', Date.now());

  var ampel = await fetchPage(AMPEL_CONFIG.classroomUrl, cookie);
  if (ampel.status === 401 || ampel.status === 403) {
    // Session abgelaufen: einmalig melden, Vergleichsstand NICHT anfassen.
    if (kvGet('loggedOutNotified') !== '1') {
      kvSet('loggedOutNotified', '1');
      notify(100, 'Börsenampel', 'Skool-Anmeldung abgelaufen — bitte in der App neu anmelden.');
    }
    return;
  }
  if (ampel.status !== 200) return; // technischer Fehler -> nächster Lauf
  kvSet('loggedOutNotified', '0');
  try { checkAmpel(ampel.html); } catch (e) { /* Parser-Fehler -> still */ }

  var circle = await fetchPage(CIRCLE_CONFIG.classroomUrl, cookie);
  if (circle.status === 200) {
    try { checkCircle(circle.html); } catch (e) { /* still */ }
  }
}

// Die App überträgt Config-Änderungen (Login-Cookie, Toggle, Intervall).
addEventListener('saveConfig', function (resolve, reject, args) {
  try {
    if (args && args.cookie != null) kvSet('cookie', args.cookie);
    if (args && args.enabled != null) kvSet('enabled', args.enabled ? '1' : '0');
    if (args && args.intervalMinutes != null) kvSet('intervalMinutes', args.intervalMinutes);
    if (args && args.enabled) kvSet('loggedOutNotified', '0');
    resolve();
  } catch (e) {
    reject(e);
  }
});

addEventListener('poll', function (resolve) {
  // Fehler bewusst schlucken: ein kaputter Lauf darf die Job-Kette nicht stoppen.
  doPoll().then(resolve, function () { resolve(); });
});
