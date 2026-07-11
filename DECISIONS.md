# ArchStudio — Decision Log

Ambiguities resolved during implementation. Each entry: decision made, reasoning, alternatives
considered, and which phase introduced it.

---

## D-001 — Monorepo structure (Phase 0)

**Decision:** Single Git repo with `frontend/`, `backend/`, `shared/`, `export-service/` as
directories (not separate repos or npm workspaces for backend).

**Reasoning:** Simplest for a small team; shared types are co-located; CI runs everything
together. No need for a turborepo/nx setup yet — the frontend and backend are the only TS/Python
consumers of `shared/`.

**Alternative:** Separate repos per service. Rejected: adds cross-repo dep management overhead
with no benefit at this scale.

---

## D-002 — Shared type generation (Phase 0)

**Decision:** Maintain the scene-graph schema as TypeScript types in `shared/types/` and
hand-write the equivalent Pydantic models in `shared/python/`. No code generation (e.g., from
JSON Schema or Protobuf) in Phase 0.

**Reasoning:** The schema is small and stable for now. Code generation adds toolchain complexity
that isn't justified until the schema has many more types. The single source of truth is the
schema spec in CLAUDE.md; both TS and Python models must conform.

**Revisit:** If the schema grows beyond ~15 element types, introduce JSON Schema as the canonical
source and generate both TS and Python from it.

---

## D-003 — Python package manager (Phase 0)

**Decision:** Use `uv` for backend dependencies (as specified in the prompt).

**Reasoning:** `uv` is significantly faster than pip and provides lockfile semantics. Fallback to
pip-tools if uv is unavailable in the deployment environment.

---

## D-004 — Supabase local dev vs. hosted (Phase 0)

**Decision:** Use hosted Supabase project for all environments (dev, staging, prod) with
environment-specific projects. docker-compose runs only the FastAPI backend and (later)
export-service — NOT a local Supabase stack.

**Reasoning:** Running `supabase start` locally requires Docker with 2+ GB RAM for the full
Postgres + Studio + Auth stack, which may not be available on all developer machines. The hosted
free tier is sufficient for development.

**Caveat:** Developers need a Supabase project and to copy connection details into `.env.local`.

---
