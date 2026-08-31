# Rollover — Stand 31.08.2026 (v0.7.1) / 24.08.2026 (v0.7.0)

## Nachtrag 31.08.2026 — v0.7.1 gepusht

Auf Peters Wunsch: (1) „In eigenem Fenster öffnen ↗" auch im Ampel-Tab (Standalone
startet per `?tab=ampel` in der Ampel; offenes Fenster wird per `standaloneShowTab`
umgeschaltet), (2) je Ampel-Aktie Kurs in € + %-Veränderung zum Vortagesschluss +
📈-Chart-Knopf, (3) NIE automatisch laden — nur „Kurse laden" je Gruppe bzw. 📈 je Aktie;
Optimierung: Symbol-Cache dauerhaft (`quoteSymbols['ampel:'+id]`, `nv`-Version),
Erst-Auflösung mit Parallelität 3, Kurs-Auffrischung gebündelt über Yahoo
`v8/finance/spark` (20 Symbole je Request, keyless, ohne Währung), progressive Anzeige
über `ampelQuotesLive`. Namensauflösung neu (`pickYahooSymbolForName`,
`nameSearchQueries`): Live-Fehler „Bayer → BMW.DE" behoben, alle 54 Baseline-Namen
lösen auf. Details in CLAUDE.md (Phase 3b) und `extension/changelog.md`.

**Noch nicht im echten Browser verifiziert (wie unten für v0.7.0):** Kurs-Zellen/Knöpfe im
Popup, Gruppen-Laden mit ~25 Aktien (Dauer beim ersten Mal), ↗ aus dem Ampel-Tab,
Chart-Klick aus dem Ampel-Tab (Standalone in der Ampel + Chart obendrauf), Standalone-
Fenster-Umschaltung bei bereits offenem Fenster, App-Build (`app/www` gebaut, kein APK).
App-Release `app-v0.7.1` erst nach Gerätetest (Changelog-Eintrag `## App 0.7.1 – Datum`).

---

# Rollover — Stand 24.08.2026 abends, Wiedereinstieg am nächsten Tag

**Vor dem Start lesen:** `CLAUDE.md` (Abschnitt „Event-log interface (v0.7.0, tag events-v1)"),
`EVENTS.md` (Format), dann diesen Zettel. Memory-Regel: Doku + `extension/changelog.md`
IMMER vor jedem Push aktualisieren, dann `node build.mjs`.

## Wo wir stehen

- **v0.7.0 ist committet, getaggt (`events-v1`) und gepusht** (`6788d8e`, `main`).
  Event-Log-Sync (Sync-Ordner für die Trading-App) ist komplett implementiert:
  Libs `events.js`, `sync-webdav.js`, `sync-folder.js`, `sync-flush.js`; Background-
  Outbox/Snapshot-Regel; Footer-Block „Synchronisation" im Popup (Ampel-/Circle-Tab
  unverändert); Manifeste mit `optional_host_permissions`; App-Build-Marker angepasst.
- **Alle 6 Test-Suiten grün** (`events`, `sync-webdav`, `sync-flush` [End-to-End gegen
  lokalen Mini-WebDAV], `circle`, `lifecycle`, `quotes`). `dist/` und `app/www/` gebaut.
- Davor am selben Tag: v0.6.9 (Circle-Kursziel aus der Stück-Zeile, Währung auch als
  Euro/EUR; Titel-Kurs = Tageskurs bei letzter Bearbeitung, nur Tooltip).

## Was NICHT verifiziert ist (nur im echten Browser möglich — Peter oder mit ihm)

