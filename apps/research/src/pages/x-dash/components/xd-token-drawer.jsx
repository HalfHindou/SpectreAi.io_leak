/**
 * Token detail drawer. Slides in from the right, URL-driven by the shell.
 * Binds to useXDashToken(cgId) which merges /api/xdash/token/:id and
 * /api/xdash/intel/token/:id. Normalized via normalizeXDashDetail.
 */
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import useSettingsStore from '@/store/useSettingsStore'
// The Spectre "brain" — the same catalyst-aware causal agent the Research Zone
// uses. Lazy so the heavy chat (voice, canvas) only loads when a user expands
// it. Here it's fed SOCIAL catalysts (the loudest mentions) so "why is $X
// trending?" is answered with the actual driver, not generic momentum talk.
const RzAgentChat = lazy(() => import('@/pages/research-zone/components/rz-agent-chat'))
import { useXDashToken } from '@/hooks/useXDashToken'
import { useXDashPrices } from '@/hooks/useXDashPrices'
import { getTokenWithPrice } from '@/services/codexApi'
import { useCurrency } from '@/hooks/useCurrency'
import { overrideMomentumEntry, suppressOriginIfOverridden } from './momentum-overrides'
import {
  Avatar, StatTile, StatBar, QualityPill, Shimmer, ErrorState, CarrierRow,
  SignalScore, SignalPartsBars,
} from './xd-bits'
import { XDMomentumArea, XDHealthRadar, XDQualityShares } from './xd-charts'
import XDMentionsFeed from './xd-mentions-feed'
import XDLiveSocial from './xd-live-social'
import XDCreatorsHeatmap from './xd-creators-heatmap'
import XDMiniBubble from './xd-mini-bubble'
import XDSentimentChart from './xd-sentiment-chart'
import { computeSignalScore, SIGNAL_PART_LABELS, SIGNAL_TIER_LABEL } from './xd-signal'
import InfoTip from '@/components/InfoTip'
import { useAppState } from '@/contexts/AppStateContext'
import { buildResearchZoneLocation } from '@/lib/research-zone-routing'
import { isMajorToken } from '@/constants/majorTokens'
import { getMetricInfo } from '@/constants/socialMetricsGlossary'
import {
  normalizeXDashDetail, formatNum, formatPercent, humanizeLabel, getAuthorId,
  buildCarrierBoard, buildStrengthLookup, getMentionText, openTradingTerminal,
} from './x-dash-utils'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import { getTokenSeed } from '@/lib/xdash-token-seed'
import { classifyChatter } from '@/lib/chatter-tone'
import useProThemeSkin from '@/components/pro-theme/use-pro-theme-skin'

/* Overlay a real (fetched) metrics object onto a seed floor: every real field
   that's actually present (not null/undefined) wins; anything the real payload
   omits falls back to the seed. So when the detail fetch returns an empty
   envelope, the seed's board-row numbers carry the drawer instead of dashes. */
function mergeSeedMetrics(seed, real) {
  if (!seed) return real || {}
  const out = { ...seed }
  if (real) {
    for (const k of Object.keys(real)) {
      const v = real[k]
      if (v !== null && v !== undefined) out[k] = v
    }
  }
  return out
}

/* 7-day price sparkline cache + hook. CoinGecko market_chart gives daily
   close prices for 7 days in one cheap call. The hook fires in parallel
   with everything else the drawer does, caches per cg_id, and returns
   { prices: number[], loading } so the consumer can render a shimmer
   while the data lands. */
const _sparkCache = new Map()
const _sparkInflight = new Map()

