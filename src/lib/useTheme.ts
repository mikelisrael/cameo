import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
/** What the person picked: a fixed theme, or 'system' to follow the device. */
export type ThemeMode = Theme | 'system'

const KEY = 'cutout:theme'

function saved(): Theme | null {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : null
  } catch {
    return null
  }
}

/** Lets colours ease for a moment, so a theme or accent change fades instead of snapping. */
export function easeColours() {
  const root = document.documentElement
  root.classList.add('theme-switching')
  window.setTimeout(() => root.classList.remove('theme-switching'), 320)
}

/** The page colour comes from the tokens, so the browser bar matches any theme and accent. */
export function syncThemeColor() {
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim()
  if (paper) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', paper)
}

function apply(theme: Theme) {
  easeColours()
  document.documentElement.dataset.theme = theme
  syncThemeColor()
}

/**
 * Light, dark or auto. index.html sets the first value before paint (saved choice, else the system's),
 * so there is no flash. Until someone picks Light or Dark, the app follows the system as it changes.
 */
export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => saved() ?? 'system')
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  )

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (saved()) return
      const next: Theme = mq.matches ? 'dark' : 'light'
      apply(next)
      setTheme(next)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const setMode = useCallback((next: ThemeMode) => {
    try {
      if (next === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, next)
    } catch {
      // Private mode: the choice still works for this visit.
    }
    const resolved: Theme =
      next === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : next
    apply(resolved)
    setTheme(resolved)
    setModeState(next)
  }, [])

  return { theme, mode, setMode }
}
