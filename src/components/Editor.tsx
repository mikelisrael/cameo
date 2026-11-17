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
import { Stroke, type MaskPatch, type Rect } from '../lib/brush'
import type { Mask } from '../lib/protocol'

export type Tool = 'move' | 'erase' | 'restore'
export type BrushSettings = { size: number; softness: number; smart: boolean }
export type EditorHandle = { zoomIn(): void; zoomOut(): void; fit(): void }

type Props = {
  original: ImageBitmap
  mask: Mask
  colors?: Uint8ClampedArray
  fill: string | null
  tool: Tool
  brush: BrushSettings
  showOriginal: boolean
  onShowOriginal: (show: boolean) => void
  version: number
  onStroke: (patch: MaskPatch) => void
  ref?: Ref<EditorHandle>
}

type View = { x: number; y: number; s: number }
type Mode = 'none' | 'pan' | 'paint' | 'pinch'

const PAD = 32
const KEEP = 0.25
const STEP = 1.5

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
  tool,
  brush,
  showOriginal,
  onShowOriginal,
  version,
  onStroke,
  ref,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
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

  const clampPan = useCallback(() => {
    const { vw, vh, mw, mh } = geo.current
    const v = view.current
    const iw = mw * v.s
    const ih = mh * v.s
    v.x = Math.min(vw - KEEP * iw, Math.max(-(1 - KEEP) * iw, v.x))
    v.y = Math.min(vh - KEEP * ih, Math.max(-(1 - KEEP) * ih, v.y))
  }, [])

  const fit = useCallback(() => {
    const { vw, vh, mw, mh } = geo.current
    const { fit: s } = limits()
    view.current = { s, x: (vw - mw * s) / 2, y: (vh - mh * s) / 2 }
    touched.current = false
    applyView()
  }, [applyView])

  const zoomAt = useCallback(
    (cx: number, cy: number, factor: number) => {
      const v = view.current
      const { min, max } = limits()
      const s = Math.min(max, Math.max(min, v.s * factor))
      const k = s / v.s
      v.x = cx - (cx - v.x) * k
      v.y = cy - (cy - v.y) * k
      v.s = s
      touched.current = true
      clampPan()
      applyView()
    },
    [applyView, clampPan],
  )

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomAt(geo.current.vw / 2, geo.current.vh / 2, STEP),
      zoomOut: () => zoomAt(geo.current.vw / 2, geo.current.vh / 2, 1 / STEP),
      fit,
    }),
    [zoomAt, fit],
  )

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
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
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
    const show = tool !== 'move' && m !== 'pan' && m !== 'pinch' && (h.type === 'touch' ? m === 'paint' : h.inside)
    ring.style.display = show ? 'block' : 'none'
    if (show) ring.style.transform = `translate(${h.x - brush.size / 2}px, ${h.y - brush.size / 2}px)`
    vp.style.cursor = show ? 'none' : tool === 'move' ? (m === 'pan' ? 'grabbing' : 'grab') : ''
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
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    trackHover(e, true)

    if (pointers.current.size === 2) {
      cancelStroke()
      mode.current = 'pinch'
      pinch.current = pair()
      touched.current = true
    } else if (e.button === 1 || tool === 'move') {
      mode.current = 'pan'
      touched.current = true
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
      if (mode.current === 'pan') {
        const v = view.current
        v.x += e.clientX - prev.x
        v.y += e.clientY - prev.y
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

  const ghostOpacity = showOriginal ? 1 : tool === 'move' ? 0 : 0.28
  const bgStyle: CSSProperties = fill ? { backgroundColor: fill, backgroundImage: 'none' } : {}

  return (
    <div
      ref={viewportRef}
      className="editor"
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
        if (tool === 'move') fit()
      }}
    >
      <div ref={bgRef} className="editor__bg" style={bgStyle} />
      <div ref={worldRef} className="editor__world" style={{ width: mask.width, height: mask.height }}>
        <canvas ref={ghostRef} className="editor__ghost" style={{ opacity: ghostOpacity }} />
        <canvas ref={cutRef} className="editor__cut" style={{ visibility: showOriginal ? 'hidden' : 'visible' }} />
      </div>
      <div ref={ringRef} className="editor__cursor" style={{ width: brush.size, height: brush.size }} />

      <div className="editor__zoom" onPointerDown={stop} onDoubleClick={stop}>
        <button
          type="button"
          className="button button--quiet button--icon button--sm"
          aria-label="Zoom out"
          onClick={() => zoomAt(geo.current.vw / 2, geo.current.vh / 2, 1 / STEP)}
        >
          <MinusGlyph />
        </button>
        <output className="editor__pct">{pct}%</output>
        <button
          type="button"
          className="button button--quiet button--icon button--sm"
          aria-label="Zoom in"
          onClick={() => zoomAt(geo.current.vw / 2, geo.current.vh / 2, STEP)}
        >
          <PlusGlyph />
        </button>
        <button type="button" className="button button--quiet button--sm" aria-label="Fit to screen" onClick={fit}>
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
