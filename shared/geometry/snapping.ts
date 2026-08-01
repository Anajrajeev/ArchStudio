/**
 * The snap engine. Candidates are generated **analytically from the scene graph**, never from
 * meshes — every wall's endpoints, midpoints, centreline and intersections are exact.
 *
 * Two things make snapping feel professional rather than twitchy, and both are implemented here:
 *  - a strict **priority ladder**, so a vertex always beats a grid line at equal distance;
 *  - **hysteresis**, so the current winner keeps winning until the cursor moves meaningfully away.
 *
 * Pure module: no DOM, no three.js. The aperture arrives in world units, converted from a pixel
 * radius by the caller at the cursor's depth, so snapping feels identical at every zoom.
 */

import {
  distance,
  direction,
  perpendicular,
  lerp2,
  projectPointToSegment,
  segmentIntersection,
  baselinePolyline,
  baselineLength,
  baselinePointAt,
  resolveWall,
  arcInfo,
} from './index'
import type { Vec2, SceneGraph } from '../types/scene'

/** Ordered by priority — earlier wins ties. Mirrors AutoCAD/Revit's running-snap set. */
export const SNAP_TYPES = [
  'endpoint',
  'intersection',
  'midpoint',
  'center',
  'perpendicular',
  'quadrant',
  'edge',
  'extension',
  'grid',
  'axis',
] as const

export type SnapType = (typeof SNAP_TYPES)[number]

const PRIORITY: Record<SnapType, number> = {
  endpoint: 0,
  intersection: 1,
  midpoint: 2,
  center: 3,
  perpendicular: 4,
  quadrant: 5,
  edge: 6,
  extension: 7,
  grid: 8,
  axis: 9,
}

/** Human-readable name shown in the snap tooltip — naming the snap is what builds trust. */
export const SNAP_LABEL: Record<SnapType, string> = {
  endpoint: 'Endpoint',
  intersection: 'Intersection',
  midpoint: 'Midpoint',
  center: 'Center',
  perpendicular: 'Perpendicular',
  quadrant: 'Quadrant',
  edge: 'On edge',
  extension: 'Extension',
  grid: 'Grid',
  axis: 'Axis',
}

export interface SnapCandidate {
  type: SnapType
  point: Vec2
  /** Element that produced this candidate, for host highlighting. */
  sourceId?: string
}

export interface SnapResult {
  point: Vec2
  type: SnapType | null
  label: string | null
  sourceId?: string
  /** True when the cursor was pulled onto a candidate rather than left free. */
  snapped: boolean
}

export type SnapToggles = Record<SnapType, boolean>

export const DEFAULT_SNAP_TOGGLES: SnapToggles = {
  endpoint: true,
  intersection: true,
  midpoint: true,
  center: true,
  perpendicular: true,
  quadrant: true,
  edge: true,
  extension: true,
  grid: true,
  axis: true,
}

