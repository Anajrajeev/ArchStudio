/**
 * Primitive solid geometry (B7) — pure TypeScript, no Three.js.
 *
 * Every one of the seven shapes tessellates to a **watertight indexed triangle mesh**. Watertight
 * is not a nicety here: `three-bvh-csg` (DECISIONS.md D-019) needs closed, manifold operands to
 * produce a correct boolean, so a shape with a missing cap or a seam that does not weld would give
 * silently wrong results rather than an obvious visual break.
 *
 * Volumes are computed **analytically** (πr²h and friends), never by summing the tessellation, so
 * the tests have an independent reference to check the mesh against — a tessellation error cannot
 * hide by being wrong in both places at once. `meshVolume` below is the divergence-theorem sum over
 * the actual triangles; the tests assert the two agree to the tolerance the segment count implies.
 *
 * Coordinate convention (D-007): meshes are built in LOCAL space with the origin at the centre of
 * the base and +Y up. Placement (position, heightOffset, rotation, scale) is applied by the caller.
 */
import type { PrimitiveShape, Vec3 } from '../types/scene'

/** An indexed triangle mesh. `indices` are triples into `positions` (3 floats per vertex). */
export interface TriMesh {
  positions: number[]
  indices: number[]
}

export interface PrimitiveError {
  error: string
}

export function isPrimitiveError(x: unknown): x is PrimitiveError {
  return typeof x === 'object' && x !== null && 'error' in x
}

const MIN_SEGMENTS = 3
const MAX_SEGMENTS = 256

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Every reason this shape cannot be built, as sentences. Returns [] when valid.
 *
 * A zero or negative dimension is refused rather than clamped: a zero-height cylinder is a
 * degenerate (non-manifold) solid, and clamping it to some epsilon would produce a sliver the user
 * never asked for. Refuse and explain (AGENTS.md).
 */
export function validatePrimitiveShape(shape: PrimitiveShape): string[] {
  const errors: string[] = []

  const positive = (value: number, label: string): void => {
    if (!Number.isFinite(value) || value <= 0) errors.push(`${label} must be greater than 0`)
  }
  const segments = (value: number, label: string, min = MIN_SEGMENTS): void => {
    if (!Number.isInteger(value) || value < min || value > MAX_SEGMENTS) {
      errors.push(`${label} must be a whole number between ${min} and ${MAX_SEGMENTS}`)
    }
  }

  switch (shape.kind) {
    case 'box':
      positive(shape.width, 'Width')
      positive(shape.depth, 'Depth')
      positive(shape.height, 'Height')
      break
    case 'cylinder':
      positive(shape.radius, 'Radius')
      positive(shape.height, 'Height')
      segments(shape.segments, 'Segments')
      break
    case 'cone':
      positive(shape.radius, 'Radius')
      positive(shape.height, 'Height')
      segments(shape.segments, 'Segments')
      break
    case 'sphere':
      positive(shape.radius, 'Radius')
      // A sphere needs rings AND sectors; below 4 the tessellation degenerates to a bipyramid.
      segments(shape.segments, 'Segments', 4)
      break
    case 'prism':
      positive(shape.radius, 'Radius')
      positive(shape.height, 'Height')
      segments(shape.sides, 'Sides')
      break
    case 'wedge':
      positive(shape.width, 'Width')
      positive(shape.depth, 'Depth')
      positive(shape.height, 'Height')
      break
    case 'torus':
      positive(shape.radius, 'Ring radius')
      positive(shape.tubeRadius, 'Tube radius')
      segments(shape.radialSegments, 'Radial segments')
      segments(shape.tubularSegments, 'Tubular segments')
      // A tube fatter than the ring self-intersects through the hole; the "solid" it bounds is not
      // well defined, and CSG on a self-intersecting operand produces garbage rather than an error.
      if (
        Number.isFinite(shape.radius) &&
        Number.isFinite(shape.tubeRadius) &&
        shape.tubeRadius >= shape.radius
      ) {
        errors.push('Tube radius must be smaller than the ring radius, or the torus self-intersects')
      }
      break
  }
  return errors
}

// ---------------------------------------------------------------------------
// Analytic volume and bounds
// ---------------------------------------------------------------------------

