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
  try {
    const snapshot = buildSnapshotFromDocument(document);
    if (snapshot && snapshot.stockCount > 0) {
      chrome.runtime.sendMessage({ type: 'capture', snapshot });
    }
  } catch (e) {
    // still — Content-Scripts sollen die Seite nie stören.
  }
})();
