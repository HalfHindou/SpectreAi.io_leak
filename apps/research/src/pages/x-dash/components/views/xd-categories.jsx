/**
 * Categories - card grid driven by useXDashCategories with its own
 * chatter/momentum toggle. Clicking a card drills into category tokens
 * via useXDashCategoryTokens.
 */
import { useMemo, useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useXDashCategories } from '@/hooks/useXDashCategories'
import { useXDashCategoryTokens } from '@/hooks/useXDashCategoryTokens'
import {
  Shimmer, EmptyState, ErrorState, Pagination, StatBar, TokenCell, Num, Avatar,
} from '../xd-bits'
import { XDCategoryRanking } from '../xd-charts'
import { formatNum, formatPercent } from '../x-dash-utils'

function CategoryCard({ item, onDrill }) {
  const { t } = useTranslation()
  const topTokens = Array.isArray(item.top_tokens) ? item.top_tokens : []
  return (
    <button type="button" className="xd-card" onClick={() => onDrill(item)}>
      <div className="xd-card__head">
        <div>
          <div className="xd-card__title">{item.label || item.category}</div>
        </div>
        <div className="xd-card__hero">
          <div className="xd-card__hero-value xd-num">{formatNum(item.score_sum, { maxFraction: 0 })}</div>
          <div className="xd-card__hero-label">{t('xDash.categories.scoreSum', 'Score sum')}</div>
        </div>
      </div>

      <div className="xd-card__stats">
        <div className="xd-card__stat">
          <span className="xd-card__stat-label">{t('xDash.categories.stats.tokens', 'Tokens')}</span>
          <span className="xd-card__stat-value xd-num">{formatNum(item.token_count)}</span>
        </div>
        <div className="xd-card__stat">
          <span className="xd-card__stat-label">{t('xDash.categories.stats.mentions', 'Mentions')}</span>
          <span className="xd-card__stat-value xd-num">{formatNum(item.mention_count)}</span>
        </div>
        <div className="xd-card__stat">
          <span className="xd-card__stat-label">{t('xDash.categories.stats.authors', 'Authors')}</span>
          <span className="xd-card__stat-value xd-num">{formatNum(item.author_count_sum)}</span>
        </div>
        <div className="xd-card__stat">
          <span className="xd-card__stat-label">{t('xDash.categories.stats.engagement', 'Engagement')}</span>
          <span className="xd-card__stat-value xd-num">{formatNum(item.weighted_engagement, { maxFraction: 0 })}</span>
        </div>
      </div>

      <div>
        <div className="xd-card__stat-label" style={{ marginBottom: 4 }}>
          {t('xDash.categories.avgCleanSignal', 'Avg clean signal {{value}}', { value: formatPercent(item.average_clean_signal) })}
        </div>
        <div className="xd-card__signal-row">
          <StatBar value={item.average_clean_signal} tone="bull" />
        </div>
      </div>

      {topTokens.length > 0 && (
        <div className="xd-card__tokens">
          <span className="xd-card__tokens-label">{t('xDash.categories.leaders', 'Leaders')}</span>
          {topTokens.slice(0, 6).map((entry, i) => {
            const t = entry.token || entry
            return (
              <Avatar
                key={t.cg_id || t.token_id || i}
                src={t.image_small || t.image_url}
                alt={t.symbol || t.name}
                size={20}
              />
            )
          })}
        </div>
      )}
    </button>
  )
}

