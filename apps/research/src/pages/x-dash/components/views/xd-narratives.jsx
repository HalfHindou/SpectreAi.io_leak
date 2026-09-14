/**
 * Narratives - card grid driven by useXDashSurface on /api/xdash/narratives.
 * Clicking a card drills into its token list via /api/xdash/narrative-tokens.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useXDashSurface } from '@/hooks/useXDashSurface'
import InfoTip from '@/components/InfoTip'
import { getMetricInfo } from '@/constants/socialMetricsGlossary'
import {
  Shimmer, EmptyState, ErrorState, Pagination, Avatar,
} from '../xd-bits'
import { XDNarrativeShares } from '../xd-charts'
import XDTokenTable, { flattenSurfaceRow } from './xd-token-table'
import { formatNum, formatPercent, narrativeHeat } from '../x-dash-utils'

/* Timeframe -> window label, mirrors the leaderboard so the drill reads the
   same window as the board it was opened from. */
const WINDOW_LABEL = { '24h': '24h', '7d': '7d', '30d': '30d', all: 'all' }

/* narrativeHeat moved to x-dash-utils so the leaderboard's right-rail
   "Narrative leaders" ranks by the SAME intensity metric as this view
   (it used to rank by breadth-biased score_sum — the two disagreed). */

/** Conviction = authenticity (clean signal) weighted by how much volume backs it. */
function narrativeConviction(it) {
  const clean = Number(it.average_clean_signal) || 0
  const mentions = Number(it.mention_count) || 0
  return clean * (1 + Math.log10(1 + mentions))
}

/** Re-rank narratives by the active SORT BY control (upstream returns them
 *  score_sum-ordered, which is breadth-biased — see narrativeHeat). */
function rankNarratives(items, ranking) {
  const arr = Array.isArray(items) ? [...items] : []
  const metric = ranking === 'mentions'
    ? (it) => Number(it.mention_count) || 0
    : ranking === 'conviction'
      ? narrativeConviction
      : narrativeHeat // momentum / default
  return arr.sort((a, b) => metric(b) - metric(a))
}

/* Per-narrative signature accent — identity by colour, not emoji (design rule:
   no emoji chrome). Keyed by narrative slug with a diverse fallback palette. */
