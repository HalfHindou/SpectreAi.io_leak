/**
 * YouDexNewPairs — freshly listed DEX pairs from DexScreener.
 *
 * Source: DexScreener public endpoint /token-profiles/latest/v1 — no API key
 * required. Returns latest token profiles with chain, address, and links.
 * Refresh every 60s.
 *
 * Each row: chain badge, symbol/name, links to chart, age. No price data
 * because new pairs frequently lack trustworthy quotes; the widget is a
 * discovery surface, not a quote engine. Click-through opens the DexScreener
 * pair page where the user can see depth, holders, etc.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import './YouDexNewPairs.css'

const ENDPOINT = 'https://api.dexscreener.com/token-profiles/latest/v1'
const REFRESH_INTERVAL_MS = 60_000

const CHAIN_LABELS = {
  solana: 'SOL',
  ethereum: 'ETH',
  base: 'BASE',
  arbitrum: 'ARB',
  bsc: 'BSC',
  polygon: 'POLY',
  avalanche: 'AVAX',
  optimism: 'OP',
}

function shortAddr(a) {
  if (!a || typeof a !== 'string') return ''
  if (a.length <= 10) return a
  return `${a.slice(0, 4)}…${a.slice(-4)}`
}

export default function YouDexNewPairs() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(ENDPOINT, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`DexScreener ${res.status}`)
      const json = await res.json()
      setItems(Array.isArray(json) ? json.slice(0, 30) : [])
      setError(null)
    } catch (err) {
      setError(err?.message || 'unable to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, REFRESH_INTERVAL_MS)

  const rows = useMemo(() => items.map((p) => {
    const chainKey = (p.chainId || '').toLowerCase()
    return {
      key: `${chainKey}:${p.tokenAddress}`,
      chain: CHAIN_LABELS[chainKey] || chainKey.toUpperCase().slice(0, 4),
      address: p.tokenAddress,
      icon: p.icon || null,
      url: p.url || (p.tokenAddress ? `https://dexscreener.com/${chainKey}/${p.tokenAddress}` : 'https://dexscreener.com'),
      description: p.description || '',
    }
  }), [items])

  if (loading && rows.length === 0) {
    return (
      <div className="you-dnp">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="you-dnp-row you-dnp-row--skeleton">
            <div className="you-shimmer" style={{ width: 32, height: 32, borderRadius: 6 }} />
            <div className="you-shimmer" style={{ width: '70%', height: 10, borderRadius: 4, marginLeft: 10 }} />
          </div>
        ))}
      </div>
    )
  }

  if (error || rows.length === 0) {
    return (
      <div className="you-dnp-empty">
        <span className="you-dnp-empty-text">DexScreener feed unavailable.</span>
      </div>
    )
  }

  return (
    <ul className="you-dnp">
      {rows.map((r) => (
        <li key={r.key} className="you-dnp-row">
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="you-dnp-link">
            {r.icon ? (
              <img className="you-dnp-icon" src={r.icon} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} />
            ) : (
              <span className="you-dnp-icon you-dnp-icon--placeholder">•</span>
            )}
            <div className="you-dnp-meta">
              <div className="you-dnp-top">
                <span className="you-dnp-chain mono">{r.chain}</span>
                <span className="you-dnp-addr mono">{shortAddr(r.address)}</span>
              </div>
              {r.description && (
                <div className="you-dnp-desc" title={r.description}>{r.description}</div>
              )}
            </div>
          </a>
        </li>
      ))}
    </ul>
  )
}
