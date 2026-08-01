/**
 * Dynamic UCS — hover-to-re-plane (A2) and set-plane-to-selection (A3).
 *
 * Two layers are covered separately, on purpose:
 *  - the pure geometry (`elementTopFace` / `elementTopPlane`), which must agree with the solid
 *    decomposition the renderers use, or the plane would sit at an elevation nothing is drawn at;
 *  - the store policy (when re-planing is allowed), which is where the interesting rules live —
 *    the freeze rule and the locked-plane rule. Both were regressions waiting to happen.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  elementTopFace,
  elementTopPlane,
  isDistinctPlane,
} from '../../../shared/geometry/dynamicPlane'
import {
  isHorizontal,
  planeElevation,
  planeBadge,
  worldToScene2D,
  levelWorkPlane,
} from '../../../shared/geometry/workplane'
import { resolveWall, resolveSlab, columnSolid, beamSolid } from '../../../shared/geometry/index'
import { useEditor } from '../scene/store'
import { addSlab, addColumn, addBeam, addLevel, updateWall } from '../scene/mutations'
import { fixture, withWall, withDoor } from './helpers'

// ---------------------------------------------------------------------------
// The geometry
// ---------------------------------------------------------------------------

describe('elementTopFace', () => {
  it("uses a wall's resolved top elevation, so the plane sits on the drawn solid", () => {
    const { scene, wallId } = withWall()
    const wall = scene.walls.find((w) => w.id === wallId)!
    const resolved = resolveWall(scene, wall)!
    const face = elementTopFace(scene, wallId)!
    expect(face.elevation).toBeCloseTo(resolved.topElevation, 9)
    expect(face.elementId).toBe(wallId)
  })

  it('tracks a wall whose top constraint changes', () => {
    const { scene, wallId } = withWall()
    const raised = updateWall(scene, wallId, { top: { kind: 'unconnected', height: 4.2 } })
    expect(elementTopFace(raised, wallId)!.elevation).toBeCloseTo(4.2, 9)
  })

  it("uses a slab's top face, not its underside", () => {
    const f = fixture()
    const r = addSlab(f.scene, f.levelId, 'st-floor-200', [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ])
    const resolved = resolveSlab(r.scene, r.scene.slabs[0])!
    expect(elementTopFace(r.scene, r.id)!.elevation).toBeCloseTo(resolved.topElevation, 9)
  })

  it("agrees with the column solid's own top", () => {
    const f = fixture()
    const r = addColumn(f.scene, f.levelId, 'ct-rect-300', [1, 1])
    const solid = columnSolid(r.scene, r.scene.columns[0])!
    expect(elementTopFace(r.scene, r.id)!.elevation).toBeCloseTo(
      solid.center[1] + solid.size[1] / 2,
      9,
    )
  })

  it("agrees with the beam solid's own top", () => {
    const f = fixture()
    const r = addBeam(f.scene, f.levelId, 'bt-rect-200x400', [0, 0], [4, 0])
    const solid = beamSolid(r.scene, r.scene.beams[0])!
    expect(elementTopFace(r.scene, r.id)!.elevation).toBeCloseTo(
      solid.center[1] + solid.size[1] / 2,
      9,
    )
  })

  it('resolves a door to its host wall — hovering a door means hovering the wall', () => {
    const { scene, wallId, fillingId } = withDoor()
    const viaDoor = elementTopFace(scene, fillingId)!
    expect(viaDoor.elementId).toBe(wallId)
    expect(viaDoor.elevation).toBeCloseTo(elementTopFace(scene, wallId)!.elevation, 9)
  })

  it('refuses elements with no usable horizontal top', () => {
    const { scene } = withWall()
    expect(elementTopFace(scene, 'no-such-id')).toBeNull()
  })

  it('names the face and its elevation, so the badge answers "which plane am I on?"', () => {
    const { scene, wallId } = withWall()
    expect(elementTopFace(scene, wallId)!.description).toBe('Top of wall @ +2.800')
  })
})

describe('elementTopPlane', () => {
  it('is horizontal, so scene-2D picking keeps working', () => {
    // A vertical face plane has no scene-2D mapping by design (D-007); re-planing onto one would
    // make `resolvePointer` refuse every pick. This is the guard against that whole class of bug.
    const { scene, wallId } = withWall()
    const plane = elementTopPlane(scene, wallId)!
    expect(isHorizontal(plane)).toBe(true)
    expect(worldToScene2D(plane, [3, 2.8, 7])).toEqual([3, 7])
  })

  it('carries the face elevation and a badge label', () => {
    const { scene, wallId } = withWall()
    const plane = elementTopPlane(scene, wallId)!
    expect(planeElevation(plane)).toBeCloseTo(2.8, 9)
    expect(planeBadge(plane)).toBe('Top of wall @ +2.800')
    expect(plane.source.kind).toBe('face')
  })

  it('records the element it came from', () => {
    const { scene, wallId } = withWall()
    const src = elementTopPlane(scene, wallId)!.source
    expect(src.kind === 'face' && src.elementId).toBe(wallId)
  })
})

describe('isDistinctPlane', () => {
  it('rejects a plane the user is already on, so the badge does not churn', () => {
    const { scene, wallId } = withWall()
    const plane = elementTopPlane(scene, wallId)!
    expect(isDistinctPlane(plane, 2.8)).toBe(false)
    expect(isDistinctPlane(plane, 0)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The store policy
// ---------------------------------------------------------------------------

describe('applyHoverPlane — Dynamic UCS policy', () => {
  let wallId = ''

  beforeEach(() => {
    const w = withWall()
    useEditor.getState().loadScene(w.scene, w.levelId)
    useEditor.getState().setTool('wall')
    wallId = w.wallId
  })

  it('jumps to the hovered wall top', () => {
    useEditor.getState().applyHoverPlane(wallId)
    const s = useEditor.getState()
    expect(planeElevation(s.workPlane)).toBeCloseTo(2.8, 9)
    expect(s.hoverPlaneElementId).toBe(wallId)
  })

  it('falls back to the level plane when the cursor leaves', () => {
    useEditor.getState().applyHoverPlane(wallId)
    useEditor.getState().applyHoverPlane(null)
    const s = useEditor.getState()
    expect(planeElevation(s.workPlane)).toBeCloseTo(0, 9)
    expect(s.hoverPlaneElementId).toBeNull()
    expect(s.workPlane.source.kind).toBe('level')
  })

  it('does NOT re-plane once an operation is in progress — the freeze rule', () => {
    // CLAUDE.md core rule 2: the first click establishes the plane and later points project onto
    // it. Re-planing mid-command is precisely what makes drawing feel random.
    useEditor.getState().addPoint([0, 0])
    useEditor.getState().applyHoverPlane(wallId)
    expect(planeElevation(useEditor.getState().workPlane)).toBeCloseTo(0, 9)
    expect(useEditor.getState().hoverPlaneElementId).toBeNull()
  })

  it('keeps a plane acquired before the first click for the whole command', () => {
    useEditor.getState().applyHoverPlane(wallId)
    useEditor.getState().addPoint([0, 0])
    // The cursor moves off the wall mid-draw; the plane must not drop out from under the point.
    useEditor.getState().applyHoverPlane(null)
    expect(planeElevation(useEditor.getState().workPlane)).toBeCloseTo(2.8, 9)
  })

  it('does not fight an explicitly locked plane', () => {
    useEditor.getState().setPlaneLocked(true)
    useEditor.getState().applyHoverPlane(wallId)
    expect(planeElevation(useEditor.getState().workPlane)).toBeCloseTo(0, 9)
  })

  it('ignores an element with no horizontal top', () => {
    useEditor.getState().applyHoverPlane('not-an-element')
    const s = useEditor.getState()
    expect(planeElevation(s.workPlane)).toBeCloseTo(0, 9)
    expect(s.hoverPlaneElementId).toBeNull()
  })

  it('ignores a wall whose top IS the active level plane', () => {
    // A wall on the level above, viewed from that level, is already the plane you are on.
    const s0 = useEditor.getState()
    const withUpper = addLevel(s0.scene, 'Upper')
    const upper = withUpper.levels.find((l) => l.name === 'Upper')!
    s0.loadScene(withUpper, upper.id)
    // The ground wall's top (2.8) coincides with the upper level's elevation (2.8).
    expect(upper.elevation).toBeCloseTo(2.8, 9)
    useEditor.getState().applyHoverPlane(wallId)
    expect(useEditor.getState().hoverPlaneElementId).toBeNull()
    expect(useEditor.getState().workPlane.source.kind).toBe('level')
  })

  it('is idempotent — re-hovering the same element does not churn state', () => {
    useEditor.getState().applyHoverPlane(wallId)
    const first = useEditor.getState().workPlane
    useEditor.getState().applyHoverPlane(wallId)
    expect(useEditor.getState().workPlane).toBe(first)
  })

  it('never writes hover planes into plane history', () => {
    // Previous/Next must step between planes the USER chose, not every pixel of mouse travel.
    const before = useEditor.getState().planeHistory
    useEditor.getState().applyHoverPlane(wallId)
    useEditor.getState().applyHoverPlane(null)
    expect(useEditor.getState().planeHistory).toBe(before)
  })

  it('Esc reverts a hover-acquired plane', () => {
    useEditor.getState().applyHoverPlane(wallId)
    useEditor.getState().addPoint([0, 0])
    useEditor.getState().cancelTool()
    const s = useEditor.getState()
    expect(planeElevation(s.workPlane)).toBeCloseTo(0, 9)
    expect(s.hoverPlaneElementId).toBeNull()
  })

  it('Esc leaves an explicitly locked plane alone', () => {
    useEditor.getState().select(wallId)
    useEditor.getState().setWorkPlaneToSelection()
    useEditor.getState().cancelTool()
    expect(planeElevation(useEditor.getState().workPlane)).toBeCloseTo(2.8, 9)
    expect(useEditor.getState().planeLocked).toBe(true)
  })

  it('switching level clears a hover plane', () => {
    useEditor.getState().applyHoverPlane(wallId)
    const s = useEditor.getState()
    const withUpper = addLevel(s.scene, 'Upper')
    s.loadScene(withUpper, s.activeLevelId)
    useEditor.getState().setActiveLevel(withUpper.levels.find((l) => l.name === 'Upper')!.id)
    expect(useEditor.getState().hoverPlaneElementId).toBeNull()
  })
})

describe('setWorkPlaneToSelection — the sticky plane (A3)', () => {
  let wallId = ''

  beforeEach(() => {
    const w = withWall()
    useEditor.getState().loadScene(w.scene, w.levelId)
    wallId = w.wallId
  })

  it('pins the plane to the selected element and locks it', () => {
    useEditor.getState().select(wallId)
    useEditor.getState().setWorkPlaneToSelection()
    const s = useEditor.getState()
    expect(planeElevation(s.workPlane)).toBeCloseTo(2.8, 9)
    expect(s.planeLocked).toBe(true)
    expect(s.workPlane.source.kind).toBe('face')
  })

  it('pushes plane history, so Previous returns to the level plane', () => {
    useEditor.getState().select(wallId)
    useEditor.getState().setWorkPlaneToSelection()
    useEditor.getState().goPreviousPlane()
    const s = useEditor.getState()
    expect(planeElevation(s.workPlane)).toBeCloseTo(0, 9)
    expect(s.workPlane.source.kind).toBe('level')
    // ...and Next steps forward again.
    useEditor.getState().goNextPlane()
    expect(planeElevation(useEditor.getState().workPlane)).toBeCloseTo(2.8, 9)
  })

  it('refuses and explains with no selection', () => {
    useEditor.getState().select(null)
    useEditor.getState().setWorkPlaneToSelection()
    const s = useEditor.getState()
    expect(s.statusMessage?.kind).toBe('error')
    expect(s.planeLocked).toBe(false)
  })

  it('refuses and explains for a multi-selection', () => {
    useEditor.getState().select(wallId)
    useEditor.getState().select('another', true)
    useEditor.getState().setWorkPlaneToSelection()
    expect(useEditor.getState().statusMessage?.kind).toBe('error')
  })

  it('refuses and explains for an element with no horizontal face', () => {
    const s = useEditor.getState()
    const r = s.scene.rooms.length
    expect(r).toBe(0)
    s.select('ghost-id')
    useEditor.getState().setWorkPlaneToSelection()
    expect(useEditor.getState().statusMessage?.kind).toBe('error')
    expect(useEditor.getState().planeLocked).toBe(false)
  })

  it('resetWorkPlaneToLevel releases the lock', () => {
    useEditor.getState().select(wallId)
    useEditor.getState().setWorkPlaneToSelection()
    useEditor.getState().resetWorkPlaneToLevel()
    const s = useEditor.getState()
    expect(s.planeLocked).toBe(false)
    expect(planeElevation(s.workPlane)).toBeCloseTo(0, 9)
  })
})

// ---------------------------------------------------------------------------
// The seam that makes A2 useful: a point placed on a hover plane lands at that elevation
// ---------------------------------------------------------------------------

describe('drawing on a re-planed face', () => {
  it('places geometry at the hovered top, not at the level', () => {
    const w = withWall()
    useEditor.getState().loadScene(w.scene, w.levelId)
    useEditor.getState().setTool('wall')
    useEditor.getState().applyHoverPlane(w.wallId)

    // The plane the commit path will read is the hover plane...
    const plane = useEditor.getState().workPlane
    expect(planeElevation(plane)).toBeCloseTo(2.8, 9)
    // ...and it maps scene 2D the same way a level plane does, which is what keeps every
    // downstream tool working unchanged.
    const level = levelWorkPlane('lv', 'Ground', 0)
    expect(worldToScene2D(plane, [2, 2.8, 5])).toEqual(worldToScene2D(level, [2, 0, 5]))
  })
})
