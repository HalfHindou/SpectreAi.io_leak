/**
 * W-040 · Positions Widget
 * Open positions table with token, side badge, leverage, entry/current, P&L.
 * Uses simulated realistic leveraged positions.
 */
import { useState, useEffect, useCallback } from 'react'
import './Positions.css'

/* ---------- helpers ---------- */

function formatPrice(raw) {
  const price = Number(raw)
  if (!price || isNaN(price)) return '—'
  if (price >= 1000) return `$${price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  if (price >= 1) return `$${price.toFixed(2)}`
  return `$${price.toFixed(4)}`
}

function formatPnL(raw) {
  const num = Number(raw)
  if (!num || isNaN(num)) return '$0'
  const abs = Math.abs(num)
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(1)}K`
  return `$${abs.toFixed(0)}`
}

// Demo positions (no wallet/exchange source wired). `drift` is a fixed current
// vs entry move per row so the table is deterministic instead of flickering.
const BASE_POSITIONS = [
  { token: 'BTC', side: 'LONG', leverage: 5, entry: 94200, size: 2.1, drift: 0.042 },
  { token: 'ETH', side: 'SHORT', leverage: 3, entry: 3420, size: 15.5, drift: -0.028 },
  { token: 'SOL', side: 'LONG', leverage: 10, entry: 178.50, size: 120, drift: 0.061 },
  { token: 'AVAX', side: 'LONG', leverage: 5, entry: 42.30, size: 350, drift: -0.015 },
]

function generatePositions() {
  return BASE_POSITIONS.map(pos => {
    const current = pos.entry * (1 + pos.drift)

    // Guard against a malformed (zero) entry that would produce NaN P&L.
    const direction = pos.side === 'LONG' ? 1 : -1
    const pctChange = pos.entry > 0 ? ((current - pos.entry) / pos.entry) * direction : 0
    const pnlPct = pctChange * pos.leverage * 100
    const pnlUsd = pos.entry * pos.size * pctChange * pos.leverage

    return {
      ...pos,
      current,
      pnlPct,
      pnlUsd,
      positive: pnlUsd >= 0,
    }
  })
}

/* ---------- component ---------- */

export default function Positions() {
  const [data, setData] = useState(null)

  const refresh = useCallback(() => {
    setData(generatePositions())
  }, [])

  useEffect(() => {
    const t = setTimeout(refresh, 400)
    return () => { clearTimeout(t) }
  }, [refresh])

  return (
    <div className="tcpos">
      {/* Column headers */}
      <div className="tcpos-head">
        <span className="tcpos-th tcpos-th--pos">
          Position
        </span>
        <span className="tcpos-th tcpos-th--mid">
          Entry / Current
        </span>
        <span className="tcpos-th tcpos-th--pnl">
          P&L $
        </span>
        <span className="tcpos-th tcpos-th--pct">
          P&L %
        </span>
      </div>

      {/* Rows */}
      <div className="tcpos-rows">
        {!data ? (
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="tcw-shimmer tcpos-skeleton" />
          ))
        ) : (
          data.map((pos) => {
            const isLong = pos.side === 'LONG'
            return (
              <div
                key={`${pos.token}-${pos.side}`}
                className={`tcpos-row ${pos.positive ? 'tcpos-row--bull' : 'tcpos-row--bear'}`}
              >
                {/* Token + Side + Leverage */}
                <div className="tcpos-cell-pos">
                  <span className="tcpos-token">{pos.token}</span>
                  <span className={`tcpos-side ${isLong ? 'tcpos-side--long' : 'tcpos-side--short'}`}>{pos.side}</span>
                  <span className="tcpos-lev">{pos.leverage}x</span>
                </div>

                {/* Entry / Current */}
                <div className="tcpos-cell-mid">
                  <div className="tcpos-entry">{formatPrice(pos.entry)}</div>
                  <div className="tcpos-current">{formatPrice(pos.current)}</div>
                </div>

                {/* P&L $ */}
                <div className={`tcpos-pnl ${pos.positive ? 'tcpos-pnl--bull' : 'tcpos-pnl--bear'}`}>
                  {pos.positive ? '+' : '-'}{formatPnL(pos.pnlUsd)}
                </div>

                {/* P&L % */}
                <div className={`tcpos-pct ${pos.positive ? 'tcpos-pct--bull' : 'tcpos-pct--bear'}`}>
                  {pos.positive ? '▲' : '▼'} {Math.abs(Number(pos.pnlPct) || 0).toFixed(1)}%
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
