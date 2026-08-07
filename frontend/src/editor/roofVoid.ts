/**
 * "Void to roof" (B1) — attach one or more walls to a roof so their tops follow it.
 *
 * A verb, not a tool: it acts on an existing selection (a roof plus the walls it should cut),
 * exactly like the boolean verbs (D-019) act on an existing selection rather than collecting
 * clicks. Detaching is simpler — it is just switching a wall's TopConstraint back to
 * `unconnected`, which the Properties panel already does directly (`ui/PropertiesPanel.tsx`'s
 * `TopConstraintField`), so there is no matching "detach" verb here.
 */
import type { SceneGraph } from '../../../shared/types/scene'
import { resolveWall } from '../../../shared/geometry/index'
import { wallRoofRamp, isRoofError } from '../../../shared/geometry/roof'
import { updateWall } from '../scene/mutations'
import type { VerbResult } from './verbResult'

export interface RoofAndWalls {
  roofId: string
  wallIds: string[]
}

/**
 * Split a selection into "the one roof" and "the walls to void to it", or explain why the
 * selection does not describe that action. Shared by the verb and by the Modify panel, which
 * uses it to decide whether to show the button at all — one rule, not two copies of it.
 */
export function splitRoofAndWalls(scene: SceneGraph, ids: readonly string[]): RoofAndWalls | { error: string } {
  const roofIds = ids.filter((id) => scene.roofs.some((r) => r.id === id))
  const wallIds = ids.filter((id) => scene.walls.some((w) => w.id === id))
  if (roofIds.length !== 1 || wallIds.length === 0 || roofIds.length + wallIds.length !== ids.length) {
    return { error: 'Select exactly one roof and one or more walls to void them to it' }
  }
  return { roofId: roofIds[0], wallIds }
}

/**
 * Attach every selected wall's top to the selected roof.
 *
 * Every wall is validated BEFORE any of them are changed — a partial success would leave the
 * selection in a confusing mixed state, and "refuse and explain" means refusing the whole action
 * rather than silently skipping the walls that do not qualify (D-018's rule, applied here too).
 */
export function voidWallsToRoof(scene: SceneGraph, ids: readonly string[]): VerbResult {
  const split = splitRoofAndWalls(scene, ids)
  if ('error' in split) return split

  const { roofId, wallIds } = split
  const roof = scene.roofs.find((r) => r.id === roofId)
  if (!roof) return { error: 'That roof no longer exists' }

  for (const id of wallIds) {
    const wall = scene.walls.find((w) => w.id === id)
    if (!wall) return { error: 'One of the selected walls no longer exists' }
    const resolved = resolveWall(scene, wall)
    if (!resolved) return { error: 'A selected wall could not be resolved — check its type and level' }
    const ramp = wallRoofRamp(roof, resolved.centerline, resolved.thickness)
    if (isRoofError(ramp)) return { error: ramp.error }
  }

  let next = scene
  for (const id of wallIds) {
    next = updateWall(next, id, { top: { kind: 'roof', roofId } })
  }
  return {
    scene: next,
    selectAfter: [...wallIds],
    label: `Void ${wallIds.length} wall${wallIds.length === 1 ? '' : 's'} to roof`,
  }
}
