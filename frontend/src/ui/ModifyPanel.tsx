/**
 * The transform verbs, as UI (D4): move, copy, linear array, radial array, mirror, rotate.
 *
 * Two decisions worth stating:
 *
 *  - **Numeric-first, not gizmo-first.** The research flagged "a gizmo as the only way to edit
 *    anything" as a toy tell. An architect arraying columns wants to type 3600 mm and a count of 7,
 *    not drag until a tooltip reads about right. The handles in `viewport/Handles.tsx` cover the
 *    direct-manipulation half; this covers the exact half.
 *  - **It works on a multi-selection.** Every verb takes the whole selection as a unit, so this is
 *    also the first genuinely multi-select-aware editor in the panel.
 *
 * Rotate and radial array default their centre to the selection's centroid, which is what "rotate
 * this" almost always means; the field stays editable for when it isn't.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditor } from '../scene/store'
import { Group, NumberField, CheckField } from './PropertiesPanel'
import {
  copyBy,
  linearArray,
  mirrorAcross,
  moveBy,
  radialArray,
  rotateBy,
  type TransformResult,
} from '../editor/transforms'
import { alignElements, type AlignAxis, type AlignEdge } from '../editor/modifyVerbs'
import {
  cutElements,
  explodeBoolean,
  intersectElements,
  unionElements,
} from '../editor/booleanVerbs'
import { validateOperands } from '../../../shared/geometry/booleanTree'
import { splitRoofAndWalls, voidWallsToRoof } from '../editor/roofVoid'
import { joinWalls, selectionForJoin, unjoinWalls } from '../editor/joinVerbs'
import { canGroup, groupElements, ungroupElements } from '../editor/groupVerbs'
import { selectionCentroid } from '../editor/selection'
import type { SceneGraph, Vec2, WallJoinStyle } from '../../../shared/types/scene'

type MirrorAxis = 'x' | 'y'

export default function ModifyPanel() {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const selectedIds = useEditor((s) => s.selectedIds)
  const commit = useEditor((s) => s.commit)
  const selectMany = useEditor((s) => s.selectMany)
  const flash = useEditor((s) => s.flash)

  const [dx, setDx] = useState(1)
  const [dy, setDy] = useState(0)
  const [count, setCount] = useState(3)
  const [angle, setAngle] = useState(90)
  const [ringAngle, setRingAngle] = useState(360)
  const [keepOriginal, setKeepOriginal] = useState(true)
  const [mirrorAxis, setMirrorAxis] = useState<MirrorAxis>('x')
  const [joinStyle, setJoinStyle] = useState<WallJoinStyle>('miter')

  const centroid = selectionCentroid(scene, selectedIds)
  const centroidX = centroid?.[0] ?? 0
  const centroidY = centroid?.[1] ?? 0
  const selectionKey = selectedIds.join(',')

  const [cx, setCx] = useState(0)
  const [cy, setCy] = useState(0)
  // Follow the selection until the user overrides the centre, so "rotate this" needs no setup.
  const [centreTouched, setCentreTouched] = useState(false)
  useEffect(() => {
    if (centreTouched || !centroid) return
    setCx(centroidX)
    setCy(centroidY)
  }, [centroid, centroidX, centroidY, centreTouched])

  // Reset the "user chose a centre" flag when the selection changes entirely.
  useEffect(() => setCentreTouched(false), [selectionKey])

  if (selectedIds.length === 0) return null

  /**
   * Run a verb. Every verb either produces a scene or an explanation — never a silent no-op — so
   * this is the one place that decides between committing and flashing.
   */
  const run = (fn: () => TransformResult) => {
    const before = useEditor.getState().scene
    const result = fn()
    if ('error' in result) {
      flash(result.error, 'error')
      return
    }
    commit(result.label, () => result.scene)
    selectMany(result.selectAfter)
    if (result.scene === before) flash('Nothing changed', 'error')
  }

  const delta = (): Vec2 => [dx, dy]
  const centre = (): Vec2 => [cx, cy]

  // `validateOperands` is the single source of truth for whether a boolean is possible, so the
  // buttons appear exactly when the verb would succeed — no second, drifting copy of the rule.
  const booleanReady = validateOperands(scene, selectedIds) === null
  const roofVoidReady = !('error' in splitRoofAndWalls(scene, selectedIds))
  // Same discipline for joins: `selectionForJoin` is the one rule, so the button appears exactly
  // when the verb would get past its own selection check.
  const joinReady = !('error' in selectionForJoin(scene, selectedIds))
  const unjoinReady = scene.wallJoins.some(
    (j) => selectedIds.includes(j.id) || j.memberIds.some((m) => selectedIds.includes(m)),
  )
  const ungroupReady = selectedIds.some((id) => scene.groups.some((g) => g.id === id))
  const explodableId =
    selectedIds.length === 1 && scene.booleans.some((b) => b.id === selectedIds[0])
      ? selectedIds[0]
      : null

  return (
    <>
      <Group label={t('modify.moveCopy')}>
        <NumberField label={t('modify.dx')} value={dx} onCommit={setDx} step={0.05} />
        <NumberField label={t('modify.dy')} value={dy} onCommit={setDy} step={0.05} />
      </Group>
      <Actions>
        <button className="btn" onClick={() => run(() => moveBy(scene, selectedIds, delta()))}>
          {t('modify.move')}
        </button>
        <button className="btn" onClick={() => run(() => copyBy(scene, selectedIds, delta()))}>
          {t('modify.copy')}
        </button>
      </Actions>

      <Group label={t('modify.array')}>
        <NumberField
          label={t('modify.count')}
          value={count}
          onCommit={(v) => setCount(Math.round(v))}
          min={1}
          max={500}
          step={1}
          hint={t('modify.countHint')}
        />
      </Group>
      <Actions>
        <button
          className="btn"
          style={{ width: '100%' }}
          onClick={() => run(() => linearArray(scene, selectedIds, delta(), count))}
        >
          {t('modify.linearArray')}
        </button>
      </Actions>

      <Group label={t('modify.centre')}>
        <NumberField
          label="X"
          value={cx}
          onCommit={(v) => {
            setCentreTouched(true)
            setCx(v)
          }}
          step={0.05}
        />
        <NumberField
          label="Y"
          value={cy}
          onCommit={(v) => {
            setCentreTouched(true)
            setCy(v)
          }}
          step={0.05}
        />
        <NumberField
          label={t('modify.angle')}
          value={angle}
          onCommit={setAngle}
          unit="°"
          step={5}
        />
        <NumberField
          label={t('modify.ringAngle')}
          value={ringAngle}
          onCommit={setRingAngle}
          unit="°"
          step={15}
        />
        <CheckField
          label={t('modify.keepOriginal')}
          value={keepOriginal}
          onCommit={setKeepOriginal}
        />
      </Group>
      <Actions>
        <button
          className="btn"
          onClick={() => run(() => rotateBy(scene, selectedIds, centre(), angle, keepOriginal))}
        >
          {t('modify.rotate')}
        </button>
        <button
          className="btn"
          onClick={() => run(() => radialArray(scene, selectedIds, centre(), ringAngle, count))}
        >
          {t('modify.radialArray')}
        </button>
      </Actions>

      {/* Booleans (B7). Shown only when the selection could actually be combined, so the panel
          does not offer an operation that is guaranteed to refuse. Order matters for Cut: the
          FIRST selected shape is the base and the rest are removed from it. */}
      {booleanReady && (
        <>
          <Group label={t('modify.boolean')}>
            <span className="prop-label" style={{ gridColumn: '1 / -1', opacity: 0.7 }}>
              {t('modify.booleanHint')}
            </span>
          </Group>
          <Actions>
            <button className="btn" onClick={() => run(() => unionElements(scene, selectedIds))}>
              {t('modify.union')}
            </button>
            <button className="btn" onClick={() => run(() => cutElements(scene, selectedIds))}>
              {t('modify.cut')}
            </button>
            <button
              className="btn"
              onClick={() => run(() => intersectElements(scene, selectedIds))}
            >
              {t('modify.intersect')}
            </button>
          </Actions>
        </>
      )}

      {/* Explode is the inverse: it gives the operands back rather than deleting them. */}
      {explodableId && (
        <Actions>
          <button
            className="btn"
            style={{ width: '100%' }}
            onClick={() => run(() => explodeBoolean(scene, explodableId))}
          >
            {t('modify.explode')}
          </button>
        </Actions>
      )}

      {/* Void to roof (B1): select one roof plus the wall(s) under its eave and attach their tops
          to it. Only a wall running along the roof's own eave line qualifies — voidWallsToRoof
          refuses with a message otherwise, so this is shown whenever the selection SHAPE (one
          roof + walls) is right, and the verb itself explains a per-wall refusal. Detaching is a
          per-wall action in Properties, not a verb — there is nothing to select-and-batch there. */}
      {roofVoidReady && (
        <Actions>
          <button
            className="btn"
            style={{ width: '100%' }}
            onClick={() => run(() => voidWallsToRoof(scene, selectedIds))}
          >
            {t('modify.voidToRoof')}
          </button>
        </Actions>
      )}

      {/* Groups (D5). Group needs two or more elements; Ungroup appears only when something in
          the selection actually IS a group, so neither button is ever offered as a no-op. */}
      {(canGroup(selectedIds) || ungroupReady) && (
        <>
          <Group label={t('modify.group')}>
            <span className="prop-label" style={{ gridColumn: '1 / -1', opacity: 0.7 }}>
              {t('modify.groupHint')}
            </span>
          </Group>
          <Actions>
            {canGroup(selectedIds) && (
              <button className="btn" onClick={() => run(() => groupElements(scene, selectedIds))}>
                {t('modify.groupElements')}
              </button>
            )}
            {ungroupReady && (
              <button className="btn" onClick={() => run(() => ungroupElements(scene, selectedIds))}>
                {t('modify.ungroupElements')}
              </button>
            )}
          </Actions>
        </>
      )}

      {/* Wall joins (A9). Shown only when the selection is two or more walls on one level, so the
          button is never offered for a selection that is guaranteed to refuse. Style is picked
          here rather than after the fact because it is the ONE thing the geometry cannot infer:
          an equal-thickness corner can legitimately be either mitred or butted. Unjoin appears
          whenever anything selected is currently joined — including the join object itself, which
          is selectable from the model tree. */}
      {joinReady && (
        <>
          <Group label={t('modify.join')}>
            <label className="prop-label" htmlFor="join-style">
              {t('modify.joinStyle')}
            </label>
            <select
              id="join-style"
              className="select"
              value={joinStyle}
              onChange={(e) => setJoinStyle(e.target.value as WallJoinStyle)}
            >
              <option value="miter">{t('modify.joinMiter')}</option>
              <option value="butt">{t('modify.joinButt')}</option>
            </select>
            <span className="prop-label" style={{ gridColumn: '1 / -1', opacity: 0.7 }}>
              {t('modify.joinHint')}
            </span>
          </Group>
          <Actions>
            <button
              className="btn"
              onClick={() => run(() => joinWalls(scene, selectedIds, joinStyle))}
            >
              {t('modify.joinWalls')}
            </button>
          </Actions>
        </>
      )}
      {unjoinReady && (
        <Actions>
          <button
            className="btn"
            style={{ width: '100%' }}
            onClick={() => run(() => unjoinWalls(scene, selectedIds))}
          >
            {t('modify.unjoinWalls')}
          </button>
        </Actions>
      )}

      {/* Align needs two or more elements to mean anything. */}
      {selectedIds.length > 1 && (
        <>
          <Group label={t('modify.align')}>
            <span className="prop-label">{t('modify.alignX')}</span>
            <AlignRow axis="x" run={run} scene={scene} ids={selectedIds} />
            <span className="prop-label">{t('modify.alignY')}</span>
            <AlignRow axis="y" run={run} scene={scene} ids={selectedIds} />
          </Group>
        </>
      )}

      <Group label={t('modify.mirror')}>
        <label className="prop-label" htmlFor="mirror-axis">
          {t('modify.mirrorAxis')}
        </label>
        <select
          id="mirror-axis"
          className="select"
          value={mirrorAxis}
          onChange={(e) => setMirrorAxis(e.target.value as MirrorAxis)}
        >
          <option value="x">{t('modify.mirrorAxisX')}</option>
          <option value="y">{t('modify.mirrorAxisY')}</option>
        </select>
      </Group>
      <Actions>
        <button
          className="btn"
          style={{ width: '100%' }}
          onClick={() =>
            run(() =>
              mirrorAcross(
                scene,
                selectedIds,
                centre(),
                // A horizontal axis runs along +X through the centre; a vertical one along +Y.
                mirrorAxis === 'x' ? [cx + 1, cy] : [cx, cy + 1],
                keepOriginal,
              ),
            )
          }
        >
          {t('modify.mirror')}
        </button>
      </Actions>
    </>
  )
}

/**
 * Min / centre / max along one axis. Three tight buttons rather than a select, because align is a
 * "click and look" operation — you try centre, see it, then try max.
 */
function AlignRow({
  axis,
  run,
  scene,
  ids,
}: {
  axis: AlignAxis
  run: (fn: () => TransformResult) => void
  scene: SceneGraph
  ids: string[]
}) {
  const { t } = useTranslation()
  const edges: Array<{ edge: AlignEdge; key: string }> = [
    { edge: 'min', key: 'modify.alignMin' },
    { edge: 'center', key: 'modify.alignCentre' },
    { edge: 'max', key: 'modify.alignMax' },
  ]
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {edges.map((e) => (
        <button
          key={e.edge}
          className="btn"
          style={{ flex: 1, padding: 0 }}
          onClick={() => run(() => alignElements(scene, ids, axis, e.edge))}
        >
          {t(e.key)}
        </button>
      ))}
    </div>
  )
}

function Actions({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--sp-4)', padding: '0 var(--sp-8) var(--sp-4)' }}>
      {children}
    </div>
  )
}
