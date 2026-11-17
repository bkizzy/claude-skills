#!/bin/bash
# Local AI for Mac: a private chat assistant that runs entirely on this computer.
#
#   Bonsai 2 27B (the model) + Open WebUI (the chat app) + Pocket TTS (the voice)
#   + "Bonsai Chat" in Applications, which starts and stops all of it.
#
# No AI, account or admin password is needed to run this. See README.md.
set -Eeuo pipefail

usage() {
	cat <<'EOF'
Local AI for Mac

  bash install.sh               install, or repair an existing install (safe to run again)
  bash install.sh --check       test an existing install
  bash install.sh --simulate    show every step and test the downloads, but change nothing
  bash install.sh --latest      install the newest versions instead of the tested ones
  bash install.sh --uninstall   remove everything this script installed

  --yes     do not stop to ask before installing or uninstalling
  LOCAL_AI_DIR=/some/folder     install somewhere other than "~/Local AI"

Needs an Apple Silicon Mac (M1 or newer), macOS 14+, 16 GB of memory (24 GB or more
is better) and about 20 GB of free disk space. On Windows, Linux or an Intel Mac this
script does not work; see references/other-platforms.md.
EOF
}

# ---- What gets installed. These versions were tested together on 2026-11-17.
# ---- --latest ignores them and takes the newest of everything instead.
MODEL_REPO="prism-ml/Ternary-Bonsai-2-27B-mlx-2bit"
MODEL_REV="24b5937a4a104a44f790b6ccbd0c79b6fabd4299"
WEBUI_SPEC=("open-webui==0.13.3" "av<19") # av 19 breaks voice input in Open WebUI 0.13.3
TTS_SPEC=("pocket-tts==4.0.1" "soundfile")
SNAPSHOT="2026-11-18" # packages released after this date are not used
PYTHON="3.12"

ROOT="${LOCAL_AI_DIR:-$HOME/Local AI}"
SOURCE_URL="${LOCAL_AI_SOURCE_URL:-https://github.com/bkizzy/claude-skills/archive/refs/heads/main.tar.gz}"
MODEL_URL="http://127.0.0.1:8765"
TTS_URL="http://127.0.0.1:8767"
WEBUI_URL="http://127.0.0.1:8080"
MIN_MACOS=14
MIN_RAM_GB=16
MIN_DISK_GB=20

MODE=install SIMULATE="" LATEST="" YES="" RUNNING="" UV="" TMP=""
for arg in "$@"; do
	case "$arg" in
	--check) MODE=check ;;
	--uninstall) MODE=uninstall ;;
	--simulate) SIMULATE=1 ;;
	--latest) LATEST=1 ;;
	--yes | -y) YES=1 ;;
	--help | -h) usage && exit 0 ;;
	*) echo "Unknown option: $arg" && usage && exit 2 ;;
	esac
done

FREEZE=(--exclude-newer "$SNAPSHOT")
UPGRADE=()
if [ -n "$LATEST" ]; then
	MODEL_REV="main" WEBUI_SPEC=("open-webui") TTS_SPEC=("pocket-tts" "soundfile")
	FREEZE=() UPGRADE=(--upgrade)
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"

say() { printf '\n== %s\n' "$*"; }
info() { printf '   %s\n' "$*"; }
die() {
	printf '\nSTOPPED: %s\n' "$*" >&2
	exit 1
}
# Show a command, and run it unless this is a simulation.
run() {
	printf '   + %s\n' "$*"
	[ -n "$SIMULATE" ] || "$@"
}
up() { curl -s -o /dev/null --max-time 2 "$1"; }
contains() { case "$1" in *"$2"*) return 0 ;; esac && return 1; }
cleanup() { [ -z "$TMP" ] || rm -rf "$TMP"; }
trap cleanup EXIT
trap 'printf "\nSTOPPED: the step above failed. It is safe to run this script again: it carries on from where it stopped.\n" >&2' ERR

