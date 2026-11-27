// Ostler Glance mock backend — implements API_CONTRACT.yaml v0.1.
// Zero-dependency Node (>=18). TEXT-IN ONLY: no endpoint accepts audio;
// any audio/* request is rejected and nothing is written to disk.
//
// Config via env (no keys in the repo):
//   PORT         listen port (default 8471)
//   PAIR_CODE    pairing code (default 7391-2248 — demo mock only)
//   CORS_ORIGIN  allowed origin for the WebView/simulator (default *)
//
// Mock mode: data lives in memory from world.js (fictional fixture).
// Nothing is persisted; restart resets. Days 2-3 replace the stubs with
// Whisper ingest and the ollama extraction call.

import { createServer } from 'node:http'
import { PEOPLE, MEETINGS, EVENTS, OPENERS, ACTIONS, LIVE_CATCH_PATTERNS } from './world.js'
import { farmSession } from './farming.js'

const PORT = Number(process.env.PORT ?? 8471)
const PAIR_CODE = process.env.PAIR_CODE ?? '7391-2248'
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*'
const FARMING = !!process.env.OLLAMA_BASE
const ISSUED_TOKENS = new Set()
const SESSIONS = new Map()
const CONFIRMED_ACTIONS = new Set()
let seq = 0

const json = (res, status, body) => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': CORS_ORIGIN,
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  })
  res.end(JSON.stringify(body))
}

const ageDays = (madeAt) =>
  Math.max(0, Math.floor((Date.now() - new Date(madeAt).getTime()) / 86400000))

const withAge = (p) => ({ ...p, age_days: ageDays(p.made_at) })

const openPromisesFor = (personId) =>
  Object.values(MEETINGS)
    .filter((m) => m.people.includes(personId))
    .flatMap((m) => m.artefact_set.promises)
    .filter((p) => p.status === 'open')
    .map(withAge)

