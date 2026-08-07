/**
 * Railing geometry tests (B3). See shared/geometry/railing.ts.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveRailing,
  railingSolidBoxes,
  validateRailing,
  defaultRailing,
} from '../../../shared/geometry/railing'
import {
  addRailing,
  moveElement,
  transformElement,
  duplicateElement,
  deleteElement,
  findElement,
  elementLabel,
} from '../scene/mutations'
import { rotation } from '../../../shared/geometry/transform'
import type { Railing } from '../../../shared/types/scene'
import { fixture } from './helpers'

function makeRailing(overrides: Partial<Railing> = {}) {
  const f = fixture()
  const railing: Railing = {
    id: 'rl1',
    typeId: 'rl-standard',
    levelId: f.levelId,
    path: [
      [0, 0],
      [3, 0],
      [3, 3],
    ],
    baseOffset: 0,
    ...overrides,
  }
  return { scene: addRailing(f.scene, railing), railing }
}

describe('resolveRailing', () => {
  it('resolves height/thickness/spacing from the type', () => {
    const { scene, railing } = makeRailing()
    const resolved = resolveRailing(scene, railing)!
    expect(resolved.height).toBeCloseTo(0.9) // rl-standard's DEFAULT_TYPES value
    expect(resolved.postThickness).toBeCloseTo(0.04)
    expect(resolved.postSpacing).toBeCloseTo(1)
  })

  it('sums segment lengths for totalLength', () => {
    const { scene, railing } = makeRailing()
    const resolved = resolveRailing(scene, railing)!
    expect(resolved.totalLength).toBeCloseTo(6) // 3 + 3
  })

  it('returns null for a path with fewer than 2 points, or an unknown type/level', () => {
    const { scene, railing } = makeRailing()
    expect(resolveRailing(scene, { ...railing, path: [[0, 0]] })).toBeNull()
    expect(resolveRailing(scene, { ...railing, typeId: 'nope' })).toBeNull()
    expect(resolveRailing(scene, { ...railing, levelId: 'nope' })).toBeNull()
  })
})

describe('railingSolidBoxes', () => {
  it('emits one rail box per path segment', () => {
    const { scene, railing } = makeRailing()
    const resolved = resolveRailing(scene, railing)!
    const boxes = railingSolidBoxes(resolved)
    const railBoxes = boxes.filter((b) => b.size[1] === resolved.postThickness && b.size[0] > resolved.postThickness)
    expect(railBoxes).toHaveLength(2) // 3 points -> 2 segments
  })

  it('places a post every postSpacing, ALWAYS including one at the exact end', () => {
    const { scene, railing } = makeRailing({
      path: [
        [0, 0],
        [4, 0],
      ],
    })
    const resolved = resolveRailing(scene, railing)!
    const boxes = railingSolidBoxes(resolved)
    // Posts are the boxes whose footprint is square (thickness x thickness).
    const posts = boxes.filter((b) => b.size[0] === resolved.postThickness && b.size[2] === resolved.postThickness)
    // spacing=1 over length=4: posts at 0,1,2,3,4 -> 5 posts, none of them duplicated at the end.
    expect(posts).toHaveLength(5)
    const lastPostX = Math.max(...posts.map((p) => p.center[0]))
    expect(lastPostX).toBeCloseTo(4)
  })

  it('a bent path still places exactly one post at its very end', () => {
    const { scene, railing } = makeRailing({
      path: [
        [0, 0],
        [1.3, 0],
        [1.3, 1.3],
      ],
    })
    const resolved = resolveRailing(scene, railing)!
    const boxes = railingSolidBoxes(resolved)
    const posts = boxes.filter((b) => b.size[0] === resolved.postThickness && b.size[2] === resolved.postThickness)
    // A post's box centre is [x, elevation, z] (D-007) — scene 2D [x,y] maps to world [x, *, y].
    const endPosts = posts.filter(
      (p) => Math.abs(p.center[0] - 1.3) < 1e-6 && Math.abs(p.center[2] - 1.3) < 1e-6,
    )
    expect(endPosts).toHaveLength(1)
  })

  it('an oversized spacing still gets at least the two endpoint posts', () => {
    const { scene, railing } = makeRailing({ typeId: 'rl-standard', path: [[0, 0], [0.5, 0]] })
    // rl-standard has spacing 1m over a 0.5m railing — only the start (s=0) and the forced end
    // (s=totalLength) posts should appear, no duplicate at s=0 from the loop overshooting.
    const resolved = resolveRailing(scene, railing)!
    const boxes = railingSolidBoxes(resolved)
    const posts = boxes.filter((b) => b.size[0] === resolved.postThickness && b.size[2] === resolved.postThickness)
    expect(posts).toHaveLength(2)
  })

  it('returns nothing for a degenerate resolved railing', () => {
    const { scene, railing } = makeRailing({ path: [[0, 0], [0, 0]] })
    const resolved = resolveRailing(scene, railing)!
    expect(railingSolidBoxes(resolved)).toEqual([])
  })
})

describe('validateRailing', () => {
  it('a well-configured railing has no errors', () => {
    const { scene, railing } = makeRailing()
    expect(validateRailing(scene, railing)).toEqual([])
  })

  it('flags a path with fewer than 2 points', () => {
    const { scene, railing } = makeRailing({ path: [[0, 0]] })
    expect(validateRailing(scene, railing).some((e) => /at least 2 points/i.test(e))).toBe(true)
  })

  it('flags an unknown type or level', () => {
    const { scene, railing } = makeRailing()
    expect(
      validateRailing(scene, { ...railing, typeId: 'nope' }).some((e) => /unknown railing type/i.test(e)),
    ).toBe(true)
    expect(
      validateRailing(scene, { ...railing, levelId: 'nope' }).some((e) => /unknown level/i.test(e)),
    ).toBe(true)
  })
})

describe('defaultRailing', () => {
  it('builds a railing with the given path and zero base offset', () => {
    const railing = defaultRailing('rl1', 'rl-standard', 'lv1', [[0, 0], [2, 0]])
    expect(railing.path).toEqual([[0, 0], [2, 0]])
    expect(railing.baseOffset).toBe(0)
  })
})

describe('railing lifecycle (scene mutations)', () => {
  it('is addressable and labelled', () => {
    const { scene, railing } = makeRailing()
    expect(findElement(scene, railing.id)?.kind).toBe('railing')
    expect(elementLabel(scene, railing.id)).toMatch(/3 pts/)
  })

  it('moveElement shifts every path point by the same delta', () => {
    const { scene, railing } = makeRailing()
    const moved = moveElement(scene, railing.id, [1, 2])
    const m = moved.railings.find((r) => r.id === railing.id)!
    expect(m.path).toEqual([
      [1, 2],
      [4, 2],
      [4, 5],
    ])
  })

  it('transformElement (rotate) turns every path point about the given centre', () => {
    const { scene, railing } = makeRailing({
      path: [
        [0, 0],
        [1, 0],
      ],
    })
    const rotated = transformElement(scene, railing.id, rotation(90, [0, 0]))
    const r = rotated.railings.find((x) => x.id === railing.id)!
    expect(r.path[1][0]).toBeCloseTo(0)
    expect(r.path[1][1]).toBeCloseTo(1)
  })

  it('duplicateElement copies the path as new arrays, not shared references', () => {
    const { scene, railing } = makeRailing()
    const copy = duplicateElement(scene, railing.id)!
    const original = copy.scene.railings.find((r) => r.id === railing.id)!
    const dup = copy.scene.railings.find((r) => r.id === copy.id)!
    expect(dup.path).toEqual(original.path)
    expect(dup.path[0]).not.toBe(original.path[0])
  })

  it('deleteElement removes the railing', () => {
    const { scene, railing } = makeRailing()
    expect(deleteElement(scene, railing.id).railings).toHaveLength(0)
  })

  it('deleting the LEVEL takes the railing with it', () => {
    const { scene, railing } = makeRailing()
    const after = deleteElement(scene, railing.levelId)
    expect(after.railings.find((r) => r.id === railing.id)).toBeUndefined()
  })
})
