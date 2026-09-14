/**
 * The priced move — the tape, and what the options market says comes next.
 *
 * Dez: "the dominant thing on this page is the term structure chart. maybe this
 * is a subchart. a price chart might be better showing the implied move as a
 * synthetic candle or something with the technicals overlaid?"
 *
 * Right, and it reorders the whole page. The term structure is the EVIDENCE for
 * a claim; the claim itself is about price, and until you draw it against the
 * actual tape a reader has to hold "±6.1%" in their head and do the arithmetic.
 * Here the cone opens out of the last real candle, so the priced range is a
 * place on the chart rather than a number in a sentence — and the strikes the
 * book is stacked on are drawn at the levels they actually sit at.
 *
 * The cone widens as √t, not linearly: the straddle prices the move at EXPIRY,
 * and volatility scales with the square root of time, so half the way there is
 * ~71% of the width. A straight-line cone would understate every day but the
 * last, which on a 4-day earnings window is most of what a reader is looking at.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { fmtStrike, toMs, priceScale } from '@/lib/options-read'
import { computeSRLevels } from '@/lib/sr-levels'

const cx = (...a) => a.filter(Boolean).join(' ')

// Classic EMA, null through the warmup (seeded with the SMA of the first n).
// Inlined rather than imported from the RZ hook file — pages don't reach into
// other pages' hooks, and six lines don't earn a shared module.
function ema(values, n) {
  const out = new Array(values.length).fill(null)
  if (values.length < n) return out
  let s = 0
  for (let i = 0; i < n; i++) s += values[i]
  let prev = s / n
  out[n - 1] = prev
  const k = 2 / (n + 1)
  for (let i = n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

/* ── candles ────────────────────────────────────────────────────────────── */
const _bars = new Map()
function fetchBars(symbol) {
  const hit = _bars.get(symbol)
  if (hit && Date.now() - hit.ts < 10 * 60_000) return hit.p
  const p = fetch(`/api/stocks/candles?symbol=${encodeURIComponent(symbol)}&interval=1d&range=3mo`, {
    signal: AbortSignal.timeout(20000),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((j) => {
      const bars = j?.bars || j?.candles || []
      return bars.length ? bars : Promise.reject(new Error('empty'))
    })
  _bars.set(symbol, { ts: Date.now(), p })
  p.catch(() => _bars.delete(symbol))
  return p
}

function useBars(symbol) {
  const [s, setS] = useState({ bars: null, error: null })
  useEffect(() => {
    let alive = true
    setS({ bars: null, error: null })
    fetchBars(symbol)
      .then((bars) => { if (alive) setS({ bars, error: null }) })
      .catch((e) => { if (alive) setS({ bars: null, error: e.message || 'unavailable' }) })
    return () => { alive = false }
  }, [symbol])
  return s
}

function useWidth() {
  const roRef = useRef(null)
  const [w, setW] = useState(0)
  const ref = React.useCallback((node) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (!node) return
    setW(node.clientWidth)
    if (typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(node); roRef.current = ro
  }, [])
  return [ref, w]
}

const DAY = 86400000
const num = (v) => (Number.isFinite(+v) ? +v : null)


/* ── the canvas ─────────────────────────────────────────────────────────── */
const Canvas = React.memo(({ bars, data, row, range, w, h, compact, ta }) => {
  const ref = useRef(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv || !bars?.length || w < 120) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = w * dpr; cv.height = h * dpr
    const ctx = cv.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const css = getComputedStyle(cv)
    const V = (n, f) => css.getPropertyValue(n).trim() || f
    const grid = V('--po-canvas-grid', 'rgba(255,255,255,0.075)')
    const label = V('--po-canvas-label', 'rgba(255,255,255,0.42)')
    const mark = V('--po-canvas-mark', 'rgba(251,191,36,0.95)')
    const vol = V('--po-canvas-line', 'rgba(129,140,248,0.95)')
    const up = V('--po-canvas-up', 'rgba(16,185,129,0.9)')
    const dn = V('--po-canvas-dn', 'rgba(239,68,68,0.9)')
    const emaFast = V('--po-canvas-ema-fast', 'rgba(34,211,238,0.9)')
    const emaSlow = V('--po-canvas-ema-slow', 'rgba(245,245,247,0.5)')
    const srFill = V('--po-canvas-sr', 'rgba(148,163,184,0.14)')
    const srInk = V('--po-canvas-sr-ink', 'rgba(148,163,184,0.75)')

    const padL = 8, padR = 58, padT = 14, padB = 26
    const iw = w - padL - padR, ih = h - padT - padB

    const spot = num(data.spot)
    const expiryMs = Date.parse(`${row.exp}T21:00:00Z`)
    const lastBarMs = toMs(bars[bars.length - 1].t) ?? 0
    const nowMs = Math.max(Date.now(), lastBarMs)
    // Forward span in days, floored at one so a 0DTE still gets a visible cone.
    const fwdDays = Math.max(1, (expiryMs - nowMs) / DAY)
    const histDays = bars.length

    // The forward zone is sized to the time it represents, but floored at ~18%
    // of the width — a 3-day cone against 63 sessions of history would be four
    // pixels wide, which is the half of the chart the page is actually about.
    const fwdFrac = Math.max(0.18, Math.min(0.42, fwdDays / (histDays + fwdDays) * 2.2))
    const histW = iw * (1 - fwdFrac)
    const fwdW = iw - histW
    const nowX = padL + histW

    const lo = range.lo, hi = range.hi
    const span = hi - lo || 1
    const y = (p) => padT + ih - ((p - lo) / span) * ih
    const xh = (i) => padL + (bars.length === 1 ? histW / 2 : (i / (bars.length - 1)) * histW)
    const xf = (frac) => nowX + frac * fwdW

    /* The two prices the cone resolves to own the axis — they are the point of
       the chart — so their rows are reserved before any grid label is drawn. */
    const move0 = num(row.expectedMove)
    const spot0 = num(data.spot)
    const coneYs = spot0 && move0 ? [y(spot0 * (1 + move0)), y(spot0 * (1 - move0))] : []

    /* grid + price axis */
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textBaseline = 'middle'
    const rungs = compact ? 3 : 4
    for (let g = 0; g <= rungs; g++) {
      const p = lo + (span * g) / rungs
      const gy = Math.round(y(p)) + 0.5
      ctx.strokeStyle = grid; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(w - padR, gy); ctx.stroke()
      if (coneYs.some((cy) => Math.abs(cy - gy) < 12)) continue
      ctx.fillStyle = label; ctx.textAlign = 'left'
      ctx.fillText(`$${fmtStrike(p)}`, w - padR + 6, gy)
    }

    /* S/R zones from the tape itself — the nearest tested level per side.
       Bands, not lines: a zone IS a range, and a soft band under everything
       reads as terrain where the dashed strike lines read as pins. They extend
       through the forward zone on purpose — that is where the cone has to
       fight through them. */
    const takenLabelYs = []
    ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace'
    for (const z of ta?.zones || []) {
      if (z.high < lo || z.low > hi) continue
      const yTop = y(Math.min(hi, z.high))
      const yBot = y(Math.max(lo, z.low))
      ctx.fillStyle = srFill
      ctx.fillRect(padL, yTop, iw, Math.max(2, yBot - yTop))
      if (!compact) {
        let labelY = yTop - 6
        if (labelY < padT + 8) labelY = yBot + 9
        if (takenLabelYs.some((t) => Math.abs(t - labelY) < 11)) labelY = yBot + 9
        takenLabelYs.push(labelY)
        ctx.fillStyle = srInk; ctx.textAlign = 'right'
        ctx.fillText(`${z.side === 'support' ? 'support' : 'resistance'} ${fmtStrike(z.mid)}`, w - padR - 6, labelY)
      }
    }
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.textAlign = 'left'

    /* the cone — drawn under everything so candles and levels stay readable */
    const move = move0
    if (spot && move) {
      const steps = 48
      const top = [], bot = []
      for (let i = 0; i <= steps; i++) {
        const f = i / steps
        // √t, not t — the straddle prices the move at expiry and vol scales
        // with the square root of time.
        const m = move * Math.sqrt(f)
        top.push([xf(f), y(spot * (1 + m))])
        bot.push([xf(f), y(spot * (1 - m))])
      }
      const g = ctx.createLinearGradient(nowX, 0, nowX + fwdW, 0)
      g.addColorStop(0, 'rgba(129,140,248,0.03)')
      g.addColorStop(1, 'rgba(129,140,248,0.20)')
      ctx.beginPath()
      ctx.moveTo(top[0][0], top[0][1])
      for (const [px, py] of top) ctx.lineTo(px, py)
      for (let i = bot.length - 1; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1])
      ctx.closePath(); ctx.fillStyle = g; ctx.fill()

      ctx.setLineDash([4, 3]); ctx.lineWidth = 1.25; ctx.strokeStyle = vol
      for (const side of [top, bot]) {
        ctx.beginPath(); ctx.moveTo(side[0][0], side[0][1])
        for (const [px, py] of side) ctx.lineTo(px, py)
        ctx.stroke()
      }
      ctx.setLineDash([])

      // The two prices the cone resolves to, on the axis where they land.
      ctx.textAlign = 'left'; ctx.fillStyle = vol
      ctx.fillText(`$${(spot * (1 + move)).toFixed(2)}`, w - padR + 6, y(spot * (1 + move)))
      ctx.fillText(`$${(spot * (1 - move)).toFixed(2)}`, w - padR + 6, y(spot * (1 - move)))
    }

    /* strike levels the book is stacked on */
    const levels = []
    if (num(row.maxPain)) levels.push({ p: row.maxPain, c: mark, t: 'max pain', s: 'MP' })
    if (num(data.gamma?.wall)) levels.push({ p: data.gamma.wall, c: vol, t: 'γ wall', s: 'γ' })
    ctx.textAlign = 'left'
    // On an index the two levels are routinely a couple of points apart (SPY's
    // max pain 768 against a 765 wall), so a label parked above each line lands
    // on its neighbour. The second one goes BELOW instead. takenLabelYs is
    // shared with the S/R labels above so strike labels dodge them too.
    for (const lv of levels) {
      if (lv.p < lo || lv.p > hi) continue
      const ly = Math.round(y(lv.p)) + 0.5
      ctx.setLineDash([2, 4]); ctx.strokeStyle = lv.c; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(w - padR, ly); ctx.stroke()
      ctx.setLineDash([])
      // Right-aligned against the axis: the left edge is where the oldest
      // candles are, and a label sitting on them read as part of the tape.
      ctx.fillStyle = lv.c; ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textAlign = 'right'
      // On a phone the plot is ~300px and a full label lands on the candles;
      // the short form still identifies the line and the panels below name it.
      let labelY = ly - 7
      if (takenLabelYs.some((t) => Math.abs(t - labelY) < 11)) labelY = ly + 9
      takenLabelYs.push(labelY)
      ctx.fillText(compact ? `${lv.s} ${fmtStrike(lv.p)}` : `${lv.t} ${fmtStrike(lv.p)}`, w - padR - 6, labelY)
      ctx.textAlign = 'left'
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
    }

    /* candles */
    const cw = Math.max(1.5, Math.min(8, (histW / bars.length) * 0.62))
    bars.forEach((b, i) => {
      const o = num(b.o), hh = num(b.h), ll = num(b.l), c = num(b.c)
      if (o == null || c == null) return
      const x = xh(i)
      const rising = c >= o
      ctx.strokeStyle = rising ? up : dn
      ctx.fillStyle = rising ? up : dn
      ctx.lineWidth = 1
      if (hh != null && ll != null) {
        ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y(hh)); ctx.lineTo(Math.round(x) + 0.5, y(ll)); ctx.stroke()
      }
      const top2 = y(Math.max(o, c)), bot2 = y(Math.min(o, c))
      ctx.fillRect(x - cw / 2, top2, cw, Math.max(1, bot2 - top2))
    })

    /* moving averages over the tape — drawn after the candles so the trend
       lines stay legible through dense history */
    const drawEma = (series, color) => {
      if (!series) return
      ctx.strokeStyle = color; ctx.lineWidth = 1.25
      ctx.beginPath()
      let started = false
      for (let i = 0; i < series.length; i++) {
        const v = series[i]
        if (v == null || v < lo || v > hi) { continue }
        const px = xh(i), py = y(v)
        if (!started) { ctx.moveTo(px, py); started = true } else { ctx.lineTo(px, py) }
      }
      if (started) ctx.stroke()
    }
    drawEma(ta?.ema20, emaFast)
    drawEma(ta?.ema50, emaSlow)

    /* the now divider */
    ctx.setLineDash([3, 3]); ctx.strokeStyle = label; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(Math.round(nowX) + 0.5, padT); ctx.lineTo(Math.round(nowX) + 0.5, padT + ih); ctx.stroke()
    ctx.setLineDash([])

    /* the print, if one falls inside the window */
    const earnings = data.event?.earnings
    if (earnings?.inWindow && spot) {
      const at = Date.parse(earnings.date)
      const f = (at - nowMs) / (expiryMs - nowMs)
      if (f >= 0 && f <= 1) {
        const ex = Math.round(xf(f)) + 0.5
        ctx.setLineDash([2, 3]); ctx.strokeStyle = mark; ctx.lineWidth = 1.25
        ctx.beginPath(); ctx.moveTo(ex, padT); ctx.lineTo(ex, padT + ih); ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = mark; ctx.textAlign = 'center'
        ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace'
        ctx.fillText('report', ex, padT - 4)
      }
    }

    /* x labels: the last real session, and the expiry the cone resolves to */
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillStyle = label; ctx.textBaseline = 'top'
    const d0 = new Date(toMs(bars[0].t))
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const de = new Date(expiryMs)
    const expiryLabel = `${de.getUTCDate()} ${MON[de.getUTCMonth()]} expiry`
    ctx.textAlign = 'left'
    ctx.fillText(`${d0.getUTCDate()} ${MON[d0.getUTCMonth()]}`, padL, padT + ih + 8)
    // The dashed divider already says "now"; the word only earns its place when
    // it does not crowd the expiry, which on a phone it always does.
    const expiryLeft = (w - padR) - ctx.measureText(expiryLabel).width
    if (!compact && nowX + 18 < expiryLeft) {
      ctx.textAlign = 'center'
      ctx.fillText('now', nowX, padT + ih + 8)
    }
    ctx.textAlign = 'right'
    ctx.fillStyle = vol
    ctx.fillText(expiryLabel, w - padR, padT + ih + 8)
  }, [bars, data, row, range, w, h, ta])

  return <canvas ref={ref} style={{ width: '100%', height: h, display: 'block' }} aria-hidden />
})

