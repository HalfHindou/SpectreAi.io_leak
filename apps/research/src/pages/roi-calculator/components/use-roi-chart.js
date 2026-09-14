/**
 * useRoiChart — high-resolution price series for the ROI price chart.
 *
 * Same data path the Research Zone chart uses: Codex OHLCV via `/api/bars`
 * (getBars), so short ranges get intraday granularity (1h / 4h bars) instead
 * of CoinGecko's one-point-per-day `market_chart`. Each range maps to the bar
 * resolution that yields a smooth line:
 *
 *     7D  → 1h   30D → 4h   90D → 4h   1Y → 1D   Max → 1D
 *
 * The selected ROI token only carries a CoinGecko id + ticker, so we resolve
 * its on-chain identity (address / networkId / binancePair) via
 * `/api/token/resolve` — exactly how research-zone resolves a chartToken.
 * If Codex returns nothing (no address, brand-new token), we fall back to the
 * CoinGecko daily series so the chart always renders something.
 *
 * Returns a `series` of `[tsMs, price]` already scoped to the active range.
 */
import { useState, useEffect, useRef } from 'react'
import { getBars } from '@/services/codexApi'
import { getCoinPriceHistory } from '@/services/coinGeckoApi'

const DAY_SEC = 86400

// range key -> { days back, Codex bar resolution }
const RANGE_CFG = {
  '1d': { days: 1, resolution: '15' }, // 15m → 96 bars
  '7d': { days: 7, resolution: '60' }, // 1h  → 168 bars
  '30d': { days: 30, resolution: '240' }, // 4h  → 180 bars
  '90d': { days: 90, resolution: '240' }, // 4h  → 540 bars
  '6m': { days: 180, resolution: '1D' }, // daily
  '1y': { days: 365, resolution: '1D' }, // daily
  'max': { days: 3650, resolution: '1D' }, // daily (server clamps to history)
}

// Resolve { address, networkId, binancePair, cgId } once per token. Keyed by
// cgId|symbol so repeated range switches reuse the in-flight/settled promise.
const _identityCache = new Map()
function resolveIdentity(symbol, cgId) {
  const key = String(cgId || symbol || '').toLowerCase()
  if (!key) return Promise.resolve(null)
  if (_identityCache.has(key)) return _identityCache.get(key)
  const p = (async () => {
    try {
      const q = encodeURIComponent(cgId || symbol)
      const res = await fetch(`/api/token/resolve?symbol=${q}`, { signal: AbortSignal.timeout(8000) })
      if (res.ok) {
        const d = await res.json()
        return {
          symbol: String(d.symbol || symbol || '').toUpperCase(),
          address: d.address || null,
          networkId: d.networkId || 1,
          binancePair: d.binancePair || null,
          cgId: d.cgId || cgId || null,
        }
      }
    } catch (_) { /* fall through to bare identity */ }
    return { symbol: String(symbol || '').toUpperCase(), address: null, networkId: 1, binancePair: null, cgId: cgId || null }
  })()
  _identityCache.set(key, p)
  return p
}

// Per (token, range) series cache so toggling back to a range is instant.
const _seriesCache = new Map()

export function useRoiChart({ symbol, cgId, range }) {
  const [series, setSeries] = useState(null)
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState(null)
  const reqRef = useRef(0)

  useEffect(() => {
    if (!symbol && !cgId) { setSeries(null); setSource(null); return }
    const cfg = RANGE_CFG[range] || RANGE_CFG.max
    const cacheKey = `${String(cgId || symbol).toLowerCase()}:${range}`

    const cached = _seriesCache.get(cacheKey)
    if (cached) {
      setSeries(cached.series)
      setSource(cached.source)
      setLoading(false)
      return
    }

    const reqId = ++reqRef.current
    setLoading(true)
    ;(async () => {
      const id = await resolveIdentity(symbol, cgId)
      const to = Math.floor(Date.now() / 1000)
      const from = to - cfg.days * DAY_SEC
      let pts = null
      let src = null

      // Majors chart best off their Binance pair (ticker); DEX tokens need the
      // address so the server's waterfall hits Codex/Onchain tiers.
      const barSymbol = (id?.address && !id?.binancePair) ? id.address : (id?.symbol || symbol)

      try {
        const r = await getBars(
          barSymbol,
          cfg.resolution,
          from,
          to,
          id?.networkId || 1,
          id?.cgId || cgId || null,
          id?.binancePair || null,
        )
        const bars = Array.isArray(r?.getBars) ? r.getBars : []
        if (bars.length >= 3) {
          pts = bars
            .map((b) => [Number(b.t) * 1000, Number(b.c)])
            .filter(([ts, p]) => ts > 0 && p > 0)
          src = r.source || 'codex'
        }
      } catch (_) { /* fall back below */ }

      // Fallback: CoinGecko daily series sliced to the range.
      if ((!pts || pts.length < 2) && cgId) {
        const hist = await getCoinPriceHistory(cgId).catch(() => null)
        if (hist?.series?.length) {
          const cutoffMs = from * 1000
          let slice = hist.series.filter(([ts]) => ts >= cutoffMs)
          if (slice.length < 2) slice = hist.series.slice(-2)
          pts = slice
          src = 'coingecko'
        }
      }

      if (reqId !== reqRef.current) return
      const finalSeries = pts && pts.length >= 2 ? pts : null
      if (finalSeries) _seriesCache.set(cacheKey, { series: finalSeries, source: src })
      setSeries(finalSeries)
      setSource(src)
      setLoading(false)
    })()
  }, [symbol, cgId, range])

  return { series, loading, source }
}
