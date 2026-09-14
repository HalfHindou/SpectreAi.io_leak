/**
 * YouMarketFlows — Market flows summary widget.
 * Shows funding rates, 24h liquidation bar, and net flow categories.
 *
 * Funding rates + OI fetched live from the Spectre market bridge with shimmer
 * skeleton until data arrives. Flow categories stay as static seed data because
 * no live source exists yet.
 *
 * Remix modes: dashboard (default), funding-only, summary
 */
import { useState, useEffect, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { getSpectreFundingRates, getSpectreOpenInterest } from '@/services/spectreMarketApi'

// 2026-05-26 beta-quality fix: removed MOCK_FLOWS (fabricated ETF/exchange/whale net flow numbers).
// Net-flow categories now render empty until /v1/market/flows/categories exists.
const MOCK_FLOWS = []

const REFRESH_INTERVAL = 30_000
const REMIX_MODES = ['dashboard', 'funding-only', 'summary']
const STORAGE_KEY = 'spectre:you-remix-you-market-flows'

export default function YouMarketFlows() {
  const [funding, setFunding] = useState([])
  const [liquidations, setLiquidations] = useState({ longs24h: 0, shorts24h: 0, unit: 'M', bias: 'longs' })
  const [flowCategories] = useState(MOCK_FLOWS)
  const [loading, setLoading] = useState(true)
  const [remix, setRemix] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || 'dashboard' } catch { return 'dashboard' }
  })

  const cycleRemix = () => {
    const next = REMIX_MODES[(REMIX_MODES.indexOf(remix) + 1) % REMIX_MODES.length]
    setRemix(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch {}
  }

  const fetchData = useCallback(async () => {
    // Try funding rates
    try {
      const data = await getSpectreFundingRates()
      const rows = Array.isArray(data?.rows) ? data.rows : []
      if (rows.length > 0) {
        const mapped = rows.slice(0, 5).map(d => ({
          symbol: d.symbol || d.asset || '???',
          rate: d.rate ?? d.fundingRate ?? d.weighted_funding_rate ?? 0,
          label: (d.rate ?? d.fundingRate ?? d.weighted_funding_rate ?? 0) >= 0 ? 'Longs pay' : 'Shorts pay',
          healthy: Math.abs(d.rate ?? d.fundingRate ?? d.weighted_funding_rate ?? 0) < 0.05,
        }))
        if (mapped.length >= 2) setFunding(mapped)
      }
    } catch { /* keep mock */ }

    // Try OI data
    try {
      const data = await getSpectreOpenInterest()
      const btc = Array.isArray(data?.rows) ? data.rows.find((row) => row.asset === 'BTC') : null
      if (btc) {
        const longs24h = Number(btc.long_liq_24h ?? btc.long_liq_24h_usd ?? 0) / 1e6
        const shorts24h = Number(btc.short_liq_24h ?? btc.short_liq_24h_usd ?? 0) / 1e6
        if (longs24h || shorts24h) {
          setLiquidations({
            longs24h: Math.round(longs24h),
            shorts24h: Math.round(shorts24h),
            unit: 'M',
            bias: longs24h >= shorts24h ? 'longs' : 'shorts',
          })
        }
      }
    } catch { /* keep prior state */ }

    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  useAdaptivePolling(fetchData, { interval: REFRESH_INTERVAL })

  const totalLiq = liquidations.longs24h + liquidations.shorts24h
  const longPct = totalLiq > 0 ? (liquidations.longs24h / totalLiq) * 100 : 0
  const shortPct = totalLiq > 0 ? (liquidations.shorts24h / totalLiq) * 100 : 0

  if (loading && funding.length === 0) {
    return (
      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', gap: 10, padding: '2px 0' }}>
        <button className="you-remix-btn" onClick={cycleRemix}>{remix}</button>
        <div className="you-shimmer" style={{ height: 14, width: 80, borderRadius: 4 }} />
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 1, 2].map(i => (
            <div key={i} className="you-shimmer" style={{ flex: 1, height: 52, borderRadius: 10 }} />
          ))}
        </div>
        <div className="you-shimmer" style={{ height: 14, width: 100, borderRadius: 4, marginTop: 4 }} />
        <div className="you-shimmer" style={{ height: 8, borderRadius: 4 }} />
        <div className="you-shimmer" style={{ height: 14, width: 80, borderRadius: 4, marginTop: 4 }} />
        {[0, 1, 2].map(i => (
          <div key={i} className="you-shimmer" style={{ height: 26, borderRadius: 8 }} />
        ))}
      </div>
    )
  }

  // ── Summary Mode ──
  if (remix === 'summary') {
    const avgRate = funding.length > 0 ? funding.reduce((s, f) => s + f.rate, 0) / funding.length : 0
    const netBias = avgRate >= 0 ? 'NET LONG' : 'NET SHORT'
    const biasColor = avgRate >= 0 ? 'var(--bull)' : 'var(--bear)'
    return (
      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12, padding: '2px 0' }}>
        <button className="you-remix-btn" onClick={cycleRemix}>{remix}</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <SummaryChip label="Bias" value={netBias} color={biasColor} />
          <SummaryChip label="Avg Funding" value={`${(avgRate * 100).toFixed(4)}%`} color={avgRate >= 0 ? 'var(--bull)' : 'var(--bear)'} />
          <SummaryChip label="Liq Bias" value={liquidations.bias === 'longs' ? 'Longs' : 'Shorts'} color={liquidations.bias === 'longs' ? 'var(--bull)' : 'var(--bear)'} />
        </div>
      </div>
    )
  }

  // ── Funding-Only Mode ──
  if (remix === 'funding-only') {
    return (
      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 0' }}>
        <button className="you-remix-btn" onClick={cycleRemix}>{remix}</button>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          Funding Rates
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {funding.map(f => {
            const isPositive = f.rate > 0
            const color = isPositive ? 'var(--bull)' : 'var(--bear)'
            return (
              <div key={f.symbol} style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.04)',
              }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {f.symbol}
                </span>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600, color }}>
                    {isPositive ? '+' : ''}{(f.rate * 100).toFixed(4)}%
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>
                    {f.label}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Dashboard Mode (default) ──
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      height: '100%',
      padding: '2px 0',
      position: 'relative',
    }}>
      <button className="you-remix-btn" onClick={cycleRemix}>{remix}</button>

      {/* Funding Rates */}
      <div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6 }}>
          Funding Rates
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {funding.map(f => {
            const isPositive = f.rate > 0
            const color = isPositive ? 'var(--bull)' : 'var(--bear)'
            return (
              <div key={f.symbol} style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                padding: '6px 4px',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.04)',
              }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {f.symbol}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color }}>
                  {isPositive ? '+' : ''}{(f.rate * 100).toFixed(4)}%
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                  {f.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* 24h Liquidations */}
      <div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6 }}>
          24h Liquidations
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--bull)' }}>
            ${liquidations.longs24h}{liquidations.unit} Longs
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--bear)' }}>
            Shorts ${liquidations.shorts24h}{liquidations.unit}
          </span>
        </div>
        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'rgba(255,255,255,0.03)' }}>
          <div style={{ width: `${longPct}%`, background: 'var(--bull)', borderRadius: '4px 0 0 4px', transition: 'width 0.3s ease' }} />
          <div style={{ width: `${shortPct}%`, background: 'var(--bear)', borderRadius: '0 4px 4px 0', transition: 'width 0.3s ease' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>{longPct.toFixed(1)}%</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>{shortPct.toFixed(1)}%</span>
        </div>
      </div>

      {/* Net Flows — wired live: hidden until a feed exists.
          Was rendering 3 hardcoded category $ values (ETPs/ETFs +$646M,
          Exchange -$291M, Whale Wallets -$291M) that never changed
          between sessions. Stale data on a "live" widget. */}
      {false && (
      <div style={{ flex: 1, minHeight: 0 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 6 }}>
          Net Flows
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {flowCategories.map(cat => {
            const isPositive = cat.net >= 0
            const netColor = isPositive ? 'var(--bull)' : 'var(--bear)'
            return (
              <div key={cat.label} style={{
                display: 'flex',
                alignItems: 'center',
                padding: '6px 8px',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.04)',
              }}>
                <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cat.label}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--bull)', width: 56, textAlign: 'right' }}>
                  +${cat.inflow}M
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--bear)', width: 56, textAlign: 'right' }}>
                  -${cat.outflow}M
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: netColor, width: 60, textAlign: 'right' }}>
                  {isPositive ? '+' : ''}{cat.net}M
                </span>
              </div>
            )
          })}
        </div>
      </div>
      )}
    </div>
  )
}

function SummaryChip({ label, value, color }) {
  return (
    <div style={{
      flex: 1,
      background: 'rgba(255,255,255,0.03)',
      borderRadius: 10,
      padding: '8px 10px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 2,
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color, textTransform: 'uppercase' }}>
        {value}
      </span>
    </div>
  )
}
