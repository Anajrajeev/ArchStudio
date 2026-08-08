"""Pydantic v2 models for the ArchStudio scene graph — schema v9.

These MUST stay in sync with `shared/types/scene.ts`, which is the canonical schema.
The sections below appear in the same order and carry the same banner comments as that
file, so the two can be diffed side by side; `shared/fixtures/` holds golden documents
that both sides validate against, so a TS schema bump fails this side's tests instead of
drifting silently (it drifted five versions before that lock existed).

Migration is deliberately NOT implemented here. `shared/types/migrate.ts` runs client-side
and is the single implementation of the "old projects must always load" contract; a second
copy in Python would double the surface that can drift. `parse_scene` refuses anything that
is not the current version, with a message saying so.

Note on serialisation: `Vec2`/`Vec3` are tuples, so plain `model_dump()` yields tuples while
`model_dump(mode="json")` yields lists. Use `mode="json"` for anything crossing the wire.
"""
from __future__ import annotations

from typing import Annotated, Final, Literal

from pydantic import BaseModel, Field

Vec2 = tuple[float, float]
Vec3 = tuple[float, float, float]

SCHEMA_VERSION: Final = 9

# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------


class Material(BaseModel):
    id: str
    name: str
    color: str
    texture_url: str | None = Field(alias="textureUrl", default=None)

    model_config = {"populate_by_name": True}


LayerFunction = Literal["structure", "substrate", "thermal", "membrane", "finish"]


class MaterialLayer(BaseModel):
    """One layer of a compound assembly (wall/slab), mirroring IFC's IfcMaterialLayerSetUsage."""

    material: str
    thickness: float = Field(gt=0)
    function: LayerFunction


# ---------------------------------------------------------------------------
# Type layer (Category → Type → Instance)
# ---------------------------------------------------------------------------

TypeCategory = Literal[
    "wall",
    "door",
    "window",
    "slab",
    "column",
    "beam",
    "furniture",
    "roof",
    "primitive",
    "stair",
    "railing",
    "ceiling",
    "curtainWall",
]


class WallTypeDef(BaseModel):
    id: str
    category: Literal["wall"]
    name: str
    #: Compound structure. Total thickness is the sum — never stored separately.
    layers: list[MaterialLayer] = Field(min_length=1)
    function: Literal["exterior", "interior", "partition"]


class DoorTypeDef(BaseModel):
    id: str
    category: Literal["door"]
    name: str
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    thickness: float = Field(gt=0)
    operation: Literal["single-swing", "double-swing", "sliding", "folding"]
    frame_material: str = Field(alias="frameMaterial")
    panel_material: str = Field(alias="panelMaterial")

    model_config = {"populate_by_name": True}


class WindowTypeDef(BaseModel):
    id: str
    category: Literal["window"]
    name: str
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    default_sill_height: float = Field(ge=0, alias="defaultSillHeight")
    frame_thickness: float = Field(gt=0, alias="frameThickness")
    partitioning: Literal["single", "double-horizontal", "double-vertical", "triple-vertical"]
    frame_material: str = Field(alias="frameMaterial")
    glass_material: str = Field(alias="glassMaterial")

    model_config = {"populate_by_name": True}


class SlabTypeDef(BaseModel):
    id: str
    category: Literal["slab"]
    name: str
    layers: list[MaterialLayer] = Field(min_length=1)
    function: Literal["floor", "roof", "landing", "ceiling"]


class RectangularProfile(BaseModel):
    kind: Literal["rectangular"]
    width: float = Field(gt=0)
    depth: float = Field(gt=0)


class CircularProfile(BaseModel):
    kind: Literal["circular"]
    diameter: float = Field(gt=0)


ProfileShape = Annotated[RectangularProfile | CircularProfile, Field(discriminator="kind")]


class ColumnTypeDef(BaseModel):
    id: str
    category: Literal["column"]
    name: str
    profile: ProfileShape
    material: str


class BeamTypeDef(BaseModel):
    id: str
    category: Literal["beam"]
    name: str
    profile: ProfileShape
    material: str


class FurnitureTypeDef(BaseModel):
    id: str
    category: Literal["furniture"]
    name: str
    #: glTF asset in the catalog; null renders a labelled placeholder box.
    catalog_id: str | None = Field(alias="catalogId", default=None)
    #: Bounding footprint, used for the 2D symbol and the placeholder box.
    footprint: Vec2
    height_meters: float = Field(gt=0, alias="heightMeters")
    material: str

    model_config = {"populate_by_name": True}


class RoofTypeDef(BaseModel):
    id: str
    category: Literal["roof"]
    name: str
    layers: list[MaterialLayer] = Field(min_length=1)


