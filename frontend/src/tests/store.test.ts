import { describe, it, expect, beforeEach } from 'vitest'
import { useEditor, parseLengthInput, formatLength } from '../scene/store'
import {
  addWall,
  addLevel,
  addSlab,
  addColumn,
  addRoom,
  moveElement,
  deleteElement,
  findElement,
  levelIdOf,
  restackLevels,
  updateLevel,
  setWallTypeThickness,
  duplicateType,
  setElementType,
  syncOpeningToFilling,
  updateOpening,
  elementLabel,
} from '../scene/mutations'
import { resolveWall } from '../../../shared/geometry/index'
import { assemblyThickness } from '../../../shared/types/scene'
import { fixture, withWall, withDoor } from './helpers'

// ---------------------------------------------------------------------------
// Mutations — immutability and cascades
// ---------------------------------------------------------------------------

describe('mutations', () => {
  it('never mutates the input scene', () => {
    const f = fixture()
    const before = JSON.stringify(f.scene)
    addWall(f.scene, {
      levelId: f.levelId,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [0, 0], end: [5, 0] },
    })
    expect(JSON.stringify(f.scene)).toBe(before)
  })

  it('identifies which collection an id belongs to', () => {
    const { scene, wallId } = withWall()
    expect(findElement(scene, wallId)?.kind).toBe('wall')
    expect(findElement(scene, 'nope')).toBeNull()
  })

  it('resolves the level of a hosted opening through its wall', () => {
    const { scene, levelId, openingId, fillingId } = withDoor()
    expect(levelIdOf(scene, openingId)).toBe(levelId)
    expect(levelIdOf(scene, fillingId)).toBe(levelId)
  })

  it('deleting a wall cascades to its openings AND their fillings', () => {
    const { scene, wallId } = withDoor()
    expect(scene.openings).toHaveLength(1)
    expect(scene.fillings).toHaveLength(1)
    const after = deleteElement(scene, wallId)
    expect(after.walls).toHaveLength(0)
    expect(after.openings).toHaveLength(0)
    expect(after.fillings).toHaveLength(0)
  })

  it('deleting a filling also removes its void', () => {
    const { scene, fillingId } = withDoor()
    const after = deleteElement(scene, fillingId)
    expect(after.fillings).toHaveLength(0)
    expect(after.openings).toHaveLength(0)
    expect(after.walls).toHaveLength(1)
  })

  it('deleting a level cascades to everything hosted on it', () => {
    const { scene, levelId, wallId } = withDoor()
    const withSlab = addSlab(scene, levelId, 'st-floor-200', [
      [0, 0],
      [4, 0],
      [4, 3],
    ]).scene
    const withCol = addColumn(withSlab, levelId, 'ct-rect-300', [1, 1]).scene
    const withRoom = addRoom(withCol, levelId, [
      [0, 0],
      [4, 0],
      [4, 3],
    ]).scene

    const after = deleteElement(withRoom, levelId)
    expect(after.levels).toHaveLength(0)
    expect(after.walls).toHaveLength(0)
    expect(after.openings).toHaveLength(0)
    expect(after.fillings).toHaveLength(0)
    expect(after.slabs).toHaveLength(0)
    expect(after.columns).toHaveLength(0)
    expect(after.rooms).toHaveLength(0)
    expect(wallId).toBeTruthy()
  })

  it('moves a wall by translating both baseline endpoints', () => {
    const { scene, wallId } = withWall()
    const moved = moveElement(scene, wallId, [2, 3])
    const w = moved.walls[0]
    expect(w.baseline.start).toEqual([2, 3])
    expect(w.baseline.end).toEqual([7, 3])
  })

  it('dragging an opening slides it along its host instead of off it', () => {
    const { scene, openingId } = withDoor(2.5)
    const before = scene.openings.find((o) => o.id === openingId)!.offset
    // Push it along +X (the wall's direction).
    const moved = moveElement(scene, openingId, [1, 0])
    const after = moved.openings.find((o) => o.id === openingId)!
    expect(after.offset).toBeCloseTo(before + 1)
    // Perpendicular movement must not change the offset.
    const sideways = moveElement(scene, openingId, [0, 1])
    expect(sideways.openings.find((o) => o.id === openingId)!.offset).toBeCloseTo(before)
  })

  it('clamps a dragged opening to stay inside its wall', () => {
    const { scene, openingId } = withDoor(2.5)
    const moved = moveElement(scene, openingId, [999, 0])
    const after = moved.openings.find((o) => o.id === openingId)!
    const resolved = resolveWall(moved, moved.walls[0])!
    expect(after.offset + after.width).toBeLessThanOrEqual(resolved.length + 1e-9)
  })

  it('is a no-op for an unknown id', () => {
    const { scene } = withWall()
    expect(moveElement(scene, 'nope', [1, 1])).toBe(scene)
    expect(deleteElement(scene, 'nope')).toBe(scene)
  })

  it('labels elements readably for the model tree', () => {
    const { scene, wallId, fillingId } = withDoor()
    expect(elementLabel(scene, wallId)).toMatch(/5\.00m/)
    expect(elementLabel(scene, fillingId)).toContain('Single door')
  })
})

