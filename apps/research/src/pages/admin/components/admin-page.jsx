/**
 * Admin Page - Fee Configuration + Revenue Dashboard
 * Requires ADMIN_API_KEY to access data.
 */
import { useState, useEffect, useCallback } from 'react'
import './admin-page.css'

const API_BASE = '/api/admin'

function AdminPage({ dayMode, onBack }) {
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem('spectre-admin-key') || '')
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  // Fee config state
  const [feeConfig, setFeeConfig] = useState(null)
  const [editConfig, setEditConfig] = useState(null)

  // Stats state
  const [stats, setStats] = useState(null)

  // Transactions state
  const [transactions, setTransactions] = useState([])
  const [txTotal, setTxTotal] = useState(0)

  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${adminKey}`,
  }), [adminKey])

  // Authenticate and load data
  const authenticate = useCallback(async () => {
    if (!adminKey) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/fee-config`, { headers: headers() })
      if (res.status === 401 || res.status === 403) {
        setError('Invalid admin key')
        setAuthenticated(false)
        setLoading(false)
        return
      }
      if (!res.ok) throw new Error(`Server error: ${res.status}`)
      const config = await res.json()
      setFeeConfig(config)
      setEditConfig(JSON.parse(JSON.stringify(config)))
      setAuthenticated(true)
      localStorage.setItem('spectre-admin-key', adminKey)

      // Load stats and transactions in parallel
      const [statsRes, txRes] = await Promise.all([
        fetch(`${API_BASE}/stats`, { headers: headers() }),
        fetch(`${API_BASE}/transactions?limit=50`, { headers: headers() }),
      ])
      if (statsRes.ok) setStats(await statsRes.json())
      if (txRes.ok) {
        const txData = await txRes.json()
        setTransactions(txData.transactions || [])
        setTxTotal(txData.total || 0)
      }
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }, [adminKey, headers])

  useEffect(() => {
    if (adminKey) authenticate()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Save fee config
  const saveFeeConfig = async () => {
    setError(null)
    setSuccess(null)
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/fee-config`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify(editConfig),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save')
      setFeeConfig(data.config)
      setEditConfig(JSON.parse(JSON.stringify(data.config)))
      setSuccess('Fee config saved successfully')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const hasChanges = JSON.stringify(feeConfig) !== JSON.stringify(editConfig)

  // Login screen
  if (!authenticated) {
    return (
      <div className={`admin-page ${dayMode ? 'day' : ''}`}>
        <div className="admin-login-card">
          <div className="admin-login-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2 className="admin-login-title">Admin Access</h2>
          <p className="admin-login-subtitle">Enter your admin API key to manage fee configuration</p>
          <input
            type="password" autoComplete="current-password"
            className="admin-login-input"
            placeholder="Admin API Key"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && authenticate()}
          />
          {error && <div className="admin-error">{error}</div>}
          <button className="admin-login-btn" onClick={authenticate} disabled={loading || !adminKey}>
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`admin-page ${dayMode ? 'day' : ''}`}>
      <div className="admin-header">
        <div className="admin-header-left">
          <button className="admin-back-btn" onClick={onBack}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h1 className="admin-title">Fee Administration</h1>
        </div>
        <button className="admin-logout-btn" onClick={() => {
          setAuthenticated(false)
          setAdminKey('')
          localStorage.removeItem('spectre-admin-key')
        }}>
          Sign Out
        </button>
      </div>

      {error && <div className="admin-error admin-error-global">{error}</div>}
      {success && <div className="admin-success">{success}</div>}

      {/* Revenue Stats */}
      {stats && (
        <div className="admin-section">
          <h2 className="admin-section-title">Revenue Overview</h2>
          <div className="admin-stats-grid">
            <StatCard label="Fee Rate" value={`${stats.feePercentage}%`} />
            <StatCard label="Total Volume" value={formatUsd(stats.totalVolume)} />
            <StatCard label="Total Fees" value={formatUsd(stats.totalFees)} accent />
            <StatCard label="Total Swaps" value={stats.totalTransactions.toLocaleString()} />
            <StatCard label="24h Volume" value={formatUsd(stats.last24h?.volume)} />
            <StatCard label="24h Fees" value={formatUsd(stats.last24h?.fees)} accent />
            <StatCard label="7d Volume" value={formatUsd(stats.last7d?.volume)} />
            <StatCard label="7d Fees" value={formatUsd(stats.last7d?.fees)} accent />
          </div>
        </div>
      )}

      {/* Fee Configuration */}
      {editConfig && (
        <div className="admin-section">
          <h2 className="admin-section-title">Fee Configuration</h2>
          <div className="admin-fee-card">
            <div className="admin-fee-row">
              <label className="admin-fee-label">Fee Percentage</label>
              <div className="admin-fee-input-group">
                <input
                  type="number"
                  className="admin-fee-input"
                  value={editConfig.feePercentage}
                  onChange={(e) => setEditConfig(prev => ({
                    ...prev,
                    feePercentage: parseFloat(e.target.value) || 0,
                    feeBps: Math.round((parseFloat(e.target.value) || 0) * 100),
                  }))}
                  min="0"
                  max="10"
                  step="0.1"
                />
                <span className="admin-fee-unit">%</span>
              </div>
              <span className="admin-fee-hint">{editConfig.feeBps} basis points</span>
            </div>

            {['primary', 'secondary', 'tertiary'].map((tier) => (
              <div key={tier} className="admin-wallet-section">
                <h3 className="admin-wallet-tier">{tier.charAt(0).toUpperCase() + tier.slice(1)} Wallet</h3>
                <div className="admin-fee-row">
                  <label className="admin-fee-label">Revenue Share</label>
                  <div className="admin-fee-input-group">
                    <input
                      type="number"
                      className="admin-fee-input admin-fee-input-sm"
                      value={editConfig.feeWallets[tier].share}
                      onChange={(e) => setEditConfig(prev => ({
                        ...prev,
                        feeWallets: {
                          ...prev.feeWallets,
                          [tier]: { ...prev.feeWallets[tier], share: parseInt(e.target.value, 10) || 0 },
                        },
                      }))}
                      min="0"
                      max="100"
                    />
                    <span className="admin-fee-unit">%</span>
                  </div>
                </div>
                <div className="admin-fee-row">
                  <label className="admin-fee-label">EVM Address</label>
                  <input
                    type="text"
                    className="admin-fee-input admin-fee-input-address"
                    value={editConfig.feeWallets[tier].evm}
                    onChange={(e) => setEditConfig(prev => ({
                      ...prev,
                      feeWallets: {
                        ...prev.feeWallets,
                        [tier]: { ...prev.feeWallets[tier], evm: e.target.value },
                      },
                    }))}
                    placeholder="0x..."
                    spellCheck={false}
                  />
                </div>
                <div className="admin-fee-row">
                  <label className="admin-fee-label">Solana Address</label>
                  <input
                    type="text"
                    className="admin-fee-input admin-fee-input-address"
                    value={editConfig.feeWallets[tier].solana}
                    onChange={(e) => setEditConfig(prev => ({
                      ...prev,
                      feeWallets: {
                        ...prev.feeWallets,
                        [tier]: { ...prev.feeWallets[tier], solana: e.target.value },
                      },
                    }))}
                    placeholder="Base58 address..."
                    spellCheck={false}
                  />
                </div>
              </div>
            ))}

            <div className="admin-fee-actions">
              <button
                className="admin-save-btn"
                onClick={saveFeeConfig}
                disabled={!hasChanges || loading}
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
              {hasChanges && (
                <button
                  className="admin-reset-btn"
                  onClick={() => setEditConfig(JSON.parse(JSON.stringify(feeConfig)))}
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Transaction Log */}
      <div className="admin-section">
        <h2 className="admin-section-title">Recent Transactions ({txTotal})</h2>
        {transactions.length === 0 ? (
          <div className="admin-empty">No transactions recorded yet</div>
        ) : (
          <div className="admin-tx-table-wrap">
            <table className="admin-tx-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Chain</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Volume</th>
                  <th>Fee</th>
                  <th>Tx Hash</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, i) => (
                  <tr key={tx.txHash || i}>
                    <td className="admin-tx-time">{tx.timestamp ? new Date(tx.timestamp).toLocaleString() : '-'}</td>
                    <td>{tx.chainId || '-'}</td>
                    <td className="admin-tx-token">{tx.inputToken ? truncateAddress(tx.inputToken) : '-'}</td>
                    <td className="admin-tx-token">{tx.outputToken ? truncateAddress(tx.outputToken) : '-'}</td>
                    <td className="admin-tx-mono">{tx.volumeUsd ? formatUsd(tx.volumeUsd) : '-'}</td>
                    <td className="admin-tx-mono admin-tx-fee">{tx.feeUsd ? formatUsd(tx.feeUsd) : '-'}</td>
                    <td className="admin-tx-hash">{tx.txHash ? truncateAddress(tx.txHash) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, accent }) {
  return (
    <div className={`admin-stat-card ${accent ? 'accent' : ''}`}>
      <span className="admin-stat-label">{label}</span>
      <span className="admin-stat-value">{value}</span>
    </div>
  )
}

function formatUsd(value) {
  const num = parseFloat(value) || 0
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`
  if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`
  return `$${num.toFixed(2)}`
}

function truncateAddress(addr) {
  if (!addr || addr.length < 12) return addr || '-'
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export default AdminPage