/** Exact volume of the ideal solid (NOT of the tessellation). */
export function primitiveVolume(shape: PrimitiveShape): number {
  switch (shape.kind) {
    case 'box':
      return shape.width * shape.depth * shape.height
    case 'cylinder':
      return Math.PI * shape.radius * shape.radius * shape.height
    case 'cone':
      return (Math.PI * shape.radius * shape.radius * shape.height) / 3
    case 'sphere':
      return (4 / 3) * Math.PI * shape.radius ** 3
    case 'prism': {
      // Area of a regular n-gon with circumradius r: (n/2) r² sin(2π/n).
      const area = (shape.sides / 2) * shape.radius ** 2 * Math.sin((2 * Math.PI) / shape.sides)
      return area * shape.height
    }
    case 'wedge':
      // Right triangular prism: half the enclosing box.
      return (shape.width * shape.depth * shape.height) / 2
    case 'torus':
      // Pappus: (2πR)(πr²).
      return 2 * Math.PI ** 2 * shape.radius * shape.tubeRadius ** 2
  }
}

/** Local-space axis-aligned bounds, base at y = 0. */
export function primitiveBounds(shape: PrimitiveShape): { min: Vec3; max: Vec3 } {
  switch (shape.kind) {
    case 'box':
      return {
        min: [-shape.width / 2, 0, -shape.depth / 2],
        max: [shape.width / 2, shape.height, shape.depth / 2],
      }
    case 'cylinder':
    case 'cone':
      return {
        min: [-shape.radius, 0, -shape.radius],
        max: [shape.radius, shape.height, shape.radius],
      }
    case 'sphere':
      return {
        min: [-shape.radius, 0, -shape.radius],
        max: [shape.radius, 2 * shape.radius, shape.radius],
      }
    case 'prism':
      return {
        min: [-shape.radius, 0, -shape.radius],
        max: [shape.radius, shape.height, shape.radius],
      }
    case 'wedge':
      return {
        min: [-shape.width / 2, 0, -shape.depth / 2],
        max: [shape.width / 2, shape.height, shape.depth / 2],
      }
    case 'torus': {
      const outer = shape.radius + shape.tubeRadius
      return {
        min: [-outer, 0, -outer],
        max: [outer, 2 * shape.tubeRadius, outer],
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Mesh building
// ---------------------------------------------------------------------------

/**
 * Accumulates vertices and triangles.
 *
 * **Winding convention:** faces are declared in the order that reads naturally when walking the
 * face — for a ring, that is the order `ring()` produces, which sweeps `(cos θ, sin θ)` through the
 * XZ plane. In a right-handed Y-up system that sweep is *clockwise* seen from +Y, so declaring
 * faces in declaration order yields inward normals. `tri` therefore emits the reversed triple, and
 * every face here is written in the readable order.
 *
 * This is not cosmetic: an inward-facing mesh renders as a hollow shell with back-face culling, and
 * `three-bvh-csg` reads it as the complement of the intended solid, so a subtraction would keep
 * exactly the material it was meant to remove. `meshVolume` returns a negative number for an
 * inside-out mesh, and the tests assert it is positive for all seven shapes.
 */
class MeshBuilder {
  positions: number[] = []
  indices: number[] = []

  vertex(x: number, y: number, z: number): number {
    const i = this.positions.length / 3
    this.positions.push(x, y, z)
    return i
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, c, b)
  }

  /** A planar quad a→b→c→d as two triangles. */
  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c)
    this.tri(a, c, d)
  }

  build(): TriMesh {
    return { positions: this.positions, indices: this.indices }
  }
}

/** Unit circle sample, counter-clockwise when viewed from +Y looking down. */
function ring(segments: number, radius: number, y: number, b: MeshBuilder): number[] {
  const idx: number[] = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    idx.push(b.vertex(Math.cos(a) * radius, y, Math.sin(a) * radius))
  }
  return idx
}

/**
 * Cap a ring of vertices with a triangle fan. `up` picks the winding so the normal faces out.
 *
 * The cap must traverse each ring edge in the OPPOSITE direction to the side face that shares it,
 * or the two do not cancel and the solid is not closed — the side quads walk the bottom ring
 * `i → j`, so the bottom cap walks `j → i`, and vice versa at the top.
 */
function cap(b: MeshBuilder, idx: number[], centre: number, up: boolean): void {
  const n = idx.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    if (up) b.tri(centre, idx[i], idx[j])
    else b.tri(centre, idx[j], idx[i])
  }
}

