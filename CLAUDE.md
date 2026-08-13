# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Phase 1 shipped: a cross-browser MV3 web extension lives in `extension/`. Phases 2–3 (per-stock detail view, portfolio tracker) are still open — see the phase table below.

## Layout & build

- `extension/` — the single source of truth, written cross-browser. Loadable directly in Chrome as an unpacked extension (its `manifest.json` is the Chrome variant). `manifest.firefox.json` sits alongside it and is ignored by Chrome.
- `node build.mjs` — assembles `dist/chrome/` and `dist/firefox/` from `extension/`, swapping in the right manifest. `dist/` is git-ignored. Load `dist/firefox/` via Firefox `about:debugging` → "Load Temporary Add-on" (pick its `manifest.json`).
- No package.json / no deps. `node test/lifecycle.test.mjs` exercises the full change-detection lifecycle (login → acknowledge → logout → changes → re-login) against `extension/lib/ampel.js`. Syntax-check with `node --check <file>`. Note: load `ampel.js` via `runInThisContext` (not a fresh `vm` context) so its arrays share the test realm's prototypes, otherwise `deepStrictEqual` fails cross-realm.

### Cross-browser specifics (don't regress these)

- All extension JS uses `const api = globalThis.browser || globalThis.chrome;` — both expose promise-based MV3 APIs, so `await api.storage.local.get(...)` works in each. Never go back to bare `chrome.*`.
- Chrome background is a `service_worker` that pulls shared code via `importScripts('lib/ampel.js')`, guarded by `if (typeof importScripts === 'function')`. Firefox background is `"scripts": ["lib/ampel.js", "background.js"]` (event page; no `importScripts`). `lib/ampel.js` therefore also assigns its functions onto `globalThis` so both load paths work.
- `popup.js` talks to the worker via `api.runtime.sendMessage(msg)` (promise form) — not the callback form, which Firefox's `browser.*` ignores.

## What this project is

A tool to monitor the **"Börsenampel"** (stock traffic-light) of the Skool community *Aktienscout-Community* (`cybermoney-1123`) and detect changes since the user last looked. The data lives behind a personalized Skool login — only the logged-in user can reach it.

Source page (login-required, Next.js SPA):
`https://www.skool.com/cybermoney-1123/classroom/8d4e7683?md=<HASH>`

## The data model (most important thing to understand)

Skool is a Next.js app. **The entire ampel structure is embedded as clean JSON** in the page — do NOT scrape the rendered DOM. Read:

```
document.getElementById('__NEXT_DATA__')  →  props.pageProps.course
```

Tree shape:
- `course.course` — root ("Die Aktien-Ampel (lifetime)*"), has its own `updatedAt`.
- `course.children` — 5 sections: `Achtung zuerst lesen`, `Folgt in Kürze`, `grüne Ampel`, `gelbe Ampel`, `rote Ampel`.
- each ampel section's `children` — the stock modules, each `{ course.id, course.metadata.title, course.updatedAt }`.

Key facts that drive the whole design:
- **A stock's traffic-light color = which section it sits in.** There is no color field; membership is the signal.
- **Every stock carries its own `updatedAt` timestamp.** Change detection needs only this — one request to load the page/JSON reveals: stock moved between ampeln, stock added, stock removed, or a stock's analysis was edited. No per-stock content fetch required for the diff.
- Per-stock IDs are stable hashes, used as `?md=<HASH>` in the URL. Anchor logic on IDs + timestamps, never on HTML structure.
- **The rich text body of each stock** (the `[+]` analysis bullets, "Fazit", "(Letzte Sichtung: …)") is NOT in `__NEXT_DATA__`. Skool loads it separately per module on demand. Treat it as Tier 2 — fetch only when the user opens a stock or to show *what* changed in an already-flagged stock.

`boersenampel-baseline.json` is the first captured snapshot (full membership + timestamps) and doubles as the initial comparison baseline. Regenerate snapshots in the same shape for diffing.

## Architecture decision: browser add-on, not a standalone app

Chosen because the add-on runs inside the user's already-logged-in browser session:
- Auth is free — uses existing Skool cookies. No cookie-expiry handling, no login automation, no credential storage. This was the deciding factor over a Python app.
- Background polling via `chrome.alarms` + a cookie-authenticated `fetch()` of the page (same-origin → cookies attached), even with no tab open. Parse `__NEXT_DATA__` out of the returned HTML.
- Target Chromium first (covers Chrome/Edge/Brave/Opera with one build), then port to Firefox (core JS is shared; only manifest differences).

