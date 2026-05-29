#!/usr/bin/env node
// Merges per-store AAARRR JSON blobs into one Markdown report.
//
// Usage:
//   node build_report.mjs --slug <slug> [--window rolling_7d] --out <path.md>
//
// Reads `<skill_dir>/reports/<slug>_*_<YYYYMMDD>.json` (today's date), where
// <store> ∈ {apple_connect, google_play}. Writes the Markdown to --out and a
// parallel `<path>.summary.json` with the top movers (the SKILL surfaces them
// in a one-line message after the build finishes).
//
// No external dependencies. Node 20+.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const SKILL_DIR = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const REPORTS_DIR = path.join(SKILL_DIR, "reports");

// --- args --------------------------------------------------------------------
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args[a.slice(2)] = process.argv[i + 1]?.startsWith("--") ? true : process.argv[++i];
}
const slug = args.slug;
const windowMode = args.window || "rolling_7d";
const outPath = args.out;
if (!slug || !outPath) {
  console.error("usage: build_report.mjs --slug <slug> --out <path.md> [--window rolling_7d]");
  process.exit(2);
}

const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const candidates = fs.existsSync(REPORTS_DIR)
  ? fs.readdirSync(REPORTS_DIR).filter((f) => f.startsWith(`${slug}_`) && f.endsWith(`_${today}.json`))
  : [];

if (!candidates.length) {
  console.error(`no JSON in ${REPORTS_DIR} matching ${slug}_*_${today}.json`);
  process.exit(3);
}

const stores = {};
for (const f of candidates) {
  const data = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, f), "utf8"));
  stores[data.store] = data;
}

const ios = stores.apple_connect;
const android = stores.google_play;
const appName = ios?.app_meta?.name || android?.app_meta?.name || ios?.app || android?.app || slug;

// --- formatters --------------------------------------------------------------
// Number formatter — does NOT auto-flip small values to percent. For percents,
// use fmtPct explicitly via the row's `pct` flag.
const fmtNum = (n) => {
  if (n == null || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1000) return Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
};
const fmtPct = (n) => {
  if (n == null || Number.isNaN(n)) return "—";
  return (n * 100).toFixed(1) + "%";
};
const fmtDelta = (curr, prev) => {
  if (curr == null || prev == null || prev === 0) return "—";
  const d = (curr - prev) / prev;
  if (!isFinite(d)) return "—";
  const arrow = d > 0.02 ? "▲" : d < -0.02 ? "▼" : "·";
  const sign = d >= 0 ? "+" : "";
  return `${arrow} ${sign}${(d * 100).toFixed(0)}%`;
};

// Collect movers for the "what changed since yesterday" callout.
// Two channels: DoD (yesterday vs day_before) and WoW (7d vs prior_7d).
// The callout prefers DoD when available, falls back to WoW.
const dodMovers = [];
const wowMovers = [];
function pushMover(bucket, label, curr, prev) {
  if (curr == null || prev == null || prev === 0) return;
  const d = (curr - prev) / prev;
  if (!isFinite(d) || Math.abs(d) < 0.02) return;
  bucket.push({ label, curr, prev, d });
}

// Footnotes for unavailable fields.
const footnotes = [];
let footIdx = 0;
const fnMark = (store, where) => {
  footIdx++;
  footnotes.push({ id: footIdx, text: `${store}: not in v1 — find at ${where}.` });
  return `[^${footIdx}]`;
};

