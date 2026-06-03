# Pulling ERROR spans and shaping the report inputs

This covers Phase B steps B4–B5: how to call `get-spans`, how to map raw span attributes onto the flat record the renderer expects, and the exact `spans.json` / `analysis.json` schemas.

## 1. Calling `get-spans`

Per selected project:

```
mcp__phoenix__get-spans(
  project_identifier = "<project name>",
  status_codes       = ["ERROR"],
  start_time         = "<ISO-8601 UTC>",
  end_time           = "<ISO-8601 UTC>",
  limit              = 1000
)
```

The response is `{ spans: [...], nextCursor? }`. If `nextCursor` is present, call again with `cursor = nextCursor` and keep appending until it's gone. (A quiet project usually fits in one page; don't assume — follow the cursor.)

### Handling high-volume / overflow projects

Each error span carries a full stacktrace and the request payload, so a page of 1000 spans is often **~8 MB** — well past the tool's inline limit. When that happens the MCP call **doesn't fail**: it saves the full JSON to a file and returns the path (e.g. `…/tool-results/mcp-phoenix-get-spans-<n>.txt`). The file is valid JSON (`{ "spans": [...], "nextCursor": ... }`). **Never `Read` the whole thing into context** — extract the compact fields with `jq` straight from disk:

```bash
jq --arg proj "<project name>" '[.spans[] | {
  project: $proj,
  span_id: .context.span_id,
  trace_id: .context.trace_id,
  start_time: .start_time, end_time: .end_time, name: .name, span_kind: .span_kind,
  status: .status_code,
  user_id: (.attributes["user.id"] // ""),
  session_id: (.attributes["session.id"] // ""),
  model: (.attributes["llm.model_name"] // ""),
  exception_type: ((.events[]? | select(.name=="exception") | .attributes["exception.type"]) // ""),
  exception_message: (((.events[]? | select(.name=="exception") | .attributes["exception.message"]) // .status_message) // "" | .[0:300]),
  prompt_tokens: (.attributes["llm.token_count.prompt"] // null),
  completion_tokens: (.attributes["llm.token_count.completion"] // null),
  total_tokens: (.attributes["llm.token_count.total"] // null),
  mid: ((try (.attributes["input.value"]|fromjson) catch {}) | (.context.instagram.mid // .state_delta.context.instagram.mid // ""))
}]' "<saved-file>" > page_N.json
```

Before committing to pulling everything, **profile the page** to see if it's worth it — one cheap `jq` tells you whether the project is in a uniform storm or has varied errors:

```bash
jq -r '{count:(.spans|length), nextCursor,
        range:([.spans[].start_time]|(min+" -> "+max)),
        types:([.spans[]|(.events[]?|select(.name=="exception")|.attributes["exception.type"])]
               |group_by(.)|map({(.[0]):length})|add),
        users:([.spans[].attributes["user.id"]]|unique|length),
        traces:([.spans[].context.trace_id]|unique|length)}' "<saved-file>"
```

If a page returns `count: 1000` with a `nextCursor`, the window holds **more than 1000** error spans. Decide based on the profile:

- **Uniform storm** (one exception type, one user/session, tight time range, e.g. ~1000 spans per few minutes): do **not** paginate to exhaustion — you'd pull tens of thousands of identical rows for no added insight. Sample the most-recent **1–2 pages**, then probe the *older* part of the window with a small `limit` (e.g. 100) to confirm whether the rest of the window looks the same or has other error families. (A single user looping the same message via webhook re-delivery is a common cause of these storms.)
- **Varied errors** (multiple types/users): paginate further (still jq-extracting each page) until you have a representative spread or you hit a sane page cap.

**Never truncate silently.** Whatever you cap, say so in `analysis.json`: put the true situation in the `window` string ("sampled the 2,000 most-recent spans; true 7d count est. 20k+") and in the project's `note` ("ACTIVE STORM — sampled"). The report must never read as "complete" when it isn't.

Merge your per-page files into one `spans.json` and tag the family in the same pass:

```bash
jq -s 'add | map(. + {error_family: (
  if (.exception_type|test("ContextWindowExceeded")) then "Context window exceeded"
  elif (.exception_type|test("RateLimit")) then "Rate limit (429)"
  else .exception_type end)})' page0.json page1.json … > spans.json
```
(Adjust the family rules to whatever exception types you actually see — see B5.)

Each span looks roughly like:
```json
{
  "id": "U3Bhbjoy...",
  "name": "generate_content cerebras/gpt-oss-120b",
  "context": { "trace_id": "361c31...", "span_id": "U3Bhbjoy..." },
  "start_time": "2026-06-02T03:04:14.167708+00:00",
  "end_time":   "2026-06-02T03:04:14.321965+00:00",
  "status_code": "ERROR",
  "attributes": { ... }     // OpenInference semantic conventions
}
```

## 2. Attribute → field mapping (OpenInference)

The interesting fields live in `attributes`. Names follow OpenInference conventions; be tolerant of dotted vs nested forms and missing keys (use `""` when absent).

