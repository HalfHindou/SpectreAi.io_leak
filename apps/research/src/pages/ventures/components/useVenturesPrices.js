/**
 * useVenturesPrices - Spectre Data API (/v1/prices) powered market data hook
 *
 * Replaces the legacy CoinGecko direct fetch. Every piece of market data for
 * the Ventures page now comes from our own bridge at /data-api/v1/prices,
 * which is where the user wants it. Batch-fetches all symbols in one call,
 * polls every 60s via useAdaptivePolling, tab-visibility aware.
 *
 * Returns a symbol-keyed map:
 *   priceMap[SYMBOL] = {
 *     logo, name, price, marketCap, fdv, volume24h,
 *     priceChange1h, priceChange24h, priceChange7d, priceChange30d,
 *     rank, contract, chain,
 *   }
 *
 * Graceful degradation: on any failure, returns whatever was previously
 * cached. Never throws. Keys are always uppercased symbols.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { getPriceRows } from './ventures-prices-store'

// localStorage snapshot of the last good priceMap. Lets a fresh tab paint
// real prices/logos immediately instead of an empty shimmer, while the 60s
// poll refreshes in the background. 6h TTL - stale data is fine for an
// instant-paint seed (it gets overwritten on the first successful fetch).
const LS_KEY = 'ventures-pricemap-v1'
const LS_TTL = 6 * 60 * 60 * 1000

function loadSeed() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.ts || Date.now() - parsed.ts > LS_TTL) return null
    if (!parsed.map || typeof parsed.map !== 'object') return null
    return parsed.map
  } catch {
    return null
  }
}

function saveSeed(map) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ts: Date.now(), map }))
  } catch {
    // Quota/private-mode - non-fatal, in-memory state still works.
  }
}

function mapSpectreRow(row) {
  if (!row) return null
  const change = row.change || {}
  return {
    logo: row.image || null,
    name: row.name || null,
    price: row.price ?? null,
    marketCap: row.market_cap ?? null,
    fdv: row.fdv ?? null,
    volume24h: row.volume_24h ?? null,
    priceChange1h:  change['1h']  ?? null,
    priceChange24h: change['24h'] ?? null,
    priceChange7d:  change['7d']  ?? null,
    priceChange30d: change['30d'] ?? null,
    rank: row.rank ?? null,
    contract: row.contract ?? null,
    chain: row.chain ?? null,
    high24h: row.high_24h ?? null,
    low24h: row.low_24h ?? null,
    circulatingRatio: row.supply?.circulating && row.supply?.total
      ? row.supply.circulating / row.supply.total
      : null,
  }
}

export default function useVenturesPrices(projects) {
  // Seed from a localStorage snapshot so a fresh tab paints real data on the
  // first frame; the 60s poll then refreshes it. Seed presence also skips the
  // initial loading shimmer.
  const [priceMap, setPriceMap] = useState(() => loadSeed() || {})
  const [loading, setLoading] = useState(() => Object.keys(loadSeed() || {}).length === 0)
  // Tracks the last successful price refresh so the FreshnessTag in the
  // page header can render an accurate "Live · Xs ago" pill.
  const [lastUpdated, setLastUpdated] = useState(null)

  // Stable, sorted, comma-separated symbol string. Recomputed whenever the
  // input projects list changes. Using a memoized string (not a ref) is what
  // lets the useEffect below actually re-fire when apiScores loads new rows.
  const symbolString = useMemo(() => {
    const set = new Set()
    for (const p of (projects || [])) {
      if (p?.symbol) set.add(String(p.symbol).toUpperCase())
    }
    return [...set].sort().join(',')
  }, [projects])

  // Fetch the raw rows through the shared ventures-prices-store, which dedupes
  // per-symbol against vc-intel-hub's logo lookup (same /v1/prices endpoint,
  // overlapping symbols) and handles the 75-per-call chunking + caching.
  const fetchPrices = useCallback(async (symbolsCsv) => {
    if (!symbolsCsv) return
    try {
      const symbols = symbolsCsv.split(',').filter(Boolean)
      const rows = await getPriceRows(symbols)

      const next = {}
      for (const [sym, row] of Object.entries(rows)) {
        const mapped = mapSpectreRow(row)
        if (mapped) next[String(sym).toUpperCase()] = mapped
      }
      if (Object.keys(next).length > 0) {
        // Merge with previous so partial responses don't blow away prior data
        // when the symbol set changes (e.g. mock-only first, then +API rows).
        setPriceMap((prev) => {
          const merged = { ...prev, ...next }
          saveSeed(merged) // persist the freshest full map for next-tab instant paint
          return merged
        })
        setLastUpdated(Date.now())
      }
    } catch {
      // Keep the previous map on failure — better than blanking the UI.
    } finally {
      setLoading(false)
    }
  }, [])

  // Re-fetch whenever the symbol set actually changes. This is the fix for
  // the earlier ref-based bug: apiScores loading now properly triggers a
  // second fetch that pulls logos + prices for the full 200-asset universe.
  useEffect(() => {
    if (!symbolString) return
    fetchPrices(symbolString)
  }, [symbolString, fetchPrices])

  // Poll at 60s using the latest symbol set. Wrapped so the polling hook
  // always picks up the current symbolString from closure.
  const pollFn = useCallback(() => fetchPrices(symbolString), [fetchPrices, symbolString])
  const hasSymbols = symbolString.length > 0
  useAdaptivePolling(pollFn, { interval: 60_000, enabled: hasSymbols })

  return { priceMap, loading, lastUpdated }
}
