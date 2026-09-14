/**
 * Hook: maps real milestones + live news to chart coordinates.
 * Fetches historical news from CryptoCompare (sampled at intervals) to spread events across the chart.
 */
import { useState, useEffect, useRef, useMemo } from 'react'
import { getSpectreNews } from '@/services/spectreMarketApi'
import { getMilestonesForTimeframe, clusterEvents } from './chartEvents'

const PAD = { top: 14, left: 44 }

/** Binary search for closest F&G data index by timestamp */
function findClosestIndex(fgData, eventTs) {
  let lo = 0, hi = fgData.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (parseInt(fgData[mid].timestamp, 10) < eventTs) lo = mid + 1
    else hi = mid
  }
  if (lo > 0) {
    const dLo = Math.abs(parseInt(fgData[lo].timestamp, 10) - eventTs)
    const dPrev = Math.abs(parseInt(fgData[lo - 1].timestamp, 10) - eventTs)
    if (dPrev < dLo) return lo - 1
  }
  return lo
}

/** Fetch historical news spanning the given number of days */
async function fetchHistoricalNews(days) {
  try {
    // Cap at 40 — clusterEvents collapses dense runs anyway, so a larger
    // payload yields no extra markers. (Was 80.)
    const spectreNews = await getSpectreNews({ symbol: 'BTC', limit: Math.min(40, Math.max(12, Math.ceil(days / 4))) })
    if (spectreNews?.length) {
      return spectreNews.map((item) => ({
        ...item,
        publishedOn: item.publishedOn || (item.publishedAt ? Math.floor(new Date(item.publishedAt).getTime() / 1000) : 0),
      }))
    }

    const res = await fetch(`/api/news/history?days=${days}&symbol=BTC`)
    if (!res.ok) return []
    const json = await res.json()
    return Array.isArray(json.data) ? json.data : []
  } catch {
    return []
  }
}

export function useChartEvents(fgData, timeframe, IW, IH, enabled) {
  const [liveNews, setLiveNews] = useState([])
  const fetchedRef = useRef(0)

  const days = { '7D': 7, '30D': 30, '90D': 90, '1Y': 365, 'ALL': 9999 }[timeframe] ?? 365
  const needDays = Math.min(days, 365)

  // Fetch historical news when enabled or timeframe changes
  useEffect(() => {
    if (!enabled) {
      setLiveNews([])
      fetchedRef.current = 0
      return
    }

    // Don't refetch if we already have enough data
    if (fetchedRef.current >= needDays) return

    let cancelled = false

    fetchHistoricalNews(needDays).then(items => {
      if (cancelled) return

      const seen = new Set()
      const all = []
      for (const n of items) {
        if (!n.publishedOn || n.publishedOn <= 0) continue
        const key = `news-${n.id}`
        if (seen.has(key)) continue
        seen.add(key)
        all.push({
          id: key,
          ts: n.publishedOn,
          type: 'news',
          title: n.title,
          summary: n.summary || '',
          source: n.source,
          url: n.url,
        })
      }

      setLiveNews(all)
      fetchedRef.current = needDays
    })

    return () => { cancelled = true }
  }, [enabled, needDays])

  const clusters = useMemo(() => {
    if (!enabled || !fgData.length || IW <= 0 || IH <= 0) return []

    // Get real milestones for this timeframe
    const milestones = getMilestonesForTimeframe(days)

    // Merge milestones + live news, deduplicate by id
    const seen = new Set()
    const allEvents = []
    for (const e of [...milestones, ...liveNews]) {
      if (!seen.has(e.id)) {
        seen.add(e.id)
        allEvents.push(e)
      }
    }

    // Filter to F&G data range
    const firstTs = parseInt(fgData[0].timestamp, 10)
    const lastTs = parseInt(fgData[fgData.length - 1].timestamp, 10)
    const cutoff = days >= 9999 ? 0 : Math.floor(Date.now() / 1000) - days * 86400
    const inRange = allEvents.filter(e => e.ts >= Math.max(firstTs, cutoff) && e.ts <= lastTs + 86400)

    if (!inRange.length) return []

    // Map each event to chart coordinates
    const n = fgData.length
    const positioned = []
    for (const ev of inRange) {
      const idx = findClosestIndex(fgData, ev.ts)
      const x = PAD.left + (idx / Math.max(1, n - 1)) * IW
      const v = Math.min(100, Math.max(0, fgData[idx].value))
      const y = PAD.top + IH - (v / 100) * IH
      positioned.push({ ...ev, x, y, fgValue: v })
    }

    return clusterEvents(positioned, 28)
  }, [fgData, timeframe, IW, IH, enabled, liveNews, days])

  return { clusters }
}
