/**
 * useWalletBalance - Fetches total USD balance for embedded Privy wallets.
 * Lightweight hook for header display. Polls every 30s.
 * Uses Privy's built-in wallet provider (no direct RPC calls - avoids CORS).
 */
import { useState, useEffect, useRef, useCallback } from 'react'
// Deferred-safe wallets: returns [] until the lazy PrivyProvider mounts, then
// the live useWallets() array. Keeps @privy-io/react-auth OFF the entry path
// (this hook is imported by the header, which boots before Privy mounts).
import { useWalletsSafe } from '@/lib/use-privy-safe'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
// spectreMarketApi (~74KB) is dynamic-imported on first price fetch — the
// header pulls this hook into the entry, but ETH/SOL prices aren't needed until
// the user actually has an embedded wallet with a balance. Cache the module
// promise so repeat fetches don't re-import.
let _spectreApiPromise = null
function loadSpectreApi() {
  if (!_spectreApiPromise) _spectreApiPromise = import('@/services/spectreMarketApi')
  return _spectreApiPromise
}

const POLL_INTERVAL = 30000
const HAS_PRIVY_APP = Boolean(import.meta.env.VITE_PRIVY_APP_ID)

// Showcase iframe also has no PrivyProvider (suppressed in main.jsx to
// avoid the Privy auth-iframe frame-ancestors error). Compute once at
// module load - the value is stable for the lifetime of the page, so
// the conditional hook return below is safe under React's rules-of-hooks.
const IS_SHOWCASE_EMBED = (() => {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('embed') === 'showcase') return true
    if (window.self !== window.top) return true
  } catch { return true }
  return false
})()
const PRIVY_AVAILABLE = HAS_PRIVY_APP && !IS_SHOWCASE_EMBED

let priceCache = { eth: 0, sol: 0, ts: 0 }
const PRICE_TTL = 60000

async function fetchPrices() {
  if (Date.now() - priceCache.ts < PRICE_TTL) return priceCache
  try {
    const { getSpectrePricesBySymbols } = await loadSpectreApi()
    const prices = await getSpectrePricesBySymbols(['ETH', 'SOL'])
    priceCache = {
      eth: prices.ETH?.price || 0,
      sol: prices.SOL?.price || 0,
      ts: Date.now(),
    }
  } catch { /* use stale cache */ }
  return priceCache
}

async function getEthBalanceViaProvider(wallet) {
  try {
    const provider = await wallet.getEthereumProvider()
    const hexBalance = await provider.request({
      method: 'eth_getBalance',
      params: [wallet.address, 'latest'],
    })
    return parseInt(hexBalance, 16) / 1e18
  } catch {
    return 0
  }
}

async function getSolBalanceViaProvider(wallet) {
  try {
    const res = await fetch('/api/solana-balance?address=' + wallet.address)
    if (res.ok) {
      const data = await res.json()
      return (data.balance || 0) / 1e9
    }
    return 0
  } catch {
    return 0
  }
}

export function useWalletBalance() {
  if (!PRIVY_AVAILABLE) return { totalUsd: null, loading: false }
  const wallets = useWalletsSafe()
  const [totalUsd, setTotalUsd] = useState(null)
  const [loading, setLoading] = useState(false)
  const mountedRef = useRef(true)

  const embeddedWallets = wallets.filter(w => w.walletClientType === 'privy')

  const fetchBalance = useCallback(async (isBackground = false) => {
    if (embeddedWallets.length === 0) {
      setTotalUsd(null)
      return
    }

    if (!isBackground) setLoading(true)

    try {
      const prices = await fetchPrices()
      let total = 0

      for (const w of embeddedWallets) {
        if (w.chainType === 'solana') {
          const sol = await getSolBalanceViaProvider(w)
          total += sol * prices.sol
        } else {
          const eth = await getEthBalanceViaProvider(w)
          total += eth * prices.eth
        }
      }

      if (mountedRef.current) setTotalUsd(total)
    } catch {
      // Keep existing value on error
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [embeddedWallets.map(w => w.address).join(',')])

  useEffect(() => {
    mountedRef.current = true
    if (embeddedWallets.length === 0) {
      setTotalUsd(null)
      return
    }
    fetchBalance()
    return () => { mountedRef.current = false }
  }, [fetchBalance])

  // Adaptive polling: 30s active, 2min hidden, stops after 5min idle
  useAdaptivePolling(
    () => fetchBalance(true),
    { interval: POLL_INTERVAL, enabled: embeddedWallets.length > 0 }
  )

  return { totalUsd, loading }
}

export function formatBalance(usd) {
  if (usd === null || usd === undefined) return '$0.00'
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}K`
  if (usd >= 1) return `$${usd.toFixed(2)}`
  if (usd === 0) return '$0.00'
  return `$${usd.toFixed(4)}`
}
