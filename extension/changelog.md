# Update-Historie

> Wartungshinweis (wird im Popup NICHT angezeigt): Diese Datei bei JEDER neuen
> Version ergänzen (neueste zuerst). Format: `## Version – Datum`, darunter
> Stichpunkte mit `- `. Für Nicht-Techniker schreiben. Zeilen mit `>` überspringt
> der Renderer. Die Android-App hat eigene Versionsnummern (Tags app-vX.Y.Z):
> ihre Releases stehen hier als `## App X.Y.Z – Datum` in derselben Liste.

## 0.7.1 – 31.08.2026
- Neu: **Kurse in der Ampel.** Jede Ampel-Gruppe hat jetzt einen Knopf „Kurse laden" – er holt für alle Aktien der Gruppe den aktuellen Börsenkurs (Yahoo Finance, in €) und zeigt darunter, um wie viel Prozent der Kurs gegenüber dem Vortagesschluss gestiegen oder gefallen ist. Nichts wird von selbst geladen (die Ampel führt über 50 Aktien) – nur auf Klick. Einmal ermittelte Börsensymbole merkt sich die Ampel dauerhaft, Kurse 5 Minuten; beim nächsten Öffnen stehen bekannte Kurse sofort wieder da (leicht ausgegraut, wenn älter als 5 Minuten). Das Laden läuft parallel und gebündelt, die Zeilen füllen sich nach und nach.
- Neu: **📈-Knopf je Ampel-Aktie** öffnet den Kurs-Chart – wie im Circle, nur ohne Einkaufs-/Kursziel-Linie. Ist das Symbol noch unbekannt, wird es beim Klick ermittelt (nur für diese eine Aktie).
- Neu: **„In eigenem Fenster öffnen ↗" auch im Ampel-Tab.** Das eigenständige Fenster startet dann in der Ampel; ein Chart-Klick aus dem Popup heraus öffnet es ebenfalls in der Ampel. Ist das Fenster schon offen, wechselt es nur den Tab.
- Verbessert: Die Zuordnung Aktienname → Börsensymbol prüft den Firmennamen jetzt genau (Rechtsformen ignoriert, Umlaute, ein Tippfehler erlaubt), probiert mehrere Schreibweisen (Klammerzusatz, erstes/letztes Wort) und bevorzugt Euro-Börsen nur innerhalb derselben Firma. Vorher konnte „Bayer" auf BMW („Bayerische Motoren Werke") landen; „Muenchner Rückversicherung" und „Dr. Ing. hc. F. Porsche AG (Porsche AG)" fanden gar nichts. Im Live-Test wurden alle 54 Ampel-Aktien korrekt aufgelöst; das getroffene Symbol steht im Tooltip des Kurses.
- Die App bekommt dieselben Funktionen mit dem nächsten App-Update (gleicher Code).

## 0.7.0 – 24.08.2026
- Neu: **Synchronisation** (Block ganz unten im Popup, Standard aus): Die Ampel schreibt Ampelwechsel, neue/entfernte Aktien, bearbeitete Analysen (nur der Zeitpunkt) und Circle-Käufe/-Verkäufe als Ereignis-Protokoll in einen Sync-Ordner, den du selbst besitzt – per WebDAV (Nextcloud, kDrive, Filen-Server …) oder in einen lokalen Ordner, den dein Cloud-Programm synchronisiert (nur Chrome/Edge). Daraus kann eine Trading-App den aktuellen Stand lesen, auch auf anderen Geräten. Keine Analysetexte, kein Server der Ampel.
- „Verbindung testen", „Jetzt synchronisieren" und eine Statuszeile zeigen, ob alles ankommt; bei Fehlern warten die Ereignisse und werden beim nächsten Abruf nachgeholt.
- „Snapshot kopieren" legt das aktuelle Vollbild als JSON in die Zwischenablage (für Support und eigene Skripte).
- Ampel- und Circle-Tab sind unverändert.
- Doku: EVENTS.md (Format und Regeln der Schnittstelle), README und ANLEITUNG (Einrichtung).

## 0.6.9 – 24.08.2026
- Circle: Das Kursziel wird nicht mehr aus dem Titel gelesen, sondern aus der Zeile „7 Stück zum Kaufpreis: 575 € - Verkaufspreis: ?" im Beitrag. Steht dort „?", rechnet die Ampel Kaufpreis +10 %; steht eine Zahl, wird sie übernommen und gegen das 10-%-Ziel geprüft (Toleranz ca. 3 %) – bei starker Abweichung erscheint sie rot. Der Kurs im Titel ist nur der Tageskurs bei der letzten Bearbeitung des Eintrags und wird lediglich im Tooltip gezeigt. (Auslöser: Wells Fargo zeigte ein negatives Potenzial, weil Titel und Beitrag nicht zusammenpassten.)
- Circle: Beträge werden auch erkannt, wenn der Autor „Euro“, „euro“ oder „EUR“ statt „€“ schreibt (z. B. „zu 124,25 $ / 107,40 Euro je Aktie“). Dollar-Werte ($, Dollar, USD) werden nie als Euro gelesen. Alle 24 laufenden und abgeschlossenen Positionen live gegengeprüft.
- Doku: README und ANLEITUNG zum Kursziel aktualisiert.

