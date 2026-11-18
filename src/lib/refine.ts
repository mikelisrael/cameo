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

type Rect = { x0: number; y0: number; x1: number; y1: number }

/** Per cell of g x g pixels: lowest and highest alpha, and whether any pixel is strictly between 0 and 255. */
function scanCells(alpha: Uint8ClampedArray, w: number, h: number, g: number) {
  const cols = Math.ceil(w / g)
  const rows = Math.ceil(h / g)
  const min = new Uint8Array(cols * rows)
  const max = new Uint8Array(cols * rows)
  const soft = new Uint8Array(cols * rows)
  for (let cy = 0; cy < rows; cy++) {
    const y1 = Math.min(h, (cy + 1) * g)
    for (let cx = 0; cx < cols; cx++) {
      const x1 = Math.min(w, (cx + 1) * g)
      let lo = 255
      let hi = 0
      let sf = 0
      for (let y = cy * g; y < y1; y++) {
        for (let x = cx * g, i = y * w + x; x < x1; x++, i++) {
          const a = alpha[i]
          if (a < lo) lo = a
          if (a > hi) hi = a
          if (a !== 0 && a !== 255) sf = 1
        }
      }
      const k = cy * cols + cx
      min[k] = lo
      max[k] = hi
      soft[k] = sf
    }
  }
  return { cols, rows, min, max, soft }
}

/**
 * The tiles (ts x ts, the last row and column may be smaller) the test marks active, as rectangles: active tiles next to
 * each other in a row become one run, and runs with the same columns in consecutive rows are stacked.
 */
function activeRects(w: number, h: number, ts: number, active: (r: Rect) => boolean): Rect[] {
  const done: Rect[] = []
  let open: Rect[] = []
  for (let y0 = 0; y0 < h; y0 += ts) {
    const y1 = Math.min(h, y0 + ts)
    const next: Rect[] = []
    let run: Rect | null = null
    const close = () => {
      if (!run) return
      const above = open.find((o) => o.x0 === run!.x0 && o.x1 === run!.x1)
      if (above) {
        above.y1 = run.y1
        next.push(above)
      } else next.push(run)
      run = null
    }
    for (let x0 = 0; x0 < w; x0 += ts) {
      const t = { x0, y0, x1: Math.min(w, x0 + ts), y1 }
      if (active(t)) {
        if (run) run.x1 = t.x1
        else run = t
      } else close()
    }
    close()
    for (const o of open) if (!next.includes(o)) done.push(o)
    open = next
  }
  return done.concat(open)
}

