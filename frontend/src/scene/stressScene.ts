/**
 * A deterministic stress-test scene for E1 (the 60 fps performance target — never measured before
 * this pass). 3 storeys, a grid of rooms per storey giving 90+ walls total, and 40+ placeholder
 * furniture items — the exact shape PHASE1-STATUS.md's E1 row calls for.
 *
 * Not part of the normal editing surface: there is no save/load yet (Phase 2), so this is loaded
 * through the dev-only debug bridge (`window.__archstudio.loadStressScene()`, see
 * `viewport/Viewport.tsx`'s `DebugBridge`) rather than through a file. Building it via the same
 * `addLevel`/`addWall`/`addFurniture` mutations the editor itself uses guarantees the generated
 * elements are exactly as valid as anything a user could draw — no hand-crafted shortcuts that
 * might not stress the real rendering path.
 */
import { emptySceneGraph, type SceneGraph, type FurnitureTypeDef } from '../../../shared/types/scene'
import { addLevel, addWall, addFurniture } from './mutations'

const ROOM_SIZE = 4 // metres, square rooms
const GRID_COLS = 4
const GRID_ROWS = 3
const STOREYS = 3
const FURNITURE_PER_STOREY = 14

/** A placeholder furniture type, added to the generated scene itself — not to DEFAULT_TYPES,
 * since nothing outside this generator should ever need it. */
const STRESS_FURNITURE_TYPE: FurnitureTypeDef = {
  id: 'stress-furniture',
  category: 'furniture',
  name: 'Stress-test placeholder',
  catalogId: null,
  footprint: [0.6, 0.6],
  heightMeters: 0.8,
  material: 'mat-timber',
}

export const STRESS_SCENE_STATS = {
  storeys: STOREYS,
  wallsPerStorey: (GRID_ROWS + 1) * GRID_COLS + (GRID_COLS + 1) * GRID_ROWS,
  furniturePerStorey: FURNITURE_PER_STOREY,
} as const

export function generateStressScene(): SceneGraph {
  let scene = emptySceneGraph('stress-test')
  scene = { ...scene, types: [...scene.types, STRESS_FURNITURE_TYPE] }

  for (let i = 0; i < STOREYS; i++) {
    scene = addLevel(scene, `Stress floor ${i + 1}`, 2.8)
  }

  for (const level of [...scene.levels].sort((a, b) => a.elevation - b.elevation)) {
    // A GRID_COLS x GRID_ROWS grid of square rooms, each edge split into one wall per room-width
    // rather than one long run — so every wall is a genuinely separate scene element, which is
    // the case that stresses per-element overhead (draw calls, pick targets), not just triangles.
    for (let row = 0; row <= GRID_ROWS; row++) {
      const y = row * ROOM_SIZE
      for (let col = 0; col < GRID_COLS; col++) {
        const x0 = col * ROOM_SIZE
        const r = addWall(scene, {
          levelId: level.id,
          typeId: 'wt-ext-200',
          baseline: { kind: 'line', start: [x0, y], end: [x0 + ROOM_SIZE, y] },
        })
        scene = r.scene
      }
    }
    for (let col = 0; col <= GRID_COLS; col++) {
      const x = col * ROOM_SIZE
      for (let row = 0; row < GRID_ROWS; row++) {
        const y0 = row * ROOM_SIZE
        const r = addWall(scene, {
          levelId: level.id,
          typeId: 'wt-int-100',
          baseline: { kind: 'line', start: [x, y0], end: [x, y0 + ROOM_SIZE] },
        })
        scene = r.scene
      }
    }

    for (let i = 0; i < FURNITURE_PER_STOREY; i++) {
      const cx = ROOM_SIZE / 2 + (i % GRID_COLS) * ROOM_SIZE
      const cy = ROOM_SIZE / 2 + (Math.floor(i / GRID_COLS) % GRID_ROWS) * ROOM_SIZE
      const r = addFurniture(scene, level.id, 'stress-furniture', [cx, cy])
      scene = r.scene
    }
  }

  return scene
}
