# Handoff: Veröffentlichung im Google Play Store (und Chrome Web Store)

Stand: 24.08.2026. Dieses Dokument ist ein **Arbeitsauftrag zum Wiederaufnehmen**:
Wer es aufruft (Mensch oder Claude), kann sofort loslegen. Es bündelt den
recherchierten Wissensstand, die offenen Entscheidungen und die konkrete
Schrittfolge. Was Peter selbst tun muss (Konto, Ausweis, Zahlung, Freigaben),
ist als **[PETER]** markiert; alles andere kann Claude vorbereiten.

> Beim Start bitte zuerst prüfen, ob sich Gebühren/Regeln geändert haben
> (Quellen am Ende) — Google ändert diese Dinge regelmäßig.

---

## 1. Ausgangslage

- Android-App in `app/` (Capacitor-WebView um den Extension-Code), aktuell
  verteilt als **APK über GitHub Releases** (Tags `app-vX.Y.Z`), signiert mit
  `app/android/release.keystore` + `keystore.properties` (beide git-ignoriert).
  In-App-Updater prüft GitHub `releases/latest`.
- Erste Version `app-v0.7.0` (21.08.2026), auf echten Geräten verifiziert.
- Nutzer-Anleitung: `ANLEITUNG-APP.md`.
- Der Signaturschlüssel ist die Identität der App: **niemals verlieren, niemals
  wechseln** — sonst können bestehende Installationen nicht aktualisiert werden.
  Vor allem anderen: Backup des Keystores + Passwörter an sicherem Ort. **[PETER]**

## 2. Recherchierter Wissensstand (24.08.2026)

### Google Play Console
- **Gebühr:** einmalig 25 US-Dollar (≈ 22–23 €) für beliebig viele Apps.
- **Konto:** Google-Konto mit 2-Faktor; für ein **Privatkonto** Ausweis-Upload
  (teils Selfie), Verifizierung dauert Stunden bis 2 Werktage. Firmenkonto
  zusätzlich D-U-N-S-Nummer — für dieses Projekt reicht ein Privatkonto.
- **12-Tester-Regel:** Für Privatkonten, die nach dem 13.11.2023 angelegt
  wurden, gilt **pro App**: geschlossener Test mit **mindestens 12 Testern,
  die 14 Tage am Stück eingeschrieben bleiben**, BEVOR man „Produktionszugang"
  beantragen darf. Google prüft den Antrag dann nochmals (Tage). Tester aus der
  Skool-Community rekrutieren (Liste der Gmail-Adressen oder eine Google-Group).
- **App-Prüfung:** Erstveröffentlichung 2026 typischerweise 7–14 Tage; Apps in
  „Finanzen" eher länger → Kategorie **„Tools"** oder **„Produktivität"** wählen.
  Updates danach meist 1–7 Tage. Änderungen am Store-Eintrag während der
  Prüfung starten sie neu.
- **Realistischer Gesamtzeitraum:** Kontoeröffnung bis öffentlicher Eintrag
  **4–5 Wochen** (Verifizierung + 14 Tage Test + Antrag + Prüfung).
- **Format:** Play verlangt ein **App Bundle (AAB)**, keine APK. Capacitor:
  `cd app/android && ./gradlew bundleRelease` statt `assembleRelease`
  (Signing-Config aus `build.gradle` gilt für beide). `versionCode` muss bei
  jedem Upload steigen, `versionName` = Tag ohne `app-v`.

### Android-Entwicklerverifizierung (auch OHNE Play Store relevant!)
- Ab **30.09.2026** in Brasilien, Indonesien, Singapur, Thailand; **2027
  weltweit** (also auch Deutschland): zertifizierte Android-Geräte installieren
  nur noch Apps, deren **Paketname + Signaturschlüssel** bei einem verifizierten
  Entwickler registriert sind — das betrifft die GitHub-APK-Verteilung.
