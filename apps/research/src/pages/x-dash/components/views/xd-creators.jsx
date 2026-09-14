/**
 * Creators - dense KOL board driven by useXDashCreators with its own
 * activity/momentum/reach sort. Clicking a row opens the author drawer.
 */
import { useMemo, useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsMobile, useMediaQuery } from '@/hooks/useMediaQuery'
import { useXDashCreators } from '@/hooks/useXDashCreators'
import InfoTip from '@/components/InfoTip'
import { getMetricInfo } from '@/constants/socialMetricsGlossary'
import RowQuickActions, { ActionIcon } from '../xd-row-actions'
import { useCopyToast } from '@/contexts/CopyToastContext'
import {
  Shimmer, EmptyState, ErrorState, Pagination, Avatar, Num,
} from '../xd-bits'
import { formatNum, formatPercent, getFollowerTier, getAuthorId } from '../x-dash-utils'

/* same breakpoint contract as XDTokenTable: portrait phone OR landscape
   phone gets the card list — the 10-column table becomes a full-height
   horizontal scroller on those widths, so any touch drags the whole
   subpage sideways (the "slides left and right" wobble). */
const LANDSCAPE_PHONE_Q = '(orientation: landscape) and (max-height: 600px) and (max-width: 1024px)'

const VerifiedTick = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z" />
  </svg>
)

/* CoverageCell — what a voice actually moves. The kols row already carries a
   full `tokens` array (symbol, logo, weighted_engagement, early_called,
   lead_minutes); the list only ever surfaced the single top token. Showing
   the spread - sorted by impact, with early-called tokens ringed - answers
   "what is this account carrying?" at a glance, the way the reference voices
   board does, and goes one better by flagging the calls they were early on. */
function CoverageCell({ tokens, topTokenName }) {
  const { t } = useTranslation()
  const list = (Array.isArray(tokens) ? tokens : []).filter((tk) => tk && tk.symbol)
  if (list.length === 0) {
    return topTokenName
      ? <span className="xd-cell-primary">{topTokenName}</span>
      : <span className="xd-cell-muted">-</span>
  }
  const sorted = [...list].sort((a, b) => Number(b.weighted_engagement || 0) - Number(a.weighted_engagement || 0))
  const shown = sorted.slice(0, 4)
  const extra = sorted.length - shown.length
  return (
    <div className="xd-cov">
      {shown.map((tk, i) => {
        const early = Boolean(tk.early_called || tk.signal_hit)
        const lead = Number(tk.lead_minutes || 0)
        const title = early
          ? t('xDash.creators.calledEarly', '{{sym}} - called {{lead}}m early', { sym: tk.symbol, lead: Math.round(lead) })
          : tk.symbol
        return (
          <span key={`${tk.symbol}-${i}`} className={`xd-cov__chip${early ? ' xd-cov__chip--early' : ''}`} title={title}>
            {tk.image_url
              ? <img className="xd-cov__logo" src={tk.image_url} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
              : <span className="xd-cov__logo xd-cov__logo--ph" aria-hidden="true" />}
            <span className="xd-cov__sym">{tk.symbol}</span>
          </span>
        )
      })}
      {extra > 0 && <span className="xd-cov__more xd-num">+{extra}</span>}
    </div>
  )
}

