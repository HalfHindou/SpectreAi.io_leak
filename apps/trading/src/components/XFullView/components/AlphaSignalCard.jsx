import { memo } from 'react'

/**
 * AlphaSignalCard — renders rule-based insights from useAlphaSignals.
 *
 * Each signal: severity-coded card with icon + label + hint + value badge.
 * Sorted hot -> warm -> cool -> info upstream by useAlphaSignals.
 */
function AlphaSignalCard({ signals }) {
  const hasSignals = Array.isArray(signals) && signals.length > 0

  return (
    <div className="xfv-panel">
      <div className="xfv-panel-header">
        <div
          className="xfv-panel-title xfv-tip"
          data-xfv-tip="Rule-based signals derived from this token's X intelligence - momentum spikes, sentiment shifts, KOL pile-ons, holder concentration changes. Sorted hot to warm to cool."
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span>Alpha Signals</span>
        </div>
        {hasSignals && (
          <span
            className="xfv-panel-meta xfv-tip xfv-tip--inline"
            data-xfv-tip={`${signals.length} signals are firing for this token right now.`}
          >
            {signals.length} active
            <span className="xfv-tip-icon" aria-hidden="true">?</span>
          </span>
        )}
      </div>
      <div className="xfv-panel-body">
        {!hasSignals ? (
          <div className="xfv-empty">No actionable signals right now</div>
        ) : (
          <div className="xfv-signal-list">
            {signals.map((s, i) => (
              <div
                key={s.id || i}
                className={`xfv-signal xfv-signal--${s.severity || 'info'}`}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <SignalIcon icon={s.icon} className="xfv-signal-icon-flat" />
                <div className="xfv-signal-body">
                  <div className="xfv-signal-label">{s.label}</div>
                  {s.hint && <div className="xfv-signal-hint">{s.hint}</div>}
                </div>
                {s.value && <div className="xfv-signal-value">{s.value}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Inline SVG icons keyed off the icon string useAlphaSignals returns.
 * No external icon dep — keeps the bundle clean.
 */
function SignalIcon({ icon, className }) {
  const props = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    width: 14,
    height: 14,
    className,
  }
  switch (icon) {
    case 'flame':
      return (
        <svg {...props}>
          <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
        </svg>
      )
    case 'eye-off':
      return (
        <svg {...props}>
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </svg>
      )
    case 'shield-check':
      return (
        <svg {...props}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      )
    case 'shield':
      return (
        <svg {...props}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      )
    case 'trending-up':
      return (
        <svg {...props}>
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      )
    case 'thumbs-up':
      return (
        <svg {...props}>
          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
        </svg>
      )
    case 'thumbs-down':
      return (
        <svg {...props}>
          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
        </svg>
      )
    case 'broadcast':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="2" />
          <path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" />
        </svg>
      )
    case 'chevrons-up':
      return (
        <svg {...props}>
          <polyline points="17 11 12 6 7 11" />
          <polyline points="17 18 12 13 7 18" />
        </svg>
      )
    case 'chevrons-down':
      return (
        <svg {...props}>
          <polyline points="7 13 12 18 17 13" />
          <polyline points="7 6 12 11 17 6" />
        </svg>
      )
    case 'zap':
      return (
        <svg {...props}>
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      )
    case 'user-plus':
      return (
        <svg {...props}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <line x1="20" y1="8" x2="20" y2="14" />
          <line x1="23" y1="11" x2="17" y2="11" />
        </svg>
      )
    default:
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
      )
  }
}

export default memo(AlphaSignalCard)
