import { useCallback, useEffect, useRef, useState } from 'react'
import { Compare } from './components/Compare'
import { useFileIntake } from './components/DropZone'
import {
  AlertIcon,
  CameraIcon,
  CheckIcon,
  LockIcon,
  MoonIcon,
  ResetIcon,
  Spinner,
  SunIcon,
  UploadIcon,
} from './components/icons'
import { Queue, type Item } from './components/Queue'
import { Toolbar } from './components/Toolbar'
import { cutout, downloadName, exportPng } from './lib/compose'
import { useRemover, type Result, type Status } from './lib/useRemover'
import { useTheme } from './lib/useTheme'

/** A 1x1 transparent GIF, shown until a HEIC photo has been decoded. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

type Entry = { file: File; url: string; result?: Result }

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

/** Touch devices that can hand a PNG to the share sheet (iOS "Save Image", WhatsApp, …). Desktop
 * browsers can share files too, but a plain download is what people expect there. */
const shareFiles = (() => {
  try {
    return (
      matchMedia('(any-hover: none)').matches &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [new File([], 'cutout.png', { type: 'image/png' })] })
    )
  } catch {
    return false
  }
})()

export default function App() {
  const { status, progress, diagnostics, fellBack, error, process, retryGpu } = useRemover()
  const theme = useTheme()
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [fill, setFill] = useState<string | null>(null)
  const [custom, setCustom] = useState('#e0532c')
  // The selected cut-out, rendered at full size with the chosen background: shown on stage and
  // saved as is, so saving needs no async work (iOS only allows share() straight from a tap).
  const [after, setAfter] = useState<{ id: string; fill: string | null; url: string; blob: Blob } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const entries = useRef(new Map<string, Entry>())
  const revealed = useRef(new Set<string>())

  const patch = useCallback(
    (id: string, p: Partial<Item>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i))),
    [],
  )

  const onFiles = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const id = crypto.randomUUID()
        // HEIC can't be shown by most browsers: it gets its thumbnail once decoded.
        const url =
          /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]$/.test(file.type) ? '' : URL.createObjectURL(file)
        entries.current.set(id, { file, url })
        setItems((list) => [...list, { id, name: file.name, state: 'queued', thumb: url || BLANK }])
        // Skipped if removed before its turn, so it doesn't hold up the images after it.
        process(
          file,
          () => patch(id, { state: 'processing' }),
          () => !entries.current.has(id),
          (d) => {
            const e = entries.current.get(id)
            if (!e) return URL.revokeObjectURL(d.url)
            if (e.url) URL.revokeObjectURL(e.url)
            e.url = d.url
            patch(id, { thumb: d.url, scaled: d.scaled })
          },
        )
          .then((result) => {
            const e = entries.current.get(id)
            // Removed (or the app was reset) while it was processing: drop the result.
            if (!e) {
              result.original.close()
              return
            }
            e.result = result
            patch(id, { state: 'done' })
            setSelected((s) => s ?? id)
          })
          .catch((err: Error) => patch(id, { state: 'error', error: err.message }))
      }
    },
    [process, patch],
  )

  const forget = (id: string) => {
    const e = entries.current.get(id)
    if (!e) return
    if (e.url) URL.revokeObjectURL(e.url)
    e.result?.original.close()
    entries.current.delete(id)
    revealed.current.delete(id)
  }

  const remove = useCallback((id: string) => {
    forget(id)
    setItems((list) => list.filter((i) => i.id !== id))
  }, [])

  // Whenever the selected image goes away, show the next ready one (or the pending/empty state).
  useEffect(() => {
    if (selected && items.some((i) => i.id === selected)) return
    const next = items.find((i) => i.state === 'done')?.id ?? null
    if (next !== selected) setSelected(next)
  }, [items, selected])

  const startOver = useCallback(() => {
    for (const id of [...entries.current.keys()]) forget(id)
    setItems([])
    setSelected(null)
    setAfter(null)
    setFill(null)
  }, [])

  const onReject = useCallback((names: string[]) => {
    setNotice(
      names.length === 1
        ? `${names[0]} isn't a photo Cutout can open.`
        : `${names.length} files weren't photos Cutout can open.`,
    )
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(t)
  }, [notice])

  const intake = useFileIntake(onFiles, onReject)

  // Render the selected cut-out with the chosen background.
  const selectedItem = items.find((i) => i.id === selected)
  const selectedDone = selectedItem?.state === 'done'
  useEffect(() => {
    const id = selected
    const r = id ? entries.current.get(id)?.result : undefined
    if (!id || !r) return
    let url: string | null = null
    let cancelled = false
    cutout(r.original, r.mask, fill ?? undefined).toBlob((blob) => {
      if (cancelled || !blob) return
      url = URL.createObjectURL(blob)
      setAfter({ id, fill, url, blob })
    }, 'image/png')
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [selected, selectedDone, fill])

  const save = useCallback(async () => {
    const e = selected ? entries.current.get(selected) : undefined
    if (!e?.result) return
    const name = downloadName(e.file.name)
    // The pre-rendered PNG counts only once it has the background picked now (a swatch tap
    // re-renders it, which takes a moment on a large photo).
    const ready = after && after.id === selected && after.fill === fill ? after.blob : null
    if (shareFiles && ready) {
      try {
        await navigator.share({ files: [new File([ready], name, { type: 'image/png' })] })
        return
      } catch (err) {
        if ((err as Error).name === 'AbortError') return // closed the share sheet
        // Anything else (not allowed, unsupported): fall back to a download.
      }
    }
    const blob = ready ?? (await exportPng(e.result.original, e.result.mask, fill ?? undefined))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }, [selected, fill, after])

  const current = selected ? entries.current.get(selected) : undefined
  const showCompare = !!(current?.result && after?.id === selected)
  const reveal = !!selected && showCompare && !revealed.current.has(selected)
  useEffect(() => {
    if (showCompare && selected) revealed.current.add(selected)
  }, [showCompare, selected])

  const pending = items.find((i) => i.state === 'processing') ?? items.find((i) => i.state === 'queued')
  const hasItems = items.length > 0

  return (
    <div className="app" {...(hasItems ? intake.dragProps : {})}>
      {intake.picker}

      <header className="header">
        <a className="wordmark" href="/" aria-label="Cutout, start over">
          <Mark />
          Cutout
        </a>
        <div className="header__actions">
          {hasItems && (
            <>
              <StatusPill status={status} progress={progress} />
              <button type="button" className="button button--ghost" onClick={startOver} aria-label="Start over">
                <ResetIcon />
                <span className="hide-sm">Start over</span>
              </button>
              <button type="button" className="button button--quiet" onClick={intake.open}>
                <UploadIcon />
                <span className="hide-sm">Add images</span>
              </button>
            </>
          )}
          {/* Light / dark switch: the thumb slides under the active icon. */}
          <button
            type="button"
            role="switch"
            aria-checked={theme.theme === 'dark'}
            aria-label="Dark mode"
            className="theme-switch"
            onClick={theme.toggle}
          >
            <span className="theme-switch__thumb" aria-hidden="true" />
            <SunIcon className="theme-switch__icon" width={15} height={15} />
            <MoonIcon className="theme-switch__icon" width={15} height={15} />
          </button>
        </div>
      </header>

      {notice && (
        <p className="notice" role="status">
          <AlertIcon width={16} height={16} />
          {notice}
        </p>
      )}

      {!hasItems ? (
        <main className="empty">
          <div className={`sheet drop${intake.over ? ' drop--over' : ''}`} {...intake.dragProps}>
            <div className="drop__inner">
              <h1 className="empty__title">
                Lift <span className="cutword">anything</span> off its background.
              </h1>
              <p className="empty__lede">
                Drop images here, paste one, or choose from your files. It all happens on your device, so nothing is
                uploaded.
              </p>
              <div className="empty__actions">
                <button type="button" className="button button--primary button--lg" onClick={intake.open}>
                  <UploadIcon />
                  Choose images
                </button>
                <button
                  type="button"
                  className="button button--quiet button--lg only-touch"
                  onClick={intake.openCamera}
                >
                  <CameraIcon />
                  Take a photo
                </button>
                <span className="empty__or">
                  or paste with <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd> <kbd>V</kbd>
                </span>
              </div>
              <p className="empty__formats">PNG, JPG, WebP, HEIC or AVIF · as many as you like</p>
            </div>
            <ModelLine status={status} progress={progress} error={error} />
          </div>
        </main>
      ) : null}

      {!hasItems ? (
        <footer className="footer">
          <span className="footer__item">
            <LockIcon width={14} height={14} />
            Private: runs in your browser
          </span>
          <span className="footer__dot" aria-hidden="true">
            ·
          </span>
          <a className="footer__link" href="https://github.com/mikelisrael/cutout" target="_blank" rel="noreferrer">
            Open source on GitHub
          </a>
        </footer>
      ) : (
        <main className="workspace">
          <section className="stage-col" aria-label="Preview">
            <div className="sheet stage">
              {showCompare && current?.result && after ? (
                <Compare
                  key={selected}
                  before={current.url}
                  after={after.url}
                  width={current.result.original.width}
                  height={current.result.original.height}
                  reveal={reveal}
                />
              ) : selectedItem?.state === 'error' ? (
                <Failure name={selectedItem.name} message={selectedItem.error} onRetry={intake.open} />
              ) : pending ? (
                <Pending item={pending} status={status} progress={progress} />
              ) : (
                <Failure
                  name={items[items.length - 1]?.name}
                  message={items[items.length - 1]?.error}
                  onRetry={intake.open}
                />
              )}
            </div>
            <Queue items={items} selected={selected} onSelect={setSelected} onRemove={remove} onAdd={intake.open} />
          </section>

          {showCompare && current?.result ? (
            <Toolbar
              fill={fill}
              custom={custom}
              onFill={setFill}
              onCustom={setCustom}
              onDownload={save}
              size={{ width: current.result.original.width, height: current.result.original.height }}
              diagnostics={diagnostics}
              fellBack={fellBack}
              onRetryGpu={retryGpu}
              scaled={selectedItem?.scaled}
              share={shareFiles}
            />
          ) : (
            <aside className="panel panel--waiting">
              <p className="panel__hint">Background colours and the download appear here once a cut-out is ready.</p>
            </aside>
          )}
        </main>
      )}

      {hasItems && intake.over && (
        <div className="veil" aria-hidden="true">
          <div className="veil__box">
            <UploadIcon width={28} height={28} />
            Drop to add
          </div>
        </div>
      )}
    </div>
  )
}

