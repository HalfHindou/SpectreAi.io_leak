/**
 * New - genuinely FRESH tokens: ones that first crossed X Dash's detection
 * threshold in the last ~48h, newest first. This is "new tokens on the market"
 * (fresh launches just picking up social), NOT scored runners/signals (those
 * live on the Signals tab). An old token that's been mentioned for weeks does
 * NOT belong here - this board is sorted strictly by first-seen recency.
 */
import { useMemo } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { useXDashSurface } from '@/hooks/useXDashSurface'
import XDTokenTable, { flattenSurfaceRow } from './xd-token-table'
import { Pagination, Shimmer, EmptyState, ErrorState } from '../xd-bits'
import { relativeTime } from '../x-dash-utils'

/* Age since first detected: 45m / 6.7h. */
function ageColumn(row) {
  const hrs = Number(row.hours_since_discovery)
  if (!Number.isFinite(hrs)) return '-'
  if (hrs < 1) return `${Math.round(hrs * 60)}m`
  return `${hrs.toFixed(1)}h`
}

export default function XDFreshTokens({ controls, onOpenToken, perPage, onPerPage }) {
  const { t, i18n } = useTranslation()
  const params = useMemo(() => ({
    page: controls.page,
    perPage,
    timeframe: controls.timeframe,
    ranking: controls.ranking,
    segment: controls.segment,
    market: controls.market,
    minKols: 1,
  }), [controls.page, perPage, controls.timeframe, controls.ranking, controls.segment, controls.market])

  const { data, loading, error, refetch } = useXDashSurface('/api/xdash/new-tokens', params)

  if (loading && !data) return <Shimmer variant="row" count={8} />
  if (error) return <ErrorState message={error} onRetry={refetch} />

  const rawRows = data?.tokens || []
  // freshest first - the whole point is to catch tokens the moment they appear.
  const rows = rawRows.map(flattenSurfaceRow).sort((a, b) => {
    const ha = Number(a.hours_since_discovery)
    const hb = Number(b.hours_since_discovery)
    return (Number.isFinite(ha) ? ha : 1e9) - (Number.isFinite(hb) ? hb : 1e9)
  })
  const pagination = data?.pagination || {}
  const windowHours = data?.new_window_hours || 48

  return (
    <div>
      <div className="xd-view-banner">
        <Trans
          i18nKey="xDash.fresh.banner"
          defaults="Fresh tokens - first detected on X Dash in the last <b>{{hours}}h</b>, newest first. New launches just picking up social attention. Scored runners live on the Signals tab."
          values={{ hours: windowHours }}
          components={{ b: <b /> }}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={t('xDash.fresh.empty.title', 'No fresh tokens in this window')}
          detail={t('xDash.fresh.empty.detail', 'Nothing has crossed the detection threshold in the last {{hours}}h for these filters. Widen the segment / market-cap floor, or check back as new tokens surface.', { hours: windowHours })}
          action={(
            <button type="button" className="xd-btn xd-btn--secondary xd-btn--sm" onClick={refetch}>
              {t('xDash.fresh.refresh', 'Refresh')}
            </button>
          )}
        />
      ) : (
        <>
          <div className="xd-view-toolbar">
            <div className="xd-section-label" style={{ margin: 0 }}>
              {rows.length === 1
                ? t('xDash.fresh.countOne', '1 fresh token')
                : t('xDash.fresh.countMany', '{{count}} fresh tokens', { count: rows.length })}
            </div>
            <div className="xd-view-toolbar__spacer" />
            {rows[0]?.first_discovered_at && (
              <span className="xd-view-count">
                {t('xDash.fresh.latest', 'latest {{when}}', { when: relativeTime(rows[0].first_discovered_at, t) })}
              </span>
            )}
          </div>
          <XDTokenTable
            rows={rows}
            onOpenToken={onOpenToken}
            extraColumnLabel={t('xDash.fresh.col.firstSeen', 'First seen')}
            extraColumn={ageColumn}
          />
          <Pagination
            page={pagination.page}
            pageCount={pagination.page_count}
            onPage={controls.setPage}
            perPage={perPage}
            onPerPage={onPerPage}
          />
        </>
      )}
    </div>
  )
}