| Report field | Source (try in order) |
|---|---|
| `project` | the project name you queried |
| `span_id` | `context.span_id` or `id` |
| `trace_id` | `context.trace_id` |
| `start_time` / `end_time` | top-level `start_time` / `end_time` |
| `name` | `name` |
| `span_kind` | `attributes["openinference.span.kind"]` (e.g. LLM, AGENT, CHAIN, TOOL) |
| `status` | `status_code` (always `ERROR` here) |
| `user_id` | `attributes["user.id"]` |
| `session_id` | `attributes["session.id"]` |
| `model` | `attributes["llm.model_name"]` |
| `exception_type` | `attributes["exception.type"]` (often on a nested `exception` event — also check `events[].attributes["exception.type"]`) |
| `exception_message` | `attributes["exception.message"]` (likewise check span `events`) |
| `prompt_tokens` | `attributes["llm.token_count.prompt"]` (LLM spans; absent on failed pre-completion calls) |
| `completion_tokens` | `attributes["llm.token_count.completion"]` |
| `total_tokens` | `attributes["llm.token_count.total"]` |
| `mid` | message/redelivery id — parse `attributes["input.value"]` JSON → `.context.instagram.mid` or `.state_delta.context.instagram.mid` (usually only on the root CHAIN span). Used for the redelivery-loop detector. |

The last four are **diagnostic fields** (see §5). They're optional — the renderer computes latency from `start_time`/`end_time` regardless, and degrades gracefully when tokens/mid are missing.

If exception info isn't in attributes, look at the span's `events` array for an `exception` event carrying `exception.type` / `exception.message`. Truncate very long messages to ~500 chars for the report (keep the first line — it's the useful part).

## 3. `spans.json` schema

A flat array — one object per error span. This is the renderer's primary input.

```json
[
  {
    "project": "my-agent",
    "span_id": "span_0001",
    "trace_id": "trace_0001",
    "start_time": "2026-06-02T20:55:16.960816+00:00",
    "end_time": "2026-06-02T20:55:17.512412+00:00",
    "name": "invocation [coordinator_agent]",
    "span_kind": "CHAIN",
    "status": "ERROR",
    "user_id": "user_a1b2c3d4",
    "session_id": "sess_0001",
    "model": "",
    "exception_type": "ValueError",
    "exception_message": "No message content.",
    "error_family": "Empty input (ValueError)",
    "prompt_tokens": null,
    "completion_tokens": null,
    "total_tokens": null,
    "mid": "msg_0001"
  }
]
```

- `error_family` is **your** label (set in B5), not from Phoenix. Use a short, human-readable family name. Keep it identical across spans of the same family so counts aggregate correctly.
- `prompt_tokens` / `completion_tokens` / `total_tokens` / `mid` are diagnostic fields (§5). Optional — use `null` / `""` when absent (failed LLM calls usually have no token counts; only root CHAIN spans carry `mid`).
- Include projects with zero errors **only** in `analysis.json` (see `projects` below), not here — there's no span row to add.

## 4b. Diagnostics inputs (optional but recommended)

The renderer produces a **Diagnostics** sheet/section: latency (avg/p50/p95 by project × span-kind), token usage by model, user/session concentration, a redelivery-loop detector, error-rate, and errors-over-time. It computes all of this itself — you just feed it data.

Two extra inputs unlock the full set:

1. **An OK-span sample** → `--ok-spans ok_spans.json`. Pull a *capped, recent* sample of healthy spans per project (e.g. `status_codes: ["OK"]`, `limit: 100–200`), extracted with the **same jq** as error spans. This enables *healthy* latency (vs. error time-to-fail), token trends (healthy LLM spans carry the token counts; failed ones don't), and a sampled error-rate. Keep it small — it's a sample, not an exhaustive pull.
2. **True totals for error-rate %** → add a `totals` block to `analysis.json` when you have real per-project counts:
   ```json
   "totals": { "my-agent": { "errors": 24000, "ok": 1200 } }
   ```
   With `totals`, error-rate is exact. Without it, the renderer falls back to a **sampled** rate from `spans + ok_spans` (labeled "SAMPLED" in the output) — fine for a quick read, but don't present it as exact, especially for storm projects where both pulls are capped.

Everything degrades gracefully: no `--ok-spans` → latency shows error time-to-fail only, no token table; no `mid` → loop detector shows "none detected"; no `totals` → sampled or errors-only rate.

## 4. `analysis.json` schema

The narrative layer you produce in B5. Everything here is your judgment from reading the actual spans — derive it, don't template it.

```json
{
  "report_title": "Phoenix Error Report",
  "source": "app.phoenix.arize.com",
  "date": "2026-06-03",
  "window": "2026-05-27 .. 2026-06-03 (7d, UTC)",
  "projects": [
    { "name": "my-agent", "queried": true },
    { "name": "my-agent-qa", "queried": true, "note": "no errors" }
  ],
  "families": [
    {
      "family": "Empty input (ValueError)",
      "severity": "P0",
      "root_cause": "Client sends navigation events with an empty parts array (role='model').",
      "action": "Validate parts on the client before send; coordinator should skip empty messages."
    }
  ],
  "recommendations": [
    {
      "priority": "P0",
      "issue": "Empty new_message.parts ValueError, concentrated in one user",
      "action": "Add client-side validation to drop empty-parts navigation events; reproduce from that user's session."
    }
  ],
  "user_notes": {
    "user_a1b2c3d4": "All errors are empty-parts ValueError"
  }
}
```

Field notes:
- `severity` is one of `P0` (red), `P1` (orange), `P2` (yellow) — the renderer colors rows by it. The same scale applies to `recommendations[].priority`.
- `family` strings here **must match** the `error_family` values in `spans.json` so the renderer can join counts to root-cause/action.
- `projects` lists every project the user selected (so clean ones still appear in the Summary "By Project" table). `queried: true` marks ones you actually pulled; add `"note"` for context.
- `user_notes` is optional flavor for the By-User sheet; omit if you have nothing useful to say.
- All narrative fields are optional — if you skip `analysis.json` entirely, the renderer falls back to built-in heuristic family names and leaves root-cause/action/recommendations blank. Prefer providing it; the analysis is the point of the report.
