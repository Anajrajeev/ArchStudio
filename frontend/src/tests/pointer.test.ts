/**
 * Pointer resolution — the seam where a screen position becomes a scene coordinate.
 *
 * Every defect that reached the user in Phase 1A lived in a seam like this one, untested because it
 * was tangled up with react-three-fiber. `resolvePointer` is pure, so the constraint precedence,
 * the snapping interplay and the freeze rule are all directly assertable here.
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { resolvePointer, type PointerContext } from '../editor/pointer'
import { levelWorkPlane, faceWorkPlane } from '../../../shared/geometry/workplane'
import { DEFAULT_SNAP_TOGGLES, SNAP_TYPES, type SnapToggles } from '../../../shared/geometry/snapping'
import { distance } from '../../../shared/geometry/index'
import type { Vec2 } from '../../../shared/types/scene'
import { fixture, withWall } from './helpers'

const RECT = { left: 0, top: 0, width: 800, height: 600 }
const CENTRE = { x: 400, y: 300 }

/** Top-down orthographic camera: 1 world unit maps to a predictable pixel count. */
function topDownOrtho(halfHeight = 12): THREE.OrthographicCamera {
  const aspect = RECT.width / RECT.height
  const cam = new THREE.OrthographicCamera(
    -halfHeight * aspect,
    halfHeight * aspect,
    halfHeight,
    -halfHeight,
    -500,
    1000,
  )
  cam.position.set(0, 60, 0)
  cam.up.set(0, 0, -1)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)
  return cam
}

const only = (...types: Array<keyof SnapToggles>): SnapToggles => {
  const t = Object.fromEntries(SNAP_TYPES.map((s) => [s, false])) as SnapToggles
  for (const s of types) t[s] = true
  return t
}

function ctx(overrides: Partial<PointerContext> = {}): PointerContext {
  const f = fixture()
  return {
    scene: f.scene,
    activeLevelId: f.levelId,
    workPlane: levelWorkPlane(f.levelId, 'Ground floor', 0),
    points: [],
    axisLock: 'none',
    numeric: { lockedLength: null, lockedAngle: null },
    snapToggles: { ...DEFAULT_SNAP_TOGGLES },
    gridSize: 0.25,
    showGrid: true,
    previousSnap: null,
    ...overrides,
  }
}

describe('resolvePointer — basics', () => {
  it('maps the viewport centre to the plane origin', () => {
    const r = resolvePointer(topDownOrtho(), CENTRE.x, CENTRE.y, RECT, ctx({ showGrid: false }))
    expect(r).not.toBeNull()
    expect(r!.point[0]).toBeCloseTo(0, 5)
    expect(r!.point[1]).toBeCloseTo(0, 5)
  })

  it('reports the world position at the plane elevation', () => {
    const c = ctx({ workPlane: levelWorkPlane('lv2', 'L2', 3), showGrid: false })
    const r = resolvePointer(topDownOrtho(), CENTRE.x, CENTRE.y, RECT, c)
    expect(r!.world[1]).toBeCloseTo(3, 5)
  })

  it('returns null when the work plane has no scene-2D mapping', () => {
    // A vertical face plane cannot yield scene [x, z] — it must refuse, not invent a coordinate.
    const c = ctx({ workPlane: faceWorkPlane([0, 1, 0], [0, 0, 1], 'w1', 'face of Wall-1') })
    expect(resolvePointer(topDownOrtho(), CENTRE.x, CENTRE.y, RECT, c)).toBeNull()
  })

  it('exposes a world-per-pixel scale that yields a sane aperture', () => {
    const r = resolvePointer(topDownOrtho(12), CENTRE.x, CENTRE.y, RECT, ctx({ showGrid: false }))
    // 24 world units over 600 px.
    expect(r!.worldPerPixel).toBeCloseTo(24 / 600, 6)
  })
})

describe('resolvePointer — snapping', () => {
  it('snaps to the grid when nothing else is in range', () => {
    const c = ctx({ snapToggles: only('grid'), gridSize: 1 })
    // 1 world unit right of centre is 25 px at this zoom; nudge off-grid and expect a snap back.
    const r = resolvePointer(topDownOrtho(), CENTRE.x + 30, CENTRE.y, RECT, c)
    expect(r!.snap.type).toBe('grid')
    expect(Number.isInteger(Math.round(r!.point[0]))).toBe(true)
    expect(r!.point[0]).toBeCloseTo(1, 6)
  })

  it('emits no grid candidate when the grid is hidden', () => {
    const c = ctx({ snapToggles: only('grid'), showGrid: false })
    const r = resolvePointer(topDownOrtho(), CENTRE.x + 7, CENTRE.y, RECT, c)
    expect(r!.snap.snapped).toBe(false)
  })

  it('snaps to a wall endpoint', () => {
    const w = withWall(5)
    const c = ctx({
      scene: w.scene,
      activeLevelId: w.levelId,
      workPlane: levelWorkPlane(w.levelId, 'L', 0),
      snapToggles: only('endpoint'),
    })
    // The wall runs (0,0)→(5,0); aim a few pixels off the origin.
    const r = resolvePointer(topDownOrtho(), CENTRE.x + 3, CENTRE.y + 3, RECT, c)
    expect(r!.snap.type).toBe('endpoint')
    expect(r!.point[0]).toBeCloseTo(0, 6)
    expect(r!.point[1]).toBeCloseTo(0, 6)
  })
})

