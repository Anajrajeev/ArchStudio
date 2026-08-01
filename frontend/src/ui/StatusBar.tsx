/**
 * Status bar. This is where a CAD app earns its credibility: at any instant it tells you what
 * tool phase you're in, what constraint is active, which work plane you're on, and what the
 * number is — without looking anything up.
 *
 * The "listening dimension" readout is the key piece: type a number mid-draw and it appears here
 * and in the viewport, with Tab switching between length and angle.
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditor, formatLength } from '../scene/store'
import { toolHint } from '../editor/tools'
import { planeBadge } from '../../../shared/geometry/workplane'
import { SNAP_TYPES, SNAP_LABEL } from '../../../shared/geometry/snapping'
import { IconTarget, IconLock, IconUnlock } from './Icons'

export default function StatusBar() {
  const { t } = useTranslation()
  const tool = useEditor((s) => s.tool)
  const points = useEditor((s) => s.points)
  const snap = useEditor((s) => s.snap)
  const cursorWorld = useEditor((s) => s.cursorWorld)
  const workPlane = useEditor((s) => s.workPlane)
  const planeLocked = useEditor((s) => s.planeLocked)
  const setPlaneLocked = useEditor((s) => s.setPlaneLocked)
  const numeric = useEditor((s) => s.numeric)
  const axisLock = useEditor((s) => s.axisLock)
  const wallMode = useEditor((s) => s.wallMode)
  const units = useEditor((s) => s.scene.units)
  const statusMessage = useEditor((s) => s.statusMessage)
  const flash = useEditor((s) => s.flash)

  const hint = toolHint(tool, points.length, wallMode)

  // Transient messages clear themselves so the bar returns to showing live state.
  useEffect(() => {
    if (!statusMessage) return
    const id = setTimeout(() => flash('', 'info'), 3200)
    return () => clearTimeout(id)
  }, [statusMessage, flash])

  return (
    <footer
      style={{
        height: 'var(--h-statusbar)',
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-12)',
        padding: '0 var(--sp-8)',
        background: 'var(--surface-300)',
        borderTop: '1px solid var(--divider)',
        fontSize: 'var(--fs-label)',
        color: 'var(--text-dim)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
    >
      {/* Prompt for the current click-phase, or a transient message */}
      {statusMessage?.text ? (
        <span
          style={{
            color: statusMessage.kind === 'error' ? 'var(--status-error)' : 'var(--text-default)',
            fontWeight: 'var(--fw-medium)',
          }}
        >
          {statusMessage.text}
        </span>
      ) : (
        <>
          <span style={{ color: 'var(--text-default)' }}>{hint.prompt}</span>
          <span style={{ opacity: 0.7 }}>{hint.modifiers}</span>
        </>
      )}

      <span className="spacer" />

      {/* Listening dimension — the number being typed, or the committed lock */}
      {(numeric.buffer || numeric.lockedLength !== null || numeric.lockedAngle !== null) && (
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-4)',
            padding: '0 var(--sp-8)',
            height: 18,
            borderRadius: 'var(--r-sm)',
            background: 'var(--bg-selected)',
            color: 'var(--text-default)',
            fontWeight: 'var(--fw-bold)',
          }}
        >
          <span style={{ opacity: 0.7 }}>
            {numeric.field === 'length' ? t('status.length') : t('status.angle')}
          </span>
          <span className="num">
            {numeric.buffer
              ? numeric.buffer
              : numeric.field === 'length' && numeric.lockedLength !== null
                ? formatLength(numeric.lockedLength, units)
                : numeric.lockedAngle !== null
                  ? `${numeric.lockedAngle}°`
                  : ''}
          </span>
        </span>
      )}

      {/* Axis lock indicator */}
      {axisLock !== 'none' && (
        <span
          className="num"
          style={{
            color: axisLock === 'x' ? 'var(--p-axis-x)' : 'var(--p-axis-y)',
            fontWeight: 'var(--fw-bold)',
          }}
        >
          {axisLock.toUpperCase()} {t('status.locked')}
        </span>
      )}

      {/* Active snap */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)' }}>
        <IconTarget
          width={12}
          height={12}
          style={{ color: snap?.snapped ? 'var(--p-select-active)' : 'var(--icon-default)' }}
        />
        <span style={{ color: snap?.snapped ? 'var(--text-default)' : 'var(--text-dim)' }}>
          {snap?.label ?? t('status.noSnap')}
        </span>
      </span>

      <SnapMenu />

      {/* Work-plane badge — "which plane am I drawing on?" */}
      <button
        onClick={() => setPlaneLocked(!planeLocked)}
        className="tip"
        data-tip={planeLocked ? t('status.unlockPlane') : t('status.lockPlane')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-4)',
          color: planeLocked ? 'var(--text-accent)' : 'var(--text-dim)',
        }}
      >
        {planeLocked ? <IconLock width={12} height={12} /> : <IconUnlock width={12} height={12} />}
        <span className="num">{planeBadge(workPlane)}</span>
      </button>

      {/* Coordinate readout — bottom-right, per the SketchUp convention */}
      <span className="num" style={{ minWidth: 150, textAlign: 'right', color: 'var(--text-default)' }}>
        {cursorWorld
          ? `X ${cursorWorld[0].toFixed(2)}   Y ${cursorWorld[2].toFixed(2)}   Z ${cursorWorld[1].toFixed(2)}`
          : 'X —   Y —   Z —'}
      </span>
    </footer>
  )
}

/** Running-snap toggles behind one control, as AutoCAD and Rayon do. */
function SnapMenu() {
  const { t } = useTranslation()
  const toggles = useEditor((s) => s.snapToggles)
  const toggleSnapType = useEditor((s) => s.toggleSnapType)
  const enabled = SNAP_TYPES.filter((s) => toggles[s]).length

  return (
    <details style={{ position: 'relative' }}>
      <summary
        style={{
          listStyle: 'none',
          cursor: 'pointer',
          color: 'var(--text-dim)',
          userSelect: 'none',
        }}
      >
        {t('status.snaps')} ({enabled}/{SNAP_TYPES.length})
      </summary>
      <div
        style={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          right: 0,
          minWidth: 168,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-base)',
          borderRadius: 'var(--r-md)',
          boxShadow: 'var(--shadow-high)',
          padding: 'var(--sp-4)',
          zIndex: 'var(--z-dropdown)',
        }}
      >
        {SNAP_TYPES.map((s) => (
          <label
            key={s}
            className="tree-row"
            style={{ cursor: 'pointer', color: 'var(--text-default)' }}
          >
            <input
              className="check"
              type="checkbox"
              checked={toggles[s]}
              onChange={() => toggleSnapType(s)}
            />
            {SNAP_LABEL[s]}
          </label>
        ))}
      </div>
    </details>
  )
}
