import { useCallback, useEffect, useRef, useState } from 'react'
import type { InpaintIn, InpaintOut } from './protocol'

export type InpaintStatus = 'idle' | 'loading' | 'ready' | 'error'

const KEY = 'cutout:inpaint-ready'

function readKnown() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

type Pending = { resolve: (image: Uint8ClampedArray) => void; reject: (err: Error) => void }

/** On-device object removal: MI-GAN in a lazy worker. The model downloads on the first fill, never before. */
export function useInpainter() {
  const workerRef = useRef<Worker | null>(null)
  const readyRef = useRef(false)
  const pending = useRef(new Map<number, Pending>())
  const nextReq = useRef(0)
  const [status, setStatus] = useState<InpaintStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [known, setKnown] = useState(readKnown)

  const rejectAll = useCallback((message: string) => {
    for (const p of pending.current.values()) p.reject(new Error(message))
    pending.current.clear()
  }, [])

  const fail = useCallback(
    (message: string) => {
      rejectAll(message)
      setError(message)
      setStatus('error')
    },
    [rejectAll],
  )

  const spawn = useCallback(() => {
    const worker = new Worker(new URL('../worker/inpaint.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    readyRef.current = false
    setStatus('loading')
    setProgress(0)
    setError(null)

    worker.onmessage = (e: MessageEvent<InpaintOut>) => {
      if (workerRef.current !== worker) return // a worker we already replaced
      const m = e.data
      if (m.type === 'progress') {
        setProgress(Math.max(0, Math.min(100, m.progress)))
      } else if (m.type === 'ready') {
        readyRef.current = true
        setProgress(100)
        setStatus('ready')
        setKnown(true)
        try {
          localStorage.setItem(KEY, '1')
        } catch {
          // storage unavailable: the hint just isn't remembered
        }
      } else if (m.type === 'filled') {
        const p = pending.current.get(m.req)
        pending.current.delete(m.req)
        p?.resolve(m.image)
      } else if (m.type === 'error') {
        if (readyRef.current) {
          if (m.req === undefined) return
          const p = pending.current.get(m.req)
          pending.current.delete(m.req)
          p?.reject(new Error(m.message))
        } else {
          // The load failed: the worker clears it, so a fresh fill would retry, but the page shows the error first.
          workerRef.current = null
          worker.terminate()
          fail(m.message)
        }
      }
    }
    // The script itself failed (a chunk 404 after a deploy, an old browser): no message will come.
    const crashed = (e: Event) => {
      e.preventDefault()
      if (workerRef.current !== worker) return
      workerRef.current = null
      worker.terminate()
      readyRef.current = false
      fail("The clean-up tool couldn't start. Try again.")
    }
    worker.onerror = crashed
    worker.onmessageerror = crashed
    return worker
  }, [fail])

  const fill = useCallback(
    (image: Uint8ClampedArray, hole: Uint8Array, width: number, height: number) =>
      new Promise<Uint8ClampedArray>((resolve, reject) => {
        const worker = workerRef.current ?? spawn()
        const req = nextReq.current++
        pending.current.set(req, { resolve, reject })
        worker.postMessage({ type: 'fill', req, width, height, image, hole } satisfies InpaintIn)
      }),
    [spawn],
  )

  const retry = useCallback(() => {
    setError(null)
    setProgress(0)
    setStatus('idle')
  }, [])

  useEffect(() => {
    const map = pending.current
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
      map.clear()
    }
  }, [])

  return { status, progress, error, known, fill, retry }
}