function useTokenSparkline7d(cgId) {
  const cached = cgId ? _sparkCache.get(cgId) : null
  const [prices, setPrices] = useState(cached?.prices ?? null)
  const [loading, setLoading] = useState(!cached && Boolean(cgId))

  useEffect(() => {
    if (!cgId) { setPrices(null); setLoading(false); return undefined }
    if (_sparkCache.has(cgId)) {
      const entry = _sparkCache.get(cgId)
      setPrices(entry.prices)
      setLoading(false)
      return undefined
    }
    setLoading(true)
    let cancelled = false
    const promise = _sparkInflight.get(cgId) || (async () => {
      try {
        const r = await fetch(
          `/api/coingecko/coins/markets?vs_currency=usd&ids=${encodeURIComponent(cgId)}&sparkline=true&per_page=1`,
          { signal: AbortSignal.timeout(8000) },
        )
        if (!r.ok) return []
        const data = await r.json()
        const arr = Array.isArray(data) ? data[0]?.sparkline_in_7d?.price : null
        return Array.isArray(arr) ? arr : []
      } catch { return [] }
    })()
    _sparkInflight.set(cgId, promise)
    promise.then((arr) => {
      _sparkCache.set(cgId, { prices: arr, ts: Date.now() })
      _sparkInflight.delete(cgId)
      if (!cancelled) {
        setPrices(arr)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [cgId])

  return { prices, loading }
}

/* Tiny inline SVG sparkline. ~96px wide, no axes - meant to read as a
   trend hint next to the live price. Picks tone from start vs end so the
   line color matches the period's net direction. */
function Sparkline7d({ prices, loading, width = 100, height = 36 }) {
  if (loading) {
    return <div className="xd-tokensummary__spark xd-tokensummary__spark--skel animate-shimmer" style={{ width, height }} />
  }
  if (!Array.isArray(prices) || prices.length < 2) return null
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const stepX = width / (prices.length - 1)
  const points = prices.map((p, i) => {
    const x = i * stepX
    const y = height - ((p - min) / range) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const isUp = prices[prices.length - 1] >= prices[0]
  /* Use bull/bear hex directly instead of relying on the CSS var so the
     stroke renders identically in day mode and dark mode (the var resolves
     to the same value but some surfaces tint it down). Fill alpha bumped
     to 0.32 — 0.18 was nearly invisible on a white background and the
     sparkline read as just a thin line. */
  const stroke = isUp ? '#10B981' : '#EF4444'
  const fill = isUp ? 'rgba(16,185,129,0.32)' : 'rgba(239,68,68,0.32)'
  const area = `0,${height} ${points} ${width},${height}`
  /* Bigger sparkline (fullscreen mode) gets a thicker stroke so the trend
     line reads at hero size instead of disappearing into a hairline. */
  const strokeWidth = width >= 200 ? 2.4 : 1.6
  return (
    <svg
      className="xd-tokensummary__spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label="7-day price trend"
    >
      <polygon points={area} fill={fill} />
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)
const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
)
const ExpandIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
)
const BackIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
)

function truncMid(s, head = 6, tail = 4) {
  if (!s || s.length <= head + tail + 1) return s || ''
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}

/* Momentum history wrapper with a timeframe selector. The underlying
   chart (XDMomentumArea) is unchanged — we just slice the snapshot
   array client-side before handing it down. Snapshots typically arrive
   at hourly cadence, so 24h ≈ last 24 rows, 7d ≈ last ~168 rows. The
   "All" tab uses whatever the backend returned. */
const MOMENTUM_TIMEFRAMES = [
  { id: '24h', label: '24H', windowMs: 24 * 60 * 60 * 1000 },
  { id: '7d',  label: '7D',  windowMs: 7  * 24 * 60 * 60 * 1000 },
  { id: '30d', label: '30D', windowMs: 30 * 24 * 60 * 60 * 1000 },
  { id: 'all', label: 'All', windowMs: null },
]

// Stats-tile timeframe. X-Dash upstream returns rolling-24h and lifetime
// totals natively on the metrics envelope, but no 7d/30d aggregates. We
// expose only the two windows we actually have rather than fake the rest.
const STATS_TIMEFRAMES = [
  { id: '24h', label: '24H', suffix: '24h' },
  { id: 'all', label: 'All', suffix: 'total' },
]
// Carrier/KOL roster window. VERIFIED against the X-Dash token endpoint
// (2026-06-14): the author rollup only honours 24h vs 7d — `author_rollup_scope`
// is `{source:'raw_token_mentions', timeframe, limit:50}`, and timeframe=30d/all
// return the SAME roster as 24h (no deeper window; hard 50-author cap, no author
// pagination). So we expose only the two windows that actually return distinct
// data rather than fake 30d/All. 7d surfaces the bigger KOLs 24h hides (e.g.
// $MANIFEST 7d adds @oxgordonsol 32 / @waqszzz 20 mentions). A true
// from-inception roster needs a wider rollup on the X-Dash service itself.
const CARRIER_TIMEFRAMES = [
  { id: '24h', label: '24H' },
  { id: '7d', label: '7D' },
]
function MomentumHistoryBlock({ history = [], loading, height = 150, firstSeenAt = null }) {
  const { t } = useTranslation()
  // Compute the actual span of available data once — the "X-Dash only has
  // 18h of snapshots for this token" reality the user was hitting becomes
  // visible feedback instead of silently broken timeframe pills.
  // The data-span calc still walks history (drives "is 7d/30d available"),
  // but the displayed first-caught timestamp now PREFERS the explicit
  // `firstSeenAt` prop (X-Dash state.first_ingested_at). Without that, the
  // pill would lie — the rolling-snapshot window is only the last few hours,
  // not when the token was first seen.
  const dataMeta = useMemo(() => {
    const rows = Array.isArray(history) ? history : []
    if (!rows.length) return { spanMs: 0 }
    let minTs = Infinity
    let maxTs = -Infinity
    for (const r of rows) {
      const ts = new Date(r?.snapshot_at).getTime()
      if (!Number.isFinite(ts)) continue
      if (ts < minTs) minTs = ts
      if (ts > maxTs) maxTs = ts
    }
    if (!Number.isFinite(minTs)) return { spanMs: 0 }
    return { spanMs: maxTs - minTs }
  }, [history])
  const firstSeenTs = useMemo(() => {
    if (!firstSeenAt) return null
    const t = new Date(firstSeenAt).getTime()
    return Number.isFinite(t) ? t : null
  }, [firstSeenAt])

  // Default to the smallest timeframe the data actually supports so the
  // user never lands on an empty "30d" view when only 12h exists.
  const defaultTf = useMemo(() => {
    if (dataMeta.spanMs >= 30 * 24 * 60 * 60 * 1000) return '7d'
    if (dataMeta.spanMs >= 7 * 24 * 60 * 60 * 1000) return '7d'
    return '24h'
  }, [dataMeta.spanMs])
  const [tf, setTf] = useState(defaultTf)
  useEffect(() => { setTf(defaultTf) }, [defaultTf])

  const filtered = useMemo(() => {
    const rows = Array.isArray(history) ? history : []
    const cfg = MOMENTUM_TIMEFRAMES.find((t) => t.id === tf) || MOMENTUM_TIMEFRAMES[1]
    if (!cfg.windowMs) return rows
    const cutoff = Date.now() - cfg.windowMs
    return rows.filter((r) => {
      const ts = new Date(r?.snapshot_at).getTime()
      return Number.isFinite(ts) && ts >= cutoff
    })
  }, [history, tf])

  const firstSeenLabel = firstSeenTs ? formatFirstSeen(firstSeenTs) : null
  // A timeframe is "available" only when the data span covers at least
  // half of it — otherwise the chart would render the same as a shorter
  // tab and silently mislead the user.
  const tfHasCoverage = (cfg) => {
    if (!cfg.windowMs) return dataMeta.spanMs > 0
    return dataMeta.spanMs >= cfg.windowMs / 2
  }

  return (
    <div className="xd-drawer-chart">
      <div className="xd-momentum-head">
        <div className="xd-momentum-head__l">
          <span className="xd-drawer-chart__label" style={{ margin: 0 }}>{t('xDash.tokenDrawer.momentumHistory', 'Momentum history')}</span>
          {firstSeenLabel && (
            <span
              className="xd-momentum-firstseen"
              title={t('xDash.tokenDrawer.firstSeenTooltip', 'X-Dash crawler first saw this token in tweets at {{when}}. Different from the Momentum entry (above) — that\'s when it climbed into the Top 25 board.', { when: new Date(firstSeenTs).toLocaleString() })}
            >
              <span className="xd-momentum-firstseen__icon" aria-hidden="true">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
              </span>
              <span className="xd-momentum-firstseen__label">{t('xDash.tokenDrawer.xDashIndexed', 'X-Dash indexed')}</span>
              <span className="xd-momentum-firstseen__value">{firstSeenLabel}</span>
            </span>
          )}
        </div>
        <div className="xd-momentum-tfs" role="tablist" aria-label={t('xDash.tokenDrawer.momentumTimeframeAria', 'Momentum timeframe')}>
          {MOMENTUM_TIMEFRAMES.map((tf2) => {
            const available = tfHasCoverage(tf2)
            return (
              <button
                key={tf2.id}
                type="button"
                role="tab"
                aria-selected={tf === tf2.id}
                aria-disabled={!available}
                className={`xd-momentum-tf${tf === tf2.id ? ' is-active' : ''}${!available ? ' is-disabled' : ''}`}
                onClick={() => available && setTf(tf2.id)}
                title={!available ? t('xDash.tokenDrawer.notEnoughHistory', 'Not enough history yet for this window') : undefined}
              >
                {tf2.label}
              </button>
            )
          })}
        </div>
      </div>
      <XDMomentumArea history={filtered} loading={loading} height={height} />
    </div>
  )
}

/* Removed — Alaa shipped the canonical version (MomentumEntryCard below)
   in 58c73619 with paired CSS + class scheme `xd-ment__*`. Keep one source
   of truth; my parallel SpectreMomentumBlock + its `xd-spectre-momentum__*`
   styles are redundant and were dropped during merge. */

// Compact "first caught" formatter — minutes/hours/days ago, with date
// fallback for snapshots more than ~30 days old.
function formatFirstSeen(ts) {
  if (!ts) return null
  const diff = Date.now() - ts
  if (diff < 0) return 'just now'
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const date = new Date(ts)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/* Some tokens (L1 natives: BTC, ETH, SOL, XTZ) have no on-chain contract.
   When CoinGecko returns `platforms: { "": "" }` for those, our address
   resolver coerces it into a junk string like "unkown" which then renders
   as a broken pill. Treat anything that doesn't look like a real address
   as "no contract" so the pill simply doesn't render. */
function isValidContractAddress(addr) {
  if (typeof addr !== 'string') return false
  const s = addr.trim()
  if (s.length < 8) return false
  if (/^(unkn?own|none|null|undefined|n\/a)$/i.test(s)) return false
  // Ethereum-style hex (0x + 40+ hex chars)
  if (/^0x[0-9a-fA-F]{8,}$/.test(s)) return true
  // Solana / generic base58 (32-44 alphanum, no leading 0/O/I/l)
  if (/^[1-9A-HJ-NP-Za-km-z]{20,}$/.test(s)) return true
  // Generic alphanum/dash/underscore, length >= 12 (loose fallback)
  if (/^[a-zA-Z0-9_-]{12,}$/.test(s)) return true
  return false
}

/* Compute 24h low/high from the 168-point hourly spark array (last 24
   entries = the last 24 hours). Returns null if data is missing or low
   == high (no range to plot). */
function computeRange24h(sparkPrices) {
  if (!Array.isArray(sparkPrices) || sparkPrices.length < 2) return null
  const last24 = sparkPrices.slice(-24).filter((v) => Number.isFinite(v))
  if (last24.length < 2) return null
  const low = Math.min(...last24)
  const high = Math.max(...last24)
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null
  if (low >= high) return null
  return { low, high }
}

const CopyIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

/* Compact local timestamp - "May 20, 06:50". Returns null on a bad date. */
function formatEntryDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/* "Since Momentum entry" card shown in the token drawer.
 *
 * HONEST FRAMING - momentum_entry records the FIRST time the token appeared
 * in the opportunity / 24h / momentum Top 25 of our leaderboard. It is a
 * timestamp of when Spectre surfaced the token, NOT a prediction, a buy
 * call, or a guaranteed move. The copy must never imply we "called" or
 * "predicted" anything - it only states a measured fact: market cap then vs.
 * market cap now, measured from leaderboard entry. */
function MomentumEntryCard({ entry, origin, currentMcap, fmtLargeShort }) {
  const { t } = useTranslation()
  if (!entry && !origin) return null
  // Prefer Spectre's IMMUTABLE origin (never resets on board re-entry) over the
  // X Dash momentum_entry whenever we have a recorded origin market cap.
  const hasOrigin = !!(origin && Number(origin.entry_market_cap) > 0)
  const entryMcap = hasOrigin ? Number(origin.entry_market_cap) : Number(entry?.entry_market_cap || 0)
  // Live mcap wins; fall back to the origin tracker's last recorded mcap.
  const liveMcap = Number(currentMcap || 0) || Number(origin?.last_market_cap || 0)
  const hasPct = entryMcap > 0 && liveMcap > 0
  const pct = hasPct
    ? ((liveMcap - entryMcap) / entryMcap) * 100
    : (hasOrigin && Number.isFinite(Number(origin.roi_pct)) ? Number(origin.roi_pct) : null)
  const tone = pct == null ? 'flat' : pct >= 0 ? 'up' : 'down'
  const enteredAt = formatEntryDate(hasOrigin ? origin.first_entered_at : entry?.entered_at)
  const rank = Number((hasOrigin ? origin.entry_rank : 0) || entry?.entry_rank || 0)
  const m = entry?.metrics || {}
  const mentions = Number(m.external_mentions_24h || 0) || (hasOrigin ? Number(origin.entry_mentions || 0) : 0)
  const authors = Number(m.unique_external_authors_24h || 0)
  // Peak ROI (origin tracker only) — the best the call ever printed.
  const peakMcap = hasOrigin ? Number(origin.peak_market_cap || 0) : 0
  const peakPct = hasOrigin && Number.isFinite(Number(origin.peak_roi_pct)) ? Number(origin.peak_roi_pct) : null
  const showPeak = hasOrigin && peakMcap > entryMcap && peakPct != null && peakPct > (pct ?? -Infinity)
  return (
    <section className="xd-ment">
      <div className="xd-ment__head">
        <span className="xd-ment__eyebrow">{t('xDash.tokenDrawer.spectreMomentum', 'Spectre Momentum')}<InfoTip text={getMetricInfo('spectreMomentum')} position="top" /></span>
        {rank > 0 && <span className="xd-ment__rank">{t('xDash.tokenDrawer.entered', 'Entered #{{rank}}', { rank })}</span>}
      </div>
      <div className="xd-ment__title">
        {hasOrigin
          ? t('xDash.tokenDrawer.trackedSinceFirstSurfaced', 'Tracked since first surfaced')
          : t('xDash.tokenDrawer.trackedSinceTop25', 'Tracked since Momentum Top 25')}
        {enteredAt && <span className="xd-ment__date">{enteredAt}</span>}
      </div>
      {hasPct && (
        <div className={`xd-ment__perf xd-ment__perf--${tone}`}>
          <span className="xd-ment__pct xd-num">
            {pct >= 0 ? '+' : ''}{Math.round(pct)}%
          </span>
          <span className="xd-ment__pct-label">
            {hasOrigin
              ? t('xDash.tokenDrawer.sinceFirstSurfaced', 'since first surfaced')
              : t('xDash.tokenDrawer.sinceMomentumEntry', 'since Momentum entry')}
          </span>
        </div>
      )}
      {hasPct && (
        <div className="xd-ment__mcap">
          <span className="xd-ment__stat">
            <span className="xd-ment__stat-label">{t('xDash.tokenDrawer.entryMcap', 'Entry mcap')}<InfoTip text={getMetricInfo('entryMcap')} position="top" /></span>
            <span className="xd-ment__stat-value xd-num">{fmtLargeShort(entryMcap)}</span>
          </span>
          <span className="xd-ment__arrow" aria-hidden="true">&rarr;</span>
          <span className="xd-ment__stat">
            <span className="xd-ment__stat-label">{t('xDash.tokenDrawer.now', 'Now')}</span>
            <span className="xd-ment__stat-value xd-num">{fmtLargeShort(liveMcap)}</span>
          </span>
        </div>
      )}
      {showPeak && (
        <div className="xd-ment__peak">
          {t('xDash.tokenDrawer.peakRoi', 'Peak {{pct}} · {{mcap}}', {
            pct: `${peakPct >= 0 ? '+' : ''}${Math.round(peakPct)}%`,
            mcap: fmtLargeShort(peakMcap),
          })}
        </div>
      )}
      {(mentions > 0 || authors > 0) && (
        <div className="xd-ment__signal">
          {authors > 0
            ? t('xDash.tokenDrawer.entrySignal', 'Entry signal · {{mentions}} mentions · {{authors}} authors', { mentions: formatNum(mentions), authors: formatNum(authors) })
            : t('xDash.tokenDrawer.entrySignalMentions', 'Entry signal · {{mentions}} mentions', { mentions: formatNum(mentions) })}
        </div>
      )}
      <div className="xd-ment__note">
        {hasOrigin
          ? t('xDash.tokenDrawer.originNote', 'Measured from the market cap the first time Spectre surfaced this token socially - an immutable record of when we caught it, not a price prediction. It holds even when the token leaves and re-enters the board.')
          : t('xDash.tokenDrawer.momentumNote', 'Measured from this token\'s first appearance in Momentum Top 25 - a record of when Spectre surfaced it, not a price prediction.')}
      </div>
    </section>
  )
}

/* Enrichment strip - live price, 24h delta, 7-day sparkline, catalog
   identity (rank, category, tags, contract). Sits between the compact
   head and the scrolling body so it stays in view as the user scrolls
   metrics. Renders even when token detail is still loading - fields the
   seed cache carries (logo / category / chain / mcap) paint instantly;
   fields that only land with the fetch (price / sparkline) show shimmer
   placeholders until they arrive. */
/* ---------- Open-full actions ----------
   The drawer is the PREVIEW - this row routes to the full experience.
   Majors / top-2000 tokens have deep CG history, so they get BOTH doors
   (Research Zone + AI Screener). Fresh / ultra-low caps only have on-chain
   depth, so they route straight to the AI Screener. */
/* Chain name -> Codex/trading networkId. Fallback when the detail row omits
   network_id: without it the AI Screener/trading iframe defaults to Ethereum
   and fetches bars on the WRONG chain, so a Base token (usedot-ai) charts
   empty. Mirrors CHAIN_NETWORK_IDS in xd-token-table. */
const XD_DRAWER_CHAIN_NET = {
  ethereum: 1, eth: 1, base: 8453, solana: 1399811149, sol: 1399811149,
  bsc: 56, binance: 56, 'bnb chain': 56, bnb: 56, arbitrum: 42161, 'arbitrum one': 42161,
  polygon: 137, matic: 137, avalanche: 43114, avax: 43114, optimism: 10, blast: 81457,
}
function drawerChainNet(chain) {
  return XD_DRAWER_CHAIN_NET[String(chain || '').toLowerCase().trim()] || null
}

function DrawerOpenActions({ tokenInfo }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { setResearchZoneToken } = useAppState()

  const cgId = tokenInfo?.cg_id || tokenInfo?.token_id
  const symbol = tokenInfo?.symbol || ''
  const rank = Number(tokenInfo?.global_rank || 0)
  const mcap = Number(tokenInfo?.market_cap || 0)

  const chain = tokenInfo?.chain
  const address = tokenInfo?.contract_address
    || (tokenInfo?.platforms && (tokenInfo.platforms[chain] || Object.values(tokenInfo.platforms)[0]))
    || ''
  // Derive the network from chain when the row omits network_id, so the AI
  // Screener charts on the RIGHT chain (Base, not a defaulted Ethereum).
  const networkId = tokenInfo?.network_id ?? tokenInfo?.networkId ?? drawerChainNet(chain) ?? undefined

  /* Research Zone door.
     rank when we have it (precise top-2000); mcap floor as the fallback so a
     ranked-but-unreported token (rank arrives with the detail fetch) still
     gets its Research Zone door.
     CRITICAL: do NOT grant RZ purely from isMajorToken(symbol) for an ON-CHAIN
     token (one that carries a contract address). A genuine major (Polkadot,
     etc.) has no Base/Solana contract, so a ticker collision - e.g. a Base
     memecoin ticker "DOT" - was matching isMajorToken('DOT') and opening
     Polkadot's Research Zone. On-chain tokens route by their contract via the
     AI Screener instead, which loads the EXACT token. */
  const isOnChain = !!address
  const hasRz = (!isOnChain && isMajorToken(symbol)) || (rank > 0 && rank <= 2000) || mcap >= 10_000_000

  const openRz = useCallback(() => {
    if (!cgId) return
    // Seed the token identity into AppState BEFORE navigating so Research Zone
    // reads it as `initialToken` and short-circuits the 3-hop resolveToken
    // waterfall (Spectre resolve -> /api/token/resolve -> Codex, 200-900ms).
    // Previously this only pushed the bare slug, so RZ opened with no identity
    // and paid the full resolve on every drawer -> RZ hop. Mirrors the
    // canonical app-shell openResearchZone handler.
    const tokenData = {
      symbol,
      name: tokenInfo?.name || symbol,
      cgId: cgId || null,
      address: address || '',
      networkId,
      logo: tokenInfo?.image_small || tokenInfo?.image_url || tokenInfo?.image || null,
      marketCap: mcap || null,
    }
    setResearchZoneToken(tokenData)
    navigate(buildResearchZoneLocation(tokenData, false))
  }, [cgId, symbol, address, networkId, mcap, tokenInfo, navigate, setResearchZoneToken])

  const openScreener = useCallback(() => {
    if (address) {
      // On-chain token: open the standalone trading terminal (better charts,
      // Gleb's build) by contract, in a new tab — NOT the /token "Trading Lite"
      // iframe. The terminal loads the EXACT token by address (never a
      // same-symbol major) and infers the chain from the address format.
      if (openTradingTerminal(address)) return
    }
    // No contract -> avoid a null-address terminal; open Research Zone instead,
    // seeding identity so RZ skips the resolve waterfall (mirrors openRz).
    if (!cgId && !symbol) return
    const tokenData = {
      symbol,
      name: tokenInfo?.name || symbol,
      cgId: cgId || null,
      address: '',
      networkId,
      logo: tokenInfo?.image_small || tokenInfo?.image_url || tokenInfo?.image || null,
      marketCap: mcap || null,
    }
    setResearchZoneToken(tokenData)
    navigate(buildResearchZoneLocation(tokenData, false))
  }, [navigate, symbol, cgId, address, networkId, tokenInfo, mcap, setResearchZoneToken])

  if (!cgId && !symbol) return null
  return (
    <div className="xd-openin" role="group" aria-label={t('xDash.tokenDrawer.openIn.label', 'Open full view')}>
      {hasRz && (
        <button type="button" className="xd-openin__btn xd-openin__btn--rz" onClick={openRz}>
          <span className="xd-openbtn xd-openbtn--rz" aria-hidden="true">R</span>
          {t('xDash.tokenDrawer.openIn.rz', 'Research Zone')}
        </button>
      )}
      <button type="button" className="xd-openin__btn xd-openin__btn--sc" onClick={openScreener}>
        <span className="xd-openbtn xd-openbtn--sc" aria-hidden="true">S</span>
        {hasRz
          ? t('xDash.tokenDrawer.openIn.screener', 'AI Screener')
          : t('xDash.tokenDrawer.openIn.screenerFull', 'View full chart in AI Screener')}
      </button>
    </div>
  )
}

function TokenSummary({ tokenInfo, priceRow, fmtLargeShort, isLoadingDetail, fullscreen = false, onClose }) {
  const { t } = useTranslation()
  const { fmtPrice: fmtPriceCurrency } = useCurrency()
  const formatUsdPrice = (v) => {
    const n = Number(v || 0)
    if (!Number.isFinite(n) || n <= 0) return '-'
    return fmtPriceCurrency(n)
  }
  const [copied, setCopied] = useState(false)
  const cgId = tokenInfo?.cg_id || tokenInfo?.token_id
  const { prices: sparkPrices, loading: sparkLoading } = useTokenSparkline7d(cgId)

  const price = priceRow?.price
  const change = Number(priceRow?.change24h)
  const liveMcap = Number(priceRow?.marketCap)
  const mcap = liveMcap > 0 ? liveMcap : Number(tokenInfo.market_cap || 0)
  const isUp = Number.isFinite(change) && change > 0
  const isDown = Number.isFinite(change) && change < 0

  const tags = useMemo(() => {
    const all = Array.isArray(tokenInfo.tags) ? tokenInfo.tags : []
    const primary = tokenInfo.primary_category
    return all.filter((tag) => tag && tag !== primary)
  }, [tokenInfo])

  const primary = tokenInfo.primary_category
  const chain = tokenInfo.chain
  const address = tokenInfo.contract_address
    || (tokenInfo.platforms && (tokenInfo.platforms[chain] || Object.values(tokenInfo.platforms)[0]))

  const brandKey = (tokenInfo.symbol || '').toUpperCase()
  const brandRgb = TOKEN_ROW_COLORS[brandKey]?.bg

  const onCopy = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!address) return
    navigator.clipboard?.writeText(address).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    }).catch(() => {})
  }

  const hasPrice = Number.isFinite(price) && price > 0
  const hasMcap = Number.isFinite(mcap) && mcap > 0
  const priceUnknown = !hasPrice
  const mcapUnknown = !hasMcap

  /* The price shimmer must terminate. Some tokens never resolve a price
     (not listed on CoinGecko, bridge miss, rate limit) and the skeleton
     used to spin forever - reading as "broken". Give the fetch chain its
     full window (10s timeout in useXDashPrices + grace), then render an
     honest dash. The 30s poll still upgrades the dash if a price lands. */
  const [priceWaitedOut, setPriceWaitedOut] = useState(false)
  useEffect(() => {
    if (hasPrice) {
      setPriceWaitedOut(false)
      return undefined
    }
    const timer = window.setTimeout(() => setPriceWaitedOut(true), 12_000)
    return () => window.clearTimeout(timer)
  }, [hasPrice])
  const categoryUnknown = !primary && tags.length === 0 && isLoadingDetail
  const validAddress = isValidContractAddress(address)
  const contractUnknown = !validAddress && isLoadingDetail
  const validChain = chain && !/^unkn?own$/i.test(String(chain))
  const range24h = useMemo(() => computeRange24h(sparkPrices), [sparkPrices])

  /* ----- FULLSCREEN HERO ----------------------------------------------
     Dedicated 3-column hero layout for the fullscreen page. Side-drawer
     keeps the original compact priceline. Building this as a NEW DOM
     subtree (xd-hero) instead of restyling .xd-tokensummary so the
     change is unambiguous and not at the mercy of cascading overrides
     from day-mode/mobile sheets. */
  if (fullscreen) {
    const logoSrc = tokenInfo.image_small || tokenInfo.image_url || tokenInfo.image
    const cashtag = tokenInfo.cashtag || (tokenInfo.symbol ? `$${tokenInfo.symbol}` : '')
    const chgClass = isUp ? 'xd-hero__chg--up' : isDown ? 'xd-hero__chg--down' : 'xd-hero__chg--flat'
    const chgGlyph = isUp ? '▲' : isDown ? '▼' : '·'
    return (
      <section
        className="xd-hero xd-hero--terminal"
        style={brandRgb ? { ['--xd-token-brand-rgb']: brandRgb } : undefined}
      >
        {/* Token-colored ambient glow — two big blurred radial gradients
            that tint the hero with the asset's brand color. Mirrors the
            TokenBanner pattern in the trading app. Subtle at rest,
            intensifies on hover. */}
        <div className="xd-hero__glow" aria-hidden="true" />
        <div className="xd-hero__glow-secondary" aria-hidden="true" />
        <div className="xd-hero__bloom" aria-hidden="true" />

        <div className="xd-hero__row xd-hero__row--terminal">
          {/* back — arrow-only, sits inline as the first item of the row */}
          {onClose && (
            <button
              type="button"
              className="xd-hero__back"
              onClick={onClose}
              aria-label={t('xDash.drawer.backToLeaderboard', 'Back to leaderboard')}
              title={t('xDash.drawer.back', 'Back')}
            >
              <BackIcon />
            </button>
          )}

          {/* identity */}
          <div className="xd-hero__brand">
            {logoSrc ? (
              <span className="xd-hero__logo">
                <img src={logoSrc} alt={tokenInfo.symbol || ''} loading="lazy" />
                <span className="xd-hero__logo-ring" aria-hidden="true" />
              </span>
            ) : (
              <span className="xd-hero__logo xd-hero__logo--placeholder animate-shimmer" />
            )}
            <div className="xd-hero__brand-text">
              {cashtag ? (
                <span className="xd-hero__cashtag xd-num">{cashtag}</span>
              ) : (
                <span className="xd-shimmer-bar xd-shimmer-bar--lg animate-shimmer" style={{ width: 120 }} />
              )}
              {(tokenInfo.name || tokenInfo.cg_id) ? (
                <span className="xd-hero__name" title={tokenInfo.name || tokenInfo.cg_id}>
                  {tokenInfo.name || tokenInfo.cg_id}
                </span>
              ) : isLoadingDetail ? (
                <span className="xd-shimmer-bar xd-shimmer-bar--sm animate-shimmer" style={{ marginTop: 6, width: 80 }} />
              ) : null}
            </div>
          </div>

          <span className="xd-hero__sep" aria-hidden="true" />

          {/* price + 24h change */}
          <div className="xd-hero__priceblock">
            {hasPrice ? (
              <span className="xd-hero__price xd-num">{formatUsdPrice(price)}</span>
            ) : priceWaitedOut ? (
              <span className="xd-hero__price xd-hero__price--na xd-num" title={t('xDash.tokenDrawer.priceUnavailable', 'Live price unavailable')}>—</span>
            ) : (
              <span className="xd-hero__price-skel animate-shimmer" aria-label={t('xDash.tokenDrawer.loadingPrice', 'loading price')} />
            )}
            {hasPrice && Number.isFinite(change) && (
              <span className={`xd-hero__chg xd-num ${chgClass}`}>
                <span className="xd-hero__chg-glyph">{chgGlyph}</span>
                <span>{Math.abs(change).toFixed(2)}%</span>
                <span className="xd-hero__chg-period">24h</span>
              </span>
            )}
          </div>

          {/* 24h range bar — bear→bull gradient track with a dot at the
              live price's position between low and high. Reads as
              "where in the 24h band are we right now?" at a glance. */}
          {range24h && hasPrice && (
            <>
              <span className="xd-hero__sep" aria-hidden="true" />
              <div className="xd-hero__range" title={t('xDash.tokenDrawer.range24hTooltip', '24h range {{low}} – {{high}}', { low: formatUsdPrice(range24h.low), high: formatUsdPrice(range24h.high) })}>
                <span className="xd-hero__range-label">24h</span>
                <span className="xd-hero__range-low xd-num">{formatUsdPrice(range24h.low)}</span>
                <span className="xd-hero__range-track">
                  <span
                    className="xd-hero__range-dot"
                    style={{
                      left: `${Math.max(0, Math.min(100,
                        ((price - range24h.low) / (range24h.high - range24h.low)) * 100,
                      ))}%`,
                    }}
                  />
                </span>
                <span className="xd-hero__range-high xd-num">{formatUsdPrice(range24h.high)}</span>
              </div>
            </>
          )}

          {(primary || tags.length > 0 || categoryUnknown) && (
            <>
              <span className="xd-hero__sep" aria-hidden="true" />
              <div className="xd-hero__chips">
                {primary && (
                  <span className="xd-chip xd-chip--primary" title={t('xDash.tokenDrawer.primaryCategory', 'Primary category')}>{primary}</span>
                )}
                {tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="xd-chip" title={tag}>{tag}</span>
                ))}
                {tags.length > 3 && (
                  <span className="xd-chip xd-chip--muted">+{tags.length - 3}</span>
                )}
                {categoryUnknown && (
                  <>
                    <span className="xd-chip xd-chip--skel animate-shimmer" style={{ width: 90 }} />
                    <span className="xd-chip xd-chip--skel animate-shimmer" style={{ width: 70 }} />
                  </>
                )}
              </div>
            </>
          )}

          {(validAddress || contractUnknown) && (
            <>
              <span className="xd-hero__sep" aria-hidden="true" />
              {validAddress ? (
                <button
                  type="button"
                  className={`xd-hero__contract${copied ? ' xd-hero__contract--copied' : ''}`}
                  onClick={onCopy}
                  title={address}
                >
                  {validChain && <span className="xd-hero__chain">{humanizeLabel(chain)}</span>}
                  <span className="xd-hero__addr xd-num">{truncMid(address, 6, 4)}</span>
                  <span className="xd-hero__copy">
                    <CopyIcon />
                  </span>
                </button>
              ) : (
                <div className="xd-hero__contract-skel animate-shimmer" />
              )}
            </>
          )}

          {/* spacer pushes chart + stats to the right edge */}
          <span className="xd-hero__spacer" aria-hidden="true" />

          {/* compact stats inline */}
          <div className="xd-hero__stat">
            <span className="xd-hero__stat-label">{t('xDash.tokenDrawer.mcap', 'MCap')}</span>
            {hasMcap ? (
              <span className="xd-hero__stat-value xd-num">{fmtLargeShort(mcap)}</span>
            ) : mcapUnknown && isLoadingDetail ? (
              <span className="xd-hero__stat-skel animate-shimmer" />
            ) : (
              <span className="xd-hero__stat-value xd-num">—</span>
            )}
          </div>
          <div className="xd-hero__stat">
            <span className="xd-hero__stat-label">{t('xDash.tokenDrawer.rank', 'Rank')}</span>
            {tokenInfo.global_rank ? (
              <span className="xd-hero__stat-value xd-num">#{tokenInfo.global_rank}</span>
            ) : isLoadingDetail ? (
              <span className="xd-hero__stat-skel animate-shimmer" />
            ) : (
              <span className="xd-hero__stat-value xd-num">—</span>
            )}
          </div>

        </div>
      </section>
    )
  }

  return (
    <section
      className="xd-tokensummary"
      style={brandRgb ? { ['--xd-token-brand-rgb']: brandRgb } : undefined}
    >
      <div className="xd-tokensummary__priceline">
        <div className="xd-tokensummary__price">
          {hasPrice ? (
            <span className="xd-tokensummary__price-value xd-num">{formatUsdPrice(price)}</span>
          ) : priceWaitedOut ? (
            <span className="xd-tokensummary__price-value xd-tokensummary__price-value--na xd-num" title={t('xDash.tokenDrawer.priceUnavailable', 'Live price unavailable')}>—</span>
          ) : (
            <span className="xd-tokensummary__price-skel animate-shimmer" aria-label={t('xDash.tokenDrawer.loadingPrice', 'loading price')} />
          )}
          {hasPrice && Number.isFinite(change) && (
            <span className={`xd-tokensummary__change xd-num ${isUp ? 'xd-tokensummary__change--up' : ''}${isDown ? 'xd-tokensummary__change--down' : ''}`}>
              {isUp ? '▲' : isDown ? '▼' : '·'} {Math.abs(change).toFixed(2)}%
            </span>
          )}
          {priceUnknown && !priceWaitedOut && (
            <span className="xd-tokensummary__change-skel animate-shimmer" aria-label={t('xDash.tokenDrawer.loadingChange', 'loading change')} />
          )}
        </div>
        <Sparkline7d
          prices={sparkPrices}
          loading={sparkLoading}
          width={100}
          height={36}
        />
        <div className="xd-tokensummary__meta">
          <span className="xd-tokensummary__metacell">
            <span className="xd-tokensummary__metalabel">{t('xDash.tokenDrawer.marketCap', 'Market cap')}</span>
            {hasMcap ? (
              <span className="xd-tokensummary__metavalue xd-num">{fmtLargeShort(mcap)}</span>
            ) : mcapUnknown && isLoadingDetail ? (
              <span className="xd-tokensummary__meta-skel animate-shimmer" />
            ) : (
              <span className="xd-tokensummary__metavalue xd-num">-</span>
            )}
          </span>
          <span className="xd-tokensummary__metacell">
            <span className="xd-tokensummary__metalabel">{t('xDash.tokenDrawer.rank', 'Rank')}</span>
            {tokenInfo.global_rank ? (
              <span className="xd-tokensummary__metavalue xd-num">#{tokenInfo.global_rank}</span>
            ) : isLoadingDetail ? (
              <span className="xd-tokensummary__meta-skel animate-shimmer" />
            ) : (
              <span className="xd-tokensummary__metavalue xd-num">-</span>
            )}
          </span>
        </div>
      </div>

      {(primary || tags.length > 0 || categoryUnknown) && (
        <div className="xd-tokensummary__chips">
          {primary && (
            <span className="xd-chip xd-chip--primary" title={t('xDash.tokenDrawer.primaryCategory', 'Primary category')}>{primary}</span>
          )}
          {tags.slice(0, 4).map((tag) => (
            <span key={tag} className="xd-chip" title={tag}>{tag}</span>
          ))}
          {tags.length > 4 && (
            <span className="xd-chip xd-chip--muted">+{tags.length - 4}</span>
          )}
          {categoryUnknown && (
            <>
              <span className="xd-chip xd-chip--skel animate-shimmer" style={{ width: 110 }} />
              <span className="xd-chip xd-chip--skel animate-shimmer" style={{ width: 84 }} />
              <span className="xd-chip xd-chip--skel animate-shimmer" style={{ width: 96 }} />
            </>
          )}
        </div>
      )}

      {(address || contractUnknown) && (
        address ? (
          <button
            type="button"
            className={`xd-tokensummary__contract${copied ? ' xd-tokensummary__contract--copied' : ''}`}
            onClick={onCopy}
            title={address}
          >
            {chain && <span className="xd-tokensummary__chain">{humanizeLabel(chain)}</span>}
            <span className="xd-tokensummary__addr xd-num">{truncMid(address, 8, 6)}</span>
            <span className="xd-tokensummary__copy">
              <CopyIcon />
              {copied ? t('xDash.tokenDrawer.copied', 'copied') : t('xDash.tokenDrawer.copy', 'copy')}
            </span>
          </button>
        ) : (
          <div className="xd-tokensummary__contract-skel animate-shimmer" />
        )
      )}
    </section>
  )
}

