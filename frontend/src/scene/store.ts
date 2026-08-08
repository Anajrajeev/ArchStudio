/**
 * The editor store: scene graph + work plane + tool state machine + view state, with a
 * command-pattern undo/redo history.
 *
 * One `commit` == one undoable transaction, so a whole drag, or (Phase 3) a whole multi-step AI
 * tool sequence, collapses into a single undo entry exactly like a user action.
 */
import { create } from 'zustand'
import {
  emptySceneGraph,
  findLevel,
  type SceneGraph,
  type Vec2,
  type Vec3,
  type DimensionRef,
} from '../../../shared/types/scene'
import {
  levelWorkPlane,
  pushPlane,
  previousPlane,
  nextPlane,
  emptyPlaneHistory,
  planeBadge,
  planeElevation,
  type WorkPlane,
  type PlaneHistory,
} from '../../../shared/geometry/workplane'
import { elementTopPlane, isDistinctPlane } from '../../../shared/geometry/dynamicPlane'
import {
  DEFAULT_SNAP_TOGGLES,
  type SnapToggles,
  type SnapResult,
  type SnapType,
  type AxisLock,
} from '../../../shared/geometry/snapping'
import { addLevel, findElement, type SelectedElement } from './mutations'

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export type Tool =
  | 'select'
  | 'wall'
  | 'slab'
  | 'room'
  | 'roof'
  | 'door'
  | 'window'
  | 'column'
  | 'beam'
  | 'measure'
  // Modify verbs (D3). Trim and extend take two picks: the boundary, then the target.
  | 'trim'
  | 'extend'
  | 'split'
  | 'offset'
  // Parametric dimension (C2): two picks, each snapped to a named element point.
  | 'dimension'
  // Annotations (C3). Room tag hit-tests a room; text places a note; leader takes two picks.
  | 'roomtag'
  | 'text'
  | 'leader'
  // Column grid (B6): one click places a default grid, edited afterward in Properties.
  | 'columngrid'
  // Primitive solid (B7): one click places the active primitive type. Booleans are verbs in the
  // Modify panel rather than a tool — they act on elements that already exist.
  | 'primitive'
  // Stair (B2): a straight flight, two clicks like a beam.
  | 'stair'
  // Railing (B3): an OPEN polyline — collects points like slab/room but never closes on the
  // first point, since a railing is a path, not a boundary. Finished with Enter.
  | 'railing'
  // Ceiling (B5): a closed boundary loop like slab/room, anchored at its bottom face.
  | 'ceiling'
  // Spot annotation (C4): one click reads elevation, coordinate, or roof slope at the point,
  // depending on `activeSpotMode` — one tool with a ribbon mode switch, like the wall's line/arc.
  | 'spot'
  // Curtain wall (B4): two clicks along its baseline, exactly like a straight wall. The bay grid
  // comes from the TYPE, so there is nothing else to collect.
  | 'curtainwall'
  // Plan region (C7): a closed boundary loop like slab/room/ceiling, defining a sub-area of the
  // active plan view drawn at its own cut height. Deliberately has NO single-letter shortcut —
  // A–Z were already fully spoken for by D-025, and nothing requires a tool to have a letter.
  | 'planregion'

/**
 * How the wall tool interprets its points. `arc` collects a third point the wall must pass
 * through — the 3-point arc convention (A1). Curved walls were always supported by the schema,
 * geometry and renderers; this is the tool that finally draws one.
 */
export type WallMode = 'line' | 'arc'

/**
 * How the slab tool interprets a closed loop (B8). `opening` reuses the exact same loop-closing
 * gesture as `solid`, but hands the finished polygon to whichever existing slab (on the active
 * level) contains it as an inner-loop cut, rather than creating a new slab — the same "one tool,
 * a ribbon mode switch" shape as `WallMode`.
 */
export type SlabMode = 'solid' | 'opening'

/** Which readout the spot annotation tool places at the picked point (C4). */
export type SpotMode = 'elevation' | 'coordinate' | 'slope'

