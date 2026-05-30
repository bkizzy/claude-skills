// App Store Connect (private dashboard) scraper.
// Runs in-page via Claude-in-Chrome `javascript_tool`. Requires the user to be
// signed into appstoreconnect.apple.com in the active tab.
//
// Config arrives on `window.__aaarrrCfg`:
//   { app: "MyApp",                   // required: name/sku to look up
//     dates: { yesterday, rolling_7d, prior_7d, baseline_28d },
//     forceAppId?: "1234567890"       // optional: skip lookup, use this id
//   }
//
// Returns the shared AAARRR JSON shape (see references/aaarrr_mapping.md).
// On any per-metric failure, the value is `null` and a string is pushed to
// the top-level `errors[]` — the renderer turns nulls into "—" footnotes.
//
// App resolution order (so a user with multiple matching-like apps can
// disambiguate without changing the cfg):
//   1. `cfg.forceAppId` if provided — used as-is.
//   2. `location.href` — if the user pre-navigated to /apps/<id>/... in
//      Connect, that id is used directly (no name match attempted).
//   3. Exact case-insensitive name match in /iris/v1/apps.
//   4. Single substring match — used, with a note in errors[].
//   5. Multiple substring matches — return { error: "ambiguous_app",
//      candidates: [{id, name, bundleId, sku}] }. The skill is responsible
//      for prompting the user to pick one (by name, sku, or by navigating
//      to that app's Connect page) before re-running with --refresh.
//   6. No matches — return { error: "app_not_found_in_store" }.
//
// Measure names: the analytics API is internal and undocumented. The names
// below were captured from live ASC traffic on 2026-05-13. If a measure
// 400s, open DevTools → Network on the Analytics page, watch the POSTs
// to `/analytics/api/v1/data/time-series`, and update the MEASURE table.

