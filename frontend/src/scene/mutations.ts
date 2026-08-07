/**
 * Pure scene-graph mutations. Every function takes the current scene and returns a NEW one.
 * These are the only sanctioned way to change the scene graph, so the 3D editor, the properties
 * panel, and (Phase 3) the AI agent tools all funnel through identical code.
 */
import {
  assemblyThickness,
  findLevel,
  findType,
  type SceneGraph,
  type Level,
  type Wall,
  type Opening,
  type Filling,
  type Slab,
  type Column,
  type Beam,
  type Room,
  type FurnitureItem,
  type Baseline,
  type TopConstraint,
  type LocationLine,
  type Vec2,
  type ElementTypeDef,
  type WallTypeDef,
  type Dimension,
  type Annotation,
  type RoomTag,
  type ColumnGrid,
  type GridAxis,
  type Roof,
  type RoofEdge,
  type Primitive,
  type BooleanNode,
  type BooleanOp,
} from '../../../shared/types/scene'
import { resolveWall, baselineLength } from '../../../shared/geometry/index'
import { booleanOpLabel } from '../../../shared/geometry/booleanTree'
import {
  applyTransform,
  transformBaseline,
  transformRotation,
  type Transform2D,
} from '../../../shared/geometry/transform'
import { newId } from './ids'

export type ElementKind =
  | 'level'
  | 'wall'
  | 'opening'
  | 'filling'
  | 'slab'
  | 'column'
  | 'beam'
  | 'room'
  | 'furniture'
  | 'dimension'
  | 'annotation'
  | 'roomTag'
  | 'columnGrid'
  | 'roof'
  | 'primitive'
  | 'boolean'

export interface SelectedElement {
  kind: ElementKind
  id: string
}

/** Which collection an id lives in. */
export function findElement(scene: SceneGraph, id: string): SelectedElement | null {
  if (scene.walls.some((w) => w.id === id)) return { kind: 'wall', id }
  if (scene.openings.some((o) => o.id === id)) return { kind: 'opening', id }
  if (scene.fillings.some((f) => f.id === id)) return { kind: 'filling', id }
  if (scene.slabs.some((s) => s.id === id)) return { kind: 'slab', id }
  if (scene.columns.some((c) => c.id === id)) return { kind: 'column', id }
  if (scene.beams.some((b) => b.id === id)) return { kind: 'beam', id }
  if (scene.rooms.some((r) => r.id === id)) return { kind: 'room', id }
  if (scene.furniture.some((f) => f.id === id)) return { kind: 'furniture', id }
  if (scene.dimensions.some((d) => d.id === id)) return { kind: 'dimension', id }
  if (scene.annotations.some((a) => a.id === id)) return { kind: 'annotation', id }
  if (scene.roomTags.some((t) => t.id === id)) return { kind: 'roomTag', id }
  if (scene.columnGrids.some((g) => g.id === id)) return { kind: 'columnGrid', id }
  if (scene.roofs.some((r) => r.id === id)) return { kind: 'roof', id }
  if (scene.primitives.some((p) => p.id === id)) return { kind: 'primitive', id }
  if (scene.booleans.some((b) => b.id === id)) return { kind: 'boolean', id }
  if (scene.levels.some((l) => l.id === id)) return { kind: 'level', id }
  return null
}

/** The level an element belongs to (openings and fillings inherit from their host). */
export function levelIdOf(scene: SceneGraph, id: string): string | null {
  const wall = scene.walls.find((w) => w.id === id)
  if (wall) return wall.levelId
  const slab = scene.slabs.find((s) => s.id === id)
  if (slab) return slab.levelId
  const col = scene.columns.find((c) => c.id === id)
  if (col) return col.levelId
  const beam = scene.beams.find((b) => b.id === id)
  if (beam) return beam.levelId
  const room = scene.rooms.find((r) => r.id === id)
  if (room) return room.levelId
  const furn = scene.furniture.find((f) => f.id === id)
  if (furn) return furn.levelId
  const grid = scene.columnGrids.find((g) => g.id === id)
  if (grid) return grid.levelId
  const roof = scene.roofs.find((r) => r.id === id)
  if (roof) return roof.levelId
  const primitive = scene.primitives.find((p) => p.id === id)
  if (primitive) return primitive.levelId
  const boolNode = scene.booleans.find((b) => b.id === id)
  if (boolNode) return boolNode.levelId
  const opening = scene.openings.find((o) => o.id === id)
  if (opening) return levelIdOf(scene, opening.hostId)
  const filling = scene.fillings.find((f) => f.id === id)
  if (filling) {
    const o = scene.openings.find((x) => x.id === filling.openingId)
    return o ? levelIdOf(scene, o.hostId) : null
  }
  return null
}

// ---- Levels -----------------------------------------------------------------

export function addLevel(scene: SceneGraph, name?: string, height = 2.8): SceneGraph {
  const sorted = [...scene.levels].sort((a, b) => a.elevation - b.elevation)
  const prev = sorted[sorted.length - 1]
  const elevation = prev ? prev.elevation + prev.height : 0
  const level: Level = {
    id: newId('lv'),
    name: name ?? `Level ${scene.levels.length + 1}`,
    elevation,
    height,
    isBuildingStory: true,
    computationHeight: 0,
  }
  return { ...scene, levels: [...scene.levels, level] }
}

