# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Pre-implementation. No source code, build system, or git repo exists yet — only a reverse-engineered data model (`boersenampel-baseline.json`) and the design below. The first deliverable is a browser add-on (Phase 1). Do not invent build/lint/test commands; none exist until the add-on is scaffolded.

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

Planned phases:
1. Read ampel + **diff since last visit** (new / moved / edited stocks via `updatedAt`).
2. Collapsible ampeln with a **search box**, configurable poll interval, change notifications, per-stock detail view (Tier 2 content fetch).
3. **Portfolio tracker** (buy/where/when/entry price/qty/current price/PnL/sold/profit/holding-days + table). Decoupled from Skool; needs an external stock-price API (free APIs are rate-limited — open question, deferred until Phase 3).

## Reading live data during development

A Playwright MCP browser is logged into Skool (user "Peter Schmand") and can read the page directly. Use `browser_navigate` to the source URL, then `browser_evaluate` to pull `__NEXT_DATA__` — this is how the baseline was captured and how to verify the JSON shape against any add-on parsing logic.
