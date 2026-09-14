/**
 * YouTokenDossier — Quick-view Spectre Dossier for the currently-selected
 * token (from AppStateContext). Pulls /api/dossier/:chain/:ca and surfaces
 * identity, market, safety flags. The dossier service exists across the
 * Spectre Brain — this widget makes it instantly visible on the dashboard.
 */
import { useCallback, useEffect, useState } from 'react'
import BrainSays from '@/components/BrainSays'
import './YouTokenDossier.css'

export default function YouTokenDossier({ chain = 'eth', ca = '' }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    if (!ca) return
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/dossier/${chain}/${ca}`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`${res.status}`)
      setData(await res.json())
    } catch (err) { setError(err?.message || 'unable to load') } finally { setLoading(false) }
  }, [chain, ca])

  useEffect(() => { fetchData() }, [fetchData])

  if (!ca) return <div className="you-td-empty">Select a token to load its dossier.</div>
  if (loading && !data) return <div className="you-td"><div className="you-shimmer" style={{ height: 80, borderRadius: 6 }} /></div>
  if (error || !data) return <div className="you-td-empty">Dossier unavailable.</div>

  const id = data.identity || {}
  const m = data.market || {}
  const s = data.safety || {}
  const change = m.change24h ?? 0
  const tone = change > 0 ? 'bull' : change < 0 ? 'bear' : 'neutral'

  return (
    <div className="you-td">
      <header className="you-td-header">
        {id.logo && <img className="you-td-logo" src={id.logo} alt="" />}
        <div className="you-td-id">
          <span className="you-td-name">{id.name || id.symbol || 'Token'}</span>
          <span className="you-td-sym mono">{id.symbol || ''}</span>
        </div>
        {m.priceUsd && (
          <div className="you-td-px">
            <span className="mono">${Number(m.priceUsd).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
            <span className={`you-td-ch you-td-ch--${tone} mono`}>{change >= 0 ? '+' : ''}{Number(change).toFixed(2)}%</span>
          </div>
        )}
      </header>
      <div className="you-td-grid">
        {m.mcap != null && <div><span>MCAP</span><span className="mono">${Number(m.mcap).toLocaleString()}</span></div>}
        {m.vol24h != null && <div><span>24H VOL</span><span className="mono">${Number(m.vol24h).toLocaleString()}</span></div>}
        {m.liquidity != null && <div><span>LIQUIDITY</span><span className="mono">${Number(m.liquidity).toLocaleString()}</span></div>}
        {s.isHoneypot != null && <div><span>HONEYPOT</span><span className={`mono ${s.isHoneypot ? 'you-td-bad' : 'you-td-good'}`}>{s.isHoneypot ? 'YES' : 'NO'}</span></div>}
        {s.lpLocked != null && <div><span>LP LOCKED</span><span className={`mono ${s.lpLocked ? 'you-td-good' : 'you-td-bad'}`}>{s.lpLocked ? 'YES' : 'NO'}</span></div>}
        {s.ownerRenounced != null && <div><span>OWNER</span><span className={`mono ${s.ownerRenounced ? 'you-td-good' : 'you-td-bad'}`}>{s.ownerRenounced ? 'RENOUNCED' : 'ACTIVE'}</span></div>}
      </div>
      {id.symbol && <BrainSays asset={id.symbol} />}
    </div>
  )
}
