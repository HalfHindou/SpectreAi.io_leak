/**
 * Spectre Backend API — Cloud Functions endpoints for sentiment, social, markets, and AI analysis.
 * Base: https://us-central1-third-opus-411016.cloudfunctions.net/SearchEngineApiV4
 */

// Dev: Vite proxy forwards /spectre-api → Cloud Function
// Prod: Vercel rewrite forwards /spectre-api → Cloud Function
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'
import {
  getSpectreFearGreedCurrent,
  getSpectrePriceHistory,
  getSpectreSearch,
  getSpectreSocialFeed,
  getSpectreTokenChart,
  getSpectreTokenProfile,
  getSpectreTokenSentiment,
  getSpectreTokenSocial,
} from '@/services/spectreMarketApi'

const BASE = '/spectre-api'

// TTL cache + in-flight dedup. Negative results (null/error) are cached briefly
// so a dead upstream doesn't get re-hit on every render.
const cache = new Map()
const inflight = new Map()
const CACHE_TTL = 5 * 60 * 1000
const NEG_TTL = 60 * 1000

function getCached(key) {
  const entry = cache.get(key)
  if (!entry) return undefined
  const ttl = entry.data == null ? NEG_TTL : CACHE_TTL
  if (Date.now() - entry.ts > ttl) { cache.delete(key); return undefined }
  return entry.data
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() })
}

async function fetchSpectre(path, params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString()
  const url = `${BASE}${path}${qs ? '?' + qs : ''}`
  const cacheKey = url

  const cached = getCached(cacheKey)
  if (cached !== undefined) return cached

  if (inflight.has(cacheKey)) return inflight.get(cacheKey)

  const promise = fetch(url, { signal: AbortSignal.timeout(6000) })
    .then(res => (res.ok ? res.json() : null))
    .catch(() => null)
    .then(data => { setCache(cacheKey, data); return data })
    .finally(() => { inflight.delete(cacheKey) })

  inflight.set(cacheKey, promise)
  return promise
}

// Shared raw X-Dash token fetch. getTokenTweets and getInfluencerTweets pull
// the EXACT same /api/xdash/token/{id} payload and differ only in how they
// filter it — so on every Research Zone load this identical request fired
// twice (once per consumer). Route both through one dedup so the second caller
// reuses the first's in-flight promise / cached response: one network call
// instead of two. Keyed by the cgId candidate; null is cached briefly
// (NEG_TTL) so a miss on one candidate doesn't double-hit across consumers.
/**
 * Last thing the X Dash upstream told us about ITSELF, so an empty feed can say
 * which kind of empty it is. The collector reports `state.status` per token and
 * carries its own fetch errors in `state.coverage.errors` - on 2026-09-02 every
 * token (ethereum, bitcoin, solana, cash-cat, pons) came back
 * `inactive_no_recent` with 0 mentions and `HTTP Error 429: Too Many Requests`
 * in coverage, i.e. the collector was dark, not the token quiet. The panel said
 * "No tweets available for Ethereum yet", which reads as "this token has no
 * tweets" and sent the founder looking for a bug in our app.
 */
let _xdashHealth = { checked: false, collectorDown: false, status: null }
export function getXdashFeedHealth() { return _xdashHealth }

function noteXdashHealth(data) {
  if (!data || typeof data !== 'object') return
  const state = data.state || {}
  const errors = state?.coverage?.errors
  const mentions = Array.isArray(data.mentions) ? data.mentions.length : 0
  _xdashHealth = {
    checked: true,
    // Zero mentions AND the collector reporting its own fetch failures is the
    // signature of an upstream outage. Zero mentions with a clean coverage
    // report is just a quiet token, which is not an error worth shouting about.
    collectorDown: mentions === 0 && Array.isArray(errors) && errors.length > 0,
    status: state.status || null,
  }
}

function fetchXdashTokenRaw(id) {
  const key = `xdash_raw:${id}`
  const cached = getCached(key)
  if (cached !== undefined) return Promise.resolve(cached)
  if (inflight.has(key)) return inflight.get(key)
  const promise = fetch(`/api/xdash/token/${encodeURIComponent(id)}?author_scope=all&per_page=100`, { credentials: 'include',
    signal: AbortSignal.timeout(15000),
  })
    .then(res => (res?.ok ? res.json() : null))
    .catch(() => null)
    .then(data => { noteXdashHealth(data); setCache(key, data); return data })
    .finally(() => { inflight.delete(key) })
  inflight.set(key, promise)
  return promise
}

// ── Sentiment ──────────────────────────────────────────────────────────────

/**
 * Final sentiment score + confidence.
 * Response: { final_sentiment_score: 6.8, confidence_score: 58.4 }
 */
export async function getSentimentScore(symbol) {
  const sentiment = await getSpectreTokenSentiment(symbol).catch(() => null)
  const rawScore = sentiment?.score ?? sentiment?.current?.score ?? null
  if (rawScore != null && Number.isFinite(Number(rawScore))) {
    const n = Number(rawScore)
    const score10 = n > 10 ? n / 10 : n
    const confidence = sentiment?.confidence ?? (n > 10 ? Math.max(0, 100 - Math.abs(50 - n) * 2) : null)
    return {
      final_sentiment_score: Math.round(score10 * 10) / 10,
      confidence_score: confidence,
      source: 'spectre-v1-sentiment',
    }
  }

  const social = await getSpectreTokenSocial(symbol).catch(() => null)
  const score = social?.sentimentScore ?? social?.weightedSentiment
  if (score != null && Number.isFinite(Number(score))) {
    return {
      final_sentiment_score: Number(score),
      confidence_score: social?.confidence ?? social?.confidenceScore ?? null,
      source: 'spectre-market',
    }
  }
  return null
}

