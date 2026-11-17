import { lazy, Suspense, useCallback, useEffect, useReducer, useRef, useState, type CSSProperties } from 'react'
import { Appearance } from './components/Appearance'
import { Compare } from './components/Compare'
import { EditBar } from './components/EditBar'
import { Editor, type BrushSettings, type EditorHandle, type Tool } from './components/Editor'
import { useFileIntake } from './components/DropZone'
import { AlertIcon, CameraIcon, InfoIcon, LockIcon, ResetIcon, Spinner, UploadIcon } from './components/icons'
import { Queue, type Item } from './components/Queue'
import { Shortcuts } from './components/Shortcuts'
import { Toolbar } from './components/Toolbar'
import { paintBackground } from './lib/background'
import { applyPatch, applyPick, type MaskPatch } from './lib/brush'
import {
  NO_SHADOW,
  downloadName,
  draftPreview,
  exportImage,
  exportSticker,
  frameSize,
  shadowKey,
  stickerName,
  supportsWebp,
  zipCutouts,
  type Format,
  type Frame,
  type Shadow,
} from './lib/compose'
import { ACCEPT_ATTR, decodeImage } from './lib/decode'
import { isDirty, newHistory, push, redo, undo, type History } from './lib/history'
import type { Mask } from './lib/protocol'
import { useHowItWorks } from './lib/useHowItWorks'
import { useRemover, type Result, type Status } from './lib/useRemover'
import { useSegmenter } from './lib/useSegmenter'
import { useAccent } from './lib/useAccent'
import { useTheme } from './lib/useTheme'

const HowItWorks = lazy(() => import('./components/HowItWorks'))

/** A 1x1 transparent GIF, shown until a HEIC photo has been decoded. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

type Entry = {
  file: File
  url: string
  result?: Result
  /** The decoded photo, before the result hands it over: the first look is drawn from it. */
  bitmap?: ImageBitmap
  /** The mask as edited; made (a copy of the model's) the first time Edit opens. */
  edited?: Mask
  history: History
}

type View = 'compare' | 'edit'

/** The first look at an image: the rough cut-out, drawn small. `ratio` is width / height. */
type Look = { id: string; url: string; ratio: number }

