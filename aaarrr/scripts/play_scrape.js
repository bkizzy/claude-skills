// Google Play Console helper library.
//
// Unlike the App Store Connect scraper (which is a single IIFE that pulls
// everything from one well-documented JSON endpoint), Play Console doesn't
// expose a single data source. The chart values are rendered to <canvas>
// elements with no text or aria fallback. The path that actually works is:
//
//   1. Navigate to /grow-overview — text-rendered headline 28d numbers
//      (device acquisitions, MAU, first opens, 7d retention, conversion).
//      This is the fast win — no chart hovering required.
//   2. For per-day breakdowns, navigate to chart-bearing pages
//      (/reporting/acquisition/details, /vitals/crashes, etc.) and SWEEP
//      each canvas: real mouse hovers across the chart's x-axis trigger
//      Google's aria-live announcement
//          "<YYYY-MM-DD> 00:00:00.000: <series> is <value>."
//      A MutationObserver scrapes those announcements as they fire.
//
// This file exposes the helpers Claude calls from the SKILL. It is NOT a
// standalone IIFE — the skill orchestrates navigation, scroll, and hover
// between calls.

// ---------------------------------------------------------------------------
// Public-page URL stems and routes (verified May 2026, see selectors.md)
// ---------------------------------------------------------------------------
const PLAY_PATHS = {
  appsList:      "/console/u/0/developers/<devId>/app-list",
  appDashboard:  "/console/u/0/developers/<devId>/app/<pkg>/app-dashboard",
  growOverview:  "/console/u/0/developers/<devId>/app/<pkg>/grow-overview",
  statistics:    "/console/u/0/developers/<devId>/app/<pkg>/statistics",
  vitalsCrashes: "/console/u/0/developers/<devId>/app/<pkg>/vitals/crashes",
  financeOver:   "/console/u/0/developers/<devId>/app/<pkg>/reporting/finance/overview",
  financeRev:    "/console/u/0/developers/<devId>/app/<pkg>/reporting/finance/revenue",
  acquisition:   "/console/u/0/developers/<devId>/app/<pkg>/reporting/acquisition/details",
  ratings:       "/console/u/0/developers/<devId>/app/<pkg>/user-feedback/ratings",
  reviews:       "/console/u/0/developers/<devId>/app/<pkg>/user-feedback/reviews",
};
const STATS_METRIC_KEYS = {
  DEVICE_ACQUISITION: "DEVICE_ACQUISITION-ALL-EVENTS-PER_INTERVAL-DAY",
  ACTIVE_USERS:       "ACTIVE_USERS-ALL-UNIQUE-PER_INTERVAL-DAY",
  RETENTION:          "ENGAGEMENT_RETENTION_BY_DEVICE-ACQUISITION_UNSPECIFIED-COUNT_UNSPECIFIED-PER_INTERVAL-DAY",
  FIRST_OPENS:        "FIRST_OPENS_BY_DEVICE-ACQUISITION_UNSPECIFIED-COUNT_UNSPECIFIED-PER_INTERVAL-DAY",
};

// ---------------------------------------------------------------------------
// 1. Detection probe — call after navigate() to confirm the page is ready.
//    Returns { ready: boolean, reason: string }. "Ready" is stricter than
//    "signed in": it means the apps list (or an app sub-page) is actually
//    rendered, not the dev-account chooser or 2FA prompt.
// ---------------------------------------------------------------------------
window.aaarrrPlayProbe = () => ({
  ready:
    location.hostname.includes("play.google.com") &&
    location.pathname.includes("/console/u/") &&
    !location.hostname.includes("accounts.google.com") &&
    // past /developers/ — i.e. inside a dev account, not the chooser
    /\/developers\/\d+/.test(location.pathname) &&
    // app list rows are in the DOM
    !!document.querySelector('a[href*="/app/"]'),
  reason: document.title || location.pathname,
});

// ---------------------------------------------------------------------------
// 2. Headline 28d numbers from /grow-overview — the cheapest scrape path.
//    Returns { device_acquisitions, first_opens, mau, retention_d7,
//              conversion_rate, deltas } as 28-day aggregates with WoW%.
//    Call AFTER navigating to PLAY_PATHS.growOverview and waiting for it.
// ---------------------------------------------------------------------------
window.aaarrrPlayGrowOverview = () => {
  const t = (document.body.innerText || "").replace(/\s+/g, " ");
  // Pattern: each card emits "<Label> <value> arrow_right_alt +N% delta ..."
  // The deltas are in plain text "+78% delta, where an increase is good".
  const grab = (label) => {
    const re = new RegExp(label + "\\s+([\\d,.]+(?:%)?)\\s+arrow_(?:right|left)_alt\\s+([+-]?\\d+)%", "i");
    const m = t.match(re);
    if (!m) return { value: null, delta_pct: null };
    const raw = m[1];
    const value = raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw.replace(/,/g, ""));
    return { value, delta_pct: Number(m[2]) };
  };
  // "Your conversion rate is X%" is shown separately at the bottom.
  const convMatch = t.match(/conversion rate is\s+([\d.]+)%/i);
  return {
    device_acquisitions: grab("Device acquisitions"),
    first_opens:         grab("First opens"),
    mau:                 grab("MAU"),
    retention_d7:        grab("7-day retention"),
    conversion_rate:     convMatch ? { value: Number(convMatch[1]) / 100, delta_pct: null } : { value: null, delta_pct: null },
  };
};

