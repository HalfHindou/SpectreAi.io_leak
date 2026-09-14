/**
 * X BUBBLES — the KOL ↔ project social universe on the shared Cosmos engine.
 *
 * Projects are planets orbiting the attention core (rising mention velocity
 * pulls them inward), KOLs are moons orbiting the project they push hardest,
 * and co-mention edges draw as constellation lines between planets. Three
 * switchable design versions (Signal / Constellation / Heat) reuse the same
 * engine + data — only the color semantics, clustering and core change.
 *
 * The page (XIntelligencePage) stays the owner of data + selection:
 * useCrawlGraph feeds `graph` in, clicks flow back out through onSelectNode
 * so the existing EntitySidebar + drill-down keep working untouched.
 */
import { useEffect, useMemo, useRef, useState, useCallback, useId } from 'react'
import { CosmosEngine } from '@/components/cosmos/cosmos-engine'
import { isAppActive, subscribeActivity } from '@/lib/idleManager'
import useNotificationStore from '@/store/useNotificationStore'
import { buildKolCosmos, DESIGN_MODES, DEFAULT_DESIGN } from './xbubbles-cosmos-data'
import { SEED_MODES, DEPTH_MODES } from '../hooks/useCrawlGraph'
import useKolReceipts from './use-kol-receipts'
import useHunterSignals from './use-hunter-signals'
import '@/components/cosmos/cosmos.css'
import './xbubbles-cosmos.css'

const VIEW_TABS = [
  { id: 'solar', label: 'Orbit', icon: '◉' },
  { id: 'map', label: 'Map', icon: '▦' },
  { id: 'galaxy', label: 'Galaxy', icon: '✦' },
]
const FOLLOWER_STEPS = [
  { v: 0, label: 'All' },
  { v: 10_000, label: '10k+' },
  { v: 50_000, label: '50k+' },
  { v: 100_000, label: '100k+' },
  { v: 500_000, label: '500k+' },
]
const TIER_PILLS = [
  { key: 'S', label: 'S', hint: '500k+ followers' },
  { key: 'A', label: 'A', hint: '100k+ followers' },
  { key: 'B', label: 'B', hint: '30k+ followers' },
  { key: 'C', label: 'C', hint: 'rising voices' },
  { key: 'EX', label: 'EX', hint: 'exchange accounts' },
]
const DENSITY_STEPS = ['lite', 'full', 'max']
const LABEL_MODES = ['change', 'name', 'off']
const LABEL_BADGE = { change: '#', name: 'Aa', off: '—' }
const SEED_SHORT = { trending24h: '24H', trending7d: '7D', mixed: 'Mixed', fresh: 'Fresh' }

const fmtCount = (n) => {
  const v = Number(n) || 0
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  return String(v)
}

const LEGEND_TEXT = {
  signal: 'inner orbit = attention rising · size = engagement · green = organic, red = noisy',
  constellation: 'inner orbit = attention rising · size = engagement · color = category',
  heat: 'the hottest project rules the core · orange = surging, blue = cooling',
}

/* module-scope so a remount (fullscreen, tab switch) keeps the user's setup */
let _xbView = 'solar'
let _xbIntroPlayed = false

