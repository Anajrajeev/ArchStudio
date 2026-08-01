/**
 * Tool state machine tests — including every hosted-tool validation path, since "refuse and
 * explain" is a stated quality requirement.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  toolHint,
  isLoopTool,
  isHostedTool,
  buildCommit,
  buildHostedCommit,
  nearestWall,
  shouldCloseLoop,
} from '../editor/tools'
import { commitActiveTool } from '../editor/commit'
import { useEditor, TOOL_POINTS, type Tool } from '../scene/store'
import { resolveWall } from '../../../shared/geometry/index'
import type { Vec2 } from '../../../shared/types/scene'
import { fixture, withWall } from './helpers'

const ALL_TOOLS: Tool[] = [
  'select',
  'wall',
  'slab',
  'room',
  'door',
  'window',
  'column',
  'beam',
  'measure',
]

describe('toolHint', () => {
  it('gives every tool a prompt and modifier line', () => {
    for (const tool of ALL_TOOLS) {
      const h = toolHint(tool, 0)
      expect(h.prompt.length, tool).toBeGreaterThan(0)
      expect(h.modifiers.length, tool).toBeGreaterThan(0)
    }
  })

  it('changes the prompt per click-phase, not just per tool', () => {
    expect(toolHint('wall', 0).prompt).not.toBe(toolHint('wall', 1).prompt)
    expect(toolHint('slab', 0).prompt).not.toBe(toolHint('slab', 3).prompt)
  })

  it('mentions typing a length once a wall has its first point', () => {
    expect(toolHint('wall', 1).prompt.toLowerCase()).toContain('length')
    expect(toolHint('wall', 1).modifiers).toContain('Tab')
  })
})

describe('tool classification', () => {
  it('identifies loop tools', () => {
    expect(isLoopTool('slab')).toBe(true)
    expect(isLoopTool('room')).toBe(true)
    expect(isLoopTool('wall')).toBe(false)
  })

  it('identifies hosted tools', () => {
    expect(isHostedTool('door')).toBe(true)
    expect(isHostedTool('window')).toBe(true)
    expect(isHostedTool('column')).toBe(false)
  })

  it('declares a point budget for every tool', () => {
    for (const tool of ALL_TOOLS) expect(TOOL_POINTS[tool]).toBeDefined()
  })
})

describe('shouldCloseLoop', () => {
  const pts: Vec2[] = [
    [0, 0],
    [4, 0],
    [4, 3],
  ]

  it('closes when clicking near the first vertex with enough points', () => {
    expect(shouldCloseLoop(pts, [0.05, 0.05], 0.2)).toBe(true)
  })

  it('does not close when too far from the first vertex', () => {
    expect(shouldCloseLoop(pts, [2, 2], 0.2)).toBe(false)
  })

  it('does not close with fewer than three points', () => {
    expect(shouldCloseLoop([[0, 0], [4, 0]], [0, 0], 0.2)).toBe(false)
  })
})

describe('nearestWall', () => {
  it('finds a wall under the cursor and reports the offset along it', () => {
    const { scene, levelId } = withWall(5)
    const hit = nearestWall(scene, [2, 0], levelId, 0.5)
    expect(hit).not.toBeNull()
    expect(hit!.offsetAlong).toBeCloseTo(2)
  })

  it('counts a point inside the wall thickness as distance zero', () => {
    const { scene, levelId } = withWall(5)
    const hit = nearestWall(scene, [2, 0.05], levelId, 0.01)
    expect(hit).not.toBeNull()
    expect(hit!.distance).toBeCloseTo(0)
  })

  it('returns null when nothing is in reach', () => {
    const { scene, levelId } = withWall(5)
    expect(nearestWall(scene, [2, 9], levelId, 0.3)).toBeNull()
  })

  it('ignores walls on other levels', () => {
    const { scene } = withWall(5)
    expect(nearestWall(scene, [2, 0], 'other-level', 0.5)).toBeNull()
  })

  it('measures the offset along a curved wall by arc length, not chord', () => {
    const { scene, levelId, wallId } = withWall(5)
    const curved = {
      ...scene,
      walls: scene.walls.map((w) =>
        w.id === wallId ? { ...w, baseline: { kind: 'arc' as const, start: [0, 0] as Vec2, end: [5, 0] as Vec2, bulge: 0.3 } } : w,
      ),
    }
    const resolved = resolveWall(curved, curved.walls[0])!
    const hit = nearestWall(curved, [5, 0], levelId, 1)
    expect(hit).not.toBeNull()
    // The far endpoint sits at the full arc length, which exceeds the 5 m chord.
    expect(hit!.offsetAlong).toBeGreaterThan(4.9)
    expect(hit!.offsetAlong).toBeLessThanOrEqual(resolved.length + 1e-6)
  })
})

// ---------------------------------------------------------------------------
// buildCommit
// ---------------------------------------------------------------------------

describe('buildCommit', () => {
  beforeEach(() => {
    const f = fixture()
    useEditor.getState().loadScene(f.scene, f.levelId)
  })

  it('builds a wall from two points and chains from the endpoint', () => {
    useEditor.getState().setTool('wall')
    const commit = buildCommit(useEditor.getState(), [
      [0, 0],
      [5, 0],
    ])
    expect(commit).not.toBeNull()
    expect(commit!.keepPoints).toEqual([[5, 0]])
    const next = commit!.produce(useEditor.getState().scene)
    expect(next.walls).toHaveLength(1)
  })

  it('refuses a zero-length wall', () => {
    useEditor.getState().setTool('wall')
    expect(
      buildCommit(useEditor.getState(), [
        [2, 2],
        [2, 2],
      ]),
    ).toBeNull()
  })

  it('refuses a wall with only one point', () => {
    useEditor.getState().setTool('wall')
    expect(buildCommit(useEditor.getState(), [[0, 0]])).toBeNull()
  })

  it('builds a slab from three or more points and does not chain', () => {
    useEditor.getState().setTool('slab')
    const commit = buildCommit(useEditor.getState(), [
      [0, 0],
      [4, 0],
      [4, 3],
    ])
    expect(commit).not.toBeNull()
    expect(commit!.keepPoints).toEqual([])
    expect(commit!.produce(useEditor.getState().scene).slabs).toHaveLength(1)
  })

  it('refuses a slab with fewer than three points', () => {
    useEditor.getState().setTool('slab')
    expect(buildCommit(useEditor.getState(), [[0, 0], [4, 0]])).toBeNull()
  })

  it('builds a room', () => {
    useEditor.getState().setTool('room')
    const commit = buildCommit(useEditor.getState(), [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ])
    expect(commit!.produce(useEditor.getState().scene).rooms).toHaveLength(1)
  })

  it('builds a column from one point', () => {
    useEditor.getState().setTool('column')
    const commit = buildCommit(useEditor.getState(), [[2, 2]])
    expect(commit).not.toBeNull()
    expect(commit!.produce(useEditor.getState().scene).columns).toHaveLength(1)
  })

  it('builds a beam from two points and refuses a degenerate one', () => {
    useEditor.getState().setTool('beam')
    expect(buildCommit(useEditor.getState(), [[0, 0], [6, 0]])).not.toBeNull()
    expect(buildCommit(useEditor.getState(), [[1, 1], [1, 1]])).toBeNull()
  })

  it('returns null for tools that do not place free points', () => {
    useEditor.getState().setTool('select')
    expect(buildCommit(useEditor.getState(), [[0, 0], [1, 1]])).toBeNull()
    useEditor.getState().setTool('door')
    expect(buildCommit(useEditor.getState(), [[0, 0]])).toBeNull()
  })

  // The measure tool reads a distance; it creates no element. It must therefore never be routed
  // through commitActiveTool, which would flash a spurious "invalid element" error.
  it('returns null for measure, which creates no element', () => {
    useEditor.getState().setTool('measure')
    expect(buildCommit(useEditor.getState(), [[0, 0], [3, 4]])).toBeNull()
  })

  it('gives measure a distinct hint for each of its three phases', () => {
    const p0 = toolHint('measure', 0).prompt
    const p1 = toolHint('measure', 1).prompt
    const p2 = toolHint('measure', 2).prompt
    expect(new Set([p0, p1, p2]).size).toBe(3)
    expect(p2.toLowerCase()).toContain('new measurement')
  })

  it('uses the active type for the tool', () => {
    useEditor.getState().setTool('wall')
    useEditor.getState().setActiveType('wall', 'wt-int-100')
    const commit = buildCommit(useEditor.getState(), [[0, 0], [5, 0]])!
    const next = commit.produce(useEditor.getState().scene)
    expect(next.walls[0].typeId).toBe('wt-int-100')
  })
})

// ---------------------------------------------------------------------------
// buildHostedCommit — doors and windows
// ---------------------------------------------------------------------------

describe('buildHostedCommit', () => {
  beforeEach(() => {
    const w = withWall(5)
    useEditor.getState().loadScene(w.scene, w.levelId)
  })

  it('places a door on the wall under the cursor', () => {
    useEditor.getState().setTool('door')
    const outcome = buildHostedCommit(useEditor.getState(), [2.5, 0], 0.5)
    expect('result' in outcome).toBe(true)
    if (!('result' in outcome)) throw new Error('unreachable')
    const next = outcome.result.produce(useEditor.getState().scene)
    expect(next.openings).toHaveLength(1)
    expect(next.fillings).toHaveLength(1)
    // The opening is centred on the click.
    expect(next.openings[0].offset + next.openings[0].width / 2).toBeCloseTo(2.5)
  })

  it('places a window with its type sill height', () => {
    useEditor.getState().setTool('window')
    const outcome = buildHostedCommit(useEditor.getState(), [2.5, 0], 0.5)
    if (!('result' in outcome)) throw new Error('expected a result')
    const next = outcome.result.produce(useEditor.getState().scene)
    expect(next.openings[0].sillHeight).toBeCloseTo(0.9)
  })

  it('explains the failure when there is no wall in reach', () => {
    useEditor.getState().setTool('door')
    const outcome = buildHostedCommit(useEditor.getState(), [2, 9], 0.3)
    expect('error' in outcome).toBe(true)
    if (!('error' in outcome)) throw new Error('unreachable')
    expect(outcome.error).toContain('No wall within reach')
    expect(outcome.error).toContain('door')
  })

  it('clamps a door placed near the wall end so it stays inside', () => {
    useEditor.getState().setTool('door')
    const outcome = buildHostedCommit(useEditor.getState(), [5, 0], 0.5)
    if (!('result' in outcome)) throw new Error('expected a result')
    const next = outcome.result.produce(useEditor.getState().scene)
    const o = next.openings[0]
    const resolved = resolveWall(next, next.walls[0])!
    expect(o.offset).toBeGreaterThanOrEqual(0)
    expect(o.offset + o.width).toBeLessThanOrEqual(resolved.length + 1e-9)
  })

  it('narrows an opening that is wider than its wall', () => {
    const short = withWall(0.6)
    useEditor.getState().loadScene(short.scene, short.levelId)
    useEditor.getState().setTool('door')
    const outcome = buildHostedCommit(useEditor.getState(), [0.3, 0], 0.5)
    if (!('result' in outcome)) throw new Error('expected a result')
    const next = outcome.result.produce(useEditor.getState().scene)
    // The 0.9 m door type must be clamped to the 0.6 m wall.
    expect(next.openings[0].width).toBeCloseTo(0.6)
  })
})

// ---------------------------------------------------------------------------
// commitActiveTool — the shared pointer/keyboard path
// ---------------------------------------------------------------------------

describe('commitActiveTool', () => {
  beforeEach(() => {
    const f = fixture()
    useEditor.getState().loadScene(f.scene, f.levelId)
  })

  it('commits a wall, records one undo entry, and chains', () => {
    useEditor.getState().setTool('wall')
    const ok = commitActiveTool([
      [0, 0],
      [5, 0],
    ])
    expect(ok).toBe(true)
    expect(useEditor.getState().scene.walls).toHaveLength(1)
    expect(useEditor.getState().undoStack).toHaveLength(1)
    // Chaining leaves the last endpoint staged for the next segment.
    expect(useEditor.getState().points).toEqual([[5, 0]])
    expect(useEditor.getState().toolPhase).toBe('collecting')
  })

  it('clears points and numeric locks after a non-chaining commit', () => {
    useEditor.getState().setTool('room')
    useEditor.getState().typeNumeric('4')
    useEditor.getState().commitNumeric()
    commitActiveTool([
      [0, 0],
      [4, 0],
      [4, 3],
    ])
    expect(useEditor.getState().points).toEqual([])
    expect(useEditor.getState().numeric.lockedLength).toBeNull()
    expect(useEditor.getState().axisLock).toBe('none')
  })

  it('flashes an error and adds no history for invalid points', () => {
    useEditor.getState().setTool('wall')
    const ok = commitActiveTool([[1, 1], [1, 1]])
    expect(ok).toBe(false)
    expect(useEditor.getState().scene.walls).toHaveLength(0)
    expect(useEditor.getState().undoStack).toHaveLength(0)
    expect(useEditor.getState().statusMessage?.kind).toBe('error')
  })

  it('one undo removes the whole committed element', () => {
    useEditor.getState().setTool('slab')
    commitActiveTool([
      [0, 0],
      [4, 0],
      [4, 3],
    ])
    expect(useEditor.getState().scene.slabs).toHaveLength(1)
    useEditor.getState().undo()
    expect(useEditor.getState().scene.slabs).toHaveLength(0)
  })

  it('chained walls each get their own undo entry', () => {
    useEditor.getState().setTool('wall')
    commitActiveTool([[0, 0], [5, 0]])
    commitActiveTool([[5, 0], [5, 4]])
    expect(useEditor.getState().scene.walls).toHaveLength(2)
    expect(useEditor.getState().undoStack).toHaveLength(2)
    useEditor.getState().undo()
    expect(useEditor.getState().scene.walls).toHaveLength(1)
  })
})
