/**
 * DOM overlays on top of the viewport: the empty-state cue and the view-mode controls.
 *
 * An empty 3D scene with a select tool active gives a new user nothing to act on — they see a
 * grid and a cursor and no indication of where to begin. Pro tools solve this with a persistent
 * hint, so this disappears the moment the model is non-empty.
 */
import { useTranslation } from 'react-i18next'
import { useEditor } from '../scene/store'
import { IconWall } from './Icons'

export default function ViewportHints() {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)

  const isEmpty =
    scene.walls.length === 0 &&
    scene.slabs.length === 0 &&
    scene.rooms.length === 0 &&
    scene.columns.length === 0 &&
    scene.beams.length === 0 &&
    scene.furniture.length === 0

  if (!isEmpty || tool !== 'select') return null

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--sp-12)',
        padding: 'var(--sp-24)',
        maxWidth: 380,
        textAlign: 'center',
        // The hint must never intercept a click meant for the canvas.
        pointerEvents: 'none',
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 'var(--fs-heading)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--text-default)',
        }}
      >
        {t('viewport.emptyTitle')}
      </p>
      <p style={{ margin: 0, fontSize: 'var(--fs-body)', color: 'var(--text-dim)' }}>
        {t('viewport.emptyBody')}
      </p>
      <button
        className="btn btn--primary"
        style={{ pointerEvents: 'auto', height: 'var(--h-button-lg)' }}
        onClick={() => setTool('wall')}
      >
        <IconWall />
        {t('viewport.startDrawing')}
      </button>
      <p
        className="num"
        style={{ margin: 0, fontSize: 'var(--fs-label)', color: 'var(--text-placeholder)' }}
      >
        {t('viewport.emptyShortcuts')}
      </p>
    </div>
  )
}
