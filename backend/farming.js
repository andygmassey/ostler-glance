// Two-call farming (backend side): given an assembled transcript, call the
// local ollama twice — promises-only, then four-artefact — and shape the
// result into the contract's ArtefactSet. Local models only (qwen2.5:7b);
// no cloud in the loop. Prompts live in farming/prompts/ and are shared
// with the Python harness (farming/test_farming.py) — keep them in sync
// by editing the files, not copies.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROMISES_PROMPT = readFileSync(join(HERE, 'farming/prompts/promises.txt'), 'utf8')
const ARTEFACTS_SYSTEM = readFileSync(join(HERE, 'farming/prompts/artefacts_system.txt'), 'utf8')

// Empty default: farming only happens when OLLAMA_BASE is set (the Studio
// sets it to andy's local ollama). Tests and laptops run the mock fixture.
const OLLAMA_BASE = process.env.OLLAMA_BASE ?? ''
const MODEL = process.env.FARMING_MODEL ?? 'qwen2.5:7b'

async function chat(messages, numPredict) {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      // no format:'json' — on qwen2.5:7b it collapses recall to a single item
      keep_alive: '30m',
      options: { temperature: 0.0, num_predict: numPredict, num_ctx: 16384 },
      messages,
    }),
  })
  if (!res.ok) throw new Error(`ollama chat → ${res.status}`)
  const data = await res.json()
  const content = data.message?.content
  if (!content) throw new Error(`ollama empty content (done=${data.done_reason})`)
  return content
}

function extractJson(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\{\[][\s\S]*?[\}\]])\s*```/)
  if (fenced) return JSON.parse(fenced[1])
  const start = raw.search(/[\{\[]/)
  if (start < 0) throw new Error('no JSON in model output')
  const opener = raw[start]
  const closer = opener === '{' ? '}' : ']'
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < raw.length; i++) {
    const c = raw[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === opener) depth++
    else if (c === closer && --depth === 0) return JSON.parse(raw.slice(start, i + 1))
  }
  throw new Error('unbalanced JSON in model output')
}

const isoDate = (d) => d.toISOString().slice(0, 10)

export async function farmSession(transcript, { date, attendees, knownPeople }) {
  const dateIso = date ?? isoDate(new Date())
  const attendeeList = attendees ?? ['Henry Ashworth', ...knownPeople.map((p) => p.full_name)]

  // Call 1: promises.
  const promisesRaw = await chat(
    [{ role: 'user', content: PROMISES_PROMPT
        .replace('{attendees}', attendeeList.join(', '))
        .replace('{date}', dateIso)
        .replace('{transcript}', transcript) }],
    2048,
  )
  let promiseItems = extractJson(promisesRaw)
  if (!Array.isArray(promiseItems)) promiseItems = [promiseItems]

  const promises = []
  let prSeq = 1
  for (const p of promiseItems) {
    const promiser = String(p.promiser ?? '').toLowerCase()
    const recipient = String(p.recipient ?? '').toLowerCase()
    let who, direction
    if (promiser.includes('henry')) {
      who = otherParty(p.recipient, attendeeList)
      direction = 'owed_by_me'
    } else if (recipient.includes('henry')) {
      who = otherParty(p.promiser, attendeeList)
      direction = 'owed_to_me'
    } else {
      continue // promise between third parties: not tracked in the demo
    }
    if (!who) continue
    promises.push({
      id: `pr_${String(prSeq++).padStart(3, '0')}`,
      who,
      direction,
      what: String(p.what ?? ''),
      due: p.due ?? null,
      status: p.status === 'done' ? 'done' : 'open',
      made_at: dateIso,
      meeting_ref: null,
    })
  }

  // Call 2: the four other artefacts. One retry: free-running JSON output
  // is occasionally malformed (unescaped quotes in the cleaned transcript).
  let art = null
  let lastErr = null
  for (let attempt = 0; attempt < 2 && !art; attempt++) {
    try {
      const artefactsRaw = await chat(
        [
          { role: 'system', content: ARTEFACTS_SYSTEM },
          { role: 'user', content: JSON.stringify({
              meeting: { title: 'Captured session', date: dateIso, attendees: attendeeList },
              transcript,
            }) },
        ],
        8192,
      )
      art = extractJson(artefactsRaw)
    } catch (err) {
      lastErr = err
    }
  }
  if (!art) throw lastErr

  return {
    artefact_set: {
      summary: String(art.summary ?? ''),
      to_dos: (art.to_dos ?? []).map((t, i) => ({
        id: `td_${String(i + 1).padStart(3, '0')}`,
        text: String(t.text ?? ''),
        owner: t.owner ?? null,
        due: t.due ?? null,
        status: t.status === 'done' ? 'done' : 'open',
        source: String(t.source ?? 'transcript'),
      })),
      cleaned_transcript: String(art.cleaned_transcript ?? ''),
      details: String(art.details ?? ''),
      promises,
    },
    people: promises.map((p) => p.who),
  }
}

function otherParty(name, attendeeList) {
  const n = String(name ?? '').toLowerCase()
  if (n.includes('henry')) return null
  // Normalise to the canonical attendee spelling.
  const hit = attendeeList.find((a) => a.toLowerCase().split(' ').some((w) => w.length > 3 && n.includes(w)))
  return hit ?? String(name)
}
