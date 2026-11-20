import { useId } from 'react'
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
import type { Format, Frame, Match, PassportIssue, PassportSize, Shadow } from '../lib/compose'
import type { Diagnostics, Timings } from '../lib/protocol'
import { UPSCALE_MB } from '../lib/upscale'
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
  { value: 'passport', label: 'ID' },
]

const PASSPORT_SIZES: { value: PassportSize; label: string }[] = [
  { value: '35x45', label: '35×45 mm' },
  { value: '2x2', label: '2×2 in' },
]

const PASSPORT_PRINT: { value: 'one' | 'sheet'; label: string }[] = [
  { value: 'one', label: 'One photo' },
  { value: 'sheet', label: 'Print sheet' },
]

const PASSPORT_NOTE: Record<PassportIssue, string> = {
  'no-face': 'No face found. Use a photo looking straight at the camera.',
  faces: 'More than one face. Use a photo of one person.',
  'top-cut': 'The top of the head is cut off. Use a photo with room above the head.',
  'shoulders-cut': 'The shoulders are cut off. Use a photo that shows them.',
  tilted: 'The head is tilted. Keep it level for a passport photo.',
  background: 'Passport photos need a plain light background, so this one is on white.',
  small: 'This photo is small, so the print may look soft.',
}

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
  passport: 'Passport or ID photo',
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
  /** The ID size's options and what the photo needs; set only while the ID size is picked. */
  passport?: {
    size: PassportSize
    sheet: boolean
    issues: PassportIssue[]
    /** Crown and chin as fractions of the single photo's height; null when no face is known. */
    guides: { crown: number; chin: number } | null
    sheetCount: number
    finding: boolean
    failed: boolean
  } | null
  onPassportSize: (size: PassportSize) => void
  onPassportSheet: (sheet: boolean) => void
  onPassportRetry: () => void
  shadow: Shadow
  onShadow: (shadow: Shadow) => void
  match: Match
  onMatch: (match: Match) => void
  /** Object URL of the framed image when it is ready; null while it renders. */
  preview: string | null
  /** Pixel size of what will be downloaded; null while a framed size is still rendering. */
  outSize: { width: number; height: number } | null
  diagnostics: Diagnostics | null
  timings: Timings | null
  /** Page open to the model being ready, ms; null until it is. */
  startupMs: number | null
  /** How long the first look took, ms; null when there was none. */
  draftMs: number | null
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
  /** Saves (or on phones shares) the 512 px WhatsApp sticker. */
  onSticker: () => void
  /** Opens the keyboard-shortcuts cheat sheet. */
  onShortcuts: () => void
  /** The 2x upscale offer for the selected photo; null when none is selected. */
  upscale: {
    offer: boolean
    from: { width: number; height: number }
    to: { width: number; height: number }
    state: 'idle' | 'downloading' | 'running' | 'error'
    progress: number
    tiles: { done: number; total: number } | null
    /** Another photo is being upscaled. */
    elsewhere: boolean
    /** A clean-up is changing this photo: it can be upscaled once that lands. */
    cleaning: boolean
    failed: boolean
    upscaledFrom: { width: number; height: number } | null
    canUndo: boolean
  } | null
  onUpscale: () => void
  onUpscaleRetry: () => void
  onUpscaleUndo: () => void
}

function UpscaleBar({ label, value }: { label: string; value: number }) {
  return (
    <span
      className="bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      <span className="bar__fill" style={{ transform: `scaleX(${Math.max(0.02, value)})` }} />
    </span>
  )
}

