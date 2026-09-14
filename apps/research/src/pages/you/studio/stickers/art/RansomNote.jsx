/**
 * RansomNote -- Each letter cut from a different "source".
 * Random font, size, color, rotation per letter.
 * Street Art theme sticker, 400x80.
 */

const WORDS = ['BITCOIN', 'ETHEREUM', 'HODL', 'GREED', 'TO THE MOON']
const FONTS = [
  "'Arial Black', sans-serif",
  "'Courier New', monospace",
  "'Georgia', serif",
  "'Impact', sans-serif",
  "'Times New Roman', serif",
  "'Trebuchet MS', sans-serif",
]
const COLORS = ['#F7C31A', '#FF6B35', '#00CED1', '#FF69B4', '#10B981', '#EF4444', '#627EEA']
const BG_COLORS = ['#F7C31A', '#FF6B35', '#00CED1', '#FF69B4', '#10B981', '#EF4444', '#627EEA']

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

export default function RansomNote({ sticker, themeObj }) {
  const hash = hashString(sticker.id)
  const text = sticker.data?.text || WORDS[hash % WORDS.length]
  const chars = text.split('')

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        whiteSpace: 'nowrap',
        overflow: 'visible',
        width: '100%',
        height: '100%',
        justifyContent: 'center',
      }}
    >
      {chars.map((char, i) => {
        if (char === ' ') {
          return (
            <span
              key={i}
              style={{ display: 'inline-block', width: 12 }}
            />
          )
        }

        const seed = hashString(sticker.id + i + char)
        const font = FONTS[seed % FONTS.length]
        const size = 28 + (seed % 33) // 28-60px
        const color = COLORS[(seed >> 3) % COLORS.length]
        const rotation = ((seed % 17) - 8) // -8 to +8 deg
        const bgColor = BG_COLORS[(seed >> 5) % BG_COLORS.length]
        const pad = 2 + (seed % 3) // 2-4px

        return (
          <span
            key={i}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: font,
              fontSize: size,
              fontWeight: 900,
              color: color,
              transform: `rotate(${rotation}deg)`,
              backgroundColor: bgColor + '26', // ~0.15 opacity (hex)
              padding: `${pad}px ${pad + 1}px`,
              borderRadius: 2,
              lineHeight: 1,
              marginLeft: -1,
              marginRight: -1,
            }}
          >
            {char}
          </span>
        )
      })}
    </div>
  )
}
