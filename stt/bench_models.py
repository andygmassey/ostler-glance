#!/usr/bin/env python3
"""One-off bench: compare faster-whisper models on MPS for the live-catch
window. Run on the Studio: whisper venv python bench_models.py /path/to.wav"""
import sys
import time
import wave

import numpy as np
from faster_whisper import WhisperModel

wav_path = sys.argv[1]
with wave.open(wav_path) as w:
    audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
audio_s = len(audio) / 16000
prompt = (
    "A business meeting between Henry Ashworth and colleagues. "
    "Names: Eleanor Whitfield, James Hardwick, Rachel Fenwick. "
    "Companies: Halcyon Summit, Ledger and Loom, Cormorant Capital."
)

for name in ["small", "base", "tiny"]:
    model = WhisperModel(name, device="mps", compute_type="int8")
    runs = []
    for i in range(2):
        t0 = time.perf_counter()
        segs, _ = model.transcribe(audio, language="en", beam_size=5, vad_filter=True, initial_prompt=prompt)
        text = " ".join(s.text.strip() for s in segs).strip()
        runs.append(time.perf_counter() - t0)
    best = min(runs)
    print(f"{name}: {audio_s:.1f}s audio, best {best:.2f}s = {best/audio_s:.2f}x | {text[:90]}", flush=True)
    del model
