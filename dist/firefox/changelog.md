# Update-Historie

> Wartungshinweis (wird im Popup NICHT angezeigt): Diese Datei bei JEDER neuen
> Version ergänzen (neueste zuerst). Format: `## Version – Datum`, darunter
> Stichpunkte mit `- `. Für Nicht-Techniker schreiben. Zeilen mit `>` überspringt
> der Renderer. Die Android-App hat eigene Versionsnummern (Tags app-vX.Y.Z):
> ihre Releases stehen hier als `## App X.Y.Z – Datum` in derselben Liste.

## App 0.8.2 – 31.08.2026
- Neu: **Circle-Gesamtübersicht** („📈 Verlauf" neben „Auswertung"): Kurven vom ersten Kauf bis heute – Kaufvolumen, eingesetztes Kapital, aktuell im Markt, Portfolio-Wert zum Tageskurs, 1.500 €/Woche × 10, realisierte Gewinne, Potenzial, Kosten – einzeln ein-/ausblendbar, Zeitraum wie bei den Kurs-Charts (plus „1J").
- Auswertung: „Kaufvolumen (kumuliert)" statt „Investiert", neue Kachel „Eingesetztes Kapital".
- Ampel: Vortags-Veränderung grün/rot, Legende über den Gruppen.

## App 0.8.3 – 31.08.2026
- Kurs-Charts mit Zeitraum „1J"; kleine drehende Lade-Anzeige bei allen Ladevorgängen.

## 0.8.3 – 31.08.2026
- Doku: Die Anleitungen lassen sich jetzt als PDF mit farbigen Symbolen erzeugen (`node tools/md2pdf.mjs ANLEITUNG-APP.md`). App-Anleitung: genau erklärt, wie man sich ein Skool-Passwort anlegt, wenn man sich bisher nur „mit Google" anmeldet; liegt jetzt auch als `ANLEITUNG-APP.pdf` im Projekt.
- Kurs-Charts: neuer Zeitraum-Knopf **„1J"** (ein Jahr), wie im Verlauf.
- Ladevorgänge (Login-Prüfung, „Jetzt prüfen", „Kurse laden", Analyse-Text, Charts, Verlauf) zeigen jetzt einen kleinen drehenden Ring – man sieht, dass etwas passiert, ohne dass es stört.

## 0.8.2 – 31.08.2026
- Verlauf: Reihenfolge der Kurven-Schalter neu (Kaufvolumen, Eingesetztes Kapital, Aktuell im Markt, Portfolio-Wert, 1.500 €/Woche × 10, Realisierte Gewinne, Potenzial, Kosten); „Annahme:" aus der Beschriftung gestrichen.

## 0.8.1 – 31.08.2026
- Auswertung: „Investiert (kumuliert)" heißt jetzt ehrlich **„Kaufvolumen (kumuliert)"** – es ist der Umschlag, wieder angelegte Verkaufserlöse zählen darin erneut. Neu daneben: **„Eingesetztes Kapital"** – wie viel Geld mindestens von außen kommen musste (Käufe minus Verkaufserlöse, höchster Stand im Verlauf). Damit lässt sich die „eingesetzt"-Angabe des Autors direkt vergleichen.
- Verlauf: die Kurven heißen entsprechend „Kaufvolumen (kumuliert)" und „Eingesetztes Kapital (Untergrenze)".

## 0.8.0 – 31.08.2026
- Neu: **Circle-Gesamtübersicht als Kurvendiagramm** – Knopf „📈 Verlauf" im Block „Auswertung". Zeitachse vom ersten Kauf bis heute, Bedienung wie die Kurs-Charts (Auswahl-Leiste unten, Knöpfe Gesamt / 12h / Tage / Wochen / 1M / 3M / **1J**). Kurven: Investiert (kumuliert), Aktuell im Markt, Realisierte Gewinne, Potenzial (Kursziel), **Portfolio-Wert zum Tageskurs** (laufende Positionen mit den Kursverläufen von Yahoo Finance bewertet, Fremdwährungen mit dem heutigen Wechselkurs), **Kapitalbedarf** (harte Untergrenze der Einzahlungen: Käufe minus Verkaufserlöse, Maximum im Verlauf), die **Annahme „10 Wochen je 1.500 €"** als Vergleichslinie und **Kosten (geschätzt)** aus realisierten Bruttogewinnen minus „Zuwachs" laut Autor-Statistik. Jede Kurve lässt sich per Häkchen ein-/ausblenden, die Achse passt sich an; Mauszeiger über dem Chart zeigt alle Werte des Tages.
- Für die Wert-Kurve löst die Ampel beim Klick auch die Börsensymbole der bereits verkauften Positionen auf (einmalig, gemerkt); Kursverläufe werden lokal zwischengespeichert. Positionen ohne Kursverlauf zählen mit ihrer Kaufsumme – das steht dann unter der Legende.

## App 0.7.3 – 31.08.2026
- Neu: Kurse in der Ampel – „Kurse laden" je Gruppe holt Kurs in € und Veränderung 24 h (zum Vortagesschluss, grün/rot), der 📈-Knopf je Aktie öffnet den Chart. Nichts lädt automatisch.
- Verbessert: Zuordnung Aktienname → Börsensymbol (Bayer wurde vorher fälschlich als BMW erkannt; alle Ampel-Aktien lösen jetzt auf).

## 0.7.3 – 31.08.2026
- Über den Ampel-Gruppen steht jetzt eine kleine Legende, sobald Kurse geladen sind: „Kurs in € · darunter Veränderung 24 h (zum Vortagesschluss)".

## 0.7.2 – 31.08.2026
- Behoben: Die Vortags-Veränderung unter dem Ampel-Kurs war immer grau – jetzt grün (gestiegen) bzw. rot (gefallen).

## 0.7.1 – 31.08.2026
- Neu: **Kurse in der Ampel.** Jede Ampel-Gruppe hat jetzt einen Knopf „Kurse laden" – er holt für alle Aktien der Gruppe den aktuellen Börsenkurs (Yahoo Finance, in €) und zeigt darunter, um wie viel Prozent der Kurs gegenüber dem Vortagesschluss gestiegen oder gefallen ist. Nichts wird von selbst geladen (die Ampel führt über 50 Aktien) – nur auf Klick. Einmal ermittelte Börsensymbole merkt sich die Ampel dauerhaft, Kurse 5 Minuten; beim nächsten Öffnen stehen bekannte Kurse sofort wieder da (leicht ausgegraut, wenn älter als 5 Minuten). Das Laden läuft parallel und gebündelt, die Zeilen füllen sich nach und nach.
- Neu: **📈-Knopf je Ampel-Aktie** öffnet den Kurs-Chart – wie im Circle, nur ohne Einkaufs-/Kursziel-Linie. Ist das Symbol noch unbekannt, wird es beim Klick ermittelt (nur für diese eine Aktie).
- Neu: **„In eigenem Fenster öffnen ↗" auch im Ampel-Tab.** Das eigenständige Fenster startet dann in der Ampel; ein Chart-Klick aus dem Popup heraus öffnet es ebenfalls in der Ampel. Ist das Fenster schon offen, wechselt es nur den Tab.
- Verbessert: Die Zuordnung Aktienname → Börsensymbol prüft den Firmennamen jetzt genau (Rechtsformen ignoriert, Umlaute, ein Tippfehler erlaubt), probiert mehrere Schreibweisen (Klammerzusatz, erstes/letztes Wort) und bevorzugt Euro-Börsen nur innerhalb derselben Firma. Vorher konnte „Bayer" auf BMW („Bayerische Motoren Werke") landen; „Muenchner Rückversicherung" und „Dr. Ing. hc. F. Porsche AG (Porsche AG)" fanden gar nichts. Im Live-Test wurden alle 54 Ampel-Aktien korrekt aufgelöst; das getroffene Symbol steht im Tooltip des Kurses.
- Die App bekommt dieselben Funktionen mit dem nächsten App-Update (gleicher Code).

## 0.7.0 – 24.08.2026
- Interne Vorbereitungen für eine spätere Erweiterung – im Popup noch nicht sichtbar. Ampel- und Circle-Tab sind unverändert.

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
