/*
 * events.js — Event-Log-Schnittstelle "boersenampel-events/1" (pure Logik).
 *
 * Die Börsenampel ist der eingeloggte "Sensor" für Skool; sie schreibt
 * Ereignisse (append-only) in einen Nutzer-eigenen Sync-Ordner, aus dem eine
 * Trading-App (und weitere Geräte) den Zustand rekonstruieren. Vollständige
 * Beschreibung: EVENTS.md im Repo. Hier stehen nur die reinen Bausteine —
 * keine api.*-Aufrufe, kein fetch, Zeit und Zufall kommen als Parameter, damit
 * alles in test/events.test.mjs prüfbar ist.
 *
 * Wird in Service-Worker (importScripts), Firefox-Background (scripts), Popup
 * und Android-App geladen; Exports liegen auf globalThis. Erwartet, dass
 * ampel.js, circle.js und quotes.js VORHER geladen sind (stockUrl,
 * circleModuleUrl, computePortfolio, normalizeQuoteCurrency, fxPairSymbol,
 * convertToEur).
 */

const EVENTS_SCHEMA = 'boersenampel-events/1';
const EVENT_V = 1;
const EVENTS_ROOT = 'boersenampel'; // Unterordner im Sync-Ordner

// --- Umschlag -------------------------------------------------------------------
// id = producerId + ':' + seq -> global eindeutig, ohne Uhr. `at` ist die
// Fachzeit (bei Skool-Daten das updatedAt der Quelle), `detectedAt` die
// Erkennungszeit des Producers.
function makeEvent(type, payload, opts) {
  const o = opts || {};
  const producer = o.producer || {};
  const detectedAt = o.detectedAt || o.now || new Date().toISOString();
  return {
    v: EVENT_V,
    id: String(producer.id || '') + ':' + String(o.seq),
    seq: o.seq,
    at: o.at || detectedAt,
    detectedAt,
    producer: {
      id: producer.id || null,
      kind: producer.kind || null,
      label: producer.label || null,
      version: producer.version || null,
    },
    type,
    payload: payload == null ? null : payload,
  };
}

// --- Hilfen ----------------------------------------------------------------------
const COLOR_ORDER = { green: 0, yellow: 1, red: 2, other: 3 };

