/**
 * chart-patterns.js — the technical-analysis pattern book.
 *
 * Two halves:
 *   1. THE BOOK   — CHART_PATTERNS / CANDLE_PATTERNS: textbook definitions,
 *      confirmation triggers, invalidation levels and measured-move rules.
 *      This is the reference the AI is grounded against, so it cites a real
 *      definition instead of improvising one.
 *   2. THE MATCHER — detectChartPatterns() / detectCandlePatterns(): finds
 *      candidates in a real bar window and returns them WITH the geometry
 *      (points + lines) so the chart can draw exactly what was matched.
 *
 * Bar shape everywhere here is the sr-levels shape: { t, o, h, l, c, v }.
 * Timeframe matters and is never assumed — every detector takes the bars it is
 * given and reports `bars` + the caller tags the resolution.
 *
 * Nothing in this file fabricates a level. A pattern is only returned when its
 * geometric conditions actually hold, and `confidence` reports how well.
 */

import { findSwings } from './sr-levels'

// ────────────────────────────────────────────────────────────────────────────
// 1. THE BOOK
// ────────────────────────────────────────────────────────────────────────────

/**
 * Classical chart patterns. `measured` describes the textbook target rule so
 * the agent quotes the same arithmetic the chart draws.
 */
export const CHART_PATTERNS = {
  double_top: {
    name: 'Double Top',
    kind: 'reversal',
    bias: 'bearish',
    definition: 'Two peaks at roughly the same price separated by a trough. Buyers failed twice at the same level.',
    confirmation: 'Close below the neckline (the trough between the peaks) on rising volume.',
    invalidation: 'A close above the higher of the two peaks.',
    measured: 'Peak minus neckline, projected down from the neckline.',
    reliability: 'High on daily/4H. Noisy below 1H.',
  },
  double_bottom: {
    name: 'Double Bottom',
    kind: 'reversal',
    bias: 'bullish',
    definition: 'Two troughs at roughly the same price separated by a peak. Sellers failed twice at the same level.',
    confirmation: 'Close above the neckline (the peak between the troughs).',
    invalidation: 'A close below the lower of the two troughs.',
    measured: 'Neckline minus trough, projected up from the neckline.',
    reliability: 'High on daily/4H. Noisy below 1H.',
  },
  triple_top: {
    name: 'Triple Top',
    kind: 'reversal',
    bias: 'bearish',
    definition: 'Three rejections from the same resistance band with troughs between them.',
    confirmation: 'Close below the lowest trough.',
    invalidation: 'Close above the highest peak.',
    measured: 'Peak minus neckline, projected down from the neckline.',
    reliability: 'Higher than a double top — more touches, more trapped buyers.',
  },
  triple_bottom: {
    name: 'Triple Bottom',
    kind: 'reversal',
    bias: 'bullish',
    definition: 'Three defences of the same support band with peaks between them.',
    confirmation: 'Close above the highest peak.',
    invalidation: 'Close below the lowest trough.',
    measured: 'Neckline minus trough, projected up from the neckline.',
    reliability: 'Higher than a double bottom.',
  },
  head_shoulders: {
    name: 'Head & Shoulders',
    kind: 'reversal',
    bias: 'bearish',
    definition: 'Three peaks: a higher middle peak (head) flanked by two lower, roughly equal peaks (shoulders).',
    confirmation: 'Close below the neckline drawn through the two troughs.',
    invalidation: 'Close back above the right shoulder — a failed H&S often runs hard the other way.',
    measured: 'Head minus neckline, projected down from the break.',
    reliability: 'The most-studied reversal. Needs a clear prior uptrend to mean anything.',
  },
  inverse_head_shoulders: {
    name: 'Inverse Head & Shoulders',
    kind: 'reversal',
    bias: 'bullish',
    definition: 'Three troughs: a lower middle trough (head) flanked by two higher, roughly equal troughs.',
    confirmation: 'Close above the neckline drawn through the two peaks.',
    invalidation: 'Close back below the right shoulder.',
    measured: 'Neckline minus head, projected up from the break.',
    reliability: 'Strong bottoming structure after a downtrend.',
  },
  ascending_triangle: {
    name: 'Ascending Triangle',
    kind: 'continuation',
    bias: 'bullish',
    definition: 'Flat resistance with a rising series of lows compressing into it.',
    confirmation: 'Close above the flat resistance.',
    invalidation: 'Close below the rising lower trendline.',
    measured: 'Height of the triangle at its widest, projected up from the breakout.',
    reliability: 'Good in an established uptrend; a coin flip in chop.',
  },
  descending_triangle: {
    name: 'Descending Triangle',
    kind: 'continuation',
    bias: 'bearish',
    definition: 'Flat support with a falling series of highs pressing down onto it.',
    confirmation: 'Close below the flat support.',
    invalidation: 'Close above the falling upper trendline.',
    measured: 'Height at the widest, projected down from the breakdown.',
    reliability: 'Good in an established downtrend.',
  },
  symmetrical_triangle: {
    name: 'Symmetrical Triangle',
    kind: 'bilateral',
    bias: 'neutral',
    definition: 'Lower highs and higher lows converging — volatility compressing, direction undecided.',
    confirmation: 'Close outside either trendline. Direction is decided by the break, not predicted before it.',
    invalidation: 'A break that closes back inside the triangle (failed break).',
    measured: 'Widest height, projected in the direction of the break.',
    reliability: 'The break is real; the pre-break direction call is not.',
  },
  rising_wedge: {
    name: 'Rising Wedge',
    kind: 'reversal',
    bias: 'bearish',
    definition: 'Both trendlines rising but converging — each push up is weaker than the last.',
    confirmation: 'Close below the lower rising trendline.',
    invalidation: 'Close above the upper trendline with expanding range.',
    measured: 'Back to the wedge origin is the common target.',
    reliability: 'Reliable exhaustion tell at the end of a run.',
  },
  falling_wedge: {
    name: 'Falling Wedge',
    kind: 'reversal',
    bias: 'bullish',
    definition: 'Both trendlines falling but converging — each leg down is shallower than the last.',
    confirmation: 'Close above the upper falling trendline.',
    invalidation: 'Close below the lower trendline.',
    measured: 'Back to the wedge origin.',
    reliability: 'Common bottoming pattern in crypto drawdowns.',
  },
  bull_flag: {
    name: 'Bull Flag',
    kind: 'continuation',
    bias: 'bullish',
    definition: 'A sharp rally (the pole) followed by a tight, slightly-down consolidation (the flag).',
    confirmation: 'Close above the flag on volume returning.',
    invalidation: 'Retracing more than the pole — that is not a flag, that is a failed leg.',
    measured: 'Pole height added to the breakout point.',
    reliability: 'One of the highest-hit-rate continuations when the pole had real volume.',
  },
  bear_flag: {
    name: 'Bear Flag',
    kind: 'continuation',
    bias: 'bearish',
    definition: 'A sharp drop followed by a tight, slightly-up drift.',
    confirmation: 'Close below the flag.',
    invalidation: 'Reclaiming the top of the pole.',
    measured: 'Pole height subtracted from the breakdown point.',
    reliability: 'Frequently the shape of a relief rally inside a downtrend.',
  },
  rectangle: {
    name: 'Rectangle Range',
    kind: 'bilateral',
    bias: 'neutral',
    definition: 'Horizontal support and resistance holding repeatedly — a balance area.',
    confirmation: 'Close outside the range and hold on a retest.',
    invalidation: 'Immediate return inside (a range deviation, which usually runs to the opposite edge).',
    measured: 'Range height projected from the break.',
    reliability: 'Deviations are more common than clean breaks in low-liquidity assets.',
  },
  ascending_channel: {
    name: 'Ascending Channel',
    kind: 'continuation',
    bias: 'bullish',
    definition: 'Higher highs and higher lows between two parallel rising lines.',
    confirmation: 'Trend continues while the lower rail holds.',
    invalidation: 'Close below the lower rail.',
    measured: 'Channel width projected from the break.',
    reliability: 'Rail touches are the tradable events, not the middle.',
  },
  descending_channel: {
    name: 'Descending Channel',
    kind: 'continuation',
    bias: 'bearish',
    definition: 'Lower highs and lower lows between two parallel falling lines.',
    confirmation: 'Trend continues while the upper rail caps.',
    invalidation: 'Close above the upper rail.',
    measured: 'Channel width projected from the break.',
    reliability: 'The upper rail is where relief rallies die.',
  },
  cup_handle: {
    name: 'Cup & Handle',
    kind: 'continuation',
    bias: 'bullish',
    definition: 'A rounded base (the cup) followed by a shallow pullback (the handle) near the rim.',
    confirmation: 'Close above the rim.',
    invalidation: 'The handle retracing more than half the cup.',
    measured: 'Cup depth added to the rim.',
    reliability: 'Wants a long base — weeks on daily, not hours on 5m.',
  },
  rounding_bottom: {
    name: 'Rounding Bottom',
    kind: 'reversal',
    bias: 'bullish',
    definition: 'A slow, symmetric saucer where selling pressure decays and buyers gradually take over.',
    confirmation: 'Close above the left rim.',
    invalidation: 'Close below the saucer low.',
    measured: 'Saucer depth added to the rim.',
    reliability: 'Slow, but the base is durable when volume dries at the low.',
  },
  rounding_top: {
    name: 'Rounding Top',
    kind: 'reversal',
    bias: 'bearish',
    definition: 'A slow dome where buying decays into distribution.',
    confirmation: 'Close below the left rim.',
    invalidation: 'Close above the dome high.',
    measured: 'Dome height subtracted from the rim.',
    reliability: 'Reads as "the bid is gone" long before the break.',
  },
  capitulation_bounce: {
    name: 'Capitulation & Bounce',
    kind: 'reversal',
    bias: 'neutral',
    definition: 'A vertical flush on outsized volume followed by a sharp V recovery.',
    confirmation: 'Reclaiming the pre-flush range and holding it.',
    invalidation: 'Fading back into the flush candle — that makes it a relief rally, not a reversal.',
    measured: 'No reliable measured move. The flush low is the reference level.',
    reliability: 'Most of these fail inside a downtrend. Treat as relief until the range is reclaimed.',
  },
}

