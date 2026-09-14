/**
 * derivedMetrics.js — client-side score formulas for the AI Intelligence
 * Card. Every score below is computed from data the page already has —
 * no fabricated inputs, no new API calls.
 *
 * Returns:
 *   - liquidityHealth({ liquidity, marketCap })      → { ratio, grade, verdict, color, score 0..100 }
 *   - momentumScore({ change5m, change1h, change6h, change24h }) → 0..100
 *   - holderTrustScore({ holderHistory14d, top10Pct, currentHolders, priorHolders }) → { score, limited }
 *   - sentimentScore({ momentum, buyVol, sellVol, hourlyVolumes, liquidityGrade }) → 0..100
 *   - deriveCallouts(allScores + raw)                → { strengths: string[], risks: string[] }
 *   - scoreVerdict(score 0..100)                     → 'Bullish' | 'Neutral' | 'Bearish'
 *
 * All inputs are tolerant of nulls / NaN / undefined — every function
 * returns a numeric score or a degraded "limited" form. Nothing throws.
 */

// --- Liquidity Health -------------------------------------------------------

/** ratio bands → letter grade + one-word verdict + color token */
export function liquidityHealth({ liquidity, marketCap }) {
  const ratio = marketCap > 0 ? (Number(liquidity) || 0) / Number(marketCap) : 0
  let grade = 'F'
  let verdict = 'Risky'
  let color = 'var(--down)'
  let score = 0
  if (ratio >= 0.10)      { grade = 'A'; verdict = 'Deep';     color = 'var(--accent)';  score = 92 }
  else if (ratio >= 0.05) { grade = 'B'; verdict = 'Healthy';  color = 'var(--accent)';  score = 78 }
  else if (ratio >= 0.02) { grade = 'C'; verdict = 'Moderate'; color = '#F59E0B';      score = 58 }
  else if (ratio >= 0.005){ grade = 'D'; verdict = 'Thin';     color = 'var(--down)';  score = 32 }
  else                    { grade = 'F'; verdict = 'Risky';    color = 'var(--down)';  score = 14 }
  return { ratio, grade, verdict, color, score }
}

// --- Momentum ---------------------------------------------------------------

function clip(v, range = 25) {
  if (v == null || isNaN(v)) return 0
  return Math.max(-range, Math.min(range, Number(v)))
}

/**
 * Multi-timeframe price change blend, clipped to ±25%, re-centered on 50.
 * Returns 0..100 where 50 = neutral.
 */
export function momentumScore({ change5m, change1h, change6h, change4h, change24h }) {
  const c1h = clip(change1h)
  const c6h = clip(change6h != null ? change6h : change4h)
  const c24 = clip(change24h)
  const c5m = clip(change5m)
  const m = (0.40 * c1h) + (0.30 * c6h) + (0.20 * c24) + (0.10 * c5m)
  return Math.max(0, Math.min(100, 50 + (m / 25) * 50))
}

// --- Holder Trust -----------------------------------------------------------

/**
 * Holder Trust = 0.5 * holderGrowthScore + 0.5 * distributionScore.
 * holderHistory14d / top10Pct unlock under §II.9 backend addition.
 * Until they're available we degrade transparently with limited=true.
 */
export function holderTrustScore({
  holderHistory14d,    // array of 14 daily snapshots, oldest first
  top10Pct,            // 0..1 share of supply held by top 10
  currentHolders,
  priorHolders,        // fallback: last fetch's count
}) {
  let limited = false
  let growthScore = 50

  if (Array.isArray(holderHistory14d) && holderHistory14d.length >= 7) {
    const first = holderHistory14d[0] || 1
    const last = holderHistory14d[holderHistory14d.length - 1] || first
    const weeklyGrowthRate = (last - first) / first / (holderHistory14d.length / 7)
    if (weeklyGrowthRate >= 0.05) growthScore = 90
    else if (weeklyGrowthRate >= 0.01) growthScore = 70
    else if (weeklyGrowthRate >= -0.01) growthScore = 50
    else if (weeklyGrowthRate >= -0.05) growthScore = 30
    else growthScore = 10
  } else if (currentHolders != null && priorHolders != null && priorHolders > 0) {
    const delta = (currentHolders - priorHolders) / priorHolders
    if (delta >= 0.03) growthScore = 75
    else if (delta >= 0) growthScore = 55
    else if (delta >= -0.03) growthScore = 40
    else growthScore = 20
    limited = true
  } else {
    growthScore = 50
    limited = true
  }

  let distScore = 50
  if (typeof top10Pct === 'number' && top10Pct >= 0) {
    distScore = Math.max(0, 100 - Math.min(100, top10Pct * 100))
  } else {
    limited = true
  }

  const score = limited && top10Pct == null ? growthScore : 0.5 * growthScore + 0.5 * distScore
  return { score: Math.round(score), limited, growthScore, distScore }
}

