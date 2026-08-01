/**
 * Element renderers. Every mesh here derives its geometry from `shared/geometry`, the same
 * functions the exporters call — so what you see and what you export cannot disagree.
 *
 * Selection is an orange outline PLUS a fill tint: outline alone vanishes on a wall seen
 * edge-on, tint alone vanishes on an already-orange material.
 */
import { useEffect, useMemo } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import { Edges } from '@react-three/drei'
import * as THREE from 'three'
import {
  resolveWall,
  resolveSlab,
  columnSolid,
  beamSolid,
  wallSolidBoxes,
  polygonArea,
  baselinePointAt,
  rotationYFor,
  profileExtents,
  type Box3D,
} from '../../../shared/geometry/index'
import {
  findType,
  findLevel,
  resolveTopElevation,
  type SceneGraph,
  type Vec2,
  type Filling,
} from '../../../shared/types/scene'
import { materialColor } from '../scene/materials'
import type { CanvasTheme } from './theme'

export interface RenderOpts {
  scene: SceneGraph
  theme: CanvasTheme
  selectedIds: string[]
  hoveredId: string | null
  /** Ghosted levels render translucent and non-interactive. */
  ghost: boolean
  onPick: (id: string, e: ThreeEvent<MouseEvent>) => void
  onHover: (id: string | null) => void
}

/** Shared surface material props for selection/hover state. */
function surfaceProps(
  color: string,
  selected: boolean,
  hovered: boolean,
  ghost: boolean,
  theme: CanvasTheme,
): JSX.IntrinsicElements['meshStandardMaterial'] {
  return {
    color: selected ? theme.select : color,
    emissive: selected ? theme.select : hovered ? theme.prehighlight : '#000000',
    emissiveIntensity: selected ? 0.35 : hovered ? 0.18 : 0,
    transparent: ghost,
    opacity: ghost ? 0.18 : 1,
    depthWrite: !ghost,
    roughness: 0.85,
    metalness: 0.02,
  }
}

