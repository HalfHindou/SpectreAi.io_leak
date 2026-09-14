import { useState, useEffect, useRef } from 'react'

/**
 * DominanceStrip — Horizontal stacked bar chart showing BTC / ETH / Others
 * market dominance. Values drift slightly every 5 seconds.
 * Designed for ~280x40 sticker area.
 */
export default function DominanceStrip({ sticker, themeObj }) {
  const dataRef = useRef({ btc: 52, eth: 17 })
  const [segments, setSegments] = useState({
    btc: dataRef.current.btc,
    eth: dataRef.current.eth,
  })

  useEffect(() => {
    const interval = setInterval(() => {
      const btcDrift = (Math.random() - 0.5) * 1.0
      const ethDrift = (Math.random() - 0.5) * 1.0

      dataRef.current.btc = Math.max(40, Math.min(62, dataRef.current.btc + btcDrift))
      dataRef.current.eth = Math.max(10, Math.min(25, dataRef.current.eth + ethDrift))

      // Ensure total never exceeds 100
      const total = dataRef.current.btc + dataRef.current.eth
      if (total > 95) {
        dataRef.current.eth = 95 - dataRef.current.btc
      }

      setSegments({
        btc: Math.round(dataRef.current.btc * 10) / 10,
        eth: Math.round(dataRef.current.eth * 10) / 10,
      })
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  const others = Math.round((100 - segments.btc - segments.eth) * 10) / 10

  const segmentData = [
    { key: 'btc', label: 'BTC', pct: segments.btc, color: '#F7931A' },
    { key: 'eth', label: 'ETH', pct: segments.eth, color: '#627EEA' },
    { key: 'others', label: 'Others', pct: others, color: themeObj.stickerText.tertiary },
  ]

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '4px 0',
        boxSizing: 'border-box',
      }}
    >
      {/* Title */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: themeObj.stickerText.tertiary,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 5,
          lineHeight: 1,
        }}
      >
        Market Dominance
      </div>

      {/* Stacked bar */}
      <div
        style={{
          display: 'flex',
          width: '100%',
          height: 18,
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        {segmentData.map((seg) => (
          <div
            key={seg.key}
            style={{
              width: `${seg.pct}%`,
              height: '100%',
              backgroundColor: seg.color,
              opacity: seg.key === 'others' ? 0.3 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              transition: 'width 0.8s ease',
              position: 'relative',
            }}
          >
            {seg.pct > 20 && (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#ffffff',
                  whiteSpace: 'nowrap',
                  lineHeight: 1,
                  pointerEvents: 'none',
                }}
              >
                {seg.label} {Math.round(seg.pct)}%
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
