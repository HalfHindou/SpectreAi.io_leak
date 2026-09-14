import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getApiKey, clearApiKey, isAuthenticated, isAuthenticatedAsync, apiCall, API_BASE } from './utils/auth'
import './dashboard.css'

/* ══════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════ */

function maskKey(key) {
  if (!key || key.length < 12) return key
  return key.slice(0, 10) + '...' + key.slice(-6)
}

function formatDate(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button className="dash-copy-btn" onClick={copy} title="Copy">
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
      )}
      {label && <span>{copied ? 'Copied' : label}</span>}
    </button>
  )
}

/* ══════════════════════════════════════════════════════════════
   TIER CONFIG
   - Mirrors the backend's tier ladder (explorer/analyst/institutional).
   - Daily limits come from the live /v1/auth/usage response so they stay
     authoritative even if the backend ladder changes - the labels and
     colours here are presentation-only.
   ══════════════════════════════════════════════════════════════ */

const TIERS = {
  explorer:      { label: 'Explorer',      color: 'rgba(245,245,247,0.7)' },
  analyst:       { label: 'Analyst',       color: '#6B9AE8' },
  institutional: { label: 'Institutional', color: '#10B981' },
}

/* ══════════════════════════════════════════════════════════════
   DASHBOARD COMPONENT
   ══════════════════════════════════════════════════════════════ */

