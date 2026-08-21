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
  wie eingestellt). Echtes Hintergrund-Polling bei geschlossener App ist als
  nächster Schritt vorgesehen (Background Runner, `src/runner.js`).

## Installation aus GitHub-Release (Sideload)

APK aufs Handy übertragen, antippen, einmalig "Installation aus unbekannten
Quellen" für den Dateimanager/Browser erlauben. Updates: neue APK einfach
drüberinstallieren (gleiche Signatur nötig).
