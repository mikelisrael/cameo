import { env, pipeline, RawImage, type Tensor } from '@huggingface/transformers'
import { makeDownloadProgress } from '../lib/downloadProgress'
import {
  DEFAULT_REFINE,
  type Diagnostics,
  type Mask,
  type Timings,
  type WorkerIn,
  type WorkerOut,
} from '../lib/protocol'
import { decontaminate, refineAlpha } from '../lib/refine'
import { resumableFetch } from './resumableFetch'

const MODEL_ID = 'onnx-community/BiRefNet_lite-ONNX'
/** WASM has far less memory than a GPU: BiRefNet-lite at 1024px runs out (std::bad_alloc), so the
 * CPU path uses the same model trained at 512px. MIT licensed, like the GPU one. */
const WASM_MODEL_ID = 'studioludens/birefnet-lite-512'

env.fetch = resumableFetch

const ctx = self as unknown as {
  postMessage(message: WorkerOut, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null
}

/** The library's background-removal pipeline. `processor` and `model` are what its own call runs, one after the
 * other; process() runs them itself so each step can be timed. */
type Remover = ((image: RawImage) => Promise<RawImage>) & {
  processor: (images: RawImage[]) => Promise<Record<string, Tensor>>
  model: ((inputs: Record<string, Tensor>) => Promise<Record<string, Tensor>>) & {
    sessions: { model: { inputNames: string[]; outputNames: string[] } }
  }
}
type Loaded = { remover: Remover; diagnostics: Diagnostics }
let loading: Promise<Loaded> | null = null

/** A fresh tracker per load: every attempt and retry downloads (or reads the cache) from the start. */
const newTracker = () => makeDownloadProgress((progress) => ctx.postMessage({ type: 'progress', progress }))

async function buildWasm() {
  const remover = await pipeline('background-removal', WASM_MODEL_ID, {
    device: 'wasm',
    dtype: 'fp32',
    progress_callback: newTracker(),
  })
  ctx.postMessage({ type: 'progress', progress: 100 }) // the files are in: the UI moves on to "Starting up"
  return { remover: remover as unknown as Remover, threads: wasmThreads() }
}

/** ONNX Runtime writes the thread count it settled on into its env when it starts: several when the page
 * is cross-origin isolated, otherwise 1. Fall back to that rule if the value isn't there. */
function wasmThreads() {
  const n = env.backends.onnx.wasm?.numThreads
  if (typeof n === 'number' && n >= 1) return n
  return self.crossOriginIsolated ? Math.min(4, Math.ceil((navigator.hardwareConcurrency || 2) / 2)) : 1
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

/** BiRefNet's decoder has Split nodes with 32 outputs, and ONNX Runtime's WebGPU Split binds the input plus every
 * output to one shader without chunking, so it needs 33 storage buffers per stage. A GPU with fewer would download
 * the GPU model and then fail at run time. */
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
  if (!(adapter.limits.maxStorageBuffersPerShaderStage >= 33)) return { reason: 'limits', adapter }
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
  const started = performance.now()
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
        threads: wasm.threads,
        gpu,
        loadMs: Math.round(performance.now() - started),
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
        progress_callback: newTracker(),
      })) as unknown as Remover
      ctx.postMessage({ type: 'progress', progress: 100 })
      // A GPU can pass the limits check and still fail to run the model. A tiny warm-up run finds out
      // now (and compiles the shaders for the first real image).
      await remover(new RawImage(new Uint8ClampedArray(64 * 64 * 3).fill(128), 64, 64, 3))
      return {
        remover,
        diagnostics: {
          device: 'webgpu',
          reason: 'gpu',
          model: MODEL_ID,
          dtype,
          size: 1024,
          threads: 1,
          gpu,
          loadMs: Math.round(performance.now() - started),
        },
      }
    } catch (err) {
      console.warn(`WebGPU could not run the model (${dtype})`, err)
      try {
        await (remover as unknown as { dispose?: () => Promise<void> } | undefined)?.dispose?.()
      } catch {
        // nothing to free
      }
      // A dropped download says nothing about the GPU: let the load retry instead of blaming it.
      if (isNetworkError(err)) {
        device.destroy()
        throw err
      }
    }
  }
  device.destroy()
  throw new GpuFailed('WebGPU could not run the model')
}

let forceWasm = false
let loadReason: 'gpu-failed' | 'remembered' = 'remembered'

const LOAD_ATTEMPTS = 3
const RETRY_WAITS_MS = [2000, 6000]

/** What a dropped connection or a hub hiccup looks like: fetch's own TypeError text (Chrome, Firefox, Safari),
 * and the hub's 408/429/5xx as transformers.js words them. Missing files (401/403/404) and anything about
 * memory or the model itself are not here, so they fail at once. */
