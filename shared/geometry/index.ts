/**
 * Shared, pure geometry. The ONE place geometry logic lives — the 3D viewport, the plan view,
 * the snap engine and the exporters all call into here, so they can never disagree.
 *
 * Openings are cut by **box decomposition**, not CSG: a wall with holes becomes the set of solid
 * boxes that remain. Exact, fast, dependency-free and trivially testable. See DECISIONS.md D-005.
 */

import {
  assemblyThickness,
  resolveTopElevation,
  findWallType,
  findSlabType,
  findLevel,
  findType,
  type Vec2,
  type Vec3,
  type Wall,
  type Opening,
  type Slab,
  type Column,
  type Beam,
  type Baseline,
  type LocationLine,
  type SceneGraph,
  type ProfileShape,
} from '../types/scene'

// ---------------------------------------------------------------------------
// 2D primitives
// ---------------------------------------------------------------------------

export function distance(a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  return Math.sqrt(dx * dx + dy * dy)
}

export function direction(a: Vec2, b: Vec2): Vec2 {
  const len = distance(a, b)
  if (len < 1e-10) return [1, 0]
  return [(b[0] - a[0]) / len, (b[1] - a[1]) / len]
}

/** Left-hand normal of a 2D direction vector. */
export function perpendicular(dir: Vec2): Vec2 {
  return [-dir[1], dir[0]]
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]]
}

export function scale(a: Vec2, k: number): Vec2 {
  return [a[0] * k, a[1] * k]
}

export function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

export interface Projection {
  /** Parametric position along the segment, clamped to [0,1] */
  t: number
  point: Vec2
  distance: number
}

/** Closest point on segment [a,b] to p (clamped to the segment). */
export function projectPointToSegment(p: Vec2, a: Vec2, b: Vec2): Projection {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const len2 = abx * abx + aby * aby
  if (len2 < 1e-12) return { t: 0, point: a, distance: distance(p, a) }
  let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2
  t = Math.max(0, Math.min(1, t))
  const point: Vec2 = [a[0] + abx * t, a[1] + aby * t]
  return { t, point, distance: distance(p, point) }
}

/** Intersection of two infinite lines, each given as a point + direction. Null if parallel. */
export function lineLineIntersection(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const denom = d1[0] * d2[1] - d1[1] * d2[0]
  if (Math.abs(denom) < 1e-12) return null
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / denom
  return [p1[0] + d1[0] * t, p1[1] + d1[1] * t]
}

/** Intersection of two finite segments, or null. */
export function segmentIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const d1: Vec2 = [a2[0] - a1[0], a2[1] - a1[1]]
  const d2: Vec2 = [b2[0] - b1[0], b2[1] - b1[1]]
  const denom = d1[0] * d2[1] - d1[1] * d2[0]
  if (Math.abs(denom) < 1e-12) return null
  const t = ((b1[0] - a1[0]) * d2[1] - (b1[1] - a1[1]) * d2[0]) / denom
  const u = ((b1[0] - a1[0]) * d1[1] - (b1[1] - a1[1]) * d1[0]) / denom
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null
  return [a1[0] + d1[0] * t, a1[1] + d1[1] * t]
}

// ---------------------------------------------------------------------------
// Polygons
// ---------------------------------------------------------------------------

/** Signed area (positive = counter-clockwise). */
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

export function polygonPerimeter(polygon: Vec2[]): number {
  let p = 0
  for (let i = 0; i < polygon.length; i++) {
    p += distance(polygon[i], polygon[(i + 1) % polygon.length])
  }
  return p
}

/** Vertex average — good enough for label placement and gizmo anchors. */
export function polygonCentroid(polygon: Vec2[]): Vec2 {
  if (polygon.length === 0) return [0, 0]
  let x = 0
  let y = 0
  for (const [px, py] of polygon) {
    x += px
    y += py
  }
  return [x / polygon.length, y / polygon.length]
}

