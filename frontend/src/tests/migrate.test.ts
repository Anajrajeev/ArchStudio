/**
 * Migration tests. The contract in CLAUDE.md is absolute: old projects must ALWAYS load.
 */
import { describe, it, expect } from 'vitest'
import { migrateScene, SchemaMigrationError } from '../../../shared/types/migrate'
import {
  SCHEMA_VERSION,
  emptySceneGraph,
  assemblyThickness,
  PRIMITIVE_KINDS,
} from '../../../shared/types/scene'
import { resolveWall, wallSolidBoxes } from '../../../shared/geometry/index'

/** A representative v1 document, in exactly the shape Phase 1 shipped. */
const V1 = {
  schemaVersion: 1,
  projectId: 'proj-legacy',
  units: 'm',
  storeys: [
    { id: 's1', name: 'Ground floor', elevation: 0, height: 2.8 },
    { id: 's2', name: 'First floor', elevation: 2.8, height: 2.6 },
  ],
  walls: [
    {
      id: 'w1',
      storeyId: 's1',
      start: [0, 0] as [number, number],
      end: [5, 0] as [number, number],
      thickness: 0.2,
      height: 2.8,
      material: 'mat-brick',
    },
    {
      id: 'w2',
      storeyId: 's1',
      start: [5, 0] as [number, number],
      end: [5, 4] as [number, number],
      thickness: 0.1,
      height: 2.8,
      material: 'mat-concrete',
    },
    {
      id: 'w3',
      storeyId: 's2',
      start: [0, 0] as [number, number],
      end: [5, 0] as [number, number],
      thickness: 0.2,
      height: 2.6,
      material: 'mat-brick',
    },
  ],
  openings: [
    { id: 'o1', wallId: 'w1', type: 'door' as const, offset: 1.2, width: 0.9, height: 2.1, sillHeight: 0 },
    { id: 'o2', wallId: 'w1', type: 'window' as const, offset: 3, width: 1.2, height: 1.2, sillHeight: 0.9 },
  ],
  rooms: [
    {
      id: 'r1',
      storeyId: 's1',
      name: 'Living room',
      polygon: [
        [0, 0],
        [5, 0],
        [5, 4],
        [0, 4],
      ] as [number, number][],
      floorMaterial: 'mat-oak',
    },
  ],
  furniture: [
    { id: 'f1', storeyId: 's1', catalogId: 'sofa-01', position: [2.5, 2] as [number, number], rotation: 90, scale: 1 },
    { id: 'f2', storeyId: 's1', catalogId: 'sofa-01', position: [1, 1] as [number, number], rotation: 0, scale: 1 },
  ],
  materials: [{ id: 'mat-brick', name: 'Brick', color: '#c1440e', textureUrl: null }],
}

