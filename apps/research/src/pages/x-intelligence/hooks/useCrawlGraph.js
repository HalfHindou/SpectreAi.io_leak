/**
 * useCrawlGraph — Multi-project social galaxy.
 *
 * Pulls a slate of projects from X Dash and stitches their top authors into
 * one combined graph. Projects are the heavy hub nodes; KOLs orbit the
 * projects they mention. KOLs that mention multiple projects (BRIDGE KOLs)
 * are the killer signal — they're the entities wiring the ecosystem
 * together. They get visual emphasis in the canvas and surface at the top
 * of the right-rail "Top Carriers" list.
 *
 * Data sources (all proxied via /api/xdash/* which caches 60s):
 *   - /api/xdash/bootstrap   — top trending projects with inline top_authors
 *   - /api/xdash/new-tokens  — recently discovered projects
 *
 * Bootstrap already inlines `top_authors[]` per project, so we get the entire
 * galaxy in a single round trip (no per-project /token/{id} fanout needed).
 * That makes Crawl mode genuinely cheap: one 60s-cached request paints up to
 * 20 projects + ~60 KOLs + every bridge between them.
 */
import { useState, useEffect, useMemo } from 'react'
import { fetchXdashTokenPage, fetchXdashBootstrap } from './xdash-cache'

const FETCH_TIMEOUT = 18000

// Seed mode → human label kept inline so the FilterPanel pill doesn't need a
// parallel dictionary.
export const SEED_MODES = {
  trending24h: { label: 'Trending · 24h', endpoint: 'bootstrap', timeframe: '24h' },
  trending7d:  { label: 'Trending · 7d',  endpoint: 'bootstrap', timeframe: '7d' },
  mixed:       { label: 'Trending + Fresh', endpoint: 'mixed',   timeframe: '24h' },
  fresh:       { label: 'New tokens',     endpoint: 'new-tokens', timeframe: '24h' },
}
export const DEFAULT_SEED = 'trending24h'

// Depth controls how aggressively we fan out from bootstrap. Bootstrap only
// ships 3 top_authors per project; deeper modes fetch /api/xdash/token/{id}
// for the hottest N projects to get ~15 authors each. That's the multiplier
// that takes the galaxy from "few key KOLs" to "hundreds of bubbles."
// expandTop = how many hot projects to enrich; expandPages = how many 50-mention
// pages to pull per project. Page 1 already returns ~20 top_authors, so the
// default Standard mode fetches ONE page/project — enough for a rich galaxy at a
// fraction of the cost (each /token page is ~270KB / ~2s and is NOT server-
// cached, so the old 8-page cap meant dozens of slow heavy calls before the
// galaxy filled). Deep mode still paginates for the full 50-70 author tail.
export const DEPTH_MODES = {
  light:    { label: 'Light',    expandTop: 0,  expandPages: 0 },
  standard: { label: 'Standard', expandTop: 6,  expandPages: 1 },
  deep:     { label: 'Deep',     expandTop: 12, expandPages: 3 },
}
export const DEFAULT_DEPTH = 'standard'

const KNOWN_EXCHANGES = new Set([
  'binance', 'kucoincom', 'bybit_official', 'okx', 'coinbase',
  'krakenfx', 'bitmartexchange', 'mexc_global', 'gateio_', 'htx_global',
  'phemex_official', 'blofin_official', 'kucoinfutures',
])

function computeTier(followers) {
  if (followers >= 500_000) return 'S'
  if (followers >= 100_000) return 'A'
  if (followers >= 30_000) return 'B'
  return 'C'
}

function detectType(author) {
  const handle = (author.screen_name || '').toLowerCase()
  if (KNOWN_EXCHANGES.has(handle)) return 'exchange'
  return 'kol'
}

function projectNodeId(cgId) {
  return `proj:${(cgId || '').toLowerCase()}`
}

function kolNodeId(author) {
  // Stable key — prefer rest_id (immutable) then screen_name.
  const restId = author.author_rest_id || author.rest_id
  if (restId) return `kol:${restId}`
  const sn = (author.screen_name || '').toLowerCase()
  return sn ? `kol:${sn}` : null
}

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}

