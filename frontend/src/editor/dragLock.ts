/**
 * A one-bit lock saying "a handle is being dragged, don't also start a whole-element move".
 *
 * Needed because the two layers listen at different levels: `Handles.tsx` uses r3f's synthetic
 * pointer events (which is how it gets a raycast hit at all), while `Interaction.tsx` listens for
 * native events on the canvas so it can resolve pointer positions without a mesh under the cursor.
 * `stopPropagation` on a synthetic event does not reach a native listener on the same element, so
 * the handoff has to be explicit.
 *
 * Module state rather than store state on purpose: this changes on every pointerdown and lives for
 * the length of one gesture. Putting it in the store would re-render the whole editor twice per
 * drag for something no component needs to display.
 */

let dragging = false

export function beginHandleDrag(): void {
  dragging = true
}

export function endHandleDrag(): void {
  dragging = false
}

/** True while a parametric handle owns the gesture. */
export function isHandleDragging(): boolean {
  return dragging
}
