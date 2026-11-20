import { useId, type ReactNode } from 'react'
import { ChevronDownIcon, LockIcon } from './icons'

type Props = { hasItems: boolean; onClose(): void; onChoose(): void }

/*
 * What happens to a photo, told with one drawn photo in five frames. The drawings are built from the
 * app's own marks (the dashed selection square, the accent dot, the scan band, the checkerboard), not
 * stock icons. Each one moves as its step scrolls into view, in CSS alone (scroll-driven animations,
 * Baseline since October 2026); every element's resting style is its end state, so a browser without
 * scroll timelines, or a reduced-motion user, sees each frame finished.
 */
export default function HowItWorks({ hasItems, onClose, onChoose }: Props) {
  return (
    <main className="how" aria-labelledby="how-title">
      <button type="button" className="button button--ghost how__back" onClick={onClose}>
        <ChevronDownIcon className="how__back-icon" />
        Back
      </button>

      <header className="how__intro">
        <h1 id="how-title" className="how__title" tabIndex={-1}>
          How <span className="how__brand">Cameo</span> works
        </h1>
        <p className="how__lede">
          Everything happens here, in this browser tab. This is what happens to a photo, step by step.
        </p>
      </header>

      <ol className="how__steps">
        <Step n={1} title="It opens on your device" figure={<FigOpen />}>
          Your photo is read by this tab, the way a photo viewer opens a file. Nothing is uploaded, so there is no
          server holding a copy.
        </Step>
        <Step n={2} title="The model finds the subject" figure={<FigFind />}>
          A background-removal model runs in your browser: on the graphics card when it can, on the processor when it
          can't. It decides, pixel by pixel, what is subject and what is background.
        </Step>
        <Step n={3} title="The edges are cleaned" figure={<FigEdges />}>
          The model looks at a smaller copy, so its edges come out soft. Cameo lines them up with the full-size photo
          and lifts the old background's colour out of hair and fur.
        </Step>
        <Step n={4} title="You fix what it missed" figure={<FigFix />}>
          Erase and Restore brushes paint over the edges, and Select keeps or removes a whole object with one tap. Every
          step can be undone.
        </Step>
        <Step n={5} title="You download it" figure={<FigSave />}>
          The cut-out is made at full size, on your device, and saved as a PNG: a clear background, or a colour you
          pick.
        </Step>
      </ol>

      <section className="sheet how-facts" aria-labelledby="how-facts-title">
        <h2 id="how-facts-title" className="how-facts__title">
          <LockIcon width={16} height={16} />
          What stays where
        </h2>
        <div className="how-facts__cols">
          <div>
            <h3 className="how-facts__head">Kept on this device</h3>
            <ul className="how-facts__list">
              <li>Cameo itself, so it opens without a connection once it has been set up.</li>
              <li>
                The models Cameo runs, each downloaded the first time it's needed so it opens quickly after that.
                Clearing this site's data in your browser removes them.
              </li>
              <li>Two settings: light or dark, and whether to use the processor instead of the graphics card.</li>
            </ul>
          </div>
          <div>
            <h3 className="how-facts__head">Never leaves this device</h3>
            <ul className="how-facts__list">
              <li>Your photos.</li>
              <li>The cut-outs, and the edits you make to them.</li>
              <li>Anything made from either.</li>
            </ul>
          </div>
        </div>
        <p className="how-facts__note">
          Besides the page and its fonts, the only downloads are the models, from Hugging Face, and the code that runs
          them. Nothing made from your photos is ever sent anywhere. Cameo counts two things, with no cookies: that the
          page was opened, and that a cut-out was made. The count carries nothing from your photos, and stops when your
          browser asks sites not to track. The code is open to check:{' '}
          <a className="footer__link" href="https://github.com/mikelisrael/cameo" target="_blank" rel="noreferrer">
            Code on GitHub
          </a>
          .
        </p>
      </section>

      <div className="how__end">
        {hasItems ? (
          <button type="button" className="button button--primary button--lg" onClick={onClose}>
            Back to your images
          </button>
        ) : (
          <button type="button" className="button button--primary button--lg" onClick={onChoose}>
            Choose images
          </button>
        )}
      </div>
    </main>
  )
}

