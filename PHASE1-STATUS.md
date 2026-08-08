# Phase 1 — Live Completion Tracker

> The running state of the Phase 1 backlog defined in [PHASE1B-SCOPE.md](PHASE1B-SCOPE.md).
> That file is the *specification* (written at the 1A gate and not edited since, so it stays an
> honest record of what was promised). **This file is the *status*** — updated as each item lands.
>
> Status values: ✅ done · 🔨 in progress · ⬜ not started · ⏭️ deliberately deferred (with reason)
>
> Priorities are carried over from the scope doc: **P1** = required before Phase 1 can be called
> done · **P2** = strongly expected of a credible BIM tool · **P3** = genuinely a later phase.

---

## Summary

| Gate | P1 items | P2 items | P3 items |
|------|----------|----------|----------|
| 1B-i core (A1/A2/A5, D1/D3/D4, E3/E4) | 8 / 8 done | 2 / 4 | — |
| 1B-i documentation & annotation (C1–C3, A4) | 4 / 4 done | — | — |
| 1B-ii (elements + perf + parity) | 8 / 8 done | 3 / 8 | — |
| Deferred to later phases | — | — | 12 |

**1B-iii pass (this update):** landed 5 P2 items in one pass — A10, B5 (ceiling), B8 (slab
openings/shafts), C4 (spot elevation/coordinate/slope), D7 (repeat-last-operation). D7's P2 count
isn't tracked in the gate table above (D5/D6/D8 predate a "D interaction" summary row and were
never folded into either bucket; not touched here) — see its row in section D below for the
authoritative status.

**Overall P1 count: 20 / 20 done — B1, B2, B3, D2/B7, E1 and E5 all landed this pass. The entire**
**1B-i gate and all of 1B-ii's originally-scoped P1 items are now complete.** (B1's remainder —
the *general*, non-rectangular / per-edge-angle roof solver — was always out of scope per D-018;
what shipped is the wall-voiding case that WAS scoped, D-020.)

**Quality gates as of the last update:** 880 frontend tests, **100 backend tests**, TypeScript
strict clean, ESLint clean (`--max-warnings 0`), `vite build` succeeds. Backend: ruff clean,
`mypy --strict` clean, `shared/python/models.py` at 100% coverage.

