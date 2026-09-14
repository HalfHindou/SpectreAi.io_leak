/**
 * Trade Thesis — Technicals tab.
 *
 * Reads across ALL FIVE clocks (15m / 1H / 4H / 1D / 1W), not one. Every bullet
 * names the timeframe it came from, a confluence read says whether the clocks
 * agree, and — for thin microcaps — the thesis factors liquidity, transfer tax
 * and holder structure into what a "level" even means. A deep-drawdown token
 * that's turning up gets fused with the project's vitality (is the team still
 * shipping?) into an explicit recovery-vs-dead-cat read. Deterministic
 * composition, no LLM, identical dev/prod.
 */
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import SectionShell from './rz-pro-sections/section-shell'
import SpectreLoader from '@/components/spectre-loader'
import { scoreRsi, scoreStoch, scoreBb } from '@/lib/indicator-score'
import { daysUntil } from '@/lib/earnings-countdown'
import './rz-trade-thesis.css'

// Long-term source label per selected chart TF (mirrors majorResolutionFor)
const LT_LABEL = { '15M': '1D', '1H': '1D', '4H': '1D', '1D': '1W', '1W': '1W' }
const BIAS_LABEL = { bull: 'Up', bear: 'Down', mixed: 'Mixed' }

// Turn the raw indicator shorthand the digest emits ("above 200 EMA", "MACD
// up", "RSI 82 hot") into words a non-trader reads at a glance. The matrix is
// the first thing users see, so it must not speak in ticker-tape jargon.
function humanizeDriver(d) {
  if (!d) return d
  if (/^MACD up$/i.test(d)) return 'momentum up'
  if (/^MACD down$/i.test(d)) return 'momentum down'
  const ema = d.match(/^(above|below)\s+\d+\s+EMA$/i)
  if (ema) return `${ema[1].toLowerCase()} trend`
  const rsi = d.match(/^RSI\s+\d+\s+(strong|hot|washed)$/i)
  if (rsi) {
    const k = rsi[1].toLowerCase()
    return k === 'strong' ? 'strong momentum' : k === 'hot' ? 'overbought' : 'oversold'
  }
  return d
}

