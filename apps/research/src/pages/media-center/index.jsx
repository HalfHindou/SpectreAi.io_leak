import { Component } from 'react'
import { useTranslation, withTranslation } from 'react-i18next'
import MediaCenterPageComponent from './components/media-center-page'
import useSettingsStore from '@/store/useSettingsStore'
import { useIsMobile } from '@/hooks/useMediaQuery'

class MediaCenterErrorBoundaryInner extends Component {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(err) {
    console.error('[MediaCenter] Component crash:', err)
  }

  render() {
    const { t } = this.props
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: '300px', gap: '16px',
          color: 'var(--text-secondary)', fontFamily: 'var(--font-body)',
        }}>
          <h3 style={{ color: 'var(--text-primary)', margin: 0 }}>{t('mediaCenter.crashTitle')}</h3>
          <p style={{ margin: 0, fontSize: '0.875rem' }}>
            {this.state.error?.message || t('mediaCenter.crashFallback')}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '8px 20px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(255,255,255,0.04)', color: 'var(--text-primary)',
              cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500,
            }}
          >
            {t('mediaCenter.tryAgain')}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

const MediaCenterErrorBoundary = withTranslation()(MediaCenterErrorBoundaryInner)

export default function MediaCenterPage() {
  const dayMode = useSettingsStore((s) => s.dayMode)
  const isMobile = useIsMobile()
  // Touch i18n so the page subscribes to language changes.
  useTranslation()
  return (
    <MediaCenterErrorBoundary>
      <MediaCenterPageComponent dayMode={dayMode} isMobile={isMobile} />
    </MediaCenterErrorBoundary>
  )
}