export function updateLevel(scene: SceneGraph, id: string, patch: Partial<Level>): SceneGraph {
  return {
    ...scene,
    levels: scene.levels.map((l) => (l.id === id ? { ...l, ...patch, id: l.id } : l)),
  }
}

/**
 * Re-stack levels so each sits directly on the one below. Called after a height edit so
 * multi-storey buildings stay contiguous instead of overlapping or leaving gaps.
 */
export function restackLevels(scene: SceneGraph): SceneGraph {
  const sorted = [...scene.levels].sort((a, b) => a.elevation - b.elevation)
  let elevation = sorted[0]?.elevation ?? 0
  const byId = new Map<string, number>()
  for (const l of sorted) {
    byId.set(l.id, elevation)
    elevation += l.height
  }
  return {
    ...scene,
    levels: scene.levels.map((l) => ({ ...l, elevation: byId.get(l.id) ?? l.elevation })),
  }
}

// ---- Types ------------------------------------------------------------------

export function updateType(
  scene: SceneGraph,
  id: string,
  patch: Partial<ElementTypeDef>,
): SceneGraph {
  return {
    ...scene,
    types: scene.types.map((t) =>
      t.id === id ? ({ ...t, ...patch, id: t.id, category: t.category } as ElementTypeDef) : t,
    ),
  }
}

/** Change a wall type's total thickness by scaling its layers proportionally. */
export function setWallTypeThickness(
  scene: SceneGraph,
  typeId: string,
  thickness: number,
): SceneGraph {
  const type = scene.types.find((t) => t.id === typeId)
  if (!type || type.category !== 'wall' || thickness <= 0) return scene
  const current = assemblyThickness(type.layers)
  if (current <= 0) return scene
  const k = thickness / current
  const next: WallTypeDef = {
    ...type,
    layers: type.layers.map((l) => ({ ...l, thickness: l.thickness * k })),
  }
  return { ...scene, types: scene.types.map((t) => (t.id === typeId ? next : t)) }
}

/** Duplicate a type so the user can diverge from a shared definition. */
export function duplicateType(scene: SceneGraph, typeId: string): { scene: SceneGraph; id: string } {
  const type = scene.types.find((t) => t.id === typeId)
  if (!type) return { scene, id: typeId }
  const copy = { ...type, id: newId('ty'), name: `${type.name} (copy)` }
  return { scene: { ...scene, types: [...scene.types, copy] }, id: copy.id }
}

// ---- Walls ------------------------------------------------------------------

export interface NewWallSpec {
  levelId: string
  typeId: string
  baseline: Baseline
  locationLine?: LocationLine
  baseOffset?: number
  top?: TopConstraint
}

export function addWall(scene: SceneGraph, spec: NewWallSpec): { scene: SceneGraph; id: string } {
  const level = findLevel(scene, spec.levelId)
  const wall: Wall = {
    id: newId('w'),
    typeId: spec.typeId,
    levelId: spec.levelId,
    baseline: spec.baseline,
    baseOffset: spec.baseOffset ?? 0,
    top: spec.top ?? { kind: 'unconnected', height: level?.height ?? 2.8 },
    locationLine: spec.locationLine ?? 'centerline',
    flipped: false,
    roomBounding: true,
  }
  return { scene: { ...scene, walls: [...scene.walls, wall] }, id: wall.id }
}

export function updateWall(scene: SceneGraph, id: string, patch: Partial<Wall>): SceneGraph {
  return {
    ...scene,
    walls: scene.walls.map((w) => (w.id === id ? { ...w, ...patch, id: w.id } : w)),
  }
}

/** Move one end of a wall's baseline. */
export function setWallEndpoint(
  scene: SceneGraph,
  id: string,
  which: 'start' | 'end',
  point: Vec2,
): SceneGraph {
  const wall = scene.walls.find((w) => w.id === id)
  if (!wall) return scene
  return updateWall(scene, id, { baseline: { ...wall.baseline, [which]: point } })
}

// ---- Openings & fillings ----------------------------------------------------

export interface NewOpeningSpec {
  hostId: string
  offset: number
  width: number
  height: number
  sillHeight: number
}

export function addOpening(
  scene: SceneGraph,
  spec: NewOpeningSpec,
): { scene: SceneGraph; id: string } {
  const opening: Opening = {
    id: newId('o'),
    hostId: spec.hostId,
    offset: spec.offset,
    width: spec.width,
    height: spec.height,
    sillHeight: spec.sillHeight,
    predefinedType: 'opening',
    depth: null,
  }
  return { scene: { ...scene, openings: [...scene.openings, opening] }, id: opening.id }
}

/**
 * Place a door or window: creates the void AND the filling that fills it, sized from the
 * filling's type. This is the IFC two-step (host → opening → filling) as one user action.
 */