function fmtCompactUsd(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${Math.round(v)}`
}
function fmtCount(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(Math.round(v))
}

// TF-tagged bull/bear cases. Each bullet carries the clock it was measured on so
// the panel can never show an unlabeled "on this timeframe" line again.
function buildCases(ind, fmt, timeframe, ltLabel) {
  const price = ind.price
  const bull = []
  const bear = []
  const lt = ind.longTerm
  const push = (arr, tf, text) => arr.push({ tf, text })
  // Regime comes from the same indicators object every surface reads (null on
  // the stocks path, which keeps its pre-regime semantics untouched).
  const regime = ind.regime || null
  const discovery = !!regime?.priceDiscovery

  // Trend
  if (ind.ema200 != null) {
    push(price >= ind.ema200 ? bull : bear, timeframe,
      `Price ${price >= ind.ema200 ? 'above' : 'below'} the 200 EMA (${fmt(ind.ema200)})`)
  }
  if (lt?.aboveEma200 != null) {
    push(lt.aboveEma200 ? bull : bear, ltLabel,
      `Higher-timeframe trend ${lt.aboveEma200 ? 'up' : 'down'} — ${lt.aboveEma200 ? 'above' : 'below'} the long 200 EMA`)
  }

  // Momentum
  const ml = ind.macd?.line
  const ms = ind.macd?.signal
  if (ml != null && ms != null) {
    push(ml > ms ? bull : bear, timeframe, `MACD ${ml > ms ? 'above' : 'below'} signal — ${ml > ms ? 'bullish' : 'bearish'} cross in place`)
  }
  if (ind.rsi != null) {
    // Shared scorer, regime-aware: a hot RSI in an uptrend reads as trend
    // strength (bull) here exactly as it does on the gauge and the MTF matrix;
    // in a range it's the mean-reversion fade. RSI 85 used to sit in the bear
    // case while the matrix above counted it bullish — same value, opposite
    // signs on one screen.
    const rs = scoreRsi(ind.rsi, regime)
    if (regime && rs.note) {
      if (rs.sig === 'bull') push(bull, timeframe, rs.note)
      else if (rs.sig === 'bear') push(bear, timeframe, rs.note)
    } else {
      // No regime (stocks) — legacy sign+zone copy, unchanged.
      if (rs.zone === 'overbought') push(bull, timeframe, `RSI ${ind.rsi.toFixed(0)} — momentum strong but overbought; chase risk, expect shallow pullbacks`)
      else if (rs.zone === 'oversold') push(bear, timeframe, `RSI ${ind.rsi.toFixed(0)} — momentum washed out (oversold); snap-back risk for late shorts`)
      else if (rs.sig === 'bull') push(bull, timeframe, `RSI ${ind.rsi.toFixed(0)} — momentum leaning bullish`)
      else if (rs.sig === 'bear') push(bear, timeframe, `RSI ${ind.rsi.toFixed(0)} — momentum leaning bearish`)
    }
  }
  if (lt?.macdCross) {
    push(lt.macdCross === 'bullish' ? bull : bear, ltLabel, `Long-timeframe MACD cross is ${lt.macdCross}`)
  }

  // Structure / levels — untested zones say what they are (a single-tested
  // wick cluster / broken level) instead of promising defended structure.
  if (ind.demand) {
    push(bull, timeframe, ind.demand.untested
      ? `Support ${fmt(ind.demand.low)}–${fmt(ind.demand.high)} below — untested (${ind.demand.touches === 1 ? 'single touch' : 'broken resistance, not yet defended'})`
      : `Support ${fmt(ind.demand.low)}–${fmt(ind.demand.high)} below${ind.demand.touches ? ` (held ×${ind.demand.touches})` : ''}`)
  }
  if (ind.supply) {
    push(bear, timeframe, ind.supply.untested
      ? `Resistance ${fmt(ind.supply.low)}–${fmt(ind.supply.high)} overhead — untested (${ind.supply.touches === 1 ? 'single touch' : 'broken support, not yet rejected from below'})`
      : `Resistance ${fmt(ind.supply.low)}–${fmt(ind.supply.high)} overhead${ind.supply.touches ? ` (rejected ×${ind.supply.touches})` : ''}`)
  }
  if (ind.majorSupport && (!ind.demand || ind.majorSupport.low !== ind.demand.low)) {
    push(bull, ltLabel, `Major support at ${fmt(ind.majorSupport.low)}–${fmt(ind.majorSupport.high)}`)
  }
  if (ind.majorResistance && (!ind.supply || ind.majorResistance.low !== ind.supply.low)) {
    push(bear, ltLabel, `Major resistance at ${fmt(ind.majorResistance.low)}–${fmt(ind.majorResistance.high)}`)
  }

  // Bands — regime-aware: riding the upper band in an uptrend is a band-walk
  // (trend strength), not an automatic short.
  if (ind.bb && price) {
    const bs = scoreBb(price, ind.bb, regime)
    if (regime && bs.note) {
      if (bs.sig === 'bull') push(bull, timeframe, bs.note)
      else if (bs.sig === 'bear') push(bear, timeframe, bs.note)
    } else {
      if (price < ind.bb.lower) push(bull, timeframe, 'Price below the lower Bollinger band — statistically stretched down')
      else if (price > ind.bb.upper) push(bear, timeframe, 'Price above the upper Bollinger band — statistically stretched up')
    }
  }

  // Volume regime — the "runner on massive volume ≠ low-volume drift" read.
  // A move on expanding volume is participation; a rising price on drying-up
  // volume is a thinning move; a surge means levels are breakable, not fade points.
  const vr = ind.volumeRegime
  if (vr && regime) {
    const up = regime.trend === 'up' || regime.priceDiscovery
    const down = regime.trend === 'down'
    if (up && vr.level === 'surge') {
      push(bull, timeframe, `${vr.note} — high-participation breakout; treat levels as breakable, not fade candidates`)
    } else if (up && vr.trend === 'expanding') {
      push(bull, timeframe, `${vr.note} — real participation confirms the move, not a low-volume drift`)
    } else if (up && vr.trend === 'contracting') {
      push(bear, timeframe, 'Price rising on contracting volume — the move is thinning out; watch for exhaustion')
    } else if (down && vr.level === 'surge') {
      push(bear, timeframe, `${vr.note} — a volume surge into a downtrend is distribution/capitulation, not a bottom`)
    } else if (!up && vr.level === 'thin') {
      push(bear, timeframe, `${vr.note} — low participation; levels are unreliable and prone to slippage`)
    }
  }

  // Price discovery — no overhead resistance exists, so targets and risk come
  // from projection + trailing structure, not from a resistance band.
  let discoveryTargets = null
  if (discovery) {
    // 1.272 / 1.618 fib extension of the last impulse: nearest defended support
    // (impulse base) → current high. Only projected when a real base exists —
    // never fabricated.
    const base = ind.demand ? (ind.demand.low + ind.demand.high) / 2 : (ind.majorSupport ? (ind.majorSupport.low + ind.majorSupport.high) / 2 : null)
    if (base != null && price > base) {
      const leg = price - base
      discoveryTargets = { ext1272: base + leg * 1.272, ext1618: base + leg * 1.618 }
    }
    push(bull, timeframe, `No overhead resistance — price discovery. Risk manages off trailing structure and the prior breakout level; targets are measured-move / fib extensions${discoveryTargets ? ` (1.272× ${fmt(discoveryTargets.ext1272)} · 1.618× ${fmt(discoveryTargets.ext1618)} of the last impulse)` : ' — no clean impulse base to project from yet'}`)
  }

  // Invalidation: the level where each case is wrong
  const bullStop = ind.demand?.low ?? ind.majorSupport?.low ?? null
  const bearStop = ind.supply?.high ?? ind.majorResistance?.high ?? null

  // In price discovery there is no resistance to "close above" — the bear case
  // activates on a loss of trailing structure instead of dangling a null.
  const bearInvalidation = bearStop != null
    ? `Bear case weakens on a close above ${fmt(bearStop)}`
    : discovery
      ? (bullStop != null
        ? `Price discovery — no overhead level to reclaim. The bear case only activates on a loss of trailing structure: a close below ${fmt(bullStop)} (prior breakout / nearest support)`
        : 'Price discovery — no overhead level to reclaim. The bear case only activates when trailing structure breaks; manage risk with a trailing stop under the last impulse')
      : null

  return {
    bull, bear,
    discovery,
    discoveryTargets,
    bullInvalidation: bullStop != null ? `Bull case weakens on a close below ${fmt(bullStop)}` : null,
    bearInvalidation,
  }
}

function biasFrom(bullPts, bearPts) {
  if (!bullPts && !bearPts) return { label: 'No read', cls: 'neutral' }
  const diff = bullPts - bearPts
  if (diff >= 2) return { label: 'Bullish', cls: 'bull' }
  if (diff <= -2) return { label: 'Bearish', cls: 'bear' }
  return { label: 'Mixed', cls: 'neutral' }
}

// Majority bias of a set of TF ids from the MTF grid.
function groupBias(mtf, ids) {
  if (!mtf?.grid) return null
  const ds = mtf.grid.filter(g => ids.includes(g.id)).map(g => g.digest)
  if (!ds.length) return null
  let bull = 0, bear = 0
  for (const d of ds) { if (d.bias === 'bull') bull++; else if (d.bias === 'bear') bear++ }
  if (bull > bear) return { label: 'Bullish', cls: 'bull' }
  if (bear > bull) return { label: 'Bearish', cls: 'bear' }
  return { label: 'Mixed', cls: 'neutral' }
}

// Micro-structure caveats — the ".36–.38 is a hair-thin band, 5% tax" fix. Only
// surfaces for thin/microcap tokens; changes what a "level" means and whether a
// scalp is even viable.
function buildMicrocap(ms, ind, fmt) {
  if (!ms || (!ms.isSmallCap && !ms.isOnchain)) return null
  const points = []
  const totalTax = (Number(ms.buyTax) || 0) + (Number(ms.sellTax) || 0)

  if (ms.mcapLabel || ms.classLabel) {
    // Lead with the real market-class read (classifyToken) when available —
    // "Memecoin · Micro Cap ($3.5M)" says more than a bare dollar figure.
    const lead = ms.classLabel ? `${ms.classLabel}${ms.mcapLabel ? ` (${ms.mcapLabel})` : ''}` : `${ms.mcapLabel} cap`
    points.push({ text: `${lead} — flows, wallets and liquidity events lead price at this size. Read the chart as context, not as triggers.` })
  }
  if (totalTax > 0) {
    points.push({
      danger: totalTax >= 8,
      text: `${(Number(ms.buyTax) || 0).toFixed(0)}%/${(Number(ms.sellTax) || 0).toFixed(0)}% buy/sell tax — a round-trip costs ~${totalTax.toFixed(0)}%. A trade has to clear +${totalTax.toFixed(0)}% just to break even, so scalps are structurally negative-EV. Size for swings and positions, not flips.`,
    })
  }
  if (ms.liquidity != null && ms.liquidity > 0) {
    points.push({ text: `${fmtCompactUsd(ms.liquidity)} liquidity — support and resistance here are soft. A single large order can clear a level in one candle, so trade zones, not lines.` })
  }
  // Band tightness: nearest support-to-resistance gap vs price.
  if (ind?.demand && ind?.supply && ind.price) {
    const bandPct = ((ind.supply.low - ind.demand.high) / ind.price) * 100
    if (bandPct > 0 && bandPct < 8) {
      points.push({ text: `The support→resistance band spans only ~${bandPct.toFixed(1)}% — that's inside a single large candle at this liquidity. One buy or sell flips it; don't anchor a thesis to a level this tight.` })
    }
  }
  if (ms.holders != null && ms.holders > 0) {
    points.push({ text: `${fmtCount(ms.holders)} holders${ms.holders < 500 ? ' — concentrated; a top wallet can set the mark.' : '.'}` })
  }
  if (ms.isHoneypot) {
    points.push({ danger: true, text: 'Honeypot flag raised — treat every bullish signal as untradeable until it clears.' })
  }
  if (!points.length) return null

  const scalpKilled = totalTax >= 6 || (ms.liquidity != null && ms.liquidity > 0 && ms.liquidity < 50_000)
  return { points, scalpKilled }
}

// Equity structure — the stock counterpart of the microcap block. Same slot,
// equity-native facts: cap band, real dollar turnover, beta, 52-week position
// and — the equity "honeypot warning" — earnings-gap proximity. No DEX/tax/
// holder language ever reaches a stock thesis.
const EQUITY_BANDS = [
  [200e9, 'Mega cap', 'index-anchored; levels respect passive flows and index rebalances'],
  [10e9, 'Large cap', 'deep books — technical levels are comparatively reliable here'],
  [2e9, 'Mid cap', 'decent depth, but single institutional prints can move the tape'],
  [300e6, 'Small cap', 'wider spreads and news gaps — treat levels as zones, not lines'],
  [0, 'Micro cap', 'thin books and gap risk dominate — chart structure is context, not triggers'],
]

function buildEquityStructure(ms, ind, fmt) {
  if (!ms || ms.assetClass !== 'stock') return null
  const points = []
  const mcap = Number(ms.mcap) || null

  if (mcap) {
    const [, label, read] = EQUITY_BANDS.find(([floor]) => mcap >= floor) || EQUITY_BANDS[EQUITY_BANDS.length - 1]
    points.push({ text: `${label} (${fmtCompactUsd(mcap)}) — ${read}.` })
  }
  const price = Number(ms.price) || Number(ind?.price) || null
  const avgVolUsd = (Number(ms.avgVolumeShares) && price) ? ms.avgVolumeShares * price : null
  if (avgVolUsd) {
    points.push({ text: `~${fmtCompactUsd(avgVolUsd)} average daily turnover — ${avgVolUsd < 20e6 ? 'thin; size positions to the book, not the thesis' : 'liquid enough that levels reflect real order flow'}.` })
  }
  if (Number.isFinite(Number(ms.beta)) && ms.beta != null) {
    const b = Number(ms.beta)
    points.push({ text: `Beta ${b.toFixed(2)} vs the market — ${b >= 1.5 ? 'high-beta name; index moves get amplified here, size accordingly' : b <= 0.7 ? 'defensive profile; the tape moves slower than the index' : 'moves roughly with the index'}.` })
  }
  if (price && Number(ms.week52High) > 0 && Number(ms.week52Low) > 0 && ms.week52High > ms.week52Low) {
    const pos = ((price - ms.week52Low) / (ms.week52High - ms.week52Low)) * 100
    const clamped = Math.max(0, Math.min(100, pos))
    points.push({ text: `${clamped.toFixed(0)}% through the 52-week range (${fmt(ms.week52Low)} – ${fmt(ms.week52High)})${clamped >= 95 ? ' — at highs: no overhead supply, risk manages off trailing structure' : clamped <= 10 ? ' — at lows: falling-knife territory until a base forms' : ''}.` })
  }

  // Analyst consensus — the Street's read next to the tape's read.
  if (Number(ms.targetMeanPrice) > 0 && price) {
    const upside = ((ms.targetMeanPrice - price) / price) * 100
    const rec = (ms.recommendationKey || '').replace(/_/g, ' ')
    points.push({
      text: `Street consensus${rec ? ` ${rec.toUpperCase()}` : ''}${ms.analystCount ? ` (${ms.analystCount} analysts)` : ''} — mean target ${fmt(ms.targetMeanPrice)}, ${upside >= 0 ? '+' : ''}${upside.toFixed(1)}% vs price. ${upside <= -10 ? 'Price runs ahead of the Street — momentum is carrying more than the fundamental case.' : upside >= 15 ? 'Analysts see meaningful upside — a technical base here has fundamental backing.' : 'Price sits near the Street’s fair-value band.'}`,
    })
  }

  // Earnings proximity — the binary-gap event technicals cannot price.
  let earningsSoon = false
  if (ms.earningsDate) {
    const days = daysUntil(ms.earningsDate)
    if (days >= 0 && days <= 14) {
      earningsSoon = days <= 7
      points.push({
        danger: days <= 7,
        text: `Earnings in ${days === 0 ? 'under a day' : `${days} day${days === 1 ? '' : 's'}`} — binary gap risk. Levels and stops don't protect through a print; sizing down or waiting for the reaction is the standard play.`,
      })
    }
  }

  if (!points.length) return null
  return { points, scalpKilled: false, earningsSoon, isEquity: true }
}

