/**
 * Headline -- Newspaper-style headline with date stamp.
 * Optional subtle cream bg on light themes.
 * Designed for ~360x80 sticker area.
 */

const HEADLINES = [
  'BITCOIN SURGES PAST $97,000 AS INSTITUTIONS ACCUMULATE',
  'ETHEREUM BREAKS OUT OF RANGE, SIGNALS TREND REVERSAL',
  'CRYPTO MARKET CAP HITS NEW ALL-TIME HIGH',
  'FED SIGNALS RATE CUTS, RISK ASSETS RALLY',
  'WHALE ACCUMULATION REACHES 6-MONTH HIGH',
]

function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export default function Headline({ sticker, themeObj }) {
  const headline = HEADLINES[hashString(sticker.id) % HEADLINES.length]
  const isLight = themeObj.group === 'light'

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '10px 16px',
        boxSizing: 'border-box',
        backgroundColor: isLight ? 'rgba(250, 248, 243, 0.5)' : 'transparent',
        borderRadius: isLight ? 4 : 0,
      }}
    >
      {/* Headline text */}
      <div
        style={{
          fontFamily: "'Playfair Display', Georgia, serif",
          fontWeight: 700,
          fontSize: 18,
          lineHeight: 1.3,
          color: themeObj.stickerText.primary,
          margin: 0,
        }}
      >
        {headline}
      </div>

      {/* Horizontal rule */}
      <div
        style={{
          width: '100%',
          height: 1,
          backgroundColor: themeObj.stickerText.tertiary,
          opacity: 0.15,
          margin: '8px 0 6px',
          flexShrink: 0,
        }}
      />

      {/* Date line */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          color: themeObj.stickerText.tertiary,
          letterSpacing: '0.04em',
          lineHeight: 1,
        }}
      >
        Feb 22, 2026 &middot; Spectre Intelligence
      </div>
    </div>
  )
}
