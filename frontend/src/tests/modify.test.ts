/**
 * Modify verbs — trim, extend, split, offset, align (D3).
 *
 * The tests that matter most here are the refusals. These are the verbs users aim slightly wrong,
 * and the difference between a tool that feels solid and one that feels dangerous is whether a
 * near-miss says why or quietly mangles the model. Split gets the heaviest coverage because a wall
 * carries hosted openings whose offsets are measured along it.
 */
import { describe, it, expect } from 'vitest'
import {
  infiniteLineIntersection,
  parameterAlong,
  trimBaseline,
  extendBaseline,
  splitBaseline,
  nearestFraction,
  isModifyError,
} from '../../../shared/geometry/modify'
import {
  trimWall,
  extendWall,
  splitWall,
  offsetWall,
  alignElements,
  type ModifyOutcome,
} from '../editor/modifyVerbs'
import { addWall, addColumn, addFilledOpening } from '../scene/mutations'
import { baselineLength, distance, resolveWall } from '../../../shared/geometry/index'
import type { Baseline, SceneGraph, Vec2 } from '../../../shared/types/scene'
import { fixture, withWall } from './helpers'

function ok(r: ReturnType<typeof trimWall>): ModifyOutcome {
  if ('error' in r) throw new Error(`expected success, got: ${r.error}`)
  return r
}

