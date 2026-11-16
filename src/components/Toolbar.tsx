import { CheckIcon, DownloadIcon, LockIcon, ShareIcon } from './icons'

/** Backgrounds offered for the cut-out; `null` is transparent. These are content, not chrome. */
const PRESETS: { label: string; value: string | null }[] = [
  { label: 'Transparent', value: null },
  { label: 'White', value: '#ffffff' },
  { label: 'Black', value: '#000000' },
  { label: 'Cream', value: '#f1ebe1' },
  { label: 'Mist', value: '#dde6ee' },
  { label: 'Blush', value: '#f5d6cb' },
]

type Props = {
  fill: string | null
  custom: string
  onFill: (fill: string | null) => void
  onCustom: (hex: string) => void
  onDownload: () => void
  size: { width: number; height: number } | null
  device: 'webgpu' | 'wasm' | null
  /** Phones: the button opens the share sheet (Save Image, WhatsApp…) instead of downloading. */
  share: boolean
}

export function Toolbar({ fill, custom, onFill, onCustom, onDownload, size, device, share }: Props) {
  const isPreset = PRESETS.some((p) => p.value === fill)
  return (
    <aside className="panel">
      <div className="panel__group">
        <h2 className="panel__title" id="bg-label">
          Background
        </h2>
        {/* Native radios: one Tab stop, arrow keys move the choice. */}
        <div className="swatches" role="radiogroup" aria-labelledby="bg-label">
          {PRESETS.map((p) => {
            const on = fill === p.value
            return (
              <label
                key={p.label}
                className={`swatch${p.value === null ? ' swatch--clear' : ''}`}
                style={p.value ? { background: p.value } : undefined}
              >
                <input
                  type="radio"
                  name="background"
                  className="swatch__radio"
                  checked={on}
                  aria-label={p.label}
                  onChange={() => onFill(p.value)}
                />
                {on && <CheckIcon className="swatch__tick" data-dark={isDark(p.value) || undefined} />}
              </label>
            )
          })}
          {/* Custom: a radio (keyboard picks it with the arrows) under a colour input that pointers hit. */}
          <div className="swatch swatch--custom" style={!isPreset && fill ? { background: fill } : undefined}>
            <input
              type="radio"
              name="background"
              className="swatch__radio"
              checked={!isPreset}
              aria-label="Custom colour"
              onChange={() => onFill(custom)}
            />
            <input
              type="color"
              className="swatch__picker"
              value={custom}
              aria-label="Choose custom colour"
              onChange={(e) => {
                onCustom(e.target.value)
                onFill(e.target.value)
              }}
              onClick={() => onFill(custom)}
            />
            {!isPreset && <CheckIcon className="swatch__tick" data-dark={isDark(fill) || undefined} />}
          </div>
        </div>
      </div>

      <div className="panel__group">
        {/* On phones this becomes a bar pinned to the bottom of the screen, in thumb reach. */}
        <div className="panel__save">
          <button type="button" className="button button--primary button--block" onClick={onDownload}>
            {share ? <ShareIcon /> : <DownloadIcon />}
            {share ? 'Save or share' : 'Download PNG'}
          </button>
        </div>
        {size && (
          <p className="panel__meta">
            <span className="mono">
              {size.width} × {size.height}
            </span>{' '}
            px · {fill ? 'solid background' : 'transparent'}
          </p>
        )}
      </div>

      <p className="panel__note">
        <LockIcon width={15} height={15} />
        <span>
          Processed on this device{device === 'wasm' ? ' (no graphics acceleration, so a little slower)' : ''}. Nothing
          is uploaded.
        </span>
      </p>
    </aside>
  )
}

function isDark(hex: string | null) {
  if (!hex) return false
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b < 140
}
