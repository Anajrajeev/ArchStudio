/**
 * The single 3D-native workspace. There is ONE scene; "plan" is a locked top-down orthographic
 * camera plus a horizontal cut plane in that same scene. This removes an entire class of
 * 2D/3D divergence bugs and satisfies the scene-graph rule more fully than a split editor.
 * See DECISIONS.md D-008.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useThree, useFrame, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, GizmoHelper, GizmoViewcube, Line } from '@react-three/drei'
import * as THREE from 'three'
import {
  ELEMENT_COLLECTIONS,
  defaultViewRange,
  findLevel,
  findPlanView,
  type Level,
  type PlanRegion,
} from '../../../shared/types/scene'
import {
  clipBandFor,
  partitionByRegion,
  type ClipBand,
} from '../../../shared/geometry/viewRange'
import { expandSelection, resolveSelection } from '../editor/groups'
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
  CurtainWalls,
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
  const enteredGroupId = useEditor((s) => s.enteredGroupId)

  const active = findLevel(scene, activeLevelId)
  // C7: the active plan view. Created with the level, so this is a lookup rather than a mutation.
  const activeView = useMemo(() => findPlanView(scene, activeLevelId), [scene, activeLevelId])
  const regions = useMemo(
    () => (activeView ? scene.planRegions.filter((r) => r.viewId === activeView.id) : []),
    [scene.planRegions, activeView],
  )

  /**
   * The clip band for the active level, from the view's own range (C7) rather than a constant.
   * In 3D the cut is still just "everything above this storey", which is what the cut-view toggle
   * has always meant there; only PLAN reads the range, because a range is a drawing concept.
   */
  const activeBand = useMemo(() => {
    if (!cutViewEnabled || !active) return null
    if (viewMode !== 'plan') {
      return { top: active.elevation + active.height, bottom: -Infinity, beyond: -Infinity }
    }
    const range = activeView?.viewRange ?? defaultViewRange(active.height)
    return clipBandFor(active.elevation, range)
  }, [cutViewEnabled, active, viewMode, activeView])

  /**
   * D5: selecting a group must light up every member, so the renderers — which know nothing about
   * groups — are handed the expanded leaf set.
   */
  const highlightIds = useMemo(
    () => expandSelection(scene, selectedIds),
    [scene, selectedIds],
  )

  const onPick = (id: string, e: ThreeEvent<MouseEvent>) => {
    // Only the select tool consumes picks; drawing tools must let the click through to the plane.
    if (tool !== 'select') return
    e.stopPropagation()
    // D5: a click on a member selects the group it belongs to, unless the user has entered it.
    select(resolveSelection(scene, id, enteredGroupId), e.nativeEvent.shiftKey)
  }

  const levels = useMemo(
    () => [...scene.levels].sort((a, b) => a.elevation - b.elevation),
    [scene.levels],
  )

  // C8: the one other level drawn halftone under this plan, clipped by ITS OWN range.
  const underlayLevelId = viewMode === 'plan' ? (activeView?.underlayLevelId ?? null) : null

  return (
    <group>
      {levels.map((level) => {
        const isActive = level.id === activeLevelId
        const isBelow = active ? level.elevation < active.elevation : false
        const isAbove = active ? level.elevation > active.elevation : false
        const isUnderlay = !isActive && level.id === underlayLevelId

        // The underlay is shown on purpose, so it overrides every visibility rule that would
        // otherwise hide it — including "isolate level" and "hide everything above the cut".
        if (!isUnderlay) {
          if (isolateLevel && !isActive) return null
          if (cutViewEnabled && isAbove) return null
          if (isBelow && !ghostBelowEnabled) return null
        }

        const opts: RenderOpts = {
          scene,
          theme,
          selectedIds: highlightIds,
          hoveredId,
          ghost: !isActive,
          underlay: isUnderlay,
          onPick,
          onHover: setHovered,
        }

        // An underlay is cut at the height ITS own plan view says, not the active one's — seeing
        // the floor below at its own door height is the entire point of the feature (C8).
        const underlayBand = isUnderlay
          ? clipBandFor(
              level.elevation,
              findPlanView(scene, level.id)?.viewRange ?? defaultViewRange(level.height),
            )
          : null

        const content = (
          <>
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
            <CurtainWalls opts={opts} levelId={level.id} />
          </>
        )

        if (isUnderlay) {
          return (
            <ClippedGroup key={level.id} planes={bandToPlanes(underlayBand)}>
              {content}
            </ClippedGroup>
          )
        }

        // `!activeBand` means the cut is switched off entirely. A region redefines the cut for
        // its area, so with no cut there is nothing for it to redefine — partitioning here would
        // leave region contents clipped while everything around them was not, which is exactly
        // what the cut toggle is supposed to prevent.
        if (!isActive || regions.length === 0 || !activeBand) {
          return (
            <ClippedGroup key={level.id} planes={isActive ? bandToPlanes(activeBand) : undefined}>
              {content}
            </ClippedGroup>
          )
        }

        // C7 plan regions: the active level's elements are PARTITIONED by which region governs
        // them and each partition is clipped separately. No geometry is duplicated, and an
        // arbitrary polygon works — unlike clipping the base render to a region's complement,
        // which three.js's half-space planes cannot express.
        return (
          <RegionedLevel
            key={level.id}
            level={level}
            opts={opts}
            regions={regions}
            fallback={activeBand}
          />
        )
      })}
      {regions.length > 0 && viewMode === 'plan' && <PlanRegionOutlines regions={regions} />}
    </group>
  )
}

