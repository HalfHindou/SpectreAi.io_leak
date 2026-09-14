/**
 * Shared dense token-ranking table for Leaderboard + New views.
 *
 * RECUT (attention-terminal rebuild): dropped from 11 raw columns to 6
 * synthesized ones. The table no longer makes the user be the analyst -
 * each row carries a verdict (Signal Score), a trend (rank sparkline), and
 * a relative frame (attention share % + delta vs prior daily avg). The raw
 * inputs (velocity / novelty / engagement / mcap / tier) move into the
 * token drawer as the Signal Score breakdown.
 *
 *   Rank (+move) | Token | Signal Score (+rank sparkline) |
 *   Attention Share % (+Δ) | Carriers | Quality
 *
 * Rows are the FLAT shape produced by useXDashBootstrap's normalizeItem
 * (token identity + metrics spread to top level, plus quality / state /
 * top_authors / rank_* fields preserved). The New view flattens its raw
 * nested surface rows the same way via flattenSurfaceRow().
 *
 * `boardTotalMentions` is the sum of external_mentions_24h across the
 * visible board - the denominator for each row's attention-share %.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/contexts/I18nCurrencyContext'
import { useIsMobile, useMediaQuery } from '@/hooks/useMediaQuery'
import InfoTip from '@/components/InfoTip'
import { getMetricInfo } from '@/constants/socialMetricsGlossary'
import RowQuickActions, { ActionIcon } from '../xd-row-actions'
import { useWatchlists } from '@/contexts/WatchlistsContext'
import { useCopyToast } from '@/contexts/CopyToastContext'
import {
  TokenCell, RankMove, QualityPill, CarrierCluster, SignalScore, RankSparkline,
  CleanSignalBar, MetricChip, TierBadge,
} from '../xd-bits'
import { computeSignalScore } from '../xd-signal'
import { formatNum, relativeTime, openTradingTerminal } from '../x-dash-utils'
import { overrideMomentumEntry, suppressOriginIfOverridden } from '../momentum-overrides'
import { getSimplePrices } from '@/services/coinGeckoApi'
import { getBatchPrices } from '@/services/onchainApi'
import { canonicalChainKey } from '@/lib/chain-normalize'
import { fetchTokenTone, getCachedTone, fetchBoardTone, getBoardTone } from '@/lib/xdash-tone'
import { getDexScreenerTokens } from '@/services/dexscreenerApi'
import { getPathForPageId } from '@/constants/pageRoutes'
import { isMajorToken } from '@/constants/majorTokens'

/* Module-level CG price cache. The xdash bootstrap endpoint omits price -
   only market_cap is returned - so the table fetches CG simple prices for
   the visible cg_ids on mount and reuses the result across paginations /
   filter changes. 60s TTL keeps it cheap; the cache is shared across the
   leaderboard and new-tokens views since both render through this table. */
const PRICE_CACHE = new Map() /* cg_id -> { price, mcap, ts } */
const PRICE_TTL_MS = 60_000

/* A phone in LANDSCAPE is >768px wide, so useIsMobile() (width-only) reports
   desktop and the wide 1180px table renders into a ~390px-tall viewport that
   can only be read by swiping. Treat short landscape phones/small tablets as
   "compact" too so they get the same card list. Bounded by max-width:1024 so a
   short desktop window keeps the full table. Mirrored by the landscape CSS
   block in x-dash-page.mobile.css that un-sticks the command bar. */
const LANDSCAPE_PHONE_Q = '(orientation: landscape) and (max-height: 600px) and (max-width: 1024px)'

/* Price formatters now flow through useCurrency() so values render in the
   user's currency. The function-based formatters are injected into TokenRow
   via props so we don't have to call the hook per row. */

/* Flatten a raw nested surface row ({ state, token, metrics, quality, ... })
   into the same flat shape useXDashBootstrap produces. */
export function flattenSurfaceRow(row) {
  if (!row || !row.token || typeof row.token !== 'object') return row
  const t = row.token
  const m = row.metrics || {}
  return {
    ...t,
    ...m,
    image: t.image_small || t.image_url,
    quality: row.quality,
    state: row.state,
    fetch_coverage: row.fetch_coverage,
    top_authors: row.top_authors,
    rank_position: row.rank_position,
    rank_direction: row.rank_direction,
    rank_change_positions: row.rank_change_positions,
    previous_rank_position: row.previous_rank_position,
    opening_rank_position_window: row.opening_rank_position_window,
    best_rank_position_window: row.best_rank_position_window,
    worst_rank_position_window: row.worst_rank_position_window,
    latest_mention_at: row.latest_mention_at,
    first_discovered_at: row.first_discovered_at,
    hours_since_discovery: row.hours_since_discovery,
    momentum_entry: row.momentum_entry || null,
  }
}

function tokenIdentity(row) {
  return {
    symbol: row.symbol,
    name: row.name,
    cg_id: row.cg_id || row.token_id,
    cashtag: row.cashtag,
    segment: row.segment,
    chain: row.chain,
    image_small: row.image_small || row.image,
    image_url: row.image_url,
  }
}

/* attention-share delta: this token's 24h mentions vs its own prior daily
   average. Positive = getting louder than its baseline. */
function attentionDelta(row) {
  const now = Number(row.external_mentions_24h || 0)
  const prev = Number(row.external_mentions_prev_daily_avg || 0)
  if (prev <= 0) return null
  return (now - prev) / prev
}

/* Compact "tracked since Momentum Top 25" chip for leaderboard rows. */
function MomentumChip({ entry, currentMcap }) {
  const { t, i18n } = useTranslation()
  if (!entry) return null
  const entryMcap = Number(entry.entry_market_cap || 0)
  const live = Number(currentMcap || 0)
  const rank = Number(entry.entry_rank || 0)
  const hasPct = entryMcap > 0 && live > 0
  const pct = hasPct ? ((live - entryMcap) / entryMcap) * 100 : null
  const tone = pct == null ? 'flat' : pct >= 0 ? 'up' : 'down'

  let tip = t('xDash.tokenTable.momentum.tipNoDate', 'Tracked since first Momentum Top 25 appearance - measured from leaderboard entry, not a prediction')
  if (entry.entered_at) {
    const d = new Date(entry.entered_at)
    if (!Number.isNaN(d.getTime())) {
      const when = new Intl.DateTimeFormat(i18n.language, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }).format(d)
      tip = t('xDash.tokenTable.momentum.tipWithDate', 'Entered Momentum Top 25 on {{when}} - measured from leaderboard entry, not a prediction', { when })
    }
  }

  return (
    <span className={`xd-mchip xd-mchip--${tone}`} data-tooltip={tip}>
      <span className="xd-mchip__label">
        {rank > 0
          ? t('xDash.tokenTable.momentum.trackedWithRank', 'Tracked #{{rank}}', { rank })
          : t('xDash.tokenTable.momentum.tracked', 'Tracked')}
      </span>
      {pct != null && (
        <span className="xd-mchip__pct xd-num">
          {pct >= 0 ? '+' : ''}{Math.round(pct)}%
        </span>
      )}
    </span>
  )
}

function ShareDelta({ delta, unavailable }) {
  const { t } = useTranslation()
  // Upstream zeroed its 24h rollup, so the board is running on window-scoped
  // mentions and there is no prior period to measure against. Render nothing:
  // 'new' would be wrong (these rows are not new) and a percent would be made up.
  if (unavailable) return null
  if (delta == null) return <span className="xd-sharedelta xd-sharedelta--flat">{t('xDash.tokenTable.share.new', 'new')}</span>
  const pct = delta * 100
  const tone = pct > 1.5 ? 'up' : pct < -1.5 ? 'down' : 'flat'
  const sign = pct > 0 ? '+' : ''
  return (
    <span className={`xd-sharedelta xd-sharedelta--${tone} xd-num`}>
      {sign}{pct.toFixed(0)}%
    </span>
  )
}

/* ---------- StayingPower ----------
   Durability verdict: a thin neutral score bar (width = score%) + the 0-100
   number + a trend arrow (rising / flat / fading). Mirrors the SIGNAL bar's
   restraint - white/neutral fill, the trend arrow carries the only color. */
const STAYING_TREND = {
  rising: { cls: 'up', glyph: '↑' },
  flat: { cls: 'flat', glyph: '→' },
  fading: { cls: 'down', glyph: '↓' },
}

function StayingPower({ score, trend }) {
  const { t } = useTranslation()
  const n = Number(score)
  if (!Number.isFinite(n)) {
    return <span className="xd-staying xd-staying--empty">&#8211;</span>
  }
  const pct = Math.max(0, Math.min(100, n))
  const key = String(trend || 'flat').toLowerCase()
  const meta = STAYING_TREND[key] || STAYING_TREND.flat
  const tip = t('xDash.tokenTable.staying.tooltip', 'Staying Power {{score}} / 100 - durability over the window', { score: Math.round(n) })
  const trendLabel = t(`xDash.tokenTable.staying.trend.${key}`, key)
  return (
    <span className="xd-staying" title={tip}>
      <span className="xd-staying__num xd-num">{Math.round(n)}</span>
      <span className="xd-staying__bar">
        <span className="xd-staying__bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span
        className={`xd-staying__trend xd-staying__trend--${meta.cls}`}
        title={trendLabel}
        aria-label={trendLabel}
      >
        {meta.glyph}
      </span>
    </span>
  )
}

/* ============================================================
   Column sorting (client-side)

   The board arrives pre-ranked by the page's active ranking pill. Clicking a
   column header re-sorts the VISIBLE rows by that field with no refetch.
   Three-state per column: default dir -> opposite dir -> back to the board's
   natural order. Rows missing a value (e.g. mcap/price unknown, rendered "-")
   ALWAYS sink to the bottom regardless of direction - so sorting Market Cap
   ascending surfaces the real low-caps first, not the unknowns.
   ============================================================ */
function numOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function posNumOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}
function rowPriceVal(row, priceMap) {
  const cgId = row.cg_id || row.token_id
  const live = priceMap?.get?.(cgId)
  return posNumOrNull(live ?? row.current_price ?? row.price_usd ?? row.price)
}
/* Live market cap. The X Dash bootstrap row carries only a FROZEN index-time
   `market_cap`, so a rugged -90% husk (e.g. FRAG) still showed its entry mcap
   ($1.10M) in the table while the drawer showed the real ~$87K. Prefer the live
   mcap cached from the price fetch (PRICE_CACHE), fall back to the stale row. */
/* Exported so the leaderboard's custom mcap band filters on the SAME number the
   Market Cap column renders. Filtering on the frozen row.market_cap alone let a
   token whose live price had moved it out of the band ($ANVL at $54.8M in a
   $10M-$50M band) still show up, which reads as a broken filter. PRICE_CACHE is
   module-level and shared, so once the table has enriched a row every later
   filter pass sees the live value. */
export function liveMcap(row) {
  const cgId = row.cg_id || row.token_id
  const live = posNumOrNull(PRICE_CACHE.get(cgId)?.mcap)
  return live ?? posNumOrNull(row.market_cap)
}

/* Live 24h traded volume ($) for the row, from the DexScreener enrichment. */
function liveVolume(row) {
  const cgId = row.cg_id || row.token_id
  return posNumOrNull(PRICE_CACHE.get(cgId)?.volume24)
}

/* ATTENTION vs VOLUME — the read Sunny asked for: "if a token is talked about
   but volume is low, what is the thesis?" Chatter without traded flow is talk,
   not money — usually manufactured, too-early, or a dead cap being farmed for
   engagement. We express it as TURNOVER (24h volume ÷ market cap): how much of
   the cap actually changed hands while people were posting.
     < 4%  = thin — attention isn't converting to flow
     4–40% = healthy participation
     > 40% = hot — real money is moving with the talk
   Only fires a divergence flag when the token IS getting talked about
   (≥15 mentions/24h) so a genuinely quiet token doesn't read as "suspicious".
   Null when volume or mcap is unknown (honest — no fabricated verdict). */