class BoxShape(BaseModel):
    kind: Literal["box"]
    width: float = Field(gt=0)
    depth: float = Field(gt=0)
    height: float = Field(gt=0)


class CylinderShape(BaseModel):
    kind: Literal["cylinder"]
    radius: float = Field(gt=0)
    height: float = Field(gt=0)
    segments: int = Field(ge=3)


class ConeShape(BaseModel):
    kind: Literal["cone"]
    radius: float = Field(gt=0)
    height: float = Field(gt=0)
    segments: int = Field(ge=3)


class SphereShape(BaseModel):
    kind: Literal["sphere"]
    radius: float = Field(gt=0)
    #: Below 4 the tessellation degenerates to a bipyramid (shared/geometry/primitives.ts).
    segments: int = Field(ge=4)


class PrismShape(BaseModel):
    """A regular N-gon extruded vertically."""

    kind: Literal["prism"]
    radius: float = Field(gt=0)
    height: float = Field(gt=0)
    sides: int = Field(ge=3)


class WedgeShape(BaseModel):
    """A right triangular wedge: full height at -depth/2, zero height at +depth/2."""

    kind: Literal["wedge"]
    width: float = Field(gt=0)
    depth: float = Field(gt=0)
    height: float = Field(gt=0)


class TorusShape(BaseModel):
    kind: Literal["torus"]
    radius: float = Field(gt=0)
    tube_radius: float = Field(gt=0, alias="tubeRadius")
    radial_segments: int = Field(ge=3, alias="radialSegments")
    tubular_segments: int = Field(ge=3, alias="tubularSegments")

    model_config = {"populate_by_name": True}


PrimitiveShape = Annotated[
    BoxShape | CylinderShape | ConeShape | SphereShape | PrismShape | WedgeShape | TorusShape,
    Field(discriminator="kind"),
]

PrimitiveKind = Literal["box", "cylinder", "cone", "sphere", "prism", "wedge", "torus"]

PRIMITIVE_KINDS: Final[tuple[PrimitiveKind, ...]] = (
    "box",
    "cylinder",
    "cone",
    "sphere",
    "prism",
    "wedge",
    "torus",
)


class PrimitiveTypeDef(BaseModel):
    id: str
    category: Literal["primitive"]
    name: str
    shape: PrimitiveShape
    material: str


class StairTypeDef(BaseModel):
    """A straight stair flight (B2). Shape lives here; risers/rise are per-instance (Stair)."""

    id: str
    category: Literal["stair"]
    name: str
    width: float = Field(gt=0)
    tread_depth: float = Field(gt=0, alias="treadDepth")
    material: str

    model_config = {"populate_by_name": True}


class RailingTypeDef(BaseModel):
    """A railing (B3): a continuous top rail plus evenly spaced posts along an open path."""

    id: str
    category: Literal["railing"]
    name: str
    height: float = Field(gt=0)
    post_thickness: float = Field(gt=0, alias="postThickness")
    post_spacing: float = Field(gt=0, alias="postSpacing")
    material: str

    model_config = {"populate_by_name": True}


class CeilingTypeDef(BaseModel):
    """A ceiling (B5): a boundary polygon like Slab, anchored at its finished BOTTOM face."""

    id: str
    category: Literal["ceiling"]
    name: str
    layers: list[MaterialLayer] = Field(min_length=1)


class GridFixedNumber(BaseModel):
    """Exactly `count` equal bays."""

    kind: Literal["fixedNumber"]
    count: int = Field(gt=0)


class GridFixedDistance(BaseModel):
    """Bays of exactly `spacing`, with the remainder becoming a shorter final bay."""

    kind: Literal["fixedDistance"]
    spacing: float = Field(gt=0)


class GridMaximumSpacing(BaseModel):
    """The fewest EQUAL bays such that none exceeds `spacing`."""

    kind: Literal["maximumSpacing"]
    spacing: float = Field(gt=0)


GridRule = Annotated[
    GridFixedNumber | GridFixedDistance | GridMaximumSpacing, Field(discriminator="kind")
]


class CurtainWallTypeDef(BaseModel):
    """A curtain wall (B4): a mullion/panel grid, not a layered assembly.

    Its own category rather than a WallTypeDef variant — it has no `layers`, so
    `assembly_thickness` is meaningless for it, and it takes no Openings. See D-027.
    Panels are sized BY the grid; there is no panel width or height field by design.
    """

    id: str
    category: Literal["curtainWall"]
    name: str
    grid_u: GridRule = Field(alias="gridU")
    grid_v: GridRule = Field(alias="gridV")
    mullion_width: float = Field(gt=0, alias="mullionWidth")
    mullion_depth: float = Field(gt=0, alias="mullionDepth")
    panel_thickness: float = Field(gt=0, alias="panelThickness")
    panel_material: str = Field(alias="panelMaterial")
    mullion_material: str = Field(alias="mullionMaterial")

    model_config = {"populate_by_name": True}


