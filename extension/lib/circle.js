/*
 * circle.js — Parsing- und Portfolio-Logik für "Circle Aktienengagement Echtzeit".
 *
 * Wie ampel.js bewusst KEIN ES-Modul: wird via importScripts (Chrome-SW),
 * background.scripts (Firefox) und <script> (Popup) geladen; alle Funktionen
 * liegen auf globalThis.
 *
 * Datenlage (verifiziert): Die Beträge stehen NUR im Rich-Text-Body der Module.
 * Der Body ist im Kursbaum ausschließlich für das per ?md=<id> ausgewählte Modul
 * gefüllt (children[i].course.metadata.desc, Format "[v2][{ProseMirror-JSON}]").
 * Titel-Konvention des Autors: "Name [57,75 € ]" = laufende Position; der
 * eingeklammerte Preis ist der geplante VERKAUFSKURS (Kursziel, meist +10 %
 * auf den Einkauf) — NICHT der aktuelle Börsenkurs. "Name [8 Tage]" =
 * verkauft nach 8 Tagen. (Feldname currentPrice bleibt aus Kompatibilität
 * mit gespeicherten Daten erhalten, gemeint ist das Kursziel.)
 */

// --- Konfiguration der überwachten Skool-Quelle -----------------------------
const CIRCLE_CONFIG = {
  community: 'der-circle-zur-ersten-million-6426',
  course: '93493889',
  displayName: 'Circle Aktienengagement Echtzeit',
  // Fester Affiliate-Link für den Beitritts-Hinweis ohne Zugang (bewusst
  // NICHT konfigurierbar).
  joinUrl: 'https://www.skool.com/der-circle-zur-ersten-million-6426/about?ref=5a2ff2ee6a214a479e3713e9b2d2bc5f',
};

CIRCLE_CONFIG.classroomUrl =
  'https://www.skool.com/' + CIRCLE_CONFIG.community + '/classroom/' + CIRCLE_CONFIG.course;

// URL eines einzelnen Moduls (zum Öffnen im Skool-Classroom)
function circleModuleUrl(id) {
  return CIRCLE_CONFIG.classroomUrl + '?md=' + id;
}

// Next.js-Datenroute: liefert das JSON der Kursseite, in dem genau das per
// md angefragte Modul seinen Body (metadata.desc) trägt. buildId wechselt bei
// Skool-Deploys und muss dann frisch aus dem HTML gelesen werden.
function circleDataUrl(buildId, id) {
  return (
    'https://www.skool.com/_next/data/' + buildId + '/' + CIRCLE_CONFIG.community +
    '/classroom/' + CIRCLE_CONFIG.course + '.json' + (id ? '?md=' + id : '')
  );
}

// --- Zahlen im deutschen Format ----------------------------------------------
// "1.234,56" / "509" / "57,75" -> Number; sonst null. Der Autor schreibt auch
// mal "3.39" mit Dezimal-PUNKT: ein einzelner Punkt mit 1–2 Nachkommastellen
// (ohne Komma) kann kein Tausendertrenner sein und wird als Dezimalzeichen gelesen.
function parseGermanNumber(s) {
  if (typeof s === 'number') return isFinite(s) ? s : null;
  if (typeof s !== 'string') return null;
  const cleaned = s.replace(/[^\d.,\-]/g, '');
  if (!/\d/.test(cleaned)) return null;
  let n;
  if (/^-?\d+\.\d{1,2}$/.test(cleaned)) {
    n = Number(cleaned); // Dezimalpunkt-Schreibweise ("3.39")
  } else {
    n = Number(cleaned.replace(/\./g, '').replace(',', '.'));
  }
  return isFinite(n) ? n : null;
}

// Deutsches Datum "3.8.26" / "03.08.2026" -> Timestamp (lokale Mitternacht),
// sonst null. Zweistellige Jahre werden als 20xx gelesen.
function parseGermanDate(s) {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (m[3].length <= 2) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  // Überlauf abfangen (31.02. -> 3. März): dann war das Datum ungültig.
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d.getTime();
}

