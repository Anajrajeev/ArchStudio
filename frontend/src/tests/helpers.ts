/** Shared fixtures for the test suite. */
import { emptySceneGraph, type SceneGraph, type Vec2 } from '../../../shared/types/scene'
import { addLevel, addWall, addFilledOpening } from '../scene/mutations'

export interface Fixture {
  scene: SceneGraph
  levelId: string
}

/** An empty project with one 2.8 m level. */
export function fixture(): Fixture {
  const withLevel = addLevel(emptySceneGraph('test-project'), 'Ground floor')
  return { scene: withLevel, levelId: withLevel.levels[0].id }
}

/** A project with a single straight wall of the given length along +X. */
export function withWall(
  length = 5,
  typeId = 'wt-ext-200',
): { scene: SceneGraph; levelId: string; wallId: string } {
  const f = fixture()
  const start: Vec2 = [0, 0]
  const end: Vec2 = [length, 0]
  const r = addWall(f.scene, {
    levelId: f.levelId,
    typeId,
    baseline: { kind: 'line', start, end },
  })
  return { scene: r.scene, levelId: f.levelId, wallId: r.id }
}

/** A wall with a door placed at the given centre offset. */
export function withDoor(centreOffset = 2.5): {
  scene: SceneGraph
  levelId: string
  wallId: string
  openingId: string
  fillingId: string
} {
  const w = withWall()
  const r = addFilledOpening(w.scene, w.wallId, 'dt-single-900', centreOffset)
  if (!r) throw new Error('fixture: failed to place door')
  return {
    scene: r.scene,
    levelId: w.levelId,
    wallId: w.wallId,
    openingId: r.openingId,
    fillingId: r.fillingId,
  }
}
