import { AlertIcon, PlusIcon, Spinner, XIcon } from './icons'

export type Item = {
  id: string
  name: string
  state: 'queued' | 'processing' | 'done' | 'error'
  thumb: string
  /** The rough cut-out, shown instead of the photo while the sharp one is made. */
  draft?: string
  error?: string
  scaled?: { from: { width: number; height: number }; to: { width: number; height: number } }
}

type Props = {
  items: Item[]
  selected: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onAdd: () => void
}

const stateLabel: Record<Item['state'], string> = {
  queued: 'waiting',
  processing: 'removing background',
  done: 'ready',
  error: 'failed',
}

export function Queue({ items, selected, onSelect, onRemove, onAdd }: Props) {
  return (
    <ul className="queue" aria-label="Your images">
      {items.map((it) => (
        <li key={it.id} className="queue__cell">
          <button
            type="button"
            className="queue__item"
            data-state={it.state}
            aria-current={it.id === selected || undefined}
            aria-label={`${it.name}, ${stateLabel[it.state]}`}
            disabled={it.state === 'queued' || it.state === 'processing'}
            onClick={() => onSelect(it.id)}
          >
            <img
              src={(it.state === 'processing' && it.draft) || it.thumb}
              alt=""
              className="queue__thumb"
              draggable={false}
            />
            {it.state === 'processing' && (
              <span className="queue__overlay">
                <Spinner />
              </span>
            )}
            {it.state === 'error' && (
              <span className="queue__badge">
                <AlertIcon width={14} height={14} />
              </span>
            )}
          </button>
          <button
            type="button"
            className="queue__remove"
            aria-label={`Remove ${it.name}`}
            onClick={() => onRemove(it.id)}
          >
            <XIcon width={12} height={12} strokeWidth={2.4} />
          </button>
        </li>
      ))}
      <li>
        <button type="button" className="queue__add" aria-label="Add images" onClick={onAdd}>
          <PlusIcon />
        </button>
      </li>
    </ul>
  )
}