// --- Modultitel deuten --------------------------------------------------------
// Die Klammern des Autors sind unsauber ("(177,63€ ]", "[10 Tage)"), deshalb
// werden [ ( und ] ) austauschbar akzeptiert.
// Ergebnis: { name, kind: 'open'|'closed'|'meta'|'plain', currentPrice?, holdingDays? }
// currentPrice = das Kursziel aus dem Titel (siehe Kopfkommentar).
function parseModuleTitle(title) {
  const t = String(title || '').trim();
  if (/statistik/i.test(t)) return { name: t, kind: 'meta' };

  const days = t.match(/[\[(]\s*(\d+)\s*Tag(?:e|en)?\s*[\])]/i);
  if (days) {
    return {
      name: t.replace(days[0], '').replace(/\s{2,}/g, ' ').trim(),
      kind: 'closed',
      holdingDays: Number(days[1]),
    };
  }

  const price = t.match(/[\[(]\s*([\d.,]+)\s*€\s*[\])]/);
  if (price) {
    return {
      name: t.replace(price[0], '').replace(/\s{2,}/g, ' ').trim(),
      kind: 'open',
      currentPrice: parseGermanNumber(price[1]),
    };
  }

  return { name: t, kind: 'plain' };
}

// --- ProseMirror-Body ("[v2][…]") zu reinem Text -------------------------------
// Absätze -> Zeilen, hardBreak -> Zeilenumbruch. Bei kaputtem JSON: null.
function proseMirrorText(desc) {
  if (typeof desc !== 'string' || !desc) return null;
  const body = desc.startsWith('[v2]') ? desc.slice(4) : desc;
  let nodes;
  try {
    nodes = JSON.parse(body);
  } catch (e) {
    return null;
  }
  if (!Array.isArray(nodes)) return null;

  function collect(node, acc) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text' && typeof node.text === 'string') acc.push(node.text);
    if (node.type === 'hardBreak') acc.push('\n');
    for (const child of node.content || []) collect(child, acc);
  }

  const lines = [];
  for (const n of nodes) {
    const acc = [];
    collect(n, acc);
    lines.push(acc.join(''));
  }
  return lines.join('\n');
}

// --- Kursbaum-Index -----------------------------------------------------------
// Akzeptiert beide Antwortformen: HTML-__NEXT_DATA__ ({props:{pageProps:…}})
// und die _next/data-Route ({pageProps:…}). Bereits gefüllte Bodies (descs)
// werden gleich mit eingesammelt.
function buildCircleIndex(nextData) {
  const pp =
    (nextData && nextData.props && nextData.props.pageProps) ||
    (nextData && nextData.pageProps);
  const root = pp && pp.course;
  if (!root || !root.course) return null;

  const modules = {};
  const descs = {};
  for (const child of root.children || []) {
    const c = child.course;
    if (!c || !c.id) continue;
    const meta = c.metadata || {};
    modules[c.id] = {
      id: c.id,
      title: meta.title || '',
      updatedAt: c.updatedAt || null,
      hasAccess: meta.hasAccess === 1 || meta.hasAccess === true,
    };
    if (typeof meta.desc === 'string' && meta.desc) descs[c.id] = meta.desc;
  }

  return {
    courseTitle: (root.course.metadata && root.course.metadata.title) || '',
    courseUpdatedAt: root.course.updatedAt || null,
    modules,
    descs,
  };
}

// --- Zugangs-Klassifizierung ----------------------------------------------------
// 'ok' | 'noAccess' | 'loggedOut'. Im Zweifel 'loggedOut' -> das Popup zeigt dann
// den Login-Hinweis statt gecachter Bezahldaten.
function classifyCircleAccess(index) {
  if (!index) return 'loggedOut';
  const mods = Object.values(index.modules || {});
  if (!mods.length || !mods.some((m) => m.hasAccess)) return 'noAccess';
  return 'ok';
}

