/**
 * StatBlock -- Generic stat display with label, value, and subtitle.
 * Clean text hierarchy, no border or card.
 * Designed for ~200x80 sticker area.
 */

const STATS = [
  { label: 'OPEN INTEREST', value: '$42.8B', sub: '+4.2%', subText: 'Longs dominant', positive: true },
  { label: 'TOTAL VALUE LOCKED', value: '$89.2B', sub: '+2.1%', subText: 'DeFi growing', positive: true },
  { label: 'DAILY VOLUME', value: '$127B', sub: '-8.4%', subText: 'Cooling off', positive: false },
  { label: 'ACTIVE ADDRESSES', value: '1.2M', sub: '+12%', subText: 'Network growth', positive: true },
  { label: 'STABLECOIN SUPPLY', value: '$162B', sub: '+0.8%', subText: 'Inflows steady', positive: true },
]

function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

export default function StatBlock({ sticker, themeObj }) {
  const stat = STATS[hashString(sticker.id) % STATS.length]
  const arrow = stat.positive ? '\u25B2' : '\u25BC'
  const changeColor = stat.positive ? '#10B981' : '#EF4444'

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '8px 12px',
        boxSizing: 'border-box',
        gap: 4,
      }}
    >
      {/* Label */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          fontWeight: 500,
          color: themeObj.stickerText.tertiary,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          lineHeight: 1,
        }}
      >
        {stat.label}
      </div>

      {/* Value */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 26,
          fontWeight: 700,
          color: themeObj.stickerText.primary,
          lineHeight: 1,
          letterSpacing: '-0.01em',
        }}
      >
        {stat.value}
      </div>

      {/* Subtitle with arrow */}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: themeObj.stickerText.secondary,
          lineHeight: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <span style={{ color: changeColor, fontSize: 9 }}>{arrow}</span>
        <span style={{ color: changeColor }}>{stat.sub}</span>
        <span style={{ opacity: 0.7 }}>&middot;</span>
        <span>{stat.subText}</span>
      </div>
    </div>
  )
}
