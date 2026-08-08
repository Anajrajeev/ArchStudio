/**
 * Stair renderer (B2) — one mesh per step box, from `stairSolidBoxes`. Plain `THREE.BoxGeometry`
 * per box, exactly like a wall's non-ramped chunks: nothing about a stair's geometry needs the
 * ramped-top machinery B1 added, since every step is a flat-topped solid.
 */
import { useMemo } from 'react'
import { Edges } from '@react-three/drei'
import { resolveStair, stairSolidBoxes } from '../../../shared/geometry/stair'
import { materialColor } from '../scene/materials'
import { pickProps, surfaceProps, visible, type RenderOpts } from './Elements'

export function Stairs({ opts, levelId }: { opts: RenderOpts; levelId: string }) {
  const { scene } = opts
  const stairs = useMemo(
    () => visible(opts, scene.stairs.filter((s) => s.levelId === levelId)),
    [opts, scene.stairs, levelId],
  )
  return (
    <>
      {stairs.map((s) => (
        <StairMesh key={s.id} stairId={s.id} opts={opts} />
      ))}
    </>
  )
}

function StairMesh({ stairId, opts }: { stairId: string; opts: RenderOpts }) {
  const { scene, theme, selectedIds, hoveredId, ghost } = opts
  const stair = scene.stairs.find((s) => s.id === stairId)

  const boxes = useMemo(() => {
    if (!stair) return []
    const resolved = resolveStair(scene, stair)
    return resolved ? stairSolidBoxes(resolved) : []
  }, [scene, stair])

  if (!stair || boxes.length === 0) return null

  const resolved = resolveStair(scene, stair)!
  const selected = selectedIds.includes(stairId)
  const hovered = hoveredId === stairId
  const color = materialColor(scene, resolved.material)

  return (
    <group
      {...pickProps(opts, stairId)}
    >
      {boxes.map((box, i) => (
        <mesh key={i} position={box.center} rotation={[0, box.rotationY, 0]} castShadow receiveShadow>
          <boxGeometry args={box.size} />
          <meshStandardMaterial
            {...surfaceProps(color, selected, hovered, ghost, theme, opts.underlay)}
          />
          {selected && !ghost && <Edges threshold={20} color={theme.select} />}
        </mesh>
      ))}
    </group>
  )
}
