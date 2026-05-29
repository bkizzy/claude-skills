# `/aaarrr` — App-store pirate metrics

Daily AAARRR (Awareness, Acquisition, Activation, Retention, Revenue, Referral) report for your app, built from **App Store Connect**, **apps.apple.com**, and **Google Play Console**. Scrapes via the [Claude in Chrome](https://claude.ai/chrome) extension — no API keys, no JWT setup. Uses XHR-replay over DOM parsing where the dashboards expose JSON.

Reports are tuned for daily reading: rolling-7d numbers, with day-over-day and week-over-week deltas plus a 28-day baseline column. A "what changed since yesterday" callout at the top surfaces the three biggest DoD movers.

## Install

```bash
# Symlink into Claude Code's skill discovery path
ln -s "$(pwd)/aaarrr" ~/.claude/skills/aaarrr
```

Then in Claude Code, restart the session (`/clear`) and invoke:

```
/aaarrr <YourAppName>
```

## Usage

| Form | What it does |
| --- | --- |
| `/aaarrr` | Asks for the app name, runs both stores. |
| `/aaarrr MyApp` | iOS + Android, rolling-7d window, unified Markdown report. |
| `/aaarrr MyApp ios` | App Store Connect + public page only. |
| `/aaarrr MyApp android` | Play Console only. |
| `/aaarrr MyApp --window 30d` | Override window (`7d`, `30d`, `90d`, or `YYYY-MM-DD..YYYY-MM-DD`). |
| `/aaarrr MyApp --refresh` | Force re-scrape even if cache < 1h old. |
| `/aaarrr MyApp --report-only` | Skip the browser entirely; re-render from cached JSON. |

Report drops in your current working directory as `aaarrr_<slug>_<YYYYMMDD>.md`. Raw per-store JSON is cached in `reports/` for an hour.

## Requirements

- [Claude in Chrome](https://claude.ai/chrome) extension installed and connected. App Store Connect and Play Console block automation tools at tier-"read" under computer-use, so the in-page MCP is the only path that works.
- Active session on each store you want data from. The skill detects sign-in state and pauses for you to authenticate; it never types credentials or handles 2FA itself.
- Node 20+ on the path (used by the Markdown renderer).

## What lands in the report

One section per AAARRR pillar, each as an iOS / Android side-by-side table with **7d · DoD · WoW · 28d-avg/day** columns:

- **Awareness** — impressions, store-listing page views.
- **Acquisition** — first-time installs, redownloads, conversion rate, top sources.
- **Activation** — active devices, sessions, sessions-per-device, crashes.
- **Retention** — D1 / D7 / D14 / D28 cohorts (Play returns D15 / D30 — the report labels both).
- **Revenue** — proceeds, IAP transactions, active subs, ARPU, with a yesterday line.
- **Referral** — acquisition-source breakdown per store.
- **Ratings & Reviews** — average, total, new-yesterday, latest 3 reviews per store.

The public apps.apple.com page contributes a one-line callout above the tables: public rating, category rank, and any Today/Featured shelf presence.

## Known gaps (v1)

- **Sessions on Android** — Play Console doesn't expose session count natively; row shows `—` with a footnote pointing at the dashboard equivalent.
- **Crashes** — iOS reports a count, Android reports a rate. Each cell renders its native unit; the mapping doc spells this out so the reader isn't surprised.
- **Referral attribution** — limited to the stores' own source breakdowns. True UTM-level attribution requires an SDK (Firebase, Adjust, etc.) — out of scope for v1.

## When something breaks

Apple and Google ship redesigns frequently. When a metric starts reading `null`:

1. Open the dashboard page in Chrome with DevTools → Network.
2. Trigger the metric (load the chart / change the date range).
3. Find the request that returned the number you wanted.
4. Update the matching entry in [`references/selectors.md`](./references/selectors.md) and the corresponding scraper in [`scripts/`](./scripts/).
5. Re-run with `/aaarrr MyApp --refresh`.

## Layout

```
aaarrr/
├── SKILL.md                       # what Claude reads at /aaarrr time
├── scripts/
│   ├── asc_private_scrape.js      # App Store Connect scraper (injected via javascript_tool)
│   ├── asc_public_scrape.js       # apps.apple.com page scraper
│   ├── play_scrape.js             # Play Console scraper
│   └── build_report.mjs           # Node — merges JSON, emits Markdown
├── references/
│   ├── aaarrr_mapping.md          # pillar ↔ dashboard-field mapping (schema source of truth)
│   └── selectors.md               # DOM selectors + endpoint paths + patching procedure
└── reports/                       # cache for raw per-store JSON (gitignored)
```
