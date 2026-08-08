/**
 * "Join walls" / "Unjoin" (A9) — see DECISIONS.md D-026.
 *
 * A verb, not an automatic derive: the join is an explicit, stored `WallJoin` the user asks for,
 * so a corner is never silently rearranged, and unjoining is just deleting the object. It acts on
 * an existing selection exactly like the boolean verbs (D-019) and "Void to roof" (D-020) do.
 *
 * The join POINT is derived rather than picked: the walls the user selected already meet
 * somewhere, and asking them to click the corner they just selected would be a wasted step.
 */
import type { SceneGraph, Vec2, Wall, WallJoinStyle } from '../../../shared/types/scene'
import { resolveWall, distance, lineLineIntersection, direction } from '../../../shared/geometry/index'
import { validateWallJoin, JOIN_POINT_TOLERANCE } from '../../../shared/geometry/wallJoin'
import { addWallJoin, deleteElement } from '../scene/mutations'
import type { VerbResult } from './verbResult'

/**
 * Split a selection into "the walls to join", or explain why it does not describe that action.
 * Shared by the verb and the Modify panel's button-enablement, so the button appears exactly when
 * the verb would succeed — one rule, not two copies of it.
 */
export function selectionForJoin(
  scene: SceneGraph,
  ids: readonly string[],
): Wall[] | { error: string } {
  const walls = ids
    .map((id) => scene.walls.find((w) => w.id === id))
    .filter((w): w is Wall => w !== undefined)
  if (walls.length !== ids.length || walls.length < 2) {
    return { error: 'Select two or more walls to join them' }
  }
  const levelId = walls[0].levelId
  if (walls.some((w) => w.levelId !== levelId)) {
    return { error: 'Joined walls must all be on the same level' }
  }
  return walls
}

/**
 * Where the selected walls meet.
 *
 * Tried in order: a shared endpoint (the overwhelmingly common case, since drawing chains walls
 * end-to-end and the snap engine lands them exactly); then the intersection of the first two
 * non-parallel centerlines, which covers a stem meeting a wall mid-span and a pair that stops
 * short of actually touching.
 */
export function joinPointFor(scene: SceneGraph, walls: Wall[]): Vec2 | null {
  const lines = walls
    .map((w) => resolveWall(scene, w)?.centerline)
    .filter((c): c is { kind: 'line'; start: Vec2; end: Vec2 } => c?.kind === 'line')
  if (lines.length < 2) return null

  // A point shared by the most walls wins, so a T made of three walls picks the T, not an
  // arbitrary pair's crossing somewhere else.
  const candidates: Array<{ point: Vec2; hits: number }> = []
  const record = (point: Vec2) => {
    const existing = candidates.find((c) => distance(c.point, point) <= JOIN_POINT_TOLERANCE)
    if (existing) existing.hits += 1
    else candidates.push({ point, hits: 1 })
  }
  for (const line of lines) {
    for (const other of lines) {
      if (other === line) continue
      for (const p of [line.start, line.end]) {
        for (const q of [other.start, other.end]) {
          if (distance(p, q) <= JOIN_POINT_TOLERANCE) record(p)
        }
      }
    }
  }
  const best = candidates.sort((a, b) => b.hits - a.hits)[0]
  if (best) return best.point

  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i]
      const b = lines[j]
      const hit = lineLineIntersection(
        a.start,
        direction(a.start, a.end),
        b.start,
        direction(b.start, b.end),
      )
      if (hit) return hit
    }
  }
  return null
}

/**
 * Create the join.
 *
 * The whole selection is validated BEFORE anything is written, so a selection containing one
 * disqualifying wall refuses outright rather than leaving a half-joined mix — D-020's rule,
 * applied again.
 */
export function joinWalls(
  scene: SceneGraph,
  ids: readonly string[],
  style: WallJoinStyle = 'miter',
): VerbResult {
  const walls = selectionForJoin(scene, ids)
  if ('error' in walls) return walls

  const point = joinPointFor(scene, walls)
  if (!point) return { error: 'These walls do not meet anywhere — nothing to join' }

  const existing = scene.wallJoins.find(
    (j) =>
      distance(j.point, point) <= JOIN_POINT_TOLERANCE &&
      j.memberIds.length === walls.length &&
      walls.every((w) => j.memberIds.includes(w.id)),
  )
  if (existing) return { error: 'These walls are already joined here' }

  const { scene: next, id } = addWallJoin(scene, {
    levelId: walls[0].levelId,
    memberIds: walls.map((w) => w.id),
    point,
    style,
    throughId: null,
  })
  const problem = validateWallJoin(next, next.wallJoins.find((j) => j.id === id)!)
  if (problem) return { error: problem }

  return { scene: next, selectAfter: [id], label: 'Join walls' }
}

/**
 * Remove every join touching the selection. Deleting the relationship IS the unjoin — there is no
 * separate "disallow join" state, because the absence of a `WallJoin` already means exactly that.
 */
export function unjoinWalls(scene: SceneGraph, ids: readonly string[]): VerbResult {
  const doomed = scene.wallJoins.filter(
    (j) => ids.includes(j.id) || j.memberIds.some((m) => ids.includes(m)),
  )
  if (doomed.length === 0) return { error: 'Nothing in the selection is joined' }

  let next = scene
  for (const j of doomed) next = deleteElement(next, j.id)
  return {
    scene: next,
    selectAfter: ids.filter((id) => next.walls.some((w) => w.id === id)),
    label: doomed.length === 1 ? 'Unjoin walls' : `Remove ${doomed.length} wall joins`,
  }
}
