/** Short unique ids for scene elements. Prefixed by type for readability in the JSON. */
export function newId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.abs(Date.now() ^ (performance.now() * 1000)).toString(36)
  return `${prefix}-${uuid.slice(0, 8)}`
}