function attnVolumeRead(row) {
  const vol = liveVolume(row)
  const mc = liveMcap(row)
  const mentions = Number(row.external_mentions_24h || 0)
  if (vol == null || mc == null || mc <= 0) return null
  const turnover = vol / mc
  if (mentions >= 15 && turnover < 0.04) {
    return { tone: 'thin', label: 'Talk · thin flow', turnover, hint: 'Chatter without traded volume — attention isn’t converting to money. Manufactured or too early; wait for flow to confirm.' }
  }
  if (turnover >= 0.4) {
    return { tone: 'hot', label: 'Flow confirms', turnover, hint: 'Real volume is moving with the talk — attention is backed by money.' }
  }
  return { tone: 'ok', label: null, turnover, hint: null }
}

function rowChange24(row) {
  const cgId = row.cg_id || row.token_id
  const c = PRICE_CACHE.get(cgId)?.change24h
  return Number.isFinite(c) ? c : null
}
/* Short-term (1h) trend — the "is it still bleeding right now" tell. Only the
   DexScreener fallback fills it (degens), which is exactly where bagholder-cope
   traps live. Null when unknown → the verdict just stays a neutral caution. */
function rowChange1h(row) {
  const cgId = row.cg_id || row.token_id
  const c = PRICE_CACHE.get(cgId)?.change1h
  return Number.isFinite(c) ? c : null
}

/* Direction-aware read of a row's attention. X Dash MOMENTUM ranks by MENTION
   velocity, which is direction-blind: when a token's price falls, mentions can
   spike too and the row surfaces as if it were heating up. This flags the
   DIVERGENCE (attention accelerating while price drops) so the mention spike is
   never read at face value as a run signal.

   IMPORTANT (founder note 2026-07-11): a price drop is NOT proof of FUD. We
   verified $VENA down -37% while its chatter was bullish/promotional (team
   shipping, token burns, listings) — a dip with support, not negative sentiment.
   So this is a "check the chatter" DIVERGENCE flag, not an assertion of FUD.
   Real FUD = NEGATIVE speech, which needs mention-sentiment (see the drawer's
   Chatter Tone read + the data-lane ask for a board-wide negative-share signal).
     - diverge:  price down hard AND attention accelerating (verify tone)
     - falling:  price down, attention not accelerating (fading)
     - heating:  price up with the attention (a genuine runner)
     - steady:   flat / unknown
   velocity_ratio ~1.0 = flat baseline, >1 = accelerating. Fires only when a live
   24h change exists. */
const DIVERGE_DROP_PCT = -12   // price down at least this much (24h)
const FADE_DROP_PCT = -6
const HEAT_PCT = 12
const ACCEL_RATIO = 1.2        // mentions accelerating vs baseline
function attentionHealth(row, change) {
  const ch = change === undefined ? rowChange24(row) : change
  if (ch == null) return { state: 'steady', ch: null }
  const vel = Number(row.velocity_ratio ?? row.metrics?.velocity_ratio ?? 0)
  if (ch <= DIVERGE_DROP_PCT && vel >= ACCEL_RATIO) return { state: 'diverge', ch, vel }
  if (ch <= FADE_DROP_PCT) return { state: 'falling', ch, vel }
  if (ch >= HEAT_PCT) return { state: 'heating', ch, vel }
  return { state: 'steady', ch, vel }
}

/* Verdict for a diverging (price down hard + attention accelerating) row, once
   its chatter tone is known. RISK-FIRST — a dump is never painted green:
   bullish chatter on a falling price is NOT proof of a healthy dip, it's exactly
   where BAGHOLDERS talk their book (and where teams farm exit liquidity). So:
     - negative tone            → FUD (the crowd has turned)
     - bullish + STILL bleeding → "Bleeding · bags?" — buzz isn't stopping the
                                   drop → likely distribution/cope (most dangerous)
     - bullish + not bleeding   → "Bid or bags?" — could be real dip-buying OR
                                   cope; verify actual buys, never assume support
     - mixed / unresolved       → neutral "Buzz↑ Price↓"
   `ch1` = 1h price change (short-term "still dropping now" tell, degens only). */
const STILL_BLEEDING_PCT = -3
function divergeVerdict(health, tone, ch1, t) {
  const pct = Math.round(health.ch)
  const bleeding = Number.isFinite(ch1) && ch1 <= STILL_BLEEDING_PCT
  if (tone && tone.tone === 'negative') {
    return {
      cls: 'xd-fud xd-fud--neg',
      label: t('xDash.tokenTable.diverge.fud', 'FUD'),
      tip: t('xDash.tokenTable.diverge.fudTip', 'Down {{pct}}% (24h) AND the crowd is turning negative ({{bear}} of {{n}} shown) — panic/FUD, not a run signal.', { pct, bear: tone.bear, n: tone.sample }),
    }
  }
  if (tone && tone.tone === 'bullish') {
    if (bleeding) {
      return {
        cls: 'xd-fud xd-fud--neg',
        label: t('xDash.tokenTable.diverge.bleed', 'Bleeding · bags?'),
        tip: t('xDash.tokenTable.diverge.bleedTip', 'Down {{pct}}% (24h) and STILL dropping ({{h1}}% 1h) while the crowd stays bullish ({{bull}} of {{n}}) — the buzz isn’t stopping the bleed. Likely bagholders talking their book / distribution. Be careful.', { pct, h1: Math.round(ch1), bull: tone.bull, n: tone.sample }),
      }
    }
    return {
      cls: 'xd-fud xd-fud--warn',
      label: t('xDash.tokenTable.diverge.bags', 'Bid or bags?'),
      tip: t('xDash.tokenTable.diverge.bagsTip', 'Down {{pct}}% (24h) but the crowd is still bullish ({{bull}} of {{n}}). Could be real dip-buying — or bagholders talking their book. A dump is a dump: confirm actual buys before trusting the buzz.', { pct, bull: tone.bull, n: tone.sample }),
    }
  }
  return {
    cls: 'xd-fud',
    label: t('xDash.tokenTable.diverge.label', 'Buzz↑ Price↓'),
    tip: t('xDash.tokenTable.diverge.tip', 'Attention is accelerating while price is down {{pct}}% (24h) — reading the chatter to tell dip-buying from FUD/cope…', { pct }),
  }
}
/* CoinGecko has no circulating supply for small on-chain tokens, so getSimplePrices
   returns a live PRICE but a null mcap — and liveMcap() falls back to the FROZEN
   index-time bootstrap `market_cap` (e.g. $DOT / usedot-ai stuck at $2.00M while it
   moved). For those rows we pull the live mcap straight from the on-chain source by
   contract. Canonical chain key -> Codex networkId (fallback when the row omits
   network_id). Keyed by the canonical chain so it resolves whether upstream
   sends a CG slug (`binance-smart-chain`, `arbitrum-one`, `robinhood`) or a
   short name (`bsc`, `arbitrum`) — before, the slug forms missed this map and
   the live-mcap override silently no-op'd for BSC/Arbitrum/Robinhood rows. */
const CHAIN_NETWORK_IDS = {
  ethereum: 1, base: 8453, solana: 1399811149, bsc: 56, arbitrum: 42161,
  polygon: 137, avalanche: 43114, optimism: 10, blast: 81457, robinhood: 4663,
}
function rowNetworkId(row) {
  const n = Number(row.network_id ?? row.networkId ?? row.token?.network_id)
  if (Number.isFinite(n) && n > 0) return n
  const key = canonicalChainKey(row.chain || row.token?.chain)
  return (key && CHAIN_NETWORK_IDS[key]) || null
}
function rowContract(row) {
  return row.contract_address || row.address || row.token?.contract_address || row.token?.address || null
}
/* Rug WARNING for the board — the platform's OWN first-surface mcap vs the live
   mcap. A token X Dash caught in the top of the board that has since collapsed
   ≥80% off that anchor is a dead/rugged husk and must be loudly tagged, so a
   lingering leaderboard spot never reads as alive. Only fires for tokens with a
   surface anchor (`momentum_entry`) — exactly the "we caught it, now it died"
   case. */
function rowRug(row, origin) {
  const entry = posNumOrNull(resolveEntryWith(row, origin)?.entry_market_cap)
  const live = liveMcap(row)
  if (!entry || !live) return null
  const drop = ((live - entry) / entry) * 100 // negative when down from the catch
  if (drop > -80) return null
  return drop <= -90
    ? { label: 'Rugged', tier: 'high', drop }
    : { label: 'Rug Risk', tier: 'med', drop }
}

/* "Peaked / round-tripped" — the token pumped meaningfully off its first-surfaced
   mcap then gave most of it back. Catches SPENT PUMPS the rug tag misses: rug
   fires at −80% from ENTRY (a dead husk), but a token can round-trip hard while
   still near/above entry — e.g. FEBU pumped +435% to $9M then fell to $1.35M
   (−85% off PEAK, only −20% off entry, so NOT a rug). Reads the immutable
   momentum-origin peak vs live mcap. The MOVE is likely done — it pairs with the
   "Bid or bags?" verdict (the price NOW may still bounce or die). */
const PEAK_GIVEBACK = 0.5   // now ≤ 50% of peak = gave back at least half the top
const PEAK_MIN_PUMP = 1.6   // peak ≥ 1.6× entry = it actually pumped (not drift)
function rowPeaked(row, origin) {
  const anchor = posNumOrNull(resolveEntryWith(row, origin)?.entry_market_cap)
  const peak = posNumOrNull(origin?.peak_market_cap)
  const live = liveMcap(row)
  if (!anchor || !peak || !live) return null
  if (peak < anchor * PEAK_MIN_PUMP) return null // never really pumped
  if (live > peak * PEAK_GIVEBACK) return null   // still near the top — move not spent
  const offPeak = ((live - peak) / peak) * 100   // negative: how far below the top
  return { offPeak, peak, live }
}
function rowFreshTs(row) {
  const sched = (row.state && row.state.scheduler) || row.scheduler || {}
  const raw = row.latest_mention_at || sched.latest_kept_created_at || sched.last_polled_at
  const ts = raw ? Date.parse(raw) : NaN
  return Number.isFinite(ts) ? ts : null
}

/* ---------- Spotted MC + ROI columns ----------
   The platform's own "first surfaced" receipt as explicit columns, mirroring
   the AI screener's trending board: the market cap X Dash caught the token at
   (momentum_entry, override-aware - the SAME anchor the Tracked chip and rug
   tag read) and the return from that anchor to the live mcap. Shown/hidden from
   the Columns dropdown (key 'spotted'), persisted with the other columns. */

/* Table density - 'compact' (the original dense terminal rows) or 'big'
   (taller rows + square pfps, the AI-screener trending look). Big trades the
   Velocity column for the extra row breathing room. */
const DENSITY_LS_KEY = 'spectre-xd-density-v1'
function readDensityPref() {
  try { return localStorage.getItem(DENSITY_LS_KEY) === 'big' ? 'big' : 'compact' } catch { return 'compact' }
}
function writeDensityPref(d) {
  try { localStorage.setItem(DENSITY_LS_KEY, d) } catch { /* private mode */ }
}

/* Column visibility - the user picks which metric columns to show/hide from a
   dropdown in the table toolbar. Rank / Token / Open (actions) are structural
   and always shown; Spotted MC/ROI keep their own toggle; Velocity is managed
   by the density switch. Everything else is user-hideable and persisted. */
