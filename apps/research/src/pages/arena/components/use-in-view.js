/**
 * Reveal-on-scroll. Fires ONCE per element and then disconnects — a band that
 * re-animates when it scrolls back into view reads as a page that cannot sit
 * still. Enters instantly under prefers-reduced-motion.
 *
 * 🪤 StrictMode: the first version created the observer inside the callback
 * ref and tore it down in a cleanup-ONLY effect. StrictMode runs mount →
 * cleanup → re-run, and a cleanup-only effect re-arms nothing — so every
 * below-the-fold band was observed by NOBODY and sat at opacity 0 forever
 * (the retired band and the method footer, verified in-browser: a fresh
 * observer on the same node fired isIntersecting immediately). Same class as
 * the use-ladder `mounted.current` bug. The observer must be created IN the
 * effect so the re-run recreates what the cleanup tears down.
 */
import { useEffect, useState } from 'react'

const REDUCED = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function useInView(rootMargin = '-40px 0px -10% 0px') {
  const [inView, setInView] = useState(REDUCED)
  const [node, setNode] = useState(null)

  useEffect(() => {
    if (!node || inView) return undefined
    // Synchronous seed: an IntersectionObserver's first delivery is tied to
    // the rendering steps, so a hidden or throttled tab can leave a band that
    // is plainly on screen sitting at opacity 0. Layout is available now.
    const r = node.getBoundingClientRect()
    if (r.top < (window.innerHeight || 0) && r.bottom > 0) {
      setInView(true)
      return undefined
    }
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return undefined
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setInView(true)
    }, { rootMargin })
    io.observe(node)
    return () => io.disconnect()
  }, [node, inView, rootMargin])

  return { ref: setNode, inView }
}

export default useInView
