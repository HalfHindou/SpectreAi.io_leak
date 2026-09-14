/**
 * useMajorMarketData - one CoinGecko call (WITH tickers) that powers the
 * major-coin bottom panel: Markets table + Key Stats + Performance. Only used
 * for CoinGecko-sourced majors (BTC/ETH/XRP/...), keyed by their CoinGecko id.
 *
 * Returns the RAW CoinGecko coin object plus a pre-sorted `tickers` array
 * (top exchanges by USD volume, stale/anomaly flagged). The Codex on-chain
 * pipeline is untouched - this hook never runs for contract tokens (the panel
 * that mounts it only renders when the token resolves to a major cgId).
 */
import { useEffect, useState, useMemo } from 'react'
import { getCoinGeckoMarkets } from '../services/codexApi'

export default function useMajorMarketData(cgId) {
  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(!!cgId)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!cgId) {
      setRaw(null)
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    getCoinGeckoMarkets(cgId)
      .then((data) => {
        if (cancelled) return
        if (data) { setRaw(data); setError(null) }
        else setError('unavailable')
      })
      .catch((e) => { if (!cancelled) setError(e?.message || 'failed') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [cgId])

  // Tickers -> clean rows sorted by USD volume desc. Drop stale/anomalous and
  // zero-volume rows so the table reads like a real exchanges list. Memoized so
  // the filter/map/sort over ~100 rows doesn't re-run on every parent re-render.
  const tickers = useMemo(() => {
    const arr = Array.isArray(raw?.tickers) ? raw.tickers : []
    return arr
      .filter((t) => t && !t.is_stale && !t.is_anomaly && (t.converted_volume?.usd || 0) > 0)
      .map((t) => ({
        exchange: t.market?.name || t.market?.identifier || '-',
        base: t.base || '',
        target: t.target || '',
        price: Number(t.converted_last?.usd) || 0,
        volumeUsd: Number(t.converted_volume?.usd) || 0,
        spread: typeof t.bid_ask_spread_percentage === 'number' ? t.bid_ask_spread_percentage : null,
        // Only accept http(s) trade URLs - never put a non-web scheme (e.g.
        // javascript:) from external API data into an href.
        tradeUrl: (typeof t.trade_url === 'string' && /^https?:\/\//i.test(t.trade_url)) ? t.trade_url : null,
      }))
      .sort((a, b) => b.volumeUsd - a.volumeUsd)
  }, [raw])

  return { raw, market: raw?.market_data || null, tickers, loading, error }
}
