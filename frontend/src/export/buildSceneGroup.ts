/**
 * Build a THREE.Group from the scene graph for export.
 *
 * This calls the SAME shared geometry functions as the viewport (`wallSolidBoxes`, `resolveWall`,
 * `resolveSlab`, `columnSolid`, `beamSolid`), so what the user sees on screen and what lands in
 * the GLB/OBJ/STL are derived from one source and cannot disagree.
 */
import * as THREE from 'three'
import {
  resolveWall,
  resolveSlab,
  resolveCeiling,
  wallSolidBoxes,
  boxToTriMesh,
  columnSolid,
  beamSolid,
  polygonArea,
  baselinePointAt,
  rotationYFor,
  profileExtents,
  type Box3D,
} from '../../../shared/geometry/index'
import { triMeshToGeometry } from '../scene/geometryUtils'
import { resolveRoof, isRoofError } from '../../../shared/geometry/roof'
import { resolveWallJoins } from '../../../shared/geometry/wallJoin'
import {
  curtainWallSolidBoxes,
  resolveCurtainWall,
} from '../../../shared/geometry/curtainWall'
import { resolveStair, stairSolidBoxes } from '../../../shared/geometry/stair'
import { resolveRailing, railingSolidBoxes } from '../../../shared/geometry/railing'
import {
  freePrimitives,
  rootBooleanNodes,
} from '../../../shared/geometry/booleanTree'
import {
  findLevel,
  findType,
  findPrimitiveType,
  type SceneGraph,
  type Vec2,
  type Vec3,
} from '../../../shared/types/scene'
import {
  evaluateBooleanGeometry,
  isBooleanEvalError,
  primitiveWorldGeometry,
  type CsgModule,
} from '../geometry/evaluateBoolean'
import { materialColor } from '../scene/materials'

/** Cache one material per colour so the exported file doesn't carry hundreds of duplicates. */
function materialCache(): (color: string, opts?: { transparent?: boolean }) => THREE.Material {
  const cache = new Map<string, THREE.Material>()
  return (color, opts) => {
    const key = `${color}|${opts?.transparent ? 't' : 'o'}`
    const existing = cache.get(key)
    if (existing) return existing
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: opts?.transparent ? 0.1 : 0.85,
      metalness: 0.02,
      transparent: opts?.transparent ?? false,
      opacity: opts?.transparent ? 0.4 : 1,
    })
    cache.set(key, mat)
    return mat
  }
}

function boxMesh(box: Box3D, material: THREE.Material, name: string): THREE.Mesh {
  // A box whose faces are not all axis-aligned rectangles: a sloped top from roof voiding (B1) or
  // a mitred end from a wall join (A9). Built from the SAME boxCorners() every other consumer uses
  // (the viewport, box-select), so the exported mesh cannot disagree with what is on screen.
  if (box.topRamp || box.endSkew) {
    const mesh = new THREE.Mesh(triMeshToGeometry(boxToTriMesh(box)), material)
    mesh.name = name
    return mesh
  }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...box.size), material)
  mesh.position.set(...box.center)
  mesh.rotation.y = box.rotationY
  mesh.name = name
  return mesh
}

function polygonToShape(polygon: Vec2[], holes: Vec2[][] = []): THREE.Shape {
  const pts = polygonArea(polygon) < 0 ? [...polygon].reverse() : polygon
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  for (const hole of holes) {
    const hpts = polygonArea(hole) > 0 ? [...hole].reverse() : hole
    shape.holes.push(new THREE.Path(hpts.map(([x, y]) => new THREE.Vector2(x, y))))
  }
  return shape
}

