/**
 * Forward migrations for the scene graph. Old projects must ALWAYS load (CLAUDE.md contract).
 *
 * Each migration takes the previous version's shape and returns the next. `migrateScene` walks
 * the chain from whatever version the document declares up to the current one.
 */

import {
  SCHEMA_VERSION,
  DEFAULT_MATERIALS,
  DEFAULT_TYPES,
  type SceneGraph,
  type ElementTypeDef,
  type WallTypeDef,
  type Material,
  type Vec2,
} from './scene'

// ---------------------------------------------------------------------------
// v1 shape (frozen — do not edit; this is history)
// ---------------------------------------------------------------------------

interface V1Storey {
  id: string
  name: string
  elevation: number
  height: number
}
interface V1Wall {
  id: string
  storeyId: string
  start: Vec2
  end: Vec2
  thickness: number
  height: number
  material: string
}
interface V1Opening {
  id: string
  wallId: string
  type: 'door' | 'window'
  offset: number
  width: number
  height: number
  sillHeight: number
}
interface V1Room {
  id: string
  storeyId: string
  name: string
  polygon: Vec2[]
  floorMaterial: string
}
interface V1Furniture {
  id: string
  storeyId: string
  catalogId: string
  position: Vec2
  rotation: number
  scale: number
}
interface V1Scene {
  schemaVersion: 1
  projectId: string
  units: string
  storeys: V1Storey[]
  walls: V1Wall[]
  openings: V1Opening[]
  rooms: V1Room[]
  furniture: V1Furniture[]
  materials: Material[]
}

// ---------------------------------------------------------------------------
// v1 → v2
// ---------------------------------------------------------------------------

/**
 * v1 stored thickness/height per wall; v2 moves composition onto shared types. We synthesise one
 * wall type per distinct (thickness, material) pair found in the document so no geometry changes.
 */
function migrateV1ToV2(v1: V1Scene): V2Scene {
  const types: ElementTypeDef[] = DEFAULT_TYPES.map((t) => ({ ...t }))
  const wallTypeByKey = new Map<string, string>()

  const wallTypeFor = (thickness: number, material: string): string => {
    const key = `${thickness}|${material}`
    const existing = wallTypeByKey.get(key)
    if (existing) return existing
    const id = `wt-migrated-${wallTypeByKey.size + 1}`
    const def: WallTypeDef = {
      id,
      category: 'wall',
      name: `Wall — ${Math.round(thickness * 1000)}mm`,
      function: thickness >= 0.15 ? 'exterior' : 'partition',
      layers: [{ material, thickness, function: 'structure' }],
    }
    types.push(def)
    wallTypeByKey.set(key, id)
    return id
  }

  const levels = v1.storeys.map((s) => ({
    id: s.id,
    name: s.name,
    elevation: s.elevation,
    height: s.height,
    isBuildingStory: true,
    computationHeight: 0,
  }))

  const walls = v1.walls.map((w) => ({
    id: w.id,
    typeId: wallTypeFor(w.thickness, w.material),
    levelId: w.storeyId,
    baseline: { kind: 'line' as const, start: w.start, end: w.end },
    baseOffset: 0,
    // v1 heights were absolute per wall, so `unconnected` preserves them exactly.
    top: { kind: 'unconnected' as const, height: w.height },
    locationLine: 'centerline' as const,
    flipped: false,
    roomBounding: true,
  }))

  // v1 conflated the void and its filling. v2 splits them: every v1 opening becomes an
  // Opening (the void) plus a Filling (the door/window leaf) referencing a default type.
  const openings = v1.openings.map((o) => ({
    id: o.id,
    hostId: o.wallId,
    offset: o.offset,
    width: o.width,
    height: o.height,
    sillHeight: o.sillHeight,
    predefinedType: 'opening' as const,
    depth: null,
  }))

  const fillings = v1.openings.map((o) => ({
    id: `f-${o.id}`,
    openingId: o.id,
    typeId: o.type === 'door' ? 'dt-single-900' : 'wnt-1200',
    flippedHand: false,
    flippedFacing: false,
  }))

  const storeyHeight = (storeyId: string): number =>
    v1.storeys.find((s) => s.id === storeyId)?.height ?? 2.8

  const rooms = v1.rooms.map((r, i) => ({
    id: r.id,
    levelId: r.storeyId,
    name: r.name,
    number: String(i + 1),
    polygon: r.polygon,
    floorMaterial: r.floorMaterial,
    baseOffset: 0,
    top: { kind: 'unconnected' as const, height: storeyHeight(r.storeyId) },
  }))

  // v1 furniture referenced a catalog id directly; v2 routes it through a type. Synthesise one
  // furniture type per distinct catalogId so nothing is lost.
  const furnitureTypeByCatalog = new Map<string, string>()
  for (const f of v1.furniture) {
    if (furnitureTypeByCatalog.has(f.catalogId)) continue
    const id = `ft-migrated-${furnitureTypeByCatalog.size + 1}`
    types.push({
      id,
      category: 'furniture',
      name: f.catalogId,
      catalogId: f.catalogId,
      footprint: [0.8, 0.8],
      heightMeters: 0.8,
      material: 'mat-timber',
    })
    furnitureTypeByCatalog.set(f.catalogId, id)
  }

  const furniture = v1.furniture.map((f) => ({
    id: f.id,
    typeId: furnitureTypeByCatalog.get(f.catalogId)!,
    levelId: f.storeyId,
    position: f.position,
    rotation: f.rotation,
    scale: f.scale,
    heightOffset: 0,
  }))

  const units = (['m', 'ft', 'cm', 'mm'] as const).includes(v1.units as 'm')
    ? (v1.units as SceneGraph['units'])
    : 'm'

  return {
    schemaVersion: 2,
    projectId: v1.projectId,
    units,
    types,
    levels,
    walls,
    openings,
    fillings,
    slabs: [],
    columns: [],
    beams: [],
    rooms,
    furniture,
    materials: v1.materials?.length ? v1.materials : DEFAULT_MATERIALS.map((m) => ({ ...m })),
  }
}

