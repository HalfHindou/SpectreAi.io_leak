/**
 * FilterPanel — Left-side collapsible glass panel for the X Intelligence graph.
 *
 * Shows graph statistics, search input, and tier/type filter toggles.
 * Collapses to a small icon button on narrow viewports or user toggle.
 */
import { useMemo } from 'react'
import { TIER_COLORS, TIER_ORDER, TYPE_LABELS } from '../data/zigchainGraph'

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatIntel(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function formatPct(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${Math.round(n * 100)}%`
}

// ── Icons (inline SVG) ───────────────────────────────────────────────────────

function FilterIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4h14M4 9h10M6 14h6" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M9.5 9.5L13 13" />
    </svg>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

const TIMEFRAME_OPTIONS = [
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: 'all', label: 'ALL' },
]

export default function FilterPanel({
  nodes,
  links,
  filteredNodeIds,
  activeTiers,
  onToggleTier,
  activeTypes,
  onToggleType,
  searchQuery,
  onSearchChange,
  isCollapsed,
  onToggleCollapse,
  dayMode,
  loading = false,
  minFollowers = 5000,
  onMinFollowersChange,
  timeframe = 'all',
  onTimeframeChange,
  timeframeOptions = null,
  projectName = 'X Bubbles',
  projectSearchBar = null,
  onBack = null,
  intel = null,
  mode = 'project',
  onModeChange = null,
  crawlSeed = null,
  onCrawlSeedChange = null,
  crawlDepth = 'standard',
  onCrawlDepthChange = null,
  crawlSummary = null,
  crawlMinBridges = 1,
  onCrawlMinBridgesChange = null,
}) {
  const SEED_PILLS = [
    { key: 'trending24h', label: 'Trending · 24h' },
    { key: 'trending7d', label: 'Trending · 7d' },
    { key: 'mixed', label: 'Trending + Fresh' },
    { key: 'fresh', label: 'New' },
  ]

  const DEPTH_PILLS = [
    { key: 'light', label: 'Light', sub: 'fast' },
    { key: 'standard', label: 'Standard', sub: 'top 6' },
    { key: 'deep', label: 'Deep', sub: 'top 12' },
  ]
  // ── Compute stats ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const filteredSet = new Set(filteredNodeIds)
    const filteredNodes = nodes.filter((n) => filteredSet.has(n.id))

    let kols = 0
    let exchanges = 0
    let projects = 0
    for (const n of filteredNodes) {
      if (n.type === 'exchange') exchanges++
      else if (n.type === 'project') projects++
      else kols++
    }

    let connectionCount = 0
    for (const link of links) {
      if (filteredSet.has(link.source) && filteredSet.has(link.target)) {
        connectionCount++
      }
    }

    return { total: filteredNodes.length, connections: connectionCount, kols, exchanges, projects }
  }, [nodes, links, filteredNodeIds])

  const allTiersActive = activeTiers.size === TIER_ORDER.length
  const allTypesActive = activeTypes.size === Object.keys(TYPE_LABELS).length

  return (
    <>
      {/* Floating toggle — only mounts when the panel is collapsed. The
          old approach rendered it always + leaned on an `opacity:0` inline
          style for the open state, which meant the white glass background
          (in day mode) AND its hit-area still occupied the panel header
          area underneath. Cleaner to just not mount it when the panel is
          open. */}
      {isCollapsed && (
        <button
          type="button"
          className="xi-filter-toggle xi-glass"
          onClick={onToggleCollapse}
          title="Show filters"
          aria-label="Show filters"
        >
          <FilterIcon />
        </button>
      )}

      {/* Panel */}
      <div className={`xi-filter xi-glass xi-glass-border ${isCollapsed ? 'xi-filter--collapsed' : ''}`}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            {onBack && (
              <button className="xi-filter__back" onClick={onBack} title="Back to explore">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 3l-4 4 4 4" />
                </svg>
                <span>Explore</span>
              </button>
            )}
            <h2 className="xi-filter__title">{projectName}</h2>
            <p className="xi-filter__subtitle">Social influence graph</p>
          </div>
          <button
            type="button"
            className="xi-filter__collapse"
            onClick={onToggleCollapse}
            title="Collapse filters"
            aria-label="Collapse filters"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3l-4 4 4 4" />
            </svg>
          </button>
        </div>

        {/* Mode toggle — Project ↔ Crawl */}
        {onModeChange && (
          <div className="xi-filter__mode" role="tablist" aria-label="Intelligence mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'project'}
              className={`xi-filter__mode-pill${mode === 'project' ? ' xi-filter__mode-pill--active' : ''}`}
              onClick={() => onModeChange('project')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <circle cx="12" cy="12" r="9" strokeDasharray="2 3" opacity="0.5" />
              </svg>
              Project
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'crawl'}
              className={`xi-filter__mode-pill${mode === 'crawl' ? ' xi-filter__mode-pill--active' : ''}`}
              onClick={() => onModeChange('crawl')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="6" r="2" />
                <circle cx="18" cy="6" r="2" />
                <circle cx="12" cy="18" r="2" />
                <path d="M7.5 7.5L11 16M16.5 7.5L13 16M8 6h8" opacity="0.6" />
              </svg>
              Crawl
            </button>
          </div>
        )}

        {/* Project mode: search for a different project. Crawl mode: pick a seed. */}
        {mode === 'project' ? projectSearchBar : (
          <div className="xi-filter__crawl-controls">
            <div className="xi-filter__section-label">Seed</div>
            <div className="xi-filter__pills">
              {SEED_PILLS.map(({ key, label }) => (
                <button
                  key={key}
                  className={`xi-filter__pill${crawlSeed === key ? ' xi-filter__pill--active' : ''}`}
                  onClick={() => onCrawlSeedChange?.(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="xi-filter__section-label" style={{ marginTop: 12 }}>
              Depth
            </div>
            <div className="xi-filter__pills">
              {DEPTH_PILLS.map(({ key, label, sub }) => (
                <button
                  key={key}
                  className={`xi-filter__pill${crawlDepth === key ? ' xi-filter__pill--active' : ''}`}
                  onClick={() => onCrawlDepthChange?.(key)}
                  title={sub}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: 'rgba(245,245,247,.45)', letterSpacing: '.06em', textTransform: 'uppercase', margin: '4px 2px 0' }}>
              {crawlDepth === 'deep' ? 'Expands top 12 projects with full author lists' :
                crawlDepth === 'standard' ? 'Expands top 6 projects with full author lists' :
                'Bootstrap only (3 authors per project)'}
            </div>

            <div className="xi-filter__section-label" style={{ marginTop: 12 }}>
              Min Bridges
            </div>
            <div className="xi-filter__follower-range">
              <input
                type="range"
                className="xi-filter__slider"
                min={1}
                max={5}
                step={1}
                value={crawlMinBridges}
                onChange={(e) => onCrawlMinBridgesChange?.(Number(e.target.value))}
              />
              <div className="xi-filter__slider-labels">
                <span>{crawlMinBridges === 1 ? 'All KOLs' : `≥ ${crawlMinBridges} projects`}</span>
                <span style={{ color: 'rgba(245,245,247,.45)', fontSize: 11 }}>
                  {crawlSummary?.bridgeCount || 0} bridges
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Project-level X Dash intelligence (overrides the legacy node counts
            when a project is loaded — the node counts are derivable from the
            graph itself and don't deserve top-of-rail real estate). */}
        {intel ? (
          <div className="xi-filter__intel">
            {(intel.primaryCategory || intel.segment) && (
              <div className="xi-filter__intel-badges">
                {intel.segment && (
                  <span className="xi-filter__intel-badge xi-filter__intel-badge--segment">{intel.segment}</span>
                )}
                {intel.primaryCategory && (
                  <span className="xi-filter__intel-badge">{intel.primaryCategory}</span>
                )}
              </div>
            )}
            <div className="xi-filter__intel-grid">
              <div className="xi-filter__intel-cell">
                <div className="xi-filter__intel-cell-l">Mentions · 24h</div>
                <div className="xi-filter__intel-cell-v">{formatIntel(intel.mentions24h)}</div>
              </div>
              <div className="xi-filter__intel-cell">
                <div className="xi-filter__intel-cell-l">Mentions · 7d</div>
                <div className="xi-filter__intel-cell-v">{formatIntel(intel.mentions7d)}</div>
              </div>
              <div className="xi-filter__intel-cell">
                <div className="xi-filter__intel-cell-l">Authors · 24h</div>
                <div className="xi-filter__intel-cell-v">{formatIntel(intel.authors24h)}</div>
              </div>
              <div className="xi-filter__intel-cell">
                <div className="xi-filter__intel-cell-l">Engagement · 24h</div>
                <div className="xi-filter__intel-cell-v">{formatIntel(intel.weightedEngagement24h)}</div>
              </div>
            </div>
            {intel.attentionQuality?.clean_signal_score_24h != null && (
              <div className="xi-filter__intel-quality">
                <span>Clean signal · 24h</span>
                <span className="xi-filter__intel-quality-v">
                  {formatPct(intel.attentionQuality.clean_signal_score_24h)}
                </span>
              </div>
            )}
            <div className="xi-filter__intel-graph">
              {loading ? (
                <span className="xi-filter__stat-shimmer xi-filter__stat-shimmer--wide" />
              ) : (
                <>
                  <span>{formatCount(stats.total)} nodes</span>
                  <span>·</span>
                  <span>{formatCount(stats.connections)} connections</span>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="xi-filter__stats">
              <div className="xi-filter__stat">
                <div className="xi-filter__stat-value">
                  {loading ? <span className="xi-filter__stat-shimmer" /> : formatCount(stats.total)}
                </div>
                <div className="xi-filter__stat-label">Total Nodes</div>
              </div>
              <div className="xi-filter__stat">
                <div className="xi-filter__stat-value">
                  {loading ? <span className="xi-filter__stat-shimmer" /> : formatCount(stats.connections)}
                </div>
                <div className="xi-filter__stat-label">Connections</div>
              </div>
            </div>
            <div className="xi-filter__stats-types">
              <div className="xi-filter__stat xi-filter__stat--kol">
                <div className="xi-filter__stat-value">
                  {loading ? <span className="xi-filter__stat-shimmer xi-filter__stat-shimmer--sm" /> : formatCount(stats.kols)}
                </div>
                <div className="xi-filter__stat-label">KOLs</div>
              </div>
              <div className="xi-filter__stat xi-filter__stat--project">
                <div className="xi-filter__stat-value">
                  {loading ? <span className="xi-filter__stat-shimmer xi-filter__stat-shimmer--sm" /> : formatCount(stats.projects)}
                </div>
                <div className="xi-filter__stat-label">Projects</div>
              </div>
              <div className="xi-filter__stat xi-filter__stat--exchange">
                <div className="xi-filter__stat-value">
                  {loading ? <span className="xi-filter__stat-shimmer xi-filter__stat-shimmer--sm" /> : formatCount(stats.exchanges)}
                </div>
                <div className="xi-filter__stat-label">Exchanges</div>
              </div>
            </div>
          </>
        )}

        {/* Search */}
        <div className="xi-filter__search-wrap">
          <span className="xi-filter__search-icon"><SearchIcon /></span>
          <input
            type="text"
            className="xi-filter__search"
            placeholder="Search KOLs, projects..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            spellCheck={false}
          />
        </div>

        {/* Follower range filter */}
        <div className="xi-filter__section-label">MIN FOLLOWERS</div>
        <div className="xi-filter__follower-range">
          <input
            type="range"
            className="xi-filter__slider"
            min={0}
            max={100000}
            step={1000}
            value={minFollowers}
            onChange={(e) => onMinFollowersChange?.(Number(e.target.value))}
          />
          <div className="xi-filter__slider-labels">
            <span>{formatCount(minFollowers)}+</span>
            <input
              type="number"
              className="xi-filter__follower-input"
              value={minFollowers}
              min={0}
              max={500000}
              step={1000}
              onChange={(e) => {
                const val = Math.max(0, Math.min(500000, Number(e.target.value) || 0))
                onMinFollowersChange?.(val)
              }}
            />
          </div>
        </div>

        {/* Tier filters */}
        <div className="xi-filter__section-label">TIER</div>
        <div className="xi-filter__pills">
          <button
            className={`xi-filter__pill ${allTiersActive ? 'xi-filter__pill--active' : ''}`}
            onClick={() => onToggleTier('all')}
          >
            All Tiers
          </button>
          {TIER_ORDER.map((tier) => (
            <button
              key={tier}
              className={`xi-filter__pill xi-filter__pill--${tier.toLowerCase()} ${activeTiers.has(tier) && !allTiersActive ? 'xi-filter__pill--active' : ''}`}
              onClick={() => onToggleTier(tier)}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: TIER_COLORS[tier],
                  display: 'inline-block',
                  marginRight: 4,
                }}
              />
              {tier}-Tier
            </button>
          ))}
        </div>

        <hr className="xi-filter__divider" />

        {/* Type filters */}
        <div className="xi-filter__section-label">TYPE</div>
        <div className="xi-filter__pills">
          <button
            className={`xi-filter__pill ${allTypesActive ? 'xi-filter__pill--active' : ''}`}
            onClick={() => onToggleType('all')}
          >
            All
          </button>
          {Object.entries(TYPE_LABELS).map(([key, label]) => (
            <button
              key={key}
              className={`xi-filter__pill ${activeTypes.has(key) && !allTypesActive ? 'xi-filter__pill--active' : ''}`}
              onClick={() => onToggleType(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <hr className="xi-filter__divider" />

        {/* Timeframe filters */}
        <div className="xi-filter__section-label">TIMEFRAME</div>
        <div className="xi-filter__pills">
          {(timeframeOptions || TIMEFRAME_OPTIONS).map(({ key, label }) => (
            <button
              key={key}
              className={`xi-filter__pill ${timeframe === key ? 'xi-filter__pill--active' : ''}`}
              onClick={() => onTimeframeChange?.(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="xi-filter__footer">
          Powered by <strong>Spectre Intelligence</strong>
        </div>
      </div>
    </>
  )
}
