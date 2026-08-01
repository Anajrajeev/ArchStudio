/**
 * The modify verbs at scene level — trim, extend, split, offset, align (D3).
 *
 * Each returns either a new scene plus the ids to select, or an error string. Nothing here fails
 * silently: "refuse and explain" is a core rule, and these are the verbs users most often aim
 * slightly wrong.
 *
 * The interesting one is SPLIT. A wall does not exist alone — it hosts openings, whose offsets are
 * measured along its centreline. Splitting must hand each opening to the piece that contains it and
 * rebase its offset, and must refuse when an opening straddles the cut rather than truncating a door
 * in half.
 */
import type { SceneGraph, Vec2 } from '../../../shared/types/scene'
import { baselineLength, offsetBaseline, resolveWall } from '../../../shared/geometry/index'
import { translation } from '../../../shared/geometry/transform'
import {
  extendBaseline,
  isModifyError,
  nearestFraction,
  splitBaseline,
  trimBaseline,
} from '../../../shared/geometry/modify'
import { selectionBounds } from './selection'
import type { VerbOutcome, VerbResult } from './verbResult'
import {
  deleteElement,
  duplicateElement,
  findElement,
  transformElement,
  updateWall,
} from '../scene/mutations'

/** Aliases of the shared verb contract; see `verbResult.ts`. */
export type ModifyOutcome = VerbOutcome
export type ModifyResult = VerbResult

function wallOf(scene: SceneGraph, id: string) {
  return scene.walls.find((w) => w.id === id) ?? null
}

// ---------------------------------------------------------------------------
// Trim & extend
// ---------------------------------------------------------------------------

/**
 * Trim `targetId` against `cutterId`, keeping the side containing `keepPoint`.
 *
 * The click that picked the target IS the keep point, so this reads as "click the part you want to
 * keep" — the convention that makes trim feel predictable rather than a coin flip.
 */
export function trimWall(
  scene: SceneGraph,
  targetId: string,
  cutterId: string,
  keepPoint: Vec2,
): ModifyResult {
  if (targetId === cutterId) return { error: 'Pick a different wall as the cutting edge' }
  const target = wallOf(scene, targetId)
  const cutter = wallOf(scene, cutterId)
  if (!target || !cutter) return { error: 'Trim needs two walls' }

  const trimmed = trimBaseline(target.baseline, cutter.baseline, keepPoint)
  if (isModifyError(trimmed)) return trimmed

  // An opening now hanging off the removed portion would be silently orphaned mid-air.
  const newLength = baselineLength(trimmed)
  const lost = scene.openings.filter(
    (o) => o.hostId === targetId && o.offset + o.width > newLength + 1e-6,
  )
  if (lost.length > 0) {
    return {
      error: `Trimming here would cut through ${lost.length} opening${lost.length === 1 ? '' : 's'}`,
    }
  }

  return {
    scene: updateWall(scene, targetId, { baseline: trimmed }),
    selectAfter: [targetId],
    label: 'Trim wall',
  }
}

/** Extend `targetId` to meet `boundaryId`'s supporting line, moving the end nearer `pickPoint`. */
export function extendWall(
  scene: SceneGraph,
  targetId: string,
  boundaryId: string,
  pickPoint: Vec2,
): ModifyResult {
  if (targetId === boundaryId) return { error: 'Pick a different wall as the boundary' }
  const target = wallOf(scene, targetId)
  const boundary = wallOf(scene, boundaryId)
  if (!target || !boundary) return { error: 'Extend needs two walls' }

  const extended = extendBaseline(target.baseline, boundary.baseline, pickPoint)
  if (isModifyError(extended)) return extended

  // Extending from the START shifts the origin of every offset measured along the wall, so the
  // openings must slide by the same amount to stay put in space.
  const grewAtStart =
    extended.start[0] !== target.baseline.start[0] || extended.start[1] !== target.baseline.start[1]
  let next = updateWall(scene, targetId, { baseline: extended })
  if (grewAtStart) {
    const added = baselineLength(extended) - baselineLength(target.baseline)
    next = {
      ...next,
      openings: next.openings.map((o) =>
        o.hostId === targetId ? { ...o, offset: o.offset + added } : o,
      ),
    }
  }

  return { scene: next, selectAfter: [targetId], label: 'Extend wall' }
}

// ---------------------------------------------------------------------------
// Split
// ---------------------------------------------------------------------------

/**
 * Split a wall at the point nearest `at`, producing two walls that together occupy the original.
 *
 * Openings are handed to the piece containing them, with offsets rebased. An opening straddling the
 * cut is a refusal, not a truncation: half a door is not a thing.
 */
