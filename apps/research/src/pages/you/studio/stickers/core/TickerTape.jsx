import useLivePrices from '../../hooks/useLivePrices'

const TOKENS = ['BTC', 'ETH', 'SOL', 'AVAX', 'DOGE', 'ADA', 'DOT', 'LINK', 'MATIC', 'XRP']

const BULL = '#10B981'
const BEAR = '#EF4444'

/**
 * TickerTape — Horizontally scrolling strip of live token prices.
 * Displays 10 tokens with price and 24h change, scrolling infinitely.
 * Designed for full-width, 36px tall.
 */
export default function TickerTape({ sticker, themeObj }) {
  const { prices, formatPrice } = useLivePrices()

  // Build the ticker content once, render it twice for seamless loop
  const items = TOKENS.map(token => {
    const data = prices[token]
    if (!data) return null

    const change = data.change24h
    const isUp = change >= 0
    const arrow = isUp ? '\u25B2' : '\u25BC'
    const changeColor = isUp ? BULL : BEAR

    return (
      <span key={token} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
        <span style={{ color: themeObj.stickerText.secondary, fontWeight: 500 }}>{token}</span>
        <span style={{ color: themeObj.stickerText.primary }}>{formatPrice(data.price)}</span>
        <span style={{ color: changeColor }}>{arrow}{Math.abs(change).toFixed(1)}%</span>
      </span>
    )
  }).filter(Boolean)

  // Separator dot between each token
  const separator = (
    <span
      style={{
        color: themeObj.stickerText.tertiary,
        margin: '0 12px',
        userSelect: 'none',
      }}
    >
      &middot;
    </span>
  )

  function renderStrip(keyPrefix) {
    return items.map((item, i) => (
      <span key={`${keyPrefix}-${i}`} style={{ display: 'inline-flex', alignItems: 'center' }}>
        {item}
        {i < items.length - 1 ? separator : null}
      </span>
    ))
  }

  // Keyframe animation name unique to this sticker
  const animName = `ticker-scroll-${sticker.id}`

  return (
    <div
      style={{
        width: '100%',
        height: 36,
        overflow: 'hidden',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        lineHeight: '36px',
        maskImage: 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
        WebkitMaskImage: 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
      }}
    >
      {/* Inline keyframes */}
      <style>{`
        @keyframes ${animName} {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>

      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          whiteSpace: 'nowrap',
          animation: `${animName} 30s linear infinite`,
        }}
      >
        {/* First copy */}
        <span style={{ display: 'inline-flex', alignItems: 'center', paddingRight: 24 }}>
          {renderStrip('a')}
        </span>
        {/* Separator between copies */}
        {separator}
        {/* Second copy for seamless loop */}
        <span style={{ display: 'inline-flex', alignItems: 'center', paddingRight: 24 }}>
          {renderStrip('b')}
        </span>
        {separator}
      </div>
    </div>
  )
}
