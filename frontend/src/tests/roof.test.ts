/**
 * Roof geometry tests (B1) — rectangular hip/gable/pyramid, scoped per DECISIONS.md D-018.
 */
import { describe, it, expect } from 'vitest'
import {
  rectangleFrame,
  resolveRoof,
  isRoofError,
  defaultRoof,
} from '../../../shared/geometry/roof'
import type { Roof, Vec2 } from '../../../shared/types/scene'

const DEG = Math.PI / 180

function rect(w: number, l: number): Vec2[] {
  return [
    [0, 0],
    [w, 0],
    [w, l],
    [0, l],
  ]
}

function makeRoof(footprint: Vec2[], angle: number, overhang = 0, baseHeight = 3): Roof {
  return {
    id: 'roof1',
    typeId: 'rt-tile-250',
    levelId: 'lv1',
    footprint,
    edges: footprint.map(() => ({ angle, overhang })),
    baseHeight,
  }
}

// ---------------------------------------------------------------------------
// rectangleFrame
// ---------------------------------------------------------------------------

describe('rectangleFrame', () => {
  it('detects an axis-aligned rectangle', () => {
    const frame = rectangleFrame(rect(6, 10))!
    expect(frame).not.toBeNull()
    expect(frame.width).toBeCloseTo(6)
    expect(frame.length).toBeCloseTo(10)
  })

  it('detects a rotated rectangle', () => {
    // Rotate a 4x8 rectangle by 30 degrees.
    const a = 30 * DEG
    const corners: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 8],
      [0, 8],
    ].map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)])
    const frame = rectangleFrame(corners)!
    expect(frame).not.toBeNull()
    expect(frame.width).toBeCloseTo(4)
    expect(frame.length).toBeCloseTo(8)
  })

  it('rejects a non-rectangular quadrilateral', () => {
    const trapezoid: Vec2[] = [
      [0, 0],
      [6, 0],
      [5, 4],
      [1, 4],
    ]
    expect(rectangleFrame(trapezoid)).toBeNull()
  })

  it('rejects a triangle', () => {
    expect(rectangleFrame([[0, 0], [4, 0], [2, 3]])).toBeNull()
  })

  it('rejects a degenerate (zero-length edge) quadrilateral', () => {
    expect(rectangleFrame([[0, 0], [0, 0], [4, 4], [0, 4]])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// resolveRoof — validation / refusals
// ---------------------------------------------------------------------------

describe('resolveRoof — refusals', () => {
  it('refuses a non-rectangular footprint', () => {
    const roof = makeRoof([[0, 0], [6, 0], [5, 4], [1, 4]], 30)
    const r = resolveRoof(roof)
    expect(isRoofError(r)).toBe(true)
  })

  it('refuses mismatched per-edge angles', () => {
    const roof = makeRoof(rect(6, 10), 30)
    roof.edges[1].angle = 45
    const r = resolveRoof(roof)
    expect(isRoofError(r)).toBe(true)
    if (isRoofError(r)) expect(r.error).toMatch(/matching slope angles/)
  })

  it('refuses an angle of 0 (flat is a parapet, not a roof)', () => {
    const roof = makeRoof(rect(6, 10), 0)
    expect(isRoofError(resolveRoof(roof))).toBe(true)
  })

  it('refuses an angle of 90 or more', () => {
    expect(isRoofError(resolveRoof(makeRoof(rect(6, 10), 90)))).toBe(true)
    expect(isRoofError(resolveRoof(makeRoof(rect(6, 10), 120)))).toBe(true)
  })

  it('refuses a negative overhang', () => {
    const roof = makeRoof(rect(6, 10), 30, -0.1)
    expect(isRoofError(resolveRoof(roof))).toBe(true)
  })

  it('refuses a mismatched edges/footprint length', () => {
    const roof = makeRoof(rect(6, 10), 30)
    roof.edges = roof.edges.slice(0, 2)
    expect(isRoofError(resolveRoof(roof))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// resolveRoof — hip roof (rectangle, W != L)
// ---------------------------------------------------------------------------

describe('resolveRoof — hip roof geometry', () => {
  const roof = makeRoof(rect(6, 10), 45, 0, 3) // tan(45) = 1
  const r = resolveRoof(roof)
  if (isRoofError(r)) throw new Error('expected success')

  it('produces 4 faces (2 trapezoids + 2 hip triangles)', () => {
    expect(r.faces).toHaveLength(4)
  })

  it('computes the ridge height from the SHORT dimension, independent of overhang', () => {
    // short = 6, half = 3, tan(45) = 1 => rise = 3, ridgeHeight = base + 3
    expect(r.ridgeHeight).toBeCloseTo(6)
  })

  it('the ridge is a real segment (W != L) with the expected length', () => {
    expect(r.ridge).not.toBeNull()
    const [a, b] = r.ridge!
    const ridgeLen = Math.hypot(b[0] - a[0], b[2] - a[2])
    // ridge length = L - W = 10 - 6 = 4
    expect(ridgeLen).toBeCloseTo(4)
  })

  it('ridge points sit at ridgeHeight', () => {
    const [a, b] = r.ridge!
    expect(a[1]).toBeCloseTo(r.ridgeHeight)
    expect(b[1]).toBeCloseTo(r.ridgeHeight)
  })

  it('eave corners sit at baseHeight when overhang is 0', () => {
    const eaveY = r.faces[0].vertices[0][1]
    expect(eaveY).toBeCloseTo(3)
  })
})

describe('resolveRoof — overhang lowers the eave but not the ridge', () => {
  const noOverhang = resolveRoof(makeRoof(rect(6, 10), 45, 0, 3))
  const withOverhang = resolveRoof(makeRoof(rect(6, 10), 45, 0.5, 3))
  if (isRoofError(noOverhang) || isRoofError(withOverhang)) throw new Error('expected success')

  it('ridge height is unchanged by overhang', () => {
    expect(withOverhang.ridgeHeight).toBeCloseTo(noOverhang.ridgeHeight)
  })

  it('eave corners are lower than the wall-line by overhang * tan(angle)', () => {
    const eaveY = withOverhang.faces[0].vertices[0][1]
    // overhang 0.5, tan(45) = 1 => drop of 0.5 below baseHeight (3)
    expect(eaveY).toBeCloseTo(2.5)
  })
})

// ---------------------------------------------------------------------------
// resolveRoof — pyramid (square footprint)
// ---------------------------------------------------------------------------

describe('resolveRoof — pyramid on a square footprint', () => {
  const roof = makeRoof(rect(6, 6), 45, 0, 3)
  const r = resolveRoof(roof)
  if (isRoofError(r)) throw new Error('expected success')

  it('produces 4 triangular faces meeting at one apex', () => {
    expect(r.faces).toHaveLength(4)
    for (const f of r.faces) expect(f.vertices).toHaveLength(3)
  })

  it('has no ridge segment — a single apex point instead', () => {
    expect(r.ridge).toBeNull()
  })

  it('apex height matches half the footprint width times tan(angle)', () => {
    const apexY = r.faces[0].vertices[2][1]
    expect(apexY).toBeCloseTo(3 + 3 * 1) // half of 6 = 3, tan(45) = 1
  })
})

// ---------------------------------------------------------------------------
// defaultRoof
// ---------------------------------------------------------------------------

describe('defaultRoof', () => {
  it('creates one edge spec per footprint vertex, all agreeing', () => {
    const footprint = rect(5, 8)
    const roof = defaultRoof('r1', 'rt-tile-250', 'lv1', footprint, 3)
    expect(roof.edges).toHaveLength(4)
    expect(roof.edges.every((e) => e.angle === 30)).toBe(true)
    const r = resolveRoof(roof)
    expect(isRoofError(r)).toBe(false)
  })
})
