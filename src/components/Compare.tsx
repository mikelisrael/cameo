import { useState } from 'react'

type Props = { before: string; after: string; width: number; height: number }

export function Compare({ before, after, width, height }: Props) {
  const [pos, setPos] = useState(50)
  return (
    <div className="compare" style={{ aspectRatio: `${width} / ${height}` }}>
      <img className="compare__img compare__before" src={before} alt="Original" />
      <div className="compare__after" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
        <img className="compare__img" src={after} alt="Cut-out" />
      </div>
      <div className="compare__handle" style={{ left: `${pos}%` }} aria-hidden="true" />
      <input
        className="compare__range"
        type="range"
        min={0}
        max={100}
        value={pos}
        aria-label="Before and after"
        onChange={(e) => setPos(Number(e.target.value))}
      />
    </div>
  )
}
