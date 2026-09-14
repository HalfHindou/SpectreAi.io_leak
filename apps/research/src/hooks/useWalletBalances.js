/**
 * useWalletBalances Hook
 * Fetches real wallet balances for a given address and chain.
 * Polls every 15s. Privy-agnostic - accepts address as parameter.
 *
 * Uses a module-level cache (stale-while-revalidate):
 *   - On mount: returns cached balances instantly (no loading flash)
 *   - Fetches fresh data in the background
 *   - Only shows loading shimmer on the very first fetch (no cache)
 *
 * Usage:
 *   const { balances, loading, error, refetch } = useWalletBalances(walletAddress, 'ethereum')
 *
 * When walletAddress is null/undefined, returns empty balances (no RPC calls).
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { getWalletBalances, CHAINS } from '@/services/walletService'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'

const POLL_INTERVAL = 15000 // 15 seconds
const EMPTY_PRICES = {}
const CACHE_TTL = 30000 // 30s - cache considered fresh, skip background fetch

// Module-level cache survives component unmount/remount (page navigation)
// Key: "address:chainId" -> { balances, timestamp }
const balanceCache = new Map()

function getCacheKey(address, chainId) {
  return `${address}:${chainId}`
}

function getCached(address, chainId) {
  const key = getCacheKey(address, chainId)
  const entry = balanceCache.get(key)
  if (!entry) return null
  return entry
}

function setCache(address, chainId, balances) {
  const key = getCacheKey(address, chainId)
  balanceCache.set(key, { balances, timestamp: Date.now() })
  // Limit cache size (prevent memory leak if user checks many wallets)
  if (balanceCache.size > 20) {
    const oldest = balanceCache.keys().next().value
    balanceCache.delete(oldest)
  }
}

export function useWalletBalances(walletAddress, chainId = 'ethereum', prices) {
  // Initialize from cache if available - avoids the empty->loading->data flash
  const cached = walletAddress ? getCached(walletAddress, chainId) : null
  const [balances, setBalances] = useState(cached?.balances || [])
  const [loading, setLoading] = useState(!cached && !!walletAddress)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)
  // Store prices in a ref to avoid re-creating fetchBalances on every render
  const pricesRef = useRef(prices || EMPTY_PRICES)
  pricesRef.current = prices || EMPTY_PRICES

  const fetchBalances = useCallback(async (isBackground = false) => {
    if (!walletAddress || !chainId || !CHAINS[chainId]) {
      setBalances([])
      setLoading(false)
      return
    }

    try {
      // Only show loading indicator when there's no cached data to display
      if (!isBackground) {
        const existing = getCached(walletAddress, chainId)
        if (!existing) setLoading(true)
      }
      setError(null)
      const results = await getWalletBalances(walletAddress, chainId, pricesRef.current)
      if (mountedRef.current) {
        setBalances(results)
        setCache(walletAddress, chainId, results)
      }
    } catch (err) {
      console.error('useWalletBalances: fetch failed:', err.message)
      if (mountedRef.current) {
        setError(err)
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [walletAddress, chainId])

  useEffect(() => {
    mountedRef.current = true

    if (!walletAddress) {
      setBalances([])
      setLoading(false)
      return
    }

    // Check cache freshness - show cached data immediately (stale-while-revalidate)
    const entry = getCached(walletAddress, chainId)
    if (entry) {
      setBalances(entry.balances)
      setLoading(false)
      const age = Date.now() - entry.timestamp
      if (age < CACHE_TTL) return // fresh enough, polling will refresh
    }

    // Fetch fresh data (background if we have cache, foreground if not)
    fetchBalances(!!entry)

    return () => { mountedRef.current = false }
  }, [fetchBalances, walletAddress, chainId])

  // Adaptive polling: 15s active, 60s hidden, stops after 5min idle
  useAdaptivePolling(
    () => fetchBalances(true),
    { interval: POLL_INTERVAL, enabled: !!walletAddress }
  )

  return {
    balances,
    loading,
    error,
    refetch: fetchBalances,
    connected: !!walletAddress,
    chain: CHAINS[chainId] || null,
  }
}

/**
 * Map networkId (numeric) to chain slug used by walletService.
 */
export function networkIdToChainSlug(networkId) {
  const map = {
    1: 'ethereum',
    56: 'bsc',
    137: 'polygon',
    42161: 'arbitrum',
    8453: 'base',
    1399811149: 'solana',
  }
  return map[networkId] || 'ethereum'
}

export default useWalletBalances
