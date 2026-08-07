/**
 * Properties panel, split into TYPE and INSTANCE sections.
 *
 * That split is the whole point of schema v2 and the defining BIM interaction: type properties
 * (thickness, composition, door size) are shared — edit one, every instance updates. Instance
 * properties (placement, level, constraints) are per-element. The panel labels which is which so
 * the user is never surprised that changing a thickness moved 60 walls.
 *
 * Numeric fields accept expressions and units (`2400`, `1.2m`, `3'6"`, `2.4+0.3`), drag-scrub on
 * the label, and arrow-key stepping — all four are table stakes for an architect.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  assemblyThickness,
  findType,
  findLevel,
  findPrimitiveType,
  type SceneGraph,
  type TopConstraint,
  type BooleanOp,
} from '../../../shared/types/scene'
import {
  resolveBooleanNode,
  isBooleanTreeError,
} from '../../../shared/geometry/booleanTree'
import { primitiveErrorMessage } from '../viewport/Primitives'
import {
  resolveWall,
  baselineLength,
  roomArea,
  polygonPerimeter,
  validateWall,
  validateOpening,
} from '../../../shared/geometry/index'
import { useEditor, parseLengthInput, formatLength } from '../scene/store'
import {
  deleteElement,
  duplicateType,
  elementLabel,
  findElement,
  setElementType,
  setWallTypeThickness,
  syncOpeningToFilling,
  updateBeam,
  updateColumn,
  updateFilling,
  updateFurniture,
  updateOpening,
  updateRoom,
  updateSlab,
  updateType,
  updateWall,
  updateAnnotation,
  updateRoomTag,
  updateDimension,
  updateColumnGrid,
  updateGridAxis,
  addGridAxis,
  removeLastGridAxis,
  updateRoof,
  setRoofUniformEdge,
  updatePrimitive,
  updateBooleanNode,
  updateStair,
  updateRailing,
} from '../scene/mutations'
import { resolveRoof, isRoofError } from '../../../shared/geometry/roof'
import { resolveStair, validateStair } from '../../../shared/geometry/stair'
import { resolveRailing, validateRailing } from '../../../shared/geometry/railing'
import { IconTrash, IconPlus } from './Icons'
import ModifyPanel from './ModifyPanel'

export default function PropertiesPanel() {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const selectedIds = useEditor((s) => s.selectedIds)
  const commit = useEditor((s) => s.commit)
  const select = useEditor((s) => s.select)

  const single = selectedIds.length === 1 ? findElement(scene, selectedIds[0]) : null

  return (
    <aside
      className="panel"
      style={{
        width: 'var(--w-right-panel)',
        minWidth: 'var(--w-right-panel)',
        borderLeft: '1px solid var(--divider)',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 'var(--h-row)',
          padding: '0 var(--sp-8)',
          flex: 'none',
        }}
      >
        <span className="section-label">{t('properties.title')}</span>
        <span className="spacer" />
        {selectedIds.length > 1 && (
          <span style={{ fontSize: 'var(--fs-label)', color: 'var(--text-dim)' }}>
            {t('properties.multiSelected', { count: selectedIds.length })}
          </span>
        )}
      </div>
      <hr className="divider" />

      {!single && (
        <p
          style={{
            color: 'var(--text-dim)',
            fontSize: 'var(--fs-body)',
            padding: 'var(--sp-12) var(--sp-8)',
            margin: 0,
          }}
        >
          {selectedIds.length > 1 ? t('properties.multiHint') : t('properties.none')}
        </p>
      )}

      {/* The transform verbs work on a multi-selection, so they sit above the per-element editors
          and are the one part of this panel that is useful with several things selected. */}
      <ModifyPanel />

      {single && (
        <>
          <div style={{ padding: 'var(--sp-4) var(--sp-8) 0' }}>
            <div style={{ fontSize: 'var(--fs-heading)', fontWeight: 'var(--fw-medium)' }}>
              {t(`properties.kind.${single.kind}`)}
            </div>
            <div style={{ fontSize: 'var(--fs-label)', color: 'var(--text-dim)' }}>
              {elementLabel(scene, single.id)}
            </div>
          </div>

          <Validation scene={scene} id={single.id} kind={single.kind} />

          {single.kind === 'wall' && <WallProps id={single.id} />}
          {single.kind === 'filling' && <FillingProps id={single.id} />}
          {single.kind === 'opening' && <OpeningProps id={single.id} />}
          {single.kind === 'slab' && <SlabProps id={single.id} />}
          {single.kind === 'room' && <RoomProps id={single.id} />}
          {single.kind === 'column' && <ColumnProps id={single.id} />}
          {single.kind === 'beam' && <BeamProps id={single.id} />}
          {single.kind === 'furniture' && <FurnitureProps id={single.id} />}
          {single.kind === 'annotation' && <AnnotationProps id={single.id} />}
          {single.kind === 'roomTag' && <RoomTagProps id={single.id} />}
          {single.kind === 'dimension' && <DimensionProps id={single.id} />}
          {single.kind === 'columnGrid' && <ColumnGridProps id={single.id} />}
          {single.kind === 'roof' && <RoofProps id={single.id} />}
          {single.kind === 'primitive' && <PrimitiveProps id={single.id} />}
          {single.kind === 'boolean' && <BooleanProps id={single.id} />}
          {single.kind === 'stair' && <StairProps id={single.id} />}
          {single.kind === 'railing' && <RailingProps id={single.id} />}

          <div style={{ padding: 'var(--sp-8)' }}>
            <button
              className="btn btn--danger"
              style={{ width: '100%' }}
              onClick={() => {
                commit('Delete element', (s) => deleteElement(s, single.id))
                select(null)
              }}
            >
              <IconTrash />
              {t('properties.delete')}
            </button>
          </div>
        </>
      )}
    </aside>
  )
}

