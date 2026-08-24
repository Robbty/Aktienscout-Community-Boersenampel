/*
 * ampel.js — geteilte Parsing- und Diff-Logik.
 *
 * Wird in drei Kontexten geladen, deshalb bewusst KEIN ES-Modul:
 *   - Service-Worker via importScripts('lib/ampel.js')
 *   - Content-Script (als erstes Script im content_scripts-Array)
 *   - Popup via <script src="lib/ampel.js">
 * Alle Funktionen liegen global (self / window).
 */

// --- Konfiguration der überwachten Skool-Quelle -----------------------------
const AMPEL_CONFIG = {
  community: 'cybermoney-1123',
  course: '8d4e7683',
};

AMPEL_CONFIG.classroomUrl =
  'https://www.skool.com/' + AMPEL_CONFIG.community + '/classroom/' + AMPEL_CONFIG.course;

// Fester Affiliate-Link für den VIP-Hinweis ohne Zugang (bewusst NICHT
// konfigurierbar).
AMPEL_CONFIG.joinUrl =
  'https://www.skool.com/cybermoney-1123/about?ref=5a2ff2ee6a214a479e3713e9b2d2bc5f';

// URL für eine einzelne Aktie (zum Öffnen im Skool-Classroom)
function stockUrl(id) {
  return AMPEL_CONFIG.classroomUrl + '?md=' + id;
}

// Next.js-Datenroute der Ampel-Kursseite (gleiches Muster wie circleDataUrl):
// liefert das Kurs-JSON, in dem genau das per md angefragte Modul seinen
// Rich-Text-Body (metadata.desc) trägt. buildId wechselt bei Skool-Deploys.
function ampelDataUrl(buildId, id) {
  return (
    'https://www.skool.com/_next/data/' + buildId + '/' + AMPEL_CONFIG.community +
    '/classroom/' + AMPEL_CONFIG.course + '.json' + (id ? '?md=' + id : '')
  );
}

// Body (metadata.desc) eines Moduls im Kursbaum finden — rekursiv, damit es
// für die zweistufige Ampel (Sektion -> Aktie) und flache Kurse gleichermaßen
// funktioniert. Akzeptiert HTML-__NEXT_DATA__ ({props:{pageProps}}) und die
// _next/data-Form ({pageProps}).
// Rückgabe: String = Body, null = Modul da aber ohne Body, undefined = Modul
// nicht im Baum (z. B. kein Zugang / falsche Antwort).
function findCourseDesc(nextData, id) {
  const pp =
    (nextData && nextData.props && nextData.props.pageProps) ||
    (nextData && nextData.pageProps);
  const root = pp && pp.course;
  if (!root) return undefined;
  let found;
  (function walk(node) {
    if (!node || found !== undefined) return;
    const c = node.course;
    if (c && c.id === id) {
      const desc = c.metadata && c.metadata.desc;
      found = typeof desc === 'string' && desc ? desc : null;
      return;
    }
    for (const child of node.children || []) walk(child);
  })(root);
  return found;
}

// --- Farb-Normalisierung ----------------------------------------------------
// Skool kennt keine Farbe als Feld; sie ergibt sich aus dem Sektion-Titel.
function ampelColor(sectionTitle) {
  const t = (sectionTitle || '').toLowerCase();
  if (t.includes('grün') || t.includes('gruen')) return 'green';
  if (t.includes('gelb')) return 'yellow';
  if (t.includes('rot')) return 'red';
  return 'other';
}

// --- __NEXT_DATA__ aus rohem HTML ziehen (Service-Worker hat kein DOMParser) -
function extractNextDataFromHtml(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    return null;
  }
}

// --- Zugangs-Klassifizierung --------------------------------------------------
// 'ok' | 'noAccess' | 'loggedOut' — analog zu classifyCircleAccess (circle.js).
// Die Menüpunkte tragen metadata.hasAccess (live geprüft): eingeloggt als
// Mitglied ist mindestens einer freigeschaltet. Im Zweifel 'loggedOut' -> das
// Popup zeigt dann den Login-Hinweis statt gecachter Daten.
function classifyAmpelAccess(nextData) {
  const pp = nextData && nextData.props && nextData.props.pageProps;
  const root = pp && pp.course;
  if (!root || !root.course) return 'loggedOut';
  const sections = root.children || [];
  const anyAccess = sections.some(
    (s) => s.course && s.course.metadata &&
      (s.course.metadata.hasAccess === 1 || s.course.metadata.hasAccess === true),
  );
  if (!sections.length || !anyAccess) return 'noAccess';
  return 'ok';
}

