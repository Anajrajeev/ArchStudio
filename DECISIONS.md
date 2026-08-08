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

## D-020 — Wall voiding: a wall on an eave line gets a thickness-only ramp, not a per-point sample (Phase 1B-ii, B1)

**Decision:** A wall's `TopConstraint` gains a third variant, `{ kind: 'roof'; roofId: string }`.
`shared/geometry/roof.ts`'s new `wallRoofRamp(roof, centerline, thickness)` resolves it to a
**front/back delta pair** — how much lower the wall's exterior-facing top edge sits and how much
higher its interior-facing edge sits, both relative to `roof.baseHeight` — rather than sampling the
roof's height at points along the wall's length. `shared/geometry/index.ts`'s `Box3D` gains an
optional `topRamp` field consumed only by `wallSolidBoxes`, and only for the chunk that reaches the
wall's own top (a lintel or under-sill section stays flat, since it never reaches the roof).

**Reasoning:** A roof face's height is `base + v·tanA`, where `v` is the perpendicular distance
INTO the roof from that edge's own eave (D-018's closed-form hip/pyramid geometry). A wall running
ALONG a footprint edge sits at one fixed `v` for its entire length — only the wall's *thickness*
moves it in `v` — so the top height is constant along the run and varies linearly only across the
thickness. That is exactly a wedge cross-section (which D-018 anticipated in its own consequence
note), not a profile needing per-point sampling along the wall. Reducing to two numbers instead of
a sampled curve is not a shortcut here — it is the exact answer for the only case the roof geometry
itself resolves.

**Scope, deliberately narrow (D-018's own rule, applied again):** `wallRoofRamp` refuses (a
`RoofError`, never a guess) a curved wall, or one that is not collinear with a footprint edge within
1 cm. A wall running into the roof at an angle, or one meeting a future general (non-rectangular,
per-edge-angle) roof, is out of scope until that roof shape itself is. `validateWall` surfaces the
refusal as a message on the wall, exactly like every other "refuse and explain" case in this
codebase.

**The verb, not a drawing tool:** attaching walls to a roof is `editor/roofVoid.ts`'s
`voidWallsToRoof`, invoked from the Modify panel when the selection is one roof plus one or more
walls — mirroring the boolean verbs (D-019), which also act on an existing selection rather than
collecting clicks. Every wall is validated *before* any of them are changed, so a selection with one
disqualifying wall refuses the whole batch instead of leaving a half-attached mix. Detaching is not
a verb: it is just switching a wall's `TopConstraint` back to `unconnected`, which the Properties
panel already does for every other wall.

**Rendering/export:** a flat-topped box is completely unaffected — `topRamp` is undefined for it,
and it still renders as `THREE.BoxGeometry` exactly as before. Only a ramped chunk builds through
the new `boxToTriMesh` (pure, no Three) plus a newly-shared `triMeshToGeometry` (moved out of
`evaluateBoolean.ts` into `scene/geometryUtils.ts` so it has one implementation, not two), used by
both the viewport and the exporter — the same one-geometry discipline as `wallSolidBoxes` itself.

**Python parity:** `shared/python/models.py` gained the matching `TopRoofConstraint` model, since a
wall using the new variant would otherwise be rejected by the backend's `extra="forbid"` schema
(E5). The ramp itself has no Python mirror — like the rest of `shared/geometry/`, it is a
rendering/export concern with no server-side validation counterpart.

**Alternative considered:** sample the roof's height at several points along the wall's length
(reusing the point-in-polygon-plus-plane-equation approach that would be needed for a wall running
*into* the roof, e.g. a gable end or an interior partition). Rejected for this pass — it is strictly
more general than any wall the current v1 roof geometry actually produces a slope for along a wall's
length, so it would be complexity paid for a case that cannot occur yet. Revisit if a future roof
shape (a gable, or a general per-edge-angle solver) introduces walls whose height genuinely varies
along their run, not just across their thickness.

---

## D-021 — Stairs and railings: solid-box decomposition, reusing TopConstraint and the verb pattern (Phase 1B-ii, B2/B3)

**Decision:** Schema v7 adds two element types, both decomposed into axis-aligned `Box3D`s — the
same representation `wallSolidBoxes` already uses, so their renderers and exporter paths are the
same shape of code as everything else, not a new rendering primitive.