ElementTypeDef = Annotated[
    WallTypeDef
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
    | CurtainWallTypeDef,
    Field(discriminator="category"),
]

# ---------------------------------------------------------------------------
# Levels
# ---------------------------------------------------------------------------


class Level(BaseModel):
    id: str
    name: str
    elevation: float
    #: Nominal floor-to-floor height; the default top for unconnected elements on this level.
    height: float = Field(gt=0)
    #: A functional building storey vs. an ancillary reference level (landing, top-of-steel).
    is_building_story: bool = Field(alias="isBuildingStory")
    #: Height above the level at which room perimeter/area is computed.
    computation_height: float = Field(alias="computationHeight")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Vertical extent — the constraint union
# ---------------------------------------------------------------------------


class TopLevelConstraint(BaseModel):
    """Tracks a level, so changing storey heights updates the element."""

    kind: Literal["level"]
    level_id: str = Field(alias="levelId")
    offset: float

    model_config = {"populate_by_name": True}


class TopUnconnected(BaseModel):
    """A fixed height that does not track a level."""

    kind: Literal["unconnected"]
    height: float = Field(gt=0)


class TopRoofConstraint(BaseModel):
    """The top follows a roof's underside (B1 wall voiding).

    Only a Wall resolves this to a ramped top (shared/geometry/roof.ts wallRoofRamp); a Column or
    Room using it just reads the roof's baseHeight as a flat reference.
    """

    kind: Literal["roof"]
    roof_id: str = Field(alias="roofId")

    model_config = {"populate_by_name": True}


TopConstraint = Annotated[
    TopLevelConstraint | TopUnconnected | TopRoofConstraint, Field(discriminator="kind")
]

# ---------------------------------------------------------------------------
# Walls
# ---------------------------------------------------------------------------

LocationLine = Literal["centerline", "finish-exterior", "finish-interior"]


class BaselineLine(BaseModel):
    kind: Literal["line"]
    start: Vec2
    end: Vec2


class BaselineArc(BaseModel):
    """Arc stored as a bulge factor (DXF convention, tan(theta/4)) to stay purely parametric."""

    kind: Literal["arc"]
    start: Vec2
    end: Vec2
    #: Signed — the sign places the arc centre, so it is deliberately unconstrained.
    bulge: float


Baseline = Annotated[BaselineLine | BaselineArc, Field(discriminator="kind")]


class Wall(BaseModel):
    id: str
    type_id: str = Field(alias="typeId")
    level_id: str = Field(alias="levelId")
    baseline: Baseline
    base_offset: float = Field(alias="baseOffset")
    top: TopConstraint
    location_line: LocationLine = Field(alias="locationLine")
    #: Swaps which side is "exterior". The location line is the flip pivot.
    flipped: bool
    room_bounding: bool = Field(alias="roomBounding")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Wall joins (A9 — see DECISIONS.md D-026)
# ---------------------------------------------------------------------------

WallJoinStyle = Literal["miter", "butt"]


class WallJoin(BaseModel):
    """An explicit cleanup relationship between walls meeting at a point.

    A first-class object rather than a field on Wall, because at a T- or X-junction a stem
    meets another wall's MIDDLE, not its end. Carries no geometry: every trim and mitre angle
    is derived from the members' current baselines by `shared/geometry/wallJoin.ts`.
    """

    id: str
    level_id: str = Field(alias="levelId")
    #: The walls meeting here (2-4). Order is irrelevant; the resolver derives each wall's role.
    member_ids: list[str] = Field(min_length=2, alias="memberIds")
    point: Vec2
    style: WallJoinStyle
    #: For a butt: which wall runs THROUGH, the others trimming to its face. None = auto-pick.
    through_id: str | None = Field(alias="throughId", default=None)

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Curtain walls (B4 — see DECISIONS.md D-027)
# ---------------------------------------------------------------------------


class CurtainWall(BaseModel):
    """A placed curtain wall, reusing Baseline and the TopConstraint union.

    v1 geometry resolves STRAIGHT baselines only; an arc is refused, not approximated.
    """

    id: str
    type_id: str = Field(alias="typeId")
    level_id: str = Field(alias="levelId")
    baseline: Baseline
    base_offset: float = Field(alias="baseOffset")
    top: TopConstraint

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Groups (D5 — see DECISIONS.md D-028)
# ---------------------------------------------------------------------------


