/**
 * useCodexStream - Real-time Codex price subscription hook
 *
 * Subscribes to live price updates via the Codex Enterprise WebSocket
 * relay (SSE from Express server). Returns latest price data that
 * auto-updates on each push.
 *
 * Usage:
 *   const { prices, isConnected } = useCodexStream([
 *     { address: '0xC02a...', networkId: 1 },
 *     { address: 'So111...', networkId: 1399811149 },
 *   ])
 *   // prices = Map<"addr:net", { address, networkId, priceUsd, timestamp }>
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { subscribe, isConnected as checkConnected } from '../services/codexStreamApi'
import { subscribeActivity } from '../lib/idleManager'

/**
 * Subscribe to real-time Codex price updates for a list of tokens.
 * @param {Array<{address: string, networkId: number}>} tokens
 * @returns {{ prices: Object, isConnected: boolean }}
 */
export default function useCodexStream(tokens) {
  const [prices, setPrices] = useState({})
  const [connected, setConnected] = useState(false)

  // Stable key for tokens array to avoid re-subscribing on every render
  const tokensKey = tokens?.map(t => `${t.address}:${t.networkId}`).sort().join(',') || ''
  const tokensRef = useRef(tokens)
  tokensRef.current = tokens

  useEffect(() => {
    if (!tokensKey) return

    const tokenKeys = tokensKey.split(',')

    const unsub = subscribe(tokenKeys, (data) => {
      const key = `${data.address}:${data.networkId}`
      setPrices(prev => {
        // Only update if price actually changed
        if (prev[key]?.priceUsd === data.priceUsd) return prev
        return { ...prev, [key]: data }
      })
    })

    setConnected(checkConnected())

    // Check connection status periodically
    const interval = setInterval(() => {
      setConnected(checkConnected())
    }, 5000)

    return () => {
      unsub()
      clearInterval(interval)
    }
  }, [tokensKey])

  return { prices, isConnected: connected }
}

/**
 * Subscribe to a single token's real-time price.
 * @param {string} address
 * @param {number} networkId
 * @returns {{ price: number, timestamp: number, isConnected: boolean }}
 */
export function useCodexTokenPrice(address, networkId) {
  const [price, setPrice] = useState(0)
  const [timestamp, setTimestamp] = useState(0)
  const [streamAddress, setStreamAddress] = useState(null)
  const [connected, setConnected] = useState(false)

  const tokenKey = address && networkId ? `${address}:${networkId}` : ''

  useEffect(() => {
    if (!tokenKey) {
      // Reset when token changes to prevent stale data
      setPrice(0)
      setStreamAddress(null)
      return
    }

    // Reset price immediately on token switch - prevents stale price bleed
    setPrice(0)
    setStreamAddress(null)

    // Coalesce rapid stream ticks. This price is merged into TokenDetailsContext,
    // whose value fans out to ~7 token-page consumers (banner, swap panel, chart,
    // tables). On a hot/fast-ticking token the WS can push many updates/sec, each
    // causing a context-value change and a re-render cascade — the "feels heavy"
    // symptom. Throttle to at most ~3 updates/sec (trailing): we always keep the
    // LATEST tick and flush it on a 320ms cadence, so the displayed price stays
    // current to the eye (320ms is imperceptible) while re-render frequency is
    // capped. No-op on slow tokens (a lone tick flushes immediately on the leading
    // edge). Zero behavior change to swap math — it reads whatever the latest
    // flushed price is, same as before, just not on every sub-frame tick.
    const THROTTLE_MS = 320
    let lastFlush = 0
    let pendingData = null
    let flushTimer = null
    // Last values actually written to state. Effect-scoped, so a token switch
    // resets them alongside the setPrice(0)/setStreamAddress(null) above.
    let lastPrice = null
    let lastAddress = null

    const flush = () => {
      flushTimer = null
      lastFlush = Date.now()
      if (!pendingData) return
      const d = pendingData
      pendingData = null
      const nextPrice = parseFloat(d.priceUsd) || 0
      const nextAddress = d.address || null
      // Bail on a no-change tick. The throttle above caps the RATE, but a flat
      // tape still wrote state every 320ms, and `setTimestamp` guaranteed a
      // re-render because the timestamp always moves - while no consumer reads
      // it (TokenDetailsContext takes only `price` + `streamAddress`). That
      // re-render fans out through the context to every heavy token-page
      // component for nothing.
      // Both fields are compared on purpose: on a token switch the price can
      // coincide numerically while `streamAddress` still has to update, or
      // TokenDetailsContext's address guard rejects the stream price and the
      // display falls back to the 120s poll.
      if (nextPrice === lastPrice && nextAddress === lastAddress) return
      lastPrice = nextPrice
      lastAddress = nextAddress
      setPrice(nextPrice)
      setTimestamp(d.timestamp || 0)
      setStreamAddress(nextAddress)
    }

    const unsub = subscribe([tokenKey], (data) => {
      pendingData = data
      const since = Date.now() - lastFlush
      if (since >= THROTTLE_MS) {
        // Leading edge: flush immediately (covers the slow-token / first-tick case)
        flush()
      } else if (!flushTimer) {
        // Trailing edge: schedule a flush for the remainder of the window
        flushTimer = setTimeout(flush, THROTTLE_MS - since)
      }
    })

    setConnected(checkConnected())
    const interval = setInterval(() => setConnected(checkConnected()), 5000)

    return () => {
      unsub()
      clearInterval(interval)
      if (flushTimer) clearTimeout(flushTimer)
    }
  }, [tokenKey])

  return { price, timestamp, streamAddress, isConnected: connected }
}

