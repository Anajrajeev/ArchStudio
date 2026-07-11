"""
Pydantic v2 models for the ArchStudio scene graph.
These must stay in sync with shared/types/scene.ts.
"""
from __future__ import annotations

from typing import Annotated, Literal
from pydantic import BaseModel, Field


Vec2 = tuple[float, float]
OpeningType = Literal["door", "window"]
Units = Literal["m", "ft", "cm"]


class Storey(BaseModel):
    id: str
    name: str
    elevation: float
    height: float = Field(gt=0)


class Wall(BaseModel):
    id: str
    storey_id: str = Field(alias="storeyId")
    start: Vec2
    end: Vec2
    thickness: float = Field(gt=0, default=0.2)
    height: float = Field(gt=0)
    material: str

    model_config = {"populate_by_name": True}


class Opening(BaseModel):
    id: str
    wall_id: str = Field(alias="wallId")
    type: OpeningType
    offset: float = Field(ge=0)
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    sill_height: float = Field(ge=0, alias="sillHeight", default=0)

    model_config = {"populate_by_name": True}


class Room(BaseModel):
    id: str
    storey_id: str = Field(alias="storeyId")
    name: str
    polygon: list[Vec2] = Field(min_length=3)
    floor_material: str = Field(alias="floorMaterial")

    model_config = {"populate_by_name": True}


class FurnitureItem(BaseModel):
    id: str
    storey_id: str = Field(alias="storeyId")
    catalog_id: str = Field(alias="catalogId")
    position: Vec2
    rotation: float = 0.0
    scale: float = Field(gt=0, default=1.0)

    model_config = {"populate_by_name": True}


class Material(BaseModel):
    id: str
    name: str
    color: str
    texture_url: str | None = Field(alias="textureUrl", default=None)

    model_config = {"populate_by_name": True}


class SceneGraph(BaseModel):
    schema_version: Annotated[int, Field(alias="schemaVersion")] = 1
    project_id: str = Field(alias="projectId")
    units: Units = "m"
    storeys: list[Storey] = []
    walls: list[Wall] = []
    openings: list[Opening] = []
    rooms: list[Room] = []
    furniture: list[FurnitureItem] = []
    materials: list[Material] = []

    model_config = {"populate_by_name": True}

    def get_wall(self, wall_id: str) -> Wall | None:
        return next((w for w in self.walls if w.id == wall_id), None)

    def get_storey(self, storey_id: str) -> Storey | None:
        return next((s for s in self.storeys if s.id == storey_id), None)


class SceneDiff(BaseModel):
    """Partial update — only include fields that changed."""
    storeys: list[Storey] | None = None
    walls: list[Wall] | None = None
    openings: list[Opening] | None = None
    rooms: list[Room] | None = None
    furniture: list[FurnitureItem] | None = None
    materials: list[Material] | None = None
