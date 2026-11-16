import { pipeline, RawImage, type ProgressInfo } from '@huggingface/transformers'
import { DEFAULT_REFINE, type Diagnostics, type Mask, type WorkerIn, type WorkerOut } from '../lib/protocol'
import { refine } from '../lib/refine'

const MODEL_ID = 'onnx-community/BiRefNet_lite-ONNX'
/** WASM has far less memory than a GPU: BiRefNet-lite at 1024px runs out (std::bad_alloc), so the
 * CPU path uses the same model trained at 512px. MIT licensed, like the GPU one. */
const WASM_MODEL_ID = 'studioludens/birefnet-lite-512'

const ctx = self as unknown as {
  postMessage(message: WorkerOut, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null
}

type Remover = (image: RawImage) => Promise<RawImage>
type Loaded = { remover: Remover; diagnostics: Diagnostics }
let loading: Promise<Loaded> | null = null

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
  return { remover: remover as unknown as Remover }
}

class GpuFailed extends Error {}

type GpuDevice = { features: Set<string>; destroy(): void }

type GpuAdapter = {
  features: Set<string>
  limits: Record<string, number>
  info?: { vendor?: string; architecture?: string; description?: string }
  requestDevice(descriptor: { requiredFeatures: string[]; requiredLimits: Record<string, number> }): Promise<GpuDevice>
}

/** The limits ONNX Runtime Web copies from the adapter when it makes its own device. */
const ORT_LIMITS = [
  'maxComputeWorkgroupStorageSize',
  'maxComputeWorkgroupsPerDimension',
  'maxStorageBufferBindingSize',
  'maxBufferSize',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX',
  'maxComputeWorkgroupSizeY',
  'maxComputeWorkgroupSizeZ',
]
/** Features ONNX Runtime Web asks for itself, when the adapter has them. */
const ORT_FEATURES = ['shader-f16', 'subgroups', 'timestamp-query']

type GpuProbe =
  | { reason: 'no-webgpu' | 'no-adapter'; adapter?: undefined }
  | { reason: 'limits'; adapter: GpuAdapter }
  | { reason: null; adapter: GpuAdapter }

/** BiRefNet's WebGPU shaders need more than 16 storage buffers per stage (measured: 17). */
async function probeGpu(): Promise<GpuProbe> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<GpuAdapter | null> } }).gpu
  if (!gpu) return { reason: 'no-webgpu' }
  let adapter: GpuAdapter | null = null
  try {
    adapter = await gpu.requestAdapter()
  } catch {
    // treated as no adapter
  }
  if (!adapter) return { reason: 'no-adapter' }
  if (!(adapter.limits.maxStorageBuffersPerShaderStage > 16)) return { reason: 'limits', adapter }
  return { reason: null, adapter }
}

function describeGpu(adapter?: GpuAdapter): Diagnostics['gpu'] {
  if (!adapter) return undefined
  return {
    vendor: adapter.info?.vendor ?? '',
    architecture: adapter.info?.architecture ?? '',
    description: adapter.info?.description ?? '',
    storageBuffers: adapter.limits.maxStorageBuffersPerShaderStage,
    maxBufferMB: Math.round((adapter.limits.maxBufferSize ?? 0) / (1024 * 1024)),
  }
}

/** ONNX Runtime makes its own device without `maxStorageBuffersPerShaderStage`, which leaves it at the
 * WebGPU default (8), too few for BiRefNet. So we make the device and hand it over. */
async function makeDevice(adapter: GpuAdapter) {
  const requiredLimits: Record<string, number> = {
    maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage,
  }
  for (const name of ORT_LIMITS) {
    if (adapter.limits[name] !== undefined) requiredLimits[name] = adapter.limits[name]
  }
  const requiredFeatures = ORT_FEATURES.filter((f) => adapter.features.has(f))
  try {
    return await adapter.requestDevice({ requiredFeatures, requiredLimits })
  } catch (err) {
    console.warn('WebGPU device could not be created', err)
    throw new GpuFailed(message(err))
  }
}

