/**
 * chart-ta-overlay.js — the TA layer painted on top of the canvas chart.
 *
 * Two responsibilities, deliberately kept out of trading-chart.jsx:
 *   1. makeChartMapping(dims) — the ONE place that converts between data space
 *      (timestamp, price) and screen space. The renderer, the pointer handlers
 *      and the hit-tests all use it, so they cannot drift apart the way five
 *      copies of the pan geometry once did.
 *   2. drawTaOverlay(ctx, dims, state) — the highlight marquee and every TA
 *      drawing, painted inside the chart's own draw pass so they stay glued to
 *      the candles through pan, zoom and RAF redraws.
 *
 * Drawings are anchored in DATA space, never in pixels, so they survive a pan,
 * a zoom, a timeframe switch and a history merge.
 */

/** "1d 18h" — duplicated from chart-ta-brief on purpose: importing it there
 *  would pull the Research Zone's indicator hook into the home / heatmaps /
 *  traders-corner chart chunks, which never use the TA brief. */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), rm = m % 60
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`
  const d = Math.floor(h / 24), rh = h % 24
  return rh ? `${d}d ${rh}h` : `${d}d`
}

const SEL = '#10B981'

const STYLE_INK = {
  resistance: '#EF4444',
  support: '#10B981',
  neckline: '#E9D5FF',
  trend: 'rgba(245,245,247,0.75)',
  target: '#10B981',
  invalidation: '#F59E0B',
  ai: '#06B6D4',
  user: '#F5F5F7',
}

const STYLE_INK_DAY = {
  resistance: '#DC2626',
  support: '#059669',
  neckline: '#7C3AED',
  trend: 'rgba(15,23,42,0.65)',
  target: '#059669',
  invalidation: '#D97706',
  ai: '#0891B2',
  user: '#0F172A',
}

const DASHED = new Set(['neckline', 'target', 'invalidation'])

/** #RRGGBB → rgba() at a given alpha, so gradients can reuse the ink table. */
function hexA(hex, a) {
  const h = String(hex).replace('#', '')
  if (h.length !== 6) return `rgba(245,245,247,${a})`
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** Level labels lead with the PRICE — that is the number a trader acts on. */
function compactPrice(v) {
  if (!Number.isFinite(v)) return ''
  const a = Math.abs(v)
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (a >= 1000) return Math.round(v).toLocaleString('en-US')
  if (a >= 1) return v.toFixed(2)
  if (a >= 0.01) return v.toFixed(4)
  return v.toPrecision(3)
}

/** `64,606 · target` — price first, role short, pattern name lives in the strip. */
function levelLabel(d) {
  const role = d.label ? String(d.label).slice(0, 14) : ''
  const px = Number.isFinite(d.price) ? compactPrice(d.price) : ''
  if (px && role) return `${px} · ${role}`
  return px || role
}

function inkFor(d, dayMode) {
  const table = dayMode ? STYLE_INK_DAY : STYLE_INK
  // A target is coloured by DIRECTION, not by the word "target": up is green,
  // down is red, the way every other number on a chart already reads.
  if (d.style === 'target') return d.dir === 'down' ? table.resistance : table.support
  if (d.style && table[d.style]) return table[d.style]
  if (d.bias === 'bullish') return table.support
  if (d.bias === 'bearish') return table.resistance
  return table.trend
}

const tsOf = (bar) => {
  const d = bar?.date
  if (d instanceof Date) return d.getTime()
  if (typeof d === 'number') return d
  if (typeof bar?.t === 'number') return bar.t
  return null
}

/**
 * Build the data↔screen mapping for the CURRENT paint.
 * `dims` is the same object trading-chart publishes into chartDimensionsRef.
 */
export function makeChartMapping(dims) {
  if (!dims) return null
  const {
    chartLeft, chartRight, chartTop, chartHeight,
    candleWidth, visibleData,
    leftEmptyCandles = 0, rightEmptyCandles = 0, panFracPx = 0,
    minPrice, priceRange,
    useLogScale = false, logMin = 0, logRange = 1,
    scaleY,
  } = dims
  const vd = Array.isArray(visibleData) ? visibleData : []
  if (!vd.length || !(candleWidth > 0)) return null

  const times = vd.map(tsOf)
  const firstTs = times[0]
  const lastTs = times[times.length - 1]
  // Median bar interval — robust to the gaps a raw (non-gap-filled) tier leaves.
  let barMs = 60_000
  if (times.length > 1) {
    const diffs = []
    for (let i = 1; i < times.length; i++) {
      const d = times[i] - times[i - 1]
      if (d > 0) diffs.push(d)
    }
    if (diffs.length) {
      diffs.sort((a, b) => a - b)
      barMs = diffs[Math.floor(diffs.length / 2)] || 60_000
    }
  }

  const idxToX = (idxF) =>
    chartLeft + (leftEmptyCandles + idxF) * candleWidth + candleWidth / 2 - (rightEmptyCandles * candleWidth) + panFracPx

  const xToIdx = (x) =>
    (x - panFracPx + rightEmptyCandles * candleWidth - candleWidth / 2 - chartLeft) / candleWidth - leftEmptyCandles

  /** Fractional bar index for a timestamp; extrapolates outside the window. */
  const tsToIdx = (ts) => {
    if (!Number.isFinite(ts)) return null
    if (ts <= firstTs) return -(firstTs - ts) / barMs
    if (ts >= lastTs) return (times.length - 1) + (ts - lastTs) / barMs
    // times is ascending — binary search the bracketing pair
    let lo = 0, hi = times.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (times[mid] <= ts) lo = mid; else hi = mid
    }
    const spanMs = times[hi] - times[lo]
    return spanMs > 0 ? lo + (ts - times[lo]) / spanMs : lo
  }

  const idxToTs = (idxF) => {
    if (idxF <= 0) return firstTs + idxF * barMs
    if (idxF >= times.length - 1) return lastTs + (idxF - (times.length - 1)) * barMs
    const lo = Math.floor(idxF)
    const frac = idxF - lo
    return times[lo] + (times[lo + 1] - times[lo]) * frac
  }

  return {
    barMs,
    firstTs,
    lastTs,
    chartLeft, chartRight, chartTop, chartHeight,
    chartBottom: chartTop + chartHeight,
    tsToX: (ts) => {
      const i = tsToIdx(ts)
      return i == null ? null : idxToX(i)
    },
    xToTs: (x) => idxToTs(xToIdx(x)),
    priceToY: (p) => (typeof scaleY === 'function' ? scaleY(p) : null),
    yToPrice: (y) => {
      const f = 1 - (y - chartTop) / chartHeight
      return useLogScale ? Math.exp(logMin + f * logRange) : minPrice + f * priceRange
    },
    inChart: (x, y) => x >= chartLeft && x <= chartRight && y >= chartTop && y <= chartTop + chartHeight,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// rendering
// ────────────────────────────────────────────────────────────────────────────

function pill(ctx, text, x, y, ink, dayMode, align = 'left', solid = false) {
  if (!text) return
  ctx.save()
  ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
  const w = ctx.measureText(text).width + 10
  const h = 16
  const px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x
  ctx.fillStyle = solid ? ink : (dayMode ? 'rgba(255,255,255,0.95)' : 'rgba(10,10,12,0.92)')
  ctx.strokeStyle = ink
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.98
  const r = 4
  ctx.beginPath()
  ctx.moveTo(px + r, y)
  ctx.arcTo(px + w, y, px + w, y + h, r)
  ctx.arcTo(px + w, y + h, px, y + h, r)
  ctx.arcTo(px, y + h, px, y, r)
  ctx.arcTo(px, y, px + w, y, r)
  ctx.closePath()
  ctx.fill()
  ctx.globalAlpha = 0.3
  ctx.stroke()
  ctx.globalAlpha = 1
  ctx.fillStyle = solid ? (dayMode ? '#ffffff' : '#0B0B0D') : ink
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(text, px + 5, y + h / 2 + 0.5)
  ctx.restore()
}

/**
 * Label placement with collision avoidance. Seven pattern lines land their
 * labels in the same corner otherwise — measured, and it reads as a mess.
 * Nudges down (then up) until a slot is free; drops the label if there is none.
 */
function makeLabelPlacer(T, B) {
  const taken = []
  const H = 18
  const STEP = 19
  // Lowest y already claimed by each ordered group, so the group's labels can
  // never cross each other (see `group` below).
  const cursors = new Map()
  const overlaps = (a, b) => !(a.x2 < b.x1 || a.x1 > b.x2 || a.y + H < b.y || a.y > b.y + H)
  return (ctx, text, x, y, ink, dayMode, align, solid = false, group = null) => {
    if (!text) return
    ctx.save()
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
    const w = ctx.measureText(text).width + 10
    ctx.restore()
    const x1 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x
    const box = { x1, x2: x1 + w, y }

    // An ORDERED group (the S/R bands, handed to us top price first) may only
    // ever be nudged DOWNWARD, and never above the label before it. Free
    // up/down nudging let a higher band's label settle below a lower band's —
    // measured on a real BTC read: 77,800 printed underneath 77,140, so the
    // reader maps the number onto the wrong zone. A label beside the wrong
    // band is worse than no label, which is the bar the rest of this file
    // already holds itself to.
    let startY = y
    let offsets = [0, STEP, -STEP, 38, -38, 57, -57, 76, -76]
    if (group != null) {
      const floor = cursors.get(group)
      if (floor != null && startY < floor) startY = floor
      offsets = [0, STEP, 38, 57, 76, 95]
    }

    for (const off of offsets) {
      const cand = { ...box, y: startY + off }
      if (cand.y < T - 2 || cand.y + H > B + 2) continue
      if (taken.some(t => overlaps(cand, t))) continue
      taken.push(cand)
      if (group != null) cursors.set(group, cand.y + STEP)
      pill(ctx, text, x, cand.y, ink, dayMode, align, solid)
      return
    }
    // No free slot — better no label than an unreadable stack.
  }
}

function clampSeg(x1, y1, x2, y2, L, R, T, B) {
  // Liang–Barsky against the chart box so a steep trendline can't bleed into
  // the axes (the same clamp the chart already applies to its own lines).
  let t0 = 0, t1 = 1
  const dx = x2 - x1, dy = y2 - y1
  const p = [-dx, dx, -dy, dy]
  const q = [x1 - L, R - x1, y1 - T, B - y1]
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue }
    const r = q[i] / p[i]
    if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r }
    else { if (r < t0) return null; if (r < t1) t1 = r }
  }
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy]
}

/**
 * @param state {
 *   selection: { fromTs, toTs, hiPrice, loPrice } | null,
 *   pending:   same shape, drawn while the drag is live,
 *   drawings:  [{ tool:'trendline'|'hline'|'rect', ... }],
 *   pendingDraw: a single in-progress drawing,
 *   dayMode, reveal: 0..1 global reveal for source==='ai' drawings
 * }
 * @returns { selectionRect } screen rect of the committed selection (for the
 *          floating action bar), or null.
 */
/** Below this plot width the band labels are dropped in favour of the sheet. */
const NARROW_PLOT_PX = 420

export function drawTaOverlay(ctx, dims, state = {}) {
  const map = makeChartMapping(dims)
  if (!map) return null
  const { selection, pending, drawings = [], pendingDraw, dayMode = false, reveal = 1, gleam = 1 } = state
  const { chartLeft: L, chartRight: R, chartTop: T, chartBottom: B } = map
  let selectionRect = null
  const placeLabel = makeLabelPlacer(T, B)

  // ── drawings (under the marquee) ────────────────────────────────────────
  const all = pendingDraw ? [...drawings, pendingDraw] : drawings
  let aiIndex = 0
  for (const d of all) {
    if (!d) continue
    const ink = inkFor(d, dayMode)
    // AI lines sweep in one after another, the way somebody draws them live.
    let prog = 1
    if (d.source === 'ai' || d.source === 'pattern') {
      // Each mark waits its turn, then eases in — so the read is watched being
      // drawn rather than appearing all at once.
      const stagger = 0.085
      const start = Math.min(0.7, aiIndex * stagger)
      const raw = Math.max(0, Math.min(1, (reveal - start) / 0.3))
      prog = 1 - Math.pow(1 - raw, 3)
      aiIndex++
      if (prog <= 0) continue
    }

    ctx.save()
    ctx.strokeStyle = ink
    // The candles are the subject. Matched geometry sits back; the agent's own
    // levels and the user's own lines read a step stronger.
    // A matched level the agent also cited is `confirmed` — it earns the same
    // weight as a line the agent drew itself.
    // A target is the number the reader came for — it gets the most weight.
    const strong = d.source !== 'pattern' || d.confirmed || d.emphasis
    ctx.lineWidth = d.emphasis ? 2 : strong ? 1.5 : 1.25
    ctx.globalAlpha = d.emphasis ? 1 : strong ? 0.9 : 0.7
    if (DASHED.has(d.style)) ctx.setLineDash([5, 4])

    if (d.tool === 'projection' && Number.isFinite(d.low) && Number.isFinite(d.high)) {
      // Measured move as an area travelling forward from the pattern's end.
      const yA = map.priceToY(d.high)
      const yB = map.priceToY(d.low)
      const x0 = Math.max(L, map.tsToX(d.fromTs) ?? L)
      if (yA != null && yB != null && x0 < R) {
        const top = Math.max(T, Math.min(yA, yB))
        const bot = Math.min(B, Math.max(yA, yB))
        const w = (R - x0) * prog
        const g = ctx.createLinearGradient(x0, 0, x0 + Math.max(1, w), 0)
        g.addColorStop(0, hexA(ink, 0.20))
        g.addColorStop(1, hexA(ink, 0.02))
        ctx.globalAlpha = 1
        ctx.fillStyle = g
        ctx.fillRect(x0, top, w, Math.max(2, bot - top))
        ctx.globalAlpha = 0.5
        ctx.setLineDash([3, 3])
        ctx.lineWidth = 1
        ctx.strokeStyle = ink
        ctx.strokeRect(x0 + 0.5, top + 0.5, Math.max(1, w - 1), Math.max(1, bot - top - 1))
        if (prog >= 1 && d.label) {
          ctx.globalAlpha = 1
          placeLabel(ctx, d.label, x0 + 6, top + 5, ink, dayMode, 'left')
        }
      }
    } else if (d.tool === 'zone' && Number.isFinite(d.low) && Number.isFinite(d.high)) {
      // The pattern's own footprint — where on the chart this read is about.
      const xa = map.tsToX(d.fromTs)
      const xb = map.tsToX(d.toTs)
      const yA = map.priceToY(d.high)
      const yB = map.priceToY(d.low)
      if (xa != null && xb != null && yA != null && yB != null) {
        const rx0 = Math.max(L, Math.min(xa, xb))
        const rx1 = Math.min(R, Math.max(xa, xb))
        const top = Math.max(T, Math.min(yA, yB))
        const bot = Math.min(B, Math.max(yA, yB))
        const w = (rx1 - rx0) * prog
        if (w > 2 && bot - top > 2) {
          ctx.globalAlpha = 0.06
          ctx.fillStyle = ink
          roundRect(ctx, rx0, top, w, bot - top, 6); ctx.fill()
          ctx.globalAlpha = 0.55
          ctx.lineWidth = 1
          ctx.setLineDash([5, 4])
          ctx.strokeStyle = ink
          roundRect(ctx, rx0 + 0.5, top + 0.5, Math.max(1, w - 1), bot - top - 1, 6); ctx.stroke()
          if (prog >= 1 && d.label) {
            ctx.globalAlpha = 1
            placeLabel(ctx, d.label, rx0 + 4, top - 20, ink, dayMode, 'left')
          }
        }
      }
    } else if (d.tool === 'band' && Number.isFinite(d.low) && Number.isFinite(d.high)) {
      // Supply/demand band. A cluster has a real width — drawing it as a band
      // instead of a line is truer to the data and reads as a ZONE, which is
      // what a trader actually reacts to.
      const yA = map.priceToY(d.high)
      const yB = map.priceToY(d.low)
      if (yA != null && yB != null) {
        const top = Math.max(T, Math.min(yA, yB))
        const bot = Math.min(B, Math.max(yA, yB))
        const h = Math.max(2, bot - top)
        const w = (R - L) * prog
        ctx.globalAlpha = 0.10
        ctx.fillStyle = ink
        ctx.fillRect(L, top, w, h)
        ctx.globalAlpha = 0.5
        ctx.setLineDash([])
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(L, top + 0.5); ctx.lineTo(L + w, top + 0.5)
        ctx.moveTo(L, bot - 0.5); ctx.lineTo(L + w, bot - 0.5)
        ctx.stroke()
        // A band with no price on it is decoration. State it.
        // A narrow plot cannot hold four or five of these. On a phone the
        // read's own sheet lists every level with its scoped touch count, so
        // the chart keeps the geometry and gives up the legend rather than
        // stacking labels over the candles. Measured, not guessed: below
        // ~420px of plot the longest label ("77,800-78,365 · resistance ×33 in
        // context") is wider than a third of the chart.
        if (prog >= 1 && d.label && (R - L) >= NARROW_PLOT_PX) {
          ctx.globalAlpha = 1
          // 'band' = ordered group: these arrive highest price first, so
          // downward-only placement keeps label order matching band order.
          placeLabel(ctx, d.label, R - 4, top - 9, ink, dayMode, 'right', false, 'band')
        }
      }
    } else if (d.tool === 'point' && Number.isFinite(d.ts) && Number.isFinite(d.price)) {
      // The swing the matcher actually measured. Three rings on a triple top
      // ARE the pattern — the reader can count the touches instead of taking
      // "82% fit" on faith. Rings scale in, so they land like a pulse.
      const px = map.tsToX(d.ts)
      const py = map.priceToY(d.price)
      if (px != null && py != null && px >= L - 8 && px <= R + 8 && py >= T - 8 && py <= B + 8) {
        const ease = 1 - Math.pow(1 - prog, 3)
        ctx.globalAlpha = 0.9 * ease
        ctx.fillStyle = ink
        ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill()
        ctx.globalAlpha = 0.55 * ease
        ctx.lineWidth = 1.25
        ctx.setLineDash([])
        ctx.beginPath(); ctx.arc(px, py, 4 + 5 * ease, 0, Math.PI * 2); ctx.stroke()
        // A second ring keeps expanding past the first for the pulse feel.
        ctx.globalAlpha = 0.22 * (1 - ease)
        ctx.beginPath(); ctx.arc(px, py, 6 + 16 * ease, 0, Math.PI * 2); ctx.stroke()
      }
    } else if (d.tool === 'hline' && Number.isFinite(d.price)) {
      const y = map.priceToY(d.price)
      if (y != null && y >= T - 2 && y <= B + 2) {
        const xEnd = L + (R - L) * prog
        ctx.beginPath()
        ctx.moveTo(L, y)
        ctx.lineTo(xEnd, y)
        ctx.stroke()
        if (prog >= 1) placeLabel(ctx, levelLabel(d), R - 4, y - 8, ink, dayMode, 'right', !!d.emphasis)
      }
    } else if ((d.tool === 'trendline' || d.tool === 'ray') && d.a && d.b) {
      const x1 = map.tsToX(d.a.ts), y1 = map.priceToY(d.a.price)
      const x2f = map.tsToX(d.b.ts), y2f = map.priceToY(d.b.price)
      if (x1 != null && y1 != null && x2f != null && y2f != null) {
        const x2 = x1 + (x2f - x1) * prog
        const y2 = y1 + (y2f - y1) * prog
        const seg = clampSeg(x1, y1, x2, y2, L, R, T, B)
        if (seg) {
          ctx.beginPath()
          ctx.moveTo(seg[0], seg[1])
          ctx.lineTo(seg[2], seg[3])
          ctx.stroke()
          if (prog >= 1) {
            ctx.globalAlpha = 1
            for (const [hx, hy] of [[x1, y1], [x2f, y2f]]) {
              if (hx < L || hx > R || hy < T || hy > B) continue
              ctx.beginPath()
              ctx.fillStyle = ink
              ctx.arc(hx, hy, 2.5, 0, Math.PI * 2)
              ctx.fill()
            }
            if (d.label) {
              const lx = Math.min(Math.max(seg[2], L + 4), R - 4)
              const tlText = `${compactPrice(d.b?.price)} · ${String(d.label).slice(0, 14)}`
              placeLabel(ctx, tlText, lx, seg[3] - 20, ink, dayMode, seg[2] > R - 90 ? 'right' : 'left')
            }
          }
        }
      }
    } else if (d.tool === 'rect' && d.a && d.b) {
      const x1 = map.tsToX(d.a.ts), x2 = map.tsToX(d.b.ts)
      const y1 = map.priceToY(d.a.price), y2 = map.priceToY(d.b.price)
      if (x1 != null && x2 != null && y1 != null && y2 != null) {
        const rx = Math.max(L, Math.min(x1, x2))
        const rw = Math.min(R, Math.max(x1, x2)) - rx
        const ry = Math.max(T, Math.min(y1, y2))
        const rh = Math.min(B, Math.max(y1, y2)) - ry
        ctx.globalAlpha = 0.1
        ctx.fillStyle = ink
        ctx.fillRect(rx, ry, rw * prog, rh)
        ctx.globalAlpha = 0.85
        ctx.strokeRect(rx, ry, rw * prog, rh)
        if (prog >= 1 && d.label) placeLabel(ctx, d.label, rx + 4, ry + 4, ink, dayMode)
      }
    }
    ctx.restore()
  }

  // ── the read window ─────────────────────────────────────────────────────
  // The chart OUTSIDE the window dims and the window stays lit, so the read is
  // a spotlight rather than a drawn rectangle. Violet is a deliberate exception
  // to the "no purple in chrome" rule (design-system §K): this is a TRANSIENT
  // selection state, not persistent furniture, and it has to read instantly to
  // someone who cannot read a chart yet.
  const marquee = pending || selection
  if (marquee && Number.isFinite(marquee.fromTs) && Number.isFinite(marquee.toTs)) {
    const x1r = map.tsToX(marquee.fromTs)
    const x2r = map.tsToX(marquee.toTs)
    if (x1r != null && x2r != null) {
      const rx = Math.max(L, Math.min(x1r, x2r))
      const rr = Math.min(R, Math.max(x1r, x2r))

      if (rr > rx + 1) {
        const live = !!pending
        const H = B - T
        const W = rr - rx

        ctx.save()

        // 1. Dim everything outside. Lighter while the finger is still down so
        //    the chart never goes dark under an in-progress drag.
        ctx.fillStyle = dayMode
          ? `rgba(15,23,42,${live ? 0.07 : 0.13})`
          : `rgba(3,3,5,${live ? 0.36 : 0.56})`
        ctx.fillRect(L, T, rx - L, H)
        ctx.fillRect(rr, T, R - rr, H)

        // 2. The violet wash — brighter at the edges, near-clear through the
        //    middle so the candles stay the subject.
        const wash = ctx.createLinearGradient(rx, T, rr, T)
        wash.addColorStop(0, `rgba(139,92,246,${live ? 0.14 : 0.20})`)
        wash.addColorStop(0.5, `rgba(167,139,250,${live ? 0.03 : 0.05})`)
        wash.addColorStop(1, `rgba(139,92,246,${live ? 0.14 : 0.20})`)
        ctx.fillStyle = wash
        ctx.fillRect(rx, T, W, H)

        // 3. Gleam — one light sweep across the window as the read lands. It
        //    runs inside the reveal's own rAF and stops with it; a perpetual
        //    shimmer would repaint the whole candle pass every frame, which is
        //    the documented GPU-heat trap.
        if (!live && gleam > 0 && gleam < 1) {
          const eased = gleam * gleam * (3 - 2 * gleam)
          const gx = rx - 140 + (W + 280) * eased
          const g = ctx.createLinearGradient(gx - 130, 0, gx + 130, 0)
          g.addColorStop(0, 'rgba(196,181,253,0)')
          g.addColorStop(0.45, `rgba(196,181,253,${dayMode ? 0.16 : 0.26})`)
          g.addColorStop(0.55, `rgba(233,213,255,${dayMode ? 0.20 : 0.34})`)
          g.addColorStop(1, 'rgba(196,181,253,0)')
          ctx.save()
          ctx.beginPath(); ctx.rect(rx, T, W, H); ctx.clip()
          ctx.fillStyle = g
          ctx.fillRect(rx, T, W, H)
          ctx.restore()
        }

        // 4. The rails: violet gradient, strongest at the ends, with a bloom.
        const railGrad = ctx.createLinearGradient(0, T, 0, B)
        railGrad.addColorStop(0, `rgba(196,181,253,${live ? 0.7 : 0.98})`)
        railGrad.addColorStop(0.5, `rgba(139,92,246,${live ? 0.35 : 0.6})`)
        railGrad.addColorStop(1, `rgba(196,181,253,${live ? 0.7 : 0.98})`)
        ctx.lineWidth = 1.25
        ctx.shadowColor = 'rgba(167,139,250,0.75)'
        ctx.shadowBlur = 10
        ctx.strokeStyle = railGrad
        for (const x of [rx, rr]) {
          ctx.beginPath()
          ctx.moveTo(x + 0.5, T)
          ctx.lineTo(x + 0.5, B)
          ctx.stroke()
        }
        ctx.shadowBlur = 0

        // 5. In/out brackets — film trim points, not drag handles.
        if (!live) {
          const arm = 10
          ctx.strokeStyle = 'rgba(221,214,254,0.98)'
          ctx.lineWidth = 1.75
          ctx.beginPath()
          for (const [x, dir] of [[rx, 1], [rr, -1]]) {
            ctx.moveTo(x + 0.5, T + 1); ctx.lineTo(x + 0.5 + arm * dir, T + 1)
            ctx.moveTo(x + 0.5, B - 1); ctx.lineTo(x + 0.5 + arm * dir, B - 1)
          }
          ctx.stroke()
        }
        ctx.restore()

        selectionRect = { x: rx, y: T, w: W, h: H }
      }
    }
  }

  return selectionRect
}

export { SEL as TA_SELECTION_COLOR }
