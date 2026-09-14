/**
 * WarholGrid -- Pop art 2x2 grid of Bitcoin symbols.
 * Street Art theme sticker, 200x200.
 */
export default function WarholGrid({ sticker, themeObj }) {
  const cells = [
    { bg: '#FF69B4', fill: '#F7C31A', cx: 50,  cy: 50  },
    { bg: '#F7C31A', fill: '#FF69B4', cx: 150, cy: 50  },
    { bg: '#FF6B35', fill: '#00CED1', cx: 50,  cy: 150 },
    { bg: '#00CED1', fill: '#FF6B35', cx: 150, cy: 150 },
  ]

  return (
    <svg
      viewBox="0 0 200 200"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {cells.map((cell, i) => (
        <g key={i}>
          {/* Cell background */}
          <rect
            x={i % 2 === 0 ? 0 : 100}
            y={i < 2 ? 0 : 100}
            width="100"
            height="100"
            fill={cell.bg}
          />
          {/* Bitcoin symbol */}
          <text
            x={cell.cx}
            y={cell.cy + 20}
            textAnchor="middle"
            fontFamily="'Arial Black', sans-serif"
            fontSize="60"
            fontWeight="900"
            fill={cell.fill}
            stroke="#000"
            strokeWidth="3"
            paintOrder="stroke"
          >
            {'\u20BF'}
          </text>
        </g>
      ))}

      {/* Grid lines */}
      <line x1="100" y1="0" x2="100" y2="200" stroke="#000" strokeWidth="3" />
      <line x1="0" y1="100" x2="200" y2="100" stroke="#000" strokeWidth="3" />

      {/* Border */}
      <rect
        x="1.5" y="1.5" width="197" height="197"
        fill="none" stroke="#000" strokeWidth="3"
      />
    </svg>
  )
}
