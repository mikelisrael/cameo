export type Mask = { width: number; height: number; data: Uint8ClampedArray }

export type Diagnostics = {
  device: 'webgpu' | 'wasm'
  /** Why this path: 'gpu' = running on the GPU; the rest say why the CPU path is in use. */
  reason: 'gpu' | 'no-webgpu' | 'no-adapter' | 'limits' | 'gpu-failed' | 'remembered'
  model: string // model id in use
  dtype: 'fp16' | 'fp32'
  size: number // the model's input size in px: 1024 for BiRefNet_lite, 512 for the WASM model
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
  | { type: 'result'; id: string; mask: Mask; colors?: Uint8ClampedArray; raw?: Mask }
  | { type: 'error'; id?: string; message: string }
  /** WebGPU loaded the model but couldn't run it. ONNX Runtime can't switch backends in the same
   * worker, so the page remembers to use WASM and starts a new worker. */
  | { type: 'gpu-failed' }

export type RefineOptions = { refine: boolean; decontaminate: boolean; eps: number; radius: number }
export const DEFAULT_REFINE: RefineOptions = { refine: true, decontaminate: true, eps: 2e-3, radius: 2 }