**B7's outstanding visual check is now closed.** The Browser pane displayed correctly this
session (unlike the prior one), so a primitive was placed and selected via real `computer` clicks
— not synthetic `PointerEvent`s — and confirmed rendering on screen. Doing so caught a real bug:
**`properties.kind.primitive` rendered as a literal untranslated string** in the Properties panel
instead of a label, because B7 (and, inherited without noticing, this session's B2/B3) never added
`primitive`/`boolean`/`stair`/`railing` to `locales/en.json`'s `properties.kind` map. Fixed, and a
regression test (`tests/locale.test.ts`) now asserts every `ElementKind` has a translation — a
missing STRING is invisible to `tsc` and ESLint, so this is the only automated check that would
have caught it. Re-verified live after the fix: the panel now shows "Solid" correctly.

**Correction to an earlier note in this file:** the preview pane's screenshot capability came back
later in the session, and visual testing while building the column grid renderer caught a real bug
the earlier "unverified" caveat had missed — `Html` labels in `Dimensions.tsx`, `Annotations.tsx`,
and `ColumnGrids.tsx` all used drei's `distanceFactor` prop, which does not combine with an
orthographic camera the way the codebase's other `Html` usages (which never set it) expect; it blew
every label up to cover a large fraction of the viewport. Removed `distanceFactor` from all three
files to match the established pattern (plain `position` + CSS from the design tokens, no
distance-based scaling). Dimensions, annotations, and column grid bubbles are now confirmed
rendering at the correct size in the live 3D/plan viewport.

---

## A. Gaps deferred from Phase 1A

| # | Item | P | Status | Notes |
|---|------|---|--------|-------|
| A1 | Curved-wall drawing UI | P1 | ✅ | 3-point arc mode on the wall tool (ribbon toggle + `A`), live arc preview showing arc length and radius, and a bulge drag handle on a selected wall. Geometry: `bulgeThroughPoint` / `baselineApex` / `circumcenter` in `shared/geometry/index.ts`. A third click on the chord commits a `line` baseline, not a zero-bulge arc. |
| A2 | Dynamic UCS — hover a face to re-plane | P1 | ✅ | `shared/geometry/dynamicPlane.ts` derives a horizontal plane from a wall/slab/column/beam top face (a door resolves to its host wall). Store policy in `applyHoverPlane` enforces the freeze rule (no re-planing once a point is placed) and never writes hover planes into plane history. Only **horizontal** faces re-plane — a vertical face has no scene-2D mapping by design (D-007), so re-planing onto one would make every pick fail. |
| A3 | "Set work plane to selected face" (sticky) | P2 | ✅ | `Shift+P` pins to the selection and locks; `P` releases to the level plane; `Alt+[` / `Alt+]` step plane history. Refuses with a message on a multi- or empty selection. |
| A4 | Dimension annotations persist | P1 | ✅ | Satisfied by construction once C1 landed: dimensions/annotations/room tags live IN the scene graph (`scene.dimensions` etc.), not as separate UI state, so undo/redo (which snapshots the whole scene) and a JSON round-trip carry them automatically — no dimension-specific persistence code needed. Verified with an undo/redo gesture test and a JSON round-trip test. Phase 2's save/load will pick this up for free when it lands. |
| A5 | Box / rubber-band select | P1 | ✅ | `editor/boxSelect.ts`. Window (drag L→R, fully enclosed, solid border) vs crossing (drag R→L, touched, dashed border), with `ui/Marquee.tsx` as a DOM overlay. Tested in **screen** space with an injected projector, not scene 2D — a screen rectangle is a frustum in a perspective view. Crossing tests real element edges, so a small box dropped on a long wall catches it (the case a bounding-box implementation misses). Silhouettes come from the same solid decomposition the renderers use. Shift-drag adds to the selection. |
| A6 | Tab-to-cycle competing snaps | P2 | ⬜ | |
| A7 | One-shot snap overrides | P3 | ⏭️ | Running snaps are toggleable already; per-pick two-letter overrides are a power-user affordance, not a credibility gate. |
| A8 | Furniture is a placeholder box | P3 | ⏭️ | The glTF catalog **is** Phase 5. `catalogId` is already plumbed through. |
| A9 | Wall joins / cleanup | P2 | ⬜ | Visible at every corner in plan. |
| A10 | Multi-select editing in properties | P2 | ✅ | `PropertiesPanel`'s new `MultiProps`: when 2+ SAME-kind elements are selected, shows that kind's common instance fields (wall/slab/ceiling/column/beam/room/furniture/primitive/stair/railing/roof/annotation/dimension), seeded from the first element, committing to every selected id in ONE undo step. A type-level field (wall/slab/ceiling thickness) applies per DISTINCT type across the selection, not just the first element's. A mixed-kind selection keeps the existing hint. **Visually confirmed**: selected 2 columns, edited Rotation once, both rotated; one Undo reverted both. |

## B. Element types

| # | Element | P | Status | Notes |
|---|---------|---|--------|-------|
| B1 | Roof | P1 | ✅ | The roof element (schema v5, `shared/geometry/roof.ts`, `viewport/Roofs.tsx`, the `roof` tool, D-018) plus **wall voiding**, landed this pass as **D-020**: `Wall.top` gains a `{kind:'roof', roofId}` variant; `wallRoofRamp` resolves it to a front/back thickness ramp (a wedge cross-section) for a wall collinear with the roof's own eave line, refusing anything else per D-018's own rule. New `Box3D.topRamp` field, `boxToTriMesh`, and the "Void to roof" Modify-panel verb (`editor/roofVoid.ts`). Python mirror (`TopRoofConstraint`) landed in the same pass. **Still open, and always out of scope for this row:** the *general* non-rectangular / per-edge-angle straight-skeleton roof solver (D-018's own deferral) — B1's wall-voiding scope never depended on it, since a wall only qualifies against an eave line the current closed-form roof geometry already produces exactly. |
| B2 | Stairs | P1 | ✅ | **D-021.** `StairTypeDef` (width, treadDepth) + `Stair` (reuses the wall/column `TopConstraint` union for its "top"; stores `desiredNumberOfRisers`). `shared/geometry/stair.ts`: `actualRiserHeight` is DERIVED from the resolved rise, never stored; one SOLID box per step (each reaching the base, like a real solid-core stair); Blondel comfort ratio (57–66cm) is *feedback* via `validateStair`, not a hard refusal. 2-click `stair` tool (`H`), Properties panel reusing `TopConstraintField`. `+21` geometry/mutation tests, `+3` gesture tests. |
| B3 | Railing | P1 | ✅ | **D-021.** `RailingTypeDef` (height, post thickness/spacing) + `Railing` (an OPEN polyline path, ≥2 points — no "refuse the general case" needed since every segment is straight). `shared/geometry/railing.ts`: one rail box per path segment + posts every `postSpacing`, always forcing one at the exact path end. Needed a genuinely new tool CLASS: `isPathTool` collects unbounded points like a loop tool but never closes on the first click, finishing on Enter instead — wired through `Interaction.tsx`, `App.tsx`, and the gesture test harness identically. `+12` geometry tests, `+3` gesture tests. |
| B4 | Curtain wall | P2 | ⬜ | Panels sized *by* the grid, never directly. |
| B5 | Ceiling | P2 | ✅ | **D-022.** Schema v8 `CeilingTypeDef`/`Ceiling` (`boundary: Vec2[]`, `top: TopConstraint` — reuses the wall/column/stair union, not a bespoke field). Geometry (`resolveCeiling`/`validateCeiling`) and rendering follow Slab's OWN pattern (polygon + `ExtrudeGeometry`), not Box3D — a ceiling is a boundary element like Slab/Room, and Box3D is for linear elements; logged as a deliberate deviation from the literal task wording. Anchored at its finished BOTTOM face, extruding UP by thickness — the mirror of how a Slab extrudes down from its top. `ceiling` tool (`Q`), loop-drawn exactly like slab/room. `+`14 geometry/mutation tests. **Visually confirmed**: drawn, selected, rendered as a plate in 3D, Properties panel shows type/thickness/bottom-face fields. |
| B6 | Column grid (axes) | P1 | ✅ | Schema v4 adds `ColumnGrid`/`GridAxis` (per-axis spacing, so non-uniform bays and radial-ready data model) + `columnGrids[]`, with a tested v3→v4 migration. `shared/geometry/columnGrid.ts` resolves axis positions, grid lines (with extension + bubble points at both ends), and intersections (for future column snapping). `viewport/ColumnGrids.tsx` renders dashed lines + numbered/lettered bubbles. One-click `columngrid` tool (`Y`) drops a sane default (4 numbered × 3 lettered axes, 5m bays); axis count/spacing/labels are edited in Properties (add/remove/rename), the same numeric-first pattern as the rest of the app. `+19` geometry tests, `+2` gesture tests. **Visually confirmed in the browser** — see the note below. |
| B7 | Primitive solids + booleans | P1 | ✅ | Schema v6 adds `PrimitiveTypeDef`/`Primitive` (box, cylinder, cone, sphere, prism, wedge, torus) and `BooleanNode` (`union`/`cut`/`intersect` over operand ids, which may be other nodes — a real tree), with a tested v5→v6 migration that back-fills the default primitive types so pre-v6 projects can use the tool. `shared/geometry/primitives.ts` tessellates each shape to a watertight indexed mesh in pure TS (no Three) plus closed-form volume/bounds; `shared/geometry/booleanTree.ts` resolves/validates the tree (cycles, dangling operands, arity) with no CSG. `frontend/src/geometry/evaluateBoolean.ts` is the single Three seam, lazy-loading `three-bvh-csg@0.0.17` and shared by the viewport AND the exporter. `primitive` tool (`V`), Union/Cut/Intersect + Explode in the Modify panel (verbs, not a tool — they act on an existing selection). `+68` primitive tests, `+38` boolean tests, `+9` gesture tests, `+8` migration tests. See D-019. |
| B8 | Slab openings (inner loops) and shafts | P2 | ✅ | **D-023.** `Slab.openings: Vec2[][]` — inner-loop polygons, always a full-thickness through-cut (not `Opening.hostId`, which is a rectangular-in-a-local-frame model that doesn't fit a slab). Cut via `THREE.Shape` holes (`shape.holes.push(...)`) in the SAME extrusion Slab already uses — `ExtrudeGeometry` builds the cap skip and the hole's own walls for free, no CSG needed. `validateSlab` checks each opening's polygon validity and containment inside the outer boundary. Editor surface: the slab tool gains a `solid`/`opening` mode (`A` toggle, mirroring the wall tool's own line/arc toggle), committing an opening loop to whichever existing slab contains its centroid. `+`8 geometry tests. **Visually confirmed**: cut a rectangular shaft into a floor slab in plan view — the hole renders and no extra slab was created. |
| B9 | Wall sweeps / reveals | P3 | ⏭️ | Decorative profiles; no architectural capability depends on them. |
| B10 | Site / terrain (toposolid) | P3 | ⏭️ | Large subsystem (cut/fill volumes); nothing in Phase 1 needs it. |
| B11 | Stacked walls, panels, trusses, fences | P3 | ⏭️ | Composite/repeat elements built on top of the primitives above. |

## C. Documentation & annotation

| # | Item | P | Status | Notes |
|---|------|---|--------|-------|
| C1 | `views[]` in the schema | P1 | ✅ | Schema v3. Added `SavedView`, `Dimension`, `Annotation`, `RoomTag` types and `views[]`, `dimensions[]`, `annotations[]`, `roomTags[]` to `SceneGraph`. v2→v3 migration adds empty arrays. v1→v2→v3 chain tested. Unblocks C2, C3, A4. |
| C2 | Dimensions (aligned/linear/angular/radial/diameter/arc) | P1 | ✅ | `shared/geometry/dimensions.ts` resolves a `Dimension` (element-point refs, never raw coordinates) into witness lines + dimension line + text — genuinely parametric: moving the referenced wall moves the dimension. `viewport/Dimensions.tsx` renders it (drei `Line` + DOM `Html` label, same no-Troika reasoning as Overlays). New `dimension` tool (ribbon + `I` shortcut): each pick must land on a named element point via the snap engine's `sourceId`, or it refuses — `refFromPoint` is the parametric link. `+21` geometry tests, `+3` gesture tests. **Visually confirmed** after the `distanceFactor` label-sizing fix noted below. |
| C3 | Text, labels, leaders, room tags | P1 | ✅ | `shared/geometry/annotations.ts` resolves `Annotation` (text/label/leader) and `RoomTag` (number/name/computed area, defaulting to the polygon centroid) against the live scene — an orphaned reference (deleted room) drops the tag rather than drawing stale text. `viewport/Annotations.tsx` renders both. Three new tools: `roomtag` (click a room, toggles a tag on/off), `text` (one click, edit wording in Properties), `leader` (two clicks: target then text position). `+13` geometry tests, `+5` gesture tests. **Visually confirmed** after the `distanceFactor` label-sizing fix noted below. |
| C4 | Spot elevation / coordinate / slope | P2 | ✅ | **D-024.** Three new `AnnotationKind`s (`spot-elevation`/`spot-coordinate`/`spot-slope`) placed by one new `spot` tool (`Z`) with a ribbon mode toggle. Elevation samples the work plane's world Y at the click (so hovering a face to Dynamic-UCS-re-plane onto it, then clicking, is the whole interaction); coordinate is just the annotation's own position; slope point-in-polygon-tests the click against every roof footprint and reads that roof's uniform angle (D-018) as `tan(angle)*100`, refusing outside every roof. All three are sampled at placement, not a live host reference — logged as a deliberate scope choice. `resolveAnnotation` computes the display text from the stored numbers on every render. `+`4 format tests. **Visually confirmed**: placed a spot elevation, saw the "+0.000" label render in the viewport and the computed value in Properties; coordinate/slope modes verified via unit tests + the shared render/dispatch code path (the ribbon's mode toggle was off-screen at the test browser's narrow width). |
| C5 | Section and elevation views | P2 | ⬜ | A `SectionPlane` object driving both the 3D clip and a derived 2D view. |
| C6 | Derived 2D linework | P2 | ⬜ | Cut vs projection line weights. What makes a plan read as a drawing. |
| C7 | View range / plan regions | P2 | ⬜ | |
| C8 | Underlay (level below, halftone) | P2 | ⬜ | |
| C9 | Sheets / title blocks / print + PDF | P3 | ⏭️ | Document *output*; the model must be right first. |

## D. Interaction & precision

| # | Item | P | Status | Notes |
|---|------|---|--------|-------|
| D1 | Direct parametric handles | P1 | ✅ | `editor/handles.ts` (pure) + `viewport/Handles.tsx` (r3f shell). Wall endpoints, wall bulge, wall face → thickness, wall top → push/pull, column top → push/pull, slab vertices. One undo entry per drag; plane-space drags snap through the same `resolvePointer` as drawing. Glyph encodes the verb (cube = move point, sphere = bow curve, plate = push face, cone = push/pull). A **level-bound** top stays level-bound when pushed — only its offset changes — so multi-storey tracking survives (D-009). Thickness is a TYPE property, so that handle is magenta and flagged `editsType`: it changes every instance, which is the defining BIM interaction (rule 4), never a surprise. |
| D2 | Boolean geometry decision | P1 | ✅ | **D-019.** The boolean TREE is stored parametrically and the evaluated mesh never is; primitives tessellate in pure TS; evaluation uses `three-bvh-csg` pinned at **0.0.17** (0.0.18 needs `three >= 0.179`, this repo is on 0.167), lazy-loaded via dynamic `import()` so a scene with no boolean pays nothing (E2). Verified before writing code: cube booleans give volume 7.000000 / 1.000000 / 8.000000 exactly, CPU-only, so boolean correctness is unit-testable. Box decomposition (D-005) is unchanged for rectangular openings — the two coexist deliberately. Exact BRep booleans stay deferred to the Phase 6 OpenCascade path. |
| D3 | Trim / extend / split / offset / align | P1 | ✅ | `shared/geometry/modify.ts` (line math) + `editor/modifyVerbs.ts` (scene verbs) + four ribbon tools (`T` `E` `K` `O`) and align buttons in the Modify panel. Trim uses **"click the side you keep"**; trim/extend are two-pick (boundary, then target). **Split** hands each opening to the piece containing it and rebases its offset, and refuses when an opening straddles the cut. **Extend** from the start slides openings so they stay put in space. Offset takes its sign from which side you click, and offsets arcs by changing radius (bulge unchanged). Trim/extend refuse on arcs rather than picking one of two intersections arbitrarily — stated, not hidden. |
| D4 | Copy / array (linear + radial) / mirror / rotate | P1 | ✅ | `shared/geometry/transform.ts` (one affine type) + `editor/transforms.ts` (verbs) + `ui/ModifyPanel.tsx` (numeric-first UI that works on a multi-selection). A mirrored arc's bulge **negates** (it encodes a signed sweep); a rotated column's own `rotation` scalar follows. Copying a wall brings its openings AND their fillings — the mirror of `deleteElement`'s cascade. A full 360° ring divides by the item count so the last copy does not land on the original. |
| D5 | Groups | P2 | ⬜ | |
| D6 | Constraints / locked dimensions | P2 | ⬜ | Large subsystem — to be scoped deliberately, not half-built. |
| D7 | Repeat-last-operation | P2 | ✅ | **D-025.** The store tracks `lastPlacementTool` — the last TYPED-placement tool (one with its own `activeXTypeId`) a commit succeeded on. `Space`, at rest, calls `repeatLastOperation` which switches back to it; every type/parameter is already a persistent field tool-switching doesn't reset, so that alone restores "same tool + type + parameters." `+`4 store tests. **Unverified live**: the test browser's key-dispatch backend sends an empty `key`/`code` for the space bar specifically (confirmed via a temporary `keydown` listener — every other key used this session, including letters, Enter, and Escape, worked correctly), so the shortcut could not be exercised end-to-end in this session; the store action itself is unit-tested and the wiring in `App.tsx` follows the same pattern as every other working shortcut in that file. |
| D8 | Angle/polar snap increments in the UI | P2 | ⬜ | `applyAngleSnap` exists and is tested; nothing exposes the increment. |
| D9 | Zoom-adaptive snap increments | P3 | ⏭️ | Refinement of a working snap system. |
| D10 | Level-of-detail per view scale | P3 | ⏭️ | Performance/aesthetic tuning; belongs with the Phase 7 perf pass. |

## E. Quality & non-functional

| # | Item | P | Status | Notes |
|---|------|---|--------|-------|
| E1 | 60 fps performance target | P1 | ✅ | **Measured — target met.** `scene/stressScene.ts` generates a deterministic 3-storey / 93-wall / 42-furniture scene via the same mutations the editor uses. Loaded through the dev-only debug bridge (`window.__archstudio.loadStressScene()` — there is no save/load yet). Measured live, all 3 storeys visible (default ghost-below view, the realistic case): **~60.0 fps avg, ~58 fps p95, over 480 frames (8s)**, one momentary outlier frame to ~35fps. `sampleFrameTimes(seconds)` is left in the bridge as a permanent re-measurement harness. Camera-in-motion and plan-view framerates were not measured — noted as a follow-up, not silently skipped. |
| E2 | Bundle size (1.31 MB / 368 KB gzip) | P2 | ⬜ | Over Vite's 500 KB warning; Three.js dominates. A `manualChunks` pass. The CSG dependency added in B7 is already split into its own 74 KB chunk that only loads for scenes containing a boolean (D-019), so it does not contribute to the main bundle. |
| E3 | Browser-capability hardening | P1 | ✅ | `viewport/capability.ts` probes WebGL and the extensions the viewport needs, with a clear message instead of a blank canvas; `ViewportBoundary` catches render failures. Troika removed (D-015). |
| E4 | Integration/interaction tests | P1 | ✅ | `pointer.test.ts` + `gestures.test.ts` drive whole gestures through the same decision tree `Interaction.tsx` uses. Extended this session with the arc-wall gesture and the handle drags. |
| E5 | Backend/Python parity | P1 | ✅ | `shared/python/models.py` rewritten v1 → **v6** (~105 → ~860 lines), mirroring `scene.ts` section for section: the 9-category `ElementTypeDef` union, all 22 collections, and the four other discriminated unions (`TopConstraint`, `Baseline`, `ProfileShape`, 7-variant `PrimitiveShape`). **Migration is deliberately NOT duplicated** — it stays TS-only and `parse_scene()` refuses any other version with "Migrate it client-side before sending", so there is one implementation of that logic, not two. Fixed a live drift bug: `Units` was missing `"mm"`. Golden fixtures in `shared/fixtures/` lock the two languages together (see below). `shared/python` is now a real package, covered by ruff + `mypy --strict` + coverage in CI — it was in **no** gate at all before. Backend tests **13 → 78**, `models.py` at **100%** coverage. |
| E6 | Accessibility audit | P2 | ⬜ | aria-label/aria-pressed partially present but unaudited. |
| E7 | Undo-history memory | P3 | ⏭️ | Full snapshots at 100 entries; fine at current scene sizes (noted in D-006). |
| E8 | i18n — only `en` ships | P3 | ⏭️ | Strings are extracted; additional locales are explicitly Phase 7. |
| E9 | Dev-only debug bridge | P3 | ⏭️ | Already stripped from production builds. |

---

## Change log

Newest first. One line per landed item.

- **A10 / B5 / B8 / C4 / D7** — five P2 items landed in one pass. Schema bumped to v8
  (`ceilings[]`, `Slab.openings`, `Annotation.elevation`/`slope` — D-022/D-023/D-024), with the
  Python mirror and golden fixtures updated in the same pass. Ceiling (B5) reuses Slab's own
  polygon-extrusion pattern rather than Box3D, anchored at its bottom face via the same
  `TopConstraint` union walls already use — a deliberate, logged deviation from the backlog item's
  literal "reuse Box3D" wording (D-022). Slab openings (B8) cut via `THREE.Shape` holes, not CSG
  (D-023) — the slab tool's new solid/opening mode toggles with `A`, mirroring the wall tool's own
  line/arc toggle. Spot annotations (C4) sample the work plane's elevation or a roof's uniform
  slope at the click, not a live host reference (D-024) — a new `spot` tool (`Z`) with a ribbon
  mode toggle. D7 tracks `lastPlacementTool` and rebinds `Space` to switch back to it; A10 adds
  `PropertiesPanel`'s `MultiProps` for same-kind bulk instance-field edits in one undo step
  (D-025). `+`43 tests (880 total frontend, 100 total backend).
  **Also fixed while here:** `ViewportHints`'s empty-state check never accounted for roofs,
  primitives, stairs, railings, column grids, or (now) ceilings — found live while verifying B5,
  since a scene with only a ceiling still showed the "empty project" overlay.
  **Visually confirmed:** ceiling drawn/selected/rendered as a 3D plate with correct Properties;
  a rectangular shaft cut cleanly through a floor slab with no extra slab created; a spot
  elevation rendered its computed value in the viewport and Properties panel; multi-selecting two
  columns and editing Rotation once rotated both and undid both in one step.
  **Unverified live:** D7's `Space` shortcut — the test browser session's key-dispatch backend
  sent an empty `key`/`code` for the space bar specifically (every other key this session,
  including letters, Enter and Escape, worked correctly); the store action is unit-tested and the
  `App.tsx` wiring matches every other working shortcut's pattern. Spot coordinate/slope modes were
  verified via unit tests and the shared render/dispatch path rather than a ribbon click, since the
  `SpotModeToggle` sat past the test browser's narrow (800px) width with no visible overflow
  affordance.
- **B1 / B2 / B3 / E1** — the last four Phase 1 P1 items, landed in one pass. Wall voiding
  (D-020): a `TopConstraint` `roof` variant + `wallRoofRamp`'s thickness-only wedge ramp for a
  wall on an eave line, a new `Box3D.topRamp` field, and the "Void to roof" Modify-panel verb.
  Stairs and railings (D-021): both reuse the Category→Type→Instance split and solid-box
  decomposition already established for walls; `actualRiserHeight` is derived, never stored;
  railings introduced `isPathTool`, a genuinely new tool class (an open, non-closing path,
  finished with Enter). E1: a generated 3-storey/93-wall/42-furniture stress scene measured live
  at ~60fps avg / ~58fps p95 — the target was met, not assumed. Schema bumped to v7 (`stairs[]`,
  `railings[]`), with the Python mirror and golden fixtures updated in the same pass, not a
  follow-up. `+123` frontend tests (837 total), `+13` backend tests (87 total, `models.py` still
  100% covered).
  **Also caught by the live visual check this pass** (the outstanding gap from B7): `Properties
  panel` showed the literal string `properties.kind.primitive` instead of a label — B7's
  `primitive`/`boolean` categories (and, inherited without noticing, this pass's `stair`/
  `railing`) were never added to `locales/en.json`. Fixed, with a new regression test
  (`tests/locale.test.ts`) asserting every `ElementKind` has a translation, since a missing
  string is invisible to `tsc` and ESLint alike.
- **E5** — Python/backend parity. `shared/python/models.py` rewritten v1 → v6; migration stays
  TS-only by design, with `parse_scene()` refusing other versions instead of duplicating five
  migrations in a second language. `shared/python` became a real package and entered CI (ruff,
  `mypy --strict`, coverage) for the first time. Backend tests 13 → 78, `models.py` 100% covered.
  **The durable part is the lock, not the port:** golden fixtures in `shared/fixtures/` are emitted
  by the TS suite and parsed by the Python suite, with `extra="forbid"` on `SceneGraph`. Both
  directions were verified by deliberately breaking them — bumping `SCHEMA_VERSION` to 7 failed the
  TS suite, and adding a TS-only collection then regenerating failed the Python suite with
  `Extra inputs are not permitted`. Fixed on the way: `Units` was missing `"mm"`; the backend
  Dockerfile never copied `shared/` so a runtime import would fail in a real image (compose hid this
  with a volume mounted at a *different* path); and `AGENTS.md` still presented the v1 schema as
  authoritative, which is how the next agent would have re-drifted.
  **Unverified:** the Docker/compose change could not be built — Docker is not installed in this
  environment. The package layout it relies on WAS verified (importing `shared.python.models` from
  an unrelated cwd with `PYTHONPATH` set to the repo root, as the image does); only the `COPY` steps
  and the compose context change are untested. Run `docker compose build backend` before relying on
  a built image.
- **D2 / B7** — the boolean-geometry decision (D-019) and primitive solids + booleans. Schema v6
  (`primitives[]`, `booleans[]`), pure tessellation + tree resolution in `shared/geometry/`, one
  lazy-loaded `three-bvh-csg` seam shared by the viewport and the exporter, `primitive` tool (`V`),
  and Union/Cut/Intersect/Explode as Modify-panel verbs. `+123` tests (741 total).
  Three real bugs the tests caught, all of which would have silently corrupted booleans rather than
  looked wrong: every primitive was built **inside-out** (negative volume — an inverted operand makes
  a subtraction keep exactly the material it should remove), the cylinder/cone/prism **end caps wound
  the same way as their side faces** so those three shapes were not watertight, and the torus grid was
  reversed. The watertightness and signed-volume assertions exist precisely because none of these
  three is visible in a render.
  Also fixed while here, both pre-existing: `buildSceneGroup` never emitted **roofs** (the viewport
  drew a roof no export contained — a one-geometry-rule violation), and the model tree omitted roofs
  and column grids, so B1/B6 elements could be drawn but never selected from the tree. The ribbon's
  type selector also had no `roof` case, so the roof type dropdown ignored the active selection.
- **B6** — column grids: schema v4, geometry (axis positions/lines/intersections), renderer,
  `columngrid` tool with Properties-panel axis editing. `+19` geometry tests, `+2` gesture tests.
  Caught and fixed a real bug while visually verifying: `distanceFactor` on the `Html` labels in
  Dimensions/Annotations/ColumnGrids blew their size up in the ortho camera — removed to match the
  rest of the codebase's `Html` usage. All three now confirmed rendering correctly.
- **A4** — dimensions/annotations/room tags persist by construction (they live in the scene graph
  itself). `+1` JSON round-trip test, `+1` undo/redo gesture test.
- **C3** — text/label/leader annotations and room tags: geometry, renderer, three new tools
  (`roomtag` `G`, `text` `X`, `leader` `L`). `+13` geometry tests, `+5` gesture tests.
- **C2** — parametric dimensions: geometry engine, viewport renderer, `dimension` tool. `+21`
  geometry tests, `+3` gesture tests. Viewport rendering unverified visually this session (see gate
  note above).
- **C1** — schema v3 with `views[]`, `dimensions[]`, `annotations[]`, `roomTags[]`. v2→v3 migration,
  v1→v2→v3 chain tested. `+6` migration tests.
- **D3** — trim, extend, split, offset, align. `+47` unit tests, `+8` gesture tests. Introduced
  `editor/verbResult.ts` so D3 and D4 share one verb contract.
- **D4** — the transform verbs and the Modify panel. `+56` tests.
- **A5** — box select: window/crossing, screen-space edge testing, marquee overlay. `+25` tests.
- **D1** — completed: wall-face thickness drag and push/pull tops for walls and columns. `+16` tests.
- **A1** — 3-point arc wall tool, arc preview, bulge handle. `+18` arc geometry tests, `+9` gesture
  tests, `+20` handle tests.
- **A2 / A3** — Dynamic UCS hover-to-re-plane and the sticky set-plane command. `+31` tests.
- **E3 / E4** — WebGL capability probe and the first real interaction tests.
