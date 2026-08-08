/**
 * Groups (D5 / D-028).
 *
 * The two things worth proving are the ones a user would notice immediately if they broke:
 * resolution (clicking a member selects the group — unless you have entered it), and independence
 * (a duplicated group is genuinely its own thing, so dragging the copy leaves the original alone).
 */
import { describe, it, expect } from 'vitest'
import { emptySceneGraph, type SceneGraph, type Vec2 } from '../../../shared/types/scene'
import {
  addLevel,
  addColumn,
  addWall,
  addGroup,
  deleteElement,
  duplicateElement,
  moveElement,
  transformElement,
  elementLabel,
  levelIdOf,
} from '../scene/mutations'
import {
  expandGroup,
  expandSelection,
  isGroup,
  parentGroupOf,
  resolveSelection,
  resolveSelectionMany,
  rootGroupOf,
  wouldCycle,
} from '../editor/groups'
import { canGroup, groupElements, ungroupElements } from '../editor/groupVerbs'
import { translation } from '../../../shared/geometry/transform'

/** A level with three columns, ready to be grouped. */
function base(): { scene: SceneGraph; levelId: string; ids: string[] } {
  let scene = addLevel(emptySceneGraph('p'), 'Ground')
  const levelId = scene.levels[0].id
  const ids: string[] = []
  for (const p of [
    [0, 0],
    [2, 0],
    [4, 0],
  ] as Vec2[]) {
    const r = addColumn(scene, levelId, 'ct-rect-300', p)
    scene = r.scene
    ids.push(r.id)
  }
  return { scene, levelId, ids }
}

describe('group resolution', () => {
  it('resolves a member click to its group', () => {
    const { scene, ids } = base()
    const { scene: withGroup, id: gid } = addGroup(scene, 'G', [ids[0], ids[1]])
    expect(resolveSelection(withGroup, ids[0], null)).toBe(gid)
  })

  it('leaves an ungrouped element alone', () => {
    const { scene, ids } = base()
    const { scene: withGroup } = addGroup(scene, 'G', [ids[0], ids[1]])
    expect(resolveSelection(withGroup, ids[2], null)).toBe(ids[2])
  })

  it('resolves to the OUTERMOST group when they nest', () => {
    const { scene, ids } = base()
    const a = addGroup(scene, 'Inner', [ids[0], ids[1]])
    const b = addGroup(a.scene, 'Outer', [a.id, ids[2]])
    expect(resolveSelection(b.scene, ids[0], null)).toBe(b.id)
    expect(rootGroupOf(b.scene, ids[0], null)?.id).toBe(b.id)
    expect(parentGroupOf(b.scene, ids[0])?.id).toBe(a.id)
  })

  it('stops at the group the user has ENTERED, so its children become selectable', () => {
    const { scene, ids } = base()
    const a = addGroup(scene, 'Inner', [ids[0], ids[1]])
    const b = addGroup(a.scene, 'Outer', [a.id, ids[2]])
    // Inside the outer group, a member of the inner group resolves to the INNER group.
    expect(resolveSelection(b.scene, ids[0], b.id)).toBe(a.id)
    // Inside the inner group, it resolves to the element itself.
    expect(resolveSelection(b.scene, ids[0], a.id)).toBe(ids[0])
  })

  it('de-duplicates when several members of one group are caught by a box select', () => {
    const { scene, ids } = base()
    const { scene: withGroup, id: gid } = addGroup(scene, 'G', [ids[0], ids[1]])
    expect(resolveSelectionMany(withGroup, [ids[0], ids[1]], null)).toEqual([gid])
  })

  it('expands a group to its leaves, recursively', () => {
    const { scene, ids } = base()
    const a = addGroup(scene, 'Inner', [ids[0], ids[1]])
    const b = addGroup(a.scene, 'Outer', [a.id, ids[2]])
    expect(expandGroup(b.scene, b.id).sort()).toEqual([...ids].sort())
    expect(expandSelection(b.scene, [b.id, ids[0]]).sort()).toEqual([...ids].sort())
  })

  it('terminates on a cyclic document instead of spinning forever', () => {
    // Not reachable through the verbs, but a hand-edited or agent-written scene is not obliged
    // to be sane, and a traversal that never returns takes the whole viewport with it.
    const { scene } = base()
    const cyclic: SceneGraph = {
      ...scene,
      groups: [
        { id: 'g1', name: 'A', memberIds: ['g2', 'x'] },
        { id: 'g2', name: 'B', memberIds: ['g1', 'y'] },
      ],
    }
    expect(() => rootGroupOf(cyclic, 'x', null)).not.toThrow()
    expect(() => expandGroup(cyclic, 'g1')).not.toThrow()
  })

  it('detects a cycle before one can be created', () => {
    const { scene, ids } = base()
    const a = addGroup(scene, 'Inner', [ids[0], ids[1]])
    const b = addGroup(a.scene, 'Outer', [a.id, ids[2]])
    expect(wouldCycle(b.scene, a.id, [b.id])).toBe(true)
    expect(wouldCycle(b.scene, a.id, [ids[2]])).toBe(false)
  })
})

