import { useCallback, useEffect, useRef, useState } from 'react'
import { cutout } from '../lib/compose'
import { ACCEPT_ATTR, isAcceptedImage } from '../lib/decode'
import { DEFAULT_REFINE, type RefineOptions } from '../lib/protocol'
import { useRemover } from '../lib/useRemover'

type Bg = 'checker' | 'white' | 'black' | 'green'
const BACKGROUNDS: { id: Bg; label: string }[] = [
  { id: 'checker', label: 'Checker' },
  { id: 'white', label: 'White' },
  { id: 'black', label: 'Black' },
  { id: 'green', label: 'Green' },
]

/** The zoomed crops show this many photo pixels per side, at 2x. */
const CROP = 200
const CROP_OUT = 400

type Assets = {
  width: number
  height: number
  original: ImageBitmap
  raw: HTMLCanvasElement
  refined: HTMLCanvasElement
  urls: { original: string; raw: string; refined: string }
}

type Row = {
  id: string
  file: File
  state: 'queued' | 'working' | 'done' | 'error'
  error?: string
  assets?: Assets
  focus: { x: number; y: number }
}

const release = (a?: Assets) => {
  if (!a) return
  for (const u of Object.values(a.urls)) URL.revokeObjectURL(u)
  a.original.close()
}

const toUrl = (canvas: HTMLCanvasElement) =>
  new Promise<string>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('Could not render the cut-out'))),
      'image/png',
    ),
  )

