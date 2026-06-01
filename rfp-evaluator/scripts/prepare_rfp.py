#!/usr/bin/env python3
"""
Fast RFP prep: extract the whole text layer cheaply, and render ONLY pages that
are genuinely *image-based* (floor plans, scanned pages, full-page graphics) —
i.e. pages where text extraction gets little or nothing, so vision is the only
way to read them.

This is the speed lever for the rfp-evaluator skill. The expensive thing is
rendering a page to an image and reading it with vision. A born-digital RFP
whose tables and schedules already extract as text needs NO rendering at all —
read the text. We only spend vision on pages that carry a large embedded image
AND have little extractable text, which is what a floor plan or scanned exhibit
looks like. A text slide that merely has a header is left to the (fast) text path.

Usage:  python3 prepare_rfp.py "/path/to/rfp.pdf"
Output: a single JSON object on stdout (see keys below).
"""
import sys, os, json, re, shutil, subprocess, hashlib

# A page is "image-based" (worth rendering) only if it has a large embedded raster
# image AND little extractable text. These thresholds separate a floor-plan/scan
# page from an ordinary text page that happens to carry a small logo or banner.
LARGE_IMG_MIN_DIM = 700      # px; an embedded image at least this wide AND tall
IMAGE_PAGE_TEXT_CEILING = 400  # chars; above this the page is really a text page

def find_bin(name):
    p = shutil.which(name)
    if p:
        return p
    for d in ("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"):
        cand = os.path.join(d, name)
        if os.path.exists(cand):
            return cand
    return None

def fail(msg, **extra):
    out = {"ok": False, "error": msg}
    out.update(extra)
    print(json.dumps(out))
    sys.exit(0)  # exit 0 so the caller reads our JSON rather than a stack trace

def main():
    if len(sys.argv) < 2:
        fail("No PDF path given. Usage: prepare_rfp.py <pdf>")
    pdf = sys.argv[1]
    if not os.path.exists(pdf):
        fail(f"File not found: {pdf}")

    pdftotext = find_bin("pdftotext")
    pdftoppm = find_bin("pdftoppm")
    pdfinfo = find_bin("pdfinfo")
    pdfimages = find_bin("pdfimages")
    if not (pdftotext and pdftoppm):
        fail("poppler is not installed. Run: brew install poppler",
             needs_install=True)

    h = hashlib.sha1(os.path.abspath(pdf).encode()).hexdigest()[:10]
    work = f"/tmp/rfp_eval_{h}"
    os.makedirs(work, exist_ok=True)

    # 1. Full text layer (cheap, complete prose).
    text_file = os.path.join(work, "full.txt")
    subprocess.run([pdftotext, "-layout", pdf, text_file], check=False)
    full_text = ""
    if os.path.exists(text_file):
        with open(text_file, "r", errors="replace") as f:
            full_text = f.read()

    # 2. Page count.
    page_count = 0
    if pdfinfo:
        try:
            info = subprocess.run([pdfinfo, pdf], capture_output=True, text=True)
            m = re.search(r"^Pages:\s+(\d+)", info.stdout, re.M)
            if m:
                page_count = int(m.group(1))
        except Exception:
            pass
    pages = full_text.split("\f")  # pdftotext separates pages with form feeds
    if page_count == 0:
        page_count = len(pages)

    # 3. Per-page text counts.
    page_chars = {}
    for i, ptext in enumerate(pages, start=1):
        if i > page_count:
            break
        page_chars[i] = len(re.sub(r"\s", "", ptext))
    total_chars = sum(page_chars.values())
    scanned = page_count > 0 and total_chars < 100 * page_count  # almost no text → scanned

    # 4. Find pages with a large embedded raster image (floor plans, scans, full graphics).
    pages_with_large_image = set()
    if pdfimages and not scanned:
        try:
            out = subprocess.run([pdfimages, "-list", pdf], capture_output=True, text=True)
            for line in out.stdout.splitlines():
                f = line.split()
                if len(f) < 5 or not f[0].isdigit():
                    continue  # header / non-data line
                try:
                    pg, w, h = int(f[0]), int(f[3]), int(f[4])
                except ValueError:
                    continue
                if w >= LARGE_IMG_MIN_DIM and h >= LARGE_IMG_MIN_DIM:
                    pages_with_large_image.add(pg)
        except Exception:
            pass

    # 5. Decide which pages genuinely need vision.
    # 5b. Pull targeted extracts so the skill can skim contract/appendix boilerplate
    # instead of reading every line. Each is the matching line plus light context.
    def grab(patterns, cap=40):
        rx = re.compile("|".join(patterns), re.I)
        lines = full_text.splitlines()
        hits, seen = [], set()
        for ln in lines:
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

    candidates = []  # pages that MIGHT need vision; the skill decides per page from the preview
    if scanned:
        note = ("PDF appears to be scanned (little/no text layer). Render all pages and "
                "vision-read them — there is no usable text.")
        cmd_hint = (f'pdftoppm -jpeg -r 110 -gray -f 1 -l {page_count} '
                    f'"{pdf}" {os.path.join(work, "p")}')
    else:
        for i in range(1, page_count + 1):
            chars = page_chars.get(i, 0)
            if i in pages_with_large_image and chars < IMAGE_PAGE_TEXT_CEILING:
                preview = re.sub(r"\s+", " ", pages[i-1]).strip()[:200] if i-1 < len(pages) else ""
                candidates.append({"page": i, "text_chars": chars, "preview": preview})
        if candidates:
            note = ("These pages carry a large graphic with little text — they MAY be figures "
                    "(floor plans, scans, diagrams) worth seeing. Check each preview: if the "
                    "text already conveys the page, skip it; only render the ones that are truly "
                    "image-only. Render command per page: "
                    f'pdftoppm -jpeg -r 110 -gray -f N -l N "{pdf}" {os.path.join(work, "pN")}')
        else:
            note = ("No image-based pages — the document's content is fully in the text layer. "
                    "Render nothing; read the text. (Fast path.)")
        cmd_hint = ""

    print(json.dumps({
        "ok": True,
        "pdf": pdf,
        "work_dir": work,
        "page_count": page_count,
        "text_file": text_file,
        "text_chars": total_chars,
        "scanned": scanned,
        "image_candidate_pages": candidates,
        "key_extracts": key_extracts,
        "note": note,
        "render_hint": cmd_hint,
    }, indent=2))

if __name__ == "__main__":
    main()
