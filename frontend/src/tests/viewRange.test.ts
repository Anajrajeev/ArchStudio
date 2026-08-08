/**
 * View range and plan regions (C7 / D-029), and the underlay's share of it (C8 / D-030).
 *
 * The load-bearing assertion here is the SCOPED RULE: an element belongs wholly to whichever
 * region contains its plan anchor, and nothing is split at a boundary. `planAnchor` therefore has
 * to answer for every element kind — a kind with no anchor would silently fall outside every
 * region and always use the view's default range, which is exactly the kind of quiet wrong answer
 * D-029 exists to avoid.
 */
import { describe, it, expect } from 'vitest'
import {
  ELEMENT_COLLECTIONS,
  defaultViewRange,
  emptySceneGraph,
  findPlanView,
  planViewFor,
  type PlanRegion,
  type SceneGraph,
  type Vec2,
} from '../../../shared/types/scene'
import { addLevel, addColumn, addWall } from '../scene/mutations'
import {
  clipBandFor,
  partitionByRegion,
  planAnchor,
  regionAt,
  validatePlanRegion,
} from '../../../shared/geometry/viewRange'

describe('clipBandFor', () => {
  it('resolves offsets against the level, not absolute world Y', () => {
    const band = clipBandFor(3, { cutHeight: 1.2, topOffset: 3, bottomOffset: 0, viewDepth: 0 })
    expect(band.top).toBeCloseTo(4.2)
    expect(band.bottom).toBeCloseTo(3)
    expect(band.beyond).toBeCloseTo(3)
  })

  it('never lets the range top rise above the cut — the cut is what a plan view is for', () => {
    const band = clipBandFor(0, { cutHeight: 1.2, topOffset: 10, bottomOffset: 0, viewDepth: 0 })
    expect(band.top).toBeCloseTo(1.2)
  })

  it('uses the range top when it is BELOW the cut', () => {
    const band = clipBandFor(0, { cutHeight: 2.4, topOffset: 1, bottomOffset: 0, viewDepth: 0 })
    expect(band.top).toBeCloseTo(1)
  })

  it('extends the drawn band downwards by the view depth', () => {
    const band = clipBandFor(0, { cutHeight: 1.2, topOffset: 3, bottomOffset: 0, viewDepth: 0.6 })
    expect(band.bottom).toBeCloseTo(0)
    expect(band.beyond).toBeCloseTo(-0.6)
  })

  it('treats a negative view depth as none rather than inverting the band', () => {
    const band = clipBandFor(0, { cutHeight: 1.2, topOffset: 3, bottomOffset: 0, viewDepth: -5 })
    expect(band.beyond).toBeCloseTo(0)
  })
})

// ---------------------------------------------------------------------------

/** A scene with one level, its plan view, and one element of every anchorable kind. */
function fullScene(): SceneGraph {
  let scene = addLevel(emptySceneGraph('p'), 'Ground')
  const levelId = scene.levels[0].id
  const w = addWall(scene, {
    levelId,
    typeId: 'wt-ext-200',
    baseline: { kind: 'line', start: [0, 0], end: [4, 0] },
  })
  scene = w.scene
  const c = addColumn(scene, levelId, 'ct-rect-300', [1, 1])
  scene = c.scene

  const poly: Vec2[] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ]
  return {
    ...scene,
    slabs: [{ id: 'sl1', typeId: 'st-floor-200', levelId, boundary: poly, heightOffset: 0, openings: [] }],
    ceilings: [{ id: 'ce1', typeId: 'clt-plaster-15', levelId, boundary: poly, top: { kind: 'unconnected', height: 3 } }],
    rooms: [
      {
        id: 'r1',
        levelId,
        name: 'Room',
        number: '1',
        polygon: poly,
        floorMaterial: 'mat-oak',
        baseOffset: 0,
        top: { kind: 'unconnected', height: 3 },
      },
    ],
    beams: [{ id: 'b1', typeId: 'bt-rect-200x400', levelId, start: [0, 0], end: [4, 0], heightOffset: 3, crossSectionRotation: 0 }],
    furniture: [{ id: 'fu1', typeId: 'ft-1', levelId, position: [2, 2], rotation: 0, scale: 1, heightOffset: 0 }],
    primitives: [{ id: 'pr1', typeId: 'pt-box', levelId, position: [5, 5], heightOffset: 0, rotation: 0, scale: 1 }],
    booleans: [{ id: 'bo1', levelId, op: 'union', operandIds: ['pr1'] }],
    stairs: [{ id: 'st1', typeId: 'st-stair-280', levelId, baseline: { start: [6, 0], end: [6, 3] }, baseOffset: 0, top: { kind: 'unconnected', height: 3 }, desiredNumberOfRisers: 17 }],
    railings: [{ id: 'rl1', typeId: 'rl-standard', levelId, path: [[7, 0], [8, 0], [8, 1]], baseOffset: 0 }],
    roofs: [{ id: 'rf1', typeId: 'rt-tile-250', levelId, footprint: poly, edges: [1, 2, 3, 4].map(() => ({ angle: 30, overhang: 0.3 })), baseHeight: 3 }],
    columnGrids: [{ id: 'cg1', levelId, name: 'G', origin: [0, 0], rotation: 0, xAxes: [], yAxes: [], extension: 1, bubbleRadius: 0.4 }],
    curtainWalls: [
      {
        id: 'cw1',
        typeId: 'cwt-glazed-1500',
        levelId,
        baseline: { kind: 'line', start: [0, 6], end: [4, 6] },
        baseOffset: 0,
        top: { kind: 'unconnected', height: 3 },
      },
    ],
  }
}