class ElementGroup(BaseModel):
    """An isolation boundary over existing elements.

    A member id may be another group's id, forming a tree — the same referencing-node shape
    BooleanNode uses. A group has no geometry and no renderer.
    """

    id: str
    name: str
    #: Element ids, or other group ids.
    member_ids: list[str] = Field(alias="memberIds")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Openings (IFC two-step: host → opening → filling)
# ---------------------------------------------------------------------------


class Opening(BaseModel):
    """A void in a host element, per IFC's IfcOpeningElement.

    `host_id` (not `wall_id`) so slabs and roofs can be voided too.
    """

    id: str
    host_id: str = Field(alias="hostId")
    #: Distance along the host from its baseline start to the opening's near edge.
    offset: float = Field(ge=0)
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    sill_height: float = Field(ge=0, alias="sillHeight")
    #: OPENING cuts through; RECESS is shallower than the host.
    predefined_type: Literal["opening", "recess"] = Field(alias="predefinedType")
    #: Recess depth; ignored for through-openings.
    depth: float | None = Field(default=None)

    model_config = {"populate_by_name": True}


class Filling(BaseModel):
    """A door or window filling an opening."""

    id: str
    opening_id: str = Field(alias="openingId")
    type_id: str = Field(alias="typeId")
    #: Mirrors the leaf across the opening's width.
    flipped_hand: bool = Field(alias="flippedHand")
    #: Mirrors the swing direction across the host.
    flipped_facing: bool = Field(alias="flippedFacing")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Slabs, columns, beams
# ---------------------------------------------------------------------------


class Slab(BaseModel):
    id: str
    type_id: str = Field(alias="typeId")
    level_id: str = Field(alias="levelId")
    #: Outer boundary. Inner loops become openings in the slab.
    boundary: list[Vec2] = Field(min_length=3)
    #: Elevation of the slab's TOP relative to its level.
    height_offset: float = Field(alias="heightOffset")
    #: Openings/shafts (B8): inner-loop polygons in the same scene-2D space as `boundary`, each a
    #: full-thickness through-cut. Empty for a slab with no cuts.
    openings: list[list[Vec2]] = []

    model_config = {"populate_by_name": True}


class Column(BaseModel):
    id: str
    type_id: str = Field(alias="typeId")
    level_id: str = Field(alias="levelId")
    position: Vec2
    base_offset: float = Field(alias="baseOffset")
    top: TopConstraint
    #: Rotation about the vertical axis, degrees.
    rotation: float

    model_config = {"populate_by_name": True}


class Beam(BaseModel):
    id: str
    type_id: str = Field(alias="typeId")
    level_id: str = Field(alias="levelId")
    start: Vec2
    end: Vec2
    #: Elevation of the beam's reference axis relative to its level.
    height_offset: float = Field(alias="heightOffset")
    #: Rotation of the cross-section about the beam axis, degrees.
    cross_section_rotation: float = Field(alias="crossSectionRotation")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Roofs (B1)
# ---------------------------------------------------------------------------


class RoofEdge(BaseModel):
    """Per-edge roof pitch, in the order the footprint's edges are wound."""

    #: Slope from horizontal, degrees. A flat edge is a parapet, not a roof.
    angle: float = Field(gt=0, lt=90)
    #: Horizontal distance the eave extends beyond the footprint edge.
    overhang: float = Field(ge=0)


class Roof(BaseModel):
    """A roof over a closed footprint.

    v1 geometry only resolves rectangular footprints with one shared angle (D-018); `edges`
    is still per-edge so a future general solver is additive rather than a migration.
    """

    id: str
    type_id: str = Field(alias="typeId")
    level_id: str = Field(alias="levelId")
    #: Closed footprint polygon, wound consistently with `edges`.
    footprint: list[Vec2] = Field(min_length=3)
    #: One entry per footprint edge (edges[i] runs from footprint[i] to footprint[i+1]).
    edges: list[RoofEdge] = Field(min_length=3)
    #: Elevation of the eave (footprint) above the level.
    base_height: float = Field(alias="baseHeight")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Primitive solids and boolean trees (B7 — see DECISIONS.md D-019)
# ---------------------------------------------------------------------------