# Ask before a step that changes the Mac: Return to go ahead, or a word that must be typed.
confirm() {
	[ -z "$YES$SIMULATE" ] || return 0
	{ true </dev/tty; } 2>/dev/null || die "there is no terminal to ask on. Add --yes to go ahead without being asked."
	if [ -n "$1" ]; then
		printf '\nType %s and press Return to go ahead: ' "$1"
	else
		printf '\nPress Return to go ahead, or Ctrl+C to stop. '
	fi
	read -r reply </dev/tty
	[ "$reply" = "$1" ] || die "nothing was changed."
}

app_path() {
	local d
	for d in "${APP_DEST:-}" /Applications "$HOME/Applications"; do
		if [ -n "$d" ] && [ -d "$d/Bonsai Chat.app" ]; then
			echo "$d/Bonsai Chat.app"
			return 0
		fi
	done
	return 1
}

wait_for() { # url, seconds, what we are waiting for
	local waited=0
	info "waiting for $3 ..."
	until up "$1"; do
		[ "$waited" -lt "$2" ] || die "$3 did not start within $2 seconds. Look at the .log files in $ROOT for the reason."
		sleep 3
		waited=$((waited + 3))
	done
}

# Stop our own servers and launcher. The patterns are anchored so they only match our own copies.
stop_all() {
	info "stopping Local AI so its files can be changed"
	[ -z "$SIMULATE" ] || return 0
	pkill -f 'Bonsai Chat\.app/Contents/MacOS/applet$' 2>/dev/null || true
	pkill -f "[Pp]ython[0-9.]* $ROOT/bonsai/server\.py\$" 2>/dev/null || true
	pkill -f "^$ROOT/open-webui/.venv/bin/python .*open-webui serve" 2>/dev/null || true
	pkill -f "^$ROOT/pocket-tts/.venv/bin/python .*server\.py" 2>/dev/null || true
	sleep 2
}

preflight() {
	say "Checking this Mac"
	local other="An AI assistant can set it up on other computers by following references/other-platforms.md, next to this script on GitHub."
	[ "$(uname -s)" = Darwin ] || die "this installer is for macOS. $other"
	[ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = 1 ] ||
		die "this needs a Mac with Apple Silicon (M1 or newer). $other"
	local os ram disk dir port pid cmd
	os="$(sw_vers -productVersion)"
	[ "${os%%.*}" -ge "$MIN_MACOS" ] || die "macOS $MIN_MACOS or newer is needed. This Mac has $os."
	ram=$(($(sysctl -n hw.memsize) / 1073741824))
	[ "$ram" -ge "$MIN_RAM_GB" ] || die "the model needs $MIN_RAM_GB GB of memory. This Mac has $ram GB."
	info "ok: Apple Silicon, macOS $os, $ram GB of memory"
	[ "$ram" -ge 24 ] || info "note: with $ram GB it will run, but close other large apps while you chat."
	case "$ROOT" in
	*[\"\|\&\\]*) die "the install folder's name cannot contain \" | & or \\. Choose another with LOCAL_AI_DIR." ;;
	esac
	if [ ! -f "$ROOT/bonsai/bonsai2-27b-mlx/model.safetensors" ]; then
		dir="$ROOT"
		while [ ! -d "$dir" ]; do dir="$(dirname "$dir")"; done
		disk="$(df -g "$dir" | awk 'NR==2 {print $4}')"
		[ "$disk" -ge "$MIN_DISK_GB" ] || die "about $MIN_DISK_GB GB of free disk space is needed. This Mac has $disk GB free."
		info "ok: $disk GB of free disk space"
	fi
	for port in 8765 8767 8080; do
		pid="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
		[ -n "$pid" ] || continue
		cmd="$(ps -o command= -p "$pid" || true)"
		case "$cmd" in
		*"$ROOT/"*) RUNNING=1 ;;
		*) die "port $port is in use by another program ($cmd). Quit it, then run this again." ;;
		esac
	done
}

