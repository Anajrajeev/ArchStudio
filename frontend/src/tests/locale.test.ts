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
import type { Tool } from '../scene/store'

/**
 * `Record<ElementKind, true>` rather than a hand-kept array: a union has no runtime form, but a
 * total Record over it does, so ADDING a kind to `ElementKind` without adding it here now fails
 * `tsc`. The previous hand-maintained array silently narrowed instead — the same class of drift
 * this file exists to catch, one level up.
 */
const ELEMENT_KINDS: Record<ElementKind, true> = {
  level: true,
  wall: true,
  opening: true,
  filling: true,
  slab: true,
  column: true,
  beam: true,
  room: true,
  furniture: true,
  dimension: true,
  annotation: true,
  roomTag: true,
  columnGrid: true,
  roof: true,
  primitive: true,
  boolean: true,
  stair: true,
  railing: true,
  ceiling: true,
  curtainWall: true,
  wallJoin: true,
  group: true,
  planRegion: true,
}

/** Same trick for the tool ribbon, which the original version of this test did not cover. */
const TOOLS: Record<Tool, true> = {
  select: true,
  wall: true,
  slab: true,
  door: true,
  window: true,
  column: true,
  beam: true,
  room: true,
  measure: true,
  dimension: true,
  roomtag: true,
  text: true,
  leader: true,
  trim: true,
  extend: true,
  split: true,
  offset: true,
  columngrid: true,
  roof: true,
  primitive: true,
  stair: true,
  railing: true,
  ceiling: true,
  spot: true,
  curtainwall: true,
  planregion: true,
}

describe('properties.kind translations', () => {
  it('has a label for every ElementKind PropertiesPanel can render', () => {
    for (const kind of Object.keys(ELEMENT_KINDS)) {
      const label = (en.properties.kind as Record<string, string | undefined>)[kind]
      expect(label, `properties.kind.${kind} is missing from locales/en.json`).toBeTruthy()
    }
  })
})

describe('editor.tools translations', () => {
  it('has a label for every tool the ribbon and shortcuts can activate', () => {
    for (const tool of Object.keys(TOOLS)) {
      const label = (en.editor.tools as Record<string, string | undefined>)[tool]
      expect(label, `editor.tools.${tool} is missing from locales/en.json`).toBeTruthy()
    }
  })
})
