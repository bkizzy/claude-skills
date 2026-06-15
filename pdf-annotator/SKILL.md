---
name: pdf-annotator
description: Open a PDF in an interactive viewer where the user can underline any word or phrase and attach a note to it, then send those notes straight back to Claude to act on — no saving or file handling by the user. Use whenever the user wants to review, mark up, annotate, comment on, or "leave notes on" a PDF — especially a PDF Claude just generated (a report, summary, deliverable). Trigger on requests like "let me annotate that PDF", "I want to mark up the report", "open the PDF so I can leave notes", or "let me review the PDF and comment".
---

# PDF Annotator

Lets the user visually review a PDF, **underline any word/phrase and attach a note**,
then sends those notes back automatically so Claude can act on each one. The viewer is a
single self-contained HTML page (PDF.js bundled inside — works offline). A tiny
localhost-only server captures the notes when the user presses the checkmark, so the
**user never has to save or hand off a file**.

## When to use

- The user wants to review / mark up / annotate / comment on a PDF (usually one Claude
  just created) and give targeted feedback tied to specific passages.

## Workflow

### 1. Launch the annotator — run it as a BACKGROUND task

```bash
python3 ~/.claude/skills/pdf-annotator/scripts/annotate.py "/path/to/report.pdf"
```

Run this **in the background** (the harness will notify you when it exits). It builds the
viewer, serves it from an ephemeral `127.0.0.1` port, and opens it in the user's browser.

Then tell the user: *select any text to underline it and attach a note in the sidebar;
press the **✓** button when done — there's nothing to save.*

### 2. Act on the notes — automatic

The instant the user presses ✓, the viewer POSTs the notes back; the server writes
**`<pdf-basename>.notes.json` next to the PDF** and exits — and you get notified that the
background task finished. Then:

1. Read `<pdf-basename>.notes.json` from the **same folder as the PDF**.
2. For each annotation, locate the `quote` in the **source** the PDF was generated from
   (the markdown/HTML/document, not the PDF binary) and apply the `note` as a revision
   instruction to that passage. Use `page` + `quote` to disambiguate repeated text.
3. Briefly confirm back what you changed per note, then offer to regenerate the PDF and
   start another annotation pass.

If a note's text is empty, treat the underline as "look at this" and ask what they want.

Notes file structure:

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

## Notes

- If the background task prints `TIMEOUT` (default 1 hour) the user never submitted —
  check in with them; re-launch if needed. Pass `--timeout SECONDS` to change it.
- `scripts/build_viewer.py <pdf>` builds just the standalone HTML (no server). When opened
  as a plain `file://`, its ✓ falls back to saving `notes.json` to Downloads — only needed
  if you can't run the server.
- Demo: `examples/sample_report.pdf`.
