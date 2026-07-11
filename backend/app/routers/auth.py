"""
Auth router — placeholder for Phase 2.
Supabase Auth is handled client-side; this router handles
server-side user profile operations and BYOK key management.
"""
from fastapi import APIRouter

router = APIRouter()


@router.get("/me")
async def get_me() -> dict[str, str]:
    # TODO Phase 2: validate Supabase JWT, return profile
    return {"message": "auth not yet implemented — Phase 2"}
