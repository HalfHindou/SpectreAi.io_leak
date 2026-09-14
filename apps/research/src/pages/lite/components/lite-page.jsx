/**
 * SPECTRE LITE - the app's simple mode: a slim shell with its own left rail
 * and twelve easy views, each a calm reflection of a PRO surface, in two looks:
 *
 *  GLASS - GM Dashboard DNA: rotating nature photo, scrim, frosted glass.
 *  PAPER - Apple.com keynote: warm gray canvas, elevated white cards,
 *          enormous typography.
 *
 * Views: Today · Markets (+derivatives pulse) · Research (chart) · Heatmap ·
 * Social · Movers · Sectors · Calendar · Predictions · Watchlist · Sentiment ·
 * News. Every view ends with a "go deeper in PRO" door (never target a
 * Coming-Soon-gated path - the guard bounces silently). Desktop = left rail;
 * mobile = top bar + 4-tab bottom bar + More sheet. One data hook feeds the
 * shell - switching views or looks never refetches; heavy payloads (calendar,
 * Polymarket, derivatives) lazy-load per view.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { tl } from './lite-i18n'
import lazyWithRetry from '@/lib/lazy-with-retry'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { CURRENCIES } from '@/lib/currencyConfig'
import useSettingsStore from '@/store/useSettingsStore'
import { SCROLL_TINTS } from '@/constants/scrollTints'
import useBackDismiss from '@/hooks/use-back-dismiss'
const ThemeGlobe = lazyWithRetry(() => import('@/components/pro-theme/theme-globe'))
import useLiteData, { composeBrief, liteTimeAgo, isStableOrWrapped } from './use-lite-data'
import { getSpectreSearch } from '@/services/spectreMarketApi'
import ResearchView, { loadDailyWindow, bustResearchCaches } from './lite-research'
import WhyView from './lite-why'
import FlowsView from './lite-flows'
import VitalsView from './lite-vitals'
import CompareView from './lite-compare'
import useEtfFlows from '@/components/etf/use-etf-flows'
import { useMomentumSetups, useMomentumSignals } from '@/hooks/useMomentumData'
import { fmtQty } from '@/pages/wallets/components/use-wallets-data'
import DealLogo from './lite-deal-logo'
import { resultTone } from '@/pages/economic-calendar/utils/eventResult'
import ZigView from './lite-zigchain'
import NewsView from './lite-news'
import InsightsView from './lite-insights'
import DerivativesView from './lite-derivs'
import LiqView from './lite-liq'
import EtfView from './lite-etf'
import PredictionsView from './lite-predictions'
import { LiteEtfShare, litEtfUsd } from './lite-etf-share'
import StocksView, { STOCK_SYMBOL_SET, useStockRows, StockMarketsView, StockMoversView, StockSectorsView, StockNewsView, StockWatchlistView, bustStockCache } from './lite-stocks'
import LiteCinema, { CinemaButton } from './lite-cinema'
import LiteEditPop from './lite-edit-sheet'
import useDragReorder from './use-drag-reorder'
import LiteIntelDeskView, { LiteIntelDeskCard, LiteDeskBriefCard } from './lite-intel-desk'
import LiteMusic from './lite-music'
import LiteSerenity from './lite-serenity'
import { loadWallpapers, getWallpapers, addWallpaper, removeWallpaper, onWallpapersChanged } from './lite-wallpapers'
import './lite-neon.css'
import LiteNext48 from './lite-next48'
import { searchStocks, getStockLogoUrl } from '@/services/stockApi'
import { isTradableContract, openTradingTerminal } from '@/lib/trading-terminal'
// Microcaps reads PRO's brain directly, so Lite can never print a different
// verdict or a different chain map than /alt-rotation.
import {
  CHAINS as ROT_CHAINS, dexVolume, loadChainCohort, onchainPulse,
  buildVerdict, buildSetup, buildTrendWindow, buildDepth, medianBars, chainLink,
} from '@/pages/alt-rotation/alt-rotation-core'
import ChartWatermark from '@/components/chart-watermark'
import { track, Events } from '@/services/analytics'

import './lite-page.css'
import './lite-page.mobile.css'

// Backdrop catalog lives in lite-backdrops.js (shared with the Pro theme studio).
export * from './lite-backdrops'
import {
  BG_PHOTO_IDS,
  BG_SCENES,
  BG_COSMOS,
  BG_CITY,
  BG_COLOR,
  ALL_PHOTO_SCENES,
  BG_GRADIENTS,
  BG_SOLIDS,
  BG_MESH,
  BG_BRIGHT,
  BG_POP,
  BG_ART,
  BG_BRAND,
  isBrightBg,
  resolveBgDef,
  resolveCssBg,
  BG_PAPER,
  BG_PAPER_PATTERNS,
  resolvePaperBg,
  readCustomBg,
  storeCustomBg,
  bgUrl,
  BG_NEON,
  BG_PAPER_NEON,
  isNeonBg,
  BG_CATALOG,
  BG_PAPER_CATALOG,
} from './lite-backdrops'

const ICONS = {
  today: <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />,
  why: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.2 9.2a2.8 2.8 0 1 1 3.9 2.6c-.8.35-1.1.9-1.1 1.7v.3M12 17h.01" />,
  markets: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  stocks: <path d="M7 4v3M7 17v3M5 7h4v10H5V7zM17 2v3M17 19v3M15 5h4v9h-4V5z" />,
  compare: <path d="M3 17l5-8 4 5 4-9 5 7M3 21h18" />,
  watchlist: <path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9L12 3z" />,
  sentiment: <path d="M12 21a9 9 0 1 1 9-9M12 12l5-3M12 12h.01" />,
  news: <path d="M4 5h13v14H6a2 2 0 0 1-2-2V5zM17 8h3v9a2 2 0 0 1-2 2h-1M8 9h5M8 13h5" />,
  // Intel Desk is the signal inbox - a tray, so it never reads as a second
  // newspaper (news) or a second lightbulb (insights) in the same group.
  inteldesk: <path d="M6.5 4h11l2.5 9v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5l2.5-9zM4 13h4l1.5 3h5l1.5-3h4" />,
  vitals: <path d="M3 12h4l2.5-6 4 12L16 12h5" />,
  research: <path d="M7 3v3M7 16v5M4 6h6v10H4zM17 6v3M17 19v2M14 9h6v10h-6z" />,
  movers: <path d="M3 8l5-5 4 4 5-5M17 2h4v4M3 16l5 5 4-4 5 5M17 22h4v-4" />,
  sectors: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  heatmap: <path d="M3 3h10v6H3zM15 3h6v10h-6zM3 11h6v10H3zM11 15h10v6H11z" />,
  flows: <path d="M2 6h20v12H2zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 12h.01M18 12h.01" />,
  bubbles: <path d="M9 9a5 5 0 1 0 0.01 0zM18 6a3 3 0 1 0 0.01 0zM17 17a2.5 2.5 0 1 0 0.01 0z" />,
  social: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 1 1 16.1-3.8zM8 11h.01M12 11h.01M16 11h.01" />,
  wallets: <path d="M20 7H4a2 2 0 0 1 0-4h13v4M20 7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5M16 13.5h.01" />,
  media: <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM10 8.5l6 3.5-6 3.5v-7z" />,
  calendar: <path d="M4 5h16v16H4zM4 10h16M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />,
  predictions: <path d="M12 3v4M12 7a5 5 0 0 1 5 5c0 3-2 4-2 6h-6c0-2-2-3-2-6a5 5 0 0 1 5-5zM10 21h4M5 5l2 2M19 5l-2 2" />,
  derivs: <path d="M12 3v18M8 21h8M5 7h14M7 7l-3 6a4 4 0 0 0 8 0L9 7M17 7l-3 6a4 4 0 0 0 8 0l-3-6" />,
  deals: <path d="M4 8h16v12H4zM9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 13h16M12 11v4" />,
  themes: <path d="M12 3a9 9 0 1 0 0 18c1.4 0 1.9-1 1.4-2s.1-2 1.6-2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10zM7.5 11h.01M11 7.5h.01M15.5 9h.01" />,
  roi: <path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01" />,
  rwa: <path d="M3 21h18M4 18h16M6 18v-7M10 18v-7M14 18v-7M18 18v-7M3 8l9-5 9 5H3z" />,
  insights: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 1 3.7 10.7c-.7.6-1.2 1.4-1.2 2.3h-5c0-.9-.5-1.7-1.2-2.3A6 6 0 0 1 12 3z" />,
  liq: <path d="M12 3s6 6.6 6 10.8A6 6 0 0 1 6 13.8C6 9.6 12 3 12 3zM9.5 14a2.5 2.5 0 0 0 2.5 2.5" />,
  etf: <path d="M12 3l7 4-7 4-7-4 7-4zM5 12l7 4 7-4M5 17l7 4 7-4" />,
  gainers: <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />,
  rotation: <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />,
  private: <path d="M6 11h12v10H6zM9 11V7a3 3 0 0 1 6 0v4M12 15v2" />,
  zig: <path d="M5 6h14L5 18h14M12 2v2M12 20v2" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
}

function LiteIcon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  )
}

const VIEWS = [
  { id: 'today', label: 'Today' },
  { id: 'why', label: 'Why' },
  { id: 'markets', label: 'Markets' },
  { id: 'stocks', label: 'Stocks' },
  { id: 'derivs', label: 'Derivatives' },
  { id: 'liq', label: 'Liquidations' },
  { id: 'etf', label: 'ETF Flows' },
  { id: 'research', label: 'Research' },
  { id: 'compare', label: 'Compare' },
  { id: 'heatmap', label: 'Heatmap' },
  { id: 'flows', label: 'Money Flow' },
  { id: 'vitals', label: 'Vitals' },
  { id: 'bubbles', label: 'Bubbles' },
  { id: 'rotation', label: 'Microcaps' },
  { id: 'social', label: 'Social' },
  { id: 'wallets', label: 'Wallets' },
  { id: 'movers', label: 'Movers' },
  { id: 'gainers', label: 'Gainers' },
  { id: 'sectors', label: 'Sectors' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'predictions', label: 'Predictions' },
  { id: 'deals', label: 'Deals' },
  { id: 'private', label: 'Private Markets' },
  { id: 'rwa', label: 'Tokenized' },
  { id: 'zig', label: 'ZIGChain' },
  { id: 'roi', label: 'ROI' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'sentiment', label: 'Fear & Greed' },
  { id: 'news', label: 'News' },
  { id: 'media', label: 'Media' },
  { id: 'inteldesk', label: 'Intel Desk' },
  { id: 'insights', label: 'Insights' },
  { id: 'themes', label: 'Themes' },
]

// Mobile bottom bar: 4 primaries + a More sheet for the rest (10 tabs never
// fit a 390px bar; this is the app's own 4+1 pattern).
const PRIMARY_VIEW_IDS = ['today', 'markets', 'research', 'watchlist']

// Stocks mode keeps the tabs that have honest stock data behind them; the
// crypto-only lanes (derivs, social, wallets, RWA...) hide until flipped back.
const STOCKS_MODE_VIEW_IDS = new Set(['today', 'why', 'markets', 'movers', 'sectors', 'heatmap', 'flows', 'bubbles', 'research', 'compare', 'calendar', 'watchlist', 'news', 'inteldesk', 'insights', 'private', 'roi', 'themes'])

// Sidebar groups mirror PRO's section order (Home / Research / Trading /
// Analysis / Visualize / Social / Tools) - compartmentalized like the big app.
const VIEW_GROUPS = [
  { id: 'home', label: 'Home', ids: ['today', 'why', 'markets', 'stocks', 'research', 'watchlist'] },
  { id: 'research', label: 'Research', ids: ['news', 'inteldesk', 'insights', 'deals', 'private', 'rwa', 'zig'] },
  { id: 'trading', label: 'Trading', ids: ['derivs', 'liq', 'etf', 'wallets', 'movers', 'gainers', 'predictions'] },
  { id: 'analysis', label: 'Analysis', ids: ['compare', 'calendar', 'sectors'] },
  { id: 'visualize', label: 'Visualize', ids: ['heatmap', 'flows', 'bubbles', 'rotation', 'sentiment'] },
  { id: 'social', label: 'Social', ids: ['social', 'media'] },
  { id: 'tools', label: 'Tools', ids: ['roi'] },
]

/**
 * The user's own wallpapers. Kept here rather than in the store because the
 * bytes live in IndexedDB, not in the settings blob — this only tracks the
 * list and the object URLs so a picker can render them.
 */
function useWallpapers() {
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let alive = true
    loadWallpapers().then((rows) => { if (alive) setItems(rows) })
    // Read the already-loaded set. Re-running loadWallpapers() here would
    // re-emit the very event this listener is handling - an endless loop.
    const off = onWallpapersChanged(() => { if (alive) setItems(getWallpapers()) })
    return () => { alive = false; off() }
  }, [])

  const add = useCallback(async (file) => {
    setErr(null); setBusy(true)
    try { await addWallpaper(file) } catch (e) { setErr(e?.message || 'Could not save that image') }
    setBusy(false)
  }, [])
  const remove = useCallback(async (id) => { await removeWallpaper(id) }, [])
  return { items, add, remove, busy, err }
}

function useGreeting(name) {
  const { t } = useTranslation()
  const hour = new Date().getHours()
  const n = (name || '').trim() || 'there'
  if (hour >= 5 && hour < 12) return t('gmDashboard.goodMorning', { name: n })
  if (hour >= 12 && hour < 17) return t('gmDashboard.goodAfternoon', { name: n })
  if (hour >= 17 && hour < 22) return t('gmDashboard.goodEvening', { name: n })
  return t('gmDashboard.goodNight', { name: n })
}

function changeCls(v) { return Number(v) >= 0 ? 'up' : 'down' }

// Beat/miss tint for a printed econ release. Values carry units ("3.75%",
// "210K"), so strip to a number and only judge when BOTH sides parse — an
// unlabelled guess is worse than no colour.
// Shared with the PRO calendar so a print can't read green here and plain
// there. Returns the LITE class suffix (' beat' | ' miss' | ' inline' | '').
function calBeat(e) {
  const tone = resultTone(e)
  return tone ? ` ${tone}` : ''
}

// Heat tint via custom props so each LOOK picks its own alpha floor: the
// translucent glass tint washes out to invisible on Paper's white canvas
// (founder: "heatmaps in day mode hard to see") - Paper reads --hap instead.
function heatStyle(chg) {
  const a = Math.min(0.9, 0.18 + Math.abs(Number(chg) || 0) / 9)
  return {
    '--hrgb': (Number(chg) || 0) >= 0 ? '16 185 129' : '239 68 68',
    '--ha': a,
    '--hap': Math.min(0.94, a + 0.4),
  }
}

function fmtChange(v) {
  const n = Number(v) || 0
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

// ── Chrome ──

function LiteNav({ views, view, setView, look, setLook, onExit, collapsed, onToggle, market, setMarket, onRefresh, refreshing }) {
  const { t } = useTranslation()
  // 32 tabs never fit a laptop-height rail, so the LIST scrolls (the look
  // toggle and Open PRO must stay pinned). Its scrollbar is hidden, so at rest
  // the only thing a reader saw was a row sliced through the middle of its own
  // label - which reads as broken, not as "there is more below". Fade the edge
  // that actually has more behind it, and keep the active tab in view so a
  // deep link (?view=media) does not land on a rail scrolled to the top with
  // nothing highlighted.
  const listRef = useRef(null)
  useEffect(() => {
    const el = listRef.current
    if (!el) return undefined
    const sync = () => {
      el.classList.toggle('has-below', el.scrollHeight - el.clientHeight - el.scrollTop > 4)
      el.classList.toggle('has-above', el.scrollTop > 4)
    }
    sync()
    el.addEventListener('scroll', sync, { passive: true })
    let ro = null
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(sync); ro.observe(el) }
    return () => { el.removeEventListener('scroll', sync); if (ro) ro.disconnect() }
  }, [views, collapsed])
  useEffect(() => {
    const el = listRef.current
    const active = el && el.querySelector('.lite-nav-item.active')
    if (!active) return
    const r = active.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    if (r.top < box.top + 4 || r.bottom > box.bottom - 4) active.scrollIntoView({ block: 'nearest' })
  }, [view])
  return (
    <aside className={`lite-nav${collapsed ? ' lite-nav--collapsed' : ''}`}>
      <div className="lite-nav-head">
        <button type="button" className="lite-wordmark lite-wordmark--btn" onClick={() => setView('today')} aria-label={t('lite.litenav.ariaSpectreLiteGoToToday', "Spectre LITE - go to Today")}>Spectre <span className="lite-wordmark-tag">LITE</span></button>
        <button
          type="button"
          className="lite-nav-toggle"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? tl(t, 'Expand', 'lbl') : tl(t, 'Collapse', 'lbl')}
        >
          <svg className="lite-nav-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
      </div>
      <nav className="lite-nav-items" aria-label={t('lite.litenav.ariaLiteNavigation', "Lite navigation")} ref={listRef}>
        {VIEW_GROUPS.map((g) => {
          const items = (views || VIEWS).filter((v) => g.ids.includes(v.id))
          if (items.length === 0) return null
          return (
            <div key={g.id} className="lite-nav-group">
              {!collapsed && <p className="lite-nav-group-label">{tl(t, g.label, 'grp')}</p>}
              {collapsed && <span className="lite-nav-group-rule" aria-hidden />}
              {items.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`lite-nav-item${view === v.id ? ' active' : ''}`}
                  aria-current={view === v.id ? 'page' : undefined}
                  onClick={() => setView(v.id)}
                  title={collapsed ? t(`lite.tab.${v.id}`, v.label) : undefined}
                >
                  <LiteIcon name={v.id} />
                  <span>{t(`lite.tab.${v.id}`, v.label)}</span>
                </button>
              ))}
            </div>
          )
        })}
      </nav>
      <div className="lite-nav-bottom">
        <button
          type="button"
          className={`lite-nav-item lite-nav-item--pinned${view === 'themes' ? ' active' : ''}`}
          aria-current={view === 'themes' ? 'page' : undefined}
          onClick={() => setView('themes')}
          title={collapsed ? t('lite.tab.themes', 'Themes') : undefined}
        >
          <LiteIcon name="themes" />
          <span>{t('lite.tab.themes', 'Themes')}</span>
        </button>
        {setMarket && (
          <div className="lite-look-toggle lite-market-toggle lite-nav-market" role="tablist" aria-label={t('lite.litenav.ariaMarket', "Market")}>
            <button type="button" role="tab" aria-selected={market !== 'stocks'} className={`lite-look-btn${market !== 'stocks' ? ' active' : ''}`} onClick={() => setMarket('crypto')} title={tl(t, 'Crypto')}>
              <svg className="lite-market-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="8.5" /><path d="M9.5 8h4a2 2 0 0 1 0 4h-4zM9.5 12h4.5a2 2 0 0 1 0 4h-4.5zM10.5 6.5V8M13 6.5V8M10.5 16v1.5M13 16v1.5" /></svg>
              <span className="lite-market-lbl">{tl(t, 'Crypto')}</span>
            </button>
            <button type="button" role="tab" aria-selected={market === 'stocks'} className={`lite-look-btn${market === 'stocks' ? ' active' : ''}`} onClick={() => setMarket('stocks')} title={tl(t, 'Stocks')}>
              <svg className="lite-market-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 4v3M7 17v3M5 7h4v10H5V7zM17 2v3M17 19v3M15 5h4v9h-4V5z" /></svg>
              <span className="lite-market-lbl">{tl(t, 'Stocks')}</span>
            </button>
          </div>
        )}
        <div className="lite-nav-lookrow">
          <div className="lite-look-toggle" role="tablist" aria-label={t('lite.litenav.ariaDesign', "Design")}>
            <button type="button" role="tab" aria-selected={look === 'glass'} className={`lite-look-btn${look === 'glass' ? ' active' : ''}`} onClick={() => setLook('glass')}>{t('lite.lookGlass', 'Glass')}</button>
            <button type="button" role="tab" aria-selected={look === 'paper'} className={`lite-look-btn${look === 'paper' ? ' active' : ''}`} onClick={() => setLook('paper')}>{t('lite.lookPaper', 'Paper')}</button>
          </div>
          {onRefresh && (
            <button type="button" className={`lite-nav-refresh${refreshing ? ' lite-refresh-btn--spin' : ''}`} aria-label={t('lite.litenav.ariaRefreshPrices', "Refresh prices")} title={t('lite.litenav.title', "Refresh")} onClick={onRefresh}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
              </svg>
            </button>
          )}
        </div>
        <button type="button" className="lite-pro-btn" onClick={onExit} title={collapsed ? t('lite.openPro', 'Open PRO') : undefined}>
          <span className="lite-pro-label">{t('lite.openPro', 'Open PRO')}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        </button>
      </div>
    </aside>
  )
}

function LiteTopbar({ look, setLook, onExit, zoom, onToggleZoom, market, setMarket, onRefresh, refreshing, onHome }) {
  const { t } = useTranslation()
  return (
    <header className="lite-topbar">
      <button type="button" className="lite-wordmark lite-wordmark--btn" onClick={onHome} aria-label={t('lite.litetopbar.ariaSpectreLiteGoToToday', "Spectre LITE - go to Today")}>Spectre <span className="lite-wordmark-tag">LITE</span></button>
      <div className="lite-topbar-right">
        {setMarket && (
          <div className="lite-look-toggle lite-market-toggle" role="tablist" aria-label={t('lite.litetopbar.ariaMarket', "Market")}>
            <button type="button" role="tab" aria-selected={market !== 'stocks'} className={`lite-look-btn${market !== 'stocks' ? ' active' : ''}`} onClick={() => setMarket('crypto')} title={tl(t, 'Crypto')}>
              <svg className="lite-market-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="8.5" /><path d="M9.5 8h4a2 2 0 0 1 0 4h-4zM9.5 12h4.5a2 2 0 0 1 0 4h-4.5zM10.5 6.5V8M13 6.5V8M10.5 16v1.5M13 16v1.5" /></svg>
              <span className="lite-market-lbl">{tl(t, 'Crypto')}</span>
            </button>
            <button type="button" role="tab" aria-selected={market === 'stocks'} className={`lite-look-btn${market === 'stocks' ? ' active' : ''}`} onClick={() => setMarket('stocks')} title={tl(t, 'Stocks')}>
              <svg className="lite-market-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 4v3M7 17v3M5 7h4v10H5V7zM17 2v3M17 19v3M15 5h4v9h-4V5z" /></svg>
              <span className="lite-market-lbl">{tl(t, 'Stocks')}</span>
            </button>
          </div>
        )}
        <div className="lite-look-toggle" role="tablist" aria-label={t('lite.litetopbar.ariaDesign', "Design")}>
          <button type="button" role="tab" aria-selected={look === 'glass'} className={`lite-look-btn${look === 'glass' ? ' active' : ''}`} onClick={() => setLook('glass')}>{t('lite.lookGlass', 'Glass')}</button>
          <button type="button" role="tab" aria-selected={look === 'paper'} className={`lite-look-btn${look === 'paper' ? ' active' : ''}`} onClick={() => setLook('paper')}>{t('lite.lookPaper', 'Paper')}</button>
        </div>
        {onRefresh && (
          <button type="button" className={`lite-zoom-btn lite-refresh-btn${refreshing ? ' lite-refresh-btn--spin' : ''}`} aria-label={t('lite.litetopbar.ariaRefreshPrices', "Refresh prices")} onClick={onRefresh}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
            </svg>
          </button>
        )}
        {onToggleZoom && (
          <button type="button" className="lite-zoom-btn" aria-label={zoom === 'out' ? 'Zoom in - bigger text' : 'Zoom out - see more'} onClick={onToggleZoom}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3M8 11h6" />
              {zoom === 'out' && <path d="M11 8v6" />}
            </svg>
          </button>
        )}
        <button type="button" className="lite-pro-btn" onClick={onExit}>{t('lite.pro', 'PRO')}</button>
      </div>
    </header>
  )
}

function LiteTabbar({ views, view, setView }) {
  const { t } = useTranslation()
  const [moreOpen, setMoreOpen] = useState(false)
  // Android back closes the launcher instead of leaving LITE.
  useBackDismiss(moreOpen, () => setMoreOpen(false))
  const primaries = (views || VIEWS).filter((v) => PRIMARY_VIEW_IDS.includes(v.id))
  const overflow = (views || VIEWS).filter((v) => !PRIMARY_VIEW_IDS.includes(v.id))
  const moreActive = overflow.some((v) => v.id === view)

  return (
    <>
      {moreOpen && (
        <>
          <div className="lite-sheet-scrim" onClick={() => setMoreOpen(false)} aria-hidden />
          <div className="lite-sheet" role="menu" aria-label={t('lite.litetabbar.ariaMoreSections', "More sections")}>
            {/* One flat grid, in VIEWS order. The 7 category blocks this replaced
                read as clutter on a phone: 1-4 items each, ragged rows, seven
                labels of chrome for twenty destinations. A launcher does not need
                taxonomy - it needs an even grid you can hit without reading. */}
            {overflow.map((v) => (
              <button
                key={v.id}
                type="button"
                role="menuitem"
                className={`lite-sheet-item${view === v.id ? ' active' : ''}`}
                onClick={() => { setView(v.id); setMoreOpen(false) }}
              >
                <LiteIcon name={v.id} />
                <span>{t(`lite.tab.${v.id}`, v.label)}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <nav className="lite-tabbar" aria-label={t('lite.litetabbar.ariaLiteNavigation', "Lite navigation")}>
        {primaries.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`lite-tab${view === v.id ? ' active' : ''}`}
            aria-current={view === v.id ? 'page' : undefined}
            onClick={() => { setView(v.id); setMoreOpen(false) }}
          >
            <LiteIcon name={v.id} />
            <span>{t(`lite.tab.${v.id}`, v.label)}</span>
          </button>
        ))}
        <button
          type="button"
          className={`lite-tab${moreActive ? ' active' : ''}${moreOpen ? ' open' : ''}`}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((o) => !o)}
        >
          <LiteIcon name="more" />
          <span>{t('lite.more', 'More')}</span>
        </button>
      </nav>
    </>
  )
}

// ── Shared pieces ──

// One line of calm at the end of Today (same spirit as the GM Dashboard).
const LITE_THOUGHTS = [
  'Time in the market beats timing the market.',
  'When in doubt, zoom out.',
  'Patience is the rarest edge.',
  'Plan the trade. Trade the plan.',
  'Small losses are the cost of staying in the game.',
  'Protect the downside; the upside takes care of itself.',
  'The trend is your friend, until it ends.',
  'Strong opinions, loosely held.',
]

function liteDailyThought() {
  const nowDate = new Date()
  const start = new Date(nowDate.getFullYear(), 0, 0)
  return LITE_THOUGHTS[Math.floor((nowDate - start) / 86400000) % LITE_THOUGHTS.length]
}

// Shimmer skeleton rows - the design system's answer to "Loading…" text.
function SkeletonRows({ n = 6 }) {
  return (
    <ul className="lite-skel" aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <li key={i} className="lite-skel-row" style={{ animationDelay: `${i * 80}ms` }} />
      ))}
    </ul>
  )
}

// Simple full-width line spark - enough chart for a Lite trend read.
function LiteSpark({ points, height = 120 }) {
  if (!points || points.length < 2) return null
  const W = 600
  const H = height
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = W / (points.length - 1)
  const d = points
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(H - 6 - ((v - min) / span) * (H - 12)).toFixed(1)}`)
    .join('')
  const up = points[points.length - 1] >= points[0]
  return (
    <svg className={`lite-spark ${up ? 'up' : 'down'}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }} aria-hidden>
      <path d={d} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// The lite→pro escalation: every view ends with a door into its PRO twin.
function ProLink({ label, path, onOpenPath }) {
  const { t } = useTranslation()
  if (!onOpenPath) return null
  return (
    <button type="button" className="lite-prolink" onClick={() => { track(Events.LITE_PRO_DOOR, { path }); onOpenPath(path) }}>
      {typeof label === 'string' ? tl(t, label, 'msg') : label}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
    </button>
  )
}

function TokenRow({ image, symbol, name, price, change, change7d, marketCap, fmtPrice, fmtLargeShort, starred, onToggleStar, onOpen, rank }) {
  return (
    <li className={`lite-trow${onOpen ? ' lite-trow--link' : ''}`} onClick={onOpen || undefined} onKeyDown={onOpen ? (e) => { if (e.key === 'Enter') onOpen() } : undefined} tabIndex={onOpen ? 0 : undefined} role={onOpen ? 'button' : undefined}>
      {rank != null && <span className="lite-trow-rank">{rank}</span>}
      <span className="lite-trow-logo">
        {image ? <img src={image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }} /> : null}
        <span className="lite-trow-fallback" style={image ? { display: 'none' } : undefined}>{(symbol || '?')[0]}</span>
      </span>
      <span className="lite-trow-id">
        <strong>{name || symbol}</strong>
        <em>{symbol}</em>
      </span>
      {marketCap > 0 && <span className="lite-trow-mcap">{fmtLargeShort(marketCap)}</span>}
      <span className="lite-trow-price">{price != null ? fmtPrice(price) : '-'}</span>
      <span className={`lite-trow-change ${changeCls(change)}`}>{price != null ? fmtChange(change) : ''}</span>
      {Number.isFinite(Number(change7d)) && change7d !== null && (
        <span className={`lite-trow-change7 ${changeCls(change7d)}`}>
          {fmtChange(change7d)}<em>7d</em>
        </span>
      )}
      <StarButton sym={symbol} starred={starred} onToggle={onToggleStar} />
    </li>
  )
}

// Two-column token list that reads TOP-DOWN (column-major): ranks 1..N/2 fill
// the left column, the rest fill the right - "BTC 1, ETH 2" stack together.
function SplitCols({ items, compact, render }) {
  const mid = Math.ceil(items.length / 2)
  const listCls = `lite-tlist${compact ? ' lite-tlist--compact' : ''}`
  return (
    <div className="lite-tsplit">
      <ul className={listCls}>{items.slice(0, mid).map((item, i) => render(item, i))}</ul>
      <ul className={listCls}>{items.slice(mid).map((item, i) => render(item, mid + i))}</ul>
    </div>
  )
}

// Lazy board sources (Today top-coins board + Predictions view share these).
// Session caches go stale in a long-lived tab ("wallets seem stale") - every
// lane carries a TTL: the stale copy still seeds the first paint, then the
// effect re-fetches in the background and swaps fresh data in.
const _fresh = (entry, ttl) => (entry && Date.now() - entry.ts < ttl ? entry.data : null)
const LIVE_TTL = 4 * 60 * 1000
const ODDS_TTL = 10 * 60 * 1000
const HIST_TTL = 60 * 60 * 1000

let _trendCache = null

function loadTrending() {
  const cached = _fresh(_trendCache, LIVE_TTL)
  if (cached) return Promise.resolve(cached)
  return import('@/services/codexApi')
    .then(({ getTrendingTokens }) => getTrendingTokens())
    .then((payload) => {
      const results = payload?.filterTokens?.results || []
      const rows = results
        .map((r, i) => ({
          id: r?.token?.address || `trend-${i}`,
          symbol: String(r?.token?.symbol || '').toUpperCase(),
          name: r?.token?.name || String(r?.token?.symbol || '').toUpperCase(),
          image: r?.token?.info?.imageThumbUrl || r?.token?.info?.imageSmallUrl || null,
          address: r?.token?.address || '',
          // Both trending lanes carry the chain, and the chart needs it: a BSC or
          // Base contract charted against Ethereum (the downstream `|| 1`
          // default) queries the wrong chain and comes back with no candles.
          networkId: r?.token?.networkId,
          price: parseFloat(r?.priceUSD) || null,
          change: parseFloat(r?.change24) || 0,
          marketCap: parseFloat(r?.marketCap) || null,
        }))
        .filter((r) => r.symbol && r.price != null)
        .slice(0, 20)
      if (rows.length > 0) _trendCache = { ts: Date.now(), data: rows }
      return rows
    })
    .catch(() => null)
}

let _predictionsCache = null

function loadPredictions() {
  const cached = _fresh(_predictionsCache, ODDS_TTL)
  if (cached) return Promise.resolve(cached)
  return import('@/services/polymarketApi')
    .then(({ getPredictionMarkets }) => getPredictionMarkets('all', 30))
    .then((rows) => {
      if (!Array.isArray(rows)) return null
      const top = rows.filter((r) => r.question && Number.isFinite(r.yesPct)).slice(0, 8)
      if (top.length > 0) _predictionsCache = { ts: Date.now(), data: top }
      return top
    })
    .catch(() => null)
}

// Small coin logo with letter fallback - the mini-row companion to the
// TokenRow logo (Sunny: "many subpages miss logos").
function CoinDot({ src, sym }) {
  return (
    <span className="lite-coindot">
      {src ? <img src={src} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = 'flex' }} /> : null}
      <span className="lite-coindot-fb" style={src ? { display: 'none' } : undefined}>{(sym || '?')[0]}</span>
    </span>
  )
}

// DexScreener token-logo CDN (the PRO wallets board pattern) - covers the
// small caps the top-40 board never carries. Letter fallback on 404.
function dexLogo(chain, contract) {
  if (!chain || !contract) return null
  return `https://dd.dexscreener.com/ds-data/tokens/${chain}/${contract}.png?size=lg`
}

