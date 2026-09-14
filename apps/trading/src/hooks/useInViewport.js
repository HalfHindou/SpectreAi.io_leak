import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * Returns whether an element is currently visible in the viewport.
 * Use with useAdaptivePolling to skip polling for off-screen sections.
 *
 * @param {object} [options]
 * @param {number} [options.rootMargin='200px'] - expand detection zone (preload before visible)
 * @param {number} [options.threshold=0] - intersection ratio to trigger
 * @returns {{ ref: Function, isInViewport: boolean }}
 *
 * Usage:
 *   const { ref, isInViewport } = useInViewport()
 *   useAdaptivePolling(fetchData, { interval: 30000, isInViewport })
 *   return <div ref={ref}>...</div>
 */
export default function useInViewport(options = {}) {
  const { rootMargin = '200px', threshold = 0 } = options
  const [isInViewport, setIsInViewport] = useState(true) // default true to avoid skipping initial fetch
  const observerRef = useRef(null)

  const ref = useCallback((node) => {
    // Cleanup previous observer
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }

    if (!node) return

    // No IntersectionObserver support - always visible
    if (typeof IntersectionObserver === 'undefined') {
      setIsInViewport(true)
      return
    }

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        setIsInViewport(entry.isIntersecting)
      },
      { rootMargin, threshold }
    )

    observerRef.current.observe(node)
  }, [rootMargin, threshold])

  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [])

  return { ref, isInViewport }
}
