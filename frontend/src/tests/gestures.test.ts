/**
 * Whole-gesture tests: screen clicks → committed geometry.
 *
 * These compose exactly the functions `viewport/Interaction.tsx` calls, in the same order, so a
 * complete drawing gesture is covered end to end without a WebGL context. Phase 1A had unit tests
 * for every part of this and still shipped a tool that flashed a false error on its second click,
 * because nothing tested the parts *together*.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import * as THREE from 'three'
import { resolvePointer, SNAP_APERTURE_PX, WALL_HIT_PX, type PointerContext } from '../editor/pointer'
import { commitActiveTool } from '../editor/commit'
import {
  buildHostedCommit,
  buildModify,
  isHostedTool,
  isLoopTool,
  isModifyTool,
  isPairTool,
  pointsNeeded,
  shouldCloseLoop,
} from '../editor/tools'
import { useEditor, type Tool } from '../scene/store'
import { levelWorkPlane } from '../../../shared/geometry/workplane'
import {
  resolveWall,
  baselineLength,
  baselinePolyline,
  distance,
} from '../../../shared/geometry/index'
import { fixture } from './helpers'
import { refFromPoint, resolveDimension } from '../../../shared/geometry/dimensions'
import { defaultRoomTag } from '../../../shared/geometry/annotations'
import { defaultColumnGrid } from '../../../shared/geometry/columnGrid'
import { pointInPolygon } from '../../../shared/geometry/index'
import {
  addDimension,
  updateWall,
  addAnnotation,
  addRoomTag,
  removeRoomTag,
  addColumnGrid,
} from '../scene/mutations'
import { newId } from '../scene/ids'

const RECT = { left: 0, top: 0, width: 800, height: 600 }

function camera(): THREE.OrthographicCamera {
  const halfH = 12
  const aspect = RECT.width / RECT.height
  const cam = new THREE.OrthographicCamera(
    -halfH * aspect,
    halfH * aspect,
    halfH,
    -halfH,
    -500,
    1000,
  )
  cam.position.set(0, 60, 0)
  cam.up.set(0, 0, -1)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)
  return cam
}

/** World units per pixel for this camera: 24 units over 600 px. */
const UPP = 24 / 600

function pointerContext(): PointerContext {
  const s = useEditor.getState()
  return {
    scene: s.scene,
    activeLevelId: s.activeLevelId,
    workPlane: s.workPlane,
    points: s.points,
    axisLock: s.axisLock,
    numeric: s.numeric,
    snapToggles: s.snapToggles,
    gridSize: s.gridSize,
    showGrid: s.showGrid,
    previousSnap: s.snap,
  }
}

/**
 * Mirror of the pointerdown dispatch in `Interaction.tsx`. Kept structurally identical so these
 * tests exercise the real decision tree rather than a paraphrase of it.
 */
