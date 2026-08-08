/**
 * Bridge between the CSS token layer and three.js. The canvas colours are declared once in
 * tokens.css and read from here, so the viewport can never drift from the chrome theme.
 */
import { useEffect, useMemo, useState } from 'react'
import { useEditor } from '../scene/store'

export interface CanvasTheme {
  canvas3d: string
  canvasPlan: string
  /** Resolved per view mode by the caller; see `groundColor`. */
  ground: string
  ground3d: string
  groundPlan: string
  gridMinor: string
  gridMajor: string
  gridMinorPlan: string
  gridMajorPlan: string
  planInk: string
  /** C8: the single flat ink an underlaid level is drawn in. */
  underlay: string
  select: string
  selectActive: string
  prehighlight: string
  axisX: string
  axisY: string
  axisZ: string
  inference: string
  textDim: string
}

const FALLBACK: CanvasTheme = {
  canvas3d: '#3b3b3b',
  canvasPlan: '#e4e4e4',
  ground: '#414141',
  ground3d: '#414141',
  groundPlan: '#eeeeee',
  gridMinor: 'rgba(255,255,255,0.12)',
  gridMajor: 'rgba(255,255,255,0.26)',
  gridMinorPlan: '#c9c9c9',
  gridMajorPlan: '#a8a8a8',
  planInk: '#1c1c1c',
  underlay: '#6f7d8c',
  select: '#ff8000',
  selectActive: '#ffa028',
  prehighlight: '#ffc685',
  axisX: '#ff3352',
  axisY: '#8bdc00',
  axisZ: '#2890ff',
  inference: '#d946ef',
  textDim: 'rgba(245,245,245,0.7)',
}

const VAR_MAP: Record<keyof CanvasTheme, string> = {
  canvas3d: '--canvas-3d',
  canvasPlan: '--canvas-plan',
  // `ground` is resolved from the view mode below, so it maps to the 3D value by default.
  ground: '--ground-3d',
  ground3d: '--ground-3d',
  groundPlan: '--ground-plan',
  gridMinor: '--grid-minor',
  gridMajor: '--grid-major',
  gridMinorPlan: '--grid-minor-plan',
  gridMajorPlan: '--grid-major-plan',
  planInk: '--plan-ink',
  underlay: '--underlay-ink',
  select: '--p-select',
  selectActive: '--p-select-active',
  prehighlight: '--p-prehighlight',
  axisX: '--p-axis-x',
  axisY: '--p-axis-y',
  axisZ: '--p-axis-z',
  inference: '--p-inference',
  textDim: '--text-dim',
}

function readTokens(): CanvasTheme {
  if (typeof document === 'undefined') return FALLBACK
  const style = getComputedStyle(document.documentElement)
  const out = { ...FALLBACK }
  for (const key of Object.keys(VAR_MAP) as Array<keyof CanvasTheme>) {
    const v = style.getPropertyValue(VAR_MAP[key]).trim()
    if (v) out[key] = v
  }
  return out
}

/** Re-reads tokens whenever the theme flips, and resolves `ground` for the active view mode. */
export function useCanvasTheme(): CanvasTheme {
  const theme = useEditor((s) => s.theme)
  const viewMode = useEditor((s) => s.viewMode)
  const [tokens, setTokens] = useState<CanvasTheme>(FALLBACK)

  useEffect(() => {
    // Read synchronously first so the very first frame is correct rather than falling back,
    // then again on the next frame in case the theme attribute had not been applied yet.
    setTokens(readTokens())
    const id = requestAnimationFrame(() => setTokens(readTokens()))
    return () => cancelAnimationFrame(id)
  }, [theme])

  return useMemo(
    () => ({ ...tokens, ground: viewMode === 'plan' ? tokens.groundPlan : tokens.ground3d }),
    [tokens, viewMode],
  )
}

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

function parseCssColor(css: string): Rgba | null {
  const s = css.trim()
  const rgba = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/i.exec(s)
  if (rgba) {
    return {
      r: parseFloat(rgba[1]),
      g: parseFloat(rgba[2]),
      b: parseFloat(rgba[3]),
      a: rgba[4] === undefined ? 1 : parseFloat(rgba[4]),
    }
  }
  const hex6 = /^#([0-9a-f]{6})$/i.exec(s)
  if (hex6) {
    const n = parseInt(hex6[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const hex3 = /^#([0-9a-f]{3})$/i.exec(s)
  if (hex3) {
    const [r, g, b] = hex3[1].split('').map((c) => parseInt(c + c, 16))
    return { r, g, b, a: 1 }
  }
  return null
}

function toHex({ r, g, b }: Rgba): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, '0')).join('')}`
}

/**
 * three.js can't parse `rgba()`. Split a CSS colour into an opaque hex plus an alpha, for
 * materials that support `transparent` + `opacity`.
 */
export function splitAlpha(css: string): { color: string; opacity: number } {
  const c = parseCssColor(css)
  if (!c) return { color: css, opacity: 1 }
  return { color: toHex(c), opacity: c.a }
}

/**
 * Composite a possibly-translucent CSS colour over an opaque background and return the resulting
 * opaque hex.
 *
 * Needed because some materials (notably drei's `<Grid>`, a shader with no per-line opacity
 * uniform) take an opaque colour only. Passing the bare colour there throws the alpha away — for
 * grid lines declared as `rgba(255,255,255,0.12)` that turns a deliberately faint grid into full
 * white, which is exactly the high-contrast grid that reads as amateur.
 */
export function blendOver(foreground: string, background: string): string {
  const fg = parseCssColor(foreground)
  const bg = parseCssColor(background)
  if (!fg) return foreground
  if (!bg || fg.a >= 1) return toHex(fg)
  return toHex({
    r: bg.r + (fg.r - bg.r) * fg.a,
    g: bg.g + (fg.g - bg.g) * fg.a,
    b: bg.b + (fg.b - bg.b) * fg.a,
    a: 1,
  })
}
