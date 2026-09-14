import { useState, useEffect } from 'react'
import { getBars } from '../../../services/codexApi'

/**
 * useCodexDrawdown — derives the longer-window collapse metrics the rug signal
 * needs from Codex daily OHLCV bars (the X Dash token-detail / Codex stats
 * payload is intraday-only: 1h/4h/12h/24h, no 7d/30d/ATH).
 *
 * One `getBars(address, '1D', …)` call per token (the same call VitalsBento
 * already makes on the token page), cached 5 min, NO polling — 7d/30d/off-high
 * move slowly, so a one-shot on token change is plenty.
 *
 * Returns `{ offHighPct, change7d, change30d }` (percentages, negatives = down)
 * or null until loaded / when there's no address.
 */

const DAY = 86400
const TTL = 5 * 60_000
const _cache = new Map() // `${address}:${networkId}` -> { data, ts }

async function fetchDrawdown(address, networkId) {
  const key = `${String(address).toLowerCase()}:${networkId}`
  const cached = _cache.get(key)
  if (cached && Date.now() - cached.ts < TTL) return cached.data

  const now = Math.floor(Date.now() / 1000)
  // 3y window: getBars clamps to a trailing ~3y for majors and returns
  // genesis-to-now for the younger DEX tokens this surface mostly shows, so the
  // window high ≈ the all-time high for exactly the rug-prone long-tail.
  const from = now - 3 * 365 * DAY
  let bars = []
  try {
    const result = await getBars(address, '1D', from, now, networkId)
    bars = result?.getBars || []
  } catch {
    return null
  }
  if (bars.length < 3) { _cache.set(key, { data: null, ts: Date.now() }); return null }

  const closes = bars.map((b) => parseFloat(b.close ?? b.c ?? 0))
  const highs = bars.map((b) => parseFloat(b.high ?? b.h ?? b.close ?? b.c ?? 0))
  const last = closes[closes.length - 1]
  if (!(last > 0)) { _cache.set(key, { data: null, ts: Date.now() }); return null }

  const recentHigh = Math.max(last, ...highs.filter((h) => h > 0))
  const pctBack = (days) => {
    const i = closes.length - 1 - days
    const ref = i >= 0 ? closes[i] : null
    return ref > 0 ? (last / ref - 1) * 100 : null
  }

  const data = {
    offHighPct: recentHigh > 0 ? (last / recentHigh - 1) * 100 : null,
    change7d: pctBack(7),
    change30d: pctBack(30),
  }
  _cache.set(key, { data, ts: Date.now() })
  return data
}

export default function useCodexDrawdown(address, networkId = 1) {
  const [data, setData] = useState(null)

  useEffect(() => {
    if (!address) { setData(null); return }
    let cancelled = false
    fetchDrawdown(address, networkId)
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [address, networkId])

  return data
}
