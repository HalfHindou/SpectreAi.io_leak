/**
 * ArnStage — the arena, as the page's hero.
 *
 * This component owns three things and nothing else: the roster → runner
 * mapping, the tape → event mapping, and the decision of whether the WebGL
 * colosseum runs at all. Every frame belongs to arn-colosseum.js, which never
 * imports React and is reached only through a DYNAMIC import — so a reader on
 * reduced motion, or on a machine with no WebGL, never downloads three.
 *
 * THE FALLBACK IS A FIRST-CLASS READING, NOT A DEGRADATION. It is the
 * waterline strip this stage replaced: one tick per book against the line it
 * started from. It renders when
 *   · prefers-reduced-motion is set, or
 *   · WebGL is unavailable / the context could not be created, or
 *   · the scene has not drawn a frame 1.6s after mount on a visible page
 *     (the IntersectionObserver never fired, or the import failed).
 *
 * The caption under either rendering states the same fact in the same words,
 * so the page's argument survives the swap.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ArnWaterline from './arn-waterline'
import { assetLabel, fmtMoney, fmtPct, reasonLabel } from './arn-format'

const REDUCED = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Memoised, and it RELEASES its probe context. A fresh probe per mount leaks a
// live WebGL context (Chrome force-loses the oldest at ~16), and this component
// remounts every time the takeover opens and closes.
let _webgl = null
function hasWebGL() {
  if (_webgl !== null) return _webgl
  if (typeof document === 'undefined') return false
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') || c.getContext('webgl')
    if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext()
    _webgl = !!gl
  } catch { _webgl = false }
  return _webgl
}

/** Tape close → what the runner does. A stop is a stumble; anything that ended
 *  green, or ended on its own terms, is a flare. */
const kindOf = (t) => (
  (t.reason === 'hard_stop' || t.reason === 'doa_stop') ? 'stumble'
    : (t.pnlPct > 0 || t.reason === 'trailing_stop' || t.reason === 'horizon_end') ? 'flare'
      : 'stumble'
)

