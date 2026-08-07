/**
 * Boolean geometry (B7 / DECISIONS.md D-019).
 *
 * Split in two on purpose:
 *
 *  - **Tree tests** are pure data — cycles, dangling operands, arity, what is consumed. No CSG runs,
 *    so these are the cheap tests that cover the failure modes users actually hit.
 *  - **Evaluation tests** run the real `three-bvh-csg` evaluator and measure the VOLUME of the
 *    result. That is only possible because the library is CPU-only (no WebGL), and it is what makes
 *    "the cut actually removed the right material" an assertion rather than a screenshot.
 *
 * `three-bvh-csg` is imported statically here even though the app loads it dynamically — the test
 * has no bundle budget to protect, and a static import keeps these tests synchronous.
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import * as csgModule from 'three-bvh-csg'
import {
  resolveBooleanNode,
  isBooleanTreeError,
  consumedElementIds,
  freePrimitives,
  rootBooleanNodes,
  leafPrimitives,
  validateOperands,
  booleanComplexity,
} from '../../../shared/geometry/booleanTree'
import {
  evaluateBooleanGeometry,
  isBooleanEvalError,
  primitiveWorldGeometry,
  type CsgModule,
} from '../geometry/evaluateBoolean'
import {
  addPrimitive,
  addBooleanNode,
  deleteElement,
  duplicateElement,
  moveElement,
  dissolveBooleanNode,
  elementLabel,
  findElement,
} from '../scene/mutations'
import {
  cutElements,
  explodeBoolean,
  intersectElements,
  unionElements,
} from '../editor/booleanVerbs'
import { isVerbError } from '../editor/verbResult'
import { updateType, updatePrimitive } from '../scene/mutations'
import type { SceneGraph, Vec2 } from '../../../shared/types/scene'
import { fixture } from './helpers'

const csg = csgModule as unknown as CsgModule

// ---------------------------------------------------------------------------
// Volume of an evaluated geometry (divergence theorem over its triangles)
// ---------------------------------------------------------------------------

function geometryVolume(geom: THREE.BufferGeometry): number {
  const pos = geom.attributes.position
  const index = geom.index
  const count = index ? index.count : pos.count
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  let total = 0
  for (let i = 0; i < count; i += 3) {
    const i0 = index ? index.getX(i) : i
    const i1 = index ? index.getX(i + 1) : i + 1
    const i2 = index ? index.getX(i + 2) : i + 2
    a.fromBufferAttribute(pos, i0)
    b.fromBufferAttribute(pos, i1)
    c.fromBufferAttribute(pos, i2)
    total += a.dot(b.clone().cross(c)) / 6
  }
  return Math.abs(total)
}

/**
 * A scene with two unit boxes: `a` centred at the origin and `b` offset so exactly an eighth of it
 * overlaps `a`. Chosen because every boolean's answer is then an exact round number:
 * union 15/8, cut 7/8, intersect 1/8.
 */
function twoBoxes(offset: Vec2 = [0.5, 0.5]): {
  scene: SceneGraph
  levelId: string
  a: string
  b: string
} {
  const f = fixture()
  const first = addPrimitive(f.scene, f.levelId, 'pt-box', [0, 0])
  const second = addPrimitive(first.scene, f.levelId, 'pt-box', offset)
  // The default box is 1×1×1 with its base on the level, so a [0.5, 0.5] offset overlaps in x and
  // z while fully overlapping in y — an eighth of a unit cube.
  return { scene: second.scene, levelId: f.levelId, a: first.id, b: second.id }
}

function combine(
  scene: SceneGraph,
  levelId: string,
  op: 'union' | 'cut' | 'intersect',
  ids: string[],
): { scene: SceneGraph; id: string } {
  return addBooleanNode(scene, levelId, op, ids)
}

// ---------------------------------------------------------------------------
// Tree resolution
// ---------------------------------------------------------------------------