function CreatorRow({ author, onOpenAuthor }) {
  const { t } = useTranslation()
  const { triggerCopyToast } = useCopyToast()
  const tier = getFollowerTier(author.followers_count)
  const badges = Array.isArray(author.signal_badges) ? author.signal_badges : []
  const hitRate = author.early_signal_hit_rate_24h ?? author.signal_profile?.early_signal_hit_rate_7d
  const leadMinutes = author.avg_lead_minutes_24h ?? author.avg_lead_minutes_7d
  const authorId = getAuthorId(author) || author.author_route_id

  /* "..." quick actions for a KOL row - the little options without opening the
     full profile drawer. */
  const handle = author.screen_name
  const kolActions = [
    authorId && { key: 'profile', label: t('xDash.creators.rowActions.profile', 'Open creator profile'), icon: <ActionIcon name="user" />, onClick: () => onOpenAuthor(authorId) },
    handle && { key: 'x', label: t('xDash.creators.rowActions.x', 'Open on X'), icon: <ActionIcon name="x" />, onClick: () => window.open(`https://x.com/${String(handle).replace(/^@/, '')}`, '_blank', 'noopener,noreferrer') },
    handle && {
      key: 'copy',
      label: t('xDash.creators.rowActions.copy', 'Copy @handle'),
      icon: <ActionIcon name="copy" />,
      onClick: () => { try { navigator.clipboard?.writeText(`@${String(handle).replace(/^@/, '')}`); triggerCopyToast(t('xDash.creators.rowActions.copied', 'Handle copied')) } catch { /* clipboard blocked */ } },
    },
  ]

  return (
    <tr onClick={() => onOpenAuthor(authorId)}>
      <td>
        <span className="xd-cell-rank__pos xd-num">{author.rank_position ?? '-'}</span>
      </td>
      <td>
        <div className="xd-tokencell">
          <Avatar src={author.avatar_image_url} alt={author.screen_name} size={30} />
          <div className="xd-tokencell__text">
            <span className="xd-tokencell__top">
              <span className="xd-cell-primary">@{author.screen_name}</span>
              {(author.is_blue_verified || author.legacy_verified) && (
                <span className="xd-verified"><VerifiedTick /></span>
              )}
              <span className={`xd-followtier ${tier.cls}`}>{t(tier.key, tier.fallback)}</span>
            </span>
            <span className="xd-tokencell__sub">{author.name}</span>
          </div>
        </div>
      </td>
      <td className="xd-col-num"><Num value={author.followers_count} /></td>
      <td className="xd-col-num">
        <span className="xd-cell-mentions xd-num">{formatNum(author.recent_mentions_24h)}</span>
      </td>
      <td className="xd-col-num"><Num value={author.recent_weighted_engagement_24h} /></td>
      <td className="xd-col-num"><Num value={author.tokens_mentioned_count} /></td>
      <td>
        <CoverageCell tokens={author.tokens} topTokenName={author.top_token_name} />
      </td>
      <td className="xd-col-num">
        {hitRate != null ? formatPercent(hitRate) : <span className="xd-cell-muted">-</span>}
      </td>
      <td className="xd-col-num">
        {leadMinutes ? <span className="xd-num">{t('xDash.creators.minutes', '{{count}}m', { count: Math.round(leadMinutes) })}</span> : <span className="xd-cell-muted">-</span>}
      </td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          {badges.length > 0 ? (
            <div className="xd-badge-row">
              {badges.slice(0, 3).map((b) => (
                <span key={b} className="xd-badge">{String(b).replace(/[-_]/g, ' ')}</span>
              ))}
            </div>
          ) : <span className="xd-cell-muted">-</span>}
          <RowQuickActions items={kolActions} ariaLabel={t('xDash.creators.rowActions.aria', 'More actions')} />
        </div>
      </td>
    </tr>
  )
}

/* CreatorCard — compact-mode row (mobile-crypto-ux E3 shape): identity stack
   left, followers dominant right, mentions/engagement muted underneath.
   Row tap opens the author drawer, which carries everything the hidden
   table columns had (coverage, hit-rate detail, badges, X link). */
function CreatorCard({ author, onOpenAuthor }) {
  const { t } = useTranslation()
  const tier = getFollowerTier(author.followers_count)
  const hitRate = author.early_signal_hit_rate_24h ?? author.signal_profile?.early_signal_hit_rate_7d
  const authorId = getAuthorId(author) || author.author_route_id
  return (
    <button type="button" className="xd-kolcard" onClick={() => onOpenAuthor(authorId)}>
      <span className="xd-kolcard__rank xd-num">{author.rank_position ?? '-'}</span>
      <Avatar src={author.avatar_image_url} alt={author.screen_name} size={36} />
      <span className="xd-kolcard__id">
        <span className="xd-kolcard__handle">
          @{author.screen_name}
          {(author.is_blue_verified || author.legacy_verified) && (
            <span className="xd-verified"><VerifiedTick /></span>
          )}
          <span className={`xd-followtier ${tier.cls}`}>{t(tier.key, tier.fallback)}</span>
        </span>
        {author.name && <span className="xd-kolcard__name">{author.name}</span>}
        <span className="xd-kolcard__meta xd-num">
          {formatNum(author.recent_mentions_24h, { maxFraction: 0 })} {t('xDash.creators.card.mentions', 'mentions')}
          {' · '}
          {formatNum(author.recent_weighted_engagement_24h, { maxFraction: 0 })} {t('xDash.creators.card.engagement', 'eng')}
          {hitRate != null && (
            <> · <span className="xd-kolcard__hit">{formatPercent(hitRate)} {t('xDash.creators.card.early', 'early')}</span></>
          )}
        </span>
      </span>
      <span className="xd-kolcard__metrics">
        <span className="xd-kolcard__followers xd-num"><Num value={author.followers_count} /></span>
        <span className="xd-kolcard__followers-label">{t('xDash.creators.col.followers', 'Followers')}</span>
      </span>
    </button>
  )
}