get_files() {
	say "Getting the Local AI files"
	local src="$HERE/files"
	if [ -f "$src/bonsai/server.py" ]; then
		info "using the files next to this script"
	elif [ -n "$SIMULATE" ]; then
		curl -fsSLI -o /dev/null "$SOURCE_URL" || die "cannot reach $SOURCE_URL"
		info "ok: they can be downloaded from $SOURCE_URL"
		src="(downloaded files)"
	else
		info "downloading them from $SOURCE_URL"
		TMP="$(mktemp -d)"
		curl -fsSL "$SOURCE_URL" | tar -xz -C "$TMP" --strip-components 2 '*/local-ai-mac/files' ||
			die "could not download the files. Check the internet connection and run this again."
		src="$TMP/files"
	fi
	run mkdir -p "$ROOT"
	run cp -R "$src/." "$ROOT/"
	run chmod +x "$ROOT/open-webui/start.sh" "$ROOT/bonsai/app/build_app.sh"
}

get_uv() {
	say "Getting uv, the tool that installs Python and its packages"
	if [ -x "$ROOT/bin/uv" ]; then
		UV="$ROOT/bin/uv"
	elif command -v uv >/dev/null 2>&1; then
		UV="$(command -v uv)"
	elif [ -n "$SIMULATE" ]; then
		curl -fsSLI -o /dev/null https://astral.sh/uv/install.sh || die "cannot reach astral.sh to download uv."
		info "ok: uv can be downloaded; it would go into $ROOT/bin"
		UV="$ROOT/bin/uv"
		return 0
	else
		info "downloading uv into $ROOT/bin (nothing else on this Mac is changed)"
		curl -LsSf https://astral.sh/uv/install.sh | env UV_UNMANAGED_INSTALL="$ROOT/bin" sh >/dev/null ||
			die "could not download uv. Check the internet connection and run this again."
		UV="$ROOT/bin/uv"
	fi
	info "using $UV"
	# Our own copy keeps its Python and its downloads inside the install folder, so uninstalling removes them.
	if [ "$UV" = "$ROOT/bin/uv" ]; then
		export UV_PYTHON_INSTALL_DIR="$ROOT/.python" UV_CACHE_DIR="$ROOT/.uv-cache"
	fi
}

venv() { [ -x "$1/.venv/bin/python" ] || run "$UV" venv --python "$PYTHON" "$1/.venv"; }
pip() { # folder, then what to install
	local dir="$1"
	shift
	run "$UV" pip install --python "$dir/.venv/bin/python" ${FREEZE[@]+"${FREEZE[@]}"} ${UPGRADE[@]+"${UPGRADE[@]}"} "$@"
}
# Simulation only: check that a set of packages can be found and fit together, without installing them.
resolves() { # name, then the packages
	[ -n "$SIMULATE" ] || return 0
	local name="$1"
	shift
	if [ ! -x "$UV" ]; then
		info "skipped: cannot check $name until uv is installed"
	elif printf '%s\n' "$@" | "$UV" pip compile --quiet --python-version "$PYTHON" \
		${FREEZE[@]+"${FREEZE[@]}"} - >/dev/null; then
		info "ok: $name can be downloaded and fit together"
	else
		die "$name cannot be installed as listed."
	fi
}

install_model() {
	say "Bonsai 2 27B, the model (an 8.6 GB download: the slow part)"
	local dir="$ROOT/bonsai" pack="$ROOT/bonsai/bonsai2-27b-mlx" hub="https://huggingface.co" reqs
	if [ -n "$SIMULATE" ]; then
		curl -fsS -o /dev/null "$hub/api/models/$MODEL_REPO/revision/$MODEL_REV" || die "cannot find the model at $hub/$MODEL_REPO"
		info "ok: the model is available at $hub/$MODEL_REPO ($MODEL_REV)"
		reqs="$(curl -fsSL "$hub/$MODEL_REPO/resolve/$MODEL_REV/runtime/requirements.txt")" || die "cannot read the model's package list."
		# shellcheck disable=SC2086
		resolves "the model's packages" huggingface_hub $reqs
	fi
	venv "$dir"
	pip "$dir" huggingface_hub
	run "$dir/.venv/bin/hf" download "$MODEL_REPO" --revision "$MODEL_REV" --local-dir "$pack"
	pip "$dir" -r "$pack/runtime/requirements.txt"
}