describe('migrateScene v1 → v2', () => {
  const migrated = migrateScene(V1)

  it('bumps the schema version and keeps identity fields', () => {
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.projectId).toBe('proj-legacy')
    expect(migrated.units).toBe('m')
  })

  it('converts storeys to levels, preserving elevations and heights', () => {
    expect(migrated.levels).toHaveLength(2)
    expect(migrated.levels[0]).toMatchObject({ id: 's1', elevation: 0, height: 2.8 })
    expect(migrated.levels[1]).toMatchObject({ id: 's2', elevation: 2.8, height: 2.6 })
    expect(migrated.levels[0].isBuildingStory).toBe(true)
  })

  it('keeps every wall and re-points it at a synthesised type', () => {
    expect(migrated.walls).toHaveLength(3)
    for (const w of migrated.walls) {
      const type = migrated.types.find((t) => t.id === w.typeId)
      expect(type, `wall ${w.id} must resolve a type`).toBeDefined()
      expect(type?.category).toBe('wall')
    }
  })

  it('reuses one type for walls that shared thickness and material', () => {
    const w1 = migrated.walls.find((w) => w.id === 'w1')!
    const w3 = migrated.walls.find((w) => w.id === 'w3')!
    const w2 = migrated.walls.find((w) => w.id === 'w2')!
    // w1 and w3 were both 0.2 brick — same synthesised type.
    expect(w1.typeId).toBe(w3.typeId)
    // w2 was 0.1 concrete — a different type.
    expect(w2.typeId).not.toBe(w1.typeId)
  })

  it('preserves wall thickness exactly through the type layer', () => {
    const w1 = migrated.walls.find((w) => w.id === 'w1')!
    const type = migrated.types.find((t) => t.id === w1.typeId)!
    if (type.category !== 'wall') throw new Error('unreachable')
    expect(assemblyThickness(type.layers)).toBeCloseTo(0.2)
  })

  it('preserves wall heights as unconnected constraints so geometry is unchanged', () => {
    const w1 = migrated.walls.find((w) => w.id === 'w1')!
    expect(w1.top).toEqual({ kind: 'unconnected', height: 2.8 })
    const resolved = resolveWall(migrated, w1)!
    expect(resolved.height).toBeCloseTo(2.8)
    expect(resolved.length).toBeCloseTo(5)
  })

  it('splits each v1 opening into a void plus a filling', () => {
    expect(migrated.openings).toHaveLength(2)
    expect(migrated.fillings).toHaveLength(2)
    // hostId replaces wallId.
    expect(migrated.openings.every((o) => o.hostId === 'w1')).toBe(true)
    // Every filling points at a real opening and a real type.
    for (const f of migrated.fillings) {
      expect(migrated.openings.some((o) => o.id === f.openingId)).toBe(true)
      expect(migrated.types.some((t) => t.id === f.typeId)).toBe(true)
    }
  })

  it('routes doors and windows to the right filling types', () => {
    const doorFilling = migrated.fillings.find((f) => f.openingId === 'o1')!
    const windowFilling = migrated.fillings.find((f) => f.openingId === 'o2')!
    expect(migrated.types.find((t) => t.id === doorFilling.typeId)?.category).toBe('door')
    expect(migrated.types.find((t) => t.id === windowFilling.typeId)?.category).toBe('window')
  })

  it('produces the same solid decomposition as the v1 geometry implied', () => {
    const w1 = migrated.walls.find((w) => w.id === 'w1')!
    const openings = migrated.openings.filter((o) => o.hostId === 'w1')
    const boxes = wallSolidBoxes(resolveWall(migrated, w1)!, openings)
    // Door at 1.2–2.1 and window at 3.0–4.2 leave three full-height runs, plus a lintel
    // for each opening and an under-sill run for the window.
    expect(boxes.length).toBe(6)
    for (const b of boxes) {
      expect(b.size[0]).toBeGreaterThan(0)
      expect(b.size[1]).toBeGreaterThan(0)
      expect(b.size[2]).toBeCloseTo(0.2)
    }
  })

  it('migrates rooms with numbers and a resolved top', () => {
    expect(migrated.rooms).toHaveLength(1)
    expect(migrated.rooms[0]).toMatchObject({ id: 'r1', levelId: 's1', name: 'Living room' })
    expect(migrated.rooms[0].number).toBeTruthy()
    expect(migrated.rooms[0].top).toEqual({ kind: 'unconnected', height: 2.8 })
  })

  it('routes furniture through a synthesised type, sharing it per catalog id', () => {
    expect(migrated.furniture).toHaveLength(2)
    expect(migrated.furniture[0].typeId).toBe(migrated.furniture[1].typeId)
    const type = migrated.types.find((t) => t.id === migrated.furniture[0].typeId)!
    expect(type.category).toBe('furniture')
    if (type.category !== 'furniture') throw new Error('unreachable')
    expect(type.catalogId).toBe('sofa-01')
  })

  it('keeps the original materials', () => {
    expect(migrated.materials.some((m) => m.id === 'mat-brick')).toBe(true)
  })

  it('adds the new empty collections', () => {
    expect(migrated.slabs).toEqual([])
    expect(migrated.columns).toEqual([])
    expect(migrated.beams).toEqual([])
  })

  it('is idempotent — a v2 document passes through untouched', () => {
    const v2 = emptySceneGraph('p')
    expect(migrateScene(v2)).toBe(v2)
    expect(migrateScene(migrated)).toBe(migrated)
  })

  it('handles a minimal v1 document with empty collections', () => {
    const bare = migrateScene({
      schemaVersion: 1,
      projectId: 'p',
      units: 'm',
      storeys: [],
      walls: [],
      openings: [],
      rooms: [],
      furniture: [],
      materials: [],
    })
    expect(bare.levels).toEqual([])
    expect(bare.materials.length).toBeGreaterThan(0) // falls back to defaults
  })

  it('normalises an unrecognised units value', () => {
    const odd = migrateScene({ ...V1, units: 'furlongs' })
    expect(odd.units).toBe('m')
  })
})

