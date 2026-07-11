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
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐   │
│   │  2D Editor   │   │  3D Viewport │   │   Chat Panel      │   │
│   │  (SVG)       │   │  (Three.js)  │   │   + Voice Input   │   │
│   └──────┬───────┘   └──────┬───────┘   └────────┬─────────┘   │
│          │                  │                     │              │
│          └──────────────────┴─────────────────────┘              │
│                             │                                    │
│                    ┌────────▼────────┐                          │
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

- `shared/types/scene.ts` — TypeScript type definitions for the scene graph
- `shared/geometry/` — pure geometry functions (wall extrusion, opening cuts, polygon ops)
- `shared/python/models.py` — Pydantic v2 models mirroring the TS types

## Data Flow

1. **User draws in 2D editor** → updates Zustand store (scene graph diff) → 3D viewport
   re-derives geometry from updated scene graph.
2. **User chats with AI** → message sent to `/api/agent` → backend runs tool-call loop →
   each tool call returns scene-graph diff → SSE-streamed to frontend → Zustand applies diffs
   live → 3D updates in real time.
3. **User saves** → scene graph sent to `/api/projects/{id}` → stored as JSONB in Postgres.

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
| 0 | Pending | Scaffolding |
