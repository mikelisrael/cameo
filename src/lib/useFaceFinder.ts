import { useCallback, useEffect, useRef } from 'react'
import type { Face, FaceIn, FaceOut } from './protocol'

const MAX_SIDE = 640

type Pending = { resolve: (faces: Face[]) => void; reject: (err: Error) => void; scale: number }

/** On-device face finding: YuNet in a lazy worker, started by the first `find`. */
export function useFaceFinder() {
  const workerRef = useRef<Worker | null>(null)
  const cache = useRef(new Map<string, Promise<Face[]>>())
  const pending = useRef(new Map<string, Pending>())

  const rejectAll = useCallback((message: string) => {
    for (const [id, p] of pending.current) {
      p.reject(new Error(message))
      cache.current.delete(id) // so a retry can run
    }
    pending.current.clear()
  }, [])

  const getWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current
    const worker = new Worker(new URL('../worker/face.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = (e: MessageEvent<FaceOut>) => {
      if (workerRef.current !== worker) return
      const m = e.data
      if (m.type === 'faces') {
        const p = pending.current.get(m.id)
        pending.current.delete(m.id)
        const k = p ? 1 / p.scale : 1
        p?.resolve(
          m.faces.map((f) => ({
            score: f.score,
            box: { x: f.box.x * k, y: f.box.y * k, w: f.box.w * k, h: f.box.h * k },
            eyeR: { x: f.eyeR.x * k, y: f.eyeR.y * k },
            eyeL: { x: f.eyeL.x * k, y: f.eyeL.y * k },
            nose: { x: f.nose.x * k, y: f.nose.y * k },
            mouthR: { x: f.mouthR.x * k, y: f.mouthR.y * k },
            mouthL: { x: f.mouthL.x * k, y: f.mouthL.y * k },
          })),
        )
      } else if (m.id !== undefined) {
        const p = pending.current.get(m.id)
        pending.current.delete(m.id)
        cache.current.delete(m.id)
        p?.reject(new Error(m.message))
      } else {
        rejectAll(m.message)
      }
    }
    // The script itself failed (a chunk 404 after a deploy, an import error in an old browser): no message will
    // ever come, so settle every waiting request and start a fresh worker next time.
    const crashed = (e: Event) => {
      e.preventDefault()
      if (workerRef.current !== worker) return
      worker.terminate()
      workerRef.current = null
      rejectAll("The face finder couldn't start. Reload the page to try again.")
    }
    worker.onerror = crashed
    worker.onmessageerror = crashed
    return worker
  }, [rejectAll])

  const find = useCallback(
    (id: string, original: ImageBitmap) => {
      const cached = cache.current.get(id)
      if (cached) return cached
      const promise = (async () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(original.width, original.height))
        const small = await createImageBitmap(original, {
          resizeWidth: Math.max(1, Math.round(original.width * scale)),
          resizeHeight: Math.max(1, Math.round(original.height * scale)),
          resizeQuality: 'high',
        })
        return new Promise<Face[]>((resolve, reject) => {
          pending.current.set(id, { resolve, reject, scale })
          getWorker().postMessage({ type: 'faces', id, image: small } satisfies FaceIn, [small])
        })
      })()
      cache.current.set(id, promise)
      promise.catch(() => {
        if (cache.current.get(id) === promise) cache.current.delete(id)
      })
      return promise
    },
    [getWorker],
  )

  const forget = useCallback((id: string) => {
    cache.current.delete(id)
  }, [])

  useEffect(() => {
    const map = pending.current
    const results = cache.current
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
      map.clear()
      results.clear()
    }
  }, [])

  return { find, forget }
}
