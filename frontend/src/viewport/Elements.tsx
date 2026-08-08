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
  resolveCeiling,
  columnSolid,
  beamSolid,
  wallSolidBoxes,
  boxToTriMesh,
  polygonArea,
  baselinePointAt,
  rotationYFor,
  profileExtents,
  type Box3D,
  type WallEndAdjust,
} from '../../../shared/geometry/index'
import { resolveWallJoins } from '../../../shared/geometry/wallJoin'
import {
  curtainWallSolidBoxes,
  resolveCurtainWall,
} from '../../../shared/geometry/curtainWall'
import { triMeshToGeometry } from '../scene/geometryUtils'
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
  /**
   * C8: this level is the plan UNDERLAY — a reference layer, drawn as flat halftone rather than a
   * dimmed copy of the real materials, and never interactive. Distinct from `ghost`, which is the
   * 3D "storey below" treatment and keeps each element's own colour.
   */
  underlay?: boolean
  /**
   * C7: when present, only these ids render. Used to split one level across several clipped
   * groups so plan regions can be cut at different heights — every renderer honours it by the
   * same one-line filter, so a kind cannot accidentally opt out of regions.
   */
  only?: ReadonlySet<string>
  onPick: (id: string, e: ThreeEvent<MouseEvent>) => void
  onHover: (id: string | null) => void
}

/** Which of a level's elements this pass should draw (C7 region partitioning). */
export function visible<T extends { id: string }>(opts: RenderOpts, items: T[]): T[] {
  return opts.only ? items.filter((i) => opts.only!.has(i.id)) : items
}

/**
 * The pointer props every element `<group>` needs.
 *
 * Exported because `Roofs`/`Primitives`/`Stairs`/`Railings`/`CurtainWalls` each used to inline the
 * same four handlers plus the same `raycast` null-out; with C8's underlay adding a second reason
 * an element can be non-interactive, five hand-copied versions of that rule would have been five
 * chances to forget one.
 */
export function pickProps(opts: RenderOpts, id: string) {
  const inert = opts.ghost || opts.underlay === true
  return {
    onPointerDown: inert ? undefined : (e: ThreeEvent<MouseEvent>) => opts.onPick(id, e),
    onPointerOver: inert
      ? undefined
      : (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation()
          opts.onHover(id)
        },
    onPointerOut: inert ? undefined : () => opts.onHover(null),
    raycast: inert ? () => null : undefined,
  }
}

/** Shared surface material props for selection/hover state. */
export function surfaceProps(
  color: string,
  selected: boolean,
  hovered: boolean,
  ghost: boolean,
  theme: CanvasTheme,
  underlay = false,
): JSX.IntrinsicElements['meshStandardMaterial'] {
  // C8: an underlay is a REFERENCE layer, not a dimmed model. It drops its materials for one flat
  // halftone so it reads as "another drawing showing through" rather than as faint real geometry
  // the user might try to click — and it is never highlighted, since it cannot be selected.
  if (underlay) {
    return {
      color: theme.underlay,
      emissive: '#000000',
      emissiveIntensity: 0,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      roughness: 1,
      metalness: 0,
    }
  }
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
  const walls = useMemo(
    () => visible(opts, scene.walls.filter((w) => w.levelId === levelId)),
    [opts, scene.walls, levelId],
  )
  // A9: joins are resolved ONCE per level, not per wall — a corner's answer depends on every
  // member of the junction, so a per-wall resolve would redo the same graph walk N times.
  const joins = useMemo(() => resolveWallJoins(scene, levelId), [scene, levelId])
  return (
    <>
      {walls.map((wall) => (
        <WallMesh key={wall.id} wallId={wall.id} opts={opts} adjust={joins.get(wall.id)} />
      ))}
    </>
  )
}

