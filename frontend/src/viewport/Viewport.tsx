/**
 * The single 3D-native workspace. There is ONE scene; "plan" is a locked top-down orthographic
 * camera plus a horizontal cut plane in that same scene. This removes an entire class of
 * 2D/3D divergence bugs and satisfies the scene-graph rule more fully than a split editor.
 * See DECISIONS.md D-008.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useThree, useFrame, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewcube } from '@react-three/drei'
import * as THREE from 'three'
import { findLevel } from '../../../shared/types/scene'
import { useEditor } from '../scene/store'
import { useCanvasTheme, type CanvasTheme } from './theme'
import { probeWebGL, type Capability } from './capability'
import Interaction from './Interaction'
import { useSyncWorkPlaneToLevel } from '../editor/useSyncWorkPlane'
import Overlays from './Overlays'
import Handles from './Handles'
import {
  Walls,
  Fillings,
  Slabs,
  Ceilings,
  Rooms,
  Columns,
  Beams,
  Furniture,
  type RenderOpts,
} from './Elements'
import { Roofs } from './Roofs'
import { Primitives } from './Primitives'
import { Stairs } from './Stairs'
import { Railings } from './Railings'
import Dimensions from './Dimensions'
import Annotations from './Annotations'
import ColumnGrids from './ColumnGrids'
import { generateStressScene } from '../scene/stressScene'

export default function Viewport() {
  const theme = useCanvasTheme()
  const viewMode = useEditor((s) => s.viewMode)
  const flash = useEditor((s) => s.flash)
  const background = viewMode === 'plan' ? theme.canvasPlan : theme.canvas3d

  // Probe once. An unsupported context must explain itself rather than render a blank void.
  const capability = useMemo(() => probeWebGL(), [])

  useEffect(() => {
    if (capability.level === 'degraded') flash(capability.message, 'error')
  }, [capability, flash])

  if (capability.level === 'unsupported') {
    return <CapabilityNotice capability={capability} background={background} />
  }

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <Canvas
        // Local clipping drives the per-level cut view.
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true
        }}
        shadows
        dpr={[1, 2]}
        style={{ background, display: 'block', touchAction: 'none' }}
        // r3f's own pointer-missed fires when nothing was hit — clears the selection.
        onPointerMissed={(e) => {
          const s = useEditor.getState()
          if (s.tool === 'select' && e.button === 0) s.select(null)
        }}
      >
        <CameraRig />
        <Lighting />
        <SceneContent theme={theme} />
        <Overlays />
        <ColumnGrids />
        <Dimensions />
        <Annotations />
        {/* Before <Interaction/>, so a handle drag wins over a whole-element move. */}
        <Handles />
        <Interaction />
        <NavControls />
        <DebugBridge />
      </Canvas>
    </div>
  )
}

/** Shown instead of the canvas when WebGL is unavailable entirely. */
function CapabilityNotice({
  capability,
  background,
}: {
  capability: Capability
  background: string
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--sp-12)',
        padding: 'var(--sp-24)',
        textAlign: 'center',
        background,
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 'var(--fs-heading)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--status-error)',
        }}
      >
        The 3D viewport can&rsquo;t start
      </p>
      <p style={{ margin: 0, maxWidth: 460, fontSize: 'var(--fs-body)', color: 'var(--text-dim)' }}>
        {capability.message}
      </p>
      <p
        style={{ margin: 0, maxWidth: 460, fontSize: 'var(--fs-body)', color: 'var(--text-default)' }}
      >
        {capability.remedy}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

/**
 * Swaps between an orthographic and a perspective camera without losing the framing.
 * Plan mode forces ortho and looks straight down — the standard architectural convention.
 */
