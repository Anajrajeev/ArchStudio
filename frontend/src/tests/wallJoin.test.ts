/**
 * Wall joins (A9 / D-026).
 *
 * The assertions that matter are geometric, not structural: a corner is only "clean" if the two
 * walls' solids actually meet along one line with no overlap ridge and no gap. So most of these
 * check real corner COORDINATES out of `boxCorners` — the same function box-select and the
 * exporter read — rather than just checking that some adjustment was produced.
 */
import { describe, it, expect } from 'vitest'
import {
  emptySceneGraph,
  type SceneGraph,
  type Wall,
  type WallJoin,
  type Vec2,
} from '../../../shared/types/scene'
import { addLevel } from '../scene/mutations'
import { boxCorners, resolveWall, wallSolidBoxes } from '../../../shared/geometry/index'
import {
  isWallJoinError,
  resolveJoin,
  resolveWallJoins,
  validateWallJoin,
} from '../../../shared/geometry/wallJoin'

const LEVEL = 'lv1'

function baseScene(): SceneGraph {
  const s = addLevel(emptySceneGraph('p'), 'Ground')
  return { ...s, levels: s.levels.map((l) => ({ ...l, id: LEVEL })) }
}

function wall(
  id: string,
  start: Vec2,
  end: Vec2,
  typeId = 'wt-ext-200',
): Wall {
  return {
    id,
    typeId,
    levelId: LEVEL,
    baseline: { kind: 'line', start, end },
    baseOffset: 0,
    top: { kind: 'unconnected', height: 3 },
    locationLine: 'centerline',
    flipped: false,
    roomBounding: true,
  }
}

function join(memberIds: string[], point: Vec2, extra: Partial<WallJoin> = {}): WallJoin {
  return {
    id: 'wj1',
    levelId: LEVEL,
    memberIds,
    point,
    style: 'miter',
    throughId: null,
    ...extra,
  }
}

function withWalls(walls: Wall[], joins: WallJoin[] = []): SceneGraph {
  return { ...baseScene(), walls, wallJoins: joins }
}

/** Every corner of every solid box a wall decomposes to, with its join applied. */
function wallCorners(scene: SceneGraph, id: string): Array<[number, number, number]> {
  const w = scene.walls.find((x) => x.id === id)!
  const resolved = resolveWall(scene, w)!
  const adjust = resolveWallJoins(scene, LEVEL).get(id)
  return wallSolidBoxes(resolved, [], adjust).flatMap((b) => boxCorners(b))
}

/** The extreme value of one axis across a wall's corners. */
function extent(
  corners: Array<[number, number, number]>,
  axis: 0 | 1 | 2,
): { min: number; max: number } {
  const vs = corners.map((c) => c[axis])
  return { min: Math.min(...vs), max: Math.max(...vs) }
}

// The default exterior type is 200mm; the interior partition is 100mm.
const T_EXT = 0.2
const T_INT = 0.1

