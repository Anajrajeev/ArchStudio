/**
 * Boolean operations as explicit verbs (B7), following the same refuse-or-succeed contract as the
 * modify verbs (D3) and the transform verbs (D4): each returns either a new scene or a sentence
 * explaining why it did nothing. See `editor/verbResult.ts` for why that union is a type rather
 * than a convention.
 *
 * The verbs are deliberately *not* a tool that collects clicks. A boolean is an operation on
 * elements that already exist and are already selected, so it belongs with align/mirror/array in
 * the Modify panel rather than as a fourth drawing mode. That also makes it multi-select aware for
 * free — a union of five shapes is one action, not four chained pairs.
 *
 * Validation happens BEFORE any CSG runs (`validateOperands`), so a bad selection costs nothing and
 * produces a message rather than a mystery.
 */
import type { BooleanOp, SceneGraph } from '../../../shared/types/scene'
import {
  booleanOpLabel,
  operandLevelId,
  validateOperands,
} from '../../../shared/geometry/booleanTree'
import { addBooleanNode, dissolveBooleanNode } from '../scene/mutations'
import type { VerbResult } from './verbResult'

/**
 * Combine the selected elements with `op`.
 *
 * Selection ORDER is significant for `cut`: the first selected element is the base and the rest are
 * removed from it. That is the same convention every CAD tool uses, and it is the only way to make
 * an order-dependent op predictable from a multi-selection.
 */
export function combineElements(
  scene: SceneGraph,
  ids: readonly string[],
  op: BooleanOp,
): VerbResult {
  const invalid = validateOperands(scene, ids)
  if (invalid) return { error: invalid }

  const levelId = operandLevelId(scene, ids)
  if (!levelId) return { error: 'These shapes are not on a level' }

  const { scene: next, id } = addBooleanNode(scene, levelId, op, [...ids])
  return {
    scene: next,
    selectAfter: [id],
    label: `${booleanOpLabel(op)} ${ids.length} shapes`,
  }
}

export function unionElements(scene: SceneGraph, ids: readonly string[]): VerbResult {
  return combineElements(scene, ids, 'union')
}

export function cutElements(scene: SceneGraph, ids: readonly string[]): VerbResult {
  return combineElements(scene, ids, 'cut')
}

export function intersectElements(scene: SceneGraph, ids: readonly string[]): VerbResult {
  return combineElements(scene, ids, 'intersect')
}

/**
 * Undo a combination without destroying what went into it: the node disappears and its operands
 * become ordinary visible elements again.
 *
 * Refuses on anything that is not a boolean, rather than silently doing nothing — "explode" on a
 * wall should say so.
 */
export function explodeBoolean(scene: SceneGraph, id: string): VerbResult {
  const node = scene.booleans.find((b) => b.id === id)
  if (!node) return { error: 'Select a boolean result to explode it back into its shapes' }

  return {
    scene: dissolveBooleanNode(scene, id),
    selectAfter: [...node.operandIds],
    label: `Explode ${booleanOpLabel(node.op).toLowerCase()}`,
  }
}
