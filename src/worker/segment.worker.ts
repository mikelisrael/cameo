import { AutoProcessor, RawImage, SamModel, Tensor } from '@huggingface/transformers'
import { makeDownloadProgress } from '../lib/downloadProgress'
import type { Seg, SegIn, SegOut } from '../lib/protocol'
import { refineAlpha } from '../lib/refine'

const MODEL_ID = 'Xenova/slimsam-77-uniform'
const MAX_CACHED = 2

const ctx = self as unknown as {
  postMessage(message: SegOut, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<SegIn>) => void) | null
}

type Inputs = { reshaped_input_sizes: [number, number][] } & Record<string, unknown>
type Processor = (image: RawImage) => Promise<Inputs>
type Embeddings = { image_embeddings: Tensor; image_positional_embeddings: Tensor }
type Loaded = {
  model: {
    get_image_embeddings(inputs: unknown): Promise<Embeddings>
    (inputs: Record<string, unknown>): Promise<{ pred_masks: Tensor; iou_scores: Tensor }>
  }
  processor: Processor
}
type Entry = { inputs: Inputs; emb: Embeddings; bitmap: ImageBitmap; W: number; H: number }
type Rect = { x: number; y: number; w: number; h: number }

let loading: Promise<Loaded> | null = null
const cache = new Map<string, Entry>()
let queue: Promise<unknown> = Promise.resolve()