/** Turn a resolved band into the clip planes three.js wants, or undefined for "no clipping". */
function bandToPlanes(band: ClipBand | null): THREE.Plane[] | undefined {
  if (!band) return undefined
  const planes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), band.top)]
  // A finite bottom adds an upward-facing plane. `beyond` extends how far down is still drawn.
  if (Number.isFinite(band.beyond)) {
    planes.push(new THREE.Plane(new THREE.Vector3(0, 1, 0), -band.beyond))
  }
  return planes
}

/**
 * The active level rendered once per plan region plus once for everything outside them (C7).
 *
 * Each partition gets its own `ClippedGroup`, so an element is drawn exactly once, at exactly one
 * cut height — the height of whichever region contains its plan anchor. See D-029 for why an
 * element is never split at a region boundary.
 */
function RegionedLevel({
  level,
  opts,
  regions,
  fallback,
}: {
  level: Level
  opts: RenderOpts
  regions: PlanRegion[]
  fallback: ClipBand | null
}) {
  const { scene } = opts
  const partitions = useMemo(() => {
    const ids = ELEMENT_COLLECTIONS.flatMap((key) => {
      const items = scene[key] as ReadonlyArray<{ id: string; levelId?: string }>
      return items.filter((i) => i.levelId === level.id).map((i) => i.id)
    })
    return [...partitionByRegion(scene, ids, regions).entries()]
  }, [scene, level.id, regions])

  return (
    <>
      {partitions.map(([region, ids]) => (
        <ClippedGroup
          key={region?.id ?? 'default'}
          planes={bandToPlanes(region ? clipBandFor(level.elevation, region.viewRange) : fallback)}
        >
          <PartitionContent opts={opts} levelId={level.id} ids={new Set(ids)} />
        </ClippedGroup>
      ))}
    </>
  )
}

/** The element renderers, restricted to one partition's ids. */
function PartitionContent({
  opts,
  levelId,
  ids,
}: {
  opts: RenderOpts
  levelId: string
  ids: Set<string>
}) {
  const scoped = useMemo<RenderOpts>(() => ({ ...opts, only: ids }), [opts, ids])
  return (
    <>
      <Slabs opts={scoped} levelId={levelId} />
      <Ceilings opts={scoped} levelId={levelId} />
      <Rooms opts={scoped} levelId={levelId} />
      <Walls opts={scoped} levelId={levelId} />
      <Fillings opts={scoped} levelId={levelId} />
      <Columns opts={scoped} levelId={levelId} />
      <Beams opts={scoped} levelId={levelId} />
      <Furniture opts={scoped} levelId={levelId} />
      <Roofs opts={scoped} levelId={levelId} />
      <Primitives opts={scoped} levelId={levelId} />
      <Stairs opts={scoped} levelId={levelId} />
      <Railings opts={scoped} levelId={levelId} />
      <CurtainWalls opts={scoped} levelId={levelId} />
    </>
  )
}

/**
 * A dashed outline around each plan region, drawn at the region's own cut height.
 *
 * Not decoration: D-029's rule is that an element belongs wholly to one region by its anchor
 * point, and that rule is only defensible if the user can SEE where the boundary runs.
 */
function PlanRegionOutlines({ regions }: { regions: PlanRegion[] }) {
  const scene = useEditor((s) => s.scene)
  const theme = useCanvasTheme()
  return (
    <>
      {regions.map((region) => {
        const view = scene.views.find((v) => v.id === region.viewId)
        const level = view?.levelId ? findLevel(scene, view.levelId) : undefined
        const y = (level?.elevation ?? 0) + region.viewRange.cutHeight
        const points = [...region.boundary, region.boundary[0]].map(
          ([x, z]) => new THREE.Vector3(x, y, z),
        )
        return (
          <Line
            key={region.id}
            points={points}
            color={theme.gridMajor}
            lineWidth={1}
            dashed
            dashSize={0.25}
            gapSize={0.15}
          />
        )
      })}
    </>
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
