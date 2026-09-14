/**
 * sr-levels.js — real support/resistance zone detection from OHLCV bars.
 *
 * Replaces the classical-pivot "supply/demand" fallback that applied R1/R2
 * formulas to a whole 50-bar range (which put zones hundreds of dollars away
 * from price). This finds actual swing highs/lows (fractals), clusters them
 * into price zones with an ATR-adaptive tolerance, and scores each zone by
 * touch count + recency — the way levels are actually marked on a chart.
 *
 * Pure functions, no imports. Shared by use-kline-indicators (panel values)
 * and rz-technicals-tab (chart bands), so the numbers on screen always match
 * the bands on the chart.
 *
 * Zone shape:
 *   { low, high, mid, side: 'support'|'resistance', touches, strength,
 *     lastTouch (unix s), kind: 'local'|'major',
 *     flipped   — formed by BOTH swing highs and lows (role reversal seen),
 *     untested  — the side label is unproven: single-touch zones, and zones
 *                 whose swings all formed on the WRONG side for the label
 *                 (e.g. a cluster of swing HIGHS now sitting below price is
 *                 broken resistance, only support once defended from above),
 *     proximityPct — |mid - price| / price * 100 }
 */

// ── ATR (Wilder) — used for adaptive cluster tolerance ─────────────────────
function atr(bars, period = 14) {
  if (!bars || bars.length < period + 1) return null
  const trs = []
  for (let i = 1; i < bars.length; i++) {
    const hl = bars[i].h - bars[i].l
    const hc = Math.abs(bars[i].h - bars[i - 1].c)
    const lc = Math.abs(bars[i].l - bars[i - 1].c)
    trs.push(Math.max(hl, hc, lc))
  }
  let v = trs.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < trs.length; i++) v = (v * (period - 1) + trs[i]) / period
  return v
}

/**
 * Fractal swing points: bar i is a swing high when its high is the strict
 * maximum of the `strength` bars on each side (ties break toward the earlier
 * bar so flat tops still register once).
 * Returns [{ price, t, type: 'high'|'low' }]
 */
export function findSwings(bars, strength = 3) {
  const swings = []
  if (!bars || bars.length < strength * 2 + 1) return swings
  for (let i = strength; i < bars.length - strength; i++) {
    let isHigh = true
    let isLow = true
    for (let j = 1; j <= strength; j++) {
      if (bars[i].h < bars[i - j].h || bars[i].h <= bars[i + j].h) isHigh = false
      if (bars[i].l > bars[i - j].l || bars[i].l >= bars[i + j].l) isLow = false
      if (!isHigh && !isLow) break
    }
    if (isHigh) swings.push({ price: bars[i].h, t: bars[i].t, type: 'high' })
    if (isLow) swings.push({ price: bars[i].l, t: bars[i].t, type: 'low' })
  }
  return swings
}

/**
 * Cluster swing prices into zones. Two swings join the same zone when their
 * prices are within `tolerance` (absolute). A zone's band is the min/max of
 * its member prices, padded to at least `minWidth`.
 */
function clusterSwings(swings, tolerance, minWidth) {
  if (!swings.length) return []
  const sorted = [...swings].sort((a, b) => a.price - b.price)
  const clusters = []
  let current = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    // join while within tolerance of the cluster's running center
    const center = current.reduce((a, s) => a + s.price, 0) / current.length
    if (sorted[i].price - center <= tolerance) {
      current.push(sorted[i])
    } else {
      clusters.push(current)
      current = [sorted[i]]
    }
  }
  clusters.push(current)

  return clusters.map(members => {
    let low = Math.min(...members.map(m => m.price))
    let high = Math.max(...members.map(m => m.price))
    const mid = (low + high) / 2
    if (high - low < minWidth) {
      low = mid - minWidth / 2
      high = mid + minWidth / 2
    }
    return {
      low, high, mid,
      touches: members.length,
      // Every touch's timestamp, so a caller working with a SELECTED window can
      // say how many of these landed inside it instead of reporting a
      // context-wide count as if it described the selection.
      touchTimes: members.map(m => m.t).filter(Number.isFinite).sort((a, b) => a - b),
      lastTouch: Math.max(...members.map(m => m.t || 0)),
      // majority vote on what kind of swings formed it (mixed = level flipped)
      highCount: members.filter(m => m.type === 'high').length,
      lowCount: members.filter(m => m.type === 'low').length,
    }
  })
}

/**
 * Detect S/R zones from bars.
 *
 * opts:
 *   price        — current price (defaults to last close)
 *   strength     — fractal wing size (3 local, 4-5 major)
 *   minTouches   — drop zones with fewer touches (1 local, 2 major)
 *   maxPerSide   — keep the N nearest zones each side of price
 *   kind         — tag written onto each zone ('local' | 'major')
 *   tolerancePct — cluster tolerance as fraction of price (fallback when ATR
 *                  is unavailable); effective tolerance = max(0.5*ATR, pct*price)
 */
