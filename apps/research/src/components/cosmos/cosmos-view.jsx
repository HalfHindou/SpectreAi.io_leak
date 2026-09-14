/**
 * CosmosView — the Spectre Cosmos: a cinematic spatial map of the market.
 *
 * React owns the HUD (view switcher, search-and-jump, cinematic mode, legend,
 * focus dossier); the WebGL engine (cosmos-engine.js) owns every frame. This
 * component is lazy-loaded by bubbles-page so three.js stays off the boot path.
 */
import React, { useEffect, useMemo, useRef, useState, useCallback, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useXDashBootstrap } from '@/hooks/useXDashBootstrap'
import { useWatchlists } from '@/contexts/WatchlistsContext'
import { isAppActive, subscribeActivity } from '@/lib/idleManager'
import { getSpectrePricesBySymbols } from '@/services/spectreMarketApi'
import { renderShareCard, getSpectreLogo, preloadLogos, CARD_PAD } from '@/lib/shareToX'
import { CosmosEngine } from './cosmos-engine'
import { buildCosmos, buildSocialCosmos, buildSectorCosmos, buildSocialLayer, groupOf, chainOf } from './cosmos-data'
import './cosmos.css'

const ShareXModal = lazy(() => import('@/components/share-x-modal'))

const fmtChange = (c) => `${(c || 0) >= 0 ? '+' : ''}${(Number(c) || 0).toFixed(2)}%`
const fmtCount = (n) => {
  const v = Number(n) || 0
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
  return String(v)
}

// survive fullscreen remounts: the portal recreates CosmosView, so the chosen
// view / source / orbit speed / intro state live at module scope
let _lastView = 'solar'
let _lastSpeed = 1
let _lastSource = 'market' // 'market' | 'xdash' | 'sectors' | 'watchlist'
let _lastXdCount = 50
let _lastAnchor = true
let _lastLabelMode = 'change' // 'change' | 'price' | 'mcap' | 'name'
let _lastSector = null
let _lastChain = 'all'
let _introPlayed = false
// "how to read this" auto-opens exactly once per browser
let _onboarded = typeof window !== 'undefined' && window.localStorage?.getItem('spectre-cosmos-onboarded') === '1'

const LABEL_MODES = ['change', 'price', 'mcap', 'name', 'off']
const LABEL_MODE_BADGE = { change: '%', price: '$', mcap: 'MC', name: 'Aa', off: 'Off' }

/**
 * SocialPanel — the X Dash leaderboard rail. Pure presentation: rows come
 * from the parent's bootstrap fetch; clicking a row flies the camera there.
 */
function SocialPanel({ rows, isMobile, onJump, t }) {
  const [open, setOpen] = useState(!isMobile)
  if (!rows.length) return null
  return (
    <div className={`cosmos-social${open ? ' open' : ''}`}>
      <button className="cosmos-social-head" onClick={() => setOpen(o => !o)}>
        <span className="cosmos-social-dot" />
        {t('bubbles.cosmos.socialTitle', 'X Dash · Social heat')}
        <svg className="cosmos-social-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      {open && (
        <div className="cosmos-social-body">
          {rows.map(r => (
            <button key={r.sym} className="cosmos-social-row" onClick={() => onJump(r.sym)}>
              <span className="cosmos-social-rank">{r.rank}</span>
              {r.logo
                ? <img src={r.logo} alt="" />
                : <span className="cosmos-social-fallback">{r.sym[0]}</span>}
              <span className="cosmos-social-sym">{r.sym}{r.isComet && <em title={t('bubbles.cosmos.cometTag', 'comet — outside the map')}> ☄</em>}</span>
              <span className="cosmos-social-mentions">{fmtCount(r.mentions)}<label>{t('bubbles.cosmos.mentions', 'mentions')}</label></span>
              <span className="cosmos-social-authors">{fmtCount(r.authors)}<label>{t('bubbles.cosmos.voices', 'voices')}</label></span>
            </button>
          ))}
          <div className="cosmos-social-foot">{t('bubbles.cosmos.socialFoot', '☄ = trending beyond the top-cap map')}</div>
        </div>
      )}
    </div>
  )
}

/* mini 7d sparkline for the focus dossier */
function SparkCanvas({ data, positive }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !data || data.length < 2) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth, h = canvas.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    let min = Infinity, max = -Infinity
    for (const v of data) { if (v < min) min = v; if (v > max) max = v }
    const range = max - min || 1
    const color = positive ? '52, 211, 153' : '248, 113, 113'
    ctx.beginPath()
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w
      const y = h - 3 - ((v - min) / range) * (h - 6)
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.strokeStyle = `rgba(${color}, 0.9)`
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.lineTo(w, h)
    ctx.lineTo(0, h)
    ctx.closePath()
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, `rgba(${color}, 0.18)`)
    g.addColorStop(1, `rgba(${color}, 0)`)
    ctx.fillStyle = g
    ctx.fill()
  }, [data, positive])
  return <canvas ref={ref} className="cosmos-spark" />
}

