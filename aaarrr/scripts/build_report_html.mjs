#!/usr/bin/env node
// HTML AAARRR report renderer. Standalone single-file output — no external
// CSS, no external JS dependencies. Tables are semantic <table> so they paste
// cleanly into Notion, Slack, Sheets, Linear, etc.
//
// Usage:
//   node build_report_html.mjs --slug <slug> [--window rolling_7d] --out <path.html>
//   node build_report_html.mjs --slug <slug> --date 20260529 --out <path.html>
//
// If --date is omitted, uses today's LOCAL date (not UTC — UTC would flip the
// day past 8pm EDT and miss a report cached earlier the same evening).
//
// Reads `<skill_dir>/reports/<slug>_*_<YYYYMMDD>.json`, merges, writes HTML +
// a sidecar `.summary.json` with top movers.

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
  console.error("usage: build_report_html.mjs --slug <slug> --out <path.html> [--window rolling_7d] [--date YYYYMMDD]");
  process.exit(2);
}

// Local date stamp (not UTC). UTC bites you when you run after 8pm EDT —
// "today" flips to tomorrow and the cached JSON named with today's date is
// suddenly stale to the script.
function localStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
const today = (args.date || localStamp()).replace(/-/g, "");

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
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtNum = (n) => {
  if (n == null || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1000) return Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
};
const fmtPct = (n) => (n == null || Number.isNaN(n)) ? "—" : (n * 100).toFixed(1) + "%";
const fmtMoney = (n) => (n == null || Number.isNaN(n)) ? "—" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

function deltaChip(curr, prev, { lowVolumeFloor = 3 } = {}) {
  if (curr == null || prev == null || prev === 0) return `<span class="chip dim">—</span>`;
  // Suppress noise: when both sides are tiny, percent deltas are misleading.
  // Below the floor we still render a chip but tag it `low-vol` (greyed out).
  const lowVol = Math.abs(curr) < lowVolumeFloor && Math.abs(prev) < lowVolumeFloor;
  const d = (curr - prev) / prev;
  if (!isFinite(d)) return `<span class="chip dim">—</span>`;
  let cls;
  if (Math.abs(d) < 0.02) cls = "flat";
  else if (d > 0) cls = "up";
  else cls = "down";
  if (lowVol) cls += " low-vol";
  const arrow = d > 0.02 ? "▲" : d < -0.02 ? "▼" : "·";
  const sign = d >= 0 ? "+" : "";
  return `<span class="chip ${cls}">${arrow} ${sign}${(d * 100).toFixed(0)}%</span>`;
}

// movers buckets
const dodMovers = [];
const wowMovers = [];
function pushMover(bucket, label, curr, prev, lowVolumeFloor = 5) {
  if (curr == null || prev == null || prev === 0) return;
  const d = (curr - prev) / prev;
  if (!isFinite(d) || Math.abs(d) < 0.05) return;
  // Skip low-volume noise (e.g. 0→2, 1→3) — these dominate the callout but
  // aren't real signal. Both sides must clear the floor.
  if (Math.abs(curr) < lowVolumeFloor && Math.abs(prev) < lowVolumeFloor) return;
  bucket.push({ label, curr, prev, d });
}

// Footnotes for unavailable rows.
const footnotes = [];
let footIdx = 0;
function fnMark(text) {
  footIdx++;
  footnotes.push({ id: footIdx, text });
  return `<sup><a href="#fn-${footIdx}" id="fnref-${footIdx}">${footIdx}</a></sup>`;
}

