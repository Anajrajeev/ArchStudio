/**
 * One 16px icon set on a 16px grid. Drawing-tool icons use FILLED shapes rather than line art:
 * line-based icons visually compete with line-based model geometry (Shapr3D's documented finding),
 * which matters doubly for an architectural plan.
 *
 * Never mix icon sets, never use emoji.
 */
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

/** Filled variant for tool glyphs. */
function SvgFill({ children, ...props }: IconProps) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

// ---- Tools (filled) --------------------------------------------------------

export const IconSelect = (p: IconProps) => (
  <SvgFill {...p}>
    <path d="M3 2l9 5.2-3.7.7L10 12l-1.6.8-1.8-3.6L4 12z" />
  </SvgFill>
)

export const IconWall = (p: IconProps) => (
  <SvgFill {...p}>
    <rect x="1" y="6" width="14" height="4" rx="0.5" />
    <rect x="1" y="3.5" width="1.6" height="9" rx="0.4" />
    <rect x="13.4" y="3.5" width="1.6" height="9" rx="0.4" />
  </SvgFill>
)

/** A straight wall run — the `line` wall mode. */
export const IconWallLine = (p: IconProps) => (
  <SvgFill {...p}>
    <rect x="1" y="6.2" width="14" height="3.6" rx="0.5" />
  </SvgFill>
)

/** A bowed wall run — the `arc` wall mode. */
export const IconWallArc = (p: IconProps) => (
  <SvgFill {...p}>
    <path d="M1 11.6C3.2 5.4 7.1 2.6 15 2.6v3.6C8.6 6.2 5.9 8.2 4.4 12.6z" />
  </SvgFill>
)

/** Trim — a run cut short at a crossing edge. */
export const IconTrim = (p: IconProps) => (
  <SvgFill {...p}>
    <rect x="1" y="6.2" width="7" height="3.6" rx="0.5" />
    <rect x="9" y="1.5" width="1.6" height="13" rx="0.4" />
    <rect x="11.6" y="6.2" width="3.4" height="3.6" rx="0.5" opacity="0.3" />
  </SvgFill>
)

/** Extend — a run reaching out to a boundary. */
export const IconExtend = (p: IconProps) => (
  <SvgFill {...p}>
    <rect x="1" y="6.2" width="6" height="3.6" rx="0.5" />
    <rect x="7.4" y="6.2" width="5.2" height="3.6" rx="0.5" opacity="0.3" />
    <rect x="13.4" y="1.5" width="1.6" height="13" rx="0.4" />
  </SvgFill>
)

/** Split — one run become two, with a gap at the cut. */
export const IconSplit = (p: IconProps) => (
  <SvgFill {...p}>
    <rect x="1" y="6.2" width="6" height="3.6" rx="0.5" />
    <rect x="9" y="6.2" width="6" height="3.6" rx="0.5" />
    <rect x="7.5" y="3" width="1" height="10" rx="0.4" opacity="0.55" />
  </SvgFill>
)

/** Offset — a parallel copy of a run. */
export const IconOffset = (p: IconProps) => (
  <SvgFill {...p}>
    <rect x="1" y="3" width="14" height="3" rx="0.5" />
    <rect x="1" y="10" width="14" height="3" rx="0.5" opacity="0.4" />
  </SvgFill>
)

export const IconSlab = (p: IconProps) => (
  <SvgFill {...p}>
    <path d="M8 2l6.5 3.4L8 8.8 1.5 5.4z" />
    <path d="M1.5 7.6L8 11v3L1.5 10.6z" opacity="0.55" />
    <path d="M14.5 7.6L8 11v3l6.5-3.4z" opacity="0.75" />
  </SvgFill>
)

export const IconRoom = (p: IconProps) => (
  <SvgFill {...p}>
    <path d="M2 2h12v12H2z" opacity="0.28" />
    <path d="M2 2h12v1.4H2zM2 12.6h12V14H2zM2 2h1.4v12H2zM12.6 2H14v12h-1.4z" />
  </SvgFill>
)

export const IconDoor = (p: IconProps) => (
  <SvgFill {...p}>
    <rect x="1" y="1.5" width="2" height="13" rx="0.4" />
    <rect x="13" y="1.5" width="2" height="13" rx="0.4" />
    <path d="M3 12.8A9.8 9.8 0 0 1 12.8 3v1.5A8.3 8.3 0 0 0 4.5 12.8z" opacity="0.8" />
    <rect x="3" y="12" width="10" height="1.4" rx="0.3" />
  </SvgFill>
)

export const IconWindow = (p: IconProps) => (
  <SvgFill {...p}>
    <rect x="1" y="1.5" width="2" height="13" rx="0.4" />
    <rect x="13" y="1.5" width="2" height="13" rx="0.4" />
    <rect x="3" y="5" width="10" height="6" rx="0.4" opacity="0.35" />
    <path d="M3 5h10v1H3zM3 10h10v1H3zM7.4 5h1.2v6H7.4z" />
  </SvgFill>
)

