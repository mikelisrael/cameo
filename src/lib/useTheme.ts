import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'cutout:theme'
const THEME_COLOR: Record<Theme, string> = { light: '#faf6f1', dark: '#120b1b' }

function saved(): Theme | null {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : null
  } catch {
    return null
  }
}

function apply(theme: Theme) {
  const root = document.documentElement
  root.classList.add('theme-switching')
  root.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
  window.setTimeout(() => root.classList.remove('theme-switching'), 320)
}

/**
 * Light or dark. index.html sets the first value before paint (saved choice, else the system's),
 * so there is no flash. Until someone picks, the app follows the system as it changes.
 */
export function useTheme() {
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

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // Private mode: the switch still works for this visit.
    }
    apply(next)
    setTheme(next)
  }, [theme])

  return { theme, toggle }
}
