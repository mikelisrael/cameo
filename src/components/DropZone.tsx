import { useCallback, useEffect, useRef, useState } from 'react'

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp']

export function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const accept = useCallback(
    (list: Iterable<File>) => {
      const files = [...list].filter((f) => ACCEPT.includes(f.type))
      if (files.length) onFiles(files)
    },
    [onFiles],
  )

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])]
      if (files.length) accept(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [accept])

  return (
    <div
      className={`dropzone${over ? ' dropzone--over' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          input.current?.click()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        accept(e.dataTransfer.files)
      }}
    >
      <p>Drop images here, click to choose, or paste (Ctrl/Cmd+V)</p>
      <p className="dropzone__hint">PNG, JPG or WebP</p>
      <input
        ref={input}
        type="file"
        accept={ACCEPT.join(',')}
        multiple
        hidden
        onChange={(e) => {
          accept(e.target.files ?? [])
          e.target.value = ''
        }}
      />
    </div>
  )
}
