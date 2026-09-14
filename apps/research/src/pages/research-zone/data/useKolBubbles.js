/**
 * useKolBubbles - shape per-token KOL data for the Sentiment tab bubble viz.
 *
 * Data sourcing (probed against real backends 2026-05-18):
 *
 *   Primary always:    /data-api/v1/social/feed/:symbol via getSpectreSocialFeed
 *                      → ranked tweet list grouped by author. Survives for
 *                        thin tokens. This is the only source that returns
 *                        non-zero for $SPECTRE.
 *
 *   When cgId known:   /api/xdash/token/:cgId via useXDashToken.
 *                      → 30-50 carriers + clean_signal_score sentiment.
 *                        Only fires for tokens xdash actually tracks.
 *
 *   When < 10 authors: /api/tweets/search?query=$SYMBOL (rpapi proxy).
 *                      → 20 raw tweets/query. Filtered for relevance
 *                        (must mention $SYMBOL or handle in text). Used to
 *                        push 6 → 8-10 voices on thin tokens like $SPECTRE.
 *
 *   When cgId known:   /api/x-bubbles/:symbol for metrics + sentiment color.
 *                      → growth_pct, velocity_ratio, weighted sentiment.
 *                        If upstream aborts, we degrade silently.
 *
 * Loading model: never wait for slow upstreams to render. Primary feed is
 * the gate; everything else streams in as enrichment. 5s timeout on tweets
 * search, 8s on x-bubbles, primary feed inherits its own bridge timeout.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useXDashToken } from '@/hooks/useXDashToken'
import {
  buildCarrierBoard,
  normalizeXDashDetail,
  getAuthorId,
} from '@/pages/x-dash/components/x-dash-utils'
import { getSpectreSocialFeed } from '@/services/spectreMarketApi'

// Module cache + inflight dedup for the /api/x-bubbles leg. The Sentiment tab
// mounts BOTH useKolBubbles and useSentimentEngine, so a token open used to pay
// this bare fetch twice (across the two hooks) and again on every tab re-open /
// StrictMode double-mount. 60s TTL absorbs those without staling the metrics.
const _xbCache = new Map()     // SYM -> { data, ts }
const _xbInflight = new Map()  // SYM -> Promise<data|null>
const XB_TTL = 60_000
function fetchXBubblesCached(sym) {
  const key = String(sym).toUpperCase()
  const hit = _xbCache.get(key)
  if (hit && Date.now() - hit.ts < XB_TTL) return Promise.resolve(hit.data)
  if (_xbInflight.has(key)) return _xbInflight.get(key)
  const p = fetch(`/api/x-bubbles/${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { const d = j?.data || null; _xbCache.set(key, { data: d, ts: Date.now() }); return d })
    .catch(() => null)
    .finally(() => _xbInflight.delete(key))
  _xbInflight.set(key, p)
  return p
}

const SIZE_FOR_FOLLOWERS = (n) => {
  if (n >= 500_000) return 'xlarge'
  if (n >= 100_000) return 'large'
  if (n >= 25_000) return 'medium'
  return 'small'
}

const CATEGORY_FOR_FOLLOWERS = (n) => {
  if (n >= 500_000) return 'top5'
  if (n >= 100_000) return 'kol100k'
  return 'kolUnder100k'
}

function formatFollowers(n) {
  const v = Number(n) || 0
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return String(v)
}

/**
 * Detect whether `handle` is the token's own official X account so we can
 * exclude it from the carrier ring (the center bubble IS the token; an
 * official-handle bubble next to it is a duplicate that confuses users).
 *
 * Examples that should match for symbol="SPECTRE", name="SPECTRE AI":
 *   spectre, spectre_ai, spectre__ai, spectreai, spectreai_app, spectreaiapp,
 *   spectre_token, spectre_official, spectreofficial, spectrenetwork
 *
 * We do this client-side because the upstream rarely flags official accounts
 * (only x-bubbles surfaces socials.twitter, and even then unreliably).
 */
