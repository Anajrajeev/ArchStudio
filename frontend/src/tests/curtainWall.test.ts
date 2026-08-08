/**
 * Curtain walls (B4 / D-027).
 *
 * The grid rules are the testable core — everything else is placement — so they get exhaustive
 * coverage including the awkward cases (a run shorter than one bay, an exact multiple, a
 * remainder). The decomposition tests then check the property the item is actually about: that
 * panels are sized BY the grid and that framing and glazing never occupy the same material twice.
 */
import { describe, it, expect } from 'vitest'
import {
  emptySceneGraph,
  type CurtainWall,
  type CurtainWallTypeDef,
  type SceneGraph,
} from '../../../shared/types/scene'
import { addLevel } from '../scene/mutations'
import {
  curtainWallSolidBoxes,
  gridPositions,
  resolveCurtainWall,
  validateCurtainWall,
} from '../../../shared/geometry/curtainWall'

describe('gridPositions', () => {
  describe('fixedNumber', () => {
    it('divides into exactly that many equal bays, ends included', () => {
      expect(gridPositions({ kind: 'fixedNumber', count: 4 }, 8)).toEqual([0, 2, 4, 6, 8])
    })

    it('treats a count of 1 as a single undivided bay', () => {
      expect(gridPositions({ kind: 'fixedNumber', count: 1 }, 5)).toEqual([0, 5])
    })

    it('clamps a nonsensical count rather than emitting an empty grid', () => {
      expect(gridPositions({ kind: 'fixedNumber', count: 0 }, 5)).toEqual([0, 5])
    })
  })

  describe('fixedDistance', () => {
    it('lays exact bays and leaves the remainder as a shorter final one', () => {
      // 5 m at 2 m: two full bays, then a 1 m end bay.
      expect(gridPositions({ kind: 'fixedDistance', spacing: 2 }, 5)).toEqual([0, 2, 4, 5])
    })

    it('does not emit a sliver bay when the run is an exact multiple', () => {
      expect(gridPositions({ kind: 'fixedDistance', spacing: 2 }, 6)).toEqual([0, 2, 4, 6])
    })

    it('gives a single bay when the run is shorter than one spacing', () => {
      expect(gridPositions({ kind: 'fixedDistance', spacing: 2 }, 1.5)).toEqual([0, 1.5])
    })
  })

  describe('maximumSpacing', () => {
    it('uses the fewest EQUAL bays that keep every bay under the maximum', () => {
      // 5 m with a 1.5 m maximum needs 4 bays (1.25 each), not 3 of 1.5 plus a 0.5 stub.
      const lines = gridPositions({ kind: 'maximumSpacing', spacing: 1.5 }, 5)
      expect(lines).toHaveLength(5)
      for (let i = 1; i < lines.length; i++) {
        expect(lines[i] - lines[i - 1]).toBeCloseTo(1.25)
      }
    })

    it('does not add a bay when the run divides exactly', () => {
      expect(gridPositions({ kind: 'maximumSpacing', spacing: 1.5 }, 4.5)).toHaveLength(4)
    })

    it('gives one bay when the run is shorter than the maximum', () => {
      expect(gridPositions({ kind: 'maximumSpacing', spacing: 1.5 }, 1)).toEqual([0, 1])
    })
  })

  it('never returns fewer than the two ends, whatever the rule', () => {
    const rules = [
      { kind: 'fixedNumber' as const, count: 3 },
      { kind: 'fixedDistance' as const, spacing: 1 },
      { kind: 'maximumSpacing' as const, spacing: 1 },
    ]
    for (const rule of rules) {
      const lines = gridPositions(rule, 4)
      expect(lines[0]).toBe(0)
      expect(lines[lines.length - 1]).toBeCloseTo(4)
    }
  })

  it('degrades to a single position for a zero-length run instead of dividing by zero', () => {
    expect(gridPositions({ kind: 'maximumSpacing', spacing: 1 }, 0)).toEqual([0])
  })
})

// ---------------------------------------------------------------------------

