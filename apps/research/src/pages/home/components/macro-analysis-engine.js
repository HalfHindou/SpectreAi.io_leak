/**
 * Macro Analysis Engine - extracted from WelcomePage for maintainability.
 * Pure computation: takes market data, returns analysis paragraphs + table data.
 * Used inside a useMemo in welcome-page.jsx.
 */

import { IPO_REFERENCE, TOP_STOCKS } from '@/constants/stockData'

// Real KEY EVENTS derived from the live quote set — IPO-price crossings on
// newly-listed names + outsized daily movers. This is what was missing when
// SPCX broke below its $150 IPO price and the command center said nothing
// (2026-07-13). Returns [] when nothing notable — never invents an event.
function deriveStockKeyEvents(stockPrices) {
  const events = []
  if (!stockPrices) return events
  const nameOf = (sym) => TOP_STOCKS.find((s) => s.symbol === sym)?.name || sym
  for (const [sym, ref] of Object.entries(IPO_REFERENCE)) {
    const q = stockPrices[sym]
    const px = Number(q?.price)
    if (!Number.isFinite(px) || px <= 0) continue
    if (px < ref.price) {
      const pct = Math.abs((px / ref.price - 1) * 100)
      events.push({
        symbol: sym, kind: 'ipo_breach', direction: 'bearish',
        text: `${nameOf(sym)} (${sym}) has broken below its $${ref.price} IPO price — trading at $${px.toFixed(2)}, ${pct.toFixed(1)}% underwater since the ${ref.date} listing`,
      })
    }
  }
  for (const [sym, q] of Object.entries(stockPrices)) {
    const chg = Number(q?.change)
    if (!Number.isFinite(chg) || Math.abs(chg) < 7) continue
    events.push({
      symbol: sym, kind: 'big_move', direction: chg > 0 ? 'bullish' : 'bearish',
      text: `${nameOf(sym)} (${sym}) is ${chg > 0 ? 'up' : 'down'} ${Math.abs(chg).toFixed(1)}% today`,
    })
  }
  return events
}

/**
 * @param {Object} params
 * @param {string} params.marketAiTimeframe - '1h' | '24h' | '7d'
 * @param {Object} params.topCoinPrices - { BTC, ETH, SOL, ... } each with .price, .change
 * @param {{ value: number, classification: string }} params.fearGreed
 * @param {boolean} params.isStocks
 * @param {Object} params.stockPrices - { SPY, QQQ, AAPL, ... }
 * @param {Object} params.marketIndices - fallback for stock prices
 * @param {Object} params.liveVix - { price, label }
 * @returns {{ p1: string, p2: string, p3: string, tableData: Array, bias: string, tfLabel: string, fng: number|null, fngLabel: string, smartSummary: string }}
 */
export function computeMacroAnalysis({ marketAiTimeframe, topCoinPrices, fearGreed, isStocks, stockPrices, marketIndices, liveVix }) {
  if (isStocks) {
    return computeStockMacro({ marketAiTimeframe, stockPrices, marketIndices, liveVix })
  }
  return computeCryptoMacro({ marketAiTimeframe, topCoinPrices, fearGreed })
}

// Real per-window % change for the selected timeframe. Prices carry live
// change1h / change (24h) / change7d (from binanceApi/coinGeckoApi). Previously
// the engine FABRICATED 1h/7d as change24h * 0.15 / * 1.4 — plausible-looking
// but wrong. Use the true window; only fall back to the 24h change if a token
// genuinely lacks that window's field (never invent a number).
function windowChange(tok, tf) {
  if (!tok) return null
  const c24 = tok.change != null ? Number(tok.change) : null
  if (tf === '1h') return tok.change1h != null ? Number(tok.change1h) : c24
  if (tf === '7d') return tok.change7d != null ? Number(tok.change7d) : c24
  return c24
}