function click(px: number, py: number): void {
  const r = resolvePointer(camera(), px, py, RECT, pointerContext())
  if (!r) throw new Error('pointer missed the work plane')
  const s = useEditor.getState()
  s.setSnap(r.snap, r.world)

  // Modify verbs act on the element under the cursor. The harness supplies `hoveredId` itself,
  // since there is no raycaster here.
  if (isModifyTool(s.tool)) {
    const id = s.hoveredId
    if (!id) {
      s.flash('Click directly on a wall', 'error')
      return
    }
    if (isPairTool(s.tool) && !s.pendingRefId) {
      s.setPendingRef(id)
      return
    }
    const outcome = buildModify(s, id, r.point, s.pendingRefId)
    if ('error' in outcome) {
      s.flash(outcome.error, 'error')
      return
    }
    s.commit(outcome.label, () => outcome.scene)
    s.selectMany(outcome.selectAfter)
    s.setPendingRef(null)
    return
  }

  if (isHostedTool(s.tool)) {
    const outcome = buildHostedCommit(s, r.point, r.worldPerPixel * WALL_HIT_PX)
    if ('error' in outcome) {
      s.flash(outcome.error, 'error')
      return
    }
    s.commit(outcome.result.label, outcome.result.produce)
    return
  }

  if (isLoopTool(s.tool)) {
    if (shouldCloseLoop(s.points, r.point, r.worldPerPixel * SNAP_APERTURE_PX)) {
      commitActiveTool(s.points)
      return
    }
    s.addPoint(r.point)
    return
  }

  if (s.tool === 'measure') {
    if (s.points.length >= 2) s.clearPoints()
    else s.addPoint(r.point)
    return
  }

  if (s.tool === 'dimension') {
    const ref = r.snap.sourceId ? refFromPoint(s.scene, r.snap.sourceId, r.point) : null
    const result = s.addDimPoint(r.point, ref)
    if (result === 'no-ref') {
      s.flash('Snap to a wall endpoint or vertex to place a dimension', 'error')
      return
    }
    const refs = useEditor.getState().pendingDimRefs
    if (refs.length >= 2) {
      const dim = {
        id: newId('dim'),
        viewId: 'default',
        kind: 'aligned' as const,
        ref1: refs[0],
        ref2: refs[1],
        textOverride: null,
        witnessGap: 0.15,
        offsetDistance: 0.3,
      }
      s.commit('Add dimension', (sc) => addDimension(sc, dim))
      s.clearPoints()
    }
    return
  }

  if (s.tool === 'roomtag') {
    const room = s.scene.rooms.find(
      (rm) => rm.levelId === s.activeLevelId && pointInPolygon(r.point, rm.polygon),
    )
    if (!room) {
      s.flash('Click inside a room to tag it', 'error')
      return
    }
    const existing = s.scene.roomTags.find((t) => t.roomId === room.id)
    if (existing) {
      s.commit('Remove room tag', (sc) => removeRoomTag(sc, existing.id))
    } else {
      const tag = defaultRoomTag(newId('rtag'), 'default', room)
      s.commit('Add room tag', (sc) => addRoomTag(sc, tag))
    }
    return
  }

  if (s.tool === 'text') {
    const ann = {
      id: newId('ann'),
      viewId: 'default',
      kind: 'text' as const,
      text: 'Text',
      position: r.point,
      leaderTarget: null,
      rotation: 0,
      textHeight: 0.2,
    }
    s.commit('Add text', (sc) => addAnnotation(sc, ann))
    s.select(ann.id)
    return
  }

  if (s.tool === 'columngrid') {
    const grid = defaultColumnGrid(newId('grid'), s.activeLevelId, r.point)
    s.commit('Add column grid', (sc) => addColumnGrid(sc, grid))
    s.select(grid.id)
    return
  }

  if (s.tool === 'leader') {
    if (s.points.length === 0) {
      s.addPoint(r.point)
      return
    }
    const target = s.points[0]
    const ann = {
      id: newId('ann'),
      viewId: 'default',
      kind: 'leader' as const,
      text: 'Note',
      position: r.point,
      leaderTarget: target,
      rotation: 0,
      textHeight: 0.2,
    }
    s.commit('Add leader', (sc) => addAnnotation(sc, ann))
    s.select(ann.id)
    s.clearPoints()
    return
  }

  const next = [...s.points, r.point]
  if (next.length >= pointsNeeded(s.tool, s.wallMode)) commitActiveTool(next)
  else s.addPoint(r.point)
}

/** Screen pixel for a scene-2D point under this camera (centre of viewport is scene origin). */
function px(sceneX: number, sceneY: number): [number, number] {
  return [400 + sceneX / UPP, 300 + sceneY / UPP]
}

function pickTool(tool: Tool): void {
  useEditor.getState().setTool(tool)
}

beforeEach(() => {
  const f = fixture()
  const s = useEditor.getState()
  s.loadScene(f.scene, f.levelId)
  useEditor.setState({
    workPlane: levelWorkPlane(f.levelId, 'Ground floor', 0),
    wallMode: 'line',
    // Snapping off by default so these tests assert the gesture, not the snap engine.
    showGrid: false,
    snapToggles: Object.fromEntries(
      Object.keys(s.snapToggles).map((k) => [k, false]),
    ) as typeof s.snapToggles,
  })
  s.setTool('select')
})

