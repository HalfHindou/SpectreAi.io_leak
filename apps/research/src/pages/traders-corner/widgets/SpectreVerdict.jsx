/**
 * W-030 · Spectre Verdict Widget
 * Intelligence analysis panel with editorial quote, signal rows, and tags.
 * Purple ambient glass card. Uses real scenario data from useMarketIntel.
 */
import { useMarketIntel } from '@/hooks/useMarketIntel'
import './SpectreVerdict.css'

/* ---------- tag colors (dynamic per-tag — stay inline) ---------- */

const TAG_COLORS = {
  BULLISH: { bg: 'var(--bull-muted)', color: 'var(--bull)' },
  BEARISH: { bg: 'var(--bear-muted)', color: 'var(--bear)' },
  CAUTION: { bg: 'rgba(245,158,11,0.12)', color: 'var(--amber)' },
  NEUTRAL: { bg: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' },
}

/** Map scenario key level labels to signal tags */
function levelToTag(label) {
  const l = (label || '').toLowerCase()
  if (l.includes('support') || l.includes('target') || l.includes('squeeze') || l.includes('breakout')) return 'BULLISH'
  if (l.includes('invalidation')) return 'BEARISH'
  if (l.includes('resistance') || l.includes('range')) return 'CAUTION'
  return 'NEUTRAL'
}

/* ---------- component ---------- */

export default function SpectreVerdict() {
  const { scenario, lastUpdated, loading } = useMarketIntel()

  const hasData = scenario && scenario.confidence > 0
  const timestamp = lastUpdated
    ? lastUpdated.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
    : null

  // Use scenario color for accent, fallback to violet
  const accentColor = scenario?.color || '#a78bfa'
  const accentRgba = (opacity) => {
    // Parse hex color to rgba
    const hex = accentColor.replace('#', '')
    const r = parseInt(hex.substring(0, 2), 16)
    const g = parseInt(hex.substring(2, 4), 16)
    const b = parseInt(hex.substring(4, 6), 16)
    return `rgba(${r},${g},${b},${opacity})`
  }

  // Build signal rows from keyLevels
  const signals = hasData
    ? (scenario.keyLevels || []).map((kl) => ({
        text: `${kl.label}: ${kl.price}`,
        tag: levelToTag(kl.label),
      }))
    : []

  return (
    <div
      className="tcsv"
      style={{
        background: `linear-gradient(168deg, ${accentRgba(0.06)}, rgba(19,19,22,0.98))`,
        border: `1px solid ${accentRgba(0.2)}`,
      }}
    >
      {/* Top-edge accent glow */}
      <div
        className="tcsv-glow"
        style={{ background: `linear-gradient(90deg, transparent, ${accentRgba(0.5)}, ${accentRgba(0.3)}, transparent)` }}
      />

      {/* Header */}
      <div className="tcsv-head">
        <div className="tcsv-head-left">
          <span className="tcsv-title">SPECTRE VERDICT</span>

          {/* Confidence badge */}
          {hasData && scenario.confidence > 0 && (
            <span className="tcsv-conf" style={{ background: accentRgba(0.15), color: accentColor }}>
              {scenario.confidence}% conf
            </span>
          )}
        </div>

        {timestamp && <span className="tcsv-timestamp">{timestamp}</span>}
      </div>

      {/* Verdict label */}
      {hasData && (
        <div className="tcsv-verdict">
          <span className="tcsv-verdict-text" style={{ color: accentColor }}>
            {scenario.label}
          </span>
        </div>
      )}

      {/* Main quote (scenario trigger) */}
      <div className="tcsv-quote-wrap">
        {loading && !hasData ? (
          <div className="tcsv-quote-skeleton">
            <div className="tcw-shimmer tcsv-skeleton" style={{ width: '100%', height: 14 }} />
            <div className="tcw-shimmer tcsv-skeleton" style={{ width: '90%', height: 14 }} />
            <div className="tcw-shimmer tcsv-skeleton" style={{ width: '75%', height: 14 }} />
          </div>
        ) : (
          <p className="tcsv-quote">
            {scenario?.trigger || 'Awaiting market data...'}
          </p>
        )}
      </div>

      {/* Divider */}
      <div className="tcsv-divider" style={{ background: accentRgba(0.1) }} />

      {/* Signal rows from key levels */}
      <div className="tcsv-signals">
        {loading && !hasData ? (
          Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="tcw-shimmer tcsv-skeleton" style={{ width: '100%', height: 20 }} />
          ))
        ) : (
          signals.map((sig, i) => {
            const tagStyle = TAG_COLORS[sig.tag] || TAG_COLORS.NEUTRAL
            return (
              <div key={i} className="tcsv-signal">
                <div className="tcsv-signal-dot" style={{ background: tagStyle.color }} />
                <span className="tcsv-signal-text">{sig.text}</span>
                <span className="tcsv-tag" style={{ background: tagStyle.bg, color: tagStyle.color }}>
                  {sig.tag}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
