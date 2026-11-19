import type { RefineOptions } from '../protocol'
import {
  BUFFER,
  getGpuDevice,
  MAP_READ,
  type GpuBuffer,
  type GpuDevice,
  type GpuEncoder,
  type GpuPipeline,
} from './device'
import * as K from './kernels'

type Pixels = Uint8ClampedArray | Uint8Array

/** Same constants as `tightenAdaptive` in refine.ts. */
const CONTRAST_LOW = 0.06
const CONTRAST_HIGH = 0.14

export type CleanInput = {
  /** The photo, `channels` bytes per pixel (3 or 4; a fourth is ignored). */
  image: Pixels
  channels: number
  w: number
  h: number
  /** The model's mask, 0..255, `maskW` x `maskH`. */
  mask: Pixels
  maskW: number
  maskH: number
  opts: RefineOptions
  /** The model's input size, which sets how coarse the guided filter works. */
  modelSize: number
  /** Also return the mask resized to the photo's size, before any clean-up. */
  wantRaw: boolean
  /**
   * When given, filled with the milliseconds of each stage (the work is submitted and awaited stage by stage) and with
   * `peakBytes`, the most GPU buffer memory that was alive at once.
   */
  timings?: Record<string, number>
}

export type GpuCleaner = {
  /** `colors` (RGBA, A = 255) comes only with `opts.decontaminate`; `raw` only with `wantRaw`. */
  run(input: CleanInput): Promise<{ alpha: Uint8ClampedArray; colors?: Uint8ClampedArray; raw?: Uint8ClampedArray }>
}

const NAMES = [
  'resize',
  'downsample',
  'downsampleC',
  'blurH',
  'blurHP',
  'blurV',
  'solve',
  'refine',
  'lum',
  'blurH2',
  'blurV2',
  'blurHF',
  'blurHs',
  'blurVs',
  'store',
  'normalise',
  'init',
  'alphaSrc',
  'fSrc',
  'bSrc',
  'final',
  'contrast',
  'tighten',
  'lut',
] as const
type Name = (typeof NAMES)[number]

const SOURCES: Record<Name, string> = {
  resize: K.RESIZE,
  downsample: K.downsample(false),
  downsampleC: K.downsample(true),
  blurH: K.blurH('vec4<f32>', false),
  blurHP: K.blurH('vec4<f32>', 'gf'),
  blurV: K.blurV('vec4<f32>'),
  solve: K.SOLVE,
  refine: K.REFINE_APPLY,
  lum: K.LUMINANCE,
  blurH2: K.blurH('vec2<f32>', false),
  blurV2: K.blurV('vec2<f32>'),
  blurHF: K.blurH('vec2<f32>', 'fusion'),
  blurHs: K.blurH('f32', false),
  blurVs: K.blurV('f32'),
  store: K.STORE_COEF,
  normalise: K.FUSION_NORMALISE,
  init: K.DECON_INIT,
  alphaSrc: K.DECON_ALPHA,
  fSrc: K.DECON_F,
  bSrc: K.DECON_B,
  final: K.DECON_FINAL,
  contrast: K.CONTRAST,
  tighten: K.TIGHTEN_ADAPTIVE,
  lut: K.TIGHTEN_LUT,
}

const MAX_GROUPS = 65535
/** The most GPU memory per photo pixel the clean-up may have alive at once; strips are sized to stay under it. */
const MAX_BYTES_PER_PIXEL = 16
/** Room left for the small uniform buffers when sizing strips. */
const SLACK = 1 << 16
const round4 = (n: number) => (n + 3) & ~3

/**
 * Makes the GPU cleaner: gets the device, compiles every pipeline and runs one tiny image through them, so the first
 * real photo does not pay for shader compilation. Null when there is no usable GPU; the caller then uses the JS in
 * refine.ts.
 */