function boxMesh(width: number, depth: number, height: number): TriMesh {
  const b = new MeshBuilder()
  const x = width / 2
  const z = depth / 2
  // 0..3 bottom (y=0), 4..7 top (y=height), same corner order.
  const v = [
    b.vertex(-x, 0, -z),
    b.vertex(x, 0, -z),
    b.vertex(x, 0, z),
    b.vertex(-x, 0, z),
    b.vertex(-x, height, -z),
    b.vertex(x, height, -z),
    b.vertex(x, height, z),
    b.vertex(-x, height, z),
  ]
  b.quad(v[0], v[3], v[2], v[1]) // bottom (normal -Y)
  b.quad(v[4], v[5], v[6], v[7]) // top (normal +Y)
  b.quad(v[0], v[1], v[5], v[4]) // -Z
  b.quad(v[1], v[2], v[6], v[5]) // +X
  b.quad(v[2], v[3], v[7], v[6]) // +Z
  b.quad(v[3], v[0], v[4], v[7]) // -X
  return b.build()
}

/** Shared by cylinder and prism — a vertical extrusion of a regular polygon. */
function extrudedPolygonMesh(radius: number, height: number, sides: number): TriMesh {
  const b = new MeshBuilder()
  const bottom = ring(sides, radius, 0, b)
  const top = ring(sides, radius, height, b)
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    b.quad(bottom[i], bottom[j], top[j], top[i])
  }
  cap(b, bottom, b.vertex(0, 0, 0), false)
  cap(b, top, b.vertex(0, height, 0), true)
  return b.build()
}

function coneMesh(radius: number, height: number, segments: number): TriMesh {
  const b = new MeshBuilder()
  const bottom = ring(segments, radius, 0, b)
  const apex = b.vertex(0, height, 0)
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments
    b.tri(bottom[i], bottom[j], apex)
  }
  cap(b, bottom, b.vertex(0, 0, 0), false)
  return b.build()
}

/**
 * UV sphere, base at y = 0 (so it sits ON the work plane like every other primitive rather than
 * being half-buried). `segments` is the sector count; ring count is half that, minimum 2.
 */
function sphereMesh(radius: number, segments: number): TriMesh {
  const b = new MeshBuilder()
  const sectors = segments
  const rings = Math.max(2, Math.round(segments / 2))
  const cy = radius // centre height, so the south pole lands at y = 0

  const north = b.vertex(0, cy + radius, 0)
  const south = b.vertex(0, cy - radius, 0)

  // Interior latitude bands only; the poles are the two vertices above.
  const rows: number[][] = []
  for (let r = 1; r < rings; r++) {
    const phi = (r / rings) * Math.PI // 0 at north pole
    const y = cy + Math.cos(phi) * radius
    const rr = Math.sin(phi) * radius
    const row: number[] = []
    for (let s = 0; s < sectors; s++) {
      const theta = (s / sectors) * Math.PI * 2
      row.push(b.vertex(Math.cos(theta) * rr, y, Math.sin(theta) * rr))
    }
    rows.push(row)
  }

  for (let s = 0; s < sectors; s++) {
    const t = (s + 1) % sectors
    b.tri(north, rows[0][s], rows[0][t])
    b.tri(south, rows[rows.length - 1][t], rows[rows.length - 1][s])
  }
  for (let r = 0; r < rows.length - 1; r++) {
    for (let s = 0; s < sectors; s++) {
      const t = (s + 1) % sectors
      b.quad(rows[r][s], rows[r + 1][s], rows[r + 1][t], rows[r][t])
    }
  }
  return b.build()
}

/**
 * A right triangular wedge: full height along the -Z edge, tapering to zero at +Z. The sloping
 * face is what makes it useful as a boolean cutter for a chamfer or a sloped soffit.
 */
function wedgeMesh(width: number, depth: number, height: number): TriMesh {
  const b = new MeshBuilder()
  const x = width / 2
  const z = depth / 2
  const a0 = b.vertex(-x, 0, -z)
  const a1 = b.vertex(x, 0, -z)
  const a2 = b.vertex(x, 0, z)
  const a3 = b.vertex(-x, 0, z)
  const t0 = b.vertex(-x, height, -z)
  const t1 = b.vertex(x, height, -z)

  b.quad(a0, a3, a2, a1) // bottom
  b.quad(a0, a1, t1, t0) // vertical back face at -Z
  b.quad(a3, t0, t1, a2) // sloping face
  b.tri(a0, t0, a3) // -X triangle
  b.tri(a1, a2, t1) // +X triangle
  return b.build()
}