const NARRATIVE_ACCENT = {
  'solana-memes': '#14F195',
  'robinhood-ecosystem': '#3FE0A5',
  'ai-agents': '#38E0F0',
  cats: '#FB923C',
  dogs: '#FBBF24',
  frogs: '#4FD48A',
  'base-memes': '#5B8DEF',
  gaming: '#B794F6',
  'ondo-rwa': '#38BDF8',
}
const FALLBACK_ACCENTS = ['#38E0F0', '#B794F6', '#FB923C', '#4FD48A', '#F472B6', '#38BDF8', '#FBBF24', '#5B8DEF']
function narrativeKey(item) {
  return String(item?.id || item?.narrative_id || item?.label || '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
function accentFor(item, i) {
  return NARRATIVE_ACCENT[narrativeKey(item)] || FALLBACK_ACCENTS[i % FALLBACK_ACCENTS.length]
}

/* Buzz gauge — circular progress ring, accent stroke + glow, value centred. */
function BuzzRing({ value, size = 64, accent }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
  const stroke = size >= 82 ? 6 : 5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - v / 100)
  const cx = size / 2
  return (
    <div className="xdn-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="xdn-ring__track" cx={cx} cy={cx} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="xdn-ring__fill" cx={cx} cy={cx} r={r} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cx})`}
          style={{ stroke: accent, filter: `drop-shadow(0 0 4px ${accent}66)` }}
        />
      </svg>
      <div className="xdn-ring__inner">
        <span className="xdn-ring__value xd-num">{v}</span>
        <span className="xdn-ring__cap">Buzz</span>
      </div>
    </div>
  )
}

const HEAT_TIERS = [
  { min: 66, key: 'ignited', label: 'Ignited' },
  { min: 33, key: 'heating', label: 'Heating' },
  { min: 0, key: 'cooling', label: 'Cooling' },
]
function heatTier(buzz) { return HEAT_TIERS.find((tier) => buzz >= tier.min) || HEAT_TIERS[2] }

function Stat({ label, value, hint }) {
  return (
    <div className="xdn-stat">
      <span className="xdn-stat__label">{label}{hint}</span>
      <span className="xdn-stat__value xd-num">{value}</span>
    </div>
  )
}

function ShareRow({ label, value, strong }) {
  const pct = Math.max(0, Math.min(1, Number(value) || 0))
  return (
    <div className={`xdn-share__row${strong ? ' xdn-share__row--strong' : ''}`}>
      <span className="xdn-share__label">{label}</span>
      <span className="xdn-share__track"><span className="xdn-share__fill" style={{ width: `${pct * 100}%` }} /></span>
      <span className="xdn-share__pct xd-num">{formatPercent(value)}</span>
    </div>
  )
}

function NarrativeCard({ item, rank, buzz, accent, featured, onDrill }) {
  const { t } = useTranslation()
  const topTokens = Array.isArray(item.top_tokens) ? item.top_tokens : []
  const tier = heatTier(buzz)
  const fresh = Number(item.fresh_token_share) || 0
  const mShare = Number(item.mention_share) || 0
  const tShare = Number(item.token_share) || 0
  const punch = tShare > 0 ? mShare / tShare : 0
  const shown = featured ? 8 : 6

  return (
    <button
      type="button"
      className={`xdn-card${featured ? ' xdn-card--hero' : ''}`}
      style={{ '--xdn-accent': accent, animationDelay: `${Math.min(rank - 1, 9) * 45}ms` }}
      onClick={() => onDrill(item)}
    >
      <span className="xdn-card__glow" aria-hidden="true" />

      <div className="xdn-card__lead">
        <div className="xdn-card__top">
          <div className="xdn-card__id">
            <span className="xdn-card__rank">{rank}</span>
            <div className="xdn-card__idtext">
              <div className="xdn-card__title">
                {item.label}
                <span className={`xdn-badge xdn-badge--${tier.key}`}>{tier.label}</span>
                {fresh >= 0.5 && <span className="xdn-badge xdn-badge--fresh">{t('xDash.narratives.fresh', 'Fresh')} {formatPercent(fresh)}</span>}
              </div>
              {item.description && <div className="xdn-card__desc">{item.description}</div>}
            </div>
          </div>
          <BuzzRing value={buzz} size={featured ? 88 : 64} accent={accent} />
        </div>
        <div className="xdn-heatbar"><span className="xdn-heatbar__fill" style={{ width: `${buzz}%` }} /></div>
      </div>

      <div className="xdn-card__body">
        <div className="xdn-stats">
          <Stat label={t('xDash.narratives.stats.mentions', 'Mentions')} value={formatNum(item.mention_count)} />
          <Stat label={t('xDash.narratives.stats.authors', 'Authors')} value={formatNum(item.author_count_sum)} />
          <Stat label={t('xDash.narratives.stats.engagementShort', 'Engage')} value={formatNum(item.weighted_engagement, { maxFraction: 0 })} />
          <Stat label={t('xDash.narratives.stats.tokens', 'Tokens')} value={formatNum(item.token_count)} />
        </div>

        <div className="xdn-share">
          <ShareRow label={t('xDash.narratives.stats.mentionShare', 'Mention share')} value={mShare} strong />
          <ShareRow label={t('xDash.narratives.stats.tokenShare', 'Token share')} value={tShare} />
          {punch >= 1.3 && (
            <div className="xdn-punch">{t('xDash.narratives.punch', 'Punching above weight')} · {punch.toFixed(1)}× {t('xDash.narratives.attnPerToken', 'attention per token')}</div>
          )}
        </div>

        <div className="xdn-signal">
          <span className="xdn-signal__label">
            {t('xDash.narratives.cleanSignal', 'Clean signal')}
            {getMetricInfo('avgCleanSignal') && <InfoTip text={getMetricInfo('avgCleanSignal')} position="top" />}
          </span>
          <span className="xdn-signal__track"><span className="xdn-signal__fill" style={{ width: `${(Number(item.average_clean_signal) || 0) * 100}%` }} /></span>
          <span className="xdn-signal__pct xd-num">{formatPercent(item.average_clean_signal)}</span>
        </div>

        {topTokens.length > 0 && (
          <div className="xdn-leaders">
            <span className="xdn-leaders__label">{t('xDash.narratives.leaders', 'Leaders')}</span>
            <div className="xdn-leaders__row">
              {topTokens.slice(0, shown).map((entry, i) => {
                const tk = entry.token || entry
                return (
                  <Avatar
                    key={tk.cg_id || tk.token_id || i}
                    src={tk.image_small || tk.image_url}
                    alt={tk.symbol || tk.name}
                    size={featured ? 28 : 24}
                    className="xdn-leaders__avatar"
                  />
                )
              })}
              {topTokens.length > shown && <span className="xdn-leaders__more">+{topTokens.length - shown}</span>}
            </div>
          </div>
        )}
      </div>
    </button>
  )
}

/* Drill-in: the full X Dash board scoped to one narrative's tokens. Reuses the
   rich XDTokenTable (live mcap, Spotted MC + ROI receipts, price/24h, chain,
   rug/peaked verdicts, velocity) instead of a bespoke mentions-only table —
   the narrative-tokens rows are the same {token, metrics} shape as bootstrap,
   so flattenSurfaceRow maps them straight in. */
function NarrativeDrill({ narrative, controls, onBack, onOpenToken }) {
  const { t } = useTranslation()
  const accent = accentFor(narrative, 0)
  const timeframe = controls?.timeframe || '24h'
  /* The endpoint SILENTLY caps per_page at 50 (a perPage:100 request returns
     50), so the drill used to truncate a >50-token narrative without saying
     so. Narratives are small (≤~150 tokens): stitch up to three 50-row pages
     and rank the WHOLE set client-side — no pagination, no cross-page sort
     inconsistency. */
  const ranking = controls?.ranking || 'mentions'
  const params1 = useMemo(() => ({ narrative: narrative.id, page: 1, perPage: 50, timeframe, ranking }), [narrative.id, timeframe, ranking])
  const params2 = useMemo(() => ({ narrative: narrative.id, page: 2, perPage: 50, timeframe, ranking }), [narrative.id, timeframe, ranking])
  const params3 = useMemo(() => ({ narrative: narrative.id, page: 3, perPage: 50, timeframe, ranking }), [narrative.id, timeframe, ranking])
  const { data, loading, error, refetch } = useXDashSurface('/api/xdash/narrative-tokens', params1)
  const pageCount = Number(data?.pagination?.page_count || 1)
  const page2 = useXDashSurface('/api/xdash/narrative-tokens', params2, { enabled: pageCount >= 2 })
  const page3 = useXDashSurface('/api/xdash/narrative-tokens', params3, { enabled: pageCount >= 3 })

  // Rank the narrative's tokens by attention (mentions desc) and stamp a clean
  // 1..N rank — the endpoint's momentum order floats tiny velocity spikes (a
  // token going 0->3 mentions) to the top, and the raw rows carry the GLOBAL
  // board rank_position (sparse/meaningless within one narrative). Override it
  // with the per-narrative position; the table's column headers still re-sort.
  const rows = useMemo(() => {
    const merged = [
      ...(data?.tokens || data?.items || []),
      ...(pageCount >= 2 ? (page2.data?.tokens || page2.data?.items || []) : []),
      ...(pageCount >= 3 ? (page3.data?.tokens || page3.data?.items || []) : []),
    ]
    const seen = new Set()
    const flat = []
    for (const raw of merged) {
      const r = flattenSurfaceRow(raw)
      const k = String(r.cg_id || r.token_id || '').toLowerCase()
      if (k && seen.has(k)) continue
      if (k) seen.add(k)
      flat.push(r)
    }
    const mentionsOf = (r) => Number(r.external_mentions_24h ?? r.mentions_24h ?? r.mention_count ?? 0)
    flat.sort((a, b) => mentionsOf(b) - mentionsOf(a))
    return flat.map((r, i) => ({
      ...r,
      rank_position: i + 1,
      rank_direction: null,
      rank_change_positions: null,
      previous_rank_position: null,
    }))
  }, [data, page2.data, page3.data, pageCount])
  const totalFiltered = Number(data?.pagination?.filtered_count || 0)
  const windowLabel = WINDOW_LABEL[timeframe] || timeframe
  const boardTotal = Number(narrative.mention_count) || undefined

  return (
    <div className="xdn-drill">
      <div className="xdn-drill__head" style={{ '--xdn-accent': accent }}>
        <span className="xdn-drill__glow" aria-hidden="true" />
        <button type="button" className="xd-btn xd-btn--ghost xd-btn--sm" onClick={onBack}>
          &#8592; {t('xDash.narratives.backToNarratives', 'Narratives')}
        </button>
        <div className="xdn-drill__title">
          <span className="xdn-drill__dot" aria-hidden="true" />
          {narrative.label}
        </div>
        <div className="xd-view-toolbar__spacer" />
        <span className="xdn-drill__count">
          {totalFiltered > rows.length && rows.length > 0
            ? t('xDash.narratives.tokenCountPartial', 'top {{shown}} of {{count}} tokens', { shown: rows.length, count: formatNum(totalFiltered) })
            : t('xDash.narratives.tokenCount', '{{count}} tokens', { count: formatNum(rows.length || narrative.token_count) })}
        </span>
      </div>

      {loading && !data && <Shimmer variant="row" count={8} />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && rows.length === 0 && (
        <EmptyState title={t('xDash.narratives.empty.drill', 'No tokens resolved for this narrative')} />
      )}
      {rows.length > 0 && (
        <XDTokenTable
          rows={rows}
          onOpenToken={onOpenToken}
          boardTotalMentions={boardTotal}
          windowLabel={windowLabel}
        />
      )}
    </div>
  )
}

export default function XDNarratives({ controls, onOpenToken, perPage, onPerPage }) {
  const { t } = useTranslation()
  const [drill, setDrill] = useState(null)

  const params = useMemo(() => ({
    page: controls.page,
    perPage,
    timeframe: controls.timeframe,
    ranking: controls.ranking,
    segment: controls.segment,
    market: controls.market,
  }), [controls.page, perPage, controls.timeframe, controls.ranking, controls.segment, controls.market])

  const { data, loading, error, refetch } = useXDashSurface('/api/xdash/narratives', params)

  if (drill) {
    return <NarrativeDrill narrative={drill} controls={controls} onBack={() => setDrill(null)} onOpenToken={onOpenToken} />
  }

  if (loading && !data) return <Shimmer variant="card" count={6} />
  if (error) return <ErrorState message={error} onRetry={refetch} />

  const items = data?.items || []
  const pagination = data?.pagination || {}
  // Upstream returns narratives in score_sum (breadth-biased) order; re-rank by
  // the active SORT BY so the cards AND the chart reflect real heat, not token count.
  const rankedItems = rankNarratives(items, controls.ranking)
  const maxHeat = rankedItems.reduce((m, it) => Math.max(m, narrativeHeat(it)), 0) || 1

  if (items.length === 0) {
    return <EmptyState
      title={t('xDash.narratives.empty.list', 'No narratives detected')}
      detail={t('xDash.narratives.empty.listDetail', 'No token clusters crossed the narrative threshold for this window.')}
    />
  }

  return (
    <div className="xdn-board">
      <div className="xdn-head">
        <div className="xdn-head__lead">
          <div className="xdn-head__title">{t('xDash.narratives.clusters', 'Narrative Clusters')}</div>
          <div className="xdn-head__sub">{t('xDash.narratives.subtitle', 'Where the crowd is spending its attention right now — ranked by clean buzz, not token count.')}</div>
        </div>
        <span className="xdn-head__count">
          <span className="xdn-head__dot" aria-hidden="true" />
          {t('xDash.narratives.narrativeCount', '{{count}} narratives', { count: data?.narrative_count ?? items.length })}
        </span>
      </div>

      {/* mention share vs token share - reveals narratives punching above token count */}
      <div className="xdn-chartframe">
        <div className="xdn-chartframe__label">{t('xDash.narratives.chartLabel', 'Mention share vs token share')}{getMetricInfo('mentionShareVsTokenShare') && <InfoTip text={getMetricInfo('mentionShareVsTokenShare')} position="top" />}</div>
        <XDNarrativeShares items={rankedItems} loading={loading && !data} />
      </div>

      <div className="xdn-grid">
        {rankedItems.map((item, i) => (
          <NarrativeCard
            key={item.id || narrativeKey(item) || i}
            item={item}
            rank={i + 1}
            buzz={Math.round((narrativeHeat(item) / maxHeat) * 100)}
            accent={accentFor(item, i)}
            featured={i === 0}
            onDrill={setDrill}
          />
        ))}
      </div>

      <Pagination
        page={pagination.page}
        pageCount={pagination.page_count}
        onPage={controls.setPage}
        perPage={perPage}
        onPerPage={onPerPage}
      />
    </div>
  )
}
