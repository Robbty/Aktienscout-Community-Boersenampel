# Plan: Börsenampel → Portfolio Performance (Stand 18.11.2026)

## Ziel

Ein Knopf je Aktie in der Börsenampel (Add-on und App) legt die Aktie in
[Portfolio Performance](https://www.portfolio-performance.info/) (PP) als Wertpapier an und setzt sie
auf eine Watchlist. Ein zweiter Klick nimmt sie nach Rückfrage wieder heraus.

- **Anlegen ist kein Kauf.** Ein Wertpapier in PP ist nur der Stammdatensatz (Name, ISIN, WKN,
  Kürzel, Währung, Kursquelle). Ein Kauf ist eine eigene Buchung im Depot (Datum, Stück, Kurs,
  Gebühren, Steuern).
- Käufe kommen weiter über die Importer der Anbieter (Abrechnung importieren) oder werden in PP von
  Hand gebucht. Die Importer ordnen den Kauf über die ISIN dem schon angelegten Wertpapier zu.

## Peters Entscheidungen (14.11.2026)

1. Die fehlende Funktion in PP wird **selbst beigetragen** (Pull Request an das PP-Projekt), keine
   CSV-Übergangslösung und nicht nur eine Anfrage.
2. Der Knopf kommt in die **öffentliche** Börsenampel, ist aber erst aktiv, wenn der Nutzer in seinem
   PP die Verbindung bestätigt hat, das heißt die Kopplung über die PP-Schnittstelle in PP
   freigegeben hat (siehe Teil B).
   Ergänzt am 18.11.2026: Jeder Vorschlag in der Ampel bekommt einen eigenen Knopf; jede Aktie wird
   einzeln per Klick eingetragen. Peter hat die Anforderungen an einem klickbaren Muster geprüft und
   bestätigt; Ergebnis in Teil B unter „Knopf je Aktie“.
3. Umsetzung in einem eigenen Chat im Börsenampel-Projekt.

## Was PP heute kann (Version 0.90.0 vom 01.11.2026)

**REST-API und MCP** (seit 0.89, experimentell, standardmäßig aus):

- Einschalten in den PP-Einstellungen, Seite „MCP Server & REST API“ (englische Bezeichnung aus der
  PP-Doku; deutsche Beschriftung ungeprüft), dazu jede Datei einzeln freigeben. Port 5712, nur
  localhost.
- Jeder Client braucht ein eigenes Token. Er bekommt es durch Kopplung: Anfrage
  `POST /v1/auth/requests`, der Nutzer bestätigt in PP („Allow for this session“ / „Always allow“ /
  „Decline“; deutsche Beschriftungen ungeprüft), der Client fragt den Status ab und erhält das Token
  genau einmal.
- v1 kann lesen (Wertpapiere, Konten, Depots, Bestände, Performance, Trades), Wertpapiere ändern
  (`PATCH`) und löschen. **Nicht:** Wertpapiere anlegen, Watchlists, Buchungen. Kurse und
  Kursquellen sind nur lesbar.
- Buchungen anlegen ist bei PP geplant: `POST /v1/files/{file}/ledger` (Issue #5873, PR #5874, offen).
- Anfragen mit `Origin`-Header lehnt PP ab (403). Das Add-on kann PP also nicht direkt ansprechen,
  das Handy erreicht den PC ohnehin nicht. Daher braucht es eine Brücke auf dem PC (Teil B).
- Schreibzugriffe ändern nur die geöffnete Datei im Speicher; speichern muss der Nutzer.
- Ist in PP ein Dialog offen, kommt 423 mit `Retry-After`: später wiederholen.

Quellen im PP-Repo: `name.abuchen.portfolio.rest/README.md`, `openapi.yaml`, `mcp-tools.json`,
`docs/adr/0002-local-rest-api-for-scripts-and-agents.md` (sowie 0004, 0005), `AGENTS.md`,
`CONTRIBUTING.md`.

**Importer für Peters Anbieter:**

| Anbieter | Import in PP |
|---|---|
| Trade Republic | PDF-Abrechnungen und CSV-Export |
| Interactive Brokers | Flex-Query (XML-Datei aus dem Kundenportal) |
| Bitpanda | kein eigener Importer, nur allgemeiner CSV-Import mit eigener Spaltenzuordnung |
| Kraken | kein eigener Importer (nur Kursquelle), allgemeiner CSV-Import |

## Teil A: Beitrag zu PP

1. **Vorschlag** als Issue auf Englisch:
   - `POST /v1/files/{file}/instruments`: Pflicht `name`, `currencyCode`; optional `isin`, `wkn`,
     `tickerSymbol`, `note`. Verhalten bei schon vorhandener ISIN festlegen (z. B. 409 mit der
     vorhandenen `uuid`).
   - Watchlists: auflisten, Wertpapier hinzufügen und entfernen; ob die API Watchlists auch anlegt,
     im Vorschlag fragen.
   - **Offene Designfrage Kursquelle:** ohne Kursquelle zeigt PP keine Kurse. Möglichkeiten:
     (a) der Client übergibt Kursquelle und Kürzel, (b) PP sucht selbst über seine Suchanbieter
     (`SecuritySearchProvider.ResultItem.create`), wie der Dialog „Neues Wertpapier“,
     (c) ohne Kursquelle, der Nutzer stellt sie in PP ein. Die PP-Betreuer entscheiden mit.
     Die Ampel kennt je Aktie nur den Namen (das Yahoo-Kürzel ermittelt sie über eine Namenssuche),
     keine ISIN. Ohne ISIN legt ein späterer Import der Broker-Abrechnung ein Duplikat an. Daher spricht
     viel für (b), mit ISIN aus der Suche.
2. Peter liest den Text. **Erst nach seinem OK** wird er unter seinem GitHub-Konto veröffentlicht.
3. **Bau einrichten:** Java 21 ist auf Peters PC vorhanden, Maven fehlt (im Benutzerordner
   installieren, ohne sudo). Originalcode bauen und die REST-Tests laufen lassen (Befehl im
   REST-README unter „For contributors“).
4. Nach Rückmeldung der Betreuer: Fork, Zweig, Code nach dem vorhandenen Muster (Handler, Route in
   `ApiRoutes`, `openapi.yaml`, `mcp-tools.json`, Tests; die Drift-Tests prüfen den Gleichlauf).
   **Zwei kleine PRs** (PP-Regel „ein Feature je PR“): erst Anlegen, dann Watchlists.
5. Peter pusht und reicht ein; der Assistent gibt die fertigen Befehle.

Hinweis: Am 14.11.2026 lagen bei PP sieben offene REST-PRs eines anderen Beitragenden, die der
Betreuer schrittweise prüft und kürzt. Die Prüfung kann Wochen dauern; ob der Beitrag aufgenommen
wird, entscheidet PP.

## Teil B: Börsenampel

- **Weg:** Klick in Add-on oder App → Ereignis im Event-Log (`EVENTS.md`, Sync-Ordner des Nutzers)
  → Brücke auf dem PC des Nutzers → PP-REST-API. So funktioniert es auch vom Handy aus.
- **Neue Ereignistypen**, additiv unter `boersenampel-events/1`: z. B. `pp.instrument.requested`
  (Producer `extension`/`app`, Payload mit Name, ISIN, WKN, Währung) und
  `pp.instrument.created` / `pp.instrument.failed` (Producer Brücke), für das Herausnehmen
  entsprechend `pp.instrument.removal.requested` / `pp.instrument.removed`. Die Brücke meldet in ihrem
  Steckbrief `producers/<id>.json`, ob sie mit PP gekoppelt ist, welche PP-Version läuft und ob diese
  Wertpapiere anlegen kann.
- **Knopf je Aktie** (klickbares Muster, von Peter am 18.11.2026 bestätigt):
  - „+ PP“ rechts neben dem 📈-Knopf jeder Aktie, dazu ein großer Knopf in der Detailansicht.
  - Ein Klick legt die Aktie ohne Rückfrage an und setzt sie auf die Watchlist „Börsenampel“.
  - Zustände: bereit, wird angelegt, wartet auf den PC (Klick vom Handy oder PC/PP aus; wird
    nachgeholt), steht in PP (✓), fehlgeschlagen (Meldung mit Grund und „Erneut versuchen“), aus
    (nicht verbunden oder PP zu alt; ausgegraut, Statuszeile über der Liste mit Weg zur Anleitung).
  - Was schon in PP steht, zeigt ✓; die Brücke liest dazu die Wertpapiere aus PP. Nichts wird
    doppelt angelegt.
  - Nach dem Anlegen und Herausnehmen erinnert eine Meldung ans Speichern in PP.
  - **Nochmal klicken nimmt die Aktie nach Rückfrage wieder heraus** (Peter, 18.11.2026). Die
    Brücke löscht das Wertpapier über `DELETE` (gibt es in v1) nur, wenn die Ampel es selbst angelegt
    hat (laut ihren `pp.instrument.created`-Ereignissen) und PP keine Buchungen oder Sparpläne dazu
    hat; sonst lehnt PP ohnehin mit `409 delete-blocked` ab. Selbst in PP angelegte Wertpapiere nimmt
    die Ampel nie heraus; die Meldung sagt, wie man sie in PP löscht (Rechtsklick auf das Wertpapier →
    „Wertpapier löschen“).
- **Knopf aktiv** nur, wenn eine Brücke gemeldet ist, die PP bestätigt hat und deren PP das Anlegen
  kann. Sonst ist er ausgegraut, mit Hinweis und Link auf die Anleitung (kein Hinweis ohne Weg).
  Der Knopf darf damit schon vor dem PP-Release ausgeliefert werden.
- **Brücke:** Jeder Nutzer installiert sie auf seinem PC. Sprache, Verpackung und Start (bei Bedarf,
  Autostart) beim Umsetzen entscheiden und in der Story festhalten.
- **Anleitung** für Nutzer Schritt für Schritt: PP-Schnittstelle einschalten, Datei freigeben, Brücke
  installieren, Kopplung in PP bestätigen, Speichern in PP nicht vergessen.
- **Start** von Teil B, sobald das API-Design mit PP abgestimmt ist; bis zum PP-Release gegen den
  PR-Zweig entwickeln und testen.