// --- per-pillar row builder --------------------------------------------------
// Each metric row is: iOS 7d | iOS DoD | iOS WoW | iOS 28d-avg | Android 7d | Android DoD | Android WoW | Android 28d-avg
function row(label, pluck, opts = {}) {
  const isPct = !!opts.pct;
  const fn = opts.fn; // optional footnote text per side

  const cell = (storeBlob, sideTag) => {
    if (!storeBlob || storeBlob.error) {
      return ["—", "—", "—", "—"];
    }
    const v = pluck(storeBlob);
    if (!v) return ["—", "—", "—", "—"];
    const curr   = v["7d"];
    const prior  = v["prior_7d"];
    const yday   = v["yesterday"];
    const dayBefore = v["day_before"] ?? null;
    const base28 = v["28d"];

    const f = isPct ? fmtPct : fmtNum;

    // Track movers in both channels for the callout.
    pushMover(dodMovers, `${label} (${sideTag})`, yday, dayBefore);
    pushMover(wowMovers, `${label} (${sideTag})`, curr, prior);

    // 28d "avg/day" column:
    //   - For sums (counts): divide by 28.
    //   - For rates (pct): the 28d field is already an average — pass through.
    const baselineDisplay = base28 == null
      ? "—"
      : isPct
        ? f(Number(base28))
        : f(Number(base28) / 28);

    return [
      f(curr),
      // DoD only renders if the scraper supplied day_before; otherwise "—"
      // (we don't fabricate a day-before from 28d averages — those produce
      // misleading huge deltas when the metric is small or noisy).
      fmtDelta(yday, dayBefore),
      fmtDelta(curr, prior),
      baselineDisplay,
    ];
  };

  const left = cell(ios, "iOS");
  const right = cell(android, "Android");
  let labelOut = label;
  if (fn?.ios && (!ios || ios.error)) labelOut += fnMark("apple_connect", fn.ios);
  if (fn?.android && (!android || android.error)) labelOut += fnMark("google_play", fn.android);
  return `| ${labelOut} | ${left.join(" | ")} | ${right.join(" | ")} |`;
}

const TABLE_HEAD =
  "| Metric | iOS 7d | DoD | WoW | 28d avg/day | Android 7d | DoD | WoW | 28d avg/day |\n" +
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |";

// --- sections ----------------------------------------------------------------
function section(title, rows) {
  return `## ${title}\n\n${TABLE_HEAD}\n${rows.join("\n")}\n`;
}

function awareness() {
  return section("Awareness", [
    row("Impressions",       (s) => s.awareness?.impressions, { fn: { android: "Play Console → Acquisition reports → Store performance" } }),
    row("Page views",        (s) => s.awareness?.page_views),
  ]);
}

function acquisition() {
  const rows = [
    row("First-time installs", (s) => s.acquisition?.first_downloads),
    row("Re-downloads",        (s) => s.acquisition?.redownloads, { fn: { android: "Play Console → Statistics → Re-installs" } }),
    row("Conversion rate",     (s) => s.acquisition?.conversion_rate, { pct: true }),
  ];

  // Top sources block below the table.
  const srcLines = [];
  const fmtSourceList = (label, list) => {
    if (!list || !list.length) return `_${label}: —_`;
    return `_${label}:_\n` + list.slice(0, 5).map((s) => `  - **${s.name}** — ${fmtPct(s.share_7d)}`).join("\n");
  };
  if (ios?.acquisition?.top_sources?.length) srcLines.push(fmtSourceList("iOS top sources (7d)", ios.acquisition.top_sources));
  if (android?.acquisition?.top_sources?.length) srcLines.push(fmtSourceList("Android top sources (7d)", android.acquisition.top_sources));
  const tail = srcLines.length ? "\n\n" + srcLines.join("\n\n") + "\n" : "";

  return section("Acquisition", rows) + tail;
}

function activation() {
  return section("Activation", [
    row("Active devices",       (s) => s.activation?.active_devices),
    row("Sessions",             (s) => s.activation?.sessions,            { fn: { android: "Play Console doesn't expose session count natively in v1" } }),
    row("Sessions / device",    (s) => s.activation?.sessions_per_device, { fn: { android: "see Sessions footnote" } }),
    // Crashes is a count on iOS, a rate on Android — by design (the two
    // dashboards expose different things). We don't force a pct conversion;
    // each cell renders whatever its store gave us. The mapping doc spells
    // this out so the reader isn't surprised by mismatched units.
    row("Crashes",              (s) => s.activation?.crashes),
  ]);
}