function isOfficialHandle(handle, symbol, tokenName, officialHandle) {
  if (!handle) return false
  const h = String(handle).toLowerCase().replace(/^@/, '')
  if (officialHandle) {
    const o = String(officialHandle).toLowerCase().replace(/^@/, '')
    if (h === o) return true
  }
  const s = String(symbol || '').toLowerCase().trim()
  const n = String(tokenName || '').toLowerCase().replace(/\s+/g, '')
  if (!s && !n) return false

  // Strip common official suffixes/prefixes, leaving a "core" identity to
  // compare against the symbol or token-name slug.
  const stripped = h
    .replace(/[_-]*ai$/i, '')
    .replace(/[_-]*(official|app|token|network|protocol|labs|finance|fi|io)$/i, '')
    .replace(/[_-]+$/, '')
    .replace(/[_-]+/g, '')
  const sCompact = s.replace(/[_-]+/g, '')

  if (stripped === sCompact) return true
  if (n && stripped === n.replace(/[_-]+/g, '')) return true
  if (h === sCompact) return true
  if (n && h === n) return true
  return false
}

function ringPosition(index, ringSize = 22) {
  if (index === 0) return { x: 50, y: 50 }
  const idx = index - 1
  const ringCap = 8
  const ring = Math.floor(idx / ringCap)
  const slot = idx % ringCap
  const radius = ringSize + ring * 11
  const angle = (slot / ringCap) * Math.PI * 2 + ring * 0.4
  return {
    x: 50 + Math.cos(angle) * radius,
    y: 50 + Math.sin(angle) * radius,
  }
}

const EMPTY_OPTS = Object.freeze({})

