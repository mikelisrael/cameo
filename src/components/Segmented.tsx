import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'

/** A radiogroup of buttons: one Tab stop (the checked one), arrow keys move the choice. */
export function Segmented<T extends string>({
  label,
  className,
  options,
  value,
  onChange,
}: {
  label: string
  className: string
  options: { value: T; label: string; icon?: ReactNode }[]
  value: T
  onChange: (value: T) => void
}) {
  const group = useRef<HTMLDivElement>(null)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const i = options.findIndex((o) => o.value === value)
    const next = options[(i + step + options.length) % options.length]
    onChange(next.value)
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[options.indexOf(next)]?.focus()
  }
  return (
    <div
      ref={group}
      className={className}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      // the sliding marker's width and place come from the options themselves, for any count
      style={
        {
          '--n': options.length,
          '--at': Math.max(
            0,
            options.findIndex((o) => o.value === value),
          ),
        } as CSSProperties
      }
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className="seg__btn"
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.icon ? <span>{o.label}</span> : o.label}
        </button>
      ))}
    </div>
  )
}
