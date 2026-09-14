/**
 * vt-floor.jsx — THE FLOOR: users against revenue, from first-hand fills.
 *
 * This is the section no reference surface can draw. Fees and TVL are widely
 * published; per-app active users are not sold at any tier, and net trader PnL
 * is not published at all. Both come out of the raw Hyperliquid builder-fill
 * archive that we read and aggregate ourselves.
 *
 * Reading it: right = more traders, up = more revenue, green = the platform's
 * users made money that day, red = they lost it. A platform far right and low
 * has an audience it is not monetising; far left and high is a handful of
 * whales carrying the whole business.
 */

import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usd, count, shortDate, hueFor } from './vt-format'
import { logoCandidates } from './vt-logo'

const W = 1000
const H = 460
const PAD = { top: 28, right: 24, bottom: 46, left: 66 }

/* The hover card. Its width is FIXED (and matched in the stylesheet) so the
   side-flip is exact on the same frame as the hover — a measured width lands a
   frame late and the card visibly jumps into place. Its HEIGHT is deliberately
   never measured: the card anchors by its top edge in the upper half of the
   plot and by its bottom edge in the lower half, so it always grows away from
   the nearer edge and stays inside without anyone knowing how tall it is. */
const CARD_W = 240
const CARD_GAP = 14

/** Log scale that tolerates zero, since a quiet day is a real observation. */
const lg = (v) => Math.log10(Math.max(1, v || 0))

/**
 * One bubble's mark. icons.llama.fi 404s on roughly a third of the registry and
 * icons.llamao.fi covers most (not all) of the gap, so walk both; the initial
 * painted underneath is what remains when neither has it.
 */
function FloorLogo({ p }) {
  const list = useMemo(() => logoCandidates({ logo: p.logo, slug: p.slug }), [p.logo, p.slug])
  const [idx, setIdx] = useState(0)
  const href = list[idx]
  if (!href) return null
  return (
    <image
      href={href}
      x={p.cx - p.logoR} y={p.cy - p.logoR}
      width={p.logoR * 2} height={p.logoR * 2}
      clipPath={`circle(${p.logoR}px at ${p.logoR}px ${p.logoR}px)`}
      className="vt-floor__logo"
      onError={() => setIdx((i) => i + 1)}
      preserveAspectRatio="xMidYMid slice"
    />
  )
}