/** How many points each tool collects before it can commit. 0 = unbounded (closed loop). */
export const TOOL_POINTS: Record<Tool, number> = {
  select: 0,
  wall: 2,
  slab: 0,
  room: 0,
  roof: 0,
  door: 1,
  window: 1,
  column: 1,
  beam: 2,
  measure: 2,
  // The modify verbs pick existing elements rather than collecting free points.
  trim: 0,
  extend: 0,
  split: 0,
  offset: 0,
  dimension: 2,
  roomtag: 0,
  text: 1,
  leader: 2,
  columngrid: 1,
  primitive: 1,
  stair: 2,
  railing: 0, // unbounded — an open path, finished with Enter (min 2 points), not by closing
  ceiling: 0, // unbounded — a closed loop, exactly like slab/room
  spot: 1,
  curtainwall: 2,
  planregion: 0, // unbounded — a closed loop, exactly like slab/room/ceiling
}

export type ToolPhase = 'idle' | 'collecting'

export type ViewMode = 'plan' | '3d'
export type Projection = 'ortho' | 'perspective'
export type Theme = 'dark' | 'light'

/** Which numeric field the keyboard is currently filling. */
export type NumericField = 'length' | 'angle'

export interface NumericEntry {
  /** Raw typed text, e.g. "4.2" or "2400" or "3'6". */
  buffer: string
  field: NumericField
  /** Committed constraints, applied on every pointer move until the point is placed. */
  lockedLength: number | null
  lockedAngle: number | null
}