function CameraRig() {
  const { set, size } = useThree()
  const projection = useEditor((s) => s.projection)
  const viewMode = useEditor((s) => s.viewMode)

  const perspective = useMemo(() => new THREE.PerspectiveCamera(50, 1, 0.05, 2000), [])
  const ortho = useMemo(() => new THREE.OrthographicCamera(-10, 10, 10, -10, -500, 2000), [])

  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height)
    perspective.aspect = aspect
    perspective.updateProjectionMatrix()

    const halfH = 12
    ortho.left = -halfH * aspect
    ortho.right = halfH * aspect
    ortho.top = halfH
    ortho.bottom = -halfH
    ortho.updateProjectionMatrix()
  }, [size, perspective, ortho])

  useEffect(() => {
    const useOrtho = projection === 'ortho' || viewMode === 'plan'
    const cam = useOrtho ? ortho : perspective

    if (viewMode === 'plan') {
      cam.position.set(6, 60, 6)
      cam.up.set(0, 0, -1) // north-up in plan
      cam.lookAt(6, 0, 6)
    } else if (cam.position.lengthSq() < 1) {
      cam.position.set(14, 12, 16)
      cam.up.set(0, 1, 0)
      cam.lookAt(3, 1, 3)
    } else {
      cam.up.set(0, 1, 0)
    }
    cam.updateProjectionMatrix()
    set({ camera: cam })
  }, [projection, viewMode, ortho, perspective, set])

  return null
}

function NavControls() {
  const viewMode = useEditor((s) => s.viewMode)
  const tool = useEditor((s) => s.tool)
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null)

  return (
    <>
      <OrbitControls
        ref={controls}
        makeDefault
        target={[6, 1, 6]}
        // Plan mode never orbits (a rolled building reads as a bug), and while a drawing tool is
        // active left-drag belongs to the tool, not the camera.
        enableRotate={viewMode === '3d' && tool === 'select'}
        // Keep the scene upright — no roll past the horizon.
        maxPolarAngle={Math.PI / 2.02}
        minPolarAngle={0}
        // Standard CAD bindings: middle- and right-drag pan, wheel zooms toward the cursor.
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.PAN,
        }}
        zoomToCursor
        dampingFactor={0.15}
      />
      {/* 80px orientation cube, top-right at a 10px offset — Blender's exact geometry. */}
      <GizmoHelper alignment="top-right" margin={[70, 70]}>
        <GizmoViewcube
          color="#3a3a3a"
          strokeColor="#8a8a8a"
          textColor="#e6e6e6"
          hoverColor="#38abdf"
          opacity={0.85}
        />
      </GizmoHelper>
    </>
  )
}