describe('validateWallJoin', () => {
  it('accepts an ordinary two-wall corner', () => {
    const scene = withWalls([wall('w1', [0, 0], [5, 0]), wall('w2', [5, 0], [5, 4])])
    expect(validateWallJoin(scene, join(['w1', 'w2'], [5, 0]))).toBeNull()
  })

  it('refuses fewer than two walls', () => {
    const scene = withWalls([wall('w1', [0, 0], [5, 0])])
    expect(validateWallJoin(scene, join(['w1'], [5, 0]))).toMatch(/at least two/i)
  })

  it('refuses the same wall listed twice', () => {
    const scene = withWalls([wall('w1', [0, 0], [5, 0])])
    expect(validateWallJoin(scene, join(['w1', 'w1'], [5, 0]))).toMatch(/itself/i)
  })

  it('refuses more than four walls', () => {
    const walls = [
      wall('w1', [0, 0], [5, 0]),
      wall('w2', [5, 0], [10, 0]),
      wall('w3', [5, 0], [5, 4]),
      wall('w4', [5, 0], [5, -4]),
      wall('w5', [5, 0], [8, 3]),
    ]
    const scene = withWalls(walls)
    expect(
      validateWallJoin(scene, join(['w1', 'w2', 'w3', 'w4', 'w5'], [5, 0])),
    ).toMatch(/unambiguous/i)
  })

  it('refuses a curved wall, naming the reason rather than approximating', () => {
    const curved: Wall = {
      ...wall('w2', [5, 0], [5, 4]),
      baseline: { kind: 'arc', start: [5, 0], end: [5, 4], bulge: 0.4 },
    }
    const scene = withWalls([wall('w1', [0, 0], [5, 0]), curved])
    expect(validateWallJoin(scene, join(['w1', 'w2'], [5, 0]))).toMatch(/curved/i)
  })

  it('refuses walls on different levels', () => {
    const other = { ...wall('w2', [5, 0], [5, 4]), levelId: 'other' }
    const scene = withWalls([wall('w1', [0, 0], [5, 0]), other])
    expect(validateWallJoin(scene, join(['w1', 'w2'], [5, 0]))).toMatch(/same level/i)
  })

  it('refuses a wall that does not reach the join point', () => {
    const scene = withWalls([wall('w1', [0, 0], [5, 0]), wall('w2', [9, 9], [9, 12])])
    expect(validateWallJoin(scene, join(['w1', 'w2'], [5, 0]))).toMatch(/reach/i)
  })

  it('refuses a wall whose line passes through the point but only from far away', () => {
    // w2's line IS x = 5, so it passes through (5,0) — but its nearest end is 20 m up, four
    // wall-lengths away. Without the bound this would "join" with a 20 m extension.
    const scene = withWalls([wall('w1', [0, 0], [10, 0]), wall('w2', [5, 20], [5, 25])])
    expect(validateWallJoin(scene, join(['w1', 'w2'], [5, 0]))).toMatch(/reach/i)
  })

  it('refuses walls with no vertical overlap', () => {
    const high: Wall = { ...wall('w2', [5, 0], [5, 4]), baseOffset: 4 }
    const scene = withWalls([wall('w1', [0, 0], [5, 0]), high])
    expect(validateWallJoin(scene, join(['w1', 'w2'], [5, 0]))).toMatch(/overlap vertically/i)
  })

  it('refuses two collinear walls — there is no corner', () => {
    const scene = withWalls([wall('w1', [0, 0], [5, 0]), wall('w2', [5, 0], [9, 0])])
    expect(validateWallJoin(scene, join(['w1', 'w2'], [5, 0]))).toMatch(/collinear/i)
  })

  it('refuses three walls ending here with no straight run among them', () => {
    const walls = [
      wall('w1', [0, 0], [5, 0]),
      wall('w2', [5, 0], [5, 4]),
      wall('w3', [5, 0], [8, 3]),
    ]
    const scene = withWalls(walls)
    expect(validateWallJoin(scene, join(['w1', 'w2', 'w3'], [5, 0]))).toMatch(/unambiguous/i)
  })

  it('refuses a butting wall that meets the through wall at too shallow an angle', () => {
    // ~3 degrees off collinear: the crossing distance runs away and "trim to the face" stops
    // meaning anything, so this refuses instead of producing a metres-long trim.
    const walls = [
      wall('w1', [0, 0], [10, 0]),
      wall('w2', [5, 0], [15, 0.52]),
    ]
    const scene = withWalls(walls)
    const result = resolveJoin(scene, join(['w1', 'w2'], [5, 0], { style: 'butt' }))
    expect(isWallJoinError(result)).toBe(true)
  })
})

