/**
 * Research Zone PRO — Center Content Only
 * All sections render on one page (no tab switching).
 * Anchor nav above the chart scrolls to each section.
 */
import React, { useMemo, useRef, Suspense } from 'react'
import lazy from '@/lib/lazy-with-retry'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import useMarketIntel from '@/hooks/useMarketIntel'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import useTokenBrandColor from '@/hooks/useTokenBrandColor'
import { buildGradientFromHex } from '@/utils/dynamic-token-color'
import RzMarketsSection from './rz-markets-section'
import SpectreLoader from '@/components/spectre-loader'
import './research-zone-pro.css'

// Each tab is hundreds-to-thousands of lines and only one renders at a
// time, so eager imports were forcing every visit to parse all five.
const IntelligenceTab = lazy(() => import('./rz-overview-tab'))
const SentimentTab = lazy(() => import('./rz-sentiment-tab'))
const TechnicalsTab = lazy(() => import('./rz-technicals-tab'))
const ProjectTab = lazy(() => import('./rz-project-tab'))
const StockSentimentTab = lazy(() => import('./rz-stock-sentiment'))


const RzProCenter = React.memo(function RzProCenter({
  activeTab = 'markets',
  symbol = 'BTC',
  tokenData = {},
  dayMode = false,
  activeTokenInfo,
  coinDetails = null,
  isStock = false,
  spectreSentScore = null,
  spectreFearGreed = null,
  spectreSocial = null,
  spectreTweets = null,
  influencerTweets = null,
  socialFeedTweets = null,
  spectreMarketDetails = null,
  onChainData = null,
  tokenProfile = null,
  apiScenario = null,
  fundamentalsGrades = null,
  sectorData = null,
  sectorAiAnalysis = null,
  marketsProps = null,
  tokenLogo = null,
  tokenAddress = null,
}) {
  const { fmtPrice, fmtLarge } = useCurrency()
  const { t } = useTranslation()
  // The intel bundle feeds ONLY the Technicals tab here, and Technicals reads
  // just fundingRates/longShortRatio/openInterest (3 numbers for the macro
  // section) - so it runs in 'deriv' mode: 3 derivatives endpoints instead of
  // the full 8-upstream bundle with its 500-symbol price enrichment (~220KB).
  // SentimentTab consumes nothing from intel (verified 2026-07-07: the props
  // were destructured but never read), so 'sentiment' no longer enables it.
  const intelEnabled = !isStock && activeTab === 'technicals'
  const intel = useMarketIntel(60000, { enabled: intelEnabled, mode: 'deriv' })
  const filtersPortalRef = useRef(null)

  const sym = (symbol || 'BTC').toUpperCase()
  // Token brand color: curated TOKEN_ROW_COLORS → server KV → canvas extraction → hash
  const brand = useTokenBrandColor(sym, tokenLogo, tokenAddress)
  const tokenColor = useMemo(() => {
    const curated = TOKEN_ROW_COLORS[sym]
    if (curated) return curated
    return { bg: brand.rgb, gradient: brand.gradient || `linear-gradient(135deg, rgb(${brand.rgb}) 0%, rgb(${brand.rgb}) 100%)` }
  }, [sym, brand])

  const td = useMemo(() => {
    const rawPrice = parseFloat(tokenData.price)
    const rawChange = parseFloat(tokenData.change24h)
    return {
      price: Number.isFinite(rawPrice) ? rawPrice : null,
      change24h: Number.isFinite(rawChange) ? rawChange : null,
      marketCap: tokenData.marketCap || tokenData.mcap || null,
      volume: tokenData.volume || tokenData.volume24h || null,
      name: tokenData.name || sym,
      logo: tokenData.logo || null,
      cgId: tokenData.cgId || tokenData.coingeckoId || null,
      rank: tokenData.rank || null,
      fdv: tokenData.fdv || tokenData.marketCap || tokenData.mcap || null,
      totalSupply: tokenData.totalSupply || tokenData.maxSupply || null,
      circulatingSupply: tokenData.circulatingSupply || tokenData.circulating || null,
      // contract + categories so the sentiment engine can detect an on-chain
      // fixed-supply memecoin and quote full-supply (FDV) mcap like the market
      // does, without waiting on the async X Dash payload.
      contract: tokenData.contract || tokenData.address || null,
      categories: Array.isArray(tokenData.categories) ? tokenData.categories : null,
      score: tokenData.score ?? null,
      low24h: tokenData.low24h ?? null,
      high24h: tokenData.high24h ?? null,
      ath: tokenData.ath ?? null,
      athDate: tokenData.athDate ?? null,
      athChangePct: tokenData.athChangePct ?? null,
      atl: tokenData.atl ?? null,
      atlDate: tokenData.atlDate ?? null,
      atlChangePct: tokenData.atlChangePct ?? null,
      volMcapPct: tokenData.volMcapPct ?? null,
      change1h: parseFloat(tokenData.change1h) || null,
      change7d: parseFloat(tokenData.change7d) || null,
      change30d: parseFloat(tokenData.change30d) || null,
      // Equity fields (undefined for crypto) — the stock Technicals tab reads
      // these for the equity structure block + index macro chips.
      beta: tokenData.beta ?? null,
      week52High: tokenData.week52High ?? null,
      week52Low: tokenData.week52Low ?? null,
      avgVolume: tokenData.avgVolume ?? null,
      earningsDate: tokenData.earningsDate ?? null,
      exchange: tokenData.exchange ?? null,
      targetMeanPrice: tokenData.targetMeanPrice ?? null,
      recommendationKey: tokenData.recommendationKey ?? null,
      analystCount: tokenData.analystCount ?? null,
    }
  }, [tokenData, sym])

  const aiAnalysis = useMemo(() => {
    const details = tokenProfile?.token_details
    if (!details) return null
    const support = details.key_levels?.support
    const resistance = details.key_levels?.resistance
    const trend = details.ai_insight
    if (!support && !resistance && !trend) return null
    return {
      trend: trend || null,
      support: support != null ? fmtPrice(support) : null,
      resistance: resistance != null ? fmtPrice(resistance) : null,
      quickTA: details.quick_ta || null,
    }
  }, [tokenProfile, fmtPrice])

  // Crowd gauge input: the SAME ticker tweets the right rail shows (lite's
  // stock-tweets effect), merged + deduped once per feed change — not per tick.
  const stockTweetPool = useMemo(() => {
    if (!isStock) return null
    const all = [
      ...(Array.isArray(spectreTweets) ? spectreTweets : []),
      ...(Array.isArray(socialFeedTweets) ? socialFeedTweets : []),
      ...(Array.isArray(influencerTweets) ? influencerTweets : []),
    ]
    return all.filter((t, i) => all.findIndex((x) => x.id === t.id) === i)
  }, [isStock, spectreTweets, socialFeedTweets, influencerTweets])

  // Stocks: Markets + Sentiment (equity desk read + crowd) + Technicals.
  // Project/Intelligence stay crypto-only until their equity data legs land
  // (stocks-ta-sentiment-plan.md Phase 2).
  if (isStock) {
    return (
      <div
        className={`rz-pro-center ${dayMode ? 'day-mode' : ''}`}
        style={{ '--rz-token-rgb': tokenColor.bg }}
      >
        {activeTab === 'technicals' ? (
          <div className="rz-pro-section">
            <Suspense fallback={<div style={{ padding: '60px 24px' }}><SpectreLoader variant="skeleton" label={`Loading ${sym} technicals`} /></div>}>
            <TechnicalsTab
              sym={sym} td={td} tokenColor={tokenColor}
              fmtPrice={fmtPrice} dayMode={dayMode}
              activeTokenInfo={activeTokenInfo}
              tokenProfile={tokenProfile}
              fundamentalsGrades={null}
              assetClass="stock"
            />
            </Suspense>
          </div>
        ) : activeTab === 'sentiment' ? (
          <div className="rz-pro-section">
            <Suspense fallback={<div style={{ padding: '60px 24px' }}><SpectreLoader variant="skeleton" label={`Loading ${sym} sentiment`} /></div>}>
            <StockSentimentTab sym={sym} tweets={stockTweetPool} />
            </Suspense>
          </div>
        ) : (
          <div className="rz-pro-section">
            {marketsProps ? <RzMarketsSection {...marketsProps} /> : null}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={`rz-pro-center ${dayMode ? 'day-mode' : ''}`}
      style={{ '--rz-token-rgb': tokenColor.bg }}
    >
      {/* Markets section */}
      {activeTab === 'markets' && (
        <div className="rz-pro-section">
          {marketsProps ? <RzMarketsSection {...marketsProps} filtersPortalRef={filtersPortalRef} /> : null}
        </div>
      )}

      {/* Project section */}
      {activeTab === 'project' && (
        <div className="rz-pro-section">
          <Suspense fallback={<div style={{ padding: '60px 24px' }}><SpectreLoader variant="skeleton" label={`Loading ${sym} project`} /></div>}>
          <ProjectTab
            sym={sym} td={td}
            fmtPrice={fmtPrice}
            tokenColor={tokenColor}
            coinDetails={coinDetails}
            spectreSocial={spectreSocial}
            tokenProfile={tokenProfile}
            onChainData={onChainData}
            activeTokenInfo={activeTokenInfo}
          />
          </Suspense>
        </div>
      )}

      {/* Intelligence section */}
      {activeTab === 'intelligence' && (
        <div className="rz-pro-section">
          <Suspense fallback={<div style={{ padding: '60px 24px' }}><SpectreLoader variant="skeleton" label={`Loading ${sym} intelligence`} /></div>}>
          <IntelligenceTab
            sym={sym} td={td} aiAnalysis={aiAnalysis}
            fmtPrice={fmtPrice} fmtLarge={fmtLarge}
            coinDetails={coinDetails} dayMode={dayMode}
            spectreSentScore={spectreSentScore}
            spectreFearGreed={spectreFearGreed} spectreTweets={spectreTweets}
            spectreMarketDetails={spectreMarketDetails}
            onChainData={onChainData}
            aiAnalyse={intel.aiAnalyse}
            dominance={intel.dominance}
            liveEvents={intel.liveEvents}
            marketScenario={apiScenario || intel.scenario}
            spectreSocial={spectreSocial}
            tokenProfile={tokenProfile}
            fundamentalsGrades={fundamentalsGrades}
            sectorData={sectorData?.length ? sectorData : intel.sectorPerformance}
            sectorAiAnalysis={sectorAiAnalysis}
          />
          </Suspense>
        </div>
      )}

      {/* Sentiment section */}
      {activeTab === 'sentiment' && (
        <div className="rz-pro-section">
          <Suspense fallback={<div style={{ padding: '60px 24px' }}><SpectreLoader variant="skeleton" label={`Loading ${sym} sentiment`} /></div>}>
          <SentimentTab
            sym={sym} td={td} dayMode={dayMode}
            spectreTweets={spectreTweets}
            influencerTweets={influencerTweets}
            socialFeedTweets={socialFeedTweets}
            spectreSocial={spectreSocial}
            tokenProfile={tokenProfile}
            fundamentalsGrades={fundamentalsGrades}
          />
          </Suspense>
        </div>
      )}

      {/* Technicals section */}
      {activeTab === 'technicals' && (
        <div className="rz-pro-section">
          <Suspense fallback={<div style={{ padding: '60px 24px' }}><SpectreLoader variant="skeleton" label={`Loading ${sym} technicals`} /></div>}>
          <TechnicalsTab
            sym={sym} td={td} tokenColor={tokenColor}
            fmtPrice={fmtPrice} dayMode={dayMode}
            fundingRates={intel.fundingRates}
            longShortRatio={intel.longShortRatio}
            openInterest={intel.openInterest}
            activeTokenInfo={activeTokenInfo}
            tokenProfile={tokenProfile}
            fundamentalsGrades={fundamentalsGrades}
          />
          </Suspense>
        </div>
      )}
    </div>
  )
})

export default RzProCenter