export default function Bench() {
  const { status, progress, diagnostics, error, process } = useRemover()
  const [rows, setRows] = useState<Row[]>([])
  const [bg, setBg] = useState<Bg>('checker')
  const [options, setOptions] = useState<RefineOptions>(DEFAULT_REFINE)
  const [notice, setNotice] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const rowsRef = useRef<Row[]>([])
  const optionsRef = useRef(options)
  const gens = useRef(new Map<string, number>())
  const counter = useRef(0)
  const folderRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    rowsRef.current = rows
  }, [rows])
  useEffect(() => {
    optionsRef.current = options
  }, [options])
  useEffect(() => {
    folderRef.current?.setAttribute('webkitdirectory', '')
  }, [])
  useEffect(
    () => () => {
      gens.current.clear()
      for (const r of rowsRef.current) release(r.assets)
    },
    [],
  )

  const patch = useCallback(
    (id: string, p: Partial<Row>) => setRows((list) => list.map((r) => (r.id === id ? { ...r, ...p } : r))),
    [],
  )

  const run = useCallback(
    (id: string, file: File) => {
      const gen = ++counter.current
      gens.current.set(id, gen)
      const current = () => gens.current.get(id) === gen
      patch(id, { state: 'queued', error: undefined })
      process(
        file,
        () => current() && patch(id, { state: 'working' }),
        () => !current(),
        undefined,
        { options: optionsRef.current, compare: true },
      )
        .then(async (result) => {
          if (!current()) {
            result.original.close()
            URL.revokeObjectURL(result.url)
            return
          }
          const raw = cutout(result.original, result.raw ?? result.mask)
          const refined = cutout(result.original, result.mask, undefined, result.colors)
          const [a, b] = await Promise.all([toUrl(raw), toUrl(refined)])
          const assets: Assets = {
            width: result.original.width,
            height: result.original.height,
            original: result.original,
            raw,
            refined,
            urls: { original: result.url, raw: a, refined: b },
          }
          if (!current()) return release(assets)
          release(rowsRef.current.find((r) => r.id === id)?.assets)
          patch(id, { state: 'done', assets })
        })
        .catch((err: Error) => {
          if (current() && err.message !== 'Cancelled') patch(id, { state: 'error', error: err.message })
        })
    },
    [process, patch],
  )

  const add = useCallback(
    (files: File[]) => {
      const ok = files.filter(isAcceptedImage)
      if (ok.length < files.length) setNotice(`${files.length - ok.length} file(s) skipped: not photos Cameo can open.`)
      else setNotice(null)
      const fresh: Row[] = ok.map((file) => ({
        id: crypto.randomUUID(),
        file,
        state: 'queued',
        focus: { x: 0.5, y: 0.5 },
      }))
      setRows((list) => [...list, ...fresh])
      for (const r of fresh) run(r.id, r.file)
    },
    [run],
  )

  const clear = () => {
    gens.current.clear()
    for (const r of rowsRef.current) release(r.assets)
    setRows([])
    setNotice(null)
  }

  const runAgain = () => {
    for (const r of rowsRef.current) run(r.id, r.file)
  }

  // Dropping files anywhere on the page.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setOver(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setOver(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      setOver(false)
      add([...(e.dataTransfer?.files ?? [])])
    }
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [add])

  const picked = (e: React.ChangeEvent<HTMLInputElement>) => {
    add([...(e.target.files ?? [])])
    e.target.value = ''
  }

  const detail = -Math.log10(options.eps)

  return (
    <div className={`bench${over ? ' bench--over' : ''}`} data-bg={bg}>
      <header className="bench-head">
        <h1 className="wordmark bench-title">Cameo bench</h1>
        <p className="bench-muted">
          Drop the same folder of photos each time to judge a change. Nothing leaves this device.
        </p>
        <p className="bench-muted">
          A good set: products on clutter, hair, fur, glass, jewellery, people at night, low light, flat lays.
        </p>
        <p className="bench-status mono" role="status">
          {status === 'error'
            ? `The model couldn't load${error ? ` (${error})` : ''}`
            : !diagnostics
              ? `Loading the model · ${Math.round(progress * 100)}%`
              : diagnostics.device === 'webgpu'
                ? `Running on graphics card (WebGPU) · ${diagnostics.size} px`
                : `Running on processor · ${diagnostics.size} px`}
        </p>
        <div className="bench-pick">
          <label className="button button--primary">
            Choose photos
            <input type="file" multiple accept={ACCEPT_ATTR} className="bench-file" onChange={picked} />
          </label>
          <label className="button button--quiet">
            Choose a folder
            <input ref={folderRef} type="file" multiple className="bench-file" onChange={picked} />
          </label>
        </div>
        {notice && (
          <p className="bench-notice" role="status">
            {notice}
          </p>
        )}
      </header>

      <div className="bench-bar">
        <div className="bench-seg" role="radiogroup" aria-label="Background">
          {BACKGROUNDS.map((b) => (
            <button
              key={b.id}
              type="button"
              role="radio"
              aria-checked={bg === b.id}
              className="bench-seg__btn"
              onClick={() => setBg(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>
        <label className="bench-check">
          <input
            type="checkbox"
            checked={options.decontaminate}
            onChange={(e) => setOptions((o) => ({ ...o, decontaminate: e.target.checked }))}
          />
          Decontaminate
        </label>
        <label className="bench-check">
          <input
            type="checkbox"
            checked={options.refine}
            onChange={(e) => setOptions((o) => ({ ...o, refine: e.target.checked }))}
          />
          Edge refine
        </label>
        <label className="bench-slider">
          <span>
            Detail <span className="mono bench-muted">{options.eps.toExponential(1)}</span>
          </span>
          <input
            type="range"
            min={1}
            max={4}
            step="any"
            value={detail}
            aria-label="Detail, softer to sharper"
            onChange={(e) => setOptions((o) => ({ ...o, eps: 10 ** -Number(e.target.value) }))}
          />
        </label>
        <label className="bench-slider">
          <span>
            Reach <span className="mono bench-muted">{options.radius}</span>
          </span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.5}
            value={options.radius}
            aria-label="Reach"
            onChange={(e) => setOptions((o) => ({ ...o, radius: Number(e.target.value) }))}
          />
        </label>
        <button type="button" className="button button--quiet bench-btn" onClick={runAgain} disabled={!rows.length}>
          Run again
        </button>
        <button type="button" className="button button--ghost bench-btn" onClick={clear} disabled={!rows.length}>
          Clear
        </button>
      </div>

      <main className="bench-rows">
        {rows.length === 0 && <p className="bench-empty">Drop photos or a folder anywhere on this page.</p>}
        {rows.map((r) => (
          <BenchRow key={r.id} row={r} onFocus={(x, y) => patch(r.id, { focus: { x, y } })} />
        ))}
      </main>
    </div>
  )
}

function BenchRow({ row, onFocus }: { row: Row; onFocus: (x: number, y: number) => void }) {
  const a = row.assets
  const panels = a
    ? ([
        ['Original', a.urls.original],
        ['Model only', a.urls.raw],
        ['Refined', a.urls.refined],
      ] as const)
    : []

  const click = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!a) return
    const box = e.currentTarget.getBoundingClientRect()
    // The photo sits centred inside the panel (object-fit: contain): measure against its own area.
    const k = Math.min(box.width / a.width, box.height / a.height)
    const w = a.width * k
    const h = a.height * k
    const x = (e.clientX - box.left - (box.width - w) / 2) / w
    const y = (e.clientY - box.top - (box.height - h) / 2) / h
    onFocus(Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)))
  }

  return (
    <section className="bench-row">
      <h2 className="bench-row__name">
        <span className="bench-row__file">{row.file.name}</span>
        {a && <span className="mono bench-muted">{`${a.width} × ${a.height}`}</span>}
        {(row.state === 'queued' || row.state === 'working') && (
          <span className="bench-muted" role="status">
            {row.state === 'working' ? 'Working…' : 'Waiting…'}
          </span>
        )}
      </h2>
      {row.state === 'error' && (
        <p className="bench-error" role="alert">
          {row.error}
        </p>
      )}
      {a && (
        <>
          <div className="bench-grid">
            {panels.map(([label, url]) => (
              <figure key={label} className="bench-fig">
                <figcaption>{label}</figcaption>
                <button
                  type="button"
                  className="bench-panel"
                  onClick={click}
                  aria-label={`${label}: pick the point to zoom in on`}
                >
                  <img src={url} alt="" draggable={false} />
                </button>
              </figure>
            ))}
          </div>
          <div className="bench-grid">
            <Crop label="Original, zoomed" source={a.original} a={a} focus={row.focus} />
            <Crop label="Model only, zoomed" source={a.raw} a={a} focus={row.focus} />
            <Crop label="Refined, zoomed" source={a.refined} a={a} focus={row.focus} />
          </div>
        </>
      )}
    </section>
  )
}

function Crop({
  label,
  source,
  a,
  focus,
}: {
  label: string
  source: CanvasImageSource
  a: Assets
  focus: { x: number; y: number }
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current?.getContext('2d')
    if (!c) return
    const sw = Math.min(CROP, a.width)
    const sh = Math.min(CROP, a.height)
    const sx = Math.min(a.width - sw, Math.max(0, Math.round(focus.x * a.width - sw / 2)))
    const sy = Math.min(a.height - sh, Math.max(0, Math.round(focus.y * a.height - sh / 2)))
    c.clearRect(0, 0, CROP_OUT, CROP_OUT)
    c.imageSmoothingEnabled = false
    c.drawImage(source, sx, sy, sw, sh, 0, 0, (sw * CROP_OUT) / CROP, (sh * CROP_OUT) / CROP)
  }, [source, a.width, a.height, focus.x, focus.y])
  return (
    <figure className="bench-fig">
      <figcaption>{label}</figcaption>
      <canvas ref={ref} className="bench-crop" width={CROP_OUT} height={CROP_OUT} aria-label={label} />
    </figure>
  )
}
