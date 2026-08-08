/**
 * Tool state machine. Each tool declares how many points it collects, what hint to show at each
 * click-phase, and how to turn its collected points into a scene mutation.
 *
 * Per-click-phase hints are why SketchUp is learnable without a manual: at any instant you know
 * what state you're in, what constraint is active, and what the number is.
 */
import {
  findLevel,
  findPrimitiveType,
  findStairType,
  findRailingType,
  findCeilingType,
  findCurtainWallType,
  findPlanView,
  defaultViewRange,
  type Baseline,
  type SceneGraph,
  type Vec2,
} from '../../../shared/types/scene'
import {
  distance,
  projectPointToSegment,
  baselineLength,
  baselinePointAt,
  baselinePolyline,
  bulgeThroughPoint,
  perpendicular,
  resolveWall,
  polygonCentroid,
  pointInPolygon,
} from '../../../shared/geometry/index'
import { rectangleFrame, defaultRoof } from '../../../shared/geometry/roof'
import {
  extendWall,
  offsetWall,
  splitWall,
  trimWall,
  type ModifyResult,
} from './modifyVerbs'
import {
  addWall,
  addSlab,
  addRoom,
  addColumn,
  addBeam,
  addFilledOpening,
  addRoof,
  addPrimitive,
  addStair,
  addRailing,
  addSlabOpening,
  addCeiling,
  addCurtainWall,
  addPlanRegion,
} from '../scene/mutations'
import { defaultStair } from '../../../shared/geometry/stair'
import { defaultRailing } from '../../../shared/geometry/railing'
import { newId as generateId } from '../scene/ids'
import { TOOL_POINTS, type EditorState, type Tool, type WallMode } from '../scene/store'

export interface ToolHint {
  /** Primary instruction for the current click-phase. */
  prompt: string
  /** Modifier keys available right now. */
  modifiers: string
}

/**
 * How many points the tool needs before it commits. Depends on state, not just the tool: an arc
 * wall takes a third point the wall passes through. 0 = unbounded (a closed loop).
 */
export function pointsNeeded(tool: Tool, wallMode: WallMode): number {
  if (tool === 'wall') return wallMode === 'arc' ? 3 : 2
  return TOOL_POINTS[tool]
}

