/**
 * indicator-score — ONE semantic per indicator, shared by every TA surface.
 *
 * Before this module the same RSI value was scored three opposite ways on one
 * screen: the MTF matrix counted RSI 85 as a BULL vote (>=55 midline), the
 * signal gauge/list badged it BEAR (>=70 overbought), and the Trade Thesis
 * filed it under the bear case. Three surfaces, same input, opposite signs —
 * the tab argued with itself (RZ TA audit 2026-07-04, issue #1).
 *
 * Canonical semantic: the SIGN of a momentum indicator is its DIRECTION
 * (above/below the 55/45 midline band). An extreme reading (overbought /
 * oversold) is a ZONE QUALIFIER carried alongside the sign, not a sign flip —
 * RSI 85 is bullish momentum that is stretched, not "bearish". Whether an
 * extreme should be faded is a REGIME question (trend vs range) — the
 * OPTIONAL second `regime` arg (from lib/ta-regime.js detectRegime) answers
 * it:
 *   - NO regime passed → EXACTLY the legacy behavior above (the stocks path
 *     calls these single-arg and must stay bit-identical).
 *   - uptrend / price discovery → a hot oscillator is TREND STRENGTH /
 *     band-walk; fading it is counter-trend. Sign stays bull.
 *   - range → classic mean reversion: RSI >= 70 IS a bear signal (deliberate
 *     product decision — in a range, overbought fades).
 *   - downtrend → an oscillator rally is a counter-trend rally (bear); an
 *     oversold print is neutral ("can stay oversold").
 * With a regime the result also carries a human `note` explaining the read.
 *
 * Bollinger position keeps its stretch semantic when regime is unknown
 * (outside the band = counter-directional stretch); with a regime, riding the
 * upper band in an uptrend reads as a band-walk (trend strength), and losing
 * the lower band in a downtrend reads as trend weakness.
 *
 * Used by: computeSignals (rz-technicals-tab), digestOne (use-mtf-thesis),
 * buildCases (rz-trade-thesis), the mobile verdict/copy. Asset-agnostic —
 * crypto and stocks share it.
 */

// Regime shape helpers ({ trend, priceDiscovery } from ta-regime detectRegime).
const isUp = (r) => !!r && (r.trend === 'up' || r.priceDiscovery === true)
const isDown = (r) => !!r && r.trend === 'down'

/** RSI: direction from the 55/45 midline band; zone at 70/30. Regime-aware. */
export function scoreRsi(rsi, regime = null) {
  if (rsi == null || !Number.isFinite(rsi)) return { sig: null, zone: null, note: null }
  const zone = rsi >= 70 ? 'overbought' : rsi <= 30 ? 'oversold' : null
  if (!regime) {
    // Legacy semantic — bit-identical to the pre-regime scorer (stocks path).
    const sig = rsi >= 55 ? 'bull' : rsi <= 45 ? 'bear' : 'neutral'
    return { sig, zone, note: null }
  }
  const v = rsi.toFixed(0)
  if (isUp(regime)) {
    if (rsi >= 70) return { sig: 'bull', zone, note: regime.priceDiscovery
      ? `RSI ${v} — pinned in price discovery; trend strength, not a top`
      : `RSI ${v} — hot but in an uptrend; momentum regime, pullbacks stay shallow — fading is counter-trend` }
    if (rsi >= 50) return { sig: 'bull', zone, note: `RSI ${v} — momentum with the trend` }
    if (rsi <= 30) return { sig: 'bull', zone, note: `RSI ${v} — washed inside an uptrend; a dip, not a top` }
    return { sig: 'neutral', zone, note: `RSI ${v} — cooling pullback in an uptrend` }
  }
  if (isDown(regime)) {
    if (rsi <= 30) return { sig: 'neutral', zone, note: `RSI ${v} — oversold, but it can stay oversold in a downtrend` }
    if (rsi >= 70) return { sig: 'bear', zone, note: `RSI ${v} — overbought into a downtrend; counter-trend rally` }
    if (rsi <= 50) return { sig: 'bear', zone, note: `RSI ${v} — momentum with the downtrend` }
    return { sig: 'neutral', zone, note: `RSI ${v} — weak bounce in a downtrend` }
  }
  // range / unknown trend → classic mean reversion (overbought fades)
  if (rsi >= 70) return { sig: 'bear', zone, note: `RSI ${v} — overbought in a range, upside stretched` }
  if (rsi <= 30) return { sig: 'bull', zone, note: `RSI ${v} — oversold in a range, downside stretched` }
  if (rsi >= 55) return { sig: 'bull', zone, note: `RSI ${v} — momentum leaning bullish` }
  if (rsi <= 45) return { sig: 'bear', zone, note: `RSI ${v} — momentum leaning bearish` }
  return { sig: 'neutral', zone, note: `RSI ${v} — balanced` }
}

