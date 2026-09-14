/**
 * RZ bootstrap completeness audit.
 *
 * Today /research-zone fires 6 parallel upstream calls per token nav:
 *   bootstrap + binance + cgMarket + cgDetails + codex + appResearch
 *
 * If bootstrap can provide each field, we can short-circuit the others.
 * This panel shows for each token: which fields are filled by bootstrap
 * alone, which require a CG fallback, which need Codex (DEX tokens), and
 * which are best served by direct Binance.
 *
 * Output: a matrix that tells us EXACTLY which 6→2 fan reduction is safe.
 */
import React, { useEffect, useState } from 'react'

const TOKENS = [
  { symbol: 'BTC', label: 'BTC (major)', hasBinance: true, isDex: false },
  { symbol: 'ETH', label: 'ETH (major)', hasBinance: true, isDex: false },
  { symbol: 'PEPE', label: 'PEPE (large meme)', hasBinance: true, isDex: false },
  { symbol: 'SPECTRE', label: 'SPECTRE (DEX-primary)', hasBinance: false, isDex: true },
]

async function fetchBootstrap(sym) {
  const t0 = performance.now()
  const res = await fetch(`/data-api/v1/rz/${encodeURIComponent(sym)}/bootstrap`, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return { ...data?.data, _latencyMs: Math.round(performance.now() - t0) }
}

const FIELDS = [
  { key: 'symbol', label: 'symbol', path: d => d.identity?.symbol },
  { key: 'name', label: 'name', path: d => d.identity?.name },
  { key: 'logo', label: 'logo_url', path: d => d.identity?.logo_url },
  { key: 'cg_id', label: 'coingecko_id', path: d => d.identity?.coingecko_id },
  { key: 'categories', label: 'categories', path: d => d.identity?.categories?.length || 0 },
  { key: 'twitter', label: 'social: twitter', path: d => d.identity?.twitter },
  { key: 'description', label: 'description', path: d => d.profile?.name },
  { key: 'launchDate', label: 'launch date', path: d => d.profile?.launchDate },
  { key: 'price', label: 'price.current', path: d => d.price?.current ?? null },
  { key: 'change24h', label: 'price.change24h', path: d => d.price?.change24h ?? null },
  { key: 'volume24h', label: 'price.volume24h', path: d => d.price?.volume24h ?? null },
  { key: 'mcap', label: 'market cap', path: d => d.price?.marketCap ?? d.profile?.marketCap ?? null },
  { key: 'fdv', label: 'FDV', path: d => d.price?.fdv ?? null },
  { key: 'ath', label: 'ATH', path: d => d.price?.ath ?? null },
  { key: 'sparkline7d', label: 'sparkline 7d', path: d => Array.isArray(d.price?.sparkline7d) ? d.price.sparkline7d.length : null },
  { key: 'change1h', label: 'change 1h', path: d => d.price?.change1h ?? null },
  { key: 'change7d', label: 'change 7d', path: d => d.price?.change7d ?? null },
  { key: 'change30d', label: 'change 30d', path: d => d.price?.change30d ?? null },
  { key: 'score', label: 'spectre score', path: d => d.score?.overall ?? null },
  { key: 'candles', label: 'candles count', path: d => Array.isArray(d.candles) ? d.candles.length : 0 },
  { key: 'pairs', label: 'pairs count', path: d => Array.isArray(d.pairs) ? d.pairs.length : 0 },
  { key: 'mentions', label: 'mentions count', path: d => Array.isArray(d.mentions) ? d.mentions.length : 0 },
  { key: 'narratives', label: 'narratives count', path: d => Array.isArray(d.narratives) ? d.narratives.length : 0 },
  { key: 'sentiment', label: 'sentiment.assetScore', path: d => d.sentiment?.assetScore ?? null },
  { key: 'derivatives', label: 'derivatives', path: d => d.derivatives ? 'present' : null },
  { key: 'technicals', label: 'technicals', path: d => d.technicals ? 'present' : null },
]

function isFilled(value) {
  if (value === null || value === undefined) return false
  if (value === 0) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'string') return value.length > 0
  return true
}

export default function RzBootstrapAuditPanel() {
  const [byToken, setByToken] = useState({})

  useEffect(() => {
    TOKENS.forEach(t => {
      fetchBootstrap(t.symbol)
        .then(data => setByToken(prev => ({ ...prev, [t.symbol]: { data, err: null } })))
        .catch(err => setByToken(prev => ({ ...prev, [t.symbol]: { data: null, err: err.message } })))
    })
  }, [])

  const filledByField = {}
  for (const f of FIELDS) {
    filledByField[f.key] = TOKENS.filter(t => {
      const d = byToken[t.symbol]?.data
      if (!d) return false
      return isFilled(f.path(d))
    }).length
  }

  return (
    <div className="dsa-panel">
      <div className="dsa-controls">
        {TOKENS.map(t => {
          const r = byToken[t.symbol]
          return (
            <div key={t.symbol} className="dsa-meta">
              <strong>{t.symbol}</strong>: {r?.data ? `${r.data._latencyMs}ms` : r?.err || '…'}
            </div>
          )
        })}
      </div>
      <table className="dsa-table">
        <thead>
          <tr>
            <th>Field</th>
            {TOKENS.map(t => <th key={t.symbol}>{t.symbol}</th>)}
            <th>Bootstrap coverage</th>
            <th>Verdict (if we drop CG/Codex for this field)</th>
          </tr>
        </thead>
        <tbody>
          {FIELDS.map(f => {
            const count = filledByField[f.key]
            const coverage = count / TOKENS.length
            let verdict, tone
            if (coverage === 1) { verdict = 'SAFE — bootstrap covers all'; tone = 'green' }
            else if (coverage >= 0.5) { verdict = `PARTIAL — needs fallback for ${TOKENS.length - count} token(s)`; tone = 'yellow' }
            else { verdict = 'KEEP CG/Codex — bootstrap rarely fills this'; tone = 'red' }

            return (
              <tr key={f.key}>
                <td><code>{f.label}</code></td>
                {TOKENS.map(t => {
                  const d = byToken[t.symbol]?.data
                  if (!d) return <td key={t.symbol}>—</td>
                  const v = f.path(d)
                  const filled = isFilled(v)
                  return (
                    <td key={t.symbol} className={filled ? 'dsa-cell-ok' : 'dsa-cell-missing'}>
                      {filled ? (typeof v === 'string' && v.length > 18 ? v.slice(0, 18) + '…' : String(v)) : '—'}
                    </td>
                  )
                })}
                <td className="dsa-num">{count}/{TOKENS.length}</td>
                <td><span className={`dsa-verdict dsa-verdict--${tone}`}>{verdict}</span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="dsa-footnote">
        Fields with GREEN can be sourced from bootstrap alone. Fields with YELLOW need a small
        fallback (e.g. <code>/v1/coins/{'{id}'}</code> for mcap/FDV/sparkline). Fields with RED
        should keep their current CG/Codex source. The RZ 6-fan can drop to 2 calls if YELLOW
        fields use <code>/v1/coins/{'{id}'}</code> as a single supplement.
      </p>
    </div>
  )
}