// --- "Neue Seite"-Platzhalter -----------------------------------------------
// Der Autor legt leere Module unter dem Skool-Standardtitel "Neue Seite" an
// (live: mehrere auf Menüpunkt-Ebene der Ampel) und benennt sie erst später um.
// Solche Einträge sollen NIRGENDS auftauchen — nicht als Menüpunkt/Aktie, nicht
// in Diffs ("Änderungen seit letztem Besuch"), nicht im Statuswechsel-Logbuch
// und nicht in Benachrichtigungen. Gleiche Regel wie circleHiddenTitle in
// circle.js — bewusst dupliziert, weil beide Libs unabhängig ladbar sind.
function hiddenPlaceholderTitle(name) {
  return /^neue seite$/i.test(String(name || '').trim());
}

// --- Snapshot aus dem __NEXT_DATA__-JSON bauen ------------------------------
// Liefert ein flaches, vergleichbares Abbild des aktuellen Ampel-Zustands.
function buildSnapshot(nextData) {
  const pp = nextData && nextData.props && nextData.props.pageProps;
  const root = pp && pp.course;
  if (!root || !root.course) return null;

  const stocks = {};
  const sections = {}; // map id -> Sektion (Menüpunkt) inkl. Info-Seiten ohne Aktien
  let count = 0;
  for (const section of root.children || []) {
    const sectionTitle = section.course.metadata.title;
    if (hiddenPlaceholderTitle(sectionTitle)) continue; // leere "Neue Seite" überspringen
    const childCount = (section.children || []).length;
    sections[section.course.id] = {
      id: section.course.id,
      title: sectionTitle,
      color: ampelColor(sectionTitle),
      updatedAt: section.course.updatedAt,
      hasStocks: childCount > 0,
    };
    for (const st of section.children || []) {
      const id = st.course.id;
      if (hiddenPlaceholderTitle(st.course.metadata.title)) continue;
      stocks[id] = {
        id,
        name: st.course.metadata.title,
        section: sectionTitle,
        color: ampelColor(sectionTitle),
        updatedAt: st.course.updatedAt,
      };
      count++;
    }
  }

  return {
    courseTitle: root.course.metadata.title,
    courseUpdatedAt: root.course.updatedAt,
    stockCount: count,
    stocks, // map id -> stock
    sections, // map id -> section
  };
}

// Gespeicherte Snapshots älterer Versionen von "Neue Seite"-Platzhaltern
// befreien (einmalige Migration in background.js — buildSnapshot filtert sie
// inzwischen an der Quelle). Liefert den Snapshot unverändert zurück, wenn
// nichts zu bereinigen ist.
function stripHiddenFromSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return snap;
  let changed = false;
  const stocks = {};
  for (const id of Object.keys(snap.stocks || {})) {
    if (hiddenPlaceholderTitle(snap.stocks[id].name)) { changed = true; continue; }
    stocks[id] = snap.stocks[id];
  }
  const sections = {};
  for (const id of Object.keys(snap.sections || {})) {
    if (hiddenPlaceholderTitle(snap.sections[id].title)) { changed = true; continue; }
    sections[id] = snap.sections[id];
  }
  if (!changed) return snap;
  const out = { ...snap, stocks, stockCount: Object.keys(stocks).length };
  if (snap.sections) out.sections = sections;
  return out;
}

// Snapshot direkt aus einem geladenen Dokument (Content-Script-Pfad).
function buildSnapshotFromDocument(doc) {
  const el = doc.getElementById('__NEXT_DATA__');
  if (!el) return null;
  let json;
  try {
    json = JSON.parse(el.textContent);
  } catch (e) {
    return null;
  }
  return buildSnapshot(json);
}

