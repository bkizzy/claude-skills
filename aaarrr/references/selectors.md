# DOM / endpoint reference

The scrapers rely on selectors and endpoints that **will rot** as Apple and
Google ship redesigns. When a metric starts reporting `null` in the JSON or
shows `—` in the report, come here, patch, re-run with `--refresh`.

## How to patch — the 5-minute loop

1. Open the dashboard page in Chrome with DevTools → Network filtered to `XHR`.
2. Trigger the metric (load the chart, change the date range).
3. In the network panel, find the request that returned the number you wanted.
4. Update the matching constant below.
5. Update the same constant in the scraper file under `scripts/`.
6. Re-run `/aaarrr MyApp --refresh`.

## App Store Connect — `asc_private_scrape.js`

### Endpoints

| Purpose | Method · Path | Notes |
| --- | --- | --- |
| App lookup | `GET /iris/v1/apps?limit=200` | Stable since 2019. Response is JSON:API. Match `data[].attributes.name`. |
| Time-series metrics | `POST /analytics/api/v1/data/time-series` | Body: `{ adamId:[id], measures:[m], frequency:"day", startTime, endTime, group, dimensionFilters }`. Header `X-Requested-By: appstoreconnect` is often required. |
| Customer reviews | `GET /iris/v1/apps/{id}/customerReviews?limit=20&sort=-createdDate` | Returns 20 latest reviews. |

### Measure keys

The `measures[]` strings the time-series endpoint accepts. **Source of truth is `scripts/asc_private_scrape.js` (the `SUM_MEASURES` / `RATE_MEASURES` tables)** — the values below are what's wired in there as of the last successful run. Apple's analytics API is internal and undocumented; names rotate without notice. When something starts returning HTTP 400 / empty data, open DevTools → Network on the Analytics page, find the failing POST to `/analytics/api/v1/data/time-series`, read the `measures[0]` from the request body, and update **both** this table and the corresponding entry in the scraper.

**AAARRR field → API measure name → status:**

| Pillar / field | Schema key | API `measures[]` string | Status |
| --- | --- | --- | --- |
| Awareness — impressions | `awareness.impressions` | `impressionsTotalUnique` | ✅ verified |
| Awareness — page views | `awareness.page_views` | `pageViewUnique` | ✅ verified |
| Acquisition — first downloads | `acquisition.first_downloads` | `units` | ✅ verified (NOT `installs` — Apple renamed) |
| Acquisition — redownloads | `acquisition.redownloads` | `redownloads` | ✅ verified |
| Acquisition — conversion rate | `acquisition.conversion_rate` | `conversionRate` | ✅ verified · rate · returns 0–100, scraper divides by 100 on intake |
| Activation — active devices | `activation.active_devices` | `activeDevices` | ✅ verified |
| Activation — sessions | `activation.sessions` | `sessions` | ✅ verified |
| Activation — sessions / device | `activation.sessions_per_device` | _(derived)_ | sums(sessions) / sums(activeDevices) per window in `deriveRatio()` |
| Activation — crashes | `activation.crashes` | `crashes` | ✅ verified · count, not rate |
| Revenue — proceeds (USD) | `revenue.proceeds_usd` | `proceeds` | ✅ verified |
| Revenue — IAP transactions | `revenue.iap_count` | `iap` | ✅ verified |
| Revenue — paying users | `revenue.paying_users` | `payingUsers` | ✅ verified |
| Revenue — ARPU | `revenue.arpu` | _(derived)_ | sums(proceeds) / sums(payingUsers) per window |
| Revenue — active subscriptions | `revenue.active_subs` | ❌ **not yet mapped** | Subscriptions endpoint TBD — likely `/analytics/api/v1/data/...` with `subscriptionState` filter |
| Retention — D1/D7/D14/D28 | `retention.d1` etc. | ❌ **not yet mapped** | Apple's retention chart uses a different endpoint shape (frequency `"total"` + a `day` dimension). Best guess for the measure name is `userRetention`; needs DevTools capture. |
| Referral — by_source | `referral.by_source` | `totalDownloads` grouped by `source` | ✅ verified · hits `/analytics/api/v1/data/dimension-values` (different endpoint) |

The candidates listed previously here (`installs`, `installsConversionRate`, `payingUserProceeds`, `iapPurchases`, `proceedsPerPayingUser`) were either renamed by Apple or never accepted — kept as a reference of **what NOT to use** in case someone searches old notes.

