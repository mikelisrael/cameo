import { env, pipeline, RawImage } from '@huggingface/transformers'
import { makeDownloadProgress } from '../lib/downloadProgress'
import type { Mask, UpIn, UpOut } from '../lib/protocol'
import { decontaminate } from '../lib/refine'
import { planTiles, scaleMask, UPSCALE_MODEL } from '../lib/upscale'
import { resumableFetch } from './resumableFetch'

env.fetch = resumableFetch

const ctx = self as unknown as {
  postMessage(message: UpOut, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<UpIn>) => void) | null
}

type Upscaler = (image: RawImage) => Promise<RawImage>

let loading: Promise<Upscaler> | null = null
let queue: Promise<unknown> = Promise.resolve()

function load(): Promise<Upscaler> {
  if (!loading) {
    const p = (async () => {
      const onProgress = makeDownloadProgress((progress) => ctx.postMessage({ type: 'progress', progress }))
      const upscaler = await pipeline('image-to-image', UPSCALE_MODEL, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: onProgress,
      })
      // Once per success, so a page that saw an earlier load fail hears that a later one worked.
      ctx.postMessage({ type: 'ready' })
      return upscaler as unknown as Upscaler
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

async function upscale(job: number, image: ImageBitmap, mask: Mask, colors: boolean) {
  const upscaler = await load()
  const w = image.width
  const h = image.height
  const W = w * 2
  const H = h * 2
  const canvas = new OffscreenCanvas(w, h)
  const g = canvas.getContext('2d', { willReadFrequently: true })
  if (!g) throw new Error('No 2D canvas in the worker')
  g.drawImage(image, 0, 0)
  const src = g.getImageData(0, 0, w, h).data
  const out = new Uint8ClampedArray(W * H * 4)
  out.fill(255) // alpha 255 everywhere; the colour bytes are overwritten tile by tile

  const tiles = planTiles(w, h)
  let done = 0
  for (const t of tiles) {
    const crop = new Uint8ClampedArray(t.sw * t.sh * 4)
    for (let y = 0; y < t.sh; y++) {
      const from = ((t.sy + y) * w + t.sx) * 4
      crop.set(src.subarray(from, from + t.sw * 4), y * t.sw * 4)
    }
    const o = await upscaler(new RawImage(crop, t.sw, t.sh, 4).rgb())
    // The processor pads the tile to a multiple of 8, so the output can be larger than 2*sw x 2*sh: read its own
    // width and channel count, and copy out only the core (the padded and overlapping edges are dropped).
    const ox = 2 * (t.cx - t.sx)
    const oy = 2 * (t.cy - t.sy)
    const rowLen = 2 * t.cw
    for (let y = 0; y < 2 * t.ch; y++) {
      let from = ((oy + y) * o.width + ox) * o.channels
      let to = ((2 * t.cy + y) * W + 2 * t.cx) * 4
      for (let x = 0; x < rowLen; x++) {
        out[to] = o.data[from]
        out[to + 1] = o.data[from + 1]
        out[to + 2] = o.data[from + 2]
        from += o.channels
        to += 4
      }
    }
    done++
    ctx.postMessage({ type: 'tiles', job, done, total: tiles.length })
  }

  const mask2 = scaleMask(mask, W, H)
  const colors2 = colors ? decontaminate(out, 4, mask2.data, W, H) : undefined

  const outCanvas = new OffscreenCanvas(W, H)
  const og = outCanvas.getContext('2d')
  if (!og) throw new Error('No 2D canvas in the worker')
  og.putImageData(new ImageData(out, W, H), 0, 0)
  const bitmap = outCanvas.transferToImageBitmap()
  image.close()
  const transfer: Transferable[] = [bitmap, mask2.data.buffer]
  if (colors2) transfer.push(colors2.buffer)
  ctx.postMessage({ type: 'done', job, image: bitmap, mask: mask2, colors: colors2 }, transfer)
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
  } else if (m.type === 'run') {
    run(async () => {
      try {
        await upscale(m.job, m.image, m.mask, m.colors)
      } catch (err) {
        m.image.close()
        ctx.postMessage({ type: 'error', job: m.job, message: messageOf(err) })
      }
    })
  }
}