export function addFilledOpening(
  scene: SceneGraph,
  hostId: string,
  typeId: string,
  offsetAlongWall: number,
): { scene: SceneGraph; openingId: string; fillingId: string } | null {
  const type = findType(scene, typeId)
  if (!type || (type.category !== 'door' && type.category !== 'window')) return null

  const wall = scene.walls.find((w) => w.id === hostId)
  if (!wall) return null
  const resolved = resolveWall(scene, wall)
  if (!resolved) return null

  const width = Math.min(type.width, resolved.length)
  const sillHeight = type.category === 'window' ? type.defaultSillHeight : 0
  const height = Math.min(type.height, Math.max(0.1, resolved.height - sillHeight))
  // Centre the opening on the click, then clamp so it stays inside the wall.
  const offset = Math.max(0, Math.min(resolved.length - width, offsetAlongWall - width / 2))

  const opening: Opening = {
    id: newId('o'),
    hostId,
    offset,
    width,
    height,
    sillHeight,
    predefinedType: 'opening',
    depth: null,
  }
  const filling: Filling = {
    id: newId('f'),
    openingId: opening.id,
    typeId,
    flippedHand: false,
    flippedFacing: false,
  }
  return {
    scene: {
      ...scene,
      openings: [...scene.openings, opening],
      fillings: [...scene.fillings, filling],
    },
    openingId: opening.id,
    fillingId: filling.id,
  }
}

export function updateOpening(scene: SceneGraph, id: string, patch: Partial<Opening>): SceneGraph {
  return {
    ...scene,
    openings: scene.openings.map((o) => (o.id === id ? { ...o, ...patch, id: o.id } : o)),
  }
}

export function updateFilling(scene: SceneGraph, id: string, patch: Partial<Filling>): SceneGraph {
  return {
    ...scene,
    fillings: scene.fillings.map((f) => (f.id === id ? { ...f, ...patch, id: f.id } : f)),
  }
}

/** Resize the void to match its filling's type — used after swapping a door/window type. */
export function syncOpeningToFilling(scene: SceneGraph, fillingId: string): SceneGraph {
  const filling = scene.fillings.find((f) => f.id === fillingId)
  if (!filling) return scene
  const type = findType(scene, filling.typeId)
  if (!type || (type.category !== 'door' && type.category !== 'window')) return scene
  const opening = scene.openings.find((o) => o.id === filling.openingId)
  if (!opening) return scene
  const wall = scene.walls.find((w) => w.id === opening.hostId)
  const resolved = wall ? resolveWall(scene, wall) : null
  const maxLen = resolved?.length ?? type.width
  const width = Math.min(type.width, maxLen)
  const sillHeight = type.category === 'window' ? type.defaultSillHeight : 0
  return updateOpening(scene, opening.id, {
    width,
    height: type.height,
    sillHeight,
    offset: Math.max(0, Math.min(maxLen - width, opening.offset)),
  })
}

// ---- Slabs, columns, beams --------------------------------------------------

export function addSlab(
  scene: SceneGraph,
  levelId: string,
  typeId: string,
  boundary: Vec2[],
): { scene: SceneGraph; id: string } {
  const slab: Slab = { id: newId('sl'), typeId, levelId, boundary, heightOffset: 0 }
  return { scene: { ...scene, slabs: [...scene.slabs, slab] }, id: slab.id }
}

export function updateSlab(scene: SceneGraph, id: string, patch: Partial<Slab>): SceneGraph {
  return {
    ...scene,
    slabs: scene.slabs.map((s) => (s.id === id ? { ...s, ...patch, id: s.id } : s)),
  }
}

export function addColumn(
  scene: SceneGraph,
  levelId: string,
  typeId: string,
  position: Vec2,
): { scene: SceneGraph; id: string } {
  const level = findLevel(scene, levelId)
  const column: Column = {
    id: newId('c'),
    typeId,
    levelId,
    position,
    baseOffset: 0,
    top: { kind: 'unconnected', height: level?.height ?? 2.8 },
    rotation: 0,
  }
  return { scene: { ...scene, columns: [...scene.columns, column] }, id: column.id }
}

export function updateColumn(scene: SceneGraph, id: string, patch: Partial<Column>): SceneGraph {
  return {
    ...scene,
    columns: scene.columns.map((c) => (c.id === id ? { ...c, ...patch, id: c.id } : c)),
  }
}

export function addBeam(
  scene: SceneGraph,
  levelId: string,
  typeId: string,
  start: Vec2,
  end: Vec2,
): { scene: SceneGraph; id: string } {
  const level = findLevel(scene, levelId)
  const beam: Beam = {
    id: newId('b'),
    typeId,
    levelId,
    start,
    end,
    // Default to the underside of the level above, the usual structural position.
    heightOffset: level?.height ?? 2.8,
    crossSectionRotation: 0,
  }
  return { scene: { ...scene, beams: [...scene.beams, beam] }, id: beam.id }
}

export function updateBeam(scene: SceneGraph, id: string, patch: Partial<Beam>): SceneGraph {
  return {
    ...scene,
    beams: scene.beams.map((b) => (b.id === id ? { ...b, ...patch, id: b.id } : b)),
  }
}

// ---- Rooms & furniture ------------------------------------------------------

export function addRoom(
  scene: SceneGraph,
  levelId: string,
  polygon: Vec2[],
  name = 'Room',
): { scene: SceneGraph; id: string } {
  const level = findLevel(scene, levelId)
  const room: Room = {
    id: newId('r'),
    levelId,
    name,
    number: String(scene.rooms.length + 1),
    polygon,
    floorMaterial: 'mat-oak',
    baseOffset: 0,
    top: { kind: 'unconnected', height: level?.height ?? 2.8 },
  }
  return { scene: { ...scene, rooms: [...scene.rooms, room] }, id: room.id }
}

export function updateRoom(scene: SceneGraph, id: string, patch: Partial<Room>): SceneGraph {
  return {
    ...scene,
    rooms: scene.rooms.map((r) => (r.id === id ? { ...r, ...patch, id: r.id } : r)),
  }
}