async function fetchTokenExpansion(cgId, maxPages = 1) {
  try {
    // First page tells us how many more pages exist. Each page returns up
    // to 50 mentions; we paginate and aggregate per-author stats so hot
    // projects unlock their full 50-70+ author set instead of the 11 the
    // base /token/{id} response caps at. maxPages caps the fan-out — page 1
    // alone yields ~20 authors (plenty for the galaxy); deeper modes pull more.
    const PER_PAGE = 50
    const MAX_PAGES = Math.max(1, maxPages)
    const first = await fetchXdashTokenPage(cgId, { scope: 'all', page: 1, perPage: PER_PAGE })
    const pageCount = Math.min(first?.pagination?.page_count || 1, MAX_PAGES)

    const allMentions = [...(first.mentions || [])]
    if (pageCount > 1) {
      const rest = await Promise.allSettled(
        Array.from({ length: pageCount - 1 }, (_, i) =>
          fetchXdashTokenPage(cgId, { scope: 'all', page: i + 2, perPage: PER_PAGE })
        )
      )
      for (const r of rest) {
        if (r.status === 'fulfilled' && r.value?.mentions) allMentions.push(...r.value.mentions)
      }
    }

    // The mention stream's author objects carry no `author_class`; only the
    // token endpoint's classified `authors[]`/`top_authors[]` rollups do.
    // Build a class lookup (by rest_id + screen_name) to stamp onto the
    // mention-aggregated authors so crawl-mode authenticity coloring works.
    const classByKey = new Map()
    for (const a of (first.authors || first.top_authors || [])) {
      const cls = (a?.author_class || '').toLowerCase()
      if (!cls) continue
      const restKey = a.rest_id || a.author_rest_id
      if (restKey) classByKey.set(String(restKey), cls)
      const sn = (a.screen_name || '').toLowerCase()
      if (sn) classByKey.set(sn, cls)
    }

    // De-dupe authors from the mention stream and accumulate counts.
    const byAuthor = new Map()
    for (const m of allMentions) {
      const a = m?.author
      if (!a) continue
      const key = a.rest_id || a.author_rest_id || a.screen_name
      if (!key) continue
      const eng = (m?.tweet?.favorite_count || 0)
        + (m?.tweet?.retweet_count || 0)
        + (m?.tweet?.reply_count || 0)
        + (m?.tweet?.quote_count || 0)
      const existing = byAuthor.get(key)
      if (existing) {
        existing.mention_count += 1
        existing.total_weighted_engagement += eng
      } else {
        byAuthor.set(key, {
          screen_name: a.screen_name,
          author_rest_id: key,
          rest_id: key,
          name: a.name,
          followers_count: a.followers_count || 0,
          avatar_image_url: a.avatar_image_url,
          author_class: classByKey.get(String(key))
            || classByKey.get((a.screen_name || '').toLowerCase())
            || null,
          mention_count: 1,
          total_weighted_engagement: eng,
        })
      }
    }
    const authors = Array.from(byAuthor.values()).sort((a, b) => b.mention_count - a.mention_count)

    return {
      ...first,
      authors,
      top_authors: authors,
      top_mentions: first.top_mentions || allMentions.slice(0, 20),
    }
  } catch (e) {
    return null
  }
}

/**
 * Replace the bootstrap stub-author list for the top N projects with the
 * full top-author response from /api/xdash/token/{cgId}. Bootstrap caps
 * top_authors at 3; the per-token endpoint returns ~15. Running this in
 * parallel across the top N hottest projects multiplies bubble + bridge
 * counts dramatically while staying inside the 60s upstream cache.
 */
