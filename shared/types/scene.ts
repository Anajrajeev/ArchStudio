/**
 * ArchStudio scene graph — schema v2.
 *
 * v2 introduces the BIM Category → Type → Instance model. Shape and *composition* live on a
 * shared **type** (edit the type, every instance updates); *placement and extent* live on the
 * **instance**. This is the defining BIM interaction and is far cheaper to introduce now than
 * to retrofit. See DECISIONS.md D-009.
 *
 * Coordinate convention (D-007, unchanged): scene 2D `[x, y]` maps to world `[x, elevation, y]`.
 * Y is up. Levels stack by `elevation`.
 */

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

export const SCHEMA_VERSION = 8 as const

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export interface Material {
  id: string
  name: string
  color: string
  textureUrl: string | null
}

/**
 * One layer of a compound assembly (wall/slab). Layers apply sequentially across the
 * thickness with no gaps or overlaps, mirroring IFC's `IfcMaterialLayerSetUsage`.
 */
export type LayerFunction = 'structure' | 'substrate' | 'thermal' | 'membrane' | 'finish'

export interface MaterialLayer {
  material: string
  thickness: number
  function: LayerFunction
}

// ---------------------------------------------------------------------------
// Type layer (Category → Type → Instance)
// ---------------------------------------------------------------------------

export type TypeCategory =
  | 'wall'
  | 'door'
  | 'window'
  | 'slab'
  | 'column'
  | 'beam'
  | 'furniture'
  | 'roof'
  | 'primitive'
  | 'stair'
  | 'railing'
  | 'ceiling'

export interface WallTypeDef {
  id: string
  category: 'wall'
  name: string
  /** Compound structure. Total thickness is the sum — never stored separately. */
  layers: MaterialLayer[]
  function: 'exterior' | 'interior' | 'partition'
}

export interface DoorTypeDef {
  id: string
  category: 'door'
  name: string
  width: number
  height: number
  /** Leaf/frame thickness, used for the 3D leaf. */
  thickness: number
  operation: 'single-swing' | 'double-swing' | 'sliding' | 'folding'
  frameMaterial: string
  panelMaterial: string
}

export interface WindowTypeDef {
  id: string
  category: 'window'
  name: string
  width: number
  height: number
  /** Default sill height; instances may override. */
  defaultSillHeight: number
  frameThickness: number
  /** How the glazing is divided. */
  partitioning: 'single' | 'double-horizontal' | 'double-vertical' | 'triple-vertical'
  frameMaterial: string
  glassMaterial: string
}

export interface SlabTypeDef {
  id: string
  category: 'slab'
  name: string
  layers: MaterialLayer[]
  function: 'floor' | 'roof' | 'landing' | 'ceiling'
}

export type ProfileShape =
  | { kind: 'rectangular'; width: number; depth: number }
  | { kind: 'circular'; diameter: number }

export interface ColumnTypeDef {
  id: string
  category: 'column'
  name: string
  profile: ProfileShape
  material: string
}

export interface BeamTypeDef {
  id: string
  category: 'beam'
  name: string
  profile: ProfileShape
  material: string
}

export interface FurnitureTypeDef {
  id: string
  category: 'furniture'
  name: string
  /** glTF asset in the catalog; null renders a labelled placeholder box. */
  catalogId: string | null
  /** Bounding footprint, used for the 2D symbol and the placeholder box. */
  footprint: Vec2
  heightMeters: number
  material: string
}

export interface RoofTypeDef {
  id: string
  category: 'roof'
  name: string
  layers: MaterialLayer[]
}

/**
 * A parametric primitive solid (B7). Every variant is closed-form: `shared/geometry/primitives.ts`
 * tessellates it to a watertight indexed mesh and computes its volume analytically. Segment counts
 * are stored rather than fixed so a boolean operand can be refined without changing the schema.
 */
