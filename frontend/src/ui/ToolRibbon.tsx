/**
 * Tool ribbon: icon-only buttons with tooltips, grouped by whitespace rather than dividers.
 * Architecture/BIM tools put tools on TOP (Snaptrude, SketchUp, Revit); the left panel is for
 * levels and the model tree.
 *
 * The type selector sits next to the tools so "which wall type am I drawing" is always visible —
 * this is Revit's Options Bar idea, and it's what stops the ribbon feeling like a toy palette.
 */
import { useTranslation } from 'react-i18next'
import { useEditor, type Tool } from '../scene/store'
import type { TypeCategory } from '../../../shared/types/scene'
import {
  IconSelect,
  IconWall,
  IconSlab,
  IconRoom,
  IconDoor,
  IconWindow,
  IconColumn,
  IconBeam,
  IconMeasure,
  IconGrid,
  IconWallLine,
  IconWallArc,
  IconTrim,
  IconExtend,
  IconSplit,
  IconOffset,
  IconDimension,
  IconRoomTag,
  IconText,
  IconLeader,
  IconColumnGrid,
  IconRoof,
} from './Icons'

interface ToolDef {
  tool: Tool
  icon: React.ReactNode
  shortcut: string
  /** Type category whose selector should appear when this tool is active. */
  category?: TypeCategory
}

const GROUPS: ToolDef[][] = [
  [{ tool: 'select', icon: <IconSelect />, shortcut: 'S' }],
  [
    { tool: 'wall', icon: <IconWall />, shortcut: 'W', category: 'wall' },
    { tool: 'slab', icon: <IconSlab />, shortcut: 'F', category: 'slab' },
    { tool: 'room', icon: <IconRoom />, shortcut: 'R' },
    { tool: 'roof', icon: <IconRoof />, shortcut: 'U', category: 'roof' },
  ],
  [
    { tool: 'door', icon: <IconDoor />, shortcut: 'D', category: 'door' },
    { tool: 'window', icon: <IconWindow />, shortcut: 'N', category: 'window' },
  ],
  [
    { tool: 'column', icon: <IconColumn />, shortcut: 'C', category: 'column' },
    { tool: 'beam', icon: <IconBeam />, shortcut: 'B', category: 'beam' },
    { tool: 'columngrid', icon: <IconColumnGrid />, shortcut: 'Y' },
  ],
  [
    { tool: 'trim', icon: <IconTrim />, shortcut: 'T' },
    { tool: 'extend', icon: <IconExtend />, shortcut: 'E' },
    { tool: 'split', icon: <IconSplit />, shortcut: 'K' },
    { tool: 'offset', icon: <IconOffset />, shortcut: 'O' },
  ],
  [
    { tool: 'measure', icon: <IconMeasure />, shortcut: 'M' },
    { tool: 'dimension', icon: <IconDimension />, shortcut: 'I' },
  ],
  [
    { tool: 'roomtag', icon: <IconRoomTag />, shortcut: 'G' },
    { tool: 'text', icon: <IconText />, shortcut: 'X' },
    { tool: 'leader', icon: <IconLeader />, shortcut: 'L' },
  ],
]

const OFFSET_PRESETS = [0.1, 0.2, 0.5, 1, 1.2, 2, 3]

const GRID_SIZES = [0.05, 0.1, 0.25, 0.5, 1]

