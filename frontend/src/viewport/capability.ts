/**
 * WebGL capability detection.
 *
 * Bug history that justifies this file: the viewport rendered fine in one browser and was a blank
 * void in another, because Brave's anti-fingerprinting blocks the `ANGLE_instanced_arrays`
 * extension and the text renderer threw an unhandled promise rejection. Failing loudly and
 * specifically at startup beats an unexplained void — and it tells the user what to change.
 *
 * Pure and DOM-only (no three.js), so it is unit-testable with a stubbed canvas.
 */

export type CapabilityLevel = 'ok' | 'degraded' | 'unsupported'

export interface Capability {
  level: CapabilityLevel
  /** WebGL 2, WebGL 1, or neither. */
  webglVersion: 0 | 1 | 2
  /** Extensions we asked for and did not get. */
  missing: string[]
  /** Human-readable explanation, empty when `level === 'ok'`. */
  message: string
  /** Actionable next step for the user, empty when `level === 'ok'`. */
  remedy: string
  renderer: string | null
}

/**
 * Extensions worth probing. None of these are required by the renderer as it stands — the text
 * pipeline that needed `ANGLE_instanced_arrays` was removed (see DECISIONS.md D-015) — but a
 * browser that strips them is signalling aggressive WebGL restriction, which is worth surfacing
 * before the user hits a subtler failure.
 */
const PROBED_EXTENSIONS = ['ANGLE_instanced_arrays', 'OES_element_index_uint'] as const

export interface CapabilityProbeOptions {
  /** Injectable for tests. Defaults to creating a real canvas. */
  createCanvas?: () => HTMLCanvasElement | null
}

export function probeWebGL(options: CapabilityProbeOptions = {}): Capability {
  const make =
    options.createCanvas ??
    (() => (typeof document === 'undefined' ? null : document.createElement('canvas')))

  let canvas: HTMLCanvasElement | null = null
  try {
    canvas = make()
  } catch {
    canvas = null
  }

  if (!canvas || typeof canvas.getContext !== 'function') {
    return {
      level: 'unsupported',
      webglVersion: 0,
      missing: [],
      renderer: null,
      message: 'This environment cannot create a canvas, so 3D rendering is unavailable.',
      remedy: 'Open ArchStudio in an up-to-date desktop browser.',
    }
  }

  // Derive the version from WHICH context id succeeded rather than from `instanceof`. Hardened
  // browsers hand back wrapped or proxied context objects that fail an instanceof check even
  // though they are perfectly good WebGL 2 contexts.
  let gl = safeContext(canvas, 'webgl2')
  let webglVersion: 1 | 2 = 2
  if (!gl) {
    gl = safeContext(canvas, 'webgl')
    webglVersion = 1
  }

  if (!gl) {
    return {
      level: 'unsupported',
      webglVersion: 0,
      missing: [],
      renderer: null,
      message: 'WebGL is unavailable, so the 3D viewport cannot start.',
      remedy:
        'Enable hardware acceleration and WebGL in your browser settings, then reload. On Brave, lower Shields for this site.',
    }
  }

  const missing = PROBED_EXTENSIONS.filter((name) => {
    // WebGL 2 folds several WebGL 1 extensions into core, so absence there is not a signal.
    if (webglVersion === 2) return false
    try {
      return gl.getExtension(name) === null
    } catch {
      return true
    }
  })

  const renderer = readRendererName(gl)
  releaseContext(gl)

  if (missing.length > 0) {
    return {
      level: 'degraded',
      webglVersion,
      missing,
      renderer,
      message: `Your browser is restricting WebGL features (${missing.join(', ')}). The viewport should still work, but rendering may be limited.`,
      remedy: 'If the viewport misbehaves, lower anti-fingerprinting or Shields for this site.',
    }
  }

  return { level: 'ok', webglVersion, missing: [], renderer, message: '', remedy: '' }
}

/**
 * Minimal structural view of the bits of a WebGL context this probe touches. Structural rather
 * than nominal so a wrapped/proxied context (what hardened browsers hand back) still works.
 */
interface GlLike {
  getExtension(name: string): unknown
  getParameter(param: number): unknown
  RENDERER: number
}

function safeContext(canvas: HTMLCanvasElement, id: 'webgl' | 'webgl2'): GlLike | null {
  try {
    // `failIfMajorPerformanceCaveat` is deliberately NOT set: a software renderer is slow but
    // usable, and refusing to start would be worse than running degraded.
    const ctx = canvas.getContext(id) as unknown
    if (!ctx || typeof (ctx as GlLike).getExtension !== 'function') return null
    return ctx as GlLike
  } catch {
    return null
  }
}

function readRendererName(gl: GlLike): string | null {
  try {
    const debug = gl.getExtension('WEBGL_debug_renderer_info') as
      | { UNMASKED_RENDERER_WEBGL: number }
      | null
    if (debug) {
      const name = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      if (typeof name === 'string' && name) return name
    }
    const fallback = gl.getParameter(gl.RENDERER)
    return typeof fallback === 'string' ? fallback : null
  } catch {
    return null
  }
}

/** Free the probe context immediately; browsers cap simultaneous WebGL contexts. */
function releaseContext(gl: GlLike): void {
  try {
    const lose = gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null
    lose?.loseContext()
  } catch {
    /* best effort */
  }
}