// Deep-drawdown recovery read, fused with project vitality. This is the
// "rebounding from lows, -97% ATH but moving = good buy IF the team is shipping"
// case — a turning chart alone is a dead-cat; a turning chart + a live project
// is accumulation.
function buildRebound(ind, mtf, ms, vitality, fmt) {
  const fromAth = ms?.fromAthPct ?? ind?.outlook?.fromCycleHighPct ?? null
  if (fromAth == null || fromAth > -70) return null // only for real drawdowns

  const shortUp = !!mtf?.grid?.some(g =>
    (g.id === '15M' || g.id === '1H') &&
    (g.digest.bias === 'bull' || (g.digest.slopePct != null && g.digest.slopePct > 1)))
  const momoUp = ind?.macd?.histogram != null && ind.macd.histogram > 0
  const rsiOffFloor = ind?.rsi != null && ind.rsi > 32
  const turning = (shortUp || momoUp) && rsiOffFloor

  const vitUp = vitality?.level === 'up'
  const vitDown = vitality?.level === 'down'
  const cats = vitality?.catalysts || 0
  const reclaim = ind?.supply?.low ?? ind?.majorResistance?.low ?? null
  const reclaimClause = reclaim != null ? ` Confirmation is a reclaim of ${fmt(reclaim)}.` : ''

  // Accumulation REQUIRES participation. A turning chart on drying-up / thin
  // volume is exactly the dead-cat this card claims to rule out — the bull
  // "accumulation" read only fires when volume isn't contracting or thin.
  const vr = ind?.volumeRegime
  const volParticipating = !vr || (vr.trend !== 'contracting' && vr.level !== 'thin')

  if (turning && vitUp && volParticipating) {
    return {
      cls: 'bull',
      title: 'Asymmetric recovery setup',
      text: `Down ${fromAth.toFixed(0)}% from its ATH and basing — the short clocks are turning up while the project still reads healthy${cats ? ` (${cats} live catalyst${cats > 1 ? 's' : ''})` : ''}${vr ? `, and volume is backing it (${vr.note.toLowerCase()})` : ''}. That's the accumulation-in-drawdown profile: a real team plus a turning chart${vr ? ' with flow behind it' : ''}, not a dead ticker. Size for the horizon, not the scalp.${reclaimClause}`,
    }
  }
  if (turning && vitUp && !volParticipating) {
    return {
      cls: 'neutral',
      title: 'Turning up — but volume is drying out',
      text: `Down ${fromAth.toFixed(0)}% and the short clocks are turning with the project still healthy, but volume isn't backing the move (${vr.note.toLowerCase()}). Accumulation needs participation — without it this is a low-conviction relief bounce, not a confirmed reversal, until volume expands.${reclaimClause}`,
    }
  }
  if (turning && !vitDown) {
    return {
      cls: 'neutral',
      title: 'Rebound off the lows — unconfirmed',
      text: `Down ${fromAth.toFixed(0)}% and bouncing, but there's no confirmed project vitality behind it yet. Treat as a relief bounce / dead-cat risk until the project shows it's still shipping.${reclaimClause}`,
    }
  }
  return {
    cls: 'bear',
    title: 'Deep drawdown — no reversal yet',
    text: `Down ${fromAth.toFixed(0)}% with no turn on the short clocks${vitDown ? ' and a weak project signal' : ''}. There's no reversal to trade here — this is knife-catching until the tape turns.`,
  }
}

