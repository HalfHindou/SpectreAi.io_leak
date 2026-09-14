import React, { useRef, useEffect, useState } from 'react'
import './digit-morph.css'

/**
 * DigitMorph — Digit-by-digit price animation.
 * Each character slot morphs independently when the value changes.
 *
 * Props:
 *   value     — formatted price string (e.g., "$1,234.56")
 *   className — optional additional class
 *   tag       — wrapper element type (default: 'span')
 */
const DigitMorph = React.memo(function DigitMorph({
  value,
  className = '',
  tag: Tag = 'span',
}) {
  const prevRef = useRef(value)
  const [chars, setChars] = useState(() => initChars(value))

  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = value

    if (prev === value) return

    const prevChars = prev.split('')
    const nextChars = value.split('')

    // Pad shorter array so indices align from the right (price digits)
    const maxLen = Math.max(prevChars.length, nextChars.length)
    const padded = nextChars.map((ch, i) => {
      const prevCh = prevChars[i + prevChars.length - maxLen]
      const changed = prevCh != null && prevCh !== ch
      return { char: ch, changed, key: `${i}-${ch}-${Date.now()}` }
    })

    setChars(padded)
  }, [value])

  return (
    <Tag className={`digit-morph ${className}`}>
      {chars.map((c) => (
        <span
          key={c.key}
          className={`dm-char ${c.changed ? 'dm-changed' : ''} ${isDigit(c.char) ? 'dm-digit' : 'dm-sep'}`}
        >
          {c.char}
        </span>
      ))}
    </Tag>
  )
})

function initChars(value) {
  return (value || '').split('').map((ch, i) => ({
    char: ch,
    changed: false,
    key: `${i}-${ch}-init`,
  }))
}

function isDigit(ch) {
  return ch >= '0' && ch <= '9'
}

export default DigitMorph