/**
 * Candlestick formations. These read the last few bars, so they are the
 * timing layer on top of the structural patterns above.
 */
export const CANDLE_PATTERNS = {
  bullish_engulfing: { name: 'Bullish Engulfing', bias: 'bullish', bars: 2, definition: 'A down candle fully engulfed by the next up candle. Sellers overwhelmed in one bar.' },
  bearish_engulfing: { name: 'Bearish Engulfing', bias: 'bearish', bars: 2, definition: 'An up candle fully engulfed by the next down candle.' },
  hammer: { name: 'Hammer', bias: 'bullish', bars: 1, definition: 'Small body at the top, long lower wick — a rejected flush. Only meaningful at a low.' },
  shooting_star: { name: 'Shooting Star', bias: 'bearish', bars: 1, definition: 'Small body at the bottom, long upper wick — a rejected push. Only meaningful at a high.' },
  inverted_hammer: { name: 'Inverted Hammer', bias: 'bullish', bars: 1, definition: 'Long upper wick after a decline — first sign the bid is testing.' },
  hanging_man: { name: 'Hanging Man', bias: 'bearish', bars: 1, definition: 'Hammer shape after an advance — the flush got bought, but it happened at all.' },
  doji: { name: 'Doji', bias: 'neutral', bars: 1, definition: 'Open and close near-identical. Indecision; meaningful only at an extreme.' },
  morning_star: { name: 'Morning Star', bias: 'bullish', bars: 3, definition: 'Down candle, small-bodied pause, then a strong up candle closing into the first body.' },
  evening_star: { name: 'Evening Star', bias: 'bearish', bars: 3, definition: 'Up candle, small-bodied pause, then a strong down candle closing into the first body.' },
  three_white_soldiers: { name: 'Three White Soldiers', bias: 'bullish', bars: 3, definition: 'Three consecutive strong up candles, each closing near its high.' },
  three_black_crows: { name: 'Three Black Crows', bias: 'bearish', bars: 3, definition: 'Three consecutive strong down candles, each closing near its low.' },
  bullish_harami: { name: 'Bullish Harami', bias: 'bullish', bars: 2, definition: 'A large down candle followed by a small body inside it — momentum stalling.' },
  bearish_harami: { name: 'Bearish Harami', bias: 'bearish', bars: 2, definition: 'A large up candle followed by a small body inside it.' },
  tweezer_bottom: { name: 'Tweezer Bottom', bias: 'bullish', bars: 2, definition: 'Two bars sharing near-identical lows — the same level defended twice in a row.' },
  tweezer_top: { name: 'Tweezer Top', bias: 'bearish', bars: 2, definition: 'Two bars sharing near-identical highs.' },
  piercing_line: { name: 'Piercing Line', bias: 'bullish', bars: 2, definition: 'Gap down then a close back above the midpoint of the prior down candle.' },
  dark_cloud: { name: 'Dark Cloud Cover', bias: 'bearish', bars: 2, definition: 'Gap up then a close back below the midpoint of the prior up candle.' },
  marubozu_bull: { name: 'Bullish Marubozu', bias: 'bullish', bars: 1, definition: 'A full-bodied up candle with almost no wicks — one-way demand.' },
  marubozu_bear: { name: 'Bearish Marubozu', bias: 'bearish', bars: 1, definition: 'A full-bodied down candle with almost no wicks.' },
}

