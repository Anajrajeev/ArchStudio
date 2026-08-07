/**
 * Stair geometry tests (B2). See DECISIONS.md and shared/geometry/stair.ts.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveStair,
  stairSolidBoxes,
  validateStair,
  defaultStair,
  BLONDEL_MIN,
  BLONDEL_MAX,
} from '../../../shared/geometry/stair'
import {
  addStair,
  moveElement,
  transformElement,
  duplicateElement,
  deleteElement,
  findElement,
  elementLabel,
  setElementType,
} from '../scene/mutations'
import { rotation } from '../../../shared/geometry/transform'
import type { Stair } from '../../../shared/types/scene'
import { fixture } from './helpers'

function makeStair(overrides: Partial<Stair> = {}) {
  const f = fixture()
  const stair: Stair = {
    id: 'st1',
    typeId: 'st-stair-280',
    levelId: f.levelId,
    baseline: { start: [0, 0], end: [3, 0] },
    baseOffset: 0,
    top: { kind: 'unconnected', height: 2.7 },
    desiredNumberOfRisers: 15, // 2.7 / 15 = 0.18m — comfortably in the Blondel range with 0.28 tread
    ...overrides,
  }
  return { scene: addStair(f.scene, stair), stair }
}

describe('resolveStair', () => {
  it('derives actualRiserHeight from the resolved rise, never storing it', () => {
    const { scene, stair } = makeStair()
    const resolved = resolveStair(scene, stair)!
    expect(resolved.rise).toBeCloseTo(2.7)
    expect(resolved.actualRiserHeight).toBeCloseTo(2.7 / 15)
  })

  it('a level-referenced top tracks the level, exactly like a wall', () => {
    const f = fixture()
    const upstairs = { ...f.scene, levels: [...f.scene.levels, { id: 'lv2', name: 'Up', elevation: 3, height: 3, isBuildingStory: true, computationHeight: 0 }] }
    const stair: Stair = {
      id: 'st1',
      typeId: 'st-stair-280',
      levelId: f.levelId,
      baseline: { start: [0, 0], end: [3, 0] },
      baseOffset: 0,
      top: { kind: 'level', levelId: 'lv2', offset: 0 },
      desiredNumberOfRisers: 17,
    }
    const scene = addStair(upstairs, stair)
    const resolved = resolveStair(scene, stair)!
    expect(resolved.topElevation).toBeCloseTo(3)
    expect(resolved.actualRiserHeight).toBeCloseTo(3 / 17)
  })

  it('returns null for an unknown type, unknown level, or a degenerate baseline', () => {
    const { scene, stair } = makeStair()
    expect(resolveStair(scene, { ...stair, typeId: 'nope' })).toBeNull()
    expect(resolveStair(scene, { ...stair, levelId: 'nope' })).toBeNull()
    expect(resolveStair(scene, { ...stair, baseline: { start: [1, 1], end: [1, 1] } })).toBeNull()
  })

  it('direction comes from the baseline, length is irrelevant to it', () => {
    const { scene, stair } = makeStair({ baseline: { start: [0, 0], end: [0, 5] } })
    const resolved = resolveStair(scene, stair)!
    expect(resolved.direction[0]).toBeCloseTo(0)
    expect(resolved.direction[1]).toBeCloseTo(1)
  })
})

describe('stairSolidBoxes', () => {
  it('emits one box per riser, each reaching the FULL height up to its own tread', () => {
    const { scene, stair } = makeStair({ desiredNumberOfRisers: 5, top: { kind: 'unconnected', height: 1.0 } })
    const resolved = resolveStair(scene, stair)!
    const boxes = stairSolidBoxes(resolved)
    expect(boxes).toHaveLength(5)
    // Step i's box height is (i+1) * riserHeight — the boxes stack up like a real solid stair.
    const riserHeight = resolved.actualRiserHeight
    boxes.forEach((box, i) => {
      expect(box.size[1]).toBeCloseTo((i + 1) * riserHeight)
      expect(box.size[0]).toBeCloseTo(resolved.treadDepth)
      expect(box.size[2]).toBeCloseTo(resolved.width)
    })
  })

  it('boxes progress along the baseline direction with no gaps or overlaps', () => {
    const { scene, stair } = makeStair({ desiredNumberOfRisers: 4 })
    const resolved = resolveStair(scene, stair)!
    const boxes = stairSolidBoxes(resolved)
    // Centres are treadDepth apart along +X for this axis-aligned stair.
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i].center[0] - boxes[i - 1].center[0]).toBeCloseTo(resolved.treadDepth)
    }
  })

  it('every box sits on the base elevation, not floating', () => {
    const { scene, stair } = makeStair({ desiredNumberOfRisers: 3, baseOffset: 1.5 })
    const resolved = resolveStair(scene, stair)!
    const boxes = stairSolidBoxes(resolved)
    // Box i's bottom is center.y - size.y/2, which must equal baseElevation for every box.
    boxes.forEach((box) => {
      expect(box.center[1] - box.size[1] / 2).toBeCloseTo(resolved.baseElevation)
    })
  })

  it('returns nothing for a degenerate resolved stair rather than a garbage box', () => {
    const { scene, stair } = makeStair({ desiredNumberOfRisers: 0 })
    const resolved = resolveStair(scene, stair)!
    expect(stairSolidBoxes(resolved)).toEqual([])
  })
})

describe('validateStair', () => {
  it('a well-configured stair has no errors', () => {
    const { scene, stair } = makeStair()
    expect(validateStair(scene, stair)).toEqual([])
  })

  it('flags fewer than 2 risers', () => {
    const { scene, stair } = makeStair({ desiredNumberOfRisers: 1 })
    expect(validateStair(scene, stair).some((e) => /at least 2 risers/i.test(e))).toBe(true)
  })

  it('flags a rise that is not positive', () => {
    const { scene, stair } = makeStair({ top: { kind: 'unconnected', height: 0 } })
    expect(validateStair(scene, stair).some((e) => /top must be above/i.test(e))).toBe(true)
  })

  it('flags a Blondel ratio outside the comfortable range, both too shallow and too steep', () => {
    // Too shallow: a huge tread with a tiny rise (a ramp, not a stair).
    const { scene: shallowScene, stair: shallow } = makeStair({
      desiredNumberOfRisers: 30, // riser ~0.09m, 2*0.09 + 0.28 = 0.46 < BLONDEL_MIN
    })
    expect(validateStair(shallowScene, shallow).some((e) => /Blondel/.test(e))).toBe(true)

    // Too steep: very few risers over the same rise.
    const { scene: steepScene, stair: steep } = makeStair({
      desiredNumberOfRisers: 8, // riser ~0.34m, 2*0.34 + 0.28 = 0.96 > BLONDEL_MAX
    })
    expect(validateStair(steepScene, steep).some((e) => /Blondel/.test(e))).toBe(true)
  })

  it('does not flag a Blondel ratio at the edges of the comfortable range', () => {
    // Solve for a riser height r such that 2r + 0.28 sits mid-range.
    const midBlondel = (BLONDEL_MIN + BLONDEL_MAX) / 2
    const riser = (midBlondel - 0.28) / 2
    const risers = Math.round(2.7 / riser)
    const { scene, stair } = makeStair({ desiredNumberOfRisers: risers })
    expect(validateStair(scene, stair).some((e) => /Blondel/.test(e))).toBe(false)
  })

  it('flags an unknown type or level', () => {
    const { scene, stair } = makeStair()
    expect(validateStair(scene, { ...stair, typeId: 'nope' }).some((e) => /unknown stair type/i.test(e))).toBe(true)
    expect(validateStair(scene, { ...stair, levelId: 'nope' }).some((e) => /unknown level/i.test(e))).toBe(true)
  })
})

describe('defaultStair', () => {
  it('picks a sane riser count for the given rise', () => {
    const stair = defaultStair('st1', 'st-stair-280', 'lv1', [0, 0], [3, 0], 2.8)
    expect(stair.desiredNumberOfRisers).toBeGreaterThanOrEqual(14)
    expect(stair.desiredNumberOfRisers).toBeLessThanOrEqual(18)
    expect(stair.top).toEqual({ kind: 'unconnected', height: 2.8 })
  })
})

describe('stair lifecycle (scene mutations)', () => {
  it('is addressable and labelled', () => {
    const { scene, stair } = makeStair()
    expect(findElement(scene, stair.id)?.kind).toBe('stair')
    expect(elementLabel(scene, stair.id)).toMatch(/15 risers/)
  })

  it('moveElement shifts both baseline endpoints by the same delta', () => {
    const { scene, stair } = makeStair()
    const moved = moveElement(scene, stair.id, [2, -1])
    const m = moved.stairs.find((s) => s.id === stair.id)!
    expect(m.baseline.start).toEqual([2, -1])
    expect(m.baseline.end).toEqual([5, -1])
  })

  it('transformElement (rotate) turns the baseline about the given centre', () => {
    const { scene, stair } = makeStair({ baseline: { start: [0, 0], end: [1, 0] } })
    const rotated = transformElement(scene, stair.id, rotation(90, [0, 0]))
    const r = rotated.stairs.find((s) => s.id === stair.id)!
    expect(r.baseline.start[0]).toBeCloseTo(0)
    expect(r.baseline.start[1]).toBeCloseTo(0)
    expect(r.baseline.end[0]).toBeCloseTo(0)
    expect(r.baseline.end[1]).toBeCloseTo(1)
  })

  it('duplicateElement copies the baseline as new arrays, not shared references', () => {
    const { scene, stair } = makeStair()
    const copy = duplicateElement(scene, stair.id)!
    expect(copy.id).not.toBe(stair.id)
    const original = copy.scene.stairs.find((s) => s.id === stair.id)!
    const dup = copy.scene.stairs.find((s) => s.id === copy.id)!
    expect(dup.baseline).toEqual(original.baseline)
    expect(dup.baseline.start).not.toBe(original.baseline.start)
  })

  it('setElementType re-points the stair at a different type', () => {
    const { scene, stair } = makeStair()
    const retyped = setElementType(scene, stair.id, 'st-stair-280')
    expect(retyped.stairs.find((s) => s.id === stair.id)!.typeId).toBe('st-stair-280')
  })

  it('deleteElement removes the stair', () => {
    const { scene, stair } = makeStair()
    const after = deleteElement(scene, stair.id)
    expect(after.stairs).toHaveLength(0)
  })

  it('deleting the LEVEL takes the stair with it', () => {
    const { scene, stair } = makeStair()
    const after = deleteElement(scene, stair.levelId)
    expect(after.stairs.find((s) => s.id === stair.id)).toBeUndefined()
  })
})
