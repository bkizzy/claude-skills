---
name: local-ai-mac
description: Install, check, repair, update or remove "Local AI", a private chat assistant that runs entirely on the user's own computer (Bonsai 2 27B model + Open WebUI + Pocket TTS voice + a launcher). On an Apple Silicon Mac it runs the bundled install.sh script; on Windows, Linux or an Intel Mac it follows a guided install instead. Invoked as /local-ai-mac. Use whenever the user says "install local AI", "set up Bonsai / Open WebUI / a local model on my Mac or PC", "is my local AI working", "Bonsai Chat is broken / won't start", "update my local AI", or "uninstall local AI".
---

# local-ai-mac

## First: which computer is this?

Run `uname -sm`.

- It prints `Darwin arm64` → an Apple Silicon Mac. Use **this page**. Everything
  below is for this case.
- It prints anything else, or the command does not exist (Windows) → **stop
  reading this page** and follow `references/other-platforms.md` instead.
  `install.sh` does not work there. That guide is a hands-on install that needs
  judgment: do it on a capable model, and do not hand it to the cheapest one.

## On an Apple Silicon Mac

`install.sh`, in the same folder as this file, does all of the work. Your job is
only to **run it with the right option and report its last line**. It also runs
on its own, without you: see `README.md`.

## Rules

1. Run only the commands on this page. Do not edit files, install other things,
   or try to fix a failure by hand.
2. Before an **install** or an **uninstall**, tell the user what will happen
   (see the table) and wait for a clear "yes". For everything else, just run it.
3. Every run ends with a line starting `RESULT:` or `STOPPED:`. That line is the
   answer. Report it to the user in plain words.
4. If you can start a subagent, give this whole job to one on the cheapest model
   (`model: "haiku"`) and pass it this file's folder path. Nothing here needs a
   stronger model.

## Which command

`DIR` is the folder this file is in. Keep the quotes: paths can contain spaces.

| The user wants | Tell them first | Command |
| --- | --- | --- |
| to know if it will work | nothing | `bash "DIR/install.sh" --simulate` |
| to install | downloads about 14 GB, needs 20 GB of disk, takes a while, no password needed | `bash "DIR/install.sh" --yes` |
| to know if it is working | nothing | `bash "DIR/install.sh" --check` |
| to fix it | nothing; chats and settings are kept | `bash "DIR/install.sh" --yes` |
| the newest versions | nothing; chats and settings are kept | `bash "DIR/install.sh" --latest --yes` |
| to remove it | deletes the model, the app and **all Open WebUI chats** | `bash "DIR/install.sh" --uninstall --yes` |

If the user installed somewhere other than `~/Local AI`, put
`LOCAL_AI_DIR="/that/folder"` in front of the command, every time.

## Installing, step by step

1. Run the `--simulate` command. It takes about a minute and changes nothing.
   - Last line `RESULT: SIMULATION OK` → go to step 2.
   - Last line `STOPPED: ...` → look it up under "When it stops". Do not install.
2. Tell the user what the install does and wait for "yes".
3. Run the install **in the background**, writing to a log, because it can take
   longer than a command is allowed to run:

   ```bash
   bash "DIR/install.sh" --yes > /tmp/local-ai-install.log 2>&1
   ```

   Use `run_in_background: true`. When it finishes, read the end of the log:

   ```bash
   tail -n 30 /tmp/local-ai-install.log
   ```

   If you cannot run in the background and the command is cut off, **run the
   same command again**. It carries on from where it stopped; nothing is
   downloaded twice.
4. Report the last line.
   - `RESULT: OK` → tell the user: Open WebUI is open in their browser. From now
     on they open **Bonsai Chat** from Applications to start it and quit Bonsai
     Chat to stop it.
   - anything else → "When it stops" below.

"Fix it" and "newest versions" are the same steps 3 and 4 with their own command.

## What the last line means

| Last line | What to do |
| --- | --- |
| `RESULT: OK` | Working. Say so. |
| `RESULT: SIMULATION OK` | It can be installed. Nothing was changed. |
| `RESULT: INSTALLED, NOT RUNNING` | Not a fault. Run `open -a "Bonsai Chat"`, wait 60 seconds, run `--check` again. |
| `RESULT: INCOMPLETE` | Something is missing. Run the "fix it" command. |
| `RESULT: PROBLEM` | Follow "When something is wrong" below. |
| `RESULT: REMOVED` | Uninstalled. |
| `STOPPED: ...` | See "When it stops". |

## When it stops

Find the words from the `STOPPED:` line in the left column.

| The line says | What to do |
| --- | --- |
| `needs a Mac with Apple Silicon` | It cannot run on this Mac. Tell the user and stop. |
| `macOS 14 or newer is needed` | The user must update macOS first. Tell them and stop. |
| `needs 16 GB of memory` | It cannot run on this Mac. Tell the user and stop. |
| `free disk space is needed` | The user must free up disk space, then you run the command again. |
| `port ... is in use by another program` | The line names the program. Ask the user to quit it, then run the command again. Do not stop that program yourself. |
| `cannot reach`, `cannot find`, `cannot read` or `could not download` | Internet problem. Wait a minute and run the same command again. |
| `cannot be installed as listed` | The tested versions are no longer available. Run the same command with `--latest` added. |
| `did not start within` | Run the same command again once. If it stops again, show the user the log (below). |
| `the step above failed` | Run the same command again once. If it fails again, show the user the last 30 lines of output. |
| `there is no terminal to ask on` | You forgot `--yes`. Add it. |

## When something is wrong

Do these in order. Stop as soon as `--check` ends with `RESULT: OK`.

1. Restart it, then check:

   ```bash
   osascript -e 'tell application "Bonsai Chat" to quit'
   ```

   ```bash
   open -a "Bonsai Chat"
   ```

   Wait 60 seconds, then run the `--check` command.
2. Run the "fix it" command (`bash "DIR/install.sh" --yes`).
3. If the user had asked for the newest versions, run the "fix it" command
   without `--latest`: it goes back to the versions that were tested together.
4. Still not OK: show the user the `FAILED` lines and the end of these logs,
   and stop. Do not try anything else.

   ```bash
   tail -n 20 ~/"Local AI"/bonsai/server.log ~/"Local AI"/pocket-tts/server.log ~/"Local AI"/open-webui/webui.log
   ```

## Facts you may be asked

- Chat page: http://127.0.0.1:8080 (Open WebUI). A simpler page is at http://127.0.0.1:8765.
- Start: open Bonsai Chat from Applications. Stop: quit Bonsai Chat.
- Nothing is sent to the internet when chatting. It only works on this Mac; other devices cannot reach it.
- Everything lives in `~/Local AI`, plus the Bonsai Chat app.
- There is no login. Settings are in Open WebUI under Admin Settings.
- The voice can be changed in Open WebUI: Admin Settings → Audio → TTS Voice.
