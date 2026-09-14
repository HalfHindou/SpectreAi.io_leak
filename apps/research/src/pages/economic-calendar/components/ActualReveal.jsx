/**
 * ActualReveal — Animated count-up when actual value appears.
 * Adapted from ResultFlash RAF pattern.
 * Phases: idle → counting (500ms ease-out quad) → settled (scale bounce)
 */

import React, { useState, useEffect, useRef } from 'react'
import './ActualReveal.css'

const ActualReveal = ({ value, isBeat, triggered, unit = '' }) => {
  const [phase, setPhase] = useState('idle')
  const [displayValue, setDisplayValue] = useState(value)
  const animFrameRef = useRef(null)
  const startTimeRef = useRef(null)

  useEffect(() => {
    if (!triggered) {
      setPhase('idle')
      setDisplayValue(value)
      return
    }

    setPhase('counting')
    startTimeRef.current = Date.now()
    const targetVal = typeof value === 'number' ? value : parseFloat(value) || 0
    const decimals = String(targetVal).includes('.') ? String(targetVal).split('.')[1].length : 0

    const animate = () => {
      const elapsed = Date.now() - startTimeRef.current
      const progress = Math.min(elapsed / 500, 1)
      const eased = 1 - (1 - progress) * (1 - progress)
      const current = eased * targetVal

      setDisplayValue(decimals > 0 ? current.toFixed(decimals) : Math.round(current))

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(animate)
      } else {
        setDisplayValue(targetVal.toFixed(decimals > 0 ? decimals : 0))
        setPhase('settled')
      }
    }

    animFrameRef.current = requestAnimationFrame(animate)

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [triggered, value])

  const phaseClass = phase === 'counting'
    ? 'actual-reveal--counting'
    : phase === 'settled'
      ? 'actual-reveal--settled'
      : ''

  const colorClass = isBeat ? 'actual-reveal--beat' : 'actual-reveal--miss'

  return (
    <span className={`actual-reveal ${phaseClass} ${triggered ? colorClass : ''}`}>
      {displayValue}{unit}
    </span>
  )
}

export default ActualReveal
