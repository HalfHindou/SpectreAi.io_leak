/**
 * CompareBarModal - floating compare bar + side-by-side comparison modal.
 * Extracted from WelcomePage for maintainability.
 */
import React from 'react'
import { formatChange, getTokenInitials } from './welcome-page-helpers'
import AppPortal from '@/components/app-portal'

const CompareBar = ({ compareTokens, toggleCompareToken, exitCompareMode, openCompareModal, icons }) => (
  <div className="compare-bar">
    <div className="compare-tokens">
      {compareTokens.length === 0 ? (
        <span className="compare-hint">Select 2-4 tokens to compare</span>
      ) : (
        compareTokens.map(token => (
          <div key={token.address} className="compare-token">
            <span className="compare-token-symbol">{token.symbol}</span>
            <button onClick={(e) => toggleCompareToken(token, e)}>{icons.close}</button>
          </div>
        ))
      )}
    </div>
    <div className="compare-actions">
      <button className="btn-secondary" onClick={exitCompareMode}>Cancel</button>
      <button className="btn-primary" disabled={compareTokens.length < 2} onClick={openCompareModal}>
        Compare{compareTokens.length >= 2 && ` (${compareTokens.length})`}
      </button>
    </div>
  </div>
)

const CompareModal = ({
  compareTokens,
  closeCompareModal,
  exitCompareMode,
  handleSelectToken,
  fmtLarge,
  icons,
}) => (
  <AppPortal>
  <div className="modal-overlay" onClick={closeCompareModal}>
    <div className="compare-modal" onClick={e => e.stopPropagation()}>
      <div className="compare-modal-header">
        <div className="compare-modal-title">
          <h2>Compare Tokens</h2>
          <span className="compare-modal-subtitle">Analyzing {compareTokens.length} assets side-by-side</span>
        </div>
        <button className="modal-close" onClick={closeCompareModal}>{icons.close}</button>
      </div>

      {/* Token Cards Header */}
      <div className="compare-tokens-header">
        {compareTokens.map((token, idx) => (
          <div key={token.address} className="compare-token-card">
            <div className="compare-token-rank">#{token.rank || idx + 1}</div>
            <div className="compare-token-avatar">
              {token.logo ? (
                <img src={token.logo} alt={token.symbol} />
              ) : (
                <span>{getTokenInitials(token.symbol)}</span>
              )}
            </div>
            <div className="compare-token-info">
              <span className="compare-token-symbol">{token.symbol}</span>
              <span className="compare-token-name">{token.name}</span>
            </div>
            <span className="compare-token-network">{token.network}</span>
            <button
              className="compare-token-view"
              onClick={() => { handleSelectToken(token); closeCompareModal(); exitCompareMode() }}
            >
              View Details {icons.arrow}
            </button>
          </div>
        ))}
      </div>

      <div className="compare-modal-content">
        {/* Price Section */}
        <div className="compare-section">
          <h3 className="compare-section-title">Price & Performance</h3>
          <div className="compare-metrics-grid">
            <div className="compare-metric-row">
              <span className="compare-metric-label">Price</span>
              <div className="compare-metric-values">
                {compareTokens.map(token => (
                  <div key={token.address} className="compare-metric-value">
                    <span className="metric-main">
                      ${token.price < 0.01 ? token.price.toFixed(6) : token.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="compare-metric-row">
              <span className="compare-metric-label">24h Change</span>
              <div className="compare-metric-values">
                {compareTokens.map(token => {
                  const isWinner = token.change === Math.max(...compareTokens.map(t => t.change))
                  return (
                    <div key={token.address} className={`compare-metric-value ${isWinner ? 'winner' : ''}`}>
                      <span className={`metric-main ${token.change >= 0 ? 'positive' : 'negative'}`}>
                        {token.change >= 0 ? '+' : ''}{formatChange(token.change)}%
                      </span>
                      {isWinner && <span className="winner-badge">Top Performer</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Market Data Section */}
        <div className="compare-section">
          <h3 className="compare-section-title">Market Metrics</h3>
          <div className="compare-metrics-grid">
            <div className="compare-metric-row">
              <span className="compare-metric-label">Market Cap</span>
              <div className="compare-metric-values">
                {compareTokens.map(token => {
                  const maxMcap = Math.max(...compareTokens.map(t => t.marketCap))
                  const percentage = (token.marketCap / maxMcap) * 100
                  const isWinner = token.marketCap === maxMcap
                  return (
                    <div key={token.address} className={`compare-metric-value ${isWinner ? 'winner' : ''}`}>
                      <span className="metric-main">{fmtLarge(token.marketCap)}</span>
                      <div className="compare-bar">
                        <div className="compare-bar-fill mcap" style={{ width: `${percentage}%` }}></div>
                      </div>
                      {isWinner && <span className="winner-badge">Largest Cap</span>}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="compare-metric-row">
              <span className="compare-metric-label">Volume (24h)</span>
              <div className="compare-metric-values">
                {compareTokens.map(token => {
                  const maxVol = Math.max(...compareTokens.map(t => t.volume))
                  const percentage = (token.volume / maxVol) * 100
                  const isWinner = token.volume === maxVol
                  return (
                    <div key={token.address} className={`compare-metric-value ${isWinner ? 'winner' : ''}`}>
                      <span className="metric-main">{fmtLarge(token.volume)}</span>
                      <div className="compare-bar">
                        <div className="compare-bar-fill volume" style={{ width: `${percentage}%` }}></div>
                      </div>
                      {isWinner && <span className="winner-badge">Most Traded</span>}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="compare-metric-row">
              <span className="compare-metric-label">Turnover Rate</span>
              <div className="compare-metric-values">
                {compareTokens.map(token => {
                  const ratio = token.marketCap > 0 ? (token.volume / token.marketCap) * 100 : 0
                  const maxRatio = Math.max(...compareTokens.map(t => t.marketCap > 0 ? (t.volume / t.marketCap) * 100 : 0))
                  const isWinner = ratio === maxRatio && ratio > 0
                  return (
                    <div key={token.address} className={`compare-metric-value ${isWinner ? 'winner' : ''}`}>
                      <span className="metric-main">{ratio.toFixed(2)}%</span>
                      {isWinner && <span className="winner-badge">High Activity</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Community Section */}
        <div className="compare-section">
          <h3 className="compare-section-title">Community & Liquidity</h3>
          <div className="compare-metrics-grid">
            <div className="compare-metric-row">
              <span className="compare-metric-label">Holders</span>
              <div className="compare-metric-values">
                {compareTokens.map(token => {
                  const maxHolders = Math.max(...compareTokens.map(t => t.holders))
                  const percentage = (token.holders / maxHolders) * 100
                  const isWinner = token.holders === maxHolders
                  return (
                    <div key={token.address} className={`compare-metric-value ${isWinner ? 'winner' : ''}`}>
                      <span className="metric-main">{token.holders.toLocaleString()}</span>
                      <div className="compare-bar">
                        <div className="compare-bar-fill holders" style={{ width: `${percentage}%` }}></div>
                      </div>
                      {isWinner && <span className="winner-badge">Most Holders</span>}
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="compare-metric-row">
              <span className="compare-metric-label">Liquidity</span>
              <div className="compare-metric-values">
                {compareTokens.map(token => {
                  const liq = token.liquidity || token.volume * 0.1
                  const maxLiq = Math.max(...compareTokens.map(t => t.liquidity || t.volume * 0.1))
                  const percentage = (liq / maxLiq) * 100
                  const isWinner = liq === maxLiq
                  return (
                    <div key={token.address} className={`compare-metric-value ${isWinner ? 'winner' : ''}`}>
                      <span className="metric-main">{fmtLarge(liq)}</span>
                      <div className="compare-bar">
                        <div className="compare-bar-fill volume" style={{ width: `${percentage}%` }}></div>
                      </div>
                      {isWinner && <span className="winner-badge">Deepest Pool</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="compare-summary">
          <div className="compare-summary-title">Analysis Summary</div>
          <div className="compare-summary-items">
            {compareTokens.map(token => {
              const totalMetrics = 5
              const wins = [
                token.change === Math.max(...compareTokens.map(t => t.change)),
                token.marketCap === Math.max(...compareTokens.map(t => t.marketCap)),
                token.volume === Math.max(...compareTokens.map(t => t.volume)),
                token.holders === Math.max(...compareTokens.map(t => t.holders)),
                (token.liquidity || token.volume * 0.1) === Math.max(...compareTokens.map(t => t.liquidity || t.volume * 0.1)),
              ].filter(Boolean).length
              return (
                <div key={token.address} className="compare-summary-item">
                  <span className="summary-token">{token.symbol}</span>
                  <span className="summary-wins">{wins}/{totalMetrics} metrics leading</span>
                  <span className={`summary-change ${token.change >= 0 ? 'positive' : 'negative'}`}>
                    {token.change >= 0 ? '↑' : '↓'} {formatChange(Math.abs(token.change))}% today
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  </div>
  </AppPortal>
)

export { CompareBar, CompareModal }
