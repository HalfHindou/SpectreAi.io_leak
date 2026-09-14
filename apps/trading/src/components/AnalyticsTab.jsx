/**
 * AnalyticsTab Component
 * Shows first buyers, sniper detection, top traders by PnL,
 * trade size distribution, and other analytics from our API.
 */
import React, { useState, useMemo } from 'react'
import { useCopyToast } from '../App'

const shortenAddress = (addr) => {
  if (!addr) return '-'
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

const formatUsd = (val) => {
  const n = parseFloat(val) || 0
  if (n === 0) return '$0'
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(2)}K`
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(4)}`
}

const formatPnl = (val) => {
  const n = parseFloat(val) || 0
  const sign = n >= 0 ? '+' : ''
  return `${sign}${formatUsd(n)}`
}

const pnlColor = (val) => {
  const n = parseFloat(val) || 0
  if (n > 0) return '#10B981'
  if (n < 0) return '#EF4444'
  return '#9CA3AF'
}

const explorerUrl = (addr, networkId) => {
  if (networkId === 56) return `https://bscscan.com/address/${addr}`
  return `https://etherscan.io/address/${addr}`
}

const AnalyticsTab = ({ token, poolAddress }) => {
  const [subTab, setSubTab] = useState('first-buyers')
  const { triggerCopyToast } = useCopyToast()
  const networkId = token?.networkId || 1

  // Analytics data - placeholder until Codex provides these endpoints
  const buyers = []
  const buyersSummary = null
  const buyersLoading = false
  const topTraders = null
  const tradersLoading = false
  const percentiles = null
  const percLoading = false

  if (!poolAddress) {
    return (
      <div className="analytics-tab-empty">
        <p>Analytics coming soon.</p>
      </div>
    )
  }

  if (!poolAddress) {
    return (
      <div className="analytics-tab-empty">
        <p>No pool found for this token.</p>
      </div>
    )
  }

  return (
    <div className="analytics-tab">
      {/* Sub-navigation */}
      <div className="analytics-sub-tabs">
        {[
          { id: 'first-buyers', label: 'First Buyers' },
          { id: 'top-traders', label: 'Top Traders' },
          { id: 'distribution', label: 'Distribution' },
        ].map(st => (
          <button
            key={st.id}
            className={`analytics-sub-tab ${subTab === st.id ? 'active' : ''}`}
            onClick={() => setSubTab(st.id)}
          >
            {st.label}
          </button>
        ))}
      </div>

      {/* First Buyers */}
      {subTab === 'first-buyers' && (
        <div className="analytics-section">
          {/* Summary cards */}
          {buyersSummary && (
            <div className="analytics-summary-row">
              <div className="summary-card">
                <span className="summary-label">First Buyers</span>
                <span className="summary-value">{buyersSummary.total_buyers || buyers.length}</span>
              </div>
              <div className="summary-card">
                <span className="summary-label">Still Holding</span>
                <span className="summary-value" style={{ color: '#10B981' }}>
                  {buyersSummary.holders_count || 0}
                  {buyersSummary.total_buyers > 0 && (
                    <span className="summary-pct"> ({((buyersSummary.holders_count / buyersSummary.total_buyers) * 100).toFixed(0)}%)</span>
                  )}
                </span>
              </div>
              <div className="summary-card">
                <span className="summary-label">Snipers</span>
                <span className="summary-value" style={{ color: '#F43F5E' }}>
                  {buyersSummary.snipers_count || 0}
                </span>
              </div>
              <div className="summary-card">
                <span className="summary-label">Supply Held</span>
                <span className="summary-value">
                  {buyersSummary.supply_held_pct ? `${parseFloat(buyersSummary.supply_held_pct).toFixed(1)}%` : '-'}
                </span>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="table-wrapper">
            <table className="data-table analytics-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Address</th>
                  <th>First Buy</th>
                  <th>Status</th>
                  <th>PnL</th>
                  <th>Bought</th>
                  <th>Sold</th>
                </tr>
              </thead>
              <tbody>
                {buyersLoading ? (
                  <tr><td colSpan="7" className="loading-cell">Loading...</td></tr>
                ) : buyers.length === 0 ? (
                  <tr><td colSpan="7" className="empty-cell">No first buyers data</td></tr>
                ) : buyers.map((b, i) => (
                  <tr key={b.trader_address || i}>
                    <td className="td-rank">{i + 1}</td>
                    <td className="td-address">
                      <a
                        href={explorerUrl(b.trader_address, networkId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          e.preventDefault()
                          navigator.clipboard.writeText(b.trader_address)
                          triggerCopyToast('Address copied')
                        }}
                      >
                        {shortenAddress(b.trader_address)}
                      </a>
                      {b.is_sniper && <span className="badge badge-sniper">SNIPER</span>}
                      {b.is_bundled && <span className="badge badge-bundle">BUNDLE</span>}
                    </td>
                    <td className="td-amount">{formatUsd(b.first_buy_usd || b.total_buy_usd)}</td>
                    <td className="td-status">
                      <span className={`status-badge status-${(b.status || 'unknown').toLowerCase()}`}>
                        {b.status || (parseFloat(b.current_balance) > 0 ? 'HOLD' : 'SOLD')}
                      </span>
                    </td>
                    <td className="td-pnl" style={{ color: pnlColor(b.pnl_usd) }}>
                      {formatPnl(b.pnl_usd)}
                    </td>
                    <td className="td-amount">{formatUsd(b.total_buy_usd)}</td>
                    <td className="td-amount">{formatUsd(b.total_sell_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top Traders by PnL */}
      {subTab === 'top-traders' && (
        <div className="analytics-section">
          <div className="table-wrapper">
            <table className="data-table analytics-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Address</th>
                  <th>PnL</th>
                  <th>Buys</th>
                  <th>Sells</th>
                  <th>Volume</th>
                  <th>Trades</th>
                </tr>
              </thead>
              <tbody>
                {tradersLoading ? (
                  <tr><td colSpan="7" className="loading-cell">Loading...</td></tr>
                ) : !topTraders || (Array.isArray(topTraders) && topTraders.length === 0) ? (
                  <tr><td colSpan="7" className="empty-cell">No trader data</td></tr>
                ) : (Array.isArray(topTraders) ? topTraders : []).map((t, i) => (
                  <tr key={t.trader_address || t.maker || i}>
                    <td className="td-rank">{i + 1}</td>
                    <td className="td-address">
                      <a
                        href={explorerUrl(t.trader_address || t.maker, networkId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => {
                          e.preventDefault()
                          navigator.clipboard.writeText(t.trader_address || t.maker)
                          triggerCopyToast('Address copied')
                        }}
                      >
                        {shortenAddress(t.trader_address || t.maker)}
                      </a>
                    </td>
                    <td className="td-pnl" style={{ color: pnlColor(t.pnl_usd) }}>
                      {formatPnl(t.pnl_usd)}
                    </td>
                    <td className="td-amount">{formatUsd(t.total_buy_usd)}</td>
                    <td className="td-amount">{formatUsd(t.total_sell_usd)}</td>
                    <td className="td-amount">{formatUsd((parseFloat(t.total_buy_usd) || 0) + (parseFloat(t.total_sell_usd) || 0))}</td>
                    <td className="td-count">{(parseInt(t.total_buys) || 0) + (parseInt(t.total_sells) || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Trade Distribution */}
      {subTab === 'distribution' && (
        <div className="analytics-section">
          {percLoading ? (
            <div className="loading-cell">Loading distribution...</div>
          ) : !percentiles ? (
            <div className="empty-cell">No distribution data</div>
          ) : (
            <div className="distribution-grid">
              <div className="distribution-card">
                <h4>Trade Size Distribution (USD)</h4>
                <div className="percentile-list">
                  {(() => {
                    const p = Array.isArray(percentiles) ? percentiles[0] : percentiles;
                    return ['p25', 'p50', 'p75', 'p90', 'p95'].map(k => (
                      <div key={k} className="percentile-row">
                        <span className="perc-label">{k.toUpperCase()}</span>
                        <span className="perc-value">{formatUsd(p?.[k] || 0)}</span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default AnalyticsTab
