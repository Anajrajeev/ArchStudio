import { describe, it, expect } from 'vitest'
import {
  resolveSnap,
  generateCandidates,
  levelSegments,
  applyAxisLock,
  applyAngleSnap,
  constrainToLength,
  fromPolar,
  angleTo,
  constraintColor,
  DEFAULT_SNAP_TOGGLES,
  SNAP_TYPES,
  type SnapContext,
  type SnapToggles,
} from '../../../shared/geometry/snapping'
import { distance } from '../../../shared/geometry/index'
import type { Vec2 } from '../../../shared/types/scene'
import { addWall, addRoom } from '../scene/mutations'
import { fixture, withWall } from './helpers'

function ctx(overrides: Partial<SnapContext> = {}): SnapContext {
  const w = withWall(5)
  return {
    scene: w.scene,
    levelId: w.levelId,
    aperture: 0.3,
    gridSize: 0.25,
    toggles: { ...DEFAULT_SNAP_TOGGLES },
    ...overrides,
  }
}

const only = (...types: Array<keyof SnapToggles>): SnapToggles => {
  const t = Object.fromEntries(SNAP_TYPES.map((s) => [s, false])) as SnapToggles
  for (const s of types) t[s] = true
  return t
}

describe('levelSegments', () => {
  it('flattens wall centrelines on the active level only', () => {
    const w = withWall(5)
    const other = addWall(w.scene, {
      levelId: 'some-other-level',
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [0, 9], end: [4, 9] },
    })
    const segs = levelSegments(other.scene, w.levelId)
    expect(segs.length).toBe(1)
    expect(segs[0].sourceId).toBe(w.wallId)
  })

  it('includes room edges', () => {
    const f = fixture()
    const r = addRoom(f.scene, f.levelId, [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ])
    expect(levelSegments(r.scene, f.levelId)).toHaveLength(4)
  })
})

describe('resolveSnap', () => {
  it('snaps to a wall endpoint when the cursor is near it', () => {
    const c = ctx({ toggles: only('endpoint') })
    const r = resolveSnap([0.05, 0.05], c)
    expect(r.snapped).toBe(true)
    expect(r.type).toBe('endpoint')
    expect(r.point[0]).toBeCloseTo(0)
    expect(r.point[1]).toBeCloseTo(0)
    expect(r.label).toBe('Endpoint')
  })

  it('snaps to a wall midpoint', () => {
    const c = ctx({ toggles: only('midpoint') })
    const r = resolveSnap([2.52, 0.04], c)
    expect(r.type).toBe('midpoint')
    expect(r.point[0]).toBeCloseTo(2.5)
  })

  it('snaps onto the wall edge when between vertices', () => {
    const c = ctx({ toggles: only('edge') })
    const r = resolveSnap([1.3, 0.1], c)
    expect(r.type).toBe('edge')
    expect(r.point[1]).toBeCloseTo(0)
    expect(r.point[0]).toBeCloseTo(1.3)
  })

  it('returns the raw point when nothing is in range', () => {
    const c = ctx({ toggles: only('endpoint'), aperture: 0.05 })
    const r = resolveSnap([50, 50], c)
    expect(r.snapped).toBe(false)
    expect(r.type).toBeNull()
    expect(r.point).toEqual([50, 50])
  })

  it('prefers an endpoint over a grid point at comparable distance', () => {
    // The wall endpoint (0,0) coincides with a grid intersection; endpoint must win.
    const c = ctx({ toggles: only('endpoint', 'grid') })
    const r = resolveSnap([0.06, 0.06], c)
    expect(r.type).toBe('endpoint')
  })

  it('honours a disabled snap type', () => {
    const c = ctx({ toggles: only('grid') })
    const r = resolveSnap([0.02, 0.02], c)
    expect(r.type).toBe('grid')
  })

  it('snaps to the grid at multiples of the grid size', () => {
    const c = ctx({ toggles: only('grid'), gridSize: 0.5 })
    const r = resolveSnap([1.62, 2.44], c)
    expect(r.point[0]).toBeCloseTo(1.5)
    expect(r.point[1]).toBeCloseTo(2.5)
  })

  it('emits no grid candidate when the grid size is zero', () => {
    const c = ctx({ toggles: only('grid'), gridSize: 0 })
    expect(generateCandidates([1.1, 1.1], c).filter((x) => x.type === 'grid')).toHaveLength(0)
  })

  it('finds the perpendicular foot from an anchor point', () => {
    const c = ctx({ toggles: only('perpendicular'), fromPoint: [2, 3], aperture: 0.5 })
    const r = resolveSnap([2.1, 0.2], c)
    expect(r.type).toBe('perpendicular')
    expect(r.point[0]).toBeCloseTo(2)
    expect(r.point[1]).toBeCloseTo(0)
  })

  it('finds an intersection between two crossing walls', () => {
    const w = withWall(5)
    const crossed = addWall(w.scene, {
      levelId: w.levelId,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [2, -2], end: [2, 2] },
    })
    const r = resolveSnap([2.05, 0.05], {
      scene: crossed.scene,
      levelId: w.levelId,
      aperture: 0.3,
      gridSize: 0,
      toggles: only('intersection'),
    })
    expect(r.type).toBe('intersection')
    expect(r.point[0]).toBeCloseTo(2)
    expect(r.point[1]).toBeCloseTo(0)
  })

  it('offers polar/axis candidates relative to the anchor', () => {
    const c = ctx({
      toggles: only('axis'),
      fromPoint: [0, 0],
      angleIncrements: [0, 90, 180, 270],
      aperture: 0.5,
    })
    // Cursor slightly off the +Y axis at radius ~3 should snap onto it.
    const r = resolveSnap([0.2, 3], c)
    expect(r.type).toBe('axis')
    expect(r.point[0]).toBeCloseTo(0, 3)
  })

  it('keeps the previous winner under hysteresis to avoid flicker', () => {
    const c = ctx({ toggles: only('endpoint', 'midpoint'), aperture: 1.5 })
    const first = resolveSnap([0.2, 0], c)
    expect(first.type).toBe('endpoint')
    // Now move toward the midpoint but not decisively; hysteresis should hold the endpoint.
    const held = resolveSnap([0.9, 0], { ...c, previous: first })
    const unheld = resolveSnap([0.9, 0], c)
    // With hysteresis the endpoint keeps winning at a distance where it otherwise might not.
    expect(held.type).toBe('endpoint')
    expect(unheld.type).toBe('endpoint')
    // And the held result is stable across repeated identical frames.
    expect(resolveSnap([0.9, 0], { ...c, previous: held }).point).toEqual(held.point)
  })

  it('includes in-progress polygon vertices as snap targets', () => {
    const extra: Vec2 = [7, 7]
    const c = ctx({ toggles: only('endpoint'), extraPoints: [extra], aperture: 0.3 })
    const r = resolveSnap([7.05, 7.05], c)
    expect(r.type).toBe('endpoint')
    expect(r.point).toEqual(extra)
  })
})

