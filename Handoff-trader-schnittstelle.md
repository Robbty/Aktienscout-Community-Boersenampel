# Handoff: Export-Schnittstelle („API") der Börsenampel für die künftige Trading-App

Stand: 24.08.2026. **Arbeitsauftrag zum Wiederaufnehmen in einem neuen Chat** — dieses
Dokument enthält alles, was für die Umsetzung nötig ist: Ziel, Entscheidungen, live
verifizierte Fakten, das Datenformat, die Schrittfolge mit Dateien/Funktionsnamen und die
Verifikation. Vor dem Start `CLAUDE.md` lesen (Architektur) und diesen Plan gegen den
aktuellen Code prüfen (Zeilenangaben können sich verschoben haben).

---

## 1. Ziel und Kontext

Peter plant eine zweite, eigenständige Anwendung („Trading-App"), die Aktien aus der
Börsenampel übernimmt und damit 10-%-Flips handelt (Kauf per Trailing-Down, Verkauf per
Trailing-Up bei +10 %, Stop-Loss oder nach 4 Monaten; zusätzlich eigene Aktien). Ein PRD
dafür folgt separat und ist **nicht** Teil dieses Auftrags.

**Dieser Auftrag betrifft nur die Geber-Seite:** Browser-Add-on (`extension/`) und die
davon abgeleitete Android-App (`app/`, nutzt den Extension-Code wörtlich über
`app/build-www.mjs` und einen `browser.*`-Shim in `app/src/shim.js`) bekommen
Schnittstellen, über die die Daten einer Aktie an die Trading-App übergeben werden:
- **Push:** Klick je Aktie („Zum Trader") übergibt genau diese Aktie.
- **Pull:** Die Trading-App kann den gesamten aktuellen Ampelstand erhalten.
- **Tag:** Der Code-Stand, ab dem die Schnittstelle existiert, bekommt das Git-Tag
  `api-v1`; das Datenformat ist versioniert (`boersenampel-export/1`).

Geklärte Entscheidungen (mit Peter abgestimmt):
- Plattform der Trading-App: **offen** → Übergabe muss plattformneutral sein
  (Desktop-Programm, Web-App und Android-App gleichermaßen).
- Daten je Aktie: **Stammdaten + Ampelstand + Kennungen (ISIN/WKN/Ticker) + Kurs**;
  für Circle-Positionen zusätzlich die Trade-Daten.
- Auslöser: **Push UND Pull.**

## 2. Live verifizierte Fakten (24.08.2026)

- **Ampel-Analysetexte enthalten KEINE ISIN/WKN/Ticker** — nur Firmenname und
  [+]/[-]-Analysepunkte (geprüft an AAK AB, A2A, 3i Group). Für Ampel-Aktien lassen sich
  Symbol/Kennungen nur per Yahoo-Namenssuche als *unbestätigter Vorschlag* ermitteln.
  Circle-Module tragen ISIN/WKN/Ticker im Body (`circle.modules[id].trade.isin/wkn/ticker`).
- Kursauflösung existiert bisher nur für Circle-Positionen (`getCircleQuotes` in
  `extension/background.js`; Kandidaten ISIN/WKN/Name, `pickPlausibleQuote` mit Preis-Anker).
- Messaging: `runtime.onMessage`-Switch in `extension/background.js` (~Z. 976-1055) mit
  den Typen getState, pollNow, capture, openChart, circleQuotes, getStockBody,
  circlePollNow, circleSeen, acknowledge, setInterval, setBlink, setActivityDays.
  `createChartWindow` (~Z. 936) zeigt das Whitelist-Muster für Parameter.
- Storage-Formen: `current.stocks{id→{id,name,section,color,updatedAt}}`;
  `quotes{[yahooSymbol]→{symbol,price,currency,previousClose,at}}` (inkl. FX-Paare wie
  `EURUSD=X`); `quoteSymbols{[circleModuleId]→{symbol,query,resolvedAt,v}}` bzw.
  `{symbol:null,failedAt,v}`; `stockBodies{[stockId]→{text,bodyUpdatedAt,fetchedAt}}`.
- Popup: Ampel-Klick → `openStock(id)` (popup.js ~Z. 342) rendert `#stockDetail`
  (popup.html ~Z. 27-35). Circle 📈 → `openChartWindow(p, q)` (popup.js ~Z. 574) mit
  Payload `{symbol,name,buy,target,buyTs}`. `computePortfolio`-Positionen (lib/circle.js)
  haben KEIN Symbol/ISIN — Symbol aus `circleQuotes[id]`, ISIN aus `circle.modules[id].trade`.
- `lib/quotes.js` (globalThis): `fetchYahooQuote`, `fetchYahooSearch`, `pickYahooSymbol`,
  `pickPlausibleQuote`, `normalizeQuoteCurrency`, `fxPairSymbol`, `convertToEur`.
  Background-Helfer: `resolveYahooSymbol(query)` (~Z. 557), `cachedYahooQuote` (~Z. 568),
  `quoteEur` (~Z. 580), `DEFAULTS` (~Z. 30).
- Ladepunkte: `background.js:27` `importScripts('lib/debug.js','lib/ampel.js','lib/circle.js','lib/quotes.js')`;
  `manifest.firefox.json` `background.scripts` gleiche Liste + `background.js`;
  `popup.html` lädt nur `lib/ampel.js`, `lib/circle.js`, `popup.js` (KEIN quotes.js!).
  **`app/build-www.mjs` prüft den exakten alten Script-Block (`oldBlock`, ~Z. 56) —
  bei Änderung des Blocks in popup.html Marker mit anpassen, sonst bricht der App-Build.**
- Manifest (MV3): permissions storage/alarms/notifications; host_permissions skool.com +
  query1/query2.finance.yahoo.com; **kein** `externally_connectable`, **keine**
  `web_accessible_resources`. Firefox-Manifest separat.
- App-Shim: `tabs.create(url)` → `Plugins.Browser.open(url)` (shim.js ~Z. 214-221) —
  URLs öffnen geht in Add-on und App. Kein AppLauncher-Plugin, kein `appUrlOpen`-Listener,
  `windows.create` behandelt nur chart.html.
- Konventionen: deutsche UI-Texte und Code-Kommentare; `const api = globalThis.browser ||
  globalThis.chrome`; Promise-Form von `sendMessage`; nie bares `chrome.*`; Libs sind
  keine ES-Module (Exports auf globalThis); Tests `node test/*.test.mjs` mit
  `runInThisContext`; jeder Versionsbump braucht einen Eintrag in
  `extension/changelog.md` und `node build.mjs` (dist/ ist eingecheckt — das GitHub-ZIP
  ist, was Nicht-Entwickler installieren); `cd app && npm run build` für die App.
- Privacy-Regel des Projekts: Bezahlinhalte verlassen das Add-on nur auf ausdrückliche
  Nutzeraktion und nur bei `meta.lastPollOk` / `circleMeta.lastPollOk` (eingeloggt).

## 3. Empfehlungen / Entscheidungen im Plan

- **Version 0.7.0** (Feature-Sprung; `app-v0.7.0` ist ein anderer Namensraum, kein Konflikt;
  im Changelog als `## 0.7.0 – Datum` führen).
- **Git-Tag `api-v1`** auf den 0.7.0-Commit. Stabilitätsregel: unter `/1` dürfen Felder nur
  hinzukommen, nie entfernt/umbenannt/umgetypt werden; Bruch → `/2` + `api-v2`.
- **Transport jetzt (plattformneutral, keine neuen Berechtigungen):**
  (a) Push per konfigurierbarer **Trader-URL-Vorlage** in den Einstellungen, `{data}` =
  base64url(UTF-8-JSON), geöffnet mit `api.tabs.create` — Desktop-Programm registriert ein
  eigenes URL-Schema, Web-App nimmt https, Android-App einen Intent-Filter;
  (b) Pull per **„Ampel als JSON exportieren"** (Zwischenablage + Datei-Download).
  Plattformspezifische Live-Kanäle folgen nach dem PRD (Abschnitt 8).
- Kein Analysetext im Export (größter Content-Wert, für den Trader nicht nötig).
- Voll-Export **nicht** per URL (30–40 KB) — nur Datei/Clipboard. Einzelaktie ≈ 1 KB
  base64url, unkritisch (Chrome ~2 MB, Firefox ~1 MB, Android-Intent ~500 KB, Windows-
  Shell-Argument 32 KB).

## 4. Datenformat `boersenampel-export/1`

Envelope:
```jsonc
{
  "schema": "boersenampel-export/1",
  "kind": "stock" | "ampel",
  "generatedAt": "2026-08-24T15:02:11.000Z",
  "generator": { "name": "Börsenampel Watcher", "version": "0.7.0", "platform": "extension" | "app" },
  "stock": { …Stock },                       // nur kind:"stock"
  "ampel": {                                 // nur kind:"ampel"
    "courseTitle": "…", "courseUpdatedAt": "…", "stockCount": 41,
    "sections": [ { "id", "title", "color", "updatedAt" } ],
    "stocks": [ …Stock ],                    // sortiert Farbe (green,yellow,red,other) → Name
    "circle": { "positions": [ …Stock ] } | null
  }
}
```
`Stock`:
```jsonc
{
  "scope": "ampel" | "circle",
  "id": "<skool module id>", "name": "Adidas AG",
  "skoolUrl": "https://www.skool.com/…?md=<id>", "updatedAt": "…",
  "ampel": { "color": "green"|"yellow"|"red"|"other", "section": "grüne Ampel" } | null,
  "identifiers": { "isin": null, "wkn": null, "ticker": null, "source": "circle-body" | null },
  "symbol": { "yahoo": "ADS.DE" | null, "resolved": "isin"|"wkn"|"name-search"|null,
              "verified": false, "resolvedAt": "…" | null },
  "quote": { "price": 161.2, "currency": "EUR", "priceEur": 161.2,
             "previousClose": 159.9 | null, "at": "…" } | null,
  "trade": { "status": "open"|"closed", "buyDate": "2026-08-03" | null,
             "buyPriceEur": 42.32, "qty": 12, "totalBuyEur": 507.84,
             "targetPriceEur": 46.55, "incomplete": false } | null   // nur scope:"circle"
}
```
Regeln: unbekannt = immer `null`, nie fehlend; Beträge als Number; Zeiten ISO-8601;
Ampel-Aktien haben `identifiers.* = null` und `symbol.verified = false` → die Trading-App
MUSS den Vorschlag bestätigen lassen; Circle: `verified = true` genau dann, wenn per
Preis-Anker aufgelöst (`quoteSymbols[id].query === trade.isin/wkn` → `resolved:
"isin"/"wkn"`, sonst `"name-search"`); `targetPriceEur` = Kursziel-Feld `currentPrice`
aus `computePortfolio`; `priceEur` via bestehendem `convertToEur` (GBp-Pence beachten);
kein Namens-Matching Circle↔Ampel (Autor-Stammdaten unsauber) → `ampel: null` bei Circle.

## 5. Umsetzung (Schrittfolge)

### 5.1 Neue pure Lib `extension/lib/export.js` + `test/export.test.mjs`
globalThis-Exports, kein `api.*`/`fetch`, Zeit als Parameter. Nutzt `stockUrl` (ampel.js),
`circleModuleUrl`/`computePortfolio` (circle.js), `normalizeQuoteCurrency`/`fxPairSymbol`/
`convertToEur` (quotes.js). Funktionen:
`EXPORT_SCHEMA`, `buildAmpelStockExport(stock, ctx)`, `buildCircleStockExport(module,
position, ctx)`, `buildAmpelExport(state, ctx)`, `wrapExport(kind, payload, ctx)`,
`stockQuoteFromCache(symbol, quotes, now)`, `symbolInfoFromEntry(entry, trade)`,
`isoDateFromGerman(s)`, `encodeExportForUrl(obj)` / `decodeExportFromUrl(s)` (UTF-8-sicher,
base64url ohne `=`), `fillTraderUrl(template, encoded, {id, name})` (Pflicht `{data}`,
optional `{id}`/`{name}` URL-kodiert; erlaubt http(s) und eigene Schemata
`[a-z][a-z0-9+.-]*:`), `sortedAmpelStocks(current)`. `ctx = {quotes, quoteSymbols, now,
generator}`. Cache-Namensraum für Ampel-Symbole: `quoteSymbols['ampel:' + id]`
(kollidiert nicht — `getCircleQuotes` iteriert nur `circle.modules`).

Test lädt quotes.js → ampel.js → circle.js → export.js via `runInThisContext` (Muster
`test/circle.test.mjs`). Fälle: Ampel-Aktie ohne Cache (alles `null`, `verified:false`);
mit `ampel:<id>`-Cache + USD-Kurs + `EURUSD=X` → `priceEur`; Circle-Position
(`resolved:'isin'`, `verified:true`, `targetPriceEur`, ISO-`buyDate`); Sortierung +
`stockCount`; base64url-Round-Trip mit Umlauten („Ströer"); `fillTraderUrl`-Validierung;
Schlüsselmenge des Envelopes als Stabilitäts-Assert.

### 5.2 Ladepunkte
- `background.js` importScripts + `'lib/export.js'`; `manifest.firefox.json`
  `background.scripts` + `lib/export.js` vor `background.js`.
- `popup.html`: zusätzlich `lib/quotes.js` und `lib/export.js` laden.
- `app/build-www.mjs`: `oldBlock`/`newBlock` an den geänderten Script-Block anpassen.

### 5.3 Background (`extension/background.js`)
- `DEFAULTS` + `traderUrl: ''`; Nachricht `setTraderUrl {url}` nach dem Muster
  `setActivityDays`; leer = aus; Validierung über `fillTraderUrl`.
- `resolveAmpelSymbol(stock, symbols, now)`: Namenssuche via `resolveYahooSymbol(name)`
  ohne Anker; Eintrag `{symbol, query: name, resolvedAt, v: SYMBOL_RESOLVE_VERSION,
  via: 'name-search'}` bzw. `{symbol:null, failedAt, v}` unter `'ampel:' + id`;
  Retry-Logik wie in `getCircleQuotes` (2 Min).
- Kleine Extraktion `resolveCirclePosition(m, symbols, quotes, now)` aus der Schleife in
  `getCircleQuotes`, von dort UND vom Export genutzt (kein Duplikat).
- `exportStock({id, scope})`: Whitelist (`scope ∈ {'ampel','circle'}`, `id` String),
  `DEBUG_SIMULATE` und `lastPollOk` respektieren. Ampel-Pfad: `current.stocks[id]` →
  `resolveAmpelSymbol` → `cachedYahooQuote`/`quoteEur` → Lib. Circle-Pfad:
  `circle.modules[id]` + Position aus `computePortfolio`. Antwort `{ok, export|error}`;
  `quoteSymbols`/`quotes` zurückschreiben.
- `exportAmpel()`: alle Ampel-Aktien + offene Circle-Positionen **nur aus Cache** (kein
  Netz — 40 Namenssuchen wären >10 s und Yahoo-Drossel-Risiko); nie automatisch/periodisch.
- `generator.platform`: `globalThis.__appFireStartup ? 'app' : 'extension'`; Version aus
  `api.runtime.getManifest()` in try/catch (in der App `null`).
- Switch: `case 'exportStock'`, `'exportAmpel'`, `'setTraderUrl'`.
- Das **Öffnen der URL macht das Popup** (Nutzergeste, `api.tabs.create`), nicht der Worker.

### 5.4 Popup (`popup.html`, `popup.js`, `popup.css`)
- `#stockDetail`: Button `#detailTrader` „Zum Trader ↗" in `.detail-head`, `hidden`
  solange `settings.traderUrl` leer; in `openStock(id)` aktivieren; Tooltip „Symbol per
  Namenssuche vorgeschlagen (ungeprüft)".
- Circle „Laufende Positionen": zweiter Button 📤 in derselben `chart-col`-Zelle wie 📈
  (keine Tabellenänderung), `stopPropagation` wie beim Chart.
- `pushToTrader(id, scope)`: Button „…" → `send({type:'exportStock', id, scope})` →
  `fillTraderUrl(settings.traderUrl, encodeExportForUrl(r.export), {id, name})` →
  `api.tabs.create({url})`.
- Footer: Feld `#traderUrl` + „Speichern" (Muster `interval`) mit roter Rückmeldung bei
  fehlendem `{data}`; Button `#exportBtn` „Ampel als JSON" nur eingeloggt:
  `navigator.clipboard.writeText` + Download per Blob/`<a download="boersenampel-YYYYMMDD-HHMM.json">`
  in try/catch (Firefox schließt ggf. das Popup beim Download → Clipboard ist der
  verlässliche Weg; in der App nur Clipboard).
- `renderAll()` setzt Sichtbarkeit der Trader-Buttons aus `state.settings.traderUrl`.

### 5.5 App-Shim (`app/src/shim.js`, `tabs.create`)
URLs, die nicht mit `http(s):` beginnen (eigenes Schema wie `boersentrader://…`), nicht an
`Browser.open` geben (Custom Tab → Fehlerseite), sondern `window.open(url, '_system')`
bzw. `location.href` in try/catch (Android reicht unbekannte Schemata an den
Intent-Resolver). Sauber später mit `@capacitor/app-launcher` (Abschnitt 8).

### 5.6 Doku, Version, Tag
- **`API.md`** (Repo-Wurzel, Deutsch): Schema mit Feldtabelle + Semantik; zwei
  Beispiel-Payloads (Ampel-Aktie ohne IDs, Circle-Position mit ISIN); Kodierung +
  3-Zeilen-Decoder in JS/Python/Kotlin; Transporte; Empfänger-Rezepte je Plattform
  (Desktop: URL-Schema in Windows-Registry `HKCU\Software\Classes\<schema>\shell\open\command`,
  Linux `.desktop` mit `MimeType=x-scheme-handler/<schema>` + `xdg-mime default`,
  macOS `CFBundleURLTypes`; Web: `#data=`-Fragment empfohlen, damit nichts in Server-Logs
  landet; Android: `<intent-filter>` mit `android:scheme`); Grenzen (URL-Länge,
  Yahoo-Rate-Limits, Kurs-Alter `quote.at`); Stabilitätsversprechen `api-vN`; geplante Kanäle.
- README: Abschnitt „Schnittstelle zum Trader" mit Link auf API.md.
- Version **0.7.0** in beiden Manifesten; `extension/changelog.md` Eintrag `## 0.7.0`
  („Zum Trader"-Knopf, Trader-Adresse in den Einstellungen, JSON-Export, `- Doku: API.md`).
- CLAUDE.md: Layout (neue Lib, Ladepunkte, build-www-Marker) + Abschnitt
  „Trader-Schnittstelle (v0.7.0, Tag api-v1)": Schema-Regel, `ampel:<id>`-Namensraum,
  Privacy-Regel, URL-Länge, Shim-Sonderfall, Testdatei.
- `node build.mjs`, `cd app && npm run build`; Commit; `git tag api-v1`; Tag pushen.

## 6. Verifikation
1. `node test/export.test.mjs`, dann alle Suiten (`circle`, `lifecycle`, `quotes`) + `node --check`.
2. Chrome (unpacked `extension/`): Vorlage `https://httpbin.org/anything?data={data}`
   setzen → Ampel-Aktie öffnen → „Zum Trader" → httpbin zeigt `data`; in der Konsole
   dekodieren: `JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))))`
   → Felder und `verified:false` prüfen; Circle-Position 📤 → ISIN + `verified:true`;
   „Ampel als JSON" → Datei + Clipboard; Vorlage leeren → Buttons verschwinden;
   Worker-Konsole ohne Warnungen; `storage.local.quoteSymbols` zeigt `ampel:`-Schlüssel.
3. Firefox über `dist/firefox` (about:debugging): gleiche Schritte, Clipboard-Pfad.
4. App: `cd app && npm run build` läuft (Marker!), Smoke im Desktop-Browser über
   `www/index.html`; Custom-Schema-Test erst mit einer Empfänger-App.
5. `git tag api-v1` nach dem Release-Commit.

## 7. Risiken
- Fehlzuordnung bei Ampel-Aktien (Namenssuche ohne Anker) → `verified:false` + Tooltip;
  Bestätigungspflicht in der Trading-App.
- Privacy: Export nur per Klick, nie automatisch; Web-Ziel bekommt Daten in der URL →
  Fragment-Variante empfehlen; kein Analysetext im Payload.
- Yahoo-Drossel beim Voll-Export → Cache-only.
- Firefox: Popup schließt beim Download; kein `externally_connectable`.
- App: Custom-Schema über `Browser.open` scheitert ohne Shim-Fallback; Blob-Download im
  WebView nicht möglich (nur Clipboard).
- `app/build-www.mjs`-Marker bricht bei geändertem Script-Block — bewusst mitändern.

## 8. Geplante Folge-Kanäle (in API.md dokumentieren, erst nach dem PRD bauen)
- Chrome/Edge: `externally_connectable` + `runtime.onMessageExternal` → echte Pull-API
  für eine Web-App/andere Extension (Firefox kann das nicht → dort Datei/Clipboard).
- Desktop: `POST` an `http://127.0.0.1:<port>/import` via `optional_host_permissions`
  (Nutzergeste im Popup); erlaubt Voll-Export ohne URL-Grenze.
- Android: `@capacitor/app-launcher` (Push), `appUrlOpen` + Schema `boersenampel://export`
  (Pull durch die Trader-App) oder `@capacitor/share`.
- Native Messaging (Browser → Desktop-Binary) nur, falls die Desktop-Variante gewinnt.

## 9. Offene Punkte für Peter
- Name des URL-Schemas der Trading-App (Vorschlag `boersentrader://import?data={data}`).
- Soll der Voll-Export auch offene Circle-Positionen enthalten (Plan: ja, `ampel.circle`)?
- Nach dem PRD: Plattform festlegen → passenden Live-Kanal aus Abschnitt 8 umsetzen.
