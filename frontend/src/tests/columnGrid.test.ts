/**
 * Column grid geometry tests (B6) — pure geometry, no React.
 */
import { describe, it, expect } from 'vitest'
import {
  axisPositions,
  gridLines,
  gridIntersections,
  nearestGridIntersection,
  numericLabels,
  letterLabels,
  defaultColumnGrid,
} from '../../../shared/geometry/columnGrid'
import type { ColumnGrid, GridAxis } from '../../../shared/types/scene'

function axes(spacings: number[]): GridAxis[] {
  return spacings.map((spacing, i) => ({ id: `a${i}`, label: String(i + 1), spacing }))
}

// ---------------------------------------------------------------------------
// axisPositions
// ---------------------------------------------------------------------------

describe('axisPositions', () => {
  it('the first axis sits at 0 regardless of its stored spacing', () => {
    const pos = axisPositions(axes([0, 5, 5]))
    expect(pos[0]).toBe(0)
  })

  it('accumulates spacing across axes', () => {
    const pos = axisPositions(axes([0, 5, 3, 4]))
    expect(pos).toEqual([0, 5, 8, 12])
  })

  it('handles non-uniform bays', () => {
    const pos = axisPositions(axes([0, 6.2, 4.8]))
    expect(pos[1]).toBeCloseTo(6.2)
    expect(pos[2]).toBeCloseTo(11)
  })

  it('returns an empty array for no axes', () => {
    expect(axisPositions([])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// numericLabels / letterLabels
// ---------------------------------------------------------------------------

describe('numericLabels', () => {
  it('produces sequential numbers starting at 1 by default', () => {
    expect(numericLabels(4)).toEqual(['1', '2', '3', '4'])
  })

  it('accepts a custom start', () => {
    expect(numericLabels(3, 5)).toEqual(['5', '6', '7'])
  })
})

describe('letterLabels', () => {
  it('produces A, B, C for a small count', () => {
    expect(letterLabels(3)).toEqual(['A', 'B', 'C'])
  })

  it('wraps past Z into AA, AB, ...', () => {
    const labels = letterLabels(28)
    expect(labels[25]).toBe('Z')
    expect(labels[26]).toBe('AA')
    expect(labels[27]).toBe('AB')
  })
})

// ---------------------------------------------------------------------------
// defaultColumnGrid
// ---------------------------------------------------------------------------

describe('defaultColumnGrid', () => {
  it('creates 4 numbered and 3 lettered axes at the given bay spacing', () => {
    const grid = defaultColumnGrid('g1', 'lv1', [0, 0], 5)
    expect(grid.xAxes).toHaveLength(4)
    expect(grid.yAxes).toHaveLength(3)
    expect(grid.xAxes.map((a) => a.label)).toEqual(['1', '2', '3', '4'])
    expect(grid.yAxes.map((a) => a.label)).toEqual(['A', 'B', 'C'])
    expect(grid.xAxes[1].spacing).toBe(5)
  })

  it('origin and level id are preserved', () => {
    const grid = defaultColumnGrid('g1', 'lv1', [3, 4])
    expect(grid.origin).toEqual([3, 4])
    expect(grid.levelId).toBe('lv1')
  })
})

// ---------------------------------------------------------------------------
// gridLines
// ---------------------------------------------------------------------------

describe('gridLines', () => {
  const grid: ColumnGrid = {
    id: 'g1',
    levelId: 'lv1',
    name: 'Grid',
    origin: [0, 0],
    rotation: 0,
    xAxes: axes([0, 5, 5]),
    yAxes: axes([0, 4, 4]),
    extension: 1,
    bubbleRadius: 0.3,
  }

  it('produces one line per axis in both directions', () => {
    const lines = gridLines(grid)
    expect(lines).toHaveLength(6) // 3 x-axes + 3 y-axes
  })

  it('a numbered axis line runs the full Y span plus extension at both ends', () => {
    const lines = gridLines(grid)
    const axis1 = lines.find((l) => l.direction === 'x' && l.label === '1')!
    // maxY = 8 (0, 4, 8), extension = 1
    expect(axis1.start[1]).toBeCloseTo(-1)
    expect(axis1.end[1]).toBeCloseTo(9)
    // Axis "1" sits at local x=0
    expect(axis1.start[0]).toBeCloseTo(0)
  })

  it('a lettered axis line runs the full X span plus extension at both ends', () => {
    const lines = gridLines(grid)
    const axisA = lines.find((l) => l.direction === 'y' && l.label === '1')!
    // maxX = 10 (0, 5, 10), extension = 1
    expect(axisA.start[0]).toBeCloseTo(-1)
    expect(axisA.end[0]).toBeCloseTo(11)
  })

  it('respects a non-zero origin', () => {
    const offsetGrid = { ...grid, origin: [10, 20] as [number, number] }
    const lines = gridLines(offsetGrid)
    const axis1 = lines.find((l) => l.direction === 'x' && l.label === '1')!
    expect(axis1.start[0]).toBeCloseTo(10)
    expect(axis1.start[1]).toBeCloseTo(19) // 20 + (-1)
  })

  it('rotates the whole grid when rotation is non-zero', () => {
    const rotated = { ...grid, rotation: 90 }
    const lines = gridLines(rotated)
    const axis1 = lines.find((l) => l.direction === 'x' && l.label === '1')!
    // A 90° rotation should swap roughly x/y magnitude behaviour — the line should no longer
    // be axis-aligned the same way as the unrotated case.
    const unrotated = gridLines(grid).find((l) => l.direction === 'x' && l.label === '1')!
    expect(axis1.start).not.toEqual(unrotated.start)
  })
})

// ---------------------------------------------------------------------------
// gridIntersections / nearestGridIntersection
// ---------------------------------------------------------------------------

describe('gridIntersections', () => {
  const grid: ColumnGrid = {
    id: 'g1',
    levelId: 'lv1',
    name: 'Grid',
    origin: [0, 0],
    rotation: 0,
    xAxes: axes([0, 5]),
    yAxes: axes([0, 4]),
    extension: 1,
    bubbleRadius: 0.3,
  }

  it('produces one intersection per (x-axis, y-axis) pair', () => {
    const points = gridIntersections(grid)
    expect(points).toHaveLength(4) // 2 x 2
  })

  it('labels each intersection with both axis labels', () => {
    const points = gridIntersections(grid)
    const p = points.find((p) => p.xLabel === '2' && p.yLabel === '2')!
    expect(p.point[0]).toBeCloseTo(5)
    expect(p.point[1]).toBeCloseTo(4)
  })
})

describe('nearestGridIntersection', () => {
  const grid: ColumnGrid = {
    id: 'g1',
    levelId: 'lv1',
    name: 'Grid',
    origin: [0, 0],
    rotation: 0,
    xAxes: axes([0, 5]),
    yAxes: axes([0, 4]),
    extension: 1,
    bubbleRadius: 0.3,
  }

  it('finds the closest intersection within range', () => {
    const hit = nearestGridIntersection(grid, [4.9, 4.1], 1)
    expect(hit).not.toBeNull()
    expect(hit!.xLabel).toBe('2')
    expect(hit!.yLabel).toBe('2')
  })

  it('returns null when nothing is within range', () => {
    const hit = nearestGridIntersection(grid, [2.5, 2], 0.5)
    expect(hit).toBeNull()
  })
})