const TOGGLEABLE_COLS = [
  { key: 'signal', i18n: 'xDash.tokenTable.col.signal', label: 'Signal' },
  { key: 'mentions', i18n: 'xDash.tokenTable.col.mentions', label: 'Mentions' },
  { key: 'marketCap', i18n: 'xDash.tokenTable.col.marketCap', label: 'Market Cap' },
  { key: 'spotted', i18n: 'xDash.tokenTable.spotted.toggle', label: 'Spotted MC / ROI' },
  { key: 'price', i18n: 'xDash.tokenTable.col.price', label: 'Price' },
  { key: 'authors', i18n: 'xDash.tokenTable.col.authors', label: 'Authors' },
  { key: 'weighted', i18n: 'xDash.tokenTable.col.weighted', label: 'Weighted' },
  { key: 'staying', i18n: 'xDash.tokenTable.col.staying', label: 'Staying Power' },
  { key: 'carriers', i18n: 'xDash.tokenTable.col.carriers', label: 'Carriers' },
  { key: 'quality', i18n: 'xDash.tokenTable.col.quality', label: 'Quality' },
  { key: 'fresh', i18n: 'xDash.tokenTable.col.fresh', label: 'Fresh' },
]
const HIDDEN_COLS_LS_KEY = 'spectre-xd-hidden-cols-v1'
function readHiddenCols() {
  try {
    const raw = localStorage.getItem(HIDDEN_COLS_LS_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr.filter((k) => TOGGLEABLE_COLS.some((c) => c.key === k)) : [])
  } catch { return new Set() }
}
function writeHiddenCols(set) {
  try { localStorage.setItem(HIDDEN_COLS_LS_KEY, JSON.stringify([...set])) } catch { /* private mode */ }
}

/* Toolbar dropdown to show/hide metric columns. Closes on outside click / Esc.
   Kept controlled by the parent so the choice threads to both the <thead> and
   every row in one pass. */
