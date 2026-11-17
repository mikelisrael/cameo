import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Compare } from './components/Compare'
import { EditBar } from './components/EditBar'
import { Editor, type BrushSettings, type EditorHandle, type Tool } from './components/Editor'
import { useFileIntake } from './components/DropZone'
import {
  AlertIcon,
  CameraIcon,
  InfoIcon,
  LockIcon,
  MoonIcon,
  ResetIcon,
  Spinner,
  SunIcon,
  UploadIcon,
} from './components/icons'
import { Queue, type Item } from './components/Queue'
import { Toolbar } from './components/Toolbar'
import { applyPatch, applyPick, type MaskPatch } from './lib/brush'
import { cutout, downloadName, exportPng } from './lib/compose'
import { isDirty, newHistory, push, redo, undo, type History } from './lib/history'
import type { Mask } from './lib/protocol'
import { useHowItWorks } from './lib/useHowItWorks'
import { useRemover, type Result, type Status } from './lib/useRemover'
import { useSegmenter } from './lib/useSegmenter'
import { useTheme } from './lib/useTheme'

const HowItWorks = lazy(() => import('./components/HowItWorks'))

/** A 1x1 transparent GIF, shown until a HEIC photo has been decoded. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

type Entry = {
  file: File
  url: string
  result?: Result
  /** The mask as edited; made (a copy of the model's) the first time Edit opens. */
  edited?: Mask
  history: History
}

type View = 'compare' | 'edit'

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

const ACTIVATABLE =
  'button, [role="radio"], [role="switch"], a[href], summary, input[type="checkbox"], input[type="radio"], input[type="range"]'

/** A control Space presses itself, so the Edit view's hold-Space-for-original must not touch it. */
const isActivatable = (t: EventTarget | null) => t instanceof Element && !!t.closest(ACTIVATABLE)

