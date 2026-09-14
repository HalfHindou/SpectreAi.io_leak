import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { useMarketIntel } from '@/hooks/useMarketIntel'
import { getV1Json } from '@/services/spectreMarketApi'
import { IS_SHOWCASE_EMBED } from '@/lib/embed-mode'
import useFearGreed from './use-fear-greed'
import useUsMarketStatus from './use-us-market-status'
import useNextEconomicEvent from './use-next-economic-event'
import useAiBrief from './use-ai-brief'
import { computeMacroAnalysis } from './macro-analysis-engine'
import { computeTaAnalysis } from './ta-analysis-engine'
import { generateBriefShareCard, generateWelcomeShareCard } from './share-cards'
import { TOKEN_LOGOS } from './welcome-page-constants'

// Tabs that need derivatives data (funding, OI, long/short, tickers).
// Anything else only needs the slim bundle for the horizontal bar.
// NOTE: the AI Market tab's id is 'analysis' (see marketAiTabs in welcome-page).
// 'aimarket' was a stale id that matched NO tab, so on the AI Market tab the
// derivatives snapshot never fetched and the intel bundle stayed 'slim' -> the
// OI / Funding / Liquidations / Whale-flow strip was permanently $0.
const DERIVATIVES_TABS = ['brief', 'analysis', 'flows', 'wallets']