export function addFurniture(
  scene: SceneGraph,
  levelId: string,
  typeId: string,
  position: Vec2,
): { scene: SceneGraph; id: string } {
  const item: FurnitureItem = {
    id: newId('fu'),
    typeId,
    levelId,
    position,
    rotation: 0,
    scale: 1,
    heightOffset: 0,
  }
  return { scene: { ...scene, furniture: [...scene.furniture, item] }, id: item.id }
}

export function updateFurniture(
  scene: SceneGraph,
  id: string,
  patch: Partial<FurnitureItem>,
): SceneGraph {
  return {
    ...scene,
    furniture: scene.furniture.map((f) => (f.id === id ? { ...f, ...patch, id: f.id } : f)),
  }
}

// ---- Cross-cutting ----------------------------------------------------------

function shift(p: Vec2, dx: number, dy: number): Vec2 {
  return [p[0] + dx, p[1] + dy]
}

/** Translate an element by a 2D delta. Openings slide along their host instead. */
export function moveElement(scene: SceneGraph, id: string, delta: Vec2): SceneGraph {
  const el = findElement(scene, id)
  if (!el) return scene
  const [dx, dy] = delta

  switch (el.kind) {
    case 'wall': {
      const w = scene.walls.find((x) => x.id === id)!
      return updateWall(scene, id, {
        baseline: {
          ...w.baseline,
          start: shift(w.baseline.start, dx, dy),
          end: shift(w.baseline.end, dx, dy),
        },
      })
    }
    case 'slab': {
      const s = scene.slabs.find((x) => x.id === id)!
      return updateSlab(scene, id, { boundary: s.boundary.map((p) => shift(p, dx, dy)) })
    }
    case 'room': {
      const r = scene.rooms.find((x) => x.id === id)!
      return updateRoom(scene, id, { polygon: r.polygon.map((p) => shift(p, dx, dy)) })
    }
    case 'column': {
      const c = scene.columns.find((x) => x.id === id)!
      return updateColumn(scene, id, { position: shift(c.position, dx, dy) })
    }
    case 'beam': {
      const b = scene.beams.find((x) => x.id === id)!
      return updateBeam(scene, id, { start: shift(b.start, dx, dy), end: shift(b.end, dx, dy) })
    }
    case 'furniture': {
      const f = scene.furniture.find((x) => x.id === id)!
      return updateFurniture(scene, id, { position: shift(f.position, dx, dy) })
    }
    case 'primitive': {
      const p = scene.primitives.find((x) => x.id === id)!
      return updatePrimitive(scene, id, { position: shift(p.position, dx, dy) })
    }
    case 'boolean': {
      // A boolean has no position of its own — it is wherever its operands are. Moving the result
      // moves every leaf primitive under it, so the shape keeps its form instead of shearing.
      const node = scene.booleans.find((x) => x.id === id)!
      return node.operandIds.reduce((acc, operandId) => moveElement(acc, operandId, delta), scene)
    }
    case 'opening':
    case 'filling': {
      // An opening is hosted — dragging it slides it along the wall rather than off it.
      const opening =
        el.kind === 'opening'
          ? scene.openings.find((o) => o.id === id)!
          : scene.openings.find(
              (o) => o.id === scene.fillings.find((f) => f.id === id)!.openingId,
            )
      if (!opening) return scene
      const wall = scene.walls.find((w) => w.id === opening.hostId)
      const resolved = wall ? resolveWall(scene, wall) : null
      if (!resolved) return scene
      const tangent =
        resolved.centerline.kind === 'line'
          ? [
              resolved.centerline.end[0] - resolved.centerline.start[0],
              resolved.centerline.end[1] - resolved.centerline.start[1],
            ]
          : [1, 0]
      const len = Math.hypot(tangent[0], tangent[1]) || 1
      const along = (dx * tangent[0] + dy * tangent[1]) / len
      const offset = Math.max(0, Math.min(resolved.length - opening.width, opening.offset + along))
      return updateOpening(scene, opening.id, { offset })
    }
    default:
      return scene
  }
}

/**
 * Apply a 2D affine transform to an element — the shared engine behind rotate, mirror, copy and
 * array (D4). Every verb reduces to a transform, so the two things that are easy to get wrong (an
 * arc's bulge sign under a mirror, and a stored `rotation` scalar) are handled once.
 *
 * An opening or filling is HOSTED: it has no independent position, so transforming it directly is a
 * no-op. It moves because its wall moved.
 */
