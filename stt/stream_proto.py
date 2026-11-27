#!/usr/bin/env python3
"""Streaming prototype: slice continuous speech into fixed 3.5 s chunks,
POST them to /v1/stt/chunk, and prove no backlog grows under continuous
speech. Run on the Studio (whisper venv python):

    python stream_proto.py [--burst]

Modes:
  default  realistic: client waits for each response before sending the
           next chunk (as the WebView will, one buffer at a time).
  --burst  stress: fire all chunks with no waiting; measures how far
           processing lags when the client never throttles.

Audio: macOS `say` + `afconvert` -> 16 kHz s16le mono. Fictional content.
"""
import argparse
import json
import subprocess
import tempfile
import time
import urllib.request
import wave

CHUNK_S = 3.5
SAY_TEXT = (
    "Henry, before we start, the run of show for Thursday is nearly locked. "
    "Your talk is on stage B in the afternoon, twenty five minutes plus five for questions. "
    "I need the abstract by the fourteenth so the programme can go to print on time. "
    "I will send you the speaker pass and the stage checklist by Friday morning. "
    "One more thing, rehearsals are on Wednesday evening, and I would like you there for the sound check. "
    "The clicker failed on stage B last year mid talk, so we test every clicker twice now. "
    "Also, my training run for the Harbour ten K starts at six, so Wednesday works better than Thursday for me. "
    "Bring the abstract on paper if you can, my notebook is where the real schedule lives."
)


def make_audio():
    aiff = tempfile.mktemp(suffix=".aiff")
    pcm = tempfile.mktemp(suffix=".wav")
    subprocess.run(["say", "-o", aiff, SAY_TEXT], check=True)
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, pcm], check=True)
    return pcm


def post_chunk(base, sid, seq, data):
    req = urllib.request.Request(
        f"{base}/v1/stt/chunk",
        data=data,
        headers={"content-type": "application/octet-stream", "x-session-id": sid, "x-seq": str(seq)},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--burst", action="store_true")
    ap.add_argument("--base", default="http://localhost:8472")
    args = ap.parse_args()

    wav_path = make_audio()
    with wave.open(wav_path) as w:
        raw = w.readframes(w.getnframes())
    total_s = len(raw) / 32000.0
    chunk_bytes = int(CHUNK_S * 32000)
    chunks = [raw[i : i + chunk_bytes] for i in range(0, len(raw), chunk_bytes)]
    sid = f"proto-{int(time.time())}"

    print(f"audio {total_s:.1f}s in {len(chunks)} chunks of {CHUNK_S}s; mode={'burst' if args.burst else 'sequential'}")
    t_start = time.perf_counter()
    results = []
    if args.burst:
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(chunks)) as ex:
            futs = {ex.submit(post_chunk, args.base, sid, i, c): i for i, c in enumerate(chunks)}
            for fut in concurrent.futures.as_completed(futs):
                results.append((futs[fut], fut.result()))
    else:
        for i, c in enumerate(chunks):
            results.append((i, post_chunk(args.base, sid, i, c)))
    wall = time.perf_counter() - t_start
    results.sort()
    final_text = results[-1][1]["text"]
    stt_total = sum(r[1]["chunk_stt_s"] for r in results)
    max_chunk = max(r[1]["chunk_stt_s"] for r in results)
    print(f"wall {wall:.1f}s for {total_s:.1f}s audio (ratio {wall/total_s:.2f}x); server stt total {stt_total:.1f}s, max chunk {max_chunk:.2f}s")
    print(f"backlog check: max per-chunk stt {max_chunk:.2f}s < chunk {CHUNK_S}s -> {'NO BACKLOG' if max_chunk < CHUNK_S else 'BACKLOG!'}")
    print("assembled:", final_text)


if __name__ == "__main__":
    main()
