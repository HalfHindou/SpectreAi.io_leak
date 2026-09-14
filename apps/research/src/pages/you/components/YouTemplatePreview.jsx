/**
 * YouTemplatePreview — editorial illustration per template archetype.
 *
 * Each archetype gets a hand-tuned abstract SVG that hints at the dashboard
 * narrative without falling into AI-slop tropes (no neon glows, no bright
 * blue→purple gradients, no robot/sparkle iconography). Warm-white linework
 * on pure black with a single archetype tint, mono-flavoured numerals.
 *
 * Tints: per design-system.md secondary palette, opacity capped at ~12%.
 */

const ARCHETYPE_META = {
  perps:     { tint: 'rgba(245, 158, 11, 0.10)',  ink: 'rgba(245, 158, 11, 0.85)' },
  onchain:   { tint: 'rgba(6, 182, 212, 0.10)',   ink: 'rgba(6, 182, 212, 0.85)' },
  degen:     { tint: 'rgba(236, 72, 153, 0.10)',  ink: 'rgba(236, 72, 153, 0.85)' },
  rwa:       { tint: 'rgba(59, 130, 246, 0.10)',  ink: 'rgba(59, 130, 246, 0.85)' },
  narrative: { tint: 'rgba(167, 139, 250, 0.10)', ink: 'rgba(167, 139, 250, 0.85)' },
  watcher:   { tint: 'rgba(148, 163, 184, 0.08)', ink: 'rgba(245, 245, 247, 0.78)' },
}

const VB = '0 0 360 200'

function PerpsArt({ ink }) {
  // Liquidation wall + funding skew. Horizontal bands stacked into a wall on
  // the right with a dashed spot line crossing through. Reads as "derivatives".
  const bands = [
    { y: 38, w: 110 }, { y: 52, w: 130 }, { y: 66, w: 84 }, { y: 80, w: 156 },
    { y: 94, w: 102 }, { y: 108, w: 178 }, { y: 122, w: 134 }, { y: 136, w: 96 },
    { y: 150, w: 168 }, { y: 164, w: 78 },
  ]
  return (
    <svg viewBox={VB} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g>
        {bands.map((b, i) => (
          <rect key={i} x={32} y={b.y} width={b.w} height={6} rx={1}
            fill={ink} fillOpacity={0.18 + (i % 3) * 0.06} />
        ))}
        {/* skew curve */}
        <path d="M 30 170 Q 130 110 220 90 T 340 38" fill="none"
          stroke="rgba(245, 245, 247, 0.42)" strokeWidth="1.2" />
        {/* spot line */}
        <line x1="20" y1="100" x2="340" y2="100"
          stroke="rgba(245, 245, 247, 0.30)" strokeWidth="0.8" strokeDasharray="2 4" />
        {/* mono ticks */}
        <text x="22" y="32" fontFamily="JetBrains Mono, ui-monospace, monospace"
          fontSize="8" fill="rgba(245, 245, 247, 0.45)" letterSpacing="0.08em">FUNDING / OI</text>
        <text x="306" y="100" fontFamily="JetBrains Mono, ui-monospace, monospace"
          fontSize="7.5" fill={ink} letterSpacing="0.08em">SPOT</text>
      </g>
    </svg>
  )
}

function OnchainArt({ ink }) {
  // Wallet graph — 6 nodes connected by curved flow paths.
  const nodes = [
    { id: 'a', x: 60,  y: 64,  r: 8 },
    { id: 'b', x: 138, y: 38,  r: 5 },
    { id: 'c', x: 212, y: 78,  r: 9 },
    { id: 'd', x: 284, y: 50,  r: 6 },
    { id: 'e', x: 100, y: 138, r: 6 },
    { id: 'f', x: 230, y: 152, r: 7 },
    { id: 'g', x: 318, y: 134, r: 5 },
  ]
  const edges = [
    ['a','b'], ['a','c'], ['b','c'], ['c','d'], ['c','f'],
    ['a','e'], ['e','f'], ['d','g'], ['f','g'],
  ]
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
  return (
    <svg viewBox={VB} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g stroke={ink} strokeOpacity="0.42" strokeWidth="1" fill="none">
        {edges.map(([a, b], i) => {
          const A = byId[a], B = byId[b]
          const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2 - 20
          return <path key={i} d={`M ${A.x} ${A.y} Q ${mx} ${my} ${B.x} ${B.y}`} />
        })}
      </g>
      <g>
        {nodes.map(n => (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r={n.r + 4} fill={ink} fillOpacity="0.10" />
            <circle cx={n.x} cy={n.y} r={n.r} fill="rgba(245, 245, 247, 0.92)" />
          </g>
        ))}
      </g>
      <text x="22" y="28" fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="8" fill="rgba(245, 245, 247, 0.45)" letterSpacing="0.08em">WALLET FLOW</text>
      <text x="276" y="186" fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="7.5" fill={ink} letterSpacing="0.08em">+12 NODES</text>
    </svg>
  )
}