/**
 * Fear/greed market sentiment metrics.
 * Response: { score: 8, name: "Extreme Fear", 1d_score, 7d_score, 1m_score, 3m_score, maxScore }
 */
export async function getFearGreed() {
  const current = await getSpectreFearGreedCurrent().catch(() => null)
  if (current) {
    return {
      score: current.value,
      value: current.value,
      name: current.classification,
      classification: current.classification,
      value_classification: current.classification,
      source: 'spectre-market',
    }
  }
  return fetchSpectre('/get_greed')
}

/**
 * Social profile + description for token.
 * Response: { Description, Logo, Social_Media: { twitter, reddit, telegram, website }, coin_id }
 */
export async function getTokenSocial(symbol) {
  const [profile, social, sentiment] = await Promise.all([
    getSpectreTokenProfile(symbol).catch(() => null),
    getSpectreTokenSocial(symbol).catch(() => null),
    getSpectreTokenSentiment(symbol).catch(() => null),
  ])
  if (profile || social || sentiment) {
    const links = profile?.links || {}
    const rawSentimentScore = sentiment?.score ?? social?.sentimentScore ?? null
    const sentimentScore = rawSentimentScore != null && Number.isFinite(Number(rawSentimentScore))
      ? (Number(rawSentimentScore) > 10 ? Number(rawSentimentScore) / 10 : Number(rawSentimentScore))
      : null
    return {
      Description: profile?.description || null,
      Logo: profile?.image || profile?.image_small || null,
      Social_Media: {
        twitter: links.twitter || links.x || null,
        reddit: links.reddit || null,
        telegram: links.telegram || null,
        website: links.homepage || links.website || null,
      },
      coin_id: profile?.coingecko_id || null,
      socialVolumeTotal: social?.socialVolumeTotal ?? null,
      sentimentScore,
      weightedSentiment: sentimentScore,
      sentimentLabel: sentiment?.label || social?.sentimentLabel || null,
      twitterFollowers: social?.twitterFollowers ?? null,
      redditSubscribers: social?.redditSubscribers ?? null,
      source: 'spectre-v1-social',
    }
  }
  return fetchSpectre('/get_social', { query: symbol })
}

/**
 * Price + sentiment time series (30 days).
 * Response: [{ Date, Price, "Sentiment Score" }, ...]
 */
export async function getSentimentPlotData(symbol) {
  const [historyRows, sentiment] = await Promise.all([
    getSpectrePriceHistory(symbol, { days: 90 }).catch(() => []),
    getSpectreTokenSentiment(symbol).catch(() => null),
  ])
  const sentimentByDay = new Map(
    (Array.isArray(sentiment?.history) ? sentiment.history : [])
      .map((row) => {
        const day = String(row.time || row.date || row.timestamp || '').slice(0, 10)
        const score = Number(row.score)
        return day && Number.isFinite(score) ? [day, score > 10 ? score / 10 : score] : null
      })
      .filter(Boolean)
  )

  if (historyRows.length) {
    return historyRows.map((row) => ({
      Date: row.time || '',
      Price: row.price ?? null,
      'Sentiment Score': sentimentByDay.get(String(row.time || '').slice(0, 10)) ?? null,
      source: 'spectre-v1-history-sentiment',
    }))
  }

  if (sentimentByDay.size) {
    return [...sentimentByDay.entries()].map(([day, score]) => ({
      Date: day,
      Price: null,
      'Sentiment Score': score,
      source: 'spectre-v1-sentiment',
    }))
  }

  const rows = await getSpectreTokenChart(symbol, { interval: '1d', limit: 90 }).catch(() => [])
  if (rows.length) {
    return rows.map((row) => ({
      Date: row.time || row.date,
      Price: row.close ?? row.price ?? row.value ?? null,
      'Sentiment Score': null,
      source: 'spectre-market-chart',
    }))
  }
  return fetchSpectre('/plot_data', { query: symbol })
}

// ── Tweets ─────────────────────────────────────────────────────────────────

/**
 * Real-time tweet/proof search for a token.
 * Keep the legacy tweet search as the primary Research Zone source because it
 * returns tweet-shaped proof. Spectre/XDash are fallback-only until the backend
 * exposes a filtered social-proof endpoint for this surface.
 */
