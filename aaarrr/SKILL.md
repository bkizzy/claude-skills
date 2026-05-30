---
name: aaarrr
description: >
  Builds an AAARRR (Awareness, Acquisition, Activation, Retention, Revenue, Referral)
  pirate-metrics report for an app by scraping App Store Connect, the public Apple
  App Store page, and Google Play Console via Claude-in-Chrome. Reports lead with
  rolling 7-day numbers plus DoD/WoW deltas and a 28-day baseline — tuned for daily
  reading. Invoked as /aaarrr. Use whenever the user types /aaarrr, asks for
  "pirate metrics", "AAARRR report", "app store metrics", "store analytics", or
  wants to compare iOS vs Android performance for their app.
version: 0.1.0
---

# `/aaarrr` — App-store pirate-metrics report

## What this skill does

Given an app name, scrape:
1. **App Store Connect** (private dashboard, login required) → `apple_connect` JSON
2. **apps.apple.com** public page (no login) → merged into `apple_connect` JSON under `asc_public`
3. **Google Play Console** (private dashboard, login required) → `google_play` JSON

Then render a Markdown report that leads with **rolling-7d** numbers, **DoD** and **WoW** deltas, and a **28-day baseline**, plus a yesterday snapshot for revenue and ratings. One section per AAARRR pillar. Cross-store iOS / Android / Combined columns when both ran.

All AAARRR pillars are covered by store data alone — both stores expose retention cohorts natively (App Store Connect → Engagement → Retention; Play Console → Statistics → Users → Retained Users). No Firebase needed for v1.

## Invocation

The user invokes via:

| Form | What to do |
|---|---|
| `/aaarrr` | Ask for the app name, then run both stores. |
| `/aaarrr MyApp` | Run iOS + Android, build unified report. Default. |
| `/aaarrr MyApp ios` | Skip Android entirely. |
| `/aaarrr MyApp android` | Skip iOS entirely. |
| `--window 30d` | Override window (7d, 30d, 90d, or YYYY-MM-DD..YYYY-MM-DD). |
| `--refresh` | Force re-scrape even if cache < 1h. |
| `--report-only` | Skip browser entirely, re-render from cached JSON. |

If the app name has spaces, the user will quote it (`/aaarrr "My Cool App"`).

## Runtime pipeline

Follow this exact sequence. Skip browser steps if `--report-only` is set.

### Step 1 — Resolve invocation

Parse the arguments. Establish:
- `app` (string, required — if missing, ask once: "Which app?")
- `stores` (`ios` | `android` | `both`, default `both`)
- `windowMode` (default `rolling_7d`, or explicit override)
- `refresh` (bool, default false)
- `reportOnly` (bool, default false)

**Get today's real date from the system clock** by running `date +%Y-%m-%d` via Bash. Do NOT trust "today's date" from session context — it can be stale. Compute window date ranges from that:

- `yesterday` = today − 1
- `rolling_7d` = [today − 7, today − 1]
- `prior_7d`   = [today − 14, today − 8]
- `baseline_28d` = [today − 28, today − 1]

### Step 2 — Cache check

For each store in scope, look in `{SKILL_DIR}/reports/<slug>_<store>_<YYYYMMDD>.json`. If it exists, is from today, and `--refresh` is not set, skip to step 5 for that store. `<slug>` = `app` lowercased with non-alphanumerics replaced by `_`.

### Step 3 — Browser preflight (per store)

- Call `mcp__Claude_in_Chrome__list_connected_browsers`. If none connected, tell the user: *"Install the Claude in Chrome extension at https://claude.ai/chrome and connect it, then re-run /aaarrr."* Stop. Do not fall back to computer-use — browsers are tier-"read" there and clicks are blocked.
- Navigate:
  - iOS: `https://appstoreconnect.apple.com/apps`
  - Android: `https://play.google.com/console/u/0/developers/`