// "03.08.2026" -> "2026-08-03"; alles andere -> null.
function isoDateFromGerman(s) {
  const m = String(s || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return y + '-' + pad(mo) + '-' + pad(d);
}

function isoOrNull(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return isNaN(t) ? null : new Date(t).toISOString();
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Kurs aus dem Quote-Cache (quotes[symbol]) — nur, wenn er vorhanden ist; der
// Export macht NIE Netzabrufe. FX ebenfalls nur aus dem Cache.
function stockQuoteFromCache(symbol, quotes) {
  if (!symbol || !quotes) return null;
  const qt = quotes[symbol];
  if (!qt || typeof qt.price !== 'number') return null;
  const norm = normalizeQuoteCurrency(qt.currency);
  let priceEur = null;
  if (norm.currency === 'EUR' || norm.currency === null) {
    priceEur = convertToEur(qt.price, qt.currency, null);
  } else {
    const fx = quotes[fxPairSymbol(norm.currency)];
    priceEur = fx && typeof fx.price === 'number' ? convertToEur(qt.price, qt.currency, fx.price) : null;
  }
  return {
    price: qt.price,
    currency: qt.currency || null,
    priceEur: priceEur != null ? round2(priceEur) : null,
    previousClose: typeof qt.previousClose === 'number' ? qt.previousClose : null,
    at: qt.at ? new Date(qt.at).toISOString() : null,
  };
}

// Symbol-Info aus einem quoteSymbols-Eintrag. `verified` nur, wenn die
// Auflösung über ISIN/WKN der Position lief (Preis-Anker im Circle-Pfad);
// Namenssuche bleibt ein unbestätigter Vorschlag.
function symbolInfoFromEntry(entry, trade) {
  const out = { yahoo: null, resolved: null, verified: false, resolvedAt: null };
  if (!entry || !entry.symbol) return out;
  out.yahoo = entry.symbol;
  out.resolvedAt = entry.resolvedAt ? new Date(entry.resolvedAt).toISOString() : null;
  const q = entry.query;
  if (trade && q && trade.isin && q === trade.isin) { out.resolved = 'isin'; out.verified = true; }
  else if (trade && q && trade.wkn && q === trade.wkn) { out.resolved = 'wkn'; out.verified = true; }
  else out.resolved = 'name-search';
  return out;
}

// --- Stock-Objekte ---------------------------------------------------------------
// ctx = { quotes, quoteSymbols } (beides optional; fehlt es, bleibt alles null).
function buildAmpelStockExport(stock, ctx) {
  const c = ctx || {};
  const entry = (c.quoteSymbols || {})['ampel:' + stock.id];
  const symbol = symbolInfoFromEntry(entry, null);
  return {
    scope: 'ampel',
    id: stock.id,
    name: stock.name,
    skoolUrl: stockUrl(stock.id),
    updatedAt: isoOrNull(stock.updatedAt),
    ampel: { color: stock.color || 'other', section: stock.section || null },
    identifiers: { isin: null, wkn: null, ticker: null, source: null },
    symbol,
    quote: stockQuoteFromCache(symbol.yahoo, c.quotes),
    trade: null,
  };
}

// module = circle.modules[id]; position = Eintrag aus computePortfolio().positions
// (oder null, wenn die Position dort nicht auftaucht, z. B. nicht auswertbar).
function buildCircleStockExport(module, position, ctx) {
  const c = ctx || {};
  const tr = module.trade || {};
  const entry = (c.quoteSymbols || {})[module.id];
  const symbol = symbolInfoFromEntry(entry, tr);
  const hasIds = !!(tr.isin || tr.wkn || tr.ticker);
  const p = position || null;
  const ti = module.titleInfo || parseModuleTitle(module.title || '');
  return {
    scope: 'circle',
    id: module.id,
    name: (p && p.name) || ti.name || module.title || null,
    skoolUrl: circleModuleUrl(module.id),
    updatedAt: isoOrNull(module.updatedAt),
    ampel: null,
    identifiers: {
      isin: tr.isin || null,
      wkn: tr.wkn || null,
      ticker: tr.ticker || null,
      source: hasIds ? 'circle-body' : null,
    },
    symbol,
    quote: stockQuoteFromCache(symbol.yahoo, c.quotes),
    trade: p
      ? {
          status: p.status,
          buyDate: isoDateFromGerman(p.buyDate),
          buyPriceEur: p.buyPriceEur != null ? p.buyPriceEur : null,
          qty: p.qty != null ? p.qty : null,
          totalBuyEur: p.totalBuyEur != null ? p.totalBuyEur : null,
          targetPriceEur: p.status === 'open' && p.currentPrice != null ? p.currentPrice : null,
          targetSource: p.status === 'open' ? p.targetSource || null : null,
          ertragEur: p.ertragEur != null ? p.ertragEur : null,
          holdingDays: p.holdingDays != null ? p.holdingDays : null,
          incomplete: !!p.incomplete,
        }
      : null,
  };
}

// Ampel-Aktien aus einem Snapshot, sortiert Farbe -> Name.
function sortedAmpelStocks(current) {
  const stocks = Object.values((current && current.stocks) || {});
  return stocks.slice().sort((a, b) => {
    const ca = COLOR_ORDER[a.color] != null ? COLOR_ORDER[a.color] : 3;
    const cb = COLOR_ORDER[b.color] != null ? COLOR_ORDER[b.color] : 3;
    if (ca !== cb) return ca - cb;
    return String(a.name || '').localeCompare(String(b.name || ''), 'de');
  });
}

// Vollbild (Payload von ampel.snapshot). state = { current, circle }.
function buildAmpelPayload(state, ctx) {
  const current = state && state.current;
  const out = {
    courseTitle: current ? current.courseTitle || null : null,
    courseUpdatedAt: current ? isoOrNull(current.courseUpdatedAt) : null,
    stockCount: 0,
    sections: [],
    stocks: [],
    circle: null,
  };
  if (current) {
    out.sections = Object.values(current.sections || {})
      .filter((s) => !hiddenPlaceholderTitle(s.title))
      .map((s) => ({ id: s.id, title: s.title, color: s.color || 'other', updatedAt: isoOrNull(s.updatedAt) }));
    out.stocks = sortedAmpelStocks(current)
      .filter((s) => !hiddenPlaceholderTitle(s.name))
      .map((s) => buildAmpelStockExport(s, ctx));
    out.stockCount = out.stocks.length;
  }
  const circle = state && state.circle;
  if (circle && circle.modules) {
    const pf = computePortfolio(circle.modules);
    const byId = {};
    for (const p of pf.positions) byId[p.id] = p;
    const positions = [];
    for (const m of Object.values(circle.modules)) {
      const ti = m.titleInfo || parseModuleTitle(m.title || '');
      if (ti.kind === 'meta' || circleHiddenTitle(ti.name)) continue;
      if (!m.trade && !byId[m.id]) continue; // Platzhalter ohne Daten
      positions.push(buildCircleStockExport(m, byId[m.id] || null, ctx));
    }
    out.circle = { positions };
  }
  return out;
}

// --- Deltas -> Ereignisse --------------------------------------------------------
// delta = Ergebnis von diffSnapshots (Buckets added/moved/edited/removed/section*).
// opts = { producer, seq (Startwert), detectedAt, ctx }. Liefert die Liste und
// den nächsten freien seq.
function eventsFromAmpelDelta(delta, opts) {
  const o = opts || {};
  let seq = o.seq || 1;
  const detectedAt = o.detectedAt || new Date().toISOString();
  const events = [];
  const push = (type, payload, at) => {
    events.push(makeEvent(type, payload, { producer: o.producer, seq: seq++, at: isoOrNull(at) || detectedAt, detectedAt }));
  };
  const d = delta || {};
  const stock = (s) => buildAmpelStockExport(s, o.ctx);
  for (const s of d.added || []) if (!hiddenPlaceholderTitle(s.name)) push('ampel.stock.added', { stock: stock(s) }, s.updatedAt);
  for (const s of d.moved || []) {
    if (hiddenPlaceholderTitle(s.name)) continue;
    push('ampel.stock.moved', {
      stock: stock(s),
      from: { color: s.from || 'other', section: s.fromSection || null },
      to: { color: s.to || s.color || 'other', section: s.section || null },
    }, s.updatedAt);
  }
  for (const s of d.edited || []) if (!hiddenPlaceholderTitle(s.name)) push('ampel.stock.edited', { stock: stock(s) }, s.updatedAt);
  for (const s of d.removed || []) if (!hiddenPlaceholderTitle(s.name)) push('ampel.stock.removed', { stock: stock(s) }, null);
  const section = (s) => ({ id: s.id, title: s.title, color: s.color || 'other', updatedAt: isoOrNull(s.updatedAt) });
  for (const s of d.sectionAdded || []) if (!hiddenPlaceholderTitle(s.title)) push('ampel.section.added', { section: section(s) }, s.updatedAt);
  for (const s of d.sectionEdited || []) if (!hiddenPlaceholderTitle(s.title)) push('ampel.section.edited', { section: section(s) }, s.updatedAt);
  for (const s of d.sectionRemoved || []) if (!hiddenPlaceholderTitle(s.title)) push('ampel.section.removed', { section: section(s) }, null);
  return { events, nextSeq: seq };
}

// fresh = bereits dedupte Circle-Ereignisse aus doPollCircle ({id,name,type,at,…}),
// modules = der NEUE Modul-Stand (für removed: der alte, falls übergeben als
// opts.oldModules). type bought|sold|removed -> circle.bought|sold|removed.
function eventsFromCircleDelta(fresh, modules, opts) {
  const o = opts || {};
  let seq = o.seq || 1;
  const detectedAt = o.detectedAt || new Date().toISOString();
  const events = [];
  const pf = modules ? computePortfolio(modules) : { positions: [] };
  const byId = {};
  for (const p of pf.positions) byId[p.id] = p;
  const old = o.oldModules || {};
  for (const e of fresh || []) {
    if (!e || !e.type) continue;
    if (circleHiddenTitle(e.name)) continue;
    const type = e.type === 'bought' ? 'circle.bought' : e.type === 'sold' ? 'circle.sold' : e.type === 'removed' ? 'circle.removed' : null;
    if (!type) continue;
    const m = (modules && modules[e.id]) || old[e.id] || { id: e.id, title: e.name, trade: null };
    const stock = buildCircleStockExport(m, byId[e.id] || null, o.ctx);
    events.push(makeEvent(type, { stock }, { producer: o.producer, seq: seq++, at: isoOrNull(e.at) || detectedAt, detectedAt }));
  }
  return { events, nextSeq: seq };
}

// --- JSONL / Pfade / Ordnung -----------------------------------------------------
function encodeJsonl(events) {
  return (events || []).map((e) => JSON.stringify(e)).join('\n') + ((events || []).length ? '\n' : '');
}

// Tolerant: kaputte oder abgeschnittene Zeilen überspringen, nie alles verwerfen.
function parseJsonl(text) {
  const events = [];
  let skipped = 0;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === 'object' && typeof e.id === 'string' && typeof e.type === 'string') events.push(e);
      else skipped++;
    } catch (err) {
      skipped++;
    }
  }
  return { events, skipped };
}