describe('wall gesture', () => {
  it('two clicks create one wall of the expected length', () => {
    pickTool('wall')
    click(...px(-2, 0))
    expect(useEditor.getState().scene.walls).toHaveLength(0) // first click only arms it
    expect(useEditor.getState().toolPhase).toBe('collecting')

    click(...px(3, 0))
    const walls = useEditor.getState().scene.walls
    expect(walls).toHaveLength(1)
    expect(baselineLength(walls[0].baseline)).toBeCloseTo(5, 4)
  })

  it('chains: the third click continues from the previous endpoint', () => {
    pickTool('wall')
    click(...px(0, 0))
    click(...px(4, 0))
    click(...px(4, 3))

    const walls = useEditor.getState().scene.walls
    expect(walls).toHaveLength(2)
    expect(baselineLength(walls[0].baseline)).toBeCloseTo(4, 4)
    expect(baselineLength(walls[1].baseline)).toBeCloseTo(3, 4)
    // Contiguous: wall 2 starts where wall 1 ended.
    expect(walls[1].baseline.start[0]).toBeCloseTo(walls[0].baseline.end[0], 6)
    expect(walls[1].baseline.start[1]).toBeCloseTo(walls[0].baseline.end[1], 6)
  })

  it('each chained wall is its own undo entry', () => {
    pickTool('wall')
    click(...px(0, 0))
    click(...px(4, 0))
    click(...px(4, 3))
    expect(useEditor.getState().undoStack).toHaveLength(2)

    useEditor.getState().undo()
    expect(useEditor.getState().scene.walls).toHaveLength(1)
    useEditor.getState().undo()
    expect(useEditor.getState().scene.walls).toHaveLength(0)
  })

  it('a typed length makes the committed wall exact', () => {
    pickTool('wall')
    click(...px(0, 0))
    const s = useEditor.getState()
    s.typeNumeric('4')
    s.typeNumeric('.')
    s.typeNumeric('2')
    s.commitNumeric()
    // Click far away in +X; the locked length must win over the cursor distance.
    click(...px(9, 0))

    const wall = useEditor.getState().scene.walls[0]
    expect(baselineLength(wall.baseline)).toBeCloseTo(4.2, 5)
  })

  it('an axis lock keeps a wall orthogonal despite an off-axis cursor', () => {
    pickTool('wall')
    click(...px(0, 0))
    useEditor.getState().setAxisLock('x')
    click(...px(5, 2.5))

    const wall = useEditor.getState().scene.walls[0]
    expect(wall.baseline.end[1]).toBeCloseTo(0, 6)
    expect(wall.baseline.end[0]).toBeCloseTo(5, 4)
  })

  it('the locks clear after a commit so the next segment starts clean', () => {
    pickTool('wall')
    click(...px(0, 0))
    useEditor.getState().setAxisLock('x')
    click(...px(5, 2.5))
    expect(useEditor.getState().axisLock).toBe('none')
    expect(useEditor.getState().numeric.lockedLength).toBeNull()
  })

  it('Esc mid-gesture discards the pending point and creates nothing', () => {
    pickTool('wall')
    click(...px(0, 0))
    useEditor.getState().cancelTool()
    expect(useEditor.getState().points).toEqual([])
    expect(useEditor.getState().scene.walls).toHaveLength(0)
    expect(useEditor.getState().undoStack).toHaveLength(0)
  })

  it('a degenerate double-click on the same point is refused with an explanation', () => {
    pickTool('wall')
    click(...px(1, 1))
    click(...px(1, 1))
    expect(useEditor.getState().scene.walls).toHaveLength(0)
    expect(useEditor.getState().statusMessage?.kind).toBe('error')
    expect(useEditor.getState().undoStack).toHaveLength(0)
  })

  it('uses the wall type selected in the ribbon', () => {
    useEditor.getState().setActiveType('wall', 'wt-int-100')
    pickTool('wall')
    click(...px(0, 0))
    click(...px(3, 0))
    const scene = useEditor.getState().scene
    expect(scene.walls[0].typeId).toBe('wt-int-100')
    expect(resolveWall(scene, scene.walls[0])!.thickness).toBeCloseTo(0.1, 6)
  })
})

/**
 * The 3-point arc wall (A1). Curved walls were supported everywhere except the tool; these tests
 * cover the gesture that finally draws one, including its two degenerate exits.
 */