export function transformElement(scene: SceneGraph, id: string, xf: Transform2D): SceneGraph {
  const el = findElement(scene, id)
  if (!el) return scene
  const p = (v: Vec2) => applyTransform(xf, v)

  switch (el.kind) {
    case 'wall': {
      const w = scene.walls.find((x) => x.id === id)!
      return updateWall(scene, id, { baseline: transformBaseline(w.baseline, xf) })
    }
    case 'slab': {
      const s = scene.slabs.find((x) => x.id === id)!
      return updateSlab(scene, id, { boundary: s.boundary.map(p) })
    }
    case 'room': {
      const r = scene.rooms.find((x) => x.id === id)!
      return updateRoom(scene, id, { polygon: r.polygon.map(p) })
    }
    case 'column': {
      const c = scene.columns.find((x) => x.id === id)!
      return updateColumn(scene, id, {
        position: p(c.position),
        rotation: transformRotation(c.rotation, xf),
      })
    }
    case 'beam': {
      const b = scene.beams.find((x) => x.id === id)!
      return updateBeam(scene, id, { start: p(b.start), end: p(b.end) })
    }
    case 'furniture': {
      const f = scene.furniture.find((x) => x.id === id)!
      return updateFurniture(scene, id, {
        position: p(f.position),
        rotation: transformRotation(f.rotation, xf),
      })
    }
    case 'primitive': {
      const pr = scene.primitives.find((x) => x.id === id)!
      return updatePrimitive(scene, id, {
        position: p(pr.position),
        rotation: transformRotation(pr.rotation, xf),
      })
    }
    case 'boolean': {
      // As with `moveElement`: transform the leaves, not the node. Mirroring a cut must mirror the
      // cutter too, or the result changes shape rather than position.
      const node = scene.booleans.find((x) => x.id === id)!
      return node.operandIds.reduce((acc, operandId) => transformElement(acc, operandId, xf), scene)
    }
    default:
      return scene
  }
}

/**
 * Copy an element, returning the new scene and the new id.
 *
 * A wall takes its openings AND their fillings with it — the mirror image of what `deleteElement`
 * cascades. Copying a wall and losing its doors would be a silent data loss the user only notices
 * later. Openings and fillings cannot be duplicated on their own: an opening without a host is
 * meaningless, so the caller gets `null`.
 */
export function duplicateElement(
  scene: SceneGraph,
  id: string,
): { scene: SceneGraph; id: string } | null {
  const el = findElement(scene, id)
  if (!el) return null

  switch (el.kind) {
    case 'wall': {
      const w = scene.walls.find((x) => x.id === id)!
      const copy: Wall = { ...w, id: newId('w'), baseline: { ...w.baseline } }
      let next: SceneGraph = { ...scene, walls: [...scene.walls, copy] }

      for (const o of scene.openings.filter((x) => x.hostId === id)) {
        const oCopy: Opening = { ...o, id: newId('o'), hostId: copy.id }
        const fillings = scene.fillings
          .filter((f) => f.openingId === o.id)
          .map((f) => ({ ...f, id: newId('f'), openingId: oCopy.id }))
        next = {
          ...next,
          openings: [...next.openings, oCopy],
          fillings: [...next.fillings, ...fillings],
        }
      }
      return { scene: next, id: copy.id }
    }
    case 'slab': {
      const s = scene.slabs.find((x) => x.id === id)!
      const copy: Slab = { ...s, id: newId('sl'), boundary: s.boundary.map((p) => [...p] as Vec2) }
      return { scene: { ...scene, slabs: [...scene.slabs, copy] }, id: copy.id }
    }
    case 'room': {
      const r = scene.rooms.find((x) => x.id === id)!
      const copy: Room = { ...r, id: newId('rm'), polygon: r.polygon.map((p) => [...p] as Vec2) }
      return { scene: { ...scene, rooms: [...scene.rooms, copy] }, id: copy.id }
    }
    case 'column': {
      const c = scene.columns.find((x) => x.id === id)!
      const copy: Column = { ...c, id: newId('c'), position: [...c.position] as Vec2 }
      return { scene: { ...scene, columns: [...scene.columns, copy] }, id: copy.id }
    }
    case 'beam': {
      const b = scene.beams.find((x) => x.id === id)!
      const copy: Beam = {
        ...b,
        id: newId('b'),
        start: [...b.start] as Vec2,
        end: [...b.end] as Vec2,
      }
      return { scene: { ...scene, beams: [...scene.beams, copy] }, id: copy.id }
    }
    case 'furniture': {
      const f = scene.furniture.find((x) => x.id === id)!
      const copy: FurnitureItem = { ...f, id: newId('fn'), position: [...f.position] as Vec2 }
      return { scene: { ...scene, furniture: [...scene.furniture, copy] }, id: copy.id }
    }
    case 'primitive': {
      const p = scene.primitives.find((x) => x.id === id)!
      const copy: Primitive = { ...p, id: newId('pr'), position: [...p.position] as Vec2 }
      return { scene: { ...scene, primitives: [...scene.primitives, copy] }, id: copy.id }
    }
    case 'boolean': {
      // Copying a boolean must deep-copy the whole subtree. Sharing operands with the original
      // would mean dragging the copy also moved the original — the copies would not be independent
      // objects at all. The mirror of the wall → openings → fillings cascade above.
      const node = scene.booleans.find((x) => x.id === id)!
      let next = scene
      const copiedOperandIds: string[] = []
      for (const operandId of node.operandIds) {
        const copied = duplicateElement(next, operandId)
        if (!copied) return null
        next = copied.scene
        copiedOperandIds.push(copied.id)
      }
      const copy: BooleanNode = { ...node, id: newId('bool'), operandIds: copiedOperandIds }
      return { scene: { ...next, booleans: [...next.booleans, copy] }, id: copy.id }
    }
    default:
      return null
  }
}

