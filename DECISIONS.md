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

## D-008 — 3D-native editor; plan view is a camera mode, not a second scene (Phase 1A)

**Decision:** Delete the SVG 2D editor. There is ONE r3f scene. Drawing happens directly in the
3D viewport. "Plan" is a locked top-down **orthographic camera plus a horizontal cut plane** in
that same scene.

**Reasoning:** This was a corrected misunderstanding, not a preference. Research across FreeCAD,
AutoCAD, Revit, SketchUp and Blender found that none of them maintains a separate 2D scene — plan
views are filtered projections of the one model. Two scenes that can drift out of sync is
explicitly a "toy tell", and a split editor also violated our own core rule (one source of truth)
more than the unified scene does. The original phase plan said "2D editor writes to it", which was
the flaw.

**Consequences:** `editor2d/` and `viewport3d/` are gone, replaced by `viewport/`. The cut plane
uses `renderer.localClippingEnabled` + per-material `clippingPlanes`.

**Alternative:** Keep both and sync them. Rejected — that is the defect, not the mitigation.

---

## D-009 — Schema v2: Category → Type → Instance (Phase 1A)

**Decision:** Bump to `schemaVersion: 2`, introducing a `types[]` layer. Shape and composition
live on a shared type; placement and extent live on the instance. Also: `Level` becomes
first-class, `Opening.wallId` → `Opening.hostId`, openings split from their fillings (IFC's
host → opening → filling chain), walls gain a `top` constraint union, `locationLine`, and
arc baselines.

**Reasoning:** "Edit the type, sixty walls update" is the defining BIM interaction and costs one
indirection. The research was unambiguous that adding this layer *before* the 3D rewrite is far
cheaper than retrofitting it afterwards. The `top` union (`level` vs `unconnected`) is
specifically what makes multi-storey editing behave: level-referenced elements track storey
height changes, unconnected ones don't.

**Migration:** `shared/types/migrate.ts` synthesises one wall type per distinct v1
(thickness, material) pair, so migrated geometry is byte-for-byte unchanged. v1 openings split
into a void + a filling. Verified by tests, including a solid-decomposition equivalence check.

**Simplification logged:** `locationLine` has 3 values (centreline / finish-exterior /
finish-interior) rather than Revit's 6 — the core-face variants need a "core" concept the layer
model doesn't yet express. Revisit if layered-wall joins are implemented.

---

## D-010 — Design tokens derived from Autodesk Weave; neutral charcoal chrome (Phase 1A)

**Decision:** A two-layer CSS token system (`frontend/src/styles/tokens.css`): primitives are
never referenced by components, only semantic aliases; theme switching rewrites only the semantic
layer. Values derive from Autodesk's **Weave** design system (Apache-2.0), cross-checked against
Blender 4.x, Onshape and FreeCAD 1.0. High density throughout: 11px labels, 12px body, 24px rows,
2px radius, 4px base spacing. Both light and dark ship; **canvas colour is independent of the
chrome theme**.

**Reasoning:** The previous UI's blue-purple chrome was the single largest "cheap" tell, and it's
a colour-science problem rather than taste — the eye white-balances against the field of view, so
a blue field makes the viewer misjudge wall and floor materials. Every verified pro viewport is
exactly neutral (R=G=B): Blender `#3D3D3D`, FreeCAD `#3B3B3B`, Onshape dark `#333333`. Pro CAD UI
is also markedly denser than consumer web; Weave quantifies the gap explicitly via a density axis.
Keeping canvas independent of chrome follows Vectorworks, and matters because plan linework wants
a light ground while the 3D view wants neutral grey.

**Also adopted:** selection is **orange in the canvas, blue in panels** — two deliberately
non-competing visual languages (Onshape and every DCC tool do this). If selection were also blue
it would be ambiguous against the accent colour.

---

## D-011 — Work planes with Dynamic-UCS hover-to-replane (Phase 1A)

