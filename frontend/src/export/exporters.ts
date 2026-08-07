/**
 * Serialize the scene graph to GLB/glTF, OBJ, and STL and trigger a browser download.
 * All three exporters run over the SAME THREE.Group produced by `buildSceneGroup`.
 */
import * as THREE from 'three'
import { GLTFExporter, OBJExporter, STLExporter } from 'three-stdlib'
import type { SceneGraph } from '../../../shared/types/scene'
import { loadCsg, sceneNeedsCsg } from '../geometry/evaluateBoolean'
import { buildSceneGroup, disposeSceneGroup } from './buildSceneGroup'

export type ExportFormat = 'glb' | 'obj' | 'stl'

function triggerDownload(data: BlobPart, filename: string, mime: string): void {
  const blob = new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function exportGLB(group: THREE.Group): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter()
  return new Promise((resolve, reject) => {
    exporter.parse(
      group,
      (result) => resolve(result as ArrayBuffer),
      (err) => reject(err instanceof Error ? err : new Error('GLB export failed')),
      { binary: true },
    )
  })
}

/** Export the scene in `format` and download it as `<name>.<ext>`. */
export async function exportScene(
  scene: SceneGraph,
  format: ExportFormat,
  name = 'archstudio-model',
): Promise<void> {
  // Pay the CSG chunk cost only when the model actually contains a boolean (E2 / D-019).
  const csg = sceneNeedsCsg(scene) ? await loadCsg() : undefined
  const group = buildSceneGroup(scene, csg)
  try {
    if (format === 'glb') {
      const buffer = await exportGLB(group)
      triggerDownload(buffer, `${name}.glb`, 'model/gltf-binary')
    } else if (format === 'obj') {
      triggerDownload(new OBJExporter().parse(group), `${name}.obj`, 'text/plain')
    } else {
      triggerDownload(new STLExporter().parse(group), `${name}.stl`, 'model/stl')
    }
  } finally {
    disposeSceneGroup(group)
  }
}
