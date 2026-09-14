/**
 * YouPerpFundingSkew — funding skew across exchanges per token.
 *
 * Reuses the existing tradersCornerApi.getFundingRates() helper. For each
 * top token, compute the spread between the highest and lowest exchange's
 * funding rate. Tokens are ranked by absolute spread — the most divergent
 * pairs surface first because that's where the squeeze risk lives.
 *
 * Bull tone: longs are paying (positive average funding).
 * Bear tone: shorts are paying (negative average funding).
 *
 * Data refresh: 30s. Empty state when aggregator is unreachable.
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { getFundingRates } from '@/pages/traders-corner/tradersCornerApi'
import './YouPerpFundingSkew.css'

const REFRESH_INTERVAL_MS = 30_000

function exchangeRates(entry) {
  if (!entry) return []
  return Object.entries(entry)
    .filter(([k, v]) => !k.startsWith('_') && Number.isFinite(v))
    .map(([k, v]) => ({ exchange: k, rate: v }))
}

export default function YouPerpFundingSkew() {
  const [rates, setRates] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchRates = useCallback(async () => {
    try {
      const res = await getFundingRates()
      setRates(res || null)
      setError(null)
    } catch (err) {
      setError(err?.message || 'unable to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRates() }, [fetchRates])
  useAdaptivePolling(fetchRates, REFRESH_INTERVAL_MS)

  const rows = useMemo(() => {
    if (!rates) return []
    const summaries = Object.entries(rates).map(([sym, entry]) => {
      const ex = exchangeRates(entry)
      if (ex.length < 2) return null
      const sorted = ex.slice().sort((a, b) => a.rate - b.rate)
      const low = sorted[0]
      const high = sorted[sorted.length - 1]
      const spread = high.rate - low.rate
      const avg = entry._avg ?? (ex.reduce((s, e) => s + e.rate, 0) / ex.length)
      return { sym, spread, avg, high, low, count: ex.length }
    }).filter(Boolean)
    summaries.sort((a, b) => Math.abs(b.spread) - Math.abs(a.spread))
    return summaries.slice(0, 10)
  }, [rates])

  if (loading && rows.length === 0) {
    return (
      <div className="you-pfs">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="you-pfs-row you-pfs-row--skeleton">
            <div className="you-shimmer" style={{ width: 40, height: 12, borderRadius: 4 }} />
            <div className="you-shimmer" style={{ width: '60%', height: 8, borderRadius: 4 }} />
          </div>
        ))}
      </div>
    )
  }

  if (error || rows.length === 0) {
    return (
      <div className="you-pfs-empty">
        <span className="you-pfs-empty-text">Funding aggregator unavailable.</span>
      </div>
    )
  }

  return (
    <ul className="you-pfs">
      {rows.map((r) => {
        const tone = r.avg > 0.005 ? 'bull' : r.avg < -0.005 ? 'bear' : 'neutral'
        return (
          <li key={r.sym} className="you-pfs-row">
            <span className="you-pfs-sym mono">{r.sym}</span>
            <span className={`you-pfs-avg you-pfs-avg--${tone} mono`}>
              {r.avg >= 0 ? '+' : ''}{r.avg.toFixed(4)}%
            </span>
            <div className="you-pfs-skew">
              <span className="you-pfs-skew-low mono">
                {r.low.exchange} {r.low.rate.toFixed(4)}%
              </span>
              <span className="you-pfs-skew-arrow">→</span>
              <span className="you-pfs-skew-high mono">
                {r.high.exchange} {r.high.rate.toFixed(4)}%
              </span>
            </div>
            <span className={`you-pfs-spread mono you-pfs-spread--${tone}`}>
              Δ {r.spread.toFixed(4)}%
            </span>
          </li>
        )
      })}
    </ul>
  )
}
