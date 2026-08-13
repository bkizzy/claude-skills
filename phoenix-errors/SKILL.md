---
name: phoenix-errors
description: >
  Connect Arize Phoenix (the open-source LLM-observability / tracing platform) to
  Claude as an MCP server, then produce a multi-sheet error report from your trace
  data. Walks you through wiring one or more Phoenix instances into Claude Desktop,
  Cowork, or Claude Code — via Phoenix's built-in remote MCP endpoint (19+) or the
  legacy stdio package — and standing up a Phoenix instance first (Cloud, local
  pip/docker, or self-hosted) only if you don't already have one, then pulling ERROR spans and
  rendering a color-coded Excel workbook + self-contained HTML summary with
  root-cause and prioritized recommendations. Lets you pick one or more projects
  via a multi-select checkbox. Invoked as /phoenix-errors. Use whenever the user
  wants to connect Phoenix or Arize to Claude as an MCP, mentions "phoenix error
  report", "arize error report", "LLM trace errors", "observability error report",
  or wants to analyze errors/failures across their Phoenix projects — even if they
  don't say the exact phrase.
version: 0.2.0
---

# `/phoenix-errors` — connect Phoenix to Claude + error report

[Arize Phoenix](https://phoenix.arize.com) is an open-source LLM-observability / tracing platform — it captures the spans (calls, agents, tools, errors) your AI app emits so you can debug and evaluate them.

## What this skill does

Two jobs, in order. Most of the time only Phase B runs (the connection is a one-time thing).

- **Phase A — Connect Phoenix to Claude (first run only):** Wire one or more Phoenix instances into Claude as MCP servers. Phoenix 19+ serves its own MCP endpoint at `<baseUrl>/mcp` over OAuth, so this is usually a URL and a browser login — no API key, no local process. This skill does *not* run your app's tracing; it connects to a Phoenix that's already (or about to be) collecting traces. If you don't have an instance yet, it helps you stand one up first (Cloud, local, or self-hosted).
- **Phase B — Error report:** List the user's Phoenix projects, let them check off one or more, pull the ERROR spans (plus a small healthy sample) in a time window, categorize them, and render an Excel workbook (`scripts/build_report.py`) plus a self-contained HTML summary — including a **Diagnostics** view (latency, token usage, error-rate, concentration, redelivery-loop detection, errors-over-time).

The split matters because connecting is friction the user pays once, while the report is the thing they'll re-run. Always start by checking whether Phoenix is *already* connected — if it is, skip straight to Phase B so returning users aren't dragged back through the connection steps.

## Invocation

| Form | What to do |
|---|---|
| `/phoenix-errors` | Full flow: detect connection → (setup if needed) → project picker → report. |
| `/phoenix-errors setup` | Force Phase A even if a connection exists (e.g. adding a second instance). |
| `/phoenix-errors <project>` | Skip the picker; report on the named project(s) directly. Qualify as `<instance>/<project>` when more than one instance is connected. |
| `--instance <name>` | Restrict to one connected instance. Default: ask when several are present. |
| `--window 7d` | Time window for the report (`24h`, `7d`, `30d`, or `YYYY-MM-DD..YYYY-MM-DD`). Default `7d`. |
| `--xlsx-only` / `--html-only` | Render just one format. Default is both. |

If invoked with no args, run the full flow.

---

## Phase A — Connect Phoenix to Claude (first run only)

### A1 — Detect connected instances and their tool surface

**Never hardcode the server name `phoenix`.** Users name their servers freely, and users with more than one instance *must* (`lunafit_phoenix`, `mom_phoenix`, `phoenix-prod`…). Scan the available tools for any server whose name contains `phoenix` (case-insensitive), ignoring `phoenix-docs` — that's the documentation server, not a data server.

Record, for each match, the **server prefix** (e.g. `mcp__lunafit_phoenix__`). Everything in Phase B is called through that prefix; `<SRV>` below means "the prefix of the instance you're working with."

Then identify the **tool surface**, because Phoenix exposes two and they share no call signatures:

| Surface | Tell-tale tools | Where it comes from |
|---|---|---|
| **Code-mode** (default, Phoenix 19+) | `<SRV>execute`, `<SRV>search`, `<SRV>get_schema`, `<SRV>list_tools` | the built-in remote server at `/mcp` |
| **Legacy** | `<SRV>list-projects`, `<SRV>get-spans`, `<SRV>get-trace` | the `@arizeai/phoenix-mcp` stdio package, or a remote server with `PHOENIX_ENABLE_MCP_CODE_MODE=false` |

Branch on what's actually present — don't infer the surface from how the server was configured. A remote server with code mode disabled presents the legacy tools.

Outcomes:

- **No Phoenix server** → proceed to A2 (setup).
- **Exactly one** → note its prefix and surface, tell the user which instance you're using, skip to Phase B.
- **More than one** → list them and ask which to report on. Offer "all of them" as an option; a combined report across instances is supported and often the point (prod vs stage). Carry the chosen prefixes through Phase B.

If a server is present but calls fail with an auth error, treat it as **not connected** and say so specifically — "`lunafit_phoenix` is registered but not authenticated; run `/mcp` in an interactive `claude` session and log in" — rather than dropping into full setup. A registered-but-unauthenticated server is a login problem, not a configuration problem.

### A2 — Ask for the URL first, then detect the flavor

Don't make the user classify their own setup. **Ask one open question first: "Do you already have a Phoenix instance running? If so, paste its URL."**

- **They give a URL →** infer the flavor yourself (don't ask). Match the baseUrl:
  - contains `app.phoenix.arize.com` → **Phoenix Cloud**
  - host is `localhost`, `127.0.0.1`, or `0.0.0.0` → **Local**
  - anything else → **Self-hosted**

  State what you detected ("That's a self-hosted instance on Cloud Run — got it") so the user can correct you if you're wrong. This is the common case for returning users and anyone who already stood Phoenix up.

- **They don't have one yet →** *only now* do you help them stand one up. Recommend Phoenix Cloud as the easiest first path (or local if they want zero-account dev), then follow `references/setup.md`. After it's up, you'll have the URL and can proceed as above.

### A3 — Check the version — it decides the whole connection method

Phoenix **19.0.0+** serves a built-in remote MCP server at `<baseUrl>/mcp`, authenticated with OAuth. That is the path to use. The `@arizeai/phoenix-mcp` stdio package is in **maintenance mode** — legacy, and materially harder to install.

Check before choosing:

```bash
curl -s <baseUrl>/arize_phoenix_version
```

- **≥ 19.0.0 → remote MCP.** No API key, no local process, no JSON editing. Go to A4.
- **< 19.0.0 → legacy stdio**, or offer to upgrade Phoenix first (usually the better use of their time). If they stay on the old version, follow the **legacy** section of `references/setup.md`, which needs an API key from **Settings → API Keys**.

Confirm the endpoint really exists before telling the user it will work — some deployments set `PHOENIX_ENABLE_MCP_SERVER=false`:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST <baseUrl>/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{}'
```

`401` with a `WWW-Authenticate: Bearer realm="Arize Phoenix"` header means the endpoint is live and wants a login — that's success. Compare against a deliberately bogus path (`<baseUrl>/not-a-real-path`): if both respond identically, `/mcp` isn't mounted and you're looking at the SPA catch-all, not an MCP server.

### A4 — Pick a server name, then wire it into the client

**Ask what to name it, and default to something instance-specific** — `lunafit_phoenix`, not `phoenix`. Users add a second instance more often than you'd expect, and renaming later breaks anything that referenced the old prefix. Never reuse a name already in the client's config.

Then ask **which client** — Claude Desktop/Cowork and Claude Code read different config files and don't share MCP servers. If the user works in both, apply both.

- **Claude Desktop *or Cowork*:** Settings → Connectors → **Add custom connector**, name it, URL `<baseUrl>/mcp`. No API key field — a browser login opens on first use. Then have them fully quit and reopen.
- **Claude Code (the `claude` CLI):**

  ```bash
  claude mcp add --transport http <name> --scope user <baseUrl>/mcp
  ```

  Then `/mcp` inside an interactive `claude` session → select the server → complete the browser login.

**Cowork is Claude Desktop, not Claude Code.** `claude mcp add` for a Cowork user yields a server that `claude mcp list` calls connected while Cowork still shows Phoenix as unavailable — the CLI writes `~/.claude.json`, which Cowork never reads.

For legacy stdio setups only, see `references/setup.md` — including the warning that hand-editing `claude_desktop_config.json` while the app is running does not stick.

### A5 — Verify

Two things have to be true, and the first does not imply the second:

1. **Registered** — the server appears in the client (`claude mcp list`, or the Connectors list).
2. **Authenticated** — an actual tool call succeeds.

`claude mcp list` reporting **✔ Connected** only means the transport opened. For legacy stdio it means the process launched — it does **not** validate the API key, so a revoked key shows as connected and fails on every call. For remote servers an unauthenticated entry shows **! Needs authentication**; that's a login step, not a broken setup.

So verify with a real call: `<SRV>list_tools` (code-mode) or `<SRV>list-projects` (legacy). If it returns, setup succeeded — continue to Phase B. On a 401, send the user to `/mcp` to log in. On other failures, check `references/setup.md` troubleshooting.

Never report success from a config write alone. On Desktop/Cowork, **re-read the config after the restart** and confirm the entry survived — a write that reads back correctly can still be discarded by the app minutes later.

---

## Phase B — Error report

Everything below runs against the prefix(es) and surface you established in A1. `<SRV>` = the chosen server's prefix (e.g. `mcp__lunafit_phoenix__`). If the user picked **multiple instances**, run B1–B4 once per instance and merge before B5.

### B1 — List projects

- **Legacy:** `<SRV>list-projects`
- **Code-mode:** `<SRV>execute` with `call_tool("list_projects", {})`. If the tool name isn't obvious, call `<SRV>list_tools` (or `<SRV>search` with "projects") first — don't guess names, the surface is discoverable for exactly this reason.

You get an array of `{id, name, description}`. Keep the names — they're what the user picks from and what you pass back as `project_identifier`.

**With multiple instances, qualify every project by instance from here on.** Project names are not unique across deployments — prod and stage almost always share them. Carry `instance` alongside `project` in every record so the report can tell a `default` on prod from a `default` on stage, and label them that way in the picker too.

### B2 — Let the user pick projects (multi-select)

Present the projects as a **multi-select checkbox** so the user can choose more than one. Use `AskUserQuestion` with `multiSelect: true`, one option per project name (include the description as the option description when present). With multiple instances, prefix each label with the instance (`lunafit_phoenix / default`). If the list runs past 4 projects (the picker shows at most 4 options), list the full set in the question text and offer the most recently active ones as the checkboxes, or ask the user to name the ones they want.

If the user already named project(s) in the invocation, skip this step.

### B3 — Resolve the time window

Default to the last **7 days**. Get today's real date from the system clock (`date -u +%Y-%m-%dT%H:%M:%SZ` via Bash) — don't trust session context for "now". Compute `start_time`/`end_time` as ISO-8601 UTC from the `--window` value.

### B4 — Pull ERROR spans per project

For each selected project, read **`references/data-pull.md`** and fetch ERROR spans for the window with `limit: 1000`:

- **Legacy:** `<SRV>get-spans(project_identifier, status_codes=["ERROR"], start_time, end_time, limit)`
- **Code-mode:** one `<SRV>execute` call whose Python drives `call_tool` with the same arguments. Prefer doing the pagination loop *and* the field-flattening inside `execute` and returning only the flat records — that turns N round-trips into one and keeps multi-megabyte payloads out of context entirely. Mind the sandbox bounds (30s wall clock, 100 MB, ≤50 tool calls); if a project exceeds them, narrow the window and merge across calls rather than raising the limit.

Normalize each span to the flat record shape defined in `references/data-pull.md` (project, span/trace id, times, name, kind, status, user, session, model, exception type + message) — plus `instance` when more than one server is in play. Write all rows to a single `spans.json` in the working directory.

**Watch for high volume.** A page of 1000 error spans is often ~8 MB and overflows the tool — the call then saves the full JSON to a file and returns its path instead of inline data. Don't `Read` that file into context; `jq`-extract the compact fields straight from disk and **profile before paginating further**. If a project is in a uniform error *storm* (one exception type/user, thousands of spans in minutes), sample the most-recent 1–2 pages and probe the older window rather than pulling everything — and label the cap. The full recipe (jq extractors, profile query, storm-vs-varied decision, merge) is in **`references/data-pull.md` → "Handling high-volume / overflow projects."**

If a project has **zero** error spans, keep it — it still shows in the Summary's "By Project" table with a 0 count, which is useful signal ("this project is clean").

**Also pull a small OK-span sample** for the diagnostics. For each selected project, make one more spans call with `status_codes: ["OK"]` and a small `limit` (100–200, recent), extract with the **same jq**, and write to `ok_spans.json`. This is what powers *healthy* latency (vs. error time-to-fail) and token trends — failed LLM calls carry no token counts, healthy ones do. Keep it a sample, not an exhaustive pull. Skip only if the user asked to stay errors-only.

### B5 — Categorize and analyze

You (Claude) do the smart part here — the render script is deliberately dumb. Group the errors into **error families** by exception type + message pattern (e.g. rate-limit/429, schema/structured-output failure, empty-input ValueError, timeout, auth). For each family write a one-line **root cause** and a **recommended action**, and assign a severity (`P0` highest → `P2`). Then write 2–5 prioritized **recommendations**. Save this as `analysis.json` per the schema in `references/data-pull.md`.

Don't invent error families that aren't in the data, and don't copy the example values from the reference docs — derive families from the actual spans you pulled. If the same exception class spans multiple projects, note that in the recommendation.

**Across instances, the comparison is usually the finding.** A family present on stage but not prod, or at a very different rate, says more than either instance alone — call that out explicitly. Be careful not to read too much into raw counts: instances rarely carry equal traffic, so compare error *rates*, and say so when volumes are too lopsided to support a conclusion.

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

- **`references/setup.md`** — first-time Phoenix setup for all three flavors, remote-MCP vs legacy-stdio connection for Desktop/Cowork and Claude Code, and troubleshooting for the misleading-success cases. Read before Phase A.
- **`references/data-pull.md`** — span-fetch recipes for **both** tool surfaces (legacy `get-spans`, and code-mode via `execute`), attribute→field mapping (OpenInference conventions), and the `spans.json` / `analysis.json` schemas. Read before B4.
- **`samples/`** — fully synthetic data (`sample_spans.json`, `sample_ok_spans.json`, `sample_analysis.json`) plus a rendered example (`sample_report.html` / `.xlsx`) for a fictional "Ferndale Field Guide" app. Render them to sanity-check the script without a live connection, or open `sample_report.html` to see the expected output.