describe('planAnchor', () => {
  const scene = fullScene()

  it('answers for EVERY element kind that can sit on a level', () => {
    // The whole D-029 rule depends on this: a kind with no anchor would silently ignore every
    // plan region rather than belonging to one.
    const levelId = scene.levels[0].id
    const missing: string[] = []
    for (const key of ELEMENT_COLLECTIONS) {
      const items = scene[key] as ReadonlyArray<{ id: string; levelId?: string }>
      for (const item of items) {
        if (item.levelId !== levelId) continue
        if (planAnchor(scene, item.id) === null) missing.push(`${key}:${item.id}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('uses a straight wall’s midpoint', () => {
    const wall = scene.walls[0]
    expect(planAnchor(scene, wall.id)).toEqual([2, 0])
  })

  it('uses a curved wall’s APEX, not its chord midpoint', () => {
    // A strongly bowed wall's material is nowhere near its chord, so the chord midpoint would put
    // it in the wrong region.
    const bowed: SceneGraph = {
      ...scene,
      walls: [
        { ...scene.walls[0], baseline: { kind: 'arc', start: [0, 0], end: [4, 0], bulge: 1 } },
      ],
    }
    const anchor = planAnchor(bowed, scene.walls[0].id)!
    expect(Math.abs(anchor[1])).toBeGreaterThan(1)
  })

  it('uses a boolean’s first resolvable operand, since a node has no position', () => {
    expect(planAnchor(scene, 'bo1')).toEqual([5, 5])
  })

  it('returns null for an id that is not an element', () => {
    expect(planAnchor(scene, 'nope')).toBeNull()
  })
})

// ---------------------------------------------------------------------------

const REGION: PlanRegion = {
  id: 'pr1',
  viewId: 'v1',
  name: 'Raised cut',
  boundary: [
    [0, 0],
    [3, 0],
    [3, 3],
    [0, 3],
  ],
  viewRange: { cutHeight: 2.4, topOffset: 3, bottomOffset: 0, viewDepth: 0 },
}

describe('regionAt and partitionByRegion', () => {
  it('finds the region containing a point', () => {
    expect(regionAt([REGION], [1, 1])?.id).toBe('pr1')
    expect(regionAt([REGION], [9, 9])).toBeNull()
  })

  it('partitions a level’s elements, with null for "use the view’s own range"', () => {
    const scene = fullScene()
    const ids = ['sl1', 'ce1', 'r1', 'pr1', 'st1']
    const parts = partitionByRegion(scene, ids, [REGION])
    const inside = parts.get(REGION) ?? []
    const outside = parts.get(null) ?? []
    // The slab/ceiling/room centroids are at [2,2] — inside. The primitive is at [5,5] and the
    // stair midpoint at [6,1.5] — outside.
    expect(inside.sort()).toEqual(['ce1', 'r1', 'sl1'])
    expect(outside.sort()).toEqual(['pr1', 'st1'])
  })

  it('puts everything in the default partition when there are no regions', () => {
    const scene = fullScene()
    const parts = partitionByRegion(scene, ['sl1', 'r1'], [])
    expect(parts.size).toBe(1)
    expect(parts.get(null)).toEqual(['sl1', 'r1'])
  })

  it('assigns a straddling element WHOLLY to one region — the D-029 rule, stated as a test', () => {
    const scene = fullScene()
    // The wall runs from [0,0] to [4,0]: half in the region, half out. Its midpoint [2,0] is
    // inside, so the WHOLE wall is cut at the region's height. Nothing is split.
    const parts = partitionByRegion(scene, [scene.walls[0].id], [REGION])
    expect(parts.get(REGION)).toEqual([scene.walls[0].id])
    expect(parts.get(null)).toBeUndefined()
  })

  it('takes the FIRST region when two overlap, deterministically', () => {
    const scene = fullScene()
    const second: PlanRegion = { ...REGION, id: 'pr2', name: 'Other' }
    const parts = partitionByRegion(scene, ['sl1'], [REGION, second])
    expect(parts.get(REGION)).toEqual(['sl1'])
  })
})

describe('validatePlanRegion', () => {
  function withRegion(region: PlanRegion): SceneGraph {
    const scene = fullScene()
    const view = { ...planViewFor(scene.levels[0]), id: 'v1' }
    return { ...scene, views: [view], planRegions: [region] }
  }

  it('says nothing about a sound region', () => {
    expect(validatePlanRegion(withRegion(REGION), REGION)).toEqual([])
  })

  it('refuses a boundary with fewer than three points', () => {
    const bad = { ...REGION, boundary: [[0, 0], [1, 1]] as Vec2[] }
    expect(validatePlanRegion(withRegion(bad), bad).join(' ')).toMatch(/three/i)
  })

  it('flags a self-crossing boundary', () => {
    const bowtie = {
      ...REGION,
      boundary: [
        [0, 0],
        [3, 3],
        [3, 0],
        [0, 3],
      ] as Vec2[],
    }
    expect(validatePlanRegion(withRegion(bowtie), bowtie).join(' ')).toMatch(/crosses itself/i)
  })

  it('flags an inverted range that would draw nothing', () => {
    const bad = { ...REGION, viewRange: { ...REGION.viewRange, topOffset: 0, bottomOffset: 1 } }
    expect(validatePlanRegion(withRegion(bad), bad).join(' ')).toMatch(/at or below/i)
  })

  it('flags a cut plane above the storey height, where nothing would be cut', () => {
    const bad = { ...REGION, viewRange: { ...REGION.viewRange, cutHeight: 99 } }
    expect(validatePlanRegion(withRegion(bad), bad).join(' ')).toMatch(/above the storey/i)
  })

  it('names the region it overlaps rather than leaving the user guessing which won', () => {
    const scene = fullScene()
    const view = { ...planViewFor(scene.levels[0]), id: 'v1' }
    const second: PlanRegion = { ...REGION, id: 'pr2', name: 'Other' }
    const withBoth = { ...scene, views: [view], planRegions: [REGION, second] }
    expect(validatePlanRegion(withBoth, second).join(' ')).toMatch(/overlaps “Raised cut”/)
  })

  it('reports a region whose view has gone', () => {
    const scene = fullScene()
    const orphan = { ...scene, views: [], planRegions: [REGION] }
    expect(validatePlanRegion(orphan, REGION).join(' ')).toMatch(/no longer exists/i)
  })
})

describe('views are live (C7)', () => {
  it('gives every new level a plan view', () => {
    const scene = addLevel(addLevel(emptySceneGraph('p'), 'Ground'), 'First')
    expect(scene.views).toHaveLength(2)
    for (const level of scene.levels) {
      const view = findPlanView(scene, level.id)
      expect(view, `${level.name} must have a plan view`).toBeDefined()
      expect(view!.viewRange).toEqual(defaultViewRange(level.height))
    }
  })

  it('does not return a 3D view as a level’s plan view', () => {
    const scene = addLevel(emptySceneGraph('p'), 'Ground')
    const levelId = scene.levels[0].id
    const with3d: SceneGraph = {
      ...scene,
      views: [
        ...scene.views.map((v) => ({ ...v, viewRange: null })),
        { ...planViewFor(scene.levels[0]), id: 'v-3d', viewRange: null },
      ],
    }
    expect(findPlanView(with3d, levelId)).toBeUndefined()
  })
})