const NETWORK_ERROR =
  /failed to fetch|networkerror|network error|network connection|load failed|terminated|request timeout|bad gateway|service unavailable|gateway timeout|internal server error|Error \((408|429|5\d\d)\) occurred/i

function isNetworkError(err: unknown) {
  return !(err instanceof GpuFailed) && NETWORK_ERROR.test(message(err))
}

async function buildWithRetry() {
  for (let attempt = 1; ; attempt++) {
    try {
      return await build(forceWasm, loadReason)
    } catch (err) {
      if (attempt >= LOAD_ATTEMPTS || !isNetworkError(err)) throw err
      console.warn(`Model download failed (attempt ${attempt} of ${LOAD_ATTEMPTS})`, err)
      ctx.postMessage({ type: 'retrying', attempt: attempt + 1, of: LOAD_ATTEMPTS })
      await new Promise((resolve) => setTimeout(resolve, RETRY_WAITS_MS[attempt - 1]))
    }
  }
}

/** The last load failed and the page hasn't asked again, so a late `process` must not start a load nobody awaits. */
let loadFailed = false
let lastLoadError: unknown

function load() {
  if (!loading) {
    loading = buildWithRetry().catch((err) => {
      // A GPU failure stays: the page replaces this worker, so nothing here should try again.
      if (!(err instanceof GpuFailed)) loading = null
      loadFailed = true
      lastLoadError = err
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
    loadFailed = false
    try {
      const { diagnostics } = await load()
      ctx.postMessage({ type: 'ready', device: diagnostics.device, diagnostics })
    } catch (err) {
      ctx.postMessage(err instanceof GpuFailed ? { type: 'gpu-failed' } : { type: 'error', message: message(err) })
    }
  } else if (msg.type === 'process') {
    if (loadFailed && !loading) {
      ctx.postMessage({ type: 'error', id: msg.id, message: message(lastLoadError) })
      return
    }
    let loaded: Loaded
    try {
      loaded = await load()
    } catch {
      // The load handler reports a failed load once; the page keeps this image and resends it after Try again.
      return
    }
    try {
      const { remover, diagnostics } = loaded
      const t0 = performance.now()
      const input = await toRawImage(msg.image)
      // The same steps as the library's own call (image-segmentation pipeline), one at a time to time them.
      const inputs = await remover.processor([input])
      const t1 = performance.now()
      const { inputNames, outputNames } = remover.model.sessions.model
      if (!inputNames.includes('pixel_values')) inputs[inputNames[0]] = inputs.pixel_values
      const output = await remover.model(inputs)
      const t2 = performance.now()
      const item = (output[outputNames[0]] as unknown as Tensor[])[0] // a Tensor indexes into its batch
      if ((item.data as Float32Array).some((x) => x < -1e-5 || x > 1 + 1e-5)) item.sigmoid_()
      const maskImage = await RawImage.fromTensor(item.mul_(255).to('uint8')).resize(input.width, input.height)
      const alpha = new Uint8ClampedArray(maskImage.data)
      const t3 = performance.now()

      const opts = msg.options ?? DEFAULT_REFINE
      let maskData: Uint8ClampedArray = alpha
      let colors: Uint8ClampedArray | undefined
      let t4 = t3
      let t5 = t3
      if (opts.refine || opts.decontaminate) {
        try {
          const { width: w, height: h } = input
          if (opts.refine) maskData = refineAlpha(input.data, input.channels, alpha, w, h, diagnostics.size, opts)
          t4 = performance.now()
          if (opts.decontaminate) colors = decontaminate(input.data, input.channels, maskData, w, h)
          t5 = performance.now()
        } catch (err) {
          console.warn('Refinement skipped:', message(err))
        }
      }
      const width = input.width
      const height = input.height
      // The raw mask must not share a buffer with the refined one, or it would be transferred twice.
      const raw: Mask | undefined = msg.compare
        ? { width, height, data: maskData === alpha ? new Uint8ClampedArray(alpha) : alpha }
        : undefined
      const transfer = [maskData.buffer, colors?.buffer, raw?.data.buffer].filter(
        (b): b is ArrayBuffer => b instanceof ArrayBuffer,
      )
      const ms = (a: number, b: number) => Math.round(b - a)
      const timings: Timings = {
        prepare: ms(t0, t1),
        cutout: ms(t1, t2),
        mask: ms(t2, t3),
        refine: ms(t3, t4),
        decontaminate: ms(t4, t5),
        total: ms(t0, performance.now()),
      }
      ctx.postMessage(
        { type: 'result', id: msg.id, mask: { width, height, data: maskData }, colors, raw, timings },
        transfer,
      )
    } catch (err) {
      // The load handler reports a GPU failure once; the page resends this image to a new worker.
      if (err instanceof GpuFailed) return
      ctx.postMessage({ type: 'error', id: msg.id, message: message(err) })
    }
  }
}