// UTC-Tag "YYYY-MM-DD" eines ISO-Zeitpunkts.
function dayKey(atIso) {
  const t = Date.parse(atIso);
  return (isNaN(t) ? new Date() : new Date(t)).toISOString().slice(0, 10);
}

function eventPath(producerId, atIso) {
  return EVENTS_ROOT + '/events/' + producerId + '/' + dayKey(atIso) + '.jsonl';
}

function producerPath(producerId) {
  return EVENTS_ROOT + '/producers/' + producerId + '.json';
}

function formatPath() {
  return EVENTS_ROOT + '/format.json';
}

function compareEvents(a, b) {
  const ta = Date.parse(a.at) || 0;
  const tb = Date.parse(b.at) || 0;
  if (ta !== tb) return ta - tb;
  const pa = (a.producer && a.producer.id) || '';
  const pb = (b.producer && b.producer.id) || '';
  if (pa !== pb) return pa < pb ? -1 : 1;
  return (a.seq || 0) - (b.seq || 0);
}

function sortEvents(list) {
  return (list || []).slice().sort(compareEvents);
}

function dedupeEvents(list) {
  const seen = new Set();
  const out = [];
  for (const e of list || []) {
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

// --- Referenz-Reducer ------------------------------------------------------------
// Baut aus einer (beliebig geordneten, ggf. doppelten) Ereignisliste den
// Zustand: Snapshot ersetzt alles; Deltas sind idempotente Upserts/Deletes; Deltas
// älter als der jüngste angewandte Snapshot werden ignoriert. Zusätzlich eine
// chronologische Historie der Deltas, fachlich dedupliziert über
// (type, stockId, updatedAt) — mehrere Börsenampel-Producer melden dieselbe
// Änderung als verschiedene Ereignisse.
function reduceEvents(list) {
  const events = sortEvents(dedupeEvents(list));
  const state = {
    snapshotAt: null,
    snapshotBy: null,
    courseTitle: null,
    sections: {},
    stocks: {},
    circle: {},
    history: [],
    unknownTypes: {},
  };
  const seenBusiness = new Set();
  const historyPush = (e, key) => {
    if (seenBusiness.has(key)) return;
    seenBusiness.add(key);
    state.history.push(e);
  };
  for (const e of events) {
    const p = e.payload || {};
    switch (e.type) {
      case 'ampel.snapshot': {
        state.snapshotAt = e.at;
        state.snapshotBy = e.producer && e.producer.id;
        state.courseTitle = p.courseTitle || null;
        state.sections = {};
        for (const s of p.sections || []) state.sections[s.id] = s;
        state.stocks = {};
        for (const s of p.stocks || []) state.stocks[s.id] = s;
        state.circle = {};
        for (const s of (p.circle && p.circle.positions) || []) state.circle[s.id] = s;
        break;
      }
      case 'ampel.stock.added':
      case 'ampel.stock.moved':
      case 'ampel.stock.edited':
      case 'ampel.stock.removed': {
        const s = p.stock;
        if (!s || !s.id) break;
        historyPush(e, e.type + '|' + s.id + '|' + (s.updatedAt || e.at));
        if (state.snapshotAt && compareEvents(e, { at: state.snapshotAt, producer: { id: '' }, seq: 0 }) < 0) break;
        if (e.type === 'ampel.stock.removed') delete state.stocks[s.id];
        else state.stocks[s.id] = s;
        break;
      }
      case 'ampel.section.added':
      case 'ampel.section.edited':
      case 'ampel.section.removed': {
        const s = p.section;
        if (!s || !s.id) break;
        historyPush(e, e.type + '|' + s.id + '|' + (s.updatedAt || e.at));
        if (state.snapshotAt && compareEvents(e, { at: state.snapshotAt, producer: { id: '' }, seq: 0 }) < 0) break;
        if (e.type === 'ampel.section.removed') delete state.sections[s.id];
        else state.sections[s.id] = s;
        break;
      }
      case 'circle.bought':
      case 'circle.sold':
      case 'circle.removed': {
        const s = p.stock;
        if (!s || !s.id) break;
        historyPush(e, e.type + '|' + s.id + '|' + (s.updatedAt || e.at));
        if (state.snapshotAt && compareEvents(e, { at: state.snapshotAt, producer: { id: '' }, seq: 0 }) < 0) break;
        if (e.type === 'circle.removed') delete state.circle[s.id];
        else state.circle[s.id] = s;
        break;
      }
      default:
        state.unknownTypes[e.type] = (state.unknownTypes[e.type] || 0) + 1;
    }
  }
  return state;
}

// --- Pfad-Hilfen für Adapter -----------------------------------------------------
// Segmente einzeln URL-kodieren, Slashes normalisieren.
function joinPath(base, path) {
  const b = String(base || '').replace(/\/+$/, '');
  const segs = String(path || '').split('/').filter(Boolean).map(encodeURIComponent);
  return b + '/' + segs.join('/');
}

if (typeof globalThis !== 'undefined') {
  globalThis.EVENTS_SCHEMA = EVENTS_SCHEMA;
  globalThis.EVENT_V = EVENT_V;
  globalThis.EVENTS_ROOT = EVENTS_ROOT;
  globalThis.makeEvent = makeEvent;
  globalThis.isoDateFromGerman = isoDateFromGerman;
  globalThis.stockQuoteFromCache = stockQuoteFromCache;
  globalThis.symbolInfoFromEntry = symbolInfoFromEntry;
  globalThis.buildAmpelStockExport = buildAmpelStockExport;
  globalThis.buildCircleStockExport = buildCircleStockExport;
  globalThis.sortedAmpelStocks = sortedAmpelStocks;
  globalThis.buildAmpelPayload = buildAmpelPayload;
  globalThis.eventsFromAmpelDelta = eventsFromAmpelDelta;
  globalThis.eventsFromCircleDelta = eventsFromCircleDelta;
  globalThis.encodeJsonl = encodeJsonl;
  globalThis.parseJsonl = parseJsonl;
  globalThis.dayKey = dayKey;
  globalThis.eventPath = eventPath;
  globalThis.producerPath = producerPath;
  globalThis.formatPath = formatPath;
  globalThis.compareEvents = compareEvents;
  globalThis.sortEvents = sortEvents;
  globalThis.dedupeEvents = dedupeEvents;
  globalThis.reduceEvents = reduceEvents;
  globalThis.joinPath = joinPath;
}