**Stairs (B2):** a straight flight only (v1). A `Stair` stores `desiredNumberOfRisers`;
`actualRiserHeight` is **derived** from it and the resolved rise (`top` minus the base) in
`shared/geometry/stair.ts`'s `resolveStair`, exactly mirroring how a wall's height is derived
rather than stored — moving the level a stair lands on keeps the flight consistent instead of
drifting out of sync with a separately-stored number. `Stair.top` reuses the **same
`TopConstraint`** union walls and columns already use (including the roof variant D-020 just
added), rather than a bespoke "lands on this level" field — one less concept to learn, and a
future "attach stair to roof" case, if it ever comes up, needs no schema change.

Geometry is one SOLID box per step: step `i` spans `[i·treadDepth, (i+1)·treadDepth]` horizontally
and `[0, (i+1)·actualRiserHeight]` vertically — each box reaches all the way to the base, so the
boxes stack like a real solid-core stair (concrete/masonry) rather than floating treads. This is
deliberately the simplest correct model; open-riser/stringer stairs are a later phase.

Blondel's comfort formula (`2·riser + tread` should fall in **57–66 cm**) is *feedback*, not a
hard refusal — `validateStair` reports it exactly like every other advisory message in this
codebase. An uncomfortable stair still exists and still renders; comfort is a design choice, not a
geometric impossibility, unlike a roof with mismatched angles (D-018), which renders nothing.

**Railings (B3):** an open polyline path (`Vec2[]`, ≥ 2 points) rather than a single straight run,
because a railing routinely needs to turn a corner (wrapping a stair, a balcony edge) and a
polyline of straight segments has no ambiguity to refuse — unlike a roof or a voided wall, no
"refuse the general case" carve-out is needed. Decomposed into one rail box per path segment plus
vertical posts every `postSpacing`, with a post **always** forced at the exact path end — even if
it lands short of a full spacing interval — so the last stretch of rail is never unsupported.

**New editor surface, reusing established patterns rather than inventing new ones:**
- Both get the standard Type → Instance split (D-009): `StairTypeDef`/`RailingTypeDef` hold shape
  (tread depth, width / rail height, post spacing); instances hold placement.
- The stair tool is a plain 2-click tool, identical in shape to `beam`.
- The railing tool needed a genuinely new *class* of tool: an **open path**, collecting an
  unbounded number of points like `slab`/`room` but never closing on the first point, since a path
  is not a boundary. `editor/tools.ts` gets `isPathTool`, finishing on **Enter** (≥ 2 points)
  exactly where a loop tool would close on a click; `Escape`/`Backspace` needed no change.

**Migration:** purely additive (`stairs: []`, `railings: []`), with the default stair/railing
types back-filled into `types[]` on the way through — the same reasoning as v5→v6's primitive
back-fill (D-019): without it, every pre-v7 project would open with both tools permanently
refusing for want of a type to place.

**Python parity landed in the same pass, not as a follow-up:** `StairTypeDef`, `RailingTypeDef`,
`Stair`, `Railing` all went into `shared/python/models.py` alongside the TS types, and the golden
fixtures (E5) were extended to exercise both. A schema change is not "done" until both sides — and
the fixtures locking them together — agree.

**Alternative considered (railings):** balusters as a fixed 2D symbol swept along the path in the
exporter only, keeping the *scene graph* free of per-post geometry. Rejected: it would mean the
viewport and the exporter compute posts independently, exactly the two-source-of-truth risk D-008
exists to rule out. Pure box decomposition in `shared/geometry/railing.ts`, called by both, avoids
that outright.

---

## D-022 — Ceilings: a boundary polygon anchored at its BOTTOM face, not a Box3D (Phase 1B-iii, B5)

**Decision:** Schema v8 adds `CeilingTypeDef` (`layers`, mirroring Slab) and `Ceiling`
(`boundary: Vec2[]`, `top: TopConstraint`). Geometrically a ceiling is `resolveCeiling` +
`CeilingMesh`/`buildSceneGroup`'s ceiling loop: the SAME `THREE.Shape` + `ExtrudeGeometry` polygon
extrusion Slab already uses, positioned at `bottomElevation + thickness` so it extrudes *down* to
the finished bottom face — the mirror image of how a Slab extrudes down from a stored *top*.
`Ceiling.top` reuses the exact wall/column/stair `TopConstraint` union (never a bespoke field), so
pointing it at the level ABOVE places the finished face at that level's floor — "attaches to the
underside of a level" falls out of the existing constraint semantics with no new concept.

