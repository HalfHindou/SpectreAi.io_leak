/**
 * Chart bars audit — Spectre /v1/candles vs Codex getBars (current chart source).
 *
 * Fetches both for the same token+resolution, computes parity metrics:
 *   - bar count
 *   - last-bar drift (close price delta)
 *   - flat-bar ratio (sparse OHLC = unreliable for candles)
 *   - latency
 *   - meta.source (Spectre tells us if it's candles_1m, price_history_daily, etc.)
 *
 * Verdict logic:
 *   GREEN  — Spectre source = candles_1m, flat ratio < 0.05, last-bar drift < 0.5%
 *   YELLOW — minor drift OR partial coverage
 *   RED    — Spectre returned price_history_daily, flat ratio > 0.5, or empty
 */
import React, { useState, useEffect, useRef } from 'react'
import { useSpectreChartData } from '@/hooks/spectre/useSpectreChartData'
import { useChartData } from '@/hooks/codex/useChartData'

const TOKENS = [
  { symbol: 'BTC', label: 'BTC (Binance major)', networkId: 1, expectGreen: true },
  { symbol: 'ETH', label: 'ETH (Binance major)', networkId: 1, expectGreen: true },
  { symbol: 'SOL', label: 'SOL (Binance major)', networkId: 1, expectGreen: true },
  { symbol: 'PEPE', label: 'PEPE (large meme)', networkId: 1, expectGreen: true },
  { symbol: 'SPECTRE', label: 'SPECTRE (DEX-primary)', networkId: 1, expectGreen: false, note: 'DEX-primary — expected RED on Spectre (price_history_daily)' },
]

const RESOLUTIONS = ['1', '5', '15', '60', '240', '1D']

function fmt(n, digits = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  if (Math.abs(v) >= 1) return v.toFixed(digits)
  return v.toPrecision(4)
}

function pct(a, b) {
  if (!a || !b) return null
  return ((a - b) / b) * 100
}

// Calibrated verdict (2026-05-15 — initial threshold of 0.5 was too lenient
// for sparse-OHLC DEX tokens like SPECTRE which run 40%+ flat-bar ratio).
//
// Bands by flat_ratio (fraction of bars where o == h == l == c, meaning no
// real price action in the bucket — renders as flat dots on candlestick):
//   <  5%  → GREEN  — candle-mode safe
//   5-25%  → YELLOW — candle-mode degrades; line-mode recommended
//   > 25%  → RED    — candle-mode unusable; line-mode required
//
// Bands by drift (|Spectre close − Codex close| / Codex close):
//   < 0.5% → GREEN
//   < 2.0% → YELLOW
//   ≥ 2.0% → RED
//
// Codex falling back to `coingecko-chart` means the production code already
// gave up on Codex for this token. That is "Codex N/A" — Spectre wins by
// default if its data is acceptable.
function verdict({ spectre, codex }) {
  if (!spectre?.bars?.length && !codex?.bars?.length) {
    return { tone: 'red', text: 'BOTH EMPTY', mode: 'none' }
  }
  if (!spectre?.bars?.length) {
    return { tone: 'red', text: 'SPECTRE EMPTY', mode: 'codex-only' }
  }

  const sSource = spectre.meta?.source || ''
  const sFlat = spectre.meta?.flatRatio ?? 0
  const codexFellBack = codex.chartSource === 'coingecko-chart'
  const codexEmpty = !codex.bars?.length

  // Hard-fail conditions on Spectre data quality.
  if (sSource === 'price_history_daily') {
    return { tone: 'red', text: `DAILY-FALLBACK (${sSource})`, mode: 'line', sparse: true }
  }
  if (sFlat > 0.25) {
    return { tone: 'red', text: `SPARSE flat=${(sFlat * 100).toFixed(0)}%`, mode: 'line', sparse: true }
  }
  if (sFlat > 0.05) {
    // Spectre has acceptable data but candle rendering will look noisy.
    return { tone: 'yellow', text: `flat=${(sFlat * 100).toFixed(0)}% — use line`, mode: 'line', sparse: true }
  }

  // Drift check — but only meaningful if Codex actually returned Codex bars.
  if (codexEmpty || codexFellBack) {
    return { tone: 'green', text: `OK — Codex N/A (${codex.chartSource || 'empty'})`, mode: 'candle' }
  }

  const sLast = spectre.bars[spectre.bars.length - 1]?.close
  const cLast = codex.bars[codex.bars.length - 1]?.close
  const drift = Math.abs(pct(sLast, cLast) || 0)
  if (drift >= 2) return { tone: 'red', text: `HIGH DRIFT ${drift.toFixed(2)}%`, mode: 'candle' }
  if (drift >= 0.5) return { tone: 'yellow', text: `DRIFT ${drift.toFixed(2)}%`, mode: 'candle' }
  return { tone: 'green', text: 'PARITY OK', mode: 'candle' }
}

