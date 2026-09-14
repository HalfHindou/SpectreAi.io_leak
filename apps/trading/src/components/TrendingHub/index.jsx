/**
 * TrendingHub - Spectre trading-terminal engine (#trending).
 * Full-bleed, dense, terminal shape (DexScreener / Defined.fi class): compact header
 * + live stat strip, a Data/Social/Categories tab bar, a category/meta chip row, a
 * control bar (timeframe + chain rail + dataset sub-filters), and ONE dense multi-column
 * table as the hero. All 12 datasets + useMarketStats wiring preserved; this is a
 * presentation re-architecture, not a data rewire.
 */
import React, { useEffect, useState, useCallback, useMemo, useRef, useId } from 'react'
import { createPortal } from 'react-dom'
import { Globe, Send } from 'lucide-react'
import Icon from '../Icon'
import { isAppActive } from '../../lib/idleManager'
import { screenTokens, getHardcodedLogo } from '../../services/codexApi'
import { fetchGtScreenerRows, gtOnlyNetworkFor, gradeGtRow } from '../../services/geckoTerminalApi'
import { ChainIcon } from '../../utils/chainIcons'
import { prefetchTrending } from '../../hooks/useCodexData'
import TokenDiscoveryTable from '../TokenDiscoveryTable'
import useIsMobile from '../../hooks/useIsMobile'
import MobileHub from './MobileHub'
import './TrendingHub.css'

// ORDER MATTERS - this array IS the tab order. ChainPills filters it by the
// user's visibleChains preference and renders whatever survives, in this order,
// so the pills are reordered here rather than in the preference list.
// 'all' must stay at index 0: it is referenced as CHAIN_OPTIONS[0] wherever a
// default/fallback chain is needed.
const CHAIN_OPTIONS = [
  { id: 'all', label: 'All Chains', short: 'All', networkIds: [1, 56, 137, 8453, 42161, 10, 43114, 1399811149] },
  { id: 'sol', label: 'Solana', short: 'SOL', networkIds: [1399811149] },
  { id: 'eth', label: 'Ethereum', short: 'ETH', networkIds: [1] },
  // Robinhood Chain (Arbitrum Orbit L2, mainnet 2026-07-01). No Codex coverage -
  // sections for this chain load from GeckoTerminal (see geckoTerminalApi.js).
  { id: 'hood', label: 'Robinhood', short: 'HOOD', networkIds: [4663] },
  { id: 'bsc', label: 'BSC', short: 'BSC', networkIds: [56] },
  { id: 'base', label: 'Base', short: 'BASE', networkIds: [8453] },
  { id: 'arb', label: 'Arbitrum', short: 'ARB', networkIds: [42161] },
  { id: 'poly', label: 'Polygon', short: 'POLY', networkIds: [137] },
  { id: 'op', label: 'Optimism', short: 'OP', networkIds: [10] },
  { id: 'avax', label: 'Avalanche', short: 'AVAX', networkIds: [43114] },
]

const TIMEFRAME_OPTIONS = [
  { id: '5m', label: '5M' },
  { id: '1h', label: '1H' },
  { id: '24h', label: '24H' },
]

// networkId -> short chain tag for the dense-table token cell (/SOL, /ETH...).
const NET_LABEL = { 1: 'ETH', 56: 'BSC', 137: 'POLY', 8453: 'BASE', 42161: 'ARB', 10: 'OP', 43114: 'AVAX', 4663: 'HOOD', 1399811149: 'SOL' }
const netLabel = (id) => NET_LABEL[id] || 'ETH'

// Warm-gold "attention heat" RGB — the DATA color for the social attention cluster
// (mirrors the CSS var --th-heat: 245,179,80). Scoped to Signal/Mentions + Buzz only;
// never leaks into price/mcap/volume/timeframe chrome.
const TH_HEAT = [245, 179, 80]

// networkId -> { label, muted brand dot } for the chain pill. Tiny muted brand dots
// are the ONE allowed color exception in the chrome; everything else stays warm-white.
const CHAIN_META = {
  1:          { label: 'ETH',  color: '#7782c9' },
  56:         { label: 'BSC',  color: '#c2a13a' },
  137:        { label: 'POLY', color: '#8a6fd0' },
  8453:       { label: 'BASE', color: '#4f74d6' },
  42161:      { label: 'ARB',  color: '#4f8fc4' },
  10:         { label: 'OP',   color: '#cd6168' },
  43114:      { label: 'AVAX', color: '#cf6164' },
  4663:       { label: 'HOOD', color: '#57b380' },
  1399811149: { label: 'SOL',  color: '#8a8fc4' },
}
const chainMeta = (id) => CHAIN_META[id] || CHAIN_META[1]

// Small colored-dot chain pill for the token cell. Renders NOTHING when the
// chain is genuinely unknown (social rows without chain data) - an honest blank
// beats a wrong default-ETH pill.
function ChainBadge({ networkId }) {
  if (!networkId || !CHAIN_META[networkId]) return null
  const m = CHAIN_META[networkId]
  return (
    <span className="th-dt-chainpill">
      <span className="th-dt-chaindot" style={{ background: m.color }} />
      {m.label}
    </span>
  )
}

// Terminal tabs + per-tab dataset sub-filters (map onto the existing 12 datasets).
const TABS = [
  { id: 'data', label: 'Markets' },
  { id: 'social', label: 'Social' },
  { id: 'categories', label: 'Sectors' },
]
const DATA_SUBS = [
  { id: 'trending-cg', label: 'Trending' },
  { id: 'top-gainers', label: 'Gainers' },
  { id: 'top-losers', label: 'Losers' },
  { id: 'new-pairs', label: 'New Pairs' },
  { id: 'volume-leaders', label: 'Volume' },
  { id: 'most-traded', label: 'Most Traded' },
  { id: 'screener', label: 'Screener' },
]
const SOCIAL_SUBS = [
  { id: 'social-mentions', label: 'Mentions' },
  { id: 'social-momentum', label: 'Momentum' },
  { id: 'social-conviction', label: 'Conviction' },
  { id: 'holders-growth', label: 'Holders Growth' },
]
// Social tab's right-most metric column varies by sub-filter (real fields only).
const SOCIAL_METRIC = {
  'social-mentions': { label: 'Mentions', get: (r) => fmtCount(r.mentions), sortVal: (r) => Number(r.mentions) },
  'social-momentum': { label: 'Velocity', get: (r) => (Number(r.velocity) > 0 ? `${Number(r.velocity).toFixed(1)}x` : '—'), sortVal: (r) => Number(r.velocity) },
  'social-conviction': { label: 'KOLs', get: (r) => fmtCount(r.authors), sortVal: (r) => Number(r.authors) },
  'holders-growth': { label: 'Holders', get: (r) => fmtCount(r.holders), sortVal: (r) => Number(r.holders) },
}

// Left-rail vertical-nav glyphs (warm-white monochrome) keyed by dataset id.
const RAIL_GLYPH = {
  'trending-cg': 'spectre', 'top-gainers': 'gain', 'top-losers': 'loss', 'new-pairs': 'new',
  'volume-leaders': 'volume', 'most-traded': 'traded', 'screener': 'sectors',
  'social-mentions': 'social', 'social-momentum': 'momentum', 'social-conviction': 'conviction', 'holders-growth': 'whale',
}

// Inline SVG glyphs - warm-white monochrome (still used by the customize drawer + mark).
function SectionGlyph({ name, color }) {
  const stroke = color || 'currentColor'
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke, strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (name) {
    case 'spectre':  return <svg {...common}><path d="M3 12h4l2-6 4 12 2-9 2 6 4-3" /></svg>
    case 'gain':     return <svg {...common}><path d="M3 17l6-6 4 4 8-8M14 7h7v7" /></svg>
    case 'loss':     return <svg {...common}><path d="M3 7l6 6 4-4 8 8M14 17h7v-7" /></svg>
    case 'volume':   return <svg {...common}><path d="M4 14V8M9 18V6M14 14v-4M19 20V4" /></svg>
    case 'new':      return <svg {...common}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>
    case 'sectors':  return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
    case 'traded':   return <svg {...common}><path d="M17 3h4v4M21 3l-7 7" /><path d="M7 21H3v-4M3 21l7-7" /><circle cx="12" cy="12" r="3" /></svg>
    case 'whale':    return <svg {...common}><path d="M3 13c4 4 10 4 14 0M9 9h.01M3 13c0-4 4-7 9-7s9 3 9 7" /><path d="M16 16l3 3M19 13l2-1" /></svg>
    case 'social':   return <svg {...common}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
    case 'momentum': return <svg {...common}><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" /></svg>
    case 'conviction': return <svg {...common}><circle cx="12" cy="8" r="3" /><circle cx="6" cy="14" r="2" /><circle cx="18" cy="14" r="2" /><path d="M12 11v3M9 14h6" /></svg>
    case 'dossier':  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>
    default:         return null
  }
}

// Section defs - kept for the customize drawer (data-feed toggles gate which Codex
// datasets get fetched). Accent stays warm-white monochrome; color lives on values.
const SECTION_DEFS = [
  { id: 'trending-cg',     glyph: 'spectre',  accent: '#f5f5f7', title: 'Spectre Pulse',    desc: 'Names accelerating across the global market.' },
  { id: 'top-gainers',     glyph: 'gain',     accent: '#f5f5f7', title: 'Top Gainers',      desc: 'Biggest movers in the selected timeframe.' },
  { id: 'top-losers',      glyph: 'loss',     accent: '#f5f5f7', title: 'Top Losers',       desc: 'Largest drawdowns - dip hunting territory.' },
  { id: 'volume-leaders',  glyph: 'volume',   accent: '#f5f5f7', title: 'Volume Leaders',   desc: 'Where capital is rotating right now.' },
  { id: 'new-pairs',       glyph: 'new',      accent: '#f5f5f7', title: 'New Pairs',        desc: 'Recently created on-chain pools.' },
  { id: 'categories',      glyph: 'sectors',  accent: '#f5f5f7', title: 'Sectors',          desc: 'Sector-level momentum across the market.' },
  { id: 'most-traded',     glyph: 'traded',   accent: '#f5f5f7', title: 'Most Traded',      desc: 'Top transaction counts in timeframe.' },
  { id: 'dossier-signals', glyph: 'dossier',  accent: '#f5f5f7', title: 'Dossier Signals',  desc: 'Brain breakouts, safety flips and trend signals.' },
  { id: 'social-mentions', glyph: 'social',   accent: '#f5f5f7', title: 'Social Mentions',  desc: 'Most-mentioned tickers across X right now.' },
  { id: 'social-momentum', glyph: 'momentum', accent: '#f5f5f7', title: 'Social Momentum',  desc: 'Mentions accelerating - velocity of attention.' },
  { id: 'social-conviction', glyph: 'conviction', accent: '#f5f5f7', title: 'High Conviction', desc: 'Top KOLs converging on the same names.' },
  { id: 'holders-growth',  glyph: 'whale',    accent: '#f5f5f7', title: 'Holders Growth',   desc: 'Tokens with the largest holder base, by chain.' },
]

const DEFAULT_PREFS = {
  visibleSections: ['trending-cg', 'top-gainers', 'top-losers', 'volume-leaders', 'new-pairs', 'most-traded', 'social-mentions', 'social-momentum', 'social-conviction', 'holders-growth', 'dossier-signals', 'categories'],
  defaultChain: 'all',
  defaultTimeframe: '24h',
  sectionOrder: SECTION_DEFS.map((s) => s.id),
  // Membership only - display order comes from CHAIN_OPTIONS. Listed in the
  // same order purely so the two read alike.
  visibleChains: ['all', 'sol', 'eth', 'hood', 'bsc', 'base', 'arb'],
  density: 'big', // 'compact' | 'comfortable' | 'big'
  visibleColumns: { price: true, change: true, mcap: true, volume: true, liquidity: false },
  rowsPerCard: 7,
  runnersHeight: 118,   // expanded height of the Potential Runners bottom dock (px) - slim cards, no sparkline
  runnersCollapsed: false,
  runnersFilter: 'x', // 'all' | 'x' — default to X-Confirmed (runners the market is tweeting about)
  socialView: 'list',   // 'list' | 'heatmap' — Social tab: table vs mindshare heatmap
  marketView: 'list',   // 'list' | 'heatmap' — Markets tab: dense table vs perf treemap
  // AI Read column. OFF by default (2026-09-01): every board load used to fire
  // an LLM brief for the top 40 rows plus one per row scrolled into view, on a
  // board that reloads on every chain/timeframe/view change. That is a large,
  // permanent model bill for a column most sessions never read. It is now a
  // deliberate switch in the Markets bar - flip it on and the batch + viewport
  // pipeline behaves exactly as before.
  aiRead: false,
  // 'all' | 'safe' — hide rows the numbers fault (see gradeGtRow). Default 'all'
  // so nothing silently disappears from a board a user already knows.
  riskFilter: 'all',
}

const PREFS_KEY = 'spectre-trending-prefs'

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const saved = JSON.parse(raw)
    // Union saved visible sections with any newly-shipped sections so adding sections
    // server-side automatically becomes visible for users with stale localStorage.
    const visibleSections = Array.from(new Set([
      ...(saved.visibleSections || []),
      ...DEFAULT_PREFS.visibleSections,
    ]))
    const sectionOrder = Array.from(new Set([
      ...(saved.sectionOrder || []),
      ...DEFAULT_PREFS.sectionOrder,
    ]))
    const merged = { ...DEFAULT_PREFS, ...saved, visibleSections, sectionOrder }
    // One-time migration: adopt the X-Confirmed runners default. Flips a legacy
    // 'all' once (persisting a flag), then respects whatever the user picks after.
    if (!saved._runnersDefaultV2) {
      merged.runnersFilter = 'x'
      merged._runnersDefaultV2 = true
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(merged)) } catch { /* private mode */ }
    }
    // One-time migration: slim runners dock (sparkline removed 2026-07-03) -
    // clamp a saved taller height down once; user can drag it back if wanted.
    if (!saved._runnersSlimV1) {
      merged.runnersHeight = Math.min(merged.runnersHeight || 118, 118)
      merged._runnersSlimV1 = true
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(merged)) } catch { /* private mode */ }
    }
    // One-time migration: surface the Robinhood Chain pill for users whose saved
    // visibleChains predate it (2026-07). Respects whatever they pick after.
    if (!saved._hoodChainV1) {
      if (!merged.visibleChains.includes('hood')) merged.visibleChains = [...merged.visibleChains, 'hood']
      merged._hoodChainV1 = true
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(merged)) } catch { /* private mode */ }
    }
    return merged
  } catch { return DEFAULT_PREFS }
}
function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)) } catch {} }

const fmtUSD = (n) => {
  if (n == null || isNaN(Number(n)) || Number(n) === 0) return '—'
  const v = Number(n)
  if (v >= 1e12) return `$${(v/1e12).toFixed(2)}T`
  if (v >= 1e9) return `$${(v/1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v/1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v/1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}
const fmtPrice = (n) => {
  const v = Number(n)
  if (!isFinite(v) || isNaN(v)) return '$0.00'
  if (v >= 1000) return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (v >= 1) return `$${v.toFixed(4)}`
  if (v >= 0.0001) return `$${v.toFixed(6)}`
  if (v > 0) return `$${v.toFixed(8)}`
  return '$0.00'
}
const fmtPct = (n) => {
  const v = Number(n)
  if (!isFinite(v) || isNaN(v)) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}
// Compact extreme percentages so fresh pump.fun tokens (ANSEM 7D = +39,318%) don't
// blow out the column: |pct| >= 1000 → `k` form (+39.3k% / +2.5k%); normal 2-dec below.
const fmtPctCompact = (n) => {
  const v = Number(n)
  if (!isFinite(v) || isNaN(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1000) {
    const k = v / 1000
    const d = a >= 100000 ? 0 : 1
    return `${v >= 0 ? '+' : ''}${k.toFixed(d)}k%`
  }
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}
function fmtCount(n) {
  const v = Number(n)
  if (!isFinite(v) || v <= 0) return '—'
  if (v >= 1e6) return `${(v/1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v/1e3).toFixed(1)}K`
  return `${Math.round(v)}`
}
function fmtAge(createdAt) {
  if (createdAt == null) return '—'
  let ts = Number(createdAt)
  if (!isFinite(ts) || ts <= 0) return '—'
  if (ts < 1e12) ts *= 1000 // seconds -> ms
  const diff = Date.now() - ts
  if (diff < 0) return '—'
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo`
  return `${Math.floor(d / 365)}y`
}

// Real token genesis for established majors. The AGE column reads the DEX pair /
// token createdAt, which badly understates majors (SOL's pool is ~2y old, but
// Solana launched 2020). Keyed by uppercase symbol; only ever makes a token
// OLDER (genesis vs createdAt), so a low-cap clone that reuses a major's ticker
// can't be mis-aged — it keeps its own younger pair age.
const MAJOR_GENESIS_MS = {
  BTC: Date.UTC(2009, 0, 3), ETH: Date.UTC(2015, 6, 30), SOL: Date.UTC(2020, 2, 16),
  BNB: Date.UTC(2017, 6, 8), XRP: Date.UTC(2012, 5, 2), ADA: Date.UTC(2017, 8, 29),
  AVAX: Date.UTC(2020, 8, 21), DOGE: Date.UTC(2013, 11, 6), TRX: Date.UTC(2017, 7, 28),
  LINK: Date.UTC(2017, 8, 20), DOT: Date.UTC(2020, 7, 18), LTC: Date.UTC(2011, 9, 7),
  MATIC: Date.UTC(2019, 3, 26), POL: Date.UTC(2019, 3, 26), XTZ: Date.UTC(2018, 5, 30),
  ATOM: Date.UTC(2019, 2, 13), NEAR: Date.UTC(2020, 9, 13), APT: Date.UTC(2022, 9, 17),
  SUI: Date.UTC(2023, 4, 3), ARB: Date.UTC(2023, 2, 23), OP: Date.UTC(2022, 4, 31),
  INJ: Date.UTC(2020, 9, 21), UNI: Date.UTC(2020, 8, 17), AAVE: Date.UTC(2020, 9, 2),
  XLM: Date.UTC(2014, 6, 31), ETC: Date.UTC(2016, 6, 20), BCH: Date.UTC(2017, 7, 1),
}
// Resolve the age timestamp for a row, promoting known majors to their real genesis.
function rowAgeTs(row) {
  const sym = (row?.symbol || '').toString().toUpperCase().replace(/^\$/, '')
  const genesis = MAJOR_GENESIS_MS[sym]
  let created = Number(row?.createdAt)
  if (isFinite(created) && created > 0 && created < 1e12) created *= 1000
  if (genesis && (!isFinite(created) || created <= 0 || genesis < created)) return genesis
  return (isFinite(created) && created > 0) ? created : row?.createdAt
}

// ── First-spotted alpha (radar date + first-seen market cap) ───────────────
// "First Spotted" = when X-Dash first put the token on the radar (its
// indexation_timestamp). "Spotted MC" = the FIRST market cap WE ever observed
// the token at — a client-side ledger, write-once, so the social board can tell
// the "caught it at $2M, now $50M" story. Honest by construction: it only starts
// accumulating from the moment a user first loads the feed.

