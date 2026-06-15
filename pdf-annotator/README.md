# pdf-annotator

Review a PDF the way you'd mark up paper: **underline any word or phrase, attach a note
to it, and send the whole set straight back to Claude** to act on — no saving, no file
juggling.

## What it does

1. Builds a **self-contained HTML viewer** for a PDF (PDF.js + its worker + the PDF itself
   are all base64-inlined, so the file works offline with zero external requests).
2. Serves it from a one-shot `127.0.0.1` server and opens it in your browser.
3. You select text → the moment the selection settles, the word/phrase is underlined and a
   **note box pops up right at the selection**. Type your note and press **Enter** to save
   it (a card also appears in the sidebar). **Esc** or clicking away discards the box *and*
   removes the underline — so highlights never linger without a note.
4. Press the **✓** button — that's it, no modal. The notes POST back to the local server,
   which writes `<pdf>.notes.json` next to the PDF and shuts down; Claude (which launched it
   as a background task) wakes up and acts on each note.

## Usage

Just ask Claude to let you annotate a PDF it made — e.g. *"let me annotate that PDF"* or
*"open the report so I can leave notes."* Claude runs:

```bash
python3 scripts/annotate.py /path/to/report.pdf
```

as a background task, you annotate, you press ✓, and it actions your notes. Then it offers
to regenerate the PDF and go again.

## Pieces

| File | Role |
| --- | --- |
| `SKILL.md` | What Claude reads — the two-step launch/act workflow. |
| `scripts/annotate.py` | Builds the viewer, serves it on an ephemeral localhost port, opens the browser, captures the notes on ✓, writes `<pdf>.notes.json` next to the PDF, exits. |
| `scripts/build_viewer.py` | Builds just the standalone self-contained HTML (no server). Also exposes `build_html()` used by `annotate.py`. |
| `assets/viewer_template.html` | The annotator UI (render, select→underline→note, sidebar, zoom, submit). |
| `assets/pdf.min.js`, `pdf.worker.min.js` | Bundled PDF.js 3.11.174 (Apache-2.0), inlined into each viewer. |
| `examples/sample_report.pdf` | Demo PDF — *"annotate the sample PDF."* |

## Notes file shape

```json
{
  "pdf": "report.pdf",
  "count": 2,
  "annotations": [
    { "n": 1, "page": 1, "quote": "market conditions remain favorable", "note": "Give numbers." },
    { "n": 2, "page": 2, "quote": "velocity", "note": "Define this." }
  ]
}
```

## Known gaps / rot points

- **Selection maps to text, not pixels.** Highlights are stored as fractions of the page
  box and re-laid-out on zoom; they ride on PDF.js's text layer, so a scanned (image-only)
  PDF with no text layer won't be selectable. Run OCR first for those.
- **The server is single-shot.** It serves one PDF and exits after the first ✓ submit
  (or after `--timeout`, default 1h). Re-launch for another pass.
- **`file://` fallback.** `build_viewer.py`'s standalone output, opened directly as a file,
  can't reach the server — its ✓ falls back to saving `notes.json` to Downloads. Some
  browsers (Safari) block even that script-triggered download; the dialog has a **Copy
  notes** button as the last resort. The `annotate.py` server path avoids all of this.
- **rAF guard.** PDF.js chunks rendering via `requestAnimationFrame`, which is throttled in
  hidden/background tabs; the viewer falls back to a timer when `document.hidden` so a
  backgrounded tab still finishes rendering.
