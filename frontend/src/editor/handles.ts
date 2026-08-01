/**
 * Direct parametric handles — dragging the geometry itself rather than a transform gizmo.
 *
 * The CAD research called out "a gizmo as the only way to edit anything" as a toy tell: in every
 * reference tool you grab a wall's endpoint and the wall follows, you grab its face and the
 * thickness changes, you grab its top and push it taller. Phase 1A could only move whole elements.
 * This is the seam that fixes it (PHASE1B-SCOPE.md D1, plus A1's bulge handle).
 *
 * Pure on purpose: `handlesFor` derives handle positions from the scene graph and the `apply*`
 * functions turn a dragged position back into a mutation. The viewport layer only renders grips and
 * forwards pointer positions, so the arithmetic that decides what a drag *means* is testable without
 * a WebGL context — the lesson from the Phase 1A defects.
 *
 * Two drag spaces, because two different questions are being asked:
 *  - `plane` handles read a scene-2D point on the active work plane (position, shape, thickness).
 *  - `vertical` handles read a world elevation (push/pull height). These cannot go through
 *    `resolvePointer`, which refuses non-horizontal planes by design (D-007).
 */
import type { SceneGraph, Vec2 } from '../../../shared/types/scene'
import { findLevel, assemblyThickness } from '../../../shared/types/scene'
import {
  baselineApex,
  baselineStart,
  baselineEnd,
  baselineLength,
  baselinePointAt,
  bulgeThroughPoint,
  columnSolid,
  distance,
  perpendicular,
  resolveWall,
} from '../../../shared/geometry/index'
import {
  setWallEndpoint,
  updateWall,
  updateSlab,
  updateColumn,
  setWallTypeThickness,
} from '../scene/mutations'

/**
 * What dragging a handle changes. Kept explicit rather than inferred from position so the undo
 * label can say what actually happened.
 */
export type HandleKind =
  /** Move one end of a wall's baseline. */
  | 'wall-start'
  | 'wall-end'
  /** Bow a wall's baseline through the dragged point — straight ⇄ curved, either direction. */
  | 'wall-bulge'
  /** Drag a wall's face to change the assembly thickness. Edits the TYPE — see below. */
  | 'wall-thickness'
  /** Push/pull a wall's top. */
  | 'wall-top'
  /** Push/pull a column's top. */
  | 'column-top'
  /** Move one vertex of a slab boundary. */
  | 'slab-vertex'

/** Which space the drag is read in. */
export type HandleSpace = 'plane' | 'vertical'

export interface Handle {
  /** Stable within one selection, so React keys and drag state survive a re-render. */
  id: string
  kind: HandleKind
  space: HandleSpace
  elementId: string
  /** Position in scene 2D. */
  position: Vec2
  /** World elevation to draw the grip at. */
  elevation: number
  /** Index into a vertex list, for the handle kinds that need one. */
  index?: number
  /** Undo label for a completed drag of this handle. */
  label: string
  /**
   * True when the drag edits a shared TYPE rather than this instance, so the UI can warn. Editing a
   * type updating every instance is the defining BIM interaction (CLAUDE.md rule 4), not a bug —
   * but it must never be a surprise.
   */
  editsType?: boolean
}

/** A wall assembly thinner than this is not a wall. */
export const MIN_WALL_THICKNESS = 0.01
/** Pushing a wall or column shorter than this collapses it; refuse instead. */
export const MIN_ELEMENT_HEIGHT = 0.05

/**
 * Every handle for the current selection. Empty for a multi-selection — dragging a handle when
 * several elements are selected has no single obvious meaning, and guessing is worse than nothing.
 */