function Meter({ value, altTrack }) {
  return (
    <div className={`lite-meter${altTrack ? ' lite-meter--alt' : ''}`} aria-hidden>
      <span className="lite-meter-dot" style={{ left: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  )
}

// Watchlist star - filled when the coin is on the active list.
function StarButton({ starred, onToggle, sym }) {
  if (!onToggle) return null
  return (
    <button
      type="button"
      className={`lite-star${starred ? ' on' : ''}`}
      aria-label={starred ? `Remove ${sym} from watchlist` : `Add ${sym} to watchlist`}
      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
      onClick={(e) => { e.stopPropagation(); onToggle() }}
    >
      <svg viewBox="0 0 24 24" fill={starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9L12 3z" />
      </svg>
    </button>
  )
}

// Coin search - debounced, dropdown results with star + jump-to-Research.
function LiteSearch({ wl, onPick, market }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) { setHits(null); return undefined }
    let cancelled = false
    const timer = setTimeout(() => {
      if (market === 'stocks') {
        searchStocks(query)
          .then((res) => {
            if (cancelled) return
            const rows = (Array.isArray(res) ? res : [])
              .filter((r) => r?.symbol)
              .slice(0, 7)
              .map((r) => ({ symbol: String(r.symbol).toUpperCase(), name: r.name || r.shortname || r.longname || r.symbol, image: getStockLogoUrl(String(r.symbol).toUpperCase()), isStock: true }))
            setHits(rows)
          })
          .catch(() => { if (!cancelled) setHits([]) })
        return
      }
      getSpectreSearch(query, 20)
        .then((res) => {
          if (cancelled) return
          // The v1 search substring-matches names and can surface rank-14k
          // clone junk above the real coin (a clone can even carry the EXACT
          // symbol "SOLANA") - re-rank client-side: established coins
          // (rank<=500) always beat the long tail, then match tier, then rank.
          const ql = query.toLowerCase()
          const scored = (res?.coins || []).map((c) => {
            const symL = String(c.symbol || '').toLowerCase()
            const nameL = String(c.name || '').toLowerCase()
            const rank = c.rank > 0 ? c.rank : 999999
            const tier = symL === ql || nameL === ql ? 0 : (symL.startsWith(ql) || nameL.startsWith(ql)) ? 1 : 2
            return { c, bucket: rank <= 500 ? 0 : 1, tier, rank }
          })
          scored.sort((a, b) => a.bucket - b.bucket || a.tier - b.tier || a.rank - b.rank)
          setHits(scored.slice(0, 7).map((s) => s.c))
        })
        .catch(() => { if (!cancelled) setHits([]) })
    }, 280)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [q])

  return (
    <div className="lite-search">
      <svg className="lite-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
      <input
        type="text"
        className="lite-search-input"
        placeholder={t('lite.litesearch.placeholderSearchAnyCoin', "Search any coin…")}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        aria-label={t('lite.litesearch.ariaSearchCoins', "Search coins")}
      />
      {open && hits && (
        <div className="lite-search-drop">
          {hits.length === 0 ? (
            <p className="lite-empty">Nothing matches "{q.trim()}".</p>
          ) : hits.map((c) => {
            const sym = String(c.symbol || '').toUpperCase()
            const starred = wl?.has ? wl.has(sym) : false
            return (
              <div key={c.coingecko_id || sym} className="lite-search-row" role="button" tabIndex={0}
                onMouseDown={(e) => { e.preventDefault(); onPick?.(sym, { stock: !!c.isStock }); setQ(''); setHits(null); setOpen(false) }}>
                <span className="lite-trow-logo">
                  {c.image ? <img src={c.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : null}
                </span>
                <span className="lite-trow-id"><strong>{c.name || sym}</strong><em>{sym}</em></span>
                {c.rank > 0 && <span className="lite-search-rank">#{c.rank}</span>}
                <StarButton
                  sym={sym}
                  starred={starred}
                  onToggle={wl ? () => (starred ? wl.remove(sym) : wl.add(c.isStock ? { symbol: sym, name: c.name || sym, isStock: true, assetClass: 'stock' } : { symbol: sym, name: c.name || sym })) : null}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Section head with a "See all" jump into the matching LITE tab.
function BlockHead({ label, viewId, onNav }) {
  const { t } = useTranslation()
  return (
    <div className="lite-block-head">
      <p className="lite-eyebrow">{tl(t, label, 'lbl')}</p>
      {onNav && (
        <button type="button" className="lite-seeall" onClick={() => onNav(viewId)}>
          {t('lite.seeAll', 'See all')}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
        </button>
      )}
    </div>
  )
}

// Left-to-right top-coins strip (the landing's ticker rail).
// Native overflow-x only responds to horizontal input (trackpad swipe, arrow
// keys) - mouse wheels emit vertical deltas and drags do nothing, so the rail
// read as "not scrolling". Two additions: wheel deltaY -> scrollLeft (native
// listener; React's onWheel is passive so preventDefault would be ignored),
// and mouse drag-to-scroll with a click suppressor so a drag never fires the
// card's research navigation.
function CoinStrip({ rows, fmtPrice, onPick }) {
  const railRef = useRef(null)
  const dragRef = useRef({ active: false, moved: false, startX: 0, startLeft: 0 })

  useEffect(() => {
    const el = railRef.current
    if (!el) return
    const onWheel = (e) => {
      if (el.scrollWidth <= el.clientWidth) return
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return // horizontal intent - native path
      const before = el.scrollLeft
      el.scrollLeft = before + e.deltaY
      // Only swallow the event when the rail actually moved - at either end
      // the wheel falls through to normal page scroll.
      if (el.scrollLeft !== before) e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onPointerDown = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return // touch scrolls natively
    const el = railRef.current
    if (!el || el.scrollWidth <= el.clientWidth) return
    dragRef.current = { active: true, moved: false, startX: e.clientX, startLeft: el.scrollLeft }
  }
  const onPointerMove = (e) => {
    const d = dragRef.current
    const el = railRef.current
    if (!d.active || !el) return
    const dx = e.clientX - d.startX
    if (!d.moved && Math.abs(dx) < 5) return
    if (!d.moved) { d.moved = true; el.setPointerCapture?.(e.pointerId) }
    el.scrollLeft = d.startLeft - dx
  }
  const endDrag = () => { dragRef.current.active = false }
  const onClickCapture = (e) => {
    if (dragRef.current.moved) {
      dragRef.current.moved = false
      e.stopPropagation()
      e.preventDefault()
    }
  }

  return (
    <div className="lite-strip" role="list" ref={railRef}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={endDrag} onPointerCancel={endDrag}
      onClickCapture={onClickCapture}>
      {rows.map((r) => (
        <div key={r.id} className="lite-strip-card" role="listitem" tabIndex={0} onClick={() => onPick?.(r.symbol)}
          onKeyDown={(e) => { if (e.key === 'Enter') onPick?.(r.symbol) }}>
          <span className="lite-strip-logo">
            {r.image ? <img src={r.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : null}
          </span>
          <span className="lite-strip-body">
            <span className="lite-strip-sym">{r.symbol}</span>
            <span className="lite-strip-price">{r.price != null ? fmtPrice(r.price) : '-'}</span>
          </span>
          <span className={`lite-strip-change ${changeCls(r.change)}`}>{fmtChange(r.change)}</span>
        </div>
      ))}
    </div>
  )
}

// Compact bubbles for the Today block (Heatmap <-> Bubbles toggle) - same
// mcap-packed layout as the Bubbles page, small stage, price + % readable.
function MiniBubbles({ rows, fmtPrice, onPick }) {
  const [stage] = useState(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
    return vw <= 768 ? { w: Math.max(280, vw - 76), h: 300 } : { w: 620, h: 330 }
  })
  const bubbles = useMemo(() => layoutBubbles(rows, stage.w, stage.h), [rows, stage])
  return (
    <div className="lite-minibubbles">
      <div className="lite-minibubbles-stage" style={{ width: stage.w, height: stage.h }}>
        {bubbles.map(({ row, x, y, size }) => {
          const chg = Number(row.change) || 0
          const alpha = Math.min(0.9, 0.38 + Math.abs(chg) / 7)
          return (
            <div
              key={row.id}
              className="lite-bubble lite-bubble--link"
              role="button"
              tabIndex={0}
              onClick={() => onPick?.(row.symbol)}
              onKeyDown={(e) => { if (e.key === 'Enter') onPick?.(row.symbol) }}
              style={{
                width: size,
                height: size,
                left: x - size / 2,
                top: y - size / 2,
                '--hrgb': chg >= 0 ? '16 185 129' : '239 68 68',
                '--ha': alpha,
                '--hap': Math.min(0.95, alpha + 0.3),
              }}
            >
              <span className="lite-bubble-sym" style={{ fontSize: Math.max(9, Math.min(22, size * 0.2)) }}>{row.symbol}</span>
              {size >= 68 && row.price != null && <span className="lite-bubble-price" style={{ fontSize: Math.max(9, Math.min(13, size * 0.12)) }}>{fmtPrice(row.price)}</span>}
              {size >= 40 && <span className="lite-bubble-chg" style={{ fontSize: Math.max(8, Math.min(12, size * 0.11)) }}>{fmtChange(chg)}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Views ──

// ── TradingView mini charts (opt-in Today widgets + Alt Rotation indexes) ──
// Plain widgetembed iframes: zero JS on our bundle, the frame loads lazily
// from TradingView's edge - the "ultra fast" path. Same recipe PRO's
// alt-rotation chart card uses.
const LITE_TV_TF = [{ k: '60', label: '4H' }, { k: '240', label: '1D' }, { k: 'D', label: '1W' }, { k: 'W', label: '1M' }]

// Chart modes. Founder 2026-08-28: the widgets were "black on blue" — style 3
// is TradingView's AREA, whose series is their brand blue (#2962FF) whatever
// theme you ask for. MEASURED the alternatives in a browser: the series colour
// is NOT settable from the widgetembed URL (upColor/downColor/lineColor are all
// ignored), so the fix is choosing styles that are price-coloured by default.
//   1  candles  — red/green bodies, no blue anywhere
//   10 baseline — green above / red below with a gradient fill; the calm
//                 at-a-glance read that AREA was supposed to be
// Line (2) and area (3) are both blue/purple and are deliberately not offered.
// Bull/bear colour on a price series is exactly what the design system reserves
// it for, so both modes are on-brand.
const LITE_TV_STYLES = [
  { k: 'candles', tv: '1', label: 'Candles' },
  { k: 'baseline', tv: '10', label: 'Trend' },
]
const tvStyleCode = (k) => (LITE_TV_STYLES.find((o) => o.k === k) || LITE_TV_STYLES[0]).tv

function liteTvSrc(symbol, interval, light, chartStyle) {
  const p = new URLSearchParams({
    frameElementId: 'lite_tv', symbol, interval, theme: light ? 'light' : 'dark', style: tvStyleCode(chartStyle),
    hide_top_toolbar: '1', hide_side_toolbar: '1', hide_legend: '1',
    // Volume bars read as red/green noise at widget size.
    // 🪤 The old comment here claimed the frame is TRANSPARENT so the chart
    // sits on Lite's glass. MEASURED 2026-08-28 over a bright page: it is not.
    // TradingView's dark theme paints its own opaque plot background and
    // ignores backgroundColor in every form (rgba(0,0,0,0), #00000000, and
    // omitting it entirely all render identically). Same finding as the PRO
    // theme work. The plot is therefore framed as a deliberate dark media card
    // (see .lite-tv-wrap) rather than pretended to be glass.
    hide_volume: '1', hidevolume: '1',
    allow_symbol_change: '0', save_image: '0', withdateranges: '0',
    backgroundColor: 'rgba(0,0,0,0)',
    gridColor: light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)',
  })
  return `https://s.tradingview.com/widgetembed/?${p.toString()}`
}

function LiteTvFrame({ symbol, interval, light, height, title, chartStyle }) {
  return (
    <div className="lite-tv-wrap" style={height ? { height } : undefined}>
      <iframe
        // chartStyle is in the key: the embed reads `style` once at load, so a
        // mode switch has to remount the frame or nothing changes.
        key={`${symbol}-${interval}-${light ? 'l' : 'd'}-${chartStyle || 'candles'}`}
        className="lite-tv"
        src={liteTvSrc(symbol, interval, light, chartStyle)}
        title={title || symbol}
        frameBorder="0"
        scrolling="no"
        loading="lazy"
        allowtransparency="true"
      />
    </div>
  )
}

// Mini-fullscreen chart: a centered modal card, not edge-to-edge - with its
// own symbol toggles + timeframes, so you can flip BTC→ETH without leaving.
// Portaled to <body>: Lite's rise animations leave transforms on every
// section, so a fixed overlay inside them would anchor to the panel, not the
// viewport (the documented containing-block trap). Every class here is
// UNscoped for the same reason.
function LiteTvFullOverlay({ symbol, label, tf, setTf, light, onClose, options }) {
  const { t } = useTranslation()
  const [sym, setSym] = useState(symbol)
  const chartStyle = useSettingsStore((st) => st.liteChartStyle)
  const active = options?.find((o) => o.id === sym)
  useEffect(() => {
    // Capture phase + stopPropagation: Lite's own window Esc handler exits to
    // PRO - without this, closing the chart also closed the whole app.
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return createPortal(
    <div className="lite-tvfull" role="dialog" aria-modal="true" aria-label={active?.label || label} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`lite-tvfull-card${light ? ' lite-tvfull-card--light' : ''}`}>
        <div className="lite-tvfull-head">
          <strong>{active?.label || label}</strong>
          <button type="button" className="lite-tvfull-close" onClick={onClose} aria-label={t('lite.litetvfulloverlay.ariaCloseChart', "Close chart")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="lite-tvfull-tools">
          {options?.length > 1 && (
            <div className="lite-tvfull-seg" role="tablist" aria-label={t('lite.litetvfulloverlay.ariaChart', "Chart")}>
              {options.map((o) => (
                <button key={o.id} type="button" role="tab" aria-selected={sym === o.id} className={`lite-tvfull-tab${sym === o.id ? ' active' : ''}`} onClick={() => setSym(o.id)}>{o.label}</button>
              ))}
            </div>
          )}
          <div className="lite-tvfull-seg" role="tablist" aria-label={t('lite.litetvfulloverlay.ariaTimeframe', "Timeframe")}>
            {LITE_TV_TF.map((o) => (
              <button key={o.k} type="button" role="tab" aria-selected={tf === o.k} className={`lite-tvfull-tab${tf === o.k ? ' active' : ''}`} onClick={() => setTf(o.k)}>{o.label}</button>
            ))}
          </div>
        </div>
        <LiteTvFrame symbol={sym} interval={tf} light={light} title={active?.label || label} chartStyle={chartStyle} />
      </div>
    </div>,
    document.body,
  )
}

function TvExpandButton({ onClick }) {
  const { t } = useTranslation()
  return (
    <button type="button" className="lite-tv-expand" onClick={onClick} aria-label={t('lite.tvexpandbutton.ariaFullscreenChart', "Fullscreen chart")}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
    </button>
  )
}

// One opt-in Today widget = one symbol, timeframe pills, expand-to-fullscreen.
function LiteTvPanel({ panelKey, symbol, label, light }) {
  const { t } = useTranslation()
  const [tf, setTf] = useState('240')
  const [full, setFull] = useState(false)
  const chartStyle = useSettingsStore((st) => st.liteChartStyle)
  const setChartStyle = useSettingsStore((st) => st.setLiteChartStyle)
  return (
    <section key={panelKey} className="lite-panel lite-tvpanel lite-span-6">
      <div className="lite-block-head">
        <p className="lite-eyebrow">{label}</p>
        <div className="lite-block-tools">
          <div className="lite-tf-toggle lite-tf-toggle--sm" role="tablist" aria-label={t('lite.litetvpanel.ariaChartMode', "Chart mode")}>
            {LITE_TV_STYLES.map((o) => (
              <button key={o.k} type="button" role="tab" aria-selected={chartStyle === o.k} className={`lite-tf-btn${chartStyle === o.k ? ' active' : ''}`} onClick={() => setChartStyle(o.k)}>{o.label}</button>
            ))}
          </div>
          <div className="lite-tf-toggle lite-tf-toggle--sm" role="tablist" aria-label={t('lite.litetvpanel.ariaTimeframe', "Timeframe")}>
            {LITE_TV_TF.map((o) => (
              <button key={o.k} type="button" role="tab" aria-selected={tf === o.k} className={`lite-tf-btn${tf === o.k ? ' active' : ''}`} onClick={() => setTf(o.k)}>{o.label}</button>
            ))}
          </div>
          <TvExpandButton onClick={() => setFull(true)} />
        </div>
      </div>
      <LiteTvFrame symbol={symbol} interval={tf} light={light} title={label} chartStyle={chartStyle} />
      {full && (
        <LiteTvFullOverlay
          symbol={symbol}
          label={label}
          tf={tf}
          setTf={setTf}
          light={light}
          onClose={() => setFull(false)}
          options={TV_PANEL_DEFS.map((d) => ({ id: d.symbol, label: d.label }))}
        />
      )}
    </section>
  )
}

const TV_PANEL_DEFS = [
  { key: 'chartBtc', label: 'BTC chart', symbol: 'BINANCE:BTCUSDT' },
  { key: 'chartEth', label: 'ETH chart', symbol: 'BINANCE:ETHUSDT' },
  { key: 'chartSol', label: 'SOL chart', symbol: 'BINANCE:SOLUSDT' },
  { key: 'chartTotal', label: 'Total market cap', symbol: 'CRYPTOCAP:TOTAL' },
  { key: 'chartEthBtc', label: 'ETH / BTC', symbol: 'BINANCE:ETHBTC' },
]

const PANEL_DEFS = [
  { key: 'strip', label: 'Coin rail' },
  { key: 'topcoins', label: 'Top coins board' },
  { key: 'brief', label: 'Market brief' },
  { key: 'next48', label: 'Next 48 hours' },
  { key: 'sentiment', label: 'Sentiment' },
  { key: 'etf', label: 'ETF Flows' },
  ...TV_PANEL_DEFS,
  { key: 'viz', label: 'Heatmap / Bubbles' },
  { key: 'social', label: 'Crypto X' },
  { key: 'watchlist', label: 'Watchlist' },
  { key: 'movers', label: 'Movers' },
  { key: 'news', label: 'News' },
  { key: 'deskbrief', label: 'Desk brief' },
  { key: 'inteldesk', label: 'Intel Desk' },
  { key: 'thought', label: 'Daily thought' },
]

const PANEL_LABELS = Object.fromEntries(PANEL_DEFS.map((d) => [d.key, d.label]))

// Opt-in panels are OFF by default — they only render once the user adds them
// from the Edit popover (undefined stays hidden; other panels show unless === false).
const OPT_IN_PANELS = new Set(['etf', ...TV_PANEL_DEFS.map((d) => d.key)])
const panelOn = (panels, key) => (OPT_IN_PANELS.has(key) ? panels?.[key] === true : panels?.[key] !== false)

// Grid panels the user can reorder (rail + thought stay pinned).
// Founder call 2026-08-28: News belongs near the top — it was second-to-last,
// below five opt-in charts — and Intel Desk sits directly under it. The two are
// a pair: the wires, then what the desk made of them.
const DEFAULT_TODAY_ORDER = ['brief', 'sentiment', 'deskbrief', 'news', 'inteldesk', 'next48', 'etf', 'chartBtc', 'chartEth', 'chartSol', 'chartTotal', 'chartEthBtc', 'viz', 'social', 'watchlist', 'movers', 'topcoins']

function resolveTodayOrder(saved) {
  const base = Array.isArray(saved) ? saved.filter((k) => DEFAULT_TODAY_ORDER.includes(k)) : []
  if (!base.length) return [...DEFAULT_TODAY_ORDER]
  // A panel added after a user saved their layout used to be appended at the
  // END, which put a section meant to sit under News at the bottom of the page
  // for everyone who had ever touched the Edit popover — i.e. the people most
  // likely to notice. Splice each new key in after the nearest default
  // neighbour they already have, so the intended adjacency survives a custom
  // order. Walking DEFAULT order means several new keys chain correctly.
  const out = [...base]
  DEFAULT_TODAY_ORDER.forEach((key, i) => {
    if (out.includes(key)) return
    let anchor = -1
    for (let j = i - 1; j >= 0; j -= 1) {
      const at = out.indexOf(DEFAULT_TODAY_ORDER[j])
      if (at >= 0) { anchor = at; break }
    }
    out.splice(anchor + 1, 0, key)
  })
  return out
}

const BOARD_SOURCES = [
  { id: 'market', label: 'Market' },
  { id: 'onchain', label: 'Onchain' },
  { id: 'social', label: 'Social' },
  { id: 'predict', label: 'Predictions' },
]

// ── ETF Flows mini-widget (opt-in Today panel — added from Edit) ──
const ETF_RANGES = [{ k: 7, l: '7D' }, { k: 30, l: '30D' }, { k: 90, l: '90D' }, { k: 999, l: '6M' }]
function LiteEtfMiniChart({ series, resetKey, height = 96 }) {
  const scRef = useRef(null)
  const pts = series || []
  // jump to the latest (right edge) when the asset/timeframe changes — but not
  // on every poll, so the user can scroll back through history freely.
  useEffect(() => {
    const el = scRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [resetKey])
  if (pts.length < 2) return <div className="lite-etf-chart" style={{ height }}><div className="lite-etf-scroll" /></div>
  const H = height, mid = H / 2, BAR = 9, GAP = 3
  const flows = pts.map((d) => Number(d.flowUsd) || 0)
  const maxA = Math.max(1, ...flows.map((f) => Math.abs(f)))
  const innerW = Math.max(pts.length * (BAR + GAP), 40)
  return (
    <div className="lite-etf-chart spectre-wm-host">
    <div className="lite-etf-scroll" ref={scRef}>
      <svg className="lite-etf-spark" width={innerW} height={H} viewBox={`0 0 ${innerW} ${H}`} aria-hidden>
        <line x1="0" y1={mid} x2={innerW} y2={mid} className="lite-etf-spark-zero" />
        {pts.map((d, i) => {
          const f = flows[i]
          const h = Math.max(1.5, (Math.abs(f) / maxA) * (mid - 5))
          return <rect key={i} x={i * (BAR + GAP)} y={f >= 0 ? mid - h : mid} width={BAR} height={h} rx="1.5" className={f >= 0 ? 'up' : 'down'} />
        })}
      </svg>
    </div>
    {/* Beta report (ChainROI, 08-19): a cropped flow picture should still say
        who made it — the chart carries the mark, not just the page around it. */}
    <ChartWatermark padX={8} padY={6} />
    </div>
  )
}

function LiteEtfPanel() {
  const { t } = useTranslation()
  const { data, loading } = useEtfFlows()
  const [asset, setAsset] = useState('BTC')
  const [range, setRange] = useState(90)
  const s = data?.summary
  const slug = asset === 'ETH' ? 'eth' : 'btc'
  const full = data?.charts?.[asset] || []
  const series = range >= 999 ? full : full.slice(-range)
  const dcls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : '')
  return (
    <section key="etf" className="lite-panel lite-etf lite-span-6">
      <div className="lite-block-head">
        <p className="lite-eyebrow">{t('lite.panel.etf', 'ETF Flows')}</p>
        <div className="lite-block-head-right">
          <div className="lite-tf-toggle lite-tf-toggle--sm" role="tablist" aria-label={t('lite.liteetfpanel.ariaEtfAsset', "ETF asset")}>
            {['BTC', 'ETH'].map((a) => (
              <button key={a} type="button" role="tab" aria-selected={asset === a} className={`lite-tf-btn${asset === a ? ' active' : ''}`} onClick={() => setAsset(a)}>{a}</button>
            ))}
          </div>
          <LiteEtfShare data={data} asset={asset} />
        </div>
      </div>
      {loading && !s ? (
        <div className="lite-etf-skel" />
      ) : !s ? (
        <p className="lite-empty">{tl(t, 'Warming up', 'msg')}</p>
      ) : (
        <>
          <div className="lite-etf-tfrow" role="tablist" aria-label={t('lite.liteetfpanel.ariaTimeframe', "Timeframe")}>
            {ETF_RANGES.map((r) => (
              <button key={r.k} type="button" role="tab" aria-selected={range === r.k} className={`lite-etf-tf${range === r.k ? ' active' : ''}`} onClick={() => setRange(r.k)}>{r.l}</button>
            ))}
          </div>
          <LiteEtfMiniChart series={series} resetKey={`${asset}-${range}`} />
          <div className="lite-etf-rows">
            {[{ k: 'btc', n: 'Bitcoin' }, { k: 'eth', n: 'Ethereum' }].map(({ k, n }) => {
              const tt = s?.[k]?.total || {}
              return (
                <div
                  key={k}
                  className={`lite-etf-row${slug === k ? ' active' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setAsset(k.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === 'Enter') setAsset(k.toUpperCase()) }}
                >
                  <span className="lite-etf-name">{n}</span>
                  <span className="lite-etf-cell"><em>1D</em><b className={dcls(tt.flow1dUsd)}>{litEtfUsd(tt.flow1dUsd)}</b></span>
                  <span className="lite-etf-cell"><em>7D</em><b className={dcls(tt.flow7dUsd)}>{litEtfUsd(tt.flow7dUsd)}</b></span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

// ── ETF Flows (etf-flows reflection): full tab grown from the Today widget ──
// One shared hook feeds both; summary keys are LOWERCASE (btc/eth), chart keys
// UPPERCASE (BTC/ETH) — that asymmetry is the payload's, keep it.

function TodayView({ greeting, brief, data, fmtPrice, fmtLargeShort, onNav, wl, panels, setPanel, order, setOrder, onPickResearch, look, bg, setBg, paperBg, setPaperBg, imgBySym, onCinema, musicSource, setMusicSource, musicVolume, setMusicVolume , wallpapers}) {
  const { t } = useTranslation()
  const { global, fearGreed, altSeason, movers, news, marketRows, social, socialState, watchlistEntries, watchlistPrices } = data
  const [miniViz, setMiniViz] = useState('heat')
  const [editOpen, setEditOpen] = useState(false)
  const [boardSrc, setBoardSrc] = useState('market')
  const [trendRows, setTrendRows] = useState(() => _fresh(_trendCache, LIVE_TTL))
  const [predRows, setPredRows] = useState(() => _fresh(_predictionsCache, ODDS_TTL))
  const show = (key) => panelOn(panels, key)
  const orderKeys = resolveTodayOrder(order)
  const drag = useDragReorder(orderKeys, (next) => setOrder?.(next))

  // Board extra sources load lazily, first time their tab opens.
  useEffect(() => {
    let cancelled = false
    if (boardSrc === 'onchain') loadTrending().then((rows) => { if (!cancelled && rows) setTrendRows(rows) })
    if (boardSrc === 'predict') loadPredictions().then((rows) => { if (!cancelled && rows) setPredRows(rows) })
    return () => { cancelled = true }
  }, [boardSrc])
  const fgValue = Number(fearGreed?.value ?? fearGreed?.score)
  const fgLabel = fearGreed?.classification || fearGreed?.value_classification || fearGreed?.label || ''
  const asValue = Number(altSeason?.value ?? altSeason?.index)
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const gainers = (movers?.gainers || []).slice(0, 4)
  const losers = (movers?.losers || []).slice(0, 3)

  const boardSeeAll = boardSrc === 'social' ? 'social' : boardSrc === 'predict' ? 'predictions' : 'markets'

  // Every grid panel keyed - rendered in the user's order (Edit popover arrows).
  const sections = {
    topcoins: show('topcoins') && marketRows.length > 0 && (
      <section key="topcoins" className="lite-panel lite-span-12">
        <div className="lite-block-head">
          <p className="lite-eyebrow">{tl(t, "Top coins", 'lbl')}</p>
          <div className="lite-block-tools">
            <div className="lite-tf-toggle lite-tf-toggle--sm" role="tablist" aria-label={t('lite.todayview.ariaBoardSource', "Board source")}>
              {BOARD_SOURCES.map((s) => (
                <button key={s.id} type="button" role="tab" aria-selected={boardSrc === s.id} className={`lite-tf-btn${boardSrc === s.id ? ' active' : ''}`} onClick={() => setBoardSrc(s.id)}>{tl(t, s.label)}</button>
              ))}
            </div>
            {onCinema && (() => {
              const cr = boardSrc === 'onchain' ? trendRows : boardSrc === 'market' ? marketRows : boardSrc === 'social' ? (data.social || []) : null
              return cr && cr.length > 0 ? (
                <button type="button" className="lite-cinema-icon" onClick={() => onCinema(boardSrc === 'onchain' ? tl(t, 'Trending', 'ttl') : tl(t, 'Top coins', 'lbl'), cr.slice(0, 30))} title={tl(t, 'Cinema', 'lbl')} aria-label={t('lite.todayview.ariaCinemaMode', "Cinema mode")}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M7 5v14M17 5v14M2.5 9.5h4.5M17 9.5h4.5M2.5 14.5h4.5M17 14.5h4.5" /></svg>
                </button>
              ) : null
            })()}
            <button type="button" className="lite-seeall" onClick={() => onNav?.(boardSeeAll)}>
              {t('lite.seeAll', 'See all')}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>
        </div>
        {boardSrc === 'market' && (
          <SplitCols
            compact
            items={marketRows.slice(0, 20)}
            render={(r, i) => (
              <TokenRow
                key={r.id}
                {...r}
                rank={i + 1}
                fmtPrice={fmtPrice}
                fmtLargeShort={fmtLargeShort}
                starred={wl?.has ? wl.has(r.symbol) : undefined}
                onToggleStar={wl ? () => (wl.has(r.symbol) ? wl.remove(r.symbol) : wl.add({ symbol: r.symbol, name: r.name })) : null}
                onOpen={onPickResearch ? () => onPickResearch(r.symbol) : null}
              />
            )}
          />
        )}
        {boardSrc === 'onchain' && (
          !trendRows ? <SkeletonRows n={5} /> : trendRows.length === 0 ? (
            <p className="lite-empty">{tl(t, "Onchain trending is quiet right now - check back in a bit.", 'msg')}</p>
          ) : (
            <SplitCols
              compact
              items={trendRows}
              render={(r, i) => (
                <TokenRow
                  key={r.id}
                  {...r}
                  rank={i + 1}
                  fmtPrice={fmtPrice}
                  fmtLargeShort={fmtLargeShort}
                  onOpen={() => (isTradableContract(r.address) ? openTradingTerminal(r.address) : onPickResearch?.(r.symbol))}
                />
              )}
            />
          )
        )}
        {boardSrc === 'social' && (
          social.length === 0 ? (
            socialState === 'loading' ? <SkeletonRows n={5} /> : (
              <p className="lite-empty">{tl(t, 'The social feed is rebuilding its index right now. The board comes back on its own.', 'msg')}</p>
            )
          ) : (
            <SplitCols
              compact
              items={social.slice(0, 10)}
              render={(r, i) => (
                <li key={r.id} className="lite-trow lite-trow--link" role="button" tabIndex={0} onClick={() => onPickResearch?.(r.symbol)} onKeyDown={(e) => { if (e.key === 'Enter') onPickResearch?.(r.symbol) }}>
                  <span className="lite-trow-rank">{i + 1}</span>
                  <span className="lite-trow-logo">
                    {r.image ? <img src={r.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }} /> : null}
                    <span className="lite-trow-fallback" style={r.image ? { display: 'none' } : undefined}>{(r.symbol || '?')[0]}</span>
                  </span>
                  <span className="lite-trow-id">
                    <strong>{r.name}</strong>
                    <em>{r.symbol}</em>
                  </span>
                  <span className="lite-social-stat"><strong>{Number(r.mentions).toLocaleString()}</strong><em>{tl(t, 'mentions', 'lbl')}</em></span>
                  <span className={`lite-social-delta ${r.rankChange > 0 ? 'up' : r.rankChange < 0 ? 'down' : ''}`}>
                    {r.rankChange > 0 ? `▲${r.rankChange}` : r.rankChange < 0 ? `▼${Math.abs(r.rankChange)}` : '–'}
                  </span>
                </li>
              )}
            />
          )
        )}
        {boardSrc === 'predict' && (
          !predRows ? <SkeletonRows n={4} /> : predRows.length === 0 ? (
            <p className="lite-empty">{tl(t, "No active markets right now.", 'msg')}</p>
          ) : (
            <ul className="lite-pred-list">
              {predRows.slice(0, 4).map((m) => (
                <li key={m.id} className="lite-pred-row">
                  <a href={m.url} target="_blank" rel="noopener noreferrer" className="lite-pred-link">
                    <span className="lite-pred-q">{m.question}</span>
                    <span className="lite-pred-meta">
                      {m.volume > 0 && <span>{fmtLargeShort(m.volume)} traded</span>}
                      {m.endDate && m.endDate !== '-' && <span>ends {m.endDate}</span>}
                    </span>
                    <span className="lite-pred-odds">
                      <span className="lite-pred-track" aria-hidden><span className="lite-pred-fill" style={{ width: `${m.yesPct}%` }} /></span>
                      <strong>{m.yesPct}%</strong>
                      <em>{t('lite.todayview.yes', "yes")}</em>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )
        )}
      </section>
    ),
    brief: show('brief') && brief && (
      <section key="brief" className="lite-panel lite-panel--brief lite-span-8">
        <p className="lite-eyebrow">{tl(t, "Market brief", 'lbl')}</p>
        <h2 className="lite-brief-headline">{brief.headline}</h2>
        <p className="lite-brief-body">{brief.body}</p>
      </section>
    ),
    next48: show('next48') && (
      <LiteNext48 key="next48" mode="crypto" onPickResearch={onPickResearch} />
    ),
    sentiment: show('sentiment') && (
      <section key="sentiment" className={`lite-panel lite-gauge lite-gauge--mini ${show('brief') && brief ? 'lite-span-4' : 'lite-span-12'}`}>
        <p className="lite-eyebrow">{tl(t, "Sentiment", 'lbl')}</p>
        {Number.isFinite(fgValue) ? (
          <>
            <div className="lite-gauge-hero">
              <span className="lite-gauge-value">{Math.round(fgValue)}</span>
              {fgLabel && <span className="lite-gauge-label">{tl(t, fgLabel, 'lbl')}</span>}
            </div>
            <Meter value={fgValue} />
          </>
        ) : <p className="lite-empty">-</p>}
        {Number.isFinite(asValue) && asValue > 0 && (
          <>
            <div className="lite-gauge-hero lite-gauge-hero--second">
              <span className="lite-gauge-value lite-gauge-value--sm">{Math.round(asValue)}</span>
              <span className="lite-gauge-label">{t('lite.lbl.alt_season', 'Alt Season')}{(altSeason?.label || altSeason?.season) ? ` · ${tl(t, altSeason.label || altSeason.season, 'msg')}` : ''}</span>
            </div>
            <Meter value={asValue} altTrack />
          </>
        )}
      </section>
    ),
    etf: show('etf') && <LiteEtfPanel key="etf" />,
    ...Object.fromEntries(TV_PANEL_DEFS.map((d) => [
      d.key,
      // Chart theme follows what the panel actually sits on: paper, a light
      // solid/gradient, or a bright glass backdrop all want the light chart.
      show(d.key) && <LiteTvPanel key={d.key} panelKey={d.key} symbol={d.symbol} label={d.label} light={look === 'paper' || isBrightBg(bg)} />,
    ])),
    viz: show('viz') && marketRows.length > 0 && (
      <section key="viz" className="lite-panel lite-span-6">
        <div className="lite-block-head">
          <p className="lite-eyebrow">{miniViz === 'heat' ? 'Heatmap' : 'Bubbles'}</p>
          <div className="lite-block-tools">
            <div className="lite-tf-toggle lite-tf-toggle--sm" role="tablist" aria-label={t('lite.todayview.ariaVisualization', "Visualization")}>
              <button type="button" role="tab" aria-selected={miniViz === 'heat'} className={`lite-tf-btn${miniViz === 'heat' ? ' active' : ''}`} onClick={() => setMiniViz('heat')}>{t('lite.todayview.grid', "Grid")}</button>
              <button type="button" role="tab" aria-selected={miniViz === 'bubbles'} className={`lite-tf-btn${miniViz === 'bubbles' ? ' active' : ''}`} onClick={() => setMiniViz('bubbles')}>{t("lite.tab.bubbles", "Bubbles")}</button>
            </div>
            <button type="button" className="lite-seeall" onClick={() => onNav?.(miniViz === 'heat' ? 'heatmap' : 'bubbles')}>
              {t("lite.seeAll", "See all")}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>
        </div>
        {miniViz === 'heat' ? (
          <div className="lite-heat lite-heat--mini">
            {marketRows.filter((r) => !isStableOrWrapped(r.symbol)).slice(0, 12).map((r) => {
              const chg = Number(r.change) || 0
              return (
                <div key={r.id} className="lite-heat-tile lite-heat-tile--link" style={heatStyle(chg)} role="button" tabIndex={0} onClick={() => onPickResearch?.(r.symbol)}>
                  <span className="lite-heat-sym">{r.symbol}</span>
                  {r.price != null && <span className="lite-heat-price">{fmtPrice(r.price)}</span>}
                  <span className="lite-heat-chg">{fmtChange(chg)}</span>
                </div>
              )
            })}
          </div>
        ) : (
          <MiniBubbles rows={marketRows.filter((r) => !isStableOrWrapped(r.symbol)).slice(0, 12)} fmtPrice={fmtPrice} onPick={onPickResearch} />
        )}
      </section>
    ),
    social: show('social') && social.length > 0 && (
      <section key="social" className="lite-panel lite-span-5">
        <BlockHead label={t('lite.todayview.label', "Crypto X is talking about")} viewId="social" onNav={onNav} />
        <ul className="lite-mini-list">
          {social.slice(0, 5).map((r) => (
            <li key={r.id} className="lite-mini-row lite-mini-row--link" role="button" tabIndex={0} onClick={() => onPickResearch?.(r.symbol)}>
              <span className="lite-mini-buzzrank">{r.rank}</span>
              <CoinDot src={r.image} sym={r.symbol} />
              <span className="lite-mini-sym">{r.symbol}</span>
              <span className="lite-mini-price">{t('lite.msg.n_mentions', '{{n}} mentions', { n: Number(r.mentions).toLocaleString() })}</span>
              <span className={`lite-social-delta ${r.rankChange > 0 ? 'up' : r.rankChange < 0 ? 'down' : ''}`}>
                {r.rankChange > 0 ? `▲${r.rankChange}` : r.rankChange < 0 ? `▼${Math.abs(r.rankChange)}` : '–'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    ),
    watchlist: show('watchlist') && (
      <section key="watchlist" className="lite-panel lite-span-4">
        <BlockHead label={t('lite.todayview.label2', "Your watchlist")} viewId="watchlist" onNav={onNav} />
        {watchlistEntries.length === 0 ? (
          <p className="lite-empty">{tl(t, "Star a token anywhere in Spectre and it lives here.", 'msg')}</p>
        ) : (
          <ul className="lite-mini-list lite-mini-list--scroll">
            {watchlistEntries.map((tk) => {
              const sym = (tk.symbol || '').toUpperCase()
              const p = watchlistPrices[sym]
              return (
                <li key={tk.address || sym} className="lite-mini-row lite-mini-row--link" role="button" tabIndex={0} onClick={() => onPickResearch?.(sym)}>
                  <CoinDot src={p?.image || imgBySym?.[sym]} sym={sym} />
                  <span className="lite-mini-sym">{sym}</span>
                  {p?.marketCap > 0 && <span className="lite-mini-mcap">{fmtLargeShort(p.marketCap)}</span>}
                  <span className="lite-mini-price">{p?.price != null ? fmtPrice(p.price) : '-'}</span>
                  <span className={`lite-change ${changeCls(p?.change ?? 0)}`}>{p?.price != null ? fmtChange(p.change ?? 0) : ''}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    ),
    movers: show('movers') && (
      <section key="movers" className="lite-panel lite-span-4">
        <BlockHead label={t('lite.todayview.label3', "Moving today")} viewId="movers" onNav={onNav} />
        <ul className="lite-mini-list">
          {[...gainers, ...losers].map((m) => (
            <li key={m.symbol} className="lite-mini-row lite-mini-row--link" role="button" tabIndex={0} onClick={() => onPickResearch?.(m.symbol)}>
              <CoinDot src={imgBySym?.[m.symbol]} sym={m.symbol} />
              <span className="lite-mini-sym">{m.symbol}</span>
              <span className="lite-mini-price" />
              <span className={`lite-change ${changeCls(m.change)}`}>{fmtChange(m.change)}</span>
            </li>
          ))}
        </ul>
      </section>
    ),
    deskbrief: show('deskbrief') && (
      <LiteDeskBriefCard key="deskbrief" onNav={onNav} BlockHead={BlockHead} />
    ),
    inteldesk: show('inteldesk') && (
      <LiteIntelDeskCard key="inteldesk" onNav={onNav} BlockHead={BlockHead} />
    ),
    news: show('news') && news.length > 0 && (
      <section key="news" className="lite-panel lite-span-4">
        <BlockHead label={t("lite.tab.today", "Today")} viewId="news" onNav={onNav} />
        <ul className="lite-news-list">
          {news.slice(0, 4).map((item) => (
            <li key={item.id}>
              <a href={item.wirePath || item.url} {...(item.wirePath ? {} : { target: '_blank', rel: 'noopener noreferrer' })} className="lite-news-link">
                <span className="lite-news-body">
                  <span className="lite-news-title">{item.title}</span>
                  <span className="lite-news-meta">{[item.source, liteTimeAgo(item.publishedOn, t)].filter(Boolean).join(' · ')}</span>
                </span>
                {item.image && <img className="lite-news-thumb" src={item.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />}
              </a>
            </li>
          ))}
        </ul>
      </section>
    ),
  }

  return (
    <div className="lite-view lite-view--wide lite-view--today">
      <header className="lite-today-head lite-rise">
        <h1 className="lite-greeting">{greeting}</h1>
        <div className="lite-pills">
          {/* Left of the date, per the founder: the way out of the market sits
              before the day you are trading. */}
          <LiteSerenity />
          <span className="lite-pill">{dateStr}</span>
          {global?.totalMarketCap > 0 && (
            <span className="lite-pill">
              Market {fmtLargeShort(global.totalMarketCap)}
              <span className={`lite-change ${changeCls(global.marketCapChange24h)}`}> {fmtChange(global.marketCapChange24h)}</span>
            </span>
          )}
          {global?.btcDominance > 0 && <span className="lite-pill">BTC {global.btcDominance.toFixed(1)}%</span>}
          <LiteMusic
            sourceId={musicSource}
            setSourceId={setMusicSource}
            volume={musicVolume}
            setVolume={setMusicVolume}
          />
          <div className="lite-editwrap">
            <button type="button" className="lite-pill lite-edit-btn" aria-expanded={editOpen} onClick={() => setEditOpen((o) => !o)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg>
              {t('lite.edit', 'Edit')}
            </button>
            <LiteEditPop open={editOpen} onClose={() => setEditOpen(false)} label={t('lite.todayview.label4', "Today sections")}>
                <p className="lite-editpop-title">{t('lite.sections', 'Sections')}</p>
                <div ref={drag.listRef} className="lite-editlist">
                {['strip', ...orderKeys, 'thought'].map((key) => {
                  const label = t(`lite.panel.${key}`, PANEL_LABELS[key] || key)
                  const on = panelOn(panels, key)
                  const orderable = orderKeys.includes(key)
                  return (
                    <div key={key} className={`lite-editrow${drag.dragKey === key ? ' lite-editrow--dragging' : ''}`} {...(orderable ? drag.rowProps(key) : {})}>
                      <button type="button" className="lite-editrow-main" role="switch" aria-checked={on} onClick={() => setPanel?.(key, !on)}>
                        <span>{label}</span>
                        <span className={`lite-switch${on ? ' on' : ''}`} aria-hidden><span className="lite-switch-knob" /></span>
                      </button>
                      {orderable && (
                        <button type="button" className="lite-grip" aria-label={`Drag to reorder ${label}`} {...drag.gripProps(key)}>
                          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
                        </button>
                      )}
                    </div>
                  )
                })}
                </div>
                <button
                  type="button"
                  className="lite-editrow lite-editrow--link"
                  onClick={() => {
                    setOrder?.(null)
                    PANEL_DEFS.forEach(({ key }) => { if (panels?.[key] === false) setPanel?.(key, true) })
                  }}
                >
                  <span>{t('lite.resetLayout', 'Reset layout')}</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
                </button>
                <button type="button" className="lite-editrow lite-editrow--link" onClick={() => { setEditOpen(false); onNav?.('themes') }}>
                  <span>{t('lite.themeStudio', 'Open theme studio')}</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                </button>
                {look === 'glass' && (
                  <>
                    {/* 🪤 These first shipped as 11 unlabelled 34px tiles dropped
                        into the middle of ~20 photo thumbnails. The swatches were
                        present and the founder still could not find them — an
                        unlabelled tile in a grid of tiles is not a section. Its
                        own heading, above Background, because it is the one
                        people are looking for. */}
                    <p className="lite-editpop-title">{t('lite.neonCoast', 'Neon coast')}</p>
                    <div className="lite-bg-grid">
                      {BG_NEON.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          className={`lite-bg-swatch lite-bg-swatch--fill${bg?.mode === 'neon' && bg?.scene === n.id ? ' active' : ''}`}
                          title={n.name}
                          onClick={() => setBg?.({ mode: 'neon', scene: n.id })}
                        >
                          <span className="lite-bg-swatch-fill" style={{ background: n.css }} aria-hidden />
                        </button>
                      ))}
                    </div>
                    <p className="lite-editpop-title">{t('lite.background', 'Background')}</p>
                    <div className="lite-bg-grid">
                      <button
                        type="button"
                        className={`lite-bg-swatch lite-bg-swatch--mix${(!bg || bg.mode === 'mix') ? ' active' : ''}`}
                        title={t('lite.todayview.title', "Daily mix")}
                        onClick={() => setBg?.({ mode: 'mix' })}
                      >{t('lite.todayview.mix', "Mix")}</button>
                      {BG_SCENES.map((sc) => (
                        <button
                          key={sc.id}
                          type="button"
                          className={`lite-bg-swatch${bg?.mode === 'scene' && bg.scene === sc.id ? ' active' : ''}`}
                          title={sc.name}
                          onClick={() => setBg?.({ mode: 'scene', scene: sc.id })}
                        >
                          <img src={`https://images.unsplash.com/${sc.photo}?w=120&q=60&auto=format&fit=crop`} alt={sc.name} loading="lazy" />
                        </button>
                      ))}
                    </div>
                    {/* 🪤 This popover carried a SINGLE "Upload your own" tile
                        that overwrote the previous image every time and kept no
                        history, so a user who wanted a SET could only ever have
                        the last one. The remembered set belongs on every
                        surface, not just the Themes page. */}
                    <p className="lite-editpop-title">{t('lite.yourWallpapers', 'Your wallpapers')}</p>
                    <div className="lite-bg-grid">
                      {(wallpapers?.items || []).map((w) => (
                        <button
                          key={w.id}
                          type="button"
                          className={`lite-bg-swatch${bg?.mode === 'wall' && bg?.scene === w.id ? ' active' : ''}`}
                          title={w.name}
                          onClick={() => setBg?.({ mode: 'wall', scene: w.id })}
                        >
                          <img src={w.url} alt={w.name} loading="lazy" />
                        </button>
                      ))}
                      <label className="lite-bg-swatch lite-bg-swatch--upload" title={t('lite.todayview.title2', "Add wallpapers")}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M6 10l6-6 6 6M4 20h16" /></svg>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={async (e) => {
                            const files = [...(e.target.files || [])]
                            e.target.value = ''
                            for (const f of files) await wallpapers?.add(f)
                          }}
                        />
                      </label>
                    </div>
                  </>
                )}
                {look === 'paper' && (
                  <>
                    <p className="lite-editpop-title">{t('lite.neonCoast', 'Neon coast')}</p>
                    <div className="lite-bg-grid">
                      {BG_PAPER_NEON.map((w) => (
                        <button
                          key={w.id}
                          type="button"
                          className={`lite-bg-swatch lite-bg-swatch--fill${paperBg === w.id ? ' active' : ''}`}
                          title={w.name}
                          onClick={() => setPaperBg?.(w.id)}
                        >
                          <span className="lite-bg-swatch-fill" style={{ background: w.css }} aria-hidden />
                        </button>
                      ))}
                    </div>
                    <p className="lite-editpop-title">{t('lite.canvas', 'Canvas')}</p>
                    <div className="lite-bg-grid">
                      {[...BG_PAPER, ...BG_PAPER_PATTERNS].map((w) => (
                        <button
                          key={w.id}
                          type="button"
                          className={`lite-bg-swatch lite-bg-swatch--fill${(paperBg || 'pearl') === w.id ? ' active' : ''}`}
                          title={w.name}
                          onClick={() => setPaperBg?.(w.id)}
                        >
                          <span className="lite-bg-swatch-fill" style={{ background: w.css }} aria-hidden />
                        </button>
                      ))}
                    </div>
                  </>
                )}
            </LiteEditPop>
          </div>
        </div>
      </header>

      <div className="lite-rise lite-search-wrap">
        <LiteSearch wl={wl} onPick={onPickResearch} />
      </div>

      {show('strip') && marketRows.length > 0 && (
        <div className="lite-rise-1">
          <CoinStrip rows={marketRows.filter((r) => !isStableOrWrapped(r.symbol)).slice(0, 16)} fmtPrice={fmtPrice} onPick={onPickResearch} />
        </div>
      )}

      <div className="lite-grid lite-rise-1">
        {orderKeys.map((k) => sections[k] || null)}
      </div>

      {show('thought') && <p className="lite-thought lite-rise-3">“{liteDailyThought()}”</p>}
    </div>
  )
}

// Derivatives pulse - lazy, module-cached (3 upstream calls behind one
// cached bundle; only paid when the Markets view opens).
let _derivCache = null

const MARKET_SORTS = [
  { id: 'rank', label: 'Rank' },
  { id: 'change', label: '24h' },
  { id: 'change7d', label: '7d' },
]

function MarketsView({ data, fmtPrice, fmtLargeShort, onOpenPath, wl, onPickResearch, onCinema }) {
  const { t } = useTranslation()
  const { marketRows, global } = data
  const [deriv, setDeriv] = useState(() => _fresh(_derivCache, LIVE_TTL))
  const [sort, setSort] = useState('rank')
  const [count, setCount] = useState(20)

  const sortedRows = useMemo(() => {
    const rows = marketRows.slice(0, count)
    if (sort === 'change') return [...rows].sort((a, b) => (Number(b.change) || 0) - (Number(a.change) || 0))
    if (sort === 'change7d') return [...rows].sort((a, b) => (Number(b.change7d) || 0) - (Number(a.change7d) || 0))
    return rows
  }, [marketRows, sort, count])

  useEffect(() => {
    if (_fresh(_derivCache, LIVE_TTL)) return undefined
    let cancelled = false
    import('@/services/spectreMarketApi')
      .then(({ getSpectreIntelDerivBundle }) => getSpectreIntelDerivBundle())
      .then((bundle) => {
        if (cancelled || !bundle) return
        _derivCache = { ts: Date.now(), data: bundle }
        setDeriv(bundle)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const longs = Number(deriv?.longShortRatio?.longs)
  const fundingBtc = Number(deriv?.fundingRates?.btc)
  // Open interest arrives COIN-denominated (332K BTC, not $332K) - convert to
  // USD with the live prices the hook already holds.
  const btcPrice = Number(data.coinPrices?.BTC?.price ?? data.coinPrices?.BTC?.priceUSD)
  const ethPrice = Number(data.coinPrices?.ETH?.price ?? data.coinPrices?.ETH?.priceUSD)
  const oiBtc = Number(deriv?.openInterest?.btc) * (btcPrice > 0 ? btcPrice : 0)
  const oiEth = Number(deriv?.openInterest?.eth) * (ethPrice > 0 ? ethPrice : 0)

  return (
    <div className="lite-view lite-view--wide">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Markets', 'ttl')}</h1>
        {global?.totalMarketCap > 0 && (
          <p className="lite-view-sub">
            The whole crypto market is worth {fmtLargeShort(global.totalMarketCap)},{' '}
            <span className={`lite-change ${changeCls(global.marketCapChange24h)}`}>{fmtChange(global.marketCapChange24h)}</span> over the last day.
          </p>
        )}
        {onCinema && marketRows.length > 0 && <CinemaButton label={tl(t, 'Cinema', 'lbl')} onClick={() => onCinema(tl(t, 'Trending', 'ttl'), sortedRows)} />}
      </header>

      {global?.totalMarketCap > 0 && (
        <div className="lite-statband lite-rise-1">
          <div className="lite-stat">
            <em>{tl(t, "Market cap", 'lbl')}</em>
            <strong>{fmtLargeShort(global.totalMarketCap)}</strong>
            <span className={`lite-change ${changeCls(global.marketCapChange24h)}`}>{fmtChange(global.marketCapChange24h)}</span>
          </div>
          {global.totalVolume > 0 && (
            <div className="lite-stat">
              <em>{tl(t, "Traded today", 'lbl')}</em>
              <strong>{fmtLargeShort(global.totalVolume)}</strong>
              <span>24h volume</span>
            </div>
          )}
          {global.btcDominance > 0 && (
            <div className="lite-stat">
              <em>{tl(t, "Bitcoin share", 'lbl')}</em>
              <strong>{global.btcDominance.toFixed(1)}%</strong>
              <span>{tl(t, "of the whole market", 'msg')}</span>
            </div>
          )}
          {global.ethDominance > 0 && (
            <div className="lite-stat">
              <em>{tl(t, "Ethereum share", 'lbl')}</em>
              <strong>{global.ethDominance.toFixed(1)}%</strong>
              <span>{tl(t, "of the whole market", 'msg')}</span>
            </div>
          )}
        </div>
      )}

      {deriv && (Number.isFinite(longs) || oiBtc > 0) && (
        <section className="lite-panel lite-deriv lite-rise-1">
          <p className="lite-eyebrow">{tl(t, "Derivatives pulse", 'lbl')}</p>
          <div className="lite-deriv-grid">
            {Number.isFinite(fundingBtc) && fundingBtc !== 0 && (
              <div className="lite-deriv-item">
                <em>{tl(t, "BTC funding", 'lbl')}</em>
                <strong className={fundingBtc >= 0 ? 'up' : 'down'}>{fundingBtc >= 0 ? '+' : ''}{fundingBtc.toFixed(4)}%</strong>
                <span>{fundingBtc >= 0 ? tl(t, 'longs pay shorts', 'msg') : tl(t, 'shorts pay longs', 'msg')}</span>
              </div>
            )}
            {oiBtc > 0 && (
              <div className="lite-deriv-item">
                <em>{tl(t, "BTC open interest", 'lbl')}</em>
                <strong>{fmtLargeShort(oiBtc)}</strong>
                <span>{tl(t, "money in open bets", 'msg')}</span>
              </div>
            )}
            {oiEth > 0 && (
              <div className="lite-deriv-item">
                <em>{tl(t, "ETH open interest", 'lbl')}</em>
                <strong>{fmtLargeShort(oiEth)}</strong>
                <span>{tl(t, "money in open bets", 'msg')}</span>
              </div>
            )}
            {Number.isFinite(longs) && longs > 0 && (
              <div className="lite-deriv-item lite-deriv-ls">
                <em>{tl(t, "Positioning", 'lbl')}</em>
                <span className="lite-ls-track" aria-hidden><span style={{ width: `${Math.min(100, Math.max(0, longs))}%` }} /></span>
                <span>{Math.round(longs)}% long · {Math.round(100 - longs)}% short</span>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="lite-panel lite-rise-1">
        <div className="lite-block-head">
          <p className="lite-eyebrow">{tl(t, "Top coins", 'lbl')}</p>
          <div className="lite-block-tools">
            <div className="lite-tf-toggle lite-tf-toggle--sm" role="tablist" aria-label="Sort markets">
              {MARKET_SORTS.map((s) => (
                <button key={s.id} type="button" role="tab" aria-selected={sort === s.id} className={`lite-tf-btn${sort === s.id ? ' active' : ''}`} onClick={() => setSort(s.id)}>{tl(t, s.label)}</button>
              ))}
            </div>
            <div className="lite-tf-toggle lite-tf-toggle--sm" role="tablist" aria-label="Row count">
              {[20, 40].map((n) => (
                <button key={n} type="button" role="tab" aria-selected={count === n} className={`lite-tf-btn${count === n ? ' active' : ''}`} onClick={() => setCount(n)}>{t('lite.opt.top_n', 'Top {{n}}', { n })}</button>
              ))}
            </div>
          </div>
        </div>
        {marketRows.length === 0 ? (
          <SkeletonRows n={8} />
        ) : (
          <SplitCols
            items={sortedRows}
            render={(r, i) => (
              <TokenRow
                key={r.id}
                {...r}
                rank={sort === 'rank' ? marketRows.indexOf(r) + 1 : i + 1}
                fmtPrice={fmtPrice}
                fmtLargeShort={fmtLargeShort}
                starred={wl?.has ? wl.has(r.symbol) : undefined}
                onToggleStar={wl ? () => (wl.has(r.symbol) ? wl.remove(r.symbol) : wl.add({ symbol: r.symbol, name: r.name })) : null}
                onOpen={onPickResearch ? () => onPickResearch(r.symbol) : null}
              />
            )}
          />
        )}
      </section>
      <ProLink label="Full markets in PRO" path="/" onOpenPath={onOpenPath} />
    </div>
  )
}

function WatchlistView({ data, fmtPrice, fmtLargeShort, onOpenPath, wl, onPickResearch, onCinema }) {
  const { t } = useTranslation()
  const { watchlistEntries, watchlistPrices } = data
  const [sort, setSort] = useState('mine')
  const entries = [...watchlistEntries].sort((a, b) => {
    if (sort === 'mine') return 0
    const pa = watchlistPrices[(a.symbol || '').toUpperCase()] || {}
    const pb = watchlistPrices[(b.symbol || '').toUpperCase()] || {}
    if (sort === 'change') return (Number(pb.change) || 0) - (Number(pa.change) || 0)
    return (Number(pb.marketCap) || 0) - (Number(pa.marketCap) || 0)
  })
  // Deterministic day read over the priced entries - no LLM, honest when thin.
  const priced = watchlistEntries
    .map((tk) => ({ sym: (tk.symbol || '').toUpperCase(), ...watchlistPrices[(tk.symbol || '').toUpperCase()] }))
    .filter((p) => p.price != null)
  const avg = priced.length ? priced.reduce((s, p) => s + (Number(p.change) || 0), 0) / priced.length : null
  const best = priced.length ? priced.reduce((a, b) => ((Number(b.change) || 0) > (Number(a.change) || 0) ? b : a)) : null
  const worst = priced.length ? priced.reduce((a, b) => ((Number(b.change) || 0) < (Number(a.change) || 0) ? b : a)) : null
  // The watchlist entry is the ONLY place an on-chain coin's contract lives, so
  // it has to travel with the row - without it Cinema charts a bare ticker and
  // /api/bars answers no_data (founder 2026-08-12, "palm is dead in cinema").
  const cinemaRows = entries.map((tk) => {
    const p = watchlistPrices[(tk.symbol || '').toUpperCase()] || {}
    return {
      symbol: tk.symbol,
      name: tk.name || tk.symbol,
      image: p.image || tk.logo || tk.image,
      price: p.price,
      change: p.change,
      change7d: p.change7d,
      marketCap: p.marketCap,
      volume: p.volume,
      address: tk.address || tk.contract || null,
      chain: tk.chain || tk.chainId || tk.network || null,
      networkId: tk.networkId,
      isStock: tk.isStock || tk.assetClass === 'stock',
    }
  })
  return (
    <div className="lite-view">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Watchlist', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'Your coins, nothing else.', 'sub')}</p>
        {onCinema && entries.length > 0 && (
          <CinemaButton label={tl(t, 'Cinema', 'lbl')} onClick={() => onCinema(tl(t, 'Watchlist', 'ttl'), cinemaRows)} />
        )}
      </header>
      <div className="lite-rise lite-search-wrap">
        <LiteSearch wl={wl} onPick={onPickResearch} />
      </div>
      {priced.length >= 2 && (
        <div className="lite-statband lite-rise">
          <div className="lite-stat">
            <em>{tl(t, "Coins", 'lbl')}</em>
            <strong>{priced.length}</strong>
            <span>{tl(t, "on your list", 'msg')}</span>
          </div>
          <div className="lite-stat">
            <em>{tl(t, "Average day", 'lbl')}</em>
            <strong className={changeCls(avg)}>{fmtChange(avg)}</strong>
            <span>{tl(t, "across the list", 'msg')}</span>
          </div>
          <div className="lite-stat">
            <em>{tl(t, "Best today", 'lbl')}</em>
            <strong>{best.sym}</strong>
            <span className={`lite-change ${changeCls(best.change)}`}>{fmtChange(best.change)}</span>
          </div>
          <div className="lite-stat">
            <em>{tl(t, "Toughest today", 'lbl')}</em>
            <strong>{worst.sym}</strong>
            <span className={`lite-change ${changeCls(worst.change)}`}>{fmtChange(worst.change)}</span>
          </div>
        </div>
      )}
      {watchlistEntries.length > 1 && (
        <div className="lite-tf-toggle lite-rise" role="tablist" aria-label="Sort">
          {[{ id: 'mine', label: 'My order' }, { id: 'change', label: '24h move' }, { id: 'size', label: 'Size' }].map((o) => (
            <button key={o.id} type="button" role="tab" aria-selected={sort === o.id} className={`lite-tf-btn${sort === o.id ? ' active' : ''}`} onClick={() => setSort(o.id)}>{tl(t, o.label)}</button>
          ))}
        </div>
      )}
      <section className="lite-panel lite-rise-1">
        {watchlistEntries.length === 0 ? (
          <p className="lite-empty">{tl(t, "Your watchlist is empty. Star a token anywhere in Spectre and it shows up here.", 'msg')}</p>
        ) : (
          <ul className="lite-tlist">
            {entries.map((tk) => {
              const sym = (tk.symbol || '').toUpperCase()
              const p = watchlistPrices[sym] || {}
              return (
                <TokenRow
                  key={tk.address || sym}
                  image={p.image}
                  symbol={sym}
                  name={tk.name || p.name || sym}
                  price={p.price}
                  change={p.change ?? 0}
                  change7d={p.change7d}
                  marketCap={p.marketCap}
                  fmtPrice={fmtPrice}
                  fmtLargeShort={fmtLargeShort}
                  starred
                  onToggleStar={wl ? () => wl.remove(tk.address || sym) : null}
                  onOpen={onPickResearch ? () => onPickResearch(sym) : null}
                />
              )
            })}
          </ul>
        )}
      </section>
      <ProLink label="Manage watchlists in PRO" path="/watchlists" onOpenPath={onOpenPath} />
    </div>
  )
}

let _fgHistCache = null

// `{ month: 'short', year: '2-digit' }` prints "Aug 25" - which on a chart whose
// x axis IS days reads as the 25th, not 2025. On the 1Y range both ends came out
// "Aug 25 - Aug 26", i.e. a year of data labelled as two consecutive days, and on
// 1M/3M both ends landed in the same month so they printed the SAME label. Say
// the day inside a year, the year across one.
function fmtAxisDate(d, rangeDays) {
  return rangeDays > 180
    ? d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// The PRO-style Fear & Greed history chart: 365 days, fear/greed zone bands.
let _fgHist365 = null

function FgChart() {
  const { t } = useTranslation()
  const [all, setAll] = useState(() => _fresh(_fgHist365, HIST_TTL))
  const [range, setRange] = useState(365)
  useEffect(() => {
    if (_fresh(_fgHist365, HIST_TTL)) return undefined
    let cancelled = false
    import('@/services/fearGreedApi')
      .then(({ getFearGreedHistory }) => getFearGreedHistory(365))
      .then((payload) => {
        if (cancelled) return
        const rows = (payload?.data || [])
          .map((r) => ({ t: Number(r.timestamp) || Math.floor(new Date(r.time || 0).getTime() / 1000), v: Number(r.value ?? r.score) }))
          .filter((r) => r.t > 0 && Number.isFinite(r.v))
          .sort((a, b) => a.t - b.t)
          .slice(-365)
        if (rows.length >= 10) { _fgHist365 = { ts: Date.now(), data: rows }; setAll(rows) }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  if (!all) return <SkeletonRows n={5} />
  const pts = all.slice(-range)
  const W = 800
  const H = 240
  const step = W / (pts.length - 1)
  const y = (v) => H - (v / 100) * H
  const line = pts.map((r, i) => `${(i * step).toFixed(1)},${y(r.v).toFixed(1)}`).join(' ')
  const first = new Date(pts[0].t * 1000)
  const last = new Date(pts[pts.length - 1].t * 1000)
  const cur = pts[pts.length - 1].v
  return (
    <div className="lite-fgchart">
      <div className="lite-fgchart-tools">
        <div className="lite-tf-toggle lite-tf-toggle--sm" role="tablist" aria-label="History range">
          {[{ d: 30, label: '1M' }, { d: 90, label: '3M' }, { d: 365, label: '1Y' }].map((o) => (
            <button key={o.d} type="button" role="tab" aria-selected={range === o.d} className={`lite-tf-btn${range === o.d ? ' active' : ''}`} onClick={() => setRange(o.d)}>{tl(t, o.label)}</button>
          ))}
        </div>
      </div>
      {/* host wraps the PLOT only, so the mark sits inside the chart rather
          than over the range pills or the date axis below it */}
      <div className="lite-fgchart-plot spectre-wm-host">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
          <rect x="0" y={y(100)} width={W} height={y(75) - y(100)} className="lite-fgz-greed" />
          <rect x="0" y={y(25)} width={W} height={y(0) - y(25)} className="lite-fgz-fear" />
          <line x1="0" y1={y(50)} x2={W} y2={y(50)} className="lite-fgspark-mid" />
          <polyline points={line} fill="none" className="lite-fgspark-line" vectorEffect="non-scaling-stroke" />
          <circle cx={W} cy={y(cur)} r="5" className="lite-fgchart-dot" />
        </svg>
        {/* bottom-left: the live dot rides the right edge */}
        <ChartWatermark corner="bl" />
      </div>
      <div className="lite-chart-axis">
        <span>{fmtAxisDate(first, range)}</span>
        <span className="lite-fgchart-zones"><i className="up">{tl(t, '75+ greed', 'lbl')}</i> · <i className="down">{tl(t, 'under 25 fear', 'lbl')}</i></span>
        <span>{fmtAxisDate(last, range)}</span>
      </div>
    </div>
  )
}

function FgSpark() {
  const { t } = useTranslation()
  const [pts, setPts] = useState(() => _fresh(_fgHistCache, HIST_TTL))
  useEffect(() => {
    if (_fresh(_fgHistCache, HIST_TTL)) return undefined
    let cancelled = false
    import('@/services/fearGreedApi')
      .then(({ getFearGreedHistory }) => getFearGreedHistory(90))
      .then((payload) => {
        if (cancelled) return
        const rows = (payload?.data || [])
          .map((r) => ({ t: Number(r.timestamp) || Math.floor(new Date(r.time || 0).getTime() / 1000), v: Number(r.value ?? r.score) }))
          .filter((r) => r.t > 0 && Number.isFinite(r.v))
          .sort((a, b) => a.t - b.t)
          .slice(-90)
        if (rows.length >= 5) { _fgHistCache = { ts: Date.now(), data: rows }; setPts(rows) }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  if (!pts) return null
  const W = 400
  const H = 84
  const step = W / (pts.length - 1)
  const y = (v) => H - (v / 100) * H
  const line = pts.map((r, i) => `${(i * step).toFixed(1)},${y(r.v).toFixed(1)}`).join(' ')
  return (
    <div className="lite-fgspark">
      <p className="lite-fgspark-label">{t('lite.fgspark.last90Days', "Last 90 days")}</p>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} className="lite-fgspark-mid" />
        <polyline points={line} fill="none" className="lite-fgspark-line" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}

function SentimentView({ data, onOpenPath }) {
  const { t } = useTranslation()
  const { fearGreed, altSeason } = data
  const fgValue = Number(fearGreed?.value ?? fearGreed?.score)
  const fgLabel = fearGreed?.classification || fearGreed?.value_classification || fearGreed?.label || ''
  const asValue = Number(altSeason?.value ?? altSeason?.index)

  return (
    <div className="lite-view lite-view--wide">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Sentiment', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'How the crowd feels, in two dials.', 'sub')}</p>
      </header>

      <div className="lite-two-up lite-rise-1">
        <section className="lite-panel lite-gauge">
          <p className="lite-eyebrow">{tl(t, "Fear & Greed", 'lbl')}</p>
          {Number.isFinite(fgValue) ? (
            <>
              <div className="lite-gauge-hero">
                <span className="lite-gauge-value">{Math.round(fgValue)}</span>
                {fgLabel && <span className="lite-gauge-label">{tl(t, fgLabel, 'lbl')}</span>}
              </div>
              <Meter value={fgValue} />
              <div className="lite-gauge-scale"><span>{t('lite.sentimentview.fear', "Fear")}</span><span>{t('lite.sentimentview.greed', "Greed")}</span></div>
              <p className="lite-gauge-note">
                {fgValue < 35
                  ? tl(t, 'The crowd is scared. Historically that is when patient buyers pay attention.', 'msg')
                  : fgValue > 65
                    ? tl(t, 'The crowd is greedy. Historically that is when discipline matters most.', 'msg')
                    : tl(t, 'The crowd is undecided - no extreme to lean against right now.', 'msg')}
              </p>

            </>
          ) : <p className="lite-empty">-</p>}
        </section>

        <section className="lite-panel lite-gauge">
          <p className="lite-eyebrow">{tl(t, "Altcoin Season", 'lbl')}</p>
          {Number.isFinite(asValue) && asValue > 0 ? (
            <>
              <div className="lite-gauge-hero">
                <span className="lite-gauge-value">{Math.round(asValue)}</span>
                <span className="lite-gauge-label">{t('lite.lbl.alt_season', 'Alt Season')}{(altSeason?.label || altSeason?.season) ? ` · ${tl(t, altSeason.label || altSeason.season, 'msg')}` : ''}</span>
              </div>
              <Meter value={asValue} altTrack />
              <div className="lite-gauge-scale"><span>{t('lite.sentimentview.bitcoin', "Bitcoin")}</span><span>{t('lite.sentimentview.altcoins', "Altcoins")}</span></div>
              <p className="lite-gauge-note">
                {asValue < 40
                  ? tl(t, 'Money is favoring Bitcoin over the smaller coins right now.', 'msg')
                  : asValue > 65
                    ? tl(t, 'The smaller coins are outrunning Bitcoin - alt season conditions.', 'msg')
                    : tl(t, 'Rotation: money is moving between Bitcoin and alts without a clear winner.', 'msg')}
              </p>
            </>
          ) : <p className="lite-empty">-</p>}
        </section>
      </div>

      <section className="lite-panel lite-rise-2">
        <p className="lite-eyebrow">{tl(t, "A year of fear & greed", 'lbl')}</p>
        <FgChart />
        <p className="lite-social-note">{tl(t, "The same crowd dial, one year back - extremes tend to mark turning points, not trends.", 'msg')}</p>
      </section>
      <ProLink label={t('lite.sentimentview.label', "Full Fear & Greed in PRO")} path="/fear-greed" onOpenPath={onOpenPath} />
    </div>
  )
}

// Recursive half-split treemap: partition rows into two ~equal-weight halves,
// split the rectangle along its longer axis. Deterministic, no d3.
function treemapLayout(rows, x, y, w, h, out) {
  if (rows.length === 0) return out
  if (rows.length === 1) { out.push({ row: rows[0], x, y, w, h }); return out }
  const total = rows.reduce((s, r) => s + r.weight, 0) || 1
  let acc = 0
  let i = 0
  for (; i < rows.length - 1; i++) {
    acc += rows[i].weight
    if (acc >= total / 2) { i++; break }
  }
  const first = rows.slice(0, i)
  const rest = rows.slice(i)
  const frac = Math.min(0.85, Math.max(0.15, first.reduce((s, r) => s + r.weight, 0) / total))
  if (w >= h) {
    treemapLayout(first, x, y, w * frac, h, out)
    treemapLayout(rest, x + w * frac, y, w * (1 - frac), h, out)
  } else {
    treemapLayout(first, x, y, w, h * frac, out)
    treemapLayout(rest, x, y + h * frac, w, h * (1 - frac), out)
  }
  return out
}

function HeatmapView({ data, fmtPrice, onOpenPath, onPickResearch, market }) {
  const { t } = useTranslation()
  const { marketRows } = data
  const [tf, setTf] = useState('24h')
  const [count, setCount] = useState(40)
  const [hview, setHview] = useState('grid')
  const [src, setSrc] = useState(market === 'stocks' ? 'stocks' : 'crypto')
  useEffect(() => { setSrc(market === 'stocks' ? 'stocks' : 'crypto'); if (market === 'stocks') setTf('24h') }, [market])
  const stockRows = useStockRows(src === 'stocks')
  const rows = src === 'stocks'
    ? stockRows
    : marketRows.filter((r) => !isStableOrWrapped(r.symbol)).slice(0, count)
  const tiles = useMemo(() => {
    if (hview !== 'map' || rows.length === 0) return []
    const weighted = rows.map((r) => ({ ...r, weight: Math.sqrt(Math.max(Number(r.marketCap) || 0, 1)) }))
    return treemapLayout(weighted, 0, 0, 100, 100, [])
  }, [hview, rows])
  return (
    <div className="lite-view lite-view--wide">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Heatmap', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'The market at a glance - green is up, red is down, brighter is bigger.', 'sub')}</p>
      </header>
      <div className="lite-toolrow lite-rise">
        <div className="lite-tf-toggle" role="tablist" aria-label={t('lite.heatmapview.ariaSource', "Source")}>
          {[{ id: 'crypto', label: 'Crypto' }, { id: 'stocks', label: 'Stocks' }].map((o) => (
            <button key={o.id} type="button" role="tab" aria-selected={src === o.id} className={`lite-tf-btn${src === o.id ? ' active' : ''}`} onClick={() => { setSrc(o.id); if (o.id === 'stocks') setTf('24h') }}>{tl(t, o.label)}</button>
          ))}
        </div>
        <div className="lite-tf-toggle" role="tablist" aria-label={t('lite.heatmapview.ariaView', "View")}>
          {[{ id: 'grid', label: 'Grid' }, { id: 'map', label: 'Map' }].map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={hview === v.id} className={`lite-tf-btn${hview === v.id ? ' active' : ''}`} onClick={() => setHview(v.id)}>{tl(t, v.label)}</button>
          ))}
        </div>
        {src === 'crypto' && (
          <div className="lite-tf-toggle" role="tablist" aria-label={t('lite.heatmapview.ariaTimeframe', "Timeframe")}>
            {['24h', '7d'].map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tf === id} className={`lite-tf-btn${tf === id ? ' active' : ''}`} onClick={() => setTf(id)}>{id.toUpperCase()}</button>
            ))}
          </div>
        )}
        {src === 'crypto' && (
          <div className="lite-tf-toggle" role="tablist" aria-label={t('lite.heatmapview.ariaTileCount', "Tile count")}>
            {[20, 40].map((n) => (
              <button key={n} type="button" role="tab" aria-selected={count === n} className={`lite-tf-btn${count === n ? ' active' : ''}`} onClick={() => setCount(n)}>{t('lite.opt.top_n', 'Top {{n}}', { n })}</button>
            ))}
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <section className="lite-panel lite-rise-1"><SkeletonRows n={8} /></section>
      ) : hview === 'map' ? (
        <div className="lite-treemap lite-rise-1" aria-label={t('lite.heatmapview.ariaMarketCapMap', "Market cap map")}>
          {tiles.map(({ row: r, x, y, w, h }) => {
            const chg = Number(tf === '7d' ? (r.change7d ?? r.change) : r.change) || 0
            const area = w * h
            return (
              <div
                key={r.id}
                className="lite-treemap-tile lite-heat-tile--link"
                style={{ ...heatStyle(chg), left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}
                role="button"
                tabIndex={0}
                onClick={() => onPickResearch?.(r.symbol, { stock: r.isStock })}
                onKeyDown={(e) => { if (e.key === 'Enter') onPickResearch?.(r.symbol, { stock: r.isStock }) }}
              >
                <span className="lite-heat-sym" style={{ fontSize: area > 6 ? '1.3rem' : area > 2 ? '0.95rem' : '0.68rem' }}>{r.symbol}</span>
                {area > 4 && r.price != null && <span className="lite-heat-price">{fmtPrice(r.price)}</span>}
                {area > 1.6 && <span className="lite-heat-chg" style={{ fontSize: area > 6 ? '0.9rem' : '0.7rem' }}>{fmtChange(chg)}</span>}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="lite-heat lite-rise-1">
          {rows.map((r, i) => {
            const chg = Number(tf === '7d' ? (r.change7d ?? r.change) : r.change) || 0
            return (
              <div key={r.id} className={`lite-heat-tile lite-heat-tile--link${i < 4 ? ' lite-heat-tile--big' : ''}`} style={heatStyle(chg)} role="button" tabIndex={0} onClick={() => onPickResearch?.(r.symbol, { stock: r.isStock })} onKeyDown={(e) => { if (e.key === 'Enter') onPickResearch?.(r.symbol, { stock: r.isStock }) }}>
                <span className="lite-heat-sym">{r.symbol}</span>
                {r.price != null && <span className="lite-heat-price">{fmtPrice(r.price)}</span>}
                <span className="lite-heat-chg">{fmtChange(chg)}</span>
              </div>
            )
          })}
        </div>
      )}
      <ProLink label={t('lite.heatmapview.label', "Full heatmaps in PRO")} path="/heatmaps" onOpenPath={onOpenPath} />
    </div>
  )
}

// True circle packing, no d3/canvas: radius = sqrt(market cap), each bubble
// marches out on a spiral until it fits. Deterministic, ~40 lines, organic.
// The cluster is fit-scaled into the given stage - portrait stages (mobile)
// grow the spiral vertically so the whole market fits the phone screen.
function layoutBubbles(rows, stageW = 960, stageH = 600) {
  if (rows.length === 0) return []
  const portrait = stageH > stageW
  const xBias = portrait ? 1 : 1.25
  const yBias = portrait ? 1.3 : 1
  const maxM = Math.max(...rows.map((r) => Number(r.marketCap) || 0), 1)
  const placed = []
  rows.forEach((row, i) => {
    const frac = Math.sqrt(Math.max(Number(row.marketCap) || 0, maxM * 0.0004) / maxM)
    const rad = 30 + frac * 100
    let x = 0
    let y = 0
    if (placed.length > 0) {
      let angle = i * 2.399963 // golden angle - spreads directions
      let dist = placed[0].rad * 0.5
      // Spiral outward until the circle clears everything already placed.
      for (let step = 0; step < 4000; step++) {
        x = Math.cos(angle) * dist * xBias
        y = Math.sin(angle) * dist * yBias
        const pad = 4
        if (placed.every((p) => {
          const dx = p.x - x
          const dy = p.y - y
          return dx * dx + dy * dy >= (p.rad + rad + pad) * (p.rad + rad + pad)
        })) break
        angle += 0.32
        dist += 1.4
      }
    }
    placed.push({ row, x, y, rad })
  })
  // Fit the cluster into the stage: center it, scale down if it overflows.
  const minX = Math.min(...placed.map((p) => p.x - p.rad))
  const maxX = Math.max(...placed.map((p) => p.x + p.rad))
  const minY = Math.min(...placed.map((p) => p.y - p.rad))
  const maxY = Math.max(...placed.map((p) => p.y + p.rad))
  const scale = Math.min(1, (stageW - 12) / (maxX - minX), (stageH - 12) / (maxY - minY))
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const minSize = stageW < 600 ? 24 : 30
  return placed.map((p) => ({
    row: p.row,
    x: stageW / 2 + (p.x - cx) * scale,
    y: stageH / 2 + (p.y - cy) * scale,
    size: Math.max(minSize, p.rad * 2 * scale),
  }))
}

function BubblesView({ data, fmtPrice, onOpenPath, onPickResearch, market }) {
  const { t } = useTranslation()
  const { marketRows } = data
  const [tf, setTf] = useState('24h')
  const [bcount, setBcount] = useState(30)
  const [sizeBy, setSizeBy] = useState('mcap')
  const [src, setSrc] = useState(market === 'stocks' ? 'stocks' : 'crypto')
  useEffect(() => { setSrc(market === 'stocks' ? 'stocks' : 'crypto'); if (market === 'stocks') setTf('24h') }, [market])
  const stockRows = useStockRows(src === 'stocks')
  const rows = src === 'stocks'
    ? stockRows.slice(0, bcount)
    : marketRows.filter((r) => !isStableOrWrapped(r.symbol)).slice(0, bcount)
  // Mobile: portrait stage sized to the phone - the whole market fits the
  // first screen instead of panning to find BTC (computed once on open).
  const [stage] = useState(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
    return vw <= 768 ? { w: Math.max(300, vw - 44), h: 540 } : { w: 960, h: 600 }
  })
  const bubbles = useMemo(() => {
    // Size by market cap, or by the size of the MOVE (loudest coins biggest).
    const weighted = sizeBy === 'move'
      ? rows.map((r) => { const c = Math.abs(Number(tf === '7d' ? (r.change7d ?? r.change) : r.change) || 0); return { ...r, marketCap: (c + 0.4) * (c + 0.4) } })
      : rows
    return layoutBubbles(weighted, stage.w, stage.h)
  }, [rows, stage, sizeBy, tf])
  return (
    <div className="lite-view lite-view--wide">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{t("lite.tab.bubbles", "Bubbles")}</h1>
        <p className="lite-view-sub">{sizeBy === 'move' ? tl(t, 'The market as a night sky - bigger means the bigger move today.', 'sub') : tl(t, 'The market as a night sky - size is market cap, green is up.', 'sub')}</p>
      </header>
      <div className="lite-toolrow lite-rise">
        <div className="lite-tf-toggle" role="tablist" aria-label={t('lite.bubblesview.ariaSource', "Source")}>
          {[{ id: 'crypto', label: 'Crypto' }, { id: 'stocks', label: 'Stocks' }].map((o) => (
            <button key={o.id} type="button" role="tab" aria-selected={src === o.id} className={`lite-tf-btn${src === o.id ? ' active' : ''}`} onClick={() => { setSrc(o.id); if (o.id === 'stocks') setTf('24h') }}>{tl(t, o.label)}</button>
          ))}
        </div>
        {src === 'crypto' && (
          <div className="lite-tf-toggle" role="tablist" aria-label={t('lite.bubblesview.ariaTimeframe', "Timeframe")}>
            {['24h', '7d'].map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tf === id} className={`lite-tf-btn${tf === id ? ' active' : ''}`} onClick={() => setTf(id)}>{id.toUpperCase()}</button>
            ))}
          </div>
        )}
        <div className="lite-tf-toggle" role="tablist" aria-label={t('lite.bubblesview.ariaBubbleSize', "Bubble size")}>
          {[{ id: 'mcap', label: 'Size = cap' }, { id: 'move', label: 'Size = move' }].map((o) => (
            <button key={o.id} type="button" role="tab" aria-selected={sizeBy === o.id} className={`lite-tf-btn${sizeBy === o.id ? ' active' : ''}`} onClick={() => setSizeBy(o.id)}>{tl(t, o.label)}</button>
          ))}
        </div>
        <div className="lite-tf-toggle" role="tablist" aria-label={t('lite.bubblesview.ariaBubbleCount', "Bubble count")}>
          {[15, 30].map((n) => (
            <button key={n} type="button" role="tab" aria-selected={bcount === n} className={`lite-tf-btn${bcount === n ? ' active' : ''}`} onClick={() => setBcount(n)}>{t('lite.opt.top_n', 'Top {{n}}', { n })}</button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <section className="lite-panel lite-rise-1"><SkeletonRows n={8} /></section>
      ) : (
        <div className="lite-bubbles lite-rise-1" aria-label={t('lite.bubblesview.ariaMarketBubbles', "Market bubbles")}>
          <div className="lite-bubbles-stage" style={{ width: stage.w, height: stage.h }}>
            {bubbles.map(({ row, x, y, size }, i) => {
              const chg = Number(tf === '7d' ? (row.change7d ?? row.change) : row.change) || 0
              const alpha = Math.min(0.9, 0.38 + Math.abs(chg) / 7)
              return (
                <div
                  key={row.id}
                  className="lite-bubble lite-bubble--link"
                  role="button"
                  tabIndex={0}
                  onClick={() => onPickResearch?.(row.symbol, { stock: row.isStock })}
                  onKeyDown={(e) => { if (e.key === 'Enter') onPickResearch?.(row.symbol, { stock: row.isStock }) }}
                  style={{
                    width: size,
                    height: size,
                    left: x - size / 2,
                    top: y - size / 2,
                    '--hrgb': chg >= 0 ? '16 185 129' : '239 68 68',
                    '--ha': alpha,
                    '--hap': Math.min(0.95, alpha + 0.3),
                    animationDelay: `${(i % 7) * 0.6}s`,
                  }}
                >
                  <span className="lite-bubble-sym" style={{ fontSize: Math.max(10, Math.min(26, size * 0.19)) }}>{row.symbol}</span>
                  {size >= 84 && row.price != null && <span className="lite-bubble-price" style={{ fontSize: Math.max(10, Math.min(15, size * 0.11)) }}>{fmtPrice(row.price)}</span>}
                  {size >= 52 && <span className="lite-bubble-chg" style={{ fontSize: Math.max(9, Math.min(14, size * 0.1)) }}>{fmtChange(chg)}</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}
      <ProLink label={t('lite.bubblesview.label', "The full Cosmos in PRO")} path="/bubbles" onOpenPath={onOpenPath} />
    </div>
  )
}

function SocialView({ data, fmtLargeShort, onOpenPath, onPickResearch }) {
  const { t } = useTranslation()
  const { social, socialState, socialWindow } = data
  const [sort, setSort] = useState('rank')
  const [sview, setSview] = useState('list')
  const [stage] = useState(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
    return vw <= 768 ? { w: Math.max(300, vw - 44), h: 540 } : { w: 960, h: 600 }
  })
  const rows = [...social].sort((a, b) => (
    sort === 'mentions' ? b.mentions - a.mentions
      : sort === 'voices' ? b.authors - a.authors
        : a.rank - b.rank
  ))
  const totalMentions = social.reduce((s, r) => s + (Number(r.mentions) || 0), 0)
  const totalVoices = social.reduce((s, r) => s + (Number(r.authors) || 0), 0)
  const climber = social.reduce((a, b) => ((b.rankChange || 0) > (a?.rankChange || 0) ? b : a), social[0])
  // Attention heatmap: tile size = mention share, color = rank direction.
  const attnTiles = useMemo(() => {
    if (sview !== 'heat' || social.length === 0) return []
    const weighted = [...social]
      .sort((a, b) => b.mentions - a.mentions)
      .map((r) => ({ ...r, weight: Math.sqrt(Math.max(Number(r.mentions) || 1, 1)) }))
    return treemapLayout(weighted, 0, 0, 100, 100, [])
  }, [sview, social])
  // Attention night sky: bubble size = mentions, color = board direction.
  const attnBubbles = useMemo(() => {
    if (sview !== 'bubbles' || social.length === 0) return []
    const weighted = [...social]
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, 30)
      .map((r) => ({ ...r, marketCap: Math.max(Number(r.mentions) || 1, 1) }))
    return layoutBubbles(weighted, stage.w, stage.h)
  }, [sview, social, stage])
  return (
    <div className="lite-view lite-view--wide">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Social', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'What crypto X is talking about right now, ranked by real attention.', 'sub')}</p>
      </header>
      <div className="lite-toolrow lite-rise">
        <div className="lite-tf-toggle" role="tablist" aria-label={t('lite.socialview.ariaSocialView', "Social view")}>
          {[{ id: 'list', label: 'Board' }, { id: 'heat', label: 'Heatmap' }, { id: 'bubbles', label: 'Bubbles' }].map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={sview === v.id} className={`lite-tf-btn${sview === v.id ? ' active' : ''}`} onClick={() => setSview(v.id)}>{tl(t, v.label)}</button>
          ))}
        </div>
        {sview === 'list' && (
          <div className="lite-tf-toggle" role="tablist" aria-label={t('lite.socialview.ariaSort', "Sort")}>
            {[{ id: 'rank', label: 'Board rank' }, { id: 'mentions', label: 'Mentions' }, { id: 'voices', label: 'Voices' }].map((o) => (
              <button key={o.id} type="button" role="tab" aria-selected={sort === o.id} className={`lite-tf-btn${sort === o.id ? ' active' : ''}`} onClick={() => setSort(o.id)}>{tl(t, o.label)}</button>
            ))}
          </div>
        )}
      </div>

      {/* Every count and label on this board says 24h. When the upstream has
          only built another window we serve THAT board rather than an empty
          one - so say which window the reader is looking at instead of letting
          a week's numbers wear a 24h label. Absent in the normal case. */}
      {social.length > 0 && socialWindow && socialWindow !== '24h' && (
        <p className="lite-social-note lite-rise-1">
          {t('lite.msg.social_window_fallback', 'Showing the {{win}} board - the 24h window is still being rebuilt upstream.', { win: String(socialWindow).toUpperCase() })}
        </p>
      )}

      {social.length > 0 && (
        <div className="lite-statband lite-rise-1">
          <div className="lite-stat">
            <em>{tl(t, "Mentions", 'lbl')}</em>
            <strong>{totalMentions.toLocaleString()}</strong>
            {/* The window is baked into this string in all 20 locales, so the
                translated copy is right for the normal 24h case and only the
                fallback needs the interpolated (English) variant. */}
            <span>{socialWindow && socialWindow !== '24h'
              ? t('lite.msg.across_top_coins_win', 'across the top {{n}} coins, {{win}}', { n: social.length, win: String(socialWindow).toUpperCase() })
              : t('lite.msg.across_top_coins', 'across the top {{n}} coins, 24h', { n: social.length })}</span>
          </div>
          <div className="lite-stat">
            <em>{tl(t, "Real voices", 'lbl')}</em>
            <strong>{totalVoices.toLocaleString()}</strong>
            <span>{tl(t, "distinct accounts talking", 'msg')}</span>
          </div>
          {climber && climber.rankChange > 0 && (
            <div className="lite-stat">
              <em>{tl(t, "Climbing fastest", 'lbl')}</em>
              <strong>{climber.symbol}</strong>
              <span className="lite-change up">{t('lite.msg.board_spots', '▲{{n}} board spots', { n: climber.rankChange })}</span>
            </div>
          )}
        </div>
      )}

      {sview === 'heat' && (
        social.length === 0 ? (
          <section className="lite-panel lite-rise-1">
            {socialState === 'loading' ? <SkeletonRows n={8} /> : (
              <p className="lite-empty">{tl(t, 'The social feed is rebuilding its index right now. The board comes back on its own.', 'msg')}</p>
            )}
          </section>
        ) : (
          <div className="lite-treemap lite-treemap--attn lite-rise-1" aria-label={t('lite.socialview.ariaAttentionHeatmap', "Attention heatmap")}>
            {attnTiles.map(({ row: r, x, y, w, h }) => {
              const dir = r.rankChange > 0 ? 'up' : r.rankChange < 0 ? 'down' : 'flat'
              const area = w * h
              return (
                <div
                  key={r.id}
                  className={`lite-treemap-tile lite-heat-tile--link lite-attn-tile--${dir}`}
                  style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}
                  role="button"
                  tabIndex={0}
                  onClick={() => onPickResearch?.(r.symbol)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onPickResearch?.(r.symbol) }}
                >
                  <span className="lite-heat-sym" style={{ fontSize: area > 8 ? '1.35rem' : area > 3 ? '1rem' : '0.7rem' }}>{r.symbol}</span>
                  {area > 3 && <span className="lite-heat-price">{Number(r.mentions).toLocaleString()} {tl(t, 'mentions', 'lbl')}</span>}
                  {area > 6 && <span className="lite-heat-chg">{r.rankChange > 0 ? `▲${r.rankChange}` : r.rankChange < 0 ? `▼${Math.abs(r.rankChange)}` : '–'}</span>}
                </div>
              )
            })}
          </div>
        )
      )}

      {sview === 'bubbles' && (
        social.length === 0 ? (
          <section className="lite-panel lite-rise-1">
            {socialState === 'loading' ? <SkeletonRows n={8} /> : (
              <p className="lite-empty">{tl(t, 'The social feed is rebuilding its index right now. The board comes back on its own.', 'msg')}</p>
            )}
          </section>
        ) : (
          <div className="lite-bubbles lite-rise-1" aria-label={t('lite.socialview.ariaAttentionBubbles', "Attention bubbles")}>
            <div className="lite-bubbles-stage" style={{ width: stage.w, height: stage.h }}>
              {attnBubbles.map(({ row: r, x, y, size }, i) => {
                const dirRgb = r.rankChange > 0 ? '16 185 129' : r.rankChange < 0 ? '239 68 68' : '148 163 184'
                const alpha = Math.min(0.9, 0.42 + Math.abs(Number(r.rankChange) || 0) / 10)
                return (
                  <div
                    key={r.id}
                    className="lite-bubble lite-bubble--link"
                    role="button"
                    tabIndex={0}
                    onClick={() => onPickResearch?.(r.symbol)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onPickResearch?.(r.symbol) }}
                    style={{
                      width: size,
                      height: size,
                      left: x - size / 2,
                      top: y - size / 2,
                      '--hrgb': dirRgb,
                      '--ha': alpha,
                      '--hap': Math.min(0.95, alpha + 0.3),
                      animationDelay: `${(i % 7) * 0.6}s`,
                    }}
                  >
                    <span className="lite-bubble-sym" style={{ fontSize: Math.max(10, Math.min(26, size * 0.19)) }}>{r.symbol}</span>
                    {size >= 62 && <span className="lite-bubble-price" style={{ fontSize: Math.max(9, Math.min(14, size * 0.1)) }}>{Number(r.mentions).toLocaleString()} {tl(t, 'mentions', 'lbl')}</span>}
                    {size >= 52 && r.rankChange !== 0 && <span className="lite-bubble-chg" style={{ fontSize: Math.max(9, Math.min(13, size * 0.1)) }}>{r.rankChange > 0 ? `▲${r.rankChange}` : `▼${Math.abs(r.rankChange)}`}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )
      )}

      {sview === 'list' && (
      <section className="lite-panel lite-rise-1">
        {social.length === 0 ? (
          // An empty board is not the same as one still loading. The feed
          // materialises one document per window and can answer 200 with rows
          // for none of them - shimmering on that forever is a lie.
          socialState === 'loading' ? <SkeletonRows n={8} /> : (
            <p className="lite-empty">{tl(t, 'The social feed is rebuilding its index right now. The board comes back on its own.', 'msg')}</p>
          )
        ) : (
          <ul className="lite-tlist">
            {rows.map((r) => (
              <li key={r.id} className="lite-trow lite-trow--link" role="button" tabIndex={0} onClick={() => onPickResearch?.(r.symbol)} onKeyDown={(e) => { if (e.key === 'Enter') onPickResearch?.(r.symbol) }}>
                <span className="lite-social-rank">{r.rank}</span>
                <span className="lite-trow-logo">
                  {r.image ? <img src={r.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }} /> : null}
                  <span className="lite-trow-fallback" style={r.image ? { display: 'none' } : undefined}>{(r.symbol || '?')[0]}</span>
                </span>
                <span className="lite-trow-id">
                  <strong>{r.name}</strong>
                  <em>{r.symbol}</em>
                </span>
                <span className="lite-social-stat"><strong>{Number(r.mentions).toLocaleString()}</strong><em>{tl(t, 'mentions', 'lbl')}</em></span>
                <span className="lite-social-stat"><strong>{Number(r.authors).toLocaleString()}</strong><em>{tl(t, 'voices', 'lbl')}</em></span>
                {r.clean != null && Number(r.clean) > 0 && <span className={`lite-social-stat${Number(r.clean) < 40 ? ' lite-social-stat--warn' : ''}`}><strong>{Math.round(Number(r.clean))}%</strong><em>{tl(t, 'organic', 'lbl')}</em></span>}
                {r.marketCap > 0 && <span className="lite-trow-mcap">{fmtLargeShort(r.marketCap)}</span>}
                <span className={`lite-social-delta ${r.rankChange > 0 ? 'up' : r.rankChange < 0 ? 'down' : ''}`}>
                  {r.rankChange > 0 ? `▲${r.rankChange}` : r.rankChange < 0 ? `▼${Math.abs(r.rankChange)}` : '–'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="lite-social-note">{tl(t, "Ranked by weighted mentions from tracked crypto X accounts over the last 24h. \"Voices\" = distinct real authors.", 'msg')}</p>
      </section>
      )}
      <ProLink label={t('lite.socialview.label', "Full social intelligence in PRO")} path="/x-dash" onOpenPath={onOpenPath} />
    </div>
  )
}

// ── Wallets (lazy: box aggregate of whale/smart-money/CEX/ETF/stable flows,
// server-cached 60s; one fetch per open) ──
let _walletsCache = null

function fmtSignedShort(v, fmtLargeShort) {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return '$0'
  return `${n > 0 ? '+' : '-'}${fmtLargeShort(Math.abs(n))}`
}

function WalletsView({ fmtLargeShort, onOpenPath, onPickResearch, imgBySym }) {
  const { t } = useTranslation()
  const [wd, setWd] = useState(() => _fresh(_walletsCache, LIVE_TTL))

  useEffect(() => {
    if (_fresh(_walletsCache, LIVE_TTL)) return undefined
    let cancelled = false
    fetch('/data-api/v1/wallets/command', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled || !payload?.data) return
        _walletsCache = { ts: Date.now(), data: payload.data }
        setWd(payload.data)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const tokens = (wd?.smartMoney?.tokens || []).filter((t) => Number.isFinite(Number(t.netflow24h)))
  const buying = [...tokens].sort((a, b) => b.netflow24h - a.netflow24h).filter((t) => t.netflow24h > 0).slice(0, 6)
  const selling = [...tokens].sort((a, b) => a.netflow24h - b.netflow24h).filter((t) => t.netflow24h < 0).slice(0, 6)
  const tape = (wd?.whaleTape || []).slice(0, 8)
  const etfFlow = (wd?.etf?.aggregates || []).reduce((s, a) => s + (Number(a.flowUsd) || 0), 0)
  const stablesNet = Number(wd?.stables?.net24h)
  const cexNet = (wd?.exchangeFlows?.byAsset || []).reduce((s, a) => s + (Number(a.netAdjusted) || 0), 0)

  const smRow = (tk) => {
    const sym = String(tk.symbol || '').toUpperCase()
    return (
      <li key={tk.symbol + tk.chain} className="lite-mini-row lite-mini-row--link" role="button" tabIndex={0} onClick={() => onPickResearch?.(sym)}>
        <CoinDot src={imgBySym?.[sym] || dexLogo(tk.chain, tk.contract)} sym={sym} />
        <span className="lite-mini-sym">{sym}</span>
        <span className="lite-mini-price">{tk.traders > 0 ? t('lite.msg.n_wallets', '{{n}} wallets', { n: tk.traders }) : ''}</span>
        <span className={`lite-change ${tk.netflow24h >= 0 ? 'up' : 'down'}`}>{fmtSignedShort(tk.netflow24h, fmtLargeShort)}</span>
      </li>
    )
  }

  return (
    <div className="lite-view lite-view--wide">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Wallets', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'Where the big money actually moved in the last day.', 'sub')}</p>
      </header>

      {!wd ? (
        <section className="lite-panel lite-rise-1"><SkeletonRows n={8} /></section>
      ) : (
        <>
          <div className="lite-statband lite-rise-1">
            {wd.summary?.volumeUsd24h > 0 && (
              <div className="lite-stat">
                <em>{tl(t, "Whale volume", 'lbl')}</em>
                <strong>{fmtLargeShort(wd.summary.volumeUsd24h)}</strong>
                <span>{t('lite.msg.n_big_moves', '{{n}} big moves tracked', { n: wd.summary.txCount24h })}</span>
              </div>
            )}
            {etfFlow !== 0 && (
              <div className="lite-stat">
                <em>{tl(t, "ETF money", 'lbl')}</em>
                <strong className={etfFlow >= 0 ? 'up' : 'down'}>{fmtSignedShort(etfFlow, fmtLargeShort)}</strong>
                <span>{tl(t, "last trading day, BTC + ETH", 'msg')}</span>
              </div>
            )}
            {Number.isFinite(stablesNet) && (
              <div className="lite-stat">
                <em>{tl(t, "Fresh dollars", 'lbl')}</em>
                <strong className={stablesNet >= 0 ? 'up' : 'down'}>{fmtSignedShort(stablesNet, fmtLargeShort)}</strong>
                <span>{tl(t, "stablecoins minted minus redeemed", 'msg')}</span>
              </div>
            )}
            {cexNet !== 0 && (
              <div className="lite-stat">
                <em>{tl(t, "Exchange flow", 'lbl')}</em>
                <strong className={cexNet <= 0 ? 'up' : 'down'}>{fmtSignedShort(cexNet, fmtLargeShort)}</strong>
                <span>{cexNet <= 0 ? tl(t, 'leaving exchanges - holding mood', 'msg') : tl(t, 'moving to exchanges - selling mood', 'msg')}</span>
              </div>
            )}
          </div>

          <div className="lite-grid lite-rise-1">
            <section className="lite-panel lite-span-6">
              <p className="lite-eyebrow">{tl(t, "Smart money is buying", 'lbl')}</p>
              {buying.length === 0 ? <p className="lite-empty">{tokens.length === 0 ? tl(t, 'The smart-money feed is offline right now - reads return when it reconnects.', 'msg') : tl(t, "No clear buying today.", 'msg')}</p> : <ul className="lite-mini-list">{buying.map(smRow)}</ul>}
            </section>
            <section className="lite-panel lite-span-6">
              <p className="lite-eyebrow">{tl(t, "Smart money is selling", 'lbl')}</p>
              {selling.length === 0 ? <p className="lite-empty">{tokens.length === 0 ? tl(t, 'The smart-money feed is offline right now - reads return when it reconnects.', 'msg') : tl(t, "No clear selling today.", 'msg')}</p> : <ul className="lite-mini-list">{selling.map(smRow)}</ul>}
            </section>

            <section className="lite-panel lite-span-7">
              <p className="lite-eyebrow">{tl(t, "Whale tape", 'lbl')}</p>
              {tape.length === 0 ? <p className="lite-empty">{tl(t, "Quiet on the whale front.", 'msg')}</p> : (
                <ul className="lite-mini-list">
                  {tape.map((tp, i) => (
                    <li key={tp.txHash || i} className="lite-mini-row">
                      <CoinDot src={imgBySym?.[tp.asset]} sym={tp.asset} />
                      <span className="lite-mini-sym">{tp.asset}</span>
                      {tp.amount != null && <span className="lite-wallets-qty">{fmtQty(tp.amount)}</span>}
                      <span className="lite-mini-price">{fmtLargeShort(Number(tp.usd) || 0)}</span>
                      <span className="lite-wallets-type">{tl(t, String(tp.type || '').replace('_', ' ') || 'transfer', 'msg')}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="lite-social-note">{tl(t, "Labeled wallets moving $1M+ on Bitcoin and Ethereum, newest first.", 'msg')}</p>
            </section>

            <section className="lite-panel lite-span-5">
              <p className="lite-eyebrow">{tl(t, "Biggest ETF funds", 'lbl')}</p>
              {(wd.etf?.topFunds || []).length === 0 ? <p className="lite-empty">{tl(t, "No fund data right now.", 'msg')}</p> : (
                <ul className="lite-mini-list">
                  {(wd.etf.topFunds || []).slice(0, 5).map((f) => (
                    <li key={f.ticker} className="lite-mini-row">
                      <span className="lite-mini-sym">{f.ticker}</span>
                      <span className="lite-mini-price">{f.issuer}</span>
                      <span className={`lite-change ${Number(f.flowUsd) >= 0 ? 'up' : 'down'}`}>{fmtSignedShort(f.flowUsd, fmtLargeShort)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
      <ProLink label={t('lite.walletsview.label', "The full wallet terminal in PRO")} path="/wallets" onOpenPath={onOpenPath} />
    </div>
  )
}

function MoversView({ data, fmtPrice, fmtLargeShort, onOpenPath, onPickResearch, imgBySym, onCinema }) {
  const { t } = useTranslation()
  const { movers, marketRows } = data
  const [count, setCount] = useState(10)
  const gainers = (movers?.gainers || []).slice(0, count)
  const losers = (movers?.losers || []).slice(0, count)
  // Breadth read off the top-40 board - how one-sided is the day, honestly.
  const board = marketRows.filter((r) => !isStableOrWrapped(r.symbol))
  const upCount = board.filter((r) => (Number(r.change) || 0) > 0).length
  const topG = gainers[0]
  const topL = losers[0]
  return (
    <div className="lite-view lite-view--wide">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Movers', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'The biggest winners and losers of the last 24 hours.', 'sub')}</p>
        {onCinema && (gainers.length > 0 || losers.length > 0) && <CinemaButton label={tl(t, 'Cinema', 'lbl')} onClick={() => onCinema(tl(t, 'Movers', 'ttl'), [...gainers, ...losers])} />}
      </header>
      <div className="lite-tf-toggle lite-rise" role="tablist" aria-label={t('lite.moversview.ariaListSize', "List size")}>
        {[10, 20].map((n) => (
          <button key={n} type="button" role="tab" aria-selected={count === n} className={`lite-tf-btn${count === n ? ' active' : ''}`} onClick={() => setCount(n)}>{t('lite.opt.top_n', 'Top {{n}}', { n })}</button>
        ))}
      </div>
      {board.length > 0 && (topG || topL) && (
        <div className="lite-statband lite-rise">
          <div className="lite-stat">
            <em>{tl(t, "Market breadth", 'lbl')}</em>
            <strong>{upCount} of {board.length}</strong>
            <span>{tl(t, "top coins up today", 'msg')}</span>
          </div>
          <div className="lite-stat">
            <em>{tl(t, "Mood", 'lbl')}</em>
            <strong className={upCount * 2 >= board.length ? 'up' : 'down'}>{upCount * 2 >= board.length ? tl(t, 'Risk on', 'lbl') : tl(t, 'Risk off', 'lbl')}</strong>
            <span>{upCount * 2 >= board.length ? tl(t, 'more winners than losers', 'msg') : tl(t, 'more losers than winners', 'msg')}</span>
          </div>
          {topG && (
            <div className="lite-stat">
              <em>{tl(t, "Top winner", 'lbl')}</em>
              <strong>{topG.symbol}</strong>
              <span className="lite-change up">{fmtChange(topG.change)}</span>
            </div>
          )}
          {topL && (
            <div className="lite-stat">
              <em>{tl(t, "Top loser", 'lbl')}</em>
              <strong>{topL.symbol}</strong>
              <span className="lite-change down">{fmtChange(topL.change)}</span>
            </div>
          )}
        </div>
      )}
      <div className="lite-grid lite-rise-1">
        <section className="lite-panel lite-span-4">
          <p className="lite-eyebrow">{tl(t, "Winning", 'lbl')}</p>
          <ul className="lite-mini-list">
            {gainers.length === 0 && <SkeletonRows n={6} />}
            {gainers.map((m) => (
              <li key={m.symbol} className="lite-mini-row lite-mini-row--link" role="button" tabIndex={0} onClick={() => onPickResearch?.(m.symbol)}>
                <CoinDot src={imgBySym?.[m.symbol]} sym={m.symbol} />
                <span className="lite-mini-sym">{m.symbol}</span>
                <span className="lite-mini-price">{m.price > 0 ? fmtPrice(m.price) : ''}</span>
                <span className="lite-change up">{fmtChange(m.change)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="lite-panel lite-span-4">
          <p className="lite-eyebrow">{tl(t, "Losing", 'lbl')}</p>
          <ul className="lite-mini-list">
            {losers.length === 0 && <SkeletonRows n={6} />}
            {losers.map((m) => (
              <li key={m.symbol} className="lite-mini-row lite-mini-row--link" role="button" tabIndex={0} onClick={() => onPickResearch?.(m.symbol)}>
                <CoinDot src={imgBySym?.[m.symbol]} sym={m.symbol} />
                <span className="lite-mini-sym">{m.symbol}</span>
                <span className="lite-mini-price">{m.price > 0 ? fmtPrice(m.price) : ''}</span>
                <span className="lite-change down">{fmtChange(m.change)}</span>
              </li>
            ))}
          </ul>
        </section>
        {board.some((r) => Number(r.volume) > 0) && (
          <section className="lite-panel lite-span-4">
            <p className="lite-eyebrow">{tl(t, 'Most traded', 'opt')}</p>
            <ul className="lite-mini-list">
              {[...board].sort((a, b) => (Number(b.volume) || 0) - (Number(a.volume) || 0)).slice(0, count).map((m) => (
                <li key={m.symbol} className="lite-mini-row lite-mini-row--link" role="button" tabIndex={0} onClick={() => onPickResearch?.(m.symbol)}>
                  <CoinDot src={m.image || imgBySym?.[m.symbol]} sym={m.symbol} />
                  <span className="lite-mini-sym">{m.symbol}</span>
                  <span className="lite-mini-price">{fmtLargeShort ? fmtLargeShort(Number(m.volume) || 0) : ''}</span>
                  <span className={`lite-change ${(Number(m.change) || 0) >= 0 ? 'up' : 'down'}`}>{fmtChange(m.change)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <ProLink label={t('lite.moversview.label', "Potential gainers in PRO")} path="/potential-gainers" onOpenPath={onOpenPath} />
    </div>
  )
}

// Per-sector coin drill (lazy, cached per category id)
// cgId → { rows, page, hasMore } - accumulated full pages per category, so
// re-opening a sector (or paging back into it) never refetches page 1.
const _sectorCoins = new Map()
const SECTOR_PAGE = 100

// Full category universe for the Sectors view - the shared hook only carries
// the top 12 for the Today board; this holds all ~250 with a search filter.
let _allSectorsCache = null

function SectorsView({ data, fmtPrice, fmtLargeShort, onOpenPath, onPickResearch, wl }) {
  const { t } = useTranslation()
  const { sectors } = data
  const [sort, setSort] = useState('size')
  const [openCat, setOpenCat] = useState(null)
  const [coinState, setCoinState] = useState(null) // { rows, page, hasMore }
  const [coinsLoading, setCoinsLoading] = useState(false)
  const [coinQ, setCoinQ] = useState('')
  const [all, setAll] = useState(() => _fresh(_allSectorsCache, HIST_TTL))
  const [q, setQ] = useState('')
  const [showAll, setShowAll] = useState(false)

  const loadCoinPage = useCallback((cat, page) => {
    setCoinsLoading(true)
    import('@/services/coinGeckoApi')
      // cgOnly: chain/ecosystem categories aren't served by the Spectre
      // bridge - racing it first shrinks a 640-coin sector to ~10 rows.
      .then(({ getCategoryCoins }) => getCategoryCoins(cat.cgId, page, SECTOR_PAGE, { cgOnly: true, sparkline: false }))
      .then((rows) => {
        const mapped = (Array.isArray(rows) ? rows : [])
          .map((r) => ({
            id: r.id || r.symbol,
            symbol: String(r.symbol || '').toUpperCase(),
            name: r.name,
            image: r.image || null,
            price: r.current_price,
            change: r.price_change_percentage_24h ?? 0,
            marketCap: r.market_cap ?? null,
          }))
          .filter((r) => r.symbol)
        setCoinState((prev) => {
          const seen = new Set((page > 1 && prev ? prev.rows : []).map((r) => r.id))
          const rowsAll = [...(page > 1 && prev ? prev.rows : []), ...mapped.filter((r) => !seen.has(r.id))]
          const next = { rows: rowsAll, page, hasMore: mapped.length >= SECTOR_PAGE }
          _sectorCoins.set(cat.cgId, next)
          return next
        })
      })
      .catch(() => { setCoinState((prev) => prev || { rows: [], page, hasMore: false }) })
      .finally(() => setCoinsLoading(false))
  }, [])

  const openSector = (s) => {
    setOpenCat(s)
    setCoinQ('')
    const cached = _sectorCoins.get(s.cgId)
    setCoinState(cached || null)
    if (!cached) loadCoinPage(s, 1)
  }

  useEffect(() => {
    if (_fresh(_allSectorsCache, HIST_TTL)) return undefined
    let cancelled = false
    import('@/services/spectreMarketApi')
      .then(({ getSpectreCategories }) => getSpectreCategories({ limit: 250 }))
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return
        const out = rows.map((r) => ({
          id: r.id,
          cgId: r.cg_id || r.slug || r.id,
          name: r.name,
          marketCap: Number(r.market_cap) || 0,
          change: r.market_cap_change_24h ?? 0,
          volume: Number(r.volume_24h) || 0,
          coins: (r.top_3_coins || []).slice(0, 3),
          count: r.asset_count ?? 0,
          hasMetrics: !!(r._hasMarketMetrics && r.market_cap > 0),
        }))
        if (out.length > 0) _allSectorsCache = { ts: Date.now(), data: out }
        setAll(out)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // ── Sector detail: every coin in the category, paged, with its own search ──
  if (openCat) {
    const rows = coinState?.rows || []
    const cn = coinQ.trim().toLowerCase()
    const shown = cn
      ? rows.filter((c) => c.symbol.toLowerCase().includes(cn) || String(c.name || '').toLowerCase().includes(cn))
      : rows
    return (
      <div className="lite-view">
        <header className="lite-view-head lite-rise">
          <button type="button" className="lite-back" onClick={() => setOpenCat(null)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            {tl(t, 'Sectors', 'ttl')}
          </button>
          <h1 className="lite-view-title">{openCat.name}</h1>
          <p className="lite-view-sub">
            {openCat.count > 0 ? t('lite.msg.n_coins', '{{n}} coins', { n: openCat.count }) : ''}
            {openCat.marketCap > 0 ? ` · ${fmtLargeShort(openCat.marketCap)}` : ''}
          </p>
        </header>
        {openCat.hasMetrics && (
          <div className="lite-statband lite-rise">
            {openCat.marketCap > 0 && (
              <div className="lite-stat">
                <em>{tl(t, 'Sector cap', 'lbl')}</em>
                <strong>{fmtLargeShort(openCat.marketCap)}</strong>
                <span className={`lite-change ${changeCls(openCat.change)}`}>{fmtChange(openCat.change)}</span>
              </div>
            )}
            {openCat.volume > 0 && (
              <div className="lite-stat">
                <em>{tl(t, 'Traded today', 'lbl')}</em>
                <strong>{fmtLargeShort(openCat.volume)}</strong>
                <span>{tl(t, '24h volume', 'msg')}</span>
              </div>
            )}
            {openCat.count > 0 && (
              <div className="lite-stat">
                <em>{tl(t, 'Coins', 'lbl')}</em>
                <strong>{openCat.count.toLocaleString()}</strong>
                <span>{tl(t, 'in this sector', 'msg')}</span>
              </div>
            )}
          </div>
        )}
        <div className="lite-toolrow lite-rise">
          <input
            type="search"
            className="lite-sector-search"
            placeholder={t('lite.msg.search_in_sector', 'Search {{name}}…', { name: openCat.name })}
            value={coinQ}
            onChange={(e) => setCoinQ(e.target.value)}
            aria-label={`Search ${openCat.name}`}
          />
        </div>
        <section className="lite-panel lite-rise-1">
          {!coinState && coinsLoading ? (
            <SkeletonRows n={10} />
          ) : shown.length === 0 ? (
            <p className="lite-empty">{cn ? tl(t, 'No coin matches that search here.', 'msg') : tl(t, 'No coin list for this sector right now.', 'msg')}</p>
          ) : (
            <ul className="lite-tlist">
              {shown.map((c, i) => (
                <TokenRow
                  key={c.id}
                  {...c}
                  rank={cn ? null : i + 1}
                  fmtPrice={fmtPrice}
                  fmtLargeShort={fmtLargeShort}
                  starred={wl?.has ? wl.has(c.symbol) : undefined}
                  onToggleStar={wl ? () => (wl.has(c.symbol) ? wl.remove(c.symbol) : wl.add({ symbol: c.symbol, name: c.name })) : null}
                  onOpen={onPickResearch ? () => onPickResearch(c.symbol) : null}
                />
              ))}
            </ul>
          )}
          {coinState?.hasMore && !cn && (
            <button type="button" className="lite-prolink lite-prolink--inline lite-sector-more" disabled={coinsLoading} onClick={() => loadCoinPage(openCat, (coinState?.page || 1) + 1)}>
              {coinsLoading ? tl(t, 'Loading…', 'msg') : t('lite.msg.load_more_coins', 'Load more ({{n}} of {{total}})', { n: rows.length, total: openCat.count > rows.length ? openCat.count.toLocaleString() : '…' })}
            </button>
          )}
          {cn && coinState?.hasMore && (
            <p className="lite-social-note">{t('lite.msg.search_loaded_note', 'Search covers the {{n}} coins loaded so far - load more to widen it.', { n: rows.length })}</p>
          )}
        </section>
        <ProLink label={t('lite.sectorsview.label', "Categories in PRO")} path="/categories" onOpenPath={onOpenPath} />
      </div>
    )
  }

  // Full universe once fetched; the shared top-12 paints instantly meanwhile.
  const universe = all && all.length > 0 ? all : sectors.map((s) => ({ ...s, hasMetrics: true }))
  const needle = q.trim().toLowerCase()
  const filtered = needle ? universe.filter((s) => String(s.name || '').toLowerCase().includes(needle)) : universe
  const withMetrics = filtered.filter((s) => s.hasMetrics).sort((a, b) => (
    sort === 'move' ? Math.abs(b.change) - Math.abs(a.change)
      : sort === 'volume' ? b.volume - a.volume
        : b.marketCap - a.marketCap
  ))
  const withoutMetrics = filtered.filter((s) => !s.hasMetrics).sort((a, b) => String(a.name).localeCompare(String(b.name)))
  const sorted = [...withMetrics, ...withoutMetrics]
  const visible = needle || showAll ? sorted : sorted.slice(0, 40)
  return (
    <div className="lite-view">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Sectors', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'Every corner of the market, searchable. Tap one to see the coins inside.', 'sub')}</p>
      </header>
      <div className="lite-toolrow lite-rise">
        <input
          type="search"
          className="lite-sector-search"
          placeholder={tl(t, 'Search sectors…', 'msg')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('lite.sectorsview.ariaSearchSectors', "Search sectors")}
        />
        <div className="lite-tf-toggle lite-tf-toggle--sm" role="tablist" aria-label={t('lite.sectorsview.ariaSort', "Sort")}>
          {[{ id: 'size', label: 'By size' }, { id: 'move', label: 'By move' }, { id: 'volume', label: 'By volume' }].map((o) => (
            <button key={o.id} type="button" role="tab" aria-selected={sort === o.id} className={`lite-tf-btn${sort === o.id ? ' active' : ''}`} onClick={() => setSort(o.id)}>{tl(t, o.label)}</button>
          ))}
        </div>
      </div>
      <section className="lite-panel lite-rise-1">
        {universe.length === 0 ? (
          <SkeletonRows n={8} />
        ) : visible.length === 0 ? (
          <p className="lite-empty">{tl(t, 'No sector matches that search.', 'msg')}</p>
        ) : (
          <ul className="lite-tlist">
            {visible.map((s) => (
              <li key={s.id} className="lite-trow lite-trow--link" role="button" tabIndex={0} onClick={() => openSector(s)} onKeyDown={(e) => { if (e.key === 'Enter') openSector(s) }}>
                <span className="lite-sector-logos" aria-hidden>
                  {(s.coins || []).map((src, i) => <img key={i} src={src} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />)}
                </span>
                <span className="lite-trow-id">
                  <strong>{s.name}</strong>
                  {s.count > 0 && <em>{t('lite.msg.n_coins', '{{n}} coins', { n: s.count })}</em>}
                </span>
                {s.marketCap > 0 && <span className="lite-trow-mcap">{fmtLargeShort(s.marketCap)}</span>}
                {s.hasMetrics && <span className={`lite-trow-change ${changeCls(s.change)}`}>{fmtChange(s.change)}</span>}
                <span className="lite-drill-caret lite-drill-caret--fwd" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                </span>
              </li>
            ))}
          </ul>
        )}
        {!needle && !showAll && sorted.length > visible.length && (
          <button type="button" className="lite-prolink lite-prolink--inline lite-sector-more" onClick={() => setShowAll(true)}>
            {t('lite.msg.show_all_sectors', 'Show all {{n}} sectors', { n: sorted.length })}
          </button>
        )}
      </section>
      <ProLink label={t('lite.sectorsview.label', "Categories in PRO")} path="/categories" onOpenPath={onOpenPath} />
    </div>
  )
}

// ── Derivatives (traders-corner reflection): OI + funding one table ──

// ── Gainers (potential-gainers reflection): the momentum signal board ──
// Scores can arrive 0-1 or 0-100 depending on the field's age - same clamp
// the PRO page applies (pg-utils clampScore).
function gainerScore(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return null
  return v > 0 && v <= 1 ? Math.round(v * 100) : Math.round(v)
}

const GAINER_PHASES = [
  { id: 'all', label: 'All' },
  { id: 'fresh', label: 'Fresh', set: ['fresh', 'developing'] },
  { id: 'runner', label: 'Runners', set: ['runner'] },
]

function GainersView({ fmtLargeShort, onOpenPath, onPickResearch }) {
  const { t } = useTranslation()
  const { data: sig, loading } = useMomentumSignals({ timeframe: '7d', bucket: 'top10', watchDays: 10, limit: 30 })
  const { data: perf } = useMomentumSetups({ timeframe: '7d', limit: 10, scanLimit: 500 })
  const [phase, setPhase] = useState('all')

  const rows = useMemo(() => {
    const tokens = sig?.tokens || []
    const wanted = GAINER_PHASES.find((p) => p.id === phase)?.set
    return tokens
      .map((r) => {
        const pg = r.potential_gainer || {}
        return {
          key: r.token?.cg_id || r.token?.symbol,
          cgId: r.token?.cg_id || null,
          symbol: String(r.token?.symbol || '').toUpperCase(),
          name: r.token?.name || r.token?.symbol,
          image: r.token?.image_small || r.token?.image_url || null,
          score: gainerScore(pg.setup_score),
          phase: pg.lifecycle?.phase || null,
          entryMcap: Number(pg.signal?.market_cap) || null,
          mcap: Number(pg.current_market_cap) || null,
          ret: Number(pg.return_since_signal_pct),
        }
      })
      .filter((r) => r.symbol && (!wanted || wanted.includes(r.phase)))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 20)
  }, [sig, phase])

  const ps = perf?.performance_summary
  const phaseLabel = (p) => ({
    fresh: tl(t, 'fresh', 'lbl'), developing: tl(t, 'developing', 'lbl'), runner: tl(t, 'running', 'lbl'),
    already_ran: tl(t, 'already ran', 'lbl'), matured_positive: tl(t, 'matured', 'lbl'), stalled: tl(t, 'stalled', 'lbl'), drawdown: tl(t, 'cooling', 'lbl'),
  })[p] || null

  return (
    <div className="lite-view">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Potential Gainers', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'Small coins with unusual momentum, flagged early and graded honestly.', 'sub')}</p>
      </header>

      {ps && Number(ps.aged_signals) > 0 && (
        <div className="lite-statband lite-rise-1">
          <div className="lite-stat">
            <em>{tl(t, 'Graded signals', 'lbl')}</em>
            <strong>{ps.aged_signals}</strong>
            <span>{tl(t, 'old enough to judge', 'msg')}</span>
          </div>
          {Number.isFinite(Number(ps.average_daily_win_rate_pct)) && (
            <div className="lite-stat">
              <em>{tl(t, 'Daily win rate', 'lbl')}</em>
              <strong>{Number(ps.average_daily_win_rate_pct).toFixed(0)}%</strong>
              <span>{tl(t, 'average across days', 'msg')}</span>
            </div>
          )}
          {Number.isFinite(Number(ps.pnl_100_each)) && Number(ps.invested_100_each) > 0 && (
            <div className="lite-stat">
              <em>{tl(t, '$100 in each', 'lbl')}</em>
              <strong className={Number(ps.pnl_100_each) >= 0 ? 'up' : 'down'}>{Number(ps.pnl_100_each) >= 0 ? '+' : '−'}${Math.abs(Math.round(ps.pnl_100_each)).toLocaleString()}</strong>
              <span>{t('lite.msg.on_invested', 'on {{n}} put in', { n: fmtLargeShort(ps.invested_100_each) })}</span>
            </div>
          )}
        </div>
      )}

      <div className="lite-tf-toggle lite-rise" role="tablist" aria-label={t('lite.gainersview.ariaPhase', "Phase")}>
        {GAINER_PHASES.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={phase === p.id} className={`lite-tf-btn${phase === p.id ? ' active' : ''}`} onClick={() => setPhase(p.id)}>{tl(t, p.label)}</button>
        ))}
      </div>

      <section className="lite-panel lite-rise-1">
        {loading && rows.length === 0 ? (
          <SkeletonRows n={10} />
        ) : rows.length === 0 ? (
          <p className="lite-empty">{tl(t, 'No signals in this bucket right now.', 'msg')}</p>
        ) : (
          <ul className="lite-tlist">
            {rows.map((r) => (
              <li key={r.key} className={`lite-trow${onPickResearch ? ' lite-trow--link' : ''}`} onClick={onPickResearch ? () => onPickResearch(r.symbol, { cgId: r.cgId, name: r.name, image: r.image }) : undefined} role={onPickResearch ? 'button' : undefined} tabIndex={onPickResearch ? 0 : undefined}>
                <span className="lite-trow-logo">
                  {r.image ? <img src={r.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }} /> : null}
                  <span className="lite-trow-fallback" style={r.image ? { display: 'none' } : undefined}>{r.symbol[0]}</span>
                </span>
                <span className="lite-trow-id">
                  <strong>{r.symbol}</strong>
                  {phaseLabel(r.phase) && <em>{phaseLabel(r.phase)}</em>}
                </span>
                {r.mcap > 0 && (
                  <span className="lite-trow-mcap">{r.entryMcap > 0 ? `${fmtLargeShort(r.entryMcap)} → ` : ''}{fmtLargeShort(r.mcap)}</span>
                )}
                {r.score != null && <span className="lite-trow-price">{r.score}</span>}
                {Number.isFinite(r.ret) && <span className={`lite-trow-change ${changeCls(r.ret)}`}>{fmtChange(r.ret)}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="lite-social-note">{tl(t, 'Score blends social momentum with market-cap behaviour since the flag. Small coins move violently both ways - this is a radar, not advice.', 'msg')}</p>
      </section>
      <ProLink label={t('lite.gainersview.label', "Potential Gainers in PRO")} path="/potential-gainers" onOpenPath={onOpenPath} />
    </div>
  )
}

// ── Microcaps (alt-rotation reflection): is money rotating down the curve? ──
// Wave 1 (verdict, indexes, ETH/BTC, majors) rides data the shell mostly holds
// already. The per-chain DEX volume is 4 free DefiLlama calls, so it paints up
// front — but PRO's CoinGecko cohort fan-out (breadth, meme vs utility split,
// leaders: 1-2 requests per chain) only loads for the chain the user OPENS.
// That's the whole trick: Lite gets PRO's information without PRO's 11-request
// boot (founder 07-31: "microcaps loading speed").
let _rotCache = null // { ts: last COMPLETED load, data } — stale data still paints
let _rotLive = null // the wave-by-wave merge target
const _rotCohorts = {} // chain key → cohort, survives view switches

// Instant repaint on a cold reload: the whole view is one small serializable
// object once the OTHERS2 series is thinned (1,282 raw rows → 260 by time, which
// is more than the 200-bucket chart draws anyway).
const ROT_LS_KEY = 'spectre-lite-rot-v1'
const ROT_LS_TTL = 10 * 60_000
let _rotSeed
function rotSeedOnce() {
  if (_rotSeed !== undefined) return _rotSeed
  try {
    const raw = JSON.parse(localStorage.getItem(ROT_LS_KEY))
    _rotSeed = (raw?.ts && Date.now() - raw.ts < ROT_LS_TTL && raw.data) ? raw.data : null
  } catch { _rotSeed = null } // private mode / corrupt
  return _rotSeed
}
function writeRotSeed(state) {
  try {
    const rows = state?.o2rows || []
    const live = state?.o2live || []
    // 🪤 Thin the two series SEPARATELY. rotThinRows buckets by TIME across the
    // whole span, and the model reaches back to 2020 while the tape is a couple
    // of weeks — thinning the merged array would hand the tape ~10 of 260
    // buckets and the seeded chart would repaint as a staircase for a frame.
    localStorage.setItem(ROT_LS_KEY, JSON.stringify({
      ts: Date.now(),
      data: {
        ...state,
        o2rows: rows.length > 260 ? rotThinRows(rows, 260) : rows,
        o2live: live.length > 260 ? rotThinRows(live, 260) : live,
      },
    }))
  } catch { /* quota */ }
}

// Same index set as PRO's chart card: our OTHERS2 line + the CRYPTOCAP family.
const ROT_INDEXES = [
  { id: 'OWN', label: 'OTHERS2', hint: 'Everything outside the top 100 - our own recorded line.' },
  { id: 'CRYPTOCAP:OTHERS', label: 'OTHERS', hint: 'Market cap outside the top 10.' },
  { id: 'CRYPTOCAP:OTHERS.D', label: 'OTHERS.D', hint: "The long tail's share of the whole market - rising means rotation." },
  { id: 'CRYPTOCAP:TOTAL', label: 'TOTAL', hint: 'The whole crypto market.' },
  { id: 'CRYPTOCAP:TOTAL2', label: 'TOTAL2', hint: 'The market without Bitcoin.' },
  { id: 'CRYPTOCAP:TOTAL3', label: 'TOTAL3', hint: 'Without Bitcoin and Ethereum - the purest alt read.' },
]
// 🪤 OTHERS2 is NOT recorded back to 2020 - that older half is a weekly MODEL
// the box seeded before the 15-min recorder existed (2026-07-22). Charting both
// as one line drew a smooth synthetic ramp welded to a real tape: a monotonic
// staircase for the model's year, then a cliff where 15-min data crushed into
// the last few buckets. The chart now takes the TAPE only, so the ranges are
// what we have actually measured; the model still feeds the cycle-depth gauge,
// which is an explicit "floor → 2021 peak" range read where a model is fair.
const ROT_O2_RANGES = [{ k: 1, label: '24H' }, { k: 7, label: '7D' }, { k: 99999, label: 'ALL' }]
const ROT_DEX_TFS = [{ k: 30, label: '30D' }, { k: 90, label: '90D' }, { k: 180, label: '6M' }, { k: 400, label: '1Y' }]
const ROT_BAND_TONE = { dead: 'down', notyet: 'down', stirring: 'flat', rotating: 'up', gotime: 'up', unknown: 'flat' }
const ROT_DEPTH_ZONE = {
  capitulation: 'Deep in the cold - the tail is where nobody wants it.',
  basing: 'Basing - the long tail has stopped falling, but nothing is running yet.',
  'mid-cycle': 'Mid-cycle - the tail has lifted off its floor.',
  elevated: 'Elevated - the long tail is near the top of its range.',
}

// OTHERS2 is recorded densely today but back-filled sparsely (1,282 points, ~937
// of them in the last 90 days), and LiteSpark plots by INDEX - so drawing the
// raw rows would give five years of history a quarter of the width and the last
// quarter a three-quarter share. Resample onto equal TIME buckets first, last
// value per bucket, carrying the previous value across a gap in the recording.
function rotThinRows(rows, buckets = 200) {
  if (!rows || rows.length < 2) return rows || []
  const t0 = rows[0].ts, t1 = rows[rows.length - 1].ts
  const span = t1 - t0
  if (span <= 0) return rows
  const out = new Array(buckets).fill(null)
  for (const r of rows) out[Math.min(buckets - 1, Math.floor(((r.ts - t0) / span) * buckets))] = r
  let last = null
  for (let i = 0; i < buckets; i += 1) { if (out[i] == null) out[i] = last; else last = out[i] }
  return out.filter(Boolean)
}
const rotTimeSeries = (rows, buckets = 200) => rotThinRows(rows, buckets).map((r) => r.o)

// How many median bars each OTHERS2 range draws. Fewer bars = more samples per
// bar = less of the derived-metric noise medianBars() exists to absorb (see the
// note there). 24H over 15-min samples is only ~96 readings, so it gets the
// finest grid it can support; ALL gets the coarsest.
const ROT_O2_BARS = { 1: 24, 7: 42, 99999: 36 }

// Daily on-chain DEX volume bars. Volume is never negative, so one baseline and
// a trend colour is the whole chart - no axis needed at this size.
function LiteDexBars({ chart, days = 60, height = 44, up = true }) {
  const pts = useMemo(() => (Array.isArray(chart) ? chart.slice(-days) : []), [chart, days])
  if (pts.length < 2) return null
  const W = 300, H = height
  const max = Math.max(1, ...pts.map((p) => p.v))
  const n = pts.length
  const gap = n > 120 ? 0.25 : 0.8
  const bw = Math.max(0.5, (W - gap * (n - 1)) / n)
  return (
    <svg className={`lite-rot-bars ${up ? 'up' : 'down'}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }} aria-hidden>
      {pts.map((p, i) => {
        const h = Math.max(0.7, (p.v / max) * (H - 1))
        return <rect key={p.ts || i} className={i === n - 1 ? 'last' : undefined} x={i * (bw + gap)} y={H - h} width={bw} height={h} />
      })}
    </svg>
  )
}

// One chain: DEX volume up front, the token cohort on demand.
function RotChainCard({ chain, open, onToggle, cohort, fmtLargeShort }) {
  const { t } = useTranslation()
  const [tf, setTf] = useState(90)
  const dex = chain.dex
  const up = Number.isFinite(dex?.chg7d) ? dex.chg7d >= 0 : true
  const pct = (v, win) => (Number.isFinite(v)
    ? <span className={`lite-change ${changeCls(v)}`}>{fmtChange(v)}{win && <em className="lite-rot-win">{win}</em>}</span>
    : <span className="lite-rot-na">—</span>)
  return (
    <div className={`lite-rot-chain${open ? ' open' : ''}`}>
      <button type="button" className="lite-rot-chain-head" onClick={onToggle} aria-expanded={open}>
        <span className="lite-rot-chain-id"><i style={{ background: chain.accent }} aria-hidden />{chain.name}</span>
        <span className="lite-rot-chain-vol">{Number.isFinite(dex?.vol24h) ? fmtLargeShort(dex.vol24h) : '—'}<em>{tl(t, 'traded 24h', 'lbl')}</em></span>
        {pct(dex?.chg7d, '7d')}
        <svg className="lite-rot-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {dex?.chart?.length > 1
        ? <LiteDexBars chart={dex.chart} days={open ? tf : 60} height={open ? 118 : 44} up={up} />
        : chain.loading
          ? <span className="lite-rot-barskel" style={{ height: open ? 118 : 44 }} aria-hidden />
          : <p className="lite-rot-na lite-rot-nochart">{tl(t, 'No on-chain volume feed for this chain yet.', 'msg')}</p>}
      {open && (
        <div className="lite-rot-open">
          {dex?.chart?.length > 1 && (
            <div className="lite-tf-toggle lite-tf-toggle--sm" role="tablist" aria-label={t('lite.rotchain.ariaVolumeRange', "Volume range")}>
              {ROT_DEX_TFS.map((o) => (
                <button key={o.k} type="button" role="tab" aria-selected={tf === o.k} className={`lite-tf-btn${tf === o.k ? ' active' : ''}`} onClick={() => setTf(o.k)}>{o.label}</button>
              ))}
            </div>
          )}
          <ul className="lite-mini-list">
            <li className="lite-mini-row">
              <span className="lite-mini-sym">{tl(t, 'Volume 7 days', 'lbl')}</span>
              <span className="lite-rot-val">{Number.isFinite(dex?.vol7d) ? fmtLargeShort(dex.vol7d) : '—'}</span>
              {pct(dex?.chg7d, '7d')}
            </li>
            <li className="lite-mini-row">
              <span className="lite-mini-sym">{tl(t, 'Versus a month ago', 'lbl')}</span>
              {/* a chain younger than a month has no honest 30d comparison */}
              {dex?.chart && dex.chart.length < 32
                ? <span className="lite-rot-na lite-rot-young">{tl(t, 'too new to compare', 'msg')}</span>
                : <span className="lite-rot-val">{tl(t, 'swap volume', 'msg')}</span>}
              {pct(dex?.chg30d, '30d')}
            </li>
          </ul>
          {!cohort ? <SkeletonRows n={4} /> : (
            <>
              <ul className="lite-mini-list">
                <li className="lite-mini-row">
                  <span className="lite-mini-sym">{tl(t, 'Tokens green', 'lbl')}</span>
                  <span className="lite-rot-val">{Number.isFinite(cohort.breadth7d) ? `${Math.round(cohort.breadth7d)}%` : '—'}</span>
                  <span className="lite-rot-of">{tl(t, 'of', 'lbl')} {cohort.count}</span>
                </li>
                <li className="lite-mini-row">
                  <span className="lite-mini-sym">{tl(t, 'Typical move', 'lbl')}</span>
                  <span className="lite-rot-val">{tl(t, 'middle token', 'msg')}</span>
                  {pct(cohort.med30d, '30d')}
                </li>
                <li className="lite-mini-row">
                  <span className="lite-mini-sym">{tl(t, 'Memes', 'lbl')}</span>
                  <span className="lite-rot-val">{cohort.meme?.count || 0} {tl(t, 'tokens', 'lbl')}</span>
                  {pct(cohort.meme?.med7d, '7d')}
                </li>
                <li className="lite-mini-row">
                  <span className="lite-mini-sym">{tl(t, 'Utilities', 'lbl')}</span>
                  <span className="lite-rot-val">{cohort.utility?.count || 0} {tl(t, 'tokens', 'lbl')}</span>
                  {pct(cohort.utility?.med7d, '7d')}
                </li>
              </ul>
              {cohort.leaders?.length > 0 && (
                <div className="lite-rot-leaders">
                  {cohort.leaders.slice(0, 4).map((l) => (
                    <span className="lite-rot-lead" key={l.sym} title={l.name}>
                      <CoinDot src={l.image} sym={l.sym} />
                      <b>{l.sym}</b>
                      {Number.isFinite(l.chg7d) && <em className={`lite-change ${changeCls(l.chg7d)}`}>{fmtChange(l.chg7d)}</em>}
                    </span>
                  ))}
                </div>
              )}
              <p className="lite-social-note">{tl(t, 'Meme vs utility is our own estimate from token names - a read, not a registry.', 'msg')}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function RotationView({ data, fmtLargeShort, onOpenPath, light }) {
  // Same one preference the Today chart panels read, so the index chart in
  // Microcaps cannot disagree with them about what a chart looks like.
  const ixChartStyle = useSettingsStore((st) => st.liteChartStyle)
  const { t } = useTranslation()
  // stale-while-revalidate: whatever we already have paints on frame one
  const [rot, setRot] = useState(() => _rotCache?.data || _rotLive || rotSeedOnce())
  const [ix, setIx] = useState('OWN')
  const [tvTf, setTvTf] = useState('240')
  const [ixFull, setIxFull] = useState(false)
  const [o2Range, setO2Range] = useState(7)
  const [openChain, setOpenChain] = useState(null)
  const [cohorts, setCohorts] = useState(_rotCohorts)
  const { altSeason } = data
  const activeIx = ROT_INDEXES.find((i) => i.id === ix) || ROT_INDEXES[0]

  // FOUR INDEPENDENT WAVES, each painting the moment it lands. They used to sit
  // behind one Promise.all, which meant first paint waited on the SLOWEST leg -
  // and the per-chain volume feed measures 0.8s for Ethereum but 2.9s for Base
  // and 7.0s for Robinhood Chain. The box leg answers in ~0.4s, so the verdict,
  // the stats, the depth gauge and the chart now paint there and the chain
  // cards fill in one by one underneath.
  useEffect(() => {
    if (_fresh(_rotCache, LIVE_TTL)) return undefined
    let cancelled = false
    _rotLive = { ...(_rotLive || _rotCache?.data || rotSeedOnce() || {}) }
    const patch = (p) => {
      _rotLive = { ..._rotLive, ...p }
      if (!cancelled) setRot(_rotLive)
    }
    // the four cards exist from frame one; each fills when its feed answers
    patch({ chains: ROT_CHAINS.map((c) => ({ key: c.key, name: c.name, short: c.short, accent: c.accent, dex: _rotLive.chains?.find((x) => x.key === c.key)?.dex || null, loading: true })) })

    const waves = [
      // WAVE A - the box. Everything above the fold comes from here (~0.4s).
      import('@/services/spectreMarketApi').then((m) => Promise.all([
        m.getSpectreGlobalMetrics().catch(() => null),
        m.getSpectreDominanceHistory(35).catch(() => null),
        // full history (not 365): one cached request that pays for the cycle
        // depth read AND the ALL range on the chart.
        m.getSpectreOthers2History().catch(() => null),
        m.getSpectrePricesBySymbols(['BTC', 'ETH', 'SOL']).catch(() => null),
      ])).then(([global, domHist, others2, majors]) => {
        const domRows = (Array.isArray(domHist) ? domHist : domHist?.history) || []
        const domVals = domRows.map((r) => Number(r.btc ?? r.btcDominance ?? r.btc_dominance ?? r.value)).filter(Number.isFinite)
        // chain-linked, same as PRO: a measurement seam must not read as a move
        const o2rows = chainLink((others2?.history || []).filter((r) => r.ts > 0 && r.o > 0))
        // The measured tape, split out from the weekly model that precedes it.
        // Everything that says "this is what the long tail DID" reads this;
        // only the cycle-depth gauge (an explicit floor→peak range) reads the
        // full series. See the note on ROT_O2_RANGES.
        const o2live = o2rows.filter((r) => r.src !== 'modeled')
        const o2current = Number(others2?.current?.others2) || (o2live.length ? o2live[o2live.length - 1].o : (o2rows.length ? o2rows[o2rows.length - 1].o : null))
        const btcDom = Number(global?.btcDominance) || null
        const majorRows = ['BTC', 'ETH', 'SOL'].map((sym) => {
          const p = majors?.[sym]
          return { sym, d7: Number(p?.change7d ?? p?.change?.['7d']), d30: Number(p?.change30d ?? p?.change?.['30d']) }
        })
        const maj30 = majorRows.filter((m) => Number.isFinite(m.d30)).sort((a, b) => b.d30 - a.d30)
        patch({
          btcDom,
          // same shape as PRO: live dominance minus where it stood 30d back
          domDelta: domVals.length > 1 ? (btcDom ?? domVals[domVals.length - 1]) - domVals[0] : null,
          o2rows,
          o2live,
          o2liveFrom: Number(others2?.liveFrom) || (o2live.length ? o2live[0].ts : null),
          o2current,
          // 7d trend off the tape: on the mixed series a thin week would fall
          // back to `hist[0]` and quietly compare today against a 2020 model row.
          o2trendWin: buildTrendWindow(o2live.length > 1 ? o2live : o2rows, o2current),
          majors: majorRows,
          majorsAvg30d: maj30.length ? maj30.reduce((s, m) => s + m.d30, 0) / maj30.length : null,
          topMajor: maj30[0] ? { sym: maj30[0].sym, chg30d: maj30[0].d30 } : null,
        })
      }),
      // WAVE B - the alt cohort (CoinGecko top-250). Feeds breadth + alt index.
      import('@/services/coinGeckoApi').then((m) => m.getOthers2Data()).then((og) => {
        patch({
          altIndex: Number(og?.breadth?.index),
          breadth: og?.breadth || null,
          alts7: Number(og?.aggChanges?.d7),
          alts30: Number(og?.aggChanges?.d30),
        })
      }),
      // WAVE C - ETH priced in BTC, the classic rotation signal. CG serves the
      // ratio directly via vs_currency=btc; one cheap daily series.
      fetch('/api/coingecko/coins/ethereum/market_chart?vs_currency=btc&days=365&interval=daily')
        .then((r) => (r.ok ? r.json() : null))
        .then((raw) => {
          const ethBtc = (raw?.prices || []).map((p) => Number(p?.[1])).filter(Number.isFinite)
          patch({
            ethBtc,
            ethBtcNow: ethBtc.length ? ethBtc[ethBtc.length - 1] : null,
            ethBtc30: ethBtc.length > 31 ? ((ethBtc[ethBtc.length - 1] / ethBtc[ethBtc.length - 31]) - 1) * 100 : null,
          })
        }),
      // WAVE D - one per chain, NOT a Promise.all: a 7s chain must not hold the
      // three fast ones hostage. Free, keyless, cached 2.5 min, shared with PRO.
      ...ROT_CHAINS.map((c) => dexVolume(c.dexSlug)
        .then((dex) => patch({ chains: (_rotLive.chains || []).map((x) => (x.key === c.key ? { ...x, dex, loading: false } : x)) }))
        .catch(() => patch({ chains: (_rotLive.chains || []).map((x) => (x.key === c.key ? { ...x, loading: false } : x)) }))),
    ]

    Promise.allSettled(waves).then(() => {
      if (cancelled) return
      _rotCache = { ts: Date.now(), data: _rotLive }
      writeRotSeed(_rotLive)
    })
    return () => { cancelled = true }
  }, [])

  // the CoinGecko cohort for ONE chain, only once the user opens it
  useEffect(() => {
    if (!openChain || _rotCohorts[openChain]) return undefined
    let cancelled = false
    const chain = ROT_CHAINS.find((c) => c.key === openChain)
    if (!chain) return undefined
    loadChainCohort(chain)
      .then((res) => {
        if (cancelled || !res) return
        _rotCohorts[openChain] = res
        setCohorts({ ..._rotCohorts })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [openChain])

  const asValue = Number(altSeason?.value ?? altSeason?.index)
  const band = !Number.isFinite(asValue) ? null
    : asValue >= 75 ? tl(t, 'Alt season - the long tail is leading.', 'msg')
      : asValue >= 50 ? tl(t, 'Rotating - money is drifting down the risk curve.', 'msg')
        : asValue >= 25 ? tl(t, 'Stirring - a few alts move, most still sleep.', 'msg')
          : tl(t, "Bitcoin's market - alts are waiting their turn.", 'msg')

  // The PRO verdict, computed from the data Lite already holds - same module,
  // same weights, so the two pages can never print different scores.
  const verdict = useMemo(() => {
    if (!rot) return null
    const fin = (v) => (Number.isFinite(v) ? v : null)
    const majorsVsAlts = Number.isFinite(rot.alts30) && rot.majorsAvg30d != null
      ? rot.alts30 - rot.majorsAvg30d
      : fin(rot.alts7)
    const v = buildVerdict({
      domDelta30d: fin(rot.domDelta),
      altSeasonIdx: fin(rot.altIndex) ?? fin(asValue),
      breadth7d: fin(Number(rot.breadth?.green7)) ?? fin(Number(rot.breadth?.green30)),
      others2Trend7d: fin(rot.o2trendWin?.pct),
      others2TrendDays: rot.o2trendWin?.days,
      majorsVsAlts,
      // wave D already put the per-chain DEX tape on `rot.chains`, so the
      // on-chain leg costs Lite nothing — and PRO and Lite stay unable to print
      // different scores, which is the whole point of the shared module.
      onchain: onchainPulse(rot.chains),
    })
    v.setup = buildSetup({ majorsAvg30d: rot.majorsAvg30d, topMajor: rot.topMajor, alt30d: fin(rot.alts30), others2Trend7d: fin(rot.o2trendWin?.pct) })
    return v
  }, [rot, asValue])

  const depth = useMemo(() => (rot ? buildDepth(rot.o2rows, rot.o2current) : null), [rot])

  const o2points = useMemo(() => {
    const rows = (rot?.o2live?.length ? rot.o2live : (rot?.o2rows || []).filter((r) => r.src !== 'modeled'))
    if (rows.length < 2) return []
    const cut = Date.now() - o2Range * 864e5
    const sel = rows.filter((r) => r.ts >= cut)
    return medianBars(sel.length > 8 ? sel : rows, ROT_O2_BARS[o2Range] || 42, rot?.o2current).map((r) => r.o)
  }, [rot, o2Range])
  // How much tape there actually is, so the panel can say so instead of
  // implying a year of history behind a 24H button.
  const o2span = useMemo(() => {
    const from = rot?.o2liveFrom
    if (!from) return null
    const days = (Date.now() - from) / 864e5
    return { from, days, label: days < 1.5 ? 'today' : days < 45 ? `${Math.round(days)} days` : `${Math.round(days / 30)} months` }
  }, [rot])

  // waves land out of order, so every consumer must tolerate a partial `rot`
  const perfRows = rot?.majors ? [
    ...rot.majors,
    { sym: tl(t, 'Alts (OTHERS)', 'lbl'), d7: rot.alts7, d30: rot.alts30, alt: true },
  ] : null

  return (
    <div className="lite-view lite-view--wide">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Microcaps', 'ttl')}</h1>
        <p className="lite-view-sub">{band || tl(t, 'Is money leaving Bitcoin for the smaller coins?', 'sub')}</p>
      </header>

      <div className="lite-statband lite-rise-1">
        {Number.isFinite(asValue) && asValue > 0 && (
          <div className="lite-stat">
            <em>{t('lite.lbl.alt_season', 'Alt Season')}</em>
            <strong>{Math.round(asValue)}</strong>
            <span>{(altSeason?.label || altSeason?.season) ? tl(t, altSeason.label || altSeason.season, 'msg') : tl(t, 'out of 100', 'msg')}</span>
          </div>
        )}
        {rot?.btcDom > 0 && (
          <div className="lite-stat">
            <em>{tl(t, 'Bitcoin share', 'lbl')}</em>
            <strong>{rot.btcDom.toFixed(1)}%</strong>
            {Number.isFinite(rot.domDelta) ? (
              <span className={rot.domDelta <= 0 ? 'up' : 'down'}>{rot.domDelta > 0 ? '+' : ''}{rot.domDelta.toFixed(1)} pts / 30d</span>
            ) : <span>{tl(t, 'of the whole market', 'msg')}</span>}
          </div>
        )}
        {rot?.breadth?.total > 0 && (
          <div className="lite-stat">
            <em>{tl(t, 'Beating Bitcoin', 'lbl')}</em>
            <strong>{rot.breadth.outperforming}<span className="lite-stat-of">/{rot.breadth.total}</span></strong>
            <span>{tl(t, 'alts ahead over 30 days', 'msg')}</span>
          </div>
        )}
        {Number.isFinite(rot?.o2trendWin?.pct) && (
          <div className="lite-stat">
            {/* the window is whatever the tape can honestly support — after a
                measurement seam that is hours, not seven days (see buildTrendWindow) */}
            <em>{tl(t, 'Long tail', 'lbl')}, {rot.o2trendWin.days >= 1 ? `${Math.round(rot.o2trendWin.days)}d` : `${Math.max(1, Math.round(rot.o2trendWin.days * 24))}h`}</em>
            <strong className={rot.o2trendWin.pct >= 0 ? 'up' : 'down'}>{fmtChange(rot.o2trendWin.pct)}</strong>
            <span>{tl(t, 'the market beyond the top 10', 'msg')}</span>
          </div>
        )}
      </div>

      {/* Two columns from 1100px up: the chain volume board is the reason people
          open this view, so it leads - it must never sit below the fold. */}
      <div className="lite-grid lite-rot-grid">
      <section className="lite-panel lite-rise-1 lite-span-6 lite-rot-chainpanel">
        <div className="lite-block-head">
          <p className="lite-eyebrow">{tl(t, 'Money actually trading on-chain', 'lbl')}</p>
          <span className="lite-rot-src">{tl(t, 'daily swap volume', 'lbl')}</span>
        </div>
        <div className="lite-rot-chains">
          {(rot?.chains || ROT_CHAINS.map((c) => ({ key: c.key, name: c.name, accent: c.accent, loading: true }))).map((c) => (
            <RotChainCard
              key={c.key}
              chain={c}
              open={openChain === c.key}
              onToggle={() => setOpenChain(openChain === c.key ? null : c.key)}
              cohort={cohorts[c.key]}
              fmtLargeShort={fmtLargeShort}
            />
          ))}
        </div>
        <p className="lite-social-note">{tl(t, 'How much money actually changes hands on each chain - the honest "is anyone here" signal. Rising volume with a rising tail is what a real rotation looks like. Open a chain for its tokens.', 'msg')}</p>
      </section>

      {verdict?.score != null && (
        <section className="lite-panel lite-rise-1 lite-span-6 lite-rot-verdict">
          <p className="lite-eyebrow">{tl(t, 'Rotation verdict', 'lbl')}</p>
          <div className="lite-rot-verdict-top">
            <strong className={`lite-rot-word ${ROT_BAND_TONE[verdict.band] || 'flat'}`}>{tl(t, verdict.label, 'msg')}</strong>
            <span className="lite-rot-score">{verdict.score}<em>/100</em></span>
          </div>
          <div className={`lite-rot-meter ${ROT_BAND_TONE[verdict.band] || 'flat'}`}><span style={{ width: `${verdict.score}%` }} /></div>
          {verdict.setup && <p className="lite-rot-setup">{tl(t, verdict.setup.text, 'msg')}</p>}
          {verdict.reasons?.length > 0 && (
            <ul className="lite-mini-list">
              {verdict.reasons.map((r) => (
                <li className="lite-mini-row" key={r.label}>
                  <span className="lite-mini-sym lite-rot-reason">{tl(t, r.label, 'lbl')}</span>
                  <span className={`lite-rot-val ${r.signal === 'bull' ? 'up' : r.signal === 'bear' ? 'down' : ''}`}>{r.value}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="lite-social-note">{tl(t, 'Five grounded signals, weighted: dominance, alt season, breadth, the long tail and alts against the majors.', 'msg')}</p>
        </section>
      )}

      {/* PANEL ORDER IS HEIGHT ORDER on this board. The two-column grid pairs
          panels row by row, so putting the 190px depth gauge beside the 380px
          index chart left a ~195px hole under it - the ragged step the founder
          flagged (08-07: "page need optimisation so things fit together").
          Charts now sit with charts (indexes ‖ ETH/BTC) and the two short
          range reads sit together (depth ‖ majors vs the field), which also
          reads better: the line, then the ratio, then where both sit in
          their range. */}
      <section className="lite-panel lite-rise-1 lite-span-6">
        <div className="lite-block-head">
          <p className="lite-eyebrow">{tl(t, 'The indexes', 'lbl')}</p>
          <div className="lite-block-tools">
            {ix === 'OWN' ? (
              <>
                {rot?.o2current > 0 && <span className="lite-rot-current">{fmtLargeShort(rot.o2current)}</span>}
                <div className="lite-tf-toggle lite-tf-toggle--sm" role="tablist" aria-label={t('lite.rotationview.ariaRange', "Range")}>
                  {ROT_O2_RANGES.map((o) => (
                    <button key={o.k} type="button" role="tab" aria-selected={o2Range === o.k} className={`lite-tf-btn${o2Range === o.k ? ' active' : ''}`} onClick={() => setO2Range(o.k)}>{o.label}</button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="lite-tf-toggle lite-tf-toggle--sm" role="tablist" aria-label={t('lite.rotationview.ariaTimeframe', "Timeframe")}>
                  {LITE_TV_TF.map((o) => (
                    <button key={o.k} type="button" role="tab" aria-selected={tvTf === o.k} className={`lite-tf-btn${tvTf === o.k ? ' active' : ''}`} onClick={() => setTvTf(o.k)}>{o.label}</button>
                  ))}
                </div>
                <TvExpandButton onClick={() => setIxFull(true)} />
              </>
            )}
          </div>
        </div>
        <div className="lite-tf-toggle lite-tf-toggle--sm lite-rot-ix" role="tablist" aria-label={t('lite.rotationview.ariaIndex', "Index")}>
          {ROT_INDEXES.map((i) => (
            <button key={i.id} type="button" role="tab" aria-selected={ix === i.id} className={`lite-tf-btn${ix === i.id ? ' active' : ''}`} onClick={() => setIx(i.id)}>{i.label}</button>
          ))}
        </div>
        {ix === 'OWN' ? (
          !rot ? <SkeletonRows n={5} /> : o2points.length > 8 ? (
            <>
              <LiteSpark points={o2points} height={190} />
              <p className="lite-social-note">
                {tl(t, 'Total market cap of everything outside the top 100 coins. When this line leads, alt season is on.', 'msg')}
                {o2span && ` ${tl(t, 'Our own recording, every 15 minutes since', 'msg')} ${new Date(o2span.from).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} - ${o2span.label} ${tl(t, 'of tape, smoothed on a rolling median so one noisy reading is not a crash', 'msg')}.`}
              </p>
            </>
          ) : <p className="lite-empty">{tl(t, 'Chart is warming up.', 'msg')}</p>
        ) : (
          <>
            <LiteTvFrame symbol={ix} interval={tvTf} light={light} height={280} title={activeIx.label} chartStyle={ixChartStyle} />
            <p className="lite-social-note">{tl(t, activeIx.hint, 'msg')}</p>
          </>
        )}
        {ixFull && ix !== 'OWN' && (
          <LiteTvFullOverlay
            symbol={ix}
            label={activeIx.label}
            tf={tvTf}
            setTf={setTvTf}
            light={light}
            onClose={() => setIxFull(false)}
            options={ROT_INDEXES.filter((i) => i.id !== 'OWN').map((i) => ({ id: i.id, label: i.label }))}
          />
        )}
      </section>

      <section className="lite-panel lite-rise-1 lite-span-6">
        <div className="lite-block-head">
          <p className="lite-eyebrow">ETH / BTC</p>
          {rot?.ethBtcNow > 0 && (
            <span className="lite-zig-price">
              <strong>{rot.ethBtcNow.toFixed(5)}</strong>
              {Number.isFinite(rot.ethBtc30) && (
                <span className={`lite-change ${changeCls(rot.ethBtc30)}`}>{fmtChange(rot.ethBtc30)} <em className="lite-rot-win">30d</em></span>
              )}
            </span>
          )}
        </div>
        {!rot?.ethBtc ? <SkeletonRows n={4} /> : rot.ethBtc.length > 8 ? (
          <>
            <LiteSpark points={rot.ethBtc} height={140} />
            <p className="lite-social-note">
              {Number.isFinite(rot.ethBtc30) && rot.ethBtc30 >= 0
                ? tl(t, 'Ethereum priced in Bitcoin, one year. Rising - ETH is gaining on BTC, the classic first leg of a rotation into alts.', 'msg')
                : tl(t, 'Ethereum priced in Bitcoin, one year. Falling - ETH keeps losing ground to BTC, and alts rarely run while it does.', 'msg')}
            </p>
          </>
        ) : <p className="lite-empty">{tl(t, 'Chart is warming up.', 'msg')}</p>}
      </section>

      {depth && (
        <section className="lite-panel lite-rise-1 lite-span-6">
          <div className="lite-block-head">
            <p className="lite-eyebrow">{tl(t, 'How deep is the tail', 'lbl')}</p>
            <span className={`lite-rot-depth-pct ${depth.posInRange < 45 ? 'down' : 'up'}`}>{Math.round(depth.pctBelowPeak)}% {tl(t, 'below its peak', 'msg')}</span>
          </div>
          <div className="lite-rot-depth-track"><span className="lite-rot-depth-marker" style={{ left: `${depth.posInRange}%` }} /></div>
          <div className="lite-rot-depth-scale">
            <span>{fmtLargeShort(depth.low)}<em>{tl(t, 'cycle floor', 'lbl')}</em></span>
            <span className="lite-rot-depth-zone">{tl(t, depth.zone, 'lbl')}</span>
            <span className="lite-rot-depth-right">{fmtLargeShort(depth.ath)}<em>{depth.athYear ? `${depth.athYear} ${tl(t, 'peak', 'lbl')}` : tl(t, 'peak', 'lbl')}</em></span>
          </div>
          {/* The floor and the peak come from the MODELED weekly series, which
              is the one job that reconstruction is honestly good for - a range,
              not a tape. Say so, because the chart above deliberately does not
              use it. */}
          <p className="lite-social-note">{tl(t, ROT_DEPTH_ZONE[depth.zone] || '', 'msg')} {tl(t, 'Measured on the total value of every coin outside the top 100; the floor and the peak come from our modelled cycle history, not the live tape.', 'msg')}</p>
        </section>
      )}

      <section className="lite-panel lite-rise-1 lite-span-6">
        <p className="lite-eyebrow">{tl(t, 'Majors vs the field', 'lbl')}</p>
        {!perfRows ? <SkeletonRows n={4} /> : (
          <ul className="lite-mini-list">
            {perfRows.map((r) => (
              <li key={r.sym} className="lite-mini-row">
                <span className="lite-mini-sym" style={{ minWidth: 110 }}>{r.sym}</span>
                <span className={`lite-change ${changeCls(r.d7)}`}>{Number.isFinite(r.d7) ? fmtChange(r.d7) : '—'} <em className="lite-rot-win">7d</em></span>
                <span className={`lite-change ${changeCls(r.d30)}`}>{Number.isFinite(r.d30) ? fmtChange(r.d30) : '—'} <em className="lite-rot-win">30d</em></span>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>
      <ProLink label={t('lite.rotationview.label', "Microcaps in PRO")} path="/alt-rotation" onOpenPath={onOpenPath} />
    </div>
  )
}

// ── Private Markets (private-markets reflection): venture deals + pre-IPO ──
// The page's own service module carries TTL caches + localStorage seeds, so
// Lite just calls it; rows arrive server-filtered (amount > 0, dated).
let _pmCache = null

function PrivateView({ fmtLargeShort, onOpenPath }) {
  const { t } = useTranslation()
  const [pm, setPm] = useState(() => _fresh(_pmCache, ODDS_TTL))
  const [tab, setTab] = useState('deals')
  const [sort, setSort] = useState('latest')

  useEffect(() => {
    if (_fresh(_pmCache, ODDS_TTL)) return undefined
    let cancelled = false
    import('@/pages/private-markets/components/private-markets-api')
      .then((m) => Promise.all([m.getPrivateDeals(), m.getPrivateStats(), m.getPreIPO()]))
      .then(([deals, stats, preipo]) => {
        if (cancelled) return
        const out = { deals: deals || [], stats: stats || null, roster: preipo?.roster || [], preSummary: preipo?.summary || null }
        _pmCache = { ts: Date.now(), data: out }
        setPm(out)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const dealRows = useMemo(() => {
    if (!pm) return null
    const rows = [...pm.deals]
    rows.sort((a, b) => (sort === 'biggest' ? (b.amountUsd || 0) - (a.amountUsd || 0) : new Date(b.date) - new Date(a.date)))
    return rows.slice(0, 24)
  }, [pm, sort])

  const s = pm?.stats?.summary
  const totalRaised = Number(s?.total_raised) || (pm ? pm.deals.reduce((acc, d) => acc + (Number(d.amountUsd) || 0), 0) : 0)

  return (
    <div className="lite-view">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Private Markets', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'The money moving before a token or a ticker exists.', 'sub')}</p>
      </header>

      {pm && (
        <div className="lite-statband lite-rise-1">
          <div className="lite-stat">
            <em>{tl(t, 'Deals tracked', 'lbl')}</em>
            <strong>{(Number(s?.total_rounds) || pm.deals.length).toLocaleString()}</strong>
            <span>{tl(t, 'recent rounds', 'msg')}</span>
          </div>
          {totalRaised > 0 && (
            <div className="lite-stat">
              <em>{tl(t, 'Raised', 'lbl')}</em>
              <strong>{fmtLargeShort(totalRaised)}</strong>
              <span>{tl(t, 'across those rounds', 'msg')}</span>
            </div>
          )}
          {Number(s?.unique_investors) > 0 && (
            <div className="lite-stat">
              <em>{tl(t, 'Investors', 'lbl')}</em>
              <strong>{Number(s.unique_investors).toLocaleString()}</strong>
              <span>{tl(t, 'writing the checks', 'msg')}</span>
            </div>
          )}
          {Number(pm.preSummary?.totalValuation) > 0 && (
            <div className="lite-stat">
              <em>{tl(t, 'Pre-IPO board', 'lbl')}</em>
              <strong>{fmtLargeShort(pm.preSummary.totalValuation)}</strong>
              <span>{t('lite.msg.n_companies', '{{n}} companies', { n: pm.preSummary.count })}</span>
            </div>
          )}
        </div>
      )}

      <div className="lite-toolrow lite-rise">
        <div className="lite-tf-toggle" role="tablist" aria-label={t('lite.privateview.ariaSection', "Section")}>
          {[{ id: 'deals', label: 'Deals' }, { id: 'preipo', label: 'Pre-IPO' }].map((o) => (
            <button key={o.id} type="button" role="tab" aria-selected={tab === o.id} className={`lite-tf-btn${tab === o.id ? ' active' : ''}`} onClick={() => setTab(o.id)}>{tl(t, o.label)}</button>
          ))}
        </div>
        {tab === 'deals' && (
          <div className="lite-tf-toggle lite-tf-toggle--sm" role="tablist" aria-label={t('lite.privateview.ariaSort', "Sort")}>
            {[{ id: 'latest', label: 'Latest' }, { id: 'biggest', label: 'Biggest' }].map((o) => (
              <button key={o.id} type="button" role="tab" aria-selected={sort === o.id} className={`lite-tf-btn${sort === o.id ? ' active' : ''}`} onClick={() => setSort(o.id)}>{tl(t, o.label)}</button>
            ))}
          </div>
        )}
      </div>

      <section className="lite-panel lite-rise-1">
        {tab === 'preipo' ? (
          !pm ? <SkeletonRows n={9} /> : pm.roster.length === 0 ? (
            <p className="lite-empty">{tl(t, 'The pre-IPO board is warming up.', 'msg')}</p>
          ) : (
            <ul className="lite-tlist">
              {pm.roster.slice(0, 14).map((r) => (
                <li key={r.company} className="lite-trow">
                  <DealLogo name={r.company} logoUrl={r.logoUrl} domain={r.domain || r.website || null} />
                  <span className="lite-trow-id">
                    <strong>{r.company}</strong>
                    {r.sector && <em>{r.sector}</em>}
                  </span>
                  {Number(r.currentValuation) > 0 && <span className="lite-trow-mcap">{fmtLargeShort(r.currentValuation)}</span>}
                  {Number(r.valuationMultiple) > 1 && <span className="lite-trow-change up">×{Number(r.valuationMultiple).toFixed(1)}</span>}
                  {r.lastRound && <span className="lite-trow-change7">{r.lastRound}</span>}
                </li>
              ))}
            </ul>
          )
        ) : !dealRows ? (
          <SkeletonRows n={9} />
        ) : dealRows.length === 0 ? (
          <p className="lite-empty">{tl(t, 'No recent private rounds with disclosed amounts.', 'msg')}</p>
        ) : (
          <ul className="lite-tlist">
            {dealRows.map((d) => (
              <li
                key={d.id}
                className={`lite-trow${d.link ? ' lite-trow--link' : ''}`}
                onClick={d.link ? () => window.open(d.link, '_blank', 'noopener') : undefined}
                role={d.link ? 'button' : undefined}
                tabIndex={d.link ? 0 : undefined}
                onKeyDown={d.link ? (e) => { if (e.key === 'Enter') window.open(d.link, '_blank', 'noopener') } : undefined}
              >
                <DealLogo name={d.company} logoUrl={d.logoUrl} domain={d.domain || d.website || null} />
                <span className="lite-trow-id">
                  <strong>{d.company}</strong>
                  {(d.roundType || d.sector) && <em>{d.roundType || d.sector}</em>}
                </span>
                {d.leadInvestor && <span className="lite-trow-mcap">{d.leadInvestor}</span>}
                <span className="lite-trow-price">{fmtLargeShort(d.amountUsd)}</span>
                <span className="lite-trow-change7">{liteTimeAgo(Math.floor(new Date(d.date).getTime() / 1000), t)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ProLink label={t('lite.privateview.label', "Private Markets in PRO")} path="/private-markets" onOpenPath={onOpenPath} />
    </div>
  )
}

// ── Deals (ventures reflection): recent fundraising rounds ──
let _dealsCache = null

function DealsView({ fmtLargeShort, onOpenPath }) {
  const { t } = useTranslation()
  const [deals, setDeals] = useState(_dealsCache)
  const [sort, setSort] = useState('latest')

  useEffect(() => {
    if (_dealsCache) return undefined
    let cancelled = false
    import('@/services/spectreMarketApi')
      .then(({ getV1Json }) => getV1Json('/fundraising/rounds?limit=80'))
      .then((payload) => {
        if (cancelled) return
        const raw = Array.isArray(payload?.data?.rounds) ? payload.data.rounds : (Array.isArray(payload?.data) ? payload.data : [])
        const rows = raw
          .filter((r) => Number(r.amount_raised_usd) > 0 && r.project_name)
          .map((r) => ({
            id: r.id,
            name: r.project_name,
            round: (r.round_type || '').replace(/_/g, ' '),
            amount: Number(r.amount_raised_usd),
            date: r.date,
            leads: (Array.isArray(r.lead_investors) && r.lead_investors.length ? r.lead_investors : (r.all_investors || [])).slice(0, 2),
            investors: [...new Set([...(r.lead_investors || []), ...(r.all_investors || [])])],
          }))
          .slice(0, 40)
        _dealsCache = rows
        setDeals(rows)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const rows = deals ? [...deals].sort((a, b) => (sort === 'biggest' ? b.amount - a.amount : new Date(b.date) - new Date(a.date))).slice(0, 20) : null
  // Most-active investors, computed from the rounds already fetched.
  const investors = useMemo(() => {
    if (!deals) return null
    const m = new Map()
    for (const d of deals) {
      for (const inv of d.investors || []) {
        const cur = m.get(inv) || { name: inv, count: 0, total: 0 }
        cur.count += 1
        cur.total += d.amount
        m.set(inv, cur)
      }
    }
    return [...m.values()].sort((a, b) => b.count - a.count || b.total - a.total).slice(0, 10)
  }, [deals])

  return (
    <div className="lite-view">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Deals', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'Who just raised money, from whom, and how much.', 'sub')}</p>
      </header>
      <div className="lite-tf-toggle lite-rise" role="tablist" aria-label={t('lite.dealsview.ariaSort', "Sort")}>
        {[{ id: 'latest', label: 'Latest' }, { id: 'biggest', label: 'Biggest' }, { id: 'investors', label: 'Investors' }].map((o) => (
          <button key={o.id} type="button" role="tab" aria-selected={sort === o.id} className={`lite-tf-btn${sort === o.id ? ' active' : ''}`} onClick={() => setSort(o.id)}>{tl(t, o.label)}</button>
        ))}
      </div>
      <section className="lite-panel lite-rise-1">
        {sort === 'investors' ? (
          !investors ? <SkeletonRows n={8} /> : investors.length === 0 ? (
            <p className="lite-empty">{tl(t, "No investor data in the recent rounds.", 'msg')}</p>
          ) : (
            <>
              <ul className="lite-mini-list">
                {investors.map((inv, i) => (
                  <li key={inv.name} className="lite-mini-row">
                    <span className="lite-mini-buzzrank">{i + 1}</span>
                    <span className="lite-mini-sym lite-rwa-name" style={{ minWidth: 120, maxWidth: '55%' }}>{inv.name}</span>
                    <span className="lite-mini-price">{t('lite.msg.n_deals', '{{n}} deals', { n: inv.count })}</span>
                    <span className="lite-change up">{fmtLargeShort(inv.total)}</span>
                  </li>
                ))}
              </ul>
              <p className="lite-social-note">{tl(t, "Who keeps showing up on recent term sheets - deal count and the combined size of rounds they joined.", 'msg')}</p>
            </>
          )
        ) : !rows ? (
          <SkeletonRows n={9} />
        ) : rows.length === 0 ? (
          <p className="lite-empty">{tl(t, "No recent rounds with disclosed amounts.", 'msg')}</p>
        ) : (
          <ul className="lite-tlist">
            {rows.map((d) => (
              <li key={d.id} className="lite-trow">
                <DealLogo name={d.name} />
                <span className="lite-trow-id">
                  <strong>{d.name}</strong>
                  {d.round && <em>{d.round}</em>}
                </span>
                {d.leads.length > 0 && <span className="lite-trow-mcap">{d.leads.join(', ')}</span>}
                <span className="lite-trow-price">{fmtLargeShort(d.amount)}</span>
                <span className="lite-trow-change7">{liteTimeAgo(Math.floor(new Date(d.date).getTime() / 1000), t)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <ProLink label={t('lite.dealsview.label', "Ventures in PRO")} path="/ventures" onOpenPath={onOpenPath} />
    </div>
  )
}

// ── Calendar (lazy: 4,850-event payload only loads when the view opens) ──
// { ts, rows } - refetched on a short clock around key prints so the ACTUAL
// lands while the "just landed" window is open.
let _calendarCache = null
const CAL_RESULT_WINDOW = 2 * 3600000

function loadCalendarRows() {
  return fetch('/api/calendar/economic', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
    .then((res) => (res.ok ? res.json() : null))
    .then((payload) => {
      if (!payload) return null
      // Keep ~6 weeks of the PAST too: the prev/next navigation pages into
      // landed weeks (actuals ride the same rows), and a landed print stays on
      // the page as breaking either way.
      const since = Date.now() - 45 * 86400000
      const BIG = new Set(['US', 'EU', 'GB', 'CN', 'JP'])
      // High-impact only. The blanket isCrypto include drowned the list in
      // DAO governance votes (Curve/ENS RFP spam) - crypto events must ALSO
      // be high impact to make the LITE cut. The week/month toggle + prev/next
      // nav window client-side, so the cap must cover the whole span (the old
      // 60 truncated next month's tail).
      // 🪤 `impact === 'high'` alone dropped the entire CRITICAL tier unless the
      // title happened to contain "fed" — so LITE's calendar was missing CPI,
      // NFP, PCE and GDP, the four prints it exists for.
      // 🪤 `isFedEvent` is a title regex (/fed|fomc/), so an unconditional OR let
      // every Richmond/Chicago Fed regional survey and "Fed Bill Auction" into a
      // list whose own subtitle says "High-impact events only". The tier floor
      // now applies to everything; being a Fed event only widens the country
      // gate, and real policy events (FOMC, the Chair, Jackson Hole) clear the
      // floor on their tier anyway.
      const TIERS = new Set(['critical', 'high'])
      const rows = (Array.isArray(payload.events) ? payload.events : [])
        .filter((e) => new Date(e.dateTime).getTime() > since)
        .filter((e) => TIERS.has(e.impact) && (BIG.has(e.country) || e.isCrypto || e.isFedEvent))
        .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime))
        .slice(0, 300)
      if (rows.length > 0) _calendarCache = { ts: Date.now(), rows }
      return rows
    })
}

const isRateDecision = (e) => /interest rate|rate decision/i.test(e?.name || e?.title || '')

// Speeches / pressers / meetings come through the feed as forecast 0 /
// previous 0 with no unit - those zeros are placeholders, not numbers.
function calNumbersMeaningful(e) {
  const f = Number(e?.forecast)
  const p = Number(e?.previous)
  if (e?.forecast == null && e?.previous == null) return false
  if (!e?.unit && !f && !p) return false
  return Number.isFinite(f) || Number.isFinite(p)
}

// Deterministic one-liner under the next-up event - no LLM, composed from
// forecast vs previous the way the zero-LLM brief composes from the tape.
function calThesis(t, e) {
  if (!calNumbersMeaningful(e)) return null
  const f = Number(e.forecast)
  const p = Number(e.previous)
  const u = e.unit || ''
  if (isRateDecision(e) && Number.isFinite(f) && Number.isFinite(p)) {
    if (f < p) return t('lite.msg.cal_th_cut', 'Markets expect a cut to {{f}}{{u}} from {{p}}{{u}}. Cheaper money tends to lift risk assets - the surprise here would be no cut.', { f, p, u })
    if (f > p) return t('lite.msg.cal_th_hike', 'Markets expect a hike to {{f}}{{u}} from {{p}}{{u}}. Dearer money is usually a headwind for risk assets.', { f, p, u })
    return t('lite.msg.cal_th_hold', 'Markets expect a hold at {{p}}{{u}} - the statement and press conference will do the moving, not the number.', { p, u })
  }
  if (Number.isFinite(f) && Number.isFinite(p)) {
    return t('lite.msg.cal_th_gap', 'Consensus sees {{f}}{{u}} vs {{p}}{{u}} last time. The gap between the print and that number is what moves markets - not the number itself.', { f, p, u })
  }
  if (Number.isFinite(p)) return t('lite.msg.cal_th_prev_only', 'No consensus number published. Last time it came in at {{p}}{{u}}.', { p, u })
  return null
}

// What the print MEANS once it lands. Rate decisions get the cut/hike/hold
// read; everything else states above/below consensus without editorializing
// direction (a hot CPI and a hot GDP mean opposite things for risk).
function calResultRead(t, e) {
  const a = Number(e.actual)
  const f = Number(e.forecast)
  const p = Number(e.previous)
  const u = e.unit || ''
  if (!Number.isFinite(a)) return null
  if (isRateDecision(e) && Number.isFinite(p)) {
    if (a < p) return t('lite.msg.cal_rd_cut', 'Cut: {{p}}{{u}} → {{a}}{{u}}. Cheaper money - historically a tailwind for risk assets.', { a, p, u })
    if (a > p) return t('lite.msg.cal_rd_hike', 'Hike: {{p}}{{u}} → {{a}}{{u}}. Dearer money - a headwind for risk assets.', { a, p, u })
    return t('lite.msg.cal_rd_hold', 'Held at {{a}}{{u}}. From here the guidance matters more than the number.', { a, u })
  }
  if (Number.isFinite(f)) {
    const denom = Math.abs(f) || 1
    if (Math.abs(a - f) / denom < 0.01) return t('lite.msg.cal_rd_inline', 'In line with expectations ({{f}}{{u}}) - the market usually shrugs at these.', { f, u })
    if (a > f) return t('lite.msg.cal_rd_above', 'Came in above the {{f}}{{u}} consensus.', { f, u })
    return t('lite.msg.cal_rd_below', 'Came in below the {{f}}{{u}} consensus.', { f, u })
  }
  return null
}

function relDay(iso) {
  const ms = new Date(iso).getTime() - Date.now()
  // landed a while ago (back-paged weeks) — the actual on the row is the story
  if (ms < -45 * 60000) return ''
  if (ms < 0) return 'now'
  // 🪤 was Math.round(hours) with a 1h floor — 33 minutes rendered "in 1h",
  // which on Fed day is the difference between "later" and "brace now"
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `in ${Math.max(1, mins)}m`
  const h = Math.floor(mins / 60)
  if (h < 24) return mins % 60 ? `in ${h}h ${mins % 60}m` : `in ${h}h`
  return `in ${Math.round(h / 24)}d`
}

// PRO-style month view: a REAL calendar month anchored at `anchor` (the 1st),
// full weeks from the Monday before the 1st to the Sunday after month end.
// The old version was a rolling five weeks from "this week's Monday" with no
// month name anywhere — founder: "i dont even know what month it is".
function MonthGrid({ events, anchor }) {
  const today = new Date()
  const first = anchor ? new Date(anchor.getFullYear(), anchor.getMonth(), 1) : new Date(today.getFullYear(), today.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7)) // Monday of the 1st's week
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
  const days = Math.ceil(((last - start) / 86400000 + 1) / 7) * 7
  const byDay = new Map()
  for (const e of events || []) {
    const k = new Date(e.dateTime).toDateString()
    if (!byDay.has(k)) byDay.set(k, [])
    byDay.get(k).push(e)
  }
  // A cell only has room for two chips, so they must be the day's two biggest
  // events — not whichever two the feed listed first.
  const RANK = { critical: 0, high: 1, medium: 2, low: 3 }
  for (const list of byDay.values()) {
    list.sort((a, b) => (RANK[a.impact] ?? 3) - (RANK[b.impact] ?? 3) || new Date(a.dateTime) - new Date(b.dateTime))
  }
  const cells = Array.from({ length: days }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return { d, events: byDay.get(d.toDateString()) || [] }
  })
  return (
    <div className="lite-calgrid">
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => (
        <div key={w} className="lite-calgrid-wd">{w}</div>
      ))}
      {cells.map(({ d, events: evs }) => {
        const isToday = d.toDateString() === today.toDateString()
        const isPast = d < today && !isToday
        const isOut = d.getMonth() !== first.getMonth()
        // The day's heaviest tier drives a corner bloom, the same signal the
        // PRO board uses — colour as a lighting condition on the surface, so a
        // month reads as a heat map of its own risk instead of a wall of chips.
        const topTier = evs.some((e) => e.impact === 'critical') ? 'critical'
          : evs.some((e) => e.impact === 'high') ? 'high'
          : evs.length ? 'medium' : null
        return (
          <div
            key={d.toISOString()}
            className={`lite-calgrid-cell${isToday ? ' today' : ''}${isPast ? ' past' : ''}${isOut ? ' out' : ''}${topTier ? ` tier-${topTier}` : ''}${evs.length ? '' : ' empty'}`}
          >
            <span className="lite-calgrid-day">
              {d.getDate() === 1 ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : d.getDate()}
            </span>
            {evs.slice(0, 2).map((e) => (
              <span
                key={e.id}
                className={`lite-calgrid-chip${e.isFedEvent ? ' fed' : ''}${e.impact === 'critical' ? ' critical' : ''}`}
                title={e.name}
              >
                {/* The hard slice(0,16) cut mid-word under a CSS rule that
                    already ellipsises. */}
                <span className="lite-calgrid-chip-name">{e.nameShort || e.name || ''}</span>
                {/* A past cell without its print is just a greyed-out label. */}
                {e.actual != null && (
                  <em className={`lite-calgrid-actual${calBeat(e)}`}>{e.actual}{e.unit || ''}</em>
                )}
              </span>
            ))}
            {evs.length > 2 && <span className="lite-calgrid-more">+{evs.length - 2}</span>}
          </div>
        )
      })}
    </div>
  )
}

function CalendarView({ onOpenPath }) {
  const { t, i18n } = useTranslation()
  const [events, setEvents] = useState(_calendarCache?.rows || null)
  const [calView, setCalView] = useState('month')
  // prev/next paging: weeks in week view, months in month view. Reset on
  // view switch so "Month" never opens on some week-derived offset.
  const [calOffset, setCalOffset] = useState(0)
  // Re-render each minute so the countdown stays honest; the same tick decides
  // whether to refetch - every 3 min around a key print (so the ACTUAL arrives
  // inside the breaking window), every 30 min otherwise.
  const [, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    const refresh = () => loadCalendarRows().then((rows) => { if (!cancelled && rows) setEvents(rows) }).catch(() => {})
    const maybeRefetch = () => {
      if (document.hidden) return
      const now = Date.now()
      const rows = _calendarCache?.rows || []
      const hot = rows.some((e) => {
        const t0 = new Date(e.dateTime).getTime()
        return t0 <= now + 15 * 60000 && now - t0 <= CAL_RESULT_WINDOW
      })
      if (now - (_calendarCache?.ts || 0) > (hot ? 3 * 60000 : 30 * 60000)) refresh()
    }
    if (!_calendarCache) refresh()
    else maybeRefetch()
    const id = setInterval(() => { if (!document.hidden) { setTick((n) => n + 1); maybeRefetch() } }, 60000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // The month grid anchors to a REAL calendar month; the week list is a
  // rolling 7-day window. Both page with calOffset.
  const WEEK_MS = 7 * 86400000
  const todayD = new Date()
  const monthAnchor = new Date(todayD.getFullYear(), todayD.getMonth() + calOffset, 1)
  const weekStart = calOffset === 0 ? Date.now() - 3 * 3600000 : Date.now() + calOffset * WEEK_MS
  const weekEnd = Date.now() + (calOffset + 1) * WEEK_MS

  // Week view: the offset window grouped by day.
  const groups = (() => {
    if (!events) return null
    if (calView !== 'week') return []
    const windowed = events.filter((e) => {
      const t0 = new Date(e.dateTime).getTime()
      return t0 >= weekStart && t0 <= weekEnd
    }).slice(0, 30)
    const map = new Map()
    for (const e of windowed) {
      const d = new Date(e.dateTime)
      const label = d.toLocaleDateString(i18n.language || undefined, { weekday: 'long', month: 'short', day: 'numeric' })
      if (!map.has(label)) map.set(label, [])
      map.get(label).push(e)
    }
    return [...map.entries()]
  })()

  // What the nav row says: the month's NAME (founder: "i dont even know what
  // month it is"), or the week's date range.
  const navLabel = calView === 'month'
    ? monthAnchor.toLocaleDateString(i18n.language || undefined, { month: 'long', year: 'numeric' })
    : calOffset === 0
      ? t('lite.msg.this_week', 'This week')
      : `${new Date(weekStart).toLocaleDateString(i18n.language || undefined, { month: 'short', day: 'numeric' })} – ${new Date(weekEnd).toLocaleDateString(i18n.language || undefined, { month: 'short', day: 'numeric' })}`
  // the feed carries ~6 weeks back and a couple of months forward — clamp the
  // paging to where data can exist instead of serving blank pages
  const offMin = calView === 'month' ? -1 : -6
  const offMax = calView === 'month' ? 2 : 9

  const nowMs = Date.now()
  // A key print that already LANDED (has an actual) stays on the page as
  // breaking for 2h; the next-up hero moves on to what's actually next.
  const justLanded = (() => {
    const landed = (events || []).filter((e) => {
      const t0 = new Date(e.dateTime).getTime()
      // A bare 0 with no unit is a presser placeholder, not a print.
      const hasPrint = Number.isFinite(Number(e.actual)) && (e.unit || Number(e.actual) !== 0)
      return t0 <= nowMs && nowMs - t0 <= CAL_RESULT_WINDOW && hasPrint
    })
    return landed.length ? landed[landed.length - 1] : null
  })()
  const nextEvent = (events || []).find((e) => {
    const t0 = new Date(e.dateTime).getTime()
    if (t0 > nowMs) return true
    // Time has passed but the print hasn't hit the wire - still "happening now".
    return !Number.isFinite(Number(e.actual)) && nowMs - t0 < 45 * 60000
  })
  const countdown = (() => {
    if (!nextEvent) return null
    const ms = new Date(nextEvent.dateTime).getTime() - Date.now()
    if (ms <= 0) return t('lite.msg.happening_now', 'happening now')
    const mins = Math.floor(ms / 60000)
    const d = Math.floor(mins / 1440)
    const h = Math.floor((mins % 1440) / 60)
    const m = mins % 60
    if (d > 0) return t('lite.msg.countdown_dh', 'in {{d}}d {{h}}h', { d, h })
    if (h > 0) return t('lite.msg.countdown_hm', 'in {{h}}h {{m}}m', { h, m })
    return t('lite.msg.countdown_m', 'in {{m}}m', { m })
  })()
  const thesis = nextEvent ? calThesis(t, nextEvent) : null

  return (
    <div className={`lite-view${calView === 'month' ? ' lite-view--wide' : ''}`}>
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Calendar', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'What could move the market next. High-impact events only.', 'sub')}</p>
      </header>
      {justLanded && (
        <section className="lite-panel lite-cal-breaking lite-rise">
          <p className="lite-eyebrow"><span className="lite-cal-livedot" aria-hidden />{tl(t, 'Just landed', 'lbl')} · {liteTimeAgo(Math.floor(new Date(justLanded.dateTime).getTime() / 1000), t)}</p>
          <div className="lite-cal-breaking-row">
            <strong>{justLanded.title || justLanded.name}</strong>
            <span className={`lite-cal-actual lite-cal-actual--big${calBeat(justLanded)}`}>{justLanded.actual}{justLanded.unit || ''}</span>
          </div>
          <span className="lite-cal-nums lite-cal-nums--hero">
            {justLanded.forecast != null && <span>{tl(t, 'expected', 'lbl')} {justLanded.forecast}{justLanded.unit || ''}</span>}
            {justLanded.previous != null && <span>{tl(t, 'previous', 'lbl')} {justLanded.previous}{justLanded.unit || ''}</span>}
          </span>
          {calResultRead(t, justLanded) && <p className="lite-social-note">{calResultRead(t, justLanded)}</p>}
        </section>
      )}
      {nextEvent && countdown && (
        <div className="lite-statband lite-rise">
          <div className="lite-stat lite-stat--wide lite-cal-next">
            <em>{tl(t, 'Next up', 'lbl')}</em>
            <strong>{nextEvent.title || nextEvent.name || nextEvent.event}</strong>
            <span>{[countdown, nextEvent.country, nextEvent.isFedEvent ? 'Fed' : null].filter(Boolean).join(' · ')}</span>
            {calNumbersMeaningful(nextEvent) && (
              <span className="lite-cal-nums lite-cal-nums--hero">
                {nextEvent.forecast != null && <span>{tl(t, 'expected', 'lbl')} {nextEvent.forecast}{nextEvent.unit || ''}</span>}
                {nextEvent.previous != null && <span>{tl(t, 'previous', 'lbl')} {nextEvent.previous}{nextEvent.unit || ''}</span>}
              </span>
            )}
            {thesis && <span className="lite-cal-thesis">{thesis}</span>}
          </div>
        </div>
      )}
      <div className="lite-toolrow lite-cal-toolrow lite-rise">
        <div className="lite-tf-toggle" role="tablist" aria-label={t('lite.calendarview.ariaCalendarView', "Calendar view")}>
          {[{ id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }].map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={calView === v.id} className={`lite-tf-btn${calView === v.id ? ' active' : ''}`} onClick={() => { setCalView(v.id); setCalOffset(0) }}>{tl(t, v.label)}</button>
          ))}
        </div>
        <div className="lite-cal-nav">
          <button type="button" className="lite-cal-nav-btn" aria-label={calView === 'month' ? 'Previous month' : 'Previous week'} disabled={calOffset <= offMin} onClick={() => setCalOffset((o) => Math.max(offMin, o - 1))}>‹</button>
          <span className="lite-cal-nav-label">{navLabel}</span>
          <button type="button" className="lite-cal-nav-btn" aria-label={calView === 'month' ? 'Next month' : 'Next week'} disabled={calOffset >= offMax} onClick={() => setCalOffset((o) => Math.min(offMax, o + 1))}>›</button>
        </div>
        {calOffset !== 0 && (
          <button type="button" className="lite-cal-nav-today" onClick={() => setCalOffset(0)}>{tl(t, 'Today', 'lbl')}</button>
        )}
      </div>
      <section className="lite-panel lite-rise-1">
        {!groups ? (
          <SkeletonRows n={7} />
        ) : calView === 'month' ? (
          <MonthGrid events={events} anchor={monthAnchor} />
        ) : groups.length === 0 ? (
          <p className="lite-empty">{tl(t, "Nothing high-impact in this window.", 'msg')}</p>
        ) : (
          groups.map(([label, rows]) => (
            <div key={label} className="lite-cal-group">
              <p className="lite-cal-group-label">{label}</p>
              <ul className="lite-cal-list">
                {rows.map((e) => {
                  const d = new Date(e.dateTime)
                  return (
                    <li key={e.id} className="lite-cal-row">
                      <span className="lite-cal-when">
                        <strong>{calView === 'week' ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
                        <em>{relDay(e.dateTime)}</em>
                      </span>
                      <span className="lite-cal-what">
                        <strong>{e.name}</strong>
                        <em>{[e.country, e.category].filter(Boolean).join(' · ')}</em>
                      </span>
                      {(e.actual != null || e.forecast != null || e.previous != null) && (
                        <span className="lite-cal-nums">
                          {/* Once a release PRINTS, the actual is the only number
                              that matters — the calendar showed est/prev forever
                              and never the result. Tinted against the forecast
                              so a beat or a miss reads at a glance. */}
                          {e.actual != null && (
                            <span className={`lite-cal-actual${calBeat(e)}`}>{e.actual}{e.unit || ''}</span>
                          )}
                          {e.forecast != null && <span>est {e.forecast}{e.unit || ''}</span>}
                          {e.previous != null && <span>prev {e.previous}{e.unit || ''}</span>}
                        </span>
                      )}
                      <span className={`lite-cal-impact${e.isFedEvent ? ' fed' : ''}${e.impact === 'critical' ? ' critical' : ''}`}>
                        {e.isFedEvent ? 'FED' : e.isCrypto ? 'CRYPTO' : e.impact === 'critical' ? 'CRITICAL' : 'HIGH'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))
        )}
      </section>
      <ProLink label={t('lite.calendarview.label', "Full economic calendar in PRO")} path="/economic-calendar" onOpenPath={onOpenPath} />
    </div>
  )
}

// ── Predictions (lazy: the Polymarket blob is heavy - load on open only;
// loader + cache shared with the Today board's Predictions tab) ──

// ── Media (AI Media Center reflection): latest crypto video coverage ──
let _mediaCache = null

function fmtViews(n) {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M views`
  if (n >= 1e3) return `${Math.round(n / 1e3)}K views`
  return `${n} views`
}

function MediaView({ onOpenPath }) {
  const { t } = useTranslation()
  const [vids, setVids] = useState(_mediaCache)

  useEffect(() => {
    if (_mediaCache) return undefined
    let cancelled = false
    import('@/services/mediaApi')
      .then(({ getVideos }) => getVideos('crypto'))
      .then((payload) => {
        if (cancelled) return
        const out = (payload?.items || [])
          .map((v, i) => {
            const vid = v.id?.videoId || v.videoId || (typeof v.id === 'string' ? v.id : null)
            return {
              id: vid || `v-${i}`,
              title: v.title || '',
              thumb: v.thumbnail || v.thumbnails?.medium?.url || null,
              channel: v.channel?.name || v.channel?.title || v.channelTitle || (typeof v.channel === 'string' ? v.channel : ''),
              views: Number(v.viewCount) || 0,
              url: v.url || (vid ? `https://www.youtube.com/watch?v=${vid}` : null),
            }
          })
          .filter((v) => v.title)
          .slice(0, 12)
        _mediaCache = out
        setVids(out)
      })
      .catch(() => { if (!cancelled) setVids([]) })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="lite-view lite-view--wide">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Media', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'The crypto conversation on video - curated market coverage.', 'sub')}</p>
      </header>
      {!vids ? (
        <section className="lite-panel lite-rise-1"><SkeletonRows n={8} /></section>
      ) : vids.length === 0 ? (
        <section className="lite-panel lite-rise-1"><p className="lite-empty">{tl(t, "No fresh coverage right now - check the full Media Center in PRO.", 'msg')}</p></section>
      ) : (
        <div className="lite-media-grid lite-rise-1">
          {vids.map((v) => (
            <a key={v.id} className="lite-media-card lite-panel" href={v.url || '#'} target="_blank" rel="noopener noreferrer">
              <span className="lite-media-thumb">
                {v.thumb ? <img src={v.thumb} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : null}
                <span className="lite-media-play" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                </span>
              </span>
              <span className="lite-media-title">{v.title}</span>
              <span className="lite-media-meta">{[v.channel, fmtViews(v.views)].filter(Boolean).join(' · ')}</span>
            </a>
          ))}
        </div>
      )}
      <ProLink label={t('lite.mediaview.label', "AI Media Center in PRO")} path="/ai-media-center" onOpenPath={onOpenPath} />
    </div>
  )
}


// ── Tokenized assets (RWA reflection): real-world value on-chain ──
let _rwaCache = null

function RwaView({ fmtLargeShort, onOpenPath, imgBySym }) {
  const { t } = useTranslation()
  const [rwa, setRwa] = useState(_rwaCache)
  const [tab, setTab] = useState('overview')

  useEffect(() => {
    if (_rwaCache) return undefined
    let cancelled = false
    fetch('/api/rwa/bundle?tier=core', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(25000) })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled || !payload?.overview) return
        const stableRows = (Array.isArray(payload.stablecoins) ? payload.stablecoins : [])
          .map((s) => {
            const circ = Number(s.circulating?.peggedUSD) || 0
            const prevW = Number(s.circulatingPrevWeek?.peggedUSD) || 0
            return {
              id: s.id || s.symbol,
              name: s.name,
              symbol: s.symbol,
              circ,
              change7d: prevW > 0 ? ((circ - prevW) / prevW) * 100 : null,
              peg: String(s.pegMechanism || '').replace('-', ' '),
            }
          })
          .filter((s) => s.circ > 0)
          .sort((a, b) => b.circ - a.circ)
          .slice(0, 12)
        const mapMover = (r) => ({
          slug: r.slug || r.name,
          name: r.name,
          tvl: Number(r.tvl) || 0,
          change1d: Number(r.change_1d),
          change7d: Number(r.change_7d),
          logo: r.logo || null,
        })
        const cats = (payload.breakdown?.data?.categories || [])
          .map((c) => ({ slug: c.slug, name: c.name, aum: Number(c.aum_usd) || 0 }))
          .filter((c) => c.aum > 0)
          .sort((a, b) => b.aum - a.aum)
          .slice(0, 8)
        const catTotal = cats.reduce((s, c) => s + c.aum, 0) || 1
        const out = {
          tvl: Number(payload.overview.totalTvl) || 0,
          protocols: Number(payload.overview.totalProtocols) || 0,
          chains: Number(payload.overview.totalChains) || 0,
          top: (Array.isArray(payload.protocols) ? payload.protocols : [])
            .filter((r) => Number(r.tvl) > 0)
            .sort((a, b) => b.tvl - a.tvl)
            .slice(0, 18)
            .map((r) => ({
              slug: r.slug || r.name,
              name: r.name,
              tvl: Number(r.tvl),
              chains: (r.chains || []).length,
              chainNames: (r.chains || []).slice(0, 6).join(" \u00b7 "),
              assetClass: String(r.asset_class || "").replace(/[_-]+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase()),
              change1d: Number.isFinite(Number(r.change_1d)) ? Number(r.change_1d) : null,
              change7d: Number.isFinite(Number(r.change_7d)) ? Number(r.change_7d) : null,
              share: Number(payload.overview.totalTvl) > 0 ? (Number(r.tvl) / Number(payload.overview.totalTvl)) * 100 : null,
              logo: r.logo || null,
            })),
          stables: stableRows,
          gainers: (payload.movers?.gainers || []).map(mapMover).slice(0, 6),
          losers: (payload.movers?.losers || []).map(mapMover).slice(0, 6),
          cats: cats.map((c) => ({ ...c, share: (c.aum / catTotal) * 100 })),
        }
        _rwaCache = out
        setRwa(out)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const moverRow = (r, dir) => (
    <li key={r.slug} className="lite-mini-row">
      <CoinDot src={r.logo} sym={r.name} />
      <span className="lite-mini-sym lite-rwa-name">{r.name}</span>
      <span className="lite-mini-price">{fmtLargeShort(r.tvl)}</span>
      <span className={`lite-change ${dir}`}>{fmtChange(Number.isFinite(r.change1d) ? r.change1d : r.change7d)}</span>
    </li>
  )

  return (
    <div className="lite-view lite-view--wide">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Tokenized', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'Real-world assets living on-chain - treasuries, funds and credit.', 'sub')}</p>
      </header>
      <div className="lite-tf-toggle lite-rise" role="tablist" aria-label={t('lite.rwaview.ariaTokenizedSection', "Tokenized section")}>
        {[{ id: 'overview', label: 'Overview' }, { id: 'stables', label: 'Stablecoins' }, { id: 'movers', label: 'Movers' }, { id: 'classes', label: 'Asset classes' }].map((tb) => (
          <button key={tb.id} type="button" role="tab" aria-selected={tab === tb.id} className={`lite-tf-btn${tab === tb.id ? ' active' : ''}`} onClick={() => setTab(tb.id)}>{tl(t, tb.label)}</button>
        ))}
      </div>
      {!rwa ? (
        <section className="lite-panel lite-rise-1"><SkeletonRows n={9} /></section>
      ) : tab === 'overview' ? (
        <>
          <section className="lite-panel lite-rise-1">
            <div className="lite-deriv-grid lite-rwa-stats">
              <div className="lite-deriv-item">
                <em>{tl(t, "Total value", 'lbl')}</em>
                <strong>{fmtLargeShort(rwa.tvl)}</strong>
                <span>{tl(t, "real-world assets on-chain", 'msg')}</span>
              </div>
              <div className="lite-deriv-item">
                <em>{tl(t, "Products", 'lbl')}</em>
                <strong>{rwa.protocols}</strong>
                <span>{tl(t, "tracked protocols", 'msg')}</span>
              </div>
              <div className="lite-deriv-item">
                <em>{tl(t, "Chains", 'lbl')}</em>
                <strong>{rwa.chains}</strong>
                <span>{tl(t, "networks carrying them", 'msg')}</span>
              </div>
            </div>
          </section>
          <section className="lite-panel lite-rise-2">
            <p className="lite-eyebrow">{tl(t, "Biggest products", 'lbl')}</p>
            <ul className="lite-tlist">
              {rwa.top.map((r) => (
                <li key={r.slug} className="lite-trow">
                  <span className="lite-trow-logo">
                    {r.logo ? <img src={r.logo} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }} /> : null}
                    <span className="lite-trow-fallback" style={r.logo ? { display: 'none' } : undefined}>{(r.name || '?')[0]}</span>
                  </span>
                  <span className="lite-trow-id">
                    <strong>{r.name}</strong>
                    <em title={r.chainNames || undefined}>
                      {[r.assetClass, r.chains === 1 ? tl(t, '1 chain', 'msg') : r.chains > 1 ? t('lite.msg.n_chains', '{{n}} chains', { n: r.chains }) : null].filter(Boolean).join(' \u00b7 ')}
                    </em>
                  </span>
                  {r.share != null && <span className="lite-trow-mcap">{r.share >= 10 ? r.share.toFixed(0) : r.share.toFixed(1)}% {tl(t, 'of RWA', 'lbl')}</span>}
                  {r.change1d != null && <span className={`lite-trow-change ${changeCls(r.change1d)}`}>{fmtChange(r.change1d)}</span>}
                  {r.change7d != null && <span className={`lite-trow-change7 ${changeCls(r.change7d)}`}>{fmtChange(r.change7d)}<em>7d</em></span>}
                  <span className="lite-trow-price">{fmtLargeShort(r.tvl)}</span>
                </li>
              ))}
            </ul>
            <p className="lite-social-note">{tl(t, "BlackRock, Franklin and friends - the slow money arriving on-chain. Values via the Spectre RWA desk.", 'msg')}</p>
          </section>
        </>
      ) : tab === 'stables' ? (
        <section className="lite-panel lite-rise-1">
          <p className="lite-eyebrow">{tl(t, "Biggest stablecoins", 'lbl')}</p>
          <ul className="lite-tlist">
            {rwa.stables.map((s) => (
              <li key={s.id} className="lite-trow">
                <span className="lite-trow-logo">
                  {imgBySym?.[s.symbol] ? <img src={imgBySym[s.symbol]} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextSibling.style.display = 'flex' }} /> : null}
                  <span className="lite-trow-fallback" style={imgBySym?.[s.symbol] ? { display: 'none' } : undefined}>{(s.symbol || '?')[0]}</span>
                </span>
                <span className="lite-trow-id">
                  <strong>{s.name}</strong>
                  <em>{s.symbol}</em>
                </span>
                <span className="lite-trow-mcap">{s.peg}</span>
                <span className="lite-trow-price">{fmtLargeShort(s.circ)}</span>
                {Number.isFinite(s.change7d) && (
                  <span className={`lite-trow-change ${changeCls(s.change7d)}`}>{fmtChange(s.change7d)}<em style={{ fontStyle: 'normal', fontSize: '0.66rem', marginLeft: 3 }}>7d</em></span>
                )}
              </li>
            ))}
          </ul>
          <p className="lite-social-note">{tl(t, "Circulating supply and its 7-day change - growing stablecoins mean fresh dollars parked and ready.", 'msg')}</p>
        </section>
      ) : tab === 'movers' ? (
        <div className="lite-grid lite-rise-1">
          <section className="lite-panel lite-span-6">
            <p className="lite-eyebrow">{tl(t, "Growing fastest", 'lbl')}</p>
            {rwa.gainers.length === 0 ? <p className="lite-empty">{tl(t, "Quiet in this window.", 'msg')}</p> : <ul className="lite-mini-list">{rwa.gainers.map((r) => moverRow(r, 'up'))}</ul>}
          </section>
          <section className="lite-panel lite-span-6">
            <p className="lite-eyebrow">{tl(t, "Shrinking", 'lbl')}</p>
            {rwa.losers.length === 0 ? <p className="lite-empty">{tl(t, "Nothing shrinking today.", 'msg')}</p> : <ul className="lite-mini-list">{rwa.losers.map((r) => moverRow(r, 'down'))}</ul>}
          </section>
        </div>
      ) : (
        <section className="lite-panel lite-rise-1">
          <p className="lite-eyebrow">{tl(t, "Where the value sits", 'lbl')}</p>
          <ul className="lite-mini-list">
            {rwa.cats.map((c) => (
              <li key={c.slug} className="lite-rwa-cat">
                <span className="lite-rwa-cat-head">
                  <span className="lite-mini-sym lite-rwa-name">{c.name}</span>
                  <span className="lite-mini-price">{fmtLargeShort(c.aum)} · {c.share.toFixed(0)}%</span>
                </span>
                <span className="lite-rwa-bar" aria-hidden><span style={{ width: `${Math.max(2, c.share)}%` }} /></span>
              </li>
            ))}
          </ul>
          <p className="lite-social-note">{tl(t, "Tokenized value by asset class - treasuries lead, credit and commodities follow.", 'msg')}</p>
        </section>
      )}
      <ProLink label={t('lite.rwaview.label', "Tokenized assets in PRO")} path="/tokenized-assets" onOpenPath={onOpenPath} />
    </div>
  )
}

// ── ROI: the "what if I'd bought" utility ──
const ROI_WINDOWS = [
  { id: '3M', days: 90, label: '3 months ago' },
  { id: '6M', days: 180, label: '6 months ago' },
  { id: '1Y', days: 365, label: 'a year ago' },
  { id: '2Y', days: 730, label: '2 years ago' },
  { id: 'MAX', days: 'max', label: 'at the start' },
]

const ROI_PRESETS = [
  { v: 100, l: '$100' },
  { v: 500, l: '$500' },
  { v: 1000, l: '$1K' },
  { v: 5000, l: '$5K' },
  { v: 10000, l: '$10K' },
]

function RoiView({ data, fmtPrice, fmtLargeShort, onOpenPath, market }) {
  const { t } = useTranslation()
  const { watchlistEntries } = data
  const isStocks = market === 'stocks'
  const symbols = useMemo(() => {
    if (isStocks) {
      const wlS = (watchlistEntries || [])
        .filter((tk) => tk?.isStock === true || tk?.assetClass === 'stock')
        .map((tk) => (tk.symbol || '').toUpperCase())
      return [...new Set(['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'TSLA', ...wlS])].slice(0, 10)
    }
    const wl = (watchlistEntries || [])
      .filter((tk) => !(tk?.isStock === true || tk?.assetClass === 'stock'))
      .map((tk) => (tk.symbol || '').toUpperCase())
    return [...new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', ...wl])].slice(0, 10)
  }, [watchlistEntries, isStocks])
  const [sym, setSym] = useState(isStocks ? 'AAPL' : 'BTC')
  const [win, setWin] = useState('1Y')
  const [amount, setAmount] = useState('1000')
  const [series, setSeries] = useState(null)

  useEffect(() => { setSym(isStocks ? 'AAPL' : 'BTC') }, [isStocks])

  useEffect(() => {
    let cancelled = false
    setSeries(null)
    const days = ROI_WINDOWS.find((w) => w.id === win)?.days || 365
    const run = async () => {
      if (isStocks) {
        // Trading-day windows off the Yahoo series ('1W' 5y for MAX).
        const { getStockSeriesBars } = await import('@/services/stockApi')
        const res = await getStockSeriesBars(sym, days === 'max' ? '1W' : '1D').catch(() => null)
        const slices = { 90: 63, 180: 126, 365: 252, 730: 504 }
        const rows = (res?.bars || [])
          .map((b) => ({ time: Number(b.t), close: Number(b.c) }))
          .filter((r) => r.time > 0 && r.close > 0)
        return days === 'max' ? rows : rows.slice(-(slices[days] || 252))
      }
      return loadDailyWindow(sym, days)
    }
    run()
      .then((rows) => { if (!cancelled) setSeries(rows || []) })
      .catch(() => { if (!cancelled) setSeries([]) })
    return () => { cancelled = true }
  }, [sym, win, isStocks])

  const amt = Math.max(0, Number(String(amount).replace(/[^0-9.]/g, '')) || 0)
  const result = (() => {
    if (!Array.isArray(series) || series.length < 2 || amt <= 0) return null
    const then = Number(series[0].close ?? series[0].c)
    const now = Number(series[series.length - 1].close ?? series[series.length - 1].c)
    if (!(then > 0) || !(now > 0)) return null
    const mult = now / then
    return { then, now, value: amt * mult, mult, pct: (mult - 1) * 100, thenDate: new Date((series[0].time ?? series[0].t) * 1000) }
  })()
  const winLabel = ROI_WINDOWS.find((w) => w.id === win)?.label || ''

  return (
    <div className="lite-view">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'ROI', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'What if you had bought it back then?', 'sub')}</p>
      </header>

      <section className="lite-panel lite-rise-1 lite-roi">
        <div className="lite-roi-controls">
          <div className="lite-roi-amount">
            <em className="lite-roi-label">{tl(t, "If I had put in", 'lbl')}</em>
            {/* ui-bare-input = the sanctioned opt-out from app-store-ready's
                blanket 38px/padded/filled mobile input box; this row draws
                its own chrome. */}
            {/* A div, not a <label>: the mobile sheets restyle every <label>
                (padding: 8px 0) and flattened this box's side padding. */}
            <div className="lite-roi-input" onClick={(e) => e.currentTarget.querySelector('input')?.focus()}>
              <span>$</span>
              <input className="ui-bare-input" type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={t('lite.roiview.ariaAmountInDollars', "Amount in dollars")} />
            </div>
            <div className="lite-roi-presets" role="group" aria-label={t('lite.roiview.ariaQuickAmounts', "Quick amounts")}>
              {ROI_PRESETS.map((p) => (
                <button key={p.v} type="button" className={`lite-roi-preset${amt === p.v ? ' active' : ''}`} onClick={() => setAmount(String(p.v))}>{p.l}</button>
              ))}
            </div>
          </div>
          <div>
            <em className="lite-roi-label">{t('lite.roiview.into', "into")}</em>
            <div className="lite-chips">
              {symbols.map((s) => (
                <button key={s} type="button" className={`lite-chip${s === sym ? ' active' : ''}`} onClick={() => setSym(s)}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <em className="lite-roi-label">{t('lite.roiview.buying', "buying")}</em>
            <div className="lite-tf-toggle" role="tablist" aria-label={t('lite.roiview.ariaWhen', "When")}>
              {ROI_WINDOWS.map((w) => (
                <button key={w.id} type="button" role="tab" aria-selected={win === w.id} className={`lite-tf-btn${win === w.id ? ' active' : ''}`} onClick={() => setWin(w.id)}>{w.id}</button>
              ))}
            </div>
          </div>
        </div>

        {series === null ? (
          <SkeletonRows n={4} />
        ) : !result ? (
          <p className="lite-empty">{t('lite.roi.noHistory', "Can't find enough {{sym}} history for that window.", { sym })}</p>
        ) : (
          <div className="lite-roi-result">
            <p className="lite-roi-headline">
              <span className="lite-roi-lead">{t('lite.roi.lead', '{{amount}} into {{sym}} {{window}} would be', { amount: fmtLargeShort(amt), sym, window: winLabel })}</span>
              <strong className={result.mult >= 1 ? 'up' : 'down'}> {result.value >= 1e6 ? fmtLargeShort(result.value) : `$${result.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}</strong>
              <span className="lite-roi-tail"> {t('lite.roi.tail', 'today.')}</span>
            </p>
            <div className="lite-tech-grid">
              <div className="lite-tech-item">
                <em>{tl(t, "Return", 'lbl')}</em>
                <strong className={result.mult >= 1 ? 'up' : 'down'}>{result.pct >= 0 ? '+' : ''}{result.pct.toFixed(0)}%</strong>
                <span>{result.mult >= 1 ? `${result.mult.toFixed(2)}x your money` : `${(result.mult).toFixed(2)}x - a loss`}</span>
              </div>
              <div className="lite-tech-item">
                <em>{tl(t, "Bought at", 'lbl')}</em>
                <strong>{fmtPrice(result.then)}</strong>
                <span>{result.thenDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              </div>
              <div className="lite-tech-item">
                <em>{tl(t, "Price now", 'lbl')}</em>
                <strong>{fmtPrice(result.now)}</strong>
                <span>{tl(t, "daily close basis", 'msg')}</span>
              </div>
            </div>
            <p className="lite-social-note">{tl(t, "Uses daily closes - real intraday entries vary. Past performance promises nothing.", 'msg')}</p>
          </div>
        )}
      </section>
      <ProLink label={t('lite.roiview.label', "Full ROI calculator in PRO")} path="/roi-calculator" onOpenPath={onOpenPath} />
    </div>
  )
}

// ── The globe's panel ──
// 🪤 First cut of this was a "quick" summary — Look, glass depth, scrollbar and
// a link to the real page — and the founder's reaction was the correct one:
// "where are all options?!" A control that opens a drawer with three settings
// and a door to the settings is not a shortcut, it is an extra step. PRO's
// globe opens PRO's FULL studio; LITE's opens LITE's full one. It renders
// ThemesView itself rather than restating it, so the drawer and the Themes tab
// cannot drift — one source of truth, two frames around it.
function LiteThemeSheet({ onClose, lookClass = '', ...themeProps }) {
  const { t } = useTranslation()
  useBackDismiss(true, onClose)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className={`lite-portal ${lookClass}`}>
    <div className="lite-tsheet-wrap" role="dialog" aria-modal="true" aria-label={t("lite.tab.themes", "Themes")}>
      <div className="lite-tsheet-scrim" onClick={onClose} aria-hidden />
      <div className="lite-tsheet">
        <div className="lite-tsheet-head">
          <div>
            <p className="lite-tsheet-title">{tl(t, 'Themes', 'ttl')}</p>
            <p className="lite-tsheet-sub">{tl(t, 'Make it yours - look, backdrop, and what shows on Today.', 'sub')}</p>
          </div>
          <button type="button" className="lite-tsheet-x" onClick={onClose} aria-label={t('lite.litethemesheet.ariaClose', "Close")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="lite-tsheet-body">
          <ThemesView {...themeProps} />
        </div>
      </div>
    </div>
    </div>,
    document.body
  )
}

// ── Themes: the full customization studio ──
/**
 * "Your wallpapers" — the user's own images, as a proper SET.
 *
 * This is the answer to wanting a themed section built from artwork we have no
 * licence to ship ourselves: the app supplies the shelf, the user supplies the
 * pictures. They live in IndexedDB on this device only, and can be swapped or
 * removed at any time.
 */
function WallpaperGroup({ wallpapers, bg, setBg }) {
  const { t: tr } = useTranslation()
  const { t } = useTranslation()
  // 🪤 ThemesView has TWO mounts — the page and the Cinema theme sheet, which
  // spreads a props object that has no `wallpapers`. Destructuring undefined
  // threw and the error boundary blanked the whole Themes page. Render nothing
  // rather than explode when the host did not supply a set.
  if (!wallpapers) return null
  const { items, add, remove, busy, err } = wallpapers
  return (
    <>
      <p className="lite-eyebrow lite-themes-sub">{tl(t, 'Your wallpapers', 'grp')}</p>
      <div className="lite-themes-grid">
        {items.map((it) => (
          <div key={it.id} className="lite-wall-cell">
            <button
              type="button"
              className={`lite-theme-swatch${bg?.mode === 'wall' && bg?.scene === it.id ? ' active' : ''}`}
              title={it.name}
              onClick={() => setBg?.({ mode: 'wall', scene: it.id })}
            >
              <img src={it.url} alt={it.name} loading="lazy" />
              <span className="lite-theme-name">{it.name}</span>
            </button>
            <button
              type="button"
              className="lite-wall-del"
              title={`Remove ${it.name}`}
              aria-label={`Remove ${it.name}`}
              onClick={(e) => { e.stopPropagation(); remove(it.id) }}
            >×</button>
          </div>
        ))}
        <label className="lite-theme-swatch lite-theme-swatch--add" title={tr('lite.wallpapergroup.title', "Add wallpapers")}>
          <span className="lite-theme-fill lite-wall-add">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          </span>
          <span className="lite-theme-name">{busy ? 'Saving…' : 'Add'}</span>
          {/* multiple: a set, not one at a time. */}
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={async (e) => {
              const files = [...(e.target.files || [])]
              e.target.value = ''
              for (const f of files) await add(f)
            }}
          />
        </label>
      </div>
      {err && <p className="lite-social-note">{err}</p>}
    </>
  )
}

function SwatchGroup({ title, items, activeId, onPick, kind }) {
  const { t } = useTranslation()
  return (
    <>
      <p className="lite-eyebrow lite-themes-sub">{tl(t, title, 'grp')}</p>
      <div className="lite-themes-grid">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            className={`lite-theme-swatch${activeId === it.id ? ' active' : ''}`}
            title={it.name}
            onClick={() => onPick(it)}
          >
            {kind === 'photo'
              ? <img src={`https://images.unsplash.com/${it.photo}?w=200&q=60&auto=format&fit=crop`} alt={it.name} loading="lazy" />
              : <span className="lite-theme-fill" style={{ background: it.css }} />}
            <span className="lite-theme-name">{tl(t, it.name, 'theme')}</span>
          </button>
        ))}
      </div>
    </>
  )
}

// Only languages whose LITE pack is COMPLETE are offered (the no-mix rule) -
// extend as packs land.
const LITE_LANGS = [
  ['en', 'English'], ['es', 'Español'], ['zh', '中文'], ['fr', 'Français'], ['pt', 'Português'],
  ['ru', 'Русский'], ['de', 'Deutsch'], ['it', 'Italiano'], ['ja', '日本語'], ['ko', '한국어'],
  ['th', 'ไทย'], ['tr', 'Türkçe'], ['vi', 'Tiếng Việt'], ['id', 'Bahasa Indonesia'], ['hi', 'हिन्दी'],
  ['nl', 'Nederlands'], ['pl', 'Polski'], ['uk', 'Українська'], ['ar', 'العربية'], ['tl', 'Filipino'],
]

// Full backdrop catalog (mirrors the Themes page groups) — passed into cinema
// mode's "More backdrops" popout so users get the complete set there too.
// Both picker surfaces read THE catalog now — see lite-backdrops.js.
const LITE_BG_CATALOG = BG_CATALOG
const LITE_PAPER_CATALOG = BG_PAPER_CATALOG


/**
 * LITE's own dropdown.
 *
 * The native <select> popup is painted by the OS, not by us: an opaque list
 * with the system's blue highlight, landing on a frosted glass page like a
 * foreign object (founder 2026-08-29). This is the same control in LITE's own
 * ink - and the same keyboard contract, because a settings control that only
 * answers the mouse is a downgrade, not a redesign.
 *
 * `open` is owned by the caller so opening one dropdown closes the other, and
 * so the host panel can lift its own stacking context while the list is up
 * (see .lite-panel--pop - a glass panel has backdrop-filter, which makes it a
 * stacking context that no z-index on a child can escape).
 */
function LiteSelect({ value, options, onChange, label, open, onOpenChange }) {
  const btnRef = useRef(null)
  const popRef = useRef(null)
  const [active, setActive] = useState(-1)
  const typed = useRef({ buf: '', at: 0 })
  const idx = options.findIndex((o) => o.value === value)
  const current = idx >= 0 ? options[idx] : options[0]

  // Opening lands the highlight on the current row and moves focus into the
  // list, so the very next key is a navigation key.
  useEffect(() => {
    if (!open) return undefined
    setActive(idx < 0 ? 0 : idx)
    const t = setTimeout(() => popRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open, idx])

  useEffect(() => {
    if (!open) return undefined
    const away = (e) => {
      if (popRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      onOpenChange(false)
    }
    // Capture: a row inside a panel that stops propagation must not be able to
    // leave the list open behind it.
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [open, onOpenChange])

  useEffect(() => {
    if (!open || active < 0) return
    popRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const close = (refocus) => { onOpenChange(false); if (refocus) btnRef.current?.focus() }
  const pick = (o) => { onChange(o.value); close(true) }

  const onListKey = (e) => {
    const printable = e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey
    // 🪤 LITE's root exits the whole mode on Escape (see handleKeyDown), and
    // preventDefault does not stop bubbling - closing this list with Escape
    // was dropping the user out of LITE entirely. Anything the list handles
    // stops here.
    if (printable || ['Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(e.key)) e.stopPropagation()
    if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') e.preventDefault(); close(true); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((a) => (((a < 0 ? idx : a) + step) + options.length) % options.length)
      return
    }
    if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); setActive(e.key === 'Home' ? 0 : options.length - 1); return }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const o = options[active]; if (o) pick(o); return }
    if (!printable) return
    // Type-to-jump. Twenty languages in twenty scripts are hard to eyeball;
    // the buffer resets after a pause so "ru" and "r","u" both work.
    const now = Date.now()
    typed.current.buf = now - typed.current.at > 900 ? e.key : typed.current.buf + e.key
    typed.current.at = now
    const q = typed.current.buf.toLowerCase()
    // Match any WORD, not the whole string: the list carries both the native
    // name and the code, so "ru" has to find Русский.
    const hit = options.findIndex((o) => o.search?.some((w) => w.startsWith(q)))
    if (hit >= 0) setActive(hit)
  }

  return (
    <div className={`lite-cselect${open ? ' open' : ''}`}>
      <button
        ref={btnRef}
        type="button"
        className="lite-select lite-cselect-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => onOpenChange(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenChange(true) }
        }}
      >
        <span className="lite-cselect-face">
          {current?.icon && <i className="lite-cselect-flag">{current.icon}</i>}
          <span className="lite-cselect-lbl">{current?.label}</span>
          {current?.note && <span className="lite-cselect-note">{current.note}</span>}
        </span>
        <svg className="lite-cselect-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div ref={popRef} className="lite-cselect-pop" role="listbox" aria-label={label} tabIndex={-1} onKeyDown={onListKey}>
          {options.map((o, i) => (
            <button
              key={o.value}
              type="button"
              data-i={i}
              role="option"
              aria-selected={o.value === value}
              className={`lite-cselect-opt${o.value === value ? ' sel' : ''}${i === active ? ' hot' : ''}`}
              onMouseMove={() => setActive(i)}
              onClick={() => pick(o)}
            >
              {o.icon && <i className="lite-cselect-flag">{o.icon}</i>}
              <span className="lite-cselect-lbl">{o.label}</span>
              {o.note && <span className="lite-cselect-note">{o.note}</span>}
              <svg className="lite-cselect-tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 12.5l5 5L20 6.5" /></svg>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const LITE_LANG_OPTIONS = LITE_LANGS.map(([code, native]) => ({
  value: code,
  label: native,
  search: [native.toLowerCase(), code],
}))

const LITE_CURRENCY_OPTIONS = Object.entries(CURRENCIES).map(([code, cfg]) => {
  // CHF and THB carry their own code as the symbol - printing both reads
  // "CHF CHF".
  const sym = String(cfg.symbol || '').trim()
  return {
    value: code,
    icon: cfg.flag || '',
    label: sym && sym !== code ? `${sym} ${code}` : code,
    note: cfg.name || '',
    search: [code.toLowerCase(), ...(cfg.name || '').toLowerCase().split(' ')],
  }
})

function ThemesView({ look, setLook, bg, setBg, paperBg, setPaperBg, panels, setPanel, language, setLanguage, currency, setCurrency, glassLevel, setGlassLevel, scrollTint, setScrollTint, wallpapers}) {
  const { t } = useTranslation()
  const activeId = bg?.mode === 'mix' || !bg ? 'mix' : bg.scene
  // One dropdown at a time, and the host panel needs to know which - see
  // LiteSelect's note on .lite-panel--pop.
  const [openSel, setOpenSel] = useState(null)
  return (
    <div className="lite-view lite-view--wide">
      <header className="lite-view-head lite-rise">
        <h1 className="lite-view-title">{tl(t, 'Themes', 'ttl')}</h1>
        <p className="lite-view-sub">{tl(t, 'Make it yours - look, backdrop, and what shows on Today.', 'sub')}</p>
      </header>

      <div className="lite-grid lite-rise-1">
        <section className="lite-panel lite-span-6">
          <p className="lite-eyebrow">{tl(t, "Look", 'lbl')}</p>
          <div className="lite-look-cards">
            <button type="button" className={`lite-look-card lite-look-card--glass${look === 'glass' ? ' active' : ''}`} onClick={() => setLook('glass')}>
              <strong>{t('lite.lookGlass', 'Glass')}</strong>
              <span>{tl(t, 'Frosted panels over a living backdrop', 'msg')}</span>
            </button>
            <button type="button" className={`lite-look-card lite-look-card--paper${look === 'paper' ? ' active' : ''}`} onClick={() => setLook('paper')}>
              <strong>{t('lite.lookPaper', 'Paper')}</strong>
              <span>{tl(t, 'Clean white cards, keynote calm', 'msg')}</span>
            </button>
          </div>
        </section>

        {look === 'glass' && setGlassLevel && (
          <section className="lite-panel lite-span-6">
            <p className="lite-eyebrow">{tl(t, 'Glass intensity', 'lbl')}</p>
            <div className="lite-tf-toggle lite-tf-toggle--fit" role="tablist" aria-label={t('lite.themesview.ariaGlassIntensity', "Glass intensity")}>
              {[{ id: 'airy', label: 'Airy' }, { id: 'balanced', label: 'Balanced' }, { id: 'solid', label: 'Solid' }].map((g) => (
                <button key={g.id} type="button" role="tab" aria-selected={glassLevel === g.id} className={`lite-tf-btn${glassLevel === g.id ? ' active' : ''}`} onClick={() => setGlassLevel(g.id)}>{tl(t, g.label)}</button>
              ))}
            </div>
            <p className="lite-social-note">{tl(t, 'Turn this up if the frosted panels feel too see-through on your screen.', 'msg')}</p>
          </section>
        )}

        {setScrollTint && (
          <section className="lite-panel lite-span-6">
            <p className="lite-eyebrow">{tl(t, 'Scrollbar', 'lbl')}</p>
            <div className="lite-sbtint-row" role="radiogroup" aria-label={t('lite.themesview.ariaScrollbarTint', "Scrollbar tint")}>
              {SCROLL_TINTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={(scrollTint || 'default') === s.id}
                  aria-label={s.label}
                  title={s.label}
                  className={`lite-sbtint${(scrollTint || 'default') === s.id ? ' active' : ''}`}
                  onClick={() => setScrollTint(s.id)}
                >
                  <span className="lite-sbtint-pill" style={{ background: s.swatch }} />
                  <span className="lite-sbtint-name">{tl(t, s.label)}</span>
                </button>
              ))}
            </div>
            <p className="lite-social-note">{tl(t, 'Tints every scrollbar across LITE and PRO. Firefox shows the colour but not the glass - it has no way to draw a gradient on a scrollbar.', 'msg')}</p>
          </section>
        )}

        {setLanguage && (
          <section className={`lite-panel lite-span-3${openSel === 'language' ? ' lite-panel--pop' : ''}`}>
            <p className="lite-eyebrow">{tl(t, 'Language', 'lbl')}</p>
            <LiteSelect
              label={t('lite.themesview.label', "Language")}
              value={language || 'en'}
              options={LITE_LANG_OPTIONS}
              open={openSel === 'language'}
              onOpenChange={(v) => setOpenSel(v ? 'language' : null)}
              onChange={(v) => { track(Events.LITE_THEME_CHANGED, { mode: 'language', scene: v }); setLanguage(v) }}
            />
            <p className="lite-social-note">{tl(t, 'A language appears here only once every word of LITE is translated - more are on the way.', 'msg')}</p>
          </section>
        )}

        {setCurrency && (
          <section className={`lite-panel lite-span-3${openSel === 'currency' ? ' lite-panel--pop' : ''}`}>
            <p className="lite-eyebrow">{tl(t, 'Currency', 'lbl')}</p>
            <LiteSelect
              label={t('lite.themesview.label2', "Currency")}
              value={currency || 'USD'}
              options={LITE_CURRENCY_OPTIONS}
              open={openSel === 'currency'}
              onOpenChange={(v) => setOpenSel(v ? 'currency' : null)}
              onChange={(v) => { track(Events.LITE_THEME_CHANGED, { mode: 'currency', scene: v }); setCurrency(v) }}
            />
            <p className="lite-social-note">{tl(t, 'Every price in the app converts instantly - crypto and stocks alike.', 'msg')}</p>
          </section>
        )}
      </div>

      {/* The backdrop catalog is its own grid so a short settings panel can
         never wrap in beside it - two grids give a guaranteed row break,
         which one wrapping flex row cannot express. */}
      <div className="lite-grid lite-rise-1">
        {look === 'glass' ? (
          <section className="lite-panel lite-span-8">
            <p className="lite-eyebrow">{tl(t, "Backdrop", 'lbl')}</p>
            <div className="lite-themes-grid">
              <button type="button" className={`lite-theme-swatch${activeId === 'mix' ? ' active' : ''}`} onClick={() => setBg?.({ mode: 'mix' })}>
                <span className="lite-theme-fill" style={{ background: 'linear-gradient(135deg, #3b6ea5, #6b4f8a 55%, #1c2a3a)' }} />
                <span className="lite-theme-name">{tl(t, 'Daily mix', 'theme')}</span>
              </button>
              <label className={`lite-theme-swatch lite-theme-swatch--upload${bg?.mode === 'custom' ? ' active' : ''}`} title={t('lite.themesview.title', "Upload your own")}>
                <span className="lite-theme-fill lite-theme-fill--upload">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M6 10l6-6 6 6M4 20h16" /></svg>
                </span>
                <span className="lite-theme-name">{tl(t, 'Your photo', 'theme')}</span>
                <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) storeCustomBg(f, (ok) => { if (ok) setBg?.({ mode: 'custom' }) }); e.target.value = '' }} />
              </label>
            </div>
            {/* 🪤 This was the FOURTH hand-written copy of the section list —
                it took `bgCatalog` as a prop and then ignored it, hardcoding
                eleven SwatchGroups. That is why a new section could be live in
                the Edit popover and the PRO Studio and still be absent from the
                page literally called Themes. Driven by the shared catalog now,
                like everything else. */}
            <WallpaperGroup wallpapers={wallpapers} bg={bg} setBg={setBg} />
            {BG_CATALOG.map((g) => (
              <SwatchGroup
                key={g.title}
                title={g.title}
                kind={g.kind}
                items={g.items}
                activeId={activeId}
                onPick={(it) => setBg?.({ mode: g.mode, scene: it.id })}
              />
            ))}
          </section>
        ) : (
          <section className="lite-panel lite-span-8">
            <p className="lite-eyebrow">{tl(t, "Backdrop", 'lbl')}</p>
            {BG_PAPER_CATALOG.map((g) => (
              <SwatchGroup
                key={g.title}
                title={g.title}
                items={g.items}
                activeId={paperBg || 'pearl'}
                onPick={(it) => setPaperBg?.(it.id)}
              />
            ))}
            <p className="lite-social-note">{tl(t, "Soft day-mode washes and prints - cards stay crisp white on every canvas.", 'msg')}</p>
          </section>
        )}

        <section className="lite-panel lite-span-4 lite-panel--hug">
          <p className="lite-eyebrow">{tl(t, "Today sections", 'lbl')}</p>
          {PANEL_DEFS.map(({ key, label }) => {
            const on = panelOn(panels, key)
            return (
              <button key={key} type="button" className="lite-editrow" role="switch" aria-checked={on} onClick={() => setPanel?.(key, !on)}>
                <span>{t(`lite.panel.${key}`, label)}</span>
                <span className={`lite-switch${on ? ' on' : ''}`} aria-hidden><span className="lite-switch-knob" /></span>
              </button>
            )
          })}
          <a
            className="lite-feedback-row"
            href="https://t.me/AI_SPECTRE"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track(Events.LITE_FEEDBACK_CLICKED, { from: 'themes' })}
          >
            {t('lite.feedbackRow', 'LITE is a raw beta - send feedback on Telegram')}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
          </a>
        </section>
      </div>
    </div>
  )
}

// ── Root ──

export default function LitePage({ profile, onExit, onOpenResearch, onOpenPath, onAddWatch, onRemoveWatch, isWatched, panels, setPanel, order, setOrder, bg, setBg, paperBg, setPaperBg, watchlistTokens, look, setLook, market = 'crypto', setMarket }) {
  const { t } = useTranslation()
  const { fmtPrice, fmtLargeShort, language, setLanguage, currency, setCurrency } = useCurrency()
  const data = useLiteData(watchlistTokens)
  const greeting = useGreeting(profile?.name)
  const brief = composeBrief({ global: data.global, fearGreed: data.fearGreed, movers: data.movers, fmtLargeShort, t })
  // Return to the last-open view within the session (tab away and back).
  // ?view=<id> deep-links a tab (the TG bot's macro alerts land on
  // /lite?view=news) and wins over the session memory.
  const [view, setViewState] = useState(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('view')
      if (fromUrl && VIEWS.some((v) => v.id === fromUrl)) return fromUrl
      const saved = sessionStorage.getItem('spectre-lite-view')
      return VIEWS.some((v) => v.id === saved) ? saved : 'today'
    } catch (_) { return 'today' }
  })
  const [backTo, setBackTo] = useState(null)
  // Mobile display density: 'in' (default) | 'out' (smaller type, thinner
  // glass - more of the backdrop breathes). Device-local, like nav collapse.
  const [zoom, setZoomState] = useState(() => {
    try { return localStorage.getItem('spectre-lite-zoom') === 'out' ? 'out' : 'in' } catch (_) { return 'in' }
  })
  const toggleZoom = useCallback(() => {
    setZoomState((z) => {
      const next = z === 'in' ? 'out' : 'in'
      try { localStorage.setItem('spectre-lite-zoom', next) } catch (_) { /* private mode */ }
      track(Events.LITE_ZOOM_TOGGLED, { zoom: next })
      return next
    })
  }, [])

  // One page-open event per mount - which look/zoom the session runs.
  useEffect(() => {
    track(Events.LITE_VIEWED, { look, zoom })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // RAW-beta notice: shown once per device until acknowledged.
  const [betaAck, setBetaAck] = useState(() => {
    try { return localStorage.getItem('spectre-lite-beta-ack') === '1' } catch (_) { return true }
  })
  const ackBeta = useCallback(() => {
    try { localStorage.setItem('spectre-lite-beta-ack', '1') } catch (_) { /* private mode */ }
    track(Events.LITE_BETA_ACK, { choice: 'try' })
    setBetaAck(true)
  }, [])
  // Collapsible left rail (icons-only when collapsed) — persisted across sessions.
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return localStorage.getItem('spectre-lite-nav-collapsed') === '1' } catch (_) { return false }
  })
  const toggleNav = useCallback(() => {
    setNavCollapsed((c) => {
      const next = !c
      try { localStorage.setItem('spectre-lite-nav-collapsed', next ? '1' : '0') } catch (_) { /* private mode */ }
      return next
    })
  }, [])
  const setView = useCallback((id) => {
    track(Events.LITE_TAB_CHANGED, { tab: id })
    setViewState((prev) => {
      if (prev !== id) setBackTo(prev)
      return id
    })
    try { sessionStorage.setItem('spectre-lite-view', id) } catch (_) { /* private mode */ }
  }, [])
  const goBack = useCallback(() => {
    if (!backTo) return
    setViewState(backTo)
    setBackTo(null)
    try { sessionStorage.setItem('spectre-lite-view', backTo) } catch (_) { /* noop */ }
  }, [backTo])
  // Start the photo rotation on a scene that fits the hour (morning shore,
  // afternoon mountains, night stars) - the GM cards' time-of-day trick.
  const [bgIndex, setBgIndex] = useState(() => {
    const h = new Date().getHours()
    if (h >= 5 && h < 12) return 1
    if (h < 18) return 0
    return 4
  })

  const handleKeyDown = useCallback((e) => { if (e.key === 'Escape') onExit?.() }, [onExit])
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const [customBg, setCustomBg] = useState(() => (bg?.mode === 'custom' ? readCustomBg() : null))
  const scenePhoto = bg?.mode === 'scene' ? ALL_PHOTO_SCENES.find((sc) => sc.id === bg.scene)?.photo : null
  const cssBg = resolveCssBg(bg)
  // Flat light swatches (white/pearl solids + gradients) under Glass get the
  // FULL light treatment - Paper's ink and cards on the chosen backdrop.
  // Bright photo scenes keep the daylight dark-frost look instead.
  const lightBg = look === 'glass' && (bg?.mode === 'solid' || bg?.mode === 'gradient') && !!resolveBgDef(bg)?.light
  const rotating = look === 'glass' && bg?.mode !== 'custom' && !scenePhoto && !cssBg

  useEffect(() => {
    if (!rotating) return undefined
    const cycle = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      setBgIndex((i) => (i + 1) % BG_PHOTO_IDS.length)
    }, 12000)
    return () => clearInterval(cycle)
  }, [rotating])

  const wl = (onAddWatch && onRemoveWatch && isWatched)
    ? { add: onAddWatch, remove: onRemoveWatch, has: isWatched }
    : null
  const [researchSym, setResearchSym] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('spectre-lite-research') || 'null')
      if (saved?.sym) return String(saved.sym)
    } catch (_) { /* fresh */ }
    return market === 'stocks' ? 'AAPL' : 'BTC'
  })
  // The identity of the last board click ({sym, cgId, name, image}) - see
  // pickResearch. Session-local by design: identity is per-navigation intent.
  const [researchPick, setResearchPick] = useState(null)
  const [researchStock, setResearchStock] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('spectre-lite-research') || 'null')
      if (saved?.sym) return !!saved.stock
    } catch (_) { /* fresh */ }
    return market === 'stocks'
  })
  useEffect(() => {
    try { sessionStorage.setItem('spectre-lite-research', JSON.stringify({ sym: researchSym, stock: researchStock })) } catch (_) { /* private mode */ }
  }, [researchSym, researchStock])
  const visibleViews = useMemo(() => (
    market === 'stocks' ? VIEWS.filter((v) => STOCKS_MODE_VIEW_IDS.has(v.id) && v.id !== 'stocks') : VIEWS
  ), [market])
  const setMarketTracked = useCallback((m) => {
    if (!setMarket || m === market) return
    setMarket(m)
    track(Events.LITE_TAB_CHANGED, { view: `market:${m}` })
    if (m === 'stocks') {
      if (!STOCKS_MODE_VIEW_IDS.has(view) || view === 'stocks') setView('today')
      setResearchSym('AAPL'); setResearchStock(true)
    } else {
      setResearchSym('BTC'); setResearchStock(false)
    }
  }, [setMarket, market, view, setView])
  const pickResearch = useCallback((sym, opts) => {
    if (sym) {
      const up = String(sym).toUpperCase()
      setResearchSym(up)
      setResearchStock(!!opts?.stock || STOCK_SYMBOL_SET.has(up))
      // Identity riding along with the click (Gainers rows carry a cg_id).
      // Tickers collide - TWO different "UP" tokens sit on the momentum board
      // (unitas + superform, measured 2026-08-21) and the box's own /v1/prices
      // "UP" row is a third chimera - so when the clicked row KNOWS which coin
      // it is, that knowledge must survive the navigation. Cleared on picks
      // that carry none, so a later plain pick can't inherit a stale identity.
      setResearchPick(opts?.cgId || opts?.name
        ? { sym: up, cgId: opts.cgId || null, name: opts.name || null, image: opts.image || null }
        : null)
    }
    setView('research')
  }, [setView])
  // Chip/search picks inside the research view are crypto unless known-stock.
  const setResearchSymSmart = useCallback((sym) => {
    const up = String(sym).toUpperCase()
    setResearchSym(up)
    setResearchStock(STOCK_SYMBOL_SET.has(up) && researchStock)
  }, [researchStock])

  const setLookTracked = useCallback((l) => { track(Events.LITE_LOOK_CHANGED, { look: l }); setLook?.(l) }, [setLook])
  // Scrollbar tint lives in the settings store so LITE and PRO share one pick.
  // Painting is pure CSS (App.jsx stamps data-sb-tint on <html>).
  const scrollTint = useSettingsStore((st) => st.scrollTint)
  const setScrollTintStore = useSettingsStore((st) => st.setScrollTint)
  // Ambience selection + volume. Read straight from the store like scrollTint
  // above rather than threaded through index.jsx — nothing outside Lite needs
  // them, so there is no reason to widen LitePage's prop surface.
  // The user's own wallpaper set (IndexedDB, this device only).
  const wallpapers = useWallpapers()
  const musicSource = useSettingsStore((st) => st.liteMusicSource)
  const setMusicSource = useSettingsStore((st) => st.setLiteMusicSource)
  const musicVolume = useSettingsStore((st) => st.liteMusicVolume)
  const setMusicVolume = useSettingsStore((st) => st.setLiteMusicVolume)
  const setScrollTintTracked = useCallback((id) => {
    track(Events.LITE_THEME_CHANGED, { mode: 'scrollbar', scene: id })
    setScrollTintStore?.(id)
  }, [setScrollTintStore])
  const setPaperBgTracked = useCallback((id) => { track(Events.LITE_THEME_CHANGED, { mode: 'paper-wash', scene: id }); setPaperBg?.(id) }, [setPaperBg])
  const setBgTracked = useCallback((b) => {
    track(Events.LITE_THEME_CHANGED, { mode: b?.mode || 'mix', scene: b?.scene || null })
    setBg?.(b)
    if (b?.mode === 'custom') setCustomBg(readCustomBg())
  }, [setBg])

  // One symbol -> logo map from everything the shell already fetched.
  const imgBySym = useMemo(() => {
    const m = {}
    for (const r of data.marketRows || []) { if (r.symbol && r.image && !m[r.symbol]) m[r.symbol] = r.image }
    for (const s of data.social || []) { if (s.symbol && s.image && !m[s.symbol]) m[s.symbol] = s.image }
    for (const [s, p] of Object.entries(data.watchlistPrices || {})) { if (p?.image && !m[s]) m[s] = p.image }
    return m
  }, [data.marketRows, data.social, data.watchlistPrices])

  // Glass intensity: some phones/eyes need more opaque panels ("mega
  // transparency hard to see"). Airy = the original look.
  const [glassLevel, setGlassLevel] = useState(() => {
    try { return localStorage.getItem('spectre-lite-glass') || 'airy' } catch (_) { return 'airy' }
  })
  const setGlassLevelPersist = useCallback((lv) => {
    setGlassLevel(lv)
    track(Events.LITE_THEME_CHANGED, { mode: 'glass-level', scene: lv })
    try { localStorage.setItem('spectre-lite-glass', lv) } catch (_) { /* private mode */ }
  }, [])

  const rootRef = React.useRef(null)
  const scrollTimerRef = React.useRef(null)
  const [dataEpoch, setDataEpoch] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const onRefresh = useCallback(() => {
    track(Events.LITE_TAB_CHANGED, { view: 'refresh' })
    bustStockCache()
    bustResearchCaches()
    _trendCache = null; _predictionsCache = null; _derivCache = null; _walletsCache = null
    data.refresh?.()
    setDataEpoch((e) => e + 1)
    setRefreshing(true)
    setTimeout(() => setRefreshing(false), 900)
  }, [data])
  const onMainScroll = useCallback(() => {
    const r = rootRef.current
    if (!r) return
    r.classList.add('lite-scrolling')
    clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => r.classList.remove('lite-scrolling'), 140)
  }, [])

  // Cinema mode — immersive token carousel over a view's list.
  const [themeSheet, setThemeSheet] = useState(false)
  const [cinema, setCinema] = useState(null) // { title, rows, index }
  const openCinema = useCallback((title, rows, index = 0) => {
    if (!Array.isArray(rows) || rows.length === 0) return
    track(Events.LITE_TAB_CHANGED, { view: `cinema:${title}` })
    setCinema({ title, rows, index })
  }, [])
  // Resolve the SAME wallpaper the page shows, so the cinema paints it opaquely
  // (page chrome behind is fully hidden — only the wallpaper + detail show).
  const cinemaBgCss = look === 'paper'
    ? resolvePaperBg(paperBg)
    : cssBg
      ? cssBg
      : (bg?.mode === 'custom' && customBg)
        ? `#0a0a0e url('${customBg}') center/cover no-repeat`
        : scenePhoto
          ? `#0a0a0e url('${bgUrl(scenePhoto)}') center/cover no-repeat`
          : `#0a0a0e url('${bgUrl(BG_PHOTO_IDS[bgIndex])}') center/cover no-repeat`

  // The back pill is handed to the VIEW as well as rendered by the shell, so a
  // view can pull it into its own header row instead of paying a whole line for
  // it (Research does; every other view ignores these two props and the shell
  // renders the pill above them exactly as before).
  const backLabel = backTo ? t(`lite.tab.${backTo}`, VIEWS.find((v) => v.id === backTo)?.label || 'Back') : null
  const viewProps = { data, fmtPrice, fmtLargeShort, onOpenPath, onNav: setView, wl, onPickResearch: pickResearch, imgBySym, market, onCinema: openCinema, onBack: backTo && backTo !== view ? goBack : null, backLabel }

  // Look-modifier classes shared by the shell root AND cinema mode, so cinema
  // panels render with the SAME glass intensity / theme the user picked (instead
  // of the ultra-transparent base). Cinema mode reuses these via `lookClass`.
  // Neon Coast retints and re-types the shell (see lite-neon.css). One flag for
  // BOTH looks — the theme has to hold together on glass and on paper, or it is
  // just a wallpaper.
  const neonBg = isNeonBg(bg, look === 'paper' || lightBg ? paperBg : null)
  const lookMods = `lite-root--${lightBg ? 'paper' : look}${neonBg ? ' lite-root--neon' : ''}${lightBg ? ' lite-root--onlight' : ''}${look === 'glass' && !lightBg && glassLevel !== 'airy' ? ` lite-glass-${glassLevel}` : ''}${look === 'glass' && !lightBg && isBrightBg(bg) ? ' lite-root--daylight' : ''}`

  return (
    <div ref={rootRef} className={`lite-root ${lookMods}${zoom === 'out' ? ' lite-root--zoomout' : ''}`} role="main" aria-label="Spectre Lite">
      {look === 'glass' && (
        <>
          <div className="lite-bg-base" aria-hidden />
          {cssBg ? (
            <div aria-hidden className="lite-bg" style={{ background: cssBg, opacity: 1 }} />
          ) : bg?.mode === 'custom' && customBg ? (
            <img src={customBg} alt="" aria-hidden className="lite-bg" style={{ opacity: 1 }} />
          ) : scenePhoto ? (
            <img src={bgUrl(scenePhoto)} alt="" aria-hidden decoding="async" className="lite-bg" style={{ opacity: 1 }} />
          ) : (
            BG_PHOTO_IDS.map((id, i) => (
              <img key={id} src={bgUrl(id)} alt="" aria-hidden decoding="async" loading={i === 0 ? 'eager' : 'lazy'} className="lite-bg" style={{ opacity: i === bgIndex ? 1 : 0 }} />
            ))
          )}
          <div className={`lite-scrim${lightBg ? ' lite-scrim--light' : ''}`} aria-hidden />
        </>
      )}
      {look === 'paper' && <div className="lite-paperwash" aria-hidden style={{ background: resolvePaperBg(paperBg) }} />}

      {!betaAck && (
        <div className="lite-beta-overlay" role="dialog" aria-modal="true" aria-label={t('lite.litepage.ariaSpectreLiteBetaNotice', "Spectre LITE beta notice")}>
          <div className="lite-beta-card">
            <span className="lite-beta-tag">{t('lite.beta.tag', 'Raw beta')}</span>
            <h2>{t('lite.beta.title', 'Welcome to Spectre LITE')}</h2>
            <p>{t('lite.beta.body', 'The whole market, made simple. LITE is a raw beta testing feature - it changes fast, and a few rough edges are part of the deal. Everything here links back to the full PRO app.')}</p>
            <div className="lite-beta-actions">
              <button type="button" className="lite-beta-go" onClick={ackBeta}>{t('lite.beta.try', 'Try the beta')}</button>
              <button type="button" className="lite-beta-exit" onClick={() => { track(Events.LITE_BETA_ACK, { choice: 'pro' }); onExit?.() }}>{t('lite.beta.back', 'Back to PRO')}</button>
            </div>
            <a
              className="lite-beta-feedback"
              href="https://t.me/AI_SPECTRE"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => track(Events.LITE_FEEDBACK_CLICKED, { from: 'beta-popup' })}
            >
              {t('lite.beta.feedback', 'Found something broken? Tell us on Telegram →')}
            </a>
          </div>
        </div>
      )}

      <LiteNav views={visibleViews} view={view} setView={setView} look={look} setLook={setLookTracked} onExit={onExit} collapsed={navCollapsed} onToggle={toggleNav} market={market} setMarket={setMarketTracked} onRefresh={onRefresh} refreshing={refreshing} />
      <LiteTopbar look={look} setLook={setLookTracked} onExit={onExit} zoom={zoom} onToggleZoom={toggleZoom} market={market} setMarket={setMarketTracked} onRefresh={onRefresh} refreshing={refreshing} onHome={() => setView('today')} />

      <main className="lite-main" key={`${view}:${dataEpoch}`} onScroll={onMainScroll}>
        {backTo && backTo !== view && view !== 'research' && (
          <button type="button" className="lite-back" onClick={goBack}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            {t(`lite.tab.${backTo}`, VIEWS.find((v) => v.id === backTo)?.label || 'Back')}
          </button>
        )}
        {view === 'why' && <WhyView {...viewProps} />}
        {view === 'today' && market === 'stocks' && <StocksView {...viewProps} />}
        {view === 'today' && market !== 'stocks' && <TodayView greeting={greeting} brief={brief} {...viewProps} panels={panels} setPanel={setPanel} order={order} setOrder={setOrder} onPickResearch={pickResearch} look={look} bg={bg} setBg={setBgTracked} paperBg={paperBg} setPaperBg={setPaperBgTracked} musicSource={musicSource} setMusicSource={setMusicSource} musicVolume={musicVolume} setMusicVolume={setMusicVolume} wallpapers={wallpapers} />}
        {view === 'markets' && (market === 'stocks' ? <StockMarketsView {...viewProps} /> : <MarketsView {...viewProps} />)}
        {view === 'derivs' && <DerivativesView {...viewProps} />}
        {view === 'liq' && <LiqView fmtPrice={fmtPrice} fmtLargeShort={fmtLargeShort} onOpenPath={onOpenPath} imgBySym={imgBySym} onNav={setView} light={look === 'paper' || lightBg || isBrightBg(bg)} />}
        {view === 'etf' && <EtfView fmtLargeShort={fmtLargeShort} fmtPrice={fmtPrice} onOpenPath={onOpenPath} />}
        {view === 'gainers' && <GainersView fmtLargeShort={fmtLargeShort} onOpenPath={onOpenPath} onPickResearch={pickResearch} />}
        {view === 'rotation' && <RotationView data={data} fmtLargeShort={fmtLargeShort} onOpenPath={onOpenPath} light={look === 'paper' || lightBg || isBrightBg(bg)} />}
        {view === 'private' && <PrivateView fmtLargeShort={fmtLargeShort} onOpenPath={onOpenPath} />}
        {view === 'zig' && <ZigView fmtPrice={fmtPrice} fmtLargeShort={fmtLargeShort} onOpenPath={onOpenPath} onPickResearch={pickResearch} />}
        {view === 'research' && <ResearchView {...viewProps} onOpenResearch={onOpenResearch} sym={researchSym} setSym={setResearchSymSmart} isStock={researchStock} pick={researchPick} />}
        {view === 'compare' && <CompareView {...viewProps} />}
        {view === 'heatmap' && <HeatmapView {...viewProps} />}
        {view === 'flows' && <FlowsView {...viewProps} light={look === 'paper' || lightBg || isBrightBg(bg)} />}
        {view === 'vitals' && <VitalsView {...viewProps} />}
        {view === 'bubbles' && <BubblesView {...viewProps} />}
        {view === 'social' && <SocialView {...viewProps} />}
        {view === 'wallets' && <WalletsView fmtLargeShort={fmtLargeShort} onOpenPath={onOpenPath} onPickResearch={pickResearch} imgBySym={imgBySym} />}
        {view === 'movers' && (market === 'stocks' ? <StockMoversView {...viewProps} /> : <MoversView {...viewProps} />)}
        {view === 'stocks' && <StocksView {...viewProps} />}
        {view === 'sectors' && (market === 'stocks' ? <StockSectorsView {...viewProps} /> : <SectorsView {...viewProps} />)}
        {view === 'calendar' && <CalendarView onOpenPath={onOpenPath} />}
        {view === 'predictions' && <PredictionsView fmtLargeShort={fmtLargeShort} onOpenPath={onOpenPath} />}
        {view === 'deals' && <DealsView fmtLargeShort={fmtLargeShort} onOpenPath={onOpenPath} />}
        {view === 'rwa' && <RwaView fmtLargeShort={fmtLargeShort} onOpenPath={onOpenPath} imgBySym={imgBySym} />}
        {view === 'roi' && <RoiView {...viewProps} />}
        {view === 'watchlist' && (market === 'stocks' ? <StockWatchlistView {...viewProps} search={<LiteSearch wl={wl} onPick={pickResearch} market={market} />} /> : <WatchlistView {...viewProps} />)}
        {view === 'sentiment' && <SentimentView {...viewProps} />}
        {view === 'news' && (market === 'stocks' ? <StockNewsView {...viewProps} /> : <NewsView {...viewProps} />)}
        {view === 'media' && <MediaView onOpenPath={onOpenPath} />}
        {view === 'inteldesk' && <LiteIntelDeskView imgBySym={imgBySym} />}
        {view === 'insights' && <InsightsView onOpenPath={onOpenPath} market={market} fmtPrice={fmtPrice} fmtLargeShort={fmtLargeShort} imgBySym={imgBySym} />}
        {view === 'themes' && (
          <ThemesView
            language={language}
            setLanguage={setLanguage}
            currency={currency}
            setCurrency={setCurrency}
            glassLevel={glassLevel}
            setGlassLevel={setGlassLevelPersist}
            scrollTint={scrollTint}
            setScrollTint={setScrollTintTracked}
            look={look}
            setLook={setLookTracked}
            bg={bg}
            setBg={setBgTracked}
            paperBg={paperBg}
            setPaperBg={setPaperBgTracked}
            panels={panels}
            setPanel={setPanel}
            wallpapers={wallpapers}
          />
        )}
      </main>

      <LiteTabbar views={visibleViews} view={view} setView={setView} />

      {/* LITE's own globe. Same orb as PRO (shared component, shared stored
          position) wired to LITE's picker instead of PRO's — the founder wants
          the control there, it just has to change what is on the screen. */}
      {!cinema && (
        <React.Suspense fallback={null}>
          <ThemeGlobe onOpen={() => setThemeSheet((v) => !v)} />
        </React.Suspense>
      )}
      {themeSheet && (
        <LiteThemeSheet
          lookClass={lookMods}
          onClose={() => setThemeSheet(false)}
          language={language}
          setLanguage={setLanguage}
          currency={currency}
          setCurrency={setCurrency}
          glassLevel={glassLevel}
          setGlassLevel={setGlassLevelPersist}
          scrollTint={scrollTint}
          setScrollTint={setScrollTintTracked}
          look={look}
          setLook={setLookTracked}
          bg={bg}
          setBg={setBgTracked}
          paperBg={paperBg}
          setPaperBg={setPaperBgTracked}
          panels={panels}
          setPanel={setPanel}
        />
      )}

      {/* Cinema `look`: bright wallpapers (the daylight class) must take the
          LIGHT path too — glass ink over Cloud White was the washed-out,
          "not designed" cinema the founder screenshotted. */}
      {cinema && (
        <LiteCinema
          title={cinema.title}
          market={market}
          rows={cinema.rows}
          startIndex={cinema.index}
          look={lightBg || (look === 'glass' && isBrightBg(bg)) ? 'paper' : look}
          lookClass={lookMods}
          bgCss={cinemaBgCss}
          fmtPrice={fmtPrice}
          fmtLargeShort={fmtLargeShort}
          wl={wl}
          onClose={() => setCinema(null)}
          onResearch={(sym, opts) => { setCinema(null); pickResearch(sym, opts) }}
          themeControls={{ look, setLook, glassLevel, setGlassLevel, bg, setBg, paperBg, setPaperBg, lightBg, bgCatalog: LITE_BG_CATALOG, paperCatalog: LITE_PAPER_CATALOG }}
        />
      )}
    </div>
  )
}

