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

  if (!fill) return subject

  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const o = out.getContext('2d')!
  o.fillStyle = fill
  o.fillRect(0, 0, w, h)
  o.drawImage(subject, 0, 0)
  return out
}

/** PNG blob: transparent background, or a solid hex fill. */
export function exportPng(original: ImageBitmap, mask: Mask, fill?: string, colors?: Uint8ClampedArray): Promise<Blob> {
  const canvas = cutout(original, mask, fill, colors)
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode PNG'))), 'image/png'),
  )
}

export function downloadName(originalName: string): string {
  return `${originalName.replace(/\.[^.]+$/, '') || 'image'}-nobg.png`
}
