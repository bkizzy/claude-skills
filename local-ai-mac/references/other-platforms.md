# Local AI on Windows, Linux or an Intel Mac

Read this when the computer is **not** an Apple Silicon Mac. `install.sh` cannot be
used there: it installs the model through MLX, which only exists on Apple Silicon,
and it builds a macOS app.

This is a guided install that **you** carry out, adapting to the machine. It needs
judgment, so do it on a capable model; do not hand it to the cheapest one.

> **Status: not tested.** The Mac install was built and tested. This page is the
> same design carried over to other systems from each project's documentation, as
> of 2026-11-17. Treat every command as a starting point, confirm it against the
> source it names, and let the tests at the end decide whether you are done.

## What "the same result" means

Three local servers, reachable only from this computer, and one thing to click:

| Part | Address | On other platforms |
| --- | --- | --- |
| The model | `http://127.0.0.1:8765/v1` (OpenAI-compatible), model id `bonsai-2-27b` | **Different from the Mac:** llama.cpp's `llama-server` running the GGUF build of the same model. |
| The voice | `http://127.0.0.1:8767/v1` | Same as the Mac: Pocket TTS behind `files/pocket-tts/server.py`. |
| The chat app | `http://127.0.0.1:8080` | Same as the Mac: Open WebUI with the settings in `files/open-webui/start.sh`. |
| The launcher | starts all three, opens the browser; stopping it stops all three | **Different from the Mac:** a start script and a stop script, plus a shortcut. |

Keep the three ports and the model id exactly as shown. The settings and the tests
depend on them.

## Before you start

1. Tell the user what this involves and get a clear "yes": about 12 GB of
   downloads, three background programs, files in one folder of their choosing
   (suggest `Local AI` in their home folder). Ask before installing anything
   system-wide (a package manager, GPU drivers, a compiler).
2. Check the machine and tell the user what to expect:
   - 16 GB of memory at the least, and 20 GB of free disk.
   - A GPU with about 10 GB of memory or more gives a usable speed. Without one
     it runs on the processor and is much slower.
   - Ports 8765, 8767 and 8080 must be free. If one is taken, ask the user to
     quit that program; do not stop it yourself.
3. Read the model publisher's own instructions first. They say they are the
   source of truth and they are newer than this page:
   https://github.com/PrismML-Eng/Bonsai-demo and the model card at
   https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf (including its
   `KNOWN_ISSUES.md`). Where they disagree with this page, they win.

## 1. Python environments

Use [`uv`](https://docs.astral.sh/uv/getting-started/installation/) so that no
system Python is needed. Make one environment each for Open WebUI and Pocket TTS,
both on **Python 3.12** (Open WebUI does not support 3.13 or newer).

Install these versions, which were tested together, with no package released after
2026-11-18 (`--exclude-newer 2026-11-18`):

| Environment | Packages |
| --- | --- |
| `open-webui/.venv` | `open-webui==0.13.3` and `av<19` (av 19 breaks voice input in this Open WebUI) |
| `pocket-tts/.venv` | `pocket-tts==4.0.1` and `soundfile` |

On Linux, install Pocket TTS with the CPU build of PyTorch, or it pulls several
gigabytes of GPU libraries it does not use. Its README has the exact option
("CPU-only installation"): https://github.com/kyutai-labs/pocket-tts

If those versions can no longer be downloaded, install the newest ones instead and
rely on the tests at the end.

## 2. The model

1. Get llama.cpp. Use a prebuilt release for this system and its GPU from
   https://github.com/ggml-org/llama.cpp/releases (look at the release's file list;
   do not guess a file name).
   **It must be build b11556 or newer. An older build loads this model without any
   warning and produces nonsense.** Check with `llama-server --version`.
2. Download two files from `prism-ml/Ternary-Bonsai-2-27B-gguf` (tested revision
   `839bd57023c1558945afea70a74fa83c054f35f9`):
   - `Ternary-Bonsai-2-27B-Q2_0.gguf` (7.6 GB): the model, in the packing that
     standard llama.cpp can run.
   - `Ternary-Bonsai-2-27B-mmproj-Q8_0.gguf` (0.6 GB): lets it read images.

   The other packings in that repository (`PQ2_0`, `PTQ1_0`) are faster on NVIDIA
   cards but need PrismML's own llama.cpp build. Only use them if the user wants
   the extra speed and Bonsai-demo's instructions cover this machine.
3. Run it as a server. Confirm each option against `llama-server --help`:

   ```
   llama-server -m Ternary-Bonsai-2-27B-Q2_0.gguf --mmproj Ternary-Bonsai-2-27B-mmproj-Q8_0.gguf
                --alias bonsai-2-27b --host 127.0.0.1 --port 8765
                -ngl 99 -c 32768 --temp 1.0 --top-p 0.95 --top-k 20
   ```

   `-ngl 99` puts the whole model on the GPU; lower it, or use `0`, if it does not fit.
