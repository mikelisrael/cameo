import type { RefineOptions } from './protocol'

type Pixels = Uint8ClampedArray | Uint8Array

/** Sample positions along one axis: for each full-res index, the two neighbouring sub-res indices and the weight of the second. */
type Axis = { i0: Int32Array; i1: Int32Array; f: Float32Array }

function makeAxis(n: number, subN: number, s: number): Axis {
  const i0 = new Int32Array(n)
  const i1 = new Int32Array(n)
  const f = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let c = (i + 0.5) / s - 0.5
    if (c < 0) c = 0
    if (c > subN - 1) c = subN - 1
    const a = Math.floor(c)
    i0[i] = a
    i1[i] = Math.min(a + 1, subN - 1)
    f[i] = c - a
  }
  return { i0, i1, f }
}

/**
 * Mean over the (2r+1)x(2r+1) window around each pixel, clamped to the image and divided by the number of pixels
 * actually inside, so borders are exact. Separable with running sums: O(N) whatever r. `out` must not alias `src`.
 * This is the box filter the guided filter (He, Sun & Tang) is built from.
 */
export function boxBlur(src: Float32Array, w: number, h: number, r: number, out: Float32Array, tmp: Float32Array) {
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    const first = r < w - 1 ? r : w - 1
    for (let x = 0; x <= first; x++) sum += src[row + x]
    for (let x = 0; x < w; x++) {
      const lo = x - r > 0 ? x - r : 0
      const hi = x + r < w - 1 ? x + r : w - 1
      tmp[row + x] = sum / (hi - lo + 1)
      if (x + 1 + r < w) sum += src[row + x + 1 + r]
      if (x - r >= 0) sum -= src[row + x - r]
    }
  }
  // Vertical pass row by row with one running sum per column, so memory is read in order.
  const col = new Float64Array(w)
  const lastRow = r < h - 1 ? r : h - 1
  for (let y = 0; y <= lastRow; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) col[x] += tmp[row + x]
  }
  for (let y = 0; y < h; y++) {
    const lo = y - r > 0 ? y - r : 0
    const hi = y + r < h - 1 ? y + r : h - 1
    const k = 1 / (hi - lo + 1)
    const row = y * w
    for (let x = 0; x < w; x++) out[row + x] = col[x] * k
    const add = y + 1 + r < h ? (y + 1 + r) * w : -1
    const sub = y - r >= 0 ? (y - r) * w : -1
    if (add >= 0 && sub >= 0) for (let x = 0; x < w; x++) col[x] += tmp[add + x] - tmp[sub + x]
    else if (add >= 0) for (let x = 0; x < w; x++) col[x] += tmp[add + x]
    else if (sub >= 0) for (let x = 0; x < w; x++) col[x] -= tmp[sub + x]
  }
  return out
}

/**
 * Sharpens a mask made at the model's resolution so it follows the photo's edges at full resolution, using the fast
 * guided filter (He, Sun & Tang, "Guided Image Filtering" and "Fast Guided Filter", 2015) with the photo's colour as the
 * guide: the filter's linear coefficients are solved on a sub-sampled copy, then applied to the full-res RGB. The result
 * only replaces the mask in the soft band around the edge; solid inside and outside pixels keep the model's value.
 */
