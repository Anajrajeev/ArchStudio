/**
 * The transform verbs — copy, linear array, radial array, mirror, rotate, move (D4).
 *
 * Each one is a thin composition of `duplicateElement` + `transformElement`, so they cannot diverge
 * in how they treat an arc's bulge, a column's rotation, or a wall's openings.
 *
 * Every verb takes and returns a plain scene, and reports the ids it created so the caller can
 * select them — the standard CAD courtesy of leaving the *copies* selected after an array, since
 * that is what you are about to adjust.
 *
 * All of them REFUSE rather than degrade: a count below 1, a zero-length mirror axis or a
 * zero-distance array produce an error string the UI can show, never silent no-ops or duplicate
 * elements stacked exactly on top of the originals.
 */
import type { SceneGraph, Vec2 } from '../../../shared/types/scene'
import {
  compose,
  linearStep,
  mirror,
  radialStep,
  radialStepAngle,
  rotation,
  translation,
  type Transform2D,
} from '../../../shared/geometry/transform'
import { duplicateElement, transformElement } from '../scene/mutations'
import type { VerbOutcome, VerbResult } from './verbResult'

/** Aliases of the shared verb contract; see `verbResult.ts`. */
export type TransformOutcome = VerbOutcome
export type TransformResult = VerbResult

/** The most copies one command may produce. A typo in a count field should not hang the browser. */
export const MAX_ARRAY_COUNT = 500

/** Below this, a "copy" would land on top of its original and look like nothing happened. */
const MIN_OFFSET = 1e-4

function copyWith(
  scene: SceneGraph,
  ids: string[],
  xf: Transform2D,
): { scene: SceneGraph; newIds: string[] } {
  let next = scene
  const newIds: string[] = []
  for (const id of ids) {
    const dup = duplicateElement(next, id)
    // Hosted elements (openings, fillings) cannot be copied alone; they come with their wall.
    if (!dup) continue
    next = transformElement(dup.scene, dup.id, xf)
    newIds.push(dup.id)
  }
  return { scene: next, newIds }
}

function transformInPlace(scene: SceneGraph, ids: string[], xf: Transform2D): SceneGraph {
  return ids.reduce((sc, id) => transformElement(sc, id, xf), scene)
}

/** Nothing selected is a user error worth naming, not a silent no-op. */
function requireSelection(ids: string[]): string | null {
  return ids.length === 0 ? 'Select something first' : null
}

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

export function moveBy(scene: SceneGraph, ids: string[], delta: Vec2): TransformResult {
  const err = requireSelection(ids)
  if (err) return { error: err }
  if (Math.hypot(delta[0], delta[1]) < MIN_OFFSET) return { error: 'Move distance is zero' }
  return {
    scene: transformInPlace(scene, ids, translation(delta[0], delta[1])),
    selectAfter: ids,
    label: 'Move',
  }
}

export function copyBy(scene: SceneGraph, ids: string[], delta: Vec2): TransformResult {
  const err = requireSelection(ids)
  if (err) return { error: err }
  if (Math.hypot(delta[0], delta[1]) < MIN_OFFSET) {
    return { error: 'Copy distance is zero — the copy would sit on the original' }
  }
  const r = copyWith(scene, ids, translation(delta[0], delta[1]))
  if (r.newIds.length === 0) return { error: 'Nothing in the selection can be copied on its own' }
  return { scene: r.scene, selectAfter: r.newIds, label: 'Copy' }
}

/**
 * `count` is the number of COPIES, so an array of 3 leaves 4 elements. This is the Revit/AutoCAD
 * reading of the field and the one that makes "array 3 more of these" work as spoken.
 */
export function linearArray(
  scene: SceneGraph,
  ids: string[],
  delta: Vec2,
  count: number,
): TransformResult {
  const err = requireSelection(ids)
  if (err) return { error: err }
  if (!Number.isFinite(count) || count < 1) return { error: 'Array count must be at least 1' }
  if (count > MAX_ARRAY_COUNT) return { error: `Array count is limited to ${MAX_ARRAY_COUNT}` }
  if (Math.hypot(delta[0], delta[1]) < MIN_OFFSET) {
    return { error: 'Array spacing is zero — every copy would land on the original' }
  }

  let next = scene
  const newIds: string[] = []
  for (let i = 1; i <= count; i++) {
    const r = copyWith(next, ids, linearStep(delta, i))
    next = r.scene
    newIds.push(...r.newIds)
  }
  if (newIds.length === 0) return { error: 'Nothing in the selection can be copied on its own' }
  return { scene: next, selectAfter: newIds, label: `Array ${count}` }
}

