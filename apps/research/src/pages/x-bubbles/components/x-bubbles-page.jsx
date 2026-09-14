/**
 * X-Bubbles Page — Social Intelligence Dashboard
 *
 * 3-column layout: left metrics | center bubble map | right movers/detail
 * Data: /api/x-bubbles (Express -> api.spectreai.io/v1/social/x-bubbles)
 *
 * Views: Bubbles (default, d3 pack), Heatmap (treemap), Bars (leaderboard)
 */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { hierarchy, pack as d3pack, treemap as d3treemap } from 'd3-hierarchy'

import './x-bubbles-page.css'
import InfoTip from '@/components/InfoTip'
import { getMetricInfo } from '@/constants/socialMetricsGlossary'
import GuidedTour, { TourLaunchButton } from '@/components/guided-tour'
import SocialDisclaimer from '@/components/social-disclaimer'
import useSettingsStore from '@/store/useSettingsStore'
import { XI_TOUR_STEPS } from './xi-tour-steps'
import { getCoinGeckoPricesForSymbols } from '@/services/coinGeckoApi'
import { getBars as codexGetBars } from '@/services/codexApi'
import { getDexScreenerTokens } from '@/services/dexscreenerApi'
import lazyWithRetry from '@/lib/lazy-with-retry'
import { isAppActive } from '@/lib/idleManager'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useNavigate } from 'react-router-dom'
import { useAppState } from '@/contexts/AppStateContext'
import { useCopyToast } from '@/contexts/CopyToastContext'
import { getPathForPageId } from '@/constants/pageRoutes'
import { buildResearchZoneLocation } from '@/lib/research-zone-routing'
import { readXDashHealth, timeframeLabel } from '@/lib/xdash-health'
import XDashUpdatingNotice from '@/components/xdash-updating-notice'

// THE REACTOR — X Intelligence's living GPU view. Lazy so three.js never touches
// the X Intelligence boot path (only loads when the Reactor view is opened).
const ReactorEngine = lazyWithRetry(() => import('@/components/constellation/ConstellationEngine'))

/* ── palette ─────────────────────────────────────────────────────────────── */
const XB_NEUTRAL = '#8E8FA8'

/* ONE momentum axis, two sources.
   The 24h document carries a mention-rate: mentions now vs the daily baseline, a
   percentage — the best signal there is, and what this page was built on. The 7d
   document carries none (see xbMapRow), but it does carry where each token sits
   on the board and where it sat when the window opened, so `rank_change` is real,
   window-scoped momentum measured in positions climbed. Everything downstream —
   colours, Rising/Falling, the movers rail, all six aggregate cards — reads this
   one accessor, so the page never has to know which source it got. */
function xbMomentum(t) {
  if (!t) return { kind: null, value: null }
  if (t.growth_pct != null) return { kind: 'growth', value: t.growth_pct }
  if (Number.isFinite(t.rank_change)) return { kind: 'rank', value: t.rank_change }
  return { kind: null, value: null }
}

function fmtMomentum(t) {
  const m = xbMomentum(t)
  if (m.value == null) return '—'
  if (m.kind === 'growth') return fmtPct(m.value)
  return `${m.value > 0 ? '+' : ''}${m.value}`
}

/* A null reads as neutral grey with no arrow — a green '▲ —' would be a
   direction we do not have. */
function growthTone(pct) {
  // Exactly zero is flat, not a climb — a green ▲ on a token that has not moved
  // was the one place this still overstated the data.
  if (pct == null || pct === 0) return { color: XB_NEUTRAL, arrow: '' }
  return pct > 0 ? { color: '#5CE6A1', arrow: '▲' } : { color: '#FF6E8E', arrow: '▼' }
}

/* Copy for when momentum is board movement rather than a mention rate. The
   glossary strings all describe mention swings, which would be the wrong
   explanation of a number measured in positions. */
const XB_RANK_TIPS = {
  growth: 'Board positions this token has climbed (+) or lost (-) since the window opened. The feed publishes no mention-rate for this window, so board movement is the momentum shown.',
  sentiment: 'Share of tracked tokens that climbed the board since the window opened. Above 50% means more tokens are gaining ground than losing it.',
  velocity: 'Average number of board positions a token moved since the window opened, either direction - how much the leaderboard is churning.',
  activeSignals: 'How many tracked tokens moved 10 or more board positions since the window opened.',
  influence: 'The overall crowd tilt - Bullish when most tracked tokens are climbing the board, Bearish when most are sliding down it.',
  signalDensity: 'The share of tracked tokens moving 10+ board positions - Active Signals out of all tokens tracked.',
}

function accentOf(growthPct) {
  if (growthPct == null) return XB_NEUTRAL
  if (growthPct >= 40) return '#5CE6A1'
  if (growthPct >= 15) return '#7BE6C1'
  if (growthPct >= 0) return '#F5C24D'
  if (growthPct >= -15) return '#FF9046'
  return '#FF6E8E'
}

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

const HEAT = {
  fire:    { accent: '#FF7A4D', glow: 'rgba(255,122,77,0.55)' },
  rising:  { accent: '#5CE6A1', glow: 'rgba(92,230,161,0.40)' },
  neutral: { accent: '#8E8FA8', glow: 'rgba(142,143,168,0.25)' },
  falling: { accent: '#FF6E8E', glow: 'rgba(255,110,142,0.40)' },
  cold:    { accent: '#6F7CE6', glow: 'rgba(111,124,230,0.40)' },
}

/* ── formatters ──────────────────────────────────────────────────────────── */
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

function fmtPrice(n) {
  if (n == null || !isFinite(n)) return '—'
  if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  if (n >= 0.0001) return `$${n.toFixed(6)}`
  return `$${n.toExponential(2)}`
}

function fmtMC(n) {
  if (n == null || !isFinite(n)) return '—'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${Math.round(n)}`
}

function timeAgo(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (!isFinite(ms) || ms < 0) return ''
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/* ── Sparkline ───────────────────────────────────────────────────────────── */
function Sparkline({ data, width, height, color = '#5CE6A1', strokeWidth = 1.5, filled }) {
  if (!data || data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const stepX = width / (data.length - 1)
  const path = data
    .map((v, i) => {
      const x = i * stepX
      const y = height - ((v - min) / range) * height
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
  const gradId = `xb-sg-${color.replace('#', '')}`
  return (
    <svg width={width} height={height} className="xb-spark" aria-hidden>
      {filled && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {filled && (
        <path
          d={`${path} L ${width} ${height} L 0 ${height} Z`}
          fill={`url(#${gradId})`}
        />
      )}
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/* ── constants ───────────────────────────────────────────────────────────── */
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'rising', label: 'Rising' },
  { id: 'falling', label: 'Falling' },
]

const MC_FILTERS = [
  { id: 'mc_all',   label: 'Any MC',       min: null,  max: null },
  { id: 'mc_micro', label: '< $1M',        min: 0,     max: 1e6 },
  { id: 'mc_5m',    label: '$1M – $5M',    min: 1e6,   max: 5e6 },
  { id: 'mc_50m',   label: '$5M – $50M',   min: 5e6,   max: 50e6 },
  { id: 'mc_500m',  label: '$50M – $500M', min: 50e6,  max: 500e6 },
  { id: 'mc_1b',    label: '$500M – $5B',  min: 500e6, max: 5e9 },
  { id: 'mc_lg',    label: '> $5B',        min: 5e9,   max: null },
]

const COUNT_OPTIONS = [25, 50, 100, 200]

const VIEWS = [
  { id: 'reactor', label: 'Reactor' },
  { id: 'bubbles', label: 'Bubbles' },
  { id: 'treemap', label: 'Heatmap' },
  { id: 'bars', label: 'Bars' },
]

const RANKINGS = [
  { id: 'mentions',  label: 'Mentions' },
  { id: 'mindshare', label: 'Mindshare' },
  { id: 'velocity',  label: 'Velocity' },
  { id: 'gainers',   label: 'Top Gainers' },
]

/* Custom dropdown for the mobile toolbar — trigger + popover menu styled to
   the ghost-pill language (no native <select> chrome). Closes on outside
   click / Escape. */