**Decision:** A first-class `WorkPlane` (`shared/geometry/workplane.ts`) carrying origin, normal,
in-plane X axis and a source tag, plus plane history (previous/next) and a status-bar badge.
Hovering a planar face re-planes temporarily and reverts when the command ends.

**Reasoning:** This is the primitive that makes drawing in 3D possible at all — every tool
surveyed resolves a 2D pick into 3D through an explicit plane. AutoCAD's Dynamic UCS is nearly
free for us because the scene graph already knows every wall and slab plane analytically.
Blender's model (a persistent 3D cursor with no on-screen plane indicator) was deliberately
**not** copied; its own manual recommends working in two orthographic views as a workaround.

**Critical rule:** an operation in progress **freezes its plane** — the first click fixes it and
later points project onto it rather than being re-raycast. Without this, drawing feels random.

---

## D-012 — Snap engine: analytic candidates, priority ladder, hysteresis (Phase 1A)

**Decision:** Snap candidates are generated **analytically from the scene graph**, never from
meshes. Ten snap types with a strict priority ladder, per-type glyphs, a label naming the snap,
and hysteresis so the current winner keeps winning until the cursor moves meaningfully away. The
aperture is a pixel radius converted to world units at the cursor's depth.

**Reasoning:** Raycasting alone yields a hit point, not midpoints, perpendiculars or
intersections — but we have typed objects, so all of those are exact and cheap. Snap flicker was
identified as the single thing most likely to make the app feel unprofessional, hence the
hysteresis. Converting the aperture through world-per-pixel is what makes snapping feel identical
at every zoom; a fixed world radius feels sticky zoomed out and unreachable zoomed in.

---

## D-013 — Listening dimensions (type-a-number-mid-draw) (Phase 1A)

**Decision:** Typing digits while drawing fills a numeric buffer with no field to focus; Enter
commits it as a constraint; Tab switches between length and angle. Input is unit-aware
(`2400`, `1.2m`, `3'6"`, `2.4+0.3`) and returns null rather than guessing on unparseable input.

**Reasoning:** Ranked as the #1 day-one expectation of any FreeCAD/AutoCAD user and the clearest
real-vs-toy dividing line. The mouse governs direction while the keyboard governs magnitude; that
decoupling is what makes it fast. Requires a window-level key handler that never steals keys from
real inputs — getting that wrong makes every other precision feature unreachable.

---

## D-015 — Viewport text is DOM, never WebGL (Phase 1A, post-review fix)

**Decision:** No `troika-three-text` / drei `<Text>` anywhere. Snap labels, live dimensions and
area readouts render as DOM through drei's `<Html>`, styled from the token layer.

**Reasoning:** A real crash, found only when the user opened the app in Brave rather than the
browser I was testing in. troika's SDF generator requires the `ANGLE_instanced_arrays` WebGL
extension; Brave's anti-fingerprinting blocks it, troika throws an **unhandled promise rejection**,
and the entire r3f tree unmounts — a completely blank viewport with the chrome still drawn.

These were always HUD labels rather than model geometry, so DOM is strictly better anyway: crisper,
themeable from `tokens.css`, no GL capability requirement, and no heavyweight font pipeline.

**Also added:** a `ViewportBoundary` error boundary so a synchronous render failure degrades to a
readable message plus Retry instead of a void. (It cannot catch promise rejections — removing
troika is the actual fix; the boundary is defence in depth.)

**Lesson recorded in PHASE1B-SCOPE.md (E3/E4):** single-browser testing missed this entirely, and
unit tests could never have caught it. A capability check and real interaction tests are P1 for 1B.

---

## D-016 — The visual grid is decoupled from the snap increment (Phase 1A, post-review fix)

**Decision:** The construction grid is fixed at 1 m minor / 5 m major via drei's shader `<Grid>`,
independent of the snap increment. Translucent grid tokens are composited over the ground colour
with `blendOver()` before being handed to the shader.