Phases:
1. **Done.** Read ampel + diff since last visit (added/moved/edited/removed stocks via `updatedAt`), collapsible ampeln with search box, configurable poll interval, badge + notifications. Also tracks **section ("Menüpunkt") changes** — added/removed sections and edited info-pages ("Achtung zuerst lesen", "Folgt in Kürze"); ampel sections are skipped there to avoid double-reporting their stock churn.
1b. Two "letzte X Tage" lenses sharing one `settings.activityDays` input:
   - **"Statuswechsel letzte X Tage"** — a persistent `storage.local.history` log. `appendHistory(delta)` (in `background.js`, called from `ingestSnapshot` only when `!isFirstEver`) records *structural* events only — `moved`/`added`/`removed` stocks + `sectionAdded`/`sectionRemoved` — and deliberately excludes `edited`/`sectionEdited` (the bulk-edit noise). Event date `at` = the stock's Skool `updatedAt` when available, else detection time; `detectedAt` always stored too. Forward-only (empty until changes accrue), no duplication (delta is between consecutive successful readings), capped at `HISTORY_MAX = 1000` via `pruneHistory()` which drops the oldest entries **by change date `at`** (not insertion order).
   - **"Zuletzt bearbeitet"** (collapsed by default) — the `updatedAt`-based list from the current snapshot; retroactive but noisy (author bulk-edits ~40 stocks at once, so this means "touched", not "status-changed"). The precise log above is the targeted answer to "what changed".
1c. **Done (v0.2.0).** "Circle"-Tab in the popup: evaluates the course **"Aktienengagement Echtzeit"** of a second Skool community `der-circle-zur-ersten-million-6426` (classroom `93493889`) — invested capital (cumulative + currently deployed), realized gains, unrealized P&L of open positions. See "Circle feature" section below.
2. Per-stock **detail view** (Tier 2 content fetch — the rich body that is not in `__NEXT_DATA__`).
3. **Portfolio tracker** (buy/where/when/entry price/qty/current price/PnL/sold/profit/holding-days + table). Decoupled from Skool; needs an external stock-price API (free APIs are rate-limited — open question, deferred until Phase 3). For the Circle tab specifically, a real price API + per-stock chart is the planned next step (the price source is isolated in `titleInfo.currentPrice`).

### How Phase 1 works (the two data paths + state model)

- **Two ways data arrives, by design.** (a) `content.js` runs on the ampel page and reads `__NEXT_DATA__` from the live DOM on every visit — guaranteed-authenticated, the robust path. (b) `background.js` does a cookie-authenticated `fetch()` on an alarm for true background polling without an open tab. If Chrome withholds session cookies from the background fetch (SameSite), path (a) still keeps data fresh. Both funnel through `ingestSnapshot()`.
- **State in `storage.local`:** `current` (latest snapshot), `baseline` (state the user last acknowledged via "Als gesehen markieren"), `settings.intervalMinutes`, `meta`. The popup's "since last visit" list is `diffSnapshots(baseline, current)`; notifications fire on `diffSnapshots(prevCurrent, newSnapshot)` between polls.
- **Logged-out privacy:** a failed poll never overwrites `current`/`baseline` (so the diff survives the logout gap), it only sets `meta.lastPollOk = false`. The popup shows ampel data *only* when `meta.lastPollOk === true`, and re-polls on every open (showing "Prüfe Login…" first) so cached paid data is never visible while logged out — yet all changes that happened while away appear on the next successful poll.
- **Blinking toolbar icon:** MV3 workers sleep after ~30 s, so there is no persistent blink. Instead a ~12 s blink *burst* (`setInterval` toggling `ICON_ON`/`ICON_OFF` every 500 ms) fires when a poll finds pending changes, while the worker is still awake — background-alarm polls and content-script captures blink; popup-initiated and startup polls do not. `refreshBadge` heals a stuck frame and `stopBlink` runs when the count hits 0 (acknowledge). Toggleable via `settings.blinkEnabled`.
- **Snapshot shape** (`buildSnapshot` in `lib/ampel.js`): `{ courseTitle, courseUpdatedAt, stockCount, stocks{id->{id,name,section,color,updatedAt}}, sections{id->{id,title,color,updatedAt,hasStocks}} }`. `diffSnapshots` only computes section diffs when the *old* snapshot already has a `sections` field — and `ingestSnapshot` back-fills `baseline.sections` once — together preventing "everything new" false alarms after a version bump.

### Circle feature (Phase 1c) — how it works

