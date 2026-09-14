/**
 * useThemes Hook
 * Fetches real-time dominant themes from /api/calendar/themes.
 * Polls every 15 minutes. Falls back to empty array (triggers shimmer).
 * Also fetches analysis history for the timeline.
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { fetchCalendarJson } from './useCalendarData'

const POLL_MS = 15 * 60 * 1000 // 15 minutes
// Dedup TTL for the themes/history reads. The 15-min poll always wants fresh
// data, so use a short window that only collapses mount-time + StrictMode
// double-fires, not the legitimate poll refresh.
const THEMES_DEDUP_TTL = 5000

export default function useThemes({ enabled = true, initialThemes = null, initialHistory = null } = {}) {
  const seedThemes = Array.isArray(initialThemes?.themes) ? initialThemes.themes : null
  const seedHistory = Array.isArray(initialHistory?.history) ? initialHistory.history : null
  const [themes, setThemes] = useState(seedThemes || [])
  const [loading, setLoading] = useState(!seedThemes)
  const [history, setHistory] = useState(seedHistory || [])
  const [historyLoading, setHistoryLoading] = useState(!seedHistory)
  const [updatedAt, setUpdatedAt] = useState(initialThemes?.updatedAt || null)
  const mountedRef = useRef(true)
  const hasSeededThemes = Boolean(seedThemes)
  const hasSeededHistory = Boolean(seedHistory)

  const fetchThemes = useCallback(async () => {
    try {
      const data = await fetchCalendarJson('/api/calendar/themes', { ttl: THEMES_DEDUP_TTL })

      if (mountedRef.current && data?.themes?.length > 0) {
        setThemes(data.themes)
        setUpdatedAt(data.updatedAt || null)
      }
    } catch (err) {
      // silently handled
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  const fetchHistory = useCallback(async () => {
    try {
      const data = await fetchCalendarJson('/api/calendar/history?limit=20', { ttl: THEMES_DEDUP_TTL })

      if (mountedRef.current && data?.history) {
        setHistory(data.history)
      }
    } catch (err) {
      // silently handled
    } finally {
      if (mountedRef.current) setHistoryLoading(false)
    }
  }, [])

  // Fetch on mount, but only when enabled (gated to viewport visibility).
  // Skip first fetches if the bundle already seeded data.
  useEffect(() => {
    mountedRef.current = true
    if (enabled) {
      if (!hasSeededThemes) fetchThemes()
      if (!hasSeededHistory) fetchHistory()
    }
    return () => { mountedRef.current = false }
  }, [enabled, fetchThemes, fetchHistory, hasSeededThemes, hasSeededHistory])

  // Poll themes
  useAdaptivePolling(fetchThemes, { interval: POLL_MS, enabled })

  return {
    themes,
    loading,
    history,
    historyLoading,
    updatedAt,
    refetchThemes: fetchThemes,
    refetchHistory: fetchHistory,
  }
}