export default function useKolBubbles({
  symbol,
  cgId = null,
  tokenLogo = null,
  tokenName = null,
  enabled = true,
  maxBubbles = 40,
  timeframe = '24h',
  sortBy = 'engagement',
} = {}) {
  const tokenLogoRef = useRef(tokenLogo)
  tokenLogoRef.current = tokenLogo
  const tokenNameRef = useRef(tokenName)
  tokenNameRef.current = tokenName

  // ── 1. PRIMARY: social/feed (always; fast; survives for thin tokens) ────────
  const [feedState, setFeedState] = useState({ rows: [], loading: true })
  useEffect(() => {
    if (!enabled || !symbol) {
      setFeedState({ rows: [], loading: false })
      return
    }
    let cancelled = false
    setFeedState((s) => ({ ...s, loading: true }))
    getSpectreSocialFeed(symbol, { limit: 100, minFollowers: 0 })
      .then((payload) => {
        if (cancelled) return
        setFeedState({
          rows: Array.isArray(payload?.data) ? payload.data : [],
          loading: false,
        })
      })
      .catch(() => {
        if (cancelled) return
        setFeedState({ rows: [], loading: false })
      })
    return () => { cancelled = true }
  }, [enabled, symbol])

  // ── 2. ENRICHMENT: xdash (only when cgId; rich author roster) ───────────────
  const xdashOpts = useMemo(
    () => (enabled && cgId
      ? { includeIntel: true, timeframe, authorScope: 'all', perPage: 50 }
      : EMPTY_OPTS),
    [enabled, cgId, timeframe],
  )
  const { data: xdashData } = useXDashToken(
    enabled && cgId ? cgId : null,
    xdashOpts,
  )

  // ── 3. ENRICHMENT: x-bubbles (metrics + sentiment color) ────────────────────
  const [xbState, setXbState] = useState({ data: null, loading: false })
  useEffect(() => {
    if (!enabled || !symbol) {
      setXbState({ data: null, loading: false })
      return
    }
    let cancelled = false
    setXbState((s) => ({ ...s, loading: true }))
    fetchXBubblesCached(symbol)
      .then((d) => { if (!cancelled) setXbState({ data: d, loading: false }) })
    return () => { cancelled = true }
  }, [enabled, symbol])

  // ── 4. TAIL: /api/tweets/search (only when primary thin) ────────────────────
  // Fires lazily after feed lands and we have < 10 unique authors. Strict
  // relevance filter: tweet text must mention the symbol cashtag or handle.
  const [tailState, setTailState] = useState({ rows: [], loading: false })
  const tailKeyRef = useRef('')
  useEffect(() => {
    if (!enabled || !symbol) return
    if (feedState.loading) return // wait for primary to settle
    const feedAuthorCount = new Set(
      feedState.rows
        .map((r) => String(r.author_handle || '').toLowerCase().replace(/^@/, ''))
        .filter(Boolean),
    ).size
    if (feedAuthorCount >= 10) return // already enough
    const key = `${symbol}|${feedAuthorCount}`
    if (tailKeyRef.current === key) return
    tailKeyRef.current = key

    let cancelled = false
    setTailState({ rows: [], loading: true })
    const upper = String(symbol).toUpperCase()
    const name = String(tokenNameRef.current || '').trim()
    const queries = [`$${upper}`, upper, name].filter(Boolean)
    const seenQ = new Set()
    const uniqQs = queries.filter((q) => {
      const k = q.toLowerCase()
      if (seenQ.has(k)) return false
      seenQ.add(k); return true
    })

    const relevanceTokens = [
      `$${upper.toLowerCase()}`,
      upper.toLowerCase(),
      name.toLowerCase(),
    ].filter(Boolean)

    Promise.allSettled(
      uniqQs.map((q) => fetch(`/api/tweets/search?query=${encodeURIComponent(q)}`, {
        signal: AbortSignal.timeout(5000),
      }).then((r) => (r.ok ? r.json() : []))),
    ).then((results) => {
      if (cancelled) return
      const rows = []
      const seenIds = new Set()
      for (const r of results) {
        if (r.status !== 'fulfilled') continue
        const list = Array.isArray(r.value) ? r.value : []
        for (const tw of list) {
          const id = tw.tweet_id
          if (id && seenIds.has(id)) continue
          if (id) seenIds.add(id)
          const text = String(tw.tweet_text || '').toLowerCase()
          // Strict relevance: text must mention symbol cashtag or token name
          const relevant = relevanceTokens.some((tok) => tok && text.includes(tok))
          if (!relevant) continue
          rows.push(tw)
        }
      }
      setTailState({ rows, loading: false })
    })
    return () => { cancelled = true }
  }, [enabled, symbol, feedState])

  // ── Author union ────────────────────────────────────────────────────────────
  const feedAuthors = useMemo(() => authorsFromFeedRows(feedState.rows), [feedState.rows])
  const xdashAuthors = useMemo(() => {
    if (!xdashData) return []
    const detail = normalizeXDashDetail(xdashData)
    return buildCarrierBoard(detail.topAuthors, detail.authors, detail.mergedMentions)
  }, [xdashData])
  const tailAuthors = useMemo(() => authorsFromTweetSearchRows(tailState.rows), [tailState.rows])

  const mergedAuthorsRaw = useMemo(
    () => mergeByHandle([xdashAuthors, feedAuthors, tailAuthors]),
    [feedAuthors, xdashAuthors, tailAuthors],
  )

  // Split out the official-token author so it doesn't render as a separate
  // bubble (the center IS the token). We also reuse its avatar for the
  // center fallback when no tokenLogo is in props/x-bubbles.
  const { mergedAuthors, officialAuthor } = useMemo(() => {
    // Try to read an explicit official handle from x-bubbles socials.twitter
    const twitterUrl = xbState.data?.socials?.twitter || ''
    const explicitHandle = String(twitterUrl).split('/').filter(Boolean).pop() || null

    let official = null
    const carriers = []
    for (const a of mergedAuthorsRaw) {
      const h = String(a.screen_name || '').toLowerCase().replace(/^@/, '')
      if (isOfficialHandle(h, symbol, tokenNameRef.current, explicitHandle)) {
        // Keep the highest-engagement match as canonical official author.
        if (!official || Number(a.total_weighted_engagement || 0) > Number(official.total_weighted_engagement || 0)) {
          official = a
        }
        continue
      }
      carriers.push(a)
    }
    return { mergedAuthors: carriers, officialAuthor: official }
  }, [mergedAuthorsRaw, xbState.data, symbol])

  // ── Final return ────────────────────────────────────────────────────────────
  return useMemo(() => {
    if (!enabled || !symbol) {
      return { bubbles: [], connections: [], metrics: null, sentiment: null, source: null, loading: false, error: null }
    }

    // Loading: only while primary feed is still in flight AND we have no
    // authors yet. Once primary settles (with or without data), render.
    const loading = feedState.loading && mergedAuthors.length === 0

    const metrics = shapeMetrics(xbState.data, xdashData)
    const sentiment = shapeSentiment(xbState.data, xdashData)
    const source = xdashAuthors.length > 0
      ? 'xdash'
      : (feedAuthors.length > 0 || tailAuthors.length > 0)
        ? (tailAuthors.length > 0 ? 'feed+search' : 'feed')
        : null

    if (mergedAuthors.length === 0) {
      return { bubbles: [], connections: [], metrics, sentiment, source, loading, error: null }
    }

    const sorted = sortCarriers(mergedAuthors, sortBy)
    const top = sorted.slice(0, Math.max(1, maxBubbles))

    const center = {
      id: 'center',
      user: tokenNameRef.current || xbState.data?.name || (symbol || '').toUpperCase() || 'Token',
      handle: `${(symbol || '').toUpperCase()}`,
      // Logo priority: prop tokenLogo → x-bubbles image → official author
      // avatar (e.g. @Spectre__AI). This covers tokens where the upstream
      // doesn't carry a CoinGecko image but the official account exists.
      avatar: tokenLogoRef.current
        || xbState.data?.image
        || officialAuthor?.avatar
        || officialAuthor?.avatar_image_url
        || officialAuthor?.profile_image_url
        || null,
      verified: false,
      followersNum: 0,
      followers: '',
      size: 'center',
      category: 'main',
      sentimentTone: sentiment?.tone || null,
      ...ringPosition(0),
      timestamp: Date.now(),
      mentionCount: top.length,
      totalEngagement: top.reduce((sum, a) => sum + Number(a.total_weighted_engagement || 0), 0),
    }

    const bubbles = [center, ...top.map((a, i) => mapCarrierToBubble(a, i))]
    const connections = bubbles.slice(1).map((b) => ['center', b.id])

    return { bubbles, connections, metrics, sentiment, source, loading: false, error: null }
  }, [enabled, symbol, feedState.loading, mergedAuthors, officialAuthor, xbState.data, xdashData, xdashAuthors, feedAuthors, tailAuthors, maxBubbles, sortBy])
}