/** A horizontal wall along +X and a vertical wall crossing it at x = 3. */
function crossing(): { scene: SceneGraph; levelId: string; hId: string; vId: string } {
  const f = fixture()
  const h = addWall(f.scene, {
    levelId: f.levelId,
    typeId: 'wt-ext-200',
    baseline: { kind: 'line', start: [0, 0], end: [6, 0] },
  })
  const v = addWall(h.scene, {
    levelId: f.levelId,
    typeId: 'wt-ext-200',
    baseline: { kind: 'line', start: [3, -2], end: [3, 2] },
  })
  return { scene: v.scene, levelId: f.levelId, hId: h.id, vId: v.id }
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

describe('infiniteLineIntersection', () => {
  it('finds a crossing', () => {
    expect(infiniteLineIntersection([0, 0], [4, 0], [2, -1], [2, 1])).toEqual([2, 0])
  })

  it('finds an intersection BEYOND both segments — that is what extend needs', () => {
    const x = infiniteLineIntersection([0, 0], [1, 0], [5, -1], [5, 1])!
    expect(x[0]).toBeCloseTo(5, 9)
    expect(x[1]).toBeCloseTo(0, 9)
  })

  it('returns null for parallel lines', () => {
    expect(infiniteLineIntersection([0, 0], [1, 0], [0, 1], [1, 1])).toBeNull()
  })

  it('returns null for collinear lines', () => {
    expect(infiniteLineIntersection([0, 0], [1, 0], [2, 0], [3, 0])).toBeNull()
  })
})

describe('parameterAlong', () => {
  it('is 0 at the start, 1 at the end, and unclamped outside', () => {
    expect(parameterAlong([0, 0], [0, 0], [4, 0])).toBeCloseTo(0, 9)
    expect(parameterAlong([4, 0], [0, 0], [4, 0])).toBeCloseTo(1, 9)
    expect(parameterAlong([6, 0], [0, 0], [4, 0])).toBeCloseTo(1.5, 9)
    expect(parameterAlong([-2, 0], [0, 0], [4, 0])).toBeCloseTo(-0.5, 9)
  })
})

describe('trimBaseline', () => {
  const target: Baseline = { kind: 'line', start: [0, 0], end: [6, 0] }
  const cutter: Baseline = { kind: 'line', start: [3, -2], end: [3, 2] }

  it('keeps the side the pick point is on', () => {
    const left = trimBaseline(target, cutter, [1, 0])
    expect(isModifyError(left)).toBe(false)
    if (!isModifyError(left)) expect(left.end[0]).toBeCloseTo(3, 9)

    const right = trimBaseline(target, cutter, [5, 0])
    if (!isModifyError(right)) {
      expect(right.start[0]).toBeCloseTo(3, 9)
      expect(right.end[0]).toBeCloseTo(6, 9)
    }
  })

  it('refuses when the cutter does not cross the target', () => {
    const away: Baseline = { kind: 'line', start: [9, -2], end: [9, 2] }
    expect(isModifyError(trimBaseline(target, away, [1, 0]))).toBe(true)
  })

  it('refuses parallel walls', () => {
    const parallel: Baseline = { kind: 'line', start: [0, 1], end: [6, 1] }
    expect(isModifyError(trimBaseline(target, parallel, [1, 0]))).toBe(true)
  })

  it('refuses arcs rather than picking an intersection arbitrarily', () => {
    const arc: Baseline = { kind: 'arc', start: [0, 0], end: [6, 0], bulge: 0.4 }
    expect(isModifyError(trimBaseline(arc, cutter, [1, 0]))).toBe(true)
    expect(isModifyError(trimBaseline(target, arc, [1, 0]))).toBe(true)
  })
})

describe('extendBaseline', () => {
  const target: Baseline = { kind: 'line', start: [0, 0], end: [4, 0] }
  const boundary: Baseline = { kind: 'line', start: [7, -2], end: [7, 2] }

  it('extends the end nearer the pick point', () => {
    const r = extendBaseline(target, boundary, [4, 0])
    expect(isModifyError(r)).toBe(false)
    if (!isModifyError(r)) {
      expect(r.start).toEqual([0, 0])
      expect(r.end[0]).toBeCloseTo(7, 9)
    }
  })

  it('extends backwards when the boundary is behind the start', () => {
    const behind: Baseline = { kind: 'line', start: [-3, -2], end: [-3, 2] }
    const r = extendBaseline(target, behind, [0, 0])
    if (!isModifyError(r)) {
      expect(r.start[0]).toBeCloseTo(-3, 9)
      expect(r.end).toEqual([4, 0])
    }
  })

  it('refuses when the picked end cannot reach the boundary', () => {
    // Boundary is beyond the END, but the pick is at the START.
    expect(isModifyError(extendBaseline(target, boundary, [0, 0]))).toBe(true)
  })

  it('refuses when the boundary already crosses — that is a trim', () => {
    const crossingB: Baseline = { kind: 'line', start: [2, -2], end: [2, 2] }
    expect(isModifyError(extendBaseline(target, crossingB, [4, 0]))).toBe(true)
  })
})

describe('splitBaseline', () => {
  it('splits a line into two pieces meeting at the split point', () => {
    const [a, b] = splitBaseline({ kind: 'line', start: [0, 0], end: [4, 0] }, 0.25)!
    expect(a.end).toEqual([1, 0])
    expect(b.start).toEqual([1, 0])
    expect(baselineLength(a) + baselineLength(b)).toBeCloseTo(4, 9)
  })

  it('splits an arc into two arcs whose lengths sum to the original', () => {
    const arc: Baseline = { kind: 'arc', start: [0, 0], end: [4, 0], bulge: 0.5 }
    const [a, b] = splitBaseline(arc, 0.4)!
    expect(a.kind).toBe('arc')
    expect(b.kind).toBe('arc')
    expect(baselineLength(a) + baselineLength(b)).toBeCloseTo(baselineLength(arc), 6)
  })

  it('splits an arc into pieces that share the original centre and radius', () => {
    const arc: Baseline = { kind: 'arc', start: [0, 0], end: [4, 0], bulge: 0.5 }
    const [a, b] = splitBaseline(arc, 0.4)!
    // Same sweep sign, and the two bulges recombine to the original sweep.
    const sweep = (x: Baseline) => (x.kind === 'arc' ? 4 * Math.atan(x.bulge) : 0)
    expect(sweep(a) + sweep(b)).toBeCloseTo(4 * Math.atan(0.5), 9)
  })

  it('refuses a split at either end', () => {
    const b: Baseline = { kind: 'line', start: [0, 0], end: [4, 0] }
    expect(splitBaseline(b, 0)).toBeNull()
    expect(splitBaseline(b, 1)).toBeNull()
    expect(splitBaseline(b, 1e-9)).toBeNull()
  })
})

describe('nearestFraction', () => {
  it('finds the fraction nearest a point on a line', () => {
    expect(nearestFraction({ kind: 'line', start: [0, 0], end: [4, 0] }, [1, 0.5])).toBeCloseTo(
      0.25,
      2,
    )
  })

  it('works on an arc', () => {
    const arc: Baseline = { kind: 'arc', start: [0, 0], end: [4, 0], bulge: 0.5 }
    const t = nearestFraction(arc, [2, -1])
    expect(t).toBeGreaterThan(0.3)
    expect(t).toBeLessThan(0.7)
  })
})

// ---------------------------------------------------------------------------
// Scene-level verbs
// ---------------------------------------------------------------------------

describe('trimWall', () => {
  it('trims to the crossing wall, keeping the clicked side', () => {
    const { scene, hId, vId } = crossing()
    const r = ok(trimWall(scene, hId, vId, [1, 0]))
    const wall = r.scene.walls.find((w) => w.id === hId)!
    expect(wall.baseline.end[0]).toBeCloseTo(3, 9)
    expect(r.selectAfter).toEqual([hId])
  })

  it('refuses to trim through an opening', () => {
    const { scene, hId, vId } = crossing()
    // A door at 4.0–4.9 lies on the discarded side when keeping the left half.
    const withDoorScene = addFilledOpening(scene, hId, 'dt-single-900', 4.45)!.scene
    const r = trimWall(withDoorScene, hId, vId, [1, 0])
    expect(r).toHaveProperty('error')
  })

  it('refuses when the same wall is given twice', () => {
    const { scene, hId } = crossing()
    expect(trimWall(scene, hId, hId, [1, 0])).toHaveProperty('error')
  })

  it('refuses an unknown id', () => {
    const { scene, hId } = crossing()
    expect(trimWall(scene, hId, 'nope', [1, 0])).toHaveProperty('error')
  })
})

describe('extendWall', () => {
  it('extends a wall to reach a distant boundary', () => {
    const f = fixture()
    const a = addWall(f.scene, {
      levelId: f.levelId,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [0, 0], end: [4, 0] },
    })
    const b = addWall(a.scene, {
      levelId: f.levelId,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [7, -2], end: [7, 2] },
    })
    const r = ok(extendWall(b.scene, a.id, b.id, [4, 0]))
    expect(r.scene.walls.find((w) => w.id === a.id)!.baseline.end[0]).toBeCloseTo(7, 9)
  })

  it('slides openings when the wall grows from its START, so they stay put in space', () => {
    const f = fixture()
    const a = addWall(f.scene, {
      levelId: f.levelId,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [0, 0], end: [4, 0] },
    })
    const withDoorScene = addFilledOpening(a.scene, a.id, 'dt-single-900', 2)!.scene
    const before = withDoorScene.openings[0].offset
    const b = addWall(withDoorScene, {
      levelId: f.levelId,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [-3, -2], end: [-3, 2] },
    })
    const r = ok(extendWall(b.scene, a.id, b.id, [0, 0]))
    // The wall grew 3 m at the start, so the offset must grow by 3 m too.
    expect(r.scene.openings[0].offset).toBeCloseTo(before + 3, 6)
  })
})