function buildLenses(ind, timeframe, fmt, ltLabel, mtf, scalpKilled) {
  const lenses = []
  const price = ind.price

  // Scalper — fast momentum + local range; bias grounded in the 15m/1H clocks.
  {
    const pts = []
    if (scalpKilled) {
      pts.push('tax + thin book eat the edge — scalps are negative-EV here')
    }
    if (ind.stochRsi?.k != null) {
      pts.push(ind.stochRsi.k >= 80 ? 'momentum extended — chase risk high'
        : ind.stochRsi.k <= 20 ? 'momentum washed out — watch for the snap-back'
        : `stoch RSI ${ind.stochRsi.k.toFixed(0)} mid-range`)
    }
    if (ind.atrPct != null) pts.push(`ATR ${ind.atrPct.toFixed(1)}% per bar — ${ind.atrPct > 5 ? 'wide stops needed' : ind.atrPct > 2 ? 'normal sizing' : 'tight range, small targets'}`)
    if (ind.volumeRegime) pts.push(ind.volumeRegime.note.toLowerCase() + (ind.volumeRegime.level === 'thin' ? ' — expect slippage' : ind.volumeRegime.level === 'surge' ? ' — high participation' : ''))
    const localR = ind.sr?.local?.find(z => z.side === 'resistance')
    const localS = ind.sr?.local?.find(z => z.side === 'support')
    if (localS && localR) pts.push(`working range ${fmt(localS.mid)} → ${fmt(localR.mid)}`)
    // Fallback vote through the shared regime-aware scorer — a stoch pinned at
    // 80+ in an uptrend is a band-walk (bull), not a raw bear vote.
    const stochSig = ind.stochRsi?.k != null ? scoreStoch(ind.stochRsi.k, ind.regime || null).sig : null
    const fallbackBull = (stochSig === 'bull' ? 1 : 0) + (ind.macd?.histogram > 0 ? 1 : 0)
    const fallbackBear = (stochSig === 'bear' ? 1 : 0) + (ind.macd?.histogram < 0 ? 1 : 0)
    const bias = scalpKilled
      ? { label: 'Not viable', cls: 'neutral' }
      : (groupBias(mtf, ['15M', '1H']) || biasFrom(fallbackBull, fallbackBear))
    lenses.push({ key: 'scalper', title: 'Scalper', horizon: '15m–1H · minutes-hours', bias, points: pts })
  }

  // Swing — trend + levels; bias from the 4H/1D clocks.
  {
    const pts = []
    const aboveEma = ind.ema200 != null && price >= ind.ema200
    if (ind.ema200 != null) pts.push(`trades ${aboveEma ? 'above' : 'below'} the ${timeframe} 200 EMA`)
    if (ind.supply) pts.push(`first target/rejection zone ${fmt(ind.supply.low)}–${fmt(ind.supply.high)}`)
    if (ind.demand) pts.push(`risk defined against ${fmt(ind.demand.low)}–${fmt(ind.demand.high)}`)
    const fbBull = (aboveEma ? 1 : 0) + (ind.macd?.line > ind.macd?.signal ? 1 : 0) + (ind.rsi >= 55 ? 1 : 0)
    const fbBear = (ind.ema200 != null && !aboveEma ? 1 : 0) + (ind.macd?.line < ind.macd?.signal ? 1 : 0) + (ind.rsi <= 45 ? 1 : 0)
    const bias = groupBias(mtf, ['4H', '1D']) || biasFrom(fbBull, fbBear)
    lenses.push({ key: 'swing', title: 'Swing', horizon: '4H–1D · days-weeks', bias, points: pts })
  }

  // Investor — weekly cycle structure; bias from the 1D/1W clocks.
  {
    const lt = ind.longTerm
    const ol = ind.outlook
    const pts = []
    if (ol?.fromCycleHighPct != null && ol.fromCycleHighPct < -1) {
      const structural = ol.aboveEma200w ?? ol.aboveEma50w
      pts.push(`${ol.fromCycleHighPct.toFixed(0)}% from cycle high${structural != null ? ` — weekly structure ${structural ? 'intact' : 'broken'}` : ''}`)
    }
    if (lt?.aboveEma200 != null) pts.push(`${ltLabel} trend ${lt.aboveEma200 ? 'UP' : 'DOWN'} vs its 200 EMA`)
    if (lt?.change30 != null) pts.push(`${lt.change30 >= 0 ? '+' : ''}${lt.change30.toFixed(1)}% over the last 30 ${ltLabel === '1W' ? 'weeks' : 'days'}`)
    if (ind.majorSupport) pts.push(`accumulation zone ${fmt(ind.majorSupport.low)}–${fmt(ind.majorSupport.high)}`)
    if (ind.majorResistance) pts.push(`overhead supply ${fmt(ind.majorResistance.low)}–${fmt(ind.majorResistance.high)}`)
    const wStruct = ol ? (ol.aboveEma200w ?? ol.aboveEma50w) : null
    const fbBull = (lt?.aboveEma200 ? 1 : 0) + (lt?.macdCross === 'bullish' ? 1 : 0) + (lt?.change30 > 0 ? 1 : 0) + (wStruct === true ? 1 : 0)
    const fbBear = (lt?.aboveEma200 === false ? 1 : 0) + (lt?.macdCross === 'bearish' ? 1 : 0) + (lt?.change30 < 0 ? 1 : 0) + (wStruct === false ? 1 : 0)
    const bias = groupBias(mtf, ['1D', '1W']) || biasFrom(fbBull, fbBear)
    lenses.push({ key: 'investor', title: 'Investor', horizon: '1D–1W · weeks-months', bias, points: pts })
  }

  return lenses
}

