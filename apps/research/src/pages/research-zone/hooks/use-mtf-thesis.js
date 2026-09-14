/**
 * useMtfThesis — multi-timeframe read for the Trade Thesis.
 *
 * The old thesis reasoned off ONE selected timeframe (the chart TF) and never
 * told you which clock a bullet came from. This hook computes a compact digest
 * on ALL FIVE trading clocks (15m / 1H / 4H / 1D / 1W) and derives a confluence
 * read — are the timeframes stacked in one direction or fighting each other,
 * and where the flip is. Deterministic, no LLM.
 *
 * Reuses the SAME bar fetcher + math primitives as useKlineIndicators, so every
 * series is deduped + TTL-cached + localStorage-seeded (the selected TF, the 1D
 * majors and the 1W outlook are usually already warm — this only adds the two
 * short clocks). Cheap, no new backend.
 *
 * Returns: { mtf: { grid, confluence } | null, loading }
 */
import { useState, useEffect, useMemo } from 'react'
import { fetchSeriesBars, peekSeriesBars, emaSeries, rsiSeries, macd } from './use-kline-indicators'
import { computeSRLevels } from '@/lib/sr-levels'
import { scoreRsi } from '@/lib/indicator-score'
import { detectRegime, regimeLabel, computeVolumeRegime } from '@/lib/ta-regime'

// The five clocks the thesis reasons across. `group` buckets them for the lenses.
export const MTF_TIMEFRAMES = [
  { id: '15M', res: '15',  label: '15m', group: 'scalp' },
  { id: '1H',  res: '60',  label: '1H',  group: 'scalp' },
  { id: '4H',  res: '240', label: '4H',  group: 'swing' },
  { id: '1D',  res: '1D',  label: '1D',  group: 'swing' },
  { id: '1W',  res: '1W',  label: '1W',  group: 'position' },
]

// Per-timeframe digest — trend, momentum, one nearest S/R, a bias + drivers.
// `assetClass` gates the regime read: stocks keep the pre-regime scorer
// semantics bit-identical (equity regime rollout is a later pass).
function digestOne(bars, assetClass = null) {
  if (!bars || bars.length < 30) return null
  const closes = bars.map(b => b.c)
  const price = closes[closes.length - 1]

  const ema200arr = emaSeries(closes, 200)
  const ema200 = ema200arr ? ema200arr[ema200arr.length - 1] : null
  const ema50arr = emaSeries(closes, 50)
  const ema50 = ema50arr ? ema50arr[ema50arr.length - 1] : null
  const rsiArr = rsiSeries(closes, 14)
  const rsi = rsiArr ? rsiArr[rsiArr.length - 1] : null
  const m = macd(closes, 12, 26, 9)
  const sr = computeSRLevels(bars, null, price)

  // Trend reference: EMA200 when the series is long enough, else EMA50 (short
  // clocks / young tokens rarely have 200 bars). null = no trend read.
  const trendRef = ema200 ?? ema50
  const trendPer = ema200 != null ? 200 : ema50 != null ? 50 : null
  const aboveTrend = trendRef != null ? price >= trendRef : null

  // Recent slope (~last 10 bars) — is it moving up or down right now.
  const back = closes[Math.max(0, closes.length - 11)]
  const slopePct = back ? ((price - back) / back) * 100 : null

  // One regime read per clock, shared with the gauge + cases via ta-regime, so
  // a hot RSI is never counted bull here while the gauge badges it bear.
  // NOTE: don't pass `aboveTrend` as higherTfUp — it's this clock's OWN EMA, so
  // it would double-count the EMA vote and let it outvote slope/MACD.
  const regime = assetClass === 'stock' ? null
    : detectRegime({ price, ema50, ema200, slopePct, macdLine: m?.line })

  let bull = 0, bear = 0
  const drivers = []
  if (aboveTrend === true) { bull++; drivers.push(`above ${trendPer} EMA`) }
  else if (aboveTrend === false) { bear++; drivers.push(`below ${trendPer} EMA`) }
  if (m?.line != null) { if (m.line > 0) bull++; else bear++ }
  if (m?.line != null && m?.signal != null) {
    if (m.line > m.signal) { bull++; drivers.push('MACD up') }
    else { bear++; drivers.push('MACD down') }
  }
  // Shared scorer — same RSI semantic as the gauge, list and thesis cases,
  // now regime-aware: a pinned RSI in an uptrend is trend strength (bull),
  // in a range it's a mean-reversion fade (bear). Keeps this matrix from
  // ever contradicting the other surfaces.
  const rsiScore = scoreRsi(rsi, regime)
  if (rsiScore.sig === 'bull') bull++
  else if (rsiScore.sig === 'bear') bear++
  if (rsi != null && (rsi >= 70 || rsi <= 30)) {
    // Surface the extreme WITH its regime read, so "RSI 95" reads as strength
    // in an uptrend and hot in a range — consistently with its vote above.
    drivers.push(regime && (regime.trend === 'up' || regime.priceDiscovery)
      ? `RSI ${rsi.toFixed(0)} strong`
      : rsi >= 70 ? `RSI ${rsi.toFixed(0)} hot` : `RSI ${rsi.toFixed(0)} washed`)
  }

  const diff = bull - bear
  const bias = diff >= 2 ? 'bull' : diff <= -2 ? 'bear' : 'mixed'

  const support = sr?.nearest?.support || null
  const resistance = sr?.nearest?.resistance || null

  return {
    price, ema200, ema50, trendPer, aboveTrend, rsi, macd: m, slopePct,
    regime, regimeLabel: regime ? regimeLabel(regime) : null,
    volumeRegime: assetClass === 'stock' ? null : computeVolumeRegime(bars),
    bull, bear, bias,
    support, resistance,
    supportLow: support ? support.low : null,
    resistanceHigh: resistance ? resistance.high : null,
    drivers: drivers.slice(0, 2),
  }
}

