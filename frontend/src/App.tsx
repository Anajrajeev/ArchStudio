import { useTranslation } from 'react-i18next'

export default function App() {
  const { t } = useTranslation()

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>ArchStudio</h1>
        <p style={{ color: '#888' }}>{t('app.tagline', 'AI-Powered Architectural Design')}</p>
        <p style={{ color: '#555', fontSize: '0.85rem', marginTop: '2rem' }}>
          Phase 0 scaffold — Phase 1 coming next
        </p>
      </div>
    </div>
  )
}