const personCard = (personId) => {
  const person = PEOPLE[personId]
  if (!person) return null
  const meetings = Object.values(MEETINGS)
    .filter((m) => m.people.includes(personId))
    .sort((a, b) => b.at.localeCompare(a.at))
  const last = meetings[0] ?? null
  return {
    person,
    last_meeting: last
      ? { meeting_id: last.meeting_id, at: last.at, artefact_set: last.artefact_set }
      : null,
    open_promises: openPromisesFor(personId),
    suggested_opener: OPENERS[personId] ?? '',
    actions: (ACTIONS[personId] ?? []).map((a) =>
      CONFIRMED_ACTIONS.has(a.id) ? { ...a, status: 'completed' } : a,
    ),
  }
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const authenticated = (req) => {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  return token !== null && ISSUED_TOKENS.has(token)
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {})
  const url = new URL(req.url, `http://${req.headers.host}`)
  const path = url.pathname
  console.log(`${new Date().toISOString()} ${req.method} ${path}`)

  // TEXT-IN ONLY: refuse anything that smells like audio at the door. JSON
  // is required only when a body is actually present (bodyless POSTs like
  // action confirm are legal).
  const contentType = req.headers['content-type'] ?? ''
  const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined
  if (contentType.startsWith('audio/')) {
    return json(res, 415, { error: 'audio_rejected', detail: 'Text-in API: raw audio is never accepted.' })
  }
  if (req.method === 'POST' && hasBody && !contentType.startsWith('application/json')) {
    return json(res, 415, { error: 'unsupported_media_type', detail: 'application/json only.' })
  }

  if (path === '/healthz') return json(res, 200, { ok: true, mock: true })

  if (path === '/v1/pair' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}')
    if (body.code !== PAIR_CODE) return json(res, 401, { error: 'bad_code' })
    const token = `tok_mock_${++seq}_${Math.random().toString(36).slice(2, 10)}`
    ISSUED_TOKENS.add(token)
    return json(res, 200, { token, expires_at: new Date(Date.now() + 7 * 86400000).toISOString() })
  }

  if (!authenticated(req)) return json(res, 401, { error: 'unauthorized' })

  if (path === '/v1/sessions' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}')
    const sessionId = `ses_${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '')}_${++seq}`
    SESSIONS.set(sessionId, { event_id: body.event_id ?? null, chunks: [], opened_at: new Date().toISOString() })
    return json(res, 201, { session_id: sessionId, opened_at: SESSIONS.get(sessionId).opened_at })
  }

  if (path === '/v1/transcript' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}')
    const session = SESSIONS.get(body.session_id)
    if (!session) return json(res, 404, { error: 'no_such_session' })
    session.chunks.push({ seq: body.seq, at: body.at ?? null, text: String(body.text ?? '') })
    const text = session.chunks.map((c) => c.text).join(' ')
    const hit = LIVE_CATCH_PATTERNS.find((p) => text.includes(p.text))
    return json(res, 202, {
      accepted: true,
      live_catch: hit ? { kind: hit.kind, text: hit.text, confidence: 0.9 } : null,
    })
  }

  const closeMatch = path.match(/^\/v1\/sessions\/([^/]+)\/close$/)
  if (closeMatch && req.method === 'POST') {
    const session = SESSIONS.get(closeMatch[1])
    if (!session) return json(res, 404, { error: 'no_such_session' })
    const transcript = session.chunks
      .sort((a, b) => a.seq - b.seq)
      .map((c) => c.text)
      .join('\n')
    if (FARMING && transcript.trim()) {
      // Real farming: two local ollama calls (qwen2.5:7b). On any failure
      // fall back to the canned fixture so the demo never hard-fails.
      try {
        const farmed = await farmSession(transcript, {
          knownPeople: Object.values(PEOPLE),
        })
        return json(res, 200, {
          session_id: closeMatch[1],
          meeting_id: `mtg_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_captured`,
          artefact_set: farmed.artefact_set,
          people: [...new Set(farmed.people)].map((name) => {
            const known = Object.values(PEOPLE).find((p) => p.full_name === name)
            return known ? { id: known.id, full_name: known.full_name } : { id: null, full_name: name }
          }),
        })
      } catch (err) {
        console.log(`farming failed, using fixture: ${err.message}`)
      }
    }
    const meeting = Object.values(MEETINGS)[0]
    return json(res, 200, {
      session_id: closeMatch[1],
      meeting_id: meeting.meeting_id,
      artefact_set: meeting.artefact_set,
      people: meeting.people.map((id) => ({ id, full_name: PEOPLE[id].full_name })),
    })
  }

  const cardMatch = path.match(/^\/v1\/people\/([^/]+)\/card$/)
  if (cardMatch && req.method === 'GET') {
    const card = personCard(cardMatch[1])
    if (!card) return json(res, 404, { error: 'no_such_person' })
    return json(res, 200, card)
  }

  if (path === '/v1/next-card' && req.method === 'GET') {
    const event = Object.values(EVENTS).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]
    if (!event) return json(res, 204, {})
    const known = event.attendees.filter((id) => PEOPLE[id])
    if (known.length === 0) return json(res, 204, {})
    return json(res, 200, {
      trigger: 'calendar_event',
      event,
      people: known.map(personCard),
      suggested_opener: OPENERS[known[0]] ?? '',
    })
  }

  const actionMatch = path.match(/^\/v1\/actions\/([^/]+)\/confirm$/)
  if (actionMatch && req.method === 'POST') {
    const actionId = actionMatch[1]
    const exists = Object.values(ACTIONS).flat().some((a) => a.id === actionId)
    if (!exists) return json(res, 404, { error: 'no_such_action' })
    CONFIRMED_ACTIONS.add(actionId)
    return json(res, 200, {
      action_id: actionId,
      status: 'completed',
      detail: 'Drafted email queued to the owner\'s Gmail (mock).',
    })
  }

  return json(res, 404, { error: 'not_found', detail: path })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ostler-glance mock backend on 0.0.0.0:${PORT} (mock mode, fictional data only)`)
})