describe('L-corner, equal thickness — a true mitre', () => {
  // w1 runs east and ends at (5,0); w2 starts there and runs north. Both 200mm.
  const scene = withWalls(
    [wall('w1', [0, 0], [5, 0]), wall('w2', [5, 0], [5, 4])],
    [join(['w1', 'w2'], [5, 0])],
  )

  it('produces a 45 degree skew on each wall for a right-angle turn', () => {
    const adjusts = resolveJoin(scene, scene.wallJoins[0])
    if (isWallJoinError(adjusts)) throw new Error(adjusts.error)
    expect(Math.abs(adjusts.get('w1')!.endSkew)).toBeCloseTo(Math.PI / 4)
    expect(Math.abs(adjusts.get('w2')!.startSkew)).toBeCloseTo(Math.PI / 4)
  })

  it('leaves both walls the same nominal length — a mitre extends corners, not the run', () => {
    const adjusts = resolveJoin(scene, scene.wallJoins[0])
    if (isWallJoinError(adjusts)) throw new Error(adjusts.error)
    expect(adjusts.get('w1')!.endExtend).toBeCloseTo(0)
    expect(adjusts.get('w2')!.startExtend).toBeCloseTo(0)
  })

  it('closes the corner: the two walls share exactly the mitre line', () => {
    // The outer corner is at (5+t/2, -t/2) and the inner at (5-t/2, +t/2); both walls must reach
    // both, which is what "no gap and no overlap" means at a mitre.
    const outer: Vec2 = [5 + T_EXT / 2, -T_EXT / 2]
    const inner: Vec2 = [5 - T_EXT / 2, T_EXT / 2]
    for (const id of ['w1', 'w2']) {
      const corners = wallCorners(scene, id)
      const has = (p: Vec2) =>
        corners.some((c) => Math.abs(c[0] - p[0]) < 1e-9 && Math.abs(c[2] - p[1]) < 1e-9)
      expect(has(outer), `${id} must reach the outer corner`).toBe(true)
      expect(has(inner), `${id} must reach the inner corner`).toBe(true)
    }
  })

  it('never pushes either wall past the outer corner', () => {
    // Without the mitre, w1's square end would sit at x=5 across its whole thickness and w2's at
    // y=0 across its whole thickness — overlapping in the corner square. After the mitre neither
    // wall's material extends beyond the corner point.
    expect(extent(wallCorners(scene, 'w1'), 0).max).toBeCloseTo(5 + T_EXT / 2)
    expect(extent(wallCorners(scene, 'w2'), 2).min).toBeCloseTo(-T_EXT / 2)
  })

  it('mitres a non-right-angle turn to half the turn angle', () => {
    // A 90 degree turn gives 45; a 60 degree turn must give 30.
    const angle = (60 * Math.PI) / 180
    const tilted = withWalls(
      [
        wall('w1', [0, 0], [5, 0]),
        wall('w2', [5, 0], [5 + Math.cos(angle) * 4, Math.sin(angle) * 4]),
      ],
      [join(['w1', 'w2'], [5, 0])],
    )
    const adjusts = resolveJoin(tilted, tilted.wallJoins[0])
    if (isWallJoinError(adjusts)) throw new Error(adjusts.error)
    expect(Math.abs(adjusts.get('w1')!.endSkew)).toBeCloseTo(angle / 2)
    expect(Math.abs(adjusts.get('w2')!.startSkew)).toBeCloseTo(angle / 2)
  })

  it('handles a corner where BOTH walls end at the point', () => {
    const both = withWalls(
      [wall('w1', [0, 0], [5, 0]), wall('w2', [5, 4], [5, 0])],
      [join(['w1', 'w2'], [5, 0])],
    )
    const adjusts = resolveJoin(both, both.wallJoins[0])
    if (isWallJoinError(adjusts)) throw new Error(adjusts.error)
    expect(Math.abs(adjusts.get('w1')!.endSkew)).toBeCloseTo(Math.PI / 4)
    expect(Math.abs(adjusts.get('w2')!.endSkew)).toBeCloseTo(Math.PI / 4)
  })
})