// --- Diff zwischen zwei Snapshots -------------------------------------------
// old/new sind Snapshots (oder null). Liefert die vier Änderungsarten.
function diffSnapshots(oldSnap, newSnap) {
  const result = {
    added: [], removed: [], moved: [], edited: [],
    sectionAdded: [], sectionRemoved: [], sectionEdited: [],
  };
  if (!newSnap) return result;
  const oldStocks = (oldSnap && oldSnap.stocks) || {};
  const newStocks = newSnap.stocks || {};

  // "Neue Seite"-Platzhalter auf BEIDEN Seiten ignorieren: neue Snapshots sind
  // durch buildSnapshot schon sauber, aber gespeicherte Altstände (baseline/
  // current aus früheren Versionen) könnten sie noch enthalten — ohne den
  // Filter gäbe es einmalige "Entfernt"-Fehlalarme.
  for (const id of Object.keys(newStocks)) {
    const n = newStocks[id];
    if (hiddenPlaceholderTitle(n.name)) continue;
    const o = oldStocks[id];
    if (!o) {
      result.added.push({ ...n });
    } else if (o.color !== n.color) {
      result.moved.push({ ...n, from: o.color, fromSection: o.section, to: n.color });
    } else if (o.updatedAt !== n.updatedAt) {
      result.edited.push({ ...n, prevUpdatedAt: o.updatedAt });
    }
  }
  for (const id of Object.keys(oldStocks)) {
    if (hiddenPlaceholderTitle(oldStocks[id].name)) continue;
    if (!newStocks[id]) result.removed.push({ ...oldStocks[id] });
  }

  // Sektionen (Menüpunkte) vergleichen — nur wenn der alte Snapshot sie schon
  // kennt, sonst gäbe es nach einem Update Fehlalarme ("alles neu").
  if (oldSnap && oldSnap.sections && newSnap.sections) {
    const oldSec = oldSnap.sections;
    const newSec = newSnap.sections;
    for (const id of Object.keys(newSec)) {
      const n = newSec[id];
      if (hiddenPlaceholderTitle(n.title)) continue;
      const o = oldSec[id];
      if (!o) {
        result.sectionAdded.push({ ...n });
      } else if (!n.hasStocks && o.updatedAt !== n.updatedAt) {
        // Inhaltsänderung einer Info-Seite (Aktien-Wechsel deckt Ampeln bereits ab).
        result.sectionEdited.push({ ...n, prevUpdatedAt: o.updatedAt });
      }
    }
    for (const id of Object.keys(oldSec)) {
      if (hiddenPlaceholderTitle(oldSec[id].title)) continue;
      if (!newSec[id]) result.sectionRemoved.push({ ...oldSec[id] });
    }
  }
  return result;
}

// Logbuch auf max Einträge begrenzen und dabei die ältesten ÄNDERUNGEN
// (nach Datum `at`, nicht nach Einfügereihenfolge) zuerst verwerfen.
function pruneHistory(history, max) {
  if (!Array.isArray(history) || history.length <= max) return history;
  return history
    .slice()
    .sort((a, b) => (Date.parse(a.at) || 0) - (Date.parse(b.at) || 0)) // älteste zuerst
    .slice(history.length - max); // die ältesten nach Änderungsdatum fallen weg
}

// Fachlicher Schlüssel eines Logbuch-Eintrags: dasselbe Ereignis am selben Modul
// zum selben Skool-Zeitpunkt ist ein Duplikat, egal wann wir es erkannt haben
// (detectedAt bleibt außen vor).
function historyKey(e) {
  return [e.id || '', e.type || '', e.at || ''].join('|');
}

// Neue Ereignisse anhängen, aber bereits vorhandene (gleicher Schlüssel) still
// verwerfen — heilt überlappende Polls und Worker-Neustarts nachträglich.
function appendUniqueHistory(existing, incoming, max) {
  const seen = new Set((existing || []).map(historyKey));
  const fresh = (incoming || []).filter((e) => !seen.has(historyKey(e)));
  if (!fresh.length) return existing || [];
  return pruneHistory((existing || []).concat(fresh), max);
}

// Bestehende Duplikate entfernen (der zuerst geschriebene Eintrag gewinnt,
// d. h. das früheste detectedAt bleibt stehen).
function dedupeHistory(history) {
  const seen = new Set();
  return (history || []).filter((e) => {
    const k = historyKey(e);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function diffCount(diff) {
  if (!diff) return 0;
  return (
    diff.added.length + diff.removed.length + diff.moved.length + diff.edited.length +
    diff.sectionAdded.length + diff.sectionRemoved.length + diff.sectionEdited.length
  );
}

// In Service-Worker, Content-Script und Popup gleichermaßen erreichbar machen.
if (typeof globalThis !== 'undefined') {
  globalThis.AMPEL_CONFIG = AMPEL_CONFIG;
  globalThis.stockUrl = stockUrl;
  globalThis.ampelDataUrl = ampelDataUrl;
  globalThis.findCourseDesc = findCourseDesc;
  globalThis.ampelColor = ampelColor;
  globalThis.extractNextDataFromHtml = extractNextDataFromHtml;
  globalThis.classifyAmpelAccess = classifyAmpelAccess;
  globalThis.hiddenPlaceholderTitle = hiddenPlaceholderTitle;
  globalThis.stripHiddenFromSnapshot = stripHiddenFromSnapshot;
  globalThis.buildSnapshot = buildSnapshot;
  globalThis.buildSnapshotFromDocument = buildSnapshotFromDocument;
  globalThis.diffSnapshots = diffSnapshots;
  globalThis.diffCount = diffCount;
  globalThis.pruneHistory = pruneHistory;
  globalThis.historyKey = historyKey;
  globalThis.appendUniqueHistory = appendUniqueHistory;
  globalThis.dedupeHistory = dedupeHistory;
}