function DegenArt({ ink }) {
  // Breakout candle column. Rising candles, one outsized pump, fresh-pair tag.
  const candles = [
    { x: 48,  o: 130, c: 122, h: 134, l: 118, up: true },
    { x: 64,  o: 122, c: 116, h: 124, l: 112, up: true },
    { x: 80,  o: 116, c: 124, h: 126, l: 114, up: false },
    { x: 96,  o: 124, c: 110, h: 126, l: 106, up: true },
    { x: 112, o: 110, c: 102, h: 112, l:  98, up: true },
    { x: 128, o: 102, c: 108, h: 110, l: 100, up: false },
    { x: 144, o: 108, c:  92, h: 110, l:  88, up: true },
    { x: 160, o:  92, c:  74, h:  94, l:  68, up: true },
    { x: 176, o:  74, c:  46, h:  78, l:  40, up: true },
    { x: 192, o:  46, c:  56, h:  48, l:  60, up: false },
    { x: 208, o:  56, c:  62, h:  58, l:  66, up: false },
  ]
  return (
    <svg viewBox={VB} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {/* Baseline */}
      <line x1="32" y1="170" x2="340" y2="170"
        stroke="rgba(245, 245, 247, 0.10)" strokeWidth="0.8" />
      {candles.map((c, i) => {
        const top = Math.min(c.o, c.c)
        const h = Math.abs(c.c - c.o) || 1
        const fill = c.up ? ink : 'rgba(245, 245, 247, 0.32)'
        return (
          <g key={i}>
            <line x1={c.x + 4} y1={c.h} x2={c.x + 4} y2={c.l}
              stroke={fill} strokeOpacity={c.up ? 0.85 : 0.55} strokeWidth="1" />
            <rect x={c.x} y={top} width={8} height={h} fill={fill}
              fillOpacity={c.up ? 0.92 : 0.42} rx={1} />
          </g>
        )
      })}
      {/* Pump arrow */}
      <path d="M 230 160 Q 260 110 296 70" fill="none" stroke={ink}
        strokeOpacity="0.55" strokeWidth="1.2" strokeDasharray="3 3" />
      <polygon points="296,70 290,76 298,80" fill={ink} fillOpacity="0.65" />
      {/* New-pair tag */}
      <rect x="248" y="22" width="80" height="18" rx="9"
        fill={ink} fillOpacity="0.16" stroke={ink} strokeOpacity="0.45" strokeWidth="0.8" />
      <circle cx="258" cy="31" r="2.5" fill={ink} />
      <text x="266" y="34" fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="8" fontWeight="700" fill={ink} letterSpacing="0.10em">NEW PAIR · 12m</text>
      <text x="22" y="28" fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="8" fill="rgba(245, 245, 247, 0.45)" letterSpacing="0.08em">MOMENTUM</text>
    </svg>
  )
}

