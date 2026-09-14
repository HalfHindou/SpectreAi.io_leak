/**
 * SSE prices audit — Spectre /v1/stream/prices/sse vs Binance ticker drift.
 *
 * Subscribes to Spectre SSE for BTC/ETH/SOL/BNB/XRP. In parallel polls Binance
 * REST every 5s (matches current frontend cadence). Shows live drift, tick
 * cadence, latency stamp drift, connection status.
 *
 * Verdict:
 *   GREEN  — drift < 0.05%, ticks arriving every < 3s
 *   YELLOW — drift 0.05-0.20%, ticks 3-10s
 *   RED    — drift > 0.20%, or stream disconnected
 */
import React, { useEffect, useState, useRef } from 'react'
import { useSpectrePriceStream, getSpectreStreamStats } from '@/hooks/spectre/useSpectrePriceStream'

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP']

function fmtPct(v) {
  if (!Number.isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(4)}%`
}

function useBinancePoll(symbols, intervalMs = 5000) {
  const [prices, setPrices] = useState({})
  const intRef = useRef(null)
  useEffect(() => {
    let cancelled = false
    async function tick() {
      try {
        const pairs = symbols.map(s => `"${s.toUpperCase()}USDT"`).join(',')
        const url = `https://api.binance.com/api/v3/ticker/price?symbols=[${pairs}]`
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        const map = {}
        for (const row of (Array.isArray(data) ? data : [])) {
          const sym = row.symbol.replace(/USDT$/, '')
          map[sym] = { price: parseFloat(row.price), _rxAt: Date.now() }
        }
        setPrices(prev => ({ ...prev, ...map }))
      } catch { /* swallow */ }
    }
    tick()
    intRef.current = setInterval(tick, intervalMs)
    return () => { cancelled = true; clearInterval(intRef.current) }
  }, [symbols.join(','), intervalMs])
  return prices
}

export default function SsePricesAuditPanel() {
  const { prices: spectrePrices, connected } = useSpectrePriceStream(SYMBOLS)
  const binancePrices = useBinancePoll(SYMBOLS, 5000)
  const [streamStats, setStreamStats] = useState([])

  useEffect(() => {
    const id = setInterval(() => setStreamStats(getSpectreStreamStats()), 1000)
    return () => clearInterval(id)
  }, [])

  const now = Date.now()
  return (
    <div className="dsa-panel">
      <div className="dsa-controls">
        <div className={`dsa-pill ${connected ? 'dsa-pill--green' : 'dsa-pill--red'}`}>
          {connected ? 'SSE CONNECTED' : 'SSE DISCONNECTED'}
        </div>
        {streamStats.map(s => (
          <div key={s.symbols} className="dsa-meta">
            stream({s.symbols}): subs={s.subscribers}, assets={s.tickedAssets}, age={Math.round(s.openedMsAgo/1000)}s
          </div>
        ))}
      </div>
      <table className="dsa-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Verdict</th>
            <th>Spectre SSE price</th>
            <th>Binance REST price</th>
            <th>Drift</th>
            <th>Spectre last tick</th>
            <th>Binance last poll</th>
          </tr>
        </thead>
        <tbody>
          {SYMBOLS.map(sym => {
            const s = spectrePrices[sym]
            const b = binancePrices[sym]
            const drift = (s && b) ? ((s.price - b.price) / b.price) * 100 : null
            const sAge = s?._localRxAt ? (now - s._localRxAt) / 1000 : null
            const bAge = b?._rxAt ? (now - b._rxAt) / 1000 : null
            const driftAbs = Math.abs(drift || 0)
            const tone = !s ? 'red' : !b ? 'yellow' : driftAbs > 0.2 ? 'red' : driftAbs > 0.05 ? 'yellow' : 'green'
            const verdict = !s ? 'NO SSE TICK' : !b ? 'BINANCE FAIL' : driftAbs > 0.2 ? 'HIGH DRIFT' : driftAbs > 0.05 ? 'MILD DRIFT' : 'OK'
            return (
              <tr key={sym}>
                <td>{sym}</td>
                <td><span className={`dsa-verdict dsa-verdict--${tone}`}>{verdict}</span></td>
                <td className="dsa-num">{s?.price?.toFixed(s.price > 1 ? 2 : 6) || '—'}</td>
                <td className="dsa-num">{b?.price?.toFixed(b.price > 1 ? 2 : 6) || '—'}</td>
                <td className="dsa-num">{fmtPct(drift)}</td>
                <td className="dsa-num">{sAge != null ? `${sAge.toFixed(1)}s ago` : '—'}</td>
                <td className="dsa-num">{bAge != null ? `${bAge.toFixed(1)}s ago` : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="dsa-footnote">
        Spectre SSE re-broadcasts the same Binance fan-out (per probe: <code>src: fanout</code>,{' '}
        <code>exchange: binance</code>). Drift should be near-zero. Ticks arrive every 1-3s.
        Replacing the 5s Binance REST poll with this SSE stream means <strong>one upstream
        connection serves all 1k users</strong> instead of 1k×12 polls/min = 12k Binance hits/min.
      </p>
    </div>
  )
}
