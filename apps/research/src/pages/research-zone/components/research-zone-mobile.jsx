/**
 * Research Zone Mobile - rzm-* prefix
 * Cinematic premium: content-on-void, system font numbers
 * Companion CSS: research-zone-mobile.css (1538 lines)
 */
import React, { useState, useMemo, useCallback, useEffect, useRef, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAppState } from '@/contexts/AppStateContext'
import { useCopyToast } from '@/contexts/CopyToastContext'
import { trackUi } from '@/services/analytics'
import MobileBackButton from '@/components/mobile-back-button'
import RzChartSection from './rz-chart-section'
import { observeSelectedTab } from './observe-selected-tab'
import lazyWithRetry from '@/lib/lazy-with-retry'
// PR (perf): TradingViewAdvanced wraps the heavy self-hosted charting_library.
// On mobile it only renders inside the Technicals tab, but a static import
// dragged the whole module onto every mobile RZ boot chunk. Lazy-load it so it
// downloads on first Technicals-tab open (desktop already reaches it lazily via
// rz-chart-section). lazyWithRetry keeps stale-chunk recovery.
const TradingViewAdvanced = lazyWithRetry(() => import('@/components/TradingViewAdvanced'))
import useKlineIndicators from '../hooks/use-kline-indicators'
import useMtfThesis from '../hooks/use-mtf-thesis'
import useTokenSafety from '../hooks/use-token-safety'
import { isMajorToken } from '@/constants/majorTokens'
import { scoreRsi, scoreStoch, scoreMacd, scoreBb } from '@/lib/indicator-score'
import { formatPrice as formatPriceUsd } from '@/lib/formatCurrency'
import { compressZeros } from './rzm-compact-price'
import TradeThesisSection from './rz-trade-thesis'
import MacroAnalysisSection from './rz-macro-analysis'
import EquityMacroSection from './rz-equity-macro'
import RzMentionsPanel from './rz-mentions-panel'
// Cosmos-engine KOL universe — lazy so three.js never lands in the RZ chunk
const RzKolCosmos = lazyWithRetry(() => import('./rz-kol-cosmos'))
// Sentiment engine (2026-07-02): mobile renders the same instruments as the
// desktop Sentiment tab — command hero, crowd-vs-price overlay, AI desk read,
// narrative radar, X Dash forensics, class-aware market context.
import useSentimentEngine from '../data/useSentimentEngine'
import RzSentimentCommand from './rz-sentiment-command'
import RzProjectDossier from './rz-project-dossier'
import RzFundamentals from './rz-fundamentals'
import RzSentimentPriceChart from './rz-sentiment-price-chart'
import RzAiSentimentRead from './rz-ai-sentiment-read'
import RzNarrativeRadar from './rz-narrative-radar'
import RzSocialIntel from './rz-social-intel'
import RzMarketContext, { classifyTokenClass } from './rz-market-context'
import { getTokenSlug } from '@/lib/tokenSlugs'
import { getExchangeIcon, getExchangeHomeUrl, formatPairDisplay } from '@/lib/exchangeIcons'
import useDossierProject from '@/hooks/useDossierProject'
import useSpectreAssetData from '@/hooks/useSpectreAssetData'
import RzmProjectSections from './rzm-project-sections'
import { shortAddress, buildContractEntries } from '../data/rz-contract-utils'
import { generateRzTokenShareCard } from './rz-share-card'
const ShareXModal = lazyWithRetry(() => import('@/components/share-x-modal'))
import RzmStockMarkets from './rzm-stock-markets'
import RzEarningsBanner from './rz-earnings-banner'
import RzmStockSentiment from './rzm-stock-sentiment'
import RzmTradesList from './rzm-trades-list'
import RzmComparePicker from './rzm-compare-picker'
import useRzCompare from './use-rz-compare'
import useRzAnnotations from './use-rz-annotations'
import useRzChartTa from './use-rz-chart-ta'
import { useChartTaEnabled } from '@/lib/chart-ta-enabled'
const RzmRead = lazyWithRetry(() => import('./rzm-read'))
import RzQuickSwitcher from './rz-quick-switcher'
import useRzHistory from './use-rz-history'
import { seedTokenCache } from '../hooks/use-research-zone-data'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import ChartSkeleton from '@/components/chart-skeleton'
const RzmAgentSheet = lazyWithRetry(() => import('./rzm-agent-sheet'))
const RzmDossierSheet = lazyWithRetry(() => import('./rzm-dossier-sheet'))
const RzmNotesSheet = lazyWithRetry(() => import('./rzm-notes-sheet'))

// ── Inline icons (per mobile design system §I — no spectreIcons dep) ──
const StarIcon = ({ filled }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
)

const ExternalIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
)

const formatCompact = (num) => {
  if (num == null) return '0'
  const n = typeof num === 'string' ? parseInt(num.replace(/,/g, ''), 10) : num
  if (isNaN(n)) return '0'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

const CopyGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
)

/** Contract address rows with tap-to-copy — desktop parity (RzContractRow in rz-token-panel.jsx) */
const RzmContractSection = ({ address, platforms, onCopied }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const entries = useMemo(() => buildContractEntries(address, platforms), [address, platforms])
  if (entries.length === 0) return null

  const extra = entries.length - 1
  const visible = open ? entries : entries.slice(0, 1)
  const copy = (addr) => {
    try {
      navigator.clipboard?.writeText(addr)
      onCopied?.('Contract address copied')
    } catch {}
  }

  return (
    <div className="rzm-section">
      <div className="rzm-section-title">{t('researchPro.rzMobile.rzmcontract.contract', "Contract")}</div>
      <div className="rzm-contract">
        {visible.map((e) => (
          <button
            key={e.address}
            type="button"
            className="rzm-contract-row"
            onClick={() => copy(e.address)}
            aria-label={t('researchZone.ariaCopyNamedContract', 'Copy {{name}} contract address', { name: e.label })}
          >
            <span className="rzm-contract-chain">{e.label}</span>
            <span className="rzm-contract-addr">{shortAddress(e.address)}</span>
            <CopyGlyph />
          </button>
        ))}
        {extra > 0 && (
          <button type="button" className="rzm-contract-more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Show less' : `+${extra} more network${extra === 1 ? '' : 's'}`}
          </button>
        )}
      </div>
    </div>
  )
}

/** Editable token ↔ USD converter — desktop parity (TokenConverter in rz-token-panel.jsx) */
const fmtConvNum = (v) => {
  if (!Number.isFinite(v) || v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 1) return String(parseFloat(v.toFixed(4)))
  return String(parseFloat(v.toPrecision(6)))
}

const RzmConverter = ({ symbol, price }) => {
  const { t } = useTranslation()
  const [amount, setAmount] = useState('1')
  const [side, setSide] = useState('token')
  // Focusing a row empties it so typing replaces the seeded "1" instead of
  // appending to it; leaving it empty restores the last amount on blur.
  const lastRef = useRef({ side: 'token', amount: '1' })
  const numericPrice = parseFloat(price) || 0
  const filled = Number.isFinite(parseFloat(amount))
  useEffect(() => { if (filled) lastRef.current = { side, amount } })

  const committed = filled ? { side, amount } : lastRef.current
  const committedNum = parseFloat(committed.amount) || 0
  const tokenNum = committed.side === 'token'
    ? committedNum
    : (numericPrice > 0 ? committedNum / numericPrice : 0)

  const tokenVal = side === 'token' ? amount : fmtConvNum(tokenNum)
  const usdVal = side === 'usd' ? amount : fmtConvNum(tokenNum * numericPrice)

  const handleFocus = (nextSide) => { setSide(nextSide); setAmount('') }
  const handleBlur = () => {
    if (Number.isFinite(parseFloat(amount))) return
    setSide(lastRef.current.side)
    setAmount(lastRef.current.amount)
  }

  return (
    <div className="rzm-converter">
      <div className="rzm-converter-row rzm-converter-row--input">
        <span className="rzm-converter-label">{symbol}</span>
        <input
          type="number"
          inputMode="decimal"
          className="rzm-converter-input"
          value={tokenVal}
          onChange={(e) => { setSide('token'); setAmount(e.target.value) }}
          onFocus={() => handleFocus('token')}
          onBlur={handleBlur}
          min="0"
          step="any"
          aria-label={t('researchZone.ariaAmountIn', 'Amount in {{symbol}}', { symbol })}
        />
      </div>
      <div className="rzm-converter-row rzm-converter-row--input">
        <span className="rzm-converter-label">USD</span>
        <input
          type="number"
          inputMode="decimal"
          className="rzm-converter-input"
          value={usdVal}
          onChange={(e) => { setSide('usd'); setAmount(e.target.value) }}
          onFocus={() => handleFocus('usd')}
          onBlur={handleBlur}
          min="0"
          step="any"
          aria-label={t('researchPro.rzMobile.rzmconverter.ariaAmountInUsd', "Amount in USD")}
        />
      </div>
      {/* Micro-aware rate: fmtConvNum flips to exponent notation ("5.01e-7")
          below 1e-6 - formatPrice + compressZeros reads as $0.0₆501 instead */}
      <div className="rzm-converter-rate">1 {symbol} = {numericPrice > 0 ? compressZeros(formatPriceUsd(numericPrice, 'USD', 1)) : '—'}</div>
    </div>
  )
}

const TweetIcons = {
  views: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  retweet: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  ),
  heart: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  comment: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
}

// `label` is the t() default, not the rendered string - see the render sites.
const TWEET_SEGMENTS = [
  { key: 'posts', i18nKey: 'researchZone.feedPosts', label: 'Posts' },
  { key: 'replies', i18nKey: 'researchZone.feedReplies', label: 'Replies' },
  { key: 'community', i18nKey: 'researchZone.feedCommunity', label: 'Community' },
  { key: 'influencers', i18nKey: 'researchZone.feedKols', label: 'KOLs' },
  { key: 'all', i18nKey: 'researchZone.feedAll', label: 'All' },
]

const IndicatorGlyph = ({ kind }) => {
  const props = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
  switch (kind) {
    case 'ema': return (<svg {...props}><path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" /></svg>)
    case 'rsi': return (<svg {...props}><path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" /></svg>)
    case 'stochastic': return (<svg {...props}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>)
    case 'atr': return (<svg {...props}><path d="M2 20l4-4 4 4 4-8 4 4 4-8" /></svg>)
    case 'supply': return (<svg {...props}><path d="M12 19V5M5 12l7-7 7 7" /></svg>)
    case 'demand': return (<svg {...props}><path d="M12 5v14M19 12l-7 7-7-7" /></svg>)
    case 'macd': return (<svg {...props}><rect x="3" y="12" width="4" height="8" rx="1" /><rect x="10" y="8" width="4" height="12" rx="1" /><rect x="17" y="4" width="4" height="16" rx="1" /></svg>)
    case 'signal': return (<svg {...props}><path d="M2 20h.01" /><path d="M7 20v-4" /><path d="M12 20v-8" /><path d="M17 20V8" /><path d="M22 4v16" /></svg>)
    default: return (<svg {...props}><circle cx="12" cy="12" r="9" /></svg>)
  }
}

// Terminal-style chat glyph for the RZ agent (no brain/sparkle — design rule).
const AgentSparkIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <path d="M7.5 9.5l2 2-2 2" />
    <line x1="12" y1="13.5" x2="15" y2="13.5" />
  </svg>
)

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
)

// ── Helpers ──
const safeNum = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))

// Maps mobile Technicals tab timeframe pill to Codex/UDF resolution code.
// Mirrors CHART_TF_TO_RESOLUTION in rz-technicals-tab.jsx.
const TECH_TF_TO_RESOLUTION = {
  '15M': '15',
  '1H':  '60',
  '4H':  '240',
  '1D':  '1D',
  '1W':  '1W',
}

// Helper: render a numeric indicator with fixed precision, or "—" when no
// real data is available yet (loading or unsupported token).
const fmtFixed = (v, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : '—')

const formatPct = (val) => {
  const n = safeNum(val)
  if (n === null) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

const changeCls = (val) => {
  const n = safeNum(val)
  if (n === null) return ''
  return n >= 0 ? 'bull' : 'bear'
}

// §B2 Magnitude color grading — alpha/brightness varies with |change%|
const changeMagnitudeCls = (val) => {
  const n = safeNum(val)
  if (n === null) return ''
  const sign = n >= 0 ? 'bull' : 'bear'
  const abs = Math.abs(n)
  let mag = 'muted'
  if (abs >= 10) mag = 'bright'
  else if (abs >= 5) mag = 'strong'
  else if (abs >= 2) mag = 'full'
  else if (abs >= 0.5) mag = 'soft'
  return `${sign} ${sign}-${mag}`
}

// §F Exchange type → chip label+variant
const exchangeTypeChip = (m) => {
  const marketType = (m?.market?.type || m?.type || '').toLowerCase()
  const hasTarget = (m?.target || '').toUpperCase()
  const isDex = (m?.market?.identifier || '').includes('dex') || /uniswap|pancake|sushi|curve|raydium|orca|jupiter/i.test(m?.market?.name || '')
  const isPerp = /perp|swap|future/i.test(marketType) || /PERP|PERPS|USDT.PERP/i.test(hasTarget)
  if (isDex) return { label: 'DEX', variant: 'dex' }
  if (isPerp) return { label: 'PERP', variant: 'perp' }
  return { label: 'SPOT', variant: 'spot' }
}

// §K Market hours status for stocks (DST-aware via Intl.DateTimeFormat in NY tz)
const getMarketHoursStatus = () => {
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const hour = Number(parts.find(p => p.type === 'hour')?.value || 0)
  const minute = Number(parts.find(p => p.type === 'minute')?.value || 0)
  const weekday = parts.find(p => p.type === 'weekday')?.value || ''
  if (weekday === 'Sat' || weekday === 'Sun') return { label: 'CLOSED', variant: 'closed' }
  const etMinutes = hour * 60 + minute
  if (etMinutes >= 570 && etMinutes < 960) return { label: 'OPEN', variant: 'open' } // 9:30-16:00
  if (etMinutes >= 240 && etMinutes < 570) return { label: 'PRE-MARKET', variant: 'pre' } // 4:00-9:30
  if (etMinutes >= 960 && etMinutes < 1200) return { label: 'AFTER HOURS', variant: 'after' } // 16:00-20:00
  return { label: 'CLOSED', variant: 'closed' }
}

const getInitial = (str) => (str || '?').charAt(0).toUpperCase()

// Inline 14px stroke icons (mobile rule: explicit-size inline SVGs, no icon lib)
const TAB_ICONS = {
  overview: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  markets: (
    // candlesticks, not a generic bar chart — this tab is exchanges/markets
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4v3.5" /><rect x="5.75" y="7.5" width="4.5" height="8" rx="1.25" /><path d="M8 15.5V20" />
      <path d="M16 4v2" /><rect x="13.75" y="6" width="4.5" height="6.5" rx="1.25" /><path d="M16 12.5V17" />
    </svg>
  ),
  technicals: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 15l5-5 4 4 6-7" /><path d="M15 7h3v3" />
    </svg>
  ),
  sentiment: (
    // a small gauge — echoes the crowd-score gauge that leads this tab
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 16.5a7.5 7.5 0 0 1 15 0" />
      <path d="M12 16.5l3.2-3.2" />
      <circle cx="12" cy="16.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  ),
  social: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.5 8.38 8.38 0 0 1 8.5 8.5z" />
    </svg>
  ),
  news: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0V6" /><path d="M12 7h6" /><path d="M12 11h6" /><path d="M12 15h6" />
    </svg>
  ),
}