/* Quality metric tone — encoded by whether the value direction is healthy.
   For most quality metrics (spam, promo, handle-only, cashtag-only) low is
   healthy; for `inverse` metrics (unique-author share) high is healthy. */
function qualityTone(pct, inverse = false) {
  const v = inverse ? pct : 1 - pct
  if (v >= 0.66) return 'bull'
  if (v >= 0.4) return 'amber'
  return 'bear'
}

function QualityRow({ label, value, inverse = false }) {
  // no localized strings here — label is passed by the consumer (already
  // translated). Kept the wrapper for future shared formatting.
  const pct = Math.max(0, Math.min(1, Number(value || 0)))
  const tone = qualityTone(pct, inverse)
  return (
    <div className={`xd-quality-panel__row xd-quality-panel__row--${tone}`}>
      <span className="xd-quality-panel__label">{label}</span>
      <span className="xd-quality-panel__bar">
        <span className="xd-quality-panel__track" aria-hidden="true">
          <span className="xd-quality-panel__tick xd-quality-panel__tick--mid" />
          <span
            className={`xd-quality-panel__fill xd-quality-panel__fill--${tone}`}
            style={{ width: `${pct * 100}%` }}
          />
        </span>
      </span>
      <span className={`xd-quality-panel__value xd-quality-panel__value--${tone} xd-num`}>
        {formatPercent(pct)}
      </span>
    </div>
  )
}

