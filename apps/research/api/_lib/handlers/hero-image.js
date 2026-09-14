/**
 * Vercel serverless — hero image picker.
 *
 * Mirrors packages/server/agents/imageGenerator.js (Express dev side) but
 * stays filesystem-free: no SVG generation, no PNG cache. Just picks a
 * deterministic Unsplash CDN URL from a curated rotation and 302-redirects.
 *
 * Used by:
 *   GET /api/hero/:slug         (HeroStory fallback when article.coverImage absent)
 *   GET /api/og/:file           (image refs baked into intelligence-data.json
 *                                like /api/og/spectre-foo-bar.jpg)
 *
 * The Unsplash CDN serves direct image URLs without an API key, so this is
 * the same "free solution" that worked on the Express side.
 */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// 16:9 hero crop, q=80, auto webp/avif.
const UNSPLASH_PARAMS = '?w=1600&h=900&fit=crop&q=80&auto=format'

const BY_TICKER = {
  BTC: [
    'https://images.unsplash.com/photo-1518546305927-5a555bb7020d',
    'https://images.unsplash.com/photo-1516245834210-c4c142787335',
    'https://images.unsplash.com/photo-1621761191319-c6fb62004040',
    'https://images.unsplash.com/photo-1543699565-003b8adda5fc',
  ],
  ETH: [
    'https://images.unsplash.com/photo-1621416894569-0f39ed31d247',
    'https://images.unsplash.com/photo-1639762681485-074b7f938ba0',
    'https://images.unsplash.com/photo-1622630998477-20aa696ecb05',
  ],
  SOL: [
    'https://images.unsplash.com/photo-1519608487953-e999c86e7455',
    'https://images.unsplash.com/photo-1639322537228-f710d846310a',
  ],
  BNB: ['https://images.unsplash.com/photo-1621761191319-c6fb62004040'],
  XRP: ['https://images.unsplash.com/photo-1639322537504-6427a16b0a28'],
  DOGE: [
    'https://images.unsplash.com/photo-1558788353-f76d92427f16',
    'https://images.unsplash.com/photo-1477884213360-7e9d7dcc1e48',
  ],
  SHIB: [
    'https://images.unsplash.com/photo-1558788353-f76d92427f16',
    'https://images.unsplash.com/photo-1477884213360-7e9d7dcc1e48',
  ],
  PEPE: ['https://images.unsplash.com/photo-1552072092-7f9b8d63efcb'],
  ADA: ['https://images.unsplash.com/photo-1639322537228-f710d846310a'],
  AVAX: [
    'https://images.unsplash.com/photo-1511497584788-876760111969',
    'https://images.unsplash.com/photo-1454496522488-7a8e488e8606',
  ],
  DOT: ['https://images.unsplash.com/photo-1639762681485-074b7f938ba0'],
  LINK: ['https://images.unsplash.com/photo-1639762681057-408e52192e55'],
  UNI: [
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe',
    'https://images.unsplash.com/photo-1555041469-a586c61ea9bc',
  ],
  ARB: ['https://images.unsplash.com/photo-1551288049-bebda4e38f71'],
  OP: ['https://images.unsplash.com/photo-1492496913980-501348b61469'],
  AAVE: ['https://images.unsplash.com/photo-1635776062127-d379bfcba9f8'],
  RENDER: [
    'https://images.unsplash.com/photo-1551808525-51a94da548ce',
    'https://images.unsplash.com/photo-1587202372775-e229f172b9d7',
  ],
  SUI: ['https://images.unsplash.com/photo-1505142468610-359e7d316be0'],
  APT: ['https://images.unsplash.com/photo-1518364538800-6bae3c2ea0f2'],
  TIA: [
    'https://images.unsplash.com/photo-1462332420958-a05d1e002413',
    'https://images.unsplash.com/photo-1506318137071-a8e063b4bec0',
  ],
  INJ: ['https://images.unsplash.com/photo-1639322537228-f710d846310a'],
  TRUMP: [
    'https://images.unsplash.com/photo-1555848962-6e79363ec58f',
    'https://images.unsplash.com/photo-1582719471384-894fbb16e074',
    'https://images.unsplash.com/photo-1617391258031-f8d80b22fb35',
  ],
  SEI: ['https://images.unsplash.com/photo-1639322537228-f710d846310a'],
  TAO: ['https://images.unsplash.com/photo-1620712943543-bcc4688e7485'],
  FET: ['https://images.unsplash.com/photo-1620712943543-bcc4688e7485'],
}