class Primitive(BaseModel):
    """A placed primitive solid.

    Shape lives on the TYPE (edit the type, every instance updates, per D-009); placement and
    per-instance scale live here, mirroring Column/FurnitureItem.
    """

    id: str
    type_id: str = Field(alias="typeId")
    level_id: str = Field(alias="levelId")
    position: Vec2
    #: Elevation of the primitive's BASE above its level.
    height_offset: float = Field(alias="heightOffset")
    #: Rotation about the vertical axis, degrees.
    rotation: float
    #: Uniform per-instance scale.
    scale: float = Field(gt=0)

    model_config = {"populate_by_name": True}


BooleanOp = Literal["union", "cut", "intersect"]

#: Minimum operands any boolean op needs to mean anything (mirrors MIN_OPERANDS in booleanTree.ts).
MIN_OPERANDS: Final = 2


class BooleanNode(BaseModel):
    """One node of a boolean tree. Operands may themselves be BooleanNodes.

    The TREE is stored; the evaluated mesh never is (D-019). Order is significant for `cut`:
    operand_ids[0] is the base solid and every later operand is removed from it.
    """

    id: str
    level_id: str = Field(alias="levelId")
    op: BooleanOp
    operand_ids: list[str] = Field(min_length=MIN_OPERANDS, alias="operandIds")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Stairs (B2)
# ---------------------------------------------------------------------------


class StairBaseline(BaseModel):
    """A straight run in plan; only direction/start matter — length is derived (see Stair)."""

    start: Vec2
    end: Vec2


class Stair(BaseModel):
    """A straight stair flight.

    `actual_riser_height` is DERIVED from `desired_number_of_risers` and the resolved rise (top
    minus base) — `shared/geometry/stair.ts` `resolveStair` — and has no field here, matching the
    TS side: it is never stored, only computed.
    """

    id: str
    type_id: str = Field(alias="typeId")
    level_id: str = Field(alias="levelId")
    baseline: StairBaseline
    base_offset: float = Field(alias="baseOffset")
    top: TopConstraint
    desired_number_of_risers: int = Field(ge=2, alias="desiredNumberOfRisers")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Railings (B3)
# ---------------------------------------------------------------------------


class Railing(BaseModel):
    id: str
    type_id: str = Field(alias="typeId")
    level_id: str = Field(alias="levelId")
    path: list[Vec2] = Field(min_length=2)
    base_offset: float = Field(alias="baseOffset")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Ceilings (B5)
# ---------------------------------------------------------------------------


class Ceiling(BaseModel):
    """A boundary polygon like Slab, but anchored at its finished BOTTOM face.

    `top` reuses the wall/column/stair TopConstraint union to place that bottom face; pointing it
    at the level ABOVE (the usual default) is what "attaches to the underside of a level" means.
    """

    id: str
    type_id: str = Field(alias="typeId")
    level_id: str = Field(alias="levelId")
    boundary: list[Vec2] = Field(min_length=3)
    top: TopConstraint

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Rooms & furniture
# ---------------------------------------------------------------------------


class Room(BaseModel):
    id: str
    level_id: str = Field(alias="levelId")
    name: str
    number: str
    #: Explicit boundary. (Deriving boundaries from bounding walls is a later phase.)
    polygon: list[Vec2] = Field(min_length=3)
    floor_material: str = Field(alias="floorMaterial")
    base_offset: float = Field(alias="baseOffset")
    #: Top of the room volume.
    top: TopConstraint

    model_config = {"populate_by_name": True}


class FurnitureItem(BaseModel):
    id: str
    type_id: str = Field(alias="typeId")
    level_id: str = Field(alias="levelId")
    position: Vec2
    rotation: float
    scale: float = Field(gt=0)
    #: Elevation above the level (a wall-mounted item sits above 0).
    height_offset: float = Field(alias="heightOffset")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Views (saved camera + visibility state)
# ---------------------------------------------------------------------------

ViewProjection = Literal["orthographic", "perspective"]


class CropRegion(BaseModel):
    """2D crop rectangle in scene coords."""

    min: Vec2
    max: Vec2


class ViewRange(BaseModel):
    """A plan view's vertical extent (C7).

    Every value is an offset above the view's OWN level elevation, never an absolute world Y —
    so raising a storey carries its view range with it. Replaced `cut_plane_height` in v9.
    """

    #: The cut plane. Geometry above is not drawn. Conventionally ~1.2 m.
    cut_height: float = Field(alias="cutHeight")
    #: Top of the range. Geometry above is not drawn even when below the cut.
    top_offset: float = Field(alias="topOffset")
    #: Bottom of the range. Geometry below is not drawn.
    bottom_offset: float = Field(alias="bottomOffset")
    #: Extra depth below `bottom_offset` that IS drawn, dimmed, as "beyond". 0 = none.
    view_depth: float = Field(ge=0, alias="viewDepth")

    model_config = {"populate_by_name": True}


