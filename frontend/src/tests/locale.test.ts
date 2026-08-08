/**
 * Guards against a translation key existing in code but not in the locale file — exactly the bug
 * a live browser check caught while verifying B7/B2/B3: `PropertiesPanel.tsx` reads
 * `properties.kind.${element.kind}` for every selected element, and `primitive`/`boolean` (B7)
 * and later `stair`/`railing` (B2/B3) were never added to `locales/en.json`, so the Properties
 * panel showed the literal untranslated key instead of a label. A missing STRING never fails
 * `tsc` or ESLint — this is the only automated check that would have caught it.
 */
import { describe, it, expect } from 'vitest'
import en from '../locales/en.json'
import type { ElementKind } from '../scene/mutations'

// Kept in sync with `ElementKind` by hand — TS unions have no runtime form to derive this from.
const ELEMENT_KINDS: ElementKind[] = [
  'level',
  'wall',
  'opening',
  'filling',
  'slab',
  'column',
  'beam',
  'room',
  'furniture',
  'dimension',
  'annotation',
  'roomTag',
  'columnGrid',
  'roof',
  'primitive',
  'boolean',
  'stair',
  'railing',
  'ceiling',
]

describe('properties.kind translations', () => {
  it('has a label for every ElementKind PropertiesPanel can render', () => {
    for (const kind of ELEMENT_KINDS) {
      const label = (en.properties.kind as Record<string, string | undefined>)[kind]
      expect(label, `properties.kind.${kind} is missing from locales/en.json`).toBeTruthy()
    }
  })
})