export default function useMarketIntelligence({
  topCoinPrices,
  stockPrices,
  marketIndices,
  isStocks,
  fmtPrice,
  currencySymbol,
  t,
  i18n,
  profile,
  marketDominanceOverride,
  briefTabActive = true,
  isMobile = false,
  marketAiTab = 'brief',
}) {
  // Full bundle only when the user is on a tab that shows derivatives;
  // slim bundle for everything else (still feeds the horizontal bar).
  const intelMode = DERIVATIVES_TABS.includes(marketAiTab) ? 'full' : 'slim'
  const intel = useMarketIntel(90000, { enabled: !isStocks, mode: intelMode })

  // Sector data fetches live inside SectorsTabPanel (lazy mounted).

  // ── Breaking News Banner ──
  // Only rendered on desktop (welcome-page wraps it in `{!isMobile && ...}`).
  // Skip the fetch entirely on mobile and slow the poll on desktop — the
  // banner doesn't churn often enough to justify a 60s interval.
  const [breakingArticle, setBreakingArticle] = useState(null)
  // Top-N breaking headlines used as live context for the AI Market analysis
  // panel. Same fetch, just exposes the array so we don't double-poll.
  const [breakingHeadlines, setBreakingHeadlines] = useState([])
  const fetchBreaking = useCallback(async () => {
    try {
      const res = await fetch('/api/intelligence/breaking')
      if (!res.ok) return
      const data = await res.json()
      const articles = Array.isArray(data?.articles) ? data.articles : []
      if (articles[0]) setBreakingArticle(articles[0])
      if (articles.length > 0) setBreakingHeadlines(articles.slice(0, 3))
    } catch (_) {}
  }, [])

  // Feeds the below-fold breaking-news banner + AI panel context. Defer the
  // boot fetch to the idle tick after first paint (mirrors fetchDerivSnap) so
  // it doesn't compete with above-the-fold render. Banner is desktop-only.
  useEffect(() => {
    if (isMobile) return
    const ric = (typeof window !== 'undefined' && window.requestIdleCallback) || ((cb) => setTimeout(cb, 200))
    const cancel = (typeof window !== 'undefined' && window.cancelIdleCallback) || clearTimeout
    const id = ric(() => fetchBreaking())
    return () => cancel(id)
  }, [isMobile, fetchBreaking])

  useAdaptivePolling(fetchBreaking, { interval: 5 * 60 * 1000, enabled: !isMobile })

  // 2026-05-26 beta-quality fix: removed FALLBACK_ALPHA_ITEMS (fabricated "$1.36B liquidated"/"JELLY +1325%" headlines).
  // Alpha feed renders empty until /v1/intelligence/alpha-feed publishes real events.
  const [alphaFeed, setAlphaFeed] = useState([])
  const prevAlphaTickRef = useRef(null)
  useEffect(() => {
    const ts = intel.lastUpdated ? intel.lastUpdated.getTime() : 0
    if (intel.alphaFeed && intel.alphaFeed.length > 0 && ts !== prevAlphaTickRef.current) {
      prevAlphaTickRef.current = ts
      setAlphaFeed(intel.alphaFeed.slice(0, 8))
    }
  }, [intel.lastUpdated, intel.alphaFeed])

  // Activity feed
  const [liveActivity, setLiveActivity] = useState([])
  const prevLiveRef = useRef(null)
  useEffect(() => {
    if (intel.liveEvents && intel.liveEvents.length > 0 && intel.lastUpdated !== prevLiveRef.current) {
      prevLiveRef.current = intel.lastUpdated
      const mapped = intel.liveEvents.map((ev, idx) => ({
        type: ev.type, token: ev.token,
        logo: TOKEN_LOGOS[ev.token] || '',
        action: ev.action, amount: ev.amount,
        time: ev.time || 'live', isNew: ev.isNew || idx === 0, id: ev.id,
      }))
      setLiveActivity(mapped)
    }
    // When upstream has no events we intentionally leave liveActivity as-is
    // (2026-05-26 beta fix: no hardcoded fake "live" rows - empty beats lying).
  }, [intel.lastUpdated, intel.liveEvents])

  // Fear & Greed Index
  const cryptoFearGreed = useFearGreed()
  const fearGreed = cryptoFearGreed

  // Live VIX data
  const liveVix = useMemo(() => {
    if (!isStocks || !marketIndices) return null
    const indicesArr = Array.isArray(marketIndices) ? marketIndices : []
    const vix = indicesArr.find(i => i.symbol === '^VIX' || i.symbol === 'VIX')
    if (!vix?.price) return null
    const price = Number(vix.price)
    const change = vix.change != null ? Number(vix.change) : 0
    let label = 'Low Volatility'
    if (price >= 30) label = 'Extreme Volatility'
    else if (price >= 25) label = 'High Volatility'
    else if (price >= 20) label = 'Elevated'
    else if (price >= 15) label = 'Moderate'
    else if (price >= 12) label = 'Low Volatility'
    else label = 'Complacent'
    return { price, change, label }
  }, [isStocks, marketIndices])

  const altSeason = intel.altSeasonIndex
  const marketDominance = intel.dominance

  // Stocks mode: Risk On/Off
  const stocksRiskOnOff = useMemo(() => {
    if (!isStocks) return { value: 50, label: 'Neutral', sp500: 0, nasdaq: 0 }
    const spyCh = stockPrices?.SPY?.change ?? 0
    const qqqCh = stockPrices?.QQQ?.change ?? 0
    const vixPrice = liveVix?.price ?? 20
    const perfScore = (spyCh + qqqCh) / 2
    const vixScore = Math.max(0, Math.min(100, 100 - (vixPrice - 10) * 3.3))
    const composite = Math.round((perfScore * 8 + vixScore * 0.5 + 50) * 0.7)
    const value = Math.max(0, Math.min(100, composite))
    const label = value >= 65 ? 'Risk On' : value <= 35 ? 'Risk Off' : 'Neutral'
    return {
      value, label,
      sp500: spyCh != null ? Number(spyCh).toFixed(1) : '0.0',
      nasdaq: qqqCh != null ? Number(qqqCh).toFixed(1) : '0.0',
    }
  }, [isStocks, stockPrices, liveVix])

  // Index Allocation
  const indexAllocation = useMemo(() => {
    if (!isStocks) return { sp500: 45, nasdaq: 28, smallCap: 12, commodities: 15 }
    const spyMcap = stockPrices?.SPY?.marketCap ?? 45e12
    const qqqMcap = stockPrices?.QQQ?.marketCap ?? 28e12
    const iwmMcap = stockPrices?.IWM?.marketCap ?? 12e12
    const gldMcap = stockPrices?.GLD?.marketCap ?? 15e12
    const total = spyMcap + qqqMcap + iwmMcap + gldMcap
    if (total <= 0) return { sp500: 45, nasdaq: 28, smallCap: 12, commodities: 15 }
    return {
      sp500: (spyMcap / total) * 100,
      nasdaq: (qqqMcap / total) * 100,
      smallCap: (iwmMcap / total) * 100,
      commodities: (gldMcap / total) * 100,
    }
  }, [isStocks, stockPrices])

  const usMarketStatus = useUsMarketStatus()
  const eventState = useNextEconomicEvent()

  // Market structure
  const btcFund = intel.fundingRates.btc
  const ethFund = intel.fundingRates.eth
  const aiAnalyse = intel.aiAnalyse

  // Self-contained derivatives snapshot.
  // The bundle-compose path (useMarketIntel → aiAnalyse) has historically been
  // flaky in HMR/closure-cache scenarios and produced four $0 cards. Fetching
  // straight off the data API guarantees the AI Market panel always renders
  // real numbers, regardless of bundle state. 60s polling + visibility guard.
  const [derivSnap, setDerivSnap] = useState({
    openInterestUsd: 0,
    liqLong: 0,
    liqShort: 0,
    liqTotal: 0,
    fundingBtcPct: null,
    fundingEthPct: null,
    whaleFlowUsd: 0,
  })
  const fetchDerivSnap = useCallback(async () => {
    if (isStocks || typeof document !== 'undefined' && document.hidden) return
    try {
      // CoinGlass is the source of truth for total OI + 24h liquidations so
      // numbers match coinglass.com / what users see on Traders Corner. The
      // Spectre /v1/derivatives endpoints are only used for funding (asset
      // weighted) and as a fallback when CoinGlass is rate-limited.
      //
      // Each request gets its own 8s timeout via AbortController so one slow
      // endpoint can't stall the entire AI Market panel for 30+ seconds.
      // Failed/timed-out promises fall through to allSettled's "rejected"
      // bucket and the downstream "status === 'fulfilled'" guards skip them.
      const fetchWithTimeout = (url, ms = 8000) => {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), ms)
        return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer))
      }
      // CoinGlass stays a raw fetch (different origin path). The three v1
      // derivatives reads go through getV1Json so they share the same INFLIGHT
      // + 30s cache as getSpectreIntelBundle — previously each was fetched
      // twice on home (once here, once in the bundle) for identical URLs.
      const [cgOiRes, cgLiqRes, fundingJson, spectreOiJson, spectreLiqJson] = await Promise.all([
        fetchWithTimeout('/api/coinglass/total-oi').then(r => r.ok ? r.json() : null).catch(() => null),
        fetchWithTimeout('/api/coinglass/total-liquidations?range=24h').then(r => r.ok ? r.json() : null).catch(() => null),
        getV1Json('/derivatives/funding-rates'),
        getV1Json('/derivatives/open-interest?limit=500'),
        // liquidation-windows is optional (CoinGlass is the primary source
        // above) and its upstream route is degraded right now - inside the
        // spectreai.io showcase iframe skip the probe so its 404 doesn't
        // dirty the host page's console.
        IS_SHOWCASE_EMBED ? Promise.resolve(null) : getV1Json('/derivatives/liquidation-windows'),
      ])

      // Sum CoinGlass exchange rows → market-wide OI (matches coinglass.com)
      let openInterestUsd = 0
      if (cgOiRes) {
        const rows = Array.isArray(cgOiRes?.data) ? cgOiRes.data : []
        openInterestUsd = rows.reduce((s, r) => s + (Number(r?.open_interest_usd) || 0), 0)
      }
      // Spectre fallback: sum oi_usd across the paged asset rows
      if (!openInterestUsd && spectreOiJson) {
        openInterestUsd = Number(spectreOiJson?.meta?.total_oi_usd) || 0
        if (!openInterestUsd) {
          const rows = Array.isArray(spectreOiJson?.data) ? spectreOiJson.data : Array.isArray(spectreOiJson?.rows) ? spectreOiJson.rows : []
          openInterestUsd = rows.reduce((s, r) => s + (Number(r?.oi_usd ?? r?.total_oi_usd) || 0), 0)
        }
      }

      // Sum CoinGlass exchange rows → 24h liquidations (matches coinglass.com)
      let liqLong = 0, liqShort = 0, liqTotal = 0
      if (cgLiqRes) {
        const rows = Array.isArray(cgLiqRes?.data) ? cgLiqRes.data : []
        for (const r of rows) {
          liqLong  += Number(r?.long_liquidation_usd  ?? r?.long_liquidation_usd_24h  ?? 0) || 0
          liqShort += Number(r?.short_liquidation_usd ?? r?.short_liquidation_usd_24h ?? 0) || 0
        }
        liqTotal = liqLong + liqShort
      }
      // Spectre fallback only if CoinGlass returned no rows
      if (!liqTotal && spectreLiqJson) {
        const w24 = spectreLiqJson?.data?.windows?.['24h'] || spectreLiqJson?.windows?.['24h']
        if (w24) {
          liqLong = Number(w24.long) || 0
          liqShort = Number(w24.short) || 0
          liqTotal = Number(w24.total) || liqLong + liqShort
        }
      }

      let fundingBtcPct = null, fundingEthPct = null
      if (fundingJson) {
        const rows = Array.isArray(fundingJson?.data) ? fundingJson.data : []
        const btcRow = rows.find(r => (r.asset || '').toUpperCase() === 'BTC')
        const ethRow = rows.find(r => (r.asset || '').toUpperCase() === 'ETH')
        if (btcRow) fundingBtcPct = Number(btcRow.rate ?? btcRow.weighted_funding_rate) * 100
        if (ethRow) fundingEthPct = Number(ethRow.rate ?? ethRow.weighted_funding_rate) * 100
      }
      // Whale flow estimate: derive from liq imbalance (a meaningful proxy
      // when no dedicated whale-flow endpoint exists yet).
      const whaleFlowUsd = liqShort - liqLong
      setDerivSnap({ openInterestUsd, liqLong, liqShort, liqTotal, fundingBtcPct, fundingEthPct, whaleFlowUsd })
    } catch (_) { /* silent */ }
  }, [isStocks])
  const _derivTabActive = DERIVATIVES_TABS.includes(marketAiTab)
  // perf: defer the initial 5-call derivatives snapshot off the first-paint
  // path. These feed the AI Market panel (below the fold); kicking the fetch on
  // the idle tick after paint keeps boot requests from competing with first
  // render. Cards already start at $0 and populate async, so no visual change.
  useEffect(() => {
    if (isStocks || !_derivTabActive) return
    const ric = (typeof window !== 'undefined' && window.requestIdleCallback) || ((cb) => setTimeout(cb, 200))
    const cancel = (typeof window !== 'undefined' && window.cancelIdleCallback) || clearTimeout
    const id = ric(() => fetchDerivSnap())
    return () => cancel(id)
  }, [fetchDerivSnap, isStocks, _derivTabActive])
  useAdaptivePolling(fetchDerivSnap, { interval: 60_000, enabled: !isStocks && _derivTabActive })

  const marketStructureTrio = useMemo(() => {
    // Prefer the self-contained snapshot above. Fall back to aiAnalyse for any
    // field the snapshot hasn't populated yet (e.g. first render before fetch).
    const liq = {
      long: derivSnap.liqLong || aiAnalyse.liquidations?.long || 0,
      short: derivSnap.liqShort || aiAnalyse.liquidations?.short || 0,
      total: derivSnap.liqTotal || aiAnalyse.liquidations?.total || 0,
    }
    const whaleUsd = derivSnap.whaleFlowUsd || aiAnalyse.whaleFlowUsd || 0
    const whaleDir = whaleUsd > 500000 ? 'inflow' : whaleUsd < -500000 ? 'outflow' : 'neutral'
    // Funding card reads (rate * 100).toFixed(3) on a fractional value. The
    // service path used to return rate*100 already, so cards rendered 0.000%.
    // We pass raw fractions here so the panel's formula produces real values.
    const fundingBtcFrac = derivSnap.fundingBtcPct != null ? derivSnap.fundingBtcPct / 100 : btcFund
    const fundingEthFrac = derivSnap.fundingEthPct != null ? derivSnap.fundingEthPct / 100 : ethFund
    return {
      funding: [
        { symbol: 'BTC', rate: fundingBtcFrac, label: fundingBtcFrac >= 0 ? 'Longs pay' : 'Shorts pay', healthy: Math.abs(fundingBtcFrac) < 0.05 },
        { symbol: 'ETH', rate: fundingEthFrac, label: fundingEthFrac >= 0 ? 'Longs pay' : 'Shorts pay', healthy: Math.abs(fundingEthFrac) < 0.05 },
      ],
      liquidations: { longUsd: liq.long, shortUsd: liq.short, totalUsd: liq.total, bias: liq.long > liq.short ? 'longs' : 'shorts' },
      whaleFlows: { usd: whaleUsd, net: Math.round(whaleUsd / 1e6), unit: 'M', label: 'Whale net', direction: whaleDir },
      openInterest: derivSnap.openInterestUsd || aiAnalyse.openInterest || 0,
      conviction: aiAnalyse.conviction || 0,
      riskLevel: aiAnalyse.riskLevel || 'moderate',
      verdict: aiAnalyse.verdict || '',
      regime: aiAnalyse.regime,
      state: aiAnalyse.state,
      asText: aiAnalyse.asText,
    }
  }, [btcFund, ethFund, aiAnalyse, derivSnap])
  const marketFlowSummary = intel.flowSummary

  // Macro analysis
  const [marketAiTimeframe, setMarketAiTimeframe] = useState('24h')
  // Scalar deps: only re-fire when actual BTC/ETH/SOL price/change move (not on every Binance poll re-keying)
  const btcPrice = topCoinPrices?.BTC?.price
  const btcChange = topCoinPrices?.BTC?.change
  const ethPrice = topCoinPrices?.ETH?.price
  const ethChange = topCoinPrices?.ETH?.change
  const solPrice = topCoinPrices?.SOL?.price
  const solChange = topCoinPrices?.SOL?.change
  const baseMacroAnalysis = useMemo(
    () => computeMacroAnalysis({ marketAiTimeframe, topCoinPrices, fearGreed, isStocks, stockPrices, marketIndices, liveVix }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [marketAiTimeframe, btcPrice, btcChange, ethPrice, ethChange, solPrice, solChange, fearGreed.value, fearGreed.classification, isStocks, stockPrices, marketIndices, liveVix]
  )

  // Fetch real AI-generated market analysis text — timeframe-aware.
  // Server pipeline: /api/market/ai-market-text?timeframe=1h|24h|7d drives the
  // marketAnalysisAgent which pulls OUR live prices/funding/OI/liquidations
  // and asks Perplexity to write a 3-part brief that matches the selected
  // timeframe window. Switching the timeframe below forces a refetch so the
  // article immediately reflects the new window.
  // aiMarketText is tagged with both timeframe AND market so the blend below
  // never shows a crypto brief under the stocks toggle (or vice versa) during
  // the moment the user flips market mode and the refetch is still in flight.
  // Per-(market × timeframe) brief cache. Flipping the 1H/24H/7D pills is now
  // INSTANT for any window already loaded — the panel reads the cached brief
  // for the new key immediately, so it never drops back to the local template
  // and never refires the LLM fetch just to see the same window again. This is
  // the "weird lag skip" fix: a single `aiMarketText` held only the LAST window,
  // so every switch mismatched → template flash → refetch → swap again. The
  // 5-min poll still refreshes the ACTIVE window in place (same key stays
  // matched, so the update is seamless — no flash).
  const [aiMarketTextByKey, setAiMarketTextByKey] = useState({})
  const BRIEF_TTL_MS = 5 * 60 * 1000
  const briefKey = `${isStocks ? 'stocks' : 'crypto'}:${marketAiTimeframe}`
  // Read the cache via a ref inside fetchAiText so the callback identity doesn't
  // change when the cache fills (which would refire the effect and re-poll).
  const briefCacheRef = useRef(aiMarketTextByKey)
  briefCacheRef.current = aiMarketTextByKey

  const fetchAiText = useCallback(async ({ force = false } = {}) => {
    const market = isStocks ? 'stocks' : 'crypto'
    const key = `${market}:${marketAiTimeframe}`
    // Serve the cache when this exact window is already fresh — no network, no
    // LLM spend, no flash. A poll passes force to bypass the TTL and refresh.
    const cached = briefCacheRef.current[key]
    if (!force && cached?.analysis && Date.now() - (cached.ts || 0) < BRIEF_TTL_MS) return
    try {
      const res = await fetch(`/api/market/ai-market-text?timeframe=${encodeURIComponent(marketAiTimeframe)}&market=${market}`)
      if (!res.ok) return
      const data = await res.json()
      // Tag the response with the timeframe + market we requested so downstream
      // consumers can verify they're reading the right window (the backend
      // may omit it from the payload).
      if (data?.analysis) {
        setAiMarketTextByKey((prev) => ({ ...prev, [key]: { ...data, timeframe: marketAiTimeframe, market, ts: Date.now() } }))
      }
    } catch { /* silent - template fallback */ }
  }, [marketAiTimeframe, isStocks])

  // Both crypto AND stocks now fetch a real LLM brief from the server (stocks
  // route to the equities agent via &market=stocks). Previously stocks were
  // gated out entirely and only ever saw the static client template.
  useEffect(() => {
    if (briefTabActive) fetchAiText()
  }, [briefTabActive, fetchAiText])

  useAdaptivePolling(() => fetchAiText({ force: true }), { interval: BRIEF_TTL_MS, enabled: briefTabActive })

  const macroAnalysisData = useMemo(() => {
    const wantMarket = isStocks ? 'stocks' : 'crypto'
    const result = { ...baseMacroAnalysis }

    // Only consume an LLM brief that matches BOTH the active timeframe AND the
    // active market — otherwise a stale crypto brief could leak under the
    // stocks toggle (and vice versa) during a mode switch. The static template
    // in baseMacroAnalysis (computed locally from live prices + sentiment) is
    // always the fallback so the panel is never blank or mismatched.
    const brief = aiMarketTextByKey[briefKey]
    const briefMatches = brief?.analysis
      && brief?.timeframe === marketAiTimeframe
      // market may be undefined on older cached responses; treat as crypto.
      && (brief?.market || 'crypto') === wantMarket

    if (briefMatches) {
      result.p1 = brief.analysis
      result.lastUpdated = brief.ts || Date.now()
      if (brief.macroConditions) result.p2 = brief.macroConditions
      if (brief.positioning) result.p3 = brief.positioning
      if (brief.sources) result.sources = brief.sources
      if (brief.timeframe) result.timeframe = brief.timeframe
      return result
    }

    // Crypto-only 24H fallback: the brain.verdict is the daily "current read"
    // and only makes sense on 24H. Stocks have no brain, so they fall straight
    // through to the live-data template until the equities brief lands.
    if (!isStocks && marketAiTimeframe === '24h') {
      const brain = aiAnalyse
      if (brain?.verdict && brain?.conviction > 0) {
        result.p1 = brain.verdict
        result.lastUpdated = brain.ts || Date.now()
      }
    }

    return result
  }, [baseMacroAnalysis, aiMarketTextByKey, briefKey, aiAnalyse, isStocks, marketAiTimeframe])

  // TA Analysis (scalar deps for top-coin prices — see baseMacroAnalysis above)
  const taAnalysis = useMemo(
    () => computeTaAnalysis({ topCoinPrices, fngValue: fearGreed.value, btcDominance: marketDominance.btc, marketStructureTrio, currencySymbol: currencySymbol || '$', t }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [btcPrice, btcChange, ethPrice, ethChange, solPrice, solChange, fearGreed.value, marketDominance.btc, marketStructureTrio, currencySymbol, t]
  )

  // Sentiment RGB
  const sentimentRgb = useMemo(() => {
    if (isStocks) {
      const v = liveVix?.price
      if (v != null && v >= 25) return '255, 69, 58'
      if (v != null && v <= 15) return '48, 209, 88'
      return '142, 142, 147'
    }
    const fng = fearGreed?.value
    if (fng >= 65) return '48, 209, 88'
    if (fng <= 35) return '255, 69, 58'
    return '142, 142, 147'
  }, [isStocks, liveVix?.price, fearGreed?.value])

  const biasRgb = useMemo(() => {
    const b = macroAnalysisData?.bias
    if (b === 'bullish') return '48, 209, 88'
    if (b === 'bearish') return '255, 69, 58'
    return '142, 142, 147'
  }, [macroAnalysisData?.bias])

  // AI Brief
  const briefHook = useAiBrief({
    isStocks, topCoinPrices, stockPrices, marketIndices,
    liveVix, fearGreed, fmtPrice, t, i18n, macroAnalysisData,
    briefTabActive,
  })

  // Share handlers
  const [isBriefShareExporting, setIsBriefShareExporting] = useState(false)
  const [briefShareModalOpen, setBriefShareModalOpen] = useState(false)
  const [briefShareImageUrl, setBriefShareImageUrl] = useState(null)
  const [briefShareDescription, setBriefShareDescription] = useState('')
  const [isWelcomeShareExporting, setIsWelcomeShareExporting] = useState(false)
  const [welcomeShareModalOpen, setWelcomeShareModalOpen] = useState(false)
  const [welcomeShareImageUrl, setWelcomeShareImageUrl] = useState(null)
  const [welcomeShareDescription, setWelcomeShareDescription] = useState('')

  const handleShareBrief = useCallback(async () => {
    if (isBriefShareExporting || !briefHook.briefDisplay) return
    setIsBriefShareExporting(true)
    setBriefShareImageUrl(null)
    setBriefShareModalOpen(true)
    try {
      const { imageUrl, description } = await generateBriefShareCard({
        briefDisplay: briefHook.briefDisplay, briefIndex: briefHook.briefIndex,
        fearGreed, liveVix, isStocks, topCoinPrices, stockPrices, macroAnalysisData,
      })
      setBriefShareDescription(description)
      setBriefShareImageUrl(imageUrl)
    } catch (err) {
      console.error('Brief share failed:', err)
      setBriefShareModalOpen(false)
    }
    setIsBriefShareExporting(false)
  }, [isBriefShareExporting, briefHook.briefDisplay, briefHook.briefIndex, fearGreed, liveVix, isStocks, topCoinPrices, stockPrices, macroAnalysisData])

  const handleShareWelcome = useCallback(async () => {
    if (isWelcomeShareExporting) return
    setIsWelcomeShareExporting(true)
    setWelcomeShareImageUrl(null)
    setWelcomeShareModalOpen(true)
    try {
      const { imageUrl, description } = await generateWelcomeShareCard({
        topCoinPrices, fearGreed, marketDominance,
        isStocks, profile, fmtPrice, stockPrices,
      })
      setWelcomeShareDescription(description)
      setWelcomeShareImageUrl(imageUrl)
    } catch (err) {
      console.error('Welcome share failed:', err)
      setWelcomeShareModalOpen(false)
    }
    setIsWelcomeShareExporting(false)
  }, [isWelcomeShareExporting, profile, topCoinPrices, fearGreed, marketDominance, isStocks, fmtPrice, stockPrices])

  // Mood wall
  const spxChangeForClass = useMemo(() => {
    if (!stockPrices) return 0
    const spy = stockPrices['SPY'] || stockPrices['spy']
    return parseFloat(spy?.change || spy?.changePercent || 0)
  }, [stockPrices])

  const sentimentScore = useMemo(() => {
    const btcCh = topCoinPrices?.BTC?.change != null ? Number(topCoinPrices.BTC.change) : 0
    return Math.max(0, Math.min(100, Math.round(50 + btcCh * 10)))
  }, [topCoinPrices])

  const moodWallSentimentClass = useMemo(() => {
    if (isStocks) {
      if (spxChangeForClass >= 0.3) return ' sentiment-bullish'
      if (spxChangeForClass <= -0.3) return ' sentiment-bearish'
      return ' sentiment-neutral'
    }
    if (sentimentScore >= 60) return ' sentiment-bullish'
    if (sentimentScore <= 35) return ' sentiment-bearish'
    return ' sentiment-neutral'
  }, [sentimentScore, isStocks, spxChangeForClass])

  const moodWallPrimaryRgb = useMemo(() => {
    if (isStocks) {
      if (spxChangeForClass >= 0.3) return '16, 185, 129'
      if (spxChangeForClass <= -0.3) return '185, 28, 28'
      return '89, 86, 213'
    }
    if (sentimentScore >= 60) return '16, 185, 129'
    if (sentimentScore <= 35) return '185, 28, 28'
    return '89, 86, 213'
  }, [sentimentScore, isStocks, spxChangeForClass])

  const moodWallSecondaryRgb = useMemo(() => {
    if (isStocks) {
      if (spxChangeForClass >= 0.3) return '20, 160, 100'
      if (spxChangeForClass <= -0.3) return '153, 27, 27'
      return '99, 102, 241'
    }
    if (sentimentScore >= 60) return '20, 160, 100'
    if (sentimentScore <= 35) return '153, 27, 27'
    return '99, 102, 241'
  }, [sentimentScore, isStocks, spxChangeForClass])

  return {
    intel,
    breakingArticle,
    breakingHeadlines,
    alphaFeed,
    liveActivity,
    fearGreed,
    liveVix,
    altSeason,
    marketDominance,
    stocksRiskOnOff,
    indexAllocation,
    usMarketStatus,
    eventState,
    marketStructureTrio,
    marketFlowSummary,
    marketAiTimeframe, setMarketAiTimeframe,
    macroAnalysisData,
    taAnalysis,
    sentimentRgb,
    biasRgb,
    // Brief
    ...briefHook,
    // Share
    isBriefShareExporting,
    briefShareModalOpen, setBriefShareModalOpen,
    briefShareImageUrl, setBriefShareImageUrl,
    briefShareDescription,
    isWelcomeShareExporting,
    welcomeShareModalOpen, setWelcomeShareModalOpen,
    welcomeShareImageUrl, setWelcomeShareImageUrl,
    welcomeShareDescription,
    handleShareBrief,
    handleShareWelcome,
    // Mood wall
    sentimentScore,
    moodWallSentimentClass,
    moodWallPrimaryRgb,
    moodWallSecondaryRgb,
  }
}
