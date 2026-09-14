/**
 * chart-ta-brief.js — turns a chart selection into a GROUNDED analysis brief.
 *
 * The agent never gets a bare "analyse this chart". It gets measured numbers:
 * window stats, indicators computed by the SAME engine the Technicals tab uses
 * (use-kline-indicators exports), S/R zones from sr-levels, and the pattern
 * candidates the matcher actually found — plus the textbook definition of each
 * so the answer cites the book instead of inventing one.
 *
 * Timeframe is first-class: every number is tagged with the resolution it was
 * computed on, and the brief states the bar count so a 12-bar "pattern" can be
 * called what it is.
 */

import { rsiSeries, emaSeries, macd, atrSeries, bollingerBands, stochRsi } from '@/pages/research-zone/hooks/use-kline-indicators'
import { detectZones } from './sr-levels'
import { scoreRsi, scoreMacd, scoreBb, scoreStoch } from './indicator-score'
import { detectChartPatterns, detectCandlePatterns } from './chart-patterns'

const RES_LABEL = {
  1: '1m', 5: '5m', 15: '15m', 30: '30m', 60: '1H', 240: '4H', 720: '12H', 1440: '1D', 10080: '1W',
}

/**
 * trading-chart candles ({date, open…}) → sr-levels/indicator shape ({t, o…}).
 *
 * 🪤 The two sources disagree about the time unit: the canvas chart's
 * candleData carries a Date (ms), while `/api/bars` — and therefore
 * fetchSeriesBars, the path the TradingView engine has to use — carries UNIX
 * SECONDS. Everything downstream compares against a selection in ms, so the
 * unit is settled here and nowhere else. Anything below 1e12 is seconds.
 */
export function normalizeBars(candles) {
  if (!Array.isArray(candles)) return []
  const out = []
  for (const c of candles) {
    if (!c) continue
    let t = c.date instanceof Date ? c.date.getTime() : (typeof c.date === 'number' ? c.date : (typeof c.t === 'number' ? c.t : null))
    if (t != null && t > 0 && t < 1e12) t *= 1000
    const o = Number(c.open ?? c.o)
    const h = Number(c.high ?? c.h)
    const l = Number(c.low ?? c.l)
    const cl = Number(c.close ?? c.c)
    if (t == null || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(cl)) continue
    out.push({ t, o, h, l, c: cl, v: Number(c.volume ?? c.v) || 0 })
  }
  return out
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60), rm = m % 60
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`
  const d = Math.floor(h / 24), rh = h % 24
  return rh ? `${d}d ${rh}h` : `${d}d`
}

function fmt(v) {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (a >= 1) return v.toFixed(2)
  if (a >= 0.01) return v.toFixed(4)
  return v.toPrecision(3)
}
const pct = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` : '—')

/**
 * @param bars       full normalized context bars (ascending)
 * @param selection  { fromTs, toTs, hiPrice, loPrice } — hi/lo optional (a
 *                   full-window "analyse everything" selection omits them)
 * @param opts       { symbol, resolution, price, assetClass }
 */
