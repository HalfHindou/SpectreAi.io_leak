/**
 * YouMacroPulse — combined macro signal: BTC dominance, total mcap,
 * 24h crypto-market change. Pulls coinGeckoApi.getGlobalStats.
 * Compact 3-cell row.
 */
import { useCallback, useEffect, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import coinGeckoApi from '@/services/coinGeckoApi'
import './YouMacroPulse.css'

function fmtUsd(v) {
  if (v == null || isNaN(v)) return '—'
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${Math.round(v).toLocaleString()}`
}

export default function YouMacroPulse() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const data = await coinGeckoApi.getGlobalStats?.()
      setStats(data || null)
      setError(null)
    } catch (err) {
      setError(err?.message || 'unable to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, 120_000)

  if (loading && !stats) {
    return <div className="you-mp"><div className="you-shimmer" style={{ height: 50, borderRadius: 6 }} /></div>
  }
  if (error || !stats) return <div className="you-mp-empty">Macro pulse unavailable.</div>

  const totalMcap = stats.total_market_cap?.usd ?? stats.totalMarketCap ?? 0
  const change24h = stats.market_cap_change_percentage_24h_usd ?? stats.marketCapChange24h ?? 0
  const btcDom = stats.market_cap_percentage?.btc ?? stats.btcDominance ?? 0
  const ethDom = stats.market_cap_percentage?.eth ?? stats.ethDominance ?? 0
  const tone = change24h > 0 ? 'bull' : change24h < 0 ? 'bear' : 'neutral'

  return (
    <div className="you-mp">
      <div className="you-mp-stat">
        <span className="you-mp-label">Crypto Mcap</span>
        <span className="you-mp-value mono">{fmtUsd(totalMcap)}</span>
        <span className={`you-mp-delta you-mp-delta--${tone} mono`}>
          {change24h >= 0 ? '+' : ''}{Number(change24h).toFixed(2)}%
        </span>
      </div>
      <div className="you-mp-stat">
        <span className="you-mp-label">BTC Dominance</span>
        <span className="you-mp-value mono">{Number(btcDom).toFixed(1)}%</span>
      </div>
      <div className="you-mp-stat">
        <span className="you-mp-label">ETH Dominance</span>
        <span className="you-mp-value mono">{Number(ethDom).toFixed(1)}%</span>
      </div>
    </div>
  )
}
