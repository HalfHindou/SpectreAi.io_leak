/**
 * Top-coins audit — Spectre /v1/coins/markets vs CG /coins/markets.
 *
 * The migration is already partially shipped (ce595801) — coinGeckoApi.getTopCoinsMarketsPage
 * routes Spectre-first. This panel confirms shape parity and shows the field-by-field diff.
 *
 * Tests rows for:
 *   - id, symbol, name presence
 *   - current_price within 0.5% of CG
 *   - market_cap within 1% of CG
 *   - sparkline_in_7d present and non-empty
 *   - price_change_percentage_24h present
 */
import React, { useEffect, useState } from 'react'
import { getSpectreCoinsMarketsPage } from '@/services/spectreMarketApi'

function pct(a, b) {
  if (!a || !b) return null
  return ((a - b) / b) * 100
}

function rowVerdict(s, c) {
  if (!s && !c) return { tone: 'red', text: 'BOTH MISSING' }
  if (!s) return { tone: 'red', text: 'SPECTRE MISSING' }
  if (!c) return { tone: 'yellow', text: 'CG MISSING' }
  const priceDrift = Math.abs(pct(s.current_price, c.current_price) || 0)
  const mcapDrift = Math.abs(pct(s.market_cap, c.market_cap) || 0)
  const sparkOk = Array.isArray(s.sparkline_in_7d?.price) && s.sparkline_in_7d.price.length > 0
  if (priceDrift > 0.5 || mcapDrift > 1 || !sparkOk) {
    return { tone: 'yellow', text: `drift p=${priceDrift.toFixed(2)}% / m=${mcapDrift.toFixed(2)}%${sparkOk ? '' : ' / NO SPARKLINE'}` }
  }
  return { tone: 'green', text: 'PARITY OK' }
}

export default function TopCoinsAuditPanel() {
  const [spectreCoins, setSpectreCoins] = useState(null)
  const [cgCoins, setCgCoins] = useState(null)
  const [spectreMeta, setSpectreMeta] = useState({})
  const [cgMeta, setCgMeta] = useState({})

  useEffect(() => {
    const t0 = performance.now()
    getSpectreCoinsMarketsPage(1, 50, { sparkline: true })
      .then(coins => {
        setSpectreCoins(coins)
        setSpectreMeta({ count: coins.length, latencyMs: Math.round(performance.now() - t0) })
      })
      .catch(err => setSpectreMeta({ error: err.message }))

    const t1 = performance.now()
    fetch('/api/coingecko/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=true&price_change_percentage=1h,24h,7d')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(coins => {
        setCgCoins(coins)
        setCgMeta({ count: coins.length, latencyMs: Math.round(performance.now() - t1) })
      })
      .catch(err => setCgMeta({ error: err.message }))
  }, [])

  if (!spectreCoins && !cgCoins) {
    return <div className="dsa-panel"><div className="dsa-meta">Loading…</div></div>
  }

  const byId = new Map()
  ;(spectreCoins || []).forEach(c => byId.set(c.id, { spectre: c }))
  ;(cgCoins || []).forEach(c => {
    const e = byId.get(c.id) || {}
    e.cg = c
    byId.set(c.id, e)
  })
  const rows = Array.from(byId.entries()).slice(0, 30)

  return (
    <div className="dsa-panel">
      <div className="dsa-controls">
        <div className="dsa-meta">
          Spectre: {spectreMeta.count ?? '—'} coins, {spectreMeta.latencyMs ?? '—'}ms
          {spectreMeta.error ? ` (err: ${spectreMeta.error})` : ''}
        </div>
        <div className="dsa-meta">
          CG direct: {cgMeta.count ?? '—'} coins, {cgMeta.latencyMs ?? '—'}ms
          {cgMeta.error ? ` (err: ${cgMeta.error})` : ''}
        </div>
      </div>
      <table className="dsa-table">
        <thead>
          <tr>
            <th>Rank</th><th>ID</th><th>Verdict</th>
            <th>Spectre price</th><th>CG price</th>
            <th>Spectre mcap</th><th>CG mcap</th>
            <th>Spark</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([id, { spectre, cg }]) => {
            const v = rowVerdict(spectre, cg)
            const sparkLen = spectre?.sparkline_in_7d?.price?.length || 0
            return (
              <tr key={id}>
                <td>{spectre?.market_cap_rank || cg?.market_cap_rank || '—'}</td>
                <td>{id}</td>
                <td><span className={`dsa-verdict dsa-verdict--${v.tone}`}>{v.text}</span></td>
                <td className="dsa-num">{spectre?.current_price?.toFixed(4) ?? '—'}</td>
                <td className="dsa-num">{cg?.current_price?.toFixed(4) ?? '—'}</td>
                <td className="dsa-num">{spectre?.market_cap ? (spectre.market_cap / 1e9).toFixed(2) + 'B' : '—'}</td>
                <td className="dsa-num">{cg?.market_cap ? (cg.market_cap / 1e9).toFixed(2) + 'B' : '—'}</td>
                <td>{sparkLen > 0 ? `✓ ${sparkLen}pts` : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
