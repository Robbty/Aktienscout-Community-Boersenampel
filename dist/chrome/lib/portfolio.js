/*
 * portfolio.js — Zeitreihen für die Circle-Gesamtübersicht (portfolio.html).
 *
 * Reines Rechnen: kein DOM, kein Netz. Wie die anderen libs kein ES-Modul,
 * alles auf globalThis (Popup, Chart-Seite, Tests). Braucht parseGermanDate
 * aus lib/circle.js (vorher laden).
 *
 * Eingabe: die `positions` aus computePortfolio (circle.js) — je Position
 * Kaufdatum, Kaufsumme, Ertrag, Verkaufsdatum/Haltedauer, Kursziel-Potenzial —
 * optional Kursverläufe je Position (in €) und die Autor-Statistik.
 *
 * Ausgabe: ein Tagesraster vom ersten Kauf bis heute und je Tag die Werte
 * (Treppenkurven: ein Kauf zählt ab seinem Kauftag, ein Verkauf ab Verkaufstag).
 * Die vier Kurven der "Auswertung" enden exakt bei den Summen des Popups.
 */

const PF_DAY_MS = 86400000;
const DEPOSIT_WEEKLY_EUR = 1500;  // Aussage des Circle-Inhabers: 10 Wochen je 1.500 €
const DEPOSIT_WEEKS = 10;
const PF_TARGET_FACTOR = 1.10;    // Schema des Autors für die Vergangenheit verkaufter Positionen

// Lokaler Tagesbeginn (Mitternacht) eines Zeitpunkts in ms.
function pfDayStart(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Kauf-/Verkaufszeitpunkt (ms, lokale Mitternacht) einer Position. Fehlt beim
// Verkauf das Datum, wird es aus der Haltedauer im Titel ("[8 Tage]") geschätzt,
// zur Not = Kauftag. Ohne Kaufdatum: null (Aufrufer setzt den Zeitraumbeginn).
function positionSpan(pos) {
  const buy = pos.buyDate ? parseGermanDate(pos.buyDate) : null;
  if (buy == null) return null;
  let sell = null;
  let sellEstimated = false;
  if (pos.status === 'closed') {
    const s = pos.sellDate ? parseGermanDate(pos.sellDate) : null;
    if (s != null) sell = s;
    else { sell = buy + (pos.holdingDays || 0) * PF_DAY_MS; sellEstimated = true; }
    if (sell < buy) sell = buy;
  }
  return { buy, sell, sellEstimated };
}

// Letzter Kurs einer Tagesreihe { timestamps (Sek.), closes } bis einschließlich
// Zeitpunkt t (ms); null, wenn davor nichts vorliegt.
function lastCloseAt(series, tMs) {
  if (!series || !series.timestamps || !series.timestamps.length) return null;
  const t = tMs / 1000;
  let lo = 0;
  let hi = series.timestamps.length - 1;
  if (series.timestamps[0] > t) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (series.timestamps[mid] <= t) lo = mid; else hi = mid - 1;
  }
  return series.closes[lo];
}

// Verkaufserlös einer geschlossenen Position (für den Kapitalbedarf).
function proceedsOf(pos) {
  if (pos.totalSellEur != null) return pos.totalSellEur;
  if (pos.totalBuyEur != null && pos.ertragEur != null) return pos.totalBuyEur + pos.ertragEur;
  return pos.totalBuyEur != null ? pos.totalBuyEur : 0;
}

/*
 * buildPortfolioSeries(positions, { now, prices, statistik })
 *   prices:    posId -> { timestamps, closes } in €, Tagesdaten
 *   statistik: { eingesetztesKapital, zuwachs } des Autors (optional)
 * Rückgabe null ohne datierbare Position, sonst
 *   { days: [ms je Tagesbeginn], series: { invested, deployed, realized, potential,
 *     value, cashNeed, deposits, costs|null }, costRate, realizedNow, zuwachs,
 *     valueKnown: [bool je Tag], estimatedSells, undated, priced, unpriced }
 */
