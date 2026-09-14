/**
 * Signal Engine — generates intelligence feed signals from existing data sources.
 * Runs globally in AppShell. Polls lightweight APIs on slow intervals
 * and pushes signals to the notification store when thresholds are met.
 *
 * Signal sources (Phase 1):
 *   1. Fear & Greed sentiment shifts
 *   2. Breaking news detection
 *   3. Top market movers (large % swings)
 *
 * Each source maintains its own "last seen" state to avoid duplicates.
 */
import { useEffect, useRef, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import useNotificationStore from '@/store/useNotificationStore'
import { getFearGreedCurrent } from '@/services/fearGreedApi'
import { getCryptoNews } from '@/services/cryptoNewsApi'

const POLL_INTERVAL = 60_000 // 60 seconds
const MOVER_THRESHOLD = 5 // % change to trigger signal

/**
 * Classify fear & greed value into a human label.
 */
function fgClassification(value) {
  if (value <= 20) return 'Extreme Fear'
  if (value <= 40) return 'Fear'
  if (value <= 60) return 'Neutral'
  if (value <= 80) return 'Greed'
  return 'Extreme Greed'
}

export default function useSignalEngine({ enabled = true } = {}) {
  const addSignal = useNotificationStore((s) => s.addSignal)
  const clearOld = useNotificationStore((s) => s.clearOld)
  const lastFgRef = useRef(null)
  const seenNewsRef = useRef(new Set())
  const mountedRef = useRef(true)

  const poll = useCallback(async () => {
    if (!mountedRef.current || !enabled) return

    // 1. Fear & Greed shifts
    try {
      const fg = await getFearGreedCurrent()
      if (fg && fg.value != null && mountedRef.current) {
        const currentClass = fgClassification(fg.value)
        const prevClass = lastFgRef.current

        if (prevClass && prevClass !== currentClass) {
          addSignal({
            id: `fg-shift-${Date.now()}`,
            category: 'market',
            title: `Sentiment shifted to ${currentClass}`,
            body: `Fear & Greed Index moved from ${prevClass} to ${currentClass} (${fg.value}/100).`,
            priority: currentClass.includes('Extreme') ? 1 : 2,
          })
        }
        lastFgRef.current = currentClass
      }
    } catch {
      // Non-critical - skip this cycle
    }

    // 2. Breaking / high-impact news
    try {
      const news = await getCryptoNews(null, 5)
      if (Array.isArray(news) && mountedRef.current) {
        for (const article of news) {
          const newsId = `news-${article.id || article.title?.slice(0, 40)}`
          if (seenNewsRef.current.has(newsId)) continue
          seenNewsRef.current.add(newsId)

          // Only signal if article is recent (< 30 min)
          const age = Date.now() - (article.publishedOn || article.published_on || 0) * 1000
          if (age > 30 * 60 * 1000) continue

          addSignal({
            id: newsId,
            category: 'news',
            title: article.title,
            body: article.source ? `via ${article.source}` : undefined,
            priority: 2,
            meta: { url: article.url },
          })
        }

        // Cap seen set to prevent memory growth
        if (seenNewsRef.current.size > 200) {
          const arr = [...seenNewsRef.current]
          seenNewsRef.current = new Set(arr.slice(-100))
        }
      }
    } catch {
      // Non-critical
    }

    // 3. Top movers (via Fear & Greed API's getTopMovers - already cached)
    try {
      const { getTopMovers } = await import('@/services/fearGreedApi')
      const movers = await getTopMovers()
      if (movers && mountedRef.current) {
        const gainers = movers.gainers || movers.top_gainers || []
        const losers = movers.losers || movers.top_losers || []

        for (const token of [...gainers.slice(0, 2), ...losers.slice(0, 2)]) {
          const change = parseFloat(token.price_change_percentage_24h || token.change24h || 0)
          if (Math.abs(change) < MOVER_THRESHOLD) continue

          const symbol = (token.symbol || '').toUpperCase()
          const moverId = `mover-${symbol}-${new Date().toDateString()}`

          // One signal per token per day
          addSignal({
            id: moverId,
            category: 'watchlist',
            title: `${symbol} ${change > 0 ? '+' : ''}${change.toFixed(1)}% today`,
            body: token.name || symbol,
            priority: Math.abs(change) > 10 ? 1 : 2,
          })
        }
      }
    } catch {
      // Non-critical
    }
  }, [addSignal, enabled])

  useEffect(() => {
    mountedRef.current = true

    // Clean stale signals on mount (cheap localStorage prune, run regardless)
    clearOld()

    if (!enabled) return () => { mountedRef.current = false }

    // Initial poll after short delay (let app hydrate first)
    const initTimer = setTimeout(poll, 3000)

    return () => {
      mountedRef.current = false
      clearTimeout(initTimer)
    }
  }, [poll, clearOld, enabled])

  // Poll signals with adaptive intervals — only while enabled
  useAdaptivePolling(poll, { interval: POLL_INTERVAL, enabled })
}