describe('splitWall', () => {
  it('produces two walls that together span the original', () => {
    const { scene, wallId } = withWall(6)
    const before = baselineLength(scene.walls[0].baseline)
    const r = ok(splitWall(scene, wallId, [2, 0]))
    expect(r.scene.walls).toHaveLength(2)
    const total = r.scene.walls.reduce((a, w) => a + baselineLength(w.baseline), 0)
    expect(total).toBeCloseTo(before, 6)
    expect(r.selectAfter).toHaveLength(2)
  })

  it('splits at the point nearest the click', () => {
    const { scene, wallId } = withWall(6)
    const r = ok(splitWall(scene, wallId, [2, 0.4]))
    const first = r.scene.walls.find((w) => w.id === wallId)!
    expect(first.baseline.end[0]).toBeCloseTo(2, 1)
  })

  it('keeps the type, level and top constraint on both pieces', () => {
    const { scene, wallId } = withWall(6)
    const original = scene.walls[0]
    const r = ok(splitWall(scene, wallId, [3, 0]))
    for (const w of r.scene.walls) {
      expect(w.typeId).toBe(original.typeId)
      expect(w.levelId).toBe(original.levelId)
      expect(w.top).toEqual(original.top)
      expect(w.locationLine).toBe(original.locationLine)
    }
  })

  it('hands each opening to the piece that contains it, rebasing the offset', () => {
    const { scene, wallId } = withWall(10)
    // Doors at 1.5 and 7.5, split at 5.
    let sc = addFilledOpening(scene, wallId, 'dt-single-900', 1.5)!.scene
    sc = addFilledOpening(sc, wallId, 'dt-single-900', 7.5)!.scene
    const r = ok(splitWall(sc, wallId, [5, 0]))

    expect(r.scene.openings).toHaveLength(2)
    expect(r.scene.fillings).toHaveLength(2)

    const first = r.scene.openings.find((o) => o.hostId === wallId)!
    const second = r.scene.openings.find((o) => o.hostId !== wallId)!
    // First door keeps its offset; the second is rebased to its new wall's start.
    expect(first.offset + first.width / 2).toBeCloseTo(1.5, 6)
    expect(second.offset + second.width / 2).toBeCloseTo(2.5, 6)
  })

  it('keeps each filling pointing at its own opening', () => {
    const { scene, wallId } = withWall(10)
    let sc = addFilledOpening(scene, wallId, 'dt-single-900', 1.5)!.scene
    sc = addFilledOpening(sc, wallId, 'dt-single-900', 7.5)!.scene
    const r = ok(splitWall(sc, wallId, [5, 0]))
    const openingIds = new Set(r.scene.openings.map((o) => o.id))
    for (const f of r.scene.fillings) expect(openingIds.has(f.openingId)).toBe(true)
    expect(new Set(r.scene.fillings.map((f) => f.openingId)).size).toBe(2)
  })

  it('refuses when an opening straddles the split point', () => {
    const { scene, wallId } = withWall(10)
    const sc = addFilledOpening(scene, wallId, 'dt-single-900', 5)!.scene
    expect(splitWall(sc, wallId, [5, 0])).toHaveProperty('error')
  })

  it('refuses a split at the very end of a wall', () => {
    const { scene, wallId } = withWall(6)
    expect(splitWall(scene, wallId, [0, 0])).toHaveProperty('error')
    expect(splitWall(scene, wallId, [6, 0])).toHaveProperty('error')
  })

  it('splits a curved wall into two curved walls', () => {
    const f = fixture()
    const w = addWall(f.scene, {
      levelId: f.levelId,
      typeId: 'wt-ext-200',
      baseline: { kind: 'arc', start: [0, 0], end: [6, 0], bulge: 0.5 },
    })
    const r = ok(splitWall(w.scene, w.id, [3, -1]))
    expect(r.scene.walls).toHaveLength(2)
    expect(r.scene.walls.every((x) => x.baseline.kind === 'arc')).toBe(true)
  })
})

