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
| 1B-i core (A1/A2/A5, D1/D3/D4, E3/E4) | 8 / 8 done | 1 / 4 | — |
| 1B-i documentation & annotation (C1–C3, A4) | 4 / 4 done | — | — |
| 1B-ii (elements + perf + parity) | 1 / 8 done | 0 / 8 | — |
| Deferred to later phases | — | — | 12 |

**Overall P1 count: 13 / 20 done. The entire 1B-i gate (12/12 P1 items) is complete; B6 is the**
**first 1B-ii item landed. Remaining: B1/B2/B3/B7, D2, E1, E5.**

**Quality gates as of the last update:** 593 frontend tests, 13 backend tests, TypeScript strict
clean, ESLint clean (`--max-warnings 0`), `vite build` succeeds.

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
| A10 | Multi-select editing in properties | P2 | 🔨 | The Modify panel (D4/D3) is fully multi-select aware — move/copy/array/mirror/rotate/align all act on the whole selection. Shared *property* editing (one thickness field driving several walls) is still outstanding. |

## B. Element types

| # | Element | P | Status | Notes |
|---|---------|---|--------|-------|
| B1 | Roof | P1 | ⬜ | Closed footprint + per-edge `{angle, run, thickness, overhang}`. Must void the walls it meets. |
| B2 | Stairs | P1 | ⬜ | `desiredNumberOfRisers` → derived `actualRiserHeight`; Blondel comfort ratio as validation feedback. |
| B3 | Railing | P1 | ⬜ | |
| B4 | Curtain wall | P2 | ⬜ | Panels sized *by* the grid, never directly. |
| B5 | Ceiling | P2 | ⬜ | |
| B6 | Column grid (axes) | P1 | ✅ | Schema v4 adds `ColumnGrid`/`GridAxis` (per-axis spacing, so non-uniform bays and radial-ready data model) + `columnGrids[]`, with a tested v3→v4 migration. `shared/geometry/columnGrid.ts` resolves axis positions, grid lines (with extension + bubble points at both ends), and intersections (for future column snapping). `viewport/ColumnGrids.tsx` renders dashed lines + numbered/lettered bubbles. One-click `columngrid` tool (`Y`) drops a sane default (4 numbered × 3 lettered axes, 5m bays); axis count/spacing/labels are edited in Properties (add/remove/rename), the same numeric-first pattern as the rest of the app. `+19` geometry tests, `+2` gesture tests. **Visually confirmed in the browser** — see the note below. |
| B7 | Primitive solids + booleans | P1 | ⬜ | Blocked on the D2 decision. |
| B8 | Slab openings (inner loops) and shafts | P2 | ⬜ | `Opening.hostId` already generalises the void. |
| B9 | Wall sweeps / reveals | P3 | ⏭️ | Decorative profiles; no architectural capability depends on them. |
| B10 | Site / terrain (toposolid) | P3 | ⏭️ | Large subsystem (cut/fill volumes); nothing in Phase 1 needs it. |
| B11 | Stacked walls, panels, trusses, fences | P3 | ⏭️ | Composite/repeat elements built on top of the primitives above. |

## C. Documentation & annotation

| # | Item | P | Status | Notes |
|---|------|---|--------|-------|
| C1 | `views[]` in the schema | P1 | ✅ | Schema v3. Added `SavedView`, `Dimension`, `Annotation`, `RoomTag` types and `views[]`, `dimensions[]`, `annotations[]`, `roomTags[]` to `SceneGraph`. v2→v3 migration adds empty arrays. v1→v2→v3 chain tested. Unblocks C2, C3, A4. |
| C2 | Dimensions (aligned/linear/angular/radial/diameter/arc) | P1 | ✅ | `shared/geometry/dimensions.ts` resolves a `Dimension` (element-point refs, never raw coordinates) into witness lines + dimension line + text — genuinely parametric: moving the referenced wall moves the dimension. `viewport/Dimensions.tsx` renders it (drei `Line` + DOM `Html` label, same no-Troika reasoning as Overlays). New `dimension` tool (ribbon + `I` shortcut): each pick must land on a named element point via the snap engine's `sourceId`, or it refuses — `refFromPoint` is the parametric link. `+21` geometry tests, `+3` gesture tests. **Visually confirmed** after the `distanceFactor` label-sizing fix noted below. |
| C3 | Text, labels, leaders, room tags | P1 | ✅ | `shared/geometry/annotations.ts` resolves `Annotation` (text/label/leader) and `RoomTag` (number/name/computed area, defaulting to the polygon centroid) against the live scene — an orphaned reference (deleted room) drops the tag rather than drawing stale text. `viewport/Annotations.tsx` renders both. Three new tools: `roomtag` (click a room, toggles a tag on/off), `text` (one click, edit wording in Properties), `leader` (two clicks: target then text position). `+13` geometry tests, `+5` gesture tests. **Visually confirmed** after the `distanceFactor` label-sizing fix noted below. |
| C4 | Spot elevation / coordinate / slope | P2 | ⬜ | |
| C5 | Section and elevation views | P2 | ⬜ | A `SectionPlane` object driving both the 3D clip and a derived 2D view. |
| C6 | Derived 2D linework | P2 | ⬜ | Cut vs projection line weights. What makes a plan read as a drawing. |
| C7 | View range / plan regions | P2 | ⬜ | |
| C8 | Underlay (level below, halftone) | P2 | ⬜ | |
| C9 | Sheets / title blocks / print + PDF | P3 | ⏭️ | Document *output*; the model must be right first. |