export function pointInPolygon(p: Vec2, polygon: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    const hit = yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi
    if (hit) inside = !inside
  }
  return inside
}

function cross2D(o: Vec2, a: Vec2, b: Vec2): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

function properSegmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross2D(c, d, a)
  const d2 = cross2D(c, d, b)
  const d3 = cross2D(a, b, c)
  const d4 = cross2D(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

export function isSimplePolygon(polygon: Vec2[]): boolean {
  const n = polygon.length
  if (n < 3) return false
  for (let i = 0; i < n; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % n]
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue // adjacent at wrap-around
      if (properSegmentsIntersect(a, b, polygon[j], polygon[(j + 1) % n])) return false
    }
  }
  return true
}

// ---------------------------------------------------------------------------
// Baselines (line / arc)
// ---------------------------------------------------------------------------

/**
 * Arc baselines are stored as start/end + a bulge factor (tan of a quarter of the swept angle),
 * the DXF convention. bulge 0 == straight. This keeps arcs fully parametric.
 */
export interface ArcInfo {
  center: Vec2
  radius: number
  startAngle: number
  endAngle: number
  /** Counter-clockwise if true. */
  ccw: boolean
}

export function arcInfo(start: Vec2, end: Vec2, bulge: number): ArcInfo | null {
  if (Math.abs(bulge) < 1e-9) return null
  const chord = distance(start, end)
  if (chord < 1e-9) return null

  // Standard DXF bulge geometry. Keeping the radius SIGNED through the centre calculation is what
  // makes the sign of `bulge` place the centre on the correct side without special-casing.
  const sweep = 4 * Math.atan(bulge)
  const halfSweep = sweep / 2
  const sinHalf = Math.sin(halfSweep)
  if (Math.abs(sinHalf) < 1e-12) return null

  const signedRadius = chord / (2 * sinHalf)
  const offsetFromMid = signedRadius * Math.cos(halfSweep)

  const mid = lerp2(start, end, 0.5)
  const leftNormal = perpendicular(direction(start, end))
  const center: Vec2 = [
    mid[0] + leftNormal[0] * offsetFromMid,
    mid[1] + leftNormal[1] * offsetFromMid,
  ]

  return {
    center,
    radius: Math.abs(signedRadius),
    startAngle: Math.atan2(start[1] - center[1], start[0] - center[0]),
    endAngle: Math.atan2(end[1] - center[1], end[0] - center[0]),
    ccw: bulge > 0,
  }
}

/**
 * Circumcentre of three points, or null when they are collinear.
 */
export function circumcenter(a: Vec2, b: Vec2, c: Vec2): Vec2 | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
  if (Math.abs(d) < 1e-12) return null
  const sa = a[0] * a[0] + a[1] * a[1]
  const sb = b[0] * b[0] + b[1] * b[1]
  const sc = c[0] * c[0] + c[1] * c[1]
  return [
    (sa * (b[1] - c[1]) + sb * (c[1] - a[1]) + sc * (a[1] - b[1])) / d,
    (sa * (c[0] - b[0]) + sb * (a[0] - c[0]) + sc * (b[0] - a[0])) / d,
  ]
}

/**
 * A bulge such that `{kind:'arc', start, end, bulge}` passes through `through` — the arithmetic
 * behind both the 3-point arc wall tool and the bulge drag handle (A1). Dragging a wall's
 * mid-handle to a point IS a 3-point arc, so one function serves both.
 *
 * Returns 0 (a straight baseline) when `through` is on the chord, when the chord is degenerate, or
 * when the three points are collinear — a curved-wall tool must degrade to a straight wall rather
 * than emit a NaN bulge.
 *
 * Derivation: bulge is the signed sagitta over the half-chord. The perpendicular bisector of the
 * chord meets the circumcircle at `d ± R` measured along the chord's left normal (R > |d| always,
 * since R² = d² + (chord/2)²), so `d + R` is unconditionally the apex on the +normal side and
 * `d - R` the one on the −normal side. Positive bulge sweeps counter-clockwise, which puts the arc
 * on the −normal side, hence the negation.
 */