/** How long a change must sit still before its full-size render starts. */
const RENDER_DELAY = 200

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
  const { status, progress, diagnostics, timings, draftMs, fellBack, error, retrying, process, retryGpu, retryLoad } =
    useRemover()
  const theme = useTheme()
  const accent = useAccent()
  const how = useHowItWorks()
  // Mirrors how.isOpen for handlers registered once or owned elsewhere (paste lives in useFileIntake).
  const howOpen = useRef(how.isOpen)
  howOpen.current = how.isOpen
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [fill, setFill] = useState<string | null>(null)
  const fillRef = useRef(fill)
  fillRef.current = fill
  const [custom, setCustom] = useState('#e0532c')
  // Not remembered between visits.
  const [format, setFormat] = useState<Format>('png')
  const [frame, setFrame] = useState<Frame>('photo')
  const [shadow, setShadow] = useState<Shadow>(NO_SHADOW)
  const shadowId = shadowKey(shadow)
  const [webp, setWebp] = useState(false)
  const [zipping, setZipping] = useState(false)
  // The selected cut-out, rendered at full size with the chosen background: shown on stage and
  // saved as is, so saving needs no async work (iOS only allows share() straight from a tap).
  const [after, setAfter] = useState<{
    id: string
    fill: string | null
    version: number
    format: Format
    shadow: string
    url: string
    blob: Blob
  } | null>(null)
  // The same cut-out in the chosen size (Subject or a preset): the panel previews it and saving uses it.
  const [framed, setFramed] = useState<{
    id: string
    fill: string | null
    version: number
    format: Format
    frame: Frame
    shadow: string
    url: string
    blob: Blob
    width: number
    height: number
  } | null>(null)
  // The sticker for the selected cut-out; the blob is kept as is, so nothing needs revoking.
  const [sticker, setSticker] = useState<{ id: string; version: number; blob: Blob } | null>(null)
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
  // Pictures picked as backgrounds, by fill id ('image:<n>'). They live until Start over, because
  // undo can step back to an older one; nothing is stored beyond this session.
  const images = useRef(new Map<string, ImageBitmap>())
  const imageUrlRef = useRef(new Map<string, string>())
  // Bumped when the picked pictures are cleared, so a pick still decoding is dropped.
  const imageGen = useRef(0)
  const imageSeq = useRef(0)
  const [imageUrls, setImageUrls] = useState(() => new Map<string, string>())
  const [lastImage, setLastImage] = useState<string | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  // Small blurred copy of each photo for the Blur background, made once per photo.
  const blurUrls = useRef(new Map<string, string>())
  const [blur, setBlur] = useState<{ id: string; url: string } | null>(null)

  const patch = useCallback(
    (id: string, p: Partial<Item>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i))),
    [],
  )

  // The one place screen readers hear progress: a single polite region, spoken once per event.
  const [announcement, setAnnouncement] = useState('')
  const announceFrame = useRef(0)
  const announceQueue = useRef<string[]>([])
  const announce = useCallback((text: string) => {
    cancelAnimationFrame(announceFrame.current)
    // Messages from the same moment (one photo done, the next started) are spoken together, not dropped.
    announceQueue.current.push(text)
    // Cleared first, so the same text twice is still spoken.
    setAnnouncement('')
    announceFrame.current = requestAnimationFrame(() => {
      setAnnouncement(announceQueue.current.join(' '))
      announceQueue.current = []
    })
  }, [])
  const itemsRef = useRef(items)
  itemsRef.current = items

  // The first look: the rough cut-out drawn small, shown while the sharp one is made, then faded out over it.
  const looks = useRef(new Map<string, Look>())
  const [look, setLook] = useState<Look | null>(null) // the selected-to-be-shown draft of the item being processed
  const [fade, setFade] = useState<Look | null>(null) // a draft the sharp result is replacing
  const releaseLook = useCallback((id: string) => {
    const l = looks.current.get(id)
    if (!l) return
    URL.revokeObjectURL(l.url)
    looks.current.delete(id)
    setLook((cur) => (cur?.id === id ? null : cur))
    setFade((cur) => (cur?.id === id ? null : cur))
    setItems((list) => list.map((i) => (i.id === id && i.draft ? { ...i, draft: undefined } : i)))
  }, [])

  const lastStatus = useRef<Status>('idle')
  useEffect(() => {
    const prev = lastStatus.current
    lastStatus.current = status
    if (status === 'loading' && prev !== 'loading')
      announce('Setting up the background remover. This is a one-time download.')
    else if (status === 'ready' && prev === 'loading') announce('Ready.')
  }, [status, announce])

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
          () => {
            patch(id, { state: 'processing' })
            announce(`Removing the background from ${file.name}.`)
          },
          () => !entries.current.has(id),
          (d) => {
            const e = entries.current.get(id)
            if (!e) return URL.revokeObjectURL(d.url)
            if (e.url) URL.revokeObjectURL(e.url)
            e.url = d.url
            e.bitmap = d.bitmap
            patch(id, { thumb: d.url, scaled: d.scaled })
          },
          undefined,
          (mask) => {
            const e = entries.current.get(id)
            if (!e || e.result || !e.bitmap) return
            draftPreview(e.bitmap, mask, fillRef.current ?? undefined, images.current)
              .then(({ blob, ratio }) => {
                // The sharp result, a removal or Start over may have come first: then there is no first look.
                const now = entries.current.get(id)
                if (!now || now.result || looks.current.has(id)) return
                const l = { id, url: URL.createObjectURL(blob), ratio }
                looks.current.set(id, l)
                setLook(l)
                patch(id, { draft: l.url })
              })
              .catch(() => {})
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
            e.bitmap = undefined
            // Keep the first look's picture until it has faded out over the sharp one.
            const l = looks.current.get(id)
            setLook((cur) => (cur?.id === id ? null : cur))
            if (l) setFade(l)
            patch(id, { state: 'done', draft: undefined })
            const all = itemsRef.current
            const last = all.length >= 2 && all.every((i) => i.id === id || i.state === 'done')
            announce(last ? `All ${all.length} cut-outs ready.` : `${file.name}: cut-out ready.`)
            // A short tick on phones. Android only: iOS Safari has no vibrate, so this is a no-op there.
            if (document.visibilityState === 'visible' && matchMedia('(any-hover: none)').matches)
              navigator.vibrate?.(12)
            setSelected((s) => s ?? id)
          })
          .catch((err: Error) => {
            patch(id, { state: 'error', error: err.message, draft: undefined })
            releaseLook(id)
            if (entries.current.has(id)) announce(`${file.name} couldn't be cut out.`)
          })
      }
    },
    [process, patch, announce, releaseLook],
  )

  const forget = (id: string) => {
    const e = entries.current.get(id)
    if (!e) return
    if (e.url) URL.revokeObjectURL(e.url)
    e.result?.original.close()
    entries.current.delete(id)
    revealed.current.delete(id)
    const blurUrl = blurUrls.current.get(id)
    if (blurUrl) URL.revokeObjectURL(blurUrl)
    blurUrls.current.delete(id)
    segRef.current.drop(id)
    releaseLook(id)
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

  const clearImages = useCallback(() => {
    imageGen.current++
    for (const b of images.current.values()) b.close()
    for (const u of imageUrlRef.current.values()) URL.revokeObjectURL(u)
    images.current.clear()
    imageUrlRef.current.clear()
    setImageUrls(new Map())
    setLastImage(null)
  }, [])

  // Leaving the page frees the picked pictures and the blurred copies.
  useEffect(
    () => () => {
      imageGen.current++
      for (const b of images.current.values()) b.close()
      for (const u of imageUrlRef.current.values()) URL.revokeObjectURL(u)
      for (const u of blurUrls.current.values()) URL.revokeObjectURL(u)
      images.current.clear()
      imageUrlRef.current.clear()
      blurUrls.current.clear()
    },
    [],
  )

  const startOver = useCallback(() => {
    for (const id of [...entries.current.keys()]) forget(id)
    clearImages()
    setBlur(null)
    setItems([])
    setSelected(null)
    setAfter(null)
    setFramed(null)
    setSticker(null)
    setFill(null)
    setView('compare')
  }, [clearImages])

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
    // Wait for the last change to settle, so dragging a slider doesn't start an encode per step.
    const timer = setTimeout(() => {
      exportImage(r.original, e.edited ?? r.mask, fill ?? undefined, r.colors, format, 'photo', images.current, shadow)
        .then((blob) => {
          // A superseded run never makes a URL, so there is nothing to revoke for it.
          if (cancelled) return
          setAfter({ id, fill, version, format, shadow: shadowId, url: URL.createObjectURL(blob), blob })
        })
        .catch(() => {})
    }, RENDER_DELAY)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // `shadow` is covered by its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selectedDone, fill, editVersion, view, format, shadowId])

  // The displayed URL stays valid until a newer one has replaced it (or it is cleared, or the app
  // unmounts): this cleanup runs after the replacement has committed.
  useEffect(
    () => () => {
      if (after) URL.revokeObjectURL(after.url)
    },
    [after],
  )

  // The chosen size, rendered ahead like `after`. Photo needs none: `after` is the whole photo.
  useEffect(() => {
    const id = selected
    const e = id ? entries.current.get(id) : undefined
    const r = e?.result
    if (!id || !r || frame === 'photo') {
      setFramed(null)
      return
    }
    if (view === 'edit') return
    let cancelled = false
    const version = editVersion
    const mask = e.edited ?? r.mask
    const timer = setTimeout(() => {
      exportImage(r.original, mask, fill ?? undefined, r.colors, format, frame, images.current, shadow)
        .then((blob) => {
          if (cancelled) return
          const { width, height } = frameSize(frame, r.original, mask)
          setFramed({
            id,
            fill,
            version,
            format,
            frame,
            shadow: shadowId,
            url: URL.createObjectURL(blob),
            blob,
            width,
            height,
          })
        })
        .catch(() => {})
    }, RENDER_DELAY)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // `shadow` is covered by its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selectedDone, fill, editVersion, view, format, frame, shadowId])

  useEffect(
    () => () => {
      if (framed) URL.revokeObjectURL(framed.url)
    },
    [framed],
  )

  // The sticker, rendered ahead so a phone can share it inside the tap's gesture.
  useEffect(() => {
    const id = selected
    const e = id ? entries.current.get(id) : undefined
    const r = e?.result
    if (!id || !r) {
      setSticker(null)
      return
    }
    if (view === 'edit') return
    let cancelled = false
    const version = editVersion
    const timer = setTimeout(() => {
      exportSticker(r.original, e.edited ?? r.mask, r.colors)
        .then((blob) => {
          if (!cancelled) setSticker({ id, version, blob })
        })
        .catch(() => {})
    }, RENDER_DELAY)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [selected, selectedDone, editVersion, view])

  // The Blur background's preview: the photo at a few dozen pixels, scaled up to ~640 px and kept as a JPEG.
  useEffect(() => {
    const id = selected
    const r = id ? entries.current.get(id)?.result : undefined
    if (!id || !r) return
    if (blurUrls.current.has(id)) {
      setBlur({ id, url: blurUrls.current.get(id)! })
      return
    }
    let cancelled = false
    const k = 640 / Math.max(r.original.width, r.original.height)
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(r.original.width * k))
    c.height = Math.max(1, Math.round(r.original.height * k))
    paintBackground(c.getContext('2d')!, 'blur', c.width, c.height, { original: r.original })
    c.toBlob(
      (b) => {
        c.width = c.height = 0
        if (!b || cancelled || !entries.current.has(id)) return
        const url = URL.createObjectURL(b)
        blurUrls.current.set(id, url)
        setBlur({ id, url })
      },
      'image/jpeg',
      0.85,
    )
    return () => {
      cancelled = true
    }
  }, [selected, selectedDone])
  const blurUrl = blur && blur.id === selected ? blur.url : null

  // WebP is offered only where the browser really encodes it.
  useEffect(() => {
    supportsWebp().then(setWebp)
  }, [])
  useEffect(() => {
    if (!webp && format === 'webp') setFormat('png')
  }, [webp, format])

  const save = useCallback(async () => {
    const e = selected ? entries.current.get(selected) : undefined
    if (!e?.result) return
    const name = downloadName(e.file.name, format)
    // The pre-rendered image counts only once it has the background and format picked now (a
    // swatch tap or format change re-renders it, which takes a moment on a large photo).
    const ready =
      frame === 'photo'
        ? after &&
          after.id === selected &&
          after.fill === fill &&
          after.version === editVersion &&
          after.format === format &&
          after.shadow === shadowId
          ? after.blob
          : null
        : framed &&
            framed.id === selected &&
            framed.fill === fill &&
            framed.version === editVersion &&
            framed.format === format &&
            framed.frame === frame &&
            framed.shadow === shadowId
          ? framed.blob
          : null
    if (shareFiles && ready) {
      try {
        await navigator.share({ files: [new File([ready], name, { type: ready.type })] })
        return
      } catch (err) {
        if ((err as Error).name === 'AbortError') return // closed the share sheet
        // Anything else (not allowed, unsupported): fall back to a download.
      }
    }
    const blob =
      ready ??
      (await exportImage(
        e.result.original,
        e.edited ?? e.result.mask,
        fill ?? undefined,
        e.result.colors,
        format,
        frame,
        images.current,
        shadow,
      ))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }, [selected, fill, after, framed, editVersion, format, frame, shadow, shadowId])

  const saveSticker = useCallback(async () => {
    const e = selected ? entries.current.get(selected) : undefined
    if (!e?.result) return
    try {
      const ready = sticker && sticker.id === selected && sticker.version === editVersion ? sticker.blob : null
      if (shareFiles && ready) {
        try {
          await navigator.share({
            files: [new File([ready], stickerName(e.file.name, ready), { type: ready.type })],
          })
          return
        } catch (err) {
          if ((err as Error).name === 'AbortError') return // closed the share sheet
          // Anything else (not allowed, unsupported): fall back to a download.
        }
      }
      const blob = ready ?? (await exportSticker(e.result.original, e.edited ?? e.result.mask, e.result.colors))
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = stickerName(e.file.name, blob)
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch {
      setNotice("Couldn't make the sticker. Try again.")
    }
  }, [selected, sticker, editVersion])

  const doneCount = items.filter((i) => i.state === 'done').length

  const saveAll = useCallback(async () => {
    if (zipping) return
    setZipping(true)
    try {
      const files: { name: string; blob: Blob }[] = []
      // One at a time: each full-size canvas is freed before the next is drawn.
      for (const item of items) {
        const e = item.state === 'done' ? entries.current.get(item.id) : undefined
        if (!e?.result) continue
        const blob = await exportImage(
          e.result.original,
          e.edited ?? e.result.mask,
          fill ?? undefined,
          e.result.colors,
          format,
          frame,
          images.current,
          shadow,
        )
        files.push({ name: downloadName(e.file.name, format), blob })
      }
      if (!files.length) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(await zipCutouts(files))
      a.download = 'cameo-cutouts.zip'
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch {
      setNotice("Couldn't make the ZIP. Try again, or download them one by one.")
    } finally {
      setZipping(false)
    }
  }, [zipping, items, fill, format, frame, shadow])

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

  const changeFillRef = useRef(changeFill)
  changeFillRef.current = changeFill

  // Opens a picture from the files as a background; HEIC works and a huge one is shrunk, as for photos.
  const pickImage = useCallback(async (file: File | undefined) => {
    if (!file) return
    const gen = imageGen.current
    try {
      const d = await decodeImage(file)
      if (gen !== imageGen.current) {
        d.bitmap.close()
        URL.revokeObjectURL(d.url)
        return
      }
      const id = `image:${++imageSeq.current}`
      images.current.set(id, d.bitmap)
      imageUrlRef.current.set(id, d.url)
      setImageUrls(new Map(imageUrlRef.current))
      setLastImage(id)
      changeFillRef.current(id)
    } catch {
      setNotice(`${file.name} isn't a picture Cameo can open.`)
    }
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
    if (howOpen.current || shortcutsOpen) return
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
    if (down && e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      setShortcutsOpen(true)
      return
    }
    if (!hasResult) return
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
    // Save: always swallow the browser's Save page dialog.
    if (mod && !e.altKey && !e.shiftKey && key === 's') {
      e.preventDefault()
      if (current?.result) void save()
      return
    }
    if (mod || e.altKey) return
    // Previous / next picture in the queue; arrows stay with radios, sliders and selects.
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey) {
      if (t?.closest('[role="radiogroup"], input[type="range"], select')) return
      const i = items.findIndex((it) => it.id === selected)
      const next = items[i + (e.key === 'ArrowRight' ? 1 : -1)]
      if (i >= 0 && next) setSelected(next.id)
      e.preventDefault()
      return
    }
    if (!editing) {
      if (key === 'e' && !e.shiftKey) {
        changeView('edit')
        e.preventDefault()
      }
      return
    }
    if (e.key === 'Escape') {
      changeView('compare')
      e.preventDefault()
      return
    }
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

  // The framed render counts for the panel only once it matches everything picked now.
  const framedReady =
    framed !== null &&
    frame !== 'photo' &&
    framed.id === selected &&
    framed.fill === fill &&
    framed.version === editVersion &&
    framed.format === format &&
    framed.frame === frame &&
    framed.shadow === shadowId
  const photoSize = current?.result
    ? { width: current.result.original.width, height: current.result.original.height }
    : null

  const pending = items.find((i) => i.state === 'processing') ?? items.find((i) => i.state === 'queued')
  // The first look fades only over its own image: anything else selected means it has nothing to fade over.
  useEffect(() => {
    if (fade && selected !== fade.id && items.some((i) => i.id === selected)) releaseLook(fade.id)
  }, [fade, selected, items, releaseLook])
  const fadeOver = showCompare && fade && fade.id === selected ? fade : null
  const hasItems = items.length > 0

  return (
    <div className="app" {...(hasItems && !how.isOpen ? intake.dragProps : {})}>
      {intake.picker}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <input
        ref={imageInput}
        type="file"
        accept={ACCEPT_ATTR}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // so picking the same file again still fires
          void pickImage(file)
        }}
      />

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
              <button type="button" className="button button--quiet header__add" onClick={intake.open}>
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
          <Appearance
            theme={theme.theme}
            mode={theme.mode}
            onMode={theme.setMode}
            accent={accent.accent}
            onAccent={accent.setAccent}
          />
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
              <ModelLine status={status} progress={progress} error={error} retrying={retrying} onRetry={retryLoad} />
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
            <h1 className="sr-only">Cameo</h1>
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
                    blurUrl={blurUrl}
                    imageUrls={imageUrls}
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
                  <div className="fade-stack">
                    <Compare
                      key={selected}
                      before={current.url}
                      after={after.url}
                      width={current.result.original.width}
                      height={current.result.original.height}
                      reveal={reveal}
                      name={selectedItem?.name}
                    />
                    {fadeOver && (
                      <DraftFade key={fadeOver.id} look={fadeOver} onDone={() => releaseLook(fadeOver.id)} />
                    )}
                  </div>
                ) : selectedItem?.state === 'error' ? (
                  <Failure name={selectedItem.name} message={selectedItem.error} onRetry={intake.open} />
                ) : pending ? (
                  <Pending
                    item={pending}
                    status={status}
                    progress={progress}
                    look={look?.id === pending.id ? look : null}
                    retrying={retrying}
                    onRetry={retryLoad}
                  />
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
                blurUrl={blurUrl}
                imageUrls={imageUrls}
                lastImage={lastImage}
                onPickImage={() => imageInput.current?.click()}
                custom={custom}
                onFill={changeFill}
                onCustom={changeCustom}
                onDownload={save}
                diagnostics={diagnostics}
                timings={timings}
                draftMs={draftMs}
                fellBack={fellBack}
                onRetryGpu={retryGpu}
                scaled={selectedItem?.scaled}
                share={shareFiles}
                format={format}
                onFormat={setFormat}
                frame={frame}
                onFrame={setFrame}
                shadow={shadow}
                onShadow={setShadow}
                preview={framedReady ? framed.url : null}
                outSize={
                  frame === 'photo' ? photoSize : framedReady ? { width: framed.width, height: framed.height } : null
                }
                webp={webp}
                doneCount={doneCount}
                onDownloadAll={saveAll}
                onSticker={saveSticker}
                zipping={zipping}
                onShortcuts={() => setShortcutsOpen(true)}
              />
            ) : (
              <aside className="panel panel--waiting">
                <p className="panel__hint">Background colours and the download appear here once a cut-out is ready.</p>
              </aside>
            )}
          </main>
        )}

        <Shortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} isMac={isMac} />

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
    <span className="pill" data-status={status}>
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