function UpscaleBlock({
  u,
  onUpscale,
  onRetry,
  onUndo,
}: {
  u: NonNullable<Props['upscale']>
  onUpscale: () => void
  onRetry: () => void
  onUndo: () => void
}) {
  const working = u.state === 'downloading' || u.state === 'running'
  const notice = (text: string, retry?: boolean) => (
    <p className="panel__notice">
      <InfoIcon width={15} height={15} />
      <span>{text}</span>
      {retry && (
        <button type="button" className="button button--quiet button--sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </p>
  )
  if (u.offer && u.failed && !working) return notice("Couldn't upscale this photo.", true)
  return (
    <>
      {u.offer && (
        <>
          <div className="panel__upscale">
            <div className="panel__upscale-text">
              {u.state === 'downloading' ? (
                // A cached model sends no download progress: then it is only starting, not downloading.
                <p>{u.progress > 0 && u.progress < 1 ? 'Setting up · one-time download' : 'Starting the upscaler…'}</p>
              ) : u.state === 'running' ? (
                <p>
                  Upscaling…
                  {u.tiles && (
                    <>
                      {' '}
                      <span className="mono">{u.tiles.done}</span> of <span className="mono">{u.tiles.total}</span>
                    </>
                  )}
                </p>
              ) : (
                <>
                  <p>Make it 2× bigger and sharper.</p>
                  <p className="panel__meta">
                    <span className="mono nowrap">
                      {u.to.width} × {u.to.height}
                    </span>{' '}
                    px ·{' '}
                    <span className="nowrap">
                      one-time <span className="mono">{UPSCALE_MB}</span> MB download
                    </span>
                  </p>
                </>
              )}
            </div>
            <button
              type="button"
              className="button button--quiet button--sm panel__upscale-btn"
              onClick={onUpscale}
              disabled={working || u.elsewhere || u.cleaning}
            >
              Upscale
              {working && <Spinner />}
            </button>
          </div>
          {u.state === 'downloading' && <UpscaleBar label="Downloading the upscaler" value={u.progress} />}
          {u.state === 'running' && (
            <UpscaleBar label="Upscaling" value={u.tiles ? u.tiles.done / Math.max(1, u.tiles.total) : 0} />
          )}
          {u.elsewhere && notice("Another photo is upscaling. This one can go when it's done.")}
          {u.cleaning && !working && notice('Waiting for the clean-up to finish')}
        </>
      )}
      {u.upscaledFrom && !working && (
        <div className="panel__upscale">
          <p className="panel__meta panel__upscale-text">
            Upscaled from{' '}
            <span className="mono nowrap">
              {u.upscaledFrom.width} × {u.upscaledFrom.height}
            </span>{' '}
            px.
          </p>
          {u.canUndo && (
            <button type="button" className="button button--quiet button--sm panel__upscale-btn" onClick={onUndo}>
              Undo
            </button>
          )}
        </div>
      )}
    </>
  )
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
  passport,
  onPassportSize,
  onPassportSheet,
  onPassportRetry,
  shadow,
  onShadow,
  match,
  onMatch,
  preview,
  outSize,
  diagnostics,
  timings,
  startupMs,
  draftMs,
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
  onSticker,
  onShortcuts,
  upscale,
  onUpscale,
  onUpscaleRetry,
  onUpscaleUndo,
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
    ? format === 'jpg' || frame === 'passport'
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
        {passport && (
          <>
            <Segmented
              className="seg seg--block"
              label="Passport size"
              options={PASSPORT_SIZES}
              value={passport.size}
              onChange={onPassportSize}
            />
            <Segmented
              className="seg seg--block"
              label="Print"
              options={PASSPORT_PRINT}
              value={passport.sheet ? 'sheet' : 'one'}
              onChange={(v) => onPassportSheet(v === 'sheet')}
            />
          </>
        )}
        <p className="panel__meta">
          {passport ? (
            passport.finding ? (
              'Finding the face…'
            ) : passport.sheet ? (
              <>
                <span className="mono">10 × 15</span> cm sheet {' · '}
                <span className="mono">{passport.sheetCount}</span> {passport.sheetCount === 1 ? 'photo' : 'photos'}
              </>
            ) : passport.size === '35x45' ? (
              <>
                <span className="mono">35 × 45</span> mm {' · '}
                <span className="nowrap">
                  <span className="mono">413 × 531</span> px at 300 dpi
                </span>
              </>
            ) : (
              <>
                <span className="mono">2 × 2</span> in {' · '}
                <span className="nowrap">
                  <span className="mono">600 × 600</span> px at 300 dpi
                </span>
              </>
            )
          ) : (
            <>
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
            </>
          )}
        </p>
        {upscale && <UpscaleBlock u={upscale} onUpscale={onUpscale} onRetry={onUpscaleRetry} onUndo={onUpscaleUndo} />}
        {passport && (
          <>
            <p className="panel__meta">
              {passport.size === '35x45'
                ? 'The size most countries use. Check yours.'
                : 'The US passport and visa size.'}
            </p>
            {passport.failed ? (
              <p className="panel__notice">
                <InfoIcon width={15} height={15} />
                <span>Couldn't load the face finder.</span>
                <button type="button" className="button button--quiet button--sm" onClick={onPassportRetry}>
                  Try again
                </button>
              </p>
            ) : (
              passport.issues.slice(0, 2).map((issue) => (
                <p key={issue} className="panel__notice">
                  <InfoIcon width={15} height={15} />
                  <span>{PASSPORT_NOTE[issue]}</span>
                </p>
              ))
            )}
          </>
        )}
        {frame !== 'photo' && (
          <div className="panel__preview">
            {preview ? (
              passport && !passport.sheet && passport.guides ? (
                <span className="panel__frame">
                  <img src={preview} alt="What you'll download" draggable={false} />
                  <span
                    className="panel__guide"
                    style={{ top: `${passport.guides.crown * 100}%` }}
                    aria-hidden="true"
                  />
                  <span className="panel__guide" style={{ top: `${passport.guides.chin * 100}%` }} aria-hidden="true" />
                </span>
              ) : (
                <img src={preview} alt="What you'll download" draggable={false} />
              )
            ) : (
              <Spinner />
            )}
          </div>
        )}
        {/* A passport photo has no shadow, so the choice isn't offered there. */}
        {frame !== 'passport' && (
          <>
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
          </>
        )}
        {frame !== 'passport' && shadow.kind !== 'none' && (
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
        {frame !== 'passport' && (
          <>
            <h2 className="panel__title" id="match-label">
              Light
            </h2>
            <label className="switch" data-disabled={fill === null || undefined}>
              <input
                type="checkbox"
                role="switch"
                checked={match.on && fill !== null}
                disabled={fill === null}
                aria-describedby={fill === null ? 'match-why' : undefined}
                onChange={(e) => onMatch({ ...match, on: e.target.checked })}
              />
              <span className="switch__track" aria-hidden="true" />
              <span>
                Match the background <span className="switch__note">(experimental)</span>
              </span>
            </label>
            {fill === null && (
              <p className="panel__notice" id="match-why">
                <InfoIcon width={15} height={15} />
                <span>Pick a background first. A clear one has no light to match.</span>
              </p>
            )}
            {fill !== null && match.on && (
              <div className="panel__sliders">
                <label className="editbar__slider">
                  <span>Strength</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(match.strength * 100)}
                    onChange={(e) => onMatch({ ...match, strength: Number(e.target.value) / 100 })}
                  />
                  <output className="editbar__val">{Math.round(match.strength * 100)} %</output>
                </label>
              </div>
            )}
          </>
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
        <button type="button" className="button button--quiet button--block" onClick={onSticker}>
          {share ? <ShareIcon /> : <DownloadIcon />}
          {share ? 'Share as sticker' : 'Download as sticker'}
        </button>
        <p className="panel__meta">
          <span className="mono nowrap">512 × 512</span>, transparent, for WhatsApp
        </p>
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
        {diagnostics && (
          <DeviceDetails
            d={diagnostics}
            timings={timings}
            startupMs={startupMs}
            draftMs={draftMs}
            onRetryGpu={onRetryGpu}
          />
        )}
        <button type="button" className="device__summary panel__shortcuts" onClick={onShortcuts}>
          Keyboard shortcuts <kbd>?</kbd>
        </button>
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

/** Seconds with one decimal under 10 s, whole seconds above. */
export function seconds(ms: number) {
  const s = ms / 1000
  return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`
}

/** What this device is doing with the model, and a way back to the GPU when it gave up on it. No image data. */
function DeviceDetails({
  d,
  timings,
  startupMs,
  draftMs,
  onRetryGpu,
}: {
  d: Diagnostics
  timings: Timings | null
  startupMs: number | null
  draftMs: number | null
  onRetryGpu: () => void
}) {
  const why =
    d.reason === 'gpu'
      ? null
      : d.reason === 'limits'
        ? `The graphics card allows ${d.gpu?.storageBuffers ?? 'too few'} storage buffers per shader; the model needs 33.`
        : WHY[d.reason]
  const gpuName = d.gpu && (d.gpu.description || [d.gpu.vendor, d.gpu.architecture].filter(Boolean).join(' '))
  const canRetry = d.device === 'wasm' && (d.reason === 'gpu-failed' || d.reason === 'remembered')
  const id = useId()
  // A native popover: it floats over the panel instead of lengthening it, and closes on Esc or a
  // press outside. The browser sets aria-expanded on the trigger and returns focus to it.
  return (
    <div className="device">
      <button type="button" className="device__summary" popoverTarget={id}>
        About this device
        <ChevronDownIcon width={14} height={14} className="device__chevron" />
      </button>
      <div id={id} popover="auto" className="device__body" role="dialog" aria-labelledby={`${id}-title`}>
        <p id={`${id}-title`} className="device__title">
          About this device
        </p>
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
          <div>
            <dt>Start-up</dt>
            <dd className="mono">{seconds(startupMs ?? d.loadMs)}</dd>
          </div>
          {timings && (
            <div>
              <dt>Last photo</dt>
              <dd>
                <span className="mono">{seconds(timings.total)}</span>
                <span className="device__why">
                  {draftMs !== null && `first look ${seconds(draftMs)} · `}cut-out {seconds(timings.cutout)} · clean-up{' '}
                  {seconds(timings.mask + timings.refine + timings.decontaminate)}
                  {timings.cleanup && ` on the ${timings.cleanup === 'gpu' ? 'GPU' : 'CPU'}`} · prep{' '}
                  {seconds(timings.prepare)}
                </span>
              </dd>
            </div>
          )}
        </dl>
        {canRetry && (
          <button type="button" className="button button--quiet" onClick={onRetryGpu}>
            Try the graphics card again
          </button>
        )}
      </div>
    </div>
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
