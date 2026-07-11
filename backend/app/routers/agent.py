"""
AI agent router — placeholder for Phase 3.
SSE streaming endpoint that runs the tool-call loop.
"""
from fastapi import APIRouter

router = APIRouter()


@router.post("/chat")
async def chat() -> dict[str, str]:
    # TODO Phase 3: SSE streaming agent loop
    return {"message": "agent not yet implemented — Phase 3"}