function buildPortfolioSeries(positions, opts) {
  opts = opts || {};
  const nowMs = opts.now != null ? opts.now : Date.now();
  const prices = opts.prices || {};
  const statistik = opts.statistik || null;
  const round2 = (n) => Math.round(n * 100) / 100;

  const items = [];
  for (const p of positions || []) items.push({ p, span: positionSpan(p) });
  const dated = items.filter((i) => i.span);
  if (!dated.length) return null;

  const start = pfDayStart(Math.min(...dated.map((i) => i.span.buy)));
  const end = pfDayStart(nowMs);
  let undated = 0;
  for (const i of items) {
    if (i.span) continue;
    undated++;
    i.span = { buy: start, sell: i.p.status === 'closed' ? start : null, sellEstimated: true };
  }

  const days = [];
  for (let d = new Date(start); d.getTime() <= end; d.setDate(d.getDate() + 1)) days.push(d.getTime());
  const n = days.length;
  const mk = () => new Array(n).fill(0);
  const series = { invested: mk(), deployed: mk(), realized: mk(), potential: mk(), value: mk(), cashNeed: mk(), deposits: mk(), costs: null };
  const valueKnown = new Array(n).fill(true);

  // Kostenquote aus der Autor-Statistik: Zuwachs (netto nach Steuern/Kosten)
  // gegen die realisierten Bruttogewinne — ein einzelner Ist-Wert, der
  // proportional auf den Verlauf verteilt wird (Näherung).
  let realizedNow = 0;
  for (const i of items) if (i.p.status === 'closed' && i.p.ertragEur != null) realizedNow += i.p.ertragEur;
  const zuwachs = statistik && statistik.zuwachs != null ? statistik.zuwachs : null;
  const costRate = zuwachs != null && realizedNow > 0 ? (realizedNow - zuwachs) / realizedNow : null;
  if (costRate != null) series.costs = mk();

  let priced = 0;
  let unpriced = 0;
  for (const i of items) {
    if (i.p.status === 'open' || i.p.status === 'closed') {
      if (prices[i.p.id] && prices[i.p.id].timestamps && prices[i.p.id].timestamps.length) priced++; else unpriced++;
    }
  }

  let runMax = 0;
  for (let k = 0; k < n; k++) {
    const dayEnd = (k + 1 < n ? days[k + 1] : days[k] + PF_DAY_MS);
    const atMs = Math.min(dayEnd - 1, nowMs);
    let invested = 0;
    let deployed = 0;
    let realized = 0;
    let potential = 0;
    let value = 0;
    let net = 0; // Käufe − Erlöse bis hierher
    for (const { p, span } of items) {
      const bought = span.buy < dayEnd;
      const sold = span.sell != null && span.sell < dayEnd;
      if (!bought) continue;
      const totalBuy = p.totalBuyEur != null ? p.totalBuyEur : null;
      if (totalBuy != null) { invested += totalBuy; net += totalBuy; }
      if (sold) {
        if (p.ertragEur != null) realized += p.ertragEur;
        net -= proceedsOf(p);
        continue;
      }
      // Noch im Markt an diesem Tag.
      if (totalBuy != null) deployed += totalBuy;
      if (p.status === 'open') {
        if (p.unrealizedEur != null) potential += p.unrealizedEur;
      } else if (totalBuy != null) {
        potential += totalBuy * (PF_TARGET_FACTOR - 1); // damals: Schema +10 %
      }
      // Marktwert: Stück × Tageskurs; ohne Stückzahl gilt der Kurs als Einheit
      // (wie die Summenzeile im Popup). Ohne Kurs: Kaufsumme als Platzhalter.
      const close = lastCloseAt(prices[p.id], atMs);
      if (close != null) {
        value += p.qty != null ? p.qty * close : close;
      } else {
        if (totalBuy != null) value += totalBuy;
        valueKnown[k] = false;
      }
    }
    runMax = Math.max(runMax, net);
    series.invested[k] = round2(invested);
    series.deployed[k] = round2(deployed);
    series.realized[k] = round2(realized);
    series.potential[k] = round2(potential);
    series.value[k] = round2(value);
    series.cashNeed[k] = round2(runMax);
    const week = Math.floor((days[k] - start) / (7 * PF_DAY_MS));
    series.deposits[k] = DEPOSIT_WEEKLY_EUR * Math.min(DEPOSIT_WEEKS, week + 1);
    if (series.costs) series.costs[k] = round2(realized * costRate);
  }

  return {
    days,
    series,
    costRate: costRate != null ? Math.round(costRate * 10000) / 10000 : null,
    realizedNow: round2(realizedNow),
    zuwachs,
    valueKnown,
    estimatedSells: items.filter((i) => i.span.sellEstimated && i.p.status === 'closed').length,
    undated,
    priced,
    unpriced,
    start,
    end,
  };
}

if (typeof globalThis !== 'undefined') {
  globalThis.DEPOSIT_WEEKLY_EUR = DEPOSIT_WEEKLY_EUR;
  globalThis.DEPOSIT_WEEKS = DEPOSIT_WEEKS;
  globalThis.pfDayStart = pfDayStart;
  globalThis.positionSpan = positionSpan;
  globalThis.lastCloseAt = lastCloseAt;
  globalThis.buildPortfolioSeries = buildPortfolioSeries;
}
