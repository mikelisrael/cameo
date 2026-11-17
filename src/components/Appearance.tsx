import { useId, type ReactNode } from 'react'
import { ACCENTS, type Accent } from '../lib/useAccent'
import type { Theme, ThemeMode } from '../lib/useTheme'
import { AutoIcon, CheckIcon, MoonIcon, SunIcon } from './icons'
import { Segmented } from './Segmented'

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <SunIcon /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon /> },
  { value: 'system', label: 'Auto', icon: <AutoIcon /> },
]

/**
 * One button for theme and colour (Israel, 17 November 2026). A native popover, so Esc and a
 * press outside close it and focus returns to the button.
 */
export function Appearance({
  theme,
  mode,
  onMode,
  accent,
  onAccent,
}: {
  theme: Theme
  mode: ThemeMode
  onMode: (m: ThemeMode) => void
  accent: Accent
  onAccent: (a: Accent) => void
}) {
  const id = useId()
  return (
    <div className="appearance">
      <button type="button" className="appearance__trigger" popoverTarget={id} aria-label="Appearance">
        {theme === 'dark' ? <MoonIcon width={16} height={16} /> : <SunIcon width={16} height={16} />}
        <span className="appearance__dot" aria-hidden="true" />
      </button>
      <div id={id} popover="auto" className="appearance__panel" role="dialog" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`} className="appearance__title">
          Appearance
        </h2>
        <div className="appearance__group">
          <span className="appearance__label">Theme</span>
          <Segmented className="seg seg--block" label="Theme" options={THEME_OPTIONS} value={mode} onChange={onMode} />
        </div>
        <div className="appearance__group">
          <span className="appearance__label">Colour</span>
          <Segmented
            className="tones"
            itemClassName="tone"
            label="Colour"
            options={ACCENTS.map((a) => ({
              value: a.value,
              label: a.label,
              icon: (
                <span className="tone__disc" data-accent={a.value} aria-hidden="true">
                  <CheckIcon className="tone__check" width={14} height={14} />
                </span>
              ),
            }))}
            value={accent}
            onChange={onAccent}
          />
        </div>
      </div>
    </div>
  )
}
