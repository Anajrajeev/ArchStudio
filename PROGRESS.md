# ArchStudio — Progress Tracker

## Current Phase: 1B — remaining Phase 1 scope
**Status:** Approved to start (2026-08-01). Phase 1A approved.

**Full remaining Phase 1 backlog: [PHASE1B-SCOPE.md](PHASE1B-SCOPE.md)** — 50 tracked items across
deferred 1A gaps, un-built element types, the annotation/views subsystem, interaction verbs, and
non-functional work. Recommended split into two gates (1B-i interaction core + views/dimensions,
1B-ii element types + booleans + performance + backend parity).

---

## Phase History

| Phase | Status | Summary |
|-------|--------|---------|
| 0 | ✅ Approved | Repo layout, config, Supabase schema, CI, tests all green |
| 1 (first attempt) | ❌ Rejected | Built a 2D editor with a 3D preview — wrong input surface; UI not professional grade |
| 1A | ✅ Approved | Schema v2 + 3D-native editor + pro UI + 8 element types; 241 frontend + 13 backend tests green |
| 1B | 🔨 In Progress | Remaining Phase 1 scope — see [PHASE1B-SCOPE.md](PHASE1B-SCOPE.md) |

---

## Why Phase 1 was rejected, and what changed

Two pieces of feedback, both correct:

1. **The UI was not professional grade.** The blue-purple chrome was the single biggest tell, and
   it's a colour-science problem, not taste — a blue field makes the eye misjudge wall and floor
   materials. Density was consumer-web (13px text, 40px controls, 6px radius) rather than CAD
   (11px, 24px, 2px).
2. **The editor was architecturally wrong.** It made the user draw in 2D and watch a 3D preview.
   Real CAD is 3D-native: you draw directly in the 3D viewport, and "plan" is a locked top-down
   orthographic camera with a cut plane *in the same scene*. Two scenes that can drift out of sync
   is a defect. The element vocabulary was also far too thin.

Research covered FreeCAD, AutoCAD, Revit, SketchUp, Blender, Onshape, Fusion, Archicad,
Vectorworks, Arcol, Snaptrude, Forma and Shapr3D before any code was rewritten. Findings and
decisions are logged as D-008 … D-014 in DECISIONS.md.

---

## Phase 1A Checklist

**Foundation**
- [x] Schema v2 — Category → Type → Instance; `Level` first-class; `Opening.hostId`;
      opening/filling split (IFC chain); wall `top` constraint union; `locationLine`; arc baselines
- [x] v1 → v2 migration, with a geometric-equivalence test (migrated walls decompose identically)
- [x] Design token layer — two-layer (primitives → semantic), light + dark, neutral charcoal,
      high density, canvas colour independent of chrome

**Shared geometry (single source of truth)**
- [x] `wallSolidBoxes` — solid decomposition with openings cut out; handles curved walls,
      overlapping openings, and openings larger than their host
- [x] Arc baselines (DXF bulge) with a signed-radius centre derivation + 8-value regression test
- [x] Slab / column / beam solids; wall resolution from type + level
- [x] Snap engine — 10 types, analytic candidates, priority ladder, hysteresis, axis/angle locks
- [x] Work planes — ray intersection, coordinate mapping, plane history, badge

**3D-native editor**
- [x] ONE r3f scene; plan = locked ortho top camera + cut plane
- [x] Work plane with freeze-on-first-click and a status-bar badge
- [x] Tool state machine with per-click-phase hints
- [x] Listening dimensions — type a number mid-draw, Tab switches length/angle, unit-aware
      (`2400`, `1.2m`, `3'6"`, `2.4+0.3`)
- [x] Axis locks (X/Y) + colour-as-type-system on the rubber band
- [x] Per-type snap glyphs + labels, live dimension and area readouts
- [x] Hover prehighlight, orange canvas selection (outline + tint), blue panel selection
- [x] Per-level cut view / ghost-below / isolate
- [x] View cube, view presets (1 = plan, 2 = 3D, 5 = ortho/persp toggle)

**Elements (8 types)**
- [x] Walls (straight + arc-capable), doors, windows, slabs, rooms, columns, beams, furniture

**UI shell**
- [x] 40px top bar, 36px tool ribbon with contextual type selector, 240px left panel
      (levels + model tree), 280px properties panel, 24px status bar
- [x] Properties panel split into TYPE (shared) and INSTANCE sections
- [x] Numeric fields with expression parsing, drag-to-scrub, arrow stepping, tabular numerals
- [x] Custom selects, focus rings, scrollbars (the three fastest "just a website" tells)
- [x] Theme toggle; follows `prefers-color-scheme` when unset
- [x] i18n strings extracted for all new UI

**Quality gates**
- [x] Frontend tests: 225/225 passing
- [x] Backend tests: 13/13 still passing
- [x] TypeScript strict: no errors
- [x] ESLint: clean (0 warnings, `--max-warnings 0`)
- [x] `vite build`: succeeds
- [x] Verified in browser: renders, WebGL initialises, tokens applied, zero console errors

---

## Post-approval fixes (found when the user ran it in their own browser)

Three real defects, all now fixed and covered:

1. **Blank viewport in Brave** — drei's `<Text>` uses troika, which needs the
   `ANGLE_instanced_arrays` WebGL extension. Brave's anti-fingerprinting blocks it → unhandled
   promise rejection → the whole r3f tree unmounted. All viewport text is now DOM (D-015), plus a
   `ViewportBoundary` so render failures degrade to a message instead of a void.
2. **Blank viewport mid-session** — `Interaction.tsx` exported both a component and a hook, which
   breaks react-refresh, forces a full module invalidation, and loses the WebGL context (D-017).
3. **Invisible grid** — the visual grid was tied to the snap increment (320 divisions at 0.05 alpha
   = sub-pixel dense and effectively invisible). Now a fixed 1 m / 5 m shader grid with distance
   fade, alpha composited against the ground so it lands ~12–35 RGB units off the background,
   plus a ground plane and an empty-state cue (D-016).

**Process lesson, tracked as P1 in the 1B backlog:** I verified in one browser only, and no unit
test could have caught any of these. A WebGL capability check (E3) and real interaction tests (E4)
come first in Phase 1B.

## Open Items

- **Bundle size**: 1.32 MB (382 KB gzip), over Vite's 500 KB warning. Three.js dominates.
  Code-splitting is a Phase 7 performance task; noted, not urgent.
- **Furniture** renders as labelled placeholder boxes until the Phase 5 glTF catalog lands.
- **`measure` tool** collects two points and shows a live dimension, but does not yet persist a
  dimension annotation — annotations are view-specific and land in Phase 1B.
- **Curved walls** are fully supported by the schema, geometry, snapping and renderers, but there
  is no arc-drawing UI yet (a wall's baseline can be switched to an arc via data only). Phase 1B.
- **Face work planes** are implemented and tested, but hover-to-re-plane onto an arbitrary face is
  wired only for level planes so far; picking a wall's top face is a Phase 1B tool action.
- The `.env` Supabase credentials remain untouched and unread — they are Phase 2 scope.
