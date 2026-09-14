/**
 * useWhisperSearch - Hook for Whisper Search (natural language → AI-parsed market search)
 *
 * Returns: { data, loading, error, search, clear }
 *   data: { interpretation, assetClass, filters, symbols, results[] } | null
 *   loading: boolean
 *   error: string | null
 *   search(query): trigger a whisper search
 *   clear(): reset state
 */

import { useState, useRef, useCallback } from 'react'

const API_URL = '/api/search/whisper'

export function useWhisperSearch() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  const search = useCallback(async (query) => {
    if (!query || query.trim().length < 3) return

    // Abort previous request
    if (abortRef.current) {
      abortRef.current.abort()
    }

    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}))
        throw new Error(errBody.error || `Request failed (${response.status})`)
      }

      const result = await response.json()
      setData(result)
      setLoading(false)
    } catch (err) {
      if (err.name === 'AbortError') return // Silently ignore aborted requests
      console.error('Whisper search error:', err.message)
      setError(err.message || 'Search failed')
      setLoading(false)
    }
  }, [])

  const clear = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setData(null)
    setLoading(false)
    setError(null)
  }, [])

  return { data, loading, error, search, clear }
}
