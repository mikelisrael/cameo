export type Mask = { width: number; height: number; data: Uint8ClampedArray }

export type WorkerIn = { type: 'load' } | { type: 'process'; id: string; image: ImageBitmap | Blob }

export type WorkerOut =
  | { type: 'progress'; file?: string; loaded?: number; total?: number; progress?: number }
  | { type: 'ready'; device: 'webgpu' | 'wasm' }
  | { type: 'result'; id: string; mask: Mask }
  | { type: 'error'; id?: string; message: string }
