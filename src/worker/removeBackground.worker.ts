import { pipeline, RawImage, type ProgressInfo } from '@huggingface/transformers'
import type { WorkerIn, WorkerOut } from '../lib/protocol'

const MODEL_ID = 'onnx-community/BiRefNet_lite-ONNX'
/** WASM has far less memory than a GPU: BiRefNet-lite at 1024px runs out (std::bad_alloc), so the
 * CPU path uses the same model trained at 512px. MIT licensed, like the GPU one. */
const WASM_MODEL_ID = 'studioludens/birefnet-lite-512'

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

async function buildWasm() {
  const remover = await pipeline('background-removal', WASM_MODEL_ID, {
    device: 'wasm',
    dtype: 'fp32',
    progress_callback: onProgress,
  })
  return { remover: remover as unknown as Remover, device: 'wasm' as const }
}

class GpuFailed extends Error {}

/** BiRefNet's WebGPU shaders need more than 16 storage buffers per stage (measured: 17). */
async function gpuCanRunModel() {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<GpuAdapter | null> } }).gpu
  if (!gpu) return false
  try {
    const adapter = await gpu.requestAdapter()
    return !!adapter && adapter.limits.maxStorageBuffersPerShaderStage > 16
  } catch {
    return false
  }
}
type GpuAdapter = { limits: { maxStorageBuffersPerShaderStage: number } }

async function build(forceWasm: boolean) {
  if (forceWasm || !(await gpuCanRunModel())) return buildWasm()
  const remover = (await pipeline('background-removal', MODEL_ID, {
    device: 'webgpu',
    dtype: 'fp16',
    progress_callback: onProgress,
  })) as unknown as Remover
  // A GPU can pass the limits check and still fail to run the model. A tiny warm-up run finds out
  // now (and compiles the shaders for the first real image).
  try {
    await remover(new RawImage(new Uint8ClampedArray(64 * 64 * 3).fill(128), 64, 64, 3))
  } catch (err) {
    console.warn('WebGPU could not run the model', err)
    throw new GpuFailed(message(err))
  }
  return { remover, device: 'webgpu' as const }
}

let forceWasm = false

function load() {
  if (!loading) {
    loading = build(forceWasm).catch((err) => {
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
    forceWasm = !!msg.forceWasm
    try {
      const { device } = await load()
      ctx.postMessage({ type: 'ready', device })
    } catch (err) {
      ctx.postMessage(err instanceof GpuFailed ? { type: 'gpu-failed' } : { type: 'error', message: message(err) })
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