export function splitWall(scene: SceneGraph, wallId: string, at: Vec2): ModifyResult {
  const wall = wallOf(scene, wallId)
  if (!wall) return { error: 'Split needs a wall' }
  const resolved = resolveWall(scene, wall)
  if (!resolved) return { error: 'That wall cannot be resolved' }

  const t = nearestFraction(wall.baseline, at)
  const halves = splitBaseline(wall.baseline, t)
  if (!halves) return { error: 'Click further from the ends of the wall to split it' }

  const totalLength = resolved.length
  const firstLength = totalLength * t

  const hosted = scene.openings.filter((o) => o.hostId === wallId)
  const straddling = hosted.filter(
    (o) => o.offset < firstLength - 1e-6 && o.offset + o.width > firstLength + 1e-6,
  )
  if (straddling.length > 0) {
    return { error: 'An opening crosses the split point — move it or split elsewhere' }
  }

  // Build the second wall from a copy so every instance property (type, level, top constraint,
  // location line, flip) carries over without being re-listed here and drifting from the schema.
  const dup = duplicateElement(scene, wallId)
  if (!dup) return { error: 'That wall cannot be split' }
  let next = updateWall(dup.scene, wallId, { baseline: halves[0] })
  next = updateWall(next, dup.id, { baseline: halves[1] })

  // `duplicateElement` copied the openings onto the new wall too. Keep, on each side, only the ones
  // that belong there, and rebase the second wall's offsets to its own start.
  const copiedOpenings = next.openings.filter((o) => o.hostId === dup.id)
  for (const o of copiedOpenings) {
    if (o.offset + o.width <= firstLength + 1e-6) {
      next = deleteElement(next, o.id) // belongs to the first piece; drop the copy
    } else {
      next = {
        ...next,
        openings: next.openings.map((x) =>
          x.id === o.id ? { ...x, offset: o.offset - firstLength } : x,
        ),
      }
    }
  }
  for (const o of hosted) {
    if (o.offset + o.width > firstLength + 1e-6) next = deleteElement(next, o.id)
  }

  return { scene: next, selectAfter: [wallId, dup.id], label: 'Split wall' }
}

// ---------------------------------------------------------------------------
// Offset
// ---------------------------------------------------------------------------

/**
 * A parallel wall at `distance` from the original (positive = left of the direction of travel).
 * `keepOriginal: false` moves the wall instead of copying it, which is AutoCAD's OFFSET vs MOVE
 * distinction and the difference between adding a corridor wall and nudging one.
 *
 * Arcs offset correctly — `offsetBaseline` changes the radius and keeps the swept angle, so the
 * bulge is unchanged.
 */
export function offsetWall(
  scene: SceneGraph,
  wallId: string,
  distance: number,
  keepOriginal: boolean,
): ModifyResult {
  const wall = wallOf(scene, wallId)
  if (!wall) return { error: 'Offset needs a wall' }
  if (!Number.isFinite(distance) || Math.abs(distance) < 1e-4) {
    return { error: 'Offset distance is zero' }
  }

  const moved = offsetBaseline(wall.baseline, distance)

  if (!keepOriginal) {
    return {
      scene: updateWall(scene, wallId, { baseline: moved }),
      selectAfter: [wallId],
      label: 'Offset wall',
    }
  }

  const dup = duplicateElement(scene, wallId)
  if (!dup) return { error: 'That wall cannot be offset' }
  return {
    scene: updateWall(dup.scene, dup.id, { baseline: moved }),
    selectAfter: [dup.id],
    label: 'Offset wall copy',
  }
}

// ---------------------------------------------------------------------------
// Align
// ---------------------------------------------------------------------------

export type AlignAxis = 'x' | 'y'
export type AlignEdge = 'min' | 'center' | 'max'

/**
 * Translate each selected element so the chosen edge of its bounds lands on a common value.
 *
 * Translation only, never rotation — an align that also rotated things would be a surprise. The
 * reference is `referenceId`'s bounds when given (Revit's "pick the thing to align TO"), otherwise
 * the whole selection's bounds.
 */
export function alignElements(
  scene: SceneGraph,
  ids: string[],
  axis: AlignAxis,
  edge: AlignEdge,
  referenceId?: string,
): ModifyResult {
  if (ids.length < 1) return { error: 'Select something to align' }
  const i = axis === 'x' ? 0 : 1

  const referenceBounds = selectionBounds(scene, referenceId ? [referenceId] : ids)
  if (!referenceBounds) return { error: 'Nothing in the selection has a position' }
  const targetValue =
    edge === 'min'
      ? referenceBounds.min[i]
      : edge === 'max'
        ? referenceBounds.max[i]
        : (referenceBounds.min[i] + referenceBounds.max[i]) / 2

  let next = scene
  let moved = 0
  for (const id of ids) {
    if (id === referenceId) continue
    const bounds = selectionBounds(next, [id])
    if (!bounds) continue
    const current =
      edge === 'min'
        ? bounds.min[i]
        : edge === 'max'
          ? bounds.max[i]
          : (bounds.min[i] + bounds.max[i]) / 2
    const shift = targetValue - current
    if (Math.abs(shift) < 1e-9) continue
    const delta: Vec2 = axis === 'x' ? [shift, 0] : [0, shift]
    next = translateOne(next, id, delta)
    moved++
  }

  if (moved === 0) return { error: 'Everything is already aligned' }
  return { scene: next, selectAfter: ids, label: `Align ${axis === 'x' ? 'X' : 'Y'}` }
}

/**
 * Translate a single element, reusing D4's affine engine so arcs and rotations behave identically.
 *
 * Deliberately NOT `moveElement`: that slides a hosted opening *along* its wall, which is right for
 * a drag but wrong here — an opening has no independent position to align, so align leaves it to its
 * host.
 */
function translateOne(scene: SceneGraph, id: string, delta: Vec2): SceneGraph {
  const el = findElement(scene, id)
  if (!el || el.kind === 'opening' || el.kind === 'filling') return scene
  return transformElement(scene, id, translation(delta[0], delta[1]))
}
