/**
 * useSearch — Debounced text search across calendar events.
 * Searches: name, nameShort, category, country.
 */

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'

export default function useSearch(events, delay = 200) {
  const [query, setQuery] = useState('')
  const timerRef = useRef(null)
  const [debouncedQuery, setDebouncedQuery] = useState('')

  const updateQuery = useCallback((value) => {
    setQuery(value)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setDebouncedQuery(value.trim().toLowerCase())
    }, delay)
  }, [delay])

  const filteredEvents = useMemo(() => {
    if (!debouncedQuery) return events
    return events.filter((e) => {
      const haystack = [
        e.name,
        e.nameShort,
        e.category,
        e.country,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(debouncedQuery)
    })
  }, [events, debouncedQuery])

  const clearSearch = useCallback(() => {
    setQuery('')
    setDebouncedQuery('')
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  // Clear a pending debounce on unmount (navigate away mid-typing).
  useEffect(() => () => clearTimeout(timerRef.current), [])

  return { query, setQuery: updateQuery, clearSearch, filteredEvents }
}