function WallMesh({
  wallId,
  opts,
  adjust,
}: {
  wallId: string
  opts: RenderOpts
  adjust: WallEndAdjust | undefined
}) {
  const { scene, theme, selectedIds, hoveredId, ghost } = opts
  const wall = scene.walls.find((w) => w.id === wallId)

  const boxes = useMemo(() => {
    if (!wall) return []
    const resolved = resolveWall(scene, wall)
    if (!resolved) return []
    const openings = scene.openings.filter((o) => o.hostId === wall.id)
    return wallSolidBoxes(resolved, openings, adjust)
  }, [scene, wall, adjust])

  if (!wall) return null
  const resolved = resolveWall(scene, wall)
  if (!resolved) return null

  const selected = selectedIds.includes(wallId)
  const hovered = hoveredId === wallId
  const color = materialColor(scene, resolved.material)

  return (
    // Ghosted levels and the underlay must not steal picks from the active level.
    <group {...pickProps(opts, wallId)}>
      {boxes.map((box, i) =>
        box.topRamp || box.endSkew ? (
          // A box whose faces are not all axis-aligned rectangles: a sloped top from roof voiding
          // (B1) or a mitred end from a wall join (A9). Neither is expressible as a plain
          // BoxGeometry, so both build from the same corners boxCorners() gives every other
          // consumer (box-select, the exporter) — this can never disagree with them.
          <ShapedBoxMesh
            key={i}
            box={box}
            color={color}
            selected={selected}
            hovered={hovered}
            ghost={ghost}
            theme={theme}
            underlay={opts.underlay}
          />
        ) : (
          <mesh key={i} position={box.center} rotation={[0, box.rotationY, 0]} castShadow receiveShadow>
            <boxGeometry args={box.size} />
            <meshStandardMaterial {...surfaceProps(color, selected, hovered, ghost, theme, opts.underlay)} />
            <OutlineIf show={selected && !ghost} color={theme.select} />
          </mesh>
        ),
      )}
    </group>
  )
}

