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

  for (const id of Object.keys(newStocks)) {
    const n = newStocks[id];
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
    if (!newStocks[id]) result.removed.push({ ...oldStocks[id] });
  }

  // Sektionen (Menüpunkte) vergleichen — nur wenn der alte Snapshot sie schon
  // kennt, sonst gäbe es nach einem Update Fehlalarme ("alles neu").
  if (oldSnap && oldSnap.sections && newSnap.sections) {
    const oldSec = oldSnap.sections;
    const newSec = newSnap.sections;
    for (const id of Object.keys(newSec)) {
      const n = newSec[id];
      const o = oldSec[id];
      if (!o) {
        result.sectionAdded.push({ ...n });
      } else if (!n.hasStocks && o.updatedAt !== n.updatedAt) {
        // Inhaltsänderung einer Info-Seite (Aktien-Wechsel deckt Ampeln bereits ab).
        result.sectionEdited.push({ ...n, prevUpdatedAt: o.updatedAt });
      }
    }
    for (const id of Object.keys(oldSec)) {
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
  globalThis.ampelColor = ampelColor;
  globalThis.extractNextDataFromHtml = extractNextDataFromHtml;
  globalThis.classifyAmpelAccess = classifyAmpelAccess;
  globalThis.buildSnapshot = buildSnapshot;
  globalThis.buildSnapshotFromDocument = buildSnapshotFromDocument;
  globalThis.diffSnapshots = diffSnapshots;
  globalThis.diffCount = diffCount;
  globalThis.pruneHistory = pruneHistory;
}