describe('curved wall gesture', () => {
  const arcMode = () => {
    pickTool('wall')
    useEditor.getState().setWallMode('arc')
  }

  it('takes three clicks: two for the chord, one for the curve', () => {
    arcMode()
    click(...px(0, 0))
    expect(useEditor.getState().scene.walls).toHaveLength(0)
    click(...px(4, 0))
    // Still nothing — in arc mode the second click is the chord end, not a commit.
    expect(useEditor.getState().scene.walls).toHaveLength(0)
    expect(useEditor.getState().points).toHaveLength(2)

    click(...px(2, 1.5))
    const walls = useEditor.getState().scene.walls
    expect(walls).toHaveLength(1)
    expect(walls[0].baseline.kind).toBe('arc')
  })

  it('the committed arc passes through the third click', () => {
    arcMode()
    click(...px(0, 0))
    click(...px(4, 0))
    click(...px(2, 1))
    const b = useEditor.getState().scene.walls[0].baseline
    const nearest = Math.min(...baselinePolyline(b, 400).map((q) => distance(q, [2, 1])))
    expect(nearest).toBeLessThan(0.02)
  })

  it('the arc is longer than its chord', () => {
    arcMode()
    click(...px(0, 0))
    click(...px(4, 0))
    click(...px(2, 1))
    expect(baselineLength(useEditor.getState().scene.walls[0].baseline)).toBeGreaterThan(4)
  })

  it('a third click on the chord commits a straight wall, not a zero-bulge arc', () => {
    arcMode()
    click(...px(0, 0))
    click(...px(4, 0))
    click(...px(2, 0))
    const walls = useEditor.getState().scene.walls
    expect(walls).toHaveLength(1)
    expect(walls[0].baseline.kind).toBe('line')
  })

  it('chains from the chord end, so the next arc continues the run', () => {
    arcMode()
    click(...px(0, 0))
    click(...px(4, 0))
    click(...px(2, 1))
    const kept = useEditor.getState().points
    expect(kept).toHaveLength(1)
    expect(kept[0][0]).toBeCloseTo(4, 6)
    expect(kept[0][1]).toBeCloseTo(0, 6)
  })

  it('is one undo entry, and undo removes the whole curved wall', () => {
    arcMode()
    click(...px(0, 0))
    click(...px(4, 0))
    click(...px(2, 1))
    expect(useEditor.getState().undoStack).toHaveLength(1)
    useEditor.getState().undo()
    expect(useEditor.getState().scene.walls).toHaveLength(0)
  })

  it('switching mode mid-gesture discards the collected points', () => {
    // The required point COUNT changes, so keeping them would commit something the user did not
    // draw — a wall whose "curve point" was meant to be an endpoint.
    arcMode()
    click(...px(0, 0))
    click(...px(4, 0))
    useEditor.getState().setWallMode('line')
    expect(useEditor.getState().points).toEqual([])
    expect(useEditor.getState().toolPhase).toBe('idle')
    expect(useEditor.getState().scene.walls).toHaveLength(0)
  })

  it('Esc after two clicks cancels without creating anything', () => {
    arcMode()
    click(...px(0, 0))
    click(...px(4, 0))
    useEditor.getState().cancelTool()
    expect(useEditor.getState().scene.walls).toHaveLength(0)
    expect(useEditor.getState().points).toEqual([])
  })

  it('line mode is unaffected — still two clicks', () => {
    pickTool('wall')
    click(...px(0, 0))
    click(...px(4, 0))
    expect(useEditor.getState().scene.walls).toHaveLength(1)
    expect(useEditor.getState().scene.walls[0].baseline.kind).toBe('line')
  })
})

/**
 * The modify verbs through the real dispatch (D3). These cover the part the unit tests cannot: that
 * trim and extend need TWO picks in the right order and that a half-finished pair is abandoned
 * cleanly.
 */