export default function App() {
  const { status, progress, diagnostics, fellBack, error, process, retryGpu } = useRemover()
  const theme = useTheme()
  const how = useHowItWorks()
  // Mirrors how.isOpen for handlers registered once or owned elsewhere (paste lives in useFileIntake).
  const howOpen = useRef(how.isOpen)
  howOpen.current = how.isOpen
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [fill, setFill] = useState<string | null>(null)
  const [custom, setCustom] = useState('#e0532c')
  // The selected cut-out, rendered at full size with the chosen background: shown on stage and
  // saved as is, so saving needs no async work (iOS only allows share() straight from a tap).
  const [after, setAfter] = useState<{
    id: string
    fill: string | null
    version: number
    url: string
    blob: Blob
  } | null>(null)
  const [view, setView] = useState<View>('compare')
  const [tool, setTool] = useState<Tool>('erase')
  const [brush, setBrush] = useState<BrushSettings>({ size: 40, softness: 0.25, smart: true })
  const [showOriginal, setShowOriginal] = useState(false)
  const seg = useSegmenter()
  const segRef = useRef(seg)
  segRef.current = seg
  const [pick, setPick] = useState<'keep' | 'remove'>('keep')
  const [tapPoint, setTapPoint] = useState<{ x: number; y: number } | null>(null)
  // Bumped on every mask change (strokes, undo, redo, reset): the cut-out is rebuilt from it.
  const [editVersion, setEditVersion] = useState(0)
  // Bumped only when the mask changed outside the editor's own strokes, so it redraws.
  const [editorVersion, setEditorVersion] = useState(0)
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const editorRef = useRef<EditorHandle>(null)
  const fromPicker = useRef(false)
  const tapSeq = useRef(0) // the latest tap's number, so a slow decode doesn't clear a newer marker
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
        entries.current.set(id, { file, url, history: newHistory() })
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
    segRef.current.drop(id)
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
    setView('compare')
  }, [])

  const onReject = useCallback((names: string[]) => {
    setNotice(
      names.length === 1
        ? `${names[0]} isn't a photo Cameo can open.`
        : `${names.length} files weren't photos Cameo can open.`,
    )
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(t)
  }, [notice])

  // The page takes no pasted or dropped photos while it shows.
  const intake = useFileIntake(
    useCallback(
      (files: File[]) => {
        if (!howOpen.current) onFiles(files)
      },
      [onFiles],
    ),
    useCallback(
      (names: string[]) => {
        if (!howOpen.current) onReject(names)
      },
      [onReject],
    ),
  )

  // Render the selected cut-out with the chosen background.
  const selectedItem = items.find((i) => i.id === selected)
  const selectedDone = selectedItem?.state === 'done'
  useEffect(() => {
    const id = selected
    const e = id ? entries.current.get(id) : undefined
    const r = e?.result
    if (!id || !r) {
      setAfter(null)
      return
    }
    // Not while editing: every stroke would re-encode a full-size PNG nobody is looking at.
    if (view === 'edit') return
    let cancelled = false
    const version = editVersion
    const canvas = cutout(r.original, e.edited ?? r.mask, fill ?? undefined, r.colors)
    canvas.toBlob((blob) => {
      canvas.width = canvas.height = 0
      // A superseded run never makes a URL, so there is nothing to revoke for it.
      if (cancelled || !blob) return
      setAfter({ id, fill, version, url: URL.createObjectURL(blob), blob })
    }, 'image/png')
    return () => {
      cancelled = true
    }
  }, [selected, selectedDone, fill, editVersion, view])

  // The displayed URL stays valid until a newer one has replaced it (or it is cleared, or the app
  // unmounts): this cleanup runs after the replacement has committed.
  useEffect(
    () => () => {
      if (after) URL.revokeObjectURL(after.url)
    },
    [after],
  )

  const save = useCallback(async () => {
    const e = selected ? entries.current.get(selected) : undefined
    if (!e?.result) return
    const name = downloadName(e.file.name)
    // The pre-rendered PNG counts only once it has the background picked now (a swatch tap
    // re-renders it, which takes a moment on a large photo).
    const ready =
      after && after.id === selected && after.fill === fill && after.version === editVersion ? after.blob : null
    if (shareFiles && ready) {
      try {
        await navigator.share({ files: [new File([ready], name, { type: 'image/png' })] })
        return
      } catch (err) {
        if ((err as Error).name === 'AbortError') return // closed the share sheet
        // Anything else (not allowed, unsupported): fall back to a download.
      }
    }
    const blob =
      ready ?? (await exportPng(e.result.original, e.edited ?? e.result.mask, fill ?? undefined, e.result.colors))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }, [selected, fill, after, editVersion])

  const current = selected ? entries.current.get(selected) : undefined
  const hasResult = !!current?.result

  // Another image: back to Compare.
  useEffect(() => {
    setView('compare')
    setShowOriginal(false)
  }, [selected])

  const changeView = useCallback(
    (next: View) => {
      const e = selected ? entries.current.get(selected) : undefined
      if (!e?.result) return
      if (next === 'edit' && !e.edited) {
        const m = e.result.mask
        e.edited = { width: m.width, height: m.height, data: new Uint8ClampedArray(m.data) }
      }
      setView(next)
      setShowOriginal(false)
    },
    [selected],
  )

  const onStroke = useCallback(
    (p: MaskPatch) => {
      const e = selected ? entries.current.get(selected) : undefined
      if (!e) return
      push(e.history, { kind: 'mask', patch: p })
      setEditVersion((v) => v + 1)
    },
    [selected],
  )

  // Select needs the photo read once; start as soon as the tool is open on a ready image.
  useEffect(() => {
    if (view !== 'edit' || tool !== 'select' || !selected) return
    const r = entries.current.get(selected)?.result
    if (r) segRef.current.prepare(selected, r.original)
  }, [view, tool, selected, selectedDone])

  // A tap marker belongs to one image and one tool.
  useEffect(() => {
    setTapPoint(null)
  }, [selected, view, tool])

  const onTap = useCallback(
    (p: { x: number; y: number }) => {
      if (tapPoint || !selected) return
      const id = selected
      const e = entries.current.get(id)
      const m = e?.edited
      if (!e || !m) return
      const seq = ++tapSeq.current
      setTapPoint(p)
      segRef.current
        .decode(id, p.x, p.y, m.width, m.height)
        .then((s) => {
          if (!s || entries.current.get(id) !== e || e.edited !== m) return
          const patch = applyPick(m.data, m.width, s, pick)
          if (!patch) return
          push(e.history, { kind: 'mask', patch })
          setEditVersion((v) => v + 1)
          setEditorVersion((v) => v + 1)
        })
        .catch(() => {})
        .finally(() => {
          if (tapSeq.current === seq) setTapPoint(null) // a newer tap owns the marker now
        })
    },
    [tapPoint, selected, pick],
  )

  const stepHistory = useCallback(
    (dir: 'undo' | 'redo') => {
      const e = selected ? entries.current.get(selected) : undefined
      if (!e?.result) return
      const step = (dir === 'undo' ? undo : redo)(e.history)
      if (!step) return
      if (step.kind === 'fill') {
        setFill(dir === 'undo' ? step.from : step.to)
      } else if (e.edited) {
        if (step.kind === 'mask')
          applyPatch(e.edited.data, e.edited.width, step.patch, dir === 'undo' ? 'before' : 'after')
        else e.edited.data.set(dir === 'undo' ? step.before : step.after)
        setEditVersion((v) => v + 1)
        setEditorVersion((v) => v + 1)
      }
      rerender()
    },
    [selected],
  )

  const changeFill = useCallback(
    (next: string | null) => {
      const e = selected ? entries.current.get(selected) : undefined
      // The custom colour picker fires onCustom and onFill together, on every drag tick: not history.
      if (e?.result && next !== fill && !fromPicker.current) push(e.history, { kind: 'fill', from: fill, to: next })
      setFill(next)
    },
    [selected, fill],
  )

  const changeCustom = useCallback((hex: string) => {
    fromPicker.current = true
    queueMicrotask(() => {
      fromPicker.current = false
    })
    setCustom(hex)
  }, [])

  const resetEdits = useCallback(() => {
    const e = selected ? entries.current.get(selected) : undefined
    if (!e?.result || !e.edited) return
    const before = new Uint8ClampedArray(e.edited.data)
    const after = new Uint8ClampedArray(e.result.mask.data)
    e.edited.data.set(after)
    push(e.history, { kind: 'reset', before, after })
    setEditVersion((v) => v + 1)
    setEditorVersion((v) => v + 1)
  }, [selected])

  // Keyboard: undo/redo in both views; tools, brush size, zoom and hold-Space-for-original in Edit.
  const onKey = useRef<(e: KeyboardEvent, down: boolean) => void>(() => {})
  onKey.current = (e, down) => {
    if (howOpen.current) return
    if (!hasResult) return
    const t = e.target as HTMLElement | null
    // Letting go of Space ends the peek wherever the keyup lands (focus may have moved since).
    if (e.key === ' ' && !down) setShowOriginal(false)
    if (t) {
      const typing =
        t instanceof HTMLTextAreaElement ||
        t.isContentEditable ||
        (t instanceof HTMLInputElement && ['text', 'color', 'number'].includes(t.type))
      if (typing) return
    }
    const editing = view === 'edit'
    if (e.key === ' ') {
      // Space on a focused control activates it (on keyup for buttons): leave it be.
      if (!editing || isActivatable(t)) return
      e.preventDefault()
      if (down && !e.repeat) setShowOriginal(true)
      return
    }
    if (!down) return
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (mod && !e.altKey && key === 'z') {
      e.preventDefault()
      stepHistory(e.shiftKey ? 'redo' : 'undo')
      return
    }
    if (mod && !e.altKey && !e.shiftKey && key === 'y') {
      e.preventDefault()
      stepHistory('redo')
      return
    }
    if (!editing || mod || e.altKey) return
    switch (key) {
      case 's':
        setTool('select')
        break
      case 'e':
        setTool('erase')
        break
      case 'r':
        setTool('restore')
        break
      case 'v':
      case 'h':
        setTool('move')
        break
      case '[':
      case ']': {
        const dir = key === ']' ? 1 : -1
        setBrush((b) => {
          const d = Math.max(1, Math.round(b.size * 0.1))
          return { ...b, size: Math.min(200, Math.max(4, b.size + dir * d)) }
        })
        break
      }
      case '+':
      case '=':
        editorRef.current?.zoomIn()
        break
      case '-':
        editorRef.current?.zoomOut()
        break
      case '0':
        editorRef.current?.fit()
        break
      default:
        return
    }
    e.preventDefault()
  }
  useEffect(() => {
    const down = (e: KeyboardEvent) => onKey.current(e, true)
    const up = (e: KeyboardEvent) => onKey.current(e, false)
    const blur = () => setShowOriginal(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
  const showCompare =
    view === 'compare' && !!(current?.result && after?.id === selected && after.version === editVersion)
  // Edit → Compare: keep the editor (inert) on screen until the new PNG is ready, so the old cut-out never shows.
  const compareCatchingUp = view === 'compare' && !showCompare && !!current?.result && !!current.edited
  const reveal = !!selected && showCompare && !revealed.current.has(selected)
  useEffect(() => {
    if (showCompare && selected) revealed.current.add(selected)
  }, [showCompare, selected])

  const pending = items.find((i) => i.state === 'processing') ?? items.find((i) => i.state === 'queued')
  const hasItems = items.length > 0

  return (
    <div className="app" {...(hasItems && !how.isOpen ? intake.dragProps : {})}>
      {intake.picker}

      <header className="header">
        <a className="wordmark" href="/" aria-label="Cameo, start over">
          <Mark />
          Cameo
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
          {!how.isOpen && (
            <a
              className="button button--ghost"
              href="/how-it-works"
              onClick={(e) => {
                e.preventDefault()
                how.open()
              }}
              aria-label="How it works"
            >
              <InfoIcon />
              <span className="hide-sm">How it works</span>
            </a>
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

      {how.isOpen && (
        <Suspense fallback={null}>
          <HowItWorks
            hasItems={hasItems}
            onClose={how.close}
            onChoose={() => {
              how.close()
              intake.open()
            }}
          />
        </Suspense>
      )}

      <div className="app__main" hidden={how.isOpen}>
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
                <p className="empty__formats">
                  <span className="nowrap">PNG, JPG, WebP, HEIC or AVIF</span> ·{' '}
                  <span className="nowrap">as many as you like</span>
                </p>
              </div>
              <ModelLine status={status} progress={progress} error={error} />
            </div>
          </main>
        ) : null}

        {!hasItems ? (
          <footer className="footer">
            <span className="footer__item">
              <LockIcon width={14} height={14} />
              Your photos stay on this device
            </span>
            <span className="footer__dot" aria-hidden="true">
              ·
            </span>
            <a
              className="footer__link"
              href="/how-it-works"
              onClick={(e) => {
                e.preventDefault()
                how.open()
              }}
            >
              How it works
            </a>
            <span className="footer__dot" aria-hidden="true">
              ·
            </span>
            <a className="footer__link" href="https://github.com/mikelisrael/cameo" target="_blank" rel="noreferrer">
              Code on GitHub
            </a>
          </footer>
        ) : (
          <main className="workspace">
            <section className="stage-col" aria-label="Preview">
              {current?.result && (
                <EditBar
                  view={view}
                  onView={changeView}
                  tool={tool}
                  onTool={setTool}
                  brush={brush}
                  onBrush={setBrush}
                  pick={pick}
                  onPick={setPick}
                  segState={seg.state}
                  segProgress={seg.progress}
                  onSegRetry={seg.retry}
                  canUndo={current.history.done.length > 0}
                  canRedo={current.history.undone.length > 0}
                  onUndo={() => stepHistory('undo')}
                  onRedo={() => stepHistory('redo')}
                  canReset={!!current.edited && isDirty(current.history)}
                  onReset={resetEdits}
                />
              )}
              <div className="sheet stage">
                {(view === 'edit' || compareCatchingUp) && current?.result && current.edited ? (
                  <Editor
                    key={selected}
                    ref={editorRef}
                    original={current.result.original}
                    mask={current.edited}
                    colors={current.result.colors}
                    fill={fill}
                    tool={tool}
                    brush={brush}
                    showOriginal={showOriginal}
                    onShowOriginal={setShowOriginal}
                    version={editorVersion}
                    onStroke={onStroke}
                    onTap={onTap}
                    pending={tapPoint}
                    still={view !== 'edit'}
                  />
                ) : showCompare && current?.result && after ? (
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

            {current?.result ? (
              <Toolbar
                fill={fill}
                custom={custom}
                onFill={changeFill}
                onCustom={changeCustom}
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
      <span className="model__live" aria-hidden />
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
