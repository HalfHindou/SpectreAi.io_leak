/**
 * YouLiqHeatmap — BTC liquidation cluster levels.
 * Pulls /api/charts/liq-heatmap and aggregates the heatmap grid into the
 * top price buckets by liquidation density. Rendered as horizontal density
 * bars relative to current price with above/below tone.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import './YouLiqHeatmap.css'

const SYMBOLS = [
  { key: 'BTCUSDT', label: 'BTC' },
  { key: 'ETHUSDT', label: 'ETH' },
  { key: 'SOLUSDT', label: 'SOL' },
]

function fmtPrice(v) {
  if (v == null || isNaN(v)) return '—'
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (v >= 1) return v.toFixed(2)
  return v.toFixed(4)
}

export default function YouLiqHeatmap() {
  const [sym, setSym] = useState(SYMBOLS[0])
  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/charts/liq-heatmap?symbol=${sym.key}`, { signal: AbortSignal.timeout(12000) })
      if (!res.ok) throw new Error(`${res.status}`)
      const json = await res.json()
      setRaw(json?.data?.liqHeatMap || null)
      setError(null)
    } catch (err) { setError(err?.message || 'unable to load') } finally { setLoading(false) }
  }, [sym.key])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, { interval: 5 * 60_000 })

  const view = useMemo(() => {
    if (!raw || !Array.isArray(raw.priceArray) || !Array.isArray(raw.data) || !Array.isArray(raw.klines)) return null
    const prices = raw.priceArray.map(Number)
    const klines = raw.klines
    const lastClose = Number(klines[klines.length - 1]?.[4] ?? klines[klines.length - 1]?.[1])
    const totalsPerY = new Array(prices.length).fill(0)
    for (const cell of raw.data) {
      const yIdx = Number(cell[1])
      const v = Number(cell[2])
      if (!isFinite(yIdx) || !isFinite(v) || yIdx < 0 || yIdx >= prices.length) continue
      totalsPerY[yIdx] += v
    }
    const max = totalsPerY.reduce((m, v) => v > m ? v : m, 0) || 1
    const rows = totalsPerY.map((v, i) => ({ price: prices[i], total: v, frac: v / max }))
      .filter(r => r.total > 0 && isFinite(r.price))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)
      .sort((a, b) => b.price - a.price)
    return { rows, lastClose, totalLiq: totalsPerY.reduce((s, v) => s + v, 0) }
  }, [raw])

  if (loading && !view) return <div className="you-lh">{[0,1,2,3,4].map(i => <div key={i} className="you-shimmer" style={{ height: 18, marginBottom: 6, borderRadius: 4 }} />)}</div>
  if (error || !view || view.rows.length === 0) return <div className="you-lh-empty">Liquidation map unavailable.</div>

  return (
    <div className="you-lh">
      <div className="you-lh-head">
        <div className="you-lh-tabs">
          {SYMBOLS.map(s => (
            <button key={s.key} type="button" className={`you-lh-tab${sym.key === s.key ? ' you-lh-tab--on' : ''}`} onClick={() => setSym(s)}>{s.label}</button>
          ))}
        </div>
        <span className="you-lh-spot mono">spot {fmtPrice(view.lastClose)}</span>
      </div>
      <ul className="you-lh-list">
        {view.rows.map((r, i) => {
          const above = view.lastClose && r.price > view.lastClose
          return (
            <li key={i} className={`you-lh-row you-lh-row--${above ? 'above' : 'below'}`}>
              <span className="you-lh-price mono">{fmtPrice(r.price)}</span>
              <span className="you-lh-bar-wrap">
                <span className="you-lh-bar" style={{ width: `${Math.max(2, r.frac * 100)}%` }} />
              </span>
              <span className="you-lh-side mono">{above ? '↑' : '↓'}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
