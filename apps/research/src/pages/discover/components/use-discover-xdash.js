/**
 * use-discover-xdash.js
 *
 * Bridges the Discover surface to X-Dash social intelligence.
 *
 * - Pulls the X-Dash trending leaderboard once (useXDashBootstrap, mentions
 *   ranking, 24h) and builds a fast lookup keyed by BOTH CoinGecko id and
 *   uppercased symbol so any Discover token row can find its social entry.
 * - Derives a per-token "momentum" read from the raw leaderboard metrics the
 *   bootstrap response already carries (external_mentions_24h vs
 *   external_mentions_prev_daily_avg → chatter velocity %), plus carrier KOL
 *   count and a clean-signal score. This mirrors the formula xd-hero-strip
 *   uses, so the numbers match the X-Dash page exactly.
 * - Ranks the top accelerating tokens for the SOCIAL PULSE rail and exposes a
 *   shared-KOL adjacency map (tokens that share carrier accounts) for the
 *   connection motif.
 *
 * Returns an object (never an array, per hook conventions). Degrades to an
 * empty-but-valid shape when X-Dash has no signal so callers can render a
 * premium empty state rather than a skeleton wall.
 */
import { useMemo } from 'react'
import { useXDashBootstrap } from '@/hooks/useXDashBootstrap'
import { buildSignalCarriers, getFollowerTier } from '@/pages/x-dash/components/x-dash-utils'

const norm = (s) => String(s || '').trim().toUpperCase()

/**
 * Compute the social-momentum read for one normalized bootstrap item.
 * Same velocity math the X-Dash hero ticker uses: 24h mention rate vs the
 * previous daily average → percentage delta; null when there's no baseline.
 */
function readMomentum(item) {
  const cur = Number(item?.external_mentions_24h ?? item?.mentions ?? 0)
  const prev = Number(item?.external_mentions_prev_daily_avg ?? 0)
  const authors = Number(item?.unique_external_authors_24h ?? item?.author_count ?? 0)
  const rankChg = Number(item?.rank_change_positions ?? 0)
  const velocityRatio = Number(item?.velocity_ratio ?? 0)
  const cleanSignal = Number(item?.quality?.clean_signal_score ?? item?.clean_signal_score ?? 0)

  // delta as a fraction: (now - prev) / prev. Falls back to velocity_ratio - 1
  // when no prior daily average exists but the backend gave us a ratio.
  let delta = null
  if (prev > 0) delta = (cur - prev) / prev
  else if (velocityRatio > 0) delta = velocityRatio - 1

  const deltaPct = delta == null ? null : Math.round(delta * 100)
  const trend = delta == null
    ? 'flat'
    : delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'flat'

  return { cur, prev, authors, rankChg, velocityRatio, cleanSignal, delta, deltaPct, trend }
}

/**
 * A token has a "notable" social signal worth marking on a Discover card when
 * it carries real chatter and is accelerating (or has fresh KOL carriers).
 */
function isNotable(m) {
  if (!m) return false
  if (m.cur < 3) return false
  return (m.deltaPct != null && m.deltaPct >= 25) || m.authors >= 5
}

export function useDiscoverXDash({ enabled = true } = {}) {
  // One leaderboard fetch covers the whole Discover grid. mentions ranking +
  // 24h timeframe = "what's being talked about right now". Background-refresh
  // every 2min, focus refresh on (the hook self-guards on hidden/idle).
  const { data, loading, error } = useXDashBootstrap(
    { page: '1', perPage: '50', timeframe: '24h', ranking: 'mentions', segment: 'all', market: 'all' },
    enabled ? { refreshIntervalMs: 120000, refreshOnFocus: true } : {},
  )

  return useMemo(() => {
    const tokens = Array.isArray(data?.tokens) ? data.tokens : []

    // ── 1. Per-token social entries + cg-id / symbol lookup ──
    const byCgId = new Map()
    const bySymbol = new Map()
    const entries = []

    for (const item of tokens) {
      const cgId = item?.cg_id || item?.token_id || item?.id
      const symbol = norm(item?.symbol)
      const momentum = readMomentum(item)
      const topAuthors = Array.isArray(item?.top_authors) ? item.top_authors : []
      // Carriers ranked by proof + engagement. No raw mentions on the
      // bootstrap row, so this leans on top_authors (per-token KOL set).
      const carriers = buildSignalCarriers(topAuthors, []).slice(0, 8)

      const entry = {
        cgId,
        symbol,
        name: item?.name || '',
        image: item?.image || item?.image_small || item?.image_url || item?.logo_url || null,
        momentum,
        carriers,
        carrierCount: Math.max(carriers.length, momentum.authors),
        notable: isNotable(momentum),
        raw: item,
      }
      entries.push(entry)
      if (cgId) byCgId.set(String(cgId), entry)
      if (symbol) bySymbol.set(symbol, entry)
    }

    // ── 2. SOCIAL PULSE rail: tokens ranked by chatter momentum ──
    // Velocity, not absolute volume — what's accelerating. Require a real
    // chatter floor so a token with 1 mention and no baseline can't top the
    // rail on a fake +∞ delta.
    const pulse = entries
      .filter((e) => e.momentum.cur >= 3 && (e.momentum.deltaPct != null || e.momentum.authors >= 3))
      .sort((a, b) => {
        const da = a.momentum.deltaPct == null ? -999 : a.momentum.deltaPct
        const db = b.momentum.deltaPct == null ? -999 : b.momentum.deltaPct
        if (db !== da) return db - da
        // tie-break on carrier reach, then raw chatter
        if (b.carrierCount !== a.carrierCount) return b.carrierCount - a.carrierCount
        return b.momentum.cur - a.momentum.cur
      })
      .slice(0, 10)

    // ── 3. Shared-KOL adjacency for the connection motif ──
    // Map authorId → which pulse tokens that KOL carries. A KOL carried by 2+
    // pulse tokens forms a "constellation thread". Returned as, per token, the
    // set of sibling token symbols it shares a carrier with.
    const authorToTokens = new Map()
    for (const e of pulse) {
      for (const c of e.carriers) {
        const id = c.author_rest_id || c.rest_id || c.screen_name
        if (!id) continue
        if (!authorToTokens.has(id)) authorToTokens.set(id, [])
        authorToTokens.get(id).push(e.symbol)
      }
    }
    const sharedKol = new Map() // symbol → Set(sibling symbols)
    for (const [, syms] of authorToTokens) {
      if (syms.length < 2) continue
      for (const a of syms) {
        if (!sharedKol.has(a)) sharedKol.set(a, new Set())
        for (const b of syms) if (b !== a) sharedKol.get(a).add(b)
      }
    }

    return {
      loading,
      error,
      // lookups for the per-card overlay
      byCgId,
      bySymbol,
      // SOCIAL PULSE rail
      pulse,
      sharedKol,
      hasSignal: entries.some((e) => e.momentum.cur > 0),
      // helper: resolve a Discover token (crypto) to its social entry
      lookup: (token) => {
        if (!token) return null
        const id = token.id || token.token_id
        if (id && byCgId.has(String(id))) return byCgId.get(String(id))
        const sym = norm(token.symbol)
        return sym ? bySymbol.get(sym) || null : null
      },
    }
  }, [data, loading, error])
}

export { getFollowerTier }
export default useDiscoverXDash
