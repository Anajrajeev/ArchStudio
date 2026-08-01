/**
 * 2D affine transforms of scene coordinates — the arithmetic behind copy, array, mirror and rotate
 * (PHASE1B-SCOPE.md D4). Phase 1A had move only.
 *
 * One transform type covers all of them, which matters for correctness as much as for brevity: the
 * two things that are easy to get wrong — an arc's bulge sign under a mirror, and an element's
 * stored `rotation` scalar — then have exactly one place to be handled rather than one per verb.
 *
 * Pure math. No three.js, no store.
 */

import type { Baseline, Vec2 } from '../types/scene'

/**
 * `p' = M·p + t`, with M row-major as `[a, b, c, d]`:
 *   x' = a·x + b·y + tx
 *   y' = c·x + d·y + ty
 */
export interface Transform2D {
  m: [number, number, number, number]
  t: Vec2
}

export const IDENTITY: Transform2D = { m: [1, 0, 0, 1], t: [0, 0] }

export function translation(dx: number, dy: number): Transform2D {
  return { m: [1, 0, 0, 1], t: [dx, dy] }
}

/** Rotation by `degrees` counter-clockwise about `center`. */
export function rotation(degrees: number, center: Vec2 = [0, 0]): Transform2D {
  const r = (degrees * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return {
    m: [cos, -sin, sin, cos],
    // Rotate about the origin, then put `center` back where it was.
    t: [
      center[0] - (cos * center[0] - sin * center[1]),
      center[1] - (sin * center[0] + cos * center[1]),
    ],
  }
}

/**
 * Reflection across the line through `a` and `b`. A degenerate line (a == b) returns the identity
 * rather than a matrix full of NaN — a mirror axis defined by one point is a user error, not a
 * reason to corrupt the scene.
 */
export function mirror(a: Vec2, b: Vec2): Transform2D {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-18) return IDENTITY

  // Reflection about a line through the origin with direction (dx, dy), normalized.
  const ux = dx / Math.sqrt(len2)
  const uy = dy / Math.sqrt(len2)
  const a11 = ux * ux - uy * uy
  const a12 = 2 * ux * uy
  const m: [number, number, number, number] = [a11, a12, a12, -a11]
  // Translate the axis to the origin, reflect, translate back.
  return {
    m,
    t: [a[0] - (a11 * a[0] + a12 * a[1]), a[1] - (a12 * a[0] - a11 * a[1])],
  }
}

/** `second ∘ first` — apply `first`, then `second`. */
export function compose(second: Transform2D, first: Transform2D): Transform2D {
  const [a1, b1, c1, d1] = first.m
  const [a2, b2, c2, d2] = second.m
  return {
    m: [
      a2 * a1 + b2 * c1,
      a2 * b1 + b2 * d1,
      c2 * a1 + d2 * c1,
      c2 * b1 + d2 * d1,
    ],
    t: [
      a2 * first.t[0] + b2 * first.t[1] + second.t[0],
      c2 * first.t[0] + d2 * first.t[1] + second.t[1],
    ],
  }
}

export function applyTransform(xf: Transform2D, p: Vec2): Vec2 {
  const [a, b, c, d] = xf.m
  return [a * p[0] + b * p[1] + xf.t[0], c * p[0] + d * p[1] + xf.t[1]]
}

/** Transform a DIRECTION — the translation does not apply. */
export function transformDirection(xf: Transform2D, dir: Vec2): Vec2 {
  const [a, b, c, d] = xf.m
  return [a * dir[0] + b * dir[1], c * dir[0] + d * dir[1]]
}

export function determinant(xf: Transform2D): number {
  const [a, b, c, d] = xf.m
  return a * d - b * c
}

/**
 * True when the transform reverses orientation, i.e. it is a mirror. Two things depend on this:
 * an arc baseline's bulge sign (it encodes sweep direction) and the sign of a rotation scalar.
 */
export function isReflection(xf: Transform2D): boolean {
  return determinant(xf) < 0
}

/**
 * Transform a baseline. Under a reflection an arc's bulge NEGATES, because bulge is the tangent of
 * a quarter of the *signed* swept angle — mirroring an arc without flipping it leaves the wall
 * bowing the wrong way, which is the classic mirror bug.
 */
export function transformBaseline(b: Baseline, xf: Transform2D): Baseline {
  const start = applyTransform(xf, b.start)
  const end = applyTransform(xf, b.end)
  if (b.kind === 'line') return { kind: 'line', start, end }
  return { kind: 'arc', start, end, bulge: isReflection(xf) ? -b.bulge : b.bulge }
}

/**
 * Transform an element's stored rotation, in degrees.
 *
 * Rather than trying to decompose the matrix, this maps the element's own axis direction through
 * the transform and reads the angle back. That is correct for rotations and reflections alike, and
 * it cannot disagree with how the renderers interpret the scalar (a rotation of `r` means a scene-2D
 * axis at angle `r`; see `rotationYFor`).
 */
export function transformRotation(degrees: number, xf: Transform2D): number {
  const r = (degrees * Math.PI) / 180
  const dir = transformDirection(xf, [Math.cos(r), Math.sin(r)])
  if (Math.hypot(dir[0], dir[1]) < 1e-12) return degrees
  return (Math.atan2(dir[1], dir[0]) * 180) / Math.PI
}

/**
 * The transform for step `i` of a linear array: a repeated translation.
 */
export function linearStep(delta: Vec2, i: number): Transform2D {
  return translation(delta[0] * i, delta[1] * i)
}

/**
 * The angle between successive items of a radial array, given the angle the whole ring spans and
 * the number of COPIES (the original is item 0, so there are `copies + 1` items).
 *
 * A full circle divides by the item count, so the last copy does not land on the original: 5 copies
 * around 360° is 6 items 60° apart. A partial fan divides by the copy count instead, so the ends of
 * the fan sit exactly on the requested bounds: 3 copies across 90° gives 0°, 30°, 60°, 90°.
 */
export function radialStepAngle(totalAngle: number, copies: number): number {
  if (copies < 1) return 0
  const full = Math.abs(Math.abs(totalAngle) - 360) < 1e-9
  return totalAngle / (full ? copies + 1 : copies)
}

/**
 * The transform for step `i` of a radial array. Copies are rotated with the ring (the columns of a
 * rotunda face outward), which is the near-universal default; a caller wanting fixed orientation
 * composes a counter-rotation itself.
 */
export function radialStep(center: Vec2, stepAngle: number, i: number): Transform2D {
  return rotation(stepAngle * i, center)
}
