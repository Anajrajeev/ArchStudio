/**
 * Primitive solid geometry (B7).
 *
 * The load-bearing assertion in this file is that the *tessellation* agrees with the *analytic*
 * volume. `primitiveVolume` is closed-form (πr²h and friends) while `meshVolume` sums the actual
 * triangles via the divergence theorem, so the two are computed by completely independent code —
 * a tessellation bug cannot hide by being wrong in both places.
 *
 * `isWatertight` is asserted for every shape because `three-bvh-csg` requires closed manifold
 * operands (DECISIONS.md D-019): a missing cap renders fine but silently corrupts every boolean
 * built on it, which is exactly the class of bug unit tests should catch and eyeballing cannot.
 */
import { describe, it, expect } from 'vitest'
import {
  primitiveMesh,
  primitiveVolume,
  primitiveBounds,
  validatePrimitiveShape,
  meshVolume,
  meshBounds,
  isWatertight,
  isPrimitiveError,
  type TriMesh,
} from '../../../shared/geometry/primitives'
import { PRIMITIVE_KINDS, type PrimitiveShape } from '../../../shared/types/scene'

/** A valid instance of every shape kind, for the exhaustive sweeps below. */
const SHAPES: Record<string, PrimitiveShape> = {
  box: { kind: 'box', width: 2, depth: 3, height: 4 },
  cylinder: { kind: 'cylinder', radius: 1.5, height: 4, segments: 64 },
  cone: { kind: 'cone', radius: 1.5, height: 4, segments: 64 },
  sphere: { kind: 'sphere', radius: 1.5, segments: 64 },
  prism: { kind: 'prism', radius: 1.5, height: 4, sides: 6 },
  wedge: { kind: 'wedge', width: 2, depth: 3, height: 4 },
  torus: { kind: 'torus', radius: 2, tubeRadius: 0.5, radialSegments: 48, tubularSegments: 64 },
}

function mesh(shape: PrimitiveShape): TriMesh {
  const m = primitiveMesh(shape)
  if (isPrimitiveError(m)) throw new Error(`expected a mesh, got: ${m.error}`)
  return m
}

describe('primitive tessellation', () => {
  it('covers every shape kind declared in the schema', () => {
    // Guards against a new PrimitiveShape variant being added without a mesh builder to match.
    expect(Object.keys(SHAPES).sort()).toEqual([...PRIMITIVE_KINDS].sort())
  })

  it.each([...PRIMITIVE_KINDS])('%s builds a mesh with triangles', (kind) => {
    const m = mesh(SHAPES[kind])
    expect(m.positions.length).toBeGreaterThan(0)
    expect(m.indices.length % 3).toBe(0)
    expect(m.indices.length).toBeGreaterThan(0)
  })

  it.each([...PRIMITIVE_KINDS])('%s is a closed watertight manifold', (kind) => {
    expect(isWatertight(mesh(SHAPES[kind]))).toBe(true)
  })

  it.each([...PRIMITIVE_KINDS])('%s has outward-facing winding (positive volume)', (kind) => {
    expect(meshVolume(mesh(SHAPES[kind]))).toBeGreaterThan(0)
  })

  it.each([...PRIMITIVE_KINDS])('%s indices are all in range', (kind) => {
    const m = mesh(SHAPES[kind])
    const vertexCount = m.positions.length / 3
    for (const i of m.indices) {
      expect(Number.isInteger(i)).toBe(true)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(vertexCount)
    }
  })
})

describe('analytic volume', () => {
  // Exact, independent of tessellation.
  it('box is w·d·h', () => {
    expect(primitiveVolume(SHAPES.box)).toBeCloseTo(24, 10)
  })
  it('cylinder is πr²h', () => {
    expect(primitiveVolume(SHAPES.cylinder)).toBeCloseTo(Math.PI * 1.5 ** 2 * 4, 10)
  })
  it('cone is a third of the cylinder', () => {
    expect(primitiveVolume(SHAPES.cone)).toBeCloseTo(primitiveVolume(SHAPES.cylinder) / 3, 10)
  })
  it('sphere is 4/3·πr³', () => {
    expect(primitiveVolume(SHAPES.sphere)).toBeCloseTo((4 / 3) * Math.PI * 1.5 ** 3, 10)
  })
  it('wedge is half its enclosing box', () => {
    expect(primitiveVolume(SHAPES.wedge)).toBeCloseTo(12, 10)
  })
  it('hexagonal prism matches the regular-polygon area formula', () => {
    const area = (6 / 2) * 1.5 ** 2 * Math.sin((2 * Math.PI) / 6)
    expect(primitiveVolume(SHAPES.prism)).toBeCloseTo(area * 4, 10)
  })
  it('torus matches Pappus 2π²Rr²', () => {
    expect(primitiveVolume(SHAPES.torus)).toBeCloseTo(2 * Math.PI ** 2 * 2 * 0.5 ** 2, 10)
  })
})

