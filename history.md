Let me check memory and the current project state before starting.

Fresh start — no prior memory or project files. Let me plan Phase 0 and then implement it.

---

## Phase 0 Plan

**Model recommendation: Sonnet** — this phase is mechanical scaffolding (directory structure, config files, schema SQL, CI setup). No complex architecture decisions yet.

**Files I'll create:**

| Path | Purpose |
|---|---|
| `CLAUDE.md` | Durable project contract (auto-loaded every session) |
| `PROGRESS.md` | Phase tracking |
| `DECISIONS.md` | Ambiguity log |
| `ARCHITECTURE.md` | Living architecture doc |
| `frontend/` | Vite + React 18 + TS app |
| `backend/` | FastAPI skeleton |
| `shared/` | Scene-graph schema + TS types + Pydantic models |
| `docker-compose.yml` | Local dev orchestration |
| `.env.example` | All required env vars |
| `supabase/migrations/` | SQL schema + RLS policies |
| `.github/workflows/ci.yml` | Lint, typecheck, tests |

**Supabase schema draft:**
- `profiles` — extends `auth.users`
- `projects` — scene graph JSONB + metadata
- `project_versions` — snapshot history
- `chat_messages` — persistent conversation per project
- `user_ai_keys` — encrypted BYOK keys
- `catalog_items` — furniture/material catalog

Let me implement all of this now.

Now let me scaffold the frontend with Vite + React + TypeScript:

The vulnerabilities are in outdated `@typescript-eslint` packages. Let me upgrade to the current versions:

Good — no vulnerabilities. Now let me set up the TypeScript config and ESLint config:

The Vite template created a vanilla TS project (not React). Let me check the src:

React isn't in the package.json — the `react-ts` template didn't install it. Let me fix this and set up the proper project structure:

Now let me overwrite the project config and src files with proper React setup:

Now let me build out the src directory structure:

Now let me build out the full source structure. I'll create all the files in parallel:

Now set up ESLint and Prettier configs:

Now update `package.json` with scripts:

These are dev-server vulnerabilities in vitest/vite. Let me upgrade to vitest v4:

Clean. Now let me build the **shared** module:

Now the Python Pydantic models:

Now the FastAPI backend skeleton:

Now write the geometry tests for the shared module, Supabase migrations, docker-compose, and .env.example in parallel:

Now the Supabase migrations:

Now the GitHub Actions CI workflow:

Now add a Vitest config to the frontend and a basic geometry test in TypeScript:

Now let me run the frontend typecheck and tests to see what's passing:

The old vanilla `main.ts` file is still there. Let me delete those and clean up:

The issue is the tsconfig doesn't include `vite/client` types. Let me fix that:

Typecheck passes. Now run the tests:

The perpendicular formula gives `[0, 1]` for `[1, 0]` — my test comment was right, the assertion was wrong. Fix it:

18 tests passing. Now install backend dependencies and run the Python tests:

Need to fix the hatchling build config in pyproject.toml:

13/13 Python tests passing, 88% coverage. Now run ruff:

All lint checks pass. Now update PROGRESS.md to reflect completion:

Now save a memory for this project:

---

## Phase 0 Complete — Demo Checklist

All checks are green. Here's what to verify:

### Frontend
```bash
cd frontend
npm run typecheck   # → exits 0 (no errors)
npm run test        # → 18 passed, 0 failed
```

### Backend
```bash
cd backend
# With env vars set:
set SUPABASE_URL=https://example.supabase.co
set SUPABASE_SERVICE_ROLE_KEY=test
set SUPABASE_ANON_KEY=test
set BYOK_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
pytest -v           # → 13 passed, 88% coverage
uv tool run ruff check app  # → All checks passed!
```

### Structure created
```
ArchStudio/
├── CLAUDE.md              ← auto-loaded every session
├── PROGRESS.md
├── DECISIONS.md           ← 4 decisions logged
├── ARCHITECTURE.md
├── .env.example           ← all env vars documented
├── .gitignore
├── docker-compose.yml
├── .github/workflows/ci.yml
├── frontend/              ← React 18 + TS + Vite + Three.js + Zustand + i18next
│   └── src/tests/geometry.test.ts  ← 18 geometry unit tests
├── backend/               ← FastAPI skeleton, 5 router placeholders
│   └── tests/             ← health + Pydantic model tests
├── shared/
│   ├── types/scene.ts     ← SceneGraph TypeScript types
│   ├── geometry/index.ts  ← Pure geometry module
│   └── python/models.py   ← Pydantic v2 scene graph models
└── supabase/
    ├── migrations/001_initial_schema.sql  ← 6 tables + RLS on all
    └── seed.sql
```

---

**Ready for Phase 1.** That's the core architecture phase — 2D floor plan editor, 3D viewport with live extrusion, click-to-select & edit, GLB/OBJ/STL export, and multi-storey support. I'd recommend switching to **Opus or Fable** for that phase — it's the highest-leverage architectural work in the project.

**Please reply "approved" / "proceed" to start Phase 1, or let me know if you'd like any changes.**