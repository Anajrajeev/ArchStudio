/**
 * Tests for the parametric dimension geometry engine (C2).
 *
 * All tests operate on plain scene graph objects — no React, no Three.js. The renderer
 * is a dumb consumer of `resolveDimension`; testing the geometry here covers both.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveRef,
  resolveDimension,
  resolveAllDimensions,
} from '../../../shared/geometry/dimensions'
import { emptySceneGraph, type Dimension, type DimensionRef } from '../../../shared/types/scene'
import { addLevel, addWall, addSlab } from '../scene/mutations'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scene() {
  const base = emptySceneGraph('p')
  const s1 = addLevel(base, 'Ground floor')
  const levelId = s1.levels[0].id

  // A horizontal wall from (0,0) to (5,0)
  const r1 = addWall(s1, {
    typeId: 'wt-ext-200',
    levelId,
    baseline: { kind: 'line', start: [0, 0], end: [5, 0] },
  })
  const wallId = r1.id

  // A vertical wall from (5,0) to (5,4)
  const r2 = addWall(r1.scene, {
    typeId: 'wt-ext-200',
    levelId,
    baseline: { kind: 'line', start: [5, 0], end: [5, 4] },
  })
  const wallVId = r2.id

  // A slab with a simple rectangle
  const r3 = addSlab(
    r2.scene,
    levelId,
    'st-floor-200',
    [[0, 0], [5, 0], [5, 4], [0, 4]] as [number, number][],
  )
  const slabId = r3.id

  return { scene: r3.scene, levelId, wallId, wallVId, slabId }
}

function makeDim(
  id: string,
  kind: Dimension['kind'],
  ref1: DimensionRef,
  ref2: DimensionRef,
  overrides: Partial<Omit<Dimension, 'id' | 'kind' | 'ref1' | 'ref2'>> = {},
): Dimension {
  return {
    id,
    viewId: 'v1',
    kind,
    ref1,
    ref2,
    textOverride: null,
    witnessGap: 0.05,
    offsetDistance: 0.5,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// resolveRef
// ---------------------------------------------------------------------------

describe('resolveRef', () => {
  const { scene: sc, wallId, slabId } = scene()

  it('resolves wall start (index 0)', () => {
    const p = resolveRef(sc, { elementId: wallId, pointIndex: 0 })
    expect(p).toEqual([0, 0])
  })

  it('resolves wall end (index 1)', () => {
    const p = resolveRef(sc, { elementId: wallId, pointIndex: 1 })
    expect(p).toEqual([5, 0])
  })

  it('resolves slab boundary vertex by index', () => {
    const p = resolveRef(sc, { elementId: slabId, pointIndex: 2 })
    expect(p).toEqual([5, 4])
  })

  it('returns null for a deleted element', () => {
    const p = resolveRef(sc, { elementId: 'no-such-id', pointIndex: 0 })
    expect(p).toBeNull()
  })

  it('returns null for an out-of-range point index', () => {
    const p = resolveRef(sc, { elementId: wallId, pointIndex: 99 })
    expect(p).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// resolveDimension — aligned
// ---------------------------------------------------------------------------

describe('resolveDimension — aligned', () => {
  const { scene: sc, wallId } = scene()
  const dim = makeDim('d1', 'aligned', { elementId: wallId, pointIndex: 0 }, { elementId: wallId, pointIndex: 1 })
  const r = resolveDimension(sc, dim)!

  it('returns a result', () => {
    expect(r).not.toBeNull()
  })

  it('measures the correct length', () => {
    expect(r.value).toBeCloseTo(5)
  })

  it('formats the text', () => {
    expect(r.text).toMatch(/5\.000 m/)
  })

  it('textAnchor lies at the midpoint of the dimension line', () => {
    expect(r.textAnchor[0]).toBeCloseTo((r.dimStart[0] + r.dimEnd[0]) / 2)
    expect(r.textAnchor[1]).toBeCloseTo((r.dimStart[1] + r.dimEnd[1]) / 2)
  })

  it('witness lines start on the geometry (at the gap)', () => {
    // w1Start should be near p1 along the normal
    const gapDist = Math.hypot(r.w1Start[0] - r.p1[0], r.w1Start[1] - r.p1[1])
    expect(gapDist).toBeCloseTo(dim.witnessGap)
  })

  it('respects textOverride', () => {
    const d2 = { ...dim, textOverride: 'custom' }
    expect(resolveDimension(sc, d2)!.text).toBe('custom')
  })
})

// ---------------------------------------------------------------------------
// resolveDimension — linear horizontal / vertical
// ---------------------------------------------------------------------------

describe('resolveDimension — linear horizontal', () => {
  const { scene: sc, wallId } = scene()
  const dim = makeDim('d2', 'linear-horizontal', { elementId: wallId, pointIndex: 0 }, { elementId: wallId, pointIndex: 1 })
  const r = resolveDimension(sc, dim)!

  it('measures the horizontal span', () => {
    expect(r.value).toBeCloseTo(5)
  })

  it('dimension line is horizontal (same Y)', () => {
    expect(r.dimStart[1]).toBeCloseTo(r.dimEnd[1])
  })
})

describe('resolveDimension — linear vertical', () => {
  const { scene: sc, wallVId } = scene()
  const dim = makeDim('d3', 'linear-vertical', { elementId: wallVId, pointIndex: 0 }, { elementId: wallVId, pointIndex: 1 })
  const r = resolveDimension(sc, dim)!

  it('measures the vertical span', () => {
    // wallV goes from (5,0) to (5,4) — vertical distance = 4
    expect(r.value).toBeCloseTo(4)
  })

  it('dimension line is vertical (same X)', () => {
    expect(r.dimStart[0]).toBeCloseTo(r.dimEnd[0])
  })
})

// ---------------------------------------------------------------------------
// resolveDimension — angular
// ---------------------------------------------------------------------------

describe('resolveDimension — angular', () => {
  const { scene: sc, wallVId } = scene()
  // wallV runs from (5,0) to (5,4) — 90° from horizontal
  const dim = makeDim('d4', 'angular', { elementId: wallVId, pointIndex: 0 }, { elementId: wallVId, pointIndex: 1 })
  const r = resolveDimension(sc, dim)!

  it('measures the angle', () => {
    expect(r.value).toBeCloseTo(90)
  })

  it('formats in degrees', () => {
    expect(r.text).toMatch(/90\.0°/)
  })
})

// ---------------------------------------------------------------------------
// resolveDimension — radial / diameter
// ---------------------------------------------------------------------------

describe('resolveDimension — radial', () => {
  const { scene: sc, wallId } = scene()
  // centre at (0,0), point at (3,0) → radius 3
  const dim = makeDim('d5', 'radial', { elementId: wallId, pointIndex: 0 }, { elementId: wallId, pointIndex: 0 }, {})

  it('does not crash on coincident points', () => {
    const r = resolveDimension(sc, dim)
    expect(r).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// resolveAllDimensions — batch
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// A4 — dimensions persist: they live in the scene graph, so undo/redo and a
// JSON round-trip (what Phase 2's save/load will do) carry them automatically.
// ---------------------------------------------------------------------------

describe('dimension persistence (A4)', () => {
  it('survives a JSON serialise/deserialise round-trip untouched', () => {
    const { scene: sc, wallId } = scene()
    const dim = makeDim('d1', 'aligned', { elementId: wallId, pointIndex: 0 }, { elementId: wallId, pointIndex: 1 })
    const withDim = { ...sc, dimensions: [dim] }
    const roundTripped = JSON.parse(JSON.stringify(withDim)) as typeof withDim
    expect(roundTripped.dimensions).toEqual([dim])
    expect(resolveDimension(roundTripped, roundTripped.dimensions[0])).not.toBeNull()
  })
})

describe('resolveAllDimensions', () => {
  const { scene: sc, wallId } = scene()

  it('returns empty for a scene with no dimensions', () => {
    expect(resolveAllDimensions(sc)).toEqual([])
  })

  it('resolves all valid dimensions', () => {
    const dim1 = makeDim('d1', 'aligned', { elementId: wallId, pointIndex: 0 }, { elementId: wallId, pointIndex: 1 })
    const dim2 = makeDim('d2', 'aligned', { elementId: wallId, pointIndex: 0 }, { elementId: wallId, pointIndex: 1 })
    const scWithDims = { ...sc, dimensions: [dim1, dim2] }
    expect(resolveAllDimensions(scWithDims)).toHaveLength(2)
  })

  it('silently drops broken references', () => {
    const broken = makeDim('d-broken', 'aligned', { elementId: 'no-such', pointIndex: 0 }, { elementId: wallId, pointIndex: 1 })
    const good = makeDim('d-good', 'aligned', { elementId: wallId, pointIndex: 0 }, { elementId: wallId, pointIndex: 1 })
    const scWithDims = { ...sc, dimensions: [broken, good] }
    const result = resolveAllDimensions(scWithDims)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('d-good')
  })
})
