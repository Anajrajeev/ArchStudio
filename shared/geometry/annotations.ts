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

/**
 * Spot elevation/coordinate/slope (C4) are computed from numbers sampled at PLACEMENT time
 * (`Annotation.elevation`/`slope`, and `position` itself for coordinate) rather than a live
 * reference to a host element — see DECISIONS.md for why that scope was chosen. Resolving the
 * DISPLAY TEXT here rather than storing it means a unit or formatting change updates every spot
 * tag automatically, the same reasoning `resolveDimension`'s auto-computed text uses.
 */
function formatElevation(metres: number): string {
  return `${metres >= 0 ? '+' : ''}${metres.toFixed(3)}`
}

function formatCoordinate(p: Vec2): string {
  return `X ${p[0].toFixed(3)}, Y ${p[1].toFixed(3)}`
}

function formatSlope(percent: number): string {
  return `${percent.toFixed(1)}%`
}

function spotText(ann: Annotation): string {
  switch (ann.kind) {
    case 'spot-elevation':
      return ann.elevation === null ? '—' : formatElevation(ann.elevation)
    case 'spot-coordinate':
      return formatCoordinate(ann.position)
    case 'spot-slope':
      return ann.slope === null ? '—' : formatSlope(ann.slope)
    default:
      return ann.text
  }
}

export function resolveAnnotation(ann: Annotation): ResolvedAnnotation {
  return {
    id: ann.id,
    kind: ann.kind,
    position: ann.position,
    text: spotText(ann),
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
