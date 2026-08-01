/**
 * Roof geometry (B1) — rectangular footprints only, one slope angle shared by all four edges.
 *
 * See DECISIONS.md D-018 for why: a general per-edge-angle roof over an arbitrary footprint is a
 * weighted straight-skeleton problem (event-driven sweep with edge-collapse events), which is a
 * substantial piece of computational geometry on its own. A rectangle with a uniform angle reduces
 * to elementary axis-aligned offset math with a closed-form hip/gable/pyramid result, which this
 * module implements exactly and refuses to guess outside of.
 *
 * `Roof.edges[]` still stores one entry per footprint edge (matching the eventual general shape),
 * but this module requires them to all agree and reads only `edges[0].angle`.
 */
import type { Roof, Vec2, Vec3 } from '../types/scene'
import { polygonArea } from './index'

const EPS = 1e-6

// ---------------------------------------------------------------------------
// Rectangle detection
// ---------------------------------------------------------------------------

export interface RectangleFrame {
  /** One corner, chosen as the local origin. */
  origin: Vec2
  /** Unit vector along the rectangle's "width" edge. */
  uAxis: Vec2
  /** Unit vector along the rectangle's "length" edge (perpendicular to uAxis). */
  vAxis: Vec2
  width: number
  length: number
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]]
}
function len(v: Vec2): number {
  return Math.hypot(v[0], v[1])
}
function norm(v: Vec2): Vec2 {
  const l = len(v)
  return l < EPS ? [0, 0] : [v[0] / l, v[1] / l]
}
function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1]
}

/**
 * Detect whether a 4-point closed footprint is a rectangle (opposite sides equal and parallel,
 * adjacent sides perpendicular), regardless of the polygon's rotation in the scene. Returns the
 * local frame if so, null otherwise — callers refuse rather than guess at a hip roof for a shape
 * that is not actually rectangular.
 */