// ────────────────────────────────────────────────────────────────────────────
// 2. THE MATCHER
// ────────────────────────────────────────────────────────────────────────────

const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)
const near = (a, b, tol) => Math.abs(a - b) <= tol

/** Least-squares fit over [{x, y}] → { slope, intercept, r2 } */
function fitLine(pts) {
  const n = pts.length
  if (n < 2) return null
  const mx = avg(pts.map(p => p.x))
  const my = avg(pts.map(p => p.y))
  let num = 0, den = 0
  for (const p of pts) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2 }
  if (den === 0) return null
  const slope = num / den
  const intercept = my - slope * mx
  let ssTot = 0, ssRes = 0
  for (const p of pts) {
    ssTot += (p.y - my) ** 2
    ssRes += (p.y - (slope * p.x + intercept)) ** 2
  }
  return { slope, intercept, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot }
}

const lineAt = (fit, x) => fit.slope * x + fit.intercept

/**
 * Detect classical chart patterns in a bar window.
 *
 * @param bars  [{ t, o, h, l, c, v }] ascending by time
 * @param opts  { strength } fractal wing size (auto-scaled to window length)
 * @returns [{ id, name, kind, bias, confidence, startTs, endTs, points, lines,
 *             neckline, target, invalidation, note }]
 */