export default function XDTokenDrawer({ cgId, focus, onClose, onOpenAuthor, fullscreen = false, onToggleFullscreen, timeframe = '24h' }) {
  const { t } = useTranslation()
  const { fmtLargeShort } = useCurrency()
  /* Day mode + nav-sidebar state live on the .app root, but the drawer is
     portaled into document.body so the descendant selectors miss. Read
     the same Zustand flags the AppShell reads and mirror those classes
     onto the portal wrapper so every `.app.app-day-mode` /
     `.app.nav-sidebar-open(.nav-sidebar-collapsed)` rule still fires. */
  const dayMode = useSettingsStore((s) => s.dayMode)
  const navSidebarCollapsed = useSettingsStore((s) => s.navSidebarCollapsed)
  const { className: proThemeClass } = useProThemeSkin()
  // Token data window (mentions + carriers/KOLs). Seeded from the page
  // timeframe, but the user can WIDEN it inside the token view from 24h to 7d:
  // 24h hides KOLs who carried the token earlier, and X-Dash rebuilds the
  // carrier rollup against the chosen window (verified: 7d on $MANIFEST adds
  // @oxgordonsol 32 / @waqszzz 20 mentions that the 24h roster omits). The
  // backend only supports 24h/7d here — see CARRIER_TIMEFRAMES.
  const [tokenTf, setTokenTf] = useState(timeframe === '7d' ? '7d' : '24h')
  // Reset when a DIFFERENT token opens; within one token view the user's local
  // pick owns the window. Clamp to the supported windows (page may be 30d/all,
  // which the carrier rollup doesn't honour).
  useEffect(() => { setTokenTf(timeframe === '7d' ? '7d' : '24h') }, [cgId]) // eslint-disable-line react-hooks/exhaustive-deps
  const opts = useMemo(() => ({ includeIntel: true, timeframe: tokenTf }), [tokenTf])
  const { data, loading, error, refetch } = useXDashToken(cgId, opts)
  const carriersRef = useRef(null)

  // Stats-tile timeframe toggle (24h ↔ All-time). Local state so each
  // drawer remembers its own pick during the session. Chart-history block
  // has its own independent 24h/7d/30d/All selector — they're decoupled.
  const [statsTf, setStatsTf] = useState('24h')
  const statsTfLabel = (STATS_TIMEFRAMES.find((t) => t.id === statsTf) || STATS_TIMEFRAMES[0]).suffix

  /* live USD price + 24h Δ + mcap from CoinGecko/Spectre. The X Dash API
     doesn't carry price data - cell prices are joined client-side via the
     useXDashPrices hook (Spectre first, CoinGecko fallback, 30s cache). */
  const priceIds = useMemo(() => (cgId ? [cgId] : []), [cgId])
  const prices = useXDashPrices(priceIds)
  const rawPriceRow = prices?.[cgId]

  /* Spectre's IMMUTABLE momentum origin — the market cap the FIRST time we
     surfaced this token socially. The X Dash momentum_entry the drawer reads
     RESETS its entry market cap when a token leaves + re-enters the board, so
     an early $7.6M catch was reading "+51% from a $25M re-entry". This record
     never resets, so the real origin + ROI survive. Falls back to
     momentum_entry when no origin is tracked yet. */
  const [origin, setOrigin] = useState(null)
  useEffect(() => {
    if (!cgId) { setOrigin(null); return undefined }
    let cancelled = false
    setOrigin(null)
    fetch(`/api/xdash/momentum-origin/${encodeURIComponent(cgId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setOrigin(j && j.data ? j.data : null) })
      .catch(() => { if (!cancelled) setOrigin(null) })
    return () => { cancelled = true }
  }, [cgId])

  /* 7-day hourly price array (168 points) — overlaid on the Momentum
     History chart as the third series so the user can correlate price
     moves with attention spikes. Cached per-cgId so it shares the same
     in-flight promise with the TokenSummary's sparkline. */
  const { prices: sparkPrices } = useTokenSparkline7d(cgId)

  /* "Mini fullscreen" for the creators heatmap — a large centered overlay so
     the user can read every carrier. Managed here so Escape closes the overlay
     first, then the drawer. */
  const [heatmapExpanded, setHeatmapExpanded] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (heatmapExpanded) { setHeatmapExpanded(false); return }
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, heatmapExpanded])

  const detail = useMemo(() => normalizeXDashDetail(data), [data])
  const {
    tokenInfo: realTokenInfo, metrics: detailMetrics, quality: detailQuality, topAuthors, mergedMentions,
    latestIntelligence, intelligence, authors, momentumEntry,
  } = detail

  /* WARM-ON-DEMAND. The /api/xdash/token/:id detail often lands "thin" for a
     token that's clearly live on the board (no quality envelope, no tweets, no
     match structure) - it just hasn't been indexed for this window yet, so the
     drawer painted a wall of 0%s and "no data". When we detect a thin detail,
     nudge the collector once with force=1 to index it, then show a "warming"
     state instead of fake zeros. One attempt per token (keyed by cgId). */
  const qualityEmpty = !detailQuality || [
    detailQuality.spam_score, detailQuality.promo_share_24h, detailQuality.handle_only_share_24h,
    detailQuality.cashtag_only_share_24h, detailQuality.unique_author_share_24h,
  ].every((v) => v == null)
  const detailThin = !!data && !loading && qualityEmpty && (!mergedMentions || mergedMentions.length === 0)
  const warmedRef = useRef(null)
  useEffect(() => {
    if (!cgId || !detailThin || warmedRef.current === cgId) return
    warmedRef.current = cgId
    refetch({ force: true })
  }, [cgId, detailThin, refetch])
  // "warming" = thin AND we've already fired the force attempt (or it's in flight)
  const warming = detailThin && warmedRef.current === cgId
  /* Token-scoped override: force the correct first-surfaced entry for tokens the
     X-Dash upstream mis-reports (e.g. ANSEM shows its ~$90M re-entry instead of its
     ~$5.85M first appearance). No-op for every other token. Remove once upstream is
     fixed - see momentum-overrides.js. */
  const momentumEntryFixed = overrideMomentumEntry(cgId, momentumEntry)
  /* The card prefers the separate momentum-origin tracker over `entry`, and that
     tracker is wrong for overridden tokens (it reset on a board re-entry, showing the
     ~$90M re-entry as "first surfaced"). Drop it for those so the card uses the
     corrected entry above. */
  const originFixed = suppressOriginIfOverridden(cgId, origin)

  /* seed token identity from the leaderboard row that triggered the open -
     gives the drawer instant logo/name/cashtag/category/mcap before the
     fetch lands. The real fetch fills in the rest (intel, mentions,
     authors); fields the real payload doesn't carry stay backed by the
     seed. */
  const seedTokenInfo = useMemo(() => getTokenSeed(cgId), [cgId])
  const baseTokenInfo = useMemo(() => {
    const real = realTokenInfo || {}
    if (real.cg_id || real.symbol) {
      // real fetch landed - merge: real wins on every key it provides
      return { ...(seedTokenInfo || {}), ...real }
    }
    return seedTokenInfo || real
  }, [realTokenInfo, seedTokenInfo])

  /* LIVE on-chain market cap by CONTRACT.
     X Dash's catalog mcap is frozen for a big slice of tokens (entry_mc ==
     last_mc), and useXDashPrices is keyed by symbol/cg_id - which returns
     nothing (or a same-ticker CLONE) for on-chain tokens like usedot-ai ($DOT
     on Base) - so the drawer showed the frozen $2M instead of the real ~$3.5M.
     The contract is project-unique, so Codex 'details' by contract+network is
     the reliable live truth. On-chain tokens only (majors have no contract).
     Falls back silently to the catalog value if the fetch is empty. */
  const [ocLive, setOcLive] = useState(null)
  const ocAddress = baseTokenInfo?.contract_address
  const ocNetworkId = baseTokenInfo?.network_id ?? drawerChainNet(baseTokenInfo?.chain)
  useEffect(() => {
    let cancelled = false
    if (!ocAddress || !ocNetworkId) { setOcLive(null); return undefined }
    getTokenWithPrice(ocAddress, ocNetworkId)
      .then((r) => {
        if (cancelled || !r) return
        const mc = Number(r.marketCap) || 0
        setOcLive(mc > 0
          ? { marketCap: mc, price: Number(r.price) || null, change24h: Number(r.change ?? r.change24) }
          : null)
      })
      .catch(() => { if (!cancelled) setOcLive(null) })
    return () => { cancelled = true }
  }, [ocAddress, ocNetworkId])

  // Prefer the live on-chain mcap on the catalog identity...
  const tokenInfo = useMemo(() => (
    ocLive?.marketCap > 0 && ocLive.marketCap !== baseTokenInfo?.market_cap
      ? { ...baseTokenInfo, market_cap: ocLive.marketCap }
      : baseTokenInfo
  ), [baseTokenInfo, ocLive])

  // ...and on the live price row that TokenSummary / momentum / brain read first.
  const priceRow = useMemo(() => {
    if (!(ocLive?.marketCap > 0)) return rawPriceRow
    return {
      ...(rawPriceRow || {}),
      marketCap: ocLive.marketCap,
      price: (rawPriceRow?.price != null ? rawPriceRow.price : ocLive.price),
      change24h: (rawPriceRow?.change24h != null && Number.isFinite(Number(rawPriceRow.change24h))
        ? rawPriceRow.change24h : ocLive.change24h),
    }
  }, [rawPriceRow, ocLive])

  /* Signal metrics + quality, with the SEED row as a fallback floor. The
     per-token detail (/api/xdash/token/:id) sometimes returns an EMPTY metrics
     envelope for a token that's clearly live on the board (seen on $ZIG /
     zignaly: ranked #3 but the drawer showed 0 / QUIET and every tile dashed).
     The board row that opened the drawer already carries the real mentions /
     velocity / authors / clean-signal, so merge them UNDER the fetch: each real
     field that's actually present wins, and anything the fetch omits falls back
     to the seed - so a ranked token never paints dead. */
  const metrics = useMemo(
    () => mergeSeedMetrics(seedTokenInfo?._metrics, detailMetrics),
    [seedTokenInfo, detailMetrics],
  )
  const quality = useMemo(
    () => mergeSeedMetrics(seedTokenInfo?._quality, detailQuality),
    [seedTokenInfo, detailQuality],
  )

  /* THE verdict - one synthesized Signal Score fused from metrics + quality.
     Everything below it in the drawer is the supporting evidence. */
  const signal = useMemo(
    () => computeSignalScore({ metrics, quality }),
    [metrics, quality],
  )

  /* Render the body from the SEED, not strictly from the detail fetch. The
     drawer is opened from many surfaces (board row, constellation node, search
     pick, fullscreen deep-link) and they pass different cg_ids - some don't
     resolve /api/xdash/token/:id, so `data` comes back null and the OLD
     `{data && ...}` gate hid the ENTIRE body (no Signal Score, no Ask Spectre,
     no momentum) for that open while another open of the same token showed
     everything. tokenInfo/metrics/quality/signal are already seed-backed, and
     the momentum origin is fetched independently of `data`, so as soon as we
     have a token identity we can paint a consistent body and let the detail
     fetch enrich it - so preview and fullscreen always correlate. */
  const hasBody = !!(data || tokenInfo.symbol || tokenInfo.cg_id)

  // ── Spectre brain wiring ────────────────────────────────────────────────
  // Same catalyst-aware causal agent as the Research Zone, fed SOCIAL catalysts
  // here: the live price tape + the loudest real mentions, so "why is $X
  // trending?" leads with the actual driver (which KOL, what they said) instead
  // of generic momentum talk. Collapsed by default; the heavy chat lazy-loads.
  const [brainOpen, setBrainOpen] = useState(false)
  const brainTokenData = useMemo(() => ({
    price: Number(priceRow?.price) || null,
    change24h: Number(priceRow?.change24h),
    marketCap: Number(priceRow?.marketCap) || Number(tokenInfo.market_cap) || null,
  }), [priceRow, tokenInfo.market_cap])
  // On X Dash the mentions ARE the crowd — feed them to the brain as the social
  // layer (loudest real voices) so it reasons about WHO is driving the trend and
  // whether it's authentic conviction or hype, not just price.
  const brainSocial = useMemo(() => {
    const voices = []
    const seen = new Set()
    for (const m of (mergedMentions || [])) {
      const text = (getMentionText(m) || '').trim()
      if (!text) continue
      const key = text.slice(0, 80).toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const a = m?.author || {}
      voices.push({
        handle: a.screen_name || a.name || '',
        name: a.name || a.screen_name || '',
        followers: a.followers_count || a.followers || a.counts?.followers_count || 0,
        verified: a.is_blue_verified === true || a.verified === true,
        text: text.length > 220 ? `${text.slice(0, 220)}…` : text,
      })
      if (voices.length >= 6) break
    }
    return voices.length ? { voices } : null
  }, [mergedMentions])

  /* Chatter tone (sample-based). MOMENTUM surfaces a token on mention VOLUME,
     blind to whether the crowd is bullish or FUD-ing it. A price dump alone is
     not FUD ($VENA was -37% with fully bullish/promotional chatter). This reads
     the actual tone of the mention sample so "are people speaking negatively?"
     has an answer — clearly labelled sample-based, not a verdict. */
  const chatterTone = useMemo(() => {
    const texts = (mergedMentions || []).map((m) => getMentionText(m)).filter(Boolean)
    if (texts.length < 4) return null // too small a sample to read honestly
    return classifyChatter(texts)
  }, [mergedMentions])

  /* full creator board: merge top_authors (~8) + authors (~13) + mention
     authors, dedup by id, rank by weighted engagement / mention count.
     Authoritative per-token metrics from top_authors/authors win over
     anything derived from the kept-mention sample. */
  const carriers = useMemo(
    () => buildCarrierBoard(topAuthors, authors, mergedMentions),
    [topAuthors, authors, mergedMentions],
  )

  /* true carrier count for the section header - the metric, not list length */
  const carrierCount = Number(metrics.unique_external_authors_24h || 0) || carriers.length
  /* token-wide weighted engagement -> denominator for carrier-strength bars */
  const carrierTotalEngagement = useMemo(
    () => carriers.reduce((sum, c) => sum + Number(c.total_weighted_engagement || 0), 0),
    [carriers],
  )

  /* per-author mention.match.strength summary - shown next to each carrier
     row so users can scan the Carriers list and see who was a PRIMARY
     carrier vs who only brushed the token contextually. Keyed by
     screen_name (lowercased) with fallback to rest_id. */
  const carrierStrengthByAuthor = useMemo(
    () => buildStrengthLookup(mergedMentions, (m) => {
      const a = m?.author || {}
      return String(a.screen_name || a.rest_id || '').toLowerCase()
    }),
    [mergedMentions],
  )
  /* author ids of the 3 board-level top_authors, to mark them in the list */
  const boardAuthorIds = useMemo(() => {
    const set = new Set()
    for (const a of (topAuthors || [])) {
      const id = getAuthorId(a) || a.author_rest_id
      if (id) set.add(String(id))
    }
    return set
  }, [topAuthors])

  /* when opened via the leaderboard carrier cluster, scroll the board into
     view once data has landed. one-shot per (cgId, focus).
     the drawer slides in over ~250ms (translateX) - assigning scrollTop
     mid-animation gets dropped, so we wait for the slide to settle, then
     assign directly (no CSS smooth - it silently no-ops on this nested
     flex overflow container). */
  useEffect(() => {
    if (focus !== 'carriers' || !data || carriers.length === 0) return
    const node = carriersRef.current
    if (!node) return
    const scrollToBoard = () => {
      const body = node.closest('.xd-drawer__body')
      if (!body) {
        node.scrollIntoView({ block: 'start' })
        return
      }
      const delta = node.getBoundingClientRect().top - body.getBoundingClientRect().top
      body.scrollTop = Math.max(0, body.scrollTop + delta - 12)
    }
    /* fire once after the slide-in settles, then again a frame later in
       case layout shifted (charts measuring, fonts) - cheap, idempotent. */
    const t1 = window.setTimeout(scrollToBoard, 300)
    const t2 = window.setTimeout(scrollToBoard, 460)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [focus, data, carriers.length, cgId])
  /* intel snapshot history: oldest->newest array of TokenIntelRow snapshots.
     Short (5 pts) or empty handled inside XDMomentumArea. */
  const intelHistory = useMemo(() => {
    const h = intelligence?.history
    return Array.isArray(h) ? h : []
  }, [intelligence])
  const hasIntelHistory = intelHistory.length > 0
  const hasRadar = latestIntelligence && (
    latestIntelligence.attention_quality || latestIntelligence.breadth
    || latestIntelligence.durability || latestIntelligence.momentum
  )

  const cashtag = tokenInfo.cashtag || (tokenInfo.symbol ? `$${tokenInfo.symbol}` : cgId)
  const xUrl = tokenInfo.twitter_url || (tokenInfo.handle ? `https://x.com/${tokenInfo.handle}` : null)

  const durability = latestIntelligence.durability || {}
  const crowding = latestIntelligence.crowding || {}
  const crowdingAlerts = Array.isArray(crowding.alerts) ? crowding.alerts : []

  /* The drawer is rendered into document.body via a portal so it escapes
     `.page-layout`'s `transform: translateZ(0)` containing block — without
     this, `position: fixed` is bound to the scrolling page wrapper and the
     drawer stops at the bottom of the page content instead of the viewport.
     Same reason the mobile @media in page-layout.css already strips the
     transform. The portal is the desktop equivalent of that fix. */
  if (typeof document === 'undefined') return null
  const portalClass = [
    // Box-less class carrier — see `.xd-portal-root` in x-dash-page.css.
    'xd-portal-root',
    'app',
    'nav-sidebar-open',
    navSidebarCollapsed ? 'nav-sidebar-collapsed' : '',
    dayMode ? 'app-day-mode' : '',
    // …and the PRO skin, for the same reason: every rule in
    // pro-theme-studio.css is scoped `.app.pro-paper` / `.app.pro-glass`, so
    // without this the drawer renders unskinned inside a themed app.
    proThemeClass.trim(),
  ].filter(Boolean).join(' ')
  return createPortal(
    <div className={portalClass}>
      {!fullscreen && <div className="xd-drawer-scrim" onClick={onClose} />}
      <aside
        className={`xd-drawer${fullscreen ? ' xd-drawer--fullscreen' : ''}`}
        role="dialog"
        aria-label={t('xDash.tokenDrawer.detailAria', '{{cashtag}} detail', { cashtag })}
      >
        {fullscreen ? null : (
          <div className="xd-drawer__head">
            {!tokenInfo.cg_id && !tokenInfo.symbol ? (
              <>
                <div className="xd-shimmer-avatar xd-shimmer-avatar--sm animate-shimmer" />
                <div className="xd-drawer__head-text">
                  <div className="xd-shimmer-bar xd-shimmer-bar--lg animate-shimmer" style={{ maxWidth: 120 }} />
                  <div className="xd-shimmer-bar xd-shimmer-bar--sm animate-shimmer" style={{ marginTop: 6 }} />
                </div>
              </>
            ) : (
              <>
                <Avatar src={tokenInfo.image_small || tokenInfo.image_url} alt={tokenInfo.symbol} size={40} />
                <div className="xd-drawer__head-text">
                  <div className="xd-drawer__title">
                    <span className="xd-num">{cashtag}</span>
                    {xUrl && (
                      <a className="xd-xlink" href={xUrl} target="_blank" rel="noopener noreferrer" aria-label={t('xDash.tokenDrawer.openOnX', 'Open on X')}>
                        <XIcon />
                      </a>
                    )}
                  </div>
                  <div className="xd-drawer__subtitle">
                    <span>{tokenInfo.name || cgId}</span>
                    {tokenInfo.segment && <span>&middot; {humanizeLabel(tokenInfo.segment)}</span>}
                    {tokenInfo.chain && <span>&middot; {humanizeLabel(tokenInfo.chain)}</span>}
                    {tokenInfo.market_cap != null && (
                      <span>&middot; {t('xDash.tokenDrawer.mcapInline', '{{value}} mcap', { value: fmtLargeShort(tokenInfo.market_cap) })}</span>
                    )}
                  </div>
                </div>
              </>
            )}
            <div className="xd-drawer__head-actions">
              {onToggleFullscreen && (
                <button
                  type="button"
                  className="xd-drawer__close"
                  onClick={onToggleFullscreen}
                  aria-label={t('xDash.drawer.expandFullscreen', 'Expand to fullscreen')}
                  title={t('xDash.drawer.expandFullscreen', 'Expand to fullscreen')}
                >
                  <ExpandIcon />
                </button>
              )}
              <button type="button" className="xd-drawer__close" onClick={onClose} aria-label={t('xDash.drawer.close', 'Close')}>
                <CloseIcon />
              </button>
            </div>
          </div>
        )}

        {/* Enrichment strip - rendered ALWAYS (not gated on real data) so
            seed-provided fields paint instantly while the rest shimmer
            in place until the fetch lands. Live price + 24h delta + 7d
            sparkline come from useXDashPrices + useTokenSparkline7d
            running in parallel. */}
        {(tokenInfo.cg_id || tokenInfo.symbol) && (
          <TokenSummary
            tokenInfo={tokenInfo}
            priceRow={priceRow}
            fmtLargeShort={fmtLargeShort}
            isLoadingDetail={loading && !data}
            fullscreen={fullscreen}
            onClose={fullscreen ? onClose : undefined}
          />
        )}

        {(tokenInfo.cg_id || tokenInfo.symbol) && <DrawerOpenActions tokenInfo={tokenInfo} />}

        <div className={`xd-drawer__body${fullscreen ? ' xd-drawer__body--grid' : ''}`}>
          {loading && !hasBody && <Shimmer variant="drawer" count={6} />}
          {error && !hasBody && <ErrorState message={error} onRetry={refetch} />}

          {hasBody && (
            <div className="xd-drawer__main">
              {/* SIGNAL SCORE - the verdict, leads the drawer. The metric
                  grid / charts / carriers below are the breakdown behind it. */}
              <div className="xd-verdict">
                <SignalScore signal={signal} variant="full" />
                <div className="xd-verdict__body">
                  <div className="xd-verdict__headline">
                    {t('xDash.tokenDrawer.signalScore', 'Signal Score')}
                    <span className={`xd-verdict__tier xd-verdict__tier--${signal.tier}`}>
                      {SIGNAL_TIER_LABEL[signal.tier] || signal.tier}
                    </span>
                  </div>
                  <div className="xd-verdict__caption">
                    {t('xDash.tokenDrawer.signalCaption', 'Fused from clean signal, author breadth, velocity, novelty and engagement')}
                  </div>
                  <SignalPartsBars parts={signal.parts} labels={SIGNAL_PART_LABELS} infoMap={{ velocity: 'velocity', novelty: 'novelty', cleanSignal: 'cleanSignal', breadth: 'authorBreadth', engagement: 'engagement' }} />
                </div>
              </div>

              {/* WHY — the Spectre brain explains the verdict above with the
                  real catalysts (loudest mentions + the price tape). */}
              <div className="xd-brain">
                <button
                  type="button"
                  className={`xd-brain__toggle${brainOpen ? ' xd-brain__toggle--open' : ''}`}
                  onClick={() => setBrainOpen((o) => !o)}
                  aria-expanded={brainOpen}
                >
                  <span className="xd-brain__spark" aria-hidden>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6 6l1.5 1.5M18 18l-1.5-1.5M6 18l1.5-1.5M18 6l-1.5 1.5"/><circle cx="12" cy="12" r="3.2"/></svg>
                  </span>
                  <span className="xd-brain__toggle-label">
                    {t('xDash.tokenDrawer.askBrain', 'Ask Spectre')} — why is {tokenInfo.symbol ? `$${tokenInfo.symbol}` : 'this'} moving?
                  </span>
                  <span className="xd-brain__chev" aria-hidden>{brainOpen ? '▾' : '▸'}</span>
                </button>
                {brainOpen && (
                  <div className="xd-brain__chat">
                    <Suspense fallback={<div className="xd-brain__loading">Waking the brain…</div>}>
                      <RzAgentChat
                        sym={(tokenInfo.symbol || tokenInfo.cg_id || '').toUpperCase()}
                        tokenName={tokenInfo.name || tokenInfo.symbol}
                        tokenLogo={tokenInfo.image_small || tokenInfo.image_url || tokenInfo.image || null}
                        tokenData={brainTokenData}
                        social={brainSocial}
                        dayMode={dayMode}
                      />
                    </Suspense>
                  </div>
                )}
              </div>

              {/* LIVE ON X - for an on-chain token X Dash doesn't track (e.g. a
                  Base micro-cap), every tracked tile below is 0. Surface the REAL
                  conversation HERE, high up, so the drawer leads with actual social
                  instead of a wall of zeros. Resolves the project's X handle from
                  the contract (DexScreener) and lists live tweets. Only when there
                  are no tracked mentions AND we have a valid contract address. */}
              {!loading && !error &&
                (!mergedMentions || mergedMentions.length === 0) &&
                isValidContractAddress(tokenInfo.contract_address) && (
                <XDLiveSocial
                  token={{
                    symbol: tokenInfo.symbol,
                    name: tokenInfo.name,
                    address: tokenInfo.contract_address,
                  }}
                  enabled
                />
              )}

              {/* metric grid — header has a 24h ↔ All-time pill so consumers
                  can flip the four time-windowed tiles (mentions, ext authors,
                  engagement, clean signal) between rolling-24h and lifetime
                  totals. The X-Dash upstream returns both windows natively;
                  7d/30d don't exist on the metrics shape (only on the snapshot
                  history below) so we don't fake them on these tiles. */}
              <div>
                <div className="xd-momentum-head" style={{ marginBottom: 8 }}>
                  <span className="xd-drawer-section__label" style={{ margin: 0 }}>
                    {t('xDash.tokenDrawer.signalBreakdown', 'Signal breakdown')}
                  </span>
                  <div className="xd-momentum-tfs" role="tablist" aria-label={t('xDash.tokenDrawer.statsTimeframeAria', 'Stats timeframe')}>
                    {STATS_TIMEFRAMES.map((tf2) => (
                      <button
                        key={tf2.id}
                        type="button"
                        role="tab"
                        aria-selected={statsTf === tf2.id}
                        className={`xd-momentum-tf${statsTf === tf2.id ? ' is-active' : ''}`}
                        onClick={() => setStatsTf(tf2.id)}
                      >
                        {tf2.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="xd-drawer-grid">
                  <StatTile
                    label={t('xDash.tokenDrawer.tile.mentionsWin', 'Mentions {{win}}', { win: statsTfLabel })}
                    value={formatNum(statsTf === '24h' ? metrics.external_mentions_24h : metrics.external_mentions)}
                    info="mentions24h"
                  />
                  <StatTile label={t('xDash.tokenDrawer.tile.mentionsTotal', 'Mentions total')} value={formatNum(metrics.external_mentions)} info="mentionsTotal" />
                  <StatTile
                    label={t('xDash.tokenDrawer.tile.extAuthorsWin', 'Ext authors {{win}}', { win: statsTfLabel })}
                    value={formatNum(statsTf === '24h' ? metrics.unique_external_authors_24h : metrics.unique_external_authors)}
                    info="extAuthors"
                  />
                  <StatTile label={t('xDash.tokenDrawer.tile.velocity', 'Velocity')} value={`${Number(metrics.velocity_ratio || 0).toFixed(2)}x`} info="velocity" />
                  <StatTile label={t('xDash.tokenDrawer.tile.novelty', 'Novelty')} value={`${Number(metrics.novelty_ratio || 0).toFixed(2)}x`} info="novelty" />
                  <StatTile
                    label={t('xDash.tokenDrawer.tile.cleanSignal', 'Clean signal')}
                    value={formatPercent(metrics.clean_signal_score_24h)}
                    tone={Number(metrics.clean_signal_score_24h) >= 0.7 ? 'bull' : Number(metrics.clean_signal_score_24h) >= 0.55 ? 'amber' : 'bear'}
                    info="cleanSignal"
                  />
                  <StatTile
                    label={t('xDash.tokenDrawer.tile.engagementWin', 'Engagement {{win}}', { win: statsTfLabel })}
                    value={formatNum(statsTf === '24h' ? metrics.external_weighted_engagement_24h : metrics.external_weighted_engagement, { maxFraction: 0 })}
                    info="engagement"
                  />
                  <StatTile label={t('xDash.tokenDrawer.tile.engagementTotal', 'Engagement total')} value={formatNum(metrics.external_weighted_engagement, { maxFraction: 0 })} info="engagement" />
                  <StatTile label={t('xDash.tokenDrawer.tile.medianEng', 'Median eng.')} value={formatNum(metrics.median_weighted_engagement, { maxFraction: 0 })} info="medianEng" />
                </div>

                {/* Momentum history — mentions + engagement over the
                    intel-snapshot window. Timeframe selector filters the
                    same dataset to 24h / 7d / 30d / All so the chart can
                    read near-term spikes without losing the longer baseline. */}
                {(loading || hasIntelHistory) && (
                  <MomentumHistoryBlock
                    history={intelHistory}
                    loading={loading && !data}
                    height={fullscreen ? 220 : 150}
                    /* Authoritative first-seen comes from X-Dash state, NOT
                       from min(history.snapshot_at) which only spans the
                       rolling intel window (last few hours).
                       state.first_ingested_at = when X-Dash first crawled
                       this token. Fall back to momentum_entry.entered_at
                       (when it entered the momentum board) or
                       token.indexation_timestamp (catalog indexation)
                       before the rolling-window fallback. */
                    firstSeenAt={
                      detail.state?.first_ingested_at
                      || detail.intelligence?.momentum_entry?.entered_at
                      || tokenInfo?.indexation_timestamp
                      || null
                    }
                  />
                )}
              </div>

              {/* SPECTRE MOMENTUM - shows entry rank + % return since this
                  token first appeared on the Momentum Top 25 leaderboard.
                  Null when never tracked, so the card is invisible. */}
              {(originFixed || momentumEntryFixed) && (
                <MomentumEntryCard
                  entry={momentumEntryFixed}
                  origin={originFixed}
                  currentMcap={Number(priceRow?.marketCap) || tokenInfo.market_cap}
                  fmtLargeShort={fmtLargeShort}
                />
              )}

              {/* MINI X BUBBLES — embedded social-graph preview of this token.
                  "Full screen" (or clicking the stage) opens the full
                  interactive graph at /x-bubbles?project=<cgId>. */}
              <XDMiniBubble
                cgId={cgId}
                name={tokenInfo?.name}
                symbol={tokenInfo?.symbol}
                logo={tokenInfo?.image_small || tokenInfo?.image_large || tokenInfo?.image_url}
                seedAuthors={carriers}
              />

              {/* CARRIERS BOARD - the payoff of the leaderboard +N click.
                  placed high: who is actually moving this token. */}
              {data && (carriers.length > 0 || tokenTf !== '24h') && (
                <div className="xd-carrierboard" ref={carriersRef}>
                  <div className="xd-carrierboard__head">
                    <span className="xd-drawer-section__label" style={{ margin: 0 }}>{t('xDash.tokenDrawer.section.carriers', 'Carriers')}<InfoTip text={getMetricInfo('carriers')} position="top" /></span>
                    {/* Window selector — 24h hides KOLs who carried the token
                        earlier; widening re-pulls the roster from X-Dash. */}
                    <div className="xd-momentum-tfs" role="tablist" aria-label={t('xDash.tokenDrawer.carrierWindowAria', 'Carriers window')}>
                      {CARRIER_TIMEFRAMES.map((tf2) => (
                        <button
                          key={tf2.id}
                          type="button"
                          role="tab"
                          aria-selected={tokenTf === tf2.id}
                          className={`xd-momentum-tf${tokenTf === tf2.id ? ' is-active' : ''}`}
                          onClick={() => setTokenTf(tf2.id)}
                          title={t('xDash.tokenDrawer.carrierWindowTitle', 'Show creators over this window')}
                        >
                          {tf2.label}
                        </button>
                      ))}
                    </div>
                    <span className="xd-carrierboard__count">
                      <b className="xd-num">{formatNum(carrierCount)}</b>
                      {' '}{t('xDash.tokenDrawer.creatorsCarrying', 'creators carrying')} <span className="xd-num">{cashtag}</span>
                    </span>
                  </div>
                  {fullscreen && (
                    <div className="xd-carrierboard__cols" aria-hidden="true">
                      <span className="xd-carrierboard__col xd-carrierboard__col--rank">#</span>
                      <span className="xd-carrierboard__col xd-carrierboard__col--creator">{t('xDash.tokenDrawer.col.creator', 'Creator')}</span>
                      <span className="xd-carrierboard__col xd-carrierboard__col--mentions">{t('xDash.tokenDrawer.col.mentions', 'Mentions')}</span>
                      <span className="xd-carrierboard__col xd-carrierboard__col--engagement">{t('xDash.tokenDrawer.col.engagement', 'Engagement')}</span>
                      <span className="xd-carrierboard__col xd-carrierboard__col--share">{t('xDash.tokenDrawer.col.shareOfAttention', 'Share of attention')}</span>
                    </div>
                  )}
                  <div className="xd-carrierboard__list">
                    {carriers.length === 0 && (
                      <div className="xd-carrierboard__empty xd-muted" style={{ padding: '14px 4px', fontSize: 13 }}>
                        {loading
                          ? t('xDash.tokenDrawer.carrierLoading', 'Loading creators…')
                          : t('xDash.tokenDrawer.carrierEmpty', 'No creators carrying in this window.')}
                      </div>
                    )}
                    {carriers.slice(0, 20).map((c, i) => {
                      const authorId = getAuthorId(c) || c.author_rest_id
                      const onBoard = authorId && boardAuthorIds.has(String(authorId))
                      const handleKey = String(c.screen_name || authorId || '').toLowerCase()
                      const strengthSummary = handleKey
                        ? carrierStrengthByAuthor.get(handleKey)
                        : null
                      return (
                        <div
                          key={authorId || c.screen_name || i}
                          className={`xd-carrierboard__slot${onBoard ? ' xd-carrierboard__slot--board' : ''}`}
                        >
                          <CarrierRow
                            author={c}
                            totalEngagement={carrierTotalEngagement}
                            boardRank={onBoard ? i + 1 : undefined}
                            onOpen={() => authorId && onOpenAuthor(authorId)}
                            strengthSummary={strengthSummary}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* quality panel */}
              <div>
                <div className="xd-drawer-section__label">
                  {t('xDash.tokenDrawer.section.quality', 'Quality')} <QualityPill status={quality.quality_status} />
                </div>
                <div className="xd-quality-panel">
                  {[quality.spam_score, quality.promo_share_24h, quality.handle_only_share_24h, quality.cashtag_only_share_24h, quality.unique_author_share_24h].some((v) => v != null) ? (
                    <>
                      <QualityRow label={t('xDash.tokenDrawer.quality.spamScore', 'Spam score')} value={quality.spam_score} />
                      <QualityRow label={t('xDash.tokenDrawer.quality.promoShare', 'Promo share 24h')} value={quality.promo_share_24h} />
                      <QualityRow label={t('xDash.tokenDrawer.quality.handleOnly', 'Handle-only 24h')} value={quality.handle_only_share_24h} />
                      <QualityRow label={t('xDash.tokenDrawer.quality.cashtagOnly', 'Cashtag-only 24h')} value={quality.cashtag_only_share_24h} />
                      <QualityRow label={t('xDash.tokenDrawer.quality.uniqueAuthor', 'Unique author 24h')} value={quality.unique_author_share_24h} inverse />
                    </>
                  ) : (
                    <div className="xd-inline-detail">
                      {(warming || (loading && !data))
                        ? t('xDash.tokenDrawer.quality.warming', 'Indexing this token’s quality signals — check back shortly.')
                        : t('xDash.tokenDrawer.quality.none', 'No quality signals for this window yet.')}
                    </div>
                  )}
                </div>
                {/* match-structure shares - both / cashtag-only / handle-only */}
                <div className="xd-drawer-chart">
                  <div className="xd-drawer-chart__label">{t('xDash.tokenDrawer.matchStructure', 'Match structure')}<InfoTip text={getMetricInfo('matchStructure')} position="top" /></div>
                  <XDQualityShares quality={quality} loading={loading && !data} />
                </div>
              </div>

              {/* intelligence */}
              {latestIntelligence && (durability.score_24h != null || crowding.score_24h != null || latestIntelligence.attention_quality) && (
                <div>
                  <div className="xd-drawer-section__label">{t('xDash.tokenDrawer.section.intelligence', 'Intelligence')}</div>
                  {/* social-health card — radar centered, 5 axis callouts on
                      the side so each dimension reads as a discrete number
                      next to the visual shape it draws. */}
                  {hasRadar && (() => {
                    const cs = Number(latestIntelligence.attention_quality?.clean_signal_score_24h || 0)
                    const br = Number(latestIntelligence.breadth?.unique_author_share_24h || 0)
                    const du = Number(latestIntelligence.durability?.score_24h || 0)
                    const mo = Number(latestIntelligence.momentum?.velocity_ratio || 0)
                    const ac = 1 - Number(latestIntelligence.crowding?.score_24h || 0)
                    const axes = [
                      { key: 'cs', label: t('xDash.tokenDrawer.axis.cleanSignal', 'Clean Signal'), value: cs, display: formatPercent(cs), info: 'cleanSignal' },
                      { key: 'br', label: t('xDash.tokenDrawer.axis.breadth', 'Breadth'), value: br, display: formatPercent(br), info: 'breadth' },
                      { key: 'du', label: t('xDash.tokenDrawer.axis.durability', 'Durability'), value: du, display: formatPercent(du), info: 'durability' },
                      { key: 'mo', label: t('xDash.tokenDrawer.axis.momentum', 'Momentum'), value: Math.max(0, Math.min(1, mo)), display: `${mo.toFixed(2)}x`, info: 'momentum' },
                      { key: 'ac', label: t('xDash.tokenDrawer.axis.antiCrowding', 'Anti-Crowding'), value: Math.max(0, Math.min(1, ac)), display: formatPercent(ac), info: 'antiCrowding' },
                    ]
                    return (
                      <div className="xd-intel-card">
                        <div className="xd-intel-card__head">
                          <span className="xd-intel-card__eyebrow">{t('xDash.tokenDrawer.socialHealth', 'Social Health')}<InfoTip text={getMetricInfo('socialHealth')} position="top" /></span>
                          <span className="xd-intel-card__hint">{t('xDash.tokenDrawer.socialHealthHint', '5-axis attention model · normalized 0–100')}</span>
                        </div>
                        <div className="xd-intel-card__body">
                          <div className="xd-intel-card__chart">
                            <XDHealthRadar latest={latestIntelligence} loading={loading && !data} height={fullscreen ? 260 : 220} />
                          </div>
                          <div className="xd-intel-card__axes">
                            {axes.map((a) => (
                              <div key={a.key} className="xd-intel-axis">
                                <div className="xd-intel-axis__row">
                                  <span className="xd-intel-axis__label">{a.label}{a.info && <InfoTip text={getMetricInfo(a.info)} position="top" />}</span>
                                  <span className="xd-intel-axis__value xd-num">{a.display}</span>
                                </div>
                                <span className="xd-intel-axis__bar">
                                  <span
                                    className="xd-intel-axis__fill"
                                    style={{ width: `${Math.max(2, a.value * 100)}%` }}
                                  />
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                  <div className="xd-drawer-grid">
                    {durability.score_24h != null && (
                      <StatTile label={t('xDash.tokenDrawer.tile.durability', 'Durability')} value={formatPercent(durability.score_24h)} info="durability" />
                    )}
                    {crowding.score_24h != null && (
                      <StatTile
                        label={t('xDash.tokenDrawer.tile.crowding', 'Crowding')}
                        value={formatPercent(crowding.score_24h)}
                        sub={crowdingAlerts.length ? crowdingAlerts.map(humanizeLabel).join(', ') : undefined}
                        info="crowding"
                      />
                    )}
                    {latestIntelligence.attention_quality?.clean_signal_score_24h != null && (
                      <StatTile
                        label={t('xDash.tokenDrawer.tile.attentionQuality', 'Attention quality')}
                        value={formatPercent(latestIntelligence.attention_quality.clean_signal_score_24h)}
                        info="attentionQuality"
                      />
                    )}
                    {latestIntelligence.breadth?.unique_author_share_24h != null && (
                      <StatTile
                        label={t('xDash.tokenDrawer.tile.breadth', 'Breadth')}
                        value={formatPercent(latestIntelligence.breadth.unique_author_share_24h)}
                        info="breadth"
                      />
                    )}
                    {latestIntelligence.momentum?.velocity_ratio != null && (
                      <StatTile
                        label={t('xDash.tokenDrawer.tile.momentumVelocity', 'Momentum velocity')}
                        value={`${Number(latestIntelligence.momentum.velocity_ratio).toFixed(2)}x`}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Chatter tone — is the crowd bullish or FUD-ing it? Sample-based
                  read over the loaded mentions so a mention spike is never taken
                  at face value (price down ≠ FUD; the tone is what matters). */}
              {chatterTone && (
                <div className={`xd-tone xd-tone--${chatterTone.tone}`}>
                  <span className="xd-tone__head">{t('xDash.tokenDrawer.chatterTone', 'Chatter tone')}</span>
                  <span className="xd-tone__verdict">{chatterTone.label}</span>
                  <span className="xd-tone__bar" aria-hidden="true">
                    <span className="xd-tone__bar-bull" style={{ width: `${Math.round(chatterTone.bullShare * 100)}%` }} />
                    <span className="xd-tone__bar-bear" style={{ width: `${Math.round(chatterTone.bearShare * 100)}%` }} />
                  </span>
                  <span className="xd-tone__meta xd-num">
                    {t('xDash.tokenDrawer.chatterToneMeta', '{{bull}} bullish · {{bear}} negative of {{n}} shown', {
                      bull: chatterTone.bull, bear: chatterTone.bear, n: chatterTone.sample,
                    })}
                  </span>
                </div>
              )}

              {/* mentions feed */}
              <XDMentionsFeed
                mentions={mergedMentions}
                tokenInfo={tokenInfo}
                onOpenAuthor={onOpenAuthor}
                label={t('xDash.tokenDrawer.mentionsFeed', 'Mentions feed')}
              />

              {/* End-of-brief footer (fullscreen only). Visually closes the
                  page so the leaderboard underneath doesn't appear to bleed
                  through. CTA returns to the leaderboard — paired with the
                  Back button in the header. */}
              {fullscreen && (
                <footer className="xd-drawer__footer" aria-label={t('xDash.tokenDrawer.endOfBrief', 'End of brief')}>
                  <div className="xd-drawer__footer-rule" />
                  <div className="xd-drawer__footer-body">
                    <div className="xd-drawer__footer-text">
                      <span className="xd-drawer__footer-eyebrow">{t('xDash.tokenDrawer.endOfBrief', 'End of brief')}</span>
                      <span className="xd-drawer__footer-title">
                        <span className="xd-num">{cashtag}</span>
                        {' '}{tokenInfo.name || ''}
                      </span>
                      <span className="xd-drawer__footer-sub">
                        {t('xDash.tokenDrawer.footerSummary', '{{carriers}} carriers · {{mentions}} mentions 24h · Signal {{signal}}', {
                          carriers: formatNum(carrierCount),
                          mentions: formatNum(metrics.external_mentions_24h),
                          signal: Math.round(signal.score || 0),
                        })}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="xd-drawer__footer-cta"
                      onClick={onClose}
                    >
                      <BackIcon />
                      <span>{t('xDash.drawer.backToLeaderboard', 'Back to leaderboard')}</span>
                    </button>
                  </div>
                </footer>
              )}
            </div>
          )}

          {/* RIGHT RAIL (fullscreen only) — creators heatmap above the
              carriers list. In side-drawer mode the rail is suppressed and
              the carriers list lives inline in the main column above. */}
          {data && fullscreen && carriers.length > 0 && (
            <aside className="xd-drawer__rail">
              <button
                type="button"
                className="xd-cmap-expand-btn"
                onClick={() => setHeatmapExpanded(true)}
                aria-label={t('xDash.tokenDrawer.expandHeatmap', 'Expand heatmap')}
                title={t('xDash.tokenDrawer.expandHeatmap', 'Expand heatmap')}
              >
                <ExpandIcon />
              </button>
              <div className="xd-drawer-section__label">
                {t('xDash.tokenDrawer.creatorsHeatmap', 'Creators heatmap')}
                <span className="xd-drawer-section__sub">
                  {' '}{t('xDash.tokenDrawer.carriersCount', '{{count}} carriers', { count: formatNum(carrierCount) })}
                </span>
              </div>
              <div className="xd-drawer__rail-heatmap-legend" aria-label={t('xDash.tokenDrawer.heatmapLegendAria', 'Heatmap legend')}>
                <span className="xd-drawer__rail-heatmap-legend-item">
                  <span className="xd-drawer__rail-heatmap-legend-swatch xd-drawer__rail-heatmap-legend-swatch--kol" />
                  {t('xDash.utils.tier.kol', 'KOL')}
                </span>
                <span className="xd-drawer__rail-heatmap-legend-item">
                  <span className="xd-drawer__rail-heatmap-legend-swatch xd-drawer__rail-heatmap-legend-swatch--influencer" />
                  {t('xDash.utils.tier.influencer', 'Influencer')}
                </span>
                <span className="xd-drawer__rail-heatmap-legend-item">
                  <span className="xd-drawer__rail-heatmap-legend-swatch xd-drawer__rail-heatmap-legend-swatch--creator" />
                  {t('xDash.utils.tier.creator', 'Creator')}
                </span>
                <span className="xd-drawer__rail-heatmap-legend-item">
                  <span className="xd-drawer__rail-heatmap-legend-swatch xd-drawer__rail-heatmap-legend-swatch--user" />
                  {t('xDash.utils.tier.user', 'User')}
                </span>
                <span className="xd-drawer__rail-heatmap-legend-note">
                  {t('xDash.tokenDrawer.heatmapLegendNote', 'Color = follower tier · Size = weighted engagement')}
                </span>
              </div>
              <XDCreatorsHeatmap
                carriers={carriers.slice(0, 64)}
                totalEngagement={carrierTotalEngagement}
                onOpenAuthor={onOpenAuthor}
              />
            </aside>
          )}
        </div>
      </aside>

      {/* "Mini fullscreen" — a large centered overlay of the creators heatmap
          so every carrier is readable. Same zoom/pan works inside. Lives in
          the portal root (which carries .app / .app-day-mode) so day-mode
          styling resolves. Closes on ✕, scrim click, and Escape. */}
      {fullscreen && heatmapExpanded && carriers.length > 0 && (
        <div
          className="xd-cmap-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={t('xDash.tokenDrawer.creatorsHeatmap', 'Creators heatmap')}
          onClick={() => setHeatmapExpanded(false)}
        >
          <div className="xd-cmap-overlay__panel" onClick={(e) => e.stopPropagation()}>
            <div className="xd-cmap-overlay__head">
              <div className="xd-cmap-overlay__title">
                {t('xDash.tokenDrawer.creatorsHeatmap', 'Creators heatmap')}
                <span className="xd-cmap-overlay__sub">
                  {' '}· {t('xDash.tokenDrawer.carriersCount', '{{count}} carriers', { count: formatNum(carrierCount) })}
                </span>
              </div>
              <div className="xd-cmap-overlay__legend" aria-label={t('xDash.tokenDrawer.heatmapLegendAria', 'Heatmap legend')}>
                <span className="xd-cmap-overlay__legend-item">
                  <span className="xd-cmap-overlay__legend-swatch xd-cmap-overlay__legend-swatch--kol" />
                  {t('xDash.utils.tier.kol', 'KOL')}
                </span>
                <span className="xd-cmap-overlay__legend-item">
                  <span className="xd-cmap-overlay__legend-swatch xd-cmap-overlay__legend-swatch--influencer" />
                  {t('xDash.utils.tier.influencer', 'Influencer')}
                </span>
                <span className="xd-cmap-overlay__legend-item">
                  <span className="xd-cmap-overlay__legend-swatch xd-cmap-overlay__legend-swatch--creator" />
                  {t('xDash.utils.tier.creator', 'Creator')}
                </span>
                <span className="xd-cmap-overlay__legend-item">
                  <span className="xd-cmap-overlay__legend-swatch xd-cmap-overlay__legend-swatch--user" />
                  {t('xDash.utils.tier.user', 'User')}
                </span>
                <span className="xd-cmap-overlay__legend-note">
                  {t('xDash.tokenDrawer.heatmapLegendNote', 'Color = follower tier · Size = weighted engagement')}
                </span>
              </div>
              <button
                type="button"
                className="xd-cmap-overlay__close"
                onClick={() => setHeatmapExpanded(false)}
                aria-label={t('xDash.drawer.close', 'Close')}
              >
                <CloseIcon />
              </button>
            </div>
            <div className="xd-cmap-overlay__body">
              <XDCreatorsHeatmap
                carriers={carriers.slice(0, 120)}
                totalEngagement={carrierTotalEngagement}
                onOpenAuthor={onOpenAuthor}
              />
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