function TradeThesisSection({ indicators, mtf, marketStructure, vitality, loading, timeframe, fmtPrice }) {
  const { t } = useTranslation()
  const model = useMemo(() => {
    if (!indicators) return null
    const fmt = (v) => (v == null || !Number.isFinite(v)) ? '—' : fmtPrice(v)
    const ltLabel = LT_LABEL[timeframe] || '1D'
    const isEquity = marketStructure?.assetClass === 'stock'
    // Stocks get the equity block in the micro slot; the crypto microcap read
    // (tax/honeypot/LP language) and the vitality-fused rebound never render
    // for an equity — their inputs and vocabulary are on-chain-only.
    const micro = isEquity
      ? buildEquityStructure(marketStructure, indicators, fmt)
      : buildMicrocap(marketStructure, indicators, fmt)
    return {
      cases: buildCases(indicators, fmt, timeframe, ltLabel),
      lenses: buildLenses(indicators, timeframe, fmt, ltLabel, mtf, micro?.scalpKilled),
      micro,
      rebound: isEquity ? null : buildRebound(indicators, mtf, marketStructure, vitality, fmt),
      fmt,
    }
  }, [indicators, mtf, marketStructure, vitality, timeframe, fmtPrice])

  if (loading && !indicators) {
    return (
      <SectionShell id="ta-thesis" label={t('researchPro.tradeThesis.tradethesis.label', "TECHNICALS · THESIS")} title={t('researchPro.tradeThesis.tradethesis.title', "Trade Thesis")} subtitle={t('researchPro.tradeThesis.tradethesis.subtitle', "What the timeframes agree on — and what to do about it")} collapsible>
        <div className="rz-te2-thesis rz-te2-thesis--loading">
          <SpectreLoader variant="logo" label={t('researchPro.tradeThesis.tradethesis.label2', "Reading the timeframes")} />
        </div>
      </SectionShell>
    )
  }
  if (!model) return null
  const { cases, lenses, micro, rebound, fmt } = model

  return (
    <SectionShell
      id="ta-thesis"
      label={t('researchPro.tradeThesis.tradethesis.label', "TECHNICALS · THESIS")}
      title={t('researchPro.tradeThesis.tradethesis.title', "Trade Thesis")}
      subtitle={t('researchPro.tradeThesis.tradethesis.subtitle', "What the timeframes agree on — and what to do about it")}
      collapsible
    >
      <div className="rz-te2-thesis">
        {/* Multi-timeframe confluence + matrix — the "which clock" answer */}
        {mtf?.grid?.length > 0 && (
          <div className="rz-te2-mtf">
            <div className={`rz-te2-mtf-head rz-te2-mtf-head--${mtf.confluence.cls}`}>
              <span className={`rz-te2-mtf-align rz-te2-mtf-align--${mtf.confluence.cls}`}>{mtf.confluence.alignment}</span>
              <span className="rz-te2-mtf-headline">{mtf.confluence.headline}</span>
            </div>
            {/* The "so what do I do" line — the plain-English takeaway */}
            {mtf.confluence.action && (
              <div className={`rz-te2-mtf-action rz-te2-mtf-action--${mtf.confluence.cls}`}>
                <span className="rz-te2-mtf-action-label">{t('researchPro.tradeThesis.tradethesis.whatThisMeans', "What this means")}</span>
                <span className="rz-te2-mtf-action-text">{mtf.confluence.action}</span>
              </div>
            )}
            {/* Labeled header so the numbers aren't cryptic */}
            <div className="rz-te2-mtf-colhead">
              <span>{t('researchPro.tradeThesis.tradethesis.timeframe', "Timeframe")}</span>
              <span>{t('researchPro.tradeThesis.tradethesis.read', "Read")}</span>
              <span>{t('researchPro.tradeThesis.tradethesis.whatItSDoing', "What it's doing")}</span>
              <span>{t('researchPro.tradeThesis.tradethesis.supportResistance', "Support / Resistance")}</span>
            </div>
            <div className="rz-te2-mtf-grid">
              {mtf.grid.map(g => (
                <div key={g.id} className="rz-te2-mtf-row">
                  <span className="rz-te2-mtf-tf mono">{g.label}</span>
                  <span className={`rz-te2-mtf-bias rz-te2-mtf-bias--${g.digest.bias}`}>{BIAS_LABEL[g.digest.bias]}</span>
                  <span className="rz-te2-mtf-drivers">{g.digest.drivers.map(humanizeDriver).join(' · ') || '—'}</span>
                  <span className="rz-te2-mtf-level mono">
                    <span className="rz-te2-mtf-sup"><i>S</i>{g.digest.supportLow != null ? fmt(g.digest.supportLow) : '—'}</span>
                    <span className="rz-te2-mtf-res"><i>R</i>{g.digest.resistanceHigh != null ? fmt(g.digest.resistanceHigh) : '—'}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Micro-structure — thin-liquidity / tax / holder caveats */}
        {micro && (
          <div className="rz-te2-micro">
            <div className="rz-te2-micro-head">
              {micro.isEquity ? 'Equity structure — what a level means here' : 'Micro-structure — why levels here are soft'}
            </div>
            <ul>
              {micro.points.map((p, i) => (
                <li key={i} className={p.danger ? 'rz-te2-micro-danger' : ''}>{p.text}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Deep-drawdown recovery — technical turn fused with project vitality */}
        {rebound && (
          <div className={`rz-te2-rebound rz-te2-rebound--${rebound.cls}`}>
            <div className="rz-te2-rebound-title">{rebound.title}</div>
            <p className="rz-te2-rebound-text">{rebound.text}</p>
          </div>
        )}

        {/* Bull / Bear cases — every bullet tagged with its timeframe */}
        <div className="rz-te2-thesis-cases">
          <div className="rz-te2-thesis-case rz-te2-thesis-case--bull">
            <div className="rz-te2-thesis-case-head">
              <span className="rz-te2-thesis-case-title">{t('researchPro.tradeThesis.tradethesis.bullCase', "Bull Case")}</span>
              <span className="rz-te2-thesis-case-count mono">{cases.bull.length}</span>
            </div>
            {cases.bull.length ? (
              <ul>{cases.bull.map((p, i) => <li key={i}><span className="rz-te2-thesis-tf mono">{p.tf}</span>{p.text}</li>)}</ul>
            ) : (
              <p className="rz-te2-thesis-none">{t('researchPro.tradeThesis.tradethesis.nothingOnTheTapeSupportsT', "Nothing on the tape supports the long side right now.")}</p>
            )}
            {cases.bullInvalidation && <div className="rz-te2-thesis-invalid">{cases.bullInvalidation}</div>}
          </div>
          <div className="rz-te2-thesis-case rz-te2-thesis-case--bear">
            <div className="rz-te2-thesis-case-head">
              <span className="rz-te2-thesis-case-title">{t('researchPro.tradeThesis.tradethesis.bearCase', "Bear Case")}</span>
              <span className="rz-te2-thesis-case-count mono">{cases.bear.length}</span>
            </div>
            {cases.bear.length ? (
              <ul>{cases.bear.map((p, i) => <li key={i}><span className="rz-te2-thesis-tf mono">{p.tf}</span>{p.text}</li>)}</ul>
            ) : (
              <p className="rz-te2-thesis-none">{t('researchPro.tradeThesis.tradethesis.nothingOnTheTapeSupportsT2', "Nothing on the tape supports the short side right now.")}</p>
            )}
            {cases.bearInvalidation && <div className="rz-te2-thesis-invalid">{cases.bearInvalidation}</div>}
          </div>
        </div>

        {/* Trader lenses — same tape, three clocks */}
        <div className="rz-te2-thesis-lenses">
          {lenses.map(l => (
            <div key={l.key} className="rz-te2-thesis-lens">
              <div className="rz-te2-thesis-lens-head">
                <span className="rz-te2-thesis-lens-title">{l.title}</span>
                <span className="rz-te2-thesis-lens-horizon">{l.horizon}</span>
                <span className={`rz-te2-thesis-lens-bias rz-te2-thesis-lens-bias--${l.bias.cls}`}>{l.bias.label}</span>
              </div>
              {l.points.length > 0 && (
                <ul>{l.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </SectionShell>
  )
}

export default React.memo(TradeThesisSection)