describe('migrateScene failure modes', () => {
  it('rejects a non-object', () => {
    expect(() => migrateScene(null)).toThrow(SchemaMigrationError)
    expect(() => migrateScene('nope')).toThrow(SchemaMigrationError)
  })

  it('rejects an unknown version', () => {
    expect(() => migrateScene({ schemaVersion: 0 })).toThrow(SchemaMigrationError)
    expect(() => migrateScene({})).toThrow(SchemaMigrationError)
  })

  it('gives an actionable message for a future version', () => {
    expect(() => migrateScene({ schemaVersion: 99 })).toThrow(new RegExp(`understands up to v${SCHEMA_VERSION}`))
  })
})

// ---------------------------------------------------------------------------
// v2 → v6 (chained)
// ---------------------------------------------------------------------------

/** A representative v2 document (no views/dimensions/annotations/roomTags/columnGrids/roofs). */
const V2 = {
  schemaVersion: 2,
  projectId: 'proj-v2',
  units: 'm',
  types: [],
  levels: [{ id: 'lv1', name: 'Ground', elevation: 0, height: 2.8, isBuildingStory: true, computationHeight: 0 }],
  walls: [],
  openings: [],
  fillings: [],
  slabs: [],
  columns: [],
  beams: [],
  rooms: [],
  furniture: [],
  materials: [],
}

