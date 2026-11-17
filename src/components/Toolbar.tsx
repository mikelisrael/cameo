import {
  BLUR,
  GRADIENTS,
  cssBackground,
  gradientFill,
  gradientOf,
  isColor,
  isImage,
  type GradientName,
} from '../lib/background'
import type { Format, Frame, Shadow } from '../lib/compose'
import type { Diagnostics } from '../lib/protocol'
import type { Item } from './Queue'
import { CheckIcon, ChevronDownIcon, PlusIcon, DownloadIcon, InfoIcon, LockIcon, ShareIcon, Spinner } from './icons'
import { Segmented } from './Segmented'

const LABEL: Record<Format, string> = { png: 'PNG', webp: 'WebP', jpg: 'JPG' }

const SIZES: { value: Frame; label: string }[] = [
  { value: 'photo', label: 'Whole' },
  { value: 'subject', label: 'Fit' },
  { value: 'square', label: '1:1' },
  { value: 'portrait', label: '4:5' },
  { value: 'story', label: '9:16' },
]

const SHADOWS: { value: Shadow['kind']; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'contact', label: 'Contact' },
  { value: 'drop', label: 'Drop' },
]

const FRAME_NOTE: Record<Frame, string> = {
  photo: 'The whole photo',
  subject: 'Fitted to the subject',
  square: 'Square, for shops and marketplaces',
  portrait: 'Instagram post',
  story: 'Story or WhatsApp status',
}

/** Backgrounds offered for the cut-out; `null` is transparent. These are content, not chrome. */
const PRESETS: { label: string; value: string | null }[] = [
  { label: 'Transparent', value: null },
  { label: 'White', value: '#ffffff' },
  { label: 'Black', value: '#000000' },
  { label: 'Cream', value: '#f1ebe1' },
  { label: 'Mist', value: '#dde6ee' },
  { label: 'Blush', value: '#f5d6cb' },
]

/** Photo-based and gradient backgrounds, drawn from the lib so the swatch matches the result. */
const SCENES: { label: string; value: string }[] = [
  { label: 'Blurred photo', value: BLUR },
  ...(Object.keys(GRADIENTS) as GradientName[]).map((n) => ({ label: GRADIENTS[n].label, value: gradientFill(n) })),
]

type Props = {
  fill: string | null
  /** Object URL of the selected photo's blurred copy, and of each picked picture by fill id. */
  blurUrl: string | null
  imageUrls: Map<string, string>
  /** The picture picked most recently (its fill id), if any. */
  lastImage: string | null
  /** Opens the file picker for a background picture. */
  onPickImage: () => void
  custom: string
  onFill: (fill: string | null) => void
  onCustom: (hex: string) => void
  onDownload: () => void
  frame: Frame
  onFrame: (frame: Frame) => void
  shadow: Shadow
  onShadow: (shadow: Shadow) => void
  /** Object URL of the framed image when it is ready; null while it renders. */
  preview: string | null
  /** Pixel size of what will be downloaded; null while a framed size is still rendering. */
  outSize: { width: number; height: number } | null
  diagnostics: Diagnostics | null
  /** This session's GPU couldn't run the model, so the work moved to the processor. */
  fellBack: boolean
  onRetryGpu: () => void
  /** Set when this photo was shrunk to fit the device's working size. */
  scaled?: Item['scaled']
  /** Phones: the button opens the share sheet (Save Image, WhatsApp…) instead of downloading. */
  share: boolean
  format: Format
  onFormat: (format: Format) => void
  /** This browser can encode WebP. */
  webp: boolean
  /** Finished cut-outs in the queue; "Download all" appears from two. */
  doneCount: number
  onDownloadAll: () => void
  zipping: boolean
}