**Reasoning — deviation from the task's own framing, logged rather than silently substituted:** the
backlog item asked to "reuse the Box3D solid decomposition... pattern already used by walls,
stairs, and railings." Box3D decomposition is for LINEAR elements that run along a baseline or
path; a ceiling is a closed BOUNDARY, exactly like Slab and Room, which don't use Box3D either. The
task's own wording calls the item "analogous to Slab" in the same sentence — that's the shape this
element actually has. Forcing a boundary polygon through per-edge Box3D chunks (as a wall's
solid-box run does) would need a genuinely new decomposition just to re-derive what
`ExtrudeGeometry` already does correctly and for free, and would leave Slab and Ceiling — two
polygon elements that differ only in which face is the anchor — rendered by two unrelated code
paths. Reusing Slab's own established pattern keeps one shape of code for one shape of element.

**Consequence:** no new rendering primitive. `polygonToShape` (already shared between
`viewport/Elements.tsx` and `export/buildSceneGroup.ts` for Slab and Room) needed no change to
serve Ceiling too. Python mirror (`Ceiling`, `CeilingTypeDef`) and the golden fixtures landed in the
same pass.

---

## D-023 — Slab openings/shafts cut with `THREE.Shape` holes, not `three-bvh-csg` (Phase 1B-iii, B8)

**Decision:** `Slab.openings: Vec2[][]` — inner-loop polygons in the same absolute scene-2D space as
`boundary`, always a full-thickness through-cut (never a partial recess, unlike a wall's
`Opening`). `resolveSlab` passes them through unchanged; `viewport/Elements.tsx` and
`export/buildSceneGroup.ts` add each as a `shape.holes.push(new THREE.Path(...))`, wound opposite
the (already CCW-normalised) outer boundary. `ExtrudeGeometry` then builds the top cap, bottom cap
AND the hole's own side walls automatically — a shaft reads as a genuine cut through the slab, not
a decal on its top face.

**Reasoning:** D-005 already chose box decomposition over CSG for *wall* openings because they are
axis-aligned rectangles in the wall's own local frame, where box math is exact and box decomposition
is what the wall renderer already does. A slab opening has no such local frame (a stairwell or
shaft is an arbitrary polygon in absolute scene-2D) and the renderer for a slab boundary is already
polygon extrusion, not boxes — so the *correct* closed-form tool here is a second loop in the same
`THREE.Shape`, which is exactly what a hole is, not `three-bvh-csg` (D-019). This keeps the same
"CSG only where a closed-form tool genuinely does not exist" discipline D-019 and D-005 both apply,
just landing on a different closed-form tool for a differently-shaped problem.

**Validation:** `validateSlab` extends its existing polygon checks (reused from `validateRoomPolygon`,
renamed per-opening) to each opening, plus a containment check (every opening vertex must lie inside
the outer boundary via the same `pointInPolygon` the snap engine and room-tag hit-testing already
use) — a hole with nothing to cut is refused, not silently accepted.

**Editor surface:** the slab tool gained a `SlabMode` (`solid` | `opening`), toggled by `A` exactly
like the wall tool's own line/arc toggle (never a conflict, since only one tool is ever active) —
deliberately NOT a new tool letter, since the alphabet was already fully spoken for by this pass
(see D-025). Committing an opening loop finds its target by which existing slab (on the active
level) contains the loop's centroid — the same "hit-test against existing geometry" shape roomtag
already uses — and refuses (a generic invalid-element flash) rather than guessing when none does.

---

## D-024 — Spot annotations: computed from what Dynamic UCS is showing at PLACEMENT time (Phase 1B-iii, C4)

