// A heuristic colour match (von Kries white balance plus exposure toward the backdrop's mean), not a relight; it runs on the device.

const DECODE = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const s = i / 255
  DECODE[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function encode(v: number): number {
  const x = Math.min(1, Math.max(0, v))
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Draws `src` scaled into a canvas no larger than `maxSide` on its long edge and returns its pixels. */
function sample(src: HTMLCanvasElement, w: number, h: number): ImageData {
  const t = document.createElement('canvas')
  t.width = w
  t.height = h
  const ctx = t.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h)
  // iOS counts every canvas's memory until GC; zeroing the size frees it now.
  t.width = t.height = 0
  return data
}

export function matchSubject(subject: HTMLCanvasElement, backdrop: HTMLCanvasElement, strength: number): void {
  if (subject.width < 1 || subject.height < 1 || backdrop.width < 1 || backdrop.height < 1) return

  const bd = sample(backdrop, 32, 32).data
  const mb = [0, 0, 0]
  for (let i = 0; i < bd.length; i += 4) {
    mb[0] += DECODE[bd[i]]
    mb[1] += DECODE[bd[i + 1]]
    mb[2] += DECODE[bd[i + 2]]
  }
  const nb = bd.length / 4
  mb[0] /= nb
  mb[1] /= nb
  mb[2] /= nb

  const k = Math.min(1, 128 / Math.max(subject.width, subject.height))
  const sd = sample(
    subject,
    Math.max(1, Math.round(subject.width * k)),
    Math.max(1, Math.round(subject.height * k)),
  ).data
  const ms = [0, 0, 0]
  let weight = 0
  for (let i = 0; i < sd.length; i += 4) {
    const a = sd[i + 3]
    if (a === 0) continue
    weight += a
    ms[0] += DECODE[sd[i]] * a
    ms[1] += DECODE[sd[i + 1]] * a
    ms[2] += DECODE[sd[i + 2]] * a
  }
  if (weight === 0) return
  ms[0] /= weight
  ms[1] /= weight
  ms[2] /= weight

  const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  const ysRaw = lum(ms)
  const ys = Math.max(ysRaw, 1e-4)
  const yb = Math.max(lum(mb), 1e-4)

  const trust = Math.min(1, yb / 0.05)
  const gain = [1, 1, 1]
  // A near-black subject has no colour cast to judge, so it skips the white balance.
  if (ysRaw >= 1e-3) {
    for (let c = 0; c < 3; c++) {
      const cs = ms[c] / ysRaw
      let cb = mb[c] / yb
      cb = 1 + (cb - 1) * trust
      gain[c] = clamp((Math.max(cb, 1e-3) / Math.max(cs, 1e-3)) ** (0.5 * strength), 0.8, 1.25)
    }
    // Keep the subject's luminance under the white balance alone.
    const n = (0.2126 * ms[0] * gain[0] + 0.7152 * ms[1] * gain[1] + 0.0722 * ms[2] * gain[2]) / ysRaw
    if (Number.isFinite(n) && n > 0) for (let c = 0; c < 3; c++) gain[c] = clamp(gain[c] / n, 0.8, 1.25)
  }

  const exposure = clamp((yb / ys) ** (0.35 * strength), 0.75, 1.35)

  const luts = [0, 1, 2].map((c) => {
    const lut = new Uint8ClampedArray(256)
    for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * encode(Math.min(1, DECODE[v] * gain[c] * exposure)))
    return lut
  })

  const ctx = subject.getContext('2d')!
  const img = ctx.getImageData(0, 0, subject.width, subject.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    d[i] = luts[0][d[i]]
    d[i + 1] = luts[1][d[i + 1]]
    d[i + 2] = luts[2][d[i + 2]]
  }
  ctx.putImageData(img, 0, 0)
}