export function rectangleFrame(footprint: Vec2[]): RectangleFrame | null {
  if (footprint.length !== 4) return null

  const edges: Vec2[] = footprint.map((p, i) => sub(footprint[(i + 1) % 4], p))
  const lengths = edges.map(len)
  if (lengths.some((l) => l < EPS)) return null

  // Opposite edges must be equal length.
  if (Math.abs(lengths[0] - lengths[2]) > 1e-4) return null
  if (Math.abs(lengths[1] - lengths[3]) > 1e-4) return null

  // Every corner must be a right angle.
  for (let i = 0; i < 4; i++) {
    const a = norm(edges[(i + 3) % 4])
    const b = norm(edges[i])
    if (Math.abs(dot(a, b)) > 1e-3) return null
  }

  const uAxis = norm(edges[0])
  const vAxis = norm(edges[1])
  return {
    origin: footprint[0],
    uAxis,
    vAxis,
    width: lengths[0],
    length: lengths[1],
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface RoofError {
  error: string
}

export function isRoofError(x: unknown): x is RoofError {
  return typeof x === 'object' && x !== null && 'error' in x
}

/** Confirm every edge shares the same angle, in (0, 90). Returns that angle or an error. */
function uniformAngle(roof: Roof): number | RoofError {
  if (roof.edges.length !== roof.footprint.length) {
    return { error: 'Roof must have one edge spec per footprint edge' }
  }
  const angle = roof.edges[0]?.angle
  if (angle === undefined || !Number.isFinite(angle) || angle <= 0 || angle >= 90) {
    return { error: 'Roof slope angle must be between 0 and 90 degrees' }
  }
  for (const e of roof.edges) {
    if (Math.abs(e.angle - angle) > 1e-6) {
      return {
        error: 'This roof shape needs matching slope angles on every edge — differing per-edge angles are not supported yet',
      }
    }
  }
  return angle
}

// ---------------------------------------------------------------------------
// Hip / gable / pyramid geometry
// ---------------------------------------------------------------------------

export interface RoofFace {
  /** World-space (scene 2D + height) polygon, 3 or 4 vertices, planar and convex. */
  vertices: Vec3[]
}

export interface ResolvedRoof {
  faces: RoofFace[]
  ridgeHeight: number
  /** Ridge endpoints in world space, or null for a pyramid (point apex). */
  ridge: [Vec3, Vec3] | null
}

function toWorld(frame: RectangleFrame, u: number, v: number, h: number): Vec3 {
  const x = frame.origin[0] + frame.uAxis[0] * u + frame.vAxis[0] * v
  const y = frame.origin[1] + frame.uAxis[1] * u + frame.vAxis[1] * v
  return [x, h, y]
}

/**
 * Resolve a roof to renderable faces. Refuses (returns `RoofError`) unless the footprint is a
 * rectangle and every edge shares one slope angle — see D-018.
 */
export function resolveRoof(roof: Roof): ResolvedRoof | RoofError {
  if (polygonArea(roof.footprint) === 0) return { error: 'Roof footprint has zero area' }
  const frame = rectangleFrame(roof.footprint)
  if (!frame) return { error: 'Roof footprint must be a rectangle' }

  const angleResult = uniformAngle(roof)
  if (isRoofError(angleResult)) return angleResult
  const angle = angleResult

  const overhang = roof.edges[0].overhang
  if (!Number.isFinite(overhang) || overhang < 0) return { error: 'Roof overhang must be >= 0' }

  const tanA = Math.tan((angle * Math.PI) / 180)

  // Eave rectangle, extended outward by the overhang on all four sides.
  const w = frame.width + 2 * overhang
  const l = frame.length + 2 * overhang
  const short = Math.min(w, l)
  // Rise above the EAVE (not the wall line): the roof is one continuous inclined plane per
  // side, so the overhang portion is just that same plane extended past the wall, ending lower
  // than the wall-top by `overhang * tanA`. Every eave corner sits at this one level height,
  // exactly like a real hip roof's eave line — the overhang is identical on all four sides.
  const rise = (short / 2) * tanA
  const eaveHeight = roof.baseHeight - overhang * tanA

  // Local eave rectangle corners, offset by -overhang so the original wall-line footprint sits
  // inset from the eave by `overhang` on both axes.
  const u0 = -overhang
  const u1 = frame.width + overhang
  const v0 = -overhang
  const v1 = frame.length + overhang

  const base = eaveHeight
  const halfShort = short / 2
  const faces: RoofFace[] = []
  let ridge: [Vec3, Vec3] | null = null

  if (w <= l) {
    // Ridge runs along v (the length direction), centred in u, at u = uMid, spanning v from
    // (v0 + halfShort) to (v1 - halfShort).
    const uMid = (u0 + u1) / 2
    const vA = v0 + halfShort
    const vB = v1 - halfShort
    if (vB - vA > EPS) {
      ridge = [toWorld(frame, uMid, vA, base + rise), toWorld(frame, uMid, vB, base + rise)]
      // Two long trapezoid faces (the main slopes).
      faces.push({
        vertices: [
          toWorld(frame, u0, vA, base),
          toWorld(frame, u0, vB, base),
          toWorld(frame, uMid, vB, base + rise),
          toWorld(frame, uMid, vA, base + rise),
        ],
      })
      faces.push({
        vertices: [
          toWorld(frame, u1, vA, base),
          toWorld(frame, uMid, vA, base + rise),
          toWorld(frame, uMid, vB, base + rise),
          toWorld(frame, u1, vB, base),
        ],
      })
      // Two hip-end triangles.
      faces.push({
        vertices: [
          toWorld(frame, u0, vA, base),
          toWorld(frame, uMid, vA, base + rise),
          toWorld(frame, u1, vA, base),
        ],
      })
      faces.push({
        vertices: [
          toWorld(frame, u0, vB, base),
          toWorld(frame, u1, vB, base),
          toWorld(frame, uMid, vB, base + rise),
        ],
      })
    } else {
      // Square (or w == l): pyramid apex at the centre.
      const uMidP = (u0 + u1) / 2
      const vMidP = (v0 + v1) / 2
      const apex = toWorld(frame, uMidP, vMidP, base + rise)
      const corners: Vec3[] = [
        toWorld(frame, u0, v0, base),
        toWorld(frame, u1, v0, base),
        toWorld(frame, u1, v1, base),
        toWorld(frame, u0, v1, base),
      ]
      for (let i = 0; i < 4; i++) {
        faces.push({ vertices: [corners[i], corners[(i + 1) % 4], apex] })
      }
      ridge = null
    }
  } else {
    // l < w: ridge runs along u, centred in v. Mirror of the above with axes swapped.
    const vMid = (v0 + v1) / 2
    const uA = u0 + halfShort
    const uB = u1 - halfShort
    if (uB - uA > EPS) {
      ridge = [toWorld(frame, uA, vMid, base + rise), toWorld(frame, uB, vMid, base + rise)]
      faces.push({
        vertices: [
          toWorld(frame, uA, v0, base),
          toWorld(frame, uB, v0, base),
          toWorld(frame, uB, vMid, base + rise),
          toWorld(frame, uA, vMid, base + rise),
        ],
      })
      faces.push({
        vertices: [
          toWorld(frame, uA, v1, base),
          toWorld(frame, uA, vMid, base + rise),
          toWorld(frame, uB, vMid, base + rise),
          toWorld(frame, uB, v1, base),
        ],
      })
      faces.push({
        vertices: [
          toWorld(frame, uA, v0, base),
          toWorld(frame, uA, vMid, base + rise),
          toWorld(frame, uA, v1, base),
        ],
      })
      faces.push({
        vertices: [
          toWorld(frame, uB, v0, base),
          toWorld(frame, uB, v1, base),
          toWorld(frame, uB, vMid, base + rise),
        ],
      })
    } else {
      const uMidP = (u0 + u1) / 2
      const vMidP = (v0 + v1) / 2
      const apex = toWorld(frame, uMidP, vMidP, base + rise)
      const corners: Vec3[] = [
        toWorld(frame, u0, v0, base),
        toWorld(frame, u1, v0, base),
        toWorld(frame, u1, v1, base),
        toWorld(frame, u0, v1, base),
      ]
      for (let i = 0; i < 4; i++) {
        faces.push({ vertices: [corners[i], corners[(i + 1) % 4], apex] })
      }
      ridge = null
    }
  }

  return { faces, ridgeHeight: base + rise, ridge }
}

/** A sane default roof over a rectangle: 30 degrees, 0.3m overhang, sitting at the wall top. */
export function defaultRoof(
  id: string,
  typeId: string,
  levelId: string,
  footprint: Vec2[],
  baseHeight: number,
): Roof {
  return {
    id,
    typeId,
    levelId,
    footprint,
    edges: footprint.map(() => ({ angle: 30, overhang: 0.3 })),
    baseHeight,
  }
}