export function detectChartPatterns(bars, opts = {}) {
  const out = []
  if (!Array.isArray(bars) || bars.length < 12) return out

  const n = bars.length
  const strength = opts.strength ?? Math.max(2, Math.min(6, Math.round(n / 25)))
  const swings = findSwings(bars, strength)
  const closes = bars.map(b => b.c)
  const hi = Math.max(...bars.map(b => b.h))
  const lo = Math.min(...bars.map(b => b.l))
  const span = hi - lo
  if (!(span > 0)) return out
  // Tolerance for "the same level twice": 4% of the window's own range. Scales
  // with the asset instead of a hardcoded % that is wrong for both BTC and a
  // microcap.
  const tol = span * 0.04
  const t0 = bars[0].t
  const tN = bars[n - 1].t

  const highs = swings.filter(s => s.type === 'high')
  const lows = swings.filter(s => s.type === 'low')
  const idxOf = (t) => {
    let best = 0, bd = Infinity
    for (let i = 0; i < n; i++) { const d = Math.abs(bars[i].t - t); if (d < bd) { bd = d; best = i } }
    return best
  }

  const push = (p) => { if (p) out.push(p) }

  // ── Double / triple tops and bottoms ──────────────────────────────────────
  if (highs.length >= 2) {
    for (let i = 0; i < highs.length - 1; i++) {
      for (let j = i + 1; j < highs.length; j++) {
        const a = highs[i], b = highs[j]
        if (!near(a.price, b.price, tol)) continue
        const ia = idxOf(a.t), ib = idxOf(b.t)
        if (ib - ia < strength * 2) continue
        const troughSlice = bars.slice(ia, ib + 1)
        const neckline = Math.min(...troughSlice.map(x => x.l))
        const depth = ((a.price + b.price) / 2) - neckline
        if (depth < span * 0.15) continue // too shallow to be a top
        const third = highs.find(h => h !== a && h !== b && near(h.price, a.price, tol) && idxOf(h.t) > ib)
        const isTriple = !!third
        const peak = Math.max(a.price, b.price, third?.price ?? 0)
        push({
          id: isTriple ? 'triple_top' : 'double_top',
          ...CHART_PATTERNS[isTriple ? 'triple_top' : 'double_top'],
          confidence: Math.min(0.95, 0.55 + (1 - Math.abs(a.price - b.price) / tol) * 0.25 + (isTriple ? 0.15 : 0)),
          startTs: a.t,
          endTs: third?.t ?? b.t,
          points: [{ ts: a.t, price: a.price }, { ts: b.t, price: b.price }, ...(third ? [{ ts: third.t, price: third.price }] : [])],
          lines: [
            { from: { ts: a.t, price: peak }, to: { ts: third?.t ?? b.t, price: peak }, style: 'resistance', label: 'resistance' },
            { from: { ts: a.t, price: neckline }, to: { ts: tN, price: neckline }, style: 'neckline', label: 'neckline' },
          ],
          neckline,
          target: neckline - depth,
          invalidation: peak,
          note: `${isTriple ? 'Three' : 'Two'} rejections near ${fmtNum(peak)}; neckline ${fmtNum(neckline)}.`,
        })
        break
      }
      if (out.some(p => p.id === 'double_top' || p.id === 'triple_top')) break
    }
  }

  if (lows.length >= 2) {
    for (let i = 0; i < lows.length - 1; i++) {
      for (let j = i + 1; j < lows.length; j++) {
        const a = lows[i], b = lows[j]
        if (!near(a.price, b.price, tol)) continue
        const ia = idxOf(a.t), ib = idxOf(b.t)
        if (ib - ia < strength * 2) continue
        const neckline = Math.max(...bars.slice(ia, ib + 1).map(x => x.h))
        const depth = neckline - ((a.price + b.price) / 2)
        if (depth < span * 0.15) continue
        const third = lows.find(l => l !== a && l !== b && near(l.price, a.price, tol) && idxOf(l.t) > ib)
        const isTriple = !!third
        const trough = Math.min(a.price, b.price, third?.price ?? Infinity)
        push({
          id: isTriple ? 'triple_bottom' : 'double_bottom',
          ...CHART_PATTERNS[isTriple ? 'triple_bottom' : 'double_bottom'],
          confidence: Math.min(0.95, 0.55 + (1 - Math.abs(a.price - b.price) / tol) * 0.25 + (isTriple ? 0.15 : 0)),
          startTs: a.t,
          endTs: third?.t ?? b.t,
          points: [{ ts: a.t, price: a.price }, { ts: b.t, price: b.price }, ...(third ? [{ ts: third.t, price: third.price }] : [])],
          lines: [
            { from: { ts: a.t, price: trough }, to: { ts: third?.t ?? b.t, price: trough }, style: 'support', label: 'support' },
            { from: { ts: a.t, price: neckline }, to: { ts: tN, price: neckline }, style: 'neckline', label: 'neckline' },
          ],
          neckline,
          target: neckline + depth,
          invalidation: trough,
          note: `${isTriple ? 'Three' : 'Two'} defences near ${fmtNum(trough)}; neckline ${fmtNum(neckline)}.`,
        })
        break
      }
      if (out.some(p => p.id === 'double_bottom' || p.id === 'triple_bottom')) break
    }
  }

  // ── Head & shoulders (and inverse) ────────────────────────────────────────
  if (highs.length >= 3 && lows.length >= 2) {
    for (let i = 0; i + 2 < highs.length; i++) {
      const [ls, head, rs] = [highs[i], highs[i + 1], highs[i + 2]]
      if (!(head.price > ls.price && head.price > rs.price)) continue
      if (!near(ls.price, rs.price, tol * 1.5)) continue
      if (head.price - Math.max(ls.price, rs.price) < span * 0.08) continue
      const t1 = lows.find(l => l.t > ls.t && l.t < head.t)
      const t2 = lows.find(l => l.t > head.t && l.t < rs.t)
      if (!t1 || !t2) continue
      const neckline = (t1.price + t2.price) / 2
      push({
        id: 'head_shoulders',
        ...CHART_PATTERNS.head_shoulders,
        confidence: 0.7,
        startTs: ls.t,
        endTs: rs.t,
        points: [
          { ts: ls.t, price: ls.price, label: 'L shoulder' },
          { ts: head.t, price: head.price, label: 'head' },
          { ts: rs.t, price: rs.price, label: 'R shoulder' },
        ],
        lines: [{ from: { ts: t1.t, price: t1.price }, to: { ts: tN, price: t2.price }, style: 'neckline', label: 'neckline' }],
        neckline,
        target: neckline - (head.price - neckline),
        invalidation: rs.price,
        note: `Head ${fmtNum(head.price)}, shoulders ${fmtNum(ls.price)}/${fmtNum(rs.price)}, neckline ~${fmtNum(neckline)}.`,
      })
      break
    }
  }
  if (lows.length >= 3 && highs.length >= 2) {
    for (let i = 0; i + 2 < lows.length; i++) {
      const [ls, head, rs] = [lows[i], lows[i + 1], lows[i + 2]]
      if (!(head.price < ls.price && head.price < rs.price)) continue
      if (!near(ls.price, rs.price, tol * 1.5)) continue
      if (Math.min(ls.price, rs.price) - head.price < span * 0.08) continue
      const p1 = highs.find(h => h.t > ls.t && h.t < head.t)
      const p2 = highs.find(h => h.t > head.t && h.t < rs.t)
      if (!p1 || !p2) continue
      const neckline = (p1.price + p2.price) / 2
      push({
        id: 'inverse_head_shoulders',
        ...CHART_PATTERNS.inverse_head_shoulders,
        confidence: 0.7,
        startTs: ls.t,
        endTs: rs.t,
        points: [
          { ts: ls.t, price: ls.price, label: 'L shoulder' },
          { ts: head.t, price: head.price, label: 'head' },
          { ts: rs.t, price: rs.price, label: 'R shoulder' },
        ],
        lines: [{ from: { ts: p1.t, price: p1.price }, to: { ts: tN, price: p2.price }, style: 'neckline', label: 'neckline' }],
        neckline,
        target: neckline + (neckline - head.price),
        invalidation: rs.price,
        note: `Head ${fmtNum(head.price)}, shoulders ${fmtNum(ls.price)}/${fmtNum(rs.price)}, neckline ~${fmtNum(neckline)}.`,
      })
      break
    }
  }

  // ── Trendline geometry: triangles, wedges, channels, ranges ───────────────
  if (highs.length >= 3 && lows.length >= 3) {
    const hPts = highs.map(s => ({ x: idxOf(s.t), y: s.price }))
    const lPts = lows.map(s => ({ x: idxOf(s.t), y: s.price }))
    const hFit = fitLine(hPts)
    const lFit = fitLine(lPts)

    if (hFit && lFit && hFit.r2 > 0.35 && lFit.r2 > 0.35) {
      const startX = 0, endX = n - 1
      const upperStart = lineAt(hFit, startX), upperEnd = lineAt(hFit, endX)
      const lowerStart = lineAt(lFit, startX), lowerEnd = lineAt(lFit, endX)
      const widthStart = upperStart - lowerStart
      const widthEnd = upperEnd - lowerEnd
      const converging = widthEnd < widthStart * 0.7 && widthEnd > 0
      // slope normalised to the window's own range — "flat" means flat for THIS asset
      const hSlopeN = (hFit.slope * n) / span
      const lSlopeN = (lFit.slope * n) / span
      const FLAT = 0.12

      const geom = (id, extra = {}) => ({
        id,
        ...CHART_PATTERNS[id],
        confidence: Math.min(0.9, 0.4 + (hFit.r2 + lFit.r2) / 4),
        startTs: t0,
        endTs: tN,
        points: [],
        lines: [
          { from: { ts: t0, price: upperStart }, to: { ts: tN, price: upperEnd }, style: 'trend', label: 'upper' },
          { from: { ts: t0, price: lowerStart }, to: { ts: tN, price: lowerEnd }, style: 'trend', label: 'lower' },
        ],
        ...extra,
      })

      if (converging && Math.abs(hSlopeN) < FLAT && lSlopeN > FLAT) {
        push(geom('ascending_triangle', {
          target: upperEnd + widthStart,
          invalidation: lowerEnd,
          note: `Flat resistance ~${fmtNum(upperEnd)}, lows rising into it.`,
        }))
      } else if (converging && Math.abs(lSlopeN) < FLAT && hSlopeN < -FLAT) {
        push(geom('descending_triangle', {
          target: lowerEnd - widthStart,
          invalidation: upperEnd,
          note: `Flat support ~${fmtNum(lowerEnd)}, highs pressing down.`,
        }))
      } else if (converging && hSlopeN < -FLAT && lSlopeN > FLAT) {
        push(geom('symmetrical_triangle', {
          target: null,
          invalidation: null,
          note: `Compressing: ${fmtNum(widthStart)} wide → ${fmtNum(widthEnd)}.`,
        }))
      } else if (converging && hSlopeN > FLAT && lSlopeN > FLAT) {
        push(geom('rising_wedge', {
          target: lowerStart,
          invalidation: upperEnd,
          note: 'Both rails rising and converging — each push weaker.',
        }))
      } else if (converging && hSlopeN < -FLAT && lSlopeN < -FLAT) {
        push(geom('falling_wedge', {
          target: upperStart,
          invalidation: lowerEnd,
          note: 'Both rails falling and converging — selling decelerating.',
        }))
      } else if (!converging && Math.abs(hSlopeN) < FLAT && Math.abs(lSlopeN) < FLAT) {
        push(geom('rectangle', {
          target: null,
          invalidation: null,
          note: `Range ${fmtNum(lowerEnd)} – ${fmtNum(upperEnd)}.`,
        }))
      } else if (!converging && hSlopeN > FLAT && lSlopeN > FLAT) {
        push(geom('ascending_channel', {
          target: upperEnd,
          invalidation: lowerEnd,
          note: 'Higher highs and higher lows between parallel rails.',
        }))
      } else if (!converging && hSlopeN < -FLAT && lSlopeN < -FLAT) {
        push(geom('descending_channel', {
          target: lowerEnd,
          invalidation: upperEnd,
          note: 'Lower highs and lower lows between parallel rails.',
        }))
      }
    }
  }

  // ── Flags (pole + tight counter-drift) ────────────────────────────────────
  const poleLen = Math.max(3, Math.round(n * 0.25))
  if (n >= poleLen * 2) {
    const pole = bars.slice(0, poleLen)
    const flag = bars.slice(poleLen)
    const poleMove = pole[pole.length - 1].c - pole[0].c
    const flagHi = Math.max(...flag.map(b => b.h))
    const flagLo = Math.min(...flag.map(b => b.l))
    const flagRange = flagHi - flagLo
    const tight = flagRange < Math.abs(poleMove) * 0.5
    if (tight && Math.abs(poleMove) > span * 0.4) {
      const bull = poleMove > 0
      push({
        id: bull ? 'bull_flag' : 'bear_flag',
        ...CHART_PATTERNS[bull ? 'bull_flag' : 'bear_flag'],
        confidence: 0.6,
        startTs: pole[0].t,
        endTs: tN,
        points: [
          { ts: pole[0].t, price: pole[0].c, label: 'pole start' },
          { ts: pole[pole.length - 1].t, price: pole[pole.length - 1].c, label: 'pole top' },
        ],
        lines: [
          { from: { ts: flag[0].t, price: flagHi }, to: { ts: tN, price: flagHi }, style: 'resistance', label: 'flag high' },
          { from: { ts: flag[0].t, price: flagLo }, to: { ts: tN, price: flagLo }, style: 'support', label: 'flag low' },
        ],
        target: bull ? flagHi + Math.abs(poleMove) : flagLo - Math.abs(poleMove),
        invalidation: bull ? pole[0].c : pole[0].c,
        note: `Pole ${fmtPct((poleMove / pole[0].c) * 100)}, flag holding ${fmtNum(flagLo)}–${fmtNum(flagHi)}.`,
      })
    }
  }

  // ── Capitulation & bounce (the Wayfinder shape) ───────────────────────────
  {
    let flushIdx = -1, worst = 0
    for (let i = 1; i < n; i++) {
      const drop = (bars[i].c - bars[i - 1].c) / bars[i - 1].c
      if (drop < worst) { worst = drop; flushIdx = i }
    }
    if (flushIdx > 0 && worst < -0.04 && flushIdx < n - 3) {
      const after = bars.slice(flushIdx)
      const bounce = (after[after.length - 1].c - bars[flushIdx].l) / bars[flushIdx].l
      if (bounce > 0.02) {
        push({
          id: 'capitulation_bounce',
          ...CHART_PATTERNS.capitulation_bounce,
          confidence: 0.55,
          startTs: bars[flushIdx - 1].t,
          endTs: tN,
          points: [{ ts: bars[flushIdx].t, price: bars[flushIdx].l, label: 'flush low' }],
          lines: [{ from: { ts: bars[flushIdx].t, price: bars[flushIdx - 1].c }, to: { ts: tN, price: bars[flushIdx - 1].c }, style: 'neckline', label: 'pre-flush' }],
          target: null,
          invalidation: bars[flushIdx].l,
          note: `Flush ${fmtPct(worst * 100)} then +${fmtPct(bounce * 100)} off ${fmtNum(bars[flushIdx].l)}. Reclaim of ${fmtNum(bars[flushIdx - 1].c)} is what separates reversal from relief.`,
        })
      }
    }
  }

  // Strongest first, and never flood the panel.
  return out.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)).slice(0, 5)
}

