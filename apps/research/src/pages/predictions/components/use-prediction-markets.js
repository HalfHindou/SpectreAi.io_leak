/**
 * usePredictionMarkets — merges Polymarket + Kalshi into ONE blended grid.
 *
 * Both services return the SAME card shape; Polymarket cards are tagged
 * source:'polymarket' here (the service doesn't set it), Kalshi cards already
 * carry source:'kalshi'. Cards are deduped by a normalized question key
 * (prefer the higher-volume venue), filtered by the active UI category (mapped
 * to the API id via CATEGORY_API_MAP), sorted, and the cross-source arbitrage
 * spreads are computed from the unfiltered 'all' card sets.
 *
 * Returns an object (never an array) per hook convention.
 */
import { useState, useEffect, useMemo } from 'react'
import {
  getPredictionEventCards,
  getPredictionEventCardsCached,
} from '@/services/polymarketApi'
import {
  getKalshiEventCards,
  getKalshiEventCardsCached,
  findCrossSourceArbitrage,
} from '@/services/kalshiApi'
import { CATEGORY_API_MAP } from './predictions-constants'

const GRID_LIMIT = 60
const ARB_POOL = 120

// Tag a Polymarket card with its source (the service doesn't set one) without
// mutating the cached object.
function tagPoly(cards) {
  if (!Array.isArray(cards)) return []
  return cards.map((c) =>
    c.source ? c : { ...c, source: 'polymarket', outcomes: c.outcomes }
  )
}

// Normalize a question to a dedupe key: lowercase, strip punctuation/extra
// space. Same real-world question on both venues collapses to one key.
function dedupeKey(card) {
  const top = card.outcomes?.[0]
  const base = top?.label ? `${card.title} ${top.label}` : (card.title || top?.question || '')
  return base.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

// Merge + dedupe two card arrays. On a key collision the higher-volume venue
// wins (it's the more liquid, more trustworthy quote).
function mergeCards(poly, kalshi) {
  const byKey = new Map()
  for (const card of [...poly, ...kalshi]) {
    if (!card || !Array.isArray(card.outcomes) || card.outcomes.length === 0) continue
    const key = dedupeKey(card)
    if (!key) { byKey.set(`${card.source}-${card.id}`, card); continue }
    const prev = byKey.get(key)
    if (!prev || (card.totalVolume || 0) > (prev.totalVolume || 0)) byKey.set(key, card)
  }
  return [...byKey.values()].sort((a, b) => (b.totalVolume || 0) - (a.totalVolume || 0))
}

function apiCatFor(uiCat) {
  if (uiCat === 'trending' || uiCat === 'new') return 'all'
  return CATEGORY_API_MAP[uiCat] || uiCat
}

// Build the blended set for a UI category straight from the in-memory caches
// (sync — no fetch). Returns null when BOTH caches are cold.
function computeFromCache(uiCat) {
  const apiCat = apiCatFor(uiCat)
  const poly = getPredictionEventCardsCached(apiCat, GRID_LIMIT)
  const kalshi = getKalshiEventCardsCached(apiCat, GRID_LIMIT)
  if (poly === null && kalshi === null) return null
  let merged = mergeCards(tagPoly(poly || []), kalshi || [])
  if (uiCat === 'new') {
    merged = [...merged].sort((a, b) => {
      const aId = parseInt(String(a.id).split('-')[0]) || 0
      const bId = parseInt(String(b.id).split('-')[0]) || 0
      return bId - aId
    })
  }
  return merged.slice(0, GRID_LIMIT)
}

export function usePredictionMarkets(activeCategory) {
  const [events, setEvents] = useState(() => computeFromCache(activeCategory) || [])
  const [loading, setLoading] = useState(() => (computeFromCache(activeCategory)?.length ?? 0) === 0)
  const [arb, setArb] = useState([])

  // Populate the grid for the active category. Runs on mount AND on every tab
  // switch (keyed on activeCategory). Paints instantly from the warm cache;
  // only fetches (and shows the skeleton) when that category is cold. ALWAYS
  // clears `loading` once settled — the previous early-return path could leave
  // the skeleton stuck forever after another consumer warmed the cache.
  useEffect(() => {
    let cancelled = false
    const cached = computeFromCache(activeCategory)
    if (cached !== null) {
      setEvents(cached)
      setLoading(false)
      return
    }
    setLoading(true)
    ;(async () => {
      const apiCat = apiCatFor(activeCategory)
      // Settle either source independently — one venue down shouldn't block the
      // other from painting.
      await Promise.allSettled([
        getPredictionEventCards(apiCat, GRID_LIMIT),
        getKalshiEventCards(apiCat, GRID_LIMIT),
      ])
      if (cancelled) return
      setEvents(computeFromCache(activeCategory) || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [activeCategory])

  // Warm the 'all' pools (both venues) for the arbitrage spotlight + masthead
  // aggregate, then compute spreads. Independent of the active category.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [poly, kalshi] = await Promise.all([
        getPredictionEventCards('all', ARB_POOL).catch(() => []),
        getKalshiEventCards('all', ARB_POOL).catch(() => []),
      ])
      if (cancelled) return
      const spreads = findCrossSourceArbitrage(tagPoly(poly), kalshi || [], { minSimilarity: 0.4, minSpread: 3 })
      setArb(spreads)
    })()
    return () => { cancelled = true }
  }, [])

  // Which sources are actually represented (drives the masthead label + dots).
  const sources = useMemo(() => {
    const polyCache = getPredictionEventCardsCached('all', 1)
    const kalshiCache = getKalshiEventCardsCached('all', 1)
    const out = []
    if (polyCache && polyCache.length) out.push('polymarket')
    if (kalshiCache && kalshiCache.length) out.push('kalshi')
    return out.length ? out : ['polymarket']
    // recompute when events change (cache may have warmed)
  }, [events, arb])

  // Canonical aggregate: sum totalVolume across BOTH 'all' pools (the page's
  // "open interest" hero metric).
  const aggregate = useMemo(() => {
    const poly = getPredictionEventCardsCached('all', ARB_POOL) || []
    const kalshi = getKalshiEventCardsCached('all', ARB_POOL) || []
    const merged = mergeCards(tagPoly(poly), kalshi)
    const openInterest = merged.reduce((s, e) => s + (e.totalVolume || 0), 0)
    const marketCount = merged.reduce((s, e) => s + (e.outcomes?.length || 0), 0)
    return { openInterest, marketCount }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, arb])

  return { events, loading, arb, sources, aggregate }
}
