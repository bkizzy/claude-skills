#!/usr/bin/env python3
"""Chat with Bonsai 2 27B on MLX.

  .venv/bin/python chat.py "your prompt"       one answer, then exit
  .venv/bin/python chat.py                     interactive chat (blank line or Ctrl+D to quit)
  options: --think   --max N   --image path
"""

import argparse
import sys
import time
from pathlib import Path

PACK = Path(__file__).resolve().parent / "bonsai2-27b-mlx"
sys.path.insert(0, str(PACK / "runtime"))

p = argparse.ArgumentParser()
p.add_argument("prompt", nargs="*")
p.add_argument("--think", action="store_true", help="let the model reason before answering")
p.add_argument("--max", type=int, default=1024, help="max tokens to generate")
p.add_argument("--image", help="path to an image to ask about")
args = p.parse_args()

from jinja2.sandbox import ImmutableSandboxedEnvironment
from mlx_vlm import stream_generate
from vision_artifact import load_vl_model

t0 = time.time()
model, processor, _ = load_vl_model(PACK)
print(f"[loaded in {time.time() - t0:.1f}s]", file=sys.stderr)

template = ImmutableSandboxedEnvironment(trim_blocks=True, lstrip_blocks=True).from_string(
    (PACK / "chat_template.jinja").read_text()
)
messages = []


def ask(text, image=None):
    content = [{"type": "image"}, {"type": "text", "text": text}] if image else text
    messages.append({"role": "user", "content": content})
    prompt = template.render(messages=messages, add_generation_prompt=True, enable_thinking=args.think)
    out, last = [], None
    for last in stream_generate(
        model, processor, prompt, [image] if image else None,
        max_tokens=args.max, temperature=1.0, top_p=0.95, top_k=20,
    ):
        print(last.text, end="", flush=True)
        out.append(last.text)
    messages.append({"role": "assistant", "content": "".join(out)})
    if last:
        print(
            f"\n[{last.generation_tokens} tokens at {last.generation_tps:.1f} tok/s | "
            f"prompt {last.prompt_tokens} tokens at {last.prompt_tps:.0f} tok/s | "
            f"peak memory {last.peak_memory:.1f} GB]",
            file=sys.stderr,
        )


if args.prompt:
    ask(" ".join(args.prompt), args.image)
else:
    while True:
        try:
            text = input("\nyou> ").strip()
        except EOFError:
            break
        if not text:
            break
        ask(text)
