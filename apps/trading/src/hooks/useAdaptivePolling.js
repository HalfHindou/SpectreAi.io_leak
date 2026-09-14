import { useEffect, useRef } from 'react'

/**
 * Smart polling hook with adaptive intervals based on tab/viewport visibility.
 *
 * @param {Function} callback - function to call on each tick
 * @param {object} config
 * @param {number}  config.interval       - active polling interval (ms), required
 * @param {number}  [config.hiddenInterval] - interval when tab is hidden (default: interval * 4)
 * @param {number}  [config.idleTimeout]   - stop polling after this many ms hidden (default: 5 min)
 * @param {boolean} [config.fireImmediately=false] - fire callback on mount
 * @param {boolean} [config.isInViewport=true] - slower polling when false
 * @param {boolean} [config.enabled=true]  - set false to pause polling entirely
 */
export default function useAdaptivePolling(callback, config) {
  const {
    interval,
    hiddenInterval,
    idleTimeout = 5 * 60 * 1000,
    fireImmediately = false,
    isInViewport = true,
    enabled = true,
  } = config || {}

  const savedCallback = useRef(callback)
  useEffect(() => { savedCallback.current = callback }, [callback])

  // All timer logic in a single useEffect to avoid race conditions
  useEffect(() => {
    if (!enabled || interval == null) return

    let timerId = null
    let mounted = true
    let hiddenSince = null

    function getEffectiveInterval() {
      if (document.hidden) {
        if (hiddenSince) {
          const elapsed = Date.now() - hiddenSince
          if (elapsed > idleTimeout) return null
        }
        return hiddenInterval ?? interval * 4
      }
      if (!isInViewport) return interval * 2
      return interval
    }

    function tick() {
      if (!mounted) return
      if (getEffectiveInterval() === null) return
      savedCallback.current()
    }

    function schedule() {
      if (timerId) { clearInterval(timerId); timerId = null }
      const ms = getEffectiveInterval()
      if (ms === null || !mounted) return
      timerId = setInterval(tick, ms)
    }

    function onVisibilityChange() {
      if (document.hidden) {
        hiddenSince = hiddenSince || Date.now()
      } else {
        hiddenSince = null
        tick()
      }
      schedule()
    }

    if (fireImmediately) tick()
    schedule()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      mounted = false
      if (timerId) clearInterval(timerId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [enabled, interval, hiddenInterval, idleTimeout, isInViewport, fireImmediately])
}