function retention() {
  const cohortRow = (key, label) => {
    const i = ios?.retention?.[key];
    const a = android?.retention?.[key];
    return `| ${label} | ${fmtPct(i)} | ${fmtPct(a)} |`;
  };
  return [
    "## Retention",
    "",
    "_Cohorts measured as of yesterday — % of installers still active N days later._",
    "",
    "| Cohort | iOS | Android |",
    "| --- | ---: | ---: |",
    cohortRow("d1",  "D1"),
    cohortRow("d7",  "D7"),
    cohortRow("d14", "D14 (Play: D15)"),
    cohortRow("d28", "D28 (Play: D30)"),
    "",
  ].join("\n");
}

function revenue() {
  const rows = [
    row("Proceeds (USD)",   (s) => s.revenue?.proceeds_usd),
    row("IAP transactions", (s) => s.revenue?.iap_count),
    row("Active subscriptions", (s) => s.revenue?.active_subs),
    row("ARPU",             (s) => s.revenue?.arpu),
  ];
  // Yesterday line.
  const yIos = ios?.revenue?.proceeds_usd?.yesterday;
  const yAnd = android?.revenue?.proceeds_usd?.yesterday;
  const ylRow = `\n_**Yesterday revenue** — iOS: $${fmtNum(yIos)} · Android: $${fmtNum(yAnd)}_\n`;
  return section("Revenue", rows) + ylRow;
}

function referral() {
  const rows = [
    "## Referral",
    "",
    "_Where new installers came from this week. Stores' \"acquisition source\" reports — not UTM tracking; for full referral attribution you'd need analytics SDK integration._",
    "",
  ];
  const fmtSrc = (label, list) => {
    if (!list || !list.length) return `**${label}**: —`;
    return `**${label}:**\n` + list.slice(0, 5).map((s, i) => `${i + 1}. ${s.name} — ${fmtPct(s.share_7d)}`).join("\n");
  };
  rows.push(fmtSrc("iOS", ios?.referral?.by_source));
  rows.push("");
  rows.push(fmtSrc("Android", android?.referral?.by_source));
  rows.push("");
  return rows.join("\n");
}

function ratings() {
  const yI = ios?.ratings?.new_yesterday;
  const yA = android?.ratings?.new_yesterday;
  const lines = [
    "## Ratings & Reviews",
    "",
    `| | iOS | Android |`,
    `| --- | ---: | ---: |`,
    `| Average | ${ios?.ratings?.avg != null ? ios.ratings.avg.toFixed(2) + " ★" : "—"} | ${android?.ratings?.avg != null ? android.ratings.avg.toFixed(2) + " ★" : "—"} |`,
    `| Total count | ${fmtNum(ios?.ratings?.count)} | ${fmtNum(android?.ratings?.count)} |`,
    `| New yesterday | ${fmtNum(yI)} | ${fmtNum(yA)} |`,
    "",
  ];
  const recents = [];
  if (ios?.ratings?.recent_reviews?.length) {
    recents.push("**Latest iOS reviews:**");
    for (const r of ios.ratings.recent_reviews.slice(0, 3)) {
      recents.push(`- ${r.rating ?? "?"}★ _${r.date || ""}_ — **${r.title || "(no title)"}** — ${r.body}`);
    }
  }
  if (android?.ratings?.recent_reviews?.length) {
    if (recents.length) recents.push("");
    recents.push("**Latest Android reviews:**");
    for (const r of android.ratings.recent_reviews.slice(0, 3)) {
      recents.push(`- ${r.rating ?? "?"}★ _${r.date || ""}_ — **${r.title || "(no title)"}** — ${r.body}`);
    }
  }
  return [...lines, ...recents, ""].join("\n");
}

