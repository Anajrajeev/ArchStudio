/**
 * Parametric dimension geometry (C2).
 *
 * Pure functions that resolve a `Dimension` from the scene graph into the geometry needed to
 * render it: witness lines, dimension line, tick marks, text anchor, and the measured value.
 * The renderer (`viewport/Dimensions.tsx`) turns this into r3f elements; the geometry never
 * touches React.
 *
 * Dimensions are PARAMETRIC — they store references to element points, not absolute coordinates.
 * When the measured edge moves, the dimension moves with it because `resolveRef` re-derives the
 * point from the live scene graph.
 */
import type {
  Dimension,
  DimensionKind,
  DimensionRef,
  SceneGraph,
  Vec2,
} from '../types/scene'
import { baselineStart, baselineEnd, baselineLength } from './index'

// ---------------------------------------------------------------------------
// Ref resolution — the parametric link
// ---------------------------------------------------------------------------

/**
 * Resolve a dimension reference to a scene-2D point. Returns null when the referenced element
 * has been deleted — the dimension is then orphaned and should be drawn as broken or hidden.
 */
export function resolveRef(scene: SceneGraph, ref: DimensionRef): Vec2 | null {
  const wall = scene.walls.find((w) => w.id === ref.elementId)
  if (wall) {
    if (ref.pointIndex === 0) return baselineStart(wall.baseline)
    if (ref.pointIndex === 1) return baselineEnd(wall.baseline)
    return null
  }

  const slab = scene.slabs.find((s) => s.id === ref.elementId)
  if (slab) {
    return slab.boundary[ref.pointIndex] ?? null
  }

  const col = scene.columns.find((c) => c.id === ref.elementId)
  if (col && ref.pointIndex === 0) return col.position

  const beam = scene.beams.find((b) => b.id === ref.elementId)
  if (beam) {
    if (ref.pointIndex === 0) return beam.start
    if (ref.pointIndex === 1) return beam.end
    return null
  }

  const room = scene.rooms.find((r) => r.id === ref.elementId)
  if (room) {
    return room.polygon[ref.pointIndex] ?? null
  }

  return null
}

/**
 * The inverse of `resolveRef`: given an element id (the snap engine's `sourceId`) and a world
 * point that landed on one of its named points, find which `pointIndex` that is.
 *
 * This is what lets the dimension TOOL turn "you snapped to this endpoint" into a parametric
 * reference instead of a bare coordinate — the difference between a dimension that updates when
 * the wall moves and one that silently goes stale.
 */
export function refFromPoint(scene: SceneGraph, elementId: string, point: Vec2): DimensionRef | null {
  const EPS = 1e-4
  const near = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS

  const wall = scene.walls.find((w) => w.id === elementId)
  if (wall) {
    if (near(baselineStart(wall.baseline), point)) return { elementId, pointIndex: 0 }
    if (near(baselineEnd(wall.baseline), point)) return { elementId, pointIndex: 1 }
    return null
  }

  const slab = scene.slabs.find((s) => s.id === elementId)
  if (slab) {
    const i = slab.boundary.findIndex((p) => near(p, point))
    return i >= 0 ? { elementId, pointIndex: i } : null
  }

  const col = scene.columns.find((c) => c.id === elementId)
  if (col) return near(col.position, point) ? { elementId, pointIndex: 0 } : null

  const beam = scene.beams.find((b) => b.id === elementId)
  if (beam) {
    if (near(beam.start, point)) return { elementId, pointIndex: 0 }
    if (near(beam.end, point)) return { elementId, pointIndex: 1 }
    return null
  }

  const room = scene.rooms.find((r) => r.id === elementId)
  if (room) {
    const i = room.polygon.findIndex((p) => near(p, point))
    return i >= 0 ? { elementId, pointIndex: i } : null
  }

  return null
}

// ---------------------------------------------------------------------------
// Resolved dimension — what the renderer consumes
// ---------------------------------------------------------------------------

export interface ResolvedDimension {
  id: string
  kind: DimensionKind
  /** The two measured points in scene 2D. */
  p1: Vec2
  p2: Vec2
  /** Start of witness line 1 (on geometry). */
  w1Start: Vec2
  /** End of witness line 1 (on the dimension line). */
  w1End: Vec2
  w2Start: Vec2
  w2End: Vec2
  /** Dimension line endpoints (between the witness line tips). */
  dimStart: Vec2
  dimEnd: Vec2
  /** Where the text should be anchored (midpoint of dimStart–dimEnd). */
  textAnchor: Vec2
  /** Text rotation in radians so it reads along the dimension line. */
  textAngle: number
  /** The displayed text — auto-computed or overridden. */
  text: string
  /** The raw measured value in scene units (metres). */
  value: number
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

function perpCCW(dx: number, dy: number): Vec2 {
  const len = Math.hypot(dx, dy)
  if (len < 1e-12) return [0, 1]
  return [-dy / len, dx / len]
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a <= -Math.PI) a += 2 * Math.PI
  return a
}