function CategoryDrill({ category, mode, timeframe, onBack, onOpenToken }) {
  const { t } = useTranslation()
  /* Server pagination — the drill used to fetch page 1 (40 rows) and silently
     truncate bigger categories (smart-contract-platform carries 75+). The
     endpoint pages properly (verified live); reset to page 1 on any scope
     change. */
  const [page, setPage] = useState(1)
  const catId = category.id || category.category
  useEffect(() => { setPage(1) }, [catId, mode, timeframe])
  const params = useMemo(() => ({
    mode,
    timeframe,
    market: 'all',
    minKols: '1',
    categoryScope: 'primary',
    page: String(page),
    perPage: '40',
  }), [mode, timeframe, page])

  const { data, loading, error, refetch } = useXDashCategoryTokens(catId, params)
  const tokens = data?.tokens || data?.items || []
  const pagination = data?.pagination || {}

  return (
    <div>
      <div className="xd-view-toolbar">
        <button type="button" className="xd-btn xd-btn--ghost xd-btn--sm" onClick={onBack}>
          &#8592; {t('xDash.categories.backToCategories', 'Categories')}
        </button>
        <div className="xd-section-label" style={{ margin: 0 }}>{category.label || category.category}</div>
        <div className="xd-view-toolbar__spacer" />
        <span className="xd-view-count">{t('xDash.categories.tokenCount', '{{count}} tokens', { count: formatNum(pagination.filtered_count ?? category.token_count) })}</span>
      </div>

      {loading && !data && <Shimmer variant="row" count={8} />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && tokens.length === 0 && (
        <EmptyState title={t('xDash.categories.empty.drill', 'No tokens resolved for this category')} />
      )}
      {tokens.length > 0 && (
        <div className="xd-table-wrap">
          <div className="xd-table-scroll">
            <table className="xd-table">
              <thead>
                <tr>
                  <th>{t('xDash.categories.col.token', 'Token')}</th>
                  <th className="xd-col-num">{t('xDash.categories.col.mentions24h', 'Mentions 24h')}</th>
                  <th className="xd-col-num">{t('xDash.categories.col.authors', 'Authors')}</th>
                  <th className="xd-col-num">{t('xDash.categories.col.engagement', 'Engagement')}</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((entry, i) => {
                  const t = entry.token || entry
                  const m = entry.metrics || entry
                  const cgId = t.cg_id || t.token_id
                  return (
                    <tr key={cgId || i} onClick={() => onOpenToken(cgId)}>
                      <td>
                        <TokenCell
                          token={{
                            symbol: t.symbol,
                            name: t.name,
                            cashtag: t.cashtag,
                            segment: t.segment,
                            chain: t.chain,
                            image_small: t.image_small || t.image_url,
                          }}
                        />
                      </td>
                      <td className="xd-col-num"><Num value={m.external_mentions_24h ?? m.mention_count} /></td>
                      <td className="xd-col-num"><Num value={m.unique_external_authors_24h ?? m.author_count} /></td>
                      <td className="xd-col-num">
                        <Num value={m.external_weighted_engagement_24h ?? m.weighted_engagement} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={Number(pagination.page) || page}
            pageCount={Number(pagination.page_count) || 1}
            onPage={setPage}
          />
        </div>
      )}
    </div>
  )
}

export default function XDCategories({ controls, onOpenToken, perPage, onPerPage }) {
  const { t } = useTranslation()
  /* chatter/momentum choice persists across visits */
  const [mode, setModeState] = useState(() => {
    try { return localStorage.getItem('spectre-xd-cat-mode') === 'momentum' ? 'momentum' : 'chatter' } catch { return 'chatter' }
  })
  const setMode = useCallback((m) => {
    setModeState(m)
    try { localStorage.setItem('spectre-xd-cat-mode', m) } catch { /* private mode */ }
  }, [])
  const [drill, setDrill] = useState(null)

  const MODE_LABELS = useMemo(() => ({
    chatter: t('xDash.categories.mode.chatter', 'chatter'),
    momentum: t('xDash.categories.mode.momentum', 'momentum'),
  }), [t])

  const params = useMemo(() => ({
    page: controls.page,
    perPage,
    timeframe: controls.timeframe,
    categoryScope: 'primary',
  }), [controls.page, perPage, controls.timeframe])

  const { data, loading, error, refetch } = useXDashCategories(mode, params)

  if (drill) {
    return (
      <CategoryDrill
        category={drill}
        mode={mode}
        timeframe={controls.timeframe}
        onBack={() => setDrill(null)}
        onOpenToken={onOpenToken}
      />
    )
  }

  const items = data?.items || []
  const pagination = data?.pagination || {}

  return (
    <div>
      <div className="xd-view-toolbar">
        <div className="xd-toggle">
          {['chatter', 'momentum'].map((m) => (
            <button
              key={m}
              type="button"
              className={`xd-toggle__btn${mode === m ? ' xd-toggle__btn--active' : ''}`}
              onClick={() => { setMode(m); controls.setPage(1) }}
            >
              {MODE_LABELS[m] || m}
            </button>
          ))}
        </div>
        <div className="xd-view-toolbar__spacer" />
        <span className="xd-view-count">{t('xDash.categories.categoryCount', '{{count}} categories', { count: data?.category_count ?? items.length })}</span>
      </div>

      {loading && !data && <Shimmer variant="card" count={6} />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && items.length === 0 && (
        <EmptyState title={t('xDash.categories.empty.list', 'No categories detected')} detail={t('xDash.categories.empty.listDetail', 'No category clusters crossed the threshold for this window.')} />
      )}
      {items.length > 0 && (
        <>
          {/* score-sum ranking - top 20, click drills same as a card */}
          <div className="xd-view-chart">
            <div className="xd-view-chart__label">{t('xDash.categories.scoreRanking', 'Score ranking')}</div>
            <XDCategoryRanking items={items} loading={loading && !data} topN={20} onSelect={setDrill} />
          </div>
          <div className="xd-cardgrid">
            {items.map((item) => (
              <CategoryCard key={item.id || item.category} item={item} onDrill={setDrill} />
            ))}
          </div>
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
