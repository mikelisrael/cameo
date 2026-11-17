import { boxBlur } from './refine'
import type { Seg } from './protocol'

export type Rect = { x: number; y: number; w: number; h: number }
export type MaskPatch = {
  x: number
  y: number
  w: number
  h: number
  before: Uint8ClampedArray
  after: Uint8ClampedArray
}
export type BrushMode = 'erase' | 'restore'

const MAX_COLOURS = 64
/** Colours closer than this (per 0..255 channel, in RGB distance) to a painted colour never count as "other". */
const SNAP_TAU = 40

/** Copies a rect out of a w-wide plane. */
function crop(src: Uint8ClampedArray, w: number, r: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(r.w * r.h)
  for (let y = 0; y < r.h; y++) {
    const o = (r.y + y) * w + r.x
    out.set(src.subarray(o, o + r.w), y * r.w)
  }
  return out
}

/** Reduces a flat list of RGB triplets to at most MAX_COLOURS by striding. */
function reduce(list: number[]): Uint8Array {
  const n = list.length / 3
  const stride = Math.max(1, Math.ceil(n / MAX_COLOURS))
  const out: number[] = []
  for (let i = 0; i < n; i += stride) out.push(list[i * 3], list[i * 3 + 1], list[i * 3 + 2])
  return Uint8Array.from(out)
}

function nearestSq(set: Uint8Array, r: number, g: number, b: number): number {
  let best = Infinity
  for (let k = 0; k < set.length; k += 3) {
    const dr = set[k] - r
    const dg = set[k + 1] - g
    const db = set[k + 2] - b
    const d = dr * dr + dg * dg + db * db
    if (d < best) best = d
  }
  return best
}

/**
 * One Erase/Restore brush stroke on an 8-bit alpha mask. Coverage is the maximum over all dabs, so a stroke that
 * crosses itself does not darken. Only the stroke's bounding box is kept (base alpha and coverage), grown on demand,
 * so a long stroke on a 24 MP mask costs memory in proportion to the stroke, not the image.
 */
export class Stroke {
  private readonly target: number
  private readonly hardness: number
  private readonly spacing: number
  private readonly margin: number
  // Storage box: base alpha and coverage (0..255). Outside it alpha is still the base and coverage is 0.
  private sx = 0
  private sy = 0
  private sw = 0
  private sh = 0
  private base = new Uint8ClampedArray(0)
  private cov = new Uint8ClampedArray(0)
  // Tight box of everything touched.
  private tx0 = 0
  private ty0 = 0
  private tx1 = 0
  private ty1 = 0
  private has = false
  private dead = false
  private lastX = 0
  private lastY = 0
  private readonly centres: number[] = []

  private readonly alpha: Uint8ClampedArray
  private readonly w: number
  private readonly h: number
  private readonly radius: number

  constructor(alpha: Uint8ClampedArray, w: number, h: number, mode: BrushMode, radius: number, softness: number) {
    this.alpha = alpha
    this.w = w
    this.h = h
    this.radius = Math.max(0.5, radius)
    this.target = mode === 'erase' ? 0 : 255
    this.hardness = 1 - Math.min(1, Math.max(0, softness))
    this.spacing = Math.max(0.5, this.radius * 0.25)
    this.margin = Math.max(32, Math.ceil(this.radius * 2))
  }

  dab(x: number, y: number): Rect | null {
    if (this.dead) return null
    if (!this.has && this.centres.length === 0) {
      this.centres.push(x, y)
      this.lastX = x
      this.lastY = y
      return this.stamp(x, y)
    }
    const dx = x - this.lastX
    const dy = y - this.lastY
    const len = Math.hypot(dx, dy)
    if (len === 0) return null
    const steps = Math.ceil(len / this.spacing - 1e-9)
    let dirty: Rect | null = null
    for (let k = 1; k <= steps; k++) {
      const t = k === steps ? 1 : (k * this.spacing) / len
      const px = this.lastX + dx * t
      const py = this.lastY + dy * t
      this.centres.push(px, py)
      dirty = union(dirty, this.stamp(px, py))
    }
    this.lastX = x
    this.lastY = y
    return dirty
  }