- **Data model:** same Skool course tree, but the course's children ARE the positions (no color sections). Title conventions of the author (messy, parser is tolerant): `Name [57,75 € ]` = open position, bracketed price = author-maintained current price; `Name [8 Tage]` = sold after 8 days. `Statistik` / `Statistik aktuell` = meta modules with the author's own totals (parsed as cross-check, shown in the popup).
- **The amounts live ONLY in each module's rich-text body** (`children[i].course.metadata.desc`, format `[v2][{ProseMirror-JSON}]`), which the tree carries only for the module selected via `?md=<id>`. Harvest path in `pollCircle()` (background.js): fetch course HTML once (tree + `buildId` + one desc), then per stale module `GET /_next/data/<buildId>/<community>/classroom/<course>.json?md=<id>` (cookie-auth). `buildId` rotates on Skool deploys → on failure re-scrape HTML once and retry. Incremental via `updatedAt` vs stored `bodyUpdatedAt` (`selectStaleModules`): first harvest ~20 requests (350 ms apart, capped at 25/run), later polls usually 0–2.
- **Body formats actually seen live** (all covered in `lib/circle.js` + `test/circle.test.mjs`): `Kauf am 03.08.2026 zu 48,88 $ (42,32 €) je Aktie` (€ in parens wins), `zu 3.39€` (decimal DOT — single dot + 1–2 decimals is parsed as decimal, not thousands), `12 Stück zum Kaufpreis: 509 € - Verkaufspreis: 560 € = 51 € Ertrag`, `… 645 € verkauft zu 712 € Gewinn: 47 €`, `Verkaufspreis: 54,54` (missing €), `Verkaufspreis: 785, €` (truncated decimals), and entries WITHOUT a Stück line (Heidelberg/Accor format) where Kaufpreis and title price share the same unit → unrealized = currentPrice − Kaufpreis (both live cases land exactly on the author's +10% scheme).
- **Aggregation** (`computePortfolio`, pure, runs in the popup — nothing aggregated is persisted, parser fixes retroactively fix all numbers): investedCumulative, deployedOpen, realized (explicit Ertrag/Gewinn wins over sell−buy difference), unrealizedTotal. Parse failures land in `unparseable` (rendered as "Nicht auswertbar"), never in totals; incomplete positions render dimmed and are excluded from sums.
- **Access handling:** `classifyCircleAccess` → `ok`/`noAccess`/`loggedOut`. Same privacy rule as the Ampel: failed poll never overwrites `circle` data, popup renders only when `circleMeta.lastPollOk === true`. `noAccess` shows a join notice with the **hard-coded affiliate link** `CIRCLE_CONFIG.joinUrl` (deliberately NOT configurable). Storage keys: `circle` (courseTitle, buildId, modules incl. parsed trades), `circleMeta`.
- **Known data quirk:** the author's own "Statistik aktuell" (6000 € / 303 € net of tax+costs) won't match our gross sums; NIBE's written `Verkaufspreis: 785, €` looks like an author typo (+78% in 10 days) — we render what's written.
- Gotcha: `background.js` must never define a top-level `function setInterval` — it would shadow the built-in that `startBlink()` needs (that's why the message handler fn is called `setPollInterval`).
- **Join hints with hard-coded affiliate links (both deliberately NOT configurable):** Ampel `noAccess` → "VIP werden" button with `AMPEL_CONFIG.joinUrl`; Circle `noAccess` → join button with `CIRCLE_CONFIG.joinUrl`. Ampel access detection: `classifyAmpelAccess` in `lib/ampel.js` (top-level sections carry `metadata.hasAccess` — live-verified); `meta.access` is `'ok' | 'noAccess' | 'loggedOut' | 'error'`, set by `pollViaFetch`/`ingestSnapshot`.
- **Testing the no-access views:** `extension/lib/debug.js` has a `DEBUG_SIMULATE` switch (`ampel`/`circle`: `'noAccess' | 'loggedOut'`) — set, reload the extension, open the popup; set back to `null` afterwards. It short-circuits the polls (data is never overwritten, same as a real access loss) and also blocks the content-script `capture` path so an open Ampel tab can't undo the simulation. Loaded via `importScripts` (Chrome) / `background.scripts` (Firefox) BEFORE the other libs. Live-verified: without a session cookie Skool answers HTTP 403 → both polls map 401/403 to `loggedOut`. `node build.mjs` additionally emits **`dist-test/`** (git-ignored, manifest name suffixed "(TEST ohne Zugang)", own gecko id): both switches preset to `'noAccess'`, loadable alongside the normal build to check both affiliate links.

## Reading live data during development

A Playwright MCP browser is logged into Skool (user "Peter Schmand") and can read the page directly. Use `browser_navigate` to the source URL, then `browser_evaluate` to pull `__NEXT_DATA__` — this is how the baseline was captured and how to verify the JSON shape against any add-on parsing logic.
