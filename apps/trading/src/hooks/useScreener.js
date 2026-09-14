/**
 * useScreener - Advanced token screener hook
 *
 * Wraps the Codex filterTokens API with multi-dimensional filters.
 * Supports presets, auto-refresh, and filter persistence.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { screenTokens } from '../services/codexApi'

// Client-side exclusion list - belt-and-suspenders (server also filters).
// Kept in sync with the trending bar's skip set (utils/trendingFilter.js)
// so the screener and the ticker drop the same stablecoins / wrapped /
// LST junk — including USDG, RLUSD and friends that were leaking through.
const EXCLUDED_SYMBOLS = new Set([
  'USDT','USDC','DAI','BUSD','TUSD','USDP','GUSD','FRAX','LUSD','USDD','PYUSD',
  'FDUSD','USDX','GHO','DOLA','MIM','MAI','ALUSD','USDG','RLUSD','USDY','USR',
  'AUSD','USDB','USDL','BUIDL','USD0','EURT','USDM','EURC','EURS','CRVUSD',
  'USDTB','USD1','USDT0','REUSD','SUSD',
  'WETH','WBTC','WBNB','WMATIC','WAVAX','WSOL','WFTM','WCRO',
  'CBBTC','CBETH','STETH','WSTETH','RETH','SFRXETH','METH','EZETH','WEETH',
  'MSETH','SWETH','OETH','FRXETH','BETH','RSETH','JITOSOL','TBTC',
  'BTCB','USDS','USDE','SUSDS','JLP',
])
// Native assets only valid on their home chain
const NATIVE_CHAIN = { SOL: 1399811149, ETH: 1, BTC: 1, BNB: 56, MATIC: 137, AVAX: 43114 }

// Preset filter configurations
export const SCREENER_PRESETS = [
  {
    id: 'hot-new',
    label: 'Hot & New',
    description: 'Fresh tokens with real volume and holders',
    filters: { volume24h: { gte: 100000 }, liquidity: { gte: 10000 }, holders: { gte: 20 }, txnCount24h: { gte: 100 } },
    sort: 'createdAt',
    sortDir: 'DESC',
  },
  {
    id: 'sol-gems',
    label: 'SOL Gems',
    description: 'Solana micro-caps with traction',
    filters: { marketCap: { gte: 10000, lte: 5000000 }, liquidity: { gte: 10000 }, holders: { gte: 100 }, volume24h: { gte: 50000 } },
    networks: [1399811149],
    sort: 'volume24',
    sortDir: 'DESC',
  },
  {
    id: 'pumping',
    label: 'Pumping',
    description: '1h change > 10% with real liquidity',
    filters: { change1h: { gte: 0.10 }, volume24h: { gte: 50000 }, liquidity: { gte: 25000 }, holders: { gte: 50 } },
    sort: 'change1',
    sortDir: 'DESC',
  },
  {
    id: 'dumping',
    label: 'Dumping',
    description: '1h change < -10% with real liquidity',
    filters: { change1h: { lte: -0.10 }, volume24h: { gte: 50000 }, liquidity: { gte: 25000 }, holders: { gte: 50 } },
    sort: 'change1',
    sortDir: 'ASC',
  },
  {
    id: 'high-vol',
    label: 'High Volume',
    description: 'Volume > $1M with deep liquidity',
    filters: { volume24h: { gte: 1000000 }, liquidity: { gte: 100000 }, holders: { gte: 100 } },
    sort: 'volume24',
    sortDir: 'DESC',
  },
  {
    id: 'whale-held',
    label: 'Whale Held',
    description: '2000+ holders, strong mcap',
    filters: { holders: { gte: 2000 }, marketCap: { gte: 200000 }, liquidity: { gte: 50000 } },
    sort: 'holders',
    sortDir: 'DESC',
  },
]

/**
 * @param {Object} initialFilters
 * @param {Object} initialOptions - { sort, sortDir, networks, limit }
 * @returns {{ results, loading, error, filters, setFilter, clearFilters, applyPreset, activePreset, sort, setSort, refresh }}
 */
