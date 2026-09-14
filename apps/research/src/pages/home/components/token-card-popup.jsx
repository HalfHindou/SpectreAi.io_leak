/**
 * TokenCardPopup - Apple cinematic token overlay.
 * Flat, zero-ornament layout matching AI Market panel design language.
 * Portaled to document.body to avoid clipping.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { getHistorySparkline } from './welcome-page-helpers'
import { useTokenPredictions } from './use-token-predictions'
import { useTokenOnchainStats } from './use-token-onchain-stats'
import { TOKEN_ROW_COLORS } from '@/constants/tokenColors'
import IButton from '@/components/intelligence/IButton'

// networkId -> DexScreener chain slug + block explorer (for the quick-links row).
const CHAIN_META = {
  '1': { dex: 'ethereum', explorer: 'https://etherscan.io', explorerName: 'Etherscan' },
  '56': { dex: 'bsc', explorer: 'https://bscscan.com', explorerName: 'BscScan' },
  '8453': { dex: 'base', explorer: 'https://basescan.org', explorerName: 'BaseScan' },
  '137': { dex: 'polygon', explorer: 'https://polygonscan.com', explorerName: 'PolygonScan' },
  '42161': { dex: 'arbitrum', explorer: 'https://arbiscan.io', explorerName: 'Arbiscan' },
  '10': { dex: 'optimism', explorer: 'https://optimistic.etherscan.io', explorerName: 'Explorer' },
  '43114': { dex: 'avalanche', explorer: 'https://snowtrace.io', explorerName: 'Snowtrace' },
  '1399811149': { dex: 'solana', explorer: 'https://solscan.io', explorerName: 'Solscan' },
}

const TokenCardPopup = ({
  popup,
  topCoinPrices,
  dayMode,
  fmtPrice,
  fmtLarge,
  expandedCard,
  setExpandedCard,
  onClose,
  onViewDetails,
}) => {
  const { t } = useTranslation()
  // Real prediction markets for this token (hook must run before any early return)
  const { loading: predLoading, markets: predictions } = useTokenPredictions(popup?.symbol, popup?.name)
  // On-chain health stats fill the slot when there are no prediction markets.
  const noPredictions = !predLoading && predictions.length === 0
  const { loading: statsLoading, stats } = useTokenOnchainStats(popup?.address, popup?.networkId, noPredictions)

  if (!popup || typeof document === 'undefined') return null

  // Showcase embed mode locks the CTA to prevent deep-linking out of the preview
  const isShowcaseEmbed = (() => {
    try {
      if (new URLSearchParams(window.location.search).get('embed') === 'showcase') return true
      if (window.self !== window.top) return true
    } catch { return true }
    return false
  })()

  const sym = popup.symbol
  const live = topCoinPrices?.[sym] || {}
  const price = live.price ?? popup.price
  const chg24h = live.change ?? popup.change
  const chg1h = live.change1h ?? popup.change1h ?? null
  const chg7d = live.change7d ?? popup.change7d ?? null
  const vol = live.volume ?? popup.volume ?? null
  const mcap = live.marketCap ?? popup.marketCap ?? null
  const tc = TOKEN_ROW_COLORS[sym]
  const tokenRgb = tc?.bg || '255,255,255'
  const spark = live.sparkline_7d ?? popup.sparkline_7d ?? []
  const isUp = chg24h != null ? Number(chg24h) >= 0 : true

  // Chart data - apply light smoothing so the miniature chart reads clean
  const points = (() => {
    const raw = spark.length > 1 ? spark.map(Number) : getHistorySparkline(price, chg24h, spark)
    if (raw.length < 5) return raw
    // Two-pass 1-2-1 weighted moving average for smooth miniature chart
    const smooth = (arr) => {
      const s = [arr[0]]
      for (let i = 1; i < arr.length - 1; i++) {
        s.push((arr[i - 1] + arr[i] * 2 + arr[i + 1]) / 4)
      }
      s.push(arr[arr.length - 1])
      return s
    }
    return smooth(smooth(raw))
  })()
  const hasChart = points.length > 0
  const high = hasChart ? Math.max(...points) : 0
  const low = hasChart ? Math.min(...points) : 0
  const range = high - low || 1
  const pctFromHigh = price ? ((price - high) / high * 100) : 0
  const rangePos = price ? Math.max(0, Math.min(100, ((price - low) / range) * 100)) : 50
  const chartColor = isUp ? '#30D158' : '#FF453A'

  const hasPredictions = predLoading || predictions.length > 0

  // Key Stats (on-chain) — shown only when there are no prediction markets.
  const showKeyStats = noPredictions && (statsLoading || !!stats)
  const ksFdv = stats ? (stats.fdv > 0 ? stats.fdv : (stats.marketCap > 0 ? stats.marketCap : 0)) : 0
  const ksMcap = stats ? (stats.marketCap > 0 ? stats.marketCap : (mcap > 0 ? Number(mcap) : 0)) : 0
  const ksDilution = (ksFdv > 0 && ksMcap > 0) ? ksFdv / ksMcap : null

  // Momentum ladder — multi-timeframe change from the same on-chain stats call.
  const momItems = stats ? [
    { label: '5M', v: stats.change5m },
    { label: '1H', v: stats.change1h },
    { label: '6H', v: stats.change6h },
    { label: '24H', v: stats.change24h },
  ] : []
  const hasMomentum = momItems.some(m => Number(m.v) !== 0)

  // Quick links — external references for on-chain tokens (address-based, reliable).
  const chainMeta = CHAIN_META[String(popup?.networkId)]
  const tokenLinks = (popup?.address && chainMeta) ? [
    { label: 'DexScreener', url: `https://dexscreener.com/${chainMeta.dex}/${popup.address}` },
    { label: chainMeta.explorerName, url: `${chainMeta.explorer}/token/${popup.address}` },
    { label: 'X', url: `https://x.com/search?q=%24${encodeURIComponent(sym || '')}` },
  ] : []

  const fmtChg = (v) => {
    const n = Number(v)
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
  }

  return createPortal(
    <div
      className={`tcp-overlay ${dayMode ? 'tcp-day' : ''}`}
      style={{ '--tc-rgb': tokenRgb }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tcp-title"
    >
      <div className="tcp" style={{ '--tc-rgb': tokenRgb, '--chart-color': chartColor }} onClick={(e) => e.stopPropagation()}>
        <div className="tcp-accent-line" />
        <div className="tcp-glow" />
        <div className="tcp-shimmer" />

        <button type="button" className="tcp-close" onClick={onClose} aria-label={t('homePage.tokenCardPopup.tokencardpopup.ariaClose', "Close")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>

        {/* ═══ Header ═══ */}
        <div className="tcp-header tcp-stagger" style={{ '--stagger': 0 }}>
          <div className="tcp-avatar">
            <div className="tcp-avatar-ring" />
            {popup.logo ? <img src={popup.logo} alt="" loading="lazy" decoding="async" width="40" height="40" /> : <span>{sym?.[0]}</span>}
          </div>
          <div className="tcp-header-info">
            <h2 id="tcp-title" className="tcp-name">{popup.name} <span className="tcp-sym">{sym}</span></h2>
            <div className="tcp-header-price">
              <span className="tcp-price">{fmtPrice(price)}</span>
              <IButton size="sm" metricType="token-price" metricValue={fmtPrice(price)} metricLabel={`${popup.name} price`} tokenSymbol={sym} />
              {chg24h != null && (
                <span className={`tcp-chg ${isUp ? 'pos' : 'neg'}`}>{fmtChg(chg24h)}</span>
              )}
            </div>
          </div>
        </div>

        {/* ═══ Metrics Strip ═══ */}
        <div className="tcp-metrics tcp-stagger" style={{ '--stagger': 1 }}>
          {chg1h != null && (
            <div className="tcp-metric">
              <span className="tcp-metric-label">1H</span>
              <span className={`tcp-metric-value ${Number(chg1h) >= 0 ? 'pos' : 'neg'}`}>{fmtChg(chg1h)}</span>
            </div>
          )}
          {chg7d != null && (
            <>
              <span className="tcp-metric-sep" />
              <div className="tcp-metric">
                <span className="tcp-metric-label">7D</span>
                <span className={`tcp-metric-value ${Number(chg7d) >= 0 ? 'pos' : 'neg'}`}>{fmtChg(chg7d)}</span>
              </div>
            </>
          )}
          {mcap != null && mcap > 0 && (
            <>
              <span className="tcp-metric-sep" />
              <div className="tcp-metric">
                <span className="tcp-metric-label">{t('homePage.tokenCardPopup.tokencardpopup.marketCap', "Market Cap")}</span>
                <span className="tcp-metric-value">
                  {fmtLarge(mcap)}
                  <IButton size="sm" metricType="market-cap" metricValue={fmtLarge(mcap)} metricLabel={`${sym} market cap`} tokenSymbol={sym} />
                </span>
              </div>
            </>
          )}
          {vol != null && vol > 0 && (
            <>
              <span className="tcp-metric-sep" />
              <div className="tcp-metric">
                <span className="tcp-metric-label">24H Volume</span>
                <span className="tcp-metric-value">
                  {fmtLarge(vol)}
                  <IButton size="sm" metricType="volume-24h" metricValue={fmtLarge(vol)} metricLabel={`${sym} 24h volume`} tokenSymbol={sym} />
                </span>
              </div>
            </>
          )}
        </div>

        {/* ═══ 7D Chart ═══ */}
        {hasChart && (
          <div className="tcp-section tcp-stagger" style={{ '--stagger': 2 }}>
            <div className="tcp-section-head">
              <span className="tcp-section-title">7-Day Price</span>
              <span className="tcp-section-tag">{t('homePage.tokenCardPopup.tokencardpopup.history', "History")}</span>
            </div>
            <div className="tcp-chart-wrap">
              <svg viewBox="0 0 400 100" preserveAspectRatio="none" className="tcp-chart-svg">
                <defs>
                  <linearGradient id={`tcp-grad-${sym}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColor} stopOpacity="0.18" />
                    <stop offset="100%" stopColor={chartColor} stopOpacity="0" />
                  </linearGradient>
                  <filter id={`tcp-glow-line-${sym}`}>
                    <feGaussianBlur stdDeviation="2" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                {(() => {
                  const px = 6, pw = 388 // x padding so dot+glow don't clip at edges
                  const toX = (i) => px + (i / (points.length - 1)) * pw
                  const toY = (v) => 100 - ((v - low) / range) * 70 - 15
                  const linePts = points.map((v, i) => `${toX(i)},${toY(v)}`).join(' ')
                  const lastX = toX(points.length - 1)
                  const lastY = toY(points[points.length - 1])
                  return <>
                    <polygon fill={`url(#tcp-grad-${sym})`} points={linePts + ` ${lastX},100 ${px},100`} />
                    <polyline className="tcp-chart-glow-line" fill="none" stroke={chartColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" filter={`url(#tcp-glow-line-${sym})`} opacity="0.4" points={linePts} />
                    <polyline fill="none" stroke={chartColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={linePts} />
                    <circle className="tcp-chart-dot" cx={lastX} cy={lastY} r="3" fill={chartColor} />
                  </>
                })()}
              </svg>
            </div>
            <div className="tcp-range-strip">
              <div className="tcp-range-item">
                <span className="tcp-range-label">7d High</span>
                <span className="tcp-range-val">{fmtPrice(high)}</span>
              </div>
              <div className="tcp-range-bar">
                <div className="tcp-range-track">
                  <div className="tcp-range-fill" style={{ width: `${rangePos}%`, background: chartColor }} />
                  <div className="tcp-range-thumb" style={{ left: `${rangePos}%`, borderColor: chartColor }} />
                </div>
              </div>
              <div className="tcp-range-item">
                <span className="tcp-range-label">7d Low</span>
                <span className="tcp-range-val">{fmtPrice(low)}</span>
              </div>
              <div className="tcp-range-item">
                <span className="tcp-range-label">{t('homePage.tokenCardPopup.tokencardpopup.fromHigh', "From High")}</span>
                <span className={`tcp-range-val ${pctFromHigh >= 0 ? 'pos' : 'neg'}`}>{pctFromHigh >= 0 ? '+' : ''}{pctFromHigh.toFixed(1)}%</span>
              </div>
            </div>
          </div>
        )}

        {/* ═══ Predictions (real Polymarket markets — hidden when none) ═══ */}
        {hasPredictions && (
          <div className="tcp-section tcp-stagger" style={{ '--stagger': 3 }}>
            <div className="tcp-section-head">
              <span className="tcp-section-title">{t('homePage.tokenCardPopup.tokencardpopup.predictions', "Predictions")}</span>
              <span className="tcp-section-source">{t('homePage.tokenCardPopup.tokencardpopup.polymarket', "Polymarket")}</span>
            </div>
            <div className="tcp-pred-table">
              <div className="tcp-pred-header tcp-pred-header--markets">
                <span className="tcp-pred-col">{t('homePage.tokenCardPopup.tokencardpopup.market', "Market")}</span>
                <span className="tcp-pred-col tcp-col-r">{t('homePage.tokenCardPopup.tokencardpopup.chance', "Chance")}</span>
                <span className="tcp-pred-col tcp-col-r">{t('homePage.tokenCardPopup.tokencardpopup.by', "By")}</span>
              </div>
              {predLoading && predictions.length === 0 && (
                [0, 1].map(i => (
                  <div key={`sk-${i}`} className="tcp-pred-row tcp-pred-row--markets">
                    <span className="tcp-pred-market">
                      <span className="tcp-pred-logo tcp-pred-logo--sk" />
                      <span className="tcp-pred-sk-line animate-shimmer" />
                    </span>
                    <span className="tcp-pred-prob tcp-col-r"><span className="tcp-pred-sk-pill animate-shimmer" /></span>
                    <span className="tcp-pred-date tcp-col-r"><span className="tcp-pred-sk-pill animate-shimmer" /></span>
                  </div>
                ))
              )}
              {predictions.map((m) => (
                <a
                  key={m.id}
                  className="tcp-pred-row tcp-pred-row--markets"
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="tcp-pred-market">
                    <img
                      className="tcp-pred-logo"
                      src="https://polymarket.com/icons/favicon-32x32.png"
                      alt=""
                      loading="lazy"
                    />
                    <span className="tcp-pred-question" title={m.question}>{m.question}</span>
                  </span>
                  <span className="tcp-pred-prob tcp-col-r">
                    <span className="tcp-pred-bar-wrap">
                      <span className="tcp-pred-bar tcp-bar-neutral" style={{ width: `${Math.min(m.yesPct, 100)}%` }} />
                    </span>
                    {m.yesPct}%
                  </span>
                  <span className="tcp-pred-date tcp-col-r">{String(m.endDate).replace(/,?\s*\d{4}$/, '')}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* ═══ Key Stats (real on-chain health — fills the no-Polymarket slot) ═══ */}
        {showKeyStats && (
          <div className="tcp-section tcp-stagger" style={{ '--stagger': 3 }}>
            <div className="tcp-section-head">
              <span className="tcp-section-title">{t('homePage.tokenCardPopup.tokencardpopup.keyStats', "Key Stats")}</span>
              <span className="tcp-section-source">{t('homePage.tokenCardPopup.tokencardpopup.onChain', "On-Chain")}</span>
            </div>
            {stats && hasMomentum && (
              <div className="tcp-mom-row">
                {momItems.map(m => (
                  <div key={m.label} className="tcp-mom-cell">
                    <span className="tcp-mom-label">{m.label}</span>
                    <span className={`tcp-mom-val ${Number(m.v) >= 0 ? 'pos' : 'neg'}`}>{fmtChg(m.v)}</span>
                  </div>
                ))}
              </div>
            )}
            {statsLoading && !stats ? (
              <div className="tcp-ks-grid">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="tcp-ks-cell">
                    <span className="tcp-ks-sk animate-shimmer" style={{ width: '46px' }} />
                    <span className="tcp-ks-sk animate-shimmer" style={{ width: '68px', height: '14px' }} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="tcp-ks-grid">
                <div className="tcp-ks-cell">
                  <span className="tcp-ks-label">{t('homePage.tokenCardPopup.tokencardpopup.liquidity', "Liquidity")}</span>
                  <span className="tcp-ks-value">{stats.liquidity > 0 ? fmtLarge(stats.liquidity) : '-'}</span>
                </div>
                <div className="tcp-ks-cell">
                  <span className="tcp-ks-label">{t('homePage.tokenCardPopup.tokencardpopup.holders', "Holders")}</span>
                  <span className="tcp-ks-value">{stats.holders > 0 ? stats.holders.toLocaleString() : '-'}</span>
                </div>
                <div className="tcp-ks-cell">
                  <span className="tcp-ks-label">{t('homePage.tokenCardPopup.tokencardpopup.fdv', "FDV")}</span>
                  <span className="tcp-ks-value">{ksFdv > 0 ? fmtLarge(ksFdv) : '-'}</span>
                </div>
                <div className="tcp-ks-cell">
                  <span className="tcp-ks-label">{t('homePage.tokenCardPopup.tokencardpopup.dilution', "Dilution")}</span>
                  <span className={`tcp-ks-value${ksDilution && ksDilution >= 3 ? ' tcp-ks-warn' : ''}`}>
                    {ksDilution ? `${ksDilution.toFixed(1)}x` : '-'}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ Quick links (on-chain tokens) ═══ */}
        {tokenLinks.length > 0 && (
          <div className="tcp-links tcp-stagger" style={{ '--stagger': 4 }}>
            {tokenLinks.map(l => (
              <a
                key={l.label}
                className="tcp-link"
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                {l.label}
                <svg className="tcp-link-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 17L17 7M17 7H9M17 7v8" />
                </svg>
              </a>
            ))}
          </div>
        )}

        {/* ═══ Action ═══ */}
        <div className="tcp-action tcp-stagger" style={{ '--stagger': 4 }}>
          <button
            type="button"
            className={`tcp-btn ${isShowcaseEmbed ? 'tcp-btn-locked' : ''}`}
            onClick={() => { if (isShowcaseEmbed) return; onViewDetails(popup) }}
            aria-disabled={isShowcaseEmbed || undefined}
            title={isShowcaseEmbed ? 'Available in Beta' : undefined}
          >
            {!isShowcaseEmbed && <span className="tcp-btn-shine" />}
            {isShowcaseEmbed ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </svg>
                {t('homePage.tokenCardPopup.tokencardpopup.viewInResearchZone', "View in Research Zone")}
              </>
            ) : (
              <>
                {t('homePage.tokenCardPopup.tokencardpopup.viewInResearchZone', "View in Research Zone")}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default TokenCardPopup