/**
 * Candlestick formations on the last `lookback` bars.
 * Returns [{ id, name, bias, definition, ts, index }] newest last.
 */
export function detectCandlePatterns(bars, lookback = 6) {
  const found = []
  if (!Array.isArray(bars) || bars.length < 3) return found
  const n = bars.length
  const start = Math.max(2, n - lookback)

  const body = (b) => Math.abs(b.c - b.o)
  const range = (b) => Math.max(1e-12, b.h - b.l)
  const upper = (b) => b.h - Math.max(b.o, b.c)
  const lower = (b) => Math.min(b.o, b.c) - b.l
  const bull = (b) => b.c > b.o
  const avgBody = avg(bars.slice(Math.max(0, n - 20)).map(body)) || 1e-12

  for (let i = start; i < n; i++) {
    const c = bars[i], p = bars[i - 1], pp = bars[i - 2]
    const hit = (id) => found.push({ id, ...CANDLE_PATTERNS[id], ts: c.t, index: i })

    if (body(c) <= range(c) * 0.1) hit('doji')
    else if (body(c) >= range(c) * 0.9) hit(bull(c) ? 'marubozu_bull' : 'marubozu_bear')

    if (lower(c) >= body(c) * 2 && upper(c) <= body(c) * 0.6 && body(c) > 0) {
      hit(p.c > pp.c ? 'hanging_man' : 'hammer')
    }
    if (upper(c) >= body(c) * 2 && lower(c) <= body(c) * 0.6 && body(c) > 0) {
      hit(p.c < pp.c ? 'inverted_hammer' : 'shooting_star')
    }

    if (bull(c) && !bull(p) && c.c >= p.o && c.o <= p.c && body(c) > body(p)) hit('bullish_engulfing')
    if (!bull(c) && bull(p) && c.c <= p.o && c.o >= p.c && body(c) > body(p)) hit('bearish_engulfing')

    if (body(p) > avgBody && body(c) < body(p) * 0.5) {
      if (!bull(p) && bull(c) && c.o > p.c && c.c < p.o) hit('bullish_harami')
      if (bull(p) && !bull(c) && c.o < p.c && c.c > p.o) hit('bearish_harami')
    }

    if (near(c.l, p.l, range(c) * 0.1)) hit('tweezer_bottom')
    if (near(c.h, p.h, range(c) * 0.1)) hit('tweezer_top')

    if (!bull(p) && bull(c) && c.o < p.c && c.c > (p.o + p.c) / 2 && c.c < p.o) hit('piercing_line')
    if (bull(p) && !bull(c) && c.o > p.c && c.c < (p.o + p.c) / 2 && c.c > p.o) hit('dark_cloud')

    if (body(p) < avgBody * 0.5) {
      if (!bull(pp) && bull(c) && c.c > (pp.o + pp.c) / 2) hit('morning_star')
      if (bull(pp) && !bull(c) && c.c < (pp.o + pp.c) / 2) hit('evening_star')
    }

    if (i >= 2) {
      const three = [pp, p, c]
      if (three.every(b => bull(b) && body(b) > avgBody * 0.6) && c.c > p.c && p.c > pp.c) hit('three_white_soldiers')
      if (three.every(b => !bull(b) && body(b) > avgBody * 0.6) && c.c < p.c && p.c < pp.c) hit('three_black_crows')
    }
  }

  // Dedupe by id keeping the most recent occurrence, cap the list.
  const byId = new Map()
  for (const f of found) byId.set(f.id, f)
  return [...byId.values()].sort((a, b) => a.index - b.index).slice(-5)
}

// ────────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────────

function fmtNum(v) {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (a >= 1) return v.toFixed(2)
  if (a >= 0.01) return v.toFixed(4)
  return v.toPrecision(3)
}

function fmtPct(v) {
  if (!Number.isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

export { fmtNum as formatPatternPrice }
