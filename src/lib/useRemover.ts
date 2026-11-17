import { useCallback, useEffect, useRef, useState } from 'react'
import { decodeImage, type Decoded } from './decode'
import type { Diagnostics, Mask, RefineOptions, WorkerIn, WorkerOut } from './protocol'

export type Status = 'idle' | 'loading' | 'ready' | 'processing' | 'error'
export type Result = {
  original: ImageBitmap
  mask: Mask
  colors?: Uint8ClampedArray
  raw?: Mask
  scaled?: Decoded['scaled']
  url: string
}

export type ProcessOpts = { options?: RefineOptions; compare?: boolean }

/** Set once WebGPU has failed to run the model on this browser, so later visits go straight to WASM. */
const FORCE_WASM_KEY = 'cutout:force-wasm'

function readForceWasm() {
  try {
    return localStorage.getItem(FORCE_WASM_KEY) === '1'
  } catch {
    return false
  }
}

function setForceWasm(on: boolean) {
  try {
    if (on) localStorage.setItem(FORCE_WASM_KEY, '1')
    else localStorage.removeItem(FORCE_WASM_KEY)
  } catch {
    // storage unavailable: the choice just isn't remembered
  }
}

async function postCopy(worker: Worker, id: string, bitmap: ImageBitmap, opts?: ProcessOpts) {
  const copy = await createImageBitmap(bitmap)
  if (bitmap.width === 0) return copy.close() // the display bitmap was closed meanwhile
  worker.postMessage(
    { type: 'process', id, image: copy, options: opts?.options, compare: opts?.compare } satisfies WorkerIn,
    [copy],
  )
}

type Pending = { resolve: (r: Result) => void; reject: (e: Error) => void; decoded: Decoded; opts?: ProcessOpts }

export function useRemover() {
  const workerRef = useRef<Worker | null>(null)
  const pending = useRef(new Map<string, Pending>())
  const active = useRef(0)
  const loaded = useRef(false)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [device, setDevice] = useState<'webgpu' | 'wasm' | null>(null)
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null)
  const [fellBack, setFellBack] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chain = useRef<Promise<unknown>>(Promise.resolve())

  /** Replaces the worker with a fresh one (a new ONNX Runtime) and hands it every image still waiting. */
  const spawn = useCallback(function spawn(forceWasm: boolean, reason?: 'gpu-failed' | 'remembered') {
    workerRef.current?.terminate()
    const worker = new Worker(new URL('../worker/removeBackground.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker
    const map = pending.current
    loaded.current = false
    setProgress(0)
    setError(null)
    setStatus('loading')

    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      if (workerRef.current !== worker) return // a worker we already replaced
      const m = e.data
      if (m.type === 'progress') {
        if (m.progress !== undefined) setProgress(Math.min(1, m.progress / 100))
      } else if (m.type === 'ready') {
        loaded.current = true
        setDevice(m.device)
        setDiagnostics(m.diagnostics)
        setProgress(1)
        setStatus(active.current > 0 ? 'processing' : 'ready')
      } else if (m.type === 'result') {
        const p = map.get(m.id)
        map.delete(m.id)
        if (p) {
          const { bitmap, scaled, url } = p.decoded
          p.resolve({ original: bitmap, mask: m.mask, colors: m.colors, raw: m.raw, scaled, url })
        }
      } else if (m.type === 'gpu-failed') {
        setForceWasm(true)
        setFellBack(true)
        spawn(true, 'gpu-failed')
      } else if (m.type === 'error') {
        if (m.id) {
          const p = map.get(m.id)
          map.delete(m.id)
          p?.reject(new Error(m.message))
        } else {
          setError(m.message)
          setStatus('error')
        }
      }
    }
    // The script itself failed (a chunk 404 after a deploy, an import error in an old browser):
    // no message will ever come, so settle everything waiting and show the same error as a load failure.
    const crashed = (e: Event) => {
      e.preventDefault()
      if (workerRef.current !== worker) return // a worker we already replaced
      const message = e instanceof ErrorEvent && e.message ? e.message : 'The worker failed to start'
      for (const p of map.values()) p.reject(new Error(message))
      map.clear()
      setError('a file was missing')
      setStatus('error')
    }
    worker.onerror = crashed
    worker.onmessageerror = crashed
    worker.postMessage({ type: 'load', forceWasm, reason } satisfies WorkerIn)
    // A posted bitmap is transferred and can't be sent twice, so each re-post sends a fresh copy.
    for (const [id, p] of map) {
      void postCopy(worker, id, p.decoded.bitmap, p.opts).catch((err: Error) => {
        map.delete(id)
        p.reject(err)
      })
    }
  }, [])

  useEffect(() => {
    const map = pending.current
    const remembered = readForceWasm()
    spawn(remembered, remembered ? 'remembered' : undefined)
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
      map.clear()
    }
  }, [spawn])

  /** Forget that the GPU failed and start over on it. */
  const retryGpu = useCallback(() => {
    setForceWasm(false)
    setFellBack(false)
    spawn(false)
  }, [spawn])

  const run = useCallback(
    async (
      file: File,
      onStart?: () => void,
      isCancelled?: () => boolean,
      onDecoded?: (d: Decoded) => void,
      opts?: ProcessOpts,
    ): Promise<Result> => {
      if (isCancelled?.()) throw new Error('Cancelled')
      if (!workerRef.current) throw new Error('Worker not available')
      onStart?.()
      const decoded = await decodeImage(file)
      onDecoded?.(decoded)
      const id = crypto.randomUUID()
      active.current++
      setStatus(loaded.current ? 'processing' : 'loading')
      try {
        return await new Promise<Result>((resolve, reject) => {
          pending.current.set(id, { resolve, reject, decoded, opts })
          // The worker gets a copy, so it never decodes the file and never owns our display bitmap.
          const worker = workerRef.current
          if (!worker) return reject(new Error('Worker not available'))
          postCopy(worker, id, decoded.bitmap, opts).catch((err: Error) => {
            pending.current.delete(id)
            reject(err)
          })
        })
      } catch (e) {
        decoded.bitmap.close()
        throw e
      } finally {
        active.current--
        setStatus((s) => (s === 'error' ? s : active.current > 0 ? 'processing' : loaded.current ? 'ready' : 'loading'))
      }
    },
    [],
  )

  /** Sequential: each call waits for the previous one to finish. `isCancelled` is asked when its
   * turn comes; if it says yes, the image is skipped (rejected) without reaching the worker. */
  const process = useCallback(
    (
      file: File,
      onStart?: () => void,
      isCancelled?: () => boolean,
      onDecoded?: (d: Decoded) => void,
      opts?: ProcessOpts,
    ): Promise<Result> => {
      const next = chain.current.then(() => run(file, onStart, isCancelled, onDecoded, opts))
      chain.current = next.catch(() => undefined)
      return next
    },
    [run],
  )

  return { status, progress, device, diagnostics, fellBack, error, process, retryGpu }
}