export async function createGpuCleaner(): Promise<GpuCleaner | null> {
  const device = await getGpuDevice()
  if (!device) return null
  try {
    const entries = await Promise.all(
      NAMES.map(async (name) => {
        const module = device.createShaderModule({ code: SOURCES[name] })
        const pipeline = await device.createComputePipelineAsync({
          layout: 'auto',
          compute: { module, entryPoint: 'main' },
        })
        return [name, pipeline] as const
      }),
    )
    const cleaner = makeCleaner(device, Object.fromEntries(entries) as Record<Name, GpuPipeline>)
    const side = 64
    const opts: RefineOptions = {
      refine: true,
      decontaminate: true,
      eps: 2e-3,
      radius: 2,
      tighten: 0.2,
      tightenHard: 0.4,
      gpu: true,
    }
    const mask = new Uint8Array(16 * 16)
    for (let i = 0; i < mask.length; i++) mask[i] = (i & 15) < 8 ? 0 : 255
    await cleaner.run({
      image: new Uint8Array(side * side * 3).fill(128),
      channels: 3,
      w: side,
      h: side,
      mask,
      maskW: 16,
      maskH: 16,
      opts,
      modelSize: 16,
      wantRaw: true,
    })
    return cleaner
  } catch (err) {
    console.warn('GPU clean-up unavailable', err)
    return null
  }
}