/**
 * Radial array. `totalAngle` is the angle the whole ring spans; see `radialStepAngle` for how that
 * is divided (a full circle must not put the last copy on top of the original, a partial fan must
 * land its ends exactly on the requested bounds).
 */
export function radialArray(
  scene: SceneGraph,
  ids: string[],
  center: Vec2,
  totalAngle: number,
  count: number,
): TransformResult {
  const err = requireSelection(ids)
  if (err) return { error: err }
  if (!Number.isFinite(count) || count < 1) return { error: 'Array count must be at least 1' }
  if (count > MAX_ARRAY_COUNT) return { error: `Array count is limited to ${MAX_ARRAY_COUNT}` }
  if (!Number.isFinite(totalAngle) || Math.abs(totalAngle) < 1e-6) {
    return { error: 'Array angle is zero' }
  }

  const step = radialStepAngle(totalAngle, count)

  let next = scene
  const newIds: string[] = []
  for (let i = 1; i <= count; i++) {
    const r = copyWith(next, ids, radialStep(center, step, i))
    next = r.scene
    newIds.push(...r.newIds)
  }
  if (newIds.length === 0) return { error: 'Nothing in the selection can be copied on its own' }
  return { scene: next, selectAfter: newIds, label: `Radial array ${count}` }
}

/**
 * Mirror across the line through `a` and `b`. `keepOriginal` is the difference between AutoCAD's
 * MIRROR (which asks "erase source objects?") and a mirrored copy; both are wanted often enough
 * that neither should be the only option.
 */
export function mirrorAcross(
  scene: SceneGraph,
  ids: string[],
  a: Vec2,
  b: Vec2,
  keepOriginal: boolean,
): TransformResult {
  const err = requireSelection(ids)
  if (err) return { error: err }
  if (Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_OFFSET) {
    return { error: 'Mirror axis needs two distinct points' }
  }
  const xf = mirror(a, b)

  if (!keepOriginal) {
    return { scene: transformInPlace(scene, ids, xf), selectAfter: ids, label: 'Mirror' }
  }
  const r = copyWith(scene, ids, xf)
  if (r.newIds.length === 0) return { error: 'Nothing in the selection can be mirrored on its own' }
  return { scene: r.scene, selectAfter: r.newIds, label: 'Mirror copy' }
}

export function rotateBy(
  scene: SceneGraph,
  ids: string[],
  center: Vec2,
  degrees: number,
  keepOriginal: boolean,
): TransformResult {
  const err = requireSelection(ids)
  if (err) return { error: err }
  if (!Number.isFinite(degrees) || Math.abs(degrees % 360) < 1e-9) {
    return { error: 'Rotation angle is zero' }
  }
  const xf = rotation(degrees, center)

  if (!keepOriginal) {
    return { scene: transformInPlace(scene, ids, xf), selectAfter: ids, label: 'Rotate' }
  }
  const r = copyWith(scene, ids, xf)
  if (r.newIds.length === 0) return { error: 'Nothing in the selection can be rotated on its own' }
  return { scene: r.scene, selectAfter: r.newIds, label: 'Rotate copy' }
}

/**
 * Rotate *and* move in one step, for the callers that have both (a dragged gizmo, or an agent tool
 * in Phase 3). Exposed so those callers do not compose two undo entries for one gesture.
 */
export function rotateAndMove(
  scene: SceneGraph,
  ids: string[],
  center: Vec2,
  degrees: number,
  delta: Vec2,
): TransformResult {
  const err = requireSelection(ids)
  if (err) return { error: err }
  const xf = compose(translation(delta[0], delta[1]), rotation(degrees, center))
  return { scene: transformInPlace(scene, ids, xf), selectAfter: ids, label: 'Transform' }
}