export type PrimitiveShape =
  | { kind: 'box'; width: number; depth: number; height: number }
  | { kind: 'cylinder'; radius: number; height: number; segments: number }
  | { kind: 'cone'; radius: number; height: number; segments: number }
  | { kind: 'sphere'; radius: number; segments: number }
  /** A regular N-gon extruded vertically. `sides` >= 3. */
  | { kind: 'prism'; radius: number; height: number; sides: number }
  /** A right triangular wedge: full height at -depth/2, zero height at +depth/2. */
  | { kind: 'wedge'; width: number; depth: number; height: number }
  | {
      kind: 'torus'
      radius: number
      tubeRadius: number
      radialSegments: number
      tubularSegments: number
    }

export type PrimitiveKind = PrimitiveShape['kind']

export const PRIMITIVE_KINDS = [
  'box',
  'cylinder',
  'cone',
  'sphere',
  'prism',
  'wedge',
  'torus',
] as const

export interface PrimitiveTypeDef {
  id: string
  category: 'primitive'
  name: string
  shape: PrimitiveShape
  material: string
}

/**
 * A straight stair flight (B2). Shape lives here: `treadDepth` (the going) and `width` are shared
 * by every instance of the type; how many risers a given flight has, and the rise it must cover,
 * are per-instance (see `Stair`) — the same Category → Type → Instance split as everything else.
 */
export interface StairTypeDef {
  id: string
  category: 'stair'
  name: string
  /** Clear width of the flight, perpendicular to the direction of travel. */
  width: number
  /** Nominal tread depth (the "going"). */
  treadDepth: number
  material: string
}

/** A railing (B3): a continuous top rail plus evenly spaced vertical posts along an open path. */
export interface RailingTypeDef {
  id: string
  category: 'railing'
  name: string
  /** Height from the walking surface to the top of the handrail. */
  height: number
  /** Cross-section side of both the rail and the posts. */
  postThickness: number
  /** Centre-to-centre spacing of posts along the path. */
  postSpacing: number
  material: string
}

/**
 * A ceiling (B5): a boundary polygon analogous to Slab, but anchored at its finished BOTTOM face
 * rather than its top, and positioned with the same `TopConstraint` union walls/columns/stairs use
 * (see `Ceiling.top` below) so it naturally attaches to the underside of the level above.
 */
export interface CeilingTypeDef {
  id: string
  category: 'ceiling'
  name: string
  layers: MaterialLayer[]
}

export type ElementTypeDef =
  | WallTypeDef
  | DoorTypeDef
  | WindowTypeDef
  | SlabTypeDef
  | ColumnTypeDef
  | BeamTypeDef
  | FurnitureTypeDef
  | RoofTypeDef
  | PrimitiveTypeDef
  | StairTypeDef
  | RailingTypeDef
  | CeilingTypeDef

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

export interface Level {
  id: string
  name: string
  elevation: number
  /** Nominal floor-to-floor height; the default top for unconnected elements on this level. */
  height: number
  /** A functional building storey vs. an ancillary reference level (landing, top-of-steel). */
  isBuildingStory: boolean
  /** Height above the level at which room perimeter/area is computed. */
  computationHeight: number
}

// ---------------------------------------------------------------------------
// Vertical extent — the constraint union
// ---------------------------------------------------------------------------

/**
 * How an element's top is determined. `level` tracks a level (so changing storey heights
 * updates the element); `unconnected` is a fixed height that does not track. Copied from
 * Revit's Top Constraint / Unconnected Height pair — the single modelling decision that
 * makes multi-storey editing behave like BIM.
 */
export type TopConstraint =
  | { kind: 'level'; levelId: string; offset: number }
  | { kind: 'unconnected'; height: number }
  /**
   * The top follows a roof's underside (B1 wall voiding, D-020). Only a WALL resolves this to a
   * ramped top (`shared/geometry/roof.ts` `wallRoofRamp`) — a column or room using it just reads
   * the roof's `baseHeight` as a flat reference, via `resolveTopElevation` below.
   */
  | { kind: 'roof'; roofId: string }

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