function ColumnPicker({ hiddenCols, onToggle }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDoc, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const shownCount = TOGGLEABLE_COLS.length - hiddenCols.size
  return (
    <div className="xd-colpick" ref={rootRef}>
      <button
        type="button"
        className={`xd-colpick__btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        title={t('xDash.tokenTable.columns.tip', 'Show or hide table columns')}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M7 2.5v11M11 2.5v11" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        {t('xDash.tokenTable.columns.label', 'Columns')}
        <span className="xd-colpick__count xd-num">{shownCount}</span>
      </button>
      {open && (
        <div className="xd-colpick__menu" role="menu">
          {TOGGLEABLE_COLS.map((c) => {
            const shown = !hiddenCols.has(c.key)
            return (
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={shown}
                key={c.key}
                className={`xd-colpick__opt${shown ? ' is-on' : ''}`}
                onClick={() => onToggle(c.key)}
              >
                <span className="xd-colpick__check" aria-hidden="true">
                  {shown && (
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6.2l2.2 2.3L9.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                {t(c.i18n, c.label)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* The bootstrap's `momentum_entry` is the LATEST board entry - a re-entry
   OVERWRITES the real first catch (BP: momentum_entry $154.8M vs the origin
   ledger's $35.7M first entry - a +327% run rendered as flat). The immutable
   record lives in /api/xdash/momentum-origin/{cgId}, so the table resolves it
   per visible row (module-cached, bounded concurrency, background - mirrors
   the trading screener) and every entry-anchored surface (Spotted MC / ROI
   columns, Tracked chip, rug tag) reads the SAME resolved anchor:
   override > origin ledger > momentum_entry. */
const ORIGIN_TTL_MS = 10 * 60_000
/* A NULL origin is short-cached (60s) not 10min: the momentum-origin box call
   is slow and times out under load, and a transient failure was negative-cached
   for the full 10min — so a token that DOES have a spotted anchor (e.g. HOODIE
   $4.5M, 401K $1.0M) rendered "-" for 10 minutes. Short-TTL nulls retry quickly;
   real data keeps the long TTL. */
const ORIGIN_NULL_TTL_MS = 60_000
function originCacheFresh(c, now) {
  if (!c) return false
  return now - c.ts < (c.data ? ORIGIN_TTL_MS : ORIGIN_NULL_TTL_MS)
}
const ORIGIN_CACHE = new Map() /* cgId -> { data: object|null, ts } */
const ORIGIN_INFLIGHT = new Map()
const ORIGIN_CONCURRENCY = 6

function fetchOrigin(cgId) {
  if (ORIGIN_INFLIGHT.has(cgId)) return ORIGIN_INFLIGHT.get(cgId)
  const p = fetch(`/api/xdash/momentum-origin/${encodeURIComponent(cgId)}`, {
    credentials: 'include',
    signal: AbortSignal.timeout(12000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const data = j?.data && posNumOrNull(j.data.entry_market_cap) ? j.data : null
      ORIGIN_CACHE.set(cgId, { data, ts: Date.now() })
      return data
    })
    .catch(() => {
      /* negative-cache failures too so pending shimmer always resolves */
      ORIGIN_CACHE.set(cgId, { data: null, ts: Date.now() })
      return null
    })
    .finally(() => ORIGIN_INFLIGHT.delete(cgId))
  ORIGIN_INFLIGHT.set(cgId, p)
  return p
}

/* One resolved "first surfaced" anchor per row. Overridden tokens suppress
   the origin (their origin IS the wrong re-entry) so the forced entry wins. */
function resolveEntryWith(row, origin) {
  const cgId = row.cg_id || row.token_id
  const me = overrideMomentumEntry(cgId, row.momentum_entry)
  const o = suppressOriginIfOverridden(cgId, origin || null)
  if (o && posNumOrNull(o.entry_market_cap)) {
    return {
      ...me,
      entry_market_cap: o.entry_market_cap,
      entry_rank: o.entry_rank ?? me?.entry_rank,
      entered_at: o.first_entered_at || me?.entered_at,
      roi_pct: o.roi_pct,
    }
  }
  return me || null
}
function rowSpottedMc(row, origin) {
  return posNumOrNull(resolveEntryWith(row, origin)?.entry_market_cap)
}
function rowSpottedRoi(row, origin) {
  const entry = resolveEntryWith(row, origin)
  const anchor = posNumOrNull(entry?.entry_market_cap)
  if (!anchor) return null
  const live = liveMcap(row)
  if (live) return ((live - anchor) / anchor) * 100
  const rp = Number(entry?.roi_pct)
  return Number.isFinite(rp) ? rp : null
}

/* Rows carry no CG global rank, so the Research Zone door uses a proxy:
   majors always qualify; otherwise live mcap >= $10M (~top-2000 territory -
   below that CG history is too thin and the AI Screener is the right full
   view). The drawer, which DOES know global_rank, gates precisely.
   On-chain tokens (with a contract) never qualify by ticker alone - a Base
   memecoin "DOT" must NOT match isMajorToken('DOT') and open Polkadot's RZ; it
   routes by contract to the AI Screener. */
const RZ_MCAP_FLOOR = 10_000_000
function rowHasRz(row) {
  if (!rowContract(row) && isMajorToken(row.symbol)) return true
  const mc = liveMcap(row)
  return mc != null && mc >= RZ_MCAP_FLOOR
}

/* Signed, tone-colored ROI value: +45%, -97%, +1.4k% past 1000. */
function RoiPct({ pct }) {
  if (pct == null) return <span className="xd-cell-empty">&#8212;</span>
  const abs = Math.abs(pct)
  const txt = abs >= 1000 ? `${(pct / 1000).toFixed(1)}k%` : `${Math.round(pct)}%`
  return (
    <span className={`xd-roi xd-roi--${pct >= 0 ? 'up' : 'down'} xd-num`}>
      {pct >= 0 ? '+' : ''}{txt}
    </span>
  )
}

/* key -> comparable value. `price` reads the resolved live price via ctx so it
   matches exactly what the row renders. */
const SORT_ACCESSORS = {
  rank: (r) => numOrNull(r.rank_position),
  token: (r) => String(r.symbol || r.name || '').toLowerCase(),
  mentions: (r) => numOrNull(r.external_mentions_24h),
  marketCap: (r) => liveMcap(r),
  spottedMc: (r, ctx) => rowSpottedMc(r, ctx.originMap?.get?.(r.cg_id || r.token_id)),
  spottedRoi: (r, ctx) => rowSpottedRoi(r, ctx.originMap?.get?.(r.cg_id || r.token_id)),
  price: (r, ctx) => rowPriceVal(r, ctx.priceMap),
  authors: (r) => numOrNull(r.unique_external_authors_24h ?? r.author_count),
  weighted: (r) => numOrNull(r.external_weighted_engagement_24h),
  velocity: (r) => numOrNull(r.velocity_ratio),
  signal: (r) => numOrNull(computeSignalScore(r)?.score),
  staying: (r) => numOrNull(r.staying_power),
  quality: (r) => numOrNull(r.quality?.clean_signal_score_24h ?? r.clean_signal_score_24h),
  fresh: (r) => rowFreshTs(r),
}

/* First-click direction. Rank/Token read ascending (1 first, A->Z); every
   quantitative column reads descending (biggest first) - one more click flips
   it to ascending (e.g. Market Cap asc = smallest caps first). */
const SORT_DEFAULT_DIR = { rank: 'asc', token: 'asc' }
const sortDefaultDir = (key) => SORT_DEFAULT_DIR[key] || 'desc'

function sortRows(rows, key, dir, ctx) {
  const acc = SORT_ACCESSORS[key]
  if (!acc) return rows
  const mul = dir === 'asc' ? 1 : -1
  const decorated = rows.map((r, i) => ({ r, i, v: acc(r, ctx) }))
  decorated.sort((a, b) => {
    const av = a.v
    const bv = b.v
    const aNull = av == null
    const bNull = bv == null
    if (aNull || bNull) {
      if (aNull && bNull) return a.i - b.i
      return aNull ? 1 : -1 // nulls always last, both directions
    }
    if (typeof av === 'string' || typeof bv === 'string') {
      const cmp = String(av).localeCompare(String(bv))
      return cmp !== 0 ? cmp * mul : a.i - b.i
    }
    if (av === bv) return a.i - b.i // stable on ties
    return (av - bv) * mul
  })
  return decorated.map((d) => d.r)
}

/* Sortable <th>. Reveals a caret on hover; bright + locked on the active
   column. Composes with the metric InfoTip (its clicks are swallowed so they
   don't also trigger a sort) and the optional window-label badge. Keyboard
   accessible (Enter / Space). */
function SortTh({ sortKey, sort, onSort, className = '', title, info, windowBadge, children }) {
  const active = sort.key === sortKey
  const glyph = active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'
  return (
    <th
      className={`${className} xd-th-sortable${active ? ' xd-th-sorted' : ''}`.trim()}
      title={title}
      role="columnheader"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
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
        {windowBadge && <span className="xd-th-window">{windowBadge}</span>}
        <span className={`xd-th-arrow${active ? ' xd-th-arrow--on' : ''}`} aria-hidden="true">{glyph}</span>
      </span>
    </th>
  )
}

/* Fields offered in the compact (mobile) sort dropdown. '' = the board's
   natural order; the rest mirror the header sort keys. */
const MOBILE_SORT_FIELDS = [
  { key: '', i18n: 'xDash.tokenTable.sort.board', label: 'Board order' },
  { key: 'marketCap', i18n: 'xDash.tokenTable.col.marketCap', label: 'Market Cap' },
  { key: 'mentions', i18n: 'xDash.tokenTable.col.mentions', label: 'Mentions' },
  { key: 'price', i18n: 'xDash.tokenTable.col.price', label: 'Price' },
  { key: 'authors', i18n: 'xDash.tokenTable.col.authors', label: 'Authors' },
  { key: 'signal', i18n: 'xDash.tokenTable.col.signal', label: 'Signal' },
  { key: 'staying', i18n: 'xDash.tokenTable.col.staying', label: 'Staying Power' },
  /* only offered while the Spotted columns are toggled on */
  { key: 'spottedMc', i18n: 'xDash.tokenTable.col.spottedMc', label: 'Spotted MC', spotted: true },
  { key: 'spottedRoi', i18n: 'xDash.tokenTable.col.spottedRoi', label: 'ROI', spotted: true },
]

/* Resolved live price for a row, matching exactly what the cell renders. The
   row comparator and the row body both go through this so a price-settle only
   re-renders a row when ITS price actually changed. */
function resolveRowPrice(row, priceMap) {
  const cgId = row.cg_id || row.token_id
  const live = priceMap?.get?.(cgId) ?? null
  return Number(live ?? row.current_price ?? row.price_usd ?? row.price ?? 0)
}

/* Shared row comparator for TokenRow + MobileTokenCard. useXDashBootstrap
   produces an all-new row object on every 60s poll and the price settle hands
   in a new priceMap, so default shallow memo never holds. We compare the exact
   fields the row renders (incl. the resolved price + boardTotalMentions, the
   attention-share denominator) so a row re-renders only when ITS visible data
   moved. The signal-score inputs (mentions / authors / clean signal / weighted
   engagement / velocity / novelty) are all in this list, so an unchanged set
   here means an unchanged Signal Score - no need to recompute it to compare. */
function rowVisuallyEqual(prev, next) {
  if (
    prev.onOpenToken !== next.onOpenToken
    || prev.fmtPrice !== next.fmtPrice
    || prev.fmtLargeShort !== next.fmtLargeShort
    || prev.extraColumn !== next.extraColumn
    || prev.windowMode !== next.windowMode
    || prev.boardTotalMentions !== next.boardTotalMentions
    || prev.showSpotted !== next.showSpotted
    || prev.origin !== next.origin
    || prev.originPending !== next.originPending
    || prev.tone !== next.tone
    || prev.change24 !== next.change24
    || prev.liveMc !== next.liveMc
    || prev.hideVelocity !== next.hideVelocity
    || prev.hiddenSig !== next.hiddenSig
    || prev.onOpenRz !== next.onOpenRz
    || prev.onOpenScreener !== next.onOpenScreener
  ) {
    return false
  }
  if (resolveRowPrice(prev.row, prev.priceMap) !== resolveRowPrice(next.row, next.priceMap)) {
    return false
  }
  const a = prev.row || {}
  const b = next.row || {}
  const aq = a.quality || {}
  const bq = b.quality || {}
  return (
    a.rank_position === b.rank_position
    && a.rank_direction === b.rank_direction
    && a.rank_change_positions === b.rank_change_positions
    && a.symbol === b.symbol
    && a.name === b.name
    && (a.cg_id || a.token_id) === (b.cg_id || b.token_id)
    && a.cashtag === b.cashtag
    && a.segment === b.segment
    && a.chain === b.chain
    && (a.image_small || a.image) === (b.image_small || b.image)
    && a.market_cap === b.market_cap
    && a.momentum_entry === b.momentum_entry
    && a.external_mentions_24h === b.external_mentions_24h
    && a.external_mentions_prev_daily_avg === b.external_mentions_prev_daily_avg
    && (a.unique_external_authors_24h ?? a.author_count) === (b.unique_external_authors_24h ?? b.author_count)
    && a.external_weighted_engagement_24h === b.external_weighted_engagement_24h
    && a.velocity_ratio === b.velocity_ratio
    && a.novelty_ratio === b.novelty_ratio
    && a.staying_power === b.staying_power
    && a.trend === b.trend
    && a.top_authors === b.top_authors
    && (aq.clean_signal_score_24h ?? a.clean_signal_score_24h) === (bq.clean_signal_score_24h ?? b.clean_signal_score_24h)
    && a.latest_mention_at === b.latest_mention_at
    && a.state === b.state
    && a.scheduler === b.scheduler
  )
}

function TokenRowBase({ row, onOpenToken, extraColumn, boardTotalMentions, priceMap, fmtPrice, fmtLargeShort, windowMode, showSpotted, origin, originPending, tone, change24: change24Prop, liveMc, hideVelocity, hiddenSig, onOpenRz, onOpenScreener }) {
  /* Column visibility signature (comma-joined hidden keys) - gate each cell in
     lockstep with the <thead>, both driven by the same set upstream. */
  const showCol = (k) => !(hiddenSig && hiddenSig.split(',').includes(k))
  const { t } = useTranslation()
  const { addToWatchlist, removeFromWatchlist, isInWatchlist } = useWatchlists()
  const { triggerCopyToast } = useCopyToast()
  const quality = row.quality || {}
  const topAuthors = Array.isArray(row.top_authors) ? row.top_authors : []
  const identity = tokenIdentity(row)
  const signal = computeSignalScore(row)
  const state = row.state || {}
  const scheduler = state.scheduler || row.scheduler || {}

  const mentions = Number(row.external_mentions_24h || 0)
  const share = boardTotalMentions > 0 ? mentions / boardTotalMentions : 0
  const delta = attentionDelta(row)
  const weighted = Number(row.external_weighted_engagement_24h || 0)
  const authors = Number(row.unique_external_authors_24h || row.author_count || 0)
  const latest = row.latest_mention_at || scheduler.latest_kept_created_at || scheduler.last_polled_at
  const tier = scheduler.tier || state.tier
  const marketCap = Number((Number.isFinite(liveMc) && liveMc > 0 ? liveMc : liveMcap(row)) || 0)
  const price = resolveRowPrice(row, priceMap)
  const change24 = change24Prop ?? rowChange24(row)
  const health = attentionHealth(row, change24)

  /* "..." quick actions - the little contextual options on a project row
     without opening the full drawer. Watch toggles the active watchlist,
     copy grabs the contract, X opens the cashtag feed. */
  const address = rowContract(row)
  const wlId = address || identity.symbol
  const watched = isInWatchlist(wlId)
  const xUrl = row.twitter_url
    || (row.handle ? `https://x.com/${String(row.handle).replace(/^@/, '')}`
      : (identity.symbol ? `https://x.com/search?q=%24${encodeURIComponent(identity.symbol)}&f=live` : null))
  const rowActions = [
    rowHasRz(row) && { key: 'rz', label: t('xDash.tokenTable.openIn.rz', 'Open in Research Zone'), icon: <ActionIcon name="rz" />, onClick: () => onOpenRz(row) },
    { key: 'screener', label: t('xDash.tokenTable.rowActions.screener', 'Open in AI Screener'), icon: <ActionIcon name="chart" />, onClick: () => onOpenScreener(row) },
    identity.cg_id && { key: 'dossier', label: t('xDash.tokenTable.rowActions.dossier', 'Open social dossier'), icon: <ActionIcon name="cards" />, onClick: () => onOpenToken(identity.cg_id) },
    address && {
      key: 'copy',
      label: t('xDash.tokenTable.rowActions.copy', 'Copy contract'),
      icon: <ActionIcon name="copy" />,
      onClick: () => { try { navigator.clipboard?.writeText(address); triggerCopyToast(t('xDash.tokenTable.rowActions.copied', 'Contract copied')) } catch { /* clipboard blocked */ } },
    },
    xUrl && { key: 'x', label: t('xDash.tokenTable.rowActions.x', 'Open on X'), icon: <ActionIcon name="x" />, onClick: () => window.open(xUrl, '_blank', 'noopener,noreferrer') },
    {
      key: 'watch',
      label: watched ? t('xDash.tokenTable.rowActions.unwatch', 'Remove from watchlist') : t('xDash.tokenTable.rowActions.watch', 'Add to watchlist'),
      icon: <ActionIcon name={watched ? 'star-on' : 'star'} />,
      onClick: () => {
        if (watched) { removeFromWatchlist(wlId) }
        else { addToWatchlist({ id: identity.cg_id, symbol: identity.symbol, name: identity.name, address: address || undefined, image: identity.image_small }) }
      },
    },
  ]

  // null-guard matches the movers rail - a row without a cg_id would open
  // a drawer that can never load anything
  return (
    <tr onClick={() => identity.cg_id && onOpenToken(identity.cg_id)}>
      <td>
        <div className="xd-cell-rank">
          <span className="xd-cell-rank__pos xd-num">{row.rank_position ?? '-'}</span>
          <RankMove direction={row.rank_direction} delta={row.rank_change_positions} />
        </div>
      </td>
      <td>
        <div className="xd-cell-token">
          <TokenCell token={identity} />
          <MomentumChip entry={resolveEntryWith(row, origin)} currentMcap={liveMcap(row)} />
          {health.state === 'diverge' && (() => {
            const v = divergeVerdict(health, tone, rowChange1h(row), t)
            return <span className={v.cls} data-tooltip={v.tip} data-tooltip-multiline>&#9888; {v.label}</span>
          })()}
        </div>
      </td>
      {showCol('signal') && (
        <td className="xd-col-signal">
          <div className={`xd-cell-signal${health.state === 'diverge' ? ' xd-cell-signal--muted' : ''}`}>
            <SignalScore signal={signal} variant="compact" />
          </div>
        </td>
      )}
      {showCol('mentions') && (
        <td className="xd-col-num">
          <div className="xd-cell-metric">
            <span className="xd-cell-metric__value xd-num">{formatNum(mentions)}</span>
            <span className="xd-cell-metric__sub">
              <span className="xd-cell-metric__share xd-num">{(share * 100).toFixed(1)}%</span>
              <ShareDelta delta={delta} unavailable={row.mentions_window_backfilled} />
            </span>
          </div>
        </td>
      )}
      {showCol('marketCap') && (
        <td className="xd-col-num">
          <div className="xd-cell-metric">
            <span className="xd-cell-metric__value xd-num">{marketCap > 0 ? fmtLargeShort(marketCap) : '-'}</span>
            {(() => {
              const rug = rowRug(row, origin)
              if (rug) return (
                <span className={`xd-rug xd-rug--${rug.tier}`} data-tooltip={`Down ${Math.round(rug.drop)}% from the mcap X Dash first surfaced it at — exit liquidity likely gone, treat lingering attention as a trap.`} data-tooltip-multiline>&#9888; {rug.label}</span>
              )
              const peaked = rowPeaked(row, origin)
              if (peaked) return (
                <span className="xd-peaked" data-tooltip={`Pumped to ${fmtLargeShort(peaked.peak)} then round-tripped to ${fmtLargeShort(peaked.live)} — ${Math.round(Math.abs(peaked.offPeak))}% off its peak. The move looks spent (may still bounce or die).`} data-tooltip-multiline>&#8617; Peaked</span>
              )
              return null
            })()}
          </div>
        </td>
      )}
      {showSpotted && (
        <>
          <td className="xd-col-num xd-col-spotted">
            <div className="xd-cell-metric">
              {originPending ? (
                <span className="xd-mc-shim animate-shimmer" aria-hidden="true" />
              ) : (() => {
                const entry = resolveEntryWith(row, origin)
                const spotted = posNumOrNull(entry?.entry_market_cap)
                const when = entry?.entered_at ? new Date(entry.entered_at) : null
                const title = when && !Number.isNaN(when.getTime())
                  ? t('xDash.tokenTable.spotted.cellTipDated', 'Market cap when X Dash first surfaced it ({{date}})', { date: when.toLocaleDateString() })
                  : t('xDash.tokenTable.spotted.cellTip', 'Market cap when X Dash first surfaced it')
                return (
                  <span className="xd-cell-metric__value xd-num" title={title}>
                    {spotted ? fmtLargeShort(spotted) : '-'}
                  </span>
                )
              })()}
            </div>
          </td>
          <td className="xd-col-num xd-col-spotted">
            <div className="xd-cell-metric">
              {originPending
                ? <span className="xd-mc-shim animate-shimmer" aria-hidden="true" />
                : <RoiPct pct={rowSpottedRoi(row, origin)} />}
            </div>
          </td>
        </>
      )}
      {showCol('price') && (
        <td className="xd-col-num">
          <div className="xd-cell-metric">
            <span className="xd-cell-metric__value xd-num">{price > 0 ? fmtPrice(price) : '-'}</span>
            {change24 != null && (
              <span
                className={`xd-chg24 xd-num${change24 >= 0 ? ' xd-chg24--up' : ' xd-chg24--down'}`}
                data-tooltip={t('xDash.tokenTable.change24.tip', 'Price change over the last 24h')}
              >
                {change24 >= 0 ? '+' : ''}{change24.toFixed(change24 <= -100 || change24 >= 100 ? 0 : 1)}%
              </span>
            )}
          </div>
        </td>
      )}
      {showCol('authors') && (
        <td className="xd-col-num">
          <div className="xd-cell-metric">
            <span className="xd-cell-metric__value xd-num">{formatNum(authors)}</span>
          </div>
        </td>
      )}
      {showCol('weighted') && (
      <td className="xd-col-num">
        <div className="xd-cell-metric">
          <span className="xd-cell-metric__value xd-num">{formatNum(weighted, { maxFraction: 0 })}</span>
          {(() => {
            const vol = liveVolume(row)
            const av = attnVolumeRead(row)
            if (vol == null && !av) return null
            return (
              <span className="xd-cell-vol" title={av?.hint || 'Live 24h traded volume'}>
                {vol != null && <span className="xd-cell-vol__num xd-num">{fmtLargeShort(vol)} vol</span>}
                {av?.label && (
                  <span className={`xd-volflag xd-volflag--${av.tone}`}>
                    <span className="xd-volflag__dot" />{av.label}
                  </span>
                )}
              </span>
            )
          })()}
        </div>
      </td>
      )}
      {!hideVelocity && (
        <td className="xd-col-velocity">
          <div className="xd-cell-velocity">
            <MetricChip value={row.velocity_ratio} digits={1} title="Velocity vs prior baseline" />
            <MetricChip value={row.novelty_ratio} digits={1} title="Novelty ratio" />
          </div>
        </td>
      )}
      {showCol('staying') && (
        <td className="xd-col-staying">
          <div className="xd-cell-staying">
            <StayingPower score={row.staying_power} trend={row.trend} />
          </div>
        </td>
      )}
      {showCol('carriers') && (
        <td className="xd-col-carriers">
          {windowMode === 'rollup' ? (
            <span className="xd-cell-empty">&#8212;</span>
          ) : (
            <CarrierCluster
              authors={topAuthors}
              totalCount={row.unique_external_authors_24h}
              onOpen={() => onOpenToken(identity.cg_id, { focus: 'carriers' })}
            />
          )}
        </td>
      )}
      {showCol('quality') && (
        <td className="xd-col-quality">
          <div className="xd-cell-quality">
            {windowMode === 'rollup' ? (
              <span className="xd-cell-empty">&#8212;</span>
            ) : (
              <CleanSignalBar score={quality.clean_signal_score_24h ?? row.clean_signal_score_24h} width={56} />
            )}
          </div>
        </td>
      )}
      {showCol('fresh') && (
        <td className="xd-col-fresh">
          <div className="xd-cell-fresh">
            {windowMode === 'rollup' ? (
              <span className="xd-cell-empty">&#8212;</span>
            ) : (
              <>
                {tier && <TierBadge tier={tier} />}
                <span className="xd-cell-fresh__time">{latest ? relativeTime(latest, t) : '-'}</span>
              </>
            )}
          </div>
        </td>
      )}
      {extraColumn && <td className="xd-col-num">{extraColumn(row)}</td>}
      <td className="xd-col-open">
        <div className="xd-cell-open" onClick={(e) => e.stopPropagation()}>
          {rowHasRz(row) && (
            <button
              type="button"
              className="xd-openbtn xd-openbtn--rz"
              onClick={() => onOpenRz(row)}
              title={t('xDash.tokenTable.openIn.rz', 'Open in Research Zone')}
            >
              R
            </button>
          )}
          <button
            type="button"
            className="xd-openbtn xd-openbtn--sc"
            onClick={() => onOpenScreener(row)}
            title={t('xDash.tokenTable.openIn.screener', 'Open in AI Screener')}
          >
            S
          </button>
          <RowQuickActions items={rowActions} ariaLabel={t('xDash.tokenTable.rowActions.aria', 'More actions')} />
        </div>
      </td>
    </tr>
  )
}

/* memo'd with the shared row comparator: the board hands in a fresh row object
   every poll + a fresh priceMap on every price settle, so only re-render when a
   rendered field (or this row's resolved price) actually changed. Shields the
   per-row computeSignalScore + derivations. */
const TokenRow = memo(TokenRowBase, rowVisuallyEqual)

/* ---------- MobileTokenCard ----------
   The leaderboard row, rebuilt as a self-contained card for phone viewports
   (portrait + landscape). The desktop table is 13 columns / 1180px wide, so on
   a phone the user could only see Rank + Token and had to swipe right for Market
   Cap, Price, Authors, etc. The card surfaces all of those inline — no swipe:

     [rank ▲]  [logo]  $CASHTAG                 <mentions>
                       Name · CHAIN              share% Δ
     ── MARKET CAP ──── PRICE ──── AUTHORS ──── SIGNAL ──
     [Tracked #N +X%]  [Age]               [carrier avatars]

   Root is a <div role=button> (not <button>) because CarrierCluster renders its
   own <button> — nesting buttons is invalid HTML (same landmine the tweet cards
   hit). Click/Enter/Space open the token drawer; the carrier cluster stops
   propagation so it can deep-link to the Carriers board. */
function MobileTokenCardBase({
  row, onOpenToken, boardTotalMentions, priceMap, fmtPrice, fmtLargeShort,
  windowMode, extraColumn, showSpotted, origin, originPending, tone, change24: change24Prop, liveMc,
}) {
  const { t } = useTranslation()
  const identity = tokenIdentity(row)
  const signal = computeSignalScore(row)
  const topAuthors = Array.isArray(row.top_authors) ? row.top_authors : []

  const mentions = Number(row.external_mentions_24h || 0)
  const share = boardTotalMentions > 0 ? mentions / boardTotalMentions : 0
  const delta = attentionDelta(row)
  const authors = Number(row.unique_external_authors_24h || row.author_count || 0)
  const marketCap = Number((Number.isFinite(liveMc) && liveMc > 0 ? liveMc : liveMcap(row)) || 0)
  const price = resolveRowPrice(row, priceMap)
  const health = attentionHealth(row, change24Prop ?? rowChange24(row))
  const isRollup = windowMode === 'rollup'
  const ageCell = extraColumn ? extraColumn(row) : null

  const open = () => identity.cg_id && onOpenToken(identity.cg_id)
  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
  }

  const momentumEntry = resolveEntryWith(row, origin)
  const hasFoot = Boolean(momentumEntry) || Boolean(ageCell) || (!isRollup && topAuthors.length > 0)

  return (
    <div
      className="xd-mcard"
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKeyDown}
    >
      <div className="xd-mcard__top">
        <span className="xd-mcard__rankwrap">
          <span className="xd-mcard__rank xd-num">{row.rank_position ?? '-'}</span>
          <RankMove direction={row.rank_direction} delta={row.rank_change_positions} />
        </span>
        <div className="xd-mcard__id">
          <TokenCell token={identity} compact />
          {health.state === 'diverge' && (() => {
            const v = divergeVerdict(health, tone, rowChange1h(row), t)
            return <span className={v.cls} data-tooltip={v.tip} data-tooltip-multiline>&#9888; {v.label}</span>
          })()}
        </div>
        <span className="xd-mcard__mentions">
          <span className="xd-mcard__mentions-val xd-num">{formatNum(mentions)}</span>
          <span className="xd-mcard__mentions-sub">
            <span className="xd-mcard__mentions-share xd-num">{(share * 100).toFixed(1)}%</span>
            <ShareDelta delta={delta} unavailable={row.mentions_window_backfilled} />
          </span>
        </span>
      </div>

      <div className="xd-mcard__metrics">
        <span className="xd-mcard__metric">
          <span className="xd-mcard__metric-label">{t('xDash.tokenTable.col.marketCap', 'Market Cap')}</span>
          <span className="xd-mcard__metric-val xd-num">{marketCap > 0 ? fmtLargeShort(marketCap) : '-'}</span>
          {(() => {
            const rug = rowRug(row, origin)
            if (rug) return (
              <span className={`xd-rug xd-rug--${rug.tier}`} data-tooltip={`Down ${Math.round(rug.drop)}% from the surfaced mcap — exit liquidity likely gone.`} data-tooltip-multiline>&#9888; {rug.label}</span>
            )
            const peaked = rowPeaked(row, origin)
            if (peaked) return (
              <span className="xd-peaked" data-tooltip={`Pumped to ${fmtLargeShort(peaked.peak)} then round-tripped to ${fmtLargeShort(peaked.live)} — ${Math.round(Math.abs(peaked.offPeak))}% off peak. Move looks spent (may bounce or die).`} data-tooltip-multiline>&#8617; Peaked</span>
            )
            return null
          })()}
        </span>
        <span className="xd-mcard__metric">
          <span className="xd-mcard__metric-label">{t('xDash.tokenTable.col.price', 'Price')}</span>
          <span className="xd-mcard__metric-val xd-num">{price > 0 ? fmtPrice(price) : '-'}</span>
        </span>
        {isRollup ? (
          <span className="xd-mcard__metric">
            <span className="xd-mcard__metric-label">{t('xDash.tokenTable.col.staying', 'Staying Power')}</span>
            <span className="xd-mcard__metric-val xd-mcard__metric-val--staying">
              <StayingPower score={row.staying_power} trend={row.trend} />
            </span>
          </span>
        ) : (
          <span className="xd-mcard__metric">
            <span className="xd-mcard__metric-label">{t('xDash.tokenTable.col.authors', 'Authors')}</span>
            <span className="xd-mcard__metric-val xd-num">{formatNum(authors)}</span>
          </span>
        )}
        <span className="xd-mcard__metric xd-mcard__metric--signal">
          <span className="xd-mcard__metric-label">{t('xDash.tokenTable.col.signal', 'Signal')}</span>
          <span className="xd-mcard__metric-val">
            <SignalScore signal={signal} variant="compact" />
          </span>
        </span>
        {(() => {
          const vol = liveVolume(row)
          const av = attnVolumeRead(row)
          if (vol == null && !av?.label) return null
          return (
            <span className="xd-mcard__metric">
              <span className="xd-mcard__metric-label">{t('xDash.tokenTable.col.volume', 'Volume 24h')}</span>
              <span className="xd-mcard__vol" title={av?.hint || ''}>
                {vol != null && <span className="xd-num">{fmtLargeShort(vol)}</span>}
                {av?.label && (
                  <span className={`xd-volflag xd-volflag--${av.tone}`}>
                    <span className="xd-volflag__dot" />{av.label}
                  </span>
                )}
              </span>
            </span>
          )
        })()}
        {showSpotted && (
          <>
            <span className="xd-mcard__metric">
              <span className="xd-mcard__metric-label">{t('xDash.tokenTable.col.spottedMc', 'Spotted MC')}</span>
              <span className="xd-mcard__metric-val xd-num">
                {originPending
                  ? <span className="xd-mc-shim animate-shimmer" aria-hidden="true" />
                  : (() => { const v = rowSpottedMc(row, origin); return v ? fmtLargeShort(v) : '-' })()}
              </span>
            </span>
            <span className="xd-mcard__metric">
              <span className="xd-mcard__metric-label">{t('xDash.tokenTable.col.spottedRoi', 'ROI')}</span>
              <span className="xd-mcard__metric-val">
                {originPending
                  ? <span className="xd-mc-shim animate-shimmer" aria-hidden="true" />
                  : <RoiPct pct={rowSpottedRoi(row, origin)} />}
              </span>
            </span>
          </>
        )}
      </div>

      {hasFoot && (
        <div className="xd-mcard__foot">
          <MomentumChip entry={momentumEntry} currentMcap={liveMcap(row)} />
          {ageCell && <span className="xd-mcard__age xd-num">{ageCell}</span>}
          {!isRollup && topAuthors.length > 0 && (
            <CarrierCluster
              authors={topAuthors}
              totalCount={row.unique_external_authors_24h}
              size="sm"
              onOpen={() => onOpenToken(identity.cg_id, { focus: 'carriers' })}
            />
          )}
        </div>
      )}
    </div>
  )
}

