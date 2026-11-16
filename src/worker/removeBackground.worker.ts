import { pipeline, RawImage, type ProgressInfo } from '@huggingface/transformers'
import type { WorkerIn, WorkerOut } from '../lib/protocol'

const MODEL_ID = 'onnx-community/BiRefNet_lite-ONNX'

const ctx = self as unknown as {
  postMessage(message: WorkerOut, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null
}

type Remover = (image: RawImage) => Promise<RawImage>
let loading: Promise<{ remover: Remover; device: 'webgpu' | 'wasm' }> | null = null

function onProgress(info: ProgressInfo) {
  // Aggregate progress across all model files.
  if (info.status === 'progress_total') {
    ctx.postMessage({ type: 'progress', loaded: info.loaded, total: info.total, progress: info.progress })
  }
}

async function build() {
  const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator
  if (hasWebGPU) {
    try {
      const remover = await pipeline('background-removal', MODEL_ID, {
        device: 'webgpu',
        dtype: 'fp16',
        progress_callback: onProgress,
      })
      return { remover: remover as unknown as Remover, device: 'webgpu' as const }
    } catch (err) {
      console.warn('WebGPU load failed, falling back to WASM', err)
    }
  }
  const remover = await pipeline('background-removal', MODEL_ID, {
    device: 'wasm',
    dtype: 'fp32',
    progress_callback: onProgress,
  })
  return { remover: remover as unknown as Remover, device: 'wasm' as const }
}

function load() {
  if (!loading) {
    loading = build().catch((err) => {
      loading = null
      throw err
    })
  }
  return loading
}

async function toRawImage(image: ImageBitmap | Blob): Promise<RawImage> {
  if (image instanceof Blob) return RawImage.fromBlob(image)
  const canvas = new OffscreenCanvas(image.width, image.height)
  canvas.getContext('2d')!.drawImage(image, 0, 0)
  return RawImage.fromCanvas(canvas)
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

ctx.onmessage = async (e) => {
  const msg = e.data
  if (msg.type === 'load') {
    try {
      const { device } = await load()
      ctx.postMessage({ type: 'ready', device })
    } catch (err) {
      ctx.postMessage({ type: 'error', message: message(err) })
    }
  } else if (msg.type === 'process') {
    try {
      const { remover } = await load()
      const input = await toRawImage(msg.image)
      const out = await remover(input) // RGBA at original size, alpha = mask
      const n = out.width * out.height
      const alpha = new Uint8ClampedArray(n)
      for (let i = 0; i < n; i++) alpha[i] = out.data[i * out.channels + (out.channels - 1)]
      ctx.postMessage({ type: 'result', id: msg.id, mask: { width: out.width, height: out.height, data: alpha } }, [
        alpha.buffer,
      ])
    } catch (err) {
      ctx.postMessage({ type: 'error', id: msg.id, message: message(err) })
    }
  }
}