function load(): Promise<Loaded> {
  if (!loading) {
    const p = (async () => {
      // One tracker for both files, so the bar counts the model and the processor together.
      const onProgress = makeDownloadProgress((progress) => ctx.postMessage({ type: 'progress', progress }))
      const [model, processor] = await Promise.all([
        SamModel.from_pretrained(MODEL_ID, { device: 'wasm', dtype: 'q8', progress_callback: onProgress }),
        AutoProcessor.from_pretrained(MODEL_ID, { progress_callback: onProgress }),
      ])
      // Once per success, so a page that saw an earlier load fail hears that a later one worked.
      ctx.postMessage({ type: 'ready' })
      return { model, processor } as unknown as Loaded
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

async function embed(id: string, bitmap: ImageBitmap) {
  if (cache.has(id)) {
    bitmap.close()
    return
  }
  const { model, processor } = await load()
  const W = bitmap.width
  const H = bitmap.height
  const canvas = new OffscreenCanvas(W, H)
  const g = canvas.getContext('2d', { willReadFrequently: true })
  if (!g) throw new Error('No 2D canvas in the worker')
  g.drawImage(bitmap, 0, 0)
  const px = g.getImageData(0, 0, W, H)
  const image = new RawImage(px.data, W, H, 4).rgb()
  const inputs = await processor(image)
  const emb = await model.get_image_embeddings(inputs)
  cache.set(id, { inputs, emb, bitmap, W, H })
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value as string
    cache.get(oldest)?.bitmap.close()
    cache.delete(oldest)
    ctx.postMessage({ type: 'dropped', id: oldest }) // the page must not count it as prepared any more
  }
}

/** Bounding box of positive logits inside the valid region, padded and clipped, in mask px. `vw`/`vh` are the valid
 * region in cells and may be fractional: that is the scale to the photo; the cells scanned run to their ceil. */
export function rectFromLogits(
  logits: Float32Array,
  off: number,
  vw: number,
  vh: number,
  width: number,
  height: number,
): Rect | null {
  const nw = Math.ceil(vw)
  const nh = Math.ceil(vh)
  let minX = nw
  let minY = nh
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < nh; y++) {
    const row = off + y * 256
    for (let x = 0; x < nw; x++) {
      if (logits[row + x] > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  const sx = width / vw
  const sy = height / vh
  const pad = Math.max(8, Math.round(0.02 * Math.max(width, height)))
  const x0 = Math.max(0, Math.floor(minX * sx) - pad)
  const y0 = Math.max(0, Math.floor(minY * sy) - pad)
  const x1 = Math.min(width, Math.ceil((maxX + 1) * sx) + pad)
  const y1 = Math.min(height, Math.ceil((maxY + 1) * sy) + pad)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Sigmoid of the bilinearly sampled logits over the rect, at mask resolution, as 0..255. */
export function probOverRect(
  logits: Float32Array,
  off: number,
  vw: number,
  vh: number,
  width: number,
  height: number,
  rect: Rect,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.w * rect.h)
  const nw = Math.ceil(vw)
  const nh = Math.ceil(vh)
  const clamp = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v)
  for (let j = 0; j < rect.h; j++) {
    const ly = clamp(((rect.y + j + 0.5) / height) * vh - 0.5, nh - 1)
    const y0 = Math.floor(ly)
    const y1 = Math.min(y0 + 1, nh - 1)
    const fy = ly - y0
    for (let i = 0; i < rect.w; i++) {
      const lx = clamp(((rect.x + i + 0.5) / width) * vw - 0.5, nw - 1)
      const x0 = Math.floor(lx)
      const x1 = Math.min(x0 + 1, nw - 1)
      const fx = lx - x0
      const a = logits[off + y0 * 256 + x0] * (1 - fx) + logits[off + y0 * 256 + x1] * fx
      const b = logits[off + y1 * 256 + x0] * (1 - fx) + logits[off + y1 * 256 + x1] * fx
      const l = a * (1 - fy) + b * fy
      out[j * rect.w + i] = Math.round(255 / (1 + Math.exp(-l)))
    }
  }
  return out
}

async function decode(id: string, x: number, y: number, width: number, height: number): Promise<Seg | null> {
  const entry = cache.get(id)
  if (!entry) throw new Error('That image is no longer prepared')
  const { model } = await load()
  const [rh, rw] = entry.inputs.reshaped_input_sizes[0]
  const input_points = new Tensor('float32', [(x / width) * rw, (y / height) * rh], [1, 1, 1, 2])
  const input_labels = new Tensor('int64', [1n], [1, 1, 1])
  const out = await model({ ...entry.emb, input_points, input_labels })

  const scores = out.iou_scores.data as Float32Array
  let best = 0
  for (let i = 1; i < 3; i++) if (scores[i] > scores[best]) best = i
  const logits = out.pred_masks.data as Float32Array
  const off = best * 256 * 256
  // The logits cover rw/4 x rh/4 cells of the resized image, so that (fractional) is the scale to the photo; the
  // helpers take their integer bounds (a partial last cell still holds a logit) from its ceil.
  const vw = Math.min(256, rw / 4)
  const vh = Math.min(256, rh / 4)

  const rect = rectFromLogits(logits, off, vw, vh, width, height)
  if (!rect) return null
  const prob = probOverRect(logits, off, vw, vh, width, height, rect)

  // Snap the soft edge to the photo's own edges: the colour guided filter, guided by the photo's pixels.
  const { bitmap, W, H } = entry
  const canvas = new OffscreenCanvas(rect.w, rect.h)
  const g = canvas.getContext('2d', { willReadFrequently: true })
  if (!g) throw new Error('No 2D canvas in the worker')
  g.drawImage(
    bitmap,
    (rect.x * W) / width,
    (rect.y * H) / height,
    (rect.w * W) / width,
    (rect.h * H) / height,
    0,
    0,
    rect.w,
    rect.h,
  )
  const guide = g.getImageData(0, 0, rect.w, rect.h).data
  // refineAlpha solves on a copy sub-sampled by s = 2 here (modelSize = long side / 2, so f = 2) and takes its
  // radius in model px, scaled by f / s = 1: radius / 2 sub-sampled px = `radius` mask px.
  const radius = Math.max(2, Math.round((4 * Math.max(width, height)) / 1024))
  const modelSize = Math.max(rect.w, rect.h) / 2
  const alpha = refineAlpha(guide, 4, prob, rect.w, rect.h, modelSize, { eps: 1e-3, radius: radius / 2 })
  return { ...rect, alpha }
}

function run(task: () => Promise<void>) {
  queue = queue.then(task)
}

ctx.onmessage = (e) => {
  const m = e.data
  if (m.type === 'load') {
    run(async () => {
      try {
        await load()
      } catch (err) {
        ctx.postMessage({ type: 'error', message: messageOf(err) })
      }
    })
  } else if (m.type === 'embed') {
    run(async () => {
      try {
        await embed(m.id, m.image)
        ctx.postMessage({ type: 'embedded', id: m.id })
      } catch (err) {
        ctx.postMessage({ type: 'error', id: m.id, message: messageOf(err) })
      }
    })
  } else if (m.type === 'decode') {
    run(async () => {
      try {
        const seg = await decode(m.id, m.x, m.y, m.width, m.height)
        ctx.postMessage({ type: 'decoded', id: m.id, req: m.req, seg }, seg ? [seg.alpha.buffer] : [])
      } catch (err) {
        ctx.postMessage({ type: 'error', id: m.id, req: m.req, message: messageOf(err) })
      }
    })
  } else if (m.type === 'drop') {
    run(async () => {
      cache.get(m.id)?.bitmap.close()
      cache.delete(m.id)
    })
  }
}