// ---------------------------------------------------------------------------
// v2 shape (frozen — do not edit; this is history)
// ---------------------------------------------------------------------------

/** A v2 document is identical to v3 minus the four documentation collections (and everything after). */
type V2Scene = Omit<
  SceneGraph,
  | 'schemaVersion'
  | 'views'
  | 'dimensions'
  | 'annotations'
  | 'roomTags'
  | 'columnGrids'
  | 'roofs'
  | 'primitives'
  | 'booleans'
> & { schemaVersion: 2 }

// ---------------------------------------------------------------------------
// v3 shape (frozen — do not edit; this is history)
// ---------------------------------------------------------------------------

/** A v3 document is identical to v4 minus `columnGrids`. */
type V3Scene = Omit<
  SceneGraph,
  'schemaVersion' | 'columnGrids' | 'roofs' | 'primitives' | 'booleans'
> & { schemaVersion: 3 }

// ---------------------------------------------------------------------------
// v4 shape (frozen — do not edit; this is history)
// ---------------------------------------------------------------------------

/** A v4 document is identical to v5 minus `roofs`. */
type V4Scene = Omit<SceneGraph, 'schemaVersion' | 'roofs' | 'primitives' | 'booleans'> & {
  schemaVersion: 4
}

// ---------------------------------------------------------------------------
// v5 shape (frozen — do not edit; this is history)
// ---------------------------------------------------------------------------

/** A v5 document is identical to v6 minus `primitives` and `booleans`. */
type V5Scene = Omit<SceneGraph, 'schemaVersion' | 'primitives' | 'booleans'> & {
  schemaVersion: 5
}

// ---------------------------------------------------------------------------
// v2 → v3
// ---------------------------------------------------------------------------

function migrateV2ToV3(v2: V2Scene): V3Scene {
  return {
    ...v2,
    schemaVersion: 3,
    views: [],
    dimensions: [],
    annotations: [],
    roomTags: [],
  }
}

// ---------------------------------------------------------------------------
// v3 → v4
// ---------------------------------------------------------------------------

function migrateV3ToV4(v3: V3Scene): V4Scene {
  return {
    ...v3,
    schemaVersion: 4,
    columnGrids: [],
  }
}

// ---------------------------------------------------------------------------
// v4 → v5
// ---------------------------------------------------------------------------

function migrateV4ToV5(v4: V4Scene): V5Scene {
  return {
    ...v4,
    schemaVersion: 5,
    roofs: [],
  }
}

// ---------------------------------------------------------------------------
// v5 → v6
// ---------------------------------------------------------------------------

/**
 * v6 adds primitive solids and boolean trees (B7 / D-019). Purely additive: a v5 document had no
 * way to express either, so both collections start empty and no existing geometry changes.
 *
 * The default primitive TYPES are back-filled (only where the id is not already taken), because
 * without them a migrated project would open with the primitive tool permanently unusable — every
 * pre-v6 document would hit the "no primitive type" refusal. Adding type definitions changes no
 * existing instance, since nothing in a v5 document can reference them.
 */
function migrateV5ToV6(v5: V5Scene): SceneGraph {
  const existingIds = new Set(v5.types.map((t) => t.id))
  const missingPrimitiveTypes = DEFAULT_TYPES.filter(
    (t) => t.category === 'primitive' && !existingIds.has(t.id),
  ).map((t) => ({ ...t }))

  return {
    ...v5,
    schemaVersion: SCHEMA_VERSION,
    types: [...v5.types, ...missingPrimitiveTypes],
    primitives: [],
    booleans: [],
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export class SchemaMigrationError extends Error {}

/**
 * Bring any stored scene graph up to the current schema version.
 * Throws only if the document declares a version newer than this build understands.
 */
export function migrateScene(raw: unknown): SceneGraph {
  if (typeof raw !== 'object' || raw === null) {
    throw new SchemaMigrationError('Scene graph must be an object')
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion

  if (version === 1) {
    return migrateV5ToV6(
      migrateV4ToV5(migrateV3ToV4(migrateV2ToV3(migrateV1ToV2(raw as V1Scene)))),
    )
  }
  if (version === 2) return migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(migrateV2ToV3(raw as V2Scene))))
  if (version === 3) return migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(raw as V3Scene)))
  if (version === 4) return migrateV5ToV6(migrateV4ToV5(raw as V4Scene))
  if (version === 5) return migrateV5ToV6(raw as V5Scene)
  if (version === SCHEMA_VERSION) return raw as SceneGraph

  if (typeof version === 'number' && version > SCHEMA_VERSION) {
    throw new SchemaMigrationError(
      `Project uses schema v${version}, but this version of ArchStudio understands up to v${SCHEMA_VERSION}. Please update.`,
    )
  }
  throw new SchemaMigrationError(`Unrecognised schema version: ${String(version)}`)
}
