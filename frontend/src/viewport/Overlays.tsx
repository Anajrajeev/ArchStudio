/**
 * Viewport overlays: work-plane grid, snap marker, rubber band, live dimensions.
 *
 * Three ideas from the research carry most of the "real CAD" feeling here:
 *  - a DISTINCT GLYPH per snap type (square = endpoint, triangle = midpoint, ×  = intersection…)
 *    plus a label naming the snap. One dot for everything is what makes snapping feel untrustworthy.
 *  - COLOUR AS A TYPE SYSTEM on the rubber band: red/green = axis-aligned, magenta = aligned to
 *    other geometry, neutral = unconstrained.
 *  - A LIVE DIMENSION that shows the number before you commit it.
 *
 * Text labels are DOM, not WebGL. drei's `<Text>` renders via troika-three-text, which requires
 * the `ANGLE_instanced_arrays` WebGL extension; browsers that block it for fingerprinting
 * protection (Brave, hardened Firefox) make troika throw an uncaught promise rejection that takes
 * the entire viewport down. These are HUD labels anyway — DOM is crisper, themeable from the token
 * layer, and has no GL capability requirements.
 */
import { useMemo } from 'react'
import { Line, Grid, Html } from '@react-three/drei'
import * as THREE from 'three'
import {
  arcInfo,
  baselineLength,
  baselinePolyline,
  bulgeThroughPoint,
  distance,
  polygonArea,
} from '../../../shared/geometry/index'
import type { Baseline } from '../../../shared/types/scene'
import { planeElevation } from '../../../shared/geometry/workplane'
import { constraintColor, angleTo, type SnapType } from '../../../shared/geometry/snapping'
import { useEditor, formatLength } from '../scene/store'
import { isLoopTool } from '../editor/tools'
import { useCanvasTheme, blendOver, type CanvasTheme } from './theme'

/** Screen-constant size for overlay glyphs, in world units at the given elevation. */
function useOverlayScale(): number {
  // A fixed world size reads well across the working zoom range and avoids a per-frame
  // camera read; snap markers are small enough that minor scale drift is imperceptible.
  return 0.06
}

export default function Overlays() {
  const theme = useCanvasTheme()
  const snap = useEditor((s) => s.snap)
  const points = useEditor((s) => s.points)
  const tool = useEditor((s) => s.tool)
  const workPlane = useEditor((s) => s.workPlane)
  const axisLock = useEditor((s) => s.axisLock)
  const wallMode = useEditor((s) => s.wallMode)
  const units = useEditor((s) => s.scene.units)
  const numeric = useEditor((s) => s.numeric)
  const y = planeElevation(workPlane) + 0.004

  const cursor = snap?.point ?? null

  return (
    <group>
      <WorkPlaneGrid theme={theme} />

      {/* In-progress geometry */}
      {points.length > 0 && cursor && (
        <RubberBand
          points={points}
          cursor={cursor}
          y={y}
          theme={theme}
          closed={isLoopTool(tool)}
          axisLock={axisLock}
          snapType={snap?.type ?? null}
          snapped={snap?.snapped ?? false}
          units={units}
          lockedLength={numeric.lockedLength}
          // The third click of an arc wall bows the run through the cursor, so the preview must
          // show the curve rather than a polyline that lies about what will be built.
          arcThrough={tool === 'wall' && wallMode === 'arc' && points.length === 2}
        />
      )}

      {/* Snap marker + label */}
      {snap?.snapped && snap.type && (
        <SnapMarker point={snap.point} y={y} type={snap.type} label={snap.label} theme={theme} />
      )}
    </group>
  )
}

// ---------------------------------------------------------------------------
// Work-plane grid
// ---------------------------------------------------------------------------

/**
 * The construction grid on the active work plane.
 *
 * Two things here were initially wrong and are worth keeping straight:
 *  - The VISUAL grid must not be tied to the SNAP increment. A 250 mm snap does not mean 250 mm
 *    lines: at a normal working zoom that is denser than one line per pixel, so it anti-aliases
 *    into flat nothing. Construction grids are 1 m minor / 5 m major regardless of snap.
 *  - It needs a distance FADE. A `gridHelper` cannot fade and turns into moiré at the horizon;
 *    drei's `<Grid>` is a shader grid that fades properly and stays crisp.
 */
