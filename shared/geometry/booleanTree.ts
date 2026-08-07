/**
 * Boolean tree resolution (B7) — pure TypeScript, no Three.js.
 *
 * The scene stores the TREE, never the evaluated mesh (DECISIONS.md D-019). This module is
 * everything about that tree that can be decided without a CSG kernel: what a node resolves to,
 * whether it is well formed, and which elements it consumes. The actual mesh evaluation lives
 * behind the single Three.js seam in `frontend/src/geometry/evaluateBoolean.ts`.
 *
 * Keeping the two apart is what makes the interesting failure modes — cycles, dangling operands,
 * an operand that is not a solid — testable as plain data, and it means an invalid tree is refused
 * with a sentence *before* any CSG runs.
 */
import type { BooleanNode, BooleanOp, Primitive, SceneGraph } from '../types/scene'

export interface BooleanTreeError {
  error: string
}

export function isBooleanTreeError(x: unknown): x is BooleanTreeError {
  return typeof x === 'object' && x !== null && 'error' in x
}

/** A resolved tree: either a leaf primitive, or an op over already-resolved children. */
export type ResolvedBoolean =
  | { kind: 'leaf'; primitive: Primitive }
  | { kind: 'op'; nodeId: string; op: BooleanOp; operands: ResolvedBoolean[] }

/** Minimum operands any boolean op needs to mean anything. */
export const MIN_OPERANDS = 2

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findBooleanNode(scene: SceneGraph, id: string): BooleanNode | undefined {
  return scene.booleans.find((b) => b.id === id)
}

export function findPrimitive(scene: SceneGraph, id: string): Primitive | undefined {
  return scene.primitives.find((p) => p.id === id)
}

// ---------------------------------------------------------------------------
// Consumption
// ---------------------------------------------------------------------------

/**
 * Every element id that is an operand of some boolean node.
 *
 * The renderers and the exporter skip these: if a box is cut by a cylinder, drawing the original
 * box *and* the cut result would show the uncut box straight through the hole. An operand is not
 * deleted, only absorbed — deleting the node releases it back to visibility.
 */
export function consumedElementIds(scene: SceneGraph): Set<string> {
  const consumed = new Set<string>()
  for (const node of scene.booleans) {
    for (const id of node.operandIds) consumed.add(id)
  }
  return consumed
}

/** Boolean nodes that nothing else consumes — the roots that actually get rendered. */
export function rootBooleanNodes(scene: SceneGraph): BooleanNode[] {
  const consumed = consumedElementIds(scene)
  return scene.booleans.filter((b) => !consumed.has(b.id))
}

/** Primitives that no boolean node consumes — the ones that render on their own. */
export function freePrimitives(scene: SceneGraph): Primitive[] {
  const consumed = consumedElementIds(scene)
  return scene.primitives.filter((p) => !consumed.has(p.id))
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a boolean node into a tree of primitives, or explain why it cannot be resolved.
 *
 * `seen` carries the ancestor chain so a cycle is caught the moment a node references itself,
 * directly or transitively. Without this the recursion would simply overflow the stack — a crash
 * instead of a message, which is precisely the failure mode the refuse-and-explain rule exists to
 * prevent. A cycle is reachable in practice: nothing stops a user from making A cut B and then
 * B cut A through the panel.
 */
export function resolveBooleanNode(
  scene: SceneGraph,
  nodeId: string,
  seen: readonly string[] = [],
): ResolvedBoolean | BooleanTreeError {
  if (seen.includes(nodeId)) {
    return { error: 'This boolean references itself — a boolean tree cannot contain a cycle' }
  }

  const node = findBooleanNode(scene, nodeId)
  if (!node) return { error: `Boolean operation ${nodeId} no longer exists` }

  if (node.operandIds.length < MIN_OPERANDS) {
    return {
      error: `A ${node.op} needs at least ${MIN_OPERANDS} shapes — this one has ${node.operandIds.length}`,
    }
  }

  const nextSeen = [...seen, nodeId]
  const operands: ResolvedBoolean[] = []

  for (const operandId of node.operandIds) {
    const primitive = findPrimitive(scene, operandId)
    if (primitive) {
      operands.push({ kind: 'leaf', primitive })
      continue
    }
    if (findBooleanNode(scene, operandId)) {
      const child = resolveBooleanNode(scene, operandId, nextSeen)
      if (isBooleanTreeError(child)) return child
      operands.push(child)
      continue
    }
    return {
      error: `A shape used by this ${node.op} no longer exists — remove it from the operation or undo the delete`,
    }
  }

  return { kind: 'op', nodeId, op: node.op, operands }
}

/** Flatten a resolved tree to the leaf primitives it is built from, in evaluation order. */
export function leafPrimitives(resolved: ResolvedBoolean): Primitive[] {
  if (resolved.kind === 'leaf') return [resolved.primitive]
  return resolved.operands.flatMap(leafPrimitives)
}

/** How many leaf primitives a node evaluates over — used to warn before an expensive evaluation. */
export function booleanComplexity(scene: SceneGraph, nodeId: string): number {
  const resolved = resolveBooleanNode(scene, nodeId)
  return isBooleanTreeError(resolved) ? 0 : leafPrimitives(resolved).length
}

// ---------------------------------------------------------------------------
// Validation for the verbs
// ---------------------------------------------------------------------------

/**
 * Can these element ids be combined into a boolean? Returns null when they can, a sentence when
 * they cannot.
 *
 * Only primitives and other boolean results are valid operands. Walls, slabs and roofs are
 * deliberately excluded in v1: their geometry is a *decomposition* (D-005) or a face set (D-018),
 * not a single closed solid, so feeding one to a CSG evaluator would produce a mesh that no longer
 * behaves like the parametric element it came from — and would break the "edit the type, every
 * instance updates" contract, since the boolean result is not type-driven.
 */
export function validateOperands(scene: SceneGraph, ids: readonly string[]): string | null {
  if (ids.length < MIN_OPERANDS) {
    return `Select at least ${MIN_OPERANDS} shapes to combine`
  }

  if (new Set(ids).size !== ids.length) {
    return 'A shape cannot be combined with itself'
  }

  for (const id of ids) {
    if (findPrimitive(scene, id)) continue
    if (findBooleanNode(scene, id)) continue
    return 'Boolean operations work on primitive solids and other boolean results — not on walls, slabs or roofs'
  }

  // Operands must all sit on one level: the result is a single element and has to belong somewhere.
  const levels = new Set(
    ids.map((id) => findPrimitive(scene, id)?.levelId ?? findBooleanNode(scene, id)?.levelId),
  )
  if (levels.size > 1) {
    return 'All the shapes in a boolean must be on the same level'
  }

  return null
}

/** The level a new boolean node should belong to, given valid operands. */
export function operandLevelId(scene: SceneGraph, ids: readonly string[]): string | null {
  for (const id of ids) {
    const level = findPrimitive(scene, id)?.levelId ?? findBooleanNode(scene, id)?.levelId
    if (level) return level
  }
  return null
}

/** Human label for a boolean op, for undo entries and the model tree. */
export function booleanOpLabel(op: BooleanOp): string {
  switch (op) {
    case 'union':
      return 'Union'
    case 'cut':
      return 'Cut'
    case 'intersect':
      return 'Intersect'
  }
}
