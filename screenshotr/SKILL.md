---
name: screenshotr
description: Pull the most recent screenshot(s) from the system screenshot folder into the session so Claude can see them. Invoked as /screenshotr. With no argument, loads the single latest screenshot; with a number N, loads the latest N. Use whenever the user wants Claude to look at "my latest screenshot", "the screenshot I just took", "what's on my screen that I captured", or types /screenshotr.
---

# screenshotr

Loads the most recently captured screenshot(s) from the system's screenshot
folder into the conversation so you can view them.

## Argument

- **(no argument)** → the single latest screenshot.
- **a number `N`** → the latest `N` screenshots, newest first.
- **`--open`** → also open in Preview. **`--html`** → also show in the preview pane.

## How it runs — the subagent does EVERYTHING; the main thread only learns what & where

The main thread does **no bash, no Read, no render, no preview** itself. It spawns
**one subagent on the cheapest model** that performs the entire job — find,
thumbnail, read, and (when display is warranted) render + open the preview — and
returns only a compact result. All image tokens and all display mechanics stay
inside the subagent. The main thread ends up knowing only **what** each image is
and **where** it lives (plus whether a preview was opened).

Determine, from the user's args:
- **N** — the count (number argument, or 1 if none).
- **display mode** — `html` if `--html`, `open` if `--open`, else `none`.

Spawn with the **Agent** tool, `model: "haiku"` (cheapest available),
`subagent_type: "general-purpose"`. Substitute N and the display mode into this
prompt:

> You are handling the screenshotr skill end to end. Do every step yourself and
> return only the final list described at the bottom — no preamble, no reasoning.
>
> 1. List + thumbnail, then read:
>    `bash ~/.claude/skills/screenshotr/find_screenshots.sh N | bash ~/.claude/skills/screenshotr/thumb.sh`
>    Read every path it prints, in order (newest first).
>
> 2. If display mode is `html`: render the gallery —
>    `bash ~/.claude/skills/screenshotr/find_screenshots.sh N | python3 ~/.claude/skills/screenshotr/render_html.py --out ~/.claude/skills/screenshotr/preview/index.html`
>    — then start the preview pane: load the preview tool via ToolSearch
>    (`select:mcp__Claude_Preview__preview_start`) and call it with
>    `name: "screenshotr"` (it reuses a running server; the page auto-reloads).
>    If `.claude/launch.json` lacks a `screenshotr` config, create it first per
>    the skill's HTML-mode section.
>
> 3. If display mode is `open`: run
>    `bash ~/.claude/skills/screenshotr/find_screenshots.sh N --open`.
>
> 4. Return ONLY this, one line per image, newest first:
>    `<absolute path> | <filename> (<capture time>) | <1–3 sentence description: app/UI, key visible text, what the user is doing>`
>    then one final line:
>    `PREVIEW: <none | html @ http://localhost:7399 | opened in Preview>`

**Display is warranted** only when the user passes `--open` / `--html` or asks to
see/show the screenshot; otherwise the mode is `none` and the subagent describes
without displaying.

## Main-thread reply — terse, no trail of thought

The subagent's reply already carries **what** (descriptions) and **where**
(paths), plus the `PREVIEW:` status. The main thread relays just that — filename,
capture time, description per image, and a one-line note if a preview was opened.
Do **not** narrate mechanics (no "let me run…", no bash/Read steps), and do **not**
run any render/preview commands on the main thread — the subagent already did.

---

## Reference: display mechanics (performed by the subagent)

These are the details behind steps 2–3 of the subagent prompt above. The main
thread never runs these.

### `open` mode (Preview app)

```bash
bash ~/.claude/skills/screenshotr/find_screenshots.sh [N] --open
```

Never reconstruct the path and call `open` directly — macOS screenshot filenames
use a **narrow no-break space (U+202F)** before AM/PM, so a typed/quoted path
silently fails to match. Let the helper open it.

### `html` mode (Claude's preview pane)

Build a self-contained HTML gallery (images render as a vertical list, newest
first) and serve it to the preview pane:

1. Render: `find_screenshots.sh [N] | render_html.py --out .../preview/index.html`.
2. Ensure `.claude/launch.json` has a `screenshotr` config serving the preview
   dir on port 7399 (create if missing):

   ```json
   {
     "version": "0.0.1",
     "configurations": [{
       "name": "screenshotr",
       "runtimeExecutable": "python3",
       "runtimeArgs": ["-m", "http.server", "7399", "--directory",
         "/Users/<you>/.claude/skills/screenshotr/preview"],
       "port": 7399
     }]
   }
   ```

3. Start the pane with the **preview_start** tool (`name: "screenshotr"`; reuses
   a running server).

The rendered page **auto-reloads** (polls its own Last-Modified every 1.5s), so
re-rendering refreshes the pane within ~2s — no manual refresh. The gallery keeps
full-resolution originals for the user to view; the subagent reads the
lightweight thumbnails to describe them.

## Notes

- If the helper exits with "no images found", tell the user the folder is empty
  and which folder was checked — don't guess at contents.
- Filenames contain a narrow no-break space before AM/PM
  (`Screenshot 2026-06-04 at 11.32.26 PM.png`); always pass the path to Read
  exactly as printed, never retyped.
