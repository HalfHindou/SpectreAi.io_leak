/**
 * SegmentedControl — pill row with a single sliding indicator behind the
 * active member (CSS transform, not background swap).
 *
 * Used for:
 *   - Buy/Sell toggle (accent="mint-coral" — semantic colors per side)
 *   - Timeframe selectors (accent="lime")
 *   - Tab bars (DataTabs, LeftPanel header)
 *
 * Pure controlled component. Caller owns the selected `value`; we just
 * paint the indicator at the right position.
 *
 * Implementation:
 *   - Each option is a button rendered in flex row
 *   - Active indicator is an absolutely-positioned <span> moved via
 *     translateX + width = the active button's geometry
 *   - We measure on mount + resize (ResizeObserver) — no layout reads
 *     per click, the indicator transitions via CSS
 */

import React, { useEffect, useRef, useState, useCallback } from 'react'
import './SegmentedControl.css'

function SegmentedControl({
  options = [],          // [{ value: string, label: string, icon?: ReactNode }]
  value,                 // currently selected value
  onChange,              // (newValue) => void
  accent = 'lime',       // 'lime' | 'mint' | 'coral' | 'mint-coral' | 'plain'
  size = 'md',
  className = '',
  ariaLabel,
}) {
  const containerRef = useRef(null)
  const itemRefs = useRef({})
  const [indicator, setIndicator] = useState({ x: 0, w: 0, ready: false })

  const measure = useCallback(() => {
    const container = containerRef.current
    const activeBtn = itemRefs.current[value]
    if (!container || !activeBtn) return
    const cRect = container.getBoundingClientRect()
    const bRect = activeBtn.getBoundingClientRect()
    setIndicator({ x: bRect.left - cRect.left, w: bRect.width, ready: true })
  }, [value])

  useEffect(() => {
    measure()
    if (typeof ResizeObserver === 'undefined' || !containerRef.current) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [measure])

  // Re-measure on value change
  useEffect(() => { measure() }, [value, measure])

  // mint-coral: indicator changes color depending on which side is active
  const indicatorAccent = accent === 'mint-coral'
    ? (options[0]?.value === value ? 'mint' : 'coral')
    : accent

  return (
    <div
      ref={containerRef}
      className={[
        'segmented',
        `segmented--${size}`,
        `segmented--${accent}`,
        className,
      ].filter(Boolean).join(' ')}
      role="tablist"
      aria-label={ariaLabel}
    >
      {/* Sliding indicator behind the active button */}
      <span
        className={`segmented-indicator segmented-indicator--${indicatorAccent}`}
        data-ready={indicator.ready ? 'true' : 'false'}
        style={{
          transform: `translateX(${indicator.x}px)`,
          width: `${indicator.w}px`,
        }}
        aria-hidden="true"
      />
      {options.map((opt) => {
        const isActive = opt.value === value
        return (
          <button
            key={opt.value}
            ref={(el) => { itemRefs.current[opt.value] = el }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={`segmented-item${isActive ? ' segmented-item--active' : ''}`}
            onClick={() => onChange?.(opt.value)}
          >
            {opt.icon && <span className="segmented-item-icon">{opt.icon}</span>}
            <span className="segmented-item-label">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export default React.memo(SegmentedControl)
