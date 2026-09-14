/**
 * Rotations - domain-to-domain attention flow driven by useXDashSurface
 * on /api/xdash/intel/domain-rotations. Each row shows a from -> to flow
 * with transition / author / engagement counts and the carrying authors.
 */
import { useMemo } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { useXDashSurface } from '@/hooks/useXDashSurface'
import InfoTip from '@/components/InfoTip'
import { getMetricInfo } from '@/constants/socialMetricsGlossary'
import {
  Shimmer, EmptyState, ErrorState, ArrowFlowIcon, Num,
} from '../xd-bits'
import { XDRotationsFlow } from '../xd-charts'
import { formatNum, formatPercent } from '../x-dash-utils'

function FlowRow({ row, onOpenAuthor }) {
  const { t } = useTranslation()
  const from = row.from_domain || {}
  const to = row.to_domain || {}
  const topAuthors = row.payload?.top_authors || []

  return (
    <div className="xd-flow-row">
      <div className="xd-flow-row__domains">
        <div className="xd-flow-domain xd-flow-domain--from">
          <span className="xd-flow-domain__role">{t('xDash.rotations.from', 'From')}</span>
          <span className="xd-flow-domain__label">{from.label || from.key || '-'}</span>
        </div>
        <div className="xd-flow-arrow"><ArrowFlowIcon size={18} /></div>
        <div className="xd-flow-domain">
          <span className="xd-flow-domain__role">{t('xDash.rotations.to', 'To')}</span>
          <span className="xd-flow-domain__label">{to.label || to.key || '-'}</span>
        </div>
      </div>

      <div className="xd-flow-row__metrics">
        <div className="xd-flow-metric">
          <span className="xd-flow-metric__label">{t('xDash.rotations.metric.transitions', 'Transitions')}{getMetricInfo('transitions') && <InfoTip text={getMetricInfo('transitions')} position="right" />}</span>
          <span className="xd-flow-metric__value xd-num">{formatNum(row.transition_count)}</span>
        </div>
        <div className="xd-flow-metric">
          <span className="xd-flow-metric__label">{t('xDash.rotations.metric.authors', 'Authors')}</span>
          <span className="xd-flow-metric__value xd-num">{formatNum(row.author_count)}</span>
        </div>
        <div className="xd-flow-metric">
          <span className="xd-flow-metric__label">{t('xDash.rotations.metric.engagement', 'Engagement')}</span>
          <span className="xd-flow-metric__value xd-num">{formatNum(row.total_weighted_engagement, { maxFraction: 0 })}</span>
        </div>
      </div>

      {topAuthors.length > 0 && (
        <div className="xd-flow-row__authors">
          <span className="xd-flow-metric__label">{t('xDash.rotations.metric.carriers', 'Carriers')}</span>
          {topAuthors.slice(0, 3).map((a) => (
            <div className="xd-flow-author" key={a.author_id || a.screen_name}>
              <button
                type="button"
                className="xd-flow-author__name"
                onClick={() => onOpenAuthor(a.author_id)}
              >
                @{a.screen_name}
              </button>
              {a.current_domain_share != null && (
                <span className="xd-cell-muted xd-num">{formatPercent(a.current_domain_share)}</span>
              )}
              <span className="xd-flow-author__eng xd-num">{formatNum(a.weighted_engagement, { maxFraction: 0 })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function XDRotations({ onOpenAuthor }) {
  const { t } = useTranslation()
  const params = useMemo(() => ({ limit: 40 }), [])
  const { data, loading, error, refetch } = useXDashSurface('/api/xdash/intel/domain-rotations', params)

  if (loading && !data) return <Shimmer variant="row" count={8} />
  if (error) return <ErrorState message={error} onRetry={refetch} />

  const rows = data?.rows || []

  if (rows.length === 0) {
    return (
      <EmptyState
        title={t('xDash.rotations.empty.title', 'No domain rotations detected')}
        detail={t('xDash.rotations.empty.detail', 'No creators shifted their dominant domain in the last snapshot. Rotations surface when attention moves between sectors.')}
      />
    )
  }

  return (
    <div>
      <div className="xd-view-banner">
        <Trans
          i18nKey="xDash.rotations.banner"
          defaults="Attention flows between sectors — <b>{{count}}</b> domain rotations in the latest snapshot"
          values={{ count: rows.length }}
          components={{ b: <b /> }}
        />
      </div>
      {/* sankey-style flow diagram - from-domain -> to-domain, edge width by transition count */}
      <div className="xd-view-chart">
        <div className="xd-view-chart__label">{t('xDash.rotations.flowChart', 'Rotation flow')}{getMetricInfo('rotationFlow') && <InfoTip text={getMetricInfo('rotationFlow')} position="top" />}</div>
        <XDRotationsFlow rows={rows} loading={false} />
      </div>
      <div className="xd-flow-list">
        {rows.map((row, i) => (
          <FlowRow
            key={`${row.from_domain?.key}-${row.to_domain?.key}-${i}`}
            row={row}
            onOpenAuthor={onOpenAuthor}
          />
        ))}
      </div>
    </div>
  )
}
