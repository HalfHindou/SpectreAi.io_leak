/**
 * use-cnm-feed — the three data lanes behind the stage.
 *
 * liquidations 8s · whales 25s · desk 5min. Each lane keeps its last good
 * payload and its own stale stamp: a failed poll NEVER wipes good data, it
 * only changes what the chrome says about it.
 *
 * Returns an OBJECT (never an array). Everything that changes faster than a
 * poll lives in the replay buffer or the canvas, not in React state — this
 * hook commits at most once per lane per poll.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSpectreLiquidationTape, getSpectreWhaleTransactions } from '@/services/spectreMarketApi'
import { brainGet } from '@/pages/brain/components/brain-fetch'
import { createReplayBuffer } from './cnm-buffer'
import { normalizeLiq, normalizeWhale } from './cnm-map'

const LIQ_POLL_MS = 8000
const WHALE_POLL_MS = 25000
const DESK_POLL_MS = 300000
const REPLAY_INTERVAL_MS = 8000

// Session tape retention. Past this we DECIMATE (drop every other real point) —
// never resample, never interpolate. An hour of watching stays an hour of real
// prices, just at half the density.
const TAPE_MAX = 600

const DESK_FRESH_MS = 600000

function statusOf(lastOkAt, now, staleAfter) {
  if (!lastOkAt) return 'down'
  return now - lastOkAt > staleAfter ? 'stale' : 'live'
}

export default function useCnmFeed({ floor, asset, active = true }) {
  const bufferRef = useRef(null)
  if (!bufferRef.current) bufferRef.current = createReplayBuffer({ intervalMs: REPLAY_INTERVAL_MS, cap: 220 })

  const liqRawRef = useRef([])          // last good payload, kept across failures
  const floorRef = useRef(floor)
  const assetRef = useRef(asset)
  floorRef.current = floor

  const [tick, setTick] = useState(0)   // one commit per ingest
  const [liqOkAt, setLiqOkAt] = useState(0)
  const [whaleOkAt, setWhaleOkAt] = useState(0)
  const [desk, setDesk] = useState(null)
  const [deskOkAt, setDeskOkAt] = useState(0)
  const [tape, setTape] = useState([])
  const [tapeSince, setTapeSince] = useState(0)
  const [assets, setAssets] = useState([])
  const [headline, setHeadline] = useState(null)
  const [windowNow, setWindowNow] = useState(null)
  const [snapshot, setSnapshot] = useState([])
  const [resumeNote, setResumeNote] = useState(null)

  const headlineLatched = useRef(false)
  const hiddenAt = useRef(0)

  /* ── liquidations ──────────────────────────────────────────────────────── */

  const ingestLiq = useCallback((rows, { seed = false } = {}) => {
    const all = []
    for (const r of rows) {
      const ev = normalizeLiq(r)
      if (ev) all.push(ev)
    }
    if (!all.length) return

    // Distinct assets in the window, ranked by the notional they carried —
    // the filter is built from what is actually on the tape right now.
    const byAsset = new Map()
    let total = 0
    let longUsd = 0
    let lo = Infinity, hi = -Infinity
    for (const e of all) {
      byAsset.set(e.asset, (byAsset.get(e.asset) || 0) + e.usd)
      total += e.usd
      if (e.side === 'long') longUsd += e.usd
      if (e.t < lo) lo = e.t
      if (e.t > hi) hi = e.t
    }
    setAssets([...byAsset.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]))

    const scope = assetRef.current
    const scoped = scope === 'ALL' ? all : all.filter(e => e.asset === scope)

    const biggest = all.reduce((m, e) => (e.usd > (m?.usd || 0) ? e : m), null)
    const fact = {
      n: all.length,
      total,
      longPct: total > 0 ? Math.round((longUsd / total) * 100) : 0,
      windowMs: Math.max(1000, hi - lo),
      biggest,
    }
    // The <h1> restates the CURRENT window every poll; the title card latches
    // the first one, because a title card that rewrites itself is a ticker.
    setWindowNow(fact)
    if (!headlineLatched.current) { headlineLatched.current = true; setHeadline(fact) }

    // Populated reading for the paused / thrift path, where no replay is
    // running to feed the list: the last page, above the floor, newest first.
    setSnapshot(scoped.filter(e => e.usd >= floorRef.current).sort((a, b) => b.t - a.t).slice(0, 60))

    bufferRef.current.ingest(scoped, {
      now: Date.now(),
      floor: floorRef.current,
      seedMs: seed ? 20000 : Infinity,
    })

    // One tape point per poll, from the newest real liquidation of the tape's
    // asset. DEVIATION: the packet sources the tape from /brain/desk
    // markets.px; that document is regenerated infrequently (measured
    // 2026-08-13: generatedAt six days old while the liquidation tape carried
    // BTC 63,437 against the desk's 65,085). A liquidation print is a real
    // trade at a real timestamp and it moves every poll, so it leads and the
    // desk is only consulted when it is genuinely fresh.
    const tapeAsset = scope === 'ALL' ? 'BTC' : scope
    let point = null
    for (const e of all) {
      if (e.asset !== tapeAsset || !(e.price > 0)) continue
      if (!point || e.t > point.t) point = { t: e.t, px: e.price }
    }
    if (point) {
      setTape(prev => {
        if (prev.length && prev[prev.length - 1].t >= point.t) return prev
        const next = prev.concat(point)
        if (next.length <= TAPE_MAX) return next
        return next.filter((_, i) => i % 2 === 0)
      })
      setTapeSince(s => s || point.t)
    }
    setTick(t => t + 1)
  }, [])

  const pollLiq = useCallback(async ({ seed = false } = {}) => {
    try {
      const rows = await getSpectreLiquidationTape(500)
      if (!Array.isArray(rows) || !rows.length) return
      liqRawRef.current = rows
      setLiqOkAt(Date.now())
      ingestLiq(rows, { seed })
    } catch {
      // Keep the last good payload and let the stale stamp say so.
    }
  }, [ingestLiq])

  const pollWhales = useCallback(async () => {
    try {
      const rows = await getSpectreWhaleTransactions(50)
      if (!Array.isArray(rows)) return
      setWhaleOkAt(Date.now())
      const scope = assetRef.current
      const evs = []
      for (const r of rows) {
        const ev = normalizeWhale(r)
        if (ev && (scope === 'ALL' || ev.asset === scope)) evs.push(ev)
      }
      if (evs.length) {
        bufferRef.current.ingest(evs, { now: Date.now(), floor: 0, seedMs: 120000 })
        setTick(t => t + 1)
      }
    } catch { /* lane collapses, rails hide — handled by whaleState */ }
  }, [])

  const pollDesk = useCallback(async () => {
    const d = await brainGet('/data-api/v1/brain/desk')
    if (d) { setDesk(d); setDeskOkAt(Date.now()) }
  }, [])

  /* ── poll loops (setTimeout chains — never overlapping) ────────────────── */

  useEffect(() => {
    if (!active) return undefined
    let alive = true
    let t1 = 0, t2 = 0, t3 = 0
    // setTimeout chains, not setInterval: a slow response must never stack a
    // second request on top of the first.
    const chain = (fn, ms, first, set) => {
      const step = async () => {
        if (!alive) return
        if (!document.hidden) { try { await fn() } catch { /* lane owns its own catch */ } }
        if (!alive) return
        set(setTimeout(step, ms))
      }
      set(setTimeout(step, first))
    }
    chain(() => pollLiq({ seed: true }), LIQ_POLL_MS, 0, id => { t1 = id })
    chain(pollWhales, WHALE_POLL_MS, 400, id => { t2 = id })
    chain(pollDesk, DESK_POLL_MS, 900, id => { t3 = id })
    return () => { alive = false; clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  /* ── tab return: discard the backlog, refetch, say what was missed ─────── */

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) { hiddenAt.current = Date.now(); return }
      const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0
      hiddenAt.current = 0
      bufferRef.current.discard()
      if (away > 20000) setResumeNote({ at: Date.now(), missedMs: away })
      pollLiq()
      pollWhales()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [pollLiq, pollWhales])

  useEffect(() => {
    if (!resumeNote) return undefined
    const id = setTimeout(() => setResumeNote(null), 9000)
    return () => clearTimeout(id)
  }, [resumeNote])

  /* ── asset filter: a different asset is a different session ───────────── */

  useEffect(() => {
    if (assetRef.current === asset) return
    assetRef.current = asset
    bufferRef.current.reset()
    setTape([])
    setTapeSince(0)
    if (liqRawRef.current.length) ingestLiq(liqRawRef.current, { seed: true })
  }, [asset, ingestLiq])

  /* ── derived chrome state ─────────────────────────────────────────────── */

  // A lane going quiet has to be SAID, and saying it needs a render. Rather
  // than a heartbeat interval (idle commits on a page that may sit open for
  // hours), schedule exactly one commit for the instant the earliest lane
  // would flip live → stale.
  const [beat, setBeat] = useState(0)
  useEffect(() => {
    const due = []
    if (liqOkAt) due.push(liqOkAt + LIQ_POLL_MS * 4)
    if (whaleOkAt) due.push(whaleOkAt + WHALE_POLL_MS * 3)
    if (deskOkAt) due.push(deskOkAt + DESK_POLL_MS * 2)
    const next = due.filter(d => d > Date.now()).sort((a, b) => a - b)[0]
    if (!next) return undefined
    const id = setTimeout(() => setBeat(b => b + 1), next - Date.now() + 400)
    return () => clearTimeout(id)
  }, [liqOkAt, whaleOkAt, deskOkAt, beat])

  const stats = bufferRef.current.stats()
  const now = Date.now()
  const deskAt = desk?.generatedAt || desk?.generated_at || null
  const deskAtMs = deskAt ? Date.parse(deskAt) : 0

  const deskLine = useMemo(() => {
    if (!desk) return null
    const line = desk?.simple?.headline || (Array.isArray(desk?.brief) ? desk.brief[0] : null) || desk?.regime
    if (!line) return null
    return String(line).trim()
  }, [desk])

  return {
    buffer: bufferRef.current,
    tick,
    meta: stats,
    tape,
    tapeSince,
    tapeAsset: asset === 'ALL' ? 'BTC' : asset,
    assets,
    headline,
    windowNow,
    snapshot,
    resumeNote,
    desk: deskLine ? { line: deskLine, at: Number.isFinite(deskAtMs) ? deskAtMs : 0 } : null,
    deskFresh: deskAtMs > 0 && now - deskAtMs < DESK_FRESH_MS,
    liqState: statusOf(liqOkAt, now, LIQ_POLL_MS * 4),
    whaleState: statusOf(whaleOkAt, now, WHALE_POLL_MS * 3),
    deskState: statusOf(deskOkAt, now, DESK_POLL_MS * 2),
    liqOkAt,
    refetch: () => { pollLiq(); pollWhales() },
  }
}