/* ── the panel ──────────────────────────────────────────────────────────── */
export default function PricedMoveChart({ data, row, isMobile }) {
  const { bars, error } = useBars(data.symbol)
  const [hostRef, w] = useWidth()

  // One scale for candles, cone and levels — a level drawn off its own scale is
  // worse than no level at all.
  const range = useMemo(
    () => priceScale(bars, data.spot, row?.expectedMove, [row?.maxPain, data.gamma?.wall]),
    [bars, data, row],
  )

  // Technicals from the tape (Dez: "...with the technicals overlaid"):
  // 20/50-day EMAs + the nearest TESTED support/resistance zone per side from
  // the house S/R engine. Pure derivation from the bars already fetched — no
  // extra request, and thin history simply yields fewer overlays.
  const ta = useMemo(() => {
    if (!bars || bars.length < 20) return null
    const norm = bars
      .map((b) => ({ t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c }))
      .filter((b) => Number.isFinite(b.c) && Number.isFinite(b.h) && Number.isFinite(b.l))
    if (norm.length < 20) return null
    const closes = norm.map((b) => b.c)
    const sr = computeSRLevels(norm, null, num(data.spot) ?? closes[closes.length - 1])
    const zones = [sr.nearest.support, sr.nearest.resistance].filter(Boolean)
    return { ema20: ema(closes, 20), ema50: ema(closes, 50), zones }
  }, [bars, data.spot])

  if (error || (!bars && !error)) {
    return (
      <div className="po-chart-host" ref={hostRef}>
        <div className={cx('po-chart-boot', error && 'is-error')}>
          {error ? `No daily tape for ${data.symbol}` : ''}
        </div>
      </div>
    )
  }

  return (
    <div className="po-chart-host" ref={hostRef}>
      {w > 120 && range && (
        <Canvas bars={bars} data={data} row={row} range={range} w={w} h={isMobile ? 240 : 320} compact={isMobile} ta={ta} />
      )}
    </div>
  )
}
