# Event-Log-Schnittstelle `boersenampel-events/1`

Ab Version 0.7.0 (Git-Tag `events-v1`) kann die Börsenampel (Browser-Add-on und
Android-App) alle Ampel- und Circle-Ereignisse in einen **Sync-Ordner** schreiben, den
der Nutzer selbst besitzt (Nextcloud, kDrive, Filen, Proton Drive, Google Drive …).
Eine Trading-App — oder jedes andere Programm — liest diesen Ordner und rekonstruiert
daraus den aktuellen Stand; mehrere Geräte gleichen sich über den Ordner ab. Es gibt
keinen Server der Börsenampel, keine Konten, keine Analysetexte im Log.

## 1. Grundidee

- **Append-only:** Es gibt nur Ereignisse, nie „den Zustand". Jeder Leser berechnet den
  Zustand selbst (Abschnitt 6). Sync ist damit nur „gib mir alle Ereignisse, die ich
  noch nicht habe".
- **Jeder Erzeuger schreibt nur eigene Dateien.** Ein Erzeuger („Producer") ist eine
  Installation (Add-on auf dem Laptop, App auf dem Handy, Trading-App auf dem Desktop).
  Niemand schreibt in fremde Dateien → keine Schreibkonflikte, egal wie der Ordner
  synchronisiert wird.
- **Dedup über die Ereignis-ID, Ordnung über Zeit + Sequenz.** Ereignisse dürfen beliebig
  oft geliefert werden.
- **Snapshots:** Die Börsenampel schreibt regelmäßig ein Vollbild (`ampel.snapshot`).
  Ein neues Gerät startet beim jüngsten Snapshot und spielt nur spätere Deltas nach.

## 2. Ordner-Layout

```
<Sync-Ordner>/boersenampel/
  format.json                              { "schema": "boersenampel-events/1", "writtenAt": "…" }
  producers/<producerId>.json              Steckbrief: id, kind, label, version, lastActiveAt, seq
  events/<producerId>/<YYYY-MM-DD>.jsonl   Ereignisse dieses Erzeugers, ein UTC-Tag je Datei
```

- `producerId`: einmalig je Installation erzeugte UUID; der Nutzer vergibt ein Label
  („Peters Laptop").
- **JSONL:** ein Ereignis je Zeile, UTF-8, `\n`-getrennt. Leser tolerieren eine
  abgeschnittene letzte Zeile und überspringen kaputte Zeilen, statt die Datei zu verwerfen.
- **Schreibregel:** Der Besitzer schreibt seine Tagesdatei immer **komplett neu** (WebDAV/
  Drive kennen kein Anhängen). Fremde Dateien werden nie geschrieben oder gelöscht.
- Leser dürfen sich nicht darauf verlassen, dass alte Tagesdateien ewig existieren —
  deshalb der Snapshot.

## 3. Ereignis-Umschlag

```jsonc
{
  "v": 1,
  "id": "3f2a…c9:184",                      // producer.id + ":" + seq -> global eindeutig
  "seq": 184,                               // je Producer streng monoton steigend
  "at": "2026-08-24T15:02:11.000Z",         // Fachzeit: bei Skool-Daten deren updatedAt, sonst Erkennungszeit
  "detectedAt": "2026-08-24T15:02:11.000Z", // Erkennungszeit des Producers
  "producer": { "id": "3f2a…c9", "kind": "extension" | "app" | "trader", "label": "Peters Laptop", "version": "0.7.0" },
  "type": "ampel.stock.moved",
  "payload": { … }
}
```

Regeln:
- **Dedup:** Schlüssel ist `id`; das zuerst gesehene Ereignis gewinnt.
- **Ordnung:** global `(at, producer.id, seq)`. Innerhalb eines Producers garantiert `seq`
  die Reihenfolge, auch bei falsch gehender Uhr. `at` ist Wanduhrzeit — Uhrabweichungen
  von Minuten beeinflussen nur die Anzeige-Reihenfolge zwischen Producern, nie die
  Korrektheit (alle Deltas sind idempotent, Abschnitt 6).
- **Unbekannt = `null`, nie fehlend.** Zahlen als Number (Punkt-Dezimal), Beträge in EUR
  außer explizit benannt, Zeiten ISO-8601 UTC.
- **Stabilität:** Unter `v: 1` kommen Felder und Typen nur hinzu. Leser ignorieren
  unbekannte Typen und Felder. Bruch ⇒ `v: 2`, Ordner `boersenampel-v2/`, Tag `events-v2`.

## 4. Ereignistypen der Börsenampel

| Typ | Wann | Payload |
|---|---|---|
| `ampel.snapshot` | beim Einschalten, bei Versionswechsel, sonst max. 1×/Tag, und auf „Jetzt synchronisieren" | `Ampel` (Abschnitt 5) |
| `ampel.stock.added` | Aktie neu in einer Ampel | `{ stock }` |
| `ampel.stock.moved` | Aktie wechselt die Ampel (Farbwechsel) | `{ stock, from: {color, section}, to: {color, section} }` |
| `ampel.stock.edited` | Analyse bearbeitet (nur `updatedAt` neu) | `{ stock }` |
| `ampel.stock.removed` | Aktie aus der Ampel entfernt | `{ stock }` (letzter bekannter Stand) |
| `ampel.section.added` / `.edited` / `.removed` | Menüpunkt-Änderungen (Info-Seiten) | `{ section: {id, title, color, updatedAt} }` |
| `circle.bought` | Circle-Position eröffnet | `{ stock }` (scope `circle`, mit `trade`) |
| `circle.sold` | Circle-Position geschlossen | `{ stock }` |
| `circle.removed` | Circle-Modul entfernt | `{ stock }` |

Nicht enthalten (bewusst): Analysetexte, Kurs-Ticks. Platzhalter-Seiten des Autors
(„Neue Seite") erzeugen keine Ereignisse.

Der Namensraum **`trader.*`** ist für die Trading-App reserviert (z. B.
`trader.watch.added`, `trader.order.placed`, `trader.position.opened`,
`trader.stop.updated`); die Börsenampel belegt ihn nie.

## 5. Objekte

`Stock`:
```jsonc
{
  "scope": "ampel" | "circle",
  "id": "<skool module id>", "name": "Adidas",
  "skoolUrl": "https://www.skool.com/…?md=<id>", "updatedAt": "2026-08-20T08:00:00.000Z",
  "ampel": { "color": "green"|"yellow"|"red"|"other", "section": "grüne Ampel" } | null,   // null bei scope circle
  "identifiers": { "isin": null, "wkn": null, "ticker": null, "source": "circle-body" | null },
  "symbol": { "yahoo": "ADS.DE" | null, "resolved": "isin"|"wkn"|"name-search"|null,
              "verified": false, "resolvedAt": "…" | null },
  "quote": { "price": 161.2, "currency": "EUR", "priceEur": 161.2,
             "previousClose": 159.9 | null, "at": "…" } | null,                               // nur aus dem Cache, ggf. Minuten alt
  "trade": { "status": "open"|"closed", "buyDate": "2026-08-03" | null, "buyPriceEur": 42.32,
             "qty": 12, "totalBuyEur": 509, "targetPriceEur": 46.66, "targetSource": "computed"|"author"|null,
             "ertragEur": null, "holdingDays": null, "incomplete": false } | null             // nur scope circle
}
```

- **Ampel-Aktien tragen keine ISIN/WKN/Ticker** (die Analysetexte enthalten nur Namen).
  `symbol.yahoo` ist dort ein Vorschlag aus der Yahoo-Namenssuche mit `verified: false` —
  eine Trading-App **muss** ihn vom Nutzer bestätigen lassen, bevor sie handelt.
- Circle: `verified: true` genau dann, wenn per ISIN/WKN aufgelöst (`resolved`).
- `targetPriceEur` = Kursziel aus der Stück-Zeile des Beitrags (`?` → Kaufpreis +10 %,
  `targetSource: "computed"`; konkrete Zahl → `"author"`).
- Kein Namens-Matching Circle↔Ampel (Stammdaten des Autors sind unsauber) → `ampel: null`.

`Ampel` (Payload von `ampel.snapshot`):
```jsonc
{
  "courseTitle": "…", "courseUpdatedAt": "…", "stockCount": 41,
  "sections": [ { "id", "title", "color", "updatedAt" } ],
  "stocks": [ …Stock ],                       // sortiert Farbe (green, yellow, red, other) -> Name
  "circle": { "positions": [ …Stock ] } | null   // offene UND geschlossene Positionen
}
```

## 6. Reducer-Vertrag (was ein Leser tut)

Zustand = `stocks[id]`, `sections[id]`, `circle[id]`. Ereignisse deduplizieren, sortieren, dann:
- `ampel.snapshot` **ersetzt** den kompletten Zustand.
- `ampel.stock.added|moved|edited` → `stocks[id] = payload.stock` (Upsert);
  `ampel.stock.removed` → löschen. Sektionen analog.
- `circle.bought|sold` → `circle[id] = payload.stock`; `circle.removed` → löschen.
- Deltas, die **älter** als der jüngste angewandte Snapshot sind, werden ignoriert.
- Für eine Anzeige-Historie die Deltas chronologisch sammeln und fachlich über
  `(type, stock.id, stock.updatedAt)` deduplizieren — mehrere Börsenampel-Producer (Laptop +
  Handy) melden dieselbe Änderung als verschiedene Ereignisse.

Referenzimplementierung: `reduceEvents()` in `extension/lib/events.js`; das Werkzeug
`node test/tools/replay.mjs <Sync-Ordner>` liest einen Ordner komplett und druckt den
Zustand (`--json` für die Rohform). Beides 1:1 in die Trading-App übernehmbar.

## 7. Beispielzeilen

```jsonl
{"v":1,"id":"3f2a…c9:1","seq":1,"at":"2026-08-24T15:02:11.000Z","detectedAt":"2026-08-24T15:02:11.000Z","producer":{"id":"3f2a…c9","kind":"extension","label":"Peters Laptop","version":"0.7.0"},"type":"ampel.snapshot","payload":{"courseTitle":"Die Aktien-Ampel (lifetime)*","courseUpdatedAt":"…","stockCount":41,"sections":[…],"stocks":[…],"circle":{"positions":[…]}}}
{"v":1,"id":"3f2a…c9:2","seq":2,"at":"2026-08-25T07:41:00.000Z","detectedAt":"2026-08-25T08:00:03.000Z","producer":{…},"type":"ampel.stock.moved","payload":{"stock":{"scope":"ampel","id":"7b…","name":"Adidas","skoolUrl":"…","updatedAt":"2026-08-25T07:41:00.000Z","ampel":{"color":"green","section":"grüne Ampel"},"identifiers":{"isin":null,"wkn":null,"ticker":null,"source":null},"symbol":{"yahoo":"ADS.DE","resolved":"name-search","verified":false,"resolvedAt":"…"},"quote":{"price":161.2,"currency":"EUR","priceEur":161.2,"previousClose":159.9,"at":"…"},"trade":null},"from":{"color":"yellow","section":"gelbe Ampel"},"to":{"color":"green","section":"grüne Ampel"}}}
{"v":1,"id":"3f2a…c9:3","seq":3,"at":"2026-08-24T09:00:00.000Z","detectedAt":"2026-08-24T15:02:11.000Z","producer":{…},"type":"circle.bought","payload":{"stock":{"scope":"circle","id":"86e3…","name":"Wells Fargo & Company","skoolUrl":"…","updatedAt":"…","ampel":null,"identifiers":{"isin":"US9497461015","wkn":"857949","ticker":"WFC","source":"circle-body"},"symbol":{"yahoo":"WFC","resolved":"isin","verified":true,"resolvedAt":"…"},"quote":{…},"trade":{"status":"open","buyDate":"2026-08-24","buyPriceEur":71.91,"qty":7,"totalBuyEur":575,"targetPriceEur":90.36,"targetSource":"computed","ertragEur":null,"holdingDays":null,"incomplete":false}}}}
```

## 8. Transporte (Adapter)

Der Schreib-Vertrag ist winzig: `put(path, text)`, `get(path)`, `list(dir)`, `mkdirp(dir)`,
`selfTest()`. Vorhanden in 0.7.0:

| Adapter | Wo | Für wen |
|---|---|---|
| **WebDAV** (`lib/sync-webdav.js`) | Add-on (Chrome, Firefox), Android-App | Nextcloud, ownCloud, **kDrive** (Infomaniak, App-Passwort), HiDrive, MagentaCloud, GMX/Web.de, Koofr, pCloud, **Filen** über den lokalen WebDAV-Server der Filen-CLI/Desktop-App (`http://127.0.0.1:<port>`) |
| **Lokaler Ordner** (`lib/sync-folder.js`, File System Access API) | Add-on nur in Chrome/Edge am Desktop | Jeder Cloud-Client, der einen Ordner synchronisiert: **Filen**, **Proton Drive**, Nextcloud-, Drive-, Dropbox-Client |

Geplant: Filen-SDK-Adapter (offizielle TypeScript-API — dann auch vom Handy), Proton-
Drive-Adapter über das Proton-SDK (sobald es eine Login-Schicht für Dritt-Apps hat; nach
Protons Krypto-Umbau Ende 2026), Google Drive/Dropbox per OAuth.

Sicherheits-/Datenschutzhinweise:
- Sync ist **Opt-in**. Geschrieben wird nur nach einem erfolgreichen, eingeloggten Abruf.
- WebDAV-Zugangsdaten liegen im Profilspeicher des Browsers (wie die Skool-Cookies) —
  **App-Passwort** verwenden (jederzeit widerrufbar), nie das Konto-Passwort.
- Nur `https://` — `http://` ausschließlich für `127.0.0.1`/`localhost` (Filen-Server).
- Den Sync-Ordner nicht öffentlich freigeben: er enthält Ampelstände und Circle-Trades
  aus Bezahlkursen (keine Analysetexte).

## 9. Grenzen

- Ampel-Yahoo-Symbole sind unbestätigte Namenssuchen; sie werden häppchenweise (3 je
  Abruf) aufgelöst und erscheinen erst nach einigen Abrufen im Snapshot.
- `quote` ist ein Cache-Stand (`quote.at` beachten); die Trading-App holt Kurse selbst.
- Der Adapter „lokaler Ordner" schreibt nur, während das Popup oder das eigenständige
  Circle-Fenster offen ist (Browser-Beschränkung); Ereignisse sammeln sich solange in der
  Outbox (max. 2000, danach beginnt der nächste Schreiblauf mit einem neuen Vollbild).
- Retention: Producer halten ihre Tagesdateien 7 Tage lokal vor; ältere Dateien im Ordner
  bleiben unangetastet.
