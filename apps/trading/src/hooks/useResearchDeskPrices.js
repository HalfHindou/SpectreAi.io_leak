/**
 * useResearchDeskPrices - Real-time CoinGecko prices for Research Desk components
 * Fetches market data for all Research Desk tokens in a single batched request.
 * Polls every 60 seconds. Returns { prices, loading } where prices is keyed by symbol.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import useAdaptivePolling from './useAdaptivePolling'

/* ── Symbol → CoinGecko ID mapping ── */
const SYMBOL_TO_COINGECKO = {
  SPECTRE: 'spectre-ai',
  SOL: 'solana',
  ETH: 'ethereum',
  AAVE: 'aave',
  ONDO: 'ondo-finance',
  MORPHO: 'morpho',
  ETHFI: 'ether-fi',
  TAO: 'bittensor',
  LINK: 'chainlink',
}

/* Reverse map: coingecko id → symbol */
const COINGECKO_TO_SYMBOL = Object.fromEntries(
  Object.entries(SYMBOL_TO_COINGECKO).map(([sym, id]) => [id, sym])
)

const ALL_IDS = Object.values(SYMBOL_TO_COINGECKO).join(',')
const POLL_INTERVAL = 60_000 // 60 seconds

/* ── Formatting utilities ── */

/**
 * Format large numbers into compact form: $78B, $4.2B, $320M, $48M
 */
export function formatMcap(num) {
  if (num == null || isNaN(num)) return ''
  const abs = Math.abs(num)
  if (abs >= 1e12) return `$${(num / 1e12).toFixed(1)}T`
  if (abs >= 1e9) {
    const val = num / 1e9
    return val >= 10 ? `$${Math.round(val)}B` : `$${val.toFixed(1)}B`
  }
  if (abs >= 1e6) {
    const val = num / 1e6
    return val >= 10 ? `$${Math.round(val)}M` : `$${val.toFixed(1)}M`
  }
  if (abs >= 1e3) return `$${(num / 1e3).toFixed(1)}K`
  return `$${num.toFixed(0)}`
}

/**
 * Format volume - same format as formatMcap
 */
export function formatVolume(num) {
  return formatMcap(num)
}

/**
 * Format price: $3,240 / $18.40 / $0.31 / $0.000012
 */
export function formatPrice(num) {
  if (num == null || isNaN(num)) return ''
  if (num >= 1000) return `$${num.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (num >= 1) return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (num >= 0.01) return `$${num.toFixed(2)}`
  // For very small numbers, show significant digits
  return `$${num.toPrecision(3)}`
}

/**
 * Fetch market data from CoinGecko via our server proxy
 */
async function fetchCoinGeckoPrices() {
  const url = `/api/coingecko/coins/markets?vs_currency=usd&ids=${ALL_IDS}&order=market_cap_desc&sparkline=false&price_change_percentage=24h`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`)
  const data = await res.json()

  const prices = {}
  for (const coin of data) {
    const symbol = COINGECKO_TO_SYMBOL[coin.id]
    if (!symbol) continue
    prices[symbol] = {
      price: coin.current_price,
      change24h: coin.price_change_percentage_24h,
      mcap: coin.market_cap,
      volume24h: coin.total_volume,
      fdv: coin.fully_diluted_valuation,
    }
  }
  return prices
}

/**
 * Hook: useResearchDeskPrices
 * Returns { prices, loading } - prices keyed by symbol (e.g. prices.SOL.price)
 */
export default function useResearchDeskPrices() {
  const [prices, setPrices] = useState({})
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  const doFetch = useCallback(async () => {
    try {
      const data = await fetchCoinGeckoPrices()
      if (mountedRef.current) {
        setPrices(data)
        setLoading(false)
      }
    } catch (err) {
      // Fetch failed — keep existing data
      // On error: keep existing data, just clear loading on first fail
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    doFetch()
    return () => {
      mountedRef.current = false
    }
  }, [doFetch])

  useAdaptivePolling(doFetch, { interval: POLL_INTERVAL })

  return { prices, loading }
}