describe('resolvePointer — constraint precedence', () => {
  const from: Vec2 = [0, 0]

  it('an axis lock flattens the off-axis component', () => {
    const c = ctx({ points: [from], axisLock: 'x', showGrid: false })
    const r = resolvePointer(topDownOrtho(), CENTRE.x + 100, CENTRE.y + 60, RECT, c)
    // Locked to X through the anchor, so scene Y must equal the anchor's.
    expect(r!.point[1]).toBeCloseTo(from[1], 6)
    expect(Math.abs(r!.point[0])).toBeGreaterThan(0.5)
  })

  it('an axis lock suppresses snapping so the constraint is not broken', () => {
    const w = withWall(5)
    const c = ctx({
      scene: w.scene,
      activeLevelId: w.levelId,
      workPlane: levelWorkPlane(w.levelId, 'L', 0),
      points: [[0, 3]],
      axisLock: 'x',
      snapToggles: { ...DEFAULT_SNAP_TOGGLES },
    })
    const r = resolvePointer(topDownOrtho(), CENTRE.x + 5, CENTRE.y, RECT, c)
    expect(r!.snap.snapped).toBe(false)
    // Still exactly on the locked axis.
    expect(r!.point[1]).toBeCloseTo(3, 6)
  })

  it('a typed length fixes the distance while the mouse still aims it', () => {
    const c = ctx({ points: [from], numeric: { lockedLength: 4.2, lockedAngle: null } })
    const a = resolvePointer(topDownOrtho(), CENTRE.x + 100, CENTRE.y, RECT, c)!
    const b = resolvePointer(topDownOrtho(), CENTRE.x, CENTRE.y - 100, RECT, c)!
    expect(distance(from, a.point)).toBeCloseTo(4.2, 6)
    expect(distance(from, b.point)).toBeCloseTo(4.2, 6)
    // Different directions, same length — that decoupling is the whole point.
    expect(distance(a.point, b.point)).toBeGreaterThan(1)
  })

  it('a typed length suppresses snapping', () => {
    const w = withWall(5)
    const c = ctx({
      scene: w.scene,
      activeLevelId: w.levelId,
      workPlane: levelWorkPlane(w.levelId, 'L', 0),
      points: [from],
      numeric: { lockedLength: 4.2, lockedAngle: null },
    })
    const r = resolvePointer(topDownOrtho(), CENTRE.x + 3, CENTRE.y + 3, RECT, c)!
    expect(r.snap.snapped).toBe(false)
    expect(distance(from, r.point)).toBeCloseTo(4.2, 6)
  })

  it('a typed angle constrains direction while the mouse sets the radius', () => {
    const c = ctx({ points: [from], numeric: { lockedLength: null, lockedAngle: 90 } })
    const r = resolvePointer(topDownOrtho(), CENTRE.x + 100, CENTRE.y + 40, RECT, c)!
    // 90° in scene 2D is +Y.
    expect(r.point[0]).toBeCloseTo(0, 5)
    expect(r.point[1]).toBeGreaterThan(0)
  })

  it('length AND angle together fully determine the point, ignoring the cursor', () => {
    const c = ctx({ points: [from], numeric: { lockedLength: 3, lockedAngle: 0 } })
    const a = resolvePointer(topDownOrtho(), CENTRE.x + 200, CENTRE.y + 150, RECT, c)!
    const b = resolvePointer(topDownOrtho(), CENTRE.x - 200, CENTRE.y - 150, RECT, c)!
    expect(a.point[0]).toBeCloseTo(3, 6)
    expect(a.point[1]).toBeCloseTo(0, 6)
    expect(b.point).toEqual(a.point)
  })

  it('ignores constraints when there is no anchor point yet', () => {
    // Nothing to measure from on the first click, so the raw pick must survive untouched.
    // 150 px at this zoom is 6 world units — deliberately NOT equal to the locked length, or the
    // assertion would pass by coincidence.
    const c = ctx({ points: [], numeric: { lockedLength: 4, lockedAngle: 0 }, showGrid: false })
    const r = resolvePointer(topDownOrtho(), CENTRE.x + 150, CENTRE.y, RECT, c)!
    expect(r.point[0]).toBeCloseTo(6, 4)
    expect(distance([0, 0], r.point)).not.toBeCloseTo(4, 3)
  })
})

describe('resolvePointer — the freeze rule', () => {
  it('resolves against the plane it is given, so a frozen plane keeps its elevation', () => {
    // The store holds the work plane steady for the duration of an operation; resolution must
    // honour whatever plane it receives rather than re-deriving one.
    const upper = levelWorkPlane('lv2', 'Upper', 2.8)
    const c = ctx({ workPlane: upper, points: [[0, 0]], showGrid: false })
    const r = resolvePointer(topDownOrtho(), CENTRE.x + 40, CENTRE.y + 40, RECT, c)!
    expect(r.world[1]).toBeCloseTo(2.8, 6)
  })

  it('is deterministic — the same input yields the same output', () => {
    const c = ctx({ showGrid: false })
    const a = resolvePointer(topDownOrtho(), 512, 233, RECT, c)!
    const b = resolvePointer(topDownOrtho(), 512, 233, RECT, c)!
    expect(a.point).toEqual(b.point)
  })

  it('accounts for a viewport that is offset within the page', () => {
    // The real canvas sits below the top bar and right of the left panel, so a bare clientX/Y
    // must be corrected by the rect or every pick lands in the wrong place.
    const offset = { left: 240, top: 76, width: 800, height: 600 }
    const c = ctx({ showGrid: false })
    const centred = resolvePointer(topDownOrtho(), 240 + 400, 76 + 300, offset, c)!
    expect(centred.point[0]).toBeCloseTo(0, 5)
    expect(centred.point[1]).toBeCloseTo(0, 5)
  })
})
