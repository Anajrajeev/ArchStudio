import { describe, it, expect } from 'vitest'
import {
  distance,
  direction,
  perpendicular,
  projectPointToSegment,
  segmentIntersection,
  lineLineIntersection,
  polygonArea,
  polygonPerimeter,
  polygonCentroid,
  pointInPolygon,
  isSimplePolygon,
  baselineLength,
  baselinePolyline,
  baselinePointAt,
  offsetBaseline,
  arcInfo,
  locationLineOffset,
  resolveWall,
  resolveSlab,
  wallSolidBoxes,
  boxCorners,
  boxToTriMesh,
  columnSolid,
  beamSolid,
  validateWall,
  validateOpening,
  validateRoomPolygon,
  roomArea,
  rotationYFor,
  type Box3D,
} from '../../../shared/geometry/index'
import { defaultRoof } from '../../../shared/geometry/roof'
import { meshVolume, isWatertight } from '../../../shared/geometry/primitives'
import { assemblyThickness, type Vec2 } from '../../../shared/types/scene'
import { addSlab, addColumn, addBeam, addWall, addRoof, updateWall, updateOpening } from '../scene/mutations'
import { fixture, withWall, withDoor } from './helpers'

/** A wall on levelId sitting exactly on a roof's own eave line — B1 wall voiding fixture. */
function wallOnRoofEave() {
  const f = fixture()
  const footprint: Vec2[] = [
    [0, 0],
    [6, 0],
    [6, 4],
    [0, 4],
  ]
  const roof = defaultRoof('rf1', 'rt-tile-250', f.levelId, footprint, 3)
  const withRoof = addRoof(f.scene, roof)
  const w = addWall(withRoof, {
    levelId: f.levelId,
    typeId: 'wt-ext-200',
    baseline: { kind: 'line', start: [0, 0], end: [6, 0] },
  })
  const scene = updateWall(w.scene, w.id, { top: { kind: 'roof', roofId: roof.id } })
  return { scene, wallId: w.id, roofId: roof.id }
}

// ---------------------------------------------------------------------------
// 2D primitives
// ---------------------------------------------------------------------------

