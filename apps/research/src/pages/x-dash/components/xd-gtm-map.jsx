/* xd-gtm-map, the "visual engine" for the Institutions GTM proposal. Renders
   the activation FUNNEL left→right: Brand → Land (ecosystems) → Partner
   (projects) → Amplify (voices). Nodes are GLASS pills (HTML/CSS, real
   glassmorphism + gleam, Spectre warm-white palette) over an SVG edge layer.
   The only color is the semantic authenticity dot (real vs manufactured).
   Coordinates are computed from the live panel width so the funnel FILLS the
   available space on wide screens and scrolls below a minimum on narrow ones. */

import { useRef, useState, useLayoutEffect } from 'react'

const PILL_W = 232
const PILL_H = 64
const GAP_Y = 18
const Y0 = 46
const LEFT_PAD = 8
const MIN_W = 1040 // below this the canvas keeps its size and the row scrolls

/* Evenly spread the 4 stage columns across width w, symmetric side padding.
   brand sits at LEFT_PAD; kol ends at w - LEFT_PAD. */
function columnsFor(w) {
  const step = (w - PILL_W - LEFT_PAD * 2) / 3
  return {
    brand: LEFT_PAD,
    eco: Math.round(LEFT_PAD + step),
    proj: Math.round(LEFT_PAD + step * 2),
    kol: Math.round(LEFT_PAD + step * 3),
  }
}
const STAGES_BRAND = [
  ['brand', 'Brand'],
  ['eco', 'Land · ecosystems'],
  ['proj', 'Partner · projects'],
  ['kol', 'Amplify · voices'],
]
const STAGES_CREATOR = [
  ['brand', 'Creator'],
  ['eco', 'Launch · ecosystems'],
  ['proj', 'Build with · rails'],
  ['kol', 'Co-signs · voices'],
]

const trunc = (s, n) => {
  const t = String(s || '')
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}
const authClass = (a) => (a == null || Number.isNaN(Number(a)) ? 'none' : Number(a) >= 75 ? 'high' : Number(a) >= 50 ? 'mid' : 'low')