function makeCleaner(device: GpuDevice, pipes: Record<Name, GpuPipeline>): GpuCleaner {
  async function run(input: CleanInput) {
    const { image, channels, w, h, mask, maskW, maskH, opts, modelSize, wantRaw, timings } = input
    const n = w * h
    const words = Math.ceil(n / 4)
    const owned: GpuBuffer[] = []
    let stage: GpuBuffer[] = []
    let enc: GpuEncoder = device.createCommandEncoder()
    let mark = performance.now()
    // Every buffer's size while it is alive, so the peak of the sum can be reported and strips sized to a budget.
    const sizes = new Map<GpuBuffer, number>()
    let live = 0
    let peak = 0

    const make = (size: number, usage: number, mapped = false, group = owned) => {
      if (size > device.limits.maxStorageBufferBindingSize || size > device.limits.maxBufferSize) {
        throw new Error(`GPU buffer of ${size} bytes is over the device limit`)
      }
      const buffer = device.createBuffer({ size, usage, mappedAtCreation: mapped })
      group.push(buffer)
      sizes.set(buffer, size)
      live += size
      peak = Math.max(peak, live)
      return buffer
    }
    /** Destroys a buffer now (only once the work that uses it has been submitted). Safe to call twice. */
    const drop = (buffer: GpuBuffer) => {
      const size = sizes.get(buffer)
      if (size === undefined) return
      sizes.delete(buffer)
      live -= size
      buffer.destroy()
    }
    /** A storage buffer that lives for one stage and is destroyed once that stage has been submitted. */
    const plane = (size: number) => make(round4(size), BUFFER.STORAGE, false, stage)
    /** A storage buffer that several strips reuse; the stage `drop`s it when its last strip has been submitted. */
    const scratch = (size: number) => make(round4(size), BUFFER.STORAGE)
    const uniform = (u: number[], f: number[] = []) => {
      const data = new ArrayBuffer(Math.ceil(((u.length + f.length) * 4) / 16) * 16)
      new Uint32Array(data).set(u)
      new Float32Array(data).set(f, u.length)
      const buffer = make(data.byteLength, BUFFER.UNIFORM | BUFFER.COPY_DST, false, stage)
      device.queue.writeBuffer(buffer, 0, new Uint8Array(data))
      return buffer
    }
    /** One dispatch of `name` over `count` invocations, binding `buffers` in order (the last is the uniform). */
    const dispatch = (name: Name, buffers: GpuBuffer[], count: number) => {
      const pipeline = pipes[name]
      const group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
      })
      const groups = Math.max(1, Math.ceil(count / K.WG))
      const gx = Math.min(groups, MAX_GROUPS)
      const pass = enc.beginComputePass()
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, group)
      pass.dispatchWorkgroups(gx, Math.ceil(groups / gx))
      pass.end()
    }
    /** Submits what is encoded; destroys the stage's buffers (the GPU keeps them until it is done with them). */
    const flush = async (label: string) => {
      device.queue.submit([enc.finish()])
      enc = device.createCommandEncoder()
      for (const b of stage) drop(b)
      stage = []
      if (timings) {
        await device.queue.onSubmittedWorkDone()
        const now = performance.now()
        timings[label] = (timings[label] ?? 0) + now - mark
        mark = now
      }
    }
    const blur = (
      t: 'blurH' | 'blurHP' | 'blurH2' | 'blurHF' | 'blurHs',
      v: 'blurV' | 'blurV2' | 'blurVs',
      src: GpuBuffer,
      tmp: GpuBuffer,
      dst: GpuBuffer,
      bw: number,
      bh: number,
      r: number,
      mode = 0,
    ) => {
      dispatch(t, [src, tmp, uniform([bw, bh, r, mode])], bh)
      dispatch(v, [tmp, dst, uniform([bw, bh, r])], bw)
    }
    /**
     * How many rows a strip can have so that the scratch for its rows plus a halo of `halo` rows (`rowBytes` per row)
     * keeps what is alive now under the budget; at least `min`, at most `total`. The height is also noted in `timings`.
     */
    const stripRows = (label: string, rowBytes: number, halo: number, min: number, total: number) => {
      const room = MAX_BYTES_PER_PIXEL * n - live - SLACK
      const rows = Math.min(total, Math.max(min, Math.floor(room / rowBytes) - halo))
      if (timings) timings[`${label}Strip`] = rows
      return rows
    }

    device.pushErrorScope('validation')
    device.pushErrorScope('out-of-memory')
    let failure: unknown
    let alphaOut: Uint8ClampedArray | undefined
    let colorsOut: Uint8ClampedArray | undefined
    let rawOut: Uint8ClampedArray | undefined
    try {
      // Upload: photo as one u32 per pixel, mask as bytes.
      const imageBuf = make(n * 4, BUFFER.STORAGE, true)
      {
        const px = new Uint32Array(imageBuf.getMappedRange())
        if (channels === 4 && image.byteOffset % 4 === 0) {
          px.set(new Uint32Array(image.buffer, image.byteOffset, n))
        } else {
          for (let i = 0, o = 0; i < n; i++, o += channels)
            px[i] = image[o] | (image[o + 1] << 8) | (image[o + 2] << 16)
        }
        imageBuf.unmap()
      }
      const maskBuf = make(round4(maskW * maskH), BUFFER.STORAGE, true)
      new Uint8Array(maskBuf.getMappedRange()).set(mask.subarray(0, maskW * maskH))
      maskBuf.unmap()
      const alpha = make(words * 4, BUFFER.STORAGE | BUFFER.COPY_SRC)
      await flush('upload')

      dispatch('resize', [maskBuf, alpha, uniform([w, h, maskW, maskH, n])], words)
      let rawBuf: GpuBuffer | undefined
      if (wantRaw) {
        rawBuf = make(words * 4, BUFFER.COPY_DST | BUFFER.COPY_SRC)
        enc.copyBufferToBuffer(alpha, 0, rawBuf, 0, words * 4)
      }
      await flush('resize')
      drop(maskBuf)

      // Guided filter (refineAlpha). Skipped, as in JS, when the photo is no bigger than the model's input. Its
      // sub-sampled part runs in strips of rows, each with a halo of 2r rows (two blurs of radius r), so the planes
      // stay a fraction of the photo; only the finished coefficients cover the whole grid.
      const f = Math.max(w, h) / modelSize
      if (opts.refine && f > 1.05) {
        const s = Math.max(2, Math.ceil(f / 2))
        const r = Math.max(1, Math.round((opts.radius * f) / s))
        const ws = Math.ceil(w / s)
        const hs = Math.ceil(h / s)
        const coefOut = scratch(ws * hs * 16)
        const wgtOut = scratch(ws * hs * 4)
        const halo = 4 * r
        const strip = stripRows('refine', ws * 16 * 5, halo, 4, hs)
        const planeBytes = Math.min(hs, strip + halo) * ws * 16
        // Planes of a strip's region: ip (I0 I1 I2 p), tmp, m (their means), b1..b3 (blurred products; b3 reuses ip).
        const ip = scratch(planeBytes)
        const tmp = scratch(planeBytes)
        const m = scratch(planeBytes)
        const b1 = scratch(planeBytes)
        const b2 = scratch(planeBytes)
        for (let y0 = 0; y0 < hs; y0 += strip) {
          const y1 = Math.min(hs, y0 + strip)
          const ry0 = Math.max(0, y0 - 2 * r)
          const rows = Math.min(hs, y1 + 2 * r) - ry0
          const count = rows * ws
          dispatch('downsample', [imageBuf, alpha, ip, uniform([w, h, ws, rows, s, ry0, 0])], count)
          blur('blurH', 'blurV', ip, tmp, m, ws, rows, r)
          blur('blurHP', 'blurV', ip, tmp, b1, ws, rows, r, 1)
          blur('blurHP', 'blurV', ip, tmp, b2, ws, rows, r, 2)
          blur('blurHP', 'blurV', ip, tmp, ip, ws, rows, r, 3)
          dispatch('solve', [m, b1, b2, ip, uniform([count], [opts.eps])], count)
          blur('blurH', 'blurV', b1, tmp, m, ws, rows, r)
          dispatch(
            'store',
            [m, ip, coefOut, wgtOut, uniform([(y1 - y0) * ws, (y0 - ry0) * ws, y0 * ws])],
            (y1 - y0) * ws,
          )
          await flush('refine')
        }
        dispatch('refine', [imageBuf, coefOut, wgtOut, alpha, uniform([w, h, ws, hs, s, n])], words)
        await flush('refine')
        for (const b of [coefOut, wgtOut, ip, tmp, m, b1, b2]) drop(b)
      }

      // Decontaminate (blur fusion), on the alpha as refined and not yet tightened, as the worker orders it.
      let colorsBuf: GpuBuffer | undefined
      if (opts.decontaminate) {
        const longSide = Math.max(w, h)
        const scale = Math.max(1, longSide / 1024)
        const d = Math.max(2, Math.ceil(longSide / 1024))
        const R1 = Math.max(1, Math.round((90 * scale) / d))
        const R2 = Math.max(1, Math.round(6 * scale))
        const ws = Math.ceil(w / d)
        const hs = Math.ceil(h / d)
        const sub = ws * hs

        // Wide pass at 1/d size, one colour channel at a time: F and B per channel, kept as 16-bit pairs in `fused`.
        const fused = scratch(sub * 12)
        {
          const ip = plane(sub * 8)
          const tmp = plane(sub * 8)
          const pf = plane(sub * 8)
          for (let c = 0; c < 3; c++) {
            dispatch('downsampleC', [imageBuf, alpha, ip, uniform([w, h, ws, hs, d, 0, c])], sub)
            blur('blurHF', 'blurV2', ip, tmp, pf, ws, hs, R1, 1)
            blur('blurHF', 'blurV2', ip, tmp, ip, ws, hs, R1, 2)
            dispatch('normalise', [pf, ip, fused, uniform([sub, c, sub])], sub)
          }
          await flush('decontaminate')
        }

        // Pass 2 at full size in strips of rows with an R2 halo (the blur radius), so F1 and the blurs exist only for a
        // strip. `colorsBuf` starts as the photo; each strip's soft pixels are then overwritten.
        colorsBuf = make(n * 4, BUFFER.STORAGE | BUFFER.COPY_SRC)
        dispatch('init', [imageBuf, colorsBuf, uniform([n])], n)
        const strip = stripRows('decon', w * 4 * 5, 2 * R2, 8, h)
        const planeBytes = Math.min(h, strip + 2 * R2) * w * 4
        const bA = scratch(planeBytes)
        const src = scratch(planeBytes)
        const outF = scratch(planeBytes)
        const outB = scratch(planeBytes)
        const tmp = scratch(planeBytes)
        for (let t0 = 0; t0 < h; t0 += strip) {
          const t1 = Math.min(h, t0 + strip)
          const ry0 = Math.max(0, t0 - R2)
          const rows = Math.min(h, t1 + R2) - ry0
          const count = rows * w
          dispatch('alphaSrc', [alpha, src, uniform([w, ry0, count])], count)
          blur('blurHs', 'blurVs', src, tmp, bA, w, rows, R2)
          for (let c = 0; c < 3; c++) {
            const u = [w, ws, hs, d, ry0, count, c, sub]
            dispatch('fSrc', [imageBuf, alpha, fused, src, uniform(u)], count)
            blur('blurHs', 'blurVs', src, tmp, outF, w, rows, R2)
            dispatch('bSrc', [alpha, fused, src, uniform(u)], count)
            blur('blurHs', 'blurVs', src, tmp, outB, w, rows, R2)
            dispatch(
              'final',
              [imageBuf, alpha, outF, outB, bA, colorsBuf, uniform([w, t0, ry0, c, (t1 - t0) * w])],
              (t1 - t0) * w,
            )
          }
          await flush('decontaminate')
        }
        for (const b of [fused, bA, src, outF, outB, tmp]) drop(b)
      }

      // Tighten. Adaptive when the hard stretch is wider than the soft one, as in the worker.
      if (opts.refine && opts.tighten > 0) {
        if (opts.tightenHard > opts.tighten) {
          const hard = Math.min(opts.tightenHard, 0.45)
          const soft = Math.min(opts.tighten, hard)
          const rFull = Math.max(2, Math.round(0.005 * Math.max(w, h)))
          const d = Math.max(w, h) > 2048 ? 2 : 1
          const rs = Math.max(1, Math.round(rFull / d))
          const rw = Math.ceil(w / d)
          const rh = Math.ceil(h / d)
          // Strips of grid rows, each with a halo of 2rs rows (two blurs of radius rs); a strip tightens its own pixels.
          const strip = stripRows('tighten', rw * 16, 4 * rs, 4, rh)
          const planeBytes = Math.min(rh, strip + 4 * rs) * rw * 8
          const ls = scratch(planeBytes)
          const tmp = scratch(planeBytes)
          for (let a = 0; a < rh; a += strip) {
            const b = Math.min(rh, a + strip)
            const g0 = Math.max(0, a - 2 * rs)
            const rows = Math.min(rh, b + 2 * rs) - g0
            const cells = rows * rw
            const i0 = a * d * w
            const i1 = Math.min(h, b * d) * w
            dispatch('lum', [imageBuf, ls, uniform([w, h, rw, rows, d, g0])], cells)
            blur('blurH2', 'blurV2', ls, tmp, ls, rw, rows, rs)
            dispatch('contrast', [ls, uniform([cells])], cells)
            blur('blurH2', 'blurV2', ls, tmp, ls, rw, rows, rs)
            dispatch(
              'tighten',
              [ls, alpha, uniform([w, rw, d, i0, i1, g0], [soft, hard, CONTRAST_LOW, CONTRAST_HIGH])],
              Math.ceil(i1 / 4) - (i0 >> 2),
            )
            await flush('tighten')
          }
          drop(ls)
          drop(tmp)
        } else {
          const lo = opts.tighten
          const hi = 1 - opts.tighten
          const table = new Uint32Array(256)
          for (let i = 0; i < 256; i++) {
            table[i] = Math.min(255, Math.max(0, Math.round(((i / 255 - lo) / (hi - lo)) * 255)))
          }
          const lut = make(1024, BUFFER.STORAGE | BUFFER.COPY_DST, false, stage)
          device.queue.writeBuffer(lut, 0, table)
          dispatch('lut', [lut, alpha, uniform([n])], words)
          await flush('tighten')
        }
      }
      drop(imageBuf)

      // One readback per result (alpha, colours, raw), straight from the packed words.
      const readbacks: [GpuBuffer, number][] = [[alpha, n]]
      if (colorsBuf) readbacks.push([colorsBuf, n * 4])
      if (rawBuf) readbacks.push([rawBuf, n])
      const mapped = readbacks.map(([src, bytes]) => {
        const dst = make(round4(bytes), BUFFER.MAP_READ | BUFFER.COPY_DST)
        enc.copyBufferToBuffer(src, 0, dst, 0, round4(bytes))
        return dst
      })
      await flush('copy')
      await Promise.all(mapped.map((b) => b.mapAsync(MAP_READ)))
      const outs = mapped.map((b, i) => {
        const out = new Uint8ClampedArray(readbacks[i][1])
        out.set(new Uint8Array(b.getMappedRange(), 0, readbacks[i][1]))
        b.unmap()
        return out
      })
      alphaOut = outs[0]
      let next = 1
      if (colorsBuf) colorsOut = outs[next++]
      if (rawBuf) rawOut = outs[next]
      if (timings) {
        const now = performance.now()
        timings.readback = now - mark
        mark = now
      }
    } catch (err) {
      failure = err
    }
    // Pop in reverse order. A failed run throws so the caller can fall back to the JS clean-up.
    const outOfMemory = await device.popErrorScope()
    const validation = await device.popErrorScope()
    for (const b of owned) drop(b)
    for (const b of stage) drop(b)
    if (timings) timings.peakBytes = peak
    if (outOfMemory) throw new Error(`GPU out of memory: ${outOfMemory.message}`)
    if (validation) throw new Error(`GPU validation error: ${validation.message}`)
    if (failure) throw failure
    return { alpha: alphaOut!, colors: colorsOut, raw: rawOut }
  }
  return { run }
}