export interface SnapContext {
  scene: SceneGraph
  levelId: string
  /** World-unit pull radius, converted from a pixel aperture by the caller. */
  aperture: number
  gridSize: number
  toggles: SnapToggles
  /** Anchor for perpendicular/extension/axis snaps — the in-progress point, if any. */
  fromPoint?: Vec2
  /** Polar/axis increments in degrees, relative to `fromPoint`. */
  angleIncrements?: number[]
  /** The previous frame's winner, for hysteresis. */
  previous?: SnapResult | null
  /** Extra scratch points (e.g. an in-progress polygon's vertices). */
  extraPoints?: Vec2[]
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

interface Segment {
  a: Vec2
  b: Vec2
  sourceId: string
}

/** Flatten every wall centreline on the active level into segments, plus slab/room edges. */
export function levelSegments(scene: SceneGraph, levelId: string): Segment[] {
  const segs: Segment[] = []

  for (const wall of scene.walls) {
    if (wall.levelId !== levelId) continue
    const resolved = resolveWall(scene, wall)
    if (!resolved) continue
    const pts = baselinePolyline(resolved.centerline)
    for (let i = 0; i < pts.length - 1; i++) {
      segs.push({ a: pts[i], b: pts[i + 1], sourceId: wall.id })
    }
  }

  const pushLoop = (poly: Vec2[], sourceId: string): void => {
    for (let i = 0; i < poly.length; i++) {
      segs.push({ a: poly[i], b: poly[(i + 1) % poly.length], sourceId })
    }
  }
  for (const slab of scene.slabs) {
    if (slab.levelId === levelId) pushLoop(slab.boundary, slab.id)
  }
  for (const room of scene.rooms) {
    if (room.levelId === levelId) pushLoop(room.polygon, room.id)
  }
  for (const beam of scene.beams) {
    if (beam.levelId === levelId) segs.push({ a: beam.start, b: beam.end, sourceId: beam.id })
  }

  return segs
}

function nearbySegments(segs: Segment[], p: Vec2, radius: number): Segment[] {
  // Cheap broad-phase: keep segments whose bounding box is within the radius.
  return segs.filter((s) => {
    const minX = Math.min(s.a[0], s.b[0]) - radius
    const maxX = Math.max(s.a[0], s.b[0]) + radius
    const minY = Math.min(s.a[1], s.b[1]) - radius
    const maxY = Math.max(s.a[1], s.b[1]) + radius
    return p[0] >= minX && p[0] <= maxX && p[1] >= minY && p[1] <= maxY
  })
}

export function generateCandidates(cursor: Vec2, ctx: SnapContext): SnapCandidate[] {
  const out: SnapCandidate[] = []
  const on = (t: SnapType): boolean => ctx.toggles[t]
  // Search a little wider than the aperture so intersections just outside still register.
  const searchRadius = ctx.aperture * 3
  const all = levelSegments(ctx.scene, ctx.levelId)
  const near = nearbySegments(all, cursor, searchRadius)

  for (const s of near) {
    if (on('endpoint')) {
      out.push({ type: 'endpoint', point: s.a, sourceId: s.sourceId })
      out.push({ type: 'endpoint', point: s.b, sourceId: s.sourceId })
    }
    if (on('midpoint')) {
      out.push({ type: 'midpoint', point: lerp2(s.a, s.b, 0.5), sourceId: s.sourceId })
    }
    if (on('edge')) {
      const proj = projectPointToSegment(cursor, s.a, s.b)
      out.push({ type: 'edge', point: proj.point, sourceId: s.sourceId })
    }
    if (on('perpendicular') && ctx.fromPoint) {
      // Foot of the perpendicular dropped from the anchor onto this segment.
      const proj = projectPointToSegment(ctx.fromPoint, s.a, s.b)
      if (proj.t > 1e-6 && proj.t < 1 - 1e-6) {
        out.push({ type: 'perpendicular', point: proj.point, sourceId: s.sourceId })
      }
    }
    if (on('extension')) {
      // Project the cursor onto the segment's infinite line, but only beyond its ends.
      const dir = direction(s.a, s.b)
      const len = distance(s.a, s.b)
      if (len > 1e-9) {
        const t = ((cursor[0] - s.a[0]) * dir[0] + (cursor[1] - s.a[1]) * dir[1]) / len
        if (t > 1 || t < 0) {
          out.push({
            type: 'extension',
            point: [s.a[0] + dir[0] * len * t, s.a[1] + dir[1] * len * t],
            sourceId: s.sourceId,
          })
        }
      }
    }
  }

  if (on('intersection')) {
    for (let i = 0; i < near.length; i++) {
      for (let j = i + 1; j < near.length; j++) {
        if (near[i].sourceId === near[j].sourceId) continue
        const x = segmentIntersection(near[i].a, near[i].b, near[j].a, near[j].b)
        if (x && distance(x, cursor) <= searchRadius) {
          out.push({ type: 'intersection', point: x, sourceId: near[i].sourceId })
        }
      }
    }
  }

  // Arc centres and quadrants.
  for (const wall of ctx.scene.walls) {
    if (wall.levelId !== ctx.levelId || wall.baseline.kind !== 'arc') continue
    const resolved = resolveWall(ctx.scene, wall)
    if (!resolved || resolved.centerline.kind !== 'arc') continue
    const info = arcInfo(
      resolved.centerline.start,
      resolved.centerline.end,
      resolved.centerline.bulge,
    )
    if (!info) continue
    if (on('center')) out.push({ type: 'center', point: info.center, sourceId: wall.id })
    if (on('quadrant')) {
      for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
        out.push({
          type: 'quadrant',
          point: [info.center[0] + Math.cos(a) * info.radius, info.center[1] + Math.sin(a) * info.radius],
          sourceId: wall.id,
        })
      }
    }
    if (on('midpoint')) {
      const mid = baselinePointAt(resolved.centerline, baselineLength(resolved.centerline) / 2)
      out.push({ type: 'midpoint', point: mid.point, sourceId: wall.id })
    }
  }

  // Column centres are endpoints for snapping purposes.
  if (on('endpoint')) {
    for (const c of ctx.scene.columns) {
      if (c.levelId === ctx.levelId) out.push({ type: 'endpoint', point: c.position, sourceId: c.id })
    }
    for (const p of ctx.extraPoints ?? []) out.push({ type: 'endpoint', point: p })
  }

