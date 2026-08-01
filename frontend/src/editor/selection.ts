/**
 * Selection-level derived values — the things a command needs to know about "what is selected"
 * without caring what each element is.
 *
 * Pure, so the transform verbs and (Phase 3) the agent tools can share them.
 */
import type { SceneGraph, Vec2 } from '../../../shared/types/scene'
import { baselineApex, baselineEnd, baselineStart } from '../../../shared/geometry/index'
import { findElement } from '../scene/mutations'

/**
 * The points that define an element's position, for centroid and extent purposes. An opening or
 * filling contributes nothing — it has no independent position, only an offset along its host.
 */
export function anchorPoints(scene: SceneGraph, id: string): Vec2[] {
  const el = findElement(scene, id)
  if (!el) return []

  switch (el.kind) {
    case 'wall': {
      const w = scene.walls.find((x) => x.id === id)!
      // The apex is included so a curved wall's centroid reflects the way it actually bows.
      return [baselineStart(w.baseline), baselineEnd(w.baseline), baselineApex(w.baseline)]
    }
    case 'slab':
      return scene.slabs.find((x) => x.id === id)!.boundary
    case 'room':
      return scene.rooms.find((x) => x.id === id)!.polygon
    case 'column':
      return [scene.columns.find((x) => x.id === id)!.position]
    case 'beam': {
      const b = scene.beams.find((x) => x.id === id)!
      return [b.start, b.end]
    }
    case 'furniture':
      return [scene.furniture.find((x) => x.id === id)!.position]
    default:
      return []
  }
}

/**
 * Centroid of the selection's anchor points, or null when the selection has no positioned element.
 *
 * This is the default centre for rotate and radial array, because "rotate this" almost always means
 * "about its own middle" — but it stays an editable field for when it doesn't.
 */
export function selectionCentroid(scene: SceneGraph, ids: string[]): Vec2 | null {
  const points = ids.flatMap((id) => anchorPoints(scene, id))
  if (points.length === 0) return null
  const sum = points.reduce<Vec2>((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0])
  return [sum[0] / points.length, sum[1] / points.length]
}

/** Axis-aligned bounds of the selection in scene 2D, or null when nothing is positioned. */
export function selectionBounds(
  scene: SceneGraph,
  ids: string[],
): { min: Vec2; max: Vec2 } | null {
  const points = ids.flatMap((id) => anchorPoints(scene, id))
  if (points.length === 0) return null
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return {
    min: [Math.min(...xs), Math.min(...ys)],
    max: [Math.max(...xs), Math.max(...ys)],
  }
}
