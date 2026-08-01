/**
 * Box / rubber-band select (A5).
 *
 * Window vs crossing is the part users test immediately and notice instantly when it's wrong, so
 * the semantics get explicit coverage in both directions, including the case a bounding-box
 * implementation gets wrong: an element LARGER than the box, spanning it with no vertex inside.
 *
 * The projection is injected, so these tests use a trivial top-down orthographic projector rather
 * than standing up a camera — the same reason `selectInBox` takes a `Projector` at all.
 */
import { describe, it, expect } from 'vitest'
import {
  boxModeFor,
  normalizeBox,
  isBoxDrag,
  selectInBox,
  silhouettes,
  MIN_BOX_PX,
  type Projector,
  type ScreenBox,
} from '../editor/boxSelect'
import { boxCorners, prismCornersAndEdges, BOX_EDGES } from '../../../shared/geometry/index'
import { addWall, addSlab, addColumn, addRoom, addBeam } from '../scene/mutations'
import type { Vec2 } from '../../../shared/types/scene'
import { fixture, withWall, withDoor } from './helpers'

/**
 * Top-down projection: 10 px per metre, scene origin at pixel (500, 400). Scene y grows downward on
 * screen, matching a plan view. Elevation is discarded, which is exactly what a plan camera does.
 */
const SCALE = 10
const project: Projector = (w) => [500 + w[0] * SCALE, 400 + w[2] * SCALE]

/** Screen box covering the given scene-2D rectangle. */
function boxOver(a: Vec2, b: Vec2): ScreenBox {
  return normalizeBox(project([a[0], 0, a[1]]), project([b[0], 0, b[1]]))
}

describe('boxModeFor', () => {
  it('left-to-right is window, right-to-left is crossing', () => {
    expect(boxModeFor(100, 300)).toBe('window')
    expect(boxModeFor(300, 100)).toBe('crossing')
  })

  it('treats a purely vertical drag as window — the conservative choice', () => {
    expect(boxModeFor(200, 200)).toBe('window')
  })
})

describe('normalizeBox', () => {
  it('orders the corners regardless of drag direction', () => {
    expect(normalizeBox([300, 250], [100, 50])).toEqual({
      minX: 100,
      minY: 50,
      maxX: 300,
      maxY: 250,
    })
  })
})

