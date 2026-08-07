/**
 * Stair geometry (B2) — a straight flight, decomposed into one SOLID box per step.
 *
 * `desiredNumberOfRisers` is what the user sets; `actualRiserHeight` is always DERIVED from it and
 * the resolved rise (the gap between the stair's base and its `top`), never stored — so moving the
 * level a stair lands on keeps the flight geometrically consistent instead of drifting out of sync
 * with a separately-stored riser height. This is the same "derive, don't duplicate" rule
 * `resolveWall` already follows for a wall's height.
 *
 * The solid decomposition: for a stair with N risers, step `i` (0-indexed) is one axis-aligned box
 * spanning the horizontal range `[i·treadDepth, (i+1)·treadDepth]` and the FULL height below its
 * own tread, `[0, (i+1)·riserHeight]` — i.e. each step's box reaches all the way down to the base,
 * so the boxes stack up like a real solid-core stair rather than floating slabs. This is exact and
 * boring in exactly the way `wallSolidBoxes`' box decomposition is: N boxes, no meshing, no CSG.
 */
import type { Box3D } from './index'
import { direction, distance, rotationYFor } from './index'
import {
  findLevel,
  findStairType,
  resolveTopElevation,
  type SceneGraph,
  type Stair,
  type Vec2,
} from '../types/scene'

/** Blondel's comfort formula: 2·riser + tread should fall in this range (metres). */
export const BLONDEL_MIN = 0.57
export const BLONDEL_MAX = 0.66

export interface ResolvedStair {
  id: string
  baseElevation: number
  topElevation: number
  /** Total vertical climb; may be <= 0 for a misconfigured stair (checked by `validateStair`). */
  rise: number
  /** Derived from `rise / desiredNumberOfRisers` — never stored. */
  actualRiserHeight: number
  treadDepth: number
  width: number
  numRisers: number
  material: string
  start: Vec2
  direction: Vec2
}

export function resolveStair(scene: SceneGraph, stair: Stair): ResolvedStair | null {
  const type = findStairType(scene, stair.typeId)
  const level = findLevel(scene, stair.levelId)
  if (!type || !level) return null
  if (distance(stair.baseline.start, stair.baseline.end) < 1e-6) return null

  const baseElevation = level.elevation + stair.baseOffset
  const topElevation = resolveTopElevation(scene, stair.top, baseElevation)
  const rise = topElevation - baseElevation
  const numRisers = stair.desiredNumberOfRisers

  return {
    id: stair.id,
    baseElevation,
    topElevation,
    rise,
    actualRiserHeight: numRisers > 0 ? rise / numRisers : 0,
    treadDepth: type.treadDepth,
    width: type.width,
    numRisers,
    material: type.material,
    start: stair.baseline.start,
    direction: direction(stair.baseline.start, stair.baseline.end),
  }
}

/** One solid box per step. Empty for a stair that cannot resolve to real geometry. */
export function stairSolidBoxes(stair: ResolvedStair): Box3D[] {
  const { numRisers, treadDepth, actualRiserHeight, width, baseElevation, start, direction: dir } = stair
  if (numRisers < 1 || treadDepth <= 1e-9 || actualRiserHeight <= 1e-9 || width <= 1e-9) return []

  const rotationY = rotationYFor(dir)
  const boxes: Box3D[] = []
  for (let i = 0; i < numRisers; i++) {
    const height = (i + 1) * actualRiserHeight
    const along = i * treadDepth + treadDepth / 2
    const center2D: Vec2 = [start[0] + dir[0] * along, start[1] + dir[1] * along]
    boxes.push({
      center: [center2D[0], baseElevation + height / 2, center2D[1]],
      size: [treadDepth, height, width],
      rotationY,
    })
  }
  return boxes
}

/**
 * Every reason a stair fails to be geometrically sound OR comfortable to climb, as sentences.
 * Blondel is feedback rather than a hard refusal elsewhere in the app's philosophy — an
 * out-of-range flight still exists and still renders, so this reports it rather than blocking it,
 * the same way an over-slope roof edge would be a design choice, not a crash.
 */
export function validateStair(scene: SceneGraph, stair: Stair): string[] {
  const errors: string[] = []
  const type = findStairType(scene, stair.typeId)
  if (!type) errors.push(`Unknown stair type "${stair.typeId}"`)
  if (!findLevel(scene, stair.levelId)) errors.push(`Unknown level "${stair.levelId}"`)
  if (distance(stair.baseline.start, stair.baseline.end) < 1e-6) {
    errors.push('Stair has no defined direction — its two baseline points coincide')
  }
  if (stair.desiredNumberOfRisers < 2) errors.push('A stair needs at least 2 risers')

  const resolved = type ? resolveStair(scene, stair) : null
  if (resolved) {
    if (resolved.rise <= 0) {
      errors.push('Stair top must be above its base — check the top constraint')
    } else {
      const blondel = 2 * resolved.actualRiserHeight + resolved.treadDepth
      if (blondel < BLONDEL_MIN || blondel > BLONDEL_MAX) {
        errors.push(
          `Blondel ratio ${Math.round(blondel * 100)}cm is outside the comfortable ` +
            `${Math.round(BLONDEL_MIN * 100)}–${Math.round(BLONDEL_MAX * 100)}cm range ` +
            `(riser ${(resolved.actualRiserHeight * 100).toFixed(1)}cm × 2 + tread ` +
            `${(resolved.treadDepth * 100).toFixed(1)}cm)`,
        )
      }
    }
  }
  return errors
}

/** A sane default: enough risers for a ~2.8m storey at a comfortable ~180mm rise. */
export function defaultStair(
  id: string,
  typeId: string,
  levelId: string,
  start: Vec2,
  end: Vec2,
  topHeight = 2.8,
): Stair {
  return {
    id,
    typeId,
    levelId,
    baseline: { start, end },
    baseOffset: 0,
    top: { kind: 'unconnected', height: topHeight },
    desiredNumberOfRisers: Math.max(2, Math.round(topHeight / 0.18)),
  }
}
