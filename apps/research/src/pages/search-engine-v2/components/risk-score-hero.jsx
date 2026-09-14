/**
 * RiskScoreHero — composite + 6-axis bars for DUE_DILIGENCE classification.
 * v2.1 stub.
 */
import { useTranslation } from 'react-i18next'
import './_stub.css'

export default function RiskScoreHero({ stream }) {
  const { t } = useTranslation()
  const inst = stream.slots?.institutional
  return (
    <div className="se2-stub">
      <div className="se2-stub-label">{t('searchEngineV2.riskScore.label', 'RISK SCORE')}</div>
      <div className="se2-stub-body">
        {inst
          ? t(
              'searchEngineV2.riskScore.body',
              'Score {{score}} · Grade {{grade}}. Full risk breakdown ships in v2.1.',
              {
                score: inst.score ?? '?',
                grade: inst.grade ?? '—',
              }
            )
          : t('searchEngineV2.riskScore.loading', 'Computing composite risk score…')}
      </div>
    </div>
  )
}
