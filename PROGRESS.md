# ArchStudio — Progress Tracker

## Current Phase: 0 — Scaffolding
**Status:** Awaiting Approval

---

## Phase History

| Phase | Status | Summary |
|-------|--------|---------|
| 0 | ⏳ Awaiting Approval | Repo layout, config, Supabase schema, CI, tests all green |

---

## Phase 0 Checklist

- [x] CLAUDE.md, PROGRESS.md, DECISIONS.md, ARCHITECTURE.md created
- [x] frontend/ — Vite + React 18 + TS scaffolded (vite.config.ts, tsconfig.json strict)
- [x] frontend/src/ — App.tsx, main.tsx, i18n.ts, locales/en.json
- [x] backend/ — FastAPI skeleton (main.py, config.py, routers placeholders)
- [x] shared/types/scene.ts — SceneGraph TypeScript types
- [x] shared/geometry/index.ts — Pure geometry module (distance, wallFootprint, validators)
- [x] shared/python/models.py — Pydantic v2 models mirroring TS types
- [x] supabase/migrations/001_initial_schema.sql — All 6 tables + RLS policies
- [x] supabase/seed.sql — Furniture catalog seed data
- [x] docker-compose.yml — backend service, export-service commented for Phase 6
- [x] backend/Dockerfile
- [x] .env.example — all env vars documented
- [x] .gitignore
- [x] .github/workflows/ci.yml — frontend (typecheck + lint + test) + backend (ruff + pytest)
- [x] ESLint + Prettier configured (frontend)
- [x] Ruff configured (backend)
- [x] frontend tests: 18/18 passing
- [x] backend tests: 13/13 passing, 88% coverage
- [x] Ruff: all checks passed
- [x] TypeScript: no errors

---

## Open Items

_None._
