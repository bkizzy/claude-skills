#!/usr/bin/env python3
"""
Fast RFP prep: extract the whole text layer cheaply, and report which pages (if
any) are genuinely *image-based* (floor plans, scans, full-page graphics) and so
need vision. It does NOT auto-render — the skill decides per page from the preview.

Engine: uses poppler if present (fast), otherwise pypdfium2 (a pip wheel, no admin
needed — see _pdf_engine.py). Both paths produce identical results.

Usage:  python3 prepare_rfp.py "/path/to/rfp.pdf"
Output: a single JSON object on stdout (see keys near the bottom).
"""
import sys, os, json, re, subprocess, hashlib
import _pdf_engine as eng

# A page is "image-based" (worth vision) only if it carries a large embedded image
# AND little extractable text — what a floor-plan or scanned page looks like.
LARGE_IMG_MIN_DIM = 700       # px
IMAGE_PAGE_TEXT_CEILING = 400  # chars; above this it's really a text page


def fail(msg, **extra):
    out = {"ok": False, "error": msg}
    out.update(extra)
    print(json.dumps(out))
    sys.exit(0)


def extract_poppler(pdf, text_file):
    """(full_text, pages, page_count, pages_with_large_image) via poppler CLI."""
    pdftotext = eng.find_bin("pdftotext")
    pdfinfo = eng.find_bin("pdfinfo")
    pdfimages = eng.find_bin("pdfimages")

    subprocess.run([pdftotext, "-layout", pdf, text_file], check=False)
    full_text = ""
    if os.path.exists(text_file):
        with open(text_file, "r", errors="replace") as f:
            full_text = f.read()

    page_count = 0
    if pdfinfo:
        try:
            info = subprocess.run([pdfinfo, pdf], capture_output=True, text=True)
            m = re.search(r"^Pages:\s+(\d+)", info.stdout, re.M)
            if m:
                page_count = int(m.group(1))
        except Exception:
            pass
    pages = full_text.split("\f")
    if page_count == 0:
        page_count = len(pages)

    big = set()
    if pdfimages:
        try:
            out = subprocess.run([pdfimages, "-list", pdf], capture_output=True, text=True)
            for line in out.stdout.splitlines():
                f = line.split()
                if len(f) < 5 or not f[0].isdigit():
                    continue
                try:
                    pg, w, h = int(f[0]), int(f[3]), int(f[4])
                except ValueError:
                    continue
                if w >= LARGE_IMG_MIN_DIM and h >= LARGE_IMG_MIN_DIM:
                    big.add(pg)
        except Exception:
            pass
    return full_text, pages, page_count, big


def extract_pdfium(pdf, text_file):
    """(full_text, pages, page_count, pages_with_large_image) via pypdfium2."""
    import pypdfium2 as pdfium
    from pypdfium2.raw import FPDF_PAGEOBJ_IMAGE

    doc = pdfium.PdfDocument(pdf)
    page_count = len(doc)
    pages, big = [], set()
    for i in range(page_count):
        page = doc[i]
        try:
            txt = page.get_textpage().get_text_bounded()
        except Exception:
            txt = ""
        pages.append(txt)
        for obj in page.get_objects():
            if obj.type == FPDF_PAGEOBJ_IMAGE:
                try:
                    w, h = obj.get_px_size()
                except Exception:
                    continue
                if w >= LARGE_IMG_MIN_DIM and h >= LARGE_IMG_MIN_DIM:
                    big.add(i + 1)
                    break
    full_text = "\f".join(pages)
    with open(text_file, "w") as f:
        f.write(full_text)
    return full_text, pages, page_count, big


def main():
    if len(sys.argv) < 2:
        fail("No PDF path given. Usage: prepare_rfp.py <pdf>")
    pdf = sys.argv[1]
    if not os.path.exists(pdf):
        fail(f"File not found: {pdf}")

    h = hashlib.sha1(os.path.abspath(pdf).encode()).hexdigest()[:10]
    work = f"/tmp/rfp_eval_{h}"
    os.makedirs(work, exist_ok=True)
    text_file = os.path.join(work, "full.txt")

    # Choose engine: poppler if available, else bootstrap + use pypdfium2.
    if eng.poppler_available():
        engine = "poppler"
        full_text, pages, page_count, big = extract_poppler(pdf, text_file)
    else:
        eng.ensure_pdfium()  # may re-exec this script under the venv python
        engine = "pypdfium2"
        full_text, pages, page_count, big = extract_pdfium(pdf, text_file)

    # Per-page text counts.
    page_chars = {}
    for i, ptext in enumerate(pages, start=1):
        if i > page_count:
            break
        page_chars[i] = len(re.sub(r"\s", "", ptext))
    total_chars = sum(page_chars.values())
    scanned = page_count > 0 and total_chars < 100 * page_count

    # Targeted extracts so the skill can skim contract/appendix boilerplate.
    def grab(patterns, cap=40):
        rx = re.compile("|".join(patterns), re.I)
        hits, seen = [], set()
        for ln in full_text.splitlines():
            t = ln.strip()
            if len(t) < 4 or t in seen:
                continue
            if rx.search(t):
                seen.add(t)
                hits.append(t)
                if len(hits) >= cap:
                    break
        return hits

    key_extracts = {
        "budget_fee": grab([r"\$[\d,]", r"not[- ]to[- ]exceed", r"\bbudget\b", r"design fee",
                            r"\bfee[s]?\b", r"reimbursable", r"cost of the work", r"compensation"]),
        "dates_schedule": grab([r"\bdeadline\b", r"\bdue\b", r"submission", r"\bschedule\b",
                               r"milestone", r"\bphase\b", r"opening", r"\b20\d\d\b",
                               r"notice to proceed", r"completion"]),
        "legal_risk": grab([r"indemnif", r"liabilit", r"insurance", r"intellectual propert",
                           r"ownership", r"copyright", r"work made for hire", r"terminat",
                           r"warrant", r"governing law", r"confidential", r"hold harmless"]),
        "evaluation_award": grab([r"evaluation", r"\baward\b", r"criteria", r"\blowest\b",
                                 r"best value", r"selection", r"weight", r"qualif"]),
    }

    render_cmd = 'python3 scripts/render_pages.py "%s" <pages,csv> %s' % (pdf, work)
    candidates = []
    if scanned:
        note = ("PDF appears to be scanned (little/no text layer). Render all pages and "
                "vision-read them. Render with: "
                + render_cmd.replace("<pages,csv>", "1-%d" % page_count))
    else:
        for i in range(1, page_count + 1):
            chars = page_chars.get(i, 0)
            if i in big and chars < IMAGE_PAGE_TEXT_CEILING:
                preview = re.sub(r"\s+", " ", pages[i - 1]).strip()[:200] if i - 1 < len(pages) else ""
                candidates.append({"page": i, "text_chars": chars, "preview": preview})
        if candidates:
            note = ("These pages carry a large graphic with little text — they MAY be figures "
                    "worth seeing. Check each preview; render only the truly image-only ones with: "
                    + render_cmd)
        else:
            note = ("No image-based pages — the document's content is fully in the text layer. "
                    "Render nothing; read the text. (Fast path.)")

    print(json.dumps({
        "ok": True,
        "pdf": pdf,
        "engine": engine,
        "work_dir": work,
        "page_count": page_count,
        "text_file": text_file,
        "text_chars": total_chars,
        "scanned": scanned,
        "image_candidate_pages": candidates,
        "key_extracts": key_extracts,
        "note": note,
    }, indent=2))


if __name__ == "__main__":
    main()