function Mark() {
  return (
    <svg className="wordmark__mark" width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      <rect
        x="6.5"
        y="6.5"
        width="15"
        height="15"
        rx="3.5"
        fill="none"
        stroke="var(--paper)"
        strokeWidth="1.6"
        strokeDasharray="2.6 2.2"
      />
      <circle cx="19.5" cy="19.5" r="6.5" fill="var(--accent)" />
    </svg>
  )
}

function StatusPill({ status, progress }: { status: Status; progress: number }) {
  const setup = status === 'idle' || status === 'loading'
  return (
    <span className="pill" data-status={status} role="status">
      <span className="pill__dot" />
      {setup ? (
        <SetupText progress={progress} />
      ) : status === 'processing' ? (
        'Working'
      ) : status === 'error' ? (
        "Couldn't start"
      ) : (
        'Ready'
      )}
    </span>
  )
}

/** The model's files download once; after that (or from the cache) it still takes a moment to start. */
function SetupText({ progress, download }: { progress: number; download?: boolean }) {
  if (progress >= 1) return <>Starting up…</>
  return (
    <>
      Setting up{download ? ' · one-time download' : ''}{' '}
      <span className="mono model__pct">{Math.round(progress * 100)}%</span>
    </>
  )
}

function ModelLine({ status, progress, error }: { status: Status; progress: number; error: string | null }) {
  if (status === 'error') {
    return (
      <div className="model model--error" role="alert">
        <AlertIcon width={16} height={16} />
        <span className="model__text">
          The background remover couldn't load{error ? ` (${error})` : ''}. Check your connection, then reload.
        </span>
        <button type="button" className="button button--quiet button--sm" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    )
  }
  if (status === 'idle' || status === 'loading') {
    return (
      <div className="model" role="status">
        <span className="model__text">
          <SetupText progress={progress} download />
        </span>
        <span className="bar" aria-hidden="true">
          <span className="bar__fill" style={{ transform: `scaleX(${Math.max(0.02, progress)})` }} />
        </span>
      </div>
    )
  }
  return (
    <div className="model model--ready" role="status">
      <CheckIcon width={16} height={16} />
      <span className="model__text">Ready. Next time it starts without the download.</span>
    </div>
  )
}

function Pending({ item, status, progress }: { item: Item; status: Status; progress: number }) {
  const waiting = status === 'idle' || status === 'loading'
  return (
    <div className="pending">
      <div className="pending__frame">
        <img className="pending__img" src={item.thumb} alt="" draggable={false} />
        <span className="pending__scan" aria-hidden="true" />
      </div>
      <p className="pending__caption" role="status">
        <Spinner />
        {waiting ? <SetupText progress={progress} /> : 'Removing background…'}
      </p>
    </div>
  )
}

function Failure({ name, message, onRetry }: { name?: string; message?: string; onRetry: () => void }) {
  return (
    <div className="failure" role="alert">
      <span className="failure__icon">
        <AlertIcon width={22} height={22} />
      </span>
      <p className="failure__title">Couldn't cut out {name ?? 'that image'}</p>
      <p className="failure__text">{message ? `${message}. ` : ''}Try another image, or a smaller copy of this one.</p>
      <button type="button" className="button button--quiet" onClick={onRetry}>
        Choose another image
      </button>
    </div>
  )
}
