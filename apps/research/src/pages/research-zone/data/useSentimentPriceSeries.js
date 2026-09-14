/**
 * useSentimentPriceSeries — price line data for the Sentiment x Price overlay.
 *
 * CoinGecko market_chart by cgId (5-min granularity for 1d, hourly for 7/30d)
 * so it works for every CG-listed token independent of the OHLC bar tiers.
 * Returns [{ t: ms, p: price }] ascending. Module-cached per (cgId, days).
 */
import { useState, useEffect } from 'react'

const _cache = new Map()
const _inflight = new Map()
const TTL = 120_000
const LS_PREFIX = 'spectre-senprice-v1:'
const LS_TTL = 10 * 60_000

const TF_DAYS = { '24h': 1, '7d': 7, '30d': 30 }

/* localStorage instant-paint seed — the price line paints from the last visit
   while the fresh series loads (house C1 pattern). Downsampled to <=300 pts
   before persisting so a 5-min 1d series can't blow the quota. */
function lsLoad(key) {
  try {
    const raw = window.localStorage.getItem(`${LS_PREFIX}${key}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || Date.now() - parsed.ts > LS_TTL) return null
    return parsed.data
  } catch { return null }
}
function lsSave(key, data) {
  try {
    const trimmed = data.length > 300
      ? data.filter((_, i) => i % Math.ceil(data.length / 300) === 0)
      : data
    window.localStorage.setItem(`${LS_PREFIX}${key}`, JSON.stringify({ ts: Date.now(), data: trimmed }))
  } catch { /* quota / private mode */ }
}

async function fetchSeries(cgId, days) {
  const key = `${cgId}:${days}`
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.ts < TTL) return hit.data
  if (_inflight.has(key)) return _inflight.get(key)
  const p = fetch(`/api/coingecko/coins/${encodeURIComponent(cgId)}/market_chart?vs_currency=usd&days=${days}`, {
    // credentials: 'include' — /api/coingecko rides the gate cookie; the iOS PWA
    // drops it on same-origin fetches without this -> 401 -> empty price overlay.
    credentials: 'include',
    signal: AbortSignal.timeout(15_000),
  })
    .then((r) => {
      if (!r.ok) throw new Error(`market_chart ${r.status}`)
      return r.json()
    })
    .then((json) => {
      const rows = Array.isArray(json?.prices) ? json.prices : []
      const data = rows
        .map(([t, price]) => ({ t: Number(t), p: Number(price) }))
        .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.p))
      _cache.set(key, { data, ts: Date.now() })
      lsSave(key, data)
      _inflight.delete(key)
      return data
    })
    .catch((err) => {
      _inflight.delete(key)
      throw err
    })
  _inflight.set(key, p)
  return p
}

export default function useSentimentPriceSeries(cgId, timeframe = '7d', { enabled = true } = {}) {
  const [state, setState] = useState({ loading: !!cgId, points: [] })
  const days = TF_DAYS[timeframe] || 7

  useEffect(() => {
    if (!enabled || !cgId) {
      setState({ loading: false, points: [] })
      return undefined
    }
    let cancelled = false
    // instant paint from the last visit, then refresh live
    const seed = lsLoad(`${cgId}:${days}`)
    if (seed?.length) setState({ loading: false, points: seed })
    else setState((s) => ({ ...s, loading: true }))
    fetchSeries(cgId, days)
      .then((points) => { if (!cancelled && points.length) setState({ loading: false, points }) })
      .catch(() => { if (!cancelled && !seed?.length) setState({ loading: false, points: [] }) })
    return () => { cancelled = true }
  }, [enabled, cgId, days])

  return state
}