function Step({ n, title, figure, children }: { n: number; title: string; figure: ReactNode; children: ReactNode }) {
  return (
    <li className="how-step">
      <div className="how-step__text">
        <span className="how-step__num">{String(n).padStart(2, '0')}</span>
        <h2 className="how-step__title">{title}</h2>
        <p className="how-step__body">{children}</p>
      </div>
      <div className="how-fig" aria-hidden="true">
        {figure}
      </div>
    </li>
  )
}

/* ---------- The drawn photo ---------- */

// Pattern ids must be unique on the page; each figure makes its own.
function usePatterns() {
  const id = useId().replace(/:/g, '')
  return { stripes: `${id}s`, check: `${id}c`, band: `${id}b` }
}

function Defs({ ids }: { ids: ReturnType<typeof usePatterns> }) {
  return (
    <defs>
      <pattern id={ids.stripes} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
        <rect width="14" height="14" fill="var(--well)" />
        <rect width="5" height="14" fill="var(--line-strong)" opacity="0.7" />
      </pattern>
      <pattern id={ids.check} width="20" height="20" patternUnits="userSpaceOnUse">
        <rect width="20" height="20" fill="var(--check-a)" />
        <rect width="10" height="10" fill="var(--check-b)" />
        <rect x="10" y="10" width="10" height="10" fill="var(--check-b)" />
      </pattern>
      <linearGradient id={ids.band} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="var(--sheet)" stopOpacity="0" />
        <stop offset="0.5" stopColor="var(--sheet)" stopOpacity="0.75" />
        <stop offset="1" stopColor="var(--sheet)" stopOpacity="0" />
      </linearGradient>
    </defs>
  )
}

/** A busy background: stripes and the shapes of other things in the room. */
function Clutter({ stripes }: { stripes: string }) {
  return (
    <g>
      <rect width="320" height="240" fill={`url(#${stripes})`} />
      <circle cx="58" cy="196" r="38" fill="var(--line)" />
      <rect x="236" y="34" width="60" height="78" rx="10" fill="var(--line)" />
      <rect x="22" y="30" width="42" height="26" rx="6" fill="var(--sheet)" opacity="0.6" />
    </g>
  )
}

/** The subject: a persimmon. */
function Fruit({ x = 160, y = 132, s = 1 }: { x?: number; y?: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse rx="54" ry="48" fill="var(--accent)" />
      <ellipse cx="-20" cy="-18" rx="13" ry="8" fill="var(--sheet)" opacity="0.32" transform="rotate(-32 -20 -18)" />
      <rect x="-2" y="-62" width="4" height="12" rx="2" fill="var(--ink-2)" />
      <path d="M0 -50 L8 -40 L22 -43 L12 -34 L0 -37 L-12 -34 L-22 -43 L-8 -40 Z" fill="var(--ink-2)" />
    </g>
  )
}

function Photo({ stripes }: { stripes: string }) {
  return (
    <g>
      <Clutter stripes={stripes} />
      <Fruit />
    </g>
  )
}

/* ---------- The five frames ---------- */

/** 1. The photo drops into this tab; the tab has the lock. */
function FigOpen() {
  const ids = usePatterns()
  return (
    <svg viewBox="0 0 320 240" role="presentation">
      <Defs ids={ids} />
      <rect width="320" height="240" fill="var(--well)" />
      <rect x="24" y="20" width="272" height="204" rx="14" fill="var(--sheet)" stroke="var(--line-strong)" />
      <line x1="24" y1="52" x2="296" y2="52" stroke="var(--line)" />
      <rect x="36" y="28" width="96" height="24" rx="8" fill="var(--well)" />
      <g transform="translate(46 34)" fill="none" stroke="var(--ink-2)" strokeWidth="1.6" strokeLinecap="round">
        <rect x="0.8" y="5" width="9.4" height="7" rx="1.6" fill="var(--ink-2)" stroke="none" />
        <path d="M2.8 5 V3.4 a2.7 2.7 0 0 1 5.4 0 V5" />
      </g>
      <text x="62" y="44" className="how-fig__label">
        cameo
      </text>
      <g className="fx fx-drop">
        <rect x="62" y="64" width="196" height="148" rx="8" fill="var(--well)" />
        <svg x="64" y="66" width="192" height="144" viewBox="0 0 320 240">
          <Photo stripes={ids.stripes} />
        </svg>
      </g>
    </svg>
  )
}