function majorityBias(digests) {
  let bull = 0, bear = 0
  for (const d of digests) { if (d.bias === 'bull') bull++; else if (d.bias === 'bear') bear++ }
  if (bull > bear) return 'bull'
  if (bear > bull) return 'bear'
  return 'mixed'
}

// Turn the five digests into a single confluence read — the "are the clocks
// aligned or fighting" headline traders actually act on.
function buildConfluence(grid) {
  let bull = 0, bear = 0, mixed = 0
  for (const g of grid) {
    if (g.digest.bias === 'bull') bull++
    else if (g.digest.bias === 'bear') bear++
    else mixed++
  }
  const total = grid.length
  const expected = MTF_TIMEFRAMES.length
  // Coverage honesty: how many of the 5 clocks actually had enough history to
  // read. When a young runner only lit up 2-3 clocks, we say so in plain words
  // instead of implying full 5-clock alignment.
  const missing = expected - total
  const coverage = missing > 0 ? ` Only ${total} of ${expected} timeframes have enough history to read yet.` : ''
  // "Aligned" language additionally requires clocks from >= 2 distinct horizon
  // groups (scalp 15m/1H vs swing 4H/1D vs position 1W) — three bullish scalp
  // clocks are one horizon agreeing with itself, not multi-timeframe confluence.
  const groupsPresent = new Set(grid.map(g => g.group))
  const multiHorizon = groupsPresent.size >= 2
  const shortDigests = grid.filter(g => g.id === '15M' || g.id === '1H').map(g => g.digest)
  const longDigests = grid.filter(g => g.id === '1D' || g.id === '1W').map(g => g.digest)
  const shortBias = shortDigests.length ? majorityBias(shortDigests) : null
  const longBias = longDigests.length ? majorityBias(longDigests) : null

  // Plain-English throughout: `alignment` = the pill, `headline` = what's
  // happening, `action` = what it means for the user (the "so what do I do").
  let cls = 'mixed'
  let alignment = 'Timeframes mixed'
  let headline = `No clear direction — ${bull} up, ${bear} down, ${mixed} undecided across the timeframes.`
  let action = 'No clean setup right now. The safer move is to wait for the timeframes to line up before committing — or keep any trade small and quick.'

  if (bull >= total && bull >= 3 && multiHorizon) {
    cls = 'bull'; alignment = 'All timeframes up'
    headline = 'Every timeframe from 15m to 1W is pointing up — the short-term and the big picture agree.'
    action = 'The trend is with the buyers. The lower-risk way in is a pullback toward support, not chasing the highs.'
  } else if (bear >= total && bear >= 3 && multiHorizon) {
    cls = 'bear'; alignment = 'All timeframes down'
    headline = 'Every timeframe from 15m to 1W is pointing down — the short-term and the big picture agree.'
    action = 'The trend is with the sellers. Buying the dip is the risky side here; sellers tend to step back in on rallies toward resistance.'
  } else if ((bull >= total || bear >= total) && total >= 2 && !multiHorizon) {
    const up = bull >= total
    cls = up ? 'bull' : 'bear'
    alignment = 'One time horizon'
    headline = `The reads line up ${up ? 'to the upside' : 'to the downside'}, but only on one time horizon — not a full multi-timeframe confirmation.`
    action = `Treat this as a short-horizon ${up ? 'up' : 'down'} signal, not a high-conviction trend trade.`
  } else if (bull >= 4) {
    cls = 'bull'; alignment = 'Mostly up'
    headline = `${bull} of ${total} timeframes point up — one holdout is the risk to watch.`
    action = 'Momentum favors the upside. Keep an eye on the one timeframe still lagging for the first sign the move is turning.'
  } else if (bear >= 4) {
    cls = 'bear'; alignment = 'Mostly down'
    headline = `${bear} of ${total} timeframes point down — one holdout is the risk to watch.`
    action = 'Momentum favors the downside. Keep an eye on the one timeframe still lagging for the first sign the move is turning.'
  } else if (shortBias === 'bull' && longBias === 'bear') {
    cls = 'mixed'; alignment = 'Bounce vs. the trend'
    headline = 'The short-term timeframes are turning up, but the daily and weekly are still pointing down.'
    action = 'Any bounce here is against the bigger trend — fine for a quick scalp, risky to hold. Wait for the daily or weekly to flip before trusting the upside.'
  } else if (shortBias === 'bear' && longBias === 'bull') {
    cls = 'mixed'; alignment = 'Dip in an uptrend'
    headline = 'The short-term timeframes are pulling back, but the daily and weekly are still pointing up.'
    action = 'This reads as a dip inside an uptrend — the kind of pullback trend-buyers look for, as long as the daily and weekly hold.'
  }

  return { cls, alignment, headline: headline + coverage, action, bull, bear, mixed, total, expected, missing, multiHorizon, shortBias, longBias }
}

