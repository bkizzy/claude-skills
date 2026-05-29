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

### Page paths (relative)

| What | Path under `/console/u/0/developers/<devId>/app/<pkg>/` |
| --- | --- |
| App overview | `/dashboard` |
| Statistics (installs / actives) | `/statistics` |
| Retention | `/statistics?ts_view=retention` |
| Vitals (crashes, ANR) | `/vitals/overview` |
| Acquisition channels | `/acquisition-reports/store-listing` |
| Reviews | `/user-feedback/reviews` |

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

### Detection probe (Step 3 of SKILL.md)

```js
(() => ({
  loggedIn: !!document.querySelector('[role="navigation"]') &&
             !location.hostname.includes('accounts.google.com'),
  reason:   document.title || location.pathname,
}))();
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
