/**
 * use-vitals.js — data hooks for the VITALS surface.
 *
 * Two-tier like the RWA bundle: `core` carries the numbers the page paints
 * with, `full` adds TVL and valuation multiples (an 8.5MB upstream on a cold
 * origin). Both fire on mount in parallel, so the ladders never wait on TVL.
 *
 * A localStorage seed paints the previous visit instantly and then revalidates,
 * because a cold universe build is ~12s upstream and a shimmer that long reads
 * as broken.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const SEED_KEY = 'spectre-vitals-v1'
const SEED_TTL = 30 * 60 * 1000
const SEED_MAX_BYTES = 1_500_000

function readSeed() {
  try {
    const raw = localStorage.getItem(SEED_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.ts || Date.now() - parsed.ts > SEED_TTL) return null
    return parsed.bundle || null
  } catch { return null }
}

function writeSeed(bundle) {
  try {
    const payload = JSON.stringify({ ts: Date.now(), bundle })
    if (payload.length > SEED_MAX_BYTES) return
    localStorage.setItem(SEED_KEY, payload)
  } catch { /* quota — the page works without a seed */ }
}

async function getJson(url, { timeoutMs = 60_000 } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`vitals ${res.status}`)
  return res.json()
}

/**
 * Merge a board from the two tiers ROW BY ROW.
 *
 * The tiers are two different queries, and the heavy one comes back without the
 * 90-day spark: every `spark` on a full-tier row is `[]`. Replacing the board
 * wholesale therefore DELETED a series the page had already painted — the ladder
 * drew its trend column, the full tier landed a second later, and every row
 * silently fell back to the "no daily history" hairline. On a wide board that is
 * ten dashed lines where ten sparklines were, which reads as a data outage.
 *
 * So the full tier wins on every field it actually carries, and loses on the
 * ones it only carries empty.
 */
function mergeBoard(coreBoard, fullBoard) {
  if (!fullBoard?.rows?.length) return coreBoard || fullBoard
  if (!coreBoard?.rows?.length) return fullBoard
  const bySlug = new Map(coreBoard.rows.map((r) => [r.slug, r]))
  return {
    ...coreBoard,
    ...fullBoard,
    rows: fullBoard.rows.map((r) => {
      const prev = bySlug.get(r.slug)
      return prev?.spark?.length && !r.spark?.length ? { ...r, spark: prev.spark } : r
    }),
  }
}

/** Merge the `full` tier over `core` without losing anything core-only. */
function mergeTiers(core, full) {
  if (!full) return core
  if (!core) return full
  const ladders = { ...(core.ladders || {}) }
  for (const [id, board] of Object.entries(full.ladders || {})) {
    ladders[id] = mergeBoard(core.ladders?.[id], board)
  }
  return {
    ...core,
    ...full,
    ladders,
    hero: full.hero?.tide?.length ? full.hero : core.hero,
  }
}

export function useVitals() {
  const seeded = useRef(readSeed())
  const [bundle, setBundle] = useState(seeded.current)
  const [loading, setLoading] = useState(!seeded.current)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const coreRef = useRef(seeded.current)

  const load = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    let hadCore = false

    // Core first: it is what the page paints with.
    try {
      const core = await getJson('/api/vitals?fn=bundle&tier=core')
      coreRef.current = core
      hadCore = true
      setBundle(core)
      setLoading(false)
      writeSeed(core)
    } catch (err) {
      if (!seeded.current) setError(err.message || 'failed to load')
      setLoading(false)
    }

    // Then the heavy tier, folded in when it lands.
    try {
      const full = await getJson('/api/vitals?fn=bundle&tier=full')
      const merged = mergeTiers(coreRef.current || full, full)
      setBundle(merged)
      setLoading(false)
      writeSeed(merged)
      if (!hadCore) setError(null)
    } catch { /* core alone is a complete page */ }

    setRefreshing(false)
  }, [])

  useEffect(() => { load() }, [load])

  return { bundle, loading, error, refreshing, reload: load }
}

/** One platform's detail payload. */
export function useVitalsPlatform(slug) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!slug) return undefined
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)

    getJson(`/api/vitals?fn=platform&slug=${encodeURIComponent(slug)}&history=30`)
      .then((json) => { if (!cancelled) { setData(json); setLoading(false) } })
      .catch((err) => {
        if (cancelled) return
        setError(err.message === 'vitals 404' ? 'not-found' : (err.message || 'failed to load'))
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [slug])

  return { data, loading, error }
}

/** Server-ranked board for a metric the bundle did not pre-compute. */
export function useVitalsBoard({ metric, category, window: win = 'd30', enabled = true, limit = 50 }) {
  const [board, setBoard] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled || !metric) return undefined
    let cancelled = false
    setLoading(true)
    const q = new URLSearchParams({ fn: 'leaderboard', metric, window: win, limit: String(limit) })
    if (category) q.set('category', category)

    getJson(`/api/vitals?${q}`)
      .then((json) => { if (!cancelled) { setBoard(json); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [metric, category, win, enabled, limit])

  return { board, loading }
}