// --- per-row cell builder ----------------------------------------------------
function cells(storeBlob, pluck, side, opts = {}) {
  if (!storeBlob || storeBlob.error) {
    return [`<td class="num">—</td>`, `<td class="num">—</td>`, `<td class="num">—</td>`, `<td class="num">—</td>`];
  }
  const v = pluck(storeBlob);
  if (!v) return [`<td class="num">—</td>`, `<td class="num">—</td>`, `<td class="num">—</td>`, `<td class="num">—</td>`];
  const curr = v["7d"];
  const prior = v["prior_7d"];
  const yday = v["yesterday"];
  const dayBefore = v["day_before"] ?? null;
  const base28 = v["28d"];

  const f = opts.pct ? fmtPct : (opts.money ? fmtMoney : fmtNum);
  pushMover(dodMovers, `${opts.label} (${side})`, yday, dayBefore);
  pushMover(wowMovers, `${opts.label} (${side})`, curr, prior);

  // Fallback: when a store only has 28d aggregates (e.g. Play's grow-overview
  // doesn't surface per-day data in text), promote the 28d value into the
  // primary cell with a "(28d)" tag so it isn't lost in the rightmost column.
  let primaryHtml;
  if (curr == null && base28 != null) {
    primaryHtml = `<td class="num primary fallback">${f(base28)}<span class="agg-tag">28d</span></td>`;
  } else {
    primaryHtml = `<td class="num primary">${f(curr)}</td>`;
  }

  const baselineDisplay = base28 == null ? "—" : opts.pct ? f(Number(base28)) : f(Number(base28) / 28);

  return [
    primaryHtml,
    `<td class="num">${deltaChip(yday, dayBefore)}</td>`,
    `<td class="num">${deltaChip(curr, prior)}</td>`,
    `<td class="num muted">${baselineDisplay}</td>`,
  ];
}

function row(label, pluck, opts = {}) {
  const lhs = cells(ios, pluck, "iOS", { label, ...opts });
  const rhs = cells(android, pluck, "Android", { label, ...opts });
  let labelHtml = escapeHtml(label);
  // Footnote when a store is missing the metric AND not just missing the whole store.
  if (opts.iosNote && ios && !ios.error) {
    const v = pluck(ios);
    if (!v || (Object.values(v).every((x) => x == null))) labelHtml += fnMark(`iOS — ${opts.iosNote}`);
  }
  if (opts.androidNote && android && !android.error) {
    const v = pluck(android);
    if (!v || (Object.values(v).every((x) => x == null))) labelHtml += fnMark(`Android — ${opts.androidNote}`);
  }
  return `<tr><th class="lbl">${labelHtml}</th>${lhs.join("")}${rhs.join("")}</tr>`;
}

