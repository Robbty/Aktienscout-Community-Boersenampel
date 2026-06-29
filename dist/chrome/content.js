/*
 * content.js — läuft auf der Skool-Ampel-Seite.
 *
 * Zweck: Bei jedem echten Seitenbesuch lesen wir __NEXT_DATA__ direkt aus dem
 * geladenen Dokument (garantiert eingeloggt) und schicken den Snapshot an den
 * Service-Worker. Das ist der robuste Pfad — er funktioniert auch dann, wenn
 * der Hintergrund-fetch wegen Cookie-Einschränkungen keine Daten bekäme.
 *
 * ampel.js wurde laut manifest davor geladen, die Funktionen liegen global.
 */
(function () {
  const api = globalThis.browser || globalThis.chrome;
  try {
    const snapshot = buildSnapshotFromDocument(document);
    if (snapshot && snapshot.stockCount > 0) {
      // .catch verhindert "unhandled rejection" in Firefox, falls kein Empfänger.
      Promise.resolve(api.runtime.sendMessage({ type: 'capture', snapshot })).catch(() => {});
    }
  } catch (e) {
    // still — Content-Scripts sollen die Seite nie stören.
  }
})();