install_tts() {
	say "Pocket TTS, the voice"
	resolves "Pocket TTS" "${TTS_SPEC[@]}"
	venv "$ROOT/pocket-tts"
	pip "$ROOT/pocket-tts" "${TTS_SPEC[@]}"
}

install_webui() {
	say "Open WebUI, the chat app (a large download)"
	resolves "Open WebUI" "${WEBUI_SPEC[@]}"
	venv "$ROOT/open-webui"
	pip "$ROOT/open-webui" "${WEBUI_SPEC[@]}"
}

first_start() {
	say "Starting it for the first time"
	if [ -n "$SIMULATE" ]; then
		info "would start Open WebUI, open Bonsai Chat, wait for all three parts, then test them"
		return 0
	fi
	if ! up "$WEBUI_URL/health"; then
		(cd "$ROOT/open-webui" && nohup ./start.sh >webui.log 2>&1 </dev/null &)
	fi
	wait_for "$WEBUI_URL/health" 1800 "Open WebUI (its first start downloads a small search model and can take several minutes)"
	run open "$(app_path)"
	wait_for "$MODEL_URL/v1/models" 300 "the model"
	wait_for "$TTS_URL/v1/audio/models" 900 "the voice (its first start downloads the Pocket TTS model)"
}

check() {
	say "Checking Local AI in $ROOT"
	local bad=0 n=0 app token code out json='Content-Type: application/json' fox="The quick brown fox jumps over the lazy dog."
	have() {
		if [ -e "$2" ]; then info "ok        $1"; else
			info "MISSING   $1 ($2)"
			bad=1
		fi
	}
	test_result() { # passed?, name
		if [ "$1" = 0 ]; then info "ok        $2"; else
			info "FAILED    $2"
			bad=1
		fi
	}
	app="$(app_path || true)"
	have "the model" "$ROOT/bonsai/bonsai2-27b-mlx/model.safetensors"
	have "the model's packages" "$ROOT/bonsai/.venv/bin/python"
	have "Pocket TTS" "$ROOT/pocket-tts/.venv/bin/pocket-tts"
	have "Open WebUI" "$ROOT/open-webui/.venv/bin/open-webui"
	have "the Bonsai Chat app" "${app:-/Applications/Bonsai Chat.app}"
	if [ "$bad" = 1 ]; then
		printf '\nRESULT: INCOMPLETE. Run the installer again (without --check) to repair it.\n'
		return 1
	fi

	for url in "$MODEL_URL/v1/models" "$TTS_URL/v1/audio/models" "$WEBUI_URL/health"; do
		if up "$url"; then
			n=$((n + 1))
			info "running   $url"
		else info "stopped   $url"; fi
	done
	if [ "$n" = 0 ]; then
		printf '\nRESULT: INSTALLED, NOT RUNNING. Open Bonsai Chat from Applications, wait a minute, then check again.\n'
		return 0
	elif [ "$n" != 3 ]; then
		printf '\nRESULT: PROBLEM. Only %s of 3 parts are running. Quit Bonsai Chat, open it again, wait a minute, then check again.\n' "$n"
		return 1
	fi

	TMP="$(mktemp -d)"
	out="$(curl -s --max-time 300 "$MODEL_URL/v1/chat/completions" -H "$json" \
		-d '{"model":"bonsai-2-27b","max_tokens":8,"messages":[{"role":"user","content":"Say hello."}]}' || true)"
	contains "$out" '"content"' && code=0 || code=1
	test_result "$code" "the model answers a question"

	code="$(curl -s --max-time 300 -o "$TMP/voice.mp3" -w '%{http_code} %{content_type}' "$TTS_URL/v1/audio/speech" \
		-H "$json" -d "{\"voice\":\"alba\",\"input\":\"$fox\"}" || true)"
	[ "$code" = "200 audio/mpeg" ] && code=0 || code=1
	test_result "$code" "the voice produces speech"

	out="$(curl -s --max-time 30 "$WEBUI_URL/api/v1/auths/signin" -H "$json" -d '{"email":"","password":""}' || true)"
	token="$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' <<<"$out")"
	if [ -z "$token" ]; then
		info "skipped   the Open WebUI tests: its login is switched on, so this script cannot sign in"
	else
		out="$(curl -s --max-time 60 "$WEBUI_URL/api/models" -H "Authorization: Bearer $token" || true)"
		contains "$out" '"bonsai-2-27b"' && code=0 || code=1
		test_result "$code" "Open WebUI is connected to the model"
		# Speech out through Open WebUI, then back in through its voice input: tests both directions at once.
		curl -s --max-time 300 -o "$TMP/spoken.mp3" "$WEBUI_URL/api/v1/audio/speech" \
			-H "Authorization: Bearer $token" -H "$json" -d "{\"input\":\"$fox\"}" || true
		out="$(curl -s --max-time 900 "$WEBUI_URL/api/v1/audio/transcriptions" -H "Authorization: Bearer $token" \
			-F "file=@$TMP/spoken.mp3;type=audio/mpeg" || true)"
		contains "$out" "brown fox" && code=0 || code=1
		test_result "$code" "Open WebUI reads aloud and understands speech"
	fi

	if [ "$bad" = 1 ]; then
		printf '\nRESULT: PROBLEM. See the FAILED lines above and the .log files in %s.\n' "$ROOT"
		return 1
	fi
	printf '\nRESULT: OK. Everything is installed, running and working.\n'
}

