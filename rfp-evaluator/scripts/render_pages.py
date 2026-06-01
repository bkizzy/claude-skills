#!/usr/bin/env python3
"""
Render specific PDF pages to grayscale JPEGs for vision reading.

Uses poppler (pdftoppm) if present, otherwise pypdfium2 (auto-bootstrapped — see
_pdf_engine.py). Either way the skill then Reads the returned image paths.

Usage:  python3 render_pages.py <pdf> <pages> <outdir> [dpi]
  <pages>  comma list and/or ranges, e.g. "13,14"  or  "1-20"  or  "3,7,13-15"
Output:  JSON {"ok": true, "engine": "...", "images": [paths...]}
"""
import sys, os, json, subprocess
import _pdf_engine as eng

MAX_DIM = 3400  # cap longest side so large-format sheets stay a sensible file size


def parse_pages(spec):
    pages = []
    for part in spec.replace(" ", "").split(","):
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            pages.extend(range(int(a), int(b) + 1))
        else:
            pages.append(int(part))
    return sorted(set(pages))


def main():
    if len(sys.argv) < 4:
        print(json.dumps({"ok": False, "error": "usage: render_pages.py <pdf> <pages> <outdir> [dpi]"}))
        return
    pdf, pages_spec, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
    dpi = int(sys.argv[4]) if len(sys.argv) > 4 else 110
    os.makedirs(outdir, exist_ok=True)
    pages = parse_pages(pages_spec)
    images = []

    if eng.poppler_available():
        engine = "poppler"
        ppm = eng.find_bin("pdftoppm")
        for p in pages:
            prefix = os.path.join(outdir, f"p{p:04d}")
            subprocess.run([ppm, "-jpeg", "-r", str(dpi), "-gray",
                            "-f", str(p), "-l", str(p), pdf, prefix], check=False)
            got = [os.path.join(outdir, f) for f in os.listdir(outdir)
                   if f.startswith(f"p{p:04d}") and f.endswith(".jpg")]
            if got:
                images.append(sorted(got)[0])
    else:
        eng.ensure_pdfium()  # may re-exec under the venv python
        engine = "pypdfium2"
        import pypdfium2 as pdfium
        doc = pdfium.PdfDocument(pdf)
        for p in pages:
            if p < 1 or p > len(doc):
                continue
            img = doc[p - 1].render(scale=dpi / 72, grayscale=True).to_pil().convert("L")
            w, h = img.size
            if max(w, h) > MAX_DIM:
                s = MAX_DIM / max(w, h)
                img = img.resize((int(w * s), int(h * s)))
            out = os.path.join(outdir, f"p{p:04d}.jpg")
            img.save(out, "JPEG", quality=80)
            images.append(out)

    print(json.dumps({"ok": True, "engine": engine, "images": images}))


if __name__ == "__main__":
    main()
