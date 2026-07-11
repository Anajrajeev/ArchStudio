"""
Plan import router — placeholder for Phase 4.
PDF/image → scene graph reconstruction.
"""
from fastapi import APIRouter

router = APIRouter()


@router.post("/")
async def import_plan() -> dict[str, str]:
    # TODO Phase 4: upload PDF/image, call vision model, return scene graph
    return {"message": "import not yet implemented — Phase 4"}
