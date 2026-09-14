/**
 * useSectorData — Fetches sector performance + top movers from Command Center API.
 *
 * Three endpoints proxied via Express:
 *   /api/market/sectors           — sectors with change_24h, volume, lifecycle, performance
 *   /api/market/sectors/top-movers — top sectors with their top mover token
 *   /api/market/sectors/ai-analysis — AI-generated sector analysis
 *
 * Optional params:
 *   order        — server-side sort: market_cap_desc|market_cap_asc|name_desc|name_asc|
 *                  market_cap_change_24h_desc|market_cap_change_24h_asc
 *   sector_limit — max sectors to return (e.g. 20, 50)
 *
 * Merges top mover data into sector objects for the "Top Movers" section.
 */
import { useState, useEffect, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { getSpectreCategories, getSpectreIntelligenceSignals } from '@/services/spectreMarketApi'

const SECTOR_API = '/api/market/sectors'
const TOP_MOVERS_API = '/api/market/sectors/top-movers'
const AI_ANALYSIS_API = '/api/market/sectors/ai-analysis'
const REFRESH_INTERVAL = 5 * 60 * 1000 // 5 minutes

function mapLifecycle(lifecycle, performance) {
  // Color based on performance (determines dot color in grid + bubble color)
  let color = 'yellow'
  if (performance === 'very_strong' || performance === 'strong') color = 'green'
  else if (performance === 'weak') color = 'red'
  else if (performance === 'flat') color = 'yellow'
  else if (performance === 'positive') color = 'yellow'

  // Stage label from lifecycle
  let stageLabel = 'Mid'
  let stage = 'mid'
  if (lifecycle === 'growth') { stageLabel = 'Growth'; stage = 'growth' }
  else if (lifecycle === 'established') { stageLabel = 'Established'; stage = 'established' }
  else if (lifecycle === 'mature') { stageLabel = 'Mature'; stage = 'mature' }

  return { stage, stageLabel, color }
}

function transformSectors(apiSectors, moversMap) {
  if (!apiSectors || !Array.isArray(apiSectors)) return []

  return apiSectors
    .filter(s => s && s.sector_id && s.sector_name)
    .map(s => {
      const { stage, stageLabel, color } = mapLifecycle(s.lifecycle, s.performance)
      const mover = moversMap?.[s.sector_id]
      return {
        id: s.sector_id,
        name: s.sector_name,
        avgChange: s.change_24h ?? 0,
        totalVolume: s.volume ?? 0,
        stage,
        stageLabel,
        color,
        performance: s.performance,
        lifecycle: s.lifecycle,
        // Top mover data (if available from /top-movers endpoint)
        topMover: mover?.ticker || null,
        topMoverData: mover || null,
      }
    })
    .sort((a, b) => b.avgChange - a.avgChange)
}

function transformSpectreCategories(categories, { order, sectorLimit } = {}) {
  if (!Array.isArray(categories)) return []
  const rows = categories
    .filter((category) => category?.id && category?.name)
    .map((category) => {
      const change = Number(category.market_cap_change_24h ?? category.change_24h ?? 0)
      const volume = Number(category.volume_24h ?? 0)
      const assetCount = Number(category.asset_count ?? 0)
      const lifecycle = Math.abs(change) > 5 ? 'growth' : Math.abs(change) > 2 ? 'established' : 'mature'
      const performance = change > 5 ? 'strong' : change < -5 ? 'weak' : 'flat'
      const { stage, stageLabel, color } = mapLifecycle(lifecycle, performance)
      return {
        id: category.slug || category.id,
        name: category.name,
        avgChange: change,
        totalVolume: volume,
        assetCount,
        stage,
        stageLabel,
        color,
        performance,
        lifecycle,
        topMover: null,
        topMoverData: null,
        source: 'spectre-market',
      }
    })

  if (order === 'name_asc') rows.sort((a, b) => a.name.localeCompare(b.name))
  else if (order === 'name_desc') rows.sort((a, b) => b.name.localeCompare(a.name))
  else if (String(order || '').includes('market_cap_change_24h_asc')) rows.sort((a, b) => a.avgChange - b.avgChange)
  else rows.sort((a, b) => (b.totalVolume || b.assetCount || 0) - (a.totalVolume || a.assetCount || 0))

  return rows.slice(0, Number(sectorLimit) || 24)
}

export default function useSectorData({ order, sectorLimit, enabled = true } = {}) {
  const [sectors, setSectors] = useState([])
  const [aiAnalysis, setAiAnalysis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  const fetchSectors = useCallback(async () => {
    if (!enabled) return
    try {
      const [spectreCategories, signals] = await Promise.all([
        getSpectreCategories({ limit: sectorLimit || 80 }).catch(() => []),
        getSpectreIntelligenceSignals({ limit: 5 }).catch(() => []),
      ])
      const spectreRows = transformSpectreCategories(spectreCategories, { order, sectorLimit })
      if (spectreRows.length > 0) {
        setSectors(spectreRows)
        // IMPORTANT: leave aiAnalysis as null on the spectre path. The sectors
        // panel branches on `if (sectorAiAnalysis)` and reads four named keys
        // ('AI Analysis', 'Volume Flow', 'Sector Dispersion', 'Positioning')
        // that this branch doesn't populate. Setting it with `.analysis` only
        // tricks the panel into the API-mode render and produces three empty
        // cards. Returning null forces the rule-based fallback which writes
        // all four sections from the live sector data.
        setAiAnalysis(null)
        setLastUpdated(new Date().toISOString())
        setError(null)
        return
      }

      // Build sector API URL with optional params
      const params = new URLSearchParams()
      if (order) params.set('order', order)
      if (sectorLimit) params.set('sector_limit', sectorLimit)
      const qs = params.toString()
      const sectorUrl = SECTOR_API + (qs ? `?${qs}` : '')

      // Fetch all three endpoints in parallel
      const [sectorsRes, moversRes, aiRes] = await Promise.all([
        fetch(sectorUrl),
        fetch(TOP_MOVERS_API).catch(() => null),
        fetch(AI_ANALYSIS_API).catch(() => null),
      ])

      if (!sectorsRes.ok) throw new Error(`Sector API ${sectorsRes.status}`)
      const sectorsData = await sectorsRes.json()

      // Build lookup map from top movers: sector_id -> top_mover object
      let moversMap = {}
      if (moversRes?.ok) {
        try {
          const moversData = await moversRes.json()
          if (moversData?.top_movers) {
            for (const entry of moversData.top_movers) {
              if (entry.sector_id && entry.top_mover) {
                moversMap[entry.sector_id] = entry.top_mover
              }
            }
          }
        } catch { /* ignore mover parse errors */ }
      }

      // Parse AI analysis response
      if (aiRes?.ok) {
        try {
          const aiData = await aiRes.json()
          setAiAnalysis(aiData)
        } catch { /* ignore AI parse errors */ }
      }

      const transformed = transformSectors(sectorsData.sectors, moversMap)
      setSectors(transformed)
      setLastUpdated(sectorsData.cached_at || new Date().toISOString())
      setError(null)
    } catch (err) {
      setError(err.message)
      // Keep stale data on error
    } finally {
      setLoading(false)
    }
  }, [order, sectorLimit, enabled])

  useEffect(() => {
    if (enabled) fetchSectors()
  }, [fetchSectors, enabled])

  // Poll for sector data with adaptive intervals (pauses on tab hidden).
  // `enabled` gates the whole hook behind a tab so it doesn't fetch/poll
  // market-wide sector data while its panel (Sentiment/Intelligence) is closed.
  useAdaptivePolling(fetchSectors, { interval: REFRESH_INTERVAL, enabled })

  return { sectors, aiAnalysis, loading, error, lastUpdated }
}