describe('group verbs', () => {
  it('refuses to group fewer than two elements', () => {
    const { scene, ids } = base()
    expect(canGroup([ids[0]])).toBe(false)
    const result = groupElements(scene, [ids[0]])
    expect('error' in result && result.error).toMatch(/two or more/i)
  })

  it('groups a selection and selects the group afterwards', () => {
    const { scene, ids } = base()
    const result = groupElements(scene, [ids[0], ids[1]])
    if ('error' in result) throw new Error(result.error)
    expect(result.scene.groups).toHaveLength(1)
    expect(result.selectAfter).toEqual([result.scene.groups[0].id])
  })

  it('refuses to re-group an identical selection', () => {
    const { scene, ids } = base()
    const first = groupElements(scene, [ids[0], ids[1]])
    if ('error' in first) throw new Error(first.error)
    const again = groupElements(first.scene, [ids[0], ids[1]])
    expect('error' in again && again.error).toMatch(/already a group/i)
  })

  it('ungroup releases members WITHOUT deleting them', () => {
    const { scene, ids } = base()
    const { scene: withGroup, id: gid } = addGroup(scene, 'G', [ids[0], ids[1]])
    const result = ungroupElements(withGroup, [gid])
    if ('error' in result) throw new Error(result.error)
    expect(result.scene.groups).toHaveLength(0)
    expect(result.scene.columns).toHaveLength(3)
    expect(result.selectAfter.sort()).toEqual([ids[0], ids[1]].sort())
  })

  it('ungrouping an INNER group hands its members to the parent, orphaning nothing', () => {
    const { scene, ids } = base()
    const a = addGroup(scene, 'Inner', [ids[0], ids[1]])
    const b = addGroup(a.scene, 'Outer', [a.id, ids[2]])
    const result = ungroupElements(b.scene, [a.id])
    if ('error' in result) throw new Error(result.error)
    const outer = result.scene.groups.find((g) => g.id === b.id)!
    expect(outer.memberIds.sort()).toEqual([...ids].sort())
  })

  it('refuses to ungroup something that is not a group', () => {
    const { scene, ids } = base()
    expect('error' in ungroupElements(scene, [ids[0]])).toBe(true)
  })
})

