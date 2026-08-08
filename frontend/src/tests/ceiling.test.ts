/**
 * Ceiling geometry + lifecycle tests (B5). A boundary polygon like Slab, but anchored at its
 * finished BOTTOM face via the same TopConstraint union walls/columns/stairs use.
 */
import { describe, it, expect } from 'vitest'
import { resolveCeiling, validateCeiling } from '../../../shared/geometry/index'
import {
  addCeiling,
  updateCeiling,
  removeCeiling,
  moveElement,
  transformElement,
  duplicateElement,
  deleteElement,
  findElement,
  elementLabel,
  setElementType,
} from '../scene/mutations'
import { rotation } from '../../../shared/geometry/transform'
import type { Ceiling } from '../../../shared/types/scene'
import { fixture } from './helpers'

function makeCeiling(overrides: Partial<Ceiling> = {}) {
  const f = fixture()
  const ceiling: Ceiling = {
    id: 'ceil1',
    typeId: 'clt-plaster-15',
    levelId: f.levelId,
    boundary: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
    top: { kind: 'unconnected', height: 2.8 },
    ...overrides,
  }
  return { scene: addCeiling(f.scene, ceiling), ceiling }
}

describe('resolveCeiling', () => {
  it('anchors the bottom face at base elevation + unconnected height, extending UP by thickness', () => {
    const { scene, ceiling } = makeCeiling()
    const resolved = resolveCeiling(scene, ceiling)!
    expect(resolved.bottomElevation).toBeCloseTo(2.8)
    expect(resolved.thickness).toBeCloseTo(0.015)
    expect(resolved.boundary).toEqual(ceiling.boundary)
  })

  it('a level-referenced top tracks the level above, exactly like a wall', () => {
    const f = fixture()
    const withUpper = {
      ...f.scene,
      levels: [
        ...f.scene.levels,
        { id: 'lv2', name: 'Up', elevation: 3, height: 3, isBuildingStory: true, computationHeight: 0 },
      ],
    }
    const ceiling: Ceiling = {
      id: 'ceil1',
      typeId: 'clt-plaster-15',
      levelId: f.levelId,
      boundary: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      top: { kind: 'level', levelId: 'lv2', offset: -0.1 },
    }
    const scene = addCeiling(withUpper, ceiling)
    const resolved = resolveCeiling(scene, ceiling)!
    // Underside of the level above, minus a small gap — the "attaches to the underside" case.
    expect(resolved.bottomElevation).toBeCloseTo(2.9)
  })

  it('returns null for an unknown type, unknown level, or a degenerate boundary', () => {
    const { scene, ceiling } = makeCeiling()
    expect(resolveCeiling(scene, { ...ceiling, typeId: 'nope' })).toBeNull()
    expect(resolveCeiling(scene, { ...ceiling, levelId: 'nope' })).toBeNull()
    expect(resolveCeiling(scene, { ...ceiling, boundary: [[0, 0], [1, 0]] })).toBeNull()
  })
})

describe('validateCeiling', () => {
  it('a well-configured ceiling has no errors', () => {
    const { scene, ceiling } = makeCeiling()
    expect(validateCeiling(scene, ceiling)).toEqual([])
  })

  it('flags an unknown type or level', () => {
    const { scene, ceiling } = makeCeiling()
    expect(
      validateCeiling(scene, { ...ceiling, typeId: 'nope' }).some((e) => /unknown ceiling type/i.test(e)),
    ).toBe(true)
    expect(
      validateCeiling(scene, { ...ceiling, levelId: 'nope' }).some((e) => /unknown level/i.test(e)),
    ).toBe(true)
  })

  it('flags a self-intersecting boundary', () => {
    const { scene, ceiling } = makeCeiling({
      boundary: [
        [0, 0],
        [4, 3],
        [4, 0],
        [0, 3],
      ],
    })
    expect(validateCeiling(scene, ceiling).some((e) => /self-intersecting/i.test(e))).toBe(true)
  })
})

describe('ceiling lifecycle (scene mutations)', () => {
  it('is addressable and labelled by its type', () => {
    const { scene, ceiling } = makeCeiling()
    expect(findElement(scene, ceiling.id)?.kind).toBe('ceiling')
    expect(elementLabel(scene, ceiling.id)).toBeTruthy()
  })

  it('moveElement shifts every boundary vertex by the same delta', () => {
    const { scene, ceiling } = makeCeiling()
    const moved = moveElement(scene, ceiling.id, [2, -1])
    const m = moved.ceilings.find((c) => c.id === ceiling.id)!
    expect(m.boundary).toEqual([
      [2, -1],
      [6, -1],
      [6, 2],
      [2, 2],
    ])
  })

  it('transformElement (rotate) turns the boundary about the given centre', () => {
    const { scene, ceiling } = makeCeiling({
      boundary: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    })
    const rotated = transformElement(scene, ceiling.id, rotation(90, [0, 0]))
    const r = rotated.ceilings.find((c) => c.id === ceiling.id)!
    expect(r.boundary[1][0]).toBeCloseTo(0)
    expect(r.boundary[1][1]).toBeCloseTo(1)
  })

  it('duplicateElement copies the boundary as new arrays, not shared references', () => {
    const { scene, ceiling } = makeCeiling()
    const copy = duplicateElement(scene, ceiling.id)!
    expect(copy.id).not.toBe(ceiling.id)
    const original = copy.scene.ceilings.find((c) => c.id === ceiling.id)!
    const dup = copy.scene.ceilings.find((c) => c.id === copy.id)!
    expect(dup.boundary).toEqual(original.boundary)
    expect(dup.boundary[0]).not.toBe(original.boundary[0])
  })

  it('setElementType re-points the ceiling at a different type', () => {
    const { scene, ceiling } = makeCeiling()
    const retyped = setElementType(scene, ceiling.id, 'clt-plaster-15')
    expect(retyped.ceilings.find((c) => c.id === ceiling.id)!.typeId).toBe('clt-plaster-15')
  })

  it('updateCeiling patches in place', () => {
    const { scene, ceiling } = makeCeiling()
    const updated = updateCeiling(scene, ceiling.id, { top: { kind: 'unconnected', height: 3.2 } })
    expect(updated.ceilings.find((c) => c.id === ceiling.id)!.top).toEqual({
      kind: 'unconnected',
      height: 3.2,
    })
  })

  it('removeCeiling / deleteElement removes the ceiling', () => {
    const { scene, ceiling } = makeCeiling()
    expect(removeCeiling(scene, ceiling.id).ceilings).toHaveLength(0)
    expect(deleteElement(scene, ceiling.id).ceilings).toHaveLength(0)
  })

  it('deleting the LEVEL takes the ceiling with it', () => {
    const { scene, ceiling } = makeCeiling()
    const after = deleteElement(scene, ceiling.levelId)
    expect(after.ceilings.find((c) => c.id === ceiling.id)).toBeUndefined()
  })
})
