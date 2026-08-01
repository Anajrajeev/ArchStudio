import { describe, it, expect } from 'vitest'
import {
  levelWorkPlane,
  faceWorkPlane,
  offsetPlane,
  movePlaneOrigin,
  intersectPlane,
  worldToPlane,
  planeToWorld,
  planeYAxis,
  isHorizontal,
  worldToScene2D,
  scene2DToWorld,
  planeElevation,
  planeBadge,
  emptyPlaneHistory,
  pushPlane,
  previousPlane,
  nextPlane,
  v3normalize,
  v3dot,
  v3cross,
  v3length,
} from '../../../shared/geometry/workplane'
import type { Vec3 } from '../../../shared/types/scene'

const ray = (origin: Vec3, direction: Vec3) => ({ origin, direction })

describe('vector helpers', () => {
  it('normalizes and survives a zero vector', () => {
    expect(v3length(v3normalize([3, 0, 4]))).toBeCloseTo(1)
    expect(v3length(v3normalize([0, 0, 0]))).toBeCloseTo(1) // falls back to up
  })

  it('crosses vectors right-handed', () => {
    expect(v3cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1])
  })
})

describe('levelWorkPlane', () => {
  it('is horizontal at the level elevation', () => {
    const p = levelWorkPlane('lv1', 'Ground floor', 3)
    expect(p.normal).toEqual([0, 1, 0])
    expect(planeElevation(p)).toBe(3)
    expect(isHorizontal(p)).toBe(true)
  })

  it('maps world to scene 2D as [x, z] (the D-007 convention)', () => {
    const p = levelWorkPlane('lv1', 'L1', 2)
    expect(worldToScene2D(p, [4, 2, 7])).toEqual([4, 7])
    expect(scene2DToWorld([4, 7], 2)).toEqual([4, 2, 7])
  })

  it('badges with the level name and a signed elevation', () => {
    expect(planeBadge(levelWorkPlane('lv1', 'Ground floor', 0))).toBe('Ground floor @ +0.000')
    expect(planeBadge(levelWorkPlane('lv1', 'Basement', -2.5))).toBe('Basement @ -2.500')
  })
})

describe('faceWorkPlane', () => {
  it('builds an orthonormal frame from a normal', () => {
    const p = faceWorkPlane([1, 2, 3], [0, 0, 1], 'w1', 'face of Wall-1')
    expect(v3length(p.normal)).toBeCloseTo(1)
    expect(v3length(p.xAxis)).toBeCloseTo(1)
    // xAxis must lie in the plane.
    expect(v3dot(p.normal, p.xAxis)).toBeCloseTo(0)
    // And the derived Y axis completes the frame.
    expect(v3dot(planeYAxis(p), p.normal)).toBeCloseTo(0)
    expect(v3dot(planeYAxis(p), p.xAxis)).toBeCloseTo(0)
  })

  it('handles a normal parallel to world X without degenerating', () => {
    const p = faceWorkPlane([0, 0, 0], [1, 0, 0], 'w1', 'face')
    expect(v3length(p.xAxis)).toBeCloseTo(1)
    expect(v3dot(p.normal, p.xAxis)).toBeCloseTo(0)
  })

  it('is not horizontal, so scene-2D mapping refuses rather than lying', () => {
    const p = faceWorkPlane([0, 0, 0], [0, 0, 1], 'w1', 'face')
    expect(isHorizontal(p)).toBe(false)
    expect(worldToScene2D(p, [1, 2, 3])).toBeNull()
  })

  it('records the source for the status-bar badge', () => {
    const p = faceWorkPlane([0, 0, 0], [0, 0, 1], 'w1', 'face of Wall-12')
    expect(planeBadge(p)).toBe('face of Wall-12')
  })
})

