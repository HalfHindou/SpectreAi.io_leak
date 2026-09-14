/**
 * Vercel Serverless — Sector snapshot.
 * GET /api/market/sectors/snapshot
 *
 * Single endpoint that fans out to CoinGecko once per sector and caches
 * the merged response for 5 minutes. Replaces N parallel client-side
 * /api/coingecko/coins/markets?category=... requests that were getting
 * rate-limited (HTTP 429) on the public CG tier.
 *
 * Response shape:
 *   {
 *     sectors: [{ id, tokens: [{ symbol, sparkline: number[] }] }],
 *     cached_at: ISO timestamp
 *   }
 */

const DEFAULT_CATEGORIES = [
  'meme-token',
  'layer-1',
  'decentralized-finance-defi',
  'layer-2',
  'gaming',
  'artificial-intelligence',
  'privacy-coins',
  'real-world-assets-rwa',
]

const TOKENS_PER_SECTOR = 5
const TTL_MS = 5 * 60 * 1000

let cache = null // { key, payload, ts }

async function fetchCategory(slug) {
  const cgKey = process.env.COINGECKO_API_KEY || ''
  const cgBase = cgKey
    ? 'https://pro-api.coingecko.com/api/v3'
    : 'https://api.coingecko.com/api/v3'
  const headers = { Accept: 'application/json' }
  if (cgKey) headers['x-cg-pro-api-key'] = cgKey
  const url = `${cgBase}/coins/markets?vs_currency=usd&category=${encodeURIComponent(slug)}&order=market_cap_desc&per_page=${TOKENS_PER_SECTOR}&page=1&sparkline=true`
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`CG ${res.status} for ${slug}`)
  const arr = await res.json()
  if (!Array.isArray(arr)) return { id: slug, tokens: [] }
  const tokens = arr
    .map(row => {
      const prices = row?.sparkline_in_7d?.price
      if (!Array.isArray(prices) || prices.length < 2) return null
      return {
        symbol: (row.symbol || '').toUpperCase(),
        sparkline: prices,
      }
    })
    .filter(Boolean)
  return { id: slug, tokens }
}

export default async function handler(req, res) {
  res.setHeader(
    'Access-Control-Allow-Origin',
    ['http://localhost:5180', 'http://localhost:5181'].includes(req.headers?.origin) ? req.headers.origin : ''
  )
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const requested = String(req.query.categories || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const categories = requested.length ? requested : DEFAULT_CATEGORIES
  const cacheKey = categories.join(',')

  if (cache && cache.key === cacheKey && Date.now() - cache.ts < TTL_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
    return res.status(200).json(cache.payload)
  }

  try {
    const results = await Promise.all(
      categories.map(slug => fetchCategory(slug).catch(() => ({ id: slug, tokens: [] })))
    )
    const payload = {
      sectors: results,
      cached_at: new Date().toISOString(),
    }
    cache = { key: cacheKey, payload, ts: Date.now() }
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
    return res.status(200).json(payload)
  } catch (err) {
    if (cache?.payload) return res.status(200).json(cache.payload)
    console.error('Sector snapshot error:', err.message)
    return res.status(502).json({ error: 'Sector snapshot unavailable' })
  }
}
