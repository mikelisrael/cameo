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

/** Image blob in the chosen format: transparent background (PNG, WebP), or a solid hex fill. */
export function exportImage(
  original: ImageBitmap,
  mask: Mask,
  fill: string | undefined,
  colors: Uint8ClampedArray | undefined,
  format: Format,
): Promise<Blob> {
  // JPG has no transparency: without a picked background it gets white rather than black.
  const canvas = cutout(original, mask, fill ?? (format === 'jpg' ? '#ffffff' : undefined), colors)
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => {
        canvas.width = canvas.height = 0
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