// Capture mount → first-data-arrival timing for the existing useChartData
// hook (which doesn't return latency). We watch bars.length flip 0 → >0 and
// record the elapsed ms. This isn't strict fetch latency — it includes any
// internal fallback chain useChartData walks (binance → onchain → spectre →
// codex → CG line) which IS the user-visible latency we want to measure.
function useCodexChartLatency(symbol, resolution, bars, loading) {
  const startedAtRef = useRef(null)
  const capturedRef = useRef(null)
  const symKeyRef = useRef(`${symbol}|${resolution}`)
  const [latencyMs, setLatencyMs] = useState(null)

  useEffect(() => {
    const key = `${symbol}|${resolution}`
    if (key !== symKeyRef.current) {
      // Symbol or resolution changed — reset.
      symKeyRef.current = key
      startedAtRef.current = performance.now()
      capturedRef.current = null
      setLatencyMs(null)
      return
    }
    if (startedAtRef.current == null) startedAtRef.current = performance.now()
    if (capturedRef.current == null && bars?.length > 0 && !loading) {
      capturedRef.current = Math.round(performance.now() - startedAtRef.current)
      setLatencyMs(capturedRef.current)
    }
  }, [symbol, resolution, bars, loading])

  return latencyMs
}

function Row({ token, resolution }) {
  const periodHours = resolution === '1D' ? 24 * 90 : resolution === '240' ? 24 * 30 : 168
  const spectre = useSpectreChartData(token.symbol, resolution, periodHours)
  const codex = useChartData(token.symbol, resolution, token.networkId, periodHours, null, token.symbol, null)
  const codexLatency = useCodexChartLatency(token.symbol, resolution, codex.bars, codex.loading)

  const v = verdict({ spectre, codex })
  const sLast = spectre.bars?.length ? spectre.bars[spectre.bars.length - 1] : null
  const cLast = codex.bars?.length ? codex.bars[codex.bars.length - 1] : null

  return (
    <tr>
      <td className="dsa-token-cell">
        <div className="dsa-token-sym">{token.symbol}</div>
        <div className="dsa-token-note">{token.label}</div>
      </td>
      <td>
        <span className={`dsa-verdict dsa-verdict--${v.tone}`}>{v.text}</span>
        {v.mode && v.mode !== 'none' && (
          <div className="dsa-meta">render: <strong>{v.mode}</strong></div>
        )}
      </td>
      <td>
        <div>{spectre.loading ? '…' : `${spectre.bars?.length || 0} bars`}</div>
        <div className="dsa-meta">{spectre.meta?.source || (spectre.error ? `err: ${spectre.error}` : '—')}</div>
        <div className="dsa-meta">flat: {((spectre.meta?.flatRatio || 0) * 100).toFixed(0)}%</div>
      </td>
      <td>
        <div>{codex.loading ? '…' : `${codex.bars?.length || 0} bars`}</div>
        <div className="dsa-meta">src: {codex.chartSource || '—'}</div>
        <div className="dsa-meta">{codex.error || ''}</div>
      </td>
      <td className="dsa-num">{fmt(sLast?.close, 6)}</td>
      <td className="dsa-num">{fmt(cLast?.close, 6)}</td>
      <td className="dsa-num">{fmt(pct(sLast?.close, cLast?.close), 3)}%</td>
      <td className="dsa-num">{spectre.meta?.clientLatencyMs ?? '—'}ms / {codexLatency != null ? `${codexLatency}ms` : '—'}</td>
    </tr>
  )
}

export default function ChartAuditPanel() {
  const [resolution, setResolution] = useState('60')
  return (
    <div className="dsa-panel">
      <div className="dsa-controls">
        <label className="dsa-control">
          <span>Resolution</span>
          <select value={resolution} onChange={e => setResolution(e.target.value)}>
            {RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <div className="dsa-legend">
          <span className="dsa-verdict dsa-verdict--green">PARITY OK</span>
          <span className="dsa-verdict dsa-verdict--yellow">DRIFT / PARTIAL</span>
          <span className="dsa-verdict dsa-verdict--red">SPARSE / EMPTY</span>
        </div>
      </div>
      <table className="dsa-table">
        <thead>
          <tr>
            <th>Token</th>
            <th>Verdict</th>
            <th>Spectre bars</th>
            <th>Codex bars</th>
            <th>Spectre last close</th>
            <th>Codex last close</th>
            <th>Drift</th>
            <th>Latency (S / C)</th>
          </tr>
        </thead>
        <tbody>
          {TOKENS.map(t => <Row key={t.symbol} token={t} resolution={resolution} />)}
        </tbody>
      </table>
      <p className="dsa-footnote">
        Verdict bands (calibrated 2026-05-15):{' '}
        flat&lt;5% & drift&lt;0.5% → <strong>GREEN</strong> (candle-mode safe);{' '}
        flat 5-25% OR drift 0.5-2% → <strong>YELLOW</strong> (line-mode recommended);{' '}
        flat&gt;25% OR drift&gt;2% OR <code>price_history_daily</code> → <strong>RED</strong>.{' '}
        The <em>render</em> hint under each verdict tells the production code which mode to
        use after migration — <code>candle</code> for full OHLC, <code>line</code> for
        sparse-bucket tokens. This mirrors <code>useChartData.js:18</code>{' '}
        (<code>FLAT_BAR_THRESHOLD = 0.4</code>) but with a tighter threshold sized for
        Spectre output. Codex <code>chartSource = coingecko-chart</code> means production
        already gave up on Codex for that token — Spectre wins by default if its data is
        acceptable.
      </p>
    </div>
  )
}