describe('offsetWall', () => {
  it('moves the wall sideways when the original is not kept', () => {
    const { scene, wallId } = withWall(5)
    const r = ok(offsetWall(scene, wallId, 1, false))
    expect(r.scene.walls).toHaveLength(1)
    const b = r.scene.walls[0].baseline
    expect(Math.abs(b.start[1])).toBeCloseTo(1, 9)
  })

  it('makes a parallel copy when the original is kept, and selects the copy', () => {
    const { scene, wallId } = withWall(5)
    const r = ok(offsetWall(scene, wallId, 1, true))
    expect(r.scene.walls).toHaveLength(2)
    expect(r.selectAfter[0]).not.toBe(wallId)
    expect(r.scene.walls.find((w) => w.id === wallId)!.baseline.start[1]).toBeCloseTo(0, 9)
  })

  it('preserves length for a straight wall', () => {
    const { scene, wallId } = withWall(5)
    const r = ok(offsetWall(scene, wallId, 1.5, false))
    expect(baselineLength(r.scene.walls[0].baseline)).toBeCloseTo(5, 9)
  })

  it('offsets an arc by changing its radius, keeping the bulge', () => {
    const f = fixture()
    const w = addWall(f.scene, {
      levelId: f.levelId,
      typeId: 'wt-ext-200',
      baseline: { kind: 'arc', start: [0, 0], end: [6, 0], bulge: 0.5 },
    })
    const r = ok(offsetWall(w.scene, w.id, 0.5, false))
    const b = r.scene.walls[0].baseline
    expect(b.kind).toBe('arc')
    expect(b.kind === 'arc' && b.bulge).toBeCloseTo(0.5, 9)
    // Radius changed, so the arc length changed.
    expect(baselineLength(b)).not.toBeCloseTo(baselineLength(w.scene.walls[0].baseline), 3)
  })

  it('refuses a zero offset', () => {
    const { scene, wallId } = withWall(5)
    expect(offsetWall(scene, wallId, 0, true)).toHaveProperty('error')
  })

  it('opposite offsets land on opposite sides', () => {
    const { scene, wallId } = withWall(5)
    const a = ok(offsetWall(scene, wallId, 1, false)).scene.walls[0].baseline.start[1]
    const b = ok(offsetWall(scene, wallId, -1, false)).scene.walls[0].baseline.start[1]
    expect(Math.sign(a)).toBe(-Math.sign(b))
  })
})

