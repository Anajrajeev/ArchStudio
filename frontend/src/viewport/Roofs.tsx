/**
 * Roof renderer (B1) — builds a triangulated mesh directly from `resolveRoof`'s planar faces.
 *
 * Unlike walls/slabs (extruded from a 2D shape), a roof's faces are already resolved to world-
 * space 3D polygons (see `shared/geometry/roof.ts`), so this just triangulates each 3/4-vertex
 * face into a `BufferGeometry` — no extrusion needed.
 *
 * `resolveRoof` refuses (returns an error) for non-rectangular footprints or mismatched per-edge
 * angles (D-018); this component shows nothing rather than guessing when that happens, and the
 * Properties panel surfaces the error text so the user knows why.
 */
import { useEffect, useMemo } from 'react'
import { Edges } from '@react-three/drei'
import * as THREE from 'three'
import { resolveRoof, isRoofError } from '../../../shared/geometry/roof'
import { findType, type SceneGraph } from '../../../shared/types/scene'
import { materialColor } from '../scene/materials'
import { pickProps, surfaceProps, visible, type RenderOpts } from './Elements'

export function Roofs({ opts, levelId }: { opts: RenderOpts; levelId: string }) {
  const { scene } = opts
  const roofs = useMemo(
    () => visible(opts, scene.roofs.filter((r) => r.levelId === levelId)),
    [opts, scene.roofs, levelId],
  )
  return (
    <>
      {roofs.map((r) => (
        <RoofMesh key={r.id} roofId={r.id} opts={opts} />
      ))}
    </>
  )
}

function facesToGeometry(faces: { vertices: [number, number, number][] }[]): THREE.BufferGeometry {
  const positions: number[] = []
  for (const face of faces) {
    const [a, b, c, d] = face.vertices
    positions.push(...a, ...b, ...c)
    if (d) positions.push(...a, ...c, ...d)
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.computeVertexNormals()
  return geom
}

function RoofMesh({ roofId, opts }: { roofId: string; opts: RenderOpts }) {
  const { scene, theme, selectedIds, hoveredId, ghost } = opts
  const roof = scene.roofs.find((r) => r.id === roofId)

  const resolved = useMemo(() => (roof ? resolveRoof(roof) : null), [roof])
  const geom = useMemo(() => {
    if (!resolved || isRoofError(resolved)) return null
    return facesToGeometry(resolved.faces)
  }, [resolved])

  useEffect(() => {
    return () => geom?.dispose()
  }, [geom])

  if (!roof || !geom || !resolved || isRoofError(resolved)) return null

  const type = findType(scene, roof.typeId)
  const color =
    type?.category === 'roof' && type.layers[0]
      ? materialColor(scene, type.layers[0].material)
      : '#8a6a4a'
  const selected = selectedIds.includes(roofId)
  const hovered = hoveredId === roofId

  return (
    <mesh
      geometry={geom}
      receiveShadow
      castShadow
      {...pickProps(opts, roofId)}
    >
      <meshStandardMaterial
        {...surfaceProps(color, selected, hovered, ghost, theme, opts.underlay)}
        side={THREE.DoubleSide}
      />
      {selected && !ghost && <Edges threshold={20} color={theme.select} />}
    </mesh>
  )
}

/** For a hosted-tool-style error flash: is this roof's footprint/angles currently unresolvable? */
export function roofErrorMessage(scene: SceneGraph, roofId: string): string | null {
  const roof = scene.roofs.find((r) => r.id === roofId)
  if (!roof) return null
  const r = resolveRoof(roof)
  return isRoofError(r) ? r.error : null
}
