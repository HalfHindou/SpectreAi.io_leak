/**
 * BigLabel -- Huge faded background text element.
 * Acts as a canvas texture / atmosphere element. No card, no border.
 * Designed for ~600x180 sticker area.
 */

const WORDS = ['BITCOIN', 'ACCUMULATE', 'PATIENCE', 'CONVICTION', 'SIGNAL']

function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export default function BigLabel({ sticker, themeObj }) {
  const word = WORDS[hashString(sticker.id) % WORDS.length]

  const isStreetArt = themeObj.group === 'color'

  const fontFamily = isStreetArt
    ? "'Permanent Marker', cursive"
    : "'Space Grotesk', sans-serif"

  const textOpacity = isStreetArt ? 0.08 : 0.04

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'visible',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <span
        style={{
          fontFamily,
          fontWeight: 600,
          fontSize: 140,
          color: themeObj.stickerText.primary,
          opacity: textOpacity,
          letterSpacing: '-0.02em',
          lineHeight: 1,
          whiteSpace: 'nowrap',
          transform: 'rotate(-4deg)',
          display: 'block',
        }}
      >
        {word}
      </span>
    </div>
  )
}
