/**
 * ChartPanel - inline/overlay chart panel extracted from WelcomePage.
 * Renders the chart sidebar/overlay with timeframe tabs, TradingView embed,
 * fullscreen portal, project info, and social links.
 */
import React, { useEffect, useMemo, useRef, useState, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { isStockAsset } from '@/lib/asset-identity'
import SpectreChart from '@/chart/SpectreChart'
import TradingViewAdvanced from '@/components/TradingViewAdvanced'
// PR-7 (perf): lazy - this surface opens on user action; keep the 5400-line
// chart module out of the page's initial chunk. lazyWithRetry preserves
// stale-chunk recovery.
import lazyWithRetry from '@/lib/lazy-with-retry'
const TradingChart = lazyWithRetry(() => import('@/components/trading-chart'))
import useLivePrices, { tokenKey as makeTokenKey } from '@/hooks/useLivePrices'
import { getNetworkName, getDetailedTokenInfo } from '@/services/codexApi'
import { getRzBootstrap } from '@/services/spectreDataApi'
import { isDev } from '@/utils/env'
import spectreIcons from '@/icons/spectreIcons'
import { COIN_DESCRIPTIONS, CHAIN_LOGOS } from './welcome-page-constants'

// Strip empty/garbage socials so we don't render dead buttons
const validUrl = (u) => {
  if (!u || typeof u !== 'string') return null
  const t = u.trim()
  if (!t || t === '#' || t === 'null' || t === 'undefined') return null
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}

// Trading app deep-link target for on-chain DEX tokens. The trading app handles
// `#token/<address>` natively (see apps/trading/src/App.jsx parseHash) and
// auto-resolves networkId from address format. Using a hard URL (not the
// research /token iframe) gives the user the full trading terminal — chart,
// swap, holders, trades — instead of the welcome-page chart preview.
const TRADING_APP_URL = isDev
  ? (import.meta.env.VITE_TRADING_APP_URL || `http://localhost:${typeof __TRADING_PORT__ !== 'undefined' ? __TRADING_PORT__ : 5181}`)
  : 'https://spectre-trading.vercel.app'

function tradingTokenUrl(token) {
  if (!token?.address) return null
  return `${TRADING_APP_URL}/#token/${token.address}`
}

// Compact USD price formatter that mirrors the trading app's hero number:
// keeps significant digits for tiny DEX prices instead of $0.00 truncation.
function formatLivePrice(p) {
  if (!Number.isFinite(p) || p <= 0) return ''
  if (p >= 1) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
  if (p >= 0.01) return `$${p.toFixed(4)}`
  if (p >= 0.0001) return `$${p.toFixed(6)}`
  // Sub-cent → use 4 significant digits so precision survives the format
  const exp = Math.ceil(-Math.log10(p))
  return `$${p.toFixed(Math.min(12, exp + 3))}`
}

function formatPctChange(c) {
  if (!Number.isFinite(c)) return ''
  const sign = c > 0 ? '+' : ''
  const abs = Math.abs(c)
  const digits = abs >= 100 ? 1 : 2
  return `${sign}${c.toFixed(digits)}%`
}

// Normalize the welcome page's lowercase tf values ('1h', '24h', '7d', 'all'...)
// to TradingViewAdvanced's uppercase resolution map ('1M', '5M', ..., '1D', '1W').
const NORMALIZE_TF = {
  '1m': '1M', '5m': '5M', '15m': '15M', '30m': '30M',
  '1h': '1H', '4h': '4H', '1d': '1D', '1w': '1W',
  '24h': '1H', '7d': '1D', '30d': '1D', 'all': '1D',
}
const normalizeTimeframe = (tf) => {
  if (!tf) return '1H'
  const upper = String(tf).toUpperCase()
  if (['1M','5M','15M','30M','1H','4H','1D','1W'].includes(upper)) return upper
  return NORMALIZE_TF[String(tf).toLowerCase()] || '1H'
}

// DEX/on-chain tokens have a contract address + numeric networkId.
// These need the UDF-backed TradingViewAdvanced (Codex via /api/tradingview/udf/history)
// because SpectreChart's /api/codex direct path returns no data for many low-cap pairs.
const isOnChainToken = (token) =>
  !!(token && token.address && token.networkId && !token.isStock && token.assetClass !== 'stock')

const ChartPanel = ({
  inline = false,
  token,
  onClose,
  timeframe,
  setTimeframe,
  subTab,
  setSubTab,
  yAxis,
  setYAxis,
  fullscreen,
  setFullscreen,
  overlayTimeframes,
  getTradingViewSymbol,
  binancePrices,
  selectToken,
  onPageChange,
  onOpenResearchZone,
  t,
  dayMode = false,
}) => {
  const { t: tr } = useTranslation()
  // No chart TA layer here: welcome-page.css hides this wrap's .chart-controls
  // ("`.welcome-chart-overlay-tradingchart-wrap .chart-controls { display:none }`"),
  // so the TA toolbar could never be reached and the whole surface was dead
  // wiring. Traders Corner and the Research Zone are where the read lives.
  const taChartRef = useRef(null)

  // Live price for the selected token from the same /api/bars source the chart
  // reads. Server-cached, so the duplicate request is cheap. Guarantees the
  // header price equals the chart's last close (no Codex aggregation drift).
  const livePriceList = useMemo(() => (token ? [token] : []), [token])
  const livePriceMap = useLivePrices(livePriceList)
  const livePrice = useMemo(() => {
    const k = makeTokenKey(token)
    if (!k) return null
    return livePriceMap.get(k) ?? null
  }, [livePriceMap, token])

  const displayPrice = livePrice ?? token?.price ?? null
  const baseChange24h = token?.change24h ?? token?.change ?? 0
  // If we have both a fresh live price and the original snapshot price + change,
  // recompute change24h relative to the historical anchor so the badge stays
  // honest (otherwise the header price would tick live but the % would lag).
  const displayChange = useMemo(() => {
    if (livePrice && token?.price > 0 && baseChange24h !== 0) {
      const past = token.price / (1 + baseChange24h / 100)
      if (past > 0) return ((livePrice - past) / past) * 100
    }
    return baseChange24h
  }, [livePrice, token?.price, baseChange24h])

  const sameSymAndName = !token?.name || token.name === token.symbol
  const chainLogo = token?.networkId ? CHAIN_LOGOS[token.networkId] : null
  const chainLabel = token?.networkId ? getNetworkName(token.networkId) : ''
  const changeClass = displayChange > 0 ? 'bull' : displayChange < 0 ? 'bear' : 'neutral'

  // Lazy-load socials/description for on-chain DEX tokens.
  // 2026-05-08 cost migration: try Spectre /v1/coins/{id} (CG profile + socials, free) first.
  // Codex only as fallback when Spectre returns nothing useful (rare/new DEX tokens).
  const [details, setDetails] = useState(null)
  useEffect(() => {
    let cancelled = false
    setDetails(null)
    if (!token?.address || !token?.networkId || !isOnChainToken(token)) return
    ;(async () => {
      try {
        const sym = token?.symbol || ''
        if (sym) {
          const sp = await getRzBootstrap(sym).catch(() => null)
          const profile = sp?.profile || sp
          if (profile && (profile.description || profile.socials || profile.links)) {
            if (!cancelled) {
              setDetails({
                description: profile.description?.en || profile.description || profile.about || '',
                socials: {
                  website: profile.links?.homepage?.[0] || profile.socials?.website || null,
                  twitter: profile.links?.twitter_screen_name ? `https://x.com/${profile.links.twitter_screen_name}` : profile.socials?.twitter || null,
                  telegram: profile.links?.telegram_channel_identifier ? `https://telegram.me/${profile.links.telegram_channel_identifier}` : profile.socials?.telegram || null,
                  discord: profile.socials?.discord || null,
                },
              })
              return
            }
          }
        }
        // Codex fallback (last resort — costs quota)
        const d = await getDetailedTokenInfo(token.address, token.networkId)
        if (!cancelled) setDetails(d)
      } catch {
        if (!cancelled) setDetails(null)
      }
    })()
    return () => { cancelled = true }
  }, [token?.address, token?.networkId, token?.symbol])

  const socials = useMemo(() => ({
    website: validUrl(details?.socials?.website || token?.socials?.website),
    twitter: validUrl(details?.socials?.twitter || token?.socials?.twitter),
    telegram: validUrl(details?.socials?.telegram || token?.socials?.telegram),
    discord: validUrl(details?.socials?.discord || token?.socials?.discord),
  }), [details, token])

  const description = isStockAsset(token)
    ? (token?.description || `${token.name || token.symbol} (${token.symbol}). View market prices and trading charts below.`)
    : COIN_DESCRIPTIONS[token?.symbol]
    || details?.description
    || (token?.name ? `${token.name} (${token.symbol}) is a cryptocurrency token. View real-time price data, trading charts, and on-chain analytics below.` : '')

  return (
  <div
    className={`welcome-chart-overlay-panel-right${inline ? ' welcome-chart-inline-panel' : ''}`}
    onClick={inline ? undefined : (e) => e.stopPropagation()}
  >
    <button
      type="button"
      className="welcome-chart-overlay-close"
      onClick={onClose}
      aria-label={tr('homePage.chartPanel.chartpanel.ariaCloseChart', "Close chart")}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>
    <div className="welcome-chart-overlay-header">
      <div className="welcome-chart-overlay-token-info">
        {token.logo ? <img src={token.logo} alt="" className="welcome-chart-overlay-logo" onError={(e) => { e.target.style.display = 'none' }} /> : <span className="welcome-chart-overlay-logo-placeholder">{token.symbol?.[0]}</span>}
        <div className="welcome-chart-panel-identity">
          <div className="welcome-chart-panel-titles">
            <span className="welcome-chart-panel-token">{token.symbol}</span>
            {!sameSymAndName && <span className="welcome-chart-panel-name">{token.name}</span>}
            {isOnChainToken(token) && chainLogo && (
              <span className="welcome-chart-panel-chain" title={chainLabel}>
                <img src={chainLogo} alt={chainLabel} className="welcome-chart-panel-chain-logo" />
              </span>
            )}
          </div>
          {displayPrice != null && (
            <div className="welcome-chart-panel-pricerow">
              <span className="welcome-chart-panel-price mono">{formatLivePrice(displayPrice)}</span>
              {Number.isFinite(displayChange) && displayChange !== 0 && (
                <span className={`welcome-chart-panel-change ${changeClass} mono`}>{formatPctChange(displayChange)}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    {/* External chart toolbar — hidden globally now. Both the on-chain branch
        (TradingViewAdvanced) and the top-coins branch (TradingChart) ship their
        own functional toolbars; rendering a duplicate above the embedded widget
        only confused users (the upper buttons did not drive the widget). */}
    {false && !isOnChainToken(token) && (<>
    {/* Timeframe tabs: 1m, 30m, 1h, 1d, All Time, 24h, 7d, 30d */}
    <div className="welcome-chart-overlay-timeframe-row">
      <div className="welcome-chart-overlay-tabs">
        {overlayTimeframes.map((tf) => (
          <button
            key={tf.id}
            type="button"
            className={`welcome-chart-overlay-tab ${timeframe === tf.id ? 'active' : ''}`}
            onClick={() => setTimeframe(tf.id)}
          >
            {tf.label}
          </button>
        ))}
      </div>
      <div className="welcome-chart-overlay-toolbar">
        <button type="button" className="welcome-chart-overlay-tool-btn" data-tooltip="Indicators"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18M7 16l4-8 4 4 4-8"/></svg></button>
        <button type="button" className="welcome-chart-overlay-tool-btn" data-tooltip="Drawing"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg></button>
        <button type="button" className="welcome-chart-overlay-tool-btn" data-tooltip="Settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg></button>
      </div>
    </div>
    {/* Unified chart toolbar - Candles, Line, TradingView + Price/MCap + Timeframes */}
    <div className="welcome-chart-unified-toolbar">
      <div className="welcome-chart-toolbar-left">
        <button type="button" className={`welcome-chart-type-btn ${subTab === 'candles' ? 'active' : ''}`} onClick={() => setSubTab('candles')}>
          <svg viewBox="0 0 20 20" fill="currentColor"><path d="M6 3a1 1 0 011 1v1h1a1 1 0 010 2H7v6h1a1 1 0 010 2H7v1a1 1 0 11-2 0v-1H4a1 1 0 110-2h1V7H4a1 1 0 010-2h1V4a1 1 0 011-1zm8 0a1 1 0 011 1v3h1a1 1 0 010 2h-1v4h1a1 1 0 010 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 010-2h1V9h-1a1 1 0 010-2h1V4a1 1 0 011-1z" /></svg>
          <span>{t('ui.candles')}</span>
        </button>
        <button type="button" className={`welcome-chart-type-btn ${subTab === 'line' ? 'active' : ''}`} onClick={() => setSubTab('line')}>
          <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11.707 4.707a1 1 0 00-1.414-1.414L10 9.586 8.707 8.293a1 1 0 00-1.414 0l-2 2a1 1 0 101.414 1.414L8 10.414l1.293 1.293a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
          <span>{t('ui.line')}</span>
        </button>
        <button type="button" className={`welcome-chart-type-btn ${subTab === 'tradingview' ? 'active' : ''}`} onClick={() => setSubTab('tradingview')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18" strokeLinecap="round" strokeLinejoin="round"/><path d="M18 9l-5 5-4-4-3 3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span>{t('ui.tradingView')}</span>
        </button>
        <div className="welcome-chart-toolbar-divider"></div>
        <div className="welcome-chart-price-mcap">
          <button type="button" className={`welcome-chart-toggle-btn ${yAxis === 'price' ? 'active' : ''}`} onClick={() => setYAxis('price')}>{t('ui.price')}</button>
          <button type="button" className={`welcome-chart-toggle-btn ${yAxis === 'mcap' ? 'active' : ''}`} onClick={() => setYAxis('mcap')}>{t('ui.mCap')}</button>
        </div>
        <div className="welcome-chart-toolbar-divider"></div>
        <div className="welcome-chart-timeframes">
          {['1M', '5M', '15M', '1H'].map(tf => (
            <button key={tf} type="button" className={`welcome-chart-tf-btn ${timeframe === tf ? 'active' : ''}`} onClick={() => setTimeframe(tf)}>{tf}</button>
          ))}
          <button type="button" className="welcome-chart-tf-btn welcome-chart-tf-more">{t('ui.more')} <svg viewBox="0 0 20 20" fill="currentColor" style={{width: 12, height: 12, marginLeft: 2}}><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg></button>
        </div>
      </div>
      <div className="welcome-chart-toolbar-right">
        <button type="button" className="welcome-chart-tool-btn" data-tooltip="Grid"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></button>
        <button type="button" className="welcome-chart-tool-btn" data-tooltip="Indicators"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4m10-10h-4M6 12H2m15.07-5.07l-2.83 2.83M9.76 14.24l-2.83 2.83m0-10.14l2.83 2.83m4.48 4.48l2.83 2.83"/></svg></button>
        <button type="button" className="welcome-chart-tool-btn" data-tooltip="Draw"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg></button>
        <button type="button" className={`welcome-chart-tool-btn${fullscreen ? ' active' : ''}`} data-tooltip={fullscreen ? "Exit Fullscreen" : "Fullscreen"} onClick={() => setFullscreen(!fullscreen)}>
          {fullscreen ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>
          )}
        </button>
      </div>
    </div>
    </>)}
    <div className="welcome-chart-panel-chart welcome-chart-overlay-chart-area">
      {subTab === 'tradingview' ? (
        <iframe
          title={`${token.symbol} TradingView chart`}
          className="welcome-chart-overlay-iframe"
          src={`https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(getTradingViewSymbol(token.symbol))}&interval=60&hidesidetoolbar=1&symboledit=0&saveimage=0&toolbarbg=%2313161c&studies=%5B%5D&theme=dark&style=1&locale=en`}
          frameBorder="0"
          allowFullScreen
        />
      ) : isOnChainToken(token) ? (
        <div className="welcome-chart-overlay-tradingchart-wrap">
          <TradingViewAdvanced
            key={`tva-${token.address}-${token.networkId}-inline`}
            token={token}
            symbol={token.symbol}
            timeframe={normalizeTimeframe(timeframe)}
            referencePrice={token.price}
            height={inline ? 380 : 320}
          />
        </div>
      ) : (
        <div className="welcome-chart-overlay-tradingchart-wrap">
          <Suspense fallback={<div className="animate-shimmer" style={{ height: inline ? 380 : 320, borderRadius: 12 }} />}>
            <TradingChart
              ref={taChartRef}
              key={`tc-${token?.symbol}-inline`}
              token={token}
              embedMode
              embedHeight={inline ? 380 : 320}
              dayMode={dayMode}
            />
          </Suspense>
        </div>
      )}
    </div>
    {/* Fullscreen chart portal */}
    {fullscreen && subTab !== 'tradingview' && createPortal(
      <div className="welcome-chart-fullscreen-overlay">
        <div className="welcome-chart-fullscreen-header">
          <div className="welcome-chart-fullscreen-token">
            {token?.logo && <img src={token.logo} alt="" className="welcome-chart-fullscreen-logo" />}
            <span className="welcome-chart-fullscreen-symbol">{token?.symbol}</span>
            <span className="welcome-chart-fullscreen-name">{token?.name}</span>
          </div>
          <div className="welcome-chart-fullscreen-toolbar">
            <button type="button" className={`welcome-chart-type-btn ${subTab === 'candles' ? 'active' : ''}`} onClick={() => setSubTab('candles')}>
              <svg viewBox="0 0 20 20" fill="currentColor"><path d="M6 3a1 1 0 011 1v1h1a1 1 0 010 2H7v6h1a1 1 0 010 2H7v1a1 1 0 11-2 0v-1H4a1 1 0 110-2h1V7H4a1 1 0 010-2h1V4a1 1 0 011-1zm8 0a1 1 0 011 1v3h1a1 1 0 010 2h-1v4h1a1 1 0 010 2h-1v1a1 1 0 11-2 0v-1h-1a1 1 0 010-2h1V9h-1a1 1 0 010-2h1V4a1 1 0 011-1z" /></svg>
              <span>{tr('homePage.chartPanel.chartpanel.candles', "Candles")}</span>
            </button>
            <button type="button" className={`welcome-chart-type-btn ${subTab === 'line' ? 'active' : ''}`} onClick={() => setSubTab('line')}>
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11.707 4.707a1 1 0 00-1.414-1.414L10 9.586 8.707 8.293a1 1 0 00-1.414 0l-2 2a1 1 0 101.414 1.414L8 10.414l1.293 1.293a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
              <span>{tr('homePage.chartPanel.chartpanel.line', "Line")}</span>
            </button>
            <div className="welcome-chart-toolbar-divider"></div>
            <div className="welcome-chart-timeframes">
              {['1M', '5M', '15M', '1H', '4H', '1D'].map(tf => (
                <button key={tf} type="button" className={`welcome-chart-tf-btn ${timeframe === tf ? 'active' : ''}`} onClick={() => setTimeframe(tf)}>{tf}</button>
              ))}
            </div>
          </div>
          <button type="button" className="welcome-chart-fullscreen-close" onClick={() => setFullscreen(false)} title={tr('homePage.chartPanel.chartpanel.title', "Exit Fullscreen (ESC)")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="welcome-chart-fullscreen-body">
          {isOnChainToken(token) ? (
            <TradingViewAdvanced
              key={`tva-${token.address}-${token.networkId}-fullscreen`}
              token={token}
              symbol={token.symbol}
              timeframe={normalizeTimeframe(timeframe)}
              referencePrice={token.price}
              height={700}
            />
          ) : (
            <Suspense fallback={<div className="animate-shimmer" style={{ height: 700, borderRadius: 12 }} />}>
              <TradingChart
                key={`tc-${token?.symbol}-fullscreen`}
                token={token}
                embedMode
                embedHeight={700}
                dayMode={dayMode}
              />
            </Suspense>
          )}
        </div>
      </div>,
      document.body
    )}
    {/* Project info section */}
    <div className="welcome-chart-overlay-project-info">
        <div className="welcome-chart-overlay-project-header">
          {spectreIcons.library}
          <span>About {token.name}</span>
        </div>
        <p className="welcome-chart-overlay-project-desc">
          {description}
        </p>
        <div className="welcome-chart-overlay-project-socials">
          {socials.website && (
            <a href={socials.website} target="_blank" rel="noopener noreferrer" className="welcome-chart-overlay-social-btn" title="Website">
              {spectreIcons.globe}
              <span>Website</span>
            </a>
          )}
          {socials.twitter && (
            <a href={socials.twitter} target="_blank" rel="noopener noreferrer" className="welcome-chart-overlay-social-btn" title="X / Twitter">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              <span>X</span>
            </a>
          )}
          {socials.telegram && (
            <a href={socials.telegram} target="_blank" rel="noopener noreferrer" className="welcome-chart-overlay-social-btn" title="Telegram">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
              <span>Telegram</span>
            </a>
          )}
          {socials.discord && (
            <a href={socials.discord} target="_blank" rel="noopener noreferrer" className="welcome-chart-overlay-social-btn" title="Discord">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>
              <span>Discord</span>
            </a>
          )}
        </div>
        <div className="welcome-chart-overlay-project-links">
          {(onOpenResearchZone || onPageChange) && (
            <button type="button" className="welcome-chart-overlay-link" onClick={() => {
              onClose()
              // On-chain DEX → deep-link to trading app `#token/<address>`.
              // Native research-zone has no DEX context and would fall back
              // to a top-coin default.
              const url = isOnChainToken(token) ? tradingTokenUrl(token) : null
              if (url) {
                window.location.href = url
                return
              }
              if (onOpenResearchZone) onOpenResearchZone(token)
              else onPageChange('research-zone')
            }}>
              {spectreIcons.search}
              <span>{isOnChainToken(token) ? 'Trading Terminal' : t('ui.researchZone')}</span>
            </button>
          )}
          <button
            type="button"
            className="welcome-chart-overlay-link"
            onClick={() => {
              onClose()
              const url = isOnChainToken(token) ? tradingTokenUrl(token) : null
              if (url) window.location.href = url
            }}
          >
            {spectreIcons.trending}
            <span>{t('ui.viewChart')}</span>
          </button>
          {onPageChange && (
            <button
              type="button"
              className="welcome-chart-overlay-link"
              onClick={() => {
                onClose()
                onPageChange('news')
              }}
            >
              {spectreIcons.news}
              <span>{t('commandCenter.news')}</span>
            </button>
          )}
        </div>
    </div>
    {token.address && selectToken && (
      <button type="button" className="welcome-chart-overlay-view-details" onClick={() => {
        onClose()
        // DEX on-chain → trading app deep link (full chart + swap + trades).
        // Top-coins / stocks → legacy selectToken (in-app navigation).
        const url = isOnChainToken(token) ? tradingTokenUrl(token) : null
        if (url) {
          window.location.href = url
          return
        }
        selectToken(token)
      }}>
        {t('ui.viewFullDetails')}
      </button>
    )}
  </div>
  )
}

export default ChartPanel
