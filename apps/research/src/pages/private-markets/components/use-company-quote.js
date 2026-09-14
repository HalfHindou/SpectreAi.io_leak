/**
 * useCompanyQuote — realtime stock quote for a (now-public) pre-IPO company.
 *
 * Polls /api/stocks/quotes every ~30s while the tab is visible. Returns
 * { quote, loading } per coding-standards.md H. `ticker` null → inert.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { getCompanyQuote } from './private-markets-api'

const POLL_MS = 30 * 1000

export default function useCompanyQuote(ticker) {
  const [quote, setQuote] = useState(null)
  const [loading, setLoading] = useState(!!ticker)
  const cancelledRef = useRef(false)

  const load = useCallback(async () => {
    if (!ticker) return
    if (typeof document !== 'undefined' && document.hidden) return
    const q = await getCompanyQuote(ticker)
    if (cancelledRef.current) return
    if (q) setQuote(q)
    setLoading(false)
  }, [ticker])

  useEffect(() => {
    cancelledRef.current = false
    if (!ticker) {
      setQuote(null)
      setLoading(false)
      return undefined
    }
    setLoading(true)
    load()
    return () => {
      cancelledRef.current = true
    }
  }, [ticker, load])

  useAdaptivePolling(load, { interval: POLL_MS, enabled: !!ticker })

  return { quote, loading }
}