### Detection probe (Step 3 of SKILL.md)

Run this 1-liner via `javascript_tool` to check login state:

```js
(() => ({
  loggedIn: !!document.querySelector('[data-test-apps-list], [aria-label*="My Apps"]') &&
             !document.querySelector('iframe[src*="idmsa.apple.com"]'),
  reason:   document.title || location.pathname,
}))();
```

## Public App Store page — `asc_public_scrape.js`

| Surface | Source | Notes |
| --- | --- | --- |
| Rating avg / count | `<script type="application/ld+json">` block | JSON-LD; very stable across redesigns. |
| Recent reviews | `.we-customer-review` cards | Class name has held for years; if Apple swaps to data-attribute selectors, switch to `[data-test-customer-review]`. |
| Editorial badge | `[data-test-editorial-badge]` OR `.we-editorial-section` | Soft selector; absent ≠ not featured (Apple sometimes inlines without a badge). |
| Category rank | `.product-header__chart-position` | Only rendered for chart-eligible apps. |

## Google Play Console — `play_scrape.js`

Play Console is a Closure-compiled SPA — there's no clean JSON endpoint that
covers everything. The scraper opens each report page in a hidden iframe and
reads rendered numbers.

### Page paths (relative) — verified May 2026

| What | Path under `/console/u/0/developers/<devId>/app/<pkg>/` | Text-scrapable? |
| --- | --- | --- |
| App overview | `/app-dashboard` | Mostly nav chrome |
| **Grow users headline** | `/grow-overview` | ✅ **Best text source.** Inlines: device acquisitions, first opens, MAU, 7-day retention, store-listing conversion rate, all as 28d totals with WoW % deltas. |
| Statistics (any metric) | `/statistics?metrics=<METRIC_KEY>&dimension=COUNTRY&dimensionValues=OVERALL%2CUS%2CCA%2CIR%2CDE&dateRange=2026_5_1-2026_5_28` | Daily values inline for `ACTIVE_USERS` only; other metrics render data only in `<canvas>`. |
| Vitals (crashes, ANR) | `/vitals/crashes?days=28&versionCode=<v>&isUserPerceived=true` | "1 - N" pagination string gives crash *issue count*; rates are SVG. |
| Store listing analysis | `/reporting/acquisition/details` | 3 charts (Visitors, Acquisitions, Conversion) — all `<canvas>`, not text. |
| Financial overview | `/reporting/finance/overview` | ARPPU + avg transaction value in text; revenue is SVG. |
| Financial revenue | `/reporting/finance/revenue` | Canvas only. |
| Financial buyers | `/reporting/finance/buyers` | Canvas only. |
| Financial conversions | `/reporting/finance/buyers-conversions` | Cohort table — text on small datasets, "Data unavailable" if sparse. |
| Subscriptions (products) | `/subscriptions` | Product list only — analytics elsewhere. |
| Ratings overview | `/user-feedback/ratings` | ✅ Headline: default rating, 28d avg rating, ratings count, peer median. |
| Reviews list | `/user-feedback/reviews` | ✅ Recent reviews including text body, author, date, device. |

### Statistics page metric keys (deep links)

The `?metrics=<KEY>` URL param swaps the metric. Verified keys:

```
DEVICE_ACQUISITION-ALL-EVENTS-PER_INTERVAL-DAY            ← installs
ENGAGEMENT_DAILY_ACTIVE_USERS-ACQUISITION_UNSPECIFIED-UNIQUE-PER_INTERVAL-DAY  ← DAU
ENGAGEMENT_RETENTION_BY_DEVICE-ACQUISITION_UNSPECIFIED-COUNT_UNSPECIFIED-PER_INTERVAL-DAY  ← retention cohort
FIRST_OPENS_BY_DEVICE-ACQUISITION_UNSPECIFIED-COUNT_UNSPECIFIED-PER_INTERVAL-DAY  ← first opens
ACTIVE_USERS-ALL-UNIQUE-PER_INTERVAL-DAY                  ← active users (only one with daily text)
```

### The Canvas wall

**Most Statistics / Financial / Acquisition pages render their charts as `<canvas>`, not SVG.** That means:

- No text/aria fallback on data points.
- Path geometry can't be parsed back to values (raster, not vector).
- Tooltip-on-hover is the only DOM way to surface values — one mouseover per day per metric, ~28× per metric, brittle and slow.