describe('intersectPlane', () => {
  it('hits a horizontal plane from above', () => {
    const p = levelWorkPlane('lv1', 'L1', 0)
    const hit = intersectPlane(ray([2, 10, 3], [0, -1, 0]), p)
    expect(hit).not.toBeNull()
    expect(hit![0]).toBeCloseTo(2)
    expect(hit![1]).toBeCloseTo(0)
    expect(hit![2]).toBeCloseTo(3)
  })

  it('hits an elevated plane at the right height', () => {
    const p = levelWorkPlane('lv2', 'L2', 5)
    const hit = intersectPlane(ray([0, 10, 0], [0, -1, 0]), p)
    expect(hit![1]).toBeCloseTo(5)
  })

  it('returns null for a parallel ray', () => {
    const p = levelWorkPlane('lv1', 'L1', 0)
    expect(intersectPlane(ray([0, 5, 0], [1, 0, 0]), p)).toBeNull()
  })

  it('returns null when the plane is behind the ray origin', () => {
    const p = levelWorkPlane('lv1', 'L1', 0)
    // Looking up, away from the plane below.
    expect(intersectPlane(ray([0, 5, 0], [0, 1, 0]), p)).toBeNull()
  })

  it('hits an angled ray at the expected point', () => {
    const p = levelWorkPlane('lv1', 'L1', 0)
    const hit = intersectPlane(ray([0, 4, 0], [1, -1, 0]), p)
    expect(hit![0]).toBeCloseTo(4)
    expect(hit![1]).toBeCloseTo(0)
  })
})

describe('plane coordinate round-trip', () => {
  it('round-trips through a horizontal plane', () => {
    const p = levelWorkPlane('lv1', 'L1', 2)
    const world: Vec3 = [3, 2, -4]
    const local = worldToPlane(p, world)
    const back = planeToWorld(p, local)
    expect(back[0]).toBeCloseTo(world[0])
    expect(back[1]).toBeCloseTo(world[1])
    expect(back[2]).toBeCloseTo(world[2])
  })

  it('round-trips through a vertical face plane', () => {
    const p = faceWorkPlane([1, 1, 1], [0, 0, 1], 'w1', 'face')
    const local: [number, number] = [2, 3]
    const world = planeToWorld(p, local)
    const back = worldToPlane(p, world)
    expect(back[0]).toBeCloseTo(local[0])
    expect(back[1]).toBeCloseTo(local[1])
  })
})

describe('plane transforms', () => {
  it('offsets along the normal', () => {
    const p = offsetPlane(levelWorkPlane('lv1', 'L1', 1), 2)
    expect(planeElevation(p)).toBeCloseTo(3)
  })

  it('moves the origin without changing orientation', () => {
    const base = levelWorkPlane('lv1', 'L1', 0)
    const moved = movePlaneOrigin(base, [5, 0, 5])
    expect(moved.origin).toEqual([5, 0, 5])
    expect(moved.normal).toEqual(base.normal)
  })
})

describe('plane history', () => {
  const a = levelWorkPlane('a', 'A', 0)
  const b = levelWorkPlane('b', 'B', 3)
  const c = levelWorkPlane('c', 'C', 6)

  it('returns null when there is nothing to go back to', () => {
    expect(previousPlane(emptyPlaneHistory, a)).toBeNull()
    expect(nextPlane(emptyPlaneHistory, a)).toBeNull()
  })

  it('walks backwards and forwards through visited planes', () => {
    // Visit a, then b, then land on c.
    let history = pushPlane(emptyPlaneHistory, a)
    history = pushPlane(history, b)

    const back = previousPlane(history, c)
    expect(back).not.toBeNull()
    expect(back!.plane.source).toEqual(b.source)

    const forward = nextPlane(back!.history, back!.plane)
    expect(forward).not.toBeNull()
    expect(forward!.plane.source).toEqual(c.source)
  })

  it('pushing a plane clears the forward history', () => {
    let history = pushPlane(emptyPlaneHistory, a)
    const back = previousPlane(history, b)!
    expect(back.history.future).toHaveLength(1)
    history = pushPlane(back.history, c)
    expect(history.future).toHaveLength(0)
  })

  it('caps the history so a long session does not grow unbounded', () => {
    let history = emptyPlaneHistory
    for (let i = 0; i < 60; i++) {
      history = pushPlane(history, levelWorkPlane(`l${i}`, `L${i}`, i))
    }
    expect(history.past.length).toBeLessThanOrEqual(20)
  })
})