// ── STOCK MODE ──
function computeStockMacro({ marketAiTimeframe, stockPrices, marketIndices, liveVix }) {
  const spy = stockPrices?.SPY || marketIndices?.SPY
  const qqq = stockPrices?.QQQ || marketIndices?.QQQ
  const aapl = stockPrices?.AAPL
  const spyCh = windowChange(spy, marketAiTimeframe)
  const qqqCh = windowChange(qqq, marketAiTimeframe)
  const aaplCh = windowChange(aapl, marketAiTimeframe)
  const spyPrice = spy?.price ?? null
  const qqqPrice = qqq?.price ?? null
  const aaplPrice = aapl?.price ?? null
  const vixPrice = liveVix?.price ?? null
  const vixLabel = liveVix?.label || 'N/A'

  const valid = [spyCh, qqqCh, aaplCh].filter((x) => x != null)
  const avg = valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0
  const bias = avg > 1 ? 'bullish' : avg < -1 ? 'bearish' : 'neutral'
  const tfLabel = marketAiTimeframe === '1h' ? '1-hour' : marketAiTimeframe === '24h' ? '24-hour' : '7-day'

  const tableData = [
    { asset: 'SPY', price: spyPrice, change: spyCh, signal: spyCh > 1.5 ? 'Strong Buy' : spyCh > 0 ? 'Buy' : spyCh > -1.5 ? 'Hold' : 'Sell' },
    { asset: 'QQQ', price: qqqPrice, change: qqqCh, signal: qqqCh > 1.5 ? 'Strong Buy' : qqqCh > 0 ? 'Buy' : qqqCh > -1.5 ? 'Hold' : 'Sell' },
    { asset: 'AAPL', price: aaplPrice, change: aaplCh, signal: aaplCh > 2 ? 'Strong Buy' : aaplCh > 0 ? 'Buy' : aaplCh > -2 ? 'Hold' : 'Sell' },
  ]

  // real events lead — a canned outlook must never bury an SPCX-below-IPO day
  const keyEvents = deriveStockKeyEvents(stockPrices)

  let p1 = ''
  if (keyEvents.length) {
    p1 += `KEY EVENTS - ${keyEvents.map((e) => e.text).join('. ')}. `
  }
  p1 += `${tfLabel.toUpperCase()} OUTLOOK - The stock market is exhibiting a ${bias} bias based on major index and mega-cap performance. `
  if (spyCh != null && qqqCh != null) {
    p1 += `S&P 500 is ${spyCh >= 0 ? 'up' : 'down'} ${Math.abs(spyCh).toFixed(1)}% while Nasdaq ${qqqCh >= 0 ? 'gained' : 'lost'} ${Math.abs(qqqCh).toFixed(1)}%. `
  }
  if (aaplCh != null) {
    p1 += `Apple ${aaplCh >= 0 ? 'advanced' : 'declined'} ${Math.abs(aaplCh).toFixed(1)}%, ${aaplCh > qqqCh ? 'outpacing' : 'lagging'} the broader tech index. `
  }
  p1 += `VIX at ${vixPrice != null ? vixPrice.toFixed(2) : '-'} (${vixLabel}), ${vixPrice != null && vixPrice >= 25 ? 'signaling elevated volatility - hedge exposure and reduce position sizes' : vixPrice != null && vixPrice <= 15 ? 'indicating complacency - low volatility historically precedes larger moves' : 'reflecting moderate volatility conditions with no extreme stress'}. `

  // MARKET INTERNALS from the ACTUAL quote set — breadth + sector aggregates
  // + leaders/laggards replace the old boilerplate that rendered identically
  // on every bullish day. Falls back to a short generic line while quotes load.
  const rows = Object.entries(stockPrices || {})
    .map(([s, q]) => ({ s, chg: Number(q?.change), sector: TOP_STOCKS.find((t) => t.symbol === s)?.sector || null }))
    .filter((r) => Number.isFinite(r.chg))
  const adv = rows.filter((r) => r.chg > 0).length
  const dec = rows.filter((r) => r.chg < 0).length
  const bySector = {}
  for (const r of rows) {
    if (!r.sector) continue
    if (!bySector[r.sector]) bySector[r.sector] = []
    bySector[r.sector].push(r.chg)
  }
  const sectorAvgs = Object.entries(bySector)
    .filter(([, a]) => a.length >= 2)
    .map(([name, a]) => ({ name, avg: a.reduce((x, y) => x + y, 0) / a.length }))
    .sort((a, b) => b.avg - a.avg)
  const bestSec = sectorAvgs[0]
  const worstSec = sectorAvgs[sectorAvgs.length - 1]
  const sorted = [...rows].sort((a, b) => b.chg - a.chg)
  const leaders = sorted.slice(0, 2)
  const laggards = sorted.slice(-2).reverse()
  const fmtRow = (r) => `${r.s} ${r.chg >= 0 ? '+' : ''}${r.chg.toFixed(1)}%`

  let p2 = 'MARKET INTERNALS - '
  if (rows.length >= 8) {
    p2 += `Breadth: ${adv} of ${rows.length} tracked names advancing, ${dec} declining${adv + dec > 0 ? ` (${Math.round((adv / (adv + dec)) * 100)}% positive)` : ''}. `
    if (bestSec && worstSec && bestSec.name !== worstSec.name) {
      p2 += `${bestSec.name} leads (${bestSec.avg >= 0 ? '+' : ''}${bestSec.avg.toFixed(1)}% avg) while ${worstSec.name} lags (${worstSec.avg >= 0 ? '+' : ''}${worstSec.avg.toFixed(1)}%). `
    }
    if (leaders.length && laggards.length) {
      p2 += `Leaders: ${leaders.map(fmtRow).join(', ')}. Laggards: ${laggards.map(fmtRow).join(', ')}. `
    }
    const idxUp = avg > 0
    const breadthUp = adv > dec
    if (idxUp !== breadthUp) {
      p2 += idxUp
        ? 'Indices are green on narrow leadership - most names are NOT participating, which makes the tape fragile.'
        : 'Indices are red while most names hold up - weakness is concentrated, not systemic.'
    } else {
      p2 += idxUp ? 'Breadth confirms the move - participation is broad.' : 'Breadth confirms the weakness - selling is broad.'
    }
  } else {
    p2 += 'Quote set still loading - internals unavailable this tick.'
  }

  let p3 = 'POSITIONING - '
  if (keyEvents.length) {
    p3 += `${keyEvents.length === 1 ? 'One key event on the tape' : `${keyEvents.length} key events on the tape`} (see above) - factor ${keyEvents.length === 1 ? 'it' : 'them'} before adding risk. `
  }
  if (bias === 'bullish') {
    p3 += `Momentum favors ${bestSec ? bestSec.name : 'the leading sectors'}; scale into strength rather than chasing gaps${vixPrice != null && vixPrice <= 13 ? ' - VIX near complacency lows, keep stops honest' : ''}.`
  } else if (bias === 'bearish') {
    p3 += `Defensive posture; ${worstSec ? `${worstSec.name} is where the selling concentrates` : 'avoid the weakest sectors'}${vixPrice != null && vixPrice >= 25 ? ' and elevated VIX argues for smaller size' : ''}. Cash is a position.`
  } else {
    p3 += `Range tape rewards selectivity - ${leaders.length ? `relative strength (${leaders[0].s}) over index bets` : 'stock-specific setups over index bets'}; keep sizing conservative until a catalyst lands.`
  }

  // event tickers earn a table row so the numbers sit next to the story
  for (const ev of keyEvents) {
    if (tableData.some((r) => r.asset === ev.symbol)) continue
    const q = stockPrices?.[ev.symbol]
    if (!q) continue
    tableData.push({
      asset: ev.symbol, price: q.price ?? null, change: q.change ?? null,
      signal: ev.kind === 'ipo_breach' ? 'Below IPO' : (Number(q.change) > 0 ? 'Buy' : 'Sell'),
    })
  }

  const leader = tableData.reduce((a, b) => Math.abs(b.change || 0) > Math.abs(a.change || 0) ? b : a, tableData[0])
  const moodWord = bias === 'bullish' ? 'Buy pressure' : bias === 'bearish' ? 'Sell pressure' : 'Consolidating'
  const eventNote = keyEvents.length ? `  ·  ⚠ ${keyEvents[0].symbol} ${keyEvents[0].kind === 'ipo_breach' ? 'below IPO' : 'big move'}` : ''
  const smartSummary = tableData.slice(0, 3).map(r => `${r.asset} ${(r.change || 0) >= 0 ? '+' : ''}${(r.change || 0).toFixed(1)}%`).join('  ·  ') + `  -  ${moodWord}${eventNote}`

  return { p1, p2, p3, tableData, bias, tfLabel, fng: vixPrice, fngLabel: vixLabel, smartSummary, keyEvents }
}