export function bulgeThroughPoint(start: Vec2, end: Vec2, through: Vec2): number {
  const chord = distance(start, end)
  if (chord < 1e-9) return 0

  const mid = lerp2(start, end, 0.5)
  const leftNormal = perpendicular(direction(start, end))
  const side = (through[0] - mid[0]) * leftNormal[0] + (through[1] - mid[1]) * leftNormal[1]
  // On the chord (within a tenth of a millimetre) means the user wants a straight wall.
  if (Math.abs(side) < 1e-4) return 0

  const c = circumcenter(start, through, end)
  if (!c) return 0

  const radius = distance(start, c)
  const d = (c[0] - mid[0]) * leftNormal[0] + (c[1] - mid[1]) * leftNormal[1]
  const apex = side > 0 ? d + radius : d - radius
  const bulge = (-2 * apex) / chord

  if (!Number.isFinite(bulge)) return 0
  // |bulge| = 1 is a semicircle; beyond MAX_BULGE the arc closes on itself and stops being a
  // sensible wall. Clamp rather than emit geometry the renderer would have to guess about.
  return Math.max(-MAX_BULGE, Math.min(MAX_BULGE, bulge))
}

/** Sweep beyond this is a near-complete circle — not a wall. tan(2π/4·0.98) ≈ 31. */
export const MAX_BULGE = 10

/**
 * The apex of an arc baseline — where the bulge drag handle sits. For a line this is the chord
 * midpoint, which is exactly where the handle should start before any drag.
 */
export function baselineApex(b: Baseline): Vec2 {
  const mid = lerp2(b.start, b.end, 0.5)
  if (b.kind === 'line' || Math.abs(b.bulge) < 1e-9) return mid
  const info = arcInfo(b.start, b.end, b.bulge)
  if (!info) return mid
  const leftNormal = perpendicular(direction(b.start, b.end))
  const d = (info.center[0] - mid[0]) * leftNormal[0] + (info.center[1] - mid[1]) * leftNormal[1]
  // Positive bulge bows to the −normal side (see bulgeThroughPoint).
  const apex = b.bulge > 0 ? d - info.radius : d + info.radius
  return [mid[0] + leftNormal[0] * apex, mid[1] + leftNormal[1] * apex]
}

export function baselineStart(b: Baseline): Vec2 {
  return b.start
}

export function baselineEnd(b: Baseline): Vec2 {
  return b.end
}

/** Arc length for arcs, chord length for lines. */
export function baselineLength(b: Baseline): number {
  if (b.kind === 'line') return distance(b.start, b.end)
  const info = arcInfo(b.start, b.end, b.bulge)
  if (!info) return distance(b.start, b.end)
  return Math.abs(4 * Math.atan(b.bulge)) * info.radius
}

/**
 * Flatten a baseline into a polyline. Arcs are tessellated at ~2° so a 3 m radius arc is
 * smooth without exploding the vertex count. Lines return their two endpoints.
 */
export function baselinePolyline(b: Baseline, segmentsPerRadian = 28): Vec2[] {
  if (b.kind === 'line') return [b.start, b.end]
  const info = arcInfo(b.start, b.end, b.bulge)
  if (!info) return [b.start, b.end]
  const sweep = 4 * Math.atan(b.bulge)
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) * segmentsPerRadian))
  const pts: Vec2[] = []
  for (let i = 0; i <= steps; i++) {
    const a = info.startAngle + (sweep * i) / steps
    pts.push([info.center[0] + Math.cos(a) * info.radius, info.center[1] + Math.sin(a) * info.radius])
  }
  return pts
}

