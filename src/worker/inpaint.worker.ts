import * as ort from 'onnxruntime-web/wasm'
import type { InpaintIn, InpaintOut } from '../lib/protocol'

const MODEL_BYTES = 28_079_181

const ctx = self as unknown as {
  postMessage(message: InpaintOut, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<InpaintIn>) => void) | null
}

let loading: Promise<ort.InferenceSession> | null = null
let queue: Promise<unknown> = Promise.resolve()

async function download(): Promise<Uint8Array> {
  const res = await fetch(new URL('/models/migan/model.onnx', self.location.href))
  if (!res.ok) throw new Error(`The clean-up model didn't load (${res.status})`)
  const header = Number(res.headers.get('Content-Length'))
  // A compressed body's Content-Length is the compressed size, not the bytes the stream yields.
  const total = !res.headers.get('Content-Encoding') && header > 0 ? header : MODEL_BYTES
  if (!res.body) return new Uint8Array(await res.arrayBuffer())
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let got = 0
  let shown = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.byteLength
    const pct = Math.min(100, Math.floor((got / total) * 100))
    if (pct > shown) {
      shown = pct
      ctx.postMessage({ type: 'progress', progress: pct })
    }
  }
  const bytes = new Uint8Array(got)
  let at = 0
  for (const c of chunks) {
    bytes.set(c, at)
    at += c.byteLength
  }
  return bytes
}

function load(): Promise<ort.InferenceSession> {
  if (!loading) {
    const p = (async () => {
      const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`
      ort.env.wasm.wasmPaths = {
        mjs: `${base}ort-wasm-simd-threaded.asyncify.mjs`,
        wasm: `${base}ort-wasm-simd-threaded.asyncify.wasm`,
      }
      ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2)
      const bytes = await download()
      const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
      ctx.postMessage({ type: 'ready' })
      return session
    })()
    p.catch(() => {
      if (loading === p) loading = null // let the next fill try again
    })
    loading = p
  }
  return loading
}

function messageOf(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

async function fill(m: Extract<InpaintIn, { type: 'fill' }>) {
  const session = await load()
  const t0 = performance.now()
  const { width, height, image, hole } = m
  const n = width * height
  const rgb = new Uint8Array(3 * n)
  const keep = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    rgb[i] = image[i * 4]
    rgb[n + i] = image[i * 4 + 1]
    rgb[2 * n + i] = image[i * 4 + 2]
    keep[i] = hole[i] ? 0 : 255
  }
  const out = await session.run({
    image: new ort.Tensor('uint8', rgb, [1, 3, height, width]),
    mask: new ort.Tensor('uint8', keep, [1, 1, height, width]),
  })
  const o = out[session.outputNames[0]].data as Uint8Array
  const result = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    result[i * 4] = o[i]
    result[i * 4 + 1] = o[n + i]
    result[i * 4 + 2] = o[2 * n + i]
    result[i * 4 + 3] = 255
  }
  return { image: result, ms: performance.now() - t0 }
}

ctx.onmessage = (e) => {
  const m = e.data
  if (m.type !== 'fill') return
  queue = queue.then(async () => {
    try {
      const { image, ms } = await fill(m)
      ctx.postMessage({ type: 'filled', req: m.req, image, ms }, [image.buffer])
    } catch (err) {
      ctx.postMessage({ type: 'error', req: m.req, message: messageOf(err) })
    }
  })
}
