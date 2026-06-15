#!/usr/bin/env python3
"""Launch the annotation viewer and capture the notes automatically.

Builds the self-contained viewer for a PDF, serves it from an ephemeral
localhost-only server, opens it in the browser, and waits for the user to press
the checkmark. When they do, the viewer POSTs the notes back; this script writes
them to ``<pdf-basename>.notes.json`` next to the PDF and exits — no manual save.

Designed to be run as a background task: it blocks until the notes arrive (or it
times out), then prints ``NOTES_SAVED: <path>`` and exits 0 so Claude can read
the file and act on the notes immediately.

Usage:
    python3 annotate.py <input.pdf> [--timeout SECONDS]
"""
import argparse
import http.server
import os
import socketserver
import sys
import threading
import time
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_viewer import build_html  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", help="Path to the PDF to annotate")
    ap.add_argument("--timeout", type=int, default=3600,
                    help="Seconds to wait for notes before giving up (default 3600)")
    ap.add_argument("--port", type=int, default=0,
                    help="Port to serve on (default 0 = ephemeral). Use a fixed port to "
                         "show the viewer in the Claude preview pane.")
    ap.add_argument("--no-browser", action="store_true",
                    help="Don't open the system browser (e.g. when showing it in Claude's preview).")
    args = ap.parse_args()

    pdf_path = os.path.abspath(args.pdf)
    if not os.path.isfile(pdf_path):
        sys.exit(f"error: PDF not found: {pdf_path}")

    serve_dir = os.path.dirname(pdf_path)
    base = os.path.splitext(os.path.basename(pdf_path))[0]
    html_name = base + ".annotate.html"
    notes_path = os.path.join(serve_dir, base + ".notes.json")

    with open(os.path.join(serve_dir, html_name), "w") as f:
        f.write(build_html(pdf_path))

    state = {"done": False}

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=serve_dir, **k)

        def log_message(self, *a):
            pass  # keep the background output clean

        def do_POST(self):
            if self.path.rstrip("/") == "/notes":
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length)
                with open(notes_path, "wb") as fh:
                    fh.write(body)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
                state["done"] = True
                threading.Thread(target=self._shutdown, daemon=True).start()
            else:
                self.send_response(404)
                self.end_headers()

        def _shutdown(self):
            time.sleep(0.3)  # let the response flush before we tear down
            httpd.shutdown()

    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", args.port), Handler)
    port = httpd.server_address[1]
    url = f"http://127.0.0.1:{port}/{html_name}"
    print(f"SERVING: {url}", flush=True)

    def guard():
        time.sleep(args.timeout)
        if not state["done"]:
            httpd.shutdown()
    threading.Thread(target=guard, daemon=True).start()

    if not args.no_browser:
        webbrowser.open(url)
    httpd.serve_forever()

    if state["done"]:
        print(f"NOTES_SAVED: {notes_path}", flush=True)
        sys.exit(0)
    print("TIMEOUT: no notes received", flush=True)
    sys.exit(2)


if __name__ == "__main__":
    main()