/** Which plane of the wall the baseline represents. */
export type LocationLine = 'centerline' | 'finish-exterior' | 'finish-interior'

/** A straight or arc baseline. Arc is stored as a bulge factor to stay purely parametric. */
export type Baseline =
  | { kind: 'line'; start: Vec2; end: Vec2 }
  | { kind: 'arc'; start: Vec2; end: Vec2; bulge: number }

export interface Wall {
  id: string
  typeId: string
  levelId: string
  baseline: Baseline
  baseOffset: number
  top: TopConstraint
  locationLine: LocationLine
  /** Swaps which side is "exterior". The location line is the flip pivot. */
  flipped: boolean
  roomBounding: boolean
}

// ---------------------------------------------------------------------------
// Openings (IFC two-step: host → opening → filling)
// ---------------------------------------------------------------------------

/**
 * A void in a host element. First-class, per IFC's `IfcOpeningElement`: the opening voids the
 * host and a door/window *fills* it. `hostId` (not `wallId`) so slabs and roofs can be voided.
 */
export interface Opening {
  id: string
  hostId: string
  /** Distance along the host from its baseline start to the opening's near edge. */
  offset: number
  width: number
  height: number
  sillHeight: number
  /** OPENING cuts through; RECESS is shallower than the host. */
  predefinedType: 'opening' | 'recess'
  /** Recess depth; ignored for through-openings. */
  depth: number | null
}

/** A door or window filling an opening. */
export interface Filling {
  id: string
  openingId: string
  typeId: string
  /** Mirrors the leaf across the opening's width. */
  flippedHand: boolean
  /** Mirrors the swing direction across the host. */
  flippedFacing: boolean
}

// ---------------------------------------------------------------------------
// Slabs, columns, beams
// ---------------------------------------------------------------------------

export interface Slab {
  id: string
  typeId: string
  levelId: string
  /** Outer boundary. Inner loops become openings in the slab. */
  boundary: Vec2[]
  /** Elevation of the slab's TOP relative to its level. */
  heightOffset: number
  /**
   * Openings/shafts (B8): inner-loop polygons in the same absolute scene-2D space as `boundary`,
   * each a full-thickness through-cut (a stairwell, a vertical shaft) — never a partial recess,
   * unlike a wall `Opening`. Empty for a slab with no cuts.
   */
  openings: Vec2[][]
}

export interface Column {
  id: string
  typeId: string
  levelId: string
  position: Vec2
  baseOffset: number
  top: TopConstraint
  /** Rotation about the vertical axis, degrees. */
  rotation: number
}

export interface Beam {
  id: string
  typeId: string
  levelId: string
  start: Vec2
  end: Vec2
  /** Elevation of the beam's reference axis relative to its level. */
  heightOffset: number
  /** Rotation of the cross-section about the beam axis, degrees. */
  crossSectionRotation: number
}

// ---------------------------------------------------------------------------
// Roofs (B1)
// ---------------------------------------------------------------------------

/** Per-edge roof pitch, in the order the footprint's edges are wound. */
export interface RoofEdge {
  /** Slope from horizontal, degrees. Must be in (0, 90) — a flat edge is a parapet, not a roof. */
  angle: number
  /** Horizontal distance the eave extends beyond the footprint edge. */
  overhang: number
}

/**
 * A roof over a closed footprint. v1 geometry (`shared/geometry/roof.ts`) only resolves
 * footprints that are rectangles with the SAME angle on all four edges — see DECISIONS.md D-018.
 * `edges[]` is still stored per-edge so a future general solver is additive, not a migration.
 */
export interface Roof {
  id: string
  typeId: string
  levelId: string
  /** Closed footprint polygon, wound consistently with `edges`. */
  footprint: Vec2[]
  /** One entry per footprint edge (edges[i] runs from footprint[i] to footprint[i+1]). */
  edges: RoofEdge[]
  /** Elevation of the eave (footprint) above the level. */
  baseHeight: number
}

