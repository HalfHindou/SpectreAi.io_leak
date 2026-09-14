/**
 * Module-level "seed" cache for the X Dash token drawer.
 *
 * Problem: clicking a token row navigates to /x-dash/token/:cgId, which
 * opens the drawer empty until the /api/xdash/token/:id fetch lands
 * (300-800ms). The user already sees the row's identity (logo, cashtag,
 * name, mcap, category, etc.) in the leaderboard - it's wasteful to make
 * them stare at a skeleton while waiting for the same data.
 *
 * Pattern: the leaderboard rows call `setTokenSeed(cgId, row)` as they
 * render. The drawer calls `getTokenSeed(cgId)` on mount and uses that
 * as its initial tokenInfo. Once the real fetch resolves, the hook's
 * data takes over - if a field is in the real payload, it wins; if not,
 * the seed value persists.
 *
 * Cache TTL is intentionally permissive (no eviction during the session)
 * since these are tiny identity blobs and a fresh fetch always supersedes
 * the seed when it arrives. The Map is keyed by cg_id and bounded only
 * by the number of unique tokens the user has scrolled past - in practice
 * small enough to ignore.
 */

const seedCache = new Map()

/* Normalize a leaderboard row (either flat - from useXDashBootstrap's
   normalizeItem - or nested - from a raw surface) into the same shape
   normalizeXDashDetail produces for tokenInfo. */
function toTokenInfo(row) {
  if (!row) return null
  const t = (row.token && typeof row.token === 'object') ? row.token : row
  return {
    cg_id: t.cg_id || t.token_id || row.cg_id || row.token_id,
    token_id: t.token_id || t.cg_id,
    symbol: t.symbol || row.symbol,
    name: t.name || row.name,
    cashtag: t.cashtag || row.cashtag,
    handle: t.handle || row.handle,
    segment: t.segment || row.segment,
    chain: t.chain || row.chain,
    image_small: t.image_small || row.image_small || row.image,
    image_url: t.image_url || row.image_url,
    image_large: t.image_large || row.image_large,
    image_thumb: t.image_thumb || row.image_thumb,
    twitter_url: t.twitter_url || row.twitter_url,
    market_cap: t.market_cap != null ? t.market_cap : row.market_cap,
    global_rank: t.global_rank != null ? t.global_rank : row.global_rank,
    primary_category: t.primary_category || row.primary_category,
    category: Array.isArray(t.category) ? t.category : (Array.isArray(row.category) ? row.category : undefined),
    tags: Array.isArray(t.tags) ? t.tags : (Array.isArray(row.tags) ? row.tags : undefined),
    contract_address: t.contract_address || row.contract_address,
    platforms: t.platforms || row.platforms,
  }
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/* Normalize a row's SOCIAL SIGNAL (mentions / authors / velocity / novelty /
   clean signal / engagement) into the { metrics, quality } shape the drawer's
   Signal Score + breakdown read - reading across BOTH source shapes:
   - the leaderboard bootstrap row ({ token, metrics, quality } or flattened)
   - the constellation node (flat: mentions, authors, velocity, clean_signal…)
   This is the fallback the drawer paints when /api/xdash/token/:id comes back
   with an empty metrics envelope (e.g. $ZIG/zignaly), so a token that's clearly
   live on the board never renders a dead "0 / QUIET" score. Only finite values
   are emitted - a missing field stays absent so the real fetch can fill it. */
function toSeedSignal(row) {
  if (!row) return { metrics: null, quality: null }
  const t = (row.token && typeof row.token === 'object') ? row.token : row
  const m = (row.metrics && typeof row.metrics === 'object') ? row.metrics : row
  const q = (row.quality && typeof row.quality === 'object') ? row.quality : row

  const mentions24h = num(m.external_mentions_24h ?? m.mentions_24h ?? row.mentions ?? t.mentions)
  const mentionsTotal = num(m.external_mentions ?? m.mentions_total ?? row.mentions_total)
  const authors24h = num(
    m.unique_external_authors_24h ?? m.unique_authors_24h ?? m.author_count ?? row.authors ?? t.authors,
  )
  const velocity = num(m.velocity_ratio ?? row.velocity ?? t.velocity)
  const novelty = num(m.novelty_ratio ?? row.novelty ?? t.novelty)
  const engagement = num(
    m.external_weighted_engagement_24h ?? m.external_weighted_engagement ?? row.weighted_engagement_24h,
  )
  // clean_signal_score is 0-1 on both shapes (constellation `clean_signal`,
  // bootstrap `quality.clean_signal_score_24h`).
  const cleanSignal = num(
    q.clean_signal_score_24h ?? m.clean_signal_score_24h ?? row.clean_signal ?? t.clean_signal,
  )

  const metrics = {}
  if (mentions24h !== undefined) metrics.external_mentions_24h = mentions24h
  if (mentionsTotal !== undefined) metrics.external_mentions = mentionsTotal
  if (authors24h !== undefined) metrics.unique_external_authors_24h = authors24h
  if (velocity !== undefined) metrics.velocity_ratio = velocity
  if (novelty !== undefined) metrics.novelty_ratio = novelty
  if (engagement !== undefined) metrics.external_weighted_engagement_24h = engagement
  // mirror clean signal onto metrics too - the breakdown tile reads it there.
  if (cleanSignal !== undefined) metrics.clean_signal_score_24h = cleanSignal

  return {
    metrics: Object.keys(metrics).length ? metrics : null,
    quality: cleanSignal !== undefined ? { clean_signal_score_24h: cleanSignal } : null,
  }
}

export function setTokenSeed(cgId, row) {
  if (!cgId || !row) return
  const info = toTokenInfo(row)
  if (!info || !info.cg_id) return
  const sig = toSeedSignal(row)
  if (sig.metrics) info._metrics = sig.metrics
  if (sig.quality) info._quality = sig.quality
  seedCache.set(cgId, info)
}

export function getTokenSeed(cgId) {
  return cgId ? seedCache.get(cgId) || null : null
}

/* Reverse lookup: bare SYMBOL -> seeded identity (cg_id). The thesis strip's
   LLM payload often names assets by $SYMBOL only; every board surface
   registers its rows here, so a scan resolves most of them to an openable
   drawer id. Linear over a session-bounded Map — fine at click frequency. */
export function findTokenSeedBySymbol(symbol) {
  const want = String(symbol || '').replace(/^\$/, '').toLowerCase()
  if (!want) return null
  for (const info of seedCache.values()) {
    if (String(info?.symbol || '').toLowerCase() === want) return info
  }
  return null
}

/* Bulk-seed every row of a board as it loads, so the drawer has an identity +
   signal fallback no matter which surface the user clicks (treemap tile,
   cockpit chip, table row, narrative…) - not just the ones that remembered to
   call setTokenSeed at their click site. Idempotent; a later board refresh just
   overwrites with fresher numbers. */
export function registerTokenSeeds(rows) {
  if (!Array.isArray(rows)) return
  for (const row of rows) {
    if (!row) continue
    const t = (row.token && typeof row.token === 'object') ? row.token : row
    const cgId = t.cg_id || t.token_id || row.cg_id || row.token_id
    if (cgId) setTokenSeed(cgId, row)
  }
}
