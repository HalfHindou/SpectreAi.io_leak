/**
 * GraffitiCrown -- Basquiat-style 3-point crown above a token name.
 * Street Art theme sticker, 100x80.
 */
export default function GraffitiCrown({ sticker, themeObj }) {
  const token = sticker.token || 'BTC'

  return (
    <svg
      viewBox="0 0 100 80"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {/* Crown shape */}
      <polygon
        points="15,45 30,15 50,35 70,15 85,45"
        fill="#F7C31A"
        stroke="#000"
        strokeWidth="3"
        strokeLinejoin="round"
      />

      {/* Crown base line */}
      <line x1="15" y1="45" x2="85" y2="45" stroke="#000" strokeWidth="3" />

      {/* Basquiat decorative marks -- 3 short vertical lines inside crown */}
      <line x1="35" y1="22" x2="35" y2="32" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="50" y1="18" x2="50" y2="28" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="65" y1="22" x2="65" y2="32" stroke="#000" strokeWidth="2.5" strokeLinecap="round" />

      {/* Token name */}
      <text
        x="50"
        y="70"
        textAnchor="middle"
        fontFamily="'Permanent Marker', cursive, 'Arial Black', sans-serif"
        fontSize="22"
        fontWeight="900"
        fill={themeObj.stickerText.primary}
        stroke="#000"
        strokeWidth="1.5"
        paintOrder="stroke"
      >
        {token}
      </text>
    </svg>
  )
}