  cancel(): Rect | null {
    if (this.dead) return null
    this.dead = true
    if (!this.has) return null
    const rect = { x: this.tx0, y: this.ty0, w: this.tx1 - this.tx0, h: this.ty1 - this.ty0 }
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      const s = (y - this.sy) * this.sw + (rect.x - this.sx)
      this.alpha.set(this.base.subarray(s, s + rect.w), y * this.w + rect.x)
    }
    this.release()
    return rect
  }

  finish(smart?: { guide: Uint8ClampedArray }): { patch: MaskPatch | null; dirty: Rect | null } {
    if (this.dead || !this.has) return { patch: null, dirty: null }
    this.dead = true
    const rect = { x: this.tx0, y: this.ty0, w: this.tx1 - this.tx0, h: this.ty1 - this.ty0 }
    const before = new Uint8ClampedArray(rect.w * rect.h)
    for (let y = 0; y < rect.h; y++) {
      const s = (rect.y + y - this.sy) * this.sw + (rect.x - this.sx)
      before.set(this.base.subarray(s, s + rect.w), y * rect.w)
    }
    if (smart) this.snap(smart.guide, rect)
    const patch: MaskPatch = { ...rect, before, after: crop(this.alpha, this.w, rect) }
    this.release()
    return { patch, dirty: rect }
  }

  private release() {
    this.base = new Uint8ClampedArray(0)
    this.cov = new Uint8ClampedArray(0)
  }

  /** Edge-aware snap: re-solves the footprint's alpha from the photo's colours with a colour guided filter. */
  private snap(guide: Uint8ClampedArray, rect: Rect) {
    const { w, h, alpha } = this
    const erase = this.target === 0
    const gr = Math.max(2, Math.round(this.radius / 6))
    const rx0 = Math.max(0, rect.x - 2 * gr)
    const ry0 = Math.max(0, rect.y - 2 * gr)
    const rx1 = Math.min(w, rect.x + rect.w + 2 * gr)
    const ry1 = Math.min(h, rect.y + rect.h + 2 * gr)
    const rw = rx1 - rx0
    const rh = ry1 - ry0
    const n = rw * rh

    // Base alpha and coverage over R.
    const baseR = new Uint8ClampedArray(n)
    const covR = new Uint8ClampedArray(n)
    for (let y = 0; y < rh; y++) {
      const gy = ry0 + y
      const o = gy * w + rx0
      baseR.set(alpha.subarray(o, o + rw), y * rw)
      // Rows inside the storage box overlap it for these columns.
      if (gy >= this.sy && gy < this.sy + this.sh) {
        const a = Math.max(rx0, this.sx)
        const b = Math.min(rx1, this.sx + this.sw)
        if (b > a) {
          const s = (gy - this.sy) * this.sw + (a - this.sx)
          baseR.set(this.base.subarray(s, s + (b - a)), y * rw + (a - rx0))
          covR.set(this.cov.subarray(s, s + (b - a)), y * rw + (a - rx0))
        }
      }
    }

    // Colour sets.
    const painted: number[] = []
    for (let k = 0; k < this.centres.length; k += 2) {
      const px = Math.min(w - 1, Math.max(0, Math.floor(this.centres[k])))
      const py = Math.min(h - 1, Math.max(0, Math.floor(this.centres[k + 1])))
      const o = (py * w + px) * 4
      painted.push(guide[o], guide[o + 1], guide[o + 2])
    }
    const isOther = (i: number) => covR[i] === 0 && (erase ? baseR[i] >= 230 : baseR[i] <= 25)
    if (painted.length === 0) return
    const setP = reduce(painted)
    // Candidates for the other set, minus any colour close to a painted one (the model's mistake can run past the footprint).
    const other: number[] = []
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const i = y * rw + x
        if (!isOther(i)) continue
        const o = ((ry0 + y) * w + rx0 + x) * 4
        if (nearestSq(setP, guide[o], guide[o + 1], guide[o + 2]) < SNAP_TAU * SNAP_TAU) continue
        other.push(guide[o], guide[o + 1], guide[o + 2])
      }
    }
    if (other.length === 0) return
    const setO = reduce(other)
    const setB = erase ? setP : setO
    const setF = erase ? setO : setP

    // Guide planes and foreground probability.
    const I0 = new Float32Array(n)
    const I1 = new Float32Array(n)
    const I2 = new Float32Array(n)
    const p = new Float32Array(n)
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const i = y * rw + x
        const o = ((ry0 + y) * w + rx0 + x) * 4
        const r = guide[o]
        const g = guide[o + 1]
        const b = guide[o + 2]
        I0[i] = r / 255
        I1[i] = g / 255
        I2[i] = b / 255
        if (covR[i] > 0) {
          const dB = nearestSq(setB, r, g, b)
          const dF = nearestSq(setF, r, g, b)
          p[i] = dB / (dB + dF + 1e-6)
        } else {
          p[i] = baseR[i] / 255
        }
      }
    }

    // Colour guided filter (same maths as refineAlpha), at full resolution over R.
    const eps = 1e-3
    const tmp = new Float32Array(n)
    const box = (src: Float32Array) => boxBlur(src, rw, rh, gr, new Float32Array(n), tmp)
    const m0 = box(I0)
    const m1 = box(I1)
    const m2 = box(I2)
    const mP = box(p)
    const sc = new Float32Array(n)
    const cov = (X: Float32Array, Y: Float32Array, mX: Float32Array, mY: Float32Array) => {
      for (let i = 0; i < n; i++) sc[i] = X[i] * Y[i]
      const out = box(sc)
      for (let i = 0; i < n; i++) out[i] -= mX[i] * mY[i]
      return out
    }
    const vRR = cov(I0, I0, m0, m0)
    const vRG = cov(I0, I1, m0, m1)
    const vRB = cov(I0, I2, m0, m2)
    const vGG = cov(I1, I1, m1, m1)
    const vGB = cov(I1, I2, m1, m2)
    const vBB = cov(I2, I2, m2, m2)
    const cR = cov(I0, p, m0, mP)
    const cG = cov(I1, p, m1, mP)
    const cB = cov(I2, p, m2, mP)
    const bq = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const a = vRR[i] + eps
      const b = vRG[i]
      const c = vRB[i]
      const d = vGG[i] + eps
      const e = vGB[i]
      const g = vBB[i] + eps
      const A00 = d * g - e * e
      const A01 = c * e - b * g
      const A02 = b * e - c * d
      const A11 = a * g - c * c
      const A12 = b * c - a * e
      const A22 = a * d - b * b
      const invDet = 1 / (a * A00 + b * A01 + c * A02)
      const k0 = cR[i]
      const k1 = cG[i]
      const k2 = cB[i]
      const a0 = (A00 * k0 + A01 * k1 + A02 * k2) * invDet
      const a1 = (A01 * k0 + A11 * k1 + A12 * k2) * invDet
      const a2 = (A02 * k0 + A12 * k1 + A22 * k2) * invDet
      bq[i] = mP[i] - a0 * m0[i] - a1 * m1[i] - a2 * m2[i]
      cR[i] = a0
      cG[i] = a1
      cB[i] = a2
    }
    const mA0 = box(cR)
    const mA1 = box(cG)
    const mA2 = box(cB)
    const mB = box(bq)

    // Apply inside the footprint only.
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const i = (y - ry0) * rw + (x - rx0)
        const c = covR[i] / 255
        if (c === 0) continue
        let q = mA0[i] * I0[i] + mA1[i] * I1[i] + mA2[i] * I2[i] + mB[i]
        q = q < 0 ? 0 : q > 1 ? 1 : q
        const base = baseR[i]
        let v = 255 * q
        v = erase ? Math.min(v, base) : Math.max(v, base)
        alpha[y * w + x] = Math.round(base + c * (v - base))
      }
    }
  }

  /** Stamps one dab, updating alpha in place; returns the clipped rect or null when fully outside. */
  private stamp(x: number, y: number): Rect | null {
    const r = this.radius
    const x0 = Math.max(0, Math.floor(x - r))
    const y0 = Math.max(0, Math.floor(y - r))
    const x1 = Math.min(this.w, Math.ceil(x + r))
    const y1 = Math.min(this.h, Math.ceil(y + r))
    if (x1 <= x0 || y1 <= y0) return null
    this.grow(x0, y0, x1, y1)
    if (!this.has) {
      this.tx0 = x0
      this.ty0 = y0
      this.tx1 = x1
      this.ty1 = y1
      this.has = true
    } else {
      this.tx0 = Math.min(this.tx0, x0)
      this.ty0 = Math.min(this.ty0, y0)
      this.tx1 = Math.max(this.tx1, x1)
      this.ty1 = Math.max(this.ty1, y1)
    }
    const inner = Math.max(0, Math.min(r * this.hardness, r - 1))
    const span = r - inner
    const { alpha, base, cov, sw, sx, sy, target } = this
    for (let j = y0; j < y1; j++) {
      const dy = j + 0.5 - y
      for (let i = x0; i < x1; i++) {
        const dx = i + 0.5 - x
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d >= r) continue
        let cv = 1
        if (d > inner) {
          const t = (r - d) / span
          cv = t * t * (3 - 2 * t)
        }
        const c8 = Math.round(cv * 255)
        const k = (j - sy) * sw + (i - sx)
        if (c8 > cov[k]) {
          cov[k] = c8
          const b = base[k]
          alpha[j * this.w + i] = Math.round(b + ((target - b) * c8) / 255)
        }
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }

  /** Makes the storage box cover the given rect, growing with a margin so reallocations are rare. */
  private grow(x0: number, y0: number, x1: number, y1: number) {
    const has = this.sw > 0
    if (has && x0 >= this.sx && y0 >= this.sy && x1 <= this.sx + this.sw && y1 <= this.sy + this.sh) return
    let nx0 = x0
    let ny0 = y0
    let nx1 = x1
    let ny1 = y1
    if (has) {
      nx0 = Math.min(nx0, this.sx)
      ny0 = Math.min(ny0, this.sy)
      nx1 = Math.max(nx1, this.sx + this.sw)
      ny1 = Math.max(ny1, this.sy + this.sh)
    }
    const m = this.margin
    nx0 = Math.max(0, nx0 - m)
    ny0 = Math.max(0, ny0 - m)
    nx1 = Math.min(this.w, nx1 + m)
    ny1 = Math.min(this.h, ny1 + m)
    const nw = nx1 - nx0
    const nh = ny1 - ny0
    const base = new Uint8ClampedArray(nw * nh)
    const cov = new Uint8ClampedArray(nw * nh)
    // Alpha is untouched outside the old box, so it is the base there.
    for (let y = 0; y < nh; y++) {
      const o = (ny0 + y) * this.w + nx0
      base.set(this.alpha.subarray(o, o + nw), y * nw)
    }
    if (has) {
      for (let y = 0; y < this.sh; y++) {
        const d = (this.sy + y - ny0) * nw + (this.sx - nx0)
        const s = y * this.sw
        base.set(this.base.subarray(s, s + this.sw), d)
        cov.set(this.cov.subarray(s, s + this.sw), d)
      }
    }
    this.sx = nx0
    this.sy = ny0
    this.sw = nw
    this.sh = nh
    this.base = base
    this.cov = cov
  }
}

function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
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
