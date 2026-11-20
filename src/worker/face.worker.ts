import * as ort from 'onnxruntime-web/wasm'
import type { FaceIn, FaceOut } from '../lib/protocol'
import { decodeYunet, YUNET_SIZE } from '../lib/yunet'

const ctx = self as unknown as {
  postMessage(message: FaceOut): void
  onmessage: ((e: MessageEvent<FaceIn>) => void) | null
}

let loading: Promise<ort.InferenceSession> | null = null
let queue: Promise<unknown> = Promise.resolve()

function load(): Promise<ort.InferenceSession> {
  if (!loading) {
    const p = (async () => {
      // The same runtime files the other models' ONNX Runtime uses (jsDelivr, pinned to this version), so the
      // browser fetches them once. One thread: the sharp model is busy on the others.
      const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`
      ort.env.wasm.wasmPaths = {
        mjs: `${base}ort-wasm-simd-threaded.asyncify.mjs`,
        wasm: `${base}ort-wasm-simd-threaded.asyncify.wasm`,
      }
      ort.env.wasm.numThreads = 1
      const res = await fetch(new URL('/models/yunet/model.onnx', self.location.href))
      if (!res.ok) throw new Error(`The face finder didn't load (${res.status})`)
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

async function find(image: ImageBitmap) {
  const session = await load()
  const t0 = performance.now()
  const canvas = new OffscreenCanvas(YUNET_SIZE, YUNET_SIZE)
  const g = canvas.getContext('2d', { willReadFrequently: true })
  if (!g) throw new Error('No 2D canvas in the worker')
  // The page sent at most 640 px on the long side: place it unscaled at the top-left, pad with 0.
  g.drawImage(image, 0, 0)
  const px = g.getImageData(0, 0, YUNET_SIZE, YUNET_SIZE).data
  const n = YUNET_SIZE * YUNET_SIZE
  const input = new Float32Array(3 * n)
  // Planar BGR, 0..255.
  for (let i = 0; i < n; i++) {
    input[i] = px[i * 4 + 2]
    input[n + i] = px[i * 4 + 1]
    input[2 * n + i] = px[i * 4]
  }
  const out = await session.run({
    [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, YUNET_SIZE, YUNET_SIZE]),
  })
  const outputs: Record<string, Float32Array> = {}
  for (const name of session.outputNames) outputs[name] = out[name].data as Float32Array
  const faces = decodeYunet(outputs, image.width, image.height)
  return { faces, ms: performance.now() - t0 }
}

ctx.onmessage = (e) => {
  const m = e.data
  if (m.type !== 'faces') return
  queue = queue.then(async () => {
    try {
      const { faces, ms } = await find(m.image)
      ctx.postMessage({ type: 'faces', id: m.id, faces, ms })
    } catch (err) {
      ctx.postMessage({ type: 'error', id: m.id, message: messageOf(err) })
    } finally {
      m.image.close()
    }
  })
}
