/**
 * useCategoryInsight - real LLM read for a category detail view.
 *
 * Posts the category's live composite (breadth, avg moves, leaders/laggards,
 * volume concentration) to /api/insight (llm-gateway backed, tier-gated) and
 * returns { title, body, historical, actions[] }. The caller keeps rendering
 * its deterministic computed read instantly; this upgrades it in place when
 * the model answers. Fails silent - no insight is better than fake insight.
 *
 * Cached 10 min per category in sessionStorage so tab-hopping between
 * categories doesn't burn the (10 req/min rate-limited) endpoint.
 */
import { useState, useEffect, useRef } from 'react'

const TTL = 10 * 60 * 1000
const memCache = new Map()

const cacheKey = (id) => `spectre-catinsight-v1:${id}`

function readCache(id) {
  const m = memCache.get(id)
  if (m && Date.now() - m.ts < TTL) return m
  try {
    const raw = sessionStorage.getItem(cacheKey(id))
    if (!raw) return null
    const { ts, data } = JSON.parse(raw)
    if (!data || Date.now() - ts > TTL) return null
    memCache.set(id, { ts, data })
    return { ts, data }
  } catch { return null }
}

function writeCache(id, data) {
  memCache.set(id, { ts: Date.now(), data })
  try { sessionStorage.setItem(cacheKey(id), JSON.stringify({ ts: Date.now(), data })) } catch {}
}

const pick = (c) => ({
  symbol: (c.symbol || '').toUpperCase(),
  change_24h_pct: +((c.price_change_percentage_24h || 0).toFixed(2)),
  change_7d_pct: +((c.price_change_percentage_7d_in_currency || 0).toFixed(2)),
})

const pickCat = (c) => ({
  sector: c.name,
  change_24h_pct: +((c.market_cap_change_24h || 0).toFixed(2)),
  market_cap_usd: Math.round(c.market_cap || 0),
})

// Same machinery pointed at the whole sector landscape (the categories LIST
// page): one LLM read across all ~250 categories - rotation, breadth, where
// capital is moving. Cached under a single key since the input is global.
export function useSectorLandscapeInsight({ categories, enabled = true }) {
  const [insight, setInsight] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const fetchedRef = useRef(false)
  const CACHE_ID = 'sector-landscape'
  const ready = enabled && Array.isArray(categories) && categories.length >= 20

  useEffect(() => {
    const cached = readCache(CACHE_ID)
    if (cached) { setInsight(cached.data); setUpdatedAt(cached.ts); fetchedRef.current = true }
  }, [])

  useEffect(() => {
    if (!ready || fetchedRef.current) return
    fetchedRef.current = true
    let cancelled = false

    const cats = categories.filter((c) => (c.market_cap || 0) > 0)
    const byChange = [...cats].sort((a, b) => (b.market_cap_change_24h || 0) - (a.market_cap_change_24h || 0))
    const byMcap = [...cats].sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0))
    const total = cats.length
    const advancing = cats.filter((c) => (c.market_cap_change_24h || 0) > 0).length
    const avg = cats.reduce((s, c) => s + (c.market_cap_change_24h || 0), 0) / (total || 1)

    const payload = {
      metricType: 'sector',
      metricValue: `${avg >= 0 ? '+' : ''}${avg.toFixed(2)}% average 24h move across ${total} crypto sectors (${Math.round((advancing / (total || 1)) * 100)}% advancing)`,
      metricLabel: 'Crypto sector landscape',
      context: {
        timeframe: '24h',
        additionalContext: {
          sectors_tracked: total,
          advancing,
          declining: total - advancing,
          avg_change_24h_pct: +avg.toFixed(2),
          largest_sectors: byMcap.slice(0, 5).map(pickCat),
          top_gaining_sectors: byChange.slice(0, 5).map(pickCat),
          top_losing_sectors: byChange.slice(-5).reverse().map(pickCat),
        },
      },
    }

    fetch('/api/insight', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(18000),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return
        const ins = j?.insight
        if (ins && !j.fallback && ins.title && ins.body) {
          const clean = {
            title: String(ins.title),
            body: String(ins.body),
            historical: ins.historical ? String(ins.historical) : null,
            actions: Array.isArray(ins.actions)
              ? ins.actions.filter((a) => a && a.text).slice(0, 3).map((a) => ({
                  type: ['bullish', 'bearish', 'neutral'].includes(a.type) ? a.type : 'neutral',
                  text: String(a.text),
                }))
              : [],
          }
          setInsight(clean)
          setUpdatedAt(Date.now())
          writeCache(CACHE_ID, clean)
        }
      })
      .catch(() => {})

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  return { insight, updatedAt }
}