describe('modify verb gestures', () => {
  /** Draw a horizontal wall and a vertical one crossing it at x = 3. */
  function drawCross(): { hId: string; vId: string } {
    pickTool('wall')
    click(...px(0, 0))
    click(...px(6, 0))
    useEditor.getState().cancelTool()
    click(...px(3, -2))
    click(...px(3, 2))
    useEditor.getState().cancelTool()
    const walls = useEditor.getState().scene.walls
    return { hId: walls[0].id, vId: walls[1].id }
  }

  /** The harness stands in for the raycaster. */
  const hover = (id: string | null) => useEditor.getState().setHovered(id)

  it('trim takes the cutting edge first, then the part to keep', () => {
    const { hId, vId } = drawCross()
    pickTool('trim')

    const historyBefore = useEditor.getState().undoStack.length
    hover(vId)
    click(...px(3, 1))
    // First pick only arms it — nothing has changed yet.
    expect(useEditor.getState().pendingRefId).toBe(vId)
    expect(useEditor.getState().undoStack).toHaveLength(historyBefore)

    hover(hId)
    click(...px(1, 0))
    const wall = useEditor.getState().scene.walls.find((w) => w.id === hId)!
    expect(wall.baseline.end[0]).toBeCloseTo(3, 4)
    // And the pair is cleared, so the next trim starts from scratch.
    expect(useEditor.getState().pendingRefId).toBeNull()
  })

  it('trim keeps whichever side was clicked', () => {
    const { hId, vId } = drawCross()
    pickTool('trim')
    hover(vId)
    click(...px(3, 1))
    hover(hId)
    click(...px(5, 0))
    const wall = useEditor.getState().scene.walls.find((w) => w.id === hId)!
    expect(wall.baseline.start[0]).toBeCloseTo(3, 4)
    expect(wall.baseline.end[0]).toBeCloseTo(6, 4)
  })

  it('a trim is one undo entry', () => {
    const { hId, vId } = drawCross()
    const before = useEditor.getState().undoStack.length
    pickTool('trim')
    hover(vId)
    click(...px(3, 1))
    hover(hId)
    click(...px(1, 0))
    expect(useEditor.getState().undoStack).toHaveLength(before + 1)
  })

  it('clicking empty space refuses and explains', () => {
    drawCross()
    pickTool('trim')
    hover(null)
    click(...px(20, 20))
    expect(useEditor.getState().statusMessage?.kind).toBe('error')
    expect(useEditor.getState().pendingRefId).toBeNull()
  })

  it('switching tools abandons a half-finished pair', () => {
    const { vId } = drawCross()
    pickTool('trim')
    hover(vId)
    click(...px(3, 1))
    expect(useEditor.getState().pendingRefId).toBe(vId)
    pickTool('select')
    expect(useEditor.getState().pendingRefId).toBeNull()
  })

  it('split takes one click and leaves both pieces selected', () => {
    const { hId } = drawCross()
    const before = useEditor.getState().scene.walls.length
    pickTool('split')
    hover(hId)
    click(...px(2, 0))
    expect(useEditor.getState().scene.walls).toHaveLength(before + 1)
    expect(useEditor.getState().selectedIds).toHaveLength(2)
  })

  /** Run the offset tool on the horizontal wall and return the wall it created. */
  function offsetAt(sceneY: number) {
    const { hId } = drawCross()
    const existing = new Set(useEditor.getState().scene.walls.map((w) => w.id))
    useEditor.getState().setOffsetDistance(1)
    pickTool('offset')
    hover(hId)
    click(...px(3, sceneY))
    const copy = useEditor.getState().scene.walls.find((w) => !existing.has(w.id))
    expect(copy).toBeDefined()
    return copy!
  }

  it('offset puts the copy on the side that was clicked', () => {
    expect(offsetAt(0.3).baseline.start[1]).toBeCloseTo(1, 4)
  })

  it('offset to the other side flips the sign', () => {
    expect(offsetAt(-0.3).baseline.start[1]).toBeCloseTo(-1, 4)
  })
})