const BY_CATEGORY = {
  bitcoin: [
    'https://images.unsplash.com/photo-1518546305927-5a555bb7020d',
    'https://images.unsplash.com/photo-1516245834210-c4c142787335',
    'https://images.unsplash.com/photo-1621761191319-c6fb62004040',
  ],
  ethereum: [
    'https://images.unsplash.com/photo-1621416894569-0f39ed31d247',
    'https://images.unsplash.com/photo-1639762681485-074b7f938ba0',
  ],
  defi: [
    'https://images.unsplash.com/photo-1639322537504-6427a16b0a28',
    'https://images.unsplash.com/photo-1642543492481-44e81e3914a7',
    'https://images.unsplash.com/photo-1639762681057-408e52192e55',
  ],
  nft: [
    'https://images.unsplash.com/photo-1618172193763-c511deb635ca',
    'https://images.unsplash.com/photo-1614854262318-831574f15f1f',
  ],
  meme: ['https://images.unsplash.com/photo-1617791160588-241658c0f566'],
  layer2: [
    'https://images.unsplash.com/photo-1551288049-bebda4e38f71',
    'https://images.unsplash.com/photo-1639762681057-408e52192e55',
  ],
  ai: [
    'https://images.unsplash.com/photo-1620712943543-bcc4688e7485',
    'https://images.unsplash.com/photo-1677442136019-21780ecad995',
    'https://images.unsplash.com/photo-1555255707-c07966088b7b',
  ],
  rwa: [
    'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab',
    'https://images.unsplash.com/photo-1554224155-6726b3ff858f',
  ],
  gaming: ['https://images.unsplash.com/photo-1542751371-adc38448a05e'],
  regulation: [
    'https://images.unsplash.com/photo-1555848962-6e79363ec58f',
    'https://images.unsplash.com/photo-1589994965851-a8f479c573a9',
    'https://images.unsplash.com/photo-1617391258031-f8d80b22fb35',
  ],
  regulatory: [
    'https://images.unsplash.com/photo-1589994965851-a8f479c573a9',
    'https://images.unsplash.com/photo-1555848962-6e79363ec58f',
    'https://images.unsplash.com/photo-1617391258031-f8d80b22fb35',
  ],
  macro: [
    'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3',
    'https://images.unsplash.com/photo-1554224154-26032ffc0d07',
    'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e',
    'https://images.unsplash.com/photo-1526628953301-3e589a6a8b74',
    'https://images.unsplash.com/photo-1604594849809-dfedbc827105',
  ],
  stocks: [
    'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f',
    'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3',
    'https://images.unsplash.com/photo-1559526324-4b87b5e36e44',
    'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e',
  ],
  crypto: [
    'https://images.unsplash.com/photo-1621416894569-0f39ed31d247',
    'https://images.unsplash.com/photo-1518546305927-5a555bb7020d',
    'https://images.unsplash.com/photo-1639762681485-074b7f938ba0',
  ],
  markets: [
    'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f',
    'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e',
  ],
  news: [
    'https://images.unsplash.com/photo-1586953208448-b95a79798f07',
    'https://images.unsplash.com/photo-1495020689067-958852a7765e',
  ],
  default: [
    'https://images.unsplash.com/photo-1639762681485-074b7f938ba0',
    'https://images.unsplash.com/photo-1642543492481-44e81e3914a7',
    'https://images.unsplash.com/photo-1639322537228-f710d846310a',
  ],
}

// Deterministic FNV-ish hash: same slug always picks the same image.
function pickFromRotation(urls, slug) {
  if (!urls || urls.length === 0) return null
  let hash = 0
  const s = slug || 'default'
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0
  return urls[Math.abs(hash) % urls.length] + UNSPLASH_PARAMS
}

// ── Bundled intelligence-data lookup ────────────────────────────────────────
// Loaded once per cold start via require() so Vercel's tracer bundles the JSON.
let _articlesBySlug = null
function loadArticlesBySlug() {
  if (_articlesBySlug) return _articlesBySlug
  try {
    const data = require('../../_data/intelligence-data.json')
    const all = [
      ...(data?.articles?.daily || []),
      ...(data?.articles?.research || []),
      ...(data?.articles?.news || []),
      ...(data?.articles?.analysis || []),
      ...(data?.articles?.crypto || []),
      ...(data?.articles?.stocks || []),
    ]
    _articlesBySlug = new Map(all.filter((a) => a?.slug).map((a) => [a.slug, a]))
  } catch (e) {
    console.warn('[hero-image] intelligence-data.json missing — using slug-only picks:', e.message)
    _articlesBySlug = new Map()
  }
  return _articlesBySlug
}

// Pick a hero URL given whatever article metadata we have.
function pickHeroUrl({ slug, tickers = [], category = '', tags = [], type = '' }) {
  const try1 = (key) => pickFromRotation(BY_TICKER[String(key || '').toUpperCase()], slug)
  const try2 = (key) => pickFromRotation(BY_CATEGORY[String(key || '').toLowerCase()], slug)

  for (const t of tickers) {
    const url = try1(t)
    if (url) return url
  }
  if (category) {
    const url = try2(category)
    if (url) return url
  }
  for (const tag of tags) {
    const url = try2(tag)
    if (url) return url
  }
  if (type === 'stocks') return try2('stocks')
  if (type === 'crypto') return try2('crypto')
  if (type === 'news') return try2('news')
  return try2('default')
}

// ── Slug extraction ─────────────────────────────────────────────────────────
// /api/og/spectre-foo-bar.jpg → spectre-foo-bar
// /api/hero/2026-05-28 → 2026-05-28
function normalizeSlug(raw) {
  if (!raw) return ''
  return String(raw).replace(/\.(png|svg|jpg|jpeg|webp|avif)$/i, '')
}

export default async function handler(req, res) {
  const raw = req.query.slug || req.query.file || ''
  const slug = normalizeSlug(raw)
  if (!slug) {
    return res.status(400).json({ error: 'Missing slug' })
  }

  // Try to enrich the pick using bundled article metadata. Falls back to a
  // pure-slug pick when the article isn't in the bundle (older slugs,
  // backfills, etc.) — that still returns a valid Unsplash URL via the
  // default rotation.
  const articles = loadArticlesBySlug()
  const article = articles.get(slug) || null

  const url = pickHeroUrl({
    slug,
    tickers: article?.tickers || [],
    category: article?.category || '',
    tags: article?.tags || article?.categories || [],
    type: article?.type || '',
  })

  if (!url) {
    return res.status(404).json({ error: 'No hero image available' })
  }

  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
  res.setHeader('Location', url)
  return res.status(302).end()
}