/** Point and tangent at distance `s` along the baseline. */
export function baselinePointAt(b: Baseline, s: number): { point: Vec2; tangent: Vec2 } {
  const len = baselineLength(b)
  const t = len < 1e-9 ? 0 : Math.max(0, Math.min(1, s / len))
  if (b.kind === 'line') {
    return { point: lerp2(b.start, b.end, t), tangent: direction(b.start, b.end) }
  }
  const info = arcInfo(b.start, b.end, b.bulge)
  if (!info) return { point: lerp2(b.start, b.end, t), tangent: direction(b.start, b.end) }
  const sweep = 4 * Math.atan(b.bulge)
  const a = info.startAngle + sweep * t
  const point: Vec2 = [
    info.center[0] + Math.cos(a) * info.radius,
    info.center[1] + Math.sin(a) * info.radius,
  ]
  // Tangent is perpendicular to the radius, oriented with the sweep.
  const s0 = Math.sign(sweep) || 1
  const tangent: Vec2 = [-Math.sin(a) * s0, Math.cos(a) * s0]
  return { point, tangent }
}

/** Offset a baseline sideways by `d` (positive = left of the direction of travel). */
export function offsetBaseline(b: Baseline, d: number): Baseline {
  if (Math.abs(d) < 1e-12) return b
  if (b.kind === 'line') {
    const perp = perpendicular(direction(b.start, b.end))
    return {
      kind: 'line',
      start: [b.start[0] + perp[0] * d, b.start[1] + perp[1] * d],
      end: [b.end[0] + perp[0] * d, b.end[1] + perp[1] * d],
    }
  }
  const info = arcInfo(b.start, b.end, b.bulge)
  if (!info) return b
  // Offsetting an arc changes its radius but preserves centre and swept angle, so the bulge
  // is unchanged and we only move the endpoints radially.
  const shift = (p: Vec2): Vec2 => {
    const ux = p[0] - info.center[0]
    const uy = p[1] - info.center[1]
    const l = Math.hypot(ux, uy) || 1
    // Left of travel is outward for a CCW arc, inward for CW.
    const k = (info.ccw ? -1 : 1) * d
    return [p[0] + (ux / l) * k, p[1] + (uy / l) * k]
  }
  return { kind: 'arc', start: shift(b.start), end: shift(b.end), bulge: b.bulge }
}

// ---------------------------------------------------------------------------
// Wall resolution
// ---------------------------------------------------------------------------

/**
 * Everything the renderers and exporters need about a wall, resolved from its type + level.
 * Computed once and shared, so plan view, 3D and export agree by construction.
 */
export interface ResolvedWall {
  id: string
  thickness: number
  baseElevation: number
  topElevation: number
  height: number
  /** Baseline shifted from the location line to the geometric centre of the assembly. */
  centerline: Baseline
  length: number
  material: string
}

/**
 * Signed offset from the location line to the assembly centre, in the wall's left-normal
 * direction. `flipped` swaps which side counts as exterior — the location line is the pivot.
 */
export function locationLineOffset(
  locationLine: LocationLine,
  thickness: number,
  flipped: boolean,
): number {
  const half = thickness / 2
  let d = 0
  if (locationLine === 'finish-exterior') d = -half
  else if (locationLine === 'finish-interior') d = half
  return flipped ? -d : d
}

export function resolveWall(scene: SceneGraph, wall: Wall): ResolvedWall | null {
  const type = findWallType(scene, wall.typeId)
  const level = findLevel(scene, wall.levelId)
  if (!type || !level) return null

  const thickness = assemblyThickness(type.layers)
  const baseElevation = level.elevation + wall.baseOffset
  const topElevation = resolveTopElevation(scene, wall.top, level.elevation + wall.baseOffset)
  const d = locationLineOffset(wall.locationLine, thickness, wall.flipped)
  const centerline = offsetBaseline(wall.baseline, d)

  // The structural layer drives the rendered colour; fall back to the thickest layer.
  const structural =
    type.layers.find((l) => l.function === 'structure') ??
    type.layers.reduce((a, b) => (b.thickness > a.thickness ? b : a), type.layers[0])

  return {
    id: wall.id,
    thickness,
    baseElevation,
    topElevation,
    height: Math.max(0, topElevation - baseElevation),
    centerline,
    length: baselineLength(centerline),
    material: structural?.material ?? 'mat-plaster-white',
  }
}