- Play-Console-Konten gelten automatisch als verifiziert. Wer nur außerhalb
  verteilt, registriert sich in der „Android Developer Console" (laut Google-FAQ
  dieselbe einmalige 25-$-Gebühr + Ausweis). Der kostenlose Hobby-Zugang ist auf
  20 Geräte begrenzt → für die Community zu klein.
- Konsequenz: Die 25 $ + Ausweis kommen spätestens 2027 ohnehin. Damit ist
  der Play Store der naheliegende Weg; die GitHub-APK kann parallel weiterlaufen.

### Chrome Web Store (Browser-Erweiterung, nur der Vollständigkeit halber)
- Einmalig 5 US-Dollar, Prüfung meist Tage bis wenige Wochen, **bei jedem
  Update erneut** (Fixes kommen verzögert an). Sichtbarkeit „Nicht gelistet"
  = installierbar nur per Link. Motivation: Seit Chrome 133 sind entpackte
  Erweiterungen ohne Entwicklermodus abgeschaltet; ein Store-Eintrag würde das
  und die „main (1).zip"-Update-Probleme beenden. Entscheidung offen. **[PETER]**

## 3. Offene Entscheidungen [PETER]

1. Play Store **ja/nein** — und wenn ja: öffentlich oder nur per Link (Play
   kennt keine „unlisted"-Option wie Chrome; Alternative ist ein dauerhafter
   geschlossener Test, dann braucht jeder Nutzer eine Einladung).