install() {
	say "Local AI for Mac"
	info "Installs into: $ROOT"
	info "Downloads about 14 GB, so it can take a while. Nothing leaves this Mac once it is installed."
	[ -z "$LATEST" ] || info "Using the newest versions (--latest) instead of the tested ones."
	[ -z "$SIMULATE" ] || info "SIMULATION: every step is shown and the downloads are tested, but nothing is changed."
	preflight
	confirm ""
	[ -z "$RUNNING" ] || stop_all
	get_files
	get_uv
	install_model
	install_tts
	install_webui
	say "The Bonsai Chat app"
	run sh "$ROOT/bonsai/app/build_app.sh"
	first_start
	if [ -n "$SIMULATE" ]; then
		printf '\nRESULT: SIMULATION OK. Nothing was changed. Run again without --simulate to install.\n'
		return 0
	fi
	if check; then
		say "Done"
		info "Open WebUI is open in your browser at $WEBUI_URL"
		info "From now on, open Bonsai Chat from Applications to start it, and quit Bonsai Chat to stop it."
	else
		[ -z "$LATEST" ] || info "The newest versions did not pass. Run this again without --latest to use the tested ones."
		exit 1
	fi
}

uninstall() {
	say "Removing Local AI from $ROOT"
	[ -n "$ROOT" ] && [ "$ROOT" != / ] || die "refusing to remove from '$ROOT'."
	info "This deletes the model, Open WebUI with all of its chats and settings, Pocket TTS and the Bonsai Chat app."
	confirm delete
	stop_all
	local app
	for app in "${APP_DEST:-/Applications}/Bonsai Chat.app" "/Applications/Bonsai Chat.app" "$HOME/Applications/Bonsai Chat.app"; do
		# Only an app that was built for this folder: another install's app is left alone.
		[ "$(cat "$app/Contents/Resources/root.txt" 2>/dev/null || true)" != "$ROOT" ] || run rm -rf "$app"
	done
	run rm -rf "$ROOT/bonsai" "$ROOT/open-webui" "$ROOT/pocket-tts" "$ROOT/.python" "$ROOT/.uv-cache" "$ROOT/bin/uv" "$ROOT/bin/uvx"
	[ -n "$SIMULATE" ] || rmdir "$ROOT/bin" "$ROOT" 2>/dev/null || true
	printf '\nRESULT: REMOVED.\n'
}

if [ "$MODE" = check ]; then
	check || exit 1
else
	"$MODE"
fi
