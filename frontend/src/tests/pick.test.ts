/**
 * Screen → world picking. This is the riskiest seam in a 3D-native editor: if a pointer position
 * resolves to the wrong scene coordinate, everything downstream is wrong. Tested with real
 * three.js cameras so it does not depend on a compositing canvas.
 */
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { ndcFromClient, rayFromNDC, pickWorkPlane, worldPerPixel } from '../viewport/pick'
import { levelWorkPlane, faceWorkPlane } from '../../../shared/geometry/workplane'

const RECT = { left: 0, top: 0, width: 800, height: 600 }

/** A perspective camera looking straight down at the origin from 20 m up. */
function topDownPerspective(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, RECT.width / RECT.height, 0.1, 1000)
  cam.position.set(0, 20, 0)
  cam.up.set(0, 0, -1)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)
  return cam
}

/** A perspective camera at an iso-style angle. */
function isoPerspective(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, RECT.width / RECT.height, 0.1, 1000)
  cam.position.set(14, 12, 16)
  cam.up.set(0, 1, 0)
  cam.lookAt(3, 1, 3)
  cam.updateMatrixWorld(true)
  return cam
}

function topDownOrtho(halfHeight = 12): THREE.OrthographicCamera {
  const aspect = RECT.width / RECT.height
  const cam = new THREE.OrthographicCamera(
    -halfHeight * aspect,
    halfHeight * aspect,
    halfHeight,
    -halfHeight,
    -500,
    1000,
  )
  cam.position.set(0, 60, 0)
  cam.up.set(0, 0, -1)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)
  return cam
}

describe('ndcFromClient', () => {
  it('maps the viewport centre to the NDC origin', () => {
    const ndc = ndcFromClient(400, 300, RECT)
    expect(ndc.x).toBeCloseTo(0)
    expect(ndc.y).toBeCloseTo(0)
  })

  it('maps the corners to the NDC extremes, with Y flipped', () => {
    expect(ndcFromClient(0, 0, RECT).x).toBeCloseTo(-1)
    expect(ndcFromClient(0, 0, RECT).y).toBeCloseTo(1) // top-left is +Y in NDC
    expect(ndcFromClient(800, 600, RECT).x).toBeCloseTo(1)
    expect(ndcFromClient(800, 600, RECT).y).toBeCloseTo(-1)
  })

  it('accounts for a rect that is offset in the page', () => {
    const offset = { left: 100, top: 50, width: 800, height: 600 }
    const ndc = ndcFromClient(500, 350, offset)
    expect(ndc.x).toBeCloseTo(0)
    expect(ndc.y).toBeCloseTo(0)
  })
})

describe('rayFromNDC', () => {
  it('produces a normalized direction', () => {
    const ray = rayFromNDC(isoPerspective(), ndcFromClient(400, 300, RECT))
    const len = Math.hypot(...ray.direction)
    expect(len).toBeCloseTo(1)
  })

  it('starts a perspective ray at the camera position', () => {
    const cam = isoPerspective()
    const ray = rayFromNDC(cam, ndcFromClient(400, 300, RECT))
    expect(ray.origin[0]).toBeCloseTo(cam.position.x)
    expect(ray.origin[1]).toBeCloseTo(cam.position.y)
    expect(ray.origin[2]).toBeCloseTo(cam.position.z)
  })
})