// --- sections ----------------------------------------------------------------
function shortDate(s) { // "2026-05-28" -> "May 28"
  if (!s) return "";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${months[+m[2]-1]} ${+m[3]}` : s;
}
function storeWindows(store) {
  if (!store?.windows) return null;
  const w = store.windows;
  return {
    yesterday: w.yesterday?.date,
    dayBefore: w.yesterday?.date ? (() => { const d = new Date(w.yesterday.date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate()-1); return d.toISOString().slice(0,10); })() : null,
    rolling7d: w.rolling_7d ? `${shortDate(w.rolling_7d.start)}–${shortDate(w.rolling_7d.end)}` : "",
    prior7d:   w.prior_7d   ? `${shortDate(w.prior_7d.start)}–${shortDate(w.prior_7d.end)}` : "",
    baseline28d: w.baseline_28d ? `${shortDate(w.baseline_28d.start)}–${shortDate(w.baseline_28d.end)}` : "",
    yest: w.yesterday?.date ? shortDate(w.yesterday.date) : "",
    lagNote: w.data_lag_note || null,
  };
}
const iosW = storeWindows(ios);
const andW = storeWindows(android);

function table(rows) {
  // Tooltip-style hint on each column header that names the actual dates.
  const iosT = iosW || {};
  const andT = andW || {};
  const tt = (s) => s ? ` title="${escapeHtml(s)}"` : "";
  return `
<div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th class="lbl"></th>
        <th colspan="4" class="store-head ios">iOS ${iosT.rolling7d ? `<span class="dates">· ${escapeHtml(iosT.rolling7d)}</span>` : ""}</th>
        <th colspan="4" class="store-head android">Android ${andT.rolling7d ? `<span class="dates">· ${escapeHtml(andT.rolling7d)}</span>` : ""}</th>
      </tr>
      <tr>
        <th class="lbl">Metric</th>
        <th${tt(iosT.rolling7d)}>7d</th><th${tt(iosT.yest && iosT.dayBefore ? `${shortDate(iosT.yest)} vs ${shortDate(iosT.dayBefore)}` : "")}>DoD</th><th${tt(iosT.rolling7d && iosT.prior7d ? `${iosT.rolling7d} vs ${iosT.prior7d}` : "")}>WoW</th><th${tt(iosT.baseline28d)}>28d avg</th>
        <th${tt(andT.rolling7d)}>7d</th><th${tt(andT.yest && andT.dayBefore ? `${shortDate(andT.yest)} vs ${shortDate(andT.dayBefore)}` : "")}>DoD</th><th${tt(andT.rolling7d && andT.prior7d ? `${andT.rolling7d} vs ${andT.prior7d}` : "")}>WoW</th><th${tt(andT.baseline28d)}>28d avg</th>
      </tr>
    </thead>
    <tbody>${rows.join("")}</tbody>
  </table>
</div>`;
}

function section(id, title, body) {
  return `<section id="${id}"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function awarenessSection() {
  return section("awareness", "Awareness", table([
    row("Impressions",     (s) => s.awareness?.impressions, { androidNote: "not directly exposed by Play Console (Acquisition reports → Store performance is closest)" }),
    row("Page views",      (s) => s.awareness?.page_views,  { androidNote: "Play exposes 'Store listing visitors' under Acquisition reports" }),
  ]));
}

function acquisitionSection() {
  const t = table([
    row("First-time installs", (s) => s.acquisition?.first_downloads, { androidNote: "Play Statistics → First-time installers — v1 scraper reads it via DOM text-parsing only" }),
    row("Re-downloads",        (s) => s.acquisition?.redownloads,     { androidNote: "Play exposes 'Re-installs' on Statistics with a dimension toggle" }),
    row("Conversion rate",     (s) => s.acquisition?.conversion_rate, { pct: true, androidNote: "Play Acquisition reports → Store listing conversion" }),
  ]);
  const srcBlock = (label, list) => {
    if (!list || !list.length) return `<p class="muted">${label}: —</p>`;
    return `<ul class="src-list"><li class="src-head">${label}</li>${list.slice(0, 6).map((s) => `<li><span>${escapeHtml(s.name)}</span><span class="num muted">${s.share_7d != null ? fmtPct(s.share_7d) : ""}</span></li>`).join("")}</ul>`;
  };
  const srcs = `
<div class="src-grid">
  ${srcBlock("iOS top sources (7d)", ios?.acquisition?.top_sources)}
  ${srcBlock("Android top sources (7d)", android?.acquisition?.top_sources)}
</div>`;
  return section("acquisition", "Acquisition", t + srcs);
}

function activationSection() {
  return section("activation", "Activation", table([
    row("Active devices",       (s) => s.activation?.active_devices),
    row("Sessions",             (s) => s.activation?.sessions,            { androidNote: "Play Console doesn't expose session count natively in v1 (Firebase Analytics is the path)" }),
    row("Sessions / device",    (s) => s.activation?.sessions_per_device, { androidNote: "see Sessions" }),
    // Apple stores count; Android stores rate. Render each side in its native unit.
    row("Crashes",              (s) => s.activation?.crashes,             { androidNote: "Play Vitals exposes crash rate (%) and ANR rate" }),
  ]));
}

function retentionSection() {
  const cell = (val) => val != null ? fmtPct(val) : "—";
  const rows = [
    ["D1",  ios?.retention?.d1,  android?.retention?.d1],
    ["D7",  ios?.retention?.d7,  android?.retention?.d7],
    ["D14 / D15", ios?.retention?.d14, android?.retention?.d14],
    ["D28 / D30", ios?.retention?.d28, android?.retention?.d28],
  ];
  const tbody = rows.map(([k, a, b]) => `<tr><th class="lbl">${k}</th><td class="num primary">${cell(a)}</td><td class="num primary">${cell(b)}</td></tr>`).join("");
  return section("retention", "Retention", `
<div class="table-wrap narrow">
  <table>
    <thead>
      <tr><th class="lbl">Cohort</th><th class="ios">iOS</th><th class="android">Android</th></tr>
    </thead>
    <tbody>${tbody}</tbody>
  </table>
</div>
<p class="muted small">Cohort = % of installers still active N days later, measured as-of yesterday.</p>`);
}

function revenueSection() {
  const t = table([
    row("Proceeds (USD)",       (s) => s.revenue?.proceeds_usd, { money: true }),
    row("IAP transactions",     (s) => s.revenue?.iap_count),
    row("Active subscriptions", (s) => s.revenue?.active_subs, { iosNote: "ASC subscriptions endpoint not mapped in v1 — see selectors.md" }),
    row("ARPU",                 (s) => s.revenue?.arpu, { money: true }),
  ]);
  const yI = ios?.revenue?.proceeds_usd?.yesterday;
  const yA = android?.revenue?.proceeds_usd?.yesterday;
  const yLine = `<p class="callout small"><strong>Yesterday revenue</strong> — iOS: ${yI != null ? fmtMoney(yI) : "—"} · Android: ${yA != null ? fmtMoney(yA) : "—"}</p>`;
  return section("revenue", "Revenue", t + yLine);
}

function referralSection() {
  const block = (heading, list) => {
    if (!list || !list.length) return `<div class="ref-side"><h3>${heading}</h3><p class="muted">—</p></div>`;
    return `<div class="ref-side"><h3>${heading}</h3><ol class="ref-list">${list.slice(0, 6).map((s) => `<li><span>${escapeHtml(s.name)}</span><span class="num muted">${s.share_7d != null ? fmtPct(s.share_7d) : ""}</span></li>`).join("")}</ol></div>`;
  };
  return section("referral", "Referral", `
<p class="muted small">Top acquisition sources per store. Not UTM-level — true campaign attribution needs an SDK.</p>
<div class="ref-grid">
  ${block("iOS", ios?.referral?.by_source)}
  ${block("Android", android?.referral?.by_source)}
</div>`);
}

function ratingsSection() {
  const cell = (v, suffix = "") => v == null ? "—" : (typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(2)) : v) + suffix;
  const headerRow = `
<div class="table-wrap narrow">
  <table>
    <thead><tr><th class="lbl"></th><th class="ios">iOS</th><th class="android">Android</th></tr></thead>
    <tbody>
      <tr><th class="lbl">Average</th><td class="num primary">${cell(ios?.ratings?.avg, " ★")}</td><td class="num primary">${cell(android?.ratings?.avg, " ★")}</td></tr>
      <tr><th class="lbl">Total count</th><td class="num">${fmtNum(ios?.ratings?.count)}</td><td class="num">${fmtNum(android?.ratings?.count)}</td></tr>
      <tr><th class="lbl">New yesterday</th><td class="num">${fmtNum(ios?.ratings?.new_yesterday)}</td><td class="num">${fmtNum(android?.ratings?.new_yesterday)}</td></tr>
    </tbody>
  </table>
</div>`;
  const recentList = (heading, reviews) => {
    if (!reviews || !reviews.length) return "";
    return `<div class="rev-side"><h3>${heading}</h3><ul class="reviews">${reviews.slice(0, 3).map((r) => `
      <li>
        <div class="rev-meta"><span class="rev-star">${r.rating ?? "?"}★</span> <span class="muted small">${escapeHtml(r.date || "")}</span> ${r.author ? `<span class="muted small">— ${escapeHtml(r.author)}</span>` : ""}</div>
        ${r.title ? `<div class="rev-title">${escapeHtml(r.title)}</div>` : ""}
        <div class="rev-body">${escapeHtml(r.body || "")}</div>
      </li>`).join("")}</ul></div>`;
  };
  return section("ratings", "Ratings & Reviews", headerRow + `
<div class="rev-grid">
  ${recentList("Latest iOS reviews", ios?.ratings?.recent_reviews)}
  ${recentList("Latest Android reviews", android?.ratings?.recent_reviews)}
</div>`);
}

