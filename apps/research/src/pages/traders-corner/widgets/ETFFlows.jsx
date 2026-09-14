/**
 * W-021 · ETF Flows Widget
 * Daily ETF inflow/outflow per fund with net daily total badge.
 * Uses simulated data with realistic BTC ETF fund names.
 */
import { useState, useEffect, useCallback } from 'react'
import './ETFFlows.css'

/* ---------- helpers ---------- */

function formatAbbrev(raw) {
  const num = Number(raw)
  if (!num || isNaN(num)) return '—'
  const abs = Math.abs(num)
  const sign = num >= 0 ? '+' : '-'
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

function formatAUM(raw) {
  const num = Number(raw)
  if (!num || isNaN(num)) return '—'
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`
  if (num >= 1e6) return `$${(num / 1e6).toFixed(0)}M`
  return `$${num.toLocaleString()}`
}

// Demo data — no live ETF-flow API is wired (Farside/SoSoValue are paid).
// Flows are fixed representative values so the widget is deterministic.
const FUNDS = [
  { name: 'iShares Bitcoin Trust', ticker: 'IBIT', issuer: 'BlackRock', aum: 52.3e9, flow: 184e6 },
  { name: 'Wise Origin BTC Fund', ticker: 'FBTC', issuer: 'Fidelity', aum: 18.7e9, flow: 42e6 },
  { name: 'Grayscale BTC Trust', ticker: 'GBTC', issuer: 'Grayscale', aum: 22.1e9, flow: -67e6 },
  { name: 'ARK 21Shares Bitcoin', ticker: 'ARKB', issuer: 'ARK Invest', aum: 4.9e9, flow: 18e6 },
  { name: 'Bitwise BTC ETF', ticker: 'BITB', issuer: 'Bitwise', aum: 3.2e9, flow: 9e6 },
]

function generateETFData() {
  return FUNDS.map(fund => ({ ...fund }))
}

/* ---------- component ---------- */

export default function ETFFlows() {
  const [data, setData] = useState(null)

  const refresh = useCallback(() => {
    setData(generateETFData())
  }, [])

  useEffect(() => {
    const t = setTimeout(refresh, 500)
    return () => { clearTimeout(t) }
  }, [refresh])

  const netDaily = data ? data.reduce((s, d) => s + d.flow, 0) : 0
  const netPositive = netDaily >= 0

  return (
    <div className="tcetf">
      {/* Header with net daily badge */}
      {!data ? (
        <div className="tcw-shimmer tcetf-skeleton-head" />
      ) : (
        <div className="tcetf-head">
          <span className="tcetf-head-label">Daily Net</span>
          <span className={`tcetf-net ${netPositive ? 'tcetf-net--bull' : 'tcetf-net--bear'}`}>
            {formatAbbrev(netDaily)}
          </span>
        </div>
      )}

      {/* Divider */}
      <div className="tcw-divider" />

      {/* Fund rows */}
      <div className="tcetf-list">
        {!data ? (
          Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="tcw-shimmer tcetf-skeleton-row" />
          ))
        ) : (
          data.map((fund) => {
            const positive = fund.flow >= 0
            return (
              <div
                key={fund.ticker}
                className={`tcetf-row${!positive ? ' tcetf-row--negative' : ''}`}
              >
                {/* Fund name + ticker */}
                <div className="tcetf-fund">
                  <div className="tcetf-fund-name">{fund.name}</div>
                  <div className="tcetf-fund-meta">{fund.ticker} · {fund.issuer}</div>
                </div>

                {/* Flow amount */}
                <span className={`tcetf-flow ${positive ? 'tcetf-flow--bull' : 'tcetf-flow--bear'}`}>
                  {formatAbbrev(fund.flow)}
                </span>

                {/* AUM */}
                <span className="tcetf-aum">{formatAUM(fund.aum)}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