async function expandHotProjects(entries, depth) {
  const cfg = DEPTH_MODES[depth] || DEPTH_MODES[DEFAULT_DEPTH]
  if (!cfg.expandTop || cfg.expandTop <= 0) return entries
  const top = entries.slice(0, cfg.expandTop)
  const expansions = await Promise.allSettled(
    top.map((e) => fetchTokenExpansion(e?.token?.cg_id, cfg.expandPages ?? 1))
  )
  const byId = new Map()
  for (let i = 0; i < expansions.length; i++) {
    const res = expansions[i]
    if (res.status !== 'fulfilled' || !res.value) continue
    const cgId = top[i]?.token?.cg_id
    if (!cgId) continue
    // The /token/{id} response gives us a richer authors[] array. Merge it
    // onto the bootstrap entry so all downstream code (buildCrawlGraph)
    // sees more top_authors.
    byId.set(cgId, res.value)
  }
  return entries.map((entry) => {
    const cgId = entry?.token?.cg_id
    if (!cgId || !byId.has(cgId)) return entry
    const expansion = byId.get(cgId)
    const authors = expansion.authors || expansion.top_authors || entry.top_authors
    return {
      ...entry,
      top_authors: authors,
      top_mentions: expansion.top_mentions || entry.top_mentions,
      intelligence: expansion.intelligence || entry.intelligence,
    }
  })
}

async function fetchSeedTokens(seedMode, perPage) {
  const cfg = SEED_MODES[seedMode] || SEED_MODES[DEFAULT_SEED]
  if (cfg.endpoint === 'bootstrap') {
    const data = await fetchXdashBootstrap({ perPage, timeframe: cfg.timeframe, ranking: 'mentions', segment: 'all' })
    return data?.tokens || []
  }
  if (cfg.endpoint === 'new-tokens') {
    const data = await fetchJSON(`/api/xdash/new-tokens?per_page=${perPage}`)
    return data?.tokens || []
  }
  if (cfg.endpoint === 'mixed') {
    const [bootstrap, fresh] = await Promise.all([
      fetchXdashBootstrap({ perPage: Math.max(10, perPage - 10), timeframe: '24h', ranking: 'mentions', segment: 'all' }).catch(() => null),
      fetchJSON(`/api/xdash/new-tokens?per_page=10`).catch(() => null),
    ])
    const bs = bootstrap?.tokens || []
    const fr = fresh?.tokens || []
    // De-dupe by cg_id, bootstrap wins on conflict (richer metrics).
    const seen = new Set()
    const merged = []
    for (const entry of [...bs, ...fr]) {
      const cgId = entry?.token?.cg_id
      if (!cgId || seen.has(cgId)) continue
      seen.add(cgId)
      merged.push(entry)
    }
    return merged
  }
  return []
}

/**
 * Build the galaxy graph from a list of token entries returned by X Dash.
 *
 * Each entry has the shape `{ token, metrics, top_authors, quality }` — same
 * shape as `/api/token/{cgId}`. We treat every project as a hub node and
 * every distinct author as a KOL node; a KOL gets ONE node in the graph no
 * matter how many projects they touch, with a separate edge per project.
 *
 * Bridge KOLs (touching ≥2 projects) carry `bridgeCount` so the canvas can
 * give them an accent ring and the right rail can surface them in
 * "Top Carriers".
 */
