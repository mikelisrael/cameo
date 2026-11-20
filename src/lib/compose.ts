import { isColor, paintBackground } from './background'
import type { Face, Mask } from './protocol'

/** A shadow made from the cut-out itself. Angle 0 is light from the top (the shadow falls down). */
export type Shadow = { kind: 'none' | 'contact' | 'drop'; strength: number; angle: number }

export const NO_SHADOW: Shadow = { kind: 'none', strength: 0.5, angle: 35 }

/** Equality key for pre-render matching; the strength and angle only count when there is a shadow. */
export function shadowKey(s: Shadow): string {
  if (s.kind === 'none') return 'none'
  return `${s.kind}:${s.strength.toFixed(2)}:${s.kind === 'drop' ? Math.round(s.angle) : 0}`
}

/** Shift the subject's light toward the picked background. Experimental; strength is 0 to 1. */
export type Match = { on: boolean; strength: number }

export const NO_MATCH: Match = { on: false, strength: 0.6 }

/** Equality key for pre-render matching; the strength only counts when matching is on. */
export function matchKey(m: Match): string {
  if (!m.on || m.strength <= 0) return 'off'
  return `m${m.strength}`
}

/** Recolours `subject` in place toward `backdrop` (see relight.ts). */
export type MatchFn = (subject: HTMLCanvasElement, backdrop: HTMLCanvasElement, strength: number) => void

/**
 * Paints the shadow in output coordinates, before the subject. `box` is the subject's box on the
 * output; `src` and `dst` are the same rectangles `drawImage` uses for the subject itself.
 */