/** Hint text for the status bar, per tool AND per click-phase. */
export function toolHint(tool: Tool, pointCount: number, wallMode: WallMode = 'line'): ToolHint {
  if (tool === 'wall' && wallMode === 'arc') {
    if (pointCount === 0) {
      return {
        prompt: 'Click the arc wall start point',
        modifiers: 'Type a number to set length · A straight/arc · Esc cancel',
      }
    }
    if (pointCount === 1) {
      return {
        prompt: 'Click the arc wall end point — this is the chord, not the curve',
        modifiers: 'Tab length/angle · X/Y axis lock · Esc cancel',
      }
    }
    return {
      prompt: 'Click a point the wall curves through',
      modifiers: 'Click on the chord for a straight wall · Esc cancel',
    }
  }

  switch (tool) {
    case 'select':
      return {
        prompt: 'Click to select · drag to move',
        modifiers: 'Shift add · Del delete · Esc clear',
      }
    case 'wall':
      return pointCount === 0
        ? {
            prompt: 'Click the wall start point',
            modifiers: 'Type a number to set length · A straight/arc · Esc cancel',
          }
        : {
            prompt: 'Click the wall end point, or type a length',
            modifiers: 'Tab length/angle · X/Y axis lock · Enter commit · Esc finish',
          }
    case 'beam':
      return pointCount === 0
        ? { prompt: 'Click the beam start point', modifiers: 'Esc cancel' }
        : { prompt: 'Click the beam end point, or type a length', modifiers: 'Tab length/angle · Esc cancel' }
    case 'slab':
      return pointCount < 3
        ? { prompt: `Click slab boundary vertices (${pointCount}/3 minimum)`, modifiers: 'Esc cancel' }
        : {
            prompt: 'Click more vertices, or click the first point to close',
            modifiers: 'Enter close · Backspace undo point · Esc cancel',
          }
    case 'room':
      return pointCount < 3
        ? { prompt: `Click room boundary vertices (${pointCount}/3 minimum)`, modifiers: 'Esc cancel' }
        : {
            prompt: 'Click more vertices, or click the first point to close',
            modifiers: 'Enter close · Backspace undo point · Esc cancel',
          }
    case 'ceiling':
      return pointCount < 3
        ? { prompt: `Click ceiling boundary vertices (${pointCount}/3 minimum)`, modifiers: 'Esc cancel' }
        : {
            prompt: 'Click more vertices, or click the first point to close',
            modifiers: 'Enter close · Backspace undo point · Esc cancel',
          }
    case 'roof':
      return pointCount < 4
        ? {
            prompt: `Click a rectangular roof footprint's 4 corners (${pointCount}/4)`,
            modifiers: 'Esc cancel',
          }
        : {
            prompt: 'Click the first point to close the footprint',
            modifiers: 'Enter close · Backspace undo point · Esc cancel',
          }
    case 'door':
      return { prompt: 'Click a wall to place a door', modifiers: 'Esc cancel' }
    case 'window':
      return { prompt: 'Click a wall to place a window', modifiers: 'Esc cancel' }
    case 'column':
      return { prompt: 'Click to place a column', modifiers: 'Esc cancel' }
    case 'measure':
      return pointCount === 0
        ? { prompt: 'Click the first measurement point', modifiers: 'Esc cancel' }
        : pointCount === 1
          ? { prompt: 'Click the second point to read the distance', modifiers: 'Esc cancel' }
          : { prompt: 'Click again to start a new measurement', modifiers: 'Esc cancel' }
    case 'dimension':
      return pointCount === 0
        ? {
            prompt: 'Snap to the first point to dimension from',
            modifiers: 'Esc cancel',
          }
        : {
            prompt: 'Snap to the second point',
            modifiers: 'Esc cancel',
          }
    case 'roomtag':
      return { prompt: 'Click a room to tag it with number, name and area', modifiers: 'Esc cancel' }
    case 'text':
      return { prompt: 'Click to place a text note', modifiers: 'Esc cancel' }
    case 'leader':
      return pointCount === 0
        ? { prompt: 'Click the point the leader arrow should point at', modifiers: 'Esc cancel' }
        : { prompt: 'Click where the note text should sit', modifiers: 'Esc cancel' }
    case 'spot':
      return {
        prompt: 'Click a point to read its elevation, coordinate, or roof slope',
        modifiers: 'Pick the readout in the ribbon · Esc cancel',
      }
    case 'columngrid':
      return {
        prompt: 'Click to place a column grid — edit axes in Properties',
        modifiers: 'Esc cancel',
      }
    case 'primitive':
      return {
        prompt: 'Click to place a solid — combine two with Union/Cut/Intersect in Modify',
        modifiers: 'Pick the shape in the ribbon · Esc cancel',
      }
    case 'stair':
      return pointCount === 0
        ? { prompt: 'Click the stair start point', modifiers: 'Esc cancel' }
        : { prompt: 'Click the stair end point — sets its direction', modifiers: 'Esc cancel' }
    case 'railing':
      return pointCount < 2
        ? { prompt: `Click railing path points (${pointCount}/2 minimum)`, modifiers: 'Esc cancel' }
        : {
            prompt: 'Click more points, or press Enter to finish the path',
            modifiers: 'Enter finish · Backspace undo point · Esc cancel',
          }
    case 'trim':
      return { prompt: 'Click the cutting edge, then the part to KEEP', modifiers: 'Esc cancel' }
    case 'extend':
      return {
        prompt: 'Click the boundary, then the wall end to extend',
        modifiers: 'Esc cancel',
      }
    case 'split':
      return { prompt: 'Click a wall where it should split', modifiers: 'Esc cancel' }
    case 'offset':
      return {
        prompt: 'Click a wall on the side the copy should go',
        modifiers: 'Set the distance in the ribbon · Esc cancel',
      }
    case 'curtainwall':
      return pointCount === 0
        ? { prompt: 'Click the curtain wall start point', modifiers: 'Esc cancel' }
        : {
            prompt: 'Click the end point — bays are set by the type, not drawn',
            modifiers: 'Tab length/angle · X/Y axis lock · Esc finish',
          }
    case 'planregion':
      return pointCount < 3
        ? {
            prompt: `Click the plan region boundary (${pointCount}/3 minimum)`,
            modifiers: 'Esc cancel',
          }
        : {
            prompt: 'Click more vertices, or click the first point to close',
            modifiers: 'Enter close · Backspace undo point · Esc cancel',
          }
  }
}

