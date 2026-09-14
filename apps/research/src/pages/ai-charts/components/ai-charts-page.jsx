/**
 * AIChartsPage – Multi-Chart Dashboard (Apple Cinematic Redesign v2)
 * Professional chart grid with expanded coverage, market stats banner,
 * category filters with counts, favorites, fullscreen, layout toggle,
 * search, and staggered entrance animations.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import SectorCompareChart from '@/components/sector-compare-chart'
import { COINGECKO_LOGOS } from '@/constants/majorTokens'
import coinLogoUrl from '@/utils/coin-logo'
import { getBinancePairs, loadBinanceCatalog } from '@/services/binanceCatalog'
import InfoTip from '@/components/InfoTip'
import useSettingsStore from '@/store/useSettingsStore'
import CompareChart from './compare-chart'
import './ai-charts-page.css'
import './ai-charts-page.mobile.css'

/* ── Chart configurations ──
 * BINANCE:XXXUSDT for altcoins (CRYPTO: prefix fails in embeds for most alts)
 * CRYPTO: only for BTC/ETH/SOL/BNB/XRP (major synthetics that work)
 * CRYPTOCAP: for market cap / dominance (works in embeds)
 * Avoid TVC: symbols (restricted to TradingView site only)
 */
const CRYPTO_CHARTS_CONFIG = [
  // Major Crypto (CRYPTO: synthetic works for top coins)
  { label: 'BTC',       symbol: 'CRYPTO:BTCUSD',       badge: 'Major',       category: 'major' },
  { label: 'ETH',       symbol: 'CRYPTO:ETHUSD',       badge: 'Major',       category: 'major' },
  { label: 'SOL',       symbol: 'CRYPTO:SOLUSD',       badge: 'Major',       category: 'major' },
  { label: 'BNB',       symbol: 'CRYPTO:BNBUSD',       badge: 'Major',       category: 'major' },
  { label: 'XRP',       symbol: 'CRYPTO:XRPUSD',       badge: 'Major',       category: 'major' },
  // Layer 1
  { label: 'ADA',       symbol: 'BINANCE:ADAUSDT',     badge: 'L1',          category: 'l1' },
  { label: 'AVAX',      symbol: 'BINANCE:AVAXUSDT',    badge: 'L1',          category: 'l1' },
  { label: 'DOT',       symbol: 'BINANCE:DOTUSDT',     badge: 'L1',          category: 'l1' },
  { label: 'ATOM',      symbol: 'BINANCE:ATOMUSDT',    badge: 'L1',          category: 'l1' },
  { label: 'NEAR',      symbol: 'BINANCE:NEARUSDT',    badge: 'L1',          category: 'l1' },
  { label: 'SUI',       symbol: 'BINANCE:SUIUSDT',     badge: 'L1',          category: 'l1' },
  { label: 'APT',       symbol: 'BINANCE:APTUSDT',     badge: 'L1',          category: 'l1' },
  // Layer 2
  { label: 'ARB',       symbol: 'BINANCE:ARBUSDT',     badge: 'L2',          category: 'l2' },
  { label: 'OP',        symbol: 'BINANCE:OPUSDT',      badge: 'L2',          category: 'l2' },
  { label: 'POL',       symbol: 'BINANCE:POLUSDT',     badge: 'L2',          category: 'l2' },
  { label: 'STRK',      symbol: 'BINANCE:STRKUSDT',    badge: 'L2',          category: 'l2' },
  // DeFi
  { label: 'AAVE',      symbol: 'BINANCE:AAVEUSDT',    badge: 'DeFi',        category: 'defi' },
  { label: 'UNI',       symbol: 'BINANCE:UNIUSDT',     badge: 'DeFi',        category: 'defi' },
  { label: 'LINK',      symbol: 'BINANCE:LINKUSDT',    badge: 'DeFi',        category: 'defi' },
  { label: 'MKR',       symbol: 'CRYPTO:MKRUSD',        badge: 'DeFi',        category: 'defi' },
  { label: 'CRV',       symbol: 'BINANCE:CRVUSDT',     badge: 'DeFi',        category: 'defi' },
  { label: 'PENDLE',    symbol: 'BINANCE:PENDLEUSDT',  badge: 'DeFi',        category: 'defi' },
  // AI & Data
  { label: 'FET',       symbol: 'BINANCE:FETUSDT',     badge: 'AI',          category: 'ai' },
  { label: 'RENDER',    symbol: 'BINANCE:RENDERUSDT',  badge: 'AI',          category: 'ai' },
  { label: 'TAO',       symbol: 'BINANCE:TAOUSDT',     badge: 'AI',          category: 'ai' },
  { label: 'AR',        symbol: 'BINANCE:ARUSDT',      badge: 'AI',          category: 'ai' },
  // Meme
  { label: 'DOGE',      symbol: 'BINANCE:DOGEUSDT',    badge: 'Meme',        category: 'meme' },
  // Spot symbols (not the 1000x Binance-FUTURES denomination): BINANCE:1000SHIBUSDT
  // et al. are perp-futures tickers that TradingView's spot widget can't resolve
  // ("This symbol doesn't exist"). The plain spot pairs exist and TRADING on
  // Binance, matching DOGE/WIF above. (Gleb 2026-06-16)
  { label: 'SHIB',      symbol: 'BINANCE:SHIBUSDT',    badge: 'Meme',        category: 'meme' },
  { label: 'PEPE',      symbol: 'BINANCE:PEPEUSDT',    badge: 'Meme',        category: 'meme' },
  { label: 'WIF',       symbol: 'BINANCE:WIFUSDT',     badge: 'Meme',        category: 'meme' },
  { label: 'BONK',      symbol: 'BINANCE:BONKUSDT',    badge: 'Meme',        category: 'meme' },
  { label: 'FLOKI',     symbol: 'BINANCE:FLOKIUSDT',   badge: 'Meme',        category: 'meme' },
  // Gaming
  { label: 'AXS',       symbol: 'BINANCE:AXSUSDT',     badge: 'Gaming',      category: 'gaming' },
  { label: 'IMX',       symbol: 'BINANCE:IMXUSDT',     badge: 'Gaming',      category: 'gaming' },
  { label: 'GALA',      symbol: 'BINANCE:GALAUSDT',    badge: 'Gaming',      category: 'gaming' },
  // Ratios
  { label: 'ETH / BTC', symbol: 'BINANCE:ETHBTC',      badge: 'Ratio',       category: 'ratio' },
  { label: 'SOL / ETH', symbol: 'BINANCE:SOLETH',      badge: 'Ratio',       category: 'ratio' },
  { label: 'SOL / BTC', symbol: 'BINANCE:SOLBTC',      badge: 'Ratio',       category: 'ratio' },
  // Market Cap
  { label: 'TOTAL',     symbol: 'CRYPTOCAP:TOTAL',     badge: 'Market Cap',  category: 'marketcap' },
  { label: 'TOTAL 2',   symbol: 'CRYPTOCAP:TOTAL2',    badge: 'Market Cap',  category: 'marketcap' },
  { label: 'TOTAL 3',   symbol: 'CRYPTOCAP:TOTAL3',    badge: 'Market Cap',  category: 'marketcap' },
  { label: 'OTHERS',    symbol: 'CRYPTOCAP:OTHERS',    badge: 'Market Cap',  category: 'marketcap' },
  // Dominance
  { label: 'BTC.D',     symbol: 'CRYPTOCAP:BTC.D',     badge: 'Dominance',   category: 'dominance' },
  { label: 'ETH.D',     symbol: 'CRYPTOCAP:ETH.D',     badge: 'Dominance',   category: 'dominance' },
  { label: 'USDT.D',    symbol: 'CRYPTOCAP:USDT.D',    badge: 'Dominance',   category: 'dominance' },
  { label: 'OTHERS.D',  symbol: 'CRYPTOCAP:OTHERS.D',  badge: 'Dominance',   category: 'dominance' },
  // Macro
  { label: 'DXY',       symbol: 'INDEX:DXY',           badge: 'Macro',       category: 'macro' },
  { label: 'SPX',       symbol: 'FOREXCOM:SPXUSD',     badge: 'Macro',       category: 'macro' },
  { label: 'NQ',        symbol: 'FOREXCOM:NSXUSD',     badge: 'Macro',       category: 'macro' },
  // Commodity
  { label: 'GOLD',      symbol: 'OANDA:XAUUSD',        badge: 'Commodity',   category: 'commodity' },
  { label: 'SILVER',    symbol: 'OANDA:XAGUSD',        badge: 'Commodity',   category: 'commodity' },
  { label: 'OIL',       symbol: 'CAPITALCOM:OIL_CRUDE', badge: 'Commodity',  category: 'commodity' },
]