describe('L-corner, unequal thickness — butts instead of mitring', () => {
  // 200mm meeting 100mm. A single skew per end cannot close this corner, so D-026 butts it.
  const scene = withWalls(
    [wall('w1', [0, 0], [5, 0]), wall('w2', [5, 0], [5, 4], 'wt-int-100')],
    [join(['w1', 'w2'], [5, 0])],
  )

  it('produces no skew at all', () => {
    const adjusts = resolveJoin(scene, scene.wallJoins[0])
    if (isWallJoinError(adjusts)) throw new Error(adjusts.error)
    expect(adjusts.get('w1')!.endSkew).toBe(0)
    expect(adjusts.get('w2')!.startSkew).toBe(0)
  })

  it('runs the THICKER wall through, extending it to the thin wall’s far face', () => {
    const adjusts = resolveJoin(scene, scene.wallJoins[0])
    if (isWallJoinError(adjusts)) throw new Error(adjusts.error)
    expect(adjusts.get('w1')!.endExtend).toBeCloseTo(T_INT / 2)
  })

  it('trims the thinner wall back to the thick wall’s near face', () => {
    const adjusts = resolveJoin(scene, scene.wallJoins[0])
    if (isWallJoinError(adjusts)) throw new Error(adjusts.error)
    // Negative on `startExtend` pulls the start forward along the wall's own direction.
    expect(adjusts.get('w2')!.startExtend).toBeCloseTo(-T_EXT / 2)
  })

  it('leaves the corner filled and the two solids meeting exactly at a face', () => {
    // w1 now reaches x = 5 + 0.05 (the thin wall's far face); w2 now starts at y = +0.1
    // (the thick wall's near face). No gap, no material outside the corner.
    expect(extent(wallCorners(scene, 'w1'), 0).max).toBeCloseTo(5 + T_INT / 2)
    expect(extent(wallCorners(scene, 'w2'), 2).min).toBeCloseTo(T_EXT / 2)
  })

  it('honours an explicit throughId over the thicker-wall default', () => {
    const forced = {
      ...scene,
      wallJoins: [{ ...scene.wallJoins[0], throughId: 'w2' }],
    }
    const adjusts = resolveJoin(forced, forced.wallJoins[0])
    if (isWallJoinError(adjusts)) throw new Error(adjusts.error)
    // Now the THIN wall runs through and the thick one trims back.
    expect(adjusts.get('w2')!.startExtend).toBeCloseTo(T_EXT / 2)
    expect(adjusts.get('w1')!.endExtend).toBeCloseTo(-T_INT / 2)
  })

  it('butts an equal-thickness corner too when the style says so', () => {
    const butted = withWalls(
      [wall('w1', [0, 0], [5, 0]), wall('w2', [5, 0], [5, 4])],
      [join(['w1', 'w2'], [5, 0], { style: 'butt' })],
    )
    const adjusts = resolveJoin(butted, butted.wallJoins[0])
    if (isWallJoinError(adjusts)) throw new Error(adjusts.error)
    expect(adjusts.get('w1')!.endSkew).toBe(0)
    expect(adjusts.get('w2')!.startSkew).toBe(0)
  })
})

