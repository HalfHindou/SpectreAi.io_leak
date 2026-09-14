/**
 * ChartIframeEmbed — free iframe-based chart for any token.
 *
 * Routes per token shape:
 *   1. Stock symbol -> TradingView widget with NYSE/NASDAQ exchange
 *   2. Has Binance USDT pair -> TradingView widget BINANCE:<SYM>USDT
 *   3. Has on-chain address (EVM or Solana) -> DexScreener embed
 *   4. Neither -> "chart unavailable" message
 *
 * Why this exists: the self-hosted TradingView charting_library requires us
 * to provide OHLCV data via UDF. For DEX-only tokens (PALM, MESSIER, most
 * memecoins) we either don't have the data OR have to burn Codex `getBars`
 * to fetch it. Free iframe widgets (TradingView's hosted widget +
 * DexScreener's embed) have their own data and cost us $0.
 */
import { useMemo } from 'react'
import { hasBinancePair } from '@/services/binanceCatalog'
import './chart-iframe-embed.css'
import { tvExchangeFor } from '@/lib/tradingViewSymbols'

// Codex internal Solana networkId is 1399811149 (not a real EVM chain id).
const NETWORK_ID_TO_DEXSCREENER_CHAIN = {
  1: 'ethereum',
  10: 'optimism',
  56: 'bsc',
  137: 'polygon',
  250: 'fantom',
  324: 'zksync',
  42161: 'arbitrum',
  43114: 'avalanche',
  8453: 'base',
  59144: 'linea',
  534352: 'scroll',
  1399811149: 'solana',
}

function isSolanaAddress(addr) {
  if (!addr || typeof addr !== 'string') return false
  return !addr.startsWith('0x') && addr.length >= 32 && addr.length <= 44
}

/** Map TV-native timeframe (matches TradingViewAdvanced's keys) -> TV iframe interval. */
export function timeframeToTVInterval(tf) {
  switch (tf) {
    case '1M':  return '1'
    case '5M':  return '5'
    case '15M': return '15'
    case '1H':  return '60'
    case '4H':  return '240'
    case '1D':  return 'D'
    case '1W':  return 'W'
    case '7D':  return '60'
    case '3M':  return 'D'
    case '1Y':  return 'W'
    default:    return '60'
  }
}

function tvWidgetSrc({ symbol, interval, theme }) {
  const params = new URLSearchParams({
    symbol,
    interval,
    theme: theme === 'light' ? 'light' : 'dark',
    style: '1',
    timezone: 'Etc/UTC',
    withdateranges: '1',
    hide_side_toolbar: '0',
    allow_symbol_change: '0',
    save_image: '0',
    studies: '[]',
    locale: 'en',
    utm_source: 'spectre',
    utm_medium: 'widget',
  })
  return `https://s.tradingview.com/widgetembed/?${params.toString()}`
}

function dexscreenerSrc({ chain, address, theme }) {
  const t = theme === 'light' ? 'light' : 'dark'
  // DexScreener supports both pair-address and token-address in the URL;
  // when given a token-address it redirects to the primary pair automatically.
  // ?embed=1 strips the page chrome to chart-only.
  // trades=0 hides the trades panel to keep focus on the chart.
  // info=0 hides token info sidebar.
  return `https://dexscreener.com/${chain}/${address.toLowerCase()}?embed=1&theme=${t}&trades=0&info=0`
}

function pickSource(token, timeframe) {
  if (!token) return { kind: 'unavailable', reason: 'no-token' }

  const interval = timeframeToTVInterval(timeframe)
  const theme = token.dayMode ? 'light' : 'dark'
  const symbol = String(token.symbol || '').toUpperCase()

  // Tier 1: stocks via TradingView (NASDAQ/NYSE)
  if (token.isStock && symbol) {
    // token.exchange often arrives as a Yahoo exchange CODE (NMS/NYQ/PCX) —
    // normalize to a real TV prefix or the widget shows "This symbol doesn't
    // exist" (NMS:AAPL).
    const exchange = tvExchangeFor(token.exchange) || 'NASDAQ'
    return {
      kind: 'tv',
      src: tvWidgetSrc({ symbol: `${exchange}:${symbol}`, interval, theme }),
      label: `${exchange}:${symbol}`,
    }
  }

  // Tier 2: crypto with Binance USDT pair (BTC, ETH, SOL, top-50 majors)
  if (token.binancePair) {
    return {
      kind: 'tv',
      src: tvWidgetSrc({ symbol: `BINANCE:${token.binancePair}`, interval, theme }),
      label: `BINANCE:${token.binancePair}`,
    }
  }
  // Common case: token.binancePair not set but the symbol IS a real Binance
  // USDT pair (e.g. SOL, ARB). Gate on the live Binance catalog - the bare
  // `BINANCE:${symbol}USDT` guess fabricated dead pairs for any addressless
  // token (CLAWD -> BINANCE:CLAWDUSDT -> "This symbol doesn't exist"). Same
  // fabrication class the symbol resolver was hardened against 2026-06-10;
  // this embed path never got the guard. Unconfirmed tickers fall through to
  // the DEX/address tier or the honest "switch modes" state below.
  if (symbol && !token.address && hasBinancePair(symbol)) {
    return {
      kind: 'tv',
      src: tvWidgetSrc({ symbol: `BINANCE:${symbol}USDT`, interval, theme }),
      label: `BINANCE:${symbol}USDT`,
    }
  }

  // Tier 3: DEX token with on-chain address -> DexScreener embed
  if (token.address) {
    const sol = isSolanaAddress(token.address)
    const chain = sol
      ? 'solana'
      : NETWORK_ID_TO_DEXSCREENER_CHAIN[Number(token.networkId)] || 'ethereum'
    return {
      kind: 'dex',
      src: dexscreenerSrc({ chain, address: token.address, theme }),
      label: `${chain}:${String(token.address).slice(0, 8)}...`,
    }
  }

  // Tier 4: nothing we can do
  return { kind: 'unavailable', reason: 'no-pair-no-address' }
}

export default function ChartIframeEmbed({ token, timeframe = '1H', dayMode = false, height }) {
  const source = useMemo(() => pickSource({ ...token, dayMode }, timeframe), [
    token?.symbol,
    token?.address,
    token?.networkId,
    token?.binancePair,
    token?.isStock,
    token?.exchange,
    timeframe,
    dayMode,
  ])

  if (source.kind === 'unavailable') {
    return (
      <div className="chart-iframe-embed-unavailable" style={{ height: height || '100%' }}>
        <p>Chart not available for this token.</p>
        <p className="chart-iframe-embed-hint">Switch to Candles or Line mode.</p>
      </div>
    )
  }

  return (
    <iframe
      key={source.src}
      title={`Chart ${source.label}`}
      src={source.src}
      className={`chart-iframe-embed chart-iframe-embed--${source.kind}`}
      allowFullScreen
      allow="clipboard-write"
      style={{ width: '100%', height: height || '100%', border: 0 }}
    />
  )
}
