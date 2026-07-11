"""
Unit tests for the shared geometry module (Python path used via sys.path manipulation).
The actual geometry logic is in shared/geometry/index.ts (TypeScript).
This file tests the Python-side models and validation helpers.
"""
import sys
from pathlib import Path

# Add shared/python to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "shared" / "python"))

from models import Wall, Opening, Room, SceneGraph


def make_wall(**kwargs: object) -> Wall:
    defaults = {
        "id": "w1",
        "storeyId": "s1",
        "start": (0.0, 0.0),
        "end": (5.0, 0.0),
        "thickness": 0.2,
        "height": 2.8,
        "material": "mat-plaster-white",
    }
    defaults.update(kwargs)
    return Wall.model_validate(defaults)


def make_opening(**kwargs: object) -> Opening:
    defaults = {
        "id": "o1",
        "wallId": "w1",
        "type": "door",
        "offset": 1.0,
        "width": 0.9,
        "height": 2.1,
        "sillHeight": 0,
    }
    defaults.update(kwargs)
    return Opening.model_validate(defaults)


class TestWallModel:
    def test_valid_wall(self) -> None:
        w = make_wall()
        assert w.id == "w1"
        assert w.start == (0.0, 0.0)
        assert w.end == (5.0, 0.0)

    def test_zero_thickness_rejected(self) -> None:
        import pytest
        with pytest.raises(Exception):
            make_wall(thickness=0)

    def test_negative_height_rejected(self) -> None:
        import pytest
        with pytest.raises(Exception):
            make_wall(height=-1)

    def test_camelcase_alias(self) -> None:
        w = make_wall()
        assert w.storey_id == "s1"  # snake_case access
        assert w.model_dump(by_alias=True)["storeyId"] == "s1"  # camelCase serialisation


class TestOpeningModel:
    def test_valid_door(self) -> None:
        o = make_opening()
        assert o.type == "door"

    def test_valid_window(self) -> None:
        o = make_opening(type="window", sillHeight=0.9)
        assert o.type == "window"
        assert o.sill_height == 0.9

    def test_negative_offset_rejected(self) -> None:
        import pytest
        with pytest.raises(Exception):
            make_opening(offset=-0.1)

    def test_invalid_type_rejected(self) -> None:
        import pytest
        with pytest.raises(Exception):
            make_opening(type="skylight")


class TestRoomModel:
    def test_valid_room(self) -> None:
        r = Room.model_validate({
            "id": "r1",
            "storeyId": "s1",
            "name": "Living room",
            "polygon": [[0, 0], [5, 0], [5, 4], [0, 4]],
            "floorMaterial": "mat-oak",
        })
        assert len(r.polygon) == 4

    def test_too_few_vertices_rejected(self) -> None:
        import pytest
        with pytest.raises(Exception):
            Room.model_validate({
                "id": "r1",
                "storeyId": "s1",
                "name": "Bad room",
                "polygon": [[0, 0], [1, 0]],
                "floorMaterial": "mat-oak",
            })


class TestSceneGraph:
    def test_empty_scene_graph(self) -> None:
        sg = SceneGraph.model_validate({
            "schemaVersion": 1,
            "projectId": "proj-123",
            "units": "m",
        })
        assert sg.schema_version == 1
        assert sg.walls == []
        assert sg.storeys == []

    def test_get_wall(self) -> None:
        sg = SceneGraph.model_validate({
            "schemaVersion": 1,
            "projectId": "proj-123",
            "units": "m",
            "walls": [{
                "id": "w1",
                "storeyId": "s1",
                "start": [0, 0],
                "end": [5, 0],
                "thickness": 0.2,
                "height": 2.8,
                "material": "mat-plaster-white",
            }],
        })
        assert sg.get_wall("w1") is not None
        assert sg.get_wall("nonexistent") is None