/* same shared comparator as the desktop row - the mobile card renders a subset
   of the same fields, so comparing the superset is correct (at worst slightly
   conservative) and keeps one source of truth. */
const MobileTokenCard = memo(MobileTokenCardBase, rowVisuallyEqual)

export default function XDTokenTable({
  rows = [], onOpenToken, extraColumnLabel, extraColumn, boardTotalMentions,
  windowMode = 'live', windowLabel = '24h', toolsTarget = null,
}) {
  const { t } = useTranslation()
  const { fmtPrice, fmtLargeShort } = useCurrency()
  const navigate = useNavigate()

  /* Row-level "open full view" doors. Stable callbacks so the memo'd rows
     don't re-render on every table render. */
  const onOpenRz = useCallback((row) => {
    const cgId = row.cg_id || row.token_id
    if (!cgId) return
    navigate(`${getPathForPageId('research-zone')}/${encodeURIComponent(String(cgId).toLowerCase())}`)
  }, [navigate])
  const onOpenScreener = useCallback((row) => {
    const address = rowContract(row)
    const cgId = row.cg_id || row.token_id
    if (address) {
      // On-chain token: open the standalone trading terminal (better charts,
      // Gleb's build) by contract, in a new tab — NOT the /token "Trading Lite"
      // iframe. Loads the EXACT token by address (never a same-symbol major)
      // and infers the chain from the address format.
      if (openTradingTerminal(address)) return
    }
    // No contract -> the terminal would dead-end on a null address, so open
    // Research Zone instead (resolves by cg_id when listed, else symbol slug).
    const slug = cgId || row.symbol
    if (!slug) return
    navigate(`${getPathForPageId('research-zone')}/${encodeURIComponent(String(slug).toLowerCase())}`)
  }, [navigate])
  /* Compact = portrait phone (<=768) OR a phone/small-tablet in landscape.
     Both get the card list instead of the swipe-only wide table. */
  const isNarrow = useIsMobile()
  const isLandscapePhone = useMediaQuery(LANDSCAPE_PHONE_Q)
  const compact = isNarrow || isLandscapePhone

  /* Column sort. key=null => the board's incoming (ranking-pill) order. */
  const [sort, setSort] = useState({ key: null, dir: null })

  /* Compact | Big density. Big hides Velocity, so a velocity sort falls back
     to board order on switch. */
  const [density, setDensity] = useState(readDensityPref)
  const pickDensity = (d) => {
    setDensity(d)
    writeDensityPref(d)
    if (d === 'big') {
      setSort((prev) => (prev.key === 'velocity' ? { key: null, dir: null } : prev))
    }
  }
  const isBig = density === 'big'

  /* Column visibility (persisted). Threaded to the <thead> and every row via a
     stable signature string so a toggle re-renders each memoized row once. */
  const [hiddenCols, setHiddenCols] = useState(readHiddenCols)
  const toggleCol = useCallback((key) => {
    setHiddenCols((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      writeHiddenCols(next)
      return next
    })
    /* Hiding the Spotted MC / ROI pair while sorted by one of its columns falls
       back to board order (the sort key no longer has a column to point at). */
    if (key === 'spotted') {
      setSort((prev) => (prev.key === 'spottedMc' || prev.key === 'spottedRoi' ? { key: null, dir: null } : prev))
    }
  }, [])
  const hiddenSig = useMemo(() => [...hiddenCols].sort().join(','), [hiddenCols])
  const showCol = useCallback((key) => !hiddenCols.has(key), [hiddenCols])
  /* Spotted MC + ROI now live in the Columns dropdown (default on). */
  const showSpotted = showCol('spotted')

  /* Twin horizontal scrollbar ABOVE the header. The wide table's native scroll
     sits at the very bottom of the (tall, viewport-bounded) region, so reaching
     it meant scrolling all the way down. This proxy rail mirrors the table width
     and syncs scrollLeft both ways, giving a horizontal scrollbar at the top of
     the panel too. Only rendered when the table actually overflows sideways. */
  const bodyScrollRef = useRef(null)
  const topScrollRef = useRef(null)
  const topRailRef = useRef(null)
  const [hasHScroll, setHasHScroll] = useState(false)
  useEffect(() => {
    const body = bodyScrollRef.current
    const top = topScrollRef.current
    const rail = topRailRef.current
    if (!body || !top || !rail) return undefined
    const sync = () => {
      const tbl = body.querySelector('table')
      const rankCell = tbl?.querySelector('thead th')
      if (rankCell) tbl.style.setProperty('--xd-rank-width', `${rankCell.getBoundingClientRect().width}px`)
      const w = tbl ? tbl.scrollWidth : body.scrollWidth
      rail.style.width = `${w}px`
      setHasHScroll(w > body.clientWidth + 2)
    }
    sync()
    let lock = false
    const onTop = () => { if (lock) return; lock = true; body.scrollLeft = top.scrollLeft; lock = false }
    const onBody = () => { if (lock) return; lock = true; top.scrollLeft = body.scrollLeft; lock = false }
    top.addEventListener('scroll', onTop, { passive: true })
    body.addEventListener('scroll', onBody, { passive: true })
    const ro = new ResizeObserver(sync)
    ro.observe(body)
    const tbl = body.querySelector('table')
    if (tbl) { ro.observe(tbl); const rankCell = tbl.querySelector('thead th'); if (rankCell) ro.observe(rankCell) }
    window.addEventListener('resize', sync)
    return () => {
      top.removeEventListener('scroll', onTop)
      body.removeEventListener('scroll', onBody)
      ro.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [hiddenSig, density, windowMode, compact])

  /* desktop header: default dir -> opposite -> off (back to board order) */
  const cycleSort = (key) => setSort((prev) => {
    const def = sortDefaultDir(key)
    if (prev.key !== key) return { key, dir: def }
    if (prev.dir === def) return { key, dir: def === 'asc' ? 'desc' : 'asc' }
    return { key: null, dir: null }
  })
  /* mobile dropdown: pick a field (its default dir), button flips direction */
  const pickSort = (key) => setSort(key ? { key, dir: sortDefaultDir(key) } : { key: null, dir: null })
  const flipSortDir = () => setSort((prev) => {
    const key = prev.key || 'rank'
    const cur = prev.dir || sortDefaultDir(key)
    return { key, dir: cur === 'asc' ? 'desc' : 'asc' }
  })

  /* if a caller doesn't pass a board total, derive it from the visible rows
     so attention-share % still renders coherently for this page. */
  const total = boardTotalMentions != null
    ? boardTotalMentions
    : rows.reduce((sum, r) => sum + Number(r.external_mentions_24h || 0), 0)

  /* Live USD prices for the visible cg_ids. Bootstrap omits price, so we
     pull from CoinGecko in one batch. Stable key over the visible cg_ids
     prevents refetching when the user scrolls within the same page. */
  const cgIdsKey = useMemo(() => (
    rows.map((r) => r.cg_id || r.token_id).filter(Boolean).join(',')
  ), [rows])

  const [priceMap, setPriceMap] = useState(() => {
    const m = new Map()
    for (const id of cgIdsKey.split(',')) {
      const c = PRICE_CACHE.get(id)
      if (c && Date.now() - c.ts < PRICE_TTL_MS) m.set(id, c.price)
    }
    return m
  })

  /* 24h price change threaded as its own map (cgId -> pct) so a row re-renders
     when the direction lands even if the price number didn't move. Seeded from
     PRICE_CACHE, filled by the CG price effect and — for the many robinhood/
     degen tokens the box returns NO 24h change for (VENA, FEBU) — by a
     DexScreener-by-contract fallback below. This is what makes the divergence
     flag + tone fire on exactly the degens that matter. */
  const [change24Map, setChange24Map] = useState(() => {
    const m = new Map()
    for (const id of cgIdsKey.split(',')) {
      const c = PRICE_CACHE.get(id)
      if (c && Number.isFinite(c.change24h)) m.set(id, c.change24h)
    }
    return m
  })

  /* Live mcap threaded as its own map (cgId -> mcap) so a row re-renders when its
     MCAP is corrected even if the price barely moved — the memo compares price,
     and a CG->DexScreener mcap fix ($90M->$215M for ANSEM) can land at a nearly
     identical price, which otherwise never re-rendered the row. */
  const [mcapMap, setMcapMap] = useState(() => {
    const m = new Map()
    for (const id of cgIdsKey.split(',')) {
      const c = PRICE_CACHE.get(id)
      if (c && Number.isFinite(c.mcap) && c.mcap > 0) m.set(id, c.mcap)
    }
    return m
  })
  const bumpMcap = useCallback((entries) => {
    if (!entries || !entries.size) return
    setMcapMap((prev) => { const m = new Map(prev); for (const [k, v] of entries) m.set(k, v); return m })
  }, [])

  useEffect(() => {
    const ids = cgIdsKey ? cgIdsKey.split(',') : []
    if (!ids.length) return undefined

    const now = Date.now()
    const stale = []
    const fresh = new Map()
    for (const id of ids) {
      const c = PRICE_CACHE.get(id)
      if (c && now - c.ts < PRICE_TTL_MS) fresh.set(id, c.price)
      else stale.push(id)
    }
    setPriceMap(fresh)
    if (!stale.length) return undefined

    let cancelled = false
    getSimplePrices(stale).then((result) => {
      if (cancelled || !result) return
      const merged = new Map(fresh)
      const chg = new Map()
      const mcm = new Map()
      for (const [id, entry] of result.entries()) {
        const p = Number(entry?.price)
        if (Number.isFinite(p) && p > 0) {
          const mc = Number(entry?.marketCap)
          const ch = Number(entry?.change24h)
          // CG mcap is CIRCULATING-based and understates on-chain/pump.fun tokens
          // (ANSEM: CG circ $90M vs $215M real). Tag it 'cg' so the DexScreener
          // pass can override it — and NEVER clobber an already-authoritative
          // (dex/on-chain) mcap when CG resolves last (the race that kept ANSEM
          // stuck at $90M).
          const prevCg = PRICE_CACHE.get(id) || {}
          const prevAuthCg = Number.isFinite(prevCg.mcap) && prevCg.mcap > 0 && prevCg.mcapSrc && prevCg.mcapSrc !== 'cg'
          PRICE_CACHE.set(id, {
            ...prevCg,
            price: p,
            mcap: prevAuthCg ? prevCg.mcap : (Number.isFinite(mc) && mc > 0 ? mc : null),
            mcapSrc: prevAuthCg ? prevCg.mcapSrc : ((Number.isFinite(mc) && mc > 0) ? 'cg' : null),
            change24h: Number.isFinite(ch) ? ch : (prevCg.change24h ?? null),
            ts: Date.now(),
          })
          merged.set(id, p)
          if (Number.isFinite(ch)) chg.set(id, ch)
          const finalMc = PRICE_CACHE.get(id)?.mcap
          if (Number.isFinite(finalMc) && finalMc > 0) mcm.set(id, finalMc)
        }
      }
      setPriceMap(merged)
      if (chg.size) setChange24Map((prev) => { const m = new Map(prev); for (const [k, v] of chg) m.set(k, v); return m })
      bumpMcap(mcm)
    }).catch(() => {})

    return () => { cancelled = true }
  }, [cgIdsKey])

  /* DexScreener fallback (by contract) for rows the CG + on-chain-bridge paths
     left with (a) no 24h change — the robinhood/degen tokens the divergence flag
     needs — and/or (b) a stale/frozen catalog MCAP. DexScreener-by-contract is
     authoritative for on-chain tokens (e.g. ANSEM read $90.9M frozen from the
     catalog while it was really $221.7M live across its pumpswap/meteora pools).
     Runs once per cgId set; only fetches rows still missing a change OR a live
     mcap. Threads price so the row re-renders and liveMcap re-reads the fresh
     mcap. Keyed on the ROW's contract, so no same-symbol clone can leak in. */
  useEffect(() => {
    const need = []
    for (const row of rowsRef.current || []) {
      const cgId = row.cg_id || row.token_id
      if (!cgId) continue
      const cached = PRICE_CACHE.get(cgId)
      const hasChange = change24Map.has(cgId) || (cached && Number.isFinite(cached.change24h))
      // A CG *circulating* mcap does NOT count as done — for on-chain tokens it
      // understates the real traded mcap, so we still fetch DexScreener to get
      // the authoritative by-contract value (ANSEM $90M CG -> $215M on-chain).
      const hasAuthMcap = cached && Number.isFinite(cached.mcap) && cached.mcap > 0 && cached.mcapSrc && cached.mcapSrc !== 'cg'
      if (hasChange && hasAuthMcap) continue
      const addr = rowContract(row)
      // Thread the row's chain so the proxy queries DexScreener CHAIN-SCOPED:
      // the chain-blind batch endpoint truncates at 30 pairs total AND the same
      // contract can be a different token on another chain (CULT on Ethereum vs
      // RVLT on Polygon share one address — RVLT's $447K mcap painted CULT's
      // row and fired a false Rug Risk tag).
      if (addr && String(addr).length > 25 && !String(addr).includes('::')) {
        need.push({ cgId, addr: String(addr), chain: canonicalChainKey(row.chain || row.token?.chain) || '' })
      }
    }
    if (!need.length) return undefined
    let cancelled = false
    ;(async () => {
      for (let i = 0; i < need.length && !cancelled; i += 30) {
        const batch = need.slice(i, i + 30)
        const byAddr = await getDexScreenerTokens(batch.map((x) => x.addr), batch.map((x) => x.chain)).catch(() => ({}))
        if (cancelled) continue
        const chg = new Map()
        const px = new Map()
        const mcm = new Map()
        for (const { cgId, addr, chain } of batch) {
          const d = byAddr[addr.toLowerCase()]
          if (!d) continue
          // Defense in depth: never adopt a pair from a different chain than
          // the row's (cross-chain address-twin data is worse than no data).
          if (chain && d.chainId && canonicalChainKey(d.chainId) !== chain) continue
          const ch = Number.isFinite(d.change24h) ? d.change24h : null
          const ch1 = Number.isFinite(d.change1h) ? d.change1h : null
          const mc = Number.isFinite(d.marketCap) && d.marketCap > 0 ? d.marketCap : null
          const p = Number.isFinite(d.price) && d.price > 0 ? d.price : null
          // 24h volume + liquidity ride the SAME DexScreener call (free) — the
          // "attention vs volume" divergence read needs real traded flow.
          const vol = Number.isFinite(d.volume24) && d.volume24 > 0 ? d.volume24 : null
          const liq = Number.isFinite(d.liquidity) && d.liquidity > 0 ? d.liquidity : null
          if (ch == null && mc == null && p == null && vol == null) continue
          const prev = PRICE_CACHE.get(cgId) || {}
          // DexScreener-by-contract is authoritative for on-chain tokens: adopt
          // its mcap OVER a CG circulating value; only keep an existing mcap that
          // already came from an authoritative on-chain source (dex/onchain).
          const prevAuth = Number.isFinite(prev.mcap) && prev.mcap > 0 && prev.mcapSrc && prev.mcapSrc !== 'cg'
          PRICE_CACHE.set(cgId, {
            ...prev,
            price: p ?? prev.price,
            mcap: prevAuth ? prev.mcap : (mc ?? prev.mcap ?? null),
            mcapSrc: prevAuth ? prev.mcapSrc : (mc != null ? 'dex' : (prev.mcapSrc ?? null)),
            change24h: ch != null ? ch : (prev.change24h ?? null),
            change1h: ch1 != null ? ch1 : (prev.change1h ?? null),
            volume24: vol ?? prev.volume24 ?? null,
            liquidity: liq ?? prev.liquidity ?? null,
            ts: Date.now(),
          })
          if (ch != null) chg.set(cgId, ch)
          if (p != null) px.set(cgId, p) // thread price → row re-renders → liveMcap picks up the fresh mcap
          const finalMc = PRICE_CACHE.get(cgId)?.mcap
          if (Number.isFinite(finalMc) && finalMc > 0) mcm.set(cgId, finalMc)
        }
        if (cancelled) continue
        if (chg.size) setChange24Map((prev) => { const m = new Map(prev); for (const [k, v] of chg) m.set(k, v); return m })
        if (px.size) setPriceMap((prev) => { const m = new Map(prev); for (const [k, v] of px) m.set(k, v); return m })
        bumpMcap(mcm)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cgIdsKey])

  /* latest rows for the on-chain mcap effect (keyed on the cgId set) so it reads
     current contract/networkId without re-subscribing on every metric tick */
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  /* On-chain live market cap. CoinGecko has no circulating supply for small
     on-chain tokens, so getSimplePrices gives a live PRICE but a null mcap and the
     table falls back to the FROZEN bootstrap `market_cap` (e.g. $DOT / usedot-ai
     stuck at $2.00M while it moved). Pull the live mcap straight from the on-chain
     source by contract, grouped by chain. Fail-soft: only overrides when the source
     returns a positive mcap AND price (threading the live price is what re-renders
     the memoized row so liveMcap re-reads the fresh mcap); else today's value stands. */
  useEffect(() => {
    const ids = cgIdsKey ? cgIdsKey.split(',') : []
    if (!ids.length) return undefined
    const now = Date.now()
    const byNet = new Map() // networkId -> [{ cgId, address }]
    for (const row of rowsRef.current || []) {
      const cgId = row.cg_id || row.token_id
      if (!cgId) continue
      const cached = PRICE_CACHE.get(cgId)
      // Skip only if we already have an AUTHORITATIVE (on-chain) mcap — a CG
      // circulating value must still be overridden by the on-chain source.
      if (cached && cached.mcap && cached.mcapSrc && cached.mcapSrc !== 'cg' && now - cached.ts < PRICE_TTL_MS) continue
      const address = rowContract(row)
      const net = rowNetworkId(row)
      if (!address || !net) continue
      if (!byNet.has(net)) byNet.set(net, [])
      byNet.get(net).push({ cgId, address: String(address) })
    }
    if (!byNet.size) return undefined

    let cancelled = false
    ;(async () => {
      const livePrices = new Map() // cgId -> price, threaded through priceMap to re-render
      const liveMcaps = new Map()
      for (const [net, list] of byNet) {
        try {
          const res = await getBatchPrices(list.map((x) => x.address), net)
          if (cancelled || !res?.success || !Array.isArray(res.data)) continue
          const hitByAddr = new Map()
          for (const item of res.data) {
            const addr = String(item.address || '').toLowerCase()
            if (addr) hitByAddr.set(addr, {
              mc: Number(item.market_cap_usd ?? item.marketCap) || 0,
              px: Number(item.price_usd ?? item.price) || 0,
            })
          }
          for (const { cgId, address } of list) {
            const hit = hitByAddr.get(address.toLowerCase())
            if (!hit || !(hit.mc > 0) || !(hit.px > 0)) continue
            PRICE_CACHE.set(cgId, { ...(PRICE_CACHE.get(cgId) || {}), price: hit.px, mcap: hit.mc, mcapSrc: 'onchain', ts: Date.now() })
            livePrices.set(cgId, hit.px)
            liveMcaps.set(cgId, hit.mc)
          }
        } catch { /* fail-soft: keep the existing (CG or frozen) value */ }
      }
      if (!cancelled) bumpMcap(liveMcaps)
      if (!cancelled && livePrices.size) {
        setPriceMap((prev) => {
          const merged = new Map(prev)
          for (const [cgId, px] of livePrices) merged.set(cgId, px)
          return merged
        })
      }
    })()

    return () => { cancelled = true }
  }, [cgIdsKey])

  /* Resolve the immutable momentum-origin ledger for the visible rows -
     the drawer's "Tracked since first surfaced" card reads this endpoint, so
     the board's Spotted MC / ROI / Tracked chip / rug tag must agree with it.
     Module-cached 10min, bounded concurrency, progressive (each settle
     updates just that row via the memo comparator). */
  const [originMap, setOriginMap] = useState(() => {
    const m = new Map()
    const now = Date.now()
    for (const id of cgIdsKey ? cgIdsKey.split(',') : []) {
      const c = ORIGIN_CACHE.get(id)
      if (originCacheFresh(c, now)) m.set(id, c.data)
    }
    return m
  })

  useEffect(() => {
    const ids = cgIdsKey ? cgIdsKey.split(',') : []
    if (!ids.length) return undefined
    const now = Date.now()
    const fresh = new Map()
    const stale = []
    for (const id of ids) {
      const c = ORIGIN_CACHE.get(id)
      if (originCacheFresh(c, now)) fresh.set(id, c.data)
      else stale.push(id)
    }
    setOriginMap(fresh)
    if (!stale.length) return undefined
    let cancelled = false
    let i = 0
    const worker = async () => {
      while (!cancelled && i < stale.length) {
        const id = stale[i]
        i += 1
        const data = await fetchOrigin(id)
        if (cancelled) return
        setOriginMap((prev) => {
          const m = new Map(prev)
          m.set(id, data)
          return m
        })
      }
    }
    for (let w = 0; w < Math.min(ORIGIN_CONCURRENCY, stale.length); w += 1) worker()
    return () => { cancelled = true }
  }, [cgIdsKey])

  /* Chatter-tone resolution for the DIVERGING rows (price down hard while
     attention accelerates). We classify those tokens' mention tone ourselves —
     no data-lane wait — so the amber "Buzz↑ Price↓" flag becomes a real verdict:
     negative chatter = FUD (avoid), bullish chatter = dip with support. Only the
     handful of diverging rows get resolved (cached detail fetches), and it runs
     AFTER prices land (priceMap dep) since divergence needs the 24h change. */
  const [toneMap, setToneMap] = useState(new Map())

  /* PRIMARY tone source: the data-api box classifies mention sentiment for real
     (worker-mention-classifier: Groq-8b + lexicon → mention_sentiment) and
     serves it per symbol at /v1/social/tone. One batched call covers the whole
     board, keyed to each row by symbol → cg_id. This is what powers the FUD/dip
     verdict now; the per-token client read below is only a fallback for a
     diverging row the box hasn't classified yet. */
  useEffect(() => {
    const bySym = new Map()
    for (const row of rows) {
      const id = row.cg_id || row.token_id
      const sym = String(row.symbol || '').toUpperCase()
      if (!id || !sym) continue
      if (!bySym.has(sym)) bySym.set(sym, [])
      bySym.get(sym).push(id)
    }
    if (!bySym.size) return undefined
    let cancelled = false
    fetchBoardTone([...bySym.keys()]).then((map) => {
      if (cancelled || !map || !map.size) return
      setToneMap((prev) => {
        const m = new Map(prev)
        for (const [sym, ids] of bySym) {
          const tone = map.get(sym)
          if (tone === undefined) continue // box didn't classify this symbol
          for (const id of ids) if (m.get(id) == null) m.set(id, tone)
        }
        return m
      })
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cgIdsKey])

  useEffect(() => {
    const targets = []
    for (const row of rows) {
      const id = row.cg_id || row.token_id
      if (!id) continue
      if (attentionHealth(row, change24Map.get(id)).state !== 'diverge') continue
      if (getBoardTone(String(row.symbol || '').toUpperCase())) continue // box covered it
      if (getCachedTone(id) === undefined) targets.push(id)
    }
    if (!targets.length) return undefined
    let cancelled = false
    let i = 0
    const worker = async () => {
      while (!cancelled && i < targets.length) {
        const id = targets[i]
        i += 1
        const tone = await fetchTokenTone(id)
        if (cancelled) return
        setToneMap((prev) => {
          const m = new Map(prev)
          m.set(id, tone)
          return m
        })
      }
    }
    for (let w = 0; w < Math.min(3, targets.length); w += 1) worker()
    return () => { cancelled = true }
    // change24Map drives divergence detection; cgIdsKey when the row set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cgIdsKey, change24Map])

  /* Re-sort the visible rows when a column/field is active. priceMap is a dep
     so price-sorted order settles once the async CG prices land; originMap so
     a spotted-column sort settles as origins resolve. */
  const sortedRows = useMemo(() => (
    sort.key ? sortRows(rows, sort.key, sort.dir, { priceMap, originMap }) : rows
  ), [rows, sort.key, sort.dir, priceMap, originMap])

  /* Phone viewports (portrait + landscape): a vertical card list with every
     value inline. No 1180px-wide table, no horizontal swipe. A compact sort
     bar replaces the (absent) clickable column headers. */
  if (compact) {
    const dirGlyph = (sort.dir || sortDefaultDir(sort.key || 'rank')) === 'asc' ? '↑' : '↓'
    return (
      <div className="xd-mcards-wrap">
        <div className="xd-msort">
          <span className="xd-msort__lbl">{t('xDash.tokenTable.sort.label', 'Sort')}</span>
          <select
            className="xd-msort__sel"
            value={sort.key || ''}
            onChange={(e) => pickSort(e.target.value)}
            aria-label={t('xDash.tokenTable.sort.label', 'Sort')}
          >
            {MOBILE_SORT_FIELDS.filter((f) => !f.spotted || showSpotted).map((f) => (
              <option key={f.key || 'board'} value={f.key}>{t(f.i18n, f.label)}</option>
            ))}
          </select>
          {sort.key && (
            <button
              type="button"
              className="xd-msort__dir"
              onClick={flipSortDir}
              aria-label={t('xDash.tokenTable.sort.toggleDir', 'Toggle sort direction')}
            >
              {dirGlyph}
            </button>
          )}
          <button
            type="button"
            className={`xd-spotted-toggle${showSpotted ? ' is-on' : ''}`}
            onClick={() => toggleCol('spotted')}
            aria-pressed={showSpotted}
            title={t('xDash.tokenTable.spotted.toggleTip', 'Show the market cap X Dash first surfaced each token at, and the return since')}
          >
            <span className="xd-spotted-toggle__dot" aria-hidden="true" />
            {t('xDash.tokenTable.spotted.toggle', 'Spotted MC / ROI')}
          </button>
        </div>
        <div className="xd-mcards">
          {sortedRows.map((row) => (
            <MobileTokenCard
              key={row.cg_id || row.token_id || row.rank_position}
              row={row}
              onOpenToken={onOpenToken}
              boardTotalMentions={total}
              priceMap={priceMap}
              fmtPrice={fmtPrice}
              fmtLargeShort={fmtLargeShort}
              windowMode={windowMode}
              extraColumn={extraColumn}
              showSpotted={showSpotted}
              origin={originMap.get(row.cg_id || row.token_id) || null}
              originPending={!originMap.has(row.cg_id || row.token_id)}
              tone={toneMap.get(row.cg_id || row.token_id)}
              change24={change24Map.get(row.cg_id || row.token_id)}
              liveMc={mcapMap.get(row.cg_id || row.token_id)}
            />
          ))}
        </div>
      </div>
    )
  }

  const tableTools = (
      <div className="xd-table-tools">
        <div className="xd-density-switch" role="radiogroup" aria-label={t('xDash.tokenTable.density.label', 'Row density')}>
          <button
            type="button"
            role="radio"
            aria-checked={!isBig}
            className={`xd-density-switch__opt${!isBig ? ' is-active' : ''}`}
            onClick={() => pickDensity('compact')}
          >
            {t('xDash.tokenTable.density.compact', 'Compact')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={isBig}
            className={`xd-density-switch__opt${isBig ? ' is-active' : ''}`}
            onClick={() => pickDensity('big')}
          >
            {t('xDash.tokenTable.density.big', 'Big')}
          </button>
        </div>
        <ColumnPicker hiddenCols={hiddenCols} onToggle={toggleCol} />
      </div>
  )

  return (
    <div className="xd-table-wrap">
      {toolsTarget ? createPortal(tableTools, toolsTarget) : tableTools}
      <div
        className={`xd-table-hscroll${hasHScroll ? ' is-active' : ''}`}
        ref={topScrollRef}
        aria-hidden="true"
      >
        <div className="xd-table-hscroll__rail" ref={topRailRef} />
      </div>
      <div className="xd-table-scroll" ref={bodyScrollRef}>
        <table className={`xd-table xd-table--recut${isBig ? ' xd-table--big' : ''}`}>
          <thead>
            <tr>
              <SortTh sortKey="rank" sort={sort} onSort={cycleSort} info={getMetricInfo('tracked')}>{t('xDash.tokenTable.col.rank', 'Rank')}</SortTh>
              <SortTh sortKey="token" sort={sort} onSort={cycleSort}>{t('xDash.tokenTable.col.token', 'Token')}</SortTh>
              {showCol('signal') && <SortTh sortKey="signal" sort={sort} onSort={cycleSort} className="xd-col-signal" info={getMetricInfo('signalScore')}>{t('xDash.tokenTable.col.signal', 'Signal')}</SortTh>}
              {showCol('mentions') && (
                <SortTh sortKey="mentions" sort={sort} onSort={cycleSort} className="xd-col-num" title={t('xDash.tokenTable.title.mentions', 'Mention count over the selected window')} info={getMetricInfo('mentions24h')} windowBadge={windowLabel}>
                  {t('xDash.tokenTable.col.mentions', 'Mentions')}
                </SortTh>
              )}
              {showCol('marketCap') && (
                <SortTh sortKey="marketCap" sort={sort} onSort={cycleSort} className="xd-col-num" title={t('xDash.tokenTable.title.marketCap', 'Market capitalization (USD)')} info={getMetricInfo('marketCap')}>
                  {t('xDash.tokenTable.col.marketCap', 'Market Cap')}
                </SortTh>
              )}
              {showSpotted && (
                <>
                  <SortTh sortKey="spottedMc" sort={sort} onSort={cycleSort} className="xd-col-num xd-col-spotted" title={t('xDash.tokenTable.title.spottedMc', 'Market cap when X Dash first surfaced the token onto the momentum board')} info={getMetricInfo('spotted')}>
                    {t('xDash.tokenTable.col.spottedMc', 'Spotted MC')}
                  </SortTh>
                  <SortTh sortKey="spottedRoi" sort={sort} onSort={cycleSort} className="xd-col-num xd-col-spotted" title={t('xDash.tokenTable.title.spottedRoi', 'Return from the spotted market cap to the live market cap')} info={getMetricInfo('roi')}>
                    {t('xDash.tokenTable.col.spottedRoi', 'ROI')}
                  </SortTh>
                </>
              )}
              {showCol('price') && (
                <SortTh sortKey="price" sort={sort} onSort={cycleSort} className="xd-col-num" title={t('xDash.tokenTable.title.price', 'Live price (USD)')} info={getMetricInfo('price')}>
                  {t('xDash.tokenTable.col.price', 'Price')}
                </SortTh>
              )}
              {showCol('authors') && (
                <SortTh sortKey="authors" sort={sort} onSort={cycleSort} className="xd-col-num" title={t('xDash.tokenTable.title.authors', 'Unique external authors over the selected window')} info={getMetricInfo('authors')} windowBadge={windowLabel}>
                  {t('xDash.tokenTable.col.authors', 'Authors')}
                </SortTh>
              )}
              {showCol('weighted') && (
                <SortTh sortKey="weighted" sort={sort} onSort={cycleSort} className="xd-col-num" title={t('xDash.tokenTable.title.weighted', 'Weighted engagement over the selected window')} info={getMetricInfo('weightedReach')} windowBadge={windowLabel}>
                  {t('xDash.tokenTable.col.weighted', 'Weighted')}
                </SortTh>
              )}
              {!isBig && (
                <SortTh sortKey="velocity" sort={sort} onSort={cycleSort} className="xd-col-velocity" info={getMetricInfo('velocity')}>{t('xDash.tokenTable.col.velocity', 'Velocity')}</SortTh>
              )}
              {showCol('staying') && <SortTh sortKey="staying" sort={sort} onSort={cycleSort} className="xd-col-staying" title={t('xDash.tokenTable.title.staying', 'Durability score (0-100) + trend over the window')} info={getMetricInfo('stay')}>{t('xDash.tokenTable.col.staying', 'Staying Power')}</SortTh>}
              {showCol('carriers') && (
                <th className="xd-col-carriers">
                  <span className="xd-th-inner">
                    <span className="xd-th-label">{t('xDash.tokenTable.col.carriers', 'Carriers')}</span>
                    <span className="xd-th-info"><InfoTip text={getMetricInfo('carriers')} position="top" /></span>
                  </span>
                </th>
              )}
              {showCol('quality') && <SortTh sortKey="quality" sort={sort} onSort={cycleSort} className="xd-col-quality" info={getMetricInfo('attentionQuality')}>{t('xDash.tokenTable.col.quality', 'Quality')}</SortTh>}
              {showCol('fresh') && <SortTh sortKey="fresh" sort={sort} onSort={cycleSort} className="xd-col-fresh" info={getMetricInfo('freshTokens')}>{t('xDash.tokenTable.col.fresh', 'Fresh')}</SortTh>}
              {extraColumnLabel && <th className="xd-col-num">{extraColumnLabel}</th>}
              <th className="xd-col-open">{t('xDash.tokenTable.col.open', 'Open')}</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <TokenRow
                key={row.cg_id || row.token_id || row.rank_position}
                row={row}
                onOpenToken={onOpenToken}
                extraColumn={extraColumn}
                boardTotalMentions={total}
                priceMap={priceMap}
                fmtPrice={fmtPrice}
                fmtLargeShort={fmtLargeShort}
                windowMode={windowMode}
                showSpotted={showSpotted}
                origin={originMap.get(row.cg_id || row.token_id) || null}
                originPending={!originMap.has(row.cg_id || row.token_id)}
                tone={toneMap.get(row.cg_id || row.token_id)}
                change24={change24Map.get(row.cg_id || row.token_id)}
                liveMc={mcapMap.get(row.cg_id || row.token_id)}
                hideVelocity={isBig}
                hiddenSig={hiddenSig}
                onOpenRz={onOpenRz}
                onOpenScreener={onOpenScreener}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