(async () => {
  const cfg = window.__aaarrrCfg || {};
  const errors = [];
  const log = (msg) => errors.push(msg);

  const blank = () => ({ "7d": null, "prior_7d": null, "28d": null, "yesterday": null, "day_before": null });
  const result = {
    store: "apple_connect",
    app: cfg.app || null,
    windows: cfg.dates || null,
    app_meta: { app_store_id: null, bundle_id: null, name: null },
    awareness:   { impressions: blank(), page_views: blank() },
    acquisition: { first_downloads: blank(), redownloads: blank(), conversion_rate: blank(), top_sources: [] },
    activation:  { active_devices: blank(), sessions: blank(), sessions_per_device: blank(), crashes: blank() },
    retention:   { d1: null, d7: null, d14: null, d28: null },
    revenue:     { proceeds_usd: blank(), iap_count: blank(), active_subs: blank(), arpu: blank(), paying_users: blank() },
    referral:    { by_source: [] },
    ratings:     { avg: null, count: null, new_yesterday: null, recent_reviews: [] },
    asc_public:  null,
    errors,
  };

  if (!cfg.dates) {
    log("missing __aaarrrCfg.dates");
    return result;
  }

  // --- 1. Resolve the app -------------------------------------------------
  let appId = null;

  // 1a. forceAppId wins.
  if (cfg.forceAppId) appId = String(cfg.forceAppId);

  // 1b. URL match — if user pre-navigated to /apps/<id>/, use it.
  if (!appId) {
    const m = location.pathname.match(/\/apps\/(\d{6,})(?:\/|$)/);
    if (m) {
      appId = m[1];
      log(`app picked from current URL (/apps/${appId}/)`);
    }
  }

  // 1c. Name lookup against /iris/v1/apps.
  if (!appId) {
    if (!cfg.app) {
      log("no cfg.app and no forceAppId / Connect URL — cannot resolve app");
      result.error = "app_not_found_in_store";
      return result;
    }
    try {
      const res = await fetch("/iris/v1/apps?limit=200", {
        credentials: "include",
        headers: { Accept: "application/vnd.api+json" },
      });
      if (!res.ok) throw new Error(`apps list HTTP ${res.status}`);
      const body = await res.json();
      const all = body.data || [];
      const wanted = cfg.app.toLowerCase().trim();
      const exact = all.filter((a) => (a.attributes?.name || "").toLowerCase().trim() === wanted);
      const substr = exact.length ? exact : all.filter((a) => (a.attributes?.name || "").toLowerCase().includes(wanted));

      if (substr.length === 0) {
        result.error = "app_not_found_in_store";
        log(`no app matching "${cfg.app}" in this Connect account`);
        return result;
      }
      if (exact.length === 0 && substr.length > 1) {
        result.error = "ambiguous_app";
        result.candidates = substr.map((a) => ({
          id: a.id,
          name: a.attributes?.name || null,
          bundleId: a.attributes?.bundleId || null,
          sku: a.attributes?.sku || null,
        }));
        log(`ambiguous: ${substr.length} apps matched "${cfg.app}"`);
        return result;
      }
      const pick = substr[0];
      appId = pick.id;
      result.app_meta.bundle_id = pick.attributes?.bundleId || null;
      result.app_meta.name = pick.attributes?.name || null;
      if (exact.length === 0) log(`fuzzy match used: "${pick.attributes?.name}" for query "${cfg.app}"`);
    } catch (e) {
      result.error = "app_lookup_failed";
      log(`/iris/v1/apps failed: ${e.message}`);
      return result;
    }
  }

  // If we got the id from URL/forceAppId, backfill name + bundle.
  if (!result.app_meta.name) {
    try {
      const r = await fetch(`/iris/v1/apps/${appId}`, { credentials: "include", headers: { Accept: "application/vnd.api+json" } });
      if (r.ok) {
        const j = await r.json();
        result.app_meta.name = j.data?.attributes?.name || null;
        result.app_meta.bundle_id = j.data?.attributes?.bundleId || null;
      }
    } catch (e) { log(`iris/apps/${appId}: ${e.message}`); }
  }
  result.app_meta.app_store_id = appId;

  // --- 2. Measure catalog -------------------------------------------------
  // Each entry: API measure name. Sum metrics aggregate over windows; rate
  // metrics average over windows.
  const SUM_MEASURES = {
    impressions:     "impressionsTotalUnique",
    page_views:      "pageViewUnique",
    first_downloads: "units",
    redownloads:     "redownloads",
    active_devices:  "activeDevices",
    sessions:        "sessions",
    crashes:         "crashes",
    proceeds_usd:    "proceeds",
    iap_count:       "iap",
    paying_users:    "payingUsers",
  };
  const RATE_MEASURES = {
    conversion_rate: "conversionRate",
    // sessions_per_device and arpu are computed below from existing
    // measures (no direct API equivalent on /time-series as of 2026-05-13).
  };

  const ANALYTICS_BASE = "/analytics/api/v1/data/time-series";
  const DIM_BASE       = "/analytics/api/v1/data/dimension-values";

  async function fetchSeries(measure, start, end) {
    const body = {
      adamId: [appId],
      measures: [measure],
      frequency: "day",
      startTime: start + "T00:00:00Z",
      endTime:   end   + "T23:59:59Z",
    };
    const res = await fetch(ANALYTICS_BASE, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", "X-Requested-By": "appstoreconnect" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const series = json.results?.[0]?.data || [];
    // Apple returns dates as full ISO; normalize to YYYY-MM-DD so simple
    // string compares against cfg.dates.* work without zone surprises.
    return series.map((p) => ({ ...p, date: (p.date || "").slice(0, 10) }));
  }

  function sumRange(series, start, end, key) {
    return series
      .filter((p) => p.date >= start && p.date <= end)
      .reduce((acc, p) => acc + (Number(p[key]) || 0), 0);
  }
  function avgRange(series, start, end, key) {
    const inR = series.filter((p) => p.date >= start && p.date <= end);
    if (!inR.length) return null;
    return inR.reduce((a, p) => a + (Number(p[key]) || 0), 0) / inR.length;
  }
  function pointOn(series, date, key) {
    const row = series.find((p) => p.date === date);
    return row ? Number(row[key]) || 0 : null;
  }
  function dayBeforeDate(yDate) {
    const d = new Date(yDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  async function pull(measure, isRate = false) {
    try {
      const series = await fetchSeries(measure, cfg.dates.baseline_28d.start, cfg.dates.baseline_28d.end);
      const yDate = cfg.dates.yesterday.date;
      const dbDate = dayBeforeDate(yDate);
      const f = isRate ? avgRange : sumRange;
      // ASC returns rate measures as percentages (e.g. 19.45 means 19.45%, not
      // 1945%). The shared schema expects fractions (0–1) so the renderer can
      // format with a single rule. Normalize here on intake.
      const scale = isRate ? (v) => (v == null ? null : v / 100) : (v) => v;
      return {
        "7d":         scale(f(series, cfg.dates.rolling_7d.start,   cfg.dates.rolling_7d.end,   measure)),
        "prior_7d":   scale(f(series, cfg.dates.prior_7d.start,     cfg.dates.prior_7d.end,     measure)),
        "28d":        scale(f(series, cfg.dates.baseline_28d.start, cfg.dates.baseline_28d.end, measure)),
        "yesterday":  scale(pointOn(series, yDate,  measure)),
        "day_before": scale(pointOn(series, dbDate, measure)),
        _series: series, // kept for derived-metric computation; stripped before return
      };
    } catch (e) {
      log(`apple_connect.${measure}: ${e.message}`);
      return null;
    }
  }

  // --- 3. Pull in parallel ------------------------------------------------
  const sumPulls = Object.fromEntries(await Promise.all(
    Object.entries(SUM_MEASURES).map(async ([k, m]) => [k, await pull(m, false)])
  ));
  const ratePulls = Object.fromEntries(await Promise.all(
    Object.entries(RATE_MEASURES).map(async ([k, m]) => [k, await pull(m, true)])
  ));
  const [topSources, ratingsSummary] = await Promise.all([
    pullTopSources(),
    pullRatings(),
  ]);

  // --- 4. Derived metrics (no direct API measure) -------------------------
  // sessions_per_device = sum(sessions) / sum(activeDevices) per window.
  // ARPU = sum(proceeds) / sum(payingUsers) per window.
  function deriveRatio(numeratorBlock, denominatorBlock) {
    if (!numeratorBlock || !denominatorBlock) return blank();
    const r = blank();
    for (const k of ["7d","prior_7d","28d","yesterday","day_before"]) {
      const n = numeratorBlock[k];
      const d = denominatorBlock[k];
      r[k] = (n != null && d != null && d > 0) ? n / d : null;
    }
    return r;
  }
  const sessions_per_device = deriveRatio(sumPulls.sessions, sumPulls.active_devices);
  const arpu                = deriveRatio(sumPulls.proceeds_usd, sumPulls.paying_users);

  function strip(block) {
    if (!block) return blank();
    const { _series, ...rest } = block;
    return rest;
  }

  result.awareness.impressions  = strip(sumPulls.impressions);
  result.awareness.page_views   = strip(sumPulls.page_views);
  result.acquisition.first_downloads = strip(sumPulls.first_downloads);
  result.acquisition.redownloads     = strip(sumPulls.redownloads);
  result.acquisition.conversion_rate = strip(ratePulls.conversion_rate);
  result.acquisition.top_sources     = topSources;
  result.activation.active_devices      = strip(sumPulls.active_devices);
  result.activation.sessions            = strip(sumPulls.sessions);
  result.activation.sessions_per_device = sessions_per_device;
  result.activation.crashes             = strip(sumPulls.crashes);
  result.revenue.proceeds_usd = strip(sumPulls.proceeds_usd);
  result.revenue.iap_count    = strip(sumPulls.iap_count);
  result.revenue.paying_users = strip(sumPulls.paying_users);
  result.revenue.arpu         = arpu;
  result.referral.by_source   = topSources;
  result.ratings              = ratingsSummary;

  // active_subs and retention: v1 gap — endpoint paths still being mapped.
  // The dashboard fetches them from different URLs than /time-series; once
  // selectors.md is updated, wire them in here.
  log("apple_connect.active_subs: not implemented (subscription endpoint path TBD — see selectors.md)");
  log("apple_connect.retention: not implemented (cohort endpoint path TBD — see selectors.md)");

  return result;

  // --- helpers below ------------------------------------------------------

  async function pullTopSources() {
    // The dimension-values endpoint returns ranked source NAMES (descending by
    // the named measure), but the per-source `measures` field is a list of
    // measure-IDs available for that source, NOT the actual metric totals.
    // To get totals per source we'd need a follow-up time-series call per
    // value with a dimensionFilter — out of scope for v1, since the source
    // names alone already answer "which channels are bringing installs?".
    // share_7d is left null; the renderer surfaces just the ordered names.
    try {
      const body = {
        adamId: [appId],
        startTime: cfg.dates.rolling_7d.start + "T00:00:00Z",
        endTime:   cfg.dates.rolling_7d.end   + "T23:59:59Z",
        frequency: "day",
        measure: "totalDownloads",
        dimensions: [{ rank: "DESCENDING", dimension: "source", limit: 8 }],
        dimensionFilters: [],
      };
      const res = await fetch(DIM_BASE, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "X-Requested-By": "appstoreconnect" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const values = j.results?.[0]?.values || [];
      return values.slice(0, 6).map((v) => ({
        name: v.title || v.id || "unknown",
        share_7d: null,
        share_prior_7d: null,
      }));
    } catch (e) {
      log(`apple_connect.top_sources: ${e.message}`);
      return [];
    }
  }

  async function pullRatings() {
    try {
      const res = await fetch(`/iris/v1/apps/${appId}/customerReviews?limit=20&sort=-createdDate`, {
        credentials: "include",
        headers: { Accept: "application/vnd.api+json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const rows = j.data || [];
      const since = cfg.dates.yesterday.date;
      const newY = rows.filter((r) => (r.attributes?.createdDate || "").slice(0, 10) === since).length;
      const recent = rows.slice(0, 5).map((r) => ({
        rating: r.attributes?.rating ?? null,
        title:  r.attributes?.title  ?? "",
        body:   (r.attributes?.body  ?? "").slice(0, 280),
        date:   (r.attributes?.createdDate || "").slice(0, 10),
      }));
      let avg = null, count = null;
      if (rows.length) {
        const r = rows.map((x) => Number(x.attributes?.rating) || 0).filter(Boolean);
        if (r.length) avg = r.reduce((a, n) => a + n, 0) / r.length;
        count = rows.length;
      }
      return { avg, count, new_yesterday: newY, recent_reviews: recent };
    } catch (e) {
      log(`apple_connect.ratings: ${e.message}`);
      return { avg: null, count: null, new_yesterday: null, recent_reviews: [] };
    }
  }
})();
