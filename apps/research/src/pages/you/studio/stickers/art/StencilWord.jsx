/**
 * StencilWord -- Spray-stenciled word with rough edges.
 * Street Art theme sticker, 200x70.
 */

const WORDS = ['WAGMI', 'HODL', 'BULL', 'BEAR', 'REKT', 'MOON', 'DYOR', 'ATH']
const PALETTE = ['#F7C31A', '#FF6B35', '#00CED1', '#FF69B4', '#10B981']

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

export default function StencilWord({ sticker, themeObj }) {
  const hash = hashString(sticker.id)
  const word = sticker.data?.text || WORDS[hash % WORDS.length]
  const bgColor = PALETTE[hash % PALETTE.length]
  const rotation = (hash % 7) - 3 // -3 to +3 degrees
  const rectRotation = 2 + (hash % 4) // 2 to 5 degrees

  return (
    <svg
      viewBox="0 0 200 70"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <filter id={`spray-${sticker.id}`} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence
            type="turbulence"
            baseFrequency="0.04"
            numOctaves="2"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="3"
          />
        </filter>
      </defs>

      <g transform={`rotate(${rotation} 100 35)`}>
        {/* Background rectangle */}
        <rect
          x="8"
          y="6"
          width="184"
          height="58"
          rx="4"
          ry="4"
          fill={bgColor}
          transform={`rotate(${rectRotation} 100 35)`}
        />

        {/* Stencil text */}
        <text
          x="100"
          y="50"
          textAnchor="middle"
          fontFamily="'Arial Black', sans-serif"
          fontSize="42"
          fontWeight="900"
          fill="#1a1a1f"
          textDecoration="none"
          filter={`url(#spray-${sticker.id})`}
        >
          {word}
        </text>
      </g>
    </svg>
  )
}