**Reasoning:** Two bugs in one. First, I had tied the *visual* grid to the *snap* grid, so a 250 mm
snap drew 320 divisions — denser than one line per pixel, anti-aliasing into flat nothing, which is
why the viewport looked empty. Second, `gridHelper` cannot fade with distance, so it moirés at the
horizon; drei's `<Grid>` is a shader grid that fades properly.

`blendOver` exists because drei's `<Grid>` has no per-line opacity uniform: passing
`rgba(255,255,255,0.12)` straight through discards the alpha and renders **full white** — the
glaring grid that reads as amateur. Compositing manually keeps lines ~12–35 RGB units off the
background, the range the research identified. Both behaviours are now unit-tested.

**Also added:** a faint ground plane (~6 RGB units off the background) so the viewport reads as a
floor rather than a void, and an empty-state cue, since an empty scene on the select tool gave a new
user nothing to act on.

---

## D-017 — A module must not export both a component and a hook (Phase 1A, post-review fix)

**Decision:** `useSyncWorkPlaneToLevel` moved out of `Interaction.tsx` into its own module. No
file in the viewport exports both a React component and a hook.

**Reasoning:** react-refresh's "consistent component exports" rule. When violated, Vite cannot hot-
update the module and **fully invalidates** it instead; in an r3f app that tears the canvas down and
loses the WebGL context, so the viewport goes blank mid-session and only a hard reload recovers it.
This was the second cause of the blank viewport the user hit, distinct from D-015.

---

## D-014 — Arc baselines use the DXF bulge convention with a signed radius (Phase 1A)

**Decision:** Curved walls store `{ kind: 'arc', start, end, bulge }`, where `bulge = tan(θ/4)`
(the DXF convention). The arc centre is derived keeping the radius **signed** through the
calculation: `centre = midpoint + leftNormal × (R · cos(θ/2))` with `R = chord / (2·sin(θ/2))`.

**Reasoning:** Signed intermediate values let the sign of `bulge` place the centre on the correct
side with no special-casing for sweep direction or arcs over 180°. An initial implementation used
`abs()` plus explicit sign flags and produced a centre on the wrong side for some inputs — caught
by a test asserting the tessellated polyline lands on its endpoints. There is now a parametrised
regression test across eight bulge values checking endpoint coincidence and constant radius.

**Consequence:** offsetting an arc preserves `bulge` (centre and swept angle are unchanged; only
the radius moves), so curved walls with a location-line offset stay concentric.

---

## D-005 — Openings as box decomposition, not CSG booleans (Phase 1)

**Decision:** A wall with doors/windows is rendered as the set of solid boxes that remain around
the openings (side pillars + lintel above + section below a window sill), computed by the pure
`wallSolidBoxes(wall, openings, yBase)` in `shared/geometry/`. No CSG/boolean-mesh library.

**Reasoning:** Deterministic, fast, dependency-free, and trivially unit-testable. The same box
list feeds both the 3D viewport and the GLB/OBJ/STL exporters, so they can never disagree — which
is the core scene-graph rule. True boolean geometry (for non-rectilinear cuts) is deferred to the
OpenCascade export service in Phase 6 via the `customGeometry` escape hatch.

**Alternative:** three-bvh-csg / three-csg-ts. Rejected for Phase 1: heavier, slower, and overkill
for axis-aligned rectangular openings.

---

## D-006 — Undo/redo via before/after snapshots + transient drags (Phase 1)

**Decision:** The command-pattern history stores `{label, before, after}` scene snapshots. One
`commit()` == one undoable transaction. A `beginTransient/updateTransient/endTransient` path lets a
continuous drag update the scene live but collapse into a single history entry. Scene graphs are
small immutable JSON, so snapshotting is cheap; history is capped at 100 entries.

**Reasoning:** Simplest correct model. A multi-step AI agent edit (Phase 3) will wrap its whole
tool sequence in one transaction and undo as a unit, exactly like a user drag.

