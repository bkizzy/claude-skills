---
name: html-doc
description: Produce documents as a single self-contained HTML file with a click-to-copy button. Use whenever creating a document, report, write-up, summary, notes, memo, or any deliverable for the user to read or share — unless another format (.md, .docx, .pdf, .xlsx, .pptx) is explicitly requested or required by the task. HTML is the default document format.
---

# HTML Document (default format)

When the user asks you to create a document and has **not** specified a format, produce a **single self-contained `.html` file** with a **click-to-copy button**.

## Rules

1. **One file, no dependencies.** Inline all CSS and JS. No CDN links, no external fonts, no build step. The file must open correctly by double-clicking it.
2. **Click-to-copy.** Put a copy button on the document content. On click it copies the rendered text to the clipboard and briefly confirms ("Copied!").
3. **Readable defaults.** Constrain line length (~70ch), comfortable spacing, system font stack, works in light and dark.
4. **Use another format only if** the user asks for it (`.md`, Word/`.docx`, `.pdf`, Excel/`.xlsx`, PowerPoint/`.pptx`) or the task clearly requires it (e.g. a spreadsheet of data → xlsx). When in doubt, HTML.
5. Save to a sensible path and tell the user the file location.

## What "copy" copies

Copy the **content the user would want to paste elsewhere** — the readable text/markdown of the document, not the HTML chrome. Keep the source text in a JS string (or a hidden element) and copy that, so pasted output is clean.

## Template

Use this as the starting point. Replace `DOCUMENT_TITLE`, the `COPY_PAYLOAD` string, and the visible content. Keep the structure.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DOCUMENT_TITLE</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6; margin: 0; padding: 2rem 1rem;
    background: #f6f7f9; color: #1a1a1a;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #16181c; color: #e6e6e6; }
    .card { background: #1f2227 !important; border-color: #2c3036 !important; }
    .copy-btn { background: #2c3036 !important; color: #e6e6e6 !important; border-color: #3a3f47 !important; }
  }
  .card {
    max-width: 70ch; margin: 0 auto; background: #fff;
    border: 1px solid #e3e6ea; border-radius: 12px;
    padding: 2rem 2.25rem; position: relative;
    box-shadow: 0 1px 3px rgba(0,0,0,.06);
  }
  .copy-btn {
    position: absolute; top: 1rem; right: 1rem;
    display: inline-flex; align-items: center; gap: .4rem;
    font: inherit; font-size: .82rem; cursor: pointer;
    background: #f1f3f5; color: #1a1a1a;
    border: 1px solid #d6dadf; border-radius: 8px;
    padding: .4rem .7rem; transition: background .15s;
  }
  .copy-btn:hover { background: #e7eaee; }
  .copy-btn svg { width: 15px; height: 15px; }
  h1, h2, h3 { line-height: 1.25; }
  h1 { margin-top: 0; }
  pre { background: rgba(127,127,127,.12); padding: 1rem; border-radius: 8px; overflow-x: auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
  a { color: #2563eb; }
</style>
</head>
<body>
  <article class="card">
    <button class="copy-btn" onclick="copyDoc(this)" aria-label="Copy document">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
      <span>Copy</span>
    </button>

    <!-- VISIBLE CONTENT START -->
    <h1>DOCUMENT_TITLE</h1>
    <p>Replace this with the document body.</p>
    <!-- VISIBLE CONTENT END -->
  </article>

  <script>
    // Clean text/markdown that gets copied — keep in sync with the visible content above.
    const COPY_PAYLOAD = `DOCUMENT_TITLE

Replace this with the document body.`;

    function copyDoc(btn) {
      navigator.clipboard.writeText(COPY_PAYLOAD).then(() => {
        const label = btn.querySelector('span');
        const prev = label.textContent;
        label.textContent = 'Copied!';
        btn.disabled = true;
        setTimeout(() => { label.textContent = prev; btn.disabled = false; }, 1400);
      });
    }
  </script>
</body>
</html>
```

This skill is self-contained: the template above is everything needed. To make HTML the default **without** relying on this skill triggering, see `README.md` in this folder.