describe('alignElements', () => {
  /** Three columns at x = 0, 4, 9 on the same level. */
  function threeColumns(): { scene: SceneGraph; ids: string[] } {
    const f = fixture()
    let sc: SceneGraph = f.scene
    const ids: string[] = []
    for (const x of [0, 4, 9]) {
      const r = addColumn(sc, f.levelId, 'ct-rect-300', [x, 0])
      sc = r.scene
      ids.push(r.id)
    }
    return { scene: sc, ids }
  }

  it('aligns to the minimum X of the selection', () => {
    const { scene, ids } = threeColumns()
    const r = ok(alignElements(scene, ids, 'x', 'min'))
    const xs = r.scene.columns.map((c) => c.position[0])
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0, 6)
    expect(xs[0]).toBeCloseTo(0, 6)
  })

  it('aligns to the maximum X', () => {
    const { scene, ids } = threeColumns()
    const r = ok(alignElements(scene, ids, 'x', 'max'))
    for (const c of r.scene.columns) expect(c.position[0]).toBeCloseTo(9, 6)
  })

  it('aligns to a reference element, leaving that element alone', () => {
    const { scene, ids } = threeColumns()
    const reference = ids[1] // x = 4
    const r = ok(alignElements(scene, ids, 'x', 'center', reference))
    for (const c of r.scene.columns) expect(c.position[0]).toBeCloseTo(4, 6)
  })

  it('aligns on Y without touching X', () => {
    const f = fixture()
    let sc: SceneGraph = f.scene
    const ids: string[] = []
    for (const p of [
      [0, 0],
      [3, 2],
    ] as Vec2[]) {
      const r = addColumn(sc, f.levelId, 'ct-rect-300', p)
      sc = r.scene
      ids.push(r.id)
    }
    const r = ok(alignElements(sc, ids, 'y', 'min'))
    expect(r.scene.columns.map((c) => c.position[0])).toEqual([0, 3])
    for (const c of r.scene.columns) expect(c.position[1]).toBeCloseTo(0, 6)
  })

  it('does not rotate a wall it aligns', () => {
    const f = fixture()
    const a = addWall(f.scene, {
      levelId: f.levelId,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [0, 0], end: [4, 2] },
    })
    const b = addColumn(a.scene, f.levelId, 'ct-rect-300', [9, 0])
    const r = ok(alignElements(b.scene, [a.id, b.id], 'x', 'min'))
    const wall = r.scene.walls[0]
    const dx = wall.baseline.end[0] - wall.baseline.start[0]
    const dy = wall.baseline.end[1] - wall.baseline.start[1]
    expect(dy / dx).toBeCloseTo(0.5, 9)
    expect(distance(wall.baseline.start, wall.baseline.end)).toBeCloseTo(
      Math.hypot(4, 2),
      9,
    )
  })

  it('refuses when everything is already aligned', () => {
    const f = fixture()
    let sc: SceneGraph = f.scene
    const ids: string[] = []
    for (const y of [0, 3]) {
      const r = addColumn(sc, f.levelId, 'ct-rect-300', [2, y])
      sc = r.scene
      ids.push(r.id)
    }
    expect(alignElements(sc, ids, 'x', 'min')).toHaveProperty('error')
  })

  it('refuses an empty selection', () => {
    const { scene } = withWall(5)
    expect(alignElements(scene, [], 'x', 'min')).toHaveProperty('error')
  })

  it('leaves wall thickness alone', () => {
    const { scene, wallId } = withWall(5)
    const before = resolveWall(scene, scene.walls[0])!.thickness
    const c = addColumn(scene, scene.walls[0].levelId, 'ct-rect-300', [9, 4])
    const r = ok(alignElements(c.scene, [wallId, c.id], 'y', 'min'))
    expect(resolveWall(r.scene, r.scene.walls[0])!.thickness).toBeCloseTo(before, 9)
  })
})
