/**
 * RevealOnScroll — wrap any section to get a one-shot fade-up reveal
 * when it scrolls into the viewport.
 *
 * Latches `revealed:true` on first intersection and stays — no re-fire
 * on scroll-back. Honors prefers-reduced-motion + the in-app
 * `reducedMotion` toggle (visible immediately, no translation).
 *
 * The existing `useInViewport` hook returns a callback ref + a boolean
 * that flips ON+OFF as the element enters/exits the viewport. For a
 * latched one-shot reveal we use IntersectionObserver inline since we
 * want to DISCONNECT after the first intersection (cleaner than tracking
 * latch state on top of a hook that re-fires).
 *
 * Usage:
 *   <RevealOnScroll delay={60}>
 *     <Section />
 *   </RevealOnScroll>
 */

import React, { useEffect, useRef, useState } from 'react'
import './RevealOnScroll.css'

function RevealOnScroll({
  as: Tag = 'div',
  delay = 0,           // animation-delay in ms
  threshold = 0.1,     // IntersectionObserver threshold
  rootMargin = '0px',
  className = '',
  children,
  ...rest
}) {
  const ref = useRef(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (revealed) return
    if (typeof IntersectionObserver === 'undefined') {
      setRevealed(true)
      return
    }
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry], observer) => {
        if (entry.isIntersecting) {
          setRevealed(true)
          observer.disconnect()
        }
      },
      { threshold, rootMargin }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [revealed, threshold, rootMargin])

  return (
    <Tag
      ref={ref}
      className={['reveal-on-scroll', revealed && 'reveal-on-scroll--in', className].filter(Boolean).join(' ')}
      style={delay > 0 ? { transitionDelay: `${delay}ms` } : undefined}
      {...rest}
    >
      {children}
    </Tag>
  )
}

export default RevealOnScroll
