import type { Mask } from './protocol'

export const UPSCALE_MODEL = 'Xenova/swin2SR-lightweight-x2-64'
/** The q8 model is 7.1 MB; shown to people before the first download. */
export const UPSCALE_MB = 7
export const UPSCALE_MAX_SIDE = 800

/** Upscaling needs the mask at the photo's size and a photo small enough to finish in a sensible time. */
export function canUpscale(r: { original: { width: number; height: number }; mask: Mask }): boolean {
  const { original, mask } = r
  return (
    mask.width === original.width &&
    mask.height === original.height &&
    Math.max(original.width, original.height) <= UPSCALE_MAX_SIDE
  )
}

/** Bilinear resample of a 0..255 single-channel mask, pixel-centre sampling. Plain JS: runs in a worker or on the page. */
export function scaleMask(m: Mask, width: number, height: number): Mask {
  const { width: sw, height: sh, data: src } = m
  const out = new Uint8ClampedArray(width * height)
  const clamp = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v)
  const x0s = new Int32Array(width)
  const x1s = new Int32Array(width)
  const fxs = new Float32Array(width)
  for (let x = 0; x < width; x++) {
    const sx = clamp(((x + 0.5) * sw) / width - 0.5, sw - 1)
    const x0 = Math.floor(sx)
    x0s[x] = x0
    x1s[x] = Math.min(x0 + 1, sw - 1)
    fxs[x] = sx - x0
  }
  for (let y = 0; y < height; y++) {
    const sy = clamp(((y + 0.5) * sh) / height - 0.5, sh - 1)
    const y0 = Math.floor(sy)
    const y1 = Math.min(y0 + 1, sh - 1)
    const fy = sy - y0
    const r0 = y0 * sw
    const r1 = y1 * sw
    for (let x = 0; x < width; x++) {
      const fx = fxs[x]
      const a = src[r0 + x0s[x]] * (1 - fx) + src[r0 + x1s[x]] * fx
      const b = src[r1 + x0s[x]] * (1 - fx) + src[r1 + x1s[x]] * fx
      out[y * width + x] = Math.round(a * (1 - fy) + b * fy)
    }
  }
  return { width, height, data: out }
}

/** `c*` is the core (what this tile contributes); `s*` is the source rect fed to the model: the core grown by a pad. */
export type Tile = { sx: number; sy: number; sw: number; sh: number; cx: number; cy: number; cw: number; ch: number }

/** Cores tile the image without gaps (the last one in a row or column is shorter). */
export function planTiles(w: number, h: number, core = 224, pad = 16): Tile[] {
  const tiles: Tile[] = []
  for (let cy = 0; cy < h; cy += core) {
    const ch = Math.min(core, h - cy)
    const sy = Math.max(0, cy - pad)
    const sh = Math.min(h, cy + ch + pad) - sy
    for (let cx = 0; cx < w; cx += core) {
      const cw = Math.min(core, w - cx)
      const sx = Math.max(0, cx - pad)
      const sw = Math.min(w, cx + cw + pad) - sx
      tiles.push({ sx, sy, sw, sh, cx, cy, cw, ch })
    }
  }
  return tiles
}
