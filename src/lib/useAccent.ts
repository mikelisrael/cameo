import { useCallback, useState } from 'react'
import { easeColours, syncThemeColor } from './useTheme'

/**
 * The accent colour. Persimmon is the default and the brand; the others are a person's own choice
 * (Israel, 17 November 2026). index.html sets a saved one before paint, so there is no flash.
 */
export type Accent = 'persimmon' | 'raspberry' | 'lavender' | 'sage'

export const ACCENTS: { value: Accent; label: string }[] = [
  { value: 'persimmon', label: 'Persimmon' },
  { value: 'raspberry', label: 'Raspberry' },
  { value: 'lavender', label: 'Lavender' },
  { value: 'sage', label: 'Sage' },
]

const KEY = 'cutout:accent'

const isAccent = (a: unknown): a is Accent => ACCENTS.some((o) => o.value === a)

export function useAccent() {
  const [accent, setAccentState] = useState<Accent>(() => {
    const a = document.documentElement.dataset.accent
    return isAccent(a) ? a : 'persimmon'
  })

  const setAccent = useCallback((next: Accent) => {
    const root = document.documentElement
    easeColours()
    if (next === 'persimmon') delete root.dataset.accent
    else root.dataset.accent = next
    syncThemeColor()
    try {
      if (next === 'persimmon') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, next)
    } catch {
      // Private mode: the choice still works for this visit.
    }
    setAccentState(next)
  }, [])

  return { accent, setAccent }
}