export default function XBubblesCosmos({
  graph,
  mode = 'crawl',
  dayMode,
  isMobile,
  crawlSeed,
  onCrawlSeedChange,
  crawlDepth,
  onCrawlDepthChange,
  selectedNodeId,
  onSelectNode,
  onExitToLanding,
  refinedControls = false,
  embedded = false,       // mounted inside another page's panel (x-dash tab)
  onProjectOpen = null,   // embedded: project click → host drawer (cgId)
}) {
  const hostRef = useRef(null)
  const hoverCardRef = useRef(null)
  const engineRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [view, setViewState] = useState(_xbView)
  const [design, setDesign] = useState(() => {
    const stored = window.localStorage?.getItem('xb-cosmos-design')
    return DESIGN_MODES[stored] ? stored : DEFAULT_DESIGN
  })
  const [density, setDensity] = useState(() => {
    const stored = window.localStorage?.getItem('xb-cosmos-density')
    return DENSITY_STEPS.includes(stored) ? stored : 'full'
  })
  // voice filters — follower floor + reach-tier toggles ("data is limited"
  // feedback: let the user decide who makes the cut instead of the cap)
  const [minFollowers, setMinFollowers] = useState(0)
  const [tiersOff, setTiersOff] = useState(() => new Set())
  const toggleTier = useCallback((key) => {
    setTiersOff((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else if (next.size < TIER_PILLS.length - 1) next.add(key) // never allow zero tiers
      return next
    })
  }, [])
  const [labelMode, setLabelMode] = useState('change')
  const [cinematic, setCinematic] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [hoverBody, setHoverBody] = useState(null)
  const [searchQ, setSearchQ] = useState('')
  const [explainOpen, setExplainOpen] = useState(false)
  // mobile: seed/depth/density + labels fold behind a tune button so the
  // HUD never buries the universe on a phone
  const [mobileTools, setMobileTools] = useState(false)
  const controlsId = useId()
  const controlsButtonRef = useRef(null)
  const closeViewSettings = () => { setMobileTools(false); controlsButtonRef.current?.focus() }

  const setView = useCallback((v) => { _xbView = v; setViewState(v) }, [])
  useEffect(() => {
    try {
      window.localStorage?.setItem('xb-cosmos-design', design)
      window.localStorage?.setItem('xb-cosmos-density', density)
    } catch (_) {}
  }, [design, density])

  /* ── data model ── */
  const moonsPerPlanet = density === 'max' ? (isMobile ? 8 : 12) : density === 'full' ? (isMobile ? 5 : 8) : (isMobile ? 3 : 5)
  // Max = the whole author set on desktop (no silent truncation — "are we
  // catching all attention" must be answerable yes). 240 covers every project
  // the ≤500-mention fetch can produce while capping GPU/texture load if a
  // bigger universe ever lands; mobile keeps a tighter thermal cap. The
  // "N of M" status line stays honest if a clamp ever bites.
  const maxSwarm = density === 'max' ? (isMobile ? 100 : 240) : density === 'full' ? (isMobile ? 28 : 48) : (isMobile ? 16 : 28)
  const tiers = tiersOff.size ? new Set(TIER_PILLS.map((t) => t.key).filter((k) => !tiersOff.has(k))) : null
  const cosmos = useMemo(
    () => buildKolCosmos(graph, { design, moonsPerPlanet, maxSwarm, minFollowers, tiers }),
    // graph identity changes when the crawl refreshes/enriches
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph.projectNodes, graph.kolNodes, graph.projectAdjacency, design, moonsPerPlanet, maxSwarm, minFollowers, tiersOff],
  )
  const planetCount = useMemo(() => cosmos.bodies.filter((b) => b.kind === 'project').length, [cosmos])
  const moonCount = cosmos.bodies.length - planetCount

  /* crawl-node id → cosmos body id, for syncing external selection */
  const bodyIdByNode = useMemo(() => {
    const m = new Map()
    for (const b of cosmos.bodies) if (b.srcNode?.id) m.set(b.srcNode.id, b.id)
    return m
  }, [cosmos])

  const onSelectNodeRef = useRef(onSelectNode)
  onSelectNodeRef.current = onSelectNode
  const onProjectOpenRef = useRef(onProjectOpen)
  onProjectOpenRef.current = onProjectOpen

  /* ── receipts (Proof ledger) + live signals (breakout feed + hunter) ── */
  const receipts = useKolReceipts(true)
  const feedSignals = useNotificationStore((s) => s.signals)
  const hunter = useHunterSignals(true)
  const activeSignals = useMemo(() => {
    const cutoff = Date.now() - 6 * 3600e3
    const bySym = new Map()
    for (const b of cosmos.bodies) {
      if (b.kind === 'project') bySym.set(b.id.toUpperCase(), b.id)
    }
    if (cosmos.sun?.srcNode && cosmos.sun.id) bySym.set(cosmos.sun.id.toUpperCase(), 'SUN_FOCUS')
    // anchored chips (a visible planet to fly to) take the slots first;
    // off-universe signals still surface as info chips (max 2)
    const anchored = []
    const far = []
    const seen = new Set()
    const push = (sig) => {
      if (seen.has(sig.sym)) return
      seen.add(sig.sym)
      if (sig.bodyId) anchored.push(sig)
      else far.push(sig)
    }
    // 1 — breakout radar (bell feed): the ignition class, highest priority
    for (const s of feedSignals || []) {
      if (s.category !== 'breakout' || !s.meta?.asset) continue
      if ((s.timestamp || 0) < cutoff) continue
      const sym = String(s.meta.asset).toUpperCase().replace(/^\$/, '')
      push({ id: `bk-${s.id}`, kind: 'breakout', sym, bodyId: bySym.get(sym), label: 'breakout radar', title: s.title || 'Breakout radar fired — click to fly there' })
    }
    // 2 — hunter edges: contagion (rotation watch) + distribution (voices
    //     leaving), each stamped with its detector's GRADED hit rate
    const stats = new Map((hunter?.detector_stats || []).map((d) => [d.detector, d]))
    const gradeNote = (det) => {
      const st = stats.get(det)
      if (!st || st.hit_rate_pct == null) return 'no graded record yet'
      return `${Math.round(st.hit_rate_pct)}% hit over ${st.n_graded} graded`
    }
    for (const e of hunter?.edges || []) {
      if (e.detector !== 'contagion' && e.detector !== 'distribution') continue
      if (new Date(e.ts).getTime() < Date.now() - 12 * 3600e3) continue
      const sym = String(e.asset || '').toUpperCase()
      // a rotation candidate is often OUTSIDE the visible universe — anchor
      // the chip to the visible SOURCE planet (the hot side) in that case
      const srcSym = String(e.detail?.source_asset || '').toUpperCase()
      const bodyId = bySym.get(sym) || (e.detector === 'contagion' ? bySym.get(srcSym) : undefined)
      push({
        id: `hu-${e.id}`,
        kind: e.detector,
        sym,
        bodyId,
        label: e.detector === 'contagion'
          ? (bySym.get(sym) ? 'rotation watch' : `rotation off ${srcSym}`)
          : 'voices leaving',
        title: `${e.headline} · this detector: ${gradeNote(e.detector)}`,
      })
    }
    return [...anchored, ...far.slice(0, 2)].slice(0, 4)
  }, [feedSignals, hunter, cosmos])

  /* aura layer: hot planets (builder) + receipt-proven voices/planets +
     live breakout signals pulse hardest */
  const socialLayer = useMemo(() => {
    const auras = [...(cosmos.socialLayer?.auras || [])]
    const seen = new Set(auras.map((a) => a.id))
    if (receipts.ready) {
      for (const b of cosmos.bodies) {
        if (seen.has(b.id)) continue
        if (b.kind === 'kol') {
          const key = (b.srcNode?.handle || b.id).replace(/^@/, '').toLowerCase()
          const rec = receipts.byKol.get(key)
          if (rec && rec.bestPeak >= 100) {
            auras.push({ id: b.id, intensity: Math.min(1, 0.35 + rec.hits * 0.15) })
            seen.add(b.id)
          }
        } else if (b.kind === 'project' && b.token?.cgId) {
          const tok = receipts.byToken.get(String(b.token.cgId).toLowerCase())
          if (tok && tok.peakPct >= 100) {
            auras.push({ id: b.id, intensity: Math.min(1, 0.4 + tok.peakPct / 500) })
            seen.add(b.id)
          }
        }
      }
    }
    for (const s of activeSignals) {
      const existing = auras.find((a) => a.id === s.bodyId)
      if (existing) existing.intensity = 1
      else auras.push({ id: s.bodyId, intensity: 1 })
    }
    return { auras, comets: [] }
  }, [cosmos, receipts, activeSignals])

  /* ── engine lifecycle (mirrors the /bubbles cosmos view) ── */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

    const engine = new CosmosEngine(host, {
      isMobile,
      dayMode,
      reducedMotion,
      initialView: _xbView,
      labelMode: 'change',
      skipIntro: _xbIntroPlayed,
      onHover: (body, x, y) => {
        setHoverBody((prev) => {
          const next = body || null
          return prev === next ? prev : next
        })
        const card = hoverCardRef.current
        if (card && body) {
          // engine emits viewport coords; the card is absolute in .cosmos-root
          const rect = host.getBoundingClientRect()
          const lx = x - rect.left
          const ly = y - rect.top
          const pad = 18
          const cw = card.offsetWidth || 210
          const chh = card.offsetHeight || 90
          let nx = lx + pad
          let ny = ly + pad
          if (nx + cw > rect.width - 12) nx = lx - cw - pad
          if (ny + chh > rect.height - 12) ny = ly - chh - pad
          card.style.transform = `translate(${Math.max(8, nx)}px, ${Math.max(8, ny)}px)`
        }
      },
      onSelect: (body) => {
        if (!body || body.isSun) {
          onSelectNodeRef.current?.(null)
          return
        }
        // embedded (x-dash tab): a project click opens the host token drawer
        if (body.kind === 'project' && onProjectOpenRef.current) {
          const cgId = body.token?.cgId || body.srcNode?.cgId
          if (cgId) onProjectOpenRef.current(cgId)
          return
        }
        onSelectNodeRef.current?.(body.srcNode?.id || null)
      },
    })
    engineRef.current = engine
    host.__cosmosEngine = engine
    setReady(true)
    _xbIntroPlayed = true

    const ro = new ResizeObserver(() => engine.resize())
    ro.observe(host)
    const io = new IntersectionObserver(
      (entries) => engine.setRunning(entries[0]?.isIntersecting !== false),
      { threshold: 0.02 },
    )
    io.observe(host)
    const idleTimer = setInterval(() => {
      if (!isAppActive()) engine.setRunning(false)
    }, 30000)
    const unsubActivity = subscribeActivity(() => {
      if (!engine.running) engine.setRunning(true)
    })

    return () => {
      clearInterval(idleTimer)
      unsubActivity?.()
      ro.disconnect()
      io.disconnect()
      engine.dispose()
      engineRef.current = null
    }
    // created once per mount; everything else flows through setters below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* data in */
  useEffect(() => {
    if (!engineRef.current || !cosmos.bodies.length) return
    engineRef.current.setData(cosmos)
    engineRef.current.setLinks(cosmos.links)
    engineRef.current.setSocial(socialLayer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cosmos, socialLayer, ready])

  useEffect(() => { engineRef.current?.setDayMode(dayMode) }, [dayMode, ready])
  useEffect(() => { engineRef.current?.setView(view) }, [view, ready])
  useEffect(() => { engineRef.current?.setCinematic(cinematic) }, [cinematic, ready])
  useEffect(() => { engineRef.current?.setSpeed(speed) }, [speed, ready])
  useEffect(() => { engineRef.current?.setLabelMode(labelMode) }, [labelMode, ready])

  /* selection sync: EntitySidebar close (ESC) releases the camera.
     (Skipped entirely when embedded — the host page owns no selection.) */
  useEffect(() => {
    if (!ready || !engineRef.current || selectedNodeId === undefined) return
    if (!selectedNodeId) {
      engineRef.current.focusBody(null)
      return
    }
    const bid = bodyIdByNode.get(selectedNodeId)
    if (bid) engineRef.current.focusBody(bid)
  }, [selectedNodeId, bodyIdByNode, ready])

  /* keyboard: Escape peels layers (explainer → cinematic → focus) in the
     CAPTURE phase so the page-level ESC (sidebar close) only gets a bare
     Escape — without this, cinematic was a one-way door. */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return
      if (explainOpen) { setExplainOpen(false); e.stopPropagation() }
      else if (refinedControls && mobileTools) { setMobileTools(false); controlsButtonRef.current?.focus(); e.stopPropagation() }
      else if (cinematic) { setCinematic(false); e.stopPropagation() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [explainOpen, cinematic, refinedControls, mobileTools])

  /* ── search ── */
  const results = useMemo(() => {
    const q = searchQ.trim().toLowerCase()
    if (!q) return []
    return cosmos.bodies
      .filter((b) => (
        b.id.toLowerCase().includes(q)
        || (b.token.name || '').toLowerCase().includes(q)
        || (b.srcNode?.handle || '').toLowerCase().includes(q)
      ))
      .slice(0, 8)
  }, [searchQ, cosmos])

  const jumpTo = useCallback((body) => {
    setSearchQ('')
    engineRef.current?.focusBody(body.id)
    onSelectNodeRef.current?.(body.srcNode?.id || null)
  }, [])

  const seedKeys = Object.keys(SEED_MODES)
  const depthKeys = Object.keys(DEPTH_MODES)
  const loadingFresh = graph.loading && !cosmos.bodies.length

  return (
    <div className={`cosmos-root xb-cosmos${embedded ? ' xb-cosmos--embedded' : ''}${cinematic ? ' cosmos-cinematic' : ''}${dayMode ? ' cosmos-day' : ''}${refinedControls ? ' cosmos-refined' : ''}`}>
      <div ref={hostRef} className="cosmos-stage" />

      {/* ── top-left: back to landing · views · design versions · crawl controls ── */}
      <div className="cosmos-hud cosmos-hud-tl">
        {onExitToLanding && (
          <button className="cosmos-breadcrumb" onClick={onExitToLanding}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
            X Bubbles
            <em>search &amp; trending</em>
          </button>
        )}
        <div className="cosmos-seg">
          {VIEW_TABS.map((v) => (
            <button
              key={v.id}
              className={`cosmos-seg-btn${view === v.id ? ' active' : ''}`}
              onClick={() => setView(v.id)}
              aria-pressed={view === v.id}
              aria-label={v.label}
            >
              <span className="cosmos-seg-icon">{v.icon}</span>
              {(!isMobile || refinedControls) && v.label}
            </button>
          ))}
        </div>

        <div className={refinedControls ? 'xd-cosmos-controls' : undefined} style={refinedControls ? undefined : { display: 'contents' }} id={controlsId} hidden={refinedControls && !mobileTools}>
          {refinedControls && <div className="xd-cosmos-controls__head"><span>View settings</span><button type="button" onClick={closeViewSettings}>Done</button></div>}
        {mode === 'crawl' && (
        <div className="cosmos-source-row">
          <div className="cosmos-seg" role="group" aria-label="Color by" data-label={refinedControls ? 'Color by' : undefined}>
            {Object.entries(DESIGN_MODES).map(([key, d]) => (
              <button
                key={key}
                className={`cosmos-seg-btn${design === key ? ' active' : ''}`}
                aria-pressed={design === key}
                onClick={() => setDesign(key)}
                title={d.hint}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
        )}

        {(!isMobile || mobileTools) && (
        <div className="cosmos-source-row">
          {mode === 'crawl' && (
            <>
              <div className="cosmos-seg cosmos-seg-mini" role="group" aria-label="Signal window" data-label={refinedControls ? 'Signal window' : undefined}>
                {seedKeys.map((k) => (
                  <button
                    key={k}
                    className={`cosmos-seg-btn${crawlSeed === k ? ' active' : ''}`}
                aria-pressed={crawlSeed === k}
                    onClick={() => onCrawlSeedChange?.(k)}
                    title={SEED_MODES[k].label}
                  >
                    {SEED_SHORT[k] || SEED_MODES[k].label}
                  </button>
                ))}
              </div>
              <div className="cosmos-seg cosmos-seg-mini" role="group" aria-label="Coverage" data-label={refinedControls ? 'Coverage' : undefined}>
                {depthKeys.map((k) => (
                  <button
                    key={k}
                    className={`cosmos-seg-btn${crawlDepth === k ? ' active' : ''}`}
                aria-pressed={crawlDepth === k}
                    onClick={() => onCrawlDepthChange?.(k)}
                    title={`Crawl depth · ${DEPTH_MODES[k].label}`}
                  >
                    {DEPTH_MODES[k].label}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="cosmos-seg cosmos-seg-mini" role="group" aria-label="Scene density" data-label={refinedControls ? 'Scene density' : undefined}>
            {DENSITY_STEPS.map((d) => (
              <button
                key={d}
                className={`cosmos-seg-btn${density === d ? ' active' : ''}`}
                aria-pressed={density === d}
                onClick={() => setDensity(d)}
                title={d === 'max' ? (isMobile ? 'Top 100 voices' : 'Every voice the data has') : d === 'full' ? 'Balanced' : 'Lighter scene'}
              >
                {d[0].toUpperCase() + d.slice(1)}
              </button>
            ))}
          </div>
        </div>
        )}

        {/* voice filters: follower floor + reach tiers */}
        {(!isMobile || mobileTools) && (
        <div className="cosmos-labels-row">
          <span className="cosmos-labels-eyebrow">Voices</span>
          <div className="cosmos-seg cosmos-seg-mini" role="group" aria-label="Minimum audience" data-label={refinedControls ? 'Minimum audience' : undefined}>
            {FOLLOWER_STEPS.map((s) => (
              <button
                key={s.v}
                className={`cosmos-seg-btn${minFollowers === s.v ? ' active' : ''}`}
                aria-pressed={minFollowers === s.v}
                onClick={() => setMinFollowers(s.v)}
                title={s.v ? `Only voices with ${s.label} followers` : 'No follower floor'}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="cosmos-seg cosmos-seg-mini" role="group" aria-label="Voice tiers" data-label={refinedControls ? 'Voice tiers' : undefined}>
            {TIER_PILLS.map((tp) => (
              <button
                key={tp.key}
                className={`cosmos-seg-btn${!tiersOff.has(tp.key) ? ' active' : ''}`}
                aria-pressed={!tiersOff.has(tp.key)}
                onClick={() => toggleTier(tp.key)}
                title={tp.hint}
              >
                {tp.label}
              </button>
            ))}
          </div>
        </div>
        )}

        {(!isMobile || mobileTools) && (
        <div className="cosmos-labels-row">
          <span className="cosmos-labels-eyebrow">Labels</span>
          <div className="cosmos-seg cosmos-seg-mini" role="group" aria-label="Planet labels" data-label={refinedControls ? 'Planet labels' : undefined}>
            {LABEL_MODES.map((m) => (
              <button
                key={m}
                className={`cosmos-seg-btn${labelMode === m ? ' active' : ''}`}
                aria-pressed={labelMode === m}
                onClick={() => setLabelMode(m)}
              >
                {LABEL_BADGE[m]}
              </button>
            ))}
          </div>
        </div>
        )}

        </div>

        <div className="xb-status">
          {loadingFresh
            ? 'Mapping the social universe…'
            : mode === 'project'
              ? <>
                  {cosmos.voicePoolTotal > moonCount ? `${moonCount} of ${cosmos.voicePoolTotal}` : moonCount} voices in orbit
                  {cosmos.voicePoolTotal > moonCount && density !== 'max' && (
                    <button className="xb-status-more" onClick={() => setDensity('max')} title="Show every voice">+{cosmos.voicePoolTotal - moonCount} more</button>
                  )}
                  {graph.loading ? ' · loading…' : ''}
                </>
              : <>{planetCount} projects · {moonCount} voices{graph.loading ? ' · crawling…' : ''}</>}
        </div>
      </div>

      {/* ── top-right: search + actions ── */}
      <div className="cosmos-hud cosmos-hud-tr">
        {(!isMobile || refinedControls) && (
          <div className="cosmos-search">
            <svg className="cosmos-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder={refinedControls ? "Find a project or voice" : "Jump to project or voice…"}
              aria-label="Find a project or voice"
              onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) jumpTo(results[0]); if (e.key === 'Escape') setSearchQ('') }}
            />
            {results.length > 0 && (
              <div className="cosmos-search-results">
                {results.map((r) => (
                  <button key={r.id} className="cosmos-search-row" onClick={() => jumpTo(r)}>
                    {r.token.logo && <img src={r.token.logo} alt="" />}
                    <span className="cosmos-search-sym">{r.id}</span>
                    <span className="cosmos-search-name">
                      {r.kind === 'kol' ? `${fmtCount(r.srcNode?.followers)} followers` : r.token.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {(isMobile || refinedControls) && (
          <button
            className={`cosmos-hud-btn${mobileTools ? ' active' : ''}`}
            onClick={() => setMobileTools((v) => !v)}
            title="View settings"
            ref={controlsButtonRef}
            aria-label="View settings"
            aria-expanded={mobileTools}
            aria-controls={controlsId}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M4 12h16M4 17h16" /><circle cx="9" cy="7" r="2.2" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="2.2" fill="currentColor" stroke="none" /><circle cx="8" cy="17" r="2.2" fill="currentColor" stroke="none" /></svg>
            {refinedControls && <span>Settings</span>}
          </button>
        )}
        <button className="cosmos-hud-btn" onClick={() => setExplainOpen(true)} title="How to read X Bubbles">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 16v-5M12 8h.01" /></svg>
        </button>
        <button
          className={`cosmos-hud-btn${cinematic ? ' active' : ''}`}
          onClick={() => setCinematic((v) => !v)}
          title="Cinematic mode"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="m10 9.8 4.5 2.2-4.5 2.2z" fill="currentColor" stroke="none" /></svg>
        </button>
        <button
          className="cosmos-hud-btn cosmos-speed"
          onClick={() => setSpeed((s) => (s === 1 ? 2 : s === 2 ? 4 : s === 4 ? 0 : 1))}
          title="Orbit speed"
        >
          {speed === 0 ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="7" y="6" width="3.4" height="12" rx="1" /><rect x="13.6" y="6" width="3.4" height="12" rx="1" /></svg>
          ) : `${speed}×`}
        </button>
        <button
          className="cosmos-hud-btn"
          onClick={() => { engineRef.current?.resetCamera(); onSelectNodeRef.current?.(null) }}
          title="Reset view"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
        </button>
      </div>

      {/* ── bottom-left: live signals + core chip + legend + clusters ── */}
      <div className="cosmos-hud cosmos-hud-bl">
        {activeSignals.length > 0 && (
          <div className="xb-signal-rail">
            {activeSignals.map((s) => (
              <button
                key={s.id}
                className={`xb-signal-chip xb-signal-chip--${s.kind}${s.bodyId ? '' : ' xb-signal-chip--far'}`}
                onClick={s.bodyId ? () => engineRef.current?.focusBody(s.bodyId) : undefined}
                title={s.title}
              >
                <span className="xb-signal-dot" />
                {s.sym} · {s.label}
              </button>
            ))}
          </div>
        )}
        {cosmos.sun && (
          <button className="cosmos-sun-chip" onClick={() => engineRef.current?.focusBody('SUN_FOCUS')}>
            <span className="cosmos-sun-dot" />
            <span className="cosmos-sun-sym">{cosmos.sun.id}</span>
            <span className="cosmos-sun-price">
              {cosmos.sun.isCore
                ? `${fmtCount(cosmos.sun.mentions)} mentions in orbit`
                : `${fmtCount(cosmos.sun.mentions)} mentions · leads the field`}
            </span>
          </button>
        )}
        <div className="cosmos-legend">
          <span className="cosmos-legend-grad" />
          <span className="cosmos-legend-text">
            {mode === 'project'
              ? 'closest ring = pushing it hardest · size = reach · gold 500k+ · violet 100k+ · blue 30k+'
              : LEGEND_TEXT[design]}
          </span>
          <button className="cosmos-legend-why" onClick={() => setExplainOpen(true)}>why?</button>
        </div>
        {view === 'galaxy' && !isMobile && (
          <div className="cosmos-groups">
            {cosmos.groups.slice(0, 8).map((g) => (
              <span key={g.key} className="cosmos-group-chip">
                <span className="cosmos-group-dot" style={{ background: `rgb(${g.color[0]},${g.color[1]},${g.color[2]})` }} />
                {g.key} <em>{g.count}</em>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── bottom-right: hint ── */}
      {!isMobile && (
        <div className="cosmos-hud cosmos-hud-br">
          <span className="cosmos-hint">drag to orbit · scroll to zoom · grab a planet — its voices follow</span>
        </div>
      )}

      {/* ── hover card ── */}
      <div
        ref={hoverCardRef}
        className={`cosmos-hover-card${hoverBody ? ' visible' : ''}`}
        aria-hidden={!hoverBody}
      >
        {hoverBody && (() => {
          if (hoverBody.isSun) {
            const s = cosmos.sun
            return (
              <>
                <div className="cosmos-hover-head">
                  {s?.token?.logo && <img src={s.token.logo} alt="" />}
                  <span className="cosmos-hover-sym">{s?.id}</span>
                  <span className="cosmos-hover-suntag">{s?.isCore ? 'THE CORE' : 'LEADS THE FIELD'}</span>
                </div>
                <div className="cosmos-hover-row">
                  <span>{fmtCount(s?.mentions)} mentions</span>
                  {!s?.isCore && <span className="pos">{(Number(s?.velocity) || 1).toFixed(1)}× velocity</span>}
                </div>
              </>
            )
          }
          if (hoverBody.kind === 'kol') {
            const n = hoverBody.srcNode || {}
            const rec = receipts.byKol.get((n.handle || hoverBody.id).replace(/^@/, '').toLowerCase())
            return (
              <>
                <div className="cosmos-hover-head">
                  {hoverBody.token.logo && <img src={hoverBody.token.logo} alt="" />}
                  <span className="cosmos-hover-sym">{n.name || hoverBody.id}</span>
                  <span className="xb-tier-tag">{n.type === 'exchange' ? 'EXCHANGE' : `${hoverBody.tier}-TIER`}</span>
                </div>
                <div className="cosmos-hover-row">
                  <span>{fmtCount(n.followers)} followers</span>
                  <span className="pos">{fmtCount(n.mentionCount)} mentions</span>
                </div>
                {rec && (
                  <div className="cosmos-hover-row">
                    <span className="xb-receipt">
                      ◆ {rec.calls} tracked call{rec.calls === 1 ? '' : 's'} · {rec.hits} hit
                      {rec.bestPeak != null ? ` · best peak +${Math.round(rec.bestPeak)}%` : ''}
                    </span>
                  </div>
                )}
                {hoverBody.parentId && (
                  <div className="cosmos-hover-dive">orbiting {hoverBody.parentId} · click for the dossier</div>
                )}
              </>
            )
          }
          const p = hoverBody.srcNode || {}
          const tokRec = hoverBody.token?.cgId
            ? receipts.byToken.get(String(hoverBody.token.cgId).toLowerCase())
            : null
          return (
            <>
              <div className="cosmos-hover-head">
                {hoverBody.token.logo && <img src={hoverBody.token.logo} alt="" />}
                <span className="cosmos-hover-sym">{hoverBody.id}</span>
              </div>
              <div className="cosmos-hover-row">
                <span>{fmtCount(hoverBody.mentions)} mentions</span>
                <span className={hoverBody.velocity >= 1 ? 'pos' : 'neg'}>{(Number(hoverBody.velocity) || 1).toFixed(1)}× velocity</span>
              </div>
              <div className="cosmos-hover-row">
                <span>{fmtCount(hoverBody.authors)} voices</span>
                <span>{Math.round(Number(p.authenticity) || 0)}% organic</span>
              </div>
              {tokRec && tokRec.peakPct != null && (
                <div className="cosmos-hover-row">
                  <span className="xb-receipt">
                    ◆ PROOF · peak {tokRec.peakPct >= 0 ? '+' : ''}{Math.round(tokRec.peakPct)}% since spotted
                  </span>
                </div>
              )}
              <div className="cosmos-hover-dive">click for the dossier</div>
            </>
          )
        })()}
      </div>

      {/* ── empty / cold state ── */}
      {!loadingFresh && !cosmos.bodies.length && (
        <div className="cosmos-empty">No social graph yet — try another seed.</div>
      )}

      {/* ── cinematic exits: the HUD fades in cinema, these never do ── */}
      {cinematic && (
        <>
          <button className="cosmos-cinema-back" onClick={() => setCinematic(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
            Exit cinema
            <em>ESC</em>
          </button>
          <button className="cosmos-cinema-x" onClick={() => setCinematic(false)} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </>
      )}

      {/* ── explainer ── */}
      {explainOpen && (
        <div className="cosmos-explain-scrim" onClick={() => setExplainOpen(false)}>
          <div className="cosmos-explain" onClick={(e) => e.stopPropagation()}>
            <button className="cosmos-dossier-close" onClick={() => setExplainOpen(false)} aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
            <div className="cosmos-explain-title">How to read X Bubbles</div>
            <div className="cosmos-explain-rows">
              <div className="cosmos-explain-row">
                <span className="cosmos-glyph cosmos-glyph-sun" />
                <div>
                  <b>The core</b>
                  <span>{design === 'heat'
                    ? 'The most-engaged project rules the center — everything else orbits its gravity.'
                    : 'Attention is gravity. Every project on crypto X orbits the core.'}</span>
                </div>
              </div>
              <div className="cosmos-explain-row">
                <span className="cosmos-glyph cosmos-glyph-orbit" />
                <div>
                  <b>Orbit = velocity</b>
                  <span>Projects with accelerating mentions fall toward the core; fading attention drifts to the outer dark.</span>
                </div>
              </div>
              <div className="cosmos-explain-row">
                <span className="cosmos-glyph cosmos-glyph-size" />
                <div>
                  <b>Size = engagement</b>
                  <span>A planet grows with the weighted engagement carrying it — not its market cap.</span>
                </div>
              </div>
              <div className="cosmos-explain-row">
                <span className="cosmos-glyph cosmos-glyph-aura" />
                <div>
                  <b>Moons = the voices</b>
                  <span>KOLs orbit the project they push hardest — gold is 500k+ reach, violet 100k+, blue 30k+, cyan an exchange. Grab a planet and its voices ride along.</span>
                </div>
              </div>
              <div className="cosmos-explain-row">
                <span className="cosmos-glyph cosmos-glyph-nav" />
                <div>
                  <b>Lines = shared mindshare</b>
                  <span>A line between two planets means the same voices carry both — narratives traveling together.</span>
                </div>
              </div>
              <div className="cosmos-explain-row">
                <span className="cosmos-glyph cosmos-glyph-glow" />
                <div>
                  <b>{DESIGN_MODES[design].label} design</b>
                  <span>{DESIGN_MODES[design].hint}. Switch designs top-left — same universe, different lens.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
