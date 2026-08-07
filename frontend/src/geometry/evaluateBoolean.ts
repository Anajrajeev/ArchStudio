/**
 * The ONE Three.js seam for boolean geometry (B7 / DECISIONS.md D-019).
 *
 * Both the viewport (`viewport/Primitives.tsx`) and the exporter (`export/buildSceneGroup.ts`) call
 * `evaluateBooleanGeometry` from here, so the screen and the GLB/OBJ/STL are produced by the same
 * code and cannot disagree — the same rule `wallSolidBoxes` follows for walls.
 *
 * `three-bvh-csg` is reached through a cached dynamic `import()`. Bundle size is already over Vite's
 * warning limit (E2), and this dependency pair is ~2.3 MB unpacked, so a project containing no
 * boolean node must never load it. That is why `loadCsg()` exists and why the evaluation function
 * itself is synchronous and takes the loaded module as an argument: callers decide when to pay the
 * cost, and `buildSceneGroup` stays synchronous and testable.
 */
import * as THREE from 'three'
import { primitiveMesh, isPrimitiveError } from '../../../shared/geometry/primitives'
import {
  resolveBooleanNode,
  isBooleanTreeError,
  type ResolvedBoolean,
} from '../../../shared/geometry/booleanTree'
import {
  findLevel,
  findPrimitiveType,
  type Primitive,
  type SceneGraph,
} from '../../../shared/types/scene'
import { triMeshToGeometry } from '../scene/geometryUtils'

export { triMeshToGeometry }

/** The subset of `three-bvh-csg` this module uses. */
export interface CsgModule {
  Evaluator: new () => {
    /**
     * Which vertex attributes to carry through the operation. Must be set to exactly what our
     * geometries have — the evaluator throws `Attribute uv not available` if it is asked for an
     * attribute an operand lacks, and `primitiveMesh` produces position + normal only (no UVs;
     * nothing in Phase 1 textures a primitive).
     */
    attributes: string[]
    /** Emit one geometry group rather than per-operand groups — we apply a single material. */
    useGroups: boolean
    evaluate: (
      a: { geometry: THREE.BufferGeometry },
      b: { geometry: THREE.BufferGeometry },
      op: number,
    ) => { geometry: THREE.BufferGeometry }
  }
  Brush: new (geometry: THREE.BufferGeometry) => THREE.Mesh & {
    updateMatrixWorld: (force?: boolean) => void
  }
  ADDITION: number
  SUBTRACTION: number
  INTERSECTION: number
}

export interface BooleanEvalError {
  error: string
}

export function isBooleanEvalError(x: unknown): x is BooleanEvalError {
  return typeof x === 'object' && x !== null && 'error' in x
}

// ---------------------------------------------------------------------------
// Lazy module loading
// ---------------------------------------------------------------------------

let csgPromise: Promise<CsgModule> | null = null

/**
 * Load (once) and cache the CSG module. Safe to call repeatedly — every caller after the first
 * awaits the same promise rather than triggering another chunk fetch.
 */
export function loadCsg(): Promise<CsgModule> {
  if (!csgPromise) {
    csgPromise = import('three-bvh-csg').then((m) => m as unknown as CsgModule)
  }
  return csgPromise
}

/** Does this scene need the CSG chunk at all? */
export function sceneNeedsCsg(scene: SceneGraph): boolean {
  return scene.booleans.length > 0
}

// ---------------------------------------------------------------------------
// Primitive → BufferGeometry
// ---------------------------------------------------------------------------

/**
 * The world transform of a placed primitive: scene 2D `[x, y]` maps to world `[x, elevation, y]`
 * (D-007), the base sits at the level elevation plus `heightOffset`, and `rotation` turns about the
 * vertical axis. Negated to match the sign convention `buildSceneGroup` already uses for furniture.
 */
export function primitiveMatrix(scene: SceneGraph, primitive: Primitive): THREE.Matrix4 {
  const level = findLevel(scene, primitive.levelId)
  const elevation = (level?.elevation ?? 0) + primitive.heightOffset
  const m = new THREE.Matrix4()
  m.compose(
    new THREE.Vector3(primitive.position[0], elevation, primitive.position[1]),
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      (-primitive.rotation * Math.PI) / 180,
    ),
    new THREE.Vector3(primitive.scale, primitive.scale, primitive.scale),
  )
  return m
}

