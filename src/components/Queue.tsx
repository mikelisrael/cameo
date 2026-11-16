export type Item = {
  id: string
  name: string
  state: 'queued' | 'processing' | 'done' | 'error'
  thumb: string
  error?: string
}

type Props = {
  items: Item[]
  selected: string | null
  onSelect: (id: string) => void
  onDownload: (id: string) => void
}

export function Queue({ items, selected, onSelect, onDownload }: Props) {
  if (!items.length) return null
  return (
    <ul className="queue">
      {items.map((it) => (
        <li key={it.id} className={`queue__item${it.id === selected ? ' queue__item--selected' : ''}`}>
          <button type="button" className="queue__select" onClick={() => onSelect(it.id)} disabled={it.state !== 'done'}>
            <img src={it.thumb} alt="" className="queue__thumb" />
            <span className="queue__name">{it.name}</span>
            <span className="queue__state">{it.state === 'error' ? `Failed: ${it.error}` : it.state}</span>
          </button>
          <button type="button" onClick={() => onDownload(it.id)} disabled={it.state !== 'done'}>
            Download
          </button>
        </li>
      ))}
    </ul>
  )
}
