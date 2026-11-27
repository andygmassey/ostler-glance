// Tests for the Ostler Glance mock backend (node --test).
// Includes the hard-rule proofs: no audio accepted, nothing written to disk.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = 8971
const BASE = `http://127.0.0.1:${PORT}`
const PAIR_CODE = '7391-2248'
let proc
let token

async function api(method, p, body, auth = true) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

before(async () => {
  proc = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), PAIR_CODE },
    cwd: mkdtempSync(path.join(tmpdir(), 'og-backend-test-')),
    stdio: 'ignore',
  })
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`)
      if (r.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('backend did not start')
})

after(() => proc?.kill())

test('healthz', async () => {
  const r = await fetch(`${BASE}/healthz`)
  assert.equal(r.status, 200)
})

test('audio is refused at the door', async () => {
  const res = await fetch(`${BASE}/v1/transcript`, {
    method: 'POST',
    headers: { 'content-type': 'audio/wav' },
    body: Buffer.from('RIFF fake audio'),
  })
  assert.equal(res.status, 415)
  const body = await res.json()
  assert.equal(body.error, 'audio_rejected')
})

test('non-JSON posts are refused', async () => {
  const res = await fetch(`${BASE}/v1/transcript`, {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data' },
    body: 'x=1',
  })
  assert.equal(res.status, 415)
})

test('endpoints require the pairing token', async () => {
  const r = await api('GET', '/v1/next-card', undefined, false)
  assert.equal(r.status, 401)
})

test('pair round trip', async () => {
  const bad = await api('POST', '/v1/pair', { code: '0000-0000' }, false)
  assert.equal(bad.status, 401)
  const good = await api('POST', '/v1/pair', { code: PAIR_CODE }, false)
  assert.equal(good.status, 200)
  assert.ok(good.body.token)
  token = good.body.token
})

test('full contract round trip: session → transcript (live catch) → card → confirm', async () => {
  const s = await api('POST', '/v1/sessions', { source: 'tap' })
  assert.equal(s.status, 201)

  const t = await api('POST', '/v1/transcript', {
    session_id: s.body.session_id,
    seq: 0,
    text: 'Hi Henry — Eleanor Whitfield from Halcyon Summit, good to see you.',
  })
  assert.equal(t.status, 202)
  assert.equal(t.body.live_catch.kind, 'name')
  assert.equal(t.body.live_catch.text, 'Eleanor Whitfield')

  const nc = await api('GET', '/v1/next-card')
  assert.equal(nc.status, 200)
  assert.equal(nc.body.trigger, 'calendar_event')
  assert.equal(nc.body.event.id, 'evt_halcyon_checkin')
  assert.equal(nc.body.people[0].person.full_name, 'Eleanor Whitfield')
  assert.ok(nc.body.people[0].open_promises.some((p) => p.direction === 'owed_by_me' && p.age_days >= 0))

  const card = await api('GET', `/v1/people/per_eleanor_whitfield/card`)
  assert.equal(card.status, 200)
  assert.equal(card.body.person.company, 'Halcyon Summit')
  assert.equal(card.body.last_meeting.artefact_set.promises.length, 2)

  const action = nc.body.people[0].actions[0]
  const c = await api('POST', `/v1/actions/${action.id}/confirm`)
  assert.equal(c.status, 200)
  assert.equal(c.body.status, 'completed')

  const cardAfter = await api('GET', `/v1/people/per_eleanor_whitfield/card`)
  assert.equal(cardAfter.body.actions[0].status, 'completed')
})

test('nothing is written to disk during a session', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'og-nofiles-'))
  const beforeFiles = readdirSync(dir)
  const p = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT + 1), PAIR_CODE },
    cwd: dir,
    stdio: 'ignore',
  })
  try {
    for (let i = 0; i < 50; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT + 1}/healthz`)
        if (r.ok) break
      } catch {}
      await new Promise((r) => setTimeout(r, 100))
    }
    const pair = await (
      await fetch(`http://127.0.0.1:${PORT + 1}/v1/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: PAIR_CODE }),
      })
    ).json()
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${pair.token}` }
    const sess = await (
      await fetch(`http://127.0.0.1:${PORT + 1}/v1/sessions`, { method: 'POST', headers, body: '{"source":"tap"}' })
    ).json()
    await fetch(`http://127.0.0.1:${PORT + 1}/v1/transcript`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ session_id: sess.session_id, seq: 0, text: 'test chunk, fictional' }),
    })
    await fetch(`http://127.0.0.1:${PORT + 1}/v1/sessions/${sess.session_id}/close`, { method: 'POST', headers })
    await fetch(`http://127.0.0.1:${PORT + 1}/v1/next-card`, { headers })
    assert.deepEqual(readdirSync(dir), beforeFiles, 'no file may appear in the working directory')
  } finally {
    p.kill()
  }
})
