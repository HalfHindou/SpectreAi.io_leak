/**
 * useWalletBalances Hook
 * Fetches real wallet balances for a given address and chain.
 * Polls every 15s. Privy-agnostic - accepts address as parameter.
 *
 * Usage:
 *   const { balances, loading, error, refetch } = useWalletBalances(walletAddress, 'ethereum')
 *
 * When walletAddress is null/undefined, returns empty balances (no RPC calls).
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { getWalletBalances, CHAINS } from '../services/walletService'
import useAdaptivePolling from '../hooks/useAdaptivePolling'

const POLL_INTERVAL = 15000 // 15 seconds
const EMPTY_PRICES = {} // stable reference to prevent infinite re-render loop

export function useWalletBalances(walletAddress, chainId = 'ethereum', prices) {
  // Stabilize prices to avoid new object reference every render
  const stablePrices = useMemo(() => prices || EMPTY_PRICES, [prices])
  const [balances, setBalances] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)
  const hasFetchedRef = useRef(false)

  const fetchBalances = useCallback(async () => {
    if (!walletAddress || !chainId || !CHAINS[chainId]) {
      // Only update state if it actually changed — avoids re-render loops
      setBalances(prev => prev.length === 0 ? prev : [])
      setLoading(false)
      return
    }

    try {
      // Only show loading shimmer on first fetch, not on chain switches or polls.
      // This prevents the flickering skeleton when switching between EVM chains
      // that share the same wallet address.
      if (!hasFetchedRef.current) {
        setLoading(true)
      }
      setError(null)
      const results = await getWalletBalances(walletAddress, chainId, stablePrices)
      if (mountedRef.current) {
        setBalances(results)
        hasFetchedRef.current = true
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
  }, [walletAddress, chainId, stablePrices])

  // Reset hasFetched when wallet address changes (switching between EVM and Solana)
  useEffect(() => {
    hasFetchedRef.current = false
  }, [walletAddress])

  useEffect(() => {
    mountedRef.current = true
    fetchBalances()
    return () => { mountedRef.current = false }
  }, [fetchBalances, walletAddress])

  // Adaptive polling: 15s active, 60s hidden, stops after 5min idle
  useAdaptivePolling(fetchBalances, { interval: POLL_INTERVAL, enabled: !!walletAddress })

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
    4663: 'robinhood',
    1399811149: 'solana',
  }
  return map[networkId] || 'ethereum'
}

export default useWalletBalances
