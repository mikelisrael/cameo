import type { CSSProperties } from 'react'

/**
 * The background is one string (or null for transparent): a hex colour, 'blur', 'gradient:<name>'
 * or 'image:<n>'. These helpers turn it into CSS (Editor, swatches) and canvas drawing (export).
 */

export type GradientName = 'studio' | 'sky' | 'sunset'

type Gradient = { label: string; from: string; to: string } & (
  { kind: 'linear'; angle: number } | { kind: 'radial'; x: number; y: number }
)

/** Defined once; the CSS and the canvas drawing both read these stops. */
export const GRADIENTS: Record<GradientName, Gradient> = {
  studio: { label: 'Studio', kind: 'radial', x: 0.5, y: 0.42, from: '#ffffff', to: '#d9d4cc' },
  sky: { label: 'Sky', kind: 'linear', angle: 180, from: '#eef4fb', to: '#bcd3ea' },
  sunset: { label: 'Sunset', kind: 'linear', angle: 160, from: '#ffe1c7', to: '#f2946a' },
}

export const BLUR = 'blur'
const GRADIENT_PREFIX = 'gradient:'
const IMAGE_PREFIX = 'image:'

export const gradientFill = (name: GradientName) => `${GRADIENT_PREFIX}${name}`

export const isColor = (fill: string | null): fill is string => !!fill && fill.startsWith('#')
export const isBlur = (fill: string | null) => fill === BLUR
export const isImage = (fill: string | null) => !!fill && fill.startsWith(IMAGE_PREFIX)

export function gradientOf(fill: string | null): Gradient | null {
  if (!fill || !fill.startsWith(GRADIENT_PREFIX)) return null
  return (GRADIENTS as Record<string, Gradient | undefined>)[fill.slice(GRADIENT_PREFIX.length)] ?? null
}

export type CssContext = {
  /** Object URL of the small blurred copy of the current photo. */
  blurUrl?: string | null
  /** Object URLs of the pictures the user picked, by fill id. */
  imageUrls?: Map<string, string>
}

const cover = (url: string): CSSProperties => ({
  backgroundImage: `url("${url}")`,
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
})

/** CSS for a background value; empty for transparent or anything that can't be shown. */
export function cssBackground(fill: string | null, ctx: CssContext = {}): CSSProperties {
  if (!fill) return {}
  if (isColor(fill)) return { backgroundColor: fill, backgroundImage: 'none' }
  const g = gradientOf(fill)
  if (g) {
    const image =
      g.kind === 'radial'
        ? `radial-gradient(circle farthest-corner at ${g.x * 100}% ${g.y * 100}%, ${g.from}, ${g.to})`
        : `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})`
    // Size reset: the editor's checkerboard class sets a 16px tile that would repeat the gradient.
    return { backgroundImage: image, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat' }
  }
  if (fill === BLUR) return ctx.blurUrl ? cover(ctx.blurUrl) : {}
  if (isImage(fill)) {
    const url = ctx.imageUrls?.get(fill)
    return url ? cover(url) : {}
  }
  return {}
}

export type PaintContext = {
  original?: ImageBitmap
  images?: Map<string, ImageBitmap>
}

const BLUR_SIDE = 48

function drawCover(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  sw: number,
  sh: number,
  w: number,
  h: number,
) {
  const k = Math.max(w / sw, h / sh)
  const dw = sw * k
  const dh = sh * k
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

/** Paints a background value over the whole w x h canvas; transparent or unknown values draw nothing. */
export function paintBackground(
  ctx: CanvasRenderingContext2D,
  fill: string | null,
  w: number,
  h: number,
  { original, images }: PaintContext = {},
) {
  if (!fill) return
  if (isColor(fill)) {
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, w, h)
    return
  }
  const g = gradientOf(fill)
  if (g) {
    let grad: CanvasGradient
    if (g.kind === 'radial') {
      const cx = g.x * w
      const cy = g.y * h
      // farthest-corner, as in the CSS
      const r = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy))
      grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    } else {
      const a = (g.angle * Math.PI) / 180
      const dx = Math.sin(a)
      const dy = -Math.cos(a)
      // CSS gradient line length: it reaches the corners exactly.
      const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2
      grad = ctx.createLinearGradient(w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half)
    }
    grad.addColorStop(0, g.from)
    grad.addColorStop(1, g.to)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
    return
  }
  if (fill === BLUR) {
    if (!original) return
    // Shrunk to a few dozen pixels and scaled back up: a heavy blur that works in every browser.
    const k = BLUR_SIDE / Math.max(original.width, original.height)
    const small = document.createElement('canvas')
    small.width = Math.max(1, Math.round(original.width * k))
    small.height = Math.max(1, Math.round(original.height * k))
    const sctx = small.getContext('2d')!
    sctx.imageSmoothingQuality = 'high'
    sctx.drawImage(original, 0, 0, small.width, small.height)
    drawCover(ctx, small, small.width, small.height, w, h)
    // iOS counts every canvas's memory until GC; zeroing the size frees it now.
    small.width = small.height = 0
    return
  }
  const img = isImage(fill) ? images?.get(fill) : undefined
  if (img) drawCover(ctx, img, img.width, img.height, w, h)
}
