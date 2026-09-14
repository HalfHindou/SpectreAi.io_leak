/**
 * WhalesPanel — large transactions for WHALE_TRACKING / ONCHAIN.
 * v2.1 stub.
 */
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import './_stub.css'

export default function WhalesPanel({ stream }) {
  const { t } = useTranslation()
  const whales = stream.slots?.whales
  const count = Array.isArray(whales) ? whales.length : 0
  return (
    <div className="se2-stub">
      <div className="se2-stub-label">{t('searchEngineV2.whales.label', 'WHALE FLOW')}</div>
      <div className="se2-stub-body">
        {count > 0
          ? t(
              'searchEngineV2.whales.detected',
              '{{count}} whale transactions in the window. Full table view ships in v2.1.',
              { count: new Intl.NumberFormat(i18n.language).format(count) }
            )
          : t('searchEngineV2.whales.scanning', 'Scanning for whale movements…')}
      </div>
    </div>
  )
}
