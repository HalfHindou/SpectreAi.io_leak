import React from 'react'
import { useNavigate } from 'react-router-dom'
import i18n from '@/i18n'
import GMDashboard from './components/gm-dashboard'
import useSettingsStore from '@/store/useSettingsStore'
import { useWatchlists } from '@/contexts/WatchlistsContext'

class GMErrorBoundary extends React.Component {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(err, info) { console.error('GMDashboard error:', err, info) }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: '#0f172a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', padding: 24 }}>
          <p style={{ marginBottom: 16 }}>{i18n.t('errors.gmDashboardError')}</p>
          <button type="button" onClick={() => this.props.onClose()} style={{ padding: '10px 20px', cursor: 'pointer', borderRadius: 8, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.1)', color: '#fff' }}>{i18n.t('common.close')}</button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function GMDashboardPage() {
  const navigate = useNavigate()
  const profile = useSettingsStore((s) => s.profile)
  const gmWidgets = useSettingsStore((s) => s.gmWidgets)
  const setGmWidget = useSettingsStore((s) => s.setGmWidget)
  const gmSound = useSettingsStore((s) => s.gmSound)
  const setGmSound = useSettingsStore((s) => s.setGmSound)
  const { watchlist } = useWatchlists() || {}

  return (
    <GMErrorBoundary onClose={() => navigate('/')}>
      <GMDashboard
        profile={profile}
        onClose={() => navigate('/')}
        gmWidgets={gmWidgets}
        setGmWidget={setGmWidget}
        gmSound={gmSound}
        setGmSound={setGmSound}
        watchlistTokens={watchlist}
      />
    </GMErrorBoundary>
  )
}
