import { useCallback, useEffect, useRef, useState } from 'react'
import type { Mask, WorkerIn, WorkerOut } from './protocol'

export type Status = 'idle' | 'loading' | 'ready' | 'processing' | 'error'
export type Result = { original: ImageBitmap; mask: Mask }

type Pending = { resolve: (r: Result) => void; reject: (e: Error) => void; original: ImageBitmap }

export function useRemover() {
  const workerRef = useRef<Worker | null>(null)
  const pending = useRef(new Map<string, Pending>())
  const active = useRef(0)
  const loaded = useRef(false)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [device, setDevice] = useState<'webgpu' | 'wasm' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const chain = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    const worker = new Worker(new URL('../worker/removeBackground.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker
    const map = pending.current
    setStatus('loading')

    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      const m = e.data
      if (m.type === 'progress') {
        if (m.progress !== undefined) setProgress(Math.min(1, m.progress / 100))
      } else if (m.type === 'ready') {
        loaded.current = true
        setDevice(m.device)
        setProgress(1)
        setStatus(active.current > 0 ? 'processing' : 'ready')
      } else if (m.type === 'result') {
        const p = map.get(m.id)
        map.delete(m.id)
        p?.resolve({ original: p.original, mask: m.mask })
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
    worker.postMessage({ type: 'load' } satisfies WorkerIn)

    return () => {
      worker.terminate()
      workerRef.current = null
      map.clear()
    }
  }, [])

  const run = useCallback(async (file: File, onStart?: () => void): Promise<Result> => {
    const worker = workerRef.current
    if (!worker) throw new Error('Worker not available')
    onStart?.()
    const original = await createImageBitmap(file)
    const id = crypto.randomUUID()
    active.current++
    setStatus(loaded.current ? 'processing' : 'loading')
    try {
      return await new Promise<Result>((resolve, reject) => {
        pending.current.set(id, { resolve, reject, original })
        // Send the File (a Blob) so the worker never takes ownership of our display bitmap.
        worker.postMessage({ type: 'process', id, image: file } satisfies WorkerIn)
      })
    } finally {
      active.current--
      setStatus((s) => (s === 'error' ? s : active.current > 0 ? 'processing' : loaded.current ? 'ready' : 'loading'))
    }
  }, [])

  /** Sequential: each call waits for the previous one to finish. */
  const process = useCallback(
    (file: File, onStart?: () => void): Promise<Result> => {
      const next = chain.current.then(() => run(file, onStart))
      chain.current = next.catch(() => undefined)
      return next
    },
    [run],
  )

  return { status, progress, device, error, process }
}