/** Set the material of a room's floor, or re-point an element at a different type. */
export function setElementType(scene: SceneGraph, id: string, typeId: string): SceneGraph {
  const el = findElement(scene, id)
  if (!el) return scene
  switch (el.kind) {
    case 'wall':
      return updateWall(scene, id, { typeId })
    case 'slab':
      return updateSlab(scene, id, { typeId })
    case 'column':
      return updateColumn(scene, id, { typeId })
    case 'beam':
      return updateBeam(scene, id, { typeId })
    case 'furniture':
      return updateFurniture(scene, id, { typeId })
    case 'primitive':
      return updatePrimitive(scene, id, { typeId })
    case 'filling':
      return syncOpeningToFilling(updateFilling(scene, id, { typeId }), id)
    default:
      return scene
  }
}

/**
 * Delete an element and everything that depends on it. A wall takes its openings and their
 * fillings; a level takes everything hosted on it. Cascades are explicit, never implicit.
 */
export function deleteElement(scene: SceneGraph, id: string): SceneGraph {
  const el = findElement(scene, id)
  if (!el) return scene

  switch (el.kind) {
    case 'wall': {
      const doomedOpenings = scene.openings.filter((o) => o.hostId === id).map((o) => o.id)
      return {
        ...scene,
        walls: scene.walls.filter((w) => w.id !== id),
        openings: scene.openings.filter((o) => o.hostId !== id),
        fillings: scene.fillings.filter((f) => !doomedOpenings.includes(f.openingId)),
      }
    }
    case 'opening':
      return {
        ...scene,
        openings: scene.openings.filter((o) => o.id !== id),
        fillings: scene.fillings.filter((f) => f.openingId !== id),
      }
    case 'filling': {
      // Removing a door leaves the hole; removing the hole is a separate action.
      const filling = scene.fillings.find((f) => f.id === id)
      if (!filling) return scene
      return {
        ...scene,
        fillings: scene.fillings.filter((f) => f.id !== id),
        openings: scene.openings.filter((o) => o.id !== filling.openingId),
      }
    }
    case 'slab':
      return { ...scene, slabs: scene.slabs.filter((s) => s.id !== id) }
    case 'column':
      return { ...scene, columns: scene.columns.filter((c) => c.id !== id) }
    case 'beam':
      return { ...scene, beams: scene.beams.filter((b) => b.id !== id) }
    case 'room':
      return { ...scene, rooms: scene.rooms.filter((r) => r.id !== id) }
    case 'furniture':
      return { ...scene, furniture: scene.furniture.filter((f) => f.id !== id) }
    case 'dimension':
      return { ...scene, dimensions: scene.dimensions.filter((d) => d.id !== id) }
    case 'annotation':
      return { ...scene, annotations: scene.annotations.filter((a) => a.id !== id) }
    case 'roomTag':
      return { ...scene, roomTags: scene.roomTags.filter((t) => t.id !== id) }
    case 'columnGrid':
      return { ...scene, columnGrids: scene.columnGrids.filter((g) => g.id !== id) }
    case 'roof':
      return { ...scene, roofs: scene.roofs.filter((r) => r.id !== id) }
    case 'primitive':
      // Deleting a shape that a boolean uses must also repair that boolean, or the tree would be
      // left referencing an id that no longer exists and would refuse to resolve from then on.
      return pruneBooleanOperand(
        { ...scene, primitives: scene.primitives.filter((p) => p.id !== id) },
        id,
      )
    case 'boolean':
      // Deleting the OPERATION releases its operands rather than destroying them (see
      // `dissolveBooleanNode`), but a node consumed by a parent still has to be pruned from it.
      return pruneBooleanOperand(dissolveBooleanNode(scene, id), id)
    case 'level': {
      const doomedWalls = scene.walls.filter((w) => w.levelId === id).map((w) => w.id)
      const doomedOpenings = scene.openings
        .filter((o) => doomedWalls.includes(o.hostId))
        .map((o) => o.id)
      return {
        ...scene,
        levels: scene.levels.filter((l) => l.id !== id),
        walls: scene.walls.filter((w) => w.levelId !== id),
        openings: scene.openings.filter((o) => !doomedOpenings.includes(o.id)),
        fillings: scene.fillings.filter((f) => !doomedOpenings.includes(f.openingId)),
        slabs: scene.slabs.filter((s) => s.levelId !== id),
        columns: scene.columns.filter((c) => c.levelId !== id),
        beams: scene.beams.filter((b) => b.levelId !== id),
        rooms: scene.rooms.filter((r) => r.levelId !== id),
        furniture: scene.furniture.filter((f) => f.levelId !== id),
        columnGrids: scene.columnGrids.filter((g) => g.levelId !== id),
        roofs: scene.roofs.filter((r) => r.levelId !== id),
        primitives: scene.primitives.filter((p) => p.levelId !== id),
        booleans: scene.booleans.filter((b) => b.levelId !== id),
      }
    }
    default:
      return scene
  }
}

