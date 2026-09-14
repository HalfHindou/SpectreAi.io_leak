/**
 * CrawlSidebar — Right rail for X Intelligence crawl mode when nothing is
 * selected. Shows the project galaxy "scoreboard": Top Carriers (KOLs
 * carrying attention across multiple projects), Strongest Cluster (where
 * mindshare is converging right now), Fastest Rising (highest velocity),
 * Attention Score (composite + sub-scores).
 *
 * Selecting any node hides this panel and EntitySidebar takes over.
 */
import { useMemo } from 'react'
import { TIER_COLORS } from '../data/zigchainGraph'

function formatNumber(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function formatPct(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${Math.round(n)}%`
}

function timeAgo(ts) {
  if (!ts) return ''
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

function MiniRing({ value, color = 'rgba(245, 245, 247, 0.85)' }) {
  // Composite score ring (0-100). Pure SVG, no canvas churn.
  const r = 26
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value || 0))
  const dash = (pct / 100) * c
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="xi-crawl__ring">
      <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
      <circle
        cx="32" cy="32" r={r} fill="none"
        stroke={color} strokeWidth="4" strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="35" textAnchor="middle" fontSize="16" fontWeight="700" fill="#f5f5f7" fontFamily="var(--font-mono)">
        {value != null ? Math.round(value) : '—'}
      </text>
    </svg>
  )
}

export default function CrawlSidebar({
  summary,
  loading,
  refreshedAt,
  onSelectProject,
  onSelectKol,
  onClose = null,
  dayMode,
}) {
  const liveLabel = useMemo(() => {
    if (loading && !summary) return 'Fetching'
    if (!refreshedAt) return 'Live'
    return `Updated ${timeAgo(refreshedAt)}`
  }, [loading, refreshedAt, summary])

  return (
    <div className="xi-crawl xi-glass xi-glass-border xi-crawl--open">
      <header className="xi-crawl__header">
        <div className="xi-crawl__live">
          <span className={`xi-crawl__live-dot${loading ? ' xi-crawl__live-dot--pulse' : ''}`} />
          <span className="xi-crawl__live-label">{liveLabel}</span>
        </div>
        <div className="xi-crawl__live-pill">LIVE</div>
        {onClose && (
          <button className="xi-crawl__close" onClick={onClose} title="Close" aria-label="Close dashboard">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
          </button>
        )}
      </header>

      {/* Attention Score — composite ring + four sub-scores */}
      <section className="xi-crawl__section">
        <div className="xi-crawl__section-title">Attention Score</div>
        <div className="xi-crawl__attention">
          <MiniRing value={summary?.attention?.composite} color="#f5f5f7" />
          <div className="xi-crawl__attention-grid">
            <div className="xi-crawl__attention-row">
              <span>Quality</span>
              <span>{formatPct(summary?.attention?.quality)}</span>
            </div>
            <div className="xi-crawl__attention-row">
              <span>Engagement</span>
              <span>{formatPct(summary?.attention?.engagement)}</span>
            </div>
            <div className="xi-crawl__attention-row">
              <span>Reach</span>
              <span>{formatNumber(summary?.attention?.reach)}</span>
            </div>
            <div className="xi-crawl__attention-row">
              <span>Momentum</span>
              <span>{formatPct(summary?.attention?.momentum)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Top Carriers — KOLs by cross-project mention sum, bridges first */}
      <section className="xi-crawl__section">
        <div className="xi-crawl__section-title">
          Top Carriers
          <span className="xi-crawl__section-count">{summary?.topCarriers?.length || 0}</span>
        </div>
        <div className="xi-crawl__list">
          {(summary?.topCarriers || []).map((k, i) => {
            const tierColor = TIER_COLORS[k.tier] || TIER_COLORS.C
            const isBridge = (k.bridgeCount || 0) >= 2
            return (
              <button
                key={k.id}
                type="button"
                className={`xi-crawl__row${isBridge ? ' xi-crawl__row--bridge' : ''}`}
                onClick={() => onSelectKol?.(k.id)}
              >
                <span className="xi-crawl__row-rank">{i + 1}</span>
                <div className="xi-crawl__row-avatar" style={{ borderColor: isBridge ? '#fbbf24' : tierColor }}>
                  {k.avatar ? (
                    <img src={k.avatar} alt="" onError={(e) => { e.target.style.display = 'none' }} />
                  ) : (
                    <span style={{ background: tierColor + '20', color: tierColor }}>
                      {(k.name || '?')[0].toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="xi-crawl__row-id">
                  <span className="xi-crawl__row-name">{k.name}</span>
                  <span className="xi-crawl__row-meta">
                    {k.handle}
                    {isBridge && (
                      <span className="xi-crawl__bridge-pill">{k.bridgeCount} projects</span>
                    )}
                  </span>
                </div>
                <div className="xi-crawl__row-num">
                  <span className="xi-crawl__row-num-v">{formatNumber(k.mentionCount)}</span>
                  <span className="xi-crawl__row-num-l">mentions</span>
                </div>
              </button>
            )
          })}
          {!summary?.topCarriers?.length && !loading && (
            <div className="xi-crawl__empty">No KOL data yet.</div>
          )}
        </div>
      </section>

      {/* Fastest Rising — project with highest 24h-vs-7d velocity */}
      {summary?.fastestRising && (
        <section className="xi-crawl__section">
          <div className="xi-crawl__section-title">Fastest Rising</div>
          <button
            type="button"
            className="xi-crawl__fast"
            onClick={() => onSelectProject?.(summary.fastestRising.cgId, summary.fastestRising.name)}
          >
            <div className="xi-crawl__row-avatar" style={{ borderColor: '#10b981' }}>
              {summary.fastestRising.avatar ? (
                <img src={summary.fastestRising.avatar} alt="" onError={(e) => { e.target.style.display = 'none' }} />
              ) : (
                <span style={{ background: 'rgba(16,185,129,0.16)', color: '#10b981' }}>
                  {(summary.fastestRising.name || '?')[0].toUpperCase()}
                </span>
              )}
            </div>
            <div className="xi-crawl__row-id">
              <span className="xi-crawl__row-name">{summary.fastestRising.name}</span>
              <span className="xi-crawl__row-meta">
                {summary.fastestRising.primaryCategory || summary.fastestRising.segment || 'Project'}
              </span>
            </div>
            <div className="xi-crawl__row-num">
              <span className="xi-crawl__row-num-v xi-crawl__row-num-v--up">
                +{Math.round((summary.fastestRising.velocityScore - 1) * 100)}%
              </span>
              <span className="xi-crawl__row-num-l">vs 7d avg</span>
            </div>
          </button>
        </section>
      )}

      {/* Strongest Cluster — where attention converges */}
      {summary?.strongest?.project && (
        <section className="xi-crawl__section">
          <div className="xi-crawl__section-title">Strongest Cluster</div>
          <button
            type="button"
            className="xi-crawl__cluster"
            onClick={() => onSelectProject?.(summary.strongest.project.cgId, summary.strongest.project.name)}
          >
            <div className="xi-crawl__cluster-head">
              <div className="xi-crawl__row-avatar" style={{ borderColor: 'rgba(255, 255, 255, 0.18)' }}>
                {summary.strongest.project.avatar ? (
                  <img src={summary.strongest.project.avatar} alt="" onError={(e) => { e.target.style.display = 'none' }} />
                ) : (
                  <span style={{ background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-primary)' }}>
                    {(summary.strongest.project.name || '?')[0].toUpperCase()}
                  </span>
                )}
              </div>
              <div>
                <div className="xi-crawl__row-name">{summary.strongest.project.name}</div>
                <div className="xi-crawl__row-meta">
                  {summary.strongest.project.primaryCategory || 'Cluster'}
                </div>
              </div>
            </div>
            <div className="xi-crawl__cluster-stats">
              <div>
                <span className="xi-crawl__cluster-v">{summary.strongest.nodeCount}</span>
                <span className="xi-crawl__cluster-l">nodes</span>
              </div>
              <div>
                <span className="xi-crawl__cluster-v">{summary.strongest.bridgeCount}</span>
                <span className="xi-crawl__cluster-l">bridges</span>
              </div>
              <div>
                <span className="xi-crawl__cluster-v">{formatPct(summary.strongest.cohesion * 100)}</span>
                <span className="xi-crawl__cluster-l">cohesion</span>
              </div>
            </div>
          </button>
        </section>
      )}

      {/* Footer — graph rollup */}
      <footer className="xi-crawl__footer">
        <span>{summary?.projectCount || 0} projects</span>
        <span>·</span>
        <span>{summary?.kolCount || 0} KOLs</span>
        <span>·</span>
        <span>{summary?.bridgeCount || 0} bridges</span>
      </footer>
    </div>
  )
}