/** Surface validation errors instead of producing invalid geometry silently. */
function Validation({
  scene,
  id,
  kind,
}: {
  scene: SceneGraph
  id: string
  kind: string
}) {
  let errors: string[] = []
  if (kind === 'wall') {
    const w = scene.walls.find((x) => x.id === id)
    if (w) errors = validateWall(scene, w)
  } else if (kind === 'opening') {
    const o = scene.openings.find((x) => x.id === id)
    if (o) errors = validateOpening(scene, o)
  } else if (kind === 'filling') {
    const f = scene.fillings.find((x) => x.id === id)
    const o = f ? scene.openings.find((x) => x.id === f.openingId) : undefined
    if (o) errors = validateOpening(scene, o)
  }
  if (errors.length === 0) return null

  return (
    <div
      style={{
        margin: 'var(--sp-8)',
        padding: 'var(--sp-8)',
        background: 'color-mix(in srgb, var(--status-error) 12%, transparent)',
        border: '1px solid color-mix(in srgb, var(--status-error) 40%, transparent)',
        borderRadius: 'var(--r-sm)',
        fontSize: 'var(--fs-label)',
        color: 'var(--status-error)',
      }}
    >
      {errors.map((e, i) => (
        <div key={i}>{e}</div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

export function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: 'var(--h-row)',
          padding: '0 var(--sp-8)',
          marginTop: 'var(--sp-8)',
        }}
      >
        <span className="section-label">{label}</span>
      </div>
      <div className="prop-grid">{children}</div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Per-element property editors
// ---------------------------------------------------------------------------

function WallProps({ id }: { id: string }) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const flash = useEditor((s) => s.flash)
  const wall = scene.walls.find((w) => w.id === id)
  if (!wall) return null
  const type = findType(scene, wall.typeId)
  const resolved = resolveWall(scene, wall)
  if (!type || type.category !== 'wall') return null

  return (
    <>
      <Group label={t('properties.typeGroup')}>
        <TypePicker elementId={id} category="wall" typeId={wall.typeId} />
        <NumberField
          label={t('properties.thickness')}
          value={assemblyThickness(type.layers)}
          min={0.01}
          step={0.01}
          hint={t('properties.sharedHint')}
          onCommit={(v) =>
            commit('Set wall thickness', (s) => setWallTypeThickness(s, wall.typeId, v))
          }
        />
        <SelectField
          label={t('properties.function')}
          value={type.function}
          options={[
            { value: 'exterior', label: t('properties.fn.exterior') },
            { value: 'interior', label: t('properties.fn.interior') },
            { value: 'partition', label: t('properties.fn.partition') },
          ]}
          onCommit={(v) =>
            commit('Set wall function', (s) =>
              updateType(s, wall.typeId, { function: v } as Partial<typeof type>),
            )
          }
        />
        <LayerList typeId={wall.typeId} />
      </Group>

      <Group label={t('properties.instanceGroup')}>
        <ReadOnly label={t('properties.length')} value={formatLength(baselineLength(wall.baseline), scene.units)} />
        <ReadOnly
          label={t('properties.height')}
          value={resolved ? formatLength(resolved.height, scene.units) : '—'}
        />
        <TopConstraintField
          value={wall.top}
          levelId={wall.levelId}
          onCommit={(top) => commit('Set wall top', (s) => updateWall(s, id, { top }))}
        />
        <NumberField
          label={t('properties.baseOffset')}
          value={wall.baseOffset}
          step={0.05}
          onCommit={(v) => commit('Set base offset', (s) => updateWall(s, id, { baseOffset: v }))}
        />
        <SelectField
          label={t('properties.locationLine')}
          value={wall.locationLine}
          options={[
            { value: 'centerline', label: t('properties.ll.centerline') },
            { value: 'finish-exterior', label: t('properties.ll.exterior') },
            { value: 'finish-interior', label: t('properties.ll.interior') },
          ]}
          onCommit={(v) =>
            commit('Set location line', (s) =>
              updateWall(s, id, { locationLine: v as typeof wall.locationLine }),
            )
          }
        />
        <CheckField
          label={t('properties.flipped')}
          value={wall.flipped}
          onCommit={(v) => commit('Flip wall', (s) => updateWall(s, id, { flipped: v }))}
        />
        <CheckField
          label={t('properties.roomBounding')}
          value={wall.roomBounding}
          onCommit={(v) => commit('Set room bounding', (s) => updateWall(s, id, { roomBounding: v }))}
        />
        <div className="prop-span">
          <button
            className="btn"
            style={{ width: '100%' }}
            onClick={() => {
              const r = duplicateType(scene, wall.typeId)
              commit('Duplicate type', () => setElementType(r.scene, id, r.id))
              flash(t('properties.typeDuplicated'))
            }}
          >
            <IconPlus />
            {t('properties.duplicateType')}
          </button>
        </div>
      </Group>
    </>
  )
}

function LayerList({ typeId }: { typeId: string }) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const type = findType(scene, typeId)
  if (!type || (type.category !== 'wall' && type.category !== 'slab')) return null

  return (
    <div className="prop-span" style={{ marginTop: 'var(--sp-4)' }}>
      <div className="section-label" style={{ marginBottom: 'var(--sp-2)' }}>
        {t('properties.layers')}
      </div>
      {type.layers.map((l, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-4)',
            height: 20,
            fontSize: 'var(--fs-label)',
            color: 'var(--text-dim)',
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              flex: 'none',
              borderRadius: 2,
              border: '1px solid var(--border-base)',
              background: scene.materials.find((m) => m.id === l.material)?.color ?? '#888',
            }}
          />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {scene.materials.find((m) => m.id === l.material)?.name ?? l.material}
          </span>
          <span className="spacer" />
          <span className="num">{Math.round(l.thickness * 1000)} mm</span>
        </div>
      ))}
    </div>
  )
}