describe('T-junction', () => {
  it('butts a stem into a wall it meets mid-span, leaving the through wall alone', () => {
    const scene = withWalls(
      [wall('w1', [0, 0], [10, 0]), wall('w2', [5, 0], [5, 4])],
      [join(['w1', 'w2'], [5, 0], { style: 'butt' })],
    )
    const adjusts = resolveJoin(scene, scene.wallJoins[0])
    if (isWallJoinError(adjusts)) throw new Error(adjusts.error)
    expect(adjusts.has('w1')).toBe(false) // the through wall is untouched
    expect(adjusts.get('w2')!.startExtend).toBeCloseTo(-T_EXT / 2)
    expect(adjusts.get('w2')!.startSkew).toBe(0)
  })

  it('extends a stem that stops SHORT of the wall, closing the gap', () => {
    // The stem's end sits 300mm away from the through wall's centerline. The join point is where
    // they SHOULD meet — on the through wall — which is why the stem classifies off its line, not
    // off its endpoint.
    const scene = withWalls(
      [wall('w1', [0, 0], [10, 0]), wall('w2', [5, 0.3], [5, 4])],
      [join(['w1', 'w2'], [5, 0], { style: 'butt' })],
    )
    const adjusts = resolveJoin(scene, scene.wallJoins[0])
    if (isWallJoinError(adjusts)) throw new Error(adjusts.error)
    // It must grow by 300mm minus the half-thickness it stops short of: 0.3 - 0.1 = 0.2.
    expect(adjusts.get('w2')!.startExtend).toBeCloseTo(0.2)
    expect(extent(wallCorners(scene, 'w2'), 2).min).toBeCloseTo(T_EXT / 2)
  })

  it('treats a SPLIT through-wall (two collinear walls ending here) as the through run', () => {
    // The realistic T after using the Split verb: three walls all terminating at the point.
    const scene = withWalls(
      [
        wall('w1', [0, 0], [5, 0]),
        wall('w2', [5, 0], [10, 0]),
        wall('w3', [5, 0], [5, 4]),
      ],
      [join(['w1', 'w2', 'w3'], [5, 0], { style: 'butt' })],
    )
    expect(validateWallJoin(scene, scene.wallJoins[0])).toBeNull()
    const adjusts = resolveJoin(scene, scene.wallJoins[0])
    if (isWallJoinError(adjusts)) throw new Error(adjusts.error)
    // The collinear pair just meets at the point; only the stem trims.
    expect(adjusts.get('w1')!.endExtend).toBeCloseTo(0)
    expect(adjusts.get('w2')!.startExtend).toBeCloseTo(0)
    expect(adjusts.get('w3')!.startExtend).toBeCloseTo(-T_EXT / 2)
  })

  it('butts several stems into one through wall at once', () => {
    const scene = withWalls(
      [
        wall('w1', [0, 0], [10, 0]),
        wall('w2', [5, 0], [5, 4]),
        wall('w3', [5, 0], [5, -4]),
      ],
      [join(['w1', 'w2', 'w3'], [5, 0], { style: 'butt' })],
    )
    const adjusts = resolveJoin(scene, scene.wallJoins[0])
    if (isWallJoinError(adjusts)) throw new Error(adjusts.error)
    expect(adjusts.get('w2')!.startExtend).toBeCloseTo(-T_EXT / 2)
    expect(adjusts.get('w3')!.startExtend).toBeCloseTo(-T_EXT / 2)
  })
})

describe('X-junction — two walls crossing', () => {
  it('is a no-op: the overlap is interior and invisible', () => {
    const scene = withWalls(
      [wall('w1', [0, 0], [10, 0]), wall('w2', [5, -4], [5, 4])],
      [join(['w1', 'w2'], [5, 0])],
    )
    expect(validateWallJoin(scene, scene.wallJoins[0])).toBeNull()
    const adjusts = resolveJoin(scene, scene.wallJoins[0])
    if (isWallJoinError(adjusts)) throw new Error(adjusts.error)
    expect(adjusts.size).toBe(0)
  })

  it('refuses when a third wall also ends at a crossing', () => {
    const scene = withWalls(
      [
        wall('w1', [0, 0], [10, 0]),
        wall('w2', [5, -4], [5, 4]),
        wall('w3', [5, 0], [8, 3]),
      ],
      [join(['w1', 'w2', 'w3'], [5, 0])],
    )
    expect(validateWallJoin(scene, scene.wallJoins[0])).toMatch(/already cross/i)
  })
})