export function refineAlpha(
  image: Pixels,
  channels: number,
  alpha: Uint8ClampedArray,
  w: number,
  h: number,
  modelSize: number,
  opts: { eps: number; radius: number },
): Uint8ClampedArray {
  const f = Math.max(w, h) / modelSize
  if (f <= 1.05) return new Uint8ClampedArray(alpha)

  const s = Math.max(2, Math.ceil(f / 2))
  const ws = Math.ceil(w / s)
  const hs = Math.ceil(h / s)
  const n = ws * hs
  const r = Math.max(1, Math.round((opts.radius * f) / s))
  const eps = opts.eps

  // Full-size scratch arrays are recycled through a small pool to keep memory down.
  const pool: Float32Array[] = []
  const take = () => pool.pop() ?? new Float32Array(n)
  const give = (a: Float32Array) => pool.push(a)
  const tmp = new Float32Array(n)

  const I0 = take()
  const I1 = take()
  const I2 = take()
  const p = take()
  for (let sy = 0; sy < hs; sy++) {
    const y1 = Math.min(h, (sy + 1) * s)
    for (let sx = 0; sx < ws; sx++) {
      const x1 = Math.min(w, (sx + 1) * s)
      let c0 = 0
      let c1 = 0
      let c2 = 0
      let pa = 0
      let cnt = 0
      for (let y = sy * s; y < y1; y++) {
        for (let x = sx * s; x < x1; x++) {
          const i = y * w + x
          const o = i * channels
          c0 += image[o]
          c1 += image[o + 1]
          c2 += image[o + 2]
          pa += alpha[i]
          cnt++
        }
      }
      const k = sy * ws + sx
      I0[k] = c0 / cnt / 255
      I1[k] = c1 / cnt / 255
      I2[k] = c2 / cnt / 255
      p[k] = pa / cnt / 255
    }
  }

  const box = (src: Float32Array) => boxBlur(src, ws, hs, r, take(), tmp)
  const m0 = box(I0)
  const m1 = box(I1)
  const m2 = box(I2)
  const mP = box(p)

  // Band weight: how much of the neighbourhood is soft edge.
  const wgt = take()
  {
    const sc = take()
    for (let i = 0; i < n; i++) sc[i] = 4 * p[i] * (1 - p[i])
    boxBlur(sc, ws, hs, r, wgt, tmp)
    give(sc)
    for (let i = 0; i < n; i++) {
      const v = 4 * wgt[i]
      wgt[i] = v < 1 ? v : 1
    }
  }

  // box(X*Y) - mX*mY
  const cov = (X: Float32Array, Y: Float32Array, mX: Float32Array, mY: Float32Array) => {
    const sc = take()
    for (let i = 0; i < n; i++) sc[i] = X[i] * Y[i]
    const out = boxBlur(sc, ws, hs, r, take(), tmp)
    give(sc)
    for (let i = 0; i < n; i++) out[i] -= mX[i] * mY[i]
    return out
  }
  const vRR = cov(I0, I0, m0, m0)
  const vRG = cov(I0, I1, m0, m1)
  const vRB = cov(I0, I2, m0, m2)
  const cR = cov(I0, p, m0, mP)
  give(I0)
  const vGG = cov(I1, I1, m1, m1)
  const vGB = cov(I1, I2, m1, m2)
  const cG = cov(I1, p, m1, mP)
  give(I1)
  const vBB = cov(I2, I2, m2, m2)
  const cB = cov(I2, p, m2, mP)
  give(I2)
  give(p)

  // Per pixel: a = (Sigma + eps*I)^-1 * covIP through cofactors, b = mP - a.m. Results overwrite cR, cG, cB, vRR.
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
    vRR[i] = mP[i] - a0 * m0[i] - a1 * m1[i] - a2 * m2[i]
    cR[i] = a0
    cG[i] = a1
    cB[i] = a2
  }
  give(vRG)
  give(vRB)
  give(vGG)
  give(vGB)
  give(vBB)
  give(m0)
  give(m1)
  give(m2)
  give(mP)
  const mA0 = box(cR)
  give(cR)
  const mA1 = box(cG)
  give(cG)
  const mA2 = box(cB)
  give(cB)
  const mB = box(vRR)
  give(vRR)

  const ax = makeAxis(w, ws, s)
  const ay = makeAxis(h, hs, s)
  const out = new Uint8ClampedArray(w * h)
  const { i0: xi0, i1: xi1, f: xf } = ax
  for (let y = 0; y < h; y++) {
    const r0 = ay.i0[y] * ws
    const r1 = ay.i1[y] * ws
    const fy = ay.f[y]
    const gy = 1 - fy
    for (let x = 0, i = y * w; x < w; x++, i++) {
      const x0 = xi0[x]
      const x1 = xi1[x]
      const fx = xf[x]
      const gx = 1 - fx
      const w00 = gx * gy
      const w01 = fx * gy
      const w10 = gx * fy
      const w11 = fx * fy
      const k00 = r0 + x0
      const k01 = r0 + x1
      const k10 = r1 + x0
      const k11 = r1 + x1
      const wg = wgt[k00] * w00 + wgt[k01] * w01 + wgt[k10] * w10 + wgt[k11] * w11
      if (wg <= 0) {
        out[i] = alpha[i]
        continue
      }
      const o = i * channels
      const q =
        (mA0[k00] * w00 + mA0[k01] * w01 + mA0[k10] * w10 + mA0[k11] * w11) * (image[o] / 255) +
        (mA1[k00] * w00 + mA1[k01] * w01 + mA1[k10] * w10 + mA1[k11] * w11) * (image[o + 1] / 255) +
        (mA2[k00] * w00 + mA2[k01] * w01 + mA2[k10] * w10 + mA2[k11] * w11) * (image[o + 2] / 255) +
        (mB[k00] * w00 + mB[k01] * w01 + mB[k10] * w10 + mB[k11] * w11)
      let v = (alpha[i] / 255) * (1 - wg) + q * wg
      if (v < 0) v = 0
      else if (v > 1) v = 1
      out[i] = Math.round(v * 255)
    }
  }
  return out
}