function ModelLine({
  status,
  progress,
  error,
  retrying,
  onRetry,
}: {
  status: Status
  progress: number
  error: string | null
  retrying: { attempt: number; of: number } | null
  onRetry: () => void
}) {
  if (status === 'error') {
    return (
      <div className="model model--error" role="alert">
        <AlertIcon width={16} height={16} />
        <span className="model__text">
          The background remover couldn't load{error ? ` (${error})` : ''}. Check your connection, then try again.
        </span>
        <button type="button" className="button button--quiet button--sm" onClick={onRetry}>
          Try again
        </button>
      </div>
    )
  }
  if (status === 'idle' || status === 'loading') {
    return (
      <div className="model">
        <span className="model__text">
          {retrying ? (
            <>
              <Spinner /> Connection dropped. Trying again ({retrying.attempt} of {retrying.of})…
            </>
          ) : (
            <SetupText progress={progress} download />
          )}
        </span>
        <span
          className="bar"
          role="progressbar"
          aria-label="Setting up"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
        >
          <span className="bar__fill" style={{ transform: `scaleX(${Math.max(0.02, progress)})` }} />
        </span>
      </div>
    )
  }
  return (
    <div className="model model--ready">
      <span className="model__live" aria-hidden />
      <span className="model__text">Ready. Next time it starts without the download.</span>
    </div>
  )
}

