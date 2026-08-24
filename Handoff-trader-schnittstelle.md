# Handoff: Event-Log-Schnittstelle der Börsenampel für die Trading-App

> **Umgesetzt am 24.08.2026 in v0.7.0 (Tag `events-v1`).** Maßgeblich ist jetzt `EVENTS.md`
> (Format) und CLAUDE.md (Implementierung). Abweichungen gegenüber diesem Plan: zusätzlicher
> Adapter „lokaler Ordner" (File System Access API, Chrome/Edge) für Filen/Proton-Desktop-
> Clients; Anbieter-Priorität Filen > kDrive > Proton (ab Ende 2026); WebDAV-Selbsttest,
> Flush-Test gegen Mini-WebDAV (`test/sync-flush.test.mjs`); Referenz-Leser
> `test/tools/replay.mjs`. Teil C (Trading-App) bleibt Skizze fürs PRD.

Stand: 24.08.2026 (Fassung 2 — ersetzt den URL-Push/Pull-Plan der Fassung 1).
**Arbeitsauftrag zum Wiederaufnehmen in einem neuen Chat.** Vor dem Start `CLAUDE.md`
lesen (Architektur) und diesen Plan gegen den aktuellen Code prüfen (Zeilenangaben
können sich verschoben haben).

---

## 0. Warum Fassung 2

Fassung 1 sah vor: Klick-Push per URL-Vorlage an die Trading-App + manueller JSON-Export.
Das scheitert, sobald die Trading-App auf mehreren Geräten läuft (Desktop + Handy):
Jedes Gerät hätte einen eigenen Stand, Abgleich nur per Hand.

Entscheidung (mit Peter, 24.08.2026):
- Die Börsenampel (Add-on + Android-App) ist der **Sensor** — der einzige eingeloggte
  Leser von Skool. Sie schreibt Ereignisse in ein **Event-Log**.
- Das Event-Log liegt in einem **Ordner, den der Nutzer selbst synchronisiert**
  (Nextcloud/WebDAV zuerst; Google Drive/Dropbox später als Adapter). Kein von uns
  betriebener Server, keine Konten bei uns, keine Bezahlinhalte auf fremden Systemen.
- Die Trading-App liest das Log und schreibt ihre eigenen Ereignisse (Orders, Stops,
  Trades) in **dasselbe Log** — so synchronisieren sich auch ihre Geräte untereinander.
- Zwei Produktvarianten der Trading-App sind damit **ein Code**: „nur lokal" = Log auf
  der Platte, „Sync" = Log im Cloud-Ordner. Sync-Kommando + Auto-Sync beim Start.
- Ein eigener Server (Supabase o. ä.) bleibt eine spätere Geschäftsentscheidung für
  Community-Features; das Log-Format ändert sich dadurch nicht, nur der Adapter.

Der Handoff hat zwei Teile: **A** = Format und Regeln (gelten für beide Seiten),
**B** = Umsetzung in der Börsenampel (dieser Auftrag), **C** = Leseseite der Trading-App
(Skizze, wird im PRD der Trading-App ausgearbeitet).

---

# Teil A — Das Event-Log `boersenampel-events/1`

## A.1 Grundidee

- **Append-only:** Es gibt nur Ereignisse, nie „den Zustand". Der Zustand wird auf jedem
  Gerät aus den Ereignissen berechnet (Reducer). Damit ist der Sync ein reines
  Transportproblem: „gib mir alle Ereignisse, die ich noch nicht habe".
