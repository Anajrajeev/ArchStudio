/**
 * Screen → world picking. Extracted from the interaction layer so the riskiest seam in the
 * 3D-native editor (a 2D pointer position becoming a scene-graph coordinate) is unit-testable
 * without a compositing canvas.
 */
import * as THREE from 'three'
import {
  intersectPlane,
  worldToScene2D,
  type Ray,
  type WorkPlane,
} from '../../../shared/geometry/workplane'
import type { Vec2, Vec3 } from '../../../shared/types/scene'

/** Build a world-space ray from normalized device coordinates (-1..1 on both axes). */
export function rayFromNDC(camera: THREE.Camera, ndc: THREE.Vector2): Ray {
  const rc = new THREE.Raycaster()
  rc.setFromCamera(ndc, camera)
  return {
    origin: [rc.ray.origin.x, rc.ray.origin.y, rc.ray.origin.z],
    direction: [rc.ray.direction.x, rc.ray.direction.y, rc.ray.direction.z],
  }
}

/** Convert a client pixel position within a rect to normalized device coordinates. */
export function ndcFromClient(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): THREE.Vector2 {
  return new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
}

/**
 * World units per screen pixel at a world point. Converting the snap aperture through this is what
 * makes snapping feel identical at every zoom level — a fixed world radius would feel sticky when
 * zoomed out and unreachable when zoomed in.
 */
export function worldPerPixel(
  camera: THREE.Camera,
  worldPoint: Vec3,
  viewportHeightPx: number,
): number {
  if (viewportHeightPx <= 0) return 0
  if (camera instanceof THREE.OrthographicCamera) {
    return (camera.top - camera.bottom) / camera.zoom / viewportHeightPx
  }
  if (camera instanceof THREE.PerspectiveCamera) {
    const dist = camera.position.distanceTo(
      new THREE.Vector3(worldPoint[0], worldPoint[1], worldPoint[2]),
    )
    return (2 * Math.tan((camera.fov * Math.PI) / 360) * dist) / viewportHeightPx
  }
  return 0
}

/**
 * World → canvas pixels. The inverse of `ndcFromClient` + `rayFromNDC`, used by box-select, which
 * has to compare element geometry against a screen rectangle.
 *
 * Returns a closure so the camera matrices and the rect are read once per gesture rather than once
 * per vertex — a rubber band over a full storey projects several thousand points per frame.
 */
export function projector(
  camera: THREE.Camera,
  rect: { left: number; top: number; width: number; height: number },
): (world: Vec3) => Vec2 {
  const v = new THREE.Vector3()
  camera.updateMatrixWorld()
  return (world: Vec3) => {
    v.set(world[0], world[1], world[2]).project(camera)
    return [((v.x + 1) / 2) * rect.width, ((1 - v.y) / 2) * rect.height]
  }
}

export interface PlanePick {
  world: Vec3
  /** Scene-graph 2D coordinates, or null when the plane is not horizontal. */
  scene2D: Vec2 | null
}

/** Resolve an NDC position against a work plane. Null when the ray misses the plane. */
export function pickWorkPlane(
  camera: THREE.Camera,
  ndc: THREE.Vector2,
  plane: WorkPlane,
): PlanePick | null {
  const world = intersectPlane(rayFromNDC(camera, ndc), plane)
  if (!world) return null
  return { world, scene2D: worldToScene2D(plane, world) }
}
