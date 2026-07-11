from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import agent, auth, export, import_plan, projects

app = FastAPI(
    title="ArchStudio API",
    description="Backend for the ArchStudio AI-powered CAD platform",
    version="0.1.0",
)

settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(agent.router, prefix="/api/agent", tags=["agent"])
app.include_router(import_plan.router, prefix="/api/import", tags=["import"])
app.include_router(export.router, prefix="/api/export", tags=["export"])


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": "0.1.0"}