export const emptyNumericEntry: NumericEntry = {
  buffer: '',
  field: 'length',
  lockedLength: null,
  lockedAngle: null,
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

interface HistoryEntry {
  label: string
  before: SceneGraph
  after: SceneGraph
}

const HISTORY_LIMIT = 100

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface EditorState {
  // --- document
  scene: SceneGraph
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]
  transientBefore: SceneGraph | null

  // --- active context
  activeLevelId: string
  workPlane: WorkPlane
  planeHistory: PlaneHistory
  /** True when the plane was set explicitly and hover must not override it. */
  planeLocked: boolean

  // --- tool state machine
  tool: Tool
  toolPhase: ToolPhase
  /**
   * The last tool a TYPED placement (one with an active type — wall/slab/door/window/column/
   * beam/roof/primitive/stair/railing/ceiling) was committed on (D7). `repeatLastOperation`
   * switches back to it; since every type/parameter selector is its own persistent field rather
   * than being reset on tool switch, switching tools already restores "same type + parameters"
   * for free.
   */
  lastPlacementTool: Tool | null
  /** Points collected by the in-progress operation, in scene 2D. */
  points: Vec2[]
  numeric: NumericEntry
  axisLock: AxisLock
  wallMode: WallMode
  /** Solid vs. opening loop for the slab tool (B8). */
  slabMode: SlabMode
  /** Which readout the spot tool places (C4). */
  activeSpotMode: SpotMode
  /** First pick of a two-element verb (trim/extend): the boundary wall. */
  pendingRefId: string | null
  /** Distance the offset tool uses; sign comes from which side of the wall was clicked. */
  offsetDistance: number
  /**
   * Element-point references collected by the dimension tool, parallel to `points`. A dimension
   * is parametric — it stores WHICH endpoint of WHICH element, not a bare coordinate — so a pick
   * that did not land on a named element point is refused rather than silently degrading to one.
   */
  pendingDimRefs: DimensionRef[]
  /** Active type per tool category, so the ribbon and the tool agree. */
  activeWallTypeId: string
  activeSlabTypeId: string
  activeDoorTypeId: string
  activeWindowTypeId: string
  activeColumnTypeId: string
  activeBeamTypeId: string
  activeRoofTypeId: string
  activePrimitiveTypeId: string
  activeStairTypeId: string
  activeRailingTypeId: string
  activeCeilingTypeId: string
  activeCurtainWallTypeId: string

  /**
   * Which group the user has ENTERED (D5). Inside it, clicking a member selects that member
   * rather than resolving up to the group — the isolation boundary is opened, not removed.
   * null = not inside any group, so every pick resolves to its outermost group.
   */
  enteredGroupId: string | null

  // --- pointer / snapping
  snap: SnapResult | null
  cursorWorld: Vec3 | null
  snapToggles: SnapToggles
  gridSize: number
  /** Polar/axis snap angle increment in degrees. */
  angleIncrement: number
  /** In-range snap candidates for the current cursor (Tab-cycling, A6). */
  snapCandidates: Array<{ point: Vec2; type: SnapType | null; label: string | null; sourceId?: string }> | null
  /** Index of the currently selected snap candidate (0 = the winner). */
  snapCandidateIndex: number
  /** Element the plane would jump to if the user clicked now (Dynamic UCS candidate). */
  hoverPlaneElementId: string | null

  // --- selection
  selectedIds: string[]
  hoveredId: string | null
  /**
   * The in-progress rubber band, in canvas pixels, or null. Screen-space rather than scene-space
   * because a screen rectangle is a frustum in a perspective view, not a rectangle in the model.
   */
  marquee: { start: Vec2; current: Vec2; mode: 'window' | 'crossing' } | null

  // --- view
  viewMode: ViewMode
  projection: Projection
  theme: Theme
  /** Hide levels above the active one (a cut view). */
  cutViewEnabled: boolean
  /** Ghost the levels below the active one instead of hiding them. */
  ghostBelowEnabled: boolean
  isolateLevel: boolean
  showGrid: boolean

  // --- transient status message (graceful failure surface)
  statusMessage: { text: string; kind: 'info' | 'error' } | null

  // ==== actions ====
  setTool: (tool: Tool) => void
  setWallMode: (mode: WallMode) => void
  setSlabMode: (mode: SlabMode) => void
  setSpotMode: (mode: SpotMode) => void
  notePlacement: (tool: Tool) => void
  repeatLastOperation: () => void
  setPendingRef: (id: string | null) => void
  setOffsetDistance: (d: number) => void
  setActiveLevel: (id: string) => void
  setActiveType: (category: string, typeId: string) => void

  // tool FSM
  addPoint: (p: Vec2) => void
  addDimPoint: (p: Vec2, ref: DimensionRef | null) => 'ok' | 'no-ref'
  popPoint: () => void
  clearPoints: () => void
  cancelTool: () => void

  // numeric entry
  typeNumeric: (ch: string) => void
  backspaceNumeric: () => void
  toggleNumericField: () => void
  commitNumeric: () => void
  clearNumeric: () => void
  setAxisLock: (lock: AxisLock) => void

  // work plane
  setWorkPlane: (plane: WorkPlane, lock?: boolean) => void
  resetWorkPlaneToLevel: () => void
  goPreviousPlane: () => void
  goNextPlane: () => void
  setPlaneLocked: (locked: boolean) => void
  setHoverPlaneElement: (id: string | null) => void
  applyHoverPlane: (elementId: string | null) => void
  setWorkPlaneToSelection: () => void

  // pointer
  setSnap: (snap: SnapResult | null, world: Vec3 | null) => void
  toggleSnapType: (t: SnapType) => void
  setGridSize: (n: number) => void
  setAngleIncrement: (n: number) => void
  setSnapCandidates: (candidates: EditorState['snapCandidates']) => void
  cycleSnapCandidate: () => void

  // selection
  select: (id: string | null, additive?: boolean) => void
  selectMany: (ids: string[], additive?: boolean) => void
  /** Enter a group so its members become individually selectable, or null to step back out. */
  enterGroup: (id: string | null) => void
  setHovered: (id: string | null) => void
  setMarquee: (m: EditorState['marquee']) => void

  // view
  setViewMode: (m: ViewMode) => void
  setProjection: (p: Projection) => void
  setTheme: (t: Theme) => void
  toggleCutView: () => void
  toggleGhostBelow: () => void
  toggleIsolateLevel: () => void
  toggleGrid: () => void

  // status
  flash: (text: string, kind?: 'info' | 'error') => void

  // history
  commit: (label: string, producer: (scene: SceneGraph) => SceneGraph) => void
  undo: () => void
  redo: () => void
  beginTransient: () => void
  updateTransient: (producer: (scene: SceneGraph) => SceneGraph) => void
  endTransient: (label: string) => void
  cancelTransient: () => void

  loadScene: (scene: SceneGraph, activeLevelId?: string) => void

  // derived
  selected: () => SelectedElement | null
}