// ---------------------------------------------------------------------------
// 3. App finder — walk the dev's apps list to map a name -> { packageId, name }.
//    Call AFTER navigating to PLAY_PATHS.appsList.
// ---------------------------------------------------------------------------
window.aaarrrPlayFindApp = (queryName) => {
  const q = (queryName || "").toLowerCase().trim();
  const rows = Array.from(document.querySelectorAll('a[href*="/app/"]'));
  const seen = new Map(); // packageId -> { row text, packageId }
  for (const a of rows) {
    const h = a.getAttribute("href") || "";
    const m = h.match(/\/app\/(\d+)/);
    if (!m) continue;
    const packageId = m[1];
    if (seen.has(packageId)) continue;
    const container = a.closest("tr, [role='row'], li, [class*='row']") || a.parentElement;
    const text = (container?.innerText || "").replace(/\s+/g, " ").trim();
    seen.set(packageId, { packageId, text });
  }
  const all = Array.from(seen.values());
  const exact = all.filter((r) => r.text.toLowerCase().includes(q));
  if (!exact.length) return { error: "app_not_found", candidates: all };
  if (exact.length > 1) return { error: "ambiguous_app", candidates: exact };
  return exact[0];
};

// ---------------------------------------------------------------------------
// 4. Ratings overview — from /user-feedback/ratings, text is inlined.
//    Returns { default_rating, recent_avg, raters, peer_median }.
// ---------------------------------------------------------------------------
window.aaarrrPlayRatings = () => {
  const t = (document.body.innerText || "").replace(/\s+/g, " ");
  const defaultR = t.match(/([\d.]+)\s*star\s+Default Google Play rating/);
  const recent   = t.match(/([\d.]+)\s*star\s+Average rating \(last 28 days\)/);
  const raters   = t.match(/Users\s+(\d+)/);
  const peer     = t.match(/([\d.]+)\s*star\s+Peers' median/);
  return {
    default_rating: defaultR ? Number(defaultR[1]) : null,
    recent_avg:     recent   ? Number(recent[1])   : null,
    raters:         raters   ? Number(raters[1])   : null,
    peer_median:    peer     ? Number(peer[1])     : null,
  };
};

// ---------------------------------------------------------------------------
// 5. Chart-hover infrastructure — install the observer BEFORE the sweep.
//    Captures every announcement of shape "<date> 00:00:00.000: <series> is <n>"
//    that fires while the cursor moves across a chart canvas.
// ---------------------------------------------------------------------------
window.aaarrrInstallChartObserver = () => {
  window.__chartCaptures = [];
  if (window.__chartObserver) window.__chartObserver.disconnect();
  window.__chartObserver = new MutationObserver(() => {
    const t = document.body.innerText || "";
    const matches = Array.from(t.matchAll(/(20\d\d-\d\d-\d\d) 00:00:00\.000: ([^:]+?) is (\d+(?:\.\d+)?)/g));
    for (const m of matches) {
      const k = m[1] + "|" + m[2].trim() + "|" + m[3];
      if (!window.__chartCaptures.find((c) => c.k === k)) {
        window.__chartCaptures.push({ k, date: m[1], series: m[2].trim(), value: Number(m[3]) });
      }
    }
  });
  window.__chartObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  return "observer-armed";
};

// ---------------------------------------------------------------------------
// 6. Chart coordinates — call AFTER the page settles to compute the x-axis
//    hover positions. Returns absolute viewport coordinates suitable for
//    feeding into Claude-in-Chrome's `computer.hover` action.
//
//    The chart canvas is typically 600x260 with 28 daily points. We sample
//    at slightly higher density (default 30 positions across 600px) so each
//    daily point is hit even with small layout shifts.
// ---------------------------------------------------------------------------
window.aaarrrChartHoverGrid = (canvasIndex = 0, samples = 30) => {
  const c = document.querySelectorAll("canvas")[canvasIndex];
  if (!c) return { error: "no-canvas-at-index" };
  const r = c.getBoundingClientRect();
  if (r.width === 0) return { error: "canvas-not-visible (scroll the inner .main-content into view first)" };
  const y = Math.round(r.top + r.height / 2);
  const stepX = r.width / (samples - 1);
  const positions = [];
  for (let i = 0; i < samples; i++) positions.push([Math.round(r.left + i * stepX), y]);
  return { canvasIndex, x_range: [Math.round(r.left), Math.round(r.left + r.width)], y, positions };
};

// ---------------------------------------------------------------------------
// 7. Read the observer's captures, filtered to a series of interest.
//    The conversion-rate chart has a "Peers' median" series too — pass
//    excludePeers: true to skip it. Returns a sorted array of {date, value}.
// ---------------------------------------------------------------------------
window.aaarrrReadCaptures = (opts = {}) => {
  const { excludePeers = true } = opts;
  const raw = window.__chartCaptures || [];
  const filtered = excludePeers ? raw.filter((c) => c.series.indexOf("Peers") === -1) : raw;
  // Deduplicate by date, keeping the first value seen.
  const byDate = new Map();
  for (const c of filtered) if (!byDate.has(c.date)) byDate.set(c.date, c.value);
  return [...byDate.entries()].sort().map(([date, value]) => ({ date, value }));
};

// ---------------------------------------------------------------------------
// 8. Inner-scroller helper — Play Console renders inside a fixed-position
//    .main-content div, so window.scrollTo() doesn't bring later charts into
//    view. Use this helper to scroll the right container.
// ---------------------------------------------------------------------------
window.aaarrrScrollPlayContent = (scrollTop) => {
  const s = document.querySelector(".main-content");
  if (!s) return { error: "no-main-content-scroller" };
  s.scrollTop = scrollTop;
  return { scrolled_to: s.scrollTop };
};

// Expose path templates so the SKILL can build URLs.
window.aaarrrPaths = PLAY_PATHS;
window.aaarrrStatsMetrics = STATS_METRIC_KEYS;
"play-helpers-loaded";