/** Stochastic RSI %K: direction from 55/45; zone at 80/20. Regime-aware. */
export function scoreStoch(k, regime = null) {
  if (k == null || !Number.isFinite(k)) return { sig: null, zone: null, note: null }
  const zone = k >= 80 ? 'overbought' : k <= 20 ? 'oversold' : null
  if (!regime) {
    const sig = k >= 55 ? 'bull' : k <= 45 ? 'bear' : 'neutral'
    return { sig, zone, note: null }
  }
  if (isUp(regime)) {
    if (k >= 80) return { sig: 'bull', zone, note: 'Stoch RSI hot with the uptrend — band-walk, not a top' }
    if (k <= 20) return { sig: 'bull', zone, note: 'Stoch RSI reset inside an uptrend — a dip' }
    return { sig: k >= 50 ? 'bull' : 'neutral', zone, note: null }
  }
  if (isDown(regime)) {
    if (k <= 20) return { sig: 'neutral', zone, note: 'Stoch RSI washed in a downtrend — can stay washed' }
    if (k >= 80) return { sig: 'bear', zone, note: 'Stoch RSI overbought into a downtrend — counter-trend rally' }
    return { sig: k <= 50 ? 'bear' : 'neutral', zone, note: null }
  }
  if (k >= 80) return { sig: 'bear', zone, note: 'Stoch RSI overbought in a range — mean-reversion risk' }
  if (k <= 20) return { sig: 'bull', zone, note: 'Stoch RSI oversold in a range — snap-back risk' }
  if (k >= 55) return { sig: 'bull', zone, note: null }
  if (k <= 45) return { sig: 'bear', zone, note: null }
  return { sig: 'neutral', zone, note: null }
}

/** MACD: line sign = momentum direction; line vs signal = cross; histogram sign. */
export function scoreMacd(macd) {
  const ml = macd?.line
  const ms = macd?.signal
  const mh = macd?.histogram
  return {
    lineSig: ml == null ? null : Math.abs(ml) < 1e-9 ? 'neutral' : ml > 0 ? 'bull' : 'bear',
    crossSig: (ml == null || ms == null) ? null : ml > ms ? 'bull' : 'bear',
    histSig: mh == null ? null : Math.abs(mh) < 1e-6 ? 'neutral' : mh > 0 ? 'bull' : 'bear',
  }
}

/** Bollinger position: inside = neutral; outside = stretch — unless the regime
 *  says it's a band-walk (uptrend above upper) / trend weakness (downtrend
 *  below lower). */
export function scoreBb(price, bb, regime = null) {
  if (!bb || !Number.isFinite(price) || price <= 0) return { sig: null, position: null, note: null }
  if (price > bb.upper) {
    if (isUp(regime)) {
      return { sig: 'bull', position: 'above-upper', note: 'Riding the upper Bollinger band — trend strength, not overextension' }
    }
    return { sig: 'bear', position: 'above-upper', note: regime ? 'Price above the upper Bollinger band — statistically stretched up' : null }
  }
  if (price < bb.lower) {
    if (isDown(regime)) {
      return { sig: 'bear', position: 'below-lower', note: 'Losing the lower Bollinger band — trend weakness' }
    }
    return { sig: 'bull', position: 'below-lower', note: regime ? 'Price below the lower Bollinger band — statistically stretched down' : null }
  }
  return { sig: 'neutral', position: 'inside', note: null }
}

/** Human caveat for an extreme zone — the qualifier every surface appends. */
export function zoneCaveat(zone) {
  if (zone === 'overbought') return 'stretched — chase risk, pullbacks likely shallow in trend'
  if (zone === 'oversold') return 'washed out — snap-back risk for late shorts'
  return null
}
