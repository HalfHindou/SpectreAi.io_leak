/**
 * LiquidityPulse — the "money in / money out" headline that sits INSIDE the
 * heatmap / bubbles hero (the header already carries total market cap, so this
 * is just the flow: dollars added or removed over the window). Compact, inline,
 * animated count-up. Premium + restrained — no band, no glow, no slop.
 */
import React, { useEffect, useRef, useState } from 'react'
import './liquidity-pulse.css'

const EASE_OUT_CUBIC = (p) => 1 - Math.pow(1 - p, 3)

/** Animated count-up toward `target`; respects reduced-motion + hidden tabs. */
function useCountUp(target, duration = 1000) {
  const safeTarget = Number.isFinite(target) ? target : 0
  const [value, setValue] = useState(safeTarget)
  const fromRef = useRef(safeTarget)
  const rafRef = useRef(0)

  useEffect(() => {
    const from = fromRef.current
    const to = safeTarget
    if (from === to) return

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (reduce || (typeof document !== 'undefined' && document.hidden)) {
      fromRef.current = to
      setValue(to)
      return
    }

    const start = performance.now()
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration)
      setValue(from + (to - from) * EASE_OUT_CUBIC(p))
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = to
        setValue(to)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [safeTarget, duration])

  return value
}

const Arrow = ({ up, size = 15 }) => (
  <svg className="lqp-arrow" width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {up ? <polyline points="6 15 12 9 18 15" /> : <polyline points="6 9 12 15 18 9" />}
  </svg>
)

export default function LiquidityPulse({
  netFlow = 0,
  timeframeLabel = '24h',
  coverageLabel = 'the market',
  fmtLarge,
  dayMode = false,
  align = 'center',
  size = 'md',
}) {
  const target = Number.isFinite(netFlow) ? netFlow : 0
  const animated = useCountUp(target)
  const positive = target >= 0
  const dir = positive ? 'up' : 'down'

  const fmt = typeof fmtLarge === 'function'
    ? fmtLarge
    : (n) => `$${Math.round(Math.abs(n)).toLocaleString()}`

  return (
    <div
      className={[
        'lqp',
        `lqp--${dir}`,
        `lqp--${align}`,
        `lqp--${size}`,
        dayMode ? 'lqp--day' : '',
      ].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
    >
      <span className={`lqp-live lqp-live--${dir}`} aria-hidden />
      <div className="lqp-body">
        <div className="lqp-figure">
          <Arrow up={positive} />
          <span className="lqp-amount">{fmt(Math.abs(animated))}</span>
          <span className="lqp-verb">{positive ? 'added' : 'removed'}</span>
        </div>
        <div className="lqp-sub">
          <span className="lqp-eyebrow">Liquidity flow</span>
          <span className="lqp-dot" aria-hidden>·</span>
          {positive ? 'into' : 'out of'} {coverageLabel}
          <span className="lqp-tf">{timeframeLabel}</span>
        </div>
      </div>
    </div>
  )
}