function OutlineIf({ show, color }: { show: boolean; color: string }) {
  if (!show) return null
  return <Edges threshold={20} color={color} />
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

export function Walls({ opts, levelId }: { opts: RenderOpts; levelId: string }) {
  const { scene } = opts
  const walls = useMemo(() => scene.walls.filter((w) => w.levelId === levelId), [scene.walls, levelId])
  return (
    <>
      {walls.map((wall) => (
        <WallMesh key={wall.id} wallId={wall.id} opts={opts} />
      ))}
    </>
  )
}

function WallMesh({ wallId, opts }: { wallId: string; opts: RenderOpts }) {
  const { scene, theme, selectedIds, hoveredId, ghost, onPick, onHover } = opts
  const wall = scene.walls.find((w) => w.id === wallId)

  const boxes = useMemo(() => {
    if (!wall) return []
    const resolved = resolveWall(scene, wall)
    if (!resolved) return []
    const openings = scene.openings.filter((o) => o.hostId === wall.id)
    return wallSolidBoxes(resolved, openings)
  }, [scene, wall])

  if (!wall) return null
  const resolved = resolveWall(scene, wall)
  if (!resolved) return null

  const selected = selectedIds.includes(wallId)
  const hovered = hoveredId === wallId
  const color = materialColor(scene, resolved.material)

  return (
    <group
      onPointerDown={ghost ? undefined : (e) => onPick(wallId, e)}
      onPointerOver={
        ghost
          ? undefined
          : (e) => {
              e.stopPropagation()
              onHover(wallId)
            }
      }
      onPointerOut={ghost ? undefined : () => onHover(null)}
      // Ghosted levels must not steal picks from the active level.
      raycast={ghost ? () => null : undefined}
    >
      {boxes.map((box, i) => (
        <mesh key={i} position={box.center} rotation={[0, box.rotationY, 0]} castShadow receiveShadow>
          <boxGeometry args={box.size} />
          <meshStandardMaterial {...surfaceProps(color, selected, hovered, ghost, theme)} />
          <OutlineIf show={selected && !ghost} color={theme.select} />
        </mesh>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------
// Doors & windows (the fillings)
// ---------------------------------------------------------------------------

export function Fillings({ opts, levelId }: { opts: RenderOpts; levelId: string }) {
  const { scene } = opts
  const items = useMemo(() => {
    const wallIds = new Set(scene.walls.filter((w) => w.levelId === levelId).map((w) => w.id))
    return scene.fillings.filter((f) => {
      const o = scene.openings.find((x) => x.id === f.openingId)
      return o ? wallIds.has(o.hostId) : false
    })
  }, [scene, levelId])

  return (
    <>
      {items.map((f) => (
        <FillingMesh key={f.id} filling={f} opts={opts} />
      ))}
    </>
  )
}

function FillingMesh({ filling, opts }: { filling: Filling; opts: RenderOpts }) {
  const { scene, theme, selectedIds, hoveredId, ghost, onPick, onHover } = opts

  const parts = useMemo(() => {
    const opening = scene.openings.find((o) => o.id === filling.openingId)
    if (!opening) return null
    const wall = scene.walls.find((w) => w.id === opening.hostId)
    if (!wall) return null
    const resolved = resolveWall(scene, wall)
    if (!resolved) return null
    const type = findType(scene, filling.typeId)
    if (!type || (type.category !== 'door' && type.category !== 'window')) return null

    // Position at the opening's centre along the wall.
    const centreAlong = opening.offset + opening.width / 2
    const at = baselinePointAt(resolved.centerline, centreAlong)
    const rotationY = rotationYFor(at.tangent)
    const yMid = resolved.baseElevation + opening.sillHeight + opening.height / 2

    if (type.category === 'door') {
      // A single leaf, inset in the wall, hinged at one edge.
      const leafT = Math.min(type.thickness, resolved.thickness * 0.5)
      const hand = filling.flippedHand ? -1 : 1
      return {
        rotationY,
        centre: [at.point[0], yMid, at.point[1]] as [number, number, number],
        meshes: [
          {
            // Leaf, slightly narrower than the hole so a reveal is visible.
            size: [opening.width * 0.96, opening.height * 0.98, leafT] as [number, number, number],
            offset: [0, 0, 0] as [number, number, number],
            color: materialColor(scene, type.panelMaterial),
            transparent: false,
          },
          {
            // Handle, on the swing side.
            size: [0.03, 0.12, 0.03] as [number, number, number],
            offset: [hand * opening.width * 0.38, 0, leafT * 0.9] as [number, number, number],
            color: materialColor(scene, 'mat-steel'),
            transparent: false,
          },
        ],
      }
    }

    // Window: a frame ring plus glazing, with mullions per the partitioning.
    const ft = type.frameThickness
    const frameColor = materialColor(scene, type.frameMaterial)
    const glassColor = materialColor(scene, type.glassMaterial)
    const w = opening.width
    const h = opening.height
    const depth = Math.min(resolved.thickness * 0.7, 0.09)
    const meshes: Array<{
      size: [number, number, number]
      offset: [number, number, number]
      color: string
      transparent: boolean
    }> = [
      { size: [w, ft, depth], offset: [0, h / 2 - ft / 2, 0], color: frameColor, transparent: false },
      { size: [w, ft, depth], offset: [0, -h / 2 + ft / 2, 0], color: frameColor, transparent: false },
      { size: [ft, h - 2 * ft, depth], offset: [-w / 2 + ft / 2, 0, 0], color: frameColor, transparent: false },
      { size: [ft, h - 2 * ft, depth], offset: [w / 2 - ft / 2, 0, 0], color: frameColor, transparent: false },
      // Glazing, thin and translucent.
      { size: [w - 2 * ft, h - 2 * ft, 0.008], offset: [0, 0, 0], color: glassColor, transparent: true },
    ]
    const verticalMullions =
      type.partitioning === 'double-vertical' ? 1 : type.partitioning === 'triple-vertical' ? 2 : 0
    for (let i = 1; i <= verticalMullions; i++) {
      const x = -w / 2 + (w * i) / (verticalMullions + 1)
      meshes.push({
        size: [ft * 0.7, h - 2 * ft, depth],
        offset: [x, 0, 0],
        color: frameColor,
        transparent: false,
      })
    }
    if (type.partitioning === 'double-horizontal') {
      meshes.push({
        size: [w - 2 * ft, ft * 0.7, depth],
        offset: [0, 0, 0],
        color: frameColor,
        transparent: false,
      })
    }

    return {
      rotationY,
      centre: [at.point[0], yMid, at.point[1]] as [number, number, number],
      meshes,
    }
  }, [scene, filling])

  if (!parts) return null
  const selected = selectedIds.includes(filling.id)
  const hovered = hoveredId === filling.id

  return (
    <group
      position={parts.centre}
      rotation={[0, parts.rotationY, 0]}
      onPointerDown={ghost ? undefined : (e) => onPick(filling.id, e)}
      onPointerOver={
        ghost
          ? undefined
          : (e) => {
              e.stopPropagation()
              onHover(filling.id)
            }
      }
      onPointerOut={ghost ? undefined : () => onHover(null)}
      raycast={ghost ? () => null : undefined}
    >
      {parts.meshes.map((m, i) => (
        <mesh key={i} position={m.offset} castShadow>
          <boxGeometry args={m.size} />
          <meshStandardMaterial
            color={selected ? theme.select : m.color}
            emissive={selected ? theme.select : hovered ? theme.prehighlight : '#000000'}
            emissiveIntensity={selected ? 0.35 : hovered ? 0.2 : 0}
            transparent={m.transparent || ghost}
            opacity={ghost ? 0.15 : m.transparent ? 0.35 : 1}
            roughness={m.transparent ? 0.1 : 0.8}
            metalness={m.transparent ? 0.1 : 0.02}
          />
        </mesh>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------
// Slabs — extruded boundary polygons
// ---------------------------------------------------------------------------

function polygonToShape(polygon: Vec2[]): THREE.Shape {
  // THREE.Shape winds CCW; flip a CW polygon so normals point up.
  const pts = polygonArea(polygon) < 0 ? [...polygon].reverse() : polygon
  return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
}

export function Slabs({ opts, levelId }: { opts: RenderOpts; levelId: string }) {
  const { scene } = opts
  const slabs = useMemo(() => scene.slabs.filter((s) => s.levelId === levelId), [scene.slabs, levelId])
  return (
    <>
      {slabs.map((s) => (
        <SlabMesh key={s.id} slabId={s.id} opts={opts} />
      ))}
    </>
  )
}

function SlabMesh({ slabId, opts }: { slabId: string; opts: RenderOpts }) {
  const { scene, theme, selectedIds, hoveredId, ghost, onPick, onHover } = opts
  const slab = scene.slabs.find((s) => s.id === slabId)

  const built = useMemo(() => {
    if (!slab) return null
    const resolved = resolveSlab(scene, slab)
    if (!resolved) return null
    const shape = polygonToShape(resolved.boundary)
    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: resolved.thickness,
      bevelEnabled: false,
    })
    // Extrude grows along +Z in the shape's own plane; rotate so it grows downward in world Y,
    // then the slab's TOP sits at `topElevation`.
    geom.rotateX(Math.PI / 2)
    geom.computeVertexNormals()
    return { geom, resolved }
  }, [scene, slab])

  useDisposeGeometry(built?.geom)
  if (!built || !slab) return null

  const selected = selectedIds.includes(slabId)
  const hovered = hoveredId === slabId
  const color = materialColor(scene, built.resolved.material)

  return (
    <mesh
      geometry={built.geom}
      position={[0, built.resolved.topElevation, 0]}
      receiveShadow
      castShadow
      onPointerDown={ghost ? undefined : (e) => onPick(slabId, e)}
      onPointerOver={
        ghost
          ? undefined
          : (e) => {
              e.stopPropagation()
              onHover(slabId)
            }
      }
      onPointerOut={ghost ? undefined : () => onHover(null)}
      raycast={ghost ? () => null : undefined}
    >
      <meshStandardMaterial {...surfaceProps(color, selected, hovered, ghost, theme)} />
      <OutlineIf show={selected && !ghost} color={theme.select} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// Rooms — a thin floor plate + an area label
// ---------------------------------------------------------------------------

export function Rooms({ opts, levelId }: { opts: RenderOpts; levelId: string }) {
  const { scene } = opts
  const rooms = useMemo(() => scene.rooms.filter((r) => r.levelId === levelId), [scene.rooms, levelId])
  return (
    <>
      {rooms.map((r) => (
        <RoomMesh key={r.id} roomId={r.id} opts={opts} />
      ))}
    </>
  )
}

function RoomMesh({ roomId, opts }: { roomId: string; opts: RenderOpts }) {
  const { scene, theme, selectedIds, hoveredId, ghost, onPick, onHover } = opts
  const room = scene.rooms.find((r) => r.id === roomId)
  const level = room ? findLevel(scene, room.levelId) : undefined

  const geom = useMemo(() => {
    if (!room || room.polygon.length < 3) return null
    const g = new THREE.ShapeGeometry(polygonToShape(room.polygon))
    g.rotateX(Math.PI / 2)
    return g
  }, [room])

  useDisposeGeometry(geom)
  if (!geom || !room || !level) return null

  const selected = selectedIds.includes(roomId)
  const hovered = hoveredId === roomId
  const y = level.elevation + room.baseOffset + 0.005

  return (
    <mesh
      geometry={geom}
      position={[0, y, 0]}
      receiveShadow
      onPointerDown={ghost ? undefined : (e) => onPick(roomId, e)}
      onPointerOver={
        ghost
          ? undefined
          : (e) => {
              e.stopPropagation()
              onHover(roomId)
            }
      }
      onPointerOut={ghost ? undefined : () => onHover(null)}
      raycast={ghost ? () => null : undefined}
    >
      <meshStandardMaterial
        color={selected ? theme.select : materialColor(scene, room.floorMaterial)}
        side={THREE.DoubleSide}
        emissive={selected ? theme.select : hovered ? theme.prehighlight : '#000000'}
        emissiveIntensity={selected ? 0.3 : hovered ? 0.15 : 0}
        transparent={ghost}
        opacity={ghost ? 0.12 : 1}
        roughness={0.9}
      />
      <OutlineIf show={selected && !ghost} color={theme.select} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// Columns & beams
// ---------------------------------------------------------------------------

export function Columns({ opts, levelId }: { opts: RenderOpts; levelId: string }) {
  const { scene, theme, selectedIds, hoveredId, ghost, onPick, onHover } = opts
  const columns = useMemo(
    () => scene.columns.filter((c) => c.levelId === levelId),
    [scene.columns, levelId],
  )
  return (
    <>
      {columns.map((col) => {
        const box = columnSolid(scene, col)
        const type = findType(scene, col.typeId)
        if (!box || !type || type.category !== 'column') return null
        const selected = selectedIds.includes(col.id)
        const hovered = hoveredId === col.id
        const round = type.profile.kind === 'circular'
        const [w, d] = profileExtents(type.profile)
        return (
          <mesh
            key={col.id}
            position={box.center}
            rotation={[0, box.rotationY, 0]}
            castShadow
            receiveShadow
            onPointerDown={ghost ? undefined : (e) => onPick(col.id, e)}
            onPointerOver={
              ghost
                ? undefined
                : (e) => {
                    e.stopPropagation()
                    onHover(col.id)
                  }
            }
            onPointerOut={ghost ? undefined : () => onHover(null)}
            raycast={ghost ? () => null : undefined}
          >
            {round ? (
              <cylinderGeometry args={[w / 2, w / 2, box.size[1], 24]} />
            ) : (
              <boxGeometry args={[w, box.size[1], d]} />
            )}
            <meshStandardMaterial
              {...surfaceProps(materialColor(scene, type.material), selected, hovered, ghost, theme)}
            />
            <OutlineIf show={selected && !ghost} color={theme.select} />
          </mesh>
        )
      })}
    </>
  )
}

export function Beams({ opts, levelId }: { opts: RenderOpts; levelId: string }) {
  const { scene, theme, selectedIds, hoveredId, ghost, onPick, onHover } = opts
  const beams = useMemo(() => scene.beams.filter((b) => b.levelId === levelId), [scene.beams, levelId])
  return (
    <>
      {beams.map((beam) => {
        const box: Box3D | null = beamSolid(scene, beam)
        const type = findType(scene, beam.typeId)
        if (!box || !type || type.category !== 'beam') return null
        const selected = selectedIds.includes(beam.id)
        const hovered = hoveredId === beam.id
        return (
          <mesh
            key={beam.id}
            position={box.center}
            rotation={[0, box.rotationY, (beam.crossSectionRotation * Math.PI) / 180]}
            castShadow
            receiveShadow
            onPointerDown={ghost ? undefined : (e) => onPick(beam.id, e)}
            onPointerOver={
              ghost
                ? undefined
                : (e) => {
                    e.stopPropagation()
                    onHover(beam.id)
                  }
            }
            onPointerOut={ghost ? undefined : () => onHover(null)}
            raycast={ghost ? () => null : undefined}
          >
            <boxGeometry args={box.size} />
            <meshStandardMaterial
              {...surfaceProps(materialColor(scene, type.material), selected, hovered, ghost, theme)}
            />
            <OutlineIf show={selected && !ghost} color={theme.select} />
          </mesh>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// Furniture — placeholder boxes until the Phase 5 glTF catalog lands
// ---------------------------------------------------------------------------

export function Furniture({ opts, levelId }: { opts: RenderOpts; levelId: string }) {
  const { scene, theme, selectedIds, hoveredId, ghost, onPick, onHover } = opts
  const items = useMemo(
    () => scene.furniture.filter((f) => f.levelId === levelId),
    [scene.furniture, levelId],
  )
  return (
    <>
      {items.map((item) => {
        const type = findType(scene, item.typeId)
        const level = findLevel(scene, item.levelId)
        if (!type || type.category !== 'furniture' || !level) return null
        const [fw, fd] = type.footprint
        const h = type.heightMeters
        const selected = selectedIds.includes(item.id)
        const hovered = hoveredId === item.id
        return (
          <mesh
            key={item.id}
            position={[
              item.position[0],
              level.elevation + item.heightOffset + (h * item.scale) / 2,
              item.position[1],
            ]}
            rotation={[0, (-item.rotation * Math.PI) / 180, 0]}
            scale={item.scale}
            castShadow
            onPointerDown={ghost ? undefined : (e) => onPick(item.id, e)}
            onPointerOver={
              ghost
                ? undefined
                : (e) => {
                    e.stopPropagation()
                    onHover(item.id)
                  }
            }
            onPointerOut={ghost ? undefined : () => onHover(null)}
            raycast={ghost ? () => null : undefined}
          >
            <boxGeometry args={[fw, h, fd]} />
            <meshStandardMaterial
              {...surfaceProps(materialColor(scene, type.material), selected, hovered, ghost, theme)}
            />
            <OutlineIf show={selected && !ghost} color={theme.select} />
          </mesh>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------

/**
 * Dispose a generated BufferGeometry when it's replaced or unmounted. Slab/room geometry is
 * rebuilt whenever the boundary changes, so without this a long editing session leaks GPU memory.
 */
function useDisposeGeometry(geom: THREE.BufferGeometry | null | undefined): void {
  useEffect(() => {
    if (!geom) return
    return () => geom.dispose()
  }, [geom])
}

/** Resolve the world elevation of a level's top, for the cut plane. */
export function levelTopElevation(scene: SceneGraph, levelId: string): number {
  const level = findLevel(scene, levelId)
  if (!level) return 0
  return resolveTopElevation(scene, { kind: 'unconnected', height: level.height }, level.elevation)
}
