/**
 * The one place a pure `TriMesh` (shared/geometry) becomes a `THREE.BufferGeometry`. Shared by
 * `geometry/evaluateBoolean.ts`, the wall renderer, and the exporter, so there is exactly one
 * position/normal convention to get right rather than three copies of it.
 */
import * as THREE from 'three'
import type { TriMesh } from '../../../shared/geometry/primitives'

export function triMeshToGeometry(mesh: TriMesh): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3))
  geom.setIndex(mesh.indices)
  geom.computeVertexNormals()
  return geom
}
