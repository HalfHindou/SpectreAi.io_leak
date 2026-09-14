/**
 * PmSourceBadge — the source identity pill (Polymarket vs Kalshi).
 *
 * A bespoke half-disc glyph: Polymarket fills the LEFT half, Kalshi the RIGHT.
 * The motif visually says "two halves of a market" and sets up the arbitrage
 * story. The source hue is whisper-quiet (8% bg, 16% border) so warm-white +
 * the green/red odds bars stay the protagonists.
 *
 * `compact` drops the wordmark to just the glyph (footer/dense contexts).
 */
import { useState } from 'react'
import { SOURCE_META } from './predictions-constants'
import './pm-source-badge.css'

export function PmSourceGlyph({ side = 'left', hue = '108 140 180', size = 10 }) {
  const r = (size / 10) * 4.25
  const c = size / 2
  const d = side === 'left'
    ? `M${c} ${c - r} A${r} ${r} 0 0 0 ${c} ${c + r} Z`
    : `M${c} ${c - r} A${r} ${r} 0 0 1 ${c} ${c + r} Z`
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="pm-src-glyph">
      <circle cx={c} cy={c} r={r} fill="none" stroke={`rgb(${hue})`} strokeOpacity="0.5" strokeWidth="1" />
      <path d={d} fill={`rgb(${hue})`} fillOpacity="0.55" />
    </svg>
  )
}

function PmSourceBadge({ source = 'polymarket', compact = false }) {
  const meta = SOURCE_META[source] || SOURCE_META.polymarket
  const [logoOk, setLogoOk] = useState(true)
  return (
    <span
      className={`pm-src pm-src--${meta.id}${compact ? ' pm-src--compact' : ''}`}
      style={{ '--src-hue': meta.hue }}
    >
      {meta.logo && logoOk ? (
        <img
          className="pm-src-logo"
          src={meta.logo}
          alt=""
          loading="lazy"
          onError={() => setLogoOk(false)}
        />
      ) : (
        <PmSourceGlyph side={meta.side} hue={meta.hue} />
      )}
      {!compact && <span className="pm-src-name">{meta.label}</span>}
    </span>
  )
}

export default PmSourceBadge