describe('2D primitives', () => {
  it('computes distance', () => {
    expect(distance([0, 0], [3, 4])).toBeCloseTo(5)
    expect(distance([1, 1], [1, 1])).toBe(0)
  })

  it('returns a unit direction and survives zero-length input', () => {
    const [dx, dy] = direction([0, 0], [5, 0])
    expect(dx).toBeCloseTo(1)
    expect(dy).toBeCloseTo(0)
    const [zx, zy] = direction([1, 1], [1, 1])
    expect(Number.isFinite(zx) && Number.isFinite(zy)).toBe(true)
  })

  it('rotates a vector 90 degrees', () => {
    const [px, py] = perpendicular([1, 0])
    expect(px).toBeCloseTo(0)
    expect(py).toBeCloseTo(1)
  })

  it('projects onto a segment and clamps past the ends', () => {
    const inside = projectPointToSegment([2, 1], [0, 0], [5, 0])
    expect(inside.t).toBeCloseTo(0.4)
    expect(inside.distance).toBeCloseTo(1)

    const past = projectPointToSegment([10, 0], [0, 0], [5, 0])
    expect(past.t).toBeCloseTo(1)
    expect(past.point[0]).toBeCloseTo(5)
  })

  it('projects onto a degenerate segment without NaN', () => {
    const p = projectPointToSegment([3, 3], [1, 1], [1, 1])
    expect(Number.isFinite(p.distance)).toBe(true)
    expect(p.point).toEqual([1, 1])
  })

  it('intersects crossing segments and rejects non-crossing ones', () => {
    expect(segmentIntersection([0, 0], [4, 0], [2, -2], [2, 2])).toEqual([2, 0])
    expect(segmentIntersection([0, 0], [1, 0], [5, -1], [5, 1])).toBeNull()
    expect(segmentIntersection([0, 0], [4, 0], [0, 1], [4, 1])).toBeNull() // parallel
  })

  it('intersects infinite lines, returning null when parallel', () => {
    const x = lineLineIntersection([0, 0], [1, 0], [2, -1], [0, 1])
    expect(x?.[0]).toBeCloseTo(2)
    expect(lineLineIntersection([0, 0], [1, 0], [0, 1], [1, 0])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Polygons
// ---------------------------------------------------------------------------

describe('polygons', () => {
  const rect: Vec2[] = [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ]

  it('computes area, perimeter and centroid', () => {
    expect(Math.abs(polygonArea(rect))).toBeCloseTo(12)
    expect(polygonPerimeter(rect)).toBeCloseTo(14)
    expect(polygonCentroid(rect)).toEqual([2, 1.5])
  })

  it('handles an empty polygon centroid', () => {
    expect(polygonCentroid([])).toEqual([0, 0])
  })

  it('tests point containment', () => {
    expect(pointInPolygon([2, 1], rect)).toBe(true)
    expect(pointInPolygon([5, 1], rect)).toBe(false)
  })

  it('detects self-intersection', () => {
    expect(isSimplePolygon(rect)).toBe(true)
    // A bowtie.
    expect(
      isSimplePolygon([
        [0, 0],
        [4, 4],
        [4, 0],
        [0, 4],
      ]),
    ).toBe(false)
    expect(isSimplePolygon([[0, 0], [1, 1]])).toBe(false)
  })

  it('validates room polygons, rejecting degenerate cases', () => {
    expect(validateRoomPolygon(rect)).toHaveLength(0)
    expect(validateRoomPolygon([[0, 0], [1, 0]]).length).toBeGreaterThan(0)
    // Zero area: three collinear points.
    expect(
      validateRoomPolygon([
        [0, 0],
        [1, 0],
        [2, 0],
      ]).length,
    ).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Baselines (line + arc)
// ---------------------------------------------------------------------------

describe('baselines', () => {
  it('measures a straight baseline as its chord', () => {
    expect(baselineLength({ kind: 'line', start: [0, 0], end: [3, 4] })).toBeCloseTo(5)
  })

  it('measures an arc baseline as arc length, longer than its chord', () => {
    const arc = { kind: 'arc' as const, start: [0, 0] as Vec2, end: [4, 0] as Vec2, bulge: 0.5 }
    const len = baselineLength(arc)
    expect(len).toBeGreaterThan(4)
    // A bulge of 0.5 sweeps 4*atan(0.5) ≈ 1.854 rad.
    const info = arcInfo(arc.start, arc.end, arc.bulge)
    expect(info).not.toBeNull()
    expect(len).toBeCloseTo(1.8546 * (info?.radius ?? 0), 2)
  })

  it('treats a zero bulge as straight', () => {
    expect(arcInfo([0, 0], [4, 0], 0)).toBeNull()
    const b = { kind: 'arc' as const, start: [0, 0] as Vec2, end: [4, 0] as Vec2, bulge: 0 }
    expect(baselineLength(b)).toBeCloseTo(4)
  })

  it('tessellates an arc into a polyline through both endpoints', () => {
    const pts = baselinePolyline({ kind: 'arc', start: [0, 0], end: [4, 0], bulge: 0.4 })
    expect(pts.length).toBeGreaterThan(3)
    expect(pts[0][0]).toBeCloseTo(0)
    expect(pts[pts.length - 1][0]).toBeCloseTo(4)
  })

  // Regression: the arc centre must be derived with a SIGNED radius, or the tessellated
  // polyline drifts off the end point (and curved walls render in the wrong place).
  it.each([-1.4, -0.9, -0.5, -0.1, 0.1, 0.5, 0.9, 1.4])(
    'arc with bulge %s starts and ends exactly on its endpoints',
    (bulge) => {
      const start: Vec2 = [1, 2]
      const end: Vec2 = [5, 3]
      const arc = { kind: 'arc' as const, start, end, bulge }

      const pts = baselinePolyline(arc)
      expect(pts[0][0]).toBeCloseTo(start[0], 6)
      expect(pts[0][1]).toBeCloseTo(start[1], 6)
      expect(pts[pts.length - 1][0]).toBeCloseTo(end[0], 6)
      expect(pts[pts.length - 1][1]).toBeCloseTo(end[1], 6)

      // Sampling by arc length must agree with the endpoints too.
      const len = baselineLength(arc)
      expect(baselinePointAt(arc, 0).point[0]).toBeCloseTo(start[0], 6)
      expect(baselinePointAt(arc, len).point[0]).toBeCloseTo(end[0], 6)
      expect(baselinePointAt(arc, len).point[1]).toBeCloseTo(end[1], 6)

      // Every sampled point is equidistant from the centre.
      const info = arcInfo(start, end, bulge)!
      for (const p of pts) {
        expect(distance(p, info.center)).toBeCloseTo(info.radius, 6)
      }
    },
  )

  it('offsets an arc without changing its swept angle', () => {
    const arc = { kind: 'arc' as const, start: [0, 0] as Vec2, end: [4, 0] as Vec2, bulge: 0.5 }
    const offset = offsetBaseline(arc, 0.2)
    expect(offset.kind).toBe('arc')
    if (offset.kind !== 'arc') throw new Error('unreachable')
    // Bulge is preserved: the centre and swept angle are unchanged, only the radius moves.
    expect(offset.bulge).toBeCloseTo(arc.bulge)
    const before = arcInfo(arc.start, arc.end, arc.bulge)!
    const after = arcInfo(offset.start, offset.end, offset.bulge)!
    // Offsetting left of travel on a CCW arc moves toward the centre, shrinking the radius.
    expect(after.radius).toBeCloseTo(before.radius - 0.2, 5)
  })

  it('samples points along a straight baseline', () => {
    const b = { kind: 'line' as const, start: [0, 0] as Vec2, end: [10, 0] as Vec2 }
    expect(baselinePointAt(b, 0).point[0]).toBeCloseTo(0)
    expect(baselinePointAt(b, 5).point[0]).toBeCloseTo(5)
    expect(baselinePointAt(b, 10).point[0]).toBeCloseTo(10)
    // Past the end clamps rather than extrapolating.
    expect(baselinePointAt(b, 99).point[0]).toBeCloseTo(10)
  })

  it('offsets a straight baseline perpendicular to its direction', () => {
    const b = offsetBaseline({ kind: 'line', start: [0, 0], end: [5, 0] }, 0.5)
    expect(b.start[1]).toBeCloseTo(0.5)
    expect(b.end[1]).toBeCloseTo(0.5)
  })

  it('leaves a baseline untouched for a zero offset', () => {
    const original = { kind: 'line' as const, start: [0, 0] as Vec2, end: [5, 0] as Vec2 }
    expect(offsetBaseline(original, 0)).toBe(original)
  })
})

// ---------------------------------------------------------------------------
// Location line
// ---------------------------------------------------------------------------

describe('locationLineOffset', () => {
  it('is zero for a centreline wall', () => {
    expect(locationLineOffset('centerline', 0.2, false)).toBe(0)
  })

  it('shifts by half the thickness for a finish face', () => {
    expect(locationLineOffset('finish-exterior', 0.2, false)).toBeCloseTo(-0.1)
    expect(locationLineOffset('finish-interior', 0.2, false)).toBeCloseTo(0.1)
  })

  it('flipping mirrors the offset — the location line is the pivot', () => {
    expect(locationLineOffset('finish-exterior', 0.2, true)).toBeCloseTo(0.1)
    expect(locationLineOffset('finish-interior', 0.2, true)).toBeCloseTo(-0.1)
  })
})

// ---------------------------------------------------------------------------
// Wall resolution
// ---------------------------------------------------------------------------

describe('resolveWall', () => {
  it('derives thickness from the type layer stack, not the instance', () => {
    const { scene, wallId } = withWall()
    const wall = scene.walls.find((w) => w.id === wallId)!
    const resolved = resolveWall(scene, wall)!
    const type = scene.types.find((t) => t.id === wall.typeId)!
    expect(type.category).toBe('wall')
    if (type.category !== 'wall') throw new Error('unreachable')
    expect(resolved.thickness).toBeCloseTo(assemblyThickness(type.layers))
    expect(resolved.thickness).toBeCloseTo(0.2)
  })

  it('resolves an unconnected top to base + height', () => {
    const { scene, wallId } = withWall()
    const resolved = resolveWall(scene, scene.walls.find((w) => w.id === wallId)!)!
    expect(resolved.baseElevation).toBeCloseTo(0)
    expect(resolved.height).toBeCloseTo(2.8)
  })

  it('resolves a level-referenced top so it tracks the level', () => {
    const { scene, levelId, wallId } = withWall()
    // Add a second level at 2.8 and constrain the wall's top to it.
    const two = { ...scene, levels: [...scene.levels, { id: 'lv2', name: 'L2', elevation: 4, height: 2.8, isBuildingStory: true, computationHeight: 0 }] }
    const constrained = updateWall(two, wallId, { top: { kind: 'level', levelId: 'lv2', offset: 0 } })
    const resolved = resolveWall(constrained, constrained.walls.find((w) => w.id === wallId)!)!
    expect(resolved.height).toBeCloseTo(4)
    expect(levelId).toBeTruthy()
  })

  it('falls back safely when the top constraint points at a missing level', () => {
    const { scene, wallId } = withWall()
    const orphaned = updateWall(scene, wallId, {
      top: { kind: 'level', levelId: 'does-not-exist', offset: 0 },
    })
    const resolved = resolveWall(orphaned, orphaned.walls.find((w) => w.id === wallId)!)!
    expect(resolved.height).toBeGreaterThan(0)
  })

  it('returns null for an unknown type', () => {
    const { scene, wallId } = withWall()
    const broken = updateWall(scene, wallId, { typeId: 'nope' })
    expect(resolveWall(broken, broken.walls.find((w) => w.id === wallId)!)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Solid decomposition — the heart of the geometry module
// ---------------------------------------------------------------------------

/** Point-in-box test for axis-aligned walls (rotationY === 0), used to prove holes exist. */
function coversAlongX(box: Box3D, x: number, y: number): boolean {
  const [cx, cy] = box.center
  const [len, ht] = box.size
  return Math.abs(x - cx) <= len / 2 + 1e-9 && Math.abs(y - cy) <= ht / 2 + 1e-9
}

describe('wallSolidBoxes', () => {
  it('returns one full box for a wall with no openings', () => {
    const { scene, wallId } = withWall(5)
    const resolved = resolveWall(scene, scene.walls.find((w) => w.id === wallId)!)!
    const boxes = wallSolidBoxes(resolved, [])
    expect(boxes).toHaveLength(1)
    expect(boxes[0].size[0]).toBeCloseTo(5)
    expect(boxes[0].size[1]).toBeCloseTo(2.8)
    expect(boxes[0].size[2]).toBeCloseTo(0.2)
  })

  it('cuts a door: side pillars + a lintel, with a hole where the door is', () => {
    const { scene, wallId } = withDoor(2.5)
    const resolved = resolveWall(scene, scene.walls.find((w) => w.id === wallId)!)!
    const openings = scene.openings.filter((o) => o.hostId === wallId)
    const boxes = wallSolidBoxes(resolved, openings)

    // Two pillars + one lintel above the door.
    expect(boxes).toHaveLength(3)
    // The doorway itself is empty...
    expect(boxes.some((b) => coversAlongX(b, 2.5, 1.0))).toBe(false)
    // ...but there is a lintel above it.
    expect(boxes.some((b) => coversAlongX(b, 2.5, 2.5))).toBe(true)
    // ...and solid wall to either side.
    expect(boxes.some((b) => coversAlongX(b, 0.5, 1.0))).toBe(true)
    expect(boxes.some((b) => coversAlongX(b, 4.5, 1.0))).toBe(true)
  })

  it('cuts a window: solid below the sill and above the head', () => {
    const { scene, wallId } = withWall()
    const wall = scene.walls.find((w) => w.id === wallId)!
    const resolved = resolveWall(scene, wall)!
    const boxes = wallSolidBoxes(resolved, [
      {
        id: 'o1',
        hostId: wallId,
        offset: 2,
        width: 1,
        height: 1.2,
        sillHeight: 0.9,
        predefinedType: 'opening',
        depth: null,
      },
    ])
    // 2 pillars + under-sill + lintel.
    expect(boxes).toHaveLength(4)
    expect(boxes.some((b) => coversAlongX(b, 2.5, 0.4))).toBe(true) // below sill
    expect(boxes.some((b) => coversAlongX(b, 2.5, 1.5))).toBe(false) // glazing = hole
    expect(boxes.some((b) => coversAlongX(b, 2.5, 2.5))).toBe(true) // above head
  })

  it('merges overlapping openings instead of emitting overlapping solids', () => {
    const { scene, wallId } = withWall()
    const resolved = resolveWall(scene, scene.walls.find((w) => w.id === wallId)!)!
    const mk = (id: string, offset: number, width: number) => ({
      id,
      hostId: wallId,
      offset,
      width,
      height: 2.1,
      sillHeight: 0,
      predefinedType: 'opening' as const,
      depth: null,
    })
    const boxes = wallSolidBoxes(resolved, [mk('a', 1, 2), mk('b', 2, 2)])
    // Union covers [1,3]; solids are [0,1] and [3,5] plus a lintel per opening.
    expect(boxes.some((b) => coversAlongX(b, 2, 1.0))).toBe(false)
    expect(boxes.some((b) => coversAlongX(b, 0.5, 1.0))).toBe(true)
    expect(boxes.some((b) => coversAlongX(b, 4, 1.0))).toBe(true)
  })

  it('clamps an opening wider than its wall rather than emitting negative geometry', () => {
    const { scene, wallId } = withWall(5)
    const resolved = resolveWall(scene, scene.walls.find((w) => w.id === wallId)!)!
    const boxes = wallSolidBoxes(resolved, [
      {
        id: 'o1',
        hostId: wallId,
        offset: 0,
        width: 99,
        height: 99,
        sillHeight: 0,
        predefinedType: 'opening',
        depth: null,
      },
    ])
    // The whole wall is voided; every emitted box must still have positive size.
    for (const b of boxes) {
      expect(b.size[0]).toBeGreaterThan(0)
      expect(b.size[1]).toBeGreaterThan(0)
    }
  })

  it('offsets a wall up by its level elevation', () => {
    const { scene, wallId } = withWall()
    const raised = {
      ...scene,
      levels: scene.levels.map((l) => ({ ...l, elevation: 3 })),
    }
    const resolved = resolveWall(raised, raised.walls.find((w) => w.id === wallId)!)!
    const boxes = wallSolidBoxes(resolved, [])
    expect(boxes[0].center[1]).toBeCloseTo(3 + 2.8 / 2)
  })

  it('returns nothing for a degenerate zero-length wall', () => {
    const { scene, wallId } = withWall()
    const degenerate = updateWall(scene, wallId, {
      baseline: { kind: 'line', start: [1, 1], end: [1, 1] },
    })
    const resolved = resolveWall(degenerate, degenerate.walls.find((w) => w.id === wallId)!)!
    expect(wallSolidBoxes(resolved, [])).toHaveLength(0)
  })

  it('tessellates a curved wall into multiple boxes', () => {
    const { scene, wallId } = withWall()
    const curved = updateWall(scene, wallId, {
      baseline: { kind: 'arc', start: [0, 0], end: [5, 0], bulge: 0.4 },
    })
    const resolved = resolveWall(curved, curved.walls.find((w) => w.id === wallId)!)!
    const boxes = wallSolidBoxes(resolved, [])
    // An arc must not collapse to a single straight box.
    expect(boxes.length).toBeGreaterThan(5)
    // Boxes should not all share one rotation, or it isn't actually curved.
    const rotations = new Set(boxes.map((b) => b.rotationY.toFixed(3)))
    expect(rotations.size).toBeGreaterThan(1)
  })
})

describe('rotationYFor', () => {
  it('maps scene +X to zero rotation', () => {
    expect(rotationYFor([1, 0])).toBeCloseTo(0)
  })

  it('maps scene +Y to -90 degrees (scene y is world z)', () => {
    expect(rotationYFor([0, 1])).toBeCloseTo(-Math.PI / 2)
  })
})

// ---------------------------------------------------------------------------
// Slabs, columns, beams
// ---------------------------------------------------------------------------

describe('slabs, columns and beams', () => {
  it('resolves a slab thickness from its type', () => {
    const f = fixture()
    const r = addSlab(f.scene, f.levelId, 'st-floor-200', [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ])
    const resolved = resolveSlab(r.scene, r.scene.slabs[0])!
    expect(resolved.thickness).toBeCloseTo(0.2)
    expect(resolved.topElevation).toBeCloseTo(0)
    expect(roomArea(resolved.boundary)).toBeCloseTo(12)
  })

  it('rejects a slab with too few boundary points', () => {
    const f = fixture()
    const r = addSlab(f.scene, f.levelId, 'st-floor-200', [
      [0, 0],
      [1, 0],
    ])
    expect(resolveSlab(r.scene, r.scene.slabs[0])).toBeNull()
  })

  it('builds a column solid spanning its level height', () => {
    const f = fixture()
    const r = addColumn(f.scene, f.levelId, 'ct-rect-300', [2, 2])
    const box = columnSolid(r.scene, r.scene.columns[0])!
    expect(box.size[0]).toBeCloseTo(0.3)
    expect(box.size[1]).toBeCloseTo(2.8)
    expect(box.center[1]).toBeCloseTo(1.4)
  })

  it('builds a beam solid along its axis', () => {
    const f = fixture()
    const r = addBeam(f.scene, f.levelId, 'bt-rect-200x400', [0, 0], [6, 0])
    const box = beamSolid(r.scene, r.scene.beams[0])!
    expect(box.size[0]).toBeCloseTo(6) // length along the axis
    expect(box.size[1]).toBeCloseTo(0.4) // profile depth
    expect(box.size[2]).toBeCloseTo(0.2) // profile width
  })

  it('returns null for a zero-length beam', () => {
    const f = fixture()
    const r = addBeam(f.scene, f.levelId, 'bt-rect-200x400', [1, 1], [1, 1])
    expect(beamSolid(r.scene, r.scene.beams[0])).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Validation — refuse and explain, never degrade silently
// ---------------------------------------------------------------------------

describe('validation', () => {
  it('passes a well-formed wall', () => {
    const { scene, wallId } = withWall()
    expect(validateWall(scene, scene.walls.find((w) => w.id === wallId)!)).toHaveLength(0)
  })

  it('reports a zero-length wall', () => {
    const { scene, wallId } = withWall()
    const bad = updateWall(scene, wallId, {
      baseline: { kind: 'line', start: [0, 0], end: [0, 0] },
    })
    expect(validateWall(bad, bad.walls.find((w) => w.id === wallId)!).length).toBeGreaterThan(0)
  })

  it('reports an unknown wall type and an unknown level', () => {
    const { scene, wallId } = withWall()
    const bad = updateWall(scene, wallId, { typeId: 'nope', levelId: 'nope' })
    const errors = validateWall(bad, bad.walls.find((w) => w.id === wallId)!)
    expect(errors.some((e) => e.includes('wall type'))).toBe(true)
    expect(errors.some((e) => e.includes('level'))).toBe(true)
  })

  it('passes a door that fits its wall', () => {
    const { scene, openingId } = withDoor()
    expect(validateOpening(scene, scene.openings.find((o) => o.id === openingId)!)).toHaveLength(0)
  })

  it('reports an opening that runs past the wall end', () => {
    const { scene, openingId } = withDoor()
    const bad = updateOpening(scene, openingId, { offset: 4.8, width: 0.9 })
    const errors = validateOpening(bad, bad.openings.find((o) => o.id === openingId)!)
    expect(errors.some((e) => e.includes('past the wall end'))).toBe(true)
  })

  it('reports an opening taller than its wall', () => {
    const { scene, openingId } = withDoor()
    const bad = updateOpening(scene, openingId, { sillHeight: 2.0, height: 2.1 })
    const errors = validateOpening(bad, bad.openings.find((o) => o.id === openingId)!)
    expect(errors.some((e) => e.includes('exceeds wall height'))).toBe(true)
  })

  it('reports an orphaned opening whose host is gone', () => {
    const { scene, openingId } = withDoor()
    const orphan = { ...scene, walls: [] }
    const errors = validateOpening(orphan, orphan.openings.find((o) => o.id === openingId)!)
    expect(errors.some((e) => e.includes('no host'))).toBe(true)
  })

  it('reports non-positive opening dimensions', () => {
    const { scene, openingId } = withDoor()
    const bad = updateOpening(scene, openingId, { width: 0, height: -1, offset: -0.5 })
    expect(validateOpening(bad, bad.openings.find((o) => o.id === openingId)!).length).toBeGreaterThanOrEqual(3)
  })
})

// ---------------------------------------------------------------------------
// Wall voiding (B1) — see DECISIONS.md D-020
// ---------------------------------------------------------------------------

describe('resolveWall — roof voiding', () => {
  it('resolves topElevation to the roof baseHeight and populates roofRamp', () => {
    const { scene, wallId } = wallOnRoofEave()
    const wall = scene.walls.find((w) => w.id === wallId)!
    const resolved = resolveWall(scene, wall)!
    expect(resolved.topElevation).toBeCloseTo(3)
    expect(resolved.roofRamp).toBeDefined()
    // Symmetric about the centreline, always — see wallRoofRamp's own tests for the sign.
    expect(resolved.roofRamp!.frontDelta + resolved.roofRamp!.backDelta).toBeCloseTo(0)
  })

  it('leaves roofRamp undefined for a wall that does not qualify, rather than throwing', () => {
    const { scene, wallId } = wallOnRoofEave()
    const offTrack = updateWall(scene, wallId, {
      baseline: { kind: 'line', start: [1, 1], end: [5, 1] },
    })
    const wall = offTrack.walls.find((w) => w.id === wallId)!
    const resolved = resolveWall(offTrack, wall)!
    expect(resolved.roofRamp).toBeUndefined()
    expect(resolved.height).toBeGreaterThan(0) // still resolves — just flat
  })

  it('leaves roofRamp undefined when the roof id is dangling', () => {
    const { scene, wallId } = wallOnRoofEave()
    const dangling = updateWall(scene, wallId, { top: { kind: 'roof', roofId: 'gone' } })
    const wall = dangling.walls.find((w) => w.id === wallId)!
    expect(resolveWall(dangling, wall)!.roofRamp).toBeUndefined()
  })
})

describe('wallSolidBoxes — roof voiding', () => {
  const topOf = (b: Box3D): number => b.center[1] + b.size[1] / 2

  it('ramps the chunk that reaches the wall’s own top', () => {
    const { scene, wallId } = wallOnRoofEave()
    const wall = scene.walls.find((w) => w.id === wallId)!
    const resolved = resolveWall(scene, wall)!
    const boxes = wallSolidBoxes(resolved, [])
    expect(boxes).toHaveLength(1)
    expect(boxes[0].topRamp).toBeDefined()
    expect(boxes[0].topRamp).not.toBe(0)
  })

  it('does NOT ramp a below-sill or lintel chunk — only one reaching the top does', () => {
    const { scene, wallId } = wallOnRoofEave()
    const wall = scene.walls.find((w) => w.id === wallId)!
    const resolved = resolveWall(scene, wall)!
    const boxes = wallSolidBoxes(resolved, [
      {
        id: 'o1',
        hostId: wallId,
        offset: 2,
        width: 1,
        height: 1.2,
        sillHeight: 0.5,
        predefinedType: 'opening',
        depth: null,
      },
    ])
    const nominalTop = resolved.baseElevation + resolved.height
    const reachesTop = boxes.filter((b) => Math.abs(topOf(b) - nominalTop) < 1e-6)
    const short = boxes.filter((b) => Math.abs(topOf(b) - nominalTop) >= 1e-6)
    expect(reachesTop.length).toBeGreaterThan(0)
    expect(short.length).toBeGreaterThan(0)
    expect(reachesTop.every((b) => b.topRamp !== undefined)).toBe(true)
    expect(short.every((b) => b.topRamp === undefined)).toBe(true)
  })

  it('an ordinary wall never gets a topRamp', () => {
    const { scene, wallId } = withWall()
    const resolved = resolveWall(scene, scene.walls.find((w) => w.id === wallId)!)!
    const boxes = wallSolidBoxes(resolved, [])
    expect(boxes.every((b) => b.topRamp === undefined)).toBe(true)
  })
})

describe('validateWall — roof voiding', () => {
  it('a correctly voided wall has no errors', () => {
    const { scene, wallId } = wallOnRoofEave()
    expect(validateWall(scene, scene.walls.find((w) => w.id === wallId)!)).toEqual([])
  })

  it('flags an unknown roof id', () => {
    const { scene, wallId } = wallOnRoofEave()
    const bad = updateWall(scene, wallId, { top: { kind: 'roof', roofId: 'nope' } })
    const errors = validateWall(bad, bad.walls.find((w) => w.id === wallId)!)
    expect(errors.some((e) => /unknown roof/i.test(e))).toBe(true)
  })

  it('flags a wall attached to a roof it does not run under', () => {
    const { scene, wallId } = wallOnRoofEave()
    const offTrack = updateWall(scene, wallId, {
      baseline: { kind: 'line', start: [1, 1], end: [5, 1] },
    })
    const errors = validateWall(offTrack, offTrack.walls.find((w) => w.id === wallId)!)
    expect(errors.some((e) => /eave/i.test(e))).toBe(true)
  })
})

describe('boxCorners — topRamp', () => {
  it('splits the top face across local Z and leaves the bottom flat', () => {
    const box: Box3D = { center: [0, 1, 0], size: [2, 2, 1], rotationY: 0, topRamp: 0.4 }
    const corners = boxCorners(box)
    corners.slice(0, 4).forEach((c) => expect(c[1]).toBeCloseTo(0))
    // 4,5 are the local -Z ("front") top corners; 6,7 are local +Z ("back").
    expect(corners[4][1]).toBeCloseTo(1.8)
    expect(corners[5][1]).toBeCloseTo(1.8)
    expect(corners[6][1]).toBeCloseTo(2.2)
    expect(corners[7][1]).toBeCloseTo(2.2)
  })

  it('an unset topRamp is exactly the old flat-top behaviour', () => {
    const box: Box3D = { center: [0, 1, 0], size: [2, 2, 1], rotationY: 0 }
    boxCorners(box)
      .slice(4)
      .forEach((c) => expect(c[1]).toBeCloseTo(2))
  })
})

describe('boxToTriMesh', () => {
  it('is watertight and its volume equals length·height·thickness exactly, ramped or not', () => {
    const flat: Box3D = { center: [0, 1, 0], size: [2, 2, 1], rotationY: 0 }
    const ramped: Box3D = { ...flat, topRamp: 0.6 }
    for (const box of [flat, ramped]) {
      const mesh = boxToTriMesh(box)
      expect(isWatertight(mesh)).toBe(true)
      // A symmetric ramp does not change the mean height, so volume is unaffected by it.
      expect(meshVolume(mesh)).toBeCloseTo(box.size[0] * box.size[1] * box.size[2], 6)
    }
  })

  it('stays watertight with a positive volume under rotation', () => {
    const box: Box3D = { center: [1, 0.5, 2], size: [3, 1, 0.4], rotationY: Math.PI / 5, topRamp: 0.1 }
    const mesh = boxToTriMesh(box)
    expect(isWatertight(mesh)).toBe(true)
    expect(meshVolume(mesh)).toBeCloseTo(3 * 1 * 0.4, 6)
  })
})
