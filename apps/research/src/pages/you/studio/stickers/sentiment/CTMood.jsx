import { useState, useEffect, useRef } from 'react'

/**
 * CTMood -- Crypto Twitter sentiment bar with pointer.
 * 3 segments: bearish (red), neutral (gray), bullish (green).
 * Triangle pointer marks current reading position.
 * Designed for ~220x70 sticker area.
 */

function initSentiment() {
  const bearish = 20 + Math.random() * 20  // 20-40
  const bullish = 25 + Math.random() * 25  // 25-50
  const neutral = 100 - bearish - bullish
  return { bearish, neutral, bullish }
}

function clampSentiment(s) {
  let { bearish, neutral, bullish } = s
  bearish = Math.max(5, Math.min(60, bearish))
  bullish = Math.max(5, Math.min(60, bullish))
  neutral = Math.max(5, 100 - bearish - bullish)
  // Re-normalize to 100
  const total = bearish + neutral + bullish
  return {
    bearish: (bearish / total) * 100,
    neutral: (neutral / total) * 100,
    bullish: (bullish / total) * 100,
  }
}

export default function CTMood({ sticker, themeObj }) {
  const dataRef = useRef(clampSentiment(initSentiment()))
  const [sentiment, setSentiment] = useState(dataRef.current)

  useEffect(() => {
    const interval = setInterval(() => {
      const prev = dataRef.current
      const next = clampSentiment({
        bearish: prev.bearish + (Math.random() - 0.5) * 4,
        neutral: prev.neutral + (Math.random() - 0.5) * 4,
        bullish: prev.bullish + (Math.random() - 0.5) * 4,
      })
      dataRef.current = next
      setSentiment(next)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // Determine reading based on which is largest
  let readingLabel, readingColor
  if (sentiment.bullish > sentiment.bearish && sentiment.bullish > sentiment.neutral) {
    readingLabel = 'Bullish'
    readingColor = '#10B981'
  } else if (sentiment.bearish > sentiment.bullish && sentiment.bearish > sentiment.neutral) {
    readingLabel = 'Bearish'
    readingColor = '#EF4444'
  } else {
    readingLabel = 'Neutral'
    readingColor = themeObj.stickerText.secondary
  }

  // Pointer position: weighted average
  // bearish = left (0%), neutral = center, bullish = right (100%)
  const pointerPct = (sentiment.neutral * 0.5 + sentiment.bullish) / 100 * 100

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      padding: '8px 12px',
      boxSizing: 'border-box',
      gap: 6,
    }}>
      {/* Title */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        color: themeObj.stickerText.tertiary,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        lineHeight: 1,
      }}>
        CT Sentiment
      </div>

      {/* Pointer */}
      <div style={{ position: 'relative', height: 8, marginBottom: -2 }}>
        <svg
          width="100%"
          height={8}
          viewBox="0 0 100 8"
          preserveAspectRatio="none"
          style={{ display: 'block', overflow: 'visible' }}
        >
          <polygon
            points={`${pointerPct - 3},0 ${pointerPct + 3},0 ${pointerPct},7`}
            fill={readingColor}
            style={{ transition: 'all 0.8s ease' }}
          />
        </svg>
      </div>

      {/* Bar */}
      <div style={{
        display: 'flex',
        width: '100%',
        height: 10,
        borderRadius: 5,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${sentiment.bearish}%`,
          height: '100%',
          backgroundColor: '#EF4444',
          transition: 'width 0.8s ease',
        }} />
        <div style={{
          width: `${sentiment.neutral}%`,
          height: '100%',
          backgroundColor: themeObj.stickerText.tertiary,
          opacity: 0.4,
          transition: 'width 0.8s ease',
        }} />
        <div style={{
          width: `${sentiment.bullish}%`,
          height: '100%',
          backgroundColor: '#10B981',
          transition: 'width 0.8s ease',
        }} />
      </div>

      {/* Reading label */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        color: readingColor,
        lineHeight: 1,
        transition: 'color 0.5s ease',
      }}>
        {readingLabel}
      </div>
    </div>
  )
}