// ---------------------------------------------------------------------------
// Solid decomposition
// ---------------------------------------------------------------------------

/**
 * An oriented box. `size` is [length, height, thickness] in the box's local frame;
 * `rotationY` rotates it about world Y so its length axis follows the element.
 * The 3D viewport renders these directly and the exporters build meshes from the same list.
 */
export interface Box3D {
  center: Vec3
  size: Vec3
  rotationY: number
}

/** Rotation about world Y so a box's local +X follows a 2D direction (scene y → world z). */
export function rotationYFor(dir: Vec2): number {
  return Math.atan2(-dir[1], dir[0])
}

/**
 * The 8 world-space corners of an oriented box, in a fixed order: the four bottom corners
 * counter-clockwise seen from above, then the four top corners in the same order.
 *
 * Used by box-select (a screen rectangle has to be tested against real element edges, not a
 * bounding box) and available to exporters that need explicit vertices.
 */
export function boxCorners(box: Box3D): Vec3[] {
  const [hx, hy, hz] = [box.size[0] / 2, box.size[1] / 2, box.size[2] / 2]
  const cos = Math.cos(box.rotationY)
  const sin = Math.sin(box.rotationY)
  const out: Vec3[] = []
  // Rotation about Y: [x,z] → [x·cos + z·sin, −x·sin + z·cos].
  for (const sy of [-1, 1]) {
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const x = sx * hx
      const z = sz * hz
      out.push([
        box.center[0] + x * cos + z * sin,
        box.center[1] + sy * hy,
        box.center[2] - x * sin + z * cos,
      ])
    }
  }
  return out
}

/** Index pairs for the 12 edges of the corner list `boxCorners` returns. */
export const BOX_EDGES: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0], // bottom face
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4], // top face
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7], // verticals
]

/**
 * A closed polygon extruded between two elevations, as corners + edges — the same shape of data
 * `boxCorners`/`BOX_EDGES` produce, so callers can treat prisms and boxes identically.
 */
export function prismCornersAndEdges(
  polygon: Vec2[],
  bottom: number,
  top: number,
): { corners: Vec3[]; edges: Array<[number, number]> } {
  const n = polygon.length
  const corners: Vec3[] = [
    ...polygon.map((p) => [p[0], bottom, p[1]] as Vec3),
    ...polygon.map((p) => [p[0], top, p[1]] as Vec3),
  ]
  const edges: Array<[number, number]> = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    edges.push([i, j])
    edges.push([n + i, n + j])
    edges.push([i, n + i])
  }
  return { corners, edges }
}

function mergeSpans(spans: Array<[number, number]>): Array<[number, number]> {
  if (spans.length === 0) return []
  const sorted = [...spans].sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = [[sorted[0][0], sorted[0][1]]]
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1]
    const [s, e] = sorted[i]
    if (s <= last[1] + 1e-9) last[1] = Math.max(last[1], e)
    else out.push([s, e])
  }
  return out
}

/**
 * Decompose a resolved wall + its openings into the solid boxes that remain: full-height runs
 * between openings, the lintel above each opening, and the section below a window sill.
 *
 * Curved walls are tessellated into straight chunks first, so an arc wall with a window works
 * through exactly the same code path.
 */
