import { useCallback, useEffect, useRef, useState } from 'react'
import type { Mask, UpIn, UpOut } from './protocol'

export type UpState = 'idle' | 'downloading' | 'running' | 'error'
export type Upscaled = { image: ImageBitmap; mask: Mask; colors?: Uint8ClampedArray }

type Job = { job: number; id: string; resolve: (r: Upscaled) => void; reject: (err: Error) => void }

/** On-device 2x upscaling: Swin2SR in a lazy worker, spawned (and its model downloaded) on the first upscale. */
export function useUpscaler() {
  const workerRef = useRef<Worker | null>(null)
  const loaded = useRef(false)
  const current = useRef<Job | null>(null)
  const nextJob = useRef(0)
  const [started, setStarted] = useState(false)
  const [loadedState, setLoadedState] = useState(false)
  const [failed, setFailed] = useState(false)
  const [progress, setProgress] = useState(0)
  const [tiles, setTiles] = useState<{ done: number; total: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [failedFor, setFailedFor] = useState<string | null>(null) // the photo whose own run failed

  const settle = useCallback((fn: (job: Job) => void) => {
    const job = current.current
    current.current = null
    setBusy(null)
    setTiles(null)
    if (job) fn(job)
  }, [])

  const spawn = useCallback(
    (gpu: boolean) => {
      workerRef.current?.terminate()
      const worker = new Worker(new URL('../worker/upscale.worker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker
      loaded.current = false
      setStarted(true)
      setLoadedState(false)
      setFailed(false)
      setProgress(0)

      worker.onmessage = (e: MessageEvent<UpOut>) => {
        if (workerRef.current !== worker) return // a worker we already replaced
        const m = e.data
        if (m.type === 'progress') {
          setProgress(Math.min(1, m.progress / 100))
        } else if (m.type === 'ready') {
          loaded.current = true
          setProgress(1)
          setLoadedState(true)
          setFailed(false)
        } else if (m.type === 'tiles') {
          if (current.current?.job === m.job) setTiles({ done: m.done, total: m.total })
        } else if (m.type === 'done') {
          if (current.current?.job !== m.job) {
            m.image.close()
            return
          }
          settle((j) => j.resolve({ image: m.image, mask: m.mask, colors: m.colors }))
        } else if (m.type === 'error') {
          if (m.job !== undefined) {
            if (current.current?.job === m.job) {
              setFailedFor(current.current.id)
              settle((j) => j.reject(new Error(m.message)))
            }
          } else {
            // A load failure: the waiting job can't run.
            settle((j) => j.reject(new Error(m.message)))
            setFailed(true)
          }
        }
      }
      // The script itself failed (a chunk 404 after a deploy, an import error in an old browser): no message will
      // ever come, so settle the waiting job and show the failed state.
      const crashed = (e: Event) => {
        e.preventDefault()
        if (workerRef.current !== worker) return
        settle((j) => j.reject(new Error("The upscaler couldn't start. Reload the page to try again.")))
        setFailed(true)
      }
      worker.onerror = crashed
      worker.onmessageerror = crashed
      worker.postMessage({ type: 'load', gpu } satisfies UpIn)
      return worker
    },
    [settle],
  )

  const upscale = useCallback(
    async (id: string, original: ImageBitmap, mask: Mask, colors: boolean, gpu: boolean): Promise<Upscaled> => {
      if (current.current) throw new Error('Already upscaling a photo')
      const job = nextJob.current++
      const isCurrent = () => current.current?.job === job
      // Claim the slot before the first await, so a second call can't slip in.
      const promise = new Promise<Upscaled>((resolve, reject) => {
        current.current = { job, id, resolve, reject }
      })
      setBusy(id)
      setTiles(null)
      try {
        // A copy, so the page keeps its own bitmap; the copy is transferred.
        const image = await createImageBitmap(original)
        if (!isCurrent()) {
          image.close()
          return promise
        }
        const worker = workerRef.current ?? spawn(gpu)
        const copy: Mask = { width: mask.width, height: mask.height, data: new Uint8ClampedArray(mask.data) }
        worker.postMessage({ type: 'run', job, image, mask: copy, colors, gpu } satisfies UpIn, [
          image,
          copy.data.buffer,
        ])
      } catch (err) {
        settle((j) => j.reject(err instanceof Error ? err : new Error(String(err))))
      }
      return promise
    },
    [spawn, settle],
  )

  const retry = useCallback(() => {
    settle((j) => j.reject(new Error('The upscaler was restarted')))
    workerRef.current?.terminate()
    workerRef.current = null
    loaded.current = false
    setStarted(false)
    setLoadedState(false)
    setFailed(false)
    setFailedFor(null)
    setProgress(0)
  }, [settle])

  useEffect(() => {
    return () => {
      workerRef.current?.terminate()
      workerRef.current = null
      current.current = null
    }
  }, [])

  const state: UpState = failed ? 'error' : !started ? 'idle' : !loadedState ? 'downloading' : busy ? 'running' : 'idle'

  return { state, progress, tiles, busy, failedFor, upscale, retry }
}