// ── Author normalizers ──────────────────────────────────────────────────────

function mapCarrierToBubble(a, index) {
  const followers = Number(a.followers_count || a.followers || 0)
  const handle = String(a.screen_name || '').replace(/^@/, '')
  const id = getAuthorId(a) || handle || `author-${index}`
  const lastSeen = a.last_seen_at ? new Date(a.last_seen_at).getTime() || 0 : 0
  return {
    id,
    user: a.name || handle || id,
    handle,
    authorId: getAuthorId(a) || null,
    avatar: a.avatar_image_url || a.profile_image_url || a.avatar || null,
    verified: Boolean(a.is_verified || a.verified),
    followersNum: followers,
    followers: formatFollowers(followers),
    size: SIZE_FOR_FOLLOWERS(followers),
    category: CATEGORY_FOR_FOLLOWERS(followers),
    ...ringPosition(index + 1),
    timestamp: lastSeen || Date.now(),
    mentionCount: Number(a.mention_count || 0),
    totalEngagement: Math.round(Number(a.total_weighted_engagement || 0)),
    tweet: a._latestTweet || '',
    tweetUrl: a._latestTweetUrl || null,
    profileUrl: handle ? `https://x.com/${handle}` : null,
  }
}

function authorsFromFeedRows(rows) {
  const list = Array.isArray(rows) ? rows : []
  const byHandle = new Map()
  for (const row of list) {
    const handle = String(row.author_handle || '').replace(/^@/, '').toLowerCase()
    if (!handle) continue
    const followers = Number(row.author_followers || 0)
    const engagement = Number(row.engagement_score || 0)
    const ts = row.timestamp ? new Date(row.timestamp).getTime() || 0 : 0
    const existing = byHandle.get(handle)
    if (!existing) {
      byHandle.set(handle, {
        rest_id: handle,
        screen_name: handle,
        name: row.author || handle,
        avatar: (row.author_avatar || '').replace('_normal', '_bigger') || null,
        is_verified: !!row.author_verified,
        followers_count: followers,
        mention_count: 1,
        total_weighted_engagement: engagement,
        last_seen_at: ts ? new Date(ts).toISOString() : null,
        _latestTs: ts,
        _latestTweet: row.text || '',
        _latestTweetUrl: row.tweet_id ? `https://x.com/${handle}/status/${row.tweet_id}` : null,
      })
    } else {
      existing.mention_count += 1
      existing.total_weighted_engagement += engagement
      if (followers > existing.followers_count) existing.followers_count = followers
      if (ts > existing._latestTs) {
        existing._latestTs = ts
        existing.last_seen_at = new Date(ts).toISOString()
        existing._latestTweet = row.text || ''
        existing._latestTweetUrl = row.tweet_id ? `https://x.com/${handle}/status/${row.tweet_id}` : null
      }
    }
  }
  return [...byHandle.values()]
}