describe('groups and the existing verbs', () => {
  it('moves every member when the group moves', () => {
    const { scene, ids } = base()
    const { scene: withGroup, id: gid } = addGroup(scene, 'G', [ids[0], ids[1]])
    const moved = moveElement(withGroup, gid, [1, 2])
    const before = withGroup.columns.map((c) => c.position)
    const after = moved.columns.map((c) => c.position)
    expect(after[0]).toEqual([before[0][0] + 1, before[0][1] + 2])
    expect(after[1]).toEqual([before[1][0] + 1, before[1][1] + 2])
    // The third column was not in the group and must not have moved.
    expect(after[2]).toEqual(before[2])
  })

  it('transforms every member when the group is transformed', () => {
    const { scene, ids } = base()
    const { scene: withGroup, id: gid } = addGroup(scene, 'G', [ids[0], ids[1]])
    const moved = transformElement(withGroup, gid, translation(0, 3))
    expect(moved.columns[0].position[1]).toBeCloseTo(3)
    expect(moved.columns[2].position[1]).toBeCloseTo(0)
  })

  it('duplicates into an INDEPENDENT group — dragging the copy leaves the original alone', () => {
    const { scene, ids } = base()
    const { scene: withGroup, id: gid } = addGroup(scene, 'G', [ids[0], ids[1]])
    const copied = duplicateElement(withGroup, gid)!
    expect(copied.scene.groups).toHaveLength(2)
    expect(copied.scene.columns).toHaveLength(5)
    // No member id is shared between the two groups.
    const original = copied.scene.groups.find((g) => g.id === gid)!
    const copy = copied.scene.groups.find((g) => g.id === copied.id)!
    expect(copy.memberIds.some((m) => original.memberIds.includes(m))).toBe(false)

    const before = copied.scene.columns.find((c) => c.id === ids[0])!.position
    const after = moveElement(copied.scene, copied.id, [5, 5])
    expect(after.columns.find((c) => c.id === ids[0])!.position).toEqual(before)
  })

  it('deleting a group deletes its contents — a group is a unit', () => {
    const { scene, ids } = base()
    const { scene: withGroup, id: gid } = addGroup(scene, 'G', [ids[0], ids[1]])
    const after = deleteElement(withGroup, gid)
    expect(after.groups).toHaveLength(0)
    expect(after.columns.map((c) => c.id)).toEqual([ids[2]])
  })

  it('deleting a MEMBER prunes it, and dissolves a group left with fewer than two', () => {
    const { scene, ids } = base()
    const { scene: withGroup } = addGroup(scene, 'G', [ids[0], ids[1]])
    const after = deleteElement(withGroup, ids[0])
    // One member left is not an isolation boundary any more.
    expect(after.groups).toHaveLength(0)
    expect(after.columns).toHaveLength(2)
  })

  it('keeps a three-member group alive when one member goes', () => {
    const { scene, ids } = base()
    const { scene: withGroup, id: gid } = addGroup(scene, 'G', ids)
    const after = deleteElement(withGroup, ids[0])
    expect(after.groups.find((g) => g.id === gid)?.memberIds).toEqual([ids[1], ids[2]])
  })

  it('dissolves a parent group when dissolving its child drops it below two members', () => {
    const { scene, ids } = base()
    const a = addGroup(scene, 'Inner', [ids[0], ids[1]])
    const b = addGroup(a.scene, 'Outer', [a.id, ids[2]])
    // Deleting the third column leaves Outer holding only Inner — one member, so it dissolves.
    const after = deleteElement(b.scene, ids[2])
    expect(after.groups.map((g) => g.id)).toEqual([a.id])
  })

  it('deleting the level a group lives on takes the group with it', () => {
    const { scene, levelId, ids } = base()
    const { scene: withGroup } = addGroup(scene, 'G', [ids[0], ids[1]])
    const after = deleteElement(withGroup, levelId)
    expect(after.groups).toHaveLength(0)
    expect(after.columns).toHaveLength(0)
  })

  it('reports a level and a label for the tree', () => {
    const { scene, levelId, ids } = base()
    const { scene: withGroup, id: gid } = addGroup(scene, 'Kitchen set', [ids[0], ids[1]])
    expect(levelIdOf(withGroup, gid)).toBe(levelId)
    expect(elementLabel(withGroup, gid)).toBe('Kitchen set (2)')
    expect(isGroup(withGroup, gid)).toBe(true)
  })

  it('survives a group whose members span two levels', () => {
    // Deliberately allowed (D-028): a repeated stair-and-landing assembly crosses storeys.
    let scene = addLevel(emptySceneGraph('p'), 'Ground')
    scene = addLevel(scene, 'First')
    const [lv1, lv2] = scene.levels.map((l) => l.id)
    const a = addWall(scene, {
      levelId: lv1,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [0, 0], end: [4, 0] },
    })
    const b = addWall(a.scene, {
      levelId: lv2,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [0, 0], end: [4, 0] },
    })
    const { scene: withGroup, id: gid } = addGroup(b.scene, 'Spanning', [a.id, b.id])
    expect(levelIdOf(withGroup, gid)).toBe(lv1)
    // Deleting the upper level prunes that member but leaves the other wall standing.
    const after = deleteElement(withGroup, lv2)
    expect(after.walls.map((w) => w.id)).toEqual([a.id])
    expect(after.groups).toHaveLength(0) // one member left, so it dissolved
  })
})
