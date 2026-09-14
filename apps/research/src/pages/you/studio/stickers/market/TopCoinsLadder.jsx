import { useMemo } from 'react'
import useLivePrices from '../../hooks/useLivePrices'

/**
 * TopCoinsLadder -- Vertical leaderboard of top-performing tokens sorted by 24h change.
 * Re-sorts every update (3s) so ranks shift dynamically.
 * Designed for ~240x280 sticker area.
 */

const TOKENS = ['BTC', 'ETH', 'SOL', 'AVAX', 'DOGE', 'ADA', 'DOT', 'LINK']

export default function TopCoinsLadder({ sticker, themeObj }) {
  const { prices } = useLivePrices()

  const sorted = useMemo(() => {
    return TOKENS
      .filter((t) => prices[t])
      .map((t) => ({ token: t, change: prices[t].change24h }))
      .sort((a, b) => b.change - a.change)
  }, [prices])

  if (sorted.length === 0) return null

  const maxAbs = Math.max(...sorted.map((s) => Math.abs(s.change)), 0.01)
  const barMaxWidth = 120

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 0,
        padding: '6px 8px',
        boxSizing: 'border-box',
      }}
    >
      {sorted.map((item, idx) => {
        const isUp = item.change >= 0
        const barColor = isUp ? '#10B981' : '#EF4444'
        const barWidth = Math.max(4, (Math.abs(item.change) / maxAbs) * barMaxWidth)

        return (
          <div
            key={item.token}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 28,
              borderBottom: idx < sorted.length - 1
                ? `1px solid ${themeObj.stickerText.tertiary}1a`
                : 'none',
            }}
          >
            {/* Rank */}
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: themeObj.stickerText.tertiary,
                width: 14,
                textAlign: 'right',
                flexShrink: 0,
              }}
            >
              {idx + 1}
            </span>

            {/* Token symbol */}
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 700,
                color: themeObj.stickerText.primary,
                width: 42,
                flexShrink: 0,
              }}
            >
              {item.token}
            </span>

            {/* Change % */}
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: barColor,
                width: 50,
                textAlign: 'right',
                flexShrink: 0,
              }}
            >
              {isUp ? '+' : ''}{item.change.toFixed(2)}%
            </span>

            {/* Mini horizontal bar */}
            <div
              style={{
                flex: 1,
                height: 6,
                position: 'relative',
                borderRadius: 3,
                overflow: 'hidden',
                backgroundColor: `${themeObj.stickerText.tertiary}0d`,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  height: '100%',
                  width: barWidth,
                  maxWidth: '100%',
                  backgroundColor: barColor,
                  borderRadius: 3,
                  transition: 'width 0.8s ease',
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