function authorsFromTweetSearchRows(rows) {
  const list = Array.isArray(rows) ? rows : []
  const byHandle = new Map()
  for (const tw of list) {
    const handle = String(tw.username || '').replace(/^@/, '').toLowerCase()
    if (!handle) continue
    const followers = Number(tw.followers || 0)
    const engagement = Number(
      (Number(tw.like_count) || 0)
      + (Number(tw.retweet_count) || 0) * 2
      + (Number(tw.reply_count) || 0),
    )
    const ts = (() => {
      // rpapi returns relative date strings ("17 minutes ago"); we can't
      // parse those into accurate timestamps. Best-effort: treat as recent.
      return Date.now() - 1000
    })()
    const existing = byHandle.get(handle)
    if (!existing) {
      byHandle.set(handle, {
        rest_id: handle,
        screen_name: handle,
        name: tw.username || handle,
        avatar: (tw.ProfilePic || '').replace('_normal', '_bigger') || null,
        is_verified: false,
        followers_count: followers,
        mention_count: 1,
        total_weighted_engagement: engagement,
        last_seen_at: new Date(ts).toISOString(),
        _latestTs: ts,
        _latestTweet: tw.tweet_text || '',
        _latestTweetUrl: tw.tweet_url || null,
      })
    } else {
      existing.mention_count += 1
      existing.total_weighted_engagement += engagement
      if (followers > existing.followers_count) existing.followers_count = followers
    }
  }
  return [...byHandle.values()]
}