describe('migrateScene v2 → v6 (chained)', () => {
  const migrated = migrateScene(V2)

  it('bumps the schema version to 5', () => {
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('preserves all existing data', () => {
    expect(migrated.projectId).toBe('proj-v2')
    expect(migrated.units).toBe('m')
    expect(migrated.levels).toHaveLength(1)
    expect(migrated.levels[0].id).toBe('lv1')
  })

  it('adds every collection introduced after v2', () => {
    expect(migrated.views).toEqual([])
    expect(migrated.dimensions).toEqual([])
    expect(migrated.annotations).toEqual([])
    expect(migrated.roomTags).toEqual([])
    expect(migrated.columnGrids).toEqual([])
    expect(migrated.roofs).toEqual([])
  })

  it('is idempotent — a current-version document passes through untouched', () => {
    expect(migrateScene(migrated)).toBe(migrated)
  })
})

describe('migrateScene v1 → v6 (chained)', () => {
  const migrated = migrateScene(V1)

  it('arrives at the current version with all new collections', () => {
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.views).toEqual([])
    expect(migrated.dimensions).toEqual([])
    expect(migrated.annotations).toEqual([])
    expect(migrated.roomTags).toEqual([])
    expect(migrated.columnGrids).toEqual([])
    expect(migrated.roofs).toEqual([])
  })

  it('still preserves v1 data through the chain', () => {
    expect(migrated.walls).toHaveLength(3)
    expect(migrated.openings).toHaveLength(2)
    expect(migrated.fillings).toHaveLength(2)
    expect(migrated.rooms).toHaveLength(1)
    expect(migrated.furniture).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// v3 → v6 (chained)
// ---------------------------------------------------------------------------

/** A representative v3 document (no columnGrids/roofs). */
const V3 = {
  schemaVersion: 3,
  projectId: 'proj-v3',
  units: 'm',
  types: [],
  levels: [],
  walls: [],
  openings: [],
  fillings: [],
  slabs: [],
  columns: [],
  beams: [],
  rooms: [],
  furniture: [],
  materials: [],
  views: [],
  dimensions: [],
  annotations: [],
  roomTags: [],
}

describe('migrateScene v3 → v6 (chained)', () => {
  const migrated = migrateScene(V3)

  it('bumps to the current version and adds columnGrids + roofs', () => {
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.columnGrids).toEqual([])
    expect(migrated.roofs).toEqual([])
  })

  it('preserves existing v3 fields', () => {
    expect(migrated.projectId).toBe('proj-v3')
  })
})

// ---------------------------------------------------------------------------
// v4 → v6 (chained)
// ---------------------------------------------------------------------------

/** A representative v4 document (no roofs). */
const V4 = {
  schemaVersion: 4,
  projectId: 'proj-v4',
  units: 'm',
  types: [],
  levels: [],
  walls: [],
  openings: [],
  fillings: [],
  slabs: [],
  columns: [],
  beams: [],
  rooms: [],
  furniture: [],
  materials: [],
  views: [],
  dimensions: [],
  annotations: [],
  roomTags: [],
  columnGrids: [],
}

describe('migrateScene v4 → v6 (chained)', () => {
  const migrated = migrateScene(V4)

  it('bumps to the current version and adds roofs', () => {
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.roofs).toEqual([])
  })

  it('preserves existing v4 fields', () => {
    expect(migrated.projectId).toBe('proj-v4')
  })
})

// ---------------------------------------------------------------------------
// v5 → v6 (primitive solids and boolean trees, B7 / D-019)
// ---------------------------------------------------------------------------

/** A representative v5 document (no primitives/booleans). */
const V5 = {
  schemaVersion: 5,
  projectId: 'proj-v5',
  units: 'm',
  types: [
    {
      id: 'wt-custom',
      category: 'wall' as const,
      name: 'Custom wall',
      function: 'interior' as const,
      layers: [{ material: 'mat-concrete', thickness: 0.15, function: 'structure' as const }],
    },
  ],
  levels: [{ id: 'lv1', name: 'Ground', elevation: 0, height: 3, isBuildingStory: true, computationHeight: 0 }],
  walls: [],
  openings: [],
  fillings: [],
  slabs: [],
  columns: [],
  beams: [],
  rooms: [],
  furniture: [],
  materials: [],
  views: [],
  dimensions: [],
  annotations: [],
  roomTags: [],
  columnGrids: [],
  roofs: [],
}

describe('migrateScene v5 → v6', () => {
  const migrated = migrateScene(V5)

  it('bumps to the current version and adds primitives + booleans', () => {
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.primitives).toEqual([])
    expect(migrated.booleans).toEqual([])
  })

  it('preserves existing v5 fields', () => {
    expect(migrated.projectId).toBe('proj-v5')
    expect(migrated.levels).toHaveLength(1)
  })

  it("keeps the document's own types", () => {
    // The user's custom wall type must survive the back-fill below untouched.
    expect(migrated.types.find((t) => t.id === 'wt-custom')?.name).toBe('Custom wall')
  })

  it('back-fills the default primitive types so the tool is usable on an old project', () => {
    // Without this, every pre-v6 document would open with the primitive tool permanently refusing.
    const primitiveTypes = migrated.types.filter((t) => t.category === 'primitive')
    expect(primitiveTypes.length).toBeGreaterThanOrEqual(7)
    const kinds = primitiveTypes.map((t) => (t.category === 'primitive' ? t.shape.kind : ''))
    expect([...kinds].sort()).toEqual([...PRIMITIVE_KINDS].sort())
  })

  it('does not duplicate a primitive type the document already had', () => {
    const withBox = {
      ...V5,
      types: [
        ...V5.types,
        {
          id: 'pt-box',
          category: 'primitive' as const,
          name: 'My own box',
          shape: { kind: 'box' as const, width: 5, depth: 5, height: 5 },
          material: 'mat-oak',
        },
      ],
    }
    const result = migrateScene(withBox)
    const boxes = result.types.filter((t) => t.id === 'pt-box')
    expect(boxes).toHaveLength(1)
    // And the user's version wins — a migration must never overwrite authored data.
    expect(boxes[0].name).toBe('My own box')
  })
})

describe('the full v1 → v6 chain reaches primitives', () => {
  const migrated = migrateScene(V1)

  it('arrives at v6 with both new collections', () => {
    expect(migrated.primitives).toEqual([])
    expect(migrated.booleans).toEqual([])
  })

  it('still preserves the original v1 geometry after five migrations', () => {
    expect(migrated.walls).toHaveLength(3)
    expect(migrated.openings).toHaveLength(2)
    expect(migrated.fillings).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// v6 → v7 (stairs and railings, B2/B3)
// ---------------------------------------------------------------------------

/** A representative v6 document (no stairs/railings). */
const V6 = {
  schemaVersion: 6,
  projectId: 'proj-v6',
  units: 'm',
  types: [
    {
      id: 'wt-custom',
      category: 'wall' as const,
      name: 'Custom wall',
      function: 'interior' as const,
      layers: [{ material: 'mat-concrete', thickness: 0.15, function: 'structure' as const }],
    },
  ],
  levels: [{ id: 'lv1', name: 'Ground', elevation: 0, height: 3, isBuildingStory: true, computationHeight: 0 }],
  walls: [],
  openings: [],
  fillings: [],
  slabs: [],
  columns: [],
  beams: [],
  rooms: [],
  furniture: [],
  materials: [],
  views: [],
  dimensions: [],
  annotations: [],
  roomTags: [],
  columnGrids: [],
  roofs: [],
  primitives: [],
  booleans: [],
}

describe('migrateScene v6 → v7', () => {
  const migrated = migrateScene(V6)

  it('bumps to the current version and adds stairs + railings', () => {
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.stairs).toEqual([])
    expect(migrated.railings).toEqual([])
  })

  it('preserves existing v6 fields', () => {
    expect(migrated.projectId).toBe('proj-v6')
    expect(migrated.levels).toHaveLength(1)
  })

  it("keeps the document's own types", () => {
    expect(migrated.types.find((t) => t.id === 'wt-custom')?.name).toBe('Custom wall')
  })

  it('back-fills the default stair and railing types so both tools are usable on an old project', () => {
    // Without this, every pre-v7 document would open with the stair/railing tools refusing —
    // same reasoning as the v5→v6 primitive back-fill above.
    const categories = migrated.types.map((t) => t.category)
    expect(categories).toContain('stair')
    expect(categories).toContain('railing')
  })

  it('does not duplicate a type the document already had', () => {
    const withStair = {
      ...V6,
      types: [
        ...V6.types,
        {
          id: 'st-stair-280',
          category: 'stair' as const,
          name: 'My own stair',
          width: 2,
          treadDepth: 0.3,
          material: 'mat-oak',
        },
      ],
    }
    const result = migrateScene(withStair)
    const matches = result.types.filter((t) => t.id === 'st-stair-280')
    expect(matches).toHaveLength(1)
    expect(matches[0].name).toBe('My own stair')
  })
})

describe('the full v1 → v7 chain reaches stairs and railings', () => {
  const migrated = migrateScene(V1)

  it('arrives at the current version with every new collection empty', () => {
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.primitives).toEqual([])
    expect(migrated.booleans).toEqual([])
    expect(migrated.stairs).toEqual([])
    expect(migrated.railings).toEqual([])
  })

  it('still preserves the original v1 geometry after six migrations', () => {
    expect(migrated.walls).toHaveLength(3)
    expect(migrated.openings).toHaveLength(2)
    expect(migrated.fillings).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// v7 → v8 (ceilings B5, slab openings B8, spot annotations C4)
// ---------------------------------------------------------------------------

/** A representative v7 document: one slab (no `openings`), one annotation (no elevation/slope). */
const V7 = {
  schemaVersion: 7,
  projectId: 'proj-v7',
  units: 'm',
  types: [
    {
      id: 'wt-custom',
      category: 'wall' as const,
      name: 'Custom wall',
      function: 'interior' as const,
      layers: [{ material: 'mat-concrete', thickness: 0.15, function: 'structure' as const }],
    },
  ],
  levels: [{ id: 'lv1', name: 'Ground', elevation: 0, height: 3, isBuildingStory: true, computationHeight: 0 }],
  walls: [],
  openings: [],
  fillings: [],
  slabs: [
    {
      id: 'sl1',
      typeId: 'st-floor-200',
      levelId: 'lv1',
      boundary: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
      heightOffset: 0,
    },
  ],
  columns: [],
  beams: [],
  rooms: [],
  furniture: [],
  materials: [],
  views: [],
  dimensions: [],
  annotations: [
    {
      id: 'ann1',
      viewId: 'default',
      kind: 'text' as const,
      text: 'Existing note',
      position: [1, 1],
      leaderTarget: null,
      rotation: 0,
      textHeight: 0.2,
    },
  ],
  roomTags: [],
  columnGrids: [],
  roofs: [],
  primitives: [],
  booleans: [],
  stairs: [],
  railings: [],
}

describe('migrateScene v7 → v8', () => {
  const migrated = migrateScene(V7)

  it('bumps to the current version and adds ceilings', () => {
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.ceilings).toEqual([])
  })

  it('back-fills empty openings on every existing slab', () => {
    expect(migrated.slabs).toHaveLength(1)
    expect(migrated.slabs[0].openings).toEqual([])
    expect(migrated.slabs[0].boundary).toEqual(V7.slabs[0].boundary)
  })

  it('back-fills null elevation/slope on every existing annotation', () => {
    expect(migrated.annotations).toHaveLength(1)
    expect(migrated.annotations[0].elevation).toBeNull()
    expect(migrated.annotations[0].slope).toBeNull()
    expect(migrated.annotations[0].text).toBe('Existing note')
  })

  it('back-fills the default ceiling type so the tool is usable on an old project', () => {
    expect(migrated.types.map((t) => t.category)).toContain('ceiling')
  })

  it("keeps the document's own types and preserves other v7 fields", () => {
    expect(migrated.types.find((t) => t.id === 'wt-custom')?.name).toBe('Custom wall')
    expect(migrated.projectId).toBe('proj-v7')
  })

  it('does not duplicate a ceiling type the document already had', () => {
    const withCeiling = {
      ...V7,
      types: [
        ...V7.types,
        {
          id: 'clt-plaster-15',
          category: 'ceiling' as const,
          name: 'My own ceiling',
          layers: [{ material: 'mat-oak', thickness: 0.02, function: 'finish' as const }],
        },
      ],
    }
    const result = migrateScene(withCeiling)
    const matches = result.types.filter((t) => t.id === 'clt-plaster-15')
    expect(matches).toHaveLength(1)
    expect(matches[0].name).toBe('My own ceiling')
  })
})

describe('the full v1 → v8 chain reaches ceilings', () => {
  const migrated = migrateScene(V1)

  it('arrives at the current version with every new collection empty', () => {
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION)
    expect(migrated.stairs).toEqual([])
    expect(migrated.railings).toEqual([])
    expect(migrated.ceilings).toEqual([])
  })

  it('still preserves the original v1 geometry after seven migrations', () => {
    expect(migrated.walls).toHaveLength(3)
    expect(migrated.openings).toHaveLength(2)
    expect(migrated.fillings).toHaveLength(2)
  })
})
