/**
 * AdvancedCompare — Full-screen modal overlay for detailed side-by-side
 * comparison of 2-3 tokens from the heatmap.
 *
 * Portaled to document.body. Shows token cards, scorecard with SVG circles,
 * and a detailed metric breakdown with proportional bars.
 */
import React, { useMemo, useEffect, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useCurrency } from '@/hooks/useCurrency'
import { getTopCoinsMarketsPage } from '@/services/coinGeckoApi'
import './AdvancedCompare.css'

/*
 * Colour discipline: the token's brand hue is NOT used as a chrome channel here.
 * Identity comes from the logo + symbol; winner/loser state is the warm-white
 * ramp; bull/bear only on the change values. Tinting cards/bars/borders with the
 * brand colour reads as purple on ETH/SOL-class tokens (design-system §K).
 */

/* ── Formatting ── */

const NA = '—'

// A missing window is null, never 0 - the heatmap's Spectre lane only delivers
// the ACTIVE timeframe (api-optimization-plan / heatmaps-page mapCgCoins), so
// the 7d column is absent on a 24h view. Formatting a null as "+0.00%" and then
// crowning three identical zeros BEST is how this modal used to read.
const num = (v) => (Number.isFinite(v) ? v : null)

function formatPct(value) {
  if (value == null) return NA
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

function formatTurnover(value) {
  if (value == null) return NA
  return `${(value * 100).toFixed(2)}%`
}

/* ── Metrics definition (labels via i18n at render time) ── */

const METRIC_DEFS = [
  {
    id: 'change24h',
    labelKey: 'heatmaps.change24h',
    getValue: (t) => num(t.change24h),
    formatType: 'pct',
    higherBetter: true,
  },
  {
    id: 'marketCap',
    labelKey: 'heatmaps.marketCapSize',
    getValue: (t) => (t.marketCap > 0 ? t.marketCap : null),
    formatType: 'large',
    higherBetter: true,
  },
  {
    id: 'volume',
    labelKey: 'heatmaps.volume24h',
    getValue: (t) => (t.volume > 0 ? t.volume : null),
    formatType: 'large',
    higherBetter: true,
  },
  {
    id: 'turnover',
    labelKey: 'heatmaps.turnover',
    getValue: (t) => {
      const mc = t.marketCap || 0
      const vol = t.volume || 0
      return mc > 0 && vol > 0 ? vol / mc : null
    },
    formatType: 'turnover',
    higherBetter: true,
  },
  {
    id: 'change7d',
    labelKey: 'heatmaps.change7d',
    getValue: (t) => num(t.change7d),
    formatType: 'pct',
    higherBetter: true,
  },
]

/* ── 7d backfill ──
 * The heatmap rows only carry the active timeframe's change. For ranked coins
 * the CG top-250 page (already warm from home/discover) has all windows, so
 * fill change7d from it: by cgId first; by symbol ONLY for address-less ranked
 * coins (an on-chain runner sharing a ticker with a major must never inherit
 * the major's 7d - the $DOT/Polkadot class). Stocks never enter this path. */
function useBackfilledTokens(tokens) {
  const [fill, setFill] = useState(null)

  const needsFill = tokens.some(
    (t) => !t.isStock && !Number.isFinite(t.change7d)
  )

  useEffect(() => {
    if (!needsFill) return
    let cancelled = false
    getTopCoinsMarketsPage(1, 250)
      .then((coins) => {
        if (cancelled || !Array.isArray(coins)) return
        const byId = new Map()
        const bySym = new Map()
        for (const c of coins) {
          const v = Number(c?.price_change_percentage_7d_in_currency)
          if (!Number.isFinite(v)) continue
          if (c.id) byId.set(String(c.id), v)
          const sym = (c.symbol || '').toUpperCase()
          if (sym && !bySym.has(sym)) bySym.set(sym, v)
        }
        setFill({ byId, bySym })
      })
      .catch(() => { /* leave as "-" */ })
    return () => { cancelled = true }
  }, [needsFill])

  return useMemo(() => {
    if (!fill) return tokens
    return tokens.map((t) => {
      if (t.isStock || Number.isFinite(t.change7d)) return t
      const id = t.cgId || t.id
      let v = id ? fill.byId.get(String(id)) : undefined
      if (v === undefined && !t.address) v = fill.bySym.get((t.symbol || '').toUpperCase())
      return Number.isFinite(v) ? { ...t, change7d: v } : t
    })
  }, [tokens, fill])
}

/* ── Main Component ── */

export default function AdvancedCompare({ tokens: rawTokens, dayMode, onClose, onViewToken }) {
  const { t } = useTranslation()
  const { fmtPrice, fmtLarge } = useCurrency()
  const tokens = useBackfilledTokens(rawTokens)

  // Build runtime METRICS with i18n labels and bound currency formatters
  const METRICS = useMemo(() => {
    const formatFor = (type) => {
      if (type === 'pct') return formatPct
      if (type === 'turnover') return formatTurnover
      if (type === 'large') return (v) => fmtLarge(v)
      return (v) => String(v)
    }
    return METRIC_DEFS.map(m => ({
      ...m,
      label: t(m.labelKey),
      format: formatFor(m.formatType),
    }))
  }, [t, fmtLarge])

  // ESC to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Click backdrop to close
  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  // Compute metrics + winners
  const { metricResults, winCounts, bestPerformerIdx, overallWinnerIdx } = useMemo(() => {
    const results = METRICS.map((metric) => {
      const values = tokens.map((t) => metric.getValue(t))
      const finite = values.filter((v) => v != null)
      // A winner needs at least two real values that actually differ. One
      // value is not a comparison; identical values carry no information.
      const comparable = finite.length >= 2 && new Set(finite).size > 1
      const bestVal = comparable
        ? (metric.higherBetter ? Math.max(...finite) : Math.min(...finite))
        : null
      const maxAbs = Math.max(...finite.map(Math.abs), 0.0001)
      const winnerIndices = comparable
        ? values.map((v, i) => (v === bestVal ? i : -1)).filter((i) => i >= 0)
        : []

      return {
        ...metric,
        values,
        bestVal,
        maxAbs,
        winnerIndices,
      }
    })

    // Count wins per token
    const counts = tokens.map(() => 0)
    results.forEach((r) => {
      r.winnerIndices.forEach((i) => { counts[i]++ })
    })

    // Best 24h performer for LEADER badge
    const changes = tokens.map((t) => t.change24h ?? -Infinity)
    const bestIdx = changes.indexOf(Math.max(...changes))

    // Overall winner (most metric wins, no tie)
    const maxWins = Math.max(...counts)
    const overallIdx = maxWins > 0 && counts.filter(c => c === maxWins).length === 1
      ? counts.indexOf(maxWins) : -1

    return { metricResults: results, winCounts: counts, bestPerformerIdx: bestIdx, overallWinnerIdx: overallIdx }
  }, [tokens, METRICS])

  const handleViewDetails = useCallback((token) => {
    if (!onViewToken) return
    onClose()
    onViewToken({
      symbol: token.symbol,
      name: token.name,
      id: token.id,
      logo: token.logo,
      cgId: token.cgId || token.id,
    })
  }, [onViewToken, onClose])

  const content = (
    <div
      className={`ac-overlay${dayMode ? ' day-mode' : ''}`}
      onClick={handleBackdropClick}
    >
      <div className="ac-modal" onClick={(e) => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="ac-header">
          <div className="ac-header-text">
            <h2 className="ac-title">{t('heatmaps.tokenComparison')}</h2>
            <p className="ac-subtitle">{t('heatmaps.assetsSideBySide', { count: tokens.length })}</p>
          </div>
          <button className="ac-close" onClick={onClose} title={t('heatmaps.close')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Scrollable Content ── */}
        <div className="ac-content" style={{ '--ac-cols': tokens.length }}>
          {/* ── Token Cards Row ── */}
          <div className="ac-cards-row">
            {tokens.map((token, idx) => {
              const isLeader = idx === bestPerformerIdx
              const change = token.change24h ?? 0
              const isPositive = change >= 0

              return (
                <div
                  key={token.symbol || idx}
                  className={`ac-token-card${idx === overallWinnerIdx ? ' ac-card-winner' : ''}`}
                >
                  {/* Top hairline accent */}
                  <div className="ac-card-indicator" />

                  {/* Rank badge */}
                  <div className="ac-rank-badge">#{token.rank || idx + 1}</div>

                  {/* Leader badge */}
                  {isLeader && (
                    <div className="ac-leader-badge">{t('heatmaps.leader')}</div>
                  )}

                  {/* Logo */}
                  <div className="ac-token-logo-wrap">
                    {token.logo ? (
                      <img className="ac-token-logo" src={token.logo} alt={token.symbol} />
                    ) : (
                      <div className="ac-token-logo-fallback">
                        {(token.symbol || '?')[0]}
                      </div>
                    )}
                  </div>

                  {/* Name + Symbol */}
                  <div className="ac-token-symbol">{token.symbol}</div>
                  <div className="ac-token-name">{token.name}</div>

                  {/* Price */}
                  <div className="ac-token-price">{fmtPrice(token.price)}</div>

                  {/* 24h Change pill */}
                  <div className={`ac-change-pill ${isPositive ? 'positive' : 'negative'}`}>
                    {formatPct(change)}
                  </div>

                  {/* Quick stats */}
                  <div className="ac-card-stats">
                    <div className="ac-card-stat">
                      <span className="ac-card-stat-label">{t('heatmaps.mcap')}</span>
                      <span className="ac-card-stat-value">{fmtLarge(token.marketCap)}</span>
                    </div>
                    <div className="ac-card-stat">
                      <span className="ac-card-stat-label">{t('heatmaps.vol')} 24h</span>
                      <span className="ac-card-stat-value">{fmtLarge(token.volume)}</span>
                    </div>
                  </div>

                  {/* View Token button — opens the token in Research Zone */}
                  {onViewToken && (
                    <button
                      type="button"
                      className="ac-view-details-btn"
                      onClick={() => handleViewDetails(token)}
                    >
                      {t('heatmaps.viewToken')}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Verdict ── */}
          <div className="ac-verdict">
            <h3 className="ac-section-title">{t('heatmaps.verdict')}</h3>
            <div className="ac-verdict-row">
              {tokens.map((token, idx) => {
                const isWinner = idx === overallWinnerIdx
                const wins = winCounts[idx]
                return (
                  <div
                    key={token.symbol || idx}
                    className={`ac-verdict-card${isWinner ? ' ac-verdict-winner' : ''}`}
                  >
                    <div className="ac-verdict-top">
                      {token.logo && <img className="ac-verdict-logo" src={token.logo} alt="" />}
                      <span className="ac-verdict-sym">{token.symbol}</span>
                      {isWinner && <span className="ac-verdict-badge">{t('heatmaps.winner')}</span>}
                    </div>
                    <div className="ac-verdict-count">
                      <span className="ac-verdict-num">{wins}</span>
                      <span className="ac-verdict-of">/{METRICS.length} {t('heatmaps.wins')}</span>
                    </div>
                    <div className="ac-verdict-bar-track">
                      <div
                        className="ac-verdict-bar-fill"
                        style={{ width: `${(wins / METRICS.length) * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Head-to-Head ── */}
          <div className="ac-breakdown">
            <h3 className="ac-section-title">{t('heatmaps.headToHead')}</h3>
            {/* Column headers — token pills */}
            <div className="ac-breakdown-headers">
              {tokens.map((token, idx) => (
                <div key={token.symbol || idx} className="ac-bh-token">
                  {token.logo && <img className="ac-bh-logo" src={token.logo} alt="" />}
                  <span className="ac-bh-sym">{token.symbol}</span>
                </div>
              ))}
            </div>
            <div className="ac-breakdown-rows">
              {metricResults.map((metric) => {
                const maxVal = metric.maxAbs

                return (
                  <div key={metric.id} className="ac-metric-row">
                    <div className="ac-metric-label">{metric.label}</div>
                    <div className="ac-metric-cards">
                      {tokens.map((token, idx) => {
                        const value = metric.values[idx]
                        const isNa = value == null
                        const formatted = metric.format(value)
                        const isWinner = metric.winnerIndices.includes(idx)
                        const barPct = isNa ? 0 : (Math.abs(value) / maxVal) * 100
                        const isChangeMetric = metric.id === 'change24h' || metric.id === 'change7d'
                        const tone = isNa ? ' na' : (isChangeMetric ? (value < 0 ? ' negative' : ' positive') : '')

                        return (
                          <div key={token.symbol || idx} className={`ac-metric-cell${isWinner ? ' ac-cell-winner' : ''}`}>
                            <div className="ac-metric-value-row">
                              <span
                                className={`ac-metric-value${tone}`}
                                title={isNa ? t('heatmaps.noData') : undefined}
                              >
                                {formatted}
                              </span>
                              {isWinner && (
                                <span className="ac-best-badge">
                                  <span className="ac-best-dot" />
                                  {t('heatmaps.best')}
                                </span>
                              )}
                            </div>
                            <div className="ac-metric-bar-track">
                              {!isNa && (
                                <div
                                  className={`ac-metric-bar-fill${isWinner ? ' ac-bar-winner' : ''}`}
                                  style={{ width: `${Math.max(barPct, 2)}%` }}
                                />
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
