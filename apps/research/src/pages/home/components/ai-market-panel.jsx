/**
 * AiMarketPanel - Shared AI Market / Analysis tab component.
 * Used by both WelcomePage (horizontal layout) and CommandCenter (sidebar layout).
 * Single source of truth - edit here, renders everywhere.
 */
import { useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { IS_SHOWCASE_EMBED } from '@/lib/embed-mode'
import './ai-market-panel.css'

function fmtUsd(usd) {
  if (usd == null || isNaN(usd)) return '$0'
  const abs = Math.abs(usd)
  const sign = usd >= 0 ? '+' : '-'
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`
  return `${sign}$${abs.toFixed(0)}`
}

function fmtLiqUsd(v) {
  if (v == null || isNaN(v)) return '$0'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(abs / 1e3).toFixed(0)}K`
  return `$${abs.toFixed(0)}`
}

function fmtAgo(ts) {
  if (!ts) return ''
  const ms = Date.now() - new Date(ts).getTime()
  if (!isFinite(ms) || ms < 0) return 'just now'
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

// Extract the first sentence of the analysis as a thesis line. The Spectre
// market agent leads with the punchiest data point in sentence 1 — that's
// our thesis. Wrap key tokens / prices / percentages in <strong> so the eye
// catches the numbers first.
function buildThesis(text) {
  if (!text) return null
  const cleaned = String(text).replace(/^[\w-]+\s+OUTLOOK\s+-\s*/, '').replace(/^ANALYSIS\b\s*[:-]?\s*/i, '').trim()
  // First sentence: up to the first ". " followed by a capital letter, or end.
  const match = cleaned.match(/^[^.!?]+[.!?](?=\s+[A-Z]|\s*$)/)
  const first = (match ? match[0] : cleaned).trim()
  if (first.length < 12 || first.length > 260) return null
  // Bold tickers, dollar amounts, and percentages.
  const html = first
    .replace(/(\$[\d,]+(?:\.\d+)?[KMBT]?)/g, '<strong>$1</strong>')
    .replace(/([+-]?\d+(?:\.\d+)?%)/g, '<strong>$1</strong>')
    .replace(/\b(BTC|ETH|SOL|BNB|XRP|DOGE|ADA|AVAX)\b/g, '<strong>$1</strong>')
  return html
}

const AiMarketPanel = ({
  macroAnalysisData,
  marketStructureTrio,
  marketAiTimeframe,
  setMarketAiTimeframe,
  breakingHeadlines = [],
  isStocks = false,
}) => {
  const { t } = useTranslation()
  const [liqWindows, setLiqWindows] = useState(null)
  const [showLiqTooltip, setShowLiqTooltip] = useState(false)
  const liqFetchedRef = useRef(false)

  const handleLiqMouseEnter = useCallback(() => {
    setShowLiqTooltip(true)
    // Showcase iframe: skip the optional probe - the upstream route is
    // degraded right now and its 404 would dirty the spectreai.io
    // console. The tooltip renders its no-data fallback.
    if (IS_SHOWCASE_EMBED) return
    if (liqFetchedRef.current) return
    liqFetchedRef.current = true
    fetch('/api/derivatives/liquidation-windows')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(json => setLiqWindows(json.data?.windows || null))
      .catch(() => { liqFetchedRef.current = false })
  }, [])

  const handleLiqMouseLeave = useCallback(() => {
    setShowLiqTooltip(false)
  }, [])

  if (!macroAnalysisData) return null

  // Use Brain conviction if available, fall back to derived strength
  const avg = macroAnalysisData.tableData.reduce((s, r) => s + Math.abs(r.change || 0), 0) / 3
  const derivedStrength = Math.min(Math.round(avg * 12), 100)
  const strength = marketStructureTrio.conviction > 0 ? marketStructureTrio.conviction : derivedStrength

  return (
    <div className="aim">
      {/* ═══ Signal Bar ═══ */}
      <div className={`aim-signal bias-${macroAnalysisData.bias}`}>
        <div className="aim-signal-left">
          <span className="aim-signal-dot" />
          <span className="aim-signal-bias">{macroAnalysisData.bias.charAt(0).toUpperCase() + macroAnalysisData.bias.slice(1)}</span>
          <span className="aim-signal-sep" />
          <span className="aim-signal-tf">{macroAnalysisData.tfLabel}</span>
        </div>
        <div className="aim-signal-right">
          <span className="aim-signal-conviction-label">{t('aiMarket.conviction', 'Conviction')}</span>
          <div className="aim-signal-bar"><div className="aim-signal-bar-fill" style={{ width: `${strength}%` }} /></div>
          <span className="aim-signal-conviction-value">{strength}%</span>
        </div>
      </div>

      {/* ═══ Key Metrics Strip (crypto derivatives — hidden in Stocks mode) ═══ */}
      {!isStocks && (
      <div className="aim-metrics">
        <div className="aim-metric">
          <span className="aim-metric-label">{t('aiMarket.openInterest', 'Open Interest')}</span>
          <span className="aim-metric-value">{fmtUsd(marketStructureTrio.openInterest)}</span>
        </div>
        <span className="aim-metric-sep" />
        <div className="aim-metric">
          <span className="aim-metric-label">{t('aiMarket.funding', 'Funding')}</span>
          <span className={`aim-metric-value ${marketStructureTrio.funding[0].rate >= 0 ? 'pos' : 'neg'}`}>
            {marketStructureTrio.funding[0].rate >= 0 ? '+' : ''}{(marketStructureTrio.funding[0].rate * 100).toFixed(3)}%
          </span>
        </div>
        <span className="aim-metric-sep" />
        <div
          className="aim-metric aim-metric--hoverable"
          onMouseEnter={handleLiqMouseEnter}
          onMouseLeave={handleLiqMouseLeave}
        >
          <span className="aim-metric-label">{t('aiMarket.liquidations24h', 'Liquidations 24h')}</span>
          <span className="aim-metric-value">{marketStructureTrio.asText?.liquidations || fmtUsd(marketStructureTrio.liquidations.totalUsd)}</span>
          {showLiqTooltip && (
            <div className="aim-liq-tooltip">
              {!liqWindows ? (
                <div className="aim-liq-tooltip-loading">
                  <div className="aim-liq-tooltip-shimmer animate-shimmer" />
                  <div className="aim-liq-tooltip-shimmer animate-shimmer" />
                  <div className="aim-liq-tooltip-shimmer animate-shimmer" />
                  <div className="aim-liq-tooltip-shimmer animate-shimmer" />
                </div>
              ) : (
                <div className="aim-liq-tooltip-grid">
                  {['1h', '4h', '12h', '24h'].map(tf => (
                    <div key={tf} className="aim-liq-tooltip-cell">
                      <div className="aim-liq-tooltip-tf">{tf} {t('aiMarket.rekt', 'Rekt')}</div>
                      <div className="aim-liq-tooltip-total">{fmtLiqUsd(liqWindows[tf]?.total)}</div>
                      <div className="aim-liq-tooltip-row">
                        <span className="aim-liq-tooltip-side">{t('aiMarket.long', 'Long')}</span>
                        <span className="aim-liq-tooltip-val aim-liq-long">{fmtLiqUsd(liqWindows[tf]?.long)}</span>
                      </div>
                      <div className="aim-liq-tooltip-row">
                        <span className="aim-liq-tooltip-side">{t('aiMarket.short', 'Short')}</span>
                        <span className="aim-liq-tooltip-val aim-liq-short">{fmtLiqUsd(liqWindows[tf]?.short)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <span className="aim-metric-sep" />
        <div className="aim-metric">
          <span className="aim-metric-label">{t('aiMarket.whaleFlow', 'Whale Flow')}</span>
          <span className={`aim-metric-value ${(marketStructureTrio.whaleFlows.usd ?? marketStructureTrio.whaleFlows.net) >= 0 ? 'pos' : 'neg'}`}>
            {marketStructureTrio.asText?.whale_flow || fmtUsd(marketStructureTrio.whaleFlows.usd ?? marketStructureTrio.whaleFlows.net * 1e6)}
          </span>
        </div>
      </div>
      )}

      {/* ═══ AI Analysis ═══ */}
      <div className={`aim-analysis bias-${macroAnalysisData.bias}`}>
        <div className="aim-analysis-glow" />
        <div className="aim-analysis-header">
          <div className="aim-analysis-header-left">
            <span className="aim-analysis-pulse" />
            <span className="aim-analysis-title">{t('aiMarket.aiAnalysis', 'AI Analysis')}</span>
            <div className="aim-tf-pills">
              {[{ id: '1h', label: '1H' }, { id: '24h', label: '24H' }, { id: '7d', label: '7D' }].map(tf => (
                <button key={tf.id} className={`aim-tf ${marketAiTimeframe === tf.id ? 'active' : ''}`} onClick={() => setMarketAiTimeframe(tf.id)}>{tf.label}</button>
              ))}
            </div>
          </div>
          <div className="aim-analysis-header-right">
            {macroAnalysisData.lastUpdated && (
              <span className="aim-analysis-fresh" title={new Date(macroAnalysisData.lastUpdated).toLocaleString()}>
                {fmtAgo(macroAnalysisData.lastUpdated)}
              </span>
            )}
            <span className="aim-analysis-badge">{t('homePage.aiMarketPanel.aimarketpanel.spectreAi', "Spectre AI")}</span>
          </div>
        </div>
        {/* Live news context — top breaking headlines weave real-world catalysts
            (geopolitics, macro prints, ETF flows) into the analysis so the
            thesis reads against the news of the day, not boilerplate. */}
        {Array.isArray(breakingHeadlines) && breakingHeadlines.length > 0 && (
          <div className="aim-context" role="note" aria-label={t('homePage.aiMarketPanel.aimarketpanel.ariaLiveNewsContext', "Live news context")}>
            <span className="aim-context-label">
              <span className="aim-context-label-dot" />
              <span>{t('aiMarket.context', 'Context')}</span>
            </span>
            <ul className="aim-context-list">
              {breakingHeadlines.slice(0, 3).map((article, idx) => {
                const headline = (article?.headline || article?.title || '').replace(/\*\*/g, '').trim()
                if (!headline) return null
                const url = article?.url || article?.link || null
                const key = article?.id || article?.slug || article?.url || `ctx-${idx}`
                return (
                  <li key={key} className="aim-context-item">
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="aim-context-headline">
                        {headline}
                      </a>
                    ) : (
                      <span className="aim-context-headline">{headline}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {(() => {
          const thesisHtml = buildThesis(macroAnalysisData.p1)
          if (!thesisHtml) return null
          return (
            <div className="aim-thesis" role="note" aria-label={t('homePage.aiMarketPanel.aimarketpanel.ariaCurrentMarketThesis', "Current market thesis")}>
              <span className="aim-thesis-label">
                <span className="aim-thesis-label-dot" />
                <span>{t('aiMarket.thesis', 'Thesis')}</span>
              </span>
              <p className="aim-thesis-text" dangerouslySetInnerHTML={{ __html: thesisHtml }} />
            </div>
          )
        })()}
        <p className="aim-analysis-text">{macroAnalysisData.p1?.replace(/^[\w-]+\s+OUTLOOK\s+-\s*/, '') || t('aiMarket.mixedSignals', 'Market showing mixed signals. Monitor key levels for directional clarity.')}</p>

        <div className="aim-analysis-cards">
          {macroAnalysisData.p2 && (
            <div className="aim-analysis-card">
              <div className="aim-analysis-card-content">
                <div className="aim-analysis-card-title">{t('aiMarket.macroConditions', 'Macro Conditions')}</div>
                <p className="aim-analysis-card-text">{macroAnalysisData.p2.replace(/^MACRO CONDITIONS\s*-\s*/, '')}</p>
              </div>
            </div>
          )}

          {macroAnalysisData.p3 && (
            <div className="aim-analysis-card">
              <div className="aim-analysis-card-content">
                <div className="aim-analysis-card-title">{t('aiMarket.positioning', 'Positioning')}</div>
                <p className="aim-analysis-card-text">{macroAnalysisData.p3.replace(/^POSITIONING\s*-\s*/, '')}</p>
              </div>
            </div>
          )}
        </div>

        {macroAnalysisData.smartSummary && (
          <p className="aim-analysis-summary">{macroAnalysisData.smartSummary}</p>
        )}
      </div>
    </div>
  )
}

export default AiMarketPanel