/**
 * Sharpens a mask made at the model's resolution so it follows the photo's edges at full resolution, using the fast
 * guided filter (He, Sun & Tang, "Guided Image Filtering" and "Fast Guided Filter", 2015) with the photo's colour as the
 * guide: the filter's linear coefficients are solved on a sub-sampled copy, then applied to the full-res RGB. The result
 * only replaces the mask in the soft band around the edge; solid inside and outside pixels keep the model's value.
 *
 * Only the neighbourhood of the edge is filtered. Where the mask has one value over everything a pixel's output can
 * depend on, the filter returns that value untouched, so those tiles are skipped. A pixel's output depends on the mask
 * and photo within (2r + 2) sub-sampled blocks: two box filters of radius r, plus the bilinear step back to full size.
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
  const r = Math.max(1, Math.round((opts.radius * f) / s))
  const halo = (2 * r + 2) * s

  // Tile and cell edges are multiples of s so each region's sub-sampled blocks are the whole image's blocks.
  const g = Math.ceil(32 / s) * s
  const cells = scanCells(alpha, w, h, g)
  const regions = activeRects(w, h, g * 4, (t) => {
    const cx0 = Math.max(0, Math.floor((t.x0 - halo) / g))
    const cx1 = Math.min(cells.cols - 1, Math.floor((t.x1 + halo - 1) / g))
    const cy0 = Math.max(0, Math.floor((t.y0 - halo) / g))
    const cy1 = Math.min(cells.rows - 1, Math.floor((t.y1 + halo - 1) / g))
    let lo = 255
    let hi = 0
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = cy * cells.cols + cx
        if (cells.min[k] < lo) lo = cells.min[k]
        if (cells.max[k] > hi) hi = cells.max[k]
      }
    }
    return lo !== hi
  })

  const grown = regions.map((t) => ({
    x0: Math.max(0, t.x0 - halo),
    y0: Math.max(0, t.y0 - halo),
    x1: Math.min(w, t.x1 + halo),
    y1: Math.min(h, t.y1 + halo),
  }))
  let area = 0
  for (const t of grown) area += (t.x1 - t.x0) * (t.y1 - t.y0)
  if (area >= 0.6 * w * h) return guidedFilter(image, channels, alpha, w, h, s, r, opts.eps)

  const out = new Uint8ClampedArray(alpha)
  regions.forEach((t, n) => {
    const { x0, y0, x1, y1 } = grown[n]
    const rw = x1 - x0
    const rh = y1 - y0
    const subImage = new Uint8Array(rw * rh * channels)
    const subAlpha = new Uint8ClampedArray(rw * rh)
    for (let y = 0; y < rh; y++) {
      const i = (y0 + y) * w + x0
      subImage.set(image.subarray(i * channels, (i + rw) * channels), y * rw * channels)
      subAlpha.set(alpha.subarray(i, i + rw), y * rw)
    }
    const res = guidedFilter(subImage, channels, subAlpha, rw, rh, s, r, opts.eps)
    for (let y = t.y0; y < t.y1; y++) {
      const i = (y - y0) * rw + (t.x0 - x0)
      out.set(res.subarray(i, i + (t.x1 - t.x0)), y * w + t.x0)
    }
  })
  return out
}

/** The guided filter over a whole region, with the sub-sampling step `s` and box radius `r` (in blocks) already chosen. */
function guidedFilter(
  image: Pixels,
  channels: number,
  alpha: Uint8ClampedArray,
  w: number,
  h: number,
  s: number,
  r: number,
  eps: number,
): Uint8ClampedArray {
  const ws = Math.ceil(w / s)
  const hs = Math.ceil(h / s)
  const n = ws * hs

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
 * The wide pass of blur fusion, at 1/d resolution. A separate function so its temporaries (sub-sampled image, alpha and
 * blur buffers) are unreachable by the time the full-resolution pass allocates; only what that pass reads is returned.
 */
function blurFusionCoarse(
  image: Pixels,
  channels: number,
  alpha: Uint8ClampedArray,
  w: number,
  h: number,
  d: number,
  scale: number,
) {
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
  return { F1, bB1, ax, ay, ws }
}

type Pass2 = {
  image: Pixels
  channels: number
  alpha: Uint8ClampedArray
  w: number
  F1: Uint8ClampedArray
  bB1: Float32Array[]
  ay: Axis
  xi0: Int32Array
  xi1: Int32Array
  xf: Float32Array
  ws: number
  R2: number
  bA: Float32Array
  src: Float32Array
  outF: Float32Array
  outB: Float32Array
  tmp: Float32Array
  result: Uint8ClampedArray
}

/** Pass 2 of blur fusion over `reg` (a tile `t` plus an R2 border); writes only the soft pixels of `t`. */
function pass2Region(c2: Pass2, reg: Rect, t: Rect) {
  const { image, channels, alpha, w, F1, bB1, ay, xi0, xi1, xf, ws, R2, bA, src, outF, outB, tmp, result } = c2
  const rx0 = reg.x0
  const ry0 = reg.y0
  const rw = reg.x1 - rx0
  const rh = reg.y1 - ry0
  for (let y = 0; y < rh; y++) {
    for (let x = 0, i = (ry0 + y) * w + rx0, k = y * rw; x < rw; x++, i++, k++) src[k] = alpha[i] / 255
  }
  boxBlur(src, rw, rh, R2, bA, tmp)
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < rh; y++) {
      for (let x = 0, i = (ry0 + y) * w + rx0, k = y * rw; x < rw; x++, i++, k++) {
        src[k] = (F1[i * 3 + c] / 255) * (alpha[i] / 255)
      }
    }
    boxBlur(src, rw, rh, R2, outF, tmp)
    const bB = bB1[c]
    for (let y = 0; y < rh; y++) {
      const gyy = ry0 + y
      const r0 = ay.i0[gyy] * ws
      const r1 = ay.i1[gyy] * ws
      const fy = ay.f[gyy]
      const gy = 1 - fy
      for (let x = 0, i = gyy * w + rx0, k = y * rw; x < rw; x++, i++, k++) {
        const al = alpha[i]
        if (al === 255) {
          src[k] = 0
          continue
        }
        const gx0 = rx0 + x
        const fx = xf[gx0]
        const gx = 1 - fx
        const x0 = xi0[gx0]
        const x1 = xi1[gx0]
        const bb = bB[r0 + x0] * (gx * gy) + bB[r0 + x1] * (fx * gy) + bB[r1 + x0] * (gx * fy) + bB[r1 + x1] * (fx * fy)
        src[k] = bb * (1 - al / 255)
      }
    }
    boxBlur(src, rw, rh, R2, outB, tmp)
    for (let y = t.y0; y < t.y1; y++) {
      for (let x = t.x0, i = y * w + x, k = (y - ry0) * rw + (x - rx0); x < t.x1; x++, i++, k++) {
        const al = alpha[i]
        if (al === 0 || al === 255) continue
        const a = al / 255
        const bf = outF[k] / (bA[k] + 1e-5)
        const bb = outB[k] / (1 - bA[k] + 1e-5)
        const v = bf + a * (image[i * channels + c] / 255 - a * bf - (1 - a) * bb)
        result[i * 4 + c] = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255)
      }
    }
  }
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
  // At least 2: the wide pass is low-frequency, so halving it costs nothing visible, and below 2048 px it would
  // otherwise run (and allocate ~13 buffers) at full resolution, which phones cannot always afford.
  const d = Math.max(2, Math.ceil(longSide / 1024))
  const { F1, bB1, ax, ay, ws } = blurFusionCoarse(image, channels, alpha, w, h, d, scale)
  const { i0: xi0, i1: xi1, f: xf } = ax

  // Pass 2 at full resolution, only where it can change a pixel: a pixel with alpha 0 or 255 keeps the photo's colour,
  // and a soft pixel's result depends on the mask and F1 within R2 of it. So each tile that holds a soft pixel is
  // filtered with an R2 border, and only the tile's own soft pixels are written.
  const R2 = Math.max(1, Math.round(6 * scale))
  const N = w * h
  const result = new Uint8ClampedArray(N * 4)
  for (let i = 0; i < N; i++) {
    const o = i * channels
    result[i * 4] = image[o]
    result[i * 4 + 1] = image[o + 1]
    result[i * 4 + 2] = image[o + 2]
    result[i * 4 + 3] = 255
  }

  const g = 32
  const cells = scanCells(alpha, w, h, g)
  const tiles = activeRects(w, h, g * 4, (t) => {
    for (let cy = t.y0 / g; cy < Math.ceil(t.y1 / g); cy++) {
      for (let cx = t.x0 / g; cx < Math.ceil(t.x1 / g); cx++) if (cells.soft[cy * cells.cols + cx]) return true
    }
    return false
  })
  const regions = tiles.map((t) => ({
    x0: Math.max(0, t.x0 - R2),
    y0: Math.max(0, t.y0 - R2),
    x1: Math.min(w, t.x1 + R2),
    y1: Math.min(h, t.y1 + R2),
  }))
  let cap = 0
  for (const t of regions) cap = Math.max(cap, (t.x1 - t.x0) * (t.y1 - t.y0))
  const bA = new Float32Array(cap)
  const src = new Float32Array(cap)
  const outF = new Float32Array(cap)
  const outB = new Float32Array(cap)
  const tmp = new Float32Array(cap)

  const ctx: Pass2 = { image, channels, alpha, w, F1, bB1, ay, xi0, xi1, xf, ws, R2, bA, src, outF, outB, tmp, result }
  for (let n = 0; n < regions.length; n++) pass2Region(ctx, regions[n], tiles[n])
  return result
}

/** Stretches alpha between `lo` and `hi` (0..1) to the full range, in place: below `lo` is 0, above `hi` is 255. */
export function tightenAlpha(alpha: Uint8Array | Uint8ClampedArray, lo: number, hi: number): void {
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i++) lut[i] = Math.min(255, Math.max(0, Math.round(((i / 255 - lo) / (hi - lo)) * 255)))
  for (let i = 0; i < alpha.length; i++) alpha[i] = lut[alpha[i]]
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
  // After decontaminate: colours are estimated from the untightened alpha.
  if (opts.refine && opts.tighten > 0) tightenAlpha(mask, opts.tighten, 1 - opts.tighten)
  return { mask, colors }
}
