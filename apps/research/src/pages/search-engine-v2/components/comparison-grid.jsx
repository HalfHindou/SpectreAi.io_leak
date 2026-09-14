/**
 * ComparisonGrid — side-by-side asset columns for COMPARISON classification.
 * Stub for v2.1 — renders a placeholder until the comparison data extractor
 * + side-by-side metric diff ships. The classification-config still routes
 * COMPARISON queries here so we don't need to special-case the shell.
 */
import { useTranslation } from 'react-i18next'
import './_stub.css'

export default function ComparisonGrid({ stream }) {
  const { t } = useTranslation()
  const assets = stream.meta?.assets || []
  return (
    <div className="se2-stub">
      <div className="se2-stub-label">{t('searchEngineV2.comparison.label', 'COMPARISON')}</div>
      <div className="se2-stub-body">
        {assets.length
          ? t(
              'searchEngineV2.comparison.bodyWithAssets',
              'Side-by-side asset diff ({{assets}}) ships next. For now the answer card below has the breakdown.',
              { assets: assets.join(' vs ') }
            )
          : t(
              'searchEngineV2.comparison.bodyNoAssets',
              'Side-by-side asset diff ships next. For now the answer card below has the breakdown.'
            )}
      </div>
    </div>
  )
}
