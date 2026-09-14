/**
 * useWalletBalance - Fetches total USD balance for embedded Privy wallets.
 * Lightweight hook for header display. Polls every 30s.
 * Uses Privy's built-in wallet provider (no direct RPC calls - avoids CORS).
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useWalletsSafe as useWallets } from '../lib/use-privy-safe'
import useAdaptivePolling from '../hooks/useAdaptivePolling'
import { whenIdle } from '../utils/whenIdle'

const POLL_INTERVAL = 30000

// Simple price cache (ETH + SOL prices from CoinGecko)
let priceCache = { eth: 0, sol: 0, ts: 0 }
const PRICE_TTL = 60000 // 1 minute
// In-flight dedup. The TTL cache alone doesn't help at boot: the cache is
// empty, so every concurrent caller passes the freshness check and starts its
// own request. Measured on prod - two identical
// `/api/coingecko/simple/price?ids=ethereum,solana` requests 4ms apart
// (2384ms and 2388ms), one served from the HTTP cache, one paying 502ms on the
// network. Same pattern nativePricesStore.js already uses.
let priceInflight = null

async function fetchPrices() {
  if (Date.now() - priceCache.ts < PRICE_TTL) return priceCache
  if (priceInflight) return priceInflight
  priceInflight = (async () => {
    try {
      const res = await fetch('/api/coingecko/simple/price?ids=ethereum,solana&vs_currencies=usd')
      if (res.ok) {
        const data = await res.json()
        priceCache = {
          eth: data.ethereum?.usd || 0,
          sol: data.solana?.usd || 0,
          ts: Date.now(),
        }
      }
    } catch { /* use stale cache */ } finally {
      priceInflight = null
    }
    return priceCache
  })()
  return priceInflight
}

async function getEthBalanceViaProvider(wallet) {
  try {
    const provider = await wallet.getEthereumProvider()
    // eth_getBalance returns hex wei
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
    // Privy Solana wallets expose signTransaction but not RPC directly.
    // Use the server proxy to avoid CORS issues with public RPC endpoints.
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
  const { wallets } = useWallets()
  const [totalUsd, setTotalUsd] = useState(null)
  const [loading, setLoading] = useState(false)
  const mountedRef = useRef(true)

  // Get embedded wallets only
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
    // Idle-defer the initial balance fetch (coingecko price + per-wallet RPC):
    // the header total is non-critical chrome and must not compete with the
    // token page's first-second data path. 30s polling cadence unchanged.
    const cancelIdle = whenIdle(() => { fetchBalance() }, { timeout: 3000 })
    return () => { mountedRef.current = false; cancelIdle() }
  }, [fetchBalance])

  // Adaptive polling: 30s active, 2min hidden, stops after 5min idle
  useAdaptivePolling(
    () => fetchBalance(true),
    { interval: POLL_INTERVAL, enabled: embeddedWallets.length > 0 }
  )

  return { totalUsd, loading }
}

export function formatBalance(usd) {
  if (usd === null || usd === undefined) return ''
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}K`
  if (usd >= 1) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(4)}`
}
