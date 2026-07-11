"""
Export router — GLB/OBJ/STL available from Phase 1; STEP/IGES/DXF/IFC from Phase 6.
"""
from fastapi import APIRouter

router = APIRouter()


@router.post("/")
async def request_export() -> dict[str, str]:
    # TODO Phase 1: GLB/OBJ/STL; Phase 6: STEP/IGES/DXF/IFC
    return {"message": "export not yet implemented — Phase 1"}