describe('loop gestures', () => {
  it('a room closes when the last click lands on the first vertex', () => {
    pickTool('room')
    click(...px(0, 0))
    click(...px(4, 0))
    click(...px(4, 3))
    expect(useEditor.getState().scene.rooms).toHaveLength(0)
    // Click back on the start point to close.
    click(...px(0, 0))

    const rooms = useEditor.getState().scene.rooms
    expect(rooms).toHaveLength(1)
    expect(rooms[0].polygon).toHaveLength(3)
  })

  it('Enter closes an in-progress room without returning to the start', () => {
    pickTool('room')
    click(...px(0, 0))
    click(...px(4, 0))
    click(...px(4, 3))
    click(...px(0, 3))
    // Enter is handled by the keyboard layer, which calls the same commit path.
    commitActiveTool(useEditor.getState().points)

    expect(useEditor.getState().scene.rooms).toHaveLength(1)
    expect(useEditor.getState().scene.rooms[0].polygon).toHaveLength(4)
  })

  it('a slab needs three points; two are refused', () => {
    pickTool('slab')
    click(...px(0, 0))
    click(...px(4, 0))
    expect(commitActiveTool(useEditor.getState().points)).toBe(false)
    expect(useEditor.getState().scene.slabs).toHaveLength(0)
  })

  it('Backspace removes the last placed vertex', () => {
    pickTool('slab')
    click(...px(0, 0))
    click(...px(4, 0))
    click(...px(4, 3))
    expect(useEditor.getState().points).toHaveLength(3)
    useEditor.getState().popPoint()
    expect(useEditor.getState().points).toHaveLength(2)
  })
})

describe('hosted gestures — doors and windows', () => {
  function drawWall(): void {
    pickTool('wall')
    click(...px(0, 0))
    click(...px(5, 0))
    useEditor.getState().cancelTool()
  }

  it('clicking on a wall places a door centred on the click', () => {
    drawWall()
    pickTool('door')
    click(...px(2.5, 0))

    const scene = useEditor.getState().scene
    expect(scene.openings).toHaveLength(1)
    expect(scene.fillings).toHaveLength(1)
    const o = scene.openings[0]
    expect(o.offset + o.width / 2).toBeCloseTo(2.5, 3)
  })

  it('clicking away from any wall refuses and explains', () => {
    drawWall()
    pickTool('door')
    click(...px(2.5, 6))

    expect(useEditor.getState().scene.openings).toHaveLength(0)
    const msg = useEditor.getState().statusMessage
    expect(msg?.kind).toBe('error')
    expect(msg?.text).toContain('No wall within reach')
  })

  it('a window carries its type sill height', () => {
    drawWall()
    pickTool('window')
    click(...px(2.5, 0))
    expect(useEditor.getState().scene.openings[0].sillHeight).toBeCloseTo(0.9, 6)
  })

  it('placing a door is one undo entry that removes both void and filling', () => {
    drawWall()
    const before = useEditor.getState().undoStack.length
    pickTool('door')
    click(...px(2.5, 0))
    expect(useEditor.getState().undoStack).toHaveLength(before + 1)

    useEditor.getState().undo()
    expect(useEditor.getState().scene.openings).toHaveLength(0)
    expect(useEditor.getState().scene.fillings).toHaveLength(0)
  })
})

describe('measure gesture', () => {
  // Regression: measure creates no element, so it must never reach the commit path — doing so
  // flashed a spurious "invalid element" error on the second click.
  it('collects two points, creates nothing, and never errors', () => {
    pickTool('measure')
    click(...px(0, 0))
    click(...px(3, 4))

    const s = useEditor.getState()
    expect(s.points).toHaveLength(2)
    expect(s.scene.walls).toHaveLength(0)
    expect(s.undoStack).toHaveLength(0)
    expect(s.statusMessage?.kind).not.toBe('error')
  })

  it('a third click starts a fresh measurement', () => {
    pickTool('measure')
    click(...px(0, 0))
    click(...px(3, 4))
    click(...px(1, 1))
    expect(useEditor.getState().points).toHaveLength(0)
    expect(useEditor.getState().statusMessage?.kind).not.toBe('error')
  })
})

