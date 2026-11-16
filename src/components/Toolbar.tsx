import type { Diagnostics } from '../lib/protocol'
import type { Item } from './Queue'
import { CheckIcon, ChevronDownIcon, DownloadIcon, InfoIcon, LockIcon, ShareIcon } from './icons'

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
  diagnostics: Diagnostics | null
  /** This session's GPU couldn't run the model, so the work moved to the processor. */
  fellBack: boolean
  onRetryGpu: () => void
  /** Set when this photo was shrunk to fit the device's working size. */
  scaled?: Item['scaled']
  /** Phones: the button opens the share sheet (Save Image, WhatsApp…) instead of downloading. */
  share: boolean
}

export function Toolbar({
  fill,
  custom,
  onFill,
  onCustom,
  onDownload,
  size,
  diagnostics,
  fellBack,
  onRetryGpu,
  scaled,
  share,
}: Props) {
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
        {scaled && (
          <p className="panel__notice">
            <InfoIcon width={15} height={15} />
            <span>
              Scaled down from{' '}
              <span className="mono">
                {scaled.from.width} × {scaled.from.height}
              </span>{' '}
              so this device doesn't run out of memory.
            </span>
          </p>
        )}
      </div>

      <div className="panel__foot">
        {fellBack && (
          <p className="panel__notice">
            <InfoIcon width={15} height={15} />
            <span>Switched to the slower mode: this device's graphics couldn't run the model.</span>
          </p>
        )}
        <p className="panel__note">
          <LockIcon width={15} height={15} />
          <span>
            Processed on this device{diagnostics?.device === 'wasm' ? ', on the processor, so a little slower' : ''}.
            Nothing is uploaded.
          </span>
        </p>
        {diagnostics && <DeviceDetails d={diagnostics} onRetryGpu={onRetryGpu} />}
      </div>
    </aside>
  )
}

const WHY: Record<Exclude<Diagnostics['reason'], 'gpu'>, string> = {
  'no-webgpu': "This browser doesn't offer graphics acceleration (WebGPU).",
  'no-adapter': 'The browser found no graphics card it can use.',
  limits: '',
  'gpu-failed': "The graphics card couldn't run the model just now.",
  remembered: "The graphics card couldn't run the model on an earlier visit.",
}

/** What this device is doing with the model, and a way back to the GPU when it gave up on it. No image data. */
function DeviceDetails({ d, onRetryGpu }: { d: Diagnostics; onRetryGpu: () => void }) {
  const why =
    d.reason === 'gpu'
      ? null
      : d.reason === 'limits'
        ? `The graphics card allows ${d.gpu?.storageBuffers ?? 'too few'} storage buffers per shader; the model needs 17.`
        : WHY[d.reason]
  const gpuName = d.gpu && (d.gpu.description || [d.gpu.vendor, d.gpu.architecture].filter(Boolean).join(' '))
  const canRetry = d.device === 'wasm' && (d.reason === 'gpu-failed' || d.reason === 'remembered')
  return (
    <details className="device">
      <summary className="device__summary">
        About this device
        <ChevronDownIcon width={14} height={14} className="device__chevron" />
      </summary>
      <div className="device__body">
        <dl className="device__facts">
          <div>
            <dt>Running on</dt>
            <dd>
              {d.device === 'webgpu' ? 'Graphics card (WebGPU)' : 'Processor (WebAssembly)'}
              {why && <span className="device__why">{why}</span>}
            </dd>
          </div>
          {d.gpu && (
            <div>
              <dt>Graphics</dt>
              <dd>{gpuName || 'Not named by the browser'}</dd>
            </div>
          )}
          <div>
            <dt>Model</dt>
            <dd>
              {d.model.split('/').pop()} ·{' '}
              <span className="mono nowrap">
                {d.size} px, {d.dtype}
              </span>
            </dd>
          </div>
        </dl>
        {canRetry && (
          <button type="button" className="button button--quiet" onClick={onRetryGpu}>
            Try the graphics card again
          </button>
        )}
      </div>
    </details>
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
