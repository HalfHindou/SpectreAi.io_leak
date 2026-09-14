/**
 * useStreamingText — character-by-character reveal of a string.
 *
 * Used by HeaderDossier to make the AI narrative feel generated live.
 *
 *   const { display, isStreaming } = useStreamingText(text, {
 *     speedCps: 80,
 *     latchKey: `${chain}:${address}`,  // skip re-stream on subsequent visits
 *     enabled: true,                     // false = instant render
 *   })
 *
 * Latch: once a `latchKey` has been streamed in this session, subsequent
 * mounts for the same key bypass the animation and render immediately.
 * This is what stops the dossier from re-typing every time the user
 * navigates back to a token they already viewed.
 *
 * Reduced-motion: when `prefers-reduced-motion: reduce` is set (system)
 * OR the app's reducedMotion override is on, the hook returns the full
 * text on first paint.
 */

import { useEffect, useRef, useState } from 'react'

// Module-level set of latch keys — survives unmounts within a session.
const _streamedKeys = new Set()

function shouldSkipStreaming() {
  if (typeof window === 'undefined') return true
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true
  const root = document.querySelector('.app')
  if (root?.getAttribute('data-reduced-motion') === 'true') return true
  return false
}

export default function useStreamingText(text, { speedCps = 80, latchKey, enabled = true } = {}) {
  const full = String(text || '')
  const skipForReducedMotion = shouldSkipStreaming()
  const alreadyStreamed = latchKey ? _streamedKeys.has(latchKey) : false
  const shouldStream = enabled && !skipForReducedMotion && !alreadyStreamed && full.length > 0

  const [display, setDisplay] = useState(shouldStream ? '' : full)
  const [isStreaming, setIsStreaming] = useState(shouldStream)
  const idxRef = useRef(0)
  const rafRef = useRef(0)
  const startRef = useRef(0)

  useEffect(() => {
    // When inputs change, reset to the latest "should we stream?" decision.
    if (!shouldStream) {
      setDisplay(full)
      setIsStreaming(false)
      if (latchKey) _streamedKeys.add(latchKey)
      return
    }

    idxRef.current = 0
    startRef.current = 0
    setDisplay('')
    setIsStreaming(true)

    const tick = (ts) => {
      if (!startRef.current) startRef.current = ts
      const elapsed = ts - startRef.current
      const target = Math.min(full.length, Math.floor((elapsed / 1000) * speedCps))
      if (target !== idxRef.current) {
        idxRef.current = target
        setDisplay(full.slice(0, target))
      }
      if (target >= full.length) {
        setIsStreaming(false)
        if (latchKey) _streamedKeys.add(latchKey)
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [full, speedCps, latchKey, shouldStream])

  return { display, isStreaming }
}