function Lighting() {
  const viewMode = useEditor((s) => s.viewMode)
  // Plan view wants flat, shadowless lighting so linework reads cleanly.
  if (viewMode === 'plan') {
    return (
      <>
        <ambientLight intensity={1.25} />
        <directionalLight position={[0, 50, 0]} intensity={0.35} />
      </>
    )
  }
  return (
    <>
      <hemisphereLight args={[0xffffff, 0x3a3a3a, 0.9]} />
      <directionalLight
        position={[18, 30, 14]}
        intensity={1.15}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-bias={-0.0005}
      />
      <ambientLight intensity={0.35} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Scene content — per-level visibility, clipping and ghosting
// ---------------------------------------------------------------------------

function SceneContent({ theme }: { theme: CanvasTheme }) {
  useSyncWorkPlaneToLevel()

  const scene = useEditor((s) => s.scene)
  const activeLevelId = useEditor((s) => s.activeLevelId)
  const selectedIds = useEditor((s) => s.selectedIds)
  const hoveredId = useEditor((s) => s.hoveredId)
  const cutViewEnabled = useEditor((s) => s.cutViewEnabled)
  const ghostBelowEnabled = useEditor((s) => s.ghostBelowEnabled)
  const isolateLevel = useEditor((s) => s.isolateLevel)
  const viewMode = useEditor((s) => s.viewMode)
  const select = useEditor((s) => s.select)
  const setHovered = useEditor((s) => s.setHovered)
  const tool = useEditor((s) => s.tool)

  const active = findLevel(scene, activeLevelId)

  /**
   * Cut plane: hide everything above the cut height. In plan mode the cut sits at the
   * conventional ~1.2 m so doors and windows read as openings in the walls.
   */
  const clippingPlanes = useMemo(() => {
    if (!cutViewEnabled || !active) return undefined
    const cutHeight = viewMode === 'plan' ? active.elevation + 1.2 : active.elevation + active.height
    return [new THREE.Plane(new THREE.Vector3(0, -1, 0), cutHeight)]
  }, [cutViewEnabled, active, viewMode])

  const onPick = (id: string, e: ThreeEvent<MouseEvent>) => {
    // Only the select tool consumes picks; drawing tools must let the click through to the plane.
    if (tool !== 'select') return
    e.stopPropagation()
    select(id, e.nativeEvent.shiftKey)
  }

  const levels = useMemo(
    () => [...scene.levels].sort((a, b) => a.elevation - b.elevation),
    [scene.levels],
  )

  return (
    <group>
      {levels.map((level) => {
        const isActive = level.id === activeLevelId
        const isBelow = active ? level.elevation < active.elevation : false
        const isAbove = active ? level.elevation > active.elevation : false

        if (isolateLevel && !isActive) return null
        if (cutViewEnabled && isAbove) return null
        if (isBelow && !ghostBelowEnabled) return null

        const ghost = !isActive
        const opts: RenderOpts = {
          scene,
          theme,
          selectedIds,
          hoveredId,
          ghost,
          onPick,
          onHover: setHovered,
        }

        return (
          <ClippedGroup key={level.id} planes={isActive ? clippingPlanes : undefined}>
            <Slabs opts={opts} levelId={level.id} />
            <Ceilings opts={opts} levelId={level.id} />
            <Rooms opts={opts} levelId={level.id} />
            <Walls opts={opts} levelId={level.id} />
            <Fillings opts={opts} levelId={level.id} />
            <Columns opts={opts} levelId={level.id} />
            <Beams opts={opts} levelId={level.id} />
            <Furniture opts={opts} levelId={level.id} />
            <Roofs opts={opts} levelId={level.id} />
            <Primitives opts={opts} levelId={level.id} />
            <Stairs opts={opts} levelId={level.id} />
            <Railings opts={opts} levelId={level.id} />
          </ClippedGroup>
        )
      })}
    </group>
  )
}

/**
 * Dev-only bridge exposing the r3f state on `window.__archstudio` so the render pipeline can be
 * inspected objectively (draw calls, camera, scene contents) instead of guessed at from a
 * screenshot. Stripped from production builds.
 *
 * Also the harness for E1 (the 60 fps performance target): `loadStressScene()` loads the
 * generated 3-storey / 90-wall / 42-furniture scene from `scene/stressScene.ts` — there is no
 * save/load yet (Phase 2), so a dev console call is the only way to get it into a running editor
 * — and `sampleFrameTimes(seconds)` measures real per-frame deltas via `useFrame`, which fires on
 * every rendered frame regardless of whether the camera is moving (the Canvas here uses r3f's
 * default `frameloop="always"`, not `"demand"`), so an idle stress scene still gets measured
 * rather than silently reporting nothing.
 */
function DebugBridge() {
  const state = useThree()
  const frameDeltas = useRef<number[]>([])
  const sampling = useRef(false)
  const lastFrameAt = useRef(0)

  useFrame(() => {
    if (!sampling.current) return
    const now = performance.now()
    if (lastFrameAt.current > 0) frameDeltas.current.push(now - lastFrameAt.current)
    lastFrameAt.current = now
  })

  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as { __archstudio?: unknown }).__archstudio = {
      get camera() {
        return state.camera
      },
      get scene() {
        return state.scene
      },
      get gl() {
        return state.gl
      },
      get size() {
        return state.size
      },
      loadStressScene: () => {
        useEditor.getState().loadScene(generateStressScene())
      },
      sampleFrameTimes: (seconds = 5) =>
        new Promise((resolve) => {
          frameDeltas.current = []
          lastFrameAt.current = 0
          sampling.current = true
          setTimeout(() => {
            sampling.current = false
            const deltas = frameDeltas.current
            const frames = deltas.length
            if (frames === 0) {
              resolve({ frames: 0, avgFps: 0, minFps: 0, p95Ms: 0, avgMs: 0 })
              return
            }
            const avgMs = deltas.reduce((a, b) => a + b, 0) / frames
            const sorted = [...deltas].sort((a, b) => a - b)
            const p95Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
            const maxMs = Math.max(...deltas)
            resolve({
              frames,
              avgMs,
              avgFps: 1000 / avgMs,
              p95Ms,
              minFps: 1000 / maxMs,
            })
          }, seconds * 1000)
        }),
    }
  }, [state])
  return null
}

/** Applies clipping planes to every material beneath it. */
function ClippedGroup({
  planes,
  children,
}: {
  planes: THREE.Plane[] | undefined
  children: React.ReactNode
}) {
  const ref = useRef<THREE.Group>(null)

  useEffect(() => {
    const group = ref.current
    if (!group) return
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of materials) {
        if (!m) continue
        m.clippingPlanes = planes ?? null
        m.clipShadows = true
        m.needsUpdate = true
      }
    })
  })

  return <group ref={ref}>{children}</group>
}