// ---------------------------------------------------------------------------
// The type layer — the defining BIM interaction
// ---------------------------------------------------------------------------

describe('type layer', () => {
  it('editing a type updates EVERY instance of it', () => {
    const { scene, levelId, wallId } = withWall(5)
    const second = addWall(scene, {
      levelId,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [0, 4], end: [5, 4] },
    })

    const thickened = setWallTypeThickness(second.scene, 'wt-ext-200', 0.4)
    for (const w of thickened.walls) {
      expect(resolveWall(thickened, w)!.thickness).toBeCloseTo(0.4)
    }
    expect(wallId).toBeTruthy()
  })

  it('scales layers proportionally when thickness changes', () => {
    const { scene } = withWall()
    const type = scene.types.find((t) => t.id === 'wt-ext-200')!
    if (type.category !== 'wall') throw new Error('unreachable')
    const ratios = type.layers.map((l) => l.thickness / assemblyThickness(type.layers))

    const thickened = setWallTypeThickness(scene, 'wt-ext-200', 0.4)
    const after = thickened.types.find((t) => t.id === 'wt-ext-200')!
    if (after.category !== 'wall') throw new Error('unreachable')
    expect(assemblyThickness(after.layers)).toBeCloseTo(0.4)
    after.layers.forEach((l, i) => {
      expect(l.thickness / 0.4).toBeCloseTo(ratios[i])
    })
  })

  it('rejects a non-positive thickness', () => {
    const { scene } = withWall()
    expect(setWallTypeThickness(scene, 'wt-ext-200', 0)).toBe(scene)
    expect(setWallTypeThickness(scene, 'wt-ext-200', -1)).toBe(scene)
  })

  it('duplicating a type lets one instance diverge from the rest', () => {
    const { scene, levelId, wallId } = withWall()
    const second = addWall(scene, {
      levelId,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [0, 4], end: [5, 4] },
    })

    const dup = duplicateType(second.scene, 'wt-ext-200')
    const repointed = setElementType(dup.scene, wallId, dup.id)
    const thickened = setWallTypeThickness(repointed, dup.id, 0.5)

    const changed = thickened.walls.find((w) => w.id === wallId)!
    const untouched = thickened.walls.find((w) => w.id === second.id)!
    expect(resolveWall(thickened, changed)!.thickness).toBeCloseTo(0.5)
    expect(resolveWall(thickened, untouched)!.thickness).toBeCloseTo(0.2)
  })

  it('swapping a filling type resizes its void to match', () => {
    const { scene, fillingId, openingId } = withDoor()
    const swapped = setElementType(scene, fillingId, 'wnt-1200')
    const opening = swapped.openings.find((o) => o.id === openingId)!
    // The window type is 1.2 wide with a 0.9 sill.
    expect(opening.width).toBeCloseTo(1.2)
    expect(opening.sillHeight).toBeCloseTo(0.9)
  })

  it('syncing keeps the opening inside its wall', () => {
    const { scene, fillingId, openingId } = withDoor()
    const pushed = updateOpening(scene, openingId, { offset: 4.9 })
    const synced = syncOpeningToFilling(setElementType(pushed, fillingId, 'wnt-1200'), fillingId)
    const opening = synced.openings.find((o) => o.id === openingId)!
    const resolved = resolveWall(synced, synced.walls[0])!
    expect(opening.offset + opening.width).toBeLessThanOrEqual(resolved.length + 1e-9)
  })
})

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

