import type { SceneGraph } from '../../../shared/types/scene'

const FALLBACK = '#cccccc'

/** Resolve a material id to a hex colour, with a sane fallback for unknown ids. */
export function materialColor(scene: SceneGraph, materialId: string): string {
  return scene.materials.find((m) => m.id === materialId)?.color ?? FALLBACK
}
