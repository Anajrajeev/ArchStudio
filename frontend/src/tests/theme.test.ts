/**
 * Colour-token plumbing. This has a specific bug history: drei's `<Grid>` is a shader with no
 * per-line opacity uniform, so a translucent token passed straight through renders at FULL
 * strength — turning a deliberately faint grid into glaring white. `blendOver` exists to
 * composite the alpha manually, and these tests pin that behaviour.
 */
import { describe, it, expect } from 'vitest'
import { splitAlpha, blendOver } from '../viewport/theme'

describe('splitAlpha', () => {
  it('splits an rgba string into an opaque hex plus alpha', () => {
    expect(splitAlpha('rgba(255, 255, 255, 0.12)')).toEqual({ color: '#ffffff', opacity: 0.12 })
  })

  it('treats rgb as fully opaque', () => {
    expect(splitAlpha('rgb(60, 60, 60)')).toEqual({ color: '#3c3c3c', opacity: 1 })
  })

  it('passes a hex colour through as opaque', () => {
    expect(splitAlpha('#3b3b3b')).toEqual({ color: '#3b3b3b', opacity: 1 })
  })

  it('expands 3-digit hex', () => {
    expect(splitAlpha('#abc')).toEqual({ color: '#aabbcc', opacity: 1 })
  })

  it('returns an unparseable value untouched rather than guessing', () => {
    expect(splitAlpha('var(--nope)')).toEqual({ color: 'var(--nope)', opacity: 1 })
  })
})

describe('blendOver', () => {
  it('composites a translucent white over a dark ground', () => {
    // 0.12 white over #414141 (65) → 65 + 0.12*(255-65) ≈ 87.8 → 0x58
    expect(blendOver('rgba(255,255,255,0.12)', '#414141')).toBe('#585858')
  })

  it('produces a stronger line for the major grid than the minor grid', () => {
    const minor = blendOver('rgba(255,255,255,0.12)', '#414141')
    const major = blendOver('rgba(255,255,255,0.26)', '#414141')
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16)
    expect(lum(major)).toBeGreaterThan(lum(minor))
  })

  it('keeps grid lines within a readable distance of the background', () => {
    // The research bound: grid lines belong roughly 10–40 RGB units from the background.
    // Too close and they vanish once the shader fades them; too far and the grid shouts.
    const ground = 0x41
    for (const alpha of [0.12, 0.26]) {
      const blended = parseInt(blendOver(`rgba(255,255,255,${alpha})`, '#414141').slice(1, 3), 16)
      const delta = blended - ground
      expect(delta, `alpha ${alpha}`).toBeGreaterThanOrEqual(10)
      expect(delta, `alpha ${alpha}`).toBeLessThanOrEqual(60)
    }
  })

  it('darkens toward the ground for a translucent black (light theme)', () => {
    // 0.14 black over #cfcfcf (207) → 207 - 0.14*207 ≈ 178 → 0xb2
    expect(blendOver('rgba(0,0,0,0.14)', '#cfcfcf')).toBe('#b2b2b2')
  })

  it('returns the foreground unchanged when it is already opaque', () => {
    expect(blendOver('#c9c9c9', '#eeeeee')).toBe('#c9c9c9')
  })

  it('is a no-op at alpha 1 and equals the background at alpha 0', () => {
    expect(blendOver('rgba(255,255,255,1)', '#414141')).toBe('#ffffff')
    expect(blendOver('rgba(255,255,255,0)', '#414141')).toBe('#414141')
  })

  it('falls back to the foreground when the background is unparseable', () => {
    expect(blendOver('rgba(255,255,255,0.5)', 'var(--nope)')).toBe('#ffffff')
  })

  it('leaves an unparseable foreground untouched', () => {
    expect(blendOver('var(--nope)', '#414141')).toBe('var(--nope)')
  })

  it('always returns an opaque hex three.js can parse', () => {
    for (const fg of ['rgba(255,255,255,0.12)', 'rgba(0,0,0,0.28)', '#abc', 'rgb(1,2,3)']) {
      expect(blendOver(fg, '#414141')).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
