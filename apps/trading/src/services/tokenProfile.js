/**
 * tokenProfile — DexScreener token profile (banner, logo, link set).
 *
 * DexScreener's public token endpoint carries the assets its own token page
 * renders: `info.header` (1500x500 banner), `info.imageUrl` (logo), the full
 * `websites[]` list (Website / CoinMarketCap / CoinGecko / YouTube / LinkedIn…)
 * and `socials[]` (twitter, telegram, discord…). No key, CORS open, and both
 * `api.dexscreener.com` (connect-src) and `*.dexscreener.com` (img-src) are
 * already allowed by the trading CSP - so this stays a client fetch instead of
 * another serverless twin to keep in sync.
 *
 * Module cache (10 min) + in-flight dedupe: the Info view, the banner and the
 * profile card all read the same entry. Fails soft to null - every consumer
 * treats a missing profile as "no banner, no extra links".
 */

const TTL = 10 * 60 * 1000
const _cache = new Map()    // addr(lower) -> { data, ts }
const _inflight = new Map() // addr(lower) -> Promise

/** Strip the CDN query so a 503 on one variant doesn't poison the tag. */
function cleanUrl(u) {
  return typeof u === 'string' && u.startsWith('http') ? u : null
}

function shapeLinks(info) {
  const out = []
  const seen = new Set()
  const push = (label, url, kind) => {
    const u = cleanUrl(url)
    if (!u || seen.has(u)) return
    seen.add(u)
    out.push({ label, url: u, kind })
  }
  for (const w of info?.websites || []) {
    const label = String(w?.label || 'Website')
    push(label, w?.url, /coinmarketcap/i.test(label) ? 'cmc'
      : /coingecko/i.test(label) ? 'gecko'
      : /youtube/i.test(label) ? 'youtube'
      : /linkedin/i.test(label) ? 'linkedin'
      : /docs|gitbook|whitepaper/i.test(label) ? 'docs'
      : 'web')
  }
  for (const s of info?.socials || []) {
    const type = String(s?.type || '').toLowerCase()
    const label = type === 'twitter' ? 'Twitter'
      : type === 'telegram' ? 'Telegram'
      : type === 'discord' ? 'Discord'
      : type ? type[0].toUpperCase() + type.slice(1) : 'Link'
    push(label, s?.url, type || 'link')
  }
  return out
}

export async function fetchTokenProfile(address) {
  const key = String(address || '').toLowerCase()
  if (!key || key === 'native') return null

  const hit = _cache.get(key)
  if (hit && Date.now() - hit.ts < TTL) return hit.data
  const pending = _inflight.get(key)
  if (pending) return pending

  const promise = (async () => {
    try {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      })
      if (!r.ok) throw new Error(String(r.status))
      const j = await r.json()
      const pairs = Array.isArray(j?.pairs) ? j.pairs : []
      // The token's assets ride on whichever pair DexScreener enriched - take
      // the first pair that actually carries an info block.
      const info = pairs.find(p => p?.info?.header || p?.info?.imageUrl)?.info || pairs[0]?.info || null
      const data = info
        ? { banner: cleanUrl(info.header), logo: cleanUrl(info.imageUrl), links: shapeLinks(info) }
        : null
      _cache.set(key, { data, ts: Date.now() })
      return data
    } catch {
      // Cache the miss briefly so a dead token doesn't refetch on every mount.
      _cache.set(key, { data: null, ts: Date.now() })
      return null
    } finally {
      _inflight.delete(key)
    }
  })()

  _inflight.set(key, promise)
  return promise
}

export default fetchTokenProfile