export default function useMtfThesis({
  symbol,
  networkId = 1,
  cgId = null,
  binancePair = null,
  barCount = 320,
  assetClass = null,
} = {}) {
  const [barsByTf, setBarsByTf] = useState({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!symbol) { setBarsByTf({}); return }
    let cancelled = false
    const sym = (symbol || '').toUpperCase().split(':')[0]
    const idParams = { symbol: sym, networkId, cgId, binancePair, assetClass }
    setLoading(true)

    // Cold-reload instant paint: hydrate every TF from the cross-session seed
    // that useKlineIndicators already writes, so the matrix computes on mount.
    const seeded = {}
    for (const tf of MTF_TIMEFRAMES) {
      const s = peekSeriesBars({ ...idParams, resolution: tf.res })
      if (s) seeded[tf.id] = s
    }
    // Reset to THIS token's seeds (or empty) unconditionally. Merging onto the
    // previous token's slots let a young token with no 1D/1W seed inherit the
    // prior token's daily/weekly bars, so buildConfluence blended two assets
    // and could print "short-term and big picture agree" across BTC + a runner.
    setBarsByTf(seeded)

    Promise.all(MTF_TIMEFRAMES.map(tf =>
      fetchSeriesBars({ ...idParams, resolution: tf.res, barCount })
        .then(bars => ({ id: tf.id, bars }))
        .catch(() => ({ id: tf.id, bars: null }))
    )).then(results => {
      if (cancelled) return
      const next = {}
      for (const r of results) if (r.bars && r.bars.length) next[r.id] = r.bars
      // Keep any seeded series a fetch failed to replace (stale-while-revalidate).
      setBarsByTf(prev => ({ ...prev, ...next }))
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [symbol, networkId, cgId, binancePair, barCount, assetClass])

  const mtf = useMemo(() => {
    const grid = MTF_TIMEFRAMES
      .map(tf => ({ ...tf, digest: digestOne(barsByTf[tf.id], assetClass) }))
      .filter(x => x.digest)
    if (grid.length < 2) return null
    return { grid, confluence: buildConfluence(grid) }
  }, [barsByTf, assetClass])

  return { mtf, loading }
}