function WorkPlaneGrid({ theme }: { theme: CanvasTheme }) {
  const showGrid = useEditor((s) => s.showGrid)
  const workPlane = useEditor((s) => s.workPlane)
  const viewMode = useEditor((s) => s.viewMode)

  // drei's <Grid> is a shader with no per-line opacity uniform, so translucent tokens must be
  // composited over the ground colour here — passing the bare colour would discard the alpha
  // and render a deliberately faint grid as full white.
  const minor = blendOver(
    viewMode === 'plan' ? theme.gridMinorPlan : theme.gridMinor,
    theme.ground,
  )
  const major = blendOver(
    viewMode === 'plan' ? theme.gridMajorPlan : theme.gridMajor,
    theme.ground,
  )
  const y = planeElevation(workPlane)

  if (!showGrid) return null

  return (
    <group position={[0, y, 0]}>
      {/* A very slightly lighter ground plane so the viewport reads as a floor, not a void,
          and so the grid has something to sit on. Sits a hair below the work plane to avoid
          z-fighting with slabs drawn at the level elevation. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.004, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color={theme.ground} roughness={1} metalness={0} />
      </mesh>

      <Grid
        // Metres, independent of the snap increment.
        cellSize={1}
        cellThickness={0.6}
        cellColor={minor}
        sectionSize={5}
        sectionThickness={1.1}
        sectionColor={major}
        infiniteGrid
        followCamera={false}
        fadeDistance={90}
        fadeStrength={1.4}
        side={THREE.DoubleSide}
      />

      {/* Axis lines through the origin. Blended toward the grid colour so they read as tinted
          grid lines rather than lasers — Blender uses a 0.46 blend factor for exactly this. */}
      <Line
        points={[
          [-60, 0.002, 0],
          [60, 0.002, 0],
        ]}
        color={theme.axisX}
        lineWidth={1.4}
        transparent
        opacity={0.5}
        depthWrite={false}
      />
      <Line
        points={[
          [0, 0.002, -60],
          [0, 0.002, 60],
        ]}
        color={theme.axisY}
        lineWidth={1.4}
        transparent
        opacity={0.5}
        depthWrite={false}
      />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Rubber band + live dimension
// ---------------------------------------------------------------------------

function RubberBand({
  points,
  cursor,
  y,
  theme,
  closed,
  axisLock,
  snapType,
  snapped,
  units,
  lockedLength,
  arcThrough = false,
}: {
  points: [number, number][]
  cursor: [number, number]
  y: number
  theme: CanvasTheme
  closed: boolean
  axisLock: 'none' | 'x' | 'y'
  snapType: SnapType | null
  snapped: boolean
  units: 'm' | 'ft' | 'cm' | 'mm'
  lockedLength: number | null
  /** Treat the two collected points as a chord and bow the run through the cursor (A1). */
  arcThrough?: boolean
}) {
  const color = useMemo(() => {
    const c = constraintColor({ point: cursor, type: snapType, label: null, snapped }, axisLock)
    switch (c) {
      case 'axis-x':
        return theme.axisX
      case 'axis-y':
        return theme.axisY
      case 'geometry':
        return theme.inference
      default:
        return theme.select
    }
  }, [cursor, snapType, snapped, axisLock, theme])

  /**
   * The arc being previewed, when the tool is bowing a chord. Null in every other case, including
   * a cursor that lands back on the chord — that commits a straight wall, so the preview shows one.
   */
  const arc = useMemo(() => {
    if (!arcThrough || points.length < 2) return null
    const bulge = bulgeThroughPoint(points[0], points[1], cursor)
    if (bulge === 0) return null
    const baseline: Baseline = { kind: 'arc', start: points[0], end: points[1], bulge }
    const info = arcInfo(points[0], points[1], bulge)
    return { baseline, bulge, info, length: baselineLength(baseline) }
  }, [arcThrough, points, cursor])

  const chain = useMemo(() => {
    if (arc) {
      return baselinePolyline(arc.baseline, 64).map((p) => [p[0], y, p[1]] as [number, number, number])
    }
    return [...points, cursor].map((p) => [p[0], y, p[1]] as [number, number, number])
  }, [arc, points, cursor, y])

  /** The chord, shown dashed behind an arc so the two collected points stay legible. */
  const chordLine = useMemo(() => {
    if (!arcThrough || points.length < 2) return null
    return [
      [points[0][0], y, points[0][1]],
      [points[1][0], y, points[1][1]],
    ] as [number, number, number][]
  }, [arcThrough, points, y])

  const last = points[points.length - 1]
  const segLength = distance(last, cursor)
  const segAngle = angleTo(last, cursor)
  const mid: [number, number, number] = [
    (last[0] + cursor[0]) / 2,
    y + 0.25,
    (last[1] + cursor[1]) / 2,
  ]

  // Closing edge preview for loop tools, plus a live area readout.
  const closeLine = useMemo(() => {
    if (!closed || points.length < 2) return null
    return [
      [cursor[0], y, cursor[1]],
      [points[0][0], y, points[0][1]],
    ] as [number, number, number][]
  }, [closed, points, cursor, y])

  const area = useMemo(() => {
    if (!closed || points.length < 2) return null
    return Math.abs(polygonArea([...points, cursor]))
  }, [closed, points, cursor])

  return (
    <group>
      <Line points={chain} color={color} lineWidth={1.8} depthTest={false} />
      {chordLine && (
        <Line
          points={chordLine}
          color={color}
          lineWidth={1}
          dashed
          dashSize={0.1}
          gapSize={0.08}
          depthTest={false}
          transparent
          opacity={0.5}
        />
      )}
      {closeLine && (
        <Line
          points={closeLine}
          color={color}
          lineWidth={1.2}
          dashed
          dashSize={0.12}
          gapSize={0.08}
          depthTest={false}
          transparent
          opacity={0.7}
        />
      )}

      {/* Vertex dots already placed */}
      {points.map((p, i) => (
        <mesh key={i} position={[p[0], y, p[1]]}>
          <sphereGeometry args={[0.035, 10, 10]} />
          <meshBasicMaterial color={color} depthTest={false} />
        </mesh>
      ))}

      {/* Live dimension — the number is visible before you commit it. Arc length and radius are
          the numbers that matter for a curved wall; the chord's angle is not. */}
      {arc && arc.info ? (
        <HudLabel
          position={[cursor[0], y + 0.25, cursor[1]]}
          text={`${formatLength(arc.length, units)} arc   R ${formatLength(arc.info.radius, units)}`}
          emphasis
        />
      ) : (
        segLength > 1e-4 && (
          <HudLabel
            position={mid}
            text={`${formatLength(segLength, units)}   ${segAngle.toFixed(1)}°`}
            accent={lockedLength !== null ? theme.selectActive : undefined}
            emphasis
          />
        )
      )}

      {area !== null && area > 1e-4 && (
        <HudLabel
          position={[
            [...points, cursor].reduce((a, p) => a + p[0], 0) / (points.length + 1),
            y + 0.1,
            [...points, cursor].reduce((a, p) => a + p[1], 0) / (points.length + 1),
          ]}
          text={`${area.toFixed(2)} m²`}
        />
      )}
    </group>
  )
}

/**
 * A DOM label anchored to a world position. Uses drei's `<Html>` (pure projection, no WebGL text)
 * so it works on any GL context and picks up the design tokens directly.
 */
function HudLabel({
  position,
  text,
  accent,
  emphasis,
}: {
  position: [number, number, number]
  text: string
  accent?: string
  emphasis?: boolean
}) {
  return (
    <Html
      position={position}
      center
      // Labels must never intercept a click meant for the canvas.
      pointerEvents="none"
      zIndexRange={[20, 0]}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      <div
        className="num"
        style={{
          whiteSpace: 'nowrap',
          fontSize: emphasis ? 'var(--fs-body)' : 'var(--fs-label)',
          fontWeight: emphasis ? 'var(--fw-bold)' : 'var(--fw-medium)',
          color: accent ?? '#ffffff',
          background: 'rgba(0, 0, 0, 0.62)',
          border: '1px solid rgba(255, 255, 255, 0.14)',
          borderRadius: 'var(--r-sm)',
          padding: '2px 6px',
          pointerEvents: 'none',
        }}
      >
        {text}
      </div>
    </Html>
  )
}

// ---------------------------------------------------------------------------
// Snap marker — a distinct glyph per snap type
// ---------------------------------------------------------------------------

function SnapMarker({
  point,
  y,
  type,
  label,
  theme,
}: {
  point: [number, number]
  y: number
  type: SnapType
  label: string | null
  theme: CanvasTheme
}) {
  const s = useOverlayScale()
  const pos: [number, number, number] = [point[0], y + 0.002, point[1]]
  const color = type === 'grid' ? theme.axisZ : theme.selectActive

  return (
    <group position={pos}>
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <SnapGlyph type={type} size={s} color={color} />
      </group>
      {label && (
        <Html
          position={[s * 2.5, s * 2.5, 0]}
          pointerEvents="none"
          zIndexRange={[20, 0]}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          <div
            style={{
              whiteSpace: 'nowrap',
              fontSize: 'var(--fs-label)',
              fontWeight: 'var(--fw-medium)',
              color,
              background: 'rgba(0, 0, 0, 0.62)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              borderRadius: 'var(--r-sm)',
              padding: '1px 5px',
              pointerEvents: 'none',
            }}
          >
            {label}
          </div>
        </Html>
      )}
    </group>
  )
}

/** Glyph shapes follow the AutoCAD/Revit convention so the type is readable at a glance. */
function SnapGlyph({ type, size, color }: { type: SnapType; size: number; color: string }) {
  const mat = <meshBasicMaterial color={color} depthTest={false} side={THREE.DoubleSide} />

  switch (type) {
    case 'endpoint':
      // Square
      return (
        <mesh>
          <ringGeometry args={[size * 0.9, size * 1.25, 4, 1]} />
          {mat}
        </mesh>
      )
    case 'midpoint':
      // Triangle
      return (
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <ringGeometry args={[size * 0.9, size * 1.3, 3, 1]} />
          {mat}
        </mesh>
      )
    case 'center':
      // Circle
      return (
        <mesh>
          <ringGeometry args={[size * 0.9, size * 1.2, 24]} />
          {mat}
        </mesh>
      )
    case 'intersection':
      // Cross
      return (
        <group>
          <mesh rotation={[0, 0, Math.PI / 4]}>
            <planeGeometry args={[size * 2.4, size * 0.28]} />
            {mat}
          </mesh>
          <mesh rotation={[0, 0, -Math.PI / 4]}>
            <planeGeometry args={[size * 2.4, size * 0.28]} />
            {mat}
          </mesh>
        </group>
      )
    case 'perpendicular':
      // Right-angle mark
      return (
        <group>
          <mesh position={[0, -size, 0]}>
            <planeGeometry args={[size * 2.2, size * 0.28]} />
            {mat}
          </mesh>
          <mesh position={[-size, 0, 0]}>
            <planeGeometry args={[size * 0.28, size * 2.2]} />
            {mat}
          </mesh>
        </group>
      )
    case 'quadrant':
      // Diamond
      return (
        <mesh rotation={[0, 0, Math.PI / 4]}>
          <ringGeometry args={[size * 0.9, size * 1.25, 4, 1]} />
          {mat}
        </mesh>
      )
    case 'edge':
      // Short bar (on-edge)
      return (
        <mesh>
          <planeGeometry args={[size * 2.4, size * 0.32]} />
          {mat}
        </mesh>
      )
    case 'extension':
      // Three dots along a line
      return (
        <group>
          {[-1, 0, 1].map((i) => (
            <mesh key={i} position={[i * size * 0.9, 0, 0]}>
              <circleGeometry args={[size * 0.2, 8]} />
              {mat}
            </mesh>
          ))}
        </group>
      )
    case 'axis':
      // Small chevron
      return (
        <mesh>
          <ringGeometry args={[size * 0.5, size * 0.8, 12]} />
          {mat}
        </mesh>
      )
    case 'grid':
    default:
      // Faint small circle — the lowest-priority snap gets the quietest mark.
      return (
        <mesh>
          <ringGeometry args={[size * 0.45, size * 0.7, 12]} />
          {mat}
        </mesh>
      )
  }
}
