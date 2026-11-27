#!/usr/bin/env python3
"""Two-call farming harness: run the local extraction (qwen2.5:7b via
ollama) against the synthetic fictional meetings and score each call.

Architecture (decided 2026-11-24):
  Call 1 (promises): small, verifiable — the promise ledger is the
    differentiator, so it gets a dedicated prompt and strict checks.
  Call 2 (artefacts): summary, to_dos, cleaned_transcript, details.

Usage (on the machine running ollama):
    python test_farming.py [--base http://localhost:11500]

Honest bar: per-meeting PASS/FAIL counts; exit 1 if any FAIL. Do not tune
checks to pass; fix the prompt or the architecture.
"""
import argparse
import datetime
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
MODEL = os.environ.get("FARMING_MODEL", "qwen2.5:7b")
# Shared with the backend (farming.js) — one source of truth.
PROMISES_PROMPT = (HERE / "prompts/promises.txt").read_text()
ARTEFACTS_SYSTEM = (HERE / "prompts/artefacts_system.txt").read_text()

MEETINGS = [
    {
        "file": "transcripts/2026-11-04-eleanor.txt",
        "meeting_date": "2026-11-04",
        "title": "Coffee — Halcyon Summit speaker slot",
        "attendees": ["Eleanor Whitfield", "Henry Ashworth"],
        "expect_promises": [
            {"direction": "owed_by_me", "what": ["talk abstract", "abstract"], "due": "2026-11-14"},
            {"direction": "owed_to_me", "what": ["speaker pass", "av checklist", "checklist"], "due": "2026-11-07"},
        ],
        "expect_details_mentions": ["notebook", "clicker"],
        "expect_todos_min": 3,
    },
    {
        "file": "transcripts/2026-11-11-james.txt",
        "meeting_date": "2026-11-11",
        "title": "Call — Ledger & Loom integration",
        "attendees": ["James Hardwick", "Henry Ashworth"],
        "expect_promises": [
            {"direction": "owed_to_me", "what": ["sandbox keys", "keys"], "due": "2026-11-18"},
            {"direction": "owed_by_me", "what": ["intro", "marlow"], "due": "2026-11-28"},
        ],
        "expect_details_mentions": ["whippets", "loom"],
        "expect_todos_min": 3,
    },
    {
        "file": "transcripts/2026-11-18-rachel.txt",
        "meeting_date": "2026-11-18",
        "title": "Metrics review — Cormorant Capital",
        "attendees": ["Rachel Fenwick", "Henry Ashworth"],
        "expect_promises": [
            {"direction": "owed_by_me", "what": ["metrics deck", "deck", "cohort"], "due": "2026-11-21"},
            {"direction": "owed_to_me", "what": ["term-sheet", "term sheet"], "due": "2026-11-25"},
        ],
        "expect_details_mentions": ["green pen", "theatre"],
        "expect_todos_min": 3,
    },
    {
        # Harness-only load fixture (~5 min of speech = judged-demo scale).
        # Not part of the fictional canon.
        "file": "transcripts/harness-5min.txt",
        "meeting_date": "2026-11-17",
        "title": "Harness 5-minute check-in (non-canon)",
        "attendees": ["Eleanor Whitfield", "Henry Ashworth"],
        "expect_promises": [
            {"direction": "owed_by_me", "what": ["race pack"], "due": "2026-11-20"},
            {"direction": "owed_by_me", "what": ["names", "panel"], "due": "2026-11-30"},
            {"direction": "owed_to_me", "what": ["coffee"], "due": None},
        ],
        "expect_details_mentions": ["10k", "knee"],
        "expect_todos_min": 3,
    },
]


