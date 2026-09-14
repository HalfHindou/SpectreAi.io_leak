/**
 * XIntelligencePage — Main orchestrator for the Bubblemaps-inspired
 * social graph visualization. The canvas IS the interface, with glass
 * panels floating on top.
 *
 * Wires together: GraphCanvas (drawing), FilterPanel, SearchOverlay,
 * EntitySidebar, NodeTooltip, Legend, FlightControls, and the hooks layer.
 */
import { useState, useMemo, useCallback, useRef, useEffect, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import {
  TIER_ORDER,
  TYPE_LABELS,
  getNodeRadius,
} from '../data/zigchainGraph'
import useProjectGraph from '../hooks/useProjectGraph'
import useCrawlGraph, { SEED_MODES, DEFAULT_SEED, DEPTH_MODES, DEFAULT_DEPTH } from '../hooks/useCrawlGraph'
import useForceSimulation from '../hooks/useForceSimulation'
import { fetchXdashBootstrap } from '../hooks/xdash-cache'
import useGraphInteraction from '../hooks/useGraphInteraction'
import { solveLegacyLayout } from './legacy-layouts'
import GraphCanvas from './GraphCanvas'
import FilterPanel from './FilterPanel'
// Only mounts when a node is selected — 21 KB pulled out of every
// x-intelligence visit until the user actually clicks a graph node.
const EntitySidebar = lazy(() => import('./EntitySidebar'))
const CrawlSidebar = lazy(() => import('./CrawlSidebar'))
// three.js universe for crawl mode — lazy so three stays off the boot path
const XBubblesCosmos = lazy(() => import('./XBubblesCosmos'))

const EMPTY_GRAPH_NODES = []
const EMPTY_GRAPH_LINKS = []
const EMPTY_POSITIONS = Object.freeze({})
const MentionChart = lazy(() => import('./MentionChart'))
import Legend from './Legend'
import FlightControls from './FlightControls'
import NodeTooltip from './NodeTooltip'
import SearchOverlay from './SearchOverlay'
import ProjectSearchBar from './ProjectSearchBar'
// Only mounts when showListView=true (toggle in FlightControls) — lazy
// keeps the 8 KB out of the default x-intelligence load.
const ListView = lazy(() => import('./ListView'))
import LightspeedLoader from './LightspeedLoader'
import AmbientGlow from './AmbientGlow'
import { useIsMobile } from '@/hooks/useMediaQuery'
import './XIntelligencePage.css'
import './XIntelligencePage.mobile.css'
import './xbubbles-cosmos.css'

// Default minimum followers to show (filters out very small accounts)
const DEFAULT_MIN_FOLLOWERS = 5000

// ── Trending Section (landing page) ─────────────────────────────────────────

function formatNumber(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// In project mode the X Dash token endpoint only serves a 24h or 7d mention
// window, so we surface exactly those two — showing 30D/90D/ALL there would be
// dishonest (they'd silently render the same 7d data). Crawl/static graphs keep
// the full FilterPanel range.
const PROJECT_TIMEFRAME_OPTIONS = [
  { key: '24h', label: '24H' },
  { key: '7d', label: '7D' },
]

function TrendingCard({ token, rank, onSelect }) {
  const [avatarFailed, setAvatarFailed] = useState(false)
  const showImage = token.image && !avatarFailed
  return (
    <button
      className="xi-trending__card"
      onClick={() => onSelect(token)}
    >
      <span className="xi-trending__rank">{rank}</span>
      {showImage ? (
        <img
          className="xi-trending__avatar"
          src={token.image}
          alt=""
          width="32"
          height="32"
          onError={() => setAvatarFailed(true)}
        />
      ) : (
        <span className="xi-trending__avatar-fallback">
          {(token.symbol || token.name || '?')[0].toUpperCase()}
        </span>
      )}
      <div className="xi-trending__info">
        <span className="xi-trending__name">{token.name}</span>
        <span className="xi-trending__symbol">{token.cashtag}</span>
      </div>
      <div className="xi-trending__stats">
        <span className="xi-trending__mentions">{formatNumber(token.mentions)}</span>
        <span className="xi-trending__mentions-label">mentions</span>
      </div>
      <svg className="xi-trending__arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  )
}

function TrendingSection({ onSelectProject, dayMode }) {
  const [trending, setTrending] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // per_page=20 + segment=all matches the crawl seed's bootstrap request, so
    // the two share one cached fetch via xdash-cache; we just slice the top 8.
    fetchXdashBootstrap({ perPage: 20, timeframe: '24h', ranking: 'mentions', segment: 'all' })
      .then((data) => {
        if (cancelled || !data) return
        const tokens = (data.tokens || []).slice(0, 8).map((item) => {
          const t = item.token || item
          const m = item.metrics || item
          return {
            cgId: t.cg_id || t.id,
            name: t.name || t.symbol,
            symbol: t.symbol,
            image: t.image_small || t.image_url || t.image || null,
            mentions: m.external_mentions_24h || m.external_mentions || 0,
            authors: m.unique_external_authors_24h || m.unique_authors_24h || 0,
            cashtag: t.cashtag || `$${t.symbol}`,
          }
        }).filter((t) => t.cgId)
        setTrending(tokens)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div className="xi-trending">
        <div className="xi-trending__label">Trending on X</div>
        <div className="xi-trending__grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="xi-trending__card xi-trending__card--skeleton">
              <div className="xi-trending__skeleton-avatar" />
              <div className="xi-trending__skeleton-lines">
                <div className="xi-trending__skeleton-line" />
                <div className="xi-trending__skeleton-line xi-trending__skeleton-line--short" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!trending.length) return null

  return (
    <div className="xi-trending">
      <div className="xi-trending__header">
        <div className="xi-trending__label">
          <span className="xi-trending__dot" />
          Most Mentioned Today
        </div>
      </div>
      <div className="xi-trending__grid">
        {trending.map((t, i) => (
          <TrendingCard
            key={t.cgId}
            token={t}
            rank={i + 1}
            onSelect={onSelectProject}
          />
        ))}
      </div>
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

export default function XIntelligencePage({ dayMode, onToggleDayMode }) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const isMobile = useIsMobile()
  // On mobile the crawl dashboard is an openable bottom sheet (it would
  // otherwise cover the graph on load). Desktop keeps it as the right rail.
  const [crawlSheetOpen, setCrawlSheetOpen] = useState(false)

  // ── Mode (project ↔ crawl), seed (crawl-only), and project selection ──
  // All three persist to URL params + localStorage so deep links work and
  // refreshes don't lose state.
  const [mode, setMode] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const urlMode = params.get('mode')
    if (urlMode === 'crawl' || urlMode === 'project') return urlMode
    // A deep link with ?project=... must open that project's graph, even if the
    // user last left the page in Crawl mode. URL params win over persisted state
    // unless an explicit mode=crawl is present (handled above).
    //
    // Plain navigation ALWAYS opens the landing (search bar + trending) — the
    // universe/crawl is entered explicitly, never forced by a sticky pref.
    return 'project'
  })
  const [crawlSeed, setCrawlSeed] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const urlSeed = params.get('seed')
    if (urlSeed && SEED_MODES[urlSeed]) return urlSeed
    const stored = window.localStorage?.getItem('xi-crawl-seed')
    return stored && SEED_MODES[stored] ? stored : DEFAULT_SEED
  })
  const [crawlDepth, setCrawlDepth] = useState(() => {
    const stored = window.localStorage?.getItem('xi-crawl-depth')
    return stored && DEPTH_MODES[stored] ? stored : DEFAULT_DEPTH
  })
  const [crawlMinBridges, setCrawlMinBridges] = useState(1)

  // Crawl-mode renderer: the three.js Cosmos universe (default) or the
  // legacy 2D force canvas — the floating bottom switch flips it.
  const [crawlEngine, setCrawlEngine] = useState(() => (
    window.localStorage?.getItem('xi-crawl-engine') === 'legacy' ? 'legacy' : 'cosmos'
  ))
  useEffect(() => {
    try { window.localStorage?.setItem('xi-crawl-engine', crawlEngine) } catch (_) {}
  }, [crawlEngine])

  // Legacy layout view (project mode only): 'web' = force graph (default),
  // 'hierarchy' = tier compartments under the hub, 'grid' = voice-type
  // compartments. Persisted so the user's pick sticks across visits.
  const [legacyLayout, setLegacyLayout] = useState(() => {
    const stored = window.localStorage?.getItem('xi-legacy-layout')
    return stored === 'hierarchy' || stored === 'grid' ? stored : 'web'
  })
  useEffect(() => {
    try { window.localStorage?.setItem('xi-legacy-layout', legacyLayout) } catch (_) {}
  }, [legacyLayout])

  const [projectId, setProjectId] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('project') || null
  })
  const [projectLabel, setProjectLabel] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('name') || 'X Bubbles'
  })
  // Timeframe drives the project-graph fetch window (24h | 7d) AND the
  // client-side date filter used by crawl/list views. Project mode defaults to
  // 7d so a known project paints its full author network, not the 24h sliver.
  const [timeframe, setTimeframe] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('project') ? '7d' : 'all'
  })

  // Sync mode + seed + projectId to URL params so refresh preserves state.
  useEffect(() => {
    const url = new URL(window.location)
    if (mode === 'crawl') {
      url.searchParams.set('mode', 'crawl')
      url.searchParams.set('seed', crawlSeed)
      url.searchParams.delete('project')
      url.searchParams.delete('name')
    } else {
      url.searchParams.delete('mode')
      url.searchParams.delete('seed')
      if (projectId) {
        url.searchParams.set('project', projectId)
        url.searchParams.set('name', projectLabel)
      } else {
        url.searchParams.delete('project')
        url.searchParams.delete('name')
      }
    }
    window.history.replaceState({}, '', url)
    try {
      window.localStorage?.setItem('xi-mode', mode)
      window.localStorage?.setItem('xi-crawl-seed', crawlSeed)
      window.localStorage?.setItem('xi-crawl-depth', crawlDepth)
    } catch (_) {}
  }, [mode, crawlSeed, crawlDepth, projectId, projectLabel])

  // Drill-down: in crawl mode, when the user clicks a project hub we fetch
  // its full author list and tweet feed via useProjectGraph and merge those
  // bubbles into the crawl galaxy. This is what makes the crawler "explode
  // open" — click a trending project and 15-30 more KOLs orbit it.
  const [drillProjectCgId, setDrillProjectCgId] = useState(null)
  const isCrawl = mode === 'crawl'
  const isProjectMode = !isCrawl && !!projectId
  // The cosmos covers BOTH shapes: the crawl galaxy AND the single-project
  // swarm (project = sun, its author network in orbit). The legacy force
  // canvas stays one switch away.
  const cosmosActive = (isCrawl || isProjectMode) && crawlEngine === 'cosmos'
  // Static (deterministic) layout is only meaningful in legacy + project mode.
  // Crawl mode (20 hubs) and Cosmos always fall back to 'web' behavior.
  const staticLayoutActive =
    !cosmosActive && isProjectMode && legacyLayout !== 'web'
  const projectGraphInput = isCrawl ? drillProjectCgId : projectId
  // Map the timeframe pill → upstream mention window. 24h stays tight; every
  // wider option pulls the 7d set (the widest the token endpoint serves).
  const projectFetchTimeframe = timeframe === '24h' ? '24h' : '7d'
  const projectGraph = useProjectGraph(projectGraphInput, projectFetchTimeframe)
  const crawlGraph = useCrawlGraph({
    seed: crawlSeed,
    projectCount: 20,
    depth: crawlDepth,
    enabled: isCrawl,
  })

  // Merge crawl + drill expansion. The drilled project's full author list
  // replaces the bootstrap's 3 top_authors stub for that one project, and
  // tweets get carried onto the hub node for the sidebar.
  const mergedGraph = useMemo(() => {
    if (!isCrawl) {
      return {
        nodes: projectGraph.nodes,
        links: projectGraph.links,
        adjacency: projectGraph.adjacency,
        hubNodeIds: projectGraph.hubNodeIds,
        intel: projectGraph.intel,
      }
    }
    if (!drillProjectCgId || !projectGraph.nodes?.length) {
      return {
        nodes: crawlGraph.nodes,
        links: crawlGraph.links,
        adjacency: crawlGraph.adjacency,
        hubNodeIds: crawlGraph.hubNodeIds,
        intel: null,
      }
    }
    // Project mode's hub uses a different id namespace (handle vs `proj:cgId`).
    // The crawl already has a node for this project — we want to keep its
    // crawl position and append its top_mentions + full author list. So:
    //   1. Find the crawl project node by cgId
    //   2. Copy its position/handle but overlay top_mentions
    //   3. Add the project-graph KOLs as new orbit nodes around it
    const crawlProjId = `proj:${drillProjectCgId.toLowerCase()}`
    const crawlHub = crawlGraph.nodes.find((n) => n.id === crawlProjId)
    if (!crawlHub) {
      return {
        nodes: crawlGraph.nodes,
        links: crawlGraph.links,
        adjacency: crawlGraph.adjacency,
        hubNodeIds: crawlGraph.hubNodeIds,
        intel: null,
      }
    }
    const projGraphHubId = [...projectGraph.hubNodeIds][0]
    // Merge top_mentions + KOL count from the project-graph hub onto the
    // crawl hub so the sidebar renders the rich data without changing
    // which node is selected.
    const enrichedNodes = crawlGraph.nodes.map((n) =>
      n.id === crawlProjId
        ? {
            ...n,
            topMentions: projectGraph.nodes.find((p) => p.id === projGraphHubId)?.topMentions || n.topMentions,
            intel: projectGraph.intel || n.intel,
            description: projectGraph.nodes.find((p) => p.id === projGraphHubId)?.description || n.description,
            twitterUrl: projectGraph.nodes.find((p) => p.id === projGraphHubId)?.twitterUrl || n.twitterUrl,
          }
        : n
    )

    // Take the KOL nodes from project graph (everything that isn't the hub),
    // remap their target edges from the project-graph hub id to the crawl
    // hub id, and ADD them as new bubbles in the galaxy. KOLs that already
    // exist in the crawl graph stay; new ones get added.
    const existingIds = new Set(enrichedNodes.map((n) => n.id))
    const extraNodes = []
    for (const p of projectGraph.nodes) {
      if (p.id === projGraphHubId) continue
      const remapId = `xkol:${p.id}` // namespace to avoid clashing with crawl KOL ids
      if (existingIds.has(remapId)) continue
      extraNodes.push({ ...p, id: remapId, _drilledFromCrawl: true })
    }

    const extraLinks = []
    for (const l of projectGraph.links) {
      if (l.target !== projGraphHubId && l.source !== projGraphHubId) continue
      const otherId = l.source === projGraphHubId ? l.target : l.source
      extraLinks.push({
        ...l,
        source: `xkol:${otherId}`,
        target: crawlProjId,
      })
    }

    const mergedNodes = [...enrichedNodes, ...extraNodes]
    const mergedLinks = [...crawlGraph.links, ...extraLinks]

    const mergedAdjacency = new Map()
    for (const n of mergedNodes) mergedAdjacency.set(n.id, new Set())
    for (const l of mergedLinks) {
      mergedAdjacency.get(l.source)?.add(l.target)
      mergedAdjacency.get(l.target)?.add(l.source)
    }

    return {
      nodes: mergedNodes,
      links: mergedLinks,
      adjacency: mergedAdjacency,
      hubNodeIds: crawlGraph.hubNodeIds,
      intel: null,
    }
    // Depend on the STABLE inner arrays (sourced from useState, so their identity
    // only changes when the data actually changes) — NOT the `crawlGraph` /
    // `projectGraph` wrapper objects, which the hooks recreate on every render.
    // Depending on the wrappers made this memo rebuild new nodes/links arrays
    // every render once drilled, restarting the force sim every frame → the
    // "flicker like mad" on clicking a project bubble in crawl mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isCrawl, drillProjectCgId,
    crawlGraph.nodes, crawlGraph.links, crawlGraph.adjacency, crawlGraph.hubNodeIds,
    projectGraph.nodes, projectGraph.links, projectGraph.adjacency, projectGraph.hubNodeIds, projectGraph.intel,
  ])

  // Cosmos-shaped graph: crawl passes straight through; project mode
  // synthesizes the {projectNodes, kolNodes} split from the single-project
  // graph so the same builder renders the swarm (zero force-sim work).
  const cosmosGraph = useMemo(() => {
    if (isCrawl) return crawlGraph
    const nodes = mergedGraph.nodes || []
    const hubIds = mergedGraph.hubNodeIds || new Set()
    const hub = nodes.find((n) => hubIds.has(n.id))
    if (!hub) {
      return { projectNodes: [], kolNodes: [], projectAdjacency: new Map(), loading: projectGraph.loading }
    }
    const byKol = new Map()
    for (const l of (mergedGraph.links || [])) {
      const arr = byKol.get(l.source) || []
      arr.push(l)
      byKol.set(l.source, arr)
    }
    const kolNodes = nodes
      .filter((n) => !hubIds.has(n.id))
      .map((n) => ({
        ...n,
        projects: (byKol.get(n.id) || []).map((l) => ({
          projectId: l.target,
          mentions: l.tweetCount || 0,
          weightedEngagement: l.weightedEngagement || 0,
        })),
      }))
    return {
      projectNodes: [{ ...hub, cgId: hub.cgId || projectId, intel: mergedGraph.intel || hub.intel }],
      kolNodes,
      projectAdjacency: new Map(),
      loading: projectGraph.loading,
      refreshedAt: null,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCrawl, crawlGraph, mergedGraph, projectGraph.loading, projectId])

  const allNodes = mergedGraph.nodes
  const allLinks = mergedGraph.links
  const ADJACENCY = mergedGraph.adjacency
  const HUB_NODE_IDS = mergedGraph.hubNodeIds
  const projectName = isCrawl ? 'Crawl' : projectGraph.projectName
  const projectIntel = isCrawl ? null : mergedGraph.intel
  const projectLoading = isCrawl ? crawlGraph.loading : projectGraph.loading
  const projectError = isCrawl ? crawlGraph.error : projectGraph.error
  const crawlSummary = crawlGraph.summary
  const crawlBridgeArcs = isCrawl ? crawlGraph.bridgeArcs : null

  // Use projectId directly for landing visibility - don't rely on hook's isEmpty
  // which has a timing gap between setting projectId and the hook returning isEmpty=false
  const noProjectSelected = !isCrawl && !projectId

  // Trigger the one-time symbology hint the first time a graph is actually on
  // screen (project loaded, not landing/loading). Guarded by a ref so it fires
  // exactly once per page mount.
  const graphVisible = !noProjectSelected && !projectLoading
  useEffect(() => {
    if (!graphVisible || symbologyHintShownRef.current) return
    symbologyHintShownRef.current = true
    setShowSymbologyHint(true)
    const t = setTimeout(() => setShowSymbologyHint(false), 6000)
    return () => clearTimeout(t)
  }, [graphVisible])

  const handleSelectProject = useCallback((project) => {
    setProjectId(project.cgId)
    setProjectLabel(project.name || project.symbol)
    setSelectedNodeId(null)
    setSearchQuery('')
    setMinFollowers(0) // show all authors for API-loaded projects
    setTimeframe('7d') // project mode → 7d window (full author network, not the 24h sliver)
    setMode('project') // jumping into a project always lands in project mode
  }, [])

  const handleBackToLanding = useCallback(() => {
    setProjectId(null)
    setProjectLabel('X Bubbles')
    setSelectedNodeId(null)
  }, [])

  const handleModeChange = useCallback((next) => {
    if (next !== 'project' && next !== 'crawl') return
    setMode(next)
    setSelectedNodeId(null)
    setDrillProjectCgId(null)
    setSearchQuery('')
    setCrawlSheetOpen(false)
    if (next === 'crawl') {
      // Crawl mode shows everything; bump the follower floor down so
      // small-account bridge KOLs aren't filtered out by the project-mode
      // default.
      setMinFollowers(0)
    }
  }, [])

  const handleCrawlSeedChange = useCallback((next) => {
    if (!SEED_MODES[next]) return
    setCrawlSeed(next)
    setSelectedNodeId(null)
    setDrillProjectCgId(null)
  }, [])

  const handleCrawlDepthChange = useCallback((next) => {
    if (!DEPTH_MODES[next]) return
    setCrawlDepth(next)
  }, [])

  // ── UI state ─────────────────────────────────────────────────────────────
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [mousePos, setMousePos] = useState(null)
  // On laptops the canvas is fighting for space with the app nav + entity
  // sidebar; default the filter panel to collapsed so first paint shows the
  // whole galaxy. User can re-open with one click.
  const [isFilterCollapsed, setIsFilterCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth <= 1400
  })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  // Warp watchdog: the settle warp is a brief flourish shown while the force
  // sim cools. In the legacy crawl view the ~20-hub sim can rebuild faster than
  // it settles, so `isSettled` never lands true and the warp would stick and
  // black out the whole board. Force it off a bounded time after the graph
  // identity changes — the warp clears no matter what the sim reports.
  const [warpAllowed, setWarpAllowed] = useState(true)
  // 'graph' = bubble galaxy, 'chart' = full-screen price chart with mentions
  const [surface, setSurface] = useState('graph')
  // Mention hovered on the MentionChart — bubbled up so the right sidebar
  // can show a full tweet preview instead of relying on the small floating
  // tooltip that used to cover the chart.
  const [hoveredChartMention, setHoveredChartMention] = useState(null)
  // Live price snapshot lifted out of MentionChart so the EntitySidebar
  // can render its own Price block in chart mode.
  const [chartPriceData, setChartPriceData] = useState(null)

  // One-time symbology caption shown over the canvas the first time a graph
  // becomes visible, so a new user can decode the encoding (size/color/lines)
  // without hunting for the Legend. Fades out via CSS then unmounts.
  const [showSymbologyHint, setShowSymbologyHint] = useState(false)
  const symbologyHintShownRef = useRef(false)

  // We INTENTIONALLY do not auto-select the hub. Selecting a node tells the
  // canvas to dim everything outside its neighborhood — fine when the user
  // clicks, wrong on first paint (the entire graph would render dim). The
  // sidebar instead falls back to `defaultSidebarNode` below so the
  // intelligence data shows immediately without touching the graph.

  // ── Filter state ─────────────────────────────────────────────────────────
  const [activeTiers, setActiveTiers] = useState(() => new Set(TIER_ORDER))
  const [activeTypes, setActiveTypes] = useState(() => new Set(Object.keys(TYPE_LABELS)))
  const [searchQuery, setSearchQuery] = useState('')
  // If loading from URL params, start with 0 so all authors show
  const [minFollowers, setMinFollowers] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('project') ? 0 : DEFAULT_MIN_FOLLOWERS
  })
  const [focusMode, setFocusMode] = useState(false)
  const [organizeByType, setOrganizeByType] = useState(false)
  const [viewMode, setViewMode] = useState('default')
  const [showListView, setShowListView] = useState(false)
  const [showConnections, setShowConnections] = useState(true)

  // ── Pre-filter nodes by follower count + timeframe (affects simulation input)
  const { nodes, links, nodeMap } = useMemo(() => {
    const baseNodes = allNodes.filter((n) => {
      if (HUB_NODE_IDS.has(n.id)) return true
      // Crawl mode: min-bridges slider trumps follower filter so the user can
      // isolate the "wire-the-ecosystem" KOLs even when they have few followers.
      if (isCrawl && crawlMinBridges > 1) {
        return (n.bridgeCount || 0) >= crawlMinBridges
      }
      return n.followers >= minFollowers
    })
    const baseNodeIds = new Set(baseNodes.map((n) => n.id))

    // Timeframe cutoff. In project mode the FETCH already scoped the window
    // (24h | 7d) upstream, and project links carry only an author last-seen
    // date — so applying a client-side cutoff here would needlessly drop nodes.
    // Crawl links carry NO dates at all (latestTweetDate: null), so a cutoff
    // there deletes every link + KOL and leaves 20 bare hubs — exempt it too.
    // The cutoff is meaningful only for static graphs (richly dated links).
    let cutoff = null
    if (timeframe !== 'all' && !isProjectMode && !isCrawl) {
      const now = Date.now()
      const days = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 }
      cutoff = new Date(now - (days[timeframe] || 0) * 86400000)
    }

    // Filter links by timeframe — links without a date are excluded when timeframe is active
    const filteredLinks = allLinks.filter((l) => {
      if (!baseNodeIds.has(l.source) || !baseNodeIds.has(l.target)) return false
      if (cutoff) {
        if (!l.latestTweetDate) return false // no date = excluded in timeframe mode
        if (l.latestTweetDate < cutoff) return false
      }
      return true
    })

    // When timeframe is active, only show nodes that have at least one connection
    // (plus hub nodes which always show)
    let filteredNodes = baseNodes
    if (cutoff) {
      const activeNodeIds = new Set()
      for (const l of filteredLinks) {
        activeNodeIds.add(l.source)
        activeNodeIds.add(l.target)
      }
      // Hub nodes always visible
      for (const id of HUB_NODE_IDS) activeNodeIds.add(id)
      filteredNodes = baseNodes.filter((n) => activeNodeIds.has(n.id))
    }

    const map = new Map()
    for (const n of filteredNodes) map.set(n.id, n)
    return { nodes: filteredNodes, links: filteredLinks, nodeMap: map }
  }, [allNodes, allLinks, HUB_NODE_IDS, minFollowers, timeframe, isCrawl, isProjectMode, crawlMinBridges])

  // ── Canvas dimensions ────────────────────────────────────────────────────
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const measure = () => {
      const rect = container.getBoundingClientRect()
      setDimensions({ width: rect.width, height: rect.height })
    }
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Viewport-aware shrink for node radii. 900 = reference desktop layout.
  // Floor of 0.5 keeps bubbles tap-friendly on the smallest phones.
  const radiusScale = useMemo(() => {
    if (!dimensions.width || !dimensions.height) return 1
    return Math.max(0.5, Math.min(1, Math.min(dimensions.width, dimensions.height) / 900))
  }, [dimensions])

  // ── Static layout (Hierarchy / Grid) — deterministic, no force sim. ──────
  // Solve positions + compartment rects in a pure helper. Recomputes only when
  // the node set / dimensions / layout / hub set changes (NOT every frame).
  const staticLayout = useMemo(() => {
    if (!staticLayoutActive) return null
    // Solve over ONLY the nodes the canvas will actually draw (tier/type/search
    // filtered) so compartment counts + boxes match what's on screen. The same
    // predicate `filteredNodeIds` uses, inlined here to avoid depending on that
    // later-declared memo (a TDZ trap).
    const q = searchQuery.toLowerCase()
    const layoutNodes = nodes.filter((n) => {
      if (HUB_NODE_IDS.has(n.id)) return true
      if (!activeTiers.has(n.tier)) return false
      if (!activeTypes.has(n.type)) return false
      if (q) {
        const name = (n.name || '').toLowerCase()
        const handle = (n.handle || n.id || '').toLowerCase()
        if (!name.includes(q) && !handle.includes(q)) return false
      }
      return true
    })
    return solveLegacyLayout(layoutNodes, HUB_NODE_IDS, dimensions, legacyLayout, radiusScale)
  }, [staticLayoutActive, nodes, activeTiers, activeTypes, searchQuery, HUB_NODE_IDS, dimensions, legacyLayout, radiusScale])

  // A stable ref mirroring the static positions — GraphCanvas reads
  // livePositionsRef every frame, and useGraphInteraction hit-tests off the
  // `positions` prop. Feeding a static object to both keeps hover/click/zoom
  // working exactly as in the force layout, with zero simulation.
  const staticPositionsRef = useRef({})
  staticPositionsRef.current = staticLayout ? staticLayout.positions : {}

  // ── Force simulation ─────────────────────────────────────────────────────
  // While the Cosmos OR a static layout renders, feed the d3 force sim
  // nothing — a hidden 100+-node simulation would burn CPU behind the other
  // renderer. Static layouts are deterministic and need no sim.
  const simStarved = cosmosActive || staticLayoutActive
  const { positions: simPositions, positionsRef: simPositionsRef, isSettled, dragStart, dragMove, dragEnd } =
    useForceSimulation(
      simStarved ? EMPTY_GRAPH_NODES : nodes,
      simStarved ? EMPTY_GRAPH_LINKS : links,
      dimensions, organizeByType, HUB_NODE_IDS, radiusScale,
    )

  // What the canvas + interaction see: static positions when a static layout is
  // active, otherwise the live force-sim output.
  const positions = staticLayoutActive ? staticLayout?.positions || EMPTY_POSITIONS : simPositions
  const positionsRef = staticLayoutActive ? staticPositionsRef : simPositionsRef
  // Node drag is disabled in static layouts — voices live in their tidy grid.
  const noop = useCallback(() => {}, [])
  const dragStartEff = staticLayoutActive ? noop : dragStart
  const dragMoveEff = staticLayoutActive ? noop : dragMove
  const dragEndEff = staticLayoutActive ? noop : dragEnd

  // ── Graph interaction (d3-zoom on canvas, hit-testing, dragging) ────────
  const handleSelectNode = useCallback((id) => {
    setSelectedNodeId(id)
    // Tapping a node on mobile opens its entity sheet — dismiss the crawl
    // dashboard sheet so the two sheets never stack.
    if (id) setCrawlSheetOpen(false)
    // Crawl-mode drill-down: selecting a project hub fetches its full
    // KOL list + tweet feed and merges them into the galaxy.
    if (isCrawl && id && id.startsWith('proj:')) {
      const cgId = id.slice(5)
      setDrillProjectCgId(cgId)
    } else if (!id) {
      setDrillProjectCgId(null)
    }
  }, [isCrawl])
  const [hoveredNodeId, setHoveredNodeId] = useState(null)
  const handleHoverNode = useCallback((id) => setHoveredNodeId(id), [])

  const {
    transformRef,
    hoveredNodeId: interactionHoveredId,
    draggingNodeId,
    resetZoom,
    resetZoomImmediate,
    zoomIn,
    zoomOut,
    zoomToNode,
  } = useGraphInteraction(canvasRef, {
    nodes,
    positions,
    adjacency: ADJACENCY,
    getRadius: useCallback((node) => getNodeRadius(node, radiusScale), [radiusScale]),
    onSelectNode: handleSelectNode,
    onHoverNode: handleHoverNode,
    dragStart: dragStartEff,
    dragMove: dragMoveEff,
    dragEnd: dragEndEff,
    focusMode,
  })

  // The canvas (and d3-zoom's internal __zoom) outlives every mode switch, so
  // a pan/zoom from one graph would be applied verbatim to the next — crawl's
  // zoomed-in corner rendering the project graph off-screen ("screen goes
  // wonky"). Reset the transform whenever the graph identity changes.
  useEffect(() => {
    resetZoomImmediate()
  }, [mode, crawlEngine, projectId, legacyLayout, resetZoomImmediate])

  // Warp watchdog (see warpAllowed above): allow the settle warp for a bounded
  // window after the graph identity changes, then force it off. Caps how long
  // the warp can obscure the board even if the sim never reports settled.
  useEffect(() => {
    setWarpAllowed(true)
    const t = setTimeout(() => setWarpAllowed(false), 2200)
    return () => clearTimeout(t)
  }, [mode, crawlEngine, projectId, legacyLayout])

  // Leaving legacy for the Cosmos: wipe the hidden canvas buffer so the last
  // pre-Cosmos frame (old graph, old transform) never flashes on the way back.
  useEffect(() => {
    if (cosmosActive && canvasRef.current) {
      const c = canvasRef.current
      c.getContext('2d')?.clearRect(0, 0, c.width, c.height)
    }
  }, [cosmosActive])

  // Merge hover sources
  const activeHoveredId = interactionHoveredId || hoveredNodeId

  // The floating NodeTooltip only renders while a node is hovered (and nothing
  // is selected). Mirror that condition in a ref so the mousemove handler can
  // skip pushing React state when no tooltip is visible — otherwise moving the
  // cursor anywhere over the canvas re-rendered the whole page.
  const tooltipActiveRef = useRef(false)
  tooltipActiveRef.current = !!activeHoveredId && !selectedNodeId

  // ── Mouse position tracking for tooltip ─────────────────────────────────
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let rafId = null
    let pending = null
    const flush = () => {
      rafId = null
      if (pending) setMousePos(pending)
    }
    const handleMove = (e) => {
      // No tooltip showing → don't re-render on movement at all.
      if (!tooltipActiveRef.current) return
      pending = { x: e.clientX, y: e.clientY }
      // Coalesce to at most one state update per frame.
      if (rafId == null) rafId = requestAnimationFrame(flush)
    }
    const handleLeave = () => {
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null }
      pending = null
      setMousePos(null)
    }

    el.addEventListener('mousemove', handleMove)
    el.addEventListener('mouseleave', handleLeave)
    return () => {
      el.removeEventListener('mousemove', handleMove)
      el.removeEventListener('mouseleave', handleLeave)
      if (rafId != null) cancelAnimationFrame(rafId)
    }
  }, [])

  // ── Compute filtered node IDs (tier + type + search, on top of follower filter)
  const filteredNodeIds = useMemo(() => {
    const q = searchQuery.toLowerCase()
    const ids = nodes
      .filter((n) => {
        if (!activeTiers.has(n.tier)) return false
        if (!activeTypes.has(n.type)) return false
        if (q) {
          const name = (n.name || '').toLowerCase()
          const handle = (n.handle || n.id || '').toLowerCase()
          if (!name.includes(q) && !handle.includes(q)) return false
        }
        return true
      })
      .map((n) => n.id)
    // Hub nodes must always be included regardless of filters
    for (const hubId of HUB_NODE_IDS) {
      if (nodeMap.has(hubId) && !ids.includes(hubId)) {
        ids.push(hubId)
      }
    }
    return ids
  }, [nodes, activeTiers, activeTypes, searchQuery, nodeMap, HUB_NODE_IDS])

  // ── Selected node data ───────────────────────────────────────────────────
  const selectedNode = useMemo(
    () => (selectedNodeId ? nodeMap.get(selectedNodeId) || null : null),
    [selectedNodeId, nodeMap],
  )

  // Sidebar default: when nothing is explicitly selected, show the project
  // hub in the right rail. Crucially this does NOT feed back into
  // selectedNodeId, so the canvas stays in its idle (un-dimmed) state.
  const defaultSidebarNode = useMemo(() => {
    if (selectedNodeId) return null            // explicit selection wins
    if (isCrawl) return null                   // crawl has its own dashboard
    if (!projectId) return null                // landing — no fallback needed
    if (!HUB_NODE_IDS || HUB_NODE_IDS.size === 0) return null
    const [firstHub] = HUB_NODE_IDS
    return firstHub ? nodeMap.get(firstHub) || null : null
  }, [selectedNodeId, isCrawl, projectId, HUB_NODE_IDS, nodeMap])

  // The id we use for "show connections of THIS in the sidebar" — either the
  // user-selected node or the default hub. Separate from `selectedNodeId`
  // which drives the canvas's focus/dim behavior.
  const sidebarFocusId = selectedNodeId || defaultSidebarNode?.id || null
  const sidebarNode = selectedNode || defaultSidebarNode

  const connectedNodes = useMemo(() => {
    if (!sidebarFocusId) return []
    const neighbors = ADJACENCY.get(sidebarFocusId)
    if (!neighbors) return []
    return allNodes.filter((n) => neighbors.has(n.id))
  }, [sidebarFocusId, ADJACENCY, allNodes])

  const connectedLinks = useMemo(() => {
    if (!sidebarFocusId) return []
    return allLinks.filter(
      (l) => l.source === sidebarFocusId || l.target === sidebarFocusId,
    )
  }, [sidebarFocusId, allLinks])

  // Hovered node for tooltip
  const hoveredNode = useMemo(
    () => (activeHoveredId ? nodeMap.get(activeHoveredId) || null : null),
    [activeHoveredId, nodeMap],
  )

  // Nodes with activity in last 24 hours (for live indicator dots)
  const recentNodeIds = useMemo(() => {
    const cutoff24h = new Date(Date.now() - 86400000)
    const recent = new Set()
    for (const link of links) {
      if (link.latestTweetDate && link.latestTweetDate > cutoff24h) {
        recent.add(link.source)
        recent.add(link.target)
      }
    }
    return recent
  }, [links])

  // ── Filter handlers ──────────────────────────────────────────────────────
  const handleToggleTier = useCallback((tier) => {
    if (tier === 'all') {
      setActiveTiers(new Set(TIER_ORDER))
      return
    }
    setActiveTiers((prev) => {
      const next = new Set(prev)
      if (next.has(tier)) {
        next.delete(tier)
        if (next.size === 0) return prev
      } else {
        next.add(tier)
      }
      return next
    })
  }, [])

  const handleToggleType = useCallback((type) => {
    if (type === 'all') {
      setActiveTypes(new Set(Object.keys(TYPE_LABELS)))
      return
    }
    setActiveTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
        if (next.size === 0) return prev
      } else {
        next.add(type)
      }
      return next
    })
  }, [])

  // ── View mode cycling ───────────────────────────────────────────────
  const handleCycleViewMode = useCallback(() => {
    setViewMode((prev) => {
      if (prev === 'default') return 'constellation'
      if (prev === 'constellation') return 'heatmap'
      return 'default'
    })
  }, [])

  // ── Fullscreen ───────────────────────────────────────────────────────────
  const handleToggleFullscreen = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(() => setIsFullscreen(true))
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false))
    }
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      // ESC — deselect entity, close list view
      if (e.key === 'Escape') {
        if (showListView) setShowListView(false)
        else if (selectedNodeId) setSelectedNodeId(null)
      }
      // F — toggle fullscreen
      if (e.key === 'f' && !e.ctrlKey && !e.metaKey && e.target.tagName !== 'INPUT') {
        handleToggleFullscreen()
      }
      // Graph-surface shortcuts below mutate the HIDDEN legacy canvas while
      // the Cosmos renders (zoom compounds invisibly, L pops ListView open on
      // return) — only Escape/F stay global.
      if (cosmosActive) return
      // + / = — zoom in
      if ((e.key === '+' || e.key === '=') && !e.ctrlKey && e.target.tagName !== 'INPUT') {
        zoomIn()
      }
      // - — zoom out
      if (e.key === '-' && !e.ctrlKey && e.target.tagName !== 'INPUT') {
        zoomOut()
      }
      // L — toggle list view
      if (e.key === 'l' && !e.ctrlKey && !e.metaKey && e.target.tagName !== 'INPUT') {
        setShowListView(p => !p)
      }
      // C — toggle connections
      if (e.key === 'c' && !e.ctrlKey && !e.metaKey && e.target.tagName !== 'INPUT') {
        setShowConnections(p => !p)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showListView, selectedNodeId, handleToggleFullscreen, zoomIn, zoomOut, cosmosActive])

  // ── Navigate to node (from sidebar or search) ───────────────────────────
  const handleNavigateToNode = useCallback(
    (nodeId) => {
      setSelectedNodeId(nodeId)
      zoomToNode(nodeId)
      setIsTransitioning(true)
      setTimeout(() => setIsTransitioning(false), 600)
    },
    [zoomToNode],
  )

  // ── Render ───────────────────────────────────────────────────────────────
  // The chart surface replaces the bubble canvas full-bleed. Only available
  // when there's a project hub focused (project mode or a drilled project
  // in crawl mode); falls back to 'graph' surface otherwise.
  const chartCandidate = sidebarNode && sidebarNode.isHub && sidebarNode.cgId ? sidebarNode : null
  const surfaceEffective = surface === 'chart' && chartCandidate ? 'chart' : 'graph'

  return (
    <div className={`xi-page xi-surface--${surfaceEffective}${isMobile ? ' xi-page--mobile' : ''}`} ref={containerRef}>
      {/* Full-viewport canvas — d3-zoom attaches here, GraphCanvas draws here.
          ALWAYS mounted (hidden under the Cosmos): useGraphInteraction binds
          d3-zoom in a mount effect keyed on the REF, so a canvas that appears
          later never gets its pan/zoom/drag handlers ("can't move legacy"). */}
      <canvas ref={canvasRef} className="xi-canvas" style={cosmosActive ? { display: 'none' } : undefined} />

      {/* Ambient "neural web" background removed — was creating the space-fade
          look the user explicitly nuked. The flat canvas background does the
          heavy lifting now. Kept on the landing screen only. */}

      {/* Warp-speed star-field while graph settles or during node navigation.
          Suppressed on the empty landing — there's nothing to settle yet. */}
      {!cosmosActive && (
        <LightspeedLoader
          active={!noProjectSelected && !staticLayoutActive && warpAllowed && (!isSettled || isTransitioning)}
          dayMode={dayMode}
        />
      )}

      {/* Drawing engine (renders to canvas, no DOM output) */}
      {!cosmosActive && (
        <GraphCanvas
          nodes={nodes}
          links={links}
          positions={positions}
          livePositionsRef={positionsRef}
          radiusScale={radiusScale}
          transformRef={transformRef}
          hoveredNodeId={activeHoveredId}
          selectedNodeId={selectedNodeId}
          draggingNodeId={draggingNodeId}
          adjacency={ADJACENCY}
          dayMode={dayMode}
          filteredNodeIds={filteredNodeIds}
          canvasRef={canvasRef}
          nodeMap={nodeMap}
          focusMode={focusMode}
          recentNodeIds={recentNodeIds}
          viewMode={viewMode}
          showConnections={showConnections}
          hubNodeIds={HUB_NODE_IDS}
          bridgeArcs={crawlBridgeArcs}
          isCrawl={isCrawl}
          layoutGroups={staticLayout ? staticLayout.groups : null}
          staticLayout={staticLayoutActive}
        />
      )}

      {/* The KOL ↔ project universe — three.js Cosmos engine, crawl mode's
          default renderer. Selection flows back through handleSelectNode so
          EntitySidebar + drill-down behave exactly as on the legacy canvas. */}
      {cosmosActive && (
        <div className="xb-cosmos-host">
          <Suspense fallback={null}>
            <XBubblesCosmos
              graph={cosmosGraph}
              mode={isCrawl ? 'crawl' : 'project'}
              dayMode={dayMode}
              isMobile={isMobile}
              crawlSeed={crawlSeed}
              onCrawlSeedChange={handleCrawlSeedChange}
              crawlDepth={crawlDepth}
              onCrawlDepthChange={handleCrawlDepthChange}
              selectedNodeId={selectedNodeId}
              onSelectNode={handleSelectNode}
              onExitToLanding={() => { handleBackToLanding(); setMode('project') }}
            />
          </Suspense>
        </div>
      )}

      {/* Full-screen chart surface — replaces the bubble graph when active.
          Lives at the same z-level so the FilterPanel + EntitySidebar stay
          on top. Only mounts when there's a project hub focused. */}
      {surfaceEffective === 'chart' && chartCandidate && (
        <div className="xi-chart-surface">
          <Suspense fallback={null}>
            <MentionChart
              cgId={chartCandidate.cgId}
              mentions={chartCandidate.topMentions || []}
              projectName={chartCandidate.name}
              projectAvatar={chartCandidate.avatar}
              fullScreen
              onHoverMention={setHoveredChartMention}
              onPriceData={setChartPriceData}
            />
          </Suspense>
        </div>
      )}

      {/* Bubbles ↔ Chart surface toggle. Only shown when there's a project
          hub focused so users can flip between the social graph and the
          price chart with KOL mention annotations. */}
      {chartCandidate && (
        <div className="xi-surface-toggle">
          <button
            type="button"
            className={`xi-surface-toggle__btn${surfaceEffective === 'graph' ? ' is-on' : ''}`}
            onClick={() => setSurface('graph')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="5" cy="12" r="2.5" />
              <circle cx="19" cy="6" r="2.5" />
              <circle cx="19" cy="18" r="2.5" />
              <path d="M7 11.4l10-4.7M7 12.6l10 4.7" />
            </svg>
            Bubbles
          </button>
          <button
            type="button"
            className={`xi-surface-toggle__btn${surfaceEffective === 'chart' ? ' is-on' : ''}`}
            onClick={() => setSurface('chart')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 17l5-5 4 4 8-8" />
              <path d="M14 8h6v6" />
            </svg>
            Chart
          </button>
        </div>
      )}

      {/* Landing state - no project selected */}
      {noProjectSelected && !projectLoading && (
        <div className={`xi-landing${dayMode ? ' xi-landing--day' : ''}`}>
          {/* Neural web background canvas */}
          <AmbientGlow dayMode={dayMode} />
          <div className="xi-landing__content">
            <div className="xi-landing__hero">
              <div className="xi-landing__icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="2.5" />
                  <circle cx="5" cy="8" r="1.5" opacity="0.5" />
                  <circle cx="19" cy="8" r="1.5" opacity="0.5" />
                  <circle cx="5" cy="16" r="1.5" opacity="0.5" />
                  <circle cx="19" cy="16" r="1.5" opacity="0.5" />
                  <path d="M7 8.5L9.5 10.5M14.5 10.5L17 8.5M7 15.5L9.5 13.5M14.5 13.5L17 15.5" opacity="0.35" />
                </svg>
              </div>
              <h1 className="xi-landing__title">X Bubbles</h1>
              <p className="xi-landing__subtitle">Explore the social influence network behind any crypto project</p>
            </div>

            <div className="xi-landing__search">
              <ProjectSearchBar
                currentProject="Search a project"
                onSelectProject={handleSelectProject}
                dayMode={dayMode}
                autoFocus
              />
              <span className="xi-landing__search-hint">Press Enter to explore</span>
            </div>

            {/* Doorway into the crawl universe (Cosmos engine) — the galaxy of
                trending projects + the KOLs carrying them */}
            <button
              type="button"
              className="xb-landing-cta"
              onClick={() => { setCrawlEngine('cosmos'); setMode('crawl') }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                <circle cx="12" cy="12" r="3.2" />
                <ellipse cx="12" cy="12" rx="9.5" ry="3.6" transform="rotate(-18 12 12)" />
              </svg>
              Enter the universe
              <span className="xb-landing-cta__sub">trending projects · the voices behind them</span>
            </button>

            <TrendingSection onSelectProject={handleSelectProject} dayMode={dayMode} />
          </div>
        </div>
      )}

      {/* Loading overlay when switching projects */}
      {projectLoading && (
        <div className="xi-project-loading">
          <div className="xi-project-loading__text">Loading {projectLabel} social graph...</div>
        </div>
      )}

      {/* Floating panels - only show when a project is loaded. The Cosmos
          brings its own HUD (views, designs, seed/depth, search, legend). */}
      {!noProjectSelected && !cosmosActive && (
        <>
          <SearchOverlay
            nodes={allNodes}
            onSelectNode={handleNavigateToNode}
            dayMode={dayMode}
          />

          <FilterPanel
            nodes={nodes}
            links={links}
            filteredNodeIds={filteredNodeIds}
            activeTiers={activeTiers}
            onToggleTier={handleToggleTier}
            activeTypes={activeTypes}
            onToggleType={handleToggleType}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            isCollapsed={isFilterCollapsed}
            onToggleCollapse={() => setIsFilterCollapsed((p) => !p)}
            dayMode={dayMode}
            loading={projectLoading}
            minFollowers={minFollowers}
            onMinFollowersChange={setMinFollowers}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            timeframeOptions={isProjectMode ? PROJECT_TIMEFRAME_OPTIONS : undefined}
            projectName={isCrawl ? 'X Crawler' : projectLabel}
            onBack={isCrawl ? null : handleBackToLanding}
            intel={projectIntel}
            mode={mode}
            onModeChange={handleModeChange}
            crawlSeed={crawlSeed}
            onCrawlSeedChange={handleCrawlSeedChange}
            crawlDepth={crawlDepth}
            onCrawlDepthChange={handleCrawlDepthChange}
            crawlSummary={crawlSummary}
            crawlMinBridges={crawlMinBridges}
            onCrawlMinBridgesChange={setCrawlMinBridges}
            projectSearchBar={
              !isCrawl && (
                <ProjectSearchBar
                  currentProject={projectLabel}
                  onSelectProject={handleSelectProject}
                  dayMode={dayMode}
                />
              )
            }
          />

          <Legend dayMode={dayMode} filterCollapsed={isFilterCollapsed} />

          {/* One-time onboarding caption — decodes the visual encoding for a
              first-time viewer, then fades out so it never clutters the view. */}
          {showSymbologyHint && (
            <div className="xi-symbology-hint" aria-hidden>
              <span className="xi-symbology-hint__dot" />
              Bubble size = influence
              <span className="xi-symbology-hint__sep">·</span>
              color = tier
              <span className="xi-symbology-hint__sep">·</span>
              lines = mentions
            </div>
          )}

          <FlightControls
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onResetView={resetZoom}
            onToggleFullscreen={handleToggleFullscreen}
            isFullscreen={isFullscreen}
            dayMode={dayMode}
            onToggleDayMode={onToggleDayMode}
            focusMode={focusMode}
            onToggleFocusMode={() => setFocusMode((p) => !p)}
            organizeByType={organizeByType}
            onToggleOrganize={() => setOrganizeByType((p) => !p)}
            viewMode={viewMode}
            onCycleViewMode={handleCycleViewMode}
            showListView={showListView}
            onToggleListView={() => setShowListView((p) => !p)}
            showConnections={showConnections}
            onToggleConnections={() => setShowConnections((p) => !p)}
          />
        </>
      )}

      {/* List view overlay */}
      {showListView && !cosmosActive && (
        <Suspense fallback={null}>
          <ListView
            nodes={nodes}
            links={links}
            adjacency={ADJACENCY}
            onSelectNode={(nodeId) => {
              handleNavigateToNode(nodeId)
              setShowListView(false)
            }}
            onClose={() => setShowListView(false)}
            dayMode={dayMode}
          />
        </Suspense>
      )}

      {/* Mobile: dim scrim behind any open bottom sheet (tap to dismiss). */}
      {isMobile && (selectedNode || crawlSheetOpen) && (
        <div
          className="xig-scrim"
          onClick={() => { setSelectedNodeId(null); setCrawlSheetOpen(false) }}
          aria-hidden="true"
        />
      )}

      {/* Mobile crawl-dashboard launcher — opens the CrawlSidebar as a sheet
          instead of letting it cover the graph on load. */}
      {isMobile && isCrawl && !cosmosActive && !selectedNode && !crawlSheetOpen && (
        <button
          type="button"
          className="xig-crawl-launch"
          onClick={() => setCrawlSheetOpen(true)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="3" width="7" height="9" rx="1" />
            <rect x="14" y="3" width="7" height="5" rx="1" />
            <rect x="14" y="12" width="7" height="9" rx="1" />
            <rect x="3" y="16" width="7" height="5" rx="1" />
          </svg>
          Dashboard
        </button>
      )}

      {/* Right rail:
            crawl + nothing selected  → galaxy dashboard (Top Carriers etc.)
            anything selected         → EntitySidebar (works for both modes;
                                        in crawl, KOL nodes get a project-list
                                        variant via node.projects[])
          On mobile both become bottom sheets: the crawl dashboard only when
          launched, the entity sheet only on an explicit node tap (never the
          default-hub fallback, which would cover the graph). */}
      {isCrawl && !cosmosActive && !selectedNode && (!isMobile || crawlSheetOpen) && (
        <Suspense fallback={null}>
          <CrawlSidebar
            summary={crawlSummary}
            loading={projectLoading}
            refreshedAt={crawlGraph.refreshedAt}
            onSelectProject={(cgId, name) => handleSelectProject({ cgId, name })}
            onSelectKol={(kolId) => setSelectedNodeId(kolId)}
            onClose={isMobile ? () => setCrawlSheetOpen(false) : null}
            dayMode={dayMode}
          />
        </Suspense>
      )}
      {(isMobile ? selectedNode : sidebarNode) && (
        <Suspense fallback={null}>
          <EntitySidebar
            node={isMobile ? selectedNode : sidebarNode}
            connectedNodes={connectedNodes}
            connectedLinks={connectedLinks}
            onClose={(selectedNode || isMobile) ? () => setSelectedNodeId(null) : null}
            onNavigateToNode={handleNavigateToNode}
            onEnterProject={handleSelectProject}
            mode={mode}
            dayMode={dayMode}
            hoveredMention={surfaceEffective === 'chart' ? hoveredChartMention : null}
            priceData={surfaceEffective === 'chart' ? chartPriceData : null}
          />
        </Suspense>
      )}

      {hoveredNode && !selectedNodeId && mousePos && (
        <NodeTooltip
          node={hoveredNode}
          position={mousePos}
          dayMode={dayMode}
        />
      )}

      {/* Cosmos ↔ legacy renderer switch (crawl + project modes) */}
      {(isCrawl || isProjectMode) && (
        <div className="xb-engine-switch" role="tablist" aria-label="Crawl renderer">
          <button
            type="button"
            className={crawlEngine === 'cosmos' ? 'is-on' : ''}
            onClick={() => setCrawlEngine('cosmos')}
          >
            Cosmos
          </button>
          <button
            type="button"
            className={crawlEngine === 'legacy' ? 'is-on' : ''}
            onClick={() => setCrawlEngine('legacy')}
          >
            Legacy
          </button>
        </div>
      )}

      {/* Legacy layout switcher — legacy engine + project mode only. Web =
          force graph; Hierarchy = reach-tier compartments; Grid = voice-type
          compartments. Hidden in crawl (20 hubs) + cosmos. */}
      {isProjectMode && !cosmosActive && (
        <div className="xb-layout-switch" role="tablist" aria-label="Legacy layout">
          <button
            type="button"
            className={legacyLayout === 'web' ? 'is-on' : ''}
            onClick={() => setLegacyLayout('web')}
          >
            Web
          </button>
          <button
            type="button"
            className={legacyLayout === 'hierarchy' ? 'is-on' : ''}
            onClick={() => setLegacyLayout('hierarchy')}
          >
            Hierarchy
          </button>
          <button
            type="button"
            className={legacyLayout === 'grid' ? 'is-on' : ''}
            onClick={() => setLegacyLayout('grid')}
          >
            Grid
          </button>
        </div>
      )}
    </div>
  )
}