/**
 * Geometry for one placed primitive, already baked into world space.
 *
 * World space (rather than a mesh with a transform) is what CSG needs: the evaluator combines
 * operands that each have their own placement, so they must share one coordinate system before
 * they can be intersected.
 */
export function primitiveWorldGeometry(
  scene: SceneGraph,
  primitive: Primitive,
): THREE.BufferGeometry | BooleanEvalError {
  const type = findPrimitiveType(scene, primitive.typeId)
  if (!type) return { error: 'This shape has no primitive type — pick one in Properties' }

  const mesh = primitiveMesh(type.shape)
  if (isPrimitiveError(mesh)) return { error: mesh.error }
  if (!Number.isFinite(primitive.scale) || primitive.scale <= 0) {
    return { error: 'Scale must be greater than 0' }
  }

  const geom = triMeshToGeometry(mesh)
  geom.applyMatrix4(primitiveMatrix(scene, primitive))
  geom.computeVertexNormals()
  return geom
}

// ---------------------------------------------------------------------------
// Boolean evaluation
// ---------------------------------------------------------------------------

function opConstant(op: 'union' | 'cut' | 'intersect', csg: CsgModule): number {
  switch (op) {
    case 'union':
      return csg.ADDITION
    case 'cut':
      return csg.SUBTRACTION
    case 'intersect':
      return csg.INTERSECTION
  }
}

/**
 * Fold a resolved tree into one geometry, depth first.
 *
 * `cut` folds left-to-right from `operands[0]`, so the first operand is the base and every later
 * one is removed from it — matching the order documented on `BooleanNode`. `union` and `intersect`
 * fold the same way but are order-independent, so one loop covers all three.
 *
 * Intermediate geometries are disposed as we go: a deep tree would otherwise leak one
 * BufferGeometry per node on every re-evaluation, and re-evaluation happens on every operand edit.
 */
function evaluateResolved(
  scene: SceneGraph,
  resolved: ResolvedBoolean,
  csg: CsgModule,
  evaluator: InstanceType<CsgModule['Evaluator']>,
): THREE.BufferGeometry | BooleanEvalError {
  if (resolved.kind === 'leaf') {
    return primitiveWorldGeometry(scene, resolved.primitive)
  }

  let accumulated: THREE.BufferGeometry | null = null

  for (const operand of resolved.operands) {
    const next = evaluateResolved(scene, operand, csg, evaluator)
    if (isBooleanEvalError(next)) {
      accumulated?.dispose()
      return next
    }

    if (!accumulated) {
      accumulated = next
      continue
    }

    const a = new csg.Brush(accumulated)
    a.updateMatrixWorld(true)
    const b = new csg.Brush(next)
    b.updateMatrixWorld(true)

    let result: { geometry: THREE.BufferGeometry }
    try {
      result = evaluator.evaluate(a, b, opConstant(resolved.op, csg))
    } catch {
      accumulated.dispose()
      next.dispose()
      return {
        error: 'These shapes could not be combined — try moving them so they overlap more clearly',
      }
    }

    // The evaluator returns a fresh geometry; the two inputs are now dead.
    accumulated.dispose()
    next.dispose()
    accumulated = result.geometry
  }

  if (!accumulated) return { error: 'This boolean operation has no shapes to combine' }
  accumulated.computeVertexNormals()
  return accumulated
}

/**
 * Evaluate a boolean node to a single world-space geometry, or explain why it cannot be.
 *
 * Synchronous by design — the caller supplies the already-loaded CSG module (see `loadCsg`), which
 * keeps `buildSceneGroup` synchronous and lets the tests evaluate booleans with a plain static
 * import and no async plumbing.
 */
export function evaluateBooleanGeometry(
  scene: SceneGraph,
  nodeId: string,
  csg: CsgModule,
): THREE.BufferGeometry | BooleanEvalError {
  const resolved = resolveBooleanNode(scene, nodeId)
  if (isBooleanTreeError(resolved)) return { error: resolved.error }
  const evaluator = new csg.Evaluator()
  evaluator.attributes = ['position', 'normal']
  evaluator.useGroups = false
  return evaluateResolved(scene, resolved, csg, evaluator)
}
