import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import {
  Display,
  sectionLabel,
  name28,
  line16,
  promise18,
  right14,
  opener14,
  hint12,
  divider,
  cue,
  CONTENT_W,
} from './display'

// Ostler Glance — live capture. The mic streams PCM from the
// WebView plugin to the Studio Whisper service; only text ever reaches the
// backend (contract v0.1, text-in only). Audio chunks live in memory and
// are released the moment they are posted — never written anywhere.
// v2: screens render as dithered bitmaps (display.ts) — the SDK text
// container offers one font and a brightness byte, not a design language.

const API_BASE: string = import.meta.env.VITE_API_BASE ?? 'http://localhost:8471'
const STT_BASE: string = import.meta.env.VITE_STT_BASE ?? 'http://localhost:8472'
const PAIR_CODE: string = import.meta.env.VITE_PAIR_CODE ?? '7391-2248'
// 3.5 s windows at 16 kHz s16le mono = 112000 bytes per chunk.
const CHUNK_BYTES = 112000

const bridge = await waitForEvenAppBridge()
const display = new Display(bridge)

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

// ---------- capture state (audio lives here, in memory only) ----------
let capturing = false
let audioParts: Uint8Array[] = []
let audioLen = 0
let captureSessionId: string | null = null
let transcriptSeq = 0
let lastCatch: { kind: string; text: string } | null = null
let capturedChunks = 0
let pulse = false
let pulseTimer: number | undefined

function cuePaint(extra: (ctx: CanvasRenderingContext2D) => void) {
  return (ctx: CanvasRenderingContext2D) => {
    cue(ctx, pulse ? 1 : 0)
    extra(ctx)
    hint12(ctx, 'Tap: stop · 2× tap: exit', 252)
  }
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

// Flushes are chained, never concurrent: each run snapshots the session id
// before its first await, so a stopCapture mid-flight can't null it out
// from under a transcript post (that race 404'd the backend).
let flushQueue: Promise<void> = Promise.resolve()

function flushChunk() {
  if (!capturing || audioLen === 0 || !captureSessionId) return
  flushQueue = flushQueue.then(doFlush)
}

async function doFlush() {
  if (audioLen === 0) return
  const sessionId = captureSessionId
  const merged = new Uint8Array(audioLen)
  let off = 0
  for (const part of audioParts) {
    merged.set(part, off)
    off += part.length
  }
  audioParts = [] // released: the buffer is not retained after posting
  audioLen = 0
  if (!sessionId) return
  const seq = transcriptSeq++
  try {
    const stt = await postSttChunk(sessionId, seq, merged)
    capturedChunks += 1
    if (stt.text) {
      const t = await api('POST', '/v1/transcript', {
        session_id: sessionId,
        seq,
        text: stt.text,
      })
      if (t.live_catch) lastCatch = t.live_catch
    }
    if (capturing) await paintCapturing()
  } catch (err) {
    console.log('chunk failed:', err, 'session:', sessionId, 'seq:', seq)
  }
}

// ---------- view state machine: card → capturing → post-capture → done ----------
type View = 'card' | 'capturing' | 'post-capture' | 'done'
let view: View = 'card'
let cardPage = 0

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

function fmtDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' }).toUpperCase()}`
}

function arrowOf(pr: any): string {
  return pr.direction === 'owed_by_me' ? '→ you owe:' : '← they owe:'
}

function cardGlancePaint(c: any) {
  return (ctx: CanvasRenderingContext2D) => {
    const p = c.people[0]
    const when = c.event ? ` — ${fmtDay(c.event.starts_at)}` : ''
    sectionLabel(ctx, `Coming up${when}`, 16)
    name28(ctx, p.person.full_name, 36)
    line16(ctx, `${p.person.role} · ${p.person.company}`, 76)
    const top = p.open_promises.find((pr: any) => pr.direction === 'owed_by_me')
      ?? p.open_promises[0]
    if (top) {
      promise18(ctx, arrowOf(top), fit(ctx, top.what, CONTENT_W - 120), 124)
      right14(ctx, `${top.age_days}d`, 127)
    }
    divider(ctx, 168)
    opener14(ctx, fit(ctx, `Opener: ${p.suggested_opener}`, CONTENT_W), 184)
    hint12(ctx, 'Tap: transcribe · Scroll: promises · 2× tap: exit', 252)
  }
}