// --- top callout -------------------------------------------------------------
// Prefer DoD (yesterday vs day_before). If no DoD movers (e.g. scraper didn't
// fill day_before yet), fall back to WoW and relabel the heading.
function topCallout() {
  const useDoD = dodMovers.length > 0;
  const pool = useDoD ? dodMovers : wowMovers;
  const heading = useDoD
    ? "## What changed since yesterday"
    : "## What changed week-over-week\n\n_No day-over-day data available — showing rolling-7d vs prior-7d instead._";
  if (!pool.length) {
    return "## What changed since yesterday\n\n_No meaningful movement above the 2% threshold._\n";
  }
  const top = [...pool].sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3);
  const lines = top.map((m) => {
    const arrow = m.d > 0 ? "▲" : "▼";
    const sign  = m.d > 0 ? "+" : "";
    return `- ${arrow} **${m.label}** ${sign}${(m.d * 100).toFixed(0)}% — ${fmtNum(m.prev)} → ${fmtNum(m.curr)}`;
  });
  return heading + "\n\n" + lines.join("\n") + "\n";
}

// --- store-status banner -----------------------------------------------------
function storeBanner() {
  const lines = [];
  if (ios?.error === "app_not_found_in_store") lines.push(`⚠ **iOS** — app "${appName}" not found in this App Store Connect account. iOS columns will read \`—\`.`);
  if (android?.error === "app_not_found_in_store") lines.push(`⚠ **Android** — app "${appName}" not found in this Play Console account. Android columns will read \`—\`.`);
  if (!ios && !android?.error) lines.push(`ℹ iOS data not collected this run.`);
  if (!android && !ios?.error) lines.push(`ℹ Android data not collected this run.`);
  return lines.length ? lines.join("\n") + "\n\n" : "";
}

function asscPublicCallout() {
  if (!ios?.asc_public) return "";
  const p = ios.asc_public;
  const bits = [];
  if (p.rating?.avg != null) bits.push(`Public rating: **${p.rating.avg.toFixed(2)}★** (${fmtNum(p.rating.count)} reviews)`);
  if (p.rank?.position) bits.push(`Category rank: **#${p.rank.position} in ${p.rank.category}**`);
  if (p.editorial?.today_featured) bits.push(`✨ Featured on the App Store today`);
  return bits.length ? `_iOS public page:_ ${bits.join(" · ")}\n\n` : "";
}

// --- assemble ----------------------------------------------------------------
const errorsBlock = (() => {
  const all = [...(ios?.errors || []).map((e) => `iOS: ${e}`), ...(android?.errors || []).map((e) => `Android: ${e}`)];
  if (!all.length) return "";
  return "\n---\n\n## Collection issues\n\n" + all.map((e) => `- ${e}`).join("\n") + "\n";
})();

const footnotesBlock = footnotes.length
  ? "\n" + footnotes.map((f) => `[^${f.id}]: ${f.text}`).join("\n") + "\n"
  : "";

// Render the body FIRST — it populates the dodMovers / wowMovers arrays via
// pushMover() calls inside each row(). The callout reads those arrays, so the
// header has to be assembled after the body has run.
const body = [
  awareness(),
  acquisition(),
  activation(),
  retention(),
  revenue(),
  referral(),
  ratings(),
].join("\n");

const header = [
  `# AAARRR — ${appName}`,
  "",
  `_Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} · Window: ${windowMode}_`,
  "",
  storeBanner() + asscPublicCallout() + topCallout(),
].join("\n");

const markdown = header + "\n" + body + errorsBlock + footnotesBlock;

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, markdown, "utf8");

// Summary sidecar so the SKILL can quote the top mover in chat.
const summarySource = dodMovers.length ? dodMovers : wowMovers;
const summary = {
  app: appName,
  generated_at: new Date().toISOString(),
  window: windowMode,
  stores: Object.keys(stores),
  mover_type: dodMovers.length ? "dod" : "wow",
  top_movers: [...summarySource].sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3),
};
fs.writeFileSync(outPath.replace(/\.md$/, "") + ".summary.json", JSON.stringify(summary, null, 2), "utf8");

console.log(outPath);
