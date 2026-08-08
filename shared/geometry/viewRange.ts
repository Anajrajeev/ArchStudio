/**
 * View range and plan regions (C7) — see DECISIONS.md D-029.
 *
 * Two jobs:
 *
 *  1. Turn a `ViewRange` into the horizontal clip planes a plan view needs. The viewport applies
 *     these per element GROUP rather than once for the whole level, which is what lets different
 *     sub-areas of one plan be cut at different heights.
 *  2. Decide which region (if any) each element belongs to, via one representative plan point.
 *
 * **The scoped rule, stated once here because everything else follows from it:** an element
 * belongs WHOLLY to the region containing its plan anchor. Nothing is split at a region boundary.
 * A wall running from the low-cut area into the high-cut area is cut at one height along its whole
 * length. Splitting would require clipping each element in its own local frame against an
 * arbitrary polygon — a CSG problem D-005 and D-019 both deliberately keep out of the wall path.
 * Region boundaries are drawn in plan so the rule is visible rather than a surprise.
 */

import {
  findLevel,
  type PlanRegion,
  type SceneGraph,
  type Vec2,
  type ViewRange,
} from '../types/scene'
import {
  baselineApex,
  baselineEnd,
  baselineStart,
  isSimplePolygon,
  lerp2,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
} from './index'

/**
 * A horizontal clip band, as absolute world-Y elevations. `top` is the lower of the cut plane and
 * the range's own top — the cut is what a plan view is FOR, and a range top above it would never
 * be reached.
 */
export interface ClipBand {
  top: number
  bottom: number
  /** Below `bottom`, down to here, geometry is drawn dimmed as "beyond". Equals `bottom` if none. */
  beyond: number
}

/** Resolve a range against the elevation of the level it belongs to. */
export function clipBandFor(levelElevation: number, range: ViewRange): ClipBand {
  const top = levelElevation + Math.min(range.cutHeight, range.topOffset)
  const bottom = levelElevation + range.bottomOffset
  return { top, bottom, beyond: bottom - Math.max(0, range.viewDepth) }
}

/**
 * One representative point per element, in scene 2D — what decides which plan region it falls in.
 *
 * Generalises `editor/selection.ts`'s `anchorPoints`, which covered only six kinds; every element
 * that can be drawn on a level needs an answer here, or it would silently fall outside every
 * region and always use the view's default range.
 */
export function planAnchor(scene: SceneGraph, id: string): Vec2 | null {
  const wall = scene.walls.find((w) => w.id === id)
  if (wall) {
    // The apex, not the chord midpoint: a strongly bowed wall's material is nowhere near its chord.
    return wall.baseline.kind === 'arc'
      ? baselineApex(wall.baseline)
      : lerp2(baselineStart(wall.baseline), baselineEnd(wall.baseline), 0.5)
  }
  const curtainWall = scene.curtainWalls.find((c) => c.id === id)
  if (curtainWall) {
    return lerp2(baselineStart(curtainWall.baseline), baselineEnd(curtainWall.baseline), 0.5)
  }
  const slab = scene.slabs.find((s) => s.id === id)
  if (slab) return polygonCentroid(slab.boundary)
  const ceiling = scene.ceilings.find((c) => c.id === id)
  if (ceiling) return polygonCentroid(ceiling.boundary)
  const room = scene.rooms.find((r) => r.id === id)
  if (room) return polygonCentroid(room.polygon)
  const roof = scene.roofs.find((r) => r.id === id)
  if (roof) return polygonCentroid(roof.footprint)
  const column = scene.columns.find((c) => c.id === id)
  if (column) return column.position
  const beam = scene.beams.find((b) => b.id === id)
  if (beam) return lerp2(beam.start, beam.end, 0.5)
  const furniture = scene.furniture.find((f) => f.id === id)
  if (furniture) return furniture.position
  const primitive = scene.primitives.find((p) => p.id === id)
  if (primitive) return primitive.position
  const stair = scene.stairs.find((s) => s.id === id)
  if (stair) return lerp2(stair.baseline.start, stair.baseline.end, 0.5)
  const railing = scene.railings.find((r) => r.id === id)
  if (railing) return polygonCentroid(railing.path)
  const grid = scene.columnGrids.find((g) => g.id === id)
  if (grid) return grid.origin
  const node = scene.booleans.find((b) => b.id === id)
  if (node) {
    // A boolean has no position of its own; use its first resolvable operand, the same way
    // `moveElement` treats the node as a handle on its leaves.
    for (const operandId of node.operandIds) {
      const p = planAnchor(scene, operandId)
      if (p) return p
    }
  }
  return null
}

/**
 * The region containing `point`, or null for "use the view's own range".
 *
 * Regions are tested in order and the FIRST containing one wins. Overlap is reported by
 * `validatePlanRegion` rather than silently resolved, because two regions claiming the same area
 * is an authoring mistake, not something with a right answer.
 */
export function regionAt(regions: readonly PlanRegion[], point: Vec2): PlanRegion | null {
  return regions.find((r) => pointInPolygon(point, r.boundary)) ?? null
}

/**
 * Group a level's element ids by which region governs them.
 *
 * The `null` key holds everything the view's own range covers. Returned as a Map so the caller
 * can render one clipped group per entry — no geometry is duplicated and no convexity constraint
 * applies, unlike clipping the base render to a region's complement.
 */
export function partitionByRegion(
  scene: SceneGraph,
  ids: readonly string[],
  regions: readonly PlanRegion[],
): Map<PlanRegion | null, string[]> {
  const out = new Map<PlanRegion | null, string[]>()
  const push = (key: PlanRegion | null, id: string) => {
    const list = out.get(key)
    if (list) list.push(id)
    else out.set(key, [id])
  }
  for (const id of ids) {
    const anchor = regions.length > 0 ? planAnchor(scene, id) : null
    push(anchor ? regionAt(regions, anchor) : null, id)
  }
  return out
}

/** Advisory messages, in the same register as every other `validateX` in this module. */
export function validatePlanRegion(scene: SceneGraph, region: PlanRegion): string[] {
  const out: string[] = []
  if (region.boundary.length < 3) {
    out.push('A plan region needs at least three boundary points.')
    return out
  }
  if (Math.abs(polygonArea(region.boundary)) < 1e-6) {
    out.push('This plan region encloses no area.')
  }
  if (!isSimplePolygon(region.boundary)) {
    out.push('This plan region’s boundary crosses itself.')
  }
  if (region.viewRange.topOffset <= region.viewRange.bottomOffset) {
    out.push('The top of this region’s view range is at or below its bottom, so nothing is drawn.')
  }

  const view = scene.views.find((v) => v.id === region.viewId)
  if (!view) {
    out.push('This plan region belongs to a view that no longer exists.')
    return out
  }
  const level = view.levelId ? findLevel(scene, view.levelId) : undefined
  if (level && region.viewRange.cutHeight > level.height) {
    out.push('This region’s cut plane is above the storey height, so nothing is cut.')
  }

  // Overlap is an authoring mistake with no right answer — `regionAt` takes the first match, and
  // saying so is better than letting the user wonder which one won.
  const others = scene.planRegions.filter((r) => r.viewId === region.viewId && r.id !== region.id)
  for (const other of others) {
    if (region.boundary.some((p) => pointInPolygon(p, other.boundary))) {
      out.push(`This region overlaps “${other.name}”; the first one listed takes precedence.`)
      break
    }
  }
  return out
}
