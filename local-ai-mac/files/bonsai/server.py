#!/usr/bin/env python3
"""Local server for Bonsai 2 27B: a chat page plus an OpenAI-compatible API.

  .venv/bin/python server.py

  chat page   http://127.0.0.1:8765
  API         http://127.0.0.1:8765/v1     models: bonsai-2-27b, bonsai-2-27b-thinking

One model, one generation at a time: requests queue for a single worker thread,
which also loads the model, because MLX wants it used on the thread that loaded it.
"""

import base64
import json
import os
import queue
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path

HERE = Path(__file__).resolve().parent
PACK = HERE / "bonsai2-27b-mlx"
HOST, PORT = "127.0.0.1", int(os.environ.get("BONSAI_PORT", 8765))
ORIGINS = (None, f"http://{HOST}:{PORT}", f"http://localhost:{PORT}")
MAX_TOKENS = 4096
MAX_EDGE = 1024  # images are shrunk to this long side; larger ones take minutes to read
MODELS = {"bonsai-2-27b": False, "bonsai-2-27b-thinking": True}  # API model id -> think before answering

sys.path.insert(0, str(PACK / "runtime"))

# Bind first, so a second copy fails here instead of after loading 9 GB.
httpd = ThreadingHTTPServer((HOST, PORT), None)
httpd.daemon_threads = True
jobs = queue.Queue()


def worker():
    from jinja2.sandbox import ImmutableSandboxedEnvironment
    from mlx_vlm import stream_generate
    from mlx_vlm.generate import PromptCacheState
    from vision_artifact import load_vl_model

    model, processor, _ = load_vl_model(PACK)
    template = ImmutableSandboxedEnvironment(trim_blocks=True, lstrip_blocks=True).from_string(
        (PACK / "chat_template.jinja").read_text()
    )
    cache = PromptCacheState()  # the previous turns' context, so a follow-up only reads the new text
    print(f"Bonsai ready at http://{HOST}:{PORT}", flush=True)

    while True:
        job, out, cancelled = jobs.get()
        if cancelled.is_set():
            out.put(None)
            continue
        finished = False
        try:
            prompt = template.render(
                messages=job["messages"], add_generation_prompt=True, enable_thinking=job["think"]
            )
            for result in stream_generate(
                model, processor, prompt, job["images"] or None,
                max_tokens=job["max_tokens"], temperature=job["temperature"], top_p=job["top_p"], top_k=20,
                prompt_cache_state=cache if job["keep_context"] else None,
            ):
                if cancelled.is_set():
                    break
                out.put(result)
            else:
                finished = True
        except Exception as e:
            out.put(e)
        if job["keep_context"] and not finished:
            cache = PromptCacheState()  # cut short (Stop, or an error): the half-written context is unusable
        out.put(None)


def generate(messages, images, think, keep_context=True, max_tokens=None, temperature=None, top_p=None):
    """Queue a generation for the worker and yield its results as they arrive."""
    job = {
        "messages": messages, "images": images, "think": think, "keep_context": keep_context,
        "max_tokens": max_tokens or MAX_TOKENS,
        "temperature": 1.0 if temperature is None else temperature,
        "top_p": 0.95 if top_p is None else top_p,
    }
    out, cancelled = queue.Queue(), threading.Event()
    jobs.put((job, out, cancelled))
    try:
        while (result := out.get()) is not None:
            if isinstance(result, Exception):
                raise result
            yield result
    finally:
        cancelled.set()  # the reader went away (Stop pressed): tell the worker to drop the job


