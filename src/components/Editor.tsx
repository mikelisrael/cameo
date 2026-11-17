import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  type SVGProps,
} from 'react'
import { cssBackground } from '../lib/background'
import { Stroke, type MaskPatch, type Rect } from '../lib/brush'
import type { Mask } from '../lib/protocol'

export type Tool = 'move' | 'select' | 'erase' | 'restore'
export type BrushSettings = { size: number; softness: number; smart: boolean }
export type EditorHandle = { zoomIn(): void; zoomOut(): void; fit(): void }

type Props = {
  original: ImageBitmap
  mask: Mask
  colors?: Uint8ClampedArray
  fill: string | null
  /** Object URL of the blurred photo, and of the pictures the user picked, for those backgrounds. */
  blurUrl?: string | null
  imageUrls?: Map<string, string>
  tool: Tool
  brush: BrushSettings
  showOriginal: boolean
  onShowOriginal: (show: boolean) => void
  version: number
  onStroke: (patch: MaskPatch) => void
  onTap?: (p: { x: number; y: number }) => void
  pending?: { x: number; y: number } | null
  still?: boolean // take no input (the editor stays up while Compare catches up)
  ref?: Ref<EditorHandle>
}

type View = { x: number; y: number; s: number }
type Mode = 'none' | 'pan' | 'paint' | 'pinch'

const PAD = 32
const KEEP = 0.25
const STEP = 1.5
const GLIDE_MS = 240

const svg = (p: SVGProps<SVGSVGElement>) => ({
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
})

const MinusGlyph = () => (
  <svg {...svg({})}>
    <path d="M5 12h14" />
  </svg>
)