// ISO string / epoch → compact radar age ("just now", "5h", "3d", "2mo"); '—' if absent.
function fmtSpottedAge(iso) {
  if (iso == null || iso === '') return '—'
  const ts = typeof iso === 'number' ? iso : Date.parse(iso)
  if (!isFinite(ts) || ts <= 0) return '—'
  const diff = Date.now() - ts
  if (diff < 0) return '—'
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo`
  return `${Math.floor(d / 365)}y`
}
// Full human date for the Spotted-column tooltip.
function fmtSpottedDate(iso) {
  if (iso == null || iso === '') return ''
  const ts = typeof iso === 'number' ? iso : Date.parse(iso)
  if (!isFinite(ts) || ts <= 0) return ''
  try { return `First spotted ${new Date(ts).toLocaleString()}` } catch { return '' }
}
// Growth multiple since first spotted: "0.42×" / "1.30×" / "25.4×" / "1240×".
function fmtMultiple(mult) {
  const v = Number(mult)
  if (!isFinite(v) || v <= 0) return '—'
  if (v >= 100) return `${Math.round(v).toLocaleString('en-US')}×`
  if (v >= 10) return `${v.toFixed(1)}×`
  return `${v.toFixed(2)}×`
}

// localStorage ledger of the first mcap we ever saw a token at (SSR/quota-safe,
// write-once, capped ~500 by evicting the oldest so it can't grow unbounded).
const FIRST_SPOTTED_KEY = 'spectre-first-spotted-v1'
const FIRST_SPOTTED_CAP = 500
let _firstSpottedMap = null // in-memory mirror — per-row reads never reparse LS
function firstSpottedMap() {
  if (_firstSpottedMap) return _firstSpottedMap
  try {
    const raw = localStorage.getItem(FIRST_SPOTTED_KEY)
    const obj = raw ? JSON.parse(raw) : {}
    _firstSpottedMap = (obj && typeof obj === 'object') ? obj : {}
  } catch { _firstSpottedMap = {} }
  return _firstSpottedMap
}
// key = uppercased $-stripped symbol, falling back to the address.
const spottedKey = (symbol, address) => {
  const s = (symbol || '').toString().toUpperCase().replace(/^\$/, '').trim()
  return s || (address || '').toString().toLowerCase().trim()
}
function recordFirstSpotted(key, mcap) {
  const m = Number(mcap)
  if (!key || !isFinite(m) || m <= 0) return
  const map = firstSpottedMap()
  if (map[key]) return // write-once — never overwrite the earliest sighting
  map[key] = { mcap: m, ts: Date.now() }
  try {
    let toSave = map
    const keys = Object.keys(map)
    if (keys.length > FIRST_SPOTTED_CAP) {
      const sorted = keys.map((k) => [k, map[k]]).sort((a, b) => (a[1]?.ts || 0) - (b[1]?.ts || 0))
      toSave = {}
      for (const [k, v] of sorted.slice(sorted.length - FIRST_SPOTTED_CAP)) toSave[k] = v
      _firstSpottedMap = toSave
    }
    localStorage.setItem(FIRST_SPOTTED_KEY, JSON.stringify(toSave))
  } catch { /* quota / SSR — keep the in-memory value, non-fatal */ }
}
function getFirstSpotted(key) {
  if (!key) return null
  const v = firstSpottedMap()[key]
  const m = Number(v?.mcap)
  return (isFinite(m) && m > 0) ? { mcap: m, ts: Number(v.ts) || 0 } : null
}
// Record the current mcap for a batch of rows as the feed loads (write-once each).
function recordFirstSpottedRows(rows) {
  for (const r of rows || []) recordFirstSpotted(spottedKey(r.symbol, r.address), r.marketCap)
}
// ── Real X-Dash "first surfaced" ROI (momentum-origin) ─────────────────────
// The AUTHORITATIVE source for Spotted / Spotted MC / Since. X-Dash owns these
// ROIs — its token drawer shows e.g. KINS "first surfaced $1.17M → +1092%,
// peak +1716%". GET /api/xdash/momentum-origin/{cgId} →
//   { data: { entry_market_cap, first_entered_at, roi_pct, peak_roi_pct, ... } }
// (some responses put the fields at the top level → handle `json.data ?? json`).

// Scoped override — one token's origin tracker recorded a bad late re-entry. Port of
// the research app's momentum-overrides.js: when a token's cgId is in this map, IGNORE
// the fetched origin and use this entry_market_cap (roi recomputed from live mcap).
// ANSEM (the-black-bull) must read entry ~$5.85M / ~15.5×, NOT the origin's $90M/0%.
const MOMENTUM_ENTRY_OVERRIDE = {
  'the-black-bull': { entry_market_cap: 5847740.349880813 }, // ANSEM
}

const MOM_ORIGIN_KEY = 'spectre-mom-origin-v1'
const MOM_ORIGIN_TTL = 15 * 60 * 1000 // 15 min — roi_pct drifts with live mcap
const _momOriginMem = new Map()       // cgId -> { origin, ts } (in-memory mirror of LS)
const _momOriginInflight = new Map()  // cgId -> Promise (in-flight dedup)
let _momOriginHydrated = false

function hydrateMomOrigin() {
  if (_momOriginHydrated) return
  _momOriginHydrated = true
  try {
    const raw = localStorage.getItem(MOM_ORIGIN_KEY)
    const obj = raw ? JSON.parse(raw) : {}
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object') _momOriginMem.set(k, { origin: v.origin ?? null, ts: Number(v.ts) || 0 })
      }
    }
  } catch { /* SSR / corrupt — start empty */ }
}
function writeMomOrigin(cgId, origin) {
  _momOriginMem.set(cgId, { origin: origin || null, ts: Date.now() })
  try {
    let entries = [..._momOriginMem.entries()]
    if (entries.length > 600) { // cap — evict oldest
      entries.sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0))
      entries = entries.slice(entries.length - 600)
      _momOriginMem.clear()
      for (const [k, v] of entries) _momOriginMem.set(k, v)
    }
    const obj = {}
    for (const [k, v] of entries) obj[k] = { origin: v.origin, ts: v.ts }
    localStorage.setItem(MOM_ORIGIN_KEY, JSON.stringify(obj))
  } catch { /* quota / SSR — keep the in-memory value */ }
}
// Normalize the endpoint payload (fields may sit under .data or at the top level).
function normalizeMomOrigin(json) {
  const d = (json && typeof json === 'object') ? (json.data ?? json) : null
  if (!d || typeof d !== 'object') return null
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : null }
  const entry_market_cap = num(d.entry_market_cap)
  const roi_pct = num(d.roi_pct)
  if (entry_market_cap == null && roi_pct == null) return null // nothing usable
  return {
    entry_market_cap,
    first_entered_at: d.first_entered_at || null,
    entry_rank: num(d.entry_rank),
    entry_mentions: num(d.entry_mentions),
    peak_market_cap: num(d.peak_market_cap),
    peak_at: d.peak_at || null,
    last_market_cap: num(d.last_market_cap),
    last_seen_at: d.last_seen_at || null,
    roi_pct,
    peak_roi_pct: num(d.peak_roi_pct),
  }
}
// Fetch the momentum-origin for a cgId — cached (15-min TTL) + in-flight deduped.
// Resolves to the normalized origin object, or null (no data / error).
async function fetchMomentumOrigin(cgId) {
  if (!cgId || !/^[a-z0-9-]+$/.test(cgId)) return null
  hydrateMomOrigin()
  const mem = _momOriginMem.get(cgId)
  if (mem && (Date.now() - mem.ts) <= MOM_ORIGIN_TTL) return mem.origin
  if (_momOriginInflight.has(cgId)) return _momOriginInflight.get(cgId)
  const p = (async () => {
    try {
      const res = await fetch(`/api/xdash/momentum-origin/${encodeURIComponent(cgId)}`, { signal: AbortSignal.timeout(6000) })
      if (!res.ok) { writeMomOrigin(cgId, null); return null }
      const json = await res.json().catch(() => null)
      const origin = normalizeMomOrigin(json)
      writeMomOrigin(cgId, origin) // caches null too (negative cache for empty results)
      return origin
    } catch {
      return null // transient (timeout/network) — do NOT negative-cache; retry next cycle
    } finally {
      _momOriginInflight.delete(cgId)
    }
  })()
  _momOriginInflight.set(cgId, p)
  return p
}
// Resolve momentum-origin for the ~30 visible rows in the BACKGROUND — bounded
// concurrency (4), cached + deduped. On resolve, the matching current-state rows get
// their `origin` filled in (keyed by cgId, robust against a fresh reload) and the
// setter re-fires so the table fills in live. Override tokens are skipped (they IGNORE
// the fetched origin). Never blocks render.
async function resolveMomentumOrigins(rows, setter) {
  // Fetch the origin for EVERY resolvable token — including override tokens (ANSEM):
  // the override still wins for entry/ROI, but the origin carries `peak_market_cap`
  // which we need to derive the token's Peak ROI.
  const pending = (rows || []).filter((r) => r && r.cgId && /^[a-z0-9-]+$/.test(r.cgId) && !r.originResolved)
  if (pending.length === 0) return
  const resolved = new Map() // cgId -> origin | null
  let idx = 0
  let dirty = false
  let flushTimer = null
  const flush = () => {
    flushTimer = null
    if (!dirty) return
    dirty = false
    setter((s) => {
      const cur = Array.isArray(s.rows) ? s.rows : []
      let changed = false
      for (const r of cur) {
        if (r && r.cgId && !r.originResolved && resolved.has(r.cgId)) {
          r.origin = resolved.get(r.cgId)
          r.originResolved = true
          changed = true
        }
      }
      return changed ? { ...s, rows: [...cur] } : s
    })
  }
  const scheduleFlush = () => { if (flushTimer == null) flushTimer = setTimeout(flush, 140) }
  const worker = async () => {
    while (idx < pending.length) {
      const row = pending[idx++]
      let origin = null
      try { origin = await fetchMomentumOrigin(row.cgId) } catch { origin = null }
      resolved.set(row.cgId, origin || null)
      dirty = true
      scheduleFlush()
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, () => worker()))
  if (flushTimer != null) { clearTimeout(flushTimer); flushTimer = null }
  flush()
}

// ── Per-token AI dossier (server /api/trending/brief) ──────────────────────
// On-demand only (click), cached 15 min client-side to mirror the server TTL.
const _briefCache = new Map()
const _briefInflight = new Map()
const BRIEF_TTL = 15 * 60 * 1000
// Instant paint across page refreshes: seed the cache from sessionStorage so
// known reads render at first commit with ZERO shimmer (the mount batch still
// revalidates against the server - this only removes the round-trip flash).
const BRIEF_SS_KEY = 'th-briefs-v1'
try {
  const now = Date.now()
  for (const [k, v] of JSON.parse(sessionStorage.getItem(BRIEF_SS_KEY) || '[]')) {
    if (v && v.data && now - v.ts < BRIEF_TTL) _briefCache.set(k, v)
  }
} catch { /* cosmetic only */ }
// Pickup backoff: the server answers pending rows the moment its background
// generation lands (cache-fast responses) - poll quickly at first, then ease
// off. A fixed 22s tick was the "read takes 10s+" feel. The 30s tail keeps
// asking through a deep LLM backlog (local Ollama grinds ~6s/read) - giving
// up while rows are still queued server-side left permanent shimmers.
const BRIEF_POLL_MS = [2500, 4000, 6000, 9000, 14000, 22000, 22000, 22000, 22000, 30000, 30000, 30000, 30000, 30000]
// Prod without the /api/trending serverless mirror 404s the batch endpoint -
// degrade to a quiet dash instead of shimmering forever, and stop asking.
let _briefsDown = false
const briefsServiceDown = () => _briefsDown
let _briefSsTimer = null
function persistBriefCache() {
  if (_briefSsTimer) return
  _briefSsTimer = setTimeout(() => {
    _briefSsTimer = null
    try {
      sessionStorage.setItem(BRIEF_SS_KEY, JSON.stringify([..._briefCache.entries()].slice(-120)))
    } catch { /* quota - drop */ }
  }, 800)
}
async function fetchTokenBrief(row) {
  const key = `${row.networkId || 0}:${(row.address || row.symbol || '').toLowerCase()}`
  const hit = _briefCache.get(key)
  if (hit && Date.now() - hit.ts < BRIEF_TTL) return hit.data
  if (_briefInflight.has(key)) return _briefInflight.get(key)
  const params = new URLSearchParams({
    symbol: row.symbol || '',
    name: row.name || '',
    ca: row.address || '',
    networkId: String(row.networkId || ''),
    chain: netLabel(row.networkId) || '',
    mcap: String(row.marketCap || ''),
    vol24: String(row.volume24 || ''),
    liq: String(row.liquidity || ''),
    change24: String(row.change || ''),
    change1h: String(row.change1h || ''),
    txns: String(row.txns || ''),
  })
  const ageTs = rowAgeTs(row)
  if (ageTs) params.set('ageH', String(Math.max(0, Math.round((Date.now() - ageTs) / 36e5))))
  if (row.cgId) params.set('cgId', row.cgId)
  const p = (async () => {
    try {
      const res = await fetch(`/api/trending/brief?${params}`, { signal: AbortSignal.timeout(26000) })
      if (res.status === 404) _briefsDown = true
      if (!res.ok) throw new Error(`brief ${res.status}`)
      const data = await res.json()
      _briefCache.set(key, { data, ts: Date.now() })
      persistBriefCache()
      return data
    } finally {
      _briefInflight.delete(key)
    }
  })()
  _briefInflight.set(key, p)
  return p
}

// Shared brief cache key (matches the server + single-brief fetcher).
const briefKeyFor = (row) => `${row.networkId || ''}:${(row.address || row.symbol || '').toLowerCase()}`

// Batch-fill briefs for the visible board. The server answers INSTANTLY with
// whatever its cache holds plus a `pending` key list for rows its LLM is
// still writing in the background - callers re-poll pending rows until they
// land. Results share the popover's module cache, so click-through is instant.
let _briefsBatchInflight = null
async function fetchTokenBriefsBatch(rows) {
  // Single-flight: StrictMode double-effects and poll ticks must not stack
  // concurrent batch POSTs (the server rate-limits them).
  if (_briefsBatchInflight) { try { await _briefsBatchInflight } catch { /* refire below */ } }
  const want = []
  const out = new Map()
  let pendingKeys = []
  for (const row of rows) {
    const key = briefKeyFor(row)
    const hit = _briefCache.get(key)
    if (hit && Date.now() - hit.ts < BRIEF_TTL) { out.set(key, hit.data); continue }
    const ageTs = rowAgeTs(row)
    want.push({
      symbol: row.symbol || '',
      name: row.name || '',
      ca: row.address || '',
      networkId: row.networkId || '',
      cgId: row.cgId || '',
      chain: netLabel(row.networkId) || '',
      mcap: row.marketCap || '',
      vol24: row.volume24 || '',
      liq: row.liquidity || '',
      change24: row.change || '',
      change1h: row.change1h || '',
      txns: row.txns || '',
      ageH: ageTs ? Math.max(0, Math.round((Date.now() - ageTs) / 36e5)) : '',
      mentions: row.mentions || '',
      authors: row.authors || '',
      velocity: row.velocity || '',
      kols: Array.isArray(row.kols) ? row.kols.map((k) => k.screen_name || k.name).filter(Boolean).slice(0, 4) : [],
    })
  }
  if (want.length) {
    const run = (async () => {
    const res = await fetch('/api/trending/briefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokens: want }),
      signal: AbortSignal.timeout(20000), // cache-answer endpoint - always fast
    })
    if (res.status === 404) _briefsDown = true
    if (res.ok) {
      const json = await res.json().catch(() => null)
      const briefs = json && json.briefs ? json.briefs : {}
      for (const [key, data] of Object.entries(briefs)) {
        // Stale-served reads display now but stay refetchable: a short client
        // clock re-asks within ~2 min and picks up the background rewrite.
        _briefCache.set(key, { data, ts: data && data.stale ? Date.now() - BRIEF_TTL + 2 * 60 * 1000 : Date.now() })
        out.set(key, data)
      }
      if (Object.keys(briefs).length) persistBriefCache()
      if (Array.isArray(json && json.pending)) pendingKeys = json.pending
    }
    })()
    _briefsBatchInflight = run
    try { await run } finally { _briefsBatchInflight = null }
  }
  return { map: out, pendingKeys }
}

// Compact ROI percent for the Since column: "+1092%" / "+34%" / "-9.3%".
function fmtRoiPct(pct) {
  const v = Number(pct)
  if (!isFinite(v)) return '—'
  const d = Math.abs(v) >= 10 ? 0 : 1
  return `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`
}

// ── Row-level readers (override-aware) — reused by the columns AND the sort getters.
// Priority: scoped override → REAL momentum-origin → payload momentum_entry →
// client-side first-spotted ledger.
const rowOverrideEntry = (r) => {
  const m = Number(r?.cgId ? MOMENTUM_ENTRY_OVERRIDE[r.cgId]?.entry_market_cap : NaN)
  return (isFinite(m) && m > 0) ? m : null
}
// Spotted MC / Since pending — for OVERRIDE tokens these read from the override
// (immediate), so only non-override rows shimmer on those two columns.
const rowOriginPending = (r) =>
  !!(r && r.cgId && /^[a-z0-9-]+$/.test(r.cgId) && !MOMENTUM_ENTRY_OVERRIDE[r.cgId] && !r.originResolved)
// Peak pending — Peak needs the origin's peak mcap for EVERY token (override too),
// so it shimmers until the origin resolves regardless of override.
const rowPeakPending = (r) =>
  !!(r && r.cgId && /^[a-z0-9-]+$/.test(r.cgId) && !r.originResolved)
const rowSpottedTs = (r) => {
  // Prefer the momentum-origin first-entered date; fall back to momentum_entry, then
  // indexation. Override tokens IGNORE the origin date (their origin is the wrong late
  // re-entry — that's why they're overridden) and use the momentum_entry date instead.
  const iso = (rowOverrideEntry(r) == null ? r?.origin?.first_entered_at : null) || r?.spottedAt || r?.firstSeenAt
  if (iso == null || iso === '') return null
  const ts = typeof iso === 'number' ? iso : Date.parse(iso)
  return (isFinite(ts) && ts > 0) ? ts : null
}
const rowSpottedMc = (r) => {
  const ov = rowOverrideEntry(r)
  if (ov != null) return ov
  const om = Number(r?.origin?.entry_market_cap)
  if (isFinite(om) && om > 0) return om
  const mc = Number(r?.spottedMc)
  if (isFinite(mc) && mc > 0) return mc
  const fs = getFirstSpotted(spottedKey(r?.symbol, r?.address))
  return fs ? fs.mcap : null
}
// ROI since first surfaced, as a PERCENT (e.g. +1092.3). Used by the Since column + sort.
const rowRoiPct = (r) => {
  const cur = Number(r?.marketCap)
  const ov = rowOverrideEntry(r)
  if (ov != null) return (isFinite(cur) && cur > 0) ? (cur / ov - 1) * 100 : null
  const rp = Number(r?.origin?.roi_pct)
  if (isFinite(rp)) return rp
  const entry = rowSpottedMc(r)
  if (isFinite(entry) && entry > 0 && isFinite(cur) && cur > 0) return (cur / entry - 1) * 100
  const pct = r?.sinceReturn
  if (pct != null && isFinite(Number(pct))) return Number(pct)
  return null
}
// Peak ROI percent since first surfaced. For override tokens (ANSEM) the origin's
// peak_roi_pct is relative to its WRONG entry, so recompute from the origin's peak
// market cap over the CORRECT override entry (e.g. $90.9M / $5.85M → +1454%).
const rowPeakPct = (r) => {
  const ov = rowOverrideEntry(r)
  if (ov != null) {
    const peakMc = Number(r?.origin?.peak_market_cap)
    return (isFinite(peakMc) && peakMc > 0) ? (peakMc / ov - 1) * 100 : null
  }
  const p = Number(r?.origin?.peak_roi_pct)
  return isFinite(p) ? p : null
}
// Sort value for the Since column = the numeric roi percent.
const rowSince = (r) => rowRoiPct(r)

// ── Potential Runners signal ──────────────────────────────────────────────
// Compact +/-% for the runner strip (fewer decimals than fmtPct): "+512%" / "+8.3%".
function fmtPctShort(n) {
  const v = Number(n)
  if (!isFinite(v) || isNaN(v)) return '—'
  const a = Math.abs(v)
  const d = a >= 100 ? 0 : a >= 10 ? 1 : 2
  return `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`
}
function runnerAgeMs(createdAt) {
  let ts = Number(createdAt)
  if (!isFinite(ts) || ts <= 0) return null
  if (ts < 1e12) ts *= 1000
  const a = Date.now() - ts
  return a >= 0 ? a : null
}
// Derive a "runner" signal from data ALREADY loaded (no new fetch). A runner is a
// small-cap name with real, accelerating upside momentum and genuine turnover —
// the shape of an early mover. We SCORE (never hard-call), dedupe by symbol, top 15.
// Descriptive only; the UI labels it "not financial advice".
function computeRunners(rows, limit = 15) {
  const seen = new Map()
  for (const r of rows || []) {
    const sym = (r.symbol || '').toUpperCase()
    if (!sym) continue
    const mcap = Number(r.marketCap) || 0
    const vol = Number(r.volume24) || 0
    const c24 = Number(r.change) || 0
    const c1 = Number(r.change1h) || 0
    const c6 = Number(r.change4h) || 0 // 6h approx (datasets carry no true 6h)
    // Gates: must be moving up, have real volume, and not be a megacap. The 24h
    // floor is intentionally modest (4%) so flat-market sessions still surface
    // early movers — the score below still ranks the strong ones to the top, and
    // X-Confirmed adds the social-validation layer on top.
    if (c24 < 4) continue
    if (vol < 15000) continue
    if (mcap > 250e6) continue
    // Depth gate. A "runner" you cannot exit is not a runner: ROBINCAT led this
    // tape at +8,028% on a pool holding no reserves at all, and GPRO printed
    // +203,674% out of a pool hours old. Rows that actually REPORT depth (every
    // GeckoTerminal chain, plus any Codex row carrying liquidity) are held to
    // the safety read; social rows, which carry CG size but no pool data, are
    // untouched so X-Confirmed keeps working.
    const liq = Number(r.liquidity)
    const hasDepthData = Number.isFinite(liq) && (liq > 0 || Number(r.poolCount) > 0)
    if (hasDepthData && rowSafety(r)?.grade === 'risky') continue
    // Small-cap headroom — favor sub-$10M, taper up to ~$100M, unknown = neutral.
    const headroom =
      mcap <= 0    ? 0.45 :
      mcap < 1e6   ? 1 :
      mcap < 3e6   ? 0.92 :
      mcap < 10e6  ? 0.78 :
      mcap < 30e6  ? 0.5 :
      mcap < 100e6 ? 0.28 : 0.12
    // 24h magnitude, log-damped across +0..+500%.
    const mom = Math.min(1, Math.log10(1 + Math.max(0, c24)) / Math.log10(501))
    // Short-window acceleration — both 1h + 6h green = strongest.
    const accelDir = ((c1 > 0 ? 1 : 0) + (c6 > 0 ? 1 : 0)) / 2
    const accelMag = Math.min(1, (Math.max(0, c1) + Math.max(0, c6)) / 120)
    const accel = 0.5 * accelDir + 0.5 * accelMag
    // Turnover — real trading vs size (50% daily turnover = maxed).
    const turnover = mcap > 0 ? Math.min(1, (vol / mcap) / 0.5) : 0.4
    // Freshness — newer skews higher, but not required (36e5 ms = 1h).
    const ageMs = runnerAgeMs(r.createdAt)
    const fresh =
      ageMs == null         ? 0.35 :
      ageMs < 6 * 36e5      ? 1 :
      ageMs < 24 * 36e5     ? 0.8 :
      ageMs < 7 * 24 * 36e5 ? 0.55 : 0.3
    const score =
      0.30 * headroom +
      0.28 * mom +
      0.16 * accel +
      0.16 * turnover +
      0.10 * fresh
    const prev = seen.get(sym)
    if (!prev || score > prev._score) {
      const next = { ...r, _score: score }
      // Merge chain identity across duplicate sources: a social row may win on
      // score but lack networkId/CA that the Codex row carries (or vice versa).
      if (prev) {
        if (!next.networkId && prev.networkId) { next.networkId = prev.networkId; if (!isRealCa(next.address) && prev.address) next.address = prev.address }
        if (next.createdAt == null && prev.createdAt != null) next.createdAt = prev.createdAt
      }
      seen.set(sym, next)
    } else if (prev && !prev.networkId && r.networkId) {
      // Loser carries the chain identity the winner lacks - backfill in place.
      prev.networkId = r.networkId
      if (!isRealCa(prev.address) && r.address) prev.address = r.address
      if (prev.createdAt == null && r.createdAt != null) prev.createdAt = r.createdAt
    }
  }
  const ranked = [...seen.values()].sort((a, b) => b._score - a._score)
  return Number.isFinite(limit) ? ranked.slice(0, limit) : ranked
}

// ── X Dash chain resolution ────────────────────────────────────────────────
// The bootstrap token object DOES carry chain data (`chain` slug, `platforms`
// map, `contract_address`) - map it to our Codex networkIds so social rows get
// the RIGHT chain pill + a real CA (token-page opens resolve by address instead
// of a cg_id search). Unknown chains stay null → ChainBadge renders nothing.
const XDASH_CHAIN_TO_NET = {
  ethereum: 1, eth: 1,
  solana: 1399811149, sol: 1399811149,
  'binance-smart-chain': 56, bsc: 56, bnb: 56,
  base: 8453,
  'arbitrum-one': 42161, arbitrum: 42161,
  'polygon-pos': 137, polygon: 137,
  'optimistic-ethereum': 10, optimism: 10,
  avalanche: 43114,
}
const isRealCa = (a) => typeof a === 'string' && (/^0x[0-9a-fA-F]{40}$/.test(a) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a))
function xdashChainInfo(tk) {
  const chain = (tk?.chain || '').toString().toLowerCase()
  let networkId = XDASH_CHAIN_TO_NET[chain] || null
  const platforms = (tk?.platforms && typeof tk.platforms === 'object') ? tk.platforms : {}
  // Fall back to the first platform slug we recognize when `chain` is missing.
  if (!networkId) {
    for (const key of Object.keys(platforms)) {
      const net = XDASH_CHAIN_TO_NET[key.toLowerCase()]
      if (net) { networkId = net; break }
    }
  }
  // Address: prefer the CA on the resolved chain, then the top-level one.
  let address = null
  if (networkId) {
    const slug = Object.keys(XDASH_CHAIN_TO_NET).find((k) => XDASH_CHAIN_TO_NET[k] === networkId && isRealCa(platforms[k]))
    if (slug) address = platforms[slug]
  }
  if (!address && isRealCa(tk?.contract_address)) address = tk.contract_address
  return { networkId, address }
}

// Platform-wide change normalization (mirrors marketFormat.fmtChange /
// getChangeForTimeframe, which is how the Discover table renders the SAME
// feeds): Codex returns sub-100% moves as RATIOS (0.1501 = +15.01%) and
// >100% moves as plain percent (153 = +153%); DexScreener-merged fields are
// percent. The hub's own formatters (fmtPct/fmtPctCompact) do NOT normalize,
// so raw ratios rendered as "+0.15%" - every sub-100% change on every chain
// was wrong. Same |v| <= 1 heuristic as the rest of the app.
const normPct = (v) => {
  const n = parseFloat(v)
  if (!isFinite(n) || n === 0) return 0
  return Math.abs(n) <= 1 ? n * 100 : n
}

// Map Spectre screener result to our row shape.
// Server returns flat objects like { address, symbol, name, networkId, logo, price,
// volume24h, liquidity, marketCap, holders, change5m, change1h, change4h, change24h, txnCount24h }.
// Client mirror of the server's wash-volume heuristics (lib/token-safety.js).
// The raw Codex screener surfaces (board filler + Gainers/Volume/Most-Traded
// sections) sort by numbers bots fabricate, so every screener row passes this
// gate before display: bots cycling a thin pool (vol/liq > 300x - real DEX
// tokens top out ~100x), a large mcap fabricated on dust liquidity, or a
// dust pool doing six-figure volume. Fires only when liquidity is a known
// positive, so genuine no-liquidity-data rows are never dropped.
function isCleanRow(row) {
  const vol = Number(row.volume24) || 0
  const liq = Number(row.liquidity) || 0
  const mcap = Number(row.marketCap) || 0
  if (liq > 0) {
    // Wash-trading gate. 2026-08-18: 300 -> 100, measured on the live BSC
    // board: QUQ turned over 214x its pool and DEBIT 151x (both classic wash),
    // while the hottest LEGITIMATE launch on DexScreener's own board (CARE,
    // 1h old, +206%) ran only 27x. 100 keeps every real runner with room.
    if (vol > 0 && vol / liq > 100) return false
    // Cap-tiered fabricated-mcap rule - mirrors mcapLiqDropLimit() in
    // packages/server/lib/token-safety.js. Keep the two in sync.
    // 2026-08-18: big-cap tier 6000 -> 1500. A fake "USDT" at $731B mcap ran
    // 5887x and passed the old line by 2%; M21NT ($25B, 1872x) too. Highest
    // legit survivor measured 1021x, so 1500 sits in an empty band.
    if (mcap > 0 && mcap / liq > (mcap < 1_000_000 ? 200 : mcap < 20_000_000 ? 300 : 1500)) return false
    if (liq < 1000 && vol > 100_000) return false
  }
  return true
}

// Async rug screen for raw-screener rows (the engine screens its own rows
// server-side). One GET per board load, 30-min server cache per mint,
// fail-open: rows drop only on a confirmed RugCheck verdict (holder
// concentration / authority risks), never on missing data.
const _rugChecked = new Map() // mint -> drop:boolean
async function screenRowsSafety(rows) {
  const sol = rows
    .filter((r) => r.networkId === 1399811149 && typeof r.address === 'string' && r.address.length >= 32 && !_rugChecked.has(r.address))
    .slice(0, 40)
  if (!sol.length) return null
  try {
    const res = await fetch(`/api/trending/safety?mints=${sol.map((r) => encodeURIComponent(r.address)).join(',')}`, {
      signal: AbortSignal.timeout(9000),
    })
    if (!res.ok) return null
    const json = await res.json().catch(() => null)
    const verdicts = (json && json.verdicts) || {}
    for (const [mint, v] of Object.entries(verdicts)) {
      if (v && v.checked) _rugChecked.set(mint, !!v.drop)
    }
    const drops = new Set(Object.entries(verdicts).filter(([, v]) => v && v.drop).map(([m]) => m))
    return drops.size ? drops : null
  } catch { return null }
}

function mapCodexRow(r) {
  const t = r.token || {}
  return {
    address: r.address || t.address || t.id || '',
    symbol: r.symbol || t.symbol || '',
    name: r.name || t.name || '',
    networkId: r.networkId || t.networkId || 1,
    price: parseFloat(r.price ?? r.priceUSD ?? t.price) || 0,
    change5m: normPct(r.change5m),
    change1h: normPct(r.change1h ?? r.change1),
    change4h: normPct(r.change4h ?? r.change4),
    change: normPct(r.change24h ?? r.change24 ?? r.priceChange24),
    marketCap: parseFloat(r.marketCap || t.marketCap) || 0,
    volume24: parseFloat(r.volume24h ?? r.volume24 ?? t.volume24) || 0,
    liquidity: parseFloat(r.liquidity || t.liquidity) || 0,
    logo: r.logo || t.imageThumbUrl || t.imageBannerUrl || t.imageUrl || t.logo || '',
    holders: parseFloat(r.holders || t.holders) || 0,
    txns: parseInt(r.txnCount24h ?? r.txnCount24) || 0,
    createdAt: r.createdAt ?? r.createdTime ?? t.createdAt ?? null,
    // About column (replaced AI Read 2026-08-17): Codex token metadata carried
    // through the screener rows. Null-safe - rows without it render a dash.
    description: r.description || t.description || null,
    twitter: r.twitter || null,
    telegram: r.telegram || null,
    website: r.website || null,
  }
}

// Map a Project Discovery trending row (the /api/tokens/trending traction engine,
// as shaped by useCodexData's _mapTrendingResults for the Discover table) to our
// row shape. change4h slot carries the engine's DexScreener-merged 6h window.
function mapDiscoveryRow(t) {
  return {
    address: t.address || '',
    symbol: t.symbol || '',
    name: t.name || '',
    networkId: t.networkId || 1,
    price: Number(t.price) || 0,
    change5m: normPct(t.change5m),
    change1h: normPct(t.change1h),
    change4h: normPct(t.change6h ?? t.change4h),
    change: normPct(t.change24h ?? t.change),
    marketCap: Number(t.marketCap) || 0,
    volume24: Number(t.volume24h ?? t.volume24) || 0,
    liquidity: Number(t.liquidity) || 0,
    logo: t.logo || '',
    // Real when the engine has it (Robinhood Chain carries explorer holder
    // counts), 0 -> em dash everywhere else, exactly as before.
    holders: Number(t.holders) || 0,
    txns: Number(t.txnCount24 ?? t.txns) || 0,
    createdAt: t.createdAt ?? null,
    trendScore: t.trendScore ?? null,
    // About column - carried by the trending engine rows since 2026-08-17.
    description: t.description || null,
    twitter: t.twitter || null,
    telegram: t.telegram || null,
    website: t.website || null,
    tier: t.tier || 'moving',
  }
}

/**
 * Board for a chain Codex cannot screen (today: Robinhood Chain, 4663).
 *
 * It used to be fetched from GeckoTerminal IN THE BROWSER, which had two costs
 * that were visible on the board itself:
 *   - COVERAGE. GT caps `/pools` at 3 pages = 60 pools and its keyless tier is
 *     ~30 req/min PER IP (shared with the user's other tabs), so the sweep had
 *     to stay tiny. That rendered ~61 rows on a chain that actually carries
 *     ~349 discoverable tokens.
 *   - QUALITY. It was a raw pool dump in pool order. It never reached the spam
 *     filter, the safety sweep, the wash gate, the collapse penalty or the
 *     traction ranking every other chain's board runs through, so post-rug
 *     husks ranked on their own trailing volume.
 *
 * Both are server problems, so it now comes from the SAME traction engine as
 * every other chain (`/api/tokens/trending` -> chain roster -> DexScreener
 * hydration -> quality gates -> scoreTraction order), shared through the same
 * module cache, which also means every section of the hub reuses ONE fetch.
 *
 * The browser GT lane stays as the fallback: if the engine is cold, degraded or
 * unreachable, a shorter unranked board still beats a blank one.
 */
async function fetchChainOnlyBoard(networkId, timeframe = '24h') {
  try {
    const raw = (await prefetchTrending([networkId], timeframe)) || []
    if (raw.length) {
      const rows = raw.map(mapDiscoveryRow)
      // .map() makes a new array - carry the DATA timestamp across so the
      // freshness chip ages from when the numbers were read.
      rows.asOf = raw.asOf || Date.now()
      return rows
    }
  } catch { /* fall through to the browser lane */ }
  try {
    const rows = await fetchGtScreenerRows(networkId, { kind: 'top' })
    // The GT fallback IS fetched live, so its data age is its fetch time.
    rows.asOf = Date.now()
    return rows
  } catch {
    return []
  }
}

// Dedupe key for merging the trending lead with the volume-screen filler.
const rowDedupeKey = (r) => {
  const addr = (r.address || '').toLowerCase()
  return addr ? `${r.networkId || 0}:${addr}` : `sym:${(r.symbol || '').toUpperCase()}`
}

// The Discover table's "All" board is computed over these 3 chains
// (marketFormat.ALL_TREND_CHAINS). The trending engine caches per network set,
// so the hub must ask for the SAME set to get the IDENTICAL board.
const DISCOVERY_ALL_CHAINS = [1, 56, 1399811149]

function ChainPills({ value, onChange, compact = false, visibleChains }) {
  let list = CHAIN_OPTIONS
  if (visibleChains && visibleChains.length > 0) {
    list = CHAIN_OPTIONS.filter((c) => visibleChains.includes(c.id))
    // Always include "all" so user has an out
    if (!list.find((c) => c.id === 'all')) list = [CHAIN_OPTIONS[0], ...list]
  }
  if (compact) list = list.slice(0, 7)
  return (
    <div className="th-chain-pills">
      {list.map((c) => (
        <button
          key={c.id}
          className={`th-pill chain${value === c.id ? ' active' : ''}`}
          onClick={() => onChange(c.id)}
          title={c.label}
        >
          {c.short}
        </button>
      ))}
    </div>
  )
}

function TimeframePills({ value, onChange }) {
  return (
    <div className="th-tf-pills">
      {TIMEFRAME_OPTIONS.map((tf) => (
        <button
          key={tf.id}
          className={`th-pill${value === tf.id ? ' active' : ''}`}
          onClick={() => onChange(tf.id)}
        >
          {tf.label}
        </button>
      ))}
    </div>
  )
}

// Compact/Big density segmented toggle — shared by the Markets + Social control bars
// so the founder's "social needs the compact button" lands in the exact same spot.
function DensityToggle({ density, onChange }) {
  return (
    <div className="th-center-density" role="group" aria-label="Row density">
      <button
        type="button"
        className={`th-density-seg${density === 'compact' ? ' th-density-seg--active' : ''}`}
        onClick={() => onChange('compact')}
        title="Compact rows"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="2.5" y1="4" x2="13.5" y2="4" /><line x1="2.5" y1="8" x2="13.5" y2="8" /><line x1="2.5" y1="12" x2="13.5" y2="12" />
        </svg>
        <span>Compact</span>
      </button>
      <button
        type="button"
        className={`th-density-seg${density === 'big' ? ' th-density-seg--active' : ''}`}
        onClick={() => onChange('big')}
        title="Big rows"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2.5" y="3" width="11" height="4" rx="1.2" /><rect x="2.5" y="9" width="11" height="4" rx="1.2" />
        </svg>
        <span>Big</span>
      </button>
    </div>
  )
}

// Deterministic risk read for ANY row, not just GeckoTerminal ones. GT rows
// arrive pre-graded (they know their pool count and price dispersion); Codex
// rows carry liquidity / volume / mcap / age, which is enough for the flags that
// matter, and the pool-shape flags simply don't fire. No model involved - the
// grade is arithmetic over numbers already on the row.
const rowSafety = (row) => (row ? (row.safety || gradeGtRow(row)) : null)

const RISK_FLAG_TEXT = {
  THIN_LIQUIDITY: 'under $25k pooled — a small sell moves the price',
  WASH_TURNOVER: 'volume dwarfs the pool — mostly the same dollars recycling',
  SINGLE_POOL: 'one pool only',
  PRICE_DISPERSION: 'pools disagree on the price',
  UNKNOWN_SUPPLY: 'no verifiable supply, so no real market cap',
  UNDER_24H: 'less than a day old',
  SHALLOW_VS_MCAP: 'market cap is priced off a very thin pool',
}

// Risk chip: only ever drawn for rows we can actually fault. A clean row gets
// nothing - a badge on every row is wallpaper, and wallpaper is ignored.
function RiskChip({ row }) {
  const s = rowSafety(row)
  if (!s || s.grade === 'clean') return null
  const title = `${s.grade === 'risky' ? 'Risky' : 'Worth checking'}: ${s.flags.map((f) => RISK_FLAG_TEXT[f] || f).join('; ')}`
  return (
    <span className={`th-risk th-risk--${s.grade}`} title={title} aria-label={title}>
      {s.grade === 'risky' ? '!' : '?'}
    </span>
  )
}

// Risk filter. "Safe" is not a promise - it is the rows nothing in the numbers
// faults: real pooled depth, volume that isn't just recycling through it, and a
// price the token's own pools agree on. That is exactly what makes a lowcap
// board usable, because the lowcaps are where the traps are.
function RiskFilterToggle({ value, onChange }) {
  return (
    <div className="th-center-density th-risk-filter" role="group" aria-label="Risk filter">
      {[
        { id: 'all', label: 'All', title: 'Every row, flags and all' },
        { id: 'safe', label: 'Safe', title: 'Hide rows faulted for thin depth, recycled volume or disagreeing pools' },
      ].map((seg) => (
        <button
          key={seg.id}
          type="button"
          className={`th-density-seg${value === seg.id ? ' th-density-seg--active' : ''}`}
          onClick={() => onChange(seg.id)}
          title={seg.title}
          aria-pressed={value === seg.id}
        >
          <span>{seg.label}</span>
        </button>
      ))}
    </div>
  )
}

// Live chip with a real age readout. The static "Live" dot was a claim nobody
// was checking: before the Markets refresh loop landed, the board was a one-shot
// fetch and that dot pulsed over hour-old prices. It now counts from the last
// successful refresh and says "paused" once the tab has been hidden long enough
// for the guarded interval to have skipped a tick - a stale board should look
// stale. Owns its own timer so ticking never re-renders the hub.
function LiveChip({ since }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => tick((n) => n + 1), 5000)
    return () => clearInterval(iv)
  }, [])
  const age = Math.max(0, Math.round((Date.now() - (since || 0)) / 1000))
  const stale = age > 240
  const label = age < 10 ? 'now' : age < 90 ? `${age}s` : `${Math.round(age / 60)}m`
  return (
    <span className={`th-live${stale ? ' th-live--stale' : ''}`} title={`Board last refreshed ${label} ago`}>
      <span className="th-live-pulse" />
      {stale ? 'Paused' : 'Live'}
      <span className="th-live-age">{label}</span>
    </span>
  )
}

// AI Read switch — the column is opt-in, so the control has to say what it
// costs. Reads as one segment of the same center-bar control family as
// density/view rather than a stray checkbox.
function AiReadToggle({ on, onChange }) {
  return (
    <button
      type="button"
      className={`th-ai-toggle${on ? ' th-ai-toggle--on' : ''}`}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      title={on
        ? 'AI Read is on — each visible row gets a written read'
        : 'AI Read is off — turn on to have Spectre write a read for each row'}
    >
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 1.8l1.5 3.9L13.4 7.2 9.5 8.7 8 12.6 6.5 8.7 2.6 7.2 6.5 5.7z" />
        <path d="M12.6 11.4l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" />
      </svg>
      <span>AI Read</span>
      <span className="th-ai-toggle-state" aria-hidden="true">{on ? 'ON' : 'OFF'}</span>
    </button>
  )
}

// The X (formerly Twitter) wordmark — warm-white monochrome. Marks "X-Confirmed" chrome.
function XLogoMark() {
  return (
    <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

// List · Heatmap segmented toggle — mirrors DensityToggle chrome. Shared by the
// Markets (perf treemap) and Social (mindshare treemap) control bars.
function ListHeatmapToggle({ view, onChange, ariaLabel = 'View', heatmapTitle = 'Heatmap' }) {
  return (
    <div className="th-center-density" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        className={`th-density-seg${view === 'list' ? ' th-density-seg--active' : ''}`}
        onClick={() => onChange('list')}
        title="List view"
      >
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="2.5" y1="4" x2="13.5" y2="4" /><line x1="2.5" y1="8" x2="13.5" y2="8" /><line x1="2.5" y1="12" x2="13.5" y2="12" />
        </svg>
        <span>List</span>
      </button>
      <button
        type="button"
        className={`th-density-seg${view === 'heatmap' ? ' th-density-seg--active' : ''}`}
        onClick={() => onChange('heatmap')}
        title={heatmapTitle}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="2" y="2" width="6.5" height="6.5" rx="1.2" /><rect x="10" y="2" width="4" height="4" rx="1" /><rect x="10" y="8" width="4" height="6" rx="1.2" /><rect x="2" y="10.5" width="6.5" height="3.5" rx="1.2" />
        </svg>
        <span>Heatmap</span>
      </button>
    </div>
  )
}

// Potential Runners tape - the header IS the runners surface now: a
// continuously scrolling ticker of the live runner signal (momentum +
// small-cap gates, X-confirmed first). Replaces both the pulse stat cells
// and the old bottom dock - runners stay permanently visible without
// costing the layout a band. Marquee pauses on hover; reduced-motion gets
// a static scrollable row. Track renders the chip list twice and slides
// -50% for a seamless loop.
// Terminal tooltip for the Runners tape - self-contained (the global InfoTip
// is info-mode-gated glass; this one is always-on obsidian). Plain-English
// spec rows a degen actually reads, portalled to body so the header's
// overflow never clips it.
function TapeTip() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const hideT = useRef(null)
  const show = () => {
    clearTimeout(hideT.current)
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 9, left: Math.max(10, r.left - 14) })
    setOpen(true)
  }
  const hide = () => { hideT.current = setTimeout(() => setOpen(false), 120) }
  return (
    <span className="th-tip-wrap">
      <button
        type="button"
        ref={ref}
        className="th-tip-i"
        aria-label="How runners are picked"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >i</button>
      {open && pos && createPortal(
        <div className="th-tip" style={{ top: pos.top, left: pos.left }} onMouseEnter={show} onMouseLeave={hide}>
          <span className="th-tip-eyebrow">Potential Runners</span>
          <p className="th-tip-lead">Small caps making a real move right now.</p>
          <div className="th-tip-row"><span className="th-tip-k">Filter</span><span className="th-tip-v">Up 4%+ today &middot; $15K+ real volume &middot; under $250M mcap</span></div>
          <div className="th-tip-row"><span className="th-tip-k">Rank</span><span className="th-tip-v">How hard and how fast it&rsquo;s moving for its size, plus freshness</span></div>
          <div className="th-tip-row"><span className="th-tip-k">X&nbsp;&#10003;</span><span className="th-tip-v">Crypto Twitter is on it right now &mdash; those rank first</span></div>
          <span className="th-tip-foot">Signal, not financial advice</span>
        </div>,
        document.body
      )}
    </span>
  )
}

function RunnersTape({ runners, isConfirmed, onOpen }) {
  const items = runners.slice(0, 15)
  const half = (keyPrefix, hidden) => (
    <div className="th-tape-half" aria-hidden={hidden || undefined}>
      {items.map((r, i) => {
        const logo = getHardcodedLogo(r.address) || r.logo
        const up = Number(r.change) >= 0
        const confirmed = isConfirmed(r)
        const mc = Number(r.marketCap) > 0 ? fmtUSD(r.marketCap) : null
        return (
          <button
            key={`${keyPrefix}${r.address || r.symbol || i}`}
            type="button"
            className="th-tape-item"
            tabIndex={hidden ? -1 : 0}
            onClick={() => onOpen(r)}
            title={`${r.symbol} · ${fmtPctShort(r.change)} 24h${mc ? ` · ${mc}` : ''}${confirmed ? ' · confirmed on X' : ''}`}
          >
            <span className="th-tape-logo">
              {logo
                ? <img src={logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                : <span>{(r.symbol || '?')[0]}</span>}
            </span>
            <span className="th-tape-sym">{r.symbol}</span>
            {confirmed && <span className="th-tape-x" aria-hidden="true"><XLogoMark /></span>}
            <span className={`th-tape-chg ${up ? 'pos' : 'neg'}`}>{fmtPctShort(r.change)}</span>
          </button>
        )
      })}
    </div>
  )
  return (
    <div className="th-tape">
      <span className="th-tape-label">
        Runners
        {items.length > 0 && <span className="th-tape-count">{items.length}</span>}
        <TapeTip />
      </span>
      {items.length === 0 ? (
        <span className="th-tape-empty">Scanning for runners…</span>
      ) : (
        <div className="th-tape-viewport">
          <div className="th-tape-track" style={{ '--tape-dur': `${Math.max(30, items.length * 4)}s` }}>
            {half('a-', false)}
            {half('b-', true)}
          </div>
        </div>
      )}
    </div>
  )
}

// Horizontally-scrolling category/meta chips (DexScreener-style). Selection is a
// VISUAL highlight only - the on-chain datasets aren't CG-category-tagged, so we do
// NOT fake-filter the table on click (keeps the terminal honest).
function CategoryChips({ rows, loading, selected, onSelect }) {
  const data = Array.isArray(rows) ? rows : []
  if (loading && data.length === 0) {
    return (
      <div className="th-chips">
        {[...Array(8)].map((_, i) => <span key={i} className="th-chip th-chip--shim" />)}
      </div>
    )
  }
  if (data.length === 0) return null
  return (
    <div className="th-chips">
      {data.slice(0, 24).map((c) => {
        const id = c.id || c.name
        const active = selected === id
        const chg = Number(c.market_cap_change_24h ?? c.change24h) || 0
        return (
          <button
            key={id}
            className={`th-chip${active ? ' th-chip--active' : ''}`}
            onClick={() => onSelect(active ? null : id)}
            title={c.name}
          >
            <span className="th-chip-name">{c.name}</span>
            <span className="th-chip-val">{fmtUSD(c.market_cap)}</span>
            <span className={`th-chip-chg ${chg >= 0 ? 'pos' : 'neg'}`}>{fmtPct(chg)}</span>
          </button>
        )
      })}
    </div>
  )
}

// KOLs cell — up to 3 overlapping circular avatars carrying the token. Clicking an
// avatar opens the token's in-app X Dash view (NOT x.com): it presets the terminal's
// left-panel tab then opens the token. Tooltip = name (+ followers). Photos are the
// ONE allowed color exception; a broken image self-hides.
function KolStack({ kols, onOpenXDash }) {
  const list = Array.isArray(kols) ? kols.filter((k) => k && (k.avatar || k.screen_name)) : []
  if (list.length === 0) return <span className="th-dt-kols-empty">—</span>
  const shown = list.slice(0, 3)
  const extra = list.length - shown.length
  const openXDash = (e) => {
    e.stopPropagation()
    onOpenXDash?.()
  }
  return (
    <span className="th-dt-kols">
      {shown.map((k, i) => {
        const title = k.followers > 0 ? `${k.name} · ${fmtCount(k.followers)} followers` : (k.name || k.screen_name)
        return (
          <button
            key={k.screen_name || i}
            type="button"
            className="th-dt-kol"
            style={{ zIndex: shown.length - i }}
            onClick={openXDash}
            title={title}
            aria-label={k.name || k.screen_name}
          >
            {k.avatar
              ? <img src={k.avatar} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
              : <span>{(k.name || k.screen_name || '?')[0]}</span>}
          </button>
        )
      })}
      {extra > 0 && <span className="th-dt-kol-more">+{extra}</span>}
    </span>
  )
}

// THE dense terminal table - the hero of Data/Social tabs. Full-width, many columns,
// real fields only ("—" where a dataset lacks one). Color lives on price/% only.
function DenseTable({ rows, loading, error, mode = 'data', tf = '24h', metric, density, selectToken, briefs = null, briefsLoading = false, onNeedBriefs = null, onRowVisible = null, showAi = true, emptyNote = null }) {
  const isSocial = mode === 'social'
  const data = Array.isArray(rows) ? rows : []
  const densityClass = density === 'compact' ? ' th-dt--compact' : density === 'big' ? ' th-dt--big' : ''
  const tfCol = { '5m': 'change5m', '1h': 'change1h', '24h': 'change' }[tf] || 'change'

  // ---- Sortable columns: every numeric header toggles desc⇄asc; missing/0 → bottom. ----
  const [sort, setSort] = useState({ key: null, dir: 'desc' })

  // ---- Per-token AI dossier popover ----
  const [brief, setBrief] = useState(null) // { row, x, y, loading, data, error }
  const openBrief = (row, el, e) => {
    e.stopPropagation()
    const r = el.getBoundingClientRect()
    const x = Math.min((window.innerWidth || 1200) - 348, Math.max(10, r.left - 24))
    const y = Math.min((window.innerHeight || 800) - 240, r.bottom + 8)
    setBrief({ row, x, y, loading: true, data: null, error: null })
    fetchTokenBrief(row).then(
      (data) => setBrief((b) => (b && b.row === row ? { ...b, loading: false, data } : b)),
      (err) => setBrief((b) => (b && b.row === row ? { ...b, loading: false, error: err.message } : b)),
    )
  }

  // ---- Viewport-driven AI-read fill (no tap, no dead cells) ----
  // Any uncached row scrolling into view queues a batch fetch (350ms debounce,
  // <=24 rows/batch, single-flight upstream). The server warmer pre-generates
  // the engine board, so most fills resolve as instant cache hits; the rest
  // shimmer briefly while the server writes them.
  // Master switch for the whole AI-read pipeline on this table: the mount
  // batch, the viewport queue and the column itself all hang off it, so an
  // opted-out user issues zero LLM requests rather than hidden ones.
  const wantsAiReads = !isSocial && showAi && !!onNeedBriefs
  const briefsPropRef = useRef(briefs)
  briefsPropRef.current = briefs
  const [, setBriefPendingTick] = useState(0)
  const pendingBriefsRef = useRef(new Set())
  const retriedBriefKeysRef = useRef(new Set())
  const briefQueueRef = useRef(new Map()) // key -> row
  const briefFlushRef = useRef(null)
  const briefIoRef = useRef(null)
  const preIoElsRef = useRef(new Set())
  /* The brief queue drains through TIMERS (a 350/400ms flush and an 18s
     re-request after a failed batch), and a flush chains the next one from its
     own .finally. None of that was tied to the component's life, so leaving the
     Trending screen left the chain running: measured on prod (2026-08-04),
     /api/trending/briefs kept firing 6 times per 40s while sitting on
     #dashboard, with TrendingHub unmounted. `briefAliveRef` stops the chain and
     the cleanup below clears the pending timers. */
  const briefAliveRef = useRef(true)
  const briefRetryTimersRef = useRef(new Set())
  useEffect(() => {
    briefAliveRef.current = true
    return () => {
      briefAliveRef.current = false
      if (briefFlushRef.current) { clearTimeout(briefFlushRef.current); briefFlushRef.current = null }
      for (const t of briefRetryTimersRef.current) clearTimeout(t)
      briefRetryTimersRef.current.clear()
      briefQueueRef.current.clear()
    }
  }, [])
  const flushBriefQueue = () => {
    briefFlushRef.current = null
    if (!briefAliveRef.current) return
    const batch = []
    for (const [k, r] of briefQueueRef.current) {
      briefQueueRef.current.delete(k)
      batch.push(r)
      if (batch.length >= 24) break
    }
    if (!batch.length || !onNeedBriefs) return
    for (const r of batch) pendingBriefsRef.current.add(briefKeyFor(r))
    setBriefPendingTick((t) => t + 1)
    Promise.resolve(onNeedBriefs(batch))
      .catch(() => {
        // A cold server outruns the 90s batch timeout while it keeps writing
        // into its cache - ONE delayed re-request per row scoops those up.
        const t = setTimeout(() => {
          briefRetryTimersRef.current.delete(t)
          if (!briefAliveRef.current) return
          for (const r of batch) {
            const k = briefKeyFor(r)
            if (retriedBriefKeysRef.current.has(k)) continue
            retriedBriefKeysRef.current.add(k)
            queueBriefRowRef.current(r)
          }
        }, 18000)
        briefRetryTimersRef.current.add(t)
      })
      .finally(() => {
        for (const r of batch) pendingBriefsRef.current.delete(briefKeyFor(r))
        if (!briefAliveRef.current) return
        setBriefPendingTick((t) => t + 1)
        if (briefQueueRef.current.size && !briefFlushRef.current) briefFlushRef.current = setTimeout(flushBriefQueueRef.current, 400)
      })
  }
  const flushBriefQueueRef = useRef(flushBriefQueue)
  flushBriefQueueRef.current = flushBriefQueue
  const queueBriefRow = (row) => {
    if (!wantsAiReads || !row || briefsServiceDown() || !briefAliveRef.current) return
    const key = briefKeyFor(row)
    if (briefsPropRef.current?.get(key)?.brief || pendingBriefsRef.current.has(key) || briefQueueRef.current.has(key)) return
    briefQueueRef.current.set(key, row)
    if (!briefFlushRef.current) briefFlushRef.current = setTimeout(() => flushBriefQueueRef.current(), 350)
  }
  const queueBriefRowRef = useRef(queueBriefRow)
  queueBriefRowRef.current = queueBriefRow
  // Row observer. Serves two consumers: the AI-brief queue (data tables) and
  // onRowVisible (social tables, which resolve one momentum-origin request per
  // row and so must only pay for rows the user actually reaches).
  const onRowVisibleRef = useRef(onRowVisible)
  onRowVisibleRef.current = onRowVisible
  const wantsRowObserver = wantsAiReads || !!onRowVisible
  useEffect(() => {
    if (!wantsRowObserver || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting || !en.target.__thRow) continue
        if (wantsAiReads) queueBriefRowRef.current(en.target.__thRow)
        onRowVisibleRef.current?.(en.target.__thRow)
      }
    }, { rootMargin: '280px 0px' })
    briefIoRef.current = io
    for (const el of preIoElsRef.current) io.observe(el)
    preIoElsRef.current.clear()
    return () => {
      io.disconnect()
      briefIoRef.current = null
      if (briefFlushRef.current) { clearTimeout(briefFlushRef.current); briefFlushRef.current = null }
      briefQueueRef.current.clear()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSocial, onNeedBriefs, wantsRowObserver, wantsAiReads])
  // Ref callback per <tr>: stamp the live row on the element (rows re-map every
  // poll) and observe it; rows rendered before the observer exists park in a set.
  const observeBriefRow = (el, row) => {
    if (!el || !wantsRowObserver) return
    el.__thRow = row
    if (briefIoRef.current) briefIoRef.current.observe(el)
    else preIoElsRef.current.add(el)
  }
  const clean = (v) => { const n = Number(v); return (Number.isFinite(n) && n !== 0) ? n : null }
  const ageVal = (r) => {
    let ts = Number(r.createdAt)
    if (!Number.isFinite(ts) || ts <= 0) return null
    if (ts < 1e12) ts *= 1000
    const a = Date.now() - ts
    return a >= 0 ? a : null
  }
  const SORT_GETTERS = {
    marketCap: (r) => r.marketCap,
    price: (r) => r.price,
    age: (r) => ageVal(r),
    txns: (r) => r.txns,
    volume24: (r) => r.volume24,
    change5m: (r) => r.change5m,
    change1h: (r) => r.change1h,
    change4h: (r) => r.change4h,
    change: (r) => r.change,
    change7d: (r) => r.change7d,
    liquidity: (r) => r.liquidity,
    spotted: (r) => rowSpottedTs(r),
    spottedMc: (r) => rowSpottedMc(r),
    since: (r) => rowSince(r),
    peak: (r) => rowPeakPct(r),
  }
  if (metric?.sortVal) SORT_GETTERS.metric = (r) => metric.sortVal(r)
  // Age default asc = newest first (smallest age); every other column defaults desc.
  const DEFAULT_DIR = { age: 'asc' }
  const onSort = (key) => setSort((s) => (
    s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: DEFAULT_DIR[key] || 'desc' }
  ))

  const sortedRows = useMemo(() => {
    const base = data.slice(0, 100)
    const getter = SORT_GETTERS[sort.key]
    if (!sort.key || !getter) return base
    const isAge = sort.key === 'age'
    const valFor = (r) => (isAge ? ageVal(r) : clean(getter(r)))
    const dir = sort.dir === 'asc' ? 1 : -1
    return base
      .map((r, i) => ({ r, i, v: valFor(r) }))
      .sort((a, b) => {
        if (a.v == null && b.v == null) return a.i - b.i
        if (a.v == null) return 1   // missing/0 always sinks to the bottom
        if (b.v == null) return -1
        if (a.v === b.v) return a.i - b.i
        return (a.v - b.v) * dir
      })
      .map((x) => x.r)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sort, metric])

  // Volume-magnitude bar baseline (no buy/sell split in these datasets — magnitude only).
  const maxVol = sortedRows.reduce((m, r) => Math.max(m, Number(r.volume24) || 0), 0) || 1

  // Social buzz baseline — each row's mention/velocity metric relative to the feed
  // peak drives a monochrome intensity bar (relative attention, never a price signal).
  const maxMetricVal = (isSocial && metric?.sortVal)
    ? (sortedRows.reduce((m, r) => Math.max(m, Number(metric.sortVal(r)) || 0), 0) || 1)
    : 1
  const buzzPct = (r) => {
    if (!metric?.sortVal) return 6
    const v = Number(metric.sortVal(r)) || 0
    return Math.max(6, Math.round((v / maxMetricVal) * 100))
  }

  // Sortable header cell — caret indicator (▲/▼) + hover affordance. `extra` carries the
  // existing timeframe active-column highlight so the two distinctions coexist.
  const sortTh = (k, label, extra) => {
    const active = sort.key === k
    return (
      <th
        key={k}
        className={`th-dt-sortable${active ? ' th-dt-sorted' : ''}${extra ? ' ' + extra : ''}`}
        onClick={() => onSort(k)}
        title={`Sort by ${label}`}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span className="th-dt-th-in">
          <span>{label}</span>
          <span className={`th-dt-sortcaret${active ? ' on' : ''}`} aria-hidden="true">
            {active ? (sort.dir === 'asc' ? '▲' : '▼') : '▾'}
          </span>
        </span>
      </th>
    )
  }

  const renderChg = (v, key) => {
    const n = Number(v)
    const has = isFinite(n) && n !== 0
    // Momentum heat — stronger moves saturate + glow harder (visual energy).
    const mag = Math.abs(n)
    const heat = mag >= 50 ? ' heat-3' : mag >= 18 ? ' heat-2' : mag >= 5 ? ' heat-1' : ''
    return (
      <td key={key} className={`th-dt-c-num${key === tfCol ? ' th-dt-col--active' : ''}`}>
        {has
          ? <span className={`th-dt-chg ${n >= 0 ? 'pos' : 'neg'}${heat}`}>{fmtPctCompact(n)}</span>
          : <span className="th-dt-chg dim">—</span>}
      </td>
    )
  }

  return (
    <div className="th-dt-wrap">
      {loading && data.length === 0 ? (
        <div className="th-dt-skel">
          {[...Array(12)].map((_, i) => (
            <div key={i} className="th-dt-skel-row"><span className="th-dt-skel-bar" /></div>
          ))}
        </div>
      ) : error && data.length === 0 ? (
        <div className="th-dt-state err">{error}</div>
      ) : data.length === 0 ? (
        <div className="th-dt-state">
          No tokens for the current filters.
          {/* Say WHY it is empty when a filter is what emptied it. */}
          {emptyNote ? <span className="th-dt-state-note">{emptyNote}</span> : null}
        </div>
      ) : (
        <table className={`th-dt${densityClass}${isSocial ? ' th-dt--social' : ''}`}>
          <thead>
            <tr>
              <th className="th-dt-c-rank">#</th>
              <th className="th-dt-c-token">Token</th>
              {isSocial ? (
                <>
                  {metric?.sortVal
                    ? sortTh('metric', metric?.label || 'Signal', 'th-dt-c-metric')
                    : <th className="th-dt-c-metric">{metric?.label || 'Signal'}</th>}
                  <th className="th-dt-c-buzz">Buzz</th>
                  {sortTh('spotted', 'Spotted', 'th-dt-c-spotted')}
                  {sortTh('spottedMc', 'Spotted MC', 'th-dt-c-spottedmc')}
                  {sortTh('since', 'Since', 'th-dt-c-since')}
                  {sortTh('peak', 'Peak', 'th-dt-c-peak')}
                  {sortTh('price', 'Price')}
                  {sortTh('marketCap', 'MCAP')}
                  {sortTh('volume24', 'Volume')}
                  {sortTh('change1h', '1h', tfCol === 'change1h' ? 'th-dt-col--active' : '')}
                  {sortTh('change', '24h', tfCol === 'change' ? 'th-dt-col--active' : '')}
                  {sortTh('change7d', '7d')}
                </>
              ) : (
                <>
                  {showAi && <th className="th-dt-c-ai">AI Read</th>}
                  {/* About = Codex token metadata (description; socials ride the
                      token cell). Free, always on - unlike the opt-in AI Read. */}
                  <th className="th-dt-c-about">About</th>
                  {sortTh('marketCap', 'MCAP')}
                  {sortTh('age', 'Age')}
                  {sortTh('volume24', 'Volume')}
                  {sortTh('change5m', '5m', tfCol === 'change5m' ? 'th-dt-col--active' : '')}
                  {sortTh('change', '24h', tfCol === 'change' ? 'th-dt-col--active' : '')}
                  {sortTh('liquidity', 'Liquidity')}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, i) => {
              const logo = getHardcodedLogo(row.address) || row.logo
              const price = row.price > 0 ? fmtPrice(row.price) : '—'
              const tokenPayload = {
                symbol: row.symbol,
                name: row.name,
                address: row.address,
                networkId: row.networkId || 1,
                price: row.price,
                change: row.change,
                logo: row.logo,
              }
              const openToken = () => selectToken?.(tokenPayload, 'trending-hub')
              // KOL avatar → preset the terminal's X-Dash tab, then open the token there.
              const openXDash = () => {
                try { localStorage.setItem('spectre-left-panel-tab', 'xdash') } catch {}
                selectToken?.(tokenPayload, 'trending-hub-xdash')
              }
              return (
                <tr
                  key={`${row.networkId || 0}:${row.address || row.symbol || i}`}
                  ref={(el) => observeBriefRow(el, row)}
                  className={`th-dt-row${Number(row.change) >= 4 ? ' th-heat-pos' : Number(row.change) <= -4 ? ' th-heat-neg' : ''}`}
                  style={{ '--th-heatw': `${Math.min(58, Math.abs(Number(row.change) || 0) / 8).toFixed(1)}%` }}
                  onClick={openToken}
                >
                  <td className="th-dt-c-rank"><span className="th-dt-rank">{i + 1}</span></td>
                  <td className="th-dt-c-token">
                    <div className="th-dt-token">
                      <span className="th-dt-logo">
                        {logo
                          ? <img src={logo} alt={row.symbol} onError={(e) => { e.currentTarget.style.display = 'none' }} />
                          : <span>{(row.symbol || '?')[0]}</span>}
                      </span>
                      {/* Name is an explicit click target → the AI screener / terminal. */}
                      <span
                        className="th-dt-tok th-dt-tok--link"
                        onClick={(e) => { e.stopPropagation(); openToken() }}
                      >
                        <span className="th-dt-tok-top">
                          <span className="th-dt-sym">{row.symbol || '—'}</span>
                          <ChainBadge networkId={row.networkId} />
                          {!isSocial && <RiskChip row={row} />}
                        </span>
                        <span className="th-dt-name">{row.name || ''}</span>
                      </span>
                      {/* Social links ride the token cell (moved out of About
                          2026-08-18). Real anchors, new tab; the wrapper stops
                          the row-open click. */}
                      {!isSocial && (row.website || row.twitter || row.telegram) && (
                        <span className="th-dt-socs" onClick={(e) => e.stopPropagation()}>
                          {row.website && (
                            <a className="th-dt-soc" href={row.website} target="_blank" rel="noopener noreferrer" title={row.website} aria-label={`${row.symbol} website`}>
                              <Globe size={11} strokeWidth={1.9} aria-hidden="true" />
                            </a>
                          )}
                          {row.twitter && (
                            <a className="th-dt-soc" href={row.twitter} target="_blank" rel="noopener noreferrer" title={row.twitter} aria-label={`${row.symbol} on X`}>
                              <XLogoMark />
                            </a>
                          )}
                          {row.telegram && (
                            <a className="th-dt-soc" href={row.telegram} target="_blank" rel="noopener noreferrer" title={row.telegram} aria-label={`${row.symbol} Telegram`}>
                              <Send size={11} strokeWidth={1.9} aria-hidden="true" />
                            </a>
                          )}
                        </span>
                      )}
                      {isSocial && (
                        <button
                          type="button"
                          className="th-dt-ai"
                          title="AI dossier - why is this trending?"
                          onClick={(e) => openBrief(row, e.currentTarget, e)}
                        >AI</button>
                      )}
                      {/* KOLs live in the empty space right of the name → open the token's
                          in-app X Dash view (not x.com). Wrapper stops the row-open click. */}
                      {isSocial && (
                        <span className="th-dt-tok-kols" onClick={(e) => e.stopPropagation()}>
                          <KolStack kols={row.kols} onOpenXDash={openXDash} />
                        </span>
                      )}
                    </div>
                  </td>
                  {isSocial ? (
                    <>
                      <td className="th-dt-c-num th-dt-c-metric">{(() => {
                        const bp = buzzPct(row)
                        // Interpolate warm-white → gold by relative attention; top tier adds a gold glow.
                        const t = Math.max(0, Math.min(1, (bp - 20) / 80))
                        const tier = bp >= 78 ? ' th-dt-metric--hot' : bp >= 45 ? ' th-dt-metric--warm' : ''
                        const style = t > 0.04 ? {
                          color: `rgb(${Math.round(245 + (TH_HEAT[0] - 245) * t)}, ${Math.round(245 + (TH_HEAT[1] - 245) * t)}, ${Math.round(247 + (TH_HEAT[2] - 247) * t)})`,
                        } : undefined
                        return <span className={`th-dt-metric${tier}`} style={style}>{metric ? metric.get(row) : '—'}</span>
                      })()}</td>
                      <td className="th-dt-c-buzz">
                        <span className="th-dt-buzz" aria-hidden="true">
                          <span className="th-dt-buzz-fill" style={{ width: `${buzzPct(row)}%` }} />
                        </span>
                      </td>
                      <td className="th-dt-c-num th-dt-c-spotted th-dt-dim" title={fmtSpottedDate(rowSpottedTs(row))}>
                        {fmtSpottedAge(rowSpottedTs(row))}
                      </td>
                      <td className="th-dt-c-num th-dt-c-spottedmc th-dt-tier2">
                        {(() => {
                          // Shimmer while the momentum-origin fetch is pending; then the REAL
                          // entry mcap (override → origin), falling back to momentum_entry → —.
                          if (rowOriginPending(row)) return <span className="th-dt-mc-shim" aria-hidden="true" />
                          const mc = rowSpottedMc(row)
                          return (mc != null && mc > 0) ? fmtUSD(mc) : '—'
                        })()}
                      </td>
                      <td className="th-dt-c-num th-dt-c-since">
                        {(() => {
                          // Since = real "first surfaced" ROI (%) to CURRENT mcap. Peak lives
                          // in its own column now.
                          if (rowOriginPending(row)) return <span className="th-dt-since-shim" aria-hidden="true" />
                          const pct = rowRoiPct(row)
                          if (pct == null) return <span className="th-dt-since dim">—</span>
                          return (
                            <span
                              className={`th-dt-since ${pct >= 0 ? 'pos' : 'neg'}`}
                              title="ROI to current mcap since Spectre first surfaced this token"
                            >{fmtRoiPct(pct)}</span>
                          )
                        })()}
                      </td>
                      <td className="th-dt-c-num th-dt-c-peak">
                        {(() => {
                          // Peak = the highest ROI the token reached since first surfaced.
                          if (rowPeakPending(row)) return <span className="th-dt-since-shim" aria-hidden="true" />
                          const pk = rowPeakPct(row)
                          if (pk == null || !isFinite(pk)) return <span className="th-dt-peak dim">—</span>
                          return (
                            <span className="th-dt-peak" title="Peak ROI reached since first surfaced">
                              <span className="th-dt-peak-cap" aria-hidden="true">▲</span>{fmtRoiPct(pk)}
                            </span>
                          )
                        })()}
                      </td>
                      <td className="th-dt-c-num">{price}</td>
                      <td className="th-dt-c-num th-dt-tier2">{fmtUSD(row.marketCap)}</td>
                      <td className="th-dt-c-num th-dt-tier2">{fmtUSD(row.volume24)}</td>
                      {renderChg(row.change1h, 'change1h')}
                      {renderChg(row.change, 'change')}
                      {renderChg(row.change7d, 'change7d')}
                    </>
                  ) : (
                    <>
                      {showAi && (
                      <td className="th-dt-c-ai" onClick={(e) => openBrief(row, e.currentTarget, e)}>
                        {(() => {
                          const entry = briefs?.get(briefKeyFor(row))
                          const b = entry?.brief
                          if (b?.why) return (
                            <span className="th-dt-read" title="Open full AI dossier">
                              {b.confidence === 'high' && <span className="th-dt-read-hi" aria-hidden="true" />}
                              <span className="th-dt-read-why">{b.why}</span>
                              {b.lore ? <span className="th-dt-read-lore"> — {b.lore}</span> : null}
                            </span>
                          )
                          // Read exists but was scrubbed empty - rare; popover still has risk/grounding.
                          if (entry) return <span className="th-dt-read-tap">—</span>
                          // Endpoint absent (prod without the serverless mirror):
                          // quiet dash, never an eternal shimmer.
                          if (briefsServiceDown()) return <span className="th-dt-read-tap">—</span>
                          // No data yet: the viewport observer (or the mount batch) is
                          // already fetching it - shimmer until it lands. Tap-to-load
                          // remains only for surfaces without a batch pipeline.
                          if (onNeedBriefs || (briefsLoading && i < 40)) return <span className="th-dt-read-shim" aria-hidden="true" />
                          return <span className="th-dt-read-tap">tap for AI read</span>
                        })()}
                      </td>
                      )}
                      <td className="th-dt-c-about">
                        {/* Description only - the social links ride the token cell. */}
                        {row.description
                          ? <span className="th-dt-about-desc" title={row.description}>{row.description}</span>
                          : <span className="th-dt-about-none">—</span>}
                      </td>
                      <td className="th-dt-c-num th-dt-tier2">{fmtUSD(row.marketCap)}</td>
                      <td className="th-dt-c-num th-dt-dim">{fmtAge(rowAgeTs(row))}</td>
                      <td className="th-dt-c-num th-dt-dim">
                        <span className="th-dt-volcell">
                          <span className="th-dt-volnum">{fmtUSD(row.volume24)}</span>
                          <span className="th-dt-volbar">
                            <span
                              className={`th-dt-volbar-fill ${Number(row.change) >= 0 ? 'pos' : 'neg'}`}
                              style={{ width: `${Math.max(3, Math.round(((Number(row.volume24) || 0) / maxVol) * 100))}%` }}
                            />
                          </span>
                        </span>
                      </td>
                      {renderChg(row.change5m, 'change5m')}
                      {renderChg(row.change, 'change')}
                      <td className="th-dt-c-num th-dt-dim">{fmtUSD(row.liquidity)}</td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {brief && createPortal(
        <>
          <div className="th-brief-veil" onClick={() => setBrief(null)} />
          <div className="th-brief" style={{ top: brief.y, left: brief.x }} role="dialog" aria-label={`AI dossier for ${brief.row.symbol}`}>
            <header className="th-brief-head">
              <span className="th-brief-eyebrow">AI Dossier</span>
              <span className="th-brief-id">{brief.row.symbol}</span>
              <ChainBadge networkId={brief.row.networkId} />
              <button className="th-brief-close" onClick={() => setBrief(null)} aria-label="Close">&times;</button>
            </header>
            {brief.loading ? (
              <div className="th-brief-shim"><span /><span /><span /></div>
            ) : (brief.error || !brief.data?.brief) ? (
              <p className="th-brief-err">No read available right now - try again in a minute.</p>
            ) : (
              <>
                <div className="th-brief-row"><span className="th-brief-k">Why now</span><p>{brief.data.brief.why || '—'}</p></div>
                {brief.data.brief.lore && <div className="th-brief-row"><span className="th-brief-k">Lore</span><p>{brief.data.brief.lore}</p></div>}
                {brief.data.brief.risk && <div className="th-brief-row"><span className="th-brief-k">Risk</span><p>{brief.data.brief.risk}</p></div>}
                <footer className="th-brief-foot">
                  <span className={`th-brief-conf th-brief-conf--${brief.data.brief.confidence || 'low'}`}>{brief.data.brief.confidence || 'low'} confidence</span>
                  <span className="th-brief-ground">
                    {brief.data.grounding?.tweets > 0
                      ? `${brief.data.grounding.tweets} live tweets · ${brief.data.grounding.kols} KOLs`
                      : brief.data.grounding?.mentions_24h > 0
                        ? `${brief.data.grounding.mentions_24h} mentions 24h · ${brief.data.grounding.kols} KOLs`
                        : 'thin social context · stats only'}
                  </span>
                </footer>
              </>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

// One stacked social panel for the always-on Data-tab rail. Fed by the already-fetched
// X Dash datasets (socialMentions / socialMomentum). Designed as a live feed: ringed
// avatar, bold ticker, a warm-white "buzz" intensity bar (relative attention, NOT a
// price signal — stays monochrome), the metric as the headline, 24h change beneath.
// `metricRaw` is an additive presentational getter for the buzz width; data flow is unchanged.
function SocialRailPanel({ title, sub, data, metricGet, metricRaw, selectToken }) {
  const rows = Array.isArray(data?.rows) ? data.rows : []
  const loading = data?.loading
  const error = data?.error
  const visible = rows.slice(0, 30)
  // Peak metric across the visible feed → each row's buzz bar fills relative to it.
  const maxMetric = visible.reduce((m, r) => Math.max(m, Number(metricRaw?.(r)) || 0), 0) || 1
  // Collector-snapshot age. Mention counts only move when the X Dash collect
  // run regenerates (~20-60 min upstream), so show the age instead of letting
  // a pulsing dot imply per-second data. Amber dot past 45 min = likely a
  // late/stuck collect run, not a client problem.
  const asOf = Number(data?.asOf) || null
  const ageMin = asOf ? Math.max(0, Math.round((Date.now() - asOf) / 60000)) : null
  const stale = ageMin != null && ageMin > 45
  return (
    <section className="th-srail-panel">
      <header className="th-srail-head">
        <span className="th-srail-title"><span className={`th-srail-live${stale ? ' th-srail-live--stale' : ''}`} aria-hidden="true" />{title}</span>
        <span className="th-srail-sub" title={asOf ? `X Dash collect run · ${new Date(asOf).toLocaleTimeString()}` : undefined}>
          {sub}{ageMin != null ? ` · ${ageMin < 1 ? 'NOW' : `${ageMin}M AGO`}` : ''}
        </span>
      </header>
      <div className="th-srail-list">
        {loading && rows.length === 0 ? (
          [...Array(10)].map((_, i) => (
            <div key={i} className="th-srail-skel">
              <span className="th-srail-skel-av" />
              <span className="th-srail-skel-lines"><span /><span /></span>
              <span className="th-srail-skel-val" />
            </div>
          ))
        ) : visible.length === 0 ? (
          <div className="th-srail-empty">
            <span className="th-srail-empty-pulse" aria-hidden="true" />
            <span>{error ? 'Social feed reconnecting' : 'Listening for social signal'}</span>
          </div>
        ) : (
          visible.map((row, i) => {
            const logo = getHardcodedLogo(row.address) || row.logo
            const chg = Number(row.change)
            const hasChg = isFinite(chg) && chg !== 0
            const raw = Number(metricRaw?.(row)) || 0
            const buzz = Math.max(6, Math.round((raw / maxMetric) * 100))
            return (
              <button
                key={`${row.networkId || 0}:${row.address || row.symbol || i}`}
                className="th-srail-row"
                onClick={() => selectToken?.({
                  symbol: row.symbol,
                  name: row.name,
                  address: row.address,
                  networkId: row.networkId || 1,
                  price: row.price,
                  change: row.change,
                  logo: row.logo,
                }, 'trending-hub-social')}
              >
                <span className="th-srail-rank">{i + 1}</span>
                <span className="th-srail-logo">
                  {logo
                    ? <img src={logo} alt={row.symbol} onError={(e) => { e.currentTarget.style.display = 'none' }} />
                    : <span>{(row.symbol || '?')[0]}</span>}
                </span>
                <span className="th-srail-main">
                  <span className="th-srail-sym">{row.symbol || '—'}</span>
                  <span className="th-srail-buzz" aria-hidden="true">
                    <span className="th-srail-buzz-fill" style={{ width: `${buzz}%` }} />
                  </span>
                </span>
                <span className="th-srail-vals">
                  <span className="th-srail-metric">{metricGet(row)}</span>
                  <span className={`th-srail-chg ${chg >= 0 ? 'pos' : 'neg'}`}>{hasChg ? fmtPct(chg) : '—'}</span>
                </span>
              </button>
            )
          })
        )}
      </div>
    </section>
  )
}

// Persistent right-side social rail on the Data tab — "social straight up" without a tab click.
function SocialRail({ mentions, momentum, selectToken }) {
  return (
    <aside className="th-social-rail">
      <SocialRailPanel
        title="Social Mentions"
        sub="Most mentioned · 24h"
        data={mentions}
        metricGet={(r) => fmtCount(r.mentions)}
        metricRaw={(r) => Number(r.mentions)}
        selectToken={selectToken}
      />
      <SocialRailPanel
        title="Social Momentum"
        sub="Attention velocity"
        data={momentum}
        metricGet={(r) => (Number(r.velocity) > 0 ? `${Number(r.velocity).toFixed(1)}x` : '—')}
        metricRaw={(r) => Number(r.velocity)}
        selectToken={selectToken}
      />
    </aside>
  )
}

// Categories tab - meta cards (name + mcap + change + top tokens), CMC-DexScan style.
function CategoriesGrid({ rows, loading }) {
  const data = Array.isArray(rows) ? rows : []
  if (loading && data.length === 0) {
    return (
      <div className="th-cat-grid2">
        {[...Array(12)].map((_, i) => <div key={i} className="th-cat2 th-cat2--shim" />)}
      </div>
    )
  }
  if (data.length === 0) return <div className="th-dt-state">No sectors available.</div>
  return (
    <div className="th-cat-grid2">
      {data.slice(0, 36).map((c) => {
        const chg = Number(c.market_cap_change_24h ?? c.change24h) || 0
        const tops = Array.isArray(c.top_3_coins) ? c.top_3_coins : []
        return (
          <article key={c.id || c.name} className="th-cat2">
            <header className="th-cat2-head">
              <h4 className="th-cat2-name">{c.name}</h4>
              <span className={`th-cat2-chg ${chg >= 0 ? 'pos' : 'neg'}`}>{fmtPct(chg)}</span>
            </header>
            <div className="th-cat2-stats">
              <div className="th-cat2-stat">
                <span className="th-cat2-stat-label">Mcap</span>
                <span className="th-cat2-stat-val">{fmtUSD(c.market_cap)}</span>
              </div>
              <div className="th-cat2-stat">
                <span className="th-cat2-stat-label">Vol 24h</span>
                <span className="th-cat2-stat-val">{fmtUSD(c.volume_24h)}</span>
              </div>
            </div>
            {tops.length > 0 && (
              <div className="th-cat2-tops">
                {tops.slice(0, 3).map((img, idx) => (
                  <img key={idx} className="th-cat2-top" src={img} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} />
                ))}
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}

// ── Squarified treemap engine (shared by both heatmaps) ──────────────────────
// Classic Bruls/Huizing/van Wijk squarified layout: given items carrying a
// numeric `value` + a container box, produce absolutely-positioned rects whose
// AREA ∝ value, kept as square as possible, filling the box with no gaps. ONE
// engine drives the market-perf treemap AND the social-mindshare treemap →
// clean, balanced, proportional (biggest values dominate, small stay legible).
function squarifyTreemap(items, width, height) {
  const out = []
  const clean = (items || []).filter((d) => Number(d.value) > 0)
  if (clean.length === 0 || width <= 0 || height <= 0) return out
  // Tiles are AREA-sized by `sizeVal` when present (a compressed weight so one
  // giant — SOL/ANSEM — stays clearly the biggest without swallowing the map),
  // falling back to the raw `value`. Labels/shares still read the raw `value`.
  const sizeOf = (d) => Number(d.sizeVal != null ? d.sizeVal : d.value)
  const total = clean.reduce((s, d) => s + sizeOf(d), 0)
  const scale = (width * height) / total
  const nodes = clean.map((d) => ({ item: d, area: sizeOf(d) * scale }))

  let x = 0, y = 0, w = width, h = height
  let row = []
  // Worst (largest) aspect ratio produced by a row laid along a side of length `len`.
  const worst = (areas, len) => {
    if (areas.length === 0) return Infinity
    let sum = 0, max = -Infinity, min = Infinity
    for (const a of areas) { sum += a; if (a > max) max = a; if (a < min) min = a }
    const s2 = sum * sum, l2 = len * len
    return Math.max((l2 * max) / s2, s2 / (l2 * min))
  }
  const flush = () => {
    const sum = row.reduce((s, n) => s + n.area, 0)
    if (w >= h) {                       // lay row as a vertical column on the left
      const cw = sum / h
      let oy = y
      for (const n of row) { const nh = n.area / cw; out.push({ ...n.item, x, y: oy, w: cw, h: nh }); oy += nh }
      x += cw; w -= cw
    } else {                            // lay row as a horizontal strip on top
      const rh = sum / w
      let ox = x
      for (const n of row) { const nw = n.area / rh; out.push({ ...n.item, x: ox, y, w: nw, h: rh }); ox += nw }
      y += rh; h -= rh
    }
    row = []
  }
  let i = 0
  while (i < nodes.length) {
    const node = nodes[i]
    const len = Math.min(w, h)
    const areas = row.map((n) => n.area)
    if (row.length === 0 || worst([...areas, node.area], len) <= worst(areas, len)) {
      row.push(node); i++
    } else {
      flush()
    }
  }
  if (row.length) flush()
  return out
}

// Measure a container (ResizeObserver) so the treemap fills its actual box.
function useElementSize() {
  const ref = useRef(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (cr) setSize({ width: Math.round(cr.width), height: Math.round(cr.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width: size.width, height: size.height }
}

const TM_GAP = 4  // px gutter between tiles (page bg shows through)
const TM_SHIM_WEIGHTS = [13, 8, 6, 5, 4, 4, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1]

// Tile content bucket from its smallest side → how much each tile can legibly show.
function tileSizeClass(w, h) {
  const m = Math.min(w, h)
  return m >= 132 ? 'xl' : m >= 92 ? 'lg' : m >= 62 ? 'md' : m >= 42 ? 'sm' : 'xs'
}
// Absolute-position style for a tile, with a centered gutter so gaps are uniform.
const tilePos = (t) => ({
  left: t.x + TM_GAP / 2,
  top: t.y + TM_GAP / 2,
  width: Math.max(0, t.w - TM_GAP),
  height: Math.max(0, t.h - TM_GAP),
})

// Perf-heat tint for a market tile: the color IS the 24h performance (the one place a
// full colored tile is correct). Scaled to TYPICAL daily moves — full saturation at
// ~±13% (not ±900% outliers), so a +3% clearly reads green and a +12% blazes. Any
// non-zero change floors to a clearly-visible tint (never near-black); zero/unknown =
// a neutral warm-white glass tile. Vertical gradient (lit at the top, deeper at the
// bottom) + vivid bull/bear give each tile body + dimension.
const HEAT_BULL = '22,199,132'   // vivid green (DexScreener/CMC class), richer than --bull
const HEAT_BEAR = '238,64,64'    // vivid red
function heatTint(chg) {
  const v = Number(chg)
  const has = Number.isFinite(v) && v !== 0
  const up = v >= 0
  if (!has) {
    // Neutral, lit glass tile — colorful-adjacent warm-white, NEVER a black void.
    return {
      base: '245,245,247', up: true, intensity: 0, neutral: true,
      bg: 'linear-gradient(180deg, rgba(255,255,255,0.075) 0%, rgba(255,255,255,0.028) 100%)',
    }
  }
  const t = Math.min(1, Math.abs(v) / 13)    // full saturation at ~±13%
  const intensity = Math.pow(t, 0.7)          // gentle curve — small moves stay readable
  const base = up ? HEAT_BULL : HEAT_BEAR
  // Floor the alpha (~0.36 top) so every mover is clearly colored; blaze toward full.
  const aTop = (0.42 + 0.5 * intensity).toFixed(3)   // lighter/brighter at the top
  const aBot = (0.30 + 0.46 * intensity).toFixed(3)  // deeper toward the bottom
  return {
    base, up, intensity, neutral: false,
    bg: `linear-gradient(180deg, rgba(${base},${aTop}) 0%, rgba(${base},${aBot}) 100%)`,
  }
}

// Mindshare tile tint — mindshare is sized by mentions (attention, NOT price), but a
// dead-dark tile reads worse than an alive one, so overlay a SUBTLE 24h-change wash
// (green/red) stacked over a warm-white glass base. Reads on both black + white:
// the glass layer lifts it off black, the hue gives it life; zero/unknown → null
// (falls back to the CSS glass tile). Far gentler than heatTint (this is context, not
// the signal).
function mindTint(chg) {
  const v = Number(chg)
  if (!Number.isFinite(v) || v === 0) return null
  const up = v >= 0
  const t = Math.min(1, Math.abs(v) / 13)
  const intensity = Math.pow(t, 0.7)
  const base = up ? HEAT_BULL : HEAT_BEAR
  const aTop = (0.16 + 0.26 * intensity).toFixed(3)
  const aBot = (0.05 + 0.13 * intensity).toFixed(3)
  // color wash (top) over a warm-white glass floor (bottom) — one background property.
  return `linear-gradient(180deg, rgba(${base},${aTop}) 0%, rgba(${base},${aBot}) 100%), linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.035) 100%)`
}

// ── Market heatmap (Markets/Data view) — classic green/red performance treemap.
// Tiles SIZED by market cap, BACKGROUND colored by 24h change (green up / red
// down), intensity scaling with magnitude. Fed by the active Markets dataset.
function MarketHeatmap({ rows, loading, error, selectToken }) {
  const { ref, width, height } = useElementSize()
  const items = useMemo(() => (
    (Array.isArray(rows) ? rows : [])
      .map((r) => { const v = Number(r.marketCap) || 0; return { ...r, value: v, sizeVal: Math.pow(v, 0.5) } })
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 30)
  ), [rows])
  const layout = useMemo(
    () => (width > 0 && height > 0 ? squarifyTreemap(items, width, height) : []),
    [items, width, height]
  )
  const shimLayout = useMemo(
    () => (width > 0 && height > 0 ? squarifyTreemap(TM_SHIM_WEIGHTS.map((value, id) => ({ value, id })), width, height) : []),
    [width, height]
  )
  const showShim = loading && items.length === 0

  return (
    <div className="th-tm th-hm" ref={ref}>
      {showShim ? (
        shimLayout.map((t) => (
          <span key={t.id} className="th-tm-tile th-tm-tile--shim" style={tilePos(t)} />
        ))
      ) : items.length === 0 ? (
        <div className="th-tm-empty">
          <span className="th-tm-empty-pulse" aria-hidden="true" />
          <span>{error ? 'Market feed reconnecting' : 'No market data for the current filters'}</span>
        </div>
      ) : (
        layout.map((t, i) => {
          const sc = tileSizeClass(t.w, t.h)
          const logo = getHardcodedLogo(t.address) || t.logo
          const { base, up, intensity, bg, neutral } = heatTint(t.change)
          const showLogo = sc === 'xl' || sc === 'lg' || sc === 'md'
          const showChg = sc !== 'xs'
          const showMcap = sc === 'xl' || sc === 'lg'
          return (
            <button
              key={t.address || t.symbol || i}
              type="button"
              className={`th-tm-tile th-hm-tile th-hm-tile--${sc} th-hm-tile--${up ? 'up' : 'down'}${neutral ? ' th-hm-tile--neutral' : ''}${intensity >= 0.72 ? ' th-hm-tile--hot' : ''}`}
              style={{ ...tilePos(t), background: bg, '--hm': base }}
              onClick={() => selectToken?.({
                symbol: t.symbol, name: t.name, address: t.address,
                networkId: t.networkId || 1, price: t.price, change: t.change, logo: t.logo,
              }, 'trending-hub-market-heat')}
              title={`${t.symbol} · ${fmtUSD(t.marketCap)} mcap · ${fmtPctShort(t.change)} 24h`}
            >
              <span className="th-hm-head">
                {showLogo && (
                  <span className="th-hm-logo">
                    {logo
                      ? <img src={logo} alt={t.symbol} onError={(e) => { e.currentTarget.style.display = 'none' }} />
                      : <span>{(t.symbol || '?')[0]}</span>}
                  </span>
                )}
                <span className="th-hm-sym">{t.symbol || '—'}</span>
              </span>
              {showChg && <span className="th-hm-chg">{fmtPctShort(t.change)}</span>}
              {showMcap && <span className="th-hm-mcap">{fmtUSD(t.marketCap)}</span>}
            </button>
          )
        })
      )}
    </div>
  )
}

// ── Mindshare heatmap (Social view) — same squarified treemap, warm-white glass.
// Tiles SIZED by each token's SHARE of total mentions (mindshare): the loudest
// names dominate cleanly. Attention framing kept — % + mentions + 24h change on
// frosted glass; color lives only on the 24h %. (Treemap fixes the old "chaotic,
// small" tier grid → clean, proportional, bigger legible tiles.) Click → selectToken.
function MindshareHeatmap({ data, selectToken }) {
  const { ref, width, height } = useElementSize()
  const rows = Array.isArray(data?.rows) ? data.rows : []
  const loading = data?.loading
  const error = data?.error

  const { items, total, topVal } = useMemo(() => {
    const ranked = rows
      .map((r) => { const v = Number(r.mentions ?? r.score) || 0; return { ...r, value: v, sizeVal: Math.pow(v, 0.5) } })
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 28)
    const sum = ranked.reduce((s, r) => s + r.value, 0) || 1
    return { items: ranked, total: sum, topVal: ranked[0]?.value || 1 }
  }, [rows])

  const layout = useMemo(
    () => (width > 0 && height > 0 ? squarifyTreemap(items, width, height) : []),
    [items, width, height]
  )
  const shimLayout = useMemo(
    () => (width > 0 && height > 0 ? squarifyTreemap(TM_SHIM_WEIGHTS.map((value, id) => ({ value, id })), width, height) : []),
    [width, height]
  )
  const showShim = loading && items.length === 0

  return (
    <div className="th-tm th-mind" ref={ref}>
      {showShim ? (
        shimLayout.map((t) => (
          <span key={t.id} className="th-tm-tile th-tm-tile--shim" style={tilePos(t)} />
        ))
      ) : items.length === 0 ? (
        <div className="th-tm-empty">
          <span className="th-tm-empty-pulse" aria-hidden="true" />
          <span>{error ? 'Mindshare feed reconnecting' : 'Listening for social mindshare'}</span>
        </div>
      ) : (
        layout.map((t, i) => {
          const sc = tileSizeClass(t.w, t.h)
          const logo = getHardcodedLogo(t.address) || t.logo
          const share = t.value / total
          const pct = share >= 0.1 ? `${(share * 100).toFixed(0)}%` : `${(share * 100).toFixed(1)}%`
          const chg = Number(t.change)
          const hasChg = isFinite(chg) && chg !== 0
          const showLogo = sc !== 'xs'
          const showMeta = sc !== 'xs'
          const showFoot = sc === 'xl' || sc === 'lg'
          const tint = mindTint(t.change)
          return (
            <button
              key={t.address || t.symbol || i}
              type="button"
              className={`th-tm-tile th-mind-tile th-mind-tile--${sc}${hasChg ? (chg >= 0 ? ' th-mind-tile--up' : ' th-mind-tile--down') : ''}`}
              style={tint ? { ...tilePos(t), background: tint } : tilePos(t)}
              onClick={() => selectToken?.({
                symbol: t.symbol, name: t.name, address: t.address,
                networkId: t.networkId || 1, price: t.price, change: t.change, logo: t.logo,
              }, 'trending-hub-mindshare')}
              title={`${t.symbol} · ${fmtCount(t.value)} mentions · ${pct} mindshare`}
            >
              <span className="th-mind-top">
                {showLogo && (
                  <span className="th-mind-logo">
                    {logo
                      ? <img src={logo} alt={t.symbol} onError={(e) => { e.currentTarget.style.display = 'none' }} />
                      : <span>{(t.symbol || '?')[0]}</span>}
                  </span>
                )}
                <span className="th-mind-sym">{t.symbol || '—'}</span>
              </span>
              {showMeta && (
                <span className="th-mind-meta">
                  <span className="th-mind-share">{pct}</span>
                  {hasChg && <span className={`th-mind-chg ${chg >= 0 ? 'pos' : 'neg'}`}>{fmtPctShort(chg)}</span>}
                </span>
              )}
              {showFoot && (
                <span className="th-mind-foot">
                  <span className="th-mind-mentions">{fmtCount(t.value)} mentions</span>
                  <span className="th-mind-bar" aria-hidden="true">
                    <span className="th-mind-bar-fill" style={{ width: `${Math.max(8, Math.round((t.value / topVal) * 100))}%` }} />
                  </span>
                </span>
              )}
            </button>
          )
        })
      )}
    </div>
  )
}

export default function TrendingHub({ navigateTo, selectToken, embedded = false }) {
  const isMobile = useIsMobile()
  const [prefs, setPrefs] = useState(() => loadPrefs())
  const [globalChain, setGlobalChain] = useState(prefs.defaultChain)
  const [globalTimeframe, setGlobalTimeframe] = useState(prefs.defaultTimeframe)
  const [customizeOpen, setCustomizeOpen] = useState(false)

  // Terminal view state
  const [tab, setTab] = useState('data')
  const [dataSub, setDataSub] = useState('trending-cg')
  const [socialSub, setSocialSub] = useState('social-mentions')
  const [selectedCat, setSelectedCat] = useState(null)

  // Per-section data state
  const [trendingCg, setTrendingCg] = useState({ rows: [], loading: true, error: null })
  const [topGainers, setTopGainers] = useState({ rows: [], loading: true, error: null })
  const [topLosers, setTopLosers] = useState({ rows: [], loading: true, error: null })
  const [volLeaders, setVolLeaders] = useState({ rows: [], loading: true, error: null })
  const [newPairs, setNewPairs] = useState({ rows: [], loading: true, error: null })
  const [mostTraded, setMostTraded] = useState({ rows: [], loading: true, error: null })
  const [dossierSignals, setDossierSignals] = useState({ rows: [], loading: true, error: null })
  const [socialMentions, setSocialMentions] = useState({ rows: [], loading: true, error: null })
  const [socialMomentum, setSocialMomentum] = useState({ rows: [], loading: true, error: null })
  /* Momentum-origin is one request per row. Resolve the first screen of the
     ACTIVE ranking on load; everything else is driven by DenseTable's row
     observer as the user scrolls (see handleSocialRowVisible below). */
  const MOM_ORIGIN_EAGER = 10
  const momQueueRef = useRef(new Map())   // cgId -> row
  const momFlushRef = useRef(null)
  const momAliveRef = useRef(true)
  const activeSocialSetterRef = useRef(null)
  useEffect(() => {
    momAliveRef.current = true
    return () => {
      momAliveRef.current = false
      if (momFlushRef.current) { clearTimeout(momFlushRef.current); momFlushRef.current = null }
      momQueueRef.current.clear()
    }
  }, [])
  const handleSocialRowVisible = useCallback((row) => {
    if (!row || !row.cgId || row.originResolved || !momAliveRef.current) return
    if (momQueueRef.current.has(row.cgId)) return
    momQueueRef.current.set(row.cgId, row)
    if (momFlushRef.current) return
    // Coalesce a scroll burst into one batch; resolveMomentumOrigins caps
    // concurrency at 4 and fetchMomentumOrigin is cached + in-flight deduped.
    momFlushRef.current = setTimeout(() => {
      momFlushRef.current = null
      if (!momAliveRef.current) return
      const setter = activeSocialSetterRef.current
      if (!setter) return
      const batch = [...momQueueRef.current.values()]
      momQueueRef.current.clear()
      resolveMomentumOrigins(batch, setter)
    }, 250)
  }, [])
  const [socialConviction, setSocialConviction] = useState({ rows: [], loading: true, error: null })
  const [holdersGrowth, setHoldersGrowth] = useState({ rows: [], loading: true, error: null })
  const [categories, setCategories] = useState({ rows: [], loading: true, error: null })

  // Persist prefs
  useEffect(() => { savePrefs(prefs) }, [prefs])

  const networkIdsFor = (chainId) => CHAIN_OPTIONS.find((c) => c.id === chainId)?.networkIds || CHAIN_OPTIONS[0].networkIds

  // Spectre Pulse - PARITY with the Discover page's Project Discovery table.
  // Lead rows come from the SAME server traction engine (/api/tokens/trending:
  // Codex screen + DexScreener enrich + quality gates + trendScore order) through
  // the SAME shared module cache (prefetchTrending), so #discover ↔ #trending show
  // identical tokens in identical order and reuse one fetch. The broad Codex
  // volume screen then FILLS the tail (deduped) so the dense table still fills
  // the viewport - the trending board alone is ~30-50 rows.
  const loadTrendingCg = useCallback(async (chain = globalChain, tf = globalTimeframe) => {
    setTrendingCg((s) => ({ ...s, loading: true, error: null }))
    try {
      const networkIds = networkIdsFor(chain)
      // GT-only chains (Robinhood): Codex can't screen them - top pools by 24h volume.
      const gtNet = gtOnlyNetworkFor(networkIds)
      if (gtNet) {
        const rows = await fetchChainOnlyBoard(gtNet, tf)
        setTrendingCg({ rows, loading: false, error: null })
        // Age the freshness chip from when the DATA was built, not from this
        // fetch - the board is served through a server + edge cache, so the two
        // are not the same and only one of them is honest.
        setLastRefreshAt(rows.asOf || Date.now())
        return
      }
      // 'all' must request the Discover table's exact 3-chain set - the engine
      // computes + caches per network set, so a wider set = a different board.
      const trendNets = chain === 'all' ? DISCOVERY_ALL_CHAINS : networkIds
      const [trendRes, screenRes] = await Promise.allSettled([
        prefetchTrending(trendNets, tf),
        screenTokens(
          { liquidity: { gte: 10000 }, marketCap: { gte: 500000 } },
          { networks: networkIds, sort: 'volume24', sortDir: 'DESC', limit: 100 }
        ),
      ])
      // Real rows only - the hook's static curated fallback (majors with
      // placeholder numbers) must not masquerade as a live trending board.
      // 'codex' = the traction engine; 'spectre-trending' = the Hetzner
      // CG-trending partial served in degraded mode (Codex outage) - real
      // live data, just shorter.
      const lead = (trendRes.status === 'fulfilled' && Array.isArray(trendRes.value) ? trendRes.value : [])
        .filter((t) => t && (t._source === 'codex' || t._source === 'spectre-trending'))
        .map(mapDiscoveryRow)
      const fill = (screenRes.status === 'fulfilled' ? (screenRes.value || []) : []).map(mapCodexRow).filter(isCleanRow)
      const seen = new Set(lead.map(rowDedupeKey))
      // The trending-engine lead rows carry no description/socials (the engine
      // payload has none), but the screener fill for the SAME token does. Graft
      // those fields onto lead rows before dedupe drops the fill copy, so the
      // About column is populated for the top of the board too.
      const fillByKey = new Map(fill.map((r) => [rowDedupeKey(r), r]))
      for (const l of lead) {
        const f = fillByKey.get(rowDedupeKey(l))
        if (f) {
          if (!l.description) l.description = f.description
          if (!l.twitter) l.twitter = f.twitter
          if (!l.telegram) l.telegram = f.telegram
          if (!l.website) l.website = f.website
        }
      }
      const rows = [...lead]
      for (const r of fill) {
        const k = rowDedupeKey(r)
        if (!seen.has(k)) { seen.add(k); rows.push(r) }
      }
      if (rows.length === 0) throw new Error('No trending data')
      setTrendingCg({ rows, loading: false, error: null })
      // Rug screen the filler tail async - confirmed rugs vanish on verdict.
      screenRowsSafety(rows).then((drops) => {
        if (drops) setTrendingCg((s) => ({ ...s, rows: s.rows.filter((r) => !drops.has(r.address)) }))
      })
    } catch (e) {
      setTrendingCg({ rows: [], loading: false, error: e.message || 'Failed to load' })
    }
  }, [globalChain, globalTimeframe])

  // Top Gainers / Losers / Volume Leaders / New Pairs (Codex)
  const loadCodexSection = useCallback(async (sectionId, chain, tf) => {
    const setter = {
      'top-gainers': setTopGainers,
      'top-losers': setTopLosers,
      'volume-leaders': setVolLeaders,
      'new-pairs': setNewPairs,
      'most-traded': setMostTraded,
    }[sectionId]
    if (!setter) return
    setter((s) => ({ ...s, loading: true, error: null }))
    try {
      const networkIds = networkIdsFor(chain)
      // GT-only chains (Robinhood): one cached GT pool list serves every section,
      // sorted client-side (Codex has no coverage there).
      const gtNet = gtOnlyNetworkFor(networkIds)
      if (gtNet) {
        // One board serves every section - the hub sorts it client-side.
        const gtRows = await fetchChainOnlyBoard(gtNet, tf)
        const chg = { '5m': 'change5m', '1h': 'change1h', '6h': 'change4h', '24h': 'change' }[tf] || 'change'
        const out = [...gtRows]
        if (sectionId === 'top-gainers')          out.sort((a, b) => (b[chg] || 0) - (a[chg] || 0))
        else if (sectionId === 'top-losers')      out.sort((a, b) => (a[chg] || 0) - (b[chg] || 0))
        else if (sectionId === 'volume-leaders')  out.sort((a, b) => (b.volume24 || 0) - (a.volume24 || 0))
        else if (sectionId === 'most-traded')     out.sort((a, b) => (b.txns || 0) - (a.txns || 0))
        else if (sectionId === 'new-pairs')       out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        setter({ rows: out, loading: false, error: null })
        setLastRefreshAt(gtRows.asOf || Date.now())
      screenRowsSafety(out).then((drops) => {
        if (drops) setter((st) => ({ ...st, rows: st.rows.filter((r) => !drops.has(r.address)) }))
      })
        return
      }
      // Map our timeframe IDs to the Codex ranking-attribute names. The Codex schema
      // doesn't expose a 6h aggregate, so we approximate with change4 (4h).
      const codexChangeAttr = { '5m': 'change5m', '1h': 'change1', '6h': 'change4', '24h': 'change24' }[tf] || 'change24'
      const sortBy =
        sectionId === 'top-gainers' || sectionId === 'top-losers' ? codexChangeAttr
        : sectionId === 'volume-leaders' ? 'volume24'
        : sectionId === 'most-traded' ? 'txnCount24'
        : sectionId === 'new-pairs' ? 'createdAt'
        : 'volume24'
      const sortDir = sectionId === 'top-losers' ? 'ASC' : 'DESC'
      const filters = {}
      // Server-side createdAt filter isn't supported - rely on sort=createdAt DESC.
      filters.liquidity = { gte: sectionId === 'new-pairs' ? 1000 : 5000 }
      // Need higher limit for losers because server filters out spam, then we sort client-side.
      const limit = (sectionId === 'top-gainers' || sectionId === 'top-losers') ? 100 : 50
      const results = await screenTokens(filters, { networks: networkIds, sort: sortBy, sortDir, limit })
      let out = (results || []).map(mapCodexRow).filter(isCleanRow)
      // Local fallback sort to guarantee correct order (server may rerank by spam filter)
      if (sectionId === 'top-gainers') out.sort((a, b) => (b.change || 0) - (a.change || 0))
      if (sectionId === 'top-losers')  out.sort((a, b) => (a.change || 0) - (b.change || 0))
      if (sectionId === 'volume-leaders') out.sort((a, b) => (b.volume24 || 0) - (a.volume24 || 0))
      setter({ rows: out, loading: false, error: null })
    } catch (e) {
      setter({ rows: [], loading: false, error: e.message || 'Failed to load' })
    }
  }, [])

  // Categories (CG)
  const loadCategories = useCallback(async () => {
    setCategories((s) => ({ ...s, loading: true, error: null }))
    try {
      const res = await fetch('/api/coingecko/coins/categories')
      const data = await res.json().catch(() => [])
      const list = Array.isArray(data) ? data : []
      const sorted = [...list].sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0))
      setCategories({ rows: sorted, loading: false, error: null })
    } catch (e) {
      setCategories({ rows: [], loading: false, error: e.message || 'Failed to load' })
    }
  }, [])

  // Reload Spectre Pulse when chain or timeframe changes (loadTrendingCg's
  // identity carries the timeframe dep, so tf switches refire this too).
  useEffect(() => {
    loadTrendingCg(globalChain)
  }, [loadTrendingCg, globalChain])

  // ── Keep the board actually live ───────────────────────────────────────
  // The header has always said "Live", but until 2026-09-01 every Markets
  // dataset was a ONE-SHOT fetch: it loaded on mount and on a chain/timeframe
  // change, and then sat there. A tab left open through a session showed
  // hour-old prices under a pulsing live dot. This is the refresh that makes
  // the claim true.
  //
  // Cost discipline (the 2026-06 Codex bill is why the dossier lane is dead):
  //   - only the dataset ON SCREEN is refreshed, never all twelve;
  //   - the same idle + visibility guards the X-Dash poll uses, so a forgotten
  //     tab and a backgrounded window both cost nothing;
  //   - 60s on GeckoTerminal chains (free API, 60s server cache anyway) vs 120s
  //     on Codex-backed chains, where each tick is a paid filterTokens call.
  const [lastRefreshAt, setLastRefreshAt] = useState(() => Date.now())
  const refreshActiveRef = useRef(() => {})
  refreshActiveRef.current = () => {
    if (typeof document !== 'undefined' && document.hidden) return
    if (!isAppActive()) return
    if (tab === 'social') return   // the X-Dash poll below owns the social rail
    if (dataSub === 'categories' || dataSub === 'dossier-signals') return
    if (dataSub === 'trending-cg') loadTrendingCg(globalChain, globalTimeframe)
    else if (dataSub === 'holders-growth') loadHoldersGrowth(globalChain)
    else loadCodexSection(dataSub, globalChain, globalTimeframe)
    // Chains served from the cached server board stamp their own DATA time when
    // the load resolves (it lands after this line and wins). Everything else is
    // fetched live, so its data age IS its fetch time.
    if (!onGtChainRef.current) setLastRefreshAt(Date.now())
  }
  const onGtChain = !!gtOnlyNetworkFor(networkIdsFor(globalChain))
  const onGtChainRef = useRef(onGtChain); onGtChainRef.current = onGtChain
  useEffect(() => {
    const period = onGtChain ? 60_000 : 120_000
    const iv = setInterval(() => refreshActiveRef.current(), period)
    return () => clearInterval(iv)
  }, [onGtChain])
  // A dataset the user just switched to is fresh by definition - restart the
  // clock so the "updated Ns ago" readout never inherits the previous view's age.
  useEffect(() => { setLastRefreshAt(Date.now()) }, [tab, dataSub, globalChain, globalTimeframe])

  // Sectors load once; retry on tab open if the mount fetch failed (a cold
  // CG proxy 502 used to leave the tab on "No sectors available." forever).
  useEffect(() => {
    loadCategories()
  }, [loadCategories])
  useEffect(() => {
    if (tab === 'categories' && !categories.loading && categories.rows.length === 0) loadCategories()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // Codex-driven sections refresh on chain or timeframe change.
  // Cost gate: each loadCodexSection is a Codex screenTokens (filterTokens) call.
  // Only load sections the user actually has visible - a user who hid some
  // sections via prefs shouldn't pay for their data. Default prefs show all of
  // them, so default users are unaffected.
  // Cost/speed: only the RUNNER sources (gainers + new-pairs) load on mount — the
  // Potential Runners dock needs them. Losers / Volume / Most-Traded are DEFERRED
  // and fetched the first time the user opens that view (below), so the page boots
  // on far fewer Codex calls.
  useEffect(() => {
    const RUNNER_SECTIONS = ['top-gainers', 'new-pairs']
    const vis = prefs?.visibleSections || RUNNER_SECTIONS
    RUNNER_SECTIONS.forEach((sid) => {
      if (vis.includes(sid)) loadCodexSection(sid, globalChain, globalTimeframe)
    })
  }, [loadCodexSection, globalChain, globalTimeframe, prefs?.visibleSections])

  // Lazy-load the deferred Codex sections only when their Markets view is opened.
  useEffect(() => {
    const LAZY = ['top-losers', 'volume-leaders', 'most-traded']
    if (tab === 'data' && LAZY.includes(dataSub)) loadCodexSection(dataSub, globalChain, globalTimeframe)
  }, [tab, dataSub, loadCodexSection, globalChain, globalTimeframe])

  // Dossier signals - fetches Brain signals + annotations from the OVH dossier
  // service. 2026-06-03 COST WAR HARD-DISABLE: OVH was firing Codex
  // filterTokens with heavy field selection (lockstep) on each dossier call.
  // Trading-app mount in /token iframe = burst of these calls = ~580K/day.
  // Killing at the source. Re-enable after OVH packages/server/index.js
  // filterTokens queries are shrunk to match PR #735 pattern OR re-wire
  // VITE_DOSSIER_API to Hetzner's /v1/dossier/* endpoints.
  const KILL_OVH_DOSSIER = true
  const loadDossierSignals = useCallback(async () => {
    if (KILL_OVH_DOSSIER) { setDossierSignals({ rows: [], loading: false, error: null }); return }
    // Idle/visibility guard. Stops dossier-signals polling on forgotten tabs.
    if (typeof document !== 'undefined' && document.hidden) return
    if (!isAppActive()) return
    setDossierSignals((s) => ({ ...s, loading: true, error: null }))
    try {
      const dossierBase = (import.meta.env.VITE_DOSSIER_API || '') + '/api/dossier'
      const res = await fetch(`${dossierBase}/signals?limit=40`)
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = await res.json().catch(() => ({}))
      const signals = data?.signals || []
      // Group by token (ca + chain) and pick the strongest signal per token
      const tokenMap = new Map()
      for (const sig of signals) {
        const key = `${(sig.chain || 'eth').toLowerCase()}:${(sig.ca || '').toLowerCase()}`
        if (!key.endsWith(':')) {
          const cur = tokenMap.get(key)
          if (!cur || (Number(sig.score) || 0) > (Number(cur.score) || 0)) {
            tokenMap.set(key, sig)
          }
        }
      }
      const chainToNet = { eth: 1, base: 8453, bsc: 56, arb: 42161, poly: 137, sol: 1399811149 }
      const titleize = (k) => String(k || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      const rows = [...tokenMap.values()].slice(0, 25).map((sig) => {
        const tk = sig.token || {}
        const mk = sig.market || {}
        const ev = sig.evidence || {}
        const symbol = (tk.symbol || '').toString().toUpperCase().slice(0, 14) || titleize(sig.kind).slice(0, 14)
        return {
          address: sig.ca,
          symbol,
          // narrative is the human-readable signal description; surface it as the secondary line
          name: sig.narrative || `${titleize(sig.kind)} - ${tk.name || ''}`.trim(),
          networkId: chainToNet[(sig.chain || '').toLowerCase()] || 1,
          price: parseFloat(mk.priceUsd ?? ev.price) || 0,
          change: parseFloat(mk.change24h ?? ev.change24h) || 0,
          marketCap: parseFloat(mk.mcap ?? ev.mcap) || 0,
          volume24: parseFloat(mk.vol24h ?? ev.vol24h) || 0,
          liquidity: parseFloat(mk.liquidity ?? ev.liquidity) || 0,
          logo: tk.logo || tk.imageThumbUrl || '',
          score: Number(sig.score) || 0,
          kind: sig.kind,
        }
      })
      setDossierSignals({ rows, loading: false, error: null })
    } catch (e) {
      setDossierSignals({ rows: [], loading: false, error: e.message || 'Dossier API offline' })
    }
  }, [])

  useEffect(() => {
    loadDossierSignals()
    const iv = setInterval(loadDossierSignals, 60000)
    return () => clearInterval(iv)
  }, [loadDossierSignals])

  // Holders growth - use Codex sorted by holders DESC as a proxy until a delta endpoint exists
  const loadHoldersGrowth = useCallback(async (chain) => {
    setHoldersGrowth((s) => ({ ...s, loading: true, error: null }))
    try {
      const networkIds = networkIdsFor(chain)
      // GeckoTerminal exposes no holder counts, so this used to rank by 24h
      // traders and render an em dash in the Holders column for every row. The
      // server lane carries REAL holder counts from the chain's own explorer,
      // so rank by holders when we have them and keep the txns ordering as the
      // fallback for rows (or a degraded board) that still lack them.
      const gtNet = gtOnlyNetworkFor(networkIds)
      if (gtNet) {
        const board = await fetchChainOnlyBoard(gtNet)
        const rows = [...board]
          .sort((a, b) => (b.holders || 0) - (a.holders || 0) || (b.txns || 0) - (a.txns || 0))
        setLastRefreshAt(board.asOf || Date.now())
        recordFirstSpottedRows(rows)
        setHoldersGrowth({ rows, loading: false, error: null })
        return
      }
      const results = await screenTokens(
        { liquidity: { gte: 5000 }, holders: { gte: 100 } },
        { networks: networkIds, sort: 'holders', sortDir: 'DESC', limit: 50 }
      )
      const out = (results || []).map(mapCodexRow).filter(isCleanRow)
      recordFirstSpottedRows(out)
      setHoldersGrowth({ rows: out, loading: false, error: null })
    } catch (e) {
      setHoldersGrowth({ rows: [], loading: false, error: e.message || 'Failed to load' })
    }
  }, [])
  useEffect(() => { loadHoldersGrowth(globalChain) }, [loadHoldersGrowth, globalChain])

  // X Dash bootstrap returns the same trending feed as the Spectre AI X DASH dashboard.
  // Endpoint: /api/xdash/bootstrap?ranking=mentions|momentum|conviction&timeframe=24h|7d
  const loadXDashRanking = useCallback(async (ranking, tf, setter, eagerOrigins = 0) => {
    setter((s) => ({ ...s, loading: true, error: null }))
    try {
      const xtf = tf === '7d' ? '7d' : '24h'
      const xRanking = ranking === 'conviction' ? 'conviction' : ranking === 'momentum' ? 'momentum' : 'mentions'
      const params = new URLSearchParams({
        page: '1', per_page: '30',
        timeframe: xtf, ranking: xRanking,
        segment: 'all', market: 'all', min_kols: '1',
      })
      const res = await fetch(`/api/xdash/bootstrap?${params}`)
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = await res.json().catch(() => ({}))
      const arr = Array.isArray(data?.tokens) ? data.tokens : []
      const rows = arr.map((item) => {
        const tk = item?.token || {}
        const m = item?.metrics || {}
        // REAL X-Dash momentum entry — the true first-spotted market cap + date the
        // engine caught the token at (NOT the client-tracked ledger, which was wrong:
        // ANSEM showed ~$90M when its real entry was ~$5.85M).
        const me = item?.momentum_entry || tk?.momentum_entry || {}
        const rpm = item?.reconstructed_public_momentum || tk?.reconstructed_public_momentum || {}
        // The token's CoinGecko id — the lookup key for /api/xdash/momentum-origin/{cgId}.
        const cgIdRaw = (tk.cg_id || '').toString().toLowerCase().trim()
        const cgId = /^[a-z0-9-]+$/.test(cgIdRaw) ? cgIdRaw : null
        const spottedMc = parseFloat(me.entry_market_cap) || 0
        const spottedAt = me.entered_at || null
        const sinceRaw = rpm.current_return_pct_from_entry_mcap
        const sinceReturn = (sinceRaw != null && sinceRaw !== '' && isFinite(Number(sinceRaw))) ? Number(sinceRaw) : null
        // Top KOL authors carrying the token (avatar → in-app X Dash, name → tooltip).
        const authorsSrc = Array.isArray(item?.top_authors) ? item.top_authors
          : Array.isArray(tk?.top_authors) ? tk.top_authors
          : Array.isArray(m?.top_authors) ? m.top_authors : []
        const kols = authorsSrc
          .map((a) => ({
            name: a?.name || a?.screen_name || '',
            screen_name: (a?.screen_name || '').toString().replace(/^@/, ''),
            avatar: a?.avatar_image_url || a?.avatar || a?.profile_image_url || '',
            followers: Number(a?.followers_count) || 0,
            mentions: Number(a?.mention_count) || 0,
          }))
          .filter((a) => a.screen_name || a.avatar)
          .slice(0, 12)
        const score =
          xRanking === 'mentions'   ? (parseFloat(m.mentions_24h ?? m.external_mentions_24h ?? m.total_mentions) || 0)
          : xRanking === 'momentum' ? (parseFloat(m.velocity_ratio ?? m.novelty_ratio) || 0)
          : /* conviction */          (parseFloat(m.effective_unique_external_authors_24h ?? m.unique_external_authors_24h) || 0)
        // Real chain + contract address from the payload (chain slug / platforms
        // map) - fixes the wrong default-ETH pill on SOL/BASE tokens and lets a
        // row click open the token page by real CA. Unknown chain → null (no pill).
        const chainInfo = xdashChainInfo(tk)
        return {
          address: chainInfo.address || tk.cg_id || tk.token_id || tk.symbol || '',
          cgId, // real CoinGecko id (validated) → momentum-origin + CG enrichment key
          symbol: (tk.cashtag || tk.symbol || '').toString().toUpperCase().replace(/^\$/, '').slice(0, 14),
          name: tk.name || tk.cashtag || tk.symbol || '',
          networkId: chainInfo.networkId,
          price: 0, change: 0, volume24: 0, liquidity: 0,
          marketCap: parseFloat(tk.market_cap) || 0,
          logo: tk.image_thumb || tk.image_small || tk.image_large || tk.image_url || '',
          score,
          mentions: parseFloat(m.mentions_24h ?? m.external_mentions_24h ?? m.total_mentions) || 0,
          velocity: parseFloat(m.velocity_ratio) || 0,
          authors: parseFloat(m.unique_external_authors_24h ?? m.effective_unique_external_authors_24h) || 0,
          // Radar date — when X-Dash first indexed the token onto the leaderboard.
          firstSeenAt: tk.indexation_timestamp || null,
          // REAL first-spotted alpha (momentum_entry) + reconstructed return + KOLs.
          spottedMc,
          spottedAt,
          sinceReturn,
          kols,
        }
      })
      if (rows.length === 0) throw new Error('X Dash returned no tokens')

      // Snapshot timestamp from the X Dash collector — the rankings only move
      // when a new collect run lands (~every 20-60 min upstream), so surface
      // the age honestly in the rail header instead of implying live counts.
      const asOf = Date.parse(data?.generated_at_utc || '') || null

      // Ledger the X-Dash baseline mcap (write-once) BEFORE price enrichment can
      // overwrite it — this is the "first spotted MC" the Since multiple divides into.
      recordFirstSpottedRows(rows)

      // Show social IMMEDIATELY — the X Dash payload already carries the social
      // signal (mentions/velocity/authors). Do NOT block the rail on price enrichment.
      setter({ rows, loading: false, error: null, asOf })

      // Fill in the REAL X-Dash "first surfaced" ROI (Spotted / Spotted MC / Since)
      // from /api/xdash/momentum-origin/{cgId} — background, cached + deduped +
      // bounded concurrency, never blocks the render.
      //
      // ONE REQUEST PER ROW, so this used to cost 48 calls per Trending open:
      // three rankings (mentions/momentum/conviction) each resolved their whole
      // list, while only ONE ranking is ever on screen. Now only the ranking the
      // user is actually looking at resolves eagerly, and only its first screen
      // — DenseTable's row observer resolves the rest as they scroll into view.
      // The columns that need it already shimmer while pending, so a row that
      // has not been reached simply stays in that state.
      if (eagerOrigins > 0) resolveMomentumOrigins(rows.slice(0, eagerOrigins), setter)

      // Enrich live price + MULTI-TIMEFRAME change (1h/24h/7d) via CoinGecko markets
      // in the BACKGROUND, then update in place. A slow/failed CG call never leaves the
      // rail empty. `coins/markets` returns an ARRAY → key it by `id` for the row join.
      // Keyed by cgId - `address` now carries the on-chain CA, not the CoinGecko id.
      try {
        const cgIds = rows.map((r) => (r.cgId || '').toLowerCase()).filter((id) => id && /^[a-z0-9-]+$/.test(id))
        if (cgIds.length > 0) {
          const params = new URLSearchParams({
            vs_currency: 'usd',
            ids: cgIds.join(','),
            price_change_percentage: '1h,24h,7d',
            sparkline: 'false',
          })
          // 12s - the CG proxy's serial rate queue can exceed 6s on a cold
          // server; a starved enrichment left the rail without price/change
          // (and the X-Confirmed runner gates without mcap/volume) for 90s.
          const cgRes = await fetch(`/api/coingecko/coins/markets?${params}`, { signal: AbortSignal.timeout(12000) })
          if (cgRes.ok) {
            const cgArr = await cgRes.json().catch(() => [])
            const byId = new Map((Array.isArray(cgArr) ? cgArr : []).map((m) => [(m.id || '').toLowerCase(), m]))
            for (const r of rows) {
              const m = byId.get((r.cgId || '').toLowerCase())
              if (m) {
                r.price = Number(m.current_price) || r.price
                r.marketCap = Number(m.market_cap) || r.marketCap
                r.volume24 = Number(m.total_volume) || 0
                r.change1h = Number(m.price_change_percentage_1h_in_currency) || 0
                r.change = Number(m.price_change_percentage_24h_in_currency) || 0
                r.change7d = Number(m.price_change_percentage_7d_in_currency) || 0
              }
            }
            setter({ rows: [...rows], loading: false, error: null, asOf })
          }
        }
      } catch (_) { /* price enrichment optional — social already shown */ }
    } catch (e) {
      // Keep-last-good: a transient poll failure (server restart, slow upstream)
      // must NOT wipe an already-rendered rail to "Social feed reconnecting".
      // Only surface the error state when we never had rows to show.
      setter((s) => (Array.isArray(s.rows) && s.rows.length > 0
        ? { ...s, loading: false, error: null }
        : { rows: [], loading: false, error: e.message || 'X Dash offline' }))
    }
  }, [])

  useEffect(() => {
    const fire = () => {
      // Idle/visibility guard. Stops X-Dash polling on forgotten tabs.
      if (typeof document !== 'undefined' && document.hidden) return
      if (!isAppActive()) return
      // Only the ranking currently on screen resolves origins up front (read
      // through refs so switching sub-tabs never re-fires the loaders).
      const onSocial = tabRef.current === 'social'
      const sub = socialSubRef.current
      const eager = (key) => (onSocial && sub === key ? MOM_ORIGIN_EAGER : 0)
      loadXDashRanking('mentions', globalTimeframe, setSocialMentions, eager('social-mentions'))
      loadXDashRanking('momentum', globalTimeframe, setSocialMomentum, eager('social-momentum'))
      loadXDashRanking('conviction', globalTimeframe, setSocialConviction, eager('social-conviction'))
    }
    fire()
    const iv = setInterval(fire, 90000)
    return () => clearInterval(iv)
  }, [loadXDashRanking, globalTimeframe])

  const sectionData = {
    'trending-cg': trendingCg,
    'top-gainers': topGainers,
    'top-losers': topLosers,
    'volume-leaders': volLeaders,
    'new-pairs': newPairs,
    'most-traded': mostTraded,
    'dossier-signals': dossierSignals,
    'social-mentions': socialMentions,
    'social-momentum': socialMomentum,
    'social-conviction': socialConviction,
    'holders-growth': holdersGrowth,
    'categories': categories,
  }

  const activeData = sectionData[tab === 'social' ? socialSub : dataSub] || { rows: [], loading: false, error: null }

  // Markets stage rows after the risk filter. Applied here (not inside the
  // loaders) so flipping the switch is instant and never refetches, and so the
  // count in the empty state can tell the user what the filter removed rather
  // than leaving them staring at a blank board.
  const riskFilter = prefs.riskFilter || 'all'
  const marketRows = useMemo(() => {
    const rows = activeData.rows || []
    if (riskFilter !== 'safe') return rows
    return rows.filter((r) => rowSafety(r)?.grade !== 'risky')
  }, [activeData.rows, riskFilter])
  const riskHiddenCount = (activeData.rows?.length || 0) - marketRows.length

  /* Refs the X-Dash loaders and the row observer read, so switching sub-tabs
     never re-fires a loader and the observer always writes into the dataset
     that is actually on screen. */
  const tabRef = useRef(tab); tabRef.current = tab
  const socialSubRef = useRef(socialSub); socialSubRef.current = socialSub
  activeSocialSetterRef.current = {
    'social-mentions': setSocialMentions,
    'social-momentum': setSocialMomentum,
    'social-conviction': setSocialConviction,
  }[socialSub] || null

  // Left-rail nav is contextual: data datasets ("Views") or social rankings.
  const railNavItems = tab === 'social' ? SOCIAL_SUBS : DATA_SUBS
  const railNavLabel = tab === 'social' ? 'Rankings' : 'Views'
  const railNavActiveId = tab === 'social' ? socialSub : (tab === 'data' ? dataSub : null)
  const handleRailNav = (id) => {
    if (tab === 'social') setSocialSub(id)
    else { setTab('data'); setDataSub(id) }
  }
  const railChains = (() => {
    const vis = prefs.visibleChains
    let list = CHAIN_OPTIONS
    if (vis && vis.length > 0) {
      list = CHAIN_OPTIONS.filter((c) => vis.includes(c.id))
      if (!list.find((c) => c.id === 'all')) list = [CHAIN_OPTIONS[0], ...list]
    }
    return list
  })()

  // ── Potential Runners: derive a lightweight runner signal from data ALREADY
  // loaded (gainers + new pairs + the broad volume screen). No new fetch.
  // Runner pool = the Codex movers PLUS the live social board (mentions + momentum),
  // whose rows carry CG market cap / volume / 24h change. This is what makes
  // X-Confirmed real: a socially-hot small-cap mover (ZIG / ANSEM / KINS) becomes a
  // runner even when the Codex screener didn't surface it. computeRunners dedupes
  // by symbol, so overlaps collapse to the best-scoring instance.
  // NOTE: the FULL scored candidate list is kept (no slice) so each segment picks
  // its own top 15. Slicing BEFORE the X filter made X-Confirmed near-permanently
  // empty: fresh Codex degens (+400-900% pumps) always outscored a socially-hot
  // +10-50% mover, so the intersection of "top 15 overall" and the social board
  // was ~never non-empty. Gates (momentum/volume/mcap) still apply to both.
  const runnerCandidates = useMemo(
    () => computeRunners([...topGainers.rows, ...newPairs.rows, ...trendingCg.rows, ...socialMentions.rows, ...socialMomentum.rows], Infinity),
    [topGainers.rows, newPairs.rows, trendingCg.rows, socialMentions.rows, socialMomentum.rows]
  )
  const allRunners = useMemo(() => runnerCandidates.slice(0, 15), [runnerCandidates])
  // X-Confirmed = the market is ACTUALLY talking about it. Build a set of symbols the
  // live social feed (mentions + momentum) mentions, then keep only runners in it — a
  // fast pump nobody's tweeting about is NOT x-confirmed (the anti-larp filter).
  const socialSymbols = useMemo(() => {
    const set = new Set()
    const add = (rows) => { for (const r of rows || []) { const s = (r.symbol || '').toUpperCase().replace(/^\$/, ''); if (s) set.add(s) } }
    add(socialMentions.rows)
    add(socialMomentum.rows)
    return set
  }, [socialMentions.rows, socialMomentum.rows])
  const isXConfirmed = (r) => socialSymbols.has((r.symbol || '').toUpperCase().replace(/^\$/, ''))
  const xRunners = useMemo(
    () => runnerCandidates.filter(isXConfirmed).slice(0, 15),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runnerCandidates, socialSymbols]
  )
  const runnersXOnly = prefs.runnersFilter === 'x'
  const runners = runnersXOnly ? xRunners : allRunners

  // Header tape feed: X-confirmed first (the anti-larp default); when the
  // social feed has no overlap yet, fall back to the full runner pool so the
  // tape never sits empty while the market is moving.
  const tapeRunners = useMemo(
    () => (xRunners.length > 0 ? xRunners : allRunners),
    [xRunners, allRunners]
  )

  // Board share per chain (rail badges) - where the action is right now.
  const chainCounts = useMemo(() => {
    const m = new Map()
    for (const r of trendingCg.rows || []) {
      if (r.networkId) m.set(r.networkId, (m.get(r.networkId) || 0) + 1)
    }
    return m
  }, [trendingCg.rows])

  // Board pulse - breadth / flow / freshness, derived from loaded boards.
  const pulse = useMemo(() => {
    const rows = Array.isArray(trendingCg.rows) ? trendingCg.rows : []
    const n = rows.length
    const g = rows.filter((r) => Number(r.change) > 0).length
    const vol = rows.reduce((sum, r) => sum + (Number(r.volume24) || 0), 0)
    // median, not mean - one +5,000% outlier made the old average meaningless
    const sorted = rows.map((r) => Number(r.change) || 0).sort((a, b) => a - b)
    const avg = n ? sorted[Math.floor(n / 2)] : 0
    const dayAgo = Date.now() - 86400e3
    const fresh = (newPairs.rows || []).filter((r) => {
      let t = Number(r.createdAt)
      if (!isFinite(t) || t <= 0) return false
      if (t < 1e12) t *= 1000
      return t >= dayAgo
    }).length
    return { n, g, vol, avg, fresh }
  }, [trendingCg.rows, newPairs.rows])

  // Rule-derived desk insights - honest one-liners computed from live state,
  // ordered by how actionable they are. No fabricated narratives.
  const insights = useMemo(() => {
    const out = []
    let domId = null
    let domN = 0
    for (const [id, cnt] of chainCounts) { if (cnt > domN) { domN = cnt; domId = id } }
    if (domId && pulse.n > 0 && domN / pulse.n >= 0.4) {
      out.push({ k: 'Rotation', t: `${chainMeta(domId).label} carries ${domN}/${pulse.n} of the board` })
    }
    if (pulse.vol > 0) out.push({ k: 'Flow', t: `${fmtUSD(pulse.vol)} moving through trending` })
    if (pulse.fresh > 0) out.push({ k: 'Fresh', t: `${pulse.fresh} new pairs in the last 24h` })
    const heat = (socialMomentum.rows || [])[0]
    if (heat && Number(heat.velocity) > 1.05) {
      out.push({ k: 'Attention', t: `${heat.symbol} leads CT at ${Number(heat.velocity).toFixed(1)}x velocity` })
    }
    if (xRunners.length > 0) out.push({ k: 'Confirmed', t: `${xRunners.length} runners live on X right now` })
    return out.slice(0, 4)
  }, [chainCounts, pulse, socialMomentum.rows, xRunners.length])

  // Inline AI reads for the Markets board. The server warmer pre-generates the
  // engine board's reads and the batch endpoint answers instantly from cache
  // with a `pending` list for rows still being written - requestBriefs polls
  // those until they land. It's also handed to DenseTable, whose
  // IntersectionObserver queues any uncached row that scrolls into view -
  // no tap, no dead cells.
  // OPT-IN since 2026-09-01 (prefs.aiRead): with the switch off nothing here
  // runs, so the board costs zero model calls.
  const aiReadOn = !!prefs.aiRead
  const [briefs, setBriefs] = useState(() => new Map())
  const [briefsLoading, setBriefsLoading] = useState(false)
  const requestBriefs = useCallback(async (rowsToFetch, signal) => {
    let rows = rowsToFetch
    let landed = 0
    for (let attempt = 0; attempt <= BRIEF_POLL_MS.length && rows.length; attempt++) {
      if (signal && signal.cancelled) break
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, BRIEF_POLL_MS[attempt - 1] || 22000))
        if (signal && signal.cancelled) break
      }
      const { map, pendingKeys } = await fetchTokenBriefsBatch(rows)
      // The batch can take seconds; the screen may be gone by now. Without this
      // the loop kept polling (BRIEF_POLL_MS runs ~4.4 min) after unmount.
      if (signal && signal.cancelled) break
      if (map && map.size) {
        landed += map.size
        setBriefs((prev) => { const next = new Map(prev); for (const [k, v] of map) next.set(k, v); return next })
      }
      if (!pendingKeys || pendingKeys.length === 0) break
      const pendingSet = new Set(pendingKeys)
      rows = rows.filter((r) => pendingSet.has(briefKeyFor(r)))
    }
    return landed
  }, [])
  useEffect(() => {
    if (!aiReadOn || tab === 'social') { setBriefsLoading(false); return undefined }
    // Warm the board the user is ACTUALLY looking at. This used to batch
    // trending-cg regardless of the open view, so a session on Gainers paid for
    // 40 reads it never saw and then shimmered while the viewport observer
    // refetched the ones it did. Post-risk-filter for the same reason.
    const rows = marketRows.slice(0, 40)
    if (rows.length === 0) return undefined
    const sig = { cancelled: false }
    setBriefsLoading(true)
    requestBriefs(rows, sig).catch(() => {}).finally(() => { if (!sig.cancelled) setBriefsLoading(false) })
    return () => { sig.cancelled = true }
  }, [marketRows, requestBriefs, aiReadOn, tab])


  // Resizable bottom dock — drag the top edge to resize, click the header to collapse.
  // Height + collapsed state persist via the existing prefs pattern.
  const RUNNERS_PEEK = 48
  const RUNNERS_COLLAPSE_AT = 90
  const maxDockHeight = () => Math.round(Math.min((typeof window !== 'undefined' ? window.innerHeight : 900) * 0.4, 460))
  const [dockHeight, setDockHeight] = useState(() => (prefs.runnersCollapsed ? RUNNERS_PEEK : (prefs.runnersHeight || 118)))
  const [dockDragging, setDockDragging] = useState(false)
  const dockHeightRef = useRef(dockHeight)
  const dockExpandedRef = useRef(prefs.runnersHeight || 118)
  useEffect(() => { dockHeightRef.current = dockHeight }, [dockHeight])
  const dockCollapsed = dockHeight <= RUNNERS_COLLAPSE_AT

  const toggleDock = () => {
    if (dockCollapsed) {
      const target = dockExpandedRef.current || 118
      setDockHeight(target)
      setPrefs((p) => ({ ...p, runnersCollapsed: false, runnersHeight: target }))
    } else {
      dockExpandedRef.current = dockHeightRef.current
      setDockHeight(RUNNERS_PEEK)
      setPrefs((p) => ({ ...p, runnersCollapsed: true, runnersHeight: dockHeightRef.current }))
    }
  }

  const onDockGripDown = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const startH = dockHeightRef.current
    const max = maxDockHeight()
    setDockDragging(true)
    const move = (ev) => {
      const next = Math.max(RUNNERS_PEEK, Math.min(max, startH + (startY - ev.clientY)))
      dockHeightRef.current = next
      setDockHeight(next)
    }
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      setDockDragging(false)
      const h = dockHeightRef.current
      const collapsed = h <= RUNNERS_COLLAPSE_AT
      if (!collapsed) dockExpandedRef.current = h
      setPrefs((p) => ({ ...p, runnersCollapsed: collapsed, runnersHeight: collapsed ? p.runnersHeight : h }))
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  const openRunner = (r) => selectToken?.({
    symbol: r.symbol, name: r.name, address: r.address,
    networkId: r.networkId || 1, price: r.price, change: r.change, logo: r.logo,
  }, 'trending-hub-runner')

  /* ── Mobile: phone layout reuses ALL the state/fetching above and renders
     a single-column hub (tabs → chips → breadth strip → board). The 3-column
     desktop terminal below never mounts on phones. ─────────────────────── */
  if (isMobile && !embedded) {
    return (
      <MobileHub
        navigateTo={navigateTo}
        selectToken={selectToken}
        tabs={TABS}
        tab={tab}
        setTab={setTab}
        viewItems={(tab === 'social' ? SOCIAL_SUBS : DATA_SUBS).filter((s) => s.id !== 'screener')}
        viewActiveId={railNavActiveId}
        onViewSelect={handleRailNav}
        chains={railChains}
        chainCounts={chainCounts}
        globalChain={globalChain}
        setGlobalChain={setGlobalChain}
        timeframeOptions={TIMEFRAME_OPTIONS}
        globalTimeframe={globalTimeframe}
        setGlobalTimeframe={setGlobalTimeframe}
        activeData={activeData}
        pulse={pulse}
        insights={insights}
        categories={categories}
        socialMetric={SOCIAL_METRIC[socialSub]}
      />
    )
  }

  return (
    <div className={`th-page th-terminal${embedded ? ' th-page--embedded' : ''}`}>
      {/* Compact terminal header: id + live stat strip + chrome */}
      <header className="th-term-header">
        <div className="th-th-id">
          {!embedded && (
            <button className="th-back" onClick={() => navigateTo?.('welcome')}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
              <span>Discover</span>
            </button>
          )}
          <div className="th-th-brand">
            <span className="th-th-mark"><SectionGlyph name="spectre" /></span>
            <h1 className="th-th-title">Trending</h1>
            <LiveChip since={lastRefreshAt} />
          </div>
        </div>

        <RunnersTape runners={tapeRunners} isConfirmed={isXConfirmed} onOpen={openRunner} />

        <div className="th-th-actions">
          <button className="th-customize" onClick={() => setCustomizeOpen(true)}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
              <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
              <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
              <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
            </svg>
            <span>Customize</span>
          </button>
        </div>
      </header>

      {/* ─────────────── 3-column glass command center ─────────────── */}
      <div className="th-command">
        {/* LEFT glass rail — persistent control + nav */}
        <aside className="th-rail">
          <div className="th-rail-scroll">
            {/* Surface toggles */}
            <nav className="th-tabs th-rail-tabs" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`th-tab${tab === t.id ? ' th-tab--active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            {/* Views / Rankings */}
            <section className="th-rail-sec">
              <span className="th-rail-label">{railNavLabel}</span>
              <div className="th-rail-list">
                {railNavItems.map((s) => {
                  const active = railNavActiveId === s.id
                  return (
                    <button
                      key={s.id}
                      className={`th-rail-item${active ? ' th-rail-item--active' : ''}`}
                      onClick={() => handleRailNav(s.id)}
                    >
                      <span className="th-rail-glyph"><SectionGlyph name={RAIL_GLYPH[s.id]} /></span>
                      <span className="th-rail-item-label">{s.label}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            {/* Chains */}
            <section className="th-rail-sec">
              <span className="th-rail-label">Chains</span>
              <div className="th-rail-list">
                {railChains.map((c) => {
                  const active = globalChain === c.id
                  const count = c.id === 'all'
                    ? null
                    : c.networkIds.reduce((sum, id) => sum + (chainCounts.get(id) || 0), 0)
                  return (
                    <button
                      key={c.id}
                      className={`th-rail-item${active ? ' th-rail-item--active' : ''}`}
                      onClick={() => setGlobalChain(c.id)}
                    >
                      {c.id === 'all'
                        ? <span className="th-rail-dot" style={{ background: 'rgba(245,245,247,0.5)' }} />
                        : <span className="th-rail-chainic"><ChainIcon networkId={c.networkIds[0]} size={13} /></span>}
                      <span className="th-rail-item-label">{c.label}</span>
                      {count > 0 && <span className="th-rail-count">{count}</span>}
                    </button>
                  )
                })}
              </div>
            </section>

            {/* Live insights - rule-derived from the boards already in state */}
            <section className="th-rail-sec">
              <span className="th-rail-label">Insights</span>
              <div className="th-ins">
                {pulse.n > 0 && (
                  <div className="th-ins-block">
                    <div className="th-ins-bar" role="img" aria-label={`${pulse.g} of ${pulse.n} trending tokens are up`}>
                      <span className="th-ins-bar-up" style={{ width: `${Math.round((pulse.g / Math.max(1, pulse.n)) * 100)}%` }} />
                    </div>
                    <p className="th-ins-line">
                      <span className="th-ins-k">Breadth</span>
                      {pulse.g}/{pulse.n} green · {pulse.avg >= 0 ? '+' : ''}{pulse.avg.toFixed(0)}% median
                    </p>
                  </div>
                )}
                {insights.map((line) => (
                  <p key={line.k} className="th-ins-line"><span className="th-ins-k">{line.k}</span>{line.t}</p>
                ))}
              </div>
            </section>

            {/* Metas / sectors quick-list */}
            <section className="th-rail-sec th-rail-sec--grow">
              <div className="th-rail-label-row">
                <span className="th-rail-label">Metas</span>
                <button className="th-rail-more" onClick={() => setTab('categories')}>All</button>
              </div>
              <div className="th-rail-list th-rail-metas">
                {categories.loading && categories.rows.length === 0 ? (
                  [...Array(9)].map((_, i) => <span key={i} className="th-rail-meta-shim" />)
                ) : (
                  categories.rows.slice(0, 18).map((c) => {
                    const id = c.id || c.name
                    const active = selectedCat === id
                    const chg = Number(c.market_cap_change_24h ?? c.change24h) || 0
                    return (
                      <button
                        key={id}
                        className={`th-rail-meta${active ? ' th-rail-meta--active' : ''}`}
                        onClick={() => setSelectedCat(active ? null : id)}
                        title={c.name}
                      >
                        <span className="th-rail-meta-name">{c.name}</span>
                        <span className="th-rail-meta-foot">
                          <span className="th-rail-meta-mcap">{fmtUSD(c.market_cap)}</span>
                          <span className={`th-rail-meta-chg ${chg >= 0 ? 'pos' : 'neg'}`}>{fmtPct(chg)}</span>
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </section>
          </div>
        </aside>

        {/* STAGE — center table + co-equal social (Markets) / focus views */}
        <div className="th-stage">
          {/* MARKETS (default) — dense table + always-on social panel */}
          {tab === 'data' && (
            <div className="th-data-region">
              <div className="th-data-main">
                {dataSub === 'screener' ? (
                  <div className="th-screener">
                    <TokenDiscoveryTable selectToken={selectToken} />
                  </div>
                ) : (
                  <>
                    <div className="th-center-bar">
                      <CategoryChips
                        rows={categories.rows}
                        loading={categories.loading}
                        selected={selectedCat}
                        onSelect={setSelectedCat}
                      />
                      <div className="th-center-actions">
                        <RiskFilterToggle
                          value={riskFilter}
                          onChange={(v) => setPrefs((p) => ({ ...p, riskFilter: v }))}
                        />
                        {prefs.marketView !== 'heatmap' && (
                          <AiReadToggle
                            on={aiReadOn}
                            onChange={(v) => setPrefs((p) => ({ ...p, aiRead: v }))}
                          />
                        )}
                        <ListHeatmapToggle
                          view={prefs.marketView}
                          onChange={(v) => setPrefs((p) => ({ ...p, marketView: v }))}
                          ariaLabel="Markets view"
                          heatmapTitle="Market heatmap"
                        />
                        <DensityToggle
                          density={prefs.density}
                          onChange={(d) => setPrefs((p) => ({ ...p, density: d }))}
                        />
                        <div className="th-center-tf">
                          <span className="th-ctl-label">TF</span>
                          <TimeframePills value={globalTimeframe} onChange={setGlobalTimeframe} />
                        </div>
                      </div>
                    </div>
                    {prefs.marketView === 'heatmap' ? (
                      <MarketHeatmap
                        rows={marketRows}
                        loading={activeData.loading}
                        error={activeData.error}
                        selectToken={selectToken}
                      />
                    ) : (
                      <DenseTable
                        rows={marketRows}
                        loading={activeData.loading}
                        error={activeData.error}
                        emptyNote={riskHiddenCount > 0 ? `${riskHiddenCount} row${riskHiddenCount === 1 ? '' : 's'} hidden by the Safe filter` : null}
                        mode="data"
                        tf={globalTimeframe}
                        density={prefs.density}
                        selectToken={selectToken}
                        briefs={aiReadOn ? briefs : null}
                        briefsLoading={aiReadOn && briefsLoading}
                        onNeedBriefs={aiReadOn ? requestBriefs : null}
                        showAi={aiReadOn}
                      />
                    )}
                  </>
                )}
              </div>
              <SocialRail
                mentions={socialMentions}
                momentum={socialMomentum}
                selectToken={selectToken}
              />
            </div>
          )}

          {/* SOCIAL focus — full-width live social board + density toggle */}
          {tab === 'social' && (
            <div className="th-stage-full">
              <div className="th-center-bar th-center-bar--social">
                <span className="th-social-context">
                  <span className="th-social-context-live" aria-hidden="true" />
                  {prefs.socialView === 'heatmap'
                    ? 'Mindshare · attention share'
                    : `${SOCIAL_METRIC[socialSub]?.label || 'Social'} · live board`}
                </span>
                <div className="th-social-actions">
                  <ListHeatmapToggle
                    view={prefs.socialView}
                    onChange={(v) => setPrefs((p) => ({ ...p, socialView: v }))}
                    ariaLabel="Social view"
                    heatmapTitle="Mindshare heatmap"
                  />
                  <DensityToggle
                    density={prefs.density}
                    onChange={(d) => setPrefs((p) => ({ ...p, density: d }))}
                  />
                </div>
              </div>
              {prefs.socialView === 'heatmap' ? (
                <MindshareHeatmap data={socialMentions} selectToken={selectToken} />
              ) : (
                <DenseTable
                  rows={activeData.rows}
                  loading={activeData.loading}
                  error={activeData.error}
                  mode="social"
                  tf={globalTimeframe}
                  metric={SOCIAL_METRIC[socialSub]}
                  density={prefs.density}
                  selectToken={selectToken}
                  onRowVisible={handleSocialRowVisible}
                />
              )}
            </div>
          )}

          {/* SECTORS focus — full-width category grid */}
          {tab === 'categories' && (
            <div className="th-cat-scroll">
              <CategoriesGrid rows={categories.rows} loading={categories.loading} />
            </div>
          )}
        </div>
      </div>

      {/* Customize drawer */}
      {customizeOpen && (
        <div className="th-drawer-overlay" onClick={() => setCustomizeOpen(false)}>
          <aside className="th-drawer" onClick={(e) => e.stopPropagation()}>
            <header className="th-drawer-head">
              <h3>Customize Trending</h3>
              <button className="th-icon-btn" onClick={() => setCustomizeOpen(false)}><Icon name="close" size={16} /></button>
            </header>

            <div className="th-drawer-scroll">
            <section className="th-drawer-section">
              <span className="th-drawer-label">Default chain</span>
              <ChainPills value={prefs.defaultChain} onChange={(v) => setPrefs((p) => ({ ...p, defaultChain: v }))} />
            </section>
            <section className="th-drawer-section">
              <span className="th-drawer-label">Default timeframe</span>
              <TimeframePills value={prefs.defaultTimeframe} onChange={(v) => setPrefs((p) => ({ ...p, defaultTimeframe: v }))} />
            </section>

            <section className="th-drawer-section">
              <span className="th-drawer-label">Visible chains</span>
              <ul className="th-drawer-checklist">
                {CHAIN_OPTIONS.map((c) => {
                  const checked = prefs.visibleChains.includes(c.id)
                  return (
                    <li key={c.id} className="th-drawer-check-row">
                      <span className="th-drawer-check-name">{c.label}</span>
                      <button
                        className={`th-toggle ${checked ? 'on' : 'off'}`}
                        onClick={() => {
                          setPrefs((p) => ({
                            ...p,
                            visibleChains: checked
                              ? p.visibleChains.filter((x) => x !== c.id)
                              : [...p.visibleChains, c.id],
                          }))
                        }}
                      >
                        <span className="th-toggle-knob" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="th-drawer-section">
              <span className="th-drawer-label">Visible columns</span>
              <ul className="th-drawer-checklist">
                {[
                  { id: 'price', label: 'Price' },
                  { id: 'change', label: 'Change %' },
                  { id: 'mcap', label: 'Market Cap' },
                  { id: 'volume', label: 'Volume' },
                  { id: 'liquidity', label: 'Liquidity' },
                ].map((col) => {
                  const checked = prefs.visibleColumns?.[col.id]
                  return (
                    <li key={col.id} className="th-drawer-check-row">
                      <span className="th-drawer-check-name">{col.label}</span>
                      <button
                        className={`th-toggle ${checked ? 'on' : 'off'}`}
                        onClick={() => {
                          setPrefs((p) => ({
                            ...p,
                            visibleColumns: { ...p.visibleColumns, [col.id]: !checked },
                          }))
                        }}
                      >
                        <span className="th-toggle-knob" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="th-drawer-section">
              <span className="th-drawer-label">AI Read column</span>
              <ul className="th-drawer-checklist">
                <li className="th-drawer-check-row">
                  <span className="th-drawer-check-name">
                    Written read per row
                    <span className="th-drawer-check-note">Off by default — each visible row costs one model call.</span>
                  </span>
                  <button
                    className={`th-toggle ${prefs.aiRead ? 'on' : 'off'}`}
                    role="switch"
                    aria-checked={!!prefs.aiRead}
                    onClick={() => setPrefs((p) => ({ ...p, aiRead: !p.aiRead }))}
                  >
                    <span className="th-toggle-knob" />
                  </button>
                </li>
              </ul>
            </section>

            <section className="th-drawer-section">
              <span className="th-drawer-label">Density</span>
              <div className="th-drawer-segmented">
                {['compact', 'comfortable', 'big'].map((d) => (
                  <button
                    key={d}
                    className={`th-drawer-seg ${prefs.density === d ? 'active' : ''}`}
                    onClick={() => setPrefs((p) => ({ ...p, density: d }))}
                  >
                    {d[0].toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
            </section>

            <section className="th-drawer-section">
              <span className="th-drawer-label">Rows per card</span>
              <div className="th-drawer-segmented">
                {[5, 7, 10, 15].map((n) => (
                  <button
                    key={n}
                    className={`th-drawer-seg ${prefs.rowsPerCard === n ? 'active' : ''}`}
                    onClick={() => setPrefs((p) => ({ ...p, rowsPerCard: n }))}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </section>

            <section className="th-drawer-section">
              <span className="th-drawer-label">Data feeds</span>
              <ul className="th-drawer-section-list">
                {prefs.sectionOrder.map((sid) => {
                  const def = SECTION_DEFS.find((s) => s.id === sid)
                  if (!def) return null
                  const visible = prefs.visibleSections.includes(sid)
                  const phase2 = false
                  return (
                    <li key={sid} className="th-drawer-section-row">
                      <span className="th-drawer-section-icon">
                        <SectionGlyph name={def.glyph} />
                      </span>
                      <span className="th-drawer-section-name">
                        {def.title}
                        {phase2 && <span className="th-phase2-tag">Phase 2</span>}
                      </span>
                      <button
                        className={`th-toggle ${visible ? 'on' : 'off'} ${phase2 ? 'disabled' : ''}`}
                        onClick={() => {
                          if (phase2) return
                          setPrefs((p) => ({
                            ...p,
                            visibleSections: visible
                              ? p.visibleSections.filter((x) => x !== sid)
                              : [...p.visibleSections, sid],
                          }))
                        }}
                        disabled={phase2}
                      >
                        <span className="th-toggle-knob" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>

            </div>{/* /th-drawer-scroll */}

            <footer className="th-drawer-foot">
              <button className="th-drawer-reset" onClick={() => setPrefs(DEFAULT_PREFS)}>Reset</button>
              <button className="th-drawer-done" onClick={() => setCustomizeOpen(false)}>Done</button>
            </footer>
          </aside>
        </div>
      )}
    </div>
  )
}
