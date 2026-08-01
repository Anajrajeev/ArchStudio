# Phase 1 — Everything Still Outstanding (the Phase 1B backlog)

> Written at the Phase 1A approval gate, before any 1B code. This is the complete, honest list of
> what Phase 1 still owes. Sources: the original master-prompt Phase 1 scope, the element taxonomy
> from the CAD research (IFC 4.3 + FreeCAD Arch + Revit), and gaps I knowingly deferred in 1A.
>
> Legend — **P1** = required before Phase 1 can be called done · **P2** = strongly expected of a
> credible BIM tool · **P3** = genuinely deferrable to a later phase.

---

## A. Known gaps deferred from Phase 1A

These are things where the foundation exists and is tested, but the user-facing wiring does not.

| # | Item | Why it's outstanding | P |
|---|---|---|---|
| A1 | **Curved-wall drawing UI** | `arc` baselines are fully supported by the schema, `wallSolidBoxes` (tessellates), snapping (centre/quadrant candidates) and the renderers. There is no *tool* to draw one — a wall's baseline can only become an arc by editing data. Needs: a 3-point arc mode on the wall tool, plus a bulge drag handle on a selected wall. | P1 |
| A2 | **Dynamic UCS — hover a face to re-plane** | `faceWorkPlane()` and the store's `hoverPlaneElementId` exist and are unit-tested, but `Interaction.tsx` only ever uses the active *level* plane. Needs: raycast the scene on move, derive the face plane, apply it for the duration of the command, revert on commit/Esc. This is what lets you draw on top of a wall. | P1 |
| A3 | **"Set work plane to selected face"** (sticky) | The explicit, non-transient counterpart to A2, for long editing sessions on one plane. Plane history (prev/next) is already implemented and tested. | P2 |
| A4 | **Dimension annotations persist** | The `measure` tool shows a live distance but stores nothing. Annotations are *view-specific* in every reference tool, so this needs a `views[]`/annotations concept in the schema — see C1. | P1 |
| A5 | **Box / rubber-band select** | Only click-select and shift-add exist. Needs window (fully-inside, solid border) vs crossing (touching, dashed border) semantics — users test this immediately. | P1 |
| A6 | **Tab-to-cycle competing snaps** | The snap engine ranks candidates and applies hysteresis, but there is no way to step to the runner-up when the winner is wrong. | P2 |
| A7 | **One-shot snap overrides** | Running snaps are toggleable; per-pick overrides (AutoCAD's two-letter codes) are not. | P3 |
| A8 | **Furniture is a placeholder box** | `FurnitureTypeDef.catalogId` is plumbed through; no glTF loading. Deliberately Phase 5 (catalog), noted here so it isn't mistaken for an oversight. | P3 |
| A9 | **Wall joins / cleanup** | Two walls meeting at a corner render as two overlapping boxes; there is no butt/miter join or layer cleanup. Visible at every corner in plan. | P2 |
| A10 | **Multi-select editing in the properties panel** | Selecting several elements shows a count and a hint, but no shared-field editing. | P2 |

---

## B. Element types not yet implemented

The 1A set is walls, doors, windows, openings, slabs, rooms, columns, beams, furniture. Outstanding:

| # | Element | Defining parameters (from the research) | P |
|---|---|---|---|
| B1 | **Roof** | One primitive covers all common forms: a closed footprint wire + per-edge `{angle, run, thickness, overhang, idRel}`. All edges 0° → flat; one sloped → mono-pitch; 90° on the ends → gable; all sloped → hip. Also `cutoffLevel`, fascia depth, rafter cut. Must also *void* the walls it meets. | P1 |
| B2 | **Stairs** | Base line/wire, width, `desiredNumberOfRisers` → derived `actualRiserHeight` (the parametric loop worth copying exactly), tread depth, nosing, structure (none/massive/one-or-two stringers), landings, flight shape (straight / L / U / half-turn). Multi-segment baseline gives L and U with no extra code path. Expose the **Blondel comfort ratio** (62–64 cm) as validation feedback. | P1 |
| B3 | **Railing** | Path (hosted on a stair edge, slab edge or free-standing), height, post spacing, rail + baluster profiles, corner posts, `offsetFromPath`. | P1 |
| B4 | **Curtain wall** | Base line or face, vertical/horizontal grid layout (`none` / `fixedDistance` / `fixedNumber` / `maximumSpacing`), mullion sizes per direction + borders, panel type. Panels are sized *by* the grid, never directly. | P2 |
| B5 | **Ceiling** | Boundary (auto from a room, or sketched), height offset from level, thickness, single-direction slope. | P2 |
| B6 | **Column grid (axes)** | Per-axis distances and angles (so non-orthogonal and radial grids work), extents, bubble numbering (1,2,3 / A,B,C). Cheap to build and a strong credibility signal. | P1 |
| B7 | **Primitive solids + booleans** | Box / cylinder / cone / sphere / prism / wedge / torus, plus union / cut / intersect. This is the escape hatch for anything the typed elements can't express. Needs a real decision on approach — see D2. | P1 |
| B8 | **Slab openings (inner loops) and shafts** | `Opening.hostId` already generalises the void so a slab can be voided; the slab renderer only uses the outer boundary. A shaft cuts through several levels at once. | P2 |
| B9 | **Wall sweeps / reveals** | Horizontal or vertical profile swept along a wall (skirting, cornice, string course). | P3 |
| B10 | **Site / terrain (toposolid)** | Elevation points or imported contours as a true cuttable solid, with sub-divisions and cut/fill volumes. Note: Revit's Toposurface is legacy — model this as a *solid* from the start. | P3 |
| B11 | **Stacked walls, panels, trusses, fences** | Composite and repeat-along-path elements. | P3 |

---

## C. Documentation & annotation (the whole missing subsystem)

The research surfaced a structural point I have not yet acted on: every reference tool splits
elements into **model / datum / view-specific**. Annotations are view-specific — they belong to a
*view*, not to a level. 1A has no view concept at all.

| # | Item | P |
|---|---|---|
| C1 | **A `views[]` concept in the schema** — a saved view = camera + projection + work plane + visibility + crop + cut plane. Everything below hangs off it. | P1 |
| C2 | **Dimensions**: aligned, linear, angular, radial, diameter, arc-length. Must be **parametric** (they update when the measured edge moves) and carry witness lines. | P1 |
| C3 | **Text, labels and leaders**; **room tags** showing number / name / computed area. | P1 |
| C4 | **Spot elevation / coordinate / slope** annotations. | P2 |
| C5 | **Section and elevation views** — a section plane object that drives both the 3D clip and a derived 2D view. `SectionPlane` was in the research's "important" tier. | P2 |
| C6 | **Derived 2D linework** for plan/section (proper cut vs projection line weights, `<Beyond>` styling below the cut). This is what makes a plan read as a drawing rather than a top-down render. | P2 |
| C7 | **View range / plan regions** — cut plane, top, bottom and view depth per view, with the documented drawing rules. | P2 |
| C8 | **Underlay** — the level below shown halftone while drawing. Cheap, and genuinely useful for multi-storey alignment. | P2 |
| C9 | **Sheets / title blocks / print + PDF export.** | P3 |

---

## D. Interaction & precision still owed

| # | Item | Notes | P |
|---|---|---|---|
| D1 | **Direct parametric handles** | Dragging a wall *endpoint*, dragging a wall *face* to change thickness, a stretch handle on a slab edge, push/pull to extrude. 1A moves whole elements only. The research flagged "a gizmo as the only way to edit anything" as a toy tell. | P1 |
| D2 | **Boolean geometry decision** | Box decomposition (D-005) is right for rectangular openings and must stay. B7 and B1 (roofs voiding walls) need real booleans. Options: `three-bvh-csg` in the browser (needs watertight, non-interpenetrating brushes — coplanar wall/opening faces break exactly that), or defer true B-rep to the Phase 6 OpenCascade service. **Decide before building B7.** | P1 |
| D3 | **Trim / extend / split / offset / align** | The standard modify verbs. Trim's "click the side you keep" convention is what makes it feel predictable. | P1 |
| D4 | **Copy / array (linear + radial) / mirror / rotate with numeric entry** | 1A has move only. | P1 |
| D5 | **Groups** | An isolation boundary for repeated layouts (apartment, hotel room). | P2 |
| D6 | **Constraints / locked dimensions** | A locked dimension as a first-class object that holds a relationship, plus equality (EQ) constraints. This is a large subsystem; 1B should scope it deliberately rather than half-build it. | P2 |
| D7 | **Repeat-last-operation and re-parameterise-last** | Double-click to repeat; retype a value to re-run with new arguments. | P2 |
| D8 | **Angle/polar snap increments in the UI** | `applyAngleSnap` exists and is tested but nothing exposes the increment. | P2 |
| D9 | **Zoom-adaptive snap increments** | Snap steps that get finer as you zoom in. | P3 |
| D10 | **Level-of-detail per view scale** | Coarse/medium/fine, controlling whether wall layers render. | P3 |

---

## E. Quality & non-functional items still open

| # | Item | P |
|---|---|---|
| E1 | **The 60 fps performance target is unverified.** CLAUDE.md commits to 60 fps for a 3-storey house, 60+ walls, 40 furniture items on a mid-range laptop. No benchmark exists. Needs: a generated stress scene, a frame-time measurement, then instancing / memoised geometry / per-level culling as required. | P1 |
| E2 | **Bundle size** — 1.33 MB (382 KB gzip), over Vite's 500 KB warning; Three.js dominates. Code-splitting is nominally Phase 7 but is worth a manual-chunks pass earlier. | P2 |
| E3 | **Browser-capability hardening.** Fixed the `ANGLE_instanced_arrays` crash (troika removed, error boundary added). Still owed: a startup WebGL capability check with a clear message, and a test matrix beyond one browser — this class of bug was invisible to my own testing. | P1 |
| E4 | **No integration/interaction tests.** 241 unit tests cover geometry, snapping, picking, the store and the tool FSM, but nothing drives real pointer events. The measure-tool bug and the troika crash both slipped past unit tests. Needs jsdom-level or Playwright-level interaction coverage. | P1 |
| E5 | **Backend/Python parity.** `shared/python/models.py` is still schema **v1**; it does not know about types, levels, fillings, slabs, columns or beams. The Phase 3 agent tools will validate against it, so it must be migrated to v2 with matching tests. | P1 |
| E6 | **Accessibility** — keyboard reachability for panels, ARIA on the tool ribbon and tree, focus order, reduced-motion. Partially present (aria-label/aria-pressed) but unaudited. | P2 |
| E7 | **Undo-history memory** — full before/after snapshots at 100 entries. Fine now; revisit if large scenes make it heavy (noted in D-006). | P3 |
| E8 | **i18n** — strings are extracted, but only `en` ships. Two more locales are Phase 7. | P3 |
| E9 | **Dev-only debug bridge** (`window.__archstudio`) is stripped from production builds; keep or formalise as a diagnostics panel. | P3 |

---

## Recommended 1B ordering

By value per unit of effort, and respecting dependencies:

1. **E3 + E4** — capability check and interaction tests first, so the next round of work can't
   regress invisibly the way the viewport crash did.
2. **A2, A1, A5, D1** — finish the interaction core: hover-to-re-plane, arc drawing, box select,
   parametric handles. These make everything after them nicer to build and to use.
3. **D3, D4** — the modify verbs (trim/extend/split/offset, copy/array/mirror/rotate).
4. **C1 → C2, C3** — the views concept, then dimensions and tags. Unblocks A4.
5. **B6, B1, B2, B3** — column grids (cheap, high signal), then roofs, stairs, railings.
6. **D2 decision → B7** — settle the boolean strategy, then primitives + booleans.
7. **B4, B5, B8** — curtain walls, ceilings, slab openings.
8. **E1** — the performance pass, once there is enough geometry to stress it.
9. **E5** — Python model parity, before Phase 3 needs it.

**Scope note:** items A–D above are larger than a single review cycle. I'd suggest 1B lands in two
gates — **1B-i** = steps 1–4 (interaction core, modify verbs, views + dimensions) and
**1B-ii** = steps 5–9 (the remaining element types, booleans, performance, backend parity) —
rather than one very long stretch with no checkpoint.
