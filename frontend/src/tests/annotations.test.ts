/**
 * Tests for text annotations and room tags (C3) — pure geometry, no React.
 */
import { describe, it, expect } from 'vitest'
import {
  resolveAnnotation,
  resolveAllAnnotations,
  resolveRoomTag,
  resolveAllRoomTags,
  defaultRoomTag,
} from '../../../shared/geometry/annotations'
import { emptySceneGraph, type Annotation } from '../../../shared/types/scene'
import { addLevel, addRoom } from '../scene/mutations'

function scene() {
  const base = emptySceneGraph('p')
  const s1 = addLevel(base, 'Ground floor')
  const levelId = s1.levels[0].id
  const r1 = addRoom(s1, levelId, [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ])
  return { scene: r1.scene, levelId, roomId: r1.id }
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

describe('resolveAnnotation', () => {
  it('resolves a plain text annotation with no leader', () => {
    const ann: Annotation = {
      id: 'a1',
      viewId: 'v1',
      kind: 'text',
      text: 'Note',
      position: [1, 2],
      leaderTarget: null,
      rotation: 0,
      textHeight: 0.2,
    }
    const r = resolveAnnotation(ann)
    expect(r.leaderFrom).toBeNull()
    expect(r.leaderTo).toBeNull()
    expect(r.text).toBe('Note')
  })

  it('resolves a leader annotation with both endpoints', () => {
    const ann: Annotation = {
      id: 'a2',
      viewId: 'v1',
      kind: 'leader',
      text: 'See detail',
      position: [3, 3],
      leaderTarget: [1, 1],
      rotation: 0,
      textHeight: 0.2,
    }
    const r = resolveAnnotation(ann)
    expect(r.leaderFrom).toEqual([3, 3])
    expect(r.leaderTo).toEqual([1, 1])
  })

  it('a leader kind with no target resolves no leader line', () => {
    const ann: Annotation = {
      id: 'a3',
      viewId: 'v1',
      kind: 'leader',
      text: 'orphan',
      position: [0, 0],
      leaderTarget: null,
      rotation: 0,
      textHeight: 0.2,
    }
    const r = resolveAnnotation(ann)
    expect(r.leaderFrom).toBeNull()
  })
})

describe('resolveAllAnnotations', () => {
  it('resolves every annotation in the scene', () => {
    const { scene: sc } = scene()
    const anns: Annotation[] = [
      { id: 'a1', viewId: 'v1', kind: 'text', text: 'A', position: [0, 0], leaderTarget: null, rotation: 0, textHeight: 0.2 },
      { id: 'a2', viewId: 'v1', kind: 'label', text: 'B', position: [1, 1], leaderTarget: null, rotation: 0, textHeight: 0.2 },
    ]
    const withAnns = { ...sc, annotations: anns }
    expect(resolveAllAnnotations(withAnns)).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Room tags
// ---------------------------------------------------------------------------

describe('resolveRoomTag', () => {
  const { scene: sc } = scene()

  it('defaults to the polygon centroid when no override position is set', () => {
    const tag = defaultRoomTag('t1', 'v1', sc.rooms[0])
    const r = resolveRoomTag(sc, tag)!
    // Rectangle 0,0 -> 4,3: centroid at (2, 1.5)
    expect(r.position[0]).toBeCloseTo(2)
    expect(r.position[1]).toBeCloseTo(1.5)
  })

  it('uses the override position when set', () => {
    const tag = { ...defaultRoomTag('t2', 'v1', sc.rooms[0]), position: [10, 10] as [number, number] }
    const r = resolveRoomTag(sc, tag)!
    expect(r.position).toEqual([10, 10])
  })

  it('includes only the enabled lines, in name/number/area order', () => {
    const tag = defaultRoomTag('t3', 'v1', sc.rooms[0])
    const r = resolveRoomTag(sc, tag)!
    expect(r.lines).toHaveLength(3)
    expect(r.lines[0]).toBe(sc.rooms[0].name)
    expect(r.lines[1]).toBe(sc.rooms[0].number)
    expect(r.lines[2]).toMatch(/m²/)
  })

  it('respects individual show flags', () => {
    const tag = { ...defaultRoomTag('t4', 'v1', sc.rooms[0]), showNumber: false, showArea: false }
    const r = resolveRoomTag(sc, tag)!
    expect(r.lines).toHaveLength(1)
  })

  it('computes the correct area for the rectangle', () => {
    const tag = defaultRoomTag('t5', 'v1', sc.rooms[0])
    const r = resolveRoomTag(sc, tag)!
    // 4 x 3 = 12 m²
    expect(r.lines[2]).toBe('12.0 m²')
  })

  it('returns null for a deleted room — an orphaned tag disappears', () => {
    const tag = defaultRoomTag('t6', 'v1', { ...sc.rooms[0], id: 'no-such-room' })
    expect(resolveRoomTag(sc, tag)).toBeNull()
  })
})

describe('resolveAllRoomTags', () => {
  it('drops tags for deleted rooms and keeps valid ones', () => {
    const { scene: sc } = scene()
    const good = defaultRoomTag('t1', 'v1', sc.rooms[0])
    const orphan = { ...defaultRoomTag('t2', 'v1', sc.rooms[0]), roomId: 'gone' }
    const withTags = { ...sc, roomTags: [good, orphan] }
    const result = resolveAllRoomTags(withTags)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t1')
  })
})