export const IconColumn = (p: IconProps) => (
  <SvgFill {...p}>
    <rect x="5.5" y="3" width="5" height="10" rx="0.4" />
    <rect x="3" y="1.5" width="10" height="2" rx="0.4" />
    <rect x="3" y="12.5" width="10" height="2" rx="0.4" />
  </SvgFill>
)

export const IconBeam = (p: IconProps) => (
  <SvgFill {...p}>
    <rect x="1" y="6.2" width="14" height="3.6" rx="0.4" />
    <rect x="1" y="4" width="14" height="1.6" rx="0.4" opacity="0.6" />
    <rect x="1" y="10.4" width="14" height="1.6" rx="0.4" opacity="0.6" />
  </SvgFill>
)

export const IconMeasure = (p: IconProps) => (
  <SvgFill {...p}>
    <path d="M1.6 9.4l7.8-7.8 5 5-7.8 7.8z" opacity="0.32" />
    <path d="M9.4 1.6l5 5-1.1 1.1-5-5zM1.6 9.4l1.1-1.1 5 5-1.1 1.1z" />
    <path d="M4.6 6.4l1.4 1.4M6.6 4.4l1.4 1.4M8.6 2.4l1.4 1.4" stroke="currentColor" strokeWidth="1.1" />
  </SvgFill>
)

export const IconDimension = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 3v3M14 3v3M2 4.5h12" />
    <path d="M4.2 4.5l1.6-1M4.2 4.5l1.6 1M11.8 4.5l-1.6-1M11.8 4.5l-1.6 1" />
    <path d="M4.5 8.5v5M11.5 8.5v5" strokeDasharray="1.5 1.2" />
  </Svg>
)

export const IconRoomTag = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="2" width="12" height="12" rx="1" />
    <path d="M4.5 6h7M4.5 8.5h5M4.5 11h3" />
  </Svg>
)

export const IconText = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3.5h10M8 3.5v9" />
  </Svg>
)

export const IconLeader = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 13.5l5-5" />
    <path d="M7.5 8.5l1.6 0.4-0.4-1.6z" />
    <path d="M9 9.5h5" />
  </Svg>
)

export const IconColumnGrid = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 1v14M8 1v14M12 1v14" strokeDasharray="1.6 1.2" />
    <path d="M1 4h14M1 8h14M1 12h14" strokeDasharray="1.6 1.2" />
    <circle cx="4" cy="1.6" r="1.1" />
    <circle cx="1.6" cy="4" r="1.1" />
  </Svg>
)

export const IconRoof = (p: IconProps) => (
  <SvgFill {...p}>
    <path d="M8 2L1.5 10h13z" />
    <path d="M4.2 10v3.2h7.6V10" opacity="0.32" />
  </SvgFill>
)

// ---- Actions (stroke) ------------------------------------------------------

export const IconUndo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8h7a3.5 3.5 0 1 1 0 7H6" />
    <path d="M5.5 5.5L3 8l2.5 2.5" />
  </Svg>
)

export const IconRedo = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 8H6a3.5 3.5 0 1 0 0 7h4" />
    <path d="M10.5 5.5L13 8l-2.5 2.5" />
  </Svg>
)

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9" />
    <path d="M6.5 7v4M9.5 7v4" />
  </Svg>
)

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Svg>
)

export const IconGrid = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 2h12v12H2zM6 2v12M10 2v12M2 6h12M2 10h12" />
  </Svg>
)

export const IconPlan = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 2h12v12H2z" />
    <path d="M2 9h5M7 9V2M10 14v-5M10 9h4" />
  </Svg>
)

export const IconCube = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 1.5l6 3v7l-6 3-6-3v-7z" />
    <path d="M2 4.5l6 3 6-3M8 7.5v7" />
  </Svg>
)

export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.1 3.1l1 1M11.9 11.9l1 1M12.9 3.1l-1 1M4.1 11.9l-1 1" />
  </Svg>
)

export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 9.8A5.5 5.5 0 0 1 6.2 3a5.5 5.5 0 1 0 6.8 6.8z" />
  </Svg>
)

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.5L10.5 8L6 12.5" />
  </Svg>
)

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 6L8 10.5L12.5 6" />
  </Svg>
)

export const IconEye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="1.8" />
  </Svg>
)

export const IconEyeOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.3 4A6.9 6.9 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5s-.7 1.3-1.9 2.5M4 5.2C2.4 6.4 1.5 8 1.5 8S3.9 12.5 8 12.5c.7 0 1.3-.1 1.9-.3" />
    <path d="M2 2l12 12" />
  </Svg>
)

export const IconLayers = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 1.8l6 3-6 3-6-3z" />
    <path d="M2 8.2l6 3 6-3M2 11.2l6 3 6-3" />
  </Svg>
)

export const IconExport = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 10.5V2M5 5l3-3 3 3" />
    <path d="M2.5 10v3.5h11V10" />
  </Svg>
)

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="7" width="9" height="7" rx="1" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </Svg>
)

export const IconUnlock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="7" width="9" height="7" rx="1" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1" />
  </Svg>
)

export const IconTarget = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.5" />
    <circle cx="8" cy="8" r="1.5" />
    <path d="M8 1v2M8 13v2M1 8h2M13 8h2" />
  </Svg>
)
