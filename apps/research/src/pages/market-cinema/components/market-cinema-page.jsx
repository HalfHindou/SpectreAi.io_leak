import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useChartFullscreen from '@/pages/liquidation-heatmap/components/use-chart-fullscreen'
import useCnmFeed from './use-cnm-feed'
import CnmStage from './cnm-stage'
import CnmStatic from './cnm-static'
import {
  CnmBrand, CnmCtl, CnmSheet, CnmRails, CnmLaneEmpty, CnmNarration,
  CnmLog, CnmMeta, CnmTapeStamp, CnmLaneFaults, EXIT_HINT,
} from './cnm-hud'
import { FLOOR_STEPS, DEFAULT_FLOOR, fmtUsd, fmtCount, fmtClock, spellDuration } from './cnm-map'
import './market-cinema-page.css'
import './market-cinema-page.mobile.css'

const LS_FLOOR = 'cnm.floor'
const LS_PAUSED = 'cnm.paused'
const LS_DUST = 'cnm.dust'

const QUIET_AFTER_MS = 180000
const LANE_EMPTY_AFTER_MS = 360000
const DRAIN_MS = 250

const read = (k, fallback) => { try { const v = localStorage.getItem(k); return v == null ? fallback : v } catch { return fallback } }
const write = (k, v) => { try { localStorage.setItem(k, String(v)) } catch { /* private mode */ } }

