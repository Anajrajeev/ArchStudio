/**
 * Direct parametric handles (A1's bulge handle, D1's endpoint and vertex handles).
 *
 * These cover the two things a handle layer can get wrong in ways a user notices immediately:
 * a handle that does not sit on the geometry it edits, and a drag that produces geometry the
 * renderer then has to guess about (zero-length walls, NaN bulges).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  handlesFor,
  applyHandleDrag,
  applyHandleHeightDrag,
  instancesOfWallType,
  wallTypeThickness,
  type Handle,
} from '../editor/handles'
import { useEditor } from '../scene/store'
import { addSlab, addColumn, addWall, updateWall } from '../scene/mutations'
import {
  baselineApex,
  baselineStart,
  baselineEnd,
  baselinePolyline,
  columnSolid,
  distance,
  resolveWall,
} from '../../../shared/geometry/index'
import type { Vec2 } from '../../../shared/types/scene'
import { fixture, withWall } from './helpers'

function grab(handles: Handle[], kind: Handle['kind'], index?: number): Handle {
  const h = handles.find((x) => x.kind === kind && (index === undefined || x.index === index))
  if (!h) throw new Error(`no ${kind} handle`)
  return h
}

describe('handlesFor', () => {
  it('gives a wall endpoint, bulge, thickness and top handles', () => {
    const { scene, wallId } = withWall()
    const h = handlesFor(scene, [wallId])
    expect(h.map((x) => x.kind).sort()).toEqual([
      'wall-bulge',
      'wall-end',
      'wall-start',
      'wall-thickness',
      'wall-top',
    ])
  })

  it('marks only the thickness handle as editing the shared type', () => {
    // Thickness is a TYPE property, so dragging that face changes every wall of the type. That is
    // the defining BIM interaction, but the UI has to be able to say so.
    const { scene, wallId } = withWall()
    const h = handlesFor(scene, [wallId])
    expect(h.filter((x) => x.editsType).map((x) => x.kind)).toEqual(['wall-thickness'])
  })

  it('puts the top handle at the top of the wall and the rest at its base', () => {
    const { scene, wallId } = withWall()
    const h = handlesFor(scene, [wallId])
    expect(grab(h, 'wall-top').elevation).toBeCloseTo(2.8, 9)
    expect(grab(h, 'wall-top').space).toBe('vertical')
    for (const kind of ['wall-start', 'wall-end', 'wall-bulge', 'wall-thickness'] as const) {
      expect(grab(h, kind).elevation).toBeCloseTo(0, 9)
      expect(grab(h, kind).space).toBe('plane')
    }
  })

  it('puts the thickness handle on the wall face, half a thickness off the centreline', () => {
    const { scene, wallId } = withWall(5, 'wt-ext-200')
    const pos = grab(handlesFor(scene, [wallId]), 'wall-thickness').position
    // A 200 mm wall drawn along +X from the origin: the face is 100 mm off the centreline.
    expect(pos[0]).toBeCloseTo(2.5, 6)
    expect(Math.abs(pos[1])).toBeCloseTo(0.1, 6)
  })

  it('gives a column a push/pull top handle', () => {
    const f = fixture()
    const r = addColumn(f.scene, f.levelId, 'ct-rect-300', [1, 1])
    const h = handlesFor(r.scene, [r.id])
    expect(h.map((x) => x.kind)).toEqual(['column-top'])
    expect(h[0].space).toBe('vertical')
    expect(h[0].elevation).toBeCloseTo(2.8, 9)
  })

  it('places the endpoint handles exactly on the baseline ends', () => {
    const { scene, wallId } = withWall(5)
    const h = handlesFor(scene, [wallId])
    expect(grab(h, 'wall-start').position).toEqual([0, 0])
    expect(grab(h, 'wall-end').position).toEqual([5, 0])
  })

  it('places the bulge handle at the chord midpoint on a straight wall', () => {
    const { scene, wallId } = withWall(5)
    expect(grab(handlesFor(scene, [wallId]), 'wall-bulge').position).toEqual([2.5, 0])
  })

  it('places the bulge handle on the curve of an already-curved wall', () => {
    const { scene, wallId } = withWall(5)
    const curved = updateWall(scene, wallId, {
      baseline: { kind: 'arc', start: [0, 0], end: [5, 0], bulge: 0.4 },
    })
    const pos = grab(handlesFor(curved, [wallId]), 'wall-bulge').position
    const onCurve = Math.min(
      ...baselinePolyline({ kind: 'arc', start: [0, 0], end: [5, 0], bulge: 0.4 }, 400).map((q) =>
        distance(q, pos),
      ),
    )
    expect(onCurve).toBeLessThan(0.01)
  })

  it('gives a slab one handle per boundary vertex, in order', () => {
    const f = fixture()
    const boundary: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ]
    const r = addSlab(f.scene, f.levelId, 'st-floor-200', boundary)
    const h = handlesFor(r.scene, [r.id])
    expect(h).toHaveLength(4)
    expect(h.map((x) => x.position)).toEqual(boundary)
    expect(h.map((x) => x.index)).toEqual([0, 1, 2, 3])
  })

  it('offers nothing for a multi-selection — a drag would have no single meaning', () => {
    const { scene, wallId } = withWall()
    expect(handlesFor(scene, [wallId, 'other'])).toEqual([])
    expect(handlesFor(scene, [])).toEqual([])
  })

  it('offers nothing for an unknown id', () => {
    const { scene } = withWall()
    expect(handlesFor(scene, ['nope'])).toEqual([])
  })
})

describe('applyHandleDrag — wall endpoints', () => {
  it('moves the dragged end and leaves the other alone', () => {
    const { scene, wallId } = withWall(5)
    const h = grab(handlesFor(scene, [wallId]), 'wall-end')
    const after = applyHandleDrag(scene, h, [5, 3])
    const b = after.walls[0].baseline
    expect(baselineEnd(b)).toEqual([5, 3])
    expect(baselineStart(b)).toEqual([0, 0])
  })

  it('moves the start end independently', () => {
    const { scene, wallId } = withWall(5)
    const h = grab(handlesFor(scene, [wallId]), 'wall-start')
    const after = applyHandleDrag(scene, h, [-1, -1])
    expect(baselineStart(after.walls[0].baseline)).toEqual([-1, -1])
    expect(baselineEnd(after.walls[0].baseline)).toEqual([5, 0])
  })

  it('preserves an arc baseline when an endpoint moves — the wall stays curved', () => {
    const { scene, wallId } = withWall(5)
    const curved = updateWall(scene, wallId, {
      baseline: { kind: 'arc', start: [0, 0], end: [5, 0], bulge: 0.4 },
    })
    const after = applyHandleDrag(curved, grab(handlesFor(curved, [wallId]), 'wall-end'), [5, 2])
    const b = after.walls[0].baseline
    expect(b.kind).toBe('arc')
    expect(b.kind === 'arc' && b.bulge).toBeCloseTo(0.4, 9)
  })

  it('refuses to collapse a wall onto itself', () => {
    const { scene, wallId } = withWall(5)
    const h = grab(handlesFor(scene, [wallId]), 'wall-end')
    expect(applyHandleDrag(scene, h, [0, 0])).toBe(scene)
  })

  it('never mutates the input scene', () => {
    const { scene, wallId } = withWall(5)
    const before = JSON.stringify(scene)
    applyHandleDrag(scene, grab(handlesFor(scene, [wallId]), 'wall-end'), [7, 2])
    expect(JSON.stringify(scene)).toBe(before)
  })
})

describe('applyHandleDrag — the bulge handle', () => {
  it('turns a straight wall into an arc through the dragged point', () => {
    const { scene, wallId } = withWall(4)
    const h = grab(handlesFor(scene, [wallId]), 'wall-bulge')
    const after = applyHandleDrag(scene, h, [2, 1])
    const b = after.walls[0].baseline
    expect(b.kind).toBe('arc')
    // The resulting arc passes through where the handle was dropped.
    const nearest = Math.min(...baselinePolyline(b, 400).map((q) => distance(q, [2, 1])))
    expect(nearest).toBeLessThan(0.01)
  })

  it('straightens a curved wall when dropped back on the chord', () => {
    const { scene, wallId } = withWall(4)
    const curved = applyHandleDrag(scene, grab(handlesFor(scene, [wallId]), 'wall-bulge'), [2, 1])
    expect(curved.walls[0].baseline.kind).toBe('arc')
    const straight = applyHandleDrag(
      curved,
      grab(handlesFor(curved, [wallId]), 'wall-bulge'),
      [2, 0],
    )
    // A `line` baseline, not an arc with bulge 0 — nothing downstream should have to treat those
    // as equivalent.
    expect(straight.walls[0].baseline.kind).toBe('line')
  })

  it('keeps the endpoints fixed while bowing', () => {
    const { scene, wallId } = withWall(4)
    const after = applyHandleDrag(scene, grab(handlesFor(scene, [wallId]), 'wall-bulge'), [2, -1.3])
    expect(baselineStart(after.walls[0].baseline)).toEqual([0, 0])
    expect(baselineEnd(after.walls[0].baseline)).toEqual([4, 0])
  })

  it('bows to whichever side the handle is dragged', () => {
    const { scene, wallId } = withWall(4)
    const up = applyHandleDrag(scene, grab(handlesFor(scene, [wallId]), 'wall-bulge'), [2, 1])
    const down = applyHandleDrag(scene, grab(handlesFor(scene, [wallId]), 'wall-bulge'), [2, -1])
    const bu = up.walls[0].baseline
    const bd = down.walls[0].baseline
    expect(bu.kind === 'arc' && bd.kind === 'arc' && bu.bulge).toBeCloseTo(
      bd.kind === 'arc' ? -bd.bulge : NaN,
      9,
    )
  })

  it('is a no-op when grabbed and released without moving', () => {
    // The drag-handle invariant: the handle sits at the apex, so feeding the apex back in must
    // reproduce the same wall.
    const { scene, wallId } = withWall(4)
    const curved = updateWall(scene, wallId, {
      baseline: { kind: 'arc', start: [0, 0], end: [4, 0], bulge: 0.55 },
    })
    const h = grab(handlesFor(curved, [wallId]), 'wall-bulge')
    const after = applyHandleDrag(curved, h, baselineApex(curved.walls[0].baseline))
    const b = after.walls[0].baseline
    expect(b.kind === 'arc' && b.bulge).toBeCloseTo(0.55, 6)
  })
})

describe('applyHandleDrag — slab vertices', () => {
  it('moves only the dragged vertex', () => {
    const f = fixture()
    const r = addSlab(f.scene, f.levelId, 'st-floor-200', [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ])
    const after = applyHandleDrag(r.scene, grab(handlesFor(r.scene, [r.id]), 'slab-vertex', 2), [
      6, 5,
    ])
    expect(after.slabs[0].boundary).toEqual([
      [0, 0],
      [4, 0],
      [6, 5],
      [0, 3],
    ])
  })
})

describe('applyHandleDrag — the wall face (thickness)', () => {
  it('sets the thickness to twice the offset from the centreline', () => {
    const { scene, wallId } = withWall(5)
    const h = grab(handlesFor(scene, [wallId]), 'wall-thickness')
    const after = applyHandleDrag(scene, h, [2.5, 0.3])
    expect(resolveWall(after, after.walls[0])!.thickness).toBeCloseTo(0.6, 6)
  })

  it('ignores movement ALONG the wall — only the face normal counts', () => {
    const { scene, wallId } = withWall(5)
    const h = grab(handlesFor(scene, [wallId]), 'wall-thickness')
    const a = applyHandleDrag(scene, h, [2.5, 0.3])
    const b = applyHandleDrag(scene, h, [4.9, 0.3])
    expect(resolveWall(a, a.walls[0])!.thickness).toBeCloseTo(
      resolveWall(b, b.walls[0])!.thickness,
      9,
    )
  })

  it('is symmetric — dragging either face outward thickens the wall', () => {
    const { scene, wallId } = withWall(5)
    const h = grab(handlesFor(scene, [wallId]), 'wall-thickness')
    const up = applyHandleDrag(scene, h, [2.5, 0.25])
    const down = applyHandleDrag(scene, h, [2.5, -0.25])
    expect(resolveWall(up, up.walls[0])!.thickness).toBeCloseTo(0.5, 6)
    expect(resolveWall(down, down.walls[0])!.thickness).toBeCloseTo(0.5, 6)
  })

  it('refuses to make a wall thinner than a millimetre', () => {
    const { scene, wallId } = withWall(5)
    const h = grab(handlesFor(scene, [wallId]), 'wall-thickness')
    expect(applyHandleDrag(scene, h, [2.5, 0])).toBe(scene)
  })

  it('scales the layers proportionally, keeping the assembly consistent', () => {
    const { scene, wallId } = withWall(5)
    const type = scene.types.find((t) => t.id === scene.walls[0].typeId)!
    const before = type.category === 'wall' ? type.layers.map((l) => l.thickness) : []
    const after = applyHandleDrag(scene, grab(handlesFor(scene, [wallId]), 'wall-thickness'), [
      2.5, 0.2,
    ])
    const t2 = after.types.find((t) => t.id === after.walls[0].typeId)!
    const now = t2.category === 'wall' ? t2.layers.map((l) => l.thickness) : []
    const k = 0.4 / before.reduce((a, b) => a + b, 0)
    now.forEach((v, i) => expect(v).toBeCloseTo(before[i] * k, 9))
  })

  it('affects every wall of the type — the defining BIM interaction', () => {
    const { scene, levelId, wallId } = withWall(5)
    const two = addWall(scene, {
      levelId,
      typeId: scene.walls[0].typeId,
      baseline: { kind: 'line', start: [0, 6], end: [5, 6] },
    }).scene
    expect(instancesOfWallType(two, two.walls[0].typeId)).toBe(2)
    const after = applyHandleDrag(two, grab(handlesFor(two, [wallId]), 'wall-thickness'), [2.5, 0.3])
    for (const w of after.walls) {
      expect(resolveWall(after, w)!.thickness).toBeCloseTo(0.6, 6)
    }
  })
})

describe('applyHandleHeightDrag — push/pull', () => {
  it('pushes a wall taller', () => {
    const { scene, wallId } = withWall(5)
    const h = grab(handlesFor(scene, [wallId]), 'wall-top')
    const after = applyHandleHeightDrag(scene, h, 4)
    expect(resolveWall(after, after.walls[0])!.topElevation).toBeCloseTo(4, 6)
  })

  it('keeps a level-bound top level-bound, changing only its offset', () => {
    // This is what the `top` union exists for (D-009): a wall whose top follows storey height must
    // keep following it after being nudged, or multi-storey editing quietly stops working.
    const { scene, levelId, wallId } = withWall(5)
    const bound = updateWall(scene, wallId, {
      top: { kind: 'level', levelId, offset: 2.8 },
    })
    const after = applyHandleHeightDrag(bound, grab(handlesFor(bound, [wallId]), 'wall-top'), 3.5)
    const top = after.walls[0].top
    expect(top.kind).toBe('level')
    expect(top.kind === 'level' && top.offset).toBeCloseTo(3.5, 6)
    expect(resolveWall(after, after.walls[0])!.topElevation).toBeCloseTo(3.5, 6)
  })

  it('refuses to collapse a wall to nothing', () => {
    const { scene, wallId } = withWall(5)
    const h = grab(handlesFor(scene, [wallId]), 'wall-top')
    expect(applyHandleHeightDrag(scene, h, 0)).toBe(scene)
    expect(applyHandleHeightDrag(scene, h, -3)).toBe(scene)
  })

  it('pushes a column taller', () => {
    const f = fixture()
    const r = addColumn(f.scene, f.levelId, 'ct-rect-300', [1, 1])
    const h = handlesFor(r.scene, [r.id])[0]
    const after = applyHandleHeightDrag(r.scene, h, 3.6)
    const solid = columnSolid(after, after.columns[0])!
    expect(solid.center[1] + solid.size[1] / 2).toBeCloseTo(3.6, 6)
  })

  it('a plane drag on a vertical handle is a no-op, not a misread', () => {
    const { scene, wallId } = withWall(5)
    expect(applyHandleDrag(scene, grab(handlesFor(scene, [wallId]), 'wall-top'), [9, 9])).toBe(scene)
  })

  it('reports the instance count for a type-editing drag', () => {
    const { scene } = withWall(5)
    expect(instancesOfWallType(scene, scene.walls[0].typeId)).toBe(1)
    expect(wallTypeThickness(scene, scene.walls[0].typeId)).toBeCloseTo(0.2, 9)
  })
})

// ---------------------------------------------------------------------------
// One undo per gesture
// ---------------------------------------------------------------------------

describe('a handle drag is one undo entry', () => {
  beforeEach(() => {
    const w = withWall(4)
    useEditor.getState().loadScene(w.scene, w.levelId)
  })

  it('collapses many intermediate positions into a single history step', () => {
    const s = useEditor.getState()
    const wallId = s.scene.walls[0].id
    const handle = grab(handlesFor(s.scene, [wallId]), 'wall-bulge')

    s.beginTransient()
    for (const y of [0.1, 0.4, 0.8, 1.2, 1.5]) {
      useEditor.getState().updateTransient((sc) => applyHandleDrag(sc, handle, [2, y]))
    }
    useEditor.getState().endTransient('Curve wall')

    expect(useEditor.getState().undoStack).toHaveLength(1)
    expect(useEditor.getState().scene.walls[0].baseline.kind).toBe('arc')

    useEditor.getState().undo()
    expect(useEditor.getState().scene.walls[0].baseline.kind).toBe('line')
    expect(useEditor.getState().undoStack).toHaveLength(0)
  })

  it('a click with no movement leaves no history entry', () => {
    const s = useEditor.getState()
    s.beginTransient()
    s.cancelTransient()
    expect(useEditor.getState().undoStack).toHaveLength(0)
  })
})