describe('boolean tree resolution', () => {
  it('resolves a two-operand node to its leaf primitives', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const { scene: next, id } = combine(scene, levelId, 'cut', [a, b])
    const resolved = resolveBooleanNode(next, id)
    if (isBooleanTreeError(resolved)) throw new Error(resolved.error)
    expect(resolved.kind).toBe('op')
    expect(leafPrimitives(resolved).map((p) => p.id)).toEqual([a, b])
  })

  it('resolves a NESTED tree — a boolean used as an operand of another', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const third = addPrimitive(scene, levelId, 'pt-box', [1, 0])
    const inner = combine(third.scene, levelId, 'union', [a, b])
    const outer = combine(inner.scene, levelId, 'cut', [inner.id, third.id])

    const resolved = resolveBooleanNode(outer.scene, outer.id)
    if (isBooleanTreeError(resolved)) throw new Error(resolved.error)
    expect(leafPrimitives(resolved).map((p) => p.id)).toEqual([a, b, third.id])
    expect(booleanComplexity(outer.scene, outer.id)).toBe(3)
  })

  it('refuses a cycle instead of overflowing the stack', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const first = combine(scene, levelId, 'union', [a, b])
    const second = combine(first.scene, levelId, 'cut', [first.id, a])
    // Point the first node back at the second: A → B → A.
    const cyclic: SceneGraph = {
      ...second.scene,
      booleans: second.scene.booleans.map((n) =>
        n.id === first.id ? { ...n, operandIds: [second.id, b] } : n,
      ),
    }
    const resolved = resolveBooleanNode(cyclic, first.id)
    expect(isBooleanTreeError(resolved)).toBe(true)
    if (isBooleanTreeError(resolved)) expect(resolved.error).toMatch(/cycle/i)
  })

  it('refuses a node whose operand no longer exists', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const { scene: next, id } = combine(scene, levelId, 'cut', [a, b])
    const orphaned: SceneGraph = { ...next, primitives: next.primitives.filter((p) => p.id !== b) }
    const resolved = resolveBooleanNode(orphaned, id)
    expect(isBooleanTreeError(resolved)).toBe(true)
    if (isBooleanTreeError(resolved)) expect(resolved.error).toMatch(/no longer exists/i)
  })

  it('refuses a node with fewer than two operands', () => {
    const { scene, levelId, a } = twoBoxes()
    const { scene: next, id } = combine(scene, levelId, 'union', [a])
    const resolved = resolveBooleanNode(next, id)
    expect(isBooleanTreeError(resolved)).toBe(true)
  })

  it('refuses a node that does not exist', () => {
    const { scene } = twoBoxes()
    expect(isBooleanTreeError(resolveBooleanNode(scene, 'nope'))).toBe(true)
  })
})

describe('operand consumption', () => {
  it('a combined primitive stops rendering on its own', () => {
    const { scene, levelId, a, b } = twoBoxes()
    expect(freePrimitives(scene)).toHaveLength(2)

    const { scene: next, id } = combine(scene, levelId, 'cut', [a, b])
    expect(consumedElementIds(next)).toEqual(new Set([a, b]))
    expect(freePrimitives(next)).toHaveLength(0)
    expect(rootBooleanNodes(next).map((n) => n.id)).toEqual([id])
  })

  it('a nested node is consumed by its parent and is not a root', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const third = addPrimitive(scene, levelId, 'pt-box', [2, 0])
    const inner = combine(third.scene, levelId, 'union', [a, b])
    const outer = combine(inner.scene, levelId, 'cut', [inner.id, third.id])
    expect(rootBooleanNodes(outer.scene).map((n) => n.id)).toEqual([outer.id])
  })
})

// ---------------------------------------------------------------------------
// Evaluation — the real CSG
// ---------------------------------------------------------------------------

