import { useState, useEffect, useRef } from 'react'
import * as mediaApi from '@/services/mediaApi'
import { getCryptoNews, getRssMarketNews } from '@/services/cryptoNewsApi'
import { getSpectrePricesBySymbols } from '@/services/spectreMarketApi'

const FETCH_TIMEOUT = 15000
const BOOTSTRAP_CACHE_TTL = 60000
const TOKEN_CACHE_TTL = 30000
const MEDIA_CACHE_TTL = 300000 // 5min for videos

const _cache = {}
const _inflight = {}

function _getCached(key, ttlMs) {
  const entry = _cache[key]
  if (!entry) return null
  if (Date.now() - entry.ts > ttlMs) { delete _cache[key]; return null }
  return entry.data
}

function _setCached(key, data) {
  _cache[key] = { data, ts: Date.now() }
}

async function _deduped(key, ttlMs, fetchFn) {
  const cached = _getCached(key, ttlMs)
  if (cached) return cached
  if (_inflight[key]) return _inflight[key]
  const promise = fetchFn()
    .then(data => { _setCached(key, data); return data })
    .finally(() => { delete _inflight[key] })
  _inflight[key] = promise
  return promise
}

function fetchBootstrap() {
  return _deduped('pulse-bootstrap', BOOTSTRAP_CACHE_TTL, async () => {
    const qs = new URLSearchParams({
      page: '1', per_page: '15', timeframe: '24h',
      ranking: 'mentions', segment: 'all', market: 'all', min_kols: '1',
    })
    const res = await fetch(`/api/xdash/bootstrap?${qs}`, { credentials: 'include',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
    if (!res.ok) return null
    return res.json()
  })
}

function fetchTokenDetail(cgId) {
  return _deduped(`pulse-token-${cgId}`, TOKEN_CACHE_TTL, async () => {
    const res = await fetch(`/api/xdash/token/${encodeURIComponent(cgId)}`, { credentials: 'include',
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
    if (!res.ok) return null
    return res.json()
  })
}

const fmtNum = (n) => {
  if (n == null) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

const fmtMcap = (n) => {
  if (n == null) return '-'
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(1) + 'T'
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(0) + 'M'
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'k'
  return '$' + String(n)
}

const mediaStyles = [
  { gradient: 'linear-gradient(135deg, #0a0818 0%, #1a0e2e 50%, #0c0818 100%)', accent: '#8B5CF6' },
  { gradient: 'linear-gradient(135deg, #0a1628 0%, #0d2137 50%, #091a2a 100%)', accent: '#10B981' },
  { gradient: 'linear-gradient(135deg, #1a1005 0%, #2a1a08 50%, #141005 100%)', accent: '#F7931A' },
  { gradient: 'linear-gradient(135deg, #1a0818 0%, #2a0e28 50%, #140614 100%)', accent: '#EC4899' },
  { gradient: 'linear-gradient(135deg, #08101a 0%, #0e1828 50%, #060c14 100%)', accent: '#3B82F6' },
  { gradient: 'linear-gradient(135deg, #081a10 0%, #0a2818 50%, #061208 100%)', accent: '#14F195' },
  { gradient: 'linear-gradient(135deg, #1a1408 0%, #2a1e0a 50%, #141005 100%)', accent: '#F59E0B' },
  { gradient: 'linear-gradient(135deg, #0a0a1e 0%, #1a0a2e 50%, #0c0c1a 100%)', accent: '#6366F1' },
]

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function tierFromFollowers(count) {
  if (count >= 100000) return 'S'
  if (count >= 50000) return 'A'
  if (count >= 10000) return 'B'
  return 'C'
}

// Filter out sports/non-crypto tokens from bootstrap data
const SPORTS_KEYWORDS = /football|soccer|fc |atletico|galatasaray|trabzon|fenerbahce|besiktas|juventus|barcelona|madrid|chelsea|liverpool|arsenal|manchester|bayern|dortmund|paris|milan|inter|napoli|roma|lazio|porto|benfica|sporting|ajax|psv|feyenoord/i
function isCryptoToken(item) {
  const t = item.token || item
  const name = (t.name || '').toLowerCase()
  const cat = (t.primary_category || t.segment || '').toLowerCase()
  // Skip fan tokens / sports
  if (SPORTS_KEYWORDS.test(name)) return false
  if (cat.includes('fan token') || cat.includes('sport')) return false
  return true
}

/**
 * Build insight cards from the most interesting patterns in bootstrap token data.
 * Generates 3-4 cards from different signal types.
 */
function buildInsightCards(tokens) {
  if (!tokens || tokens.length === 0) return []

  const items = tokens.map(item => {
    const t = item.token || item
    const m = item.metrics || {}
    return {
      name: t.name || 'Unknown',
      symbol: t.symbol || '???',
      velocity: m.velocity_ratio || 0,
      novelty: m.novelty_ratio || 0,
      mentions: m.mentions_24h || 0,
      authors: m.unique_authors || 0,
      engagement: m.total_weighted_engagement || 0,
    }
  })

  const cards = []

  // 1. TRENDING - highest velocity_ratio
  const byVelocity = [...items].sort((a, b) => b.velocity - a.velocity)
  if (byVelocity[0] && byVelocity[0].velocity > 0) {
    const t = byVelocity[0]
    cards.push({
      id: 'insight-velocity-' + t.symbol.toLowerCase(),
      type: 'insight',
      headline: t.name + '\nTrending Fast',
      stat: fmtNum(t.mentions),
      statLabel: 'mentions/24h',
      statColor: '#10B981',
      subtitle: fmtNum(t.authors) + ' unique authors discussing. Velocity ratio ' + t.velocity.toFixed(1) + 'x - accelerating social momentum.',
      tag: 'TRENDING',
      accent: '#10B981',
    })
  }

  // 2. NEW NARRATIVE - highest novelty_ratio
  const byNovelty = [...items].sort((a, b) => b.novelty - a.novelty)
  if (byNovelty[0] && byNovelty[0].novelty > 0 && byNovelty[0].symbol !== byVelocity[0]?.symbol) {
    const t = byNovelty[0]
    cards.push({
      id: 'insight-novelty-' + t.symbol.toLowerCase(),
      type: 'insight',
      headline: t.name + '\nNew Narrative',
      stat: (t.novelty * 100).toFixed(0) + '%',
      statLabel: 'novelty score',
      statColor: '#8B5CF6',
      subtitle: 'High novelty ratio signals fresh conversation. ' + fmtNum(t.mentions) + ' mentions from ' + fmtNum(t.authors) + ' authors in 24h.',
      tag: 'NEW NARRATIVE',
      accent: '#8B5CF6',
    })
  }

  // 3. WHALE SIGNAL - most unique_authors
  const byAuthors = [...items].sort((a, b) => b.authors - a.authors)
  const authorPick = byAuthors.find(t => !cards.some(c => c.id.includes(t.symbol.toLowerCase())))
  if (authorPick && authorPick.authors > 0) {
    cards.push({
      id: 'insight-authors-' + authorPick.symbol.toLowerCase(),
      type: 'insight',
      headline: authorPick.name + '\nWide Reach',
      stat: fmtNum(authorPick.authors),
      statLabel: 'unique authors',
      statColor: '#F59E0B',
      subtitle: 'Broadest author base signals organic interest. ' + fmtNum(authorPick.mentions) + ' total mentions with ' + fmtNum(authorPick.engagement) + ' weighted engagement.',
      tag: 'WHALE SIGNAL',
      accent: '#F59E0B',
    })
  }

  // 4. HOT TOPIC - most mentions_24h (if different from above)
  const byMentions = [...items].sort((a, b) => b.mentions - a.mentions)
  const mentionPick = byMentions.find(t => !cards.some(c => c.id.includes(t.symbol.toLowerCase())))
  if (mentionPick && mentionPick.mentions > 0) {
    cards.push({
      id: 'insight-mentions-' + mentionPick.symbol.toLowerCase(),
      type: 'insight',
      headline: mentionPick.name + '\nHot Topic',
      stat: fmtNum(mentionPick.mentions),
      statLabel: 'mentions/24h',
      statColor: '#EC4899',
      subtitle: 'Dominating social conversation. Engagement velocity at ' + fmtNum(mentionPick.engagement) + ' weighted score.',
      tag: 'HOT TOPIC',
      accent: '#EC4899',
    })
  }

  return cards
}

/**
 * Build token cards from bootstrap data showing social metrics.
 */
function buildTokenCards(tokens) {
  if (!tokens || tokens.length === 0) return []

  return tokens.slice(0, 6).map((item, i) => {
    const t = item.token || item
    const m = item.metrics || {}
    const style = mediaStyles[i % mediaStyles.length]
    return {
      id: 'token-' + (t.symbol || i).toLowerCase(),
      type: 'token-card',
      name: t.name || 'Unknown',
      symbol: t.symbol || '???',
      color: style.accent,
      image: t.image_small || t.image_url || null,
      mentions: fmtNum(m.mentions_24h || 0),
      authors: fmtNum(m.unique_authors || 0),
      engagement: fmtNum(m.total_weighted_engagement || 0),
      mcap: fmtMcap(t.market_cap),
      category: t.primary_category || t.segment || '',
      velocity: (m.velocity_ratio || 0).toFixed(1) + 'x',
    }
  })
}

/**
 * Analyze tweet text for bullish/bearish sentiment keywords.
 * Returns 'bullish', 'bearish', or null.
 */
function analyzeSentiment(text) {
  if (!text) return null
  const lower = text.toLowerCase()
  const bullWords = ['bullish', 'moon', 'pump', 'breakout', 'ath', 'rally', 'surge', 'buy', 'long', 'accumulate', 'undervalued', 'sending', 'ripping', 'parabolic']
  const bearWords = ['bearish', 'dump', 'crash', 'sell', 'short', 'overvalued', 'rug', 'scam', 'top signal', 'dead', 'bleeding', 'rekt', 'capitulation']
  let bull = 0, bear = 0
  for (const w of bullWords) if (lower.includes(w)) bull++
  for (const w of bearWords) if (lower.includes(w)) bear++
  if (bull > bear && bull > 0) return 'bullish'
  if (bear > bull && bear > 0) return 'bearish'
  return null
}

/**
 * Build reels from top trending tokens with sparkline previews.
 * Uses CoinGecko data fetched by specific token IDs for accurate matching.
 */
function buildReels(tokens, cgDataById) {
  if (!tokens || tokens.length === 0) return []

  return tokens.slice(0, 10).map((item, i) => {
    const t = item.token || item
    const m = item.metrics || {}
    const style = mediaStyles[i % mediaStyles.length]
    // Match by cg_id (exact) or symbol (fallback)
    const cgMatch = cgDataById?.get(t.cg_id) ||
      [...(cgDataById?.values() || [])].find(c =>
        c.symbol?.toLowerCase() === (t.symbol || '').toLowerCase()
      )
    return {
      id: 'reel-' + (t.symbol || i).toLowerCase(),
      name: t.name || 'Unknown',
      symbol: (t.symbol || '???').toUpperCase(),
      image: t.image_small || t.image_url || cgMatch?.image || null,
      sparkline: cgMatch?.sparkline_in_7d?.price || [],
      change: cgMatch?.price_change_percentage_24h ?? null,
      color: style.accent,
      mentions: fmtNum(m.mentions_24h || 0),
    }
  })
}

/**
 * Fetch videos from media center API and normalize for feed.
 */
async function fetchMediaVideos() {
  return _deduped('pulse-media', MEDIA_CACHE_TTL, async () => {
    try {
      const result = await mediaApi.getVideos('crypto', 1, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
      if (!result?.items) return []
      return result.items.slice(0, 8).map((v, i) => {
        const style = mediaStyles[i % mediaStyles.length]
        return {
          id: `video-${v.id}`,
          type: 'video',
          title: v.title,
          thumbnail: v.thumbnail,
          channel: v.channel?.name || 'Unknown',
          channelAvatar: v.channel?.avatar || null,
          duration: v.duration || 0,
          views: v.viewCount || 0,
          publishedAt: v.publishedAt,
          url: v.url,
          tags: v.tags || [],
          isShort: v.type === 'short',
          gradient: style.gradient,
          accent: style.accent,
        }
      })
    } catch {
      return []
    }
  })
}

/**
 * Builds Pulse feed from live X Dash API.
 * Fetches bootstrap (top trending tokens) then token details (real tweets).
 * Real PFPs, real tweet text, real engagement metrics.
 */
export default function usePulseFeed() {
  const [feed, setFeed] = useState([])
  const [stories, setStories] = useState([])
  const [insightCards, setInsightCards] = useState([])
  const [tokenCards, setTokenCards] = useState([])
  const [reels, setReels] = useState([])
  const [videos, setVideos] = useState([])
  const [storyTweets, setStoryTweets] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const built = useRef(false)

  useEffect(() => {
    if (built.current) return
    built.current = true
    let cancelled = false

    async function load() {
      try {
        // 1. Get top trending tokens from bootstrap
        const bootstrap = await fetchBootstrap()
        if (cancelled) return
        if (!bootstrap) {
          setError('Social data unavailable')
          setLoading(false)
          return
        }

        const rawTokens = bootstrap.tokens || bootstrap
        if (!Array.isArray(rawTokens) || rawTokens.length === 0) {
          setError('No trending tokens')
          setLoading(false)
          return
        }

        // Filter to crypto/finance tokens only (skip sports fan tokens)
        const tokens = rawTokens.filter(isCryptoToken)
        if (tokens.length === 0) {
          setError('No crypto tokens trending')
          setLoading(false)
          return
        }

        // Fetch cached Spectre price rows for the visible tokens. Sparklines are
        // optional; avoid the local `/api/coingecko` proxy when it is unavailable.
        const cgDataById = new Map()
        const symbols = tokens.slice(0, 20).map(item => (item.token || item).symbol).filter(Boolean)
        if (symbols.length > 0) {
          try {
            const priceMap = await getSpectrePricesBySymbols(symbols)
            tokens.slice(0, 20).forEach((item) => {
              const token = item.token || item
              const symbol = String(token.symbol || '').toUpperCase()
              const row = priceMap[symbol]
              if (!row) return
              cgDataById.set(token.cg_id || symbol, {
                id: token.cg_id || symbol,
                symbol,
                image: row.image,
                current_price: row.price,
                market_cap: row.marketCap,
                total_volume: row.volume,
                price_change_percentage_24h: row.change24 ?? row.change,
                sparkline_in_7d: null,
              })
            })
          } catch { /* sparklines are optional - reels will show without charts */ }
        }

        // Fetch media center videos + news in parallel
        // RSS is most reliable (no API key needed), fallback to CryptoNews API chain
        const [videoItems, newsItems] = await Promise.all([
          fetchMediaVideos().catch(() => []),
          getRssMarketNews(null, 20).then(items => items.length > 0 ? items : getCryptoNews(null, 12)).catch(() => []),
        ])

        // Build insight + token cards from bootstrap data
        const insights = buildInsightCards(tokens)
        const tkCards = buildTokenCards(tokens)

        // Build reels for horizontal scroll section
        const reelCards = buildReels(tokens, cgDataById)

        // Extract token info + CoinGecko IDs for detail fetches
        const tokenInfos = tokens.slice(0, 6).map(item => {
          const t = item.token || item
          return {
            cgId: t.cg_id,
            name: t.name,
            symbol: t.symbol,
            image: t.image_small || t.image_url,
            topAuthors: item.top_authors || [],
          }
        }).filter(t => t.cgId)

        // 2. Fetch token details in parallel (real tweets)
        const detailPromises = tokenInfos.map(t =>
          fetchTokenDetail(t.cgId).catch(() => null)
        )
        const details = await Promise.all(detailPromises)
        if (cancelled) return

        // 3. Build stories from top KOLs across all tokens
        const authorMap = new Map()
        details.forEach((detail, i) => {
          if (!detail?.authors) return
          detail.authors.forEach(a => {
            if (!a.screen_name || a.followers_count < 5000) return
            const key = a.rest_id || a.screen_name
            const existing = authorMap.get(key)
            if (!existing || a.followers_count > existing.followers_count) {
              authorMap.set(key, { ...a, tokenName: tokenInfos[i]?.name })
            }
          })
        })

        // Also pull top_authors from bootstrap for broader coverage
        tokenInfos.forEach(t => {
          t.topAuthors.forEach(a => {
            if (!a.screen_name || a.followers_count < 5000) return
            const key = a.author_rest_id || a.screen_name
            if (!authorMap.has(key)) {
              authorMap.set(key, { ...a, rest_id: a.author_rest_id, tokenName: t.name })
            }
          })
        })

        const topKols = [...authorMap.values()]
          .sort((a, b) => b.followers_count - a.followers_count)
          .slice(0, 14)

        const storyItems = topKols.map((a, i) => ({
          id: `s${i}`,
          name: a.screen_name,
          displayName: a.name,
          image: a.avatar_image_url?.replace('_normal', '_bigger') || null,
          color: tierFromFollowers(a.followers_count) === 'S' ? '#EF4444'
            : tierFromFollowers(a.followers_count) === 'A' ? '#F59E0B' : '#3B82F6',
          type: 'kol',
          followers: a.followers_count,
          verified: a.is_blue_verified,
          tier: tierFromFollowers(a.followers_count),
          tokenName: a.tokenName,
        }))
        storyItems.unshift({ id: 'add', name: 'Your Story', image: null, color: 'rgba(255,255,255,0.1)', type: 'add' })

        // 4. Build feed from real tweets (top_mentions first, then mentions)
        // Also collect tweets per author for the story viewer
        const allTweets = []
        const seenTweets = new Set()
        const authorTweetsMap = new Map()

        details.forEach((detail, i) => {
          if (!detail) return
          const tokenInfo = tokenInfos[i]
          const mentions = [
            ...(detail.top_mentions || []),
            ...(detail.mentions || []),
          ]

          mentions.forEach(m => {
            if (!m.tweet?.full_text || !m.author?.screen_name) return
            const tweetId = m.tweet.tweet_id
            if (seenTweets.has(tweetId)) return
            seenTweets.add(tweetId)

            const tweetData = {
              tweetId,
              text: m.tweet.full_text,
              date: m.tweet.created_at_utc,
              xUrl: m.tweet.x_url,
              likes: m.tweet.favorite_count || 0,
              retweets: m.tweet.retweet_count || 0,
              replies: m.tweet.reply_count || 0,
              quotes: m.tweet.quote_count || 0,
              views: m.tweet.views_count || 0,
              author: m.author,
              weightedEngagement: m.derived?.weighted_engagement || 0,
              tokenSymbol: tokenInfo.symbol,
              tokenName: tokenInfo.name,
              tokenImage: tokenInfo.image,
            }

            allTweets.push(tweetData)

            // Collect per-author tweets for story viewer
            const sn = m.author.screen_name
            if (!authorTweetsMap.has(sn)) authorTweetsMap.set(sn, [])
            authorTweetsMap.get(sn).push({
              text: m.tweet.full_text,
              date: m.tweet.created_at_utc,
              likes: m.tweet.favorite_count || 0,
              replies: m.tweet.reply_count || 0,
              retweets: m.tweet.retweet_count || 0,
              views: m.tweet.views_count || 0,
              xUrl: m.tweet.x_url,
              tokenName: tokenInfo.name,
              tokenSymbol: tokenInfo.symbol,
              tokenImage: tokenInfo.image,
            })
          })
        })

        // Sort by recency first, then engagement within same time bucket
        allTweets.sort((a, b) => {
          const dateA = new Date(a.date).getTime() || 0
          const dateB = new Date(b.date).getTime() || 0
          // Primary: most recent first
          if (dateB !== dateA) return dateB - dateA
          // Tiebreaker: highest engagement
          return b.weightedEngagement - a.weightedEngagement
        })

        // Build tweet feed items - pipe sparkline data from CoinGecko
        const tweetFeedItems = allTweets.slice(0, 30).map((t, idx) => {
          const style = mediaStyles[idx % mediaStyles.length]
          const tier = tierFromFollowers(t.author.followers_count)

          // Find matching CoinGecko data for this tweet's token
          const tokenInfo = tokenInfos.find(ti => ti.symbol === t.tokenSymbol)
          const cgId = tokenInfo?.cgId
          const cgMatch = cgId ? cgDataById.get(cgId) : null
          // Also try symbol match as fallback
          const cgBySymbol = !cgMatch ? [...cgDataById.values()].find(c =>
            c.symbol?.toLowerCase() === (t.tokenSymbol || '').toLowerCase()
          ) : null
          const cg = cgMatch || cgBySymbol
          const sparkline = cg?.sparkline_in_7d?.price || null
          const price24hChange = cg?.price_change_percentage_24h ?? null
          const currentPrice = cg?.current_price ?? null
          const mcap = cg?.market_cap ?? null

          return {
            id: `tweet-${t.tweetId || idx}`,
            type: 'tweet',
            user: t.author.name,
            handle: t.author.screen_name,
            avatar: t.author.avatar_image_url?.replace('_normal', '_bigger') || null,
            avatarColor: style.accent + '40',
            verified: t.author.is_blue_verified,
            time: timeAgo(t.date),
            body: t.text,
            xUrl: t.xUrl,
            sentiment: analyzeSentiment(t.text),
            engagement: {
              comments: t.replies,
              retweets: t.retweets,
              likes: t.likes,
              views: t.views,
            },
            media: {
              type: 'chart',
              title: '$' + (t.tokenSymbol || '').toUpperCase(),
              subtitle: t.tokenName,
              heroNumber: null,
              gradient: style.gradient,
              accent: style.accent,
              chartData: sparkline,
              tokenImage: t.tokenImage,
            },
            // Price context from CoinGecko
            priceData: currentPrice ? {
              price: currentPrice,
              change24h: price24hChange,
              mcap,
            } : null,
            tier,
          }
        })

        // Build news headline cards from crypto news
        // Filter to crypto/finance-relevant headlines (skip sports, general news)
        const cryptoKeywords = /crypto|bitcoin|btc|ethereum|eth|solana|sol|defi|nft|token|blockchain|web3|hack|exploit|exchange|binance|coinbase|wallet|stablecoin|usdt|usdc|mining|halving|sec |cftc|regulation|airdrop|dao|protocol|chain|dex|cefi|yield|staking|validator|l1|l2|layer|rollup|bridge|oracle|liquidity|whale|bull|bear|market cap|trading|altcoin|memecoin|opec|oil|fed |rate cut|inflation|treasury|stock|nasdaq|s&p/i
        const filteredNews = (newsItems || []).filter(n => cryptoKeywords.test(n.title || '') || cryptoKeywords.test(n.summary || ''))
        const newsFeedItems = filteredNews.slice(0, 8).map((n, i) => {
          const pubDate = n.publishedAt || n.published_at
          const pubTs = n.publishedOn || n.published_on
          const timeStr = pubDate ? timeAgo(pubDate) : pubTs ? timeAgo(new Date(pubTs * 1000).toISOString()) : ''
          return {
            id: `news-${n.id || i}`,
            type: 'news',
            title: n.title,
            source: typeof n.source === 'object' ? (n.source.title || n.source.name || 'News') : (n.source || 'Crypto News'),
            url: n.url,
            publishedAt: pubDate,
            time: timeStr,
            currencies: (n.currencies || []).slice(0, 2),
            accent: mediaStyles[i % mediaStyles.length].accent,
          }
        })

        // Interleave news every 5th card
        const feedItems = []
        let newsIdx = 0
        tweetFeedItems.forEach((item, i) => {
          feedItems.push(item)
          if ((i + 1) % 5 === 0 && newsIdx < newsFeedItems.length) {
            feedItems.push(newsFeedItems[newsIdx++])
          }
        })
        // Append remaining news
        while (newsIdx < newsFeedItems.length) {
          feedItems.push(newsFeedItems[newsIdx++])
        }

        if (!cancelled) {
          setFeed(feedItems)
          setStories(storyItems)
          setInsightCards(insights)
          setTokenCards(tkCards)
          setReels(reelCards)
          setVideos(videoItems)
          setStoryTweets(authorTweetsMap)
          setLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          console.error('[Pulse] Feed load error:', e)
          setError(e.message)
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true; built.current = false }
  }, [])

  return { feed, stories, insightCards, tokenCards, reels, videos, storyTweets, loading, error }
}
