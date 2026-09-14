/**
 * ThrowUp -- Bubble graffiti letters with thick stroke and fill.
 * Street Art theme sticker, 300x100.
 */

const WORDS = ['BULL', 'BEAR', 'MOON', 'REKT', 'HODL']
const FILL_PALETTE = ['#ffffff', '#F7C31A', '#FF69B4', '#00CED1', '#10B981']

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

export default function ThrowUp({ sticker, themeObj }) {
  const hash = hashString(sticker.id)
  const word = sticker.data?.text || WORDS[hash % WORDS.length]
  const fillColor = FILL_PALETTE[(hash >> 4) % FILL_PALETTE.length]
  const letters = word.split('')
  const letterWidth = 280 / Math.max(letters.length, 1)

  return (
    <svg
      viewBox="0 0 300 100"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {letters.map((letter, i) => {
        const seed = hashString(sticker.id + i)
        const yOffset = (seed % 7) - 3 // -3 to +3 px
        const x = 10 + i * letterWidth + letterWidth * 0.5

        return (
          <text
            key={i}
            x={x}
            y={62 + yOffset}
            textAnchor="middle"
            fontFamily="'Arial Black', sans-serif"
            fontSize="72"
            fontWeight="900"
            fill={fillColor}
            stroke="#000"
            strokeWidth="7"
            strokeLinejoin="round"
            paintOrder="stroke"
            letterSpacing="-3"
          >
            {letter}
          </text>
        )
      })}
    </svg>
  )
}