class SavedView(BaseModel):
    id: str
    name: str
    camera_position: Vec3 = Field(alias="cameraPosition")
    camera_target: Vec3 = Field(alias="cameraTarget")
    projection: ViewProjection
    #: Associated level (plan views pin to one); None = free 3D view.
    level_id: str | None = Field(alias="levelId", default=None)
    #: Vertical extent of a plan view; None = no cut (a 3D view).
    view_range: ViewRange | None = Field(alias="viewRange", default=None)
    #: Another level drawn halftone underneath this one (C8); None = no underlay.
    underlay_level_id: str | None = Field(alias="underlayLevelId", default=None)
    #: Subset of levels to show; None = all visible.
    visible_level_ids: list[str] | None = Field(alias="visibleLevelIds", default=None)
    crop_region: CropRegion | None = Field(alias="cropRegion", default=None)
    #: Work-plane elevation, so restoring the view resumes drawing at the same plane.
    work_plane_elevation: float = Field(alias="workPlaneElevation")

    model_config = {"populate_by_name": True}


class PlanRegion(BaseModel):
    """A sub-area of ONE plan view drawn at a different cut height (C7).

    An element belongs WHOLLY to whichever region contains its plan anchor point; nothing is
    split at a region boundary. See DECISIONS.md D-029.
    """

    id: str
    view_id: str = Field(alias="viewId")
    name: str
    boundary: list[Vec2] = Field(min_length=3)
    view_range: ViewRange = Field(alias="viewRange")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Dimensions (parametric — update when measured geometry moves)
# ---------------------------------------------------------------------------

DimensionKind = Literal[
    "aligned",
    "linear-horizontal",
    "linear-vertical",
    "angular",
    "radial",
    "diameter",
    "arc-length",
]


class DimensionRef(BaseModel):
    """A reference to a point on a scene element."""

    element_id: str = Field(alias="elementId")
    #: 0 = start / first vertex, 1 = end / second vertex, etc.
    point_index: int = Field(ge=0, alias="pointIndex")

    model_config = {"populate_by_name": True}


class Dimension(BaseModel):
    id: str
    view_id: str = Field(alias="viewId")
    kind: DimensionKind
    ref1: DimensionRef
    ref2: DimensionRef
    #: Override the auto-computed text; None = live value.
    text_override: str | None = Field(alias="textOverride", default=None)
    #: How far the witness lines extend past the geometry, in scene units.
    witness_gap: float = Field(alias="witnessGap")
    #: Perpendicular offset of the dimension line from the measured edge; signed.
    offset_distance: float = Field(alias="offsetDistance")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Annotations (text, labels, leaders)
# ---------------------------------------------------------------------------

AnnotationKind = Literal[
    "text",
    "label",
    "leader",
    "spot-elevation",
    "spot-coordinate",
    "spot-slope",
]


class Annotation(BaseModel):
    id: str
    view_id: str = Field(alias="viewId")
    kind: AnnotationKind
    text: str
    #: Anchor position in scene 2D.
    position: Vec2
    #: For leaders: the arrowhead touches this point. None for plain text / labels.
    leader_target: Vec2 | None = Field(alias="leaderTarget", default=None)
    #: Rotation in degrees.
    rotation: float
    #: Text height in scene units (not screen pixels — scales with zoom).
    text_height: float = Field(gt=0, alias="textHeight")
    #: World elevation at `position`, sampled at placement — only set for "spot-elevation".
    elevation: float | None = None
    #: Roof grade (%) under `position`, sampled at placement — only set for "spot-slope".
    slope: float | None = None

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Room tags
# ---------------------------------------------------------------------------


class RoomTag(BaseModel):
    id: str
    view_id: str = Field(alias="viewId")
    room_id: str = Field(alias="roomId")
    #: Override position; when None the tag sits at the room polygon centroid.
    position: Vec2 | None = Field(default=None)
    show_area: bool = Field(alias="showArea")
    show_number: bool = Field(alias="showNumber")
    show_name: bool = Field(alias="showName")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Column grids (B6) — named axes for structural/planning reference
# ---------------------------------------------------------------------------


class GridAxis(BaseModel):
    """One axis in a grid. Distances are per-axis so non-uniform and radial grids both work."""

    id: str
    #: Bubble text — "1", "2", "A", "B"... Free-form so any numbering convention works.
    label: str
    #: Distance from the PREVIOUS axis in this direction; 0 for the first axis.
    spacing: float = Field(ge=0)


