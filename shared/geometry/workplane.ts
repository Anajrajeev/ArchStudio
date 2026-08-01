/**
 * Work planes — the primitive that makes drawing directly in 3D possible.
 *
 * Every 2D screen pick resolves to 3D through an explicit active plane. The plane governs the
 * construction grid, axis locks, and the mapping between world space and the 2D coordinates the
 * scene graph stores. Modelled on AutoCAD's UCS (and its Dynamic UCS hover-to-reorient) and
 * FreeCAD's Draft working plane. See DECISIONS.md D-011.
 *
 * Pure math — no three.js. The viewport supplies rays; this module does the intersection.
 */

import type { Vec2, Vec3 } from '../types/scene'

/** Where the active plane came from. Drives the status-bar badge and revert behaviour. */
export type WorkPlaneSource =
  | { kind: 'level'; levelId: string; levelName: string }
  | { kind: 'face'; elementId: string; description: string }
  | { kind: 'custom'; description: string }

export interface WorkPlane {
  origin: Vec3
  /** Unit normal. */
  normal: Vec3
  /** Unit in-plane X axis; the in-plane Y axis is normal × xAxis. */
  xAxis: Vec3
  source: WorkPlaneSource
}

// ---------------------------------------------------------------------------
// Vec3 helpers
// ---------------------------------------------------------------------------

export function v3sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
export function v3add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
export function v3scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k]
}
export function v3dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
export function v3cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
export function v3length(a: Vec3): number {
  return Math.sqrt(v3dot(a, a))
}
export function v3normalize(a: Vec3): Vec3 {
  const l = v3length(a)
  return l < 1e-12 ? [0, 1, 0] : [a[0] / l, a[1] / l, a[2] / l]
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * The horizontal plane of a level. This is the default plane and the fallback when a ray
 * hits nothing — scene 2D [x,y] maps to world [x, elevation, y], so the in-plane axes are
 * world X and world Z (D-007).
 */
export function levelWorkPlane(levelId: string, levelName: string, elevation: number): WorkPlane {
  return {
    origin: [0, elevation, 0],
    normal: [0, 1, 0],
    xAxis: [1, 0, 0],
    source: { kind: 'level', levelId, levelName },
  }
}

/**
 * A plane aligned to a picked face — the Dynamic UCS case. `hint` biases the in-plane X axis so
 * the grid stays visually stable (we prefer an axis close to world horizontal).
 */
export function faceWorkPlane(
  origin: Vec3,
  normal: Vec3,
  elementId: string,
  description: string,
): WorkPlane {
  const n = v3normalize(normal)
  // Pick an in-plane X axis: prefer world X, unless the normal is nearly parallel to it.
  const seed: Vec3 = Math.abs(v3dot(n, [1, 0, 0])) > 0.9 ? [0, 0, 1] : [1, 0, 0]
  const y = v3normalize(v3cross(n, seed))
  const xAxis = v3normalize(v3cross(y, n))
  return { origin, normal: n, xAxis, source: { kind: 'face', elementId, description } }
}

/** Move a plane's origin without changing its orientation. */
export function movePlaneOrigin(plane: WorkPlane, origin: Vec3): WorkPlane {
  return { ...plane, origin }
}

/** Offset a plane along its own normal. */
export function offsetPlane(plane: WorkPlane, d: number): WorkPlane {
  return { ...plane, origin: v3add(plane.origin, v3scale(plane.normal, d)) }
}

// ---------------------------------------------------------------------------
// Ray intersection & coordinate mapping
// ---------------------------------------------------------------------------

export interface Ray {
  origin: Vec3
  /** Need not be normalized. */
  direction: Vec3
}

/** Intersect a ray with a work plane. Null when parallel or behind the ray origin. */
export function intersectPlane(ray: Ray, plane: WorkPlane): Vec3 | null {
  const denom = v3dot(plane.normal, ray.direction)
  if (Math.abs(denom) < 1e-9) return null
  const t = v3dot(plane.normal, v3sub(plane.origin, ray.origin)) / denom
  if (t < 0) return null
  return v3add(ray.origin, v3scale(ray.direction, t))
}

/** In-plane Y axis (completes a right-handed frame with normal and xAxis). */
export function planeYAxis(plane: WorkPlane): Vec3 {
  return v3normalize(v3cross(plane.normal, plane.xAxis))
}

/** World point → the plane's local 2D coordinates. */
export function worldToPlane(plane: WorkPlane, world: Vec3): Vec2 {
  const rel = v3sub(world, plane.origin)
  return [v3dot(rel, plane.xAxis), v3dot(rel, planeYAxis(plane))]
}

/** The plane's local 2D coordinates → a world point. */
export function planeToWorld(plane: WorkPlane, local: Vec2): Vec3 {
  const y = planeYAxis(plane)
  return v3add(
    plane.origin,
    v3add(v3scale(plane.xAxis, local[0]), v3scale(y, local[1])),
  )
}

/** True when the plane is horizontal (a level plane), i.e. its normal is world up. */
export function isHorizontal(plane: WorkPlane): boolean {
  return Math.abs(Math.abs(v3dot(v3normalize(plane.normal), [0, 1, 0])) - 1) < 1e-6
}

/**
 * Map a world point to the **scene graph's** 2D coordinates. On a horizontal plane this is
 * simply [x, z] (D-007). On a vertical face plane there is no meaningful scene-2D position, so
 * callers must handle null rather than silently writing a wrong coordinate.
 */
export function worldToScene2D(plane: WorkPlane, world: Vec3): Vec2 | null {
  if (!isHorizontal(plane)) return null
  return [world[0], world[2]]
}

/** Scene 2D + elevation → world. */
export function scene2DToWorld(p: Vec2, elevation: number): Vec3 {
  return [p[0], elevation, p[1]]
}

/** A plane's elevation, when horizontal. */
export function planeElevation(plane: WorkPlane): number {
  return plane.origin[1]
}

// ---------------------------------------------------------------------------
// Plane history (Previous / Next), as FreeCAD provides
// ---------------------------------------------------------------------------

export interface PlaneHistory {
  past: WorkPlane[]
  future: WorkPlane[]
}

export const emptyPlaneHistory: PlaneHistory = { past: [], future: [] }

export function pushPlane(
  history: PlaneHistory,
  current: WorkPlane,
): PlaneHistory {
  return { past: [...history.past, current].slice(-20), future: [] }
}

export function previousPlane(
  history: PlaneHistory,
  current: WorkPlane,
): { plane: WorkPlane; history: PlaneHistory } | null {
  if (history.past.length === 0) return null
  const plane = history.past[history.past.length - 1]
  return {
    plane,
    history: { past: history.past.slice(0, -1), future: [current, ...history.future].slice(0, 20) },
  }
}

export function nextPlane(
  history: PlaneHistory,
  current: WorkPlane,
): { plane: WorkPlane; history: PlaneHistory } | null {
  if (history.future.length === 0) return null
  const plane = history.future[0]
  return {
    plane,
    history: { past: [...history.past, current].slice(-20), future: history.future.slice(1) },
  }
}

/** Short label for the status-bar plane badge — "which plane am I drawing on?" */
export function planeBadge(plane: WorkPlane): string {
  const src = plane.source
  if (src.kind === 'level') {
    const e = planeElevation(plane)
    return `${src.levelName} @ ${e >= 0 ? '+' : ''}${e.toFixed(3)}`
  }
  if (src.kind === 'face') return src.description
  return src.description
}
