/**
 * The export path (`export/buildSceneGroup.ts`) — the other half of the one-geometry rule.
 *
 * There was no test here at all, which is how "the viewport drew a roof that no exported file
 * contained" shipped and stayed shipped until B7 noticed it by hand (D-019). The first test below
 * is the general guard that would have caught it: every element collection with contents must
 * produce at least one mesh in the exported group.
 *
 * The rest check the two things this pass added to that path — curtain walls, and wall boxes whose
 * ends are mitred by a join — since a mitre that the viewport draws and the exporter squares off
 * would be exactly the same class of silent divergence.
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  emptySceneGraph,
  type SceneGraph,
  type Vec2,
  type WallJoin,
} from '../../../shared/types/scene'
import { addLevel, addWall, addCurtainWall } from '../scene/mutations'
import { buildSceneGroup, disposeSceneGroup } from '../export/buildSceneGroup'
import { resolveWall, wallSolidBoxes, boxCorners } from '../../../shared/geometry/index'
import { resolveWallJoins } from '../../../shared/geometry/wallJoin'

/** Every mesh name in the exported group. Names are `kind:id[:part]` by convention. */
function meshNames(group: THREE.Group): string[] {
  const names: string[] = []
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) names.push(o.name)
  })
  return names
}

function cornerScene(): { scene: SceneGraph; wallIds: string[]; levelId: string } {
  const base = addLevel(emptySceneGraph('p'), 'Ground')
  const levelId = base.levels[0].id
  const a = addWall(base, {
    levelId,
    typeId: 'wt-ext-200',
    baseline: { kind: 'line', start: [0, 0] as Vec2, end: [5, 0] as Vec2 },
  })
  const b = addWall(a.scene, {
    levelId,
    typeId: 'wt-ext-200',
    baseline: { kind: 'line', start: [5, 0] as Vec2, end: [5, 4] as Vec2 },
  })
  return { scene: b.scene, wallIds: [a.id, b.id], levelId }
}

describe('buildSceneGroup — the one-geometry rule', () => {
  it('emits at least one mesh for every element kind the scene contains', () => {
    // The general guard. A new element kind wired into a renderer but not into the exporter fails
    // here rather than being noticed by hand months later.
    const { scene, levelId } = cornerScene()
    const withMore: SceneGraph = {
      ...scene,
      slabs: [
        {
          id: 'sl1',
          typeId: 'st-floor-200',
          levelId,
          boundary: [
            [0, 0],
            [5, 0],
            [5, 4],
            [0, 4],
          ],
          heightOffset: 0,
          openings: [],
        },
      ],
      columns: [
        {
          id: 'c1',
          typeId: 'ct-rect-300',
          levelId,
          position: [1, 1],
          baseOffset: 0,
          top: { kind: 'unconnected', height: 3 },
          rotation: 0,
        },
      ],
      beams: [
        {
          id: 'b1',
          typeId: 'bt-rect-200x400',
          levelId,
          start: [0, 0],
          end: [5, 0],
          heightOffset: 3,
          crossSectionRotation: 0,
        },
      ],
      curtainWalls: [
        {
          id: 'cw1',
          typeId: 'cwt-glazed-1500',
          levelId,
          baseline: { kind: 'line', start: [0, 6], end: [6, 6] },
          baseOffset: 0,
          top: { kind: 'unconnected', height: 3 },
        },
      ],
    }

    const group = buildSceneGroup(withMore)
    const names = meshNames(group)
    for (const prefix of ['wall:', 'slab:', 'column:', 'beam:', 'curtainwall:']) {
      expect(
        names.some((n) => n.startsWith(prefix)),
        `${prefix} produced no mesh in the exported group`,
      ).toBe(true)
    }
    disposeSceneGroup(group)
  })

  it('exports a curtain wall as framing AND glazing, not one merged blob', () => {
    const base = addLevel(emptySceneGraph('p'), 'Ground')
    const { scene } = addCurtainWall(base, {
      typeId: 'cwt-glazed-1500',
      levelId: base.levels[0].id,
      baseline: { kind: 'line', start: [0, 0], end: [6, 0] },
      baseOffset: 0,
      top: { kind: 'unconnected', height: 3 },
    })
    const group = buildSceneGroup(scene)
    const names = meshNames(group)
    expect(names.some((n) => n.includes(':mullion:'))).toBe(true)
    expect(names.some((n) => n.includes(':panel:'))).toBe(true)
    disposeSceneGroup(group)
  })

  it('exports a JOINED corner at exactly the geometry the viewport draws', () => {
    // The mitre only exists if the exporter runs the same `resolveWallJoins` the renderer does.
    // Comparing against `boxCorners` — the function box-select also reads — is what makes this a
    // real one-geometry check rather than a "did it emit something" check.
    const { scene, wallIds, levelId } = cornerScene()
    const join: WallJoin = {
      id: 'wj1',
      levelId,
      memberIds: wallIds,
      point: [5, 0],
      style: 'miter',
      throughId: null,
    }
    const joined: SceneGraph = { ...scene, wallJoins: [join] }

    const adjust = resolveWallJoins(joined, levelId)
    expect(adjust.size).toBe(2)

    const group = buildSceneGroup(joined)
    const exported: THREE.Mesh[] = []
    group.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && m.name.startsWith('wall:')) exported.push(m)
    })
    expect(exported).toHaveLength(2)

    for (const wall of joined.walls) {
      const resolved = resolveWall(joined, wall)!
      const boxes = wallSolidBoxes(resolved, [], adjust.get(wall.id))
      expect(boxes).toHaveLength(1)
      // A mitred box is not a BoxGeometry — it must have gone through boxToTriMesh.
      expect(boxes[0].endSkew).toBeDefined()

      const mesh = exported.find((m) => m.name.startsWith(`wall:${wall.id}:`))!
      const pos = mesh.geometry.attributes.position
      const exportedPts = new Set<string>()
      for (let i = 0; i < pos.count; i++) {
        exportedPts.add(
          [pos.getX(i), pos.getY(i), pos.getZ(i)].map((n) => n.toFixed(4)).join(','),
        )
      }
      for (const c of boxCorners(boxes[0])) {
        expect(
          exportedPts.has(c.map((n) => n.toFixed(4)).join(',')),
          `exported wall ${wall.id} is missing corner ${c.join(',')}`,
        ).toBe(true)
      }
    }
    disposeSceneGroup(group)
  })

  it('exports an UNJOINED wall as a plain box, so nothing about the old path changed', () => {
    const { scene } = cornerScene()
    const group = buildSceneGroup(scene)
    const walls: THREE.Mesh[] = []
    group.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && m.name.startsWith('wall:')) walls.push(m)
    })
    expect(walls).toHaveLength(2)
    for (const m of walls) expect(m.geometry.type).toBe('BoxGeometry')
    disposeSceneGroup(group)
  })
})