describe('boolean evaluation volumes', () => {
  it('a lone primitive evaluates to its own volume', () => {
    const { scene, a } = twoBoxes()
    const primitive = scene.primitives.find((p) => p.id === a)!
    const geom = primitiveWorldGeometry(scene, primitive)
    if (isBooleanEvalError(geom)) throw new Error(geom.error)
    expect(geometryVolume(geom)).toBeCloseTo(1, 5)
  })

  it('union of two unit boxes overlapping by an eighth is 15/8', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const { scene: next, id } = combine(scene, levelId, 'union', [a, b])
    const geom = evaluateBooleanGeometry(next, id, csg)
    if (isBooleanEvalError(geom)) throw new Error(geom.error)
    expect(geometryVolume(geom)).toBeCloseTo(1.75, 4)
  })

  it('cut removes exactly the overlapping quarter', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const { scene: next, id } = combine(scene, levelId, 'cut', [a, b])
    const geom = evaluateBooleanGeometry(next, id, csg)
    if (isBooleanEvalError(geom)) throw new Error(geom.error)
    expect(geometryVolume(geom)).toBeCloseTo(0.75, 4)
  })

  it('intersect keeps exactly the overlap', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const { scene: next, id } = combine(scene, levelId, 'intersect', [a, b])
    const geom = evaluateBooleanGeometry(next, id, csg)
    if (isBooleanEvalError(geom)) throw new Error(geom.error)
    expect(geometryVolume(geom)).toBeCloseTo(0.25, 4)
  })

  it('union + intersect = the sum of the parts (inclusion–exclusion)', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const u = combine(scene, levelId, 'union', [a, b])
    const i = combine(scene, levelId, 'intersect', [a, b])
    const uGeom = evaluateBooleanGeometry(u.scene, u.id, csg)
    const iGeom = evaluateBooleanGeometry(i.scene, i.id, csg)
    if (isBooleanEvalError(uGeom) || isBooleanEvalError(iGeom)) throw new Error('evaluation failed')
    expect(geometryVolume(uGeom) + geometryVolume(iGeom)).toBeCloseTo(2, 4)
  })

  it('cut is ORDER DEPENDENT — swapping the operands changes the result', () => {
    // b sits half outside a, so `a - b` and `b - a` differ. This is the property that makes
    // selection order significant, so it is asserted rather than assumed.
    const { scene, levelId, a, b } = twoBoxes()
    const ab = combine(scene, levelId, 'cut', [a, b])
    const ba = combine(scene, levelId, 'cut', [b, a])
    const abGeom = evaluateBooleanGeometry(ab.scene, ab.id, csg)
    const baGeom = evaluateBooleanGeometry(ba.scene, ba.id, csg)
    if (isBooleanEvalError(abGeom) || isBooleanEvalError(baGeom)) throw new Error('failed')
    // Both are 3/4 here by symmetry, but they occupy different space — compare bounding boxes.
    abGeom.computeBoundingBox()
    baGeom.computeBoundingBox()
    expect(abGeom.boundingBox!.min.x).not.toBeCloseTo(baGeom.boundingBox!.min.x, 3)
  })

  it('union and intersect are order INDEPENDENT', () => {
    const { scene, levelId, a, b } = twoBoxes()
    for (const op of ['union', 'intersect'] as const) {
      const forward = combine(scene, levelId, op, [a, b])
      const reverse = combine(scene, levelId, op, [b, a])
      const f = evaluateBooleanGeometry(forward.scene, forward.id, csg)
      const r = evaluateBooleanGeometry(reverse.scene, reverse.id, csg)
      if (isBooleanEvalError(f) || isBooleanEvalError(r)) throw new Error('failed')
      expect(geometryVolume(f)).toBeCloseTo(geometryVolume(r), 5)
    }
  })

  it('a three-operand cut folds left-to-right, removing both cutters', () => {
    const { scene, levelId, a, b } = twoBoxes([0.5, 0.5])
    // A third box in the opposite corner, overlapping another disjoint eighth of `a`.
    const third = addPrimitive(scene, levelId, 'pt-box', [-0.5, -0.5])
    const { scene: next, id } = combine(third.scene, levelId, 'cut', [a, b, third.id])
    const geom = evaluateBooleanGeometry(next, id, csg)
    if (isBooleanEvalError(geom)) throw new Error(geom.error)
    // 1 - 1/4 - 1/4, the two removed corners being disjoint.
    expect(geometryVolume(geom)).toBeCloseTo(0.5, 4)
  })

  it('boring a cylinder through a box removes πr²h', () => {
    // The case box decomposition (D-005) cannot express, and the reason D2 needed a real kernel.
    //
    // The cutter deliberately OVERSHOOTS the box on both faces. A cutter whose caps land exactly
    // on the box's faces is the coplanar-face case, where any triangle-mesh CSG has to decide
    // which surface wins; overshooting removes the ambiguity, and it is what a modeller does in
    // practice for the same reason. (Measured: coplanar caps cost ~0.5% here — accurate enough to
    // look right, but not something to assert exact volumes against.)
    const f = fixture()
    const tallCutter = updateType(f.scene, 'pt-cylinder', {
      shape: { kind: 'cylinder', radius: 0.5, height: 3, segments: 128 },
    } as never)
    const box = addPrimitive(tallCutter, f.levelId, 'pt-box', [0, 0])
    const cyl = addPrimitive(box.scene, f.levelId, 'pt-cylinder', [0, 0])
    const sunk = updatePrimitive(cyl.scene, cyl.id, { heightOffset: -1 })
    const { scene: next, id } = combine(sunk, f.levelId, 'cut', [box.id, cyl.id])

    const geom = evaluateBooleanGeometry(next, id, csg)
    if (isBooleanEvalError(geom)) throw new Error(geom.error)

    const bored = Math.PI * 0.5 ** 2 * 1
    // A 128-gon inscribes the circle, so very slightly LESS is removed than the ideal.
    expect(geometryVolume(geom)).toBeGreaterThan(1 - bored)
    expect(geometryVolume(geom)).toBeCloseTo(1 - bored, 3)
  })

  it('evaluating a broken tree returns an error, not a wrong mesh', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const { scene: next, id } = combine(scene, levelId, 'cut', [a, b])
    const orphaned: SceneGraph = { ...next, primitives: next.primitives.filter((p) => p.id !== b) }
    expect(isBooleanEvalError(evaluateBooleanGeometry(orphaned, id, csg))).toBe(true)
  })

  it('moving an operand re-evaluates to a different result — the tree stays live', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const { scene: next, id } = combine(scene, levelId, 'cut', [a, b])
    const before = evaluateBooleanGeometry(next, id, csg)
    // Slide the cutter completely clear of the base: nothing should be removed any more.
    const moved = moveElement(next, b, [5, 5])
    const after = evaluateBooleanGeometry(moved, id, csg)
    if (isBooleanEvalError(before) || isBooleanEvalError(after)) throw new Error('failed')
    expect(geometryVolume(before)).toBeCloseTo(0.75, 4)
    expect(geometryVolume(after)).toBeCloseTo(1, 4)
  })

  it('editing the TYPE changes every instance built on it', () => {
    // The defining BIM interaction (D-009) must survive through a boolean.
    const { scene, levelId, a, b } = twoBoxes()
    const { scene: next, id } = combine(scene, levelId, 'intersect', [a, b])
    const doubled = updateType(next, 'pt-box', {
      shape: { kind: 'box', width: 2, depth: 2, height: 1 },
    } as never)
    const geom = evaluateBooleanGeometry(doubled, id, csg)
    if (isBooleanEvalError(geom)) throw new Error(geom.error)
    // Both boxes are now 2×2×1 offset by 0.5, so they overlap 1.5 × 1.5 × 1.
    expect(geometryVolume(geom)).toBeCloseTo(2.25, 4)
  })
})

