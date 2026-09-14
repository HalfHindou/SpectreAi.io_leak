/**
 * ta-regime.js — trend/price regime + volume regime for the TA surfaces.
 *
 * WHY THIS EXISTS. The Technicals tab used to hard-code "RSI >= 70 = bear" on
 * the gauge (computeSignals) and in the Bull/Bear cases (buildCases), while
 * the multi-timeframe matrix counted the same RSI >= 55 as a straight BULL
 * vote. Three panels, one RSI value, opposite signs on the same screen.
 *
 * The deeper bug is that "overbought" was read context-free. In a parabolic /
 * price-discovery leg (e.g. $ANSEM, $150k -> $320M) RSI pins 80-100 for the
 * ENTIRE move and price rides the upper Bollinger band the whole way up;
 * fading that is counter-trend and gets you run over. An oscillator extreme
 * means different things in an uptrend vs a range. This module produces the
 * regime read; the shared scorers in lib/indicator-score.js consume it (as an
 * OPTIONAL second arg) so every surface applies the same rule.
 *
 * Sibling of indicator-score.js on purpose — asset-agnostic, so the stocks
 * path can adopt it later without moving files. No imports, no side effects —
 * pure functions. All inputs optional; when regime is unknown the scorers
 * keep their classic behavior.
 */

/**
 * Classify the trend / price regime from whatever a surface can supply.
 * Returns { trend: 'up'|'down'|'range', priceDiscovery, aboveLong, momUp }.
 */
export function detectRegime({
  price = null,
  ema50 = null,
  ema200 = null,
  slopePct = null,
  macdLine = null,
  higherTfUp = null,
  fromAthPct = null,
} = {}) {
  // Prefer the 200 EMA as the trend spine; fall back to the 50 EMA for young
  // series / on-chain runners that don't have 200 bars yet (ema200 === null).
  const longRef = ema200 ?? ema50
  const aboveLong = (price != null && longRef != null) ? price > longRef : null

  // Momentum: recent slope sign if we have it, else the MACD line sign.
  const momUp = slopePct != null ? slopePct > 0
    : (macdLine != null ? macdLine > 0 : null)

  const upVotes = [aboveLong === true, momUp === true, higherTfUp === true].filter(Boolean).length
  const downVotes = [aboveLong === false, momUp === false, higherTfUp === false].filter(Boolean).length

  let trend = 'range'
  // A bullish long-EMA doesn't override a KNOWN-bearish higher timeframe when
  // momentum is unknown — that tie falls through to the vote / to 'range'.
  if (aboveLong === true && momUp !== false && higherTfUp !== false) trend = 'up'
  else if (aboveLong === false && momUp !== true && higherTfUp !== true) trend = 'down'
  else if (upVotes >= 2 && upVotes > downVotes) trend = 'up'
  else if (downVotes >= 2 && downVotes > upVotes) trend = 'down'
  // Young runner with no trend spine yet but clearly ripping: momentum alone.
  else if (aboveLong === null && momUp === true && higherTfUp !== false) trend = 'up'
  else if (aboveLong === null && momUp === false && higherTfUp !== true) trend = 'down'

  // Price discovery: at/near the all-time high and not rolling over. Only asserted
  // when we actually know the ATH distance — never guessed, to avoid over-claiming.
  const priceDiscovery = (fromAthPct != null && fromAthPct >= -3 && trend !== 'down')

  return { trend, priceDiscovery, aboveLong, momUp }
}

/** Short human label for the regime, for headers / qualifiers. */
export function regimeLabel(regime = {}) {
  if (regime.priceDiscovery) return 'price discovery'
  if (regime.trend === 'up') return 'uptrend'
  if (regime.trend === 'down') return 'downtrend'
  return 'range'
}

/**
 * Volume regime from an OHLCV series. Runners on massive volume behave
 * completely differently from low-volume drifts, and no thesis logic read
 * volume at all. This turns the raw `v` on each bar into a participation
 * read the thesis can act on.
 *
 * Returns { rvol, level, trend, trendRatio, note } or null when too few bars.
 *   rvol   — latest CLOSED bar's volume ÷ median of the prior 20 bars (relative volume)
 *   level  — 'surge' | 'elevated' | 'normal' | 'thin'  (how loud right now)
 *   trend  — 'expanding' | 'steady' | 'contracting'    (participation direction)
 */
export function computeVolumeRegime(bars) {
  if (!Array.isArray(bars) || bars.length < 20) return null
  // Clamp dirty feeds: a negative volume must not poison the means. Assumes
  // chronological (oldest→newest) bars, as the indicator pipeline supplies.
  const vols = bars.map(b => Math.max(0, Number(b.v) || 0))
  const n = vols.length
  // Use the last CLOSED bar (n-2) as "now" — the final bar is still forming and
  // its volume is partial, which would understate a live surge.
  const lastClosed = vols[n - 2]
  const base = vols.slice(Math.max(0, n - 22), n - 2) // prior ~20 closed bars
  const sorted = [...base].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] || 0
  const rvol = median > 0 ? lastClosed / median : null
  // A previously-dead book (median 0) that now trades is a surge by definition.
  const wokeFromDead = median === 0 && lastClosed > 0

  // Participation direction: mean of the last 5 closed bars vs the 15 before them.
  const recent = vols.slice(-6, -1)
  const prior = vols.slice(-21, -6)
  const meanR = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0
  const meanP = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : meanR
  const trendRatio = meanP > 0 ? meanR / meanP : (meanR > 0 ? Infinity : 1)
  const trend = (wokeFromDead || trendRatio >= 1.25) ? 'expanding'
    : trendRatio <= 0.8 ? 'contracting' : 'steady'

  let level = 'normal'
  if (wokeFromDead) level = 'surge'
  else if (rvol != null) {
    if (rvol >= 3) level = 'surge'
    else if (rvol >= 1.6) level = 'elevated'
    else if (rvol <= 0.5) level = 'thin'
  }

  const x = rvol != null ? `${rvol.toFixed(1)}× median` : (wokeFromDead ? 'from a dead book' : '— median')
  const note = level === 'surge' ? `Volume surging (${x}), ${trend}`
    : level === 'elevated' ? `Volume elevated (${x}), ${trend}`
    : level === 'thin' ? `Volume thin (${x}), ${trend}`
    : `Volume normal (${x}), ${trend}`

  return { rvol, level, trend, trendRatio, note }
}
