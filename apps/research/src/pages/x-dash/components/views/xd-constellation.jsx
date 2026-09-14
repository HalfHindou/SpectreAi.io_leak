/**
 * XDConstellation — THE NARRATIVE CONSTELLATION, the "Map" view inside /x-dash.
 *
 * RE-ENGINED (2026-06): the old version ran d3-force + 280 logo/glow redraws on
 * the main thread every frame (crooked, laggy, couldn't click). This version
 * consumes the shared GPU ConstellationEngine:
 *   - d3-force runs in a Web Worker; positions stream back as a Float32Array
 *   - the main thread lerps + renders ~280 bubbles as ONE InstancedMesh (WebGL)
 *   - frameloop="demand" + document.hidden pause → GPU idle when settled
 *   - raycaster picking → instant click/hover; smooth eased camera focus
 *
 * This file owns ONLY the X-Dash data→engine mapping and the page chrome
 * (masthead, sector nav rail, focus bar, zoom controls, tooltip, legend). The
 * engine itself is data-agnostic and reusable (the /x-bubbles page is next).
 *
 *   COLOR  = SECTOR (curated 12-hue palette tuned for pure black; none reads as
 *            bull-green / bear-red). Hub label + ring + halo share the hue.
 *   SIZE   = attention (sqrt(weighted) so one viral token doesn't swallow it).
 *   GLOW   = authenticity (0-100). Organic → bright saturated bloom; noise → dim.
 *
 * Data: useXDashConstellation reads /api/xdash/constellation (one fetch, 2-min
 * TTL). Ignores the page command-bar controls. Reads onOpenToken.
 *
 * The engine (three.js) is imported lazily by x-dash-page.jsx so three never
 * touches the boot path — this file imports it directly because it is itself
 * only loaded inside that lazy boundary.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSettingsStore from '@/store/useSettingsStore'
import { useIsMobile } from '@/hooks/useMediaQuery'
import { useXDashConstellation } from '@/hooks/useXDashConstellation'
import { useXDashToken } from '@/hooks/useXDashToken'
import { setTokenSeed } from '@/lib/xdash-token-seed'
import ConstellationEngine from '@/components/constellation/ConstellationEngine'
import SpectreLoader from '@/components/spectre-loader'
import { hash01 } from '@/components/constellation/engine-bits'
import { Shimmer, EmptyState, ErrorState } from '../xd-bits'
import XDMentionsFeed from '../xd-mentions-feed'
import { formatNum, relativeTime } from '../x-dash-utils'

/* tunables */
const MAX_HUBS = 12           // labeled sector hubs; rest fold into "Other"
const MIN_SECTOR_TOKENS = 3   // sectors smaller than this don't earn their own hub
const MIN_R = 20              // token radius floor (px, layout space) — logo stays legible
const MAX_R = 92              // token radius ceiling — fat bubbles, bubblemaps scale
const MOBILE_MAX_NODES = 160  // cap nodes on phones to keep it smooth
const BET_MIN_R = 14          // bet field packs more nodes in a grid → slightly smaller
const BET_MAX_R = 56
const BET_MARGIN_X = 0.11     // stage-fraction inset so bubbles don't hug the axis labels
const BET_MARGIN_Y = 0.13

/* SECTOR PALETTE — vibrant but tasteful on pure black. Curated so adjacent
   hues stay distinguishable and NONE reads as bull-green/bear-red (reserved
   for P&L). Assigned in sector-weight order; "Other" gets the muted neutral. */
const SECTOR_PALETTE = [
  [125, 134, 255], // periwinkle / indigo
  [56, 201, 196],  // teal
  [255, 158, 84],  // warm orange
  [232, 121, 209], // magenta-pink
  [120, 197, 255], // sky cyan-blue
  [180, 142, 255], // violet
  [255, 206, 92],  // amber-gold
  [96, 214, 160],  // mint (distinct from bull #10B981)
  [255, 128, 150], // coral-rose
  [150, 214, 92],  // lime-chartreuse
  [108, 178, 235], // steel blue
  [221, 168, 120], // sand / clay
]
const OTHER_RGB = [148, 156, 168]
const EMPTY_ARR = []
const TOKEN_OPTS = { timeframe: '24h' } // stable ref for useXDashToken (drill callers + tweets)

function authLabel(authenticity, t) {
  const a = Number(authenticity) || 0
  if (a >= 70) return t('xDash.constellation.auth.organic', 'Organic')
  if (a >= 55) return t('xDash.constellation.auth.clean', 'Clean')
  if (a >= 42) return t('xDash.constellation.auth.mixed', 'Mixed')
  if (a >= 28) return t('xDash.constellation.auth.thin', 'Thin')
  return t('xDash.constellation.auth.manufactured', 'Manufactured')
}

/* momentum 0..1 from the velocity ratio — a FIXED-reference log scale centred on
   1.0 (steady). vel 2 → ~0.83 (accelerating), vel 0.5 → ~0.17 (cooling). So the
   Y axis is honest + comparable across refetches, not relative to the field. */
function betMomentum(velocity) {
  const v = Math.max(0.0625, Number(velocity) || 1)
  return Math.max(0, Math.min(1, 0.5 + Math.log2(v) / 3))
}

