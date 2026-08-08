/**
 * Wall joins — corner and T/X cleanup (A9). See DECISIONS.md D-026.
 *
 * A `WallJoin` stores only WHICH walls meet and HOW; every trim distance and mitre angle is
 * derived here from the members' current baselines, so moving a joined wall keeps the corner
 * clean instead of stranding a stale offset. Nothing in this file mutates a wall — the output is a
 * per-wall `WallEndAdjust` that `wallSolidBoxes` applies at decomposition time, which is what keeps
 * openings (measured from the untouched baseline) exactly where the user put them.
 *
 * Scope, and the reasoning for it, is in D-026. In short: assembly-level joins only (never
 * per-layer — D-009 declined to model a wall "core", and per-layer wrapping needs exactly that),
 * straight walls only, and every ambiguous configuration refuses with a message rather than
 * guessing.
 */

import {
  type SceneGraph,
  type Wall,
  type WallJoin,
  type Vec2,
} from '../types/scene'
import {
  add,
  direction,
  distance,
  perpendicular,
  resolveWall,
  scale,
  type ResolvedWall,
  type WallEndAdjust,
} from './index'

/** How close a wall end must be to the join point to count as terminating there. */
export const JOIN_POINT_TOLERANCE = 0.01
/** Thicknesses within this of each other mitre; anything else butts (D-026). */
export const THICKNESS_TOLERANCE = 0.001
/**
 * A butting wall must cross the through-wall's face at a workable angle. Below this the crossing
 * distance explodes towards infinity and the "trim to the face" answer stops being meaningful.
 */
const MIN_CROSSING_SINE = Math.sin((10 * Math.PI) / 180)

export interface WallJoinError {
  error: string
}

export function isWallJoinError(x: unknown): x is WallJoinError {
  return typeof x === 'object' && x !== null && 'error' in x
}

const NO_ADJUST: WallEndAdjust = { startExtend: 0, endExtend: 0, startSkew: 0, endSkew: 0 }

/** Where the join point falls on one member. */
type Role = 'start' | 'end' | 'through'