**Decision:** Three new `AnnotationKind`s — `spot-elevation`, `spot-coordinate`, `spot-slope` — each
placed by a single click of one new `spot` tool (a `SpotMode` ribbon toggle picks which, the same
shape as B8's `SlabMode`). `Annotation` gains `elevation: number | null` and `slope: number | null`;
`position` (already on every annotation) doubles as the coordinate readout. All three numbers are
SAMPLED once at the moment of the click, not stored as a live reference to a host element:

- **Elevation** reads `pointerResolution.world[1]` — literally the active work plane's elevation at
  the clicked point. Since Dynamic UCS (A2) already re-planes onto a hovered wall/slab/column/beam
  top before the click lands, hovering the element you want the elevation of and then clicking is
  the whole interaction; no new plane- or host-tracking code was needed.
- **Coordinate** is just `position` — already live/parametric for free, since editing an
  annotation's placement already re-renders from the same field.
- **Slope** is not derivable from the work plane, because A2 deliberately only re-planes onto
  HORIZONTAL faces (D-007/dynamicPlane.ts) — this app's work-plane normal is always vertical, so it
  can never encode a grade. Instead, the click is point-in-polygon tested against every roof
  footprint on the active level; a v1 roof's slope is UNIFORM across its whole footprint by
  construction (D-018), so "the slope at this point" is exactly `tan(edges[0].angle) * 100`, no
  per-point sampling required. Clicking outside every roof footprint refuses with a message rather
  than reporting a meaningless 0%.

**Reasoning for "sampled, not live":** a genuinely live spot elevation would need to track WHICH
host face it sits on (a `hostId`, resolved every render like `elementTopFace` already does for the
hover plane) — a real feature, but a materially bigger one than a P2 readout tool warrants, and one
that raises its own questions this task didn't ask (what happens when the host is deleted, or the
picked point falls outside the host's footprint after an edit). The "measure" tool already
establishes the precedent that a readout in this app can be a snapshot rather than a tracked
reference. `resolveAnnotation` still computes the DISPLAY TEXT from the stored numbers on every
render (never storing a formatted string), so a future unit-formatting change updates every spot tag
for free — the same reasoning `Dimension`'s auto-computed text already uses.

**Consequence:** `PropertiesPanel`'s `AnnotationProps` shows the computed text read-only for the
three spot kinds (no text field to edit, no kind selector to reassign into/out of a spot kind,
since neither makes sense for a computed sample) while `text`/`label`/`leader` keep the full
free-text editor unchanged.

---

## D-025 — Two small editor-ergonomics items share one letter/key budget note (Phase 1B-iii, D7/A10)

**Decision, D7 (repeat-last-operation):** the store tracks `lastPlacementTool` — the last tool a
TYPED placement (`isTypedPlacementTool`: wall/slab/door/window/column/beam/roof/primitive/stair/
railing/ceiling — the ones with their own `activeXTypeId`) committed successfully on. `Space`, at
rest (idle tool phase, no numeric buffer), calls `repeatLastOperation`, which just switches back to
that tool. Nothing else needs to happen: every "parameter" the task's own wording worried about
(active type, `wallMode`, `offsetDistance`, ...) already lives in its own persistent store field
that tool-switching does not reset — so "same tool + type + parameters" falls out of the existing
architecture for free, and the whole feature is "remember one tool id, then call `setTool`."

**Decision, A10 (multi-select property editing):** `PropertiesPanel` gains `MultiProps`, rendered
when 2+ elements are selected. When they are all the SAME kind, it shows that kind's common
INSTANCE fields (declared per-kind, reusing the existing `NumberField`/`CheckField` components) with
the FIRST selected element's value as the starting point; editing one commits a patch to every
selected id in a single `commit()` call, so it is one undo step, not N. A field that lives on the
TYPE (wall/slab/ceiling thickness) is applied to every DISTINCT type the selection happens to span,
not just the first element's type — "one thickness field driving several walls" (the task's own
example) reads naturally as "every selected wall's thickness becomes this," which for a selection
spanning two types means editing two types, not one. A mixed-kind selection keeps the plain
"multiple elements selected" hint, since there is no schema-level field shared across, say, a wall
and a room worth guessing at.

**Why bundled in one entry:** neither item is architecturally deep on its own — both are "read one
more field off the store" — so a shared entry avoids two decision-log entries that would each be a
paragraph restating the same one paragraph of reasoning.

**Letter budget, noted here because D7/B5/B8/C4 all landed in the same pass:** every single-letter
shortcut `A`–`Z` was already spoken for before this pass (`TOOL_KEYS` in `App.tsx`). `Q` and `Z`
were the only two left, spent on `ceiling` and `spot` respectively; `D7`'s repeat could not get a
letter and took `Space` (otherwise unused) instead; `B8`'s opening mode and C4's readout mode each
became a ribbon toggle on an EXISTING tool (`slab`, `spot`) rather than a new tool, exactly as the
wall tool's own line/arc toggle already established the pattern for.

---

## E1 — 60 fps performance target: measured (Phase 1B-ii)

