/**
 * Sanity check for the E1 stress scene generator — the numbers PHASE1-STATUS.md's E1 row asks
 * for (3 storeys, 60+ walls, 40 furniture) and basic validity of every generated element.
 */
import { describe, it, expect } from 'vitest'
import { generateStressScene } from '../scene/stressScene'
import { validateWall } from '../../../shared/geometry/index'

describe('generateStressScene', () => {
  const scene = generateStressScene()

  it('has 3 storeys', () => {
    expect(scene.levels).toHaveLength(3)
  })

  it('has at least 60 walls', () => {
    expect(scene.walls.length).toBeGreaterThanOrEqual(60)
  })

  it('has at least 40 furniture items', () => {
    expect(scene.furniture.length).toBeGreaterThanOrEqual(40)
  })

  it('every wall resolves and validates cleanly', () => {
    for (const wall of scene.walls) {
      expect(validateWall(scene, wall)).toEqual([])
    }
  })

  it('every furniture item references a real type and level', () => {
    for (const item of scene.furniture) {
      expect(scene.types.some((t) => t.id === item.typeId)).toBe(true)
      expect(scene.levels.some((l) => l.id === item.levelId)).toBe(true)
    }
  })

  it('is deterministic — generating twice gives the same counts', () => {
    const again = generateStressScene()
    expect(again.walls.length).toBe(scene.walls.length)
    expect(again.furniture.length).toBe(scene.furniture.length)
  })
})
