"""
Projects router — placeholder for Phase 2.
Full CRUD with RLS-enforced Supabase queries.
"""
from fastapi import APIRouter

router = APIRouter()


@router.get("/")
async def list_projects() -> dict[str, str]:
    # TODO Phase 2: query Supabase projects for authenticated user
    return {"message": "projects not yet implemented — Phase 2"}


@router.post("/")
async def create_project() -> dict[str, str]:
    return {"message": "projects not yet implemented — Phase 2"}


@router.get("/{project_id}")
async def get_project(project_id: str) -> dict[str, str]:
    return {"message": "projects not yet implemented — Phase 2"}


@router.put("/{project_id}")
async def update_project(project_id: str) -> dict[str, str]:
    return {"message": "projects not yet implemented — Phase 2"}


@router.delete("/{project_id}")
async def delete_project(project_id: str) -> dict[str, str]:
    return {"message": "projects not yet implemented — Phase 2"}
