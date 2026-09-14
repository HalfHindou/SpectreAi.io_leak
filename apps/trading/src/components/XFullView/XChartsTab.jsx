/**
 * XChartsTab — "X Charts" data tab for the token terminal (DataTabs).
 *
 * The X Bubbles "Chart" surface, scoped to the selected token: a price area
 * chart with each KOL's tweet plotted at the (time, price) it landed, plus a
 * "Bubbles" toggle for the KOL influence cloud. Pulls from the same X Dash
 * pipeline as XFullView / XDashColumn (so the $ANSEM -> the-black-bull
 * override applies here too).
 */
import { memo, useState } from 'react'

import useXDashTokenIntel from './hooks/useXDashTokenIntel'
import useOnChainPeerData from './hooks/useOnChainPeerData'
import useXfvTooltip from './hooks/useXfvTooltip'

import MentionPriceChart from './components/MentionPriceChart'
import KolCosmos from './components/KolCosmos'
import { withXDashCgId } from './xdash-overrides'
import { fadeSignalFromXDash, FADE_LABELS } from './fade-signal'

import './XFullView.css'
import './XChartsTab.css'

const BUBBLE_METRICS = [
  { id: 'followers', label: 'Followers' },
  { id: 'engagement', label: 'Engagement' },
  { id: 'mentions', label: 'Mentions' },
]

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function fmtCompact(n) {
  if (!Number.isFinite(n) || n === 0) return '0'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(0)}K`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function XChartsTab({ token }) {
  useXfvTooltip()

  const [view, setView] = useState('chart') // 'chart' | 'bubbles'
  const [bubbleMetric, setBubbleMetric] = useState('followers')

  // Pin ambiguous-ticker tokens to the correct X Dash cg_id ($ANSEM ->
  // the-black-bull) before resolution.
  const xdashToken = withXDashCgId(token)

  const { data: intel, loading, error, resolvedCgId } =
    useXDashTokenIntel(xdashToken, { pollIntervalMs: 90_000 })

  const onChainStats = useOnChainPeerData()
  const fade = fadeSignalFromXDash(intel, onChainStats?.priceChange24h)

  if (!token) {
    return (
      <div className="xct xct--state">
        <div className="xfv-empty">Select a token to see its X charts.</div>
      </div>
    )
  }

  const showSkeleton = loading && !intel
  const notIndexed = !loading && !intel

  const metrics = intel?.metrics || intel?.token?.metrics || {}
  const quality = intel?.quality || intel?.token?.quality || {}
  const asset = intel?.asset || intel?.token?.token || intel?.token || {}

  const mentions24h = num(metrics.mentions_24h)
  const totalMentions = num(metrics.total_mentions)
  const velocity = num(metrics.velocity_ratio)
  const engagement24h = num(metrics.external_weighted_engagement_24h ?? metrics.total_weighted_engagement)
  const kols24h = num(metrics.unique_external_authors_24h ?? metrics.unique_authors)
  const cleanSignal = num(quality.clean_signal_score)

  const stats = [
    { label: 'Mentions 24h', value: fmtCompact(mentions24h), sub: totalMentions > 0 ? `${fmtCompact(totalMentions)} total` : null },
    { label: 'Velocity', value: velocity > 0 ? `${velocity.toFixed(2)}x` : '—', sub: velocity >= 2 ? 'Accelerating' : velocity > 0 ? 'Steady' : null },
    { label: 'Engagement 24h', value: fmtCompact(engagement24h), sub: 'weighted' },
    { label: 'KOLs 24h', value: fmtCompact(kols24h), sub: 'unique authors' },
    { label: 'Signal Quality', value: cleanSignal > 0 ? `${Math.round(cleanSignal * 100)}%` : '—', sub: cleanSignal >= 0.6 ? 'High signal' : cleanSignal >= 0.3 ? 'Mixed' : null },
    { label: 'Market Cap', value: num(asset.market_cap) > 0 ? `$${fmtCompact(num(asset.market_cap))}` : '—', sub: num(asset.global_rank) > 0 ? `Rank #${num(asset.global_rank)}` : null },
  ]

  return (
    <div className="xct">
      <header className="xct-head">
        <span className="xct-head-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </span>
        <span className="xct-head-title">X Charts</span>
        <span className="xct-head-sub">Price · KOL mentions</span>
        {fade.tag && (
          <span className={`xct-fade xct-fade--${fade.tag}`} title={fade.thesis}>
            {fade.tag === 'bearish' ? '▼ ' : '⚠ '}{FADE_LABELS[fade.tag]}
          </span>
        )}
        {!showSkeleton && !notIndexed && (
          <div className="xct-viewtoggle" role="tablist" aria-label="X Charts view">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'chart'}
              className={`xct-viewtoggle-btn${view === 'chart' ? ' is-active' : ''}`}
              onClick={() => setView('chart')}
            >
              Chart
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'bubbles'}
              className={`xct-viewtoggle-btn${view === 'bubbles' ? ' is-active' : ''}`}
              onClick={() => setView('bubbles')}
            >
              Cosmos
            </button>
          </div>
        )}
        {resolvedCgId && <span className="xct-cgid">{resolvedCgId}</span>}
      </header>

      {showSkeleton ? (
        <div className="xct-skeleton">
          <div className="xct-skel xct-skel--row" />
          <div className="xct-skel xct-skel--chart" />
        </div>
      ) : notIndexed ? (
        <div className="xct-notindexed">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35M8 11h6" />
          </svg>
          <strong>Not tracked by X Dash yet</strong>
          <span>{error || 'No X intelligence indexed for this token.'}</span>
        </div>
      ) : (
        <>
          <div className="xct-stats">
            {stats.map((s) => (
              <div key={s.label} className="xct-stat">
                <div className="xct-stat-label">{s.label}</div>
                <div className="xct-stat-value">{s.value}</div>
                {s.sub && <div className="xct-stat-sub">{s.sub}</div>}
              </div>
            ))}
          </div>

          {view === 'chart' ? (
            <MentionPriceChart
              cgId={resolvedCgId}
              mentions={intel?.top_mentions || intel?.mentions || []}
              token={token}
            />
          ) : (
            <div className="xct-bubbles-wrap">
              <div className="xct-bubble-metrics">
                <span className="xct-bubble-metrics-label">Size by</span>
                {BUBBLE_METRICS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`xct-bubble-metric-btn${bubbleMetric === m.id ? ' is-active' : ''}`}
                    onClick={() => setBubbleMetric(m.id)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="xct-cosmos-stage">
                <KolCosmos
                  authors={intel?.top_authors || intel?.authors || []}
                  metric={bubbleMetric}
                  sunImage={asset.image_small || asset.image_url || token?.logo}
                  sunLabel={token?.symbol ? `$${token.symbol}` : ''}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default memo(XChartsTab)
