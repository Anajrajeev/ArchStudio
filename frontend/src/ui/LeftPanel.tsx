/**
 * Left panel: Levels + the model tree. Snaptrude's arrangement — the left panel is for views and
 * storeys, not tools — maps directly onto multi-storey architectural work.
 *
 * Double-clicking a level activates it, moving the work plane and camera together (FreeCAD's
 * double-click-a-BuildingPart). Per-level Isolate / cut / ghost are the three orthogonal
 * visibility systems real BIM needs.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditor } from '../scene/store'
import { addLevel, deleteElement, elementLabel, restackLevels, updateLevel } from '../scene/mutations'
import type { ElementKind } from '../scene/mutations'
import { roomArea } from '../../../shared/geometry/index'
import {
  IconPlus,
  IconTrash,
  IconChevronDown,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconLayers,
  IconWall,
  IconSlab,
  IconRoom,
  IconDoor,
  IconWindow,
  IconColumn,
  IconBeam,
} from './Icons'

export default function LeftPanel() {
  return (
    <aside
      className="panel"
      style={{
        width: 'var(--w-left-panel)',
        minWidth: 'var(--w-left-panel)',
        borderRight: '1px solid var(--divider)',
      }}
    >
      <LevelsSection />
      <hr className="divider" />
      <ModelTreeSection />
    </aside>
  )
}

function SectionHeader({
  label,
  open,
  onToggle,
  action,
}: {
  label: string
  open: boolean
  onToggle: () => void
  action?: React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-4)',
        height: 'var(--h-row)',
        padding: '0 var(--sp-4) 0 var(--sp-8)',
        flex: 'none',
      }}
    >
      <button
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', color: 'var(--text-dim)' }}
        aria-expanded={open}
      >
        {open ? <IconChevronDown /> : <IconChevronRight />}
        <span className="section-label">{label}</span>
      </button>
      <span className="spacer" />
      {action}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

function LevelsSection() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const scene = useEditor((s) => s.scene)
  const activeLevelId = useEditor((s) => s.activeLevelId)
  const setActiveLevel = useEditor((s) => s.setActiveLevel)
  const commit = useEditor((s) => s.commit)
  const isolateLevel = useEditor((s) => s.isolateLevel)
  const toggleIsolateLevel = useEditor((s) => s.toggleIsolateLevel)
  const cutViewEnabled = useEditor((s) => s.cutViewEnabled)
  const toggleCutView = useEditor((s) => s.toggleCutView)
  const ghostBelowEnabled = useEditor((s) => s.ghostBelowEnabled)
  const toggleGhostBelow = useEditor((s) => s.toggleGhostBelow)
  const flash = useEditor((s) => s.flash)

  const levels = useMemo(
    () => [...scene.levels].sort((a, b) => b.elevation - a.elevation), // top-down, like a section
    [scene.levels],
  )

  const onAdd = () => {
    let newId = ''
    commit('Add level', (s) => {
      const next = addLevel(s)
      newId = next.levels[next.levels.length - 1].id
      return next
    })
    if (newId) setActiveLevel(newId)
  }

  const onDelete = (id: string) => {
    if (scene.levels.length <= 1) {
      flash('A project needs at least one level', 'error')
      return
    }
    const remaining = scene.levels.filter((l) => l.id !== id)
    commit('Delete level', (s) => deleteElement(s, id))
    if (activeLevelId === id && remaining[0]) setActiveLevel(remaining[0].id)
  }

  return (
    <div style={{ flex: 'none', display: 'flex', flexDirection: 'column' }}>
      <SectionHeader
        label={t('levels.title')}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        action={
          <button className="icon-btn tip" data-tip={t('levels.add')} onClick={onAdd} aria-label={t('levels.add')}>
            <IconPlus />
          </button>
        }
      />
      {open && (
        <>
          <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}>
            {levels.map((level) => {
              const active = level.id === activeLevelId
              return (
                <div
                  key={level.id}
                  className={`tree-row ${active ? 'tree-row--selected' : ''}`}
                  onClick={() => setActiveLevel(level.id)}
                  onDoubleClick={() => setActiveLevel(level.id)}
                  title={`${level.name} — elevation ${level.elevation.toFixed(3)} m`}
                >
                  <IconLayers style={{ color: active ? 'var(--text-accent)' : 'var(--icon-default)' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{level.name}</span>
                  <span className="spacer" />
                  <span
                    className="num"
                    style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-label)' }}
                  >
                    {level.elevation >= 0 ? '+' : ''}
                    {level.elevation.toFixed(2)}
                  </span>
                  <button
                    className="icon-btn"
                    style={{ width: 18, height: 18 }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(level.id)
                    }}
                    aria-label={t('levels.delete')}
                  >
                    <IconTrash width={12} height={12} />
                  </button>
                </div>
              )
            })}
          </div>

          {/* Active-level height, which re-stacks the building above it */}
          <ActiveLevelHeight />

          <div style={{ padding: '0 var(--sp-8) var(--sp-8)', display: 'grid', gap: 'var(--sp-4)' }}>
            <Toggle
              label={t('levels.isolate')}
              checked={isolateLevel}
              onChange={toggleIsolateLevel}
            />
            <Toggle label={t('levels.cutView')} checked={cutViewEnabled} onChange={toggleCutView} />
            <Toggle
              label={t('levels.ghostBelow')}
              checked={ghostBelowEnabled}
              onChange={toggleGhostBelow}
            />
          </div>
        </>
      )}
    </div>
  )
}

