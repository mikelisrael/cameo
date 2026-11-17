import type { ProgressInfo } from '@huggingface/transformers'

/** Files smaller than this are configs, not weights; they would only skew the percentage. */
const WEIGHTS_MIN_BYTES = 1_000_000

/** A download percentage that only rises. transformers.js's own `progress_total` sums just the files that have
 * started, so a small config reaches 100% and the bar drops back to 0 when the big .onnx begins. And on a cached
 * visit it sends no progress at all, so the bar would sit at 0 while the model starts. This counts the weight
 * files only, and treats a cached `.onnx` (a `done` with no progress before it) as complete.
 * One tracker per load: make a new one for each attempt. */
export function makeDownloadProgress(post: (pct: number) => void): (info: ProgressInfo) => void {
  const files = new Map<string, { loaded: number; total: number }>()
  let last = -1

  const send = (pct: number) => {
    const next = Math.min(100, pct)
    if (next <= last) return
    last = next
    post(next)
  }

  return (info) => {
    if (info.status === 'progress') {
      if (!(info.total >= WEIGHTS_MIN_BYTES)) return
      files.set(info.file, { loaded: info.loaded, total: info.total })
      let loaded = 0
      let total = 0
      for (const f of files.values()) {
        loaded += f.loaded
        total += f.total
      }
      send((loaded / total) * 100)
    } else if (info.status === 'done' && info.file.endsWith('.onnx') && !files.has(info.file)) {
      for (const f of files.values()) if (f.loaded < f.total) return
      send(100)
    }
  }
}