export default function useCategoryInsight({ category, coins, enabled = true }) {
  const [insight, setInsight] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [loading, setLoading] = useState(false)
  const fetchedForRef = useRef(null)
  const catId = category?.id || null
  const ready = enabled && !!catId && Array.isArray(coins) && coins.length >= 5

  // Category switch: paint from cache instantly or clear.
  useEffect(() => {
    if (!catId) { setInsight(null); setUpdatedAt(null); fetchedForRef.current = null; return }
    const cached = readCache(catId)
    if (cached) { setInsight(cached.data); setUpdatedAt(cached.ts); fetchedForRef.current = catId } else { setInsight(null); setUpdatedAt(null) }
  }, [catId])

  useEffect(() => {
    if (!ready || fetchedForRef.current === catId) return
    fetchedForRef.current = catId
    let cancelled = false
    setLoading(true)

    const priced = coins.filter((c) => (c.current_price || 0) > 0)
    const byChange = [...priced].sort((a, b) => (b.price_change_percentage_24h || 0) - (a.price_change_percentage_24h || 0))
    const byVolume = [...priced].sort((a, b) => (b.total_volume || 0) - (a.total_volume || 0))
    const byMcap = [...priced].sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0))
    const total = priced.length
    const advancing = priced.filter((c) => (c.price_change_percentage_24h || 0) > 0).length
    const avg24 = priced.reduce((s, c) => s + (c.price_change_percentage_24h || 0), 0) / (total || 1)
    const avg7d = priced.reduce((s, c) => s + (c.price_change_percentage_7d_in_currency || 0), 0) / (total || 1)
    const totalMcap = priced.reduce((s, c) => s + (c.market_cap || 0), 0)
    const top3Mcap = byMcap.slice(0, 3).reduce((s, c) => s + (c.market_cap || 0), 0)

    const payload = {
      metricType: 'sector',
      metricValue: `${avg24 >= 0 ? '+' : ''}${avg24.toFixed(2)}% average 24h move across ${total} tokens (${Math.round((advancing / (total || 1)) * 100)}% advancing)`,
      metricLabel: `${category.name} sector`,
      context: {
        sector: category.name,
        timeframe: '24h',
        additionalContext: {
          sector_market_cap_usd: Math.round(category.market_cap || totalMcap),
          sector_volume_24h_usd: Math.round(category.volume_24h || 0) || undefined,
          avg_change_24h_pct: +avg24.toFixed(2),
          avg_change_7d_pct: +avg7d.toFixed(2),
          advancing,
          declining: total - advancing,
          top3_market_cap_share_pct: totalMcap > 0 ? +((top3Mcap / totalMcap) * 100).toFixed(1) : undefined,
          largest_tokens: byMcap.slice(0, 3).map((c) => (c.symbol || '').toUpperCase()),
          top_gainers_24h: byChange.slice(0, 3).map(pick),
          top_losers_24h: byChange.slice(-3).reverse().map(pick),
          volume_leaders: byVolume.slice(0, 3).map((c) => ({ symbol: (c.symbol || '').toUpperCase(), volume_24h_usd: Math.round(c.total_volume || 0) })),
        },
      },
    }

    // credentials: 'include' is mandatory - the intel-api gate cookie is
    // HttpOnly and iOS PWA drops it on same-origin-default fetches.
    fetch('/api/insight', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(18000),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return
        const ins = j?.insight
        if (ins && !j.fallback && ins.title && ins.body) {
          const clean = {
            title: String(ins.title),
            body: String(ins.body),
            historical: ins.historical ? String(ins.historical) : null,
            actions: Array.isArray(ins.actions)
              ? ins.actions.filter((a) => a && a.text).slice(0, 3).map((a) => ({
                  type: ['bullish', 'bearish', 'neutral'].includes(a.type) ? a.type : 'neutral',
                  text: String(a.text),
                }))
              : [],
          }
          setInsight(clean)
          setUpdatedAt(Date.now())
          writeCache(catId, clean)
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
    // `coins` is intentionally not a dep: we generate once per category from the
    // first settled page - load-more shouldn't re-bill the LLM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, catId])

  return { insight, loading, updatedAt }
}