function ActiveLevelHeight() {
  const { t } = useTranslation()
  const scene = useEditor((s) => s.scene)
  const activeLevelId = useEditor((s) => s.activeLevelId)
  const commit = useEditor((s) => s.commit)
  const level = scene.levels.find((l) => l.id === activeLevelId)
  const [text, setText] = useState('')

  const value = level ? level.height.toFixed(2) : ''
  const shown = text === '' ? value : text

  if (!level) return null

  const apply = () => {
    const v = Number(shown)
    if (!Number.isFinite(v) || v <= 0) {
      setText('')
      return
    }
    // Changing a storey height must re-stack the levels above it, or the building overlaps.
    commit('Set level height', (s) => restackLevels(updateLevel(s, level.id, { height: v })))
    setText('')
  }

  return (
    <div className="prop-grid" style={{ paddingTop: 0, paddingBottom: 'var(--sp-8)' }}>
      <span className="prop-label">{t('properties.storeyHeight')}</span>
      <input
        className="input input--num"
        type="number"
        step={0.1}
        min={0.1}
        value={shown}
        onChange={(e) => setText(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
      />
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-8)',
        fontSize: 'var(--fs-body)',
        color: 'var(--text-dim)',
        cursor: 'pointer',
      }}
    >
      <input className="check" type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  )
}

// ---------------------------------------------------------------------------
// Model tree
// ---------------------------------------------------------------------------

const KIND_ICON: Partial<Record<ElementKind, React.ReactNode>> = {
  wall: <IconWall />,
  slab: <IconSlab />,
  room: <IconRoom />,
  column: <IconColumn />,
  beam: <IconBeam />,
}

