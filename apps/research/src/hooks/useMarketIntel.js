/**
 * useMarketIntel - Real-time market intelligence hook
 * Fetches funding rates, open interest, long/short ratio, global market data,
 * top gainers/losers, and derives whale flows, alt season index, sector performance,
 * and live anomaly events from free public APIs via backend proxies.
 *
 * All data is stored in a single ref to avoid cascading re-renders.
 * A counter state is bumped once per fetch cycle to trigger a single re-render.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { useCurrency } from './useCurrency'
import { getCryptoNews } from '@/services/cryptoNewsApi'
import { getSpectreIntelBundle, getSpectreIntelSlimBundle, getSpectreIntelDerivBundle } from '@/services/spectreMarketApi'

// ── Sector groupings by narrative ──────────────────────────────────────
const SECTOR_TAGS = {
  'AI / ML': ['FET', 'RENDER', 'RNDR', 'TAO', 'AGIX', 'OCEAN', 'AKT'],
  'DeFi': ['AAVE', 'UNI', 'MKR', 'CRV', 'LDO', 'SUSHI', 'GRT', 'COMP'],
  'L2 / Scaling': ['ARB', 'OP', 'MATIC', 'MANTA', 'STRK', 'ZK'],
  'L1 Chains': ['ETH', 'SOL', 'AVAX', 'NEAR', 'SUI', 'APT', 'SEI', 'INJ', 'TIA'],
  'Gaming / Metaverse': ['IMX', 'GALA', 'AXS', 'SAND', 'MANA', 'ILV'],
  'Memes': ['DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK', 'FLOKI'],
  'DePIN': ['FIL', 'HNT', 'IOTX', 'AR', 'THETA'],
  'RWA': ['ONDO', 'POLYX', 'MPL', 'CFG'],
  'BTC Ecosystem': ['STX', 'ORDI', 'SATS'],
}

function deriveSectorStage(avgChange) {
  if (avgChange > 8) return { stage: 'early', stageLabel: 'Early', color: 'green' }
  if (avgChange > 3) return { stage: 'early-mid', stageLabel: 'Early–Mid', color: 'green' }
  if (avgChange > 0) return { stage: 'mid', stageLabel: 'Mid', color: 'yellow' }
  if (avgChange > -3) return { stage: 'mid-late', stageLabel: 'Mid–Late', color: 'yellow' }
  if (avgChange > -8) return { stage: 'late', stageLabel: 'Late', color: 'red' }
  return { stage: 'exhausted', stageLabel: 'Exhausted', color: 'red' }
}

function altSeasonLabel(value) {
  if (value >= 75) return 'Alt Season'
  if (value >= 50) return 'Rotation'
  if (value >= 25) return 'BTC Season'
  return 'BTC Dominant'
}

// ── Scenario Agent - derives a market thesis from current conditions ──
function computeScenario(funding, lsRatio, tickers, oi, global, fp = (v) => `$${v.toLocaleString()}`, fl = (v) => `$${(v / 1e6).toFixed(1)}M`) {
  const gainers = tickers?.topGainers || []
  const losers = tickers?.topLosers || []
  const major = tickers?.majorCoins || {}
  const btcTicker = major.btc || [...losers, ...gainers].find(t => t.symbol === 'BTC')
  const btcChange = btcTicker?.change || 0
  const btcPrice = btcTicker?.price || 0

  // Round key levels based on BTC price magnitude
  const roundLevel = (p) => {
    if (p > 10000) return Math.round(p / 1000) * 1000
    if (p > 1000) return Math.round(p / 100) * 100
    return Math.round(p / 10) * 10
  }

  // Scenario 1: Crash / Dip Reversal - BTC down significantly
  if (btcChange < -5) {
    const support = roundLevel(btcPrice * 0.95)
    const resistance = roundLevel(btcPrice * 1.08)
    const invalidation = roundLevel(btcPrice * 0.88)
    const fundingNegative = funding.btc < 0
    const shortsHeavy = lsRatio.shorts > 55
    const confidence = Math.min(85, 40 + (fundingNegative ? 15 : 0) + (shortsHeavy ? 15 : 0) + Math.min(15, Math.abs(btcChange)))
    return {
      type: 'reversal',
      label: 'Crash Reversal Setup',
      trigger: `BTC ${btcChange.toFixed(1)}% in 24h - ${fundingNegative ? 'negative funding signals panic' : 'funding still positive (caution)'}`,
      bullCase: `Oversold bounce likely if ${fp(support)} holds. ${shortsHeavy ? 'Short squeeze setup with ' + lsRatio.shorts.toFixed(0) + '% shorts.' : 'Watch for volume confirmation.'} Target ${fp(resistance)} on relief rally.`,
      bearCase: `Breakdown below ${fp(support)} opens ${fp(invalidation)}. ${!fundingNegative ? 'Positive funding despite dump = more downside risk.' : 'Capitulation not yet confirmed by volume.'} Cascading liquidations possible.`,
      keyLevels: [
        { label: 'Support', price: fp(support) },
        { label: 'Resistance', price: fp(resistance) },
        { label: 'Invalidation', price: fp(invalidation) },
      ],
      confidence,
      color: '#34d399',
    }
  }

  // Scenario 2: Euphoria / Overheated Top
  if (funding.btc > 0.03 && lsRatio.longs > 58) {
    const support = roundLevel(btcPrice * 0.92)
    const resistance = roundLevel(btcPrice * 1.05)
    const invalidation = roundLevel(btcPrice * 1.1)
    const confidence = Math.min(80, 35 + (funding.btc > 0.05 ? 20 : 10) + (lsRatio.longs > 65 ? 15 : 5) + (btcChange > 3 ? 10 : 0))
    return {
      type: 'top',
      label: 'Euphoria Exhaustion',
      trigger: `Funding ${funding.btc.toFixed(4)}% (elevated) - ${lsRatio.longs.toFixed(0)}% longs crowded. Overheated conditions detected.`,
      bullCase: `Momentum continuation if price holds above ${fp(resistance)}. High funding can persist in strong trends. Break above invalidation = new leg up.`,
      bearCase: `Crowded longs (${lsRatio.longs.toFixed(0)}%) vulnerable to flush. Funding cost bleeds leverage. Likely correction to ${fp(support)} before next move.`,
      keyLevels: [
        { label: 'Support', price: fp(support) },
        { label: 'Resistance', price: fp(resistance) },
        { label: 'Breakout', price: fp(invalidation) },
      ],
      confidence,
      color: '#f59e0b',
    }
  }

  // Scenario 3: Breakout Continuation - strong rally underway
  if (btcChange > 5) {
    const support = roundLevel(btcPrice * 0.96)
    const target = roundLevel(btcPrice * 1.12)
    const invalidation = roundLevel(btcPrice * 0.92)
    const oiBullish = oi.btc > 0
    const confidence = Math.min(80, 35 + Math.min(20, btcChange * 2) + (funding.btc < 0.03 ? 15 : 0) + (oiBullish ? 10 : 0))
    return {
      type: 'breakout',
      label: 'Breakout Continuation',
      trigger: `BTC +${btcChange.toFixed(1)}% rally - ${funding.btc < 0.02 ? 'healthy funding = room to run' : 'funding heating up (watch for top)'}`,
      bullCase: `Strong momentum with ${funding.btc < 0.02 ? 'low funding cost' : 'elevated but sustainable funding'}. Hold above ${fp(support)} targets ${fp(target)}. Volume confirmation key.`,
      bearCase: `Extended move vulnerable to profit-taking. Rejection at ${fp(target)} area. Loss of ${fp(invalidation)} negates breakout thesis.`,
      keyLevels: [
        { label: 'Support', price: fp(support) },
        { label: 'Target', price: fp(target) },
        { label: 'Invalidation', price: fp(invalidation) },
      ],
      confidence,
      color: '#34d399',
    }
  }

  // Scenario 4: Short Squeeze Setup - shorts heavily dominant
  if (lsRatio.shorts > 60 && funding.btc < 0) {
    const target = roundLevel(btcPrice * 1.08)
    const support = roundLevel(btcPrice * 0.97)
    const confidence = Math.min(75, 30 + (lsRatio.shorts - 50) * 2 + (Math.abs(funding.btc) > 0.02 ? 15 : 5))
    return {
      type: 'squeeze',
      label: 'Short Squeeze Potential',
      trigger: `${lsRatio.shorts.toFixed(0)}% shorts with negative funding (${funding.btc.toFixed(4)}%). Crowded positioning detected.`,
      bullCase: `Short squeeze to ${fp(target)} if buying pressure emerges. Negative funding = shorts paying to hold. Any catalyst triggers cascade.`,
      bearCase: `Shorts may be correct - bearish trend continuation. Breakdown below ${fp(support)} validates short thesis. Volume declining = no squeeze yet.`,
      keyLevels: [
        { label: 'Squeeze Target', price: fp(target) },
        { label: 'Support', price: fp(support) },
      ],
      confidence,
      color: '#60a5fa',
    }
  }

  // Scenario 5: Default - Consolidation / Range
  const upper = roundLevel(btcPrice * 1.04)
  const lower = roundLevel(btcPrice * 0.96)
  const mcapChange = global.marketCapChange24h || 0
  const confidence = Math.min(65, 30 + (Math.abs(btcChange) < 2 ? 20 : 10) + (Math.abs(funding.btc) < 0.02 ? 10 : 0))
  return {
    type: 'range',
    label: 'Consolidation Phase',
    trigger: `BTC ${btcChange >= 0 ? '+' : ''}${btcChange.toFixed(1)}% - neutral funding (${funding.btc.toFixed(4)}%). Market digesting ${mcapChange >= 0 ? 'gains' : 'losses'}.`,
    bullCase: `Accumulation zone. Break above ${fp(upper)} with volume = next leg up. Low funding cost allows leverage buildup. Watch for altcoin rotation.`,
    bearCase: `Distribution risk if volume fades. Drop below ${fp(lower)} = breakdown. Sideways action often precedes sharp move - direction TBD.`,
    keyLevels: [
      { label: 'Range High', price: fp(upper) },
      { label: 'Range Low', price: fp(lower) },
    ],
    confidence,
    color: '#a78bfa',
  }
}

// ── Default data shape ─────────────────────────────────────────────────
const DEFAULTS = {
  fundingRates: { btc: 0, eth: 0 },
  openInterest: { btc: 0, eth: 0 },
  longShortRatio: { ratio: 1, longs: 50, shorts: 50 },
  globalData: { totalMarketCap: 0, totalVolume: 0, btcDominance: 56, ethDominance: 10, solDominance: 4, marketCapChange24h: 0 },
  tickers: { topGainers: [], topLosers: [], totalPairs: 0 },
  flowSummary: { inflow: 0, outflow: 0, net: 0, unit: 'M' },
  whaleFlows: { net: 0, unit: 'M', label: 'Whale net', direction: 'neutral' },
  altSeasonIndex: { value: 50, btcShare: 56, ethShare: 10, label: 'Rotation' },
  dominance: { btc: 56, eth: 10, sol: 0, alts: 34 },
  sectorPerformance: [],
  liveEvents: [],
  alphaFeed: [],
  scenario: { type: 'range', label: 'Consolidation Phase', trigger: 'Awaiting market data...', bullCase: 'Loading scenario analysis...', bearCase: 'Loading scenario analysis...', keyLevels: [], confidence: 0, color: '#a78bfa' },
  aiAnalyse: { fundingAvgPct: 0, liquidations: { long: 0, short: 0, total: 0 }, whaleFlowUsd: 0, regime: 'NEUTRAL', state: 'Unknown', change24h: {}, asText: {} },
}

// ── The Hook ───────────────────────────────────────────────────────────
export function useMarketIntel(refreshInterval = 60000, { enabled = true, mode = 'full' } = {}) {
  const { fmtPrice, fmtLarge } = useCurrency()
  // Single render trigger - bumped once per fetch cycle
  const [tick, setTick] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // All data lives in a ref so setState calls don't cascade
  const dataRef = useRef({
    fundingRates: DEFAULTS.fundingRates,
    openInterest: DEFAULTS.openInterest,
    longShortRatio: DEFAULTS.longShortRatio,
    globalData: DEFAULTS.globalData,
    tickers: DEFAULTS.tickers,
    flowSummary: DEFAULTS.flowSummary,
    whaleFlows: DEFAULTS.whaleFlows,
    altSeasonIndex: DEFAULTS.altSeasonIndex,
    dominance: DEFAULTS.dominance,
    sectorPerformance: DEFAULTS.sectorPerformance,
    liveEvents: DEFAULTS.liveEvents,
    alphaFeed: DEFAULTS.alphaFeed,
    scenario: DEFAULTS.scenario,
    aiAnalyse: DEFAULTS.aiAnalyse,
    lastUpdated: null,
  })
  const prevTickersRef = useRef(null)

  // ── Compute derived metrics ──────────────────────────────────────────
  const computeDerived = useCallback((funding, oi, lsRatio, global, tickerData, marketSignals = {}) => {
    const d = dataRef.current

    // 1) Whale flows estimate
    const btcOI_B = oi.btc > 0 ? oi.btc * (funding.btcPrice || 98000) / 1e9 : 0
    const longs24h = btcOI_B * (lsRatio.longs / 100) * 0.015
    const shorts24h = btcOI_B * (lsRatio.shorts / 100) * 0.008
    const netWhale = (shorts24h - longs24h) * 100
    d.whaleFlows = {
      net: Math.round(netWhale),
      unit: 'M',
      label: 'Whale net',
      direction: netWhale > 20 ? 'inflow' : netWhale < -20 ? 'outflow' : 'neutral',
    }

    // 2) Flow summary
    const volM = (global.totalVolume || 0) / 1e6
    const mcapChangeRate = (global.marketCapChange24h || 0) / 100
    const baseFlow = volM * 0.015
    const estimatedInflow = Math.round(baseFlow * (1 + Math.max(0, mcapChangeRate * 2)))
    const estimatedOutflow = Math.round(baseFlow * (1 + Math.max(0, -mcapChangeRate * 2)))
    d.flowSummary = { inflow: estimatedInflow, outflow: estimatedOutflow, net: estimatedInflow - estimatedOutflow, unit: 'M' }

    // 3) Alt Season Index - dominance-driven formula
    //    Maps inversely from BTC dominance: high BTC dom = low alt season
    //    BTC dom 65%+ → alt ~5-10, 60% → ~15-25, 55% → ~30-40, 45% → ~60-75, <40% → ~80+
    const gainers = tickerData.topGainers || []
    const losers = tickerData.topLosers || []
    const allMovers = [...gainers, ...losers]
    const btcChange = allMovers.find(t => t.symbol === 'BTC')?.change || 0
    const altcoins = allMovers.filter(t => t.symbol !== 'BTC' && t.symbol !== 'ETH' && t.volume > 5000000)
    const backendDom = marketSignals.dominance || {}
    const btcDom = Number.isFinite(Number(backendDom.btc)) && Number(backendDom.btc) > 0
      ? Number(backendDom.btc)
      : global.btcDominance || 56
    // Inverse mapping from BTC dominance → alt season score
    // 61% dom → ~15, 58% → ~25, 55% → ~35, 50% → ~50, 40% → ~80
    const domScore = Math.max(0, Math.min(100, Math.round((68 - btcDom) * 2)))
    // Small bonus if alts are significantly outperforming BTC today (up to +5 pts)
    const altsBeatBtc = altcoins.filter(t => t.change > btcChange + 5).length
    const altBonus = altcoins.length > 0 ? Math.round((altsBeatBtc / altcoins.length) * 5) : 0
    const altValue = Math.max(0, Math.min(100, domScore + altBonus))
    const backendAlt = marketSignals.altSeason || {}
    const backendAltValue = Number(backendAlt.value ?? backendAlt.index)
    d.altSeasonIndex = Number.isFinite(backendAltValue) && backendAltValue > 0
      ? {
        value: backendAltValue,
        btcShare: Math.round(btcDom),
        ethShare: Math.round(global.ethDominance || backendDom.eth || 10),
        label: backendAlt.label || backendAlt.season || altSeasonLabel(backendAltValue),
        source: backendAlt.source,
      }
      : {
        value: altValue,
        btcShare: Math.round(btcDom),
        ethShare: Math.round(global.ethDominance || 10),
        label: altSeasonLabel(altValue),
      }

    // 4) Dominance
    const btcD = btcDom
    const ethD = Number.isFinite(Number(backendDom.eth)) && Number(backendDom.eth) > 0 ? Number(backendDom.eth) : global.ethDominance || 10
    // No `|| 4` fallback: a hardcoded 4% rendered as a real SOL slice (the true
    // share was 2.2%). When neither source knows it, 0 is honest - the slice
    // collapses instead of showing an invented number.
    const solD = Number.isFinite(Number(backendDom.sol)) && Number(backendDom.sol) > 0
      ? Number(backendDom.sol)
      : (global.solDominance > 0 ? global.solDominance : 0)
    // Always derived. The upstream `others` is 100 - btc - eth, so trusting it
    // while also drawing a SOL slice made the four numbers sum to 104%.
    const othersD = Math.max(0, 100 - btcD - ethD - solD)
    d.dominance = {
      btc: btcD,
      eth: ethD,
      sol: solD,
      alts: othersD,
    }

    // 5) Sector performance
    const tickerMap = {}
    ;[...gainers, ...losers].forEach(t => { tickerMap[t.symbol] = t })
    d.sectorPerformance = Object.entries(SECTOR_TAGS).map(([name, symbols]) => {
      const matched = symbols.filter(s => tickerMap[s])
      if (matched.length === 0) return null
      const avgChange = matched.reduce((sum, s) => sum + (tickerMap[s]?.change || 0), 0) / matched.length
      const totalVol = matched.reduce((sum, s) => sum + (tickerMap[s]?.volume || 0), 0)
      const { stage, stageLabel, color } = deriveSectorStage(avgChange)
      return {
        id: name.toLowerCase().replace(/[\s/]+/g, '-'),
        name, avgChange: parseFloat(avgChange.toFixed(1)), totalVolume: totalVol,
        stage, stageLabel, color,
        topMover: matched.sort((a, b) => Math.abs(tickerMap[b]?.change || 0) - Math.abs(tickerMap[a]?.change || 0))[0],
      }
    }).filter(Boolean).sort((a, b) => b.avgChange - a.avgChange)

    // 6) Live events (anomaly detection)
    const events = []
    const now = Date.now()
    gainers.slice(0, 3).forEach((t, idx) => {
      if (t.change > 10) events.push({ type: 'breakout', token: t.symbol, action: `+${t.change.toFixed(1)}% breakout`, amount: `${fmtLarge(t.volume)} vol`, time: 'live', id: `gain-${t.symbol}-${idx}`, isNew: idx === 0 })
    })
    losers.slice(0, 2).forEach((t, idx) => {
      if (t.change < -10) events.push({ type: 'liquidation', token: t.symbol, action: `${t.change.toFixed(1)}% dump`, amount: `${fmtLarge(t.volume)} vol`, time: 'live', id: `loss-${t.symbol}-${idx}` })
    })
    if (Math.abs(funding.btc) > 0.03) {
      events.push({ type: 'whale', token: 'BTC', action: funding.btc > 0 ? 'High funding (longs crowded)' : 'Negative funding (shorts crowded)', amount: `${funding.btc.toFixed(4)}%`, time: 'live', id: `fund-btc` })
    }
    if (lsRatio.longs > 60 || lsRatio.shorts > 60) {
      const dominant = lsRatio.longs > lsRatio.shorts ? 'Longs' : 'Shorts'
      events.push({ type: 'volume', token: 'BTC', action: `${dominant} dominating (${Math.max(lsRatio.longs, lsRatio.shorts).toFixed(0)}%)`, amount: `Ratio: ${lsRatio.ratio.toFixed(2)}`, time: 'live', id: `ls` })
    }
    // Volume anomaly
    const prevTickers = prevTickersRef.current
    if (prevTickers && prevTickers.topGainers) {
      const prevVolMap = {}
      prevTickers.topGainers.forEach(t => { prevVolMap[t.symbol] = t.volume })
      gainers.forEach((t, idx) => {
        const prevVol = prevVolMap[t.symbol]
        if (prevVol && t.volume > prevVol * 2.5) {
          events.push({ type: 'volume', token: t.symbol, action: `Volume surge ${(t.volume / prevVol).toFixed(1)}x`, amount: `${fmtLarge(t.volume)}`, time: 'live', id: `vol-${t.symbol}-${idx}` })
        }
      })
    }
    prevTickersRef.current = tickerData
    // Pad with filler
    if (events.length < 4) {
      const filler = [
        { type: 'whale', token: 'ETH', action: 'Exchange outflow detected', amount: `OI: ${(oi.eth || 0).toFixed(0)} ETH`, time: '~1m', id: `filler-eth` },
        { type: 'volume', token: 'SOL', action: 'DEX activity elevated', amount: `Mcap Δ: ${(global.marketCapChange24h || 0).toFixed(1)}%`, time: '~2m', id: `filler-sol` },
        { type: 'breakout', token: 'BTC', action: `OI: ${(oi.btc || 0).toFixed(0)} BTC`, amount: `Dom: ${(global.btcDominance || 56).toFixed(1)}%`, time: '~3m', id: `filler-btc` },
        { type: 'listing', token: 'ARB', action: 'L2 volume tracking', amount: `${(global.totalVolume / 1e9 || 0).toFixed(1)}B 24h vol`, time: '~5m', id: `filler-arb` },
      ]
      events.push(...filler.slice(0, 6 - events.length))
    }
    d.liveEvents = events.slice(0, 8)

    // 7) Scenario Agent
    d.scenario = computeScenario(funding, lsRatio, tickerData, oi, global, fmtPrice, fmtLarge)
  }, [])

  // ── Fetch alpha feed (real news) ───────────────────────────────────
  const fetchAlpha = useCallback(async () => {
    try {
      const news = await getCryptoNews(null, 12)
      if (news && news.length > 0) {
        const items = news.map((item, idx) => {
          const titleLower = (item.title || '').toLowerCase()
          let type = 'macro'
          let severity = 'medium'
          if (titleLower.includes('liquidat') || titleLower.includes('wiped') || titleLower.includes('crash')) { type = 'liquidation'; severity = 'critical' }
          else if (titleLower.includes('surge') || titleLower.includes('pump') || titleLower.includes('rally') || titleLower.includes('soar') || titleLower.includes('breakout') || titleLower.includes('all-time')) { type = 'pump'; severity = 'high' }
          else if (titleLower.includes('volume') || titleLower.includes('trading') || titleLower.includes('dex')) { type = 'volume'; severity = 'medium' }
          else if (titleLower.includes('hack') || titleLower.includes('exploit') || titleLower.includes('breach') || titleLower.includes('scam') || titleLower.includes('phish')) { type = 'security'; severity = 'critical' }
          else if (titleLower.includes('whale') || titleLower.includes('accumul') || titleLower.includes('oversold') || titleLower.includes('undervalued')) { type = 'opportunity'; severity = 'medium' }
          else if (titleLower.includes('sec') || titleLower.includes('fed') || titleLower.includes('regulation') || titleLower.includes('etf') || titleLower.includes('tariff')) { type = 'macro'; severity = 'high' }
          const tokenRegex = /\b(BTC|ETH|SOL|BNB|XRP|ADA|DOGE|AVAX|LINK|UNI|ARB|OP|MATIC|DOT|NEAR|APT|SUI|INJ|AAVE|MKR|FET|RENDER|PEPE|WIF|BONK|SHIB|JUP|PYTH)\b/gi
          const tokens = [...new Set((item.title || '').match(tokenRegex) || [])].map(t => t.toUpperCase())
          const timeAgo = item.publishedOn ? formatTimeAgo(item.publishedOn) : ['now', '2m', '5m', '12m', '28m', '45m', '1h', '2h', '3h', '4h', '6h', '12h'][idx] || '1h'
          return { id: item.id || `alpha-${idx}`, type, headline: item.title || '', detail: item.summary || '', severity, tokens, time: timeAgo, isNew: idx === 0, source: item.source || 'Crypto', url: item.url }
        })
        dataRef.current.alphaFeed = items
        setTick(t => t + 1) // trigger re-render for alpha update
      }
    } catch (err) {
      // silently handled
    }
  }, [])

  // ── Main fetch loop ────────────────────────────────────────────────
  //
  // Single-flight bundle: getSpectreIntelBundle fans out the same 7 upstream
  // calls under one 30s cache so any duplicate caller in the same window
  // shares one round of fetches. The wrapper returns fallback shapes for any
  // upstream that failed, so we no longer need per-call Promise.allSettled
  // bookkeeping here.
  const fetchAll = useCallback(async () => {
    try {
      const bundle = mode === 'full'
        ? await getSpectreIntelBundle()
        : mode === 'deriv'
          ? await getSpectreIntelDerivBundle()
          : await getSpectreIntelSlimBundle()
      const d = dataRef.current
      if (bundle.fundingRates) d.fundingRates = bundle.fundingRates
      if (bundle.openInterest) d.openInterest = bundle.openInterest
      if (bundle.longShortRatio) d.longShortRatio = bundle.longShortRatio
      if (bundle.globalMetrics) d.globalData = bundle.globalMetrics
      if (bundle.tickers) d.tickers = bundle.tickers

      // Deriv mode carries only funding/OI/long-short (RZ Technicals) — the
      // whale/flow/sector/alt-season derivations and the aiAnalyse composite
      // need global metrics + tickers the deriv bundle deliberately skips.
      if (mode === 'deriv') {
        d.lastUpdated = new Date()
        setError(null)
        setTick(t => t + 1)
        return
      }

      computeDerived(d.fundingRates, d.openInterest, d.longShortRatio, d.globalData, d.tickers, {
        dominance: bundle.dominance,
        altSeason: bundle.altSeason,
      })

      // Compose aiAnalyse from real bundle data (no more all-zero placeholder).
      // The AiMarketPanel reads liquidations.total/long/short, whaleFlowUsd, and
      // openInterest off this object — previously they all rendered $0.
      const liqW = bundle.liquidationWindows
      const liq24 = liqW && (liqW['24h'] || liqW.windows?.['24h']) || null
      // Prefer the server-aggregated total (all 680+ assets across 16 exchanges).
      // Fall back to summing the page rows when the meta field is missing.
      const oiTotalUsd = Number(d.openInterest?.totalUsd) > 0
        ? Number(d.openInterest.totalUsd)
        : (d.openInterest?.btcUsd || 0) + (d.openInterest?.ethUsd || 0)
          + (Array.isArray(d.openInterest?.rows)
            ? d.openInterest.rows.reduce((sum, row) => {
                if (!row) return sum
                const sym = (row.asset || row.symbol || '').toUpperCase()
                if (sym === 'BTC' || sym === 'ETH') return sum
                return sum + Number(row.oi_usd || row.total_oi_usd || 0)
              }, 0)
            : 0)
      const fundingAvgPct = ((d.fundingRates?.btc || 0) + (d.fundingRates?.eth || 0)) / 2
      d.aiAnalyse = {
        fundingAvgPct,
        liquidations: {
          long: Number(liq24?.long || 0),
          short: Number(liq24?.short || 0),
          total: Number(liq24?.total || (Number(liq24?.long || 0) + Number(liq24?.short || 0))),
        },
        whaleFlowUsd: (d.whaleFlows?.net || 0) * 1e6,
        openInterest: oiTotalUsd,
        conviction: 0,
        riskLevel: 'moderate',
        verdict: '',
        regime: 'NEUTRAL',
        state: 'Live',
        change24h: {},
        asText: {},
        ts: Date.now(),
      }

      d.lastUpdated = new Date()
      setError(null)
      setTick(t => t + 1)
    } catch (err) {
      console.error('useMarketIntel fetch error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [computeDerived, mode])

  // ── Effects ────────────────────────────────────────────────────────
  // Alpha feed is news-driven and only consumed by Brief/AI-market surfaces,
  // so it shares the `full` gate. Slim mode skips it entirely.
  const fullEnabled = enabled && mode === 'full'

  useEffect(() => { if (enabled) fetchAll() }, [fetchAll, enabled])
  useEffect(() => { if (fullEnabled) fetchAlpha() }, [fetchAlpha, fullEnabled])

  useAdaptivePolling(fetchAll, { interval: refreshInterval, enabled })
  useAdaptivePolling(fetchAlpha, { interval: 180000, enabled: fullEnabled })

  // ── Memoized return (only changes when tick bumps) ─────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => {
    const d = dataRef.current
    return {
      fundingRates: d.fundingRates,
      openInterest: d.openInterest,
      longShortRatio: d.longShortRatio,
      dominance: d.dominance,
      totalMarketCap: d.globalData?.totalMarketCap ?? 0,
      totalVolume: d.globalData?.totalVolume ?? 0,
      marketCapChange24h: d.globalData?.marketCapChange24h ?? 0,
      flowSummary: d.flowSummary,
      whaleFlows: d.whaleFlows,
      altSeasonIndex: d.altSeasonIndex,
      sectorPerformance: d.sectorPerformance,
      liveEvents: d.liveEvents,
      alphaFeed: d.alphaFeed,
      scenario: d.scenario,
      tickers: d.tickers,
      aiAnalyse: d.aiAnalyse,
      lastUpdated: d.lastUpdated,
      loading,
      error,
    }
  }, [tick, loading, error])
}

// ── Helpers ────────────────────────────────────────────────────────────
function formatTimeAgo(unixSeconds) {
  if (!unixSeconds) return '?'
  const diff = Math.floor(Date.now() / 1000) - unixSeconds
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

export default useMarketIntel
