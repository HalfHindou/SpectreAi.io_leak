/**
 * useProjectGraph - Fetches X Dash token data and transforms it into
 * the node/link format consumed by the X Intelligence graph canvas.
 *
 * When projectId is null, falls back to the static ZIGChain graph.
 * When projectId is set (a CoinGecko ID), fetches live author data.
 */
import { useState, useEffect, useMemo } from 'react'
import { resolveTokenIdentity } from '@/lib/token-identity'
import { fetchXdashTokenPage } from './xdash-cache'

const EMPTY_NODES = []
const EMPTY_LINKS = []
const EMPTY_ADJACENCY = new Map()
const EMPTY_HUB_IDS = new Set()
const EMPTY_GRAPH = {
  nodes: EMPTY_NODES,
  links: EMPTY_LINKS,
  adjacency: EMPTY_ADJACENCY,
  hubNodeIds: EMPTY_HUB_IDS,
  projectName: null,
  intel: null,
  isStatic: false,
  isEmpty: true,
}

const KNOWN_EXCHANGES = new Set([
  'binance', 'kucoincom', 'bybit_official', 'okx', 'coinbase',
  'krakenfx', 'bitmartexchange', 'mexc_global', 'gateio_', 'htx_global',
  'phemex_official', 'blofin_official', 'kucoinfutures', 'dwflabs',
])

function computeTier(followers) {
  if (followers >= 500000) return 'S'
  if (followers >= 100000) return 'A'
  if (followers >= 30000) return 'B'
  return 'C'
}

function detectType(author) {
  const handle = (author.screen_name || '').toLowerCase()
  if (KNOWN_EXCHANGES.has(handle)) return 'exchange'
  const desc = (author.description || '').toLowerCase()
  if (desc.includes('exchange') || desc.includes('trading platform')) return 'exchange'
  // NOTE: do NOT classify authors as 'project' from bio keywords. The canvas
  // draws a hexagon for every type:'project' node, so a KOL whose bio merely
  // mentions "blockchain/defi/protocol" (e.g. @InjectiveVN_ "Injective Việt
  // Nam") rendered as a duplicate project hexagon next to the real hub. The
  // project hub is built separately from token metadata, so authors are only
  // ever KOLs (or exchanges).
  return 'kol'
}

