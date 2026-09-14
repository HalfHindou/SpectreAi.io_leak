/**
 * HeatmapCommandPanel - Apple cinematic heatmap for Command Center.
 * Flat, zero-ornament design matching AI Market panel.
 * Sections: Signal bar → Tile grid (or Bubbles) → Movers table → Breadth → AI Analysis
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import BubblesPage from '@/pages/bubbles/components/bubbles-page'
import { useCurrency } from '@/hooks/useCurrency'
import { getSpectreGlobalMetrics } from '@/services/spectreMarketApi'
import LiquidityPulse from '@/components/liquidity-pulse'
import ChartWatermark from '@/components/chart-watermark'
import { computeLiquidityFlow, dollarFlow } from '@/lib/liquidity-flow'
import './heatmap-command-panel.css'

const fmt = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v) || 0
  return n.toFixed(2)
}

const STABLECOINS = new Set([
  'USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'USDP', 'USDD', 'GUSD',
  'FRAX', 'LUSD', 'CRVUSD', 'PYUSD', 'FDUSD', 'USDE', 'USDS', 'USD0', 'USD1',
])

export default function HeatmapCommandPanel({
  heatmapTokens,
  topCoinsTokens,
  topCoinPrices,
  fmtPrice,
  openTokenCardPopup,
  isStocks,
  dayMode,
  showBubbles = false,
  onToggleBubbles,
  onOpenFull,
}) {
  const { t } = useTranslation()
  const tokens = useMemo(() => {
    const source = heatmapTokens?.length > 0 ? heatmapTokens : (topCoinsTokens || [])
    const filtered = source.filter(t => isStocks || !STABLECOINS.has((t.symbol || '').toUpperCase()))
    const raw = filtered.slice(0, 24)
    return raw.map((token) => {
      const live = topCoinPrices?.[token.symbol] || topCoinPrices?.[token.symbol?.toUpperCase?.()] || {}
      const livePrice = live.price > 0 ? live.price : token.price
      const change = Number(live.change != null ? live.change : token.change) || 0
      return { ...token, livePrice, change }
    })
  }, [heatmapTokens, topCoinsTokens, topCoinPrices, isStocks])

  const stats = useMemo(() => {
    // 2026-05-26 beta-quality fix: require >=2 tokens so best/worst are distinct
    // (otherwise "0.0pp spread between the strongest and weakest assets" reads as
    // editorial copy when only one token is available).
    if (!tokens.length || tokens.length < 2) return null
    const gainers = tokens.filter(t => t.change > 0).length
    const losers = tokens.filter(t => t.change < 0).length
    const avgChange = tokens.reduce((s, t) => s + t.change, 0) / tokens.length
    const sorted = [...tokens].sort((a, b) => b.change - a.change)
    const best = sorted[0]
    const worst = sorted[sorted.length - 1]
    const sentiment = avgChange > 1.5 ? 'bullish' : avgChange < -1.5 ? 'bearish' : 'neutral'
    const breadthPct = Math.round((gainers / tokens.length) * 100)
    const breadthLabel = breadthPct >= 70 ? 'Strong' : breadthPct >= 50 ? 'Moderate' : breadthPct >= 30 ? 'Weak' : 'Very Weak'
    const changes = tokens.map(t => Math.abs(t.change))
    const avgVol = changes.reduce((s, c) => s + c, 0) / changes.length
    const volLabel = avgVol > 5 ? 'High' : avgVol > 2 ? 'Moderate' : 'Low'
    const top5 = tokens.slice(0, 5).reduce((s, t) => s + t.change, 0) / 5
    const restAvg = tokens.length > 5 ? tokens.slice(5).reduce((s, t) => s + t.change, 0) / (tokens.length - 5) : 0
    const concentration = Math.abs(top5 - restAvg) > 3 ? 'High' : Math.abs(top5 - restAvg) > 1 ? 'Moderate' : 'Low'

    // Market Structure paragraph
    let marketStructure = ''
    if (sentiment === 'bullish') {
      marketStructure = `Market showing broad strength with ${breadthPct}% of assets gaining. `
      marketStructure += concentration === 'High'
        ? 'Gains concentrated in large caps - smaller assets lagging behind. This suggests institutional-driven momentum rather than retail speculation.'
        : 'Rally is broad-based across market cap tiers, indicating healthy participation and sustainable upside potential.'
    } else if (sentiment === 'bearish') {
      marketStructure = `Market under pressure with ${100 - breadthPct}% of assets declining. `
      marketStructure += concentration === 'High'
        ? 'Large caps holding better than altcoins - classic risk-off rotation. Capital flowing toward perceived safety.'
        : 'Selling pressure distributed evenly across the board, suggesting macro-driven headwinds rather than sector-specific weakness.'
    } else {
      marketStructure = `Market in consolidation with ${breadthPct}% gaining and ${100 - breadthPct}% declining. No clear directional bias - typical of accumulation or distribution phases.`
    }

    // Volatility & Momentum paragraph
    let momentum = ''
    if (volLabel === 'High') {
      momentum = 'Elevated volatility across the board suggests active repositioning by larger players. '
      momentum += sentiment === 'bullish'
        ? 'Strong moves on the upside could extend if volume confirms. Watch for momentum exhaustion near resistance.'
        : sentiment === 'bearish'
          ? 'Sharp drawdowns may accelerate if key support levels break. Consider reducing exposure until volatility contracts.'
          : 'Wide swings in both directions - range-bound strategies may outperform directional bets here.'
    } else if (volLabel === 'Low') {
      momentum = 'Low volatility environment - compressed ranges often precede larger directional moves. '
      momentum += `The spread between top performer (${best?.symbol} at ${best?.change >= 0 ? '+' : ''}${fmt(best?.change)}%) and weakest (${worst?.symbol} at ${worst?.change >= 0 ? '+' : ''}${fmt(worst?.change)}%) is ${Math.abs(best?.change - worst?.change).toFixed(1)}pp, `
      momentum += Math.abs(best?.change - worst?.change) > 8 ? 'showing meaningful dispersion despite low average volatility.' : 'confirming the tight consolidation.'
    } else {
      momentum = `Moderate volatility with a ${Math.abs(best?.change - worst?.change).toFixed(1)}pp spread between the strongest and weakest assets. `
      momentum += 'Current conditions favor selective positioning rather than broad exposure.'
    }

    // Risk Assessment paragraph
    let risk = ''
    if (breadthPct >= 70 && volLabel !== 'High') {
      risk = 'Breadth is strong and volatility contained - favorable risk/reward for trend-following strategies.'
    } else if (breadthPct >= 70 && volLabel === 'High') {
      risk = 'Strong breadth but elevated volatility warrants tighter stops. Momentum is your friend until it reverses.'
    } else if (breadthPct <= 30) {
      risk = 'Weak breadth signals broad market stress. Defensive positioning and cash preservation take priority over new entries.'
    } else if (concentration === 'High') {
      risk = `Performance concentration is high - top 5 assets averaging ${top5 >= 0 ? '+' : ''}${top5.toFixed(1)}% versus ${restAvg >= 0 ? '+' : ''}${restAvg.toFixed(1)}% for the rest. Narrow leadership can be fragile.`
    } else {
      risk = 'Balanced market conditions with moderate breadth. Standard position sizing appropriate - no extreme signals either way.'
    }

    return { gainers, losers, avgChange, best, worst, sentiment, breadthPct, breadthLabel, volLabel, concentration, marketStructure, momentum, risk }
  }, [tokens])

  // ── Liquidity Pulse: money in / money out (this panel is a 24h view) ──
  const { fmtLarge } = useCurrency()
  const liquidityFlow = useMemo(
    () => computeLiquidityFlow(tokens, (tk) => tk.change, { topN: 3 }),
    [tokens]
  )
  const [globalMetrics, setGlobalMetrics] = useState(null)
  useEffect(() => {
    if (isStocks) return undefined
    let cancelled = false
    getSpectreGlobalMetrics()
      .then((m) => { if (!cancelled && m) setGlobalMetrics(m) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isStocks])
  const liquidityPulse = useMemo(() => {
    // Sum this board, exactly like the heatmap page. The CoinGecko global
    // aggregate that used to override this reads a different clock and
    // contradicted the tiles beneath it — see heatmaps-page.jsx for the
    // measurement. The whole-market CAP is still shown (it is honestly
    // labelled as the whole market); only the FLOW is summed from the tape.
    const hasGlobal = !isStocks && globalMetrics?.totalMarketCap > 0
    if (!liquidityFlow || liquidityFlow.coverage <= 0) return null
    const coverageLabel = `the top ${liquidityFlow.coverage} ${isStocks ? 'stocks' : 'tokens'}`
    return {
      net: liquidityFlow.net,
      coverageLabel,
      contributors: liquidityFlow?.contributors || [],
      totalMarketCap: hasGlobal ? globalMetrics.totalMarketCap : null,
      totalVolume: hasGlobal ? globalMetrics.totalVolume : null,
      changePct: hasGlobal ? globalMetrics.marketCapChange24h : null,
    }
  }, [liquidityFlow, isStocks, globalMetrics, tokens.length])

  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  if (!tokens.length) {
    return (
      <div className="hcp-loading">
        <div className="hcp-loading-skeleton">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="hcp-loading-cell animate-shimmer" />
          ))}
        </div>
      </div>
    )
  }

  const renderGrid = (isFullscreenView) => (
    <div className="hcp-grid">
      {tokens.map((token, idx) => {
        const { change, livePrice } = token
        const isPos = change >= 0
        const intensity = Math.min(1, Math.abs(change) / 8)
        const bgColor = isPos
          ? `rgba(16, 185, 129, ${(0.12 + intensity * 0.3).toFixed(3)})`
          : `rgba(239, 68, 68, ${(0.12 + intensity * 0.3).toFixed(3)})`
        const borderColor = isPos
          ? `rgba(16, 185, 129, ${(0.15 + intensity * 0.25).toFixed(3)})`
          : `rgba(239, 68, 68, ${(0.15 + intensity * 0.25).toFixed(3)})`
        const rowColors = TOKEN_ROW_COLORS[(token.symbol || '').toUpperCase()]
        const brandRgb = rowColors?.bg || '255, 255, 255'
        const isHero = idx < 2
        const area = idx === 0 ? 'hero1' : idx === 1 ? 'hero2' : `t${idx}`
        const delay = isFullscreenView ? 0 : (isHero ? idx * 60 : 80 + (idx - 2) * 25)

        return (
          <div
            key={token.symbol || idx}
            className={`hcp-tile ${isHero ? 'hcp-tile-hero' : ''} ${isPos ? 'is-positive' : 'is-negative'}`}
            style={{
              gridArea: area,
              '--tile-bg': bgColor,
              '--tile-border': borderColor,
              '--tile-brand-rgb': brandRgb,
              animationDelay: `${delay}ms`,
            }}
            onClick={() => openTokenCardPopup?.(token.symbol)}
          >
            <div className="hcp-tile-top">
              <div className="hcp-tile-logo">
                {token.logo ? <img src={token.logo} alt={token.symbol} loading="lazy" decoding="async" width="24" height="24" /> : <span>{token.symbol?.[0] || '?'}</span>}
              </div>
              <span className="hcp-tile-sym">{token.symbol}</span>
            </div>
            {(isHero || isFullscreenView) && <div className="hcp-tile-name">{token.name}</div>}
            <div className="hcp-tile-bot">
              <span className="hcp-tile-price">{livePrice ? fmtPrice(livePrice) : '-'}</span>
              <span className={`hcp-tile-chg ${isPos ? 'positive' : 'negative'}`}>
                {isPos ? '+' : ''}{fmt(change)}%
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )

  const fullscreenBtn = (
    <button
      className="hcp-fullscreen-btn"
      onClick={() => setFullscreen(f => !f)}
      title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
    >
      {fullscreen ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      )}
    </button>
  )

  return (
    <div className="hcp">
      {/* ─── Signal Bar ─── */}
      {stats && (
        <div className={`hcp-signal bias-${stats.sentiment}`}>
          <div className="hcp-signal-left">
            {onToggleBubbles && (
              <div className="hcp-view-pills">
                <button type="button" className={`hcp-view-pill ${!showBubbles ? 'active' : ''}`} onClick={() => onToggleBubbles(false)}>{t('homePage.heatmapCommandPanel.heatmapcommandpanel.heatmap', "Heatmap")}</button>
                <button type="button" className={`hcp-view-pill ${showBubbles ? 'active' : ''}`} onClick={() => onToggleBubbles(true)}>{t('homePage.heatmapCommandPanel.heatmapcommandpanel.bubbles', "Bubbles")}</button>
              </div>
            )}
            <span className="hcp-signal-dot" />
            <span className="hcp-signal-bias">{stats.sentiment.charAt(0).toUpperCase() + stats.sentiment.slice(1)}</span>
            <span className="hcp-signal-sep" />
            <span className="hcp-signal-tf">24H</span>
            {liquidityPulse && (
              <>
                <span className="hcp-signal-sep" />
                <LiquidityPulse
                  netFlow={liquidityPulse.net}
                  timeframeLabel="24h"
                  coverageLabel={liquidityPulse.coverageLabel}
                  fmtLarge={fmtLarge}
                  dayMode={dayMode}
                  align="left"
                  size="sm"
                />
              </>
            )}
          </div>
          <div className="hcp-signal-right">
            <span className="hcp-signal-meta">{stats.gainers} <span className="hcp-signal-meta-pos">▲</span></span>
            <span className="hcp-signal-sep" />
            <span className="hcp-signal-meta">{stats.losers} <span className="hcp-signal-meta-neg">▼</span></span>
            <span className="hcp-signal-sep" />
            <span className={`hcp-signal-avg ${stats.avgChange >= 0 ? 'pos' : 'neg'}`}>
              {stats.avgChange >= 0 ? '+' : ''}{stats.avgChange.toFixed(2)}%
            </span>
            {onOpenFull && (
              <button type="button" className="hcp-open-full" onClick={onOpenFull}>
                {t('homePage.heatmapCommandPanel.heatmapcommandpanel.openFull', "Open Full")}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H7M17 7v10" /></svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─── Visualization: Heatmap Grid or Bubbles ─── */}
      {showBubbles ? (
        <BubblesPage
          dayMode={dayMode}
          marketMode={isStocks ? 'stocks' : 'crypto'}
          compact
          onTokenClick={openTokenCardPopup}
        />
      ) : (
        <>
          <div className="hcp-grid-wrap">
            <div className="hcp-grid-header">
              <p className="hcp-grid-subtitle">
                Top {tokens.length} {isStocks ? 'equities' : 'assets'} by market cap - color intensity reflects 24h price momentum
              </p>
              {fullscreenBtn}
            </div>
            {renderGrid(false)}
            {/* Brand mark on the tile composition itself, so a cropped screenshot
                of the grid still carries it. pointer-events: none — tiles keep
                their hover/click. */}
            <ChartWatermark className="hcp-wm" />
          </div>

          {/* ─── Fullscreen Portal ─── */}
          {fullscreen && createPortal(
            <div className={`hcp-fullscreen${dayMode ? ' hcp-day' : ''}`}>
              <div className="hcp-fullscreen-toolbar">
                <span className="hcp-fullscreen-title">
                  {isStocks ? 'Spectre AI Equities Heatmap' : 'Spectre AI Crypto Heatmap'}
                </span>
                {fullscreenBtn}
              </div>
              {renderGrid(true)}
              <ChartWatermark className="hcp-wm hcp-wm--full" />
            </div>,
            document.body
          )}
        </>
      )}

      {/* ─── Top Movers ─── */}
      {stats && stats.best && (
        <div className="hcp-movers">
          <div className="hcp-movers-title-row">
            <span className="hcp-movers-title">{t('homePage.heatmapCommandPanel.heatmapcommandpanel.topMovers', "Top Movers")}</span>
            <span className="hcp-movers-subtitle">{t('homePage.heatmapCommandPanel.heatmapcommandpanel.biggestGainerAndLoserInTh', "Biggest gainer and loser in the last 24h")}</span>
          </div>
          <div className="hcp-movers-header">
            <span className="hcp-movers-col">{t('homePage.heatmapCommandPanel.heatmapcommandpanel.asset', "Asset")}</span>
            <span className="hcp-movers-col hcp-col-r">{t('homePage.heatmapCommandPanel.heatmapcommandpanel.price', "Price")}</span>
            <span className="hcp-movers-col hcp-col-r">24h</span>
          </div>
          {[stats.best, stats.worst].map((t) => {
            const ch = t?.change || 0
            return (
              <div key={t?.symbol} className="hcp-movers-row" onClick={() => openTokenCardPopup?.(t?.symbol)}>
                <span className="hcp-movers-name">
                  {t?.logo && <img src={t.logo} alt="" loading="lazy" decoding="async" width="18" height="18" className="hcp-movers-logo" />}
                  {t?.symbol}
                </span>
                <span className="hcp-movers-price">{t?.livePrice ? fmtPrice(t.livePrice) : '—'}</span>
                <span className={`hcp-movers-chg ${ch >= 0 ? 'pos' : 'neg'}`}>
                  {ch >= 0 ? '+' : ''}{fmt(ch)}%
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* ─── Breadth + Metrics ─── */}
      {stats && (
        <div className="hcp-metrics">
          <div className="hcp-metric">
            <span className="hcp-metric-label">{t('homePage.heatmapCommandPanel.heatmapcommandpanel.breadth', "Breadth")}</span>
            <span className="hcp-metric-value">{stats.breadthLabel}</span>
            <div className="hcp-breadth-bar">
              <div className="hcp-breadth-fill hcp-breadth-gain" style={{ width: `${stats.breadthPct}%` }} />
            </div>
          </div>
          <span className="hcp-metric-sep" />
          <div className="hcp-metric">
            <span className="hcp-metric-label">{t('homePage.heatmapCommandPanel.heatmapcommandpanel.volatility', "Volatility")}</span>
            <span className="hcp-metric-value">{stats.volLabel}</span>
          </div>
          <span className="hcp-metric-sep" />
          <div className="hcp-metric">
            <span className="hcp-metric-label">{t('homePage.heatmapCommandPanel.heatmapcommandpanel.concentration', "Concentration")}</span>
            <span className="hcp-metric-value">{stats.concentration}</span>
          </div>
        </div>
      )}

      {/* ─── AI Analysis ─── */}
      {stats && (
        <div className={`hcp-analysis bias-${stats.sentiment}`}>
          <div className="hcp-analysis-glow" />
          <div className="hcp-analysis-header">
            <div className="hcp-analysis-header-left">
              <span className="hcp-analysis-pulse" />
              <span className="hcp-analysis-title">{t('homePage.heatmapCommandPanel.heatmapcommandpanel.aiAnalysis', "AI Analysis")}</span>
            </div>
            <span className="hcp-analysis-badge">{t('homePage.heatmapCommandPanel.heatmapcommandpanel.spectreAi', "Spectre AI")}</span>
          </div>
          <p className="hcp-analysis-text">{stats.marketStructure}</p>

          <div className="hcp-analysis-cards">
            <div className="hcp-analysis-card">
              <div className="hcp-analysis-card-accent" />
              <div className="hcp-analysis-card-content">
                <div className="hcp-analysis-card-title">{t('homePage.heatmapCommandPanel.heatmapcommandpanel.momentum', "Momentum")}</div>
                <p className="hcp-analysis-card-text">{stats.momentum}</p>
              </div>
            </div>

            <div className="hcp-analysis-card">
              <div className="hcp-analysis-card-accent" />
              <div className="hcp-analysis-card-content">
                <div className="hcp-analysis-card-title">{t('homePage.heatmapCommandPanel.heatmapcommandpanel.riskAssessment', "Risk Assessment")}</div>
                <p className="hcp-analysis-card-text">{stats.risk}</p>
              </div>
            </div>
          </div>

          <p className="hcp-analysis-summary">
            {stats.sentiment === 'bullish' ? 'Risk-on conditions.' : stats.sentiment === 'bearish' ? 'Risk-off conditions. Defensive positioning advised.' : 'Mixed signals. Wait for directional confirmation.'}{' '}
            Top performer: {stats.best?.symbol} ({stats.best?.change >= 0 ? '+' : ''}{fmt(stats.best?.change)}%).
          </p>
        </div>
      )}
    </div>
  )
}
