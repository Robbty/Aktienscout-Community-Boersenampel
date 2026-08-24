/*
 * sync-flush.js — Outbox -> Adapter. Gemeinsam für Service-Worker (WebDAV) und
 * Seitenkontexte (lokaler Ordner, siehe sync-folder.js).
 *
 * Speicherschlüssel (storage.local):
 *   syncOutbox  [event]           noch nicht geschriebene Ereignisse dieses Producers
 *   syncDays    {day: [event]}    eigene Tagesereignisse der letzten Tage — die
 *                                 Tagesdatei wird IMMER komplett neu geschrieben
 *                                 (WebDAV/Drive kennen kein Anhängen)
 *   syncMeta    {seq, lastFlushAt, lastError, lastErrorAt, lastSnapshotAt,
 *                lastSnapshotVersion, needsPageFlush, formatWritten}
 */

const SYNC_DAYS_KEEP = 7;
const SYNC_OUTBOX_MAX = 2000;

// storage = api.storage.local (get/set). producer = {id, kind, label, version}.
async function flushOutboxWith(adapter, storage, producer) {
  const s = await storage.get(['syncOutbox', 'syncDays', 'syncMeta']);
  const outbox = s.syncOutbox || [];
  const days = s.syncDays || {};
  const meta = s.syncMeta || {};
  const now = Date.now();
  if (!outbox.length) {
    if (meta.needsPageFlush) await storage.set({ syncMeta: Object.assign({}, meta, { needsPageFlush: false }) });
    return { ok: true, flushed: 0 };
  }

  const fail = async (error) => {
    await storage.set({ syncMeta: Object.assign({}, meta, { lastError: error, lastErrorAt: now }) });
    return { ok: false, error };
  };

  if (!meta.formatWritten) {
    const f = await adapter.put(formatPath(), JSON.stringify({ schema: EVENTS_SCHEMA, writtenAt: new Date(now).toISOString() }));
    if (!f.ok) return fail(f.error || 'format.json konnte nicht geschrieben werden');
    meta.formatWritten = true;
  }

  const byDay = {};
  for (const e of outbox) {
    const d = dayKey(e.at);
    (byDay[d] = byDay[d] || []).push(e);
  }
  for (const d of Object.keys(byDay).sort()) {
    const all = sortEvents(dedupeEvents((days[d] || []).concat(byDay[d])));
    const r = await adapter.put(eventPath(producer.id, d + 'T12:00:00.000Z'), encodeJsonl(all));
    if (!r.ok) return fail(r.error || 'Schreiben fehlgeschlagen');
    days[d] = all;
  }

  const pr = await adapter.put(producerPath(producer.id), JSON.stringify({
    schema: EVENTS_SCHEMA,
    id: producer.id,
    kind: producer.kind,
    label: producer.label,
    version: producer.version,
    lastActiveAt: new Date(now).toISOString(),
    seq: meta.seq || 0,
  }, null, 2));
  if (!pr.ok) return fail(pr.error || 'Producer-Datei konnte nicht geschrieben werden');

  const keep = Object.keys(days).sort().slice(-SYNC_DAYS_KEEP);
  const nextDays = {};
  for (const k of keep) nextDays[k] = days[k];

  // Outbox kann inzwischen gewachsen sein -> nur die geschriebenen IDs entfernen.
  const s2 = await storage.get(['syncOutbox']);
  const flushedIds = new Set(outbox.map((e) => e.id));
  const rest = (s2.syncOutbox || []).filter((e) => !flushedIds.has(e.id));
  await storage.set({
    syncOutbox: rest,
    syncDays: nextDays,
    syncMeta: Object.assign({}, meta, { lastFlushAt: now, lastError: null, lastErrorAt: null, needsPageFlush: false }),
  });
  return { ok: true, flushed: outbox.length };
}

if (typeof globalThis !== 'undefined') {
  globalThis.SYNC_OUTBOX_MAX = SYNC_OUTBOX_MAX;
  globalThis.flushOutboxWith = flushOutboxWith;
}