/** Second-phase prompt for the pair tools, once the boundary is picked. */
export function modifyHint(tool: Tool, hasRef: boolean): string {
  if (tool === 'trim') {
    return hasRef ? 'Now click the part of the wall to KEEP' : 'Click the cutting edge'
  }
  if (tool === 'extend') {
    return hasRef ? 'Now click the wall end to extend' : 'Click the boundary wall'
  }
  return ''
}

/** Does this tool close a loop (slab, room, ceiling) rather than collect a fixed number of points? */
export function isLoopTool(tool: Tool): boolean {
  return (
    tool === 'slab' ||
    tool === 'room' ||
    tool === 'roof' ||
    tool === 'ceiling' ||
    tool === 'planregion'
  )
}

/**
 * Does this tool collect an unbounded, OPEN path (B3)? Unlike a loop tool it never closes on the
 * first point — a railing is a path, not a boundary — so it is finished with Enter instead.
 */
export function isPathTool(tool: Tool): boolean {
  return tool === 'railing'
}

/** Modify verbs act on existing elements rather than placing points (D3). */
export function isModifyTool(tool: Tool): boolean {
  return tool === 'trim' || tool === 'extend' || tool === 'split' || tool === 'offset'
}

/** Trim and extend need two picks: the boundary first, then the target. */
export function isPairTool(tool: Tool): boolean {
  return tool === 'trim' || tool === 'extend'
}

/**
 * Run a modify verb from a pick. `refId` is the boundary for the pair tools (null for the
 * single-pick ones); `targetId` is the element just clicked and `point` where it was clicked —
 * which for trim is the side the user wants to KEEP.
 */
export function buildModify(
  state: EditorState,
  targetId: string,
  point: Vec2,
  refId: string | null,
): ModifyResult {
  switch (state.tool) {
    case 'trim':
      if (!refId) return { error: 'Pick the cutting edge first' }
      return trimWall(state.scene, targetId, refId, point)
    case 'extend':
      if (!refId) return { error: 'Pick the boundary first' }
      return extendWall(state.scene, targetId, refId, point)
    case 'split':
      return splitWall(state.scene, targetId, point)
    case 'offset': {
      const wall = state.scene.walls.find((w) => w.id === targetId)
      if (!wall) return { error: 'Offset works on walls' }
      const resolved = resolveWall(state.scene, wall)
      if (!resolved) return { error: 'That wall cannot be resolved' }
      // Sign from the side clicked, so the copy appears where the user pointed rather than on a
      // side determined by which way the wall happens to have been drawn.
      const at = baselinePointAt(resolved.centerline, baselineLength(resolved.centerline) / 2)
      const normal = perpendicular(at.tangent)
      const side =
        (point[0] - at.point[0]) * normal[0] + (point[1] - at.point[1]) * normal[1] >= 0 ? 1 : -1
      return offsetWall(state.scene, targetId, side * Math.abs(state.offsetDistance), true)
    }
    default:
      return { error: 'That tool does not modify existing walls' }
  }
}

/** Tools that act on an existing host rather than placing free points. */
export function isHostedTool(tool: Tool): boolean {
  return tool === 'door' || tool === 'window'
}