function buildGraphFromApiData(tokenData) {
  const t = tokenData.token?.token || tokenData.token || {}
  const m = tokenData.token?.metrics || tokenData.metrics || {}
  const authors = tokenData.authors || tokenData.top_authors || tokenData.token?.top_authors || []
  const intelLatest = tokenData.intelligence?.latest || null
  // Authenticity (0-100) for the project hub: the share of mentions X Dash
  // judges to be organic, non-engineered signal (`clean_signal_score_24h`).
  // High = grassroots attention; low = bot/promo-heavy. Prefer the live intel
  // bucket, fall back to the token's quality rollup, else null (→ neutral).
  const cleanSignal24h = intelLatest?.attention_quality?.clean_signal_score_24h
    ?? tokenData.quality?.clean_signal_score_24h
    ?? (tokenData.token?.quality?.clean_signal_score_24h)
    ?? null
  const hubAuthenticity = Number.isFinite(cleanSignal24h)
    ? Math.round(cleanSignal24h * 100)
    : null
  // X Dash ships up to 20 best-performing tweets per token in `top_mentions[]`,
  // each carrying the tweet body + author + engagement counts. We pipe that
  // straight to the hub node so the sidebar can render a real tweet feed.
  const topMentions = Array.isArray(tokenData.top_mentions) ? tokenData.top_mentions : []

  if (!authors.length) return null

  // Project-level intelligence summary — exposed to consumers via graph.intel.
  // This is the live X Dash data feed for the project itself (mentions over
  // time, weighted engagement, attention quality), independent of any single
  // KOL author. The left sidebar + right sidebar surface this directly.
  // Prefer intelligence.latest (has both 24h + 7d buckets). When it's absent
  // — common for less-tracked projects — fall back to the metrics object so
  // the sidebar doesn't render "—" everywhere. metrics only carries 24h
  // figures (external_mentions_24h, unique_external_authors_24h,
  // external_weighted_engagement_24h), so the 7d slots stay null.
  const intel = intelLatest ? {
    snapshotAt: intelLatest.snapshot_at || null,
    segment: intelLatest.segment || t.segment || null,
    primaryCategory: intelLatest.token?.primary_category || t.primary_category || null,
    categories: intelLatest.token?.category || (Array.isArray(t.category) ? t.category : []),
    latestMentionAt: intelLatest.latest_mention_at || tokenData.latest_mention_at || null,
    // The intel snapshot's 24h bucket is often stale/0 even when the token has
    // live mentions, so the sidebar showed 0 while the heatmap tile showed the
    // real count. Fall back to the same bootstrap field the tile uses
    // (external_mentions_24h) so the panel matches the tile for every token.
    mentions24h: intelLatest.mentions?.['24h'] || m.external_mentions_24h || m.external_mentions || null,
    mentions7d: intelLatest.mentions?.['7d'] || m.external_mentions_7d || null,
    // Same stale-0 issue as mentions above (#1008): the intel snapshot's 24h
    // authors bucket is often 0 even when the token has live authors. Fall back
    // to the bootstrap author count so "Authors · 24h" isn't a false 0.
    authors24h: intelLatest.authors?.['24h'] || m.unique_external_authors_24h || m.unique_authors_24h || null,
    authors7d: intelLatest.authors?.['7d'] ?? null,
    weightedEngagement24h: intelLatest.weighted_engagement?.['24h'] ?? null,
    weightedEngagement7d: intelLatest.weighted_engagement?.['7d'] ?? null,
    attentionQuality: intelLatest.attention_quality || null,
  } : {
    snapshotAt: null,
    segment: t.segment || null,
    primaryCategory: t.primary_category || null,
    categories: Array.isArray(t.category) ? t.category : [],
    latestMentionAt: tokenData.latest_mention_at || null,
    mentions24h: m.external_mentions_24h ?? null,
    mentions7d: null,
    authors24h: m.unique_external_authors_24h ?? null,
    authors7d: null,
    weightedEngagement24h: m.external_weighted_engagement_24h ?? m.total_weighted_engagement ?? null,
    weightedEngagement7d: null,
    attentionQuality: null,
  }

  // Find the project's own Twitter account among authors.
  // Match by: screen_name contains token symbol/name, or name closely matches token name.
  const tokenName = (t.name || '').toLowerCase()
  const tokenSymbol = (t.symbol || '').toLowerCase()
  // Find the project's OWN canonical account to use as the hub. Order matters:
  // a loose "handle contains token name" match alone lets a community/secondary
  // account whose handle merely CONTAINS the name (e.g. @InjectiveLounge for
  // "injective") win — hijacking the centerpiece while the real official account
  // (@injective) gets demoted to a KOL node. So match the EXACT official handle
  // first, then exact name/symbol, and only then fall back to the loose contains.
  const tokenHandleNorm = String(t.handle || '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]/g, '')
  const ownAccount =
    (tokenHandleNorm && authors.find((a) => (a.screen_name || '').toLowerCase().replace(/^@/, '') === tokenHandleNorm))
    || authors.find((a) => {
      const handle = (a.screen_name || '').toLowerCase()
      const name = (a.name || '').toLowerCase()
      if (tokenName && (handle === tokenName.replace(/[^a-z0-9]/g, '') || name === tokenName)) return true
      if (tokenSymbol && handle === tokenSymbol.replace(/[^a-z0-9]/g, '')) return true
      return false
    })
    || (tokenName.length >= 4 && authors.find((a) => (a.screen_name || '').toLowerCase().includes(tokenName.replace(/[^a-z0-9]/g, ''))))

  // Use the project's own account as hub when present; otherwise build the
  // hub from token metadata + intelligence.latest. The previous fallback hard-
  // coded tier='S' and followers=0, producing contradictory copy in the
  // sidebar ("S-Tier, top-tier influencer with 0 reach"). Now the hub is
  // tagged as a project (not tiered like a KOL) and carries the real
  // intelligence numbers downstream.
  // Canonical display identity (name · $cashtag(s) · REAL @handle · logo),
  // resolved once in @/lib/token-identity so the rules — never fabricate
  // "@<ticker>", support multi-ticker projects ($SPECT/$SPECTRE), and never
  // key identity on a colliding ticker ($DOT) — live in ONE place and can't be
  // re-broken here.
  const identity = resolveTokenIdentity(t, { ownAccount })

  // The internal node id needs a stable string — fall back through the real
  // handle / cashtag / symbol / name (this id is never rendered as "@id").
  const hubHandle = identity.handle
    || (identity.cashtag || '').replace(/^\$/, '')
    || identity.symbol
    || identity.name
    || 'project'
  const hubId = String(hubHandle).toLowerCase().replace(/[^a-z0-9]/g, '') || 'project'
  const hubNodeIds = new Set([hubId])

  // identity.avatar already prefers the CoinGecko-grade logo over the X avatar.
  const hubAvatar = identity.avatar || ''
  const hubFollowers = ownAccount?.followers_count || ownAccount?.follower_count || 0

  const hubNode = {
    id: hubId,
    cgId: identity.cgId,
    name: identity.name || hubHandle,
    // Real @handle only — null when the project has no X account in the feed.
    // The sidebar/tooltip render the $cashtag in that case (never "@<ticker>").
    handle: identity.handleAt,
    cashtag: identity.cashtag,
    // Full ticker list for multi-ticker projects (Spectre = $SPECT/$SPECTRE).
    cashtags: identity.cashtags,
    avatar: hubAvatar,
    followers: hubFollowers,
    type: 'project',
    // Hubs aren't ranked on the KOL S/A/B/C scale. Sidebar treats `isHub`
    // specially and renders intelligence-driven copy instead of tier copy.
    tier: 'S',
    description: ownAccount?.description || t.narrative || '',
    verified: true,
    createdAt: null,
    statusesCount: ownAccount?.statuses_count || 0,
    friendsCount: ownAccount?.friends_count || 0,
    isHub: true,
    // Authenticity drives the hub's colour (organic green → noisy red) in the
    // canvas + legend. Kept separate from tier (which still drives SIZE).
    authenticity: hubAuthenticity,
    // Project-level signal carried for sizing + the sidebar.
    mentionCount: intel?.mentions24h ?? m.external_mentions_24h ?? null,
    weightedEngagement: intel?.weightedEngagement24h ?? null,
    intel,
    twitterUrl: identity.twitterUrl,
    primaryCategory: t.primary_category || intel?.primaryCategory || null,
    segment: t.segment || intel?.segment || null,
    topMentions: topMentions.map((m) => ({
      id: m.tweet?.tweet_id,
      url: m.tweet?.x_url,
      text: m.tweet?.full_text || '',
      createdAt: m.tweet?.created_at_utc || null,
      views: m.tweet?.views_count || 0,
      likes: m.tweet?.favorite_count || 0,
      retweets: m.tweet?.retweet_count || 0,
      replies: m.tweet?.reply_count || 0,
      quotes: m.tweet?.quote_count || 0,
      author: m.author ? {
        name: m.author.name,
        handle: m.author.screen_name,
        avatar: (m.author.avatar_image_url || '').replace('_normal', '_200x200'),
        followers: m.author.followers_count || 0,
        verified: !!m.author.is_blue_verified || !!m.author.legacy_verified,
      } : null,
    })).filter((m) => m.id && m.text),
  }

  // Skip the own account in the authors loop (already used as hub)
  const ownAccountHandle = ownAccount ? (ownAccount.screen_name || '').toLowerCase() : null

  // Author nodes
  const nodes = [hubNode]
  const links = []
  const nodeIdSet = new Set([hubId])
  // Strip emoji / symbols before comparing names so "Injective 🥷" collides with
  // the hub "Injective", but "Injective Việt Nam 🥷" (a distinct entity) does not.
  const normName = (s) => String(s || '').replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase()
  const hubNameNorm = normName(hubNode.name)

  for (const a of authors) {
    const nodeId = (a.screen_name || a.rest_id || '').toLowerCase()
    if (!nodeId || nodeIdSet.has(nodeId)) continue
    // Skip the own account - it's already the hub
    if (nodeId === ownAccountHandle) continue
    nodeIdSet.add(nodeId)

    const followers = a.followers_count || a.follower_count || 0
    const mentionCount = a.mention_count || 1
    const weightedEngagement = a.total_weighted_engagement || 0
    // Community / secondary accounts often share the project's display name
    // (e.g. @InjectiveLounge is named "Injective"), rendering as a confusing
    // duplicate of the hub — fall back to the handle so they read distinctly.
    const rawName = a.name || a.screen_name || nodeId
    const displayName = (hubNameNorm && normName(rawName) === hubNameNorm && a.screen_name) ? a.screen_name : rawName
    nodes.push({
      id: nodeId,
      name: displayName,
      handle: `@${a.screen_name || nodeId}`,
      avatar: (a.avatar_image_url || a.profile_image_url || '').replace('_normal', '_200x200'),
      followers,
      type: detectType(a),
      tier: computeTier(followers),
      // X Dash classifies each author: official / commentator / promoter /
      // media / alert. Drives the node COLOUR (authenticity coloring) so a
      // cluster of paid promoters around a project reads as a red flag.
      authorClass: (a.author_class || '').toLowerCase() || null,
      description: a.description || '',
      verified: a.is_blue_verified || a.legacy_verified || false,
      createdAt: null,
      statusesCount: a.statuses_count || 0,
      friendsCount: a.friends_count || 0,
      isHub: false,
      // Social-graph signal: how loudly this account talks about the project.
      // Bubble radius uses both `mentionCount` and `followers`, and the
      // sidebar ranks connections by mention volume.
      mentionCount,
      weightedEngagement,
      lastSeenAt: a.last_seen_at || null,
    })

    // Edge: author -> project hub. Carry the author's last-seen tweet date so
    // the page's timeframe date-filter (used in crawl/list views) has a real
    // value instead of excluding every project link as undated.
    links.push({
      source: nodeId,
      target: hubId,
      type: 'mention',
      tweetCount: mentionCount,
      weightedEngagement,
      latestTweet: null,
      latestTweetDate: a.last_seen_at ? new Date(a.last_seen_at) : null,
      tweets: [],
      allTweetDates: [],
    })
  }

  // Build adjacency map
  const adjacency = new Map()
  for (const n of nodes) adjacency.set(n.id, new Set())
  for (const l of links) {
    adjacency.get(l.source)?.add(l.target)
    adjacency.get(l.target)?.add(l.source)
  }

  return {
    nodes,
    links,
    adjacency,
    hubNodeIds,
    projectName: hubNode.name,
    intel,
  }
}

export default function useProjectGraph(projectId, timeframe = '7d') {
  const [apiData, setApiData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Fetch project data from X Dash API. Token pages run through the shared
  // xdash-cache (TTL + in-flight dedup + 5xx retry), so re-clicking the same
  // project — or drilling into one the galaxy already enriched — reuses the
  // pages instead of re-paying the full fan-out.
  useEffect(() => {
    if (!projectId) {
      setApiData(null)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false

    setLoading(true)
    setError(null)

    const PER_PAGE = 50
    // Safety cap: 10 pages = 500 mentions. Do NOT raise it — the upstream now
    // rate-limits (429 bursts) and a 20-page parallel fan-out made project
    // loads crawl. Tail authors beyond page 10 are surfaced honestly by the
    // "N of M voices" label instead.
    const MAX_PAGES = 10
    // The X Dash token endpoint only honors a 24h or 7d mention window — any
    // wider value (30d/90d/all) silently collapses to 24h upstream. So map the
    // requested timeframe down to the widest window it actually serves. 7d is
    // the default: a known project (e.g. Zebec) returns ~37 authors over 7d vs
    // ~14 over 24h, so the graph isn't deceptively sparse.
    const upstreamTimeframe = timeframe === '24h' ? '24h' : '7d'

    const fetchPage = (page) =>
      fetchXdashTokenPage(projectId, { scope: 'all', timeframe: upstreamTimeframe, page, perPage: PER_PAGE })

    ;(async () => {
      try {
        // First page tells us how many pages are available. Bootstrap’s
        // /api/token/{id} caps `authors[]` at 11, but `mentions[]` has
        // pagination — each mention carries its author, so paginating
        // mentions and de-duping authors recovers the full author set
        // (~70 unique authors per hot project instead of 11).
        const first = await fetchPage(1)
        if (cancelled || !first) return
        const pageCount = Math.min(first?.pagination?.page_count || 1, MAX_PAGES)

        // Fan out remaining pages in parallel.
        const rest = pageCount > 1
          ? await Promise.allSettled(
              Array.from({ length: pageCount - 1 }, (_, i) => fetchPage(i + 2))
            )
          : []
        if (cancelled) return

        // Accumulate mentions across all pages.
        const allMentions = [...(first.mentions || [])]
        for (const r of rest) {
          if (r.status === 'fulfilled' && r.value?.mentions) {
            allMentions.push(...r.value.mentions)
          }
        }

        // The mention stream's `author` objects do NOT carry `author_class`
        // (official/promoter/commentator/media) — only the classified
        // `authors[]`/`top_authors[]` rollups do. Build a class lookup keyed
        // by both rest_id and screen_name so the aggregated-from-mentions
        // authors can be stamped with their class for authenticity coloring.
        const classByKey = new Map()
        const indexClass = (list) => {
          for (const a of (list || [])) {
            const cls = (a?.author_class || '').toLowerCase()
            if (!cls) continue
            const restKey = a.rest_id || a.author_rest_id
            if (restKey) classByKey.set(String(restKey), cls)
            const sn = (a.screen_name || '').toLowerCase()
            if (sn) classByKey.set(sn, cls)
          }
        }
        indexClass(first.authors || first.top_authors)
        for (const r of rest) {
          if (r.status === 'fulfilled') indexClass(r.value?.authors || r.value?.top_authors)
        }

        // Aggregate per-author stats from the full mention stream. Each
        // mention has { author, tweet }; we group by rest_id (preferring
        // stable id) and sum mention_count + total weighted engagement.
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
            // Track latest seen tweet so we have a fresh `last_seen_at`.
            if (m?.tweet?.created_at_utc && (!existing.last_seen_at || m.tweet.created_at_utc > existing.last_seen_at)) {
              existing.last_seen_at = m.tweet.created_at_utc
            }
          } else {
            byAuthor.set(key, {
              ...a,
              rest_id: key,
              mention_count: 1,
              total_weighted_engagement: eng,
              last_seen_at: m?.tweet?.created_at_utc || null,
            })
          }
        }

        // Stamp the author class (from the classified rollups above) onto each
        // aggregated author so authenticity coloring has a class to read.
        for (const a of byAuthor.values()) {
          if (a.author_class) continue
          const cls = classByKey.get(String(a.rest_id))
            || classByKey.get((a.screen_name || '').toLowerCase())
          if (cls) a.author_class = cls
        }

        // Sort by mention count → keeps the bubble sizing sane.
        const aggregatedAuthors = Array.from(byAuthor.values())
          .sort((a, b) => b.mention_count - a.mention_count)

        // Build a "rich" response that downstream buildGraphFromApiData
        // can consume as-is. Keep first page’s metadata; replace authors
        // with the aggregated set; preserve top_mentions for the sidebar.
        const enriched = {
          ...first,
          authors: aggregatedAuthors,
          // top_mentions stays as first page's curated list — already
          // engagement-ranked by X Dash.
          top_mentions: first.top_mentions || allMentions.slice(0, 24),
          mentions: allMentions,
          _pagesAggregated: pageCount,
        }

        if (cancelled) return
        setApiData(enriched)
        setLoading(false)
      } catch (err) {
        if (cancelled || err?.name === 'AbortError') return
        setError(err.message)
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [projectId, timeframe])

  // Transform API data into graph format
  const graph = useMemo(() => {
    if (!projectId) return EMPTY_GRAPH
    if (!apiData) return null
    const result = buildGraphFromApiData(apiData)
    if (!result) return null
    return { ...result, isStatic: false, isEmpty: false }
  }, [projectId, apiData])

  // When projectId is set but data hasn't loaded yet, graph is null.
  // Use EMPTY_GRAPH for structure but mark isEmpty=false so the landing page hides.
  const result = graph || (projectId ? { ...EMPTY_GRAPH, isEmpty: false } : EMPTY_GRAPH)

  return {
    ...result,
    loading,
    error,
  }
}