export function Toolbar({
  fill,
  blurUrl,
  imageUrls,
  lastImage,
  onPickImage,
  custom,
  onFill,
  onCustom,
  onDownload,
  frame,
  onFrame,
  shadow,
  onShadow,
  preview,
  outSize,
  diagnostics,
  fellBack,
  onRetryGpu,
  scaled,
  share,
  format,
  onFormat,
  webp,
  doneCount,
  onDownloadAll,
  zipping,
}: Props) {
  // Anything that isn't a hex colour outside the presets is a preset-like choice, not the custom colour.
  const isPreset = PRESETS.some((p) => p.value === fill) || (!!fill && !isColor(fill)) || fill === null
  const shownImage = fill && isImage(fill) ? fill : lastImage
  const imageUrl = shownImage ? imageUrls.get(shownImage) : undefined
  const imageOn = isImage(fill)
  const formats = (['png', ...(webp ? ['webp'] : []), 'jpg'] as Format[]).map((f) => ({ value: f, label: LABEL[f] }))
  const activateImage = () => {
    if (!imageOn && lastImage) onFill(lastImage)
    else onPickImage()
  }
  const gradient = gradientOf(fill ?? '')
  const backgroundNote = !fill
    ? format === 'jpg'
      ? 'White background'
      : 'Transparent background'
    : fill === BLUR
      ? 'Blurred photo behind'
      : isImage(fill)
        ? 'Your image behind'
        : gradient
          ? `${gradient.label} gradient`
          : 'Solid background'
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
          {SCENES.map((p) => {
            const on = fill === p.value
            return (
              <label key={p.label} className="swatch" style={cssBackground(p.value, { blurUrl })}>
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
          {/* Image: picks a picture; tapping it again while selected replaces the picture. */}
          <label
            className="swatch swatch--image"
            style={imageUrl ? cssBackground(shownImage, { imageUrls }) : undefined}
          >
            <input
              type="radio"
              name="background"
              className="swatch__radio"
              checked={imageOn}
              aria-label="Your image"
              onChange={() => {}}
              onKeyDown={(e) => {
                // Remember a key pressed on this radio itself; arrowing onto it presses nothing here.
                e.currentTarget.dataset.key = e.key
                if (e.key === 'Enter') {
                  e.preventDefault()
                  activateImage()
                }
              }}
              onBlur={(e) => delete e.currentTarget.dataset.key}
              onClick={(e) => {
                const key = e.currentTarget.dataset.key
                delete e.currentTarget.dataset.key
                // Pointer clicks have detail > 0; a keyboard click only counts when Space was pressed here.
                // The click the browser fires when arrows land on this radio does nothing.
                if (e.detail > 0 || key === ' ') activateImage()
              }}
            />
            {imageOn ? (
              <CheckIcon className="swatch__tick" data-dark />
            ) : (
              !imageUrl && <PlusIcon className="swatch__glyph" width={14} height={14} />
            )}
          </label>
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
        <h2 className="panel__title" id="format-label">
          Format
        </h2>
        <Segmented className="seg seg--block" label="Format" options={formats} value={format} onChange={onFormat} />
        {format === 'jpg' && !fill && (
          <p className="panel__notice">
            <InfoIcon width={15} height={15} />
            <span>JPG has no transparency, so it gets a white background.</span>
          </p>
        )}
        <h2 className="panel__title" id="size-label">
          Size
        </h2>
        <Segmented className="seg seg--block" label="Size" options={SIZES} value={frame} onChange={onFrame} />
        <p className="panel__meta">
          {FRAME_NOTE[frame]}
          {outSize && (
            <>
              {' · '}
              <span className="nowrap">
                <span className="mono">
                  {outSize.width} × {outSize.height}
                </span>{' '}
                px
              </span>
            </>
          )}
        </p>
        {frame !== 'photo' && (
          <div className="panel__preview">
            {preview ? <img src={preview} alt="What you'll download" draggable={false} /> : <Spinner />}
          </div>
        )}
        <h2 className="panel__title" id="shadow-label">
          Shadow
        </h2>
        <Segmented
          className="seg seg--block"
          label="Shadow"
          options={SHADOWS}
          value={shadow.kind}
          onChange={(kind) => onShadow({ ...shadow, kind })}
        />
        {shadow.kind !== 'none' && (
          <div className="panel__sliders">
            <label className="editbar__slider">
              <span>Strength</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={Math.round(shadow.strength * 100)}
                onChange={(e) => onShadow({ ...shadow, strength: Number(e.target.value) / 100 })}
              />
              <output className="editbar__val">{Math.round(shadow.strength * 100)} %</output>
            </label>
            {shadow.kind === 'drop' && (
              <label className="editbar__slider">
                <span>Angle</span>
                <input
                  type="range"
                  min={-90}
                  max={90}
                  step={5}
                  value={shadow.angle}
                  onChange={(e) => onShadow({ ...shadow, angle: Number(e.target.value) })}
                />
                <output className="editbar__val">{shadow.angle}°</output>
              </label>
            )}
          </div>
        )}
        {/* On phones this becomes a bar pinned to the bottom of the screen, in thumb reach. */}
        <div className="panel__save">
          <button type="button" className="button button--primary button--block" onClick={onDownload}>
            {share ? <ShareIcon /> : <DownloadIcon />}
            {share ? 'Save or share' : `Download ${LABEL[format]}`}
          </button>
        </div>
        {doneCount >= 2 && (
          <button
            type="button"
            className="button button--quiet button--block"
            onClick={onDownloadAll}
            disabled={zipping}
          >
            <DownloadIcon />
            <span>
              Download all (<span className="mono">{doneCount}</span>) as ZIP
            </span>
            {zipping && <Spinner />}
          </button>
        )}
        {/* The size sits under Size, so this line keeps only the background wording. */}
        <p className="panel__meta">{backgroundNote}</p>
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
              {d.device === 'webgpu'
                ? 'Graphics card (WebGPU)'
                : `Processor (WebAssembly), ${d.threads} ${d.threads === 1 ? 'thread' : 'threads'}`}
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

function isDark(value: string | null) {
  if (!value) return false
  // A photo (blurred or picked) can be any tone: the light tick reads on most.
  if (value === BLUR || isImage(value)) return true
  const grad = gradientOf(value)
  const hex = grad ? grad.to : value
  if (!isColor(hex)) return false
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b < 140
}
