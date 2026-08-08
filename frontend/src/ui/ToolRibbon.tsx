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
  IconPrimitive,
  IconStair,
  IconRailing,
  IconCeiling,
  IconSlabSolid,
  IconSlabOpening,
  IconSpot,
  IconCurtainWall,
  IconPlanRegion,
  IconSpotElevation,
  IconSpotCoordinate,
  IconSpotSlope,
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
    { tool: 'stair', icon: <IconStair />, shortcut: 'H', category: 'stair' },
    { tool: 'railing', icon: <IconRailing />, shortcut: 'J', category: 'railing' },
    { tool: 'ceiling', icon: <IconCeiling />, shortcut: 'Q', category: 'ceiling' },
    // No letter: A–Z were fully spoken for before this pass (D-025), and nothing requires a tool
    // to have one. The ribbon button is the whole affordance.
    { tool: 'curtainwall', icon: <IconCurtainWall />, shortcut: '', category: 'curtainWall' },
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
  [{ tool: 'primitive', icon: <IconPrimitive />, shortcut: 'V', category: 'primitive' }],
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
    { tool: 'spot', icon: <IconSpot />, shortcut: 'Z' },
  ],
  // View tools (C7): they author how the PLAN is drawn rather than what the model contains.
  [{ tool: 'planregion', icon: <IconPlanRegion />, shortcut: '' }],
]

const OFFSET_PRESETS = [0.1, 0.2, 0.5, 1, 1.2, 2, 3]

const GRID_SIZES = [0.05, 0.1, 0.25, 0.5, 1]

const ANGLE_INCREMENTS = [15, 22.5, 30, 45, 90]

export default function ToolRibbon() {
  const { t } = useTranslation()
  const tool = useEditor((s) => s.tool)
  const setTool = useEditor((s) => s.setTool)
  const showGrid = useEditor((s) => s.showGrid)
  const toggleGrid = useEditor((s) => s.toggleGrid)
  const gridSize = useEditor((s) => s.gridSize)
  const setGridSize = useEditor((s) => s.setGridSize)
  const angleIncrement = useEditor((s) => s.angleIncrement)
  const setAngleIncrement = useEditor((s) => s.setAngleIncrement)

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
              // A tool without a letter shows its name alone — an empty "()" reads as a bug.
              data-tip={
                d.shortcut
                  ? `${t(`editor.tools.${d.tool}`)} (${d.shortcut})`
                  : t(`editor.tools.${d.tool}`)
              }
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

      {/* New solid vs. cutting an opening in an existing one, only while slab is active (B8). */}
      {tool === 'slab' && (
        <>
          <div className="divider" style={{ width: 1, height: 18, flex: 'none' }} />
          <SlabModeToggle />
        </>
      )}

      {/* Which readout the spot tool places, only while it is active (C4). */}
      {tool === 'spot' && (
        <>
          <div className="divider" style={{ width: 1, height: 18, flex: 'none' }} />
          <SpotModeToggle />
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
      <select
        className="select"
        style={{ width: 82 }}
        value={angleIncrement}
        onChange={(e) => setAngleIncrement(Number(e.target.value))}
        aria-label={t('editor.angleIncrement')}
      >
        {ANGLE_INCREMENTS.map((a) => (
          <option key={a} value={a}>
            {a}°
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
 * New solid vs. cutting an opening in an existing one (B8). `A` toggles it, exactly like the wall
 * tool's own line/arc toggle — the two never conflict since only one tool is ever active.
 */
function SlabModeToggle() {
  const { t } = useTranslation()
  const slabMode = useEditor((s) => s.slabMode)
  const setSlabMode = useEditor((s) => s.setSlabMode)

  const modes = [
    { mode: 'solid' as const, icon: <IconSlabSolid />, key: 'editor.slabMode.solid' },
    { mode: 'opening' as const, icon: <IconSlabOpening />, key: 'editor.slabMode.opening' },
  ]

  return (
    <div style={{ display: 'flex', gap: 2 }} role="group" aria-label={t('editor.slabMode.label')}>
      {modes.map((m) => (
        <button
          key={m.mode}
          className={`icon-btn tip ${slabMode === m.mode ? 'icon-btn--active' : ''}`}
          data-tip={`${t(m.key)} (A)`}
          onClick={() => setSlabMode(m.mode)}
          aria-label={t(m.key)}
          aria-pressed={slabMode === m.mode}
        >
          {m.icon}
        </button>
      ))}
    </div>
  )
}

/** Which readout the spot tool places at the picked point (C4). */
function SpotModeToggle() {
  const { t } = useTranslation()
  const activeSpotMode = useEditor((s) => s.activeSpotMode)
  const setSpotMode = useEditor((s) => s.setSpotMode)

  const modes = [
    { mode: 'elevation' as const, icon: <IconSpotElevation />, key: 'editor.spotMode.elevation' },
    { mode: 'coordinate' as const, icon: <IconSpotCoordinate />, key: 'editor.spotMode.coordinate' },
    { mode: 'slope' as const, icon: <IconSpotSlope />, key: 'editor.spotMode.slope' },
  ]

  return (
    <div style={{ display: 'flex', gap: 2 }} role="group" aria-label={t('editor.spotMode.label')}>
      {modes.map((m) => (
        <button
          key={m.mode}
          className={`icon-btn tip ${activeSpotMode === m.mode ? 'icon-btn--active' : ''}`}
          data-tip={t(m.key)}
          onClick={() => setSpotMode(m.mode)}
          aria-label={t(m.key)}
          aria-pressed={activeSpotMode === m.mode}
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
      case 'roof':
        return s.activeRoofTypeId
      case 'primitive':
        return s.activePrimitiveTypeId
      case 'stair':
        return s.activeStairTypeId
      case 'railing':
        return s.activeRailingTypeId
      case 'ceiling':
        return s.activeCeilingTypeId
      case 'curtainWall':
        return s.activeCurtainWallTypeId
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