function ModelTreeSection() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const scene = useEditor((s) => s.scene)
  const activeLevelId = useEditor((s) => s.activeLevelId)
  const selectedIds = useEditor((s) => s.selectedIds)
  const select = useEditor((s) => s.select)
  const setHovered = useEditor((s) => s.setHovered)

  /** Group the active level's elements by kind, so the tree stays readable at scale. */
  const groups = useMemo(() => {
    const wallIds = new Set(scene.walls.filter((w) => w.levelId === activeLevelId).map((w) => w.id))
    const openingsOnLevel = scene.openings.filter((o) => wallIds.has(o.hostId))
    const openingIds = new Set(openingsOnLevel.map((o) => o.id))

    const doors: string[] = []
    const windows: string[] = []
    for (const f of scene.fillings) {
      if (!openingIds.has(f.openingId)) continue
      const type = scene.types.find((tp) => tp.id === f.typeId)
      if (type?.category === 'door') doors.push(f.id)
      else windows.push(f.id)
    }

    return [
      { key: 'walls', label: t('tree.walls'), kind: 'wall' as ElementKind, ids: [...wallIds] },
      { key: 'doors', label: t('tree.doors'), kind: 'filling' as ElementKind, ids: doors },
      { key: 'windows', label: t('tree.windows'), kind: 'filling' as ElementKind, ids: windows },
      {
        key: 'slabs',
        label: t('tree.slabs'),
        kind: 'slab' as ElementKind,
        ids: scene.slabs.filter((s) => s.levelId === activeLevelId).map((s) => s.id),
      },
      {
        key: 'rooms',
        label: t('tree.rooms'),
        kind: 'room' as ElementKind,
        ids: scene.rooms.filter((r) => r.levelId === activeLevelId).map((r) => r.id),
      },
      {
        key: 'columns',
        label: t('tree.columns'),
        kind: 'column' as ElementKind,
        ids: scene.columns.filter((c) => c.levelId === activeLevelId).map((c) => c.id),
      },
      {
        key: 'beams',
        label: t('tree.beams'),
        kind: 'beam' as ElementKind,
        ids: scene.beams.filter((b) => b.levelId === activeLevelId).map((b) => b.id),
      },
    ].filter((g) => g.ids.length > 0)
  }, [scene, activeLevelId, t])

  const totalArea = useMemo(
    () =>
      scene.rooms
        .filter((r) => r.levelId === activeLevelId)
        .reduce((sum, r) => sum + roomArea(r.polygon), 0),
    [scene.rooms, activeLevelId],
  )

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <SectionHeader label={t('tree.title')} open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 var(--sp-4) var(--sp-8)' }}>
          {groups.length === 0 && (
            <p
              style={{
                color: 'var(--text-dim)',
                fontSize: 'var(--fs-body)',
                padding: 'var(--sp-4) var(--sp-8)',
                margin: 0,
              }}
            >
              {t('tree.empty')}
            </p>
          )}
          {groups.map((g) => {
            const isCollapsed = collapsed[g.key]
            return (
              <div key={g.key}>
                <button
                  className="tree-row"
                  style={{ width: '100%', color: 'var(--text-dim)' }}
                  onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))}
                  aria-expanded={!isCollapsed}
                >
                  {isCollapsed ? <IconChevronRight /> : <IconChevronDown />}
                  <span className="section-label">{g.label}</span>
                  <span className="spacer" />
                  <span className="num" style={{ fontSize: 'var(--fs-label)' }}>
                    {g.ids.length}
                  </span>
                </button>
                {!isCollapsed &&
                  g.ids.map((id) => (
                    <div
                      key={id}
                      className={`tree-row ${selectedIds.includes(id) ? 'tree-row--selected' : ''}`}
                      style={{ paddingLeft: 26 }}
                      onClick={(e) => select(id, e.shiftKey)}
                      onMouseEnter={() => setHovered(id)}
                      onMouseLeave={() => setHovered(null)}
                      title={elementLabel(scene, id)}
                    >
                      <span style={{ color: 'var(--icon-default)', display: 'flex' }}>
                        {KIND_ICON[g.kind] ?? (g.key === 'doors' ? <IconDoor /> : <IconWindow />)}
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {elementLabel(scene, id)}
                      </span>
                    </div>
                  ))}
              </div>
            )
          })}
        </div>
      )}

      {totalArea > 0 && (
        <>
          <hr className="divider" />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              height: 'var(--h-row)',
              padding: '0 var(--sp-8)',
              fontSize: 'var(--fs-body)',
              color: 'var(--text-dim)',
              flex: 'none',
            }}
          >
            {t('tree.levelArea')}
            <span className="spacer" />
            <span className="num" style={{ color: 'var(--text-default)' }}>
              {totalArea.toFixed(2)} m²
            </span>
          </div>
        </>
      )}
    </div>
  )
}

export { IconEye, IconEyeOff }