function FillingProps({ id }: { id: string }) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const filling = scene.fillings.find((f) => f.id === id)
  if (!filling) return null
  const type = findType(scene, filling.typeId)
  const opening = scene.openings.find((o) => o.id === filling.openingId)
  if (!type || (type.category !== 'door' && type.category !== 'window') || !opening) return null

  return (
    <>
      <Group label={t('properties.typeGroup')}>
        <TypePicker elementId={id} category={type.category} typeId={filling.typeId} />
        <NumberField
          label={t('properties.width')}
          value={type.width}
          min={0.1}
          step={0.05}
          hint={t('properties.sharedHint')}
          onCommit={(v) =>
            commit('Set width', (s) =>
              syncOpeningToFilling(updateType(s, filling.typeId, { width: v }), id),
            )
          }
        />
        <NumberField
          label={t('properties.height')}
          value={type.height}
          min={0.1}
          step={0.05}
          hint={t('properties.sharedHint')}
          onCommit={(v) =>
            commit('Set height', (s) =>
              syncOpeningToFilling(updateType(s, filling.typeId, { height: v }), id),
            )
          }
        />
        {type.category === 'door' && (
          <SelectField
            label={t('properties.operation')}
            value={type.operation}
            options={[
              { value: 'single-swing', label: t('properties.op.singleSwing') },
              { value: 'double-swing', label: t('properties.op.doubleSwing') },
              { value: 'sliding', label: t('properties.op.sliding') },
              { value: 'folding', label: t('properties.op.folding') },
            ]}
            onCommit={(v) =>
              commit('Set operation', (s) =>
                updateType(s, filling.typeId, { operation: v } as Partial<typeof type>),
              )
            }
          />
        )}
        {type.category === 'window' && (
          <SelectField
            label={t('properties.partitioning')}
            value={type.partitioning}
            options={[
              { value: 'single', label: t('properties.part.single') },
              { value: 'double-vertical', label: t('properties.part.doubleV') },
              { value: 'double-horizontal', label: t('properties.part.doubleH') },
              { value: 'triple-vertical', label: t('properties.part.tripleV') },
            ]}
            onCommit={(v) =>
              commit('Set partitioning', (s) =>
                updateType(s, filling.typeId, { partitioning: v } as Partial<typeof type>),
              )
            }
          />
        )}
      </Group>

      <Group label={t('properties.instanceGroup')}>
        <NumberField
          label={t('properties.offset')}
          value={opening.offset}
          min={0}
          step={0.05}
          onCommit={(v) => commit('Move opening', (s) => updateOpening(s, opening.id, { offset: v }))}
        />
        <NumberField
          label={t('properties.sillHeight')}
          value={opening.sillHeight}
          min={0}
          step={0.05}
          onCommit={(v) => commit('Set sill', (s) => updateOpening(s, opening.id, { sillHeight: v }))}
        />
        <CheckField
          label={t('properties.flippedHand')}
          value={filling.flippedHand}
          onCommit={(v) => commit('Flip hand', (s) => updateFilling(s, id, { flippedHand: v }))}
        />
        <CheckField
          label={t('properties.flippedFacing')}
          value={filling.flippedFacing}
          onCommit={(v) => commit('Flip facing', (s) => updateFilling(s, id, { flippedFacing: v }))}
        />
      </Group>
    </>
  )
}

function OpeningProps({ id }: { id: string }) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const o = scene.openings.find((x) => x.id === id)
  if (!o) return null
  return (
    <Group label={t('properties.instanceGroup')}>
      <NumberField
        label={t('properties.offset')}
        value={o.offset}
        min={0}
        step={0.05}
        onCommit={(v) => commit('Move opening', (s) => updateOpening(s, id, { offset: v }))}
      />
      <NumberField
        label={t('properties.width')}
        value={o.width}
        min={0.05}
        step={0.05}
        onCommit={(v) => commit('Resize opening', (s) => updateOpening(s, id, { width: v }))}
      />
      <NumberField
        label={t('properties.height')}
        value={o.height}
        min={0.05}
        step={0.05}
        onCommit={(v) => commit('Resize opening', (s) => updateOpening(s, id, { height: v }))}
      />
      <NumberField
        label={t('properties.sillHeight')}
        value={o.sillHeight}
        min={0}
        step={0.05}
        onCommit={(v) => commit('Set sill', (s) => updateOpening(s, id, { sillHeight: v }))}
      />
    </Group>
  )
}

function SlabProps({ id }: { id: string }) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const slab = scene.slabs.find((x) => x.id === id)
  if (!slab) return null
  const type = findType(scene, slab.typeId)
  if (!type || type.category !== 'slab') return null

  return (
    <>
      <Group label={t('properties.typeGroup')}>
        <TypePicker elementId={id} category="slab" typeId={slab.typeId} />
        <ReadOnly
          label={t('properties.thickness')}
          value={formatLength(assemblyThickness(type.layers), scene.units)}
        />
        <LayerList typeId={slab.typeId} />
      </Group>
      <Group label={t('properties.instanceGroup')}>
        <NumberField
          label={t('properties.heightOffset')}
          value={slab.heightOffset}
          step={0.05}
          onCommit={(v) => commit('Set slab offset', (s) => updateSlab(s, id, { heightOffset: v }))}
        />
        <ReadOnly label={t('properties.area')} value={`${roomArea(slab.boundary).toFixed(2)} m²`} />
        <ReadOnly
          label={t('properties.perimeter')}
          value={formatLength(polygonPerimeter(slab.boundary), scene.units)}
        />
      </Group>
    </>
  )
}

