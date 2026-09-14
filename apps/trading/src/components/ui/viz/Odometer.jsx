/**
 * Odometer — tabular-mono live number. On value change, a 240ms
 * directional flash plays via [data-tick] attribute (no React state
 * churn — preserves the OL Phase-2 perf contract).
 *
 * Full digit-roll animation is deferred; this version delivers the
 * directional flash + tabular-nums layout that callers rely on.
 */
import React, { useEffect, useMemo, useRef } from 'react'
import './Odometer.css'

function formatValue(value, decimals) {
  if (value == null || isNaN(value)) return '—'
  const abs = Math.abs(value)
  const sign = value < 0 ? '−' : ''
  if (abs >= 1e12) return sign + (abs / 1e12).toFixed(decimals) + 'T'
  if (abs >= 1e9)  return sign + (abs / 1e9).toFixed(decimals) + 'B'
  if (abs >= 1e6)  return sign + (abs / 1e6).toFixed(decimals) + 'M'
  if (abs >= 1e3)  return sign + (abs / 1e3).toFixed(decimals) + 'K'
  return sign + Number(abs).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function Odometer({
  value,
  decimals = 2,
  prefix = '',
  suffix = '',
  className = '',
  raw = false,        // true = render raw number (no K/M/B compaction)
}) {
  const ref = useRef(null)
  const prevRef = useRef(value)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const prev = prevRef.current
    if (prev != null && value != null && Number(value) !== Number(prev)) {
      const dir = Number(value) > Number(prev) ? 'up' : 'down'
      el.setAttribute('data-tick', dir)
      const id = window.setTimeout(() => el.removeAttribute('data-tick'), 240)
      prevRef.current = value
      return () => window.clearTimeout(id)
    }
    prevRef.current = value
  }, [value])

  const formatted = useMemo(() => {
    if (raw && value != null && !isNaN(value)) {
      return Number(value).toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    }
    return formatValue(value, decimals)
  }, [value, decimals, raw])

  return (
    <span ref={ref} className={['odo', className].filter(Boolean).join(' ')}>
      {prefix}
      <span className="odo-value">{formatted}</span>
      {suffix}
    </span>
  )
}

export default React.memo(Odometer)
