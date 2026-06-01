# rfp-evaluator

Evaluate a Request for Proposal (RFP) and produce a single self-contained HTML report — a bid / no-bid call, a rubric-anchored 0–100 score, and a two-sided read. Invoked as `/rfp-evaluator`.

The core idea: **Claude reads the actual document** — including charts, Gantt timelines, budget tables, and floor plans — so visual content is comprehended, not lost to text extraction. Everything is grounded in the document; there is **no web search**, so claims are cited to a page and unknowns are flagged rather than guessed.

## What it does

1. **Asks two questions up front** — your role (you *received* the RFP and are deciding whether to bid, or you *issued* it and want it stronger) and what matters most to you (which reweights the score).
2. **Reads the document fast** — extracts the text layer and reserves vision only for genuinely image-only pages (floor plans, scans, diagrams). A born-digital/text RFP renders nothing.
3. **Scores six criteria** 0–100 against explicit anchors, weights them by your priorities, and applies **red-flag gates** — a single dealbreaker (no budget + no way to discuss it, hostile legal terms, dead deadline, wired-for-incumbent, unpaid spec work) caps the overall score so a weighted average can't hide a fatal flaw.
4. **Builds an "RFP X-Ray"** — competitiveness, continuity vs change, motivation, engagement style, decision process, governance.
5. **Renders a role-tailored HTML report** next to the source file.

## Scoring model

Six criteria, default weights: Budget 30 · Scope 25 · Timeline 15 · Goals 10 · Process 10 · Legal 10. Each scored 0–100, weighted, summed. Your stated priorities reassign the top weight slots via the slot rule `[30,25,15,10,10,10]`. Gates cap the final score; the report always shows both the rubric quality score and the gated final, and explains any gap. Full method in [`references/scoring-rubric.md`](./references/scoring-rubric.md).

## Files

| Path | Role |
| --- | --- |
| `SKILL.md` | Instructions Claude reads at runtime (the workflow). |
| `references/scoring-rubric.md` | Criteria anchors, gate definitions, X-ray dimensions, weight slot rule. |
| `scripts/_pdf_engine.py` | Picks the PDF engine: poppler if present, else bootstraps pypdfium2 in a venv and re-execs. Shared by the two scripts below. |
| `scripts/prepare_rfp.py` | Extracts text, triages which pages (if any) need vision, returns targeted budget/date/legal extracts. Does **not** auto-render. |
| `scripts/render_pages.py` | Renders specific pages to grayscale JPEGs for vision — via whichever engine is active. |
| `scripts/render_report.py` | Builds the HTML report from a compact `eval.json` (keeps the big HTML/CSS out of the model's output). |
| `assets/report-template.html` | Visual reference for the report layout (the script is the actual renderer). |

## Requirements

**Nothing to install.** The PDF scripts auto-select an engine:

- **poppler** if it's already on PATH (`pdftotext`/`pdfinfo`/`pdfimages`/`pdftoppm`) — fast, and the harness's own `Read` tool uses it too. Auto-located on Apple Silicon (`/opt/homebrew/bin`).
- otherwise **pypdfium2** — a pip wheel that bundles PDFium (Chromium's PDF engine), auto-installed into `~/.virtualenvs/rfp-pdf` on first use. No Homebrew, no admin; works anywhere Python does.

Python 3 only (standard library + the auto-installed `pypdfium2` on the fallback path). Force the fallback for testing with `RFP_ENGINE=pdfium`. No network calls during evaluation — `pypdfium2` is fetched once at install time.

## Usage

```
/rfp-evaluator           # then point it at an RFP file (PDF / Word / RTF / text)
```

It asks your role + priorities, reads the document, and writes `<RFP name> - Evaluation.html` next to the source.

## Known gaps / rot points

- **Document-only by design.** No web search, so it won't surface external context (incumbent reputation, typical market budgets, competitor pool size) — those are marked "Not specified in RFP." A web-augmented mode would need to be a separate, clearly-walled-off opt-in so it never contaminates the grounded score.
- **No hard system dependency** — poppler is used if present, else pypdfium2 is auto-installed. `needs_install` only appears if *both* are unavailable (e.g. no network for the one-time pip install and no poppler).
- **Scanned PDFs** fall back to rendering every page (slower) since there's no text layer.
- The PDF page count from poppler can differ from a viewer's count; the skill trusts poppler.
