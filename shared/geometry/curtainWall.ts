/**
 * Curtain walls (B4) — a mullion/panel grid. See DECISIONS.md D-027.
 *
 * The defining property of a glazing system is that **panels are sized BY the grid, never
 * directly**. So the only authored numbers are the two `GridRule`s and the mullion/panel
 * dimensions, all of which live on the TYPE — edit the type and every instance re-grids (D-009).
 * There is no panel width or height field anywhere, by construction.
 *
 * Decomposed into the same axis-aligned `Box3D`s walls, stairs and railings already use, so the
 * viewport renderer and the exporter share one implementation exactly as they do for every other
 * linear element.
 *
 * Scope (D-027): STRAIGHT baselines only. A curved curtain wall is a faceted one, and getting the
 * facets to coincide with the U grid is a second geometry case; it is refused with a message
 * rather than approximated, the same discipline D-018 applies to roofs.
 */

import {
  findCurtainWallType,
  findLevel,
  resolveTopElevation,
  type CurtainWall,
  type CurtainWallTypeDef,
  type GridRule,
  type SceneGraph,
  type Vec2,
} from '../types/scene'
import { direction, distance, lerp2, rotationYFor, type Box3D } from './index'

export interface ResolvedCurtainWall {
  id: string
  type: CurtainWallTypeDef
  start: Vec2
  end: Vec2
  length: number
  baseElevation: number
  topElevation: number
  height: number
}

/**
 * Division positions along a span of `length`, ALWAYS including both ends (0 and `length`).
 *
 * Returning the ends as grid lines rather than special-casing them is what makes the rest of the
 * decomposition trivial: a mullion sits on every line, and a panel fills every gap between
 * consecutive lines, with no separate "border mullion" concept to keep in step.
 */
export function gridPositions(rule: GridRule, length: number): number[] {
  if (length <= 0) return [0]

  if (rule.kind === 'fixedNumber') {
    const count = Math.max(1, Math.floor(rule.count))
    return Array.from({ length: count + 1 }, (_, i) => (length * i) / count)
  }

  if (rule.kind === 'fixedDistance') {
    // Exact bays, with whatever is left over becoming a shorter final bay. A remainder smaller
    // than a millimetre is absorbed rather than emitted as a sliver panel nobody could build.
    const out = [0]
    let s = rule.spacing
    while (length - s > 1e-3) {
      out.push(s)
      s += rule.spacing
    }
    out.push(length)
    return out
  }

  // maximumSpacing: the fewest EQUAL bays such that none exceeds `spacing`. This is what a real
  // glazing system does — an even rhythm across the whole run, no stray narrow panel at one end.
  const count = Math.max(1, Math.ceil(length / rule.spacing - 1e-9))
  return Array.from({ length: count + 1 }, (_, i) => (length * i) / count)
}

export function resolveCurtainWall(
  scene: SceneGraph,
  cw: CurtainWall,
): ResolvedCurtainWall | null {
  const type = findCurtainWallType(scene, cw.typeId)
  const level = findLevel(scene, cw.levelId)
  if (!type || !level) return null
  if (cw.baseline.kind !== 'line') return null

  const baseElevation = level.elevation + cw.baseOffset
  const topElevation = resolveTopElevation(scene, cw.top, baseElevation)
  return {
    id: cw.id,
    type,
    start: cw.baseline.start,
    end: cw.baseline.end,
    length: distance(cw.baseline.start, cw.baseline.end),
    baseElevation,
    topElevation,
    height: Math.max(0, topElevation - baseElevation),
  }
}

/**
 * Mullions, transoms and panels as solid boxes, split by material.
 *
 * Returned as two lists rather than one flat one because framing and glazing are different
 * materials, and a single list would force the renderer AND the exporter each to re-derive which
 * box is which — two chances to disagree about the same thing.
 *
 * Mullions are FULL height and transoms run only between them, so the two never occupy the same
 * material twice — an overlapping pair would double the exported volume and z-fight on screen.
 */