describe('isBoxDrag', () => {
  it('rejects a movement below the click threshold', () => {
    expect(isBoxDrag([100, 100], [100 + MIN_BOX_PX - 1, 101])).toBe(false)
  })

  it('accepts a drag past the threshold on either axis', () => {
    expect(isBoxDrag([100, 100], [100 + MIN_BOX_PX, 100])).toBe(true)
    expect(isBoxDrag([100, 100], [100, 100 + MIN_BOX_PX])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Silhouettes
// ---------------------------------------------------------------------------

describe('silhouettes', () => {
  it('derives a wall from the same solid decomposition the renderer uses', () => {
    const { scene, levelId } = withWall(5)
    const s = silhouettes(scene, levelId)
    expect(s).toHaveLength(1)
    // One box: 8 corners, 12 edges.
    expect(s[0].corners).toHaveLength(8)
    expect(s[0].edges).toHaveLength(12)
  })

  it('follows a wall into multiple boxes when an opening splits it', () => {
    // A door leaves a run either side plus a lintel — three boxes, so 24 corners. If this silently
    // used one bounding box instead, crossing-select through the doorway would be wrong.
    const { scene, levelId } = withDoor(2.5)
    const s = silhouettes(scene, levelId)
    const wall = s.find((x) => x.id === scene.walls[0].id)!
    expect(wall.corners.length).toBeGreaterThan(8)
    expect(wall.corners.length % 8).toBe(0)
    expect(wall.edges).toHaveLength((wall.corners.length / 8) * 12)
  })

  it('includes slabs, rooms, columns and beams', () => {
    const f = fixture()
    let sc = addWall(f.scene, {
      levelId: f.levelId,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [0, 0], end: [4, 0] },
    }).scene
    sc = addSlab(sc, f.levelId, 'st-floor-200', [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]).scene
    sc = addRoom(sc, f.levelId, [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]).scene
    sc = addColumn(sc, f.levelId, 'ct-rect-300', [1, 1]).scene
    sc = addBeam(sc, f.levelId, 'bt-rect-200x400', [0, 0], [4, 0]).scene
    expect(silhouettes(sc, f.levelId)).toHaveLength(5)
  })

  it('excludes elements on other levels', () => {
    const { scene, levelId } = withWall(5)
    expect(silhouettes(scene, 'some-other-level')).toEqual([])
    expect(silhouettes(scene, levelId)).toHaveLength(1)
  })

  it('skips a degenerate slab rather than emitting an empty silhouette', () => {
    const f = fixture()
    const sc = addSlab(f.scene, f.levelId, 'st-floor-200', [
      [0, 0],
      [1, 0],
    ]).scene
    expect(silhouettes(sc, f.levelId)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Window vs crossing
// ---------------------------------------------------------------------------

describe('selectInBox — window (drag left to right)', () => {
  it('selects an element entirely inside the box', () => {
    const { scene, levelId, wallId } = withWall(5)
    const ids = selectInBox(
      silhouettes(scene, levelId),
      boxOver([-1, -2], [6, 2]),
      'window',
      project,
    )
    expect(ids).toEqual([wallId])
  })

  it('does NOT select an element that is only partly inside', () => {
    const { scene, levelId } = withWall(5)
    // Box stops at x = 3; the wall runs to x = 5.
    const ids = selectInBox(
      silhouettes(scene, levelId),
      boxOver([-1, -2], [3, 2]),
      'window',
      project,
    )
    expect(ids).toEqual([])
  })

  it('does not select an element the box misses entirely', () => {
    const { scene, levelId } = withWall(5)
    const ids = selectInBox(
      silhouettes(scene, levelId),
      boxOver([10, 10], [20, 20]),
      'window',
      project,
    )
    expect(ids).toEqual([])
  })

  it('accounts for wall thickness — a box between the faces excludes the wall', () => {
    // A 200 mm wall on the x axis spans y ∈ [-0.1, 0.1]. A box only 50 mm tall cannot enclose it.
    const { scene, levelId } = withWall(5)
    const ids = selectInBox(
      silhouettes(scene, levelId),
      boxOver([-1, -0.025], [6, 0.025]),
      'window',
      project,
    )
    expect(ids).toEqual([])
  })
})

describe('selectInBox — crossing (drag right to left)', () => {
  it('selects an element merely touched by the box', () => {
    const { scene, levelId, wallId } = withWall(5)
    const ids = selectInBox(
      silhouettes(scene, levelId),
      boxOver([-1, -2], [3, 2]),
      'crossing',
      project,
    )
    expect(ids).toEqual([wallId])
  })

  it('selects an element LARGER than the box that spans it with no vertex inside', () => {
    // This is the case a bounding-box or corners-only implementation gets wrong, and it is the
    // single most common real use of crossing select: a small box dropped onto a long wall.
    const { scene, levelId, wallId } = withWall(20)
    const ids = selectInBox(
      silhouettes(scene, levelId),
      boxOver([8, -1], [9, 1]),
      'crossing',
      project,
    )
    expect(ids).toEqual([wallId])
  })

  it('still ignores an element the box does not reach', () => {
    const { scene, levelId } = withWall(5)
    const ids = selectInBox(
      silhouettes(scene, levelId),
      boxOver([10, 10], [20, 20]),
      'crossing',
      project,
    )
    expect(ids).toEqual([])
  })

  it('selects strictly more than window for the same box', () => {
    const f = fixture()
    let sc = addWall(f.scene, {
      levelId: f.levelId,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [0, 0], end: [2, 0] },
    }).scene
    sc = addWall(sc, {
      levelId: f.levelId,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [0, 1], end: [8, 1] },
    }).scene

    const box = boxOver([-1, -1], [3, 2])
    const sil = silhouettes(sc, f.levelId)
    const win = selectInBox(sil, box, 'window', project)
    const cross = selectInBox(sil, box, 'crossing', project)
    expect(win).toHaveLength(1) // only the short wall is enclosed
    expect(cross).toHaveLength(2) // the long one is touched
    expect(win.every((id) => cross.includes(id))).toBe(true)
  })
})

describe('selectInBox — curved walls', () => {
  it('window-selects a curved wall by its tessellated solid, not its chord', () => {
    // A wall bowed to y ≈ -1.2 is not enclosed by a box that stops at y = -0.5, even though both
    // its endpoints are.
    const f = fixture()
    const sc = addWall(f.scene, {
      levelId: f.levelId,
      typeId: 'wt-ext-200',
      baseline: { kind: 'arc', start: [0, 0], end: [4, 0], bulge: 0.6 },
    }).scene
    const sil = silhouettes(sc, f.levelId)
    expect(selectInBox(sil, boxOver([-1, -0.5], [5, 0.5]), 'window', project)).toEqual([])
    expect(selectInBox(sil, boxOver([-1, -3], [5, 1]), 'window', project)).toHaveLength(1)
  })
})

describe('selectInBox — degenerate inputs', () => {
  it('returns nothing for an empty scene', () => {
    expect(selectInBox([], boxOver([0, 0], [5, 5]), 'window', project)).toEqual([])
    expect(selectInBox([], boxOver([0, 0], [5, 5]), 'crossing', project)).toEqual([])
  })

  it('never window-selects a silhouette with no corners', () => {
    const empty = [{ id: 'x', corners: [], edges: [] }]
    expect(selectInBox(empty, boxOver([-9, -9], [9, 9]), 'window', project)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The geometry the silhouettes are built from
// ---------------------------------------------------------------------------

describe('boxCorners', () => {
  it('returns 8 corners spanning the box extents when unrotated', () => {
    const c = boxCorners({ center: [0, 1, 0], size: [2, 2, 4], rotationY: 0 })
    expect(c).toHaveLength(8)
    expect(Math.min(...c.map((p) => p[0]))).toBeCloseTo(-1, 9)
    expect(Math.max(...c.map((p) => p[0]))).toBeCloseTo(1, 9)
    expect(Math.min(...c.map((p) => p[1]))).toBeCloseTo(0, 9)
    expect(Math.max(...c.map((p) => p[1]))).toBeCloseTo(2, 9)
    expect(Math.max(...c.map((p) => p[2]))).toBeCloseTo(2, 9)
  })

  it('rotates about Y without changing the box size', () => {
    const box = { center: [0, 0, 0] as [number, number, number], size: [4, 1, 2] as [number, number, number], rotationY: Math.PI / 2 }
    const c = boxCorners(box)
    // A quarter turn swaps the X and Z extents.
    expect(Math.max(...c.map((p) => Math.abs(p[0])))).toBeCloseTo(1, 9)
    expect(Math.max(...c.map((p) => Math.abs(p[2])))).toBeCloseTo(2, 9)
  })

  it('gives 12 edges that each connect two distinct corners', () => {
    expect(BOX_EDGES).toHaveLength(12)
    for (const [a, b] of BOX_EDGES) {
      expect(a).not.toBe(b)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThan(8)
    }
  })
})

describe('prismCornersAndEdges', () => {
  it('doubles the polygon and links the two rings', () => {
    const { corners, edges } = prismCornersAndEdges(
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
      0,
      3,
    )
    expect(corners).toHaveLength(8)
    // 4 bottom + 4 top + 4 verticals.
    expect(edges).toHaveLength(12)
    expect(corners.slice(0, 4).every((p) => p[1] === 0)).toBe(true)
    expect(corners.slice(4).every((p) => p[1] === 3)).toBe(true)
  })
})