// --- assemble body first so movers are populated ----------------------------
const bodySections = [
  awarenessSection(),
  acquisitionSection(),
  activationSection(),
  retentionSection(),
  revenueSection(),
  referralSection(),
  ratingsSection(),
].join("\n");

// --- top callout -------------------------------------------------------------
function topCalloutHtml() {
  const useDoD = dodMovers.length > 0;
  const pool = useDoD ? dodMovers : wowMovers;
  const heading = useDoD ? "What changed since yesterday" : "What changed week-over-week";
  if (!pool.length) {
    return `<div class="callout"><h3>${heading}</h3><p class="muted">No meaningful movement above the 5% threshold.</p></div>`;
  }
  const top = [...pool].sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3);
  const items = top.map((m) => {
    const arrow = m.d > 0 ? "▲" : "▼";
    const cls = m.d > 0 ? "up" : "down";
    const sign = m.d >= 0 ? "+" : "";
    return `<li><span class="chip ${cls}">${arrow} ${sign}${(m.d * 100).toFixed(0)}%</span> <strong>${escapeHtml(m.label)}</strong> <span class="muted">${fmtNum(m.prev)} → ${fmtNum(m.curr)}</span></li>`;
  });
  return `<div class="callout"><h3>${heading}</h3><ul class="movers">${items.join("")}</ul></div>`;
}

