/**
 * MobilePullRefresh — DexScreener-style pull-to-refresh wrapper (prefix mpr-).
 *
 * Wrap a screen's content; when the nearest scrollable ancestor sits at the
 * top and the user drags down, the content follows the finger (damped) and a
 * small arc chip fills with pull progress. Releasing past the threshold runs
 * `onRefresh` (awaited, min 600ms so the spin is visible even on a warm
 * cache) while the chip spins, then everything snaps back.
 *
 * Touch-only by design (no mouse) — desktop has no pull gesture. Vertical
 * intent is required before the pull arms, so row swipe-left actions and
 * horizontal pans never trigger it.
 */
import React, { useEffect, useRef, useState } from 'react'
import './MobilePullRefresh.css'

const MAX_PULL = 110      // px of content travel at full drag
const THRESHOLD = 64      // px of travel that arms a refresh
const HOLD = 52           // px the content holds at while refreshing
const DAMPING = 0.5
const MIN_SPIN_MS = 600

// Arc geometry (r=9 → circumference ≈ 56.5). Full progress draws 300°.
const ARC_C = 2 * Math.PI * 9

function findScroller(el) {
  let node = el?.parentElement
  while (node && node !== document.body) {
    const s = getComputedStyle(node)
    if (/(auto|scroll)/.test(s.overflowY)) return node
    node = node.parentElement
  }
  return null
}

export default function MobilePullRefresh({ onRefresh, disabled = false, excludeSelector = null, children }) {
  const rootRef = useRef(null)
  const [pull, setPull] = useState(0)          // current content travel px
  const [refreshing, setRefreshing] = useState(false)
  const [settling, setSettling] = useState(false) // animate the snap-back
  const stateRef = useRef({ startY: 0, startX: 0, armed: false, pulling: false, dead: false })
  const busyRef = useRef(false)
  // Mirror of `pull` readable synchronously in touchend — deciding inside a
  // setPull updater is render-phase code where side effects get dropped.
  const pullRef = useRef(0)

  useEffect(() => {
    const root = rootRef.current
    if (!root || disabled) return undefined
    const scroller = findScroller(root)
    if (!scroller) return undefined

    const st = stateRef.current

    const onTouchStart = (e) => {
      const t = e.touches?.[0]
      if (!t || busyRef.current) { st.armed = false; return }
      let armed = scroller.scrollTop <= 0
      // Zones that own their own drag gestures (e.g. the chart canvas —
      // dragging there pans price/time, never pulls the page).
      if (armed && excludeSelector && e.target instanceof Element
        && e.target.closest(excludeSelector)) {
        armed = false
      }
      // A nested scrollable (e.g. the txns table box) that is itself
      // scrolled down must scroll back up natively before a pull can start.
      if (armed && e.target instanceof Element) {
        let node = e.target
        while (node && node !== scroller) {
          if (node.scrollTop > 0 && node.scrollHeight > node.clientHeight) { armed = false; break }
          node = node.parentElement
        }
      }
      st.armed = armed
      st.pulling = false
      st.dead = false
      st.startY = t.clientY
      st.startX = t.clientX
    }

    const onTouchMove = (e) => {
      if (!st.armed || st.dead || busyRef.current) return
      const t = e.touches?.[0]
      if (!t) return
      const dy = t.clientY - st.startY
      const dx = Math.abs(t.clientX - st.startX)
      if (!st.pulling) {
        // Horizontal intent (row swipes) or upward scroll → hand off to native.
        if (dy <= 0 || scroller.scrollTop > 0 || (dx > 10 && dx > dy * 1.2)) {
          if (dy < -6 || dx > 14) st.dead = true
          return
        }
        if (dy < 8) return // small jitter — not a pull yet
        st.pulling = true
        setSettling(false)
      }
      // Own the gesture: stop the scroller from consuming the drag.
      if (e.cancelable) e.preventDefault()
      const travel = Math.min(dy * DAMPING, MAX_PULL)
      pullRef.current = travel
      setPull(travel)
    }

    const onTouchEnd = () => {
      if (!st.pulling) { st.armed = false; return }
      st.pulling = false
      st.armed = false
      setSettling(true)
      const travel = pullRef.current
      if (travel >= THRESHOLD && typeof onRefresh === 'function' && !busyRef.current) {
        busyRef.current = true
        setRefreshing(true)
        pullRef.current = HOLD
        setPull(HOLD)
        const started = Date.now()
        Promise.resolve()
          .then(() => onRefresh())
          .catch(() => {})
          .finally(() => {
            const wait = Math.max(0, MIN_SPIN_MS - (Date.now() - started))
            setTimeout(() => {
              busyRef.current = false
              setRefreshing(false)
              setSettling(true)
              pullRef.current = 0
              setPull(0)
            }, wait)
          })
      } else {
        pullRef.current = 0
        setPull(0)
      }
    }

    // touchmove must be non-passive: we preventDefault once the pull owns
    // the gesture (otherwise the scroller rubber-bands underneath).
    scroller.addEventListener('touchstart', onTouchStart, { passive: true })
    scroller.addEventListener('touchmove', onTouchMove, { passive: false })
    scroller.addEventListener('touchend', onTouchEnd, { passive: true })
    scroller.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      scroller.removeEventListener('touchstart', onTouchStart)
      scroller.removeEventListener('touchmove', onTouchMove)
      scroller.removeEventListener('touchend', onTouchEnd)
      scroller.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [onRefresh, disabled, excludeSelector])

  const progress = Math.min(pull / THRESHOLD, 1)
  const arcLen = ARC_C * (300 / 360) * (refreshing ? 1 : progress)
  const visible = pull > 0 || refreshing

  return (
    <div className="mpr" ref={rootRef}>
      <div
        className={`mpr-indicator${refreshing ? ' is-refreshing' : ''}${visible ? ' is-visible' : ''}`}
        style={{ transform: `translateX(-50%) translateY(${Math.max(pull - 34, refreshing ? 18 : -34)}px)` }}
        aria-hidden={!refreshing}
        role="status"
        aria-label={refreshing ? 'Refreshing' : undefined}
      >
        <svg className="mpr-arc" viewBox="0 0 24 24" width="18" height="18"
          style={!refreshing ? { transform: `rotate(${progress * 240 - 90}deg)` } : undefined}>
          <circle className="mpr-arc-track" cx="12" cy="12" r="9" />
          <circle
            className="mpr-arc-fill"
            cx="12" cy="12" r="9"
            strokeDasharray={`${arcLen} ${ARC_C}`}
          />
        </svg>
      </div>
      <div
        className={`mpr-content${settling ? ' is-settling' : ''}${pull > 0 ? ' is-pulling' : ''}`}
        style={{ transform: pull > 0 ? `translateY(${pull}px)` : 'none' }}
        onTransitionEnd={() => setSettling(false)}
      >
        {children}
      </div>
    </div>
  )
}
