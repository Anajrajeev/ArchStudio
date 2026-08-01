/**
 * Column grid renderer (B6).
 *
 * Grid lines are drei `<Line>`s (dashed, per drafting convention); bubbles are small circles
 * with a DOM label — same no-Troika reasoning as every other text overlay in this app.
 * A grid is drawn only on its own level, at that level's work-plane elevation.
 */
import { useMemo } from 'react'
import { Line, Html } from '@react-three/drei'
import * as THREE from 'three'
import { useEditor } from '../scene/store'
import { gridLines } from '../../../shared/geometry/columnGrid'
import { findLevel, type ColumnGrid } from '../../../shared/types/scene'
import { planeElevation, levelWorkPlane } from '../../../shared/geometry/workplane'

const ELEV_OFFSET = 0.008

export default function ColumnGrids() {
  const scene = useEditor((s) => s.scene)
  const selectedIds = useEditor((s) => s.selectedIds)

  if (scene.columnGrids.length === 0) return null

  return (
    <group>
      {scene.columnGrids.map((grid) => (
        <OneGrid key={grid.id} grid={grid} selected={selectedIds.includes(grid.id)} />
      ))}
    </group>
  )
}

function v2to3(p: [number, number], y: number): THREE.Vector3 {
  return new THREE.Vector3(p[0], y, p[1])
}

function OneGrid({ grid, selected }: { grid: ColumnGrid; selected: boolean }) {
  const scene = useEditor((s) => s.scene)
  const lines = useMemo(() => gridLines(grid), [grid])
  const level = findLevel(scene, grid.levelId)
  if (!level) return null

  const y = planeElevation(levelWorkPlane(level.id, level.name, level.elevation)) + ELEV_OFFSET
  const color = selected ? 'var(--select, #ff8a3d)' : 'var(--grid-axis, #8a8f98)'

  return (
    <group>
      {lines.map((line) => (
        <group key={line.axisId}>
          <Line
            points={[v2to3(line.start, y), v2to3(line.end, y)]}
            color={color}
            lineWidth={1}
            dashed
            dashSize={0.15}
            gapSize={0.1}
          />
          <Bubble position={v2to3(line.bubbleStart, y)} label={line.label} radius={grid.bubbleRadius} color={color} />
          <Bubble position={v2to3(line.bubbleEnd, y)} label={line.label} radius={grid.bubbleRadius} color={color} />
        </group>
      ))}
    </group>
  )
}

function Bubble({
  position,
  label,
  radius,
  color,
}: {
  position: THREE.Vector3
  label: string
  radius: number
  color: string
}) {
  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 0.85, radius, 32]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <Html center pointerEvents="none" zIndexRange={[10, 0]}>
        <span
          style={{
            fontSize: 'var(--fs-label)',
            fontFamily: 'var(--font-sans, sans-serif)',
            fontWeight: 'var(--fw-medium)',
            color: 'var(--text-default)',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        >
          {label}
        </span>
      </Html>
    </group>
  )
}
