/**
 * useResearchDesk - Dynamic Research Desk feed
 *
 * Fetches the self-updating "emerging EVM DeFi-alpha" bundle from the backend
 * and feeds it to every Research Desk surface. Mirrors the RWA bundle pattern
 * (`apps/research/.../useRwaData.js`):
 *   - localStorage instant-paint seed (paint last-good projects immediately,
 *     then revalidate in the background — no cold-load shimmer for returners)
 *   - ~5-min adaptive poll (matches the server's CDN s-maxage / warmer cadence)
 *   - AbortSignal.timeout so a hung upstream fails fast instead of hanging
 *   - partial-failure guard (a malformed/empty payload never wipes good data)
 *
 * The bundle is self-sufficient — DexScreener metrics (price/volume/liquidity/
 * txns/changes) are already baked in server-side, so there is NO CoinGecko
 * merge for these dynamic projects (unlike useResearchDeskPrices, which only
 * covers the 9 static blue chips).
 *
 * Four tiers are fetched in parallel (all independent, all guarded the same
 * way; the slow/empty one never blocks or wipes the others):
 *   - `core`     -> { projects }      Deal Flow + Scorecard + Alpha Thesis + Pitch Deck
 *   - `sectors`  -> { sectors }       Sector Rotation map
 *   - `memes`    -> { memes:{ dealFlow, scorecards, trends, theses } }  Memes mode
 *   - `content`  -> { content:{ theses, pitches } }  AI prose (empty until prod)
 *
 * Every consumer falls back to its own static array when its slice is empty, so
 * a tier that 404s / returns empty (e.g. `content` in this dev worktree, which
 * has no AI key) simply leaves that surface on its static demo data.
 *
 * Returns { projects, sectors, memes, content, loading, error, meta }.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import useAdaptivePolling from './useAdaptivePolling'

const POLL_INTERVAL = 5 * 60 * 1000 // 5 min — matches the server warmer / CDN window
const FETCH_TIMEOUT = 15_000

/* ── localStorage instant-paint seed ───────────────────────────────────────
   One key holds the last good bundle. 10-min TTL — emerging-DeFi metrics move
   slowly enough that a few-minutes-stale snapshot painted while the fresh
   bundle loads is invisible, and it removes the cold-load shimmer entirely.
   Size-guarded + fully try/catch'd so a quota error, disabled storage, or SSR
   never breaks the hook. */
const SEED_KEY = 'spectre-research-desk-v1'
const SEED_TTL = 10 * 60 * 1000

function readSeed() {
  try {
    const raw = localStorage.getItem(SEED_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.ts !== 'number' || Date.now() - parsed.ts > SEED_TTL) return null
    if (!Array.isArray(parsed.projects)) return null
    return parsed
  } catch {
    return null
  }
}

function writeSeed(projects, meta) {
  try {
    if (!Array.isArray(projects) || projects.length === 0) return
    const json = JSON.stringify({ ts: Date.now(), projects, meta: meta || null })
    if (json.length > 2_000_000) return // ~2MB guard, well under the ~5MB quota
    localStorage.setItem(SEED_KEY, json)
  } catch {
    /* quota exceeded / storage disabled / SSR — non-fatal */
  }
}

/* Empty meme slice so consumers can destructure `memes.dealFlow` etc. without
   guarding `memes` itself. Each sub-array empty -> the component falls back to
   its own static demo set. */
const EMPTY_MEMES = { dealFlow: [], scorecards: [], trends: [], theses: [] }
/* Empty AI-content slice (theses/pitches keyed by symbol). Empty until prod. */
const EMPTY_CONTENT = { theses: {}, pitches: {} }

/* Fetch one tier; return parsed JSON or null on any failure (never throws).
   A per-tier failure must not abort the others, so each is independently
   caught. */
