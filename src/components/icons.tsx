import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

const base = (p: P) => ({
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p,
})

export const UploadIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5" />
    <path d="M4 14v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3" />
  </svg>
)

export const DownloadIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5" />
    <path d="M4 14v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3" />
  </svg>
)

export const PlusIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const CheckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)

export const AlertIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5v.01" />
  </svg>
)

export const InfoIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.5v.01" />
  </svg>
)

export const ChevronDownIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
  </svg>
)

export const LockIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </svg>
)

export const ResetIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 12a8 8 0 1 0 2.6-5.9" />
    <path d="M4 4.5v4h4" />
  </svg>
)

export const ShareIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v12m0-12L8 7m4-4 4 4" />
    <path d="M8 11H6.5A2.5 2.5 0 0 0 4 13.5v4A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-4a2.5 2.5 0 0 0-2.5-2.5H16" />
  </svg>
)

export const CameraIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" />
    <circle cx="12" cy="12.5" r="3.5" />
  </svg>
)

export const SunIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </svg>
)

export const MoonIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
  </svg>
)

export const XIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 7l10 10M17 7 7 17" />
  </svg>
)

export const ChevronsIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m9 7-5 5 5 5M15 7l5 5-5 5" />
  </svg>
)

export const Spinner = ({ className = '' }: { className?: string }) => (
  <span className={`spinner ${className}`} aria-hidden="true" />
)

export const UndoIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 7 4.5 11.5 9 16" />
    <path d="M4.5 11.5H15a4.5 4.5 0 0 1 0 9h-3" />
  </svg>
)

export const RedoIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m15 7 4.5 4.5L15 16" />
    <path d="M19.5 11.5H9a4.5 4.5 0 0 0 0 9h3" />
  </svg>
)

export const HandIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V14" />
    <path d="M8 12 6.4 10.4a1.5 1.5 0 0 0-2.2 2L8.5 19a4 4 0 0 0 3.4 2h2.2a4 4 0 0 0 4-4v-3a1.5 1.5 0 0 0-3 0" />
  </svg>
)

export const EraserIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m8 20-4.3-4.3a2 2 0 0 1 0-2.8L13 3.6a2 2 0 0 1 2.8 0L20.4 8.2a2 2 0 0 1 0 2.8L11 20.4" />
    <path d="M8 20h12M7 10.5l6.5 6.5" />
  </svg>
)

export const BrushIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M14.5 5.5 19 10 11 18l-4.5-4.5z" />
    <path d="m16.5 3.5 4 4" />
    <path d="M6.5 13.5C4.5 14 4 16 4 18c0 1.5-.5 2-1 2.5 3 .5 6.5-.5 7.5-3" />
  </svg>
)