class ColumnGrid(BaseModel):
    id: str
    level_id: str = Field(alias="levelId")
    name: str
    #: Grid origin (axis "1"/"A" intersection) in scene 2D.
    origin: Vec2
    #: Rotation of the whole grid in plan, degrees.
    rotation: float
    #: Axes running in the grid's local +X direction — typically numbered.
    x_axes: list[GridAxis] = Field(alias="xAxes")
    #: Axes running in the grid's local +Y direction — typically lettered.
    y_axes: list[GridAxis] = Field(alias="yAxes")
    #: How far each grid line extends past the outermost perpendicular axis.
    extension: float = Field(ge=0)
    bubble_radius: float = Field(gt=0, alias="bubbleRadius")

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# The document
# ---------------------------------------------------------------------------

Units = Literal["m", "ft", "cm", "mm"]


class SceneGraph(BaseModel):
    """A whole ArchStudio document.

    `extra: forbid` is deliberate and load-bearing: without it, a collection added to
    `scene.ts` but not mirrored here would be silently dropped, and the fixture parity tests
    would pass while the two schemas diverged — the exact failure this file exists to prevent.
    """

    schema_version: Annotated[Literal[9], Field(alias="schemaVersion")] = SCHEMA_VERSION
    project_id: str = Field(alias="projectId")
    units: Units = "m"
    types: list[ElementTypeDef] = []
    levels: list[Level] = []
    walls: list[Wall] = []
    openings: list[Opening] = []
    fillings: list[Filling] = []
    slabs: list[Slab] = []
    columns: list[Column] = []
    beams: list[Beam] = []
    rooms: list[Room] = []
    furniture: list[FurnitureItem] = []
    materials: list[Material] = []
    views: list[SavedView] = []
    plan_regions: list[PlanRegion] = Field(alias="planRegions", default=[])
    dimensions: list[Dimension] = []
    annotations: list[Annotation] = []
    room_tags: list[RoomTag] = Field(alias="roomTags", default=[])
    column_grids: list[ColumnGrid] = Field(alias="columnGrids", default=[])
    roofs: list[Roof] = []
    primitives: list[Primitive] = []
    booleans: list[BooleanNode] = []
    stairs: list[Stair] = []
    railings: list[Railing] = []
    ceilings: list[Ceiling] = []
    curtain_walls: list[CurtainWall] = Field(alias="curtainWalls", default=[])
    wall_joins: list[WallJoin] = Field(alias="wallJoins", default=[])
    groups: list[ElementGroup] = []

    model_config = {"populate_by_name": True, "extra": "forbid"}

    # -- lookups (mirroring the free functions in scene.ts) ------------------

    def find_type(self, type_id: str) -> ElementTypeDef | None:
        return next((t for t in self.types if t.id == type_id), None)

    def find_wall_type(self, type_id: str) -> WallTypeDef | None:
        t = self.find_type(type_id)
        return t if isinstance(t, WallTypeDef) else None

    def find_slab_type(self, type_id: str) -> SlabTypeDef | None:
        t = self.find_type(type_id)
        return t if isinstance(t, SlabTypeDef) else None

    def find_roof_type(self, type_id: str) -> RoofTypeDef | None:
        t = self.find_type(type_id)
        return t if isinstance(t, RoofTypeDef) else None

    def find_primitive_type(self, type_id: str) -> PrimitiveTypeDef | None:
        t = self.find_type(type_id)
        return t if isinstance(t, PrimitiveTypeDef) else None

    def find_stair_type(self, type_id: str) -> StairTypeDef | None:
        t = self.find_type(type_id)
        return t if isinstance(t, StairTypeDef) else None

    def find_railing_type(self, type_id: str) -> RailingTypeDef | None:
        t = self.find_type(type_id)
        return t if isinstance(t, RailingTypeDef) else None

    def find_ceiling_type(self, type_id: str) -> CeilingTypeDef | None:
        t = self.find_type(type_id)
        return t if isinstance(t, CeilingTypeDef) else None

    def find_curtain_wall_type(self, type_id: str) -> CurtainWallTypeDef | None:
        t = self.find_type(type_id)
        return t if isinstance(t, CurtainWallTypeDef) else None

    def find_plan_view(self, level_id: str) -> SavedView | None:
        """The plan view pinned to a level, if one exists (C7)."""
        return next(
            (v for v in self.views if v.level_id == level_id and v.view_range is not None),
            None,
        )

    def find_level(self, level_id: str) -> Level | None:
        return next((lv for lv in self.levels if lv.id == level_id), None)

    def get_wall(self, wall_id: str) -> Wall | None:
        return next((w for w in self.walls if w.id == wall_id), None)

    def resolve_top_elevation(self, top: TopConstraint, base_elevation: float) -> float:
        """Resolve a TopConstraint to an absolute world elevation.

        For a roof constraint this is the NOMINAL (unramped) reference elevation — the roof's own
        datum. The per-thickness ramp a wall additionally follows is a rendering/export concern
        (`shared/geometry/roof.ts` `wallRoofRamp`) with no TypeScript-side runtime validation
        counterpart, so it has no Python mirror either — same split as the rest of this file.
        """
        if isinstance(top, TopUnconnected):
            return base_elevation + top.height
        if isinstance(top, TopRoofConstraint):
            roof = next((r for r in self.roofs if r.id == top.roof_id), None)
            return roof.base_height if roof is not None else base_elevation + 2.8
        level = self.find_level(top.level_id)
        if level is None:
            # Orphaned constraint — fall back to a sane storey height, as scene.ts does.
            return base_elevation + 2.8
        return level.elevation + top.offset