function ShapedBoxMesh({
  box,
  color,
  selected,
  hovered,
  ghost,
  theme,
  underlay,
}: {
  box: Box3D
  color: string
  selected: boolean
  hovered: boolean
  ghost: boolean
  theme: CanvasTheme
  underlay?: boolean
}) {
  // boxCorners() already bakes in this box's world position and rotation (unlike boxGeometry,
  // which relies on the mesh's own position/rotation props), so this mesh sets neither.
  const geom = useMemo(() => triMeshToGeometry(boxToTriMesh(box)), [box])
  useEffect(() => () => geom.dispose(), [geom])
  return (
    <mesh geometry={geom} castShadow receiveShadow>
      <meshStandardMaterial {...surfaceProps(color, selected, hovered, ghost, theme, underlay)} />
      <OutlineIf show={selected && !ghost} color={theme.select} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// Doors & windows (the fillings)
// ---------------------------------------------------------------------------

export function Fillings({ opts, levelId }: { opts: RenderOpts; levelId: string }) {
  const { scene } = opts
  const items = useMemo(() => {
    // A filling has no level of its own: it follows its host wall, which also means it follows
    // that wall into whichever plan-region partition the wall landed in (C7).
    const hosts = visible(opts, scene.walls.filter((w) => w.levelId === levelId))
    const wallIds = new Set(hosts.map((w) => w.id))
    return scene.fillings.filter((f) => {
      const o = scene.openings.find((x) => x.id === f.openingId)
      return o ? wallIds.has(o.hostId) : false
    })
  }, [opts, scene, levelId])

  return (
    <>
      {items.map((f) => (
        <FillingMesh key={f.id} filling={f} opts={opts} />
      ))}
    </>
  )
}

function FillingMesh({ filling, opts }: { filling: Filling; opts: RenderOpts }) {
  const { scene, theme, selectedIds, hoveredId, ghost } = opts

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
      {...pickProps(opts, filling.id)}
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

function polygonToShape(polygon: Vec2[], holes: Vec2[][] = []): THREE.Shape {
  // THREE.Shape winds CCW; flip a CW polygon so normals point up.
  const pts = polygonArea(polygon) < 0 ? [...polygon].reverse() : polygon
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  // Holes (B8) must wind OPPOSITE the outer boundary — the outer is now CCW, so every hole is
  // flipped to CW, regardless of how the user happened to draw it.
  for (const hole of holes) {
    const hpts = polygonArea(hole) > 0 ? [...hole].reverse() : hole
    shape.holes.push(new THREE.Path(hpts.map(([x, y]) => new THREE.Vector2(x, y))))
  }
  return shape
}

export function Slabs({ opts, levelId }: { opts: RenderOpts; levelId: string }) {
  const { scene } = opts
  const slabs = useMemo(
    () => visible(opts, scene.slabs.filter((s) => s.levelId === levelId)),
    [opts, scene.slabs, levelId],
  )
  return (
    <>
      {slabs.map((s) => (
        <SlabMesh key={s.id} slabId={s.id} opts={opts} />
      ))}
    </>
  )
}

function SlabMesh({ slabId, opts }: { slabId: string; opts: RenderOpts }) {
  const { scene, theme, selectedIds, hoveredId, ghost } = opts
  const slab = scene.slabs.find((s) => s.id === slabId)

  const built = useMemo(() => {
    if (!slab) return null
    const resolved = resolveSlab(scene, slab)
    if (!resolved) return null
    // Openings/shafts (B8): THREE.Shape holes cut cleanly through the whole extrusion — the top
    // AND bottom caps skip the hole and its walls are built automatically, so a shaft reads as a
    // real through-cut rather than a decal on the surface.
    const shape = polygonToShape(resolved.boundary, resolved.openings)
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
      {...pickProps(opts, slabId)}
    >
      <meshStandardMaterial {...surfaceProps(color, selected, hovered, ghost, theme, opts.underlay)} />
      <OutlineIf show={selected && !ghost} color={theme.select} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// Ceilings — extruded boundary polygons anchored at the BOTTOM face (B5)
// ---------------------------------------------------------------------------

export function Ceilings({ opts, levelId }: { opts: RenderOpts; levelId: string }) {
  const { scene } = opts
  const ceilings = useMemo(
    () => visible(opts, scene.ceilings.filter((c) => c.levelId === levelId)),
    [opts, scene.ceilings, levelId],
  )
  return (
    <>
      {ceilings.map((c) => (
        <CeilingMesh key={c.id} ceilingId={c.id} opts={opts} />
      ))}
    </>
  )
}

function CeilingMesh({ ceilingId, opts }: { ceilingId: string; opts: RenderOpts }) {
  const { scene, theme, selectedIds, hoveredId, ghost } = opts
  const ceiling = scene.ceilings.find((c) => c.id === ceilingId)

  const built = useMemo(() => {
    if (!ceiling) return null
    const resolved = resolveCeiling(scene, ceiling)
    if (!resolved) return null
    const shape = polygonToShape(resolved.boundary)
    const geom = new THREE.ExtrudeGeometry(shape, { depth: resolved.thickness, bevelEnabled: false })
    // Same extrusion as a slab (grows downward from the mesh's own Y position once rotated), but
    // positioned at the STRUCTURAL top (bottomElevation + thickness) so it extrudes down to the
    // finished bottom face — the mirror of how a slab extrudes down from its stored top.
    geom.rotateX(Math.PI / 2)
    geom.computeVertexNormals()
    return { geom, resolved }
  }, [scene, ceiling])

  useDisposeGeometry(built?.geom)
  if (!built || !ceiling) return null

  const selected = selectedIds.includes(ceilingId)
  const hovered = hoveredId === ceilingId
  const color = materialColor(scene, built.resolved.material)

  return (
    <mesh
      geometry={built.geom}
      position={[0, built.resolved.bottomElevation + built.resolved.thickness, 0]}
      receiveShadow
      castShadow
      {...pickProps(opts, ceilingId)}
    >
      <meshStandardMaterial {...surfaceProps(color, selected, hovered, ghost, theme, opts.underlay)} />
      <OutlineIf show={selected && !ghost} color={theme.select} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// Rooms — a thin floor plate + an area label
// ---------------------------------------------------------------------------

export function Rooms({ opts, levelId }: { opts: RenderOpts; levelId: string }) {
  const { scene } = opts
  const rooms = useMemo(
    () => visible(opts, scene.rooms.filter((r) => r.levelId === levelId)),
    [opts, scene.rooms, levelId],
  )
  return (
    <>
      {rooms.map((r) => (
        <RoomMesh key={r.id} roomId={r.id} opts={opts} />
      ))}
    </>
  )
}

function RoomMesh({ roomId, opts }: { roomId: string; opts: RenderOpts }) {
  const { scene, theme, selectedIds, hoveredId, ghost } = opts
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
      {...pickProps(opts, roomId)}
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
  const { scene, theme, selectedIds, hoveredId, ghost } = opts
  const columns = useMemo(
    () => visible(opts, scene.columns.filter((c) => c.levelId === levelId)),
    [opts, scene.columns, levelId],
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
            {...pickProps(opts, col.id)}
          >
            {round ? (
              <cylinderGeometry args={[w / 2, w / 2, box.size[1], 24]} />
            ) : (
              <boxGeometry args={[w, box.size[1], d]} />
            )}
            <meshStandardMaterial
              {...surfaceProps(materialColor(scene, type.material), selected, hovered, ghost, theme, opts.underlay)}
            />
            <OutlineIf show={selected && !ghost} color={theme.select} />
          </mesh>
        )
      })}
    </>
  )
}

export function Beams({ opts, levelId }: { opts: RenderOpts; levelId: string }) {
  const { scene, theme, selectedIds, hoveredId, ghost } = opts
  const beams = useMemo(
    () => visible(opts, scene.beams.filter((b) => b.levelId === levelId)),
    [opts, scene.beams, levelId],
  )
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
            {...pickProps(opts, beam.id)}
          >
            <boxGeometry args={box.size} />
            <meshStandardMaterial
              {...surfaceProps(materialColor(scene, type.material), selected, hovered, ghost, theme, opts.underlay)}
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
  const { scene, theme, selectedIds, hoveredId, ghost } = opts
  const items = useMemo(
    () => visible(opts, scene.furniture.filter((f) => f.levelId === levelId)),
    [opts, scene.furniture, levelId],
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
            {...pickProps(opts, item.id)}
          >
            <boxGeometry args={[fw, h, fd]} />
            <meshStandardMaterial
              {...surfaceProps(materialColor(scene, type.material), selected, hovered, ghost, theme, opts.underlay)}
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

// ---------------------------------------------------------------------------
// Curtain walls (B4)
// ---------------------------------------------------------------------------

/**
 * Framing and glazing come from `curtainWallSolidBoxes` already split by material, so this
 * renderer never re-derives which box is which — the same list the exporter draws from.
 */
export function CurtainWalls({ opts, levelId }: { opts: RenderOpts; levelId: string }) {
  const { scene } = opts
  const items = useMemo(
    () => visible(opts, scene.curtainWalls.filter((c) => c.levelId === levelId)),
    [opts, scene.curtainWalls, levelId],
  )
  return (
    <>
      {items.map((cw) => (
        <CurtainWallMesh key={cw.id} curtainWallId={cw.id} opts={opts} />
      ))}
    </>
  )
}

function CurtainWallMesh({
  curtainWallId,
  opts,
}: {
  curtainWallId: string
  opts: RenderOpts
}) {
  const { scene, theme, selectedIds, hoveredId, ghost } = opts
  const cw = scene.curtainWalls.find((c) => c.id === curtainWallId)

  const solids = useMemo(() => {
    if (!cw) return null
    const resolved = resolveCurtainWall(scene, cw)
    return resolved ? { ...curtainWallSolidBoxes(resolved), type: resolved.type } : null
  }, [scene, cw])

  if (!cw || !solids) return null

  const selected = selectedIds.includes(curtainWallId)
  const hovered = hoveredId === curtainWallId
  const frameColor = materialColor(scene, solids.type.mullionMaterial)
  const panelColor = materialColor(scene, solids.type.panelMaterial)

  return (
    <group {...pickProps(opts, curtainWallId)}>
      {solids.frame.map((box, i) => (
        <mesh
          key={`f${i}`}
          position={box.center}
          rotation={[0, box.rotationY, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={box.size} />
          <meshStandardMaterial
            {...surfaceProps(frameColor, selected, hovered, ghost, theme, opts.underlay)}
          />
          <OutlineIf show={selected && !ghost} color={theme.select} />
        </mesh>
      ))}
      {solids.panels.map((box, i) => (
        <mesh key={`p${i}`} position={box.center} rotation={[0, box.rotationY, 0]} receiveShadow>
          <boxGeometry args={box.size} />
          <meshStandardMaterial
            {...surfaceProps(panelColor, selected, hovered, ghost, theme, opts.underlay)}
            // Glazing is glazing: translucent unless the underlay branch has already taken over
            // the material entirely.
            transparent
            opacity={opts.underlay ? 0.28 : ghost ? 0.14 : 0.4}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}
