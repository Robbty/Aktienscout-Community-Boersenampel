# Börsenampel — Android-App

Capacitor-WebView-Wrapper um die Browser-Extension: gleiche Oberfläche, gleiche
Parser, gleiche Logik. `../extension/` bleibt die einzige Quelle der Wahrheit —
`build-www.mjs` kopiert sie beim Bauen und ersetzt die Browser-APIs durch
`src/shim.js` (Storage → Capacitor Preferences, Nachrichten → lokaler Bus,
Benachrichtigungen → Android-Notifications, Chart-Fenster → eigene Seite).

## Voraussetzungen

- Node ≥ 20, Java 21, Android SDK (`~/Android/Sdk`, siehe `android/local.properties`)
- Gerät mit USB-Debugging oder ein Emulator

## Bauen & Starten

```bash
npm install            # einmalig
npm run build          # www/ assemblieren + cap sync
npm run run            # auf angeschlossenem Gerät/Emulator starten
npm run apk            # Debug-APK: android/app/build/outputs/apk/debug/
```

Debuggen: App starten, dann in Desktop-Chrome `chrome://inspect` → WebView
inspizieren (Konsole/Netzwerk der App-Seite).

## Login

Die App zeigt bei fehlender Skool-Session einen Button **"Bei Skool anmelden"**
(im Kopfbereich). Er öffnet die Skool-Login-Seite in einer In-App-WebView; die
Session-Cookies landen im prozessweiten CookieManager, den auch die nativen
Abrufe (CapacitorHttp) verwenden. Nach erkanntem Login schließt sich die
WebView und die App lädt die Daten. Läuft die Session irgendwann ab (HTTP 403),
erscheint der Button wieder — gespeicherte Daten werden dabei, wie in der
Extension, weder überschrieben noch angezeigt.

Hinweis: Google-Login ("Sign in with Google") wird von Google in WebViews oft
blockiert — im Zweifel mit E-Mail/Passwort anmelden.

## Was anders ist als im Browser

- Kein Toolbar-Icon: das rote Badge ist ein Zähler am "Ampel"-Tab, die
  Blink-Option entfällt.
- Charts öffnen als eigene Seite (Zurück-Knopf unten rechts oder
  Android-Zurück), nicht als eigenes Fenster.
- Benachrichtigungen sind Android-Notifications (Berechtigung wird beim ersten
  Ereignis erfragt); sie entstehen, solange die App läuft (Polling-Intervall
  wie eingestellt).

## Hintergrund-Benachrichtigungen (optional)

Die Checkbox **"Hintergrund-Benachrichtigungen"** im Fußbereich aktiviert
einen Background Runner (`src/runner.js`, WorkManager-basiert): auch bei
geschlossener App wird periodisch gepollt (Android-Minimum ~15 min, der Runner
respektiert das eingestellte Intervall; Doze kann Läufe verschieben) und bei
Ampel-Änderungen bzw. Circle-Käufen/-Verkäufen eine Notification gezeigt.
Der Runner hält bewusst einen eigenen Vergleichsstand (CapacitorKV) und
bekommt das Session-Cookie von der App übergeben — läuft die Session ab,
meldet er das einmalig und die App zeigt beim nächsten Öffnen den
Login-Button.

## Installation & Updates

**Erstinstallation (Sideload):** APK aus dem GitHub-Release aufs Handy,
antippen, einmalig "Installation aus unbekannten Quellen" erlauben. Ohne
diesen Schritt geht es auf Android grundsätzlich nicht.

**Updates:** Die App prüft täglich das jüngste GitHub-Release (Tag-Schema
`app-vX.Y.Z`) und zeigt bei neuer Version einen Banner "Herunterladen" —
Android installiert die geladene APK als Update (gleiche Signatur
vorausgesetzt). Voll-Automatik: [Obtainium](https://github.com/ImranR98/Obtainium)
installieren und die Repo-URL eintragen, dann kommen Updates von selbst.

## Release bauen (Maintainer)

`npm run apk-release` signiert mit `android/release.keystore`
(Passwörter in `android/keystore.properties`, beides **git-ignoriert** —
Keystore sicher aufbewahren, ohne ihn können bestehende Installationen kein
Update mehr bekommen!). Dann `versionName` in `android/app/build.gradle`
prüfen und `gh release create app-v<version> <apk>` ausführen.
