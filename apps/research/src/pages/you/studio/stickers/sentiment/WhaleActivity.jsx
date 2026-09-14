/**
 * WhaleActivity -- Recent large wallet movements.
 * 3-4 rows with colored dot, description, and time.
 * Stable data per sticker.id (hash-based). Designed for ~280x120.
 */

function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + ch
    hash = hash & hash
  }
  return Math.abs(hash)
}

const ACTIVITIES = [
  { type: 'buy',      color: '#10B981', amounts: ['$2.1M', '$4.5M', '$1.8M', '$3.2M'], tokens: ['BTC', 'ETH', 'SOL', 'BTC'], verb: 'Accumulated' },
  { type: 'sell',     color: '#EF4444', amounts: ['$800K', '$1.2M', '$2.4M', '$950K'], tokens: ['ETH', 'SOL', 'BTC', 'AVAX'], verb: 'Sold' },
  { type: 'transfer', color: '#F59E0B', amounts: ['$5M', '$12M', '$3.8M', '$7.2M'], tokens: ['USDT', 'USDC', 'USDT', 'USDT'], verb: 'Transferred' },
  { type: 'buy',      color: '#10B981', amounts: ['$6.3M', '$900K', '$2.7M', '$1.5M'], tokens: ['BTC', 'ETH', 'BTC', 'SOL'], verb: 'Accumulated' },
]

const TIMES = ['2h ago', '5h ago', '8h ago', '12h ago', '1d ago', '3h ago', '6h ago', '14h ago']

function generateActivities(stickerId) {
  const base = hashString(stickerId)
  const count = 3 + (base % 2) // 3 or 4 rows
  const rows = []
  for (let i = 0; i < count; i++) {
    const h = hashString(stickerId + '-whale-' + i)
    const activity = ACTIVITIES[(base + i) % ACTIVITIES.length]
    const amountIdx = (h >> 2) % activity.amounts.length
    const tokenIdx = (h >> 4) % activity.tokens.length
    const timeIdx = (base + i * 3) % TIMES.length
    rows.push({
      color: activity.color,
      text: `${activity.verb} ${activity.amounts[amountIdx]} ${activity.tokens[tokenIdx]}`,
      amount: activity.amounts[amountIdx],
      time: TIMES[timeIdx],
    })
  }
  return rows
}

export default function WhaleActivity({ sticker, themeObj }) {
  const rows = generateActivities(sticker.id)

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      padding: '8px 12px',
      boxSizing: 'border-box',
      gap: 6,
    }}>
      {/* Title */}
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        color: themeObj.stickerText.tertiary,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        lineHeight: 1,
        marginBottom: 2,
      }}>
        Whale Activity
      </div>

      {/* Activity rows */}
      {rows.map((row, i) => (
        <div key={i} style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          {/* Dot */}
          <div style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: row.color,
            flexShrink: 0,
          }} />

          {/* Description */}
          <span style={{
            fontFamily: 'var(--font-body, Inter, system-ui, sans-serif)',
            fontSize: 11,
            color: themeObj.stickerText.secondary,
            lineHeight: 1.2,
            flex: 1,
            minWidth: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {row.text}
          </span>

          {/* Time */}
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: themeObj.stickerText.tertiary,
            lineHeight: 1,
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}>
            {row.time}
          </span>
        </div>
      ))}
    </div>
  )
}