const PlusGlyph = () => (
  <svg {...svg({})}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

export function Editor({
  original,
  mask,
  colors,
  fill,
  blurUrl,
  imageUrls,
  tool,
  brush,
  showOriginal,
  onShowOriginal,
  version,
  onStroke,
  onTap,
  pending,
  still,
  ref,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const tapElRef = useRef<HTMLSpanElement>(null)
  const pendingRef = useRef(pending)
  pendingRef.current = pending
  const tapStart = useRef<{ id: number; x: number; y: number; ok: boolean } | null>(null)
  const bgRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef<HTMLCanvasElement>(null)
  const cutRef = useRef<HTMLCanvasElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)

  const [pct, setPct] = useState(100)

  const view = useRef<View>({ x: 0, y: 0, s: 1 })
  const geo = useRef({ vw: 0, vh: 0, mw: mask.width, mh: mask.height, ow: original.width })
  const touched = useRef(false)
  const pctRaf = useRef(0)
  const flushRaf = useRef(0)

  const img = useRef<ImageData | null>(null)
  const guide = useRef<ImageData | null>(null)
  const dirty = useRef<Rect | null>(null)

  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const mode = useRef<Mode>('none')
  const paintId = useRef(-1)
  const stroke = useRef<Stroke | null>(null)
  const pinch = useRef({ mx: 0, my: 0, d: 1 })
  const hover = useRef({ x: 0, y: 0, inside: false, type: 'mouse' })

  /* ---------- view ---------- */

  const limits = () => {
    const { vw, vh, mw, mh } = geo.current
    const fit = Math.max(0.01, Math.min((vw - PAD) / mw, (vh - PAD) / mh))
    return { fit, min: fit, max: Math.max(8, fit * 2) }
  }

  const applyView = useCallback(() => {
    const { x, y, s } = view.current
    const { mw, mh, ow } = geo.current
    const world = worldRef.current
    const bg = bgRef.current
    const tapEl = tapElRef.current
    const tapAt = pendingRef.current
    if (tapEl && tapAt) {
      tapEl.style.left = `${x + tapAt.x * s}px`
      tapEl.style.top = `${y + tapAt.y * s}px`
    }
    if (world) {
      world.style.transform = `translate(${x}px, ${y}px) scale(${s})`
      world.classList.toggle('editor__world--pixels', s > 2)
    }
    if (bg) {
      bg.style.left = `${x}px`
      bg.style.top = `${y}px`
      bg.style.width = `${mw * s}px`
      bg.style.height = `${mh * s}px`
    }
    if (!pctRaf.current) {
      pctRaf.current = requestAnimationFrame(() => {
        pctRaf.current = 0
        setPct(Math.round(((view.current.s * mw) / ow) * 100))
      })
    }
  }, [])

  // A glide eases the view to a target for discrete zooms (buttons, keys, wheel notches, fit).
  // Direct manipulation (pan, pinch, trackpad) stays 1:1 and cancels any glide.
  const glide = useRef<{ raf: number; to: View | null }>({ raf: 0, to: null })
  const stopGlide = useCallback(() => {
    cancelAnimationFrame(glide.current.raf)
    glide.current = { raf: 0, to: null }
  }, [])
  const glideTo = useCallback(
    (to: View) => {
      stopGlide()
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        view.current = to
        applyView()
        return
      }
      const from = { ...view.current }
      const t0 = performance.now()
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / GLIDE_MS)
        const e = 1 - (1 - t) ** 3
        view.current = {
          s: from.s * (to.s / from.s) ** e,
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e,
        }
        applyView()
        glide.current.raf = t < 1 ? requestAnimationFrame(step) : 0
        if (t === 1) glide.current.to = null
      }
      glide.current = { raf: requestAnimationFrame(step), to }
    },
    [applyView, stopGlide],
  )

  const clampPan = useCallback((v: View = view.current) => {
    const { vw, vh, mw, mh } = geo.current
    const iw = mw * v.s
    const ih = mh * v.s
    v.x = Math.min(vw - KEEP * iw, Math.max(-(1 - KEEP) * iw, v.x))
    v.y = Math.min(vh - KEEP * ih, Math.max(-(1 - KEEP) * ih, v.y))
  }, [])

  const fit = useCallback(
    (animate = false) => {
      const { vw, vh, mw, mh } = geo.current
      const { fit: s } = limits()
      const to = { s, x: (vw - mw * s) / 2, y: (vh - mh * s) / 2 }
      touched.current = false
      if (animate) return glideTo(to)
      stopGlide()
      view.current = to
      applyView()
    },
    [applyView, glideTo, stopGlide],
  )

  const zoomAt = useCallback(
    (cx: number, cy: number, factor: number, animate = false) => {
      // Stacked discrete zooms build on where the running glide is heading, not where it is now.
      const v = { ...(animate && glide.current.to ? glide.current.to : view.current) }
      const { min, max } = limits()
      const s = Math.min(max, Math.max(min, v.s * factor))
      const k = s / v.s
      v.x = cx - (cx - v.x) * k
      v.y = cy - (cy - v.y) * k
      v.s = s
      touched.current = true
      clampPan(v)
      if (animate) return glideTo(v)
      stopGlide()
      view.current = v
      applyView()
    },
    [applyView, clampPan, glideTo, stopGlide],
  )

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomAt(geo.current.vw / 2, geo.current.vh / 2, STEP, true),
      zoomOut: () => zoomAt(geo.current.vw / 2, geo.current.vh / 2, 1 / STEP, true),
      fit: () => fit(true),
    }),
    [zoomAt, fit],
  )

  // Place the pending-tap marker when it appears or moves.
  useLayoutEffect(() => {
    applyView()
  }, [pending, applyView])

  // Measure the viewport; fit again on resize unless the user has moved the view since the last fit.
  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => {
      geo.current.vw = el.clientWidth
      geo.current.vh = el.clientHeight
    }
    measure()
    fit()
    const ro = new ResizeObserver(() => {
      measure()
      // A hidden editor (e.g. behind the How it works page) measures 0×0; leave the view as it was.
      if (!geo.current.vw || !geo.current.vh) return
      if (!touched.current) {
        fit()
        return
      }
      const { min, max } = limits()
      view.current.s = Math.min(max, Math.max(min, view.current.s))
      clampPan()
      applyView()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit, applyView, clampPan])

  // A different image or mask size starts fitted.
  useLayoutEffect(() => {
    geo.current.mw = mask.width
    geo.current.mh = mask.height
    geo.current.ow = original.width
    fit()
  }, [mask.width, mask.height, original, fit])

  // Wheel: a non-passive listener so the page does not scroll or pinch-zoom under the editor.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      // A mouse wheel moves in notches (line mode or big pixel steps): glide those. Trackpads stay direct.
      const notch = !e.ctrlKey && (e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50)
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), notch)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  /* ---------- pixels ---------- */

  const getGuide = () => {
    if (!guide.current) {
      const ctx = ghostRef.current?.getContext('2d')
      guide.current = ctx ? ctx.getImageData(0, 0, mask.width, mask.height) : null
    }
    return guide.current
  }

  // The photo at mask size, once per image.
  useLayoutEffect(() => {
    const c = ghostRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    c.width = mask.width
    c.height = mask.height
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(original, 0, 0, mask.width, mask.height)
    guide.current = null
  }, [original, mask.width, mask.height])

  // The whole display buffer, from the mask and the clean colours.
  useLayoutEffect(() => {
    const c = cutRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const { width: w, height: h, data } = mask
    c.width = w
    c.height = h
    const out = new ImageData(w, h)
    const useColors = colors && colors.length === w * h * 4
    const src = useColors ? colors : getGuide()?.data
    const px = out.data
    for (let i = 0, n = w * h; i < n; i++) {
      const o = i * 4
      if (src) {
        px[o] = src[o]
        px[o + 1] = src[o + 1]
        px[o + 2] = src[o + 2]
      }
      px[o + 3] = data[i]
    }
    img.current = out
    dirty.current = null
    ctx.putImageData(out, 0, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mask, colors, version, original])

  const flush = useCallback(() => {
    flushRaf.current = 0
    const r = dirty.current
    const out = img.current
    const ctx = cutRef.current?.getContext('2d')
    dirty.current = null
    if (!r || !out || !ctx) return
    const { width: w, data } = out
    const alpha = mask.data
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) data[(y * w + x) * 4 + 3] = alpha[y * w + x]
    }
    ctx.putImageData(out, 0, 0, r.x, r.y, r.w, r.h)
  }, [mask])

  const markDirty = (r: Rect | null) => {
    if (!r) return
    dirty.current = union(dirty.current, r)
    if (!flushRaf.current) flushRaf.current = requestAnimationFrame(flush)
  }

  useEffect(
    () => () => {
      cancelAnimationFrame(flushRaf.current)
      cancelAnimationFrame(pctRaf.current)
      cancelAnimationFrame(glide.current.raf)
    },
    [],
  )

  /* ---------- ring and cursor ---------- */

  const syncRing = () => {
    const ring = ringRef.current
    const vp = viewportRef.current
    if (!ring || !vp) return
    const h = hover.current
    const m = mode.current
    const show =
      tool !== 'move' &&
      tool !== 'select' &&
      m !== 'pan' &&
      m !== 'pinch' &&
      (h.type === 'touch' ? m === 'paint' : h.inside)
    ring.style.display = show ? 'block' : 'none'
    if (show) ring.style.transform = `translate(${h.x - brush.size / 2}px, ${h.y - brush.size / 2}px)`
    vp.style.cursor = show
      ? 'none'
      : tool === 'move' || tool === 'select'
        ? m === 'pan'
          ? 'grabbing'
          : tool === 'select'
            ? 'crosshair'
            : 'grab'
        : ''
  }

  useEffect(() => {
    syncRing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, brush.size])

  /* ---------- pointers ---------- */

  const toMask = (clientX: number, clientY: number) => {
    const r = viewportRef.current!.getBoundingClientRect()
    const v = view.current
    return { x: (clientX - r.left - v.x) / v.s, y: (clientY - r.top - v.y) / v.s }
  }

  const trackHover = (e: ReactPointerEvent<HTMLDivElement>, inside: boolean) => {
    const r = e.currentTarget.getBoundingClientRect()
    hover.current = { x: e.clientX - r.left, y: e.clientY - r.top, inside, type: e.pointerType }
  }

  const cancelStroke = () => {
    const s = stroke.current
    stroke.current = null
    paintId.current = -1
    if (s) {
      markDirty(s.cancel())
      flush()
    }
  }

  const pair = () => {
    const [a, b] = [...pointers.current.values()]
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointers.current.size >= 2) return
    const isPrimary = e.button === 0
    if (e.pointerType === 'mouse' && !isPrimary && e.button !== 1) return
    if (e.button === 1) e.preventDefault()
    stopGlide()
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    trackHover(e, true)

    if (pointers.current.size === 2) {
      cancelStroke()
      if (tapStart.current) tapStart.current.ok = false
      mode.current = 'pinch'
      pinch.current = pair()
    } else if (e.button === 1 || tool === 'move' || tool === 'select') {
      mode.current = 'pan'
      tapStart.current =
        tool === 'select' && isPrimary ? { id: e.pointerId, x: e.clientX, y: e.clientY, ok: true } : null
    } else {
      const { x, y } = toMask(e.clientX, e.clientY)
      const radius = Math.max(0.5, brush.size / 2 / view.current.s)
      const s = new Stroke(mask.data, mask.width, mask.height, tool, radius, brush.softness)
      stroke.current = s
      paintId.current = e.pointerId
      mode.current = 'paint'
      markDirty(s.dab(x, y))
    }
    syncRing()
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    trackHover(e, true)
    const prev = pointers.current.get(e.pointerId)
    if (prev) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const ts = tapStart.current
      if (ts && ts.id === e.pointerId && Math.hypot(e.clientX - ts.x, e.clientY - ts.y) >= 6) ts.ok = false
      if (mode.current === 'pan') {
        const v = view.current
        const dx = e.clientX - prev.x
        const dy = e.clientY - prev.y
        // A tap is not a move: only a drag stops resizes from refitting.
        if (dx || dy) touched.current = true
        v.x += dx
        v.y += dy
        clampPan()
        applyView()
      } else if (mode.current === 'pinch' && pointers.current.size === 2) {
        const r = e.currentTarget.getBoundingClientRect()
        const p = pair()
        const last = pinch.current
        zoomAt(last.mx - r.left, last.my - r.top, p.d / last.d)
        view.current.x += p.mx - last.mx
        view.current.y += p.my - last.my
        clampPan()
        applyView()
        pinch.current = p
      } else if (mode.current === 'paint' && stroke.current && e.pointerId === paintId.current) {
        const native = e.nativeEvent
        const list = native.getCoalescedEvents?.()
        for (const ev of list && list.length ? list : [native]) {
          const { x, y } = toMask(ev.clientX, ev.clientY)
          markDirty(stroke.current.dab(x, y))
        }
      }
    }
    syncRing()
  }

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!pointers.current.delete(e.pointerId)) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    const ts = tapStart.current
    if (ts && ts.id === e.pointerId) {
      tapStart.current = null
      if (!cancelled && ts.ok && mode.current === 'pan' && onTap) {
        const p = toMask(e.clientX, e.clientY)
        if (p.x >= 0 && p.y >= 0 && p.x < mask.width && p.y < mask.height) {
          onTap({ x: Math.min(mask.width - 1, Math.floor(p.x)), y: Math.min(mask.height - 1, Math.floor(p.y)) })
        }
      }
    }
    if (e.pointerId === paintId.current && stroke.current) {
      const s = stroke.current
      stroke.current = null
      paintId.current = -1
      if (cancelled) {
        markDirty(s.cancel())
        flush()
      } else {
        const { patch, dirty: r } = s.finish(brush.smart ? { guide: getGuide()!.data } : undefined)
        markDirty(r)
        flush()
        if (patch) onStroke(patch)
      }
    }
    if (pointers.current.size === 0 || mode.current === 'pinch') mode.current = 'none'
    if (e.pointerType === 'touch') hover.current.inside = false
    syncRing()
  }

  const stop = (e: { stopPropagation(): void }) => e.stopPropagation()

  const beforeDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    onShowOriginal(true)
  }

  const ghostOpacity = showOriginal ? 1 : tool === 'move' || tool === 'select' ? 0 : 0.28
  const bgStyle: CSSProperties = cssBackground(fill, { blurUrl, imageUrls })

  return (
    <div
      ref={viewportRef}
      className="editor"
      inert={still}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endPointer(e, false)}
      onPointerCancel={(e) => endPointer(e, true)}
      onPointerLeave={(e) => {
        trackHover(e, false)
        syncRing()
      }}
      onPointerEnter={(e) => {
        trackHover(e, true)
        syncRing()
      }}
      onDoubleClick={() => {
        if (tool === 'move' || tool === 'select') fit(true)
      }}
    >
      <div ref={bgRef} className="editor__bg" style={bgStyle} />
      <div ref={worldRef} className="editor__world" style={{ width: mask.width, height: mask.height }}>
        <canvas ref={ghostRef} className="editor__ghost" style={{ opacity: ghostOpacity }} aria-hidden="true" />
        <canvas
          ref={cutRef}
          className="editor__cut"
          style={{ visibility: showOriginal ? 'hidden' : 'visible' }}
          role="img"
          aria-label="The cut-out you're editing. Paint with a mouse, finger or pen to erase or restore."
        />
      </div>
      {pending && <span ref={tapElRef} className="editor__tap" aria-hidden />}
      <div ref={ringRef} className="editor__cursor" style={{ width: brush.size, height: brush.size }} />

      <div className="editor__zoom" onPointerDown={stop} onDoubleClick={stop}>
        <button
          type="button"
          className="button button--quiet button--icon button--sm"
          aria-label="Zoom out"
          onClick={() => zoomAt(geo.current.vw / 2, geo.current.vh / 2, 1 / STEP, true)}
        >
          <MinusGlyph />
        </button>
        <output className="editor__pct">{pct}%</output>
        <button
          type="button"
          className="button button--quiet button--icon button--sm"
          aria-label="Zoom in"
          onClick={() => zoomAt(geo.current.vw / 2, geo.current.vh / 2, STEP, true)}
        >
          <PlusGlyph />
        </button>
        <button
          type="button"
          className="button button--quiet button--sm"
          aria-label="Fit to screen"
          onClick={() => fit(true)}
        >
          Fit
        </button>
      </div>

      <button
        type="button"
        className="button button--quiet button--sm editor__before"
        aria-pressed={showOriginal}
        onPointerDown={beforeDown}
        onPointerUp={() => onShowOriginal(false)}
        onPointerCancel={() => onShowOriginal(false)}
        onPointerLeave={() => onShowOriginal(false)}
        onLostPointerCapture={() => onShowOriginal(false)}
        onDoubleClick={stop}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onShowOriginal(true)
          }
        }}
        onKeyUp={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onShowOriginal(false)
        }}
      >
        Before
      </button>
    </div>
  )
}
