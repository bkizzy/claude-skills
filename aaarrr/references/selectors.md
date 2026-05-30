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

These are the `measures[]` strings the time-series endpoint accepts. If a
measure name has changed, check the Analytics page's network panel for the
current key — Apple sometimes renames (`installs` ↔ `installations`).

```
impressionsTotalUnique
pageViewUnique
installs
redownloads
installsConversionRate
activeDevices
sessions
sessionsPerActiveDevice
crashes
payingUserProceeds
iapPurchases
activeSubscriptions
proceedsPerPayingUser
userRetention      ← uses frequency "total" + a `day` field in response
```

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

### Strategy for full coverage (out of scope v1)

If you want per-day Play data without the canvas wall:
- **Play Developer Reporting API** — official, OAuth, covers crashes, ANR, slow starts, wakelocks. Limited to vitals data. https://developers.google.com/play/developer/reporting
- **Hover-and-capture** — script `mouseover` events at chart x-coordinates calculated from the date range. Brittle but works.
- **Reverse the protobuf RPC** — the data lives in cross-origin POSTs to `playconsoleplatform-pa.clients6.google.com` with rotating `SAPISIDHASH` auth tokens. Complex; would replicate the official API badly.

### Detection probe (Step 3 of SKILL.md)

```js
(() => ({
  loggedIn: !!document.querySelector('[role="navigation"]') &&
             !location.hostname.includes('accounts.google.com'),
  reason:   document.title || location.pathname,
}))();
```

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