export function buildChartTaBrief(bars, selection, opts = {}) {
  const { symbol = '', resolution = '60', price = null } = opts
  const tfLabel = RES_LABEL[Number(resolution)] || `${resolution}m`

  if (!Array.isArray(bars) || bars.length < 5) {
    return { ok: false, reason: 'not_enough_bars', tfLabel }
  }

  const fromTs = Number.isFinite(selection?.fromTs) ? selection.fromTs : bars[0].t
  const toTs = Number.isFinite(selection?.toTs) ? selection.toTs : bars[bars.length - 1].t
  const win = bars.filter(b => b.t >= fromTs && b.t <= toTs)
  if (win.length < 3) return { ok: false, reason: 'window_too_small', tfLabel }

  // ── window stats ─────────────────────────────────────────────────────────
  const first = win[0], last = win[win.length - 1]
  const hi = Math.max(...win.map(b => b.h))
  const lo = Math.min(...win.map(b => b.l))
  const hiBar = win.find(b => b.h === hi)
  const loBar = win.find(b => b.l === lo)
  const changePct = ((last.c - first.o) / first.o) * 100
  const rangePct = ((hi - lo) / lo) * 100
  const durationMs = last.t - first.t

  // deepest peak-to-trough INSIDE the window (order matters, unlike hi/lo)
  let peak = win[0].h, maxDd = 0, runup = 0, trough = win[0].l
  for (const b of win) {
    if (b.h > peak) peak = b.h
    const dd = ((b.l - peak) / peak) * 100
    if (dd < maxDd) maxDd = dd
    if (b.l < trough) trough = b.l
    const ru = ((b.h - trough) / trough) * 100
    if (ru > runup) runup = ru
  }

  const winVol = win.reduce((s, b) => s + (b.v || 0), 0)
  const priorStart = Math.max(0, bars.indexOf(first) - win.length)
  const prior = bars.slice(priorStart, bars.indexOf(first))
  const priorVolPerBar = prior.length ? prior.reduce((s, b) => s + (b.v || 0), 0) / prior.length : 0
  const volVsPrior = priorVolPerBar > 0 ? (winVol / win.length) / priorVolPerBar : null

  // ── indicators (same engine as the Technicals tab) ───────────────────────
  // Computed on the full context series so the 14/20/26-period warm-ups are
  // honest, then read AT the window's last bar.
  const closes = bars.map(b => b.c)
  const idxEnd = bars.findIndex(b => b.t === last.t)
  const at = (arr) => (Array.isArray(arr) && idxEnd >= 0 && idxEnd < arr.length ? arr[idxEnd] : null)

  const rsiArr = rsiSeries(closes, 14)
  const ema20Arr = emaSeries(closes, 20)
  const ema50Arr = emaSeries(closes, 50)
  const ema200Arr = closes.length >= 200 ? emaSeries(closes, 200) : []
  const atrArr = atrSeries(bars.map(b => b.h), bars.map(b => b.l), closes, 14)
  const macdVals = macd(closes)
  const bb = bollingerBands(closes)
  const stoch = stochRsi(rsiArr)

  const rsi = at(rsiArr)
  const ema20 = at(ema20Arr)
  const ema50 = at(ema50Arr)
  const ema200 = ema200Arr.length ? at(ema200Arr) : null
  const atr = at(atrArr)
  const lastPrice = Number.isFinite(price) ? price : last.c
  const atrPct = atr && lastPrice ? (atr / lastPrice) * 100 : null

  const indicators = {
    rsi, ema20, ema50, ema200, atr, atrPct,
    macd: macdVals,
    bb,
    stochRsi: stoch,
    barsAvailable: bars.length,
    ema200Warm: ema200Arr.length > 0,
  }

  const scores = {
    rsi: Number.isFinite(rsi) ? scoreRsi(rsi) : null,
    macd: macdVals ? scoreMacd(macdVals) : null,
    bb: bb ? scoreBb(lastPrice, bb) : null,
    stoch: Number.isFinite(stoch?.k) ? scoreStoch(stoch.k) : null,
  }

  // ── structure ────────────────────────────────────────────────────────────
  // Zones are detected over the FULL fetched context, not just the selection —
  // a level tested twenty times over 1,200 bars is genuinely stronger evidence
  // than one tested twice inside a 120-bar highlight, so narrowing the search
  // would make the read worse. What was wrong (and is fixed here) is REPORTING
  // that context-wide count as if it described the window the reader selected:
  // a 120-bar highlight printed "support ×29". Each zone now carries both
  // counts, explicitly scoped, and every surface below states which it means.
  const rawZones = detectZones(bars, { price: lastPrice, strength: 3, minTouches: 1, maxPerSide: 3, kind: 'local' })
  const scopeToWindow = (z) => {
    const times = Array.isArray(z.touchTimes) ? z.touchTimes : []
    const inWindow = times.filter(t => t >= first.t && t <= last.t).length
    return {
      ...z,
      touchesInWindow: inWindow,
      touchesInContext: z.touches,
      contextBars: bars.length,
      // `touches` stays the context count so existing strength/ranking logic is
      // untouched; presentation uses the scoped fields.
    }
  }
  const zones = rawZones.map(scopeToWindow)
  const resistances = zones.filter(z => z.mid > lastPrice).sort((a, b) => a.mid - b.mid).slice(0, 3)
  const supports = zones.filter(z => z.mid <= lastPrice).sort((a, b) => b.mid - a.mid).slice(0, 3)

  const patterns = detectChartPatterns(win)
  const candles = detectCandlePatterns(win)

  const trend = (() => {
    if (!Number.isFinite(ema20) || !Number.isFinite(ema50)) return 'undetermined'
    if (lastPrice > ema20 && ema20 > ema50) return 'up'
    if (lastPrice < ema20 && ema20 < ema50) return 'down'
    return 'mixed'
  })()

  const stats = {
    symbol, tfLabel, resolution: String(resolution),
    fromTs: first.t, toTs: last.t, durationMs, durationLabel: formatDuration(durationMs),
    bars: win.length,
    open: first.o, close: last.c, high: hi, low: lo,
    highTs: hiBar?.t ?? null, lowTs: loBar?.t ?? null,
    changePct, rangePct, maxDrawdownPct: maxDd, maxRunupPct: runup,
    volume: winVol, volVsPrior,
    price: lastPrice, trend,
  }

  return {
    ok: true,
    stats,
    indicators,
    scores,
    supports,
    resistances,
    patterns,
    candles,
    /** Ready-to-draw geometry from every matched pattern. */
    drawings: patternsToDrawings(patterns, 3, [...resistances, ...supports], lastPrice),
    prompt: buildPrompt({ stats, indicators, scores, supports, resistances, patterns, candles }),
  }
}

