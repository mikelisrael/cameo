import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'

import { ACCEPT_ATTR, isAcceptedImage } from '../lib/decode'

const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files')

/**
 * File intake for the whole app: a hidden picker, paste anywhere, and drag props for any
 * element that should take a drop. `onReject` gets the names of files that aren't images.
 */
export function useFileIntake(onFiles: (files: File[]) => void, onReject: (names: string[]) => void) {
  const input = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const depth = useRef(0)
  const [over, setOver] = useState(false)

  const accept = useCallback(
    (list: Iterable<File>) => {
      const all = [...list]
      const files = all.filter(isAcceptedImage)
      const rejected = all.filter((f) => !isAcceptedImage(f)).map((f) => f.name)
      if (files.length) onFiles(files)
      if (rejected.length) onReject(rejected)
    },
    [onFiles, onReject],
  )

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])]
      if (files.length) accept(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [accept])

  const dragProps = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current++
      setOver(true)
    },
    onDragOver: (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      depth.current = 0
      setOver(false)
      accept(e.dataTransfer.files)
    },
  }

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    accept(e.target.files ?? [])
    e.target.value = ''
  }

  // Two hidden inputs: the file picker, and the camera (phones open it straight away).
  const picker = (
    <>
      <input ref={input} type="file" accept={ACCEPT_ATTR} multiple hidden onChange={onChange} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onChange} />
    </>
  )

  return {
    open: () => input.current?.click(),
    openCamera: () => camera.current?.click(),
    over,
    dragProps,
    picker,
  }
}
