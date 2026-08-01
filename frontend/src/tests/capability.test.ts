/**
 * WebGL capability detection.
 *
 * These tests exist because a blocked WebGL extension produced a completely blank viewport with no
 * explanation, and it was invisible in the browser I was testing in. The Brave case is simulated
 * directly below so it can never regress silently again.
 */
import { describe, it, expect, vi } from 'vitest'
import { probeWebGL } from '../viewport/capability'

/** Build a fake canvas whose WebGL context behaves however a test needs. */
function fakeCanvas(opts: {
  webgl2?: boolean
  webgl1?: boolean
  /** Extensions to report as blocked (getExtension returns null). */
  blocked?: string[]
  /** Extensions whose lookup throws, as some hardened browsers do. */
  throwing?: string[]
  renderer?: string
}): HTMLCanvasElement {
  const blocked = new Set(opts.blocked ?? [])
  const throwing = new Set(opts.throwing ?? [])

  const makeCtx = (isV2: boolean): Record<string, unknown> => ({
    __isV2: isV2,
    getExtension: (name: string) => {
      if (throwing.has(name)) throw new Error(`blocked: ${name}`)
      if (blocked.has(name)) return null
      if (name === 'WEBGL_debug_renderer_info') return { UNMASKED_RENDERER_WEBGL: 37446 }
      if (name === 'WEBGL_lose_context') return { loseContext: () => undefined }
      return {}
    },
    getParameter: (p: number) => (p === 37446 ? (opts.renderer ?? 'Test GPU') : 'fallback-renderer'),
    RENDERER: 7937,
  })

  return {
    getContext: (id: string) => {
      if (id === 'webgl2') return opts.webgl2 ? makeCtx(true) : null
      if (id === 'webgl') return opts.webgl1 ? makeCtx(false) : null
      return null
    },
  } as unknown as HTMLCanvasElement
}

describe('probeWebGL', () => {
  it('reports ok on a WebGL 2 context', () => {
    const cap = probeWebGL({ createCanvas: () => fakeCanvas({ webgl2: true }) })
    expect(cap.level).toBe('ok')
    expect(cap.webglVersion).toBe(2)
    expect(cap.missing).toEqual([])
    expect(cap.message).toBe('')
  })

  it('reports ok on a WebGL 1 context that has the probed extensions', () => {
    const cap = probeWebGL({ createCanvas: () => fakeCanvas({ webgl1: true }) })
    expect(cap.level).toBe('ok')
    expect(cap.webglVersion).toBe(1)
  })

  it('prefers WebGL 2 when both are available', () => {
    const cap = probeWebGL({ createCanvas: () => fakeCanvas({ webgl2: true, webgl1: true }) })
    expect(cap.webglVersion).toBe(2)
  })

  // The actual production failure: Brave blocks ANGLE_instanced_arrays for fingerprinting.
  it('flags a WebGL 1 context with ANGLE_instanced_arrays blocked as degraded', () => {
    const cap = probeWebGL({
      createCanvas: () => fakeCanvas({ webgl1: true, blocked: ['ANGLE_instanced_arrays'] }),
    })
    expect(cap.level).toBe('degraded')
    expect(cap.missing).toContain('ANGLE_instanced_arrays')
    expect(cap.message).toContain('ANGLE_instanced_arrays')
    // The remedy must name the actual cause, not just say "something went wrong".
    expect(cap.remedy.toLowerCase()).toMatch(/shields|fingerprint/)
  })

  it('treats an extension lookup that throws as missing', () => {
    const cap = probeWebGL({
      createCanvas: () => fakeCanvas({ webgl1: true, throwing: ['ANGLE_instanced_arrays'] }),
    })
    expect(cap.level).toBe('degraded')
    expect(cap.missing).toContain('ANGLE_instanced_arrays')
  })

  it('does NOT flag missing WebGL-1 extensions on a WebGL 2 context', () => {
    // WebGL 2 folds these into core, so their absence there is not a signal.
    const cap = probeWebGL({
      createCanvas: () => fakeCanvas({ webgl2: true, blocked: ['ANGLE_instanced_arrays'] }),
    })
    expect(cap.level).toBe('ok')
    expect(cap.missing).toEqual([])
  })

  it('reports unsupported when no WebGL context can be created', () => {
    const cap = probeWebGL({ createCanvas: () => fakeCanvas({}) })
    expect(cap.level).toBe('unsupported')
    expect(cap.webglVersion).toBe(0)
    expect(cap.message).toContain('WebGL is unavailable')
    expect(cap.remedy).toBeTruthy()
  })

  it('reports unsupported when a canvas cannot be created at all', () => {
    const cap = probeWebGL({ createCanvas: () => null })
    expect(cap.level).toBe('unsupported')
    expect(cap.message).toContain('cannot create a canvas')
  })

  it('survives a canvas factory that throws', () => {
    const cap = probeWebGL({
      createCanvas: () => {
        throw new Error('no canvas for you')
      },
    })
    expect(cap.level).toBe('unsupported')
  })

  it('survives getContext itself throwing', () => {
    const canvas = {
      getContext: () => {
        throw new Error('blocked')
      },
    } as unknown as HTMLCanvasElement
    const cap = probeWebGL({ createCanvas: () => canvas })
    expect(cap.level).toBe('unsupported')
  })

  it('reads the unmasked renderer name when available', () => {
    const cap = probeWebGL({
      createCanvas: () => fakeCanvas({ webgl2: true, renderer: 'Apple M2' }),
    })
    expect(cap.renderer).toBe('Apple M2')
  })

  it('releases the probe context so it does not consume a context slot', () => {
    const loseContext = vi.fn()
    const canvas = {
      getContext: () => ({
        getExtension: (name: string) =>
          name === 'WEBGL_lose_context' ? { loseContext } : name === 'WEBGL_debug_renderer_info' ? null : {},
        getParameter: () => 'r',
        RENDERER: 1,
      }),
    } as unknown as HTMLCanvasElement
    probeWebGL({ createCanvas: () => canvas })
    expect(loseContext).toHaveBeenCalled()
  })

  it('never throws, whatever the environment does', () => {
    expect(() => probeWebGL({ createCanvas: () => ({}) as HTMLCanvasElement })).not.toThrow()
  })
})