export default function useScreener(initialFilters = {}, initialOptions = {}) {
  const [filters, setFilters] = useState(initialFilters)
  const [sort, setSort] = useState(initialOptions.sort || 'volume24')
  const [sortDir, setSortDir] = useState(initialOptions.sortDir || 'DESC')
  const [networks, setNetworks] = useState(initialOptions.networks || null)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activePreset, setActivePreset] = useState(null)
  const fetchIdRef = useRef(0)

  const doFetch = useCallback(async () => {
    // No numeric filters set => the consumer is in "category" mode and uses
    // useMarketFeed instead; skip the filterTokens query entirely so the
    // screener stays dormant until a filter is applied.
    if (Object.keys(filters).length === 0) {
      setResults([])
      setLoading(false)
      setError(null)
      return
    }
    const fetchId = ++fetchIdRef.current
    setLoading(true)
    setError(null)
    try {
      // Always enforce minimum liquidity to filter out scam/broken tokens
      const safeFilters = { ...filters }
      if (!safeFilters.liquidity) safeFilters.liquidity = { gte: 1000 }
      else if (!safeFilters.liquidity.gte) safeFilters.liquidity = { ...safeFilters.liquidity, gte: 1000 }

      const data = await screenTokens(safeFilters, { sort, sortDir, networks, limit: 50 })
      if (fetchId === fetchIdRef.current) {
        const clean = data.filter(t => {
          // Exclude stablecoins, wrapped assets
          if (EXCLUDED_SYMBOLS.has(t.symbol)) return false
          // Exclude native assets on wrong chains (bridged SOL on Base etc.)
          if (NATIVE_CHAIN[t.symbol] && t.networkId !== NATIVE_CHAIN[t.symbol]) return false
          // Exclude overflow/fake data
          if (t.volume24h > 1e15 || t.marketCap > 1e15 || t.liquidity > 1e15 || t.price > 1e12) return false
          // Exclude honeypots (extreme wash trading)
          if (t.marketCap > 0 && t.volume24h / t.marketCap > 200) return false
          // Exclude dead tokens (zero change + low volume)
          if (t.change1h === 0 && t.change24h === 0 && t.volume24h < 50000) return false
          // Exclude long spam symbol names
          if (t.symbol.length > 10) return false
          return true
        })
        setResults(clean)
      }
    } catch (err) {
      if (fetchId === fetchIdRef.current) {
        setError(err.message)
        setResults([])
      }
    } finally {
      if (fetchId === fetchIdRef.current) setLoading(false)
    }
  }, [filters, sort, sortDir, networks])

  // Fetch on filter/sort change
  useEffect(() => { doFetch() }, [doFetch])

  // Set a single filter dimension
  const setFilter = useCallback((key, value) => {
    setActivePreset(null)
    setFilters(prev => {
      if (!value || (typeof value === 'object' && Object.keys(value).length === 0)) {
        const next = { ...prev }
        delete next[key]
        return next
      }
      return { ...prev, [key]: value }
    })
  }, [])

  // Clear all filters
  const clearFilters = useCallback(() => {
    setActivePreset(null)
    setFilters({})
    setSort('volume24')
    setSortDir('DESC')
    setNetworks(null)
  }, [])

  // Apply a preset
  const applyPreset = useCallback((presetId) => {
    const preset = SCREENER_PRESETS.find(p => p.id === presetId)
    if (!preset) return
    setActivePreset(presetId)
    setFilters(preset.filters || {})
    setSort(preset.sort || 'volume24')
    setSortDir(preset.sortDir || 'DESC')
    setNetworks(preset.networks || null)
  }, [])

  return {
    results,
    loading,
    error,
    filters,
    setFilter,
    clearFilters,
    applyPreset,
    activePreset,
    sort,
    setSort: (s, dir) => { setSort(s); if (dir) setSortDir(dir); setActivePreset(null) },
    networks,
    setNetworks,
    refresh: doFetch,
  }
}
