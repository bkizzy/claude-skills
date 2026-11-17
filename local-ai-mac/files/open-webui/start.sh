#!/bin/sh
# Start Open WebUI at http://127.0.0.1:8080, connected to the local Bonsai server
# (which must be running: open the Bonsai Chat app, or run bonsai/server.py).
#
# These settings are read on first start and then kept in data/; after that,
# change them in Open WebUI's own Admin Settings.
cd "$(dirname "$0")" || exit 1
export DATA_DIR="$PWD/data"
export WEBUI_AUTH=False                          # one user on this Mac: no login screen
export ENABLE_OLLAMA_API=False
export OPENAI_API_BASE_URL=http://127.0.0.1:8765/v1
export OPENAI_API_KEY=local                      # the local server ignores it; Open WebUI wants one
export DEFAULT_MODELS=bonsai-2-27b
export TASK_MODEL_EXTERNAL=bonsai-2-27b          # chat titles never use the slower thinking model
export ENABLE_FOLLOW_UP_GENERATION=False         # each of these would cost an extra generation per message
export ENABLE_TAGS_GENERATION=False
export ENABLE_AUTOCOMPLETE_GENERATION=False
export ENABLE_EVALUATION_ARENA_MODELS=False
export ENABLE_VERSION_UPDATE_CHECK=False
export AUDIO_TTS_ENGINE=openai                   # read aloud with Pocket TTS (pocket-tts/server.py)
export AUDIO_TTS_OPENAI_API_BASE_URL=http://127.0.0.1:8767/v1
export AUDIO_TTS_MODEL=pocket-tts
export AUDIO_TTS_VOICE=alba
export BYPASS_PYDUB_PREPROCESSING=true           # hand audio straight to the built-in decoders: no ffmpeg needed
# 127.0.0.1 only: with no login, it must not be reachable from the network.
exec .venv/bin/open-webui serve --host 127.0.0.1 --port 8080
