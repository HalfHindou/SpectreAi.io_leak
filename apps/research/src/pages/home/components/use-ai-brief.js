/**
 * useAiBrief - custom hook for "The Brief" rotating AI intelligence statements.
 * Extracted from WelcomePage for maintainability.
 *
 * Returns: { theBriefStatement, allBriefStatements, briefIndex, briefFading,
 *            briefDisplay, terminalIsFullBrief, goToBrief,
 *            handleBriefTouchStart, handleBriefTouchEnd, briefPausedRef }
 */
import { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import useAdaptivePolling from '@/hooks/useAdaptivePolling'
import { sanitizeAiText } from '@/lib/sanitizeAiText'
// One definition of "is this an alert", shared with the serverless handler
// that generates it (api/_lib/handlers/brief-api.js) so generation and display
// cannot drift. See that module for why the rule is code and not prompt.
import { isUsableAlert, isUsableHeadline, checkBreaking, stripSourceBranding } from '@/lib/alertQuality'
import { getSpectreNews } from '@/services/spectreMarketApi'

const BRIEF_INTERVAL = 12000
const BRIEF_FULL_INTERVAL = 30000 // 30s for AI Outlook slide
const BRIEF_FADE = 600
const BREAKING_POLL_INTERVAL = 60000 // poll breaking news every 60s
// Past this, a headline is history, not an alert. The wire files something
// every few minutes, so this only bites when the feed itself has stalled —
// in which case "No active alerts" is the true answer.
const ALERT_MAX_AGE_MS = 12 * 60 * 60 * 1000
// The fast lane gets a much tighter window, because SPEED is the entire reason
// to read it. A monitored account posting minutes ago is why we bypass the
// outlets; the same post five hours later is just an old post that still
// carries a `severity:breaking` label, and it will interrupt somebody with a
// story the wire has since covered properly. Measured on 2026-08-17: every
// row in the lane was 5-16 hours old, and the freshest of them — a WSJ feature
// on North Korean IT workers — cleared the event test on the word "stolen".
const BREAKING_MAX_AGE_MS = 90 * 60 * 1000

// Belt-and-suspenders: never render a raw URL in the cinematic brief, even if
// a linky item slips past the upstream editorial filter (isEditorialNewsItem).
function cleanAlertText(text) {
  if (!text || typeof text !== 'string') return text
  return text
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\b(?:t\.co|bit\.ly|buff\.ly|lnkd\.in|dlvr\.it)\/\S*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim()
}

// ─── Market-relevance gate for the Alerts slide ─────────────────────────────
// The breaking feed carries thought-leadership essays and project blog posts
// (e.g. Eigen Labs' "Open Innovation for Frontier Research", 2026-08-14) that
// read as nonsense when framed as a market ALERT. An item only qualifies when
// its text names a market asset/venue, a market or macro EVENT, or a money
// figure. Generic tech words (AI, web3, blockchain, token) deliberately do NOT
// qualify — they are exactly what the essay class is made of.
const ALERT_ASSET_RE = /\b(?:bitcoin|btc|ethereum|eth|solana|sol|xrp|bnb|doge(?:coin)?|cardano|avalanche|chainlink|polkadot|litecoin|tron|sui|hyperliquid|crypto(?:currenc\w*)?|altcoins?|stablecoins?|memecoins?|defi|binance|coinbase|kraken|okx|bybit|tether|usdt|usdc|nasdaq|s&p|sp500|dow|russell|treasur\w*|equit\w*|stocks?|etfs?|bonds?|gold|silver|crude|brent|forex|dxy|dollar|yen|euro)\b/i
const ALERT_EVENT_RE = /\b(?:rall(?:y|ies)|surg\w*|plung\w*|crash\w*|dump\w*|pump\w*|sell-?offs?|liquidat\w*|all-?time[- ]high|ath|record[- ]high|breakout\w*|correction\w*|tumbl\w*|soar\w*|spik\w*|slump\w*|sink(?:s|ing)?|jump\w*|drop(?:s|ped)?|fell|falls?|rises?|rose|bull\w*|bear\w*|volatil\w*|sec|cftc|lawsuit\w*|sue[sd]?|regulat\w*|approv\w*|reject\w*|listing\w*|delist\w*|halving|hack\w*|exploit\w*|breach\w*|outflow\w*|inflow\w*|buyback\w*|acquisition\w*|acquir\w*|merger\w*|ipo|earnings|fed|fomc|rate[- ](?:cut|hike)s?|interest rates?|cpi|ppi|inflation|gdp|payrolls?|unemployment|tariffs?|yields?|futures|options|funding round|valuation\w*|market ?cap|whal\w*|short squeeze|liquidity)\b/i
const ALERT_MONEY_RE = /\$\s?\d/
function isMarketAlertItem(item) {
  const text = `${item?.title || item?.headline || ''} ${item?.summary || item?.description || ''}`
  if (!text.trim()) return false
  return ALERT_ASSET_RE.test(text) || ALERT_EVENT_RE.test(text) || ALERT_MONEY_RE.test(text)
}

export default function useAiBrief({
  isStocks,
  topCoinPrices,
  stockPrices,
  marketIndices,
  liveVix,
  fearGreed,
  fmtPrice,
  t,
  i18n,
  macroAnalysisData,
  briefTabActive = true,
}) {
  // ─── Breaking News / Alerts slide (AI-synthesised) ───
  const [breakingNews, setBreakingNews] = useState(null) // raw article metadata
  const [alertsBrief, setAlertsBrief] = useState(null)   // LLM-synthesised text

  // Build a market-data payload for the synthesis endpoint
  const buildMarketPayload = useCallback(() => {
    const md = {}
    if (isStocks) {
      const spy = stockPrices?.SPY || marketIndices?.SPY
      const qqq = stockPrices?.QQQ || marketIndices?.QQQ
      const aapl = stockPrices?.AAPL
      if (spy) md.spy = { price: Number(spy.price), change: Number(spy.change || 0) }
      if (qqq) md.qqq = { price: Number(qqq.price), change: Number(qqq.change || 0) }
      if (aapl) md.aapl = { price: Number(aapl.price), change: Number(aapl.change || 0) }
      if (liveVix) md.vix = { price: liveVix.price }
    } else {
      const btc = topCoinPrices?.BTC
      const eth = topCoinPrices?.ETH
      const sol = topCoinPrices?.SOL
      if (btc) md.btc = { price: Number(btc.price), change: Number(btc.change || 0) }
      if (eth) md.eth = { price: Number(eth.price), change: Number(eth.change || 0) }
      if (sol) md.sol = { price: Number(sol.price), change: Number(sol.change || 0) }
      if (fearGreed?.value != null) md.fearGreed = { value: fearGreed.value }
    }
    return md
  }, [isStocks, topCoinPrices, stockPrices, marketIndices, liveVix, fearGreed])

  const fetchBreakingSynthesis = useCallback(async () => {
    try {
      // THE ALERT IS THE EVENT. Big event off the fast lane if there is one,
      // otherwise the newest real headline. Nobody's byline either way.
      //
      // Three things were wrong before. FIRST, this only ever read
      // /v1/news/breaking, which despite the name is the MONITOR lane: at
      // 15:20Z on 2026-08-17 it held 55 rows of "XRP funding flip: -0.0001% ->
      // 0.0000%" telemetry and 45 raw tweets, and a five-hour-old tweet is
      // what the slide was showing. The editorial wire is /v1/news, and it was
      // there the whole time with stories minutes old — nothing read it.
      //
      // SECOND, the row was printed as its SUMMARY, which is a paragraph. A
      // headline is the story already compressed to one line by someone whose
      // job that is. Use it.
      //
      // THIRD, the fast lane cannot be taken at its word. It is genuinely fast
      // — that is why the Telegram bot's Breaking channel runs off it — but
      // the box scores every post from a monitored account 80-90 and labels it
      // severity:breaking. The joke that started all this arrived that way, at
      // score 85. So the lane is used for what it is good at, gated to real
      // events, and stripped of the posting handle before anything renders.
      const [urgent, wire] = await Promise.all([
        getSpectreNews({ breaking: true, limit: 12 }).catch(() => []),
        getSpectreNews({ limit: 10 }).catch(() => []),
      ])
      const ageOf = (r) => {
        const ts = r?.publishedAt ? new Date(r.publishedAt).getTime() : 0
        return Number.isFinite(ts) && ts > 0 ? Date.now() - ts : Infinity
      }
      const fresh = (r) => ageOf(r) < ALERT_MAX_AGE_MS

      // TIER 1 — the fast lane, BIG EVENTS ONLY. Monitored VIP accounts reach
      // us within seconds, well ahead of the outlets, which is why the
      // Telegram bot runs its Breaking channel off this lane. What the lane
      // does not do is judge: the box scores every post from a monitored
      // account 80-90 and stamps it severity:breaking, so a marketing tweet
      // arrives labelled like a rate decision. checkBreaking is the Telegram
      // bot's own gate — strip the byline, then require the sentence to
      // describe something that HAPPENED — and it returns the branding-free
      // text, which is what we print. The event, never somebody's masthead.
      for (const r of Array.isArray(urgent) ? urgent : []) {
        if (ageOf(r) > BREAKING_MAX_AGE_MS || !isMarketAlertItem(r)) continue
        const verdict = checkBreaking(cleanAlertText(r.title || r.summary))
        if (!verdict.ok) continue
        setBreakingNews(r)
        setAlertsBrief(verdict.text)
        return
      }

      // TIER 2 — the wire. Nothing big is breaking, so lead with the newest
      // real story rather than an empty slide. A headline needs no event test:
      // an outlet does not file unless something happened.
      const wireRow = (Array.isArray(wire) ? wire : []).find((r) => {
        const line = stripSourceBranding(cleanAlertText(r?.title || r?.summary))
        return fresh(r) && isMarketAlertItem(r) && isUsableHeadline(line)
      })
      if (wireRow) {
        setBreakingNews(wireRow)
        setAlertsBrief(stripSourceBranding(cleanAlertText(wireRow.title || wireRow.summary)))
        return
      }

      if (import.meta.env.DEV) {
        setBreakingNews(null)
        setAlertsBrief(null)
        return
      }

      const res = await fetch('/api/brief/breaking-synthesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketData: buildMarketPayload(), language: i18n.language || 'en' }),
      })
      if (!res.ok) { setBreakingNews(null); setAlertsBrief(null); return }
      const data = await res.json()
      // Same gate on the server-picked article: the synthesis endpoint reads
      // the same feed, so a non-market essay can come back LLM-paraphrased.
      // Judge the source article when present, else the synthesis text itself.
      // Two different questions, two different gates. The ARTICLE is judged on
      // topicality (headlines legitimately carry no figure). The SYNTHESIS is
      // the thing we are about to print as an alert, so it is judged on
      // whether it IS one.
      const serverOk = data?.hasBreaking && data.synthesis &&
        isUsableAlert(data.synthesis) &&
        (data.article ? isMarketAlertItem(data.article) : true)
      if (serverOk) {
        setBreakingNews(data.article)
        setAlertsBrief(cleanAlertText(data.synthesis))
      } else {
        setBreakingNews(null)
        setAlertsBrief(null)
      }
    } catch {
      setBreakingNews(null)
      setAlertsBrief(null)
    }
  }, [buildMarketPayload, i18n.language])

  // Latest-ref so the mount effect only fires on tab-toggle, not every time
  // upstream prices update (topCoinPrices ticks every 5s → fetchBreakingSynthesis
  // gets a new identity → without this ref each tick was firing another POST
  // to /api/brief/breaking-synthesis. Observed: 5+ duplicates per page load.
  const latestFetchBreakingRef = useRef(fetchBreakingSynthesis)
  latestFetchBreakingRef.current = fetchBreakingSynthesis
  useEffect(() => { if (briefTabActive) latestFetchBreakingRef.current() }, [briefTabActive])

  useAdaptivePolling(fetchBreakingSynthesis, { interval: BREAKING_POLL_INTERVAL, enabled: briefTabActive })

  // Final alert text: LLM synthesis → fallback to "no active alerts"
  const alertsText = sanitizeAiText(alertsBrief || t('brief.noActiveAlerts'))
  // ─── "The Brief" - Rotating AI intelligence statements ───
  const theBriefStatements = useMemo(() => {
    if (isStocks) {
      // ══ STOCK MODE BRIEFS ══
      const spy = stockPrices?.SPY || marketIndices?.SPY
      const qqq = stockPrices?.QQQ || marketIndices?.QQQ
      const aapl = stockPrices?.AAPL
      const vixVal = liveVix?.price ?? null
      const spyPrice = spy?.price ? fmtPrice(Number(spy.price)) : null
      const spyCh = spy?.change != null ? Number(spy.change) : 0
      const qqqCh = qqq?.change != null ? Number(qqq.change) : 0
      const aaplCh = aapl?.change != null ? Number(aapl.change) : 0
      const avg = (spyCh + qqqCh + aaplCh) / 3

      const now = new Date()
      const hour = now.getHours()
      const dayOfWeek = now.getDay()
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
      const isFriday = dayOfWeek === 5
      const isMonday = dayOfWeek === 1
      const isMorning = hour >= 5 && hour < 12
      const isAfternoon = hour >= 12 && hour < 17
      const dayName = [t('dayNames.sunday'), t('dayNames.monday'), t('dayNames.tuesday'), t('dayNames.wednesday'), t('dayNames.thursday'), t('dayNames.friday'), t('dayNames.saturday')][dayOfWeek]

      const movers = [
        { name: 'SPY', ch: spyCh },
        { name: 'QQQ', ch: qqqCh },
        { name: 'AAPL', ch: aaplCh },
      ].sort((a, b) => Math.abs(b.ch) - Math.abs(a.ch))
      const leader = movers[0]
      const maxMove = Math.max(Math.abs(spyCh), Math.abs(qqqCh), Math.abs(aaplCh))
      const isCalm = maxMove < 0.5
      const isSelling = avg < -2
      const isRallying = avg > 2

      const briefs = []

      // Brief 1: VIX + SPY anchor
      {
        const parts = []
        if (vixVal != null) {
          if (vixVal >= 30) parts.push(`${t('brief.vixAt')} ${vixVal.toFixed(1)}. ${t('brief.extremeVolatility')}`)
          else if (vixVal >= 25) parts.push(`${t('brief.vixAt')} ${vixVal.toFixed(1)}. ${t('brief.elevatedVolatility')}`)
          else if (vixVal >= 20) parts.push(`${t('brief.vixAt')} ${vixVal.toFixed(1)}. ${t('brief.volatilityElevated')}`)
          else if (vixVal >= 15) parts.push(`${t('brief.vixAt')} ${vixVal.toFixed(1)}. ${t('brief.moderateVolatility')}`)
          else parts.push(`${t('brief.vixAt')} ${vixVal.toFixed(1)}. ${t('brief.lowVolatilityComplacent')}`)
        }
        if (spyPrice) {
          if (spyCh > 1.5) parts.push(`${t('brief.spyBreakingHigher')} ${spyPrice}.`)
          else if (spyCh > 0) parts.push(`${t('brief.spyHolding')} ${spyPrice}.`)
          else if (spyCh < -1.5) parts.push(`${t('brief.spyUnderPressure')} ${spyPrice}.`)
          else parts.push(`${t('brief.spySteady')} ${spyPrice}.`)
        }
        if (leader && Math.abs(leader.ch) > 1) {
          parts.push(`${leader.name} ${leader.ch > 0 ? t('brief.leadingUp') : t('brief.laggingBehind')} ${Math.abs(leader.ch).toFixed(1)}%.`)
        }
        if (avg > 1.5) parts.push(t('brief.broadStrength'))
        else if (avg > 0.5) parts.push(t('brief.buyersPresent'))
        else if (avg < -1.5) parts.push(t('brief.sellingPressure'))
        else if (avg < -0.5) parts.push(t('brief.mildWeakness'))
        else parts.push(t('brief.rangeBoundReveal'))
        briefs.push(parts.join(' '))
      }

      // Brief 2: Time-of-day + market context
      {
        let timePart = ''
        if (isWeekend) timePart = `${dayName}. ${t('brief.weekendReview')}`
        else if (isFriday && isAfternoon) timePart = `${dayName}. ${t('brief.fridaySquaring')} ${t('brief.endOfWeekSqueezes')}`
        else if (isMonday && isMorning) timePart = `${dayName}. ${t('brief.mondayInstitutional')}`
        else if (isMorning) timePart = `${dayName}. ${t('brief.preMarket')}`
        else timePart = `${dayName}. ${t('brief.regularSession')}`

        if (spyPrice) {
          if (avg > 1) timePart += ` S&P ${spyPrice}. ${t('brief.momentumUpside')}`
          else if (avg < -1) timePart += ` S&P ${spyPrice}. ${t('brief.riskManagementKey')}`
          else timePart += ` S&P ${spyPrice}. ${t('brief.marketsFindingEquilibrium')}`
        }
        briefs.push(timePart)
      }

      // Brief 3: Narrative
      {
        let narrative = ''
        if (isSelling && avg < -3) {
          narrative = `${t('brief.sharpSelloff')} ${Math.abs(avg).toFixed(1)}%. ` +
            `${vixVal != null && vixVal >= 25 ? `${t('brief.vixAt')} ${vixVal.toFixed(1)}. ${t('brief.capitulationRecoveries')}` : t('brief.focusQuality')}`
        } else if (isRallying && avg > 3) {
          narrative = `${t('brief.strongRally')} ${leader.name} +${Math.abs(leader.ch).toFixed(1)}%. ` +
            `${vixVal != null && vixVal <= 13 ? `${t('brief.vixAt')} ${vixVal.toFixed(1)}. ${t('brief.marketHumblesComplacent')}` : t('brief.momentumBuilding')}`
        } else if (isSelling) {
          narrative = `${t('brief.steadySelling')} ${Math.abs(avg).toFixed(1)}%. ${t('brief.focusQuality')}`
        } else if (isCalm) {
          narrative = spyPrice
            ? `${t('brief.compression')} S&P ${spyPrice}, ${maxMove.toFixed(1)}%. ${vixVal != null ? `${t('brief.vixAt')} ${vixVal.toFixed(1)}.` : ''} ${t('brief.calmBeforeMove')}`
            : t('brief.calmBeforeMove')
        } else {
          narrative = spyPrice
            ? `S&P ${spyPrice}. ${t('brief.measuredMoves')} ${t('brief.stockSelectionOverIndex')}`
            : t('brief.stockSelectionOverIndex')
        }
        briefs.push(narrative)
      }

      // Brief 4: Wisdom
      {
        let wisdom = ''
        if (vixVal != null && vixVal >= 30) {
          wisdom = `${t('brief.vixAt')} ${vixVal.toFixed(1)}. ${t('brief.extremeVolatility')} ${t('brief.priceLeadsSentiment')} ` +
            `S&P ${spyPrice || '..'}. ${t('brief.buyingVixSpikes')}`
        } else if (vixVal != null && vixVal <= 12) {
          wisdom = `${t('brief.vixAt')} ${vixVal.toFixed(1)}. ${t('brief.lowVolatilityComplacent')} ${t('brief.marketHumblesComplacent')}`
        } else if (isCalm && !isWeekend) {
          wisdom = `${t('brief.marketGivingTime')} ${t('brief.bestTradesFromWaiting')}`
        } else if (avg > 0.5 && avg < 2) {
          wisdom = `S&P ${spyPrice || '..'}. ${t('brief.steadyGrindHigher')}`
        } else if (avg < -0.5 && avg > -2) {
          wisdom = t('brief.pullbacksAsOpportunities')
        } else {
          wisdom = `${spyPrice ? `S&P ${spyPrice}. ` : ''}${t('brief.bestTradeNoTrade')}`
        }
        briefs.push(wisdom)
      }

      // Brief 5: Data-driven
      {
        const allGreen = spyCh > 0 && qqqCh > 0 && aaplCh > 0
        const allRed = spyCh < 0 && qqqCh < 0 && aaplCh < 0
        let macro = ''
        if (!spyPrice) {
          // No live quote yet (Yahoo cold/slow) - the change values are all
          // zero defaults, not real data. Show a generic line instead of the
          // fabricated "SPY +0.0%, QQQ +0.0%, AAPL +0.0%".
          macro = t('brief.stockPickingOverIndex')
        } else if (allGreen && avg > 1) {
          macro = `${t('brief.allMajorsGreen')} SPY +${spyCh.toFixed(1)}%, QQQ +${qqqCh.toFixed(1)}%, AAPL +${aaplCh.toFixed(1)}%. ` +
            `${vixVal != null && vixVal <= 14 ? `${t('brief.vixAt')} ${vixVal.toFixed(1)}.` : t('brief.institutionalConviction')}`
        } else if (allRed && avg < -1) {
          macro = `${t('brief.allMajorsRed')} SPY ${spyCh.toFixed(1)}%, QQQ ${qqqCh.toFixed(1)}%, AAPL ${aaplCh.toFixed(1)}%. ` +
            `${vixVal != null && vixVal >= 25 ? `${t('brief.vixAt')} ${vixVal.toFixed(1)}.` : t('brief.sellersInControl')}`
        } else if (allGreen) {
          macro = `SPY +${spyCh.toFixed(1)}%, QQQ +${qqqCh.toFixed(1)}%, AAPL +${aaplCh.toFixed(1)}%. ` +
            t('brief.steadyBidUnder')
        } else if (allRed) {
          macro = `SPY ${spyCh.toFixed(1)}%, QQQ ${qqqCh.toFixed(1)}%, AAPL ${aaplCh.toFixed(1)}%. ` +
            t('brief.distributionOrDigestion')
        } else {
          const winner = movers[0].ch > 0 ? movers[0] : null
          const loser = movers[2].ch < 0 ? movers[2] : null
          if (winner && loser) {
            macro = `${t('brief.mixedSignals')} ${winner.name} +${winner.ch.toFixed(1)}%, ${loser.name} ${loser.ch.toFixed(1)}%. ` +
              t('brief.sectorRotationInPlay')
          } else {
            macro = `SPY ${spyCh >= 0 ? '+' : ''}${spyCh.toFixed(1)}%, QQQ ${qqqCh >= 0 ? '+' : ''}${qqqCh.toFixed(1)}%, AAPL ${aaplCh >= 0 ? '+' : ''}${aaplCh.toFixed(1)}%. ` +
              t('brief.stockPickingOverIndex')
          }
        }
        briefs.push(macro)
      }

      // Insert Alerts slide at position 1 (after Sentiment)
      briefs.splice(1, 0, alertsText)
      return briefs
    }

    // ══ CRYPTO MODE BRIEFS (original) ══
    const btc = topCoinPrices?.BTC
    const eth = topCoinPrices?.ETH
    const sol = topCoinPrices?.SOL
    const fng = fearGreed.value
    const btcPrice = btc?.price ? fmtPrice(btc.price) : null
    const btcCh = btc?.change != null ? Number(btc.change) : 0
    const ethCh = eth?.change != null ? Number(eth.change) : 0
    const solCh = sol?.change != null ? Number(sol.change) : 0
    const avg = (btcCh + ethCh + solCh) / 3

    // Time context
    const now = new Date()
    const hour = now.getHours()
    const dayOfWeek = now.getDay() // 0=Sun, 6=Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
    const isFriday = dayOfWeek === 5
    const isMonday = dayOfWeek === 1
    const isLateNight = hour >= 23 || hour < 5
    const isMorning = hour >= 5 && hour < 12
    const isAfternoon = hour >= 12 && hour < 17
    const dayName = [t('dayNames.sunday'), t('dayNames.monday'), t('dayNames.tuesday'), t('dayNames.wednesday'), t('dayNames.thursday'), t('dayNames.friday'), t('dayNames.saturday')][dayOfWeek]

    // Find the strongest mover
    const movers = [
      { name: 'BTC', ch: btcCh },
      { name: 'ETH', ch: ethCh },
      { name: 'SOL', ch: solCh },
    ].sort((a, b) => Math.abs(b.ch) - Math.abs(a.ch))
    const leader = movers[0]

    // Volatility context
    const maxMove = Math.max(Math.abs(btcCh), Math.abs(ethCh), Math.abs(solCh))
    const isVolatile = maxMove > 5
    const isCalm = maxMove < 1
    const isCrashing = avg < -5
    const isRallying = avg > 5
    const isBleeding = avg < -2 && avg > -5
    const isRecovering = avg > 0.5 && avg < 3 && fng != null && fng < 40
    const isDivergent = Math.abs(btcCh - solCh) > 4 || Math.abs(btcCh - ethCh) > 4

    // Collect all applicable briefs - each is context-aware
    const briefs = []

    // ═══ Brief 1: Classic sentiment + BTC anchor (always present) ═══
    {
      const parts = []
      if (fng != null) {
        if (fng <= 20) parts.push(t('brief.extremeFear'))
        else if (fng <= 35) parts.push(t('brief.fearInMarket'))
        else if (fng >= 80) parts.push(t('brief.extremeGreed'))
        else if (fng >= 65) parts.push(t('brief.greedBuilding'))
        else parts.push(t('brief.marketNeutral'))
      }
      if (btcPrice) {
        if (btcCh > 3) parts.push(`${t('brief.btcBreakingOut')} ${btcPrice}.`)
        else if (btcCh > 0) parts.push(`${t('brief.btcHolding')} ${btcPrice}.`)
        else if (btcCh < -3) parts.push(`${t('brief.btcUnderPressure')} ${btcPrice}.`)
        else parts.push(`${t('brief.btcSteady')} ${btcPrice}.`)
      }
      if (leader && Math.abs(leader.ch) > 2) {
        parts.push(`${leader.name} ${leader.ch > 0 ? t('brief.leadingUp') : t('brief.leadingDown')} ${Math.abs(leader.ch).toFixed(1)}%.`)
      }
      if (avg > 3) parts.push(t('brief.momentumReal'))
      else if (avg > 1) parts.push(t('brief.buyersStepping'))
      else if (avg < -3) parts.push(t('brief.capitulationSignals'))
      else if (avg < -1) parts.push(t('brief.weaknessAcrossBoard'))
      else parts.push(t('brief.rangeBoundPatience'))
      briefs.push(parts.join(' '))
    }

    // ═══ Brief 2: Time-of-day + market vibe ═══
    {
      let timePart = ''
      if (isWeekend && isCalm) timePart = `${dayName}. ${t('brief.thinWeekendLiquidity')}`
      else if (isWeekend && isVolatile) timePart = `${dayName}. ${t('brief.weekendMovesDeceptive')}`
      else if (isWeekend) timePart = `${dayName}. ${t('brief.thinWeekendLiquidity')}`
      else if (isFriday && isAfternoon) timePart = `${dayName}. ${t('brief.lockingInPositions')} ${t('brief.endOfWeekSqueezes')}`
      else if (isMonday && isMorning) timePart = `${dayName}. ${t('brief.freshCapitalEntering')}`
      else if (isLateNight) timePart = `${dayName}. ${t('brief.asianMarketsActive')}`
      else if (isMorning) timePart = `${dayName}. ${t('brief.europeanSessionOpen')}`
      else timePart = `${dayName}. ${t('brief.usSessionFullSwing')}`

      if (btcPrice) {
        if (avg > 2) timePart += ` BTC ${btcPrice}. ${t('brief.momentumUpside')}`
        else if (avg < -2) timePart += ` BTC ${btcPrice}. ${t('brief.rangeBoundPatience')}`
        else timePart += ` BTC ${btcPrice}. ${t('brief.marketsFindingEquilibrium')}`
      }
      briefs.push(timePart)
    }

    // ═══ Brief 3: Narrative / storytelling brief ═══
    {
      let narrative = ''
      if (isCrashing) {
        narrative = `${t('brief.bloodInWater')} ${Math.abs(avg).toFixed(1)}%. ` +
          `${fng != null && fng <= 25 ? t('brief.capitulationSignals') : t('brief.panicSellingExpensive')}`
      } else if (isRallying) {
        narrative = `${t('brief.marketOnFire')} ${leader.name} +${Math.abs(leader.ch).toFixed(1)}%. ` +
          `${fng != null && fng >= 75 ? t('brief.protectYourGains') : t('brief.momentumBuilding')}`
      } else if (isBleeding) {
        narrative = `${t('brief.grindLower')} ${Math.abs(avg).toFixed(1)}%. ${t('brief.hardestToNavigate')}`
      } else if (isRecovering) {
        narrative = `${t('brief.signsOfRecovery')} ${leader.name} +${leader.ch.toFixed(1)}%. ` +
          `${t('brief.sentimentNotCaughtUp')}`
      } else if (isDivergent) {
        const strong = movers[0]
        const weak = movers[2]
        narrative = `${strong.name} +${strong.ch.toFixed(1)}%, ${weak.name} ${weak.ch.toFixed(1)}%. ` +
          t('brief.rotationHappening')
      } else if (isCalm) {
        narrative = btcPrice
          ? `${t('brief.compression')} BTC ${btcPrice}, ${maxMove.toFixed(1)}%. ${t('brief.breakoutForming')}`
          : t('brief.calmBeforeMove')
      } else {
        narrative = btcPrice
          ? `BTC ${btcPrice}. ${t('brief.measuredMoves')}`
          : t('brief.measuredMoves')
      }
      briefs.push(narrative)
    }

    // ═══ Brief 4: Trader psychology / wisdom ═══
    {
      let wisdom = ''
      if (fng != null && fng <= 20) {
        wisdom = `${t('brief.othersAreFearful')} BTC ${btcPrice || '..'}. ${t('brief.extremeFear')}`
      } else if (fng != null && fng >= 80) {
        wisdom = t('brief.everyonesAGenius')
      } else if (isWeekend && isBleeding) {
        wisdom = `${t('brief.thinBooksAmplified')} ${dayName}. ${t('brief.weekendMovesDeceptive')}`
      } else if (isCalm && !isWeekend) {
        wisdom = `${t('brief.bestTradesFromWaiting')} ${t('brief.marketGivingTime')}`
      } else if (avg > 1 && avg < 3) {
        wisdom = `BTC ${btcPrice || '..'}. ${t('brief.steadyHandsCompound')}`
      } else if (avg < -1 && avg > -3) {
        wisdom = t('brief.tradingPlanOrEmotions')
      } else {
        wisdom = `${btcPrice ? `BTC ${btcPrice}. ` : ''}${t('brief.bestTradeNoTrade')}`
      }
      briefs.push(wisdom)
    }

    // ═══ Brief 5: Data-driven macro read ═══
    {
      const allGreen = btcCh > 0 && ethCh > 0 && solCh > 0
      const allRed = btcCh < 0 && ethCh < 0 && solCh < 0
      let macro = ''
      if (allGreen && avg > 2) {
        macro = `${t('brief.allMajorsGreen')} BTC +${btcCh.toFixed(1)}%, ETH +${ethCh.toFixed(1)}%, SOL +${solCh.toFixed(1)}%. ` +
          `${fng != null && fng > 60 ? t('brief.greedFueledRally') : `${t('brief.broadBasedStrength')} ${t('brief.healthyAccumulation')}`}`
      } else if (allRed && avg < -2) {
        macro = `${t('brief.allMajorsRed')} BTC ${btcCh.toFixed(1)}%, ETH ${ethCh.toFixed(1)}%, SOL ${solCh.toFixed(1)}%. ` +
          `${fng != null && fng < 30 ? `${t('brief.capitulationVibes')} ${t('brief.fearPeaksRelief')}` : t('brief.sellersInControl')}`
      } else if (allGreen) {
        macro = `BTC +${btcCh.toFixed(1)}%, ETH +${ethCh.toFixed(1)}%, SOL +${solCh.toFixed(1)}%. ` +
          t('brief.steadyBidUnder')
      } else if (allRed) {
        macro = `BTC ${btcCh.toFixed(1)}%, ETH ${ethCh.toFixed(1)}%, SOL ${solCh.toFixed(1)}%. ` +
          t('brief.distributionOrDigestion')
      } else {
        const winner = movers[0].ch > 0 ? movers[0] : null
        const loser = movers[2].ch < 0 ? movers[2] : null
        if (winner && loser) {
          macro = `${t('brief.mixedSignals')} ${winner.name} +${winner.ch.toFixed(1)}%, ${loser.name} ${loser.ch.toFixed(1)}%. ` +
            t('brief.sectorRotationOrIndecision')
        } else {
          macro = `BTC ${btcCh >= 0 ? '+' : ''}${btcCh.toFixed(1)}%, ETH ${ethCh >= 0 ? '+' : ''}${ethCh.toFixed(1)}%, SOL ${solCh >= 0 ? '+' : ''}${solCh.toFixed(1)}%. ` +
            t('brief.bestPlaySelective')
        }
      }
      briefs.push(macro)
    }

    // Insert Alerts slide at position 1 (after Sentiment)
    briefs.splice(1, 0, alertsText)
    return briefs
  }, [topCoinPrices, fearGreed.value, fearGreed.classification, isStocks, stockPrices, marketIndices, liveVix, fmtPrice, t, alertsText])

  // First statement as default (for terminal mode backward compat)
  const theBriefStatement = theBriefStatements[0] || ''

  // ── Comprehensive AI Brief (6th slide: "AI Outlook") ──
  const [comprehensiveBrief, setComprehensiveBrief] = useState(null)

  const fetchComprehensiveBrief = useCallback(async () => {
    try {
      // Build marketData payload from available state
      const marketData = {}
      if (isStocks) {
        const spy = stockPrices?.SPY
        const qqq = stockPrices?.QQQ
        const aapl = stockPrices?.AAPL
        if (!spy?.price && !qqq?.price) return // Guard: need at least one anchor price
        if (spy)  marketData.spy  = { price: Number(spy.price),  change: Number(spy.change  || 0) }
        if (qqq)  marketData.qqq  = { price: Number(qqq.price),  change: Number(qqq.change  || 0) }
        if (aapl) marketData.aapl = { price: Number(aapl.price), change: Number(aapl.change || 0) }
        if (liveVix) marketData.vix = { price: liveVix.price, label: liveVix.label }
        if (macroAnalysisData?.bias) marketData.bias = macroAnalysisData.bias
      } else {
        const btc = topCoinPrices?.BTC
        const eth = topCoinPrices?.ETH
        const sol = topCoinPrices?.SOL
        if (!btc?.price) return // Guard: need BTC at minimum
        if (btc) marketData.btc = { price: Number(btc.price), change: Number(btc.change || 0) }
        if (eth) marketData.eth = { price: Number(eth.price), change: Number(eth.change || 0) }
        if (sol) marketData.sol = { price: Number(sol.price), change: Number(sol.change || 0) }
        if (fearGreed?.value != null) marketData.fearGreed = { value: fearGreed.value, classification: fearGreed.classification }
        if (macroAnalysisData?.bias) marketData.bias = macroAnalysisData.bias
      }
      // Include existing brief texts for LLM context
      marketData.existingBriefs = theBriefStatements.slice(0, 5)

      if (import.meta.env.DEV) {
        const fallback = [
          macroAnalysisData?.p1,
          macroAnalysisData?.p2,
          macroAnalysisData?.p3,
        ].filter(Boolean).join(' ')
        if (fallback) setComprehensiveBrief(fallback)
        return
      }

      // Showcase iframe (spectreai.io marketing site) has a demo-session cookie
      // but no full auth-gate cookie. `/api/brief/generate` is POST-only and
      // gate-only by design (burns Anthropic per call). The cron-warmed
      // `/api/brief/showcase` returns the same shape from KV cache - we hit
      // that instead so the showcase renders real text without 401 spam.
      // 2026-05-13 SEC-20260513-017.
      const inShowcase = typeof window !== 'undefined'
        && /[?&]embed=showcase\b/.test(window.location.search)
      if (inShowcase) {
        const res = await fetch('/api/brief/showcase', { method: 'GET' })
        if (!res.ok) return
        const data = await res.json()
        if (data?.brief) setComprehensiveBrief(data.brief)
        return
      }

      const res = await fetch('/api/brief/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketMode: isStocks ? 'stocks' : 'crypto', marketData, language: i18n.language || 'en' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data?.brief) setComprehensiveBrief(data.brief)
    } catch (err) {
      // silently handled
    }
  }, [isStocks, topCoinPrices, stockPrices, liveVix, fearGreed, macroAnalysisData?.bias, theBriefStatements, i18n.language])

  // Same latest-ref pattern as fetchBreakingSynthesis above. Without this,
  // every price tick on topCoinPrices (5s cadence) regenerates the callback,
  // re-fires the effect, schedules another 3s timer → 4+ duplicate POSTs to
  // /api/brief/generate per page load (heavy LLM call, real $).
  const latestFetchComprehensiveRef = useRef(fetchComprehensiveBrief)
  latestFetchComprehensiveRef.current = fetchComprehensiveBrief
  useEffect(() => {
    if (!briefTabActive) return
    // Initial fetch after 3s delay (let market data load)
    const initialTimer = setTimeout(() => {
      latestFetchComprehensiveRef.current()
    }, 3000)
    return () => { clearTimeout(initialTimer) }
  }, [briefTabActive])

  // Gated by briefTabActive: comprehensive brief is the 7th slide of "The Brief",
  // never shown outside the Brief tab. The endpoint runs a heavy LLM call —
  // skipping it when the tab is inactive saves both quota and latency.
  useAdaptivePolling(fetchComprehensiveBrief, { interval: 5 * 60 * 1000, enabled: briefTabActive })

  // Re-fetch when market mode changes
  useEffect(() => {
    setComprehensiveBrief(null) // Clear old brief on mode switch
    const timer = setTimeout(fetchComprehensiveBrief, 1000)
    return () => clearTimeout(timer)
  }, [isStocks]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch when language changes
  useEffect(() => {
    setComprehensiveBrief(null)
    const timer = setTimeout(fetchComprehensiveBrief, 500)
    return () => clearTimeout(timer)
  }, [i18n.language]) // eslint-disable-line react-hooks/exhaustive-deps

  // Merge: 6 existing briefs + comprehensive AI Outlook as 7th.
  // sanitizeAiText strips em/en-dashes so the rotator output stays clean.
  const allBriefStatements = useMemo(() => {
    const base = [...theBriefStatements]
    if (comprehensiveBrief) base.push(comprehensiveBrief)
    return base.map(sanitizeAiText)
  }, [theBriefStatements, comprehensiveBrief])

  // Is the Alerts slide currently showing breaking news?
  const hasActiveBreaking = breakingNews != null

  // ── Terminal AI Brief rotation state ──
  const [briefIndex, setBriefIndex] = useState(0)
  const [briefFading, setBriefFading] = useState(false)
  const [briefDisplay, setBriefDisplay] = useState(allBriefStatements[0] || '')
  const briefTimerRef = useRef(null)
  const briefPausedRef = useRef(false)
  const scheduleBriefRotationRef = useRef(null)

  // Ref to hold the latest statements array — used by rotateBrief so it stays
  // stable and doesn't cause the timer to be cleared on every price update.
  const allBriefStatementsRef = useRef(allBriefStatements)
  allBriefStatementsRef.current = allBriefStatements

  // Detect if current terminal brief is the full AI Outlook
  const terminalIsFullBrief = briefIndex === allBriefStatements.length - 1 && allBriefStatements.length >= 7

  // Detect if current slide is the Alerts slide with active breaking
  const terminalIsBreaking = briefIndex === 1 && hasActiveBreaking

  // Get interval for current terminal brief index
  const getTerminalBriefInterval = useCallback((idx) => {
    if (idx === allBriefStatements.length - 1 && allBriefStatements.length >= 7) return BRIEF_FULL_INTERVAL
    return BRIEF_INTERVAL
  }, [allBriefStatements.length])

  // Sync display when statements content changes (e.g. prices load)
  useEffect(() => {
    if (allBriefStatements[briefIndex]) {
      setBriefDisplay(allBriefStatements[briefIndex])
    } else {
      setBriefIndex(0)
      setBriefDisplay(allBriefStatements[0] || '')
    }
  }, [allBriefStatements]) // eslint-disable-line react-hooks/exhaustive-deps

  // Rotate to next brief — reads statements from ref so this callback is stable
  // and doesn't cause the scheduling timer to reset on every price update.
  const rotateBrief = useCallback(() => {
    const stmts = allBriefStatementsRef.current
    if (stmts.length <= 1) return
    setBriefFading(true)
    setTimeout(() => {
      setBriefIndex(prev => {
        const stmtsNow = allBriefStatementsRef.current
        const next = (prev + 1) % stmtsNow.length
        setBriefDisplay(stmtsNow[next])
        return next
      })
      setTimeout(() => setBriefFading(false), 50)
    }, BRIEF_FADE)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-rotate with dynamic timing (setTimeout chain instead of setInterval)
  const scheduleBriefRotation = useCallback(() => {
    if (briefTimerRef.current) clearTimeout(briefTimerRef.current)
    if (allBriefStatements.length <= 1) return
    briefTimerRef.current = setTimeout(() => {
      if (!briefPausedRef.current) rotateBrief()
      // Use ref to always call the LATEST scheduleBriefRotation, avoiding stale closures
      setTimeout(() => { if (scheduleBriefRotationRef.current) scheduleBriefRotationRef.current() }, BRIEF_FADE + 100)
    }, getTerminalBriefInterval(briefIndex))
  }, [briefIndex, allBriefStatements.length, rotateBrief, getTerminalBriefInterval])
  // Keep ref in sync so recursive setTimeout always uses the latest version
  scheduleBriefRotationRef.current = scheduleBriefRotation

  useEffect(() => {
    scheduleBriefRotation()
    return () => { if (briefTimerRef.current) clearTimeout(briefTimerRef.current) }
  }, [scheduleBriefRotation])

  const goToBrief = useCallback((idx) => {
    if (idx === briefIndex || briefFading) return
    if (briefTimerRef.current) { clearTimeout(briefTimerRef.current); briefTimerRef.current = null }
    setBriefFading(true)
    setTimeout(() => {
      setBriefIndex(idx)
      setBriefDisplay(allBriefStatements[idx])
      setTimeout(() => setBriefFading(false), 50)
    }, BRIEF_FADE)
  }, [briefIndex, briefFading, allBriefStatements])

  // ── Touch swipe support for terminal brief ──
  const briefTouchX = useRef(null)
  const briefTouchY = useRef(null)
  const handleBriefTouchStart = useCallback((e) => {
    briefTouchX.current = e.touches[0].clientX
    briefTouchY.current = e.touches[0].clientY
    briefPausedRef.current = true
  }, [])
  const handleBriefTouchEnd = useCallback((e) => {
    if (briefTouchX.current == null || allBriefStatements.length <= 1) {
      briefPausedRef.current = false
      return
    }
    const dx = e.changedTouches[0].clientX - briefTouchX.current
    const dy = e.changedTouches[0].clientY - briefTouchY.current
    briefTouchX.current = null
    briefTouchY.current = null
    briefPausedRef.current = false
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) {
        goToBrief((briefIndex + 1) % allBriefStatements.length)
      } else {
        goToBrief((briefIndex - 1 + allBriefStatements.length) % allBriefStatements.length)
      }
    }
  }, [briefIndex, allBriefStatements.length, goToBrief])

  return {
    theBriefStatement,
    allBriefStatements,
    briefIndex,
    briefFading,
    briefDisplay,
    terminalIsFullBrief,
    terminalIsBreaking,
    hasActiveBreaking,
    breakingNews,
    breakingSynthesis: alertsBrief,
    goToBrief,
    handleBriefTouchStart,
    handleBriefTouchEnd,
    briefPausedRef,
    getTerminalBriefInterval,
  }
}
