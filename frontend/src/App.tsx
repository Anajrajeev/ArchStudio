import { useEffect } from 'react'
import TopBar from './ui/TopBar'
import ToolRibbon from './ui/ToolRibbon'
import LeftPanel from './ui/LeftPanel'
import PropertiesPanel from './ui/PropertiesPanel'
import StatusBar from './ui/StatusBar'
import ViewportHints from './ui/ViewportHints'
import Marquee from './ui/Marquee'
import ViewportBoundary from './ui/ViewportBoundary'
import Viewport from './viewport/Viewport'
import { useEditor, type Tool } from './scene/store'
import { deleteElement } from './scene/mutations'
import { commitActiveTool } from './editor/commit'
import { isLoopTool, isPathTool } from './editor/tools'

/** Single-key tool shortcuts, in the SketchUp/Blender style. */
const TOOL_KEYS: Record<string, Tool> = {
  s: 'select',
  w: 'wall',
  f: 'slab',
  r: 'room',
  d: 'door',
  n: 'window',
  c: 'column',
  b: 'beam',
  m: 'measure',
  t: 'trim',
  e: 'extend',
  k: 'split',
  o: 'offset',
  i: 'dimension',
  g: 'roomtag',
  x: 'text',
  l: 'leader',
  y: 'columngrid',
  u: 'roof',
  v: 'primitive',
  h: 'stair',
  j: 'railing',
  q: 'ceiling',
  z: 'spot',
}

export default function App() {
  const theme = useEditor((s) => s.theme)

  // Apply the stored theme to the document root so the token layer picks it up.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useKeyboardLayer()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <TopBar />
      <ToolRibbon />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <LeftPanel />
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <ViewportBoundary>
            <Viewport />
            <ViewportHints />
            <Marquee />
          </ViewportBoundary>
        </div>
        <PropertiesPanel />
      </div>
      <StatusBar />
    </div>
  )
}

/**
 * Window-level keyboard handling. Two rules make this work:
 *  - never steal keys from a real input (otherwise typing in the properties panel breaks);
 *  - route Esc/Enter and digits to the ACTIVE TOOL's state machine, not to the browser.
 *
 * "Just start typing" is what makes listening dimensions reachable, and getting this wrong makes
 * every other precision feature unusable.
 */
function useKeyboardLayer(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      if (typing) return

      const s = useEditor.getState()
      const mod = e.ctrlKey || e.metaKey

      // ---- history
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        s.undo()
        return
      }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault()
        s.redo()
        return
      }
      if (mod) return // leave other browser shortcuts alone

      // ---- Repeat last operation (D7): Space, at rest — an in-progress pick or a typed number
      // owns the key otherwise, so this only fires between operations, never mid-gesture.
      if (e.key === ' ' && s.toolPhase === 'idle' && !s.numeric.buffer) {
        e.preventDefault()
        s.repeatLastOperation()
        return
      }

      // ---- numeric entry (listening dimensions): digits go to the tool, not the browser
      if (s.toolPhase === 'collecting' || s.tool !== 'select') {
        if (/^[0-9]$/.test(e.key) || e.key === '.' || e.key === "'" || e.key === '"') {
          e.preventDefault()
          s.typeNumeric(e.key)
          return
        }
        if (e.key === 'Backspace' && s.numeric.buffer) {
          e.preventDefault()
          s.backspaceNumeric()
          return
        }
        if (e.key === 'Tab') {
          // Tab can do two things depending on context:
          // 1. If there's a numeric buffer, switch between length/angle fields (listening dimensions).
          // 2. If there are snap candidates, cycle through them (A6).
          e.preventDefault()
          if (s.numeric.buffer) {
            s.toggleNumericField()
          } else if (s.snapCandidates && s.snapCandidates.length > 0) {
            s.cycleSnapCandidate()
          }
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          if (s.numeric.buffer) s.commitNumeric()
          // Enter closes an in-progress loop (slab/room).
          else if (isLoopTool(s.tool) && s.points.length >= 3) commitActiveTool(s.points)
          // Enter finishes an open path (railing, B3) — it never closes on its own.
          else if (isPathTool(s.tool) && s.points.length >= 2) commitActiveTool(s.points)
          return
        }
        // Axis locking, with visible feedback in the status bar.
        if (e.key.toLowerCase() === 'x' && s.toolPhase === 'collecting') {
          e.preventDefault()
          s.setAxisLock(s.axisLock === 'x' ? 'none' : 'x')
          return
        }
        if (e.key.toLowerCase() === 'y' && s.toolPhase === 'collecting') {
          e.preventDefault()
          s.setAxisLock(s.axisLock === 'y' ? 'none' : 'y')
          return
        }
      }

      // ---- Esc: cancel the operation, then the selection
      if (e.key === 'Escape') {
        e.preventDefault()
        if (s.toolPhase === 'collecting' || s.points.length > 0) s.cancelTool()
        else if (s.selectedIds.length > 0) s.select(null)
        else s.setTool('select')
        return
      }

      // ---- Backspace removes the last placed point mid-loop
      if (e.key === 'Backspace' && s.points.length > 0) {
        e.preventDefault()
        s.popPoint()
        return
      }

      // ---- Delete selection
      if (e.key === 'Delete') {
        if (s.selectedIds.length === 0) return
        e.preventDefault()
        const ids = s.selectedIds
        s.commit('Delete element', (sc) => ids.reduce((acc, id) => deleteElement(acc, id), sc))
        s.select(null)
        return
      }

      // ---- View presets, numpad-style (Blender/AutoCAD convention)
      if (e.key === '1') {
        e.preventDefault()
        s.setViewMode('plan')
        return
      }
      if (e.key === '2') {
        e.preventDefault()
        s.setViewMode('3d')
        return
      }
      if (e.key === '5') {
        e.preventDefault()
        s.setProjection(s.projection === 'ortho' ? 'perspective' : 'ortho')
        return
      }

      // ---- Level navigation
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault()
        const sorted = [...s.scene.levels].sort((a, b) => a.elevation - b.elevation)
        const i = sorted.findIndex((l) => l.id === s.activeLevelId)
        const next = sorted[i + (e.key === 'PageUp' ? 1 : -1)]
        if (next) s.setActiveLevel(next.id)
        return
      }

      // ---- A toggles the wall tool between straight and 3-point arc
      if (e.key.toLowerCase() === 'a' && s.tool === 'wall') {
        e.preventDefault()
        s.setWallMode(s.wallMode === 'arc' ? 'line' : 'arc')
        return
      }

      // ---- A toggles the slab tool between a new solid and cutting an opening (B8)
      if (e.key.toLowerCase() === 'a' && s.tool === 'slab') {
        e.preventDefault()
        s.setSlabMode(s.slabMode === 'opening' ? 'solid' : 'opening')
        return
      }

      // ---- Tool shortcuts
      const tool = TOOL_KEYS[e.key.toLowerCase()]
      if (tool) {
        e.preventDefault()
        s.setTool(tool)
        return
      }

      // ---- Work plane
      // Shift+P pins the plane to the selected element's top face (A3); P releases it back to the
      // level plane. Alt+[ / Alt+] step through the planes the user has chosen.
      if (e.key.toLowerCase() === 'p') {
        e.preventDefault()
        if (e.shiftKey) s.setWorkPlaneToSelection()
        else s.resetWorkPlaneToLevel()
        return
      }
      if (e.altKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault()
        if (e.key === '[') s.goPreviousPlane()
        else s.goNextPlane()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
