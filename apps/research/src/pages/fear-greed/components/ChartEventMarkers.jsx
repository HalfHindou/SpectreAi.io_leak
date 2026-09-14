/**
 * SVG event markers rendered inside the chart <svg>
 * Cinematic glassmorphic design with glow effects
 */
import React from 'react'

/** SVG <defs> for marker glow gradients — render once in parent SVG */
export function MarkerDefs() {
  return (
    <defs>
      {/* News marker glow — green */}
      <radialGradient id="fg-marker-glow-news" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="rgba(34,197,94,0.25)" />
        <stop offset="60%" stopColor="rgba(34,197,94,0.08)" />
        <stop offset="100%" stopColor="rgba(34,197,94,0)" />
      </radialGradient>
      {/* Milestone marker glow — blue */}
      <radialGradient id="fg-marker-glow-milestone" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="rgba(59,130,246,0.25)" />
        <stop offset="60%" stopColor="rgba(59,130,246,0.08)" />
        <stop offset="100%" stopColor="rgba(59,130,246,0)" />
      </radialGradient>
      {/* Connecting line gradients */}
      <linearGradient id="fg-marker-line-news" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="rgba(34,197,94,0.4)" />
        <stop offset="100%" stopColor="rgba(34,197,94,0)" />
      </linearGradient>
      <linearGradient id="fg-marker-line-milestone" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="rgba(59,130,246,0.4)" />
        <stop offset="100%" stopColor="rgba(59,130,246,0)" />
      </linearGradient>
    </defs>
  )
}

function MarkerIcon({ x, y, type }) {
  const isMilestone = type === 'milestone'
  const color = isMilestone ? 'rgba(59,130,246,0.85)' : 'rgba(34,197,94,0.85)'
  const glowId = isMilestone ? 'fg-marker-glow-milestone' : 'fg-marker-glow-news'

  return (
    <g>
      {/* Outer glow halo */}
      <circle cx={x} cy={y} r={16} fill={`url(#${glowId})`} className="fg-marker-glow" />

      {/* Glass circle background */}
      <circle
        cx={x} cy={y} r={10}
        fill="rgba(9,9,11,0.75)"
        stroke={color}
        strokeWidth="0.7"
        className="fg-marker-glass"
      />

      {/* Icon inside — larger and clearer */}
      {isMilestone ? (
        <g>
          {/* Flag icon */}
          <line x1={x - 3} y1={y - 4.5} x2={x - 3} y2={y + 5} stroke={color} strokeWidth="0.9" strokeLinecap="round" />
          <path
            d={`M${x - 3},${y - 4.5} l6.5,0 l0,4.5 l-6.5,0`}
            fill="rgba(59,130,246,0.15)"
            stroke={color}
            strokeWidth="0.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      ) : (
        <g>
          {/* Document/news icon */}
          <rect
            x={x - 3.5} y={y - 4.5}
            width="7" height="9"
            rx="1"
            fill="rgba(34,197,94,0.12)"
            stroke={color}
            strokeWidth="0.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line x1={x - 1.5} y1={y - 1.5} x2={x + 2} y2={y - 1.5} stroke={color} strokeWidth="0.6" strokeLinecap="round" />
          <line x1={x - 1.5} y1={y + 0.5} x2={x + 1} y2={y + 0.5} stroke={color} strokeWidth="0.6" strokeLinecap="round" />
        </g>
      )}
    </g>
  )
}

function ChartEventMarkers({ clusters, onMarkerClick, onMarkerHover, activeClusterId }) {
  if (!clusters.length) return null

  return (
    <g className="fg-event-markers-group">
      {clusters.map((cluster, idx) => {
        const { x, y, id, count, events } = cluster
        const isActive = activeClusterId === id
        const isMilestone = events[0].type === 'milestone'
        const accentColor = isMilestone ? 'rgba(59,130,246,0.7)' : 'rgba(34,197,94,0.7)'

        return (
          <g
            key={id}
            className={`fg-event-marker ${isActive ? 'fg-event-marker--active' : ''}`}
            onClick={(e) => { e.stopPropagation(); onMarkerClick(cluster) }}
            onMouseEnter={() => onMarkerHover?.(true)}
            onMouseLeave={() => onMarkerHover?.(false)}
            style={{ cursor: 'pointer', animationDelay: `${idx * 60}ms` }}
          >
            {/* Marker icon — directly on the F&G line */}
            <MarkerIcon x={x} y={y} type={events[0].type} />

            {/* Cluster count badge — pill shape */}
            {count > 1 && (
              <g>
                <rect
                  x={x + 8} y={y - 14}
                  width={count > 9 ? 20 : 16} height={12}
                  rx={6}
                  fill="rgba(245,158,11,0.9)"
                />
                <text
                  x={x + 8 + (count > 9 ? 10 : 8)} y={y - 5.5}
                  textAnchor="middle"
                  fontSize="7"
                  fontWeight="700"
                  fill="#fff"
                  fontFamily="var(--font-mono)"
                >+{count - 1}</text>
              </g>
            )}

            {/* Active ring with pulse */}
            {isActive && (
              <circle cx={x} cy={y} r={15} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" className="fg-event-marker-active" />
            )}
          </g>
        )
      })}
    </g>
  )
}

export default React.memo(ChartEventMarkers)
