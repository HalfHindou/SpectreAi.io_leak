import { useState, useCallback, useRef, useEffect } from 'react'
import { searchCoinsForROI } from '@/services/coinGeckoApi'
import { getSpectreSearch } from '@/services/spectreMarketApi'
import { searchTokens as codexSearchTokens } from '@/services/codexApi'

const FETCH_TIMEOUT = 15000
const DEBOUNCE_MS = 400

// DexScreener resolves ANY contract address to its token across all chains,
// keyless. We use it as the primary pasted-address resolver because the Codex
// path depends on an API key that is frequently de-activated (observed dead:
// "API key is not activated"), which silently broke address search.
const DEX_CHAIN_TO_NETWORK = {
  ethereum: 1, bsc: 56, polygon: 137, arbitrum: 42161, optimism: 10,
  base: 8453, avalanche: 43114, fantom: 250, solana: 1399811149,
}
async function resolveAddressViaDexScreener(address, signal) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, { signal })
    if (!r.ok) return null
    const j = await r.json()
    const pairs = Array.isArray(j?.pairs) ? j.pairs : []
    if (!pairs.length) return null
    const lc = String(address).toLowerCase()
    // prefer pairs where the queried address is the BASE token, then deepest liquidity
    const mine = pairs.filter((p) => String(p?.baseToken?.address || '').toLowerCase() === lc)
    const pool = (mine.length ? mine : pairs).sort(
      (a, b) => (Number(b?.liquidity?.usd) || 0) - (Number(a?.liquidity?.usd) || 0),
    )
    const p = pool[0]
    const bt = p?.baseToken || {}
    const sym = String(bt.symbol || '').trim()
    if (!sym) return null
    return {
      cg_id: null,
      token_id: null,
      name: bt.name || sym,
      symbol: sym,
      cashtag: `$${sym}`,
      image_small: p?.info?.imageUrl || null,
      image_url: p?.info?.imageUrl || null,
      market_cap: Number(p?.marketCap || p?.fdv || 0) || 0,
      contract_address: bt.address || address,
      network_id: DEX_CHAIN_TO_NETWORK[p?.chainId] ?? null,
      external_mentions_24h: 0,
      unique_external_authors_24h: 0,
      _source: 'dexscreener',
      _exactAddress: true,
      _fallback: true,
    }
  } catch { return null }
}

// Flatten nested API structure: { token: {...}, metrics: {...} } -> flat object
function normalizeItem(item) {
  if (!item || !item.token || typeof item.token !== 'object') return item
  const t = item.token
  const m = item.metrics || {}
  return {
    ...t,
    ...m,
    image: t.image_small || t.image_url,
    unique_authors_24h: m.unique_external_authors_24h,
    author_count: m.unique_external_authors_24h,
    mentions: m.external_mentions,
    latest_mention_at: item.latest_mention_at,
    top_authors: item.top_authors,
    quality: item.quality,
    state: item.state,
  }
}

function normalizeResponse(data) {
  if (!data) return data
  return {
    ...data,
    tokens: (data.tokens || []).map(normalizeItem),
    featured_majors: (data.featured_majors || []).map(normalizeItem),
  }
}

