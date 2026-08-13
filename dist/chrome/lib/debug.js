/*
 * debug.js — Test-Schalter für die Zugangs-Anzeigen.
 *
 * Damit lassen sich die Hinweis-Ansichten ausprobieren, ohne sich bei Skool
 * auszuloggen oder eine Mitgliedschaft zu kündigen:
 *
 *   1. Wert unten ändern (z. B. circle: 'noAccess')
 *   2. Extension neu laden (Chrome: chrome://extensions -> Pfeil ↻)
 *   3. Popup öffnen und Ansicht prüfen
 *   4. Danach wieder auf null stellen und erneut neu laden!
 *
 * Mögliche Werte:
 *   ampel:  null | 'noAccess' | 'loggedOut'
 *       'noAccess'  -> Ampel-Tab zeigt den VIP-Hinweis mit Link.
 *       'loggedOut' -> Ampel-Tab verhält sich wie ohne Skool-Anmeldung.
 *
 *   circle: null | 'noAccess' | 'loggedOut'
 *       'noAccess'  -> Circle-Tab zeigt den Beitritts-Hinweis mit Link.
 *       'loggedOut' -> Circle-Tab verhält sich wie ohne Skool-Anmeldung.
 *
 * Der Schalter wirkt nur auf die Abrufe; gespeicherte Daten werden dabei wie
 * bei einem echten Zugangs-Verlust NICHT überschrieben.
 */
const DEBUG_SIMULATE = {
  ampel: null,
  circle: null,
};

if (typeof globalThis !== 'undefined') {
  globalThis.DEBUG_SIMULATE = DEBUG_SIMULATE;
}
