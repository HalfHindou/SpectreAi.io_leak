/**
 * Mindshare v2 leaderboard — live read of /v1/social/mindshare?v=2.
 *
 * This is the "is the direction good" panel. Shows every token currently in
 * mindshare_v2 with its full row: rank, multi-horizon mindshare, sentiment
 * score with bull/neutral/bear breakdown, classifier mix (so we can see when
 * sentiment is Groq-driven vs lexicon-only), momentum, novelty, mention
 * count, contributor count, freshness, low-mcap flag.
 *
 * Refreshes every 30s. Highlights stale rows and lexicon-only rows so we
 * can see at a glance whether the pipeline is healthy.
 */
import React, { useEffect, useState } from 'react'

function fmtPct(v, digits = 2) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return `${Number(v).toFixed(digits)}%`
}

function fmtScore(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(3)}`
}

function classifierBadge(mix) {
  if (!mix || typeof mix !== 'object') return null
  const entries = Object.entries(mix)
  if (entries.length === 0) return null
  const total = entries.reduce((s, [, v]) => s + Number(v || 0), 0) || 1
  const groqPct = (Number(mix.groq || 0) / total) * 100
  const haikuPct = (Number(mix.haiku || 0) / total) * 100
  const lexiconPct = (Number(mix.lexicon || 0) / total) * 100
  const tone = groqPct > 60 ? 'green' : groqPct > 20 ? 'yellow' : 'red'
  return (
    <span className={`dsa-pill dsa-pill--${tone}`} title={`Groq ${groqPct.toFixed(0)}% · Haiku ${haikuPct.toFixed(0)}% · Lexicon ${lexiconPct.toFixed(0)}%`}>
      G{groqPct.toFixed(0)} · L{lexiconPct.toFixed(0)}
    </span>
  )
}

function sentimentBar(bull, neutral, bear) {
  const b = Number(bull || 0)
  const n = Number(neutral || 0)
  const r = Number(bear || 0)
  const total = b + n + r || 1
  return (
    <div className="dsa-sent-bar">
      <div style={{ flex: b / total, background: 'var(--bull, #10B981)' }} title={`bull ${b.toFixed(1)}%`} />
      <div style={{ flex: n / total, background: 'rgba(255,255,255,0.10)' }} title={`neutral ${n.toFixed(1)}%`} />
      <div style={{ flex: r / total, background: 'var(--bear, #EF4444)' }} title={`bear ${r.toFixed(1)}%`} />
    </div>
  )
}

function momentumGlyph(m) {
  if (!m) return '—'
  if (m === 'rising' || m === 'accelerating') return <span style={{ color: 'var(--bull)' }}>↑ {m}</span>
  if (m === 'falling' || m === 'cooling') return <span style={{ color: 'var(--bear)' }}>↓ {m}</span>
  return <span style={{ color: 'var(--text-tertiary)' }}>→ {m}</span>
}

export default function MindshareV2LeaderboardPanel() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastFetched, setLastFetched] = useState(null)

  const refetch = async () => {
    try {
      const res = await fetch('/data-api/v1/social/mindshare?v=2&limit=50', { signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []
      setRows(data)
      setLastFetched(Date.now())
      setError(null)
    } catch (e) {
      setError(e?.message || 'fetch failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refetch()
    const id = setInterval(refetch, 30_000)
    return () => clearInterval(id)
  }, [])

  // Stats summary
  const totalAssets = rows.length
  const groqShare = rows.reduce((s, r) => {
    const mix = r.classifier_mix || r.classifierMix || {}
    return s + Number(mix.groq || 0)
  }, 0) / Math.max(1, totalAssets)
  const lexiconShare = rows.reduce((s, r) => {
    const mix = r.classifier_mix || r.classifierMix || {}
    return s + Number(mix.lexicon || 0)
  }, 0) / Math.max(1, totalAssets)
  const lowMcapCount = rows.filter(r => r.low_mcap || r.lowMcap).length
  const staleCount = rows.filter(r => r.is_stale || r.isStale).length
  const ageSeconds = lastFetched ? Math.round((Date.now() - lastFetched) / 1000) : null

  return (
    <div className="dsa-panel">
      <div className="dsa-controls">
        <button className="dsa-tab" onClick={refetch}>Refresh now</button>
        <div className="dsa-meta">
          {totalAssets} assets in v2 · auto-refresh 30s · last fetch {ageSeconds != null ? `${ageSeconds}s ago` : '…'}
        </div>
        <div className="dsa-legend">
          <span className={`dsa-pill ${groqShare > 60 ? 'dsa-pill--green' : groqShare > 20 ? 'dsa-pill--yellow' : 'dsa-pill--red'}`}>
            Groq avg {groqShare.toFixed(0)}%
          </span>
          <span className="dsa-pill dsa-pill--yellow">
            Lexicon avg {lexiconShare.toFixed(0)}%
          </span>
          {lowMcapCount > 0 && (
            <span className="dsa-meta">{lowMcapCount} low-mcap</span>
          )}
          {staleCount > 0 && (
            <span className="dsa-pill dsa-pill--red">{staleCount} stale</span>
          )}
        </div>
      </div>

      {loading && <div className="dsa-meta">Loading…</div>}
      {error && <div className="dsa-pill dsa-pill--red">{error}</div>}

      {!loading && rows.length > 0 && (
        <table className="dsa-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Asset</th>
              <th>Mindshare 24h</th>
              <th>1h</th>
              <th>7d</th>
              <th>Sentiment</th>
              <th style={{ width: 130 }}>Bull/Neutral/Bear</th>
              <th>Momentum</th>
              <th>Mentions 24h</th>
              <th>Contributors</th>
              <th>Classifier (G/L)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const rank = r.rank ?? r.rank_24h ?? r.rank24h ?? i + 1
              const asset = r.asset || r.symbol || '?'
              const pct24 = r.pct ?? r.mindshare_pct_24h ?? r.mindshare_pct ?? r.pct24h
              const pct1 = r.pct_1h ?? r.mindshare_pct_1h ?? r.pct1h
              const pct7 = r.pct_7d ?? r.mindshare_pct_7d ?? r.pct7d
              const score = r.sentiment_score ?? r.sentimentScore ?? r.score ?? r.sentiment_score_24h
              const bull = r.bull_pct ?? r.bullPct ?? 0
              const neutral = r.neutral_pct ?? r.neutralPct ?? 0
              const bear = r.bear_pct ?? r.bearPct ?? 0
              const momentum = r.momentum
              const mentions24 = r.mentions_24h ?? r.mentions24h ?? '—'
              const contributors = r.contributors ?? r.unique_authors_24h ?? r.uniqueAuthors24h ?? '—'
              const mix = r.classifier_mix ?? r.classifierMix ?? {}
              const lowMcap = r.low_mcap ?? r.lowMcap
              const stale = r.is_stale ?? r.isStale

              const scoreColor = score == null ? 'var(--text-muted)'
                : score > 0.1 ? 'var(--bull-bright, #34D399)'
                : score < -0.1 ? 'var(--bear-bright, #F87171)'
                : 'var(--text-secondary)'

              return (
                <tr key={`${asset}-${i}`}>
                  <td className="dsa-num"><strong>{rank}</strong></td>
                  <td>
                    <strong>{asset}</strong>
                    {lowMcap && <span className="dsa-meta" style={{ marginLeft: 6 }}>µ</span>}
                    {stale && <span className="dsa-pill dsa-pill--red" style={{ marginLeft: 6 }}>stale</span>}
                  </td>
                  <td className="dsa-num">{fmtPct(pct24)}</td>
                  <td className="dsa-num">{fmtPct(pct1)}</td>
                  <td className="dsa-num">{fmtPct(pct7)}</td>
                  <td className="dsa-num" style={{ color: scoreColor }}>{fmtScore(score)}</td>
                  <td>{sentimentBar(bull, neutral, bear)}</td>
                  <td>{momentumGlyph(momentum)}</td>
                  <td className="dsa-num">{mentions24}</td>
                  <td className="dsa-num">{contributors}</td>
                  <td>{classifierBadge(mix)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <p className="dsa-footnote">
        Live read of <code>/v1/social/mindshare?v=2</code>. Auto-refresh 30s.
        {' '}<strong>Direction check:</strong> rank order should match what you would expect from
        the actual conversation volume on X today. Sentiment scores should be mostly small
        (lexicon caps at ±0.4) until Groq is unblocked. <code>G/L</code> badge shows the
        Groq-vs-Lexicon mix per asset — when Groq is fully working we want G&gt;60% across the
        board. Low-mcap tokens tagged with µ; stale rows (no rollup in 30min) tagged red.
        {' '}<strong>Known gap:</strong> BTC/ETH/PEPE/SPECTRE are not in this list because
        <code>social_feed</code> ingestion currently only pulls X-Dash trending — bigcap
        ingestion is a separate ticket.
      </p>
    </div>
  )
}
