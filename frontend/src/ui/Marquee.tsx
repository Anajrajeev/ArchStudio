/**
 * The rubber-band selection box (A5).
 *
 * DOM rather than WebGL, for the same reason the HUD labels are (D-015): it is a screen-space
 * rectangle, so drawing it in screen space is both simpler and crisper, and it has no GL capability
 * requirements.
 *
 * The border encodes the mode, which is the only cue telling the user *which* select they are about
 * to get — and getting crossing when you expected window is the classic surprise:
 *  - **window** (drag left → right, only fully-enclosed elements): SOLID border
 *  - **crossing** (drag right → left, anything touched): DASHED border
 */
import { useEditor } from '../scene/store'

export default function Marquee() {
  const marquee = useEditor((s) => s.marquee)
  if (!marquee) return null

  const { start, current, mode } = marquee
  const left = Math.min(start[0], current[0])
  const top = Math.min(start[1], current[1])
  const width = Math.abs(current[0] - start[0])
  const height = Math.abs(current[1] - start[1])

  // Crossing reaches further, so it reads as the more "active" of the two.
  const color = mode === 'crossing' ? 'var(--p-inference)' : 'var(--p-select)'

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        border: `1px ${mode === 'crossing' ? 'dashed' : 'solid'} ${color}`,
        // A tint just strong enough to read the box as an area, not a wireframe.
        background: mode === 'crossing' ? 'rgb(217 70 239 / 10%)' : 'rgb(255 128 0 / 10%)',
        pointerEvents: 'none',
      }}
    />
  )
}
