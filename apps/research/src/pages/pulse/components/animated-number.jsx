import { useState, useEffect, useRef } from 'react'

/**
 * AnimatedNumber - count-up animation for dramatic stat display.
 * Pattern: SPECTRE_COMPONENT_DB "AnimatedNumber (Ticker/Counter)"
 *
 * Parses the displayed value (e.g. "$2.8k", "81", "186", "+42%")
 * and animates the numeric portion from 0 to target.
 * Non-numeric prefix/suffix preserved.
 */
export default function AnimatedNumber({
  value,
  duration = 1200,
  className,
  style,
  enabled = true,
}) {
  const [display, setDisplay] = useState(enabled ? '' : value)
  const rafRef = useRef(null)
  const hasAnimated = useRef(false)

  useEffect(() => {
    if (!enabled || !value || hasAnimated.current) {
      setDisplay(value || '')
      return
    }

    hasAnimated.current = true
    const str = String(value)

    // Extract prefix (non-digit, not dot/comma), number, suffix
    const match = str.match(/^([^0-9]*?)([\d,.]+)(.*)$/)
    if (!match) {
      setDisplay(str)
      return
    }

    const prefix = match[1]
    const numStr = match[2]
    const suffix = match[3]
    const target = parseFloat(numStr.replace(/,/g, ''))

    if (isNaN(target) || target === 0) {
      setDisplay(str)
      return
    }

    // Determine decimal places from original
    const decimalMatch = numStr.match(/\.(\d+)/)
    const decimals = decimalMatch ? decimalMatch[1].length : 0

    // Check if original had commas
    const hasCommas = numStr.includes(',')

    const startTime = performance.now()

    function animate(now) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)

      // Ease-out cubic for natural deceleration
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = target * eased

      let formatted = decimals > 0
        ? current.toFixed(decimals)
        : Math.round(current).toString()

      // Re-add commas if original had them
      if (hasCommas) {
        const parts = formatted.split('.')
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
        formatted = parts.join('.')
      }

      setDisplay(`${prefix}${formatted}${suffix}`)

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      }
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [value, duration, enabled])

  return (
    <span className={className} style={style}>
      {display}
    </span>
  )
}