function colY(i, count, maxRows) {
  const colH = count * PILL_H + (count - 1) * GAP_Y
  const bandH = maxRows * PILL_H + (maxRows - 1) * GAP_Y
  const top = Y0 + (bandH - colH) / 2
  return top + i * (PILL_H + GAP_Y)
}
function edgePath(x1, y1, x2, y2) {
  const dx = (x2 - x1) * 0.5
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

function Pill({ x, y, stage, title, sub, fit, auth }) {
  return (
    <div className={`xgtm-node xgtm-node--${stage}`} style={{ left: x, top: y, width: PILL_W, height: PILL_H }}>
      <div className="xgtm-node__row">
        <span className="xgtm-node__title">{trunc(title, 22)}</span>
        {fit != null && <span className="xgtm-node__fit">{Math.round(fit)}</span>}
      </div>
      <div className="xgtm-node__row">
        {sub != null && <span className="xgtm-node__sub">{trunc(sub, 28)}</span>}
        {auth != null && <span className={`xgtm-node__auth xgtm-node__auth--${authClass(auth)}`} title={`authenticity ${Math.round(auth)}`} />}
      </div>
    </div>
  )
}

export default function XDGtmMap({ proposal }) {
  // Measure the panel and lay the funnel out to fill it (min-width floor keeps
  // the pills legible; the row scrolls horizontally below that).
  const scrollRef = useRef(null)
  const [panelW, setPanelW] = useState(1120)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width
      if (w) setPanelW(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (!proposal) return null
  const isCreator = proposal.subjectType === 'creator'
  const STAGES = isCreator ? STAGES_CREATOR : STAGES_BRAND
  const W = Math.max(MIN_W, Math.round(panelW))
  const COLX = columnsFor(W)
  const ecos = (proposal.ecosystems || []).slice(0, 3)
  const projs = (proposal.projects || []).slice(0, 4)
  const kols = (proposal.kols || []).slice(0, 4)
  const maxRows = Math.max(1, ecos.length, projs.length, kols.length)
  const H = Y0 + maxRows * PILL_H + (maxRows - 1) * GAP_Y + 10

  const brandY = colY(0, 1, maxRows)
  const brandMid = brandY + PILL_H / 2
  const bandMid = Y0 + (maxRows * PILL_H + (maxRows - 1) * GAP_Y) / 2

  const cleanHandle = (h) => {
    const s = String(h || '').replace(/^@/, '')
    return s.toLowerCase().startsWith('archetype:') ? s.slice('archetype:'.length).replace(/-/g, ' ') : `@${s}`
  }

  return (
    <div className="xgtm-map">
      <div className="xgtm-map__scroll" ref={scrollRef}>
        <div className="xgtm-map__canvas" style={{ width: W, height: H }}>
          {/* edges, behind the glass pills */}
          <svg className="xgtm-map__edges" width={W} height={H} aria-hidden="true">
            {ecos.map((e, i) => (
              <path key={`be${i}`} className="xgtm-edge xgtm-edge--brand" d={edgePath(COLX.brand + PILL_W, brandMid, COLX.eco, colY(i, ecos.length, maxRows) + PILL_H / 2)} />
            ))}
            {projs.map((p, j) => (
              <path key={`ep${j}`} className="xgtm-edge" d={edgePath(COLX.eco + PILL_W, bandMid, COLX.proj, colY(j, projs.length, maxRows) + PILL_H / 2)} />
            ))}
            {kols.map((k, m) => (
              <path key={`pk${m}`} className="xgtm-edge" d={edgePath(COLX.proj + PILL_W, bandMid, COLX.kol, colY(m, kols.length, maxRows) + PILL_H / 2)} />
            ))}
          </svg>

          {/* stage headers */}
          {STAGES.map(([id, label]) => (
            <span key={id} className="xgtm-map__stage" style={{ left: COLX[id], top: 14 }}>{label.toUpperCase()}</span>
          ))}

          {/* subject (brand or creator) */}
          <Pill x={COLX.brand} y={brandY} stage="brand" title={proposal.brand || (isCreator ? 'Creator' : 'Brand')} sub={proposal.vertical} />
          {/* ecosystems */}
          {ecos.map((e, i) => (
            <Pill key={e.id || e.name || i} x={COLX.eco} y={colY(i, ecos.length, maxRows)} stage="eco" title={e.name} sub={e.chain} fit={e.fitScore} />
          ))}
          {/* projects */}
          {projs.map((p, j) => (
            <Pill key={p.symbol || p.name || j} x={COLX.proj} y={colY(j, projs.length, maxRows)} stage="proj"
              title={p.symbol ? `$${String(p.symbol).replace(/^\$/, '')}` : p.name} sub={p.name} fit={p.fitScore} auth={p.authenticity} />
          ))}
          {/* voices */}
          {kols.map((k, m) => (
            <Pill key={k.handle || m} x={COLX.kol} y={colY(m, kols.length, maxRows)} stage="kol"
              title={cleanHandle(k.handle)} sub={k.tier ? `${k.tier} · ${trunc(k.niche, 14)}` : k.niche} fit={k.fitScore} auth={k.authenticity} />
          ))}
        </div>
      </div>

      <div className="xgtm-map__legend">
        <span className="xgtm-map__legend-item"><b>Number</b> = {isCreator ? 'creator-fit' : 'brand-fit'} (0-100)</span>
        <span className="xgtm-map__legend-item">
          <span className="xgtm-node__auth xgtm-node__auth--high xgtm-map__dot" /> authentic
          <span className="xgtm-node__auth xgtm-node__auth--mid xgtm-map__dot" /> mixed
          <span className="xgtm-node__auth xgtm-node__auth--low xgtm-map__dot" /> manufactured
        </span>
      </div>

      {(proposal.angles || []).length > 0 && (
        <div className="xgtm-map__angles">
          <span className="xgtm-map__angles-label">{isCreator ? 'The plays' : 'The message'}</span>
          {(proposal.angles || []).slice(0, 3).map((a, i) => (
            <span key={a.title || i} className="xgtm-map__angle">{a.title}</span>
          ))}
        </div>
      )}
    </div>
  )
}
