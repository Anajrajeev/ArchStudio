/**
 * The interaction layer. Deliberately thin: it feeds DOM pointer events into the pure
 * `resolvePointer` (see `editor/pointer.ts`) and applies the result. All constraint precedence and
 * snapping logic lives in that pure function so it can be tested without a WebGL context.
 *
 * Dynamic UCS (A2) is wired here too: while a drawing tool is idle, the hovered element's top face
 * becomes the active work plane, so you can draw on top of a wall. The decision of *which* plane
 * lives in the store (`applyHoverPlane`) and the geometry in `shared/geometry/dynamicPlane.ts`;
 * this file only reports what is hovered.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { useEditor } from '../scene/store'
import {
  moveElement,
  addDimension,
  addAnnotation,
  addRoomTag,
  removeRoomTag,
  addColumnGrid,
} from '../scene/mutations'
import { newId } from '../scene/ids'
import { refFromPoint } from '../../../shared/geometry/dimensions'
import { defaultRoomTag } from '../../../shared/geometry/annotations'
import { defaultColumnGrid } from '../../../shared/geometry/columnGrid'
import { pointInPolygon } from '../../../shared/geometry/index'
import type { Dimension, Annotation } from '../../../shared/types/scene'
import {
  buildHostedCommit,
  buildModify,
  isHostedTool,
  isLoopTool,
  isPathTool,
  isModifyTool,
  isPairTool,
  modifyHint,
  pointsNeeded,
  shouldCloseLoop,
} from '../editor/tools'
import { commitActiveTool } from '../editor/commit'
import { isHandleDragging } from '../editor/dragLock'
import {
  boxModeFor,
  isBoxDrag,
  normalizeBox,
  selectInBox,
  silhouettes,
} from '../editor/boxSelect'
import { projector } from './pick'
import {
  resolvePointer,
  SNAP_APERTURE_PX,
  WALL_HIT_PX,
  type PointerContext,
  type PointerResolution,
} from '../editor/pointer'
import type { Vec2 } from '../../../shared/types/scene'

export default function Interaction() {
  const { camera, gl } = useThree()
  const dragging = useRef<{ id: string; last: Vec2 } | null>(null)
  /** An in-progress rubber band. The visible box lives in the store; this is the gesture state. */
  const marquee = useRef<{ start: Vec2; additive: boolean } | null>(null)

  /** Snapshot the store slice `resolvePointer` needs. */
  const pointerContext = useCallback((): PointerContext => {
    const s = useEditor.getState()
    return {
      scene: s.scene,
      activeLevelId: s.activeLevelId,
      workPlane: s.workPlane,
      points: s.points,
      axisLock: s.axisLock,
      numeric: s.numeric,
      snapToggles: s.snapToggles,
      gridSize: s.gridSize,
      showGrid: s.showGrid,
      previousSnap: s.snap,
    }
  }, [])

  /** Resolve a pointer event and push the result into the store for the overlays/status bar. */
  const resolve = useCallback(
    (e: PointerEvent): PointerResolution | null => {
      const rect = gl.domElement.getBoundingClientRect()
      const r = resolvePointer(camera, e.clientX, e.clientY, rect, pointerContext())
      if (!r) return null
      useEditor.getState().setSnap(r.snap, r.world)
      return r
    },
    [camera, gl.domElement, pointerContext],
  )

  // ---- pointer move -------------------------------------------------------

  useEffect(() => {
    const el = gl.domElement
    const onMove = (e: PointerEvent) => {
      // A rubber band in progress owns the gesture; it needs no work-plane pick at all.
      if (marquee.current) {
        const rect = el.getBoundingClientRect()
        const at: Vec2 = [e.clientX - rect.left, e.clientY - rect.top]
        const start = marquee.current.start
        useEditor.getState().setMarquee(
          isBoxDrag(start, at)
            ? { start, current: at, mode: boxModeFor(start[0], at[0]) }
            : null,
        )
        return
      }

      // Dynamic UCS: acquire (or release) the hovered face's plane BEFORE resolving, so the pick
      // lands on the plane the badge is showing. `applyHoverPlane` self-guards against the locked
      // and mid-command cases, and is a no-op when the answer has not changed.
      const st = useEditor.getState()
      if (st.tool !== 'select') st.applyHoverPlane(st.hoveredId)

      const r = resolve(e)
      if (!r || !dragging.current) return
      const d = dragging.current
      const delta: Vec2 = [r.point[0] - d.last[0], r.point[1] - d.last[1]]
      if (delta[0] === 0 && delta[1] === 0) return
      useEditor.getState().updateTransient((sc) => moveElement(sc, d.id, delta))
      dragging.current = { id: d.id, last: r.point }
    }
    el.addEventListener('pointermove', onMove)
    return () => el.removeEventListener('pointermove', onMove)
  }, [gl.domElement, resolve])

  // ---- pointer down / up — tool dispatch ----------------------------------

  useEffect(() => {
    const el = gl.domElement

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      // A parametric handle already owns this gesture — do not also start a whole-element move.
      if (isHandleDragging()) return
      const r = resolve(e)
      if (!r) return
      const s = useEditor.getState()

      // Select: drag an element to move it, or drag empty space to rubber-band.
      if (s.tool === 'select') {
        const id = s.hoveredId
        if (id) {
          s.select(id, e.shiftKey)
          dragging.current = { id, last: r.point }
          s.beginTransient()
          el.setPointerCapture(e.pointerId)
          return
        }
        const rect = el.getBoundingClientRect()
        const at: Vec2 = [e.clientX - rect.left, e.clientY - rect.top]
        marquee.current = { start: at, additive: e.shiftKey }
        el.setPointerCapture(e.pointerId)
        return
      }

      // Modify verbs (D3) act on the wall under the cursor. Trim and extend take two picks.
      if (isModifyTool(s.tool)) {
        const id = s.hoveredId
        if (!id) {
          s.flash('Click directly on a wall', 'error')
          return
        }
        if (isPairTool(s.tool) && !s.pendingRefId) {
          s.setPendingRef(id)
          s.flash(modifyHint(s.tool, true))
          return
        }
        const outcome = buildModify(s, id, r.point, s.pendingRefId)
        if ('error' in outcome) {
          s.flash(outcome.error, 'error')
          return
        }
        s.commit(outcome.label, () => outcome.scene)
        s.selectMany(outcome.selectAfter)
        // One verb per pair of picks: clear the boundary so the next trim starts clean.
        s.setPendingRef(null)
        return
      }

      // Hosted tools act on the wall under the cursor.
      if (isHostedTool(s.tool)) {
        const outcome = buildHostedCommit(s, r.point, r.worldPerPixel * WALL_HIT_PX)
        if ('error' in outcome) {
          s.flash(outcome.error, 'error')
          return
        }
        s.commit(outcome.result.label, outcome.result.produce)
        const id = outcome.result.selectAfter?.(useEditor.getState().scene)
        if (id) s.select(id)
        return
      }

      // Loop tools: clicking the first vertex closes the loop.
      if (isLoopTool(s.tool)) {
        if (shouldCloseLoop(s.points, r.point, r.worldPerPixel * SNAP_APERTURE_PX)) {
          commitActiveTool(s.points)
          return
        }
        s.addPoint(r.point)
        return
      }

      // Path tools (B3): an OPEN polyline. Every click just adds a point — there is no "closing"
      // click to detect, since a path is not a boundary. Enter (in App.tsx) commits it.
      if (isPathTool(s.tool)) {
        s.addPoint(r.point)
        return
      }

      // Measure reads a distance and creates nothing, so it must not reach the commit path —
      // that would flash a spurious "invalid element" error.
      if (s.tool === 'measure') {
        if (s.points.length >= 2) s.clearPoints()
        else s.addPoint(r.point)
        return
      }

      // Dimension (C2): each pick must land on a named element point — that is what makes the
      // dimension parametric. A pick that resolves to nothing (empty space, a grid snap) refuses
      // rather than silently anchoring to a coordinate that will not track anything.
      if (s.tool === 'dimension') {
        const ref = r.snap.sourceId ? refFromPoint(s.scene, r.snap.sourceId, r.point) : null
        const result = s.addDimPoint(r.point, ref)
        if (result === 'no-ref') {
          s.flash('Snap to a wall endpoint or vertex to place a dimension', 'error')
          return
        }
        const refs = useEditor.getState().pendingDimRefs
        if (refs.length >= 2) {
          const dim: Dimension = {
            id: newId('dim'),
            viewId: 'default',
            kind: 'aligned',
            ref1: refs[0],
            ref2: refs[1],
            textOverride: null,
            witnessGap: 0.15,
            offsetDistance: 0.3,
          }
          s.commit('Add dimension', (sc) => addDimension(sc, dim))
          s.clearPoints()
        }
        return
      }

      // Room tag (C3): hit-test the click against every room polygon on the active level.
      // Clicking an already-tagged room removes its tag — a toggle, not a pile-up of duplicates.
      if (s.tool === 'roomtag') {
        const room = s.scene.rooms.find(
          (rm) => rm.levelId === s.activeLevelId && pointInPolygon(r.point, rm.polygon),
        )
        if (!room) {
          s.flash('Click inside a room to tag it', 'error')
          return
        }
        const existing = s.scene.roomTags.find((t) => t.roomId === room.id)
        if (existing) {
          s.commit('Remove room tag', (sc) => removeRoomTag(sc, existing.id))
        } else {
          const tag = defaultRoomTag(newId('rtag'), 'default', room)
          s.commit('Add room tag', (sc) => addRoomTag(sc, tag))
        }
        return
      }

      // Text note (C3): one click places a placeholder note; edit its wording in the Properties
      // panel, the same pattern every other field in this app already uses.
      if (s.tool === 'text') {
        const ann: Annotation = {
          id: newId('ann'),
          viewId: 'default',
          kind: 'text',
          text: 'Text',
          position: r.point,
          leaderTarget: null,
          rotation: 0,
          textHeight: 0.2,
        }
        s.commit('Add text', (sc) => addAnnotation(sc, ann))
        s.select(ann.id)
        return
      }

      // Leader (C3): first click is the arrow target, second is where the note text sits.
      if (s.tool === 'leader') {
        if (s.points.length === 0) {
          s.addPoint(r.point)
          return
        }
        const target = s.points[0]
        const ann: Annotation = {
          id: newId('ann'),
          viewId: 'default',
          kind: 'leader',
          text: 'Note',
          position: r.point,
          leaderTarget: target,
          rotation: 0,
          textHeight: 0.2,
        }
        s.commit('Add leader', (sc) => addAnnotation(sc, ann))
        s.select(ann.id)
        s.clearPoints()
        return
      }

      // Column grid (B6): one click places a sane default (4 numbered × 3 lettered axes, 5m
      // bays); the user refines axis count/spacing/labels in the Properties panel afterward,
      // the same numeric-first pattern the rest of this app uses rather than a bespoke
      // in-canvas grid-editing gesture.
      if (s.tool === 'columngrid') {
        const grid = defaultColumnGrid(newId('grid'), s.activeLevelId, r.point)
        s.commit('Add column grid', (sc) => addColumnGrid(sc, grid))
        s.select(grid.id)
        return
      }

      // Point tools (wall, beam, column). An arc wall needs a third point.
      const next = [...s.points, r.point]
      if (next.length >= pointsNeeded(s.tool, s.wallMode)) commitActiveTool(next)
      else s.addPoint(r.point)
    }

    const onUp = (e: PointerEvent) => {
      const release = () => {
        try {
          el.releasePointerCapture(e.pointerId)
        } catch {
          /* capture may already be released */
        }
      }

      // Finish a rubber band: resolve it against the level's silhouettes and apply the selection.
      if (marquee.current) {
        const pending = marquee.current
        marquee.current = null
        const s = useEditor.getState()
        const box = s.marquee
        s.setMarquee(null)
        release()
        // Below the drag threshold this was a click on empty space; r3f's onPointerMissed already
        // cleared the selection, so there is nothing to do.
        if (!box) return
        const ids = selectInBox(
          silhouettes(s.scene, s.activeLevelId),
          normalizeBox(box.start, box.current),
          box.mode,
          projector(camera, el.getBoundingClientRect()),
        )
        s.selectMany(ids, pending.additive)
        s.flash(
          ids.length === 0
            ? `${box.mode === 'window' ? 'Window' : 'Crossing'} select: nothing in range`
            : `Selected ${ids.length} element${ids.length === 1 ? '' : 's'}`,
        )
        return
      }

      if (!dragging.current) return
      useEditor.getState().endTransient('Move element')
      dragging.current = null
      release()
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
    }
  }, [camera, gl.domElement, resolve])

  return null
}