function bootstrap(): { scene: SceneGraph; levelId: string } {
  const base = emptySceneGraph(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'local-project',
  )
  const withLevel = addLevel(base, 'Ground floor')
  return { scene: withLevel, levelId: withLevel.levels[0].id }
}

const boot = bootstrap()
const bootLevel = boot.scene.levels[0]

function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const stored = window.localStorage?.getItem('archstudio.theme')
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export const useEditor = create<EditorState>((set, get) => ({
  scene: boot.scene,
  undoStack: [],
  redoStack: [],
  transientBefore: null,

  activeLevelId: boot.levelId,
  workPlane: levelWorkPlane(bootLevel.id, bootLevel.name, bootLevel.elevation),
  planeHistory: emptyPlaneHistory,
  planeLocked: false,

  tool: 'select',
  toolPhase: 'idle',
  lastPlacementTool: null,
  points: [],
  numeric: emptyNumericEntry,
  axisLock: 'none',
  wallMode: 'line',
  slabMode: 'solid',
  activeSpotMode: 'elevation',
  pendingRefId: null,
  offsetDistance: 1,
  pendingDimRefs: [],
  activeWallTypeId: 'wt-ext-200',
  activeSlabTypeId: 'st-floor-200',
  activeDoorTypeId: 'dt-single-900',
  activeWindowTypeId: 'wnt-1200',
  activeColumnTypeId: 'ct-rect-300',
  activeBeamTypeId: 'bt-rect-200x400',
  activeRoofTypeId: 'rt-tile-250',
  activePrimitiveTypeId: 'pt-box',
  activeStairTypeId: 'st-stair-280',
  activeRailingTypeId: 'rl-standard',
  activeCeilingTypeId: 'clt-plaster-15',
  activeCurtainWallTypeId: 'cwt-glazed-1500',
  enteredGroupId: null,

  snap: null,
  cursorWorld: null,
  snapToggles: { ...DEFAULT_SNAP_TOGGLES },
  gridSize: 0.25,
  angleIncrement: 45,
  snapCandidates: null,
  snapCandidateIndex: 0,
  hoverPlaneElementId: null,

  selectedIds: [],
  hoveredId: null,
  marquee: null,

  viewMode: '3d',
  projection: 'perspective',
  theme: initialTheme(),
  cutViewEnabled: false,
  ghostBelowEnabled: true,
  isolateLevel: false,
  showGrid: true,

  statusMessage: null,

  // ---- tools ----

  setTool: (tool) =>
    set({
      tool,
      toolPhase: 'idle',
      points: [],
      pendingDimRefs: [],
      numeric: emptyNumericEntry,
      axisLock: 'none',
      selectedIds: tool === 'select' ? get().selectedIds : [],
      // Switching tools abandons a half-finished two-pick verb.
      pendingRefId: null,
    }),

  setPendingRef: (pendingRefId) => set({ pendingRefId }),
  setOffsetDistance: (offsetDistance) => set({ offsetDistance }),

  /** Switching line/arc mid-gesture discards the collected points — the point *count* changes. */
  setWallMode: (wallMode) =>
    set({ wallMode, points: [], toolPhase: 'idle', numeric: emptyNumericEntry, axisLock: 'none' }),

  /** Switching solid/opening mid-loop discards the collected points, same reasoning as wall mode. */
  setSlabMode: (slabMode) =>
    set({ slabMode, points: [], toolPhase: 'idle', numeric: emptyNumericEntry, axisLock: 'none' }),

  setSpotMode: (activeSpotMode) => set({ activeSpotMode }),

  /** Remember the tool a typed placement just committed on (D7). */
  notePlacement: (tool) => set({ lastPlacementTool: tool }),

  /**
   * Switch back to the last tool a typed placement was committed on, ready to place another
   * instance immediately (D7). Its active type and every other parameter are already live in
   * their own persistent fields — switching tools is all that is needed to "repeat" it.
   */
  repeatLastOperation: () => {
    const s = get()
    if (!s.lastPlacementTool) return
    s.setTool(s.lastPlacementTool)
    s.flash(`Repeat: ${s.lastPlacementTool}`)
  },

  setActiveLevel: (id) => {
    const level = findLevel(get().scene, id)
    if (!level) return
    set({
      activeLevelId: id,
      selectedIds: [],
      points: [],
      toolPhase: 'idle',
      // Switching level moves the work plane and the camera together, as FreeCAD's
      // double-click-a-BuildingPart does.
      workPlane: levelWorkPlane(level.id, level.name, level.elevation),
      planeLocked: false,
      hoverPlaneElementId: null,
    })
  },

  setActiveType: (category, typeId) => {
    switch (category) {
      case 'wall':
        set({ activeWallTypeId: typeId })
        break
      case 'slab':
        set({ activeSlabTypeId: typeId })
        break
      case 'door':
        set({ activeDoorTypeId: typeId })
        break
      case 'window':
        set({ activeWindowTypeId: typeId })
        break
      case 'column':
        set({ activeColumnTypeId: typeId })
        break
      case 'beam':
        set({ activeBeamTypeId: typeId })
        break
      case 'roof':
        set({ activeRoofTypeId: typeId })
        break
      case 'primitive':
        set({ activePrimitiveTypeId: typeId })
        break
      case 'stair':
        set({ activeStairTypeId: typeId })
        break
      case 'railing':
        set({ activeRailingTypeId: typeId })
        break
      case 'ceiling':
        set({ activeCeilingTypeId: typeId })
        break
      case 'curtainWall':
        set({ activeCurtainWallTypeId: typeId })
        break
    }
  },

  addPoint: (p) =>
    set({
      points: [...get().points, p],
      toolPhase: 'collecting',
      numeric: emptyNumericEntry,
      axisLock: 'none',
    }),

  /** Like `addPoint`, but also requires a resolved element-point ref — refuses otherwise. */
  addDimPoint: (p, ref) => {
    if (!ref) return 'no-ref'
    set({
      points: [...get().points, p],
      pendingDimRefs: [...get().pendingDimRefs, ref],
      toolPhase: 'collecting',
      numeric: emptyNumericEntry,
      axisLock: 'none',
    })
    return 'ok'
  },

  popPoint: () => {
    const pts = get().points.slice(0, -1)
    set({
      points: pts,
      pendingDimRefs: get().pendingDimRefs.slice(0, -1),
      toolPhase: pts.length ? 'collecting' : 'idle',
    })
  },

  clearPoints: () =>
    set({ points: [], pendingDimRefs: [], toolPhase: 'idle', numeric: emptyNumericEntry }),

  cancelTool: () => {
    const s = get()
    const level = findLevel(s.scene, s.activeLevelId)
    // Esc drops a hover-acquired plane back to the level plane, but leaves an explicitly locked
    // plane (A3) alone — the user asked for that one and cancelling a draw is not un-asking.
    const revert = s.hoverPlaneElementId !== null && !s.planeLocked && level
    set({
      points: [],
      pendingDimRefs: [],
      toolPhase: 'idle',
      numeric: emptyNumericEntry,
      axisLock: 'none',
      pendingRefId: null,
      hoverPlaneElementId: revert ? null : s.hoverPlaneElementId,
      workPlane: revert ? levelWorkPlane(level.id, level.name, level.elevation) : s.workPlane,
    })
  },

  // ---- numeric entry (listening dimensions) ----

  typeNumeric: (ch) => {
    const n = get().numeric
    // Accept digits, one decimal point, feet/inch marks, and a leading minus for angles.
    if (!/^[0-9.'"-]$/.test(ch)) return
    if (ch === '.' && n.buffer.includes('.')) return
    set({ numeric: { ...n, buffer: n.buffer + ch } })
  },

  backspaceNumeric: () => {
    const n = get().numeric
    set({ numeric: { ...n, buffer: n.buffer.slice(0, -1) } })
  },

  /** Tab switches which field the typed number fills — so a typed length can still be aimed. */
  toggleNumericField: () => {
    const n = get().numeric
    set({ numeric: { ...n, field: n.field === 'length' ? 'angle' : 'length', buffer: '' } })
  },

  commitNumeric: () => {
    const n = get().numeric
    const value = parseLengthInput(n.buffer, get().scene.units)
    if (value === null) {
      set({ numeric: { ...n, buffer: '' } })
      return
    }
    if (n.field === 'length') set({ numeric: { ...n, buffer: '', lockedLength: value } })
    else set({ numeric: { ...n, buffer: '', lockedAngle: value } })
  },

  clearNumeric: () => set({ numeric: emptyNumericEntry }),

  setAxisLock: (lock) => set({ axisLock: lock }),

  // ---- work plane ----

  setWorkPlane: (plane, lock = false) =>
    set({
      workPlane: plane,
      planeHistory: pushPlane(get().planeHistory, get().workPlane),
      planeLocked: lock,
    }),

  resetWorkPlaneToLevel: () => {
    const level = findLevel(get().scene, get().activeLevelId)
    if (!level) return
    set({
      workPlane: levelWorkPlane(level.id, level.name, level.elevation),
      planeHistory: pushPlane(get().planeHistory, get().workPlane),
      planeLocked: false,
      hoverPlaneElementId: null,
    })
  },

  goPreviousPlane: () => {
    const r = previousPlane(get().planeHistory, get().workPlane)
    if (r) set({ workPlane: r.plane, planeHistory: r.history })
  },

  goNextPlane: () => {
    const r = nextPlane(get().planeHistory, get().workPlane)
    if (r) set({ workPlane: r.plane, planeHistory: r.history })
  },

  setPlaneLocked: (planeLocked) => set({ planeLocked }),
  setHoverPlaneElement: (hoverPlaneElementId) => set({ hoverPlaneElementId }),

  /**
   * Dynamic UCS (A2). Re-plane onto the hovered element's top face, or back to the level plane
   * when nothing qualifies. Deliberately does NOT touch plane history — hover is transient, and a
   * hover-derived plane in Previous/Next would make that command useless.
   *
   * Refuses in two cases, both load-bearing:
   *  - `planeLocked` — the user set a plane explicitly (A3) and hover must not fight it.
   *  - an operation is in progress — the first click freezes the plane (CLAUDE.md core rule 2);
   *    re-planing mid-command is exactly what makes drawing feel random.
   */
  applyHoverPlane: (elementId) => {
    const s = get()
    if (s.planeLocked || s.points.length > 0) return

    const level = findLevel(s.scene, s.activeLevelId)
    const levelPlane = level
      ? levelWorkPlane(level.id, level.name, level.elevation)
      : null

    if (elementId === null) {
      if (s.hoverPlaneElementId === null) return
      set({ hoverPlaneElementId: null, workPlane: levelPlane ?? s.workPlane })
      return
    }

    const plane = elementTopPlane(s.scene, elementId)
    // No usable top face, or its top is the plane we are already on: fall back to the level plane
    // rather than leaving a stale hover plane active.
    if (!plane || (levelPlane && !isDistinctPlane(plane, planeElevation(levelPlane)))) {
      if (s.hoverPlaneElementId === null) return
      set({ hoverPlaneElementId: null, workPlane: levelPlane ?? s.workPlane })
      return
    }

    if (s.hoverPlaneElementId === elementId) return
    set({ hoverPlaneElementId: elementId, workPlane: plane })
  },

  /**
   * The sticky counterpart (A3): pin the plane to the selected element's top face until the user
   * clears it. Unlike hover this DOES push plane history, so Previous/Next steps between the
   * planes the user chose.
   */
  setWorkPlaneToSelection: () => {
    const s = get()
    if (s.selectedIds.length !== 1) {
      s.flash('Select exactly one element to set the work plane', 'error')
      return
    }
    const plane = elementTopPlane(s.scene, s.selectedIds[0])
    if (!plane) {
      s.flash('That element has no horizontal face to draw on', 'error')
      return
    }
    set({
      workPlane: plane,
      planeHistory: pushPlane(s.planeHistory, s.workPlane),
      planeLocked: true,
      hoverPlaneElementId: null,
      statusMessage: { text: `Work plane: ${planeBadge(plane)}`, kind: 'info' },
    })
  },

  // ---- pointer ----

  setSnap: (snap, cursorWorld) => set({ snap, cursorWorld }),

  toggleSnapType: (t) =>
    set({ snapToggles: { ...get().snapToggles, [t]: !get().snapToggles[t] } }),

  setGridSize: (gridSize) => set({ gridSize }),

  setAngleIncrement: (angleIncrement) => set({ angleIncrement }),

  /** Set the snap candidates and reset the selected index. Called when the cursor moves. */
  setSnapCandidates: (candidates) => set({ snapCandidates: candidates, snapCandidateIndex: 0 }),

  /** Cycle to the next snap candidate (Tab key, A6). */
  cycleSnapCandidate: () => {
    const s = get()
    if (!s.snapCandidates || s.snapCandidates.length === 0) return
    const nextIndex = (s.snapCandidateIndex + 1) % s.snapCandidates.length
    const candidate = s.snapCandidates[nextIndex]
    set({
      snapCandidateIndex: nextIndex,
      snap: {
        point: candidate.point,
        type: candidate.type,
        label: candidate.label,
        sourceId: candidate.sourceId,
        snapped: candidate.type !== null,
      },
    })
  },

  // ---- selection ----

  select: (id, additive = false) => {
    if (id === null) {
      set({ selectedIds: [] })
      return
    }
    if (!additive) {
      set({ selectedIds: [id] })
      return
    }
    const current = get().selectedIds
    set({
      selectedIds: current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    })
  },

  /** Shift-dragging a box adds to the selection rather than replacing it. */
  selectMany: (ids, additive = false) => {
    if (!additive) {
      set({ selectedIds: ids })
      return
    }
    const merged = new Set(get().selectedIds)
    ids.forEach((id) => merged.add(id))
    set({ selectedIds: [...merged] })
  },

  /**
   * D5: entering a group opens its isolation boundary. The selection is cleared on the way in and
   * out because what a given id MEANS changes — outside the group a member click resolves to the
   * group, inside it resolves to the member — so keeping the old selection would leave the panel
   * showing something the next click could not reproduce.
   */
  enterGroup: (id) => set({ enteredGroupId: id, selectedIds: [] }),

  setHovered: (hoveredId) => set({ hoveredId }),
  setMarquee: (marquee) => set({ marquee }),

  // ---- view ----

  setViewMode: (viewMode) =>
    set({
      viewMode,
      // Plan is a locked top-down ORTHOGRAPHIC camera in the same scene, with a cut plane.
      projection: viewMode === 'plan' ? 'ortho' : get().projection,
      cutViewEnabled: viewMode === 'plan' ? true : get().cutViewEnabled,
    }),

  setProjection: (projection) => set({ projection }),

  setTheme: (theme) => {
    set({ theme })
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme)
      window.localStorage?.setItem('archstudio.theme', theme)
    }
  },

  toggleCutView: () => set({ cutViewEnabled: !get().cutViewEnabled }),
  toggleGhostBelow: () => set({ ghostBelowEnabled: !get().ghostBelowEnabled }),
  toggleIsolateLevel: () => set({ isolateLevel: !get().isolateLevel }),
  toggleGrid: () => set({ showGrid: !get().showGrid }),

  flash: (text, kind = 'info') => set({ statusMessage: { text, kind } }),

  // ---- history ----

  commit: (label, producer) => {
    const before = get().scene
    const after = producer(before)
    if (after === before) return
    const entry: HistoryEntry = { label, before, after }
    set({
      scene: after,
      undoStack: [...get().undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: [],
    })
  },

  undo: () => {
    const { undoStack, redoStack } = get()
    if (undoStack.length === 0) return
    const entry = undoStack[undoStack.length - 1]
    set({
      scene: entry.before,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, entry],
      selectedIds: [],
      statusMessage: { text: `Undo: ${entry.label}`, kind: 'info' },
    })
  },

  redo: () => {
    const { undoStack, redoStack } = get()
    if (redoStack.length === 0) return
    const entry = redoStack[redoStack.length - 1]
    set({
      scene: entry.after,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, entry],
      selectedIds: [],
      statusMessage: { text: `Redo: ${entry.label}`, kind: 'info' },
    })
  },

  beginTransient: () => set({ transientBefore: get().scene }),

  updateTransient: (producer) => set({ scene: producer(get().scene) }),

  endTransient: (label) => {
    const { transientBefore, scene, undoStack } = get()
    if (!transientBefore || transientBefore === scene) {
      set({ transientBefore: null })
      return
    }
    set({
      undoStack: [...undoStack, { label, before: transientBefore, after: scene }].slice(
        -HISTORY_LIMIT,
      ),
      redoStack: [],
      transientBefore: null,
    })
  },

  cancelTransient: () => {
    const { transientBefore } = get()
    if (transientBefore) set({ scene: transientBefore, transientBefore: null })
  },

  loadScene: (scene, activeLevelId) => {
    const levelId = activeLevelId ?? scene.levels[0]?.id ?? ''
    const level = findLevel(scene, levelId)
    set({
      scene,
      activeLevelId: levelId,
      workPlane: level
        ? levelWorkPlane(level.id, level.name, level.elevation)
        : levelWorkPlane('', 'None', 0),
      planeHistory: emptyPlaneHistory,
      planeLocked: false,
      hoverPlaneElementId: null,
      selectedIds: [],
      points: [],
      toolPhase: 'idle',
      undoStack: [],
      redoStack: [],
    })
  },

  selected: () => {
    const { scene, selectedIds } = get()
    return selectedIds.length === 1 ? findElement(scene, selectedIds[0]) : null
  },
}))

