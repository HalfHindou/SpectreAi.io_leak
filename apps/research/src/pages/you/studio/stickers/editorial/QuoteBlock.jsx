/**
 * QuoteBlock -- Pull quote with editorial typography.
 * Floating text, no card or background. Large decorative quotation mark watermark.
 * Designed for ~320x120 sticker area.
 */

const QUOTES = [
  'Price doesn\'t lie. Everything else does.',
  'The best trade you ever made was staying patient.',
  'Smart money doesn\'t announce itself.',
  'Bull markets are born in despair.',
  'Every ATH was once called a bubble.',
  'The chart knows before you do.',
  'Accumulation looks like nothing until it looks like everything.',
]

function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export default function QuoteBlock({ sticker, themeObj }) {
  const quote = QUOTES[hashString(sticker.id) % QUOTES.length]

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px 8px 24px',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* Decorative quotation mark watermark */}
      <div
        style={{
          position: 'absolute',
          top: -20,
          left: -5,
          fontSize: 100,
          fontFamily: "'Playfair Display', Georgia, serif",
          fontWeight: 700,
          color: themeObj.stickerText.tertiary,
          opacity: 0.08,
          lineHeight: 1,
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {'\u201C'}
      </div>

      {/* Quote text */}
      <p
        style={{
          margin: 0,
          fontFamily: "'Playfair Display', Georgia, serif",
          fontStyle: 'italic',
          fontSize: 18,
          lineHeight: 1.5,
          color: themeObj.stickerText.primary,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {quote}
      </p>
    </div>
  )
}