1. **Chrome, WebDAV live:** Erweiterung neu laden → Footer „Synchronisation" → Nextcloud
   (`https://…/remote.php/dav/files/NAME/`, App-Passwort) → „Verbindung testen" → Haken +
   „Speichern" (Origin-Berechtigungsdialog) → im Ordner `boersenampel/events/<id>/<heute>.jsonl`
   mit `ampel.snapshot`; Worker-Konsole (chrome://extensions → Service Worker) auf `[Sync]`-
   Warnungen prüfen. Delta provozieren: `current` in storage.local per DevTools ändern,
   „Jetzt prüfen" → `ampel.stock.moved` in der Tagesdatei, `seq` fortlaufend.
2. **Chrome, lokaler Ordner:** „Ordner wählen…" (Filen-/Proton-Desktop-Ordner) → Speichern →
   Popup schließen/öffnen: bleibt die Berechtigung (Chrome ≥ 122)? Outbox wird beim Öffnen
   geschrieben (`pageFlushIfNeeded` in popup.js). Standalone-Circle-Fenster ebenfalls.
3. **Firefox** (`dist/firefox` via about:debugging): erscheint der
   `optional_host_permissions`-Dialog? Falls Firefox das in MV3 nicht kennt → Fallback
   `optional_permissions` mit Origins im `manifest.firefox.json`.
4. **App:** `cd app && npm run build && npm run apk` — offen ist, ob CapacitorHttp die
   Methoden `MKCOL`/`PROPFIND` durchreicht. Falls nicht: in `sync-webdav.js` für diese
   beiden Methoden natives `fetch` nutzen (Shim sichert das echte `fetch` als `realFetch`
   in `app/src/shim.js:240` — ggf. als `globalThis.__realFetch` exportieren). App-Release
   (`app-v0.7.1`, `versionName` in build.gradle) erst nach Gerätetest; Changelog-Eintrag
   `## App 0.7.1 – Datum` nicht vergessen.
5. **Anbieter-Rezepte** in Prioritätsreihenfolge gegenprüfen: **Filen** (Filen-CLI
   `webdav`-Server auf `http://127.0.0.1:<port>` mit Chrome UND Firefox), dann kDrive
   (`https://<ID>.connect.kdrive.infomaniak.com/`, App-Passwort). Proton erst ab Ende 2026
   (SDK ohne Dritt-Login, Krypto-Umbau).

## Bekannte Lücken / bewusst offen

- Adapter „lokaler Ordner" schreibt nur, während Popup/Standalone-Fenster offen ist
  (Browser-Beschränkung). Option für später: Chrome-Offscreen-Dokument — nur wenn FSA-
  Schreiben dort tatsächlich klappt (nicht verifiziert).
- Android-App kann Filen in v1 NICHT beschreiben (kein WebDAV bei Filen, kein Ordner-Sync
  auf Android) → nur kDrive/Nextcloud vom Handy; Filen-SDK-Adapter ist die nächste Ausbaustufe.
- Ampel-Yahoo-Symbole erscheinen erst nach einigen Abrufen (3 Namenssuchen je Poll).

## Nächste Schritte (Vorschlag, in dieser Reihenfolge)

1. Live-Verifikation 1–3 oben mit Peter; Bugs fixen → v0.7.1 (Changelog!).
2. App-Test (4) → `app-v0.7.1`-Release.
3. Danach Trading-App-Seite: PRD, Leser = `test/tools/replay.mjs`-Logik (`reduceEvents`)
   portieren; Adapter `local` (echtes Append) + `webdav`; Namensraum `trader.*`.
4. Später laut Peter: dritte Karte im Popup mit privaten Ständen + Button zur Trading-App.

## Entscheidungen von Peter (24.08.2026), nicht erneut fragen

- Ampel-/Circle-Tab bleiben unverändert (alles Sync-bezogene im Footer).
- Laptop UND Handy schreiben beide (Dedup fachlich beim Leser).
- Anbieter-Priorität: 1. Filen, 2. kDrive, 3. Proton ab Ende 2026. Trading-App: Desktop zuerst.
- Circle-Kursziel: aus der Stück-Zeile (`?` → +10 %, Zahl → übernehmen, >3 % Abweichung rot).