// ── CRYPTO MODE ──
function computeCryptoMacro({ marketAiTimeframe, topCoinPrices, fearGreed }) {
  const btc = topCoinPrices?.BTC
  const eth = topCoinPrices?.ETH
  const sol = topCoinPrices?.SOL
  // Windowed change for the selected timeframe (real 1h / 24h / 7d), used
  // consistently for the bias, the narrative, and the asset table.
  const btcCh = windowChange(btc, marketAiTimeframe)
  const ethCh = windowChange(eth, marketAiTimeframe)
  const solCh = windowChange(sol, marketAiTimeframe)
  const btcPrice = btc?.price ?? null
  const ethPrice = eth?.price ?? null
  const solPrice = sol?.price ?? null
  const fng = fearGreed.value
  const fngLabel = fearGreed.classification || 'Neutral'

  const valid = [btcCh, ethCh, solCh].filter((x) => x != null)
  const avg = valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0
  const bias = avg > 1 ? 'bullish' : avg < -1 ? 'bearish' : 'neutral'
  const tfLabel = marketAiTimeframe === '1h' ? '1-hour' : marketAiTimeframe === '24h' ? '24-hour' : '7-day'

  // Asset table data
  const tableData = [
    { asset: 'BTC', price: btcPrice, change: btcCh, signal: btcCh > 2 ? 'Strong Buy' : btcCh > 0 ? 'Buy' : btcCh > -2 ? 'Hold' : 'Sell' },
    { asset: 'ETH', price: ethPrice, change: ethCh, signal: ethCh > 2 ? 'Strong Buy' : ethCh > 0 ? 'Buy' : ethCh > -2 ? 'Hold' : 'Sell' },
    { asset: 'SOL', price: solPrice, change: solCh, signal: solCh > 2 ? 'Strong Buy' : solCh > 0 ? 'Buy' : solCh > -2 ? 'Hold' : 'Sell' },
  ]

  // Paragraph 1: Market overview and bias
  let p1 = `${tfLabel.toUpperCase()} OUTLOOK - The crypto market is currently exhibiting a ${bias} bias based on major asset performance. `
  if (btcCh != null && ethCh != null) {
    p1 += `Bitcoin is ${btcCh >= 0 ? 'up' : 'down'} ${Math.abs(btcCh).toFixed(1)}% while Ethereum ${ethCh >= 0 ? 'gained' : 'lost'} ${Math.abs(ethCh).toFixed(1)}%. `
  }
  if (solCh != null) {
    p1 += `Solana ${solCh >= 0 ? 'advanced' : 'declined'} ${Math.abs(solCh).toFixed(1)}%, ${solCh > ethCh ? 'outperforming' : 'underperforming'} ETH on the session. `
  }
  p1 += `Market sentiment as measured by the Fear & Greed Index sits at ${fng != null ? fng : '-'} (${fngLabel}), ${fng > 60 ? 'suggesting elevated optimism that historically precedes pullbacks' : fng < 40 ? 'indicating fear levels that often mark accumulation zones' : 'reflecting balanced positioning with no extreme crowding'}. `

  // Paragraph 2: Macro conditions and outlook
  let p2 = 'MACRO CONDITIONS - Global liquidity conditions remain the primary driver for risk assets. '
  if (bias === 'bullish') {
    p2 += 'The current rally aligns with improving macro sentiment as central banks signal a more accommodative stance. Treasury yields have stabilized, reducing headwinds for duration-sensitive assets like crypto. Institutional flows via spot ETFs continue to provide structural demand, with cumulative inflows suggesting sustained allocation shifts. Key resistance levels to watch include BTC at psychological round numbers and ETH at prior swing highs. A breakout with volume confirmation would suggest trend continuation, while rejection could trigger short-term profit-taking. Risk management remains essential - consider scaling into strength rather than chasing.'
  } else if (bias === 'bearish') {
    p2 += 'Risk-off sentiment dominates as markets digest tighter financial conditions. Elevated real rates and dollar strength continue to pressure crypto valuations. Geopolitical tensions and tariff uncertainty add to the cautious positioning. On-chain data shows exchange inflows rising, typically a precursor to selling pressure. Support levels at prior consolidation zones become critical - a decisive break below could accelerate downside. Defensive positioning is warranted: reduce leverage, size down, and wait for capitulation signals (volume spike, funding reset) before re-engaging. Cash is a position.'
  } else {
    p2 += 'Markets are consolidating within a defined range as participants await clearer macro signals. The Fed remains data-dependent, with upcoming CPI and employment reports likely to set near-term direction. Bitcoin dominance is stable, suggesting capital is not rotating aggressively between majors and alts. Volatility compression typically precedes expansion - a breakout in either direction is likely within the coming sessions. Position accordingly with defined invalidation levels. Avoid overtrading in choppy conditions; patience often outperforms activity in range-bound markets.'
  }

  // Paragraph 3: Actionable insights
  let p3 = 'POSITIONING - '
  if (bias === 'bullish') {
    p3 += 'Current conditions favor trend-following strategies. Consider adding to core positions on pullbacks to support, with stops below recent swing lows. Alt exposure should favor high-beta names with strong fundamentals and volume. Take partial profits at resistance to lock in gains. Monitor BTC dominance for rotation signals - a decline typically benefits altcoins.'
  } else if (bias === 'bearish') {
    p3 += 'Preserve capital and reduce exposure. If hedging, consider short positions or inverse products with tight risk controls. Avoid catching falling knives - wait for clear reversal signals like a higher low on the daily chart with volume. Build a watchlist of high-conviction assets to accumulate once conditions stabilize. Dollar-cost averaging can smooth entry during volatile periods.'
  } else {
    p3 += 'Neutral conditions suit range-trading strategies. Define clear support/resistance levels and trade the range with appropriate size. Avoid large directional bets until a breakout confirms. Use this period to research and build conviction in assets for the next trending phase. Stablecoin yields offer attractive carry while waiting for opportunities.'
  }

  // Smart one-liner summary for Market Pulse status bar
  const leader = tableData.reduce((a, b) => Math.abs(b.change || 0) > Math.abs(a.change || 0) ? b : a, tableData[0])
  const leaderDir = (leader.change || 0) >= 0 ? 'leads up' : 'leads down'
  const moodWord = bias === 'bullish' ? 'Buy pressure' : bias === 'bearish' ? 'Sell pressure' : 'Consolidating'
  const smartSummary = tableData.map(r => `${r.asset} ${(r.change || 0) >= 0 ? '+' : ''}${(r.change || 0).toFixed(1)}%`).join('  ·  ') + `  -  ${moodWord}`

  return { p1, p2, p3, tableData, bias, tfLabel, fng, fngLabel, smartSummary }
}
