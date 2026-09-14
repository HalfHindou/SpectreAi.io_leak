/**
 * MacroNarrativeGrid — market-wide stat strip + sector heatmap.
 * v2.1 stub.
 */
import { useTranslation } from 'react-i18next'
import i18n from 'i18next'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import './_stub.css'

export default function MacroNarrativeGrid({ stream }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  const fg = stream.slots?.feargreed
  const global = stream.slots?.global

  if (!fg && !global) {
    return (
      <div className="se2-stub">
        <div className="se2-stub-label">{t('searchEngineV2.macro.label', 'MARKET PULSE')}</div>
        <div className="se2-stub-body">
          {t('searchEngineV2.macro.loading', 'Pulling fear & greed, dominance, sector flows…')}
        </div>
      </div>
    )
  }

  // Build the inline summary parts so the locale joiner can handle " · "
  // consistently. Each part is its own translated phrase to keep word order
  // flexible across languages.
  const parts = []
  if (fg?.value != null) {
    parts.push(
      t('searchEngineV2.macro.fearGreed', 'F&G {{value}} ({{label}})', {
        value: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(fg.value),
        label: fg.label || '',
      })
    )
  }
  if (global?.totalMarketCap != null) {
    // Currency-aware total market cap formatter — was hardcoded `$xT` before.
    parts.push(
      t('searchEngineV2.macro.totalMcap', 'Total mcap {{value}}', {
        value: fmtLargeShort(global.totalMarketCap),
      })
    )
  }
  if (global?.btcDominance != null) {
    parts.push(
      t('searchEngineV2.macro.btcDominance', 'BTC.D {{value}}%', {
        value: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(global.btcDominance),
      })
    )
  }

  return (
    <div className="se2-stub">
      <div className="se2-stub-label">{t('searchEngineV2.macro.label', 'MARKET PULSE')}</div>
      <div className="se2-stub-body">{parts.join(' · ')}</div>
    </div>
  )
}