export default function VtFloor({ firstHand }) {
  const [hover, setHover] = useState(null)
  // Where the card sits, in CSS px inside .vt-floor__plot. null = corner-parked
  // (the stylesheet's default), which is what a too-narrow plot falls back to.
  const [cardPos, setCardPos] = useState(null)
  const plotRef = useRef(null)
  const navigate = useNavigate()
  const rows = firstHand?.rows || []

  const model = useMemo(() => {
    const pts = rows.filter((r) => r.dau > 0 && r.revenue > 0)
    if (pts.length < 3) return null
    const xs = pts.map((p) => lg(p.dau))
    const ys = pts.map((p) => lg(p.revenue))
    // Rounding each end out to a full decade left the plot with an empty decade
    // of dead space (traders topped out at 10.5k and the axis ran to 100k, which
    // reads as "everyone is tiny"). Pad just past the data instead, and only
    // label the decades that actually fall inside the range.
    const pad = (v, dir) => v + dir * 0.18
    const xMin = Math.max(0, pad(Math.min(...xs), -1))
    const xMax = pad(Math.max(...xs), 1)
    const yMin = Math.max(0, pad(Math.min(...ys), -1))
    const yMax = pad(Math.max(...ys), 1)
    const maxTrades = Math.max(...pts.map((p) => p.trades || 1))

    const px = (v) => PAD.left + ((lg(v) - xMin) / Math.max(0.001, xMax - xMin)) * (W - PAD.left - PAD.right)
    const py = (v) => H - PAD.bottom - ((lg(v) - yMin) / Math.max(0.001, yMax - yMin)) * (H - PAD.top - PAD.bottom)

    // Bubbles first, then decide which get a standing label. Founder: "ugly
    // design add logos and names so we can see" — the old rule only labelled
    // r > 12, which on a typical day is 4 of 28 dots, so the chart read as
    // anonymous confetti. Now every bubble is a candidate, biggest first, and a
    // label is placed only where it will not collide with one already placed.
    // Anything skipped still labels on hover, so nothing is unreachable.
    const placed = pts
      .map((p) => ({
        ...p,
        cx: px(p.dau),
        cy: py(p.revenue),
        r: 6 + 16 * Math.sqrt((p.trades || 1) / maxTrades),
      }))
      .sort((a, b) => b.r - a.r)

    const taken = []
    const CHAR_W = 6.1
    const LINE_H = 13
    for (const b of placed) {
      const label = b.name || b.slug
      const w = label.length * CHAR_W
      // above the bubble by default, below when that would leave the plot
      const above = b.cy - b.r - 7 > PAD.top + LINE_H
      const y = above ? b.cy - b.r - 7 : b.cy + b.r + LINE_H
      const box = { x1: b.cx - w / 2, x2: b.cx + w / 2, y1: y - LINE_H, y2: y + 3 }
      const overlaps = (t) => !(box.x2 < t.x1 || box.x1 > t.x2 || box.y2 < t.y1 || box.y1 > t.y2)
      // a label must clear both the labels already placed AND every other
      // bubble - checking labels alone still let "Dreamcash" sit on top of a
      // neighbouring dot, which is what made the chart look unfinished
      const overBubble = placed.some((o) => o !== b
        && overlaps({ x1: o.cx - o.r, x2: o.cx + o.r, y1: o.cy - o.r, y2: o.cy + o.r }))
      const hits = taken.some(overlaps) || overBubble
      b.labelY = y
      b.showLabel = !hits && box.x1 > PAD.left - 8 && box.x2 < W - PAD.right + 8
      if (b.showLabel) taken.push(box)
      // a logo only reads at a usable size; below that the bubble stays a dot
      // Every bubble carries a mark. The old r >= 11 gate left most dots blank,
      // which reads as missing data rather than a deliberate size threshold.
      b.logoR = Math.max(7, Math.round(b.r * 0.78))
    }

    return {
      pts: placed,
      xTicks: Array.from({ length: Math.floor(xMax) - Math.ceil(xMin) + 1 }, (_, i) => Math.ceil(xMin) + i),
      yTicks: Array.from({ length: Math.floor(yMax) - Math.ceil(yMin) + 1 }, (_, i) => Math.ceil(yMin) + i),
      px, py, xMin, xMax, yMin, yMax,
    }
  }, [rows])

  /**
   * Park the card NEXT TO the bubble instead of in the top-right corner.
   *
   * The corner was a fixed address: hovering a dot in the middle of the plot put
   * its numbers a third of a screen away, and on a busy day the card sat on top
   * of the two or three platforms that live in that corner (Phantom, Invo) —
   * the reader could not see the thing they were pointing at.
   *
   * The svg is viewBox 0 0 1000 460 with preserveAspectRatio, drawn at
   * width:100%/height:auto, so it scales uniformly with no letterboxing and one
   * factor converts viewBox units to CSS px.
   */
  const placeCard = (p) => {
    const el = plotRef.current
    if (!el) { setCardPos(null); return }
    const rect = el.getBoundingClientRect()
    const k = rect.width / W
    if (!k || rect.width < CARD_W * 2.2) { setCardPos(null); return } // no room to flip
    const cx = p.cx * k
    const cy = p.cy * k
    const r = p.r * k

    let left = cx + r + CARD_GAP
    if (left + CARD_W > rect.width) left = cx - r - CARD_GAP - CARD_W
    left = Math.max(0, Math.min(left, rect.width - CARD_W))

    // Anchor to whichever horizontal edge is nearer, so the card opens INTO the
    // plot and its height never has to be known.
    const h = rect.height || H * k
    return setCardPos(cy < h / 2
      ? { left, right: 'auto', top: Math.max(0, cy - r), bottom: 'auto' }
      : { left, right: 'auto', top: 'auto', bottom: Math.max(0, h - cy - r) })
  }

  const enter = (p) => { setHover(p); placeCard(p) }
  const leave = () => { setHover(null); setCardPos(null) }

  if (!firstHand || !model) return null

  const cov = firstHand.coverage || {}
  const winners = rows.filter((r) => r.userPnl > 0).length

  return (
    <section className="vt-section vt-floor" id="floor">
      <header className="vt-section__head">
        <div>
          <span className="vt-eyebrow">The floor · first-hand</span>
          <h2>Who actually has users</h2>
          <p className="vt-section__sub">
            Every dot is a trading app on {shortDate(firstHand.day)}, placed by how many people
            traded through it and how much it earned. We count both from raw fills — no vendor
            publishes per-app users, and none publishes whether those users won.
          </p>
        </div>
        <div className="vt-floor__legend">
          <span><i className="vt-dot vt-dot--up" aria-hidden="true" /> users net up</span>
          <span><i className="vt-dot vt-dot--down" aria-hidden="true" /> users net down</span>
          <span className="vt-floor__legend-note">bubble = trades</span>
        </div>
      </header>

      <div className="vt-floor__plot" ref={plotRef}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" preserveAspectRatio="xMidYMid meet"
          aria-label="Daily active users against daily revenue for trading apps">

          {model.yTicks.map((t) => {
            const y = model.py(10 ** t)
            return (
              <g key={`y${t}`}>
                <line className="vt-floor__grid" x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} />
                <text className="vt-floor__axis" x={PAD.left - 10} y={y + 4} textAnchor="end">
                  {usd(10 ** t, { decimals: 0 })}
                </text>
              </g>
            )
          })}
          {model.xTicks.map((t) => {
            const x = model.px(10 ** t)
            return (
              <g key={`x${t}`}>
                <line className="vt-floor__grid" x1={x} x2={x} y1={PAD.top} y2={H - PAD.bottom} />
                <text className="vt-floor__axis" x={x} y={H - PAD.bottom + 20} textAnchor="middle">
                  {count(10 ** t)}
                </text>
              </g>
            )
          })}

          <text className="vt-floor__axis-title" x={W / 2} y={H - 8} textAnchor="middle">
            daily active traders
          </text>
          <text className="vt-floor__axis-title" x={16} y={H / 2} textAnchor="middle"
            transform={`rotate(-90 16 ${H / 2})`}>
            revenue that day
          </text>

          {model.pts.map((p) => {
            const on = hover?.slug === p.slug
            const up = (p.userPnl || 0) >= 0
            return (
              <g key={p.slug}
                onMouseEnter={() => enter(p)}
                onMouseLeave={leave}
                onFocus={() => enter(p)}
                onBlur={leave}
                onClick={() => navigate(`/vitals/${p.slug}`)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/vitals/${p.slug}`) } }}
                tabIndex={0}
                role="link"
                aria-label={`${p.name || p.slug}: ${count(p.dau)} traders, ${usd(p.revenue)} revenue`}
                className={`vt-floor__node${on ? ' is-on' : ''}`}
              >
                <circle cx={p.cx} cy={p.cy} r={p.r}
                  className={up ? 'vt-floor__bubble vt-floor__bubble--up' : 'vt-floor__bubble vt-floor__bubble--down'}
                  style={{ '--vt-hue': hueFor(p.slug) }} />
                {p.logoR ? (
                  // sits UNDER the logo: if every candidate 404s, this is what
                  // is left, and it still tells you which dot this is
                  <text className="vt-floor__mono" x={p.cx} y={p.cy + 4} textAnchor="middle">
                    {String(p.name || p.slug).replace(/[^a-zA-Z0-9]/g, '').charAt(0).toUpperCase()}
                  </text>
                ) : null}
                {p.logoR ? (
                  /* Two hosts, because icons.llama.fi 404s on about a third of
                     the registry and icons.llamao.fi covers most (but not all)
                     of the gap. Hiding the image on error left a bare circle;
                     the initial underneath now shows through instead. */
                  <FloorLogo p={p} />
                ) : null}
                {p.showLabel || on ? (
                  <text className="vt-floor__label" x={p.cx} y={on ? p.labelY : p.labelY} textAnchor="middle">
                    {p.name || p.slug}
                  </text>
                ) : null}
              </g>
            )
          })}
        </svg>

        {hover ? (
          <div className="vt-floor__card" style={cardPos || undefined}>
            <strong>{hover.name || hover.slug}</strong>
            <dl>
              <div><dt>Traders</dt><dd>{count(hover.dau)}</dd></div>
              <div><dt>Revenue</dt><dd>{usd(hover.revenue)}</dd></div>
              <div><dt>Volume</dt><dd>{usd(hover.perpVolume)}</dd></div>
              <div><dt>Trades</dt><dd>{count(hover.trades)}</dd></div>
              <div><dt>Per trader</dt><dd>{usd(hover.arpu)}</dd></div>
              <div>
                <dt>Trader PnL</dt>
                <dd className={hover.userPnl >= 0 ? 'vt-tone--up' : 'vt-tone--down'}>{usd(hover.userPnl)}</dd>
              </div>
            </dl>
            {/* short on purpose: the card is a fixed 240px and the platform's
                name is already the heading above */}
            <span className="vt-floor__open">Click the bubble to open →</span>
          </div>
        ) : null}
      </div>

      <p className="vt-note vt-note--dim">
        {cov.withData} of {cov.scanned} scanned platforms reported fills on {shortDate(firstHand.day)}
        {cov.registry > cov.scanned ? `; ${cov.registry} are in the registry and the rest fill in on the nightly sweep` : ''}.
        {' '}{winners} of {rows.length} had users net up on the day.
      </p>
    </section>
  )
}
