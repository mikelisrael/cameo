import { useCallback, useEffect, useRef, useState } from 'react'
import type { Seg, SegIn, SegOut } from './protocol'

export type SegState = 'idle' | 'downloading' | 'embedding' | 'ready' | 'error'

type PendingDecode = { resolve: (seg: Seg | null) => void; reject: (err: Error) => void }

/** On-device click-to-select: SlimSAM in a lazy worker. The page prepares an image once, then decodes clicks. */
export function useSegmenter() {
  const workerRef = useRef<Worker | null>(null)
  const loaded = useRef(false)
  const embedded = useRef(new Set<string>())
  const requested = useRef(new Set<string>()) // embedded or embedding
  const images = useRef(new Map<string, ImageBitmap>()) // the page's bitmaps (never closed here), to embed again
  const pending = useRef(new Map<number, PendingDecode>())
  const nextReq = useRef(0)
  const last = useRef<string | null>(null)
  const [loadedState, setLoadedState] = useState(false)
  const [embeddedLast, setEmbeddedLast] = useState(false)
  const [failed, setFailed] = useState(false)
  const [started, setStarted] = useState(false)
  const [progress, setProgress] = useState(0)

  const rejectAll = useCallback((message: string) => {
    for (const p of pending.current.values()) p.reject(new Error(message))
    pending.current.clear()
  }, [])

  const spawn = useCallback(() => {
    workerRef.current?.terminate()
    const worker = new Worker(new URL('../worker/segment.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    loaded.current = false
    embedded.current.clear()
    requested.current.clear()
    setLoadedState(false)
    setEmbeddedLast(false)
    setFailed(false)
    setStarted(true)
    setProgress(0)

    worker.onmessage = (e: MessageEvent<SegOut>) => {
      if (workerRef.current !== worker) return // a worker we already replaced
      const m = e.data
      if (m.type === 'progress') {
        setProgress(Math.min(1, m.progress / 100))
      } else if (m.type === 'ready') {
        loaded.current = true
        setProgress(1)
        setLoadedState(true)
        setFailed(false) // a load that failed earlier has worked since
      } else if (m.type === 'embedded') {
        embedded.current.add(m.id)
        if (m.id === last.current) setEmbeddedLast(true)
      } else if (m.type === 'dropped') {
        // The worker evicted this embedding. Forget it, and embed again if the page is still on it.
        embedded.current.delete(m.id)
        requested.current.delete(m.id)
        if (m.id === last.current) {
          setEmbeddedLast(false)
          const image = images.current.get(m.id)
          if (image) {
            requested.current.add(m.id)
            worker.postMessage({ type: 'embed', id: m.id, image } satisfies SegIn)
          }
        }
      } else if (m.type === 'decoded') {
        const p = pending.current.get(m.req)
        pending.current.delete(m.req)
        p?.resolve(m.seg)
      } else if (m.type === 'error') {
        if (m.req !== undefined) {
          const p = pending.current.get(m.req)
          pending.current.delete(m.req)
          p?.reject(new Error(m.message))
        } else {
          if (m.id) requested.current.delete(m.id)
          if (!loaded.current || m.id === last.current) setFailed(true)
          if (!loaded.current) rejectAll(m.message)
        }
      }
    }
    worker.postMessage({ type: 'load' } satisfies SegIn)
    return worker
  }, [rejectAll])

  const post = useCallback((id: string, image: ImageBitmap) => {
    if (requested.current.has(id)) return
    requested.current.add(id)
    // Structured clone, not a transfer: the page keeps using its own bitmap.
    workerRef.current?.postMessage({ type: 'embed', id, image } satisfies SegIn)
  }, [])

  const prepare = useCallback(
    (id: string, image: ImageBitmap) => {
      images.current.set(id, image)
      last.current = id
      setEmbeddedLast(embedded.current.has(id))
      if (!workerRef.current) spawn()
      post(id, image)
    },
    [spawn, post],
  )

  const decode = useCallback(
    (id: string, x: number, y: number, width: number, height: number) =>
      new Promise<Seg | null>((resolve, reject) => {
        const worker = workerRef.current
        if (!worker) {
          reject(new Error('The selector is not ready'))
          return
        }
        if (!requested.current.has(id)) {
          // The worker let this image go (or it never had it): embed first, the worker's queue runs it before the decode.
          const image = images.current.get(id)
          if (!image) {
            reject(new Error('That image is not prepared'))
            return
          }
          post(id, image)
        }
        const req = nextReq.current++
        pending.current.set(req, { resolve, reject })
        worker.postMessage({ type: 'decode', id, req, x, y, width, height } satisfies SegIn)
      }),
    [post],
  )

  const drop = useCallback((id: string) => {
    images.current.delete(id)
    embedded.current.delete(id)
    requested.current.delete(id)
    if (last.current === id) {
      last.current = null
      setEmbeddedLast(false)
    }
    workerRef.current?.postMessage({ type: 'drop', id } satisfies SegIn)
  }, [])

  const retry = useCallback(() => {
    rejectAll('The selector was restarted')
    spawn()
    const id = last.current
    const image = id ? images.current.get(id) : undefined
    if (id && image) post(id, image)
  }, [rejectAll, spawn, post])

  useEffect(() => {
    const map = pending.current
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
      map.clear()
    }
  }, [])

  const state: SegState = failed
    ? 'error'
    : !started
      ? 'idle'
      : !loadedState
        ? 'downloading'
        : embeddedLast
          ? 'ready'
          : 'embedding'

  return { state, progress, prepare, decode, drop, retry }
}