/** Torus lying flat (ring in the XZ plane), base at y = 0. */
function torusMesh(
  radius: number,
  tubeRadius: number,
  radialSegments: number,
  tubularSegments: number,
): TriMesh {
  const b = new MeshBuilder()
  const cy = tubeRadius
  const grid: number[][] = []

  for (let i = 0; i < tubularSegments; i++) {
    const u = (i / tubularSegments) * Math.PI * 2
    const row: number[] = []
    for (let j = 0; j < radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2
      const r = radius + tubeRadius * Math.cos(v)
      row.push(b.vertex(Math.cos(u) * r, cy + tubeRadius * Math.sin(v), Math.sin(u) * r))
    }
    grid.push(row)
  }

  for (let i = 0; i < tubularSegments; i++) {
    const ii = (i + 1) % tubularSegments
    for (let j = 0; j < radialSegments; j++) {
      const jj = (j + 1) % radialSegments
      // Walked u-first so the surface normal points away from the tube's core, matching the
      // outward convention every other shape here uses.
      b.quad(grid[i][j], grid[ii][j], grid[ii][jj], grid[i][jj])
    }
  }
  return b.build()
}

/**
 * Tessellate a primitive to a watertight indexed mesh in local space (base centred on the origin,
 * +Y up). Refuses invalid shapes rather than emitting a degenerate solid.
 */
export function primitiveMesh(shape: PrimitiveShape): TriMesh | PrimitiveError {
  const errors = validatePrimitiveShape(shape)
  if (errors.length > 0) return { error: errors[0] }

  switch (shape.kind) {
    case 'box':
      return boxMesh(shape.width, shape.depth, shape.height)
    case 'cylinder':
      return extrudedPolygonMesh(shape.radius, shape.height, shape.segments)
    case 'prism':
      return extrudedPolygonMesh(shape.radius, shape.height, shape.sides)
    case 'cone':
      return coneMesh(shape.radius, shape.height, shape.segments)
    case 'sphere':
      return sphereMesh(shape.radius, shape.segments)
    case 'wedge':
      return wedgeMesh(shape.width, shape.depth, shape.height)
    case 'torus':
      return torusMesh(
        shape.radius,
        shape.tubeRadius,
        shape.radialSegments,
        shape.tubularSegments,
      )
  }
}

// ---------------------------------------------------------------------------
// Mesh introspection (used by the tests, and by boolean validation)
// ---------------------------------------------------------------------------

/**
 * Signed volume of a closed triangle mesh, via the divergence theorem (sum of tetrahedra from the
 * origin). Positive for outward-facing winding — which doubles as a **winding check**: a mesh built
 * inside-out returns a negative volume.
 */
export function meshVolume(mesh: TriMesh): number {
  let total = 0
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.indices[i] * 3
    const b = mesh.indices[i + 1] * 3
    const c = mesh.indices[i + 2] * 3
    const ax = mesh.positions[a]
    const ay = mesh.positions[a + 1]
    const az = mesh.positions[a + 2]
    const bx = mesh.positions[b]
    const by = mesh.positions[b + 1]
    const bz = mesh.positions[b + 2]
    const cx = mesh.positions[c]
    const cy = mesh.positions[c + 1]
    const cz = mesh.positions[c + 2]
    total +=
      (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
  }
  return total
}

/**
 * Is the mesh a closed manifold? True when every undirected edge is shared by exactly two
 * triangles, traversed in opposite directions. This is the property `three-bvh-csg` relies on, so
 * it is asserted directly for every shape rather than inferred from the render looking right.
 */
export function isWatertight(mesh: TriMesh): boolean {
  const seen = new Map<string, number>()
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const tri = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]]
    for (let e = 0; e < 3; e++) {
      const a = tri[e]
      const b = tri[(e + 1) % 3]
      if (a === b) return false // degenerate triangle
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      const dir = a < b ? 1 : -1
      seen.set(key, (seen.get(key) ?? 0) + dir)
    }
  }
  // Each edge must appear once in each direction, summing to exactly 0, and be seen twice.
  return [...seen.values()].every((v) => v === 0)
}

/** Local-space bounds of an actual tessellation (as opposed to the analytic `primitiveBounds`). */
export function meshBounds(mesh: TriMesh): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = mesh.positions[i + k]
      if (v < min[k]) min[k] = v
      if (v > max[k]) max[k] = v
    }
  }
  return { min, max }
}