function cardLedgerPaint(c: any) {
  return (ctx: CanvasRenderingContext2D) => {
    const p = c.people[0]
    const first = p.person.full_name.split(' ')[0]
    sectionLabel(ctx, `Promises — ${first}`, 16)
    const rows = p.open_promises.slice(0, 4)
    const rowH = 48
    rows.forEach((pr: any, i: number) => {
      const y = 44 + i * rowH
      promise18(ctx, arrowOf(pr), fit(ctx, pr.what, CONTENT_W - 150), y)
      // Ledger rows carry absolute dates only (design spec).
      right14(ctx, pr.due ? `DUE ${fmtDay(pr.due)}` : `MADE ${fmtDay(pr.made_at)}`, y + 3)
      if (i < rows.length - 1) divider(ctx, y + rowH - 12)
    })
    if (rows.length === 0) line16(ctx, 'Nothing open. Clean slate.', 44)
    hint12(ctx, 'Scroll: back · 2× tap: exit', 252)
  }
}

async function paintCard() {
  if (!card) {
    await display.render((ctx) => {
      sectionLabel(ctx, 'Ostler Glance', 16)
      name28(ctx, 'No upcoming meetings', 36)
      hint12(ctx, '2× tap: exit', 252)
    })
    return
  }
  await display.render(cardPage === 0 ? cardGlancePaint(card) : cardLedgerPaint(card))
}

function paintCapturing() {
  return display.render(cuePaint((ctx) => {
    if (lastCatch) {
      line16(ctx, `Caught ${lastCatch.kind}:`, 60, 0.6)
      // The catch is the hero: name at 28px semibold, held on screen.
      name28(ctx, fit(ctx, lastCatch.text, CONTENT_W), 84)
    }
  }))
}

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
      await display.render((ctx) => {
        name28(ctx, 'Mic unavailable', 36)
        hint12(ctx, 'Tap: try again · 2× tap: exit', 252)
      })
      return
    }
    const s = await api('POST', '/v1/sessions', { source: 'tap' })
    console.log('session created:', JSON.stringify(s))
    capturing = true
    view = 'capturing'
    captureSessionId = s.session_id
    transcriptSeq = 0
    capturedChunks = 0
    lastCatch = null
    audioParts = []
    audioLen = 0
    pulseTimer = window.setInterval(() => {
      pulse = !pulse
      // Only the top-left tile holds the cue dot.
      display.render(cuePaint((ctx) => {
        if (lastCatch) {
          line16(ctx, `Caught ${lastCatch.kind}:`, 60, 0.6)
          name28(ctx, fit(ctx, lastCatch.text, CONTENT_W), 84)
        }
      }), 1).catch(() => {})
    }, 450)
    await paintCapturing()
  } catch (err) {
    await display.render((ctx) => {
      name28(ctx, 'Capture failed to start', 36)
      hint12(ctx, 'Tap: try again · 2× tap: exit', 252)
    })
  } finally {
    busy = false
  }
}

async function stopCapture() {
  if (!capturing) return
  capturing = false
  window.clearInterval(pulseTimer)
  try {
    await bridge.audioControl(false)
  } catch {}
  flushChunk()
  await flushQueue
  await display.render((ctx) => {
    name28(ctx, 'Farmed.', 40)
    line16(ctx, `${capturedChunks} windows transcribed`, 84)
    if (lastCatch) promise18(ctx, 'Last catch:', lastCatch.text, 124)
    hint12(ctx, 'Tap: send follow-up · 2× tap: exit', 252)
  })
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

async function boot() {
  try {
    await display.init()
    const pair = await api('POST', '/v1/pair', { code: PAIR_CODE })
    token = pair.token
    card = await api('GET', '/v1/next-card')
    cardPage = 0
    console.log('boot: card', card ? 'loaded' : 'empty (204)')
    await paintCard()
  } catch (err) {
    console.log('boot failed:', err)
    await display.render((ctx) => {
      sectionLabel(ctx, 'Ostler Glance', 16)
      name28(ctx, 'Backend unreachable', 36)
      hint12(ctx, 'Tap: retry · 2× tap: exit', 252)
    })
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
    await display.render((ctx) => {
      name28(ctx, 'Nothing to send', 36)
      hint12(ctx, 'Tap: back to card · 2× tap: exit', 252)
    })
    return
  }
  busy = true
  try {
    const result = await api('POST', `/v1/actions/${action.id}/confirm`)
    action.status = result.status
    view = 'done'
    await display.render((ctx) => {
      name28(ctx, 'Done', 40)
      promise18(ctx, 'Sent:', fit(ctx, action.label, CONTENT_W - 80), 84)
      line16(ctx, fit(ctx, result.detail, CONTENT_W), 116)
      hint12(ctx, 'Tap: back to card · 2× tap: exit', 252)
    })
  } catch {
    await display.render((ctx) => {
      name28(ctx, 'Failed', 40)
      line16(ctx, 'Try again.', 84)
      hint12(ctx, 'Tap: retry · 2× tap: exit', 252)
    })
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
      window.clearInterval(pulseTimer)
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
      paintCard()
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
      paintCard()
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
