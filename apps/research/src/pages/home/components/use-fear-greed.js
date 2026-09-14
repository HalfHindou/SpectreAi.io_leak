/**
 * useFearGreed - Crypto Fear & Greed Index hook
 * Primary: Spectre Data API (/data-api/market/fear-greed)
 * Fallback: api.alternative.me (direct)
 * Returns { value, classification, prev1d, prev7d, prev30d }
 */
import { useState, useEffect, useCallback } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { USE_SPECTRE_API, getFearGreed as spectreFearGreed } from '@/services/spectreDataApi'
import { getFearGreedCurrent } from '@/services/fearGreedApi'
import { snapPeek, snapPut } from '@/lib/snapshotCache'

const INITIAL = { value: 35, classification: 'Fear', prev1d: null, prev7d: null, prev30d: null }

function classifyFng(value) {
  if (value >= 80) return 'Extreme Greed'
  if (value >= 60) return 'Greed'
  if (value >= 40) return 'Neutral'
  if (value >= 20) return 'Fear'
  return 'Extreme Fear'
}

export default function useFearGreed() {
  // PR-4 (perf): hydrate the last real reading instantly (the hardcoded
  // INITIAL is a placeholder "vibe check", not data); refresh silently.
  const [cryptoFearGreed, setCryptoFearGreed] = useState(() => {
    const snap = snapPeek('fear-greed')
    return snap?.data?.value != null ? snap.data : INITIAL
  })

  const fetchFng = useCallback(async () => {
    // Primary: cached Spectre market bridge. This avoids the local generic
    // /api proxy, which is often not running during frontend-only development.
    try {
      const data = await getFearGreedCurrent()
      const value = data.value ?? data.score ?? parseInt(data.fgi ?? data.fear_greed_index, 10)
      if (value != null && !isNaN(value)) {
        const next = {
          value,
          classification: data.classification ?? data.value_classification ?? classifyFng(value),
          prev1d: data.prev1d ?? data.previous_1d ?? null,
          prev7d: data.prev7d ?? data.previous_7d ?? null,
          prev30d: data.prev30d ?? data.previous_30d ?? null,
        }
        setCryptoFearGreed(next)
        snapPut('fear-greed', next)
        return
      }
    } catch (_) {
      // Fall through
    }

    // Fallback: Spectre Data API
    if (USE_SPECTRE_API) {
      try {
        const data = await spectreFearGreed()
        if (data) {
          const value = data.value ?? data.score ?? parseInt(data.fgi ?? data.fear_greed_index, 10)
          if (value != null && !isNaN(value)) {
            const next = {
              value,
              classification: data.classification ?? data.label ?? data.value_classification ?? classifyFng(value),
              prev1d: data.prev1d ?? data.previous_1d ?? null,
              prev7d: data.prev7d ?? data.previous_7d ?? null,
              prev30d: data.prev30d ?? data.previous_30d ?? null,
            }
            setCryptoFearGreed(next)
            snapPut('fear-greed', next)
            return
          }
        }
      } catch (_) {
        // Fall through
      }
    }

    // 2026-05-28 hide-apis-phase1: removed direct fetch to api.alternative.me.
    // `getFearGreedCurrent()` above already chains its OWN catch into the
    // same-origin /api/fear-greed/current proxy (services/fearGreedApi.js:100),
    // and the secondary block tries spectreFearGreed() too — three same-origin
    // attempts before we reach this point. If all three are down, show the
    // INITIAL "vibe check" rather than expose api.alternative.me in the
    // browser's Network tab + CSP connect-src.
    setCryptoFearGreed((prev) => prev.value == null ? { value: null, classification: '', prev1d: null, prev7d: null, prev30d: null } : prev)
  }, [])

  // Initial fetch on mount
  useEffect(() => { fetchFng() }, [fetchFng])

  useAdaptivePolling(fetchFng, { interval: 60 * 60 * 1000 })

  return cryptoFearGreed
}
