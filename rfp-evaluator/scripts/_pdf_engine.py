#!/usr/bin/env python3
"""PDF engine selection for the rfp-evaluator scripts.

Prefer **poppler** (fast CLI tools, and the harness's own Read tool uses them too)
when it's on PATH. Otherwise fall back to **pypdfium2** — a pip wheel that bundles
PDFium (Chromium's PDF engine), so it needs no Homebrew/admin and works anywhere
Python does. The fallback bootstraps a small venv at ~/.virtualenvs/rfp-pdf and
re-execs the calling script under it so pypdfium2 is importable.

Set RFP_ENGINE=pdfium to force the fallback (used for testing).
"""
import os, sys, shutil, subprocess, json

VENV = os.path.expanduser("~/.virtualenvs/rfp-pdf")

def find_bin(name):
    p = shutil.which(name)
    if p:
        return p
    for d in ("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"):
        c = os.path.join(d, name)
        if os.path.exists(c):
            return c
    return None

def poppler_available():
    if os.environ.get("RFP_ENGINE") == "pdfium":
        return False  # forced fallback
    return bool(find_bin("pdftotext") and find_bin("pdftoppm"))

def _fail(msg):
    print(json.dumps({"ok": False, "error": msg, "needs_install": True}))
    sys.exit(0)

def ensure_pdfium():
    """Make `import pypdfium2` work in-process; bootstrap a venv + re-exec if needed."""
    try:
        import pypdfium2  # noqa: F401
        return
    except ImportError:
        pass
    if os.environ.get("RFP_REEXEC") == "1":
        _fail("pypdfium2 still unavailable after install attempt")
    vpy = os.path.join(VENV, "bin", "python")
    try:
        if not os.path.exists(vpy):
            subprocess.run([sys.executable, "-m", "venv", VENV], check=True, capture_output=True)
        if subprocess.run([vpy, "-c", "import pypdfium2"], capture_output=True).returncode != 0:
            subprocess.run([vpy, "-m", "pip", "install", "-q", "pypdfium2"], check=True, capture_output=True)
    except Exception as e:
        _fail(f"could not bootstrap pypdfium2 (pip install failed): {e}")
    # Re-run this same script under the venv's python, which now has pypdfium2.
    os.execve(vpy, [vpy, os.path.abspath(sys.argv[0])] + sys.argv[1:],
              dict(os.environ, RFP_REEXEC="1"))
