/**
 * PaintedBTC -- Large Bitcoin symbol rendered as painted SVG art.
 * Street Art theme sticker, 160x160.
 */
export default function PaintedBTC({ sticker, themeObj }) {
  return (
    <svg
      viewBox="0 0 160 160"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={`btc-grad-${sticker.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#F7C31A" />
          <stop offset="100%" stopColor="#FF9500" />
        </linearGradient>

        {/* Paint texture filter */}
        <filter id={`paint-tex-${sticker.id}`} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence
            type="turbulence"
            baseFrequency="0.05"
            numOctaves="3"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="2"
            result="displaced"
          />
          <feComposite in="displaced" in2="SourceGraphic" operator="in" />
        </filter>
      </defs>

      {/* Main Bitcoin symbol */}
      <text
        x="80"
        y="120"
        textAnchor="middle"
        fontFamily="'Arial Black', sans-serif"
        fontSize="120"
        fontWeight="900"
        fill={`url(#btc-grad-${sticker.id})`}
        stroke="rgba(0,0,0,0.9)"
        strokeWidth="5"
        paintOrder="stroke"
        transform="rotate(-4 80 80)"
      >
        {'\u20BF'}
      </text>

      {/* Paint texture overlay */}
      <text
        x="80"
        y="120"
        textAnchor="middle"
        fontFamily="'Arial Black', sans-serif"
        fontSize="120"
        fontWeight="900"
        fill="rgba(0,0,0,0.25)"
        stroke="none"
        transform="rotate(-4 80 80)"
        filter={`url(#paint-tex-${sticker.id})`}
      >
        {'\u20BF'}
      </text>
    </svg>
  )
}
