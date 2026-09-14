/**
 * CompareModal - Apple Cinematic Token Comparison
 * Side-by-side analysis with glass cards, animated bars, and verdict summary
 */
import React, { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { formatLargeNumber } from '../services/codexApi'
import Icon from './Icon'
import './CompareModal.css'

const formatPrice = (price) => {
  if (!price || price === 0) return '$0.00'
  if (price < 0.0001) return `$${price.toFixed(8)}`
  if (price < 0.01) return `$${price.toFixed(6)}`
  if (price < 1) return `$${price.toFixed(4)}`
  return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const CompareModal = ({ compareTokens, onClose, onSelectToken }) => {
  const formatChange = (change) => {
    const value = typeof change === 'number' ? change : parseFloat(change) || 0
    const isDecimal = Math.abs(value) <= 1 && value !== 0
    return (isDecimal ? value * 100 : value).toFixed(2)
  }

  const getTokenInitials = (symbol) => symbol?.slice(0, 2).toUpperCase() || '??'

  // Data access helpers
  const getVolume = (token) => token.volume24h || token.volume || 0
  const getHolders = (token) => token.holders || 0
  const getLiquidity = (token) => token.liquidity || 0
  const getChange = (token) => token.change24h ?? token.change ?? 0
  const hasHoldersData = compareTokens.some(t => getHolders(t) > 0)
  const hasLiquidityData = compareTokens.some(t => (t.liquidity || 0) > 0)

  // Compute winners and scores
  const analysis = useMemo(() => {
    const metrics = [
      { key: 'change', label: '24h Change', getValue: getChange, format: v => `${v >= 0 ? '+' : ''}${formatChange(v)}%`, higherWins: true },
      { key: 'mcap', label: 'Market Cap', getValue: t => t.marketCap || 0, format: formatLargeNumber, higherWins: true },
      { key: 'volume', label: 'Volume 24h', getValue: getVolume, format: formatLargeNumber, higherWins: true },
      { key: 'turnover', label: 'Turnover', getValue: t => t.marketCap > 0 ? (getVolume(t) / t.marketCap) * 100 : 0, format: v => `${v.toFixed(2)}%`, higherWins: true },
    ]
    if (hasHoldersData) {
      metrics.push({ key: 'holders', label: 'Holders', getValue: getHolders, format: v => v.toLocaleString(), higherWins: true })
    }
    if (hasLiquidityData) {
      metrics.push({ key: 'liquidity', label: 'Liquidity', getValue: getLiquidity, format: formatLargeNumber, higherWins: true })
    }

    const scores = compareTokens.map(() => 0)
    const results = metrics.map(metric => {
      const values = compareTokens.map(metric.getValue)
      const best = metric.higherWins ? Math.max(...values) : Math.min(...values)
      const winnerIdx = values.indexOf(best)
      if (best !== 0) scores[winnerIdx]++
      return {
        ...metric,
        values,
        winnerIdx: best !== 0 ? winnerIdx : -1,
        max: Math.max(...values.map(Math.abs)),
      }
    })

    const maxScore = Math.max(...scores)
    const leaderIdx = scores.indexOf(maxScore)

    return { metrics: results, scores, leaderIdx, totalMetrics: metrics.length }
  }, [compareTokens])

  return createPortal(
    <div className="cmp-overlay" onClick={onClose}>
      <div className="cmp-modal" onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="cmp-header">
          <div className="cmp-header-text">
            <h2 className="cmp-title">Token Comparison</h2>
            <span className="cmp-subtitle">{compareTokens.length} assets - side-by-side analysis</span>
          </div>
          <button className="cmp-close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>

        {/* ── Token Hero Cards ── */}
        <div className="cmp-heroes">
          {compareTokens.map((token, idx) => {
            const change = getChange(token)
            const isLeader = idx === analysis.leaderIdx
            return (
              <div key={token.address} className={`cmp-hero${isLeader ? ' cmp-hero--leader' : ''}`}>
                {isLeader && <div className="cmp-hero-crown">Leader</div>}
                <div className="cmp-hero-rank">#{token.rank || idx + 1}</div>
                <div className="cmp-hero-avatar">
                  {token.logo ? (
                    <img src={token.logo} alt={token.symbol} />
                  ) : (
                    <span>{getTokenInitials(token.symbol)}</span>
                  )}
                </div>
                <span className="cmp-hero-symbol">{token.symbol}</span>
                <span className="cmp-hero-name">{token.name}</span>
                <div className="cmp-hero-price">{formatPrice(token.price)}</div>
                <div className={`cmp-hero-change ${change >= 0 ? 'bull' : 'bear'}`}>
                  {change >= 0 ? '+' : ''}{formatChange(change)}%
                </div>
                {token.network && (
                  <span className="cmp-hero-network">{token.network}</span>
                )}
                <button className="cmp-hero-action" onClick={() => onSelectToken(token)}>
                  View Details
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
              </div>
            )
          })}
        </div>

        {/* ── Scrollable Metrics ── */}
        <div className="cmp-content">

          {/* Score overview */}
          <div className="cmp-scores">
            <div className="cmp-section-label">Metrics Scorecard</div>
            <div className="cmp-scores-row">
              {compareTokens.map((token, idx) => (
                <div key={token.address} className={`cmp-score-card${idx === analysis.leaderIdx ? ' cmp-score-card--leader' : ''}`}>
                  <div className="cmp-score-ring">
                    <svg viewBox="0 0 40 40">
                      <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.08" />
                      <circle
                        cx="20" cy="20" r="16" fill="none"
                        stroke={idx === analysis.leaderIdx ? 'var(--bull, #34d399)' : 'rgba(255,255,255,0.25)'}
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray={`${(analysis.scores[idx] / analysis.totalMetrics) * 100.5} 100.5`}
                        transform="rotate(-90 20 20)"
                        style={{ transition: 'stroke-dasharray 1s cubic-bezier(0.16, 1, 0.3, 1)' }}
                      />
                    </svg>
                    <span className="cmp-score-num">{analysis.scores[idx]}</span>
                  </div>
                  <span className="cmp-score-symbol">{token.symbol}</span>
                  <span className="cmp-score-label">{analysis.scores[idx]}/{analysis.totalMetrics} wins</span>
                </div>
              ))}
            </div>
          </div>

          {/* Metric rows */}
          <div className="cmp-metrics">
            <div className="cmp-section-label">Detailed Breakdown</div>
            {analysis.metrics.map((metric) => (
              <div key={metric.key} className="cmp-metric">
                <div className="cmp-metric-label">{metric.label}</div>
                <div className="cmp-metric-cells">
                  {metric.values.map((value, idx) => {
                    const isWinner = idx === metric.winnerIdx
                    const barPct = metric.max > 0 ? (Math.abs(value) / metric.max) * 100 : 0
                    const isChange = metric.key === 'change'
                    return (
                      <div key={compareTokens[idx].address} className={`cmp-metric-cell${isWinner ? ' cmp-metric-cell--winner' : ''}`}>
                        <span className={`cmp-metric-value${isChange ? (value >= 0 ? ' bull' : ' bear') : ''}`}>
                          {metric.format(value)}
                        </span>
                        <div className="cmp-metric-bar">
                          <div
                            className={`cmp-metric-bar-fill${isWinner ? ' cmp-metric-bar-fill--winner' : ''}${isChange ? (value >= 0 ? ' bull' : ' bear') : ''}`}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                        {isWinner && <span className="cmp-metric-badge">Best</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Verdict */}
          <div className="cmp-verdict">
            <div className="cmp-section-label">Verdict</div>
            <div className="cmp-verdict-cards">
              {compareTokens.map((token, idx) => {
                const isLeader = idx === analysis.leaderIdx
                const change = getChange(token)
                return (
                  <div key={token.address} className={`cmp-verdict-card${isLeader ? ' cmp-verdict-card--leader' : ''}`}>
                    {isLeader && <div className="cmp-verdict-flag">Overall Leader</div>}
                    <div className="cmp-verdict-head">
                      <div className="cmp-verdict-avatar">
                        {token.logo ? <img src={token.logo} alt={token.symbol} /> : <span>{getTokenInitials(token.symbol)}</span>}
                      </div>
                      <div className="cmp-verdict-info">
                        <span className="cmp-verdict-symbol">{token.symbol}</span>
                        <span className="cmp-verdict-score">{analysis.scores[idx]}/{analysis.totalMetrics} metrics leading</span>
                      </div>
                    </div>
                    <div className="cmp-verdict-stats">
                      <div className="cmp-verdict-stat">
                        <span className="cmp-verdict-stat-label">Price</span>
                        <span className="cmp-verdict-stat-value">{formatPrice(token.price)}</span>
                      </div>
                      <div className="cmp-verdict-stat">
                        <span className="cmp-verdict-stat-label">24h</span>
                        <span className={`cmp-verdict-stat-value ${change >= 0 ? 'bull' : 'bear'}`}>
                          {change >= 0 ? '+' : ''}{formatChange(change)}%
                        </span>
                      </div>
                      <div className="cmp-verdict-stat">
                        <span className="cmp-verdict-stat-label">MCap</span>
                        <span className="cmp-verdict-stat-value">{formatLargeNumber(token.marketCap || 0)}</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default CompareModal
