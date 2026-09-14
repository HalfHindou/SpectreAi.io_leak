/**
 * EchoText -- Same word stacked 3 times with offset for screen-print effect.
 * Street Art theme sticker, 320x120.
 */

const WORDS = ['BULL', 'BEAR', 'HODL', 'MOON', 'ATH']
const PALETTE = ['#F7C31A', '#FF6B35', '#00CED1', '#FF69B4', '#10B981', '#627EEA']

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

export default function EchoText({ sticker, themeObj }) {
  const hash = hashString(sticker.id)
  const word = sticker.data?.text || WORDS[hash % WORDS.length]
  const color1 = PALETTE[hash % PALETTE.length]
  const color2 = PALETTE[(hash + 2) % PALETTE.length]

  const baseStyle = {
    fontFamily: "'Arial Black', sans-serif",
    fontSize: 80,
    fontWeight: 900,
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    lineHeight: 1,
    letterSpacing: '-0.02em',
    position: 'absolute',
    top: 0,
    left: 0,
    userSelect: 'none',
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'visible',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ position: 'relative', display: 'inline-block' }}>
        {/* Layer 3 -- shadow (bottom) */}
        <div
          style={{
            ...baseStyle,
            top: 8,
            left: 8,
            opacity: 0.2,
            color: '#000',
          }}
        >
          {word}
        </div>

        {/* Layer 2 -- mid offset */}
        <div
          style={{
            ...baseStyle,
            top: 4,
            left: 4,
            opacity: 0.4,
            color: color2,
          }}
        >
          {word}
        </div>

        {/* Layer 1 -- top (no offset) */}
        <div
          style={{
            ...baseStyle,
            position: 'relative',
            opacity: 1,
            color: color1,
          }}
        >
          {word}
        </div>
      </div>
    </div>
  )
}