// ---------------------------------------------------------------------------
// Primitive solids and boolean trees (B7 — see DECISIONS.md D-019)
// ---------------------------------------------------------------------------

/**
 * A placed primitive solid. Shape lives on the TYPE (edit the type, every instance updates, per
 * D-009); placement and per-instance scale live here, mirroring `Column`/`FurnitureItem`.
 */
export interface Primitive {
  id: string
  typeId: string
  levelId: string
  position: Vec2
  /** Elevation of the primitive's BASE above its level. */
  heightOffset: number
  /** Rotation about the vertical axis, degrees. */
  rotation: number
  /** Uniform per-instance scale. */
  scale: number
}

export type BooleanOp = 'union' | 'cut' | 'intersect'

/**
 * One node of a boolean tree. Operands are element ids and may themselves be `BooleanNode`s, which
 * is what makes this a tree rather than a flat pairing.
 *
 * The TREE is stored; the evaluated mesh never is (D-019). Evaluation is derived on demand, so a
 * boolean stays editable and re-resolves when its operands move.
 *
 * Order is significant for `cut`: `operandIds[0]` is the base solid and every later operand is
 * removed from it. `union` and `intersect` are order-independent but keep the same field so one
 * shape covers all three ops.
 */
export interface BooleanNode {
  id: string
  levelId: string
  op: BooleanOp
  operandIds: string[]
}

// ---------------------------------------------------------------------------
// Stairs (B2)
// ---------------------------------------------------------------------------

/**
 * A straight stair flight. `desiredNumberOfRisers` is stored; `actualRiserHeight` is DERIVED
 * (`shared/geometry/stair.ts` `resolveStair`) from it and the resolved rise (`top` minus the
 * base), never stored — so moving the level the stair lands on keeps the flight consistent
 * instead of drifting out of sync with a separately-stored riser height.
 */
export interface Stair {
  id: string
  typeId: string
  levelId: string
  /** Straight run in plan; only its direction and start point matter — length is derived. */
  baseline: { start: Vec2; end: Vec2 }
  baseOffset: number
  /** What the flight climbs to — reuses the wall/column TopConstraint union. */
  top: TopConstraint
  /** The user's intent; `actualRiserHeight` is what actually results from it. */
  desiredNumberOfRisers: number
}

// ---------------------------------------------------------------------------
// Railings (B3)
// ---------------------------------------------------------------------------

export interface Railing {
  id: string
  typeId: string
  levelId: string
  /** Open polyline in plan (>= 2 points) — a wall's baseline generalised to several segments. */
  path: Vec2[]
  /** Elevation of the walking surface the railing stands on, relative to its level. */
  baseOffset: number
}

// ---------------------------------------------------------------------------
// Ceilings (B5)
// ---------------------------------------------------------------------------

/**
 * A ceiling: a boundary polygon like Slab, but anchored at its finished BOTTOM face. `top` reuses
 * the wall/column/stair `TopConstraint` union to place that bottom face — pointing it at the level
 * ABOVE (the default, matching how a wall's `top` reaches the underside of the storey above it)
 * is what "attaches to the underside of a level" means here. The ceiling's assembly then extends
 * UPWARD from that face by its type's thickness, the mirror image of how a Slab extends downward
 * from its stored top.
 */
export interface Ceiling {
  id: string
  typeId: string
  levelId: string
  boundary: Vec2[]
  top: TopConstraint
}

// ---------------------------------------------------------------------------
// Rooms & furniture
// ---------------------------------------------------------------------------

export interface Room {
  id: string
  levelId: string
  name: string
  number: string
  /** Explicit boundary. (Deriving boundaries from bounding walls is a later phase.) */
  polygon: Vec2[]
  floorMaterial: string
  baseOffset: number
  /** Top of the room volume. */
  top: TopConstraint
}

export interface FurnitureItem {
  id: string
  typeId: string
  levelId: string
  position: Vec2
  rotation: number
  scale: number
  /** Elevation above the level (a wall-mounted item sits above 0). */
  heightOffset: number
}

