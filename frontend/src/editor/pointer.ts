/**
 * Pointer resolution: a screen position becomes a constrained, snapped scene-2D point.
 *
 * This is deliberately a PURE function of (camera, screen position, editor state). The wiring in
 * `viewport/Interaction.tsx` does nothing but feed it DOM events and apply the result, so the
 * interesting logic — constraint precedence, snapping interplay, the freeze rule — is testable
 * without a WebGL context. The bugs that reached the user in Phase 1A were all in seams that had
 * no test because they were tangled up with r3f.
 *
 * Precedence, highest first:
 *   1. A hard axis lock.
 *   2. A committed numeric constraint (typed length and/or angle).
 *   3. Snapping, which only refines a point that is not already fully constrained.
 */
import type * as THREE from 'three'
import {
  resolveSnap,
  applyAxisLock,
  constrainToLength,
  fromPolar,
  type SnapResult,
  type SnapToggles,
  type AxisLock,
} from '../../../shared/geometry/snapping'
import { planeElevation, type WorkPlane } from '../../../shared/geometry/workplane'
import type { SceneGraph, Vec2, Vec3 } from '../../../shared/types/scene'
import { ndcFromClient, pickWorkPlane, worldPerPixel } from '../viewport/pick'

/** Pixel aperture for snapping, converted to world units at the cursor's depth. */
export const SNAP_APERTURE_PX = 14
/** Pixel reach for clicking a wall with the door/window tools. */
export const WALL_HIT_PX = 12

export interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

/** The slice of editor state pointer resolution depends on. */
export interface PointerContext {
  scene: SceneGraph
  activeLevelId: string
  workPlane: WorkPlane
  /** Points already collected by the in-progress operation. */
  points: Vec2[]
  axisLock: AxisLock
  numeric: { lockedLength: number | null; lockedAngle: number | null }
  snapToggles: SnapToggles
  gridSize: number
  showGrid: boolean
  /** Previous frame's snap, for hysteresis. */
  previousSnap: SnapResult | null
}

export interface PointerResolution {
  /** The final constrained + snapped point, in scene 2D. */
  point: Vec2
  snap: SnapResult
  /** World position of `point` on the active work plane. */
  world: Vec3
  /** World units per screen pixel at the cursor — the aperture basis. */
  worldPerPixel: number
}

/**
 * Resolve a client pointer position against the active work plane.
 * Returns null when the ray misses the plane (e.g. an edge-on camera).
 */
export function resolvePointer(
  camera: THREE.Camera,
  clientX: number,
  clientY: number,
  rect: ScreenRect,
  ctx: PointerContext,
): PointerResolution | null {
  const ndc = ndcFromClient(clientX, clientY, rect)
  const pick = pickWorkPlane(camera, ndc, ctx.workPlane)
  // A non-horizontal plane has no scene-2D mapping; refuse rather than write a wrong coordinate.
  if (!pick?.scene2D) return null

  const perPixel = worldPerPixel(camera, pick.world, rect.height)
  const aperture = perPixel * SNAP_APERTURE_PX

  const from = ctx.points.length > 0 ? ctx.points[ctx.points.length - 1] : undefined
  let raw: Vec2 = pick.scene2D

  // 1. Axis lock.
  if (from && ctx.axisLock !== 'none') raw = applyAxisLock(raw, from, ctx.axisLock)

  // 2. Numeric constraints. Length + angle together fully determine the point.
  const { lockedLength, lockedAngle } = ctx.numeric
  if (from && lockedLength !== null && lockedAngle !== null) {
    raw = fromPolar(from, lockedLength, lockedAngle)
  } else if (from && lockedLength !== null) {
    raw = constrainToLength(raw, from, lockedLength)
  } else if (from && lockedAngle !== null) {
    const radius = Math.max(1e-4, Math.hypot(raw[0] - from[0], raw[1] - from[1]))
    raw = fromPolar(from, radius, lockedAngle)
  }

  // 3. Snapping — but a fully-constrained point must not be dragged off its constraint.
  const fullyConstrained = lockedLength !== null || ctx.axisLock !== 'none'
  const snap: SnapResult = fullyConstrained
    ? { point: raw, type: null, label: null, snapped: false }
    : resolveSnap(raw, {
        scene: ctx.scene,
        levelId: ctx.activeLevelId,
        aperture,
        gridSize: ctx.showGrid ? ctx.gridSize : 0,
        toggles: ctx.snapToggles,
        fromPoint: from,
        previous: ctx.previousSnap,
        extraPoints: ctx.points,
      })

  return {
    point: snap.point,
    snap,
    world: [snap.point[0], planeElevation(ctx.workPlane), snap.point[1]],
    worldPerPixel: perPixel,
  }
}