/**
 * Pattern geometry → chart drawing objects (data-space anchored).
 * Only the two best-fitting patterns get drawn: five patterns × four lines is
 * twenty lines over the candles, which reads as noise. The strip still lists
 * everything the matcher found.
 */
export function patternsToDrawings(patterns, limit = 3, zones = null, price = null) {
  // % from the live price is what makes a level readable to someone who cannot
  // read a chart yet — "63,213" means nothing on its own, "−2.8%" does.
  const delta = (v) => (Number.isFinite(v) && Number.isFinite(price) && price > 0)
    ? `${v >= price ? '+' : ''}${(((v - price) / price) * 100).toFixed(1)}%`
    : null
  const out = []

  // Supply/demand bands first so they sit UNDER everything else. A cluster has
  // a real low/high, so drawing it as a band rather than a line is both truer
  // to the data and the thing a trader actually reacts to.
  // Nearest-first picks WHICH four zones matter (that ranking is the caller's),
  // then they are emitted highest price first so the renderer can place their
  // labels top-down without any two crossing. See makeLabelPlacer's 'band'
  // group in chart-ta-overlay.js.
  const bandZones = (zones || []).slice(0, 4).slice().sort((a, b) => (b.mid ?? 0) - (a.mid ?? 0))
  for (const z of bandZones) {
    if (!Number.isFinite(z?.low) || !Number.isFinite(z?.high)) continue
    out.push({
      id: `zone-${Math.round(z.mid)}`,
      source: 'pattern',
      tool: 'band',
      style: z.side === 'resistance' ? 'resistance' : 'support',
      bias: z.side === 'resistance' ? 'bearish' : 'bullish',
      low: z.low,
      high: z.high,
      touches: z.touches || 1,
      touchesInWindow: z.touchesInWindow ?? null,
      touchesInContext: z.touchesInContext ?? z.touches ?? null,
      // The band carries its own price range and touch count — this is the
      // support/resistance a reader actually wants stated, not implied. The
      // count is SCOPED: a bare "×3" means three touches inside the window you
      // highlighted. A level whose evidence is all older still shows its count,
      // tagged "in context", because hiding it would lose the better fact.
      label: (() => {
        const side = z.side === 'resistance' ? 'resistance' : 'support'
        const head = `${fmt(z.low)}–${fmt(z.high)} · ${side}`
        const inWin = z.touchesInWindow
        const inCtx = z.touchesInContext ?? z.touches
        if (Number.isFinite(inWin) && inWin > 1) return `${head} ×${inWin}`
        if (Number.isFinite(inCtx) && inCtx > 1) return `${head} ×${inCtx} in context`
        return head
      })(),
    })
  }

  for (const p of (patterns || []).slice(0, limit)) {
    // The pattern's own footprint — a box around where it actually formed. A
    // reader who cannot read a chart can at least SEE which stretch of candles
    // the read is about, instead of inferring it from scattered lines.
    const pts = (p.points || []).filter(x => Number.isFinite(x?.ts) && Number.isFinite(x?.price))
    if (pts.length >= 2 && Number.isFinite(p.startTs) && Number.isFinite(p.endTs)) {
      const lo = Math.min(...pts.map(x => x.price))
      const hi = Math.max(...pts.map(x => x.price))
      const pad = (hi - lo) * 0.18 || Math.abs(hi) * 0.004
      out.push({
        id: `env-${p.id}`,
        source: 'pattern',
        tool: 'zone',
        style: p.bias === 'bearish' ? 'resistance' : p.bias === 'bullish' ? 'support' : 'neckline',
        bias: p.bias,
        fromTs: p.startTs,
        toTs: p.endTs,
        low: lo - pad,
        high: hi + pad,
        label: p.name,
      })
    }

    // The measured move as an AREA, not a line: if it confirms, this is the
    // stretch of price it is expected to travel. Reads instantly.
    if (Number.isFinite(p.target) && Number.isFinite(p.neckline) && Number.isFinite(p.endTs)) {
      out.push({
        id: `proj-${p.id}`,
        source: 'pattern',
        tool: 'projection',
        style: 'target',
        dir: (Number.isFinite(price) && p.target >= price) ? 'up' : 'down',
        bias: p.bias,
        fromTs: p.endTs,
        low: Math.min(p.neckline, p.target),
        high: Math.max(p.neckline, p.target),
        label: delta(p.target) ? `measured move ${delta(p.target)}` : 'measured move',
      })
    }

    // The swing points the matcher actually measured. Three rings on a triple
    // top IS the pattern — it shows the reader what was counted, instead of
    // asking them to take "82% fit" on faith.
    for (const [i, pt] of (p.points || []).entries()) {
      if (!Number.isFinite(pt?.ts) || !Number.isFinite(pt?.price)) continue
      out.push({
        id: `pt-${p.id}-${i}`,
        source: 'pattern',
        tool: 'point',
        style: p.bias === 'bearish' ? 'resistance' : p.bias === 'bullish' ? 'support' : 'neckline',
        bias: p.bias,
        ts: pt.ts,
        price: pt.price,
        label: pt.label || null,
      })
    }
    for (const [i, ln] of (p.lines || []).entries()) {
      if (!ln?.from || !ln?.to) continue
      out.push({
        id: `pat-${p.id}-${i}`,
        source: 'pattern',
        tool: 'trendline',
        style: ln.style || 'trend',
        // Only the neckline earns a label. A channel rail or a peak-to-peak
        // segment is self-evident from where it sits, and repeating the
        // pattern name on every line is what made the chart unreadable —
        // the name belongs in the strip, once.
        label: ln.label === 'neckline' ? 'trigger' : null,
        bias: p.bias,
        a: { ts: ln.from.ts, price: ln.from.price },
        b: { ts: ln.to.ts, price: ln.to.price },
      })
    }
    if (Number.isFinite(p.target)) {
      out.push({
        id: `pat-${p.id}-target`,
        source: 'pattern',
        tool: 'hline',
        style: 'target',
        // Green/red on a chart mean UP and DOWN. A bearish pattern's measured
        // target sits BELOW price, so painting it green (because "target =
        // good") reads as an upside call. Colour follows direction.
        dir: (Number.isFinite(price) && p.target >= price) ? 'up' : 'down',
        label: delta(p.target) ? `target ${delta(p.target)}` : 'target',
        emphasis: true,
        bias: p.bias,
        price: p.target,
      })
    }
    if (Number.isFinite(p.invalidation)) {
      out.push({
        id: `pat-${p.id}-inval`,
        source: 'pattern',
        tool: 'hline',
        style: 'invalidation',
        label: delta(p.invalidation) ? `invalid ${delta(p.invalidation)}` : 'invalid',
        bias: p.bias,
        price: p.invalidation,
      })
    }
  }
  return out
}

