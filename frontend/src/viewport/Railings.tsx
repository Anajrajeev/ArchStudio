/**
 * Railing renderer (B3) — one mesh per box from `railingSolidBoxes` (the rail segments plus the
 * posts). Plain `THREE.BoxGeometry`, same reasoning as `Stairs.tsx`: nothing here has a sloped top.
 */
import { useMemo } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { Edges } from '@react-three/drei'
import { resolveRailing, railingSolidBoxes } from '../../../shared/geometry/railing'
import { materialColor } from '../scene/materials'
import type { RenderOpts } from './Elements'

export function Railings({ opts, levelId }: { opts: RenderOpts; levelId: string }) {
  const { scene } = opts
  const railings = useMemo(
    () => scene.railings.filter((r) => r.levelId === levelId),
    [scene.railings, levelId],
  )
  return (
    <>
      {railings.map((r) => (
        <RailingMesh key={r.id} railingId={r.id} opts={opts} />
      ))}
    </>
  )
}

function RailingMesh({ railingId, opts }: { railingId: string; opts: RenderOpts }) {
  const { scene, theme, selectedIds, hoveredId, ghost, onPick, onHover } = opts
  const railing = scene.railings.find((r) => r.id === railingId)

  const boxes = useMemo(() => {
    if (!railing) return []
    const resolved = resolveRailing(scene, railing)
    return resolved ? railingSolidBoxes(resolved) : []
  }, [scene, railing])

  if (!railing || boxes.length === 0) return null

  const resolved = resolveRailing(scene, railing)!
  const selected = selectedIds.includes(railingId)
  const hovered = hoveredId === railingId
  const color = materialColor(scene, resolved.material)

  return (
    <group
      onPointerDown={ghost ? undefined : (e: ThreeEvent<MouseEvent>) => onPick(railingId, e)}
      onPointerOver={
        ghost
          ? undefined
          : (e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation()
              onHover(railingId)
            }
      }
      onPointerOut={ghost ? undefined : () => onHover(null)}
      raycast={ghost ? () => null : undefined}
    >
      {boxes.map((box, i) => (
        <mesh key={i} position={box.center} rotation={[0, box.rotationY, 0]} castShadow receiveShadow>
          <boxGeometry args={box.size} />
          <meshStandardMaterial
            color={selected ? theme.select : color}
            emissive={selected ? theme.select : hovered ? theme.prehighlight : '#000000'}
            emissiveIntensity={selected ? 0.35 : hovered ? 0.18 : 0}
            transparent={ghost}
            opacity={ghost ? 0.18 : 1}
            depthWrite={!ghost}
            roughness={0.4}
            metalness={0.3}
          />
          {selected && !ghost && <Edges threshold={20} color={theme.select} />}
        </mesh>
      ))}
    </group>
  )
}
