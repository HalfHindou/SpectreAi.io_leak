/**
 * useBarChangeWindows - real 1h/4h/12h/24h price change computed from Codex
 * hourly OHLCV bars (the same on-chain source the chart uses).
 *
 * WHY: Codex's token-detail endpoint (/api/codex?action=details) only reliably
 * serves change1 (1h) + change24 (24h). change4/change12 come from a secondary
 * Spectre-data backfill that is EMPTY for thin/low-volume tokens, so those
 * windows arrive null - then the detail hook coerces null -> 0, which renders as
 * a fake "+0.00%". Codex's own bars DO carry the real values, so we derive every
 * window from them and let the caller prefer these for 4h/12h.
 *
 * COST: VitalsBento already fetches these exact bars on the token page
 * (getBars('60', 24h)); getBars has cross-module inflight dedup + server-side
 * resolution-bucket caching, and this hook adds its own 5-min module cache, so
 * the marginal cost is ~zero. Deferred to idle so it never contends with the
 * chart's critical first bars fetch.
 *
 * Returns { change1h, change4h, change12h, change24h } as PERCENTS (e.g. -4.12),
 * or null until bars land. Individual windows are null when there aren't enough
 * bars to span them.
 */
import { useState, useEffect } from 'react'
import { getBars } from '../services/codexApi'

const _cache = {}              // { key: { windows, ts } }
const TTL = 5 * 60_000         // 5 min - hourly bars roll ~hourly

function changeOverHours(closes, hours) {
  const n = closes.length
  if (n <= hours) return null
  const then = closes[n - 1 - hours]
  const last = closes[n - 1]
  if (!then || !last) return null
  return (last / then - 1) * 100
}

function _cached(address, networkId) {
  if (!address) return null
  const c = _cache[`${String(address).toLowerCase()}-${networkId}`]
  return c && Date.now() - c.ts < TTL ? c.windows : null
}

export function useBarChangeWindows(address, networkId = 1) {
  // Seed synchronously from the module cache so a revisit paints windows instantly.
  const [windows, setWindows] = useState(() => _cached(address, networkId))

  useEffect(() => {
    if (!address) { setWindows(null); return }
    const key = `${String(address).toLowerCase()}-${networkId}`
    const cached = _cache[key]
    if (cached && Date.now() - cached.ts < TTL) { setWindows(cached.windows); return }

    let cancelled = false
    const run = async () => {
      const now = Math.floor(Date.now() / 1000)
      const from = now - 26 * 3600            // 26h -> a full 24h-ago bar + headroom
      const result = await getBars(address, '60', from, now, networkId).catch(() => null)
      if (cancelled) return
      const closes = (result?.getBars || []).map(b => Number(b.c)).filter(Number.isFinite)
      if (closes.length < 2) return
      const w = {
        change1h: changeOverHours(closes, 1),
        change4h: changeOverHours(closes, 4),
        change12h: changeOverHours(closes, 12),
        change24h: changeOverHours(closes, 24),
      }
      _cache[key] = { windows: w, ts: Date.now() }
      if (!cancelled) setWindows(w)
    }

    // Defer to idle so we never contend with the chart's critical first bars fetch.
    const ric = (typeof window !== 'undefined' && window.requestIdleCallback) || ((f) => setTimeout(f, 250))
    const id = ric(run)
    return () => {
      cancelled = true
      if (typeof window !== 'undefined' && window.cancelIdleCallback && typeof id === 'number') {
        try { window.cancelIdleCallback(id) } catch { /* noop */ }
      }
    }
  }, [address, networkId])

  return windows
}
