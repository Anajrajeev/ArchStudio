/**
 * Parametric dimension renderer (C2).
 *
 * Reads `scene.dimensions`, resolves each one to geometry via `resolveDimension`, and draws:
 *  - two witness lines from geometry → dimension line
 *  - the dimension line with tick marks at each end
 *  - a DOM text label via <Html> (same reason as Overlays.tsx: no Troika dependency)
 *
 * All geometry is derived per-frame from the live scene graph, so dimensions update
 * automatically when the measured elements move — that is the parametric contract.
 *
 * Layout is at `y + ELEV_OFFSET` so dimension lines float above the geometry.
 */
import { useMemo } from 'react'
import { Line, Html } from '@react-three/drei'
import * as THREE from 'three'
import { useEditor } from '../scene/store'
import { resolveAllDimensions, type ResolvedDimension } from '../../../shared/geometry/dimensions'
import { planeElevation } from '../../../shared/geometry/workplane'

/** How far above the work plane the dimension lines float. */
const ELEV_OFFSET = 0.01

/** Tick mark half-length perpendicular to the dimension line, in scene units. */
const TICK_HALF = 0.06

export default function Dimensions() {
  const scene = useEditor((s) => s.scene)
  const workPlane = useEditor((s) => s.workPlane)
  const y = planeElevation(workPlane) + ELEV_OFFSET

  const resolved = useMemo(() => resolveAllDimensions(scene), [scene])

  if (resolved.length === 0) return null

  return (
    <group>
      {resolved.map((d) => (
        <OneDimension key={d.id} dim={d} y={y} />
      ))}
    </group>
  )
}

function v2to3(p: [number, number], y: number): THREE.Vector3 {
  return new THREE.Vector3(p[0], y, p[1])
}

function OneDimension({ dim, y }: { dim: ResolvedDimension; y: number }) {
  // Perpendicular to the dimension line, for tick marks.
  const dx = dim.dimEnd[0] - dim.dimStart[0]
  const dz = dim.dimEnd[1] - dim.dimStart[1]
  const len = Math.hypot(dx, dz)
  const tx = len > 1e-9 ? -dz / len : 0
  const tz = len > 1e-9 ? dx / len : 1

  const dimStartV = v2to3(dim.dimStart, y)
  const dimEndV = v2to3(dim.dimEnd, y)

  const tick1a = new THREE.Vector3(dim.dimStart[0] + tx * TICK_HALF, y, dim.dimStart[1] + tz * TICK_HALF)
  const tick1b = new THREE.Vector3(dim.dimStart[0] - tx * TICK_HALF, y, dim.dimStart[1] - tz * TICK_HALF)
  const tick2a = new THREE.Vector3(dim.dimEnd[0] + tx * TICK_HALF, y, dim.dimEnd[1] + tz * TICK_HALF)
  const tick2b = new THREE.Vector3(dim.dimEnd[0] - tx * TICK_HALF, y, dim.dimEnd[1] - tz * TICK_HALF)

  const textPos = v2to3(dim.textAnchor, y + 0.002)

  return (
    <>
      {/* Witness line 1 */}
      <Line
        points={[v2to3(dim.w1Start, y), v2to3(dim.w1End, y)]}
        color="var(--dim-line, #6ca3c8)"
        lineWidth={1}
        dashed={false}
      />
      {/* Witness line 2 */}
      <Line
        points={[v2to3(dim.w2Start, y), v2to3(dim.w2End, y)]}
        color="var(--dim-line, #6ca3c8)"
        lineWidth={1}
        dashed={false}
      />
      {/* Dimension line */}
      <Line
        points={[dimStartV, dimEndV]}
        color="var(--dim-line, #6ca3c8)"
        lineWidth={1.5}
        dashed={false}
      />
      {/* Tick marks */}
      <Line points={[tick1a, tick1b]} color="var(--dim-line, #6ca3c8)" lineWidth={1.5} />
      <Line points={[tick2a, tick2b]} color="var(--dim-line, #6ca3c8)" lineWidth={1.5} />

      {/* Text label — DOM so it uses the token layer and needs no Troika. */}
      <Html position={textPos} center pointerEvents="none" zIndexRange={[10, 0]}>
        <span
          style={{
            fontSize: 'var(--fs-label)',
            fontFamily: 'var(--font-mono, monospace)',
            color: 'var(--dim-text, var(--text-dim))',
            background: 'var(--canvas-bg, transparent)',
            padding: '0 2px',
            whiteSpace: 'nowrap',
            userSelect: 'none',
            pointerEvents: 'none',
            transform: `rotate(${-dim.textAngle}rad)`,
            display: 'inline-block',
          }}
        >
          {dim.text}
        </span>
      </Html>
    </>
  )
}