## D. Interaction & precision

| # | Item | P | Status | Notes |
|---|------|---|--------|-------|
| D1 | Direct parametric handles | P1 | ✅ | `editor/handles.ts` (pure) + `viewport/Handles.tsx` (r3f shell). Wall endpoints, wall bulge, wall face → thickness, wall top → push/pull, column top → push/pull, slab vertices. One undo entry per drag; plane-space drags snap through the same `resolvePointer` as drawing. Glyph encodes the verb (cube = move point, sphere = bow curve, plate = push face, cone = push/pull). A **level-bound** top stays level-bound when pushed — only its offset changes — so multi-storey tracking survives (D-009). Thickness is a TYPE property, so that handle is magenta and flagged `editsType`: it changes every instance, which is the defining BIM interaction (rule 4), never a surprise. |
| D2 | Boolean geometry decision | P1 | ⬜ | Must be settled before B7. Box decomposition (D-005) stays for rectangular openings either way. |
| D3 | Trim / extend / split / offset / align | P1 | ✅ | `shared/geometry/modify.ts` (line math) + `editor/modifyVerbs.ts` (scene verbs) + four ribbon tools (`T` `E` `K` `O`) and align buttons in the Modify panel. Trim uses **"click the side you keep"**; trim/extend are two-pick (boundary, then target). **Split** hands each opening to the piece containing it and rebases its offset, and refuses when an opening straddles the cut. **Extend** from the start slides openings so they stay put in space. Offset takes its sign from which side you click, and offsets arcs by changing radius (bulge unchanged). Trim/extend refuse on arcs rather than picking one of two intersections arbitrarily — stated, not hidden. |
| D4 | Copy / array (linear + radial) / mirror / rotate | P1 | ✅ | `shared/geometry/transform.ts` (one affine type) + `editor/transforms.ts` (verbs) + `ui/ModifyPanel.tsx` (numeric-first UI that works on a multi-selection). A mirrored arc's bulge **negates** (it encodes a signed sweep); a rotated column's own `rotation` scalar follows. Copying a wall brings its openings AND their fillings — the mirror of `deleteElement`'s cascade. A full 360° ring divides by the item count so the last copy does not land on the original. |
| D5 | Groups | P2 | ⬜ | |
| D6 | Constraints / locked dimensions | P2 | ⬜ | Large subsystem — to be scoped deliberately, not half-built. |
| D7 | Repeat-last-operation | P2 | ⬜ | |
| D8 | Angle/polar snap increments in the UI | P2 | ⬜ | `applyAngleSnap` exists and is tested; nothing exposes the increment. |
| D9 | Zoom-adaptive snap increments | P3 | ⏭️ | Refinement of a working snap system. |
| D10 | Level-of-detail per view scale | P3 | ⏭️ | Performance/aesthetic tuning; belongs with the Phase 7 perf pass. |

## E. Quality & non-functional

| # | Item | P | Status | Notes |
|---|------|---|--------|-------|
| E1 | 60 fps performance target unverified | P1 | ⬜ | Needs a generated stress scene (3 storeys, 60+ walls, 40 furniture) and a frame-time measurement before any optimisation. |
| E2 | Bundle size (1.23 MB / 347 KB gzip) | P2 | ⬜ | Over Vite's 500 KB warning; Three.js dominates. A `manualChunks` pass. |
| E3 | Browser-capability hardening | P1 | ✅ | `viewport/capability.ts` probes WebGL and the extensions the viewport needs, with a clear message instead of a blank canvas; `ViewportBoundary` catches render failures. Troika removed (D-015). |
| E4 | Integration/interaction tests | P1 | ✅ | `pointer.test.ts` + `gestures.test.ts` drive whole gestures through the same decision tree `Interaction.tsx` uses. Extended this session with the arc-wall gesture and the handle drags. |
| E5 | Backend/Python parity | P1 | ⬜ | `shared/python/models.py` is still schema **v1** — no types, levels, fillings, slabs, columns or beams. Phase 3's agent tools validate against it. |
| E6 | Accessibility audit | P2 | ⬜ | aria-label/aria-pressed partially present but unaudited. |
| E7 | Undo-history memory | P3 | ⏭️ | Full snapshots at 100 entries; fine at current scene sizes (noted in D-006). |
| E8 | i18n — only `en` ships | P3 | ⏭️ | Strings are extracted; additional locales are explicitly Phase 7. |
| E9 | Dev-only debug bridge | P3 | ⏭️ | Already stripped from production builds. |

---

## Change log

Newest first. One line per landed item.

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