describe('resolveWallJoins across a level', () => {
  it('returns nothing for a wall with no join, so the unchanged path stays unchanged', () => {
    const scene = withWalls([wall('w1', [0, 0], [5, 0]), wall('w2', [5, 0], [5, 4])])
    expect(resolveWallJoins(scene, LEVEL).size).toBe(0)
  })

  it('accumulates a wall joined at BOTH ends', () => {
    const scene = withWalls(
      [
        wall('w1', [0, 0], [5, 0]),
        wall('w2', [5, 0], [5, 4]),
        wall('w3', [0, -4], [0, 0]),
      ],
      [
        { ...join(['w1', 'w2'], [5, 0]), id: 'j1' },
        { ...join(['w3', 'w1'], [0, 0]), id: 'j2' },
      ],
    )
    const adjust = resolveWallJoins(scene, LEVEL).get('w1')!
    expect(Math.abs(adjust.endSkew)).toBeCloseTo(Math.PI / 4)
    expect(Math.abs(adjust.startSkew)).toBeCloseTo(Math.PI / 4)
  })

  it('ignores joins on other levels', () => {
    const scene = withWalls(
      [wall('w1', [0, 0], [5, 0]), wall('w2', [5, 0], [5, 4])],
      [{ ...join(['w1', 'w2'], [5, 0]), levelId: 'elsewhere' }],
    )
    expect(resolveWallJoins(scene, LEVEL).size).toBe(0)
  })

  it('skips an invalid join rather than throwing', () => {
    const scene = withWalls(
      [wall('w1', [0, 0], [5, 0])],
      [join(['w1', 'gone'], [5, 0])],
    )
    expect(() => resolveWallJoins(scene, LEVEL)).not.toThrow()
    expect(resolveWallJoins(scene, LEVEL).size).toBe(0)
  })
})

describe('joins and the rest of wall geometry coexist', () => {
  it('leaves an unjoined wall byte-for-byte as before', () => {
    const scene = withWalls([wall('w1', [0, 0], [5, 0])])
    const resolved = resolveWall(scene, scene.walls[0])!
    const before = wallSolidBoxes(resolved, [])
    const after = wallSolidBoxes(resolved, [], undefined)
    expect(after).toEqual(before)
    expect(before.every((b) => b.endSkew === undefined)).toBe(true)
  })

  it('mitres the lintel over a door sitting right at the corner, not just the full-height run', () => {
    const scene = withWalls(
      [wall('w1', [0, 0], [5, 0]), wall('w2', [5, 0], [5, 4])],
      [join(['w1', 'w2'], [5, 0])],
    )
    const withDoor: SceneGraph = {
      ...scene,
      openings: [
        {
          id: 'o1',
          hostId: 'w1',
          // Runs right up to the wall's end, so the ONLY chunk reaching the corner is the lintel.
          offset: 3,
          width: 2,
          height: 2.1,
          sillHeight: 0,
          predefinedType: 'opening',
          depth: null,
        },
      ],
    }
    const resolved = resolveWall(withDoor, withDoor.walls[0])!
    const adjust = resolveWallJoins(withDoor, LEVEL).get('w1')
    const boxes = wallSolidBoxes(resolved, withDoor.openings, adjust)
    const lintel = boxes.find((b) => b.center[1] > 2.1)
    expect(lintel).toBeDefined()
    expect(Math.abs(lintel!.endSkew!.end)).toBeCloseTo(Math.PI / 4)
  })

  it('keeps the wall’s openings exactly where they were when an end is trimmed', () => {
    // The stored baseline is never touched, so an opening's offset still measures from the same
    // origin — the trim is purely a render-time run change.
    const scene = withWalls(
      [wall('w1', [0, 0], [10, 0]), wall('w2', [0, 0], [0, 4], 'wt-int-100')],
      [join(['w1', 'w2'], [0, 0], { style: 'butt' })],
    )
    const withWindow: SceneGraph = {
      ...scene,
      openings: [
        {
          id: 'o1',
          hostId: 'w1',
          offset: 4,
          width: 1.2,
          height: 1.2,
          sillHeight: 0.9,
          predefinedType: 'opening',
          depth: null,
        },
      ],
    }
    const resolved = resolveWall(withWindow, withWindow.walls[0])!
    const adjust = resolveWallJoins(withWindow, LEVEL).get('w1')
    const boxes = wallSolidBoxes(resolved, withWindow.openings, adjust)
    // The under-sill chunk still spans x = 4.0 to 5.2 regardless of what happened at x = 0.
    const sill = boxes.find((b) => b.center[1] < 0.9 && b.size[0] < 1.5)
    expect(sill).toBeDefined()
    expect(sill!.center[0]).toBeCloseTo(4.6)
  })
})