// --- store banners -----------------------------------------------------------
function storeBanners() {
  const out = [];
  if (ios?.error === "app_not_found_in_store") out.push(`<div class="banner warn">⚠ <strong>iOS:</strong> app "${escapeHtml(appName)}" not found in this App Store Connect account. iOS columns will read "—".</div>`);
  if (android?.error === "app_not_found_in_store") out.push(`<div class="banner warn">⚠ <strong>Android:</strong> app "${escapeHtml(appName)}" not found in this Play Console account. Android columns will read "—".</div>`);
  if (!ios) out.push(`<div class="banner info">ℹ iOS data not collected this run.</div>`);
  if (!android) out.push(`<div class="banner info">ℹ Android data not collected this run.</div>`);
  return out.join("");
}

function windowsBanner() {
  if (!iosW && !andW) return "";
  const rows = [];
  if (iosW) rows.push(`<div><span class="ios">iOS</span> · 7d <strong>${escapeHtml(iosW.rolling7d)}</strong> · prior <strong>${escapeHtml(iosW.prior7d)}</strong> · 28d <strong>${escapeHtml(iosW.baseline28d)}</strong> · DoD ${escapeHtml(iosW.yest)} vs ${escapeHtml(shortDate(iosW.dayBefore))}</div>`);
  if (andW) rows.push(`<div><span class="android">Android</span> · 7d <strong>${escapeHtml(andW.rolling7d)}</strong> · prior <strong>${escapeHtml(andW.prior7d)}</strong> · 28d <strong>${escapeHtml(andW.baseline28d)}</strong> · DoD ${escapeHtml(andW.yest)} vs ${escapeHtml(shortDate(andW.dayBefore))}</div>`);
  let lag = "";
  if (andW?.lagNote || (iosW && andW && iosW.yest !== andW.yest)) {
    lag = `<div class="lag-note small muted">Note: ${iosW && andW && iosW.yest !== andW.yest ? `Android trails iOS by a few days — Play finalizes daily data with a lag.` : "Android data ends earlier than iOS."}</div>`;
  }
  return `<div class="windows-banner">${rows.join("")}${lag}</div>`;
}

function publicAppleStrip() {
  if (!ios?.asc_public) return "";
  const p = ios.asc_public;
  const bits = [];
  if (p.rating?.avg != null) bits.push(`<span><strong>${p.rating.avg.toFixed(2)}★</strong> public (${fmtNum(p.rating.count)} reviews)</span>`);
  if (p.rank?.position) bits.push(`<span>#${p.rank.position} in ${escapeHtml(p.rank.category)}</span>`);
  if (p.editorial?.today_featured) bits.push(`<span>✨ Featured on App Store today</span>`);
  if (!bits.length) return "";
  return `<div class="public-strip">${bits.join(" · ")}</div>`;
}

// --- collection-issues block -------------------------------------------------
function issuesBlock() {
  const all = [...(ios?.errors || []).map((e) => `iOS: ${e}`), ...(android?.errors || []).map((e) => `Android: ${e}`)];
  if (!all.length) return "";
  return `<details class="issues"><summary>Collection issues (${all.length})</summary><ul>${all.map((e) => `<li class="small">${escapeHtml(e)}</li>`).join("")}</ul></details>`;
}

function footnotesBlock() {
  if (!footnotes.length) return "";
  return `<aside class="footnotes"><h3>Notes</h3><ol>${footnotes.map((f) => `<li id="fn-${f.id}">${escapeHtml(f.text)} <a href="#fnref-${f.id}">↩</a></li>`).join("")}</ol></aside>`;
}

// --- TOC ---------------------------------------------------------------------
const tocItems = [
  ["awareness", "Awareness"],
  ["acquisition", "Acquisition"],
  ["activation", "Activation"],
  ["retention", "Retention"],
  ["revenue", "Revenue"],
  ["referral", "Referral"],
  ["ratings", "Ratings & Reviews"],
];
const tocHtml = `<nav class="toc"><ul>${tocItems.map(([id, label]) => `<li><a href="#${id}">${label}</a></li>`).join("")}</ul></nav>`;

