import type { Rect } from './brush'
import type { Seg } from './protocol'

export type MaskPatch = {
  x: number
  y: number
  w: number
  h: number
  before: Uint8ClampedArray
  after: Uint8ClampedArray
}

/** Applies a segmenter pick to the mask in place: keep raises alpha to the pick, remove lowers it by the pick. */
export function applyPick(alpha: Uint8ClampedArray, w: number, seg: Seg, mode: 'keep' | 'remove'): MaskPatch | null {
  const before = new Uint8ClampedArray(seg.w * seg.h)
  const after = new Uint8ClampedArray(seg.w * seg.h)
  let changed = false
  for (let y = 0; y < seg.h; y++) {
    for (let x = 0; x < seg.w; x++) {
      const k = y * seg.w + x
      const o = (seg.y + y) * w + seg.x + x
      const a = alpha[o]
      const s = seg.alpha[k]
      const v = mode === 'keep' ? Math.max(a, s) : Math.min(a, 255 - s)
      before[k] = a
      after[k] = v
      if (v !== a) {
        alpha[o] = v
        changed = true
      }
    }
  }
  return changed ? { x: seg.x, y: seg.y, w: seg.w, h: seg.h, before, after } : null
}

/** Writes a patch's `before` or `after` pixels into the mask and returns its rect. */
export function applyPatch(alpha: Uint8ClampedArray, w: number, patch: MaskPatch, side: 'before' | 'after'): Rect {
  const src = patch[side]
  for (let y = 0; y < patch.h; y++) {
    alpha.set(src.subarray(y * patch.w, (y + 1) * patch.w), (patch.y + y) * w + patch.x)
  }
  return { x: patch.x, y: patch.y, w: patch.w, h: patch.h }
}