The two text-friendly exceptions on the dashboard are:
1. **`/grow-overview`** — 28d headlines in text.
2. **`/statistics?metrics=ACTIVE_USERS-…`** with multi-country `dimensionValues` — renders a "Percentage of total" daily table in plain text. Other metrics on the same page do NOT, for reasons unclear.

### Chart-hover sweep — the working per-day technique

Google Charts in Play Console publish an aria-live announcement of shape

```
<YYYY-MM-DD> 00:00:00.000: <series name> is <value>.
```

every time the cursor crosses a datapoint. The series name varies per chart ("All countries / regions", "Peers' median (…)", etc.). To sweep:

1. Inject `play_scrape.js`. Call `window.aaarrrInstallChartObserver()` — sets a `MutationObserver` that catches every announcement.
2. Scroll the canvas into view: `window.aaarrrScrollPlayContent(<scrollTop>)` (Play scrolls inside `.main-content`, not the window).
3. Read coordinates: `window.aaarrrChartHoverGrid(<canvasIndex>, 30)` returns ~30 `[x, y]` viewport points across the chart's x-axis.
4. Real-hover at each point. Use `mcp__Claude_in_Chrome__computer { action: "hover" }` in one `browser_batch` — synthetic JS pointer events DO NOT trigger the chart.
5. After the batch, `window.aaarrrReadCaptures({ excludePeers: true })` returns the captured `{ date, value }` series.

**Cost:** ~30 hovers × ~150 tokens each + 2 JS reads ≈ 5–6K tokens per chart. Compute window aggregates locally in Python.

**Charts that work this way:** every canvas chart in Play Console — Store listing visitors/acquisitions/conversion, Retention, DAU, Revenue, Crash rate. Same observer regex works on all of them.

### Two known traps when sweeping

- **Conversion-rate charts have a "Peers' median" series.** The first regex was `is ([\d.]+)` — for a single-series chart, that's fine; for a two-series chart, the value picked up the trailing `.` from "is 0.21." and `Number` returned NaN. The observer in `play_scrape.js` is now `is (\d+(?:\.\d+)?)` to avoid this.
- **Charts past the first canvas are off-screen.** `getBoundingClientRect` will show `y` outside the viewport. Scroll `.main-content` (not `window`) by ~600px to bring the second chart into view. The hover-grid helper warns if the canvas isn't visible.

### Why not synthetic keyboard / pointer events

The chart container has `tabindex=0` and the page advertises "Use left and right keys to navigate." Dispatching synthetic `KeyboardEvent('keydown', { key: 'ArrowRight' })` DOES update the chart, but firing 30 of them in a tight loop with the chart's `requestAnimationFrame` redraw between each one will exceed the Chrome MCP's 45s `Runtime.evaluate` timeout. Real keyboard via `computer.key` works but costs the same as hover. Stick with hover.

### Where to actually go for production

For high-fidelity, low-cost, contract-stable per-day data, the official APIs win:
- **App Store Connect Analytics Reports API** — JWT-auth, daily report files. https://developer.apple.com/help/app-store-connect-analytics/overview/analytics-reports-api/
- **Play Developer Reporting API** — OAuth, REST; covers Android Vitals (crashes/ANR/slow starts/wakelocks). https://developers.google.com/play/developer/reporting
- **Google Play Billing reconciliation** — for revenue, use the Cloud Storage reconciliation reports rather than dashboard scraping.

The chart-hover technique is great for "I want a daily report tonight without setting up OAuth." For production runs, set up the APIs once.

### Card label patterns

The scraper finds cards by their label text. If Google changes wording, update
these regexes in `play_scrape.js`:

```js
/first[- ]?time install/i      → first_downloads
/active devices/i              → active_devices
/store listing conversion/i    → conversion_rate
/crash rate/i                  → crash_rate
/anr rate/i                    → anr_rate
/uninstalls?/i                 → uninstalls
```

### Known v1 gaps on Play

Play Console doesn't surface these natively in the v1 scraper — report shows
`—` with a footnote pointing the reader at the closest dashboard equivalent:

- **Impressions** — only "store listing visitors" (≈ page views) is exposed.
- **Sessions / sessions-per-device** — requires Firebase Analytics integration.
- **Redownloads** — Play exposes "re-installs" only in Statistics with a
  custom dimension toggle; the v1 scraper doesn't flip that toggle.

## When everything breaks at once

If both stores' scrapers return only nulls, that's almost always **session
death**, not selector rot. Visit the dashboard manually, complete 2FA, then
re-run `/aaarrr MyApp --refresh`.
