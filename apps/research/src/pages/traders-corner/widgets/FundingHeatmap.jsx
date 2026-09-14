/**
 * W-005 · Funding Heatmap Widget
 * Grid of tokens x exchanges showing real funding rates as colored cells.
 * Continuous color scale: #EF4444 (-0.1%) -> transparent (0%) -> #10B981 (+0.1%).
 * Fetches real multi-exchange data from tradersCornerApi (proxied through server).
 */
import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { getFundingRates } from '../tradersCornerApi'
import './FundingHeatmap.css'

/* ---------- constants ---------- */

const TOKENS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'ARB']
const EXCHANGES = ['Spectre', 'Binance', 'Bybit', 'OKX']

/* ---------- helpers ---------- */

function rateToColor(rate) {
  const clamped = Math.max(-0.1, Math.min(0.1, rate))
  const intensity = Math.abs(clamped) / 0.1
  if (clamped >= 0) return `rgba(16, 185, 129, ${intensity * 0.55})`
  return `rgba(239, 68, 68, ${intensity * 0.55})`
}

function highlightBorder(rate) {
  if (Math.abs(rate) <= 0.05) return 'none'
  if (rate >= 0) return '1px solid rgba(16, 185, 129, 0.6)'
  return '1px solid rgba(239, 68, 68, 0.6)'
}

/* ---------- component ---------- */

export default function FundingHeatmap() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const rates = await getFundingRates()
      setData(rates)
    } catch { /* silently handled */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Refresh every 30s
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) fetchData() }, 30_000)
    return () => clearInterval(id)
  }, [fetchData])

  const grid = useMemo(() => {
    const result = {}
    for (const token of TOKENS) {
      result[token] = {}
      for (const exchange of EXCHANGES) {
        const rate = data?.[token]?.[exchange]
        result[token][exchange] = rate != null ? rate : null
      }
    }
    return result
  }, [data])

  return (
    <div className="tcfh">
      <div
        className="tcfh-grid"
        style={{ gridTemplateColumns: `36px repeat(${EXCHANGES.length}, 1fr)` }}
      >
        <div />
        {EXCHANGES.map(ex => (
          <div key={ex} className="tcfh-col-head">{ex}</div>
        ))}

        {TOKENS.map(token => (
          <Fragment key={token}>
            <div className="tcfh-row-head">{token}</div>
            {EXCHANGES.map(exchange => {
              const rate = grid[token]?.[exchange]
              return (
                <div key={`${token}-${exchange}`}>
                  {loading ? (
                    <div className="tcw-shimmer tcfh-skeleton" />
                  ) : rate != null ? (
                    <div
                      className="tcfh-cell"
                      style={{ background: rateToColor(rate), border: highlightBorder(rate) }}
                    >
                      {`${rate >= 0 ? '+' : ''}${rate.toFixed(3)}%`}
                    </div>
                  ) : (
                    <div className="tcfh-cell tcfh-cell--empty">—</div>
                  )}
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
