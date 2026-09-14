/**
 * YouPredictionMarkets — Polymarket event odds for crypto-relevant markets.
 *
 * Pulls from /api/polymarket/events (Express dev) with direct Gamma API
 * fallback in production (per .claude/rules/api-patterns.md §C — the
 * Express route has no Vercel function equivalent and the frontend service
 * already handles the fallback).
 *
 * Renders as a scrollable list of event cards: question, yes% bar, end date,
 * volume. Auto-refresh every 5 min via useAdaptivePolling.
 */

import { useState, useEffect, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { getPredictionMarkets } from '@/services/polymarketApi'
import './YouPredictionMarkets.css'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000

function fmtVolume(v) {
  if (!v) return '$0'
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  return `$${Math.round(v)}`
}

function YesBar({ yesPct }) {
  const tone = yesPct >= 60 ? 'bull' : yesPct <= 40 ? 'bear' : 'neutral'
  return (
    <div className={`you-pm-bar you-pm-bar--${tone}`}>
      <span className="you-pm-bar-fill" style={{ width: `${yesPct}%` }} />
      <span className="you-pm-bar-label">{yesPct}%</span>
    </div>
  )
}

export default function YouPredictionMarkets({ category = 'crypto' }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const rows = await getPredictionMarkets(category, 20)
      setItems(Array.isArray(rows) ? rows : [])
      setError(null)
    } catch (e) {
      setError(e?.message || 'unable to load')
    } finally {
      setLoading(false)
    }
  }, [category])

  useEffect(() => { fetchData() }, [fetchData])
  useAdaptivePolling(fetchData, REFRESH_INTERVAL_MS)

  if (loading && items.length === 0) {
    return (
      <div className="you-pm">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="you-pm-row you-pm-row--skeleton">
            <div className="you-shimmer" style={{ width: '70%', height: 11, borderRadius: 6 }} />
            <div className="you-shimmer" style={{ width: '40%', height: 8, marginTop: 8, borderRadius: 4 }} />
          </div>
        ))}
      </div>
    )
  }

  if (error || items.length === 0) {
    return (
      <div className="you-pm-empty">
        <span className="you-pm-empty-text">No active prediction markets right now.</span>
      </div>
    )
  }

  return (
    <ul className="you-pm">
      {items.map((m) => (
        <li key={m.id} className="you-pm-row">
          <a href={m.url} target="_blank" rel="noopener noreferrer" className="you-pm-link">
            <div className="you-pm-question" title={m.question}>{m.question}</div>
            <div className="you-pm-meta">
              <YesBar yesPct={m.yesPct} />
              <span className="you-pm-vol mono">{fmtVolume(m.volume)}</span>
              <span className="you-pm-end">{m.endDate}</span>
            </div>
          </a>
        </li>
      ))}
    </ul>
  )
}
