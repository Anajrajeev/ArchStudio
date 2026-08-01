/**
 * 3-point arc geometry — the arithmetic behind the curved-wall tool and the bulge drag handle (A1).
 *
 * Every test here is a round-trip against `arcInfo`/`baselinePolyline` rather than against a
 * hand-derived number. The bulge sign convention (positive sweeps CCW, which bows the arc to the
 * *right* of the direction of travel) is easy to get backwards and impossible to eyeball, so the
 * assertions check that the produced arc actually passes through the requested point.
 */
import { describe, it, expect } from 'vitest'
import {
  bulgeThroughPoint,
  baselineApex,
  circumcenter,
  arcInfo,
  baselinePolyline,
  baselineLength,
  distance,
  MAX_BULGE,
} from '../../../shared/geometry/index'
import type { Vec2, Baseline } from '../../../shared/types/scene'

/** Smallest distance from any tessellated point on the baseline to `p`. */
function distanceToBaseline(b: Baseline, p: Vec2): number {
  return Math.min(...baselinePolyline(b, 400).map((q) => distance(q, p)))
}

describe('circumcenter', () => {
  it('finds the centre of a circle through three points', () => {
    // Points at 3, 12 and 9 o'clock on a unit circle centred at [2,1].
    const c = circumcenter([3, 1], [2, 2], [1, 1])!
    expect(c[0]).toBeCloseTo(2, 9)
    expect(c[1]).toBeCloseTo(1, 9)
  })

  it('refuses collinear points', () => {
    expect(circumcenter([0, 0], [1, 0], [2, 0])).toBeNull()
  })
})

describe('bulgeThroughPoint', () => {
  it('produces an arc that actually passes through the requested point', () => {
    const start: Vec2 = [0, 0]
    const end: Vec2 = [4, 0]
    for (const through of [
      [2, 1],
      [2, -1],
      [2, 0.2],
      [1, 0.8],
      [3, -0.5],
      [2, 3],
    ] as Vec2[]) {
      const bulge = bulgeThroughPoint(start, end, through)
      const baseline: Baseline = { kind: 'arc', start, end, bulge }
      expect(distanceToBaseline(baseline, through)).toBeLessThan(0.01)
    }
  })

  it('works on a chord that is neither axis-aligned nor centred at the origin', () => {
    const start: Vec2 = [-3, 7]
    const end: Vec2 = [2.5, 4.25]
    const through: Vec2 = [-1, 4]
    const bulge = bulgeThroughPoint(start, end, through)
    expect(distanceToBaseline({ kind: 'arc', start, end, bulge }, through)).toBeLessThan(0.01)
  })

  it('a point at the semicircle apex gives |bulge| = 1', () => {
    // start→end along +X, so the left normal is +Y. Positive bulge sweeps CCW, which bows the arc
    // to −Y; a point at +Y must therefore give bulge −1.
    expect(bulgeThroughPoint([0, 0], [2, 0], [1, 1])).toBeCloseTo(-1, 9)
    expect(bulgeThroughPoint([0, 0], [2, 0], [1, -1])).toBeCloseTo(1, 9)
  })

  it('mirrors sign when the through point crosses the chord', () => {
    const a = bulgeThroughPoint([0, 0], [4, 0], [2, 0.7])
    const b = bulgeThroughPoint([0, 0], [4, 0], [2, -0.7])
    expect(a).toBeCloseTo(-b, 9)
  })

  it('reverses sign when the wall is drawn the other way', () => {
    // Same physical arc, drawn end-to-start: the sweep direction flips, so the bulge negates.
    const fwd = bulgeThroughPoint([0, 0], [4, 0], [2, 1])
    const rev = bulgeThroughPoint([4, 0], [0, 0], [2, 1])
    expect(fwd).toBeCloseTo(-rev, 9)
  })

  it('gives a minor arc for a shallow bow and a major arc for a deep one', () => {
    expect(Math.abs(bulgeThroughPoint([0, 0], [4, 0], [2, 0.3]))).toBeLessThan(1)
    expect(Math.abs(bulgeThroughPoint([0, 0], [4, 0], [2, 3]))).toBeGreaterThan(1)
  })

  it('the arc is longer than its chord, and grows with the bulge', () => {
    const chord = 4
    const shallow: Baseline = {
      kind: 'arc',
      start: [0, 0],
      end: [4, 0],
      bulge: bulgeThroughPoint([0, 0], [4, 0], [2, 0.5]),
    }
    const deep: Baseline = {
      kind: 'arc',
      start: [0, 0],
      end: [4, 0],
      bulge: bulgeThroughPoint([0, 0], [4, 0], [2, 1.5]),
    }
    expect(baselineLength(shallow)).toBeGreaterThan(chord)
    expect(baselineLength(deep)).toBeGreaterThan(baselineLength(shallow))
  })

  // ---- degradation, not NaN -------------------------------------------------

  it('degrades to straight when the through point is on the chord', () => {
    expect(bulgeThroughPoint([0, 0], [4, 0], [2, 0])).toBe(0)
    expect(bulgeThroughPoint([0, 0], [4, 0], [7, 0])).toBe(0)
  })

  it('degrades to straight for a degenerate chord', () => {
    expect(bulgeThroughPoint([1, 1], [1, 1], [2, 2])).toBe(0)
  })

  it('degrades to straight rather than emitting a NaN bulge', () => {
    for (const through of [
      [2, 1e-9],
      [0, 0],
      [4, 0],
    ] as Vec2[]) {
      const b = bulgeThroughPoint([0, 0], [4, 0], through)
      expect(Number.isFinite(b)).toBe(true)
    }
  })

  it('clamps rather than letting the arc close on itself', () => {
    const b = bulgeThroughPoint([0, 0], [0.001, 0], [0.0005, 500])
    expect(Math.abs(b)).toBeLessThanOrEqual(MAX_BULGE)
    expect(arcInfo([0, 0], [0.001, 0], b)).not.toBeNull()
  })
})

describe('baselineApex — where the bulge handle sits', () => {
  it('is the chord midpoint for a straight baseline', () => {
    expect(baselineApex({ kind: 'line', start: [0, 0], end: [4, 2] })).toEqual([2, 1])
  })

  it('is the chord midpoint for a zero-bulge arc', () => {
    expect(baselineApex({ kind: 'arc', start: [0, 0], end: [4, 0], bulge: 0 })).toEqual([2, 0])
  })

  it('lies on the arc', () => {
    for (const bulge of [0.2, -0.2, 0.6, -1, 1, 2.5, -3]) {
      const b: Baseline = { kind: 'arc', start: [0, 0], end: [4, 0], bulge }
      expect(distanceToBaseline(b, baselineApex(b))).toBeLessThan(0.01)
    }
  })

  it('round-trips: the apex fed back through bulgeThroughPoint reproduces the bulge', () => {
    // This is the drag-handle invariant — grabbing the handle and releasing it without moving must
    // not change the wall.
    for (const bulge of [0.2, -0.45, 1, -1, 2]) {
      const b: Baseline = { kind: 'arc', start: [-1, 3], end: [5, 1], bulge }
      expect(bulgeThroughPoint(b.start, b.end, baselineApex(b))).toBeCloseTo(bulge, 6)
    }
  })

  it('is the farthest point of the arc from the chord', () => {
    const b: Baseline = { kind: 'arc', start: [0, 0], end: [4, 0], bulge: 0.6 }
    const apex = baselineApex(b)
    for (const p of baselinePolyline(b, 200)) {
      expect(Math.abs(p[1])).toBeLessThanOrEqual(Math.abs(apex[1]) + 1e-9)
    }
  })
})
