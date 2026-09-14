import { useState, useEffect } from 'react'
import { COINGECKO_ID_TO_SYMBOL } from '@/lib/tokenSlugs'
import { getSpectrePricesBySymbols } from '@/services/spectreMarketApi'
import { isAppActive } from '@/lib/idleManager'

/**
 * X Dash live price hook.
 *
 * Used by every token row + drawer to join real USD price + 24h Δ + market
 * cap onto the X Dash leaderboard (which doesn't carry price data).
 *
 * Two source chain (Spectre Market API first, CoinGecko fallback) and the
 * results are cached per-cgId in a module-level Map so revisiting a drawer
 * paints instantly from cache instead of refetching.
 *
 * Race fix: the prior version stored ONE result slot keyed by the joined
 * id list. Opening drawer A then drawer B before A's fetch landed threw
 * A's response away when the hook unmounted - and lost it forever because
 * the cache slot had been overwritten to B's idsKey. Now A's per-cgId
 * entry is written to the Map even when the component is gone, so the
 * next time A opens it paints immediately.
 */

const COINGECKO_API = '/api/coingecko'
const CACHE_TTL = 30_000
const POLL_INTERVAL = 30_000
const FETCH_TIMEOUT = 10_000

/* per-cgId cache survives across hook instances. Map<cgId, {data, ts}>
   where data has { price, change24h, marketCap }. */
const _priceCache = new Map()

/* dedup in-flight CG fetches keyed by the SORTED idsKey so two drawers
   asking for the same set don't fire two requests. */
const _inflight = new Map()

/* CoinGecko reports a wrong (partial) circulating supply for a few tokens, so its
   market cap comes out far too low. For these the on-chain supply is fully liquid
   (e.g. a pump.fun token's fixed 1B mint), so the correct market cap = live price x
   full supply - the same figure Codex / DexScreener show. Keyed by cgId so no other
   token is affected; remove an entry once CoinGecko fixes its supply.
   - the-black-bull (ANSEM): CG circ ~396M of a ~1B fixed supply -> cap ~2.5x too low. */
const MARKETCAP_SUPPLY_OVERRIDE = {
  'the-black-bull': 1_000_000_000,
}

function cgFreshFor(ids) {
  const out = {}
  for (const id of ids) {
    const entry = _priceCache.get(id)
    if (!entry) return null
    if (Date.now() - entry.ts > CACHE_TTL) return null
    out[id] = entry.data
  }
  return out
}

function writeToCache(mapped) {
  const now = Date.now()
  for (const [id, row] of Object.entries(mapped)) {
    if (!id || !row) continue
    _priceCache.set(id, { data: row, ts: now })
  }
}

async function resolvePrices(idsKey) {
  if (_inflight.has(idsKey)) return _inflight.get(idsKey)

  const ids = idsKey.split(',').filter(Boolean)

  const promise = (async () => {
    /* 1. Try Spectre Market API by symbol (cheap; serves majors). Map
          cgId -> symbol via the COINGECKO_ID_TO_SYMBOL table, or fall
          back to the cgId itself when it's short + lowercase (e.g. `delu`
          -> `DELU`). Long slugs with dashes (`buttcoin-7`, `memecoin-3`)
          are NOT eligible for symbol fallback - they hit CG instead. */
    const idToSymbol = new Map()
    for (const id of ids) {
      const symbol = COINGECKO_ID_TO_SYMBOL[id]
        || (/^[a-z0-9]{2,12}$/i.test(id) && !id.includes('-') ? id.toUpperCase() : null)
      if (symbol) idToSymbol.set(id, symbol)
    }

    const spectreSymbols = [...new Set(Array.from(idToSymbol.values()))]
    const mapped = {}
    if (spectreSymbols.length > 0) {
      const spectrePrices = await getSpectrePricesBySymbols(spectreSymbols).catch(() => ({}))
      for (const [id, symbol] of idToSymbol.entries()) {
        const row = spectrePrices?.[symbol]
        /* Only accept the Spectre row when it carries a real price. The
           bridge is symbol-keyed, so a guessed ticker can come back as a
           row with price 0/null - accepting it used to mark the id as
           resolved and skip the CoinGecko fallback below, leaving the
           drawer's price shimmer spinning forever. */
        if (!row || !(Number(row.price) > 0)) continue
        mapped[id] = {
          price: row.price,
          change24h: row.change24 ?? row.change,
          marketCap: row.marketCap,
        }
      }
    }

    /* 2. CoinGecko fallback for any id Spectre didn't return. */
    const missingIds = ids.filter((id) => !mapped[id])
    if (missingIds.length > 0) {
      const url = `${COINGECKO_API}/simple/price?ids=${encodeURIComponent(missingIds.join(','))}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
        if (res.ok) {
          const data = await res.json()
          for (const [id, val] of Object.entries(data)) {
            mapped[id] = {
              price: val.usd,
              change24h: val.usd_24h_change,
              marketCap: val.usd_market_cap,
            }
          }
        }
      } catch (err) {
        console.error('[useXDashPrices]', err.message)
      }
    }

    /* Correct market cap for tokens CoinGecko mis-supplies: recompute from the live
       price x the real full supply (Codex-equivalent), scoped by cgId. Price is left
       untouched - only the cap is corrected. */
    for (const id of Object.keys(mapped)) {
      const fullSupply = MARKETCAP_SUPPLY_OVERRIDE[id]
      const px = Number(mapped[id]?.price)
      if (fullSupply && px > 0) mapped[id] = { ...mapped[id], marketCap: px * fullSupply }
    }

    /* Write to per-id cache REGARDLESS of whether the consumer is still
       mounted - next mount of the same drawer needs to find this. */
    writeToCache(mapped)
    return mapped
  })()
    .finally(() => { _inflight.delete(idsKey) })

  _inflight.set(idsKey, promise)
  return promise
}

export function useXDashPrices(cgIds = []) {
  const [prices, setPrices] = useState({})
  const validIds = cgIds.filter(Boolean)
  const idsKey = [...validIds].sort().join(',')

  /* Paint from cache synchronously on mount (or when idsKey changes) so
     the user sees price the instant the drawer opens IF we've fetched
     this token in the last 30s. */
  useEffect(() => {
    if (!idsKey) return
    const ids = idsKey.split(',').filter(Boolean)
    const fromCache = cgFreshFor(ids)
    if (fromCache) setPrices(fromCache)
  }, [idsKey])

  useEffect(() => {
    if (!idsKey) return
    let cancelled = false

    async function refresh() {
      try {
        const mapped = await resolvePrices(idsKey)
        if (cancelled) return
        if (mapped && Object.keys(mapped).length > 0) setPrices(mapped)
      } catch (err) {
        if (!cancelled) console.error('[useXDashPrices]', err.message)
      }
    }

    refresh()

    const interval = window.setInterval(() => {
      // Skip when the tab is hidden OR visible-but-idle (mirrors the rest of the
      // xdash hooks retrofitted in the wave-1 C3 sweep; this one was missed).
      if (document.hidden || !isAppActive()) return
      refresh()
    }, POLL_INTERVAL)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [idsKey])

  return prices
}
