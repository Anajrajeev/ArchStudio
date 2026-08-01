/**
 * Text annotations and room tags (C3).
 *
 * Same rendering approach as `Dimensions.tsx`: geometry-only data in, drei's `<Line>` for leaders
 * and a DOM `<Html>` label for text — no Troika dependency (see Overlays.tsx for why).
 */
import { useMemo } from 'react'
import { Line, Html } from '@react-three/drei'
import * as THREE from 'three'
import { useEditor } from '../scene/store'
import {
  resolveAllAnnotations,
  resolveAllRoomTags,
  type ResolvedAnnotation,
  type ResolvedRoomTag,
} from '../../../shared/geometry/annotations'
import { planeElevation } from '../../../shared/geometry/workplane'

const ELEV_OFFSET = 0.012

export default function Annotations() {
  const scene = useEditor((s) => s.scene)
  const workPlane = useEditor((s) => s.workPlane)
  const y = planeElevation(workPlane) + ELEV_OFFSET

  const annotations = useMemo(() => resolveAllAnnotations(scene), [scene])
  const roomTags = useMemo(() => resolveAllRoomTags(scene), [scene])

  if (annotations.length === 0 && roomTags.length === 0) return null

  return (
    <group>
      {annotations.map((a) => (
        <OneAnnotation key={a.id} ann={a} y={y} />
      ))}
      {roomTags.map((t) => (
        <OneRoomTag key={t.id} tag={t} y={y} />
      ))}
    </group>
  )
}

function v2to3(p: [number, number], y: number): THREE.Vector3 {
  return new THREE.Vector3(p[0], y, p[1])
}

function OneAnnotation({ ann, y }: { ann: ResolvedAnnotation; y: number }) {
  const textPos = v2to3(ann.position, y + 0.002)

  return (
    <>
      {ann.leaderFrom && ann.leaderTo && (
        <Line
          points={[v2to3(ann.leaderFrom, y), v2to3(ann.leaderTo, y)]}
          color="var(--dim-line, #6ca3c8)"
          lineWidth={1.2}
        />
      )}
      <Html position={textPos} center pointerEvents="none" zIndexRange={[10, 0]}>
        <span
          style={{
            fontSize: `calc(var(--fs-label) * ${ann.textHeight / 0.2})`,
            fontFamily: 'var(--font-sans, sans-serif)',
            fontWeight: ann.kind === 'label' ? 'var(--fw-medium)' : 'normal',
            color: 'var(--text-default)',
            background: ann.kind === 'label' ? 'var(--surface-300)' : 'transparent',
            padding: ann.kind === 'label' ? '1px 4px' : 0,
            borderRadius: ann.kind === 'label' ? 2 : 0,
            whiteSpace: 'nowrap',
            userSelect: 'none',
            pointerEvents: 'none',
            transform: `rotate(${-ann.rotation}deg)`,
            display: 'inline-block',
          }}
        >
          {ann.text}
        </span>
      </Html>
    </>
  )
}

function OneRoomTag({ tag, y }: { tag: ResolvedRoomTag; y: number }) {
  const pos = v2to3(tag.position, y + 0.002)
  return (
    <Html position={pos} center pointerEvents="none" zIndexRange={[10, 0]}>
      <div
        style={{
          fontSize: 'var(--fs-label)',
          fontFamily: 'var(--font-sans, sans-serif)',
          color: 'var(--text-default)',
          textAlign: 'center',
          userSelect: 'none',
          pointerEvents: 'none',
          lineHeight: 1.3,
        }}
      >
        {tag.lines.map((line, i) => (
          <div key={i} style={{ fontWeight: i === 0 ? 'var(--fw-medium)' : 'normal' }}>
            {line}
          </div>
        ))}
      </div>
    </Html>
  )
}