export default function ArnStage({ rows, tape, headline, onOpen }) {
  // Node STATE, not a ref (the use-in-view lesson, same trap one layer up):
  // this component early-returns a skeleton until rows land, so at mount time
  // the host div does not exist. An effect keyed on a ref would run once
  // against null and never again — the scene would silently never mount on
  // any cold load. Keying the effect on the node re-runs it when the real
  // stage div appears.
  const [host, setHost] = useState(null)
  const sceneRef = useRef(null)
  const openRef = useRef(onOpen)
  openRef.current = onOpen

  const [fallback, setFallback] = useState(() => REDUCED || !hasWebGL())
  const live = useMemo(() => (rows || []).filter((r) => r.active), [rows])

  // The scene knows a runner by its book name; the takeover wants the ROW (it
  // opens by leaderboard id where one exists). One map keeps the scene free of
  // the page's routing contract.
  const byName = useRef(new Map())
  byName.current = useMemo(() => new Map((rows || []).map((r) => [r.name, r])), [rows])
  const openByName = useCallback((name) => {
    const row = byName.current.get(name)
    if (row) openRef.current?.(row)
  }, [])

  /* ── roster → runners ─────────────────────────────────────────────────── */
  const roster = useMemo(() => (rows || []).map((r) => ({
    key: r.name,
    name: r.name,
    returnPct: r.returnPct,
    weeklyPct: r.weeklyPnlPct,
    building: r.active && !r.floorCleared,
    retired: !r.active,
    delta: r.active
      ? fmtPct(r.returnPct)
      : `${fmtMoney(r.current)} of ${fmtMoney(r.starting)} · deactivated`,
  })), [rows])

  /* ── the jumbotron ────────────────────────────────────────────────────── */
  const board = useMemo(() => {
    const top = [...live]
      .filter((r) => Number.isFinite(r.returnPct))
      .sort((a, b) => b.returnPct - a.returnPct)
      .slice(0, 3)
      .map((r) => ({ name: r.name, delta: fmtPct(r.returnPct), tone: r.returnPct > 0 ? 1 : r.returnPct < 0 ? -1 : 0 }))
    const t = (tape || [])[0]
    return {
      headline: headline || '',
      top,
      latest: t
        ? `LATEST CLOSE · ${t.trader} · ${assetLabel(t.asset)} ${fmtPct(t.pnlPct)} · ${reasonLabel(t.reason)}`
        : null,
    }
  }, [live, tape, headline])

  /* ── mount the scene ──────────────────────────────────────────────────── */
  // The import is async, so the roster/board effects below fire BEFORE the
  // scene exists and would drop the first payload on the floor. These refs
  // hand the scene the current state the moment it is created.
  const rosterRef = useRef(roster)
  rosterRef.current = roster
  const boardRef = useRef(board)
  boardRef.current = board

  useEffect(() => {
    if (fallback || !host) return undefined

    let dead = false
    let scene = null
    let ro = null
    let timer = 0

    import('./arn-colosseum')
      .then(({ createColosseum }) => {
        if (dead) return
        scene = createColosseum(host, {
          isMobile: window.matchMedia('(max-width: 768px)').matches,
          onSelect: openByName,
        })
        if (!scene) { setFallback(true); return }
        sceneRef.current = scene
        scene.setRoster(rosterRef.current)
        scene.setBoard(boardRef.current)
        if (typeof ResizeObserver === 'function') {
          ro = new ResizeObserver(() => scene.resize())
          ro.observe(host)
        }
        // If nothing has painted by now the observer never fired or the
        // context died on first use — show the reading that always works.
        timer = window.setTimeout(() => {
          if (!dead && !document.hidden && !scene.hasDrawn()) setFallback(true)
        }, 1600)
      })
      .catch(() => { if (!dead) setFallback(true) })

    return () => {
      dead = true
      if (timer) clearTimeout(timer)
      if (ro) ro.disconnect()
      if (scene) scene.dispose()
      sceneRef.current = null
    }
  }, [fallback, host, openByName])

  useEffect(() => { sceneRef.current?.setRoster(roster) }, [roster])
  useEffect(() => { sceneRef.current?.setBoard(board) }, [board])

  /* ── tape → events ────────────────────────────────────────────────────── */
  const seenRef = useRef(null)
  useEffect(() => {
    if (!tape?.length) return
    // The first payload lands whole and fires nothing: twenty closes that
    // happened before you arrived are not twenty things happening now.
    if (!seenRef.current) {
      seenRef.current = new Set(tape.map((t) => t.key))
      return
    }
    const scene = sceneRef.current
    for (const t of tape) {
      if (seenRef.current.has(t.key)) continue
      seenRef.current.add(t.key)
      if (scene && t.trader) scene.pulse(t.trader, kindOf(t))
    }
  }, [tape])

  /* ── the caption: the same sentence either way ────────────────────────── */
  // "Behind" is counted on returnPct, which is the SAME quantity the runners'
  // angle uses — so the sentence can never disagree with the picture above it.
  // It also agrees with the h1: mergeArena derives both the return column and
  // its `underwater` count from total_equity against the starting balance
  // (verified against the live payload: 8 of 12 either way, 2026-08-13).
  const cap = useMemo(() => {
    const scored = (rows || []).filter((r) => Number.isFinite(r.returnPct))
    if (!scored.length) return null
    const behind = scored.filter((r) => r.returnPct < 0)
    const onTrack = behind.filter((r) => r.active).length
    const benched = behind.length - onTrack
    const worst = scored.reduce((w, r) => (r.returnPct < (w?.returnPct ?? Infinity) ? r : w), null)
    return { n: scored.length, behind: behind.length, onTrack, benched, worst }
  }, [rows])

  const openWorst = useCallback(() => {
    if (cap?.worst) openByName(cap.worst.name)
  }, [cap, openByName])

  if (!rows?.length) {
    return <div className="arn-stage arn-stage--sk animate-shimmer" aria-hidden="true" />
  }

  return (
    <div className="arn-stage-wrap">
      {fallback ? (
        <div className="arn-stage arn-stage--flat">
          <ArnWaterline rows={rows} />
        </div>
      ) : (
        <div className="arn-stage" ref={setHost} role="img" aria-label={
          `A night arena. ${cap?.n ?? 0} books stand on a circular track, placed by their return since they started; `
          + `${cap?.behind ?? 0} of them stand short of the start gate.`
        } />
      )}

      {cap ? (
        <p className="arn-stage__cap arn-meta">
          Each runner is one book, standing where its return since start puts it — the lit gate is the
          balance it opened with, and half a lap is <span className="arn-num">80</span> points.{' '}
          <span className="arn-strong">
            <span className="arn-num">{cap.behind}</span> of <span className="arn-num">{cap.n}</span> stand short of it
          </span>
          {cap.benched ? (
            <> — <span className="arn-num">{cap.onTrack}</span> on the track,{' '}
              <span className="arn-num">{cap.benched}</span> on the bench</>
          ) : null}.{' '}
          {cap.worst ? (
            <>Deepest <button type="button" className="arn-stage__deep arn-num" onClick={openWorst}>
              {fmtPct(cap.worst.returnPct)}
            </button>, {cap.worst.name}{cap.worst.active ? '' : ', deactivated'}.</>
          ) : null}
        </p>
      ) : null}

      {!fallback ? (
        <p className="arn-stage__cap arn-stage__cap--2 arn-meta">
          Gait and wake flow are this week&apos;s change; the wake&apos;s length is the size of the
          return so far. Ground position never drifts — it is a measured number, and it moves only
          when the number does. Lane is spacing, nothing more.
        </p>
      ) : null}
    </div>
  )
}