export function wallSolidBoxes(wall: ResolvedWall, openings: Opening[]): Box3D[] {
  const { thickness, height, baseElevation } = wall
  const length = wall.length
  if (length < 1e-9 || height < 1e-9 || thickness < 1e-9) return []

  // Clamp openings to the wall and drop degenerate ones.
  const spans = openings
    .map((o) => ({
      x0: Math.max(0, o.offset),
      x1: Math.min(length, o.offset + o.width),
      y0: Math.max(0, o.sillHeight),
      y1: Math.min(height, o.sillHeight + o.height),
    }))
    .filter((s) => s.x1 - s.x0 > 1e-9 && s.y1 - s.y0 > 1e-9)

  const boxes: Box3D[] = []

  /** Emit boxes covering [s0,s1] along the baseline between heights y0..y1. */
  const emit = (s0: number, s1: number, y0: number, y1: number): void => {
    if (s1 - s0 <= 1e-9 || y1 - y0 <= 1e-9) return
    if (wall.centerline.kind === 'line') {
      pushChunk(s0, s1, y0, y1)
      return
    }
    // Tessellate curves: one box per ~0.25 m of arc so the silhouette reads as curved.
    const steps = Math.max(1, Math.ceil((s1 - s0) / 0.25))
    for (let i = 0; i < steps; i++) {
      pushChunk(s0 + ((s1 - s0) * i) / steps, s0 + ((s1 - s0) * (i + 1)) / steps, y0, y1)
    }
  }

  const pushChunk = (s0: number, s1: number, y0: number, y1: number): void => {
    const a = baselinePointAt(wall.centerline, s0)
    const b = baselinePointAt(wall.centerline, s1)
    const mid: Vec2 = lerp2(a.point, b.point, 0.5)
    const chord = distance(a.point, b.point)
    if (chord < 1e-9) return
    const dir = direction(a.point, b.point)
    boxes.push({
      center: [mid[0], baseElevation + (y0 + y1) / 2, mid[1]],
      size: [chord, y1 - y0, thickness],
      rotationY: rotationYFor(dir),
    })
  }

  // Full-height runs = the parts of [0,length] no opening covers.
  const covered = mergeSpans(spans.map((s) => [s.x0, s.x1] as [number, number]))
  let cursor = 0
  for (const [cs, ce] of covered) {
    emit(cursor, cs, 0, height)
    cursor = ce
  }
  emit(cursor, length, 0, height)

  // Under-sill and lintel for each opening.
  for (const s of spans) {
    emit(s.x0, s.x1, 0, s.y0)
    emit(s.x0, s.x1, s.y1, height)
  }

  return boxes
}

/** Extrude a profile into an oriented box for a column. */
export function columnSolid(scene: SceneGraph, column: Column): Box3D | null {
  const type = findType(scene, column.typeId)
  const level = findLevel(scene, column.levelId)
  if (!type || type.category !== 'column' || !level) return null
  const base = level.elevation + column.baseOffset
  const top = resolveTopElevation(scene, column.top, base)
  const h = top - base
  if (h <= 1e-9) return null
  const [w, d] = profileExtents(type.profile)
  return {
    center: [column.position[0], base + h / 2, column.position[1]],
    size: [w, h, d],
    rotationY: (-column.rotation * Math.PI) / 180,
  }
}

/** A beam is a profile extruded along its 2D axis at a fixed elevation. */
export function beamSolid(scene: SceneGraph, beam: Beam): Box3D | null {
  const type = findType(scene, beam.typeId)
  const level = findLevel(scene, beam.levelId)
  if (!type || type.category !== 'beam' || !level) return null
  const len = distance(beam.start, beam.end)
  if (len <= 1e-9) return null
  const [w, d] = profileExtents(type.profile)
  const mid = lerp2(beam.start, beam.end, 0.5)
  const y = level.elevation + beam.heightOffset
  return {
    center: [mid[0], y - d / 2, mid[1]],
    size: [len, d, w],
    rotationY: rotationYFor(direction(beam.start, beam.end)),
  }
}

export function profileExtents(profile: ProfileShape): [number, number] {
  return profile.kind === 'rectangular'
    ? [profile.width, profile.depth]
    : [profile.diameter, profile.diameter]
}

/** A slab as a boundary polygon plus a thickness and its top elevation. */
export interface ResolvedSlab {
  id: string
  boundary: Vec2[]
  thickness: number
  /** World elevation of the slab's TOP face. */
  topElevation: number
  material: string
}

