/**
 * useTokenMetadata
 *
 * Lazy per-token metadata enrichment for the watchlists Analysis panel.
 * For each token with a CoinGecko id we pull `/coins/{id}` once (cached by
 * the underlying service) and expose:
 *
 *   - twitterHandle  - resolved official X handle (links.twitter)
 *   - categories     - CoinGecko categories (used as sectors)
 *   - sector         - primary sector (first category)
 *   - genesisDate    - launch date (drives "stale tail" insights)
 *   - twitterFollowers / redditSubscribers / githubStars
 *   - cgScore        - composite CG community/developer score
 *
 * Fetches are staggered (300ms) so we don't burst CG even on a 46-token
 * watchlist. `enabled` gates the whole thing so the data is only fetched
 * when the Analysis tab is open.
 */
import { useEffect, useRef, useState, useMemo } from 'react'
import { getCoinDetails } from '@/services/coinGeckoApi'
import { SYMBOL_TO_COINGECKO_ID } from '@/constants/majorTokens'

// Process-wide cache so flipping between Analysis ↔ Table doesn't re-fetch.
const _metaCache = new Map() // symbol -> meta

function extractHandle(twitterUrl) {
  if (!twitterUrl) return null
  return String(twitterUrl)
    .replace(/^https?:\/\/(twitter\.com|x\.com)\//i, '')
    .replace(/[\/?#].*$/, '')
    .replace(/^@/, '') || null
}

function buildMeta(symbol, raw) {
  if (!raw) return null
  const handle = extractHandle(raw.links?.twitter)
  const cats = Array.isArray(raw.categories) ? raw.categories.filter(Boolean) : []
  const scores = raw.scores || {}
  return {
    symbol,
    twitterHandle: handle,
    categories: cats,
    sector: cats[0] || null,
    genesisDate: raw.genesisDate || null,
    twitterFollowers: raw.communityData?.twitterFollowers ?? null,
    redditSubscribers: raw.communityData?.redditSubscribers ?? null,
    githubStars: raw.developerData?.stars ?? null,
    description: raw.description || null,
    cgScore: scores.coingecko ?? null,
    communityScore: scores.community ?? null,
    developerScore: scores.developer ?? null,
  }
}

export default function useTokenMetadata(tokens, enabled = true) {
  // Identity-keyed dependency — we re-enrich when the token *set* changes,
  // not when their prices update. Otherwise the staggered fetch would
  // restart on every Binance tick.
  const tokensKey = useMemo(
    () => tokens.map((t) => `${(t.symbol || '').toUpperCase()}|${t.cgId || ''}`).join(','),
    [tokens],
  )

  const [meta, setMeta] = useState(() => {
    const initial = {}
    for (const t of tokens) {
      const sym = (t.symbol || '').toUpperCase()
      if (_metaCache.has(sym)) initial[sym] = _metaCache.get(sym)
    }
    return initial
  })
  const fetchedRef = useRef(new Set())

  useEffect(() => {
    if (!enabled || tokens.length === 0) return
    let cancelled = false

    // Seed from cache instantly so the UI doesn't show '…' for tokens we've
    // already enriched in this session.
    setMeta((prev) => {
      const next = { ...prev }
      for (const t of tokens) {
        const sym = (t.symbol || '').toUpperCase()
        if (_metaCache.has(sym) && !next[sym]) next[sym] = _metaCache.get(sym)
      }
      return next
    })

    const fetchOne = async (token) => {
      const sym = (token.symbol || '').toUpperCase()
      if (!sym) return
      if (fetchedRef.current.has(sym)) return
      if (_metaCache.has(sym)) return
      fetchedRef.current.add(sym)
      const cgId = token.cgId || SYMBOL_TO_COINGECKO_ID[sym] || null
      // No cgId — can't fetch CG detail. Store empty meta so we don't keep
      // retrying (X-Dash search will still resolve activity).
      if (!cgId) {
        const empty = { symbol: sym, twitterHandle: null, categories: [], sector: null }
        _metaCache.set(sym, empty)
        if (!cancelled) setMeta((prev) => ({ ...prev, [sym]: empty }))
        return
      }
      try {
        const raw = await getCoinDetails(token.symbol, cgId)
        if (cancelled) return
        const m = buildMeta(sym, raw)
        if (m) {
          _metaCache.set(sym, m)
          setMeta((prev) => ({ ...prev, [sym]: m }))
        }
      } catch { /* ignore */ }
    }

    // 300ms stagger — CG Pro allows ~27 req/s, but we share the queue with
    // other surfaces. Keep ourselves polite.
    let i = 0
    const id = setInterval(() => {
      if (i >= tokens.length) { clearInterval(id); return }
      fetchOne(tokens[i])
      i++
    }, 300)

    return () => { cancelled = true; clearInterval(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokensKey, enabled])

  return meta
}