// ---------------------------------------------------------------------------
// Unit-aware input parsing
// ---------------------------------------------------------------------------

/**
 * Parse a typed dimension into scene units (metres). Accepts plain numbers, explicit units
 * (`2400mm`, `1.2m`, `30cm`), feet/inches (`3'6"`, `8 6`), and simple sums (`2.4+0.3`).
 * Returns null when unparseable so the caller can flash the field rather than guess.
 */
export function parseLengthInput(raw: string, units: SceneGraph['units'] = 'm'): number | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null

  // Simple additive expressions.
  if (/[+]/.test(s)) {
    const parts = s.split('+')
    let total = 0
    for (const p of parts) {
      const v = parseLengthInput(p, units)
      if (v === null) return null
      total += v
    }
    return total
  }

  // Feet and inches: 3'6", 3', 6"
  const ftIn = /^(-?\d+(?:\.\d+)?)'\s*(\d+(?:\.\d+)?)?"?$/.exec(s)
  if (ftIn) {
    const ft = parseFloat(ftIn[1])
    const inch = ftIn[2] ? parseFloat(ftIn[2]) : 0
    return ft * 0.3048 + inch * 0.0254
  }
  const inchOnly = /^(-?\d+(?:\.\d+)?)"$/.exec(s)
  if (inchOnly) return parseFloat(inchOnly[1]) * 0.0254

  // "8 6" in an imperial document means 8 feet 6 inches.
  const spaced = /^(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/.exec(s)
  if (spaced && units === 'ft') {
    return parseFloat(spaced[1]) * 0.3048 + parseFloat(spaced[2]) * 0.0254
  }

  const withUnit = /^(-?\d+(?:\.\d+)?)\s*(mm|cm|m|ft|in)$/.exec(s)
  if (withUnit) {
    const v = parseFloat(withUnit[1])
    switch (withUnit[2]) {
      case 'mm':
        return v / 1000
      case 'cm':
        return v / 100
      case 'm':
        return v
      case 'ft':
        return v * 0.3048
      case 'in':
        return v * 0.0254
    }
  }

  const plain = /^-?\d+(?:\.\d+)?$/.exec(s)
  if (!plain) return null
  const v = parseFloat(s)
  // A bare number follows the document's units; mm/cm documents accept the raw magnitude.
  switch (units) {
    case 'mm':
      return v / 1000
    case 'cm':
      return v / 100
    case 'ft':
      return v * 0.3048
    default:
      return v
  }
}

/** Format a length for display in the document's units. */
export function formatLength(metres: number, units: SceneGraph['units'] = 'm'): string {
  switch (units) {
    case 'mm':
      return `${Math.round(metres * 1000)} mm`
    case 'cm':
      return `${(metres * 100).toFixed(1)} cm`
    case 'ft': {
      const totalInches = metres / 0.0254
      const ft = Math.floor(totalInches / 12)
      const inch = totalInches - ft * 12
      return `${ft}'${inch.toFixed(1)}"`
    }
    default:
      return `${metres.toFixed(3)} m`
  }
}

export const selectCanUndo = (s: EditorState): boolean => s.undoStack.length > 0
export const selectCanRedo = (s: EditorState): boolean => s.redoStack.length > 0