const TABS = [
  { id: 'overview', i18nKey: 'researchZone.tabOverview', label: 'Overview' },
  { id: 'markets', i18nKey: 'researchZone.tabMarkets', label: 'Markets' },
  { id: 'technicals', i18nKey: 'researchZone.tabTechnicals', label: 'Technicals' },
  { id: 'sentiment', i18nKey: 'researchZone.tabSentiment', label: 'Sentiment' },
  { id: 'social', i18nKey: 'researchZone.tabSocial', label: 'Social' },
  { id: 'news', i18nKey: 'researchZone.tabNews', label: 'News' },
]

// §A3/§A4 Letter-grade color mapping (A=green, F=red)
const GRADE_COLORS = {
  'A+': '#10B981', 'A': '#10B981', 'A-': '#10B981',
  'B+': '#84CC16', 'B': '#84CC16', 'B-': '#84CC16',
  'C+': '#EAB308', 'C': '#EAB308', 'C-': '#EAB308',
  'D+': '#F97316', 'D': '#F97316', 'D-': '#F97316',
  'F': '#EF4444',
}
const gradeColor = (letter) => GRADE_COLORS[letter] || '#94a3b8'

const TABS_STOCK = [
  { id: 'overview', i18nKey: 'researchZone.tabOverview', label: 'Overview' },
  { id: 'markets', i18nKey: 'researchZone.tabMarkets', label: 'Markets' },
  { id: 'technicals', i18nKey: 'researchZone.tabTechnicals', label: 'Technicals' },
  { id: 'sentiment', i18nKey: 'researchZone.tabSentiment', label: 'Sentiment' },
  { id: 'news', i18nKey: 'researchZone.tabNews', label: 'News' },
]

