/**
 * Railing geometry (B3) — a continuous top rail plus evenly spaced vertical posts along an open
 * polyline path.
 *
 * The path itself needs no "refuse the general case" treatment the way a roof or a voided wall
 * does: every segment is straight, so a bent railing (wrapping a stair, a balcony corner) is just
 * one box per segment for the rail, with no curve-fitting or approximation involved.
 */
import type { Box3D } from './index'
import { distance, direction, lerp2, rotationYFor } from './index'
import {
  findLevel,
  findRailingType,
  type Railing,
  type SceneGraph,
  type Vec2,
} from '../types/scene'

export interface ResolvedRailing {
  id: string
  baseElevation: number
  height: number
  postThickness: number
  postSpacing: number
  material: string
  path: Vec2[]
  totalLength: number
}

function pathLength(path: Vec2[]): number {
  let total = 0
  for (let i = 0; i < path.length - 1; i++) total += distance(path[i], path[i + 1])
  return total
}

/** Point at distance `s` along an open polyline path, clamped to [0, length]. */
function pointAlongPath(path: Vec2[], s: number): Vec2 {
  let remaining = Math.max(0, s)
  for (let i = 0; i < path.length - 1; i++) {
    const segLen = distance(path[i], path[i + 1])
    if (remaining <= segLen || i === path.length - 2) {
      const t = segLen < 1e-9 ? 0 : Math.min(1, remaining / segLen)
      return lerp2(path[i], path[i + 1], t)
    }
    remaining -= segLen
  }
  return path[0]
}

export function resolveRailing(scene: SceneGraph, railing: Railing): ResolvedRailing | null {
  const type = findRailingType(scene, railing.typeId)
  const level = findLevel(scene, railing.levelId)
  if (!type || !level || railing.path.length < 2) return null

  return {
    id: railing.id,
    baseElevation: level.elevation + railing.baseOffset,
    height: type.height,
    postThickness: type.postThickness,
    postSpacing: type.postSpacing,
    material: type.material,
    path: railing.path,
    totalLength: pathLength(railing.path),
  }
}

/**
 * Rail (one box per path segment, at the top) plus posts (one every `postSpacing`, ALWAYS
 * including one exactly at the path's end so the rail's last stretch is never unsupported).
 */
export function railingSolidBoxes(r: ResolvedRailing): Box3D[] {
  const boxes: Box3D[] = []
  if (r.totalLength < 1e-9 || r.height <= 1e-9 || r.postThickness <= 1e-9) return boxes

  for (let i = 0; i < r.path.length - 1; i++) {
    const a = r.path[i]
    const b = r.path[i + 1]
    const len = distance(a, b)
    if (len < 1e-9) continue
    const mid = lerp2(a, b, 0.5)
    boxes.push({
      center: [mid[0], r.baseElevation + r.height - r.postThickness / 2, mid[1]],
      size: [len, r.postThickness, r.postThickness],
      rotationY: rotationYFor(direction(a, b)),
    })
  }

  // A spacing near zero would make this loop run forever; clamp to a sane minimum.
  const spacing = Math.max(r.postSpacing, 0.05)
  const positions: number[] = []
  for (let s = 0; s < r.totalLength; s += spacing) positions.push(s)
  positions.push(r.totalLength)

  for (const s of positions) {
    const point = pointAlongPath(r.path, s)
    boxes.push({
      center: [point[0], r.baseElevation + r.height / 2, point[1]],
      size: [r.postThickness, r.height, r.postThickness],
      rotationY: 0,
    })
  }
  return boxes
}

export function validateRailing(scene: SceneGraph, railing: Railing): string[] {
  const errors: string[] = []
  if (!findRailingType(scene, railing.typeId)) errors.push(`Unknown railing type "${railing.typeId}"`)
  if (!findLevel(scene, railing.levelId)) errors.push(`Unknown level "${railing.levelId}"`)
  if (railing.path.length < 2) errors.push('Railing needs at least 2 points')
  return errors
}

export function defaultRailing(id: string, typeId: string, levelId: string, path: Vec2[]): Railing {
  return { id, typeId, levelId, path, baseOffset: 0 }
}
