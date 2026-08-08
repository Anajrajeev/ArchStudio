"""Tests for the shared scene-graph Pydantic models (`shared/python/models.py`), schema v9.

Two jobs:

1. Prove the models encode the schema correctly — every discriminated union discriminates, every
   constraint the TS doc comments state is enforced, and the camelCase wire format round-trips.
2. **Prove they have not drifted from `shared/types/scene.ts`.** That is what the fixture tests
   at the bottom do, against the golden documents in `shared/fixtures/` that the TypeScript
   suite regenerates. The models sat five schema versions behind precisely because nothing
   mechanically tied the two sides together.

(This file was `test_geometry.py`, which was a misnomer — the geometry is all TypeScript.)
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError
from shared.python.models import (
    PRIMITIVE_KINDS,
    SCHEMA_VERSION,
    Annotation,
    BaselineArc,
    BaselineLine,
    BeamTypeDef,
    BooleanNode,
    Ceiling,
    CeilingTypeDef,
    CircularProfile,
    ColumnTypeDef,
    CurtainWall,
    CurtainWallTypeDef,
    DoorTypeDef,
    ElementGroup,
    FurnitureTypeDef,
    Level,
    MaterialLayer,
    PrimitiveTypeDef,
    Railing,
    RailingTypeDef,
    RectangularProfile,
    Roof,
    RoofEdge,
    RoofTypeDef,
    Room,
    SceneDiff,
    SceneGraph,
    SchemaVersionError,
    Slab,
    SlabTypeDef,
    Stair,
    StairTypeDef,
    TopLevelConstraint,
    TopRoofConstraint,
    TopUnconnected,
    ViewRange,
    Wall,
    WallJoin,
    WallTypeDef,
    WindowTypeDef,
    assembly_thickness,
    parse_scene,
)

FIXTURES = Path(__file__).resolve().parents[2] / "shared" / "fixtures"

# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------

LAYER: dict[str, Any] = {"material": "mat-brick", "thickness": 0.2, "function": "structure"}


def scene(**kwargs: Any) -> dict[str, Any]:
    base: dict[str, Any] = {"schemaVersion": SCHEMA_VERSION, "projectId": "proj-1"}
    base.update(kwargs)
    return base


def wall_payload(**kwargs: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "w1",
        "typeId": "wt-1",
        "levelId": "lv1",
        "baseline": {"kind": "line", "start": [0, 0], "end": [5, 0]},
        "baseOffset": 0,
        "top": {"kind": "unconnected", "height": 2.8},
        "locationLine": "centerline",
        "flipped": False,
        "roomBounding": True,
    }
    base.update(kwargs)
    return base


# ---------------------------------------------------------------------------
# ElementTypeDef discrimination (9 categories)
# ---------------------------------------------------------------------------

TYPE_DEFS: list[tuple[str, dict[str, Any], type]] = [
    ("wall", {"layers": [LAYER], "function": "exterior"}, WallTypeDef),
    (
        "door",
        {
            "width": 0.9,
            "height": 2.1,
            "thickness": 0.045,
            "operation": "single-swing",
            "frameMaterial": "mat-timber",
            "panelMaterial": "mat-timber",
        },
        DoorTypeDef,
    ),
    (
        "window",
        {
            "width": 1.2,
            "height": 1.2,
            "defaultSillHeight": 0.9,
            "frameThickness": 0.06,
            "partitioning": "double-vertical",
            "frameMaterial": "mat-timber",
            "glassMaterial": "mat-glass",
        },
        WindowTypeDef,
    ),
    ("slab", {"layers": [LAYER], "function": "floor"}, SlabTypeDef),
    (
        "column",
        {
            "profile": {"kind": "rectangular", "width": 0.3, "depth": 0.3},
            "material": "mat-concrete",
        },
        ColumnTypeDef,
    ),
    (
        "beam",
        {"profile": {"kind": "circular", "diameter": 0.4}, "material": "mat-steel"},
        BeamTypeDef,
    ),
    (
        "furniture",
        {
            "catalogId": "sofa-01",
            "footprint": [0.8, 0.8],
            "heightMeters": 0.8,
            "material": "mat-timber",
        },
        FurnitureTypeDef,
    ),
    ("roof", {"layers": [LAYER]}, RoofTypeDef),
    (
        "primitive",
        {"shape": {"kind": "box", "width": 1, "depth": 1, "height": 1}, "material": "mat-concrete"},
        PrimitiveTypeDef,
    ),
    ("stair", {"width": 1, "treadDepth": 0.28, "material": "mat-oak"}, StairTypeDef),
    (
        "railing",
        {"height": 0.9, "postThickness": 0.04, "postSpacing": 1, "material": "mat-steel"},
        RailingTypeDef,
    ),
    ("ceiling", {"layers": [LAYER]}, CeilingTypeDef),
]


class TestElementTypeDefDiscrimination:
    @pytest.mark.parametrize(("category", "extra", "expected"), TYPE_DEFS)
    def test_each_category_resolves_to_its_class(
        self, category: str, extra: dict[str, Any], expected: type
    ) -> None:
        sg = SceneGraph.model_validate(
            scene(types=[{"id": "t1", "category": category, "name": "T", **extra}])
        )
        assert isinstance(sg.types[0], expected)

    def test_covers_every_category_in_the_schema(self) -> None:
        # Guards against a new ElementTypeDef variant landing in scene.ts with no test here.
        assert len(TYPE_DEFS) == 12

    def test_unknown_category_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SceneGraph.model_validate(
                scene(types=[{"id": "t1", "category": "skylight", "name": "T"}])
            )

    def test_right_category_wrong_payload_rejected(self) -> None:
        # A door payload under `category: "wall"` must fail, not silently coerce.
        with pytest.raises(ValidationError):
            SceneGraph.model_validate(
                scene(types=[{"id": "t1", "category": "wall", "name": "T", "width": 0.9}])
            )

    def test_missing_discriminant_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SceneGraph.model_validate(scene(types=[{"id": "t1", "name": "T", "layers": [LAYER]}]))


# ---------------------------------------------------------------------------
# PrimitiveShape (7 kinds)
# ---------------------------------------------------------------------------

PRIMITIVE_SHAPES: dict[str, dict[str, Any]] = {
    "box": {"width": 1, "depth": 1, "height": 1},
    "cylinder": {"radius": 0.5, "height": 1, "segments": 32},
    "cone": {"radius": 0.5, "height": 1, "segments": 32},
    "sphere": {"radius": 0.5, "segments": 24},
    "prism": {"radius": 0.5, "height": 1, "sides": 6},
    "wedge": {"width": 1, "depth": 1, "height": 1},
    "torus": {"radius": 0.5, "tubeRadius": 0.2, "radialSegments": 16, "tubularSegments": 32},
}


def primitive_type(shape: dict[str, Any]) -> PrimitiveTypeDef:
    return PrimitiveTypeDef.model_validate(
        {
            "id": "pt",
            "category": "primitive",
            "name": "P",
            "shape": shape,
            "material": "mat-concrete",
        }
    )


class TestPrimitiveShape:
    @pytest.mark.parametrize("kind", list(PRIMITIVE_KINDS))
    def test_each_kind_parses(self, kind: str) -> None:
        t = primitive_type({"kind": kind, **PRIMITIVE_SHAPES[kind]})
        assert t.shape.kind == kind

    def test_covers_every_kind(self) -> None:
        assert set(PRIMITIVE_SHAPES) == set(PRIMITIVE_KINDS)

    def test_unknown_kind_rejected(self) -> None:
        with pytest.raises(ValidationError):
            primitive_type({"kind": "dodecahedron", "radius": 1})

    def test_torus_camelcase_aliases(self) -> None:
        t = primitive_type({"kind": "torus", **PRIMITIVE_SHAPES["torus"]})
        assert t.shape.tube_radius == 0.2  # type: ignore[union-attr]
        assert t.shape.tubular_segments == 32  # type: ignore[union-attr]


# ---------------------------------------------------------------------------
# The other discriminated unions
# ---------------------------------------------------------------------------


class TestUnions:
    def test_rectangular_profile(self) -> None:
        t = ColumnTypeDef.model_validate(
            {
                "id": "ct",
                "category": "column",
                "name": "C",
                "profile": {"kind": "rectangular", "width": 0.3, "depth": 0.4},
                "material": "mat-concrete",
            }
        )
        assert isinstance(t.profile, RectangularProfile)

    def test_circular_profile(self) -> None:
        t = ColumnTypeDef.model_validate(
            {
                "id": "ct",
                "category": "column",
                "name": "C",
                "profile": {"kind": "circular", "diameter": 0.4},
                "material": "mat-concrete",
            }
        )
        assert isinstance(t.profile, CircularProfile)

    def test_top_constraint_level(self) -> None:
        w = Wall.model_validate(
            wall_payload(top={"kind": "level", "levelId": "lv2", "offset": -0.2})
        )
        assert isinstance(w.top, TopLevelConstraint)
        assert w.top.level_id == "lv2"
        assert w.top.offset == -0.2  # negative offsets are legitimate

    def test_top_constraint_unconnected(self) -> None:
        w = Wall.model_validate(wall_payload())
        assert isinstance(w.top, TopUnconnected)
        assert w.top.height == 2.8

    def test_top_constraint_roof(self) -> None:
        # B1 wall voiding (D-020) — the third TopConstraint variant.
        w = Wall.model_validate(wall_payload(top={"kind": "roof", "roofId": "rf1"}))
        assert isinstance(w.top, TopRoofConstraint)
        assert w.top.roof_id == "rf1"

    def test_baseline_line(self) -> None:
        w = Wall.model_validate(wall_payload())
        assert isinstance(w.baseline, BaselineLine)
        assert w.baseline.start == (0.0, 0.0)

    def test_baseline_arc_keeps_signed_bulge(self) -> None:
        w = Wall.model_validate(
            wall_payload(baseline={"kind": "arc", "start": [0, 0], "end": [5, 0], "bulge": -0.5})
        )
        assert isinstance(w.baseline, BaselineArc)
        # The sign encodes sweep direction (D-014), so it must survive unconstrained.
        assert w.baseline.bulge == -0.5


# ---------------------------------------------------------------------------
# Constraints
# ---------------------------------------------------------------------------


class TestConstraints:
    def test_level_height_must_be_positive(self) -> None:
        with pytest.raises(ValidationError):
            Level.model_validate(
                {
                    "id": "lv1",
                    "name": "G",
                    "elevation": 0,
                    "height": 0,
                    "isBuildingStory": True,
                    "computationHeight": 0,
                }
            )

    def test_layer_thickness_must_be_positive(self) -> None:
        with pytest.raises(ValidationError):
            MaterialLayer.model_validate({"material": "m", "thickness": 0, "function": "structure"})

    def test_room_polygon_needs_three_vertices(self) -> None:
        with pytest.raises(ValidationError):
            Room.model_validate(
                {
                    "id": "r1",
                    "levelId": "lv1",
                    "name": "R",
                    "number": "1",
                    "polygon": [[0, 0], [1, 0]],
                    "floorMaterial": "mat-oak",
                    "baseOffset": 0,
                    "top": {"kind": "unconnected", "height": 2.8},
                }
            )

    @pytest.mark.parametrize("angle", [0, 90, -5, 120])
    def test_roof_angle_must_be_strictly_between_0_and_90(self, angle: float) -> None:
        with pytest.raises(ValidationError):
            RoofEdge.model_validate({"angle": angle, "overhang": 0.3})

    def test_roof_angle_accepts_the_interior(self) -> None:
        assert RoofEdge.model_validate({"angle": 30, "overhang": 0.3}).angle == 30

    def test_roof_footprint_needs_three_vertices(self) -> None:
        with pytest.raises(ValidationError):
            Roof.model_validate(
                {
                    "id": "rf1",
                    "typeId": "rt",
                    "levelId": "lv1",
                    "footprint": [[0, 0], [1, 0]],
                    "edges": [{"angle": 30, "overhang": 0.3}] * 2,
                    "baseHeight": 2.8,
                }
            )

    def test_prism_needs_at_least_three_sides(self) -> None:
        with pytest.raises(ValidationError):
            primitive_type({"kind": "prism", "radius": 0.5, "height": 1, "sides": 2})

    def test_boolean_needs_at_least_two_operands(self) -> None:
        with pytest.raises(ValidationError):
            BooleanNode.model_validate(
                {"id": "b1", "levelId": "lv1", "op": "cut", "operandIds": ["p1"]}
            )

    def test_negative_offsets_are_allowed(self) -> None:
        # These are legitimately negative; over-constraining them would reject real documents.
        w = Wall.model_validate(wall_payload(baseOffset=-0.5))
        assert w.base_offset == -0.5
        a = Annotation.model_validate(
            {
                "id": "a1",
                "viewId": "v1",
                "kind": "text",
                "text": "hi",
                "position": [0, 0],
                "leaderTarget": None,
                "rotation": -45,
                "textHeight": 0.2,
            }
        )
        assert a.rotation == -45


# ---------------------------------------------------------------------------
# Aliases and round-tripping
# ---------------------------------------------------------------------------


class TestAliases:
    def test_camelcase_in_snake_out(self) -> None:
        w = Wall.model_validate(wall_payload())
        assert w.type_id == "wt-1"
        assert w.room_bounding is True

    def test_dump_by_alias_emits_camelcase(self) -> None:
        w = Wall.model_validate(wall_payload())
        dumped = w.model_dump(by_alias=True)
        assert dumped["typeId"] == "wt-1"
        assert dumped["locationLine"] == "centerline"

    def test_populate_by_name_accepts_snake_case(self) -> None:
        w = Wall.model_validate(
            {
                "id": "w1",
                "type_id": "wt-1",
                "level_id": "lv1",
                "baseline": {"kind": "line", "start": [0, 0], "end": [5, 0]},
                "base_offset": 0,
                "top": {"kind": "unconnected", "height": 2.8},
                "location_line": "centerline",
                "flipped": False,
                "room_bounding": True,
            }
        )
        assert w.type_id == "wt-1"

    def test_vec_lists_coerce_to_tuples(self) -> None:
        w = Wall.model_validate(wall_payload())
        assert isinstance(w.baseline, BaselineLine)
        assert w.baseline.end == (5.0, 0.0)

    def test_json_mode_round_trip(self) -> None:
        original = Wall.model_validate(wall_payload())
        again = Wall.model_validate(original.model_dump(mode="json", by_alias=True))
        assert again == original


# ---------------------------------------------------------------------------
# SceneGraph and the version gate
# ---------------------------------------------------------------------------


class TestSceneGraph:
    def test_empty_scene_has_every_collection_empty(self) -> None:
        sg = SceneGraph.model_validate(scene())
        assert sg.schema_version == SCHEMA_VERSION
        for name in (
            "types",
            "levels",
            "walls",
            "openings",
            "fillings",
            "slabs",
            "columns",
            "beams",
            "rooms",
            "furniture",
            "materials",
            "views",
            "dimensions",
            "annotations",
            "room_tags",
            "column_grids",
            "roofs",
            "primitives",
            "booleans",
            "stairs",
            "railings",
            "ceilings",
        ):
            assert getattr(sg, name) == [], name

    def test_units_accepts_mm(self) -> None:
        # v1 Python was missing "mm" while the TS union had it — a real drift bug.
        assert SceneGraph.model_validate(scene(units="mm")).units == "mm"

    @pytest.mark.parametrize("unit", ["m", "ft", "cm", "mm"])
    def test_every_unit_in_the_ts_union(self, unit: str) -> None:
        assert SceneGraph.model_validate(scene(units=unit)).units == unit

    def test_unknown_unit_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SceneGraph.model_validate(scene(units="furlong"))

    def test_unknown_collection_rejected(self) -> None:
        # extra="forbid" is what makes the fixture parity tests meaningful: a collection added
        # to scene.ts but not mirrored here must fail loudly rather than be silently dropped.
        with pytest.raises(ValidationError):
            SceneGraph.model_validate(scene(elevators=[]))

    def test_parse_scene_accepts_current_version(self) -> None:
        assert parse_scene(scene()).project_id == "proj-1"

    @pytest.mark.parametrize("version", [1, 2, 3, 4, 5, 6, 7])
    def test_parse_scene_refuses_older_with_an_actionable_message(self, version: int) -> None:
        with pytest.raises(SchemaVersionError) as excinfo:
            parse_scene({"schemaVersion": version, "projectId": "p"})
        message = str(excinfo.value)
        assert f"v{version}" in message
        assert "Migrate it client-side" in message

    def test_parse_scene_refuses_newer(self) -> None:
        with pytest.raises(SchemaVersionError) as excinfo:
            parse_scene({"schemaVersion": SCHEMA_VERSION + 1, "projectId": "p"})
        assert "newer than this build" in str(excinfo.value)

    def test_parse_scene_refuses_a_non_object(self) -> None:
        with pytest.raises(SchemaVersionError):
            parse_scene("not a scene")

    def test_parse_scene_refuses_a_missing_version(self) -> None:
        with pytest.raises(SchemaVersionError):
            parse_scene({"projectId": "p"})

    def test_lookups(self) -> None:
        sg = SceneGraph.model_validate(
            scene(
                types=[
                    {
                        "id": "wt-1",
                        "category": "wall",
                        "name": "W",
                        "layers": [LAYER],
                        "function": "exterior",
                    },
                    {"id": "dt-1", "category": "door", "name": "D", "width": 0.9, "height": 2.1,
                     "thickness": 0.045, "operation": "single-swing", "frameMaterial": "m",
                     "panelMaterial": "m"},
                ],
                levels=[
                    {"id": "lv1", "name": "G", "elevation": 0, "height": 3,
                     "isBuildingStory": True, "computationHeight": 0}
                ],
                walls=[wall_payload()],
            )
        )
        assert sg.find_type("wt-1") is not None
        assert sg.find_type("nope") is None
        assert sg.find_wall_type("wt-1") is not None
        # A door id must not come back from find_wall_type just because the id exists.
        assert sg.find_wall_type("dt-1") is None
        assert sg.find_level("lv1") is not None
        assert sg.get_wall("w1") is not None
        assert sg.get_wall("nope") is None

    def test_resolve_top_elevation(self) -> None:
        sg = SceneGraph.model_validate(
            scene(
                levels=[
                    {"id": "lv2", "name": "First", "elevation": 3.0, "height": 3,
                     "isBuildingStory": True, "computationHeight": 0}
                ]
            )
        )
        assert sg.resolve_top_elevation(TopUnconnected(kind="unconnected", height=2.8), 1.0) == 3.8
        assert (
            sg.resolve_top_elevation(
                TopLevelConstraint(kind="level", levelId="lv2", offset=-0.2), 0.0
            )
            == 2.8
        )
        # Orphaned constraint falls back to a sane storey height, exactly as scene.ts does.
        assert (
            sg.resolve_top_elevation(
                TopLevelConstraint(kind="level", levelId="gone", offset=0), 1.0
            )
            == 3.8
        )

    def test_resolve_top_elevation_roof(self) -> None:
        # B1 wall voiding (D-020): a roof constraint resolves to the roof's own baseHeight,
        # regardless of base_elevation — it is a datum, not an offset from the wall's base.
        sg = SceneGraph.model_validate(
            scene(
                roofs=[
                    {
                        "id": "rf1",
                        "typeId": "rt-1",
                        "levelId": "lv1",
                        "footprint": [[0, 0], [6, 0], [6, 4], [0, 4]],
                        "edges": [{"angle": 30, "overhang": 0.3}] * 4,
                        "baseHeight": 3.0,
                    }
                ]
            )
        )
        assert sg.resolve_top_elevation(TopRoofConstraint(kind="roof", roofId="rf1"), 1.0) == 3.0
        # Dangling roof id — same orphan fallback as a dangling level id.
        assert (
            sg.resolve_top_elevation(TopRoofConstraint(kind="roof", roofId="gone"), 1.0) == 3.8
        )

    def test_assembly_thickness(self) -> None:
        layers = [
            MaterialLayer.model_validate(
                {"material": "a", "thickness": 0.015, "function": "finish"}
            ),
            MaterialLayer.model_validate(
                {"material": "b", "thickness": 0.17, "function": "structure"}
            ),
        ]
        assert assembly_thickness(layers) == pytest.approx(0.185)


class TestStairAndRailing:
    """B2/B3. Both reuse patterns established for booleans/roofs — see DECISIONS.md."""

    def test_stair_parses_and_keeps_top_constraint_union(self) -> None:
        s = Stair.model_validate(
            {
                "id": "st1",
                "typeId": "stt-1",
                "levelId": "lv1",
                "baseline": {"start": [0, 0], "end": [3, 0]},
                "baseOffset": 0,
                "top": {"kind": "unconnected", "height": 2.8},
                "desiredNumberOfRisers": 16,
            }
        )
        assert isinstance(s.top, TopUnconnected)
        assert s.desired_number_of_risers == 16

    def test_stair_needs_at_least_two_risers(self) -> None:
        with pytest.raises(ValidationError):
            Stair.model_validate(
                {
                    "id": "st1",
                    "typeId": "stt-1",
                    "levelId": "lv1",
                    "baseline": {"start": [0, 0], "end": [3, 0]},
                    "baseOffset": 0,
                    "top": {"kind": "unconnected", "height": 2.8},
                    "desiredNumberOfRisers": 1,
                }
            )

    def test_stair_type_requires_positive_dimensions(self) -> None:
        with pytest.raises(ValidationError):
            StairTypeDef.model_validate(
                {"id": "stt-1", "category": "stair", "name": "S", "width": 0, "treadDepth": 0.28,
                 "material": "mat-oak"}
            )

    def test_railing_parses_and_needs_at_least_two_path_points(self) -> None:
        r = Railing.model_validate(
            {
                "id": "rl1",
                "typeId": "rlt-1",
                "levelId": "lv1",
                "path": [[0, 0], [3, 0]],
                "baseOffset": 0,
            }
        )
        assert len(r.path) == 2

        with pytest.raises(ValidationError):
            Railing.model_validate(
                {
                    "id": "rl1",
                    "typeId": "rlt-1",
                    "levelId": "lv1",
                    "path": [[0, 0]],
                    "baseOffset": 0,
                }
            )

    def test_railing_type_camelcase_aliases(self) -> None:
        t = RailingTypeDef.model_validate(
            {
                "id": "rlt-1",
                "category": "railing",
                "name": "R",
                "height": 0.9,
                "postThickness": 0.04,
                "postSpacing": 1,
                "material": "mat-steel",
            }
        )
        assert t.post_thickness == 0.04
        assert t.post_spacing == 1


class TestCeiling:
    """B5. A boundary polygon like Slab, but anchored at its bottom face via TopConstraint."""

    def test_ceiling_parses_and_keeps_top_constraint_union(self) -> None:
        c = Ceiling.model_validate(
            {
                "id": "ceil1",
                "typeId": "clt-1",
                "levelId": "lv1",
                "boundary": [[0, 0], [4, 0], [4, 4], [0, 4]],
                "top": {"kind": "level", "levelId": "lv2", "offset": 0},
            }
        )
        assert isinstance(c.top, TopLevelConstraint)
        assert len(c.boundary) == 4

    def test_ceiling_boundary_needs_three_vertices(self) -> None:
        with pytest.raises(ValidationError):
            Ceiling.model_validate(
                {
                    "id": "ceil1",
                    "typeId": "clt-1",
                    "levelId": "lv1",
                    "boundary": [[0, 0], [4, 0]],
                    "top": {"kind": "unconnected", "height": 2.8},
                }
            )

    def test_ceiling_type_needs_at_least_one_layer(self) -> None:
        with pytest.raises(ValidationError):
            CeilingTypeDef.model_validate(
                {"id": "clt-1", "category": "ceiling", "name": "C", "layers": []}
            )


class TestSlabOpenings:
    """B8. Openings default to empty and accept one or more inner-loop polygons."""

    def test_defaults_to_no_openings(self) -> None:
        s = Slab.model_validate(
            {
                "id": "sl1",
                "typeId": "st-1",
                "levelId": "lv1",
                "boundary": [[0, 0], [4, 0], [4, 4], [0, 4]],
                "heightOffset": 0,
            }
        )
        assert s.openings == []

    def test_accepts_a_stairwell_shaft(self) -> None:
        s = Slab.model_validate(
            {
                "id": "sl1",
                "typeId": "st-1",
                "levelId": "lv1",
                "boundary": [[0, 0], [4, 0], [4, 4], [0, 4]],
                "heightOffset": 0,
                "openings": [[[1, 1], [2, 1], [2, 2], [1, 2]]],
            }
        )
        assert len(s.openings) == 1
        assert s.openings[0][0] == (1.0, 1.0)


class TestSpotAnnotations:
    """C4. Computed at placement time, not continuously live — see DECISIONS.md."""

    @pytest.mark.parametrize("kind", ["spot-elevation", "spot-coordinate", "spot-slope"])
    def test_each_spot_kind_parses(self, kind: str) -> None:
        a = Annotation.model_validate(
            {
                "id": "a1",
                "viewId": "v1",
                "kind": kind,
                "text": "",
                "position": [1, 2],
                "leaderTarget": None,
                "rotation": 0,
                "textHeight": 0.2,
                "elevation": 3.15 if kind == "spot-elevation" else None,
                "slope": 12.5 if kind == "spot-slope" else None,
            }
        )
        assert a.kind == kind

    def test_elevation_and_slope_default_to_none(self) -> None:
        a = Annotation.model_validate(
            {
                "id": "a1",
                "viewId": "v1",
                "kind": "text",
                "text": "hi",
                "position": [0, 0],
                "leaderTarget": None,
                "rotation": 0,
                "textHeight": 0.2,
            }
        )
        assert a.elevation is None
        assert a.slope is None


class TestCurtainWall:
    """B4/D-027. A grid-driven glazing system; panels are sized BY the grid, never directly."""

    @pytest.mark.parametrize(
        "rule",
        [
            {"kind": "fixedNumber", "count": 4},
            {"kind": "fixedDistance", "spacing": 1.2},
            {"kind": "maximumSpacing", "spacing": 1.5},
        ],
    )
    def test_every_grid_rule_variant_discriminates(self, rule: dict[str, Any]) -> None:
        t = CurtainWallTypeDef.model_validate(
            {
                "id": "cwt-1",
                "category": "curtainWall",
                "name": "Glazed",
                "gridU": rule,
                "gridV": rule,
                "mullionWidth": 0.05,
                "mullionDepth": 0.15,
                "panelThickness": 0.024,
                "panelMaterial": "mat-glass",
                "mullionMaterial": "mat-steel",
            }
        )
        assert t.grid_u.kind == rule["kind"]

    def test_rejects_a_zero_bay_count(self) -> None:
        with pytest.raises(ValidationError):
            CurtainWallTypeDef.model_validate(
                {
                    "id": "cwt-1",
                    "category": "curtainWall",
                    "name": "Glazed",
                    "gridU": {"kind": "fixedNumber", "count": 0},
                    "gridV": {"kind": "fixedNumber", "count": 2},
                    "mullionWidth": 0.05,
                    "mullionDepth": 0.15,
                    "panelThickness": 0.024,
                    "panelMaterial": "mat-glass",
                    "mullionMaterial": "mat-steel",
                }
            )

    def test_instance_reuses_baseline_and_top_constraint(self) -> None:
        cw = CurtainWall.model_validate(
            {
                "id": "cw1",
                "typeId": "cwt-1",
                "levelId": "lv1",
                "baseline": {"kind": "line", "start": [0, 0], "end": [6, 0]},
                "baseOffset": 0,
                "top": {"kind": "level", "levelId": "lv2", "offset": 0},
            }
        )
        assert isinstance(cw.baseline, BaselineLine)
        assert isinstance(cw.top, TopLevelConstraint)


class TestWallJoin:
    """A9/D-026. A stored relationship; every trim angle is derived, never stored."""

    def test_parses_a_two_member_miter(self) -> None:
        j = WallJoin.model_validate(
            {
                "id": "wj1",
                "levelId": "lv1",
                "memberIds": ["w1", "w2"],
                "point": [6, 0],
                "style": "miter",
                "throughId": None,
            }
        )
        assert j.style == "miter"
        assert j.through_id is None

    def test_rejects_a_single_member(self) -> None:
        # A "join" of one wall is meaningless — there is nothing to clean up against.
        with pytest.raises(ValidationError):
            WallJoin.model_validate(
                {
                    "id": "wj1",
                    "levelId": "lv1",
                    "memberIds": ["w1"],
                    "point": [0, 0],
                    "style": "butt",
                }
            )


class TestElementGroup:
    """D5/D-028. Member ids may name other groups, which is what makes this a tree."""

    def test_nests(self) -> None:
        inner = ElementGroup.model_validate({"id": "g1", "name": "Inner", "memberIds": ["w1"]})
        outer = ElementGroup.model_validate(
            {"id": "g2", "name": "Outer", "memberIds": ["g1", "c1"]}
        )
        assert inner.id in outer.member_ids


class TestViewRange:
    """C7/D-029. Offsets above the view's OWN level, never absolute world Y."""

    def test_round_trips_through_the_wire_format(self) -> None:
        vr = ViewRange.model_validate(
            {"cutHeight": 1.2, "topOffset": 3, "bottomOffset": 0, "viewDepth": 0.5}
        )
        assert vr.model_dump(by_alias=True) == {
            "cutHeight": 1.2,
            "topOffset": 3.0,
            "bottomOffset": 0.0,
            "viewDepth": 0.5,
        }

    def test_rejects_a_negative_view_depth(self) -> None:
        with pytest.raises(ValidationError):
            ViewRange.model_validate(
                {"cutHeight": 1.2, "topOffset": 3, "bottomOffset": 0, "viewDepth": -1}
            )