/** Triangulate `resolveRoof`'s planar faces — the same conversion `viewport/Roofs.tsx` performs. */
function roofFacesToGeometry(faces: { vertices: Vec3[] }[]): THREE.BufferGeometry {
  const positions: number[] = []
  for (const face of faces) {
    const [a, b, c, d] = face.vertices
    positions.push(...a, ...b, ...c)
    if (d) positions.push(...a, ...c, ...d)
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.computeVertexNormals()
  return geom
}

/**
 * Build the export group.
 *
 * `csg` is the lazily-loaded `three-bvh-csg` module (DECISIONS.md D-019). It is optional so this
 * function stays synchronous: `exportScene` loads it only when the scene actually contains a
 * boolean node. Without it, boolean results are omitted rather than exported wrong — and
 * `exportScene` never calls this without it when booleans exist.
 */
export function buildSceneGroup(scene: SceneGraph, csg?: CsgModule): THREE.Group {
  const root = new THREE.Group()
  root.name = 'ArchStudioScene'
  const mat = materialCache()

  // Group by level so the exported file has a readable hierarchy.
  const levelGroups = new Map<string, THREE.Group>()
  const groupFor = (levelId: string): THREE.Group => {
    const existing = levelGroups.get(levelId)
    if (existing) return existing
    const g = new THREE.Group()
    g.name = findLevel(scene, levelId)?.name ?? levelId
    levelGroups.set(levelId, g)
    root.add(g)
    return g
  }

  // ---- Walls (openings cut out by box decomposition, corners cleaned by joins) ----
  // A9: resolved once per level, exactly as `viewport/Elements.tsx` does — same function, same
  // input, so the exported corner is the corner on screen.
  const joinsByLevel = new Map<string, ReturnType<typeof resolveWallJoins>>()
  const joinFor = (levelId: string, wallId: string) => {
    let m = joinsByLevel.get(levelId)
    if (!m) {
      m = resolveWallJoins(scene, levelId)
      joinsByLevel.set(levelId, m)
    }
    return m.get(wallId)
  }

  for (const wall of scene.walls) {
    const resolved = resolveWall(scene, wall)
    if (!resolved) continue
    const openings = scene.openings.filter((o) => o.hostId === wall.id)
    const boxes = wallSolidBoxes(resolved, openings, joinFor(wall.levelId, wall.id))
    const material = mat(materialColor(scene, resolved.material))
    const g = groupFor(wall.levelId)
    boxes.forEach((box, i) => g.add(boxMesh(box, material, `wall:${wall.id}:${i}`)))
  }

  // ---- Doors & windows ----
  for (const filling of scene.fillings) {
    const opening = scene.openings.find((o) => o.id === filling.openingId)
    if (!opening) continue
    const wall = scene.walls.find((w) => w.id === opening.hostId)
    if (!wall) continue
    const resolved = resolveWall(scene, wall)
    if (!resolved) continue
    const type = findType(scene, filling.typeId)
    if (!type || (type.category !== 'door' && type.category !== 'window')) continue

    const at = baselinePointAt(resolved.centerline, opening.offset + opening.width / 2)
    const rotationY = rotationYFor(at.tangent)
    const yMid = resolved.baseElevation + opening.sillHeight + opening.height / 2
    const g = groupFor(wall.levelId)

    const holder = new THREE.Group()
    holder.position.set(at.point[0], yMid, at.point[1])
    holder.rotation.y = rotationY
    holder.name = `${type.category}:${filling.id}`

    if (type.category === 'door') {
      const leafT = Math.min(type.thickness, resolved.thickness * 0.5)
      const leaf = new THREE.Mesh(
        new THREE.BoxGeometry(opening.width * 0.96, opening.height * 0.98, leafT),
        mat(materialColor(scene, type.panelMaterial)),
      )
      leaf.name = `leaf:${filling.id}`
      holder.add(leaf)
    } else {
      const ft = type.frameThickness
      const depth = Math.min(resolved.thickness * 0.7, 0.09)
      const w = opening.width
      const h = opening.height
      const frame = mat(materialColor(scene, type.frameMaterial))
      const glass = mat(materialColor(scene, type.glassMaterial), { transparent: true })
      const add = (sx: number, sy: number, sz: number, px: number, py: number, m: THREE.Material) => {
        const piece = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m)
        piece.position.set(px, py, 0)
        holder.add(piece)
      }
      add(w, ft, depth, 0, h / 2 - ft / 2, frame)
      add(w, ft, depth, 0, -h / 2 + ft / 2, frame)
      add(ft, h - 2 * ft, depth, -w / 2 + ft / 2, 0, frame)
      add(ft, h - 2 * ft, depth, w / 2 - ft / 2, 0, frame)
      add(w - 2 * ft, h - 2 * ft, 0.008, 0, 0, glass)
      const verticalMullions =
        type.partitioning === 'double-vertical' ? 1 : type.partitioning === 'triple-vertical' ? 2 : 0
      for (let i = 1; i <= verticalMullions; i++) {
        add(ft * 0.7, h - 2 * ft, depth, -w / 2 + (w * i) / (verticalMullions + 1), 0, frame)
      }
      if (type.partitioning === 'double-horizontal') {
        add(w - 2 * ft, ft * 0.7, depth, 0, 0, frame)
      }
    }
    g.add(holder)
  }

  // ---- Slabs (openings/shafts cut as THREE.Shape holes, B8) ----
  for (const slab of scene.slabs) {
    const resolved = resolveSlab(scene, slab)
    if (!resolved) continue
    const geom = new THREE.ExtrudeGeometry(polygonToShape(resolved.boundary, resolved.openings), {
      depth: resolved.thickness,
      bevelEnabled: false,
    })
    geom.rotateX(Math.PI / 2)
    geom.computeVertexNormals()
    const mesh = new THREE.Mesh(geom, mat(materialColor(scene, resolved.material)))
    mesh.position.y = resolved.topElevation
    mesh.name = `slab:${slab.id}`
    groupFor(slab.levelId).add(mesh)
  }

  // ---- Ceilings (B5) — anchored at the bottom face, the mirror of a slab's top anchor ----
  for (const ceiling of scene.ceilings) {
    const resolved = resolveCeiling(scene, ceiling)
    if (!resolved) continue
    const geom = new THREE.ExtrudeGeometry(polygonToShape(resolved.boundary), {
      depth: resolved.thickness,
      bevelEnabled: false,
    })
    geom.rotateX(Math.PI / 2)
    geom.computeVertexNormals()
    const mesh = new THREE.Mesh(geom, mat(materialColor(scene, resolved.material)))
    mesh.position.y = resolved.bottomElevation + resolved.thickness
    mesh.name = `ceiling:${ceiling.id}`
    groupFor(ceiling.levelId).add(mesh)
  }

  // ---- Room floors (thin plates, so exported models still read as rooms) ----
  for (const room of scene.rooms) {
    if (room.polygon.length < 3) continue
    const level = findLevel(scene, room.levelId)
    if (!level) continue
    const geom = new THREE.ShapeGeometry(polygonToShape(room.polygon))
    geom.rotateX(Math.PI / 2)
    const mesh = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({
        color: materialColor(scene, room.floorMaterial),
        side: THREE.DoubleSide,
        roughness: 0.9,
      }),
    )
    mesh.position.y = level.elevation + room.baseOffset + 0.005
    mesh.name = `room:${room.id}`
    groupFor(room.levelId).add(mesh)
  }

  // ---- Columns ----
  for (const column of scene.columns) {
    const box = columnSolid(scene, column)
    const type = findType(scene, column.typeId)
    if (!box || !type || type.category !== 'column') continue
    const material = mat(materialColor(scene, type.material))
    const [w] = profileExtents(type.profile)
    const geom =
      type.profile.kind === 'circular'
        ? new THREE.CylinderGeometry(w / 2, w / 2, box.size[1], 24)
        : new THREE.BoxGeometry(...box.size)
    const mesh = new THREE.Mesh(geom, material)
    mesh.position.set(...box.center)
    mesh.rotation.y = box.rotationY
    mesh.name = `column:${column.id}`
    groupFor(column.levelId).add(mesh)
  }

  // ---- Beams ----
  for (const beam of scene.beams) {
    const box = beamSolid(scene, beam)
    const type = findType(scene, beam.typeId)
    if (!box || !type || type.category !== 'beam') continue
    const mesh = boxMesh(box, mat(materialColor(scene, type.material)), `beam:${beam.id}`)
    mesh.rotation.z = (beam.crossSectionRotation * Math.PI) / 180
    groupFor(beam.levelId).add(mesh)
  }

  // ---- Furniture (placeholder boxes until the Phase 5 glTF catalog) ----
  for (const item of scene.furniture) {
    const type = findType(scene, item.typeId)
    const level = findLevel(scene, item.levelId)
    if (!type || type.category !== 'furniture' || !level) continue
    const [fw, fd] = type.footprint
    const h = type.heightMeters
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(fw, h, fd),
      mat(materialColor(scene, type.material)),
    )
    mesh.position.set(
      item.position[0],
      level.elevation + item.heightOffset + (h * item.scale) / 2,
      item.position[1],
    )
    mesh.rotation.y = (-item.rotation * Math.PI) / 180
    mesh.scale.setScalar(item.scale)
    mesh.name = `furniture:${item.id}`
    groupFor(item.levelId).add(mesh)
  }

  // ---- Roofs ----
  // These were missing until B7: the viewport drew a roof that no exported file contained, which
  // broke the one-geometry rule the rest of this file exists to uphold. Same `resolveRoof` the
  // renderer calls, so the two cannot diverge. A roof that refuses to resolve (D-018) exports
  // nothing, exactly as it renders nothing.
  for (const roof of scene.roofs) {
    const resolved = resolveRoof(roof)
    if (isRoofError(resolved)) continue
    const type = findType(scene, roof.typeId)
    const color =
      type?.category === 'roof' && type.layers[0]
        ? materialColor(scene, type.layers[0].material)
        : '#8a6a4a'
    const mesh = new THREE.Mesh(roofFacesToGeometry(resolved.faces), mat(color))
    mesh.name = `roof:${roof.id}`
    groupFor(roof.levelId).add(mesh)
  }

  // ---- Primitive solids (B7) ----
  // Only primitives NOT consumed by a boolean; a consumed one is exported as part of its result.
  for (const primitive of freePrimitives(scene)) {
    const geom = primitiveWorldGeometry(scene, primitive)
    if (isBooleanEvalError(geom)) continue
    const type = findPrimitiveType(scene, primitive.typeId)
    const mesh = new THREE.Mesh(geom, mat(materialColor(scene, type?.material ?? 'mat-concrete')))
    mesh.name = `primitive:${primitive.id}`
    groupFor(primitive.levelId).add(mesh)
  }

  // ---- Boolean results (B7) ----
  if (csg) {
    for (const node of rootBooleanNodes(scene)) {
      const geom = evaluateBooleanGeometry(scene, node.id, csg)
      if (isBooleanEvalError(geom)) continue
      const first = scene.primitives.find((p) => p.id === node.operandIds[0])
      const type = first ? findPrimitiveType(scene, first.typeId) : undefined
      const mesh = new THREE.Mesh(geom, mat(materialColor(scene, type?.material ?? 'mat-concrete')))
      mesh.name = `boolean:${node.id}`
      groupFor(node.levelId).add(mesh)
    }
  }

  // ---- Stairs (B2) ----
  for (const stair of scene.stairs) {
    const resolved = resolveStair(scene, stair)
    if (!resolved) continue
    const boxes = stairSolidBoxes(resolved)
    const material = mat(materialColor(scene, resolved.material))
    const g = groupFor(stair.levelId)
    boxes.forEach((box, i) => g.add(boxMesh(box, material, `stair:${stair.id}:${i}`)))
  }

  // ---- Railings (B3) ----
  for (const railing of scene.railings) {
    const resolved = resolveRailing(scene, railing)
    if (!resolved) continue
    const boxes = railingSolidBoxes(resolved)
    const material = mat(materialColor(scene, resolved.material))
    const g = groupFor(railing.levelId)
    boxes.forEach((box, i) => g.add(boxMesh(box, material, `railing:${railing.id}:${i}`)))
  }

  // ---- Curtain walls (B4) ----
  // Framing and glazing come back already split by material, so the exported file has the same
  // two-material structure the viewport draws — neither side re-derives which box is which.
  for (const cw of scene.curtainWalls) {
    const resolved = resolveCurtainWall(scene, cw)
    if (!resolved) continue
    const { frame, panels } = curtainWallSolidBoxes(resolved)
    const g = groupFor(cw.levelId)
    const frameMat = mat(materialColor(scene, resolved.type.mullionMaterial))
    const panelMat = mat(materialColor(scene, resolved.type.panelMaterial), { transparent: true })
    frame.forEach((box, i) => g.add(boxMesh(box, frameMat, `curtainwall:${cw.id}:mullion:${i}`)))
    panels.forEach((box, i) => g.add(boxMesh(box, panelMat, `curtainwall:${cw.id}:panel:${i}`)))
  }

  return root
}

/** Free the geometry a built group owns. Call after exporting so a big model doesn't linger. */
export function disposeSceneGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
  })
}
