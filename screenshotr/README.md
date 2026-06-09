# screenshotr

Pull your most recent macOS screenshot(s) into a Claude session — described, and optionally displayed. Invoked as `/screenshotr`.

The core idea: **the main thread never loads the images.** A cheap Haiku subagent does the whole job — locate the screenshot folder, downscale for vision, read, and (when asked) render/open a preview — and returns only a compact list of *what each image is* and *where it lives*. So the expensive image tokens and all the display mechanics stay in a throwaway subagent context; the main conversation just gets the answer.

## What it does

1. **Finds the screenshot folder from the system** — reads `defaults read com.apple.screencapture location`, falling back to `~/Desktop` (the macOS default). Override with the `SCREENSHOTR_DIR` env var.
2. **Picks the newest N** images by modification time (png/jpg/jpeg/gif/heic/webp), newest first.
3. **Downscales for vision** — anything over ~1568px on its long edge (the size Claude's vision API uses anyway) is resampled to a cached JPEG, cutting the read payload ~40%+ with no loss of usable detail. Already-small images pass through untouched.
4. **Delegates to a Haiku subagent** that reads each image and returns one line per image: `path | filename (capture time) | description`, plus a `PREVIEW:` status line.
5. **Optionally displays** — `--open` in Preview.app, or `--html` as an auto-refreshing gallery in Claude's preview pane.

## Modes

| Invocation | Behavior |
| --- | --- |
| `/screenshotr` | Describe the latest screenshot. |
| `/screenshotr N` | Describe the latest N, newest first. |
| `/screenshotr [N] --open` | Also open them in Preview.app. |
| `/screenshotr [N] --html` | Also render them as a vertical gallery in Claude's preview pane (auto-reloads on re-render). |

## Files

| Path | Role |
| --- | --- |
| `SKILL.md` | Instructions Claude reads at runtime — including the Haiku-subagent orchestration. |
| `find_screenshots.sh` | Resolves the screenshot folder from the system and prints the newest N absolute paths (newest first). |
| `thumb.sh` | Cached downscale-for-vision (≤1568px JPEG). Only ever downscales; never enlarges. Falls back to the original if `sips` is unavailable. |
| `render_html.py` | Builds a self-contained HTML gallery (base64-embedded images) with a Last-Modified poll that auto-reloads the preview pane. |
| `preview/` | Generated at runtime (gallery + thumbnail cache). Git-ignored. |

## Requirements

**Nothing to install** — macOS built-ins only:

- `sips` (ships with macOS) for thumbnailing; if absent, originals are read directly.
- `defaults` to read the screenshot location.
- `python3` (standard library only) for the HTML renderer.
- `--html` mode uses Claude Code's preview pane, which needs a `screenshotr` entry in the current project's `.claude/launch.json` (serving the skill's `preview/` dir on port 7399). The skill creates it automatically if missing.

macOS only — the folder resolution and `sips`/`defaults`/`open` calls are macOS-specific.

## The filename gotcha

macOS screenshot filenames use a **narrow no-break space (U+202F)** before `AM`/`PM` — e.g. `Screenshot 2026-06-04 at 11.32.26 PM.png`. A hand-typed or quoted path with a normal space silently fails to match. Everything here passes paths through stdin/pipes verbatim and never reconstructs them, which is why it works; if you script against this, do the same.

## Usage

```
/screenshotr 3 --html     # describe the latest 3 and show them in the preview pane
/screenshotr --open       # describe the latest one and open it in Preview
/screenshotr              # just describe the latest one
```

## Known gaps / rot points

- **macOS only.** Folder detection (`defaults`), thumbnailing (`sips`), and opening (`open`) are all macOS. A Linux port would need `gsettings`/XDG equivalents and a different image tool.
- **Preview pane is project-scoped.** The pane reads `.claude/launch.json` in the *current* project; the skill auto-creates the `screenshotr` config per repo, so the first `--html` in a new project writes that file.
- **Port 7399** is hard-coded for the preview server. Collides only if something else owns that port.
- **Thumbnail cache** lives in `preview/.thumbs`, keyed by source mtime, and self-prunes past 40 files — so re-captured files re-thumbnail, but the cache won't grow unbounded.