export default function ToolRibbon() {
  const { t } = useTranslation()
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const showGrid = useEditor((s) => s.showGrid)
  const toggleGrid = useEditor((s) => s.toggleGrid)
  const gridSize = useEditor((s) => s.gridSize)
  const setGridSize = useEditor((s) => s.setGridSize)

  const activeDef = GROUPS.flat().find((d) => d.tool === tool)

  return (
    <div
      style={{
        height: 'var(--h-ribbon)',
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-8)',
        padding: '0 var(--sp-8)',
        background: 'var(--surface-300)',
        borderBottom: '1px solid var(--divider)',
      }}
    >
      {GROUPS.map((group, gi) => (
        <div key={gi} style={{ display: 'flex', gap: 2 }}>
          {group.map((d) => (
            <button
              key={d.tool}
              className={`icon-btn tip ${tool === d.tool ? 'icon-btn--active' : ''}`}
              data-tip={`${t(`editor.tools.${d.tool}`)} (${d.shortcut})`}
              onClick={() => setTool(d.tool)}
              aria-label={t(`editor.tools.${d.tool}`)}
              aria-pressed={tool === d.tool}
            >
              {d.icon}
            </button>
          ))}
        </div>
      ))}

      {/* Contextual type selector for the active tool */}
      {activeDef?.category && (
        <>
          <div className="divider" style={{ width: 1, height: 18, flex: 'none' }} />
          <TypeSelector category={activeDef.category} />
        </>
      )}

      {/* Straight vs 3-point arc, only while the wall tool is active (Revit's Options Bar). */}
      {tool === 'wall' && (
        <>
          <div className="divider" style={{ width: 1, height: 18, flex: 'none' }} />
          <WallModeToggle />
        </>
      )}

      {/* The offset tool needs a distance before it can do anything useful. */}
      {tool === 'offset' && (
        <>
          <div className="divider" style={{ width: 1, height: 18, flex: 'none' }} />
          <OffsetDistancePicker />
        </>
      )}

      <div className="spacer" />

      <button
        className={`icon-btn tip ${showGrid ? 'icon-btn--active' : ''}`}
        data-tip={t('editor.grid')}
        onClick={toggleGrid}
        aria-label={t('editor.grid')}
        aria-pressed={showGrid}
      >
        <IconGrid />
      </button>
      <select
        className="select"
        style={{ width: 82 }}
        value={gridSize}
        onChange={(e) => setGridSize(Number(e.target.value))}
        aria-label={t('editor.gridSize')}
      >
        {GRID_SIZES.map((g) => (
          <option key={g} value={g}>
            {g < 1 ? `${g * 1000} mm` : `${g} m`}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * Straight / 3-point arc. Curved walls were always in the schema and the geometry; this is the
 * control that lets a user actually draw one (A1). `A` toggles it from the keyboard.
 */
function WallModeToggle() {
  const { t } = useTranslation()
  const wallMode = useEditor((s) => s.wallMode)
  const setWallMode = useEditor((s) => s.setWallMode)

  const modes = [
    { mode: 'line' as const, icon: <IconWallLine />, key: 'editor.wallMode.line' },
    { mode: 'arc' as const, icon: <IconWallArc />, key: 'editor.wallMode.arc' },
  ]

  return (
    <div style={{ display: 'flex', gap: 2 }} role="group" aria-label={t('editor.wallMode.label')}>
      {modes.map((m) => (
        <button
          key={m.mode}
          className={`icon-btn tip ${wallMode === m.mode ? 'icon-btn--active' : ''}`}
          data-tip={`${t(m.key)} (A)`}
          onClick={() => setWallMode(m.mode)}
          aria-label={t(m.key)}
          aria-pressed={wallMode === m.mode}
        >
          {m.icon}
        </button>
      ))}
    </div>
  )
}

/**
 * Offset distance. A preset list rather than a free field because these are the numbers that come up
 * — a cavity, a stud wall, a corridor — and picking one is faster than typing it. The sign is not
 * here on purpose: it comes from which side of the wall you click.
 */
function OffsetDistancePicker() {
  const { t } = useTranslation()
  const offsetDistance = useEditor((s) => s.offsetDistance)
  const setOffsetDistance = useEditor((s) => s.setOffsetDistance)

  return (
    <select
      className="select"
      style={{ width: 110 }}
      value={offsetDistance}
      onChange={(e) => setOffsetDistance(Number(e.target.value))}
      aria-label={t('editor.offsetDistance')}
    >
      {OFFSET_PRESETS.map((d) => (
        <option key={d} value={d}>
          {d < 1 ? `${Math.round(d * 1000)} mm` : `${d} m`}
        </option>
      ))}
    </select>
  )
}

/**
 * Picks the active type for a category. Because instances reference a type, switching here
 * changes what the next element will be — and editing the type later updates every instance.
 */
function TypeSelector({ category }: { category: TypeCategory }) {
  const scene = useEditor((s) => s.scene)
  const setActiveType = useEditor((s) => s.setActiveType)
  const active = useEditor((s) => {
    switch (category) {
      case 'wall':
        return s.activeWallTypeId
      case 'slab':
        return s.activeSlabTypeId
      case 'door':
        return s.activeDoorTypeId
      case 'window':
        return s.activeWindowTypeId
      case 'column':
        return s.activeColumnTypeId
      case 'beam':
        return s.activeBeamTypeId
      default:
        return ''
    }
  })

  const options = scene.types.filter((tp) => tp.category === category)
  if (options.length === 0) return null

  return (
    <select
      className="select"
      style={{ width: 210 }}
      value={active}
      onChange={(e) => setActiveType(category, e.target.value)}
      aria-label="Type"
    >
      {options.map((tp) => (
        <option key={tp.id} value={tp.id}>
          {tp.name}
        </option>
      ))}
    </select>
  )
}
