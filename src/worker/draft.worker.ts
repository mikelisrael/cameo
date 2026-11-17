import * as ort from 'onnxruntime-web/wasm'
import type { DraftIn, DraftOut } from '../lib/protocol'

const SIZE = 320
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

const ctx = self as unknown as {
  postMessage(message: DraftOut, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<DraftIn>) => void) | null
}

let loading: Promise<ort.InferenceSession> | null = null
let queue: Promise<unknown> = Promise.resolve()

function load(): Promise<ort.InferenceSession> {
  if (!loading) {
    const p = (async () => {
      // The same runtime files the main model's ONNX Runtime uses (jsDelivr, pinned to this version), so the
      // browser fetches them once. One thread: the sharp model is busy on the others.
      const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`
      ort.env.wasm.wasmPaths = {
        mjs: `${base}ort-wasm-simd-threaded.asyncify.mjs`,
        wasm: `${base}ort-wasm-simd-threaded.asyncify.wasm`,
      }
      ort.env.wasm.numThreads = 1
      const res = await fetch(new URL('/models/u2netp/model.onnx', self.location.href))
      if (!res.ok) throw new Error(`The first-look model didn't load (${res.status})`)
      return ort.InferenceSession.create(await res.arrayBuffer(), { executionProviders: ['wasm'] })
    })()
    p.catch(() => {
      if (loading === p) loading = null // let a retry try again
    })
    loading = p
  }
  return loading
}

function messageOf(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

async function draft(image: ImageBitmap) {
  const session = await load()
  const t0 = performance.now()
  const canvas = new OffscreenCanvas(SIZE, SIZE)
  const g = canvas.getContext('2d', { willReadFrequently: true })
  if (!g) throw new Error('No 2D canvas in the worker')
  // The page already resized the photo to SIZE x SIZE (stretched, not letterboxed).
  g.drawImage(image, 0, 0, SIZE, SIZE)
  const px = g.getImageData(0, 0, SIZE, SIZE).data
  const n = SIZE * SIZE
  const input = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) input[k * n + i] = (px[i * 4 + k] / 255 - MEAN[k]) / STD[k]
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) })
  const o = out[session.outputNames[0]].data as Float32Array
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < n; i++) {
    if (o[i] < lo) lo = o[i]
    if (o[i] > hi) hi = o[i]
  }
  const data = new Uint8ClampedArray(n)
  const span = hi - lo || 1
  for (let i = 0; i < n; i++) data[i] = ((o[i] - lo) / span) * 255
  return { mask: { width: SIZE, height: SIZE, data }, ms: performance.now() - t0 }
}

ctx.onmessage = (e) => {
  const m = e.data
  if (m.type !== 'draft') return
  queue = queue.then(async () => {
    try {
      const { mask, ms } = await draft(m.image)
      ctx.postMessage({ type: 'draft', id: m.id, mask, ms }, [mask.data.buffer])
    } catch (err) {
      ctx.postMessage({ type: 'error', id: m.id, message: messageOf(err) })
    } finally {
      m.image.close()
    }
  })
}