function RoomProps({ id }: { id: string }) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const room = scene.rooms.find((x) => x.id === id)
  if (!room) return null

  return (
    <Group label={t('properties.instanceGroup')}>
      <TextField
        label={t('properties.name')}
        value={room.name}
        onCommit={(v) => commit('Rename room', (s) => updateRoom(s, id, { name: v }))}
      />
      <TextField
        label={t('properties.number')}
        value={room.number}
        onCommit={(v) => commit('Renumber room', (s) => updateRoom(s, id, { number: v }))}
      />
      <MaterialField
        label={t('properties.floorMaterial')}
        value={room.floorMaterial}
        onCommit={(v) => commit('Set floor material', (s) => updateRoom(s, id, { floorMaterial: v }))}
      />
      <TopConstraintField
        value={room.top}
        levelId={room.levelId}
        onCommit={(top) => commit('Set room top', (s) => updateRoom(s, id, { top }))}
      />
      <ReadOnly label={t('properties.area')} value={`${roomArea(room.polygon).toFixed(2)} m²`} />
      <ReadOnly
        label={t('properties.perimeter')}
        value={formatLength(polygonPerimeter(room.polygon), scene.units)}
      />
    </Group>
  )
}

function ColumnProps({ id }: { id: string }) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const col = scene.columns.find((x) => x.id === id)
  if (!col) return null

  return (
    <>
      <Group label={t('properties.typeGroup')}>
        <TypePicker elementId={id} category="column" typeId={col.typeId} />
      </Group>
      <Group label={t('properties.instanceGroup')}>
        <NumberField
          label={t('properties.rotation')}
          value={col.rotation}
          step={15}
          unit="°"
          onCommit={(v) => commit('Rotate column', (s) => updateColumn(s, id, { rotation: v }))}
        />
        <NumberField
          label={t('properties.baseOffset')}
          value={col.baseOffset}
          step={0.05}
          onCommit={(v) => commit('Set base offset', (s) => updateColumn(s, id, { baseOffset: v }))}
        />
        <TopConstraintField
          value={col.top}
          levelId={col.levelId}
          onCommit={(top) => commit('Set column top', (s) => updateColumn(s, id, { top }))}
        />
      </Group>
    </>
  )
}

function BeamProps({ id }: { id: string }) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const beam = scene.beams.find((x) => x.id === id)
  if (!beam) return null

  return (
    <>
      <Group label={t('properties.typeGroup')}>
        <TypePicker elementId={id} category="beam" typeId={beam.typeId} />
      </Group>
      <Group label={t('properties.instanceGroup')}>
        <NumberField
          label={t('properties.heightOffset')}
          value={beam.heightOffset}
          step={0.05}
          onCommit={(v) => commit('Set beam height', (s) => updateBeam(s, id, { heightOffset: v }))}
        />
        <NumberField
          label={t('properties.crossSectionRotation')}
          value={beam.crossSectionRotation}
          step={15}
          unit="°"
          onCommit={(v) =>
            commit('Rotate section', (s) => updateBeam(s, id, { crossSectionRotation: v }))
          }
        />
      </Group>
    </>
  )
}

function FurnitureProps({ id }: { id: string }) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const f = scene.furniture.find((x) => x.id === id)
  if (!f) return null

  return (
    <Group label={t('properties.instanceGroup')}>
      <NumberField
        label={t('properties.rotation')}
        value={f.rotation}
        step={15}
        unit="°"
        onCommit={(v) => commit('Rotate furniture', (s) => updateFurniture(s, id, { rotation: v }))}
      />
      <NumberField
        label={t('properties.scale')}
        value={f.scale}
        min={0.1}
        step={0.1}
        onCommit={(v) => commit('Scale furniture', (s) => updateFurniture(s, id, { scale: v }))}
      />
      <NumberField
        label={t('properties.heightOffset')}
        value={f.heightOffset}
        step={0.05}
        onCommit={(v) => commit('Set height', (s) => updateFurniture(s, id, { heightOffset: v }))}
      />
    </Group>
  )
}

function AnnotationProps({ id }: { id: string }) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const ann = scene.annotations.find((x) => x.id === id)
  if (!ann) return null

  return (
    <Group label={t('properties.instanceGroup')}>
      <TextField
        label={t('properties.text')}
        value={ann.text}
        onCommit={(v) => commit('Edit text', (s) => updateAnnotation(s, id, { text: v }))}
      />
      <SelectField
        label={t('properties.kindGroup')}
        value={ann.kind}
        options={[
          { value: 'text', label: t('properties.kind.annotation') },
          { value: 'label', label: t('properties.annotationLabel') },
          { value: 'leader', label: t('properties.annotationLeader') },
        ]}
        onCommit={(v) =>
          commit('Set annotation kind', (s) =>
            updateAnnotation(s, id, { kind: v as (typeof ann)['kind'] }),
          )
        }
      />
      <NumberField
        label={t('properties.rotation')}
        value={ann.rotation}
        step={15}
        unit="°"
        onCommit={(v) => commit('Rotate text', (s) => updateAnnotation(s, id, { rotation: v }))}
      />
      <NumberField
        label={t('properties.textHeight')}
        value={ann.textHeight}
        min={0.02}
        step={0.02}
        onCommit={(v) => commit('Set text height', (s) => updateAnnotation(s, id, { textHeight: v }))}
      />
    </Group>
  )
}