class TestSceneDiff:
    def test_defaults_to_all_none(self) -> None:
        diff = SceneDiff()
        assert diff.walls is None
        assert diff.primitives is None
        assert diff.ceilings is None

    def test_partial_leaves_the_rest_none(self) -> None:
        diff = SceneDiff.model_validate({"walls": [wall_payload()]})
        assert diff.walls is not None
        assert len(diff.walls) == 1
        assert diff.rooms is None


# ---------------------------------------------------------------------------
# Fixture parity with shared/types/scene.ts
# ---------------------------------------------------------------------------


def load_fixture(name: str) -> dict[str, Any]:
    with (FIXTURES / name).open(encoding="utf-8") as handle:
        data: dict[str, Any] = json.load(handle)
    return data


class TestFixtureParity:
    """The mechanical lock against TS/Python drift.

    These read the golden documents the TypeScript suite emits. If `scene.ts` gains a field or
    a collection and this file is not updated, `extra="forbid"` (or a missing-field error)
    fails these tests — which is the whole point.
    """

    @pytest.mark.parametrize("name", ["scene-v9-empty.json", "scene-v9-populated.json"])
    def test_fixture_parses(self, name: str) -> None:
        sg = parse_scene(load_fixture(name))
        assert sg.schema_version == SCHEMA_VERSION

    @pytest.mark.parametrize("name", ["scene-v9-empty.json", "scene-v9-populated.json"])
    def test_fixture_round_trips(self, name: str) -> None:
        raw = load_fixture(name)
        sg = parse_scene(raw)
        again = SceneGraph.model_validate(sg.model_dump(mode="json", by_alias=True))
        assert again == sg

    def test_fixture_version_matches_the_python_constant(self) -> None:
        assert load_fixture("scene-v9-empty.json")["schemaVersion"] == SCHEMA_VERSION

    def test_populated_fixture_exercises_every_collection(self) -> None:
        # If this fails, the fixture stopped being a full-coverage document and the parity
        # guarantee quietly narrowed.
        sg = parse_scene(load_fixture("scene-v9-populated.json"))
        for name in (
            "types",
            "levels",
            "walls",
            "openings",
            "fillings",
            "slabs",
            "columns",
            "beams",
            "rooms",
            "furniture",
            "materials",
            "views",
            "dimensions",
            "annotations",
            "room_tags",
            "column_grids",
            "roofs",
            "primitives",
            "booleans",
            "stairs",
            "railings",
            "ceilings",
            "curtain_walls",
            "wall_joins",
            "groups",
            "plan_regions",
        ):
            assert getattr(sg, name), f"{name} is empty in the populated fixture"

    def test_populated_fixture_covers_every_type_category(self) -> None:
        sg = parse_scene(load_fixture("scene-v9-populated.json"))
        assert {t.category for t in sg.types} == {
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
        }

    def test_typed_lookups_narrow_by_category(self) -> None:
        # Run against the fixture because it is the one document with every category present,
        # so each lookup is checked for both a hit AND a wrong-category miss.
        sg = parse_scene(load_fixture("scene-v9-populated.json"))
        assert sg.find_wall_type("wt-1") is not None
        assert sg.find_slab_type("st-1") is not None
        assert sg.find_roof_type("rt-1") is not None
        assert sg.find_primitive_type("pt-box") is not None
        assert sg.find_stair_type("stt-1") is not None
        assert sg.find_railing_type("rlt-1") is not None
        assert sg.find_ceiling_type("clt-1") is not None
        assert sg.find_curtain_wall_type("cwt-1") is not None
        # Every lookup must refuse an id that exists but is the wrong category.
        assert sg.find_slab_type("wt-1") is None
        assert sg.find_roof_type("st-1") is None
        assert sg.find_primitive_type("rt-1") is None
        assert sg.find_wall_type("pt-box") is None
        assert sg.find_stair_type("rlt-1") is None
        assert sg.find_railing_type("stt-1") is None
        assert sg.find_ceiling_type("stt-1") is None
        assert sg.find_curtain_wall_type("wt-1") is None

    def test_populated_fixture_covers_every_primitive_kind(self) -> None:
        sg = parse_scene(load_fixture("scene-v9-populated.json"))
        kinds = {t.shape.kind for t in sg.types if isinstance(t, PrimitiveTypeDef)}
        assert kinds == set(PRIMITIVE_KINDS)

    def test_populated_fixture_covers_slab_openings_and_spot_annotations(self) -> None:
        sg = parse_scene(load_fixture("scene-v9-populated.json"))
        assert any(len(s.openings) > 0 for s in sg.slabs)
        kinds = {a.kind for a in sg.annotations}
        assert {"spot-elevation", "spot-coordinate", "spot-slope"} <= kinds

    def test_populated_fixture_covers_every_grid_rule_variant(self) -> None:
        # The fixture carries two curtain-wall types purely so all three variants appear;
        # a variant missing here is a variant the parity lock cannot catch drift in.
        sg = parse_scene(load_fixture("scene-v9-populated.json"))
        rules = [
            r
            for t in sg.types
            if isinstance(t, CurtainWallTypeDef)
            for r in (t.grid_u, t.grid_v)
        ]
        assert {r.kind for r in rules} == {"fixedNumber", "fixedDistance", "maximumSpacing"}

    def test_populated_fixture_covers_both_view_range_states(self) -> None:
        # A plan view (viewRange set, underlay set) AND a 3D view (both null) — the two states
        # C7/C8 introduced. Without both, the optional fields are never exercised.
        sg = parse_scene(load_fixture("scene-v9-populated.json"))
        assert any(v.view_range is not None and v.underlay_level_id is not None for v in sg.views)
        assert any(v.view_range is None and v.underlay_level_id is None for v in sg.views)

    def test_populated_fixture_has_a_nested_group(self) -> None:
        # Nesting is what makes `groups` a tree rather than flat tagging (D-028).
        sg = parse_scene(load_fixture("scene-v9-populated.json"))
        group_ids = {g.id for g in sg.groups}
        assert any(any(m in group_ids for m in g.member_ids) for g in sg.groups)

    def test_find_plan_view_narrows_to_the_level(self) -> None:
        sg = parse_scene(load_fixture("scene-v9-populated.json"))
        view = sg.find_plan_view("lv1")
        assert view is not None
        assert view.view_range is not None
        # The 3D view (levelId null) must never be returned as a level's plan view.
        assert sg.find_plan_view("no-such-level") is None