- **Jeder Erzeuger schreibt nur seine eigenen Dateien.** Ein Erzeuger („Producer") ist
  eine Installation: das Add-on auf Peters Laptop, die App auf dem Handy, die Trading-App
  auf dem Desktop. Kein Producer schreibt je in eine Datei eines anderen → **keine
  Schreibkonflikte**, egal wie primitiv der Ordner-Sync ist (Nextcloud-Client, Drive,
  Syncthing, USB-Stick).
- **Dedup über die Ereignis-ID, Ordnung über Zeit + Sequenz.** Jedes Ereignis ist damit
  beliebig oft lieferbar (idempotent), Doppelungen durch Sync-Wiederholungen sind egal.
- **Snapshots als Abkürzung:** Damit ein neues Gerät nicht Jahre an Deltas nachspielen
  muss, schreibt die Börsenampel regelmäßig ein Vollbild-Ereignis (`ampel.snapshot`).
  Konsumenten starten beim jüngsten Snapshot und spielen nur spätere Deltas nach.

Das ist exakt das Muster, das die Börsenampel intern schon nutzt (`history`/`circleHistory`
mit Dedup über `id|type|at`, `appendUniqueHistory` in `lib/ampel.js`) — nur nach außen
gekehrt.

## A.2 Ordner-Layout

```
<Sync-Ordner>/boersenampel/
  format.json                              # { "schema": "boersenampel-events/1" }
  producers/<producerId>.json              # Steckbrief des Erzeugers (Label, Art, Version, zuletzt aktiv)
  events/<producerId>/<YYYY-MM-DD>.jsonl   # Ereignisse dieses Erzeugers, ein Tag je Datei
```

- `producerId`: einmalig je Installation erzeugte UUID v4 (klein, ohne Klammern), in den
  Einstellungen gespeichert. Der Nutzer kann ein **Label** vergeben („Peters Laptop").
- `<YYYY-MM-DD>` = UTC-Datum des `at`-Zeitstempels.
- **JSONL:** ein Ereignis je Zeile, UTF-8, `\n`-getrennt, keine BOM. Leser müssen eine
  **abgeschnittene letzte Zeile tolerieren** (unvollständiger Sync) und einzelne kaputte
  Zeilen überspringen, nie die ganze Datei verwerfen.
- **Schreibregel:** Der Besitzer einer Tagesdatei schreibt sie **komplett neu** (PUT) — die
  Tagesereignisse hält er lokal vor. Das ist bewusst so, weil WebDAV/Drive kein Anhängen
  kennen; ein lokaler Dateisystem-Adapter darf echt anhängen. Fremde Dateien werden
  **nie** geschrieben oder gelöscht.
- Dateien werden **nie umgeschrieben** außer vom Besitzer am selben Tag. Aufräumen
  (Retention) ist optional: Ein Besitzer darf eigene Tagesdateien löschen, die älter als
  sein jüngster Snapshot sind — Konsumenten dürfen sich nie darauf verlassen, dass alte
  Deltas noch existieren (deshalb der Snapshot).

## A.3 Ereignis-Umschlag

```jsonc
{
  "v": 1,                                   // Umschlag-Version (Bruch -> 2)
  "id": "3f2a…c9:184",                      // producerId + ":" + seq  -> global eindeutig
  "seq": 184,                               // je Producer streng monoton steigend, lückenlos
  "at": "2026-08-24T15:02:11.000Z",         // Fachzeit (ISO-8601 UTC): bei Skool-Daten das updatedAt der Quelle,
                                            //   sonst die Erkennungszeit
  "detectedAt": "2026-08-24T15:02:11.000Z", // wann der Producer es festgestellt hat (immer gesetzt)
  "producer": { "id": "3f2a…c9", "kind": "extension" | "app" | "trader", "label": "Peters Laptop", "version": "0.7.0" },
  "type": "ampel.stock.moved",              // Namensraum.Objekt.Verb, siehe A.4
  "payload": { … }                          // typabhängig, siehe A.4/A.5
}
```

Regeln:
- **Eindeutigkeit/Dedup:** Schlüssel ist `id`. Zwei Ereignisse mit gleicher `id` sind
  dasselbe Ereignis; das zuerst gesehene gewinnt, das zweite wird still verworfen.
- **Ordnung:** global sortiert nach `(at, producer.id, seq)`. Innerhalb eines Producers
  garantiert `seq` die Reihenfolge — auch wenn dessen Uhr falsch geht. `at` ist
  Wanduhrzeit; Konsumenten müssen mit Uhrabweichungen von Minuten leben (sie beeinflussen
  nur die Anzeige-Reihenfolge zwischen Producern, nie die Korrektheit, weil alle
  Ampel-Deltas idempotent auf IDs wirken — siehe A.6).
- **Unbekannt = `null`, nie fehlend.** Zahlen als Number (Punkt-Dezimal), Beträge in EUR
  außer explizit anders benannt (`price`+`currency`), Zeiten ISO-8601 UTC.
- **Stabilität:** Unter `v:1` / `boersenampel-events/1` kommen Felder und Ereignistypen
  nur **hinzu**; nichts wird entfernt, umbenannt oder umgetypt. Konsumenten ignorieren
  unbekannte Typen und Felder. Bruch ⇒ `v:2`, neuer Ordner `boersenampel-v2/`, Git-Tag
  `events-v2`.

## A.4 Ereignistypen der Börsenampel (Producer `extension`/`app`)

| Typ | Wann | Payload |
|---|---|---|
| `ampel.snapshot` | beim Aktivieren des Syncs, dann max. 1×/Tag nach erfolgreichem Poll, sowie immer wenn der Producer eine neue Version hat | `Ampel` (A.5) — Vollbild |
| `ampel.stock.added` | Aktie neu in einer Ampel-Sektion | `{ stock: Stock }` |
| `ampel.stock.moved` | Aktie wechselt die Sektion (= Farbwechsel) | `{ stock: Stock, from: {color, section}, to: {color, section} }` |
| `ampel.stock.edited` | Analyse bearbeitet (nur `updatedAt` geändert) | `{ stock: Stock }` |
| `ampel.stock.removed` | Aktie aus der Ampel entfernt | `{ stock: Stock }` (letzter bekannter Stand) |
| `ampel.section.added` / `.removed` / `.edited` | Menüpunkt-Änderungen (Info-Seiten; Ampel-Sektionen werden hier ausgelassen wie in `diffSnapshots`) | `{ section: {id, title, color, updatedAt} }` |
| `circle.bought` | Circle-Position eröffnet (auch neu-und-schon-geschlossen → `sold`) | `{ stock: Stock }` (scope `circle`, mit `trade`) |
| `circle.sold` | Circle-Position geschlossen | `{ stock: Stock }` |
| `circle.removed` | Modul entfernt | `{ stock: Stock }` |

Quellen im Code: `diffSnapshots` (ampel.js) liefert `added/moved/edited/removed` und
`sectionAdded/…`; `diffCircleModules` (circle.js) liefert `bought/sold/removed`.
`edited` wird — anders als im internen `history` — **mitgeschrieben** (die Trading-App
will wissen, wann eine Analyse neu ist), aber Platzhalter (`hiddenPlaceholderTitle`,
`circleHiddenTitle`) bleiben wie überall ausgefiltert.

**Nicht enthalten (bewusst):** Analysetexte (größter Content-Wert des Autors, für den
Trader nicht nötig), Kurs-Ticks (die Trading-App holt Kurse selbst — Yahoo-Symbole
liefert `Stock.symbol` als Startpunkt).

## A.5 Objekte

`Stock` (wie Fassung 1, unverändert gültig):
```jsonc
{
  "scope": "ampel" | "circle",
  "id": "<skool module id>", "name": "Adidas AG",
  "skoolUrl": "https://www.skool.com/…?md=<id>", "updatedAt": "…",
  "ampel": { "color": "green"|"yellow"|"red"|"other", "section": "grüne Ampel" } | null,   // null bei scope circle
  "identifiers": { "isin": null, "wkn": null, "ticker": null, "source": "circle-body" | null },
  "symbol": { "yahoo": "ADS.DE" | null, "resolved": "isin"|"wkn"|"name-search"|null,
              "verified": false, "resolvedAt": "…" | null },
  "quote": { "price": 161.2, "currency": "EUR", "priceEur": 161.2,
             "previousClose": 159.9 | null, "at": "…" } | null,                              // nur aus dem Cache
  "trade": { "status": "open"|"closed", "buyDate": "2026-08-03" | null, "buyPriceEur": 42.32,
             "qty": 12, "totalBuyEur": 507.84, "targetPriceEur": 46.55, "targetSource": "computed"|"author",
             "incomplete": false } | null                                                      // nur scope circle
}
```
- Ampel-Aktien tragen **keine** ISIN/WKN/Ticker (live verifiziert an AAK AB, A2A, 3i Group:
  Analysetext = Firmenname + [+]/[-]-Punkte). `symbol.yahoo` ist dort ein Vorschlag aus der
  Namenssuche mit `verified:false` → die Trading-App **muss** ihn bestätigen lassen.
- Circle: `verified:true` genau dann, wenn per Preis-Anker aufgelöst
  (`quoteSymbols[id].query === trade.isin/wkn` → `resolved` `"isin"`/`"wkn"`).
- `targetPriceEur` = `pos.currentPrice` aus `computePortfolio` (seit v0.6.9 aus der
  Stück-Zeile abgeleitet; `targetSource` sagt, ob gerechnet oder vom Autor).
- Kein Namens-Matching Circle↔Ampel (Autor-Stammdaten unsauber) → `ampel: null`.

`Ampel` (Payload von `ampel.snapshot`):
```jsonc
{
  "courseTitle": "…", "courseUpdatedAt": "…", "stockCount": 41,
  "sections": [ { "id", "title", "color", "updatedAt" } ],
  "stocks": [ …Stock ],                      // sortiert Farbe (green,yellow,red,other) -> Name
  "circle": { "positions": [ …Stock ] } | null   // offene UND geschlossene Positionen
}
```

## A.6 Reducer-Vertrag (was ein Konsument daraus macht)

Der Zustand „Ampel" ist eine Map `stocks[id] → Stock` plus `sections[id]`. Regeln:
- `ampel.snapshot` **ersetzt** den kompletten Ampel-Zustand (Map neu aufbauen).
- `ampel.stock.added|moved|edited` → `stocks[id] = payload.stock` (Upsert).
- `ampel.stock.removed` → `delete stocks[id]`.
- `circle.*` → `circle[id] = payload.stock` (Upsert; `sold` setzt `trade.status:"closed"`;
  `removed` löscht).
- Ereignisse **älter** als der jüngste angewandte Snapshot (nach `(at, producer, seq)`)
  werden ignoriert. Damit ist es egal, ob ein Delta vor oder nach dem Snapshot eines
  anderen Producers eintrifft — jedes Upsert ist idempotent.
- Für die **Anzeige-Historie** („Ampelwechsel der letzten 30 Tage") werden die Deltas
  zusätzlich chronologisch als Liste gehalten, dedupliziert über `id`.

Konsequenz für mehrere Börsenampel-Producer (Laptop + Handy lesen beide Skool): Beide
schreiben dieselben Ampel-Änderungen als **verschiedene** Ereignisse (andere `id`). Für
den Zustand ist das egal (idempotent). Für die Historie dedupliziert der Konsument
zusätzlich fachlich über `(type, payload.stock.id, payload.stock.updatedAt)` — dieselbe
Regel wie `historyKey` intern.

## A.7 Ereignisse der Trading-App (Namensraum `trader.*`, reserviert)

Nicht Teil dieses Auftrags; hier nur, damit die Börsenampel den Namensraum nie belegt und
das PRD darauf aufsetzen kann. Beispiele:

| Typ | Payload (Skizze) |
|---|---|
| `trader.watch.added` / `.removed` | `{ stockId, source: "ampel"\|"manual", symbol }` |
| `trader.order.placed` / `.cancelled` / `.filled` | `{ orderId, stockId, side, kind: "trailing-down"\|"trailing-up"\|"stop-loss", params… }` |
| `trader.position.opened` / `.closed` | `{ positionId, stockId, qty, priceEur, at }` |
| `trader.stop.updated` | `{ positionId, stopEur }` |
| `trader.settings.changed` | `{ key, value }` (Last-Writer-Wins nach `(at, producer, seq)`) |

Mutierbare Werte (Stop-Kurs, Einstellungen) sind unter Fassung-2-Regeln **Last-Writer-Wins**
pro Schlüssel. Falls später echtes gleichzeitiges Editieren nötig wird, ist der Wechsel
zu CRDTs (Automerge/Yjs/Loro) eine Trading-App-interne Entscheidung — das Log bleibt
Transport.

---

# Teil B — Umsetzung in der Börsenampel (dieser Auftrag)

## B.1 Live verifizierte Fakten (24.08.2026, weiter gültig)

- Messaging: `runtime.onMessage`-Switch in `extension/background.js` (`getState`, `pollNow`,
  `capture`, `openChart`, `circleQuotes`, `getStockBody`, `circlePollNow`, `circleSeen`,
  `acknowledge`, `setInterval`, `setBlink`, `setActivityDays`). Einstellungsmuster:
  `setActivityDays` (background.js) + `DEFAULTS` (~Z. 30) + Footer-Feld `#interval` mit
  „Speichern" (popup.js, `saveInterval`).
- Delta-Quellen: `ingestSnapshot()` ruft `appendHistory(delta)` nur bei `!isFirstEver`;
  `doPollCircle()` hängt `circleHistory`-Events an — beide Stellen sind die Einhängepunkte
  für den Event-Ausstoß (**nach** dem erfolgreichen `storage.local.set`, nie davor).
- Storage: `current.stocks{id→{id,name,section,color,updatedAt}}`, `current.sections{}`;
  `circle.modules{id→{title,titleInfo,trade,…}}`; `quotes{[sym]→{price,currency,at}}`
  (inkl. `EUR<CUR>=X`); `quoteSymbols{[circleId]→{symbol,query,resolvedAt,v}}`.
- Kursauflösung nur für Circle (`getCircleQuotes`); Helfer `resolveYahooSymbol`,
  `cachedYahooQuote`, `quoteEur`, `SYMBOL_RESOLVE_VERSION`, `SYMBOL_RETRY_MS`.
- Ladepunkte: `background.js` `importScripts('lib/debug.js','lib/ampel.js','lib/circle.js','lib/quotes.js')`;
  `manifest.firefox.json` `background.scripts` gleiche Liste + `background.js`;
  `popup.html` lädt nur `lib/ampel.js`, `lib/circle.js`, `popup.js`.
  **`app/build-www.mjs` prüft den exakten Script-Block (`oldBlock`, ~Z. 56) — bei Änderung
  in popup.html den Marker mit anpassen, sonst bricht der App-Build.**
- Manifest (MV3): permissions storage/alarms/notifications; host_permissions skool.com +
  query1/query2.finance.yahoo.com; kein `optional_host_permissions` bisher.
- App: Netzabrufe laufen über CapacitorHttp (Cookies im geteilten CookieManager); der
  Shim bildet `browser.*` nach; `globalThis.__appFireStartup` existiert nur in der App.
- Privacy-Regel: Bezahlinhalte verlassen das Add-on nur nach ausdrücklicher
  Nutzer-Einwilligung (hier: Sync-Schalter) und nur bei `meta.lastPollOk` /
  `circleMeta.lastPollOk`.

## B.2 Entscheidungen

- **Version 0.7.0**, Changelog `## 0.7.0 – Datum`; Git-Tag **`events-v1`** auf den Commit
  (ersetzt das geplante `api-v1`).
- **Transport zuerst: WebDAV** (Nextcloud, ownCloud, Strato HiDrive, MagentaCloud, GMX/
  Web.de, Koofr, pCloud …). Grund: ein Protokoll, plain `fetch` mit Basic-Auth, läuft in
  Chrome, Firefox und der App gleich; Nextcloud-**App-Passwort** statt Konto-Passwort
  empfehlen (Anleitung). Google Drive/Dropbox brauchen OAuth → eigene Adapter später
  (B.8). Lokaler Ordner ist im Add-on nicht möglich (keine Dateisystem-API in Firefox;
  Chrome nur mit Nachfragen je Sitzung) — nur die Trading-App bekommt einen
  Dateisystem-Adapter.
- **Adapter-Schnittstelle** (klein, damit weitere Backends nur diese Funktionen liefern):
  `put(path, text)`, `get(path) → text|null`, `list(dir) → [name]`, `mkdirp(dir)`.
  Producer brauchen nur `put`/`mkdirp` (+ `get` für den Selbsttest).
- **Berechtigung:** `optional_host_permissions: ["https://*/*", "http://*/*"]` im Manifest;
  beim Speichern der WebDAV-URL fordert das Popup (Nutzergeste) exakt
  `new URL(url).origin + '/*'` per `api.permissions.request` an. Firefox 128+ kennt
  `optional_host_permissions` in MV3 (beim Umsetzen gegen die aktuelle Firefox-Version
  prüfen; Fallback: `optional_permissions` mit Origins). In der App entfällt das
  (CapacitorHttp).
- **Zugangsdaten** (URL, Benutzer, App-Passwort) liegen in `storage.local.settings.sync`
  — Klartext im Profilspeicher, wie die Skool-Session-Cookies des Browsers selbst. In der
  Anleitung klar benennen und App-Passwort empfehlen (jederzeit widerrufbar).
- **Ausstoß automatisch** nach jedem erfolgreichen Poll mit Delta, **nur bei aktivem
  Schalter**. Zusätzlich „Jetzt synchronisieren" (Vollbild-Snapshot erzwingen).
- Kein manueller JSON-Export mehr als eigener Weg — das Snapshot-Ereignis IST der Export.
  (Ein „Snapshot in Zwischenablage" bleibt als kleiner Helfer für Support/Debug.)
- **Outbox statt Direktschreiben:** Ereignisse werden erst in `storage.local.syncOutbox`
  angehängt (mit `seq`), dann geflusht. Scheitert der Flush (offline, 401), bleibt alles
  in der Outbox und wird beim nächsten Poll erneut versucht; `syncMeta.lastError` zeigt
  es im Footer. Outbox gedeckelt (2000), älteste weichen — nach einem Deckel-Verlust wird
  beim nächsten Flush ein Snapshot vorangestellt.

## B.3 Neue pure Lib `extension/lib/events.js` + `test/events.test.mjs`

globalThis-Exports, kein `api.*`/`fetch`, Zeit und Zufall als Parameter (testbar).
Nutzt `stockUrl` (ampel.js), `circleModuleUrl`/`computePortfolio` (circle.js),
`normalizeQuoteCurrency`/`fxPairSymbol`/`convertToEur` (quotes.js).

- `EVENTS_SCHEMA = 'boersenampel-events/1'`, `EVENT_V = 1`.
- `buildAmpelStockExport(stock, ctx)` / `buildCircleStockExport(module, position, ctx)` /
  `buildAmpelPayload(state, ctx)` — die `Stock`/`Ampel`-Objekte aus A.5. `ctx =
  {quotes, quoteSymbols, now}`; Ampel-Symbole aus `quoteSymbols['ampel:' + id]` (eigener
  Namensraum, kollidiert nicht — `getCircleQuotes` iteriert nur `circle.modules`).
- `stockQuoteFromCache(symbol, quotes, now)`, `symbolInfoFromEntry(entry, trade)`,
  `isoDateFromGerman(s)`, `sortedAmpelStocks(current)`.
- `makeEvent(type, payload, {producer, seq, at, detectedAt})` → Umschlag A.3 (setzt `id`).
- `eventsFromAmpelDelta(delta, currentStocks, ctx)` → Liste `ampel.*`-Events aus einem
  `diffSnapshots`-Ergebnis; `eventsFromCircleDelta(delta, modules, ctx)` → `circle.*`.
- `encodeJsonl(events)`, `parseJsonl(text)` (tolerant: kaputte/abgeschnittene Zeile
  überspringen, Anzahl übersprungener Zeilen zurückgeben).
- `dayKey(atIso)` → `YYYY-MM-DD` (UTC); `eventPath(producerId, atIso)`.
- `sortEvents(list)` nach `(at, producer.id, seq)`; `dedupeEvents(list)` über `id`.
- `webdavUrl(base, path)` (Slash-Normalisierung, URL-Kodierung je Segment).

Tests (Muster `test/circle.test.mjs`, lädt quotes → ampel → circle → events via
`runInThisContext`): Umschlag-Schlüsselmenge als Stabilitäts-Assert; `id = producer:seq`;
Ampel-Aktie ohne Cache (alles `null`, `verified:false`); mit `ampel:<id>`-Cache + USD-Kurs
+ `EURUSD=X` → `priceEur`; Circle-Position (`resolved:'isin'`, `verified:true`,
`targetPriceEur`, ISO-`buyDate`); `moved` mit `from/to`; Platzhalter ausgefiltert;
Sortierung + `stockCount`; JSONL-Round-Trip mit Umlauten („Ströer") und abgeschnittener
letzter Zeile; `sortEvents` bei gleichem `at`; `dayKey` über Mitternacht UTC.

## B.4 Adapter `extension/lib/sync-webdav.js`

Reiner `fetch`-Code (läuft in Worker, Popup, App): `createWebdavAdapter({baseUrl, user,
password})` mit `put/get/list/mkdirp` und `selfTest()` (MKCOL `boersenampel/`, PUT
`format.json`, GET zurück). `mkdirp` = MKCOL je Segment, 405 „existiert schon" ist ok.
`list` per PROPFIND Depth 1 (nur für den Selbsttest und die Trading-App nötig; minimaler
XML-Parser über `DOMParser` im Popup, im Worker per Regex auf `<d:href>`). Fehler als
`{ok:false, status, error}` — nie werfen. In der App geht `fetch` durch den
Capacitor-Shim; Basic-Auth-Header explizit setzen (kein Cookie-Auth).

## B.5 Background (`extension/background.js`)

- `DEFAULTS.sync = { enabled:false, url:'', user:'', password:'', producerId:null,
  label:'' }`; `producerId` beim ersten Aktivieren erzeugen (`crypto.randomUUID()`), Label
  Standard = `'Börsenampel ' + (App ? 'App' : 'Add-on')`.
- Nachrichten: `setSync {patch}` (validiert URL `https:` — `http:` nur mit Warnung),
  `syncTest` (Adapter-Selbsttest, Antwort `{ok, error}`), `syncNow` (Snapshot erzwingen +
  Flush), `getSyncStatus` (aus `syncMeta`: `lastFlushAt`, `lastError`, `outboxCount`,
  `lastSnapshotAt`, `seq`).
- `emitEvents(list)`: `seq` aus `syncMeta.seq` fortzählen, in `syncOutbox` anhängen, **eine**
  `storage.local.set` für Outbox+Meta, dann `flushOutbox()` (nicht awaiten im Poll-Pfad;
  In-flight-Guard wie bei den Polls, damit überlappende Trigger nicht doppelt schreiben).
- Einhängepunkte: in `ingestSnapshot` nach dem erfolgreichen Speichern und
  `!isFirstEver`: `emitEvents(eventsFromAmpelDelta(delta, …))`; Snapshot-Regel
  (`ampel.snapshot`, wenn `lastSnapshotAt` > 24 h, Version geändert oder erzwungen) —
  Snapshot nur mit `lastPollOk` und ohne `DEBUG_SIMULATE`. In `doPollCircle` nach dem
  gemeinsamen Set: `emitEvents(eventsFromCircleDelta(...))`.
- `flushOutbox()`: Outbox nach Tag gruppieren; je Tag die Datei **komplett** aus
  `syncDays[day]` (lokal vorgehaltene Tagesereignisse dieses Producers, Deckel: die
  letzten 7 Tage) + Outbox neu PUTten; `producers/<id>.json` bei jedem Flush
  aktualisieren (`lastActiveAt`, `version`); Erfolg → Outbox leeren, `syncMeta` setzen.
- Ampel-Symbole für den Snapshot: **nur aus Cache** (`quoteSymbols['ampel:'+id]`), kein
  Netz beim Snapshot (40 Namenssuchen wären >10 s und ein Yahoo-Drossel-Risiko). Die
  Auflösung passiert nebenbei: `resolveAmpelSymbolsSlowly()` löst je Poll höchstens 3
  fehlende Ampel-Symbole (Namenssuche ohne Anker, `via:'name-search'`, Retry-Logik wie
  Circle) — innerhalb weniger Stunden sind alle da, ohne je einen Poll spürbar zu bremsen.
- `generator`/`producer.kind`: `globalThis.__appFireStartup ? 'app' : 'extension'`;
  Version aus `api.runtime.getManifest()` in try/catch (App: `App.getInfo()`-Version via
  `globalThis.__appVersion`, das app.js setzt).

## B.6 Popup (`popup.html`, `popup.js`, `popup.css`)

- Footer, neuer aufklappbarer Block „Synchronisation" (Standard zu): Schalter
  „Ereignisse in Cloud-Ordner schreiben", Felder WebDAV-URL / Benutzer / App-Passwort /
  Geräte-Label, Buttons „Verbindung testen", „Speichern", „Jetzt synchronisieren";
  Statuszeile (`syncMeta`: „zuletzt 15:02 · 0 offen" bzw. roter Fehler). Beim Speichern:
  `api.permissions.request({origins:[origin+'/*']})` **im Klick-Handler** (Nutzergeste),
  dann `setSync`. Speicherung ohne erteilte Berechtigung → Fehlermeldung, Schalter aus.
- Hinweistext unter dem Block (kurz): was geschrieben wird (Ampelstände, Circle-Käufe/
  Verkäufe, keine Analysetexte), wohin (`<Ordner>/boersenampel/`), dass der Ordner
  privat bleiben soll.
- „Snapshot in Zwischenablage" (kleiner Link neben der Version) für Support/Debug.
- `renderAll()` spiegelt `state.settings.sync` in die Felder (wie `interval`), Passwort
  nur als `type=password`.

## B.7 App (`app/`)

- `app/build-www.mjs`: `oldBlock`/`newBlock` an den geänderten Script-Block anpassen
  (`lib/quotes.js`, `lib/events.js`, `lib/sync-webdav.js` in popup.html).
- Shim: nichts Neues nötig, sofern `fetch` mit `Authorization`-Header durch
  CapacitorHttp geht — beim Umsetzen prüfen (`CapacitorHttp` übernimmt Header; MKCOL/
  PROPFIND als Methoden müssen durchgereicht werden — falls CapacitorHttp nur
  GET/POST/PUT/DELETE/PATCH kennt, für `mkdirp`/`list` auf natives `fetch` mit
  `{ headers }` ausweichen und im Manifest der App `android:usesCleartextTraffic` NICHT
  anfassen — https bleibt Pflicht).
- `app.js` setzt `globalThis.__appVersion` aus `App.getInfo()`.
- Hintergrund-Runner (M6) schreibt **keine** Events (bewusst entkoppelt, nur
  Benachrichtigung); die WebView holt beim Öffnen ohnehin voll nach und stößt dann aus.

## B.8 Doku, Version, Tag

- **`EVENTS.md`** (Repo-Wurzel, Deutsch): Teil A dieses Handoffs als Referenz (Layout,
  Umschlag, Typen, Objekte, Reducer-Vertrag), drei Beispielzeilen JSONL (Ampel-Aktie
  ohne IDs, Circle-Position mit ISIN, `moved` mit from/to), Stabilitätsversprechen
  `events-vN`, Adapter-Liste (WebDAV jetzt; Google Drive, Dropbox, lokaler Ordner in der
  Trading-App als geplant), Grenzen (Uhrabweichung, Retention, Yahoo-Symbol ungeprüft).
- README: Abschnitt „Synchronisation / Schnittstelle zur Trading-App" mit Link auf
  EVENTS.md; ANLEITUNG.md: Kapitel „Cloud-Ordner einrichten (Nextcloud-App-Passwort)".
- Version **0.7.0** in beiden Manifesten; `extension/changelog.md` `## 0.7.0`
  (Sync-Block, was geschrieben wird, `- Doku: EVENTS.md, README, ANLEITUNG`).
- CLAUDE.md: Layout (neue Libs, Ladepunkte, build-www-Marker, optional_host_permissions)
  + Abschnitt „Event-Log-Schnittstelle (v0.7.0, Tag events-v1)": Producer-Dateien-Regel,
  Outbox/Flush, Snapshot-Regel, `ampel:<id>`-Namensraum, Privacy, Testdatei.
- `node build.mjs`, `cd app && npm run build`; Commit; `git tag events-v1`; Tag pushen.
  (Regel: Doku + Changelog IMMER vor dem Push — siehe Memory.)

## B.9 Verifikation

1. `node test/events.test.mjs`, dann alle Suiten (`circle`, `lifecycle`, `quotes`) +
   `node --check` je Datei.
2. Chrome (unpacked `extension/`): Peters Nextcloud als Ziel, App-Passwort anlegen →
   „Verbindung testen" → `boersenampel/format.json` erscheint; Schalter an → „Jetzt
   synchronisieren" → `events/<id>/<heute>.jsonl` mit einem `ampel.snapshot`;
   Ampel-Änderung provozieren (Playwright-Browser kann keine schreiben → `DEBUG`-Weg:
   `current` in storage.local manipulieren, dann „Jetzt prüfen") → `ampel.stock.moved`
   angehängt, Datei komplett neu geschrieben, `seq` fortlaufend; Netz kappen → Outbox
   zählt hoch, roter Status; Netz wieder da → nächster Poll flusht. Worker-Konsole ohne
   Warnungen. Zweiter Producer (Firefox über `dist/firefox`) schreibt in eigenen Ordner.
3. Leseseite-Smoke: kleines Node-Skript (`test/tools/replay.mjs`, git-ignoriert oder als
   Werkzeug eingecheckt) lädt alle JSONL aus einem lokalen Nextcloud-Sync-Ordner, dedupt,
   sortiert, reduziert und druckt die Ampel-Map — das ist zugleich die Referenz-
   implementierung des Reducers für die Trading-App.
4. App: `cd app && npm run build` (Marker!), Sync gegen dieselbe Nextcloud, eigener
   Producer-Ordner erscheint.
5. `git tag events-v1` nach dem Release-Commit.

## B.10 Risiken

- Fehlzuordnung bei Ampel-Aktien (Namenssuche ohne Anker) → `verified:false`; die
  Trading-App muss bestätigen lassen. Ohne Bestätigung nie automatisch handeln.
- Privacy: Sync nur nach Opt-in; Ordner ist Nutzer-eigen; keine Analysetexte; in der
  Anleitung darauf hinweisen, den Ordner nicht öffentlich zu teilen.
- Zugangsdaten im Profilspeicher → App-Passwort empfehlen.
- Uhrabweichungen zwischen Geräten: unkritisch für den Zustand, sichtbar in der
  Historien-Reihenfolge; `detectedAt` hilft beim Debuggen.
- WebDAV-Eigenheiten je Anbieter (MKCOL-Antworten, Redirects, Pfad-Präfix
  `remote.php/dav/files/<user>/`): Selbsttest muss jeden Schritt einzeln melden.
- Yahoo-Drossel: Ampel-Symbole nur häppchenweise (3/Poll) auflösen.
- `app/build-www.mjs`-Marker bricht bei geändertem Script-Block — bewusst mitändern.
- Firefox `optional_host_permissions`-Support beim Umsetzen prüfen.

---

# Teil C — Leseseite der Trading-App (Skizze fürs PRD)

- **Ein Code, zwei Varianten:** Adapter `local` (Dateisystem-Ordner, echtes Append) für
  „nur dieses Gerät"; Adapter `webdav` (später `gdrive`, `dropbox`) für „Sync". Der
  Nutzer wählt in den Einstellungen; Wechsel = Ordner kopieren.
- **Sync-Kommando** = für jeden fremden Producer die Tagesdateien ab dem lokal zuletzt
  gesehenen Tag neu laden (kleine Dateien, deshalb kein ETag-Zwang; ETag/`If-None-Match`
  als Optimierung), `parseJsonl` → `dedupe` → `sort` → Reducer. Auto-Sync beim Start und
  alle N Minuten; manuell per Button.
- **Eigene Events** (`trader.*`) schreibt sie nach exakt denselben Regeln in ihren
  Producer-Ordner — damit syncen sich mehrere Trading-App-Geräte untereinander und die
  Börsenampel könnte später „im Trader gekauft" anzeigen (nur lesen, `trader.*`).
- **Bootstrap eines neuen Geräts:** jüngsten `ampel.snapshot` aller Producer nehmen,
  spätere Deltas anwenden, dann alle `trader.*`-Events (die haben keinen Snapshot; bei
  Bedarf führt die Trading-App einen eigenen `trader.snapshot` ein — gleiche Regel).
- **Symbol-Bestätigung:** `symbol.verified:false` → UI-Pflichtschritt vor jedem Handel;
  Bestätigung selbst ist ein `trader.watch.added` mit dem geprüften Symbol.
- **Referenz-Reducer** = `test/tools/replay.mjs` aus B.9 — bei der Umsetzung der
  Trading-App 1:1 übernehmen/portieren.

## Offene Punkte für Peter

- WebDAV-Ziel für den ersten Test: Peters Nextcloud (Pfad `remote.php/dav/files/<user>/`)?
- Sollen geschlossene Circle-Positionen im Snapshot bleiben (Plan: ja — die Trading-App
  will die Historie des Autors sehen)?
- Label-Standard und ob mehrere Börsenampel-Producer (Laptop + Handy) beide schreiben
  sollen (Plan: ja, Dedup fachlich beim Konsumenten) oder nur einer („Haupt-Sensor"-
  Schalter). Empfehlung: beide, kostet nichts und ist ausfallsicher.
- Nach dem PRD: welche Cloud-Adapter außer WebDAV zuerst (Google Drive ist bei
  Nicht-Technikern am verbreitetsten, braucht aber OAuth-Client-Registrierung bei Google).