function XbSelect({ caption, value, onChange, options }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = options.find((o) => String(o.id) === String(value))

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`xb-msel${open ? ' is-open' : ''}`} ref={ref}>
      {caption && <span className="xb-msel-cap mono">{caption}</span>}
      <button
        type="button"
        className="xb-msel-trigger mono"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="xb-msel-val">{current ? current.label : 'Select'}</span>
        <svg className="xb-msel-chev" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="xb-msel-menu" role="listbox">
          {options.map((o) => {
            const active = String(o.id) === String(value)
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={active}
                className={`xb-msel-opt mono${active ? ' is-active' : ''}`}
                onClick={() => { onChange(o.id); setOpen(false) }}
              >
                {o.label}
                {active && (
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M3 8.5l3.5 3.5L13 5" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── hooks ───────────────────────────────────────────────────────────────── */

/* X Intelligence now reads the SAME backend as X Dash. It used to fetch the
   thin /api/x-bubbles (/v1/social/x-bubbles) feed, where ~80% of tokens had a
   NULL market cap (and no sparkline/logo), so the client mcap filter silently
   dropped almost the whole small-cap universe — the 1-5M view collapsed to a
   few majors and none of X Dash's buzzing frog/meme tokens (SPCX, JOTCHUA,
   GME…) appeared. Repointed to the X Dash board (/api/xdash/bootstrap → the
   X Dash service /api/bootstrap), where every token carries a real market cap
   and clean mention counts, so both pages now agree. Endpoints + params per the
   X-DASH REDMI contract (per_page capped at 50 → paginate). */
const XB_RANK_MAP = { mentions: 'mentions', mindshare: 'mentions', velocity: 'momentum', gainers: 'momentum' }
const XB_BOARD_PAGES = 4        // 4 × 50 = 200 tokens (views cap at 200; pages 5-6 were never displayable)
/* THE WINDOW THIS PAGE ASKS FOR vs THE WINDOW IT IS SERVED.
   X Dash materialises ONE aggregate document per window, and has been building
   only the 7d one — so `timeframe=24h`, which every field here is named after,
   answers 200 with zero rows. That reached the reader as "No tokens match this
   filter", i.e. the page blaming their market-cap chip for an upstream gap (same
   fault, same rule as lib/xdash-health.js: window ASKED FOR vs window SERVED).
   X Intelligence has no timeframe picker, so there is nowhere to send anyone: it
   asks for the default, and when that window was never built it re-asks for the
   one that IS live and relabels itself. Heals on its own the moment 24h returns
   rows. The resolved window is module state because the token-detail and
   firehose feeds are window-scoped too and are called deep in the tree. */
const XB_TF_DEFAULT = '24h'
const XB_TF_KNOWN = { '1h': 1, '4h': 1, '12h': 1, '24h': 1, '7d': 1, '30d': 1 }
let xbWindow = XB_TF_DEFAULT
const xbActiveWindow = () => xbWindow
function xbSetActiveWindow(tf) { if (tf && XB_TF_KNOWN[tf]) xbWindow = tf }

const XB_SPARK_LIMIT = 200      // cap CG sparkline enrichment to the visible set
const XB_CODEX_SPARK_CAP = 14   // cap Codex bars enrichment to the loudest still-missing

// localStorage instant-paint seed. Cold loads otherwise stare at the
// "Resolving social field…" shimmer until ~6 bootstrap pages resolve. We persist
// a lean board snapshot (per ranking) — sparkline arrays stripped to stay small,
// since the default Reactor view sizes/glows bubbles from mentions/velocity/
// authenticity, not price series — and hydrate it on mount, then revalidate.
const XB_LS_PREFIX = 'spectre-xbubbles-v1:'
const XB_LS_TTL = 10 * 60 * 1000   // 10 min — board data is already ~15m stale upstream

function xbReadSeed(ranking) {
  try {
    const raw = localStorage.getItem(XB_LS_PREFIX + ranking)
    if (!raw) return null
    const p = JSON.parse(raw)
    if (!p || Date.now() - p.ts > XB_LS_TTL) return null
    if (!Array.isArray(p.rows) || !p.rows.length) return null
    return p
  } catch { return null }
}

function xbWriteSeed(ranking, rows, meta) {
  try {
    if (!Array.isArray(rows) || !rows.length) return
    // Drop the bulky sparkline arrays — they refill on revalidate.
    const lean = rows.map(({ sparkline_7d, ...r }) => r)
    const payload = JSON.stringify({ ts: Date.now(), rows: lean, meta: meta || null })
    if (payload.length > 1_500_000) return   // quota guard
    localStorage.setItem(XB_LS_PREFIX + ranking, payload)
  } catch { /* quota / private mode — ignore */ }
}

// Value-signature of a board-row set across every field any view renders. The
// 60s poll mints a fresh rows array each tick; comparing this signature lets us
// keep the SAME `data` reference when nothing visible changed, so the whole
// memo tree (tokens → views) skips re-rendering instead of re-laying-out the
// d3/GPU reactor every minute.
function xbRowsSig(rows) {
  let s = ''
  for (const r of rows) {
    s += `${r.asset}:${r.mentions_24h}:${r.velocity_ratio}:${r.authenticity}:${r.growth_pct}:${r.rank_change}:${r.market_cap_usd}:${r.price_usd}:${r.price_change_24h}:${r.price_change_7d}:${Array.isArray(r.sparkline_7d) ? r.sparkline_7d.length : 0}|`
  }
  return s
}

// Module-level enrichment cache (UPPERCASE symbol -> {sparkline_7d, prices}).
// Ranking-agnostic + survives remounts, so exploring the 4 ranking tabs pays the
// CG/DexScreener/Codex cascade once per symbol per session, not once per tab.
const xbEnrichCache = new Map()

/* Map a token's chain (CoinGecko platform key OR the X Dash `chain` field) to a
   Codex networkId, so we can pull on-chain OHLCV for the DEX memes CoinGecko
   doesn't chart. Deliberately conservative — only confident chains, no default
   to ETH (a wrong network would fetch the wrong token's bars on a finance UI). */
const XB_CHAIN_NET = {
  ethereum: 1, eth: 1,
  'binance-smart-chain': 56, bsc: 56, bnb: 56, binance: 56,
  'polygon-pos': 137, polygon: 137, matic: 137,
  'arbitrum-one': 42161, arbitrum: 42161, arb: 42161,
  base: 8453,
  avalanche: 43114, avax: 43114,
  'optimistic-ethereum': 10, optimism: 10, op: 10,
  solana: 1399811149, sol: 1399811149,
  robinhood: 4663, hood: 4663,
}
function xbNetworkId(t) {
  const primary = XB_CHAIN_NET[String(t.chain || '').toLowerCase()]
  if (primary) return primary
  const platforms = t.platforms
  if (platforms && typeof platforms === 'object') {
    for (const k of Object.keys(platforms)) {
      const nid = XB_CHAIN_NET[String(k).toLowerCase()]
      if (nid) return nid
    }
  }
  return null
}

/* flatten an X Dash Token Ranking Row ({token, metrics, ...}) — mirrors
   useXDashBootstrap's normalizeItem (not exported) — into the flat token shape
   the d3 views consume. */
function xbMapRow(item, tf = xbActiveWindow()) {
  const t = (item && item.token) ? item.token : item || {}
  const m = (item && item.metrics) ? item.metrics : {}
  const q = (item && item.quality) ? item.quality : {}
  // The `*_24h` metric family only carries numbers inside the 24h document. In
  // the 7d one every one of them is a hard zero (verified across the board), and
  // reading them there paints 200 tokens at 0 mentions / 0 authenticity — a
  // board that looks dead while 56k mentions sit in the unsuffixed, window-scoped
  // fields right beside them. Read the family that matches the window served.
  const on24h = tf === '24h'
  const mentions = Number(
    (on24h ? (m.external_mentions_24h ?? m.mentions_24h) : null) ?? m.external_mentions ?? 0,
  ) || 0
  const prev = Number(m.external_mentions_prev_daily_avg ?? 0)
  const vel = Number(m.velocity_ratio)
  // authenticity 0-100 (clean signal): organic community attention vs manufactured
  // promo/bot noise. Powers the Reactor glow + the manipulation X-ray.
  const clean = Number(
    (on24h ? q.clean_signal_score_24h : null) ?? q.clean_signal_score ?? m.clean_signal_score,
  )
  const authenticity = Number.isFinite(clean) ? Math.round(Math.max(0, Math.min(1, clean)) * 100) : null
  // growth = attention momentum (mention pace vs baseline), the social analog of
  // a price change — keeps the rising/falling coloring meaningful on a social map.
  //
  // It exists ONLY in the 24h document. `external_mentions_prev_daily_avg` is a
  // DAILY baseline, and in the 7d document it is a straight external_mentions / 6
  // derivation (identical ratio on every row measured), so differencing it would
  // stamp the same fabricated number on all 200 tokens; velocity_ratio is 0 there
  // too. null is the honest answer — it greys the bubble, and the surfaces built
  // purely on momentum say what is missing instead of inventing a direction.
  const growth = on24h && prev > 0
    ? ((mentions - prev) / prev) * 100
    : (Number.isFinite(vel) && vel > 0 ? (vel - 1) * 100 : null)
  return {
    // `asset` is the page's display key + the visible TICKER (the views render
    // token.asset as the headline). The X Dash board keys on cg_id (a dasherized
    // slug like "injective-protocol" / "america-is-back-4") which read as ugly
    // names — so display the clean SYMBOL and keep the cg_id separately for the
    // detail/mentions fetches.
    asset: t.symbol ? String(t.symbol).toUpperCase() : (t.cg_id || t.token_id || ''),
    cg_id: t.cg_id || t.token_id || null,
    symbol: t.symbol,
    name: t.name,
    cashtag: t.cashtag,
    image: t.image_small || t.image_url || t.logo_url || t.logo || t.image_thumb || null,
    // contract carried through so the detail panel can offer Copy CA + a chart
    // link (parity with the X Dash drawer), not just X posts.
    contract_address: t.contract_address || t.address
      || (t.platforms && (t.platforms[t.chain] || Object.values(t.platforms)[0])) || null,
    chain: t.chain,
    category: t.primary_category || t.category,
    mentions_24h: mentions,
    market_cap_usd: Number(t.market_cap ?? t.market_cap_usd ?? 0) || null,
    velocity_ratio: Number.isFinite(vel) ? vel : null,
    authenticity,
    growth_pct: growth == null ? null : Math.round(growth * 10) / 10,
    // Positions gained on the board since the window opened. Present in every
    // document (measured over `rank_change_window_hours`), and the only real
    // momentum available when the mention-rate family is zeroed — 28 up / 18
    // down / 4 flat across the top 50 measured, so it is a live signal, not a
    // constant. Derived from the two ranks when the field itself is absent.
    rank_change: Number.isFinite(item?.rank_change_positions)
      ? item.rank_change_positions
      : (Number.isFinite(item?.opening_rank_position_window) && Number.isFinite(item?.rank_position)
        ? item.opening_rank_position_window - item.rank_position
        : null),
    // Carry the per-row pipeline time so the "Updated" clock shows the freshest
    // row, not the stale meta.snapshot_ts (dataUpdatedAt reads r.updated_at).
    // The X Dash bootstrap rows carry NO updated_at, so dataUpdatedAt was
    // falling back to a stale snapshot_ts (~indexation time) and the header read
    // "25d ago" while mentions were live. latest_mention_at / the board-gen time
    // are the real per-row freshness — use them so the clock is honest.
    updated_at: t.updated_at ?? item?.updated_at ?? m.updated_at
      ?? item?.latest_mention_at ?? item?.previous_board_generated_at ?? null,
    // Codex networkId for the on-chain OHLCV sparkline fallback (null = unknown
    // chain → we don't attempt a bars fetch rather than risk the wrong token).
    network_id: xbNetworkId(t),
    // price + sparkline + change are filled by the CG enrichment pass below
    price_usd: null,
    sparkline_7d: null,
    price_change_7d: null,
    price_change_24h: null,
  }
}

function useLeaderboard(ranking) {
  const [data, setData] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // The upstream's verdict on itself: 'ok', or 'updating' when the window we
  // asked for was never built. Drives the board notice instead of a filter
  // apology, and the window label everything mention-derived is stamped with.
  const [health, setHealth] = useState(null)
  const [boardWindow, setBoardWindow] = useState(xbActiveWindow())

  // Enrichment cache is MODULE-level (xbEnrichCache) and keyed by UPPERCASE
  // symbol — ranking-agnostic and persistent across remounts. The expensive
  // cascade (CoinGecko sparklines + DexScreener + Codex bars) writes the
  // price/sparkline it derives ONCE; every subsequent poll AND every ranking-tab
  // switch reuses it instead of re-running the cascade for the same symbols.

  // Stamp a row from the enrichment cache (no network). Returns the row.
  const applyEnrichment = useCallback((b) => {
    const c = xbEnrichCache.get(String(b.symbol || '').toUpperCase())
    if (c) {
      if (Array.isArray(c.sparkline_7d)) b.sparkline_7d = c.sparkline_7d
      if (Number.isFinite(c.price_change_7d)) b.price_change_7d = c.price_change_7d
      if (Number.isFinite(c.price_change_24h)) b.price_change_24h = c.price_change_24h
      if (Number.isFinite(c.price_usd)) b.price_usd = c.price_usd
    }
    return b
  }, [])

  // Persist whatever a row currently carries into the enrichment cache so the
  // next poll can reuse it. Only stores fields that actually resolved.
  const cacheRow = useCallback((b) => {
    const key = String(b.symbol || '').toUpperCase()
    if (!key) return
    const prev = xbEnrichCache.get(key) || {}
    xbEnrichCache.set(key, {
      sparkline_7d: Array.isArray(b.sparkline_7d) ? b.sparkline_7d : prev.sparkline_7d,
      price_change_7d: Number.isFinite(b.price_change_7d) ? b.price_change_7d : prev.price_change_7d,
      price_change_24h: Number.isFinite(b.price_change_24h) ? b.price_change_24h : prev.price_change_24h,
      price_usd: Number.isFinite(b.price_usd) ? b.price_usd : prev.price_usd,
    })
  }, [])

  // The expensive cascade. Runs ONLY on first load + manual refresh, and only
  // for rows that aren't already covered by the enrichment cache. `repaint`
  // re-paints the board (new array ref) as each tier fills in.
  const enrichRows = useCallback(async (rows, repaint) => {
    // mini-charts: enrich the visible set with a CoinGecko 7d sparkline +
    // price change by cg_id (the X Dash board carries no price series).
    try {
      const symToId = {}
      for (const b of rows.slice(0, XB_SPARK_LIMIT)) {
        const key = String(b.symbol || '').toUpperCase()
        if (b.symbol && b.cg_id && !xbEnrichCache.has(key)) symToId[b.symbol] = b.cg_id
      }
      if (Object.keys(symToId).length) {
        const cg = await getCoinGeckoPricesForSymbols(symToId)
        for (const b of rows) {
          const c = cg?.[String(b.symbol || '').toUpperCase()]
          if (c) {
            b.sparkline_7d = Array.isArray(c.sparkline_7d) ? c.sparkline_7d : b.sparkline_7d
            if (Number.isFinite(c.change7d)) b.price_change_7d = c.change7d
            if (Number.isFinite(c.change)) b.price_change_24h = c.change
            // the PRICE column was blank for EVERYONE — price_usd was never set.
            if (Number.isFinite(c.price) && c.price > 0) b.price_usd = c.price
            cacheRow(b)
          }
        }
        repaint()
      }
    } catch { /* sparklines are cosmetic — never block the board */ }

    // Live MCAP by CONTRACT — the bootstrap serves a FROZEN catalog market cap
    // for on-chain tokens (ANSEM read $90.9M while it was $221.7M live across its
    // pumpswap/meteora pools). DexScreener by contract is the authoritative live
    // mcap, keyed on the row's OWN address so no same-symbol clone can leak in.
    // Backfills price/24h-change from the same pull. Bounded to the loudest ~90.
    try {
      const withCa = rows
        .filter((b) => b.contract_address && String(b.contract_address).length > 25 && !String(b.contract_address).includes('::'))
        .slice(0, 90)
      let touched = false
      for (let i = 0; i < withCa.length; i += 30) {
        const batch = withCa.slice(i, i + 30)
        const res = await getDexScreenerTokens(batch.map((b) => b.contract_address)).catch(() => ({}))
        for (const b of batch) {
          const d = res[String(b.contract_address).toLowerCase()]
          if (!d) continue
          const mc = Number.isFinite(d.marketCap) && d.marketCap > 0 ? d.marketCap : null
          const p = Number.isFinite(d.price) && d.price > 0 ? d.price : null
          const ch = Number.isFinite(d.change24h) ? d.change24h : null
          if (mc) { b.market_cap_usd = mc; touched = true }
          if (p && b.price_usd == null) b.price_usd = p
          if (ch != null && !Number.isFinite(b.price_change_24h)) b.price_change_24h = ch
          if (mc || p) cacheRow(b)
        }
      }
      if (touched) repaint()
    } catch { /* live mcap is best-effort — never block the board */ }

    // DEX fallback for the brand-new memes CoinGecko doesn't list (JOTCHUA,
    // DROOLING, …) — DexScreener has them. SAFE matching only: the matched
    // pair's symbol must EXACTLY equal ours and clear a liquidity floor, so
    // we can never surface a wrong price on a finance surface. Best-effort,
    // bounded to the loudest ~24 missing, never blocks the board.
    try {
      const missing = rows.filter((b) => b.price_usd == null && b.symbol).slice(0, 24)
      if (missing.length) {
        await Promise.all(missing.map(async (b) => {
          try {
            const r = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(b.symbol)}`, { signal: AbortSignal.timeout(8000) })
            if (!r.ok) return
            const j = await r.json().catch(() => null)
            const sym = String(b.symbol).toUpperCase()
            const cand = (j?.pairs || [])
              .filter((p) => String(p?.baseToken?.symbol || '').toUpperCase() === sym && Number(p?.priceUsd) > 0 && Number(p?.liquidity?.usd || 0) >= 2000)
              .sort((x, y) => Number(y?.liquidity?.usd || 0) - Number(x?.liquidity?.usd || 0))[0]
            if (cand) {
              b.price_usd = Number(cand.priceUsd)
              const ch = Number(cand.priceChange?.h24)
              if (Number.isFinite(ch)) b.price_change_24h = ch
              cacheRow(b)
            }
          } catch { /* one token's lookup failing never matters */ }
        }))
        // re-paint with the DEX prices filled in (new ref so React re-renders)
        repaint()
      }
    } catch { /* DEX fallback is best-effort */ }

    // Codex 7d sparklines for the on-chain memes CoinGecko doesn't chart
    // (JOTCHUA, DROOLING, the buzzing long tail) — these had a PRICE from
    // DexScreener but a flat dashed line for "7D Price". /api/bars runs the
    // L4 cascade (Binance → Hetzner candles → GeckoTerminal → Codex) with KV
    // bucket caching, so it resolves on-chain OHLCV where CG has none — many
    // X Dash tokens are already in Spectre's candle store (cheap, pre-Codex).
    // Bounded to the loudest ~14 still-missing tokens with a known chain; 4h
    // bars over 7d (~42 points); best-effort, never blocks the board, and
    // never guesses a network (null network_id is skipped).
    try {
      const nowSec = Math.floor(Date.now() / 1000)
      const fromSec = nowSec - 7 * 24 * 3600
      const needBars = rows
        .filter((b) => !Array.isArray(b.sparkline_7d) && b.symbol && b.network_id)
        .slice(0, XB_CODEX_SPARK_CAP)
      if (needBars.length) {
        await Promise.all(needBars.map(async (b) => {
          try {
            const res = await codexGetBars(b.symbol, '240', fromSec, nowSec, b.network_id, b.cg_id || null)
            const series = (res?.getBars || [])
              .map((x) => Number(x.c))
              .filter((n) => Number.isFinite(n) && n > 0)
            if (series.length >= 2) {
              b.sparkline_7d = series
              if (!Number.isFinite(b.price_change_7d) && series[0] > 0) {
                b.price_change_7d = ((series[series.length - 1] - series[0]) / series[0]) * 100
              }
              cacheRow(b)
            }
          } catch { /* one token's bars failing never matters */ }
        }))
        repaint()
      }
    } catch { /* Codex sparkline fallback is best-effort */ }
  }, [cacheRow])

  // Commit rows to state ONLY when the value-signature changed. The 60s poll
  // hands us a fresh array every tick; without this guard `data` would change
  // reference each minute and re-render/re-layout every view even when nothing
  // visible moved. lastSig persists across polls in a ref.
  const lastSigRef = useRef('')
  const commit = useCallback((rows) => {
    const sig = xbRowsSig(rows)
    if (sig === lastSigRef.current) return
    lastSigRef.current = sig
    setData(rows.slice())
  }, [])

  // enrich = true on first load + manual refresh; false on the 60s poll (poll
  // refetches only the cheap bootstrap board and reuses cached enrichment).
  const buildMeta = useCallback((page, tf, hp) => ({
    token_count: page.token_count,
    mention_count: page.mention_count,
    generated_at: page.generated_at_utc || page.generated_at || null,
    snapshot_ts: page.generated_at_utc || page.generated_at || null,
    // Carried into the localStorage seed so a cold load knows which window its
    // rows describe before the first fetch resolves.
    window: tf || XB_TF_DEFAULT,
    health: hp || null,
  }), [])

  // Flatten a set of bootstrap pages into deduped board rows, reusing any cached
  // enrichment for each symbol.
  const buildRows = useCallback((pages, tf) => {
    const rows = []
    const seen = new Set()
    for (const p of pages) {
      if (!p) continue
      for (const r of (p.tokens || [])) {
        const b = xbMapRow(r, tf)
        if (!b.asset || seen.has(b.asset)) continue
        seen.add(b.asset)
        applyEnrichment(b)
        rows.push(b)
      }
    }
    return rows
  }, [applyEnrichment])

  const fetchData = useCallback(async (enrich = false) => {
    try {
      const rk = XB_RANK_MAP[ranking] || 'mentions'
      // X Dash board, paginated (REDMI: per_page capped at 50). All pages fire
      // in parallel, but we paint page 1 (the top-ranked, loudest tokens — the
      // biggest bubbles) the instant it lands instead of waiting on the slowest
      // of 4, then fill the long tail when the rest resolve.
      const loadPages = (tf) => Array.from({ length: XB_BOARD_PAGES }, (_, i) =>
        fetch(`/api/xdash/bootstrap?timeframe=${tf}&ranking=${rk}&segment=all&market=all&min_kols=0&page=${i + 1}&per_page=50`, { credentials: 'include',
          signal: AbortSignal.timeout(22000),
        })
          .then((r) => (r.ok ? r.text() : ''))
          .then((txt) => { try { return txt ? JSON.parse(txt) : null } catch { return null } })
          .catch(() => null),
      )

      // Always ASK for the default window. When it answers, this costs nothing
      // and the page is back on 24h the day the upstream rebuilds it — no
      // remembered window to go stale. When it was never built, page 1 says so
      // (window asked for ≠ window served, and empty) and we re-ask for the live
      // one rather than render its emptiness as a real result.
      let tf = XB_TF_DEFAULT
      let pagePromises = loadPages(tf)
      let firstPage = await pagePromises[0]
      let boardHealth = readXDashHealth(firstPage, tf, { errored: !firstPage })
      if (boardHealth.state === 'updating' && boardHealth.liveTimeframe && boardHealth.liveTimeframe !== tf) {
        tf = boardHealth.liveTimeframe
        pagePromises = loadPages(tf)
        firstPage = await pagePromises[0]
        boardHealth = readXDashHealth(firstPage, tf, { errored: !firstPage })
      }
      xbSetActiveWindow(tf)
      setBoardWindow(tf)
      // readXDashHealth mints a fresh object every call, and this runs on the
      // 60s poll — swapping in an equal-but-new object would re-render the page
      // shell every minute for nothing, which is exactly what `commit`'s
      // signature guard exists to prevent for the rows.
      setHealth((prev) => (
        prev && prev.state === boardHealth.state
          && prev.reason === boardHealth.reason
          && prev.liveTimeframe === boardHealth.liveTimeframe
          && prev.asOf === boardHealth.asOf
          ? prev
          : boardHealth
      ))

      // Phase 1 — paint the top page as soon as it arrives.
      if (firstPage) {
        const firstRows = buildRows([firstPage], tf)
        if (firstRows.length) {
          commit(firstRows)
          setMeta(buildMeta(firstPage, tf, boardHealth))
          setLoading(false)
        }
      }

      // Phase 2 — fold in the remaining pages.
      const restPages = await Promise.all(pagePromises.slice(1))
      const allPages = [firstPage, ...restPages]
      const first = allPages.find(Boolean)
      if (!first) throw new Error('board unavailable')

      const rows = buildRows(allPages, tf)
      if (rows.length) {
        const repaint = () => commit(rows)
        repaint()
        const meta = buildMeta(first, tf, boardHealth)
        setMeta(meta)
        // Persist for instant paint on the next cold load.
        xbWriteSeed(ranking, rows, meta)

        // Expensive enrichment ONLY on first load / manual refresh. On a poll we
        // already reused the cache above, so no outbound CG/DEX/Codex calls fire.
        if (enrich) {
          await enrichRows(rows, repaint)
          xbWriteSeed(ranking, rows, meta)   // re-persist with resolved prices
        }
      }
      setError(null)
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || 'Failed')
    } finally {
      setLoading(false)
    }
  }, [ranking, buildRows, buildMeta, enrichRows, commit])

  // Manual refresh re-runs the full enrichment cascade.
  const refetch = useCallback(() => fetchData(true), [fetchData])

  useEffect(() => {
    let cancelled = false
    // Instant paint from the persisted seed (if fresh) so a cold load shows the
    // board immediately instead of the shimmer; the fetch below then revalidates.
    const seed = xbReadSeed(ranking)
    if (seed) {
      commit(seed.rows)
      if (seed.meta) {
        setMeta(seed.meta)
        // The seeded rows were mapped against THAT window — adopt it so the
        // labels and the window-scoped mention feeds agree with what is painted
        // until the revalidate below re-resolves it.
        if (seed.meta.window) { xbSetActiveWindow(seed.meta.window); setBoardWindow(seed.meta.window) }
      }
      setLoading(false)
    } else {
      setLoading(true)
    }
    fetchData(true) // first load enriches
    const interval = setInterval(() => {
      // bootstrap-only poll; skip on hidden or idle tabs.
      if (document.hidden || !isAppActive() || cancelled) return
      fetchData(false)
    }, 60_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [fetchData, ranking, commit])

  return { data, meta, loading, error, refetch, health, boardWindow }
}

function useTokenDetail(asset) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!asset) { setData(null); return }
    let cancelled = false
    setLoading(true)
    fetch(`/api/x-bubbles/${encodeURIComponent(asset)}`, { signal: AbortSignal.timeout(15000) })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setData(j?.data || null) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [asset])

  return { detail: data, loading }
}

/* ── X Dash mentions (avatar-rich) ────────────────────────────────────────────
 * The /v1/social/x-bubbles token detail returns tweets WITHOUT author avatars or
 * handles (author.avatar === null). The X Dash service token endpoint DOES carry
 * them (author.avatar_image_url + screen_name + followers), so Top Mentions are
 * sourced from there, keyed on the selected token's coingecko_id.
 */
function upsizeAvatar(url) {
  if (!url) return url
  // pbs.twimg.com serves a tiny 48px "_normal" variant; request the crisp one.
  return url.replace(/_normal\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i, '_400x400.$1$2')
}

function normXdashMention(m) {
  const tw = m?.tweet || m || {}
  const au = m?.author || tw.author || {}
  return {
    tweet_id: tw.tweet_id || m?.tweet_id,
    full_text: tw.full_text || tw.text || '',
    url: tw.x_url || tw.url || (tw.tweet_id ? `https://x.com/i/status/${tw.tweet_id}` : '#'),
    author: {
      name: au.name || au.screen_name || null,
      handle: au.screen_name || au.handle || null,
      avatar: upsizeAvatar(au.avatar_image_url || au.avatar || au.profile_image_url || null),
      followers: au.followers_count ?? au.followers ?? null,
      verified: !!(au.is_blue_verified || au.legacy_verified || au.verified),
    },
    metrics: {
      likes: tw.favorite_count ?? tw.like_count ?? null,
      retweets: tw.retweet_count ?? null,
      replies: tw.reply_count ?? null,
      quotes: tw.quote_count ?? null,
    },
    // kept for the Top Mentions sort toggle (impact vs recency)
    created_at: tw.created_at_utc || tw.created_at || tw.tweet_created_at || null,
  }
}

/* ── Token mentions ───────────────────────────────────────────────────────────
 * /api/xdash/token/:cg_id is PAGINATED (default per_page 24). One page is enough
 * for the side panel because the backend already returns two globally-correct
 * orderings, so we never treat a page's length as the total:
 *   - top_mentions : curated most-impactful across the whole window
 *   - mentions     : the full feed, newest-first (so page 1 = the most recent)
 * The displayed total comes from the metrics, NOT mentions.length.
 * This endpoint is window-scoped exactly like the board (asking it for a window
 * the upstream never built returns an empty `mentions` array), so it follows the
 * window the board resolved rather than a hardcoded 24h. */
function useTokenMentions(cgId) {
  const [state, setState] = useState({ top: [], recent: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const tf = xbActiveWindow()

  useEffect(() => {
    if (!cgId) { setState({ top: [], recent: [], total: 0 }); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    fetch(`/api/xdash/token/${encodeURIComponent(cgId)}?timeframe=${tf}&page=1&per_page=50`, { credentials: 'include', signal: AbortSignal.timeout(20000) })
      .then(async (r) => { const t = await r.text(); try { return t ? JSON.parse(t) : null } catch { return null } })
      .then((j) => {
        if (cancelled) return
        const norm = (arr) => (Array.isArray(arr) ? arr.map(normXdashMention).filter((mm) => mm.full_text) : [])
        const top = norm(j?.top_mentions || j?.data?.top_mentions)
        // The feed arrives newest-first; sort defensively so 'Recent' is exact.
        const recent = norm(j?.mentions || j?.data?.mentions)
          .sort((a, b) => (a.created_at && b.created_at ? new Date(b.created_at) - new Date(a.created_at) : 0))
        // Same split as xbMapRow: the `*_24h` metrics are zeroed outside the
        // 24h document, so off that window the count lives in the unsuffixed
        // field. `??` alone would have taken the literal 0 and shown "0 mentions"
        // above a list of tweets.
        const mm = j?.metrics || {}
        const total = Number(
          (tf === '24h' ? (mm.external_mentions_24h ?? mm.mentions_24h) : null)
          ?? mm.external_mentions ?? j?.pagination?.filtered_count ?? 0,
        ) || 0
        setState({ top, recent, total })
      })
      .catch(() => { if (!cancelled) setState({ top: [], recent: [], total: 0 }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [cgId, tf])

  return { ...state, loading }
}

function useStageSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [ref])
  return size
}

/* ── MetricCard ──────────────────────────────────────────────────────────── */
function MetricCard({ label, value, delta, accent, sparkData, sparkColor, info, tip: tipOverride }) {
  const tip = tipOverride || getMetricInfo(info)
  return (
    <div className="xb-mcard">
      <div className="xb-mcard-label mono">{label}{tip && <InfoTip text={tip} position="right" />}</div>
      <div className="xb-mcard-value mono" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {delta != null && (
        <div className="xb-mcard-delta mono" style={{ color: delta >= 0 ? '#5CE6A1' : '#FF6E8E' }}>
          {delta >= 0 ? '+' : ''}{typeof delta === 'number' ? `${delta.toFixed(1)}%` : delta}
        </div>
      )}
      {sparkData && sparkData.length >= 2 && (
        <div className="xb-mcard-spark">
          <Sparkline data={sparkData} width={120} height={28} color={sparkColor || '#5CE6A1'} strokeWidth={1.2} filled />
        </div>
      )}
    </div>
  )
}

/* ── BubbleMap (SVG d3 pack, glassmorphic orbs) ──────────────────────────── */
const BubbleMap = React.memo(function BubbleMap({ tokens, totalMentions, width, height, selected, onSelect }) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef(null)
  // rAF-coalesced pan: dragging fired setPan per mousemove pixel, re-rendering a
  // ~200-node SVG every event. Now at most one update per frame, latest position.
  const panRafRef = useRef(null)
  const pendingPanRef = useRef(null)

  // The pack LAYOUT only depends on asset + mentions_24h + stage size, but each
  // node carries its token object, which the view renders growth_pct from. Key on
  // a signature of every rendered field so identical 60s polls (fresh array ref,
  // same data) skip the pack pass, while ANY real change (mentions, growth)
  // recomputes and the orbs reflect it.
  const layoutSig = tokens.map((t) => `${t.asset}:${t.mentions_24h || 0}:${t.growth_pct ?? ''}:${t.image || ''}`).join('|')
  const nodes = useMemo(() => {
    if (!tokens.length || width <= 0 || height <= 0) return []
    const root = hierarchy({ name: 'root', children: tokens })
      .sum((d) => Math.sqrt(Math.max(d.mentions_24h || 0, 1)) + 4)
      .sort((a, b) => (b.value || 0) - (a.value || 0))
    d3pack().size([width, height]).padding(5)(root)
    return root.leaves().map((leaf) => ({
      asset: leaf.data.asset,
      token: leaf.data,
      x: leaf.x,
      y: leaf.y,
      r: leaf.r,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutSig, width, height])

  const handleWheel = useCallback((e) => {
    e.preventDefault()
    setZoom((z) => Math.max(0.4, Math.min(4, z * (e.deltaY < 0 ? 1.12 : 0.88))))
  }, [])

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    dragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y, moved: false }
  }, [pan])

  const handleMouseMove = useCallback((e) => {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.x
    const dy = e.clientY - dragRef.current.y
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragRef.current.moved = true
    pendingPanRef.current = { x: dragRef.current.panX + dx, y: dragRef.current.panY + dy }
    if (panRafRef.current != null) return // coalesce to one state update per frame
    panRafRef.current = requestAnimationFrame(() => {
      panRafRef.current = null
      if (pendingPanRef.current) setPan(pendingPanRef.current)
    })
  }, [])

  const handleMouseUp = useCallback(() => {
    dragRef.current = null
    if (panRafRef.current != null) { cancelAnimationFrame(panRafRef.current); panRafRef.current = null }
  }, [])

  // touch: one finger pans, two fingers pinch-zoom. Mobile previously had NO
  // touch navigation at all (mouse handlers only) — the map read as frozen.
  // CSS touch-action:none on the wrap keeps page scroll from fighting it.
  const touchRef = useRef(null)
  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 2) {
      const [a, b] = e.touches
      touchRef.current = { mode: 'pinch', d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), zoom0: zoom }
    } else if (e.touches.length === 1) {
      const t = e.touches[0]
      touchRef.current = { mode: 'pan', x: t.clientX, y: t.clientY, panX: pan.x, panY: pan.y }
    }
  }, [pan, zoom])

  const handleTouchMove = useCallback((e) => {
    const st = touchRef.current
    if (!st) return
    if (st.mode === 'pan' && e.touches.length === 1) {
      const t = e.touches[0]
      pendingPanRef.current = { x: st.panX + (t.clientX - st.x), y: st.panY + (t.clientY - st.y) }
      if (panRafRef.current != null) return // coalesce to one update per frame
      panRafRef.current = requestAnimationFrame(() => {
        panRafRef.current = null
        if (pendingPanRef.current) setPan(pendingPanRef.current)
      })
    } else if (st.mode === 'pinch' && e.touches.length === 2) {
      const [a, b] = e.touches
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      if (st.d0 > 0) setZoom(Math.max(0.4, Math.min(4, st.zoom0 * (d / st.d0))))
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    touchRef.current = null
    if (panRafRef.current != null) { cancelAnimationFrame(panRafRef.current); panRafRef.current = null }
  }, [])

  return (
    <div
      className="xb-bubble-wrap"
      style={{ cursor: dragRef.current ? 'grabbing' : 'grab' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* ambient glow */}
      <span className="xb-bubble-bg" />

      <svg width={width} height={height} className="xb-bubble-svg">
        <defs>
          {BUCKETS.map((b) => (
            <React.Fragment key={b.id}>
              <radialGradient id={`xb-glow-${b.id}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={b.accent} stopOpacity="0.6" />
                <stop offset="55%" stopColor={b.accent} stopOpacity="0.18" />
                <stop offset="100%" stopColor={b.accent} stopOpacity="0" />
              </radialGradient>
              <radialGradient id={`xb-orb-${b.id}`} cx="35%" cy="28%" r="78%">
                <stop offset="0%" stopColor={b.accent} stopOpacity="0.5" />
                <stop offset="38%" stopColor={b.accent} stopOpacity="0.14" />
                <stop offset="100%" stopColor="#0a0a0e" stopOpacity="0.92" />
              </radialGradient>
            </React.Fragment>
          ))}
          <radialGradient id="xb-spec" cx="30%" cy="20%" r="30%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.48" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {nodes.map((n, idx) => {
            const msPct = totalMentions > 0 ? ((n.token.mentions_24h || 0) / totalMentions) * 100 : 0
            const bucket = bucketFor(msPct)
            const tone = growthTone(xbMomentum(n.token).value)
            const active = selected === n.asset
            const rank = idx + 1

            // tier: hero / lg / md / sm / dot
            const tier = n.r >= 62 ? 'hero' : n.r >= 40 ? 'lg' : n.r >= 24 ? 'md' : n.r >= 14 ? 'sm' : 'dot'

            return (
              <g
                key={n.asset}
                className={`xb-node${active ? ' is-active' : ''}`}
                transform={`translate(${n.x}, ${n.y})`}
                onClick={(e) => { if (dragRef.current?.moved) return; e.stopPropagation(); onSelect(n.asset) }}
              >
                {/* outer glow — NO feGaussianBlur here: blurring an already-
                    smooth radial gradient reads identical, but 200 SVG filter
                    nodes made every pan/zoom frame rasterize 200 blurs (the
                    mobile lag) */}
                <circle r={n.r * 1.4} fill={`url(#xb-glow-${bucket.id})`} opacity={active ? 1 : 0.6} style={{ pointerEvents: 'none' }} />
                {/* glass orb */}
                <circle r={n.r} fill={`url(#xb-orb-${bucket.id})`} stroke={bucket.accent} strokeWidth={active ? 2.5 : 1.2} strokeOpacity={active ? 1 : 0.5} />
                {/* specular */}
                <circle r={n.r * 0.9} fill="url(#xb-spec)" style={{ pointerEvents: 'none' }} />

                {/* logo (image, or a branded initial when the token has no logo) */}
                {tier !== 'dot' && (
                  n.token.image ? (
                    <>
                      <clipPath id={`xb-cl-${n.asset}`}><circle r={n.r * 0.52} /></clipPath>
                      <image
                        href={proxiedLogo(n.token.image)}
                        x={-n.r * 0.52} y={-n.r * 0.52}
                        width={n.r * 1.04} height={n.r * 1.04}
                        clipPath={`url(#xb-cl-${n.asset})`}
                        preserveAspectRatio="xMidYMid slice"
                        style={{ pointerEvents: 'none' }}
                      />
                    </>
                  ) : (
                    <text
                      textAnchor="middle" dy={n.r * 0.2}
                      fill="rgba(255,255,255,0.9)" fontSize={n.r * 0.62} fontWeight="800"
                      style={{ pointerEvents: 'none' }}
                    >
                      {tokenInitial(n.token.asset)}
                    </text>
                  )
                )}

                {/* rank badge (top 10) — md+ only: on sm orbs (r 14-24) the
                    9px badge poked past the rim onto neighbouring bubbles */}
                {rank <= 10 && n.r >= 24 && (
                  <>
                    <circle cx={n.r * 0.62} cy={-n.r * 0.62} r={9} fill="#0c0c10" stroke={bucket.accent} strokeWidth="1.5" />
                    <text x={n.r * 0.62} y={-n.r * 0.62} textAnchor="middle" dy="3.5" fill="#fff" fontSize="9" fontWeight="700" style={{ pointerEvents: 'none' }}>
                      {rank}
                    </text>
                  </>
                )}

                {/* text content based on tier */}
                {tier === 'hero' && (
                  <>
                    <text textAnchor="middle" dy={n.r * 0.72} fill="#fff" fontSize="13" fontWeight="700" style={{ pointerEvents: 'none' }}>
                      {n.token.asset}
                    </text>
                    <text textAnchor="middle" dy={n.r * 0.92} fill={tone.color} fontSize="11" fontWeight="600" className="mono" style={{ pointerEvents: 'none' }}>
                      {fmtMomentum(n.token)}
                    </text>
                  </>
                )}
                {tier === 'lg' && (
                  <text textAnchor="middle" dy={n.r * 0.78} fill="#fff" fontSize="12" fontWeight="700" style={{ pointerEvents: 'none' }}>
                    {n.token.asset}
                  </text>
                )}
                {/* md ticker sits INSIDE the orb (like lg) — at dy=r+14 it
                    landed in the 5px pack gutter, printing across the bubble
                    below (the tag-overlap bug) */}
                {tier === 'md' && n.r >= 28 && (
                  <text textAnchor="middle" dy={n.r * 0.78} fill="rgba(255,255,255,0.85)" fontSize="10" fontWeight="600" style={{ pointerEvents: 'none' }}>
                    {n.token.asset}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      {/* zoom controls */}
      <div className="xb-zoom">
        <button type="button" className="xb-zoom-btn" onClick={() => setZoom((z) => Math.min(4, z * 1.25))}>+</button>
        <span className="xb-zoom-level mono">{Math.round(zoom * 100)}%</span>
        <button type="button" className="xb-zoom-btn" onClick={() => setZoom((z) => Math.max(0.4, z / 1.25))}>−</button>
        <button type="button" className="xb-zoom-btn" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>⟲</button>
      </div>
    </div>
  )
})

/* ── TreemapView ─────────────────────────────────────────────────────────── */
const TreemapView = React.memo(function TreemapView({ tokens, totalMentions, width, height, selected, onSelect }) {
  // Layout depends on asset + mentions_24h + stage size; each cell also carries
  // its token, from which the view renders growth_pct, market_cap_usd, image.
  // Sign on every rendered field so identical polls skip the relayout but any
  // real change recomputes (same pattern as BubbleMap).
  const layoutSig = tokens.map((t) => `${t.asset}:${t.mentions_24h || 0}:${t.growth_pct ?? ''}:${t.market_cap_usd ?? ''}:${t.image || ''}`).join('|')
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutSig, width, height])

  return (
    <div className="xb-treemap" style={{ width, height }}>
      {cells.map(({ token, x, y, w, h }) => {
        const active = selected === token.asset
        const small = Math.min(w, h)
        const area = w * h
        const tone = growthTone(xbMomentum(token).value)
        const msPct = totalMentions > 0 ? ((token.mentions_24h || 0) / totalMentions) * 100 : 0
        const bucket = bucketFor(msPct)
        const tier = area >= 32000 ? 'lg' : area >= 11000 ? 'md' : area >= 3200 ? 'sm' : 'xs'
        const logoSize = Math.max(22, Math.min(64, Math.floor(small * 0.24)))
        const tickerSize = Math.max(13, Math.min(34, Math.floor(small * 0.16)))
        const nameSize = Math.max(10, Math.min(15, Math.floor(small * 0.075)))
        const pctSize = Math.max(13, Math.min(40, Math.floor(small * 0.20)))
        const deltaSize = Math.max(9, Math.min(14, Math.floor(small * 0.078)))

        return (
          <button
            key={token.asset} type="button"
            className={`xb-cell xb-cell-${tier}${active ? ' is-active' : ''}`}
            onClick={() => onSelect(token.asset)}
            style={{
              left: x, top: y, width: w, height: h,
              background: bucket.bg,
              borderColor: active ? bucket.accent : 'rgba(255,255,255,0.06)',
              boxShadow: active ? `0 0 0 2px ${bucket.accent}, 0 18px 60px ${bucket.glow}` : 'inset 0 1px 0 rgba(255,255,255,0.06)',
            }}
          >
            <span className="xb-cell-halo" aria-hidden style={{ background: `radial-gradient(circle at 22% 26%, ${bucket.glow} 0%, transparent 55%)` }} />
            {tier !== 'xs' ? (
              <span className="xb-cell-card">
                <span className="xb-cell-card-top">
                  <span className="xb-cell-logo-wrap" style={{ width: logoSize, height: logoSize, boxShadow: `0 0 24px ${bucket.glow}` }}>
                    <TokenLogoImg className="xb-cell-logo" src={token.image} symbol={token.asset} size={logoSize} />
                  </span>
                  <span className="xb-cell-id">
                    <span className="xb-cell-ticker mono" style={{ fontSize: tickerSize }}>{token.asset}</span>
                    {tier !== 'sm' && <span className="xb-cell-name" style={{ fontSize: nameSize }}>{token.name || token.asset}</span>}
                  </span>
                </span>
                <span className="xb-cell-card-bot">
                  <span className="xb-cell-pct mono" style={{ fontSize: pctSize }}>
                    {msPct >= 0.1 ? `${msPct.toFixed(1)}%` : '<0.1%'}
                  </span>
                  <span className="xb-cell-delta mono" style={{ fontSize: deltaSize, color: tone.color }}>
                    {tone.arrow && <span className="xb-cell-delta-arrow" aria-hidden>{tone.arrow}</span>}
                    {fmtMomentum(token)}
                  </span>
                  {tier !== 'sm' && (
                    <span className="xb-cell-meta mono" style={{ fontSize: deltaSize }}>
                      {fmtCount(token.mentions_24h)} mentions{token.market_cap_usd ? ` · ${fmtMC(token.market_cap_usd)} MC` : ''}
                    </span>
                  )}
                </span>
              </span>
            ) : (
              <span className="xb-cell-xs-content">
                <TokenLogoImg className="xb-cell-logo-mini" src={token.image} symbol={token.asset} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
})

/* ── BarRow (memo'd leaderboard row) ─────────────────────────────────────────
 * One row per token. Memo'd so the up-to-200 rows + their inline Sparkline SVG
 * don't all rebuild on every 60s poll — only rows whose rendered fields actually
 * changed re-render. `onSelect` is a stable setState ref from the page, so it
 * doesn't break the memo. `rank` (i+1) is passed so position changes re-render.
 */
const BarRow = React.memo(function BarRow({ t, rank, max, totalMentions, isActive, onSelect }) {
  const mentions = t.mentions_24h || 0
  const isInactive = mentions <= 1
  const msPct = totalMentions > 0 ? (mentions / totalMentions) * 100 : 0
  const bucket = bucketFor(msPct)
  const fillPct = isInactive ? 0 : (mentions / max) * 100
  const tone = growthTone(xbMomentum(t).value)
  const priceUp = (t.price_change_24h ?? 0) >= 0
  return (
    <button type="button" className={`xb-bars-row${isActive ? ' is-active' : ''}${isInactive ? ' is-inactive' : ''}`} onClick={() => onSelect(t.asset)}>
      <span className="xb-bars-rank mono">{rank}</span>
      <span className="xb-bars-token">
        <TokenLogoImg className="xb-bars-logo" src={t.image} symbol={t.asset} size={26} />
        <span className="xb-bars-id">
          <span className="xb-bars-ticker mono">{t.asset}</span>
          <span className="xb-bars-name">{t.name}</span>
        </span>
      </span>
      <span className="xb-bars-bar">
        {!isInactive && (
          <span className="xb-bars-bar-fill" style={{ width: `${fillPct}%`, background: `linear-gradient(90deg, ${bucket.accent}cc, ${bucket.accent}66)`, boxShadow: `0 0 12px ${bucket.glow}` }} />
        )}
        <span className="xb-bars-bar-text mono">
          {isInactive ? <span className="xb-bars-bar-quiet">—</span> : fmtCount(mentions)}
          {!isInactive && <span className="xb-bars-bar-sub"> {msPct >= 0.1 ? `${msPct.toFixed(2)}%` : '<0.1%'}</span>}
        </span>
      </span>
      <span className="xb-bars-spark">
        {t.sparkline_7d && t.sparkline_7d.length >= 2
          ? <Sparkline data={t.sparkline_7d} width={120} height={28} color={(t.price_change_7d ?? t.price_change_24h ?? 0) >= 0 ? '#5CE6A1' : '#FF6E8E'} />
          : (
            /* no CoinGecko price feed for this token — a flat baseline reads
               as "no price data", not a broken/blank cell. */
            <svg className="xb-bars-spark-flat" width="120" height="28" viewBox="0 0 120 28" aria-hidden="true">
              <line x1="2" y1="14" x2="118" y2="14" strokeWidth="1.2" strokeDasharray="2 4" strokeLinecap="round" />
            </svg>
          )}
      </span>
      <span className="xb-bars-price">
        <span className="xb-bars-price-val mono">{t.price_usd != null ? fmtPrice(t.price_usd) : '—'}</span>
        {t.price_change_24h != null && <span className="xb-bars-price-delta mono" style={{ color: priceUp ? '#5CE6A1' : '#FF6E8E' }}>{priceUp ? '+' : ''}{t.price_change_24h.toFixed(2)}%</span>}
      </span>
      <span className="xb-bars-growth mono" style={{ color: tone.color }}>{tone.arrow ? `${tone.arrow} ` : ''}{fmtMomentum(t)}</span>
      <span className="xb-bars-mc mono">{t.market_cap_usd ? fmtMC(t.market_cap_usd) : '—'}</span>
    </button>
  )
}, (prev, next) => (
  // Re-render only when a RENDERED field changes. The poll hands back fresh token
  // object refs every 60s; comparing the actual values lets identical polls skip.
  prev.rank === next.rank &&
  prev.max === next.max &&
  prev.totalMentions === next.totalMentions &&
  prev.isActive === next.isActive &&
  prev.onSelect === next.onSelect &&
  prev.t.asset === next.t.asset &&
  prev.t.mentions_24h === next.t.mentions_24h &&
  prev.t.growth_pct === next.t.growth_pct &&
  prev.t.rank_change === next.t.rank_change &&
  prev.t.price_usd === next.t.price_usd &&
  prev.t.price_change_24h === next.t.price_change_24h &&
  prev.t.price_change_7d === next.t.price_change_7d &&
  prev.t.market_cap_usd === next.t.market_cap_usd &&
  prev.t.image === next.t.image &&
  prev.t.name === next.t.name &&
  prev.t.sparkline_7d === next.t.sparkline_7d
))

/* ── BarsView ────────────────────────────────────────────────────────────── */
const BarsView = React.memo(function BarsView({ tokens, totalMentions, selected, onSelect, momentumKind }) {
  const max = useMemo(() => Math.max(...tokens.map((t) => t.mentions_24h || 0), 1), [tokens])
  return (
    <div className="xb-bars">
      <div className="xb-bars-head mono">
        <span>#</span>
        <span>Token</span>
        <span>Mentions / Mindshare<InfoTip text={getMetricInfo('xiMindshare')} position="top" /></span>
        <span className="xb-bars-spark-h">7D Price</span>
        <span>Price · 24H</span>
        {/* The column is measured in positions when the mention-rate is not
            published, so it says so rather than labelling positions "Growth". */}
        <span>
          {momentumKind === 'rank' ? 'Rank Δ' : 'Growth'}
          <InfoTip text={momentumKind === 'rank' ? XB_RANK_TIPS.growth : getMetricInfo('xiGrowth')} position="top" />
        </span>
        <span className="xb-bars-mc-h">MC</span>
      </div>
      <div className="xb-bars-body">
        {tokens.map((t, i) => (
          <BarRow
            key={t.asset}
            t={t}
            rank={i + 1}
            max={max}
            totalMentions={totalMentions}
            isActive={selected === t.asset}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
})

/* ── TokenLogoImg ─────────────────────────────────────────────────────────────
 * Token logos: render the image (lazy + async-decode), and on missing/failed
 * image fall back to a branded letter chip - so a token without a CoinGecko logo
 * (most long-tail X tokens) shows its initial instead of an empty hole.
 */
function tokenInitial(symbol) {
  return (symbol || '?').replace(/^\$/, '').slice(0, 1).toUpperCase()
}

// Serve token logos through the app's edge-cached image proxy (Vercel fra1,
// 24h cache) so they load fast - especially repeat views - instead of hitting
// the CoinGecko origin each time. Only absolute https URLs; onError still falls
// back to the letter chip if the proxy ever fails.
function proxiedLogo(url) {
  if (!url || typeof url !== 'string') return url
  if (!/^https:\/\//i.test(url) || url.includes('/api/img-proxy')) return url
  return `/api/img-proxy?url=${encodeURIComponent(url)}`
}

const TokenLogoImg = React.memo(TokenLogoImgBase)
function TokenLogoImgBase({ src, symbol, className, size, round = true }) {
  const [failed, setFailed] = useState(false)
  if (src && !failed) {
    return (
      <img
        className={className}
        src={proxiedLogo(src)}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <span
      className={className}
      aria-hidden
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: size || '100%', height: size || '100%',
        background: 'linear-gradient(160deg, rgba(255,255,255,0.12), rgba(255,255,255,0.03))',
        color: 'rgba(255,255,255,0.82)', fontWeight: 800,
        fontSize: size ? Math.round(size * 0.46) : '46%',
        borderRadius: round ? '50%' : '8px', lineHeight: 1, overflow: 'hidden',
      }}
    >{tokenInitial(symbol)}</span>
  )
}

/* ── TweetAvatar ─────────────────────────────────────────────────────────────
 * Twitter profile images (pbs.twimg.com) need referrerPolicy="no-referrer" to
 * load cross-origin reliably, and fall back to initials on error/expiry.
 */
function TweetAvatar({ src, initials }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <span className="xb-tw-avatar xb-tw-avatar-fb">{initials}</span>
  return (
    <img
      className="xb-tw-avatar"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

/* ── TweetCard ───────────────────────────────────────────────────────────── */
const TweetCard = React.memo(TweetCardBase)
function TweetCardBase({ tweet }) {
  const a = tweet.author || {}
  const initials = (a.name || a.handle || '?').slice(0, 1).toUpperCase()
  const text = tweet.full_text || ''
  const truncated = text.length > 280 ? `${text.slice(0, 280)}…` : text
  return (
    <a className="xb-tw" href={tweet.url || '#'} target="_blank" rel="noreferrer">
      <div className="xb-tw-head">
        <TweetAvatar src={a.avatar} initials={initials} />
        <div className="xb-tw-author">
          <span className="xb-tw-name">{a.name || a.handle || 'Anonymous'}</span>
          {a.handle && <span className="xb-tw-handle">@{a.handle}</span>}
        </div>
      </div>
      <div className="xb-tw-text">{truncated}</div>
      <div className="xb-tw-stats mono">
        {tweet.metrics?.likes != null && <span>♥ {fmtCount(tweet.metrics.likes)}</span>}
        {tweet.metrics?.retweets != null && <span>↻ {fmtCount(tweet.metrics.retweets)}</span>}
        {tweet.metrics?.replies != null && <span>↩ {fmtCount(tweet.metrics.replies)}</span>}
        {a.followers != null && <span className="xb-tw-followers">{fmtCount(a.followers)} followers</span>}
      </div>
    </a>
  )
}

/* ── RightPanel ──────────────────────────────────────────────────────────── */
const RightPanel = React.memo(RightPanelBase)
function RightPanelBase({ selectedToken, topMovers, onPick, windowLabel = '24H', hasMomentum = true }) {
  const { detail, loading } = useTokenDetail(selectedToken?.cg_id)
  const navigate = useNavigate()
  const { selectToken, setResearchZoneToken } = useAppState()
  const { triggerCopyToast } = useCopyToast()
  // Top Mentions come from the X Dash service (avatar-rich), keyed on the
  // selected token's coingecko_id. `asset` is now the ticker, so use the row's
  // cg_id directly (falling back to the detail's coingecko_id) so the avatar-rich
  // tweets load reliably instead of showing "No fresh tweets cached".
  const { top: topMentions, recent: recentMentions, total: mentionTotal, loading: mentionsLoading } = useTokenMentions(selectedToken?.cg_id || detail?.coingecko_id)
  // Top Mentions view: 'top' (curated impactful) by default, or 'recent' (newest).
  const [mentionSort, setMentionSort] = useState('top')

  // Movers list (no selection)
  if (!selectedToken) {
    return (
      <div className="xb-rp">
        <div className="xb-rp-header">
          {/* Ranked by momentum when there is momentum; by volume of talk when
              there is not. The title is whichever one it actually is. */}
          <span className="xb-rp-title mono">{hasMomentum ? `Top Movers · ${windowLabel}` : `Most Discussed · ${windowLabel}`}</span>
          <span className="xb-rp-live-dot" />
        </div>
        <div className="xb-mv-list">
          {topMovers.slice(0, 20).map((t, i) => {
            const acc = accentOf(xbMomentum(t).value)
            return (
              <button key={t.asset} className="xb-mv" onClick={() => onPick(t.asset)} type="button">
                <span className="xb-mv-rank mono">{i + 1}</span>
                <TokenLogoImg className="xb-mv-logo" src={t.image} symbol={t.asset} />
                <span className="xb-mv-meta">
                  <span className="xb-mv-sym mono">{t.asset}</span>
                  <span className="xb-mv-name">{t.name}</span>
                </span>
                <span className="xb-mv-growth mono" style={{ color: acc }}>
                  {hasMomentum ? fmtMomentum(t) : fmtCount(t.mentions_24h)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // Detail view
  const heat = HEAT[detail?.metrics?.color || selectedToken.color] || HEAT.neutral
  const name = detail?.name || selectedToken.name
  const image = detail?.image || selectedToken.image

  /* Copy CA + open-chart - parity with the X Dash drawer, so this panel isn't
     just X posts. On-chain tokens (with a contract) open the AI Screener by
     contract (the exact token); otherwise Research Zone by identity. */
  const address = String(detail?.contract_address || selectedToken.contract_address || '').trim()
  const cgId = selectedToken.cg_id || detail?.coingecko_id || null
  const chartSym = selectedToken.symbol || selectedToken.asset || ''
  const shortCa = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : ''
  const copyCa = () => {
    if (!address) return
    try { navigator.clipboard?.writeText(address); triggerCopyToast('Contract copied') } catch { /* clipboard blocked */ }
  }
  const openChart = () => {
    const tokenData = {
      symbol: chartSym,
      name: name || chartSym,
      cgId,
      address: address || '',
      networkId: selectedToken.network_id || undefined,
      logo: image || null,
      marketCap: selectedToken.market_cap_usd || null,
    }
    if (address) {
      selectToken(tokenData)
      navigate(getPathForPageId('ai-screener'))
      return
    }
    if (!cgId && !chartSym) return
    setResearchZoneToken?.(tokenData)
    navigate(buildResearchZoneLocation(tokenData, false))
  }
  const m = detail?.metrics
  // `detail` is the thin /api/x-bubbles feed, and its mentions_24h is a hard 0
  // while the 24h window is the one that was never built. `??` takes a literal 0
  // happily, so this slot printed "0" directly above a list of 636 real tweets.
  // The window-scoped total we already fetched for this token is the honest
  // number; the board row backs it up, and the thin feed only speaks last.
  const mentions = mentionTotal || selectedToken.mentions_24h || m?.mentions_24h || null
  const avg = m?.mentions_7d_avg ?? selectedToken.mentions_7d_avg
  // The board row's momentum first (it is the one the whole page is coloured by);
  // the thin feed's percentage only when the board has none, since mixing the two
  // would answer a different question than the rest of this panel.
  const rowMomentum = xbMomentum(selectedToken)
  const growthText = rowMomentum.value != null
    ? fmtMomentum(selectedToken)
    : fmtPct(m?.growth_pct ?? null)
  const growthTint = accentOf(rowMomentum.value ?? m?.growth_pct ?? null)
  // Pick the backend-ordered list for the active mode (Top falls back to the
  // recent feed if nothing was curated), then the base detail tweets as a last
  // resort. No client-side total is derived from these arrays.
  const hasMentions = topMentions.length > 0 || recentMentions.length > 0
  const xList = mentionSort === 'recent'
    ? recentMentions
    : (topMentions.length ? topMentions : recentMentions)
  const tweets = xList.length ? xList : (detail?.tweets || [])
  const tweetsLoading = loading || mentionsLoading

  return (
    <div className="xb-rp">
      {/* detail header */}
      <div className="xb-rp-detail-head">
        <span className="xb-rp-glow" style={{ background: `radial-gradient(60% 100% at 25% 0%, ${heat.glow} 0%, transparent 75%)` }} />
        <div className="xb-rp-detail-row">
          <TokenLogoImg className="xb-rp-logo" src={image} symbol={selectedToken.asset} />
          <div className="xb-rp-id">
            <div className="xb-rp-sym-row">
              <span className="xb-rp-sym mono">{selectedToken.asset}</span>
              {detail?.rank && <span className="xb-rp-rank mono">#{detail.rank}</span>}
            </div>
            <div className="xb-rp-name">{name}</div>
          </div>
          <button type="button" className="xb-rp-close" onClick={() => onPick(null)} title="Close">✕</button>
        </div>
        {(detail?.categories || selectedToken.categories || []).length > 0 && (
          <div className="xb-rp-tags">
            {(detail?.categories || selectedToken.categories).slice(0, 3).map((c) => (
              <span key={c} className="xb-rp-tag">{c}</span>
            ))}
          </div>
        )}
      </div>

      {/* metrics */}
      <div className="xb-rp-metrics">
        <div className="xb-rp-metric">
          <div className="xb-rp-metric-label mono">Mentions {windowLabel}<InfoTip text={getMetricInfo('mentions24h')} position="left" /></div>
          <div className="xb-rp-metric-val mono">{fmtCount(mentions)}</div>
        </div>
        <div className="xb-rp-metric">
          <div className="xb-rp-metric-label mono">7d Avg<InfoTip text={getMetricInfo('xi7dAvg')} position="left" /></div>
          <div className="xb-rp-metric-val mono">{fmtCount(avg)}</div>
        </div>
        <div className="xb-rp-metric">
          <div className="xb-rp-metric-label mono">
            {rowMomentum.kind === 'rank' ? 'Rank Δ' : 'Growth'}
            <InfoTip text={rowMomentum.kind === 'rank' ? XB_RANK_TIPS.growth : getMetricInfo('xiGrowth')} position="left" />
          </div>
          <div className="xb-rp-metric-val mono" style={{ color: growthTint }}>{growthText}</div>
        </div>
      </div>

      {/* contract + chart - parity with the X Dash drawer */}
      <div className="xb-rp-actions">
        {address && (
          <button type="button" className="xb-rp-ca mono" onClick={copyCa} title="Copy contract address">
            <span className="xb-rp-ca-addr">{shortCa}</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
          </button>
        )}
        <button type="button" className="xb-rp-chart" onClick={openChart} title="Open price chart">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18" /><path d="M7 14l3-4 3 3 4-6" /></svg>
          <span>Chart</span>
        </button>
      </div>

      {/* links */}
      {(detail?.socials?.twitter || detail?.socials?.website) && (
        <div className="xb-rp-links">
          {detail.socials.twitter && <a className="xb-rp-link" href={detail.socials.twitter} target="_blank" rel="noreferrer">X</a>}
          {detail.socials.website && <a className="xb-rp-link" href={detail.socials.website} target="_blank" rel="noreferrer">Site</a>}
        </div>
      )}

      {/* tweets */}
      <div className="xb-rp-tweets">
        <div className="xb-rp-tweets-head">
          <span className="xb-rp-section-label mono">Mentions{mentionTotal > 0 ? ` · ${fmtCount(mentionTotal)}` : ''}</span>
          <div className="xb-rp-tweets-head-r">
            {hasMentions && (
              <div className="xb-rp-sort" role="tablist" aria-label="Sort mentions">
                <button type="button" role="tab" aria-selected={mentionSort === 'top'} className={`xb-rp-sort-btn${mentionSort === 'top' ? ' is-active' : ''}`} onClick={() => setMentionSort('top')}>Top</button>
                <button type="button" role="tab" aria-selected={mentionSort === 'recent'} className={`xb-rp-sort-btn${mentionSort === 'recent' ? ' is-active' : ''}`} onClick={() => setMentionSort('recent')}>Recent</button>
              </div>
            )}
            {detail?.snapshot_ts && <span className="xb-rp-snapshot mono">{timeAgo(detail.snapshot_ts)}</span>}
          </div>
        </div>
        <div className="xb-rp-tweets-body">
          {tweetsLoading && (
            <div className="xb-rp-loading">
              <span className="xb-shimmer" /><span className="xb-shimmer" /><span className="xb-shimmer" />
            </div>
          )}
          {!tweetsLoading && tweets.length === 0 && (
            <div className="xb-rp-empty-tweets">No fresh tweets cached</div>
          )}
          {!tweetsLoading && tweets.map((t, i) => <TweetCard key={t.tweet_id || i} tweet={t} />)}
        </div>
      </div>
    </div>
  )
}

/* ── THE REACTOR ──────────────────────────────────────────────────────────────
   X Intelligence's living GPU view, on the shared ConstellationEngine. A single
   breathing organism of crypto attention:
     SIZE  = mindshare (mention share)
     PULSE = velocity  (the harder it's being talked about, the faster it beats)
     GLOW  = authenticity (organic blooms; manufactured stays dim)
     COLOR = authenticity (default), or the manipulation X-RAY (organic green vs
             manufactured rose) on toggle.
   Click a bubble → the conversation driving it (the existing right panel). ──── */
const REACTOR_MIN_R = 15
const REACTOR_MAX_R = 62
const REACTOR_EMPTY = []
function lerpRGB(a, b, t) {
  const k = Math.max(0, Math.min(1, t))
  return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)]
}
function reactorColor(auth, xray) {
  const a = (Number.isFinite(auth) ? auth : 50) / 100
  // default: muted slate → vivid teal. x-ray: manufactured rose → organic green.
  return xray ? lerpRGB([233, 94, 128], [92, 230, 161], a) : lerpRGB([122, 130, 156], [86, 224, 200], a)
}

/* ── Live firehose ────────────────────────────────────────────────────────────
 * The Reactor's heartbeat — a cross-token stream of the freshest real mentions,
 * so the view feels like the live pulse of crypto X, not a static snapshot.
 * X Dash exposes NO global firehose endpoint, so we aggregate the per-token
 * feeds (/api/xdash/token/:cg_id returns `mentions` newest-first) for the
 * loudest N tokens, merge + dedupe + sort by recency into one pool, then stream
 * it in client-side. Bounded (N fetches), keyed on the loud-set so price
 * re-paints don't refetch, visibility-guarded, refreshed every 2 min. */
const FIREHOSE_TOKENS = 8
const FIREHOSE_POOL_CAP = 60

function useFirehose(tokens) {
  const [pool, setPool] = useState([])
  const tf = xbActiveWindow()
  // Stable trigger: only the loudest token cg_ids. The board re-refs on every
  // price re-paint, but the loud-set rarely changes — so we don't refetch the
  // feeds on cosmetic updates, only when the membership actually shifts.
  const idsKey = useMemo(() => (
    tokens
      .filter((t) => t.cg_id && (t.mentions_24h || 0) > 0)
      .slice(0, FIREHOSE_TOKENS)
      .map((t) => t.cg_id)
      .join(',')
  ), [tokens])
  // The window joins the key: these per-token feeds are window-scoped, so a
  // board that resolves onto a different window has to re-pull the stream.
  const sourceKey = idsKey ? `${tf}|${idsKey}` : ''

  useEffect(() => {
    if (!sourceKey) { setPool([]); return }
    const sources = tokens
      .filter((t) => t.cg_id && (t.mentions_24h || 0) > 0)
      .slice(0, FIREHOSE_TOKENS)
    let cancelled = false

    const load = async () => {
      try {
        const lists = await Promise.all(sources.map(async (t) => {
          try {
            const r = await fetch(`/api/xdash/token/${encodeURIComponent(t.cg_id)}?timeframe=${tf}&page=1&per_page=30`, { credentials: 'include', signal: AbortSignal.timeout(18000) })
            const txt = await r.text()
            const j = txt ? JSON.parse(txt) : null
            const arr = j?.mentions || j?.data?.mentions
            return (Array.isArray(arr) ? arr : [])
              .map(normXdashMention)
              .filter((mm) => mm.full_text && mm.author && mm.author.avatar)
              .map((mm) => ({ ...mm, asset: t.asset, cashtag: t.cashtag || `$${t.asset}`, tokenImage: t.image }))
          } catch { return [] }
        }))
        if (cancelled) return
        const seen = new Set()
        const merged = []
        for (const list of lists) {
          for (const mm of list) {
            const key = mm.tweet_id || `${mm.asset}-${mm.full_text.slice(0, 24)}`
            if (seen.has(key)) continue
            seen.add(key)
            merged.push(mm)
          }
        }
        merged.sort((a, b) => (a.created_at && b.created_at ? new Date(b.created_at) - new Date(a.created_at) : 0))
        setPool(merged.slice(0, FIREHOSE_POOL_CAP))
      } catch { /* the firehose is ambient — a failure just means no stream */ }
    }
    // Defer the 8-fetch fan-out (~2MB) off the mount critical path so it doesn't
    // compete with the board load for the connection pool — this is an ambient
    // decoration, the board must paint first.
    const kickoff = () => { if (!cancelled) load() }
    let idleId = null
    let timeoutId = null
    if (typeof requestIdleCallback !== 'undefined') idleId = requestIdleCallback(kickoff, { timeout: 2500 })
    else timeoutId = setTimeout(kickoff, 1200)
    const iv = setInterval(() => { if (!document.hidden && isAppActive() && !cancelled) load() }, 120_000)
    return () => {
      cancelled = true
      clearInterval(iv)
      if (idleId != null && typeof cancelIdleCallback !== 'undefined') cancelIdleCallback(idleId)
      if (timeoutId != null) clearTimeout(timeoutId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey])

  return pool
}

/* The streaming overlay — reveals one fresh mention at a time at the top of a
 * short stack, so the column is always gently moving. Pauses when the tab is
 * hidden or the user prefers reduced motion (then it's just a static recent
 * list). Clicking a card opens that token. */
const FIREHOSE_VISIBLE = 4
function LiveFirehose({ pool, onSelect }) {
  const reduced = useMemo(() => (
    typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ), [])
  const [idx, setIdx] = useState(0)

  useEffect(() => { setIdx(0) }, [pool])

  useEffect(() => {
    if (reduced || pool.length <= FIREHOSE_VISIBLE) return undefined
    const iv = setInterval(() => {
      if (!document.hidden) setIdx((i) => (i + 1) % pool.length)
    }, 3600)
    return () => clearInterval(iv)
  }, [reduced, pool.length])

  if (!pool.length) return null

  const shown = []
  for (let k = 0; k < Math.min(FIREHOSE_VISIBLE, pool.length); k++) {
    shown.push(pool[(idx + k) % pool.length])
  }

  return (
    <div className="xb-fire">
      <div className="xb-fire-head">
        <span className="xb-fire-dot" aria-hidden="true" />
        <span className="xb-fire-title mono">Live · the feed</span>
      </div>
      <div className="xb-fire-stream">
        {shown.map((m, k) => {
          const handle = m.author && m.author.handle ? `@${m.author.handle}` : (m.author && m.author.name) || 'someone'
          return (
            <button
              key={`${m.tweet_id || m.asset}-${k}`}
              type="button"
              className={`xb-fire-card${k === 0 ? ' is-fresh' : ''}`}
              onClick={() => onSelect(m.asset)}
              title={`${handle} on ${m.cashtag}`}
            >
              {m.author && m.author.avatar
                ? <img className="xb-fire-av" src={m.author.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" />
                : <span className="xb-fire-av xb-fire-av-fb">{String(handle).replace('@', '').charAt(0).toUpperCase()}</span>}
              <span className="xb-fire-body">
                <span className="xb-fire-meta">
                  <span className="xb-fire-handle">{handle}</span>
                  <span className="xb-fire-cash mono">{m.cashtag}</span>
                </span>
                <span className="xb-fire-text">{m.full_text}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const ReactorView = React.memo(function ReactorView({ tokens, width, height, onSelect }) {
  const [xray, setXray] = useState(false)
  const [hovered, setHovered] = useState(null) // { t, x, y }
  const reduced = useMemo(() => (
    typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ), [])

  const totalMentions = useMemo(() => tokens.reduce((s, t) => s + (t.mentions_24h || 0), 0), [tokens])
  const firehose = useFirehose(tokens)

  // DIVERGENCE — "punching above its weight": loud (mentions) relative to a
  // small market cap. Mindshare ≫ mcap is the earliest entry signal there is.
  const divergence = useMemo(() => {
    const scored = tokens
      .filter((t) => (t.market_cap_usd || 0) > 0 && (t.mentions_24h || 0) >= 5)
      .map((t) => ({ t, premium: (t.mentions_24h || 0) / Math.max(0.5, (t.market_cap_usd || 0) / 1e6) }))
      .sort((a, b) => b.premium - a.premium)
    const top = scored.slice(0, 6).map((s) => s.t)
    return { top, set: new Set(top.map((t) => t.asset)) }
  }, [tokens])

  // Signature of ONLY the fields the reactor node layout/render reads (mentions,
  // velocity, authenticity, image) - NOT price. Keying the nodes memo on this
  // (instead of the raw tokens ref) stops the first-load price enrichment (CG ->
  // DEX -> Codex, 3 repaints) from re-seeding the constellation sim, since those
  // ticks mint a new tokens ref but leave these fields unchanged.
  const reactorSig = useMemo(
    () => tokens.map((t) => `${t.asset}|${t.mentions_24h}|${t.velocity_ratio}|${t.authenticity}|${t.image}`).join('~'),
    [tokens],
  )

  const nodes = useMemo(() => {
    if (!tokens.length) return REACTOR_EMPTY
    const roots = tokens.map((t) => Math.sqrt(Math.max(1, t.mentions_24h || 0)))
    const maxR = Math.max(1, ...roots)
    return tokens.map((t, i) => {
      const norm = roots[i] / maxR
      const vel = Number(t.velocity_ratio)
      const pulse = Number.isFinite(vel) ? Math.max(0.05, Math.min(1.3, (vel - 0.7) / 1.6)) : 0.12
      const auth = Number.isFinite(t.authenticity) ? t.authenticity : 50
      return {
        id: t.asset || t.cg_id || String(i),
        clusterKey: 'reactor',
        size: norm,
        color: reactorColor(auth, xray),
        glow: Math.max(0.05, Math.min(1, auth / 100)),
        logo: t.image || null,
        _rpx: REACTOR_MIN_R + (REACTOR_MAX_R - REACTOR_MIN_R) * Math.pow(norm, 0.82),
        _pulse: pulse,
        _seed: (i * 0.61803398875) % 1,
        data: t,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reactorSig, xray])

  const handleClick = useCallback((n) => { if (n && n.data && n.data.asset) onSelect(n.data.asset) }, [onSelect])
  const handleHover = useCallback((n, screen) => {
    if (!n || !n.data) { setHovered(null); return }
    setHovered({ t: n.data, x: screen ? screen.x : 0, y: screen ? screen.y : 0 })
  }, [])

  // hover card content
  let card = null
  if (hovered) {
    const t = hovered.t
    const ms = totalMentions > 0 ? (t.mentions_24h / totalMentions) * 100 : 0
    const auth = Number.isFinite(t.authenticity) ? t.authenticity : null
    const vel = Number.isFinite(t.velocity_ratio) ? t.velocity_ratio : null
    const isDiv = divergence.set.has(t.asset)
    const left = Math.min(Math.max(8, hovered.x + 18), Math.max(8, (width || 0) - 236))
    const top = Math.min(Math.max(8, hovered.y - 12), Math.max(8, (height || 0) - 196))
    card = (
      <div className="xb-reactor-card" style={{ left, top }}>
        <div className="xb-reactor-card-head">
          {t.image
            ? <img className="xb-reactor-card-logo" src={t.image} alt="" loading="lazy" />
            : <span className="xb-reactor-card-ph">{String(t.asset || '?').charAt(0)}</span>}
          <span className="xb-reactor-card-id">
            <span className="xb-reactor-card-sym mono">{t.asset}</span>
            <span className="xb-reactor-card-name">{t.name}</span>
          </span>
        </div>
        {isDiv && <div className="xb-reactor-card-div mono">⚡ Punching above its weight</div>}
        <div className="xb-reactor-card-stats">
          <span><b className="mono">{ms >= 0.1 ? `${ms.toFixed(2)}%` : '<0.1%'}</b> mindshare</span>
          <span><b className="mono">{fmtCount(t.mentions_24h)}</b> mentions</span>
          {vel != null && <span><b className="mono">{vel.toFixed(2)}×</b> velocity</span>}
          {auth != null && <span><b className="mono">{auth}%</b> authentic</span>}
          {t.market_cap_usd ? <span><b className="mono">{fmtMC(t.market_cap_usd)}</b> mcap</span> : null}
        </div>
        <div className="xb-reactor-card-cta mono">Click to open →</div>
      </div>
    )
  }

  return (
    <div className="xb-reactor">
      <Suspense fallback={null}>
        {width > 0 && height > 0 && nodes.length > 0 && (
          <ReactorEngine
            nodes={nodes}
            clusters={REACTOR_EMPTY}
            links={null}
            layout="reactor"
            stageSize={{ w: width, h: height }}
            reducedMotion={reduced}
            onNodeClick={handleClick}
            onNodeHover={handleHover}
          />
        )}
      </Suspense>

      {card}

      <LiveFirehose pool={firehose} onSelect={onSelect} />

      <button
        type="button"
        className={`xb-reactor-xray${xray ? ' is-on' : ''}`}
        onClick={() => setXray((v) => !v)}
        title="Authenticity X-ray — recolor by organic vs manufactured attention"
      >
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="3.2" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" strokeLinecap="round" /></svg>
        Authenticity X-ray
      </button>

      {/* DIVERGENCE strip — the loudest small-caps, the early-alpha shortlist */}
      {divergence.top.length > 0 && (
        <div className="xb-reactor-div-strip">
          <span className="xb-reactor-div-title mono">⚡ Above its weight</span>
          {divergence.top.map((t) => (
            <button key={t.asset} type="button" className="xb-reactor-div-chip" onClick={() => onSelect(t.asset)} title={`${t.name} · ${t.market_cap_usd ? fmtMC(t.market_cap_usd) : ''}`}>
              {t.image ? <img src={t.image} alt="" loading="lazy" /> : <span className="xb-reactor-div-ph">{String(t.asset || '?').charAt(0)}</span>}
              <span className="mono">{t.asset}</span>
            </button>
          ))}
        </div>
      )}

      <div className="xb-reactor-legend mono">
        <span className="xb-reactor-leg"><b>size</b> mindshare</span>
        <span className="xb-reactor-leg"><b>pulse</b> velocity</span>
        <span className="xb-reactor-leg"><b>glow</b> {xray ? 'organic ↔ manufactured' : 'authenticity'}</span>
      </div>
    </div>
  )
})

/* ── Page ─────────────────────────────────────────────────────────────────── */
const XBubblesPage = () => {
  const isMobile = useIsMobile()
  const [view, setView] = useState('reactor')
  const [filter, setFilter] = useState('all')
  const [mcFilter, setMcFilter] = useState('mc_all')
  const [ranking, setRanking] = useState('mentions')
  const [topN, setTopN] = useState(50)
  const [selected, setSelected] = useState(null)
  // On mobile the detail panel is a bottom sheet that only opens on a real tap
  // (selection auto-defaults to the first token on load, so we can't key the
  // sheet off `selected` alone).
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const handleSelect = useCallback((asset) => {
    setSelected(asset)
    if (isMobile) setMobileDetailOpen(!!asset)
  }, [isMobile])
  const stageRef = useRef(null)
  const stage = useStageSize(stageRef)
  const { data, meta, loading, error, refetch, health, boardWindow } = useLeaderboard(ranking)
  const windowLabel = timeframeLabel(boardWindow)
  // Which momentum the board is actually carrying — the 24h mention-rate, or
  // board movement over the window. Everything below reads the value through
  // xbMomentum and only consults the kind to label a unit.
  const momentumKind = useMemo(() => {
    const rows = data || []
    if (rows.some((t) => t.growth_pct != null)) return 'growth'
    if (rows.some((t) => Number.isFinite(t.rank_change))) return 'rank'
    return null
  }, [data])
  const hasMomentum = momentumKind != null
  const onRank = momentumKind === 'rank'

  /* ── Guided tour (button-launched) ── */
  const dayMode = useSettingsStore((s) => s.dayMode)
  const xiTourSeen = useSettingsStore((s) => s.xiTourSeen)
  const setXiTourSeen = useSettingsStore((s) => s.setXiTourSeen)
  const [tourActive, setTourActive] = useState(false)
  const [tourStep, setTourStep] = useState(0)
  const startTour = useCallback(() => {
    setTourStep(0)
    setTourActive(true)
    setXiTourSeen(true)
  }, [setXiTourSeen])
  const endTour = useCallback(() => setTourActive(false), [])
  const handleTourNext = useCallback(() => {
    if (tourStep >= XI_TOUR_STEPS.length - 1) setTourActive(false)
    else setTourStep(tourStep + 1)
  }, [tourStep])
  const handleTourBack = useCallback(() => setTourStep((s) => Math.max(0, s - 1)), [])

  // Rising/Falling are momentum questions. With no momentum in the payload the
  // honest move is to drop back to All — leaving the chip active would empty the
  // board and read, again, as "no tokens match your filter".
  useEffect(() => {
    if (!hasMomentum && filter !== 'all') setFilter('all')
  }, [hasMomentum, filter])

  const tokens = useMemo(() => {
    let all = data || []
    if (filter === 'rising') all = all.filter((t) => (xbMomentum(t).value ?? 0) > 0)
    else if (filter === 'falling') all = all.filter((t) => (xbMomentum(t).value ?? 0) < 0)
    const mc = MC_FILTERS.find((m) => m.id === mcFilter)
    if (mc && (mc.min != null || mc.max != null)) {
      all = all.filter((t) => {
        const v = t.market_cap_usd
        if (v == null) return false
        if (mc.min != null && v < mc.min) return false
        if (mc.max != null && v >= mc.max) return false
        return true
      })
    }
    return all.slice(0, topN)
  }, [data, filter, mcFilter, topN])

  const totalMentions = useMemo(
    () => (tokens || []).reduce((sum, t) => sum + (t.mentions_24h || 0), 0),
    [tokens],
  )

  // Aggregate metrics for left sidebar
  // Every one of these reads momentum, whichever source it came from. The
  // >10 threshold for "a big move" reads the same either way: 10% off the
  // baseline, or 10 places on the board.
  const agg = useMemo(() => {
    const rated = (data || []).map((t) => xbMomentum(t).value).filter((v) => v != null)
    // Not zero — unknown. '—' beats "0% / Bearish", which is a market call we
    // would have no data for.
    if (!rated.length) return { sentiment: null, velocity: null, activeSignals: null }
    const positives = rated.filter((v) => v > 0).length
    const sentiment = ((positives / rated.length) * 100)
    const velocity = rated.reduce((s, v) => s + Math.abs(v), 0) / rated.length
    const activeSignals = rated.filter((v) => Math.abs(v) > 10).length
    return { sentiment, velocity, activeSignals }
  }, [data])

  const totalGrowth = useMemo(() => {
    const rated = (data || []).map((t) => xbMomentum(t).value).filter((v) => v != null)
    if (!rated.length) return null
    const p = rated.filter((v) => v > 0).length
    const n = rated.filter((v) => v < 0).length
    return ((p - n) / rated.length) * 100
  }, [data])

  // "Updated" must reflect the DATA's real freshness. The backend freezes
  // meta.snapshot_ts (observed stuck ~21h while it kept aging), but every row's
  // `updated_at` advances hourly with the pipeline. Show the freshest row
  // updated_at; fall back to meta.snapshot_ts only if rows lack it (no
  // regression for older payloads). ISO-8601 sorts lexically, so string max
  // is a valid "latest".
  const dataUpdatedAt = useMemo(() => {
    let latest = null
    for (const r of (data || [])) {
      const u = r?.updated_at
      if (u && (!latest || u > latest)) latest = u
    }
    return latest || meta?.snapshot_ts || null
  }, [data, meta])

  const selectedToken = useMemo(
    () => (data || []).find((t) => t.asset === selected) || null,
    [data, selected],
  )

  // With momentum, the movers rail is what it says it is. Without it, ranking by
  // a null and calling the result "Top Movers" would be fiction — so it becomes
  // the loudest tokens of the window, under a title that says exactly that.
  const topMovers = useMemo(() => {
    const rows = [...(data || [])]
    if (hasMomentum) {
      return rows.filter((t) => (xbMomentum(t).value ?? 0) > 0)
        .sort((a, b) => (xbMomentum(b).value ?? 0) - (xbMomentum(a).value ?? 0))
        .slice(0, 24)
    }
    // No momentum at all — ranking by a null and calling it "Top Movers" would
    // be fiction, so it becomes the loudest tokens under a title that says so.
    return rows.sort((a, b) => (b.mentions_24h || 0) - (a.mentions_24h || 0)).slice(0, 24)
  }, [data, hasMomentum])

  useEffect(() => {
    if (!selected && tokens.length) setSelected(tokens[0].asset)
  }, [tokens, selected])

  return (
    <div className="xb-page">
      {/* ── header ──────────────────────────────────────────── */}
      <header className="xb-header">
        <div className="xb-header-left">
          <div className="xb-header-id">
            <span className="xb-header-mark" />
            <div>
              <h1 className="xb-header-title mono">SOCIAL INTELLIGENCE</h1>
              <p className="xb-header-sub mono">Real-time X mindshare across crypto · {windowLabel} window</p>
            </div>
          </div>
        </div>

        <div className="xb-header-controls">
          {isMobile ? (
            <div className="xb-mtools">
              <XbSelect caption="View" value={view} onChange={setView} options={VIEWS} />
              <XbSelect caption="Metric" value={ranking} onChange={setRanking} options={RANKINGS} />
              <XbSelect
                caption="Filter"
                value={filter}
                onChange={setFilter}
                options={hasMomentum ? FILTERS : FILTERS.filter((f) => f.id === 'all')}
              />
              <XbSelect
                caption="Show"
                value={topN}
                onChange={(v) => setTopN(Number(v))}
                options={COUNT_OPTIONS.map((n) => ({ id: n, label: String(n) }))}
              />
              <XbSelect caption="Market Cap" value={mcFilter} onChange={setMcFilter} options={MC_FILTERS} />
              <button type="button" className="xb-refresh xb-mtools-refresh" onClick={() => refetch()} disabled={loading} title="Refresh">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
                </svg>
              </button>
            </div>
          ) : (
            <>
              <div className="xb-toggle">
                {VIEWS.map((opt) => (
                  <button key={opt.id} type="button" className={`xb-toggle-btn${view === opt.id ? ' is-active' : ''}`} onClick={() => setView(opt.id)}>
                    {opt.label}
                  </button>
                ))}
              </div>

              <span className="xb-divider" />

              <div className="xb-toggle xb-toggle-rank">
                {RANKINGS.map((r) => (
                  <button key={r.id} type="button" className={`xb-toggle-btn${ranking === r.id ? ' is-active' : ''}`} onClick={() => setRanking(r.id)}>
                    {r.label}
                  </button>
                ))}
              </div>

              <span className="xb-divider" />

              <div className="xb-chip-row">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`xb-chip${filter === f.id ? ' is-active' : ''}`}
                    onClick={() => setFilter(f.id)}
                    disabled={!hasMomentum && f.id !== 'all'}
                    title={!hasMomentum && f.id !== 'all'
                      ? `Momentum is not published for the ${windowLabel} window, so rising and falling cannot be told apart right now.`
                      : undefined}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <span className="xb-divider" />

              <div className="xb-toggle xb-toggle-count">
                {COUNT_OPTIONS.map((n) => (
                  <button key={n} type="button" className={`xb-toggle-btn${topN === n ? ' is-active' : ''}`} onClick={() => setTopN(n)}>
                    {n}
                  </button>
                ))}
              </div>

              <button type="button" className="xb-refresh" onClick={() => refetch()} disabled={loading} title="Refresh">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
                </svg>
              </button>
            </>
          )}
          <TourLaunchButton onClick={startTour} pulse={!xiTourSeen} label="Tour" title="Take a quick tour of X Intelligence" />
        </div>
      </header>

      {/* ── mc filter strip (mobile: Market Cap moved into the toolbar above;
            here we keep only the legend) ─────────────────────── */}
      <div className="xb-mcstrip">
        {!isMobile && <span className="xb-mcstrip-label mono">Market Cap</span>}
        {!isMobile && (
          <div className="xb-chip-row">
            {MC_FILTERS.map((m) => (
              <button key={m.id} type="button" className={`xb-chip${mcFilter === m.id ? ' is-active' : ''}`} onClick={() => setMcFilter(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        )}
        <div className="xb-legend">
          {BUCKETS.map((b) => (
            <span key={b.id} className="xb-legend-item">
              <span className="xb-legend-dot" style={{ background: b.accent, boxShadow: `0 0 10px ${b.glow}` }} />
              <span className="xb-legend-label mono">{b.label}</span>
            </span>
          ))}
        </div>
      </div>

      {/* ── body: 3 columns ─────────────────────────────────── */}
      <div className="xb-body">
        {/* LEFT: metric cards */}
        <aside className="xb-left" data-tour="xi-metrics">
          <MetricCard label={`Total Mentions · ${windowLabel}`} value={fmtCount(totalMentions)} delta={totalGrowth} info="xiTotalMentions" />
          <MetricCard label="Tokens Tracked" value={fmtCount(data?.length || 0)} info="tokensTracked" />
          <MetricCard
            label="Sentiment"
            value={agg.sentiment == null ? '—' : `${agg.sentiment.toFixed(0)}%`}
            accent={agg.sentiment == null ? undefined : (agg.sentiment >= 50 ? '#5CE6A1' : '#FF6E8E')}
            info="xiSentiment"
            tip={onRank ? XB_RANK_TIPS.sentiment : undefined}
          />
          <MetricCard
            label="Avg Velocity"
            value={agg.velocity == null ? '—' : (onRank ? `${agg.velocity.toFixed(1)} pos` : `${agg.velocity.toFixed(1)}%`)}
            accent={agg.velocity == null ? undefined : '#F5C24D'}
            info="xiAvgVelocity"
            tip={onRank ? XB_RANK_TIPS.velocity : undefined}
          />
          <MetricCard
            label="Active Signals"
            value={agg.activeSignals == null ? '—' : String(agg.activeSignals)}
            accent={agg.activeSignals == null ? undefined : '#9B7CE6'}
            info="xiActiveSignals"
            tip={onRank ? XB_RANK_TIPS.activeSignals : undefined}
          />
          <MetricCard
            label="Updated"
            value={dataUpdatedAt ? timeAgo(dataUpdatedAt) : '—'}
          />
        </aside>

        {/* CENTER: visualization */}
        <div className="xb-center">
          <div className="xb-stage" ref={stageRef} data-tour="xi-stage">
            {loading && !data?.length ? (
              <div className="xb-stage-empty">
                <span className="xb-shimmer-large" />
                <span className="xb-stage-msg mono">Resolving social field…</span>
              </div>
            ) : (!data?.length && health?.state === 'updating') ? (
              /* The board is empty because the feed could not answer, NOT because
                 the reader's chips excluded everything — saying "no tokens match
                 this filter" here points them at a market-cap floor that was
                 never the problem. Same distinction the X Dash banner draws. */
              <XDashUpdatingNotice health={health} onRetry={refetch} flush />
            ) : error ? (
              <div className="xb-stage-empty">
                <span className="xb-stage-msg mono">{error}</span>
                <button className="xb-retry" onClick={() => refetch()}>Retry</button>
              </div>
            ) : !tokens.length ? (
              <div className="xb-stage-empty">
                <span className="xb-stage-msg mono">No tokens match this filter</span>
              </div>
            ) : view === 'reactor' ? (
              <ReactorView tokens={tokens} width={stage.w} height={stage.h} onSelect={handleSelect} />
            ) : view === 'bubbles' ? (
              <BubbleMap tokens={tokens} totalMentions={totalMentions} width={stage.w} height={stage.h} selected={selected} onSelect={handleSelect} />
            ) : view === 'treemap' ? (
              <TreemapView tokens={tokens} totalMentions={totalMentions} width={stage.w} height={stage.h} selected={selected} onSelect={handleSelect} />
            ) : (
              <BarsView tokens={tokens} totalMentions={totalMentions} selected={selected} onSelect={handleSelect} momentumKind={momentumKind} />
            )}
          </div>

          {/* bottom stat cards */}
          <div className="xb-bottom-cards" data-tour="xi-hero">
            <div className="xb-bcard">
              <span className="xb-bcard-label mono">Influence Score<InfoTip text={onRank ? XB_RANK_TIPS.influence : getMetricInfo('xiInfluenceScore')} position="top" /></span>
              <span className="xb-bcard-value mono">{agg.sentiment == null ? '—' : (agg.sentiment >= 50 ? 'Bullish' : 'Bearish')}</span>
              <span className="xb-bcard-bar" style={{ background: `linear-gradient(90deg, ${agg.sentiment == null ? XB_NEUTRAL : (agg.sentiment >= 50 ? '#5CE6A1' : '#FF6E8E')}cc, transparent)`, width: `${agg.sentiment == null ? 0 : Math.min(100, agg.sentiment)}%` }} />
            </div>
            <div className="xb-bcard">
              <span className="xb-bcard-label mono">Velocity Delta<InfoTip text={onRank ? XB_RANK_TIPS.velocity : getMetricInfo('xiVelocityDelta')} position="top" /></span>
              <span className="xb-bcard-value mono">{agg.velocity == null ? '—' : (onRank ? `${agg.velocity.toFixed(1)} pos` : `${agg.velocity.toFixed(1)}%`)}</span>
              <span className="xb-bcard-bar" style={{ background: 'linear-gradient(90deg, #F5C24Dcc, transparent)', width: `${agg.velocity == null ? 0 : Math.min(100, agg.velocity * 2)}%` }} />
            </div>
            <div className="xb-bcard">
              <span className="xb-bcard-label mono">Signal Density<InfoTip text={onRank ? XB_RANK_TIPS.signalDensity : getMetricInfo('xiSignalDensity')} position="top" /></span>
              <span className="xb-bcard-value mono">{agg.activeSignals == null ? '—' : agg.activeSignals} / {data?.length || 0}</span>
              <span className="xb-bcard-bar" style={{ background: 'linear-gradient(90deg, #9B7CE6cc, transparent)', width: `${data?.length && agg.activeSignals != null ? (agg.activeSignals / data.length) * 100 : 0}%` }} />
            </div>
          </div>
        </div>

        {/* RIGHT: movers + detail (desktop rail) */}
        {!isMobile && (
          <aside className="xb-right">
            <RightPanel selectedToken={selectedToken} topMovers={topMovers} onPick={handleSelect} windowLabel={windowLabel} hasMomentum={hasMomentum} />
          </aside>
        )}
      </div>

      {/* Mobile: full-screen detail rendered via a portal to <body> so the
          page header's backdrop-filter can't composite over it (iOS bug). */}
      {isMobile && mobileDetailOpen && createPortal(
        <div className="xb-detail-overlay">
          <button type="button" className="xb-sheet-close" onClick={() => setMobileDetailOpen(false)} aria-label="Close">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 5l14 14M19 5L5 19" /></svg>
          </button>
          <RightPanel selectedToken={selectedToken} topMovers={topMovers} onPick={handleSelect} windowLabel={windowLabel} hasMomentum={hasMomentum} />
        </div>,
        document.body,
      )}

      {!isMobile && <SocialDisclaimer className="xb-disclaimer" />}

      <GuidedTour
        steps={XI_TOUR_STEPS}
        isActive={tourActive}
        currentStep={tourStep}
        onNext={handleTourNext}
        onBack={handleTourBack}
        onSkip={endTour}
        dayMode={dayMode}
        ariaLabel="X Intelligence tour"
      />
    </div>
  )
}

export default XBubblesPage
