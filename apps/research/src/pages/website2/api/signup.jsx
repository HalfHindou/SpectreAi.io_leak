import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { setApiKey, isAuthenticated, API_BASE } from './utils/auth'
import './signup.css'

/* ──────────────────────────────────────────────────────────────
   Inline copy button (kept local so signup is self-contained)
   ────────────────────────────────────────────────────────────── */

function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button type="button" className="auth-copy-btn" onClick={copy} title="Copy to clipboard">
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>
      )}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  )
}

export default function ApiSignupPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [walletAddress, setWalletAddress] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Credentials returned from /v1/auth/register - shown on the one-time reveal screen
  const [credentials, setCredentials] = useState(null) // { api_key, api_secret, tier, daily_limit, message }
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'
    document.head.appendChild(link)
    return () => { if (link.parentNode) link.parentNode.removeChild(link) }
  }, [])

  useEffect(() => {
    if (isAuthenticated()) navigate('/website2/api/dashboard', { replace: true })
  }, [navigate])

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

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!email && !walletAddress) {
      setError('Provide either an email or a wallet address')
      return
    }

    setLoading(true)
    try {
      const body = {}
      if (email) body.email = email
      if (walletAddress) body.wallet_address = walletAddress

      const res = await fetch(`${API_BASE}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || data.message || 'Registration failed')
        return
      }
      const payload = data.data || data
      if (!payload?.api_key) {
        setError('Unexpected response from server')
        return
      }
      // DO NOT auto-store the key. User must explicitly confirm on the reveal screen.
      setCredentials(payload)
    } catch {
      setError('Network error - please try again')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = () => {
    if (!credentials?.api_key || !acknowledged) return
    setApiKey(credentials.api_key, credentials.api_secret)
    navigate('/website2/api/dashboard')
  }

  /* ─────────── One-time reveal screen ─────────── */
  if (credentials) {
    const isReturning = (credentials.message || '').toLowerCase().includes('already')

    return (
      <div className="auth-page">
        <div className="auth-page-glow" />

        <Link to="/website2/api" className="auth-logo">
          <img src="/round-logo.png" alt="Spectre" className="auth-logo-img" />
          <span className="auth-logo-text">Spectre</span>
        </Link>

        <div className="auth-card auth-card--reveal">
          <h1 className="auth-title">{isReturning ? 'Your existing credentials' : 'Save your credentials'}</h1>
          <p className="auth-subtitle">
            {isReturning
              ? 'This account is already registered. Here are the credentials on file.'
              : 'Account created. Save these now - the secret will not be shown again.'}
          </p>

          <div className="auth-creds-block">
            <div className="auth-creds-field">
              <div className="auth-creds-label-row">
                <span className="auth-creds-label">API Key</span>
                <span className="auth-creds-hint">Sent on every request as X-API-Key</span>
              </div>
              <div className="auth-creds-value-row">
                <code className="auth-creds-value">{credentials.api_key}</code>
                <CopyButton text={credentials.api_key} label="Copy" />
              </div>
            </div>

            {credentials.api_secret && (
              <div className="auth-creds-field">
                <div className="auth-creds-label-row">
                  <span className="auth-creds-label">API Secret</span>
                  <span className="auth-creds-hint">For webhook signing &amp; privileged actions</span>
                </div>
                <div className="auth-creds-value-row">
                  <code className="auth-creds-value">{credentials.api_secret}</code>
                  <CopyButton text={credentials.api_secret} label="Copy" />
                </div>
              </div>
            )}

            <div className="auth-creds-meta">
              <span className="auth-creds-meta-item">
                Tier: <strong>{credentials.tier || 'explorer'}</strong>
              </span>
              <span className="auth-creds-meta-sep" />
              <span className="auth-creds-meta-item">
                Daily limit: <strong>{(credentials.daily_limit || 0).toLocaleString()}</strong> calls
              </span>
            </div>

            {credentials.message && !isReturning && (
              <p className="auth-creds-message">{credentials.message}</p>
            )}
          </div>

          <p className="auth-warning">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
            Save these values somewhere safe (password manager, vault). Spectre cannot recover a lost secret - you would need to re-register with the same email to retrieve them.
          </p>

          <label className="auth-ack">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>I have saved my API key and secret</span>
          </label>

          <button
            className="auth-submit"
            type="button"
            disabled={!acknowledged}
            onClick={handleConfirm}
          >
            Continue to dashboard
          </button>
        </div>
      </div>
    )
  }

  /* ─────────── Signup form ─────────── */
  return (
    <div className="auth-page">
      <div className="auth-page-glow" />

      <Link to="/website2/api" className="auth-logo">
        <img src="/round-logo.png" alt="Spectre" className="auth-logo-img" />
        <span className="auth-logo-text">Spectre</span>
      </Link>

      <form className="auth-card" onSubmit={handleSubmit}>
        <h1 className="auth-title">Create your API key</h1>
        <p className="auth-subtitle">Identify with an email, a wallet, or both - you will receive an API key on the next screen.</p>

        <div className="auth-field">
          <label className="auth-label" htmlFor="signup-email">Email <span className="auth-label-hint">(optional if wallet provided)</span></label>
          <input
            id="signup-email"
            className={`auth-input${error ? ' auth-input--error' : ''}`}
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError('') }}
            autoComplete="email"
          />
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="signup-wallet">Wallet address <span className="auth-label-hint">(optional if email provided)</span></label>
          <input
            id="signup-wallet"
            className={`auth-input${error ? ' auth-input--error' : ''}`}
            type="text"
            placeholder="0x... or Solana address"
            value={walletAddress}
            onChange={(e) => { setWalletAddress(e.target.value.trim()); setError('') }}
            autoComplete="off"
            spellCheck="false"
          />
        </div>

        {error && <p className="auth-error">{error}</p>}

        <button className="auth-submit" type="submit" disabled={loading}>
          {loading ? <span className="auth-spinner" /> : 'Generate API key'}
        </button>

        <p className="auth-terms">
          By signing up you agree to our <a href="https://spectreai.io/terms" target="_blank" rel="noreferrer">Terms of Service</a>
        </p>

        <div className="auth-divider" />

        <p className="auth-switch">
          Already have a key? <Link to="/website2/api/login">Log in</Link>
        </p>
      </form>
    </div>
  )
}
