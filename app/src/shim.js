/*
 * shim.js — bildet die MV3-Extension-APIs in der Capacitor-WebView nach.
 *
 * Muss als ALLERERSTES Skript laden: stellt globalThis.browser bereit, bevor
 * background.iife.js und popup.js ihr `const api = globalThis.browser || …`
 * auswerten. In der App gibt es keinen Service-Worker — Worker- und Popup-Code
 * laufen in DERSELBEN Seite, verbunden über den lokalen Message-Bus unten.
 *
 * Nachgebildet wird nur die tatsächlich genutzte API-Oberfläche
 * (per grep über extension/ erhoben):
 *   storage.local.get/set, storage.session.get/set, storage.onChanged,
 *   runtime.sendMessage/onMessage, runtime.connect/onConnect,
 *   runtime.getURL, runtime.onInstalled/onStartup,
 *   alarms.create/onAlarm, notifications.create/onClicked,
 *   action.setIcon/setBadgeText/setBadgeBackgroundColor,
 *   tabs.create, windows.create/update/onRemoved.
 */
(function () {
  'use strict';

  const Cap = globalThis.Capacitor || null;
  const Plugins = (Cap && Cap.Plugins) || {};

  // ---- storage.local: In-Memory-Zustand, persistiert via Capacitor Preferences.
  // Alles liegt unter EINEM Preferences-Schlüssel; geschrieben wird gebündelt
  // (debounced), gelesen einmal beim Start. Ohne Capacitor (Desktop-Browser zum
  // Entwickeln) fällt der Shim auf localStorage zurück.
  const STORE_KEY = 'boersenampel-storage';
  let store = {};
  let hydrated = null; // Promise der Erst-Hydrierung
  let persistTimer = null;
  const changeListeners = [];

  async function hydrate() {
    try {
      let raw = null;
      if (Plugins.Preferences) {
        raw = (await Plugins.Preferences.get({ key: STORE_KEY })).value;
      } else {
        raw = localStorage.getItem(STORE_KEY);
      }
      if (raw) store = JSON.parse(raw) || {};
    } catch (e) {
      store = {}; // korrupter Speicher -> leer starten statt crashen
    }
  }

  function persistSoon() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => {
      persistTimer = null;
      try {
        const raw = JSON.stringify(store);
        if (Plugins.Preferences) {
          await Plugins.Preferences.set({ key: STORE_KEY, value: raw });
        } else {
          localStorage.setItem(STORE_KEY, raw);
        }
      } catch (e) { /* Persistenz best effort; In-Memory bleibt korrekt */ }
    }, 300);
  }

  function ensureHydrated() {
    if (!hydrated) hydrated = hydrate();
    return hydrated;
  }

  const storageLocal = {
    async get(keys) {
      await ensureHydrated();
      const out = {};
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(store);
      for (const k of list) if (k in store) out[k] = store[k];
      return out;
    },
    async set(obj) {
      await ensureHydrated();
      const changes = {};
      for (const k of Object.keys(obj || {})) {
        changes[k] = { oldValue: store[k], newValue: obj[k] };
        store[k] = obj[k];
      }
      persistSoon();
      // onChanged asynchron feuern (wie im Browser), damit der Setter nicht
      // mitten im Ablauf fremde Render-Pfade betritt.
      setTimeout(() => {
        for (const fn of changeListeners) {
          try { fn(changes, 'local'); } catch (e) { /* Listener-Fehler isolieren */ }
        }
      }, 0);
    },
  };

  // storage.session: nur Fensterverwaltung (in der App bedeutungslos) -> Memory.
  const sessionStore = {};
  const storageSession = {
    async get(key) {
      const out = {};
      const list = typeof key === 'string' ? [key] : Array.isArray(key) ? key : Object.keys(sessionStore);
      for (const k of list) if (k in sessionStore) out[k] = sessionStore[k];
      return out;
    },
    async set(obj) { Object.assign(sessionStore, obj); },
  };

  // ---- runtime: Message-Bus zwischen popup.js und background.iife.js ---------
  const messageListeners = [];
  const connectListeners = [];
  const installedListeners = [];
  const startupListeners = [];

  function sendMessage(msg) {
    return new Promise((resolve) => {
      let done = false;
      const sendResponse = (r) => { if (!done) { done = true; resolve(r); } };
      for (const fn of messageListeners) {
        try { fn(msg, { id: 'app' }, sendResponse); } catch (e) { /* isolieren */ }
      }
    });
  }

  // Fake-Port-Paar: popup.js verbindet sich, background hört onConnect.
  // onDisconnect feuert nie -> waitPopupClosed() im Worker-Code läuft in seinen
  // 400-ms-Fallback; die kleine Verzögerung vor dem Chart-Öffnen ist akzeptiert.
  function connect(info) {
    const mk = () => ({ msg: [], disc: [] });
    const a = mk(); // Ende des Aufrufers (popup.js)
    const b = mk(); // Ende des Workers
    const port = (mine, other) => ({
      name: (info && info.name) || '',
      postMessage(m) {
        setTimeout(() => { for (const fn of other.msg) { try { fn(m); } catch (e) {} } }, 0);
      },
      onMessage: { addListener: (fn) => mine.msg.push(fn) },
      onDisconnect: { addListener: (fn) => mine.disc.push(fn) },
      disconnect() { for (const fn of other.disc) { try { fn(); } catch (e) {} } },
    });
    const callerPort = port(a, b);
    const workerPort = port(b, a);
    setTimeout(() => { for (const fn of connectListeners) { try { fn(workerPort); } catch (e) {} } }, 0);
    return callerPort;
  }

  // ---- notifications: Capacitor LocalNotifications ---------------------------
  // Die Extension nutzt String-IDs ("ampel-<ts>"); Android braucht int-IDs.
  // Die String-ID wandert in extra und kommt beim Klick zurück.
  const notifClickListeners = [];
  let notifCounter = 1;
  let notifWired = false;

  function wireNotifications() {
    if (notifWired || !Plugins.LocalNotifications) return;
    notifWired = true;
    Plugins.LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
      const extId = a && a.notification && a.notification.extra && a.notification.extra.extId;
      if (!extId) return;
      for (const fn of notifClickListeners) { try { fn(extId); } catch (e) {} }
    });
  }

  const notifications = {
    async create(id, opts) {
      if (!Plugins.LocalNotifications) return;
      wireNotifications();
      try {
        const perm = await Plugins.LocalNotifications.checkPermissions();
        if (perm.display !== 'granted') {
          const req = await Plugins.LocalNotifications.requestPermissions();
          if (req.display !== 'granted') return;
        }
        await Plugins.LocalNotifications.schedule({
          notifications: [{
            id: notifCounter++,
            title: (opts && opts.title) || 'Börsenampel',
            body: (opts && opts.message) || '',
            extra: { extId: id },
          }],
        });
      } catch (e) { /* Benachrichtigung ist optional */ }
    },
    onClicked: { addListener: (fn) => notifClickListeners.push(fn) },
  };

  // ---- alarms: setInterval, solange die App lebt -----------------------------
  // Echtes Hintergrund-Polling bei geschlossener App übernimmt später der
  // Background Runner (eigener Meilenstein); hier zählt nur die offene App.
  const alarmListeners = [];
  let alarmTimer = null;

  const alarms = {
    async create(name, info) {
      const period = Math.max(1, Number(info && info.periodInMinutes) || 60);
      if (alarmTimer) clearInterval(alarmTimer);
      alarmTimer = setInterval(() => {
        for (const fn of alarmListeners) { try { fn({ name }); } catch (e) {} }
      }, period * 60 * 1000);
    },
    onAlarm: { addListener: (fn) => alarmListeners.push(fn) },
  };

  // ---- action (Toolbar-Icon/Badge): als DOM-Event an app.js gemeldet ---------
  const action = {
    async setIcon() { /* kein Toolbar-Icon in der App */ },
    async setBadgeBackgroundColor() {},
    async setBadgeText(o) {
      try {
        document.dispatchEvent(new CustomEvent('app-badge', { detail: { text: (o && o.text) || '' } }));
      } catch (e) {}
    },
  };

  // ---- tabs / windows --------------------------------------------------------
  // Externe Links (Skool, Affiliate) öffnen im System-Browser/Custom Tab.
  const tabs = {
    async create(o) {
      const url = o && o.url;
      if (!url) return;
      if (Plugins.Browser) await Plugins.Browser.open({ url });
      else window.open(url, '_blank');
    },
  };

  // windows.create gibt es in der App nur für zwei bekannte Fälle:
  //  - chart.html?…      -> als eigene Seite laden (Android-Zurück führt zurück)
  //  - popup.html?standalone=1 -> No-op: die App IST bereits die Circle-Ansicht
  const windows = {
    async create(data) {
      const url = (data && data.url) || '';
      if (url.includes('chart.html')) {
        const i = url.indexOf('chart.html');
        location.assign(url.slice(i));
      }
      return { id: 1 };
    },
    async update() {},
    onRemoved: { addListener: () => {} },
  };

  // ---- Fetch-Wrapper: Browser-User-Agent für Skool/Yahoo ---------------------
  // CapacitorHttp (in capacitor.config.json aktiviert) patcht fetch auf nativen
  // HTTP -> kein CORS, Cookies aus dem geteilten CookieManager. Nativ dürfen
  // wir zusätzlich einen echten Browser-User-Agent setzen, damit die Abrufe
  // nicht als App-WebView auffallen.
  const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';
  const realFetch = globalThis.fetch ? globalThis.fetch.bind(globalThis) : null;
  if (realFetch && Cap) {
    globalThis.fetch = function (input, init) {
      try {
        const u = typeof input === 'string' ? input : (input && input.url) || '';
        if (/skool\.com|finance\.yahoo\.com/.test(u)) {
          init = Object.assign({}, init);
          init.headers = Object.assign({}, init.headers, { 'User-Agent': UA });
        }
      } catch (e) { /* im Zweifel unverändert durchreichen */ }
      return realFetch(input, init);
    };
  }

  // ---- Zusammenbau -----------------------------------------------------------
  globalThis.browser = {
    storage: {
      local: storageLocal,
      session: storageSession,
      onChanged: { addListener: (fn) => changeListeners.push(fn) },
    },
    runtime: {
      getURL: (p) => new URL(p, document.baseURI).toString(),
      sendMessage,
      connect,
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
      onConnect: { addListener: (fn) => connectListeners.push(fn) },
      onInstalled: { addListener: (fn) => installedListeners.push(fn) },
      onStartup: { addListener: (fn) => startupListeners.push(fn) },
    },
    alarms,
    notifications,
    action,
    tabs,
    windows,
  };

  // popup.js ruft nach Fenster-Wünschen window.close() auf sich selbst auf —
  // in der App wäre das fatal (die Seite IST die App) -> entschärfen.
  if (Cap) { try { window.close = function () {}; } catch (e) {} }

  // app.js ruft das nach dem Laden aller Skripte: entspricht dem Browserstart.
  // onInstalled wird bewusst NICHT gefeuert (würde doppelt pollen).
  globalThis.__appFireStartup = function () {
    for (const fn of startupListeners) { try { fn(); } catch (e) {} }
  };
})();
