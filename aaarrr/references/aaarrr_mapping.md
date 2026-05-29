# AAARRR → Dashboard mapping

Authoritative mapping of each pirate-metrics pillar to dashboard fields per store.
The scrapers emit one uniform shape; this file is for humans (and for Claude
when patching a scraper).

## Shared per-store JSON shape

```json
{
  "store": "apple_connect | google_play",
  "app":   "<name as user typed>",
  "windows": {
    "yesterday":    { "date":  "YYYY-MM-DD" },
    "rolling_7d":   { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "prior_7d":     { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "baseline_28d": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" }
  },
  "app_meta":   { "app_store_id|package_name": "...", "bundle_id": "...", "name": "..." },
  "awareness":  { "impressions": M, "page_views": M },
  "acquisition":{ "first_downloads": M, "redownloads": M, "conversion_rate": M, "top_sources": [{ name, share_7d, share_prior_7d }] },
  "activation": { "active_devices": M, "sessions": M, "sessions_per_device": M, "crashes": M },
  "retention":  { "d1": pct, "d7": pct, "d14": pct, "d28": pct },
  "revenue":    { "proceeds_usd": M, "iap_count": M, "active_subs": M, "arpu": M },
  "referral":   { "by_source": [{ name, share_7d, share_prior_7d }] },
  "ratings":    { "avg": float, "count": int, "new_yesterday": int, "recent_reviews": [{ rating, title, body, author?, date }] },
  "asc_public": null | { rating, rank, editorial, recent_reviews, errors },
  "errors":     ["string", ...]
}
```

Where `M` (Metric) = `{ "7d": n|null, "prior_7d": n|null, "28d": n|null, "yesterday": n|null, "day_before": n|null }`.

- For **sum metrics** (installs, sessions, proceeds…): `7d`/`prior_7d`/`28d` are sums over the window; `yesterday`/`day_before` are single-day values.
- For **rate metrics** (conversion rate, ARPU, sessions/device): `7d`/`prior_7d`/`28d` are averages over the window; `yesterday`/`day_before` are the rate observed on that single day (often null if the dashboard doesn't expose daily granularity for rates).
- A `null` means "not collected this run" — the renderer turns it into `—` with a footnote.
- `day_before` is the value for *the day before yesterday* — used to compute true DoD. The scrapers fill it from the same daily series they pull for the 28-day baseline. If absent, the renderer shows `—` in the DoD column rather than fabricating a delta from averages.

## Pillar → dashboard mapping

### Awareness — "Who sees us?"

| Field | App Store Connect | Google Play Console |
| --- | --- | --- |
| `impressions` | App Analytics → Metrics → **Impressions (Unique)** | _Not exposed directly_ — closest is Acquisition reports → Store performance (page views). |
| `page_views`  | App Analytics → Metrics → **Product Page Views (Unique)** | Acquisition reports → **Store listing visitors** |

### Acquisition — "Who installs?"

| Field | App Store Connect | Google Play Console |
| --- | --- | --- |
| `first_downloads` | App Analytics → Metrics → **First-Time Downloads** (measure: `installs`) | Statistics → **First-time installers** |
| `redownloads`     | App Analytics → Metrics → **Redownloads** (measure: `redownloads`) | Statistics → **Re-installs** |
| `conversion_rate` | App Analytics → Metrics → **Conversion Rate** (rate; avg over range) | Acquisition reports → **Store listing conversion** |
| `top_sources`     | App Analytics → Sources dimension → top N by installs | Acquisition reports → **Acquisition channels** |

### Activation — "Do they open it?"

| Field | App Store Connect | Google Play Console |
| --- | --- | --- |
| `active_devices`      | App Analytics → Metrics → **Active Devices** | Statistics → **Active devices** |
| `sessions`            | App Analytics → Metrics → **Sessions** | _Not natively in Play Console (v1 gap)_ |
| `sessions_per_device` | App Analytics → Metrics → **Sessions per Active Device** (rate) | _v1 gap — see above_ |
| `crashes`             | App Analytics → Metrics → **Crashes** | Vitals → **Crash rate** (rate) |

### Retention — "Do they come back?"

Cohort metrics — point-in-time, not windowed.

| Field | App Store Connect | Google Play Console |
| --- | --- | --- |
| `d1`  | App Analytics → Engagement → **Retention** → day 1  | Statistics → Users → **Retained users** → day 1 |
| `d7`  | App Analytics → Engagement → **Retention** → day 7  | Statistics → Users → **Retained users** → day 7 |
| `d14` | App Analytics → Engagement → **Retention** → day 14 | Statistics → Users → **Retained users** → day 15 (Play uses 15, not 14) |
| `d28` | App Analytics → Engagement → **Retention** → day 28 | Statistics → Users → **Retained users** → day 30 (Play uses 30) |

### Revenue — "Do they pay?"

| Field | App Store Connect | Google Play Console |
| --- | --- | --- |
| `proceeds_usd` | App Analytics → Metrics → **Proceeds (paid)** (USD-normalized) | Financial reports → **Estimated revenue** |
| `iap_count`    | App Analytics → Metrics → **IAP transactions** | Financial reports → **Buyers / Transactions** |
| `active_subs`  | App Analytics → Subscriptions → **Active subscribers** | Subscriptions → **Active subscriptions** |
| `arpu`         | App Analytics → Metrics → **Proceeds per Paying User** (rate) | Financial reports → **ARPPU** |

### Referral — "Where do they come from?"

Stores' acquisition source reports are the closest native equivalent. For true
campaign-level UTM attribution you'd need a third-party SDK (out of scope v1).

| Field | App Store Connect | Google Play Console |
| --- | --- | --- |
| `by_source` | App Analytics → Sources dimension (same source as `top_sources`) | Acquisition reports → **Acquisition channels** |

The renderer copies `acquisition.top_sources` into `referral.by_source` when
those sections overlap — they almost always do on store-only data.

### Ratings — surfaced separately from the AAARRR pillars

| Field | App Store Connect | Google Play Console |
| --- | --- | --- |
| `avg` / `count` | App Analytics → Ratings → **Overall rating** | Quality → Ratings → **Average rating** |
| `new_yesterday` | Count of reviews with `createdDate == yesterday` | Same |
| `recent_reviews`| Ratings → most recent (latest 5) | Ratings → most recent (latest 5) |

The public Apple page (`asc_public`) supplements with category rank and the
Today/Featured editorial flag — strong Awareness signals not in Connect.