#: Every collection key that holds scene elements (BIM model objects).
ELEMENT_COLLECTIONS: Final[tuple[str, ...]] = (
    "walls",
    "openings",
    "fillings",
    "slabs",
    "columns",
    "beams",
    "rooms",
    "furniture",
    "columnGrids",
    "roofs",
    "primitives",
    "booleans",
    "stairs",
    "railings",
    "ceilings",
    "curtainWalls",
    # Relationship nodes rather than geometry, but they are model (not view) objects and are
    # selectable/deletable like any element — the same call `booleans` already makes.
    "wallJoins",
    "groups",
)

#: Collections that hold view-scoped annotation objects.
ANNOTATION_COLLECTIONS: Final[tuple[str, ...]] = (
    "dimensions",
    "annotations",
    "roomTags",
)

#: Collections that define views themselves, rather than things drawn in one.
VIEW_COLLECTIONS: Final[tuple[str, ...]] = (
    "views",
    "planRegions",
)


class SceneDiff(BaseModel):
    """Partial update — only include fields that changed."""

    types: list[ElementTypeDef] | None = None
    levels: list[Level] | None = None
    walls: list[Wall] | None = None
    openings: list[Opening] | None = None
    fillings: list[Filling] | None = None
    slabs: list[Slab] | None = None
    columns: list[Column] | None = None
    beams: list[Beam] | None = None
    rooms: list[Room] | None = None
    furniture: list[FurnitureItem] | None = None
    materials: list[Material] | None = None
    views: list[SavedView] | None = None
    plan_regions: list[PlanRegion] | None = Field(alias="planRegions", default=None)
    dimensions: list[Dimension] | None = None
    annotations: list[Annotation] | None = None
    room_tags: list[RoomTag] | None = Field(alias="roomTags", default=None)
    column_grids: list[ColumnGrid] | None = Field(alias="columnGrids", default=None)
    roofs: list[Roof] | None = None
    primitives: list[Primitive] | None = None
    booleans: list[BooleanNode] | None = None
    stairs: list[Stair] | None = None
    railings: list[Railing] | None = None
    ceilings: list[Ceiling] | None = None
    curtain_walls: list[CurtainWall] | None = Field(alias="curtainWalls", default=None)
    wall_joins: list[WallJoin] | None = Field(alias="wallJoins", default=None)
    groups: list[ElementGroup] | None = None

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


class SchemaVersionError(ValueError):
    """A document declares a schema version this build does not speak."""


def parse_scene(raw: object) -> SceneGraph:
    """Validate a document, refusing any version this build does not speak.

    Migration is deliberately NOT implemented here — it lives in `shared/types/migrate.ts`
    and runs client-side before the backend ever sees a document. This raises a message
    saying so rather than letting Pydantic emit a bare "Input should be 6".
    """
    if not isinstance(raw, dict):
        raise SchemaVersionError("Scene graph must be an object")

    version = raw.get("schemaVersion", raw.get("schema_version"))
    if version != SCHEMA_VERSION:
        if isinstance(version, int) and version < SCHEMA_VERSION:
            raise SchemaVersionError(
                f"Document is schema v{version}; this build speaks v{SCHEMA_VERSION}. "
                "Migrate it client-side before sending."
            )
        if isinstance(version, int):
            raise SchemaVersionError(
                f"Document is schema v{version}, newer than this build's v{SCHEMA_VERSION}. "
                "Update the backend."
            )
        raise SchemaVersionError(f"Unrecognised schema version: {version!r}")

    return SceneGraph.model_validate(raw)


def assembly_thickness(layers: list[MaterialLayer]) -> float:
    """Total thickness of a compound assembly."""
    return sum(layer.thickness for layer in layers)