// ── Stat row component ──
function StatsRow({ label, value, changeValue }) {
  const cls = changeCls(changeValue)
  return (
    <div className="rzm-stats-row">
      <span className="rzm-stats-row-label">{label}</span>
      <div className="rzm-stats-row-right">
        <span className="rzm-stats-row-value">{value ?? '—'}</span>
        {changeValue != null && (
          <span className={`rzm-stats-row-change rzm-stats-row-change--${cls}`}>
            {formatPct(changeValue)}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Stat card component (2x2 metrics grid) ──
function StatCard({ label, value, rank, sub, supplyPct }) {
  return (
    <div className="rzm-stat">
      <span className="rzm-stat-label">{label}</span>
      <span className="rzm-stat-value">{value ?? '—'}</span>
      {rank != null && <span className="rzm-stat-rank">#{rank}</span>}
      {sub && <span className="rzm-stat-sub">{sub}</span>}
      {supplyPct != null && (
        <div className="rzm-supply-bar">
          <div className="rzm-supply-fill" style={{ width: `${supplyPct}%` }} />
        </div>
      )}
    </div>
  )
}

// ── Main component ──
export default function ResearchZoneMobile({
  activeTab, setActiveTab,
  symbol, setSymbol,
  tokenName, tokenLogo, tokenData,
  isStock,
  data,
  chartToken, chartHeight,
  dayMode,
  chartLivePrice,
  onChartDragStart,
  spectreSentScore, spectreFearGreed, spectreSocial,
  officialTweets, officialTweetsLoading,
  marketsData, marketsLoading,
  newsItems, newsSource,
  fmtPrice: fmtPriceProp, fmtLarge,
  performanceData,
  isInWatchlist, addToWatchlist, removeFromWatchlist,
  marketMode,
  onVoiceStateChange,
  tradeMarkers,
  fetchNews,
  fundamentalsGrades,
  apiScenario,
  spectrePlotData,
  tokenProfile,
  spectreTweets,
  spectreMarketDetails,
  mindshareData,
  sectorData,
  coinDetails,
  onChainData,
  activeTokenInfo,
}) {
  const { t } = useTranslation()
  // Micro-price zero compression ($0.00000501 -> $0.0₅501) applied at the
  // formatter level, so the hero, 24h stats, exchange rows, technicals tables
  // and every child receiving fmtPrice inherit it without per-site changes.
  const fmtPrice = useMemo(
    () => (fmtPriceProp ? (v) => compressZeros(fmtPriceProp(v)) : fmtPriceProp),
    [fmtPriceProp],
  )
  const navigate = useNavigate()
  const { selectToken } = useAppState()
  const { triggerCopyToast } = useCopyToast() || {}
  const tabId = React.useId()
  const tabStripRef = useRef(null)
  // Technicals TA hook chain (bars for 5 timeframes + safety lookup) is
  // expensive and its output is used ONLY by the Technicals panel. Latch it so
  // it stays dormant until the user opens Technicals once, then stays live
  // (cached) — mirrors the useSentimentEngine tab-gate. Saves ~5 bar fetches
  // (Yahoo on stocks) on every RZ open when the user never taps Technicals.
  const [techEverOpened, setTechEverOpened] = useState(false)
  useEffect(() => { if (activeTab === 'technicals') setTechEverOpened(true) }, [activeTab])
  const [agentSheetOpen, setAgentSheetOpen] = useState(false)
  // Keep the agent sheet mounted once opened (it self-hides via translateY +
  // pointer-events:none when closed) so RzAgentChat's conversation thread
  // survives close/reopen instead of resetting each time.
  const [agentEverOpened, setAgentEverOpened] = useState(false)
  useEffect(() => { if (agentSheetOpen) setAgentEverOpened(true) }, [agentSheetOpen])
  const [dossierSheetOpen, setDossierSheetOpen] = useState(false)
  const [notesSheetOpen, setNotesSheetOpen] = useState(false)
  // Chart notes — same storage key as desktop (spectre-rz-annotations:{SYMBOL}),
  // so mobile + desktop notes share data per token. Owning one instance keeps
  // the chart pins and the sheet list live-synced.
  const rzAnnotations = useRzAnnotations({ symbol, currentPrice: chartLivePrice })

  // ── Chart TA layer (highlight-to-analyse + drawing tools) ──────────────────
  // Same engine as desktop; the tools live in the chart's own gear menu because
  // a phone has no room for a tool rail.
  const chartRef = useRef(null)
  const [taRequest, setTaRequest] = useState(null)
  // The read layer is gated (see lib/chart-ta-enabled). Read it BEFORE the ask
  // handler, which branches on it.
  const taEnabled = useChartTaEnabled()
  const taEnabledRef = useRef(taEnabled)
  taEnabledRef.current = taEnabled
  const handleAskAgent = useCallback((prompt, brief) => {
    setTaRequest({
      id: Date.now().toString(36),
      prompt,
      display: `Read the highlighted window — ${brief.stats.tfLabel}, ${brief.stats.bars} bars, ${brief.stats.durationLabel}`,
    })
    // With RzmRead mounted the read has its own surface, so the agent's answer
    // is prepared but NOT thrown over it — the full-screen agent sheet (z 6000)
    // would bury the thing the reader just asked for. They open it from the
    // read's Agent tab when they want the conversation.
    if (!taEnabledRef.current) setAgentSheetOpen(true)
  }, [])
  const chartTa = useRzChartTa({ symbol, chartRef, price: chartLivePrice, onAskAgent: handleAskAgent })

  // Recent-token history + quick switcher (shared storage with desktop).
  const rzHistory = useRzHistory({ symbol, name: tokenName, logo: tokenLogo, isStock })
  const handleQuickSwitchSelect = useCallback((item) => {
    if (!item?.symbol) return
    seedTokenCache(item)
    setSymbol?.(item.symbol.toUpperCase())
  }, [setSymbol])

  // RZ chart compare overlay (mirrors research-zone-lite.jsx desktop wiring)
  const rzCompare = useRzCompare({
    baseSymbol: symbol,
    baseCgId: tokenData?.cgId || tokenData?.coingeckoId || data?.token?.cgId || null,
  })
  const [comparePickerOpen, setComparePickerOpen] = useState(false)
  const [compareModeActive, setCompareModeActive] = useState(false)
  useEffect(() => {
    if (!rzCompare.compareSym && compareModeActive) setCompareModeActive(false)
  }, [rzCompare.compareSym, compareModeActive])
  const handleClearCompare = useCallback(() => {
    setCompareModeActive(false)
    rzCompare.clearCompare()
  }, [rzCompare])
  const compareViewProps = useMemo(() => {
    if (!compareModeActive || !rzCompare.compareSym) return null
    const baseTc = TOKEN_ROW_COLORS[symbol]
    const cmpTc = TOKEN_ROW_COLORS[rzCompare.compareSym]
    return {
      baseSymbol: symbol,
      compareSym: rzCompare.compareSym,
      baseSeries: rzCompare.baseData?.normalized || [],
      compareSeries: rzCompare.compareData?.normalized || [],
      baseColor: baseTc ? `rgb(${baseTc.bg})` : '#f5f5f7',
      compareColor: cmpTc ? `rgb(${cmpTc.bg})` : '#06B6D4',
      baseReturns: rzCompare.baseData?.returns || {},
      compareReturns: rzCompare.compareData?.returns || {},
      periods: rzCompare.periods,
      loading: rzCompare.loading,
      error: rzCompare.error,
      onClear: handleClearCompare,
      onChangeCompare: () => setComparePickerOpen(true),
    }
  }, [compareModeActive, rzCompare.compareSym, rzCompare.baseData, rzCompare.compareData, rzCompare.periods, rzCompare.loading, rzCompare.error, symbol, handleClearCompare])

  // Compare + Notes now live inside the chart's built-in mobile "Chart settings"
  // gear menu (trading-chart.jsx renders extraToolButtons there) instead of a
  // standalone pill row — one settings surface, less chart chrome.
  const noteCount = rzAnnotations.annotations.length
  const chartToolButtons = useMemo(() => {
    const compareIcon = (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <path d="M3 14l4-4 3 3 6-7" /><path d="M14 6h3v3" />
      </svg>
    )
    const noteIcon = (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <path d="M14.5 2.5l3 3L7 16l-4 1 1-4z" /><path d="M12 5l3 3" />
      </svg>
    )
    const clearIcon = (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="16" height="16" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    )
    const taIcon = (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <path d="M10 2.5l1.6 3.6 3.9.4-2.9 2.6.8 3.8L10 11l-3.4 1.9.8-3.8-2.9-2.6 3.9-.4z" />
      </svg>
    )
    const highlightIcon = (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <path d="M3 6.5V4h2.5M14.5 4H17v2.5M17 13.5V16h-2.5M5.5 16H3v-2.5" />
      </svg>
    )
    const trendIcon = (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <path d="M3 15L8 9l4 3 5-8" />
      </svg>
    )
    const levelIcon = (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
        <path d="M3 10h14" />
      </svg>
    )
    // The tools are flat toggles here: a nested popover inside the gear sheet
    // is a second dismissal layer on a phone, and the gear closes on tap.
    const btns = !taEnabled ? [] : [
      { key: 'ta-analyze', label: 'AI TA — read this chart', title: 'Read the visible chart', icon: taIcon, onClick: chartTa.analyzeVisible },
      { key: 'ta-highlight', label: chartTa.taMode === 'select' ? 'Highlight — drag on the chart' : 'Highlight a window', title: 'Highlight a window and ask the agent', active: chartTa.taMode === 'select', icon: highlightIcon, onClick: () => chartTa.setTool('select') },
      { key: 'ta-trend', label: 'Draw trend line', title: 'Draw a trend line', active: chartTa.taMode === 'draw:trendline', icon: trendIcon, onClick: () => chartTa.setTool('draw:trendline') },
      { key: 'ta-level', label: 'Draw level', title: 'Draw a horizontal level', active: chartTa.taMode === 'draw:hline', icon: levelIcon, onClick: () => chartTa.setTool('draw:hline') },
    ]
    if (taEnabled && chartTa.hasDrawings) {
      btns.push({ key: 'ta-clear', label: 'Clear TA lines', title: 'Clear TA lines', icon: clearIcon, onClick: () => chartTa.clearDrawings('all') })
    }
    if (!isStock) {
      btns.push({
        key: 'compare',
        label: rzCompare.compareSym
          ? (compareModeActive ? `Comparing ${rzCompare.compareSym}` : `Compare ${rzCompare.compareSym}`)
          : 'Compare',
        title: 'Compare tokens',
        active: compareModeActive,
        icon: compareIcon,
        onClick: () => {
          if (!rzCompare.compareSym) { setComparePickerOpen(true); return }
          setCompareModeActive(v => !v)
        },
      })
      if (rzCompare.compareSym) {
        btns.push({
          key: 'compare-clear',
          label: 'Clear comparison',
          title: 'Clear comparison',
          icon: clearIcon,
          onClick: handleClearCompare,
        })
      }
    }
    btns.push({
      key: 'notes',
      label: noteCount ? `Notes (${noteCount})` : 'Notes',
      title: 'Chart notes',
      active: noteCount > 0,
      icon: noteIcon,
      onClick: () => setNotesSheetOpen(true),
    })
    return btns
  }, [taEnabled, isStock, rzCompare.compareSym, compareModeActive, noteCount, handleClearCompare, chartTa.taMode, chartTa.setTool, chartTa.analyzeVisible, chartTa.clearDrawings, chartTa.hasDrawings])

  const tabContentRef = React.useRef(null)

  // Sentiment engine — tab-gated so opening the page costs nothing until the
  // Sentiment tab is tapped (visibility-gated fetching, api-patterns.md §L).
  const sentimentActive = activeTab === 'sentiment' && !isStock
  const sentimentCgId = tokenData?.cgId || tokenData?.coingeckoId || null
  const sentimentEngine = useSentimentEngine(symbol, sentimentCgId, { enabled: sentimentActive, tokenData })
  const sentimentTokenClass = useMemo(() => classifyTokenClass({
    sym: (symbol || '').toUpperCase(),
    rank: sentimentEngine.market?.rank,
    marketCap: sentimentEngine.market?.marketCap,
    categories: sentimentEngine.market?.categories,
    primaryCategory: sentimentEngine.market?.primaryCategory,
  }), [symbol, sentimentEngine.market])

  // Tab switch: panels differ in height by thousands of px, so swapping while
  // scrolled deep made the scroll container clamp upward — the "bounce". If
  // the user is inside the panel body, pin the new panel's top (just under
  // the sticky tab bar) so every switch lands in a predictable place. Taps
  // from the hero (content top still below the bar) don't scroll at all.
  const handleTabSelect = useCallback((id) => {
    trackUi('rz_tab', id)
    setActiveTab(id)
    requestAnimationFrame(() => {
      const el = tabContentRef.current
      if (!el) return
      const anchor = tabStripRef.current?.parentElement?.getBoundingClientRect().bottom || 112
      if (el.getBoundingClientRect().top < anchor - 8) {
        el.scrollIntoView({ block: 'start', behavior: 'auto' }) // respects scroll-margin-top
      }
    })
  }, [setActiveTab])

  // Keep selection visible after rotation, unfolding or label-size changes,
  // without moving the page or interfering with manual sideways scrolling.
  useEffect(() => observeSelectedTab(tabStripRef.current), [activeTab])

  // Branded splash — hide BTC-default flicker until real data for the
  // requested symbol arrives. Lifts as soon as tokenData.price is real, or
  // after a 6s watchdog so a slow API doesn't trap the user behind the logo.
  const [splashHidden, setSplashHidden] = useState(false)
  const hasRealPrice = Number.isFinite(parseFloat(tokenData?.price))
  useEffect(() => {
    if (!hasRealPrice) return
    const t = setTimeout(() => setSplashHidden(true), 180)
    return () => clearTimeout(t)
  }, [hasRealPrice])
  useEffect(() => {
    const watchdog = setTimeout(() => setSplashHidden(true), 6000)
    return () => clearTimeout(watchdog)
  }, [])
  // Reset splash whenever the symbol changes (open another token)
  useEffect(() => {
    setSplashHidden(false)
  }, [symbol])
  const [aboutExpanded, setAboutExpanded] = useState(false)
  const [marketsFilter, setMarketsFilter] = useState('all')        // all | cex | dex
  const [marketsType, setMarketsType] = useState('all')            // all | spot | perp
  const [marketsPage, setMarketsPage] = useState(1)
  const [marketsSegment, setMarketsSegment] = useState('exchanges') // exchanges | trades (crypto only)
  const [marketsSort, setMarketsSort] = useState('volume')          // volume | price | volumePct | depth
  const [marketsSortDir, setMarketsSortDir] = useState('desc')      // desc | asc
  const [marketsQuote, setMarketsQuote] = useState('all')          // all | USDT | USDC | ...
  const [marketsMinVol, setMarketsMinVol] = useState(0)            // 0 | 1e5 | 1e6 | 1e7
  const [marketsFiltersOpen, setMarketsFiltersOpen] = useState(false)
  const [techTimeframe, setTechTimeframe] = useState('4H')
  const [tweetSegment, setTweetSegment] = useState('all')

  useEffect(() => {
    setTweetSegment('all')
  }, [symbol])

  // Defense-in-depth scroll reset on token switch. Targets known scroll
  // containers — walking the whole DOM and reading scrollTop on every
  // node forced synchronous layout per element and was a major cause of
  // sluggish navigation.
  useEffect(() => {
    const SCROLL_SELECTORS = '.app-main-content, .page-layout__content, .mobile-preview-screen, [data-mobile-scroll-root]'
    const resetAll = () => {
      try { window.scrollTo(0, 0) } catch {}
      try {
        document.querySelectorAll(SCROLL_SELECTORS).forEach((el) => {
          if (el && el.scrollTop > 0) el.scrollTop = 0
        })
      } catch {}
    }
    resetAll()
    const raf = requestAnimationFrame(resetAll)
    const t = setTimeout(resetAll, 180)
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [symbol])

  const handleTechChartReady = useCallback((_widget, chart) => {
    try {
      chart.createStudy('Bollinger Bands', false, false, { length: 20, mult: 2 }, {
        'plot.color': 'rgba(59, 130, 246, 0.4)',
        'filledAreaBg1.color': 'rgba(59, 130, 246, 0.04)',
        'filledAreaBg1.visible': true,
      })
    } catch (_) { console.error(_) }
    try {
      chart.createStudy('Relative Strength Index', false, false, { length: 14 }, {
        'plot.color': '#f59e0b',
        'hline_70.color': 'rgba(239, 68, 68, 0.3)',
        'hline_30.color': 'rgba(16, 185, 129, 0.3)',
      })
    } catch (_) { console.error(_) }
  }, [])
  const MARKETS_PAGE_SIZE = 10

  // (Removed dead useMarketIntel call: it fired the full intel bundle — ~10
  // derivatives/macro requests + a 500-asset price enrichment, ~220 kB — on
  // mount, but its `intel` result was never read anywhere in this component.
  // Technicals reads useKlineIndicators; Sentiment runs useSentimentEngine.
  // Pure first-paint cost with zero render benefit, so it's gone entirely.)

  // Project sections data — dossier + spectre asset data.
  // Mirrors what desktop ProjectCinema receives via research-zone-pro,
  // minus the brand color (mobile uses neutral chrome). Gated on !isStock
  // so crypto-specific endpoints aren't fired for stocks.
  const sym = (symbol || 'BTC').toUpperCase()

  const td = useMemo(() => {
    const rawPrice = parseFloat(tokenData?.price)
    const rawChange = parseFloat(tokenData?.change24h)
    return {
      price: Number.isFinite(rawPrice) ? rawPrice : null,
      change24h: Number.isFinite(rawChange) ? rawChange : null,
      marketCap: tokenData?.marketCap || tokenData?.mcap || null,
      volume: tokenData?.volume || tokenData?.volume24h || null,
      name: tokenData?.name || sym,
      logo: tokenData?.logo || tokenLogo || null,
      cgId: tokenData?.cgId || tokenData?.coingeckoId || null,
      rank: tokenData?.rank || null,
      fdv: tokenData?.fdv || tokenData?.marketCap || tokenData?.mcap || null,
      totalSupply: tokenData?.totalSupply || tokenData?.maxSupply || null,
      circulatingSupply: tokenData?.circulatingSupply || tokenData?.circulating || null,
      score: tokenData?.score ?? null,
      low24h: tokenData?.low24h ?? null,
      high24h: tokenData?.high24h ?? null,
      ath: tokenData?.ath ?? null,
      athDate: tokenData?.athDate ?? null,
      athChangePct: tokenData?.athChangePct ?? null,
      atl: tokenData?.atl ?? null,
      atlDate: tokenData?.atlDate ?? null,
      atlChangePct: tokenData?.atlChangePct ?? null,
      volMcapPct: tokenData?.volMcapPct ?? null,
      change1h: parseFloat(tokenData?.change1h) || null,
      change7d: parseFloat(tokenData?.change7d) || null,
      change30d: parseFloat(tokenData?.change30d) || null,
      // Equity fields (undefined for crypto) — equity macro chips read beta
      beta: tokenData?.beta ?? null,
      week52High: tokenData?.week52High ?? null,
      week52Low: tokenData?.week52Low ?? null,
      avgVolume: tokenData?.avgVolume ?? null,
      earningsDate: tokenData?.earningsDate ?? null,
      exchange: tokenData?.exchange ?? null,
    }
  }, [tokenData, sym, tokenLogo])

  const { data: dossier } = useDossierProject(
    isStock ? {} : {
      symbol: sym,
      address: activeTokenInfo?.address,
      networkId: activeTokenInfo?.networkId,
      cgId: activeTokenInfo?.cgId || activeTokenInfo?.coingeckoId,
      githubUrl: activeTokenInfo?.githubUrl,
    }
  )
  const { data: spectreData } = useSpectreAssetData(isStock ? null : sym)

  // §B4 pull-to-refresh RETIRED here — see the note at the container below.
  // Leaving the hook mounted without its indicator would be the worst of both:
  // the gesture would still run and still set `touch-action: none` on the page
  // while showing nothing back.

  const inWatchlist = isInWatchlist?.(symbol)
  const about = data?.about || null
  const onchain = data?.onchain || null

  const tabs = isStock ? TABS_STOCK : TABS

  // 24h range position (0-100)
  const rangePct = useMemo(() => {
    const h = safeNum(tokenData?.high24h)
    const l = safeNum(tokenData?.low24h)
    const p = safeNum(tokenData?.price)
    if (h === null || l === null || p === null || h === l) return 50
    return Math.max(0, Math.min(100, ((p - l) / (h - l)) * 100))
  }, [tokenData?.high24h, tokenData?.low24h, tokenData?.price])

  // Circulating / max supply %
  const supplyPct = useMemo(() => {
    const c = safeNum(tokenData?.circulatingSupply)
    const m = safeNum(tokenData?.maxSupply)
    if (c === null || m === null || m === 0) return null
    return Math.min(100, (c / m) * 100)
  }, [tokenData?.circulatingSupply, tokenData?.maxSupply])

  // §K 52-week range position for stocks
  const range52Pct = useMemo(() => {
    const h = safeNum(tokenData?.week52High)
    const l = safeNum(tokenData?.week52Low)
    const p = safeNum(tokenData?.price)
    if (h === null || l === null || p === null || h === l) return 50
    return Math.max(0, Math.min(100, ((p - l) / (h - l)) * 100))
  }, [tokenData?.week52High, tokenData?.week52Low, tokenData?.price])

  // §K SEC filing detector — promotes regulatory news to top
  const isSecFiling = useCallback((item) => {
    const text = `${item?.title || ''} ${item?.source || ''}`.toLowerCase()
    return /\b(sec|edgar|form\s?(10-k|10-q|8-k|13[-\s]?[fd])|proxy statement|prospectus)\b/.test(text)
  }, [])

  const sortedNewsItems = useMemo(() => {
    if (!isStock || !newsItems?.length) return newsItems
    const sec = []
    const rest = []
    for (const item of newsItems) {
      if (isSecFiling(item)) sec.push(item)
      else rest.push(item)
    }
    return [...sec, ...rest]
  }, [newsItems, isStock, isSecFiling])

  const handleStarClick = () => {
    const tokenInfo = { symbol, name: tokenName, image: tokenLogo, cgId: data?.token?.cgId }
    if (inWatchlist) removeFromWatchlist?.(symbol)
    else addToWatchlist?.(tokenInfo)
  }

  // Share-to-X card — desktop parity (generateRzTokenShareCard + ShareXModal).
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [shareImageUrl, setShareImageUrl] = useState(null)
  const [shareDescription, setShareDescription] = useState('')
  const [shareExporting, setShareExporting] = useState(false)
  const shareMountedRef = useRef(true)
  useEffect(() => () => { shareMountedRef.current = false }, [])

  const handleShareClick = useCallback(async () => {
    if (shareExporting) return
    setShareExporting(true)
    setShareImageUrl(null)
    setShareModalOpen(true)
    try {
      const { imageUrl, description } = await generateRzTokenShareCard({
        symbol,
        tokenName,
        tokenLogo,
        price: chartLivePrice ?? tokenData?.price,
        tokenData,
        isStock,
        timeframe: '1H',
        chartType: 'candles',
        chartToken: activeTokenInfo || chartToken,
      })
      if (!shareMountedRef.current) return
      setShareDescription(description)
      setShareImageUrl(imageUrl)
    } catch (err) {
      console.error('RZ mobile share failed:', err)
      if (!shareMountedRef.current) return
      setShareModalOpen(false)
      // Fallback to a plain URL share so the button never dead-ends.
      try {
        const shareUrl = typeof window !== 'undefined' ? window.location.href : ''
        if (navigator.share) await navigator.share({ title: `${tokenName || symbol} — Spectre AI`, url: shareUrl })
        else if (navigator.clipboard && shareUrl) {
          await navigator.clipboard.writeText(shareUrl)
          triggerCopyToast?.('Link copied')
        }
      } catch {}
    }
    if (!shareMountedRef.current) return
    setShareExporting(false)
  }, [shareExporting, symbol, tokenName, tokenLogo, chartLivePrice, tokenData, isStock, activeTokenInfo, chartToken, triggerCopyToast])

  const change24hNum = safeNum(tokenData?.change24h) ?? 0
  const priceStr = fmtPrice ? fmtPrice(tokenData?.price) : (tokenData?.price ?? '—')
  const bullBear = change24hNum >= 0 ? 'bull' : 'bear'

  // ── Tab panel renderers (return inner content only; outer .map wraps in .rzm-tab-panel) ──
  const renderOverviewPanel = () => (
    <>
      {/* ── Key metrics (2x2 grid) — lives INSIDE Overview since the tab bar
          moved up under the chart (founder, 08-04: "shouldn't the tabs be
          under the chart?") ── */}
      <div className="rzm-metrics">
        <div className="rzm-metrics-grid">
          <StatCard
            label={t('researchPro.rzMobile.researchzonemobile.label', "Market Cap")}
            value={fmtLarge?.(tokenData?.mcap) ?? '—'}
            rank={tokenData?.rank}
          />
          <StatCard
            label={t('researchPro.rzMobile.researchzonemobile.label2', "24h Volume")}
            value={fmtLarge?.(tokenData?.volume24h) ?? '—'}
            sub={tokenData?.volMcapPct ? `${tokenData.volMcapPct} of MCap` : null}
          />
          {!isStock && (
            <>
              <StatCard
                label={t('researchPro.rzMobile.researchzonemobile.label3', "FDV")}
                value={fmtLarge?.(tokenData?.fdv) ?? '—'}
              />
              <StatCard
                label={t('researchPro.rzMobile.researchzonemobile.label4', "Circulating")}
                value={fmtLarge?.(tokenData?.circulatingSupply) ?? '—'}
                sub={tokenData?.maxSupply ? `of ${fmtLarge?.(tokenData.maxSupply)}` : null}
                supplyPct={supplyPct}
              />
            </>
          )}
          {isStock && (
            <>
              <StatCard label="P/E" value={tokenData?.pe != null ? Number(tokenData.pe).toFixed(2) : '—'} />
              <StatCard label={t('researchPro.rzMobile.researchzonemobile.label5', "EPS")} value={tokenData?.eps != null ? Number(tokenData.eps).toFixed(2) : '—'} />
              <StatCard
                label={t('researchPro.rzMobile.researchzonemobile.label6', "Div Yield")}
                value={tokenData?.dividendYield != null
                  ? `${(Number(tokenData.dividendYield) * (tokenData.dividendYield < 1 ? 100 : 1)).toFixed(2)}%`
                  : '—'}
              />
              <StatCard label={t('researchPro.rzMobile.researchzonemobile.label7', "Beta")} value={tokenData?.beta != null ? Number(tokenData.beta).toFixed(2) : '—'} />
              <StatCard label={t('researchPro.rzMobile.researchzonemobile.label8', "Avg Vol")} value={fmtLarge?.(tokenData?.avgVolume) ?? '—'} />
              <StatCard label={t('researchPro.rzMobile.researchzonemobile.label9', "Shares Out")} value={fmtLarge?.(tokenData?.sharesOutstanding) ?? '—'} />
            </>
          )}
        </div>

        {/* Vertical stats list */}
        <div className="rzm-stats-list">
          {!isStock && (
            <>
              <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label10', "All-Time High")} value={fmtPrice?.(tokenData?.ath) ?? '—'} changeValue={tokenData?.athChangePct} />
              <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label11', "All-Time Low")} value={fmtPrice?.(tokenData?.atl) ?? '—'} changeValue={tokenData?.atlChangePct} />
            </>
          )}
          {isStock && (
            <>
              <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label12', "52-week High")} value={fmtPrice?.(tokenData?.week52High) ?? '—'} />
              <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label13', "52-week Low")} value={fmtPrice?.(tokenData?.week52Low) ?? '—'} />
              {tokenData?.sector && <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label14', "Sector")} value={tokenData.sector} />}
              {tokenData?.exchange && <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label15', "Exchange")} value={tokenData.exchange} />}
            </>
          )}
          <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label16', "24h High")} value={fmtPrice?.(tokenData?.high24h) ?? '—'} />
          <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label17', "24h Low")} value={fmtPrice?.(tokenData?.low24h) ?? '—'} />
          {/* Holders is a COUNT — fmtLarge is the currency formatter and rendered
              "Holders $0" when the scanner had no count. Hide the row unless a
              real count exists, and format it as a plain number. */}
          {Number(onchain?.holders) > 0 && (
            <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label18', "Holders")} value={formatCompact(onchain.holders)} />
          )}
          {onchain?.liquidity != null && (
            <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label19', "Liquidity")} value={fmtLarge?.(onchain.liquidity) ?? '—'} />
          )}
        </div>
      </div>

      {/* Token Score (if available) */}
      {!isStock && tokenData?.score != null && (
        <div className="rzm-section">
          <div className="rzm-section-title">{t('researchPro.rzMobile.researchzonemobile.tokenScore', "Token Score")}</div>
          <div className="rzm-score-card">
            <div className="rzm-score-hero">
              <div className="rzm-score-value">{tokenData.score}<span className="rzm-score-denom">/10</span></div>
              <div className="rzm-score-label">{t('researchPro.rzMobile.researchzonemobile.spectreComposite', "Spectre Composite")}</div>
            </div>
            <div className="rzm-score-bar">
              <div
                className="rzm-score-bar-fill"
                style={{ width: `${Math.max(0, Math.min(100, (Number(tokenData.score) || 0) * 10))}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {about?.description && (
        <div className="rzm-section">
          <div className="rzm-section-title">{t('researchPro.rzMobile.researchzonemobile.about', "About")}</div>
          <p className="rzm-about-text" style={{
            maxHeight: aboutExpanded ? 'none' : '4.8em',
            overflow: 'hidden'
          }}>
            {/* Strip HTML tags for mobile display */}
            {about.description.replace(/<[^>]+>/g, '').trim()}
          </p>
          {about.description.length > 180 && (
            <button
              type="button"
              className="rzm-about-toggle"
              onClick={() => setAboutExpanded(x => !x)}
            >
              {aboutExpanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}

      {/* Links — merge 3 sources (CG > spectreSocial > dossier.socialLinks)
          to match ProjectCinema's Reference block. Lets the section show
          X / Telegram / Discord / Reddit / GitHub / Medium even when CG only
          returns a homepage. */}
      {(() => {
        const ab = (coinDetails || about)?.links || null
        const social = spectreSocial?.Social_Media || null
        const ds = dossier?.socialLinks || {}
        const homepage = (Array.isArray(ab?.homepage) ? ab.homepage[0] : ab?.homepage) || social?.Website || ds.website || null
        const twitter = (ab?.twitter_screen_name ? `https://x.com/${ab.twitter_screen_name}` : null) || social?.Twitter || ds.twitter || null
        const telegram = (ab?.telegram_channel_identifier ? `https://telegram.me/${ab.telegram_channel_identifier}` : null) || social?.Telegram || ds.telegram || null
        const discord = social?.Discord || ds.discord || null
        const reddit = ab?.subreddit_url || ds.reddit || null
        const github = ab?.repos_url?.github?.[0] || social?.Github || ds.github || null
        const medium = ds.medium || null
        if (!homepage && !twitter && !telegram && !discord && !reddit && !github && !medium) return null
        return (
          <div className="rzm-section">
            <div className="rzm-section-title">{t('researchPro.rzMobile.researchzonemobile.links', "Links")}</div>
            <div className="rzm-links-row">
              {homepage && <a href={homepage} target="_blank" rel="noreferrer noopener" className="rzm-link-chip">Website <ExternalIcon /></a>}
              {twitter && <a href={twitter} target="_blank" rel="noreferrer noopener" className="rzm-link-chip">X / Twitter <ExternalIcon /></a>}
              {telegram && <a href={telegram} target="_blank" rel="noreferrer noopener" className="rzm-link-chip">Telegram <ExternalIcon /></a>}
              {discord && <a href={discord} target="_blank" rel="noreferrer noopener" className="rzm-link-chip">Discord <ExternalIcon /></a>}
              {reddit && <a href={reddit} target="_blank" rel="noreferrer noopener" className="rzm-link-chip">Reddit <ExternalIcon /></a>}
              {github && <a href={github} target="_blank" rel="noreferrer noopener" className="rzm-link-chip">GitHub <ExternalIcon /></a>}
              {medium && <a href={medium} target="_blank" rel="noreferrer noopener" className="rzm-link-chip">Medium <ExternalIcon /></a>}
            </div>
          </div>
        )
      })()}

      {!isStock && (
        <RzmContractSection
          address={tokenData?.address || activeTokenInfo?.address}
          platforms={(coinDetails || about)?.platforms}
          onCopied={triggerCopyToast}
        />
      )}

      {Array.isArray(about?.categories) && about.categories.length > 0 && (
        <div className="rzm-section">
          <div className="rzm-section-title">{t('researchPro.rzMobile.researchzonemobile.categories', "Categories")}</div>
          <div className="rzm-cat-row">
            {about.categories.slice(0, 8).map((c, i) => (
              <span key={i} className="rzm-cat-chip">{c}</span>
            ))}
          </div>
        </div>
      )}

      <div className="rzm-section">
        <div className="rzm-section-title">{t('researchPro.rzMobile.researchzonemobile.performance', "Performance")}</div>
        <div className="rzm-perf-table">
          {performanceData?.map((p) => {
            const cls = changeCls(p.value)
            const absPct = Math.min(100, Math.abs(safeNum(p.value) ?? 0) * 4)
            return (
              <div key={p.label} className="rzm-perf-table-row">
                <span className="rzm-perf-table-label">{p.label}</span>
                <div className="rzm-perf-table-bar-wrap">
                  <div
                    className={`rzm-perf-table-bar rzm-perf-table-bar--${cls}`}
                    style={{ width: `${absPct}%` }}
                  />
                </div>
                <span className={`rzm-stats-row-value rzm-stats-row-value--${cls}`}>
                  {formatPct(p.value)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {!isStock && tokenData?.price > 0 && (
        <div className="rzm-section">
          <div className="rzm-section-title">{t('researchPro.rzMobile.researchzonemobile.converter', "Converter")}</div>
          <RzmConverter symbol={symbol} price={tokenData.price} />
        </div>
      )}

      {/* Native mobile rewrite of the desktop Project tab — 11 rzm- sections:
          Stage stats / Spectre Take / Chain TVL / Health / Positioning /
          Holders / Founder / Builders / Building / Activity / Reference.
          Crypto-only — stocks fall through to legacy stock block. */}
      {!isStock && (
        <RzmProjectSections
          sym={sym}
          td={td}
          dossier={dossier}
          spectreData={spectreData}
          onChainData={onChainData || onchain}
        />
      )}

      {/* §K Stock Company Profile */}
      {isStock && (
        <>
          <div className="rzm-section">
            <div className="rzm-section-title">{t('researchPro.rzMobile.researchzonemobile.keyStatistics', "Key Statistics")}</div>
            <div className="rzm-stats-list">
              {tokenData?.previousClose != null && (
                <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label20', "Prev Close")} value={fmtPrice?.(tokenData.previousClose)} />
              )}
              {tokenData?.open != null && (
                <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label21', "Open")} value={fmtPrice?.(tokenData.open)} />
              )}
              {tokenData?.dayLow != null && tokenData?.dayHigh != null && (
                <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label22', "Day Range")} value={`${fmtPrice?.(tokenData.dayLow)} – ${fmtPrice?.(tokenData.dayHigh)}`} />
              )}
              {tokenData?.dividendYield != null && (
                <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label23', "Dividend Yield")} value={`${Number(tokenData.dividendYield).toFixed(2)}%`} />
              )}
            </div>
          </div>

          <div className="rzm-section">
            <div className="rzm-section-title">{t('researchPro.rzMobile.researchzonemobile.companyProfile', "Company Profile")}</div>
            <div className="rzm-stats-list">
              <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label24', "Symbol")} value={symbol} />
              {tokenData?.ipo && <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label25', "IPO Date")} value={tokenData.ipo} />}
              {tokenData?.ceo && <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label26', "CEO")} value={tokenData.ceo} />}
              {tokenData?.employees != null && (
                <StatsRow
                  label={t('researchPro.rzMobile.researchzonemobile.label27', "Employees")}
                  value={tokenData.employees >= 1000
                    ? `${(tokenData.employees / 1000).toFixed(0)}K`
                    : tokenData.employees.toLocaleString()}
                />
              )}
              {tokenData?.sector && <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label14', "Sector")} value={tokenData.sector} />}
              {tokenData?.industry && tokenData.industry !== tokenData.sector && (
                <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label28', "Industry")} value={tokenData.industry} />
              )}
              {tokenData?.country && <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label29', "Country")} value={tokenData.country} />}
              {tokenData?.exchange && <StatsRow label={t('researchPro.rzMobile.researchzonemobile.label15', "Exchange")} value={tokenData.exchange} />}
            </div>
            {tokenData?.description && (
              <>
                <p className="rzm-about-text" style={{
                  marginTop: 12,
                  maxHeight: aboutExpanded ? 'none' : '4.8em',
                  overflow: 'hidden'
                }}>
                  {tokenData.description}
                </p>
                {tokenData.description.length > 180 && (
                  <button
                    type="button"
                    className="rzm-about-toggle"
                    onClick={() => setAboutExpanded(x => !x)}
                  >
                    {aboutExpanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </>
  )

  // Quote currency parsed from "BASE/QUOTE" (skips contract-address pairs).
  const quoteOf = useCallback((pair) => {
    if (!pair || typeof pair !== 'string') return ''
    const q = pair.split('/')[1]?.trim().toUpperCase() || ''
    if (!q || q.length > 6 || /[^A-Z0-9]/.test(q)) return ''
    return q
  }, [])

  // Available quote currencies for the filter (top by frequency).
  const marketQuoteOptions = useMemo(() => {
    if (!marketsData?.length) return []
    const counts = {}
    for (const m of marketsData) {
      const q = quoteOf(m.pair || `${m.base || symbol}/${m.target || ''}`)
      if (q) counts[q] = (counts[q] || 0) + 1
    }
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 6)
  }, [marketsData, symbol, quoteOf])

  // Depth-verified volume: trust reported 24h volume only up to 50x posted
  // ±2% depth (wash-trade guard, mirrors desktop). Raw numbers still shown.
  const depthVerifiedVol = useCallback((m) => {
    const vol = Number(m.volume24h ?? m.converted_volume?.usd ?? m.volume) || 0
    const depth = (Number(m.depthPlus2) || 0) + (Number(m.depthMinus2) || 0)
    if (depth <= 0) return vol
    return Math.min(vol, depth * 50)
  }, [])

  // Filtered + sorted markets respecting CEX/DEX + Spot/Perp + quote + min-vol.
  const filteredMarkets = useMemo(() => {
    if (!marketsData?.length) return []
    const rows = marketsData.filter(m => {
      const chip = exchangeTypeChip(m)
      const isDex = chip.variant === 'dex'
      const isPerp = chip.variant === 'perp'
      const isSpot = chip.variant === 'spot'
      if (marketsFilter === 'cex' && isDex) return false
      if (marketsFilter === 'dex' && !isDex) return false
      if (marketsType === 'spot' && !isSpot) return false
      if (marketsType === 'perp' && !isPerp) return false
      if (marketsQuote !== 'all' && quoteOf(m.pair || `${m.base || symbol}/${m.target || ''}`) !== marketsQuote) return false
      if (marketsMinVol > 0 && (Number(m.volume24h ?? m.converted_volume?.usd ?? m.volume) || 0) < marketsMinVol) return false
      return true
    })
    const keyMap = { price: 'price', volumePct: 'volumePct', depth: 'liquidity', fundingRate: 'fundingRate', openInterest: 'openInterest' }
    const readVal = (m) => {
      if (marketsSort === 'volume') return depthVerifiedVol(m)
      if (marketsSort === 'depth') return (Number(m.liquidity) || (Number(m.depthPlus2) || 0) + (Number(m.depthMinus2) || 0))
      return Number(m[keyMap[marketsSort]] ?? 0) || 0
    }
    return [...rows].sort((a, b) => {
      const va = readVal(a), vb = readVal(b)
      return marketsSortDir === 'desc' ? vb - va : va - vb
    })
  }, [marketsData, marketsFilter, marketsType, marketsQuote, marketsMinVol, marketsSort, marketsSortDir, symbol, quoteOf, depthVerifiedVol])

  const handleMarketsSort = useCallback((col) => {
    if (marketsSort === col) setMarketsSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setMarketsSort(col); setMarketsSortDir('desc') }
  }, [marketsSort])

  const totalMarketPages = Math.max(1, Math.ceil(filteredMarkets.length / MARKETS_PAGE_SIZE))
  const currentMarketsPage = Math.min(marketsPage, totalMarketPages)
  const pagedMarkets = useMemo(
    () => filteredMarkets.slice(
      (currentMarketsPage - 1) * MARKETS_PAGE_SIZE,
      currentMarketsPage * MARKETS_PAGE_SIZE,
    ),
    [filteredMarkets, currentMarketsPage],
  )

  useEffect(() => { setMarketsPage(1) }, [marketsFilter, marketsType, marketsQuote, marketsMinVol, marketsSort, marketsSortDir, symbol])

  const renderMarketsPanel = () => {
    // Stocks: native analyst/earnings/predictions/fundamentals surface (no exchange list).
    if (isStock) {
      return (
        <RzmStockMarkets
          symbol={symbol}
          tokenName={tokenName}
          tokenData={tokenData}
          fmtPrice={fmtPrice}
          fmtLarge={fmtLarge}
          newsItems={newsItems}
        />
      )
    }
    const onchainAddr = activeTokenInfo?.address || tokenData?.address
    return (
    <>
          {/* Exchanges / Trades segment (crypto) */}
          {onchainAddr && (
            <div className="rzm-filters">
              <div className="rzm-filter-group">
                {[
                  { id: 'exchanges', label: 'Exchanges' },
                  { id: 'trades', label: 'Trades' },
                ].map(f => (
                  <button
                    key={f.id}
                    type="button"
                    className={`rzm-filter-pill${marketsSegment === f.id ? ' is-active' : ''}`}
                    onClick={() => setMarketsSegment(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {marketsSegment === 'trades' && onchainAddr ? (
            <div className="rzm-section">
              <RzmTradesList
                address={onchainAddr}
                networkId={activeTokenInfo?.networkId}
                symbol={symbol}
                fmtPrice={fmtPrice}
                enabled={activeTab === 'markets' && marketsSegment === 'trades'}
              />
            </div>
          ) : (
          <>
          {/* §A2 Binance-style segmented filters */}
          <div className="rzm-filters">
              <div className="rzm-filter-group">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'cex', label: 'CEX' },
                  { id: 'dex', label: 'DEX' },
                ].map(f => (
                  <button
                    key={f.id}
                    type="button"
                    className={`rzm-filter-pill${marketsFilter === f.id ? ' is-active' : ''}`}
                    onClick={() => setMarketsFilter(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="rzm-filter-group">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'spot', label: 'Spot' },
                  { id: 'perp', label: 'Perp' },
                ].map(f => (
                  <button
                    key={f.id}
                    type="button"
                    className={`rzm-filter-pill${marketsType === f.id ? ' is-active' : ''}`}
                    onClick={() => setMarketsType(f.id)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

          {/* Sort control + advanced filters */}
          <div className="rzm-mkt-controls">
            <div className="rzm-mkt-sortrow" role="group" aria-label={t('researchPro.rzMobile.researchzonemobile.ariaSortExchanges', "Sort exchanges")}>
              <span className="rzm-mkt-sortlabel">{t('researchPro.rzMobile.researchzonemobile.sort', "Sort")}</span>
              {[
                { id: 'volume', label: 'Vol' },
                { id: 'price', label: 'Price' },
                { id: 'depth', label: 'Depth' },
                { id: 'volumePct', label: 'Vol%' },
              ].map(c => (
                <button
                  key={c.id}
                  type="button"
                  className={`rzm-mkt-sortpill${marketsSort === c.id ? ' is-active' : ''}`}
                  onClick={() => handleMarketsSort(c.id)}
                >
                  {c.label}
                  {marketsSort === c.id && <span className="rzm-mkt-sortdir">{marketsSortDir === 'desc' ? '↓' : '↑'}</span>}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={`rzm-mkt-filterbtn${(marketsQuote !== 'all' || marketsMinVol > 0) ? ' is-active' : ''}`}
              onClick={() => setMarketsFiltersOpen(o => !o)}
              aria-expanded={marketsFiltersOpen}
            >
              Filters{(marketsQuote !== 'all' || marketsMinVol > 0) ? ` · ${(marketsQuote !== 'all' ? 1 : 0) + (marketsMinVol > 0 ? 1 : 0)}` : ''}
            </button>
          </div>
          {marketsFiltersOpen && (
            <div className="rzm-mkt-advanced">
              {marketQuoteOptions.length > 0 && (
                <div className="rzm-mkt-advrow">
                  <span className="rzm-mkt-advlabel">{t('researchPro.rzMobile.researchzonemobile.quote', "Quote")}</span>
                  <div className="rzm-mkt-advpills">
                    <button type="button" className={`rzm-mkt-advpill${marketsQuote === 'all' ? ' is-active' : ''}`} onClick={() => setMarketsQuote('all')}>{t('researchPro.rzMobile.researchzonemobile.all', "All")}</button>
                    {marketQuoteOptions.map(q => (
                      <button key={q} type="button" className={`rzm-mkt-advpill${marketsQuote === q ? ' is-active' : ''}`} onClick={() => setMarketsQuote(q)}>{q}</button>
                    ))}
                  </div>
                </div>
              )}
              <div className="rzm-mkt-advrow">
                <span className="rzm-mkt-advlabel">{t('researchPro.rzMobile.researchzonemobile.minVol', "Min Vol")}</span>
                <div className="rzm-mkt-advpills">
                  {[
                    { v: 0, label: 'Any' },
                    { v: 1e5, label: '$100K' },
                    { v: 1e6, label: '$1M' },
                    { v: 1e7, label: '$10M' },
                  ].map(o => (
                    <button key={o.v} type="button" className={`rzm-mkt-advpill${marketsMinVol === o.v ? ' is-active' : ''}`} onClick={() => setMarketsMinVol(o.v)}>{o.label}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="rzm-section">
            <div className="rzm-section-title">
              Exchanges {filteredMarkets.length > 0 && `· ${filteredMarkets.length}`}
            </div>
            {marketsLoading && !marketsData?.length && (
              <>
                <div className="rzm-skeleton rzm-skeleton--row" />
                <div className="rzm-skeleton rzm-skeleton--row" />
                <div className="rzm-skeleton rzm-skeleton--row" />
              </>
            )}
            {!marketsLoading && !filteredMarkets.length && (
              <p className="rzm-empty">{t('researchPro.rzMobile.researchzonemobile.noExchangesMatchTheseFilte', "No exchanges match these filters.")}</p>
            )}
            <div className="rzm-exchange-list">
              {pagedMarkets.map((m, i) => {
                const chip = exchangeTypeChip(m)
                const name = m.exchange || m.market?.name || 'Unknown'
                const rawPair = m.pair || `${m.base || symbol}/${m.target || 'USD'}`
                const { display: pair, hasAddr: pairHasAddr, full: pairFull } = formatPairDisplay(rawPair)
                const price = m.price ?? m.last
                const volume = m.volume24h ?? m.converted_volume?.usd ?? m.volume
                const volPct = typeof m.volumePct === 'number' ? m.volumePct : null
                const liquidity = m.liquidity || ((m.depthPlus2 || 0) + (m.depthMinus2 || 0)) || null
                const trust = m.trustScore || m.trust_score || null
                const tradeUrl = m.tradeUrl || m.trade_url || getExchangeHomeUrl(name)
                const logo = getExchangeIcon(name) || m.logo || m.market?.logo || null
                const initial = (name || '?').trim().charAt(0).toUpperCase()
                const rowClass = `rzm-exchange-row${tradeUrl ? ' rzm-exchange-row--link' : ''}`
                const rowKey = `${name}-${pair}-${i}`
                const isPerpRow = chip.variant === 'perp'
                const funding = typeof m.fundingRate === 'number' ? m.fundingRate : null
                const oi = m.openInterest ?? null
                const inner = (
                  <>
                    <div className="rzm-exchange-avatar" aria-hidden="true">
                      {logo ? (
                        <img
                          src={logo}
                          alt=""
                          loading="lazy"
                          onError={(e) => { e.currentTarget.style.display = 'none' }}
                        />
                      ) : (
                        <span className="rzm-exchange-avatar-fallback">{initial}</span>
                      )}
                    </div>
                    <div className="rzm-exchange-left">
                      <div className="rzm-exchange-name-row">
                        {trust && (
                          <span
                            className={`rzm-exchange-trust rzm-exchange-trust--${trust}`}
                            aria-label={t('researchZone.ariaTrustScore', 'Trust {{score}}', { score: trust })}
                          />
                        )}
                        <span className="rzm-exchange-name">{name}</span>
                        <span className={`rzm-exchange-chip rzm-exchange-chip--${chip.variant}`}>{chip.label}</span>
                      </div>
                      <div className="rzm-exchange-meta">
                        <span className="rzm-exchange-pair" title={pairHasAddr ? pairFull : undefined}>{pair}</span>
                        {isPerpRow && funding != null && (
                          <span className={`rzm-exchange-funding rzm-exchange-funding--${funding >= 0 ? 'bull' : 'bear'}`}>
                            · Funding {funding >= 0 ? '+' : ''}{funding.toFixed(4)}%
                          </span>
                        )}
                        {isPerpRow && oi > 0 && (
                          <span className="rzm-exchange-oi">· OI {fmtLarge?.(oi) ?? '—'}</span>
                        )}
                        {!isPerpRow && volPct != null && volPct > 0 && (
                          <span className="rzm-exchange-share">· {volPct.toFixed(1)}% share</span>
                        )}
                        {!isPerpRow && liquidity > 0 && (
                          <span className="rzm-exchange-depth">· Depth {fmtLarge?.(liquidity) ?? '—'}</span>
                        )}
                      </div>
                    </div>
                    <div className="rzm-exchange-right">
                      <span className="rzm-exchange-price">
                        {fmtPrice?.(price) ?? '—'}
                        {tradeUrl && <span className="rzm-exchange-link-icon" aria-hidden="true">↗</span>}
                      </span>
                      <span className="rzm-exchange-vol">Vol {fmtLarge?.(volume) ?? '—'}</span>
                    </div>
                  </>
                )
                return tradeUrl ? (
                  <a
                    key={rowKey}
                    href={tradeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={rowClass}
                  >
                    {inner}
                  </a>
                ) : (
                  <div key={rowKey} className={rowClass}>
                    {inner}
                  </div>
                )
              })}
            </div>
            {totalMarketPages > 1 && (
              <div className="rzm-pagination" role="navigation" aria-label={t('researchPro.rzMobile.researchzonemobile.ariaMarketsPagination', "Markets pagination")}>
                <button
                  type="button"
                  className="rzm-pagination-btn"
                  disabled={currentMarketsPage <= 1}
                  onClick={() => setMarketsPage((p) => Math.max(1, p - 1))}
                  aria-label={t('researchPro.rzMobile.researchzonemobile.ariaPreviousPage', "Previous page")}
                >
                  ←
                </button>
                <span className="rzm-pagination-label">
                  Page {currentMarketsPage} / {totalMarketPages}
                </span>
                <button
                  type="button"
                  className="rzm-pagination-btn"
                  disabled={currentMarketsPage >= totalMarketPages}
                  onClick={() => setMarketsPage((p) => Math.min(totalMarketPages, p + 1))}
                  aria-label={t('researchPro.rzMobile.researchzonemobile.ariaNextPage', "Next page")}
                >
                  →
                </button>
              </div>
            )}
          </div>
          </>
          )}
    </>
    )
  }

  // Derive signal label/color from a raw value
  const signalFromValue = (v, bullThreshold = 2, bearThreshold = -2) => {
    const n = safeNum(v)
    if (n === null) return { label: 'NEUTRAL', cls: 'neutral' }
    if (n >= bullThreshold * 2) return { label: 'STRONG BUY', cls: 'strong-bull' }
    if (n >= bullThreshold) return { label: 'BUY', cls: 'bull' }
    if (n <= bearThreshold * 2) return { label: 'STRONG SELL', cls: 'strong-bear' }
    if (n <= bearThreshold) return { label: 'SELL', cls: 'bear' }
    return { label: 'NEUTRAL', cls: 'neutral' }
  }

  // Classical pivot levels from 24h high/low/price
  const pivotLevels = useMemo(() => {
    const h = safeNum(tokenData?.high24h)
    const l = safeNum(tokenData?.low24h)
    const c = safeNum(tokenData?.price)
    if (h === null || l === null || c === null) return null
    const pivot = (h + l + c) / 3
    const range = h - l
    return [
      { label: 'R3', value: h + 2 * (pivot - l), cls: 'bull' },
      { label: 'R2', value: pivot + range, cls: 'bull' },
      { label: 'R1', value: 2 * pivot - l, cls: 'bull' },
      { label: 'P',  value: pivot, cls: 'neutral' },
      { label: 'S1', value: 2 * pivot - h, cls: 'bear' },
      { label: 'S2', value: pivot - range, cls: 'bear' },
      { label: 'S3', value: l - 2 * (h - pivot), cls: 'bear' },
    ]
  }, [tokenData?.high24h, tokenData?.low24h, tokenData?.price])

  // Overall verdict — moved BELOW the real-indicator hook (it now votes with
  // the SHARED indicator-score scorers, same sign semantics as the desktop
  // gauge, instead of a %-change-weighted synthetic). See technicalVerdict
  // below techIndicatorData.

  // Quick signals table
  const quickSignals = useMemo(() => [
    { label: 'Momentum (1H)', value: tokenData?.change1h, sig: signalFromValue(tokenData?.change1h, 1, -1) },
    { label: 'Trend (24H)', value: tokenData?.change24h, sig: signalFromValue(tokenData?.change24h, 2, -2) },
    { label: 'Trend (7D)', value: tokenData?.change7d, sig: signalFromValue(tokenData?.change7d, 5, -5) },
    { label: 'Trend (30D)', value: tokenData?.change30d, sig: signalFromValue(tokenData?.change30d, 10, -10) },
  ], [tokenData?.change1h, tokenData?.change24h, tokenData?.change7d, tokenData?.change30d])

  // Real technical indicators from Codex/Binance OHLCV — same hook the desktop
  // Technicals tab uses. Previously this section synthesized RSI/MACD/Bollinger/
  // ATR/Supply/Demand from price + change24h * factor and showed those fake
  // numbers as if they were genuine indicators. Now: real bars or "—".
  const techResolution = TECH_TF_TO_RESOLUTION[techTimeframe] || '240'
  // assetClass routes stock bars through Yahoo. Before this, a stock view
  // fired the full CRYPTO bars chain for symbol='AAPL' — up to 8 wasted
  // round-trips per view, with a live ticker-collision risk (a crypto token
  // named AAPL would have served ITS bars). Now stocks fetch real stock bars.
  const rzAssetClass = isStock ? 'stock' : null
  // Gated symbol/address: null until Technicals has been opened → the hooks
  // no-op (they clear on a falsy symbol/address) so no bar/safety fetches fire
  // for a tab the user hasn't visited.
  const techGateSym = techEverOpened ? (chartToken?.symbol || symbol) : null
  const techGateAddr = techEverOpened ? (activeTokenInfo?.address || null) : null
  const { indicators: rzIndicators, loading: rzIndicatorsLoading } = useKlineIndicators({
    symbol: techGateSym,
    address: techEverOpened ? (chartToken?.address || null) : null,
    networkId: chartToken?.networkId || 1,
    cgId: chartToken?.cgId || null,
    binancePair: chartToken?.binancePair || null,
    resolution: techResolution,
    keyLevels: tokenProfile?.token_details?.key_levels || null,
    assetClass: rzAssetClass,
  })

  // Multi-timeframe read + market structure + vitality for the mobile thesis
  // (same engine as desktop; graceful when data is thin).
  const { mtf: rzMtf } = useMtfThesis({
    symbol: techGateSym,
    networkId: chartToken?.networkId || 1,
    cgId: chartToken?.cgId || null,
    binancePair: chartToken?.binancePair || null,
    assetClass: rzAssetClass,
  })
  const rzSafety = useTokenSafety({
    address: techGateAddr,
    networkId: activeTokenInfo?.networkId || null,
  })
  const rzMarketStructure = useMemo(() => {
    const mcap = Number(tokenData?.marketCap ?? tokenData?.mcap) || null
    const athv = Number(tokenData?.ath) || null
    const pricev = Number(tokenData?.price) || null
    const mcapLabel = mcap != null ? (mcap >= 1e9 ? `$${(mcap / 1e9).toFixed(1)}B` : `$${(mcap / 1e6).toFixed(1)}M`) : null
    if (isStock) {
      // Equity structure — buildEquityStructure reads these; no crypto
      // microcap/tax/honeypot vocabulary ever reaches a stock thesis.
      return {
        assetClass: 'stock',
        mcap, mcapLabel, isSmallCap: false, isOnchain: false, price: pricev,
        liquidity: null, holders: null, buyTax: null, sellTax: null, isHoneypot: false,
        fromAthPct: null,
        beta: Number(tokenData?.beta) || null,
        week52High: Number(tokenData?.week52High) || null,
        week52Low: Number(tokenData?.week52Low) || null,
        avgVolumeShares: Number(tokenData?.avgVolume) || null,
        earningsDate: tokenData?.earningsDate || null,
        targetMeanPrice: Number(tokenData?.targetMeanPrice) || null,
        recommendationKey: tokenData?.recommendationKey || null,
        analystCount: Number(tokenData?.analystCount) || null,
      }
    }
    return {
      mcap, mcapLabel,
      isSmallCap: mcap != null && mcap > 0 && mcap < 50_000_000,
      isOnchain: !!activeTokenInfo?.address && !isMajorToken(sym),
      liquidity: Number(tokenData?.liquidity) || null,
      holders: Number(tokenData?.holders) || null,
      buyTax: rzSafety?.buyTax ?? tokenData?.buyTax ?? tokenData?.safety?.buyTax ?? null,
      sellTax: rzSafety?.sellTax ?? tokenData?.sellTax ?? tokenData?.safety?.sellTax ?? null,
      isHoneypot: rzSafety?.isHoneypot ?? tokenData?.isHoneypot ?? tokenData?.safety?.isHoneypot ?? false,
      fromAthPct: (athv && pricev && athv > 0) ? ((pricev - athv) / athv) * 100 : null,
    }
  }, [tokenData, activeTokenInfo?.address, sym, rzSafety, isStock])
  const rzVitality = useMemo(() => {
    const g = fundamentalsGrades
    if (!g) return null
    const score = typeof g.overallScore === 'number' ? g.overallScore : null
    const catalysts = Array.isArray(g.catalysts) ? g.catalysts.length : 0
    let level = 'flat'
    if (score != null) level = score >= 65 ? 'up' : score <= 40 ? 'down' : 'flat'
    else if (typeof g.overall === 'string') {
      const first = g.overall[0]?.toUpperCase()
      level = (first === 'A' || first === 'B') ? 'up' : (first === 'D' || first === 'F') ? 'down' : 'flat'
    }
    if (catalysts >= 2 && level === 'flat') level = 'up'
    return { level, catalysts }
  }, [fundamentalsGrades])

  const techIndicatorData = useMemo(() => {
    const p = safeNum(rzIndicators?.price) ?? safeNum(tokenData?.price) ?? 0
    const c = safeNum(tokenData?.change24h) ?? 0
    const h = safeNum(tokenData?.high24h) ?? null
    const l = safeNum(tokenData?.low24h) ?? null
    return {
      p, c, h, l,
      ema200: safeNum(rzIndicators?.ema200),
      rsi: safeNum(rzIndicators?.rsi),
      // stochRsi is an object { k, d } — reading it raw always yielded null.
      stochRsi: safeNum(rzIndicators?.stochRsi?.k),
      atr: safeNum(rzIndicators?.atr),
      atrPct: safeNum(rzIndicators?.atrPct),
      supplyLow: safeNum(rzIndicators?.supply?.low),
      supplyHigh: safeNum(rzIndicators?.supply?.high),
      demandLow: safeNum(rzIndicators?.demand?.low),
      demandHigh: safeNum(rzIndicators?.demand?.high),
      macdLine: safeNum(rzIndicators?.macd?.line),
      macdSignal: safeNum(rzIndicators?.macd?.signal),
      macdHist: safeNum(rzIndicators?.macd?.histogram),
      bbUpper: safeNum(rzIndicators?.bb?.upper),
      bbMiddle: safeNum(rzIndicators?.bb?.middle),
      bbLower: safeNum(rzIndicators?.bb?.lower),
    }
  }, [rzIndicators, tokenData?.price, tokenData?.change24h, tokenData?.high24h, tokenData?.low24h])

  // Overall verdict — REAL indicator votes through the SHARED scorers (same
  // sign semantics as the desktop gauge: direction from the midline, extremes
  // read through the regime), replacing the old %-change-weighted synthetic
  // that showed "STRONG BUY" off a hot hour. Falls back to the price-change
  // read only while bars haven't loaded (fewer than 3 real votes).
  const technicalVerdict = useMemo(() => {
    const d = techIndicatorData
    const regime = rzIndicators?.regime || null
    const votes = []
    if (Number.isFinite(d.p) && Number.isFinite(d.ema200)) votes.push(d.p >= d.ema200 ? 'bull' : 'bear')
    const rsiSig = scoreRsi(Number.isFinite(d.rsi) ? d.rsi : null, regime).sig
    if (rsiSig) votes.push(rsiSig)
    const stochSig = scoreStoch(Number.isFinite(d.stochRsi) ? d.stochRsi : null, regime).sig
    if (stochSig) votes.push(stochSig)
    const { lineSig, histSig } = scoreMacd(rzIndicators?.macd)
    if (lineSig) votes.push(lineSig)
    if (histSig) votes.push(histSig)
    const bbSig = scoreBb(d.p, rzIndicators?.bb, regime).sig
    if (bbSig) votes.push(bbSig)

    const finish = (score) => {
      let label = 'NEUTRAL'
      let cls = 'neutral'
      if (score >= 40) { label = 'STRONG BUY'; cls = 'strong-bull' }
      else if (score >= 15) { label = 'BUY'; cls = 'bull' }
      else if (score <= -40) { label = 'STRONG SELL'; cls = 'strong-bear' }
      else if (score <= -15) { label = 'SELL'; cls = 'bear' }
      // Map -100..100 to 0..1 for arc
      return { score, label, cls, arcFraction: (score + 100) / 200 }
    }

    if (votes.length >= 3) {
      const bullVotes = votes.filter((v) => v === 'bull').length
      const bearVotes = votes.filter((v) => v === 'bear').length
      return finish(Math.max(-100, Math.min(100, ((bullVotes - bearVotes) / votes.length) * 100)))
    }
    // Fallback: %-change-weighted read while real bars are still loading.
    const mom = safeNum(tokenData?.change1h) ?? 0
    const tr24 = safeNum(tokenData?.change24h) ?? 0
    const tr7d = safeNum(tokenData?.change7d) ?? 0
    const tr30d = safeNum(tokenData?.change30d) ?? 0
    return finish(Math.max(-100, Math.min(100, (mom * 10) + (tr24 * 5) + (tr7d * 2) + (tr30d * 1))))
  }, [techIndicatorData, rzIndicators, tokenData?.change1h, tokenData?.change24h, tokenData?.change7d, tokenData?.change30d])

  const technicalIndicators = useMemo(() => {
    const d = techIndicatorData
    const fmtP = (v) => (Number.isFinite(v) && fmtPrice ? fmtPrice(v) : '—')
    const fmtRange = (lo, hi) => {
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return '—'
      return `${fmtP(lo)} – ${fmtP(hi)}`
    }
    return [
      { name: 'EMA200', value: fmtP(d.ema200) },
      { name: 'RSI', value: fmtFixed(d.rsi, 2) },
      { name: 'Stochastic RSI', value: fmtFixed(d.stochRsi, 2) },
      { name: 'ATR', value: fmtP(d.atr) },
      { name: 'Supply Zone', value: fmtRange(d.supplyLow, d.supplyHigh) },
      { name: 'Demand Zone', value: fmtRange(d.demandLow, d.demandHigh) },
      { name: 'MACD Line', value: fmtFixed(d.macdLine, 3) },
      { name: 'MACD Signal', value: fmtFixed(d.macdSignal, 3) },
      { name: 'MACD Histogram', value: fmtFixed(d.macdHist, 3) },
      { name: 'BB Upper', value: fmtP(d.bbUpper) },
      { name: 'BB Middle', value: fmtP(d.bbMiddle) },
      { name: 'BB Lower', value: fmtP(d.bbLower) },
    ]
  }, [techIndicatorData, fmtPrice])

  const technicalAiCards = useMemo(() => {
    const d = techIndicatorData
    const fmtP = (v) => (Number.isFinite(v) && fmtPrice ? fmtPrice(v) : '—')
    const aboveEma = Number.isFinite(d.p) && Number.isFinite(d.ema200) ? d.p >= d.ema200 : null
    // Regime-aware copy through the SAME shared scorers the desktop tab uses —
    // an overbought print in an uptrend reads as trend strength, not an
    // automatic "watch for reversal". regime is null on stocks / before bars
    // load, which keeps the classic zone copy.
    const regime = rzIndicators?.regime || null
    const trendUp = !!regime && (regime.trend === 'up' || regime.priceDiscovery)
    const rsiScore = scoreRsi(Number.isFinite(d.rsi) ? d.rsi : null, regime)
    const rsiZone = !Number.isFinite(d.rsi) ? null : (rsiScore.zone || 'neutral')
    const stochScore = scoreStoch(Number.isFinite(d.stochRsi) ? d.stochRsi : null, regime)
    const stochZone = !Number.isFinite(d.stochRsi) ? null : (stochScore.zone || 'neutral')
    const stripRsi = (n) => {
      const s = (n || '').replace(/^RSI\s+-?\d+\s+—\s+/, '')
      return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
    }
    const LOADING = 'Loading real chart data — indicator will populate once enough bars are available.'
    return [
      {
        name: 'EMA200', subtitle: 'Exponential Moving Average (200)', icon: 'ema',
        explanation: aboveEma === null ? LOADING : `The EMA200 value is ${fmtP(d.ema200)}. ${aboveEma
          ? 'Since the current price is above the EMA200, this suggests the price is currently in an uptrend from a long-term perspective.'
          : 'The current price is below the EMA200, which suggests a downtrend from a long-term perspective. A break above EMA200 could signal a trend reversal.'}`,
      },
      {
        name: 'RSI', subtitle: 'Relative Strength Index', icon: 'rsi',
        explanation: rsiZone === null ? LOADING : regime && rsiScore.note
          ? `The RSI is ${fmtFixed(d.rsi, 2)}. ${stripRsi(rsiScore.note)}.`
          : `The RSI is ${fmtFixed(d.rsi, 2)}. ${rsiZone === 'overbought'
            ? 'This value is in overbought territory (above 70) — momentum is strong but stretched.'
            : rsiZone === 'oversold'
              ? 'This value is in oversold territory (below 30) — momentum is washed out; snap-back risk for late shorts.'
              : 'This value is neutral, indicating the asset is neither overbought nor oversold.'}`,
      },
      {
        name: 'Stochastic RSI', subtitle: 'Stochastic Relative Strength', icon: 'stochastic',
        explanation: stochZone === null ? LOADING : `The Stochastic RSI is ${fmtFixed(d.stochRsi, 2)}. ${stochZone === 'overbought'
          ? (trendUp
            ? 'It is pinned above 80 while the trend is up — a band-walk, i.e. trend strength; fading it is counter-trend.'
            : regime?.trend === 'down'
              ? 'Above 80 into a downtrend — a counter-trend rally, not fresh strength.'
              : 'Above 80 in a range — momentum extended, mean-reversion risk.')
          : stochZone === 'oversold'
            ? (regime?.trend === 'down'
              ? 'Below 20 in a downtrend — washed out, but it can stay washed.'
              : 'Below 20 — momentum washed out; watch for the snap-back.')
            : 'It sits near the midpoint, suggesting balanced short-term momentum.'}`,
      },
      {
        name: 'ATR', subtitle: 'Average True Range', icon: 'atr',
        explanation: !Number.isFinite(d.atr) || !Number.isFinite(d.atrPct) ? LOADING : `The ATR is ${fmtP(d.atr)}. ${d.atrPct > 5
          ? 'This value suggests high volatility. The price fluctuates significantly within the given timeframe.'
          : d.atrPct > 2
            ? 'This value suggests moderate volatility, typical for active trading conditions.'
            : 'This value suggests relatively low volatility.'}`,
      },
      {
        name: 'Supply Zone', subtitle: 'Resistance Area', icon: 'supply',
        explanation: !Number.isFinite(d.supplyLow) ? LOADING : `The supply zone is between ${fmtP(d.supplyLow)} and ${fmtP(d.supplyHigh)}. This indicates a potential area of resistance. Sellers are likely to enter at these levels.`,
      },
      {
        name: 'Demand Zone', subtitle: 'Support Area', icon: 'demand',
        explanation: !Number.isFinite(d.demandLow) ? LOADING : `The demand zone is between ${fmtP(d.demandLow)} and ${fmtP(d.demandHigh)}. This is a potential support level where buyers might step in and prevent further decline.`,
      },
      {
        name: 'MACD', subtitle: 'Moving Average Convergence Divergence', icon: 'macd',
        explanation: !Number.isFinite(d.macdLine) ? LOADING : `The MACD value is ${fmtFixed(d.macdLine, 3)}. ${d.macdLine >= 0
          ? 'Being positive suggests bullish momentum.'
          : 'Being negative suggests bearish momentum.'}`,
      },
      {
        name: 'MACD Signal', subtitle: 'Signal Line', icon: 'signal',
        explanation: !Number.isFinite(d.macdSignal) || !Number.isFinite(d.macdLine) ? LOADING : `The MACD Signal line is at ${fmtFixed(d.macdSignal, 3)}. ${d.macdLine > d.macdSignal
          ? 'The MACD is above the signal line, which is a bullish crossover signal.'
          : 'The MACD is below the signal line, which is a bearish crossover signal.'}`,
      },
    ]
  }, [techIndicatorData, rzIndicators, fmtPrice])

  const renderTechnicalsPanel = () => (
    <>
      {!isStock && (
        <div className="rzm-section">
          <div className="rzm-section-title">{t('researchPro.rzMobile.researchzonemobile.technicalChart', "Technical Chart")}</div>
          <div className="rzm-tech-chart-wrap">
            <div className="rzm-tech-chart-tfs" role="tablist" aria-label={t('researchPro.rzMobile.researchzonemobile.ariaTimeframe', "Timeframe")}>
              {['15M', '1H', '4H', '1D', '1W'].map((tf) => (
                <button
                  key={tf}
                  type="button"
                  role="tab"
                  aria-selected={techTimeframe === tf}
                  className={`rzm-tech-chart-tf${techTimeframe === tf ? ' is-active' : ''}`}
                  onClick={() => setTechTimeframe(tf)}
                >
                  {tf.toLowerCase()}
                </button>
              ))}
            </div>
            <div className="rzm-tech-chart">
              <Suspense fallback={<ChartSkeleton height={340} label={t('researchPro.rzMobile.researchzonemobile.label30', "Loading technical chart")} />}>
                <TradingViewAdvanced
                  symbol={symbol}
                  timeframe={techTimeframe}
                  dayMode={dayMode}
                  height={340}
                  token={chartToken || undefined}
                  onChartReady={handleTechChartReady}
                />
              </Suspense>
            </div>
          </div>
        </div>
      )}

      {/* Stocks: the chart block above is crypto-only, so the timeframe pills
          need their own row — they drive every indicator computed below. */}
      {isStock && (
        <div className="rzm-section">
          <div className="rzm-tech-chart-tfs" role="tablist" aria-label={t('researchPro.rzMobile.researchzonemobile.ariaTimeframe', "Timeframe")}>
            {['15M', '1H', '4H', '1D', '1W'].map((tf) => (
              <button
                key={tf}
                type="button"
                role="tab"
                aria-selected={techTimeframe === tf}
                className={`rzm-tech-chart-tf${techTimeframe === tf ? ' is-active' : ''}`}
                onClick={() => setTechTimeframe(tf)}
              >
                {tf.toLowerCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Trade Thesis runs for BOTH asset classes — stocks feed it Yahoo bars
          + the equity structure block (earnings gap risk, beta, 52w range) */}
      <div className="rzm-section">
        <TradeThesisSection
          indicators={rzIndicators}
          mtf={rzMtf}
          marketStructure={rzMarketStructure}
          vitality={isStock ? null : rzVitality}
          loading={rzIndicatorsLoading}
          timeframe={techTimeframe}
          fmtPrice={fmtPrice}
        />
      </div>

      <div className="rzm-section">
        <div className="rzm-section-title">Technical Indicators · {techTimeframe}</div>
        <div className="rzm-tech-ind-list">
          {technicalIndicators.map((ind, i) => (
            <div key={ind.name} className="rzm-tech-ind-row">
              <span className="rzm-tech-ind-num">{i + 1}.</span>
              <span className="rzm-tech-ind-name">{ind.name}</span>
              <span className="rzm-tech-ind-val">{ind.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rzm-section">
        <div className="rzm-section-title">{t('researchPro.rzMobile.researchzonemobile.taAiAnalysis', "TA AI Analysis")}</div>
        <div className="rzm-ta-ai-list">
          {technicalAiCards.map((ind) => (
            <div key={ind.name} className="rzm-ta-ai-card">
              <div className="rzm-ta-ai-head">
                <span className="rzm-ta-ai-icon">
                  <IndicatorGlyph kind={ind.icon} />
                </span>
                <span className="rzm-ta-ai-title">
                  {ind.name}
                  <span className="rzm-ta-ai-sub"> ({ind.subtitle})</span>
                </span>
              </div>
              <p className="rzm-ta-ai-text">{ind.explanation}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Macro context — stocks read the index tape (SPY/QQQ/VIX/session);
          crypto self-gates to top-50 coins (majors trade the crypto tape) */}
      <div className="rzm-section">
        {isStock ? (
          <EquityMacroSection sym={sym} td={td} />
        ) : (
          <MacroAnalysisSection
            sym={sym}
            td={td}
            activeTokenInfo={activeTokenInfo}
            fmtPrice={fmtPrice}
          />
        )}
      </div>
    </>
  )

  // Stock tweet pool for the equity crowd gauge — merge the ticker tweet
  // sources the mobile shell already receives (dedup by id). Desktop builds
  // the same pool in research-zone-pro.jsx from spectreTweets + social feeds.
  const stockTweetPool = useMemo(() => {
    const pool = []
    const seen = new Set()
    const add = (arr) => {
      if (!Array.isArray(arr)) return
      for (const tw of arr) {
        const id = tw?.id || tw?.tweet_id || tw?.url
        if (id && seen.has(id)) continue
        if (id) seen.add(id)
        pool.push(tw)
      }
    }
    add(spectreTweets)
    add(officialTweets)
    return pool.length ? pool : null
  }, [spectreTweets, officialTweets])

  const renderSentimentPanel = () => {
    // Stocks: equity desk read + crowd gauge (reuses desktop StockSentimentTab).
    if (isStock) {
      return <RzmStockSentiment sym={(symbol || '').toUpperCase()} tweets={stockTweetPool} />
    }
    // Mobile Sentiment now mirrors desktop exactly — chart + mentions + KOL.
    // Per user feedback (2026-05-18), the mobile-only Fear & Greed,
    // Sentiment Score spark, AI Scenario, and Alt Season Index sections
    // were removed: F&G is a global metric (lives elsewhere), the AI
    // Scenario card and Alt Season Index are not part of the desktop
    // Sentiment tab, and the Sentiment Score 30d spark is replaced by the
    // richer Sentiment Analysis chart below.

    return (
      <>
        {/* Engine topline: crowd gauge + verdict + signal pills + stance */}
        {!isStock && (
          <div className="rzm-section rzm-sen-section">
            <RzSentimentCommand sym={(symbol || '').toUpperCase()} engine={sentimentEngine} dayMode={dayMode} />
          </div>
        )}

        {/* Project dossier: what it does, how it works, where it sits (matches desktop) */}
        {!isStock && (
          <div className="rzm-section rzm-sen-section">
            <RzProjectDossier
              sym={(symbol || '').toUpperCase()}
              cgId={sentimentCgId}
              name={tokenName || (symbol || '').toUpperCase()}
              dayMode={dayMode}
            />
          </div>
        )}

        {/* Full on-chain dossier (flows, safety, pools, holders, signals) — desktop parity */}
        {!isStock && (
          <div className="rzm-section rzm-sen-section">
            <button
              type="button"
              className="rzm-dossier-open-btn"
              onClick={() => setDossierSheetOpen(true)}
            >
              <span>{t('researchPro.rzMobile.researchzonemobile.viewFullOnChainDossier', "View full on-chain dossier")}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
            </button>
          </div>
        )}

        {/* Fundamentals: real supply/protocol data (unlock overhang + TVL) */}
        {!isStock && sentimentEngine.fundamentals && (
          <div className="rzm-section rzm-sen-section">
            <div className="rzm-section-title">Supply &amp; Protocol</div>
            <div className="rzm-section-sub">Token unlock schedule and protocol TVL — the hard supply/adoption data</div>
            <RzFundamentals fundamentals={sentimentEngine.fundamentals} dayMode={dayMode} />
          </div>
        )}

        {/* The centerpiece: crowd sentiment overlaid on price + mention flow */}
        {!isStock && (
          <div className="rzm-section rzm-sen-section">
            <div className="rzm-section-title">{t('researchPro.rzMobile.researchzonemobile.sentimentVsPrice', "Sentiment vs Price")}</div>
            <div className="rzm-section-sub">{t('researchPro.rzMobile.researchzonemobile.llmClassifiedCrowdSentiment', "LLM-classified crowd sentiment against price")}</div>
            <RzSentimentPriceChart
              sym={(symbol || '').toUpperCase()}
              cgId={sentimentCgId}
              engine={sentimentEngine}
              dayMode={dayMode}
            />
          </div>
        )}

        {/* AI desk read */}
        {!isStock && (
          <div className="rzm-section rzm-sen-section">
            <div className="rzm-section-title">{t('researchPro.rzMobile.researchzonemobile.aiSentimentRead', "AI Sentiment Read")}</div>
            <div className="rzm-section-sub">{t('researchPro.rzMobile.researchzonemobile.thesisRisksInvalidations', "Thesis, risks, invalidations")}</div>
            <RzAiSentimentRead sym={(symbol || '').toUpperCase()} cgId={sentimentCgId} dayMode={dayMode} />
          </div>
        )}

        {/* Narrative radar: Brain + policy tape + catalysts (class-aware) */}
        {!isStock && (
          <div className="rzm-section rzm-sen-section">
            <div className="rzm-section-title">Narrative &amp; Catalysts</div>
            <div className="rzm-section-sub">
              {sentimentTokenClass.key === 'micro' || sentimentTokenClass.key === 'nano'
                ? 'Token news + Brain reads — policy tape muted at this size'
                : 'Brain narratives, the policy tape and dated catalysts'}
            </div>
            <RzNarrativeRadar
              sym={(symbol || '').toUpperCase()}
              tokenClass={sentimentTokenClass.key}
              dayMode={dayMode}
            />
          </div>
        )}

        {/* X Dash forensics */}
        {!isStock && (
          <div className="rzm-section rzm-sen-section">
            <div className="rzm-section-title">{t('researchPro.rzMobile.researchzonemobile.socialIntelligence', "Social Intelligence")}</div>
            <div className="rzm-section-sub">{t('researchPro.rzMobile.researchzonemobile.chatterQualityLifecycleAnd', "Chatter quality, lifecycle and the since-tracked receipt")}</div>
            <RzSocialIntel sym={(symbol || '').toUpperCase()} engine={sentimentEngine} dayMode={dayMode} />
          </div>
        )}

        {/* Behavior-aware macro */}
        {!isStock && (
          <div className="rzm-section rzm-sen-section">
            <div className="rzm-section-title">{t('researchPro.rzMobile.researchzonemobile.marketContext', "Market Context")}</div>
            <div className="rzm-section-sub">{t('researchPro.rzMobile.researchzonemobile.theDriversThatMatterForTh', "The drivers that matter for this token's size and type")}</div>
            <RzMarketContext sym={(symbol || '').toUpperCase()} engine={sentimentEngine} dayMode={dayMode} />
          </div>
        )}

        {/* Desktop parity: cross-platform mentions (X / TG / Reddit / YT).
            RzMentionsPanel ships its own header + empty state — wrapping it
            in a forced section-title left an orphaned "CROSS-PLATFORM
            MENTIONS" label when the panel had no data to render. */}
        {!isStock && (
          <div className="rzm-section rzm-mentions-section">
            <RzMentionsPanel asset={symbol} sym={symbol} />
          </div>
        )}

        {/* Desktop parity: KOL Bubbles network (capped height for mobile) */}
        {!isStock && (
          <div className="rzm-section">
            <div className="rzm-section-title">{t('researchPro.rzMobile.researchzonemobile.kolNetwork', "KOL Network")}</div>
            <div className="rzm-section-sub">Voices talking about ${symbol} · sized by followers</div>
            <Suspense fallback={<div style={{ height: 360 }} />}>
              <RzKolCosmos
                symbol={symbol}
                cgId={tokenData?.cgId || tokenData?.coingeckoId || null}
                tokenLogo={tokenLogo || null}
                tokenName={tokenName || symbol}
                dayMode={dayMode}
                isMobile
                height={360}
              />
            </Suspense>
          </div>
        )}

        {/* Desktop parity: the Social feed (Social Reach + live tweets) sits at
            the bottom of the desktop Sentiment tab. Mobile also keeps a dedicated
            Social tab, but mirror the section here so Sentiment matches desktop. */}
        {renderSocialPanel()}

      </>
    )
  }

  const renderSocialPanel = () => {
    const sm = spectreSocial?.Social_Media || {}
    const tw = officialTweets || []
    const searchTw = spectreTweets || []
    const socialStats = [
      { label: 'Twitter', value: sm.twitter_followers ?? sm.Twitter_Followers },
      { label: 'Telegram', value: sm.telegram_users ?? sm.Telegram_Users },
      { label: 'Reddit', value: sm.reddit_subscribers ?? sm.Reddit_Subscribers },
      { label: 'GitHub', value: sm.github_stars ?? sm.Github_Stars },
    ].filter(s => s.value != null)

    return (
      <>
        {socialStats.length > 0 && (
          <div className="rzm-section">
            <div className="rzm-section-title">{t('researchPro.rzMobile.researchzonemobile.socialReach', "Social Reach")}</div>
            <div className="rzm-social-grid">
              {socialStats.map(s => (
                <div key={s.label} className="rzm-social-stat">
                  <span className="rzm-social-stat-value">{fmtLarge?.(s.value) ?? '—'}</span>
                  <span className="rzm-social-stat-label">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(() => {
          const categorized = (() => {
            const official = tw
            const search = searchTw
            const posts = official.filter(x => {
              const text = (x.content || x.text || '').trim()
              return !text.startsWith('RT @') && !text.startsWith('@')
            })
            const replies = official.filter(x => {
              const text = (x.content || x.text || '').trim()
              return text.startsWith('@') && !text.startsWith('RT @')
            })
            const influencers = search.filter(x => (x.followers || 0) >= 10000)
            const community = search.filter(x => (x.followers || 0) < 10000)
            const all = [...official, ...search]
            return { posts, replies, community, influencers, all }
          })()
          const activeTweets = categorized[tweetSegment] || categorized.all

          return (
            <div className="rzm-section">
              <div className="rzm-section-title">{t('researchPro.rzMobile.researchzonemobile.latestTweets', "Latest Tweets")}</div>
              <div className="rzm-tw-segments" role="tablist" aria-label={t('researchPro.rzMobile.researchzonemobile.ariaTweetFilter', "Tweet filter")}>
                {TWEET_SEGMENTS.map(seg => (
                  <button
                    key={seg.key}
                    type="button"
                    role="tab"
                    aria-selected={tweetSegment === seg.key}
                    className={`rzm-tw-seg${tweetSegment === seg.key ? ' is-active' : ''}`}
                    onClick={() => setTweetSegment(seg.key)}
                  >
                    {t(seg.i18nKey, seg.label)}
                  </button>
                ))}
              </div>
              {officialTweetsLoading && (
                <>
                  <div className="rzm-skeleton rzm-skeleton--summary" />
                  <div className="rzm-skeleton rzm-skeleton--summary" />
                </>
              )}
              {!officialTweetsLoading && activeTweets.length === 0 && (
                <p className="rzm-empty">{t('researchPro.rzMobile.researchzonemobile.noTweetsAvailable', "No tweets available.")}</p>
              )}
              <div className="rzm-tw-list" role="feed" aria-label={t('researchZone.ariaTweetsAbout', 'Tweets about {{name}}', { name: tokenName })}>
                {activeTweets.slice(0, 20).map((tweet, i) => {
                  const handle = (tweet.handle || tweet.username || tweet.author || '').replace(/^@/, '')
                  const tweetUrl = tweet.url || (handle ? `https://x.com/${handle}` : null)
                  const mediaUrl = tweet.mediaUrl || tweet.media?.[0]?.media_url_https
                  const isVideo = tweet.mediaType === 'video' || tweet.media?.[0]?.type === 'video'
                  const body = tweet.content || tweet.text || ''
                  const time = tweet.time || tweet.publishedAt || ''
                  return (
                    <article
                      key={tweet.id || i}
                      className="rzm-tw"
                      onClick={() => tweetUrl && window.open(tweetUrl, '_blank', 'noopener,noreferrer')}
                      role={tweetUrl ? 'link' : undefined}
                      tabIndex={tweetUrl ? 0 : undefined}
                    >
                      <div className="rzm-tw-head">
                        {tweet.avatar ? (
                          <img
                            src={tweet.avatar}
                            alt=""
                            className="rzm-tw-avi"
                            loading="lazy"
                            onError={(e) => { e.currentTarget.style.display = 'none' }}
                          />
                        ) : (
                          <span className="rzm-tw-avi rzm-tw-avi--fallback">
                            {(tweet.name || handle || '?').charAt(0).toUpperCase()}
                          </span>
                        )}
                        <div className="rzm-tw-who">
                          <span className="rzm-tw-name">{tweet.name || handle || 'User'}</span>
                          {handle && <span className="rzm-tw-handle">@{handle}</span>}
                          {time && <span className="rzm-tw-time">· {time}</span>}
                        </div>
                      </div>
                      {body && <p className="rzm-tw-body">{body}</p>}
                      {mediaUrl && (
                        <div className="rzm-tw-media">
                          <img src={mediaUrl} alt="" loading="lazy" />
                          {isVideo && (
                            <div className="rzm-tw-media-play" aria-hidden="true">
                              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="rzm-tw-stats">
                        {tweet.views != null && (
                          <span className="rzm-tw-stat">{TweetIcons.views}<b>{formatCompact(tweet.views)}</b></span>
                        )}
                        {tweet.retweets != null && (
                          <span className="rzm-tw-stat">{TweetIcons.retweet}<b>{formatCompact(tweet.retweets)}</b></span>
                        )}
                        {tweet.likes != null && (
                          <span className="rzm-tw-stat">{TweetIcons.heart}<b>{formatCompact(tweet.likes)}</b></span>
                        )}
                        {tweet.comments != null && (
                          <span className="rzm-tw-stat">{TweetIcons.comment}<b>{formatCompact(tweet.comments)}</b></span>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            </div>
          )
        })()}
      </>
    )
  }

  const renderNewsPanel = () => (
    <>
      <div className="rzm-section">
        <div className="rzm-section-title">
          Latest News {newsSource ? `· ${newsSource}` : ''}
        </div>
        {!newsItems?.length && (
          <>
            <div className="rzm-skeleton rzm-skeleton--row" />
            <div className="rzm-skeleton rzm-skeleton--row" />
            <div className="rzm-skeleton rzm-skeleton--row" />
          </>
        )}
        <div className="rzm-news-list">
          {(sortedNewsItems || newsItems || []).slice(0, 15).map((n, i) => {
            const isFiling = isStock && isSecFiling(n)
            return (
              <a
                key={`${n.url || i}-${i}`}
                href={n.url}
                target="_blank"
                rel="noreferrer noopener"
                className={`rzm-news-item${isFiling ? ' rzm-news-item--filing' : ''}`}
              >
                <div className="rzm-news-text">
                  <div className="rzm-news-title-row">
                    {isFiling && <span className="rzm-news-badge rzm-news-badge--sec">{t('researchPro.rzMobile.researchzonemobile.sec', "SEC")}</span>}
                    <span className="rzm-news-title">{n.title}</span>
                  </div>
                  <span className="rzm-news-meta">
                    {n.source || '—'}
                    {n.time ? ` · ${n.time}` : ''}
                  </span>
                </div>
                {n.imageUrl && (
                  <img src={n.imageUrl} alt="" className="rzm-news-thumb" loading="lazy" />
                )}
              </a>
            )
          })}
        </div>
      </div>
    </>
  )

  return (
    <div
      className={`rzm${dayMode ? ' rzm--day' : ''}`}
      data-sentiment={bullBear}
    >
      {/* Branded splash — covers the BTC-default flicker on cold load */}
      {!splashHidden && (
        <div
          className="rzm-splash"
          aria-live="polite"
          aria-label={t('researchZone.ariaLoadingTokenResearch', 'Loading {{name}} research', { name: tokenName || symbol })}
        >
          <div className="rzm-splash-inner">
            <img
              src={dayMode ? '/logo-day-mode.png' : '/spectre-logo-header.png'}
              alt="Spectre"
              className="rzm-splash-logo"
              draggable="false"
            />
            <div className="rzm-splash-shimmer" />
            <span className="rzm-splash-caption">
              Loading {(tokenName || symbol || 'research').toString()}
            </span>
          </div>
        </div>
      )}

      {/* NO pull-to-refresh here — founder 08-04: "in research zone no loader
          when i drag down. i dont think we need a drag there". Both halves are
          right. The gesture is suppressed whenever it starts on the chart (see
          usePullToRefresh `suppressedRef`), and the chart is most of this
          screen, so most drags did nothing at all — a control that silently
          fails is worse than no control. Nothing is lost: this page already
          polls its own data. The landing page keeps its pull, where the gesture
          has the whole page to start from. */}

      {/* ── Identity row ── */}
      <div className="rzm-identity">
        <MobileBackButton className="rzm-back" />
        <button
          type="button"
          className="rzm-identity-left rzm-identity-left--switch"
          onClick={rzHistory.openSwitcher}
          aria-label={t('researchPro.rzMobile.researchzonemobile.ariaSwitchToken', "Switch token")}
        >
          {tokenLogo ? (
            <img src={tokenLogo} alt={tokenName} width="48" height="48" fetchpriority="high" decoding="async" className="rzm-identity-logo" onError={(e) => { e.target.style.display = 'none' }} />
          ) : (
            <div className="rzm-identity-fallback" style={{ background: `rgb(${data?.token?.brandRgb || '60, 60, 70'})` }}>
              {getInitial(symbol)}
            </div>
          )}
          <div className="rzm-identity-info">
            <span className="rzm-identity-name">
              {tokenName || symbol}
              <svg className="rzm-identity-switch-caret" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
            <span className="rzm-identity-meta">
              <span className="rzm-identity-sym">{symbol}</span>
              {tokenData?.rank && <span className="rzm-identity-rank"> · Rank #{tokenData.rank}</span>}
              {about?.categories?.[0] && <span className="rzm-identity-cat"> · {about.categories[0]}</span>}
            </span>
          </div>
        </button>
        <div className="rzm-identity-actions">
          <button
            type="button"
            className="rzm-identity-action"
            onClick={() => setAgentSheetOpen(true)}
            aria-label={t('researchPro.rzMobile.researchzonemobile.ariaAskSpectreAi', "Ask Spectre AI")}
          >
            <AgentSparkIcon />
          </button>
          <button
            type="button"
            className="rzm-identity-action"
            onClick={handleShareClick}
            aria-label={t('researchPro.rzMobile.researchzonemobile.ariaShareToken', "Share token")}
          >
            <ShareIcon />
          </button>
          <button
            type="button"
            className={`rzm-identity-star${inWatchlist ? ' rzm-identity-star--active' : ''}`}
            onClick={handleStarClick}
            aria-label={inWatchlist ? 'Remove from watchlist' : 'Add to watchlist'}
          >
            <StarIcon filled={inWatchlist} />
          </button>
        </div>
      </div>

      {/* ── Price Hero — Bybit horizontal layout ── */}
      <div className="rzm-hero">
        {isStock && (() => {
          const mh = getMarketHoursStatus()
          return (
            <div className={`rzm-market-hours rzm-market-hours--${mh.variant}`}>
              <span className="rzm-market-hours-dot" />
              {mh.label}
            </div>
          )
        })()}

        <div className="rzm-hero-top">
          {/* Left: colored price + change % + USD equivalent */}
          <div className="rzm-hero-left">
            <span className={`rzm-hero-price rzm-hero-price--${bullBear}`}>{priceStr}</span>
            <div className="rzm-hero-sub">
              <span className={`rzm-hero-change rzm-hero-change--${bullBear}`}>
                {formatPct(tokenData?.change24h)}
              </span>
              {tokenData?.price != null && (
                <span className="rzm-hero-usd">
                  {/* USD-only equivalent (deliberate formatPrice exception) -
                      micro-aware, so microcaps don't read "≈ $0.00" */}
                  ≈ {compressZeros(formatPriceUsd(Number(tokenData.price), 'USD', 1))}
                </span>
              )}
            </div>
          </div>

          {/* Right: key stats column. Market cap leads — it is the first thing
              CMC and CoinGecko put next to a price, and its absence here was
              the founder's "lite doesnt show project Market caps" (2026-08-12).
              High/Low fold into one row to pay for it without growing the hero. */}
          <div className="rzm-hero-stats">
            {Number(tokenData?.marketCap) > 0 && (
              <div className="rzm-hero-stat">
                <span className="rzm-hero-stat-label">{isStock ? 'Market Cap' : 'Mkt Cap'}</span>
                <span className="rzm-hero-stat-value">{fmtLarge?.(tokenData.marketCap) ?? '—'}</span>
              </div>
            )}
            <div className="rzm-hero-stat">
              <span className="rzm-hero-stat-label">24h H/L</span>
              <span className="rzm-hero-stat-value">
                {fmtPrice?.(tokenData?.high24h) ?? '—'}
                <em className="rzm-hero-stat-sep"> / </em>
                {fmtPrice?.(tokenData?.low24h) ?? '—'}
              </span>
            </div>
            <div className="rzm-hero-stat">
              <span className="rzm-hero-stat-label">{isStock ? '24h Volume' : '24h Turnover'}</span>
              <span className="rzm-hero-stat-value">{fmtLarge?.(tokenData?.volume24h) ?? '—'}</span>
            </div>
          </div>
        </div>

        {/* Performance pills — compact scrollable row below hero */}
        <div className="rzm-perf-row">
          {performanceData?.map((p) => (
            <div key={p.label} className={`rzm-perf-pill rzm-perf-pill--${changeMagnitudeCls(p.value)}`}>
              <span className="rzm-perf-pill-label">{p.label}</span>
              <span className="rzm-perf-pill-value">{formatPct(p.value)}</span>
            </div>
          ))}
        </div>

        {/* §K 52W Range (stocks only — kept as it's a stock-specific signal) */}
        {isStock && tokenData?.week52High && tokenData?.week52Low && (
          <div className="rzm-range">
            <span className="rzm-range-label">52W Range</span>
            <div className="rzm-range-bar-wrap">
              <span className="rzm-range-value">{fmtPrice?.(tokenData.week52Low)}</span>
              <div className="rzm-range-bar">
                <div className="rzm-range-fill" style={{ width: `${range52Pct}%` }} />
                <div className="rzm-range-dot" style={{ left: `${range52Pct}%` }} />
              </div>
              <span className="rzm-range-value">{fmtPrice?.(tokenData.week52High)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Next Earnings — promoted above the chart on mobile (gap-risk lead). */}
      {isStock && tokenData?.earningsDate && (
        <div style={{ padding: '0 14px' }}>
          <RzEarningsBanner
            earningsDate={tokenData.earningsDate}
            earningsAvg={tokenData.earningsAvg}
            revenueAvg={tokenData.revenueAvg}
          />
        </div>
      )}

      {/* ── Chart ── */}
      <div className="rzm-chart-section">
        <div className="rzm-chart-wrap">
          <RzChartSection
            ref={chartRef}
            onSymbolChange={setSymbol}
            chartToken={chartToken}
            identityPending={!!data?.identityResolving}
            chartHeight={Math.max(220, Math.min(chartHeight || 320, 720))}
            dayMode={dayMode}
            livePrice={chartLivePrice}
            tokenData={tokenData}
            onChartDragStart={onChartDragStart}
            tradeMarkers={tradeMarkers}
            onVoiceStateChange={onVoiceStateChange}
            extraToolButtons={chartToolButtons}
            compareViewActive={compareModeActive && !!rzCompare.compareSym}
            compareViewProps={compareViewProps}
            annotations={rzAnnotations.annotations}
            onAnnotationClick={() => setNotesSheetOpen(true)}
            taMode={taEnabled ? chartTa.taMode : undefined}
            taSelection={taEnabled ? chartTa.selection : undefined}
            onTaSelectionChange={taEnabled ? chartTa.onTaSelectionChange : undefined}
            taDrawings={taEnabled ? chartTa.drawings : undefined}
            onTaDrawingAdd={taEnabled ? chartTa.onTaDrawingAdd : undefined}
            taRevealKey={taEnabled ? chartTa.revealKey : undefined}
          />
        </div>
        {/* The desktop strip does not survive 390px — mobile gets its own shape
            (lens + bottom sheet). See rzm-read.css for the measured reason. */}
        {taEnabled && (
          <Suspense fallback={null}>
            <RzmRead
              chartRef={chartRef}
              chartTa={chartTa}
              symbol={symbol}
              onOpenAgent={() => setAgentSheetOpen(true)}
            />
          </Suspense>
        )}
      </div>

      {/* ── Sticky sub-tab bar — directly under the chart (founder, 08-04) ── */}
      <div className="rzm-tabs-sticky">
        <div className="rzm-tabs" ref={tabStripRef} role="tablist" aria-label={t('researchPro.rzMobile.researchzonemobile.ariaResearchSections', "Research sections")}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${tabId}-${tab.id}`}
              aria-controls={`${tabId}-panel`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              aria-selected={activeTab === tab.id}
              className={`rzm-tab${activeTab === tab.id ? ' rzm-tab--active' : ''}`}
              onClick={() => handleTabSelect(tab.id)}
              onKeyDown={(event) => {
                const index = tabs.findIndex(item => item.id === tab.id)
                const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
                let next
                if (event.key === 'Home') next = 0
                else if (event.key === 'End') next = tabs.length - 1
                else if (event.key === 'ArrowRight') next = (index + (rtl ? -1 : 1) + tabs.length) % tabs.length
                else if (event.key === 'ArrowLeft') next = (index + (rtl ? 1 : -1) + tabs.length) % tabs.length
                else return
                event.preventDefault()
                handleTabSelect(tabs[next].id)
                tabStripRef.current?.querySelectorAll('[role="tab"]')[next]?.focus({ preventScroll: true })
              }}
            >
              <span className="rzm-tab-icon">{TAB_ICONS[tab.id]}</span>
              {t(tab.i18nKey, tab.label)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="rzm-tab-content" ref={tabContentRef}>
        <div key={activeTab} className="rzm-tab-panel" id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${activeTab}`} tabIndex={0}>
          {activeTab === 'overview' && renderOverviewPanel()}
          {activeTab === 'markets' && renderMarketsPanel()}
          {activeTab === 'technicals' && renderTechnicalsPanel()}
          {activeTab === 'sentiment' && renderSentimentPanel()}
          {activeTab === 'social' && renderSocialPanel()}
          {activeTab === 'news' && renderNewsPanel()}
        </div>
      </div>

      {agentEverOpened && (
        <Suspense fallback={null}>
          <RzmAgentSheet
            open={agentSheetOpen}
            onClose={() => setAgentSheetOpen(false)}
            symbol={symbol}
            tokenName={tokenName}
            tokenLogo={tokenLogo}
            tokenData={tokenData}
            newsItems={newsItems}
            social={spectreSocial}
            cgId={data?.token?.cgId}
            isStock={isStock}
            dayMode={dayMode}
            taRequest={taRequest}
            onAgentDrawings={chartTa.setAgentDrawings}
          />
        </Suspense>
      )}

      {dossierSheetOpen && (
        <Suspense fallback={null}>
          <RzmDossierSheet
            open={dossierSheetOpen}
            onClose={() => setDossierSheetOpen(false)}
            sym={(symbol || '').toUpperCase()}
            tokenName={tokenName}
            dayMode={dayMode}
          />
        </Suspense>
      )}

      {notesSheetOpen && (
        <Suspense fallback={null}>
          <RzmNotesSheet
            open={notesSheetOpen}
            onClose={() => setNotesSheetOpen(false)}
            symbol={symbol}
            currentPrice={chartLivePrice}
            fmtPrice={fmtPrice}
            dayMode={dayMode}
            annotations={rzAnnotations.annotations}
            onAdd={rzAnnotations.add}
            onRemove={rzAnnotations.remove}
          />
        </Suspense>
      )}

      {!isStock && (
        <RzmComparePicker
          open={comparePickerOpen}
          dayMode={dayMode}
          baseSymbol={symbol}
          onPick={(token) => {
            rzCompare.setCompare(token)
            setCompareModeActive(true)
            setComparePickerOpen(false)
          }}
          onClose={() => setComparePickerOpen(false)}
        />
      )}

      <RzQuickSwitcher
        open={rzHistory.switcherOpen}
        onClose={rzHistory.closeSwitcher}
        history={rzHistory.history}
        currentSymbol={symbol}
        onSelect={handleQuickSwitchSelect}
        onClear={rzHistory.clear}
      />

      {shareModalOpen && createPortal(
        <Suspense fallback={null}>
          <ShareXModal
            open={shareModalOpen}
            onClose={() => { setShareModalOpen(false); setShareImageUrl(null) }}
            imageUrl={shareImageUrl}
            defaultDescription={shareDescription}
            filename={`spectre_${(symbol || 'token').toLowerCase()}_snapshot.png`}
            contentType="research_zone_token"
          />
        </Suspense>,
        document.body
      )}

    </div>
  )
}
