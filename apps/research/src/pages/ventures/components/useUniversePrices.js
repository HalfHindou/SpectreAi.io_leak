/**
 * useUniversePrices — the single live price feed powering every Universe view.
 *
 * Collects every tradeable symbol referenced across the VC registry, fetches
 * /v1/prices (proxied, key injected server-side) in 75-symbol chunks, and
 * re-polls every 30s. Returns a map keyed by uppercase symbol with the fields
 * the three views need (price, 24h/7d/30d change, mcap, volume, image).
 *
 * A module-level cache makes re-opening Ventures instant and de-dupes the
 * fetch when both the desktop and mobile hub mount in the same tick.
 */
import { useState, useEffect, useRef } from 'react'
import { isAppActive } from '@/lib/idleManager'
import { collectSymbols } from './smu-shared'

const POLL_MS = 30_000
const CHUNK = 75

let _cache = null // { map, ts }
let _inflight = null

function normalizeRow(sym, row) {
  const change = row?.change || {}
  return {
    symbol: String(sym).toUpperCase(),
    name: row?.name || '',
    image: row?.image || null,
    rank: row?.rank ?? null,
    price: Number.isFinite(row?.price) ? row.price : null,
    marketCap: Number.isFinite(row?.market_cap) ? row.market_cap : null,
    volume24h: Number.isFinite(row?.volume_24h) ? row.volume_24h : null,
    change1h: Number.isFinite(change['1h']) ? change['1h'] : null,
    change24h: Number.isFinite(change['24h']) ? change['24h'] : null,
    change7d: Number.isFinite(change['7d']) ? change['7d'] : null,
    change30d: Number.isFinite(change['30d']) ? change['30d'] : null,
  }
}

async function fetchPrices(symbols) {
  const chunks = []
  for (let i = 0; i < symbols.length; i += CHUNK) chunks.push(symbols.slice(i, i + CHUNK))

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const url = `/data-api/v1/prices?symbols=${encodeURIComponent(chunk.join(','))}`
        const res = await fetch(url)
        if (!res.ok) return {}
        const json = await res.json()
        return json?.data || json || {}
      } catch {
        return {}
      }
    }),
  )

  const map = {}
  for (const payload of results) {
    for (const [sym, row] of Object.entries(payload)) {
      if (!row || typeof row !== 'object') continue
      map[String(sym).toUpperCase()] = normalizeRow(sym, row)
    }
  }
  return map
}

export default function useUniversePrices(entities) {
  const [priceMap, setPriceMap] = useState(() => _cache?.map || {})
  const [lastUpdated, setLastUpdated] = useState(() => _cache?.ts || null)
  const [loading, setLoading] = useState(() => !_cache)

  // Stable comma string so the effect only re-arms when the symbol set changes.
  const symbolsKey = (() => {
    try {
      return collectSymbols(entities).join(',')
    } catch {
      return ''
    }
  })()

  const symbolsRef = useRef(symbolsKey)
  symbolsRef.current = symbolsKey

  useEffect(() => {
    if (!symbolsKey) return
    let cancelled = false
    let timer = null

    const run = async ({ poll = false } = {}) => {
      // Skip background poll ticks on a hidden or idle (5min) tab so an
      // abandoned Ventures tab stops burning upstream price quota. The initial
      // mount fetch always runs so the board paints. (gold standard:
      // useWatchlistPrices)
      if (poll && (document.hidden || !isAppActive())) return
      const symbols = symbolsRef.current.split(',').filter(Boolean)
      if (!symbols.length) return
      try {
        // Coalesce concurrent first loads across mounts.
        if (!_inflight) _inflight = fetchPrices(symbols)
        const map = await _inflight
        _inflight = null
        if (cancelled) return
        if (map && Object.keys(map).length) {
          const ts = new Date().toISOString()
          _cache = { map, ts }
          setPriceMap(map)
          setLastUpdated(ts)
        }
      } catch {
        _inflight = null
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    // Refresh in the background even on a warm cache so prices stay live.
    run()
    timer = setInterval(() => run({ poll: true }), POLL_MS)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [symbolsKey])

  return { priceMap, lastUpdated, loading }
}
