# local-ai-mac

A private chat assistant that runs entirely on your Mac, set up by one script.

> **You do not need Claude, or any AI, to use this on a Mac.** `install.sh` is an
> ordinary shell script: run it in Terminal and it does everything. The skill in
> this folder (`SKILL.md`) is optional. It only lets an AI run that same script
> for you, if you happen to have one.

| Your computer | Without an AI | With an AI (the skill) |
| --- | --- | --- |
| Apple Silicon Mac (M1 or newer) | Run `install.sh`. Tested. | The cheapest model runs `install.sh` for you. |
| Windows, Linux, Intel Mac | Not supported: the script is Mac-only. | The AI follows [a guided install](./references/other-platforms.md) and adapts it to your machine. **Not tested.** |

## What you get

| Part | What it is |
| --- | --- |
| **Bonsai 2 27B** | The model. PrismML's compressed build of Qwen3.8-27B: 8.6 GB, reads images, optional "thinking" mode. |
| **Open WebUI** | The chat app, in your browser at http://127.0.0.1:8080. No login, and reachable only from your own Mac. |
| **Pocket TTS** | The voice that reads answers aloud (Kyutai). 27 voices. |
| **Voice input** | Speak instead of typing (Whisper, inside Open WebUI). |
| **Bonsai Chat** | An app in Applications. Open it to start everything; quit it to stop everything. |

Once it is installed, nothing you type or say leaves your computer.

## Install it without any AI

You need an **Apple Silicon Mac** (M1 or newer), **macOS 14+**, **16 GB of memory**
(24 GB or more is better) and about **20 GB of free disk space**. It does not
need an admin password, Homebrew, Python or an account anywhere.

Open **Terminal** (in Applications → Utilities), paste this, and press Return:

```bash
curl -fsSL https://raw.githubusercontent.com/bkizzy/claude-skills/main/local-ai-mac/install.sh | bash
```

It checks your Mac, tells you what it is about to do, and waits for you to press
Return. Then it downloads about 14 GB, so leave it running. When it finishes it
tests itself and opens the chat in your browser.

Prefer to look before you run? Download this repository (green **Code** button →
**Download ZIP**), unzip it, then:

```bash
bash ~/Downloads/claude-skills-main/local-ai-mac/install.sh
```

To see every step without changing anything, add `--simulate`.

### Using it afterwards

- **Start:** open **Bonsai Chat** from Applications. Your browser opens after about 20 seconds.
- **Stop:** quit Bonsai Chat (right-click its Dock icon → Quit). This frees the memory.
- **Voice:** use the microphone and speaker buttons in Open WebUI. Change the voice in Admin Settings → Audio.
- **Two models appear in the picker:** `bonsai-2-27b` answers straight away; `bonsai-2-27b-thinking` reasons first and is slower.
- **Speed:** about 10 tokens (roughly 7 words) a second on a recent Apple Silicon laptop. This is a real model on a laptop, not a data center.

## All the options

| Command | What it does |
| --- | --- |
| `bash install.sh` | Install. Run it again at any time to **repair**: it keeps your chats and only redoes what is missing. |
| `bash install.sh --check` | Test an existing install: files, the three servers, a real answer, and speech out and back in. |
| `bash install.sh --simulate` | Show every step and test that the downloads exist, but change nothing. |
| `bash install.sh --latest` | Install the newest versions of everything instead of the tested ones (see below). |
| `bash install.sh --uninstall` | Remove everything it installed, including your Open WebUI chats. Asks you to type `delete`. |
| `--yes` | Do not stop to ask. |
| `LOCAL_AI_DIR=/some/folder bash install.sh` | Install somewhere other than `~/Local AI`. Use the same setting for every later command. |

Every run ends with one line starting `RESULT:` (it worked, or what state things
are in) or `STOPPED:` (why it could not go on, and what to do).

## Tested versions, and `--latest`

By default the script installs the exact versions that were tested together on
2026-11-17, and no package released after that date:

| Part | Version |
| --- | --- |
| Model | `prism-ml/Ternary-Bonsai-2-27B-mlx-2bit` at revision `24b5937a` |
| Model runtime | whatever that revision's own `runtime/requirements.txt` pins (MLX 0.32.0, mlx-vlm 0.6.3, transformers 5.5.0) |
| Open WebUI | 0.13.3, with `av` held below 19 |
| Pocket TTS | 4.0.1 |
| Python | 3.12, downloaded by `uv` |

This is deliberate: these projects move quickly, and a newer release of one can
break another. (That already happened once. Open WebUI 0.13.3 with `av` 19 fails
on voice input, which is why `av` is held back.)