export function handlesFor(scene: SceneGraph, selectedIds: string[]): Handle[] {
  if (selectedIds.length !== 1) return []
  const id = selectedIds[0]

  const wall = scene.walls.find((w) => w.id === id)
  if (wall) {
    const resolved = resolveWall(scene, wall)
    if (!resolved) return []
    const start = baselineStart(wall.baseline)
    const end = baselineEnd(wall.baseline)

    const handles: Handle[] = [
      {
        id: `${id}:start`,
        kind: 'wall-start',
        space: 'plane',
        elementId: id,
        position: start,
        elevation: resolved.baseElevation,
        label: 'Move wall end',
      },
      {
        id: `${id}:end`,
        kind: 'wall-end',
        space: 'plane',
        elementId: id,
        position: end,
        elevation: resolved.baseElevation,
        label: 'Move wall end',
      },
    ]

    // A degenerate wall has no meaningful midpoint to bow or to hang a face handle off, and grips
    // stacked on top of the endpoint grips would just make all of them unclickable.
    if (distance(start, end) > 1e-6) {
      handles.push({
        id: `${id}:bulge`,
        kind: 'wall-bulge',
        space: 'plane',
        elementId: id,
        position: baselineApex(wall.baseline),
        elevation: resolved.baseElevation,
        label: 'Curve wall',
      })

      const face = wallFaceStation(scene, id)
      if (face) {
        handles.push({
          id: `${id}:thickness`,
          kind: 'wall-thickness',
          space: 'plane',
          elementId: id,
          position: face.facePoint,
          elevation: resolved.baseElevation,
          label: 'Change wall thickness',
          editsType: true,
        })
      }

      handles.push({
        id: `${id}:top`,
        kind: 'wall-top',
        space: 'vertical',
        elementId: id,
        position: midStation(scene, id) ?? baselineApex(wall.baseline),
        elevation: resolved.topElevation,
        label: 'Change wall height',
      })
    }

    return handles
  }

  const column = scene.columns.find((c) => c.id === id)
  if (column) {
    const solid = columnSolid(scene, column)
    if (!solid) return []
    return [
      {
        id: `${id}:top`,
        kind: 'column-top',
        space: 'vertical',
        elementId: id,
        position: column.position,
        elevation: solid.center[1] + solid.size[1] / 2,
        label: 'Change column height',
      },
    ]
  }

  const slab = scene.slabs.find((s) => s.id === id)
  if (slab) {
    const level = findLevel(scene, slab.levelId)
    const elevation = (level?.elevation ?? 0) + slab.heightOffset
    return slab.boundary.map((p, i) => ({
      id: `${id}:v${i}`,
      kind: 'slab-vertex' as const,
      space: 'plane' as const,
      elementId: id,
      position: p,
      elevation,
      index: i,
      label: 'Reshape slab',
    }))
  }

  return []
}

/** Midpoint of a wall's resolved centreline, in scene 2D. */
function midStation(scene: SceneGraph, wallId: string): Vec2 | null {
  const wall = scene.walls.find((w) => w.id === wallId)
  if (!wall) return null
  const resolved = resolveWall(scene, wall)
  if (!resolved) return null
  const half = baselineLength(resolved.centerline) / 2
  return baselinePointAt(resolved.centerline, half).point
}

/**
 * Where the thickness grip sits, and the direction that grows the wall: the midpoint of the
 * resolved centreline, pushed out to the face along the centreline's left normal.
 */
function wallFaceStation(
  scene: SceneGraph,
  wallId: string,
): { mid: Vec2; normal: Vec2; facePoint: Vec2; thickness: number } | null {
  const wall = scene.walls.find((w) => w.id === wallId)
  if (!wall) return null
  const resolved = resolveWall(scene, wall)
  if (!resolved) return null
  const len = baselineLength(resolved.centerline)
  if (len < 1e-9) return null
  const at = baselinePointAt(resolved.centerline, len / 2)
  const normal = perpendicular(at.tangent)
  const half = resolved.thickness / 2
  return {
    mid: at.point,
    normal,
    facePoint: [at.point[0] + normal[0] * half, at.point[1] + normal[1] * half],
    thickness: resolved.thickness,
  }
}

/**
 * Apply a drag of a `plane`-space handle. Returns the scene unchanged when the drag would produce
 * invalid geometry — refuse rather than degrade silently (CLAUDE.md core rule 3).
 */
