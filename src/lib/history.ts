import type { MaskPatch } from './maskPatch'
import type { Mask } from './protocol'
import type { Result } from './useRemover'

/** A photo's result and its edited mask at one moment: what an upscale swaps between. */
export type Snap = { result: Result; edited?: Mask }

export type Step =
  | { kind: 'mask'; patch: MaskPatch }
  | { kind: 'fill'; from: string | null; to: string | null }
  | { kind: 'reset'; before: Uint8ClampedArray; after: Uint8ClampedArray }
  | { kind: 'upscale'; before: Snap; after: Snap }

/** `bytes` counts every step held (done and undone); `trimmed` is set once an old step was dropped for the cap. */
export type History = { done: Step[]; undone: Step[]; bytes: number; trimmed?: boolean }

export const MAX_STEPS = 60
export const MAX_BYTES = 150_000_000

export const newHistory = (): History => ({ done: [], undone: [], bytes: 0 })

const snapWeight = ({ result: r, edited }: Snap) =>
  r.mask.data.byteLength +
  (r.colors?.byteLength ?? 0) +
  r.original.width * r.original.height * 4 +
  (edited?.data.byteLength ?? 0)

const weight = (s: Step) =>
  s.kind === 'mask'
    ? s.patch.before.byteLength + s.patch.after.byteLength
    : s.kind === 'reset'
      ? s.before.byteLength + s.after.byteLength
      : s.kind === 'upscale'
        ? snapWeight(s.before) + snapWeight(s.after)
        : 0

/**
 * Records a step, drops the redo list, and trims the oldest steps past the caps. `drop` hears each step
 * that is let go, so a step holding bitmaps can release them.
 */
export function push(h: History, step: Step, drop?: (s: Step, side: 'undone' | 'trimmed') => void) {
  for (const s of h.undone) {
    h.bytes -= weight(s)
    drop?.(s, 'undone')
  }
  h.undone = []
  h.done.push(step)
  h.bytes += weight(step)
  while (h.done.length > 1 && (h.done.length > MAX_STEPS || h.bytes > MAX_BYTES)) {
    const s = h.done.shift()!
    h.bytes -= weight(s)
    drop?.(s, 'trimmed')
    h.trimmed = true
  }
}

/** Moves the last done step to the redo list and returns it. */
export function undo(h: History): Step | undefined {
  const s = h.done.pop()
  if (s) h.undone.push(s)
  return s
}

/** Moves the last undone step back to the done list and returns it. */
export function redo(h: History): Step | undefined {
  const s = h.undone.pop()
  if (s) h.done.push(s)
  return s
}

/** Whether the mask differs from the model's: the last mask or reset step decides. */
export function isDirty(h: History): boolean {
  for (let i = h.done.length - 1; i >= 0; i--) {
    const k = h.done[i].kind
    if (k === 'mask') return true
    if (k === 'reset') return false
  }
  return !!h.trimmed
}