function RoomTagProps({ id }: { id: string }) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const tag = scene.roomTags.find((x) => x.id === id)
  if (!tag) return null

  return (
    <Group label={t('properties.instanceGroup')}>
      <CheckField
        label={t('properties.showName')}
        value={tag.showName}
        onCommit={(v) => commit('Toggle tag field', (s) => updateRoomTag(s, id, { showName: v }))}
      />
      <CheckField
        label={t('properties.showNumber')}
        value={tag.showNumber}
        onCommit={(v) => commit('Toggle tag field', (s) => updateRoomTag(s, id, { showNumber: v }))}
      />
      <CheckField
        label={t('properties.showArea')}
        value={tag.showArea}
        onCommit={(v) => commit('Toggle tag field', (s) => updateRoomTag(s, id, { showArea: v }))}
      />
    </Group>
  )
}

function DimensionProps({ id }: { id: string }) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const dim = scene.dimensions.find((x) => x.id === id)
  if (!dim) return null

  return (
    <Group label={t('properties.instanceGroup')}>
      <ReadOnly label={t('properties.dimensionKind')} value={dim.kind} />
      <NumberField
        label={t('properties.offsetDistance')}
        value={dim.offsetDistance}
        step={0.05}
        onCommit={(v) => commit('Set dimension offset', (s) => updateDimension(s, id, { offsetDistance: v }))}
      />
      <NumberField
        label={t('properties.witnessGap')}
        value={dim.witnessGap}
        min={0}
        step={0.01}
        onCommit={(v) => commit('Set witness gap', (s) => updateDimension(s, id, { witnessGap: v }))}
      />
    </Group>
  )
}

function ColumnGridProps({ id }: { id: string }) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const grid = scene.columnGrids.find((g) => g.id === id)
  if (!grid) return null

  return (
    <>
      <Group label={t('properties.instanceGroup')}>
        <TextField
          label={t('properties.gridName')}
          value={grid.name}
          onCommit={(v) => commit('Rename grid', (s) => updateColumnGrid(s, id, { name: v }))}
        />
        <NumberField
          label={t('properties.rotation')}
          value={grid.rotation}
          step={5}
          unit="°"
          onCommit={(v) => commit('Rotate grid', (s) => updateColumnGrid(s, id, { rotation: v }))}
        />
        <NumberField
          label={t('properties.gridExtension')}
          value={grid.extension}
          min={0}
          step={0.05}
          onCommit={(v) => commit('Set grid extension', (s) => updateColumnGrid(s, id, { extension: v }))}
        />
        <NumberField
          label={t('properties.gridBubbleRadius')}
          value={grid.bubbleRadius}
          min={0.05}
          step={0.05}
          onCommit={(v) => commit('Set bubble size', (s) => updateColumnGrid(s, id, { bubbleRadius: v }))}
        />
      </Group>

      <GridAxisGroup gridId={id} direction="x" label={t('properties.gridXAxes')} />
      <GridAxisGroup gridId={id} direction="y" label={t('properties.gridYAxes')} />
    </>
  )
}

function GridAxisGroup({
  gridId,
  direction,
  label,
}: {
  gridId: string
  direction: 'x' | 'y'
  label: string
}) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const grid = scene.columnGrids.find((g) => g.id === gridId)
  if (!grid) return null
  const axes = direction === 'x' ? grid.xAxes : grid.yAxes

  return (
    <Group label={label}>
      {axes.map((axis, i) => (
        <div key={axis.id} style={{ display: 'contents' }}>
          <TextField
            label={`${i + 1}`}
            value={axis.label}
            onCommit={(v) =>
              commit('Rename axis', (s) => updateGridAxis(s, gridId, direction, axis.id, { label: v }))
            }
          />
          {i === 0 ? (
            <ReadOnly label={t('properties.gridSpacing')} value="—" />
          ) : (
            <NumberField
              label={t('properties.gridSpacing')}
              value={axis.spacing}
              min={0.01}
              step={0.1}
              onCommit={(v) =>
                commit('Set axis spacing', (s) =>
                  updateGridAxis(s, gridId, direction, axis.id, { spacing: v }),
                )
              }
            />
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 'var(--sp-4)', gridColumn: '1 / -1' }}>
        <button
          className="btn"
          style={{ flex: 1 }}
          onClick={() => commit('Add axis', (s) => addGridAxis(s, gridId, direction, 5))}
        >
          {t('properties.gridAddAxis')}
        </button>
        <button
          className="btn"
          style={{ flex: 1 }}
          onClick={() => commit('Remove axis', (s) => removeLastGridAxis(s, gridId, direction))}
        >
          {t('properties.gridRemoveAxis')}
        </button>
      </div>
    </Group>
  )
}

function RoofProps({ id }: { id: string }) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const roof = scene.roofs.find((r) => r.id === id)
  if (!roof) return null
  const resolved = resolveRoof(roof)

  return (
    <>
      <Group label={t('properties.instanceGroup')}>
        <NumberField
          label={t('properties.roofAngle')}
          value={roof.edges[0]?.angle ?? 30}
          min={1}
          max={89}
          step={1}
          unit="°"
          onCommit={(v) => commit('Set roof angle', (s) => setRoofUniformEdge(s, id, { angle: v }))}
        />
        <NumberField
          label={t('properties.roofOverhang')}
          value={roof.edges[0]?.overhang ?? 0}
          min={0}
          step={0.05}
          onCommit={(v) => commit('Set roof overhang', (s) => setRoofUniformEdge(s, id, { overhang: v }))}
        />
        <NumberField
          label={t('properties.roofBaseHeight')}
          value={roof.baseHeight}
          step={0.05}
          onCommit={(v) => commit('Set roof base height', (s) => updateRoof(s, id, { baseHeight: v }))}
        />
      </Group>
      {isRoofError(resolved) && (
        <p style={{ color: 'var(--status-error)', fontSize: 'var(--fs-label)', padding: '0 var(--sp-8)' }}>
          {t('properties.roofError')}: {resolved.error}
        </p>
      )}
    </>
  )
}

/**
 * Stair (B2). `desiredNumberOfRisers` is what the user sets; `actualRiserHeight` is DERIVED and
 * shown read-only, so it is never possible for the two to drift apart in the UI the way they
 * cannot in the schema either (see shared/geometry/stair.ts). Blondel comfort feedback and any
 * geometric refusal both surface as the same issues list — feedback, not a hard block.
 */
function StairProps({ id }: { id: string }) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const stair = scene.stairs.find((x) => x.id === id)
  if (!stair) return null
  const resolved = resolveStair(scene, stair)
  const issues = validateStair(scene, stair)

  return (
    <>
      <Group label={t('properties.instanceGroup')}>
        <NumberField
          label={t('properties.desiredRisers')}
          value={stair.desiredNumberOfRisers}
          min={2}
          step={1}
          onCommit={(v) =>
            commit('Set riser count', (s) =>
              updateStair(s, id, { desiredNumberOfRisers: Math.round(v) }),
            )
          }
        />
        <ReadOnly
          label={t('properties.actualRiserHeight')}
          value={resolved ? formatLength(resolved.actualRiserHeight, scene.units) : '—'}
        />
        <NumberField
          label={t('properties.baseOffset')}
          value={stair.baseOffset}
          step={0.05}
          onCommit={(v) => commit('Set stair base offset', (s) => updateStair(s, id, { baseOffset: v }))}
        />
        <TopConstraintField
          value={stair.top}
          levelId={stair.levelId}
          onCommit={(top) => commit('Set stair top', (s) => updateStair(s, id, { top }))}
        />
      </Group>
      {issues.length > 0 && (
        <p style={{ color: 'var(--status-error)', fontSize: 'var(--fs-label)', padding: '0 var(--sp-8)' }}>
          {issues.join(' · ')}
        </p>
      )}
    </>
  )
}

