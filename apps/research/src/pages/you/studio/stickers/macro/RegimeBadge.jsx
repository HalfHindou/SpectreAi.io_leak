/**
 * RegimeBadge -- Large status badge for the current market regime.
 * Stable per sticker.id (hash-based, not random per render).
 * Designed for ~240x70 sticker area.
 */

const REGIMES = [
  { label: 'ACCUMULATION', color: '#10B981', subtitle: 'Institutions accumulating spot BTC' },
  { label: 'DISTRIBUTION', color: '#EF4444', subtitle: 'Selling pressure across majors' },
  { label: 'BREAKOUT',     color: '#10B981', subtitle: 'Price breaking above key resistance' },
  { label: 'RISK OFF',     color: '#EF4444', subtitle: 'Capital rotating to stables and cash' },
  { label: 'CHOP',         color: '#F59E0B', subtitle: 'Range-bound with no clear direction' },
]

function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + ch
    hash = hash & hash // Convert to 32-bit int
  }
  return Math.abs(hash)
}

export default function RegimeBadge({ sticker, themeObj }) {
  const regime = REGIMES[hashString(sticker.id) % REGIMES.length]

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '10px 16px',
      boxSizing: 'border-box',
      backgroundColor: regime.color + '14', // ~0.08 opacity hex
      border: `1px solid ${regime.color}26`,  // ~0.15 opacity hex
      borderRadius: 12,
    }}>
      {/* Regime label */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 18,
        fontWeight: 700,
        color: regime.color,
        letterSpacing: '0.06em',
        lineHeight: 1,
        textAlign: 'center',
      }}>
        {regime.label}
      </div>

      {/* Subtitle */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        color: themeObj.stickerText.secondary,
        lineHeight: 1.3,
        textAlign: 'center',
        marginTop: 6,
      }}>
        {regime.subtitle}
      </div>
    </div>
  )
}
