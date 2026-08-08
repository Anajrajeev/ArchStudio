/**
 * Primitive solid and boolean-result renderers (B7).
 *
 * Two things this file is careful about:
 *
 *  - **Consumed operands do not render.** A primitive that a boolean uses is drawn as part of that
 *    boolean's result, never on its own — otherwise the uncut box would draw straight through the
 *    hole cut in it. `freePrimitives` / `rootBooleanNodes` (pure, in `shared/geometry/booleanTree`)
 *    decide what is visible.
 *  - **CSG loads lazily.** `loadCsg()` is only called when the scene actually has a boolean node
 *    (E2: the bundle is already over budget — see DECISIONS.md D-019). Until it resolves, boolean
 *    results simply are not drawn yet; primitives render immediately and need no CSG at all.
 */
import { useEffect, useMemo, useState } from 'react'
import { Edges } from '@react-three/drei'
import * as THREE from 'three'
import {
  freePrimitives,
  rootBooleanNodes,
} from '../../../shared/geometry/booleanTree'
import { primitiveMesh, isPrimitiveError } from '../../../shared/geometry/primitives'
import { findPrimitiveType, type SceneGraph } from '../../../shared/types/scene'
import {
  evaluateBooleanGeometry,
  isBooleanEvalError,
  loadCsg,
  primitiveMatrix,
  triMeshToGeometry,
  type CsgModule,
} from '../geometry/evaluateBoolean'
import { materialColor } from '../scene/materials'
import { pickProps, surfaceProps, visible, type RenderOpts } from './Elements'

/**
 * Load the CSG module once the scene needs it. Returns null until then, so a project with no
 * booleans never triggers the dynamic import.
 */
function useCsg(needed: boolean): CsgModule | null {
  const [csg, setCsg] = useState<CsgModule | null>(null)
  useEffect(() => {
    if (!needed || csg) return
    let live = true
    void loadCsg().then((m) => {
      if (live) setCsg(m)
    })
    return () => {
      live = false
    }
  }, [needed, csg])
  return csg
}

export function Primitives({ opts, levelId }: { opts: RenderOpts; levelId: string }) {
  const { scene } = opts

  const visiblePrimitives = useMemo(
    () => visible(opts, freePrimitives(scene).filter((p) => p.levelId === levelId)),
    [opts, scene, levelId],
  )
  const roots = useMemo(
    () => visible(opts, rootBooleanNodes(scene).filter((b) => b.levelId === levelId)),
    [opts, scene, levelId],
  )

  const csg = useCsg(roots.length > 0)

  return (
    <>
      {visiblePrimitives.map((p) => (
        <PrimitiveMesh key={p.id} primitiveId={p.id} opts={opts} />
      ))}
      {csg &&
        roots.map((b) => <BooleanMesh key={b.id} nodeId={b.id} opts={opts} csg={csg} />)}
    </>
  )
}

/** Shared mesh shell: selection/hover material, picking, outline. */
function SolidMesh({
  id,
  geometry,
  color,
  opts,
}: {
  id: string
  geometry: THREE.BufferGeometry
  color: string
  opts: RenderOpts
}) {
  const { theme, selectedIds, hoveredId, ghost } = opts
  const selected = selectedIds.includes(id)
  const hovered = hoveredId === id

  return (
    <mesh
      geometry={geometry}
      castShadow
      receiveShadow
      {...pickProps(opts, id)}
    >
      <meshStandardMaterial
        {...surfaceProps(color, selected, hovered, ghost, theme, opts.underlay)}
      />
      {selected && !ghost && <Edges threshold={20} color={theme.select} />}
    </mesh>
  )
}

function PrimitiveMesh({ primitiveId, opts }: { primitiveId: string; opts: RenderOpts }) {
  const { scene } = opts
  const primitive = scene.primitives.find((p) => p.id === primitiveId)
  const type = primitive ? findPrimitiveType(scene, primitive.typeId) : undefined

  const geometry = useMemo(() => {
    if (!primitive || !type) return null
    const mesh = primitiveMesh(type.shape)
    if (isPrimitiveError(mesh)) return null
    const geom = triMeshToGeometry(mesh)
    geom.applyMatrix4(primitiveMatrix(scene, primitive))
    geom.computeVertexNormals()
    return geom
  }, [scene, primitive, type])

  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!primitive || !type || !geometry) return null

  return (
    <SolidMesh
      id={primitiveId}
      geometry={geometry}
      color={materialColor(scene, type.material)}
      opts={opts}
    />
  )
}

function BooleanMesh({
  nodeId,
  opts,
  csg,
}: {
  nodeId: string
  opts: RenderOpts
  csg: CsgModule
}) {
  const { scene } = opts
  const node = scene.booleans.find((b) => b.id === nodeId)

  const result = useMemo(
    () => (node ? evaluateBooleanGeometry(scene, nodeId, csg) : null),
    [scene, node, nodeId, csg],
  )

  useEffect(() => {
    return () => {
      if (result && !isBooleanEvalError(result)) result.dispose()
    }
  }, [result])

  if (!node || !result || isBooleanEvalError(result)) return null

  // The result takes the colour of its FIRST operand — for a cut that is the base solid, which is
  // the material the user is actually left looking at.
  const firstPrimitive = scene.primitives.find((p) => p.id === node.operandIds[0])
  const type = firstPrimitive ? findPrimitiveType(scene, firstPrimitive.typeId) : undefined
  const color = type ? materialColor(scene, type.material) : '#9E9E9E'

  return <SolidMesh id={nodeId} geometry={result} color={color} opts={opts} />
}

/**
 * Why a primitive or boolean currently draws nothing, for the Properties panel to surface —
 * the same pattern as `roofErrorMessage`. Returns null when there is nothing wrong.
 *
 * Note this reports only failures that need no CSG (an invalid shape, an unresolvable tree). A
 * failure inside the evaluator itself surfaces at render time.
 */
export function primitiveErrorMessage(scene: SceneGraph, id: string): string | null {
  const primitive = scene.primitives.find((p) => p.id === id)
  if (!primitive) return null
  const type = findPrimitiveType(scene, primitive.typeId)
  if (!type) return 'This shape has no primitive type — pick one below'
  const mesh = primitiveMesh(type.shape)
  return isPrimitiveError(mesh) ? mesh.error : null
}