**Alternative:** Inverse-command objects / JSON patches. Revisit if history memory becomes an issue
at very large scenes.

---

## D-007 — 2D→3D coordinate mapping (Phase 1)

**Decision:** Scene-graph 2D coordinates `[x, y]` map to world `[x, elevation, y]` (2D **y → world
z**, Y is up). Storeys stack by `elevation`. All geometry (viewport, export, gizmo anchors) uses
this one mapping.

**Reasoning:** Keeps the plan view and the 3D view in exact correspondence with a single, obvious
rule and no per-subsystem transforms.

---

## D-018 — Roofs scoped to rectangular footprints with a uniform slope angle (Phase 1B-ii)

**Decision:** `Roof` v1 supports only footprints that are rectangles (validated at commit time)
with the same slope `angle` on all four edges. The renderer derives a hip roof (or a pyramid when
the rectangle is a square) via closed-form axis-aligned offset math, not a general straight
skeleton. Non-rectangular footprints or mismatched per-edge angles are refused with a clear
message, not silently approximated. Per-edge `{angle, overhang}` is still stored per the schema
spec (so a future general solver is additive, not a migration), but v1's geometry function reads
`edges[0].angle` once it has confirmed all four agree.

**Reasoning:** A general per-edge-angle roof over an arbitrary (possibly concave) footprint is a
weighted straight-skeleton problem — correct implementations require an event-driven sweep
(tracking edge-collapse events as the wavefront advances) to avoid producing wrong geometry on
concave or asymmetric input. That is a substantial, error-prone piece of computational geometry.
For a rectangle, the same problem collapses to elementary axis-aligned line-offset math with a
closed-form ridge height and length, which is safe to implement and exhaustively test in the time
available. Shipping the general solver later is additive: the schema does not need to change, only
`shared/geometry/roof.ts`'s validation gate loosens.

**Consequence — wall voiding deferred:** "must void the walls it meets" (per PHASE1B-SCOPE.md) is
NOT implemented this pass. Doing so correctly requires a wall's TOP to be a sloped plane rather
than a flat height, which `wallSolidBoxes` (D-005) does not model — walls are extruded boxes with a
single top elevation. Cutting a wall to a roof plane turns it into a wedge, a genuinely different
box-decomposition case, and CLAUDE.md requires viewport/exporters to share ONE geometry module, so
this needs to be done once, correctly, for every wall — not bolted on as a roof-specific special
case. Tracked as a follow-up, not silently dropped.

**Alternative considered:** implement the general straight skeleton now. Rejected for this pass —
correctness risk (CLAUDE.md: "refuse and explain — never produce invalid geometry silently") is too
high to rush a sweep algorithm with split/collapse events without dedicated time to test it
properly against concave and degenerate inputs.

---

## D-019 — Boolean geometry: the tree is parametric and pure, the *evaluation* is three-bvh-csg (Phase 1B-ii, D2)

**Decision:** Three separate commitments, deliberately kept apart:

1. **Primitives are pure parametric data.** `shared/geometry/primitives.ts` tessellates each of the
   seven shapes (box, cylinder, cone, sphere, prism, wedge, torus) to an indexed `TriMesh`
   (`{positions, indices}`) in plain TypeScript with **no Three.js import**, alongside closed-form
   `primitiveVolume` / `primitiveBounds`. `shared/geometry/` stays entirely three-free, as it is
   today.
2. **The boolean TREE is the source of truth, never the evaluated mesh.** A `BooleanNode`
   (`{op, operandIds}`) stores *which* elements combine and *how*; operands may be primitives or
   other boolean nodes, so it is a genuine tree. Evaluated triangle soup is never written to the
   scene graph — it is derived, exactly like wall boxes are. This is what keeps a boolean editable,
   undoable and re-resolvable after its operands move.