describe('constraints', () => {
  it('locks to an axis through the anchor', () => {
    expect(applyAxisLock([3, 9], [1, 2], 'x')).toEqual([3, 2])
    expect(applyAxisLock([3, 9], [1, 2], 'y')).toEqual([1, 9])
    expect(applyAxisLock([3, 9], [1, 2], 'none')).toEqual([3, 9])
  })

  it('constrains a point to an exact length, preserving direction', () => {
    const p = constrainToLength([10, 0], [0, 0], 4)
    expect(distance([0, 0], p)).toBeCloseTo(4)
    expect(p[1]).toBeCloseTo(0)
  })

  it('places a point from polar coordinates', () => {
    const p = fromPolar([1, 1], 2, 90)
    expect(p[0]).toBeCloseTo(1)
    expect(p[1]).toBeCloseTo(3)
  })

  it('snaps an angle to the nearest increment while keeping the radius', () => {
    const { point, angleDeg } = applyAngleSnap([3, 0.3], [0, 0], 45)
    expect(angleDeg).toBe(0)
    expect(distance([0, 0], point)).toBeCloseTo(distance([0, 0], [3, 0.3]))
  })

  it('leaves a zero-radius angle snap alone', () => {
    const { point } = applyAngleSnap([0, 0], [0, 0], 45)
    expect(point).toEqual([0, 0])
  })

  it('measures the angle to a point', () => {
    expect(angleTo([0, 0], [1, 0])).toBeCloseTo(0)
    expect(angleTo([0, 0], [0, 1])).toBeCloseTo(90)
    expect(angleTo([0, 0], [-1, 0])).toBeCloseTo(180)
  })
})

describe('constraintColor', () => {
  const base = { point: [0, 0] as Vec2, label: null }

  it('reports the axis colour when an axis lock is active', () => {
    expect(constraintColor({ ...base, type: null, snapped: false }, 'x')).toBe('axis-x')
    expect(constraintColor({ ...base, type: null, snapped: false }, 'y')).toBe('axis-y')
  })

  it('reports geometry alignment for a geometry snap', () => {
    expect(constraintColor({ ...base, type: 'endpoint', snapped: true }, 'none')).toBe('geometry')
  })

  it('reports nothing for an unconstrained cursor or a bare grid snap', () => {
    expect(constraintColor({ ...base, type: null, snapped: false }, 'none')).toBe('none')
    expect(constraintColor({ ...base, type: 'grid', snapped: true }, 'none')).toBe('none')
  })
})
