/**
 * Text annotations and room tags (C3).
 *
 * Both are view-scoped documentation objects, like dimensions (C2): they reference the scene
 * graph rather than duplicating its data, so a room tag's area is always the room's CURRENT
 * area, not a snapshot taken when the tag was placed.
 */
import type { Annotation, Room, RoomTag, SceneGraph, Vec2 } from '../types/scene'
import { polygonArea, polygonCentroid } from './index'

// ---------------------------------------------------------------------------
// Annotations — text, labels, leaders
// ---------------------------------------------------------------------------

export interface ResolvedAnnotation {
  id: string
  kind: Annotation['kind']
  position: Vec2
  text: string
  rotation: number
  textHeight: number
  /** Leader arrow endpoints, or null for plain text/labels. */
  leaderFrom: Vec2 | null
  leaderTo: Vec2 | null
}

export function resolveAnnotation(ann: Annotation): ResolvedAnnotation {
  return {
    id: ann.id,
    kind: ann.kind,
    position: ann.position,
    text: ann.text,
    rotation: ann.rotation,
    textHeight: ann.textHeight,
    leaderFrom: ann.kind === 'leader' && ann.leaderTarget ? ann.position : null,
    leaderTo: ann.kind === 'leader' ? ann.leaderTarget : null,
  }
}

export function resolveAllAnnotations(scene: SceneGraph): ResolvedAnnotation[] {
  return scene.annotations.map(resolveAnnotation)
}

// ---------------------------------------------------------------------------
// Room tags
// ---------------------------------------------------------------------------

export interface ResolvedRoomTag {
  id: string
  roomId: string
  position: Vec2
  /** Pre-formatted lines — number/name/area, in that display order, only the enabled ones. */
  lines: string[]
}

function formatArea(sqMeters: number): string {
  return `${sqMeters.toFixed(1)} m²`
}

/**
 * Resolve one room tag against the live scene. Returns null when the room has been deleted —
 * an orphaned tag should disappear, not draw stale text.
 */
export function resolveRoomTag(scene: SceneGraph, tag: RoomTag): ResolvedRoomTag | null {
  const room = scene.rooms.find((r) => r.id === tag.roomId)
  if (!room) return null

  const position = tag.position ?? polygonCentroid(room.polygon)
  const lines: string[] = []
  if (tag.showName) lines.push(room.name)
  if (tag.showNumber) lines.push(room.number)
  if (tag.showArea) lines.push(formatArea(polygonArea(room.polygon)))

  return { id: tag.id, roomId: tag.roomId, position, lines }
}

export function resolveAllRoomTags(scene: SceneGraph): ResolvedRoomTag[] {
  return scene.roomTags
    .map((t) => resolveRoomTag(scene, t))
    .filter((t): t is ResolvedRoomTag => t !== null)
}

/** Default room tag for a newly tagged room — all three fields on, centred on the polygon. */
export function defaultRoomTag(id: string, viewId: string, room: Room): RoomTag {
  return {
    id,
    viewId,
    roomId: room.id,
    position: null,
    showArea: true,
    showNumber: true,
    showName: true,
  }
}