describe('levels', () => {
  it('stacks a new level on top of the previous one', () => {
    const f = fixture()
    const two = addLevel(f.scene, 'First floor')
    expect(two.levels[1].elevation).toBeCloseTo(2.8)
    const three = addLevel(two, 'Second floor')
    expect(three.levels[2].elevation).toBeCloseTo(5.6)
  })

  it('re-stacks levels after a storey height change so the building stays contiguous', () => {
    const f = fixture()
    const two = addLevel(f.scene, 'L2')
    const three = addLevel(two, 'L3')
    const taller = restackLevels(updateLevel(three, three.levels[0].id, { height: 4 }))
    expect(taller.levels[0].elevation).toBeCloseTo(0)
    expect(taller.levels[1].elevation).toBeCloseTo(4)
    expect(taller.levels[2].elevation).toBeCloseTo(6.8)
  })

  it('a level-constrained wall follows a storey height change', () => {
    const f = fixture()
    const two = addLevel(f.scene, 'L2')
    const upperId = two.levels[1].id
    const w = addWall(two, {
      levelId: two.levels[0].id,
      typeId: 'wt-ext-200',
      baseline: { kind: 'line', start: [0, 0], end: [5, 0] },
      top: { kind: 'level', levelId: upperId, offset: 0 },
    })
    expect(resolveWall(w.scene, w.scene.walls[0])!.height).toBeCloseTo(2.8)

    // Raise the ground floor; the level above moves, and so does the wall's top.
    const taller = restackLevels(updateLevel(w.scene, two.levels[0].id, { height: 3.5 }))
    expect(resolveWall(taller, taller.walls[0])!.height).toBeCloseTo(3.5)
  })

  it('an unconnected wall does NOT follow a storey height change', () => {
    const { scene, wallId } = withWall()
    const taller = restackLevels(updateLevel(scene, scene.levels[0].id, { height: 4 }))
    expect(resolveWall(taller, taller.walls.find((w) => w.id === wallId)!)!.height).toBeCloseTo(2.8)
  })
})

// ---------------------------------------------------------------------------
// Store: command-pattern history
// ---------------------------------------------------------------------------