export function detectZones(bars, opts = {}) {
  if (!bars || bars.length < 20) return []
  const {
    price = bars[bars.length - 1].c,
    strength = 3,
    minTouches = 1,
    maxPerSide = 3,
    kind = 'local',
    tolerancePct = 0.004,
  } = opts

  const a = atr(bars, 14)
  const tolerance = Math.max(a != null ? a * 0.5 : 0, price * tolerancePct)
  const minWidth = Math.max(price * 0.0015, a != null ? a * 0.25 : 0)

  const swings = findSwings(bars, strength)
  if (!swings.length) return []

  const clusters = clusterSwings(swings, tolerance, minWidth)
  const span = Math.max(1, bars[bars.length - 1].t - bars[0].t)
  const now = bars[bars.length - 1].t

  const zones = clusters
    // ignore the zone price currently sits inside — it's neither S nor R yet
    .filter(z => !(price >= z.low && price <= z.high))
    .map(z => {
      const side = z.mid > price ? 'resistance' : 'support'
      const recency = 1 - Math.min(1, (now - z.lastTouch) / span) // 0..1, 1 = just touched
      // touches dominate; recency and both-sided tests break ties
      const flipped = z.highCount > 0 && z.lowCount > 0
      // Side honesty. A zone made ONLY of swing highs that now sits BELOW price
      // is broken resistance — it only becomes support once a swing LOW forms
      // there (a touch defended from above = role reversal confirmed). The old
      // code labeled it plain "support" and the copy promised buying interest.
      // Mirror case for lows-only clusters above price. Under-tested zones
      // (fewer touches than the caller's minTouches, incl. every single-touch
      // zone) are KEPT but marked, not deleted — the UI qualifies them.
      const wrongSideComposition =
        (side === 'support' && z.highCount > 0 && z.lowCount === 0) ||
        (side === 'resistance' && z.lowCount > 0 && z.highCount === 0)
      const untested = z.touches < Math.max(2, minTouches) || (wrongSideComposition && !flipped)
      const strengthScore = z.touches * 2 + recency + (flipped ? 1 : 0)
      return {
        low: z.low, high: z.high, mid: z.mid,
        side, kind,
        touches: z.touches,
        touchTimes: z.touchTimes,
        lastTouch: z.lastTouch,
        flipped,
        untested,
        highCount: z.highCount,
        lowCount: z.lowCount,
        proximityPct: price > 0 ? Math.round(Math.abs(z.mid - price) / price * 10000) / 100 : null,
        strength: Math.round(strengthScore * 100) / 100,
      }
    })

  // Slot allocation: tested zones claim the maxPerSide slots first so a nearby
  // single-wick (untested) zone can't displace a farther-but-proven level;
  // untested zones only fill leftover slots. Display order stays nearest-first.
  const pickSide = (side, cmp) => {
    const all = zones.filter(z => z.side === side).sort(cmp)
    const tested = all.filter(z => !z.untested)
    const rest = all.filter(z => z.untested)
    return [...tested, ...rest].slice(0, maxPerSide).sort(cmp)
  }
  const res = pickSide('resistance', (x, y) => x.mid - y.mid) // nearest above first
  const sup = pickSide('support', (x, y) => y.mid - x.mid)    // nearest below first

  return [...res, ...sup]
}

/**
 * Full read: local zones from the trading-timeframe bars + major zones from
 * higher-timeframe bars (pass null to derive major from the same series with
 * stricter settings — used when already on 1W).
 *
 * Returns { local: Zone[], major: Zone[], nearest: {support, resistance} }
 * where nearest picks the closest zone per side across BOTH horizons
 * (major wins a tie — a weekly level beats a 4H wick cluster).
 */
export function computeSRLevels(bars, majorBars, price) {
  const p = price ?? (bars?.length ? bars[bars.length - 1].c : null)
  if (!p) return { local: [], major: [], nearest: { support: null, resistance: null } }

  const local = detectZones(bars, {
    price: p, strength: 3, minTouches: 1, maxPerSide: 3, kind: 'local', tolerancePct: 0.004,
  })

  const majorSrc = (majorBars && majorBars.length >= 30) ? majorBars : bars
  const major = detectZones(majorSrc, {
    price: p,
    strength: majorSrc === bars ? 5 : 4,
    minTouches: 2,
    maxPerSide: 2,
    kind: 'major',
    tolerancePct: 0.008,
  })

  const pickNearest = (side) => {
    const pool = [...major, ...local].filter(z => z.side === side)
    if (!pool.length) return null
    // The nearest anchor drives thesis entries/invalidations — never hang it on
    // an untested single-wick zone while a proven level exists on this side.
    const tested = pool.filter(z => !z.untested)
    const candidates = tested.length ? tested : pool
    candidates.sort((x, y) => {
      const dx = Math.abs(x.mid - p)
      const dy = Math.abs(y.mid - p)
      // within 0.75% of each other → prefer the major / more-touched zone
      if (Math.abs(dx - dy) / p < 0.0075) {
        if (x.kind !== y.kind) return x.kind === 'major' ? -1 : 1
        return y.touches - x.touches
      }
      return dx - dy
    })
    return candidates[0]
  }

  return {
    local,
    major,
    nearest: { support: pickNearest('support'), resistance: pickNearest('resistance') },
  }
}