export function applyHandleDrag(scene: SceneGraph, handle: Handle, point: Vec2): SceneGraph {
  switch (handle.kind) {
    case 'wall-start':
    case 'wall-end': {
      const wall = scene.walls.find((w) => w.id === handle.elementId)
      if (!wall) return scene
      const which = handle.kind === 'wall-start' ? 'start' : 'end'
      const other = which === 'start' ? baselineEnd(wall.baseline) : baselineStart(wall.baseline)
      // Collapsing a wall to zero length is not an edit, it is a delete by accident.
      if (distance(point, other) < 1e-3) return scene
      return setWallEndpoint(scene, handle.elementId, which, point)
    }

    case 'wall-bulge': {
      const wall = scene.walls.find((w) => w.id === handle.elementId)
      if (!wall) return scene
      const start = baselineStart(wall.baseline)
      const end = baselineEnd(wall.baseline)
      const bulge = bulgeThroughPoint(start, end, point)
      // Dragging the handle back onto the chord straightens the wall — a `line` baseline, not an
      // arc with bulge 0, so exporters and the plan view never have to treat them as equivalent.
      return updateWall(scene, handle.elementId, {
        baseline: bulge === 0 ? { kind: 'line', start, end } : { kind: 'arc', start, end, bulge },
      })
    }

    case 'wall-thickness': {
      const wall = scene.walls.find((w) => w.id === handle.elementId)
      const face = wallFaceStation(scene, handle.elementId)
      if (!wall || !face) return scene
      // Only the component along the face normal counts: sliding the grip *along* the wall must not
      // change its thickness.
      const d =
        (point[0] - face.mid[0]) * face.normal[0] + (point[1] - face.mid[1]) * face.normal[1]
      const thickness = Math.abs(d) * 2
      if (thickness < MIN_WALL_THICKNESS) return scene
      return setWallTypeThickness(scene, wall.typeId, thickness)
    }

    case 'slab-vertex': {
      const slab = scene.slabs.find((s) => s.id === handle.elementId)
      if (!slab || handle.index === undefined) return scene
      const boundary = slab.boundary.map((p, i) => (i === handle.index ? point : p))
      return updateSlab(scene, handle.elementId, { boundary })
    }

    // Vertical handles are driven by `applyHandleHeightDrag`; a plane drag on one is a no-op rather
    // than a silent misinterpretation of the pointer.
    case 'wall-top':
    case 'column-top':
      return scene
  }
}

/**
 * Apply a drag of a `vertical`-space handle: push/pull an element's top to a world elevation.
 *
 * A **level-bound** top stays level-bound — only its offset changes. That is the whole point of the
 * `top` union (D-009): a wall whose top follows storey height must keep following it after being
 * nudged, or multi-storey editing quietly stops working.
 */
export function applyHandleHeightDrag(
  scene: SceneGraph,
  handle: Handle,
  elevation: number,
): SceneGraph {
  switch (handle.kind) {
    case 'wall-top': {
      const wall = scene.walls.find((w) => w.id === handle.elementId)
      if (!wall) return scene
      const level = findLevel(scene, wall.levelId)
      if (!level) return scene
      const base = level.elevation + wall.baseOffset
      if (elevation - base < MIN_ELEMENT_HEIGHT) return scene

      if (wall.top.kind === 'level') {
        const topLevel = findLevel(scene, wall.top.levelId)
        if (topLevel) {
          return updateWall(scene, handle.elementId, {
            top: { kind: 'level', levelId: wall.top.levelId, offset: elevation - topLevel.elevation },
          })
        }
      }
      return updateWall(scene, handle.elementId, {
        top: { kind: 'unconnected', height: elevation - base },
      })
    }

    case 'column-top': {
      const column = scene.columns.find((c) => c.id === handle.elementId)
      if (!column) return scene
      const level = findLevel(scene, column.levelId)
      if (!level) return scene
      const base = level.elevation + column.baseOffset
      if (elevation - base < MIN_ELEMENT_HEIGHT) return scene

      if (column.top.kind === 'level') {
        const topLevel = findLevel(scene, column.top.levelId)
        if (topLevel) {
          return updateColumn(scene, handle.elementId, {
            top: {
              kind: 'level',
              levelId: column.top.levelId,
              offset: elevation - topLevel.elevation,
            },
          })
        }
      }
      return updateColumn(scene, handle.elementId, {
        top: { kind: 'unconnected', height: elevation - base },
      })
    }

    default:
      return scene
  }
}

/**
 * How many instances a type-editing drag will affect. The properties panel already offers
 * "duplicate type" for diverging; this is what lets the viewport say so before the fact.
 */
export function instancesOfWallType(scene: SceneGraph, typeId: string): number {
  return scene.walls.filter((w) => w.typeId === typeId).length
}

/** Current total thickness of a wall's type, for the drag readout. */
export function wallTypeThickness(scene: SceneGraph, typeId: string): number {
  const type = scene.types.find((t) => t.id === typeId)
  if (!type || type.category !== 'wall') return 0
  return assemblyThickness(type.layers)
}
