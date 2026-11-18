import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'

import { ACCEPT_ATTR, isAcceptedImage } from '../lib/decode'

const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files')

/**
 * File intake for the whole app: a hidden picker, paste anywhere, and file drops anywhere in
 * the window while `enabled`. `onReject` gets the names of files that aren't images.
 */
export function useFileIntake(onFiles: (files: File[]) => void, onReject: (names: string[]) => void, enabled: boolean) {
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

  // Whole-window drag and drop: the overlay and the drop work on every screen.
  useEffect(() => {
    if (!enabled) {
      depth.current = 0
      setOver(false)
      return
    }
    let watchdog: number | undefined
    const reset = () => {
      window.clearTimeout(watchdog)
      depth.current = 0
      setOver(false)
    }
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current++
      setOver(true)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      // The watchdog may have fired mid-drag (a still cursor only gets a dragover every ~350 ms
      // in Firefox/Safari), and dragenter won't fire again: a live dragover restores the overlay.
      // setOver(true) is a no-op when already over.
      depth.current = Math.max(depth.current, 1)
      setOver(true)
      // dragover fires continuously while hovering; silence means the drag ended unseen.
      window.clearTimeout(watchdog)
      watchdog = window.setTimeout(reset, 1000)
    }
    const onLeave = () => {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      reset()
      accept(e.dataTransfer?.files ?? [])
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', reset)
    window.addEventListener('blur', reset)
    return () => {
      window.clearTimeout(watchdog)
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', reset)
      window.removeEventListener('blur', reset)
    }
  }, [enabled, accept])

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
    picker,
  }
}