4. **Thinking.** This model reasons before it answers unless told not to, and the
   reasoning uses up the answer's length limit. The Mac install answers straight
   away by default and offers a second, slower "thinking" model. To match it:
   - Make plain requests answer without reasoning. The model card says to leave
     the server at `--reasoning auto` and send `reasoning_effort: "none"`; check
     `llama-server --help` and Bonsai-demo for a way to make that the default.
     This matters because Open WebUI also uses the model to write chat titles.
   - Never set a small output limit. If answers come back empty, the limit ran
     out during reasoning: see `KNOWN_ISSUES.md`.
   - A separate "thinking" choice in Open WebUI is optional. One way is a second
     model entry in Open WebUI (Workspace → Models) based on `bonsai-2-27b` with a
     higher reasoning effort.

`files/bonsai/` (the Mac's model server, simple chat page and app) is **not** used
on other platforms. There is no simple chat page at port 8765; `llama-server` shows
its own page there instead.

## 3. The voice

Copy `files/pocket-tts/server.py` into the `pocket-tts` folder and run it with that
environment's Python. It needs no changes: it listens on `127.0.0.1:8767` and
returns MP3, so nothing needs ffmpeg. Its first start downloads the voice model.

## 4. The chat app

`files/open-webui/start.sh` is the list of settings. Set **every** `export` line in
it as an environment variable in this system's own syntax, set `DATA_DIR` to a
`data` folder inside the `open-webui` folder, then run:

```
open-webui serve --host 127.0.0.1 --port 8080
```

Two things to keep exactly:

- `--host 127.0.0.1`. There is no login (`WEBUI_AUTH=False`), so it must not be
  reachable from the network. Never use `0.0.0.0`.
- These settings are only read the **first** time Open WebUI starts with an empty
  `data` folder. If you started it before setting them, stop it, delete that new
  `data` folder, and start again.

The first start downloads a small search model and can take several minutes.

## 5. Start and stop

Write two small scripts in the install folder, in the system's own language
(PowerShell or a batch file on Windows, a shell script on Linux):

- **Start:** for each of the three servers that is not already answering, start it
  in the background with its output going to a log file in its own folder, and
  remember its process id. Wait until the model and the chat app answer, then open
  `http://127.0.0.1:8080` in the default browser.
- **Stop:** stop exactly the processes the start script started (by the ids it
  saved), nothing else. Never stop processes by a loose name match.

Then give the user something to click: a shortcut to the start script on the
Desktop or Start menu (Windows), or a `.desktop` entry (Linux), and tell them how
to stop it. Do not set it to start with the computer unless the user asks.

## 6. Tests: you are done when all of these pass

Run them yourself and show the user the results. `curl` exists on Windows 10 and
newer (`curl.exe`), Linux and macOS.

| # | Test | Passes when |
| --- | --- | --- |
| 1 | `GET http://127.0.0.1:8765/v1/models` | 200, and the list contains `bonsai-2-27b` |
| 2 | `POST http://127.0.0.1:8765/v1/chat/completions` with `{"model":"bonsai-2-27b","messages":[{"role":"user","content":"Say hello."}]}` | the reply's `content` is a sensible, non-empty sentence, within a few seconds on a GPU |
| 3 | `POST http://127.0.0.1:8767/v1/audio/speech` with `{"voice":"alba","input":"The quick brown fox jumps over the lazy dog."}` | 200 with content type `audio/mpeg` |
| 4 | `GET http://127.0.0.1:8080/health` | 200 |
| 5 | In Open WebUI: start a chat with `bonsai-2-27b` | it answers, and the chat gets a title |
| 6 | In Open WebUI: press the read-aloud button under an answer | you get audio back (the request to `/api/v1/audio/speech` returns 200) |
| 7 | In Open WebUI: attach a picture and ask what it shows | it describes the picture |
| 8 | From another device on the same network, open `http://<this computer's address>:8080` | it does **not** load |
| 9 | Run the stop script | ports 8765, 8767 and 8080 are all free again |
| 10 | Run the start script again | everything comes back and earlier chats are still there |

Tests 3, 4 and 6 can be scripted the way `install.sh` does it in its `check`
function: read that function for the exact requests, including how it signs in to
Open WebUI when there is no login.

## When you finish

Tell the user plainly: how to start it, how to stop it, the folder everything is
in, how fast it turned out to be on their hardware, and anything from the table
above that did not pass or that you could not test.

To remove it later: run the stop script, then delete the install folder and the
shortcut. Nothing else was changed, unless you installed something system-wide in
"Before you start", in which case say what.
