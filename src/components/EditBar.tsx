import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import type { BrushSettings, Tool } from './Editor'
import { BrushIcon, EraserIcon, HandIcon, RedoIcon, UndoIcon } from './icons'

type View = 'compare' | 'edit'

type Props = {
  view: View
  onView: (view: View) => void
  tool: Tool
  onTool: (tool: Tool) => void
  brush: BrushSettings
  onBrush: (brush: BrushSettings) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  canReset: boolean
  onReset: () => void
}

const VIEWS: { value: View; label: string }[] = [
  { value: 'compare', label: 'Compare' },
  { value: 'edit', label: 'Edit' },
]

const TOOLS: { value: Tool; label: string; icon: ReactNode }[] = [
  { value: 'move', label: 'Move', icon: <HandIcon /> },
  { value: 'erase', label: 'Erase', icon: <EraserIcon /> },
  { value: 'restore', label: 'Restore', icon: <BrushIcon /> },
]

/** A radiogroup of buttons: one Tab stop (the checked one), arrow keys move the choice. */
function Segmented<T extends string>({
  label,
  className,
  options,
  value,
  onChange,
}: {
  label: string
  className: string
  options: { value: T; label: string; icon?: ReactNode }[]
  value: T
  onChange: (value: T) => void
}) {
  const group = useRef<HTMLDivElement>(null)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const i = options.findIndex((o) => o.value === value)
    const next = options[(i + step + options.length) % options.length]
    onChange(next.value)
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[options.indexOf(next)]?.focus()
  }
  return (
    <div ref={group} className={className} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className="seg__btn"
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.icon ? <span>{o.label}</span> : o.label}
        </button>
      ))}
    </div>
  )
}

export function EditBar({
  view,
  onView,
  tool,
  onTool,
  brush,
  onBrush,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  canReset,
  onReset,
}: Props) {
  const edit = view === 'edit'
  const moving = tool === 'move'
  return (
    <div className="editbar" role="toolbar" aria-label="Edit the cut-out">
      <div className="editbar__row">
        <Segmented className="seg" label="View" options={VIEWS} value={view} onChange={onView} />
        <div className="editbar__history">
          <button
            type="button"
            className="button button--quiet button--icon"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={onUndo}
          >
            <UndoIcon />
          </button>
          <button
            type="button"
            className="button button--quiet button--icon"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={onRedo}
          >
            <RedoIcon />
          </button>
          <button
            type="button"
            className="button button--ghost editbar__reset"
            disabled={!canReset}
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
        </div>
      )}
    </div>
  )
}
