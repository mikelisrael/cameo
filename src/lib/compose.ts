import type { Mask } from './protocol'

/** Draws the original and applies the mask as alpha, at the original resolution. */
export function cutout(
  original: ImageBitmap,
  mask: Mask,
  fill?: string,
  colors?: Uint8ClampedArray,
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

  if (!fill) return subject

  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const o = out.getContext('2d')!
  o.fillStyle = fill
  o.fillRect(0, 0, w, h)
  o.drawImage(subject, 0, 0)
  subject.width = subject.height = 0
  return out
}

export type Format = 'png' | 'webp' | 'jpg'

const MIME: Record<Format, string> = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg' }
const QUALITY: Record<Format, number | undefined> = { png: undefined, webp: 0.9, jpg: 0.92 }

/** How the cut-out is framed: the whole photo, trimmed to the subject, or a preset canvas. */
export type Frame = 'photo' | 'subject' | 'square' | 'portrait' | 'story'

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

type Layout = {
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
  if (frame === 'photo' || frame === 'subject') {
    return { outW: photoW, outH: photoH, sx: 0, sy: 0, sw: photoW, sh: photoH, dx: 0, dy: 0, dw: photoW, dh: photoH }
  }
  const { width: outW, height: outH } = FRAMES[frame]
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

/** The pixel size of the exported image for a framing. */
export function frameSize(frame: Frame, original: ImageBitmap, mask: Mask): { width: number; height: number } {
  if (frame === 'photo') return { width: original.width, height: original.height }
  const l = layout(frame, photoBox(mask, original.width, original.height), original.width, original.height)
  return { width: l.outW, height: l.outH }
}

/** Image blob in the chosen format: transparent background (PNG, WebP), or a solid hex fill. */
export function exportImage(
  original: ImageBitmap,
  mask: Mask,
  fill: string | undefined,
  colors: Uint8ClampedArray | undefined,
  format: Format,
  frame: Frame = 'photo',
): Promise<Blob> {
  // JPG has no transparency: without a picked background it gets white rather than black.
  const background = fill ?? (format === 'jpg' ? '#ffffff' : undefined)
  let canvas: HTMLCanvasElement
  if (frame === 'photo') {
    canvas = cutout(original, mask, background, colors)
  } else {
    const l = layout(frame, photoBox(mask, original.width, original.height), original.width, original.height)
    const subject = cutout(original, mask, undefined, colors)
    canvas = document.createElement('canvas')
    canvas.width = l.outW
    canvas.height = l.outH
    const c = canvas.getContext('2d')!
    if (background) {
      c.fillStyle = background
      c.fillRect(0, 0, l.outW, l.outH)
    }
    c.imageSmoothingQuality = 'high'
    c.drawImage(subject, l.sx, l.sy, l.sw, l.sh, l.dx, l.dy, l.dw, l.dh)
    subject.width = subject.height = 0
  }
  const out = canvas
  return new Promise((resolve, reject) =>
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