const STOCK_CHARTS_CONFIG = [
  // Indices & ETFs
  { label: 'SPY',    symbol: 'AMEX:SPY',      badge: 'Index',       category: 'index' },
  { label: 'QQQ',    symbol: 'NASDAQ:QQQ',    badge: 'Index',       category: 'index' },
  { label: 'IWM',    symbol: 'AMEX:IWM',      badge: 'Index',       category: 'index' },
  { label: 'DIA',    symbol: 'AMEX:DIA',      badge: 'Index',       category: 'index' },
  { label: 'SMH',    symbol: 'NASDAQ:SMH',    badge: 'Semi ETF',    category: 'index' },
  { label: 'ARKK',   symbol: 'AMEX:ARKK',     badge: 'Innovation',  category: 'index' },
  { label: 'XLF',    symbol: 'AMEX:XLF',      badge: 'Fin ETF',     category: 'index' },
  { label: 'XLE',    symbol: 'AMEX:XLE',      badge: 'Energy ETF',  category: 'index' },
  // Mag 7
  { label: 'AAPL',   symbol: 'NASDAQ:AAPL',   badge: 'Mag 7',       category: 'mag7' },
  { label: 'MSFT',   symbol: 'NASDAQ:MSFT',   badge: 'Mag 7',       category: 'mag7' },
  { label: 'GOOGL',  symbol: 'NASDAQ:GOOGL',  badge: 'Mag 7',       category: 'mag7' },
  { label: 'AMZN',   symbol: 'NASDAQ:AMZN',   badge: 'Mag 7',       category: 'mag7' },
  { label: 'META',   symbol: 'NASDAQ:META',   badge: 'Mag 7',       category: 'mag7' },
  { label: 'TSLA',   symbol: 'NASDAQ:TSLA',   badge: 'Mag 7',       category: 'mag7' },
  { label: 'NVDA',   symbol: 'NASDAQ:NVDA',   badge: 'Mag 7',       category: 'mag7' },
  // AI & Semiconductors
  { label: 'AMD',    symbol: 'NASDAQ:AMD',    badge: 'AI / Semi',   category: 'ai' },
  { label: 'AVGO',   symbol: 'NASDAQ:AVGO',   badge: 'AI / Semi',   category: 'ai' },
  { label: 'ARM',    symbol: 'NASDAQ:ARM',    badge: 'AI / Semi',   category: 'ai' },
  { label: 'MRVL',   symbol: 'NASDAQ:MRVL',   badge: 'AI / Semi',   category: 'ai' },
  { label: 'MU',     symbol: 'NASDAQ:MU',     badge: 'AI / Semi',   category: 'ai' },
  { label: 'TSM',    symbol: 'NYSE:TSM',      badge: 'AI / Semi',   category: 'ai' },
  { label: 'PLTR',   symbol: 'NYSE:PLTR',     badge: 'AI / Data',   category: 'ai' },
  { label: 'CRM',    symbol: 'NYSE:CRM',      badge: 'AI / SaaS',   category: 'ai' },
  // Finance
  { label: 'JPM',    symbol: 'NYSE:JPM',      badge: 'Finance',     category: 'finance' },
  { label: 'GS',     symbol: 'NYSE:GS',       badge: 'Finance',     category: 'finance' },
  { label: 'BAC',    symbol: 'NYSE:BAC',      badge: 'Finance',     category: 'finance' },
  { label: 'V',      symbol: 'NYSE:V',        badge: 'Finance',     category: 'finance' },
  { label: 'MA',     symbol: 'NYSE:MA',       badge: 'Finance',     category: 'finance' },
  // Crypto-Linked
  { label: 'COIN',   symbol: 'NASDAQ:COIN',   badge: 'Crypto',      category: 'cryptostk' },
  { label: 'MSTR',   symbol: 'NASDAQ:MSTR',   badge: 'Crypto',      category: 'cryptostk' },
  { label: 'MARA',   symbol: 'NASDAQ:MARA',   badge: 'Crypto',      category: 'cryptostk' },
  { label: 'RIOT',   symbol: 'NASDAQ:RIOT',   badge: 'Crypto',      category: 'cryptostk' },
  // Healthcare
  { label: 'UNH',    symbol: 'NYSE:UNH',      badge: 'Healthcare',  category: 'health' },
  { label: 'LLY',    symbol: 'NYSE:LLY',      badge: 'Healthcare',  category: 'health' },
  { label: 'JNJ',    symbol: 'NYSE:JNJ',      badge: 'Healthcare',  category: 'health' },
  // Energy
  { label: 'XOM',    symbol: 'NYSE:XOM',      badge: 'Energy',      category: 'energy' },
  { label: 'CVX',    symbol: 'NYSE:CVX',      badge: 'Energy',      category: 'energy' },
  // Consumer
  { label: 'NFLX',   symbol: 'NASDAQ:NFLX',   badge: 'Consumer',    category: 'consumer' },
  { label: 'DIS',    symbol: 'NYSE:DIS',      badge: 'Consumer',    category: 'consumer' },
  { label: 'COST',   symbol: 'NASDAQ:COST',   badge: 'Consumer',    category: 'consumer' },
  { label: 'WMT',    symbol: 'NYSE:WMT',      badge: 'Consumer',    category: 'consumer' },
  // Volatility & Macro
  { label: 'VIX',    symbol: 'CBOE:VIX',      badge: 'Volatility',  category: 'volatility' },
  { label: 'DXY',    symbol: 'INDEX:DXY',     badge: 'Macro',       category: 'macro' },
  { label: 'TLT',    symbol: 'NASDAQ:TLT',    badge: 'Bonds',       category: 'bonds' },
  { label: 'HYG',    symbol: 'AMEX:HYG',      badge: 'Bonds',       category: 'bonds' },
  { label: 'LQD',    symbol: 'AMEX:LQD',      badge: 'Bonds',       category: 'bonds' },
  // Commodity
  { label: 'GOLD',   symbol: 'OANDA:XAUUSD',  badge: 'Commodity',   category: 'commodity' },
  { label: 'SILVER', symbol: 'OANDA:XAGUSD',  badge: 'Commodity',   category: 'commodity' },
  { label: 'OIL',    symbol: 'CAPITALCOM:OIL_CRUDE', badge: 'Commodity', category: 'commodity' },
]

/* ── Badge / Category i18n key maps ── */
const BADGE_I18N = {
  'Major': 'major',
  'L1': 'l1',
  'L2': 'l2',
  'DeFi': 'defi',
  'AI': 'ai',
  'Meme': 'meme',
  'Gaming': 'gaming',
  'Ratio': 'ratio',
  'Market Cap': 'marketCap',
  'Dominance': 'dominance',
  'Macro': 'macro',
  'Commodity': 'commodity',
  'Index': 'index',
  'Mag 7': 'mag7',
  'Semi ETF': 'semiEtf',
  'Innovation': 'innovation',
  'Fin ETF': 'finEtf',
  'Energy ETF': 'energyEtf',
  'AI / Semi': 'aiSemi',
  'AI / Data': 'aiData',
  'AI / SaaS': 'aiSaas',
  'Finance': 'finance',
  'Crypto': 'crypto',
  'Healthcare': 'healthcare',
  'Energy': 'energy',
  'Consumer': 'consumer',
  'Volatility': 'volatility',
  'Bonds': 'bonds',
}

const CATEGORY_I18N = {
  'all': 'all',
  'major': 'major',
  'l1': 'l1',
  'l2': 'l2',
  'defi': 'defi',
  'ai': 'ai',
  'meme': 'meme',
  'gaming': 'gaming',
  'ratio': 'ratio',
  'marketcap': 'marketcap',
  'dominance': 'dominance',
  'macro': 'macro',
  'commodity': 'commodity',
  'index': 'index',
  'mag7': 'mag7',
  'finance': 'finance',
  'cryptostk': 'cryptostk',
  'health': 'health',
  'energy': 'energy',
  'consumer': 'consumer',
  'volatility': 'volatility',
  'bonds': 'bonds',
}

/* Stock category 'ai' has a different label (AI / Semi). Use this for stocks. */
const STOCK_CATEGORY_I18N = { ...CATEGORY_I18N, ai: 'aiCat' }

const TIMEFRAMES = [
  { label: '1H',  interval: '60' },
  { label: '4H',  interval: '240' },
  { label: '1D',  interval: 'D' },
  { label: '1W',  interval: 'W' },
  { label: '1M',  interval: 'M' },
]

const GRID_LAYOUTS = [
  { cols: 2, icon: 'grid-2' },
  { cols: 3, icon: 'grid-3' },
  { cols: 4, icon: 'grid-4' },
]

