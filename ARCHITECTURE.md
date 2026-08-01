# ArchStudio — Architecture

_Updated at each phase end._

## Overview

Browser-based architectural CAD platform. The single source of truth is a **scene graph** —
a versioned JSON document of typed, parametric objects. Every subsystem reads from or writes to
this document.

```
┌─────────────────────────────────────────────────────────────────┐
│                         BROWSER                                  │
│                                                                  │
│   ┌───────────────────────────────────┐  ┌──────────────────┐   │
│   │   ONE 3D SCENE (react-three-fiber)│  │   Chat Panel      │   │
│   │   ┌─────────────┬───────────────┐ │  │   + Voice Input   │   │
│   │   │ 3D camera   │ Plan camera   │ │  └────────┬─────────┘   │
│   │   │ (persp/orth)│ (ortho + cut) │ │           │              │
│   │   └─────────────┴───────────────┘ │           │              │
│   │   Work plane · Snap engine        │           │              │
│   │   Tool FSM · Numeric entry        │           │              │
│   └──────────────┬────────────────────┘           │              │
│                  │                                │              │
│                  └────────────┬───────────────────┘              │
│                               │                                  │
│                    ┌──────────▼──────┐                          │
│                    │  Zustand Store  │                          │
│                    │  (Scene Graph)  │                          │
│                    │  + Undo/Redo    │                          │
│                    └────────┬────────┘                          │
└─────────────────────────────┼────────────────────────────────────┘
                              │ REST / SSE
┌─────────────────────────────▼────────────────────────────────────┐
│                         BACKEND (FastAPI)                         │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  Projects   │  │  AI Agent    │  │  Plan Import           │  │
│  │  CRUD       │  │  (SSE)       │  │  (vision → scene graph)│  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  AI Provider Layer (AIProvider abstract class)            │   │
│  │  ├── AnthropicProvider (claude-sonnet-4-6 default)        │   │
│  │  └── OpenAIProvider                                       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────┬────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────────┐
│                    SUPABASE                                        │
│                                                                    │
│  Postgres (JSONB projects) │ Auth │ Storage │ RLS on all tables   │
└───────────────────────────────────────────────────────────────────┘
```

## Shared Module (`/shared`)

The only place geometry logic lives:

- `shared/types/scene.ts` — schema v2 types (Category → Type → Instance)
- `shared/types/migrate.ts` — forward migrations; v1 → v2 implemented and tested
- `shared/geometry/index.ts` — 2D primitives, polygons, arc baselines, wall/slab/column/beam
  resolution, `wallSolidBoxes` (solid decomposition with openings cut out), validation
- `shared/geometry/snapping.ts` — the snap engine (analytic candidates, priority ladder,
  hysteresis, axis/angle locks, constraint colour semantics)
- `shared/geometry/workplane.ts` — work planes, ray/plane intersection, coordinate mapping,
  plane history
- `shared/python/models.py` — Pydantic v2 models mirroring the TS types

## Frontend Structure (Phase 1A)

```
frontend/src/
  styles/
    tokens.css      # two-layer design tokens (primitives → semantic aliases), light + dark
  scene/            # client source of truth
    store.ts        # scene graph + work plane + tool FSM + view state + undo/redo + transients
    mutations.ts    # pure SceneGraph→SceneGraph edits, with explicit dependency cascades
    materials.ts    # material id → colour
    ids.ts
  editor/
    tools.ts        # tool state machine: per-click-phase hints + point→mutation builders
    commit.ts       # shared commit path used by BOTH the pointer and keyboard layers
  viewport/         # the single 3D scene
    Viewport.tsx    # canvas, camera rig (persp/ortho), per-level clip + ghost, view cube
    Elements.tsx    # element renderers, all deriving geometry from shared/geometry
    Interaction.tsx # pointer → work plane → snap → tool dispatch
    Overlays.tsx    # work-plane grid, per-type snap glyphs, rubber band, live dimensions
    pick.ts         # screen → world picking (extracted so the seam is unit-testable)
    theme.ts        # bridges CSS tokens into three.js colours
  export/
    buildSceneGroup.ts   # scene graph → THREE.Group (same shared geometry as the viewport)
    exporters.ts         # GLB / OBJ / STL + download
  ui/               # TopBar, ToolRibbon, LeftPanel (levels + model tree), PropertiesPanel,
                    # StatusBar, Icons
  App.tsx           # layout + the window-level keyboard layer
```

