/**
 * The slice of the WebGPU API the clean-up uses. The repo has no `@webgpu/types`, so these are declared here, as the
 * model worker does for its adapter probe.
 */
export type GpuBuffer = {
  destroy(): void
  mapAsync(mode: number): Promise<void>
  getMappedRange(): ArrayBuffer
  unmap(): void
}
export type GpuPipeline = { getBindGroupLayout(index: number): unknown }
export type GpuPass = {
  setPipeline(pipeline: GpuPipeline): void
  setBindGroup(index: number, group: unknown): void
  dispatchWorkgroups(x: number, y?: number): void
  end(): void
}
export type GpuEncoder = {
  beginComputePass(): GpuPass
  copyBufferToBuffer(src: GpuBuffer, srcOffset: number, dst: GpuBuffer, dstOffset: number, size: number): void
  finish(): unknown
}
export type GpuDevice = {
  limits: { maxStorageBufferBindingSize: number; maxBufferSize: number }
  queue: {
    submit(commands: unknown[]): void
    writeBuffer(buffer: GpuBuffer, offset: number, data: ArrayBufferView): void
    onSubmittedWorkDone(): Promise<void>
  }
  lost: Promise<unknown>
  createBuffer(descriptor: { size: number; usage: number; mappedAtCreation?: boolean }): GpuBuffer
  createShaderModule(descriptor: { code: string }): unknown
  createComputePipelineAsync(descriptor: {
    layout: 'auto'
    compute: { module: unknown; entryPoint: string }
  }): Promise<GpuPipeline>
  createBindGroup(descriptor: {
    layout: unknown
    entries: { binding: number; resource: { buffer: GpuBuffer } }[]
  }): unknown
  createCommandEncoder(): GpuEncoder
  pushErrorScope(filter: 'validation' | 'out-of-memory'): void
  popErrorScope(): Promise<{ message: string } | null>
}

/** `GPUBufferUsage` and `GPUMapMode` values (the globals are not typed here). */
export const BUFFER = { MAP_READ: 0x1, COPY_SRC: 0x4, COPY_DST: 0x8, UNIFORM: 0x40, STORAGE: 0x80 } as const
export const MAP_READ = 0x1

type GpuAdapter = {
  limits: Record<string, number>
  requestDevice(descriptor: { requiredLimits: Record<string, number> }): Promise<GpuDevice>
}

let device: Promise<GpuDevice | null> | null = null

async function open(): Promise<GpuDevice | null> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<GpuAdapter | null> } }).gpu
    const adapter = await gpu?.requestAdapter()
    if (!adapter) return null
    // No features, and the adapter's own buffer limits: a 24 MP photo needs buffers over the 128 MB default.
    const dev = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    })
    void dev.lost.then(() => {
      device = Promise.resolve(null)
    })
    return dev
  } catch {
    return null
  }
}

/**
 * The GPU device used for the clean-up, made once. It is this module's own device, never ONNX Runtime's, so a failure
 * here cannot take the model down with it. Resolves to null when there is no WebGPU or the device could not be made,
 * and, once the device has been lost, to null for good.
 */
export function getGpuDevice(): Promise<GpuDevice | null> {
  device ??= open()
  return device
}