// --- Trade-Daten aus dem Body-Text ziehen ---------------------------------------
// Jede Zeile ist optional; was nicht da ist, bleibt weg. Bei Dollar-Trades wird
// der €-Betrag bevorzugt aus der Klammer gelesen ("zu 48,88 $ (42,32 €)").
// Liefert null, wenn gar keine Kauf-/Stück-Daten erkennbar sind.
function parseTradeBody(text) {
  if (typeof text !== 'string' || !text) return null;
  const t = text.replace(/\u00a0/g, " "); // geschützte Leerzeichen normalisieren
  const out = { closed: false };

  const wkn = t.match(/WKN:\s*([A-Z0-9]+)/i);
  if (wkn) out.wkn = wkn[1];
  const isin = t.match(/ISIN:\s*([A-Z]{2}[A-Z0-9]{9,10})/i);
  if (isin) out.isin = isin[1];
  const ticker = t.match(/Ticker:\s*([A-Z0-9.\-]+)/i);
  if (ticker) out.ticker = ticker[1];

  // Euro-Betrag aus dem Rest einer Kauf-/Verkaufszeile: Klammer-Form gewinnt
  // (Dollar-Fall), dann "- 46,65 €", dann "zu 52,50€".
  function euroFrom(rest) {
    const paren = rest.match(/\(\s*([\d.,]+)\s*€\s*\)/);
    if (paren) return parseGermanNumber(paren[1]);
    const dash = rest.match(/-\s*([\d.,]+)\s*€/);
    if (dash) return parseGermanNumber(dash[1]);
    const plain = rest.match(/zu\s*([\d.,]+)\s*€/i);
    if (plain) return parseGermanNumber(plain[1]);
    return null;
  }

  const buy = t.match(/Kauf am\s*(\d{1,2}\.\d{1,2}\.\d{2,4})([^\n]*)/i);
  if (buy) {
    out.buyDate = buy[1];
    const price = euroFrom(buy[2] || '');
    if (price != null) out.buyPriceEur = price;
  }

  const sell = t.match(/Verkauf am\s*(\d{1,2}\.\d{1,2}\.\d{2,4}|\?)([^\n]*)/i);
  if (sell && sell[1] !== '?') {
    out.sellDate = sell[1];
    out.closed = true;
    const price = euroFrom(sell[2] || '');
    if (price != null) out.sellPriceEur = price;
  }

  // "12 Stück zum Kaufpreis: 509 € - Verkaufspreis: 560 € = 51 € Ertrag"
  // Das €-Zeichen fehlt beim Autor gelegentlich ("Verkaufspreis: 54,54"),
  // deshalb ist es optional — der Anker ist das Schlüsselwort mit Doppelpunkt.
  const qty = t.match(/(\d+)\s*Stück/i);
  if (qty) out.qty = Number(qty[1]);
  const totalBuy = t.match(/Kaufpreis:\s*([\d.,]+)\s*€?/i);
  if (totalBuy) out.totalBuyEur = parseGermanNumber(totalBuy[1]);
  const totalSell = t.match(/Verkaufspreis:\s*([\d.,]+)\s*€?/i);
  if (totalSell) out.totalSellEur = parseGermanNumber(totalSell[1]);
  // Variante "… 645 € verkauft zu 712 €" (ohne "Verkaufspreis:"-Anker).
  if (out.totalSellEur == null) {
    const soldAt = t.match(/verkauft zu\s*([\d.,]+)\s*€/i);
    if (soldAt) out.totalSellEur = parseGermanNumber(soldAt[1]);
  }

  // Ertrag in allen gesehenen Schreibweisen: "= 51 € Ertrag", "Gewinn: 47 €",
  // Verlust-Formen entsprechend negativ.
  const gain = t.match(/=\s*(-?\s*[\d.,]+)\s*€\s*Ertrag/i) || t.match(/Gewinn:\s*(-?\s*[\d.,]+)\s*€/i);
  const loss = t.match(/=\s*-?\s*([\d.,]+)\s*€\s*Verlust/i) || t.match(/Verlust:\s*-?\s*([\d.,]+)\s*€/i);
  if (gain) {
    out.ertragEur = parseGermanNumber(gain[1].replace(/\s/g, ''));
    out.closed = true;
  } else if (loss) {
    const v = parseGermanNumber(loss[1]);
    if (v != null) out.ertragEur = -v;
    out.closed = true;
  }

  // Ohne jegliche Kauf-/Stück-Angabe ist das kein auswertbarer Trade.
  if (out.buyDate == null && out.qty == null && out.totalBuyEur == null) return null;
  return out;
}

// --- Autor-Statistik ("Statistik aktuell") --------------------------------------
function parseStatistik(text) {
  if (typeof text !== 'string' || !text) return null;
  const out = {};
  const kap = text.match(/eingesetztes Kapital:\s*([\d.,]+)\s*€/i);
  if (kap) out.eingesetztesKapital = parseGermanNumber(kap[1]);
  const zuw = text.match(/Zuwachs:\s*(-?\s*[\d.,]+)\s*€/i);
  if (zuw) out.zuwachs = parseGermanNumber(zuw[1].replace(/\s/g, ''));
  return out.eingesetztesKapital != null || out.zuwachs != null ? out : null;
}