/** Human label for the model tree and the status bar. */
export function elementLabel(scene: SceneGraph, id: string): string {
  const el = findElement(scene, id)
  if (!el) return id
  const typeName = (typeId: string): string => findType(scene, typeId)?.name ?? typeId
  switch (el.kind) {
    case 'wall': {
      const w = scene.walls.find((x) => x.id === id)!
      const len = baselineLength(w.baseline)
      return `${typeName(w.typeId)} · ${len.toFixed(2)}m`
    }
    case 'filling': {
      const f = scene.fillings.find((x) => x.id === id)!
      return typeName(f.typeId)
    }
    case 'opening':
      return 'Opening'
    case 'slab': {
      const s = scene.slabs.find((x) => x.id === id)!
      return typeName(s.typeId)
    }
    case 'column': {
      const c = scene.columns.find((x) => x.id === id)!
      return typeName(c.typeId)
    }
    case 'beam': {
      const b = scene.beams.find((x) => x.id === id)!
      return typeName(b.typeId)
    }
    case 'room': {
      const r = scene.rooms.find((x) => x.id === id)!
      return `${r.number} — ${r.name}`
    }
    case 'furniture': {
      const f = scene.furniture.find((x) => x.id === id)!
      return typeName(f.typeId)
    }
    case 'level':
      return scene.levels.find((x) => x.id === id)?.name ?? 'Level'
    case 'dimension': {
      const d = scene.dimensions.find((x) => x.id === id)!
      return `Dimension (${d.kind})`
    }
    case 'annotation': {
      const a = scene.annotations.find((x) => x.id === id)!
      return a.text || 'Annotation'
    }
    case 'roomTag': {
      const t = scene.roomTags.find((x) => x.id === id)!
      const room = scene.rooms.find((r) => r.id === t.roomId)
      return room ? `Tag — ${room.name}` : 'Room tag'
    }
    case 'columnGrid': {
      const g = scene.columnGrids.find((x) => x.id === id)!
      return `${g.name} (${g.xAxes.length}×${g.yAxes.length})`
    }
    case 'roof': {
      const r = scene.roofs.find((x) => x.id === id)!
      return `${typeName(r.typeId)} · ${r.edges[0]?.angle ?? 0}°`
    }
    case 'primitive': {
      const p = scene.primitives.find((x) => x.id === id)!
      return typeName(p.typeId)
    }
    case 'boolean': {
      const b = scene.booleans.find((x) => x.id === id)!
      return `${booleanOpLabel(b.op)} (${b.operandIds.length})`
    }
  }
}

// ---------------------------------------------------------------------------
// Dimension / annotation CRUD
// ---------------------------------------------------------------------------

export function addDimension(scene: SceneGraph, dim: Dimension): SceneGraph {
  return { ...scene, dimensions: [...scene.dimensions, dim] }
}

export function removeDimension(scene: SceneGraph, id: string): SceneGraph {
  return { ...scene, dimensions: scene.dimensions.filter((d) => d.id !== id) }
}

export function updateDimension(scene: SceneGraph, id: string, patch: Partial<Dimension>): SceneGraph {
  return {
    ...scene,
    dimensions: scene.dimensions.map((d) => (d.id === id ? { ...d, ...patch, id: d.id } : d)),
  }
}

export function addAnnotation(scene: SceneGraph, ann: Annotation): SceneGraph {
  return { ...scene, annotations: [...scene.annotations, ann] }
}

export function removeAnnotation(scene: SceneGraph, id: string): SceneGraph {
  return { ...scene, annotations: scene.annotations.filter((a) => a.id !== id) }
}

export function updateAnnotation(scene: SceneGraph, id: string, patch: Partial<Annotation>): SceneGraph {
  return {
    ...scene,
    annotations: scene.annotations.map((a) => (a.id === id ? { ...a, ...patch, id: a.id } : a)),
  }
}

export function addRoomTag(scene: SceneGraph, tag: RoomTag): SceneGraph {
  return { ...scene, roomTags: [...scene.roomTags, tag] }
}

export function removeRoomTag(scene: SceneGraph, id: string): SceneGraph {
  return { ...scene, roomTags: scene.roomTags.filter((t) => t.id !== id) }
}

export function updateRoomTag(scene: SceneGraph, id: string, patch: Partial<RoomTag>): SceneGraph {
  return {
    ...scene,
    roomTags: scene.roomTags.map((t) => (t.id === id ? { ...t, ...patch, id: t.id } : t)),
  }
}

// ---------------------------------------------------------------------------
// Column grid CRUD (B6)
// ---------------------------------------------------------------------------

export function addColumnGrid(scene: SceneGraph, grid: ColumnGrid): SceneGraph {
  return { ...scene, columnGrids: [...scene.columnGrids, grid] }
}

export function removeColumnGrid(scene: SceneGraph, id: string): SceneGraph {
  return { ...scene, columnGrids: scene.columnGrids.filter((g) => g.id !== id) }
}

export function updateColumnGrid(
  scene: SceneGraph,
  id: string,
  patch: Partial<ColumnGrid>,
): SceneGraph {
  return {
    ...scene,
    columnGrids: scene.columnGrids.map((g) => (g.id === id ? { ...g, ...patch, id: g.id } : g)),
  }
}

/** Append a new axis, one bay beyond the current last one, with the next sequential label. */
export function addGridAxis(
  scene: SceneGraph,
  gridId: string,
  direction: 'x' | 'y',
  spacing: number,
): SceneGraph {
  const grid = scene.columnGrids.find((g) => g.id === gridId)
  if (!grid) return scene
  const axes = direction === 'x' ? grid.xAxes : grid.yAxes
  const nextLabel = String(axes.length + 1)
  const axis: GridAxis = { id: newId('ax'), label: nextLabel, spacing: axes.length === 0 ? 0 : spacing }
  const patch =
    direction === 'x' ? { xAxes: [...axes, axis] } : { yAxes: [...axes, axis] }
  return updateColumnGrid(scene, gridId, patch)
}

