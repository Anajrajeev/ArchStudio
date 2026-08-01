/**
 * Transform verbs — copy, linear array, radial array, mirror, rotate (D4).
 *
 * The two things worth guarding hardest, because both are silent when wrong:
 *  - a mirrored arc must bow the other way (bulge encodes a SIGNED sweep), and
 *  - copying a wall must bring its openings and their fillings, mirroring `deleteElement`'s cascade.
 */
import { describe, it, expect } from 'vitest'
import {
  IDENTITY,
  applyTransform,
  compose,
  determinant,
  isReflection,
  mirror,
  radialStepAngle,
  rotation,
  transformBaseline,
  transformDirection,
  transformRotation,
  translation,
} from '../../../shared/geometry/transform'
import {
  copyBy,
  linearArray,
  mirrorAcross,
  moveBy,
  radialArray,
  rotateBy,
  MAX_ARRAY_COUNT,
  type TransformOutcome,
} from '../editor/transforms'
import { duplicateElement, transformElement, addColumn, addWall } from '../scene/mutations'
import { baselinePolyline, distance, resolveWall } from '../../../shared/geometry/index'
import type { Vec2 } from '../../../shared/types/scene'
import { fixture, withWall, withDoor } from './helpers'

/** Narrow a result that is expected to have succeeded. */
function ok(r: ReturnType<typeof copyBy>): TransformOutcome {
  if ('error' in r) throw new Error(`expected success, got: ${r.error}`)
  return r
}

// ---------------------------------------------------------------------------
// The transform algebra
// ---------------------------------------------------------------------------

describe('Transform2D', () => {
  it('the identity leaves points alone', () => {
    expect(applyTransform(IDENTITY, [3, -7])).toEqual([3, -7])
  })

  it('translates', () => {
    expect(applyTransform(translation(2, -1), [1, 1])).toEqual([3, 0])
  })

  it('rotates 90° counter-clockwise about the origin', () => {
    const p = applyTransform(rotation(90), [1, 0])
    expect(p[0]).toBeCloseTo(0, 9)
    expect(p[1]).toBeCloseTo(1, 9)
  })

  it('rotates about an arbitrary centre, leaving the centre fixed', () => {
    const c: Vec2 = [4, 2]
    const p = applyTransform(rotation(37, c), c)
    expect(p[0]).toBeCloseTo(4, 9)
    expect(p[1]).toBeCloseTo(2, 9)
  })

  it('four 90° rotations return to the start', () => {
    let p: Vec2 = [3, 1]
    for (let i = 0; i < 4; i++) p = applyTransform(rotation(90, [1, 1]), p)
    expect(p[0]).toBeCloseTo(3, 9)
    expect(p[1]).toBeCloseTo(1, 9)
  })

  it('mirrors across a horizontal axis', () => {
    const p = applyTransform(mirror([0, 0], [1, 0]), [3, 2])
    expect(p[0]).toBeCloseTo(3, 9)
    expect(p[1]).toBeCloseTo(-2, 9)
  })

  it('mirrors across a vertical axis not through the origin', () => {
    const p = applyTransform(mirror([5, 0], [5, 1]), [3, 2])
    expect(p[0]).toBeCloseTo(7, 9)
    expect(p[1]).toBeCloseTo(2, 9)
  })

  it('mirrors across a diagonal', () => {
    const p = applyTransform(mirror([0, 0], [1, 1]), [2, 0])
    expect(p[0]).toBeCloseTo(0, 9)
    expect(p[1]).toBeCloseTo(2, 9)
  })

  it('a mirror applied twice is the identity', () => {
    const m = mirror([1, 2], [4, -1])
    const p = applyTransform(m, applyTransform(m, [7, 3]))
    expect(p[0]).toBeCloseTo(7, 9)
    expect(p[1]).toBeCloseTo(3, 9)
  })

  it('leaves points on the mirror axis fixed', () => {
    const m = mirror([1, 1], [3, 3])
    const p = applyTransform(m, [2, 2])
    expect(p[0]).toBeCloseTo(2, 9)
    expect(p[1]).toBeCloseTo(2, 9)
  })

  it('degrades a degenerate mirror axis to the identity rather than NaN', () => {
    const m = mirror([2, 2], [2, 2])
    expect(applyTransform(m, [5, 9])).toEqual([5, 9])
  })

  it('detects reflections by orientation, not by construction', () => {
    expect(isReflection(mirror([0, 0], [1, 0]))).toBe(true)
    expect(isReflection(rotation(45))).toBe(false)
    expect(isReflection(translation(3, 3))).toBe(false)
    expect(determinant(rotation(31))).toBeCloseTo(1, 9)
    expect(determinant(mirror([0, 0], [0, 1]))).toBeCloseTo(-1, 9)
  })

  it('composes in apply-first-then-second order', () => {
    // Rotate 90° about the origin, then move +x by 10.
    const xf = compose(translation(10, 0), rotation(90))
    const p = applyTransform(xf, [1, 0])
    expect(p[0]).toBeCloseTo(10, 9)
    expect(p[1]).toBeCloseTo(1, 9)
  })

  it('transformDirection ignores the translation', () => {
    const d = transformDirection(translation(50, -20), [1, 0])
    expect(d).toEqual([1, 0])
  })
})

