/**
 * ViewTransition — Crossfade wrapper for Day/Week/Month view switching.
 * Animates opacity + translateY + blur when viewKey changes.
 */

import React, { useState, useEffect, useRef } from 'react'

const ViewTransition = ({ viewKey, children }) => {
  const [displayedKey, setDisplayedKey] = useState(viewKey)
  const [phase, setPhase] = useState('idle') // 'idle' | 'exiting' | 'entering'
  const containerRef = useRef(null)
  const childrenRef = useRef(children)

  // Keep latest children in ref for when key changes
  if (viewKey === displayedKey) {
    childrenRef.current = children
  }

  useEffect(() => {
    if (viewKey === displayedKey) return

    // Start exit phase
    setPhase('exiting')

    const exitTimer = setTimeout(() => {
      // Switch to new content
      childrenRef.current = children
      setDisplayedKey(viewKey)
      setPhase('entering')

      const enterTimer = setTimeout(() => {
        setPhase('idle')
      }, 300)

      return () => clearTimeout(enterTimer)
    }, 150)

    return () => clearTimeout(exitTimer)
  }, [viewKey, children, displayedKey])

  const className = [
    'ec-view-transition',
    phase === 'exiting' ? 'ec-view-transition--exit' : '',
    phase === 'entering' ? 'ec-view-transition--enter' : '',
  ].filter(Boolean).join(' ')

  return (
    <div ref={containerRef} className={className}>
      {childrenRef.current}
    </div>
  )
}

export default ViewTransition