function buildCrawlGraph(tokenEntries) {
  // Names of the project hubs — used to disambiguate KOLs that share a project's
  // display name (e.g. @InjectiveLounge is named "Injective"), which otherwise
  // render as a confusing duplicate of the project hub.
  // Strip emoji / symbols before comparing so "Injective 🥷" collides with the
  // project "Injective" but "Injective Việt Nam 🥷" (a distinct entity) does not.
  const normName = (s) => String(s || '').replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase()
  const projectNamesNorm = new Set(
    tokenEntries.map((e) => normName(e?.token?.name)).filter(Boolean),
  )
  const projectNodes = []
  const kolNodesMap = new Map() // kolId -> node
  const links = []
  const projectAdjacency = new Map() // (projA, projB) sorted pair -> overlap sum

  for (const entry of tokenEntries) {
    const t = entry?.token || {}
    const m = entry?.metrics || {}
    const q = entry?.quality || {}
    const authors = entry?.top_authors || []
    if (!t.cg_id) continue

    const projId = projectNodeId(t.cg_id)
    const cleanSignal = q.clean_signal_score_24h ?? m.clean_signal_score ?? null
    // Prefer the external 24h mention figure (excludes self-mentions) to match
    // project mode. Bootstrap exposes external_mentions_24h (~93 for Injective)
    // alongside mentions_24h (~94, includes self-mentions).
    const mentions24h = m.external_mentions_24h ?? m.mentions_24h ?? null
    // Bootstrap metrics have NO 7d mention field (mentions_7d is undefined);
    // 7d figures only live on intelligence.latest, which bootstrap omits.
    const mentions7d = null
    // unique_external_authors_24h is the 24h author count (~77 for Injective);
    // unique_authors is cumulative/all-time (~273) and was the wrong figure here.
    const authors24h = m.unique_external_authors_24h ?? m.unique_authors ?? null
    const weighted24h = m.weighted_engagement_24h ?? m.total_weighted_engagement ?? null
    const velocity = m.velocity_ratio ?? null

    projectNodes.push({
      id: projId,
      cgId: t.cg_id,
      name: t.name || t.symbol || t.cg_id,
      symbol: t.symbol || null,
      handle: t.handle ? `@${t.handle}` : (t.cashtag || `$${t.symbol || ''}`),
      cashtag: t.cashtag || (t.symbol ? `$${t.symbol}` : null),
      avatar: t.image_large || t.image_small || t.image_url || '',
      type: 'project',
      tier: 'S',
      isHub: true,
      isProjectHub: true,
      // Authenticity (0-100) = organic-signal share. Drives the hub COLOUR
      // (organic green → noisy red) in the canvas + legend, while tier/size
      // stays influence-driven. `cleanSignal` is the same 24h clean-signal
      // score read above; null → neutral (no authenticity verdict).
      authenticity: Number.isFinite(cleanSignal) ? Math.round(cleanSignal * 100) : null,
      followers: m.unique_authors || 0, // for radius blending only
      mentionCount: mentions24h || 0,
      weightedEngagement: weighted24h || 0,
      twitterUrl: t.twitter_url || (t.handle ? `https://x.com/${t.handle}` : null),
      primaryCategory: t.primary_category || (Array.isArray(t.category) ? t.category[0] : null) || null,
      segment: t.segment || null,
      // Carry the per-project intel so the right sidebar can render it when a
      // project hub is clicked in crawl mode.
      intel: {
        mentions24h,
        mentions7d,
        authors24h,
        authors7d: null,
        weightedEngagement24h: weighted24h,
        weightedEngagement7d: null,
        attentionQuality: {
          clean_signal_score_24h: cleanSignal,
          promo_share_24h: q.promo_share_24h ?? null,
          handle_only_share_24h: q.handle_only_share_24h ?? null,
          cashtag_only_share_24h: q.cashtag_only_share_24h ?? null,
        },
        velocity,
        primaryCategory: t.primary_category || null,
        segment: t.segment || null,
        latestMentionAt: entry?.latest_mention_at || null,
      },
      // Velocity surfaces in "Fastest Rising". Bootstrap omits the 7d mention
      // field, so the old mentions24h/(mentions7d/7) ratio was always null →
      // Fastest Rising never populated. Use velocity_ratio, which bootstrap
      // DOES expose (24h-vs-prior-daily-avg ratio: 1.0 = flat, >1 = rising).
      // CrawlSidebar renders +(velocityScore - 1)*100%, so this ratio is the
      // exact shape it expects.
      velocityScore: Number.isFinite(velocity) ? velocity : null,
    })

    for (const author of authors) {
      const kolId = kolNodeId(author)
      if (!kolId) continue

      let node = kolNodesMap.get(kolId)
      if (!node) {
        const rawKolName = author.name || author.screen_name || kolId
        const kolDisplayName = (projectNamesNorm.has(normName(rawKolName)) && author.screen_name)
          ? author.screen_name
          : rawKolName
        node = {
          id: kolId,
          name: kolDisplayName,
          handle: `@${author.screen_name || ''}`,
          avatar: (author.avatar_image_url || '').replace('_normal', '_200x200'),
          type: detectType(author),
          tier: computeTier(author.followers_count || 0),
          // Author class (official/commentator/promoter/media) drives the KOL
          // COLOUR for authenticity coloring. Bootstrap's top_authors omit it;
          // it arrives only via the per-token expansion (standard/deep depth).
          // null → neutral grey.
          authorClass: (author.author_class || '').toLowerCase() || null,
          followers: author.followers_count || 0,
          isHub: false,
          isProjectHub: false,
          // These three accumulate across projects.
          mentionCount: 0,
          weightedEngagement: 0,
          bridgeCount: 0,
          // Project membership — projects this KOL has mentioned, with
          // their per-project mention counts. Drives the KOL detail panel.
          projects: [],
        }
        kolNodesMap.set(kolId, node)
      }

      const mc = author.mention_count || 1
      const we = author.total_weighted_engagement || 0
      node.mentionCount += mc
      node.weightedEngagement += we
      node.projects.push({
        projectId: projId,
        cgId: t.cg_id,
        name: t.name,
        symbol: t.symbol,
        avatar: t.image_large || t.image_small || '',
        mentions: mc,
        weightedEngagement: we,
      })

      links.push({
        source: kolId,
        target: projId,
        type: 'mention',
        tweetCount: mc,
        weightedEngagement: we,
        tweets: [],
        allTweetDates: [],
        latestTweet: null,
        latestTweetDate: null,
      })
    }
  }

  // Mark bridges + compute project-to-project adjacency through KOLs.
  // Bridge weight = sum of min(mentionA, mentionB) over shared KOLs.
  // This is the actual "shared mindshare" signal between two projects.
  for (const node of kolNodesMap.values()) {
    node.bridgeCount = node.projects.length
    if (node.bridgeCount < 2) continue
    for (let i = 0; i < node.projects.length; i++) {
      for (let j = i + 1; j < node.projects.length; j++) {
        const a = node.projects[i]
        const b = node.projects[j]
        const overlap = Math.min(a.mentions, b.mentions)
        const key = a.projectId < b.projectId
          ? `${a.projectId}|${b.projectId}`
          : `${b.projectId}|${a.projectId}`
        projectAdjacency.set(key, (projectAdjacency.get(key) || 0) + overlap)
      }
    }
  }

  // Adjacency map (id -> Set of connected ids) — used by GraphCanvas hover
  // dimming logic.
  const adjacency = new Map()
  const allNodes = [...projectNodes, ...kolNodesMap.values()]
  for (const n of allNodes) adjacency.set(n.id, new Set())
  for (const l of links) {
    adjacency.get(l.source)?.add(l.target)
    adjacency.get(l.target)?.add(l.source)
  }

  const hubNodeIds = new Set(projectNodes.map((p) => p.id))

  return {
    nodes: allNodes,
    links,
    adjacency,
    hubNodeIds,
    projectNodes,
    kolNodes: [...kolNodesMap.values()],
    projectAdjacency, // Map(projA|projB -> overlap weight)
  }
}

