import { useEffect, useRef, type ReactNode } from 'react'
import { XIcon } from './icons'

type Props = { open: boolean; onClose: () => void; isMac: boolean }

/** The keyboard cheat sheet: a native modal dialog, so focus stays inside and Esc closes it. */
export function Shortcuts({ open, onClose, isMac }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const mod = isMac ? '⌘' : 'Ctrl'

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="shortcuts"
      aria-labelledby="shortcuts-title"
      onClose={onClose}
      // A press on the backdrop (outside the sheet) closes it.
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="shortcuts__sheet">
        <div className="shortcuts__head">
          <h2 id="shortcuts-title" className="shortcuts__title">
            Keyboard shortcuts
          </h2>
          <button type="button" className="button button--ghost button--icon" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>

        <Group title="Anywhere">
          <Row label="Show these shortcuts" keys={['?']} />
          <Row label="Add images from the clipboard" keys={[mod, 'V']} />
          <Row label="Download" keys={[mod, 'S']} />
          <Row label="Undo" keys={[mod, 'Z']} />
          <Row label="Redo" keys={[mod, '⇧', 'Z']} />
          <Row label="Previous or next image" keys={['←', '→']} or />
        </Group>

        <Group title="Compare">
          <Row label="Open Edit" keys={['E']} />
        </Group>

        <Group title="Edit">
          <Row label="Back to Compare" keys={['Esc']} />
          <Row label="Erase" keys={['E']} />
          <Row label="Restore" keys={['R']} />
          <Row label="Select an object" keys={['S']} />
          <Row label="Clean up" keys={['C']} />
          <Row label="Move" keys={['V']} />
          <Row label="Smaller or bigger brush" keys={['[', ']']} or />
          <Row label="Zoom in or out" keys={['+', '−']} or />
          <Row label="Fit to screen" keys={['0']} />
          <Row label="Hold to see the original" keys={['Space']} />
        </Group>
      </div>
    </dialog>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="shortcuts__group">
      <h3 className="shortcuts__group-title">{title}</h3>
      <dl className="shortcuts__list">{children}</dl>
    </section>
  )
}

/** One row: what it does on the left, the keys on the right (pressed together, or either with `or`). */
function Row({ label, keys, or = false }: { label: string; keys: string[]; or?: boolean }) {
  return (
    <div className="shortcuts__row">
      <dt>{label}</dt>
      <dd>
        {keys.map((k, i) => (
          <span key={k} className="shortcuts__key">
            {i > 0 && or && <span className="shortcuts__or">or</span>}
            <kbd>{k}</kbd>
          </span>
        ))}
      </dd>
    </div>
  )
}
