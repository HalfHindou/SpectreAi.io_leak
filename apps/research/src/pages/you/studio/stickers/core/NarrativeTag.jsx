/**
 * NarrativeTag — Pill badge showing a current market narrative.
 * Text comes from sticker.data.text or a stable hash-picked default.
 * Auto-sizes to content width.
 */

const NARRATIVES = [
  'AI Tokens',
  'L2 Rotation',
  'Memecoin Season',
  'DeFi Revival',
  'Risk Off',
  'Accumulation Zone',
  'BTC Dominance',
  'ETH Surge',
]

function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function hexToRgb(hex) {
  const cleaned = hex.replace('#', '')
  const r = parseInt(cleaned.substring(0, 2), 16)
  const g = parseInt(cleaned.substring(2, 4), 16)
  const b = parseInt(cleaned.substring(4, 6), 16)
  return { r, g, b }
}

export default function NarrativeTag({ sticker, themeObj }) {
  const text =
    sticker.data?.text ||
    NARRATIVES[hashString(sticker.id) % NARRATIVES.length]

  const accent = themeObj.accentColor || '#8b5cf6'
  const rgb = hexToRgb(accent)

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        whiteSpace: 'nowrap',
        borderRadius: 16,
        padding: '6px 16px',
        backgroundColor: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`,
        border: `1px solid rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.2)`,
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 13,
          fontWeight: 500,
          color: themeObj.stickerText.primary,
          lineHeight: 1,
        }}
      >
        {text}
      </span>
    </div>
  )
}