**Finding:** `frontend/src/scene/stressScene.ts` generates a deterministic 3-storey scene (a 4×3
grid of rooms per floor, 31 walls/floor = 93 walls total, 14 furniture items/floor = 42 total) via
the same `addLevel`/`addWall`/`addFurniture` mutations the editor itself uses, so it stresses
exactly the real rendering path. Loaded through the dev-only debug bridge
(`window.__archstudio.loadStressScene()`) since there is no save/load yet (Phase 2).

Measured in the live browser, all 3 storeys visible at once (the default "ghost levels below"
view — the realistic worst case, not an artificially reduced one), camera static: **~60.0 fps
average, ~58 fps at the 95th percentile, over 480 frames (8 s)**. One outlier frame dropped to
~35 fps momentarily (a single spike, not sustained) — worth watching if it recurs once real
projects are larger, but not a target miss on its own.

**Verdict: the 60 fps target is met for the specified stress scene, unmeasured before this pass.**
No optimization work is indicated yet; `window.__archstudio.sampleFrameTimes(seconds)` (added
alongside `loadStressScene`) is left in place as a permanent, dev-only, zero-cost-in-production
harness for re-measuring after future scene-size growth or rendering changes, rather than a
one-off script that would have to be rebuilt next time.

**Not measured (out of scope for this pass, noted rather than silently skipped):** frame time
while the camera is actively orbiting/panning, and behind a plan-view orthographic camera. Static
3D was the case E1 named explicitly; a moving-camera and plan-view pass would be a reasonable
follow-up before any Phase 7 optimization work, since draw-call patterns can differ.

---

## D-026 — Wall joins: a stored `WallJoin` object, mitres via a new `Box3D.endSkew`, assembly-level only (Phase 1B-iv, A9)

**Decision:** A wall join is an explicit, stored `WallJoin` (`{levelId, memberIds, point, style,
throughId}`) created by a "Join walls" verb over an existing selection, and deleted to unjoin. It
carries no geometry: `shared/geometry/wallJoin.ts` derives every trim distance and mitre angle from
the members' current baselines on each resolve, so moving a joined wall keeps the corner clean.
`Box3D` gains `endSkew` — a per-end slant angle, applied in `boxCorners` by displacing each corner
along local X by `lz · tan(angle)` — and `wallSolidBoxes` gains an optional `WallEndAdjust`.

**Why an object rather than a field on `Wall`:** at a T- or X-junction a stem meets another wall's
MIDDLE, not its end, so `Wall.joinStart`/`joinEnd` could not express it. A referencing node created
by a verb over a selection is exactly the shape `BooleanNode` (D-019) already proved out — it is
selectable, has Properties, appears in the model tree, and "unjoin" is just deleting it. There is no
separate "disallow join" state to store, because the absence of a `WallJoin` already means that.

**Why explicit rather than automatic:** the alternative — deriving joins from the wall graph on every
resolve — was considered and rejected. A corner's correct treatment is not always inferable (an
equal-thickness corner can legitimately be mitred *or* butted; a T can run either wall through), and
silently rearranging geometry the user did not ask for is the wrong default in a tool where the
model is the deliverable. The verb keeps the choice where the ambiguity is.

**Why `endSkew` mirrors `topRamp`:** D-020 had already established the precedent that a "box" in this
codebase may have one non-rectangular face, resolved in `boxCorners` and routed through
`boxToTriMesh` for both the viewport and the exporter. A mitre is the same shape of change on a
different face, so it reuses that path exactly — one renderer branch (`ShapedBoxMesh`, generalised
from `RampedBoxMesh`), one exporter branch, and box-select picks up the mitred silhouette for free
because it reads the same `boxCorners`.

**What is solved:**

- **L-corner, two straight walls of equal thickness (±1 mm): a true mitre.** Both walls keep their
  nominal end at the join point and both end faces are cut along the same line — the bisector of the
  two directions pointing away from the point. The skew angle is closed form: `Box3D.endSkew` defines
  the face as the locus `n + tan(σ)·dir`, so requiring that parallel to the mitre line `m` gives
  `tan(σ) = (m·dir) / (m·n)` directly — one formula covering every turn angle and both ends with no
  case analysis. Verified live: the two walls' end faces resolve to the *same two points*.