const TYPE: CurtainWallTypeDef = {
  id: 'cwt-test',
  category: 'curtainWall',
  name: 'Test',
  gridU: { kind: 'fixedNumber', count: 3 },
  gridV: { kind: 'fixedNumber', count: 2 },
  mullionWidth: 0.05,
  mullionDepth: 0.15,
  panelThickness: 0.02,
  panelMaterial: 'mat-glass',
  mullionMaterial: 'mat-steel',
}

function scene(overrides: Partial<CurtainWall> = {}): {
  scene: SceneGraph
  curtainWall: CurtainWall
} {
  const base = addLevel(emptySceneGraph('p'), 'Ground')
  const levelId = base.levels[0].id
  const curtainWall: CurtainWall = {
    id: 'cw1',
    typeId: TYPE.id,
    levelId,
    baseline: { kind: 'line', start: [0, 0], end: [6, 0] },
    baseOffset: 0,
    top: { kind: 'unconnected', height: 3 },
    ...overrides,
  }
  return {
    scene: { ...base, types: [...base.types, TYPE], curtainWalls: [curtainWall] },
    curtainWall,
  }
}

describe('resolveCurtainWall', () => {
  it('derives length and height from the baseline and top constraint', () => {
    const { scene: s, curtainWall } = scene()
    const r = resolveCurtainWall(s, curtainWall)!
    expect(r.length).toBeCloseTo(6)
    expect(r.height).toBeCloseTo(3)
    expect(r.baseElevation).toBeCloseTo(0)
  })

  it('tracks a level-bound top, so raising the storey re-grids the wall', () => {
    const { scene: s, curtainWall } = scene()
    const withUpper = {
      ...s,
      levels: [
        ...s.levels,
        { id: 'lv2', name: 'First', elevation: 4, height: 3, isBuildingStory: true, computationHeight: 0 },
      ],
      curtainWalls: [{ ...curtainWall, top: { kind: 'level' as const, levelId: 'lv2', offset: 0 } }],
    }
    const r = resolveCurtainWall(withUpper, withUpper.curtainWalls[0])!
    expect(r.height).toBeCloseTo(4)
  })

  it('returns null for a curved baseline rather than approximating it', () => {
    const { scene: s, curtainWall } = scene({
      baseline: { kind: 'arc', start: [0, 0], end: [6, 0], bulge: 0.3 },
    })
    expect(resolveCurtainWall(s, curtainWall)).toBeNull()
  })

  it('returns null when the type is missing or the wrong category', () => {
    const { scene: s, curtainWall } = scene({ typeId: 'wt-ext-200' })
    expect(resolveCurtainWall(s, curtainWall)).toBeNull()
  })
})

