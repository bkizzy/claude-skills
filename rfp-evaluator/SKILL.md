---
name: rfp-evaluator
description: >-
  Evaluate a Request for Proposal (RFP) to produce a bid / no-bid recommendation, a
  rubric-anchored 0-100 score, and a role-tailored report. Asks up front whether the user
  RECEIVED the RFP (deciding whether to respond) or ISSUED it (wanting to improve it), and
  which factors matter most to them, then weights the score accordingly. Reads the RFP
  directly — including charts, Gantt timelines, budget tables, and org diagrams — so visual
  content is actually comprehended, not lost to text extraction. Use this whenever the user
  shares an RFP, RFQ, tender, or solicitation document and wants it analyzed, scored,
  screened, or wants a bid/no-bid call — even if they just say "should we go for this?" or
  "what do you think of this proposal request?" Trigger on any RFP/RFQ/tender the user wants
  assessed for fit, risk, or response-worthiness.
---

# RFP Evaluator

Help one of two people: an organization **deciding whether to respond** to an RFP, or an organization **that issued an RFP and wants it to be stronger**. The output is one self-contained HTML report tailored to whichever they are.

The core value: **you read the actual document with your own eyes.** An RFP's most decision-relevant facts often live in *visual* elements — a Gantt chart that reveals an impossible timeline, a budget table buried in an appendix, an org chart that exposes a tangled approval chain, a scoring-weights table that tells you exactly how the winner is picked. Text extraction throws those away. You don't.

## Workflow

### 0. Ask role + priorities (one question, up front)

Before reading, call **AskUserQuestion** with these two questions in a single call (one round-trip):

1. **Your role** — two options:
   - *"I received this RFP — deciding whether to respond"* → the **Recipient / bid** report.
   - *"I issued this RFP — I want to improve it"* → the **Issuer / improve-my-RFP** report.
2. **What matters most to you?** — `multiSelect: true`, options: **Budget & fit**, **Scope & deliverables**, **Timeline**, **Legal / risk terms**. (The "Other" choice lets them name something else, e.g. "client goals" or "decision process", or say "no strong preference".)

Skip a question only if the user already answered it in their message (e.g. "I'm thinking of bidding on this" = Recipient). Don't ask anything else — keep it to this one interaction.

Then convert their priorities to weights using the **slot rule** in `references/scoring-rubric.md` §1, and state the weights you'll use in one line before continuing. If they express no preference, use the default weights.

### 1. Prepare the document fast — text by default, vision only for true figures

The expensive, slow part of this whole task is rendering pages to images and reading them with vision. So **don't.** A born-digital RFP whose schedules and tables already extract as text needs **zero** rendering — read the text. Reserve vision for pages that are genuinely image-only (floor plans, scans, diagrams) where text extraction gets nothing.

Run the bundled prep script — it extracts the full text layer and *triages* (it does not auto-render):

```
python3 scripts/prepare_rfp.py "<path-to-rfp>"
```

It returns JSON: `text_file` (full document text), `scanned`, `image_candidate_pages` (pages with a large graphic and little text, each with a short `preview`), `key_extracts` (the lines that matched budget/dates/legal/evaluation patterns), `engine` (which PDF engine ran), and `note`.

**No setup needed.** The scripts pick a PDF engine automatically: **poppler** if it's on PATH (fast), otherwise **pypdfium2** — a pip wheel they auto-install into `~/.virtualenvs/rfp-pdf` on first use (no Homebrew/admin). You don't install anything.

Then:

1. **Read the RFP, but don't over-read.** Reading text is cheap relative to vision, but a 40-page RFP that's half AIA-contract boilerplate is still a lot of tokens. Be efficient:
   - Read `text_file` for the **RFP body** — the part that describes the project, scope, schedule, and submission. That's what you actually score on, and it's usually the first chunk of the document.
   - For long **contract/appendix boilerplate** (AIA C401, terms & conditions, insurance appendices), don't read every line. Use `key_extracts` — it already pulls the budget/fee, dates/schedule, legal/risk, and evaluation/award lines out of the whole document. Skim those, and only `grep` the `text_file` for a specific clause if an extract raises a question (e.g. the exact indemnity wording). A standard AIA contract doesn't need a full read; its non-standard edits show up in `key_extracts`.
   - If `text_file` is short (a typical born-digital RFP), just read it through — you're done.
2. **Look at `image_candidate_pages` and judge from each `preview` whether vision is actually needed:**
   - If the preview shows the page's content is already in the text (a cover, a section divider, a "Thank you" slide, a photo with a caption) → **skip it. Render nothing.**
   - Only if a candidate is genuinely image-only — a floor plan, an org chart, a scanned exhibit, a diagram whose meaning isn't in the text (preview is just a sheet title like "EXHIBIT A — EXISTING BUILDING") → render those pages and read them:
     `python3 scripts/render_pages.py "<pdf>" 13,14 /tmp/rfp_pages` (the `note` field shows the exact command; pages accept a comma list and/or ranges like `1-20`), then `Read` each image path it prints. One Bash call for several pages.
   - When you do read a figure, map it to a criterion (floor/phase plan → Scope; Gantt → Timeline; fee table → Budget; org/RACI → Governance) and, if it contradicts the prose, **trust the figure** and flag it.
