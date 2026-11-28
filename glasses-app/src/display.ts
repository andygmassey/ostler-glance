// Bitmap display for the Even G2 monochrome panel (576×288).
//
// The SDK text container offers one font and a brightness byte — not
// enough for the glance-card design language. Image containers take raw
// grayscale bytes, so every screen is rendered into an offscreen canvas,
// dithered to the panel's coverage levels (the simulator renders 1-bit;
// the glasses convert to gray4 — ordered dither reads as opacity on
// both), and pushed as four 288×144 tiles (the per-container size cap).

export const PANEL_W = 576
export const PANEL_H = 288
export const MARGIN = 20
export const CONTENT_W = PANEL_W - MARGIN * 2

// 4×4 Bayer matrix, normalized thresholds (v + 0.5) / 16.
const BAYER = [
  [0.03, 0.53, 0.16, 0.66],
  [0.78, 0.28, 0.91, 0.41],
  [0.22, 0.72, 0.09, 0.59],
  [0.84, 0.34, 0.97, 0.47],
]

export type Opacity = 1 | 0.6 | 0.2

const FONT = 'Helvetica, Arial, sans-serif'

export class Display {
  private ctx: CanvasRenderingContext2D
  private img: ImageData
  private bridge: any
  private tilesSent = false

  constructor(bridge: any) {
    this.bridge = bridge
    const cv = document.createElement('canvas')
    cv.width = PANEL_W
    cv.height = PANEL_H
    this.ctx = cv.getContext('2d')!
    this.img = this.ctx.createImageData(PANEL_W, PANEL_H)
  }

  // Rebuild the page: invisible text layer keeps gesture capture working
  // (image containers can't capture); four image tiles cover the panel.
  async init(): Promise<void> {
    await this.bridge.rebuildPageContainer({
      containerTotalNum: 5,
      textObject: [{
        xPosition: 0, yPosition: 0, width: PANEL_W, height: PANEL_H,
        containerID: 1, containerName: 'main', content: ' ',
        isEventCapture: 1, zOrderIndex: 0,
      }],
      imageObject: [0, 1, 2, 3].map((i) => ({
        xPosition: (i % 2) * 288, yPosition: Math.floor(i / 2) * 144,
        width: 288, height: 144, containerID: 11 + i, containerName: 'tile' + i,
        zOrderIndex: 1 + i,
      })),
    })
  }

  // Draw the screen in `paint`, dither, and push the tiles in `mask`
  // (bitmask of quadrants: 1=TL 2=TR 4=BL 8=BR; 15=all).
  async render(paint: (ctx: CanvasRenderingContext2D) => void, mask = 15): Promise<void> {
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, PANEL_W, PANEL_H)
    ctx.fillStyle = '#fff' // primitives set alpha, never color
    paint(ctx)
    const src = ctx.getImageData(0, 0, PANEL_W, PANEL_H).data
    const out = this.img.data
    for (let y = 0; y < PANEL_H; y++) {
      const row = y * PANEL_W
      for (let x = 0; x < PANEL_W; x++) {
        const i = (row + x) * 4
        // Elements draw white at globalAlpha over the opaque black ground,
        // so luminance / 255 is the effective opacity; the ordered dither
        // turns coverage into the panel's pseudo-gray levels.
        const lum = (src[i] + src[i + 1] + src[i + 2]) / 3 / 255
        const on = lum > BAYER[y % 4][x % 4]
        out[i] = out[i + 1] = out[i + 2] = on ? 255 : 0
        out[i + 3] = 255
      }
    }
    for (let t = 0; t < 4; t++) {
      if (!(mask & (1 << t))) continue
      const q = new Uint8Array(288 * 144)
      const ox = (t % 2) * 288
      const oy = Math.floor(t / 2) * 144
      for (let y = 0; y < 144; y++) {
        for (let x = 0; x < 288; x++) {
          q[y * 288 + x] = this.img.data[((y + oy) * PANEL_W + (x + ox)) * 4]
        }
      }
      await this.bridge.updateImageRawData({
        containerID: 11 + t, containerName: 'tile' + t, imageData: Array.from(q),
      })
    }
    this.tilesSent = true
  }
}

// ---- typographic primitives (all coordinates top-left origin) ----

export function sectionLabel(ctx: CanvasRenderingContext2D, text: string, y: number) {
  ctx.save()
  ctx.globalAlpha = 0.6
  ctx.font = `11px ${FONT}`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  let x = MARGIN
  for (const ch of text.toUpperCase()) {
    ctx.fillText(ch, x, y)
    x += ctx.measureText(ch).width + 2.5
  }
  ctx.restore()
}

export function name28(ctx: CanvasRenderingContext2D, text: string, y: number) {
  ctx.save()
  ctx.font = `600 28px ${FONT}`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText(text, MARGIN, y)
  ctx.restore()
}

export function line16(ctx: CanvasRenderingContext2D, text: string, y: number, opacity: Opacity = 0.6) {
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.font = `16px ${FONT}`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText(text, MARGIN, y)
  ctx.restore()
}

export function promise18(ctx: CanvasRenderingContext2D, arrow: string, what: string, y: number) {
  ctx.save()
  ctx.font = `18px ${FONT}`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText(`${arrow} ${what}`, MARGIN, y)
  ctx.restore()
}

export function right14(ctx: CanvasRenderingContext2D, text: string, y: number, opacity: Opacity = 0.6) {
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.font = `14px ${FONT}`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'right'
  ctx.fillText(text, PANEL_W - MARGIN, y)
  ctx.restore()
}

export function opener14(ctx: CanvasRenderingContext2D, text: string, y: number) {
  ctx.save()
  ctx.font = `italic 14px ${FONT}`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText(text, MARGIN, y)
  ctx.restore()
}

export function hint12(ctx: CanvasRenderingContext2D, text: string, y: number) {
  ctx.save()
  ctx.globalAlpha = 0.6
  ctx.font = `12px ${FONT}`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText(text, MARGIN, y)
  ctx.restore()
}

export function divider(ctx: CanvasRenderingContext2D, y: number) {
  ctx.save()
  ctx.globalAlpha = 0.2
  ctx.fillStyle = '#fff'
  ctx.fillRect(MARGIN, y, CONTENT_W, 1)
  ctx.restore()
}

export function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save()
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function cue(ctx: CanvasRenderingContext2D, pulse: number) {
  // Fixed position on every capture-state screen: pulsing dot + label.
  dot(ctx, MARGIN + 5, 24, pulse ? 5 : 3)
  ctx.save()
  ctx.font = `14px ${FONT}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText('Transcribing…', MARGIN + 20, 24)
  ctx.restore()
}
