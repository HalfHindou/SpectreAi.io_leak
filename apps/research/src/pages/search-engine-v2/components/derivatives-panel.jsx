/**
 * DerivativesPanel — funding rates + OI + liquidations.
 * v2.1 stub.
 */
import { useTranslation } from 'react-i18next'
import './_stub.css'

export default function DerivativesPanel({ stream }) {
  const { t } = useTranslation()
  const funding = stream.slots?.funding
  const liquidations = stream.slots?.liquidations
  return (
    <div className="se2-stub">
      <div className="se2-stub-label">{t('searchEngineV2.derivatives.label', 'DERIVATIVES')}</div>
      <div className="se2-stub-body">
        {funding || liquidations
          ? t('searchEngineV2.derivatives.live', 'Funding + OI + liquidations data live. Full heatmap UI ships in v2.1.')
          : t('searchEngineV2.derivatives.loading', 'Pulling funding rates and liquidation flows…')}
      </div>
    </div>
  )
}
