/**
 * Vercel Serverless — company news proxy (Google News RSS, English).
 * GET /api/company-news?q=SpaceX
 * Returns [{ headline, url, source, date, summary }] — reliable English market
 * coverage for the Pre-IPO "Market Summary". Never throws → [].
 */
const _cache = new Map()
function getCached(k, ttl) {
  const e = _cache.get(k)
  if (!e || Date.now() - e.ts > ttl) return null
  return e.data
}
function setCached(k, d) {
  _cache.set(k, { data: d, ts: Date.now() })
  if (_cache.size > 60) _cache.delete(_cache.keys().next().value)
}

function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

export async function fetchCompanyNews(query, limit = 20) {
  const q = String(query || '').trim()
  if (!q) return []
  const ck = `gnews:${q.toLowerCase()}`
  const cached = getCached(ck, 5 * 60_000)
  if (cached) return cached

  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`
  const r = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'User-Agent': 'Mozilla/5.0 (Spectre)' },
  })
  if (!r.ok) throw new Error(`gnews ${r.status}`)
  const xml = await r.text()

  const out = []
  const seen = new Set()
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1]
    let title = decode((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '')
    const link = decode((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '')
    const source = decode((b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '')
    const pub = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || ''
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim()
    if (!title || !link || seen.has(link)) continue
    seen.add(link)
    out.push({
      headline: title,
      url: link,
      source: source || 'News',
      date: pub ? Date.parse(pub) || 0 : 0,
      summary: '',
    })
  }
  // Google News RSS is relevance-ordered, not chronological - sort newest-first
  // BEFORE truncating so a fresh catalyst (e.g. Nasdaq-100 inclusion) can't be
  // cut off by a weeks-old "relevant" story. Undated items sink to the tail.
  out.sort((a, b) => (b.date || 0) - (a.date || 0))
  const fresh = out.slice(0, limit)
  setCached(ck, fresh)
  return fresh
}

export default async function handler(req, res) {
  const allowed = ['http://localhost:5180', 'http://localhost:5181', 'https://app.spectreai.io']
  res.setHeader('Access-Control-Allow-Origin', allowed.includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()
  try {
    const data = await fetchCompanyNews(req.query?.q || '')
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
    return res.status(200).json(data)
  } catch (err) {
    console.error('[company-news] proxy error:', err.message)
    return res.status(200).json([])
  }
}
