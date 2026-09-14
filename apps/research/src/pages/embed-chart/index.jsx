/**
 * EmbedChartPage — thin route wrapper for /embed/chart/:cgId.
 * Reads the CoinGecko ID from the route param and renders the chart.
 * Shows a minimal "Token not found" message on empty/invalid param.
 */
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import EmbedChart from './components/embed-chart'
import './components/embed-chart.css'

export default function EmbedChartPage() {
  const { t } = useTranslation()
  const { cgId } = useParams()
  if (!cgId) {
    return (
      <div className="embed-chart-root">
        <div className="embed-chart-error">
          <p>{t('embedChart.missingToken', 'Missing token ID.')}</p>
        </div>
      </div>
    )
  }
  return <EmbedChart cgId={cgId} />
}
