#!/usr/bin/env python3
"""Ostler Glance STT service (Studio-side).

Receives raw PCM16 little-endian 16 kHz mono audio over HTTP, transcribes
with faster-whisper, returns text. PRIVACY RULE: audio lives only in memory
for the duration of one request — it is never written to disk and the buffer
is released as soon as transcription returns.

Env:
  STT_HOST   bind host (default 0.0.0.0)
  STT_PORT   port (default 8472)
  STT_MODEL  faster-whisper model (default small; tiny/base for speed tests)
  STT_DEVICE cpu (default) / cuda
"""

import io
import json
import os
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from faster_whisper import WhisperModel

HOST = os.environ.get("STT_HOST", "0.0.0.0")
PORT = int(os.environ.get("STT_PORT", "8472"))
MODEL_NAME = os.environ.get("STT_MODEL", "small")
DEVICE = os.environ.get("STT_DEVICE", "cpu")
# The seeded cast prompt boosts name recall on chunk windows but can bleed
# into output on short/quiet chunks. Toggle to compare; default on.
CHUNK_PROMPT = os.environ.get("STT_CHUNK_PROMPT", "on") == "on"

INITIAL_PROMPT = (
    "A business meeting between Henry Ashworth and colleagues. "
    "Names: Eleanor Whitfield, James Hardwick, Rachel Fenwick. "
    "Companies: Halcyon Summit, Ledger and Loom, Cormorant Capital."
)


def strip_prompt_bleed(text):
    """Drop any chunk fragment that the model copied from the initial prompt.

    A genuine sentence shares at most a name (2-3 words) with the prompt; a
    bled fragment contains a long contiguous run of prompt words. Drop the
    sentence if any 5-word run of it appears in the prompt.
    """
    if not text:
        return text
    prompt_words = INITIAL_PROMPT.lower().split()
    prompt_runs = {" ".join(prompt_words[i : i + 5]) for i in range(len(prompt_words) - 4)}
    kept = []
    for sentence in text.split(". "):
        words = sentence.lower().split()
        if any(" ".join(words[i : i + 5]) in prompt_runs for i in range(max(0, len(words) - 4))):
            continue
        kept.append(sentence)
    return ". ".join(kept).strip()

model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type="int8")

# Live-catch chunk sessions: session id -> {text, last_seq}. Audio buffers
# are transcribed and released per request; only the assembled running
# text is retained — never audio.
CHUNK_SESSIONS = {}
SESSION_LOCK = threading.Lock()
TRANSCRIBE_LOCK = threading.Lock()
INFLIGHT = {"n": 0}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"{self.log_date_time_string()} {args[0] if args else fmt}", flush=True)

    def _send(self, status, body):
        data = json.dumps(body).encode() if body else b""
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "content-type, x-session-id, x-seq")
        self.send_header("access-control-allow-methods", "GET,POST,OPTIONS")
        self.end_headers()
        if data:
            self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        if self.path == "/healthz":
            self._send(200, {"ok": True, "model": MODEL_NAME, "device": DEVICE})
        else:
            self._send(404, {"error": "not_found"})

    def do_POST(self):
        if self.path == "/v1/stt/chunk":
            return self._stt_chunk()
        if self.path != "/v1/stt":
            return self._send(404, {"error": "not_found"})
        length = int(self.headers.get("content-length", "0"))
        # Raw PCM16 LE 16 kHz mono, or a PCM WAV of the same. Held in memory
        # only, never on disk.
        audio = self.rfile.read(length)
        pcm = audio
        if audio[:4] == b"RIFF":
            with wave.open(io.BytesIO(audio)) as w:
                if w.getframerate() != 16000 or w.getsampwidth() != 2:
                    return self._send(422, {"error": "wav_must_be_16k_s16le"})
                pcm = w.readframes(w.getnframes())
        if len(pcm) < 3200:  # < 100 ms: nothing usable
            return self._send(422, {"error": "too_short", "bytes": len(pcm)})
        audio_f32 = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        t0 = time.perf_counter()
        segments, _info = model.transcribe(
            audio_f32,
            language="en",
            beam_size=5,
            vad_filter=True,
            initial_prompt=(
                "A business meeting between Henry Ashworth and colleagues. "
                "Names: Eleanor Whitfield, James Hardwick, Rachel Fenwick. "
                "Companies: Halcyon Summit, Ledger and Loom, Cormorant Capital."
            ),
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        dt = time.perf_counter() - t0
        del pcm
        print(f"stt: {len(audio_f32) / 16000:.1f}s audio -> {dt:.2f}s ({dt * 16000 / len(audio_f32):.2f}x)", flush=True)
        self._send(200, {"text": text, "audio_s": round(len(audio_f32) / 16000, 2), "stt_s": round(dt, 2)})

    def _stt_chunk(self):
        sid = self.headers.get("x-session-id", "default")
        seq = int(self.headers.get("x-seq", "0"))
        length = int(self.headers.get("content-length", "0"))
        pcm = self.rfile.read(length)
        if len(pcm) < 3200:
            return self._send(422, {"error": "too_short", "bytes": len(pcm)})
        audio_f32 = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        INFLIGHT["n"] += 1
        try:
            # One transcription at a time: concurrent MPS inference
            # serializes on the GPU anyway and multiplies latency.
            with TRANSCRIBE_LOCK:
                t0 = time.perf_counter()
                segments, _info = model.transcribe(
                    audio_f32,
                    language="en",
                    beam_size=5,
                    vad_filter=True,
                    initial_prompt=INITIAL_PROMPT if CHUNK_PROMPT else None,
                )
                chunk_text = " ".join(seg.text.strip() for seg in segments).strip()
                if CHUNK_PROMPT:
                    chunk_text = strip_prompt_bleed(chunk_text)
                dt = time.perf_counter() - t0
        finally:
            INFLIGHT["n"] -= 1
        with SESSION_LOCK:
            session = CHUNK_SESSIONS.setdefault(sid, {"text": "", "last_seq": -1})
            session["last_seq"] = seq
            if chunk_text:
                session["text"] = (session["text"] + " " + chunk_text).strip()
        level = float(np.abs(audio_f32).mean())
        print(f"chunk: {len(audio_f32)/16000:.1f}s level={level:.4f} text={chunk_text[:80]!r}", flush=True)
        del pcm
        self._send(200, {
            "text": session["text"],
            "chunk_stt_s": round(dt, 2),
            "inflight": INFLIGHT["n"],
        })


if __name__ == "__main__":
    print(f"whisper service on {HOST}:{PORT} model={MODEL_NAME} device={DEVICE}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
