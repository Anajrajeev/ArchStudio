/**
 * Geometry for the modify verbs — trim, extend, split, offset (PHASE1B-SCOPE.md D3).
 *
 * The convention that makes trim predictable is **"click the side you keep"**: the user's pick point
 * selects the surviving portion, rather than the program guessing from click order. Everything here
 * takes that pick point explicitly.
 *
 * Scope, stated rather than hidden: trim and extend operate on **straight** baselines. Arc-arc and
 * arc-line trimming has genuinely ambiguous answers (two intersections, four resulting pieces) and
 * needs a UI to disambiguate; until that exists these functions REFUSE on an arc rather than pick an
 * intersection arbitrarily. `splitBaseline` and offsetting handle arcs fully.
 *
 * Pure math. No three.js, no scene graph.
 */

import type { Baseline, Vec2 } from '../types/scene'
import { arcInfo, baselineLength, baselinePointAt, distance, lerp2 } from './index'

/** Why a modify verb could not run. Surfaced to the user verbatim. */
export type ModifyError = { error: string }

export function isModifyError<T>(r: T | ModifyError): r is ModifyError {
  return typeof r === 'object' && r !== null && 'error' in r
}

/**
 * Intersection of two INFINITE lines through the given point pairs. Null when parallel.
 *
 * Infinite rather than segment-bounded on purpose: trim and extend both need the intersection of
 * the *supporting lines*, which is exactly what lets you extend a wall to meet one it does not
 * currently touch.
 */
export function infiniteLineIntersection(
  a1: Vec2,
  a2: Vec2,
  b1: Vec2,
  b2: Vec2,
): Vec2 | null {
  const d1: Vec2 = [a2[0] - a1[0], a2[1] - a1[1]]
  const d2: Vec2 = [b2[0] - b1[0], b2[1] - b1[1]]
  const denom = d1[0] * d2[1] - d1[1] * d2[0]
  if (Math.abs(denom) < 1e-12) return null
  const t = ((b1[0] - a1[0]) * d2[1] - (b1[1] - a1[1]) * d2[0]) / denom
  return [a1[0] + d1[0] * t, a1[1] + d1[1] * t]
}

/** Parameter of `p` along the segment a→b, unclamped (so <0 or >1 means "off the end"). */
export function parameterAlong(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-18) return 0
  return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
}

/**
 * Trim `target` against `cutter`, keeping the side the user clicked.
 *
 * The intersection must fall *within* the target — trimming a wall at a point it does not reach is
 * an extend, and conflating the two is how these tools become unpredictable.
 */
export function trimBaseline(
  target: Baseline,
  cutter: Baseline,
  keepPoint: Vec2,
): Baseline | ModifyError {
  if (target.kind !== 'line') return { error: 'Trim works on straight walls only' }
  if (cutter.kind !== 'line') return { error: 'The cutting edge must be a straight wall' }

  const x = infiniteLineIntersection(target.start, target.end, cutter.start, cutter.end)
  if (!x) return { error: 'Those walls are parallel — there is nothing to trim to' }

  const t = parameterAlong(x, target.start, target.end)
  if (t <= 1e-6 || t >= 1 - 1e-6) {
    return { error: 'The cutting edge does not cross this wall — use Extend instead' }
  }

  // Keep whichever half contains the pick point.
  const keepT = parameterAlong(keepPoint, target.start, target.end)
  return keepT < t
    ? { kind: 'line', start: target.start, end: x }
    : { kind: 'line', start: x, end: target.end }
}

/**
 * Extend `target` to meet `cutter`'s supporting line. The end nearer the pick point is the one that
 * moves, which is the AutoCAD behaviour and the only one that feels aimed rather than random.
 */
export function extendBaseline(
  target: Baseline,
  cutter: Baseline,
  pickPoint: Vec2,
): Baseline | ModifyError {
  if (target.kind !== 'line') return { error: 'Extend works on straight walls only' }
  if (cutter.kind !== 'line') return { error: 'The boundary must be a straight wall' }

  const x = infiniteLineIntersection(target.start, target.end, cutter.start, cutter.end)
  if (!x) return { error: 'Those walls are parallel — there is nothing to extend to' }

  const t = parameterAlong(x, target.start, target.end)
  if (t > 1e-6 && t < 1 - 1e-6) {
    return { error: 'That boundary already crosses this wall — use Trim instead' }
  }

  // Move the end nearer the pick, but only towards the intersection: extending the start when the
  // intersection lies beyond the end would flip the wall.
  const nearStart = distance(pickPoint, target.start) < distance(pickPoint, target.end)
  if (t < 0 && !nearStart) return { error: 'That end cannot reach the boundary' }
  if (t > 1 && nearStart) return { error: 'That end cannot reach the boundary' }

  return nearStart
    ? { kind: 'line', start: x, end: target.end }
    : { kind: 'line', start: target.start, end: x }
}

/**
 * Split a baseline at a fraction of its length. Arcs split correctly: each piece keeps the same
 * centre and radius, and its bulge is the tangent of a quarter of ITS share of the sweep.
 *
 * Returns null when the split point is at (or within a hair of) either end, where one piece would be
 * degenerate.
 */
export function splitBaseline(b: Baseline, t: number): [Baseline, Baseline] | null {
  if (!(t > 1e-6 && t < 1 - 1e-6)) return null

  if (b.kind === 'line') {
    const mid = lerp2(b.start, b.end, t)
    return [
      { kind: 'line', start: b.start, end: mid },
      { kind: 'line', start: mid, end: b.end },
    ]
  }

  const info = arcInfo(b.start, b.end, b.bulge)
  if (!info) {
    const mid = lerp2(b.start, b.end, t)
    return [
      { kind: 'line', start: b.start, end: mid },
      { kind: 'line', start: mid, end: b.end },
    ]
  }

  const sweep = 4 * Math.atan(b.bulge)
  const mid = baselinePointAt(b, baselineLength(b) * t).point
  return [
    { kind: 'arc', start: b.start, end: mid, bulge: Math.tan((sweep * t) / 4) },
    { kind: 'arc', start: mid, end: b.end, bulge: Math.tan((sweep * (1 - t)) / 4) },
  ]
}

/**
 * Fraction along a baseline nearest to a point. Used to turn a click into a split station.
 *
 * Walks the tessellated polyline, so arcs work without a closed-form inverse.
 */
export function nearestFraction(b: Baseline, p: Vec2): number {
  const total = baselineLength(b)
  if (total < 1e-9) return 0
  const steps = 256
  let bestT = 0
  let bestD = Infinity
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const q = baselinePointAt(b, total * t).point
    const d = distance(q, p)
    if (d < bestD) {
      bestD = d
      bestT = t
    }
  }
  return bestT
}