const CRYPTO_CATEGORIES = [
  { key: 'all',       label: 'All' },
  { key: 'major',     label: 'Major' },
  { key: 'l1',        label: 'Layer 1' },
  { key: 'l2',        label: 'Layer 2' },
  { key: 'defi',      label: 'DeFi' },
  { key: 'ai',        label: 'AI' },
  { key: 'meme',      label: 'Meme' },
  { key: 'gaming',    label: 'Gaming' },
  { key: 'ratio',     label: 'Ratio' },
  { key: 'marketcap', label: 'Market Cap' },
  { key: 'dominance', label: 'Dominance' },
  { key: 'macro',     label: 'Macro' },
  { key: 'commodity', label: 'Commodity' },
]

const STOCK_CATEGORIES = [
  { key: 'all',        label: 'All' },
  { key: 'index',      label: 'Indices' },
  { key: 'mag7',       label: 'Mag 7' },
  { key: 'ai',         label: 'AI / Semi' },
  { key: 'finance',    label: 'Finance' },
  { key: 'cryptostk',  label: 'Crypto' },
  { key: 'health',     label: 'Healthcare' },
  { key: 'energy',     label: 'Energy' },
  { key: 'consumer',   label: 'Consumer' },
  { key: 'volatility', label: 'Volatility' },
  { key: 'macro',      label: 'Macro' },
  { key: 'bonds',      label: 'Bonds' },
  { key: 'commodity',  label: 'Commodity' },
]

/* Favorites live in useSettingsStore (`aiChartsFavorites`) so they ride the
   server profile sync and follow the user across devices. The store seeds
   itself from the old `spectre-ai-charts-favorites` localStorage key once. */

/* Board layout (added tokens, card order, renderer style) lives in
   useSettingsStore (`aiChartsAdded` / `aiChartsOrder` / `aiChartsType`) so it
   server-syncs; the store seeds itself from the old raw localStorage keys. */

// Chart style for OUR renderer. TradingView mode has its own toolbar for this;
// the Spectre cards had no way to ask for candles at all (founder, 08-22).
const CHART_TYPES = [
  { id: 'area', label: 'Area', d: 'M3 16l5-5 4 3 5-7 4 4v5H3z' },
  { id: 'line', label: 'Line', d: 'M3 16l5-5 4 3 5-7 4 4' },
  { id: 'candle', label: 'Candles', d: 'M7 4v3M7 15v4M17 3v5M17 17v3M5 7h4v8H5zM15 8h4v9h-4z' },
]

/* ── TradingView URL builders ── */
// TradingView-mode embed. Defaults to AREA (style=3) per Gleb 2026-06-16 (was
// candles, style=1). Users can still switch style inside the TV toolbar.
const buildTvUrl = (symbol, interval, theme, toolbarBg) =>
  `https://s.tradingview.com/widgetembed/?frameElementId=tv_chart&symbol=${encodeURIComponent(symbol)}&interval=${interval}&hidesidetoolbar=1&symboledit=0&saveimage=0&toolbarbg=${toolbarBg}&studies=%5B%5D&theme=${theme}&style=3&locale=en`

const buildSpectreUrl = (symbol, interval, theme, toolbarBg) =>
  `https://s.tradingview.com/widgetembed/?frameElementId=tv_chart&symbol=${encodeURIComponent(symbol)}&interval=${interval}&hidesidetoolbar=1&hidetoptoolbar=1&symboledit=0&saveimage=0&toolbarbg=${toolbarBg}&studies=%5B%5D&hidevolume=1&theme=${theme}&style=3&locale=en&hide_legend=0&withdateranges=0&allow_symbol_change=0`

/* ── Skeleton shimmer ── */
const ChartSkeleton = () => (
  <div className="aic-skeleton">
    <div className="aic-skeleton-bar" />
    <div className="aic-skeleton-bar short" />
    <div className="aic-skeleton-bar medium" />
  </div>
)

/* ── IO sentinel: mount heavy below-fold sections only when scrolled near ── */
function useInView(rootMargin = '300px') {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver !== 'function') {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true)
        io.disconnect()
      }
    }, { rootMargin })
    io.observe(el)
    return () => io.disconnect()
  }, [rootMargin])
  return [ref, inView]
}

/* ── TradingView embed mount scheduler ──
 * Each card mounts a `widgetembed` iframe = a FULL TradingView charting app.
 * The IntersectionObserver below gates *visibility*, but on load ~9-12 cards
 * are in view at once and were all mounting their iframe simultaneously —
 * 9-12 TV apps stampeding s.tradingview.com + the browser main thread, so
 * every card spun 10s+ (Gleb 2026-06-16). This caps CONCURRENT embed loads:
 * a card acquires a slot before mounting; the slot frees on the iframe's
 * onLoad (or a safety timeout), letting the next queued card mount. Cards
 * stream in top-to-bottom in fast waves instead of all stalling each other.
 */
const TV_MAX_CONCURRENT = 4
let _tvActive = 0
const _tvQueue = []
function tvAcquire(cb) {
  if (_tvActive < TV_MAX_CONCURRENT) { _tvActive++; cb() }
  else _tvQueue.push(cb)
}
function tvRelease() {
  _tvActive = Math.max(0, _tvActive - 1)
  const next = _tvQueue.shift()
  if (next) { _tvActive++; next() }
}

/* ── Fast in-house mini chart (default "Spectre" mode for crypto) ──
 * The TradingView widgetembed loads a full charting app per card (megabytes);
 * 52 of them never load fast no matter how we schedule them (Gleb 2026-06-16:
 * "still 10s+"). For crypto symbols we instead draw a lightweight canvas area
 * chart from our OWN /api/bars (Binance klines, server-cached) - sub-second,
 * no third-party iframe. The heavy TV embed is kept only for the explicit
 * per-card "TradingView" toggle and for symbols our bars API can't serve
 * (stocks/macro/commodities, or the odd crypto with no Binance pair).
 */
const TF_TO_BARS = {
  '60':  { res: '60',  lookbackSec: 14 * 86400 },
  '240': { res: '240', lookbackSec: 90 * 86400 },
  'D':   { res: '1D',  lookbackSec: 365 * 86400 },
  'W':   { res: '1W',  lookbackSec: 5 * 365 * 86400 },
  'M':   { res: '1W',  lookbackSec: 8 * 365 * 86400 },
}
const _miniBarsCache = new Map() // `${ticker}:${res}` -> { ts, p:Promise<{t,c}[]|null> }
function fetchMiniBars(ticker, tvInterval) {
  const cfg = TF_TO_BARS[tvInterval] || TF_TO_BARS.D
  const key = `${ticker}:${cfg.res}`
  const hit = _miniBarsCache.get(key)
  if (hit && Date.now() - hit.ts < 60_000) return hit.p
  const now = Math.floor(Date.now() / 1000)
  const url = `/api/bars?symbol=${encodeURIComponent(ticker)}&resolution=${cfg.res}&from=${now - cfg.lookbackSec}&to=${now}&networkId=1`
  const p = fetch(url, { signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const bars = (j && j.bars) || []
      // keep timestamp + close so the hover crosshair can label price AND date
      // Keep the whole bar: the close alone draws a line, candles need O/H/L
      // too, and /api/bars has always returned them.
      const pts = bars
        .map((b) => ({
          t: +(b.t ?? b.time),
          o: +(b.o ?? b.open),
          h: +(b.h ?? b.high),
          l: +(b.l ?? b.low),
          c: +(b.c ?? b.close),
        }))
        .filter((p2) => Number.isFinite(p2.c) && p2.c > 0 && Number.isFinite(p2.t))
      return pts.length >= 2 ? pts : null
    })
    .catch(() => null)
  _miniBarsCache.set(key, { ts: Date.now(), p })
  return p
}

function fmtMiniPrice(v) {
  if (!Number.isFinite(v)) return ''
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (v >= 1) return '$' + v.toFixed(2)
  if (v >= 0.01) return '$' + v.toFixed(4)
  return '$' + v.toPrecision(3)
}

// Lazy singleton import of the lightweight-charts lib (kept off the entry
// bundle; loaded once when the first AI-charts card mounts).
let _lwModPromise = null
const loadLW = () => (_lwModPromise ||= import('lightweight-charts'))

