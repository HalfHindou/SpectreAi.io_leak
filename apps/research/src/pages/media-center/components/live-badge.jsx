import { useTranslation } from 'react-i18next'
import './live-badge.css'

const LiveBadge = ({ className = '' }) => {
  const { t } = useTranslation()
  return (
    <span className={`mc-live-badge ${className}`.trim()}>
      <span className="mc-live-dot-sm" />
      {t('mediaCenter.tabs.live').toUpperCase()}
    </span>
  )
}

export default LiveBadge
