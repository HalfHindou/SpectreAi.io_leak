/**
 * SignalStack -- Vertical stack of 4 AI signal badges with direction
 * arrows, token names, conviction levels, and dot bars.
 * Stable per sticker.id (hash-based). Designed for ~220x160.
 */

const TOKENS = ['BTC', 'ETH', 'SOL', 'AVAX', 'DOGE', 'ADA', 'LINK', 'XRP']
const DIRECTIONS = ['UP', 'DOWN', 'NEUTRAL']
const CONVICTIONS = [
  { label: 'High Conviction', filled: 4 },
  { label: 'Medium', filled: 3 },
  { label: 'Low', filled: 2 },
  { label: 'Very Low', filled: 1 },
]

function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + ch
    hash = hash & hash
  }
  return Math.abs(hash)
}

function getDirectionColor(dir) {
  if (dir === 'UP') return '#10B981'
  if (dir === 'DOWN') return '#EF4444'
  return '#F59E0B'
}

function DirectionArrow({ direction, color }) {
  if (direction === 'UP') {
    return (
      <svg width={14} height={14} viewBox="0 0 14 14" style={{ display: 'block', flexShrink: 0 }}>
        <polygon points="7,2 12,10 2,10" fill={color} />
      </svg>
    )
  }
  if (direction === 'DOWN') {
    return (
      <svg width={14} height={14} viewBox="0 0 14 14" style={{ display: 'block', flexShrink: 0 }}>
        <polygon points="7,12 2,4 12,4" fill={color} />
      </svg>
    )
  }
  // NEUTRAL: right-pointing triangle
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" style={{ display: 'block', flexShrink: 0 }}>
      <polygon points="3,2 11,7 3,12" fill={color} />
    </svg>
  )
}

function ConvictionDots({ filled, activeColor, inactiveColor }) {
  const dots = []
  for (let i = 0; i < 5; i++) {
    dots.push(
      <circle
        key={i}
        cx={5 + i * 10}
        cy={5}
        r={3}
        fill={i < filled ? activeColor : 'transparent'}
        stroke={i < filled ? activeColor : inactiveColor}
        strokeWidth={1}
        opacity={i < filled ? 1 : 0.2}
      />
    )
  }
  return (
    <svg width={50} height={10} viewBox="0 0 50 10" style={{ display: 'block', flexShrink: 0 }}>
      {dots}
    </svg>
  )
}

function generateSignals(stickerId) {
  const base = hashString(stickerId)
  const signals = []
  for (let i = 0; i < 4; i++) {
    const h = hashString(stickerId + '-' + i)
    const token = TOKENS[(base + i * 3) % TOKENS.length]
    const direction = DIRECTIONS[h % DIRECTIONS.length]
    const conviction = CONVICTIONS[(h >> 3) % CONVICTIONS.length]
    signals.push({ token, direction, conviction })
  }
  return signals
}

export default function SignalStack({ sticker, themeObj }) {
  const signals = generateSignals(sticker.id)

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      padding: '8px 10px',
      boxSizing: 'border-box',
      gap: 0,
    }}>
      {signals.map((sig, i) => {
        const dirColor = getDirectionColor(sig.direction)
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 0',
              borderBottom: i < signals.length - 1
                ? `2px solid ${themeObj.stickerText.tertiary}14`
                : 'none',
            }}
          >
            <DirectionArrow direction={sig.direction} color={dirColor} />

            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 700,
              color: themeObj.stickerText.primary,
              lineHeight: 1,
              minWidth: 32,
            }}>
              {sig.token}
            </span>

            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: themeObj.stickerText.secondary,
              lineHeight: 1,
              flex: 1,
              minWidth: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {sig.conviction.label}
            </span>

            <ConvictionDots
              filled={sig.conviction.filled}
              activeColor={dirColor}
              inactiveColor={themeObj.stickerText.tertiary}
            />
          </div>
        )
      })}
    </div>
  )
}
