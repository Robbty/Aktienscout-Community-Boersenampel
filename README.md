# Börsenampel Watcher

Ein Browser-Add-on, das die **Börsenampel** der [Aktienscout-Community](https://www.skool.com/cybermoney-1123) auf Skool im Auge behält und dir zeigt, **was sich seit deinem letzten Besuch geändert hat** – ohne dass du ständig selbst nachschauen musst.

> 👉 **Du bist kein Entwickler?** Dann nimm die **[Anleitung in einfacher Sprache](ANLEITUNG.md)**.

<p align="center">
  <img src="docs/screenshot-uebersicht.png" alt="Übersicht" width="340">
  <img src="docs/screenshot-suche.png" alt="Suche" width="340">
</p>

## Was es kann

- 🟢🟡🔴 **Ampel-Übersicht** – grüne, gelbe und rote Ampel mit allen Aktien, aufklappbar.
- 🔎 **Schnellsuche** – Aktie eintippen, Enter springt direkt hin.
- 🆕 **„Seit deinem letzten Besuch"** – neue, gewechselte, entfernte Aktien auf einen Blick.
- 🕒 **Statuswechsel-Logbuch** – eine eigene Historie der Ampel-Wechsel der letzten *X* Tage (die Skool-Seite selbst hat keine Historie).
- 🔔 **Benachrichtigung + blinkendes Symbol**, wenn sich etwas tut.
- 💼 **Circle-Tab** – wertet zusätzlich die Aktienengagements der Community [„Der Circle zur ersten Million"](https://www.skool.com/der-circle-zur-ersten-million-6426) aus: investiertes Kapital (gesamt + aktuell im Markt), realisierte Gewinne und die unrealisierten Gewinne/Verluste der laufenden Positionen. Braucht eine eigene Mitgliedschaft dort; ohne Zugang zeigt der Tab, wie man beitreten kann.
- 🔒 **Privat** – liest nur deine eigene, eingeloggte Skool-Sitzung; nichts wird irgendwohin gesendet.

## Voraussetzungen

- Du bist **Mitglied der Aktienscout-Community** auf Skool und kannst die Börsenampel öffnen.
- Du bist in dem Browser, in dem das Add-on läuft, **bei skool.com angemeldet**. (Die Anmeldung allein genügt – du musst nicht auf der Ampel-Seite sein.)

Ohne Mitgliedschaft/Anmeldung zeigt das Add-on bewusst **keine** Daten.

## Installation

Lade das Projekt herunter – [**direkt als ZIP**](https://github.com/Robbty/Aktienscout-Community-Boersenampel/archive/refs/heads/main.zip) (oder auf der Projektseite oben rechts über der Dateiliste grüner Knopf **„< > Code" → Download ZIP**), dann entpacken. Oder klone es:

```bash
git clone https://github.com/Robbty/Aktienscout-Community-Boersenampel.git
```

Die fertigen, ladefertigen Ordner liegen unter `dist/`.

**Chrome / Edge / Brave / Opera**
1. `chrome://extensions` öffnen.
2. **Entwicklermodus** einschalten (oben rechts).
3. **„Entpackte Erweiterung laden"** → den Ordner **`dist/chrome`** auswählen.

**Firefox**
1. `about:debugging` öffnen → **„Dieses Firefox"**.
2. **„Temporäres Add-on laden…"** → die Datei **`dist/firefox/manifest.json`** auswählen.

> ℹ️ In Firefox ist das ein *temporäres* Add-on: Es verschwindet beim Schließen des Browsers und muss dann erneut geladen werden. Für eine dauerhafte Installation müsste das Add-on über einen Mozilla-Account signiert werden (`web-ext sign`).

Anschließend auf das Ampel-Symbol klicken und **„Jetzt prüfen"** – der erste Lauf setzt die Vergleichsbasis, ab dann werden Änderungen erkannt.

## Wie es funktioniert (kurz)

Skool ist eine Next.js-App; die komplette Ampel-Struktur steckt als sauberes JSON in der Seite (`__NEXT_DATA__`). Das Add-on liest dieses JSON – einmal pro Abruf im Hintergrund (mit deinen Login-Cookies) und zusätzlich bei jedem echten Seitenbesuch über ein Content-Script. Jede Aktie trägt einen `updatedAt`-Zeitstempel; daraus ergeben sich Wechsel/Neu/Bearbeitet/Entfernt durch Vergleich aufeinanderfolgender Lesungen. Alles wird nur lokal in `storage.local` gehalten.

## Für Entwickler

- **Quellcode:** alles in `extension/` (cross-browser geschrieben, `api = browser || chrome`).
- **Build:** `node build.mjs` erzeugt `dist/chrome` und `dist/firefox` aus `extension/` (nur das Manifest unterscheidet sich je Ziel). Keine Abhängigkeiten, kein Bundler.
- **Test:** `node test/lifecycle.test.mjs` prüft die Änderungserkennung über den ganzen Ablauf (Login → Bestätigen → Logout → Änderungen → Login) inkl. Logbuch und Begrenzung.
- **Syntax-Check:** `node --check extension/<datei>.js`.
- Mehr zu Architektur und Konventionen: siehe [`CLAUDE.md`](CLAUDE.md).

Nach Codeänderungen `node build.mjs` laufen lassen und die `dist/`-Ordner mit committen, damit die ladefertigen Builds aktuell bleiben.

## Lizenz

Noch keine Lizenz festgelegt. Wenn andere es frei nutzen/anpassen können sollen, empfiehlt sich z. B. eine MIT-Lizenz – einfach eine `LICENSE`-Datei ergänzen.

---

*Inoffizielles Community-Werkzeug. Steht in keiner Verbindung zu Skool und ist nicht mit den Betreibern der Aktienscout-Community abgestimmt.*