describe('store history', () => {
  beforeEach(() => {
    const f = fixture()
    useEditor.getState().loadScene(f.scene, f.levelId)
  })

  const addAWall = (end: [number, number] = [5, 0]) => {
    const s = useEditor.getState()
    s.commit('Add wall', (sc) =>
      addWall(sc, {
        levelId: s.activeLevelId,
        typeId: 'wt-ext-200',
        baseline: { kind: 'line', start: [0, 0], end },
      }).scene,
    )
  }

  it('commit records history; undo and redo reverse it', () => {
    addAWall()
    expect(useEditor.getState().scene.walls).toHaveLength(1)
    useEditor.getState().undo()
    expect(useEditor.getState().scene.walls).toHaveLength(0)
    useEditor.getState().redo()
    expect(useEditor.getState().scene.walls).toHaveLength(1)
  })

  it('a new commit clears the redo stack', () => {
    addAWall([1, 0])
    useEditor.getState().undo()
    addAWall([2, 0])
    useEditor.getState().redo()
    expect(useEditor.getState().scene.walls).toHaveLength(1)
    expect(useEditor.getState().redoStack).toHaveLength(0)
  })

  it('no-op commits do not grow history', () => {
    const before = useEditor.getState().undoStack.length
    useEditor.getState().commit('noop', (s) => s)
    expect(useEditor.getState().undoStack).toHaveLength(before)
  })

  it('a transient drag collapses into a single undo entry', () => {
    addAWall()
    const wallId = useEditor.getState().scene.walls[0].id
    const startBefore = useEditor.getState().scene.walls[0].baseline.start

    const s = useEditor.getState()
    s.beginTransient()
    s.updateTransient((sc) => moveElement(sc, wallId, [1, 0]))
    s.updateTransient((sc) => moveElement(sc, wallId, [1, 0]))
    s.updateTransient((sc) => moveElement(sc, wallId, [1, 0]))
    s.endTransient('Move element')

    // Three intermediate updates, one history entry.
    expect(useEditor.getState().undoStack).toHaveLength(2) // add + move
    expect(useEditor.getState().scene.walls[0].baseline.start[0]).toBeCloseTo(3)

    useEditor.getState().undo()
    expect(useEditor.getState().scene.walls[0].baseline.start).toEqual(startBefore)
  })

  it('cancelling a transient restores the pre-drag scene', () => {
    addAWall()
    const wallId = useEditor.getState().scene.walls[0].id
    const s = useEditor.getState()
    s.beginTransient()
    s.updateTransient((sc) => moveElement(sc, wallId, [5, 5]))
    s.cancelTransient()
    expect(useEditor.getState().scene.walls[0].baseline.start).toEqual([0, 0])
  })

  it('a transient that changed nothing adds no history', () => {
    addAWall()
    const before = useEditor.getState().undoStack.length
    const s = useEditor.getState()
    s.beginTransient()
    s.endTransient('Move element')
    expect(useEditor.getState().undoStack).toHaveLength(before)
  })

  it('loadScene resets history so an opened project has no stale undo', () => {
    addAWall()
    const f = fixture()
    useEditor.getState().loadScene(f.scene, f.levelId)
    expect(useEditor.getState().undoStack).toHaveLength(0)
    expect(useEditor.getState().redoStack).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Tool state machine + selection
// ---------------------------------------------------------------------------

describe('store tool state', () => {
  beforeEach(() => {
    const f = fixture()
    useEditor.getState().loadScene(f.scene, f.levelId)
    useEditor.getState().setTool('select')
  })

  it('collects and pops points, tracking the phase', () => {
    const s = useEditor.getState()
    s.setTool('wall')
    expect(useEditor.getState().toolPhase).toBe('idle')
    useEditor.getState().addPoint([0, 0])
    expect(useEditor.getState().toolPhase).toBe('collecting')
    useEditor.getState().popPoint()
    expect(useEditor.getState().toolPhase).toBe('idle')
  })

  it('switching tools clears the in-progress operation', () => {
    useEditor.getState().setTool('wall')
    useEditor.getState().addPoint([0, 0])
    useEditor.getState().setTool('room')
    expect(useEditor.getState().points).toHaveLength(0)
    expect(useEditor.getState().toolPhase).toBe('idle')
  })

  it('supports additive selection', () => {
    const s = useEditor.getState()
    s.select('a')
    s.select('b', true)
    expect(useEditor.getState().selectedIds).toEqual(['a', 'b'])
    // Shift-clicking an already-selected element removes it.
    useEditor.getState().select('a', true)
    expect(useEditor.getState().selectedIds).toEqual(['b'])
    useEditor.getState().select(null)
    expect(useEditor.getState().selectedIds).toEqual([])
  })

  it('accumulates and commits a typed length', () => {
    const s = useEditor.getState()
    s.setTool('wall')
    s.typeNumeric('4')
    s.typeNumeric('.')
    s.typeNumeric('2')
    expect(useEditor.getState().numeric.buffer).toBe('4.2')
    useEditor.getState().commitNumeric()
    expect(useEditor.getState().numeric.lockedLength).toBeCloseTo(4.2)
    expect(useEditor.getState().numeric.buffer).toBe('')
  })

  it('rejects a second decimal point and non-numeric keys', () => {
    const s = useEditor.getState()
    s.typeNumeric('1')
    s.typeNumeric('.')
    s.typeNumeric('.')
    s.typeNumeric('a')
    expect(useEditor.getState().numeric.buffer).toBe('1.')
  })

  it('Tab switches which field the typed number fills', () => {
    const s = useEditor.getState()
    s.typeNumeric('4')
    s.toggleNumericField()
    expect(useEditor.getState().numeric.field).toBe('angle')
    // Switching clears the buffer so digits do not leak between fields.
    expect(useEditor.getState().numeric.buffer).toBe('')
    useEditor.getState().typeNumeric('9')
    useEditor.getState().typeNumeric('0')
    useEditor.getState().commitNumeric()
    expect(useEditor.getState().numeric.lockedAngle).toBeCloseTo(90)
  })

  it('discards an unparseable numeric entry rather than guessing', () => {
    const s = useEditor.getState()
    s.typeNumeric('.')
    useEditor.getState().commitNumeric()
    expect(useEditor.getState().numeric.lockedLength).toBeNull()
  })

  it('toggles axis locks', () => {
    useEditor.getState().setAxisLock('x')
    expect(useEditor.getState().axisLock).toBe('x')
    useEditor.getState().setAxisLock('none')
    expect(useEditor.getState().axisLock).toBe('none')
  })

  it('plan mode forces an orthographic camera and a cut view', () => {
    useEditor.getState().setViewMode('plan')
    expect(useEditor.getState().projection).toBe('ortho')
    expect(useEditor.getState().cutViewEnabled).toBe(true)
  })

  it('toggling snap types is independent per type', () => {
    const before = useEditor.getState().snapToggles.endpoint
    useEditor.getState().toggleSnapType('endpoint')
    expect(useEditor.getState().snapToggles.endpoint).toBe(!before)
    expect(useEditor.getState().snapToggles.midpoint).toBe(true)
  })

  it('switching level moves the work plane to that level', () => {
    const two = addLevel(useEditor.getState().scene, 'L2')
    useEditor.getState().loadScene(two, two.levels[0].id)
    useEditor.getState().setActiveLevel(two.levels[1].id)
    const plane = useEditor.getState().workPlane
    expect(plane.origin[1]).toBeCloseTo(2.8)
    expect(plane.source.kind).toBe('level')
  })
})

// ---------------------------------------------------------------------------
// Unit-aware input
// ---------------------------------------------------------------------------

describe('parseLengthInput', () => {
  it('parses bare numbers in the document units', () => {
    expect(parseLengthInput('2.4', 'm')).toBeCloseTo(2.4)
    expect(parseLengthInput('2400', 'mm')).toBeCloseTo(2.4)
    expect(parseLengthInput('240', 'cm')).toBeCloseTo(2.4)
    expect(parseLengthInput('10', 'ft')).toBeCloseTo(3.048)
  })

  it('parses explicit units regardless of the document', () => {
    expect(parseLengthInput('2400mm', 'm')).toBeCloseTo(2.4)
    expect(parseLengthInput('1.2m', 'mm')).toBeCloseTo(1.2)
    expect(parseLengthInput('30 cm', 'm')).toBeCloseTo(0.3)
    expect(parseLengthInput('12in', 'm')).toBeCloseTo(0.3048)
  })

  it('parses feet and inches', () => {
    expect(parseLengthInput(`3'6"`, 'm')).toBeCloseTo(3 * 0.3048 + 6 * 0.0254)
    expect(parseLengthInput(`8'`, 'm')).toBeCloseTo(8 * 0.3048)
    expect(parseLengthInput(`6"`, 'm')).toBeCloseTo(6 * 0.0254)
  })

  it('reads "8 6" as 8ft 6in in an imperial document', () => {
    expect(parseLengthInput('8 6', 'ft')).toBeCloseTo(8 * 0.3048 + 6 * 0.0254)
  })

  it('evaluates simple sums', () => {
    expect(parseLengthInput('2.4+0.3', 'm')).toBeCloseTo(2.7)
    expect(parseLengthInput('1000+200', 'mm')).toBeCloseTo(1.2)
  })

  it('returns null for unparseable input rather than guessing', () => {
    expect(parseLengthInput('', 'm')).toBeNull()
    expect(parseLengthInput('abc', 'm')).toBeNull()
    expect(parseLengthInput('2..4', 'm')).toBeNull()
    expect(parseLengthInput('2.4+abc', 'm')).toBeNull()
  })
})

describe('formatLength', () => {
  it('formats in the document units', () => {
    expect(formatLength(2.4, 'm')).toBe('2.400 m')
    expect(formatLength(2.4, 'mm')).toBe('2400 mm')
    expect(formatLength(2.4, 'cm')).toBe('240.0 cm')
    expect(formatLength(3 * 0.3048 + 6 * 0.0254, 'ft')).toBe(`3'6.0"`)
  })
})
