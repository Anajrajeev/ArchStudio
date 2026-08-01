# ArchStudio — Durable Project Contract

> Auto-loaded by Codex at the start of every session.
> Read this file, PROGRESS.md, DECISIONS.md, and ARCHITECTURE.md before writing any code.

## What is ArchStudio?

Browser-based FreeCAD-inspired CAD platform for architectural design (floor plans, interior
decoration, multi-story house plans) with an integrated multilingual AI design agent.

## Core Rule (Non-Negotiable)

**Do NOT build a general-purpose CAD kernel.**

The single source of truth is a versioned JSON **scene graph** of typed, parametric objects.

- The 2D editor writes to it.
- The AI agent mutates it exclusively through structured tools.
- The PDF/image importer emits it.
- The 3D viewport derives geometry from it (walls extruded, openings as boolean cuts).
- Exporters serialize from it.

All geometry operations live in ONE shared pure module at `shared/geometry/` — 2D, 3D, and
exporters must use the same code.

## Scene Graph Schema (v1)

```json
{
  "schemaVersion": 1,
  "projectId": "uuid",
  "units": "m",
  "storeys": [{ "id": "s1", "name": "Ground floor", "elevation": 0, "height": 2.8 }],
  "walls": [{ "id": "w1", "storeyId": "s1", "start": [0,0], "end": [5,0],
              "thickness": 0.2, "height": 2.8, "material": "mat-plaster-white" }],
  "openings": [{ "id": "o1", "wallId": "w1", "type": "door|window",
                 "offset": 1.2, "width": 0.9, "height": 2.1, "sillHeight": 0 }],
  "rooms": [{ "id": "r1", "storeyId": "s1", "name": "Living room",
              "polygon": [[0,0],[5,0],[5,4],[0,4]], "floorMaterial": "mat-oak" }],
  "furniture": [{ "id": "f1", "storeyId": "s1", "catalogId": "sofa-01",
                  "position": [2.5,2.0], "rotation": 90, "scale": 1 }],
  "materials": [{ "id": "mat-oak", "name": "Oak", "color": "#b08850", "textureUrl": null }]
}
```

`schemaVersion` is bumped with migrations; old projects must always load.

## Repository Layout

```
/frontend          # React 18 + TS + Vite
/backend           # FastAPI + Python 3.12
/export-service    # headless FreeCAD microservice (Phase 6)
/shared            # scene-graph JSON schema + TS types + Python Pydantic models
/supabase          # migrations, seed data
docker-compose.yml
```

## Stack

- **Frontend**: React 18 + TypeScript (strict) + Vite. Three.js via @react-three/fiber +
  @react-three/drei. 2D editor: SVG-based with snapping. State: Zustand + command-pattern
  undo/redo. i18n: react-i18next.
- **Backend**: Python 3.12 + FastAPI + Pydantic v2. `uv` for deps.
- **Database & Auth**: Supabase — Postgres + RLS on every table + Supabase Auth + Storage.
- **AI**: Plain agent loop on Anthropic/OpenAI SDKs — NO LangChain/LangGraph/CrewAI.
  Default model: `Codex-sonnet-4-6`.

## AI Provider Layer

`AIProvider` abstraction with Anthropic + OpenAI implementations.
Resolved per-request: user's own key + model if configured, else platform default from env.

## BYOK Security Rules (Strict)

- Keys submitted over HTTPS only.
- Encrypted at rest: Fernet/AES-256, encryption key in server env ONLY — never in Supabase.
- Never returned to client after saving (show last 4 chars only).
- Never logged.
- Decrypted server-side at call time only.
- All AI calls go through the backend; keys never touch the browser after submission.

## Phase Table

| Phase | Scope | Model |
|-------|-------|-------|
| 0 | Scaffolding: repo, Vite, FastAPI skeleton, Supabase schema+RLS, docker-compose, CI | Sonnet |
| 1 | Scene graph module + 2D editor + 3D viewport + click-to-select + GLB/OBJ/STL export + multi-storey | Opus/Fable |
| 2 | Supabase auth, projects dashboard, save/load/autosave, versions, thumbnails | Sonnet |
| 3 | AI agent: provider abstraction, tools, SSE streaming, multilingual, voice, BYOK settings | Opus/Fable |
| 4 | PDF/image plan import pipeline with review-mode overlay | Opus/Fable |
| 5 | Interior decoration: furniture/material catalog, drag-drop, material painting, lighting | Sonnet |
| 6 | Advanced geometry + FreeCAD export service + parametric tools + STEP/IGES/DXF/IFC | Opus/Fable |
| 7 | Polish: i18n, performance, error boundaries, deployment, README, arch docs | Sonnet |

## Approval Gate Protocol

At the end of EVERY phase:
1. Run all tests and lint/typecheck; fix failures.
2. Present demo checklist (exact commands, what to click, expected result).
3. STOP and wait for explicit approval ("approved" / "proceed") before next phase.

## Quality Requirements

- TypeScript strict mode; Ruff + mypy on backend; Prettier + ESLint on frontend.
- CI must pass before any phase is presented.
- Unit tests: geometry module (wall extrusion, opening cuts, polygon ops including degenerate
  cases) + every agent tool's validation.
- RLS: users can only read/write their own rows — verified by tests.
- 3D perf: 60 fps on mid-range laptop for 3-storey house, 60+ walls, 40 furniture items.
- Graceful failure: invalid mutations rejected clearly; AI errors surface as friendly UI messages.
- All secrets via env vars; `.env.example` kept current; no key ever committed or sent to client.

## Edge Cases

If ambiguous, choose the simplest option consistent with scene-graph architecture. Log the
decision in DECISIONS.md and flag it in the phase-end summary.