function usePrefersReducedMotion() {
  const [v, setV] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setV(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return v
}

/** Degradation ladder step 5 — saveData, or a battery under 15% and unplugged. */
function useThrift() {
  const [v, setV] = useState(() => !!navigator.connection?.saveData)
  useEffect(() => {
    let alive = true
    navigator.getBattery?.()
      .then(b => { if (alive && b && b.level < 0.15 && !b.charging) setV(true) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  return v
}

export default function MarketCinemaPage() {
  const navigate = useNavigate()
  const reduced = usePrefersReducedMotion()
  const thrift = useThrift()
  const { ref: fsRef, isFullscreen, toggle: toggleFullscreen } = useChartFullscreen()

  const [floor, setFloor] = useState(() => {
    const v = Number(read(LS_FLOOR, DEFAULT_FLOOR))
    return FLOOR_STEPS.includes(v) ? v : DEFAULT_FLOOR
  })
  const [paused, setPaused] = useState(() => read(LS_PAUSED, '0') === '1')
  const [asset, setAsset] = useState('ALL')

  const feed = useCnmFeed({ floor, asset, active: true })

  const stageRef = useRef(null)
  const mountedAt = useRef(Date.now())

  const [phase, setPhase] = useState('black')
  const [log, setLog] = useState([])
  const [staticRows, setStaticRows] = useState([])
  const [lastEventAt, setLastEventAt] = useState(0)
  const [lane, setLane] = useState(null)
  const [laneAt, setLaneAt] = useState(0)
  const [cascade, setCascade] = useState(null)
  const [quiet, setQuiet] = useState(false)
  const [degraded, setDegraded] = useState(false)
  const [dim, setDim] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [hint, setHint] = useState(true)
  const [thriftHeld, setThriftHeld] = useState(false)
  const [dust, setDust] = useState(() => read(LS_DUST, null) === null)

  // Thrift starts the stage paused with the static list already populated —
  // the user opts in to the motion rather than paying for it unasked.
  useEffect(() => { if (thrift) { setThriftHeld(true); setPaused(true) } }, [thrift])

  const canvasMode = !reduced && !thriftHeld
  const effectivePaused = paused || thriftHeld

  /* ── entry choreography ────────────────────────────────────────────────── */

  useEffect(() => {
    if (!canvasMode) { setPhase('settled'); return undefined }
    const ids = [
      setTimeout(() => setPhase('tape'), 800),
      setTimeout(() => setPhase('title'), 2000),
      setTimeout(() => setPhase('live'), 2500),
      setTimeout(() => setPhase('settled'), 6200),
    ]
    return () => ids.forEach(clearTimeout)
  }, [canvasMode])

  /* ── the drain: the ONLY thing that puts a particle on the stage ───────── */

  const spawning = (phase === 'live' || phase === 'settled') && !effectivePaused
  const lastEventRef = useRef(0)

  useEffect(() => {
    if (!spawning) return undefined
    const id = setInterval(() => {
      const batch = feed.buffer.drain(Date.now())
      if (!batch.length) return
      stageRef.current?.spawn(batch)

      const loggable = batch.filter(e => e.logged)
      if (loggable.length) {
        setLog(prev => loggable.slice().reverse().concat(prev).slice(0, 4))
      }
      if (!canvasMode) {
        setStaticRows(prev => {
          const seen = new Set(prev.map(r => r.id))
          const add = batch.slice().reverse().filter(r => !seen.has(r.id))
          return add.length ? add.concat(prev).slice(0, 60) : prev
        })
      }
      const newest = batch[batch.length - 1].t
      // Throttled: the age label is accurate to a second and a half, and a
      // cascade must not turn into four React commits a second.
      if (newest - lastEventRef.current > 1500) {
        lastEventRef.current = newest
        setLastEventAt(newest)
      }
    }, DRAIN_MS)
    return () => clearInterval(id)
  }, [spawning, feed.buffer, canvasMode])

  /* ── pause must not eat queued events ─────────────────────────────────── */

  const pauseStartRef = useRef(0)
  useEffect(() => {
    if (effectivePaused) { pauseStartRef.current = Date.now(); return undefined }
    if (pauseStartRef.current) {
      feed.buffer.shift(Date.now() - pauseStartRef.current)
      pauseStartRef.current = 0
    }
    return undefined
  }, [effectivePaused, feed.buffer])

  /* ── narration ladder ─────────────────────────────────────────────────── */

  useEffect(() => {
    setQuiet(false)
    if (!lastEventAt) return undefined
    const due = lastEventAt + QUIET_AFTER_MS - Date.now()
    if (due <= 0) { setQuiet(true); return undefined }
    const id = setTimeout(() => setQuiet(true), due)
    return () => clearTimeout(id)
  }, [lastEventAt])

  const intensity = feed.meta.intensity
  useEffect(() => {
    if (intensity >= 0.75 && !cascade) {
      const rows = feed.buffer.recentLiqs(90000)
      if (rows.length < 3) return
      let longSum = 0, shortSum = 0, biggest = rows[0]
      for (const r of rows) {
        if (r.side === 'long') longSum += r.usd; else shortSum += r.usd
        if (r.usd > biggest.usd) biggest = r
      }
      const longs = longSum >= shortSum
      const span = Math.max(1000, rows[rows.length - 1].t - rows[0].t)
      const exch = biggest.exchange ? biggest.exchange.charAt(0).toUpperCase() + biggest.exchange.slice(1) : 'an exchange'
      setCascade({
        text: `${fmtUsd(longs ? longSum : shortSum)} of ${longs ? 'longs' : 'shorts'} in ${spellDuration(span)}. Largest single close ${fmtUsd(biggest.usd)}, ${biggest.asset} on ${exch}.`,
        n: rows.length,
        at: Date.now(),
      })
    } else if (intensity < 0.5 && cascade) {
      setCascade(null)
    }
  }, [intensity, cascade, feed.buffer, feed.tick])

  const narration = useMemo(() => {
    if (cascade) return { mode: 'cascade', text: cascade.text, source: `Measured on this replay · n=${fmtCount(cascade.n)}`, sourceAt: cascade.at }
    if (feed.liqState === 'down') return { mode: 'down' }
    if (quiet) return { mode: 'quiet' }
    // deskFresh is the gate, not decoration: the generator has wedged for days
    // at a time, and a six-day-old line stamped with a bare clock time reads
    // as today's read. Stale desk → the slot falls through to the replay window.
    if (feed.desk && feed.deskFresh) return { mode: 'desk', text: feed.desk.line, source: 'Spectre desk', sourceAt: feed.desk.at }
    const w = feed.meta.windowStart
      ? `replaying ${fmtClock(feed.meta.windowStart)} → ${fmtClock(feed.meta.windowEnd)} UTC`
      : 'no window replayed yet'
    return { mode: 'window', windowText: w }
  }, [cascade, feed.liqState, quiet, feed.desk, feed.deskFresh, feed.meta.windowStart, feed.meta.windowEnd])

  /* ── the computed facts ───────────────────────────────────────────────── */

  const titleFact = useMemo(() => {
    const h = feed.headline
    if (!h) return null
    if (!h.biggest || h.biggest.usd < 250000) {
      return `Nothing above $250,000 has liquidated in ${spellDuration(h.windowMs)}.`
    }
    return `${fmtUsd(h.total)} liquidated in ${spellDuration(h.windowMs)}. Longs paid for ${h.longPct}% of it.`
  }, [feed.headline])

  const h1 = useMemo(() => {
    const w = feed.windowNow
    if (!w) return 'Market Cinema — a delayed replay of real liquidations and transfers.'
    return `${fmtCount(w.n)} liquidations totalling ${fmtUsd(w.total)} in the last ${Math.round(w.windowMs / 1000)} seconds.`
  }, [feed.windowNow])

  /* ── controls ─────────────────────────────────────────────────────────── */

  const cycleFloor = useCallback(() => {
    setFloor(f => {
      const next = FLOOR_STEPS[(FLOOR_STEPS.indexOf(f) + 1) % FLOOR_STEPS.length]
      write(LS_FLOOR, next)
      return next
    })
  }, [])

  const lowerFloor = useCallback(() => {
    setFloor(f => {
      const i = FLOOR_STEPS.indexOf(f)
      const next = FLOOR_STEPS[Math.max(0, i - 1)]
      write(LS_FLOOR, next)
      return next
    })
  }, [])

  const togglePause = useCallback(() => {
    if (thriftHeld) { setThriftHeld(false); setPaused(false); write(LS_PAUSED, 0); return }
    setPaused(p => { write(LS_PAUSED, p ? 0 : 1); return !p })
  }, [thriftHeld])

  const exit = useCallback(() => {
    setLeaving(true)
    setTimeout(() => {
      if (window.history.length > 1) navigate(-1)
      else navigate('/')
    }, 250)
  }, [navigate])

  /* ── Esc, and the mobile swipe-down ───────────────────────────────────── */

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (sheet) return
      // In fullscreen, Escape belongs to the browser (and to the CSS-fallback
      // handler inside useChartFullscreen) — it closes the blow-up, not the page.
      if (isFullscreen) return
      exit()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [exit, isFullscreen, sheet])

  const touch = useRef({ y: 0, active: false })
  const onTouchStart = useCallback((e) => {
    const t = e.touches[0]
    if (!t) return
    touch.current = { y: t.clientY, active: t.clientY < window.innerHeight / 3 }
  }, [])
  const onTouchEnd = useCallback((e) => {
    if (!touch.current.active) return
    const t = e.changedTouches[0]
    touch.current.active = false
    if (t && t.clientY - touch.current.y > 120) exit()
  }, [exit])

  /* ── HUD idle fade ────────────────────────────────────────────────────── */

  useEffect(() => {
    const isTouch = window.matchMedia?.('(hover: none)').matches
    const delay = isTouch ? 6000 : 4000
    let id = setTimeout(() => setDim(true), delay)
    let lastWake = 0
    const wake = () => {
      const now = Date.now()
      if (now - lastWake < 400) return
      lastWake = now
      setDim(d => (d ? false : d))
      clearTimeout(id)
      id = setTimeout(() => setDim(true), delay)
    }
    const evs = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']
    for (const ev of evs) window.addEventListener(ev, wake, { passive: true })
    return () => {
      clearTimeout(id)
      for (const ev of evs) window.removeEventListener(ev, wake)
    }
  }, [])

  /* ── one-shot chrome ──────────────────────────────────────────────────── */

  useEffect(() => {
    const id = setTimeout(() => setHint(false), 3000)
    return () => clearTimeout(id)
  }, [])

  useEffect(() => {
    if (!dust) return undefined
    write(LS_DUST, 1)
    const id = setTimeout(() => setDust(false), 12000)
    return () => clearTimeout(id)
  }, [dust])

  // Full-viewport takeover: the app's own floating chrome must not sit on top
  // of the stage. Scoped to this page's lifetime, no shared file touched.
  useEffect(() => {
    document.body.classList.add('cnm-open')
    return () => document.body.classList.remove('cnm-open')
  }, [])

  const onLane = useCallback((l) => { setLane(l); setLaneAt(Date.now()) }, [])
  const onStats = useCallback((s) => { setDegraded(d => (d === s.degraded ? d : s.degraded)) }, [])

  // The empty-lane line earns its place at exactly one moment, so it costs
  // exactly one commit — no interval, no re-render to ask "is it time yet".
  const laneQuietSince = laneAt || mountedAt.current
  const [laneEmpty, setLaneEmpty] = useState(false)
  useEffect(() => {
    setLaneEmpty(false)
    const due = laneQuietSince + LANE_EMPTY_AFTER_MS - Date.now()
    if (due <= 0) { setLaneEmpty(true); return undefined }
    const id = setTimeout(() => setLaneEmpty(true), due)
    return () => clearTimeout(id)
  }, [laneQuietSince])

  // The paused / thrift path has no replay running, so the list is seeded from
  // the last real page and the drain then prepends to it.
  useEffect(() => {
    if (canvasMode || !feed.snapshot.length) return
    setStaticRows(prev => (prev.length ? prev : feed.snapshot))
  }, [canvasMode, feed.snapshot])

  const showLaneEmpty = laneEmpty && feed.whaleState !== 'down'
  const lastEventStamp = lastEventAt || feed.meta.lastSeenTs || 0

  return (
    <div
      className={`cnm-root${dim ? ' cnm-root--dim' : ''}${leaving ? ' cnm-root--leaving' : ''}`}
      data-phase={phase}
      ref={fsRef}
      role="main"
      aria-label="Market Cinema"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <h1 className="sr-only">{h1}</h1>

      {canvasMode ? (
        <div className="cnm-stage">
          <CnmStage
            ref={stageRef}
            tape={feed.tape}
            intensity={intensity}
            paused={effectivePaused}
            onLane={onLane}
            onStats={onStats}
          />
        </div>
      ) : (
        <div className="cnm-stage cnm-stage--static">
          <CnmStatic rows={staticRows} pending={!staticRows.length} shimmer={!reduced} />
        </div>
      )}

      {/* Entry beat 3: the computed fact, top-left, then it recedes to the
          brand block at 6.2s. Two elements crossfading — never an animated
          font-size, never an animated height. */}
      {canvasMode && titleFact && (
        <p className={`cnm-title${phase === 'title' || phase === 'live' ? ' cnm-title--in' : ''}`}>{titleFact}</p>
      )}

      <CnmBrand
        liqState={feed.liqState}
        asset={asset}
        assets={feed.assets}
        onAsset={setAsset}
        fact={phase === 'settled' ? titleFact : null}
      />

      <CnmCtl
        floor={floor}
        onFloor={cycleFloor}
        paused={effectivePaused}
        onPause={togglePause}
        onFullscreen={toggleFullscreen}
        isFullscreen={isFullscreen}
        onExit={exit}
        onSheet={() => setSheet(true)}
      />

      <CnmSheet
        open={sheet}
        onClose={() => setSheet(false)}
        floor={floor}
        onFloor={cycleFloor}
        paused={effectivePaused}
        onPause={togglePause}
        onExit={exit}
      />

      {canvasMode && (
        <>
          <CnmRails lane={lane} laneAt={laneAt} whaleState={feed.whaleState} />
          {showLaneEmpty && <CnmLaneEmpty since={laneQuietSince} />}
          <CnmTapeStamp asset={feed.tapeAsset} since={feed.tapeSince} points={feed.tape.length} />
        </>
      )}

      <CnmLaneFaults liqState={feed.liqState} whaleState={feed.whaleState} />

      <CnmLog rows={log} />

      <CnmNarration
        mode={narration.mode}
        text={narration.text}
        source={narration.source}
        sourceAt={narration.sourceAt}
        lastEventAt={lastEventStamp}
        windowText={narration.windowText}
      />

      <CnmMeta
        windowStart={feed.meta.windowStart}
        windowEnd={feed.meta.windowEnd}
        drawn={Math.max(0, feed.meta.scheduled - feed.meta.queued)}
        belowFloor={feed.meta.belowFloor}
        floor={floor}
        autoFloor={feed.meta.autoFloor}
        autoFloorReason={feed.meta.autoFloorReason}
        lastEventAt={lastEventStamp}
        onLowerFloor={lowerFloor}
        canLowerFloor={floor > FLOOR_STEPS[0]}
        resumeNote={feed.resumeNote}
        dust={dust}
        degraded={degraded}
      />

      {thriftHeld && (
        <button type="button" className="cnm-thrift" onClick={togglePause}>
          Data saver is on. The stage is paused — the list below is live.
          <span className="cnm-thrift__go">Play</span>
        </button>
      )}

      <p className={`cnm-hint${hint ? ' cnm-hint--in' : ''}`}>{EXIT_HINT}</p>
    </div>
  )
}
