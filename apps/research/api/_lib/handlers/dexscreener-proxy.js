/**
 * Vercel Serverless - DexScreener proxy.
 * Proxies /api/dexscreener-pair and /api/dexscreener-watchlist.
 * Matches Express routes at packages/server/index.js:3395-3636
 */

const DEXSCREENER_CHAIN_TO_NETWORK = {
  ethereum: 1, bsc: 56, polygon: 137, arbitrum: 42161,
  optimism: 10, avalanche: 43114, base: 8453, solana: 1399811149,
  fantom: 250, cronos: 25, celo: 42220, harmony: 1666600000,
  robinhood: 4663,
}

const _cache = {}
function getCached(key, ttl) {
  const e = _cache[key]
  if (!e || Date.now() - e.ts > ttl) return null
  return e.data
}
function setCache(key, data) { _cache[key] = { data, ts: Date.now() } }

const ALLOWED_ORIGINS = [
  'http://localhost:5180', 'http://localhost:5181'
]

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',
    ALLOWED_ORIGINS.includes(req.headers?.origin) ? req.headers.origin : '')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const route = req.query.route || ''

  // ── /api/dexscreener-pair/:chain/:address ─────────────────────────────────
  if (route === 'pair') {
    const chain = req.query.chain || ''
    const address = req.query.address || ''
    if (!chain || !address) return res.status(400).json({ error: 'Missing chain or address' })
    // 2026-05-12 path-injection lockdown: chain + address are interpolated
    // directly into the DexScreener URL template. Without validation an
    // attacker could send `chain=ethereum/../../token-profiles/latest&address=x`
    // to manipulate the upstream URL. Strict allowlist for chain + standard
    // address shapes (EVM 40-hex or Solana 32-44 base58) for address.
    const DEX_CHAINS = new Set(['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base', 'avalanche', 'fantom', 'solana', 'pulsechain', 'cronos', 'linea', 'blast', 'zksync', 'mantle', 'scroll'])
    if (!DEX_CHAINS.has(String(chain).toLowerCase())) {
      return res.status(400).json({ error: 'Invalid chain' })
    }
    const addrStr = String(address)
    const isEvm = /^0x[a-fA-F0-9]{40}$/.test(addrStr)
    const isSol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addrStr)
    if (!isEvm && !isSol) {
      return res.status(400).json({ error: 'Invalid address' })
    }

    const cacheKey = `dex-pair:${chain}:${address}`
    const cached = getCached(cacheKey, 30_000)
    if (cached) {
      res.setHeader('Cache-Control', 'public, s-maxage=30')
      return res.status(200).json(cached)
    }

    try {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${chain}/${address}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      })
      if (!r.ok) throw new Error(`DexScreener ${r.status}`)
      const data = await r.json()
      setCache(cacheKey, data)
      res.setHeader('Cache-Control', 'public, s-maxage=30')
      return res.status(200).json(data)
    } catch (err) {
      const stale = _cache[cacheKey]
      if (stale) return res.status(200).json(stale.data)
      console.error('[dexscreener] pair error:', err.message)
      return res.status(502).json({ error: 'DexScreener unavailable' })
    }
  }

  // ── /api/dexscreener-watchlist/:id ────────────────────────────────────────
  if (route === 'watchlist') {
    const id = (req.query.id || '').trim()
    if (!id) return res.status(400).json({ error: 'Watchlist ID is required' })

    // DexScreener stores shared watchlists in Firebase Firestore
    // (project dex-screener-16543). There is no public watchlist REST endpoint;
    // the only reliable source is the Firestore document, which we then enrich
    // via DexScreener's public /pairs API. Matches packages/server/index.js
    // and the trading app's serverless function.
    try {
      const firestoreUrl = `https://firestore.googleapis.com/v1/projects/dex-screener-16543/databases/(default)/documents/watchlists/${encodeURIComponent(id)}`
      const fsRes = await fetch(firestoreUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      })

      if (!fsRes.ok) {
        return res.status(404).json({
          error: 'Watchlist not found. Check the URL and try again.',
        })
      }

      const fsData = await fsRes.json()
      const pairsField = fsData?.fields?.pairs?.arrayValue?.values
      if (!pairsField || pairsField.length === 0) {
        return res.status(404).json({ error: 'Watchlist is empty.' })
      }

      const rawPairs = pairsField.map((v) => {
        const f = v.mapValue?.fields || {}
        return {
          pairId: f.pairId?.stringValue || '',
          chainId: f.chainId?.stringValue || '',
          symbol: f.baseTokenSymbol?.stringValue || '',
          name: f.baseTokenName?.stringValue || '',
        }
      }).filter((p) => p.pairId && p.chainId)

      // Batch-enrich via DexScreener pairs API (5 concurrent)
      const BATCH_SIZE = 5
      const tokens = []
      for (let i = 0; i < rawPairs.length; i += BATCH_SIZE) {
        const batch = rawPairs.slice(i, i + BATCH_SIZE)
        const results = await Promise.all(batch.map(async (rp) => {
          try {
            const url = `https://api.dexscreener.com/latest/dex/pairs/${rp.chainId}/${rp.pairId}`
            const r = await fetch(url, {
              headers: { Accept: 'application/json' },
              signal: AbortSignal.timeout(8000),
            })
            if (!r.ok) return { ...rp, enriched: false }
            const data = await r.json()
            const p = data.pair || (data.pairs && data.pairs[0])
            if (!p) return { ...rp, enriched: false }
            const base = p.baseToken || {}
            const chainId = (p.chainId || rp.chainId).toLowerCase()
            const networkId = DEXSCREENER_CHAIN_TO_NETWORK[chainId] || 1
            // DexScreener exposes m5 / h1 / h6 / h24. 7d / 30d / 1y do not
            // exist on its API. Send them through as the matching column
            // names; long windows stay absent so the row renders "-".
            const pcNum = (k) => {
              const v = parseFloat(p.priceChange?.[k])
              return Number.isFinite(v) ? v : null
            }
            return {
              symbol: base.symbol || rp.symbol || '?',
              name: base.name || rp.name || 'Unknown',
              address: base.address || rp.pairId,
              networkId,
              price: parseFloat(p.priceUsd || 0) || 0,
              change: parseFloat(p.priceChange?.h24 || 0) || 0,
              change5m: pcNum('m5'),
              change1h: pcNum('h1'),
              change6h: pcNum('h6'),
              change24h: pcNum('h24'),
              marketCap: parseFloat(p.fdv || p.marketCap || 0) || 0,
              volume24: parseFloat(p.volume?.h24 || 0) || 0,
              liquidity: parseFloat(p.liquidity?.usd || 0) || 0,
              logo: p.info?.imageUrl || null,
              enriched: true,
            }
          } catch {
            return { ...rp, enriched: false }
          }
        }))

        results.forEach((r) => {
          if (r.enriched) {
            tokens.push(r)
          } else {
            const networkId = DEXSCREENER_CHAIN_TO_NETWORK[r.chainId] || 1
            tokens.push({
              symbol: r.symbol || '?',
              name: r.name || 'Unknown',
              address: r.pairId,
              networkId,
              price: 0,
              change: 0,
              marketCap: 0,
              logo: null,
            })
          }
        })
      }

      const seen = new Set()
      const uniqueTokens = tokens.filter((t) => {
        const key = (t.address || '').toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      return res.status(200).json({
        tokens: uniqueTokens,
        source: 'firestore',
        count: uniqueTokens.length,
      })
    } catch (err) {
      console.error('[dexscreener] watchlist error:', err.message)
      return res.status(502).json({
        error: 'DexScreener unavailable',
        tokens: [],
      })
    }
  }

  // ── /latest/dex/tokens/:address raw passthrough (2026-05-28 hide-apis) ────
  // Used by src/services/coinGeckoApi.js as a microcap-fallback for DEX-only
  // tokens (raw shape with pairs[]). The existing /api/dexscreener-tokens
  // handler reshapes the response; the client here needs the raw structure.
  if (route === 'tokens-raw') {
    const address = String(req.query.address || '').trim()
    if (!address) return res.status(400).json({ error: 'Missing address' })
    const isEvm = /^0x[a-fA-F0-9]{40}$/.test(address)
    const isSol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)
    if (!isEvm && !isSol) return res.status(400).json({ error: 'Invalid address' })
    const cacheKey = `dex-tokens-raw:${address}`
    const cached = getCached(cacheKey, 30_000)
    if (cached) return res.status(200).json(cached)
    try {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      })
      if (!r.ok) return res.status(r.status).json({ error: `DexScreener ${r.status}` })
      const data = await r.json()
      setCache(cacheKey, data)
      res.setHeader('Cache-Control', 'public, s-maxage=30')
      return res.status(200).json(data)
    } catch {
      return res.status(502).json({ error: 'DexScreener unavailable' })
    }
  }

  // ── /latest/dex/search?q=... raw passthrough (2026-05-28 hide-apis) ───────
  // Used by src/pages/watchlists/components/watchlists-page.jsx for user-
  // pasted address lookups. Query is bounded to 64 chars to prevent abuse.
  if (route === 'search') {
    const q = String(req.query.q || '').trim().slice(0, 64)
    if (!q) return res.status(400).json({ error: 'Missing q' })
    const cacheKey = `dex-search:${q}`
    const cached = getCached(cacheKey, 30_000)
    if (cached) return res.status(200).json(cached)
    try {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      })
      if (!r.ok) return res.status(r.status).json({ error: `DexScreener ${r.status}` })
      const data = await r.json()
      setCache(cacheKey, data)
      res.setHeader('Cache-Control', 'public, s-maxage=30')
      return res.status(200).json(data)
    } catch {
      return res.status(502).json({ error: 'DexScreener unavailable' })
    }
  }

  return res.status(400).json({ error: `Unknown dexscreener route: ${route}` })
}