export interface CurtainWallSolids {
  /** Vertical mullions and horizontal transoms. */
  frame: Box3D[]
  /** One infill panel per grid cell. */
  panels: Box3D[]
}

export function curtainWallSolidBoxes(cw: ResolvedCurtainWall): CurtainWallSolids {
  const { type, length, height, baseElevation } = cw
  if (length < 1e-9 || height < 1e-9) return { frame: [], panels: [] }

  const dir = direction(cw.start, cw.end)
  const rotationY = rotationYFor(dir)
  const at = (s: number): Vec2 => [cw.start[0] + dir[0] * s, cw.start[1] + dir[1] * s]

  const us = gridPositions(type.gridU, length)
  const vs = gridPositions(type.gridV, height)
  const mw = type.mullionWidth
  const md = type.mullionDepth
  const frame: Box3D[] = []
  const panels: Box3D[] = []

  // Vertical mullions, one per U line, inset at the two ends so the system stays inside the run
  // the user drew rather than overhanging it by half a mullion at each end.
  for (const u of us) {
    const centre = Math.min(Math.max(u, mw / 2), length - mw / 2)
    const p = at(centre)
    frame.push({
      center: [p[0], baseElevation + height / 2, p[1]],
      size: [mw, height, md],
      rotationY,
    })
  }

  // Horizontal transoms, one per V line, spanning each bay BETWEEN its two mullions.
  for (const v of vs) {
    const centre = Math.min(Math.max(v, mw / 2), height - mw / 2)
    for (let i = 0; i < us.length - 1; i++) {
      const a = us[i] + mw / 2
      const b = us[i + 1] - mw / 2
      if (b - a < 1e-6) continue
      const p = lerp2(at(a), at(b), 0.5)
      frame.push({
        center: [p[0], baseElevation + centre, p[1]],
        size: [b - a, mw, md],
        rotationY,
      })
    }
  }

  // One panel per cell, inset to the surrounding mullion/transom faces and centred in the depth.
  for (let i = 0; i < us.length - 1; i++) {
    const a = us[i] + mw / 2
    const b = us[i + 1] - mw / 2
    if (b - a < 1e-6) continue
    for (let j = 0; j < vs.length - 1; j++) {
      const c = vs[j] + mw / 2
      const d = vs[j + 1] - mw / 2
      if (d - c < 1e-6) continue
      const p = lerp2(at(a), at(b), 0.5)
      panels.push({
        center: [p[0], baseElevation + (c + d) / 2, p[1]],
        size: [b - a, d - c, type.panelThickness],
        rotationY,
      })
    }
  }

  return { frame, panels }
}

/** Advisory messages, in the same "report, don't refuse" register the rest of the app uses. */
export function validateCurtainWall(scene: SceneGraph, cw: CurtainWall): string[] {
  const out: string[] = []
  const type = findCurtainWallType(scene, cw.typeId)
  if (!type) {
    out.push('This curtain wall has no valid type.')
    return out
  }
  if (cw.baseline.kind !== 'line') {
    out.push(
      'Curved curtain walls are not supported: a curved system is a faceted one, and its facets must line up with the bay grid.',
    )
    return out
  }

  const resolved = resolveCurtainWall(scene, cw)
  if (!resolved) {
    out.push('This curtain wall could not be resolved — check its type and level.')
    return out
  }
  if (resolved.length < type.mullionWidth * 2) {
    out.push('This curtain wall is shorter than two mullions — there is no room for a panel.')
  }
  if (resolved.height < type.mullionWidth * 2) {
    out.push('This curtain wall is shorter than two transoms — there is no room for a panel.')
  }
  if (type.panelThickness > type.mullionDepth) {
    out.push('The panel is thicker than the mullion depth, so the glazing protrudes from the frame.')
  }
  return out
}