/**
 * Tools that place an instance of an active TYPE (D7) — every one of these has its own
 * `activeXTypeId` in the store. `repeatLastOperation` only tracks these: a room, room tag, text
 * note, leader, or column grid has no "type" for "same tool + type + parameters" to mean.
 */
export function isTypedPlacementTool(tool: Tool): boolean {
  return (
    tool === 'wall' ||
    tool === 'slab' ||
    tool === 'door' ||
    tool === 'window' ||
    tool === 'column' ||
    tool === 'beam' ||
    tool === 'roof' ||
    tool === 'primitive' ||
    tool === 'stair' ||
    tool === 'railing' ||
    tool === 'ceiling' ||
    tool === 'curtainwall'
  )
}

export interface CommitResult {
  label: string
  produce: (scene: SceneGraph) => SceneGraph
  /** Points to keep for chaining (walls continue from the last endpoint). */
  keepPoints: Vec2[]
  /** Id to select after committing, resolved after the mutation runs. */
  selectAfter?: (scene: SceneGraph) => string | null
}

/**
 * Turn a completed set of points into a mutation. Returns null when the points are not yet a
 * valid operation — the caller keeps collecting.
 */
export function buildCommit(state: EditorState, points: Vec2[]): CommitResult | null {
  const { tool, activeLevelId } = state

  switch (tool) {
    case 'wall': {
      const arc = state.wallMode === 'arc'
      if (points.length < (arc ? 3 : 2)) return null
      const [start, end, through] = points
      if (distance(start, end) < 1e-6) return null

      // A through-point on the chord means the user wants a straight wall; emit a `line` baseline
      // rather than an arc with bulge 0, so nothing downstream has to treat them as equivalent.
      const bulge = arc ? bulgeThroughPoint(start, end, through) : 0
      const baseline: Baseline =
        bulge === 0 ? { kind: 'line', start, end } : { kind: 'arc', start, end, bulge }

      let newId = ''
      return {
        label: arc && bulge !== 0 ? 'Add curved wall' : 'Add wall',
        produce: (scene) => {
          const r = addWall(scene, {
            levelId: activeLevelId,
            typeId: state.activeWallTypeId,
            baseline,
          })
          newId = r.id
          return r.scene
        },
        // Chain: the next wall continues from this endpoint.
        keepPoints: [end],
        selectAfter: () => newId,
      }
    }

    case 'beam': {
      if (points.length < 2) return null
      const [start, end] = points
      if (distance(start, end) < 1e-6) return null
      let newId = ''
      return {
        label: 'Add beam',
        produce: (scene) => {
          const r = addBeam(scene, activeLevelId, state.activeBeamTypeId, start, end)
          newId = r.id
          return r.scene
        },
        keepPoints: [end],
        selectAfter: () => newId,
      }
    }

    case 'slab': {
      if (points.length < 3) return null

      // Opening mode (B8): the closed loop becomes a hole in whichever existing slab on this
      // level contains it, rather than a new slab. Found by the loop's centroid, mirroring how
      // `roomtag` hit-tests a click against room polygons — refuses (null → generic flash) when
      // no slab qualifies, rather than guessing which one the user meant.
      if (state.slabMode === 'opening') {
        const target = state.scene.slabs.find(
          (s) => s.levelId === activeLevelId && pointInPolygon(polygonCentroid(points), s.boundary),
        )
        if (!target) return null
        return {
          label: 'Add slab opening',
          produce: (scene) => addSlabOpening(scene, target.id, points),
          keepPoints: [],
          selectAfter: () => target.id,
        }
      }

      let newId = ''
      return {
        label: 'Add slab',
        produce: (scene) => {
          const r = addSlab(scene, activeLevelId, state.activeSlabTypeId, points)
          newId = r.id
          return r.scene
        },
        keepPoints: [],
        selectAfter: () => newId,
      }
    }

    case 'room': {
      if (points.length < 3) return null
      let newId = ''
      return {
        label: 'Add room',
        produce: (scene) => {
          const r = addRoom(scene, activeLevelId, points)
          newId = r.id
          return r.scene
        },
        keepPoints: [],
        selectAfter: () => newId,
      }
    }

    case 'roof': {
      // A roof footprint must close as a rectangle — refuse (return null → generic flash) rather
      // than create a roof `resolveRoof` can never draw. See DECISIONS.md D-018.
      if (points.length !== 4 || !rectangleFrame(points)) return null
      const level = findLevel(state.scene, activeLevelId)
      const baseHeight = level?.height ?? 2.8
      const id = generateId('rf')
      return {
        label: 'Add roof',
        produce: (scene) =>
          addRoof(scene, defaultRoof(id, state.activeRoofTypeId, activeLevelId, points, baseHeight)),
        keepPoints: [],
        selectAfter: () => id,
      }
    }

    case 'primitive': {
      if (points.length < 1) return null
      // Refuse rather than invent a type: a primitive with no shape has no geometry, and silently
      // substituting one would hide that the document is missing the type it thinks it has.
      const type = findPrimitiveType(state.scene, state.activePrimitiveTypeId)
      if (!type) return null
      let newId = ''
      return {
        label: `Add ${type.name}`,
        produce: (scene) => {
          const r = addPrimitive(scene, activeLevelId, state.activePrimitiveTypeId, points[0])
          newId = r.id
          return r.scene
        },
        keepPoints: [],
        selectAfter: () => newId,
      }
    }

    case 'column': {
      if (points.length < 1) return null
      let newId = ''
      return {
        label: 'Add column',
        produce: (scene) => {
          const r = addColumn(scene, activeLevelId, state.activeColumnTypeId, points[0])
          newId = r.id
          return r.scene
        },
        keepPoints: [],
        selectAfter: () => newId,
      }
    }

    case 'stair': {
      if (points.length < 2) return null
      const [start, end] = points
      if (distance(start, end) < 1e-6) return null
      if (!findStairType(state.scene, state.activeStairTypeId)) return null
      const level = findLevel(state.scene, activeLevelId)
      const stair = defaultStair(
        generateId('st'),
        state.activeStairTypeId,
        activeLevelId,
        start,
        end,
        level?.height ?? 2.8,
      )
      return {
        label: 'Add stair',
        produce: (scene) => addStair(scene, stair),
        keepPoints: [],
        selectAfter: () => stair.id,
      }
    }

    case 'railing': {
      // An open path: 2 points minimum, and finished by Enter rather than by point count, so this
      // only ever runs once App.tsx's Enter handler has already confirmed points.length >= 2.
      if (points.length < 2) return null
      if (!findRailingType(state.scene, state.activeRailingTypeId)) return null
      const railing = defaultRailing(generateId('rl'), state.activeRailingTypeId, activeLevelId, points)
      return {
        label: 'Add railing',
        produce: (scene) => addRailing(scene, railing),
        keepPoints: [],
        selectAfter: () => railing.id,
      }
    }

    case 'ceiling': {
      if (points.length < 3) return null
      if (!findCeilingType(state.scene, state.activeCeilingTypeId)) return null
      const level = findLevel(state.scene, activeLevelId)
      const id = generateId('ceil')
      return {
        label: 'Add ceiling',
        produce: (scene) =>
          addCeiling(scene, {
            id,
            typeId: state.activeCeilingTypeId,
            levelId: activeLevelId,
            boundary: points,
            // Defaults to the underside of this level's own nominal height — the same "unconnected,
            // level.height" default a wall/room top starts with (D-009) — which for a ceiling reads
            // as "hangs right below the floor above".
            top: { kind: 'unconnected', height: level?.height ?? 2.8 },
          }),
        keepPoints: [],
        selectAfter: () => id,
      }
    }

    case 'curtainwall': {
      if (points.length < 2) return null
      const [start, end] = points
      if (distance(start, end) < 1e-6) return null
      if (!findCurtainWallType(state.scene, state.activeCurtainWallTypeId)) return null
      const level = findLevel(state.scene, activeLevelId)
      let newId = ''
      return {
        label: 'Add curtain wall',
        produce: (scene) => {
          const r = addCurtainWall(scene, {
            typeId: state.activeCurtainWallTypeId,
            levelId: activeLevelId,
            baseline: { kind: 'line', start, end },
            baseOffset: 0,
            top: { kind: 'unconnected', height: level?.height ?? 2.8 },
          })
          newId = r.id
          return r.scene
        },
        // Chains from the last endpoint exactly as the wall tool does — a glazed facade is
        // usually drawn as a run, not as isolated panels.
        keepPoints: [end],
        selectAfter: () => newId,
      }
    }

    case 'planregion': {
      if (points.length < 3) return null
      // A plan region belongs to a VIEW, so it needs the active level to have one. Every level
      // gets a plan view when it is created (C7), so this only fails on a scene with no level.
      const view = findPlanView(state.scene, activeLevelId)
      if (!view) return null
      let newId = ''
      return {
        label: 'Add plan region',
        produce: (scene) => {
          const r = addPlanRegion(scene, {
            viewId: view.id,
            name: `Region ${scene.planRegions.filter((p) => p.viewId === view.id).length + 1}`,
            boundary: points,
            // Seeded from the view's own range so the region starts identical to its
            // surroundings and the user changes only the one number they came here for.
            viewRange: { ...(view.viewRange ?? defaultViewRange(2.8)) },
          })
          newId = r.id
          return r.scene
        },
        keepPoints: [],
        selectAfter: () => newId,
      }
    }

    default:
      return null
  }
}