def chat(base, messages, num_predict=8192, timeout=700):
    body = json.dumps({
        "model": MODEL, "stream": False, "keep_alive": "30m",  # no format=json: it collapses recall to one item on qwen2.5:7b
        "options": {"temperature": 0.0, "num_predict": num_predict, "num_ctx": 16384},
        "messages": messages,
    }).encode()
    req = urllib.request.Request(f"{base}/api/chat", data=body,
                                 headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.loads(r.read())
    msg = data.get("message", {})
    if not msg.get("content"):
        raise RuntimeError(f"empty content: eval={data.get('eval_count')} "
                           f"done={data.get('done_reason')} thinking_len={len(msg.get('thinking') or '')}")
    return msg["content"]


def extract_json(raw):
    raw = raw.strip()
    m = re.search(r"```(?:json)?\s*(\{.*\}|\[.*\])\s*```", raw, re.S)
    if m:
        raw = m.group(1)
    opener = "{" if "{" in raw and (raw.find("{") < raw.find("[") or "[" not in raw) else "["
    start = raw.find(opener)
    if start < 0:
        raise ValueError("no JSON found")
    pairs = {"{": "}", "[": "]"}
    depth, in_str, esc = 0, False, False
    for i in range(start, len(raw)):
        c = raw[i]
        if esc:
            esc = False
            continue
        if c == "\\":
            esc = True
            continue
        if c == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if c == opener:
            depth += 1
        elif c == pairs[opener]:
            depth -= 1
            if depth == 0:
                return json.loads(raw[start:i + 1])
    raise ValueError("unbalanced JSON")


def extract_promises(base, transcript, meta):
    # .replace (not .format): the prompt file is literal text with
    # {attendees}/{date}/{transcript} placeholders, exactly as the
    # backend's farming.js sends it.
    weekday = datetime.date.fromisoformat(meta["meeting_date"]).strftime('%A')
    prompt = (PROMISES_PROMPT
              .replace('{attendees}', ', '.join(meta["attendees"]))
              .replace('{date}', meta["meeting_date"])
              .replace('{weekday}', weekday)
              .replace('{transcript}', transcript))
    raw = chat(base, [{"role": "user", "content": prompt}], num_predict=2048)
    parsed = extract_json(raw)
    if isinstance(parsed, dict):
        parsed = [parsed]
    return parsed


def extract_artefacts(base, transcript, meta):
    user = json.dumps({
        "meeting": {"title": meta["title"], "date": meta["meeting_date"],
                    "attendees": meta["attendees"]},
        "transcript": transcript,
    })
    last_err = None
    for attempt in (1, 2):
        try:
            raw = chat(base, [{"role": "system", "content": ARTEFACTS_SYSTEM},
                              {"role": "user", "content": user}])
            return extract_json(raw)
        except Exception as e:
            last_err = e  # free-running JSON sometimes malformed; one retry
    raise last_err


def to_contract(p):
    promiser = str(p.get("promiser", "")).lower()
    recipient = str(p.get("recipient", "")).lower()
    if "henry" in promiser:
        return {"who": p.get("promiser"), "direction": "owed_by_me",
                "what": p.get("what", ""), "due": p.get("due")}
    if "henry" in recipient:
        return {"who": p.get("recipient"), "direction": "owed_to_me",
                "what": p.get("what", ""), "due": p.get("due")}
    return None


passed_all = True


def check(name, cond, detail=""):
    global passed_all
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  [{detail}]" if detail and not cond else ""))
    if not cond:
        passed_all = False
    return cond


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:11500",
                    help="Base URL of the local ollama instance serving the extraction model.")
    ap.add_argument("--only", default=None, help="run a single meeting title substring")
    args = ap.parse_args()

    for meta in MEETINGS:
        if args.only and args.only not in meta["title"]:
            continue
        n_pass = n_fail = 0
        print(f"\n=== {meta['title']} ({meta['meeting_date']}) ===")
        transcript = (HERE / meta["file"]).read_text()

        # --- call 1: promises ---
        try:
            promises = extract_promises(args.base, transcript, meta)
            print(f"  [raw promises] {json.dumps(promises, ensure_ascii=False)[:500]}")
            ok_form = all(set(p) >= {"promiser", "recipient", "what", "due", "status"} for p in promises)
            check("promises: well-formed array", ok_form, json.dumps(promises)[:300])
            mapped = [m for m in (to_contract(p) for p in promises) if m]
            check("promises: every item involves Henry", len(mapped) == len(promises),
                  json.dumps(promises, ensure_ascii=False)[:300])
            for exp in meta["expect_promises"]:
                hit = any(m["direction"] == exp["direction"]
                          and any(k in m["what"].lower() for k in exp["what"]) for m in mapped)
                check(f"promise: {exp['direction']} :: {'/'.join(exp['what'])}", hit,
                      json.dumps(mapped, ensure_ascii=False)[:400])
                due_hit = any(m["direction"] == exp["direction"] and m.get("due") == exp["due"] for m in mapped)
                check(f"  due {exp['due']}", due_hit)
        except Exception as e:
            check("promises call", False, str(e)[:200])
        # --- call 2: artefacts ---
        try:
            art = extract_artefacts(args.base, transcript, meta)
            for key in ["summary", "to_dos", "cleaned_transcript", "details"]:
                check(f"artefact '{key}' present", bool(art.get(key)))
            check("summary reasonable", 1 <= len(re.findall(r"[.!?]", art["summary"])) <= 12, art["summary"][:80])
            check("to_dos >= %d and well-formed" % meta["expect_todos_min"],
                  len(art["to_dos"]) >= meta["expect_todos_min"]
                  and all(set(t) >= {"text", "owner", "due", "status", "source"} for t in art["to_dos"]))
            src_w, clean_w = len(transcript.split()), len(art["cleaned_transcript"].split())
            check("cleaned_transcript substantially complete", clean_w >= 0.5 * src_w, f"{clean_w}/{src_w}")
            det = art["details"].lower()
            for needle in meta["expect_details_mentions"]:
                check(f"details mentions '{needle}'", needle in det)
            print(f"  -- summary: {art['summary'][:150]}")
        except Exception as e:
            check("artefacts call", False, str(e)[:200])

    print("\nOVERALL:", "PASS" if passed_all else "FAIL")
    sys.exit(0 if passed_all else 1)


if __name__ == "__main__":
    main()