describe('tessellation agrees with the analytic volume', () => {
  // A flat-faced shape must match EXACTLY — there is no approximation to forgive.
  it.each(['box', 'wedge', 'prism'])('%s matches exactly', (kind) => {
    expect(meshVolume(mesh(SHAPES[kind]))).toBeCloseTo(primitiveVolume(SHAPES[kind]), 9)
  })

  // A curved shape is inscribed in the ideal solid, so the mesh is always slightly SMALLER.
  // Asserting the sign of the error (not just its magnitude) catches a builder that oversamples
  // the radius to make the number look right.
  it.each(['cylinder', 'cone', 'sphere', 'torus'])('%s is inscribed and within 1%%', (kind) => {
    const exact = primitiveVolume(SHAPES[kind])
    const actual = meshVolume(mesh(SHAPES[kind]))
    expect(actual).toBeLessThan(exact)
    expect(actual).toBeGreaterThan(exact * 0.99)
  })

  it('converges towards the analytic volume as segments increase', () => {
    const error = (segments: number): number => {
      const shape: PrimitiveShape = { kind: 'cylinder', radius: 1, height: 1, segments }
      return Math.abs(primitiveVolume(shape) - meshVolume(mesh(shape)))
    }
    expect(error(8)).toBeGreaterThan(error(32))
    expect(error(32)).toBeGreaterThan(error(128))
  })
})

describe('bounds', () => {
  it.each([...PRIMITIVE_KINDS])('%s tessellation fits its analytic bounds', (kind) => {
    const analytic = primitiveBounds(SHAPES[kind])
    const actual = meshBounds(mesh(SHAPES[kind]))
    for (let axis = 0; axis < 3; axis++) {
      expect(actual.min[axis]).toBeGreaterThanOrEqual(analytic.min[axis] - 1e-9)
      expect(actual.max[axis]).toBeLessThanOrEqual(analytic.max[axis] + 1e-9)
    }
  })

  it.each([...PRIMITIVE_KINDS])('%s sits ON the work plane, base at y = 0', (kind) => {
    // Every primitive is placed by clicking a point on the work plane, so a shape whose base was
    // centred on the origin would appear half-buried in the floor.
    expect(meshBounds(mesh(SHAPES[kind])).min[1]).toBeCloseTo(0, 9)
  })

  it('sphere spans one diameter vertically', () => {
    const b = meshBounds(mesh(SHAPES.sphere))
    expect(b.max[1] - b.min[1]).toBeCloseTo(3, 6)
  })
})

describe('validation refuses rather than degrading', () => {
  it('accepts every valid shape', () => {
    for (const kind of PRIMITIVE_KINDS) {
      expect(validatePrimitiveShape(SHAPES[kind])).toEqual([])
    }
  })

  it('rejects a zero or negative dimension', () => {
    expect(validatePrimitiveShape({ kind: 'box', width: 0, depth: 1, height: 1 })).toHaveLength(1)
    expect(validatePrimitiveShape({ kind: 'box', width: 1, depth: -2, height: 1 })).toHaveLength(1)
    expect(
      validatePrimitiveShape({ kind: 'cylinder', radius: 1, height: 0, segments: 16 }),
    ).toHaveLength(1)
  })

  it('rejects a non-finite dimension', () => {
    expect(
      validatePrimitiveShape({ kind: 'box', width: NaN, depth: 1, height: 1 }).length,
    ).toBeGreaterThan(0)
    expect(
      validatePrimitiveShape({ kind: 'box', width: Infinity, depth: 1, height: 1 }).length,
    ).toBeGreaterThan(0)
  })

  it('rejects a degenerate segment count', () => {
    expect(
      validatePrimitiveShape({ kind: 'cylinder', radius: 1, height: 1, segments: 2 }),
    ).toHaveLength(1)
    expect(
      validatePrimitiveShape({ kind: 'cylinder', radius: 1, height: 1, segments: 8.5 }),
    ).toHaveLength(1)
    expect(validatePrimitiveShape({ kind: 'prism', radius: 1, height: 1, sides: 2 })).toHaveLength(1)
  })

  it('rejects a self-intersecting torus whose tube is fatter than its ring', () => {
    const errors = validatePrimitiveShape({
      kind: 'torus',
      radius: 1,
      tubeRadius: 1.5,
      radialSegments: 16,
      tubularSegments: 24,
    })
    expect(errors.join(' ')).toMatch(/self-intersect/i)
  })

  it('reports every problem at once, not just the first', () => {
    expect(
      validatePrimitiveShape({ kind: 'box', width: 0, depth: 0, height: 0 }),
    ).toHaveLength(3)
  })

  it('primitiveMesh returns an error rather than a degenerate mesh', () => {
    const result = primitiveMesh({ kind: 'box', width: 0, depth: 1, height: 1 })
    expect(isPrimitiveError(result)).toBe(true)
  })
})

describe('watertightness detects real breakage', () => {
  // Confidence check on the checker itself — a test that only ever returns true proves nothing.
  it('a mesh with a removed face is not watertight', () => {
    const m = mesh(SHAPES.box)
    const broken: TriMesh = { positions: m.positions, indices: m.indices.slice(0, -3) }
    expect(isWatertight(broken)).toBe(false)
  })

  it('a mesh with a degenerate triangle is not watertight', () => {
    const m = mesh(SHAPES.box)
    const broken: TriMesh = { positions: m.positions, indices: [...m.indices, 0, 0, 1] }
    expect(isWatertight(broken)).toBe(false)
  })
})
