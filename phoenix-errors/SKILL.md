---
name: phoenix-errors
description: >
  Connect Arize Phoenix (the open-source LLM-observability / tracing platform) to
  Claude as an MCP server, then produce a multi-sheet error report from your trace
  data. Walks you through wiring Phoenix into Claude Desktop or Claude Code/Cowork
  (and standing up a Phoenix instance first — Cloud, local pip/docker, or
  self-hosted — only if you don't already have one), then pulling ERROR spans and
  rendering a color-coded Excel workbook + self-contained HTML summary with
  root-cause and prioritized recommendations. Lets you pick one or more projects
  via a multi-select checkbox. Invoked as /phoenix-errors. Use whenever the user
  wants to connect Phoenix or Arize to Claude as an MCP, mentions "phoenix error
  report", "arize error report", "LLM trace errors", "observability error report",
  or wants to analyze errors/failures across their Phoenix projects — even if they
  don't say the exact phrase.
version: 0.1.0
---

# `/phoenix-errors` — connect Phoenix to Claude + error report

[Arize Phoenix](https://phoenix.arize.com) is an open-source LLM-observability / tracing platform — it captures the spans (calls, agents, tools, errors) your AI app emits so you can debug and evaluate them.

## What this skill does

Two jobs, in order. Most of the time only Phase B runs (the connection is a one-time thing).

- **Phase A — Connect Phoenix to Claude (first run only):** Wire a Phoenix instance into Claude as an MCP server. This skill does *not* run your app's tracing — it connects to a Phoenix that's already (or about to be) collecting traces. If you don't have a Phoenix instance yet, it helps you stand one up first (Cloud, local, or self-hosted), then connects it to Claude Desktop or Claude Code/Cowork.
- **Phase B — Error report:** List the user's Phoenix projects, let them check off one or more, pull the ERROR spans (plus a small healthy sample) in a time window, categorize them, and render an Excel workbook (`scripts/build_report.py`) plus a self-contained HTML summary — including a **Diagnostics** view (latency, token usage, error-rate, concentration, redelivery-loop detection, errors-over-time).

The split matters because connecting is friction the user pays once, while the report is the thing they'll re-run. Always start by checking whether Phoenix is *already* connected — if it is, skip straight to Phase B so returning users aren't dragged back through the connection steps.

## Invocation

| Form | What to do |
|---|---|
| `/phoenix-errors` | Full flow: detect connection → (setup if needed) → project picker → report. |
| `/phoenix-errors setup` | Force Phase A even if a connection exists (e.g. switching instances). |
| `/phoenix-errors <project>` | Skip the picker; report on the named project(s) directly. |
| `--window 7d` | Time window for the report (`24h`, `7d`, `30d`, or `YYYY-MM-DD..YYYY-MM-DD`). Default `7d`. |
| `--xlsx-only` / `--html-only` | Render just one format. Default is both. |

If invoked with no args, run the full flow.

---

## Phase A — Connect Phoenix to Claude (first run only)

### A1 — Detect whether Phoenix is already connected

Before anything else, check if the Phoenix MCP tools are live. Try a cheap call:

- If `mcp__phoenix__list-projects` (or any `mcp__phoenix__*` tool) is available and returns without error → **already connected. Skip to Phase B.**
- If the tools aren't present, or the call errors with auth/connection failure → proceed with setup below.

Tell the user what you found ("Phoenix is already connected, jumping to the report" vs "Looks like Phoenix isn't set up yet — let's get it connected, takes a couple minutes").

### A2 — Ask for the URL first, then detect the flavor

Don't make the user classify their own setup. **Ask one open question first: "Do you already have a Phoenix instance running? If so, paste its URL."**

- **They give a URL →** infer the flavor yourself (don't ask). Match the baseUrl:
  - contains `app.phoenix.arize.com` → **Phoenix Cloud**
  - host is `localhost`, `127.0.0.1`, or `0.0.0.0` → **Local**
  - anything else → **Self-hosted**

  State what you detected ("That's a self-hosted instance on Cloud Run — got it") so the user can correct you if you're wrong. This is the common case for returning users and anyone who already stood Phoenix up.

- **They don't have one yet →** *only now* do you help them stand one up. Recommend Phoenix Cloud as the easiest first path (or local if they want zero-account dev), then follow `references/setup.md`. After it's up, you'll have the URL and can proceed as above.

Then ask the one thing you genuinely can't infer: **which client** — Claude Desktop or Claude Code / Cowork. (If this very session is Claude Code/Cowork, you may default to that and just confirm.)

### A3 — Collect the API key

You now have the **baseUrl**. Get the **apiKey** based on the detected flavor (see `references/setup.md`):
- Phoenix Cloud / auth-enabled self-hosted → from the Phoenix UI, **Settings → API Keys**.
- Default local instance → usually **none**; omit the key entirely.

**Never hardcode the API key into any skill file or anything tracked by git.** It only belongs in the client config (Desktop's `claude_desktop_config.json` or the `claude mcp add` command), which live outside this repo. If you write a config file, confirm its path is outside the skill directory.

### A4 — Wire it into the chosen client

Apply the connection per `references/setup.md`:
- **Claude Desktop:** merge a `phoenix` entry into the `mcpServers` block of `claude_desktop_config.json`, then tell the user to fully quit and reopen Claude Desktop.
- **Claude Code / Cowork:** run the `claude mcp add` command for them (or print it to run).

### A5 — Verify

After the client reconnects, confirm by calling `mcp__phoenix__list-projects`. If it returns projects, setup succeeded — continue to Phase B. If not, re-check the baseUrl/apiKey against `references/setup.md` troubleshooting.

---

## Phase B — Error report

### B1 — List projects

Call `mcp__phoenix__list-projects`. You get an array of `{id, name, description}`. Keep the names — they're what the user picks from and what you pass back as `project_identifier`.

### B2 — Let the user pick projects (multi-select)

Present the projects as a **multi-select checkbox** so the user can choose more than one. Use `AskUserQuestion` with `multiSelect: true`, one option per project name (include the description as the option description when present). If `list-projects` returns more than 4 projects (the picker shows at most 4 options), list the full set in the question text and offer the most recently active ones as the checkboxes, or ask the user to name the ones they want.

If the user already named project(s) in the invocation, skip this step.

### B3 — Resolve the time window

Default to the last **7 days**. Get today's real date from the system clock (`date -u +%Y-%m-%dT%H:%M:%SZ` via Bash) — don't trust session context for "now". Compute `start_time`/`end_time` as ISO-8601 UTC from the `--window` value.

### B4 — Pull ERROR spans per project

For each selected project, read **`references/data-pull.md`** and call `mcp__phoenix__get-spans` with:
- `project_identifier`: the project name
- `status_codes: ["ERROR"]`
- `start_time`, `end_time`: the window
- `limit: 1000`

Normalize each span to the flat record shape defined in `references/data-pull.md` (project, span/trace id, times, name, kind, status, user, session, model, exception type + message). Write all rows to a single `spans.json` in the working directory.

**Watch for high volume.** A page of 1000 error spans is often ~8 MB and overflows the tool — the call then saves the full JSON to a file and returns its path instead of inline data. Don't `Read` that file into context; `jq`-extract the compact fields straight from disk and **profile before paginating further**. If a project is in a uniform error *storm* (one exception type/user, thousands of spans in minutes), sample the most-recent 1–2 pages and probe the older window rather than pulling everything — and label the cap. The full recipe (jq extractors, profile query, storm-vs-varied decision, merge) is in **`references/data-pull.md` → "Handling high-volume / overflow projects."**

If a project has **zero** error spans, keep it — it still shows in the Summary's "By Project" table with a 0 count, which is useful signal ("this project is clean").

**Also pull a small OK-span sample** for the diagnostics. For each selected project, make one more `get-spans` call with `status_codes: ["OK"]` and a small `limit` (100–200, recent), extract with the **same jq**, and write to `ok_spans.json`. This is what powers *healthy* latency (vs. error time-to-fail) and token trends — failed LLM calls carry no token counts, healthy ones do. Keep it a sample, not an exhaustive pull. Skip only if the user asked to stay errors-only.

### B5 — Categorize and analyze

You (Claude) do the smart part here — the render script is deliberately dumb. Group the errors into **error families** by exception type + message pattern (e.g. rate-limit/429, schema/structured-output failure, empty-input ValueError, timeout, auth). For each family write a one-line **root cause** and a **recommended action**, and assign a severity (`P0` highest → `P2`). Then write 2–5 prioritized **recommendations**. Save this as `analysis.json` per the schema in `references/data-pull.md`.

Don't invent error families that aren't in the data, and don't copy the example values from the reference docs — derive families from the actual spans you pulled. If the same exception class spans multiple projects, note that in the recommendation.

### B6 — Render the report

Run the bundled renderer (it reads `spans.json` + `analysis.json` and computes all counts/aggregations itself):

```bash
python3 scripts/build_report.py \
  --spans spans.json \
  --ok-spans ok_spans.json \
  --analysis analysis.json \
  --out reports/<slug>_errors_<YYYY-MM-DD> \
  --format both
```

`<slug>` = a short label for the run (e.g. joined project names or "phoenix"). `--format` is `both` | `xlsx` | `html` (honor `--xlsx-only`/`--html-only`). The script writes `<out>.xlsx` and/or `<out>.html`. Drop `--ok-spans` if the user chose errors-only (diagnostics then omit healthy latency / token trends, and error-rate shows errors-only).

**Dependency:** the `.xlsx` path needs `openpyxl`; the HTML path needs nothing. If the script prints "openpyxl not installed" it still writes the HTML — install with `pip install openpyxl` and rerun for the workbook. On a PEP 668 "externally-managed" Python (common on macOS), use `pip install --user openpyxl` or a venv.

The workbook has six sheets — **Summary** (totals, By Project, By Error Family with root cause + action, severity-colored), **Diagnostics** (error-rate, latency avg/p50/p95 by project × span-kind for fail vs healthy, token usage by model, user/session concentration, redelivery-loop detector, errors-over-time), **All Errors** (every span, frozen header + autofilter), **By Trace**, **By User**, **Recommendations** (P0/P1/P2). The HTML mirrors Summary + Recommendations + Diagnostics as a single self-contained file with a click-to-copy button.

### B7 — Hand off

Tell the user where both files landed and give a 2–3 sentence verbal summary of the headline finding (e.g. "23 of 41 errors are Cerebras 429 rate-limits concentrated in one user — P0"). Link the files as clickable paths.

---

## Notes on generalization

This skill was seeded from a real error report, but it must work for **any** Phoenix project. The render script bundles only structural logic (counts, aggregation, styling) — all domain knowledge (which errors matter, what to do about them) comes from your live analysis of the spans you pulled. Keep it that way: if you find yourself hardcoding a project name, model, or error string into the script, stop and pass it through the JSON inputs instead.

## Reference files

- **`references/setup.md`** — first-time Phoenix setup for all three flavors + MCP connection for Desktop and Code. Read before Phase A.
- **`references/data-pull.md`** — exact `get-spans` usage, attribute→field mapping (OpenInference conventions), and the `spans.json` / `analysis.json` schemas. Read before B4.
- **`samples/`** — fully synthetic data (`sample_spans.json`, `sample_ok_spans.json`, `sample_analysis.json`) plus a rendered example (`sample_report.html` / `.xlsx`) for a fictional "Ferndale Field Guide" app. Render them to sanity-check the script without a live connection, or open `sample_report.html` to see the expected output.
