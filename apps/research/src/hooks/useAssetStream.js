/**
 * useAssetStream — subscribe to /data-api/v1/stream/asset/:symbol over SSE.
 *
 * Replaces 4 polling effects (price, derivatives, liquidations, social
 * score) with one push subscription. Falls back to noop if EventSource
 * isn't available or the connection fails — callers should keep their
 * existing fetch-on-mount pattern as the cold-start source and use this
 * hook for live deltas only.
 *
 * Usage:
 *   const { price, derivatives, liquidations } = useAssetStream(symbol)
 *
 * Returns the latest snapshot of each event type. Liquidations is an
 * array, capped at 50 most-recent.
 */
import { useEffect, useState, useRef } from 'react'

const STREAM_BASE = '/data-api/v1/stream/asset'
const LIQ_CAP = 50
// After this many errors with no successful event in between, give up on the
// symbol instead of letting EventSource's own 3s retry loop hammer a dead
// endpoint for the life of the mount. Measured on prod 2026-09-01:
// /data-api/v1/stream/asset/SPECTRE answers 403, and every retry prints a red
// line in the user's console. Cold-start data comes from the callers' own
// fetch-on-mount, so giving up costs live deltas only.
const MAX_ERRORS = 3

export default function useAssetStream(symbol, { enabled = true } = {}) {
  const [price, setPrice] = useState(null)
  const [derivatives, setDerivatives] = useState(null)
  const [liquidations, setLiquidations] = useState([])
  const [connected, setConnected] = useState(false)
  const esRef = useRef(null)

  useEffect(() => {
    // Clear the previous symbol's snapshot the instant `symbol` changes. The
    // stream re-subscribes per symbol, but without this reset `price` (and the
    // derivatives/liquidations) keep the OLD token's last value until the first
    // new event arrives - and the consumer applies it, flashing e.g. BTC's
    // price into the SOL card on every token switch. The consumer guards on
    // `price` being non-null, so nulling here makes the stale tick unreachable.
    setPrice(null)
    setDerivatives(null)
    setLiquidations([])
    if (!enabled || !symbol) return
    if (typeof EventSource === 'undefined') return

    const url = `${STREAM_BASE}/${encodeURIComponent(symbol.toUpperCase())}`
    let es
    try {
      es = new EventSource(url)
    } catch {
      return
    }
    esRef.current = es

    let errorCount = 0
    const onPrice = (e) => {
      errorCount = 0
      try { setPrice(JSON.parse(e.data)) } catch { /* noop */ }
    }
    const onDerivs = (e) => {
      errorCount = 0
      try { setDerivatives(JSON.parse(e.data)) } catch { /* noop */ }
    }
    const onLiquidation = (e) => {
      errorCount = 0
      try {
        const liq = JSON.parse(e.data)
        setLiquidations((prev) => [liq, ...prev].slice(0, LIQ_CAP))
      } catch { /* noop */ }
    }
    const onOk = () => { errorCount = 0 }
    const onSubscribed = () => { errorCount = 0; setConnected(true) }
    const onError = () => {
      setConnected(false)
      errorCount += 1
      if (errorCount >= MAX_ERRORS || es.readyState === EventSource.CLOSED) {
        try { es.close() } catch { /* noop */ }
      }
    }

    es.addEventListener('message', onOk)
    es.addEventListener('price', onPrice)
    es.addEventListener('derivatives', onDerivs)
    es.addEventListener('liquidation', onLiquidation)
    es.addEventListener('subscribed', onSubscribed)
    es.addEventListener('error', onError)

    return () => {
      es.removeEventListener('message', onOk)
      es.removeEventListener('price', onPrice)
      es.removeEventListener('derivatives', onDerivs)
      es.removeEventListener('liquidation', onLiquidation)
      es.removeEventListener('subscribed', onSubscribed)
      es.removeEventListener('error', onError)
      try { es.close() } catch { /* noop */ }
      esRef.current = null
      setConnected(false)
    }
  }, [symbol, enabled])

  return { price, derivatives, liquidations, connected }
}