export function useXDashSearch(params = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)
  const debounceRef = useRef(null)
  const paramsRef = useRef(params)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const search = useCallback((query, searchParams) => {
    const mergedParams = { ...paramsRef.current, ...searchParams }

    // Clear previous debounce
    if (debounceRef.current) clearTimeout(debounceRef.current)

    // Clear results if query is empty
    if (!query || query.trim().length < 2) {
      setData(null)
      setLoading(false)
      setError(null)
      abortRef.current?.abort()
      return
    }

    setLoading(true)
    setError(null)

    debounceRef.current = setTimeout(async () => {
      // Abort previous request
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      const signal = abortRef.current.signal

      const trimmed = query.trim()
      const tokenQs = new URLSearchParams({
        q: trimmed,
        page: mergedParams.page || '1',
        per_page: mergedParams.perPage || '10',
        timeframe: mergedParams.timeframe || '24h',
        segment: mergedParams.segment || 'all',
        market: mergedParams.market || 'all',
        min_kols: mergedParams.minKols || '1',
      })
      // KOL directory lookup runs in parallel — the upstream /kols endpoint
      // accepts q and returns paginated authors with the same shape the
      // author drawer consumes (rest_id, screen_name, name, avatar, etc).
      const creatorQs = new URLSearchParams({
        q: trimmed,
        per_page: String(mergedParams.creatorPerPage || 8),
        page: '1',
        timeframe: mergedParams.timeframe || '24h',
      })

      // a pasted contract address (EVM 0x… or a Solana base58 mint): neither
      // X Dash, CoinGecko, nor /v1/search index tokens by contract. DexScreener
      // (keyless, below) is the dependable all-chain resolver; Codex is queried
      // too but only matches addresses it indexes. Detect it to rank the exact
      // resolved token first.
      const looksLikeAddress = /^0x[a-fA-F0-9]{40}$/.test(trimmed) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)

      try {
        const [tokenRes, creatorRes, spectreRes, codexRes, dexRes] = await Promise.allSettled([
          fetch(`/api/xdash/search?${tokenQs}`, { credentials: 'include', signal }).then(async (r) => {
            if (!r.ok) throw new Error('Token search unavailable')
            return r.json()
          }),
          fetch(`/api/xdash/kols?${creatorQs}`, { credentials: 'include', signal }).then(async (r) => {
            if (!r.ok) throw new Error('Creator search unavailable')
            return r.json()
          }),
          // Spectre's broader token index — covers projects that are NOT in the
          // X Dash universe and NOT on CoinGecko (fresh on-chain tokens). This is
          // the "find other projects" source; it's complementary to CG (CG and
          // Spectre surface different long-tail tokens), so we merge both.
          getSpectreSearch(trimmed, 15).catch(() => null),
          // Codex (on-chain/DEX) — finds DEX tokens the others miss, and powers
          // the chart/price on the /token page after a result is clicked. Codex
          // works in prod (the DEV .env key is deactivated → 403 locally), but
          // its phrase search only matches addresses it has indexed, so it can
          // miss a long-tail micro-cap — DexScreener below covers that case.
          codexSearchTokens(trimmed).catch(() => null),
          // DexScreener — keyless, all-chain resolver for a pasted CONTRACT
          // ADDRESS. The dependable path: resolves any chain regardless of which
          // index has the token, so a colliding ticker can't bury it.
          looksLikeAddress ? resolveAddressViaDexScreener(trimmed, signal) : Promise.resolve(null),
        ])

        const tokenPayload = tokenRes.status === 'fulfilled' ? tokenRes.value : {}
        const normalized = normalizeResponse(tokenPayload) || { tokens: [], featured_majors: [] }
        if (!Array.isArray(normalized.tokens)) normalized.tokens = []

        // Dedup key strips the "$" prefix on-chain tickers self-report
        // ("$PAAL" vs CG's "PAAL") — raw keys let the same asset in twice
        // when it exists in both a CG-indexed source and Codex/on-chain.
        const symKey = (s) => String(s || '').toUpperCase().replace(/^\$+/, '')
        const seenSymbols = new Set(
          normalized.tokens.map((t) => symKey(t.symbol)).filter(Boolean),
        )

        // Fallback: if X Dash returned no tokens, try CoinGecko search.
        if (normalized.tokens.length === 0 && trimmed.length >= 2) {
          try {
            const cgResults = await searchCoinsForROI(trimmed)
            for (const c of cgResults) {
              const sym = symKey(c.symbol)
              if (!sym || seenSymbols.has(sym)) continue
              seenSymbols.add(sym)
              normalized.tokens.push({
                cg_id: c.id,
                name: c.name,
                symbol: c.symbol,
                cashtag: `$${c.symbol}`,
                image_small: `https://assets.coingecko.com/coins/images/1/small/${c.id}.png`,
                external_mentions_24h: 0,
                unique_external_authors_24h: 0,
                _source: 'coingecko',
                _fallback: true,
              })
            }
          } catch { /* CoinGecko fallback is best-effort */ }
        }

        // Always enrich with Spectre's on-chain index — appends de-duped tokens
        // (incl. ones with no CoinGecko listing) so non-CG projects are findable
        // even when X Dash or CoinGecko already returned hits.
        const spectreCoins = spectreRes.status === 'fulfilled' && Array.isArray(spectreRes.value?.coins)
          ? spectreRes.value.coins : []
        let appended = 0
        for (const c of spectreCoins) {
          if (appended >= 12) break
          const sym = symKey(c.symbol)
          if (!sym || seenSymbols.has(sym)) continue
          seenSymbols.add(sym)
          appended += 1
          normalized.tokens.push({
            cg_id: c.coingecko_id || null,
            token_id: c.coingecko_id || null,
            name: c.name || sym,
            symbol: c.symbol,
            cashtag: `$${c.symbol}`,
            image_small: c.image || null,
            image_url: c.image || null,
            market_cap: c.market_cap || 0,
            external_mentions_24h: 0,
            unique_external_authors_24h: 0,
            _source: c.coingecko_id ? 'coingecko' : 'onchain',
            _fallback: true,
          })
        }

        // Codex (on-chain/DEX) results — DEX tokens the other sources miss, plus
        // the exact match for a pasted contract address. Carries address + network
        // so these rows can deep-link to the on-chain token page.
        const codexResults = codexRes.status === 'fulfilled' && Array.isArray(codexRes.value?.filterTokens?.results)
          ? codexRes.value.filterTokens.results : []
        const codexMapped = []
        for (const it of codexResults) {
          const tk = (it && it.token) ? it.token : (it || {})
          const sym = symKey(tk.symbol || it.symbol)
          if (!sym) continue
          codexMapped.push({
            sym,
            addr: tk.address || it.address || null,
            mapped: {
              cg_id: null,
              token_id: null,
              name: tk.name || it.name || sym,
              symbol: tk.symbol || sym,
              cashtag: `$${tk.symbol || sym}`,
              image_small: (tk.info && tk.info.imageThumbUrl) || tk.image || it.image || null,
              image_url: (tk.info && tk.info.imageThumbUrl) || null,
              market_cap: Number(it.marketCap || tk.marketCap || 0) || 0,
              contract_address: tk.address || it.address || null,
              network_id: tk.networkId || it.networkId || null,
              external_mentions_24h: 0,
              unique_external_authors_24h: 0,
              _source: 'onchain',
              _codex: true,
              _fallback: true,
            },
          })
        }
        // A pasted contract address → put the exact Codex hit at the TOP.
        if (looksLikeAddress && codexMapped.length) {
          const exact = codexMapped.find((c) => String(c.addr || '').toLowerCase() === trimmed.toLowerCase()) || codexMapped[0]
          if (exact && !seenSymbols.has(exact.sym)) {
            seenSymbols.add(exact.sym)
            normalized.tokens.unshift(exact.mapped)
          }
        }
        let codexAppended = 0
        for (const c of codexMapped) {
          if (codexAppended >= 8) break
          if (!c.sym || seenSymbols.has(c.sym)) continue
          seenSymbols.add(c.sym)
          codexAppended += 1
          normalized.tokens.push(c.mapped)
        }

        // A pasted address resolved by DexScreener is the exact token the user
        // asked for - put it at the very TOP, replacing any duplicate of the
        // same contract so it never gets buried under a same-symbol major.
        const dexTok = dexRes.status === 'fulfilled' ? dexRes.value : null
        if (dexTok && dexTok.symbol) {
          const dca = String(dexTok.contract_address || '').toLowerCase()
          const rest = normalized.tokens.filter(
            (t) => String(t.contract_address || t.address || '').toLowerCase() !== dca,
          )
          normalized.tokens = [dexTok, ...rest]
          seenSymbols.add(symKey(dexTok.symbol))
        }

        // Attach creators on the same payload so callers get { tokens, creators }
        // in one render — avoids two loading states for the same search.
        const creatorPayload = creatorRes.status === 'fulfilled' ? creatorRes.value : null
        normalized.creators = Array.isArray(creatorPayload?.authors)
          ? creatorPayload.authors.map((a) => ({
              rest_id: a.rest_id || a.id,
              screen_name: a.screen_name,
              name: a.name || a.screen_name,
              avatar_image_url: a.avatar_image_url || a.profile_image_url,
              description: a.description,
              followers_count: a.followers_count,
              tokens_mentioned_count: a.tokens_mentioned_count || (Array.isArray(a.tokens) ? a.tokens.length : 0),
              mention_count: a.mention_count || a.row_count,
              is_blue_verified: a.is_blue_verified,
              legacy_verified: a.legacy_verified,
            }))
          : []

        setData(normalized)
      } catch (e) {
        if (e.name === 'AbortError') return
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)
  }, [])

  const clear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    abortRef.current?.abort()
    setData(null)
    setLoading(false)
    setError(null)
  }, [])

  return { data, loading, error, search, clear }
}