// --- Sentiment --------------------------------------------------------------

/**
 * Sentiment composite drives the NeedleGauge.
 *   0.35 momentum + 0.35 buy/sell volume ratio + 0.20 volume trend
 *     + 0.10 liquidity health
 *
 *   buyVolPct / sellVolPct: 0..1 over most recent ~200 trades
 *   hourlyVolumes: array of last-N hourly volumes (oldest first)
 *   liquidityHealthScore: 0..100 from liquidityHealth().score
 */
export function sentimentScore({
  momentum,            // 0..100
  buyVol,              // USD
  sellVol,             // USD
  hourlyVolumes,       // number[]
  liquidityHealthScore,
}) {
  // buy/sell volume ratio re-centered on 50
  let buySellScore = 50
  const totalVol = (Number(buyVol) || 0) + (Number(sellVol) || 0)
  if (totalVol > 0) {
    const ratio = (Number(buyVol) || 0) / totalVol  // 0..1
    buySellScore = ratio * 100
  }

  // volume trend = current hour vs trailing avg
  let volumeTrendScore = 50
  if (Array.isArray(hourlyVolumes) && hourlyVolumes.length >= 4) {
    const last = hourlyVolumes[hourlyVolumes.length - 1] || 0
    const tail = hourlyVolumes.slice(-7, -1)
    const avg = tail.reduce((s, v) => s + (v || 0), 0) / (tail.length || 1)
    if (avg > 0) {
      const ratio = last / avg
      if (ratio >= 1.5)      volumeTrendScore = 85
      else if (ratio >= 1.1) volumeTrendScore = 65
      else if (ratio >= 0.9) volumeTrendScore = 50
      else if (ratio >= 0.6) volumeTrendScore = 35
      else                   volumeTrendScore = 20
    }
  }

  const score =
    0.35 * (Number(momentum) || 50) +
    0.35 * buySellScore +
    0.20 * volumeTrendScore +
    0.10 * (Number(liquidityHealthScore) || 50)

  return Math.max(0, Math.min(100, score))
}

// --- Verdict band -----------------------------------------------------------

export function scoreVerdict(score) {
  const v = Number(score) || 0
  if (v < 35) return 'Bearish'
  if (v <= 65) return 'Neutral'
  return 'Bullish'
}

// --- Callouts (Strengths / Risks) -------------------------------------------

/**
 * Walk the same thresholds in one pass and emit chip strings.
 * Pure — easy to test, easy to grow.
 */
export function deriveCallouts({
  liquidityHealth: lh,      // { ratio, grade }
  momentum,                 // 0..100
  holderTrust,              // { score, limited }
  sentiment,                // 0..100
  holderGrowthRate,         // optional, decimal (e.g. 0.04 = 4%/week)
  top10Pct,                 // optional, 0..1
  hourlyVolumeTrend,        // optional, 'rising' | 'falling' | null
}) {
  const strengths = []
  const risks = []

  // Liquidity
  if (lh?.ratio >= 0.05) strengths.push('Deep liquidity')
  if (lh?.ratio < 0.01 && lh?.ratio > 0) risks.push('Thin liquidity')

  // Momentum
  if (momentum >= 70) strengths.push('Strong momentum')
  if (momentum <= 30) risks.push('Negative momentum')

  // Holders
  if (typeof holderGrowthRate === 'number') {
    if (holderGrowthRate >= 0.03) strengths.push('Holders rising')
    if (holderGrowthRate <= -0.03) risks.push('Holders shrinking')
  }
  if (typeof top10Pct === 'number') {
    if (top10Pct >= 0.5) risks.push('High concentration')
    if (top10Pct <= 0.20) strengths.push('Well distributed')
  }

  // Volume trend
  if (hourlyVolumeTrend === 'rising') strengths.push('Volume rising')
  if (hourlyVolumeTrend === 'falling') risks.push('Volume cooling')

  // Sentiment
  if (sentiment >= 75) strengths.push('Buy-side dominant')
  if (sentiment <= 25) risks.push('Sell-side pressure')

  // Holder Trust — only emit if not limited (otherwise the chip would be noisy)
  if (holderTrust && !holderTrust.limited) {
    if (holderTrust.score >= 75) strengths.push('Trusted holders')
    if (holderTrust.score <= 30) risks.push('Holder risk')
  }

  return { strengths, risks }
}
