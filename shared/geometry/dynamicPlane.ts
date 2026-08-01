/**
 * Dynamic UCS — deriving a work plane from an element the cursor is over.
 *
 * This is the geometry half of AutoCAD's Dynamic UCS (and Revit's "set work plane to face"):
 * hover the top of a wall and the plane you draw on jumps to that wall's top face, so the next
 * wall starts where the last one ended vertically. See PHASE1B-SCOPE.md A2/A3 and DECISIONS.md
 * D-011.
 *
 * Scope, deliberately: only **horizontal top faces** produce a plane. A vertical face has no
 * scene-graph 2D mapping (`worldToScene2D` returns null for it by design, D-007), so re-planing
 * onto one would put the pointer layer into a state where every pick is refused. Vertical
 * construction planes need a 2D-in-plane coordinate system for the whole element vocabulary and
 * are out of Phase 1B scope.
 *
 * Pure: no three.js, no store. The interaction layer supplies the hovered element id.
 */

import type { SceneGraph } from '../types/scene'
import { resolveWall, resolveSlab, columnSolid, beamSolid } from './index'
import { faceWorkPlane, type WorkPlane } from './workplane'

/** A horizontal face that can host a work plane. */
export interface TopFace {
  elementId: string
  /** World elevation of the face. */
  elevation: number
  /** Human-readable label for the status-bar plane badge. */
  description: string
}

function label(kind: string, elevation: number): string {
  return `Top of ${kind} @ ${elevation >= 0 ? '+' : ''}${elevation.toFixed(3)}`
}

/**
 * The top face of an element, or null when the element has no usable horizontal top —
 * unknown ids, rooms (a volume, not a solid), and furniture (placeholder boxes until Phase 5).
 *
 * Doors and windows resolve to their **host wall's** top, which is what the user means when they
 * hover a wall that happens to have a window in it.
 */
export function elementTopFace(scene: SceneGraph, elementId: string): TopFace | null {
  const wall = scene.walls.find((w) => w.id === elementId)
  if (wall) {
    const r = resolveWall(scene, wall)
    if (!r) return null
    return { elementId, elevation: r.topElevation, description: label('wall', r.topElevation) }
  }

  const slab = scene.slabs.find((s) => s.id === elementId)
  if (slab) {
    const r = resolveSlab(scene, slab)
    if (!r) return null
    return { elementId, elevation: r.topElevation, description: label('slab', r.topElevation) }
  }

  const column = scene.columns.find((c) => c.id === elementId)
  if (column) {
    const solid = columnSolid(scene, column)
    if (!solid) return null
    const top = solid.center[1] + solid.size[1] / 2
    return { elementId, elevation: top, description: label('column', top) }
  }

  const beam = scene.beams.find((b) => b.id === elementId)
  if (beam) {
    const solid = beamSolid(scene, beam)
    if (!solid) return null
    const top = solid.center[1] + solid.size[1] / 2
    return { elementId, elevation: top, description: label('beam', top) }
  }

  // A door or window stands in for the wall that hosts it.
  const filling = scene.fillings.find((f) => f.id === elementId)
  if (filling) {
    const opening = scene.openings.find((o) => o.id === filling.openingId)
    if (!opening) return null
    return elementTopFace(scene, opening.hostId)
  }

  return null
}

/**
 * The work plane for an element's top face. Horizontal, so scene-2D picking keeps working; the
 * origin carries the elevation, which is all `planeElevation` reads.
 */
export function elementTopPlane(scene: SceneGraph, elementId: string): WorkPlane | null {
  const face = elementTopFace(scene, elementId)
  if (!face) return null
  return faceWorkPlane([0, face.elevation, 0], [0, 1, 0], face.elementId, face.description)
}

/**
 * Whether re-planing onto `plane` from `currentElevation` is worth doing. Hovering a wall whose
 * top is the plane you are already on must not churn the badge, and sub-millimetre differences are
 * noise rather than intent.
 */
export function isDistinctPlane(plane: WorkPlane, currentElevation: number): boolean {
  return Math.abs(plane.origin[1] - currentElevation) > 1e-4
}