// ────────────────────────────────────────────────────────────────────────────
// prompt
// ────────────────────────────────────────────────────────────────────────────

/**
 * A pattern's invalidation is either the book's sentence or a measured price
 * (the matcher overrides it per match). Render both as a sentence, and say
 * which SIDE the level invalidates from — that comes off the pattern's own bias.
 */
export function describeInvalidation(p) {
  if (!p) return null
  const v = p.invalidation
  if (Number.isFinite(v)) {
    const side = p.bias === 'bearish' ? 'above' : p.bias === 'bullish' ? 'below' : 'through'
    return `a close ${side} ${fmt(v)}`
  }
  return (typeof v === 'string' && v.trim()) ? v : null
}

function buildPrompt({ stats, indicators, scores, supports, resistances, patterns, candles }) {
  const L = []
  L.push(`Read this ${stats.symbol} chart window on the ${stats.tfLabel} timeframe and give me the technical analysis.`)
  L.push('')
  L.push(`WINDOW (${stats.bars} × ${stats.tfLabel} bars, ${stats.durationLabel})`)
  L.push(`- open ${fmt(stats.open)} → close ${fmt(stats.close)} (${pct(stats.changePct)})`)
  L.push(`- high ${fmt(stats.high)}, low ${fmt(stats.low)}, range ${stats.rangePct.toFixed(1)}%`)
  L.push(`- deepest drawdown inside the window ${pct(stats.maxDrawdownPct)}, largest run-up ${pct(stats.maxRunupPct)}`)
  if (Number.isFinite(stats.volVsPrior)) {
    L.push(`- volume ran ${stats.volVsPrior.toFixed(2)}× the previous ${stats.bars} bars`)
  }
  L.push(`- live price ${fmt(stats.price)}, short-term trend reads ${stats.trend}`)

  L.push('')
  L.push(`INDICATORS at the window close (${stats.tfLabel}, Wilder, ${indicators.barsAvailable} bars of history)`)
  if (Number.isFinite(indicators.rsi)) L.push(`- RSI(14) ${indicators.rsi.toFixed(1)}${scores.rsi ? ` — ${scores.rsi.label}` : ''}`)
  if (Number.isFinite(indicators.stochRsi?.k)) L.push(`- StochRSI %K ${indicators.stochRsi.k.toFixed(1)}${scores.stoch ? ` — ${scores.stoch.label}` : ''}`)
  if (indicators.macd?.line != null) L.push(`- MACD ${fmt(indicators.macd.line)} vs signal ${fmt(indicators.macd.signal)} (hist ${fmt(indicators.macd.histogram)})${scores.macd ? ` — ${scores.macd.label}` : ''}`)
  if (Number.isFinite(indicators.ema20)) L.push(`- EMA20 ${fmt(indicators.ema20)}, EMA50 ${fmt(indicators.ema50)}${indicators.ema200Warm ? `, EMA200 ${fmt(indicators.ema200)}` : ', EMA200 not warmed up on this window'}`)
  if (indicators.bb?.upper != null) L.push(`- Bollinger ${fmt(indicators.bb.lower)} / ${fmt(indicators.bb.middle)} / ${fmt(indicators.bb.upper)}${scores.bb ? ` — ${scores.bb.label}` : ''}`)
  if (Number.isFinite(indicators.atrPct)) L.push(`- ATR(14) ${fmt(indicators.atr)} (${indicators.atrPct.toFixed(2)}% of price) — size stops against this`)

  if (supports.length || resistances.length) {
    const ctxBars = (resistances[0] || supports[0])?.contextBars ?? null
    L.push('')
    L.push('MEASURED LEVELS (swing clusters, nearest first)')
    // Touch counts are two-scoped on purpose. The window is what the reader
    // highlighted; the context is the wider series the zones were found in.
    // Collapsing them is how a 120-bar read ends up claiming "support ×29".
    L.push(
      `Touch counts are SCOPED. "in window" = touches inside the ${stats.bars} bars selected. ` +
      `"in context" = touches across the ${ctxBars ?? 'wider'} bars fetched around it. ` +
      'Never state a context count as though it happened in the selected window; ' +
      'if a level earned its evidence earlier, say so ("held three times, though last tested before this window").'
    )
    const levelLine = (z, side) => {
      const inWin = Number.isFinite(z.touchesInWindow) ? z.touchesInWindow : null
      const inCtx = Number.isFinite(z.touchesInContext) ? z.touchesInContext : z.touches
      const counts = inWin === null
        ? `${inCtx} touch${inCtx === 1 ? '' : 'es'}`
        : `${inWin} touch${inWin === 1 ? '' : 'es'} in window, ${inCtx} in context`
      return `- ${side} ${fmt(z.low)}–${fmt(z.high)} — ${counts}${z.untested ? ' (under-tested)' : ''}`
    }
    for (const r of resistances) L.push(levelLine(r, 'resistance'))
    for (const s of supports) L.push(levelLine(s, 'support'))
  }

  if (patterns.length) {
    L.push('')
    L.push('PATTERN CANDIDATES the matcher found in this window (geometry verified, not guessed)')
    for (const p of patterns) {
      L.push(`- ${p.name} (${p.kind}, ${p.bias}, fit ${(p.confidence * 100).toFixed(0)}%)`)
      L.push(`  book: ${p.definition}`)
      L.push(`  confirms on: ${p.confirmation}`)
      // The matcher overrides `invalidation` with a raw PRICE on most patterns
      // and leaves the book's sentence on the rest, so this field is
      // string | number | null. Interpolating it blind sent the model
      // "invalidated by: 78617.33638899802" — an unformatted float, which is
      // exactly the "never state a number without what it MEANS" failure this
      // prompt warns about two lines later.
      L.push(`  invalidated by: ${describeInvalidation(p)}`)
      if (Number.isFinite(p.target)) L.push(`  measured target: ${fmt(p.target)} (${p.measured})`)
      if (p.note) L.push(`  measured here: ${p.note}`)
    }
  } else {
    L.push('')
    L.push('PATTERN CANDIDATES: none of the classical patterns matched cleanly in this window. Say so rather than forcing one.')
  }

  if (candles.length) {
    L.push('')
    L.push('CANDLE FORMATIONS near the window close')
    for (const c of candles) L.push(`- ${c.name} (${c.bias}) — ${c.definition}`)
  }

  L.push('')
  L.push('ANSWER FORMAT — be a desk analyst, not a textbook:')
  L.push('1. **Read** — one paragraph: what this window actually is, in plain language.')
  L.push('2. **Structure** — the pattern (or the honest absence of one) and the levels that matter, with numbers.')
  L.push('3. **Levels** — invalidation, confirmation and target as explicit prices.')
  L.push('4. **Bottom line** — bias with a conviction, and what would flip it.')
  L.push('')
  L.push('RULES: use only the numbers above — do not invent a level, a volume figure or a historical analogue.')
  L.push(`Say the timeframe out loud (${stats.tfLabel}) — a ${stats.bars}-bar read on ${stats.tfLabel} is not a daily thesis.`)
  L.push('If the window is too short or too thin for a pattern to mean anything, say that first.')
  L.push('')
  L.push('REQUIRED last step — the levels you named above get drawn on the user\'s chart, so end your reply with exactly this block and nothing after it:')
  L.push('```draw')
  L.push('[{"type":"hline","price":' + (Number.isFinite(stats.price) ? Number(stats.price.toPrecision(6)) : 100) + ',"label":"invalidation","bias":"bearish"}]')
  L.push('```')
  L.push(`Include one entry per price level you cited (2-4 of them). "price" must be a plain number inside ${fmt(stats.low)}–${fmt(stats.high)}. Do not invent a level you did not justify above.`)

  return L.join('\n')
}