// Module-level cache so toggling between project ↔ crawl doesn't refetch.
const _cache = new Map() // cacheKey -> { ts, data }
const CACHE_TTL = 60 * 1000

// localStorage instant-paint seed. The built graph holds Maps (adjacency,
// projectAdjacency) that don't JSON-serialize, so we persist only the plain
// `rawEntries` (the bootstrap/enriched token list) and rebuild the graph from
// it on hydrate. Lets a cold reload paint the galaxy immediately, then
// revalidate. 30-min TTL: trending data, fine to be briefly stale on first
// paint since a live fetch follows.
const _LS_PREFIX = 'spectre-xintel-crawl-v1:'
const _LS_TTL = 30 * 60 * 1000

function _readLSSeed(cacheKey) {
  try {
    const raw = localStorage.getItem(_LS_PREFIX + cacheKey)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || Date.now() - parsed.ts > _LS_TTL) return null
    if (!Array.isArray(parsed.entries) || !parsed.entries.length) return null
    return parsed.entries
  } catch { return null }
}

function _writeLSSeed(cacheKey, entries) {
  try {
    if (!Array.isArray(entries) || !entries.length) return
    const payload = JSON.stringify({ ts: Date.now(), entries })
    if (payload.length > 2_000_000) return // ~2MB quota guard
    localStorage.setItem(_LS_PREFIX + cacheKey, payload)
  } catch { /* quota / private mode - ignore */ }
}

