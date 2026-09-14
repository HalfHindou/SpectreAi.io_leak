/**
 * SocialMindshareSection - Welcome page Social tab.
 *
 * Pulls real X/Twitter attention data from the X Dash service (the same
 * bootstrap board that powers the /x-dash flagship + the Command Center
 * Mindshare social map) via /api/xdash/bootstrap. Numbers therefore match
 * /x-dash exactly (external_mentions_24h) and load fast (~1.2s cached) instead
 * of the old slow, majors-dominated Spectre /v1/social/x-bubbles feed.
 *
 * Renders a dense list, a mentions-bar view, or a d3 treemap heatmap. The three
 * ranking pills (Mentions / Momentum / Conviction) MIRROR /x-dash exactly - same
 * labels, same default (Momentum), and the same SERVER-side ranking: the pill is
 * passed straight through as the bootstrap `ranking` param, so the board arrives
 * pre-ordered by the server and the landing preview leads with the identical top
 * rows a user sees after clicking into /x-dash. No client-side re-sort.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { hierarchy, treemap as d3treemap } from 'd3-hierarchy'
import { getPathForPageId } from '@/constants/pageRoutes'
import { useXDashBootstrap } from '@/hooks/useXDashBootstrap'
import XDTokenTable from '@/pages/x-dash/components/views/xd-token-table'
import './social-mindshare-section.css'
// The List view renders the real /x-dash leaderboard table so it matches X Dash
// exactly (Signal score, Spotted MC/ROI, Carriers, per-row R/S open buttons).
// xd-bits has no paired CSS - all of its + the table's styles live in this one
// file (no @imports), so this single import fully styles the table. This section
// is lazy-mounted (Social tab only) so the CSS/table code stays off the landing
// boot path.
import '@/pages/x-dash/components/x-dash-page.css'
import { xdashUpdatingCopy } from '@/lib/xdash-health'

const MC_FILTERS = [
  { id: 'mc_all',   label: 'Any MC',       min: null,  max: null },
  { id: 'mc_micro', label: '< $1M',        min: 0,     max: 1e6 },
  { id: 'mc_5m',    label: '$1M – $5M',    min: 1e6,   max: 5e6 },
  { id: 'mc_50m',   label: '$5M – $50M',   min: 5e6,   max: 50e6 },
  { id: 'mc_500m',  label: '$50M – $500M', min: 50e6,  max: 500e6 },
  { id: 'mc_1b',    label: '$500M – $5B',  min: 500e6, max: 5e9 },
  { id: 'mc_lg',    label: '> $5B',        min: 5e9,   max: null },
]

// Mirrors /x-dash's "Sort by" pills exactly (same ids the bootstrap `ranking`
// param accepts, same labels, same order). Momentum is the default, matching the
// flagship board, so this preview and /x-dash lead with the same tokens.
const RANKINGS = [
  { id: 'mentions',   label: 'Mentions' },
  { id: 'momentum',   label: 'Momentum' },
  { id: 'conviction', label: 'Conviction' },
]

// Display sizes. Page 1 already carries the top-50 by the active ranking; the
// wider pool (see bootstrapParams / widen effect) only backfills after an MC
// filter thins the head.
const COUNT_OPTIONS = [10, 25, 50]

// Color buckets keyed by mindshare percentage — mirrors /x-bubbles.
const BUCKETS = [
  { id: 'b1', label: '> 10%',   min: 10,  accent: '#5CE6A1', glow: 'rgba(92,230,161,0.55)',  bg: 'linear-gradient(160deg, rgba(20,90,55,0.95) 0%, rgba(8,42,28,0.95) 100%)' },
  { id: 'b2', label: '5 – 10%', min: 5,   accent: '#F5C24D', glow: 'rgba(245,194,77,0.55)',  bg: 'linear-gradient(160deg, rgba(105,80,18,0.95) 0%, rgba(56,42,8,0.95) 100%)' },
  { id: 'b3', label: '2 – 5%',  min: 2,   accent: '#FF9046', glow: 'rgba(255,144,70,0.55)',  bg: 'linear-gradient(160deg, rgba(110,55,20,0.95) 0%, rgba(58,28,10,0.95) 100%)' },
  { id: 'b4', label: '1 – 2%',  min: 1,   accent: '#FF6E8E', glow: 'rgba(255,110,142,0.55)', bg: 'linear-gradient(160deg, rgba(110,30,42,0.95) 0%, rgba(64,18,28,0.95) 100%)' },
  { id: 'b5', label: '< 1%',    min: 0,   accent: '#9B7CE6', glow: 'rgba(155,124,230,0.55)', bg: 'linear-gradient(160deg, rgba(60,40,100,0.95) 0%, rgba(36,22,68,0.95) 100%)' },
]
function bucketFor(pct) {
  if (pct == null) return BUCKETS[4]
  for (const b of BUCKETS) if (pct >= b.min) return b
  return BUCKETS[4]
}

function fmtPct(n) {
  if (n == null || !isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`
}
function fmtCount(n) {
  if (n == null || !isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}
function fmtMC(n) {
  if (n == null || !isFinite(n)) return '—'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${Math.round(n)}`
}

function fmtVelocity(v) {
  if (v == null || !isFinite(v) || v <= 0) return '—'
  return `${v.toFixed(2)}×`
}

/* Relative "time since" for the freshness pill + per-row Last-mention column.
   Accepts an ISO string or epoch ms. Returns a compact label (now / 4m / 2h /
   3d) or null when the timestamp is missing/unparseable so callers render "—". */
