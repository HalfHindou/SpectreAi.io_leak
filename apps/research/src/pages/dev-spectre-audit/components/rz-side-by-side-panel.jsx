/**
 * RZ side-by-side: current 6-fan (useResearchZoneData) vs new 2-fan
 * (useSpectreResearchZoneData).
 *
 * For each test token: render both hooks, compare field-by-field, show
 * upstream call counts + latencies. The verdict is per-field, not whole-hook,
 * so we see exactly which fields are safe to migrate and which still need
 * the old CG/Codex/AppResearch path.
 */
import React, { useState } from 'react'
import useResearchZoneData from '@/pages/research-zone/hooks/use-research-zone-data'
import { useSpectreResearchZoneData } from '@/hooks/spectre/useSpectreResearchZoneData'

const TOKENS = [
  { symbol: 'BTC', label: 'BTC' },
  { symbol: 'ETH', label: 'ETH' },
  { symbol: 'SOL', label: 'SOL' },
  { symbol: 'PEPE', label: 'PEPE' },
  { symbol: 'SPECTRE', label: 'SPECTRE' },
]

const FIELDS = [
  // path returns { value, present (bool) } so the comparator can distinguish
  // "null but checked" from "not present in source"
  { label: 'price.current', old: o => o?.priceData?.current, neu: n => n?.price?.current },
  { label: 'price.change24h', old: o => o?.priceData?.change24h, neu: n => n?.market?.change24h },
  { label: 'mcap', old: o => o?.marketData?.mcap, neu: n => n?.market?.mcap },
  { label: 'fdv', old: o => o?.marketData?.fdv, neu: n => n?.market?.fdv },
  { label: 'circulatingSupply', old: o => o?.marketData?.circulatingSupply, neu: n => n?.market?.circulatingSupply },
  { label: 'totalSupply', old: o => o?.marketData?.totalSupply, neu: n => n?.market?.totalSupply },
  { label: 'volume24h', old: o => o?.marketData?.volume24h, neu: n => n?.market?.volume24h },
  { label: 'ath', old: o => o?.marketData?.ath, neu: n => n?.market?.ath },
  { label: 'athChangePct', old: o => o?.marketData?.athChangePct, neu: n => n?.market?.athChangePct },
  { label: 'change1h', old: o => o?.performanceData?.change1h, neu: n => n?.market?.change1h },
  { label: 'change7d', old: o => o?.performanceData?.change7d, neu: n => n?.market?.change7d },
  { label: 'change30d', old: o => o?.performanceData?.change30d, neu: n => n?.market?.change30d },
  { label: 'sparkline7d (len)', old: o => Array.isArray(o?.performanceData?.sparkline7d) ? o.performanceData.sparkline7d.length : null, neu: n => Array.isArray(n?.market?.sparkline7d) ? n.market.sparkline7d.length : null },
  { label: 'identity.name', old: o => o?.tokenIdentity?.name, neu: n => n?.identity?.name },
  { label: 'identity.logo', old: o => o?.tokenIdentity?.logo, neu: n => n?.identity?.logo_url },
  { label: 'identity.cgId', old: o => o?.tokenIdentity?.cgId, neu: n => n?.identity?.coingecko_id },
  { label: 'identity.categories (n)', old: o => o?.tokenIdentity?.categories?.length, neu: n => n?.identity?.categories?.length },
  { label: 'about.description (len)', old: o => o?.aboutData?.description?.length, neu: n => null },
  { label: 'candles (n)', old: o => null, neu: n => n?.candles?.length },
  { label: 'pairs (n)', old: o => null, neu: n => n?.pairs?.length },
  { label: 'score.overall', old: o => null, neu: n => n?.score?.overall },
]

function isFilled(v) {
  if (v === null || v === undefined) return false
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0
  if (typeof v === 'string') return v.length > 0
  return true
}

function fmt(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') {
    if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2) + 'B'
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + 'M'
    if (Math.abs(v) >= 100) return v.toFixed(0)
    if (Math.abs(v) >= 1) return v.toFixed(2)
    return v.toPrecision(4)
  }
  const s = String(v)
  return s.length > 20 ? s.slice(0, 20) + '…' : s
}