const MiniAreaChart = React.memo(({ ticker, interval, chartType = 'area', onUnavailable }) => {
  const hostRef = useRef(null)
  const [pts, setPts] = useState(null)
  const [ready, setReady] = useState(false)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)

  useEffect(() => {
    let alive = true
    setPts(null)
    fetchMiniBars(ticker, interval).then((p) => {
      if (!alive) return
      if (p) setPts(p)
      else onUnavailable && onUnavailable()
    })
    return () => { alive = false }
  }, [ticker, interval, onUnavailable])

  // Create the lightweight-charts instance ONCE per mount (real TradingView-grade
  // interactivity from our own data: drag to pan, axis-drag/pinch to zoom,
  // crosshair tooltip — no iframe). Wheel-zoom is OFF so scrolling the page over
  // the grid still scrolls the page, not the chart.
  useEffect(() => {
    const host = hostRef.current
    if (!host || !pts || pts.length < 2) return undefined
    let cancelled = false
    let chart = null
    let ro = null
    loadLW().then((LW) => {
      if (cancelled || !hostRef.current) return
      const { createChart, LineSeries, AreaSeries, CandlestickSeries, ColorType, CrosshairMode } = LW
      chart = createChart(host, {
        width: host.clientWidth,
        height: host.clientHeight,
        autoSize: false,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: 'rgba(245, 245, 247, 0.45)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
          fontSize: 10,
          // This is Spectre AI mode - hide the TradingView attribution logo
          // (lightweight-charts is just our renderer here). (Gleb 2026-06-16)
          attributionLogo: false,
        },
        grid: {
          vertLines: { color: 'rgba(255,255,255,0.03)' },
          horzLines: { color: 'rgba(255,255,255,0.03)' },
        },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
        timeScale: { borderVisible: false, timeVisible: interval === '60' || interval === '240', secondsVisible: false },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: 'rgba(245,245,247,0.25)', width: 1, style: 2, labelBackgroundColor: '#1f2937' },
          horzLine: { color: 'rgba(245,245,247,0.25)', width: 1, style: 2, labelBackgroundColor: '#2979ff' },
        },
        // drag-to-pan + touch drag; NO mouse-wheel zoom (keeps page scroll usable)
        handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
      })
      const priceFormat = { type: 'custom', minMove: 0.00000001, formatter: (v) => fmtMiniPrice(v) }
      // A bar missing O/H/L can't be a candle - fall back rather than draw a
      // chart full of holes.
      const hasOHLC = chartType === 'candle'
        && pts.every((p) => Number.isFinite(p.o) && Number.isFinite(p.h) && Number.isFinite(p.l))
      const kind = hasOHLC ? 'candle' : (chartType === 'candle' ? 'area' : chartType)

      let series
      if (kind === 'candle') {
        series = chart.addSeries(CandlestickSeries, {
          upColor: '#22c55e',
          downColor: '#ef4444',
          borderUpColor: '#22c55e',
          borderDownColor: '#ef4444',
          wickUpColor: 'rgba(34,197,94,0.7)',
          wickDownColor: 'rgba(239,68,68,0.7)',
          priceFormat,
        })
      } else if (kind === 'line') {
        series = chart.addSeries(LineSeries, {
          color: '#2979ff',
          lineWidth: 2,
          priceLineVisible: true,
          lastValueVisible: true,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 3,
          priceFormat,
        })
      } else {
        series = chart.addSeries(AreaSeries, {
          lineColor: '#2979ff',
          topColor: 'rgba(41,121,255,0.28)',
          bottomColor: 'rgba(41,121,255,0)',
          lineWidth: 2,
          priceLineVisible: true,
          lastValueVisible: true,
          crosshairMarkerVisible: true,
          crosshairMarkerRadius: 3,
          priceFormat,
        })
      }
      chartRef.current = chart
      seriesRef.current = series
      series.setData(kind === 'candle'
        ? pts.map((p) => ({ time: p.t, open: p.o, high: p.h, low: p.l, close: p.c }))
        : pts.map((p) => ({ time: p.t, value: p.c })))
      chart.timeScale().fitContent()
      ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          const { width, height } = e.contentRect
          if (width > 0 && height > 0) chart.applyOptions({ width, height })
        }
      })
      ro.observe(host)
      if (!cancelled) setReady(true)
    }).catch(() => { if (!cancelled) onUnavailable && onUnavailable() })

    return () => {
      cancelled = true
      if (ro) ro.disconnect()
      if (chart) { try { chart.remove() } catch { /* noop */ } }
      chartRef.current = null
      seriesRef.current = null
      setReady(false)
    }
  }, [pts, interval, chartType, onUnavailable])

  return (
    <>
      {!ready && <div className="aic-mini-loading"><ChartSkeleton /></div>}
      <div ref={hostRef} className="aic-mini-canvas" />
    </>
  )
})

/* ── Card mark ──
 * A grid of 52 identical text labels reads as a spreadsheet, not a board. Every
 * card gets an identity, and the three kinds of row on this page each want a
 * different one:
 *   token      -> its coin mark
 *   pair       -> both marks, overlapped, in reading order (ETH / BTC)
 *   index/macro-> a drawn glyph. TOTAL, BTC.D and DXY have no coin logo and
 *                 never will; a monogram disc is a design, a blank is a gap.
 * Anything with no mark on file (and any logo that 404s) falls back to the
 * monogram, so a new symbol can never render as an empty hole.
 */
const MACRO_GLYPHS = {
  TOTAL:      { tint: '56,189,248', d: 'M3 12a9 9 0 1018 0 9 9 0 10-18 0M3 12h18M12 3a15 15 0 010 18a15 15 0 010-18' },
  'TOTAL 2':  { tint: '56,189,248', d: 'M3 12a9 9 0 1018 0 9 9 0 10-18 0M3 12h18M12 3a15 15 0 010 18a15 15 0 010-18' },
  'TOTAL 3':  { tint: '56,189,248', d: 'M3 12a9 9 0 1018 0 9 9 0 10-18 0M3 12h18M12 3a15 15 0 010 18a15 15 0 010-18' },
  OTHERS:     { tint: '167,139,250', d: 'M12 3v9l7.8 4.5M12 21a9 9 0 100-18 9 9 0 000 18z' },
  'OTHERS.D': { tint: '167,139,250', d: 'M12 3v9l7.8 4.5M12 21a9 9 0 100-18 9 9 0 000 18z' },
  DXY:        { tint: '52,211,153', d: 'M12 2v20M17 6.5A4.5 4.5 0 0012.5 3h-1a4 4 0 000 8h1a4 4 0 010 8h-1A4.5 4.5 0 017 15.5' },
  SPX:        { tint: '96,165,250', d: 'M3 17l5-6 4 3 4-6 5 4' },
  NQ:         { tint: '96,165,250', d: 'M3 17l5-6 4 3 4-6 5 4' },
  GOLD:       { tint: '251,191,36', d: 'M4 18h16M6 18V9l6-4 6 4v9M10 18v-5h4v5' },
  SILVER:     { tint: '203,213,225', d: 'M4 18h16M6 18V9l6-4 6 4v9M10 18v-5h4v5' },
  OIL:        { tint: '148,163,184', d: 'M12 3s6 6.5 6 10.5a6 6 0 11-12 0C6 9.5 12 3 12 3z' },
}

// Deterministic hue per symbol so a monogram is stable across renders and two
// neighbouring fallbacks never land on the same colour.
function monogramTint(label) {
  let h = 0
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) % 360
  return `hsl(${h}, 62%, 58%)`
}

const ChartMark = React.memo(({ label }) => {
  const [broken, setBroken] = useState(false)
  useEffect(() => { setBroken(false) }, [label])

  const macro = MACRO_GLYPHS[label]
  if (macro) {
    return (
      <span className="aic-mark aic-mark--glyph" style={{ '--mark-tint': macro.tint }} aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d={macro.d} />
        </svg>
      </span>
    )
  }

  // "ETH / BTC" — both marks, the numerator in front.
  if (label.includes('/')) {
    const [a, b] = label.split('/').map((p) => p.trim())
    return (
      <span className="aic-mark aic-mark--pair" aria-hidden>
        <ChartMark label={b} />
        <ChartMark label={a} />
      </span>
    )
  }

  // BTC.D / USDT.D carry their base coin's mark; the label already says .D
  const base = label.endsWith('.D') ? label.slice(0, -2) : label
  const src = COINGECKO_LOGOS[base]

  if (src && !broken) {
    return (
      <span className="aic-mark" aria-hidden>
        <img src={coinLogoUrl(src, 20)} alt="" loading="lazy" draggable="false" onError={() => setBroken(true)} />
      </span>
    )
  }

  return (
    <span className="aic-mark aic-mark--mono" style={{ '--mark-ink': monogramTint(base) }} aria-hidden>
      {base.slice(0, 2)}
    </span>
  )
})

/* ── Add a token to the board ──
 * Suggestions come from the live Binance USDT catalog rather than a typed
 * free-for-all: those are exactly the symbols our /api/bars can draw, so an
 * added card renders on the fast path instead of silently falling back to a
 * TradingView iframe for a pair that doesn't exist.
 */