function fmtAgo(ts, nowMs) {
  if (!ts) return null
  const t = typeof ts === 'number' ? ts : Date.parse(ts)
  if (!Number.isFinite(t)) return null
  const s = Math.max(0, ((nowMs || Date.now()) - t) / 1000)
  if (s < 45) return 'now'
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

/* Flatten an X Dash bootstrap row (already partly flattened by
   useXDashBootstrap) into the shape the views render. Mentions use
   external_mentions_24h — the canonical metric /x-dash ranks + shares by — so
   this board matches the flagship exactly. Growth is the attention-share delta
   (this token's 24h mentions vs its own prior daily average), the same "is
   attention rising or fading" signal the X Dash table shows. X Dash carries no
   price/volume/sparkline, so those columns are intentionally not rendered. */
function mapXDashRow(r) {
  const mentions = Number(r.external_mentions_24h ?? r.mentions_24h ?? 0)
  const prevAvg = Number(r.external_mentions_prev_daily_avg ?? 0)
  const growth = prevAvg > 0 ? ((mentions - prevAvg) / prevAvg) * 100 : null
  const sym = String(r.symbol || (r.cashtag || '').replace(/^\$/, '') || r.name || '').toUpperCase()
  const mc = Number(r.market_cap)
  return {
    asset: sym,
    name: r.name || sym,
    image: r.image || r.image_small || r.image_url || r.logo_url || null,
    coingecko_id: r.cg_id || r.token_id || null,
    mentions_24h: mentions,
    market_cap_usd: Number.isFinite(mc) && mc > 0 ? mc : null,
    velocity_ratio: Number(r.velocity_ratio) || null,
    unique_authors: Number(r.unique_external_authors_24h ?? r.unique_authors ?? 0) || null,
    growth_pct: growth,
    rank_direction: r.rank_direction || null,
    rank_change_positions: Number(r.rank_change_positions ?? 0),
    // Per-row recency — the last time X Dash saw a tweet mention this token.
    // Same source the /x-dash flagship table's "last seen" column reads.
    latest_mention_at:
      r.latest_mention_at
      || r.last_seen_at
      || (r.state && r.state.scheduler && r.state.scheduler.latest_kept_created_at)
      || null,
    // The untouched X Dash bootstrap row, kept so the List view can render the
    // real /x-dash table (XDTokenTable) which consumes this flat shape directly.
    _raw: r,
  }
}

/* Pages 2-4 of the bootstrap board arrive RAW (nested { token, metrics }),
   unlike page 1 which useXDashBootstrap already flattens. Flatten them the same
   way (token + metrics hoisted onto the row) so mapXDashRow reads them. */
function flattenBootstrapItem(item) {
  if (!item || typeof item !== 'object') return item
  const t = item.token && typeof item.token === 'object' ? item.token : null
  if (!t) return item
  return { ...item, ...t, ...(item.metrics || {}) }
}

/* Container size hook for the d3 treemap. Measures synchronously on mount
   so the very first render has non-zero dims (ResizeObserver's first tick
   often arrives after paint) then keeps updating on resize. */
function useStageSize(ref, deps = []) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    if (!ref.current) return undefined
    const el = ref.current
    const measure = () => {
      const rect = el.getBoundingClientRect()
      setSize({ w: Math.floor(rect.width), h: Math.floor(rect.height) })
    }
    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps])
  return size
}