function RwaArt({ ink }) {
  // Yield ladder + treasury seal. Stacked horizontal yield tranches with
  // ascending size; a hex outline (treasury) anchors the right.
  const tranches = [
    { y: 44,  w: 156, label: '4.32%' },
    { y: 64,  w: 124, label: '4.78%' },
    { y: 84,  w: 178, label: '5.04%' },
    { y: 104, w: 102, label: '5.21%' },
    { y: 124, w: 198, label: '5.46%' },
    { y: 144, w: 88,  label: '5.92%' },
  ]
  // Hex polygon centred at (300, 100) radius 40
  const hex = (cx, cy, r) => {
    const pts = []
    for (let i = 0; i < 6; i += 1) {
      const a = (Math.PI / 3) * i - Math.PI / 6
      pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`)
    }
    return pts.join(' ')
  }
  return (
    <svg viewBox={VB} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {tranches.map((t, i) => (
        <g key={i}>
          <rect x={28} y={t.y} width={t.w} height={10} rx={1.5}
            fill={ink} fillOpacity={0.20 + (i / tranches.length) * 0.30} />
          <text x={28 + t.w + 6} y={t.y + 8.4}
            fontFamily="JetBrains Mono, ui-monospace, monospace"
            fontSize="7.5" fill="rgba(245, 245, 247, 0.55)" letterSpacing="0.04em">{t.label}</text>
        </g>
      ))}
      {/* treasury seal */}
      <polygon points={hex(300, 100, 38)} fill="none"
        stroke={ink} strokeOpacity="0.50" strokeWidth="1" />
      <polygon points={hex(300, 100, 24)} fill={ink} fillOpacity="0.10"
        stroke={ink} strokeOpacity="0.32" strokeWidth="0.8" />
      <text x="300" y="103" textAnchor="middle"
        fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="7" fontWeight="700" fill={ink} letterSpacing="0.20em">RWA</text>
      <text x="22" y="28" fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="8" fill="rgba(245, 245, 247, 0.45)" letterSpacing="0.08em">YIELD LADDER</text>
    </svg>
  )
}

function NarrativeArt({ ink }) {
  // Three momentum waves at different phases.
  const wave = (offset, amp, opacity) => {
    const pts = []
    for (let x = 0; x <= 360; x += 6) {
      const y = 110 + Math.sin((x / 360) * Math.PI * 2 + offset) * amp
      pts.push(`${x === 0 ? 'M' : 'L'} ${x} ${y.toFixed(1)}`)
    }
    return { d: pts.join(' '), opacity }
  }
  const w1 = wave(0, 40, 0.85)
  const w2 = wave(1.4, 32, 0.55)
  const w3 = wave(2.7, 22, 0.30)
  // node dots at peaks
  const peakDots = [
    { x: 90,  y: 70  },
    { x: 192, y: 86  },
    { x: 290, y: 102 },
  ]
  return (
    <svg viewBox={VB} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path d={w3.d} fill="none" stroke={ink} strokeOpacity={w3.opacity} strokeWidth="1" />
      <path d={w2.d} fill="none" stroke={ink} strokeOpacity={w2.opacity} strokeWidth="1.2" />
      <path d={w1.d} fill="none" stroke={ink} strokeOpacity={w1.opacity} strokeWidth="1.5" />
      {peakDots.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="6" fill={ink} fillOpacity="0.14" />
          <circle cx={p.x} cy={p.y} r="2.5" fill="rgba(245, 245, 247, 0.92)" />
          <line x1={p.x} y1={p.y + 4} x2={p.x} y2={170}
            stroke={ink} strokeOpacity="0.20" strokeWidth="0.6" strokeDasharray="2 2" />
        </g>
      ))}
      {/* phase labels */}
      <text x="78"  y="184" fontFamily="JetBrains Mono, ui-monospace, monospace" fontSize="7" fill="rgba(245, 245, 247, 0.45)" letterSpacing="0.10em">EARLY</text>
      <text x="180" y="184" fontFamily="JetBrains Mono, ui-monospace, monospace" fontSize="7" fill="rgba(245, 245, 247, 0.55)" letterSpacing="0.10em">PEAK</text>
      <text x="278" y="184" fontFamily="JetBrains Mono, ui-monospace, monospace" fontSize="7" fill="rgba(245, 245, 247, 0.45)" letterSpacing="0.10em">DECAY</text>
      <text x="22" y="28" fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="8" fill="rgba(245, 245, 247, 0.45)" letterSpacing="0.08em">NARRATIVE LIFECYCLE</text>
    </svg>
  )
}

function WatcherArt({ ink }) {
  // Watchlist receipt strip — 4 token rows with mini sparklines.
  const rows = [0, 1, 2, 3]
  const sparklines = [
    'M 200 18 L 212 12 L 224 16 L 236 8  L 248 14 L 260 6  L 272 10',
    'M 200 18 L 212 22 L 224 14 L 236 18 L 248 12 L 260 16 L 272 8',
    'M 200 18 L 212 14 L 224 20 L 236 16 L 248 22 L 260 18 L 272 24',
    'M 200 18 L 212 16 L 224 12 L 236 18 L 248 14 L 260 20 L 272 12',
  ]
  const tickers = ['BTC', 'ETH', 'SOL', 'HYPE']
  const prices  = ['67,420', '3,184', '198.42', '24.51']
  const deltas  = ['+1.42%', '−0.88%', '+3.12%', '+12.4%']
  const deltaPos = [true, false, true, true]
  return (
    <svg viewBox={VB} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <text x="22" y="28" fontFamily="JetBrains Mono, ui-monospace, monospace"
        fontSize="8" fill="rgba(245, 245, 247, 0.45)" letterSpacing="0.08em">WATCHLIST · 4</text>
      {rows.map((i) => {
        const y = 46 + i * 32
        return (
          <g key={i} transform={`translate(0 ${y - 18})`}>
            <rect x="22" y="0" width="316" height="26" rx="4"
              fill="rgba(245, 245, 247, 0.025)"
              stroke="rgba(245, 245, 247, 0.06)" strokeWidth="0.8" />
            <circle cx="36" cy="13" r="6" fill={ink} fillOpacity="0.20" />
            <text x="50" y="17" fontFamily="JetBrains Mono, ui-monospace, monospace"
              fontSize="9" fontWeight="700" fill="rgba(245, 245, 247, 0.92)" letterSpacing="0.06em">{tickers[i]}</text>
            <text x="86" y="17" fontFamily="JetBrains Mono, ui-monospace, monospace"
              fontSize="9" fill="rgba(245, 245, 247, 0.62)" letterSpacing="0.04em">{prices[i]}</text>
            <path d={sparklines[i]} fill="none"
              stroke={deltaPos[i] ? 'rgba(16, 185, 129, 0.85)' : 'rgba(239, 68, 68, 0.85)'}
              strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
            <text x="290" y="17" fontFamily="JetBrains Mono, ui-monospace, monospace"
              fontSize="8.5" fontWeight="600"
              fill={deltaPos[i] ? 'rgba(16, 185, 129, 0.92)' : 'rgba(239, 68, 68, 0.92)'}
              textAnchor="start" letterSpacing="0.04em">{deltas[i]}</text>
          </g>
        )
      })}
    </svg>
  )
}

const RENDERERS = {
  perps: PerpsArt,
  onchain: OnchainArt,
  rwa: RwaArt,
  narrative: NarrativeArt,
}

/**
 * Photographic / illustrated covers for the maximalist archetypes. These
 * carry their own colour story so the card sits flat on a pure-black tint
 * rather than wearing the archetype wash on top of the image.
 */
const COVER_IMAGES = {
  perps:     { src: '/templates/perps.png',     alt: 'Crowd watching the ticker chart at dusk',            position: '50% 50%' },
  onchain:   { src: '/templates/onchain.png',   alt: 'Analyst at a multi-monitor desk with order flow',    position: '50% 50%' },
  rwa:       { src: '/templates/rwa.png',       alt: 'City skyline reflected in a side mirror at dusk',    position: '50% 50%' },
  narrative: { src: '/templates/narrative.png', alt: 'Crypto crew in NYC with Pepe and Doge patches',      position: '50% 32%' },
  degen:     { src: '/templates/degen.png',     alt: 'Doge, Pepe and crypto cat with rockets',             position: '50% 35%' },
  watcher:   { src: '/templates/watcher.png',   alt: 'Whale tail breaching at dusk',                       position: '50% 50%' },
}

export default function YouTemplatePreview({ archetype }) {
  const cover = COVER_IMAGES[archetype]
  if (cover) {
    return (
      <div className="you-tpl-preview-art you-tpl-preview-art--cover">
        <img
          src={cover.src}
          alt={cover.alt}
          loading="lazy"
          style={{ objectPosition: cover.position }}
        />
      </div>
    )
  }
  const meta = ARCHETYPE_META[archetype] || ARCHETYPE_META.watcher
  const Renderer = RENDERERS[archetype] || RENDERERS.perps
  return (
    <div className="you-tpl-preview-art" style={{ background: meta.tint }}>
      <Renderer ink={meta.ink} />
    </div>
  )
}
