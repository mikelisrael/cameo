/** A rectangle of the photo before and after a fill, kept so undo and redo can swap it. */
export type PhotoPatch = {
  x: number
  y: number
  w: number
  h: number
  before: Uint8ClampedArray
  after: Uint8ClampedArray
} // RGBA, photo px

/** What the model sees: the photo around the brushed area, at model size, with the paste weights at photo size. */
export type FillCrop = {
  x: number
  y: number
  w: number
  h: number // the crop rect in photo px
  image: Uint8ClampedArray // RGBA at model size
  hole: Uint8Array // model size, 1 = fill
  mw: number
  mh: number // the model-size width and height of `image` and `hole`
  scale: number // model size / crop size, <= 1
  feather: Uint8ClampedArray // paste alpha at crop size (w*h), 0..255
}

const MAX_MODEL = 1024

function canvas(w: number, h: number) {
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) throw new Error('No 2D canvas available')
  return { c, g }
}

/** Grows every 1 in `src` by `r` px (square window, separable). */
function dilate(src: Uint8Array, w: number, h: number, r: number) {
  const tmp = new Uint8Array(w * h)
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r) && !v; k++) v = src[y * w + k]
      tmp[y * w + x] = v
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = 0
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r) && !v; k++) v = tmp[k * w + x]
      out[y * w + x] = v
    }
  }
  return out
}

/** One box blur pass of radius `r`, horizontal then vertical, edges clamped to the nearest sample. */
function boxBlur(src: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const d = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let k = -r; k <= r; k++) sum += src[row + Math.min(w - 1, Math.max(0, k))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / d
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / d
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

/** Nearest-neighbour resample of a 0/1 buffer. */
function resample(src: Uint8Array, sw: number, sh: number, dw: number, dh: number) {
  const out = new Uint8Array(dw * dh)
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh))
    for (let x = 0; x < dw; x++) out[y * dw + x] = src[sy * sw + Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw))]
  }
  return out
}

/**
 * Finds the brushed area (`hole`, mask-sized, >0 = brushed), widens it into a crop of the photo and prepares the
 * model's input. Null when nothing is brushed.
 */
export function cropForFill(
  photo: ImageBitmap,
  hole: Uint8ClampedArray,
  maskW: number,
  maskH: number,
): FillCrop | null {
  let x0 = maskW
  let y0 = maskH
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < maskH; y++) {
    for (let x = 0; x < maskW; x++) {
      if (hole[y * maskW + x] > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null

  const sx = photo.width / maskW
  const sy = photo.height / maskH
  const bx0 = x0 * sx
  const by0 = y0 * sy
  const bx1 = (x1 + 1) * sx
  const by1 = (y1 + 1) * sy
  const grow = Math.max(32, 0.5 * Math.max(bx1 - bx0, by1 - by0))
  const x = Math.max(0, Math.floor(bx0 - grow))
  const y = Math.max(0, Math.floor(by0 - grow))
  const w = Math.min(photo.width, Math.ceil(bx1 + grow)) - x
  const h = Math.min(photo.height, Math.ceil(by1 + grow)) - y

  const scale = Math.max(w, h) > MAX_MODEL ? MAX_MODEL / Math.max(w, h) : 1
  const mw = Math.max(1, Math.round(w * scale))
  const mh = Math.max(1, Math.round(h * scale))

  const { g } = canvas(mw, mh)
  g.imageSmoothingQuality = 'high'
  g.drawImage(photo, x, y, w, h, 0, 0, mw, mh)
  const image = g.getImageData(0, 0, mw, mh).data

  // The brushed area at model size: each model pixel looks up the mask pixel under it.
  const small = new Uint8Array(mw * mh)
  for (let j = 0; j < mh; j++) {
    const my = Math.min(maskH - 1, Math.max(0, Math.floor((y + ((j + 0.5) * h) / mh) / sy)))
    for (let i = 0; i < mw; i++) {
      const mx = Math.min(maskW - 1, Math.max(0, Math.floor((x + ((i + 0.5) * w) / mw) / sx)))
      small[j * mw + i] = hole[my * maskW + mx] > 0 ? 1 : 0
    }
  }
  const modelHole = dilate(small, mw, mh, 3)

  // Paste weights at crop size: cover the hole fully, then soften the edge.
  const atCrop = scale === 1 ? modelHole : resample(modelHole, mw, mh, w, h)
  const grown = dilate(atCrop, w, h, 2)
  let a = new Float32Array(w * h)
  for (let i = 0; i < a.length; i++) a[i] = grown[i] ? 255 : 0
  a = boxBlur(boxBlur(a, w, h, 4), w, h, 4)
  const feather = new Uint8ClampedArray(w * h)
  for (let i = 0; i < a.length; i++) feather[i] = grown[i] ? 255 : a[i]
  return { x, y, w, h, image, hole: modelHole, mw, mh, scale, feather }
}

/** Blends the model's fill into the photo's pixels at the crop and returns the patch (before and after). */
export function pasteFill(photo: ImageBitmap, crop: FillCrop, filled: Uint8ClampedArray): PhotoPatch {
  const { x, y, w, h } = crop
  const mw = Math.max(1, Math.round(w * crop.scale))
  const mh = Math.max(1, Math.round(h * crop.scale))

  const src = canvas(w, h)
  src.g.drawImage(photo, x, y, w, h, 0, 0, w, h)
  const before = src.g.getImageData(0, 0, w, h).data

  let scaled = filled
  if (mw !== w || mh !== h) {
    const small = canvas(mw, mh)
    small.g.putImageData(new ImageData(new Uint8ClampedArray(filled), mw, mh), 0, 0)
    const big = canvas(w, h)
    big.g.imageSmoothingEnabled = true
    big.g.imageSmoothingQuality = 'high'
    big.g.drawImage(small.c, 0, 0, w, h)
    scaled = big.g.getImageData(0, 0, w, h).data
  }

  const after = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const a = crop.feather[i] / 255
    for (let k = 0; k < 3; k++) after[i * 4 + k] = before[i * 4 + k] * (1 - a) + scaled[i * 4 + k] * a
    after[i * 4 + 3] = 255
  }
  return { x, y, w, h, before: new Uint8ClampedArray(before), after }
}

/** The photo with the patch's `before` or `after` pixels in place. The input bitmap is left open. */
export function applyPhotoPatch(photo: ImageBitmap, patch: PhotoPatch, side: 'before' | 'after'): Promise<ImageBitmap> {
  const { c, g } = canvas(photo.width, photo.height)
  g.drawImage(photo, 0, 0)
  g.putImageData(new ImageData(new Uint8ClampedArray(patch[side]), patch.w, patch.h), patch.x, patch.y)
  return createImageBitmap(c)
}
