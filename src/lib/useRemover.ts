import { useCallback, useEffect, useRef, useState } from 'react'
import { decodeImage, type Decoded } from './decode'
import type { Diagnostics, DraftIn, DraftOut, Mask, RefineOptions, Timings, WorkerIn, WorkerOut } from './protocol'

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

/** The first-look model's input size: the photo is shrunk to this before it reaches that worker. */
const DRAFT_SIZE = 320

/** With the sharp model already running, it waits this long (at most) for the first look, so the two don't
 * fight over the processor: on a busy CPU the small model would take several times longer. */
const DRAFT_HEAD_START_MS = 2500

/** A photo waiting for its turn. `decode` is set once its page-side decode has started early. */
type Job = { file: File; isCancelled?: () => boolean; decode?: Promise<Decoded> }

/** Frees a skipped job's early decode, if it has one: its bitmap and URL. */
async function discard(job: Job) {
  if (!job.decode) return
  try {
    const early = await job.decode
    early.bitmap.close()
    URL.revokeObjectURL(early.url)
  } catch {
    // it failed, so there is nothing to free
  }
}

type Pending = { resolve: (r: Result) => void; reject: (e: Error) => void; decoded: Decoded; opts?: ProcessOpts }

export function useRemover() {
  const workerRef = useRef<Worker | null>(null)
  const pending = useRef(new Map<string, Pending>())
  const active = useRef(0)
  const loaded = useRef(false)
  const failed = useRef(false) // the model couldn't load: photos wait here until Try again
  const lastLoad = useRef<{ forceWasm: boolean; reason?: 'gpu-failed' | 'remembered' }>({ forceWasm: false })
  const [retrying, setRetrying] = useState<{ attempt: number; of: number } | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [device, setDevice] = useState<'webgpu' | 'wasm' | null>(null)
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null)
  const [timings, setTimings] = useState<Timings | null>(null)
  const [startupMs, setStartupMs] = useState<number | null>(null) // page open to first ready; kept across workers
  const [fellBack, setFellBack] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const queued = useRef<Job[]>([])
  const inWorker = useRef(false) // the current photo has reached the worker, so the next one may decode early
  const draftWorker = useRef<Worker | null>(null)
  const draftBroken = useRef(false) // the draft worker's script failed: the sharp path goes on without it
  const draftWaiting = useRef(new Map<string, { done: (mask: Mask) => void; settle: () => void }>())
  const [draftMs, setDraftMs] = useState<number | null>(null)

  /** The first-look worker, started on first use. Every failure here is silent: the sharp cut-out still comes. */
  const getDraftWorker = useCallback(() => {
    if (draftWorker.current) return draftWorker.current
    if (draftBroken.current) return null
    let worker: Worker
    try {
      worker = new Worker(new URL('../worker/draft.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      draftBroken.current = true
      return null
    }
    draftWorker.current = worker
    worker.onmessage = (e: MessageEvent<DraftOut>) => {
      if (draftWorker.current !== worker) return
      const m = e.data
      const waiting = m.id ? draftWaiting.current.get(m.id) : undefined
      if (m.type !== 'draft') return waiting?.settle() // an error: that photo just has no first look
      draftWaiting.current.delete(m.id)
      if (!waiting) return // the sharp result got there first, or the photo is gone
      setDraftMs(m.ms)
      waiting.done(m.mask)
      waiting.settle()
    }
    const crashed = (e: Event) => {
      e.preventDefault()
      if (draftWorker.current !== worker) return
      draftBroken.current = true
      draftWorker.current = null
      for (const w of draftWaiting.current.values()) w.settle()
      draftWaiting.current.clear()
      worker.terminate()
    }
    worker.onerror = crashed
    worker.onmessageerror = crashed
    return worker
  }, [])

  /** Sends a 320 px copy of the photo, so the draft worker never sees the full-size bitmap. */
  const postDraft = useCallback(
    async (id: string, bitmap: ImageBitmap) => {
      try {
        const worker = getDraftWorker()
        if (!worker) return draftWaiting.current.get(id)?.settle()
        const small = await createImageBitmap(bitmap, {
          resizeWidth: DRAFT_SIZE,
          resizeHeight: DRAFT_SIZE,
          resizeQuality: 'medium',
        })
        if (!draftWaiting.current.has(id) || draftWorker.current !== worker) return small.close()
        worker.postMessage({ type: 'draft', id, image: small } satisfies DraftIn, [small])
      } catch {
        draftWaiting.current.get(id)?.settle() // no first look for this photo
      }
    },
    [getDraftWorker],
  )

  /** Replaces the worker with a fresh one (a new ONNX Runtime) and hands it every image still waiting. */
  const spawn = useCallback(function spawn(forceWasm: boolean, reason?: 'gpu-failed' | 'remembered') {
    workerRef.current?.terminate()
    const worker = new Worker(new URL('../worker/removeBackground.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker
    const map = pending.current
    loaded.current = false
    failed.current = false
    lastLoad.current = { forceWasm, reason }
    setProgress(0)
    setError(null)
    setRetrying(null)
    setStatus('loading')

    worker.onmessage = (e: MessageEvent<WorkerOut>) => {
      if (workerRef.current !== worker) return // a worker we already replaced
      const m = e.data
      if (m.type === 'progress') {
        setRetrying(null)
        if (m.progress !== undefined) setProgress(Math.min(1, m.progress / 100))
      } else if (m.type === 'retrying') {
        setRetrying({ attempt: m.attempt, of: m.of })
      } else if (m.type === 'ready') {
        loaded.current = true
        setRetrying(null)
        setDevice(m.device)
        setDiagnostics(m.diagnostics)
        setStartupMs((ms) => ms ?? Math.round(performance.now()))
        setProgress(1)
        setStatus(active.current > 0 ? 'processing' : 'ready')
      } else if (m.type === 'result') {
        const p = map.get(m.id)
        map.delete(m.id)
        setTimings(m.timings)
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
          failed.current = true
          setRetrying(null)
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
      failed.current = true
      setRetrying(null)
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
      draftWorker.current?.terminate()
      draftWorker.current = null
      draftWaiting.current.clear()
    }
  }, [spawn])

  /** Forget that the GPU failed and start over on it. */
  const retryGpu = useCallback(() => {
    setForceWasm(false)
    setFellBack(false)
    spawn(false)
  }, [spawn])

  /** Try again after the model couldn't load: a fresh worker, no page reload. Photos already dropped stay on
   * screen and are handed to it (see spawn). */
  const retryLoad = useCallback(() => {
    spawn(lastLoad.current.forceWasm, lastLoad.current.reason)
  }, [spawn])

  /** Decode the next photo while the current one is in the worker. Only one ahead: a decoded photo can be
   * ~96 MB, so the queue never holds more than one. */
  const decodeAhead = useCallback(() => {
    if (queued.current.some((j) => j.decode)) return
    const job = queued.current.find((j) => !j.isCancelled?.())
    if (!job) return
    job.decode = decodeImage(job.file)
    // An early failure isn't unhandled here; the job's own await still rejects at its turn.
    job.decode.catch(() => {})
  }, [])

  const run = useCallback(
    async (
      job: Job,
      onStart?: () => void,
      onDecoded?: (d: Decoded) => void,
      opts?: ProcessOpts,
      onDraft?: (mask: Mask) => void,
    ): Promise<Result> => {
      const { file, isCancelled } = job
      queued.current = queued.current.filter((j) => j !== job)
      if (isCancelled?.()) {
        // Skipped, but an early decode may already be done: free its bitmap and URL.
        await discard(job)
        throw new Error('Cancelled')
      }
      if (!workerRef.current) {
        await discard(job)
        throw new Error('Worker not available')
      }
      onStart?.()
      const decoded = await (job.decode ?? decodeImage(file))
      onDecoded?.(decoded)
      inWorker.current = true // photos dropped from now on are decoded ahead by process
      decodeAhead() // the current photo is about to go to the worker
      const id = crypto.randomUUID()
      active.current++
      setStatus((s) => (s === 'error' ? s : loaded.current ? 'processing' : 'loading'))
      try {
        return await new Promise<Result>((resolve, reject) => {
          pending.current.set(id, { resolve, reject, decoded, opts })
          // The worker gets a copy, so it never decodes the file and never owns our display bitmap.
          const worker = workerRef.current
          if (!worker) return reject(new Error('Worker not available'))
          // The rough mask comes back long before the sharp one, even while the big model is still downloading.
          let headStart: Promise<void> | undefined
          if (onDraft) {
            const first = new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, DRAFT_HEAD_START_MS)
              draftWaiting.current.set(id, {
                done: onDraft,
                settle: () => {
                  clearTimeout(timer)
                  resolve()
                },
              })
            })
            void postDraft(id, decoded.bitmap)
            if (loaded.current) headStart = first
          }
          void (headStart ?? Promise.resolve())
            .then(() => {
              // A worker started meanwhile was already handed this image (see spawn).
              if (workerRef.current !== worker || !pending.current.has(id)) return
              if (failed.current) return // the model isn't loading: Try again hands it this image
              return postCopy(worker, id, decoded.bitmap, opts)
            })
            .catch((err: Error) => {
              pending.current.delete(id)
              reject(err)
            })
        })
      } catch (e) {
        decoded.bitmap.close()
        throw e
      } finally {
        inWorker.current = false
        draftWaiting.current.delete(id) // a draft arriving after this is dropped
        active.current--
        setStatus((s) => (s === 'error' ? s : active.current > 0 ? 'processing' : loaded.current ? 'ready' : 'loading'))
      }
    },
    [postDraft, decodeAhead],
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
      onDraft?: (mask: Mask) => void,
    ): Promise<Result> => {
      const job: Job = { file, isCancelled }
      queued.current.push(job)
      if (inWorker.current) decodeAhead() // dropped while another photo is in the worker: decode it now
      const next = chain.current.then(() => run(job, onStart, onDecoded, opts, onDraft))
      chain.current = next.catch(() => undefined)
      return next
    },
    [run, decodeAhead],
  )

  return {
    status,
    progress,
    device,
    diagnostics,
    timings,
    startupMs,
    draftMs,
    fellBack,
    error,
    retrying,
    process,
    retryGpu,
    retryLoad,
  }
}
