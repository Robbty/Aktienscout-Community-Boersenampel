# 🚦 Börsenampel – die einfache Anleitung

Diese Anleitung ist für alle ohne Technik-Kram. Kurze Sätze. Schritt für Schritt. Los geht's!

> 📱 **Du willst die Börsenampel lieber auf dem Handy?** Es gibt sie auch als
> Android-App – mit eigener einfacher Anleitung: **[ANLEITUNG-APP.md](ANLEITUNG-APP.md)**.
> Diese Seite hier erklärt die Variante für den Computer-Browser.

---

## Was ist das?

Ein kleines Ampel-Symbol für deinen Browser. 🟢🟡🔴

Es schaut für dich in der **Aktienscout-Community** nach: Welche Aktie steht auf grün, gelb oder rot?

Und das Beste: Es sagt dir, **was sich geändert hat**. Ganz von allein.

Dazu gibt es den **Circle-Tab**: Er rechnet die Aktien-Engagements der Community
„Der Circle zur ersten Million" zusammen. Beide Teile funktionieren unabhängig voneinander.

Kein ständiges Nachschauen mehr. Das Symbol passt auf.

---

## Was kann es?

- 🟢🟡🔴 Zeigt alle Aktien nach Ampel sortiert.
- 🔎 Tippe einen Namen – und du bist sofort da.
- 📄 Klick auf eine Aktie – und du liest die **ganze Analyse direkt im Fenster**. Ohne Skool zu öffnen.
- 📈 **Neu:** „Kurse laden" zeigt zu jeder Aktie den **aktuellen Kurs** und die Veränderung zum Vortag – und der 📈-Knopf öffnet den **Chart**. Mehr dazu unten.
- 🆕 „Seit deinem letzten Besuch": Was ist neu? Was hat gewechselt?
- 🕒 „Statuswechsel der letzten X Tage": deine eigene kleine Chronik. *X* stellst du selbst ein.
- 🔔 Es blinkt und meldet sich, wenn etwas passiert.
- 💼 **Der Circle-Tab.** Er rechnet die Aktien-Engagements der Community „Der Circle zur ersten Million" für dich zusammen – jetzt auch mit **echten Börsenkursen und Charts**. Mehr dazu weiter unten.
- 🔒 Alles bleibt bei dir. Nichts wird verschickt.

👉 **Klick auf eine Aktie** zeigt die Analyse. Oben rechts steht dann **„In Skool öffnen"**, falls du doch zur Seite willst.

---

## Was du brauchst

1. Du bist in deinem Browser **bei skool.com angemeldet**. Das ist die einzige Grundvoraussetzung.
2. Für den **Ampel-Tab**: VIP-Mitgliedschaft in der Aktienscout-Community – **oder** eine Circle-Mitgliedschaft. Denn: Wer im Circle ist, darf die Börsenampel auch sehen. 👍
3. Für den **Circle-Tab**: Mitgliedschaft in „Der Circle zur ersten Million".

Du musst keine der Seiten offen haben – angemeldet sein genügt.

> Nicht angemeldet? Dann zeigt das Symbol nichts an. Das ist Absicht – deine Daten bleiben geschützt.
>
> Angemeldet, aber kein Mitglied? Dann zeigt dir der jeweilige Tab Knöpfe zum Beitreten
> (bei der Ampel: **VIP werden** oder **Circle beitreten**) – der andere Tab funktioniert ganz normal.

---

## Einbauen in Chrome (oder Edge, Brave, Opera)