/** Remove the last axis in a direction. Refuses to drop below one axis — a grid needs at least
 * one line per direction to mean anything. */
export function removeLastGridAxis(
  scene: SceneGraph,
  gridId: string,
  direction: 'x' | 'y',
): SceneGraph {
  const grid = scene.columnGrids.find((g) => g.id === gridId)
  if (!grid) return scene
  const axes = direction === 'x' ? grid.xAxes : grid.yAxes
  if (axes.length <= 1) return scene
  const trimmed = axes.slice(0, -1)
  const patch = direction === 'x' ? { xAxes: trimmed } : { yAxes: trimmed }
  return updateColumnGrid(scene, gridId, patch)
}

export function updateGridAxis(
  scene: SceneGraph,
  gridId: string,
  direction: 'x' | 'y',
  axisId: string,
  patch: Partial<GridAxis>,
): SceneGraph {
  const grid = scene.columnGrids.find((g) => g.id === gridId)
  if (!grid) return scene
  const axes = direction === 'x' ? grid.xAxes : grid.yAxes
  const updated = axes.map((a) => (a.id === axisId ? { ...a, ...patch, id: a.id } : a))
  const gridPatch = direction === 'x' ? { xAxes: updated } : { yAxes: updated }
  return updateColumnGrid(scene, gridId, gridPatch)
}

// ---------------------------------------------------------------------------
// Roof CRUD (B1)
// ---------------------------------------------------------------------------

export function addRoof(scene: SceneGraph, roof: Roof): SceneGraph {
  return { ...scene, roofs: [...scene.roofs, roof] }
}

export function removeRoof(scene: SceneGraph, id: string): SceneGraph {
  return { ...scene, roofs: scene.roofs.filter((r) => r.id !== id) }
}

export function updateRoof(scene: SceneGraph, id: string, patch: Partial<Roof>): SceneGraph {
  return { ...scene, roofs: scene.roofs.map((r) => (r.id === id ? { ...r, ...patch, id: r.id } : r)) }
}

// ---------------------------------------------------------------------------
// Primitive solids & boolean trees (B7 — see DECISIONS.md D-019)
// ---------------------------------------------------------------------------

export function addPrimitive(
  scene: SceneGraph,
  levelId: string,
  typeId: string,
  position: Vec2,
): { scene: SceneGraph; id: string } {
  const primitive: Primitive = {
    id: newId('pr'),
    typeId,
    levelId,
    position,
    heightOffset: 0,
    rotation: 0,
    scale: 1,
  }
  return { scene: { ...scene, primitives: [...scene.primitives, primitive] }, id: primitive.id }
}

export function updatePrimitive(
  scene: SceneGraph,
  id: string,
  patch: Partial<Primitive>,
): SceneGraph {
  return {
    ...scene,
    primitives: scene.primitives.map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p)),
  }
}

export function addBooleanNode(
  scene: SceneGraph,
  levelId: string,
  op: BooleanOp,
  operandIds: string[],
): { scene: SceneGraph; id: string } {
  const node: BooleanNode = { id: newId('bool'), levelId, op, operandIds: [...operandIds] }
  return { scene: { ...scene, booleans: [...scene.booleans, node] }, id: node.id }
}

export function updateBooleanNode(
  scene: SceneGraph,
  id: string,
  patch: Partial<BooleanNode>,
): SceneGraph {
  return {
    ...scene,
    booleans: scene.booleans.map((b) => (b.id === id ? { ...b, ...patch, id: b.id } : b)),
  }
}

/**
 * Dissolve a boolean node, releasing its operands back to being ordinary visible elements.
 *
 * This is the counterpart to creating one, and it is why `deleteElement` on a boolean does NOT
 * destroy the shapes inside it: combining two boxes is an edit, not a consumption, so undoing that
 * decision must give the boxes back. Deleting the *shapes* is a separate, explicit action.
 */
export function dissolveBooleanNode(scene: SceneGraph, id: string): SceneGraph {
  return { ...scene, booleans: scene.booleans.filter((b) => b.id !== id) }
}

/**
 * Remove an id from every boolean node that uses it as an operand, dropping any node left with
 * fewer than two operands (a "union of one shape" is not a thing — see `MIN_OPERANDS`).
 *
 * Applied recursively, because dropping a node can itself orphan the node above it.
 */
function pruneBooleanOperand(scene: SceneGraph, removedId: string): SceneGraph {
  let next = scene
  let doomed: string[] = [removedId]

  while (doomed.length > 0) {
    const removing = doomed
    doomed = []
    const booleans: BooleanNode[] = []
    for (const node of next.booleans) {
      if (removing.includes(node.id)) continue
      const operandIds = node.operandIds.filter((o) => !removing.includes(o))
      if (operandIds.length < 2) {
        doomed.push(node.id)
        continue
      }
      booleans.push(operandIds.length === node.operandIds.length ? node : { ...node, operandIds })
    }
    next = { ...next, booleans }
  }
  return next
}

/** Set every edge's angle/overhang at once — v1 requires them uniform (D-018). */
export function setRoofUniformEdge(
  scene: SceneGraph,
  id: string,
  patch: Partial<RoofEdge>,
): SceneGraph {
  const roof = scene.roofs.find((r) => r.id === id)
  if (!roof) return scene
  return updateRoof(scene, id, { edges: roof.edges.map((e) => ({ ...e, ...patch })) })
}