async function fetchTier(tier) {
  try {
    const res = await fetch(`/api/research-desk/bundle?tier=${tier}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
    if (!res.ok) throw new Error(`research-desk ${tier} HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    console.error(`[useResearchDesk] ${tier} tier fetch failed:`, err)
    return null
  }
}

/**
 * @param {object}  [opts]
 * @param {boolean} [opts.memesEnabled=true] - fetch the `memes` tier. Memes
 *   mode is not the default surface, and that tier is the slowest of the four
 *   (measured 9.1s / 24KB on prod, 2026-08-04) - so the Discover page only
 *   turns it on once the user actually switches into Memes. Flipping it true
 *   fetches that ONE tier immediately rather than waiting for the 5-min poll.
 */
export default function useResearchDesk({ memesEnabled = true } = {}) {
  // doFetch is a stable useCallback; read the live flag through a ref.
  const memesEnabledRef = useRef(memesEnabled)
  memesEnabledRef.current = memesEnabled
  // Read the seed once per mount via a ref so re-renders don't re-parse.
  const seedRef = useRef(undefined)
  if (seedRef.current === undefined) seedRef.current = readSeed()
  const seed = seedRef.current

  const [projects, setProjects] = useState(() => (Array.isArray(seed?.projects) ? seed.projects : []))
  const [sectors, setSectors] = useState([])
  const [memes, setMemes] = useState(EMPTY_MEMES)
  const [content, setContent] = useState(EMPTY_CONTENT)
  const [meta, setMeta] = useState(() => seed?.meta || null)
  // Seed present → skip the shimmer; revalidate quietly behind it.
  const [loading, setLoading] = useState(!seed)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)
  const hasFetchedOnce = useRef(Boolean(seed))
  // Cold-start self-heal: count quick retries when a tier returns empty on load.
  const coldRetries = useRef(0)
  const doFetchRef = useRef(null)

  /* Merge a memes payload. Per-sub-array, only adopt non-empty arrays so a
     partial payload never blanks a sub-tab a previous fetch filled. Shared by
     the main fetch and the enable-on-demand path below. */
  const memesFetchedAtRef = useRef(0)
  const applyMemes = useCallback((memesData) => {
    const m = memesData?.memes
    if (!m || typeof m !== 'object') return
    memesFetchedAtRef.current = Date.now()
    setMemes(prev => ({
      dealFlow: Array.isArray(m.dealFlow) && m.dealFlow.length ? m.dealFlow : prev.dealFlow,
      scorecards: Array.isArray(m.scorecards) && m.scorecards.length ? m.scorecards : prev.scorecards,
      trends: Array.isArray(m.trends) && m.trends.length ? m.trends : prev.trends,
      theses: Array.isArray(m.theses) && m.theses.length ? m.theses : prev.theses,
    }))
  }, [])

  const doFetch = useCallback(async () => {
    // Tiers in parallel; none blocks the others. `memes` is skipped entirely
    // until the user opens Memes mode - it is the slowest tier and its data
    // renders nowhere else.
    const [core, sectorsData, memesData, contentData] = await Promise.all([
      fetchTier('core'),
      fetchTier('sectors'),
      memesEnabledRef.current ? fetchTier('memes') : Promise.resolve(null),
      fetchTier('content'),
    ])
    if (!mountedRef.current) return

    /* ── core / projects (drives loading + error + the LS seed) ── */
    const nextProjects = Array.isArray(core?.projects) ? core.projects : null
    // Partial-failure guard: only adopt a non-empty array. A malformed/empty
    // payload leaves the last good projects on screen.
    if (nextProjects && nextProjects.length > 0) {
      setProjects(nextProjects)
      setMeta(core.meta || null)
      writeSeed(nextProjects, core.meta)
      hasFetchedOnce.current = true
      setError(null)
    } else if (!hasFetchedOnce.current && core == null) {
      // First-load failure with nothing to show -> surface the error. A
      // background-poll failure keeps the existing projects on screen.
      setError('research-desk core fetch failed')
    }

    /* ── sectors (independent; empty -> SectorRotationMap stays on static) ── */
    if (Array.isArray(sectorsData?.sectors) && sectorsData.sectors.length > 0) {
      setSectors(sectorsData.sectors)
    }

    /* ── memes (independent; skipped while Memes mode is closed) ── */
    applyMemes(memesData)

    /* ── content (AI prose, keyed by symbol; empty in dev) ── */
    const c = contentData?.content
    if (c && typeof c === 'object') {
      setContent({
        theses: (c.theses && typeof c.theses === 'object') ? c.theses : {},
        pitches: (c.pitches && typeof c.pitches === 'object') ? c.pitches : {},
      })
    }

    setLoading(false)

    // Cold-start self-heal: if sectors or memes came back empty (server cache
    // cold at first load), retry a couple times quickly instead of waiting for
    // the 5-min poll — the warmer fills these within ~1 min of boot.
    const sectorsCold = !(Array.isArray(sectorsData?.sectors) && sectorsData.sectors.length)
    // A tier we deliberately did not request is not "cold" - counting it would
    // put every projects-mode visitor into the 8s retry loop forever.
    const memesCold = memesEnabledRef.current && !(memesData?.memes?.dealFlow?.length)
    // Content (AI intel crawl) builds slower than the other tiers, so also retry
    // when it comes back empty — the warmer pre-warms it, but a user landing right
    // at boot may still race the cold crawl.
    const contentCold = !(contentData?.content && Object.keys(contentData.content.theses || {}).length)
    if ((sectorsCold || memesCold || contentCold) && coldRetries.current < 3) {
      coldRetries.current += 1
      setTimeout(() => { if (mountedRef.current && doFetchRef.current) doFetchRef.current() }, 8000)
    } else if (!sectorsCold && !memesCold && !contentCold) {
      coldRetries.current = 0
    }
  }, [applyMemes])

  // Keep a stable ref to doFetch for the cold-start retry timer.
  useEffect(() => { doFetchRef.current = doFetch }, [doFetch])

  useEffect(() => {
    mountedRef.current = true
    doFetch()
    return () => {
      mountedRef.current = false
    }
  }, [doFetch])

  /* Memes mode just opened: pull that ONE tier now instead of waiting for the
     next 5-min poll (and without re-pulling core/sectors/content, which are
     already on screen). Fires only on a false -> true transition, so a consumer
     that mounts with memes already enabled still fetches exactly once. */
  const prevMemesEnabled = useRef(memesEnabled)
  useEffect(() => {
    const justEnabled = memesEnabled && !prevMemesEnabled.current
    prevMemesEnabled.current = memesEnabled
    if (!justEnabled) return
    // Toggling Projects <-> Memes must not re-pull a 9s tier every time. The
    // poll keeps it fresh while the mode stays open, so anything newer than one
    // poll interval is still good.
    if (Date.now() - memesFetchedAtRef.current < POLL_INTERVAL) return
    let alive = true
    fetchTier('memes').then((md) => {
      if (alive && mountedRef.current) applyMemes(md)
    })
    return () => { alive = false }
  }, [memesEnabled, applyMemes])

  useAdaptivePolling(doFetch, { interval: POLL_INTERVAL })

  return { projects, sectors, memes, content, loading, error, meta }
}
