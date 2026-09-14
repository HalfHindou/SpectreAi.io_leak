/**
 * DiscoveryGrid — ranked token cards with sparklines for DISCOVERY/MOVERS/MEME.
 * v2.1 stub. The answer card still gets all the synthesis prose.
 */
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import './_stub.css'

export default function DiscoveryGrid({ stream }) {
  const { t } = useTranslation()
  const hot = stream.slots?.hot
  const newTokens = stream.slots?.new
  const gainers = stream.slots?.gainers
  const losers = stream.slots?.losers
  const count = [hot, newTokens, gainers, losers].reduce(
    (n, arr) => n + (Array.isArray(arr) ? arr.length : 0),
    0
  )
  return (
    <div className="se2-stub">
      <div className="se2-stub-label">{t('searchEngineV2.discovery.label', 'DISCOVERY')}</div>
      <div className="se2-stub-body">
        {count > 0
          ? t(
              'searchEngineV2.discovery.detected',
              '{{count}} tokens detected. Rich table view ships in v2.1.',
              { count: new Intl.NumberFormat(i18n.language).format(count) }
            )
          : t('searchEngineV2.discovery.scanning', 'Scanning on-chain for new and trending tokens…')}
      </div>
    </div>
  )
}