// ---------------------------------------------------------------------------
// Views (saved camera + visibility state)
// ---------------------------------------------------------------------------

export type ViewProjection = 'orthographic' | 'perspective'

export interface SavedView {
  id: string
  name: string
  cameraPosition: Vec3
  cameraTarget: Vec3
  projection: ViewProjection
  /** Associated level (plan views pin to one); null = free 3D view. */
  levelId: string | null
  /** World-Y elevation above which geometry is clipped; null = no cut. */
  cutPlaneHeight: number | null
  /** Subset of levels to show; null = all visible. */
  visibleLevelIds: string[] | null
  /** 2D crop rectangle in scene coords; null = uncropped. */
  cropRegion: { min: Vec2; max: Vec2 } | null
  /** Work-plane elevation saved with the view so restoring it resumes drawing at the same plane. */
  workPlaneElevation: number
}

// ---------------------------------------------------------------------------
// Dimensions (parametric — update when measured geometry moves)
// ---------------------------------------------------------------------------

export type DimensionKind =
  | 'aligned'
  | 'linear-horizontal'
  | 'linear-vertical'
  | 'angular'
  | 'radial'
  | 'diameter'
  | 'arc-length'

/** A reference to a point on a scene element. */
export interface DimensionRef {
  elementId: string
  /** 0 = start / first vertex, 1 = end / second vertex, etc. */
  pointIndex: number
}

export interface Dimension {
  id: string
  viewId: string
  kind: DimensionKind
  ref1: DimensionRef
  ref2: DimensionRef
  /** Override the auto-computed text; null = live value. */
  textOverride: string | null
  /** How far the witness lines extend past the geometry, in scene units. */
  witnessGap: number
  /** Perpendicular offset of the dimension line from the measured edge. */
  offsetDistance: number
}

// ---------------------------------------------------------------------------
// Annotations (text, labels, leaders)
// ---------------------------------------------------------------------------

/**
 * `spot-elevation` / `spot-coordinate` / `spot-slope` (C4) are readouts computed from a picked
 * point at PLACEMENT time — the same "sample what Dynamic UCS is showing right now" model the rest
 * of the editor already uses (hover a face to re-plane, then click), rather than a continuously
 * live reference to a host element. See DECISIONS.md for why that scope was chosen.
 */
export type AnnotationKind =
  | 'text'
  | 'label'
  | 'leader'
  | 'spot-elevation'
  | 'spot-coordinate'
  | 'spot-slope'

export interface Annotation {
  id: string
  viewId: string
  kind: AnnotationKind
  text: string
  /** Anchor position in scene 2D. */
  position: Vec2
  /** For leaders: the arrowhead touches this point. Null for plain text / labels. */
  leaderTarget: Vec2 | null
  /** Rotation in degrees. */
  rotation: number
  /** Text height in scene units (not screen pixels — scales with zoom). */
  textHeight: number
  /** World elevation at `position`, sampled at placement — only set for `spot-elevation`. */
  elevation: number | null
  /** Roof grade (%) under `position`, sampled at placement — only set for `spot-slope`. */
  slope: number | null
}

// ---------------------------------------------------------------------------
// Room tags
// ---------------------------------------------------------------------------

export interface RoomTag {
  id: string
  viewId: string
  roomId: string
  /** Override position; when null the tag sits at the room polygon centroid. */
  position: Vec2 | null
  showArea: boolean
  showNumber: boolean
  showName: boolean
}

// ---------------------------------------------------------------------------
// Column grids (B6) — named axes for structural/planning reference
// ---------------------------------------------------------------------------

/** One axis in a grid. Distances are per-axis so non-uniform bays and radial grids both work. */
export interface GridAxis {
  id: string
  /** Bubble text — "1", "2", "A", "B"... Free-form so any numbering convention works. */
  label: string
  /** Distance from the PREVIOUS axis in this direction; 0 for the first axis. */
  spacing: number
}