const AddChartControl = React.memo(({ open, onOpenChange, onAdd, existing, t }) => {
  const [q, setQ] = useState('')
  const [pairs, setPairs] = useState(() => [...getBinancePairs()])
  const boxRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    loadBinanceCatalog().then((set) => setPairs([...set])).catch(() => {})
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) onOpenChange(false) }
    const onKey = (e) => { if (e.key === 'Escape') onOpenChange(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, onOpenChange])

  const have = useMemo(() => new Set(existing.map((c) => c.label)), [existing])
  const hits = useMemo(() => {
    const needle = q.trim().toUpperCase()
    const pool = needle ? pairs.filter((p) => p.startsWith(needle)) : pairs
    return pool.filter((p) => !have.has(p)).slice(0, 40)
  }, [q, pairs, have])

  return (
    <div className="aic-add" ref={boxRef}>
      <button
        className={`aic-add-btn ${open ? 'active' : ''}`}
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        title={t('aiChartsChrome.addTokenHint', 'Put another token on the board')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {t('aiChartsChrome.addToken', 'Add token')}
      </button>

      {open && (
        <div className="aic-add-pop">
          <input
            ref={inputRef}
            type="text"
            className="aic-add-input"
            value={q}
            placeholder={t('aiChartsChrome.addTokenSearch', 'Ticker — BTC, PEPE, TAO…')}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) onAdd(hits[0]) }}
          />
          <div className="aic-add-list">
            {hits.length === 0 ? (
              <div className="aic-add-empty">
                {q.trim()
                  ? t('aiChartsChrome.addTokenNone', 'No Binance pair for that ticker')
                  : t('aiChartsChrome.addTokenType', 'Type a ticker')}
              </div>
            ) : hits.map((p) => (
              <button key={p} className="aic-add-row" onClick={() => onAdd(p)}>
                <ChartMark label={p} />
                <span className="aic-add-sym">{p}</span>
                <span className="aic-add-quote">USDT</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
})

/* ── Chart Card ── */
const ChartCard = React.memo(({ chart, mode, globalTfIndex, chartType = 'area', theme, toolbarBg, isFav, onToggleFav, onExpand, index, t, unmountWhenHidden = false, onRemove, draggable = false, isDragging = false, isDropTarget = false, onDragStartCard, onDragOverCard, onDropCard, onDragEndCard }) => {
  const [isVisible, setIsVisible] = useState(false)
  const [localTfIndex, setLocalTfIndex] = useState(null)
  // The card only becomes draggable while the grip is held. Making the whole
  // card draggable would steal every drag-to-pan gesture from the chart inside.
  const [armed, setArmed] = useState(false)
  const cardRef = useRef(null)

  const tfIndex = localTfIndex !== null ? localTfIndex : globalTfIndex
  const interval = TIMEFRAMES[tfIndex].interval

  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (unmountWhenHidden) {
          setIsVisible(entry.isIntersecting)
        } else if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: unmountWhenHidden ? '100px' : '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [unmountWhenHidden])

  useEffect(() => { setLocalTfIndex(null) }, [globalTfIndex])

  const isSpectre = mode === 'spectre'
  const symbol = isSpectre ? (chart.spectreSymbol || chart.symbol) : chart.symbol

  // Default Spectre mode for CRYPTO symbols renders our own fast canvas chart
  // (Binance /api/bars) instead of a TradingView iframe. `forceTv` falls a card
  // back to the embed when our bars API can't serve it (e.g. POL, or any
  // non-Binance crypto). Reset the fallback when the token or mode changes.
  const [forceTv, setForceTv] = useState(false)
  useEffect(() => { setForceTv(false) }, [chart.symbol, mode])
  // Stable so the memo'd MiniAreaChart doesn't tear down its chart + refetch
  // /api/bars every ChartCard re-render (a fresh inline arrow defeated the memo).
  const handleUnavailable = useCallback(() => setForceTv(true), [])
  const isCryptoSymbol = /^(BINANCE|CRYPTO):/.test(chart.symbol || '')
  const useFastChart = isSpectre && isCryptoSymbol && !forceTv
  const needsEmbed = !useFastChart // TradingView mode, non-crypto, or fast-chart fallback

  // Throttle the iframe-mount burst (see scheduler above) — ONLY the embed path.
  // A visible card acquires a slot before its embed mounts; the slot frees on
  // the iframe's onLoad (or a safety timeout), so the next queued card starts
  // as soon as this one's heavy load is done. The fast canvas path needs no
  // slot. Re-throttles on symbol/interval change (global timeframe switch).
  const [slotGranted, setSlotGranted] = useState(false)
  const heldRef = useRef(false)
  const cancelRef = useRef(false)
  const releaseIfHeld = useCallback(() => {
    if (heldRef.current) { heldRef.current = false; tvRelease() }
  }, [])

  useEffect(() => {
    if (!isVisible || !needsEmbed) return undefined
    cancelRef.current = false
    setSlotGranted(false)
    tvAcquire(() => {
      if (cancelRef.current) { tvRelease(); return }
      heldRef.current = true
      setSlotGranted(true)
    })
    return () => {
      cancelRef.current = true
      releaseIfHeld()
    }
  }, [isVisible, needsEmbed, interval, symbol, releaseIfHeld])

  // Free the slot once the embed has loaded (keep it mounted); safety timeout
  // guards a missed onLoad so the queue never stalls.
  useEffect(() => {
    if (!slotGranted) return undefined
    const safety = setTimeout(releaseIfHeld, 4000)
    return () => clearTimeout(safety)
  }, [slotGranted, releaseIfHeld])

  const src = (isVisible && needsEmbed && slotGranted)
    ? (isSpectre ? buildSpectreUrl(symbol, interval, theme, toolbarBg)
                 : buildTvUrl(symbol, interval, theme, toolbarBg))
    : null

  return (
    <div
      className={`aic-card ${isSpectre ? 'spectre-mode' : ''}${isDragging ? ' is-dragging' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
      ref={cardRef}
      style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
      draggable={armed}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        try { e.dataTransfer.setData('text/plain', chart.symbol) } catch { /* Safari */ }
        onDragStartCard?.(chart.symbol)
      }}
      onDragOver={draggable ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOverCard?.(chart.symbol) } : undefined}
      onDrop={draggable ? (e) => { e.preventDefault(); setArmed(false); onDropCard?.(chart.symbol) } : undefined}
      onDragEnd={() => { setArmed(false); onDragEndCard?.() }}
    >
      {/* Card header */}
      <div className="aic-card-header">
        <div className="aic-card-header-left">
          {draggable && (
            <span
              className="aic-drag-grip"
              title={t('aiChartsChrome.dragToReorder', 'Drag to reorder')}
              onMouseDown={() => setArmed(true)}
              onMouseUp={() => setArmed(false)}
              aria-hidden
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
                <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
                <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
              </svg>
            </span>
          )}
          <button
            className={`aic-fav-btn ${isFav ? 'active' : ''}`}
            onClick={() => onToggleFav(chart.symbol)}
            aria-label={isFav ? t('aiChartsChrome.removeFromFavorites', 'Remove from favorites') : t('aiChartsChrome.addToFavorites', 'Add to favorites')}
          >
            <svg viewBox="0 0 24 24" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
          </button>
          <ChartMark label={chart.label} />
          <span className="aic-card-label">{chart.label}</span>
        </div>

        <div className="aic-card-tf">
          {TIMEFRAMES.map((tf, i) => (
            <button
              key={tf.label}
              className={`aic-card-tf-btn ${tfIndex === i ? 'active' : ''}`}
              onClick={() => setLocalTfIndex(i)}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div className="aic-card-header-right">
          <span className="aic-card-badge">{t(`aiChartsChrome.badges.${BADGE_I18N[chart.badge] || ''}`, chart.badge)}</span>
          {chart.custom && (
            <button
              className="aic-card-remove"
              onClick={() => onRemove?.(chart.symbol)}
              aria-label={t('aiChartsChrome.removeChart', { label: chart.label, defaultValue: `Remove ${chart.label}` })}
              title={t('aiChartsChrome.removeChart', { label: chart.label, defaultValue: `Remove ${chart.label}` })}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
          <button className="aic-expand-btn" onClick={() => onExpand(chart)} aria-label={t('aiChartsChrome.expandChart', 'Expand chart')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Chart body */}
      <div className={`aic-card-body ${isSpectre ? 'spectre-body' : ''}`}>
        {!isVisible ? (
          <ChartSkeleton />
        ) : useFastChart ? (
          <MiniAreaChart ticker={chart.label} interval={interval} chartType={chartType} onUnavailable={handleUnavailable} />
        ) : src ? (
          <iframe title={`${chart.label} chart`} src={src} allow="autoplay; fullscreen" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups" onLoad={releaseIfHeld} />
        ) : (
          <ChartSkeleton />
        )}
      </div>
    </div>
  )
})

/* ── Fullscreen Modal (rendered via portal to cover entire viewport) ── */
const FullscreenModal = ({ chart, mode: globalMode, tfIndex, theme, toolbarBg, onClose, t }) => {
  const [localTfIndex, setLocalTfIndex] = useState(tfIndex)
  const [localMode, setLocalMode] = useState(globalMode)
  const interval = TIMEFRAMES[localTfIndex].interval
  const isSpectre = localMode === 'spectre'
  const symbol = isSpectre ? (chart.spectreSymbol || chart.symbol) : chart.symbol
  const src = isSpectre
    ? buildSpectreUrl(symbol, interval, theme, toolbarBg)
    : buildTvUrl(symbol, interval, theme, toolbarBg)

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return createPortal(
    <div className="aic-fullscreen-overlay" onClick={onClose}>
      <div className="aic-fullscreen-modal" onClick={(e) => e.stopPropagation()}>
        <div className="aic-fullscreen-header">
          <div className="aic-fullscreen-header-left">
            <span className="aic-fullscreen-label">{chart.label}</span>
            <span className="aic-fullscreen-badge">{t(`aiChartsChrome.badges.${BADGE_I18N[chart.badge] || ''}`, chart.badge)}</span>
          </div>
          <div className="aic-fullscreen-controls">
            {/* Mode toggle */}
            <div className="aic-fullscreen-mode">
              <button
                className={`aic-fs-mode-btn ${localMode === 'spectre' ? 'active' : ''}`}
                onClick={() => setLocalMode('spectre')}
              >
                {t('aiChartsChrome.spectre', 'Spectre')}
              </button>
              <button
                className={`aic-fs-mode-btn ${localMode === 'tradingview' ? 'active' : ''}`}
                onClick={() => setLocalMode('tradingview')}
              >
                {t('aiChartsChrome.tradingView', 'TradingView')}
              </button>
            </div>
            {/* Timeframes */}
            <div className="aic-fullscreen-tf">
              {TIMEFRAMES.map((tf, i) => (
                <button
                  key={tf.label}
                  className={`aic-card-tf-btn ${localTfIndex === i ? 'active' : ''}`}
                  onClick={() => setLocalTfIndex(i)}
                >
                  {tf.label}
                </button>
              ))}
            </div>
            {/* ESC hint + close */}
            <span className="aic-fs-esc-hint">{t('common.esc', 'ESC')}</span>
            <button className="aic-fullscreen-close" onClick={onClose} aria-label={t('aiChartsChrome.closeFullscreen', 'Close fullscreen')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className={`aic-fullscreen-body ${isSpectre ? 'spectre-body' : ''}`}>
          <iframe title={`${chart.label} fullscreen`} src={src} allow="autoplay; fullscreen" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups" />
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ── Grid Layout Icons ── */
const GridIcon = ({ cols, active }) => (
  <svg viewBox="0 0 20 20" className={`aic-grid-icon ${active ? 'active' : ''}`}>
    {cols === 2 && (
      <>
        <rect x="1" y="1" width="8" height="8" rx="1.5" fill="currentColor" opacity={active ? 1 : 0.3} />
        <rect x="11" y="1" width="8" height="8" rx="1.5" fill="currentColor" opacity={active ? 1 : 0.3} />
        <rect x="1" y="11" width="8" height="8" rx="1.5" fill="currentColor" opacity={active ? 1 : 0.3} />
        <rect x="11" y="11" width="8" height="8" rx="1.5" fill="currentColor" opacity={active ? 1 : 0.3} />
      </>
    )}
    {cols === 3 && (
      <>
        <rect x="1" y="1" width="5" height="8" rx="1" fill="currentColor" opacity={active ? 1 : 0.3} />
        <rect x="7.5" y="1" width="5" height="8" rx="1" fill="currentColor" opacity={active ? 1 : 0.3} />
        <rect x="14" y="1" width="5" height="8" rx="1" fill="currentColor" opacity={active ? 1 : 0.3} />
        <rect x="1" y="11" width="5" height="8" rx="1" fill="currentColor" opacity={active ? 1 : 0.3} />
        <rect x="7.5" y="11" width="5" height="8" rx="1" fill="currentColor" opacity={active ? 1 : 0.3} />
        <rect x="14" y="11" width="5" height="8" rx="1" fill="currentColor" opacity={active ? 1 : 0.3} />
      </>
    )}
    {cols === 4 && (
      <>
        {[0, 1, 2, 3].map(c => (
          <React.Fragment key={c}>
            <rect x={1 + c * 4.75} y="1" width="3.5" height="8" rx="0.75" fill="currentColor" opacity={active ? 1 : 0.3} />
            <rect x={1 + c * 4.75} y="11" width="3.5" height="8" rx="0.75" fill="currentColor" opacity={active ? 1 : 0.3} />
          </React.Fragment>
        ))}
      </>
    )}
  </svg>
)

/* ── Main Page ── */
const AIChartsPage = ({ dayMode, marketMode = 'crypto', isMobile }) => {
  const { t } = useTranslation()
  const isStocks = marketMode === 'stocks'
  const BASE_CONFIG = isStocks ? STOCK_CHARTS_CONFIG : CRYPTO_CHARTS_CONFIG
  const BASE_CATEGORIES = isStocks ? STOCK_CATEGORIES : CRYPTO_CATEGORIES

  const [mode, setMode] = useState('spectre')
  const [tfIndex, setTfIndex] = useState(2)
  const [gridCols, setGridCols] = useState(3)
  const [activeCategory, setActiveCategory] = useState('all')
  const favorites = useSettingsStore((s) => s.aiChartsFavorites)
  const [showFavsOnly, setShowFavsOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedChart, setExpandedChart] = useState(null)
  const chartType = useSettingsStore((s) => s.aiChartsType)
  const setChartType = useSettingsStore((s) => s.setAiChartsType)

  /* Tokens the user added, and the order they dragged the board into. Both are
     per-market so the crypto board and the stocks board keep their own. Live
     in useSettingsStore so they server-sync across devices. */
  const layoutKey = isStocks ? 'stocks' : 'crypto'
  const added = useSettingsStore((s) => s.aiChartsAdded)
  const order = useSettingsStore((s) => s.aiChartsOrder)
  const [dragSym, setDragSym] = useState(null)
  const [overSym, setOverSym] = useState(null)
  const [addOpen, setAddOpen] = useState(false)

  const addedHere = useMemo(() => (Array.isArray(added[layoutKey]) ? added[layoutKey] : []), [added, layoutKey])
  const orderHere = useMemo(() => (Array.isArray(order[layoutKey]) ? order[layoutKey] : []), [order, layoutKey])

  const CHARTS_CONFIG = useMemo(() => {
    const base = BASE_CONFIG
    const extra = addedHere.filter((a) => !base.some((c) => c.symbol === a.symbol))
    const all = [...base, ...extra]
    if (!orderHere.length) return all
    // A saved order lists symbols; anything it doesn't know about (a config the
    // app shipped since, a token added on another device) keeps its natural
    // place at the end rather than disappearing.
    const rank = new Map(orderHere.map((sym, i) => [sym, i]))
    return all
      .map((c, i) => ({ c, i }))
      .sort((a, b) => {
        const ra = rank.has(a.c.symbol) ? rank.get(a.c.symbol) : Number.MAX_SAFE_INTEGER
        const rb = rank.has(b.c.symbol) ? rank.get(b.c.symbol) : Number.MAX_SAFE_INTEGER
        return ra === rb ? a.i - b.i : ra - rb
      })
      .map((x) => x.c)
  }, [BASE_CONFIG, addedHere, orderHere])

  const CATEGORIES = useMemo(() => (
    addedHere.length ? [...BASE_CATEGORIES, { key: 'custom', label: 'Added' }] : BASE_CATEGORIES
  ), [BASE_CATEGORIES, addedHere.length])

  const persistAdded = useCallback((next) => {
    const { aiChartsAdded, setAiChartsAdded } = useSettingsStore.getState()
    setAiChartsAdded({ ...aiChartsAdded, [layoutKey]: next })
  }, [layoutKey])

  const addChart = useCallback((sym) => {
    const label = String(sym).toUpperCase()
    const { aiChartsAdded, setAiChartsAdded } = useSettingsStore.getState()
    const list = Array.isArray(aiChartsAdded[layoutKey]) ? aiChartsAdded[layoutKey] : []
    if (!list.some((c) => c.label === label)) {
      const entry = {
        label,
        symbol: `BINANCE:${label}USDT`,
        badge: 'Added',
        category: 'custom',
        custom: true,
      }
      setAiChartsAdded({ ...aiChartsAdded, [layoutKey]: [...list, entry] })
    }
    setAddOpen(false)
  }, [layoutKey])

  const removeChart = useCallback((symbol) => {
    persistAdded(addedHere.filter((c) => c.symbol !== symbol))
  }, [persistAdded, addedHere])

  /* Drop: move the dragged card to the target's slot in the MASTER order, not
     the filtered view, so a reorder made inside a category survives leaving it. */
  const commitDrop = useCallback((targetSym) => {
    const from = dragSym
    setDragSym(null); setOverSym(null)
    if (!from || !targetSym || from === targetSym) return
    const master = CHARTS_CONFIG.map((c) => c.symbol)
    const fromIdx = master.indexOf(from)
    const toIdx = master.indexOf(targetSym)
    if (fromIdx < 0 || toIdx < 0) return
    master.splice(toIdx, 0, master.splice(fromIdx, 1)[0])
    const { aiChartsOrder, setAiChartsOrder } = useSettingsStore.getState()
    setAiChartsOrder({ ...aiChartsOrder, [layoutKey]: master })
  }, [dragSym, CHARTS_CONFIG, layoutKey])

  const resetLayout = useCallback(() => {
    const { aiChartsOrder, setAiChartsOrder } = useSettingsStore.getState()
    setAiChartsOrder({ ...aiChartsOrder, [layoutKey]: [] })
  }, [layoutKey])

  const theme = dayMode ? 'light' : 'dark'
  const toolbarBg = dayMode ? '%23f8fafc' : '%2309090b'

  // Defer the two compare-chart panels (each fires its own upstream fetch
  // on mount) until the user scrolls them into view. Saves a sector-snapshot
  // fetch + CG /categories fetch on first paint.
  const [sectorPanelRef, sectorPanelInView] = useInView('400px')
  const [comparePanelRef, comparePanelInView] = useInView('400px')

  const toggleFav = useCallback((symbol) => {
    const { aiChartsFavorites, setAiChartsFavorites } = useSettingsStore.getState()
    setAiChartsFavorites(
      aiChartsFavorites.includes(symbol)
        ? aiChartsFavorites.filter((s) => s !== symbol)
        : [...aiChartsFavorites, symbol]
    )
  }, [])

  /* Category counts for pills */
  const categoryCounts = useMemo(() => {
    const counts = {}
    CHARTS_CONFIG.forEach((c) => {
      counts[c.category] = (counts[c.category] || 0) + 1
    })
    counts.all = CHARTS_CONFIG.length
    return counts
  }, [CHARTS_CONFIG])

  const filteredCharts = useMemo(() => {
    let list = CHARTS_CONFIG
    if (activeCategory !== 'all') list = list.filter((c) => c.category === activeCategory)
    if (showFavsOnly) list = list.filter((c) => favorites.includes(c.symbol))
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((c) => {
        if (c.label.toLowerCase().includes(q)) return true
        if (c.badge.toLowerCase().includes(q)) return true
        return false
      })
    }
    return list
  }, [CHARTS_CONFIG, activeCategory, showFavsOnly, favorites, search])

  // ═══════════════════════════════════════════════════════════════════════════════
  //  MOBILE RENDER
  // ═══════════════════════════════════════════════════════════════════════════════
  if (isMobile) {
    return (
      <div className={`aic-page mac-page${dayMode ? ' day-mode' : ''}`}>
        <div className="mac-content">
          {/* Search */}
          <div className="mac-section">
            <div className="mac-search">
              <svg className="mac-search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                type="text"
                className="mac-search-input"
                placeholder={isStocks ? t('aiChartsChrome.searchStocks', 'Search stocks...') : t('aiChartsChrome.searchCrypto', 'Search crypto...')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button className="mac-search-clear" onClick={() => setSearch('')}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Controls row - mode + timeframe */}
          <div className="mac-section">
            <div className="mac-controls">
              <div className="mac-mode-pills">
                <button className={`mac-pill${mode === 'spectre' ? ' active' : ''}`} onClick={() => setMode('spectre')}>
                  {t('aiChartsChrome.spectre', 'Spectre')}
                </button>
                <button className={`mac-pill${mode === 'tradingview' ? ' active' : ''}`} onClick={() => setMode('tradingview')}>
                  {t('aiChartsChrome.tradingView', 'TradingView')}
                </button>
              </div>
              <div className="mac-tf-pills">
                {TIMEFRAMES.map((tf, i) => (
                  <button
                    key={tf.label}
                    className={`mac-pill${tfIndex === i ? ' active' : ''}`}
                    onClick={() => setTfIndex(i)}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
              {mode === 'spectre' && (
                <div className="mac-type-pills">
                  {CHART_TYPES.map((ct) => (
                    <button
                      key={ct.id}
                      className={`mac-pill mac-pill--icon${chartType === ct.id ? ' active' : ''}`}
                      onClick={() => setChartType(ct.id)}
                      aria-label={t(`aiChartsChrome.chartType.${ct.id}`, ct.label)}
                      aria-pressed={chartType === ct.id}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d={ct.d} />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Category filter strip */}
          <div className="mac-section-flush">
            <div className="mac-categories">
              <button
                className={`mac-cat-pill${showFavsOnly ? ' active' : ''}`}
                onClick={() => setShowFavsOnly(!showFavsOnly)}
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill={showFavsOnly ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                  <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                </svg>
                {favorites.length > 0 ? favorites.length : ''}
              </button>
              {CATEGORIES.map((cat) => {
                const catKey = isStocks ? (STOCK_CATEGORY_I18N[cat.key] || cat.key) : (CATEGORY_I18N[cat.key] || cat.key)
                return (
                  <button
                    key={cat.key}
                    className={`mac-cat-pill${activeCategory === cat.key ? ' active' : ''}`}
                    onClick={() => setActiveCategory(cat.key)}
                  >
                    {t(`aiChartsChrome.categories.${catKey}`, cat.label)}
                    <span className="mac-cat-count">{categoryCounts[cat.key] || 0}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Chart count */}
          <div className="mac-section">
            <span className="mac-section-label">
              {isStocks ? t('aiChartsChrome.stockCharts', 'Stock Charts') : t('aiChartsChrome.cryptoCharts', 'Crypto Charts')} ({filteredCharts.length})
            </span>
          </div>

          {/* Chart grid - single column on mobile */}
          {filteredCharts.length > 0 ? (
            <div className="mac-section">
              <div className="mac-chart-list">
                {filteredCharts.map((chart, i) => (
                  <ChartCard
                    key={chart.id || chart.symbol}
                    chart={chart}
                    mode={mode}
                    globalTfIndex={tfIndex}
                    chartType={chartType}
                    theme={theme}
                    toolbarBg={toolbarBg}
                    isFav={favorites.includes(chart.symbol)}
                    onToggleFav={toggleFav}
                    onExpand={setExpandedChart}
                    index={i}
                    t={t}
                    unmountWhenHidden
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="mac-section">
              <div className="mac-empty">
                <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                <span>{t('aiChartsChrome.noChartsMatch', 'No charts match your filters')}</span>
              </div>
            </div>
          )}

          {/* Bottom nav spacer */}
          <div className="mac-bottom-spacer" />
        </div>

        {/* Fullscreen modal */}
        {expandedChart && (
          <FullscreenModal
            chart={expandedChart}
            mode={mode}
            tfIndex={tfIndex}
            theme={theme}
            toolbarBg={toolbarBg}
            onClose={() => setExpandedChart(null)}
            t={t}
          />
        )}
      </div>
    )
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  //  DESKTOP RENDER
  // ═══════════════════════════════════════════════════════════════════════════════
  return (
    <div className="aic-page">
      {/* ── Hero Header ── */}
      <div className="aic-hero">
        <div className="aic-hero-top">
          <div className="aic-hero-title-group">
            <h1 className="aic-title">{isStocks ? t('aiChartsChrome.stockChartsLab', 'Stock Charts Lab') : t('aiChartsChrome.aiChartsLab', 'AI Charts Lab')}<InfoTip text={t('aiChartsChrome.infoTitle', 'Multi-chart dashboard powered by TradingView. Monitor dozens of assets simultaneously across crypto, stocks, macro, and commodities. Each chart supports individual timeframe overrides.')} position="bottom" /></h1>
            <span className="aic-subtitle">
              {filteredCharts.length} {filteredCharts.length === 1 ? t('aiChartsChrome.chart', 'chart') : t('aiChartsChrome.charts', 'charts')}
              {activeCategory !== 'all' && (() => {
                const activeCat = CATEGORIES.find(c => c.key === activeCategory)
                const catKey = isStocks ? (STOCK_CATEGORY_I18N[activeCategory] || activeCategory) : (CATEGORY_I18N[activeCategory] || activeCategory)
                const label = t(`aiChartsChrome.categories.${catKey}`, activeCat?.label)
                return ' ' + t('aiChartsChrome.inCategory', { category: label, defaultValue: `in ${activeCat?.label}` })
              })()}
            </span>
          </div>

        </div>

      </div>

      {/* ── Sector Performance (crypto only, IO-gated) ── */}
      {!isStocks && (
        <div ref={sectorPanelRef}>
          {sectorPanelInView ? <SectorCompareChart dayMode={dayMode} /> : <div style={{ minHeight: 540 }} />}
        </div>
      )}

      {/* ── Compare Chain / Sector / Token (crypto only, IO-gated) ── */}
      {!isStocks && (
        <div ref={comparePanelRef}>
          {comparePanelInView ? <CompareChart dayMode={dayMode} /> : <div style={{ minHeight: 540 }} />}
        </div>
      )}

      {/* ── Section Divider ── */}
      <div className="aic-section-divider">
        <div className="aic-divider-line" />
        <span className="aic-divider-label">
          {isStocks ? t('aiChartsChrome.stockCharts', 'Stock Charts') : t('aiChartsChrome.cryptoCharts', 'Crypto Charts')}<InfoTip text={t('aiChartsChrome.infoDivider', 'Live TradingView charts loaded on-demand as you scroll. Click the expand icon on any card for fullscreen view with additional controls.')} position="bottom" />
          <span className="aic-divider-count">{filteredCharts.length}</span>
        </span>
        <div className="aic-divider-line" />
      </div>

      {/* ── Grid toolbar ──
          These controls drive the chart GRID below, not the sector/compare
          boards above them, so they sit with what they operate on (founder,
          08-22: "should be below next to ai charts"). */}
      <div className="aic-toolbar">
      <div className="aic-hero-actions">
        {/* Search */}
        <div className="aic-search">
          <svg className="aic-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            className="aic-search-input"
            placeholder={t('aiChartsChrome.searchCharts', 'Search charts...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <InfoTip text={t('aiChartsChrome.infoSearch', "Filter charts by name or category badge. Type a ticker symbol like 'BTC' or a category like 'DeFi' to quickly find charts.")} position="bottom" />
        </div>

        {/* Mode toggle */}
        <div className="aic-mode-toggle">
          <button className={`aic-mode-btn ${mode === 'spectre' ? 'active' : ''}`} onClick={() => setMode('spectre')}>
            {t('aiChartsChrome.spectreAi', 'Spectre AI')}
          </button>
          <button className={`aic-mode-btn ${mode === 'tradingview' ? 'active' : ''}`} onClick={() => setMode('tradingview')}>
            {t('aiChartsChrome.tradingView', 'TradingView')}
          </button>
          <InfoTip text={t('aiChartsChrome.infoMode', 'Switch chart style. Spectre AI shows clean area charts optimized for quick scanning. TradingView shows full candlestick charts with technical detail.')} position="bottom" />
        </div>

        {/* Chart style - only meaningful for OUR renderer; the TradingView
            embed carries its own style menu. */}
        {mode === 'spectre' && (
          <div className="aic-type-toggle">
            {CHART_TYPES.map((ct) => (
              <button
                key={ct.id}
                className={`aic-type-btn ${chartType === ct.id ? 'active' : ''}`}
                onClick={() => setChartType(ct.id)}
                title={t(`aiChartsChrome.chartType.${ct.id}`, ct.label)}
                aria-label={t(`aiChartsChrome.chartType.${ct.id}`, ct.label)}
                aria-pressed={chartType === ct.id}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d={ct.d} />
                </svg>
              </button>
            ))}
            <InfoTip text={t('aiChartsChrome.infoChartType', 'Draw the Spectre charts as an area, a plain line, or full candles. Candles use the same OHLC bars the rest of the app runs on.')} position="bottom" />
          </div>
        )}

        {/* Timeframe selector */}
        <div className="aic-tf-group">
          {TIMEFRAMES.map((tf, i) => (
            <button
              key={tf.label}
              className={`aic-tf-btn ${tfIndex === i ? 'active' : ''}`}
              onClick={() => setTfIndex(i)}
            >
              {tf.label}
            </button>
          ))}
          <InfoTip text={t('aiChartsChrome.infoTimeframe', 'Set the default timeframe for all charts at once. Individual charts can still override this with their own timeframe buttons.')} position="bottom" />
        </div>

        {/* Grid layout toggle */}
        <div className="aic-grid-toggle">
          {GRID_LAYOUTS.map((gl) => (
            <button
              key={gl.cols}
              className={`aic-grid-btn ${gridCols === gl.cols ? 'active' : ''}`}
              onClick={() => setGridCols(gl.cols)}
              title={t('aiChartsChrome.columns', { count: gl.cols, defaultValue: `${gl.cols} columns` })}
            >
              <GridIcon cols={gl.cols} active={gridCols === gl.cols} />
            </button>
          ))}
          <InfoTip text={t('aiChartsChrome.infoGrid', 'Change the number of chart columns. Use 2 columns for larger charts or 4 columns to see more at once.')} position="left" />
        </div>

        {/* Add a token to the board */}
        {!isStocks && (
          <AddChartControl
            open={addOpen}
            onOpenChange={setAddOpen}
            onAdd={addChart}
            existing={CHARTS_CONFIG}
            t={t}
          />
        )}

        {orderHere.length > 0 && (
          <button className="aic-reset-btn" onClick={resetLayout} title={t('aiChartsChrome.resetLayoutHint', 'Put the cards back in their original order')}>
            {t('aiChartsChrome.resetLayout', 'Reset order')}
          </button>
        )}
      </div>
      {/* Category filter + favorites toggle */}
      <div className="aic-filters">
        <div className="aic-categories"><InfoTip text={t('aiChartsChrome.infoCategories', 'Filter charts by sector. Each pill shows the number of charts in that category. Click to focus on a specific market segment.')} position="bottom" />
          {CATEGORIES.map((cat) => {
            const catKey = isStocks ? (STOCK_CATEGORY_I18N[cat.key] || cat.key) : (CATEGORY_I18N[cat.key] || cat.key)
            return (
              <button
                key={cat.key}
                className={`aic-cat-btn ${activeCategory === cat.key ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat.key)}
              >
                {t(`aiChartsChrome.categories.${catKey}`, cat.label)}
                <span className="aic-cat-count">{categoryCounts[cat.key] || 0}</span>
              </button>
            )
          })}
        </div>
        <button
          className={`aic-fav-filter ${showFavsOnly ? 'active' : ''}`}
          onClick={() => setShowFavsOnly(!showFavsOnly)}
        ><InfoTip text={t('aiChartsChrome.infoFavorites', 'Show only your starred charts. Click the star icon on any chart card to add it to favorites. Favorites sync to your Spectre account when you are signed in.')} position="left" />
          <svg viewBox="0 0 24 24" fill={showFavsOnly ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
            <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
          </svg>
          {favorites.length > 0 ? t('aiChartsChrome.favoritesCount', { count: favorites.length, defaultValue: `Favorites (${favorites.length})` }) : t('aiChartsChrome.favorites', 'Favorites')}
        </button>
      </div>
      </div>

      {/* ── Chart grid ── */}
      {filteredCharts.length > 0 ? (
        <div className="aic-grid" style={{ '--aic-cols': gridCols }}>
          {filteredCharts.map((chart, i) => (
            <ChartCard
              key={chart.id || chart.symbol}
              chart={chart}
              mode={mode}
              globalTfIndex={tfIndex}
              chartType={chartType}
              onRemove={removeChart}
              draggable
              isDragging={dragSym === chart.symbol}
              isDropTarget={overSym === chart.symbol && dragSym !== chart.symbol}
              onDragStartCard={setDragSym}
              onDragOverCard={setOverSym}
              onDropCard={commitDrop}
              onDragEndCard={() => { setDragSym(null); setOverSym(null) }}
              theme={theme}
              toolbarBg={toolbarBg}
              isFav={favorites.includes(chart.symbol)}
              onToggleFav={toggleFav}
              onExpand={setExpandedChart}
              index={i}
              t={t}
            />
          ))}
        </div>
      ) : (
        <div className="aic-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <span>{t('aiChartsChrome.noChartsMatch', 'No charts match your filters')}</span>
        </div>
      )}

      {/* ── Fullscreen modal ── */}
      {expandedChart && (
        <FullscreenModal
          chart={expandedChart}
          mode={mode}
          tfIndex={tfIndex}
          theme={theme}
          toolbarBg={toolbarBg}
          onClose={() => setExpandedChart(null)}
          t={t}
        />
      )}
    </div>
  )
}

export default AIChartsPage