/** Railing (B3): a continuous rail plus posts along an open path. */
function RailingProps({ id }: { id: string }) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const railing = scene.railings.find((x) => x.id === id)
  if (!railing) return null
  const resolved = resolveRailing(scene, railing)
  const issues = validateRailing(scene, railing)

  return (
    <>
      <Group label={t('properties.instanceGroup')}>
        <NumberField
          label={t('properties.baseOffset')}
          value={railing.baseOffset}
          step={0.05}
          onCommit={(v) =>
            commit('Set railing base offset', (s) => updateRailing(s, id, { baseOffset: v }))
          }
        />
        <ReadOnly label={t('properties.pathPoints')} value={String(railing.path.length)} />
        <ReadOnly
          label={t('properties.length')}
          value={resolved ? formatLength(resolved.totalLength, scene.units) : '—'}
        />
      </Group>
      {issues.length > 0 && (
        <p style={{ color: 'var(--status-error)', fontSize: 'var(--fs-label)', padding: '0 var(--sp-8)' }}>
          {issues.join(' · ')}
        </p>
      )}
    </>
  )
}

/**
 * Primitive solid (B7). Shape parameters live on the TYPE, so editing them updates every instance
 * of that type — the defining BIM interaction (D-009). That is flagged in the UI rather than left
 * as a surprise, the same way the wall-thickness handle is (D1).
 */