export default function ApiDashboardPage() {
  const navigate = useNavigate()

  // Sync auth guard - hide content until async validation lands.
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate('/website2/api/login', { replace: true })
      return
    }
    let cancelled = false
    ;(async () => {
      const ok = await isAuthenticatedAsync()
      if (cancelled) return
      if (!ok) {
        navigate('/website2/api/login', { replace: true })
        return
      }
      setAuthChecked(true)
    })()
    return () => { cancelled = true }
  }, [navigate])

  // Font load
  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'
    document.head.appendChild(link)
    return () => { if (link.parentNode) link.parentNode.removeChild(link) }
  }, [])

  // Override root overflow so the dashboard can scroll natively.
  useEffect(() => {
    const html = document.documentElement
    const root = document.getElementById('root')
    const prev = {
      htmlHeight: html.style.height, htmlOverflow: html.style.overflow,
      rootHeight: root?.style.height, rootOverflow: root?.style.overflow,
      bodyOverflow: document.body.style.overflow,
    }
    html.style.height = 'auto'
    html.style.overflow = 'visible'
    if (root) { root.style.height = 'auto'; root.style.overflow = 'visible' }
    return () => {
      const currentRoot = document.getElementById('root')
      html.style.height = prev.htmlHeight || ''
      html.style.overflow = prev.htmlOverflow || ''
      if (currentRoot) { currentRoot.style.height = prev.rootHeight || ''; currentRoot.style.overflow = prev.rootOverflow || '' }
      document.body.style.overflow = prev.bodyOverflow || ''
    }
  }, [])

  // State
  const [usage, setUsage] = useState(null) // tier/daily_limit/calls_today/calls_remaining/calls_total/spect_balance/member_since/last_call/endpoint_usage_24h
  const [loadingUsage, setLoadingUsage] = useState(true)
  const [walletInput, setWalletInput] = useState('')
  const [balanceMsg, setBalanceMsg] = useState('')
  const [checkingBalance, setCheckingBalance] = useState(false)
  const [keyRevealed, setKeyRevealed] = useState(false)

  const apiKey = getApiKey() || ''

  // Load usage
  const loadUsage = useCallback(async () => {
    setLoadingUsage(true)
    try {
      const res = await apiCall('/v1/auth/usage')
      if (!res) return
      const data = await res.json()
      const payload = data?.data || data
      if (payload?.tier) setUsage(payload)
    } finally {
      setLoadingUsage(false)
    }
  }, [])

  useEffect(() => {
    if (authChecked) loadUsage()
  }, [authChecked, loadUsage])

  // Actions
  const handleCheckBalance = async () => {
    setBalanceMsg('')
    const wallet = walletInput.trim()
    if (!wallet) {
      setBalanceMsg('Enter a wallet address first')
      return
    }
    setCheckingBalance(true)
    try {
      const res = await apiCall('/v1/auth/check-balance', {
        method: 'POST',
        body: JSON.stringify({ wallet_address: wallet }),
      })
      if (!res) return
      const data = await res.json()
      const payload = data?.data || data
      if (payload?.tier) {
        setBalanceMsg(
          `Verified: ${(payload.spect_balance ?? 0).toLocaleString()} $SPECT - tier set to ${payload.tier}`
        )
        // Refresh usage so the dashboard reflects the new tier.
        loadUsage()
      } else if (data?.message || data?.error) {
        setBalanceMsg(data.message || data.error)
      } else {
        setBalanceMsg('Balance checked.')
      }
    } catch {
      setBalanceMsg('Network error - try again')
    } finally {
      setCheckingBalance(false)
    }
  }

  const logout = () => {
    clearApiKey()
    navigate('/website2/api/login')
  }

  // ─── Auth-checking gate ───
  if (!authChecked) {
    return (
      <div className="dash-page">
        <div className="dash-page-glow" />
      </div>
    )
  }

  const tierKey = (usage?.tier || 'explorer').toLowerCase()
  const tierConfig = TIERS[tierKey] || TIERS.explorer

  const dailyLimit = usage?.daily_limit ?? 0
  const callsToday = usage?.calls_today ?? 0
  const callsRemaining = usage?.calls_remaining ?? Math.max(0, dailyLimit - callsToday)
  const usagePercent = dailyLimit > 0 ? Math.min(100, Math.round((callsToday / dailyLimit) * 100)) : 0

  return (
    <div className="dash-page">
      <div className="dash-page-glow" />

      {/* Welcome bar */}
      <header className="dash-header">
        <div className="dash-header-inner">
          <div className="dash-header-left">
            <img src="/round-logo.png" alt="Spectre" className="dash-logo" />
            <span className="dash-header-text">Developer Dashboard</span>
            <span className="dash-tier-badge" style={{ color: tierConfig.color, borderColor: tierConfig.color + '33' }}>
              {tierConfig.label}
            </span>
          </div>
          <button className="dash-logout" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="dash-main">
        {/* ── API Key ── */}
        <section className="dash-card">
          <div className="dash-card-header">
            <h2 className="dash-card-title">Your API Key</h2>
            <CopyButton text={apiKey} label="Copy key" />
          </div>
          <div className="dash-qs-key-row">
            <span className="dash-qs-label">Key</span>
            <div className="dash-qs-key-wrap">
              <code className="dash-qs-key">{keyRevealed ? apiKey : maskKey(apiKey)}</code>
              <button className="dash-btn-secondary" type="button" onClick={() => setKeyRevealed((v) => !v)}>
                {keyRevealed ? 'Hide' : 'Reveal'}
              </button>
            </div>
          </div>
          <p className="dash-empty" style={{ marginTop: 8, padding: 0, border: 'none' }}>
            Send this on every request as <code className="dash-mono">X-API-Key</code>. Lost it? Sign up again with the same email or wallet to retrieve it.
          </p>
        </section>

        {/* ── Usage ── */}
        <section className="dash-card">
          <h2 className="dash-card-title">Usage</h2>
          {loadingUsage && !usage ? (
            <p className="dash-empty">Loading usage data...</p>
          ) : (
            <>
              <div className="dash-usage-grid">
                <div className="dash-usage-stat">
                  <span className="dash-usage-label">Calls today</span>
                  <span className="dash-usage-value">{callsToday.toLocaleString()}</span>
                </div>
                <div className="dash-usage-stat">
                  <span className="dash-usage-label">Calls remaining</span>
                  <span className="dash-usage-value">{callsRemaining.toLocaleString()}</span>
                </div>
                <div className="dash-usage-stat">
                  <span className="dash-usage-label">Daily limit</span>
                  <span className="dash-usage-value">{dailyLimit.toLocaleString()}</span>
                </div>
                <div className="dash-usage-stat">
                  <span className="dash-usage-label">Calls total</span>
                  <span className="dash-usage-value">{(usage?.calls_total ?? 0).toLocaleString()}</span>
                </div>
              </div>
              <div className="dash-progress-track">
                <div
                  className={`dash-progress-fill${usagePercent >= 80 ? ' dash-progress-fill--warn' : ''}`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
              <div className="dash-progress-labels">
                <span className="dash-progress-pct">{usagePercent}% used</span>
                <span className="dash-progress-limit">{dailyLimit.toLocaleString()} / day</span>
              </div>
              {usagePercent >= 80 && (
                <p className="dash-usage-warning">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                  {usagePercent}% of your daily limit used. Hold more $SPECT to unlock a higher tier.
                </p>
              )}
            </>
          )}
        </section>

        {/* ── Account ── */}
        <section className="dash-card">
          <h2 className="dash-card-title">Account</h2>
          <div className="dash-usage-grid">
            <div className="dash-usage-stat">
              <span className="dash-usage-label">Tier</span>
              <span className="dash-usage-value" style={{ color: tierConfig.color }}>{tierConfig.label}</span>
            </div>
            <div className="dash-usage-stat">
              <span className="dash-usage-label">$SPECT balance</span>
              <span className="dash-usage-value">{(usage?.spect_balance ?? 0).toLocaleString()}</span>
            </div>
            <div className="dash-usage-stat">
              <span className="dash-usage-label">Member since</span>
              <span className="dash-usage-value">{formatDate(usage?.member_since)}</span>
            </div>
            <div className="dash-usage-stat">
              <span className="dash-usage-label">Last call</span>
              <span className="dash-usage-value">{formatDateTime(usage?.last_call)}</span>
            </div>
          </div>
        </section>

        {/* ── Unlock tier (check $SPECT balance) ── */}
        <section className="dash-card">
          <div className="dash-card-header">
            <h2 className="dash-card-title">Unlock higher tier</h2>
          </div>
          <p className="dash-empty" style={{ padding: 0, border: 'none', marginBottom: 12 }}>
            Hold $SPECT in a wallet, paste it here, and we'll auto-upgrade your tier on the spot.
          </p>
          <div className="dash-qs-key-row">
            <input
              className="dash-balance-input"
              type="text"
              placeholder="0x... or Solana address"
              value={walletInput}
              onChange={(e) => { setWalletInput(e.target.value.trim()); setBalanceMsg('') }}
              autoComplete="off"
              spellCheck="false"
            />
            <button className="dash-btn-primary" onClick={handleCheckBalance} disabled={checkingBalance}>
              {checkingBalance ? <span className="dash-spinner" /> : null}
              Check $SPECT balance
            </button>
          </div>
          {balanceMsg && <p className="dash-empty" style={{ marginTop: 12 }}>{balanceMsg}</p>}
        </section>

        {/* ── Endpoint usage (24h) ── */}
        {usage?.endpoint_usage_24h && usage.endpoint_usage_24h.length > 0 && (
          <section className="dash-card">
            <h2 className="dash-card-title">Endpoint usage (24h)</h2>
            <div className="dash-keys-list">
              {usage.endpoint_usage_24h.map((ep, i) => (
                <div className="dash-key-row" key={`${ep.endpoint || ep.path || i}`}>
                  <code className="dash-key-value">{ep.endpoint || ep.path || 'unknown'}</code>
                  <div className="dash-key-meta">
                    <span className="dash-key-meta-item">
                      <span className="dash-mono">{(ep.calls ?? ep.count ?? 0).toLocaleString()}</span> calls
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Quick Start ── */}
        <section className="dash-card">
          <h2 className="dash-card-title">Quick Start</h2>

          <div className="dash-qs-block">
            <span className="dash-qs-block-label">cURL</span>
            <pre className="dash-qs-code">{`curl -H "X-API-Key: ${maskKey(apiKey)}" \\
  ${API_BASE}/v1/auth/usage`}</pre>
            <CopyButton text={`curl -H "X-API-Key: ${apiKey}" ${API_BASE}/v1/auth/usage`} label="Copy curl" />
          </div>

          <div className="dash-qs-block">
            <span className="dash-qs-block-label">JavaScript (fetch)</span>
            <pre className="dash-qs-code">{`fetch('${API_BASE}/v1/auth/usage', {
  headers: { 'X-API-Key': process.env.SPECTRE_API_KEY }
}).then(r => r.json()).then(console.log)`}</pre>
          </div>

          <a href="https://docs.spectreai.io" target="_blank" rel="noreferrer" className="dash-qs-docs-link">
            View full documentation
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17l9.2-9.2M17 17V7H7" /></svg>
          </a>
        </section>
      </main>
    </div>
  )
}