describe('dimension gesture', () => {
  function enableEndpointSnap(): void {
    const s = useEditor.getState()
    useEditor.setState({
      snapToggles: { ...s.snapToggles, endpoint: true },
    })
  }

  it('snapping to two wall endpoints creates a parametric dimension', () => {
    pickTool('wall')
    click(...px(0, 0))
    click(...px(5, 0))
    const wall = useEditor.getState().scene.walls[0]

    pickTool('dimension')
    enableEndpointSnap()
    click(...px(0, 0))
    expect(useEditor.getState().points).toHaveLength(1)
    click(...px(5, 0))

    const s = useEditor.getState()
    expect(s.scene.dimensions).toHaveLength(1)
    expect(s.points).toHaveLength(0)
    const dim = s.scene.dimensions[0]
    expect(dim.ref1.elementId).toBe(wall.id)
    expect(dim.ref2.elementId).toBe(wall.id)
    expect(new Set([dim.ref1.pointIndex, dim.ref2.pointIndex])).toEqual(new Set([0, 1]))
  })

  it('refuses a click that does not land on a named element point', () => {
    pickTool('wall')
    click(...px(0, 0))
    click(...px(5, 0))

    pickTool('dimension')
    enableEndpointSnap()
    // Click far from any wall endpoint — nothing to snap to.
    click(...px(2.5, 2.5))

    const s = useEditor.getState()
    expect(s.points).toHaveLength(0)
    expect(s.scene.dimensions).toHaveLength(0)
    expect(s.statusMessage?.kind).toBe('error')
  })

  it('the created dimension tracks the wall after it moves', () => {
    pickTool('wall')
    click(...px(0, 0))
    click(...px(5, 0))
    const wallId = useEditor.getState().scene.walls[0].id

    pickTool('dimension')
    enableEndpointSnap()
    click(...px(0, 0))
    click(...px(5, 0))

    const before = useEditor.getState().scene
    const dim = before.dimensions[0]
    const resolvedBefore = resolveDimension(before, dim)!
    expect(resolvedBefore.value).toBeCloseTo(5)

    // Move the wall's end point further out — the dimension must follow.
    const moved = updateWall(before, wallId, {
      baseline: { kind: 'line', start: [0, 0], end: [8, 0] },
    })
    const resolvedAfter = resolveDimension(moved, dim)!
    expect(resolvedAfter.value).toBeCloseTo(8)
  })

  // A4: dimensions persist by living in the scene graph itself, so undo/redo — which snapshots
  // the whole scene — carries them for free, with no dimension-specific undo code required.
  it('undo removes the dimension and redo brings it back', () => {
    pickTool('wall')
    click(...px(0, 0))
    click(...px(5, 0))

    pickTool('dimension')
    enableEndpointSnap()
    click(...px(0, 0))
    click(...px(5, 0))
    expect(useEditor.getState().scene.dimensions).toHaveLength(1)

    useEditor.getState().undo()
    expect(useEditor.getState().scene.dimensions).toHaveLength(0)

    useEditor.getState().redo()
    expect(useEditor.getState().scene.dimensions).toHaveLength(1)
  })
})

describe('room tag gesture', () => {
  it('clicking inside a room creates a tag at its centroid', () => {
    pickTool('room')
    click(...px(0, 0))
    click(...px(4, 0))
    click(...px(4, 4))
    click(...px(0, 4))
    click(...px(0, 0)) // close the loop

    pickTool('roomtag')
    click(...px(2, 2))

    const s = useEditor.getState()
    expect(s.scene.roomTags).toHaveLength(1)
    expect(s.scene.roomTags[0].roomId).toBe(s.scene.rooms[0].id)
  })

  it('clicking an already-tagged room removes the tag (toggle)', () => {
    pickTool('room')
    click(...px(0, 0))
    click(...px(4, 0))
    click(...px(4, 4))
    click(...px(0, 4))
    click(...px(0, 0))

    pickTool('roomtag')
    click(...px(2, 2))
    expect(useEditor.getState().scene.roomTags).toHaveLength(1)
    click(...px(2, 2))
    expect(useEditor.getState().scene.roomTags).toHaveLength(0)
  })

  it('clicking empty space refuses and explains', () => {
    pickTool('roomtag')
    click(...px(50, 50))
    const s = useEditor.getState()
    expect(s.scene.roomTags).toHaveLength(0)
    expect(s.statusMessage?.kind).toBe('error')
  })
})

describe('text annotation gesture', () => {
  it('one click places a text note and selects it', () => {
    pickTool('text')
    click(...px(1, 1))
    const s = useEditor.getState()
    expect(s.scene.annotations).toHaveLength(1)
    expect(s.scene.annotations[0].kind).toBe('text')
    expect(s.selectedIds).toEqual([s.scene.annotations[0].id])
  })
})