export function useCrawlGraph({ seed = DEFAULT_SEED, projectCount = 20, depth = DEFAULT_DEPTH, enabled = true } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [refreshedAt, setRefreshedAt] = useState(null)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false

    const cacheKey = `${seed}:${projectCount}:${depth}`
    const cached = _cache.get(cacheKey)
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setData(cached.data)
      setRefreshedAt(cached.ts)
      return undefined
    }

    // Instant-paint from the persisted seed (if any) so a cold reload shows the
    // galaxy immediately instead of a blank loader while the network resolves.
    const lsEntries = _readLSSeed(cacheKey)
    let painted = false
    if (lsEntries) {
      try {
        const seedBuilt = buildCrawlGraph(lsEntries)
        seedBuilt.rawEntries = lsEntries
        setData(seedBuilt)
        setRefreshedAt(Date.now())
        painted = true
      } catch { /* corrupt seed - fall through to fetch */ }
    }

    // Only show the loader when we have nothing on screen yet.
    if (!painted) setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const entries = await fetchSeedTokens(seed, projectCount)
        if (cancelled) return

        // PROGRESSIVE RENDER: paint the bootstrap-seeded graph right away (3
        // top_authors/project — already a usable galaxy) instead of waiting on
        // the expandTop x N-page enrichment fan-out. Previously the screen sat
        // on a loader until ALL ~expandTop*8 requests settled (and a single
        // hung page could stall first paint up to FETCH_TIMEOUT). Now first
        // paint costs one bootstrap request.
        const seedBuilt = buildCrawlGraph(entries)
        seedBuilt.rawEntries = entries
        setData(seedBuilt)
        setRefreshedAt(Date.now())
        setLoading(false)
        _writeLSSeed(cacheKey, entries)

        // Enrich the hottest projects in the background, then swap in the
        // richer graph (full author sets -> hundreds of bubbles + bridges).
        const expanded = await expandHotProjects(entries, depth)
        if (cancelled) return
        const built = buildCrawlGraph(expanded)
        // Hold onto the raw entries too — the left rail surfaces rank movers
        // and a mentions snapshot using fields (rank_change_positions etc.)
        // that we don't otherwise keep around.
        built.rawEntries = expanded
        _cache.set(cacheKey, { ts: Date.now(), data: built })
        setData(built)
        setRefreshedAt(Date.now())
        _writeLSSeed(cacheKey, expanded)
      } catch (err) {
        if (cancelled) return
        // Keep any seed-painted graph on screen; only surface the error when
        // we have nothing to show.
        if (!painted) setError(err.message || 'Crawl fetch failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [seed, projectCount, depth, enabled])

  // Derived rollups for the CrawlSidebar.
  const summary = useMemo(() => {
    if (!data) return null
    const { projectNodes, kolNodes, projectAdjacency } = data

    // Top Carriers: KOLs ranked by combined mention activity across projects.
    const topCarriers = [...kolNodes]
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, 8)

    // Fastest Rising: project with the highest velocity_ratio (24h vs prior
    // daily avg). The sidebar renders +(velocityScore - 1)*100% as a green
    // "up" badge, so only surface genuinely-rising projects (ratio > 1) with
    // real activity — a velocity spike on a near-dead project shouldn't win.
    const ranked = projectNodes
      .filter((p) => Number.isFinite(p.velocityScore) && p.velocityScore > 1 && (p.mentionCount || 0) > 0)
      .sort((a, b) => b.velocityScore - a.velocityScore)
    const fastestRising = ranked[0] || null

    // Strongest Cluster: pick the project with the most bridge KOLs around it,
    // count its KOL neighborhood, surface as "the place where attention
    // converges right now."
    let strongest = null
    for (const p of projectNodes) {
      const bridges = kolNodes.filter((k) =>
        k.bridgeCount >= 2 && k.projects.some((pj) => pj.projectId === p.id)
      )
      const nodes = kolNodes.filter((k) =>
        k.projects.some((pj) => pj.projectId === p.id)
      )
      if (!strongest || bridges.length > strongest.bridgeCount) {
        strongest = {
          project: p,
          bridgeCount: bridges.length,
          nodeCount: nodes.length,
          cohesion: nodes.length > 0 ? bridges.length / nodes.length : 0,
        }
      }
    }

    // Aggregate attention score across the visible projects:
    //  - Quality   = avg clean_signal_score
    //  - Engagement = total weighted engagement / total mentions
    //  - Reach     = sum of unique authors across projects
    //  - Momentum  = avg velocity ratio
    let qSum = 0, qN = 0, weSum = 0, mSum = 0, reachSum = 0, vSum = 0, vN = 0
    for (const p of projectNodes) {
      if (Number.isFinite(p.intel?.attentionQuality?.clean_signal_score_24h)) {
        qSum += p.intel.attentionQuality.clean_signal_score_24h
        qN++
      }
      weSum += p.weightedEngagement || 0
      mSum += p.mentionCount || 0
      reachSum += p.intel?.authors24h || 0
      if (Number.isFinite(p.intel?.velocity)) {
        vSum += p.intel.velocity
        vN++
      }
    }
    const attention = {
      quality: qN > 0 ? Math.round((qSum / qN) * 100) : null,
      engagement: mSum > 0 ? Math.min(100, Math.round((weSum / mSum) * 10)) : null,
      reach: reachSum,
      momentum: vN > 0 ? Math.round((vSum / vN) * 100) : null,
    }
    // Composite headline (0-100) averaging the three normalized sub-scores.
    const parts = [attention.quality, attention.engagement, attention.momentum].filter((n) => Number.isFinite(n))
    attention.composite = parts.length > 0
      ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length)
      : null

    // Rank movers — gainers + decliners pulled from the bootstrap entries.
    // bootstrap returns `rank_change_positions` per token (positive = moved
    // up in the trending board, negative = dropped).
    const movers = []
    if (data.rawEntries) {
      for (const entry of data.rawEntries) {
        const cgId = entry?.token?.cg_id
        const move = entry?.rank_change_positions
        if (!cgId || !Number.isFinite(move) || move === 0) continue
        const proj = projectNodes.find((p) => p.cgId === cgId)
        if (!proj) continue
        movers.push({
          projectId: proj.id,
          cgId,
          name: proj.name,
          symbol: proj.symbol,
          avatar: proj.avatar,
          mentions: proj.mentionCount,
          move,
        })
      }
    }
    movers.sort((a, b) => Math.abs(b.move) - Math.abs(a.move))
    const gainers = movers.filter((m) => m.move > 0).slice(0, 5)
    const decliners = movers.filter((m) => m.move < 0).slice(0, 5)

    // Mentions snapshot — top projects by 24h mention count, with totals.
    const mentionsSnapshot = [...projectNodes]
      .filter((p) => p.mentionCount > 0)
      .sort((a, b) => b.mentionCount - a.mentionCount)
      .slice(0, 10)
    const totalMentions24h = projectNodes.reduce((sum, p) => sum + (p.mentionCount || 0), 0)

    return {
      topCarriers,
      fastestRising,
      strongest,
      attention,
      gainers,
      decliners,
      mentionsSnapshot,
      totalMentions24h,
      projectCount: projectNodes.length,
      kolCount: kolNodes.length,
      bridgeCount: kolNodes.filter((k) => k.bridgeCount >= 2).length,
      adjacencyEdgeCount: projectAdjacency.size,
    }
  }, [data])

  // Convert projectAdjacency into a flat list of renderable arcs the canvas
  // can draw between project hubs. Weight = number of shared mentions across
  // bridge KOLs; higher weight = thicker, brighter arc. Capped at the top
  // 60 strongest arcs so the visual stays legible.
  const bridgeArcs = useMemo(() => {
    if (!data?.projectAdjacency) return []
    const out = []
    for (const [key, weight] of data.projectAdjacency) {
      const [sourceId, targetId] = key.split('|')
      out.push({ sourceId, targetId, weight })
    }
    out.sort((a, b) => b.weight - a.weight)
    return out.slice(0, 60)
  }, [data])

  return {
    nodes: data?.nodes || [],
    links: data?.links || [],
    adjacency: data?.adjacency || new Map(),
    hubNodeIds: data?.hubNodeIds || new Set(),
    projectNodes: data?.projectNodes || [],
    kolNodes: data?.kolNodes || [],
    projectAdjacency: data?.projectAdjacency || new Map(),
    bridgeArcs,
    summary,
    loading,
    error,
    refreshedAt,
  }
}

export default useCrawlGraph
