#!/usr/bin/env python3
"""Build a self-contained PDF annotation viewer from a PDF.

Inlines the PDF.js library + worker + the PDF itself (base64) into a single
HTML file. The result has no external dependencies and works offline.

Used standalone (download/save fallback) or imported by annotate.py (which
serves it and receives the notes back automatically).

Usage:
    python3 build_viewer.py <input.pdf> [--out <output.html>]

Prints the absolute path of the generated HTML on success.
"""
import argparse
import base64
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, "..", "assets"))


def _read(path, mode="r"):
    with open(path, mode) as f:
        return f.read()


def build_html(pdf_path):
    """Return the self-contained viewer HTML for the given PDF as a string."""
    template = _read(os.path.join(ASSETS, "viewer_template.html"))
    pdfjs_lib = _read(os.path.join(ASSETS, "pdf.min.js"))
    worker_b64 = base64.b64encode(_read(os.path.join(ASSETS, "pdf.worker.min.js"), "rb")).decode("ascii")
    pdf_b64 = base64.b64encode(_read(pdf_path, "rb")).decode("ascii")

    pdf_name = os.path.basename(pdf_path)
    base = os.path.splitext(pdf_name)[0]
    notes_name = base + ".notes.json"

    html = template
    # library goes inside a comment marker so it can contain anything
    html = html.replace("/*__PDFJS_LIB__*/", pdfjs_lib)
    # base64 / plain string tokens (base64 contains no quotes -> safe)
    html = html.replace("__PDF_WORKER_B64__", worker_b64)
    html = html.replace("__PDF_DATA_B64__", pdf_b64)
    html = html.replace("__NOTES_NAME__", notes_name)
    # PDF_NAME appears in attributes/visible text; escape minimally
    safe_name = (pdf_name.replace("&", "&amp;").replace("<", "&lt;")
                 .replace(">", "&gt;").replace('"', "&quot;"))
    html = html.replace("__PDF_NAME__", safe_name)
    return html


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", help="Path to the PDF to annotate")
    ap.add_argument("--out", help="Output HTML path (default: <pdf>.annotate.html next to the PDF)")
    args = ap.parse_args()

    pdf_path = os.path.abspath(args.pdf)
    if not os.path.isfile(pdf_path):
        sys.exit(f"error: PDF not found: {pdf_path}")

    html = build_html(pdf_path)
    base = os.path.splitext(os.path.basename(pdf_path))[0]
    out_path = os.path.abspath(args.out) if args.out else os.path.join(
        os.path.dirname(pdf_path), base + ".annotate.html")

    with open(out_path, "w") as f:
        f.write(html)
    print(out_path)


if __name__ == "__main__":
    main()