function Pending({
  item,
  status,
  progress,
  look,
  retrying,
  onRetry,
}: {
  item: Item
  status: Status
  progress: number
  look: Look | null
  retrying: { attempt: number; of: number } | null
  onRetry: () => void
}) {
  const waiting = status === 'idle' || status === 'loading'
  return (
    <div className="pending">
      {look ? (
        <div className="draft" style={{ '--ratio': look.ratio, aspectRatio: look.ratio } as CSSProperties}>
          <img className="draft__img" src={look.url} alt="" draggable={false} />
        </div>
      ) : (
        <div className="pending__frame">
          <img className="pending__img" src={item.thumb} alt="" draggable={false} />
          <span className="pending__scan" aria-hidden="true" />
        </div>
      )}
      <p className="pending__caption">
        {status === 'error' ? (
          <>
            <AlertIcon width={16} height={16} />
            The background remover couldn't load.
            <button type="button" className="button button--quiet button--sm" onClick={onRetry}>
              Try again
            </button>
          </>
        ) : retrying ? (
          <>
            <Spinner />
            Connection dropped. Trying again ({retrying.attempt} of {retrying.of})…
          </>
        ) : (
          <>
            <Spinner />
            {waiting ? <SetupText progress={progress} /> : look ? 'Sharpening edges…' : 'Removing background…'}
          </>
        )}
      </p>
    </div>
  )
}

/** The first look, laid over the sharp cut-out and faded away; with reduced motion it just goes. */
function DraftFade({ look, onDone }: { look: Look; onDone: () => void }) {
  const [out, setOut] = useState(false)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return onDone()
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setOut(true)))
    return () => cancelAnimationFrame(frame)
    // `onDone` is a new function each render; it is only called once, when the fade ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div
      className={`draft draft--fade${out ? ' draft--out' : ''}`}
      style={{ '--ratio': look.ratio, aspectRatio: look.ratio } as CSSProperties}
      aria-hidden="true"
      onTransitionEnd={onDone}
    >
      <img className="draft__img" src={look.url} alt="" draggable={false} />
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