export default function XDConstellation({ onOpenToken }) {
  const { t, i18n } = useTranslation()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const isMobile = useIsMobile()

  const { nodes, categories, generatedAt, degraded, loading, error, refetch } = useXDashConstellation()

  const stageElRef = useRef(null)
  const roRef = useRef(null)
  const controlsRef = useRef(null)
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 })
  const [engineReady, setEngineReady] = useState(false)

  const [hovered, setHovered] = useState(null)   // { node, x, y } for the tooltip
  const [focusHub, setFocusHub] = useState(null) // committed cluster focus
  const [hoverHub, setHoverHub] = useState(null) // nav-rail hover (soft highlight)
  const [navOpen, setNavOpen] = useState(false)  // mobile nav sheet
  const [viewMode, setViewMode] = useState('galaxy') // 'galaxy' | 'bet' (the decision field)

  // ── COSMOS drill-down: galaxy ↔ token-network ↔ kol-network ─────────────────
  const [drillStack, setDrillStack] = useState([]) // breadcrumb trail of {kind,id|screen_name,label}
  const [fullscreen, setFullscreen] = useState(false)
  const drill = drillStack.length ? drillStack[drillStack.length - 1] : null

  const reducedMotion = useMemo(() => (
    typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ), [])

  /* ── build the cluster + node model from data, in the ENGINE's generic shape.
       (X-Dash-specific shaping lives here, NOT in the engine.) ─────────────── */
  const model = useMemo(() => {
    if (!nodes.length || !categories.length) return { clusters: [], engineNodes: [], hubMeta: [] }

    const eligible = categories.filter((c) => (c.count || 0) >= MIN_SECTOR_TOKENS)
    const top = eligible.slice(0, MAX_HUBS)
    const topLabels = new Set(top.map((c) => c.label))

    // hub metadata (drives the nav rail + engine clusters)
    const hubMeta = top.map((c, i) => ({
      key: c.label,
      label: c.label,
      color: SECTOR_PALETTE[i % SECTOR_PALETTE.length],
      weighted: c.weighted,
      auth: c.avg_authenticity,
    }))
    const restCount = categories.reduce((s, c) => s + (topLabels.has(c.label) ? 0 : (c.count || 0)), 0)
    if (restCount > 0) {
      hubMeta.push({
        key: '__other__',
        label: t('xDash.constellation.otherWell', 'Other'),
        color: OTHER_RGB,
        weighted: 0,
        auth: 0,
        isOther: true,
      })
    }
    const hubByKey = new Map(hubMeta.map((h) => [h.key, h]))
    const otherKey = hubByKey.has('__other__') ? '__other__' : (hubMeta[hubMeta.length - 1]?.key)

    // mobile: cap nodes (keep the highest-attention ones) for a smooth phone map
    let srcNodes = nodes
    if (isMobile && nodes.length > MOBILE_MAX_NODES) {
      srcNodes = [...nodes]
        .sort((a, b) => (Number(b.weighted) || 0) - (Number(a.weighted) || 0))
        .slice(0, MOBILE_MAX_NODES)
    }

    // sqrt-dampen attention → radius so a viral token doesn't dwarf the field
    const weights = srcNodes.map((n) => Math.sqrt(Math.max(0, Number(n.weighted) || 0)))
    const maxW = Math.max(1, ...weights)

    const engineNodes = []
    const satCount = new Map()
    srcNodes.forEach((n, i) => {
      const hubKey = topLabels.has(n.category) ? n.category : otherKey
      const hub = hubByKey.get(hubKey)
      if (!hub) return
      const norm = weights[i] / maxW
      const rpx = MIN_R + (MAX_R - MIN_R) * Math.pow(norm, 0.82)
      const id = `tok:${n.asset || n.symbol || i}`
      engineNodes.push({
        id,
        clusterKey: hub.key,
        color: hub.color,
        size: norm,                                   // 0..1 (drift/parallax scaling)
        glow: Math.max(0, Math.min(1, (Number(n.authenticity) || 0) / 100)),
        logo: n.image || null,
        label: String(n.symbol || '?').charAt(0).toUpperCase(),
        _rpx: rpx,
        _seed: hash01(n.asset || n.symbol || String(i)),
        data: n,
      })
      satCount.set(hub.key, (satCount.get(hub.key) || 0) + 1)
    })

    // clusters in the engine's shape, with live token counts; drop empties
    const clusters = hubMeta
      .map((h) => ({ key: h.key, label: h.label, color: h.color, count: satCount.get(h.key) || 0, _meta: h }))
      .filter((c) => c.count > 0)

    return { clusters, engineNodes }
  }, [nodes, categories, t, isMobile])

  /* ── COSMOS network assembly — entirely client-side from the constellation
       payload (every node carries its `kols`). token→callers, token→co-shilled
       tokens (sharing callers), kol→tokens. No extra fetch. ─────────────────── */
  const rawById = useMemo(() => {
    const m = new Map()
    model.engineNodes.forEach((en) => m.set(en.id, en))
    return m
  }, [model])

  const kolIndex = useMemo(() => {
    // screen_name → { screen_name, name, avatar, followers, tokens:[engineNode] }
    const m = new Map()
    for (const en of model.engineNodes) {
      const kols = en.data && Array.isArray(en.data.kols) ? en.data.kols : []
      for (const k of kols) {
        const sn = k.screen_name || k.name
        if (!sn) continue
        if (!m.has(sn)) {
          m.set(sn, {
            screen_name: sn, name: k.name || sn,
            avatar: k.avatar_image_url || k.avatar || null,
            followers: k.followers_count || k.followers || 0,
            tokens: [],
          })
        }
        m.get(sn).tokens.push(en)
      }
    }
    return m
  }, [model])

  /* Drill-down callers: the constellation node only carries a 3-cap `kols`
     PREVIEW (and 0 for majors like BTC). Fetch the token's real author roster
     (up to ~20, with PFP/followers/mentions) so the network shows who's ACTUALLY
     calling it. NetworkPanel reuses this same response for its tweet feed below,
     so this is one fetch, not two. */
  const drillTokenAsset = useMemo(() => {
    if (!drill || drill.kind !== 'token') return null
    const en = rawById.get(drill.id)
    return (en && en.data && en.data.asset) || null
  }, [drill, rawById])
  const { data: drillTokenDetail, loading: drillTokenLoading } = useXDashToken(drillTokenAsset, TOKEN_OPTS)

  const networkModel = useMemo(() => {
    if (!drill) return null
    const CENTER_R = 48
    const KOL_RGB = [255, 196, 110] // warm gold caller nodes

    if (drill.kind === 'token') {
      const center = rawById.get(drill.id)
      if (!center) return null
      // prefer the rich token-detail roster (top_authors, then authors); fall
      // back to the thin constellation `kols` only until the fetch lands.
      const detailAuthors = (drillTokenDetail && Array.isArray(drillTokenDetail.top_authors) && drillTokenDetail.top_authors.length)
        ? drillTokenDetail.top_authors
        : (drillTokenDetail && Array.isArray(drillTokenDetail.authors) ? drillTokenDetail.authors : [])
      const callers = (detailAuthors.length ? detailAuthors : (center.data && center.data.kols ? center.data.kols : [])).slice(0, 20)
      const callerSet = new Set(callers.map((k) => k.screen_name || k.name).filter(Boolean))
      // co-shilled tokens: other tokens whose callers overlap
      const co = []
      for (const en of model.engineNodes) {
        if (en.id === center.id) continue
        const ks = en.data && en.data.kols ? en.data.kols : []
        let shared = 0
        for (const k of ks) if (callerSet.has(k.screen_name || k.name)) shared++
        if (shared > 0) co.push({ en, shared })
      }
      co.sort((a, b) => b.shared - a.shared)
      const coTop = co.slice(0, 12)

      const nodes = [{ ...center, clusterKey: 'center', _pin: true, _rpx: CENTER_R, size: 1 }]
      const links = []
      callers.forEach((k) => {
        const sn = k.screen_name || k.name
        if (!sn) return
        const id = `kol:${sn}`
        const followers = k.followers_count || k.followers || 0
        nodes.push({
          id, clusterKey: 'kol', color: KOL_RGB, size: 0.5,
          glow: Math.max(0.35, Math.min(1, Math.log10(followers + 100) / 7)),
          logo: k.avatar_image_url || k.avatar || null,
          label: '@' + sn,
          _rpx: 18 + Math.min(20, Math.log10(followers + 100) * 6),
          _seed: hash01(id),
          data: { kind: 'kol', screen_name: sn, name: k.name || sn, avatar: k.avatar_image_url || k.avatar || null, followers, mention_count: k.mention_count },
        })
        links.push({ source: center.id, target: id, dist: 125, strength: 0.55 })
      })
      coTop.forEach(({ en }) => {
        nodes.push({ ...en, clusterKey: 'cotoken', _pin: false, _rpx: Math.max(22, (en._rpx || 26) * 0.72) })
        links.push({ source: center.id, target: en.id, dist: 185, strength: 0.22 })
      })
      return { nodes, links, callers, coTop }
    }

    if (drill.kind === 'kol') {
      const entry = kolIndex.get(drill.screen_name)
      if (!entry) return null
      const centerId = `kol:${drill.screen_name}`
      const nodes = [{
        id: centerId, clusterKey: 'center', color: KOL_RGB, size: 1, glow: 0.8,
        logo: entry.avatar, label: '@' + drill.screen_name, _pin: true, _rpx: CENTER_R,
        _seed: hash01(centerId), data: { kind: 'kol', ...entry },
      }]
      const links = []
      const toks = [...entry.tokens].sort((a, b) => (b._rpx || 0) - (a._rpx || 0)).slice(0, 24)
      toks.forEach((en) => {
        nodes.push({ ...en, clusterKey: 'cotoken', _pin: false, _rpx: Math.max(22, (en._rpx || 26) * 0.78) })
        links.push({ source: centerId, target: en.id, dist: 160, strength: 0.4 })
      })
      return { nodes, links, tokens: toks }
    }
    return null
  }, [drill, model, rawById, kolIndex, drillTokenDetail])

  const inNetwork = !!(networkModel && networkModel.nodes.length)
  const inBet = viewMode === 'bet' && !inNetwork

  /* ── BET FIELD model — the decision view. Re-pin each token to a data cell:
       X = authenticity (manufactured → organic), Y = momentum (fading →
       accelerating). GLOW = conviction (organic × accelerating) so the
       "Convicted" corner literally burns brightest; SIZE = attention (kept).
       The galaxy sector COLOR is kept so identity reads across both views. ─── */
  const betNodes = useMemo(() => {
    if (!model.engineNodes.length || !stageSize.w || !stageSize.h) return EMPTY_ARR
    const { w, h } = stageSize
    const mx = w * BET_MARGIN_X
    const my = h * BET_MARGIN_Y
    const innerW = Math.max(40, w - 2 * mx)
    const innerH = Math.max(40, h - 2 * my)
    // re-scale radius for the denser grid so cells don't collide into mush
    const rpxs = model.engineNodes.map((n) => n._rpx || 20)
    const rMin = Math.min(...rpxs); const rMax = Math.max(rMin + 1, ...rpxs)
    return model.engineNodes.map((n, i) => {
      const d = n.data || {}
      const auth = Math.max(0, Math.min(1, (Number(d.authenticity) || 0) / 100)) // X 0..1
      const mom = betMomentum(d.velocity)                                        // Y 0..1
      const tx = mx + auth * innerW
      const ty = (h - my) - mom * innerH // invert: high momentum → top of stage
      const conviction = Math.pow(auth * mom, 0.7) // organic × accelerating → bright
      const rNorm = (rpxs[i] - rMin) / (rMax - rMin)
      return {
        ...n,
        _tx: tx,
        _ty: ty,
        _rpx: BET_MIN_R + (BET_MAX_R - BET_MIN_R) * Math.pow(Math.max(0, Math.min(1, rNorm)), 0.85),
        glow: Math.max(0.06, conviction),
      }
    })
  }, [model.engineNodes, stageSize.w, stageSize.h])

  const engineNodes = inNetwork ? networkModel.nodes : (inBet ? betNodes : model.engineNodes)
  const engineClusters = (inNetwork || inBet) ? EMPTY_ARR : model.clusters
  const engineLinks = inNetwork ? networkModel.links : null
  const engineLayout = inBet ? 'quadrant' : 'galaxy'

  /* ── stage size tracking via a CALLBACK REF ─────────────────────────────
       The view shows a loading shimmer (a different subtree without the real
       stage) until data lands, so a plain useEffect([]) would capture a null
       ref and never attach. A callback ref re-binds the ResizeObserver to
       whichever <div> is actually the live stage, the moment it mounts. */
  const measureStage = useCallback((el) => {
    if (!el) return
    const rect = el.getBoundingClientRect()
    const w = Math.round(rect.width)
    const h = Math.round(rect.height)
    setStageSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
  }, [])

  const stageRef = useCallback((el) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    stageElRef.current = el
    if (!el) return
    measureStage(el)
    const ro = new ResizeObserver(() => measureStage(el))
    ro.observe(el)
    roRef.current = ro
  }, [measureStage])

  useEffect(() => () => { if (roRef.current) roRef.current.disconnect() }, [])

  /* ── drill navigation ───────────────────────────────────────────────────── */
  const enterToken = useCallback((node, { reset = false } = {}) => {
    const d = node.data || {}
    const crumb = { kind: 'token', id: node.id, label: '$' + String(d.symbol || '?').toUpperCase() }
    setDrillStack((s) => (reset ? [crumb] : [...s, crumb]))
    setFocusHub(null); setHoverHub(null)
  }, [])
  const enterKol = useCallback((d) => {
    setDrillStack((s) => [...s, { kind: 'kol', screen_name: d.screen_name, label: '@' + d.screen_name }])
  }, [])
  const goToCrumb = useCallback((idx) => { setDrillStack((s) => s.slice(0, idx + 1)) }, [])
  const exitToGalaxy = useCallback(() => { setDrillStack([]) }, [])

  // the side panel reflects the current centre — derived from `drill` (single
  // source of truth), so breadcrumb / back / re-center all stay in sync.
  const panelData = useMemo(() => {
    if (!drill) return null
    if (drill.kind === 'token') {
      const en = rawById.get(drill.id)
      if (!en) return null
      return { kind: 'token', node: en.data || {}, color: en.color, callers: networkModel?.callers || [], coTop: networkModel?.coTop || [] }
    }
    const entry = kolIndex.get(drill.screen_name)
    if (!entry) return null
    return { kind: 'kol', ...entry, tokens: networkModel?.tokens || [] }
  }, [drill, rawById, kolIndex, networkModel])

  /* ── engine callbacks ──────────────────────────────────────────────────── */
  const inNetworkRef = useRef(inNetwork)
  useEffect(() => { inNetworkRef.current = inNetwork }, [inNetwork])

  const onNodeClick = useCallback((node) => {
    if (!node) return
    const d = node.data || {}
    if (inNetworkRef.current) {
      if (node._pin) {
        // the centre — open the real token page (callers/co-tokens are the graph)
        if (d.kind !== 'kol' && d.asset && onOpenToken) {
          // seed the drawer with this node's social metrics so the Signal Score
          // never renders dead when /api/xdash/token/:id returns empty metrics.
          setTokenSeed(d.asset, d)
          onOpenToken(d.asset, { source: 'constellation-network' })
        }
        return
      }
      if (d.kind === 'kol') { enterKol(d); return }
      enterToken(node) // a co-shilled token → re-center on it
      return
    }
    enterToken(node, { reset: true }) // galaxy → open the token's network
  }, [onOpenToken, enterKol, enterToken])

  const onNodeHover = useCallback((node, screen) => {
    if (!node) { setHovered(null); return }
    setHovered({ node: node.data, color: node.color, x: screen?.x ?? 0, y: screen?.y ?? 0 })
  }, [])

  const onEmptyClick = useCallback(() => {
    if (inNetworkRef.current) { setDrillStack((s) => s.slice(0, -1)); return }
    setFocusHub(null)
  }, [])

  const onEngineReady = useCallback(() => { setEngineReady(true) }, [])

  /* ── nav rail → shared focus/hover; rail click frames the camera ────────── */
  const focusSector = useCallback((key) => {
    setFocusHub((cur) => (cur === key ? null : key))
    setHoverHub(null)
    setNavOpen(false)
  }, [])
  const onNavRowEnter = useCallback((key) => { if (!focusHub) setHoverHub(key) }, [focusHub])
  const onNavRowLeave = useCallback(() => { setHoverHub(null) }, [])

  const zoomBy = useCallback((factor) => { controlsRef.current?.zoomBy(factor) }, [])
  const resetView = useCallback(() => { controlsRef.current?.reset(); setFocusHub(null) }, [])

  /* the engine highlights whatever the nav rail commits OR softly hovers */
  const activeFocusKey = focusHub || hoverHub

  /* ── states ─────────────────────────────────────────────────────────────── */
  if (error && !nodes.length) {
    return (
      <div className="xd-cn">
        <ErrorState message={t('xDash.constellation.error', 'The constellation is unavailable right now.')} onRetry={() => refetch({ bypassCache: true })} />
      </div>
    )
  }
  if (loading && !nodes.length) {
    return (
      <div className="xd-cn">
        <div className="xd-cn__head">
          <div className="xd-cn__head-text">
            <span className="xd-cn__eyebrow">{t('xDash.constellation.eyebrow', 'NARRATIVE CONSTELLATION')}</span>
            <h2 className="xd-cn__title">{t('xDash.constellation.title', 'Where real attention lives.')}</h2>
          </div>
        </div>
        <div className="xd-cn__stage xd-cn__stage--loading">
          <SpectreLoader variant="logo" size="lg" label="Mapping attention" />
        </div>
      </div>
    )
  }
  if (degraded || !nodes.length) {
    return (
      <div className="xd-cn">
        <EmptyState
          title={t('xDash.constellation.empty.title', 'No constellation yet')}
          detail={t('xDash.constellation.empty.detail', 'Social attention is still being mapped. Check back shortly.')}
        />
      </div>
    )
  }

  const focusHubDef = focusHub ? model.clusters.find((c) => c.key === focusHub) : null
  const hovNode = hovered?.node
  const hovRgb = hovered?.color || OTHER_RGB

  const navSectors = model.clusters
  const maxNavWeighted = Math.max(1, ...navSectors.map((h) => Number(h._meta?.weighted) || 0))

  return (
    <div className={`xd-cn${inNetwork ? ' xd-cn--net' : ''}${fullscreen ? ' xd-cn--full' : ''}`}>
      {/* COSMOS starfield — three parallax layers of stars behind everything */}
      <div className="xd-cn__cosmos" aria-hidden="true">
        <span className="xd-cn__stars xd-cn__stars--a" />
        <span className="xd-cn__stars xd-cn__stars--b" />
        <span className="xd-cn__stars xd-cn__stars--c" />
      </div>

      {/* MASTHEAD */}
      <div className="xd-cn__head">
        <div className="xd-cn__head-text">
          <span className="xd-cn__eyebrow">
            {inBet
              ? t('xDash.constellation.bet.eyebrow', 'THE BET FIELD')
              : t('xDash.constellation.eyebrow', 'NARRATIVE CONSTELLATION')}
          </span>
          <h2 className="xd-cn__title">
            {inBet
              ? t('xDash.constellation.bet.title', 'What to bet on.')
              : t('xDash.constellation.title', 'Where real attention lives.')}
          </h2>
          <p className="xd-cn__lead">
            {inBet
              ? t('xDash.constellation.bet.lead', 'Every token placed by the two things that matter: is the attention real (→ right), and is it accelerating (↑ top). Top-right burns brightest — organic momentum. Bottom-left is dead. Click any bubble to see who is calling it.')
              : t('xDash.constellation.lead2', 'Each cluster is a narrative. Bigger bubble = more attention. The brighter it glows, the more organic the signal — dim bubbles are manufactured noise.')}
          </p>
        </div>

        {/* GALAXY ↔ BET view switch (hidden inside a drill-down network) */}
        {!inNetwork && (
          <div className="xd-cn__viewswitch" role="tablist" aria-label={t('xDash.constellation.viewLabel', 'Map view')}>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'galaxy'}
              className={`xd-cn__viewswitch-btn${viewMode === 'galaxy' ? ' xd-cn__viewswitch-btn--on' : ''}`}
              onClick={() => setViewMode('galaxy')}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="9" opacity="0.5" /></svg>
              {t('xDash.constellation.view.galaxy', 'Galaxy')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'bet'}
              className={`xd-cn__viewswitch-btn${viewMode === 'bet' ? ' xd-cn__viewswitch-btn--on' : ''}`}
              onClick={() => setViewMode('bet')}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M3 21h18" /><path d="M7 21V10M12 21V4M17 21v-7" /></svg>
              {t('xDash.constellation.view.bet', 'Bet')}
            </button>
          </div>
        )}

        <div className="xd-cn__meta">
          {generatedAt && (
            <span className="xd-cn__updated">
              {t('xDash.updated', 'updated {{when}}', { when: relativeTime(new Date(generatedAt).toISOString(), t) })}
            </span>
          )}
          <span className="xd-cn__count xd-num">
            {t('xDash.constellation.tokenCount', '{{count}} tokens', { count: formatNum(nodes.length, { locale: i18n.language }) })}
          </span>
        </div>
      </div>

      {/* BREADCRUMB — the drill trail (Galaxy › $TOKEN › @KOL) */}
      {inNetwork && (
        <div className="xd-cn__crumbs">
          <button type="button" className="xd-cn__crumb xd-cn__crumb--home" onClick={exitToGalaxy}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></svg>
            {t('xDash.constellation.galaxy', 'Galaxy')}
          </button>
          {drillStack.map((c, i) => (
            <span key={`${c.kind}:${c.id || c.screen_name}:${i}`} className="xd-cn__crumb-wrap">
              <svg className="xd-cn__crumb-sep" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              <button
                type="button"
                className={`xd-cn__crumb${i === drillStack.length - 1 ? ' xd-cn__crumb--active' : ''}`}
                onClick={() => goToCrumb(i)}
              >{c.label}</button>
            </span>
          ))}
        </div>
      )}

      {/* FOCUS CHIP */}
      {!inNetwork && !inBet && focusHubDef && (
        <div className="xd-cn__focusbar">
          <span className="xd-cn__focusdot" style={{ background: `rgb(${focusHubDef.color[0]},${focusHubDef.color[1]},${focusHubDef.color[2]})` }} />
          <span className="xd-cn__focuslabel">{t('xDash.constellation.focused', 'Focused on')}</span>
          <span className="xd-cn__focusname">{focusHubDef.label}</span>
          <span className="xd-cn__focuscount xd-num">{focusHubDef.count}</span>
          <button type="button" className="xd-btn xd-btn--secondary xd-btn--sm" onClick={() => setFocusHub(null)}>
            {t('xDash.constellation.clearFocus', 'Show all')}
          </button>
        </div>
      )}

      {/* STAGE — the engine fills it; chrome overlays sit on top */}
      <div className="xd-cn__stage" ref={stageRef}>
        {stageSize.w > 0 && engineNodes.length > 0 && (
          <ConstellationEngine
            nodes={engineNodes}
            clusters={engineClusters}
            links={engineLinks}
            layout={engineLayout}
            focusKey={(inNetwork || inBet) ? null : focusHub}
            highlightKey={(inNetwork || inBet) ? null : activeFocusKey}
            onNodeClick={onNodeClick}
            onNodeHover={onNodeHover}
            onEmptyClick={onEmptyClick}
            onReady={onEngineReady}
            controlsRef={controlsRef}
            stageSize={stageSize}
            reducedMotion={reducedMotion}
            mobile={isMobile}
            dayMode={dayMode}
          />
        )}

        {/* engine warm-up shimmer — sits over the canvas until first positions land */}
        {!engineReady && (
          <div className="xd-cn__stage-loader" aria-hidden="true">
            <Shimmer variant="card" count={1} />
          </div>
        )}

        {/* BET FIELD chrome — the quadrant grid + corner verdicts. Aligns to the
            bubbles via the engine's 1:1 camera (camera locked in this mode). */}
        {inBet && (
          <div className="xd-cn__bet" aria-hidden="true">
            <span className="xd-cn__bet-axis xd-cn__bet-axis--v" />
            <span className="xd-cn__bet-axis xd-cn__bet-axis--h" />
            <span className="xd-cn__bet-q xd-cn__bet-q--tr">
              <b>{t('xDash.constellation.bet.convicted', 'Convicted')}</b>
              <i>{t('xDash.constellation.bet.convictedSub', 'organic · accelerating')}</i>
            </span>
            <span className="xd-cn__bet-q xd-cn__bet-q--tl">
              <b>{t('xDash.constellation.bet.froth', 'Froth')}</b>
              <i>{t('xDash.constellation.bet.frothSub', 'manufactured · pumping')}</i>
            </span>
            <span className="xd-cn__bet-q xd-cn__bet-q--br">
              <b>{t('xDash.constellation.bet.quiet', 'Quiet · Real')}</b>
              <i>{t('xDash.constellation.bet.quietSub', 'organic · cooling')}</i>
            </span>
            <span className="xd-cn__bet-q xd-cn__bet-q--bl">
              <b>{t('xDash.constellation.bet.dead', 'Dead')}</b>
              <i>{t('xDash.constellation.bet.deadSub', 'manufactured · fading')}</i>
            </span>
            <span className="xd-cn__bet-xlabel">{t('xDash.constellation.bet.xaxis', 'Manufactured → Organic')}</span>
            <span className="xd-cn__bet-ylabel">{t('xDash.constellation.bet.yaxis', 'Fading → Accelerating')}</span>
          </div>
        )}

        {/* FULL-SCREEN toggle */}
        <button
          type="button"
          className="xd-cn__fs"
          onClick={() => setFullscreen((v) => !v)}
          aria-label={fullscreen ? t('xDash.constellation.exitFull', 'Exit full screen') : t('xDash.constellation.enterFull', 'Full screen')}
          title={fullscreen ? t('xDash.constellation.exitFull', 'Exit full screen') : t('xDash.constellation.enterFull', 'Full screen')}
        >
          {fullscreen ? (
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5" /></svg>
          )}
        </button>

        {/* SECTOR NAV RAIL (galaxy only) */}
        {!inNetwork && !inBet && (<>
        <button
          type="button"
          className={`xd-cn__navtoggle${navOpen ? ' xd-cn__navtoggle--on' : ''}`}
          onClick={() => setNavOpen((v) => !v)}
          aria-expanded={navOpen}
          aria-controls="xd-cn-nav"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span>{t('xDash.constellation.nav.title', 'Sectors')}</span>
          <span className="xd-cn__navtoggle-count xd-num">{navSectors.length}</span>
        </button>

        <div
          id="xd-cn-nav"
          className={`xd-cn__nav${navOpen ? ' xd-cn__nav--open' : ''}`}
          onMouseLeave={onNavRowLeave}
        >
          <div className="xd-cn__nav-head">
            <span className="xd-cn__nav-title">{t('xDash.constellation.nav.title', 'Sectors')}</span>
            <span className="xd-cn__nav-total xd-num">{navSectors.length}</span>
            <button
              type="button"
              className="xd-cn__nav-close"
              onClick={() => setNavOpen(false)}
              aria-label={t('xDash.constellation.nav.close', 'Close sectors')}
            >
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div className="xd-cn__nav-list" role="list">
            {navSectors.map((hub) => {
              const [r, g, b] = hub.color
              const active = activeFocusKey === hub.key
              const committed = focusHub === hub.key
              const weighted = Number(hub._meta?.weighted) || 0
              const barPct = Math.max(4, Math.round((weighted / maxNavWeighted) * 100))
              const auth = Math.max(0, Math.min(100, Number(hub._meta?.auth) || 0))
              return (
                <button
                  type="button"
                  role="listitem"
                  key={hub.key}
                  className={`xd-cn__nav-row${active ? ' xd-cn__nav-row--active' : ''}${committed ? ' xd-cn__nav-row--committed' : ''}`}
                  style={{ '--sector': `rgb(${r},${g},${b})` }}
                  onClick={() => focusSector(hub.key)}
                  onMouseEnter={() => onNavRowEnter(hub.key)}
                  onFocus={() => onNavRowEnter(hub.key)}
                  aria-pressed={committed}
                >
                  <span className="xd-cn__nav-swatch" aria-hidden="true" />
                  <span className="xd-cn__nav-body">
                    <span className="xd-cn__nav-name">{hub.label}</span>
                    <span className="xd-cn__nav-bar" aria-hidden="true">
                      <span className="xd-cn__nav-bar-fill" style={{ width: `${barPct}%` }} />
                    </span>
                  </span>
                  <span className="xd-cn__nav-meta">
                    <span className="xd-cn__nav-count xd-num">{hub.count}</span>
                    <span
                      className="xd-cn__nav-auth"
                      title={`${authLabel(auth, t)} · ${Math.round(auth)}%`}
                      aria-hidden="true"
                    >
                      <i className="xd-cn__nav-authdot" style={{ '--auth': auth / 100 }} />
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          {focusHub && (
            <button
              type="button"
              className="xd-cn__nav-showall"
              onClick={() => { setFocusHub(null); setHoverHub(null) }}
            >
              {t('xDash.constellation.clearFocus', 'Show all')}
            </button>
          )}
        </div>
        </>)}

        {/* SIDE PANEL — token / KOL intel; updates as you dig */}
        {inNetwork && panelData && (
          <NetworkPanel data={panelData} t={t} i18n={i18n} tokenDetail={drillTokenDetail} tweetsLoading={drillTokenLoading} onOpenToken={onOpenToken} onPickKol={enterKol} onPickToken={(id) => enterToken({ id, data: (rawById.get(id) || {}).data || {} })} />
        )}

        {/* ZOOM CONTROLS — hidden in the Bet field (fixed data grid, camera locked) */}
        {!inBet && (
          <div className="xd-cn__zoom">
            <button type="button" className="xd-cn__zoom-btn" onClick={() => zoomBy(1.4)} aria-label={t('xDash.constellation.zoomIn', 'Zoom in')}>+</button>
            <button type="button" className="xd-cn__zoom-btn" onClick={() => zoomBy(1 / 1.4)} aria-label={t('xDash.constellation.zoomOut', 'Zoom out')}>−</button>
            <button type="button" className="xd-cn__zoom-btn xd-cn__zoom-btn--reset" onClick={resetView} aria-label={t('xDash.constellation.reset', 'Reset view')}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" />
              </svg>
            </button>
          </div>
        )}

        {/* TOOLTIP — anchors to the hovered bubble */}
        {hovNode && (
          <div
            className="xd-cn__tip"
            style={{
              left: `${Math.min((hovered.x || 0) + 16, (stageSize.w || 0) - 248)}px`,
              top: `${Math.max(8, (hovered.y || 0) - 12)}px`,
              '--tip-accent': `rgb(${hovRgb[0]},${hovRgb[1]},${hovRgb[2]})`,
              '--tip-rgb': `${hovRgb[0]},${hovRgb[1]},${hovRgb[2]}`,
            }}
          >
            <div className="xd-cn__tip-head">
              <span className="xd-cn__tip-tag xd-num">${String(hovNode.symbol || '').toUpperCase()}</span>
              <span className="xd-cn__tip-auth">
                {authLabel(hovNode.authenticity, t)} · {Math.round(Number(hovNode.authenticity) || 0)}%
              </span>
            </div>
            <div className="xd-cn__tip-cat">
              <span className="xd-cn__tip-sectordot" />
              {hovNode.category}
            </div>
            <div className="xd-cn__tip-stats">
              <span><b className="xd-num">{formatNum(hovNode.mentions, { locale: i18n.language })}</b> {t('xDash.constellation.tip.mentions', 'mentions')}</span>
              <span><b className="xd-num">{formatNum(hovNode.kol_count, { locale: i18n.language })}</b> {t('xDash.constellation.tip.callers', 'callers')}</span>
              {Number(hovNode.market_cap) > 0 && <span><b className="xd-num">{fmtUsd(hovNode.market_cap)}</b> {t('xDash.constellation.mcap', 'mcap')}</span>}
            </div>
            {Array.isArray(hovNode.kols) && hovNode.kols.length > 0 && (
              <div className="xd-cn__tip-kols">
                {hovNode.kols.slice(0, 3).map((k, i) => (
                  <span key={k.screen_name || i} className="xd-cn__tip-kol">@{k.screen_name}</span>
                ))}
              </div>
            )}
            <div className="xd-cn__tip-cta">{t('xDash.constellation.tip.open', 'Click to open')}</div>
          </div>
        )}

        {/* LEGEND — galaxy: color=sector, glow=authenticity. bet: glow=conviction. */}
        {inBet ? (
          <div className="xd-cn__legend xd-cn__legend--bet">
            <div className="xd-cn__legend-row">
              <span className="xd-cn__legend-label">{t('xDash.constellation.legend.size', 'Size = attention')}</span>
            </div>
            <div className="xd-cn__legend-row">
              <span className="xd-cn__legend-label">{t('xDash.constellation.legend.conviction', 'Glow = conviction')}</span>
              <span className="xd-cn__legend-glow" aria-hidden="true" />
            </div>
            <div className="xd-cn__legend-row">
              <span className="xd-cn__legend-label">{t('xDash.constellation.legend.tail', 'Tail = accelerating ↑')}</span>
            </div>
          </div>
        ) : (
          <div className="xd-cn__legend">
            <div className="xd-cn__legend-row">
              <span className="xd-cn__legend-label">{t('xDash.constellation.legend.color2', 'Color = sector')}</span>
              <span className="xd-cn__legend-sectors" aria-hidden="true">
                {SECTOR_PALETTE.slice(0, 6).map((c, i) => (
                  <i key={i} className="xd-cn__legend-swatch" style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }} />
                ))}
              </span>
            </div>
            <div className="xd-cn__legend-row">
              <span className="xd-cn__legend-label">{t('xDash.constellation.legend.glow', 'Glow = authenticity')}</span>
              <span className="xd-cn__legend-glow" aria-hidden="true" />
            </div>
            <div className="xd-cn__legend-ends">
              <span>{t('xDash.constellation.legend.noise', 'noise')}</span>
              <span>{t('xDash.constellation.legend.organic', 'organic')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* compact USD for the panel (mcap) */
function fmtUsd(v) {
  const n = Number(v) || 0
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

/* ── NetworkPanel — the right-side intel rail in drill-down mode. Shows the
     current centre (token or KOL) and lets you keep digging by clicking a
     caller (→ their network) or a co-shilled token (→ re-center). ─────────── */
function NetworkPanel({ data, t, i18n, tokenDetail, tweetsLoading, onOpenToken, onPickKol, onPickToken }) {
  const loc = i18n.language
  // tokenDetail + tweetsLoading come from the parent's single useXDashToken(asset)
  // call (the same one that feeds the drill-down caller roster) — no 2nd fetch.

  if (data.kind === 'token') {
    const tweets = (tokenDetail && Array.isArray(tokenDetail.mentions)) ? tokenDetail.mentions : []
    const n = data.node || {}
    const auth = Math.max(0, Math.min(100, Number(n.authenticity) || 0))
    const [r, g, b] = data.color || OTHER_RGB
    const hue = `rgb(${r},${g},${b})`
    return (
      <aside className="xd-cn__panel" style={{ '--accent': hue }}>
        <div className="xd-cn__panel-head">
          {n.image
            ? <img className="xd-cn__panel-logo" src={n.image} alt="" loading="lazy" />
            : <span className="xd-cn__panel-logo xd-cn__panel-logo--ph">{String(n.symbol || '?').charAt(0)}</span>}
          <div className="xd-cn__panel-id">
            <span className="xd-cn__panel-sym xd-num">${String(n.symbol || '').toUpperCase()}</span>
            <span className="xd-cn__panel-name">{n.name || ''}</span>
          </div>
        </div>
        <div className="xd-cn__panel-cat"><i className="xd-cn__panel-catdot" />{n.category || '—'}</div>
        <div className="xd-cn__panel-stats">
          <div className="xd-cn__panel-stat"><span className="xd-cn__panel-statv xd-num">{formatNum(n.mentions, { locale: loc })}</span><span className="xd-cn__panel-statl">{t('xDash.constellation.tip.mentions', 'mentions')}</span></div>
          <div className="xd-cn__panel-stat"><span className="xd-cn__panel-statv xd-num">{formatNum((data.callers && data.callers.length) || n.kol_count, { locale: loc })}</span><span className="xd-cn__panel-statl">{t('xDash.constellation.tip.callers', 'callers')}</span></div>
          {Number(n.market_cap) > 0 && <div className="xd-cn__panel-stat"><span className="xd-cn__panel-statv xd-num">{fmtUsd(n.market_cap)}</span><span className="xd-cn__panel-statl">{t('xDash.constellation.mcap', 'mcap')}</span></div>}
        </div>
        <div className="xd-cn__panel-auth">
          <div className="xd-cn__panel-auth-row"><span>{authLabel(auth, t)}</span><span className="xd-num">{Math.round(auth)}%</span></div>
          <div className="xd-cn__panel-auth-bar"><span style={{ width: `${auth}%` }} /></div>
        </div>
        <button type="button" className="xd-cn__panel-open" onClick={() => { if (n.asset && onOpenToken) { setTokenSeed(n.asset, n); onOpenToken(n.asset, { source: 'constellation-panel' }) } }}>
          {t('xDash.constellation.openToken', 'Open token page')} →
        </button>
        {data.callers && data.callers.length > 0 && (
          <div className="xd-cn__panel-sec">
            <div className="xd-cn__panel-sec-h">{t('xDash.constellation.callers', 'Top callers')} <span className="xd-cn__panel-sec-n xd-num">{data.callers.length}</span></div>
            <div className="xd-cn__panel-kols">
              {data.callers.slice(0, 18).map((k, i) => {
                const sn = k.screen_name || k.name
                const av = k.avatar_image_url || k.avatar
                return (
                  <button key={sn || i} type="button" className="xd-cn__panel-kol" title={`@${sn} — open network`}
                    onClick={() => onPickKol({ screen_name: sn, name: k.name, avatar: av, followers: k.followers_count || k.followers })}>
                    {av ? <img src={av} alt="" loading="lazy" /> : <span className="xd-cn__panel-kol-ph">{String(sn || '?').charAt(0)}</span>}
                    <span className="xd-cn__panel-kol-h">@{sn}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {data.coTop && data.coTop.length > 0 && (
          <div className="xd-cn__panel-sec">
            <div className="xd-cn__panel-sec-h">{t('xDash.constellation.coShilled', 'Co-shilled by the same callers')}</div>
            <div className="xd-cn__panel-chips">
              {data.coTop.slice(0, 14).map(({ en }) => (
                <button key={en.id} type="button" className="xd-cn__panel-chip" onClick={() => onPickToken(en.id)} title={`Dig into $${String(en.data?.symbol || '').toUpperCase()}`}>
                  {en.logo ? <img src={en.logo} alt="" loading="lazy" /> : null}
                  <span className="xd-num">${String(en.data?.symbol || '').toUpperCase()}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {/* REAL TWEETS — the actual conversation driving the attention */}
        <div className="xd-cn__panel-sec xd-cn__panel-tweets">
          {tweets.length > 0 ? (
            <XDMentionsFeed
              mentions={tweets}
              tokenInfo={{ symbol: n.symbol, cashtag: `$${n.symbol}`, cg_id: n.asset, image: n.image }}
              label={t('xDash.constellation.tweets', 'Recent tweets')}
            />
          ) : (
            <>
              <div className="xd-cn__panel-sec-h">{t('xDash.constellation.tweets', 'Recent tweets')}</div>
              <div className="xd-cn__panel-tweets-empty">
                {tweetsLoading ? t('xDash.constellation.tweetsLoading', 'Loading tweets…') : t('xDash.constellation.tweetsEmpty', 'No tweets captured for this token yet.')}
              </div>
            </>
          )}
        </div>
      </aside>
    )
  }

  // KOL centre
  const toks = data.tokens || []
  return (
    <aside className="xd-cn__panel xd-cn__panel--kol" style={{ '--accent': 'rgb(255,196,110)' }}>
      <div className="xd-cn__panel-head">
        {data.avatar
          ? <img className="xd-cn__panel-logo xd-cn__panel-logo--round" src={data.avatar} alt="" loading="lazy" />
          : <span className="xd-cn__panel-logo xd-cn__panel-logo--ph">{String(data.screen_name || '?').charAt(0)}</span>}
        <div className="xd-cn__panel-id">
          <span className="xd-cn__panel-sym">@{data.screen_name}</span>
          <span className="xd-cn__panel-name">{formatNum(data.followers, { locale: loc })} {t('xDash.constellation.followers', 'followers')}</span>
        </div>
      </div>
      <div className="xd-cn__panel-sec">
        <div className="xd-cn__panel-sec-h">{t('xDash.constellation.calls', 'Tokens they call')} <span className="xd-cn__panel-sec-n xd-num">{toks.length}</span></div>
        <div className="xd-cn__panel-chips">
          {toks.slice(0, 24).map((en) => (
            <button key={en.id} type="button" className="xd-cn__panel-chip" onClick={() => onPickToken(en.id)} title={`Dig into $${String(en.data?.symbol || '').toUpperCase()}`}>
              {en.logo ? <img src={en.logo} alt="" loading="lazy" /> : null}
              <span className="xd-num">${String(en.data?.symbol || '').toUpperCase()}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}
