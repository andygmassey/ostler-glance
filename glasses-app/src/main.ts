import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

// Ostler Glance — Day 2: live capture. The mic streams PCM from the
// WebView plugin to the Studio Whisper service; only text ever reaches the
// backend (contract v0.1, text-in only). Audio chunks live in memory and
// are released the moment they are posted — never written anywhere.

const API_BASE: string = import.meta.env.VITE_API_BASE ?? 'http://localhost:8471'
const STT_BASE: string = import.meta.env.VITE_STT_BASE ?? 'http://localhost:8472'
const PAIR_CODE: string = import.meta.env.VITE_PAIR_CODE ?? '7391-2248'
// 3.5 s windows at 16 kHz s16le mono = 112000 bytes per chunk.
const CHUNK_BYTES = 112000

const bridge = await waitForEvenAppBridge()

async function api(method: string, path: string, body?: unknown, retried = false): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  // Tokens are server-side and can die with a backend restart or expiry:
  // re-pair once and retry, then give up.
  if (res.status === 401 && path !== '/v1/pair' && !retried) {
    const pair = await api('POST', '/v1/pair', { code: PAIR_CODE }, true)
    token = pair.token
    return api(method, path, body, true)
  }
  if (res.status === 204) return null
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`)
  return res.json()
}

async function postSttChunk(sessionId: string, seq: number, pcm: Uint8Array): Promise<any> {
  const res = await fetch(`${STT_BASE}/v1/stt/chunk`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-session-id': sessionId,
      'x-seq': String(seq),
    },
    body: new Blob([pcm as unknown as ArrayBuffer]),
  })
  if (!res.ok) throw new Error(`stt chunk → ${res.status}`)
  return res.json()
}

let token: string | null = null
let card: any = null
let busy = false

function show(content: string) {
  return bridge.textContainerUpgrade(
    new TextContainerUpgrade({ containerID: 1, containerName: 'main', content }),
  )
}

const EXIT_HINT = '\n2× tap: exit'

// ---------- capture state (audio lives here, in memory only) ----------
let capturing = false
let audioParts: Uint8Array[] = []
let audioLen = 0
let captureSessionId: string | null = null
let transcriptSeq = 0
let lastCatch: { kind: string; text: string } | null = null
let capturedChunks = 0

function cueText(extra = ''): string {
  const lines = ['Transcribing…']
  if (lastCatch) lines.push(`Caught ${lastCatch.kind}: ${lastCatch.text}`)
  lines.push('Tap: stop')
  return lines.join('\n') + (extra ? '\n' + extra : '') + EXIT_HINT
}

function pcmBytes(pcm: any): Uint8Array {
  if (pcm instanceof Uint8Array) return pcm
  if (Array.isArray(pcm)) return Uint8Array.from(pcm)
  if (typeof pcm === 'string') {
    const bin = atob(pcm)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return new Uint8Array(0)
}

async function flushChunk() {
  if (!capturing || audioLen === 0 || !captureSessionId) return
  const merged = new Uint8Array(audioLen)
  let off = 0
  for (const part of audioParts) {
    merged.set(part, off)
    off += part.length
  }
  audioParts = [] // released: the buffer is not retained after posting
  audioLen = 0
  const seq = transcriptSeq++
  try {
    const stt = await postSttChunk(captureSessionId, seq, merged)
    capturedChunks += 1
    if (stt.text) {
      const t = await api('POST', '/v1/transcript', {
        session_id: captureSessionId,
        seq,
        text: stt.text,
      })
      if (t.live_catch) lastCatch = t.live_catch
    }
    if (capturing) await show(cueText())
  } catch (err) {
    console.log('chunk failed:', err)
  }
}

// ---------- view state machine: card → capturing → post-capture → done ----------
type View = 'card' | 'capturing' | 'post-capture' | 'done'
let view: View = 'card'

async function startCapture() {
  if (busy || capturing) return
  busy = true
  console.log('startCapture: requesting mic…')
  let micTimer: number | undefined
  try {
    const mic = await Promise.race([
      bridge.audioControl(true),
      new Promise<false>((resolve) => {
        micTimer = window.setTimeout(() => {
          console.log('audioControl timed out')
          resolve(false)
        }, 4000)
      }),
    ])
    window.clearTimeout(micTimer)
    console.log('audioControl returned:', mic)
    if (!mic) {
      await show('Mic unavailable\nTap: try again' + EXIT_HINT)
      return
    }
    const s = await api('POST', '/v1/sessions', { source: 'tap' })
    capturing = true
    view = 'capturing'
    captureSessionId = s.session_id
    transcriptSeq = 0
    capturedChunks = 0
    lastCatch = null
    audioParts = []
    audioLen = 0
    await show(cueText())
  } catch (err) {
    await show('Capture failed to start\nTap: try again' + EXIT_HINT)
  } finally {
    busy = false
  }
}

async function stopCapture() {
  if (!capturing) return
  capturing = false
  try {
    await bridge.audioControl(false)
  } catch {}
  await flushChunk()
  await show(
    `Capture ended\n${capturedChunks} windows transcribed` +
      (lastCatch ? `\nLast catch: ${lastCatch.text}` : '') +
      '\nTap: send follow-up' + EXIT_HINT,
  )
  view = 'post-capture'
  captureSessionId = null
}

// Re-arm the mic when the WebView comes back from suspension: the host
// stops audio when the page suspends, so every resume re-opens it.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && capturing) {
    bridge.audioControl(true).then(ok => console.log('re-armed mic:', ok))
  }
})
window.addEventListener('focus', () => {
  if (capturing) bridge.audioControl(true).then(ok => console.log('re-armed mic:', ok))
})

// ---------- card (recall + one-tap action, Day 1; glance pages, Day 4) ----------
let cardPage = 0

function promiseLine(pr: any): string {
  const arrow = pr.direction === 'owed_by_me' ? '→ you owe' : '← they owe'
  return `${arrow}: ${pr.what} (${pr.age_days}d)`
}

function cardText(c: any, page: number): string {
  const p = c.people[0]
  if (page === 1) {
    // Ledger page: every open promise with this person.
    const lines = [`Promises: ${p.person.full_name.split(' ')[0]}`]
    for (const pr of p.open_promises.slice(0, 4)) lines.push(promiseLine(pr))
    if (p.open_promises.length === 0) lines.push('Nothing open. Clean slate.')
    lines.push('Scroll: back')
    return lines.join('\n') + EXIT_HINT
  }
  // The glance: one thing — who they are, what you owe, how to open.
  const lines = [`${p.person.full_name}`, `${p.person.role} · ${p.person.company}`]
  const top = p.open_promises.find((pr: any) => pr.direction === 'owed_by_me')
    ?? p.open_promises[0]
  if (top) lines.push(promiseLine(top))
  lines.push(`Opener: ${p.suggested_opener}`)
  lines.push('Tap: transcribe · Scroll: promises')
  return lines.join('\n') + EXIT_HINT
}

async function boot() {
  try {
    const pair = await api('POST', '/v1/pair', { code: PAIR_CODE })
    token = pair.token
    card = await api('GET', '/v1/next-card')
    cardPage = 0
    console.log('boot: card', card ? 'loaded' : 'empty (204)')
    await show(card ? cardText(card, 0) : 'Ostler Glance\nTap: start transcribing' + EXIT_HINT)
  } catch (err) {
    console.log('boot failed:', err)
    await show(`Ostler Glance\nBackend unreachable\n(${API_BASE})` + EXIT_HINT)
  }
}

async function confirmFirstAction() {
  if (busy || !card) {
    console.log(`confirm skipped: busy=${busy} card=${card ? 'set' : 'NULL'}`)
    return
  }
  const action = card.people[0].actions.find((a: any) => a.status === 'drafted')
  if (!action) {
    view = 'done'
    await show('Nothing to send\nTap: back to card' + EXIT_HINT)
    return
  }
  busy = true
  try {
    const result = await api('POST', `/v1/actions/${action.id}/confirm`)
    action.status = result.status
    view = 'done'
    await show(`Done: ${action.label}\n${result.detail}` + EXIT_HINT)
  } catch {
    await show(`Failed: ${action.label}\nTry again.` + EXIT_HINT)
  } finally {
    busy = false
  }
}

const mainText = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 1,
  containerName: 'main',
  content: 'Ostler Glance\nPairing…',
  isEventCapture: 1,
})

const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [mainText] }),
)
console.log('Page created:', result === 0 ? 'success' : `failed (${result})`)

// CLICK_EVENT is 0 and protobuf omits zero-value fields, so a single tap
// arrives with `eventType` undefined; resolve the default only inside the
// envelope check, never with `??` on a possibly-absent sysEvent.
function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

const unsubscribe = bridge.onEvenHubEvent(event => {
  // Audio arrives in its own envelope; feed the buffer and never treat it
  // as a gesture.
  if (event.audioEvent) {
    if (!capturing) return
    const bytes = pcmBytes(event.audioEvent.audioPcm)
    if (bytes.length) {
      audioParts.push(bytes)
      audioLen += bytes.length
      if (audioLen >= CHUNK_BYTES) flushChunk()
    }
    return
  }

  const sysType = eventTypeOf(event.sysEvent)
  const textType = eventTypeOf(event.textEvent)

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    if (capturing) {
      // Best effort: close the mic before exiting.
      capturing = false
      bridge.audioControl(false).catch(() => {})
    }
    bridge.shutDownPageContainer(1)
    return
  }

  if (sysType === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
    // App returned to the foreground: the host may have dropped the mic
    // while backgrounded — re-arm it if a capture is in progress.
    if (capturing) {
      bridge.audioControl(true).then(ok => console.log('re-armed mic on foreground:', ok))
    }
    return
  }

  if (sysType === OsEventTypeList.SCROLL_TOP_EVENT || textType === OsEventTypeList.SCROLL_TOP_EVENT
      || sysType === OsEventTypeList.SCROLL_BOTTOM_EVENT || textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    if (view === 'card' && card) {
      cardPage = cardPage === 0 ? 1 : 0
      show(cardText(card, cardPage))
    }
    return
  }

  if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
    console.log(`tap: view=${view} busy=${busy}`)
    if (view === 'capturing') {
      stopCapture()
    } else if (view === 'post-capture') {
      confirmFirstAction()
    } else if (view === 'done') {
      view = 'card'
      cardPage = 0
      show(card ? cardText(card, 0) : 'Ostler Glance' + EXIT_HINT)
    } else {
      if (!card) {
        boot() // boot failed earlier (e.g. blip during reload): retry it
      } else {
        startCapture()
      }
    }
    return
  }

  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    unsubscribe()
  }
})

boot()