## 0.6.8 – 24.08.2026
- Circle: Neue Schreibweisen des Autors werden verstanden – Kursziel in Dollar und Euro im Titel (z. B. Carnival, Alibaba) und die Kaufzeile „zu 27,85 $ / 24,03€ je Aktie". Betroffene Positionen erscheinen wieder vollständig mit Kursziel und Potenzial.
- Circle: Der Kaufpreis je Aktie kommt immer aus der Zeile „Kauf am … je Aktie" (Dollar-Wert optional).
- „Neue Seite"-Platzhalter des Autors werden nirgends mehr angezeigt – weder in der Ampel (Änderungen, Statuswechsel, Zuletzt bearbeitet) noch im Circle-Tab – und beim ersten Start einmalig aus dem Speicher gelöscht.
- Chart: Anzeige standardmäßig in Euro, auch wenn die Börse in Dollar oder Pfund notiert. Schalter „€ / USD" rechts oben wechselt auf die Börsenwährung. Umgerechnet wird mit dem aktuellen Wechselkurs (Hinweis in der Legende).
- Popup: Versionsnummer unten rechts – Klick darauf öffnet diese Update-Historie.
- Anleitung: Entwicklermodus muss in Chrome eingeschaltet bleiben (seit Chrome 133 schaltet Chrome die Ampel sonst ab); Hinweise zur „main (1).zip"-Falle beim Update und wie man die installierte Version prüft.

## App 0.7.0 – 21.08.2026
- Erste Version der Android-App: dieselbe Börsenampel (Ampel- und Circle-Tab, Charts) als App, Anmeldung bei Skool direkt in der App.
- Optionale Hintergrund-Prüfung mit Benachrichtigungen, auch wenn die App geschlossen ist.
- Update-Hinweis in der App, sobald eine neue Version auf GitHub liegt.
- Doku: Installationsanleitung für die App (ANLEITUNG-APP.md) für Nicht-Techniker.

## 0.6.7 – 21.08.2026
- Circle: Positions-Tabellen mit Suchfeld und sortierbaren Spalten.
- Doku: README und ANLEITUNG aktualisiert.

## 0.6.6 – 21.08.2026
- Circle: Doppelte Kauf-/Verkaufsmeldungen verhindert (überlappende Abrufe).
- Circle: Leere Platzhalter-Seiten lösen keine Kaufmeldung mehr aus.

## 0.6.5 – 14.08.2026
- Circle: Summenzeile der laufenden Positionen zeigt auch das Kursziel-Potenzial.

## 0.6.4 – 14.08.2026
- Circle: Kurse erscheinen einzeln, sobald sie da sind, statt erst alle auf einmal.

## 0.6.3 – 14.08.2026
- Kurs-Symbole, die einmal nicht gefunden wurden, werden schnell erneut versucht; Diagnose-Hinweis bei fehlendem Kurs.

## 0.6.2 – 14.08.2026
- Schnelles Wiederöffnen zeigt sofort den letzten Stand (Abruf läuft im Hintergrund nach).

## 0.6.1 – 14.08.2026
- Hängengebliebene Kurs-Abfragen gelöst (z. B. Accor ohne Kurs).

## 0.6.0 – 14.08.2026
- Circle als eigenständiges Fenster (↗-Knopf), das offen bleibt und sich selbst aktualisiert.

## 0.5.1 – 0.5.6 – 14.08.2026
- Chart-Fenster überarbeitet: Auswahl-Leiste unter dem Chart, Startansicht „Seit Kauf", Kauf-Markierung, Tooltip beim Überfahren, Einkaufs-/Kursziel-Linien.
- Plausibilitätsprüfung der Kurs-Symbole (falsche ISIN im Skool-Modul wird erkannt).
- Chart-Fenster bleiben offen und kommen nach dem Schließen des Popups nach vorn.

## 0.5.0 – 14.08.2026
- Live-Kurse von Yahoo Finance für die laufenden Circle-Positionen, Spalte „Akt. Kurs" und 📈-Chart je Position.
- Doku: README und ANLEITUNG auf den Stand der Kurs-Funktionen gebracht.

## 0.4.0 – 14.08.2026
- Klick auf eine Aktie zeigt die Analyse direkt im Popup (mit „Zurück" und Skool-Link).
- Ampel-Zugang auch über die Circle-Mitgliedschaft erkannt; Beitritts-Knöpfe ohne Zugang.

## 0.3.0 / 0.3.1 – 13./14.08.2026
- Circle: Meldungen bei Kauf und Verkauf (Logbuch „Käufe & Verkäufe", goldener Punkt am Symbol).
- Breiteres Popup mit zusätzlichen Spalten der laufenden Positionen.
- Doku: Screenshots, Korrekturen in der Anleitung, MIT-Lizenz.

## 0.2.0 – 13.08.2026
- Neuer Tab „Circle": Auswertung „Aktienengagement Echtzeit" – eingesetztes Kapital, realisierte Gewinne, Potenzial der laufenden Positionen.

## 0.1.0 – 29.06.2026
- Erste Version: Börsenampel überwachen, Änderungen seit dem letzten Besuch (Neu / Wechsel / Bearbeitet / Entfernt), Menüpunkt-Änderungen, Statuswechsel-Logbuch, Suche, Benachrichtigungen und blinkendes Symbol.
- Chrome und Firefox.
- Doku: README, einfache Anleitung (ANLEITUNG.md) und ladefertige Ordner zum Verteilen; direkter ZIP-Download-Link.