// --- Portfolio-Aggregation -------------------------------------------------------
// Input: der gespeicherte modules-Map (je Eintrag: title, titleInfo, trade,
// statistik, parseError). Parse-Fehler landen in `unparseable` und verfälschen
// NIE die Summen; unvollständige Positionen werden angezeigt, aber aus der
// jeweiligen Summe herausgehalten (incomplete: true).
function computePortfolio(modules) {
  const round2 = (n) => Math.round(n * 100) / 100;
  const res = {
    investedCumulative: 0, // Σ Kaufsummen ALLER auswertbaren Engagements
    deployedOpen: 0,       // Σ Kaufsummen der noch laufenden Positionen
    realized: 0,           // Σ Ertrag der abgeschlossenen Verkäufe
    unrealizedTotal: 0,    // Σ Potenzial bis Kursziel der laufenden (vollständigen)
    positions: [],
    unparseable: [],
    statistik: null,
  };

  let statBest = null; // bevorzugt das Modul mit "aktuell" im Titel
  for (const m of Object.values(modules || {})) {
    const ti = m.titleInfo || parseModuleTitle(m.title || '');

    if (ti.kind === 'meta') {
      if (m.statistik) {
        const isAktuell = /aktuell/i.test(m.title || '');
        if (!statBest || (isAktuell && !statBest.isAktuell)) {
          statBest = { isAktuell, stat: m.statistik };
        }
      }
      continue;
    }

    if (m.parseError || !m.trade) {
      res.unparseable.push({
        id: m.id,
        title: m.title,
        reason: m.parseError || 'Kein auswertbarer Inhalt',
      });
      continue;
    }

    const tr = m.trade;
    // Status: Titel (Preis = offen, Tage = verkauft) gegen Body prüfen;
    // bei Widerspruch gilt der Body, die Position wird aber markiert.
    let status = ti.kind === 'closed' ? 'closed' : ti.kind === 'open' ? 'open' : tr.closed ? 'closed' : 'open';
    let incomplete = false;
    if ((ti.kind === 'open' && tr.closed) || (ti.kind === 'closed' && !tr.closed)) {
      status = tr.closed ? 'closed' : 'open';
      incomplete = true;
    }

    const totalBuy =
      tr.totalBuyEur != null
        ? tr.totalBuyEur
        : tr.qty != null && tr.buyPriceEur != null
          ? round2(tr.qty * tr.buyPriceEur)
          : null;

    const pos = {
      id: m.id,
      name: ti.name,
      status,
      qty: tr.qty != null ? tr.qty : null,
      buyDate: tr.buyDate || null,
      buyPriceEur: tr.buyPriceEur != null ? tr.buyPriceEur : null,
      totalBuyEur: totalBuy,
      currentPrice: ti.currentPrice != null ? ti.currentPrice : null,
      unrealizedEur: null,
      unrealizedPct: null,
      ertragEur: null,
      ertragPct: null,
      holdingDays: ti.holdingDays != null ? ti.holdingDays : null,
      incomplete,
    };

    if (totalBuy != null) res.investedCumulative += totalBuy;
    else pos.incomplete = true;

    if (status === 'closed') {
      const ertrag =
        tr.ertragEur != null
          ? tr.ertragEur
          : tr.totalSellEur != null && totalBuy != null
            ? tr.totalSellEur - totalBuy
            : null;
      if (ertrag != null) {
        pos.ertragEur = round2(ertrag);
        pos.ertragPct = totalBuy != null && totalBuy > 0 ? round2((ertrag / totalBuy) * 100) : null;
        res.realized += ertrag;
      } else {
        pos.incomplete = true;
      }
    } else {
      if (totalBuy != null) res.deployedOpen += totalBuy;
      if (pos.currentPrice != null && pos.qty != null && totalBuy != null) {
        const u = pos.qty * pos.currentPrice - totalBuy;
        pos.unrealizedEur = round2(u);
        pos.unrealizedPct = totalBuy > 0 ? round2((u / totalBuy) * 100) : null;
        res.unrealizedTotal += u;
      } else if (pos.currentPrice != null && pos.qty == null && totalBuy != null) {
        // Einträge ohne Stück-Angabe: der Autor notiert dort Kaufpreis und
        // Titel-Kurs in derselben Einheit (live geprüft: Heidelberg 171,85 -> 189,00
        // und Accor 46,92 -> 51,62, beide exakt sein +10%-Schema).
        const u = pos.currentPrice - totalBuy;
        pos.unrealizedEur = round2(u);
        pos.unrealizedPct = totalBuy > 0 ? round2((u / totalBuy) * 100) : null;
        res.unrealizedTotal += u;
      } else {
        pos.incomplete = true;
      }
    }

    res.positions.push(pos);
  }

  if (statBest) res.statistik = statBest.stat;
  res.investedCumulative = round2(res.investedCumulative);
  res.deployedOpen = round2(res.deployedOpen);
  res.realized = round2(res.realized);
  res.unrealizedTotal = round2(res.unrealizedTotal);
  return res;
}