3. **If `scanned` is true**, there's no usable text — render all pages with `render_pages.py` (the `note` gives the exact command) and vision-read them.
4. If the prose explicitly references a figure that matters (e.g. "see the schedule in Exhibit C") and it wasn't a candidate, render that page too with `render_pages.py`. Never drop decision-relevant visual evidence to save time — but equally, never render a page whose content you already have in text.

If the script reports `needs_install`, the pypdfium2 auto-install was blocked (rare — e.g. no network/pip); installing poppler (`brew install poppler`) is the fallback. For a **non-PDF** (Word/RTF/text): skip the script, just `Read` the file.

Net effect: a text RFP renders nothing and runs fast; an RFP with real plans/diagrams renders only those few pages. Either way you've covered the whole document — don't analyze a partial RFP; if you genuinely couldn't read part of it, say so.

### 2. Score against the rubric

Read `references/scoring-rubric.md` for the full method. In short:

- Score each of six criteria **0–100** against explicit anchors (not on its weight — that was the original tool's bug).
- Multiply each by the **weights from step 0** and sum to a 0–100 weighted total.
- Apply **red-flag gates**: a single dealbreaker (no budget and no way to discuss it, hostile legal terms, dead deadline, wired-for-incumbent, unpaid spec work) caps the overall score regardless of the average — because a weighted average otherwise hides a fatal flaw. Use judgment; don't false-fire a gate just because a contract exists.
- **Final overall score = min(weighted total, lowest gate ceiling).** Always show both numbers and explain any gap.

Color bands: **Green 80–100**, **Yellow 60–79**, **Red <60**.

### 3. Stay grounded — score what's in the document

No web/live search; everything comes from the RFP. Cite evidence by page/section/figure for every score and claim. When something isn't in the document, say "Not specified in RFP" and let that *lower* the relevant score and become a clarification to request — don't guess or invent market data. The user is making a real money decision; conservative-and-honest beats confident-and-wrong.

### 4. Build the RFP X-Ray (strategic read)

Six one-paragraph strategic reads — competitiveness, continuity vs change, motivation, engagement style, decision process, governance — each evidence-cited or explicitly marked unknown. Definitions in `references/scoring-rubric.md` §5. Close with a synthesizing "current assessment."

### 5. Produce the role-tailored report — emit JSON, let the script render it

**Do not hand-write the HTML.** Writing ~600 lines of HTML/CSS per run is the single biggest write-side cost. Instead, write a compact `eval.json` with the findings and run the generator:

```
python3 scripts/render_report.py <eval.json> "<output.html>"
```

The JSON schema (omit any field you don't need; text fields support **bold**; add a `cite` field next to a rationale/flag/xray entry instead of writing the citation inline):

```json
{
  "role": "recipient",                      // or "issuer"
  "title": "...", "client_line": "Client · Recipient view · Evaluated <date>",
  "score": 49, "color": "red", "score_label": "Red (gated)",
  "quality_label": "Quality: 72 / Yellow", "quality_color": "yellow",
  "call": "one-line bid/no-bid (recipient) or quality verdict (issuer)",
  "verdict": "2–3 sentence headline, **bold** allowed",
  "meta": [["Deadline","..."], ["Weights","..."]],
  "flags": [{"level":"red|yellow|green","title":"...","impact":"...","cite":"p.X"}],
  "gate_line": "Gate applied: ... final = min(..) = **49 (Red)**",
  "weights_note": "Weights reflect your priority (…).",
  "criteria": [{"name":"...","score":72,"weight":30,"contribution":"21.6","flag":"yellow","rationale":"...","cite":"p.X"}],
  "total_row": {"score":72,"note":"..."},
  "charts_note": "what was read visually, or 'fully text — nothing rendered (fast path)'",
  "background": "...",
  "scope_groups": [{"label":"Deliverables","items":["..."]}],
  "key_dates": ["..."],
  "xray": [{"name":"Competitiveness","one_line":"...","details":"...","cite":"p.X"}],
  "current_assessment": "...",

  // recipient only:
  "recommendation": "...", "clarifications": ["..."],
  // issuer only:
  "feedback_table": [{"area":"Budget","status":"Red","status_color":"red","feedback":"..."}],
  "priority_fixes": ["..."], "narrative": "..."
}
```

**Tailor to the role from step 0:** recipient → `call` is a bid/no-bid, include `recommendation` + `clarifications`, omit the issuer fields. Issuer → `call` is a quality verdict, include `feedback_table` + `priority_fixes` + `narrative`, omit `recommendation`/`clarifications`. Keep the score table, flags, X-Ray, and weights for both. Always set `weights_note` to the weights you used.

Write `eval.json` to the working directory or `/tmp`, render to a `.html` next to the source document, tell the user the path, and give a 3–4 line summary in chat. Mention the other view is available on request. (The older `assets/report-template.html` is just a visual reference — the script is the renderer.)

## Notes

- If the file isn't an RFP at all, say so rather than forcing the template.
- Weights come from the user's priorities (step 0) — always state which weights you used; don't silently apply a different set than they chose.
- Keep the tone decision-useful and plain. The reader is deciding whether to spend real time and money.