  // Polar / axis snap relative to the in-progress anchor.
  if (on('axis') && ctx.fromPoint) {
    const increments = ctx.angleIncrements ?? [0, 45, 90, 135, 180, 225, 270, 315]
    const r = distance(ctx.fromPoint, cursor)
    if (r > 1e-6) {
      for (const deg of increments) {
        const rad = (deg * Math.PI) / 180
        out.push({
          type: 'axis',
          point: [ctx.fromPoint[0] + Math.cos(rad) * r, ctx.fromPoint[1] + Math.sin(rad) * r],
        })
      }
    }
  }

  if (on('grid') && ctx.gridSize > 0) {
    out.push({
      type: 'grid',
      point: [
        Math.round(cursor[0] / ctx.gridSize) * ctx.gridSize,
        Math.round(cursor[1] / ctx.gridSize) * ctx.gridSize,
      ],
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Extra pull the previous winner gets, as a fraction of the aperture. Prevents flicker. */
const HYSTERESIS = 0.4

/**
 * Pick the winning snap for this cursor position, or return the raw point if nothing is in range.
 * Ties break by priority; the previous winner gets a hysteresis bonus so it doesn't flicker.
 */
export function resolveSnap(cursor: Vec2, ctx: SnapContext): SnapResult {
  const candidates = generateCandidates(cursor, ctx)

  let best: SnapCandidate | null = null
  let bestScore = Infinity

  for (const c of candidates) {
    const d = distance(cursor, c.point)
    if (d > ctx.aperture) continue
    // Score blends distance with priority so a slightly-farther endpoint beats a nearer grid dot.
    let score = d + PRIORITY[c.type] * ctx.aperture * 0.08
    if (
      ctx.previous?.type === c.type &&
      ctx.previous.point &&
      distance(ctx.previous.point, c.point) < 1e-9
    ) {
      score -= ctx.aperture * HYSTERESIS
    }
    if (score < bestScore) {
      bestScore = score
      best = c
    }
  }

  if (!best) return { point: cursor, type: null, label: null, snapped: false }
  return {
    point: best.point,
    type: best.type,
    label: SNAP_LABEL[best.type],
    sourceId: best.sourceId,
    snapped: true,
  }
}

// ---------------------------------------------------------------------------
// Axis / angle locking
// ---------------------------------------------------------------------------

export type AxisLock = 'none' | 'x' | 'y'

/** Constrain a point to an axis through the anchor. */
export function applyAxisLock(point: Vec2, from: Vec2, lock: AxisLock): Vec2 {
  if (lock === 'x') return [point[0], from[1]]
  if (lock === 'y') return [from[0], point[1]]
  return point
}

/**
 * Semantic colour for the rubber band, per the SketchUp convention the research identified as
 * the highest leverage per line of code: axis-aligned reads red/green, aligned-to-other-geometry
 * reads magenta, unconstrained reads neutral.
 */
export type ConstraintColor = 'axis-x' | 'axis-y' | 'geometry' | 'none'

export function constraintColor(snap: SnapResult, lock: AxisLock): ConstraintColor {
  if (lock === 'x') return 'axis-x'
  if (lock === 'y') return 'axis-y'
  if (snap.type === 'axis') return 'axis-x'
  if (snap.snapped && snap.type !== 'grid') return 'geometry'
  return 'none'
}

/** Snap an angle to the nearest increment, returning the constrained point. */
export function applyAngleSnap(
  point: Vec2,
  from: Vec2,
  incrementDeg: number,
): { point: Vec2; angleDeg: number } {
  const dx = point[0] - from[0]
  const dy = point[1] - from[1]
  const r = Math.hypot(dx, dy)
  if (r < 1e-9 || incrementDeg <= 0) return { point, angleDeg: 0 }
  const raw = (Math.atan2(dy, dx) * 180) / Math.PI
  const snappedDeg = Math.round(raw / incrementDeg) * incrementDeg
  const rad = (snappedDeg * Math.PI) / 180
  return {
    point: [from[0] + Math.cos(rad) * r, from[1] + Math.sin(rad) * r],
    angleDeg: snappedDeg,
  }
}

/** Place a point at an exact distance from the anchor, keeping the cursor's direction. */
export function constrainToLength(point: Vec2, from: Vec2, length: number): Vec2 {
  const dir = direction(from, point)
  return [from[0] + dir[0] * length, from[1] + dir[1] * length]
}

/** Place a point at an exact distance AND angle from the anchor. */
export function fromPolar(from: Vec2, length: number, angleDeg: number): Vec2 {
  const rad = (angleDeg * Math.PI) / 180
  return [from[0] + Math.cos(rad) * length, from[1] + Math.sin(rad) * length]
}

/** Signed angle in degrees from the anchor to the point, 0 = +X. */
export function angleTo(from: Vec2, to: Vec2): number {
  return (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI
}

export { perpendicular }