function formatMetres(v: number): string {
  if (Math.abs(v) >= 1) return `${v.toFixed(3)} m`
  if (Math.abs(v) >= 0.01) return `${(v * 100).toFixed(1)} cm`
  return `${(v * 1000).toFixed(0)} mm`
}

function formatDegrees(deg: number): string {
  return `${deg.toFixed(1)}°`
}

/**
 * Resolve and compute the geometry for one dimension. Returns null if either ref is broken.
 */
export function resolveDimension(
  scene: SceneGraph,
  dim: Dimension,
): ResolvedDimension | null {
  const p1 = resolveRef(scene, dim.ref1)
  const p2 = resolveRef(scene, dim.ref2)
  if (!p1 || !p2) return null

  switch (dim.kind) {
    case 'aligned':
      return resolveAligned(dim, p1, p2)
    case 'linear-horizontal':
      return resolveLinear(dim, p1, p2, 'horizontal')
    case 'linear-vertical':
      return resolveLinear(dim, p1, p2, 'vertical')
    case 'angular':
      return resolveAngular(dim, p1, p2)
    case 'radial':
    case 'diameter':
      return resolveRadial(dim, p1, p2, dim.kind === 'diameter')
    case 'arc-length':
      return resolveArcLength(scene, dim, p1, p2)
  }
}

/**
 * Aligned dimension: the dimension line runs parallel to the line from p1 to p2.
 */
function resolveAligned(dim: Dimension, p1: Vec2, p2: Vec2): ResolvedDimension {
  const dx = p2[0] - p1[0]
  const dy = p2[1] - p1[1]
  const value = Math.hypot(dx, dy)
  const perp = perpCCW(dx, dy)
  const off = dim.offsetDistance
  const gap = dim.witnessGap

  const w1End: Vec2 = [p1[0] + perp[0] * off, p1[1] + perp[1] * off]
  const w2End: Vec2 = [p2[0] + perp[0] * off, p2[1] + perp[1] * off]
  const w1Start: Vec2 = [p1[0] + perp[0] * gap, p1[1] + perp[1] * gap]
  const w2Start: Vec2 = [p2[0] + perp[0] * gap, p2[1] + perp[1] * gap]

  const angle = Math.atan2(dy, dx)
  const textAngle = normalizeAngle(angle)
  // Flip so text always reads left-to-right or bottom-to-top.
  const readableAngle =
    textAngle > Math.PI / 2 ? textAngle - Math.PI
    : textAngle < -Math.PI / 2 ? textAngle + Math.PI
    : textAngle

  return {
    id: dim.id,
    kind: dim.kind,
    p1,
    p2,
    w1Start,
    w1End,
    w2Start,
    w2End,
    dimStart: w1End,
    dimEnd: w2End,
    textAnchor: lerp(w1End, w2End, 0.5),
    textAngle: readableAngle,
    text: dim.textOverride ?? formatMetres(value),
    value,
  }
}

/**
 * Linear horizontal/vertical: the dimension line is axis-aligned regardless of the measured edge.
 */
function resolveLinear(
  dim: Dimension,
  p1: Vec2,
  p2: Vec2,
  axis: 'horizontal' | 'vertical',
): ResolvedDimension {
  const off = dim.offsetDistance
  const gap = dim.witnessGap

  let dimStart: Vec2, dimEnd: Vec2, w1Start: Vec2, w1End: Vec2, w2Start: Vec2, w2End: Vec2
  let value: number
  let textAngle: number

  if (axis === 'horizontal') {
    value = Math.abs(p2[0] - p1[0])
    const y = Math.max(p1[1], p2[1]) + off
    dimStart = [p1[0], y]
    dimEnd = [p2[0], y]
    w1Start = [p1[0], p1[1] + gap * Math.sign(y - p1[1] || 1)]
    w1End = [p1[0], y]
    w2Start = [p2[0], p2[1] + gap * Math.sign(y - p2[1] || 1)]
    w2End = [p2[0], y]
    textAngle = 0
  } else {
    value = Math.abs(p2[1] - p1[1])
    const x = Math.max(p1[0], p2[0]) + off
    dimStart = [x, p1[1]]
    dimEnd = [x, p2[1]]
    w1Start = [p1[0] + gap * Math.sign(x - p1[0] || 1), p1[1]]
    w1End = [x, p1[1]]
    w2Start = [p2[0] + gap * Math.sign(x - p2[0] || 1), p2[1]]
    w2End = [x, p2[1]]
    textAngle = Math.PI / 2
  }

  return {
    id: dim.id,
    kind: dim.kind,
    p1,
    p2,
    w1Start,
    w1End,
    w2Start,
    w2End,
    dimStart,
    dimEnd,
    textAnchor: lerp(dimStart, dimEnd, 0.5),
    textAngle,
    text: dim.textOverride ?? formatMetres(value),
    value,
  }
}