- **L-corner, unequal thickness: butt.** The thicker wall (or `throughId`) runs to the other's FAR
  face so the corner is filled; the other trims back to its NEAR face. Both are the same line-plane
  crossing with the target offset's sign flipped, so there is one implementation.
- **T-junction: butt**, in both its real-world flavours — one wall passing through the point, and two
  collinear walls terminating at it (the same run after a Split). A stem that stops short of the
  wall is EXTENDED to meet it, which is why members are classified against the wall's infinite line
  rather than only its endpoints.
- **X-junction (two walls crossing): a no-op.** The overlap is interior and invisible. Recorded as
  handled rather than silently unhandled.

**What is refused, and why** — every case surfaces through `validateWallJoin` as a message, never a
guess:

- **Per-layer cleanup is out of scope, and this is the D-018-shaped scoped answer for this item.**
  Revit's real join wraps individual layers of a compound wall around the corner. D-009 already
  declined to model a wall "core" — `locationLine` has 3 values rather than Revit's 6 precisely
  because "the core-face variants need a core concept the layer model doesn't yet express" — and
  per-layer wrapping needs exactly that missing concept. **We join at the assembly level.** Adding
  the core concept first is the prerequisite, not a detail of this item.
- **A curved wall at a join.** The extension runs along an arc and the end face is not a plane, so
  a single skew angle cannot describe it. Refused rather than approximated (D-018's rule again).
- **Members with no vertical overlap** — nothing to clean up.
- **More than four members**, or three-plus members with no straight run among them — no unambiguous
  wall to run through.
- **Too shallow a crossing angle** (< 10°) for a butt, where the crossing distance runs away.
- **A join point more than one wall-length beyond either end**, so two walls whose lines happen to
  cross somewhere in the distance do not "meet" with a metres-long trim.

**Consequence — the join never touches stored geometry.** Extensions and mitres are applied at
decomposition time only; `Wall.baseline` is unchanged. That is what keeps openings (whose `offset` is
measured from that baseline's start) exactly where the user put them when an end is trimmed, and it
makes unjoining a pure delete with nothing to undo.

**Alternative considered:** storing the resolved trim on each wall at join time. Rejected — it would
go stale the moment either wall moved, which is the failure mode "the tree is the source of truth,
never the evaluated result" (D-019) exists to rule out.

---

## D-027 — Curtain wall is a new element kind, not a `Wall` type (Phase 1B-iv, B4)

**Decision:** A new category `curtainWall` with `CurtainWallTypeDef` (two `GridRule`s, mullion
width/depth, panel thickness, two materials) and a `CurtainWall` instance that reuses `Baseline` and
the `TopConstraint` union. `shared/geometry/curtainWall.ts` decomposes it into the same axis-aligned
`Box3D`s walls, stairs and railings already use, returned as `{frame, panels}` so framing and glazing
are separated once rather than re-derived by the renderer and the exporter independently.

**Why not a `WallTypeDef` variant:** a `Wall` is an assembly of full-length layers whose thickness is
`assemblyThickness(layers)` and whose holes are `Opening`s cut by box decomposition. A curtain wall
has no layers (so `assemblyThickness` is meaningless for it) and takes no openings. Every field it
needs would be dead on 100% of ordinary walls, and every field a wall needs would be dead on it. The
category split is what the data actually looks like.

**Panels are sized BY the grid, never directly** — the defining property of a glazing system, and the
one the backlog item names explicitly. There is no panel width or height field anywhere in the
schema; a panel is simply whatever falls between two adjacent grid lines. The grid lives on the
TYPE, so editing it re-grids every instance (D-009) — confirmed live by changing the bay spacing and
watching a placed curtain wall re-divide.

**`GridRule` has three variants, and `gridPositions` always returns both ends as lines.** Returning
the ends rather than special-casing them is what makes the rest of the decomposition trivial: a
mullion sits on every line and a panel fills every gap, with no separate "border mullion" concept to
keep in step. `maximumSpacing` (the fewest EQUAL bays with none exceeding the maximum) is the
default, because that is what a real glazing system does — an even rhythm with no stray narrow panel
at one end; `fixedDistance` keeps exact bays and accepts a shorter final one.

**Out of scope, stated rather than discovered later:**

- **A curved (arc) baseline.** A curved curtain wall is a *faceted* one, and the facets have to
  coincide with the U grid — a second geometry case with its own mullion-rotation problem. Refused
  with a message by `validateCurtainWall`, not approximated. The additive path is clear: facet at the
  U lines and give each bay its own rotation.
- **Door/panel-type overrides.** A door in a curtain wall is a panel *type* substitution, which needs
  a per-cell override table. A real feature, materially bigger than this item.
- **Border mullions differing from interior mullions**, and split/joined mullion profiles.

---

## D-028 — Groups are a top-level collection referencing ids, entered explicitly (Phase 1B-iv, D5)

**Decision:** `groups: ElementGroup[]`, where an `ElementGroup` is `{id, name, memberIds}` and a
member id may be another group's id — a genuine tree. `editor/groups.ts` holds the ONE resolution
rule, shared by viewport picking, drag-move, box-select and the model tree.

**Why a collection and not a `groupId` field on every element:** a field would mean touching all
fifteen element interfaces, all fifteen Python models, and a migration back-filling `groupId: null`
onto every object in every existing document — for a relationship that is naturally one-to-many and
that `BooleanNode` already proves works as a referencing node. Nesting then comes free, and the
cycle/dangling checks are the same shape `booleanTree.ts` already runs.

**A group has no geometry and no renderer.** Selecting one highlights every member because
`SceneContent` hands the renderers the EXPANDED leaf set — no renderer knows groups exist. This is
what kept D5 from touching a single element renderer.

**Interaction:**

- Clicking a member selects the outermost ancestor group, unless the user has ENTERED a group that
  contains it more directly (`store.enteredGroupId`). Double-click enters; `Escape` steps out, and
  deliberately AFTER clearing the selection, so one Escape never does two things at once.
- `Ctrl+G` / `Ctrl+Shift+G` plus Modify-panel buttons. A `Ctrl` chord rather than a letter: `A`–`Z`
  were fully spoken for before this pass (D-025), and grouping is a modifier-flavoured action in
  every tool that has it.
- Entering or leaving a group CLEARS the selection, because what a given id *means* changes at that
  boundary — keeping the old selection would leave the panel showing something the next click could
  not reproduce.

**Existing verbs, each following the `boolean` case already in the same switch:** `moveElement` and
`transformElement` recurse to members (so the assembly keeps its shape rather than shearing);
`duplicateElement` deep-copies the subtree into a NEW group, because sharing members would mean
dragging the copy also moved the original; `deleteElement` on a group deletes its contents — a group
is a unit, which is the whole point, and is exactly why **Ungroup is a separate verb** that removes
only the boundary. Deleting a member prunes it and dissolves any group left with fewer than two, at
a fixpoint, mirroring `pruneBooleanOperand`.

**A group may span levels**, deliberately — a repeated stair-and-landing assembly crosses storeys.
`levelIdOf` reports whichever level its first resolvable member is on, which is all the model tree
asks of it.

**Out of scope, stated:** group *instances* (edit one, every copy updates). That is a Type-level
concept — Revit's family/assembly — and D-009's Category→Type→Instance layer is where it would
belong, not here. A group is an isolation boundary, which is what the backlog item asked for.

---

## D-029 — C7: `views[]` becomes live, and a plan region assigns whole elements rather than splitting them (Phase 1B-iv)

**Decision, part one — views become real.** `SavedView` had existed since C1 (schema v3) but nothing
in `frontend/src` ever read `scene.views`; `Interaction.tsx` hardcoded `viewId: 'default'` in five
places. C7 is the first feature that needs one, so `addLevel` now creates the level's plan view
alongside it and the v8→v9 migration back-fills one per existing level. The active view is then
DERIVED from the active level rather than being a second piece of state to keep in sync — and
creating views eagerly is what stops a camera toggle from having to commit a scene mutation, and an
undo entry, as a side effect.

`SavedView.cutPlaneHeight` is REPLACED by `viewRange: ViewRange | null`, not kept alongside it: two
fields describing the cut height is exactly the drift the TS/Python fixture lock exists to prevent.
The migration is a lossless rewrite — the stored absolute height becomes a level-relative one, so a
v8 view pinned to a level at 3 m with a cut at 4.2 m becomes a 1.2 m cut height describing the
identical plane.

**Decision, part two — how a region reaches the renderer, which is the part that mattered.** The
obvious implementation is to clip the base render to the *complement* of the region and draw the
region separately. That does not work: three.js clipping planes intersect half-spaces, so the
complement of an arbitrary polygon is not expressible, and a second pass over the same geometry
z-fights. Instead, **elements are partitioned before rendering**: `shared/geometry/viewRange.ts`
gives every element a plan anchor point, `regionAt` decides which region owns it, and `SceneContent`
renders one `ClippedGroup` per partition. No geometry is duplicated, no convexity constraint applies,
and an arbitrary polygon works.

**The scoped refusal, and it is deliberate and visible:** *an element belongs WHOLLY to whichever
region contains its plan anchor. Nothing is split at a region boundary.* A wall running from the
low-cut area into the high-cut area is cut at one height along its whole length. Splitting would
require clipping each element in its own local frame against an arbitrary polygon — a CSG problem
D-005 and D-019 both deliberately keep out of the wall path, and one whose result could not be
expressed as `Box3D`s at all. Region boundaries are drawn as a dashed outline in plan precisely so
the rule is visible rather than a surprise, and `validatePlanRegion` reports overlaps by name rather
than leaving the user to guess which one won.

`planAnchor` therefore has to answer for EVERY element kind — a kind with no anchor would silently
fall outside every region and always use the view's default range, which is the quiet wrong answer
this whole entry exists to avoid. It generalises `editor/selection.ts`'s `anchorPoints`, which
covered only six of fifteen kinds, and a test iterates `ELEMENT_COLLECTIONS` to prove there are no
gaps. A curved wall anchors at its APEX, not its chord midpoint, because a strongly bowed wall's
material is nowhere near its chord.

**Tool:** a `planregion` loop tool, drawn exactly like slab/room/ceiling, with **no single-letter
shortcut** — D-025 recorded that `A`–`Z` were already fully spoken for, and nothing requires a tool
to have a letter. It sits in a new "View" ribbon group, because it authors how the drawing is cut
rather than what the model contains.

**Out of scope, stated:** cut-vs-projection LINE WEIGHTS and `<Beyond>` styling are C6, a separate
backlog item; `viewRange.viewDepth` here extends what is drawn, it does not restyle it. `cropRegion`
and `visibleLevelIds` stay dormant on `SavedView`.

**Found during the live check, and worth recording because it limits what C7 can currently show:** a
wall cut mid-height renders as *nothing* in plan, because clipping leaves an open top and the
remaining interior faces are back-facing. This is pre-existing and unrelated to the view range — it
is exactly the gap C6 (poché / derived 2D linework) exists to close — but it means the cut-height
control is easiest to appreciate today on elements whose material sits below the cut. Verified
against real rendered materials instead: three partitions in one plan view resolving to three
different clip bands.

---

## D-030 — C8: underlay is a per-view level reference, cut at ITS OWN range (Phase 1B-iv)

**Decision:** `SavedView.underlayLevelId: string | null`. In plan, that level is drawn whole, as flat
halftone, non-interactive, and clipped by **its own** plan view's `ViewRange` rather than the active
one's — which is the entire point of the feature: you want to see the floor below cut at *its* door
height, not at yours. Confirmed live: with the active level clipped at 1.2/0, the underlaid level
resolved to 4.0/2.8.

**Not a plan region, and it does not reuse that path.** A region is a sub-area of *this* level's plan;
an underlay is a *different level's* plan drawn whole. What the two share is `clipBandFor`, so
"resolve a range against the level it belongs to" has one implementation.

**Distinct from the existing `ghostBelowEnabled`, which is unchanged:**

| | `ghostBelowEnabled` | underlay |
|---|---|---|
| scope | every level below | exactly one chosen level, above **or** below |
| where | 3D and plan | plan only |
| stored | store flag, session-only | on the `SavedView`, saved with the project |
| look | 0.18 opacity, each element's own material | halftone: one flat `--underlay-ink`, 0.28 |

The underlay drops its materials for a single desaturated ink rather than dimming them, so an
underlaid wall can never be mistaken for a faint real one — and it overrides every visibility rule
that would otherwise hide it (isolate-level, hide-above), because it is shown on purpose.

**Consequence — one shared `pickProps`.** C8 added a second reason an element can be
non-interactive, and five renderers had each inlined the same four handlers plus the same `raycast`
null-out. Five hand-copied versions of that rule would have been five chances to forget one, so it
became a single exported helper alongside `surfaceProps`, and every renderer now routes through it.

**Deleting a level** takes its own views and their plan regions with it, but a view that merely
referenced it as an underlay just loses the underlay — the view itself is perfectly valid without
one.
