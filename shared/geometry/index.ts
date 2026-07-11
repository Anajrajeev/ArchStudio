/**
 * Shared, pure geometry utilities.
 * Used by: 2D editor, 3D viewport, exporters, and agent tools.
 * No side-effects; all functions are pure and unit-tested.
 */

import type { Vec2, Wall, Opening } from '../types/scene'

export interface WallGeometry {
  /** The four corner points of the wall centerline rectangle (XZ plane) */
  corners: [Vec2, Vec2, Vec2, Vec2]
  /** Wall length (distance from start to end) */
  length: number
  /** Normal vector perpendicular to the wall, pointing "outward" */
  normal: Vec2
}

/** Euclidean distance between two 2D points */
export function distance(a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  return Math.sqrt(dx * dx + dy * dy)
}

/** Unit direction vector from a to b */
export function direction(a: Vec2, b: Vec2): Vec2 {
  const len = distance(a, b)
  if (len < 1e-10) return [1, 0]
  return [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
}

/** Perpendicular (left-hand normal) of a 2D direction vector */
export function perpendicular(dir: Vec2): Vec2 {
  return [-dir[1], dir[0]]
}

/**
 * Compute the four corners of a wall's footprint in the XZ plane (Y = floor).
 * The half-thickness is applied symmetrically on both sides.
 */
export function wallFootprint(wall: Wall): [Vec2, Vec2, Vec2, Vec2] {
  const dir = direction(wall.start, wall.end)
  const perp = perpendicular(dir)
  const h = wall.thickness / 2

  const offset = (side: number): [number, number] => [perp[0] * h * side, perp[1] * h * side]

  const [ox1, oy1] = offset(1)
  const [ox2, oy2] = offset(-1)

  return [
    [wall.start[0] + ox1, wall.start[1] + oy1],
    [wall.end[0] + ox1, wall.end[1] + oy1],
    [wall.end[0] + ox2, wall.end[1] + oy2],
    [wall.start[0] + ox2, wall.start[1] + oy2],
  ]
}

/** Validate a wall — returns a list of error strings (empty = valid) */
export function validateWall(wall: Wall): string[] {
  const errors: string[] = []
  if (distance(wall.start, wall.end) < 1e-10) errors.push('Wall has zero length')
  if (wall.thickness <= 0) errors.push('Wall thickness must be positive')
  if (wall.height <= 0) errors.push('Wall height must be positive')
  return errors
}

/** Validate an opening on its wall — returns error strings */
export function validateOpening(opening: Opening, wall: Wall): string[] {
  const errors: string[] = []
  const wallLen = distance(wall.start, wall.end)
  if (opening.width <= 0) errors.push('Opening width must be positive')
  if (opening.height <= 0) errors.push('Opening height must be positive')
  if (opening.offset < 0) errors.push('Opening offset must be non-negative')
  if (opening.offset + opening.width > wallLen) {
    errors.push(`Opening extends beyond wall end (offset=${opening.offset}, width=${opening.width}, wallLen=${wallLen})`)
  }
  if (opening.sillHeight < 0) errors.push('Sill height must be non-negative')
  if (opening.sillHeight + opening.height > wall.height) {
    errors.push('Opening top exceeds wall height')
  }
  return errors
}

/** Check whether a polygon is self-intersecting using the Shamos-Hoey algorithm (simple check) */
export function isSimplePolygon(polygon: Vec2[]): boolean {
  const n = polygon.length
  if (n < 3) return false

  for (let i = 0; i < n; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % n]
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue // adjacent edges at wrap-around
      const c = polygon[j]
      const d = polygon[(j + 1) % n]
      if (segmentsIntersect(a, b, c, d)) return false
    }
  }
  return true
}

function cross2D(o: Vec2, a: Vec2, b: Vec2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross2D(c, d, a)
  const d2 = cross2D(c, d, b)
  const d3 = cross2D(a, b, c)
  const d4 = cross2D(a, b, d)

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true
  }
  return false
}

/** Signed area of a polygon (positive = counter-clockwise) */
export function polygonArea(polygon: Vec2[]): number {
  let area = 0
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const [x1, y1] = polygon[i]
    const [x2, y2] = polygon[(i + 1) % n]
    area += x1 * y2 - x2 * y1
  }
  return area / 2
}

/** Validate a room polygon */
export function validateRoomPolygon(polygon: Vec2[]): string[] {
  const errors: string[] = []
  if (polygon.length < 3) {
    errors.push('Room polygon must have at least 3 vertices')
    return errors
  }
  if (!isSimplePolygon(polygon)) {
    errors.push('Room polygon is self-intersecting')
  }
  if (Math.abs(polygonArea(polygon)) < 1e-6) {
    errors.push('Room polygon has zero area')
  }
  return errors
}
