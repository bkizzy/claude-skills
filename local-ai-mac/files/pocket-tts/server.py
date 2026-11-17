#!/usr/bin/env python3
"""Pocket TTS behind an OpenAI-style speech API, so Open WebUI can read answers aloud with it.

  .venv/bin/python server.py

  API   http://127.0.0.1:8767/v1     POST /audio/speech, GET /audio/voices, GET /audio/models
"""

import io
import threading

import soundfile
import uvicorn
from fastapi import FastAPI, HTTPException, Response
from pocket_tts import TTSModel
from pocket_tts.utils.utils import _ORIGINS_OF_PREDEFINED_VOICES as VOICES
from pydantic import BaseModel

HOST, PORT = "127.0.0.1", 8767

model = TTSModel.load_model()
states = {}  # voice name -> its loaded voice, kept so each voice is only prepared once
lock = threading.Lock()  # one generation at a time
app = FastAPI()


class Speech(BaseModel):
    input: str
    voice: str = "alba"


@app.post("/v1/audio/speech")
def speech(req: Speech):
    if req.voice not in VOICES:
        raise HTTPException(400, f"unknown voice {req.voice!r}; see /v1/audio/voices")
    if not req.input.strip():
        raise HTTPException(400, "input is empty")
    with lock:
        if req.voice not in states:
            states[req.voice] = model.get_state_for_audio_prompt(req.voice)
        audio = model.generate_audio(states[req.voice], req.input)
    # MP3, so Open WebUI can play it as it is and needs no ffmpeg to convert it.
    mp3 = io.BytesIO()
    soundfile.write(mp3, audio.numpy(), model.sample_rate, format="MP3")
    return Response(mp3.getvalue(), media_type="audio/mpeg")


@app.get("/v1/audio/voices")
def voices():
    return {"voices": [{"id": name, "name": name} for name in sorted(VOICES)]}


@app.get("/v1/audio/models")
def models():
    return {"models": [{"id": "pocket-tts"}]}


uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
