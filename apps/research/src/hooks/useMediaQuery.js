/**
 * useMediaQuery – hook for responsive breakpoints (e.g. mobile vs desktop).
 * Returns true when the query matches (e.g. max-width: 768px).
 */
import { useState, useEffect } from 'react'
import { useMobilePreview } from '@/contexts/MobilePreviewContext'

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    const media = window.matchMedia(query)
    const listener = (e) => setMatches(e.matches)
    media.addEventListener('change', listener)
    setMatches(media.matches)
    return () => media.removeEventListener('change', listener)
  }, [query])

  return matches
}

/** Convenience: true when viewport is mobile (≤768px) or when inside iPhone mobile preview frame */
export function useIsMobile() {
  const forceMobile = useMobilePreview()
  const isNarrow = useMediaQuery('(max-width: 768px)')
  return forceMobile || isNarrow
}