function paintShadow(
  ctx: CanvasRenderingContext2D,
  subject: HTMLCanvasElement,
  box: Box,
  src: { sx: number; sy: number; sw: number; sh: number },
  dst: { dx: number; dy: number; dw: number; dh: number },
  outW: number,
  shadow: Shadow,
) {
  const strength = Math.min(1, Math.max(0, shadow.strength))
  if (shadow.kind === 'none' || strength === 0) return
  if (shadow.kind === 'contact') {
    const rx = 0.46 * box.w
    const ry = Math.max(4, 0.045 * box.h)
    ctx.save()
    ctx.translate(box.x + box.w / 2, box.y + box.h - 0.02 * box.h)
    // A circle scaled into an oval, so the radial gradient is elliptical too.
    ctx.scale(rx, ry)
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    g.addColorStop(0, `rgba(0,0,0,${0.55 * strength})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, 1, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }
  const size = Math.max(box.w, box.h)
  const rad = (shadow.angle * Math.PI) / 180
  const dist = 0.04 * size
  // Draw the subject off-canvas and shift only its shadow back on, so the subject isn't drawn twice.
  const off = outW + Math.ceil(size)
  ctx.save()
  ctx.shadowColor = `rgba(0,0,0,${0.45 * strength})`
  ctx.shadowBlur = 0.03 * size
  ctx.shadowOffsetX = Math.sin(rad) * dist + off
  ctx.shadowOffsetY = Math.cos(rad) * dist
  ctx.drawImage(subject, src.sx, src.sy, src.sw, src.sh, dst.dx - off, dst.dy, dst.dw, dst.dh)
  ctx.restore()
}

/** Draws the original and applies the mask as alpha, at the original resolution. */
export function cutout(
  original: ImageBitmap,
  mask: Mask,
  fill?: string,
  colors?: Uint8ClampedArray,
  images?: Map<string, ImageBitmap>,
  shadow: Shadow = NO_SHADOW,
  match?: { strength: number; apply: MatchFn },
): HTMLCanvasElement {
  const w = original.width
  const h = original.height

  const subject = document.createElement('canvas')
  subject.width = w
  subject.height = h
  const c = subject.getContext('2d')!

  const small = document.createElement('canvas')
  small.width = mask.width
  small.height = mask.height
  const sctx = small.getContext('2d')!
  const img = sctx.createImageData(mask.width, mask.height)
  const count = mask.width * mask.height

  if (colors && colors.length === count * 4) {
    // Foreground colours with the old background removed from the edge, mask as alpha.
    for (let i = 0; i < count; i++) {
      img.data[i * 4] = colors[i * 4]
      img.data[i * 4 + 1] = colors[i * 4 + 1]
      img.data[i * 4 + 2] = colors[i * 4 + 2]
      img.data[i * 4 + 3] = mask.data[i]
    }
    sctx.putImageData(img, 0, 0)
    if (mask.width !== w || mask.height !== h) c.imageSmoothingQuality = 'high'
    c.drawImage(small, 0, 0, w, h)
  } else {
    // Mask as a canvas (white pixels, mask in alpha); drawn scaled up to the original size below.
    for (let i = 0; i < count; i++) {
      img.data[i * 4] = 255
      img.data[i * 4 + 1] = 255
      img.data[i * 4 + 2] = 255
      img.data[i * 4 + 3] = mask.data[i]
    }
    sctx.putImageData(img, 0, 0)
    c.drawImage(original, 0, 0)
    c.globalCompositeOperation = 'destination-in'
    c.imageSmoothingQuality = 'high'
    c.drawImage(small, 0, 0, w, h)
  }

  // iOS counts every canvas's memory until GC; zeroing the size frees it now.
  small.width = small.height = 0

  if (!fill && shadow.kind === 'none') return subject

  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const o = out.getContext('2d')!
  if (fill) paintBackground(o, fill, w, h, { original, images })
  if (fill && match) match.apply(subject, out, match.strength)
  const box = photoBox(mask, w, h)
  if (box) {
    paintShadow(o, subject, box, { sx: 0, sy: 0, sw: w, sh: h }, { dx: 0, dy: 0, dw: w, dh: h }, w, shadow)
  }
  o.drawImage(subject, 0, 0)
  subject.width = subject.height = 0
  return out
}

/** The first look at a cut-out: the photo shrunk to a preview size, the rough mask stretched over it, drawn on `fill`. */
export async function draftPreview(
  original: ImageBitmap,
  mask: Mask,
  fill: string | undefined,
  images?: Map<string, ImageBitmap>,
): Promise<{ blob: Blob; ratio: number }> {
  const k = Math.min(1, 1024 / Math.max(original.width, original.height))
  const small = await createImageBitmap(original, {
    resizeWidth: Math.max(1, Math.round(original.width * k)),
    resizeHeight: Math.max(1, Math.round(original.height * k)),
    resizeQuality: 'medium',
  })
  try {
    const canvas = cutout(small, mask, fill, undefined, images)
    const ratio = canvas.width / canvas.height
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => {
          canvas.width = canvas.height = 0
          if (b) resolve(b)
          else reject(new Error('Could not draw the first look'))
        },
        fill ? 'image/jpeg' : 'image/png',
        0.85,
      ),
    )
    return { blob, ratio }
  } finally {
    small.close()
  }
}

export type Format = 'png' | 'webp' | 'jpg'

const MIME: Record<Format, string> = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg' }
const QUALITY: Record<Format, number | undefined> = { png: undefined, webp: 0.9, jpg: 0.92 }

/** How the cut-out is framed: the whole photo, trimmed to the subject, or a preset canvas. */
export type Frame = 'photo' | 'subject' | 'square' | 'portrait' | 'story' | 'passport'

/** Output sizes of the preset frames, in pixels. */
const FRAMES: Record<'square' | 'portrait' | 'story', { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
}

type Box = { x: number; y: number; w: number; h: number }

/** Bounding box of the mask pixels that show (alpha 8 or more), in mask coordinates; null when none. */
export function subjectBox(mask: Mask): Box | null {
  const { width, height, data } = mask
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      if (data[i] < 8) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** The subject's box in photo pixels (the mask can be smaller than the photo), kept inside the photo. */
function photoBox(mask: Mask, photoW: number, photoH: number): Box | null {
  const b = subjectBox(mask)
  if (!b) return null
  const kx = photoW / mask.width
  const ky = photoH / mask.height
  const x = Math.max(0, Math.floor(b.x * kx))
  const y = Math.max(0, Math.floor(b.y * ky))
  return {
    x,
    y,
    w: Math.max(1, Math.min(photoW, Math.ceil((b.x + b.w) * kx)) - x),
    h: Math.max(1, Math.min(photoH, Math.ceil((b.y + b.h) * ky)) - y),
  }
}

export type Layout = {
  outW: number
  outH: number
  /** The region of the full-size cut-out to draw… */
  sx: number
  sy: number
  sw: number
  sh: number
  /** …and where it lands on the output canvas. */
  dx: number
  dy: number
  dw: number
  dh: number
}

/** The pure geometry of a framing: output size, source region and destination rectangle. */
export function layout(frame: Frame, box: Box | null, photoW: number, photoH: number): Layout {
  if (frame === 'subject' && box) {
    const pad = Math.round(0.06 * Math.max(box.w, box.h))
    const x0 = Math.max(0, box.x - pad)
    const y0 = Math.max(0, box.y - pad)
    const w = Math.min(photoW, box.x + box.w + pad) - x0
    const h = Math.min(photoH, box.y + box.h + pad) - y0
    return { outW: w, outH: h, sx: x0, sy: y0, sw: w, sh: h, dx: 0, dy: 0, dw: w, dh: h }
  }
  if (frame === 'photo' || frame === 'subject' || frame === 'passport') {
    return { outW: photoW, outH: photoH, sx: 0, sy: 0, sw: photoW, sh: photoH, dx: 0, dy: 0, dw: photoW, dh: photoH }
  }
  const { width: outW, height: outH } = FRAMES[frame]
  return centred(outW, outH, box, photoW, photoH)
}

/** The preset-canvas placement: the subject box (or the whole photo when none) centred with a margin. */
function centred(outW: number, outH: number, box: Box | null, photoW: number, photoH: number): Layout {
  // No subject found: centre the whole photo instead.
  const r = box ?? { x: 0, y: 0, w: photoW, h: photoH }
  const k = Math.min((0.88 * outW) / r.w, (0.88 * outH) / r.h)
  const dw = Math.max(1, Math.round(r.w * k))
  const dh = Math.max(1, Math.round(r.h * k))
  return {
    outW,
    outH,
    sx: r.x,
    sy: r.y,
    sw: r.w,
    sh: r.h,
    dx: Math.round((outW - dw) / 2),
    dy: Math.round((outH - dh) / 2),
    dw,
    dh,
  }
}

export type PassportSize = '35x45' | '2x2'
export type Passport = { size: PassportSize; sheet: boolean; faces: Face[] | null } // null: faces not known
export type PassportIssue = 'no-face' | 'faces' | 'top-cut' | 'shoulders-cut' | 'tilted' | 'background' | 'small'

/** Single-photo canvas, head height and crown/eye placement per size, in pixels at 300 dpi. */
const PASSPORT = {
  '35x45': { w: 413, h: 531, head: 395 },
  '2x2': { w: 600, h: 600, head: 354 },
} as const

const SHEET_W = 1800
const SHEET_H = 1200
const SHEET_GAP = 24
const CUT_LINE = '#c8c8c8'
const PPM_300 = 11811 // pixels per metre at 300 dpi

function sheetGrid(size: PassportSize) {
  const { w, h } = PASSPORT[size]
  const cols = Math.max(1, Math.floor((SHEET_W - 2 * SHEET_GAP + SHEET_GAP) / (w + SHEET_GAP)))
  const rows = Math.max(1, Math.floor((SHEET_H - 2 * SHEET_GAP + SHEET_GAP) / (h + SHEET_GAP)))
  return { cols, rows, w, h }
}

function luminance(hex: string): number {
  let h = hex.slice(1)
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
  const lin = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4)
}

/** The passport background: white, or the chosen plain colour when it is light enough. */
function passportBackground(fill: string | null): { color: string; ok: boolean } {
  if (fill === null) return { color: '#ffffff', ok: true }
  if (isColor(fill) && luminance(fill) >= 0.8) return { color: fill, ok: true }
  return { color: '#ffffff', ok: false }
}

/** First photo row (from the top) with alpha 128 or more in the columns x0..x1 (photo pixels). */
function crownRow(mask: Mask, photoW: number, photoH: number, x0: number, x1: number): number | null {
  const kx = photoW / mask.width
  const ky = photoH / mask.height
  const a = Math.max(0, Math.floor(x0 / kx))
  const b = Math.min(mask.width - 1, Math.floor(x1 / kx))
  for (let y = 0; y < mask.height; y++) {
    for (let x = a; x <= b; x++) if (mask.data[y * mask.width + x] >= 128) return y * ky
  }
  return null
}

/** Where the head lands on the passport canvas by the official rules, and what is wrong with the photo. */
export function passportFit(
  faces: Face[] | null,
  mask: Mask,
  photoW: number,
  photoH: number,
  size: PassportSize,
  fill: string | null,
): { layout: Layout; issues: PassportIssue[]; guides: { crown: number; chin: number } | null; sheetCount: number } {
  const spec = PASSPORT[size]
  const { cols, rows } = sheetGrid(size)
  const sheetCount = cols * rows
  const issues = new Set<PassportIssue>()
  if (!passportBackground(fill).ok) issues.add('background')

  const kept = (faces ?? []).filter((f) => f.score >= 0.6).sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
  const face = kept[0]
  const order: PassportIssue[] = ['no-face', 'faces', 'top-cut', 'shoulders-cut', 'tilted', 'background', 'small']
  const done = (layout: Layout, guides: { crown: number; chin: number } | null) => ({
    layout,
    issues: order.filter((i) => issues.has(i)),
    guides,
    sheetCount,
  })
  if (!face) {
    if (faces) issues.add('no-face')
    return done(centred(spec.w, spec.h, photoBox(mask, photoW, photoH), photoW, photoH), null)
  }
  if (kept.slice(1).some((f) => f.box.w * f.box.h >= 0.25 * face.box.w * face.box.h)) issues.add('faces')

  const eyeY = (face.eyeR.y + face.eyeL.y) / 2
  const eyeX = (face.eyeR.x + face.eyeL.x) / 2
  const mouthY = (face.mouthR.y + face.mouthL.y) / 2
  const chinY = mouthY + (mouthY - eyeY)
  const crownY = crownRow(mask, photoW, photoH, face.box.x, face.box.x + face.box.w) ?? face.box.y
  if (crownY <= 0.01 * photoH) issues.add('top-cut')
  const headH = Math.max(1, chinY - crownY)

  const k = spec.head / headH
  let offX: number
  let offY: number
  if (size === '35x45') {
    offY = 47 - crownY * k
    offX = 206.5 - eyeX * k
  } else {
    offY = 228 - eyeY * k
    offX = spec.w / 2 - eyeX * k
    const crown = crownY * k + offY
    if (crown < 18) offY += 18 - crown
  }
  if (k > 1.5) issues.add('small')
  if (photoH * k + offY < spec.h - 1) issues.add('shoulders-cut')
  const tilt = Math.atan2(face.eyeL.y - face.eyeR.y, face.eyeL.x - face.eyeR.x)
  if (Math.abs(tilt) > (5 * Math.PI) / 180) issues.add('tilted')

  // The canvas mapped back into photo pixels, clipped to the photo; the destination follows.
  const sx = Math.max(0, -offX / k)
  const sy = Math.max(0, -offY / k)
  const ex = Math.min(photoW, (spec.w - offX) / k)
  const ey = Math.min(photoH, (spec.h - offY) / k)
  const sw = Math.max(0, ex - sx)
  const sh = Math.max(0, ey - sy)
  const layout: Layout = {
    outW: spec.w,
    outH: spec.h,
    sx,
    sy,
    sw,
    sh,
    dx: sx * k + offX,
    dy: sy * k + offY,
    dw: sw * k,
    dh: sh * k,
  }
  return done(layout, { crown: (crownY * k + offY) / spec.h, chin: (chinY * k + offY) / spec.h })
}

/** The pixel size of the exported image for a framing. */
export function frameSize(
  frame: Frame,
  original: ImageBitmap,
  mask: Mask,
  passport?: Passport,
): { width: number; height: number } {
  if (frame === 'passport' && passport) {
    if (passport.sheet) return { width: SHEET_W, height: SHEET_H }
    return { width: PASSPORT[passport.size].w, height: PASSPORT[passport.size].h }
  }
  if (frame === 'photo') return { width: original.width, height: original.height }
  const l = layout(frame, photoBox(mask, original.width, original.height), original.width, original.height)
  return { width: l.outW, height: l.outH }
}

/** Image blob in the chosen format: transparent background (PNG, WebP), or a colour, gradient, blur or picture behind it. */
export async function exportImage(
  original: ImageBitmap,
  mask: Mask,
  fill: string | undefined,
  colors: Uint8ClampedArray | undefined,
  format: Format,
  frame: Frame = 'photo',
  images?: Map<string, ImageBitmap>,
  shadow: Shadow = NO_SHADOW,
  /** Photo frame only: render with the long edge at most this many pixels (never upscaled). */
  maxSide?: number,
  /** Passport frame only: the size, sheet option and detected faces. */
  passport?: Passport,
  match: Match = NO_MATCH,
): Promise<Blob> {
  // JPG has no transparency: without a picked background it gets white rather than black.
  const background = fill ?? (format === 'jpg' ? '#ffffff' : undefined)
  // Only a picked background is matched, not the white a JPG gets by default. Loaded on demand.
  const matcher =
    fill && match.on && match.strength > 0 && frame !== 'passport'
      ? { strength: match.strength, apply: (await import('./relight')).matchSubject }
      : undefined
  let canvas: HTMLCanvasElement
  if (frame === 'photo') {
    const k = maxSide ? Math.min(1, maxSide / Math.max(original.width, original.height)) : 1
    if (k < 1) {
      const small = await createImageBitmap(original, {
        resizeWidth: Math.max(1, Math.round(original.width * k)),
        resizeHeight: Math.max(1, Math.round(original.height * k)),
        resizeQuality: 'high',
      })
      try {
        canvas = cutout(small, mask, background, colors, images, shadow, matcher)
      } finally {
        small.close()
      }
    } else {
      canvas = cutout(original, mask, background, colors, images, shadow, matcher)
    }
  } else if (frame === 'passport' && passport) {
    canvas = renderPassport(original, mask, fill ?? null, colors, passport)
  } else {
    const box = photoBox(mask, original.width, original.height)
    const l = layout(frame, box, original.width, original.height)
    const subject = cutout(original, mask, undefined, colors)
    canvas = document.createElement('canvas')
    canvas.width = l.outW
    canvas.height = l.outH
    const c = canvas.getContext('2d')!
    if (background) {
      paintBackground(c, background, l.outW, l.outH, { original, images })
    }
    if (matcher) matcher.apply(subject, canvas, matcher.strength)
    c.imageSmoothingQuality = 'high'
    if (box) {
      // The subject's box in output pixels: the photo box mapped through the same crop and scale.
      const kx = l.dw / l.sw
      const ky = l.dh / l.sh
      const outBox = { x: l.dx + (box.x - l.sx) * kx, y: l.dy + (box.y - l.sy) * ky, w: box.w * kx, h: box.h * ky }
      paintShadow(c, subject, outBox, l, l, l.outW, shadow)
    }
    c.drawImage(subject, l.sx, l.sy, l.sw, l.sh, l.dx, l.dy, l.dw, l.dh)
    subject.width = subject.height = 0
  }
  const out = canvas
  const blob = await new Promise<Blob>((resolve, reject) =>
    out.toBlob(
      (b) => {
        out.width = out.height = 0
        if (b) resolve(b)
        else reject(new Error(`Could not encode ${format.toUpperCase()}`))
      },
      MIME[format],
      QUALITY[format],
    ),
  )
  if (frame !== 'passport' || !passport) return blob
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const patched = format === 'png' ? withPngDpi(bytes) : format === 'jpg' ? withJfifDpi(bytes) : bytes
  return patched === bytes ? blob : new Blob([patched as Uint8Array<ArrayBuffer>], { type: MIME[format] })
}

/** The passport photo (and the print sheet when asked) drawn on a canvas, white or light background, no shadow. */
function renderPassport(
  original: ImageBitmap,
  mask: Mask,
  fill: string | null,
  colors: Uint8ClampedArray | undefined,
  passport: Passport,
): HTMLCanvasElement {
  const { layout: l } = passportFit(passport.faces, mask, original.width, original.height, passport.size, fill)
  const subject = cutout(original, mask, undefined, colors)
  const photo = document.createElement('canvas')
  photo.width = l.outW
  photo.height = l.outH
  const c = photo.getContext('2d')!
  paintBackground(c, passportBackground(fill).color, l.outW, l.outH, { original })
  c.imageSmoothingQuality = 'high'
  if (l.sw > 0 && l.sh > 0) c.drawImage(subject, l.sx, l.sy, l.sw, l.sh, l.dx, l.dy, l.dw, l.dh)
  subject.width = subject.height = 0
  if (!passport.sheet) return photo

  const { cols, rows, w, h } = sheetGrid(passport.size)
  const sheet = document.createElement('canvas')
  sheet.width = SHEET_W
  sheet.height = SHEET_H
  const s = sheet.getContext('2d')!
  s.fillStyle = '#ffffff'
  s.fillRect(0, 0, SHEET_W, SHEET_H)
  const x0 = Math.round((SHEET_W - (cols * w + (cols - 1) * SHEET_GAP)) / 2)
  const y0 = Math.round((SHEET_H - (rows * h + (rows - 1) * SHEET_GAP)) / 2)
  s.strokeStyle = CUT_LINE
  s.lineWidth = 1
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = x0 + col * (w + SHEET_GAP)
      const y = y0 + r * (h + SHEET_GAP)
      s.drawImage(photo, x, y)
      s.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1)
    }
  }
  photo.width = photo.height = 0
  return sheet
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A PNG with a pHYs chunk (300 dpi) right after IHDR; the input when it isn't a PNG with an IHDR first. */
export function withPngDpi(png: Uint8Array): Uint8Array {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  const at = 33 // 8 signature + 25 IHDR chunk
  if (png.length < at || sig.some((b, i) => png[i] !== b)) return png
  if (String.fromCharCode(png[12], png[13], png[14], png[15]) !== 'IHDR') return png
  const chunk = new Uint8Array(21)
  const v = new DataView(chunk.buffer)
  v.setUint32(0, 9)
  chunk.set([0x70, 0x48, 0x59, 0x73], 4) // pHYs
  v.setUint32(8, PPM_300)
  v.setUint32(12, PPM_300)
  chunk[16] = 1
  v.setUint32(17, crc32(chunk.subarray(4, 17)))
  const out = new Uint8Array(png.length + chunk.length)
  out.set(png.subarray(0, at))
  out.set(chunk, at)
  out.set(png.subarray(at), at + chunk.length)
  return out
}

/** A JPEG whose JFIF header says 300 dpi; left alone when there is no JFIF APP0 right after SOI. */
export function withJfifDpi(jpg: Uint8Array): Uint8Array {
  if (jpg.length < 18 || jpg[0] !== 0xff || jpg[1] !== 0xd8) return jpg
  if (![0x4a, 0x46, 0x49, 0x46, 0].every((b, i) => jpg[6 + i] === b)) return jpg
  const out = jpg.slice()
  out[13] = 1
  out[14] = 300 >> 8
  out[15] = 300 & 0xff
  out[16] = 300 >> 8
  out[17] = 300 & 0xff
  return out
}

/** WhatsApp sticker rules: 512 px square, 16 px margin, at most 100 KB. */
const STICKER = 512
const STICKER_MARGIN = 16
const STICKER_MAX_BYTES = 100_000

/** Where the subject lands on the sticker: its box scaled to fit inside the margin, centred. */
export function stickerFit(box: Box | null, photoW: number, photoH: number) {
  const r = box ?? { x: 0, y: 0, w: photoW, h: photoH }
  const inner = STICKER - 2 * STICKER_MARGIN
  const k = Math.min(inner / r.w, inner / r.h)
  const dw = Math.max(1, Math.round(r.w * k))
  const dh = Math.max(1, Math.round(r.h * k))
  return {
    sx: r.x,
    sy: r.y,
    sw: r.w,
    sh: r.h,
    dx: Math.round((STICKER - dw) / 2),
    dy: Math.round((STICKER - dh) / 2),
    dw,
    dh,
  }
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/** A 512 px transparent sticker: the cut-out centred in the margin, as WebP (PNG where WebP can't be made). */
export async function exportSticker(original: ImageBitmap, mask: Mask, colors?: Uint8ClampedArray): Promise<Blob> {
  const l = stickerFit(photoBox(mask, original.width, original.height), original.width, original.height)
  const full = cutout(original, mask, undefined, colors)
  const subject = document.createElement('canvas')
  subject.width = subject.height = STICKER
  const sc = subject.getContext('2d')!
  sc.imageSmoothingQuality = 'high'
  sc.drawImage(full, l.sx, l.sy, l.sw, l.sh, l.dx, l.dy, l.dw, l.dh)
  full.width = full.height = 0

  const out = subject

  try {
    if (!(await supportsWebp())) {
      const png = await encode(out, 'image/png')
      if (!png) throw new Error('Could not encode the sticker')
      return png
    }
    let blob: Blob | null = null
    for (const q of [0.8, 0.6, 0.45]) {
      blob = (await encode(out, 'image/webp', q)) ?? blob
      if (blob && blob.size <= STICKER_MAX_BYTES) break
    }
    if (!blob) throw new Error('Could not encode the sticker')
    return blob
  } finally {
    out.width = out.height = 0
  }
}

let webpProbe: Promise<boolean> | undefined

/** Whether this browser can encode WebP (Safari silently hands back a PNG). Probed once. */
export function supportsWebp(): Promise<boolean> {
  webpProbe ??= new Promise<boolean>((resolve) => {
    try {
      const c = document.createElement('canvas')
      c.width = c.height = 2
      c.toBlob((b) => resolve(b?.type === 'image/webp'), 'image/webp')
    } catch {
      resolve(false)
    }
  })
  return webpProbe
}

export function downloadName(originalName: string, format: Format): string {
  return `${originalName.replace(/\.[^.]+$/, '') || 'image'}-nobg.${format}`
}

export function stickerName(originalName: string, blob: Blob): string {
  return `${originalName.replace(/\.[^.]+$/, '') || 'image'}-sticker.${blob.type === 'image/webp' ? 'webp' : 'png'}`
}

/** Stores the cut-outs in one ZIP, uncompressed (they are already compressed images). */
export async function zipCutouts(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const { zip } = await import('fflate')
  const taken = new Set<string>()
  const entries: Record<string, Uint8Array> = {}
  for (const f of files) {
    const dot = f.name.lastIndexOf('.')
    const base = dot > 0 ? f.name.slice(0, dot) : f.name
    const ext = dot > 0 ? f.name.slice(dot) : ''
    let name = f.name
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}-${n}${ext}`
    taken.add(name.toLowerCase())
    entries[name] = new Uint8Array(await f.blob.arrayBuffer())
  }
  const data = await new Promise<Uint8Array>((resolve, reject) =>
    zip(entries, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out))),
  )
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
}