export function resolveSlab(scene: SceneGraph, slab: Slab): ResolvedSlab | null {
  const type = findSlabType(scene, slab.typeId)
  const level = findLevel(scene, slab.levelId)
  if (!type || !level) return null
  if (slab.boundary.length < 3) return null
  const thickness = assemblyThickness(type.layers)
  const structural =
    type.layers.find((l) => l.function === 'structure') ??
    type.layers.reduce((a, b) => (b.thickness > a.thickness ? b : a), type.layers[0])
  return {
    id: slab.id,
    boundary: slab.boundary,
    thickness,
    topElevation: level.elevation + slab.heightOffset,
    material: structural?.material ?? 'mat-concrete',
  }
}

// ---------------------------------------------------------------------------
// Validation — reject clearly, never degrade silently
// ---------------------------------------------------------------------------

export function validateWall(scene: SceneGraph, wall: Wall): string[] {
  const errors: string[] = []
  const type = findWallType(scene, wall.typeId)
  if (!type) errors.push(`Unknown wall type "${wall.typeId}"`)
  if (!findLevel(scene, wall.levelId)) errors.push(`Unknown level "${wall.levelId}"`)
  if (baselineLength(wall.baseline) < 1e-6) errors.push('Wall has zero length')
  if (type && assemblyThickness(type.layers) <= 0) errors.push('Wall thickness must be positive')
  const resolved = type ? resolveWall(scene, wall) : null
  if (resolved && resolved.height <= 0) {
    errors.push('Wall height must be positive — check its top constraint')
  }
  return errors
}

export function validateOpening(scene: SceneGraph, opening: Opening): string[] {
  const errors: string[] = []
  if (opening.width <= 0) errors.push('Opening width must be positive')
  if (opening.height <= 0) errors.push('Opening height must be positive')
  if (opening.offset < 0) errors.push('Opening offset must be non-negative')
  if (opening.sillHeight < 0) errors.push('Sill height must be non-negative')

  const wall = scene.walls.find((w) => w.id === opening.hostId)
  if (!wall) {
    errors.push(`Opening has no host (looked for "${opening.hostId}")`)
    return errors
  }
  const resolved = resolveWall(scene, wall)
  if (!resolved) return errors

  if (opening.offset + opening.width > resolved.length + 1e-9) {
    errors.push(
      `Opening extends past the wall end (needs ${(opening.offset + opening.width).toFixed(2)}m of ${resolved.length.toFixed(2)}m)`,
    )
  }
  if (opening.sillHeight + opening.height > resolved.height + 1e-9) {
    errors.push(
      `Opening top exceeds wall height (needs ${(opening.sillHeight + opening.height).toFixed(2)}m of ${resolved.height.toFixed(2)}m)`,
    )
  }
  return errors
}

export function validateRoomPolygon(polygon: Vec2[]): string[] {
  const errors: string[] = []
  if (polygon.length < 3) {
    errors.push('Room polygon must have at least 3 vertices')
    return errors
  }
  if (!isSimplePolygon(polygon)) errors.push('Room polygon is self-intersecting')
  if (Math.abs(polygonArea(polygon)) < 1e-6) errors.push('Room polygon has zero area')
  return errors
}

export function validateSlab(scene: SceneGraph, slab: Slab): string[] {
  const errors: string[] = []
  if (!findSlabType(scene, slab.typeId)) errors.push(`Unknown slab type "${slab.typeId}"`)
  if (!findLevel(scene, slab.levelId)) errors.push(`Unknown level "${slab.levelId}"`)
  errors.push(...validateRoomPolygon(slab.boundary).map((e) => e.replace('Room polygon', 'Slab boundary')))
  return errors
}

// ---------------------------------------------------------------------------
// Derived quantities
// ---------------------------------------------------------------------------

/** Floor area of a room, from its polygon. */
export function roomArea(polygon: Vec2[]): number {
  return Math.abs(polygonArea(polygon))
}

/** Room volume using its resolved height. */
export function roomVolume(polygon: Vec2[], height: number): number {
  return roomArea(polygon) * Math.max(0, height)
}