1. **Lade das Projekt als ZIP herunter** – am einfachsten mit diesem direkten Link:
   👉 **[Projekt als ZIP herunterladen](https://github.com/Robbty/Aktienscout-Community-Boersenampel/archive/refs/heads/main.zip)**
   *(Alternativ auf der [Projektseite](https://github.com/Robbty/Aktienscout-Community-Boersenampel) oben rechts über der Dateiliste auf den grünen Knopf **„< > Code"** klicken → ganz unten **„Download ZIP"**.)*
2. **ZIP entpacken** (Rechtsklick → „Entpacken"). Merke dir den Ort.
3. Tippe oben in die Adresszeile: **`chrome://extensions`** und drücke Enter.
4. Schalte oben rechts den **Entwicklermodus** ein. 🛠️
5. Klick auf **„Entpackte Erweiterung laden"**.
6. Wähle den Ordner **`dist`** → **`chrome`** aus. Fertig! 🎉

Das Ampel-Symbol ist jetzt oben rechts. Tipp: Auf das Puzzleteil 🧩 klicken und die Ampel **anheften**, dann ist sie immer sichtbar.

> 🛠️ **Der Entwicklermodus muss eingeschaltet BLEIBEN.** Die Ampel kommt nicht aus dem Chrome Web Store, sondern direkt aus dem Ordner – und seit Chrome 133 (Anfang 2025) schaltet Chrome solche Erweiterungen **ab, sobald der Entwicklermodus aus ist** (Meldung: „nicht vom Chrome Web Store geprüft"). Schalter wieder an → die Ampel ist sofort wieder da, nichts geht verloren. Anlassen hat sonst keine Nachteile.

---

## Einbauen in Firefox

1. Projekt herunterladen und entpacken (wie oben, Schritte 1–2).
2. Tippe in die Adresszeile: **`about:debugging`** und drücke Enter.
3. Links auf **„Dieser Firefox"** klicken.
4. Rechts steht der Bereich **„Temporäre Erweiterungen"**. Siehst du darunter keinen Knopf, ist der Bereich eingeklappt – dann einmal auf die Überschrift **„Temporäre Erweiterungen"** klicken, damit er aufklappt.
5. Klick auf **„Temporäres Add-on laden…"**.
6. Geh in den Ordner **`dist`** → **`firefox`** und wähle die Datei **`manifest.json`**. Fertig! 🎉

> 🦊 **Wichtig bei Firefox:** Auf diesem Weg bleibt die Ampel nur, bis du Firefox schließt. Danach die Schritte 2–6 wiederholen.
>
> **Warum?** Firefox behält nur Add-ons dauerhaft, die Mozilla geprüft und digital signiert hat – die Ampel aus dem Ordner ist das noch nicht. Mozilla erklärt das hier: [Add-on-Signierung in Firefox](https://support.mozilla.org/de/kb/Add-on-Signierung-in-Firefox). Die signierte Ampel, die du mit einem Klick installierst und die dann dauerhaft bleibt, kommt mit Version 0.8.5; ab dann steht an dieser Stelle der Link dazu.
>
> Einen „Entwicklermodus" wie bei Chrome gibt es in Firefox nicht – `about:debugging` ist bereits die Entwickler-Seite, es muss nichts extra eingeschaltet werden.

---

## Die ersten Schritte

1. Klick auf das **Ampel-Symbol**. 🚦
2. Klick auf **„Jetzt prüfen"**.
3. Der erste Blick merkt sich den Stand. Darum steht da noch „keine Änderungen" – alles richtig so.
4. Ab jetzt sagt dir die Ampel Bescheid, sobald sich etwas tut. ✨

---

## Kurse und Charts in der Ampel 📈

Neben jeder Ampel-Gruppe (grün, gelb, rot) steht ein kleiner Knopf **„Kurse laden"**.
Ein Klick holt für alle Aktien der Gruppe den **aktuellen Börsenkurs** in Euro – und darunter
in klein, um wie viel Prozent die Aktie **gegenüber dem Vortag** gestiegen (grün) oder
gefallen (rot) ist. Die Zeilen füllen sich nach und nach; das dauert beim allerersten Mal
ein paar Sekunden, danach geht es schnell.

Warum nicht automatisch? Die Ampel führt über 50 Aktien – die Kurse würden jedes Öffnen
bremsen. Darum lädst du sie nur, wenn du sie sehen willst. Einmal geladene Kurse bleiben
stehen; sind sie älter als fünf Minuten, erscheinen sie etwas blasser – „Kurse laden"
frischt sie auf.

Ganz rechts in jeder Zeile: der **📈-Knopf**. Er öffnet den **Chart** der Aktie (wie im
Circle, nur ohne Einkaufs- und Kursziel-Linie). Falls die Ampel das Börsensymbol noch nicht
kennt, ermittelt sie es beim Klick – nur für diese eine Aktie.

> Steht statt eines Kurses ein „–", hat Yahoo Finance zu diesem Namen nichts Passendes
> gefunden. Fährst du mit der Maus über einen Kurs, siehst du, welches Börsenkürzel
> gewählt wurde – so fällt eine falsche Zuordnung auf.

Auch der Knopf **„In eigenem Fenster öffnen ↗"** gibt es jetzt oben im Ampel-Tab: Die Ampel
wird zum eigenen Fenster, das offen bleibt, bis du es schließt.

---

## Der Circle-Tab 💼

Oben im Fenster gibt es zwei Reiter: **Ampel** und **Circle**.

Der Circle-Tab schaut in die Community **„Der Circle zur ersten Million"**. Dort macht der Autor echte Aktien-Käufe und -Verkäufe öffentlich.

Das Add-on rechnet alles für dich zusammen:

- 💰 **Kaufvolumen (kumuliert)** – die Summe aller Käufe. Achtung: Geld, das aus einem Verkauf wieder angelegt wurde, zählt hier erneut – das ist der Umschlag, nicht das eingezahlte Geld.
- 🏦 **Eingesetztes Kapital** – wie viel Geld mindestens von außen kommen musste, damit alle Käufe bezahlt werden konnten (Käufe minus Verkaufserlöse, der höchste Stand im Verlauf). Lässt sich mit der „eingesetzt"-Angabe des Autors vergleichen.
- 📈 **Aktuell im Markt** – wie viel gerade in laufenden Käufen steckt.
- ✅ **Realisierte Gewinne** – was bei den Verkäufen herauskam.
- 🔮 **Potenzial (Kursziel)** – was drin ist, wenn alle laufenden Positionen ihr Kursziel erreichen.

Darunter siehst du jede Position einzeln. Klick drauf – und sie öffnet sich in Skool.

**Neu: Suchen und Sortieren.** 🔎 Über den Tabellen gibt es ein Suchfeld –
tippe einen Namen an, und beide Tabellen zeigen nur noch die Treffer (die
Summenzeile rechnet dann nur diese zusammen). Und ein Klick auf eine
**Spaltenüberschrift** sortiert die Tabelle – ein zweiter Klick dreht die
Richtung um. Der kleine Pfeil zeigt dir, wonach gerade sortiert ist.

**Neu: echte Börsenkurse.** 📊 Bei den laufenden Positionen siehst du jetzt:

- den **Einkaufspreis** und den **Einsatz**,
- den **aktuellen Börsenkurs** – mit Prozent: Wie weit ist die Aktie seit dem Kauf gestiegen oder gefallen?
- das **Kursziel** – der Verkaufskurs, den der Autor anpeilt. Steht im Beitrag „Verkaufspreis: ?“, rechnet die Ampel Kaufpreis +10 %; steht eine Zahl, wird sie übernommen und **rot** angezeigt, wenn sie deutlich vom 10-%-Ziel abweicht (der Kurs in der Titelzeile ist nur der Tageskurs bei der letzten Bearbeitung),
- wie viele **Tage** der Kauf her ist.

Und ganz rechts: der **📈-Knopf**. Ein Klick öffnet ein eigenes **Chart-Fenster** mit dem Kursverlauf.
Darin siehst du auch zwei gestrichelte Linien: den Einkaufspreis und das Kursziel.
Den Zeitraum wählst du oben mit Knöpfen oder frei mit der kleinen Leiste unter dem Chart.
Das Fenster bleibt offen, bis du es selbst schließt – praktisch zum Danebenlegen.

**Und noch ein Trick:** Beim ersten Chart-Klick verwandelt sich die Circle-Ansicht selbst
in ein **eigenes Fenster** (gleicher Inhalt, gleiche Stelle). Auch das bleibt offen, bis du es
schließt – und aus ihm heraus kannst du bequem beliebig viele Charts öffnen und schließen.
Du bekommst es auch direkt über den kleinen Knopf **„In eigenem Fenster öffnen ↗"** oben im Circle-Tab
(und genauso im Ampel-Tab – dann startet das Fenster in der Ampel).

> Die Kurse kommen kostenlos von Yahoo Finance. Wenn dort mal nichts kommt,
> steht in der Spalte einfach „–" – alles andere funktioniert normal weiter.

**Die Gesamtübersicht 📉.** Neben „Auswertung" steht der Knopf **„📈 Verlauf"**. Er öffnet ein
Fenster mit dem Verlauf des ganzen Circle-Depots – vom ersten Kauf bis heute, bedient wie die
Kurs-Charts (Knöpfe oben, Auswahl-Leiste unten, dazu „1J"). Unten stehen die Kurven mit Häkchen:
die Zahlen der Auswertung, der **Wert des Depots zum Tageskurs**, das **eingesetzte Kapital**
(so viel muss mindestens eingezahlt worden sein, damit alle Käufe bezahlt werden konnten), die
Annahme **„10 Wochen je 1.500 €"** zum Vergleich – liegt das eingesetzte Kapital darüber, gab es
Sonderzahlungen – und die **geschätzten Kosten** (Bruttogewinne minus „Zuwachs" laut Statistik
des Autors). Häkchen weg = Kurve weg, und die Skala passt sich den übrigen an. Mit der Maus über
dem Chart siehst du alle Werte eines Tages.

**Und du verpasst nichts:** Wird eine Aktie **gekauft oder verkauft**, meldet sich das Add-on –
mit einer Benachrichtigung und einem **goldenen Punkt** auf dem Symbol. 🟡

So liest du das Symbol:
- **Rote Zahl** (unten rechts) = Änderungen bei der Ampel.
- **Goldener Punkt** (oben links) = Kauf oder Verkauf im Circle.
- **Beides** = in beiden Communities ist etwas passiert – die zwei Zeichen
  sitzen in verschiedenen Ecken und verdecken sich nicht.

Der goldene Punkt verschwindet, sobald du den Circle-Tab öffnest. Alle Käufe und
Verkäufe stehen dort im Bereich **„Käufe & Verkäufe"** – deine eigene kleine Chronik.

> 👥 Dafür brauchst du eine **eigene Mitgliedschaft** in dieser zweiten Community.
> Ohne Zugang zeigt dir der Tab einen Knopf, über den du beitreten kannst.
> Der Ampel-Teil funktioniert auch ohne – ganz normal weiter.
>
> Das gilt auch **umgekehrt**: Für den Circle-Tab brauchst du **keine**
> Aktienscout-Mitgliedschaft. Beide Bereiche sind völlig unabhängig –
> es reicht die jeweilige Mitgliedschaft für den Teil, den du nutzen willst.

---

## Update einbauen 🔄

Es gibt eine neue Version? So holst du sie dir. Dauert zwei Minuten.

1. **Lade das Projekt neu herunter** – gleicher Link wie beim ersten Mal:
   👉 **[Projekt als ZIP herunterladen](https://github.com/Robbty/Aktienscout-Community-Boersenampel/archive/refs/heads/main.zip)**
2. **Entpacke das ZIP an denselben Ort** wie damals. Ersetze dabei den alten Ordner (Frage „Dateien ersetzen?" mit **Ja** beantworten).

> 🪤 **Die häufigste Falle:** Liegt die alte ZIP-Datei noch im Download-Ordner, nennt der Browser die neue automatisch **„main (1).zip"** – und beim Entpacken entsteht ein **neuer Ordner „main (1)"** statt des ersetzten alten. Chrome schaut aber weiterhin in den **alten** Ordner und zeigt darum weiter die alte Version. Also: alte ZIP vorher löschen oder beim Entpacken darauf achten, dass wirklich der **bisherige** Ordner ersetzt wird (Frage „Dateien ersetzen?" muss kommen).

**Dann in Chrome (oder Edge, Brave, Opera):**

3. Tippe in die Adresszeile: **`chrome://extensions`** und drücke Enter.
4. Der **Entwicklermodus** muss eingeschaltet sein – sonst siehst du den Pfeil aus Schritt 5 gar nicht. So geht's: Auf der Seite `chrome://extensions` steht **oben rechts** ein Schalter **„Entwicklermodus"** 🛠️ – anklicken, bis er blau ist. Danach erscheinen an den Karten der Erweiterungen zusätzliche Knöpfe, unter anderem der Pfeil ↻. (Ohne Entwicklermodus ist die Ampel seit Chrome 133 ohnehin abgeschaltet – siehe Hinweis bei der Installation.)
5. Suche die Karte der Börsenampel und klicke auf den **runden Pfeil ↻** („Aktualisieren"). Fertig! 🎉
6. **Kontrolle:** Klick auf das Ampel-Symbol – ganz unten im Popup steht die **Versionsnummer**. Die muss zur neuen Version passen (steht auch auf der Karte in `chrome://extensions`).

Deine Einstellungen und die Chronik **bleiben erhalten**. 👍

> ⚠️ **Wichtig:** Nicht „Entfernen" und neu laden – dabei gehen Einstellungen und Chronik verloren. Der Pfeil ↻ reicht völlig.
>
> Hast du das ZIP an einen **anderen** Ort entpackt? Dann geht es nur über „Entfernen" und **„Entpackte Erweiterung laden"** mit dem neuen Ordner (im Datei-Dialog wirklich den **neuen** Ordner wählen – der Dialog schlägt gern den alten vor). Die Chronik beginnt dann leider von vorn.

**In Firefox:**

3. Firefox lädt das Add-on ja bei jedem Start neu (siehe oben). Einfach wie gewohnt über **`about:debugging`** laden – es nimmt automatisch die neue Version aus dem ersetzten Ordner. Läuft Firefox gerade noch mit der alten Version, reicht dort auch der Knopf **„Neu laden"** an der Ampel-Karte. Ein Entwicklermodus ist nicht nötig.

---

## Kleine Tipps

- ⏱️ **Wie oft geprüft wird,** stellst du unten ein („Prüfen alle … Min."). Öfter = schnellere Meldungen.
- 📅 **„Letzte X Tage"** – das Zahlenfeld bestimmt, wie weit zurück geschaut wird.
- ✅ **„Als gesehen markieren"** sagt der Ampel: „Hab's gesehen." Dann ist die Liste wieder leer und das Blinken hört auf.
- 😴 **Blinken nervt?** Den Haken bei „Bei Änderung blinken" einfach rausnehmen.

---

## Kurz gefragt

**Es zeigt nichts an. 😟**
Bist du bei skool.com angemeldet? Steht da „Eingeloggt?", dann erst anmelden, dann „Jetzt prüfen".

**Der Circle-Tab zeigt nichts an.**
Dafür brauchst du die Mitgliedschaft in der Circle-Community. Ohne sie zeigt der Tab einen Knopf zum Beitreten – die Ampel funktioniert trotzdem normal.

**Woher kommen die Börsenkurse?**
Von Yahoo Finance, kostenlos und ohne Anmeldung. Die Kurse können ein paar Minuten alt sein.
Steht da „–", war Yahoo gerade nicht erreichbar – einfach später noch mal öffnen.
(In **Firefox** musst du dem Add-on eventuell einmal den Website-Zugriff erlauben:
Adresszeile `about:addons`, dort beim Add-on unter „Berechtigungen" alles einschalten.)

**Die Ampel ist plötzlich aus / „nicht vom Chrome Web Store geprüft". 😶**
Dann wurde der Entwicklermodus ausgeschaltet. Seit Chrome 133 deaktiviert Chrome Erweiterungen, die aus einem Ordner geladen wurden, sobald der Entwicklermodus aus ist. Auf `chrome://extensions` oben rechts den Schalter wieder einschalten – die Ampel ist sofort wieder da, Einstellungen und Chronik bleiben erhalten.

**Nach dem Update ist immer noch die alte Version da. 🤔**
Schau unten im Popup auf die Versionsnummer. Ist sie alt, hat Chrome noch den alten Ordner: Meist wurde das neue ZIP als „main (1).zip" in einen **neuen** Ordner entpackt (siehe Kasten oben unter „Update einbauen"), oder der Entwicklermodus war aus und der Pfeil ↻ deshalb nicht da (Schalter oben rechts auf `chrome://extensions` einschalten). Abhilfe: alten Ordner wirklich ersetzen, dann ↻ – oder einmalig „Entfernen" und den **neuen** Ordner laden.

**Sieht jemand anderes meine Daten?**
Nein. Alles bleibt nur in deinem Browser.

**Kostet das was?**
Nein, das Add-on ist kostenlos. Du brauchst nur die Mitgliedschaft der Community,
deren Teil du nutzen willst – Aktienscout für die Ampel, Circle für den Circle-Tab.

---

Viel Spaß – und mögen deine Ampeln auf Grün stehen! 🟢🚀
