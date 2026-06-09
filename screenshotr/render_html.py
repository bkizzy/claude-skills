#!/usr/bin/env python3
"""Render a self-contained HTML gallery of screenshots.

Reads absolute image paths from stdin (one per line, newest first, as printed
by find_screenshots.sh) and writes a single self-contained index.html with each
image base64-embedded in a vertical list.

Usage:
    find_screenshots.sh 5 | render_html.py --out /path/to/index.html

Stdin is used (not argv) so paths containing the narrow no-break space that
macOS puts before AM/PM survive intact.
"""
import argparse
import base64
import html
import mimetypes
import os
import sys

p = argparse.ArgumentParser()
p.add_argument("--out", required=True, help="output index.html path")
args = p.parse_args()

paths = [ln.rstrip("\n") for ln in sys.stdin if ln.strip()]
if not paths:
    sys.stderr.write("render_html: no image paths on stdin\n")
    sys.exit(1)

cards = []
for path in paths:
    name = os.path.basename(path)
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError as e:
        cards.append(
            f'<li class="card error"><div class="meta">{html.escape(name)}</div>'
            f'<div class="err">could not read: {html.escape(str(e))}</div></li>'
        )
        continue
    mime = mimetypes.guess_type(path)[0] or "image/png"
    b64 = base64.b64encode(data).decode("ascii")
    size_kb = len(data) / 1024
    cards.append(
        '<li class="card">'
        f'<div class="meta"><span class="name">{html.escape(name)}</span>'
        f'<span class="size">{size_kb:,.0f} KB</span></div>'
        f'<img loading="lazy" alt="{html.escape(name)}" '
        f'src="data:{mime};base64,{b64}">'
        "</li>"
    )

count = len(paths)
doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>screenshotr — {count} image{'s' if count != 1 else ''}</title>
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 24px;
    background: #0d0d0f; color: #e7e7ea;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }}
  header {{ display: flex; align-items: baseline; gap: 10px; margin-bottom: 20px; }}
  header h1 {{ font-size: 18px; margin: 0; font-weight: 650; }}
  header .sub {{ color: #8a8a93; font-size: 13px; }}
  ul {{ list-style: none; margin: 0; padding: 0; display: flex;
        flex-direction: column; gap: 28px; }}
  .card {{ background: #161619; border: 1px solid #26262b; border-radius: 12px;
           overflow: hidden; }}
  .meta {{ display: flex; justify-content: space-between; align-items: center;
           gap: 12px; padding: 10px 14px; border-bottom: 1px solid #26262b;
           background: #1b1b1f; }}
  .name {{ font-weight: 600; word-break: break-all; }}
  .size {{ color: #8a8a93; font-variant-numeric: tabular-nums; white-space: nowrap; }}
  .card img {{ display: block; width: 100%; height: auto; background: #000; }}
  .card.error {{ border-color: #5a2b2b; }}
  .err {{ padding: 14px; color: #ff8a8a; }}
</style>
</head>
<body>
  <header>
    <h1>screenshotr</h1>
    <span class="sub">{count} screenshot{'s' if count != 1 else ''}, newest first</span>
  </header>
  <ul>
    {''.join(cards)}
  </ul>
  <script>
    // Auto-reload the preview pane when the gallery is re-rendered. Polls this
    // page's Last-Modified header (served by python http.server from the file
    // mtime) and reloads only when it actually changes.
    let lastMod = null;
    async function check() {{
      try {{
        const r = await fetch(location.href, {{ method: 'HEAD', cache: 'no-store' }});
        const m = r.headers.get('Last-Modified');
        if (m && lastMod && m !== lastMod) {{ location.reload(); return; }}
        if (m) lastMod = m;
      }} catch (e) {{ /* server momentarily down mid-render; ignore */ }}
    }}
    setInterval(check, 1500);
  </script>
</body>
</html>
"""

os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
with open(args.out, "w", encoding="utf-8") as fh:
    fh.write(doc)

print(args.out)
