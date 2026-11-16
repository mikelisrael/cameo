import { useCallback, useEffect, useRef, useState } from 'react'
import { Compare } from './components/Compare'
import { DropZone } from './components/DropZone'
import { Queue, type Item } from './components/Queue'
import { Toolbar, type Background } from './components/Toolbar'
import { cutout, downloadName, exportPng } from './lib/compose'
import { useRemover, type Result } from './lib/useRemover'

type Entry = { file: File; url: string; result?: Result }

export default function App() {
  const { status, progress, device, error, process } = useRemover()
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [background, setBackground] = useState<Background>('transparent')
  const [color, setColor] = useState('#ff0000')
  const [afterUrl, setAfterUrl] = useState<string | null>(null)
  const entries = useRef(new Map<string, Entry>())

  const fill =
    background === 'transparent' ? undefined : background === 'custom' ? color : background === 'white' ? '#ffffff' : '#000000'

  const patch = useCallback(
    (id: string, p: Partial<Item>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i))),
    [],
  )

  const onFiles = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const id = crypto.randomUUID()
        const url = URL.createObjectURL(file)
        entries.current.set(id, { file, url })
        setItems((list) => [...list, { id, name: file.name, state: 'queued', thumb: url }])
        process(file, () => patch(id, { state: 'processing' }))
          .then((result) => {
            const e = entries.current.get(id)
            if (e) e.result = result
            patch(id, { state: 'done' })
            setSelected((s) => s ?? id)
          })
          .catch((err: Error) => patch(id, { state: 'error', error: err.message }))
      }
    },
    [process, patch],
  )

  // Preview of the selected cut-out with the chosen background.
  const selectedDone = items.find((i) => i.id === selected)?.state === 'done'
  useEffect(() => {
    const r = selected ? entries.current.get(selected)?.result : undefined
    if (!r) return
    let url: string | null = null
    let cancelled = false
    cutout(r.original, r.mask, fill).toBlob((b) => {
      if (cancelled || !b) return
      url = URL.createObjectURL(b)
      setAfterUrl(url)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [selected, selectedDone, fill])

  const download = useCallback(
    async (id: string) => {
      const e = entries.current.get(id)
      if (!e?.result) return
      const blob = await exportPng(e.result.original, e.result.mask, fill)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = downloadName(e.file.name)
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    },
    [fill],
  )

  const current = selected ? entries.current.get(selected) : undefined

  return (
    <main className="app">
      <h1>Cutout</h1>
      <p>Remove image backgrounds in your browser. Images never leave your device.</p>

      {status === 'loading' || status === 'idle' ? (
        <div className="progress">
          <label>
            Downloading model (first use only) <progress value={progress} max={1} /> {Math.round(progress * 100)}%
          </label>
        </div>
      ) : null}
      {status === 'ready' || status === 'processing' ? (
        <p className="status">
          Model ready{device ? ` (${device})` : ''}
          {status === 'processing' ? ' - processing...' : ''}
        </p>
      ) : null}
      {error && (
        <p className="error" role="alert">
          Error: {error}
        </p>
      )}

      <DropZone onFiles={onFiles} />
      <Queue items={items} selected={selected} onSelect={setSelected} onDownload={download} />

      {current?.result && afterUrl && (
        <>
          <Compare
            before={current.url}
            after={afterUrl}
            width={current.result.original.width}
            height={current.result.original.height}
          />
          <Toolbar
            background={background}
            color={color}
            onBackground={setBackground}
            onColor={setColor}
            onDownload={() => selected && download(selected)}
            disabled={!selected}
          />
        </>
      )}
    </main>
  )
}