export default function CosmosView({
  tokens, getChange, tfLabel, isStocks, dayMode, isMobile,
  fmtPrice, fmtLarge, onTokenClick, livePricesRef, sparklineMap, t,
}) {
  const hostRef = useRef(null)
  const engineRef = useRef(null)
  const hoverCardRef = useRef(null)

  const [view, setViewState] = useState(_lastView)
  const setView = useCallback((v) => { _lastView = v; setViewState(v) }, [])
  const [cinematic, setCinematic] = useState(false)
  const [speed, setSpeedState] = useState(_lastSpeed)
  const setSpeed = useCallback((updater) => {
    setSpeedState((s) => {
      const next = typeof updater === 'function' ? updater(s) : updater
      _lastSpeed = next
      return next
    })
  }, [])
  // universe source: market-cap map, X Dash leaderboard, or sector constellation
  const [source, setSourceState] = useState(isStocks && _lastSource === 'xdash' ? 'market' : _lastSource)
  const [sectorFocus, setSectorFocusState] = useState(_lastSector)
  const setSectorFocus = useCallback((s) => { _lastSector = s; setSectorFocusState(s) }, [])
  const setSource = useCallback((s) => {
    _lastSource = s
    setSourceState(s)
    _lastSector = null
    setSectorFocusState(null)
  }, [])
  const [xdCount, setXdCountState] = useState(_lastXdCount)
  const setXdCount = useCallback((n) => { _lastXdCount = n; setXdCountState(n) }, [])
  const [withAnchor, setWithAnchorState] = useState(_lastAnchor)
  const setWithAnchor = useCallback((v) => { _lastAnchor = v; setWithAnchorState(v) }, [])
  const [labelMode, setLabelModeState] = useState(_lastLabelMode)
  const setLabelMode = useCallback((m) => { _lastLabelMode = m; setLabelModeState(m) }, [])
  const [chainFilter, setChainFilterState] = useState(_lastChain)
  const setChainFilter = useCallback((c) => { _lastChain = c; setChainFilterState(c) }, [])
  const [chainMenuOpen, setChainMenuOpen] = useState(false)
  // mobile: secondary controls (chains / counts / labels) fold behind a tune
  // button — five stacked HUD rows were burying the universe on a phone
  const [mobileTools, setMobileTools] = useState(false)
  const [explainOpen, setExplainOpen] = useState(!_onboarded)
  const closeExplainer = useCallback(() => {
    setExplainOpen(false)
    _onboarded = true
    try { window.localStorage?.setItem('spectre-cosmos-onboarded', '1') } catch { /* private mode */ }
  }, [])
  const [focused, setFocused] = useState(null) // body | {isSun, sun} | null
  const [hoverBody, setHoverBody] = useState(null)
  const [searchQ, setSearchQ] = useState('')
  const [ready, setReady] = useState(false)

  /* X Dash leaderboard — powers the overlay auras/comets, the leaderboard
     panel, AND the full social universe (25/50/100 client-sliced). The
     bootstrap endpoint hard-caps per_page at 50 (a per_page=100 request
     silently returns 50 — why "top 100" only showed half), so the top-100
     is TWO pages stitched together. Stocks mode fetches a 1-row stub for
     both (identical cache key = one request; hooks can't be conditional). */
  const { data: xdashData } = useXDashBootstrap(
    isStocks
      ? { page: 1, perPage: 1 }
      : { page: 1, perPage: 50, timeframe: '24h', ranking: 'mentions' },
  )
  const { data: xdashData2 } = useXDashBootstrap(
    isStocks
      ? { page: 1, perPage: 1 }
      : { page: 2, perPage: 50, timeframe: '24h', ranking: 'mentions' },
  )
  const xdashRows = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const r of [...(xdashData?.tokens || []), ...(xdashData2?.tokens || [])]) {
      const sym = (r.symbol || '').toUpperCase()
      if (sym && !seen.has(sym)) { seen.add(sym); out.push(r) }
    }
    return out
  }, [xdashData, xdashData2])

  /* ── per-chain filter ──
     chain resolution: native-chain overrides → X Dash catalog `chain` field
     (symbol-matched) → ecosystem chain groups. Options come from the data. */
  const chainIndex = useMemo(() => {
    const map = new Map()
    for (const r of xdashRows) {
      const sym = (r.symbol || '').toUpperCase()
      if (sym && r.chain) map.set(sym, r.chain)
    }
    return map
  }, [xdashRows])
  const tokenChain = useCallback(
    (sym) => chainOf(sym, chainIndex.get((sym || '').toUpperCase())),
    [chainIndex],
  )
  const fTokens = useMemo(() => {
    if (isStocks || chainFilter === 'all') return tokens
    return tokens.filter(tk => tokenChain(tk.symbol) === chainFilter)
  }, [tokens, chainFilter, tokenChain, isStocks])
  const fXdashRows = useMemo(() => {
    if (chainFilter === 'all') return xdashRows
    return xdashRows.filter(r => tokenChain(r.symbol) === chainFilter)
  }, [xdashRows, chainFilter, tokenChain])
  const chainOptions = useMemo(() => {
    if (isStocks) return []
    const counts = new Map()
    const pool = source === 'xdash' ? xdashRows : tokens
    for (const item of pool) {
      const c = tokenChain(item.symbol)
      if (c) counts.set(c, (counts.get(c) || 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
  }, [tokens, xdashRows, source, tokenChain, isStocks])

  const marketCosmos = useMemo(
    () => buildCosmos(fTokens.length ? fTokens : tokens, getChange, isStocks),
    [fTokens, tokens, getChange, isStocks],
  )

  /* ── watchlist universe: EVERY starred token, not just top-100 matches ──
     Watchlists are mostly on-chain small caps that never appear in the loaded
     map, so matching against `tokens` alone rendered a near-empty sky. Now:
     loaded-map match → /v1/prices enrichment (live price/change/mcap/image
     for arbitrary symbols, TTL-cached) → the entry's own stored data. */
  const { watchlists } = useWatchlists() || {}
  const watchEntries = useMemo(() => {
    const map = new Map()
    for (const wl of watchlists || []) {
      for (const tk of wl.tokens || []) {
        if (isStocks ? !tk.isStock : tk.isStock) continue
        const sym = (tk.symbol || '').toUpperCase()
        if (sym && !map.has(sym)) map.set(sym, tk)
      }
    }
    return map
  }, [watchlists, isStocks])

  const [wlPrices, setWlPrices] = useState(null)
  useEffect(() => {
    if (source !== 'watchlist' || isStocks || watchEntries.size === 0) return
    let cancelled = false
    getSpectrePricesBySymbols([...watchEntries.keys()])
      .then((map) => { if (!cancelled) setWlPrices(map || {}) })
      .catch(() => { if (!cancelled) setWlPrices({}) })
    return () => { cancelled = true }
  }, [source, isStocks, watchEntries])

  const watchedTokens = useMemo(() => {
    if (!watchEntries.size) return []
    const marketBySym = new Map(tokens.map(tk => [(tk.symbol || '').toUpperCase(), tk]))
    const out = []
    for (const [sym, entry] of watchEntries) {
      const market = marketBySym.get(sym)
      if (market) { out.push(market); continue }
      if (isStocks) continue // no arbitrary-symbol feed for stocks yet
      const p = wlPrices?.[sym]
      if (p) {
        // normalizeSpectrePriceRow shape: price / change24 / marketCap / volume / image
        out.push({
          rank: p.rank || 0,
          symbol: sym,
          name: p.name || entry.name || sym,
          logo: p.image || entry.logo || entry.image || null,
          price: Number(p.price) || 0,
          change24h: Number(p.change24) || 0,
          change1h: Number(p.change1h) || 0,
          change7d: Number(p.change7d) || 0,
          marketCap: Number(p.marketCap) || 0,
          volume: Number(p.volume) || 0,
          _type: 'crypto',
        })
      } else {
        // feed hasn't resolved this symbol — still show the world with
        // whatever the watchlist entry itself carries
        out.push({
          rank: 0,
          symbol: sym,
          name: entry.name || sym,
          logo: entry.logo || entry.image || null,
          price: Number(entry.price) || 0,
          change24h: Number(entry.change24h ?? entry.change) || 0,
          change1h: 0,
          change7d: 0,
          marketCap: Number(entry.marketCap ?? entry.market_cap) || 0,
          volume: Number(entry.volume) || 0,
          _type: 'crypto',
        })
      }
    }
    return out
  }, [watchEntries, tokens, wlPrices, isStocks])

  const cosmos = useMemo(() => {
    if (source === 'xdash' && !isStocks && xdashRows.length) {
      const anchor = withAnchor ? marketCosmos.sun : null
      const rows = fXdashRows.length ? fXdashRows : xdashRows
      return buildSocialCosmos(rows, xdCount, anchor, tokens, getChange)
    }
    if (source === 'sectors') {
      const base = fTokens.length ? fTokens : tokens
      if (sectorFocus) {
        // dive: this sector's own solar system (its biggest token becomes the sun)
        const inSector = base.filter(tk => groupOf(tk, isStocks) === sectorFocus)
        if (inSector.length) return buildCosmos(inSector, getChange, isStocks)
      }
      return buildSectorCosmos(base, getChange, isStocks)
    }
    if (source === 'watchlist' && watchedTokens.length) {
      const wl = chainFilter === 'all'
        ? watchedTokens
        : watchedTokens.filter(tk => tokenChain(tk.symbol) === chainFilter)
      return buildCosmos(wl.length ? wl : watchedTokens, getChange, isStocks)
    }
    return marketCosmos
  }, [source, sectorFocus, isStocks, xdashRows, fXdashRows, fTokens, chainFilter, tokenChain, xdCount, withAnchor, marketCosmos, tokens, watchedTokens, getChange])

  const watchlistEmpty = source === 'watchlist' && !watchedTokens.length

  /* social payload for the engine: overlays in market mode, self-auras in
     xdash mode, cleared in the sector constellation */
  const socialPayload = useMemo(() => {
    if (isStocks || !cosmos?.bodies) return null
    if (source === 'sectors') return { auras: [], comets: [] }
    if (!xdashRows.length) return null
    if (source === 'xdash') {
      return {
        auras: cosmos.bodies.filter(b => b.social).map(b => ({ id: b.id, ...b.social })),
        comets: [],
      }
    }
    const universeIds = new Set(cosmos.bodies.map(b => b.id))
    const layer = buildSocialLayer(xdashRows.slice(0, 14), universeIds, cosmos.sun?.id)
    // the watchlist universe is personal — social auras yes, stranger comets no
    if (source === 'watchlist') return { auras: layer.auras, comets: [] }
    return layer
  }, [xdashRows, cosmos, source, isStocks])

  const panelRows = useMemo(() => {
    if (isStocks || !xdashRows.length) return []
    const cometIds = new Set((source === 'market' ? socialPayload?.comets || [] : []).map(c => c.id))
    return xdashRows.slice(0, 10).map((row, i) => {
      const sym = (row.symbol || '').toUpperCase()
      return {
        rank: i + 1,
        sym,
        logo: row.image_small || row.image || null,
        mentions: Number(row.mentions ?? row.external_mentions) || 0,
        authors: Number(row.unique_authors_24h ?? row.author_count) || 0,
        isComet: cometIds.has(sym),
      }
    })
  }, [xdashRows, socialPayload, source, isStocks])

  /* keep focused panel bound to fresh body objects across data refreshes */
  const focusedIdRef = useRef(null)
  focusedIdRef.current = focused?.isSun ? '__sun__' : focused?.id || null

  /* sector drill-in: stable ref so the engine's mount-time onSelect callback
     always reaches the live handler */
  const drillRef = useRef(null)
  drillRef.current = (body) => {
    setSectorFocus(body.group)
    setFocused(null)
    engineRef.current?.focusBody(null)
    engineRef.current?.resetCamera()
  }

  /* ── engine lifecycle ── */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

    const engine = new CosmosEngine(host, {
      isMobile,
      dayMode,
      reducedMotion,
      initialView: _lastView,
      labelMode: _lastLabelMode,
      skipIntro: _introPlayed, // fullscreen remount = quick settle, not the full flight

      onHover: (body, x, y) => {
        setHoverBody((prev) => {
          const next = body || null
          return prev === next ? prev : next
        })
        // position the hover card without a React render per mousemove;
        // flip above/left of the cursor near the host edges instead of
        // pinning awkwardly to the bottom corner. Engine emits viewport
        // coords; the card is absolute in .cosmos-root, so convert to local.
        const card = hoverCardRef.current
        if (card && body) {
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
        if (body?.isSector) drillRef.current?.(body)
        else setFocused(body || null)
      },
    })
    engineRef.current = engine
    host.__cosmosEngine = engine // dev/debug handle (harmless in prod)
    setReady(true)
    _introPlayed = true

    const ro = new ResizeObserver(() => engine.resize())
    ro.observe(host)
    const io = new IntersectionObserver(
      (entries) => engine.setRunning(entries[0]?.isIntersecting !== false),
      { threshold: 0.02 },
    )
    io.observe(host)

    // GPU thermals: a visible-but-abandoned tab shouldn't keep the universe
    // spinning — stop after the app-wide 5-min idle, wake on any activity
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
    // engine is created once per mount; day-mode / data changes flow through setters below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* data in */
  useEffect(() => {
    if (!engineRef.current || !cosmos.bodies) return
    engineRef.current.setData(cosmos)
    // re-bind the focus panel to the fresh body object (planet, comet or sun)
    const fid = focusedIdRef.current
    if (fid && fid !== '__sun__') {
      setFocused(engineRef.current.findBody(fid))
    } else if (fid === '__sun__') {
      setFocused(cosmos.sun ? { isSun: true, sun: cosmos.sun } : null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cosmos, ready])

  useEffect(() => {
    if (!ready || !socialPayload) return
    engineRef.current?.setSocial(socialPayload)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socialPayload, ready])

  useEffect(() => { engineRef.current?.setDayMode(dayMode) }, [dayMode, ready])
  useEffect(() => { engineRef.current?.setView(view) }, [view, ready])
  useEffect(() => { engineRef.current?.setCinematic(cinematic) }, [cinematic, ready])
  useEffect(() => { engineRef.current?.setSpeed(speed) }, [speed, ready])
  useEffect(() => { engineRef.current?.setLabelMode(labelMode) }, [labelMode, ready])

  /* keyboard navigation. Registered in the CAPTURE phase so Escape can peel
     cosmos layers first (cinema → focus) and stop before the page-level
     handler closes the fullscreen portal — only a "bare" Escape falls through. */
  useEffect(() => {
    const onKey = (e) => {
      const engine = engineRef.current
      if (!engine) return
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return
      switch (e.key) {
        case 'Escape':
          if (explainOpen) { closeExplainer(); e.stopPropagation() }
          else if (chainMenuOpen) { setChainMenuOpen(false); e.stopPropagation() }
          else if (cinematic) { setCinematic(false); e.stopPropagation() }
          else if (focused) { engine.focusBody(null); setFocused(null); e.stopPropagation() }
          else if (sectorFocus) {
            // climb out of the sector back to the constellation
            setSectorFocus(null)
            engine.resetCamera()
            e.stopPropagation()
          }
          else return // nothing to peel — let the page close fullscreen
          break
        case 'ArrowLeft': engine.nudge({ yaw: 0.08, panX: -46 }); break
        case 'ArrowRight': engine.nudge({ yaw: -0.08, panX: 46 }); break
        case 'ArrowUp': engine.nudge({ pitch: 0.05, panY: -46 }); break
        case 'ArrowDown': engine.nudge({ pitch: -0.05, panY: 46 }); break
        case '+': case '=': engine.nudge({ zoom: 0.85 }); break
        case '-': case '_': engine.nudge({ zoom: 1.18 }); break
        case '0': case 'Home': engine.resetCamera(); setFocused(null); break
        case 'c': case 'C': setCinematic(v => !v); break
        default: return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [cinematic, focused, sectorFocus, setSectorFocus, explainOpen, closeExplainer, chainMenuOpen])

  /* search — spans the WHOLE catalog, not just the current universe:
     current worlds first, then the market map, then the X Dash leaderboard.
     Picking an out-of-universe result switches the source and focuses the
     world once the new universe has built. */
  const results = useMemo(() => {
    const q = searchQ.trim().toUpperCase()
    if (!q) return []
    const seen = new Set()
    const out = []
    const matches = (id, name) => id.includes(q) || (name || '').toUpperCase().includes(q)
    const push = (id, token, meta) => {
      if (!id || seen.has(id) || !matches(id, token?.name)) return
      seen.add(id)
      out.push({ id, token, ...meta })
    }
    if (cosmos.sun) push(cosmos.sun.id, cosmos.sun.token, { isSun: true, inUniverse: true })
    for (const b of cosmos.bodies) push(b.id, b.token, { inUniverse: true, isSector: b.isSector, body: b })
    for (const tk of tokens) {
      push((tk.symbol || '').toUpperCase(), tk, { srcHint: 'market' })
    }
    if (!isStocks) {
      for (let i = 0; i < xdashRows.length; i++) {
        const r = xdashRows[i]
        const sym = (r.symbol || '').toUpperCase()
        push(sym, { symbol: sym, name: r.name || sym, logo: r.image_small || r.image || null }, { srcHint: 'xdash', xdIndex: i })
      }
    }
    return out.slice(0, 8)
  }, [searchQ, cosmos, tokens, xdashRows, isStocks])

  /* focus deferred until the switched-to universe has rebuilt */
  const pendingFocusRef = useRef(null)

  const jumpTo = useCallback((r) => {
    const engine = engineRef.current
    if (!engine) return
    setSearchQ('')
    if (r.isSun) {
      engine.focusBody('SUN_FOCUS')
      setFocused({ isSun: true, sun: cosmos.sun })
      return
    }
    if (r.isSector) {
      drillRef.current?.(r.body || r)
      return
    }
    // in the current universe (planet or comet) → straight fly-to
    const here = engine.findBody(r.id)
    if (here) {
      engine.focusBody(r.id)
      setFocused(here)
      return
    }
    // elsewhere in the catalog → switch universes, focus after the rebuild
    if (r.srcHint) {
      pendingFocusRef.current = r.id
      setChainFilter('all') // the target must exist in the new universe
      if (r.srcHint === 'xdash' && r.xdIndex != null && r.xdIndex >= xdCount) {
        setXdCount(r.xdIndex >= 50 ? 100 : 50)
      }
      setSource(r.srcHint)
    }
  }, [cosmos, xdCount, setXdCount, setSource, setChainFilter])

  /* complete a cross-universe jump once the new cosmos has landed in the
     engine (this effect is declared AFTER the setData effect on purpose) */
  useEffect(() => {
    const id = pendingFocusRef.current
    if (!id || !ready) return
    const engine = engineRef.current
    if (!engine) return
    if (cosmos.sun?.id === id) {
      pendingFocusRef.current = null
      engine.focusBody('SUN_FOCUS')
      setFocused({ isSun: true, sun: cosmos.sun })
      return
    }
    const target = engine.findBody(id)
    if (target) {
      pendingFocusRef.current = null
      engine.focusBody(id)
      setFocused(target)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cosmos, ready])

  /* jump by symbol — used by the social leaderboard (planet, comet, or sun) */
  const jumpToId = useCallback((sym) => {
    const engine = engineRef.current
    if (!engine) return
    if (cosmos.sun?.id === sym) {
      engine.focusBody('SUN_FOCUS')
      setFocused({ isSun: true, sun: cosmos.sun })
      return
    }
    const target = engine.findBody(sym)
    if (target) {
      engine.focusBody(sym)
      setFocused(target)
    }
  }, [cosmos])

  const clearFocus = useCallback(() => {
    engineRef.current?.focusBody(null)
    setFocused(null)
  }, [])

  /* live price lookup (Binance overlay for crypto) */
  const liveFor = useCallback((token) => {
    if (!token) return { price: 0 }
    if (isStocks) return { price: token.price }
    const sym = (token.symbol || '').toUpperCase()
    const ld = livePricesRef?.current?.[sym] || {}
    return { price: ld.price > 0 ? ld.price : token.price }
  }, [isStocks, livePricesRef])

  /* focus dossier data */
  /* ── share to X: the live WebGL frame inside the branded card ── */
  const [shareOpen, setShareOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState(null)
  const [shareDesc, setShareDesc] = useState('')
  const sourceLabel = source === 'xdash'
    ? t('bubbles.cosmos.srcXdash', 'X Dash')
    : source === 'sectors'
      ? t('bubbles.cosmos.srcSectors', 'Sectors')
      : source === 'watchlist'
        ? t('bubbles.cosmos.srcWatchlist', 'Watchlist')
        : t('bubbles.cosmos.srcMarket', 'Market')

  const handleShare = useCallback(async () => {
    const engine = engineRef.current
    if (!engine) return
    setShareOpen(true)
    setShareUrl(null)
    try {
      const snap = engine.snapshot()
      const img = new Image()
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = snap })

      /* poster data: sun + field insights for the chips row */
      const bodiesArr = cosmos.bodies || []
      let best = null, worst = null, loudest = null, fastest = null
      let up = 0, down = 0, voices = 0
      for (const b of bodiesArr) {
        if ((b.change || 0) >= 0) up++; else down++
        if (!best || (b.change || 0) > (best.change || 0)) best = b
        if (!worst || (b.change || 0) < (worst.change || 0)) worst = b
        if (b.mentions != null && (!loudest || b.mentions > loudest.mentions)) loudest = b
        if (b.velocity != null && (!fastest || b.velocity > fastest.velocity)) fastest = b
        voices += b.authors || 0
      }
      const sunTok = cosmos.sun?.token
      const [logo, logoMap] = await Promise.all([
        getSpectreLogo(),
        sunTok?.logo ? preloadLogos([sunTok], (tk) => (tk.logo || '').split('?')[0]) : Promise.resolve({}),
      ])
      const sunLogo = logoMap[sunTok?.symbol]
      const sunPrice = cosmos.sun && !cosmos.sun.noMarket ? fmtPrice(liveFor(sunTok).price) : null
      const isSocialUniverse = source === 'xdash'

      const chips = isSocialUniverse
        ? [
            loudest && { label: t('bubbles.cosmos.shareLoudest', 'LOUDEST'), value: `$${loudest.id}`, sub: `${fmtCount(loudest.mentions)} ${t('bubbles.cosmos.mentions', 'mentions')}`, tone: 'social' },
            fastest && fastest.velocity > 1 && { label: t('bubbles.cosmos.shareFastest', 'ACCELERATING'), value: `$${fastest.id}`, sub: `${fastest.velocity.toFixed(1)}× ${t('bubbles.cosmos.chatter', 'chatter')}`, tone: 'social' },
            { label: t('bubbles.cosmos.voices', 'voices').toUpperCase(), value: fmtCount(voices), sub: t('bubbles.cosmos.shareAcross', 'across the field'), tone: 'neutral' },
          ].filter(Boolean)
        : [
            best && { label: t('heatmaps.topGainer', 'Top gainer').toUpperCase(), value: `$${best.id}`, sub: fmtChange(best.change), tone: 'pos' },
            worst && { label: t('heatmaps.topLoser', 'Top loser').toUpperCase(), value: `$${worst.id}`, sub: fmtChange(worst.change), tone: 'neg' },
            { label: t('bubbles.cosmos.shareBreadth', 'BREADTH'), value: `${up} ▲  ${down} ▼`, sub: `${bodiesArr.length + 1} ${t('bubbles.cosmos.worlds', 'worlds')}`, tone: 'neutral' },
          ].filter(Boolean)

      const dataUrl = renderShareCard((ctx, w, contentTop, c, fonts) => {
        const pad = CARD_PAD
        const iw = w - pad * 2
        const ih = Math.min(470, Math.round(iw * (img.height / img.width)))

        /* — the universe, full bleed in a rounded frame — */
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(pad, contentTop, iw, ih, 18)
        ctx.clip()
        const scale = Math.max(iw / img.width, ih / img.height)
        const dw = img.width * scale
        const dh = img.height * scale
        ctx.drawImage(img, pad + (iw - dw) / 2, contentTop + (ih - dh) / 2, dw, dh)

        // cinematic scrim so the sun block reads on any frame
        const scrimH = 150
        const scrim = ctx.createLinearGradient(0, contentTop + ih - scrimH, 0, contentTop + ih)
        scrim.addColorStop(0, 'rgba(3,4,8,0)')
        scrim.addColorStop(0.55, 'rgba(3,4,8,0.62)')
        scrim.addColorStop(1, 'rgba(3,4,8,0.9)')
        ctx.fillStyle = scrim
        ctx.fillRect(pad, contentTop + ih - scrimH, iw, scrimH)

        /* — sun block on the scrim — */
        if (cosmos.sun) {
          const by = contentTop + ih - 26
          let bx = pad + 24
          if (sunLogo) {
            const ls = 46
            ctx.save()
            ctx.beginPath()
            ctx.arc(bx + ls / 2, by - 14, ls / 2, 0, Math.PI * 2)
            ctx.clip()
            ctx.drawImage(sunLogo, bx, by - 14 - ls / 2, ls, ls)
            ctx.restore()
            ctx.beginPath()
            ctx.arc(bx + ls / 2, by - 14, ls / 2, 0, Math.PI * 2)
            ctx.strokeStyle = 'rgba(255,200,90,0.55)'
            ctx.lineWidth = 1.5
            ctx.stroke()
            bx += ls + 14
          }
          ctx.textAlign = 'left'
          ctx.fillStyle = '#f5f5f7'
          ctx.font = `700 26px ${fonts.body}`
          ctx.fillText(`$${cosmos.sun.id}`, bx, by - 18)
          let vx = bx + ctx.measureText(`$${cosmos.sun.id}`).width + 14
          if (sunPrice) {
            ctx.font = `600 26px ${fonts.mono}`
            ctx.fillStyle = 'rgba(245,245,247,0.88)'
            ctx.fillText(sunPrice, vx, by - 18)
            vx += ctx.measureText(sunPrice).width + 12
            ctx.fillStyle = (cosmos.sun.change || 0) >= 0 ? '#34d399' : '#f87171'
            ctx.fillText(fmtChange(cosmos.sun.change), vx, by - 18)
          } else if (cosmos.sun.mentions != null) {
            ctx.font = `600 24px ${fonts.mono}`
            ctx.fillStyle = '#9be9ff'
            ctx.fillText(`${fmtCount(cosmos.sun.mentions)} ${t('bubbles.cosmos.mentions', 'mentions')}`, vx, by - 18)
          }
          ctx.font = `600 11px ${fonts.body}`
          ctx.fillStyle = 'rgba(245,245,247,0.5)'
          ctx.fillText(
            `☀ ${t('bubbles.cosmos.sunCaption', 'The Sun — market leader').toUpperCase()}`,
            bx, by + 6,
          )
          // right side: universe meta
          ctx.textAlign = 'right'
          ctx.font = `700 22px ${fonts.body}`
          ctx.fillStyle = '#f5f5f7'
          ctx.fillText(`${bodiesArr.length + 1}`, pad + iw - 24, by - 20)
          ctx.font = `600 10px ${fonts.body}`
          ctx.fillStyle = 'rgba(245,245,247,0.5)'
          ctx.fillText(
            `${t('bubbles.cosmos.worlds', 'worlds').toUpperCase()} · ${tfLabel} · ${sourceLabel.toUpperCase()}`,
            pad + iw - 24, by + 2,
          )
          ctx.textAlign = 'left'
        }
        ctx.restore()

        ctx.beginPath()
        ctx.roundRect(pad, contentTop, iw, ih, 18)
        ctx.strokeStyle = 'rgba(255,255,255,0.1)'
        ctx.lineWidth = 1
        ctx.stroke()

        /* — insight chips row — */
        const chipY = contentTop + ih + 14
        const chipH = 64
        const gap = 10
        const chipW = (iw - gap * (chips.length - 1)) / chips.length
        chips.forEach((chip, i) => {
          const cx = pad + i * (chipW + gap)
          ctx.beginPath()
          ctx.roundRect(cx, chipY, chipW, chipH, 14)
          ctx.fillStyle = 'rgba(255,255,255,0.03)'
          ctx.fill()
          ctx.strokeStyle = 'rgba(255,255,255,0.07)'
          ctx.lineWidth = 1
          ctx.stroke()
          ctx.textAlign = 'left'
          ctx.font = `700 9.5px ${fonts.body}`
          ctx.fillStyle = 'rgba(245,245,247,0.4)'
          ctx.fillText(chip.label, cx + 16, chipY + 21)
          ctx.font = `700 18px ${fonts.body}`
          ctx.fillStyle = '#f5f5f7'
          ctx.fillText(chip.value, cx + 16, chipY + 44)
          const vw = ctx.measureText(chip.value).width
          ctx.font = `600 13px ${fonts.mono}`
          ctx.fillStyle = chip.tone === 'pos' ? '#34d399'
            : chip.tone === 'neg' ? '#f87171'
              : chip.tone === 'social' ? '#67d9f2'
                : 'rgba(245,245,247,0.55)'
          ctx.fillText(chip.sub, cx + 16 + vw + 10, chipY + 44)
        })

        return ih + 14 + chipH + 4
      }, {
        title: t('bubbles.cosmos.fsTitle', 'Spectre Cosmos'),
        badges: [
          { text: tfLabel, filled: false },
          { text: sourceLabel.toUpperCase(), filled: true },
        ],
        subtitle: t('bubbles.cosmos.shareSubtitle', 'The market as a living universe'),
        logo,
      })
      setShareUrl(dataUrl)
      const sunLine = cosmos.sun && !cosmos.sun.noMarket
        ? `\n☀ $${cosmos.sun.id} ${fmtChange(cosmos.sun.change)}`
        : ''
      const moverLine = !isSocialUniverse && best
        ? `\n🚀 $${best.id} ${fmtChange(best.change)}`
        : isSocialUniverse && loudest
          ? `\n📡 $${loudest.id} · ${fmtCount(loudest.mentions)} mentions`
          : ''
      setShareDesc(`🌌 Spectre Cosmos — ${sourceLabel} · ${tfLabel}${sunLine}${moverLine}\n\n@Spectre__Ai #crypto`)
    } catch (err) {
      console.error('Cosmos share failed:', err)
      setShareOpen(false)
    }
  }, [cosmos, sourceLabel, source, tfLabel, fmtPrice, liveFor, t])

  const dossier = useMemo(() => {
    if (!focused) return null
    const isSun = !!focused.isSun
    const isComet = !!focused.isComet
    const src = isSun ? focused.sun : focused
    if (!src?.token) return null
    const token = src.token
    const change = src.change ?? 0
    return {
      isSun,
      isComet,
      noMarket: !!(focused.noMarket || src.noMarket),
      socialRank: focused.socialRank,
      token,
      change,
      mentions: focused.mentions ?? src.mentions,
      authors: focused.authors ?? src.authors,
      velocity: focused.velocity ?? src.velocity,
      group: isSun || isComet ? null : focused.group,
      spark: sparklineMap?.[token.symbol] || token.sparkline_7d || null,
    }
  }, [focused, sparklineMap])

  const orbitCaption = (change) => {
    if (change >= 8) return t('bubbles.cosmos.orbitHot', 'Inner orbit — strong outperformance')
    if (change >= 0) return t('bubbles.cosmos.orbitWarm', 'Mid orbit — holding ground')
    if (change > -8) return t('bubbles.cosmos.orbitCool', 'Outer orbit — underperforming')
    return t('bubbles.cosmos.orbitCold', 'Deep space — heavy drawdown')
  }
  const socialOrbitCaption = (rank) => {
    if (rank <= 5) return t('bubbles.cosmos.socialHot', 'Inner orbit — commanding the conversation')
    if (rank <= 20) return t('bubbles.cosmos.socialWarm', 'Mid orbit — steady chatter')
    return t('bubbles.cosmos.socialCool', 'Outer rim — the conversation is faint out here')
  }

  const VIEW_TABS = [
    { id: 'solar', label: t('bubbles.cosmos.view3d', 'Orbit 3D'), icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="2.6"/><ellipse cx="12" cy="12" rx="9" ry="4.4" strokeOpacity="0.6"/><circle cx="19.5" cy="9.6" r="1.3"/></svg>
    ) },
    { id: 'map', label: t('bubbles.cosmos.view2d', 'Map 2D'), icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="2.4"/><circle cx="12" cy="12" r="6" strokeOpacity="0.55" strokeDasharray="2.5 3"/><circle cx="12" cy="12" r="9.4" strokeOpacity="0.35"/><circle cx="17" cy="8.5" r="1.2"/></svg>
    ) },
    { id: 'galaxy', label: t('bubbles.cosmos.viewGalaxy', 'Galaxy'), icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="7" cy="8" r="1.4"/><circle cx="16.5" cy="6.5" r="1.1"/><circle cx="18" cy="15" r="1.4"/><circle cx="9" cy="17" r="1.1"/><path d="M7 8l9.5-1.5M16.5 6.5L18 15M18 15l-9 2M9 17l-2-9" strokeOpacity="0.45"/></svg>
    ) },
  ]

  const dossierLive = dossier ? liveFor(dossier.token) : null
  const dossierPositive = dossier ? (dossier.change || 0) >= 0 : true

  return (
    <div className={`cosmos-root${cinematic ? ' cosmos-cinematic' : ''}${dayMode ? ' cosmos-day' : ''}`}>
      <div ref={hostRef} className="cosmos-stage" />

      {/* ── top-left: view switcher · universe source · social panel ── */}
      <div className="cosmos-hud cosmos-hud-tl">
        <div className="cosmos-seg">
          {VIEW_TABS.map(v => (
            <button
              key={v.id}
              className={`cosmos-seg-btn${view === v.id ? ' active' : ''}`}
              onClick={() => setView(v.id)}
            >
              <span className="cosmos-seg-icon">{v.icon}</span>
              {!isMobile && v.label}
            </button>
          ))}
        </div>

        <div className="cosmos-source-row">
          <div className="cosmos-seg">
            <button
              className={`cosmos-seg-btn${source === 'market' ? ' active' : ''}`}
              onClick={() => setSource('market')}
            >
              {t('bubbles.cosmos.srcMarket', 'Market')}
            </button>
            {!isStocks && (
              <button
                className={`cosmos-seg-btn cosmos-seg-xdash${source === 'xdash' ? ' active' : ''}`}
                onClick={() => setSource('xdash')}
              >
                <span className="cosmos-social-dot" />
                {t('bubbles.cosmos.srcXdash', 'X Dash')}
              </button>
            )}
            <button
              className={`cosmos-seg-btn${source === 'sectors' ? ' active' : ''}`}
              onClick={() => setSource('sectors')}
            >
              {t('bubbles.cosmos.srcSectors', 'Sectors')}
            </button>
            <button
              className={`cosmos-seg-btn${source === 'watchlist' ? ' active' : ''}`}
              onClick={() => setSource('watchlist')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 12, height: 12 }}><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>
              {t('bubbles.cosmos.srcWatchlist', 'Watchlist')}
            </button>
          </div>
          {!isStocks && chainOptions.length > 0 && (!isMobile || mobileTools) && (
            <div className="cosmos-chain">
              <button
                className={`cosmos-anchor-btn cosmos-chain-btn${chainFilter !== 'all' ? ' active' : ''}`}
                onClick={() => setChainMenuOpen(o => !o)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 12, height: 12 }}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                {chainFilter === 'all' ? t('bubbles.cosmos.allChains', 'All chains') : chainFilter}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 10, height: 10, opacity: 0.5 }}><path d="m6 9 6 6 6-6"/></svg>
              </button>
              {chainMenuOpen && (
                <div className="cosmos-chain-menu">
                  <button
                    className={`cosmos-chain-row${chainFilter === 'all' ? ' active' : ''}`}
                    onClick={() => { setChainFilter('all'); setChainMenuOpen(false) }}
                  >
                    {t('bubbles.cosmos.allChains', 'All chains')}
                  </button>
                  {chainOptions.map(([chain, n]) => (
                    <button
                      key={chain}
                      className={`cosmos-chain-row${chainFilter === chain ? ' active' : ''}`}
                      onClick={() => { setChainFilter(chain); setChainMenuOpen(false) }}
                    >
                      {chain} <em>{n}</em>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {source === 'xdash' && (!isMobile || mobileTools) && (
            <>
              <div className="cosmos-seg cosmos-seg-mini">
                {[25, 50, 100].map(n => (
                  <button
                    key={n}
                    className={`cosmos-seg-btn${xdCount === n ? ' active' : ''}`}
                    onClick={() => setXdCount(n)}
                  >{n}</button>
                ))}
              </div>
              <button
                className={`cosmos-anchor-btn${withAnchor ? ' active' : ''}`}
                onClick={() => setWithAnchor(!withAnchor)}
                title={t('bubbles.cosmos.anchorTip', 'Keep the market leader as the sun, or let the #1 social token take the throne')}
              >
                ☉ {withAnchor
                  ? (marketCosmos.sun?.id || 'BTC')
                  : t('bubbles.cosmos.pureSocial', 'Social sun')}
              </button>
            </>
          )}
          {source === 'sectors' && sectorFocus && (
            <button
              className="cosmos-breadcrumb"
              onClick={() => { setSectorFocus(null); engineRef.current?.resetCamera() }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>
              {sectorFocus}
              <em>{t('bubbles.cosmos.backToSectors', 'all sectors')}</em>
            </button>
          )}
        </div>

        {/* labels: what every world wears — change / price / mcap / name / off */}
        {(!isMobile || mobileTools) && (
          <div className="cosmos-labels-row">
            <span className="cosmos-labels-eyebrow">{t('bubbles.cosmos.labels', 'Labels')}</span>
            <div className="cosmos-seg cosmos-seg-mini">
              {LABEL_MODES.map(m => (
                <button
                  key={m}
                  className={`cosmos-seg-btn${labelMode === m ? ' active' : ''}`}
                  onClick={() => setLabelMode(m)}
                  title={t(`bubbles.cosmos.label_${m}`, m)}
                >{LABEL_MODE_BADGE[m]}</button>
              ))}
            </div>
          </div>
        )}

        {!isStocks && source !== 'sectors' && source !== 'watchlist' && (
          <SocialPanel rows={panelRows} isMobile={isMobile} onJump={jumpToId} t={t} />
        )}
      </div>

      {/* ── top-right: search + actions ── */}
      <div className="cosmos-hud cosmos-hud-tr">
        {!isMobile && (
          <div className="cosmos-search">
            <svg className="cosmos-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder={t('bubbles.cosmos.searchPlaceholder', 'Jump to token…')}
              onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) jumpTo(results[0]) }}
            />
            {results.length > 0 && (
              <div className="cosmos-search-results">
                {results.map(r => (
                  <button key={r.id} className="cosmos-search-row" onClick={() => jumpTo(r)}>
                    {r.token.logo && <img src={r.token.logo} alt="" />}
                    <span className="cosmos-search-sym">{r.id}</span>
                    <span className="cosmos-search-name">{r.token.name}</span>
                    {r.isSun && <span className="cosmos-search-sun">☀</span>}
                    {!r.inUniverse && r.srcHint && (
                      <span className="cosmos-search-src">
                        {r.srcHint === 'xdash' ? t('bubbles.cosmos.srcXdash', 'X Dash') : t('bubbles.cosmos.srcMarket', 'Market')}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {isMobile && (
          <button
            className={`cosmos-hud-btn${mobileTools ? ' active' : ''}`}
            onClick={() => setMobileTools(v => !v)}
            title={t('bubbles.cosmos.moreControls', 'More controls')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M4 12h16M4 17h16" /><circle cx="9" cy="7" r="2.2" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="2.2" fill="currentColor" stroke="none" /><circle cx="8" cy="17" r="2.2" fill="currentColor" stroke="none" /></svg>
          </button>
        )}
        <button
          className="cosmos-hud-btn"
          onClick={() => setExplainOpen(true)}
          title={t('bubbles.cosmos.howToRead', 'How to read the Cosmos')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/></svg>
        </button>
        <button
          className="cosmos-hud-btn"
          onClick={handleShare}
          title={t('bubbles.cosmos.shareTip', 'Share this view on X')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 12v7a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-7"/><path d="M16 7l-4-4-4 4M12 3v12"/></svg>
        </button>
        <button
          className={`cosmos-hud-btn${cinematic ? ' active' : ''}`}
          onClick={() => setCinematic(v => !v)}
          title={t('bubbles.cosmos.cinematic', 'Cinematic mode (C)')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="m10 9.8 4.5 2.2-4.5 2.2z" fill="currentColor" stroke="none"/></svg>
        </button>
        <button
          className="cosmos-hud-btn cosmos-speed"
          onClick={() => setSpeed(s => (s === 1 ? 2 : s === 2 ? 4 : s === 4 ? 0 : 1))}
          title={t('bubbles.cosmos.orbitSpeed', 'Orbit speed')}
        >
          {speed === 0 ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="7" y="6" width="3.4" height="12" rx="1"/><rect x="13.6" y="6" width="3.4" height="12" rx="1"/></svg>
          ) : `${speed}×`}
        </button>
        <button className="cosmos-hud-btn" onClick={() => { engineRef.current?.resetCamera(); setFocused(null) }} title={t('bubbles.resetView', 'Reset view')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
        </button>
      </div>

      {/* ── bottom-left: legend ── */}
      <div className="cosmos-hud cosmos-hud-bl">
        {cosmos.sun && (
          <button className="cosmos-sun-chip" onClick={() => jumpTo({ isSun: true, id: cosmos.sun.id, token: cosmos.sun.token })}>
            <span className="cosmos-sun-dot" />
            <span className="cosmos-sun-sym">{cosmos.sun.id}</span>
            {cosmos.sun.noMarket ? (
              <span className="cosmos-sun-price">{fmtCount(cosmos.sun.mentions)} {t('bubbles.cosmos.mentions', 'mentions')}</span>
            ) : (
              <>
                <span className="cosmos-sun-price">{fmtPrice(liveFor(cosmos.sun.token).price)}</span>
                <span className={`cosmos-sun-change ${cosmos.sun.change >= 0 ? 'pos' : 'neg'}`}>{fmtChange(cosmos.sun.change)}</span>
              </>
            )}
          </button>
        )}
        <div className="cosmos-legend">
          <span className="cosmos-legend-grad" />
          <span className="cosmos-legend-text">
            {source === 'xdash'
              ? t('bubbles.cosmos.legendXdash', 'inner orbit = most talked about · size = mentions')
              : t('bubbles.cosmos.legend', 'inner orbit = gaining · outer = losing · size = market cap')}
          </span>
          <button className="cosmos-legend-why" onClick={() => setExplainOpen(true)}>
            {t('bubbles.cosmos.why', 'why?')}
          </button>
        </div>
        {view === 'galaxy' && !isMobile && (
          <div className="cosmos-groups">
            {cosmos.groups.slice(0, 8).map(g => (
              <span key={g.key} className="cosmos-group-chip">
                <span className="cosmos-group-dot" style={{ background: `rgb(${g.color[0]},${g.color[1]},${g.color[2]})` }} />
                {g.key} <em>{g.count}</em>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── bottom-right: hints ── */}
      {!isMobile && (
        <div className="cosmos-hud cosmos-hud-br">
          <span className="cosmos-hint">
            {view === 'map'
              ? t('bubbles.cosmos.hintMap', 'drag to pan · scroll to zoom · click a world')
              : t('bubbles.cosmos.hint', 'drag to orbit · scroll to zoom · click a world')}
          </span>
        </div>
      )}


      {/* ── hover card (positioned imperatively) ── */}
      <div
        ref={hoverCardRef}
        className={`cosmos-hover-card${hoverBody ? ' visible' : ''}`}
        aria-hidden={!hoverBody}
      >
        {hoverBody && (() => {
          const src = hoverBody.isSun ? { token: cosmos.sun?.token, change: cosmos.sun?.change } : hoverBody
          if (!src?.token) return null
          const positive = (src.change || 0) >= 0
          if (hoverBody.isSector) {
            return (
              <>
                <div className="cosmos-hover-head">
                  <span className="cosmos-hover-sector-dot" style={{ background: `rgb(${hoverBody.groupColor[0]},${hoverBody.groupColor[1]},${hoverBody.groupColor[2]})` }} />
                  <span className="cosmos-hover-sym">{hoverBody.labelTitle || hoverBody.id}</span>
                </div>
                <div className="cosmos-hover-row">
                  <span>{hoverBody.count} {t('bubbles.cosmos.worlds', 'worlds')}</span>
                  <span>{fmtLarge(hoverBody.token.marketCap)}</span>
                  <span className={positive ? 'pos' : 'neg'}>{fmtChange(src.change)}</span>
                </div>
                <div className="cosmos-hover-dive">{t('bubbles.cosmos.diveHint', 'click to dive in')}</div>
              </>
            )
          }
          return (
            <>
              <div className="cosmos-hover-head">
                {src.token.logo && <img src={src.token.logo} alt="" />}
                <span className="cosmos-hover-sym">{(src.token.symbol || '').toUpperCase()}</span>
                {hoverBody.isSun && <span className="cosmos-hover-suntag">{t('bubbles.cosmos.theSun', 'THE SUN')}</span>}
                {hoverBody.isComet && <span className="cosmos-hover-comettag">☄ {t('bubbles.cosmos.trending', 'TRENDING')}</span>}
              </div>
              {hoverBody.isComet ? (
                <div className="cosmos-hover-row">
                  <span>{fmtCount(hoverBody.mentions)} {t('bubbles.cosmos.mentions', 'mentions')}</span>
                  <span className="pos">{fmtCount(hoverBody.authors)} {t('bubbles.cosmos.voices', 'voices')}</span>
                </div>
              ) : (
                <div className="cosmos-hover-row">
                  <span>{fmtPrice(liveFor(src.token).price)}</span>
                  <span className={positive ? 'pos' : 'neg'}>{fmtChange(src.change)}</span>
                </div>
              )}
            </>
          )
        })()}
      </div>

      {/* ── focus dossier ── */}
      {dossier && (
        <div className="cosmos-dossier">
          <button className="cosmos-dossier-close" onClick={clearFocus} aria-label={t('common.close', 'Close')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
          <div className="cosmos-dossier-head">
            {dossier.token.logo && <img src={dossier.token.logo} alt="" className="cosmos-dossier-logo" />}
            <div>
              <div className="cosmos-dossier-name">{dossier.token.name}</div>
              <div className="cosmos-dossier-sub">
                {dossier.isSun
                  ? t('bubbles.cosmos.sunCaption', 'The Sun — market leader')
                  : dossier.isComet
                    ? <span className="cosmos-dossier-comet-tag">☄ {t('bubbles.cosmos.cometCaption', 'Comet — trending on X, beyond the map')}</span>
                    : <>#{dossier.token.rank} · {(dossier.token.symbol || '').toUpperCase()}{dossier.group ? ` · ${dossier.group}` : ''}</>}
              </div>
            </div>
          </div>
          {(dossier.isComet || dossier.noMarket) ? (
            <div className="cosmos-dossier-price">
              <span className="cosmos-dossier-px">{fmtCount(dossier.mentions)}</span>
              <span className="cosmos-dossier-chg pos">{t('bubbles.cosmos.mentions24h', 'mentions · 24h')}</span>
            </div>
          ) : (
            <div className="cosmos-dossier-price">
              <span className="cosmos-dossier-px">{fmtPrice(dossierLive.price)}</span>
              <span className={`cosmos-dossier-chg ${dossierPositive ? 'pos' : 'neg'}`}>
                {fmtChange(dossier.change)} <em>{tfLabel}</em>
              </span>
            </div>
          )}
          {!dossier.isComet && !dossier.noMarket && dossier.spark && dossier.spark.length > 8 && (
            <SparkCanvas data={dossier.spark} positive={dossierPositive} />
          )}
          <div className="cosmos-dossier-grid">
            <div><label>{t('common.marketCap', 'Market cap')}</label><span>{dossier.token.marketCap ? fmtLarge(dossier.token.marketCap) : '—'}</span></div>
            {(dossier.isComet || dossier.noMarket)
              ? <div><label>{t('bubbles.cosmos.voices', 'voices')}</label><span>{fmtCount(dossier.authors)}</span></div>
              : <div><label>{isStocks ? t('common.volume', 'Volume') : t('common.volume24h', 'Volume 24h')}</label><span>{fmtLarge(dossier.token.volume)}</span></div>}
          </div>
          {!dossier.isSun && !dossier.isComet && focused?._social && (
            <div className="cosmos-dossier-social">
              <span className="cosmos-social-dot" />
              {t('bubbles.cosmos.socialRow', '#{{rank}} on X Dash · {{mentions}} mentions · {{voices}} voices', {
                rank: focused._social.rank,
                mentions: fmtCount(focused._social.mentions),
                voices: fmtCount(focused._social.authors),
              })}
            </div>
          )}
          {!dossier.isSun && !dossier.isComet && (
            <div className="cosmos-dossier-orbit">
              {source === 'xdash' && dossier.socialRank
                ? socialOrbitCaption(dossier.socialRank)
                : orbitCaption(dossier.change)}
            </div>
          )}
          {dossier.isComet && (
            <div className="cosmos-dossier-orbit">
              {dossier.velocity > 1.5
                ? t('bubbles.cosmos.cometHot', 'Accelerating — {{v}}× its usual chatter', { v: dossier.velocity.toFixed(1) })
                : t('bubbles.cosmos.cometSteady', 'Riding social gravity through the outer system')}
            </div>
          )}
          {onTokenClick && (
            <button className="cosmos-dossier-cta" onClick={() => onTokenClick(dossier.token)}>
              {t('bubbles.cosmos.openResearch', 'Open in Research Zone')}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </button>
          )}
        </div>
      )}

      {/* "how to read this" — the logic behind the visuals, per universe */}
      {explainOpen && (
        <div className="cosmos-explain-scrim" onClick={closeExplainer}>
          <div className="cosmos-explain" onClick={(e) => e.stopPropagation()}>
            <button className="cosmos-dossier-close" onClick={closeExplainer} aria-label={t('common.close', 'Close')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
            <div className="cosmos-explain-title">{t('bubbles.cosmos.howToRead', 'How to read the Cosmos')}</div>
            <div className="cosmos-explain-rows">
              <div className="cosmos-explain-row">
                <span className="cosmos-glyph cosmos-glyph-sun" />
                <div>
                  <b>{t('bubbles.cosmos.expSunT', 'The Sun')}</b>
                  <span>{source === 'xdash' && !withAnchor
                    ? t('bubbles.cosmos.expSunSocial', 'The most-mentioned token on X rules the center.')
                    : source === 'watchlist'
                      ? t('bubbles.cosmos.expSunWl', 'Your biggest starred token rules the center.')
                      : t('bubbles.cosmos.expSun', 'The biggest market cap in view rules the center — gravity is size.')}</span>
                </div>
              </div>
              <div className="cosmos-explain-row">
                <span className="cosmos-glyph cosmos-glyph-orbit" />
                <div>
                  <b>{t('bubbles.cosmos.expOrbitT', 'Orbit = distance from the light')}</b>
                  <span>{source === 'xdash'
                    ? t('bubbles.cosmos.expOrbitXd', 'Attention is gravity: the most talked-about tokens orbit closest, the long tail drifts out.')
                    : source === 'sectors'
                      ? t('bubbles.cosmos.expOrbitSec', 'Sectors gaining over the timeframe pull toward the sun; losing sectors drift to the outer dark.')
                      : t('bubbles.cosmos.expOrbit', 'Tokens GAINING over the timeframe get pulled toward the sun. Tokens LOSING drift into the outer dark. The dust belt marks 0%.')}</span>
                </div>
              </div>
              <div className="cosmos-explain-row">
                <span className="cosmos-glyph cosmos-glyph-size" />
                <div>
                  <b>{t('bubbles.cosmos.expSizeT', 'Size')}</b>
                  <span>{source === 'xdash'
                    ? t('bubbles.cosmos.expSizeXd', 'Bigger world = more mentions in the last 24h.')
                    : source === 'sectors'
                      ? t('bubbles.cosmos.expSizeSec', 'Bigger star = larger combined market cap; the number is how many tokens live inside — click to dive in.')
                      : t('bubbles.cosmos.expSize', 'Bigger world = bigger market cap.')}</span>
                </div>
              </div>
              <div className="cosmos-explain-row">
                <span className="cosmos-glyph cosmos-glyph-glow" />
                <div>
                  <b>{t('bubbles.cosmos.expGlowT', 'Glow')}</b>
                  <span>{t('bubbles.cosmos.expGlow', 'Green burns on gainers, red on losers — the harder the move, the brighter the fire. A ±10% mover detonates shockwave rings.')}</span>
                </div>
              </div>
              {!isStocks && (
                <div className="cosmos-explain-row">
                  <span className="cosmos-glyph cosmos-glyph-aura" />
                  <div>
                    <b>{t('bubbles.cosmos.expAuraT', 'Cyan aura & comets')}</b>
                    <span>{t('bubbles.cosmos.expAura', 'A pulsing cyan halo = trending on X right now. Comets ☄ are tokens trending on X from beyond this map, passing through.')}</span>
                  </div>
                </div>
              )}
              <div className="cosmos-explain-row">
                <span className="cosmos-glyph cosmos-glyph-nav" />
                <div>
                  <b>{t('bubbles.cosmos.expNavT', 'Navigate')}</b>
                  <span>{t('bubbles.cosmos.expNav', 'Drag to orbit · scroll to zoom · click any world for its dossier · search jumps anywhere in the catalog.')}</span>
                </div>
              </div>
            </div>
            <button className="cosmos-dossier-cta" onClick={closeExplainer}>
              {t('bubbles.cosmos.explore', 'Explore the cosmos')}
            </button>
          </div>
        </div>
      )}

      {/* watchlist mode with nothing starred: honest empty state over the market map */}
      {watchlistEmpty && (
        <div className="cosmos-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>
          <span>{t('bubbles.cosmos.watchlistEmpty', 'No starred tokens in this map yet')}</span>
          <em>{t('bubbles.cosmos.watchlistEmptyHint', 'Star tokens anywhere in Spectre and they become your personal constellation')}</em>
        </div>
      )}

      {shareOpen && (
        <Suspense fallback={null}>
          <ShareXModal
            open={shareOpen}
            onClose={() => { setShareOpen(false); setShareUrl(null) }}
            imageUrl={shareUrl}
            defaultDescription={shareDesc}
            filename={`spectre_cosmos_${source}.png`}
          />
        </Suspense>
      )}

      {/* cinematic exits — a bottom Back pill AND a top-right X, both always
          clickable (they live outside the fading .cosmos-hud chrome) */}
      {cinematic && (
        <>
          <button className="cosmos-cinema-back" onClick={() => setCinematic(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>
            {t('bubbles.cosmos.backFromCinema', 'Exit cinema')}
            <em>{t('bubbles.cosmos.exitCinemaKey', 'ESC')}</em>
          </button>
          <button className="cosmos-cinema-x" onClick={() => setCinematic(false)} aria-label={t('common.close', 'Close')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </>
      )}
    </div>
  )
}