/**
 * Removes the old background's colour from edge pixels, returning RGBA (A = 255) with the same colours inside and
 * outside the cut-out. Blur-fusion foreground estimation (Forte & Pitié, "Approximate Fast Foreground Colour
 * Estimation", 2021): a wide pass at reduced resolution, then a tight pass at full resolution, one channel at a time
 * to keep memory low. Pixels with alpha 0 or 255 are copied untouched.
 */
export function decontaminate(
  image: Pixels,
  channels: number,
  alpha: Uint8ClampedArray,
  w: number,
  h: number,
): Uint8ClampedArray {
  const longSide = Math.max(w, h)
  const scale = Math.max(1, longSide / 1024)
  const d = Math.max(1, Math.floor(longSide / 1024))
  const ws = Math.ceil(w / d)
  const hs = Math.ceil(h / d)
  const n = ws * hs

  // Pass 1 at reduced resolution: F = B = I.
  const subI = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
  const subA = new Float32Array(n)
  for (let sy = 0; sy < hs; sy++) {
    const y1 = Math.min(h, (sy + 1) * d)
    for (let sx = 0; sx < ws; sx++) {
      const x1 = Math.min(w, (sx + 1) * d)
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let cnt = 0
      for (let y = sy * d; y < y1; y++) {
        for (let x = sx * d; x < x1; x++) {
          const i = y * w + x
          const o = i * channels
          r += image[o]
          g += image[o + 1]
          b += image[o + 2]
          a += alpha[i]
          cnt++
        }
      }
      const k = sy * ws + sx
      subI[0][k] = r / cnt / 255
      subI[1][k] = g / cnt / 255
      subI[2][k] = b / cnt / 255
      subA[k] = a / cnt / 255
    }
  }
  const R1 = Math.max(1, Math.round((90 * scale) / d))
  const tmpS = new Float32Array(n)
  const srcS = new Float32Array(n)
  const bA1 = new Float32Array(n)
  boxBlur(subA, ws, hs, R1, bA1, tmpS)
  const bF1: Float32Array[] = []
  const bB1: Float32Array[] = []
  for (let c = 0; c < 3; c++) {
    const bf = new Float32Array(n)
    const bb = new Float32Array(n)
    for (let i = 0; i < n; i++) srcS[i] = subI[c][i] * subA[i]
    boxBlur(srcS, ws, hs, R1, bf, tmpS)
    for (let i = 0; i < n; i++) srcS[i] = subI[c][i] * (1 - subA[i])
    boxBlur(srcS, ws, hs, R1, bb, tmpS)
    for (let i = 0; i < n; i++) {
      bf[i] /= bA1[i] + 1e-5
      bb[i] /= 1 - bA1[i] + 1e-5
    }
    bF1.push(bf)
    bB1.push(bb)
  }

  const ax = makeAxis(w, ws, d)
  const ay = makeAxis(h, hs, d)
  const { i0: xi0, i1: xi1, f: xf } = ax
  const bF0 = bF1[0]
  const bF1g = bF1[1]
  const bF2 = bF1[2]
  const bB0 = bB1[0]
  const bB1g = bB1[1]
  const bB2 = bB1[2]
  // F1 = image where alpha is 255, 0 where alpha is 0 (it is multiplied by alpha later), blur fusion in between.
  const F1 = new Uint8ClampedArray(w * h * 3)
  for (let y = 0; y < h; y++) {
    const r0 = ay.i0[y] * ws
    const r1 = ay.i1[y] * ws
    const fy = ay.f[y]
    const gy = 1 - fy
    for (let x = 0, i = y * w; x < w; x++, i++) {
      const al = alpha[i]
      if (al === 0) continue
      const o = i * channels
      if (al === 255) {
        F1[i * 3] = image[o]
        F1[i * 3 + 1] = image[o + 1]
        F1[i * 3 + 2] = image[o + 2]
        continue
      }
      const a = al / 255
      const x0 = xi0[x]
      const x1 = xi1[x]
      const fx = xf[x]
      const gx = 1 - fx
      const w00 = gx * gy
      const w01 = fx * gy
      const w10 = gx * fy
      const w11 = fx * fy
      const k00 = r0 + x0
      const k01 = r0 + x1
      const k10 = r1 + x0
      const k11 = r1 + x1
      const ia = 1 - a
      let bf = bF0[k00] * w00 + bF0[k01] * w01 + bF0[k10] * w10 + bF0[k11] * w11
      let bb = bB0[k00] * w00 + bB0[k01] * w01 + bB0[k10] * w10 + bB0[k11] * w11
      let v = bf + a * (image[o] / 255 - a * bf - ia * bb)
      F1[i * 3] = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255)
      bf = bF1g[k00] * w00 + bF1g[k01] * w01 + bF1g[k10] * w10 + bF1g[k11] * w11
      bb = bB1g[k00] * w00 + bB1g[k01] * w01 + bB1g[k10] * w10 + bB1g[k11] * w11
      v = bf + a * (image[o + 1] / 255 - a * bf - ia * bb)
      F1[i * 3 + 1] = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255)
      bf = bF2[k00] * w00 + bF2[k01] * w01 + bF2[k10] * w10 + bF2[k11] * w11
      bb = bB2[k00] * w00 + bB2[k01] * w01 + bB2[k10] * w10 + bB2[k11] * w11
      v = bf + a * (image[o + 2] / 255 - a * bf - ia * bb)
      F1[i * 3 + 2] = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255)
    }
  }

  // Pass 2 at full resolution.
  const R2 = Math.max(1, Math.round(6 * scale))
  const N = w * h
  const bA = new Float32Array(N)
  const src = new Float32Array(N)
  const outF = new Float32Array(N)
  const outB = new Float32Array(N)
  const tmp = new Float32Array(N)
  for (let i = 0; i < N; i++) src[i] = alpha[i] / 255
  boxBlur(src, w, h, R2, bA, tmp)

  const result = new Uint8ClampedArray(N * 4)
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < N; i++) src[i] = (F1[i * 3 + c] / 255) * (alpha[i] / 255)
    boxBlur(src, w, h, R2, outF, tmp)
    const bB = bB1[c]
    for (let y = 0; y < h; y++) {
      const r0 = ay.i0[y] * ws
      const r1 = ay.i1[y] * ws
      const fy = ay.f[y]
      const gy = 1 - fy
      for (let x = 0, i = y * w; x < w; x++, i++) {
        const al = alpha[i]
        if (al === 255) {
          src[i] = 0
          continue
        }
        const fx = xf[x]
        const gx = 1 - fx
        const x0 = xi0[x]
        const x1 = xi1[x]
        const bb = bB[r0 + x0] * (gx * gy) + bB[r0 + x1] * (fx * gy) + bB[r1 + x0] * (gx * fy) + bB[r1 + x1] * (fx * fy)
        src[i] = bb * (1 - al / 255)
      }
    }
    boxBlur(src, w, h, R2, outB, tmp)
    for (let i = 0; i < N; i++) {
      const o = i * channels
      const al = alpha[i]
      if (al === 0 || al === 255) {
        result[i * 4 + c] = image[o + c]
        continue
      }
      const a = al / 255
      const bf = outF[i] / (bA[i] + 1e-5)
      const bb = outB[i] / (1 - bA[i] + 1e-5)
      const v = bf + a * (image[o + c] / 255 - a * bf - (1 - a) * bb)
      result[i * 4 + c] = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255)
    }
  }
  for (let i = 0; i < N; i++) result[i * 4 + 3] = 255
  return result
}

/**
 * Runs the full clean-up: sharpen the mask at the photo's resolution (guided filter), then remove the old background's
 * colour from the edges (blur fusion). Each step can be switched off through `opts`.
 */
export function refine(
  image: Pixels,
  channels: number,
  alpha: Uint8ClampedArray,
  w: number,
  h: number,
  modelSize: number,
  opts: RefineOptions,
): { mask: Uint8ClampedArray; colors?: Uint8ClampedArray } {
  const mask = opts.refine ? refineAlpha(image, channels, alpha, w, h, modelSize, opts) : alpha
  const colors = opts.decontaminate ? decontaminate(image, channels, mask, w, h) : undefined
  return { mask, colors }
}