/**
 * Pull the agent's ```draw ... ``` block out of a streamed answer.
 * Returns { drawings, text } — text has the block stripped so the chat never
 * renders raw JSON at the user.
 */
export function extractAgentDrawings(text) {
  if (typeof text !== 'string' || !text) return { drawings: [], text: text || '' }
  // Primary: the fence we asked for. Fallback: any fenced JSON array carrying
  // our shape — models reach for ```json as readily as ```draw, and this
  // backend appends fences of its own, so matching on the SHAPE is what makes
  // the round-trip survive a model that half-follows the instruction.
  let m = text.match(/```draw\s*([\s\S]*?)```/i)
  if (!m) {
    const fenced = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/i)
    if (fenced && /"type"\s*:\s*"(hline|trendline)"/.test(fenced[1])) m = [fenced[0], fenced[1]]
  }
  if (!m) return { drawings: [], text }
  const re = new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  let parsed = []
  try {
    const raw = JSON.parse(m[1].trim())
    if (Array.isArray(raw)) {
      parsed = raw.map((d, i) => {
        const bias = d.bias === 'bullish' || d.bias === 'bearish' ? d.bias : 'neutral'
        const label = typeof d.label === 'string' ? d.label.slice(0, 40) : ''
        if (d.type === 'hline' && Number.isFinite(Number(d.price))) {
          return { id: `ai-${i}`, source: 'ai', tool: 'hline', style: 'ai', price: Number(d.price), label, bias }
        }
        if (d.type === 'trendline' && Number.isFinite(Number(d.from?.price)) && Number.isFinite(Number(d.to?.price))) {
          return {
            id: `ai-${i}`, source: 'ai', tool: 'trendline', style: 'ai', label, bias,
            a: { ts: Number(d.from.ts), price: Number(d.from.price) },
            b: { ts: Number(d.to.ts), price: Number(d.to.price) },
          }
        }
        return null
      }).filter(Boolean)
    }
  } catch { /* a half-streamed block is not an error — just no drawings yet */ }
  return { drawings: parsed, text: text.replace(re, '').trimEnd() }
}
