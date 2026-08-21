/*
 * app.js — App-spezifische Verdrahtung (lädt als LETZTES Skript).
 *
 * Aufgaben:
 *  - "Browserstart" auslösen (Alarm einrichten + Erst-Poll im background-Code)
 *  - Login-Flow: bei access 'loggedOut' einen Anmelde-Button zeigen, der die
 *    Skool-Login-Seite in einer In-App-WebView öffnet (gleicher CookieManager
 *    wie die nativen Fetches) und nach erfolgreichem Login weiterpollt
 *  - Ampel-Badge (rote Zahl) als Zähler am Ampel-Tab-Button
 *  - Beim Zurückkehren in die App (Resume) veralteten Zustand neu laden
 */
(function () {
  'use strict';

  const Cap = globalThis.Capacitor || null;
  const Plugins = (Cap && Cap.Plugins) || {};
  const send = (msg) => globalThis.browser.runtime.sendMessage(msg);

  // ---- Badge am Ampel-Tab ----------------------------------------------------
  document.addEventListener('app-badge', (e) => {
    const btn = document.getElementById('tabBtnAmpel');
    if (!btn) return;
    let chip = btn.querySelector('.app-badge');
    const text = (e.detail && e.detail.text) || '';
    if (!text) { if (chip) chip.remove(); return; }
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'app-badge';
      btn.appendChild(chip);
    }
    chip.textContent = text;
  });

  // ---- Login-Flow ------------------------------------------------------------
  // Optionen bewusst abweichend von den Plugin-Defaults: Cache/Session NICHT
  // löschen und NICHT isolieren — nur dann landen die Login-Cookies im
  // prozessweiten CookieManager, den die nativen Fetches (CapacitorHttp) nutzen.
  const LOGIN_URL = 'https://www.skool.com/login';
  // Chrome-Android-UA: reduziert die Chance, dass Google-SSO die WebView blockt.
  const LOGIN_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
  const WEBVIEW_OPTIONS = {
    showToolbar: true,
    showURL: true,
    clearCache: false,
    clearSessionCache: false,
    mediaPlaybackRequiresUserAction: false,
    closeButtonText: 'Schließen',
    toolbarPosition: 0, // TOP
    showNavigationButtons: true,
    leftToRight: false,
    customWebViewUserAgent: LOGIN_UA,
    android: { allowZoom: false, hardwareBack: true, pauseMedia: true, isIsolated: false },
    iOS: {
      allowOverScroll: true, enableViewportScale: false, allowInLineMediaPlayback: false,
      surpressIncrementalRendering: false, viewStyle: 2, animationEffect: 2,
      allowsBackForwardNavigationGestures: true,
    },
  };

  let loginOpen = false;
  let loginCheckTimer = null;

  async function checkLoggedIn() {
    // Ein Poll gegen Skool ist das ehrlichste Login-Kriterium: klappt er,
    // ist die Session da (access wird 'ok' oder 'noAccess', nicht 'loggedOut').
    const r = await send({ type: 'pollNow' });
    const access = (r && r.meta && r.meta.access) || 'error';
    return access === 'ok' || access === 'noAccess';
  }

  async function finishLogin() {
    if (loginCheckTimer) { clearInterval(loginCheckTimer); loginCheckTimer = null; }
    loginOpen = false;
    try { if (Plugins.InAppBrowser) await Plugins.InAppBrowser.close(); } catch (e) {}
    await send({ type: 'circlePollNow' });
    location.reload(); // sauberer Neustart der Ansicht mit eingeloggtem Zustand
  }

  async function openLogin() {
    if (!Plugins.InAppBrowser) {
      window.open(LOGIN_URL, '_blank');
      return;
    }
    loginOpen = true;
    try {
      Plugins.InAppBrowser.addListener('browserPageNavigationCompleted', async () => {
        if (loginOpen && await checkLoggedIn()) await finishLogin();
      });
      Plugins.InAppBrowser.addListener('browserClosed', async () => {
        // Nutzer hat selbst geschlossen -> einmal prüfen, ob der Login da ist.
        if (loginOpen && await checkLoggedIn()) await finishLogin();
        else loginOpen = false;
      });
    } catch (e) { /* Events optional; der Timer unten prüft ohnehin */ }
    // Fallback: alle 5 s prüfen (Navigation-Events sind je Plattform lückenhaft).
    loginCheckTimer = setInterval(async () => {
      if (loginOpen && await checkLoggedIn()) await finishLogin();
    }, 5000);
    await Plugins.InAppBrowser.openInWebView({ url: LOGIN_URL, options: WEBVIEW_OPTIONS });
  }

  // Login-Button unter dem Status einblenden, sobald der Zustand 'loggedOut' ist.
  function updateLoginButton() {
    send({ type: 'getState' }).then((s) => {
      const out = (s && s.meta && s.meta.access) === 'loggedOut';
      let btn = document.getElementById('appLoginBtn');
      if (!out) { if (btn) btn.remove(); return; }
      if (btn) return;
      btn = document.createElement('button');
      btn.id = 'appLoginBtn';
      btn.className = 'primary-btn';
      btn.type = 'button';
      btn.textContent = 'Bei Skool anmelden';
      btn.addEventListener('click', openLogin);
      const header = document.querySelector('header');
      if (header) header.appendChild(btn);
    });
  }

  globalThis.browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('meta' in changes)) updateLoginButton();
  });

  // ---- Resume: veralteten Zustand neu laden ----------------------------------
  // Nach längerer Pause ist der angezeigte Stand alt; ein Reload nutzt das
  // vorhandene Frische-Fenster (FRESH_MS in popup.js) für den schnellen Pfad
  // und pollt sonst neu. Die In-flight-Guards im background-Code verhindern
  // dabei Doppel-Polls.
  const STALE_MS = 3 * 60 * 1000;
  let lastActive = Date.now();
  if (Plugins.App && Plugins.App.addListener) {
    Plugins.App.addListener('appStateChange', ({ isActive }) => {
      if (isActive && Date.now() - lastActive > STALE_MS && !loginOpen) location.reload();
      if (isActive) lastActive = Date.now();
    });
  }

  // ---- Start -----------------------------------------------------------------
  // Entspricht dem Browserstart: ensureAlarm + Erst-Polls im background-Code.
  globalThis.__appFireStartup();
  updateLoginButton();
})();
