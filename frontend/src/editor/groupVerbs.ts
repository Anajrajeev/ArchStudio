/**
 * Group / Ungroup (D5) — verbs over an existing selection, like the boolean (D-019) and join
 * (D-026) verbs. See DECISIONS.md D-028.
 */
import type { SceneGraph } from '../../../shared/types/scene'
import { addGroup, deleteElement } from '../scene/mutations'
import { isGroup, wouldCycle } from './groups'
import type { VerbResult } from './verbResult'

/**
 * Can this selection become a group? Shared with the Modify panel's button-enablement so the
 * button appears exactly when the verb would succeed.
 */
export function canGroup(ids: readonly string[]): boolean {
  return ids.length >= 2
}

export function groupElements(
  scene: SceneGraph,
  ids: readonly string[],
  name?: string,
): VerbResult {
  if (ids.length < 2) return { error: 'Select two or more elements to group them' }

  // Nesting is fine — a member may itself be a group — but a group must never be able to reach
  // itself, or every traversal of it becomes non-terminating.
  const alreadyIn = scene.groups.find((g) => ids.every((id) => g.memberIds.includes(id)))
  if (alreadyIn && alreadyIn.memberIds.length === ids.length) {
    return { error: 'These elements are already a group' }
  }

  const members = [...new Set(ids)]
  const { scene: next, id } = addGroup(
    scene,
    name ?? `Group ${scene.groups.length + 1}`,
    members,
  )
  if (wouldCycle(next, id, members)) {
    return { error: 'That would put a group inside itself' }
  }
  return { scene: next, selectAfter: [id], label: 'Group elements' }
}

/**
 * Dissolve the selected group(s), releasing their members.
 *
 * Deliberately NOT `deleteElement` on the group — that deletes its contents (a group is a unit).
 * Ungrouping removes only the boundary, which is the whole difference between the two verbs.
 */
export function ungroupElements(scene: SceneGraph, ids: readonly string[]): VerbResult {
  const groups = ids.filter((id) => isGroup(scene, id))
  if (groups.length === 0) return { error: 'Select a group to ungroup it' }

  const released: string[] = []
  let next = scene
  for (const id of groups) {
    const group = next.groups.find((g) => g.id === id)
    if (!group) continue
    released.push(...group.memberIds)
    // Remove the group record only. Members are untouched, and a PARENT group holding this one
    // inherits its members in its place, so ungrouping an inner group does not orphan anything.
    next = {
      ...next,
      groups: next.groups
        .filter((g) => g.id !== id)
        .map((g) =>
          g.memberIds.includes(id)
            ? { ...g, memberIds: g.memberIds.flatMap((m) => (m === id ? group.memberIds : [m])) }
            : g,
        ),
    }
  }

  return {
    scene: next,
    selectAfter: released,
    label: groups.length === 1 ? 'Ungroup' : `Ungroup ${groups.length} groups`,
  }
}

/** Delete a group AND everything in it — the ordinary Delete key path, kept here for symmetry. */
export function deleteGroup(scene: SceneGraph, id: string): VerbResult {
  if (!isGroup(scene, id)) return { error: 'That is not a group' }
  return { scene: deleteElement(scene, id), selectAfter: [], label: 'Delete group' }
}
