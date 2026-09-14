/**
 * useSpectrePriceStream — SSE subscription to Spectre `/v1/stream/prices/sse`.
 *
 * One EventSource per symbol-set, fans out ticks to all React consumers via
 * a module-level subscriber map. Tick shape per probe 2026-05-15:
 *   { asset, price, pct_change_1h, pct_change_24h, volume_24h, high_24h,
 *     low_24h, rank, exchange, market_type, source_ts, ts, src }
 *
 * Replaces (for audit) the 5s Binance ticker poll + 60s CG curated poll
 * for major-coin price updates. Single upstream connection, all subscribers
 * receive every tick. No per-user CG/Codex burn.
 *
 * Audit hook — not wired into existing pages yet.
 */
import { useEffect, useState, useRef } from 'react'

const SSE_BASE = '/data-api/v1/stream/prices/sse'

// One EventSource per unique symbols string (sorted, comma-joined).
const streams = new Map() // key → { es, subs: Set<fn>, lastByAsset: Map, openedAt }

function getOrCreateStream(symbolsKey) {
  if (streams.has(symbolsKey)) return streams.get(symbolsKey)
  const url = `${SSE_BASE}?symbols=${encodeURIComponent(symbolsKey)}`
  const es = new EventSource(url)
  const lastByAsset = new Map()
  const subs = new Set()
  const stream = { es, subs, lastByAsset, openedAt: Date.now(), connected: false }

  es.addEventListener('tick', (ev) => {
    try {
      const data = JSON.parse(ev.data)
      if (data && data.asset) {
        lastByAsset.set(data.asset, { ...data, _localRxAt: Date.now() })
        subs.forEach(fn => { try { fn(data) } catch { /* per-listener safety */ } })
      }
    } catch { /* swallow malformed */ }
  })

  es.addEventListener('subscribed', () => { stream.connected = true })
  es.onerror = () => { stream.connected = false }

  streams.set(symbolsKey, stream)
  return stream
}

function releaseStream(symbolsKey) {
  const stream = streams.get(symbolsKey)
  if (!stream) return
  if (stream.subs.size === 0) {
    try { stream.es.close() } catch { /* ok */ }
    streams.delete(symbolsKey)
  }
}

/**
 * @param {string[]} symbols  e.g. ['BTC', 'ETH']
 * @returns {{ prices: Record<string, TickData>, connected: boolean, error: string | null, _streamKey: string }}
 */
export function useSpectrePriceStream(symbols = []) {
  const symbolsKey = [...new Set(symbols.map(s => String(s || '').toUpperCase()).filter(Boolean))]
    .sort()
    .join(',')
  const [prices, setPrices] = useState({})
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState(null)
  const symbolsKeyRef = useRef(symbolsKey)
  symbolsKeyRef.current = symbolsKey

  useEffect(() => {
    if (!symbolsKey) return
    const stream = getOrCreateStream(symbolsKey)

    // Seed with any cached last-ticks for these symbols
    const initial = {}
    stream.lastByAsset.forEach((v, k) => { initial[k] = v })
    if (Object.keys(initial).length) setPrices(initial)
    setConnected(stream.connected)

    const handler = (tick) => {
      if (symbolsKeyRef.current !== symbolsKey) return
      setPrices(prev => ({ ...prev, [tick.asset]: { ...tick, _localRxAt: Date.now() } }))
      setConnected(true)
      setError(null)
    }
    stream.subs.add(handler)

    return () => {
      stream.subs.delete(handler)
      // Defer release so rapid re-mounts (HMR, route nav) keep the connection.
      setTimeout(() => releaseStream(symbolsKey), 2000)
    }
  }, [symbolsKey])

  return { prices, connected, error, _streamKey: symbolsKey }
}

// Diagnostic helper for the audit page — exposes stream registry state.
export function getSpectreStreamStats() {
  const out = []
  streams.forEach((s, key) => {
    out.push({
      symbols: key,
      connected: s.connected,
      subscribers: s.subs.size,
      tickedAssets: s.lastByAsset.size,
      openedMsAgo: Date.now() - s.openedAt,
    })
  })
  return out
}
