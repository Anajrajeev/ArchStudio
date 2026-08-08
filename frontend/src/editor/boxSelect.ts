/**
 * Box / rubber-band select (PHASE1B-SCOPE.md A5).
 *
 * Two modes, distinguished by drag direction exactly as AutoCAD, Revit and Vectorworks do — users
 * test this within the first minute:
 *  - drag LEFT → RIGHT = **window**: only elements *entirely* inside the box. Solid border.
 *  - drag RIGHT → LEFT = **crossing**: anything the box *touches*. Dashed border.
 *
 * The test is done in SCREEN space, not scene 2D. This is a 3D-native editor, so in a perspective
 * view a screen rectangle is a frustum, not a rectangle in the model — testing scene-2D coordinates
 * against screen corners would select the wrong things at any camera angle other than straight down.
 *
 * The projection is injected rather than imported, which keeps this module pure and lets the tests
 * use a trivial orthographic projector instead of standing up a camera.
 *
 * Crossing tests real element EDGES, not a bounding box: a wall that spans the whole box with no
 * vertex inside it must still be caught, and a bounding box would also wrongly catch elements that
 * merely pass near a diagonal one.
 */
import {
  BOX_EDGES,
  boxCorners,
  beamSolid,
  columnSolid,
  prismCornersAndEdges,
  resolveSlab,
  resolveWall,
  segmentIntersection,
  wallSolidBoxes,
} from '../../../shared/geometry/index'
import { resolveWallJoins } from '../../../shared/geometry/wallJoin'
import {
  findLevel,
  findType,
  resolveTopElevation,
  type SceneGraph,
  type Vec2,
  type Vec3,
} from '../../../shared/types/scene'

export type BoxMode = 'window' | 'crossing'

/** A normalized screen-space rectangle, in CSS pixels relative to the canvas. */
export interface ScreenBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Projects a world point to canvas pixels. Supplied by the viewport. */
export type Projector = (world: Vec3) => Vec2

/**
 * Which mode a drag is in. Direction of travel along X decides, per the universal CAD convention;
 * a purely vertical drag counts as window (the conservative choice — it selects less).
 */
export function boxModeFor(startX: number, currentX: number): BoxMode {
  return currentX < startX ? 'crossing' : 'window'
}

export function normalizeBox(a: Vec2, b: Vec2): ScreenBox {
  return {
    minX: Math.min(a[0], b[0]),
    minY: Math.min(a[1], b[1]),
    maxX: Math.max(a[0], b[0]),
    maxY: Math.max(a[1], b[1]),
  }
}

/** A drag shorter than this in either axis is a click, not a box. */
export const MIN_BOX_PX = 4

export function isBoxDrag(a: Vec2, b: Vec2): boolean {
  return Math.abs(b[0] - a[0]) >= MIN_BOX_PX || Math.abs(b[1] - a[1]) >= MIN_BOX_PX
}

function contains(box: ScreenBox, p: Vec2): boolean {
  return p[0] >= box.minX && p[0] <= box.maxX && p[1] >= box.minY && p[1] <= box.maxY
}

/** The four sides of a screen box, as segments. */
function boxEdges(box: ScreenBox): Array<[Vec2, Vec2]> {
  const tl: Vec2 = [box.minX, box.minY]
  const tr: Vec2 = [box.maxX, box.minY]
  const br: Vec2 = [box.maxX, box.maxY]
  const bl: Vec2 = [box.minX, box.maxY]
  return [
    [tl, tr],
    [tr, br],
    [br, bl],
    [bl, tl],
  ]
}

/** An element reduced to the vertices and edges box-select needs to test. */
export interface Silhouette {
  id: string
  corners: Vec3[]
  edges: Array<[number, number]>
}

/**
 * Every selectable element on a level, as corners + edges.
 *
 * Derived from the SAME solid decomposition the renderers use (`wallSolidBoxes`, `columnSolid`,
 * `beamSolid`, `resolveSlab`), so what you can rubber-band is exactly what you can see. A separate
 * approximation here would drift out of agreement with the viewport, which is the class of bug the
 * single-source-of-truth rule exists to prevent.
 */