- Inject a tiny detection probe via `mcp__Claude_in_Chrome__javascript_tool` that returns `{ ready: boolean, reason: string }`. "Ready" is stricter than "signed in" — it means the scraper can actually run without any further human action. Define it per store:

  **iOS (App Store Connect) — ready iff ALL hold:**
  - URL contains `appstoreconnect.apple.com/apps` (no `/login`, no `idmsa.apple.com` redirect, no Sign-In iframe).
  - A `/iris/v1/apps?limit=1` fetch with `credentials: "include"` returns HTTP 200 with a non-empty `data[]`.
  Anything else (sign-in form, 2FA prompt, account picker, MFA challenge) → `ready: false`.

  **Android (Play Console) — ready iff ALL hold:**
  - URL is under `play.google.com/console/u/0/developers/` (not `accounts.google.com`).
  - The developer-account chooser is NOT showing (i.e. URL is past `/developers/` and matches `/developers/<devId>/...`, not the bare `/developers/` chooser).
  - The app-list rows for that developer are actually rendered — a quick way to check is that `document.body.innerText` mentions a package name like `com.<...>` or that an `a[href*="/app/"]` link is present. If neither is true (e.g. the Android Developer Verification banner is hiding the list, or the user is on the chooser, or rows haven't loaded after 6s), → `ready: false`.

- If `ready === false`, output exactly: *"Please open **<store>** in the open tab and get to the apps dashboard for **<app>** (sign in / pick the right developer account / clear any verification banners). Reply 'ready' when you're there."* Then **wait for the user's reply** before continuing. Do not attempt to type credentials, click the dev-account picker, or dismiss verification banners on the user's behalf — these are user-action gates by design. After they reply, re-run the probe. If still not ready, surface the `reason` from the probe and ask again. Don't fall through to public-Store-only data on a `ready: false` — the public page misses every private metric (installs, retention, revenue, vitals); a partial run masquerading as complete is worse than waiting.

### Step 4 — Scrape

The two stores need different strategies:

#### iOS — single-shot IIFE
`asc_private_scrape.js` is a self-contained async IIFE. Inject via `mcp__Claude_in_Chrome__javascript_tool`, prepending `window.__aaarrrCfg = {...}` with the app name, optional `forceAppId`, and the four window dates. The scraper XHR-replays App Store Connect's internal `/analytics/api/v1/data/time-series` endpoint in parallel for every measure. One round-trip in, one returned JSON out.

App resolution order: `forceAppId` → URL-embedded id → exact name match → single substring → multiple substrings (returns `{ error: "ambiguous_app", candidates: [...] }`, ask the user to pick via `AskUserQuestion`). After resolution, run `asc_public_scrape.js` against `https://apps.apple.com/us/app/id<APP_STORE_ID>` to fetch public-page rating, rank, and editorial state. Merge under `asc_public`.

#### Android — interactive, two-tier
Play Console renders chart data on `<canvas>` elements with no text/aria fallback, so a single-shot scraper isn't possible. `play_scrape.js` exposes helper functions Claude calls between navigations.

**Tier 1 (fast — gets all five AAARRR pillars at 28-day grain):**
1. Navigate to `/console/u/0/developers/<devId>/app-list`.
2. Inject `play_scrape.js`; call `window.aaarrrPlayProbe()` to confirm signed-in past the dev-account chooser.
3. Call `window.aaarrrPlayFindApp(<app>)` to resolve to `{ packageId, text }`. Same ambiguity handling as iOS.
4. Navigate to `/console/.../app/<packageId>/grow-overview`.
5. Call `window.aaarrrPlayGrowOverview()` — returns 28-day totals for device acquisitions, first opens, MAU, 7-day retention, conversion rate, plus the dashboard's own `+N%` deltas.
6. Navigate to `/console/.../app/<packageId>/user-feedback/ratings` and call `window.aaarrrPlayRatings()`.
7. Save the Play JSON. The renderer fills 28d cells from these headline numbers via the "promote 28d into primary cell" fallback.

**Tier 2 (optional — adds per-day chips):**
Only run if the user explicitly asks for daily DoD/WoW chips on Play. For each chart of interest:
1. Navigate to the relevant page (`/reporting/acquisition/details`, etc.).
2. Call `window.aaarrrInstallChartObserver()` once.
3. Call `window.aaarrrScrollPlayContent(<scrollTop>)` to bring the canvas into view.
4. Call `window.aaarrrChartHoverGrid(<canvasIndex>)` to get a list of `[x, y]` viewport coordinates.
5. Batch real hovers via `mcp__Claude_in_Chrome__computer { action: "hover" }` at each position (one `browser_batch` call covers all ~30).
6. Call `window.aaarrrReadCaptures()` to get the daily series.

**Speed:** Tier 1 = 3 navigations + 3 small JS reads per app, ~3K tokens total. Tier 2 = ~6K tokens per chart. The `/grow-overview` headlines cover all five AAARRR pillars at 28-day grain — only run Tier 2 if the user explicitly wants daily granularity.

**Play data lag:** Play's chart values finalize 3–4 days after the day they refer to. The Play JSON's `windows` should record the actual data-end date (e.g. `yesterday: today-4`) so the report's window banner shows the correct iOS-vs-Android offset.

After each store's scrape:
1. Save raw JSON to `{SKILL_DIR}/reports/<slug>_<store>_<YYYYMMDD>.json`.
2. If `errors` is non-empty, log a one-liner like *"⚠ apple_connect: 2 metrics unavailable"* but continue.

**App not found:** stub the JSON with `{ store, app, error: "app_not_found_in_store" }` and continue.

### Step 5 — Render

Run `node {SKILL_DIR}/scripts/build_report_html.mjs --slug <slug> --window <mode> --out <cwd>/aaarrr_<slug>_<YYYYMMDD>.html` via Bash. The script finds today's JSONs in `{SKILL_DIR}/reports/`, merges them, and writes a standalone HTML file (no external assets — tables are semantic `<table>` so they paste cleanly into Notion / Slack / Sheets).

Pass `--date YYYYMMDD` if the user is regenerating an older day; the script defaults to today's **local** date (not UTC — local avoids the post-8pm-EDT flip that would miss the JSON cached earlier the same evening).

After it runs, print the output path to the user with a one-line summary: *"Report at <path>. Top mover: <metric> <delta>."* (The script writes a `<path>.summary.json` sidecar with the top movers so you can quote them.)

The Markdown renderer (`build_report.mjs`) is still available for terminal-friendly output but is no longer the default.

### Step 6 — Surface

If the user is in an environment where you can open files, open the report. Otherwise just print the path.

## Skill paths

`{SKILL_DIR}` here means the directory this `SKILL.md` lives in. The scripts and references are siblings. The `reports/` directory is the cache; the **final Markdown is written to the user's CWD**, not `reports/`.

## Where to look when something breaks

- **Scraper missing a metric:** open `references/selectors.md`, find the dashboard page, update the selector, re-run with `--refresh`.
- **AAARRR mapping question:** `references/aaarrr_mapping.md` is the source of truth for which dashboard field feeds which pillar.
- **Login probe wrong:** the probe selectors are inlined in this SKILL.md (Step 3) — they're small, change them here.

## Out of scope for v1

Firebase / GA4 integration, TestFlight/Play internal-track, CSV export, auto-scheduled runs (use the `schedule` skill for the last one).
