import { useMemo, useState, useEffect, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { useCuratedTokenPrices, useBinanceTopCoinPrices } from '@/hooks/useCodexData'
import { useStockPrices, useStockTrending, useMarketStatus, useMarketIndices } from '@/hooks/useStockData'
import { TOP_STOCKS, WELCOME_STOCKS as WELCOME_STOCK_SYMBOLS, getStockLogo } from '@/constants/stockData'
import { getMarketNews } from '@/services/stockNewsApi'
import { TOP_COINS, TOKEN_LOGOS } from './welcome-page-constants'

const WELCOME_COINS = ['BTC', 'SOL', 'ETH']

export default function useMarketPrices({ isStocks, watchlist }) {
  // Top coin symbols for CoinGecko
  const topCoinSymbols = useMemo(() => TOP_COINS.map((coin) => coin.symbol), [])

  // Include watchlist symbols in the Binance feed so ALL tokens get realtime prices
  const allBinanceSymbols = useMemo(() => {
    const set = new Set(topCoinSymbols)
    ;(watchlist || []).forEach(t => { if (t.symbol) set.add(t.symbol.toUpperCase()) })
    return [...set]
  }, [topCoinSymbols, watchlist])

  // Full data from CoinGecko (market cap, 7d change, etc.) - refreshes every 60s
  const { prices: coinGeckoPrices } = useCuratedTokenPrices(topCoinSymbols, 60 * 1000)
  // Real-time prices from Binance via the shared polling store.
  // 2026-06-03 cost war: was 5s. At 50 users * ~30 symbols * 12 polls/min that
  // was the single biggest idle treadmill on the Welcome page. The SSE stream
  // already drives the live price chips at sub-second cadence; this batch only
  // needs to backfill 24h change + the long-tail tokens not on SSE. 30s is
  // imperceptible to users and cuts this loop 6x.
  const { prices: binancePrices } = useBinanceTopCoinPrices(allBinanceSymbols, 30000)

  // Merge: Use Binance real-time prices, but keep CoinGecko's additional data
  const topCoinPrices = useMemo(() => {
    const merged = { ...coinGeckoPrices }
    Object.keys(binancePrices || {}).forEach(symbol => {
      const binanceData = binancePrices[symbol]
      if (binanceData?.price > 0) {
        merged[symbol] = {
          ...merged[symbol],
          price: binanceData.price,
          change: binanceData.change ?? binanceData.change24 ?? merged[symbol]?.change,
        }
      }
    })
    return merged
  }, [coinGeckoPrices, binancePrices])

  // ========== STOCK MARKET DATA ==========
  const topStockSymbols = useMemo(() => TOP_STOCKS.map(s => s.symbol), [])
  const allStockSymbols = useMemo(() => {
    if (!isStocks) return []
    const base = new Set(topStockSymbols)
    if (watchlist) {
      watchlist.forEach(t => {
        if (t.isStock && t.symbol && !base.has(t.symbol)) base.add(t.symbol)
      })
    }
    return [...base]
  }, [isStocks, topStockSymbols, watchlist])

  // 30s cadence matches the crypto poll. In crypto mode allStockSymbols is
  // empty so this is a no-op; 10s was needlessly aggressive in stocks mode.
  const { prices: stockPrices } = useStockPrices(allStockSymbols, 30000)
  const { gainers: stockGainers, losers: stockLosers } = useStockTrending(isStocks ? 60000 : null)
  const marketStatus = useMarketStatus()
  const { indices: marketIndices } = useMarketIndices(isStocks ? 30000 : null)

  // Stock news state
  const [stockNews, setStockNews] = useState([])
  const fetchStockNews = useCallback(async () => {
    try {
      const news = await getMarketNews('general')
      setStockNews(news)
    } catch (e) { /* silently handled */ }
  }, [])

  // Initial fetch on mount when stocks mode
  useEffect(() => {
    if (isStocks) fetchStockNews()
  }, [isStocks, fetchStockNews])

  useAdaptivePolling(fetchStockNews, { interval: 5 * 60 * 1000, enabled: isStocks })

  // Unified price data - crypto or stock based on mode
  const activePrices = useMemo(() => {
    if (isStocks) {
      const transformed = {}
      Object.entries(stockPrices || {}).forEach(([symbol, data]) => {
        transformed[symbol] = {
          price: data.price,
          change: data.change,
          change24: data.change,
          marketCap: data.marketCap,
          volume: data.volume,
          pe: data.pe,
          eps: data.eps,
          sector: data.sector,
          exchange: data.exchange,
          marketState: data.marketState,
        }
      })
      return transformed
    }
    return topCoinPrices
  }, [isStocks, stockPrices, topCoinPrices])

  // Unified asset list - crypto or stock
  const activeAssets = useMemo(() => {
    if (isStocks) {
      return TOP_STOCKS.map(stock => ({
        ...stock,
        logo: getStockLogo(stock.symbol, stock.sector),
        type: 'stock',
      }))
    }
    return TOP_COINS.map(coin => ({
      ...coin,
      logo: TOKEN_LOGOS[coin.symbol],
      type: 'crypto',
    }))
  }, [isStocks])

  // Welcome widget assets
  const welcomeAssets = useMemo(() => {
    if (isStocks) {
      return WELCOME_STOCK_SYMBOLS.map(symbol => {
        const stock = TOP_STOCKS.find(s => s.symbol === symbol)
        const price = stockPrices?.[symbol]
        return {
          symbol,
          name: stock?.name || symbol,
          logo: getStockLogo(symbol, stock?.sector),
          price: price?.price || 0,
          change: price?.change || 0,
          type: 'stock',
        }
      })
    }
    return WELCOME_COINS.map(symbol => {
      const coin = TOP_COINS.find(c => c.symbol === symbol)
      const price = topCoinPrices?.[symbol]
      return {
        symbol,
        name: coin?.name || symbol,
        logo: TOKEN_LOGOS[symbol],
        price: price?.price || 0,
        change: price?.change || 0,
        type: 'crypto',
      }
    })
  }, [isStocks, stockPrices, topCoinPrices])

  return {
    topCoinPrices,
    binancePrices,
    coinGeckoPrices,
    stockPrices,
    stockGainers,
    stockLosers,
    marketStatus,
    marketIndices,
    stockNews,
    activePrices,
    activeAssets,
    welcomeAssets,
    WELCOME_COINS,
  }
}