describe('transformBaseline', () => {
  it('keeps an arc bowing the same way under a rotation', () => {
    const b = transformBaseline(
      { kind: 'arc', start: [0, 0], end: [4, 0], bulge: 0.5 },
      rotation(37, [1, 1]),
    )
    expect(b.kind === 'arc' && b.bulge).toBeCloseTo(0.5, 9)
  })

  it('NEGATES an arc bulge under a mirror', () => {
    // Bulge is the tangent of a quarter of the SIGNED swept angle. Mirroring without flipping it
    // leaves the wall bowing the wrong way — the classic mirror bug.
    const b = transformBaseline(
      { kind: 'arc', start: [0, 0], end: [4, 0], bulge: 0.5 },
      mirror([0, 0], [1, 0]),
    )
    expect(b.kind === 'arc' && b.bulge).toBeCloseTo(-0.5, 9)
  })

  it('the mirrored arc really is the mirror image, point for point', () => {
    const original = { kind: 'arc' as const, start: [0, 0] as Vec2, end: [4, 0] as Vec2, bulge: 0.5 }
    const m = mirror([0, 0], [1, 0])
    const mirrored = transformBaseline(original, m)
    for (const p of baselinePolyline(original, 60)) {
      const expected = applyTransform(m, p)
      const nearest = Math.min(
        ...baselinePolyline(mirrored, 400).map((q) => distance(q, expected)),
      )
      expect(nearest).toBeLessThan(0.02)
    }
  })

  it('keeps a line a line', () => {
    const b = transformBaseline({ kind: 'line', start: [0, 0], end: [1, 0] }, rotation(90))
    expect(b.kind).toBe('line')
  })
})

describe('transformRotation', () => {
  it('adds a rotation', () => {
    expect(transformRotation(30, rotation(45))).toBeCloseTo(75, 6)
  })

  it('is unchanged by a pure translation', () => {
    expect(transformRotation(30, translation(9, 9))).toBeCloseTo(30, 6)
  })

  it('reflects across a horizontal mirror axis', () => {
    expect(transformRotation(30, mirror([0, 0], [1, 0]))).toBeCloseTo(-30, 6)
  })
})

describe('radialStepAngle', () => {
  it('divides a full circle by the ITEM count, so nothing overlaps the original', () => {
    // 5 copies + the original = 6 items, 60° apart.
    expect(radialStepAngle(360, 5)).toBeCloseTo(60, 9)
  })

  it('divides a partial fan by the COPY count, so the ends hit the bounds', () => {
    // 3 copies across 90° → 0°, 30°, 60°, 90°.
    expect(radialStepAngle(90, 3)).toBeCloseTo(30, 9)
  })

  it('handles a single copy', () => {
    expect(radialStepAngle(180, 1)).toBeCloseTo(180, 9)
  })
})

// ---------------------------------------------------------------------------
// duplicateElement — the cascade
// ---------------------------------------------------------------------------

