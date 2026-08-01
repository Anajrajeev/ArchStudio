/**
 * Column grid geometry (B6) — named structural axes.
 *
 * A grid is an origin + rotation plus two independent lists of axes (local X and local Y), each
 * storing distance from the PREVIOUS axis rather than an absolute position. That is what makes
 * non-uniform bay spacing a first-class case instead of a special one: "axis 3 is 6.2m from axis
 * 2" is exactly how a structural drawing is dimensioned.
 *
 * Pure module — the renderer and any future analysis code (e.g. snapping columns to
 * intersections) share this, never duplicate the trigonometry.
 */
import type { ColumnGrid, GridAxis, Vec2 } from '../types/scene'

/** Cumulative distance of each axis from the grid origin, along its own direction. */
export function axisPositions(axes: GridAxis[]): number[] {
  let running = 0
  return axes.map((a) => {
    running += a.spacing
    return running
  })
}

function rotate(v: Vec2, degrees: number): Vec2 {
  const rad = (degrees * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]
}

function addV(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]]
}

export interface ResolvedGridLine {
  axisId: string
  label: string
  /** 'x' = a line running along the grid's local Y direction, at a fixed local-X offset (a
   * numbered axis); 'y' = a line running along local X, at a fixed local-Y offset (a lettered
   * axis). Matches the convention that numbered axes usually run vertically in plan. */
  direction: 'x' | 'y'
  start: Vec2
  end: Vec2
  bubbleStart: Vec2
  bubbleEnd: Vec2
}

/**
 * Resolve every grid line to scene-2D world coordinates, including the extension past the
 * perpendicular extent and the bubble centre at each end — the two things the renderer needs
 * and nothing it would have to recompute.
 */
export function gridLines(grid: ColumnGrid): ResolvedGridLine[] {
  const xPositions = axisPositions(grid.xAxes)
  const yPositions = axisPositions(grid.yAxes)
  const maxY = yPositions.length > 0 ? yPositions[yPositions.length - 1] : 0
  const maxX = xPositions.length > 0 ? xPositions[xPositions.length - 1] : 0
  const ext = grid.extension

  const lines: ResolvedGridLine[] = []

  // Numbered axes (local X offset) run the full local-Y span, extended at both ends.
  grid.xAxes.forEach((axis, i) => {
    const x = xPositions[i]
    const localStart: Vec2 = [x, -ext]
    const localEnd: Vec2 = [x, maxY + ext]
    lines.push({
      axisId: axis.id,
      label: axis.label,
      direction: 'x',
      start: addV(grid.origin, rotate(localStart, grid.rotation)),
      end: addV(grid.origin, rotate(localEnd, grid.rotation)),
      bubbleStart: addV(grid.origin, rotate([x, -ext], grid.rotation)),
      bubbleEnd: addV(grid.origin, rotate([x, maxY + ext], grid.rotation)),
    })
  })

  // Lettered axes (local Y offset) run the full local-X span, extended at both ends.
  grid.yAxes.forEach((axis, i) => {
    const y = yPositions[i]
    const localStart: Vec2 = [-ext, y]
    const localEnd: Vec2 = [maxX + ext, y]
    lines.push({
      axisId: axis.id,
      label: axis.label,
      direction: 'y',
      start: addV(grid.origin, rotate(localStart, grid.rotation)),
      end: addV(grid.origin, rotate(localEnd, grid.rotation)),
      bubbleStart: addV(grid.origin, rotate([-ext, y], grid.rotation)),
      bubbleEnd: addV(grid.origin, rotate([maxX + ext, y], grid.rotation)),
    })
  })

  return lines
}

export interface GridIntersection {
  point: Vec2
  xLabel: string
  yLabel: string
}

/** Every intersection of a numbered axis with a lettered axis — the columns' natural home. */
export function gridIntersections(grid: ColumnGrid): GridIntersection[] {
  const xPositions = axisPositions(grid.xAxes)
  const yPositions = axisPositions(grid.yAxes)
  const points: GridIntersection[] = []
  grid.xAxes.forEach((xAxis, i) => {
    grid.yAxes.forEach((yAxis, j) => {
      const local: Vec2 = [xPositions[i], yPositions[j]]
      points.push({
        point: addV(grid.origin, rotate(local, grid.rotation)),
        xLabel: xAxis.label,
        yLabel: yAxis.label,
      })
    })
  })
  return points
}

/** Nearest grid intersection to a point, within `maxDistance`, or null. Used for column snap. */
export function nearestGridIntersection(
  grid: ColumnGrid,
  point: Vec2,
  maxDistance: number,
): GridIntersection | null {
  let best: GridIntersection | null = null
  let bestDist = maxDistance
  for (const gi of gridIntersections(grid)) {
    const d = Math.hypot(gi.point[0] - point[0], gi.point[1] - point[1])
    if (d <= bestDist) {
      bestDist = d
      best = gi
    }
  }
  return best
}

/** Default numbered labels: "1", "2", "3", ... */
export function numericLabels(count: number, startAt = 1): string[] {
  return Array.from({ length: count }, (_, i) => String(startAt + i))
}

/** Default lettered labels: "A", "B", ..., "Z", "AA", "AB", ... */
export function letterLabels(count: number): string[] {
  const labels: string[] = []
  for (let i = 0; i < count; i++) {
    let n = i
    let label = ''
    do {
      label = String.fromCharCode(65 + (n % 26)) + label
      n = Math.floor(n / 26) - 1
    } while (n >= 0)
    labels.push(label)
  }
  return labels
}

/** A sane default grid: 4 numbered axes and 3 lettered axes, 5m bays, centred on `origin`. */
export function defaultColumnGrid(
  id: string,
  levelId: string,
  origin: Vec2,
  bay = 5,
): ColumnGrid {
  const xLabels = numericLabels(4)
  const yLabels = letterLabels(3)
  return {
    id,
    levelId,
    name: 'Grid',
    origin,
    rotation: 0,
    xAxes: xLabels.map((label, i) => ({ id: `${id}-x${i}`, label, spacing: i === 0 ? 0 : bay })),
    yAxes: yLabels.map((label, i) => ({ id: `${id}-y${i}`, label, spacing: i === 0 ? 0 : bay })),
    extension: 0.6,
    bubbleRadius: 0.35,
  }
}
