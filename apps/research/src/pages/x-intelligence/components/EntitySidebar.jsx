/**
 * EntitySidebar — Right-side detail panel for a selected graph node.
 *
 * Slides in from the right when a node is clicked. Shows avatar, key metrics,
 * description, connections list, and recent mention tweets.
 */
import { useMemo, useRef, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TIER_COLORS, TYPE_LABELS, TIER_ORDER } from '../data/zigchainGraph'
import { buildResearchZoneLocation } from '@/lib/research-zone-routing'
import { nodeIdentityLabel } from '@/lib/token-identity'
import { useAppState } from '@/contexts/AppStateContext'
import MentionChart from './MentionChart'

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatFollowers(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatNumber(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function formatPct(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${Math.round(n * 100)}%`
}

function formatDelta(curr, prev) {
  if (!Number.isFinite(curr) || !Number.isFinite(prev) || prev === 0) return null
  return ((curr - prev) / prev) * 100
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

// ── Icons ────────────────────────────────────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 2.5l3.5 3.5-3.5 3.5" />
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 1.5h2.5V4M6.5 7.5L12.5 1.5M8 1.5H3a1.5 1.5 0 00-1.5 1.5v8A1.5 1.5 0 003 12.5h8a1.5 1.5 0 001.5-1.5V7" />
    </svg>
  )
}

// ── Mention Sparkline (inline bar chart for project mention activity) ─────────

function MentionSparkline({ connectedLinks, tierColor }) {
  const canvasRef = useRef(null)

  // Group tweet dates by month and draw a bar chart
  const monthData = useMemo(() => {
    const months = new Map()
    for (const link of connectedLinks) {
      const dates = link.allTweetDates || []
      for (const d of dates) {
        const date = new Date(d)
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        months.set(key, (months.get(key) || 0) + 1)
      }
      // Fallback: also count tweets without allTweetDates
      if (dates.length === 0 && link.tweets) {
        for (const t of link.tweets) {
          if (t.date) {
            const date = new Date(t.date)
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
            months.set(key, (months.get(key) || 0) + 1)
          }
        }
      }
    }
    // Sort by month key
    const sorted = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    return sorted
  }, [connectedLinks])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || monthData.length === 0) return

    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight

    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Clear
    ctx.clearRect(0, 0, w, h)

    const maxVal = Math.max(...monthData.map(([, v]) => v), 1)
    const barCount = monthData.length
    const gap = 3
    const barW = Math.max(4, (w - gap * (barCount - 1)) / barCount)

    for (let i = 0; i < barCount; i++) {
      const [, count] = monthData[i]
      const barH = Math.max(2, (count / maxVal) * (h - 4))
      const xPos = i * (barW + gap)
      const yPos = h - barH

      ctx.fillStyle = tierColor + '66' // 40% opacity
      ctx.beginPath()
      ctx.roundRect(xPos, yPos, barW, barH, 2)
      ctx.fill()
    }
  }, [monthData, tierColor])

  if (monthData.length === 0) return null

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="xi-sidebar__connections-title" style={{ marginBottom: 8 }}>
        Mentions Over Time
      </div>
      <canvas
        ref={canvasRef}
        className="xi-sidebar__sparkline"
        style={{ width: '100%', height: 60, display: 'block' }}
      />
    </div>
  )
}

// ── Intelligence Brief ───────────────────────────────────────────────────────

// For hub nodes (the project itself) — render the live X Dash intelligence
// block. Real numbers only; no follower-tier boilerplate.
function HubIntelBrief({ intel }) {
  if (!intel) return null

  const mentionsDelta = formatDelta(intel.mentions24h, (intel.mentions7d || 0) / 7)
  const authorsDelta = formatDelta(intel.authors24h, (intel.authors7d || 0) / 7)

  const rows = [
    { label: 'Mentions · 24h', value: formatNumber(intel.mentions24h), delta: mentionsDelta },
    { label: 'Mentions · 7d', value: formatNumber(intel.mentions7d) },
    { label: 'Authors · 24h', value: formatNumber(intel.authors24h), delta: authorsDelta },
    { label: 'Authors · 7d', value: formatNumber(intel.authors7d) },
    { label: 'Weighted engagement · 24h', value: formatNumber(intel.weightedEngagement24h) },
    { label: 'Weighted engagement · 7d', value: formatNumber(intel.weightedEngagement7d) },
  ]

  return (
    <div className="xi-sidebar__intel-grid">
      {rows.map((r) => (
        <div key={r.label} className="xi-sidebar__intel-row">
          <span className="xi-sidebar__intel-row-l">{r.label}</span>
          <span className="xi-sidebar__intel-row-v">
            {r.value}
            {r.delta != null && Math.abs(r.delta) >= 1 && (
              <span className={`xi-sidebar__intel-delta ${r.delta >= 0 ? 'up' : 'dn'}`}>
                {r.delta > 0 ? '+' : ''}{Math.round(r.delta)}%
              </span>
            )}
          </span>
        </div>
      ))}
      {intel.attentionQuality && (
        <div className="xi-sidebar__intel-quality">
          <div className="xi-sidebar__intel-quality-row">
            <span>Clean signal · 24h</span>
            <span>{formatPct(intel.attentionQuality.clean_signal_score_24h)}</span>
          </div>
          <div className="xi-sidebar__intel-quality-row">
            <span>Promo share · 24h</span>
            <span>{formatPct(intel.attentionQuality.promo_share_24h)}</span>
          </div>
          <div className="xi-sidebar__intel-quality-row">
            <span>Handle-only share</span>
            <span>{formatPct(intel.attentionQuality.handle_only_share_24h)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// For KOL nodes — keep the per-author description short and grounded. Use the
// real mention count and engagement carried from X Dash, no tier copy fabricated.
function KolBrief({ node, connections, mentions }) {
  const insights = []

  if (node.mentionCount > 0) {
    const engPart = node.weightedEngagement > 0
      ? ` (${formatNumber(node.weightedEngagement)} weighted engagement)`
      : ''
    insights.push(`${node.mentionCount} mention${node.mentionCount === 1 ? '' : 's'} of this project${engPart}.`)
  }
  if (node.followers > 0) {
    insights.push(`${formatFollowers(node.followers)} X followers · ${node.tier}-Tier reach.`)
  }
  if (connections > 1) insights.push(`${connections} connections in the current view.`)
  if (node.type === 'exchange') insights.push('Exchange account — listings and trading-pair announcements likely.')

  if (insights.length === 0) return null

  return (
    <div className="xi-sidebar__intel-text">
      {insights.map((text, i) => (
        <p key={i} className="xi-sidebar__intel-point">{text}</p>
      ))}
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export default function EntitySidebar({
  node,
  connectedNodes,
  connectedLinks,
  onClose,
  onNavigateToNode,
  onEnterProject,
  mode = 'project',
  dayMode,
  hoveredMention = null,
  priceData = null,
}) {
  const sidebarRef = useRef(null)
  const navigate = useNavigate()
  const { setResearchZoneToken } = useAppState()

  // Scroll to top whenever the selected node changes
  useEffect(() => {
    if (node && sidebarRef.current) {
      sidebarRef.current.scrollTop = 0
    }
  }, [node?.id])
  if (!node) return null

  const tierColor = TIER_COLORS[node.tier] || TIER_COLORS.C
  const tierGlow = tierColor + '33'
  const typeLabel = TYPE_LABELS[node.type] || 'KOL'
  // Project hubs have no personal follower count — suppress the "0 followers"
  // stat everywhere and lead with mentions/authors/engagement instead. Match
  // the same detection the tooltip uses (isHub | isProjectHub | type project).
  const isHub = node.isHub || node.isProjectHub || node.type === 'project'
  // Identity line + X link, resolved by the shared rule (@/lib/token-identity):
  // authors → @handle; projects → real @handle else $cashtag(s), never @ticker;
  // X link only when a real account exists.
  const { label: identityLabel, twitterUrl: identityXUrl } = nodeIdentityLabel(node)

  // Sort connections by mention count
  const sortedConnections = useMemo(() => {
    if (!connectedNodes || !connectedLinks) return []

    const mentionMap = new Map()
    for (const link of connectedLinks) {
      const otherId = link.source === node.id ? link.target : link.source
      mentionMap.set(otherId, (mentionMap.get(otherId) || 0) + link.tweetCount)
    }

    return connectedNodes
      .map((cn) => ({ ...cn, mentions: mentionMap.get(cn.id) || 0 }))
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, 30)
  }, [connectedNodes, connectedLinks, node.id])

  // Gather recent tweets
  const recentTweets = useMemo(() => {
    if (!connectedLinks) return []
    const tweets = []
    for (const link of connectedLinks) {
      if (link.tweets) {
        for (const t of link.tweets) {
          tweets.push({
            ...t,
            fromHandle: link.source === node.id ? link.target : link.source,
          })
        }
      }
    }
    return tweets
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .slice(0, 5)
  }, [connectedLinks, node.id])

  // Mentioned projects (projects this entity connects to, sorted by mention volume)
  const mentionedProjects = useMemo(() => {
    if (!connectedNodes || !connectedLinks) return []
    return connectedNodes
      .filter((cn) => cn.type === 'project')
      .map((cn) => {
        const mentions = connectedLinks
          .filter((l) => l.source === cn.id || l.target === cn.id)
          .reduce((sum, l) => sum + l.tweetCount, 0)
        return { ...cn, mentions }
      })
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, 8)
  }, [connectedNodes, connectedLinks])

  // Tier description
  const tierDescriptions = {
    S: '500K+ followers, top-tier influence',
    A: '100K-500K followers, high influence',
    B: '30K-100K followers, mid influence',
    C: 'Under 30K followers, emerging',
  }

  return (
    <div
      ref={sidebarRef}
      className="xi-sidebar xi-glass xi-glass-border xi-sidebar--open"
      style={{ '--tier-color': tierColor, '--tier-glow': tierGlow }}
    >
      {/* Close — only shown when there's an explicit selection to clear. */}
      {onClose && (
        <button className="xi-sidebar__close" onClick={onClose} title="Close">
          <CloseIcon />
        </button>
      )}

      {/* Price block — populated when the user is in chart mode. Gives the
          right-rail concrete market context (price, % change, range high/low,
          mention count in window) so the user has Trading Desk-level data
          without leaving the surface. */}
      {priceData && (
        <div className="xi-sidebar__price">
          <div className="xi-sidebar__price-head">
            <span className="xi-sidebar__price-label">Price</span>
            <span className="xi-sidebar__price-range">{(priceData.range || '7d').toUpperCase()}</span>
          </div>
          <div className="xi-sidebar__price-now">
            <span className="xi-sidebar__price-value">
              {priceData.price >= 1 ? `$${priceData.price.toFixed(2)}`
                : priceData.price >= 0.01 ? `$${priceData.price.toFixed(4)}`
                : `$${priceData.price.toFixed(6)}`}
            </span>
            {priceData.pct != null && (
              <span className={`xi-sidebar__price-delta ${priceData.pct >= 0 ? 'up' : 'dn'}`}>
                {priceData.pct >= 0 ? '+' : ''}{priceData.pct.toFixed(2)}%
              </span>
            )}
          </div>
          <div className="xi-sidebar__price-stats">
            {priceData.high != null && (
              <div className="xi-sidebar__price-stat">
                <span>High</span>
                <span>{priceData.high >= 1 ? `$${priceData.high.toFixed(2)}` : `$${priceData.high.toFixed(6)}`}</span>
              </div>
            )}
            {priceData.low != null && (
              <div className="xi-sidebar__price-stat">
                <span>Low</span>
                <span>{priceData.low >= 1 ? `$${priceData.low.toFixed(2)}` : `$${priceData.low.toFixed(6)}`}</span>
              </div>
            )}
            {priceData.mentionCount != null && (
              <div className="xi-sidebar__price-stat">
                <span>Mentions in window</span>
                <span>{priceData.mentionCount}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hovered-mention preview — populated when the user hovers a tweet
          marker on the price chart. Lives at the very top of the sidebar
          so it never has to occlude the chart itself. */}
      {hoveredMention && (
        <div className="xi-sidebar__hover-tweet">
          <div className="xi-sidebar__hover-tweet-label">Hovered tweet</div>
          <div className="xi-sidebar__hover-tweet-head">
            {hoveredMention.author?.avatar && (
              <img
                src={hoveredMention.author.avatar}
                alt=""
                className="xi-sidebar__hover-tweet-avatar"
              />
            )}
            <div className="xi-sidebar__hover-tweet-id">
              <div className="xi-sidebar__hover-tweet-name">
                {hoveredMention.author?.name || '—'}
              </div>
              <div className="xi-sidebar__hover-tweet-meta">
                @{hoveredMention.author?.handle || 'unknown'}
              </div>
            </div>
          </div>
          <div className="xi-sidebar__hover-tweet-text">
            {hoveredMention.text || ''}
          </div>
          <div className="xi-sidebar__hover-tweet-foot">
            <span className="xi-sidebar__hover-tweet-stat" title="Likes">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <span className="xi-sidebar__hover-tweet-stat-n">{formatNumber(hoveredMention.likes || 0)}</span>
            </span>
            <span className="xi-sidebar__hover-tweet-stat" title="Reposts">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
              <span className="xi-sidebar__hover-tweet-stat-n">{formatNumber(hoveredMention.retweets || 0)}</span>
            </span>
            <span className="xi-sidebar__hover-tweet-stat" title="Views">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <span className="xi-sidebar__hover-tweet-stat-n">{formatNumber(hoveredMention.views || 0)}</span>
            </span>
            {hoveredMention.url && (
              <a
                href={hoveredMention.url}
                target="_blank"
                rel="noopener noreferrer"
                className="xi-sidebar__hover-tweet-link"
              >
                Open ↗
              </a>
            )}
          </div>
        </div>
      )}

      {/* Hero */}
      <div className="xi-sidebar__hero">
        <div className="xi-sidebar__avatar" style={{ borderColor: tierColor }}>
          {node.avatar ? (
            <img
              src={node.avatar}
              alt={node.name}
              onError={(e) => {
                e.target.style.display = 'none'
                if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex'
              }}
            />
          ) : null}
          <div
            className="xi-sidebar__avatar-fallback"
            style={{
              display: node.avatar ? 'none' : 'flex',
              background: tierColor + '15',
              color: tierColor,
            }}
          >
            {(node.name || '?')[0].toUpperCase()}
          </div>
        </div>

        <h3 className="xi-sidebar__name">{node.name}</h3>
        {identityLabel && <span className="xi-sidebar__handle">{identityLabel}</span>}

        <div className="xi-sidebar__badges">
          <span
            className="xi-sidebar__badge"
            style={{ background: tierColor + '18', color: tierColor, borderColor: tierColor + '33' }}
          >
            {node.tier}-Tier
          </span>
          <span
            className="xi-sidebar__badge"
            style={node.type === 'project' ? {
              background: 'rgba(255,255,255,0.08)',
              borderColor: 'rgba(255,255,255,0.12)',
              color: 'var(--text-primary)',
            } : {
              background: 'rgba(255,255,255,0.04)',
              borderColor: 'rgba(255,255,255,0.06)',
              color: 'var(--text-secondary)',
            }}
          >
            {typeLabel}
          </span>
        </div>
      </div>

      {/* Research Zone deep-link — jump from the social graph straight to the
          token's charts, on-chain data and full analysis. Only the project hub
          is backed by a CoinGecko id, so KOL nodes don't get it. */}
      {isHub && node.cgId && (
        <button
          type="button"
          className="xi-sidebar__rz-cta"
          title="Open this token in Research Zone — charts, on-chain data & full analysis"
          onClick={() => {
            const symbol = (node.cashtag || '').replace(/^\$/, '')
              || (node.handle || '').replace(/^@/, '')
              || null
            // Seed the token into AppState (logo + identity) BEFORE navigating —
            // mirrors app-shell's openResearchZone so Research Zone paints the
            // logo + name instantly instead of cold-resolving from a bare slug
            // (which is the "long load + blank logo" the bare navigate caused).
            const tokenData = {
              symbol,
              name: node.name,
              cgId: node.cgId,
              logo: node.avatar || null,
              verified: true,
            }
            setResearchZoneToken?.(tokenData)
            navigate(buildResearchZoneLocation(tokenData))
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 3v18h18" />
            <path d="M7 14l4-4 3 3 5-6" />
          </svg>
          <span>View in Research Zone</span>
          <svg className="xi-sidebar__rz-cta-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Metrics */}
      {isHub ? (
        // Hub: show project-level X Dash intelligence, not personal X stats.
        <div className="xi-sidebar__metrics">
          <div className="xi-sidebar__metric">
            <div className="xi-sidebar__metric-label">Mentions · 24h</div>
            <div className="xi-sidebar__metric-value">{formatNumber(node.intel?.mentions24h ?? node.mentionCount)}</div>
          </div>
          <div className="xi-sidebar__metric">
            <div className="xi-sidebar__metric-label">Authors · 24h</div>
            <div className="xi-sidebar__metric-value">{formatNumber(node.intel?.authors24h)}</div>
          </div>
          <div className="xi-sidebar__metric">
            <div className="xi-sidebar__metric-label">Connections</div>
            <div className="xi-sidebar__metric-value">{connectedNodes?.length || 0}</div>
          </div>
          <div className="xi-sidebar__metric">
            <div className="xi-sidebar__metric-label">Engagement · 24h</div>
            <div className="xi-sidebar__metric-value">{formatNumber(node.intel?.weightedEngagement24h)}</div>
          </div>
        </div>
      ) : (
        <div className="xi-sidebar__metrics">
          <div className="xi-sidebar__metric">
            <div className="xi-sidebar__metric-label">Followers</div>
            <div className="xi-sidebar__metric-value">{formatFollowers(node.followers)}</div>
          </div>
          <div className="xi-sidebar__metric">
            <div className="xi-sidebar__metric-label">Mentions</div>
            <div className="xi-sidebar__metric-value">{formatNumber(node.mentionCount)}</div>
          </div>
          <div className="xi-sidebar__metric">
            <div className="xi-sidebar__metric-label">Connections</div>
            <div className="xi-sidebar__metric-value">{connectedNodes?.length || 0}</div>
          </div>
          <div className="xi-sidebar__metric">
            <div className="xi-sidebar__metric-label">Engagement</div>
            <div className="xi-sidebar__metric-value">{formatNumber(node.weightedEngagement)}</div>
          </div>
        </div>
      )}

      {/* Influence Tier / Project Category */}
      {isHub ? (
        (node.primaryCategory || node.segment) && (
          <div className="xi-sidebar__tier-section">
            <div className="xi-sidebar__connections-title" style={{ marginBottom: 8 }}>
              Classification
            </div>
            <div className="xi-sidebar__tier-badge" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(255,255,255,0.08)', color: 'var(--text-primary)', fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', textTransform: 'uppercase' }}>
                {(node.segment || 'P').slice(0, 3)}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                {node.primaryCategory || 'Project'}
                {node.segment ? ` · ${node.segment}` : ''}
              </span>
            </div>
          </div>
        )
      ) : (
        <div className="xi-sidebar__tier-section">
          <div className="xi-sidebar__connections-title" style={{ marginBottom: 8 }}>
            Influence Tier
          </div>
          <div className="xi-sidebar__tier-badge" style={{ background: tierColor + '10', border: `1px solid ${tierColor}22` }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: tierColor + '20', color: tierColor, fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {node.tier}
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              {node.tier}-Tier — {tierDescriptions[node.tier] || ''}
            </span>
          </div>
        </div>
      )}

      {/* Crawl mode: KOL → projects they touch */}
      {mode === 'crawl' && !isHub && Array.isArray(node.projects) && node.projects.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div className="xi-sidebar__connections-title" style={{ marginBottom: 8 }}>
            Projects they mention
            <span className="xi-sidebar__connections-count" style={{ marginLeft: 8 }}>{node.projects.length}</span>
          </div>
          {[...node.projects]
            .sort((a, b) => (b.mentions || 0) - (a.mentions || 0))
            .map((pj) => (
              <button
                type="button"
                key={pj.projectId}
                className="xi-sidebar__connection"
                onClick={() => onEnterProject?.({ cgId: pj.cgId, name: pj.name, symbol: pj.symbol })}
              >
                <div className="xi-sidebar__connection-avatar" style={{ borderColor: 'rgba(255,255,255,0.18)' }}>
                  {pj.avatar ? (
                    <img src={pj.avatar} alt={pj.name} onError={(e) => { e.target.style.display = 'none' }} />
                  ) : (
                    <div className="xi-sidebar__connection-avatar-fallback">
                      {(pj.name || '?')[0].toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="xi-sidebar__connection-info">
                  <span className="xi-sidebar__connection-name">{pj.name}</span>
                  {pj.symbol && (
                    <span className="xi-sidebar__connection-handle">${pj.symbol}</span>
                  )}
                </div>
                <span className="xi-sidebar__connection-count">
                  {pj.mentions} mention{pj.mentions !== 1 ? 's' : ''}
                </span>
                <ChevronRightIcon />
              </button>
            ))}
        </div>
      )}

      {/* Mentioned Projects */}
      {mentionedProjects.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div className="xi-sidebar__connections-title" style={{ marginBottom: 8 }}>
            Mentions ({mentionedProjects.length} project{mentionedProjects.length !== 1 ? 's' : ''})
          </div>
          {mentionedProjects.map((mp) => (
            <div
              key={mp.id}
              className="xi-sidebar__connection"
              onClick={() => onNavigateToNode(mp.id)}
              role="button"
              tabIndex={0}
            >
              <div
                className="xi-sidebar__connection-avatar"
                style={{ borderColor: TIER_COLORS[mp.tier] || TIER_COLORS.C }}
              >
                {mp.avatar ? (
                  <img
                    src={mp.avatar}
                    alt={mp.name}
                          onError={(e) => { e.target.style.display = 'none' }}
                  />
                ) : (
                  <div className="xi-sidebar__connection-avatar-fallback">
                    {(mp.name || '?')[0].toUpperCase()}
                  </div>
                )}
              </div>
              <div className="xi-sidebar__connection-info">
                <span className="xi-sidebar__connection-name">{mp.name}</span>
              </div>
              <span className="xi-sidebar__connection-count">
                {mp.mentions} mention{mp.mentions !== 1 ? 's' : ''}
              </span>
              <ChevronRightIcon />
            </div>
          ))}
        </div>
      )}

      {/* Description */}
      {node.description && (
        <p className="xi-sidebar__desc">{node.description}</p>
      )}

      {/* Intelligence Brief */}
      <div className="xi-sidebar__intel">
        <div className="xi-sidebar__connections-title" style={{ marginBottom: 8 }}>
          {isHub ? 'Project Intelligence' : 'Author Brief'}
        </div>
        <div className="xi-sidebar__intel-card">
          {isHub ? (
            <HubIntelBrief intel={node.intel} />
          ) : (
            <KolBrief
              node={node}
              connections={sortedConnections.length}
              mentions={connectedLinks.reduce((sum, l) => sum + l.tweetCount, 0)}
            />
          )}
        </div>
      </div>

      {/* Price chart × KOL mentions — the killer feature. CoinGecko market
          chart with every top_mention rendered as a clickable avatar marker
          at the moment that tweet posted. Click → opens the tweet. */}
      {isHub && node.cgId && (
        <MentionChart
          cgId={node.cgId}
          mentions={node.topMentions || []}
          projectName={node.name}
          projectAvatar={node.avatar}
        />
      )}

      {/* Real X Dash tweet feed — only shown for project hubs that have
          drilled-in data. Carries the live top_mentions[] from X Dash with
          full text + engagement counts + author + x.com URL. */}
      {isHub && Array.isArray(node.topMentions) && node.topMentions.length > 0 && (
        <div className="xi-sidebar__tweets">
          <div className="xi-sidebar__connections-header" style={{ marginBottom: 10 }}>
            <span className="xi-sidebar__connections-title">Top tweets</span>
            <span className="xi-sidebar__connections-count">{node.topMentions.length}</span>
          </div>
          {node.topMentions.slice(0, 8).map((t) => {
            const cleanText = (t.text || '').replace(/https?:\/\/t\.co\/\w+/g, '').trim()
            const eng = (t.likes || 0) + (t.retweets || 0) + (t.replies || 0)
            return (
              <a
                key={t.id}
                href={t.url}
                target="_blank"
                rel="noopener noreferrer"
                className="xi-sidebar__tweet-card xi-sidebar__tweet-card--rich"
              >
                <div className="xi-sidebar__tweet-header">
                  <div className="xi-sidebar__tweet-author-rich">
                    {t.author?.avatar ? (
                      <img className="xi-sidebar__tweet-avatar" src={t.author.avatar} alt="" onError={(e) => { e.target.style.display = 'none' }} />
                    ) : (
                      <div className="xi-sidebar__tweet-avatar xi-sidebar__tweet-avatar--fallback">
                        {(t.author?.name || '?')[0].toUpperCase()}
                      </div>
                    )}
                    <div className="xi-sidebar__tweet-author-id">
                      <span className="xi-sidebar__tweet-author-name">
                        {t.author?.name || 'Anonymous'}
                        {t.author?.verified && (
                          <span className="xi-sidebar__tweet-verified" title="Verified" aria-hidden>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.34-.625.34-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z"/>
                            </svg>
                          </span>
                        )}
                      </span>
                      <span className="xi-sidebar__tweet-author-meta">
                        @{t.author?.handle || '—'}
                        {t.author?.followers > 0 && (
                          <span> · {formatFollowers(t.author.followers)}</span>
                        )}
                      </span>
                    </div>
                  </div>
                  {t.createdAt && <span className="xi-sidebar__tweet-time">{timeAgo(t.createdAt)}</span>}
                </div>
                <div className="xi-sidebar__tweet-body">
                  {cleanText.slice(0, 280)}{cleanText.length > 280 ? '…' : ''}
                </div>
                <div className="xi-sidebar__tweet-stats">
                  {t.views > 0 && (
                    <span title="Views">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      {formatNumber(t.views)}
                    </span>
                  )}
                  {t.likes > 0 && (
                    <span title="Likes">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                      {formatNumber(t.likes)}
                    </span>
                  )}
                  {t.retweets > 0 && (
                    <span title="Retweets">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                      {formatNumber(t.retweets)}
                    </span>
                  )}
                  {t.replies > 0 && (
                    <span title="Replies">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                      {formatNumber(t.replies)}
                    </span>
                  )}
                  {eng > 50 && (
                    <span className="xi-sidebar__tweet-engagement">
                      {formatNumber(eng)} eng
                    </span>
                  )}
                </div>
              </a>
            )
          })}
        </div>
      )}

      {/* Mention sparkline for projects */}
      {node.type === 'project' && connectedLinks && connectedLinks.length > 0 && (
        <MentionSparkline connectedLinks={connectedLinks} tierColor={tierColor} />
      )}

      {/* Connections */}
      {sortedConnections.length > 0 && (
        <div>
          <div className="xi-sidebar__connections-header">
            <span className="xi-sidebar__connections-title">Connections</span>
            <span className="xi-sidebar__connections-count">{connectedNodes?.length || 0}</span>
          </div>
          {sortedConnections.map((cn) => (
            <div
              key={cn.id}
              className="xi-sidebar__connection"
              onClick={() => onNavigateToNode(cn.id)}
              role="button"
              tabIndex={0}
            >
              <div
                className="xi-sidebar__connection-avatar"
                style={{ borderColor: TIER_COLORS[cn.tier] || TIER_COLORS.C }}
              >
                {cn.avatar ? (
                  <img
                    src={cn.avatar}
                    alt={cn.name}
                          onError={(e) => { e.target.style.display = 'none' }}
                  />
                ) : (
                  <div className="xi-sidebar__connection-avatar-fallback">
                    {(cn.name || '?')[0].toUpperCase()}
                  </div>
                )}
              </div>
              <div className="xi-sidebar__connection-info">
                <span className="xi-sidebar__connection-name">{cn.name}</span>
                <span className="xi-sidebar__connection-handle">
                  {cn.handle?.startsWith('@') ? cn.handle : `@${cn.id}`}
                </span>
              </div>
              <span className="xi-sidebar__connection-count">
                {cn.mentions} mention{cn.mentions !== 1 ? 's' : ''}
              </span>
              <ChevronRightIcon />
            </div>
          ))}
        </div>
      )}

      {/* Tweets — premium glass cards */}
      {recentTweets.length > 0 && (
        <div className="xi-sidebar__tweets">
          <div className="xi-sidebar__connections-title" style={{ marginBottom: 10 }}>
            Recent Mentions
          </div>
          {recentTweets.map((t, i) => {
            const tweetText = t.tweet_text || t.text || ''
            // Extract URLs for potential image preview
            const urlMatch = tweetText.match(/https?:\/\/t\.co\/\w+/)
            const hasMedia = urlMatch || t.media_url
            const cleanText = tweetText.replace(/https?:\/\/t\.co\/\w+/g, '').trim()

            return (
              <div key={i} className="xi-sidebar__tweet-card">
                {/* Tweet header — handle + time */}
                <div className="xi-sidebar__tweet-header">
                  <div className="xi-sidebar__tweet-author">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.4, flexShrink: 0 }}>
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                    <span>@{t.fromHandle}</span>
                  </div>
                  {t.date && <span className="xi-sidebar__tweet-time">{timeAgo(t.date)}</span>}
                </div>

                {/* Tweet body */}
                <div className="xi-sidebar__tweet-body">
                  {cleanText.slice(0, 220)}{cleanText.length > 220 ? '...' : ''}
                </div>

                {/* Link preview placeholder if URL detected */}
                {hasMedia && (
                  <div className="xi-sidebar__tweet-link">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                    </svg>
                    <span>{urlMatch ? urlMatch[0] : 'Media attached'}</span>
                  </div>
                )}

                {/* Engagement stats */}
                {(t.likes > 0 || t.retweets > 0) && (
                  <div className="xi-sidebar__tweet-stats">
                    {t.likes > 0 && <span>{t.likes} likes</span>}
                    {t.retweets > 0 && <span>{t.retweets} RTs</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Action — only when there's a real X account to open. A project hub
          with no handle (identified by its $cashtag) has no @page to view. */}
      {identityXUrl && (
        <a
          className="xi-sidebar__action"
          href={identityXUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on X
          <ExternalLinkIcon />
        </a>
      )}
    </div>
  )
}
