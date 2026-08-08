/**
 * Groups (D5) — see DECISIONS.md D-028.
 *
 * A group is an isolation boundary over existing elements: it moves, copies and deletes as one
 * unit, but its members stay individually editable once you explicitly enter it. This module is
 * the ONE place that decides what a click on a member resolves to, shared by viewport picking,
 * the model tree and box-select — three surfaces that would otherwise each invent their own rule
 * and disagree at the edges.
 *
 * Pure, so the Phase 3 agent tools can use the same resolution the user gets.
 */
import type { ElementGroup, SceneGraph } from '../../../shared/types/scene'

/** The group that directly contains `id`, if any. */
export function parentGroupOf(scene: SceneGraph, id: string): ElementGroup | null {
  return scene.groups.find((g) => g.memberIds.includes(id)) ?? null
}

/**
 * The outermost group containing `id`, stopping at `stopAt` (the group the user has entered) so
 * entering a group makes its own children selectable rather than resolving past them.
 *
 * Returns null when `id` is not in any group, or when the walk stops immediately because `id` is a
 * direct child of the entered group — in both cases the element itself is what gets selected.
 */
export function rootGroupOf(
  scene: SceneGraph,
  id: string,
  stopAt: string | null = null,
): ElementGroup | null {
  let current: ElementGroup | null = null
  let cursor = id
  // Bounded by the group count: a cycle would otherwise spin forever, and while `addGroup`
  // refuses to create one, a hand-edited or agent-written document is not obliged to be sane.
  for (let guard = 0; guard <= scene.groups.length; guard++) {
    const parent: ElementGroup | null = parentGroupOf(scene, cursor)
    if (!parent || parent.id === stopAt) break
    current = parent
    cursor = parent.id
  }
  return current
}

/**
 * What clicking `id` should actually select: the outermost group containing it, unless the user
 * has entered a group that contains it more directly.
 */
export function resolveSelection(
  scene: SceneGraph,
  id: string,
  enteredGroupId: string | null,
): string {
  return rootGroupOf(scene, id, enteredGroupId)?.id ?? id
}

/** `resolveSelection` over a whole set, de-duplicated — two members of one group select it once. */
export function resolveSelectionMany(
  scene: SceneGraph,
  ids: readonly string[],
  enteredGroupId: string | null,
): string[] {
  return [...new Set(ids.map((id) => resolveSelection(scene, id, enteredGroupId)))]
}

/**
 * Every non-group element id under `id`, recursively. A group id expands to its leaves; anything
 * else is its own single leaf.
 *
 * This is what the renderers get as their selection set, so selecting a group highlights every
 * member without any renderer having to know groups exist.
 */
export function expandGroup(scene: SceneGraph, id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const walk = (current: string) => {
    if (seen.has(current)) return // also the cycle guard
    seen.add(current)
    const group = scene.groups.find((g) => g.id === current)
    if (!group) {
      out.push(current)
      return
    }
    for (const m of group.memberIds) walk(m)
  }
  walk(id)
  return out
}

export function expandSelection(scene: SceneGraph, ids: readonly string[]): string[] {
  return [...new Set(ids.flatMap((id) => expandGroup(scene, id)))]
}

/** Is `id` a group? */
export function isGroup(scene: SceneGraph, id: string): boolean {
  return scene.groups.some((g) => g.id === id)
}

/**
 * Would adding `memberIds` to a group whose own id is `groupId` create a cycle?
 *
 * The same class of check `booleanTree.ts` runs on operand ids, and for the same reason: a
 * referencing node that can reach itself makes every traversal of it non-terminating.
 */
export function wouldCycle(
  scene: SceneGraph,
  groupId: string,
  memberIds: readonly string[],
): boolean {
  const reaches = (from: string, target: string, depth = 0): boolean => {
    if (from === target) return true
    if (depth > scene.groups.length) return true // pathological input; treat as a cycle
    const group = scene.groups.find((g) => g.id === from)
    if (!group) return false
    return group.memberIds.some((m) => reaches(m, target, depth + 1))
  }
  return memberIds.some((m) => reaches(m, groupId))
}