/**
 * Subscribe to real-time OHLCV bar updates for a trading pair.
 * Uses the Codex onBarsUpdated subscription via SSE relay.
 *
 * Debounces connection creation to prevent React strict mode thrashing.
 *
 * @param {string} pairAddress - Pair contract address
 * @param {number} networkId - Network ID
 * @param {string} resolution - Chart resolution ('1', '5', '15', '60', '240', '1D')
 * @returns {{ bars: Array, isConnected: boolean }}
 */
export function useCodexBarsStream(pairAddress, networkId, resolution = '60') {
  const [bars, setBars] = useState([])
  const esRef = useRef(null)

  const pairId = pairAddress && networkId ? `${pairAddress}:${networkId}` : ''

  useEffect(() => {
    if (!pairId) return

    function openBarsStream() {
      if (esRef.current) { esRef.current.close(); esRef.current = null }
      const sseBase = import.meta.env.PROD ? 'https://stream.spectreai.io' : ''
      const url = `${sseBase}/api/codex/bars-stream?pairId=${encodeURIComponent(pairId)}&resolution=${resolution}`
      const es = new EventSource(url)
      esRef.current = es

      es.onmessage = (event) => {
        try {
          const bar = JSON.parse(event.data)
          if (bar.open && bar.close) {
            setBars(prev => {
              const existing = prev.findIndex(b => b.time === bar.time)
              if (existing >= 0) {
                const updated = [...prev]
                updated[existing] = bar
                return updated
              }
              const next = [...prev, bar]
              return next.length > 5 ? next.slice(-5) : next
            })
          }
        } catch { /* parse error */ }
      }

      es.onerror = () => { /* EventSource auto-reconnects */ }
    }

    // Debounce connection to prevent React strict mode double-effect thrashing
    const timer = setTimeout(() => {
      if (!document.hidden) openBarsStream()
    }, 200)

    // Pause when tab is hidden, resume when visible
    function onVisChange() {
      if (document.hidden) {
        if (esRef.current) { esRef.current.close(); esRef.current = null }
      } else {
        if (!esRef.current) openBarsStream()
      }
    }
    document.addEventListener('visibilitychange', onVisChange)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisChange)
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      setBars([])
    }
  }, [pairId, resolution])

  return { bars, isConnected: esRef.current?.readyState === EventSource.OPEN }
}

/**
 * Subscribe to real-time trade events via Codex onEventsCreated.
 * Requires a pair address (from topPairAddress in token details).
 *
 * Debounces connection creation to prevent React strict mode thrashing.
 *
 * @param {string} pairAddress - Top pair contract address
 * @param {number} networkId - Network ID
 * @returns {{ trades: Array<{type, timestamp, txHash, amountUSD, maker}> }}
 */
export function useCodexTradesStream(pairAddress, networkId) {
  const [trades, setTrades] = useState([])
  // True while the SSE is open against a ready relay. useLatestTrades reads it
  // to back its REST poll off: while the feed is live every swap on the pair
  // arrives the moment it lands, so the poll is reconciliation, not delivery.
  const [isLive, setIsLive] = useState(false)
  const esRef = useRef(null)

  const pairKey = pairAddress && networkId ? `${pairAddress}:${networkId}` : ''

  useEffect(() => {
    if (!pairKey) return

    setTrades([])
    setIsLive(false)

    function openTradesStream() {
      if (esRef.current) { esRef.current.close(); esRef.current = null }
      const sseBase = import.meta.env.PROD ? 'https://stream.spectreai.io' : ''
      const url = `${sseBase}/api/codex/trades-stream?pairAddress=${encodeURIComponent(pairAddress)}&networkId=${networkId}`
      const es = new EventSource(url)
      esRef.current = es

      es.addEventListener('connected', (event) => {
        try {
          const data = JSON.parse(event.data)
          setIsLive(data?.wsReady !== false)
        } catch { setIsLive(true) }
      })

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.trades?.length) {
            setIsLive(true)
            setTrades(prev => {
              const merged = [...data.trades, ...prev]
              return merged.length > 100 ? merged.slice(0, 100) : merged
            })
          }
        } catch { /* parse error */ }
      }

      // EventSource auto-reconnects; until the next `connected` the feed is
      // not to be trusted, so the poll goes back to its fast cadence.
      es.onerror = () => { setIsLive(false) }
    }

    // Debounce connection to prevent React strict mode double-effect thrashing
    const timer = setTimeout(() => {
      if (!document.hidden) openTradesStream()
    }, 200)

    // Pause when the tab is hidden or the user has gone idle (5 min without
    // input - the pair feed bills per trade, and a hot launch trades every
    // second); resume the moment they are back. isLive drops with the stream
    // so the REST poll returns to its fast cadence and reconciles the gap.
    function closeStream() {
      if (esRef.current) { esRef.current.close(); esRef.current = null }
      setIsLive(false)
    }
    function onVisChange() {
      if (document.hidden) closeStream()
      else if (!esRef.current) openTradesStream()
    }
    document.addEventListener('visibilitychange', onVisChange)
    const unsubActivity = subscribeActivity((active) => {
      if (!active) { if (!document.hidden) closeStream() }
      else if (!document.hidden && !esRef.current) openTradesStream()
    })

    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisChange)
      unsubActivity()
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      setTrades([])
      setIsLive(false)
    }
  }, [pairKey, pairAddress, networkId])

  return { trades, isLive }
}
