/**
 * The contract every editing verb returns.
 *
 * Shared by the transform verbs (D4: copy, array, mirror, rotate) and the modify verbs (D3: trim,
 * extend, split, offset, align) so a caller — a panel button, a keyboard command, or a Phase 3 agent
 * tool — can run any of them through one code path.
 *
 * The union is the important part: a verb returns either a new scene or a sentence explaining why it
 * did nothing. "Refuse and explain, never degrade silently" is a core rule, and making the failure
 * case part of the *type* is what stops a verb from quietly returning an unchanged scene.
 */
import type { SceneGraph } from '../../../shared/types/scene'

export interface VerbOutcome {
  scene: SceneGraph
  /** Ids that hold the result — the copies, when copies were made. */
  selectAfter: string[]
  /** Undo-history label. */
  label: string
}

export interface VerbError {
  error: string
}

export type VerbResult = VerbOutcome | VerbError

export function isVerbError(r: VerbResult): r is VerbError {
  return 'error' in r
}