3. **Evaluation uses `three-bvh-csg`, pinned at `0.0.17`.** One module,
   `frontend/src/geometry/evaluateBoolean.ts`, is the only place that turns a boolean tree into a
   `BufferGeometry`, and **both** the viewport renderer and `export/buildSceneGroup.ts` call it —
   so the screen and the GLB/OBJ/STL cannot disagree, which is the whole point of the one-geometry
   rule.

**Reasoning:** The version pin is load-bearing and not arbitrary: `three-bvh-csg@0.0.18` peers
`three >= 0.179`, but this repo is on `three@0.167`; `0.0.17` peers `three >= 0.151` and works
today, so booleans do not drag a Three.js major upgrade (and an r3f 8.x / drei 9.x compatibility
sweep) into this pass. It was verified before any code was written, not assumed: subtracting a 1 m
cube from a 2 m cube yields volume **7.000000**, intersection **1.000000**, union **8.000000** —
exact to six decimals, running in plain Node with no WebGL context. That last property matters as
much as the accuracy: `three-bvh-csg` is CPU-only, so boolean correctness is genuinely unit-testable
in vitest rather than something we assert by looking at a screenshot.

**Why not build it ourselves:** a robust CSG kernel is precisely the "general-purpose CAD kernel"
the core rule forbids. Coplanar-face handling and numerical robustness are where these algorithms
actually fail, and they take far longer to get right than the rest of B7 combined.

**Lazy-loaded, because E2 is already over budget.** `three-bvh-csg` + `three-mesh-bvh` are ~2.3 MB
unpacked, and the bundle already exceeds Vite's 500 KB warning. So the CSG module is reached through
a cached `loadCsg()` dynamic import, and a scene containing no boolean node never loads a byte of
it. `buildSceneGroup` stays **synchronous** and takes the loaded module as an optional argument —
`exportScene` awaits the load only when `scene.booleans.length > 0`. Making the builder async would
have rippled through its existing callers and tests for no gain.

**Alternatives considered:**

- **`three-csg-ts`** (a csg.js BSP-tree port). Lighter and dependency-free, but BSP CSG's well-known
  failure mode is exactly our most common case — coplanar faces, as produced by cutting a box from a
  box — and it degrades badly with triangle count. Rejected: silently-wrong geometry is the one
  outcome AGENTS.md rules out.
- **Write a CSG kernel in pure TS** so `shared/geometry/` could own booleans end to end. Rejected
  against the core rule, as above. The purity is preserved where it is cheap (primitives, tree
  resolution, validation) and given up only for the one operation that genuinely needs a kernel.
- **Defer booleans entirely to the Phase 6 OpenCascade export service** (the D-005 stance). Rejected
  because D-005's reasoning was specific to *axis-aligned rectangular openings*, where box
  decomposition is strictly better. It does not extend to arbitrary primitive-on-primitive cuts,
  which have no cheap deterministic decomposition.

**Consequences:**

- **D-005 is unchanged.** Wall openings still use box decomposition. Two mechanisms coexist on
  purpose: box decomposition where the cut is rectilinear and analytic, CSG where it is not.
- **Exact BRep booleans stay deferred to Phase 6.** `three-bvh-csg` is a *triangle-mesh* evaluator,
  so results are tessellated, not analytic. This is fine for GLB/OBJ/STL, and is not fine for
  STEP/IGES — that path still goes through OpenCascade, via the same stored boolean tree.
- **Operands are consumed, not duplicated.** An element referenced by a boolean node is skipped by
  the ordinary renderers (`consumedElementIds`), otherwise the uncut original would draw on top of
  the cut result. Deleting a node releases its operands back to visibility rather than destroying
  them.
- **Tree validation refuses rather than guesses**: cycles, missing operands, fewer than two
  operands, and non-solid operands each produce a message, per the refuse-and-explain rule.

**Also fixed in this pass:** `buildSceneGroup` never emitted **roofs**, so the viewport drew a roof
that no export contained — a pre-existing violation of the one-geometry rule (B1/D-018 landed the
renderer but not the export path). Roofs now export from the same `resolveRoof` the viewport uses.

---