function mergeByHandle(arrays) {
  const out = new Map()
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue
    for (const a of arr) {
      const handle = String(a?.screen_name || a?.handle || '').replace(/^@/, '').toLowerCase()
      if (!handle) continue
      const existing = out.get(handle)
      if (!existing) {
        out.set(handle, { ...a, screen_name: handle })
      } else {
        const merged = { ...existing }
        if (!merged.avatar && (a.avatar || a.avatar_image_url || a.profile_image_url)) {
          merged.avatar = a.avatar || a.avatar_image_url || a.profile_image_url
        }
        if (!merged.name && a.name) merged.name = a.name
        if (!merged.followers_count && a.followers_count) merged.followers_count = a.followers_count
        if (!merged.last_seen_at && a.last_seen_at) merged.last_seen_at = a.last_seen_at
        if (!merged._latestTweet && a._latestTweet) {
          merged._latestTweet = a._latestTweet
          merged._latestTweetUrl = a._latestTweetUrl
        }
        out.set(handle, merged)
      }
    }
  }
  return [...out.values()]
}

function sortCarriers(carriers, sortBy) {
  const arr = [...carriers]
  switch (sortBy) {
    case 'followers':
      return arr.sort((a, b) => (Number(b.followers_count || 0) - Number(a.followers_count || 0)))
    case 'mentions':
      return arr.sort((a, b) => (Number(b.mention_count || 0) - Number(a.mention_count || 0)))
    case 'recency':
      return arr.sort((a, b) => {
        const ta = a.last_seen_at ? new Date(a.last_seen_at).getTime() || 0 : 0
        const tb = b.last_seen_at ? new Date(b.last_seen_at).getTime() || 0 : 0
        return tb - ta
      })
    case 'engagement':
    default:
      return arr.sort((a, b) => (
        Number(b.total_weighted_engagement || 0) - Number(a.total_weighted_engagement || 0)
      ))
  }
}

function shapeMetrics(xb, xdashData) {
  // Prefer x-bubbles aggregate metrics; fall back to xdash if x-bubbles aborted.
  const xbM = xb?.metrics || null
  const detail = xdashData ? normalizeXDashDetail(xdashData) : null
  const xdM = detail?.metrics || null

  const mentions24h = Number(xbM?.mentions_24h || xdM?.mentions_24h || 0)
  const uniqueAuthors = Number(
    xbM?.unique_authors
    || xdM?.unique_external_authors_24h
    || xdM?.unique_authors_24h
    || 0,
  )
  const growth = Number(xbM?.growth_pct || 0)
  const velocity = Number(xbM?.velocity_ratio || 0)
  const latestAt = xb?.snapshot_ts
    ? new Date(xb.snapshot_ts).getTime() || 0
    : (detail?.latestMentionAt ? new Date(detail.latestMentionAt).getTime() || 0 : 0)

  if (!mentions24h && !uniqueAuthors && !growth && !velocity) return null
  return {
    mentions24h,
    uniqueAuthors,
    growthPct: growth || null,
    velocity: velocity || 0,
    latestAt,
  }
}

function shapeSentiment(xb, xdashData) {
  // x-bubbles server-classified color is the cleanest signal when present
  if (xb?.metrics?.color && xb.metrics.color !== 'neutral') {
    const score = Number(xb.metrics.sentiment) || 0
    const tone = xb.metrics.color // 'bull' | 'bear' | 'neutral'
    return { score: 0.5 + score / 2, tone, raw: score }
  }
  if (xb?.metrics?.color === 'neutral' && Number.isFinite(Number(xb?.metrics?.sentiment))) {
    return { score: 0.5, tone: 'neutral', raw: Number(xb.metrics.sentiment) }
  }
  // Fallback: xdash clean_signal_score
  if (!xdashData) return null
  const detail = normalizeXDashDetail(xdashData)
  const raw = Number(
    detail.quality?.clean_signal_score_24h
    ?? detail.quality?.clean_signal_score
    ?? detail.metrics?.clean_signal_score_24h
    ?? NaN,
  )
  if (!Number.isFinite(raw)) return null
  let tone = 'neutral'
  if (raw >= 0.7) tone = 'bull'
  else if (raw >= 0.55) tone = 'amber'
  else if (raw > 0) tone = 'bear'
  return { score: raw, tone, raw }
}
