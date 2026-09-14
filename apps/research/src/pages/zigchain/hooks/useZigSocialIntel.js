/**
 * ZIGChain — Social Intelligence, sourced from Spectre X Dash.
 *
 * ZIG had a real social-attention surge (it opened the X Dash board window at
 * #2 and entered the Momentum Top-25 at #11), so the page should show that
 * story with LIVE data rather than a static claim. This hook pulls two X Dash
 * surfaces for cg_id `zignaly` (how ZIG is keyed upstream — see
 * ZigFounderTweets/useZigComparison) and folds them into one clean shape:
 *
 *   /api/xdash/token/zignaly   → attention metrics + momentum entry + carriers
 *   /api/xdash/bootstrap       → the board row = social rank + rank move +
 *                                best_rank_position_window (the "peaked #N")
 *
 * Both routes are GATED (not demo-safe), so every fetch sends
 * credentials:'include' or it 401s on the iOS PWA (same cookie-drop class as
 * the TVL + tweets bugs). A localStorage tracker remembers the best rank ever
 * observed so "Peaked #N" only ever reflects real data, never a hardcoded claim.
 */
import { useEffect, useRef, useState } from 'react'

const CG_ID = 'zignaly'
const TOKEN_URL = `/api/xdash/token/${CG_ID}?per_page=8`
const BOOTSTRAP_URL = '/api/xdash/bootstrap?per_page=100'
const FETCH_TIMEOUT = 12_000
const PEAK_LS_KEY = 'spectre.zig.social.peak.v1'

let _cache = null // { ts, data }
let _inflight = null
const CACHE_TTL = 3 * 60 * 1000

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Mirrors X Dash's computeSignalScore weighting (clean 0.30 / breadth 0.24 /
// velocity 0.18 / novelty 0.14 / engagement 0.14) → 0-100. Inputs the upstream
// leaves null are dropped from the weighted average so a partial payload still
// yields an honest score rather than zeros.
function signalScore(m, q) {
  const parts = []
  const clean = num(q?.clean_signal_score_24h)
  if (clean != null) parts.push([Math.max(0, Math.min(1, clean)), 0.30])
  const authors = num(m?.unique_external_authors_24h)
  if (authors != null) parts.push([Math.min(1, authors / 40), 0.24])
  const vel = num(m?.velocity_ratio)
  if (vel != null) parts.push([Math.min(1, vel / 2), 0.18])
  const nov = num(m?.novelty_ratio)
  if (nov != null) parts.push([Math.max(0, Math.min(1, nov)), 0.14])
  const eng = num(m?.external_weighted_engagement_24h)
  if (eng != null) parts.push([Math.min(1, eng / 5000), 0.14])
  if (!parts.length) return null
  const wsum = parts.reduce((a, [, w]) => a + w, 0)
  const val = parts.reduce((a, [v, w]) => a + v * w, 0) / wsum
  return Math.round(val * 100)
}

function tierOf(score) {
  if (score == null) return null
  if (score >= 72) return 'elite'
  if (score >= 52) return 'strong'
  if (score >= 30) return 'building'
  return 'quiet'
}

function readPeak() {
  try {
    const raw = JSON.parse(localStorage.getItem(PEAK_LS_KEY) || 'null')
    return num(raw?.rank)
  } catch (_) { return null }
}
function persistPeak(rank) {
  if (rank == null) return
  try {
    const prev = readPeak()
    if (prev == null || rank < prev) {
      localStorage.setItem(PEAK_LS_KEY, JSON.stringify({ rank, ts: Date.now() }))
    }
  } catch (_) { /* private mode / quota — ignore */ }
}

async function fetchJSON(url) {
  const r = await fetch(url, {
    credentials: 'include', // gated X Dash route — attach cookie on the PWA
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })
  if (!r.ok) throw new Error(`xdash ${r.status}`)
  return r.json()
}

function findZigRow(boot) {
  const toks = boot?.tokens || []
  return toks.find((r) => {
    const tk = r.token || r
    const id = String(tk.cg_id || tk.token_id || '').toLowerCase()
    const sym = String(tk.symbol || '').toUpperCase()
    return id === CG_ID || sym === 'ZIG'
  }) || null
}

async function fetchUncached() {
  const [tokenRes, bootRes] = await Promise.allSettled([
    fetchJSON(TOKEN_URL),
    fetchJSON(BOOTSTRAP_URL),
  ])
  const detail = tokenRes.status === 'fulfilled' ? tokenRes.value : null
  const boot = bootRes.status === 'fulfilled' ? bootRes.value : null
  if (!detail && !boot) throw new Error('social intel unavailable')

  const tokObj = detail?.token || {}
  const metrics = detail?.metrics || tokObj.metrics || {}
  const quality = detail?.quality || tokObj.quality || {}
  const momentumEntry = detail?.momentum_entry || null
  const topAuthors = (detail?.top_authors || detail?.authors || []).slice(0, 5)

  const row = boot ? findZigRow(boot) : null
  const rowMetrics = row ? (row.metrics || row) : {}
  const rank = num(row?.rank_position ?? row?.token?.rank_position)
  const rankDir = row?.rank_direction || null
  const rankDelta = num(row?.rank_change_positions)
  const bestWindow = num(row?.best_rank_position_window)

  const M = {
    mentions24h: num(metrics.external_mentions_24h ?? rowMetrics.external_mentions_24h),
    authors24h: num(metrics.unique_external_authors_24h ?? rowMetrics.unique_external_authors_24h),
    velocity: num(metrics.velocity_ratio ?? rowMetrics.velocity_ratio),
    novelty: num(metrics.novelty_ratio ?? rowMetrics.novelty_ratio),
    engagement: num(metrics.external_weighted_engagement_24h ?? rowMetrics.external_weighted_engagement_24h),
  }
  const score = signalScore({ ...metrics, ...rowMetrics }, quality)

  // Peak = best (lowest) of the upstream window-best and our all-time tracker.
  const observed = [bestWindow, rank].filter((n) => n != null)
  if (observed.length) persistPeak(Math.min(...observed))
  const peakCandidates = [readPeak(), bestWindow].filter((n) => n != null)
  const peakRank = peakCandidates.length ? Math.min(...peakCandidates) : null

  const hasData = score != null || rank != null || M.mentions24h != null
  return {
    hasData,
    score,
    tier: tierOf(score),
    rank,
    rankDir,
    rankDelta,
    peakRank,
    boardSize: boot?.tokens?.length || null,
    onBoard: !!row,
    metrics: M,
    momentumEntry,
    topAuthors,
    generatedAt: detail?.generated_at_utc || boot?.generated_at_utc || null,
  }
}

function loadShared({ force = false } = {}) {
  if (!force && _cache && Date.now() - _cache.ts < CACHE_TTL) return Promise.resolve(_cache.data)
  if (_inflight) return _inflight
  _inflight = fetchUncached()
    .then((data) => { _cache = { ts: Date.now(), data }; return data })
    .finally(() => { _inflight = null })
  return _inflight
}

export function useZigSocialIntel({ enabled = true } = {}) {
  const [data, setData] = useState(() => _cache?.data || null)
  const [loading, setLoading] = useState(() => enabled && !_cache)
  const [error, setError] = useState(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!enabled || startedRef.current) return undefined
    startedRef.current = true
    let cancelled = false
    if (!_cache) setLoading(true)
    loadShared()
      .then((d) => { if (!cancelled) { setData(d); setError(null) } })
      .catch((e) => { if (!cancelled) setError(e?.message || 'unavailable') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [enabled])

  return { data, loading, error }
}

export default useZigSocialIntel