`--latest` drops all of those pins: newest model revision, newest packages. The
script then runs its self-test. If the test fails, run the script again without
`--latest` and it returns to the tested versions.

## What it puts on your Mac

Everything is in one folder, `~/Local AI`, plus the app:

| Path | Contents |
| --- | --- |
| `~/Local AI/bonsai/` | The model, its Python environment, the model server (`server.py`, port 8765) and a simple chat page. |
| `~/Local AI/open-webui/` | Open WebUI, its Python environment, `start.sh` with its settings, and `data/` (your chats). |
| `~/Local AI/pocket-tts/` | Pocket TTS, its Python environment, and a small server that speaks Open WebUI's audio format (port 8767). |
| `~/Local AI/bin/`, `.python/`, `.uv-cache/` | `uv` and the Python it downloaded. Only present if you did not already have `uv`. |
| `/Applications/Bonsai Chat.app` | The launcher. It goes in `~/Applications` if your account cannot write to `/Applications`. |

It does not change your shell profile, install Homebrew, or use `sudo`. The
Pocket TTS voice model is cached in `~/.cache/huggingface`, which the uninstaller
leaves alone because other programs may share it.

## Using the skill instead (optional)

If you use Claude Code, link this folder into your skills and ask for it:

```bash
ln -s ~/code/claude-skills/local-ai-mac ~/.claude/skills/local-ai-mac
```

Then say "install local AI on this Mac", "is my local AI working?", or type
`/local-ai-mac`. The skill is written so that the cheapest model (Haiku) can run
it: it picks the right option, runs `install.sh`, and reports the `RESULT:` line.
It does nothing the script cannot do on its own.

## Windows, Linux and Intel Macs

`install.sh` only works on Apple Silicon Macs, for two reasons: it installs the
model through MLX, which exists nowhere else, and it builds a macOS app.

With an AI, the same setup can be built on other computers. The skill sends it to
[`references/other-platforms.md`](./references/other-platforms.md), which keeps
Open WebUI and Pocket TTS exactly as on the Mac, swaps the model server for
llama.cpp running the GGUF build of the same model, and replaces the app with
start and stop scripts. It ends with ten tests that define "working". This needs a
capable model, not the cheapest one, because it has to adapt to the machine.

That guide has **not been run** on Windows or Linux. It was written from each
project's documentation on 2026-11-17. Without a GPU the model will be slow.

## Files

| Path | Role |
| --- | --- |
| `install.sh` | The installer, checker, repairer and uninstaller. Works alone. |
| `SKILL.md` | Instructions for an AI: which `install.sh` option to run and how to read the result. |
| `references/other-platforms.md` | Instructions for an AI installing on Windows, Linux or an Intel Mac, where `install.sh` cannot be used. |
| `files/` | What gets copied into `~/Local AI`: the model server and chat page, the Open WebUI start script, the Pocket TTS server, and the Bonsai Chat app's source and icon. |

## What has and has not been tested

- **Tested:** every step in simulation, including on a bare `PATH` with no
  Homebrew, Python or `uv`; the self-test, the launcher app, repair detection and
  uninstall against a working copy in a separate folder; chat, read-aloud and
  voice input through a freshly created Open WebUI, with no ffmpeg present.
  Image questions were tested on the install these files were taken from.
- **Not yet tested:** a complete install on a Mac that has never had any of this.
  The download-and-install steps were only simulated (the packages were resolved,
  not installed).
- **Not tested at all:** the Windows, Linux and Intel Mac guide.

## Where it will rot

- **The pinned versions.** If Hugging Face or PyPI stop serving them, the default
  install fails with "cannot be installed as listed"; use `--latest`.
- **The model's loader.** The model only loads through the loader bundled in its
  own download. `server.py` imports `vision_artifact.load_vl_model` from it; a new
  model revision that renames it breaks `--latest`.
- **Open WebUI's settings.** `start.sh` sets them through environment variables,
  which Open WebUI reads on first start only. A release that renames one silently
  loses that setting.
- **Pocket TTS's voice list.** `pocket-tts/server.py` reads it from a private
  name inside the package (`_ORIGINS_OF_PREDEFINED_VOICES`).
- **Ports 8765, 8767 and 8080** are fixed. The installer stops with a clear
  message if another program is using one.

## Licenses

The script downloads each part from its own publisher, under that part's own
license: Bonsai 2 27B (Apache 2.0, Prism ML; built from Qwen3.8-27B, Apache 2.0,
Alibaba Cloud), Open WebUI (its own license; see their repository), Pocket TTS
(Kyutai; each voice has its own license, listed at
https://huggingface.co/kyutai/tts-voices). The files in this folder are MIT, like
the rest of this repository.
