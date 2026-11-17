import { useEffect, useState, type CSSProperties } from 'react'
import { ChevronsIcon } from './icons'

type Props = {
  before: string
  after: string
  width: number
  height: number
  /** Sweep the divider in from the right on mount (the first time a cut-out is shown). */
  reveal: boolean
  /** The photo's name, for screen readers. */
  name?: string
}

export function Compare({ before, after, width, height, reveal, name }: Props) {
  // Only the value at mount matters: the parent flips `reveal` off right after the first render,
  // and that must not cancel a sweep already under way.
  const [revealOnMount] = useState(reveal)
  const [pos, setPos] = useState(revealOnMount ? 100 : 50)
  const [sweeping, setSweeping] = useState(revealOnMount)

  useEffect(() => {
    if (!revealOnMount) return
    const start = setTimeout(() => setPos(50), 120)
    const end = setTimeout(() => setSweeping(false), 1200)
    return () => {
      clearTimeout(start)
      clearTimeout(end)
    }
  }, [revealOnMount])

  const style = { '--pos': `${pos}%`, '--ratio': width / height, aspectRatio: `${width} / ${height}` } as CSSProperties

  return (
    <div
      className={`compare${sweeping ? ' compare--sweeping' : ''}`}
      style={style}
      role="group"
      aria-label={name ? `${name}: original and cut-out` : undefined}
    >
      <img className="compare__img" src={before} alt="" draggable={false} />
      <div className="compare__after">
        <img className="compare__img" src={after} alt="" draggable={false} />
      </div>
      <span className="compare__label compare__label--before" data-hidden={pos < 16 || undefined}>
        Original
      </span>
      <span className="compare__label compare__label--after" data-hidden={pos > 84 || undefined}>
        Cut-out
      </span>
      <div className="compare__divider" aria-hidden="true">
        <span className="compare__knob">
          <ChevronsIcon width={16} height={16} />
        </span>
      </div>
      <input
        className="compare__range"
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={pos}
        aria-label="Compare original and cut-out"
        aria-valuetext={`${Math.round(pos)}% original`}
        onChange={(e) => {
          setSweeping(false)
          setPos(Number(e.target.value))
        }}
      />
    </div>
  )
}