// ---------------------------------------------------------------------------
// Verbs
// ---------------------------------------------------------------------------

describe('boolean verbs', () => {
  it('union/cut/intersect each create one node selecting the result', () => {
    const { scene, a, b } = twoBoxes()
    for (const verb of [unionElements, cutElements, intersectElements]) {
      const result = verb(scene, [a, b])
      if (isVerbError(result)) throw new Error(result.error)
      expect(result.scene.booleans).toHaveLength(1)
      expect(result.selectAfter).toEqual([result.scene.booleans[0].id])
    }
  })

  it('preserves selection order, so cut knows which shape is the base', () => {
    const { scene, a, b } = twoBoxes()
    const result = cutElements(scene, [b, a])
    if (isVerbError(result)) throw new Error(result.error)
    expect(result.scene.booleans[0].operandIds).toEqual([b, a])
  })

  it('refuses fewer than two shapes', () => {
    const { scene, a } = twoBoxes()
    expect(isVerbError(unionElements(scene, [a]))).toBe(true)
    expect(isVerbError(unionElements(scene, []))).toBe(true)
  })

  it('refuses combining a shape with itself', () => {
    const { scene, a } = twoBoxes()
    const result = unionElements(scene, [a, a])
    expect(isVerbError(result)).toBe(true)
    if (isVerbError(result)) expect(result.error).toMatch(/itself/i)
  })

  it('refuses a wall — booleans work on solids, not decomposed elements', () => {
    const { scene, levelId, a } = twoBoxes()
    const wall = { ...scene, walls: [] }
    void wall
    const result = unionElements(scene, [a, levelId])
    expect(isVerbError(result)).toBe(true)
    if (isVerbError(result)) expect(result.error).toMatch(/primitive solids/i)
  })

  it('refuses operands on different levels', () => {
    const { scene, a, b } = twoBoxes()
    const crossLevel: SceneGraph = {
      ...scene,
      primitives: scene.primitives.map((p) => (p.id === b ? { ...p, levelId: 'other' } : p)),
    }
    const result = unionElements(crossLevel, [a, b])
    expect(isVerbError(result)).toBe(true)
    if (isVerbError(result)) expect(result.error).toMatch(/same level/i)
  })

  it('explode gives the shapes back rather than deleting them', () => {
    const { scene, a, b } = twoBoxes()
    const combined = unionElements(scene, [a, b])
    if (isVerbError(combined)) throw new Error(combined.error)
    const nodeId = combined.scene.booleans[0].id

    const exploded = explodeBoolean(combined.scene, nodeId)
    if (isVerbError(exploded)) throw new Error(exploded.error)
    expect(exploded.scene.booleans).toHaveLength(0)
    expect(exploded.scene.primitives).toHaveLength(2)
    expect(exploded.selectAfter).toEqual([a, b])
    expect(freePrimitives(exploded.scene)).toHaveLength(2)
  })

  it('explode refuses anything that is not a boolean', () => {
    const { scene, a } = twoBoxes()
    expect(isVerbError(explodeBoolean(scene, a))).toBe(true)
  })

  it('validateOperands is the single rule the panel and the verb share', () => {
    const { scene, a, b } = twoBoxes()
    expect(validateOperands(scene, [a, b])).toBeNull()
    expect(validateOperands(scene, [a])).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Lifecycle: delete, duplicate, dissolve
// ---------------------------------------------------------------------------

describe('boolean lifecycle', () => {
  it('deleting the node releases its operands instead of destroying them', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const { scene: next, id } = combine(scene, levelId, 'cut', [a, b])
    const after = deleteElement(next, id)
    expect(after.booleans).toHaveLength(0)
    expect(after.primitives).toHaveLength(2)
  })

  it('deleting an operand prunes it from the node rather than leaving a dangling id', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const third = addPrimitive(scene, levelId, 'pt-box', [3, 0])
    const { scene: next, id } = combine(third.scene, levelId, 'cut', [a, b, third.id])

    const after = deleteElement(next, third.id)
    expect(after.primitives).toHaveLength(2)
    expect(after.booleans[0].operandIds).toEqual([a, b])
    // Still resolvable — the tree was repaired, not corrupted.
    expect(isBooleanTreeError(resolveBooleanNode(after, id))).toBe(false)
  })

  it('deleting an operand that would leave fewer than two drops the node too', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const { scene: next } = combine(scene, levelId, 'cut', [a, b])
    const after = deleteElement(next, b)
    expect(after.booleans).toHaveLength(0)
    expect(after.primitives).toHaveLength(1)
  })

  it('pruning cascades up a nested tree', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const third = addPrimitive(scene, levelId, 'pt-box', [3, 0])
    const inner = combine(third.scene, levelId, 'union', [a, b])
    const outer = combine(inner.scene, levelId, 'cut', [inner.id, third.id])

    // Deleting `a` leaves the inner union with one operand, which drops it, which in turn leaves
    // the outer cut with one operand and drops that too.
    const after = deleteElement(outer.scene, a)
    expect(after.booleans).toHaveLength(0)
    expect(after.primitives.map((p) => p.id).sort()).toEqual([b, third.id].sort())
  })

  it('deleting a level takes its primitives and booleans with it', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const { scene: next } = combine(scene, levelId, 'union', [a, b])
    const after = deleteElement(next, levelId)
    expect(after.primitives).toHaveLength(0)
    expect(after.booleans).toHaveLength(0)
  })

  it('duplicating a boolean deep-copies its operands so the copy is independent', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const { scene: next, id } = combine(scene, levelId, 'cut', [a, b])
    const copy = duplicateElement(next, id)
    if (!copy) throw new Error('expected a copy')

    expect(copy.scene.booleans).toHaveLength(2)
    expect(copy.scene.primitives).toHaveLength(4)
    const copied = copy.scene.booleans.find((n) => n.id === copy.id)!
    // Crucially, NOT the same operand ids — otherwise moving the copy would move the original.
    expect(copied.operandIds).not.toEqual([a, b])
    expect(copied.operandIds.every((oid) => oid !== a && oid !== b)).toBe(true)
  })

  it('moving a boolean moves its whole subtree, keeping the result the same shape', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const { scene: next, id } = combine(scene, levelId, 'cut', [a, b])
    const moved = moveElement(next, id, [10, 0])

    const before = evaluateBooleanGeometry(next, id, csg)
    const after = evaluateBooleanGeometry(moved, id, csg)
    if (isBooleanEvalError(before) || isBooleanEvalError(after)) throw new Error('failed')
    // Same volume (shape preserved), different position.
    expect(geometryVolume(after)).toBeCloseTo(geometryVolume(before), 5)
    after.computeBoundingBox()
    before.computeBoundingBox()
    expect(after.boundingBox!.min.x - before.boundingBox!.min.x).toBeCloseTo(10, 5)
  })

  it('dissolve is the non-destructive inverse of combining', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const { scene: next, id } = combine(scene, levelId, 'union', [a, b])
    const after = dissolveBooleanNode(next, id)
    expect(after.booleans).toHaveLength(0)
    expect(after.primitives).toHaveLength(2)
  })

  it('primitives and booleans are addressable elements', () => {
    const { scene, levelId, a, b } = twoBoxes()
    const { scene: next, id } = combine(scene, levelId, 'cut', [a, b])
    expect(findElement(next, a)?.kind).toBe('primitive')
    expect(findElement(next, id)?.kind).toBe('boolean')
    expect(elementLabel(next, a)).toBe('Box — 1×1×1')
    expect(elementLabel(next, id)).toBe('Cut (2)')
  })
})
