import { useTranslation } from 'react-i18next'

const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
    <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
  </svg>
)

function timeAgoShort(isoDate, t) {
  if (!isoDate) return ''
  const diff = Date.now() - new Date(isoDate).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('mediaCenter.time.justNow')
  if (mins < 60) return t('mediaCenter.time.mAgo', { n: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('mediaCenter.time.hAgo', { n: hrs })
  return t('mediaCenter.time.dAgo', { n: Math.floor(hrs / 24) })
}

const MediaTabHeader = ({ title, lastRefreshed, loading, onRefresh, children }) => {
  const { t } = useTranslation()
  return (
    <div className="mc-tab-header">
      <div className="mc-tab-header-left">
        <h2 className="mc-tab-title">{title}</h2>
        {children}
      </div>
      <div className="mc-tab-header-right">
        {lastRefreshed && (
          <span className="mc-tab-timestamp">{timeAgoShort(lastRefreshed, t)}</span>
        )}
        <button
          type="button"
          className={`mc-refresh-btn${loading ? ' spinning' : ''}`}
          onClick={onRefresh}
          disabled={loading}
          title={t('mediaCenter.refresh')}
        >
          <RefreshIcon />
        </button>
      </div>
    </div>
  )
}

export default MediaTabHeader