def shrink(url):
    """Check an uploaded image is inline data, and return it no larger than MAX_EDGE."""
    from PIL import Image, ImageOps

    # Inline data only: the model's image loader would otherwise fetch URLs and read local paths.
    if not url.startswith("data:image/"):
        raise ValueError("images must be sent inline, as data: URLs")
    image = ImageOps.exif_transpose(Image.open(BytesIO(base64.b64decode(url.split(",", 1)[1]))))
    if max(image.size) <= MAX_EDGE:
        return url
    image = image.convert("RGB")
    image.thumbnail((MAX_EDGE, MAX_EDGE))
    buf = BytesIO()
    image.save(buf, "JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def page_messages(messages):
    """The chat page's messages -> template messages plus the attached images, in order."""
    out, images = [], []
    for m in messages:
        if m.get("image"):
            images.append(shrink(m["image"]))
            m = {**m, "content": [{"type": "image"}, {"type": "text", "text": m["content"]}]}
        out.append(m)
    return out, images


def openai_messages(messages):
    """OpenAI-style messages -> template messages plus the attached images, in order."""
    out, images = [], []
    for m in messages:
        content = m.get("content") or ""
        if isinstance(content, list):
            parts = []
            for part in content:
                if part.get("type") == "image_url":
                    images.append(shrink(part["image_url"]["url"]))
                    parts.append({"type": "image"})
                elif part.get("type") == "text":
                    parts.append({"type": "text", "text": part["text"]})
            content = parts
        out.append({"role": m["role"], "content": content})
    return out, images


def split_thinking(texts, think):
    """Label streamed text as ("reasoning", ...) up to </think>, then ("content", ...)."""
    buf, tag = "", "</think>"
    for text in texts:
        if not think:
            yield "content", text
            continue
        buf += text
        i = buf.find(tag)
        if i >= 0:
            think = False
            if buf[:i].strip():
                yield "reasoning", buf[:i]
            if buf[i + len(tag):].lstrip():
                yield "content", buf[i + len(tag):].lstrip()
        elif len(buf) >= len(tag):  # hold back a possible partial tag
            yield "reasoning", buf[: 1 - len(tag)]
            buf = buf[1 - len(tag):]
    if think and buf:
        yield "reasoning", buf


class Handler(BaseHTTPRequestHandler):
    timeout = 10  # drop a browser's idle spare connections

    def log_message(self, *args):
        pass

    def reply(self, code, body=b"", ctype="text/plain"):
        if not isinstance(body, bytes):
            body, ctype = json.dumps(body).encode(), "application/json"
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def start_stream(self, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_GET(self):
        if self.path == "/":
            self.reply(200, (HERE / "chat.html").read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/v1/models":
            self.reply(200, {"object": "list", "data": [
                {"id": name, "object": "model", "created": 0, "owned_by": "local"} for name in MODELS
            ]})
        else:
            self.reply(404)

    def do_POST(self):
        # Only the chat page and local programs may drive the model; other sites open in the browser may not.
        if self.headers.get("Origin") not in ORIGINS:
            return self.reply(403)
        if self.path == "/quit":
            self.reply(200, b"bye")
            return threading.Thread(target=httpd.shutdown, daemon=True).start()
        handler = {"/chat": self.page_chat, "/v1/chat/completions": self.api_chat}.get(self.path)
        if not handler:
            return self.reply(404)
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            handler(body)
        except (KeyError, TypeError, ValueError) as e:  # a malformed request, caught before any output
            self.reply(400, {"error": {"message": str(e)}})

    def page_chat(self, body):
        messages, images = page_messages(body["messages"])
        results = generate(messages, images, bool(body.get("think")))
        self.start_stream("application/x-ndjson")

        def send(obj):
            self.wfile.write(json.dumps(obj).encode() + b"\n")
            self.wfile.flush()

        last = None
        try:
            for last in results:
                send({"t": last.text})
            if last:
                send({"stats": {
                    "tokens": last.generation_tokens, "tps": round(last.generation_tps, 1),
                    "prompt_tokens": last.prompt_tokens, "cached": last.cached_tokens,
                }})
        except OSError:
            pass  # the page pressed Stop
        except Exception as e:
            try:
                send({"error": str(e)})
            except OSError:
                pass
        finally:
            results.close()

    def api_chat(self, body):
        name = body.get("model")
        think = MODELS.get(name, False)
        stream = bool(body.get("stream"))
        messages, images = openai_messages(body["messages"])
        # Only streamed chats keep context: one-off requests (titles and the like) must not evict it.
        results = generate(
            messages, images, think, keep_context=stream,
            max_tokens=body.get("max_tokens") or body.get("max_completion_tokens"),
            temperature=body.get("temperature"), top_p=body.get("top_p"),
        )
        last, started = None, False

        def texts():
            nonlocal last
            for last in results:
                yield last.text

        def usage():
            return {"prompt_tokens": last.prompt_tokens, "completion_tokens": last.generation_tokens,
                    "total_tokens": last.total_tokens} if last else None

        base = {"id": "chatcmpl-" + uuid.uuid4().hex, "created": int(time.time()), "model": name}
        try:
            if not stream:
                parts = {"reasoning": [], "content": []}
                for kind, text in split_thinking(texts(), think):
                    parts[kind].append(text)
                message = {"role": "assistant", "content": "".join(parts["content"])}
                if parts["reasoning"]:
                    message["reasoning_content"] = "".join(parts["reasoning"])
                return self.reply(200, {**base, "object": "chat.completion", "usage": usage(), "choices": [
                    {"index": 0, "message": message, "finish_reason": last.finish_reason if last else "stop"}
                ]})

            self.start_stream("text/event-stream")
            started = True

            def send(delta, finish=None, **extra):
                chunk = {**base, "object": "chat.completion.chunk", **extra,
                         "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
                self.wfile.write(b"data: " + json.dumps(chunk).encode() + b"\n\n")
                self.wfile.flush()

            send({"role": "assistant", "content": ""})
            for kind, text in split_thinking(texts(), think):
                send({"reasoning_content" if kind == "reasoning" else "content": text})
            send({}, finish=(last.finish_reason if last else None) or "stop", usage=usage())
            self.wfile.write(b"data: [DONE]\n\n")
        except OSError:
            pass  # the client went away
        except Exception as e:
            error = {"error": {"message": str(e)}}
            try:
                if started:
                    self.wfile.write(b"data: " + json.dumps(error).encode() + b"\n\n")
                else:
                    self.reply(500, error)
            except OSError:
                pass
        finally:
            results.close()


httpd.RequestHandlerClass = Handler
threading.Thread(target=worker, daemon=True).start()
httpd.serve_forever()
os._exit(0)  # /quit: leave at once, even mid-generation