/* Treemap (d3-hierarchy) — mirrors /x-bubbles TreemapView */
function TreemapView({ tokens, totalMentions, width, height, onSelect }) {
  const cells = useMemo(() => {
    if (!tokens.length || width <= 0 || height <= 0) return []
    const root = hierarchy({ name: 'root', children: tokens })
      .sum((d) => Math.sqrt(Math.max(d.mentions_24h || 0, 1)) + 8)
      .sort((a, b) => (b.value || 0) - (a.value || 0))
    d3treemap().size([width, height]).paddingInner(5).paddingOuter(0).round(true)(root)
    return root.leaves().map((leaf) => ({
      token: leaf.data,
      x: leaf.x0, y: leaf.y0,
      w: leaf.x1 - leaf.x0, h: leaf.y1 - leaf.y0,
    }))
  }, [tokens, width, height])

  return (
    <div className="sms-treemap" style={{ width, height }}>
      {cells.map(({ token, x, y, w, h }) => {
        const small = Math.min(w, h)
        const area = w * h
        const positive = (token.growth_pct ?? 0) >= 0
        const msPct = totalMentions > 0 ? ((token.mentions_24h || 0) / totalMentions) * 100 : 0
        const bucket = bucketFor(msPct)
        const tier = area >= 32000 ? 'lg' : area >= 11000 ? 'md' : area >= 3200 ? 'sm' : 'xs'
        const logoSize = Math.max(22, Math.min(56, Math.floor(small * 0.22)))
        const tickerSize = Math.max(13, Math.min(28, Math.floor(small * 0.14)))
        const nameSize = Math.max(10, Math.min(14, Math.floor(small * 0.07)))
        const pctSize = Math.max(15, Math.min(38, Math.floor(small * 0.20)))
        const deltaSize = Math.max(9, Math.min(13, Math.floor(small * 0.075)))

        return (
          <button
            key={token.asset}
            type="button"
            className={`sms-tm-cell sms-tm-cell-${tier}`}
            onClick={() => onSelect(token)}
            style={{
              left: x, top: y, width: w, height: h,
              background: bucket.bg,
              borderColor: 'rgba(255,255,255,0.06)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
            }}
          >
            <span className="sms-tm-halo" aria-hidden style={{ background: `radial-gradient(circle at 22% 26%, ${bucket.glow} 0%, transparent 55%)` }} />
            {tier !== 'xs' ? (
              <span className="sms-tm-card">
                <span className="sms-tm-card-top">
                  {token.image && (
                    <span className="sms-tm-logo-wrap" style={{ width: logoSize, height: logoSize, boxShadow: `0 0 24px ${bucket.glow}` }}>
                      <img className="sms-tm-logo" src={token.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
                    </span>
                  )}
                  <span className="sms-tm-id">
                    <span className="sms-tm-ticker mono" style={{ fontSize: tickerSize }}>{token.asset}</span>
                    {tier !== 'sm' && <span className="sms-tm-name" style={{ fontSize: nameSize }}>{token.name || token.asset}</span>}
                  </span>
                </span>
                <span className="sms-tm-card-bot">
                  <span className="sms-tm-pct mono" style={{ fontSize: pctSize }}>
                    {msPct >= 0.1 ? `${msPct.toFixed(1)}%` : '<0.1%'}
                  </span>
                  <span className="sms-tm-delta mono" style={{ fontSize: deltaSize, color: positive ? '#5CE6A1' : '#FF6E8E' }}>
                    <span className="sms-tm-delta-arrow" aria-hidden>{positive ? '▲' : '▼'}</span>
                    {' '}{fmtPct(token.growth_pct)}
                  </span>
                  {tier !== 'sm' && (
                    <span className="sms-tm-meta mono" style={{ fontSize: deltaSize }}>
                      {fmtCount(token.mentions_24h)} mentions{token.market_cap_usd ? ` · ${fmtMC(token.market_cap_usd)} MC` : ''}
                    </span>
                  )}
                </span>
              </span>
            ) : (
              <span className="sms-tm-xs">
                {token.image && <img className="sms-tm-logo-mini" src={token.image} alt="" loading="lazy" />}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* Rank-movement chip — where a token sits vs the previous snapshot. Mirrors the
   /x-dash flagship RankMove: ▲/▼ with the positions moved, NEW for first-seen. */
function RankMove({ direction, delta }) {
  const { t } = useTranslation()
  const dir = String(direction || '').toLowerCase()
  const amount = Math.abs(Number(delta || 0))
  if (dir === 'new') return <span className="sms-rankmove sms-rankmove-new">{t('homePage.socialMindshareSection.rankmove.new', "NEW")}</span>
  if (dir === 'up') return <span className="sms-rankmove sms-rankmove-up">▲{amount > 0 ? amount : ''}</span>
  if (dir === 'down') return <span className="sms-rankmove sms-rankmove-down">▼{amount > 0 ? amount : ''}</span>
  return <span className="sms-rankmove sms-rankmove-flat">–</span>
}

/* Compact social leaderboard — every column is an X Dash attention metric.
   The rank-move chip + mindshare bar + Last-mention recency fill what used to be
   dead horizontal space with signal, and the two flex columns (Token, Mindshare)
   absorb the slack so the metrics stay tight instead of floating far apart. */
function ListView({ tokens, totalMentions, onSelect, nowMs }) {
  const { t } = useTranslation()
  // Scale the mindshare bars against the loudest row in view so the leader's
  // bar reads full and the tail stays proportional (shares are single-digit %).
  const maxShare = tokens.reduce((m, t) => {
    const s = totalMentions > 0 ? ((t.mentions_24h || 0) / totalMentions) * 100 : 0
    return s > m ? s : m
  }, 0) || 1
  return (
    <div className="sms-list">
      <div className="sms-list-head mono">
        <span>#</span>
        <span className="sms-list-move-h" title={t('homePage.socialMindshareSection.listview.title', "Rank change vs last snapshot")}>Δ</span>
        <span>{t('homePage.socialMindshareSection.listview.token', "Token")}</span>
        <span className="ta-r">{t('homePage.socialMindshareSection.listview.mentions', "Mentions")}</span>
        <span>{t('homePage.socialMindshareSection.listview.mindshare', "Mindshare")}</span>
        <span className="ta-r">{t('homePage.socialMindshareSection.listview.growth', "Growth")}</span>
        <span className="ta-r">{t('homePage.socialMindshareSection.listview.velocity', "Velocity")}</span>
        <span className="ta-r">{t('homePage.socialMindshareSection.listview.authors', "Authors")}</span>
        <span className="ta-r">{t('homePage.socialMindshareSection.listview.last', "Last")}</span>
        <span className="ta-r">{t('homePage.socialMindshareSection.listview.mc', "MC")}</span>
      </div>
      <div className="sms-list-body">
        {tokens.map((t, i) => {
          const mentions = t.mentions_24h || 0
          const msPct = totalMentions > 0 ? (mentions / totalMentions) * 100 : 0
          const bucket = bucketFor(msPct)
          const hasGrowth = t.growth_pct != null
          const growth = Number(t.growth_pct ?? 0)
          const barPct = Math.max(msPct > 0 ? 6 : 0, (msPct / maxShare) * 100)
          const ago = fmtAgo(t.latest_mention_at, nowMs)
          const isFresh = ago === 'now' || (ago && ago.endsWith('m'))
          return (
            <button key={t.asset} type="button" className="sms-list-row" onClick={() => onSelect(t)}>
              <span className="sms-list-rank mono">{i + 1}</span>
              <span className="sms-list-move">
                <RankMove direction={t.rank_direction} delta={t.rank_change_positions} />
              </span>
              <span className="sms-list-token">
                {t.image
                  ? <img className="sms-list-logo" src={t.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                  : <span className="sms-list-logo sms-list-logo-fallback">{String(t.asset || '').slice(0, 2)}</span>}
                <span className="sms-list-id">
                  <span className="sms-list-ticker mono">{t.asset}</span>
                  <span className="sms-list-name">{t.name}</span>
                </span>
              </span>
              <span className="sms-list-mentions mono ta-r" style={{ color: bucket.accent }}>{fmtCount(mentions)}</span>
              <span className="sms-list-share-cell">
                <span className="sms-ms-bar">
                  <span className="sms-ms-bar-fill" style={{ width: `${barPct}%`, background: `linear-gradient(90deg, ${bucket.accent}dd, ${bucket.accent}66)` }} />
                </span>
                <span className="sms-ms-val mono">{msPct >= 0.01 ? `${msPct.toFixed(2)}%` : '—'}</span>
              </span>
              <span className={`sms-list-num mono ta-r ${hasGrowth ? (growth >= 0 ? 'bull' : 'bear') : ''}`}>{hasGrowth ? fmtPct(growth) : '—'}</span>
              <span className="sms-list-num mono ta-r">{fmtVelocity(t.velocity_ratio)}</span>
              <span className="sms-list-vol mono ta-r">{t.unique_authors ? fmtCount(t.unique_authors) : '—'}</span>
              <span className={`sms-list-last mono ta-r${isFresh ? ' is-fresh' : ''}`}>{ago || '—'}</span>
              <span className="sms-list-mc mono ta-r">{fmtMC(t.market_cap_usd)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* Bars list — mentions bar + the X Dash attention metrics */
function BarsView({ tokens, totalMentions, onSelect }) {
  const { t } = useTranslation()
  const max = Math.max(...tokens.map((t) => t.mentions_24h || 0), 1)
  return (
    <div className="sms-bars">
      <div className="sms-bars-head mono">
        <span>#</span>
        <span>{t('homePage.socialMindshareSection.barsview.token', "Token")}</span>
        <span>{t('homePage.socialMindshareSection.barsview.mentionsMindshare', "Mentions / Mindshare")}</span>
        <span>{t('homePage.socialMindshareSection.barsview.velocity', "Velocity")}</span>
        <span>{t('homePage.socialMindshareSection.barsview.authors', "Authors")}</span>
        <span>{t('homePage.socialMindshareSection.barsview.growth', "Growth")}</span>
        <span className="sms-bars-mc-h">{t('homePage.socialMindshareSection.barsview.mc', "MC")}</span>
      </div>
      <div className="sms-bars-body">
        {tokens.map((t, i) => {
          const mentions = t.mentions_24h || 0
          const isInactive = mentions <= 1
          const msPct = totalMentions > 0 ? (mentions / totalMentions) * 100 : 0
          const bucket = bucketFor(msPct)
          const fillPct = isInactive ? 0 : (mentions / max) * 100
          const hasGrowth = t.growth_pct != null
          const positive = (t.growth_pct ?? 0) >= 0
          return (
            <button key={t.asset} type="button" className={`sms-bars-row${isInactive ? ' is-inactive' : ''}`} onClick={() => onSelect(t)}>
              <span className="sms-bars-rank mono">{i + 1}</span>
              <span className="sms-bars-token">
                {t.image
                  ? <img className="sms-bars-logo" src={t.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                  : <span className="sms-bars-logo sms-bars-logo-fallback">{String(t.asset || '').slice(0, 2)}</span>}
                <span className="sms-bars-id">
                  <span className="sms-bars-ticker mono">{t.asset}</span>
                  <span className="sms-bars-name">{t.name}</span>
                </span>
              </span>
              <span className="sms-bars-bar">
                {!isInactive && (
                  <span
                    className="sms-bars-bar-fill"
                    style={{
                      width: `${fillPct}%`,
                      background: `linear-gradient(90deg, ${bucket.accent}cc, ${bucket.accent}66)`,
                      boxShadow: `0 0 12px ${bucket.glow}`,
                    }}
                  />
                )}
                <span className="sms-bars-bar-text mono">
                  {isInactive ? <span className="sms-bars-bar-quiet">—</span> : fmtCount(mentions)}
                  {!isInactive && <span className="sms-bars-bar-sub"> {msPct >= 0.1 ? `${msPct.toFixed(2)}%` : '<0.1%'}</span>}
                </span>
              </span>
              <span className="sms-bars-growth mono">{fmtVelocity(t.velocity_ratio)}</span>
              <span className="sms-bars-growth mono">{t.unique_authors ? fmtCount(t.unique_authors) : '—'}</span>
              <span className="sms-bars-growth mono" style={{ color: hasGrowth ? (positive ? '#5CE6A1' : '#FF6E8E') : 'rgba(255,255,255,0.4)' }}>
                {hasGrowth ? `${positive ? '▲' : '▼'} ${fmtPct(t.growth_pct)}` : '—'}
              </span>
              <span className="sms-bars-mc mono">{t.market_cap_usd ? fmtMC(t.market_cap_usd) : '—'}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const SocialMindshareSection = ({ onTokenClick }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [ranking, setRanking] = useState('momentum')
  const [mcFilter, setMcFilter] = useState('mc_all')
  const [view, setView] = useState('list') // 'list' (dense table) | 'bars' | 'heatmap'
  const [topN, setTopN] = useState(50)
  // Paginated tail (pages 2-4) merged into the ranking pool — see the widen
  // effect below. Empty until page 1 lands; Mentions/Mindshare don't need it.
  const [tailRows, setTailRows] = useState([])
  // Ticking clock so the "Updated Xm ago" pill + per-row Last column stay live
  // between the 2-min data polls. Bumped every 30s, idle/hidden-guarded.
  const [nowMs, setNowMs] = useState(() => Date.now())
  const stageRef = useRef(null)
  const stage = useStageSize(stageRef, [view])

  // X Dash bootstrap board — same source as /x-dash + the Command Center social
  // map. Page 1 (the top-50 for the active ranking) comes through
  // useXDashBootstrap, which owns the loading / "X Dash is updating" / auth-gate
  // UX + first paint. The `ranking` pill is passed straight to the server (same
  // as /x-dash), so the board arrives pre-ordered — switching pills refetches
  // and the hook re-keys its cache on `ranking`. The upstream board is capped at
  // 50/page (the "REDMI" contract), so pages 2-4 are paginated in the background
  // (see the widen effect below) to build a ~200-row pool that backfills topN
  // after an MC filter thins the head. Refresh on a 2-min idle-gated tick + focus.
  const bootstrapParams = useMemo(() => ({
    page: 1, perPage: 50, timeframe: '24h',
    ranking, segment: 'all', market: 'all', minKols: 1,
  }), [ranking])
  const { data: xd, loading, error, refetch, health } = useXDashBootstrap(
    bootstrapParams,
    // persist: home-page first-paint surface - LS seed kills the cold shimmer
    { refreshIntervalMs: 120_000, refreshOnFocus: true, persist: true },
  )
  const data = useMemo(() => (xd?.tokens || []).map(mapXDashRow), [xd])

  // Keep the freshness labels live between polls without a network hit.
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) setNowMs(Date.now())
    }, 30_000)
    return () => clearInterval(id)
  }, [])

  // Data freshness — how long ago the X Dash board this section renders was
  // generated (server stamps generated_at_utc on every bootstrap response).
  const dataAgeLabel = useMemo(
    () => fmtAgo(xd?.generated_at_utc || xd?.generated_at, nowMs),
    [xd, nowMs],
  )

  // Widen the pool past page 1 in the SAME server ranking as the head. The
  // bootstrap board is capped at 50/page (REDMI contract), so pages 2-4 extend
  // the board to ~200 rows — used to backfill topN when an MC filter thins the
  // top 50. Because every page is server-ordered by the active `ranking`,
  // head(1-50)+tail(51-200) is already globally ranked; no client re-sort needed.
  // Fires ONLY once page 1 has data (never widens an errored / empty board), and
  // re-runs when page 1 refreshes (xd identity) OR the ranking changes so the
  // tail matches the head's metric. Hidden tabs skip it; page-1 UX is untouched.
  // This section only mounts on the active Social tab, so it's not a boot cost.
  useEffect(() => {
    if (!xd?.tokens?.length || document.hidden) return undefined
    let cancelled = false
    const reqs = [2, 3, 4].map((p) => {
      const q = new URLSearchParams({
        page: String(p), per_page: '50', timeframe: '24h',
        ranking, segment: 'all', market: 'all', min_kols: '1',
      })
      return fetch(`/api/xdash/bootstrap?${q}`, {
        credentials: 'include',
        signal: AbortSignal.timeout(15000),
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    })
    Promise.all(reqs).then((results) => {
      if (cancelled) return
      const rows = results
        .flatMap((r) => r?.tokens || [])
        .map(flattenBootstrapItem)
        .map(mapXDashRow)
      setTailRows(rows)
    })
    return () => { cancelled = true }
  }, [xd, ranking])

  // Ranking pool = page-1 head + paginated tail, deduped by ticker (head wins).
  const pool = useMemo(() => {
    if (!tailRows.length) return data
    const seen = new Set(data.map((t) => t.asset))
    return data.concat(tailRows.filter((t) => t.asset && !seen.has(t.asset)))
  }, [data, tailRows])

  // Auto-heal when the board errored with NOTHING loaded: fast backoff for a
  // cold-load blip, settling into a steady ~25s poll for a real X Dash outage
  // (indexer rebuild / API restart) so the board reconnects without user
  // action. Reset only on recovered DATA - the error string clears at the
  // start of every in-flight retry, so it can't be the reset signal. Hidden
  // tabs skip the refetch; refreshOnFocus revives the chain on return.
  const retryRef = useRef(0)
  useEffect(() => {
    if (data && data.length) { retryRef.current = 0; return undefined }
    if (!error) return undefined
    const delay = Math.min(2500 + retryRef.current * 2000, 25000)
    const id = setTimeout(() => {
      retryRef.current += 1
      if (!document.hidden) refetch()
    }, delay)
    return () => clearTimeout(id)
  }, [error, data, refetch])

  const filtered = useMemo(() => {
    if (!pool?.length) return []
    // X Dash already returns a sanitized discovery board, so the only guard is
    // a valid ticker — no aggressive dust/market-cap filter (that dropped legit
    // small-cap narratives the X Dash board deliberately surfaces).
    let rows = pool.filter(t => t.asset && (t.mentions_24h || 0) > 0)
    const mc = MC_FILTERS.find(m => m.id === mcFilter)
    if (mc && (mc.min != null || mc.max != null)) {
      rows = rows.filter(t => {
        const v = t.market_cap_usd
        if (v == null) return false
        if (mc.min != null && v < mc.min) return false
        if (mc.max != null && v >= mc.max) return false
        return true
      })
    }
    // The pool is already server-ordered by the active `ranking` (the pill is
    // passed to the bootstrap fetch, same as /x-dash), and every paginated page
    // preserves that order, so head+tail is globally ranked. Keep that order —
    // no client re-sort — so this preview leads with the same tokens as /x-dash.
    return rows.slice(0, topN)
  }, [pool, mcFilter, topN])

  const totalMentions = useMemo(
    () => filtered.reduce((s, t) => s + (t.mentions_24h || 0), 0),
    [filtered],
  )

  // Raw X Dash rows (filter/order preserved) for the real /x-dash table.
  const listRawRows = useMemo(
    () => filtered.map((t) => t._raw).filter(Boolean),
    [filtered],
  )

  const handleClick = useCallback((token) => {
    if (typeof onTokenClick === 'function') {
      onTokenClick(token)
      return
    }
    if (token.coingecko_id) {
      navigate(`${getPathForPageId('research-zone')}/${token.coingecko_id}`)
    }
  }, [onTokenClick, navigate])

  // XDTokenTable's row-click hands back only a cg_id; resolve it to the row so
  // the click opens the AI Screener with full identity (matching its own S
  // button and the On-Chain tab). Its R/S buttons already navigate themselves.
  const handleOpenToken = useCallback((cgId) => {
    if (!cgId) return
    const row = filtered.find((t) => t.coingecko_id === cgId)
    if (row) handleClick(row)
  }, [filtered, handleClick])

  return (
    <section className="sms">
      <div className="sms-toolbar">
        <div className="sms-toolbar-row">
          <div className="sms-pill-group" role="radiogroup" aria-label={t('homePage.socialMindshareSection.socialmindshare.ariaRanking', "Ranking")}>
            {RANKINGS.map(r => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={ranking === r.id}
                className={`sms-pill${ranking === r.id ? ' is-active' : ''}`}
                onClick={() => setRanking(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="sms-toolbar-right">
            {dataAgeLabel && (
              <span className="sms-fresh" title={t('homePage.socialMindshareSection.socialmindshare.title', "When this social board was last generated by X Dash")}>
                <span className="sms-fresh-dot" aria-hidden="true" />
                <span className="sms-fresh-txt">Updated {dataAgeLabel === 'now' ? 'just now' : `${dataAgeLabel} ago`}</span>
              </span>
            )}
            <div className="sms-pill-group" role="radiogroup" aria-label={t('homePage.socialMindshareSection.socialmindshare.ariaView', "View")}>
              <button
                type="button"
                role="radio"
                aria-checked={view === 'list'}
                className={`sms-pill${view === 'list' ? ' is-active' : ''}`}
                onClick={() => setView('list')}
              >{t('homePage.socialMindshareSection.socialmindshare.list', "List")}</button>
              <button
                type="button"
                role="radio"
                aria-checked={view === 'bars'}
                className={`sms-pill${view === 'bars' ? ' is-active' : ''}`}
                onClick={() => setView('bars')}
              >{t('homePage.socialMindshareSection.socialmindshare.bars', "Bars")}</button>
              <button
                type="button"
                role="radio"
                aria-checked={view === 'heatmap'}
                className={`sms-pill${view === 'heatmap' ? ' is-active' : ''}`}
                onClick={() => setView('heatmap')}
              >{t('homePage.socialMindshareSection.socialmindshare.heatmap', "Heatmap")}</button>
            </div>

            <div className="sms-pill-group" role="radiogroup" aria-label={t('homePage.socialMindshareSection.socialmindshare.ariaCount', "Count")}>
              {COUNT_OPTIONS.map(n => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={topN === n}
                  className={`sms-pill sms-pill-sm${topN === n ? ' is-active' : ''}`}
                  onClick={() => setTopN(n)}
                >{n}</button>
              ))}
            </div>

            <button
              type="button"
              className="sms-full-link"
              onClick={() => navigate(getPathForPageId('x-dash'))}
              title={t('homePage.socialMindshareSection.socialmindshare.title2', "Open the full X Dash social intelligence")}
            >
              <span>{t('homePage.socialMindshareSection.socialmindshare.fullSocialIntelligence', "Full Social Intelligence")}</span>
              <span className="sms-full-link-arrow" aria-hidden="true">→</span>
            </button>
          </div>
        </div>

        <div className="sms-toolbar-row sms-toolbar-row-secondary">
          <span className="sms-pill-label">{t('homePage.socialMindshareSection.socialmindshare.marketCap', "MARKET CAP")}</span>
          <div className="sms-pill-group sms-mc-group" role="radiogroup" aria-label={t('homePage.socialMindshareSection.socialmindshare.ariaMarketCapFilter', "Market cap filter")}>
            {MC_FILTERS.map(m => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mcFilter === m.id}
                className={`sms-pill sms-pill-sm${mcFilter === m.id ? ' is-active' : ''}`}
                onClick={() => setMcFilter(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="sms-legend">
            {BUCKETS.map(b => (
              <span key={b.id} className="sms-legend-item">
                <span className="sms-legend-dot" style={{ background: b.accent }} />
                {b.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {loading && !filtered.length ? (
        <div className="sms-loading">
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i} className="sms-skeleton-row" style={{ animationDelay: `${i * 40}ms` }} />
          ))}
        </div>
      ) : ((error || health?.state === 'updating') && !filtered.length) ? (
        // Only surface the outage when we have NOTHING to show — a transient
        // bootstrap hiccup must not blank a board that already has data (the
        // hook keeps last-good). The auto-retry above polls until X Dash is
        // back, so this reads as a calm updating state, not a dead error.
        //
        // `health` is here because the failure that actually reaches users is
        // the one that raises NO error: the upstream answers 200 from a window
        // it did build and the board is empty. Without it this fell through to
        // "No tokens match the current filters" — filters the user never set.
        <div className="sms-error sms-updating" role="status" aria-live="polite">
          <span className="sms-updating-dot" aria-hidden="true" />
          <div className="sms-updating-copy">
            <strong>{t('homePage.socialMindshareSection.socialmindshare.xDashIsUpdating', "X Dash is updating")}</strong>
            <span>{xdashUpdatingCopy(health)}</span>
          </div>
          <button type="button" onClick={() => refetch()}>{t('homePage.socialMindshareSection.socialmindshare.refreshNow', "Refresh now")}</button>
        </div>
      ) : !filtered.length ? (
        <div className="sms-empty">{t('homePage.socialMindshareSection.socialmindshare.noTokensMatchTheCurrentFi', "No tokens match the current filters.")}</div>
      ) : view === 'list' ? (
        <XDTokenTable rows={listRawRows} onOpenToken={handleOpenToken} windowLabel="24h" />
      ) : view === 'bars' ? (
        <BarsView tokens={filtered} totalMentions={totalMentions} onSelect={handleClick} />
      ) : (
        // Rich mindshare treemap — cells carry mindshare %, 24h change, mentions
        // + MC, color-bucketed by mindshare share (the screenshot-#6 look).
        <div className="sms-treemap-stage" ref={stageRef}>
          <TreemapView
            tokens={filtered}
            totalMentions={totalMentions}
            width={stage.w}
            height={stage.h}
            onSelect={handleClick}
          />
        </div>
      )}
    </section>
  )
}

export default SocialMindshareSection
