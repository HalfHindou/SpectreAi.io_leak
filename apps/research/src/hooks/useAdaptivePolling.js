import { useEffect, useRef } from 'react'
import { isAppActive, subscribeActivity } from '@/lib/idleManager'

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
 * @param {boolean} [config.respectIdle=false] - also pause while the tab is
 *   VISIBLE but the user has walked away (idleManager: 5 min without a
 *   mouse/key/scroll/touch event). document.hidden alone never catches a tab
 *   parked on a second monitor, which idleManager was written for. Off by
 *   default so existing callers are byte-identical; when on, returning to the
 *   page fires one immediate refresh, so the data is never stale on screen.
 */
export default function useAdaptivePolling(callback, config) {
  const {
    interval,
    hiddenInterval,
    idleTimeout = 5 * 60 * 1000,
    fireImmediately = false,
    isInViewport = true,
    enabled = true,
    respectIdle = false,
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
          if (elapsed > idleTimeout) return null // idle - stop
        }
        return hiddenInterval ?? interval * 4
      }
      if (!isInViewport) return interval * 2
      return interval
    }

    function tick() {
      if (!mounted) return
      if (getEffectiveInterval() === null) return
      if (respectIdle && !isAppActive()) return
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
        tick() // catch up when tab becomes visible
      }
      schedule() // re-schedule with new interval
    }

    if (fireImmediately) tick()
    schedule()
    document.addEventListener('visibilitychange', onVisibilityChange)
    // Coming back from idle refreshes once, so the user never reads a screen
    // that quietly stopped updating while they were away.
    const offActivity = respectIdle
      ? subscribeActivity((active) => { if (active) tick() })
      : null

    return () => {
      mounted = false
      if (timerId) clearInterval(timerId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (offActivity) offActivity()
    }
  }, [enabled, interval, hiddenInterval, idleTimeout, isInViewport, fireImmediately, respectIdle])
}
