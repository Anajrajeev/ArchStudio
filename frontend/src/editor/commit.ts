/**
 * Committing the active tool. Shared by the pointer layer (click to place the last point) and the
 * keyboard layer (Enter to close a loop), so both paths behave identically.
 */
import type { Vec2 } from '../../../shared/types/scene'
import { useEditor } from '../scene/store'
import { buildCommit } from './tools'

/**
 * Commit the active tool with `points`. Chains when the tool supports it (a wall continues from
 * its last endpoint), otherwise resets. Invalid point sets flash a message rather than producing
 * bad geometry — refuse and explain, never degrade silently.
 */
export function commitActiveTool(points: Vec2[]): boolean {
  const s = useEditor.getState()
  const commit = buildCommit(s, points)
  if (!commit) {
    s.flash('Those points do not make a valid element', 'error')
    s.clearPoints()
    return false
  }

  s.commit(commit.label, commit.produce)
  const newId = commit.selectAfter?.(useEditor.getState().scene) ?? null

  if (commit.keepPoints.length > 0) {
    useEditor.setState({
      points: commit.keepPoints,
      toolPhase: 'collecting',
      numeric: { buffer: '', field: 'length', lockedLength: null, lockedAngle: null },
      axisLock: 'none',
    })
  } else {
    s.clearPoints()
    s.clearNumeric()
    s.setAxisLock('none')
  }

  // Selecting the new element is only helpful once the user is back on the select tool.
  if (newId && useEditor.getState().tool === 'select') s.select(newId)
  return true
}