describe('duplicateElement', () => {
  it('copies a wall with its openings AND their fillings', () => {
    const { scene, wallId } = withDoor(2.5)
    const r = duplicateElement(scene, wallId)!
    expect(r.scene.walls).toHaveLength(2)
    expect(r.scene.openings).toHaveLength(2)
    expect(r.scene.fillings).toHaveLength(2)

    // The copied opening hosts on the COPIED wall, and its filling points at the copied opening.
    const newOpening = r.scene.openings.find((o) => o.hostId === r.id)!
    expect(newOpening.id).not.toBe(scene.openings[0].id)
    expect(r.scene.fillings.some((f) => f.openingId === newOpening.id)).toBe(true)
  })

  it('gives the copy fresh ids throughout', () => {
    const { scene, wallId } = withDoor()
    const r = duplicateElement(scene, wallId)!
    const ids = [
      ...r.scene.walls.map((w) => w.id),
      ...r.scene.openings.map((o) => o.id),
      ...r.scene.fillings.map((f) => f.id),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('does not share array references with the original', () => {
    const { scene, wallId } = withWall(5)
    const r = duplicateElement(scene, wallId)!
    const after = transformElement(r.scene, r.id, translation(0, 5))
    // The original must be untouched.
    expect(after.walls.find((w) => w.id === wallId)!.baseline.start).toEqual([0, 0])
  })

  it('refuses to duplicate a hosted opening or filling on its own', () => {
    const { scene, openingId, fillingId } = withDoor()
    expect(duplicateElement(scene, openingId)).toBeNull()
    expect(duplicateElement(scene, fillingId)).toBeNull()
  })

  it('refuses an unknown id', () => {
    const { scene } = withWall()
    expect(duplicateElement(scene, 'nope')).toBeNull()
  })
})

describe('transformElement', () => {
  it('rotates a column position AND its own rotation', () => {
    const f = fixture()
    const r = addColumn(f.scene, f.levelId, 'ct-rect-300', [2, 0])
    const after = transformElement(r.scene, r.id, rotation(90))
    const c = after.columns[0]
    expect(c.position[0]).toBeCloseTo(0, 9)
    expect(c.position[1]).toBeCloseTo(2, 9)
    expect(c.rotation).toBeCloseTo(90, 6)
  })

  it('is a no-op for a hosted opening — it moves because its wall moved', () => {
    const { scene, openingId } = withDoor()
    expect(transformElement(scene, openingId, translation(3, 3))).toBe(scene)
  })
})

// ---------------------------------------------------------------------------
// The verbs
// ---------------------------------------------------------------------------

describe('moveBy', () => {
  it('moves the selection and keeps it selected', () => {
    const { scene, wallId } = withWall(5)
    const r = ok(moveBy(scene, [wallId], [1, 2]))
    expect(r.scene.walls[0].baseline.start).toEqual([1, 2])
    expect(r.selectAfter).toEqual([wallId])
  })

  it('refuses a zero move', () => {
    const { scene, wallId } = withWall(5)
    expect(moveBy(scene, [wallId], [0, 0])).toHaveProperty('error')
  })

  it('refuses an empty selection', () => {
    const { scene } = withWall(5)
    expect(moveBy(scene, [], [1, 1])).toHaveProperty('error')
  })
})

describe('copyBy', () => {
  it('leaves the copy selected, not the original', () => {
    const { scene, wallId } = withWall(5)
    const r = ok(copyBy(scene, [wallId], [0, 3]))
    expect(r.scene.walls).toHaveLength(2)
    expect(r.selectAfter).toHaveLength(1)
    expect(r.selectAfter[0]).not.toBe(wallId)
  })

  it('offsets the copy and leaves the original where it was', () => {
    const { scene, wallId } = withWall(5)
    const r = ok(copyBy(scene, [wallId], [0, 3]))
    const original = r.scene.walls.find((w) => w.id === wallId)!
    const copy = r.scene.walls.find((w) => w.id !== wallId)!
    expect(original.baseline.start).toEqual([0, 0])
    expect(copy.baseline.start).toEqual([0, 3])
  })

  it('refuses a zero-distance copy rather than stacking on the original', () => {
    const { scene, wallId } = withWall(5)
    expect(copyBy(scene, [wallId], [0, 0])).toHaveProperty('error')
  })
})

describe('linearArray', () => {
  it('count is the number of COPIES, so 3 leaves 4 elements', () => {
    const { scene, wallId } = withWall(5)
    const r = ok(linearArray(scene, [wallId], [0, 3], 3))
    expect(r.scene.walls).toHaveLength(4)
    expect(r.selectAfter).toHaveLength(3)
  })

  it('spaces the copies evenly along the delta', () => {
    const { scene, wallId } = withWall(5)
    const r = ok(linearArray(scene, [wallId], [0, 3], 3))
    const ys = r.scene.walls.map((w) => w.baseline.start[1]).sort((a, b) => a - b)
    expect(ys[0]).toBeCloseTo(0, 9)
    expect(ys[1]).toBeCloseTo(3, 9)
    expect(ys[2]).toBeCloseTo(6, 9)
    expect(ys[3]).toBeCloseTo(9, 9)
  })

  it('carries openings into every copy', () => {
    const { scene, wallId } = withDoor()
    const r = ok(linearArray(scene, [wallId], [0, 4], 2))
    expect(r.scene.walls).toHaveLength(3)
    expect(r.scene.openings).toHaveLength(3)
    expect(r.scene.fillings).toHaveLength(3)
  })

  it('arrays a multi-selection as a unit', () => {
    const f = fixture()
    let sc = addWall(f.scene, {
      levelId: f.levelId,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [0, 0], end: [4, 0] },
    })
    const a = sc.id
    sc = addWall(sc.scene, {
      levelId: f.levelId,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [0, 1], end: [4, 1] },
    })
    const r = ok(linearArray(sc.scene, [a, sc.id], [0, 5], 2))
    expect(r.scene.walls).toHaveLength(6)
    expect(r.selectAfter).toHaveLength(4)
  })

  it('refuses a count below 1 and a count above the cap', () => {
    const { scene, wallId } = withWall(5)
    expect(linearArray(scene, [wallId], [0, 1], 0)).toHaveProperty('error')
    expect(linearArray(scene, [wallId], [0, 1], MAX_ARRAY_COUNT + 1)).toHaveProperty('error')
  })

  it('refuses zero spacing rather than stacking every copy', () => {
    const { scene, wallId } = withWall(5)
    expect(linearArray(scene, [wallId], [0, 0], 5)).toHaveProperty('error')
  })
})

describe('radialArray', () => {
  it('spreads a full ring so the last copy does not land on the original', () => {
    const f = fixture()
    const c = addColumn(f.scene, f.levelId, 'ct-rect-300', [3, 0])
    const r = ok(radialArray(c.scene, [c.id], [0, 0], 360, 5))
    expect(r.scene.columns).toHaveLength(6)

    // All 6 sit on the same radius, at distinct angles.
    const angles = r.scene.columns.map((col) =>
      Math.round(((Math.atan2(col.position[1], col.position[0]) * 180) / Math.PI + 360) % 360),
    )
    expect(new Set(angles).size).toBe(6)
    for (const col of r.scene.columns) {
      expect(Math.hypot(col.position[0], col.position[1])).toBeCloseTo(3, 6)
    }
  })

  it('puts the ends of a partial fan on the requested bounds', () => {
    const f = fixture()
    const c = addColumn(f.scene, f.levelId, 'ct-rect-300', [3, 0])
    const r = ok(radialArray(c.scene, [c.id], [0, 0], 90, 3))
    const angles = r.scene.columns
      .map((col) => (Math.atan2(col.position[1], col.position[0]) * 180) / Math.PI)
      .sort((a, b) => a - b)
    expect(angles[0]).toBeCloseTo(0, 6)
    expect(angles[3]).toBeCloseTo(90, 6)
  })

  it('rotates the copies with the ring', () => {
    const f = fixture()
    const c = addColumn(f.scene, f.levelId, 'ct-rect-300', [3, 0])
    const r = ok(radialArray(c.scene, [c.id], [0, 0], 360, 3))
    const rotations = r.scene.columns.map((col) => Math.round(col.rotation))
    expect(new Set(rotations).size).toBeGreaterThan(1)
  })

  it('refuses a zero angle and a zero count', () => {
    const f = fixture()
    const c = addColumn(f.scene, f.levelId, 'ct-rect-300', [3, 0])
    expect(radialArray(c.scene, [c.id], [0, 0], 0, 3)).toHaveProperty('error')
    expect(radialArray(c.scene, [c.id], [0, 0], 360, 0)).toHaveProperty('error')
  })
})

describe('mirrorAcross', () => {
  it('mirrors in place when the original is not kept', () => {
    const { scene, wallId } = withWall(5)
    const moved = ok(moveBy(scene, [wallId], [0, 2])).scene
    const r = ok(mirrorAcross(moved, [wallId], [0, 0], [1, 0], false))
    expect(r.scene.walls).toHaveLength(1)
    expect(r.scene.walls[0].baseline.start[1]).toBeCloseTo(-2, 9)
  })

  it('makes a mirrored copy when the original is kept, and selects the copy', () => {
    const { scene, wallId } = withWall(5)
    const moved = ok(moveBy(scene, [wallId], [0, 2])).scene
    const r = ok(mirrorAcross(moved, [wallId], [0, 0], [1, 0], true))
    expect(r.scene.walls).toHaveLength(2)
    expect(r.selectAfter[0]).not.toBe(wallId)
    expect(r.scene.walls.find((w) => w.id === wallId)!.baseline.start[1]).toBeCloseTo(2, 9)
  })

  it('flips a curved wall so it bows the other way', () => {
    const f = fixture()
    const w = addWall(f.scene, {
      levelId: f.levelId,
      typeId: 'wt-ext-200',
      baseline: { kind: 'arc', start: [0, 1], end: [4, 1], bulge: 0.5 },
    })
    const r = ok(mirrorAcross(w.scene, [w.id], [0, 0], [1, 0], false))
    const b = r.scene.walls[0].baseline
    expect(b.kind === 'arc' && b.bulge).toBeCloseTo(-0.5, 9)
  })

  it('preserves wall thickness — the type reference is untouched', () => {
    const { scene, wallId } = withWall(5)
    const before = resolveWall(scene, scene.walls[0])!.thickness
    const r = ok(mirrorAcross(scene, [wallId], [0, -3], [1, -3], true))
    for (const w of r.scene.walls) {
      expect(resolveWall(r.scene, w)!.thickness).toBeCloseTo(before, 9)
    }
  })

  it('refuses a degenerate axis', () => {
    const { scene, wallId } = withWall(5)
    expect(mirrorAcross(scene, [wallId], [1, 1], [1, 1], false)).toHaveProperty('error')
  })
})

describe('rotateBy', () => {
  it('rotates in place about a given centre', () => {
    const { scene, wallId } = withWall(4)
    const r = ok(rotateBy(scene, [wallId], [0, 0], 90, false))
    const b = r.scene.walls[0].baseline
    expect(b.start[0]).toBeCloseTo(0, 9)
    expect(b.end[0]).toBeCloseTo(0, 9)
    expect(b.end[1]).toBeCloseTo(4, 9)
  })

  it('makes a rotated copy when asked', () => {
    const { scene, wallId } = withWall(4)
    const r = ok(rotateBy(scene, [wallId], [0, 0], 90, true))
    expect(r.scene.walls).toHaveLength(2)
    expect(r.selectAfter[0]).not.toBe(wallId)
  })

  it('preserves length', () => {
    const { scene, wallId } = withWall(4)
    const r = ok(rotateBy(scene, [wallId], [1, 1], 37, false))
    const b = r.scene.walls[0].baseline
    expect(distance(b.start, b.end)).toBeCloseTo(4, 9)
  })

  it('refuses a zero or full-turn rotation', () => {
    const { scene, wallId } = withWall(4)
    expect(rotateBy(scene, [wallId], [0, 0], 0, false)).toHaveProperty('error')
    expect(rotateBy(scene, [wallId], [0, 0], 360, false)).toHaveProperty('error')
  })
})