2. Konto: Privat (empfohlen, keine D-U-N-S) oder Firma (o-Tronic?).
3. App-Name im Store (Vorschlag: „Börsenampel – Aktienscout-Community"),
   Entwicklername, Support-E-Mail (wird öffentlich angezeigt!).
4. Wo die **Datenschutzerklärung** öffentlich liegt (Pflicht, feste URL).
   Vorschlag: GitHub Pages aus dem Repo (`docs/datenschutz.md` → HTML) oder
   eine Seite auf spassundhaltung/o-tronic.
5. Chrome Web Store zusätzlich?

## 4. Schrittfolge

### Phase A – Vorbereitung (Claude kann sofort starten)
- [ ] Keystore-Backup bestätigen lassen **[PETER]**.
- [ ] `bundleRelease` in `app/package.json`-Skripte aufnehmen (`npm run aab`),
      einmal bauen, AAB-Signatur prüfen.
- [ ] `versionCode`-Schema festlegen (z. B. fortlaufend, in `build.gradle`).
- [ ] **Datenschutzerklärung** entwerfen (Deutsch + Englisch). Fakten für den
      Text: Alle Daten bleiben auf dem Gerät (Preferences/CapacitorKV); Netzwerk
      nur zu `skool.com` (mit dem eigenen Login des Nutzers, Cookies bleiben im
      System-CookieManager), `query1/query2.finance.yahoo.com` (Kurse, keine
      personenbezogenen Daten) und `api.github.com` (Update-Check, 1×/Tag);
      keine Analytics, keine Werbung, keine Weitergabe; Benachrichtigungen lokal;
      Hintergrund-Prüfung optional (Opt-in); Affiliate-Links zu Skool sind
      im Text offenzulegen.
- [ ] **Datensicherheits-Formular** (Data safety) vorbereiten: „Keine Daten
      erhoben/geteilt"? Achtung: Skool-Sitzungscookie liegt gerätelokal — das
      gilt nicht als Erhebung durch den Entwickler, aber ehrlich beschreiben.
      Berechtigungen: INTERNET, POST_NOTIFICATIONS, ggf. Hintergrund-Runner.
- [ ] **Store-Eintrag** texten: Kurzbeschreibung (80 Zeichen), Beschreibung
      (bis 4000 Zeichen, aus README/ANLEITUNG-APP), Kategorie Tools,
      Inhaltseinstufung (Fragebogen: keine Gewalt etc. → „Ab 0"), Zielgruppe
      „Erwachsene" (Finanzthemen, KEINE Kinder-App).
- [ ] **Grafiken:** App-Icon 512×512 PNG (aus `extension/icons/icon128.png`
      hochskalieren/neu rendern), Feature-Grafik 1024×500, mindestens 2
      Telefon-Screenshots (16:9 oder 9:16, min. 320 px, max. 3840 px) — vom
      Blackview/Pixel oder aus dem Emulator (kein Emulator vorhanden, siehe
      Memory „Android-SDK-Setup" → Gerät nutzen).
- [ ] Hinweis in `ANLEITUNG-APP.md` ergänzen: Store-Variante vs. GitHub-APK,
      Migration (Store-Installation überschreibt die GitHub-APK NUR bei
      gleichem Signaturschlüssel und höherem `versionCode` — beides gegeben).

### Phase B – Konto und Test [PETER + Claude]
- [ ] Play-Console-Konto anlegen, 25 $ zahlen, Ausweis-Verifizierung **[PETER]**.
- [ ] App anlegen, Store-Eintrag/Formulare aus Phase A eintragen.
- [ ] **Geschlossenen Test** einrichten, AAB hochladen, ≥12 Tester einladen
      (E-Mail-Liste), Tester müssen den Opt-in-Link annehmen und die App
      installieren; **14 Tage** laufen lassen — Tester dürfen in der Zeit
      nicht abspringen. Zwischendurch Feedback einsammeln.
- [ ] Nach 14 Tagen: **Produktionszugang beantragen** (Fragebogen, was getestet
      wurde) **[PETER]**, Antwort abwarten.

### Phase C – Veröffentlichung
- [ ] Produktions-Release mit demselben oder neuerem AAB einreichen.
- [ ] Prüfung abwarten (7–14 Tage), Rückfragen von Google beantworten.
- [ ] Nach Freigabe: Store-Link in `ANLEITUNG-APP.md`, README und in der
      Skool-Community; In-App-Updater ggf. auf „Store-Version → kein GitHub-
      Check" umstellen (Erkennung via `App.getInfo()`/Installer-Paket).

## 5. Risiken / worauf Google achten könnte
- Die App liest Inhalte einer bezahlten Plattform (Skool) — ausschließlich mit
  dem Login des Nutzers, nichts wird gespeichert/weitergegeben. Im Store-Text
  klar sagen: „Benötigt eine Mitgliedschaft; nicht mit Skool verbunden."
- Affiliate-Links (fest eingebaut): offenlegen.
- Finanzthemen: keine Anlageberatung — Hinweis „nur Anzeige von Community-
  Inhalten, keine Empfehlung" im Store-Text und in der App.
- WebView-Login auf skool.com: Google mag keine Apps, die fremde Logins in
  WebViews abfangen. Wir lesen NUR Cookies über den System-CookieManager,
  keine Passwörter — im Datenschutztext beschreiben.
- Marken: „Skool" und Community-Namen nicht im App-Namen führen.

## 6. Quellen (Stand 24.08.2026)
- Play Console – Get started: https://support.google.com/googleplay/android-developer/answer/6112435
- Testanforderungen neue Privatkonten (12 Tester/14 Tage): https://support.google.com/googleplay/android-developer/answer/14151465
- Community-Guide zur 12-Tester-Regel: https://support.google.com/googleplay/android-developer/community-guide/255621488
- Android-Entwicklerverifizierung – FAQ: https://developer.android.com/developer-verification/guides/faq
- Android Developers Blog (Rollout Juni 2026): https://android-developers.googleblog.com/2026/06/android-developer-verification.html
- Chrome Web Store – Registrierung: https://developer.chrome.com/docs/webstore/register
- Chrome Web Store – Prüfprozess: https://developer.chrome.com/docs/webstore/review-process
- Chromium-PSA: entpackte Erweiterungen nur im Entwicklermodus (Chrome 133): https://groups.google.com/a/chromium.org/g/chromium-extensions/c/cTdMVtxxooY