/**
 * Angular dimension: the angle at p1 between the line p1→p2 and the horizontal.
 * Both refs typically point to the same wall's start and end.
 */
function resolveAngular(dim: Dimension, p1: Vec2, p2: Vec2): ResolvedDimension {
  const dx = p2[0] - p1[0]
  const dy = p2[1] - p1[1]
  const angle = Math.atan2(dy, dx)
  const degrees = (angle * 180) / Math.PI
  const value = Math.abs(degrees)

  const r = dim.offsetDistance || 0.5
  const mid = angle / 2
  const arcMid: Vec2 = [p1[0] + Math.cos(mid) * r, p1[1] + Math.sin(mid) * r]

  return {
    id: dim.id,
    kind: dim.kind,
    p1,
    p2,
    w1Start: p1,
    w1End: [p1[0] + r * 1.1, p1[1]],
    w2Start: p1,
    w2End: [p1[0] + Math.cos(angle) * r * 1.1, p1[1] + Math.sin(angle) * r * 1.1],
    dimStart: [p1[0] + r, p1[1]],
    dimEnd: [p1[0] + Math.cos(angle) * r, p1[1] + Math.sin(angle) * r],
    textAnchor: arcMid,
    textAngle: 0,
    text: dim.textOverride ?? formatDegrees(value),
    value,
  }
}

/**
 * Radial / diameter: p1 = arc centre, p2 = point on the arc. For diameter, the line goes
 * through the centre to the far side.
 */
function resolveRadial(
  dim: Dimension,
  p1: Vec2,
  p2: Vec2,
  isDiameter: boolean,
): ResolvedDimension {
  const r = dist(p1, p2)
  const value = isDiameter ? r * 2 : r

  const dx = p2[0] - p1[0]
  const dy = p2[1] - p1[1]
  const angle = Math.atan2(dy, dx)

  let dimStart: Vec2, dimEnd: Vec2
  if (isDiameter) {
    dimStart = [p1[0] - Math.cos(angle) * r, p1[1] - Math.sin(angle) * r]
    dimEnd = p2
  } else {
    dimStart = p1
    dimEnd = p2
  }

  const textAngle = normalizeAngle(angle)
  const readable =
    textAngle > Math.PI / 2 ? textAngle - Math.PI
    : textAngle < -Math.PI / 2 ? textAngle + Math.PI
    : textAngle

  const prefix = isDiameter ? 'Ø ' : 'R '
  return {
    id: dim.id,
    kind: dim.kind,
    p1,
    p2,
    w1Start: dimStart,
    w1End: dimStart,
    w2Start: dimEnd,
    w2End: dimEnd,
    dimStart,
    dimEnd,
    textAnchor: lerp(dimStart, dimEnd, 0.5),
    textAngle: readable,
    text: dim.textOverride ?? `${prefix}${formatMetres(value)}`,
    value,
  }
}

/**
 * Arc-length: measures the actual arc length of a wall baseline between its start and end.
 * Falls back to straight distance if the wall is not an arc.
 */
function resolveArcLength(
  scene: SceneGraph,
  dim: Dimension,
  p1: Vec2,
  p2: Vec2,
): ResolvedDimension {
  const wall = scene.walls.find((w) => w.id === dim.ref1.elementId)
  let value: number
  if (wall && wall.baseline.kind === 'arc') {
    value = baselineLength(wall.baseline)
  } else {
    value = dist(p1, p2)
  }

  // Draw it as an aligned dimension for the visual.
  return {
    ...resolveAligned(dim, p1, p2),
    kind: 'arc-length',
    text: dim.textOverride ?? formatMetres(value),
    value,
  }
}

// ---------------------------------------------------------------------------
// Batch resolve — what the viewport calls once per frame
// ---------------------------------------------------------------------------

export function resolveAllDimensions(scene: SceneGraph): ResolvedDimension[] {
  return scene.dimensions
    .map((d) => resolveDimension(scene, d))
    .filter((d): d is ResolvedDimension => d !== null)
}
