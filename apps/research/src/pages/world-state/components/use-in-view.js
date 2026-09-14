/**
 * useInView — reveal-once observer.
 *
 * Returns { ref, inView }. Fires once, then disconnects: nothing on this page
 * re-animates on the way back up. Under prefers-reduced-motion it reports
 * `true` immediately without ever constructing an observer, so reduced-motion
 * readers get the settled page with no entrance at all.
 */
import { useEffect, useRef, useState } from 'react'

const REDUCED = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function useInView({ rootMargin = '0px 0px -8% 0px', threshold = 0.08 } = {}) {
  const ref = useRef(null)
  const [inView, setInView] = useState(REDUCED)

  useEffect(() => {
    if (REDUCED) return undefined
    const el = ref.current
    if (!el || typeof IntersectionObserver !== 'function') {
      setInView(true)
      return undefined
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          setInView(true)
          io.disconnect()
          return
        }
      }
    }, { rootMargin, threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [rootMargin, threshold])

  return { ref, inView }
}
