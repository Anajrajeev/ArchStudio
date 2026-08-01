/**
 * Renders the direct parametric handles for the current selection and turns drags on them into
 * scene mutations. All the arithmetic lives in `editor/handles.ts`; this file is the r3f shell.
 *
 * One drag == one undo entry, via the store's transient mechanism — dragging a wall endpoint
 * across the viewport must not leave sixty history steps behind (CLAUDE.md core rule 3).
 *
 * Handles are only shown with the select tool active. During a draw they would sit under the
 * cursor and steal the clicks that are meant to place points.
 */
import { useMemo, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { useEditor } from '../scene/store'
import {
  handlesFor,
  applyHandleDrag,
  applyHandleHeightDrag,
  type Handle,
  type HandleKind,
  type HandleSpace,
} from '../editor/handles'
import { beginHandleDrag, endHandleDrag } from '../editor/dragLock'
import { resolvePointer, type PointerContext } from '../editor/pointer'
import { intersectPlane, type WorkPlane } from '../../../shared/geometry/workplane'
import type { Vec3 } from '../../../shared/types/scene'
import { ndcFromClient, rayFromNDC } from './pick'
import { useCanvasTheme } from './theme'

/** World radius of a handle. Small enough not to hide the geometry, big enough to grab. */
const HANDLE_R = 0.075
/** Lift grips clear of the surface they sit on so they never z-fight with it. */
const LIFT = 0.006

/**
 * Glyph per handle kind — the shape says what the drag will do, which is the difference between a
 * handle layer that teaches itself and a row of identical dots:
 *  - cube = moves a point (endpoint, slab vertex), the long-standing CAD grip convention
 *  - sphere = bows a curve
 *  - flat plate = pushes a face sideways (thickness)
 *  - cone = push/pull along the vertical
 */
function HandleGeometry({ kind, space }: { kind: HandleKind; space: HandleSpace }) {
  if (space === 'vertical') return <coneGeometry args={[HANDLE_R * 1.3, HANDLE_R * 2.6, 16]} />
  if (kind === 'wall-bulge') return <sphereGeometry args={[HANDLE_R, 14, 14]} />
  if (kind === 'wall-thickness') {
    return <boxGeometry args={[HANDLE_R * 2.4, HANDLE_R * 0.5, HANDLE_R * 2.4]} />
  }
  return <boxGeometry args={[HANDLE_R * 1.8, HANDLE_R * 1.8, HANDLE_R * 1.8]} />
}

/**
 * Colour follows the same type system as the rubber band: a type-editing handle is magenta, the
 * colour already meaning "this relates to other geometry", because dragging it changes every
 * instance of the type — that has to look different from an instance-only edit.
 */
function handleColor(h: Handle, theme: { selectActive: string; inference: string }): string {
  return h.editsType || h.kind === 'wall-bulge' ? theme.inference : theme.selectActive
}

export default function Handles() {
  const { camera, gl } = useThree()
  const scene = useEditor((s) => s.scene)
  const selectedIds = useEditor((s) => s.selectedIds)
  const tool = useEditor((s) => s.tool)
  const theme = useCanvasTheme()

  /** The handle currently being dragged, plus whether it has actually moved anything yet. */
  const drag = useRef<{ handle: Handle; moved: boolean } | null>(null)

  const handles = useMemo(
    () => (tool === 'select' ? handlesFor(scene, selectedIds) : []),
    [scene, selectedIds, tool],
  )

  /**
   * Resolve a pointer event to a snapped scene point. Handles go through the same
   * `resolvePointer` as drawing does, so dragging an endpoint snaps to other geometry exactly the
   * way placing one does — that consistency is most of why direct editing feels precise.
   */
  const resolveAt = (e: PointerEvent | ThreeEvent<PointerEvent>) => {
    const native = 'nativeEvent' in e ? e.nativeEvent : e
    const s = useEditor.getState()
    const ctx: PointerContext = {
      scene: s.scene,
      activeLevelId: s.activeLevelId,
      workPlane: s.workPlane,
      // No collected points: a handle drag has no "from" point, so no axis/length constraint
      // applies and snapping runs unconditionally.
      points: [],
      axisLock: 'none',
      numeric: { lockedLength: null, lockedAngle: null },
      snapToggles: s.snapToggles,
      gridSize: s.gridSize,
      showGrid: s.showGrid,
      previousSnap: s.snap,
    }
    const rect = gl.domElement.getBoundingClientRect()
    const r = resolvePointer(camera, native.clientX, native.clientY, rect, ctx)
    if (r) s.setSnap(r.snap, r.world)
    return r
  }

  /**
   * Elevation under the cursor for a push/pull drag. Intersects the ray with a VERTICAL plane that
   * contains the handle and faces the camera, then reads world Y. This cannot go through
   * `resolvePointer` — that refuses non-horizontal planes on purpose, because they have no scene-2D
   * mapping (D-007). Here only the elevation is wanted, so there is nothing to refuse.
   */
  const resolveElevation = (e: PointerEvent, handle: Handle): number | null => {
    const rect = gl.domElement.getBoundingClientRect()
    const ray = rayFromNDC(camera, ndcFromClient(e.clientX, e.clientY, rect))

    // Face the plane at the camera, but keep it vertical: drop the camera's Y component so the
    // plane's normal stays horizontal and the plane itself stays parallel to world up.
    const toCam: Vec3 = [
      camera.position.x - handle.position[0],
      0,
      camera.position.z - handle.position[1],
    ]
    const len = Math.hypot(toCam[0], toCam[2])
    // A perfectly top-down camera (plan view) gives no vertical plane to drag against; refusing is
    // right — you cannot see height in plan, so you cannot meaningfully drag it there.
    if (len < 1e-6) return null

    const plane: WorkPlane = {
      origin: [handle.position[0], handle.elevation, handle.position[1]],
      normal: [toCam[0] / len, 0, toCam[2] / len],
      xAxis: [-toCam[2] / len, 0, toCam[0] / len],
      source: { kind: 'custom', description: 'push/pull' },
    }
    const hit = intersectPlane(ray, plane)
    return hit ? hit[1] : null
  }

  const onDown = (handle: Handle) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    beginHandleDrag()
    drag.current = { handle, moved: false }
    useEditor.getState().beginTransient()
    gl.domElement.setPointerCapture(e.nativeEvent.pointerId)

    const onMove = (ev: PointerEvent) => {
      if (!drag.current) return
      const d = drag.current

      if (d.handle.space === 'vertical') {
        const y = resolveElevation(ev, d.handle)
        if (y === null) return
        useEditor.getState().updateTransient((sc) => applyHandleHeightDrag(sc, d.handle, y))
        d.moved = true
        return
      }

      const r = resolveAt(ev)
      if (!r) return
      useEditor.getState().updateTransient((sc) => applyHandleDrag(sc, d.handle, r.point))
      d.moved = true
    }

    const onUp = (ev: PointerEvent) => {
      gl.domElement.removeEventListener('pointermove', onMove)
      gl.domElement.removeEventListener('pointerup', onUp)
      try {
        gl.domElement.releasePointerCapture(ev.pointerId)
      } catch {
        /* capture may already be released */
      }
      const d = drag.current
      drag.current = null
      endHandleDrag()
      if (!d) return
      // A click with no movement must not create an empty undo entry.
      if (d.moved) useEditor.getState().endTransient(d.handle.label)
      else useEditor.getState().cancelTransient()
    }

    gl.domElement.addEventListener('pointermove', onMove)
    gl.domElement.addEventListener('pointerup', onUp)
  }

  if (handles.length === 0) return null

  return (
    <group>
      {handles.map((h) => (
        <mesh
          key={h.id}
          position={[h.position[0], h.elevation + LIFT, h.position[1]]}
          onPointerDown={onDown(h)}
          // Hovering a handle must not read as hovering the element underneath it.
          onPointerOver={(e) => e.stopPropagation()}
        >
          <HandleGeometry kind={h.kind} space={h.space} />
          <meshBasicMaterial color={handleColor(h, theme)} depthTest={false} />
        </mesh>
      ))}
    </group>
  )
}
