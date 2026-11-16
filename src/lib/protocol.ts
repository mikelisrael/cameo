export type Mask = { width: number; height: number; data: Uint8ClampedArray }

export type WorkerIn =
  { type: 'load'; forceWasm?: boolean } | { type: 'process'; id: string; image: ImageBitmap | Blob }

export type WorkerOut =
  | { type: 'progress'; file?: string; loaded?: number; total?: number; progress?: number }
  | { type: 'ready'; device: 'webgpu' | 'wasm' }
  | { type: 'result'; id: string; mask: Mask }
  | { type: 'error'; id?: string; message: string }
  /** WebGPU loaded the model but couldn't run it. ONNX Runtime can't switch backends in the same
   * worker, so the page remembers to use WASM and reloads. */
  | { type: 'gpu-failed' }
