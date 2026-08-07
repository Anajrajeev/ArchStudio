/**
 * "Void to roof" verb tests (B1). See DECISIONS.md D-020 and `editor/roofVoid.ts`.
 */
import { describe, it, expect } from 'vitest'
import { splitRoofAndWalls, voidWallsToRoof } from '../editor/roofVoid'
import { isVerbError } from '../editor/verbResult'
import { addRoof, addWall } from '../scene/mutations'
import { defaultRoof } from '../../../shared/geometry/roof'
import type { Vec2 } from '../../../shared/types/scene'
import { fixture } from './helpers'

function sceneWithRoofAndWall() {
  const f = fixture()
  const footprint: Vec2[] = [
    [0, 0],
    [6, 0],
    [6, 4],
    [0, 4],
  ]
  const roof = defaultRoof('rf1', 'rt-tile-250', f.levelId, footprint, 3)
  const withRoof = addRoof(f.scene, roof)
  const w = addWall(withRoof, {
    levelId: f.levelId,
    typeId: 'wt-ext-200',
    baseline: { kind: 'line', start: [0, 0], end: [6, 0] },
  })
  return { scene: w.scene, wallId: w.id, roofId: roof.id }
}

describe('splitRoofAndWalls', () => {
  it('splits a valid selection into the roof and its walls', () => {
    const { scene, wallId, roofId } = sceneWithRoofAndWall()
    const result = splitRoofAndWalls(scene, [roofId, wallId])
    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.roofId).toBe(roofId)
      expect(result.wallIds).toEqual([wallId])
    }
  })

  it('refuses with no roof selected', () => {
    const { scene, wallId } = sceneWithRoofAndWall()
    expect('error' in splitRoofAndWalls(scene, [wallId])).toBe(true)
  })

  it('refuses with no wall selected', () => {
    const { scene, roofId } = sceneWithRoofAndWall()
    expect('error' in splitRoofAndWalls(scene, [roofId])).toBe(true)
  })

  it('refuses two roofs', () => {
    const { scene, wallId, roofId } = sceneWithRoofAndWall()
    const second = addRoof(scene, defaultRoof('rf2', 'rt-tile-250', scene.levels[0].id, [
      [10, 0],
      [16, 0],
      [16, 4],
      [10, 4],
    ], 3))
    expect('error' in splitRoofAndWalls(second, [roofId, 'rf2', wallId])).toBe(true)
  })

  it('refuses an id that is neither a roof nor a wall', () => {
    const { scene, wallId, roofId } = sceneWithRoofAndWall()
    expect('error' in splitRoofAndWalls(scene, [roofId, wallId, 'not-an-element'])).toBe(true)
  })
})

describe('voidWallsToRoof', () => {
  it('attaches a qualifying wall and reports it as the selection to keep', () => {
    const { scene, wallId, roofId } = sceneWithRoofAndWall()
    const result = voidWallsToRoof(scene, [roofId, wallId])
    if (isVerbError(result)) throw new Error(result.error)
    const wall = result.scene.walls.find((w) => w.id === wallId)!
    expect(wall.top).toEqual({ kind: 'roof', roofId })
    expect(result.selectAfter).toEqual([wallId])
    expect(result.label).toMatch(/void/i)
  })

  it('attaches every wall in a multi-wall selection', () => {
    const { scene, wallId, roofId } = sceneWithRoofAndWall()
    const second = addWall(scene, {
      levelId: scene.levels[0].id,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [1, 0], end: [4, 0] },
    })
    const result = voidWallsToRoof(second.scene, [roofId, wallId, second.id])
    if (isVerbError(result)) throw new Error(result.error)
    expect(result.selectAfter.sort()).toEqual([wallId, second.id].sort())
    for (const id of [wallId, second.id]) {
      expect(result.scene.walls.find((w) => w.id === id)!.top).toEqual({ kind: 'roof', roofId })
    }
  })

  it('refuses the WHOLE action if any one wall does not qualify — no partial attach', () => {
    const { scene, wallId, roofId } = sceneWithRoofAndWall()
    const offTrack = addWall(scene, {
      levelId: scene.levels[0].id,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [1, 1], end: [4, 1] },
    })
    const result = voidWallsToRoof(offTrack.scene, [roofId, wallId, offTrack.id])
    expect(isVerbError(result)).toBe(true)
    // The qualifying wall must be untouched — refusing the batch, not silently completing half.
    const untouched = offTrack.scene.walls.find((w) => w.id === wallId)!
    expect(untouched.top.kind).not.toBe('roof')
  })

  it('refuses a selection shape it does not understand', () => {
    const { scene, wallId } = sceneWithRoofAndWall()
    expect(isVerbError(voidWallsToRoof(scene, [wallId]))).toBe(true)
  })

  it('refuses a dangling roof id', () => {
    const { scene, wallId, roofId } = sceneWithRoofAndWall()
    const gone = { ...scene, roofs: scene.roofs.filter((r) => r.id !== roofId) }
    expect(isVerbError(voidWallsToRoof(gone, [roofId, wallId]))).toBe(true)
  })
})