export async function getTokenTweets(symbol, options = {}) {
  const cacheKey = `search_tweets:${symbol}:${options?.cgId || options?.name || ''}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const normalizeMedia = (tweet = {}, item = {}) => {
    const media = tweet.media || tweet.media_entities || tweet.extended_entities?.media || item?.media || []
    const first = Array.isArray(media) ? media[0] : null
    return {
      media: Array.isArray(media) ? media : [],
      media_url_https: tweet.media_url_https || item?.media_url_https || first?.media_url_https || first?.url || null,
      media_type: tweet.media_type || item?.media_type || first?.type || null,
    }
  }

  const normalizeSocialFeedRows = (rows = []) => rows
    .map((item, index) => {
      const tweet = item?.tweet || item?.post || item || {}
      const author = item?.author || item?.user || item?.account || {}
      const tweetId = tweet.tweet_id || tweet.id || item?.id || `spectre-social-${index}`
      const media = normalizeMedia(tweet, item)
      const username =
        author.screen_name ||
        author.username ||
        item?.author_screen_name ||
        item?.username ||
        author.name ||
        'unknown'
      const text =
        tweet.full_text ||
        tweet.text ||
        item?.full_text ||
        item?.text ||
        item?.content ||
        ''

      return {
        tweet_id: tweetId,
        username,
        tweet_text: text,
        tweet_url:
          tweet.x_url ||
          item?.x_url ||
          item?.url ||
          (tweetId && username ? `https://x.com/${username}/status/${tweetId}` : null),
        date: tweet.created_at_utc || tweet.created_at || item?.created_at || item?.published_at || '',
        ProfilePic: author.avatar_image_url || author.profile_image_url || item?.avatar || null,
        followers: author.followers_count || item?.followers_count || 0,
        like_count: tweet.favorite_count || item?.favorite_count || item?.likes || 0,
        retweet_count: tweet.retweet_count || item?.retweet_count || item?.retweets || 0,
        comments: tweet.reply_count || item?.reply_count || item?.replies || 0,
        views: tweet.views_count || item?.views_count || item?.views || 0,
        media: media.media,
        media_url_https: media.media_url_https,
        media_type: media.media_type,
        _source: 'spectre-social-feed',
      }
    })
    .filter((item) => item.tweet_text || item.tweet_url)

  const fetchLegacyTweetSearch = async () => {
    const query = `$${String(symbol || '').replace(/^\$/, '')}`
    const urls = import.meta.env.DEV
      ? [
          `/tweets-api/api/tweets/search?query=${encodeURIComponent(query)}`,
          `/api/tweets/search?query=${encodeURIComponent(query)}`,
        ]
      : [
          `/api/tweets/search?query=${encodeURIComponent(query)}`,
          `/tweets-api/api/tweets/search?query=${encodeURIComponent(query)}`,
        ]
    for (const url of urls) {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) }).catch(() => null)
      if (!res?.ok) continue
      const data = await res.json().catch(() => null)
      const tweets = Array.isArray(data) ? data : data?.tweets || data?.data || []
      if (Array.isArray(tweets) && tweets.length) return tweets
    }
    return null
  }

  // Two layers of relevance filtering work together below:
  //
  // 1. STRONG_SIGNALS — the matched_by metadata X-Dash attaches to each
  //    mention. Tweets that hit cashtag / ticker / name / official / self /
  //    high_conviction signals are kept; ones that only hit 'handle'
  //    (someone @-mentioning the project as a sidekick) get dropped.
  //
  // 2. Text-content check — even when matched_by looks strong, X-Dash can
  //    return mentions for *related* tokens (we observed @WrappedBTC posts
  //    surfacing for "bitcoin" because matched_by:['cashtag'] doesn't say
  //    WHICH cashtag matched). Verify the tweet body actually mentions
  //    THIS token's symbol/name with word-boundary regexes, otherwise drop.
  const STRONG_SIGNALS = new Set([
    'cashtag', 'ticker', 'name', 'text', 'query', 'official', 'self', 'high_conviction',
  ])
  const upperSym = String(symbol || '').replace(/^\$/, '').toUpperCase()
  const tokenName = String(options?.name || '').trim()
  // Word-boundary regexes prevent "$WBTC" from matching "$BTC".
  const cashtagRe = upperSym
    ? new RegExp(`(?:^|[^A-Za-z0-9_])\\$${upperSym}(?![A-Za-z0-9_])`, 'i')
    : null
  const symbolWordRe = upperSym
    ? new RegExp(`(?:^|[^A-Za-z0-9_])${upperSym}(?![A-Za-z0-9_])`, 'i')
    : null
  const nameRe = tokenName && tokenName.length >= 3
    ? new RegExp(`\\b${tokenName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    : null

  const isUsefulXDashProof = (item) => {
    const text = String(item?.tweet?.full_text || '').trim()
    if (!text) return false
    if (/^RT\s+@/i.test(text)) return false

    // Multi-token shilling: 3+ cashtags AND 2+ @-mentions is almost always a
    // pump farm tagging unrelated projects to boost reach.
    const cashtagCount = (text.match(/\$[A-Z][A-Z0-9]{1,10}\b/gi) || []).length
    const mentionCount = (text.match(/@[A-Za-z0-9_]+/g) || []).length
    if (cashtagCount >= 3 && mentionCount >= 2) return false

    const matchedBy = Array.isArray(item?.match?.matched_by)
      ? item.match.matched_by.map((value) => String(value).toLowerCase())
      : []
    // Replies require a strong topical signal — '@<project> nice!' with no
    // cashtag/ticker/name match is noise, '@<project> great roadmap …' that
    // also hits a cashtag is a real reply.
    const isReply = /^@/.test(text)
    if (isReply) {
      const hasStrong = matchedBy.some((value) => STRONG_SIGNALS.has(value))
      if (!hasStrong) return false
    } else if (matchedBy.length) {
      // Non-reply text: require a strong signal when matched_by is populated.
      // 'handle' alone means "they tagged @Bitcoin" — primary spam vector.
      const hasStrong = matchedBy.some((value) => STRONG_SIGNALS.has(value))
      if (!hasStrong) return false
    }

    // Require the text to actually mention THIS token. Skip the check if we
    // have no symbol to verify against (defensive — should never happen).
    if (upperSym) {
      const mentionsCashtag = cashtagRe && cashtagRe.test(text)
      const mentionsName = nameRe && nameRe.test(text)
      const mentionsBareSymbol = symbolWordRe && symbolWordRe.test(text)
      if (!mentionsCashtag && !mentionsName && !mentionsBareSymbol) return false

      // Multi-cashtag spam filter: tweets that tag many tickers and bury
      // ours at the end are spam (e.g. "$FF smash $.1 … $FFUSDT … $btc
      // @bitcoin"). If the tweet has 3+ distinct cashtags AND our symbol
      // isn't the first one mentioned, drop it.
      const cashtags = (text.match(/\$[A-Za-z]{2,10}\b/g) || [])
        .map(c => c.slice(1).toUpperCase())
      const distinctCashtags = [...new Set(cashtags)]
      if (distinctCashtags.length >= 3) {
        const firstIdx = distinctCashtags.indexOf(upperSym)
        if (firstIdx > 0) return false
      }
    }

    return true
  }

  const fallbackToXDash = async () => {
    const upper = String(symbol || '').replace(/^\$/, '').toUpperCase()
    const candidates = [
      options?.cgId,
      SYMBOL_TO_COINGECKO_ID[upper],
    ].filter(Boolean)

    if (!options?.cgId) {
      const search = await getSpectreSearch(options?.name || symbol, 8).catch(() => null)
      const exact = (search?.coins || []).find((coin) =>
        String(coin.symbol || '').toUpperCase() === upper ||
        String(coin.name || '').toLowerCase() === String(options?.name || symbol || '').toLowerCase()
      )
      if (exact?.coingecko_id) candidates.push(exact.coingecko_id)
    }

    // The bare lowercased SYMBOL is a last resort, not a candidate to try after
    // the canonical id. Two reasons it must be skipped once we know the real id:
    //
    //   cost   for BTC we already resolve `bitcoin`; asking for `btc` afterwards
    //          measured 5-6s and came back with an empty shell (0 mentions, 0
    //          authors) on every Research Zone load
    //   safety a symbol is not project-unique. `dot` as a CoinGecko id is not
    //          necessarily the DOT this page is about — the same collision class
    //          that put Polkadot's data on a Base token called $DOT
    //
    // With no canonical id at all it is still a reasonable guess, so it stays
    // for genuinely unknown tokens.
    if (!candidates.length) candidates.push(upper.toLowerCase())

    const uniqueCandidates = [...new Set(candidates)]
    for (const cgId of uniqueCandidates) {
      const data = await fetchXdashTokenRaw(cgId)
      if (!data) continue

      const mentions = [
        ...(Array.isArray(data?.mentions) ? data.mentions : []),
        ...(Array.isArray(data?.top_mentions) ? data.top_mentions : []),
      ]
      const seen = new Set()
      const rows = mentions
        .filter((item) =>
          item?.tweet?.tweet_id &&
          isUsefulXDashProof(item) &&
          !seen.has(item.tweet.tweet_id) &&
          seen.add(item.tweet.tweet_id)
        )
        .sort((a, b) => new Date(b.tweet?.created_at_utc || 0) - new Date(a.tweet?.created_at_utc || 0))
        .map((item) => {
          const media = normalizeMedia(item.tweet, item)
          const author = item.author || {}
          return {
            tweet_id: item.tweet.tweet_id,
            username: author.screen_name || author.name || 'unknown',
            name: author.name || author.screen_name || 'Unknown',
            tweet_text: item.tweet.full_text || '',
            tweet_url: item.tweet.x_url || null,
            date: item.tweet.created_at_utc || '',
            ProfilePic: author.avatar_image_url || null,
            followers: author.followers_count || 0,
            // Quality flags used by the panel's KOL classifier. The previous
            // `followers >= 10000` heuristic let pump-farm accounts with bot
            // followings pass; these flags come straight from X-Dash and are
            // a better proxy for "this person actually matters".
            is_verified: !!(author.is_blue_verified || author.legacy_verified),
            has_dossier: !!author.has_dossier,
            listed_count: author.listed_count || 0,
            like_count: item.tweet.favorite_count || 0,
            retweet_count: item.tweet.retweet_count || 0,
            comments: item.tweet.reply_count || 0,
            views: item.tweet.views_count || 0,
            media: media.media,
            media_url_https: media.media_url_https,
            media_type: media.media_type,
            matched_terms: item.match?.matched_terms || [],
            matched_by: item.match?.matched_by || [],
            _source: 'xdash-token-proof-filtered',
          }
        })
      if (rows.length) return rows
    }

    return null
  }

  // Reject rows missing both an author handle and a profile image — those
  // came from the dead /tweets-api/search_tweets endpoint and rendered as
  // "Unknown @unknown" with no avatar. Real X-Dash and social-feed rows
  // have at minimum a screen_name.
  const hasRealAuthor = (row) => {
    const u = String(row?.username || '').trim().toLowerCase()
    if (u && u !== 'unknown') return true
    return !!row?.ProfilePic
  }

  // Mirror the X-Dash relevance check for the social-feed path. The Spectre
  // social-feed endpoint also tags spam tweets (multi-cashtag posts with our
  // token buried at the end) as relevant to this token; reject them on the
  // client so they don't surface as "Bitcoin posts" when the body is about
  // some other ticker.
  const isRelevantSocialRow = (row) => {
    const text = String(row?.tweet_text || '').trim()
    if (!text) return false
    if (!upperSym) return true
    const mentionsCashtag = cashtagRe && cashtagRe.test(text)
    const mentionsName = nameRe && nameRe.test(text)
    const mentionsBareSymbol = symbolWordRe && symbolWordRe.test(text)
    if (!mentionsCashtag && !mentionsName && !mentionsBareSymbol) return false
    const distinctCashtags = [...new Set(
      (text.match(/\$[A-Za-z]{2,10}\b/g) || []).map(c => c.slice(1).toUpperCase())
    )]
    if (distinctCashtags.length >= 3) {
      const firstIdx = distinctCashtags.indexOf(upperSym)
      if (firstIdx > 0) return false
    }
    return true
  }

  try {
    // X-Dash is the live source per data rule. Try it FIRST.
    const proofRows = await fallbackToXDash().catch(() => null)
    const usefulProof = (proofRows || []).filter(hasRealAuthor)
    if (usefulProof.length) {
      setCache(cacheKey, usefulProof)
      return usefulProof
    }

    const socialPayload = await getSpectreSocialFeed(symbol, { limit: 50 }).catch(() => null)
    const socialRows = normalizeSocialFeedRows(socialPayload?.data)
      .filter(hasRealAuthor)
      .filter(isRelevantSocialRow)
    if (socialRows.length) {
      setCache(cacheKey, socialRows)
      return socialRows
    }

    // Legacy /tweets-api/search_tweets is documented dead in memory, but keep
    // as last-resort in case the prod env still has it wired. Filter junk
    // placeholder rows.
    const legacyRows = await fetchLegacyTweetSearch()
    const usefulLegacy = (legacyRows || []).filter(hasRealAuthor).filter(isRelevantSocialRow)
    if (usefulLegacy.length) {
      setCache(cacheKey, usefulLegacy)
      return usefulLegacy
    }
    return []
  } catch (err) {
    return []
  }
}

// ── Shared relevance helpers (used by getInfluencerTweets + getSocialFeedTweets) ──
//
// Same filtering logic getTokenTweets has applied inline — extracted so the
// two new helpers below don't drift. Each helper still does its OWN fetch from
// ONE source, so the two surfaces (Influencer Tweets vs Social) get different
// content instead of two sorts of the same array.
function buildRelevance(symbol, name) {
  const upperSym = String(symbol || '').replace(/^\$/, '').toUpperCase()
  const tokenName = String(name || '').trim()
  const cashtagRe = upperSym
    ? new RegExp(`(?:^|[^A-Za-z0-9_])\\$${upperSym}(?![A-Za-z0-9_])`, 'i')
    : null
  const symbolWordRe = upperSym
    ? new RegExp(`(?:^|[^A-Za-z0-9_])${upperSym}(?![A-Za-z0-9_])`, 'i')
    : null
  const nameRe = tokenName && tokenName.length >= 3
    ? new RegExp(`\\b${tokenName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    : null
  return (text) => {
    if (!text) return false
    if (!upperSym) return true
    const t = String(text)
    const hit = (cashtagRe && cashtagRe.test(t)) || (nameRe && nameRe.test(t)) || (symbolWordRe && symbolWordRe.test(t))
    if (!hit) return false
    // Multi-cashtag spam guard — buried symbol = drop.
    const distinct = [...new Set((t.match(/\$[A-Za-z]{2,10}\b/g) || []).map(c => c.slice(1).toUpperCase()))]
    if (distinct.length >= 3 && distinct.indexOf(upperSym) > 0) return false
    return true
  }
}

/**
 * Influencer tweets — KOL voices only, X-Dash carrier roster.
 *
 * Source: /api/xdash/token/{cgId}?author_scope=all&per_page=100
 * Filter: author.followers_count >= 50K  OR  is_verified
 * Sort:   engagement (likes + 2*retweets + 0.01*views) desc
 * Cap:    top 12
 *
 * Returns [] when xdash has nothing for this token (no fallback — Social
 * section already covers the "everyone talking about X" need).
 */
export async function getInfluencerTweets(symbol, { cgId = null, name = null, minFollowers = 50000, limit = 12 } = {}) {
  const upper = String(symbol || '').replace(/^\$/, '').toUpperCase()
  const cacheKey = `influencer_tweets:${upper}:${cgId || ''}`
  const cached = getCached(cacheKey)
  if (cached !== undefined) return cached

  // Resolve cgId if missing (mirror getTokenTweets fallback).
  const candidates = [cgId, SYMBOL_TO_COINGECKO_ID[upper]].filter(Boolean)
  if (!cgId) {
    const search = await getSpectreSearch(name || symbol, 8).catch(() => null)
    const exact = (search?.coins || []).find((coin) =>
      String(coin.symbol || '').toUpperCase() === upper ||
      String(coin.name || '').toLowerCase() === String(name || symbol || '').toLowerCase()
    )
    if (exact?.coingecko_id) candidates.push(exact.coingecko_id)
  }
  candidates.push(upper.toLowerCase())
  const uniq = [...new Set(candidates)]

  const isRelevant = buildRelevance(symbol, name)

  try {
    for (const id of uniq) {
      const data = await fetchXdashTokenRaw(id)
      if (!data) continue

      const mentions = [
        ...(Array.isArray(data?.mentions) ? data.mentions : []),
        ...(Array.isArray(data?.top_mentions) ? data.top_mentions : []),
      ]
      const seen = new Set()
      const rows = []
      for (const item of mentions) {
        const tw = item?.tweet
        const author = item?.author || {}
        if (!tw?.tweet_id || seen.has(tw.tweet_id)) continue
        const text = String(tw.full_text || '').trim()
        if (!text || /^(RT\s+@|@)/i.test(text)) continue
        if (!isRelevant(text)) continue
        const followers = Number(author.followers_count || 0)
        const verified = Boolean(author.is_verified || author.verified)
        if (followers < minFollowers && !verified) continue
        seen.add(tw.tweet_id)
        const likes = Number(tw.favorite_count || 0)
        const rts = Number(tw.retweet_count || 0)
        const views = Number(tw.views_count || 0)
        rows.push({
          tweet_id: tw.tweet_id,
          username: author.screen_name || author.name || 'unknown',
          name: author.name || author.screen_name || 'Unknown',
          tweet_text: text,
          tweet_url: tw.x_url || (author.screen_name && tw.tweet_id ? `https://x.com/${author.screen_name}/status/${tw.tweet_id}` : null),
          date: tw.created_at_utc || tw.created_at || '',
          ProfilePic: author.avatar_image_url || author.profile_image_url || null,
          followers,
          is_verified: verified,
          like_count: likes,
          retweet_count: rts,
          comments: Number(tw.reply_count || 0),
          views,
          media: Array.isArray(tw.media) ? tw.media : [],
          media_url_https: tw.media_url_https || null,
          media_type: tw.media_type || null,
          _engagement: likes + rts * 2 + views * 0.01,
          _source: 'xdash-influencer',
        })
      }
      if (rows.length) {
        rows.sort((a, b) => b._engagement - a._engagement)
        const out = rows.slice(0, limit)
        setCache(cacheKey, out)
        return out
      }
    }
    setCache(cacheKey, [])
    return []
  } catch {
    return []
  }
}

/**
 * Social feed — chronological live stream of all mentions, no follower gate.
 *
 * Source: getSpectreSocialFeed(symbol, { limit })
 *         /data-api/v1/social/feed/{symbol}
 * Sort:   recency (newest first)
 * Cap:    up to `limit` (default 20)
 *
 * No xdash, no legacy search — that's what makes this different from
 * Influencer Tweets. Same relevance + spam guard as getTokenTweets.
 */
export async function getSocialFeedTweets(symbol, { name = null, limit = 20 } = {}) {
  const upper = String(symbol || '').replace(/^\$/, '').toUpperCase()
  const cacheKey = `social_feed_tweets:${upper}`
  const cached = getCached(cacheKey)
  if (cached !== undefined) return cached

  const isRelevant = buildRelevance(symbol, name)

  try {
    const payload = await getSpectreSocialFeed(symbol, { limit: Math.max(50, limit * 2), minFollowers: 0 }).catch(() => null)
    const list = Array.isArray(payload?.data) ? payload.data : []
    const seen = new Set()
    const rows = []
    for (const row of list) {
      const id = row?.tweet_id || row?.tweet?.tweet_id || row?.id
      if (!id || seen.has(id)) continue
      const text = String(row?.text || row?.tweet?.full_text || row?.tweet_text || '').trim()
      if (!text || !isRelevant(text)) continue
      const handle = String(row.author_handle || row.username || '').replace(/^@/, '').toLowerCase()
      if (!handle || handle === 'unknown') {
        // Mirror hasRealAuthor — require either real handle or an avatar.
        if (!row.author_avatar && !row.ProfilePic) continue
      }
      seen.add(id)
      const tsRaw = row.timestamp || row.created_at || row.tweet?.created_at_utc || ''
      const ts = tsRaw ? (new Date(tsRaw).getTime() || 0) : 0
      rows.push({
        tweet_id: id,
        username: handle || row.author || 'unknown',
        name: row.author || handle || 'Unknown',
        tweet_text: text,
        tweet_url: row.tweet_url || (handle && id ? `https://x.com/${handle}/status/${id}` : null),
        date: tsRaw,
        ProfilePic: (row.author_avatar || row.ProfilePic || '').replace('_normal', '_bigger') || null,
        followers: Number(row.author_followers || 0),
        is_verified: !!row.author_verified,
        like_count: Number(row.likes || row.favorite_count || 0),
        retweet_count: Number(row.retweets || row.retweet_count || 0),
        comments: Number(row.replies || row.reply_count || 0),
        views: Number(row.views || row.views_count || 0),
        media: Array.isArray(row.media) ? row.media : [],
        media_url_https: row.media_url_https || null,
        media_type: row.media_type || null,
        _ts: ts,
        _source: 'spectre-social-feed',
      })
    }
    rows.sort((a, b) => b._ts - a._ts)
    const out = rows.slice(0, limit)
    setCache(cacheKey, out)
    return out
  } catch {
    return []
  }
}

/**
 * Official tweets from a specific Twitter user.
 * Uses same endpoint as trading app: /api/tweets/official
 * Dev: proxied via Vite /api → Express server
 * Prod: Vercel serverless function api/tweets-official.js
 */
export async function getOfficialTweets(username, { force = false } = {}) {
  const cacheKey = `official_tweets:${username}`
  if (!force) {
    const cached = getCached(cacheKey)
    if (cached) return cached
  }

  try {
    const urls = [
      `/api/tweets/official?username=${encodeURIComponent(username)}`,
      `/tweets-api/api/tweets/official?username=${encodeURIComponent(username)}`,
    ]
    for (const url of urls) {
      const res = await fetch(url, {
        // The same-origin /api/tweets/official proxy is gated (checks the auth
        // cookie). On the iOS PWA the cookie is dropped from a default
        // same-origin fetch, so it 401s and every consumer (e.g. the ZIGChain
        // breaking banner) falls back to stale/curated content. Attach the
        // cookie for our own /api route only — the cross-origin /tweets-api
        // fallback is public and would fail CORS with credentials:'include'.
        credentials: url.startsWith('/api/') ? 'include' : 'same-origin',
        signal: AbortSignal.timeout(15000),
        cache: force ? 'no-store' : 'default',
      }).catch(() => null)
      if (!res?.ok) continue
      const data = await res.json().catch(() => null)
      if (data?.tweets?.length) {
        setCache(cacheKey, data)
        return data
      }
    }
    return null
  } catch (err) {
    return null
  }
}

/**
 * Normalize official tweet from the /get_official_tweets endpoint.
 */
export function normalizeOfficialTweet(raw, idx) {
  // Accept both the legacy flat shape ({ tweet_id, username, likes, retweets, ... })
  // and the current shape from /api/tweets/official ({ id, text, created_at,
  // url, metrics: { likes, retweets, replies, views } }). The current shape
  // doesn't carry the author handle directly — derive it from the URL host
  // path: https://x.com/<handle>/status/<id>.
  const id = raw.tweet_id || raw.id || idx
  const url = raw.tweet_url || raw.url || (raw.tweet_id && raw.username ? `https://x.com/${raw.username}/status/${raw.tweet_id}` : null)
  const urlHandle = url ? (url.match(/(?:x|twitter)\.com\/([^/?#]+)\/status\//i) || [])[1] : null
  const handle = raw.username || raw.screen_name || raw.author_screen_name || urlHandle || null
  const text = raw.tweet_text || raw.text || raw.full_text || ''
  const metrics = raw.metrics || {}
  const likes = raw.likes ?? raw.like_count ?? raw.favorite_count ?? metrics.likes ?? metrics.like_count ?? metrics.favorite_count ?? 0
  const retweets = raw.retweets ?? raw.retweet_count ?? metrics.retweets ?? metrics.retweet_count ?? 0
  const comments = raw.comments ?? raw.reply_count ?? metrics.replies ?? metrics.reply_count ?? metrics.comments ?? 0
  const viewsRaw = raw.views ?? raw.views_count ?? metrics.views ?? metrics.views_count ?? 0
  const views = typeof viewsRaw === 'string' ? parseInt(viewsRaw.replace(/,/g, ''), 10) || 0 : (Number(viewsRaw) || 0)
  const avatarRaw = raw.ProfilePic || raw.profile_image || raw.avatar || raw.avatar_image_url
  return {
    id,
    handle: handle ? `@${handle}` : '',
    name: raw.name || raw.author_name || handle || 'Unknown',
    avatar: avatarRaw
      ? String(avatarRaw).replace('_normal.', '_bigger.')
      : (handle ? `https://unavatar.io/twitter/${handle}` : `https://api.dicebear.com/7.x/identicon/svg?seed=${id}`),
    text,
    content: text,
    time: humanizeTweetTime(raw.date || raw.created_at),
    createdAt: raw.created_at || raw.date || '',
    ts: (() => { const t = Date.parse(raw.created_at || raw.date || ''); return Number.isFinite(t) ? t : 0 })(),
    url,
    followers: raw.followers ?? raw.followers_count ?? 0,
    likes,
    retweets,
    comments,
    views,
    media: raw.media || [],
    mediaUrl: raw.media_url_https || null,
    mediaType: raw.media_type || null,
  }
}

// ── Market Details ─────────────────────────────────────────────────────────

/**
 * Market/exchange details for a token.
 * Response: [{ name, id_cg, symbol, price, market_cap, total_volume, sparkline, ... }]
 */
export async function getTokenMarketDetails(symbol) {
  const profile = await getSpectreTokenProfile(symbol).catch(() => null)
  if (profile) {
    return [{
      name: profile.name || symbol,
      id_cg: profile.coingecko_id || null,
      symbol: profile.symbol || symbol,
      price: profile.price?.usd ?? null,
      market_cap: profile.market?.market_cap ?? null,
      total_volume: profile.market?.volume_24h ?? null,
      daily_volume: profile.market?.volume_24h ?? null,
      market_cap_rank: profile.rank ?? null,
      ath: profile.price?.ath?.price ?? profile.price?.ath ?? null,
      ath_date: profile.price?.ath?.date ?? profile.price?.ath_date ?? null,
      ath_change_percentage: profile.price?.ath?.change_pct ?? profile.price?.ath_change_pct ?? null,
      price_change_percentage_24h: profile.price?.change_24h ?? null,
      price_change_percentage_7d_in_currency: profile.price?.change_7d ?? null,
      price_change_percentage_30d_in_currency: profile.price?.change_30d ?? null,
      price_change_percentage_1h_in_currency: profile.price?.change_1h ?? null,
      sparkline: { price: Array.isArray(profile.history?.price_90d) ? profile.history.price_90d.map((point) => point.price ?? point.close ?? point.value).filter((v) => v != null) : [] },
      image: profile.image || profile.image_small || null,
      source: 'spectre-market',
    }]
  }
  return fetchSpectre('/get_market_details_coin_ticker', { query: symbol })
}

// ── Helpers to normalize API responses to component formats ────────────────

/**
 * Normalize tweet from API to RZ Pro tweet format.
 */
// Short relative age for the tweet row ("now", "5m", "2h", "3d"). Falls back
// to the raw string when the date can't be parsed (some legacy sources send a
// pre-humanized label).
export function humanizeTweetTime(raw) {
  const ts = raw ? Date.parse(raw) : NaN
  if (!Number.isFinite(ts)) return raw || ''
  const diff = Date.now() - ts
  if (diff < 60_000) return 'now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d`
  return `${Math.floor(d / 30)}mo`
}

export function normalizeTweet(raw, idx) {
  const media = raw.media || raw.media_entities || []
  const firstMedia = Array.isArray(media) ? media[0] : null
  const username = raw.username || raw.screen_name || raw.author_screen_name || 'unknown'
  const tsParsed = raw.date ? Date.parse(raw.date) : NaN
  return {
    id: raw.tweet_id || idx,
    handle: `@${username}`,
    name: raw.name || raw.author_name || username || 'Unknown',
    avatar: raw.ProfilePic || raw.profile_image || raw.avatar || `https://api.dicebear.com/7.x/identicon/svg?seed=${username}`,
    text: raw.tweet_text || '',
    content: raw.tweet_text || '',
    sentimentScore: null,
    time: humanizeTweetTime(raw.date),
    date: raw.date || '',
    // Epoch ms for recency sorting ("Latest" in the feed panel). 0 = undated,
    // which sinks undated rows to the bottom of a latest-first sort.
    ts: Number.isFinite(tsParsed) ? tsParsed : 0,
    url: raw.tweet_url || null,
    followers: raw.followers || 0,
    likes: raw.like_count || 0,
    retweets: raw.retweet_count || 0,
    comments: raw.comments || raw.reply_count || 0,
    views: raw.views || 0,
    media: Array.isArray(media) ? media : [],
    mediaUrl: raw.media_url_https || firstMedia?.media_url_https || firstMedia?.url || null,
    mediaType: raw.media_type || firstMedia?.type || null,
    matchedTerms: raw.matched_terms || [],
    matchedBy: raw.matched_by || [],
    is_verified: !!raw.is_verified,
    has_dossier: !!raw.has_dossier,
    listed_count: raw.listed_count || 0,
    // Surface the underlying engagement counts too — the feed panel reads
    // `like_count` and `views` directly when classifying community vs KOL.
    like_count: raw.like_count || 0,
    retweet_count: raw.retweet_count || 0,
    source: raw._source || null,
  }
}

/**
 * Normalize sentiment score API to RZ Pro format.
 */
export function normalizeSentimentScore(raw) {
  if (!raw) return null
  return {
    overall: Math.round((raw.final_sentiment_score || 0) * 10) / 10,
    confidence: Math.round((raw.confidence_score || 0) * 10) / 10,
  }
}

/**
 * Normalize plot data to RZ Pro sentiment chart format.
 * Input: [{ Date, Price, "Sentiment Score" }]
 * Output: { dates[], prices[], sentiments[] }
 */
export function normalizePlotData(raw) {
  if (!Array.isArray(raw) || !raw.length) return null
  const dates = []
  const prices = []
  const sentiments = []
  for (const pt of raw) {
    dates.push(pt.Date || '')
    prices.push(pt.Price || 0)
    sentiments.push(pt['Sentiment Score'] ?? null)
  }
  return { dates, prices, sentiments }
}

/**
 * Normalize market details to exchange name list.
 * Input: [{ name, total_volume, ... }] - there's only 1 item for the queried token
 * The API returns the token's market data, not exchange tickers.
 * We extract exchange info from the sparkline/market data.
 */
export function normalizeMarketDetails(raw) {
  if (!Array.isArray(raw) || !raw.length) return null
  const item = raw[0]
  if (!item) return null
  return {
    name: item.name,
    cgId: item.id_cg,
    price: item.price,
    marketCap: item.market_cap,
    volume: item.total_volume || item.daily_volume,
    rank: item.market_cap_rank,
    ath: item.ath,
    athDate: item.ath_date,
    athChange: item.ath_change_percentage,
    change24h: item.price_change_percentage_24h,
    change7d: item.price_change_percentage_7d_in_currency,
    change30d: item.price_change_percentage_30d_in_currency,
    change1h: item.price_change_percentage_1h_in_currency,
    sparkline: item.sparkline?.price || [],
    image: item.image,
  }
}