function PrimitiveProps({ id }: { id: string }) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const primitive = scene.primitives.find((p) => p.id === id)
  if (!primitive) return null
  const type = findPrimitiveType(scene, primitive.typeId)
  const error = primitiveErrorMessage(scene, id)

  /** Patch one field of the type's shape, preserving its discriminant. */
  const setShape = (patch: Record<string, number>) => {
    if (!type) return
    commit('Set shape', (s) =>
      updateType(s, type.id, { shape: { ...type.shape, ...patch } }),
    )
  }

  const shape = type?.shape

  return (
    <>
      {shape && (
        <Group label={`${t('properties.typeGroup')} — ${t('properties.primitiveShape')}`}>
          <span className="prop-label" style={{ gridColumn: '1 / -1', opacity: 0.7 }}>
            {t('properties.sharedHint')}
          </span>
          {(shape.kind === 'box' || shape.kind === 'wedge') && (
            <>
              <NumberField
                label={t('properties.width')}
                value={shape.width}
                min={0.001}
                onCommit={(v) => setShape({ width: v })}
              />
              <NumberField
                label={t('properties.depth')}
                value={shape.depth}
                min={0.001}
                onCommit={(v) => setShape({ depth: v })}
              />
              <NumberField
                label={t('properties.height')}
                value={shape.height}
                min={0.001}
                onCommit={(v) => setShape({ height: v })}
              />
            </>
          )}
          {(shape.kind === 'cylinder' || shape.kind === 'cone') && (
            <>
              <NumberField
                label={t('properties.radius')}
                value={shape.radius}
                min={0.001}
                onCommit={(v) => setShape({ radius: v })}
              />
              <NumberField
                label={t('properties.height')}
                value={shape.height}
                min={0.001}
                onCommit={(v) => setShape({ height: v })}
              />
              <NumberField
                label={t('properties.segments')}
                value={shape.segments}
                min={3}
                max={256}
                step={1}
                onCommit={(v) => setShape({ segments: Math.round(v) })}
              />
            </>
          )}
          {shape.kind === 'sphere' && (
            <>
              <NumberField
                label={t('properties.radius')}
                value={shape.radius}
                min={0.001}
                onCommit={(v) => setShape({ radius: v })}
              />
              <NumberField
                label={t('properties.segments')}
                value={shape.segments}
                min={4}
                max={256}
                step={1}
                onCommit={(v) => setShape({ segments: Math.round(v) })}
              />
            </>
          )}
          {shape.kind === 'prism' && (
            <>
              <NumberField
                label={t('properties.radius')}
                value={shape.radius}
                min={0.001}
                onCommit={(v) => setShape({ radius: v })}
              />
              <NumberField
                label={t('properties.height')}
                value={shape.height}
                min={0.001}
                onCommit={(v) => setShape({ height: v })}
              />
              <NumberField
                label={t('properties.sides')}
                value={shape.sides}
                min={3}
                max={256}
                step={1}
                onCommit={(v) => setShape({ sides: Math.round(v) })}
              />
            </>
          )}
          {shape.kind === 'torus' && (
            <>
              <NumberField
                label={t('properties.radius')}
                value={shape.radius}
                min={0.001}
                onCommit={(v) => setShape({ radius: v })}
              />
              <NumberField
                label={t('properties.tubeRadius')}
                value={shape.tubeRadius}
                min={0.001}
                onCommit={(v) => setShape({ tubeRadius: v })}
              />
              <NumberField
                label={t('properties.radialSegments')}
                value={shape.radialSegments}
                min={3}
                max={256}
                step={1}
                onCommit={(v) => setShape({ radialSegments: Math.round(v) })}
              />
              <NumberField
                label={t('properties.tubularSegments')}
                value={shape.tubularSegments}
                min={3}
                max={256}
                step={1}
                onCommit={(v) => setShape({ tubularSegments: Math.round(v) })}
              />
            </>
          )}
        </Group>
      )}

      <Group label={t('properties.instanceGroup')}>
        <NumberField
          label={t('properties.heightOffset')}
          value={primitive.heightOffset}
          step={0.05}
          onCommit={(v) =>
            commit('Set shape elevation', (s) => updatePrimitive(s, id, { heightOffset: v }))
          }
        />
        <NumberField
          label={t('properties.rotation')}
          value={primitive.rotation}
          step={5}
          unit="°"
          onCommit={(v) => commit('Rotate shape', (s) => updatePrimitive(s, id, { rotation: v }))}
        />
        <NumberField
          label={t('properties.scale')}
          value={primitive.scale}
          min={0.001}
          step={0.1}
          onCommit={(v) => commit('Scale shape', (s) => updatePrimitive(s, id, { scale: v }))}
        />
      </Group>

      {error && (
        <p
          style={{
            color: 'var(--status-error)',
            fontSize: 'var(--fs-label)',
            padding: '0 var(--sp-8)',
          }}
        >
          {t('properties.primitiveError')}: {error}
        </p>
      )}
    </>
  )
}

/**
 * A boolean result. The operation is editable in place — switching a cut to a union re-evaluates
 * from the same stored tree, which is the whole reason the tree rather than the mesh is what the
 * scene graph holds (D-019). The operands are listed read-only; they are changed by exploding and
 * re-combining, which keeps the tree edit paths down to one.
 */
function BooleanProps({ id }: { id: string }) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const node = scene.booleans.find((b) => b.id === id)
  if (!node) return null
  const resolved = resolveBooleanNode(scene, id)

  return (
    <>
      <Group label={t('properties.instanceGroup')}>
        <label className="prop-label" htmlFor="boolean-op">
          {t('properties.booleanOp')}
        </label>
        <select
          id="boolean-op"
          className="select"
          value={node.op}
          onChange={(e) =>
            commit('Set boolean operation', (s) =>
              updateBooleanNode(s, id, { op: e.target.value as BooleanOp }),
            )
          }
        >
          <option value="union">{t('properties.booleanUnion')}</option>
          <option value="cut">{t('properties.booleanCut')}</option>
          <option value="intersect">{t('properties.booleanIntersect')}</option>
        </select>
        <span className="prop-label">{t('properties.booleanOperands')}</span>
        <span className="prop-value">{node.operandIds.length}</span>
      </Group>
      {isBooleanTreeError(resolved) && (
        <p
          style={{
            color: 'var(--status-error)',
            fontSize: 'var(--fs-label)',
            padding: '0 var(--sp-8)',
          }}
        >
          {t('properties.booleanError')}: {resolved.error}
        </p>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Field primitives
// ---------------------------------------------------------------------------

/**
 * Numeric field with the four things architects expect: unit-aware expression parsing,
 * drag-to-scrub on the label, arrow-key stepping, and tabular numerals.
 */
export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 0.01,
  unit,
  hint,
}: {
  label: string
  value: number
  onCommit: (v: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  hint?: string
}) {
  const units = useEditor((s) => s.scene.units)
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState(false)
  const drag = useRef<{ x: number; start: number } | null>(null)

  const display = text === '' ? formatNumber(value) : text
  useEffect(() => {
    if (drag.current === null) setText('')
  }, [value])

  const clamp = (v: number): number => {
    let out = v
    if (min !== undefined) out = Math.max(min, out)
    if (max !== undefined) out = Math.min(max, out)
    return out
  }

  const apply = () => {
    if (text === '') return
    // Angles and scales are plain numbers; lengths go through unit-aware parsing.
    const parsed = unit === '°' ? Number(text) : parseLengthInput(text, units)
    if (parsed === null || !Number.isFinite(parsed)) {
      setInvalid(true)
      setTimeout(() => setInvalid(false), 600)
      setText('')
      return
    }
    const next = clamp(parsed)
    if (Math.abs(next - value) > 1e-9) onCommit(next)
    setText('')
  }

  // Drag-to-scrub with a modifier ladder: plain ±step, Shift ×10, Alt ÷10.
  const onLabelDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, start: value }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onLabelMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    const delta = (e.clientX - drag.current.x) * step * mult
    onCommit(clamp(drag.current.start + delta))
  }
  const onLabelUp = (e: React.PointerEvent) => {
    drag.current = null
    try {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }

  return (
    <>
      <span
        className="prop-label"
        title={hint ? `${label} — ${hint}` : label}
        style={{ cursor: 'ew-resize' }}
        onPointerDown={onLabelDown}
        onPointerMove={onLabelMove}
        onPointerUp={onLabelUp}
      >
        {label}
        {unit ? ` (${unit})` : ''}
      </span>
      <input
        className={`input input--num ${invalid ? 'input--invalid' : ''}`}
        value={display}
        onChange={(e) => setText(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            apply()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setText('')
            e.currentTarget.blur()
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const dir = e.key === 'ArrowUp' ? 1 : -1
            const mult = e.shiftKey ? 10 : 1
            onCommit(clamp(value + dir * step * mult))
            setText('')
          }
        }}
      />
    </>
  )
}

