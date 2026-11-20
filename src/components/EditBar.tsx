import type { ReactNode } from 'react'
import type { InpaintStatus } from '../lib/useInpainter'
import type { SegState } from '../lib/useSegmenter'
import type { BrushSettings, Tool } from './Editor'
import { BrushIcon, CleanIcon, EraserIcon, HandIcon, InfoIcon, RedoIcon, TapIcon, UndoIcon } from './icons'
import { Segmented } from './Segmented'

type View = 'compare' | 'edit'
type Pick = 'keep' | 'remove'

type Props = {
  view: View
  onView: (view: View) => void
  tool: Tool
  onTool: (tool: Tool) => void
  brush: BrushSettings
  onBrush: (brush: BrushSettings) => void
  pick: Pick
  onPick: (pick: Pick) => void
  segState: SegState
  segProgress: number
  onSegRetry: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  canReset: boolean
  onReset: () => void
  /** `upscaling`: an upscale is replacing this photo, so it is locked until it lands. */
  clean: {
    status: InpaintStatus
    progress: number
    known: boolean
    filling: boolean
    failed: boolean
    upscaling: boolean
  }
  onCleanRetry: () => void
}

const VIEWS: { value: View; label: string }[] = [
  { value: 'compare', label: 'Compare' },
  { value: 'edit', label: 'Edit' },
]

const TOOLS: { value: Tool; label: string; icon: ReactNode }[] = [
  { value: 'move', label: 'Move', icon: <HandIcon /> },
  { value: 'select', label: 'Select', icon: <TapIcon /> },
  { value: 'erase', label: 'Erase', icon: <EraserIcon /> },
  { value: 'restore', label: 'Restore', icon: <BrushIcon /> },
  { value: 'clean', label: 'Clean up', icon: <CleanIcon /> },
]

const PICKS: { value: Pick; label: string }[] = [
  { value: 'keep', label: 'Keep' },
  { value: 'remove', label: 'Remove' },
]

export function EditBar({
  view,
  onView,
  tool,
  onTool,
  brush,
  onBrush,
  pick,
  onPick,
  segState,
  segProgress,
  onSegRetry,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  canReset,
  onReset,
  clean,
  onCleanRetry,
}: Props) {
  const edit = view === 'edit'
  const moving = tool === 'move'
  const busy = clean.filling || clean.upscaling
  const cleanState =
    clean.status === 'error'
      ? 'error'
      : clean.status === 'loading'
        ? 'downloading'
        : clean.filling || clean.failed
          ? clean.filling
            ? 'filling'
            : 'error'
          : 'ready'
  const sizeSlider = (
    <label className="editbar__slider">
      <span>Size</span>
      <input
        type="range"
        min={4}
        max={200}
        step={1}
        value={brush.size}
        disabled={moving}
        onChange={(e) => onBrush({ ...brush, size: Number(e.target.value) })}
      />
      <output className="editbar__val">{brush.size}</output>
    </label>
  )
  return (
    <div className="editbar" role="toolbar" aria-label="Edit the cut-out">
      <div className="editbar__row">
        <Segmented className="seg" label="View" options={VIEWS} value={view} onChange={onView} />
        <div className="editbar__history">
          <button
            type="button"
            className="button button--quiet button--icon"
            aria-label="Undo"
            disabled={!canUndo || busy}
            onClick={onUndo}
          >
            <UndoIcon />
          </button>
          <button
            type="button"
            className="button button--quiet button--icon"
            aria-label="Redo"
            disabled={!canRedo || busy}
            onClick={onRedo}
          >
            <RedoIcon />
          </button>
          <button
            type="button"
            className="button button--ghost editbar__reset"
            disabled={!canReset || busy}
            onClick={onReset}
            aria-label="Reset edits"
          >
            Reset<span className="editbar__more"> edits</span>
          </button>
        </div>
      </div>
      {edit && (
        <div className="editbar__row editbar__row--tools">
          <Segmented className="seg seg--tools" label="Tool" options={TOOLS} value={tool} onChange={onTool} />
          {tool === 'select' ? (
            <>
              <Segmented className="seg seg--pick" label="Select mode" options={PICKS} value={pick} onChange={onPick} />
              <p className="editbar__note" data-state={segState} aria-live="polite">
                {segState === 'downloading' ? (
                  <>
                    Getting Select ready… <span className="mono">{Math.round(segProgress * 100)}%</span>
                  </>
                ) : segState === 'ready' ? (
                  pick === 'keep' ? (
                    'Tap a part of the photo to keep it.'
                  ) : (
                    'Tap something to remove it.'
                  )
                ) : segState === 'error' ? (
                  <>
                    Select couldn't start.{' '}
                    <button type="button" className="button button--quiet button--sm" onClick={onSegRetry}>
                      Try again
                    </button>
                  </>
                ) : (
                  'Reading the photo…'
                )}
              </p>
            </>
          ) : tool === 'clean' ? (
            <>
              {sizeSlider}
              <p
                className="editbar__note"
                data-state={clean.upscaling && cleanState === 'ready' ? 'waiting' : cleanState}
                aria-live="polite"
              >
                {clean.status === 'error' ? (
                  <>
                    Clean up couldn't start.{' '}
                    <button type="button" className="button button--quiet button--sm" onClick={onCleanRetry}>
                      Try again
                    </button>
                  </>
                ) : clean.status === 'loading' ? (
                  <>
                    Getting Clean up ready… <span className="mono">{Math.round(clean.progress)}%</span>
                  </>
                ) : clean.filling ? (
                  'Filling in…'
                ) : clean.upscaling ? (
                  <>
                    <InfoIcon width={15} height={15} />
                    Waiting for the upscale to finish
                  </>
                ) : clean.failed ? (
                  "That didn't work. Brush over it again."
                ) : clean.known ? (
                  'Brush over something to remove it.'
                ) : (
                  'Brush over something to remove it. The first time, this downloads 28 MB.'
                )}
              </p>
            </>
          ) : (
            <>
              <label className="switch" data-disabled={moving || undefined}>
                <input
                  type="checkbox"
                  role="switch"
                  checked={brush.smart}
                  disabled={moving}
                  onChange={(e) => onBrush({ ...brush, smart: e.target.checked })}
                />
                <span className="switch__track" aria-hidden="true" />
                Smart edges
              </label>
              {sizeSlider}
              <label className="editbar__slider">
                <span>Softness</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(brush.softness * 100)}
                  disabled={moving}
                  onChange={(e) => onBrush({ ...brush, softness: Number(e.target.value) / 100 })}
                />
                <output className="editbar__val">{Math.round(brush.softness * 100)}%</output>
              </label>
            </>
          )}
        </div>
      )}
    </div>
  )
}