/* Server-sorted <th> — same look/keys as XDTokenTable's SortTh (reuses the
   xd-th-* classes) but one-directional: the endpoint always returns its own
   descending order, so there's no asc/desc toggle to fake. */
function ServerSortTh({ sortKey, current, onSort, info, children }) {
  const active = current === sortKey
  return (
    <th
      className={`xd-col-num xd-th-sortable${active ? ' xd-th-sorted' : ''}`}
      role="columnheader"
      aria-sort={active ? 'descending' : 'none'}
      tabIndex={0}
      onClick={() => onSort(sortKey)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(sortKey) } }}
    >
      <span className="xd-th-inner">
        <span className="xd-th-label">{children}</span>
        {info && (
          <span className="xd-th-info" onClick={(e) => e.stopPropagation()}>
            <InfoTip text={info} position="top" />
          </span>
        )}
        <span className={`xd-th-arrow${active ? ' xd-th-arrow--on' : ''}`} aria-hidden="true">{active ? '↓' : '↕'}</span>
      </span>
    </th>
  )
}

export default function XDCreators({ onOpenAuthor, controls }) {
  const { t, i18n } = useTranslation()
  /* sort choice persists across visits */
  const [sort, setSortState] = useState(() => {
    try {
      const s = localStorage.getItem('spectre-xd-creators-sort')
      return ['activity', 'momentum', 'reach'].includes(s) ? s : 'activity'
    } catch { return 'activity' }
  })
  const setSort = useCallback((s) => {
    setSortState(s)
    try { localStorage.setItem('spectre-xd-creators-sort', s) } catch { /* private mode */ }
  }, [])
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')

  const SORTS = useMemo(() => [
    { key: 'activity', label: t('xDash.creators.sort.activity', 'Activity') },
    { key: 'momentum', label: t('xDash.creators.sort.momentum', 'Momentum') },
    { key: 'reach', label: t('xDash.creators.sort.reach', 'Reach'), info: 'carrierScore' },
  ], [t])

  /* Honor the command-bar timeframe — the endpoint supports 24h / 7d
     (verified live: 7d reorders the board). 30d/all clamp to 7d, the widest
     creators window, and the clamp is surfaced as a chip so the control
     never reads as silently dead. */
  const windowKey = (controls?.timeframe && controls.timeframe !== '24h') ? '7d' : '24h'
  const windowClamped = controls?.timeframe === '30d' || controls?.timeframe === 'all'
  useEffect(() => { setPage(1) }, [windowKey])

  const params = useMemo(() => ({
    page,
    perPage,
    timeframe: windowKey,
    sort,
    query: query || undefined,
  }), [page, perPage, windowKey, sort, query])

  const { data, loading, error, refetch } = useXDashCreators(params)

  /* card list instead of the 10-col table on phones (see LANDSCAPE_PHONE_Q) */
  const isNarrow = useIsMobile()
  const isLandscapePhone = useMediaQuery(LANDSCAPE_PHONE_Q)
  const compact = isNarrow || isLandscapePhone

  const authors = data?.authors || []
  const pagination = data?.pagination || {}

  const submitSearch = (e) => {
    e.preventDefault()
    setQuery(queryInput.trim())
    setPage(1)
  }

  return (
    <div>
      <div className="xd-view-toolbar">
        <div className="xd-toggle">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`xd-toggle__btn${sort === s.key ? ' xd-toggle__btn--active' : ''}`}
              onClick={() => { setSort(s.key); setPage(1) }}
            >
              {s.label}
              {s.info && getMetricInfo(s.info) && <InfoTip text={getMetricInfo(s.info)} position="top" />}
            </button>
          ))}
        </div>
        <form className="xd-cmdbar__search" onSubmit={submitSearch} style={{ minWidth: 180 }}>
          <span className="xd-cmdbar__search-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            className="xd-cmdbar__search-input"
            placeholder={t('xDash.creators.searchPlaceholder', 'Filter handles')}
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
          />
        </form>
        <div className="xd-view-toolbar__spacer" />
        {windowKey === '7d' && (
          <span className="xd-view-count" title={windowClamped ? t('xDash.creators.windowClampTip', '7d is the widest window the creators board supports') : undefined}>
            {windowClamped
              ? t('xDash.creators.windowClamped', 'window: 7d (max)')
              : t('xDash.creators.window', 'window: 7d')}
          </span>
        )}
        <span className="xd-view-count">
          {data?.author_count != null
            ? t('xDash.creators.count', '{{count}} creators', { count: data.author_count.toLocaleString(i18n.language) })
            : ''}
        </span>
      </div>

      {loading && !data && <Shimmer variant="row" count={12} />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && authors.length === 0 && (
        <EmptyState
          title={t('xDash.creators.empty.title', 'No creators match')}
          detail={query
            ? t('xDash.creators.empty.detailQuery', 'No handles match "{{query}}".', { query })
            : t('xDash.creators.empty.detailDefault', 'No creators ranked for this window.')}
        />
      )}
      {authors.length > 0 && compact && (
        <div className="xd-kollist">
          {authors.map((author) => (
            <CreatorCard
              key={getAuthorId(author) || author.rank_position}
              author={author}
              onOpenAuthor={onOpenAuthor}
            />
          ))}
        </div>
      )}
      {authors.length > 0 && !compact && (
        <div className="xd-table-wrap">
          <div className="xd-table-scroll">
            <table className="xd-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('xDash.creators.col.author', 'Author')}</th>
                    {/* The three server-backed sorts, clickable from their
                        columns (Followers=reach, Mentions=activity,
                        Engagement=momentum). Hit-rate / lead-time sorting
                        needs upstream support (sort=hit_rate is silently
                        ignored today) — data-lane ask, not faked client-side. */}
                    <ServerSortTh sortKey="reach" current={sort} onSort={(k) => { setSort(k); setPage(1) }} info={getMetricInfo('followers')}>
                      {t('xDash.creators.col.followers', 'Followers')}
                    </ServerSortTh>
                    <ServerSortTh sortKey="activity" current={sort} onSort={(k) => { setSort(k); setPage(1) }} info={getMetricInfo('mentions24h')}>
                      {t('xDash.creators.col.mentions24h', 'Mentions 24h')}
                    </ServerSortTh>
                    <ServerSortTh sortKey="momentum" current={sort} onSort={(k) => { setSort(k); setPage(1) }} info={getMetricInfo('engagement')}>
                      {t('xDash.creators.col.engagement24h', 'Engagement 24h')}
                    </ServerSortTh>
                    <th className="xd-col-num">{t('xDash.creators.col.tokens', 'Tokens')}{getMetricInfo('creatorTokens') && <InfoTip text={getMetricInfo('creatorTokens')} position="top" />}</th>
                    <th>{t('xDash.creators.col.coverage', 'Coverage')}{getMetricInfo('coverage') && <InfoTip text={getMetricInfo('coverage')} position="top" />}</th>
                    <th className="xd-col-num">{t('xDash.creators.col.earlyHitRate', 'Early hit-rate')}{getMetricInfo('earlyHitRate') && <InfoTip text={getMetricInfo('earlyHitRate')} position="left" />}</th>
                    <th className="xd-col-num">{t('xDash.creators.col.leadTime', 'Lead time')}{getMetricInfo('leadTime') && <InfoTip text={getMetricInfo('leadTime')} position="left" />}</th>
                    <th>{t('xDash.creators.col.signalBadges', 'Signal badges')}</th>
                  </tr>
                </thead>
                <tbody>
                  {authors.map((author) => (
                    <CreatorRow
                      key={getAuthorId(author) || author.rank_position}
                      author={author}
                      onOpenAuthor={onOpenAuthor}
                    />
                  ))}
                </tbody>
              </table>
          </div>
        </div>
      )}
      {authors.length > 0 && (
        <Pagination
          page={pagination.page}
          pageCount={pagination.page_count}
          onPage={setPage}
          perPage={perPage}
          onPerPage={(n) => { setPerPage(n); setPage(1) }}
        />
      )}
    </div>
  )
}