The viewport, the plan view, the snap engine and the exporters all derive geometry from the
**same** `shared/geometry` functions, so they cannot disagree — the core scene-graph rule.

## Key Interaction Contracts

| Concern | Rule |
|---|---|
| Coordinates | Scene 2D `[x, y]` → world `[x, elevation, y]`. Y is up. (D-007) |
| Click resolution | axis lock › in-progress plane (frozen on first click) › hovered face › level plane |
| Plan view | Locked top-down ortho camera + cut plane in the SAME scene — never a second scene |
| Selection | Orange in canvas (outline + tint), blue in panels — two non-competing languages |
| Undo | One entry per gesture; a drag collapses via `beginTransient`/`endTransient` |
| Precision | Type a number mid-draw; Tab switches length/angle; X/Y lock axes |
| Failure | Refuse and explain in the status bar; never emit invalid geometry |

## Data Flow

1. **User draws in 2D editor** → updates Zustand store (scene graph diff) → 3D viewport
   re-derives geometry from updated scene graph.
2. **User chats with AI** → message sent to `/api/agent` → backend runs tool-call loop →
   each tool call returns scene-graph diff → SSE-streamed to frontend → Zustand applies diffs
   live → 3D updates in real time.
3. **User saves** → scene graph sent to `/api/projects/{id}` → stored as JSONB in Postgres.

## Test Coverage (Phase 1A — 225 tests)

| Suite | Covers |
|---|---|
| `geometry.test.ts` | 2D primitives, polygons, arc baselines (incl. an 8-value bulge regression), wall resolution, solid decomposition with openings, slabs/columns/beams, validation |
| `snapping.test.ts` | Candidate generation, priority ladder, hysteresis, every snap type, axis/angle locks, constraint colours |
| `pick.test.ts` | Screen → world picking with real three.js cameras: NDC mapping, plan orientation, ortho scale correctness, aperture sizing, miss cases |
| `workplane.test.ts` | Plane construction, ray intersection, coordinate round-trips, plane history |
| `migrate.test.ts` | v1 → v2 including geometric equivalence, type synthesis, opening/filling split, failure modes |
| `store.test.ts` | Mutation immutability, dependency cascades, the type layer, level re-stacking, undo/redo, transient drags, tool state, unit-aware input parsing |
| `tools.test.ts` | Per-phase hints, commit builders, hosted-tool validation paths, chaining |

## Supabase Tables (Phase 0 Schema)

| Table | Key Columns |
|-------|-------------|
| `profiles` | `id` (FK auth.users), `display_name`, `avatar_url` |
| `projects` | `id`, `user_id`, `name`, `scene_graph` (JSONB), `thumbnail_url`, `created_at`, `updated_at` |
| `project_versions` | `id`, `project_id`, `scene_graph` (JSONB), `created_at` |
| `chat_messages` | `id`, `project_id`, `role`, `content`, `tool_calls` (JSONB), `created_at` |
| `user_ai_keys` | `id`, `user_id`, `provider`, `encrypted_key`, `key_hint`, `model_preference` |
| `catalog_items` | `id`, `name`, `category`, `gltf_url`, `thumbnail_url`, `metadata` (JSONB) |

RLS: every table has `user_id`-based policies; `catalog_items` is read-only public.

## Phase Completion Log

| Phase | Completed | Notes |
|-------|-----------|-------|
| 0 | ✅ | Scaffolding |
| 1 (first attempt) | ❌ Rejected | Built a 2D editor with a 3D preview. Wrong input surface, and the UI was not professional grade. |
| 1A | Awaiting approval | Schema v2, design tokens, 3D-native editor (work planes, snap engine, numeric entry, tool FSM), pro UI shell, 8 element types, multi-level clip/ghost, GLB/OBJ/STL export |