async function build(forceWasm: boolean, reason: 'gpu-failed' | 'remembered'): Promise<Loaded> {
  const probe = await probeGpu()
  const gpu = describeGpu(probe.adapter)
  if (forceWasm || probe.reason !== null) {
    const wasm = await buildWasm()
    return {
      remover: wasm.remover,
      diagnostics: {
        device: 'wasm',
        reason: forceWasm ? reason : (probe.reason as Diagnostics['reason']),
        model: WASM_MODEL_ID,
        dtype: 'fp32',
        size: 512,
        gpu,
      },
    }
  }
  const device = await makeDevice(probe.adapter)
  const dtypes: Array<'fp16' | 'fp32'> = device.features.has('shader-f16') ? ['fp16', 'fp32'] : ['fp32']
  for (const dtype of dtypes) {
    let remover: Remover | undefined
    try {
      remover = (await pipeline('background-removal', MODEL_ID, {
        device: 'webgpu',
        dtype,
        session_options: { executionProviders: [{ name: 'webgpu', device: device as unknown as GPUDevice }] },
        progress_callback: onProgress,
      })) as unknown as Remover
      // A GPU can pass the limits check and still fail to run the model. A tiny warm-up run finds out
      // now (and compiles the shaders for the first real image).
      await remover(new RawImage(new Uint8ClampedArray(64 * 64 * 3).fill(128), 64, 64, 3))
      return {
        remover,
        diagnostics: { device: 'webgpu', reason: 'gpu', model: MODEL_ID, dtype, size: 1024, gpu },
      }
    } catch (err) {
      console.warn(`WebGPU could not run the model (${dtype})`, err)
      try {
        await (remover as unknown as { dispose?: () => Promise<void> } | undefined)?.dispose?.()
      } catch {
        // nothing to free
      }
    }
  }
  device.destroy()
  throw new GpuFailed('WebGPU could not run the model')
}

let forceWasm = false
let loadReason: 'gpu-failed' | 'remembered' = 'remembered'

function load() {
  if (!loading) {
    loading = build(forceWasm, loadReason).catch((err) => {
      // A GPU failure stays: the page replaces this worker, so nothing here should try again.
      if (!(err instanceof GpuFailed)) loading = null
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
    loadReason = msg.reason ?? 'remembered'
    try {
      const { diagnostics } = await load()
      ctx.postMessage({ type: 'ready', device: diagnostics.device, diagnostics })
    } catch (err) {
      ctx.postMessage(err instanceof GpuFailed ? { type: 'gpu-failed' } : { type: 'error', message: message(err) })
    }
  } else if (msg.type === 'process') {
    try {
      const { remover, diagnostics } = await load()
      const input = await toRawImage(msg.image)
      const out = await remover(input) // RGBA at original size, alpha = mask
      const n = out.width * out.height
      const alpha = new Uint8ClampedArray(n)
      for (let i = 0; i < n; i++) alpha[i] = out.data[i * out.channels + (out.channels - 1)]

      const opts = msg.options ?? DEFAULT_REFINE
      let maskData: Uint8ClampedArray = alpha
      let colors: Uint8ClampedArray | undefined
      if (out.width === input.width && out.height === input.height && (opts.refine || opts.decontaminate)) {
        try {
          const refined = refine(input.data, input.channels, alpha, out.width, out.height, diagnostics.size, opts)
          maskData = refined.mask
          colors = refined.colors
        } catch (err) {
          console.warn('Refinement skipped:', message(err))
        }
      }
      const width = out.width
      const height = out.height
      // The raw mask must not share a buffer with the refined one, or it would be transferred twice.
      const raw: Mask | undefined = msg.compare
        ? { width, height, data: maskData === alpha ? new Uint8ClampedArray(alpha) : alpha }
        : undefined
      const transfer = [maskData.buffer, colors?.buffer, raw?.data.buffer].filter(
        (b): b is ArrayBuffer => b instanceof ArrayBuffer,
      )
      ctx.postMessage({ type: 'result', id: msg.id, mask: { width, height, data: maskData }, colors, raw }, transfer)
    } catch (err) {
      // The load handler reports a GPU failure once; the page resends this image to a new worker.
      if (err instanceof GpuFailed) return
      ctx.postMessage({ type: 'error', id: msg.id, message: message(err) })
    }
  }
}