/**
 * Place a door or window on the wall nearest a click. Returns null (with a reason) when there is
 * no wall in range — the caller flashes the message rather than silently doing nothing.
 */
export function buildHostedCommit(
  state: EditorState,
  point: Vec2,
  maxDistance: number,
): { result: CommitResult } | { error: string } {
  const { scene, tool, activeLevelId } = state
  const hit = nearestWall(scene, point, activeLevelId, maxDistance)
  if (!hit) return { error: `No wall within reach — click directly on a wall to place a ${tool}` }

  const typeId = tool === 'door' ? state.activeDoorTypeId : state.activeWindowTypeId
  let newId: string | null = null

  return {
    result: {
      label: tool === 'door' ? 'Add door' : 'Add window',
      produce: (s) => {
        const r = addFilledOpening(s, hit.wallId, typeId, hit.offsetAlong)
        if (!r) return s
        newId = r.fillingId
        return r.scene
      },
      keepPoints: [],
      selectAfter: () => newId,
    },
  }
}

export interface WallHit {
  wallId: string
  /** Distance along the wall's centreline to the projected point. */
  offsetAlong: number
  distance: number
}

/** Nearest wall on a level to a 2D point, accounting for wall thickness. */
export function nearestWall(
  scene: SceneGraph,
  point: Vec2,
  levelId: string,
  maxDistance: number,
): WallHit | null {
  let best: WallHit | null = null
  let bestDist = maxDistance

  for (const wall of scene.walls) {
    if (wall.levelId !== levelId) continue
    const resolved = resolveWall(scene, wall)
    if (!resolved) continue
    const pts = baselinePolyline(resolved.centerline)

    let travelled = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const segLen = distance(a, b)
      const proj = projectPointToSegment(point, a, b)
      // Being inside the wall's thickness counts as a hit at distance 0.
      const reach = Math.max(0, proj.distance - resolved.thickness / 2)
      if (reach <= bestDist) {
        bestDist = reach
        best = {
          wallId: wall.id,
          offsetAlong: travelled + proj.t * segLen,
          distance: reach,
        }
      }
      travelled += segLen
    }
  }
  return best
}

/**
 * Should clicking the first point of a loop tool close it? True when the click lands on the
 * starting vertex and we already have enough points for a polygon.
 */
export function shouldCloseLoop(points: Vec2[], candidate: Vec2, tolerance: number): boolean {
  return points.length >= 3 && distance(points[0], candidate) <= tolerance
}