/** 2. The scan band passes; the background dims and the selection snaps round the fruit. */
function FigFind() {
  const ids = usePatterns()
  return (
    <svg viewBox="0 0 320 240" role="presentation">
      <Defs ids={ids} />
      <Clutter stripes={ids.stripes} />
      <rect width="320" height="240" fill="var(--sheet)" className="fx fx-dim" />
      <Fruit />
      <rect x="-90" width="90" height="240" fill={`url(#${ids.band})`} className="fx fx-scan" />
      <rect
        x="94"
        y="62"
        width="132"
        height="128"
        rx="12"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.2"
        strokeDasharray="7 6"
        className="fx fx-snap"
      />
    </svg>
  )
}

/** 3. Close up on an edge: stair steps with a fringe of the old background become a clean curve. */
function FigEdges() {
  const ids = usePatterns()
  const clip = `${ids.check}m`
  return (
    <svg viewBox="0 0 320 240" role="presentation">
      <Defs ids={ids} />
      <clipPath id={clip}>
        <circle cx="214" cy="120" r="80" />
      </clipPath>
      <rect width="320" height="240" fill={`url(#${ids.check})`} />
      <Fruit x={84} y={128} s={0.62} />
      <line x1="118" y1="120" x2="134" y2="120" stroke="var(--line-strong)" strokeWidth="2" strokeDasharray="3 3" />
      <circle cx="117" cy="120" r="5" fill="none" stroke="var(--ink-2)" strokeWidth="1.6" />
      <g clipPath={`url(#${clip})`}>
        <g className="fx fx-before">
          <path
            d="M134 30 H214 V54 H228 V78 H238 V102 H242 V138 H238 V162 H228 V186 H214 V210 H134 Z"
            fill="var(--accent)"
            stroke="var(--line-strong)"
            strokeWidth="9"
            strokeLinejoin="miter"
            paintOrder="stroke"
          />
        </g>
        <path d="M134 30 H212 Q268 120 212 210 H134 Z" fill="var(--accent)" className="fx fx-after" />
      </g>
      <circle cx="214" cy="120" r="80" fill="none" stroke="var(--line-strong)" strokeWidth="2.5" />
    </svg>
  )
}

/** 4. A bite the model missed; the Restore brush passes over it and it fills back in. */
function FigFix() {
  const ids = usePatterns()
  return (
    <svg viewBox="0 0 320 240" role="presentation">
      <Defs ids={ids} />
      <rect width="320" height="240" fill={`url(#${ids.check})`} />
      <Fruit />
      <circle cx="198" cy="112" r="22" fill={`url(#${ids.check})`} className="fx fx-heal" />
      <g className="fx fx-brush">
        <circle cx="198" cy="112" r="24" fill="none" stroke="var(--ink)" strokeWidth="2" />
        <circle cx="198" cy="112" r="24" fill="none" stroke="var(--sheet)" strokeWidth="1" opacity="0.8" />
      </g>
    </svg>
  )
}

/** 5. The background falls away to the checkerboard and the PNG lands. */
function FigSave() {
  const ids = usePatterns()
  return (
    <svg viewBox="0 0 320 240" role="presentation">
      <Defs ids={ids} />
      <rect width="320" height="240" fill={`url(#${ids.check})`} />
      <g className="fx fx-fall">
        <Clutter stripes={ids.stripes} />
      </g>
      <Fruit />
      <g className="fx fx-chip">
        <rect x="206" y="190" width="98" height="34" rx="17" fill="var(--sheet)" stroke="var(--line-strong)" />
        <g transform="translate(222 199)" fill="none" stroke="var(--ink)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M8 1 V11 M4 7.5 L8 11.5 L12 7.5 M2 15 H14" />
        </g>
        <text x="246" y="212" className="how-fig__label how-fig__label--ink">
          PNG
        </text>
      </g>
    </svg>
  )
}