describe('curtainWallSolidBoxes', () => {
  const { scene: s, curtainWall } = scene()
  const resolved = resolveCurtainWall(s, curtainWall)!
  const { frame, panels } = curtainWallSolidBoxes(resolved)

  it('places one mullion per vertical grid line, including both ends', () => {
    // 3 bays → 4 lines. Mullions are the full-height boxes.
    const mullions = frame.filter((b) => b.size[1] > 2.9)
    expect(mullions).toHaveLength(4)
  })

  it('places transoms between mullions, one run per bay per horizontal line', () => {
    // 2 rows → 3 horizontal lines, each crossing 3 bays.
    const transoms = frame.filter((b) => b.size[1] < 0.1)
    expect(transoms).toHaveLength(9)
  })

  it('produces exactly one panel per grid cell', () => {
    expect(panels).toHaveLength(3 * 2)
  })

  it('sizes panels from the grid, inset to the surrounding framing', () => {
    // Bay is 2 m wide, minus half a mullion at each side.
    expect(panels[0].size[0]).toBeCloseTo(2 - 0.05)
    // Row is 1.5 m tall, minus half a transom at each side.
    expect(panels[0].size[1]).toBeCloseTo(1.5 - 0.05)
    expect(panels[0].size[2]).toBeCloseTo(TYPE.panelThickness)
  })

  it('re-grids every instance when the TYPE changes — the defining BIM interaction', () => {
    const denser: SceneGraph = {
      ...s,
      types: s.types.map((t) =>
        t.id === TYPE.id ? { ...TYPE, gridU: { kind: 'fixedNumber' as const, count: 6 } } : t,
      ),
    }
    const after = curtainWallSolidBoxes(resolveCurtainWall(denser, curtainWall)!)
    expect(after.panels).toHaveLength(6 * 2)
    // And the panels genuinely got narrower — the grid drives the panel, never the reverse.
    expect(after.panels[0].size[0]).toBeLessThan(panels[0].size[0])
  })

  it('keeps the whole system inside the run the user drew', () => {
    // End mullions are inset by half their width rather than overhanging the baseline.
    const xs = [...frame, ...panels].flatMap((b) => [
      b.center[0] - b.size[0] / 2,
      b.center[0] + b.size[0] / 2,
    ])
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1e-9)
    expect(Math.max(...xs)).toBeLessThanOrEqual(6 + 1e-9)
  })

  it('never overlaps framing with framing', () => {
    // Transoms span BETWEEN mullions, so no transom's run may reach a mullion's centre line.
    const mullionXs = frame.filter((b) => b.size[1] > 2.9).map((b) => b.center[0])
    const transoms = frame.filter((b) => b.size[1] < 0.1)
    for (const t of transoms) {
      const lo = t.center[0] - t.size[0] / 2
      const hi = t.center[0] + t.size[0] / 2
      for (const mx of mullionXs) {
        expect(mx > lo + 1e-9 && mx < hi - 1e-9).toBe(false)
      }
    }
  })

  it('orients every box along the baseline, whatever direction it runs', () => {
    const { scene: diag, curtainWall: cw } = scene({
      baseline: { kind: 'line', start: [0, 0], end: [3, 3] },
    })
    const r = resolveCurtainWall(diag, cw)!
    const solids = curtainWallSolidBoxes(r)
    const expected = solids.frame[0].rotationY
    for (const b of [...solids.frame, ...solids.panels]) {
      expect(b.rotationY).toBeCloseTo(expected)
    }
    expect(r.length).toBeCloseTo(Math.hypot(3, 3))
  })

  it('produces nothing at all for a degenerate run instead of NaN geometry', () => {
    const { scene: s2, curtainWall: cw } = scene({
      baseline: { kind: 'line', start: [0, 0], end: [0, 0] },
    })
    const r = resolveCurtainWall(s2, cw)!
    expect(curtainWallSolidBoxes(r)).toEqual({ frame: [], panels: [] })
  })
})

describe('validateCurtainWall', () => {
  it('says nothing about a sound curtain wall', () => {
    const { scene: s, curtainWall } = scene()
    expect(validateCurtainWall(s, curtainWall)).toEqual([])
  })

  it('explains the curved-baseline refusal rather than silently drawing nothing', () => {
    const { scene: s, curtainWall } = scene({
      baseline: { kind: 'arc', start: [0, 0], end: [6, 0], bulge: 0.3 },
    })
    expect(validateCurtainWall(s, curtainWall).join(' ')).toMatch(/curved/i)
  })

  it('flags a run too short to hold a panel', () => {
    const { scene: s, curtainWall } = scene({
      baseline: { kind: 'line', start: [0, 0], end: [0.05, 0] },
    })
    expect(validateCurtainWall(s, curtainWall).join(' ')).toMatch(/shorter than two mullions/i)
  })

  it('flags glazing thicker than the frame it sits in', () => {
    const { scene: s, curtainWall } = scene()
    const fat: SceneGraph = {
      ...s,
      types: s.types.map((t) => (t.id === TYPE.id ? { ...TYPE, panelThickness: 0.5 } : t)),
    }
    expect(validateCurtainWall(fat, curtainWall).join(' ')).toMatch(/protrudes/i)
  })

  it('reports a missing type instead of throwing', () => {
    const { scene: s, curtainWall } = scene({ typeId: 'nope' })
    expect(validateCurtainWall(s, curtainWall).join(' ')).toMatch(/no valid type/i)
  })
})
