import { describe, it, expect } from 'vitest'
import {
  distance,
  direction,
  perpendicular,
  wallFootprint,
  validateWall,
  validateOpening,
  validateRoomPolygon,
  polygonArea,
} from '../../../shared/geometry/index'
import type { Wall, Opening } from '../../../shared/types/scene'

const makeWall = (overrides: Partial<Wall> = {}): Wall => ({
  id: 'w1',
  storeyId: 's1',
  start: [0, 0],
  end: [5, 0],
  thickness: 0.2,
  height: 2.8,
  material: 'mat-plaster-white',
  ...overrides,
})

const makeOpening = (overrides: Partial<Opening> = {}): Opening => ({
  id: 'o1',
  wallId: 'w1',
  type: 'door',
  offset: 1.0,
  width: 0.9,
  height: 2.1,
  sillHeight: 0,
  ...overrides,
})

describe('distance', () => {
  it('computes distance between two points', () => {
    expect(distance([0, 0], [3, 4])).toBeCloseTo(5)
  })

  it('returns 0 for identical points', () => {
    expect(distance([1, 1], [1, 1])).toBe(0)
  })
})

describe('direction', () => {
  it('returns unit vector along X for horizontal segment', () => {
    const [dx, dy] = direction([0, 0], [5, 0])
    expect(dx).toBeCloseTo(1)
    expect(dy).toBeCloseTo(0)
  })

  it('handles zero-length segment without NaN', () => {
    const [dx, _dy] = direction([1, 1], [1, 1])
    expect(Number.isFinite(dx)).toBe(true)
  })
})

describe('perpendicular', () => {
  it('returns 90-degree rotation of input vector', () => {
    // perpendicular([1, 0]) = [-dir[1], dir[0]] = [0, 1]
    const [px, py] = perpendicular([1, 0])
    expect(px).toBeCloseTo(0)
    expect(py).toBeCloseTo(1)
  })
})

describe('wallFootprint', () => {
  it('returns 4 corners for a horizontal wall', () => {
    const corners = wallFootprint(makeWall())
    expect(corners).toHaveLength(4)
  })

  it('half-thickness offset is symmetric', () => {
    const wall = makeWall({ thickness: 0.4 })
    const corners = wallFootprint(wall)
    // For a wall along X axis, corners should have Y values of +0.2 and -0.2
    const ys = corners.map((c) => c[1])
    expect(Math.max(...ys)).toBeCloseTo(0.2)
    expect(Math.min(...ys)).toBeCloseTo(-0.2)
  })
})

describe('validateWall', () => {
  it('passes a valid wall', () => {
    expect(validateWall(makeWall())).toHaveLength(0)
  })

  it('rejects zero-length wall', () => {
    const errors = validateWall(makeWall({ start: [2, 2], end: [2, 2] }))
    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejects zero thickness', () => {
    const errors = validateWall(makeWall({ thickness: 0 }))
    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejects zero height', () => {
    const errors = validateWall(makeWall({ height: 0 }))
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('validateOpening', () => {
  it('passes a valid door', () => {
    expect(validateOpening(makeOpening(), makeWall())).toHaveLength(0)
  })

  it('rejects opening wider than wall', () => {
    const errors = validateOpening(makeOpening({ offset: 0, width: 6 }), makeWall())
    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejects opening that exceeds wall height', () => {
    const errors = validateOpening(makeOpening({ sillHeight: 1.0, height: 2.1 }), makeWall())
    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejects negative offset', () => {
    const errors = validateOpening(makeOpening({ offset: -0.1 }), makeWall())
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('polygonArea', () => {
  it('computes area of a rectangle', () => {
    const rect: [number, number][] = [[0, 0], [4, 0], [4, 3], [0, 3]]
    expect(Math.abs(polygonArea(rect))).toBeCloseTo(12)
  })
})

describe('validateRoomPolygon', () => {
  it('passes a valid square room', () => {
    const polygon: [number, number][] = [[0, 0], [5, 0], [5, 4], [0, 4]]
    expect(validateRoomPolygon(polygon)).toHaveLength(0)
  })

  it('rejects polygon with fewer than 3 points', () => {
    const errors = validateRoomPolygon([[0, 0], [1, 0]])
    expect(errors.length).toBeGreaterThan(0)
  })
})