describe('leader gesture', () => {
  it('two clicks place a leader with the correct target and text position', () => {
    pickTool('leader')
    click(...px(0, 0))
    expect(useEditor.getState().points).toHaveLength(1)
    click(...px(2, 2))

    const s = useEditor.getState()
    expect(s.scene.annotations).toHaveLength(1)
    const ann = s.scene.annotations[0]
    expect(ann.kind).toBe('leader')
    expect(ann.leaderTarget![0]).toBeCloseTo(0)
    expect(ann.leaderTarget![1]).toBeCloseTo(0)
    expect(ann.position[0]).toBeCloseTo(2)
    expect(ann.position[1]).toBeCloseTo(2)
    expect(s.points).toHaveLength(0)
  })
})

describe('column grid gesture', () => {
  it('one click places a default grid at the click point and selects it', () => {
    pickTool('columngrid')
    click(...px(1, 2))

    const s = useEditor.getState()
    expect(s.scene.columnGrids).toHaveLength(1)
    const grid = s.scene.columnGrids[0]
    expect(grid.origin[0]).toBeCloseTo(1)
    expect(grid.origin[1]).toBeCloseTo(2)
    expect(grid.xAxes).toHaveLength(4)
    expect(grid.yAxes).toHaveLength(3)
    expect(s.selectedIds).toEqual([grid.id])
  })

  it('is one undo entry', () => {
    const before = useEditor.getState().undoStack.length
    pickTool('columngrid')
    click(...px(0, 0))
    expect(useEditor.getState().undoStack.length).toBe(before + 1)
    useEditor.getState().undo()
    expect(useEditor.getState().scene.columnGrids).toHaveLength(0)
  })
})

describe('roof gesture', () => {
  it('four clicks on a rectangle create a roof, closing on the first vertex', () => {
    pickTool('roof')
    click(...px(0, 0))
    click(...px(6, 0))
    click(...px(6, 10))
    click(...px(0, 10))
    click(...px(0, 0)) // close on the first vertex

    const s = useEditor.getState()
    expect(s.scene.roofs).toHaveLength(1)
    expect(s.scene.roofs[0].edges).toHaveLength(4)
    expect(s.scene.roofs[0].edges.every((e) => e.angle === 30)).toBe(true)
  })

  it('refuses a non-rectangular footprint', () => {
    pickTool('roof')
    click(...px(0, 0))
    click(...px(6, 0))
    click(...px(5, 4))
    click(...px(1, 4))
    click(...px(0, 0))

    const s = useEditor.getState()
    expect(s.scene.roofs).toHaveLength(0)
    expect(s.statusMessage?.kind).toBe('error')
  })

  it('is one undo entry', () => {
    const before = useEditor.getState().undoStack.length
    pickTool('roof')
    click(...px(0, 0))
    click(...px(6, 0))
    click(...px(6, 10))
    click(...px(0, 10))
    click(...px(0, 0))
    expect(useEditor.getState().undoStack.length).toBe(before + 1)
    useEditor.getState().undo()
    expect(useEditor.getState().scene.roofs).toHaveLength(0)
  })
})

describe('column gesture', () => {
  it('a single click places a column', () => {
    pickTool('column')
    click(...px(2, 2))
    const columns = useEditor.getState().scene.columns
    expect(columns).toHaveLength(1)
    expect(columns[0].position[0]).toBeCloseTo(2, 4)
    expect(columns[0].position[1]).toBeCloseTo(2, 4)
  })
})

describe('snapping inside a real gesture', () => {
  it('the second wall snaps its start onto the first wall endpoint', () => {
    // Re-enable endpoint snapping for this one.
    useEditor.setState({
      snapToggles: {
        ...useEditor.getState().snapToggles,
        endpoint: true,
      },
    })

    pickTool('wall')
    click(...px(0, 0))
    click(...px(4, 0))
    useEditor.getState().cancelTool()

    // Start the next wall a few pixels off the previous endpoint; it must land exactly on it.
    click(...px(4 + 3 * UPP, 0 + 3 * UPP))
    click(...px(4, 3))

    const walls = useEditor.getState().scene.walls
    expect(walls).toHaveLength(2)
    expect(walls[1].baseline.start[0]).toBeCloseTo(4, 6)
    expect(walls[1].baseline.start[1]).toBeCloseTo(0, 6)
  })
})