function formatNumber(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4)))
}

function TextField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: string
  onCommit: (v: string) => void
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const apply = () => {
    const trimmed = text.trim()
    if (trimmed && trimmed !== value) onCommit(trimmed)
    else setText(value)
  }
  return (
    <>
      <span className="prop-label">{label}</span>
      <input
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            apply()
            e.currentTarget.blur()
          }
        }}
      />
    </>
  )
}

function SelectField({
  label,
  value,
  options,
  onCommit,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onCommit: (v: string) => void
}) {
  return (
    <>
      <span className="prop-label">{label}</span>
      <select className="select" value={value} onChange={(e) => onCommit(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  )
}

export function CheckField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: boolean
  onCommit: (v: boolean) => void
}) {
  return (
    <>
      <span className="prop-label">{label}</span>
      <input
        className="check"
        type="checkbox"
        checked={value}
        onChange={(e) => onCommit(e.target.checked)}
      />
    </>
  )
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="prop-label">{label}</span>
      <span className="prop-value prop-readonly">{value}</span>
    </>
  )
}

function MaterialField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: string
  onCommit: (v: string) => void
}) {
  const materials = useEditor((s) => s.scene.materials)
  return (
    <>
      <span className="prop-label">{label}</span>
      <select className="select" value={value} onChange={(e) => onCommit(e.target.value)}>
        {materials.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </>
  )
}

function TypePicker({
  elementId,
  category,
  typeId,
}: {
  elementId: string
  category: string
  typeId: string
}) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const commit = useEditor((s) => s.commit)
  const options = scene.types.filter((tp) => tp.category === category)
  return (
    <>
      <span className="prop-label">{t('properties.type')}</span>
      <select
        className="select"
        value={typeId}
        onChange={(e) =>
          commit('Change type', (s) => setElementType(s, elementId, e.target.value))
        }
      >
        {options.map((tp) => (
          <option key={tp.id} value={tp.id}>
            {tp.name}
          </option>
        ))}
      </select>
    </>
  )
}

/**
 * The Top Constraint editor — a level reference (which tracks storey height changes) or an
 * unconnected fixed height (which does not). This union is what makes multi-storey editing behave.
 */
function TopConstraintField({
  value,
  levelId,
  onCommit,
}: {
  value: TopConstraint
  levelId: string
  onCommit: (t: TopConstraint) => void
}) {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const levels = [...scene.levels].sort((a, b) => a.elevation - b.elevation)
  const base = findLevel(scene, levelId)

  // A roof-attached top is set by the "Void to roof" verb (Modify panel), not from here — this
  // field only shows what it is attached to and lets you detach. See DECISIONS.md D-020.
  if (value.kind === 'roof') {
    const roof = scene.roofs.find((r) => r.id === value.roofId)
    return (
      <>
        <span className="prop-label">{t('properties.topConstraint')}</span>
        <span className="prop-value">
          {roof ? `${t('properties.attachedToRoof')} — ${elementLabel(scene, roof.id)}` : t('properties.attachedToRoof')}
        </span>
        <span />
        <button
          className="btn"
          onClick={() => onCommit({ kind: 'unconnected', height: base?.height ?? 2.8 })}
        >
          {t('properties.detachFromRoof')}
        </button>
      </>
    )
  }

  return (
    <>
      <span className="prop-label">{t('properties.topConstraint')}</span>
      <select
        className="select"
        value={value.kind === 'unconnected' ? 'unconnected' : value.levelId}
        onChange={(e) => {
          if (e.target.value === 'unconnected') {
            onCommit({ kind: 'unconnected', height: base?.height ?? 2.8 })
          } else {
            onCommit({ kind: 'level', levelId: e.target.value, offset: 0 })
          }
        }}
      >
        <option value="unconnected">{t('properties.unconnected')}</option>
        {levels
          .filter((l) => !base || l.elevation > base.elevation)
          .map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
      </select>

      {value.kind === 'unconnected' ? (
        <NumberField
          label={t('properties.unconnectedHeight')}
          value={value.height}
          min={0.1}
          step={0.1}
          onCommit={(v) => onCommit({ kind: 'unconnected', height: v })}
        />
      ) : (
        <NumberField
          label={t('properties.topOffset')}
          value={value.offset}
          step={0.05}
          onCommit={(v) => onCommit({ kind: 'level', levelId: value.levelId, offset: v })}
        />
      )}
    </>
  )
}