const generated = new Date().toISOString().slice(0, 16).replace("T", " ");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AAARRR — ${escapeHtml(appName)}</title>
<style>
  :root {
    --bg: #fafaf8;
    --fg: #1a1a1a;
    --muted: #6b6b6b;
    --line: #e2e2dc;
    --accent: #2d5cf5;
    --ios: #007aff;
    --android: #34a853;
    --up: #0a7d2e;
    --up-bg: #e6f4ea;
    --down: #b41818;
    --down-bg: #fce8e6;
    --flat: #6b6b6b;
    --flat-bg: #efefee;
    --callout-bg: #fef9e7;
    --warn-bg: #fde7d6;
    --warn-fg: #8a3e00;
    --info-bg: #e7f0fd;
    --info-fg: #0b3d91;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: var(--fg);
    background: var(--bg);
    margin: 0;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .container { max-width: 1240px; margin: 0 auto; padding: 32px 28px 80px; }
  header.head { margin-bottom: 24px; }
  h1 { font-size: 28px; margin: 0 0 6px; letter-spacing: -0.01em; }
  h2 { font-size: 19px; margin: 36px 0 12px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
  h3 { font-size: 14px; margin: 14px 0 8px; color: var(--fg); font-weight: 600; }
  .meta { color: var(--muted); font-size: 13px; margin: 0 0 12px; }
  .public-strip { font-size: 13px; color: var(--muted); margin: 0 0 16px; padding: 8px 12px; background: white; border: 1px solid var(--line); border-radius: 6px; }
  .public-strip strong { color: var(--fg); }
  .windows-banner { background: white; border: 1px solid var(--line); border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; font-size: 13px; line-height: 1.7; color: var(--fg); }
  .windows-banner strong { font-variant-numeric: tabular-nums; }
  .windows-banner .ios { color: var(--ios); font-weight: 600; display: inline-block; min-width: 60px; }
  .windows-banner .android { color: var(--android); font-weight: 600; display: inline-block; min-width: 60px; }
  .windows-banner .lag-note { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--line); }
  .banner { padding: 10px 14px; border-radius: 6px; margin-bottom: 10px; font-size: 13px; }
  .banner.warn { background: var(--warn-bg); color: var(--warn-fg); }
  .banner.info { background: var(--info-bg); color: var(--info-fg); }

  /* Callout */
  .callout { background: var(--callout-bg); border: 1px solid #f0e2a0; border-radius: 8px; padding: 14px 18px; margin: 18px 0 26px; }
  .callout h3 { margin-top: 0; margin-bottom: 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em; color: #8a6500; }
  .callout.small { padding: 8px 12px; font-size: 13px; margin: 12px 0; }
  .movers { list-style: none; padding: 0; margin: 0; }
  .movers li { padding: 4px 0; font-size: 14px; }

  /* TOC */
  .toc { background: white; border: 1px solid var(--line); border-radius: 6px; padding: 8px 14px; margin-bottom: 26px; font-size: 13px; }
  .toc ul { list-style: none; margin: 0; padding: 0; display: flex; gap: 18px; flex-wrap: wrap; }
  .toc a { color: var(--accent); text-decoration: none; }
  .toc a:hover { text-decoration: underline; }

  /* Tables */
  .table-wrap { overflow-x: auto; margin: 0 0 8px; }
  .table-wrap.narrow { max-width: 480px; }
  table { width: 100%; border-collapse: collapse; background: white; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; font-size: 13px; }
  th, td { padding: 7px 10px; text-align: left; vertical-align: middle; }
  thead th { background: #f3f3ee; font-weight: 600; color: var(--muted); border-bottom: 1px solid var(--line); text-align: right; }
  thead th.lbl, thead th.store-head { text-align: left; }
  thead th.store-head { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg); background: #ebebe5; }
  thead th.store-head.ios { color: var(--ios); }
  thead th.store-head.android { color: var(--android); }
  thead th.store-head .dates { font-size: 11px; font-weight: 500; color: var(--muted); letter-spacing: 0; text-transform: none; margin-left: 6px; }
  tbody tr:nth-child(odd) { background: #fbfbf8; }
  tbody tr:hover { background: #f3f3ee; }
  th.lbl { font-weight: 500; color: var(--fg); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.primary { color: var(--fg); font-weight: 600; }
  td.primary.fallback { font-weight: 600; color: #1a1a1a; }
  td.primary.fallback .agg-tag { font-size: 10px; font-weight: 500; background: #ebebe5; color: var(--muted); padding: 1px 5px; border-radius: 3px; margin-left: 5px; vertical-align: middle; letter-spacing: 0.02em; }
  td.muted, .muted { color: var(--muted); }
  .small { font-size: 12px; }
  .ios { color: var(--ios); }
  .android { color: var(--android); }
  th.ios, th.android { text-align: right; }

  /* Chips */
  .chip { display: inline-block; padding: 1px 7px; border-radius: 9999px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; line-height: 1.6; }
  .chip.up { background: var(--up-bg); color: var(--up); }
  .chip.down { background: var(--down-bg); color: var(--down); }
  .chip.flat { background: var(--flat-bg); color: var(--flat); }
  .chip.dim { background: transparent; color: var(--muted); }
  .chip.low-vol { opacity: 0.4; }

  /* Sources / referral / reviews */
  .src-grid, .ref-grid, .rev-grid { display: grid; gap: 16px; grid-template-columns: 1fr 1fr; margin: 12px 0 4px; }
  .src-list, .ref-list, .reviews { background: white; border: 1px solid var(--line); border-radius: 6px; padding: 8px 14px; margin: 0; list-style: none; }
  .ref-list { padding-left: 14px; list-style: decimal inside; }
  .src-list li, .ref-list li { display: flex; justify-content: space-between; padding: 3px 0; font-size: 13px; }
  .src-head { font-weight: 600; color: var(--muted); border-bottom: 1px solid var(--line); margin-bottom: 4px; padding-bottom: 4px !important; }
  .reviews li { padding: 8px 0; border-top: 1px solid var(--line); }
  .reviews li:first-child { border-top: 0; padding-top: 0; }
  .rev-star { font-weight: 700; color: #b78600; }
  .rev-title { font-weight: 600; margin: 2px 0; }
  .rev-body { font-size: 13px; color: var(--muted); }

  /* Issues */
  .issues { margin-top: 36px; background: white; border: 1px solid var(--line); border-radius: 6px; padding: 10px 14px; }
  .issues summary { cursor: pointer; font-weight: 600; color: var(--muted); font-size: 13px; }
  .issues ul { margin: 8px 0 4px; padding-left: 18px; }

  /* Footnotes */
  .footnotes { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }
  .footnotes ol { padding-left: 20px; }

  /* Print */
  @media print {
    body { background: white; }
    .container { max-width: none; padding: 0; }
    .toc, .issues { display: none; }
    table { font-size: 11px; }
    h2 { break-after: avoid-page; }
    .table-wrap { break-inside: avoid; }
    section { break-inside: avoid; }
    .chip.up { background: white; color: black; border: 1px solid var(--up); }
    .chip.down { background: white; color: black; border: 1px solid var(--down); }
  }
</style>
</head>
<body>
<div class="container">
<header class="head">
  <h1>AAARRR — ${escapeHtml(appName)}</h1>
  <p class="meta">Generated ${generated} · Window: ${escapeHtml(windowMode)} · iOS ${ios ? "✓" : "—"} · Android ${android ? "✓" : "—"}</p>
  ${storeBanners()}
  ${windowsBanner()}
  ${publicAppleStrip()}
  ${topCalloutHtml()}
  ${tocHtml}
</header>
${bodySections}
${issuesBlock()}
${footnotesBlock()}
</div>
</body>
</html>`;

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, html, "utf8");

const summarySource = dodMovers.length ? dodMovers : wowMovers;
const summary = {
  app: appName,
  generated_at: new Date().toISOString(),
  window: windowMode,
  stores: Object.keys(stores),
  mover_type: dodMovers.length ? "dod" : "wow",
  top_movers: [...summarySource].sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3),
};
fs.writeFileSync(outPath.replace(/\.html$/, "") + ".summary.json", JSON.stringify(summary, null, 2), "utf8");

console.log(outPath);
