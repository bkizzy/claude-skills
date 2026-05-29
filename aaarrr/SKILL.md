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

Compute the four window date ranges from today (today is the day the skill runs; use absolute dates in JSON):
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

Load the per-store scraper from `{SKILL_DIR}/scripts/`:
- iOS private: `asc_private_scrape.js`
- iOS public:  `asc_public_scrape.js`
- Android:     `play_scrape.js`

Each script is a self-contained async IIFE that returns a JSON object matching the shared schema (see `references/aaarrr_mapping.md`). Inject via `mcp__Claude_in_Chrome__javascript_tool`, passing the script body and the window dates as a JSON-stringified `window.__aaarrrCfg` setup line prefixed to the script body.

**Speed:** these scrapers prefer XHR-replay over DOM scraping where the dashboard exposes a JSON endpoint. They run concurrent requests via `Promise.all` inside the page. One MCP round-trip per page, not per metric.

**Failure tolerance:** if a selector misses or an endpoint 4xx's, the scraper records `null` for that field and pushes a string to the returned `errors` array. Never throw. The renderer turns `null` into `—` with a footnote.

After each store's scrape:
1. Save raw JSON to `{SKILL_DIR}/reports/<slug>_<store>_<YYYYMMDD>.json`.
2. If `errors` is non-empty, log a one-liner like *"⚠ apple_connect: 2 metrics unavailable (see report footnotes)"* but continue.

For iOS, after `asc_private_scrape.js`, also run `asc_public_scrape.js` against `https://apps.apple.com/us/app/<id>` (the app's public page — get the App Store ID from the private scrape's `app_meta.app_store_id`). Merge its result under the private blob's `asc_public` key.

**App not found in a store:** if `asc_private_scrape.js` can't locate the named app in the Connect apps list, save a stub JSON with `{ store, app, error: "app_not_found_in_store" }` and continue to the next store. The renderer will surface this in the report.

**App is ambiguous in a store:** the scrapers resolve the app in this order — (1) `cfg.forceAppId`, (2) the App Store ID embedded in the current Connect URL if the user pre-navigated to `/apps/<id>/...`, (3) exact case-insensitive name match in `/iris/v1/apps`, (4) single substring match, (5) multiple substring matches → return `{ error: "ambiguous_app", candidates: [{id, name, bundleId, sku}, ...] }`. On (5), don't pick one yourself — ask the user via `AskUserQuestion` with the candidate names (and sku/bundle id for disambiguation) as options. Up to 4 options fit; if there are more, summarize the spillover in the question text. Recommended option is the candidate whose `sku` exactly equals the user's query (often the production app). On the user's reply, re-run the scraper with `forceAppId` set to the picked id; cache the JSON normally. (Alternative the user can choose: navigate the open tab to the desired app's Connect dashboard and reply "ready" — the scraper will pick up the id from the URL on the next run.)

### Step 5 — Render

Run `node {SKILL_DIR}/scripts/build_report.mjs --slug <slug> --window <mode> --out <cwd>/aaarrr_<slug>_<YYYYMMDD>.md` via Bash. The script finds today's JSONs in `{SKILL_DIR}/reports/`, merges them, and writes the Markdown file.

After it runs, print the output path to the user with a one-line summary line: *"Report at <path>. Top mover: <metric> <delta>."* (The script writes a `__summary` JSON file alongside the Markdown that has the top mover so you can quote it.)

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
