/**
 * Keeps the active work plane in step with the active level.
 *
 * This lives in its own module deliberately: a file that exports BOTH a React component and a
 * hook breaks react-refresh's "consistent component exports" rule, which forces Vite to fully
 * invalidate the module instead of hot-updating it. In an r3f app that tears down the canvas and
 * loses the WebGL context, which surfaces as a blank viewport mid-session.
 */
import { useEffect } from 'react'
import { findLevel } from '../../../shared/types/scene'
import { levelWorkPlane, planeElevation } from '../../../shared/geometry/workplane'
import { useEditor } from '../scene/store'

export function useSyncWorkPlaneToLevel(): void {
  const activeLevelId = useEditor((s) => s.activeLevelId)
  const scene = useEditor((s) => s.scene)
  const planeLocked = useEditor((s) => s.planeLocked)

  useEffect(() => {
    // An explicitly locked plane must survive a level change.
    if (planeLocked) return
    const level = findLevel(scene, activeLevelId)
    if (!level) return

    const current = useEditor.getState().workPlane
    const alreadyOnLevel =
      current.source.kind === 'level' &&
      current.source.levelId === level.id &&
      Math.abs(planeElevation(current) - level.elevation) < 1e-9
    if (alreadyOnLevel) return

    useEditor.setState({ workPlane: levelWorkPlane(level.id, level.name, level.elevation) })
  }, [activeLevelId, scene, planeLocked])
}
