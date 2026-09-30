# Börsenampel-Add-on dauerhaft in Firefox installierbar machen (v0.8.5)

> **Stand: umgesetzt und veröffentlicht am 30.09.2026.** Dieser Plan ist der freigegebene
> Stand VOR der Umsetzung; maßgeblich ist heute `CLAUDE.md` (Absatz „Firefox release").
> Abweichungen bei der Umsetzung:
> - Das GitHub-Release wird über `gh api … -f make_latest=false` angelegt, nicht mit
>   `gh release create --latest=false` (das installierte `gh` 2.4 kennt den Schalter nicht).
> - Zusätzlich: Gruppenkopf in `popup.js` per DOM statt `innerHTML` (Warnung des Mozilla-Linters).
> - Die Anleitung hat einen vierten Schritt (Haken „Erweiterung an Symbolleiste anheften") und
>   nennt die Datenübernahme vom temporär geladenen Add-on – beides erst an der signierten
>   Datei geprüft.

## Context

Peters Befund an `ANLEITUNG.md` („Einbauen in Firefox"):

1. Ein Schritt fehlt: der Bereich **„Temporäre Erweiterungen"** muss erst aufgeklappt werden.
2. Der Satz „Eine dauerhafte Version ist möglich, braucht aber etwas mehr Aufwand" ist für
   Kunden eine Zumutung: Er deutet eine Lösung an, ohne den Weg zu nennen. So etwas soll es
   künftig in keinem Projekt mehr geben (globale Regel).
3. Frage: Was muss am Add-on geändert werden bzw. wie wird der „höhere Aufwand" umgesetzt?

**Antwort auf 3.** Firefox behält nur Add-ons dauerhaft, die Mozilla signiert hat. Unseres
ist unsigniert, deshalb geht heute nur „temporär laden". Die Lösung ist Mozillas
„Self-Distribution": Das Add-on wird je Version über ein kostenloses Mozilla-Konto
automatisch signiert (kein Store-Eintrag), heraus kommt eine `.xpi`-Datei. Der Kunde klickt
einen Link, bestätigt zweimal, fertig. Das Add-on bleibt dauerhaft und aktualisiert sich
selbst. Ohne Signatur geht es nur in Firefox Developer Edition/ESR/Nightly – für Kunden
keine Option.

**Entscheidungen von Peter (30.09.2026):** Verteilung über eigenen Link (kein Mozilla-Store);
das Add-on bekommt Version **0.8.5** (zieht mit der App gleich, kein App-Release nötig).

**Geprüft:**
- GitHub liefert `.xpi`-Release-Dateien mit `Content-Type: application/x-xpinstall` aus
  (an einem fremden Release gemessen) → Klick auf den Link startet direkt die Installation.
- Affiliate-Links in der eigenen Add-on-Oberfläche sind laut Mozilla-Richtlinie erlaubt.
- Die Gecko-ID `boersenampel-watcher@aktienscout` ist schon gesetzt (Pflicht bei MV3).
- Deutsche Firefox-Beschriftungen (aus dem Sprachpaket von Firefox 156): **„Dieser Firefox"**
  (die Anleitung schreibt fälschlich „Dieses Firefox"), Bereich **„Temporäre Erweiterungen"**,
  Knopf **„Temporäres Add-on laden…"**, Installationsdialog **„Hinzufügen"**,
  `about:addons` → Zahnrad → **„Add-on aus Datei installieren…"** / **„Auf Updates überprüfen"**.

## Was Peter beitragen muss [PETER]

Einmalig, ca. 5 Minuten:
1. Mozilla-Konto anlegen bzw. anmelden: https://addons.mozilla.org/developers/
2. API-Schlüssel erzeugen: https://addons.mozilla.org/developers/addon/api/key/
   → „JWT-Aussteller" und „JWT-Geheimnis".
3. Beide Werte in die Datei `.amo-credentials` im Projektordner eintragen (wird vorher
   git-ignoriert, Vorlage legt Claude an). Das Repo ist öffentlich – der Schlüssel darf nie
   committet werden.

Ohne Schlüssel lassen sich die Schritte 1–4 umsetzen, Schritt 5–6 nicht.

## Umsetzung

### 1. Globale Regel (sofort, unabhängig vom Rest)
`~/.claude/CLAUDE.md` – neuer Abschnitt „Anleitungen: keine Andeutung ohne Weg (Peters
Entscheidung, 30.09.2026)":
- In Kunden-/Nutzer-Doku nie auf eine bessere, dauerhafte oder alternative Lösung nur
  hinweisen („ist möglich, braucht mehr Aufwand"). Mindestens: Schritt-für-Schritt-Anleitung
  **oder** ein Link, unter dem der Weg beschrieben ist.
- Provisorien („Sparmaßnahmen") nie stillschweigend ausliefern: Peter vorher ausdrücklich
  sagen, dass es ein Provisorium ist, was die richtige Lösung wäre und was sie kostet.
- Anleitungen Schritt für Schritt an der echten Oberfläche prüfen: exakte Beschriftungen,
  kein ausgelassener Klick (auch „Bereich erst aufklappen").

### 2. Manifest – `extension/manifest.firefox.json` (+ `extension/manifest.json` nur Version)
- `version` → `0.8.5` in beiden Manifesten.
- `browser_specific_settings.gecko`:
  - `update_url`: `https://raw.githubusercontent.com/Robbty/Aktienscout-Community-Boersenampel/main/updates.json`
  - `data_collection_permissions: { "required": ["none"] }` – Pflicht für neu bei Mozilla
    eingereichte Add-ons (seit 03.11.2025). Begründung „none": Es verlassen keine
    personenbezogenen Daten den Browser; an Yahoo gehen nur Aktien-Kennungen, Skool wird mit
    der eigenen Sitzung des Nutzers gelesen. Der versteckte Sync-Block schreibt nur auf einen
    vom Nutzer selbst eingetragenen Server – beim Wieder-Einblenden neu bewerten.
  - `strict_min_version`: `121.0` → `140.0` (ab 140 zeigt Firefox die Datenangabe im
    Installationsdialog; ab 127 stehen die Website-Berechtigungen im Dialog, der bisherige
    Hinweis „unter about:addons erlauben" wird zur reinen Notfall-Hilfe).

### 3. Build und Freigabe-Werkzeug
- `build.mjs` → `buildTestVariant()`: im Test-Manifest `update_url` entfernen (eigene ID,
  soll nie Updates suchen).
- `.gitignore`: `.amo-credentials`, `*.xpi`, `web-ext-artifacts/`.
- Neu `updates.json` im Projekt-Stamm (getrackt), Format laut Mozilla:
  `{ "addons": { "boersenampel-watcher@aktienscout": { "updates": [ { version, update_link, update_hash: "sha256:…" } ] } } }`
- Neu `tools/release-firefox.mjs` (Node, ohne Abhängigkeiten; `web-ext` nur per
  `npx --yes web-ext`, das Stammprojekt bleibt ohne package.json):
  - `sign`: prüft (Version in `dist/firefox/manifest.json` = Quell-Manifest, Changelog-Eintrag
    vorhanden, Version noch nicht in `updates.json`), liest `.amo-credentials` oder
    `WEB_EXT_API_KEY`/`WEB_EXT_API_SECRET`, ruft
    `web-ext sign --channel=unlisted --source-dir dist/firefox --artifacts-dir web-ext-artifacts`,
    benennt das Ergebnis in `boersenampel-firefox-<version>.xpi` um.
  - `publish [datei.xpi]`: berechnet SHA-256, trägt die Version in `updates.json` ein, lädt
    in das **eine fortlaufende GitHub-Release mit Tag `firefox`** hoch: die versionierte Datei
    (Ziel von `update_link`) und eine Kopie mit festem Namen `boersenampel-firefox.xpi`
    (`--clobber`) – das ist der stabile Link für die Anleitung. Getrennt von `sign`, damit
    eine von Mozilla verzögert freigegebene Datei (Download aus dem Entwickler-Bereich)
    nachgereicht werden kann.
  - Das Release wird mit `gh release create firefox --latest=false` angelegt. **Zwingend:**
    der In-App-Updater (`app/src/app.js:246`) und der README-Link „neueste Version (APK)"
    lesen `releases/latest`; das muss das App-Release bleiben.

### 4. Doku
- **`ANLEITUNG.md` „Einbauen in Firefox"** neu, Hauptweg:
  1. Link klicken: `https://github.com/Robbty/Aktienscout-Community-Boersenampel/releases/download/firefox/boersenampel-firefox.xpi`
  2. Firefox-Rückfrage bestätigen (exakte Knopf-Beschriftung aus dem Sprachpaket übernehmen).
  3. „Börsenampel Watcher hinzufügen" → **„Hinzufügen"**. Bleibt dauerhaft, Updates automatisch.
  - Kasten „Firefox lädt die Datei nur herunter?" → `about:addons` → Zahnrad →
    „Add-on aus Datei installieren…".
  - Kasten „Bisher temporär geladen?" → einfach den Link klicken.
  - Der Zumutungs-Satz entfällt ersatzlos.
- **Temporäres Laden** bleibt als kurzer, ehrlich benannter Abschnitt „Nur zum Ausprobieren /
  für Entwickler", korrigiert: `about:debugging` → **„Dieser Firefox"** → Bereich
  **„Temporäre Erweiterungen"** aufklappen (falls eingeklappt) → **„Temporäres Add-on laden…"**
  → `dist/firefox/manifest.json`. Den Aufklapp-Schritt setze ich vor den Knopf, weil der Knopf
  in diesem Bereich sitzt – bitte korrigieren, falls du ihn an anderer Stelle gebraucht hast.
- **`ANLEITUNG.md` „Update einbauen → In Firefox"**: automatisch; von Hand über `about:addons`
  → Zahnrad → „Auf Updates überprüfen".
- **`README.md`**: Firefox-Installation auf den Link umstellen, ℹ️-Kasten ersetzen,
  „Für Entwickler" um Signieren/Freigabe ergänzen.
- **`extension/changelog.md`**: `## 0.8.5 – <Datum>` (dauerhafte Firefox-Installation per
  Link, automatische Updates; `- Doku: …`).
- **`CLAUDE.md`**: neuer Absatz „Firefox-Freigabe" (Signatur je Version nur einmal möglich →
  jede Änderung am Firefox-Paket braucht einen Versionssprung; Reihenfolge; Tag `firefox`
  mit `--latest=false` und warum; `.amo-credentials`; `updates.json`).
- `Handoff-rollover.md` (nur lokal) fortschreiben; Versionsangleichung als erledigt markieren.

### 5. Reihenfolge der Freigabe (braucht den Schlüssel)
1. `node build.mjs`, Tests, `npx web-ext lint --self-hosted --source-dir dist/firefox`.
2. `node tools/release-firefox.mjs sign` → signierte `.xpi`.
3. Signierte Datei lokal testen (siehe Verifikation) – **vor** jeder Veröffentlichung.
4. Nach Peters Okay: `publish` (GitHub-Release, nach außen sichtbar).
5. Erst danach Commit + Push (Manifeste, `dist/`, `updates.json`, Doku), damit die Anleitung
   nie auf eine nicht vorhandene Datei zeigt.

### 6. Falls der Schlüssel beim Umsetzen noch fehlt
Schritte 1–3 committen; in der Anleitung als Zwischenstand nur den fehlenden Schritt und
„Dieser Firefox" korrigieren und den Zumutungs-Satz durch eine ehrliche Erklärung mit Link
ersetzen (Mozilla-Hilfe zur Add-on-Signierung). Die Endfassung aus Schritt 4 folgt mit der
Freigabe.

### 7. Nach Verlassen des Plan-Modus
Diesen Plan nach `./.claude/plans/2026-09-30-firefox-dauerhafte-installation.md` kopieren
(globale Regel); ab dann gilt die Repo-Kopie.

## Verifikation

- `node --check` für geänderte JS-Dateien; alle 7 Suiten `node test/*.test.mjs` grün.
- `web-ext lint --self-hosted` ohne Fehler.
- Signierte `.xpi` in einem frischen Firefox-Profil (`firefox --no-remote --profile <Scratch>`):
  Installationsdialog zeigt Berechtigungen und „Datenerhebung: keine"; Firefox schließen und
  neu starten → Add-on noch da; Ampel- und Circle-Tab, Kurse, Chart-Fenster funktionieren.
- In Peters Profil mit bisher temporär geladenem Add-on: signierte Version installieren →
  bleiben Einstellungen und Chronik erhalten? (gleiche ID, erwartet ja – Ergebnis in den
  Kasten der Anleitung übernehmen.)
- Nach `publish`: `curl -sIL <stabiler Link>` → `application/x-xpinstall`;
  `gh api repos/Robbty/Aktienscout-Community-Boersenampel/releases/latest` zeigt weiter
  `app-v0.8.5`; `updates.json` über die raw-Adresse abrufbar und gültiges JSON.
- `about:addons` → „Auf Updates überprüfen" ohne Fehler. Der echte Update-Lauf lässt sich
  erst mit der nächsten Version beobachten – das steht so im Handoff.

## Nicht Teil dieses Plans

- Öffentlicher Eintrag im Mozilla-Store (abgelehnt zugunsten des eigenen Links).
- Chrome: Dort bleibt es beim Entwicklermodus; der Ausweg wäre der Chrome Web Store
  (5 $, „nicht gelistet") – steht in `Handoff-google-store-einrichtung.md`.