// --- Kauf-/Verkaufs-Ereignisse zwischen zwei Modul-Ständen -----------------------
// Meldenswert sind nur die seltenen, wichtigen Ereignisse: neues Engagement
// (Kauf), Abschluss (Verkauf), Modul entfernt. Reine Kurs-Aktualisierungen im
// Titel wären Dauerrauschen und werden bewusst ignoriert.
function circleModuleClosed(m) {
  const ti = m.titleInfo || parseModuleTitle(m.title || '');
  return ti.kind === 'closed' || !!(m.trade && m.trade.closed);
}

// Platzhalter: der Autor legt leere Seiten an ("Neue Seite") und füllt sie erst
// später. Ohne Titel-Preis/Tage UND ohne geparste Trade-Daten ist das (noch)
// keine Position -> kein Kauf-/Entfernt-Ereignis.
function circlePlaceholder(m) {
  const ti = m.titleInfo || parseModuleTitle(m.title || '');
  return ti.kind === 'plain' && !m.trade;
}

function diffCircleModules(oldModules, newModules) {
  const events = [];
  const olds = oldModules || {};
  const news = newModules || {};

  for (const m of Object.values(news)) {
    const ti = m.titleInfo || parseModuleTitle(m.title || '');
    if (ti.kind === 'meta') continue;
    const o = olds[m.id];
    const closedNow = circleModuleClosed(m);
    const base = {
      id: m.id,
      name: ti.name,
      at: m.updatedAt || null, // Skool-Zeitstempel; Aufrufer ergänzt detectedAt
    };
    const boughtEvent = () => ({ ...base, type: 'bought',
      totalBuyEur: m.trade && m.trade.totalBuyEur != null ? m.trade.totalBuyEur : null,
      qty: m.trade && m.trade.qty != null ? m.trade.qty : null });
    const soldEvent = () => ({ ...base, type: 'sold',
      ertragEur: m.trade && m.trade.ertragEur != null ? m.trade.ertragEur : null,
      holdingDays: ti.holdingDays != null ? ti.holdingDays : null });
    if (!o) {
      // Neues Modul: offen = Kauf; bereits geschlossen = Kauf+Verkauf zwischen
      // zwei Abrufen -> als Verkauf melden (das Endereignis). Platzhalter: nichts.
      if (closedNow) {
        events.push(soldEvent());
      } else if (!circlePlaceholder(m)) {
        events.push(boughtEvent());
      }
    } else if (!circleModuleClosed(o) && closedNow) {
      events.push(soldEvent());
    } else if (circlePlaceholder(o) && !circlePlaceholder(m) && !closedNow) {
      // Platzhalter wurde zur echten Position (Titel-Preis oder Trade-Daten
      // kamen dazu) -> das ist der eigentliche Kauf.
      events.push(boughtEvent());
    }
  }

  for (const o of Object.values(olds)) {
    const ti = o.titleInfo || parseModuleTitle(o.title || '');
    if (ti.kind === 'meta') continue;
    if (circlePlaceholder(o)) continue; // gelöschter Platzhalter ist kein Ereignis
    if (!news[o.id]) events.push({ id: o.id, name: ti.name, at: null, type: 'removed' });
  }

  return events;
}

// --- Inkrementeller Harvest: welche Bodies fehlen oder sind veraltet? ------------
// bodyUpdatedAt = updatedAt zum Zeitpunkt des letzten Body-Parsens.
function selectStaleModules(index, storedModules) {
  const stored = storedModules || {};
  const out = [];
  for (const m of Object.values((index && index.modules) || {})) {
    const s = stored[m.id];
    if (!s || s.bodyUpdatedAt !== m.updatedAt) out.push(m.id);
  }
  return out;
}

// In Service-Worker und Popup gleichermaßen erreichbar machen.
if (typeof globalThis !== 'undefined') {
  globalThis.CIRCLE_CONFIG = CIRCLE_CONFIG;
  globalThis.circleModuleUrl = circleModuleUrl;
  globalThis.circleDataUrl = circleDataUrl;
  globalThis.parseGermanNumber = parseGermanNumber;
  globalThis.parseGermanDate = parseGermanDate;
  globalThis.parseModuleTitle = parseModuleTitle;
  globalThis.proseMirrorText = proseMirrorText;
  globalThis.buildCircleIndex = buildCircleIndex;
  globalThis.classifyCircleAccess = classifyCircleAccess;
  globalThis.parseTradeBody = parseTradeBody;
  globalThis.parseStatistik = parseStatistik;
  globalThis.computePortfolio = computePortfolio;
  globalThis.circlePlaceholder = circlePlaceholder;
  globalThis.diffCircleModules = diffCircleModules;
  globalThis.selectStaleModules = selectStaleModules;
}