export interface ColumnGrid {
  id: string
  levelId: string
  name: string
  /** Grid origin (axis "1"/"A" intersection) in scene 2D. */
  origin: Vec2
  /** Rotation of the whole grid in plan, degrees — for a grid that isn't building-aligned. */
  rotation: number
  /** Axes running in the grid's local +X direction — typically numbered. */
  xAxes: GridAxis[]
  /** Axes running in the grid's local +Y direction — typically lettered. */
  yAxes: GridAxis[]
  /** How far each grid line extends past the outermost perpendicular axis, for the bubble draw. */
  extension: number
  bubbleRadius: number
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export type Units = 'm' | 'ft' | 'cm' | 'mm'

export interface SceneGraph {
  schemaVersion: typeof SCHEMA_VERSION
  projectId: string
  units: Units
  types: ElementTypeDef[]
  levels: Level[]
  walls: Wall[]
  openings: Opening[]
  fillings: Filling[]
  slabs: Slab[]
  columns: Column[]
  beams: Beam[]
  rooms: Room[]
  furniture: FurnitureItem[]
  materials: Material[]
  views: SavedView[]
  dimensions: Dimension[]
  annotations: Annotation[]
  roomTags: RoomTag[]
  columnGrids: ColumnGrid[]
  roofs: Roof[]
  primitives: Primitive[]
  booleans: BooleanNode[]
  stairs: Stair[]
  railings: Railing[]
  ceilings: Ceiling[]
}

/** Every collection key that holds scene elements (BIM model objects). */
export const ELEMENT_COLLECTIONS = [
  'walls',
  'openings',
  'fillings',
  'slabs',
  'columns',
  'beams',
  'rooms',
  'furniture',
  'columnGrids',
  'roofs',
  'primitives',
  'booleans',
  'stairs',
  'railings',
  'ceilings',
] as const

export type ElementCollection = (typeof ELEMENT_COLLECTIONS)[number]

/** Collections that hold view-scoped annotation objects. */
export const ANNOTATION_COLLECTIONS = [
  'dimensions',
  'annotations',
  'roomTags',
] as const

export type AnnotationCollection = (typeof ANNOTATION_COLLECTIONS)[number]

/** A partial update — only the changed collections are present. */
export type SceneDiff = Partial<
  Pick<SceneGraph, ElementCollection | AnnotationCollection | 'types' | 'levels' | 'materials' | 'views'>
>

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_MATERIALS: Material[] = [
  { id: 'mat-plaster-white', name: 'White Plaster', color: '#EDEAE3', textureUrl: null },
  { id: 'mat-oak', name: 'Oak', color: '#B08850', textureUrl: null },
  { id: 'mat-concrete', name: 'Concrete', color: '#9E9E9E', textureUrl: null },
  { id: 'mat-brick', name: 'Brick', color: '#A8503A', textureUrl: null },
  { id: 'mat-glass', name: 'Glass', color: '#AFC6D2', textureUrl: null },
  { id: 'mat-steel', name: 'Steel', color: '#8B9199', textureUrl: null },
  { id: 'mat-timber', name: 'Timber', color: '#C79A62', textureUrl: null },
  { id: 'mat-tile', name: 'Ceramic Tile', color: '#D9D5CC', textureUrl: null },
]

export const DEFAULT_TYPES: ElementTypeDef[] = [
  {
    id: 'wt-ext-200',
    category: 'wall',
    name: 'Exterior — 200mm',
    function: 'exterior',
    layers: [
      { material: 'mat-plaster-white', thickness: 0.015, function: 'finish' },
      { material: 'mat-brick', thickness: 0.17, function: 'structure' },
      { material: 'mat-plaster-white', thickness: 0.015, function: 'finish' },
    ],
  },
  {
    id: 'wt-int-100',
    category: 'wall',
    name: 'Interior partition — 100mm',
    function: 'partition',
    layers: [
      { material: 'mat-plaster-white', thickness: 0.0125, function: 'finish' },
      { material: 'mat-concrete', thickness: 0.075, function: 'structure' },
      { material: 'mat-plaster-white', thickness: 0.0125, function: 'finish' },
    ],
  },
  {
    id: 'dt-single-900',
    category: 'door',
    name: 'Single door — 900×2100',
    width: 0.9,
    height: 2.1,
    thickness: 0.045,
    operation: 'single-swing',
    frameMaterial: 'mat-timber',
    panelMaterial: 'mat-timber',
  },
  {
    id: 'wnt-1200',
    category: 'window',
    name: 'Window — 1200×1200',
    width: 1.2,
    height: 1.2,
    defaultSillHeight: 0.9,
    frameThickness: 0.06,
    partitioning: 'double-vertical',
    frameMaterial: 'mat-timber',
    glassMaterial: 'mat-glass',
  },
  {
    id: 'st-floor-200',
    category: 'slab',
    name: 'Floor slab — 200mm',
    function: 'floor',
    layers: [
      { material: 'mat-oak', thickness: 0.02, function: 'finish' },
      { material: 'mat-concrete', thickness: 0.18, function: 'structure' },
    ],
  },
  {
    id: 'ct-rect-300',
    category: 'column',
    name: 'Column — 300×300',
    profile: { kind: 'rectangular', width: 0.3, depth: 0.3 },
    material: 'mat-concrete',
  },
  {
    id: 'bt-rect-200x400',
    category: 'beam',
    name: 'Beam — 200×400',
    profile: { kind: 'rectangular', width: 0.2, depth: 0.4 },
    material: 'mat-concrete',
  },
  {
    id: 'rt-tile-250',
    category: 'roof',
    name: 'Tiled roof — 250mm',
    layers: [
      { material: 'mat-tile', thickness: 0.02, function: 'finish' },
      { material: 'mat-timber', thickness: 0.23, function: 'structure' },
    ],
  },
  // One default type per primitive shape (B7), so the tool's type selector is populated on a
  // fresh project and every shape is reachable without authoring a type first.
  {
    id: 'pt-box',
    category: 'primitive',
    name: 'Box — 1×1×1',
    shape: { kind: 'box', width: 1, depth: 1, height: 1 },
    material: 'mat-concrete',
  },
  {
    id: 'pt-cylinder',
    category: 'primitive',
    name: 'Cylinder — ⌀1 × 1',
    shape: { kind: 'cylinder', radius: 0.5, height: 1, segments: 32 },
    material: 'mat-concrete',
  },
  {
    id: 'pt-cone',
    category: 'primitive',
    name: 'Cone — ⌀1 × 1',
    shape: { kind: 'cone', radius: 0.5, height: 1, segments: 32 },
    material: 'mat-concrete',
  },
  {
    id: 'pt-sphere',
    category: 'primitive',
    name: 'Sphere — ⌀1',
    shape: { kind: 'sphere', radius: 0.5, segments: 24 },
    material: 'mat-concrete',
  },
  {
    id: 'pt-prism',
    category: 'primitive',
    name: 'Prism — hexagonal',
    shape: { kind: 'prism', radius: 0.5, height: 1, sides: 6 },
    material: 'mat-concrete',
  },
  {
    id: 'pt-wedge',
    category: 'primitive',
    name: 'Wedge — 1×1×1',
    shape: { kind: 'wedge', width: 1, depth: 1, height: 1 },
    material: 'mat-concrete',
  },
  {
    id: 'pt-torus',
    category: 'primitive',
    name: 'Torus — ⌀1 tube 0.2',
    shape: { kind: 'torus', radius: 0.5, tubeRadius: 0.2, radialSegments: 16, tubularSegments: 32 },
    material: 'mat-steel',
  },
  {
    id: 'st-stair-280',
    category: 'stair',
    name: 'Stair — 1000mm wide, 280mm tread',
    width: 1,
    treadDepth: 0.28,
    material: 'mat-oak',
  },
  {
    id: 'rl-standard',
    category: 'railing',
    name: 'Railing — 900mm',
    height: 0.9,
    postThickness: 0.04,
    postSpacing: 1,
    material: 'mat-steel',
  },
  {
    id: 'clt-plaster-15',
    category: 'ceiling',
    name: 'Plaster ceiling — 15mm',
    layers: [{ material: 'mat-plaster-white', thickness: 0.015, function: 'finish' }],
  },
]

export function emptySceneGraph(projectId: string): SceneGraph {
  return {
    schemaVersion: SCHEMA_VERSION,
    projectId,
    units: 'm',
    types: DEFAULT_TYPES.map((t) => ({ ...t })),
    levels: [],
    walls: [],
    openings: [],
    fillings: [],
    slabs: [],
    columns: [],
    beams: [],
    rooms: [],
    furniture: [],
    materials: DEFAULT_MATERIALS.map((m) => ({ ...m })),
    views: [],
    dimensions: [],
    annotations: [],
    roomTags: [],
    columnGrids: [],
    roofs: [],
    primitives: [],
    booleans: [],
    stairs: [],
    railings: [],
    ceilings: [],
  }
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findType(scene: SceneGraph, typeId: string): ElementTypeDef | undefined {
  return scene.types.find((t) => t.id === typeId)
}

export function findWallType(scene: SceneGraph, typeId: string): WallTypeDef | undefined {
  const t = findType(scene, typeId)
  return t?.category === 'wall' ? t : undefined
}

export function findSlabType(scene: SceneGraph, typeId: string): SlabTypeDef | undefined {
  const t = findType(scene, typeId)
  return t?.category === 'slab' ? t : undefined
}

export function findRoofType(scene: SceneGraph, typeId: string): RoofTypeDef | undefined {
  const t = findType(scene, typeId)
  return t?.category === 'roof' ? t : undefined
}

export function findPrimitiveType(
  scene: SceneGraph,
  typeId: string,
): PrimitiveTypeDef | undefined {
  const t = findType(scene, typeId)
  return t?.category === 'primitive' ? t : undefined
}

export function findStairType(scene: SceneGraph, typeId: string): StairTypeDef | undefined {
  const t = findType(scene, typeId)
  return t?.category === 'stair' ? t : undefined
}

export function findRailingType(scene: SceneGraph, typeId: string): RailingTypeDef | undefined {
  const t = findType(scene, typeId)
  return t?.category === 'railing' ? t : undefined
}

export function findCeilingType(scene: SceneGraph, typeId: string): CeilingTypeDef | undefined {
  const t = findType(scene, typeId)
  return t?.category === 'ceiling' ? t : undefined
}

export function findLevel(scene: SceneGraph, levelId: string): Level | undefined {
  return scene.levels.find((l) => l.id === levelId)
}

/** Total thickness of a compound assembly. */
export function assemblyThickness(layers: MaterialLayer[]): number {
  return layers.reduce((sum, l) => sum + l.thickness, 0)
}

/** Resolve a `TopConstraint` to an absolute world elevation. */
export function resolveTopElevation(
  scene: SceneGraph,
  top: TopConstraint,
  baseElevation: number,
): number {
  if (top.kind === 'unconnected') return baseElevation + top.height
  if (top.kind === 'roof') {
    const roof = scene.roofs.find((r) => r.id === top.roofId)
    // A NOMINAL (unramped) reference elevation — the roof's own datum. A wall additionally ramps
    // around this in `shared/geometry/index.ts` resolveWall; other elements (column, room) that
    // point a TopConstraint at a roof just get this flat value.
    return roof ? roof.baseHeight : baseElevation + 2.8 // orphaned — same fallback as a dead level
  }
  const level = findLevel(scene, top.levelId)
  if (!level) return baseElevation + 2.8 // orphaned constraint — fall back to a sane storey height
  return level.elevation + top.offset
}
