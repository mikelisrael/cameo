export type Mask = { width: number; height: number; data: Uint8ClampedArray }

/** Where one photo's time went, in ms. */
export type Timings = {
  prepare: number // decode + resize/normalise to the model's input size
  cutout: number // the model run
  mask: number // model output to a full-size mask
  refine: number // guided-filter sharpening
  decontaminate: number // removing the old background's colour from the edges
  total: number
  cleanup?: 'gpu' | 'cpu' // which processor ran the clean-up
}

export type Diagnostics = {
  device: 'webgpu' | 'wasm'
  /** Why this path: 'gpu' = running on the GPU; the rest say why the CPU path is in use. */
  reason: 'gpu' | 'no-webgpu' | 'no-adapter' | 'limits' | 'gpu-failed' | 'remembered'
  model: string // model id in use
  dtype: 'fp16' | 'fp32'
  size: number // the model's input size in px: 1024 for BiRefNet_lite, 512 for the WASM model
  threads: number // WASM threads ONNX Runtime runs on (1 unless the page is cross-origin isolated)
  loadMs: number // from starting to load to ready: download + session start (start-up time once cached)
  gpu?: { vendor: string; architecture: string; description: string; storageBuffers: number; maxBufferMB: number }
}

export type WorkerIn =
  | { type: 'load'; forceWasm?: boolean; reason?: 'gpu-failed' | 'remembered' }
  | { type: 'process'; id: string; image: ImageBitmap | Blob; options?: RefineOptions; compare?: boolean }

export type WorkerOut =
  | { type: 'progress'; file?: string; loaded?: number; total?: number; progress?: number }
  | { type: 'ready'; device: 'webgpu' | 'wasm'; diagnostics: Diagnostics }
  /** `colors`: RGBA the same size as `mask`, alpha 255, the foreground colours with the old background's bleed
   * removed. `raw`: the model's own mask before refinement, only when `compare` was set. */
  | { type: 'result'; id: string; mask: Mask; colors?: Uint8ClampedArray; raw?: Mask; timings: Timings }
  | { type: 'error'; id?: string; message: string }
  /** WebGPU loaded the model but couldn't run it. ONNX Runtime can't switch backends in the same
   * worker, so the page remembers to use WASM and starts a new worker. */
  | { type: 'gpu-failed' }
  /** A download dropped and the worker is about to try again: this is attempt `attempt` of `of`. */
  | { type: 'retrying'; attempt: number; of: number }

/** `tighten`: the half-transparent band after the guided filter is stretched so alpha below `tighten` becomes 0 and
 * above `1 - tighten` becomes 255 (0 = off). `tightenHard`: the same stretch used where the photo's local contrast is
 * low, e.g. dark on dark; 0 or <= `tighten` = plain tighten. */
export type RefineOptions = {
  refine: boolean
  decontaminate: boolean
  eps: number
  radius: number
  tighten: number
  tightenHard: number
  /** Run the clean-up on the GPU when it can; false = always the JS. */
  gpu: boolean
}
export const DEFAULT_REFINE: RefineOptions = {
  refine: true,
  decontaminate: true,
  eps: 2e-3,
  radius: 2,
  tighten: 0.2,
  tightenHard: 0.4,
  gpu: true,
}

/** The first look: a small model gives a rough mask from a 320 px copy of the photo while the sharp one runs. */
export type DraftIn = { type: 'draft'; id: string; image: ImageBitmap }
export type DraftOut =
  | { type: 'draft'; id: string; mask: Mask; ms: number } // mask is 320x320, 0..255
  | { type: 'error'; id?: string; message: string }

/** Face finding for the passport preset: YuNet in a lazy worker. Coordinates are in the pixels of the `image` sent. */
export type Point = { x: number; y: number }
export type Face = {
  score: number
  box: { x: number; y: number; w: number; h: number }
  eyeR: Point
  eyeL: Point
  nose: Point
  mouthR: Point
  mouthL: Point
}
export type FaceIn = { type: 'faces'; id: string; image: ImageBitmap }
export type FaceOut =
  { type: 'faces'; id: string; faces: Face[]; ms: number } | { type: 'error'; id?: string; message: string }

export type Seg = { x: number; y: number; w: number; h: number; alpha: Uint8ClampedArray } // rect in mask px; alpha is w*h, 0..255
export type SegIn =
  | { type: 'load' }
  | { type: 'embed'; id: string; image: ImageBitmap }
  | { type: 'decode'; id: string; req: number; x: number; y: number; width: number; height: number } // point in mask px; width/height = mask size
  | { type: 'drop'; id: string }
export type SegOut =
  | { type: 'progress'; progress: number } // 0..100, whole download
  | { type: 'ready' }
  | { type: 'embedded'; id: string }
  | { type: 'dropped'; id: string } // the worker evicted this image's embedding to stay within its cache
  | { type: 'decoded'; id: string; req: number; seg: Seg | null }
  | { type: 'error'; id?: string; req?: number; message: string }

/** 2x upscaling: Swin2SR in a lazy worker. */
export type UpIn = { type: 'load' } | { type: 'run'; job: number; image: ImageBitmap; mask: Mask; colors: boolean } // colors: also recompute edge colours
export type UpOut =
  | { type: 'progress'; progress: number } // 0..100, the model download
  | { type: 'ready' }
  | { type: 'tiles'; job: number; done: number; total: number }
  | { type: 'done'; job: number; image: ImageBitmap; mask: Mask; colors?: Uint8ClampedArray } // 2x photo, 2x model mask
  | { type: 'error'; job?: number; message: string }