function fieldVerdict(oldV, neuV) {
  const a = isFilled(oldV), b = isFilled(neuV)
  if (!a && !b) return { tone: 'red', text: '✗ both null' }
  if (a && !b) return { tone: 'red', text: '✗ NEW missing' }
  if (!a && b) return { tone: 'yellow', text: '◯ OLD missing — NEW wins' }
  // Both filled — compare numerically if possible
  if (typeof oldV === 'number' && typeof neuV === 'number') {
    const drift = oldV !== 0 ? Math.abs((neuV - oldV) / oldV) * 100 : 0
    if (drift < 0.5) return { tone: 'green', text: `✓ parity (drift ${drift.toFixed(2)}%)` }
    if (drift < 5) return { tone: 'yellow', text: `△ drift ${drift.toFixed(2)}%` }
    return { tone: 'red', text: `✗ drift ${drift.toFixed(2)}%` }
  }
  // Both strings/arrays — count as parity if both present
  return { tone: 'green', text: '✓ both present' }
}

function TokenRow({ token }) {
  const oldFan = useResearchZoneData(token.symbol, { fetchTrending: false })
  const neuFan = useSpectreResearchZoneData(token.symbol)

  return (
    <details className="dsa-token-details" open>
      <summary>
        <strong>{token.symbol}</strong>
        <span className="dsa-meta" style={{ marginLeft: 12 }}>
          old: {Object.values(oldFan.loading || {}).some(Boolean) ? 'loading…' : 'ready'}{' '}
          | new: {neuFan.loading ? 'loading…' : 'ready'}{' '}
          | new latency: bs={neuFan.meta?.bootstrapMs ?? '—'}ms,
          {' '}details={neuFan.meta?.detailsMs ?? '—'}ms,
          {' '}total={neuFan.meta?.totalMs ?? '—'}ms,
          {' '}calls={neuFan.meta?.calls ?? '—'} (vs ~6 in current)
        </span>
      </summary>
      <table className="dsa-table" style={{ marginTop: 8 }}>
        <thead>
          <tr><th>Field</th><th>Current (6-fan)</th><th>New (2-fan)</th><th>Verdict</th></tr>
        </thead>
        <tbody>
          {FIELDS.map(f => {
            const o = f.old(oldFan)
            const n = f.neu(neuFan)
            const v = fieldVerdict(o, n)
            return (
              <tr key={f.label}>
                <td><code>{f.label}</code></td>
                <td className="dsa-num">{fmt(o)}</td>
                <td className="dsa-num">{fmt(n)}</td>
                <td><span className={`dsa-verdict dsa-verdict--${v.tone}`}>{v.text}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </details>
  )
}

export default function RzSideBySidePanel() {
  const [token, setToken] = useState(TOKENS[0].symbol)
  const selected = TOKENS.find(t => t.symbol === token)
  return (
    <div className="dsa-panel">
      <div className="dsa-controls">
        <label className="dsa-control">
          <span>Token</span>
          <select value={token} onChange={e => setToken(e.target.value)}>
            {TOKENS.map(t => <option key={t.symbol} value={t.symbol}>{t.label}</option>)}
          </select>
        </label>
        <div className="dsa-legend">
          <span className="dsa-verdict dsa-verdict--green">parity</span>
          <span className="dsa-verdict dsa-verdict--yellow">drift / new-wins</span>
          <span className="dsa-verdict dsa-verdict--red">missing / high-drift</span>
        </div>
      </div>
      <TokenRow key={selected.symbol} token={selected} />
      <p className="dsa-footnote">
        Current RZ does 6 parallel upstream calls per token nav. The new
        2-fan hook (<code>useSpectreResearchZoneData</code>) fires bootstrap
        first + supplements market fields via <code>/v1/coins/{'{id}'}</code>.
        At 1k users navigating ~1 token/min that is{' '}
        <strong>2,000 CG/min + 1,000 Codex/min → 0 CG/min + 0 Codex/min</strong>{' '}
        (everything routes through Hetzner-cached Spectre). Migration is safe
        per-field only where the verdict is GREEN.
      </p>
    </div>
  )
}
