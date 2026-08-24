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
    // Frisches Session-Cookie auch dem Background-Runner mitgeben.
    const st = await globalThis.browser.storage.local.get('appSettings');
    if (st.appSettings && st.appSettings.bgNotify) await pushRunnerConfig(true);
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

  globalThis.browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    if ('meta' in changes) updateLoginButton();
    if ('settings' in changes) {
      // Geändertes Poll-Intervall auch an den Background-Runner weiterreichen.
      const st = await globalThis.browser.storage.local.get('appSettings');
      if (st.appSettings && st.appSettings.bgNotify) pushRunnerConfig(true);
    }
  });

  // ---- Hintergrund-Benachrichtigungen (Background Runner) --------------------
  // Der Runner läuft in eigener JS-Umgebung mit eigenem KV-Speicher; die App
  // überträgt ihm Config + Session-Cookie per dispatchEvent (saveConfig).
  const RUNNER_LABEL = 'de.aktienscout.boersenampel.poll';

  async function cookieString() {
    try {
      if (!Plugins.CapacitorCookies) return '';
      const map = await Plugins.CapacitorCookies.getCookies({ url: 'https://www.skool.com' });
      return Object.entries(map || {}).map(([k, v]) => k + '=' + v).join('; ');
    } catch (e) {
      return '';
    }
  }

  async function pushRunnerConfig(enabled) {
    if (!Plugins.BackgroundRunner) return;
    try {
      const s = await send({ type: 'getState' });
      await Plugins.BackgroundRunner.dispatchEvent({
        label: RUNNER_LABEL,
        event: 'saveConfig',
        details: {
          enabled: !!enabled,
          cookie: await cookieString(),
          intervalMinutes: (s && s.settings && s.settings.intervalMinutes) || 60,
        },
      });
    } catch (e) { /* Runner optional (z. B. im Desktop-Browser) */ }
  }

  async function setBgNotify(enabled) {
    if (enabled && Plugins.LocalNotifications) {
      const req = await Plugins.LocalNotifications.requestPermissions().catch(() => null);
      if (!req || req.display !== 'granted') enabled = false;
    }
    await globalThis.browser.storage.local.set({ appSettings: { bgNotify: enabled } });
    await pushRunnerConfig(enabled);
    return enabled;
  }

  async function injectBgToggle() {
    const footer = document.querySelector('footer');
    const pollBtn = document.getElementById('pollNow');
    if (!footer || !pollBtn || document.getElementById('bgNotify')) return;
    const label = document.createElement('label');
    label.className = 'settings';
    label.innerHTML = '<input id="bgNotify" type="checkbox" /> Hintergrund-Benachrichtigungen';
    footer.insertBefore(label, pollBtn);
    const box = label.querySelector('input');
    const st = await globalThis.browser.storage.local.get('appSettings');
    box.checked = !!(st.appSettings && st.appSettings.bgNotify);
    box.addEventListener('change', async () => {
      box.checked = await setBgNotify(box.checked);
    });
  }

  // ---- In-App-Updater --------------------------------------------------------
  // Prüft (max. 1×/Tag) das jüngste GitHub-Release (Tag-Schema app-vX.Y.Z)
  // gegen die installierte Version. "Herunterladen" öffnet die APK-URL im
  // System-Browser; der Android-Installer übernimmt (gleiche Signatur = Update).
  const UPDATE_REPO = 'Robbty/Aktienscout-Community-Boersenampel';

  function isNewerVersion(remote, local) {
    const parse = (v) => String(v || '').split('.').map((n) => parseInt(n, 10) || 0);
    const a = parse(remote);
    const b = parse(local);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] || 0) > (b[i] || 0)) return true;
      if ((a[i] || 0) < (b[i] || 0)) return false;
    }
    return false;
  }
  globalThis.__appUpdater = { isNewerVersion }; // für den Desktop-Rauchtest

  function showUpdateBanner(version, url) {
    if (document.getElementById('appUpdateBanner')) return;
    const div = document.createElement('div');
    div.id = 'appUpdateBanner';
    div.innerHTML =
      '<span>Version ' + version + ' verfügbar</span>' +
      '<button type="button" class="link-btn" id="appUpdateGo">Herunterladen</button>' +
      '<button type="button" class="link-btn" id="appUpdateLater">Später</button>';
    const header = document.querySelector('header');
    if (header && header.parentNode) header.parentNode.insertBefore(div, header.nextSibling);
    div.querySelector('#appUpdateGo').addEventListener('click', () => {
      if (Plugins.Browser) Plugins.Browser.open({ url });
      else window.open(url, '_blank');
    });
    div.querySelector('#appUpdateLater').addEventListener('click', () => div.remove());
  }

  // Versionszeile im Fuß (popup.js füllt sie aus dem Manifest — das gibt es in
  // der App nicht). Der Klick-Handler von popup.js öffnet damit auch hier die
  // Update-Historie (changelog.md wird vom Build mitkopiert).
  async function showAppVersion() {
    try {
      if (!Cap || !Plugins.App) return;
      const info = await Plugins.App.getInfo();
      const el = document.getElementById('version');
      if (el && info && info.version) el.textContent = 'App-Version ' + info.version;
    } catch (e) { /* rein informativ */ }
  }

  async function checkUpdate() {
    try {
      if (!Cap || !Plugins.App) return; // nur in der echten App sinnvoll
      const st = await globalThis.browser.storage.local.get('appUpdate');
      const checkedAt = (st.appUpdate && st.appUpdate.checkedAt) || 0;
      if (Date.now() - checkedAt < 24 * 60 * 60 * 1000) return;
      await globalThis.browser.storage.local.set({ appUpdate: { checkedAt: Date.now() } });
      const info = await Plugins.App.getInfo();
      const res = await fetch('https://api.github.com/repos/' + UPDATE_REPO + '/releases/latest', {
        headers: { 'Accept': 'application/vnd.github+json' },
      });
      if (!res.ok) return; // z. B. 404, solange es noch kein Release gibt
      const rel = await res.json();
      const remote = String(rel.tag_name || '').replace(/^app-v/, '');
      if (!remote || !isNewerVersion(remote, info.version)) return;
      const apk = (rel.assets || []).find((a) => /\.apk$/i.test(a.name || ''));
      showUpdateBanner(remote, apk ? apk.browser_download_url : rel.html_url);
    } catch (e) { /* Updater ist reiner Komfort */ }
  }

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
  injectBgToggle();
  showAppVersion();
  checkUpdate();
})();
