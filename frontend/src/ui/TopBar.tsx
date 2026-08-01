import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditor, selectCanUndo, selectCanRedo } from '../scene/store'
import { exportScene, type ExportFormat } from '../export/exporters'
import {
  IconUndo,
  IconRedo,
  IconExport,
  IconSun,
  IconMoon,
  IconPlan,
  IconCube,
} from './Icons'

const FORMATS: ExportFormat[] = ['glb', 'obj', 'stl']

export default function TopBar() {
  const { t } = useTranslation()
  const undo = useEditor((s) => s.undo)
  const redo = useEditor((s) => s.redo)
  const canUndo = useEditor(selectCanUndo)
  const canRedo = useEditor(selectCanRedo)
  const scene = useEditor((s) => s.scene)
  const theme = useEditor((s) => s.theme)
  const setTheme = useEditor((s) => s.setTheme)
  const viewMode = useEditor((s) => s.viewMode)
  const setViewMode = useEditor((s) => s.setViewMode)
  const projection = useEditor((s) => s.projection)
  const setProjection = useEditor((s) => s.setProjection)
  const flash = useEditor((s) => s.flash)

  const [exporting, setExporting] = useState<ExportFormat | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

  const doExport = (format: ExportFormat) => {
    setExporting(format)
    setExportOpen(false)
    void exportScene(scene, format)
      .then(() => flash(`Exported ${format.toUpperCase()}`))
      .catch((err: unknown) => {
        console.error('Export failed', err)
        flash(`Export failed: ${err instanceof Error ? err.message : 'unknown error'}`, 'error')
      })
      .finally(() => setExporting(null))
  }

  return (
    <header
      style={{
        height: 'var(--h-topbar)',
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-8)',
        padding: '0 var(--sp-8)',
        background: 'var(--surface-250)',
        borderBottom: '1px solid var(--divider)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-8)', paddingRight: 'var(--sp-8)' }}>
        <Logo />
        <span style={{ fontSize: 'var(--fs-heading)', fontWeight: 'var(--fw-medium)' }}>
          ArchStudio
        </span>
      </div>

      <div className="divider" style={{ width: 1, height: 20, flex: 'none' }} />

      <span style={{ fontSize: 'var(--fs-body)', color: 'var(--text-dim)' }}>
        {t('project.untitled')}
      </span>

      <div className="spacer" />

      {/* Plan / 3D — a segmented control, the canonical CAD pattern for exclusive modes */}
      <Segmented
        options={[
          { value: 'plan', label: t('view.plan'), icon: <IconPlan /> },
          { value: '3d', label: t('view.threeD'), icon: <IconCube /> },
        ]}
        value={viewMode}
        onChange={(v) => setViewMode(v as 'plan' | '3d')}
      />

      <Segmented
        options={[
          { value: 'ortho', label: t('view.ortho') },
          { value: 'perspective', label: t('view.perspective') },
        ]}
        value={projection}
        onChange={(v) => setProjection(v as 'ortho' | 'perspective')}
        disabled={viewMode === 'plan'}
      />

      <div className="divider" style={{ width: 1, height: 20, flex: 'none' }} />

      <button
        className="icon-btn tip"
        data-tip={`${t('editor.undo')} (Ctrl+Z)`}
        onClick={undo}
        disabled={!canUndo}
        aria-label={t('editor.undo')}
      >
        <IconUndo />
      </button>
      <button
        className="icon-btn tip"
        data-tip={`${t('editor.redo')} (Ctrl+Y)`}
        onClick={redo}
        disabled={!canRedo}
        aria-label={t('editor.redo')}
      >
        <IconRedo />
      </button>

      <div style={{ position: 'relative' }}>
        <button
          className="btn"
          onClick={() => setExportOpen((v) => !v)}
          disabled={exporting !== null}
          style={{ gap: 'var(--sp-4)' }}
        >
          <IconExport />
          {exporting ? `${exporting.toUpperCase()}…` : t('project.export')}
        </button>
        {exportOpen && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-dropdown)' }}
              onClick={() => setExportOpen(false)}
            />
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                right: 0,
                minWidth: 140,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-base)',
                borderRadius: 'var(--r-md)',
                boxShadow: 'var(--shadow-high)',
                padding: 'var(--sp-4)',
                zIndex: 'calc(var(--z-dropdown) + 1)',
              }}
            >
              {FORMATS.map((f) => (
                <button
                  key={f}
                  className="tree-row"
                  style={{ width: '100%', height: 'var(--h-row)' }}
                  onClick={() => doExport(f)}
                >
                  {f.toUpperCase()}
                  <span className="spacer" />
                  <span style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-label)' }}>
                    {f === 'glb' ? 'glTF binary' : f === 'obj' ? 'Wavefront' : 'Stereolith.'}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <button
        className="icon-btn tip"
        data-tip={theme === 'dark' ? t('theme.light') : t('theme.dark')}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        aria-label={t('theme.toggle')}
      >
        {theme === 'dark' ? <IconSun /> : <IconMoon />}
      </button>
    </header>
  )
}

function Logo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M9 1.5L16.5 6v9L9 16.5 1.5 15V6z" fill="var(--p-accent-500)" opacity="0.22" />
      <path
        d="M9 1.5L16.5 6v9L9 16.5 1.5 15V6z"
        fill="none"
        stroke="var(--p-accent-400)"
        strokeWidth="1.2"
      />
      <path d="M1.5 6L9 9.6 16.5 6M9 9.6v6.9" fill="none" stroke="var(--p-accent-400)" strokeWidth="1.2" />
    </svg>
  )
}

interface SegOption {
  value: string
  label: string
  icon?: React.ReactNode
}

/** Segmented control for 2–4 exclusive options, with a sliding 2px-radius indicator. */
function Segmented({
  options,
  value,
  onChange,
  disabled,
}: {
  options: SegOption[]
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        height: 'var(--h-control)',
        padding: 1,
        background: 'var(--bg-input)',
        border: '1px solid var(--border-base)',
        borderRadius: 'var(--r-sm)',
        opacity: disabled ? 0.4 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp-4)',
              padding: '0 var(--sp-8)',
              borderRadius: 'var(--r-sm)',
              fontSize: 'var(--fs-label)',
              fontWeight: 'var(--fw-medium)',
              background: active ? 'var(--bg-selected)' : 'transparent',
              color: active ? 'var(--text-default)' : 'var(--text-dim)',
              transition: 'background var(--t-quick)',
            }}
          >
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
