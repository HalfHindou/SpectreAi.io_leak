import { useRef, useReducer, useCallback } from 'react'

/**
 * Scroll reveal for feed cards.
 * Returns a callback ref and a `visible` boolean.
 *
 * Simple approach: cards in the initial viewport reveal with stagger delay,
 * everything else reveals immediately. No scroll listeners needed.
 *
 * Pattern: SPECTRE_COMPONENT_DB "Staggered Fade-In on Scroll"
 */
export default function useScrollReveal({ delay = 0 } = {}) {
  const [visible, reveal] = useReducer(() => true, false)
  const revealedRef = useRef(false)
  const elRef = useRef(null)

  // Callback ref - check if in viewport on mount, reveal with delay or immediately
  const ref = useCallback((el) => {
    elRef.current = el
    if (!el || revealedRef.current) return
    revealedRef.current = true

    const rect = el.getBoundingClientRect()
    const inViewport = rect.top < window.innerHeight + 80

    if (inViewport && delay > 0) {
      setTimeout(reveal, delay)
    } else {
      // Below fold or no delay - reveal immediately
      reveal()
    }
  }, [delay, reveal])

  return { ref, visible }
}