describe('pickWorkPlane — the pointer → scene-coordinate seam', () => {
  it('maps the centre of a top-down view to the plane origin', () => {
    const pick = pickWorkPlane(topDownPerspective(), ndcFromClient(400, 300, RECT), levelWorkPlane('lv', 'L', 0))
    expect(pick).not.toBeNull()
    expect(pick!.scene2D![0]).toBeCloseTo(0, 5)
    expect(pick!.scene2D![1]).toBeCloseTo(0, 5)
    expect(pick!.world[1]).toBeCloseTo(0, 5)
  })

  it('lands on the level elevation, not on y=0', () => {
    const pick = pickWorkPlane(topDownPerspective(), ndcFromClient(400, 300, RECT), levelWorkPlane('lv', 'L2', 2.8))
    expect(pick!.world[1]).toBeCloseTo(2.8, 5)
  })

  it('moves right on screen → +X in the scene (top-down, north-up)', () => {
    const cam = topDownPerspective()
    const plane = levelWorkPlane('lv', 'L', 0)
    const centre = pickWorkPlane(cam, ndcFromClient(400, 300, RECT), plane)!
    const right = pickWorkPlane(cam, ndcFromClient(600, 300, RECT), plane)!
    expect(right.scene2D![0]).toBeGreaterThan(centre.scene2D![0])
    expect(right.scene2D![1]).toBeCloseTo(centre.scene2D![1], 5)
  })

  it('moves up on screen → -Y in the scene (screen up is north)', () => {
    const cam = topDownPerspective()
    const plane = levelWorkPlane('lv', 'L', 0)
    const centre = pickWorkPlane(cam, ndcFromClient(400, 300, RECT), plane)!
    const up = pickWorkPlane(cam, ndcFromClient(400, 100, RECT), plane)!
    expect(up.scene2D![1]).toBeLessThan(centre.scene2D![1])
    expect(up.scene2D![0]).toBeCloseTo(centre.scene2D![0], 5)
  })

  it('works from an iso camera and stays on the plane', () => {
    const pick = pickWorkPlane(isoPerspective(), ndcFromClient(400, 300, RECT), levelWorkPlane('lv', 'L', 0))
    expect(pick).not.toBeNull()
    expect(pick!.world[1]).toBeCloseTo(0, 6)
    // Looking at (3,1,3) from (14,12,16), the centre ray must land in the +X/+Z quadrant.
    expect(pick!.scene2D![0]).toBeGreaterThan(0)
    expect(pick!.scene2D![1]).toBeGreaterThan(0)
  })

  it('works with an orthographic camera', () => {
    const pick = pickWorkPlane(topDownOrtho(), ndcFromClient(400, 300, RECT), levelWorkPlane('lv', 'L', 0))
    expect(pick).not.toBeNull()
    expect(pick!.scene2D![0]).toBeCloseTo(0, 5)
    expect(pick!.scene2D![1]).toBeCloseTo(0, 5)
  })

  it('ortho picking is scale-correct: half-height maps to the frustum half-height', () => {
    const halfH = 12
    const cam = topDownOrtho(halfH)
    const plane = levelWorkPlane('lv', 'L', 0)
    // The top edge of the viewport should sit halfH away from the centre in scene Y.
    const top = pickWorkPlane(cam, ndcFromClient(400, 0, RECT), plane)!
    expect(Math.abs(top.scene2D![1])).toBeCloseTo(halfH, 4)
  })

  it('returns null when the ray is parallel to the plane', () => {
    const cam = new THREE.PerspectiveCamera(50, RECT.width / RECT.height, 0.1, 1000)
    cam.position.set(0, 5, 0)
    cam.up.set(0, 1, 0)
    // Look horizontally, so the centre ray never meets the horizontal plane.
    cam.lookAt(10, 5, 0)
    cam.updateMatrixWorld(true)
    expect(pickWorkPlane(cam, ndcFromClient(400, 300, RECT), levelWorkPlane('lv', 'L', 0))).toBeNull()
  })

  it('returns null when the plane is behind the camera', () => {
    const cam = new THREE.PerspectiveCamera(50, RECT.width / RECT.height, 0.1, 1000)
    cam.position.set(0, 5, 0)
    cam.up.set(0, 0, -1)
    cam.lookAt(0, 20, 0) // looking up, away from the plane below
    cam.updateMatrixWorld(true)
    expect(pickWorkPlane(cam, ndcFromClient(400, 300, RECT), levelWorkPlane('lv', 'L', 0))).toBeNull()
  })

  it('refuses scene-2D coordinates on a non-horizontal plane rather than inventing them', () => {
    const plane = faceWorkPlane([0, 1, 0], [0, 0, 1], 'w1', 'face of Wall-1')
    const pick = pickWorkPlane(isoPerspective(), ndcFromClient(400, 300, RECT), plane)
    // The ray may or may not hit; if it does, scene2D must be null for a vertical plane.
    if (pick) expect(pick.scene2D).toBeNull()
  })
})

describe('worldPerPixel', () => {
  it('shrinks as a perspective camera gets closer', () => {
    const cam = isoPerspective()
    const far = worldPerPixel(cam, [0, 0, 0], RECT.height)
    cam.position.set(4, 3, 5)
    cam.updateMatrixWorld(true)
    const near = worldPerPixel(cam, [0, 0, 0], RECT.height)
    expect(near).toBeLessThan(far)
    expect(near).toBeGreaterThan(0)
  })

  it('matches the frustum height for an orthographic camera', () => {
    const cam = topDownOrtho(12)
    // Frustum height is 24 world units across 600 px.
    expect(worldPerPixel(cam, [0, 0, 0], RECT.height)).toBeCloseTo(24 / 600, 6)
  })

  it('scales inversely with orthographic zoom', () => {
    const cam = topDownOrtho(12)
    const before = worldPerPixel(cam, [0, 0, 0], RECT.height)
    cam.zoom = 2
    cam.updateProjectionMatrix()
    expect(worldPerPixel(cam, [0, 0, 0], RECT.height)).toBeCloseTo(before / 2, 6)
  })

  it('is independent of distance for an orthographic camera', () => {
    const cam = topDownOrtho(12)
    expect(worldPerPixel(cam, [0, 0, 0], RECT.height)).toBeCloseTo(
      worldPerPixel(cam, [0, -50, 0], RECT.height),
      6,
    )
  })

  it('returns zero for a zero-height viewport instead of dividing by zero', () => {
    expect(worldPerPixel(isoPerspective(), [0, 0, 0], 0)).toBe(0)
  })

  it('gives a sane snap aperture at a normal working zoom', () => {
    // 14 px aperture on a 600 px viewport of a ~24 m frustum ≈ 0.56 m — the right order of
    // magnitude for architectural snapping (not millimetres, not metres).
    const aperture = worldPerPixel(topDownOrtho(12), [0, 0, 0], RECT.height) * 14
    expect(aperture).toBeGreaterThan(0.05)
    expect(aperture).toBeLessThan(1)
  })
})