export function silhouettes(scene: SceneGraph, levelId: string): Silhouette[] {
  const out: Silhouette[] = []

  const fromBoxes = (id: string, boxes: ReturnType<typeof wallSolidBoxes>) => {
    const corners: Vec3[] = []
    const edges: Array<[number, number]> = []
    boxes.forEach((box, bi) => {
      const base = bi * 8
      corners.push(...boxCorners(box))
      edges.push(...BOX_EDGES.map(([a, b]) => [base + a, base + b] as [number, number]))
    })
    if (corners.length > 0) out.push({ id, corners, edges })
  }

  // A9: the same per-level join resolve the renderer and exporter do, so a mitred corner is
  // rubber-band-selectable at exactly the shape it is drawn at.
  const joins = resolveWallJoins(scene, levelId)
  for (const wall of scene.walls) {
    if (wall.levelId !== levelId) continue
    const resolved = resolveWall(scene, wall)
    if (!resolved) continue
    const openings = scene.openings.filter((o) => o.hostId === wall.id)
    fromBoxes(wall.id, wallSolidBoxes(resolved, openings, joins.get(wall.id)))
  }

  for (const column of scene.columns) {
    if (column.levelId !== levelId) continue
    const solid = columnSolid(scene, column)
    if (solid) fromBoxes(column.id, [solid])
  }

  for (const beam of scene.beams) {
    if (beam.levelId !== levelId) continue
    const solid = beamSolid(scene, beam)
    if (solid) fromBoxes(beam.id, [solid])
  }

  for (const slab of scene.slabs) {
    if (slab.levelId !== levelId) continue
    const resolved = resolveSlab(scene, slab)
    if (!resolved) continue
    const { corners, edges } = prismCornersAndEdges(
      resolved.boundary,
      resolved.topElevation - resolved.thickness,
      resolved.topElevation,
    )
    out.push({ id: slab.id, corners, edges })
  }

  for (const room of scene.rooms) {
    if (room.levelId !== levelId) continue
    const level = findLevel(scene, room.levelId)
    if (!level || room.polygon.length < 3) continue
    const base = level.elevation + room.baseOffset
    const { corners, edges } = prismCornersAndEdges(
      room.polygon,
      base,
      resolveTopElevation(scene, room.top, base),
    )
    out.push({ id: room.id, corners, edges })
  }

  for (const item of scene.furniture) {
    if (item.levelId !== levelId) continue
    const type = findType(scene, item.typeId)
    if (!type || type.category !== 'furniture') continue
    const level = findLevel(scene, item.levelId)
    if (!level) continue
    const [w, d] = type.footprint
    const base = level.elevation + item.heightOffset
    fromBoxes(item.id, [
      {
        center: [item.position[0], base + (type.heightMeters * item.scale) / 2, item.position[1]],
        size: [w * item.scale, type.heightMeters * item.scale, d * item.scale],
        rotationY: (-item.rotation * Math.PI) / 180,
      },
    ])
  }

  return out
}

/**
 * Ids selected by a screen box.
 *
 * Window: every projected corner inside the box. Crossing: any corner inside, or any edge that
 * crosses a side of the box (which catches an element larger than the box, spanning it).
 */
export function selectInBox(
  items: Silhouette[],
  box: ScreenBox,
  mode: BoxMode,
  project: Projector,
): string[] {
  const sides = boxEdges(box)
  const hits: string[] = []

  for (const item of items) {
    const screen = item.corners.map(project)

    if (mode === 'window') {
      if (screen.length > 0 && screen.every((p) => contains(box, p))) hits.push(item.id)
      continue
    }

    if (screen.some((p) => contains(box, p))) {
      hits.push(item.id)
      continue
    }
    const spans = item.edges.some(([a, b]) =>
      sides.some(([s0, s1]) => segmentIntersection(screen[a], screen[b], s0, s1) !== null),
    )
    if (spans) hits.push(item.id)
  }

  return hits
}