interface Member {
  wall: Wall
  resolved: ResolvedWall
  role: Role
  /** Unit direction of the centerline, start → end. */
  dir: Vec2
  /** Centerline start and end. */
  a: Vec2
  b: Vec2
  thickness: number
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Every reason a join cannot be resolved, or `null` when it can. Used both by `validateWall`-style
 * surfacing in the panel and by the verb, so the button appears exactly when the verb would work.
 */
export function validateWallJoin(scene: SceneGraph, join: WallJoin): string | null {
  const ids = [...new Set(join.memberIds)]
  if (ids.length !== join.memberIds.length) return 'A wall cannot be joined to itself.'
  if (ids.length < 2) return 'A join needs at least two walls.'
  if (ids.length > 4) {
    return 'More than four walls meet here — there is no unambiguous wall to run through.'
  }

  const members: Member[] = []
  for (const id of ids) {
    const wall = scene.walls.find((w) => w.id === id)
    if (!wall) return 'One of the joined walls no longer exists.'
    if (wall.levelId !== join.levelId) return 'Joined walls must all be on the same level.'
    if (wall.baseline.kind === 'arc') {
      return 'Curved walls cannot be joined: the end face of an arc is not a plane.'
    }
    const resolved = resolveWall(scene, wall)
    if (!resolved) return 'One of the joined walls has no resolvable type or level.'
    const member = classify(wall, resolved, join.point)
    if (!member) return 'A joined wall does not reach the join point.'
    members.push(member)
  }

  // A join between walls that never share an elevation band has nothing to clean up.
  const lowest = Math.max(...members.map((m) => m.resolved.baseElevation))
  const highest = Math.min(...members.map((m) => m.resolved.topElevation))
  if (highest - lowest < 1e-6) {
    return 'The joined walls do not overlap vertically, so there is nothing to clean up.'
  }

  const shape = classifyJoin(members)
  return isWallJoinError(shape) ? shape.error : null
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Every wall on `levelId` that a join adjusts, keyed by wall id. Walls with no join are absent —
 * callers pass `undefined` to `wallSolidBoxes` for those, which is the unchanged path.
 *
 * A wall joined at BOTH ends accumulates both adjustments, since the two ends are independent.
 * An invalid join contributes nothing rather than throwing: `validateWallJoin` is where the reason
 * surfaces, exactly as `resolveWall` never throws for an unresolvable roof ramp.
 */
export function resolveWallJoins(
  scene: SceneGraph,
  levelId: string,
): Map<string, WallEndAdjust> {
  const out = new Map<string, WallEndAdjust>()
  for (const join of scene.wallJoins) {
    if (join.levelId !== levelId) continue
    const adjusts = resolveJoin(scene, join)
    if (isWallJoinError(adjusts)) continue
    for (const [id, adj] of adjusts) {
      const prev = out.get(id) ?? NO_ADJUST
      out.set(id, {
        startExtend: prev.startExtend + adj.startExtend,
        endExtend: prev.endExtend + adj.endExtend,
        startSkew: adj.startSkew !== 0 ? adj.startSkew : prev.startSkew,
        endSkew: adj.endSkew !== 0 ? adj.endSkew : prev.endSkew,
      })
    }
  }
  return out
}

/** One join's adjustments, or the reason it cannot be resolved. */
export function resolveJoin(
  scene: SceneGraph,
  join: WallJoin,
): Map<string, WallEndAdjust> | WallJoinError {
  const members: Member[] = []
  for (const id of [...new Set(join.memberIds)]) {
    const wall = scene.walls.find((w) => w.id === id)
    if (!wall || wall.levelId !== join.levelId || wall.baseline.kind === 'arc') {
      return { error: 'Join has an unusable member.' }
    }
    const resolved = resolveWall(scene, wall)
    if (!resolved) return { error: 'Join has an unresolvable member.' }
    const member = classify(wall, resolved, join.point)
    if (!member) return { error: 'A joined wall does not reach the join point.' }
    members.push(member)
  }

  const shape = classifyJoin(members)
  if (isWallJoinError(shape)) return shape

  const out = new Map<string, WallEndAdjust>()
  if (shape.kind === 'cross') return out // Two walls passing through each other: nothing to trim.

  if (shape.kind === 'corner') {
    const [p, q] = shape.pair
    // Equal thickness mitres; anything else butts, because one skew angle per end cannot close a
    // corner whose two pairs of face lines meet at different points (D-026).
    const mitreable =
      join.style === 'miter' && Math.abs(p.thickness - q.thickness) <= THICKNESS_TOLERANCE
    if (mitreable) {
      const mitre = mitreCorner(p, q, join.point)
      if (isWallJoinError(mitre)) return mitre
      out.set(p.wall.id, mitre.get(p.wall.id)!)
      out.set(q.wall.id, mitre.get(q.wall.id)!)
      return out
    }
    // Butt: the through wall (thicker, or the explicit override) runs to the OTHER wall's far
    // face so the corner is filled; the other trims back to the through wall's near face.
    const through = pickThrough(join, p, q)
    const butting = through === p ? q : p
    const a = extendToFace(through, butting, 'far')
    const b = extendToFace(butting, through, 'near')
    if (isWallJoinError(a)) return a
    if (isWallJoinError(b)) return b
    out.set(through.wall.id, a)
    out.set(butting.wall.id, b)
    return out
  }

  // T / X: every terminating member butts into the through run; the through run is unchanged
  // except for a collinear PAIR, which extends to meet at the point.
  for (const t of shape.through) {
    if (t.role !== 'through') {
      const adj = extendToPoint(t, join.point)
      out.set(t.wall.id, adj)
    }
  }
  for (const m of shape.terminating) {
    const adj = extendToFace(m, shape.through[0], 'near')
    if (isWallJoinError(adj)) return adj
    out.set(m.wall.id, adj)
  }
  return out
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Where the join point falls on one wall, or `null` if it does not fall on it at all.
 *
 * Tested against the wall's infinite LINE rather than just its two endpoints, so a wall that stops
 * short of (or overshoots) the junction still classifies — extending it to meet is precisely what
 * a join is for. The reach is bounded to one wall-length past either end: without a bound, any two
 * walls whose lines happen to cross somewhere in the distance would "meet", and the resulting trim
 * would be metres long.
 */
function classify(wall: Wall, resolved: ResolvedWall, point: Vec2): Member | null {
  const c = resolved.centerline
  if (c.kind !== 'line') return null
  const a = c.start
  const b = c.end
  const length = distance(a, b)
  if (length < 1e-9) return null
  const dir = direction(a, b)
  const thickness = resolved.thickness

  const n = perpendicular(dir)
  const offAxis = Math.abs((point[0] - a[0]) * n[0] + (point[1] - a[1]) * n[1])
  if (offAxis > JOIN_POINT_TOLERANCE) return null

  const t = (point[0] - a[0]) * dir[0] + (point[1] - a[1]) * dir[1]
  if (t < -length || t > 2 * length) return null

  if (t <= JOIN_POINT_TOLERANCE) return { wall, resolved, role: 'start', dir, a, b, thickness }
  if (t >= length - JOIN_POINT_TOLERANCE) {
    return { wall, resolved, role: 'end', dir, a, b, thickness }
  }
  // Strictly interior: the wall passes THROUGH the junction.
  return { wall, resolved, role: 'through', dir, a, b, thickness }
}

type JoinShape =
  | { kind: 'corner'; pair: [Member, Member] }
  | { kind: 'cross' }
  | { kind: 'tee'; through: Member[]; terminating: Member[] }

/**
 * Which of the four configurations D-026 solves this is, or the refusal.
 *
 * The realistic T comes in two flavours and both are handled: one wall passing THROUGH the point
 * (drawn as a single run), and two collinear walls terminating AT it (the same run after a Split).
 */
function classifyJoin(members: Member[]): JoinShape | WallJoinError {
  const through = members.filter((m) => m.role === 'through')
  const terminating = members.filter((m) => m.role !== 'through')

  if (through.length >= 2) {
    if (terminating.length === 0) return { kind: 'cross' }
    return {
      error: 'Two walls already cross here, so there is no single wall to butt the others into.',
    }
  }

  if (through.length === 1) {
    if (terminating.length === 0) return { kind: 'cross' }
    return { kind: 'tee', through, terminating }
  }

  if (terminating.length === 2) {
    if (areCollinear(terminating[0], terminating[1])) {
      return { error: 'These walls are collinear — there is no corner to clean up.' }
    }
    return { kind: 'corner', pair: [terminating[0], terminating[1]] }
  }

  // 3+ walls all terminating: only workable when exactly two of them continue one straight run,
  // which is what a T looks like after the through wall has been split.
  const pair = collinearPair(terminating)
  if (!pair) {
    return {
      error: `${terminating.length} walls end here with no straight run among them — there is no unambiguous wall to run through.`,
    }
  }
  if (Math.abs(pair[0].thickness - pair[1].thickness) > THICKNESS_TOLERANCE) {
    return { error: 'The two walls forming the straight run have different thicknesses.' }
  }
  const rest = terminating.filter((m) => m !== pair[0] && m !== pair[1])
  return { kind: 'tee', through: pair, terminating: rest }
}

function areCollinear(p: Member, q: Member): boolean {
  const cross = p.dir[0] * q.dir[1] - p.dir[1] * q.dir[0]
  return Math.abs(cross) < 1e-6
}

function collinearPair(members: Member[]): [Member, Member] | null {
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      if (areCollinear(members[i], members[j])) return [members[i], members[j]]
    }
  }
  return null
}

/** The explicit `throughId` when it names a member, else the thicker wall (ties → the first). */
function pickThrough(join: WallJoin, p: Member, q: Member): Member {
  if (join.throughId === p.wall.id) return p
  if (join.throughId === q.wall.id) return q
  return q.thickness > p.thickness + THICKNESS_TOLERANCE ? q : p
}

// ---------------------------------------------------------------------------
// The two geometric primitives
// ---------------------------------------------------------------------------

/** Unit vector pointing from the wall's body OUT towards the join point. */
function outwardDir(m: Member): Vec2 {
  return m.role === 'start' ? scale(m.dir, -1) : m.dir
}

/** Turn a signed distance along `outwardDir` into the right end's extension. */
function asAdjust(m: Member, k: number, skew = 0): WallEndAdjust {
  return m.role === 'start'
    ? { startExtend: k, endExtend: 0, startSkew: skew, endSkew: 0 }
    : { startExtend: 0, endExtend: k, startSkew: 0, endSkew: skew }
}

/** Move a terminating end onto the join point exactly. */
function extendToPoint(m: Member, point: Vec2): WallEndAdjust {
  const e = m.role === 'start' ? m.a : m.b
  const d = outwardDir(m)
  return asAdjust(m, (point[0] - e[0]) * d[0] + (point[1] - e[1]) * d[1])
}

/**
 * A true mitre: both walls keep their nominal end at the join point, and both end faces are cut
 * along the SAME line — the bisector of the two directions pointing away from the point.
 *
 * The skew angle falls out in closed form. `Box3D.endSkew` defines the face as the locus
 * `n + tan(σ)·dir` (n being the wall's left normal, which is its local +Z), so requiring that to
 * be parallel to the mitre line `m` gives `tan(σ) = (m·dir) / (m·n)` directly — one formula that
 * covers every turn angle and both ends with no case analysis.
 */
function mitreCorner(
  p: Member,
  q: Member,
  point: Vec2,
): Map<string, WallEndAdjust> | WallJoinError {
  const dp = outwardDir(p)
  const dq = outwardDir(q)
  const sum = add(dp, dq)
  const len = Math.hypot(sum[0], sum[1])
  if (len < 1e-6) {
    return { error: 'These walls are collinear — there is no corner to mitre.' }
  }
  const mitre: Vec2 = [sum[0] / len, sum[1] / len]

  const out = new Map<string, WallEndAdjust>()
  for (const m of [p, q]) {
    const n = perpendicular(m.dir)
    const denom = mitre[0] * n[0] + mitre[1] * n[1]
    if (Math.abs(denom) < 1e-9) {
      return { error: 'The corner is too sharp to mitre.' }
    }
    // `atan`, not `atan2`: σ is a face SLANT in (-90°, 90°), and the mitre line's sign is
    // arbitrary (it is a line, not a ray) — atan2 would return a second-quadrant angle with the
    // same tangent, which works but reads as nonsense if it is ever shown to a user.
    const sigma = Math.atan((mitre[0] * m.dir[0] + mitre[1] * m.dir[1]) / denom)
    // Land the nominal end exactly on the join point first; the skew then works from there.
    const base = extendToPoint(m, point)
    out.set(
      m.wall.id,
      m.role === 'start'
        ? { ...base, startSkew: sigma }
        : { ...base, endSkew: sigma },
    )
  }
  return out
}

/**
 * Move `m`'s end to where its centerline crosses one of `other`'s two faces.
 *
 * `near` stops the wall at the face it arrives at — a butting wall must not push into the wall it
 * meets. `far` carries it across to the opposite face — how the through wall of an L fills the
 * corner. Both are the same line-plane crossing with the target offset's sign flipped, so there is
 * one implementation and no chance of the two drifting apart.
 */
function extendToFace(
  m: Member,
  other: Member,
  which: 'near' | 'far',
): WallEndAdjust | WallJoinError {
  const e = m.role === 'start' ? m.a : m.b
  const d = outwardDir(m)
  const n = perpendicular(other.dir)
  const denom = d[0] * n[0] + d[1] * n[1]
  if (Math.abs(denom) < MIN_CROSSING_SINE) {
    return {
      error: 'These walls meet at too shallow an angle for a butt join to have a defined face.',
    }
  }

  // Which side of the other wall this one's BODY lies on. Measured from the far end, not the end
  // at the junction, since that end is by definition sitting on the other wall's centerline.
  const body = m.role === 'start' ? m.b : m.a
  const side = Math.sign((body[0] - other.a[0]) * n[0] + (body[1] - other.a[1]) * n[1])
  if (side === 0) {
    return { error: 'A joined wall lies along the centerline of the wall it meets.' }
  }

  const target = (which === 'near' ? side : -side) * (other.thickness / 2)
  const current = (e[0] - other.a[0]) * n[0] + (e[1] - other.a[1]) * n[1]
  return asAdjust(m, (target - current) / denom)
}
