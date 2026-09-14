import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { setApiKey, isAuthenticated, API_BASE } from './utils/auth'
import './login.css'

export default function ApiLoginPage() {
  const navigate = useNavigate()
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [apiSecretInput, setApiSecretInput] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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

    const trimmedKey = apiKeyInput.trim()
    if (!trimmedKey) {
      setError('Paste your API key')
      return
    }

    setLoading(true)
    try {
      // Server-side validation - hit /v1/auth/usage with the key.
      // 200 = valid, 401 = invalid/revoked.
      const res = await fetch(`${API_BASE}/v1/auth/usage`, {
        headers: { 'X-API-Key': trimmedKey },
      })
      if (res.status === 401) {
        setError('Invalid API key')
        return
      }
      if (!res.ok) {
        setError('Could not validate key - try again')
        return
      }
      // Valid - store and redirect.
      setApiKey(trimmedKey, apiSecretInput.trim() || undefined)
      navigate('/website2/api/dashboard')
    } catch {
      setError('Network error - please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-page-glow" />

      <Link to="/website2/api" className="auth-logo">
        <img src="/round-logo.png" alt="Spectre" className="auth-logo-img" />
        <span className="auth-logo-text">Spectre</span>
      </Link>

      <form className="auth-card" onSubmit={handleSubmit}>
        <h1 className="auth-title">Log in with your API key</h1>
        <p className="auth-subtitle">Paste the key Spectre issued when you registered.</p>

        <div className="auth-field">
          <label className="auth-label" htmlFor="login-apikey">API Key</label>
          <input
            id="login-apikey"
            className={`auth-input${error ? ' auth-input--error' : ''}`}
            type="text"
            placeholder="spect_..."
            value={apiKeyInput}
            onChange={(e) => { setApiKeyInput(e.target.value); setError('') }}
            required
            autoComplete="off"
            spellCheck="false"
            autoFocus
          />
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="login-secret">API Secret <span className="auth-label-hint">(optional)</span></label>
          <div className="auth-input-wrap">
            <input
              id="login-secret"
              className={`auth-input auth-input--pw${error ? ' auth-input--error' : ''}`}
              type={showSecret ? 'text' : 'password'}
              placeholder="Only needed for webhook signing"
              value={apiSecretInput}
              onChange={(e) => { setApiSecretInput(e.target.value); setError('') }}
              autoComplete="off"
              spellCheck="false"
            />
            <button type="button" className="auth-pw-toggle" onClick={() => setShowSecret(!showSecret)} tabIndex={-1}>
              {showSecret ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
              )}
            </button>
          </div>
        </div>

        {error && <p className="auth-error">{error}</p>}

        <button className="auth-submit" type="submit" disabled={loading}>
          {loading ? <span className="auth-spinner" /> : 'Log in'}
        </button>

        <div className="auth-divider" />

        <p className="auth-switch">
          Don't have a key? <Link to="/website2/api/signup">Sign up</Link>
        </p>
        <p className="auth-switch auth-switch--secondary">
          Lost your key? Sign up with the same email or wallet to retrieve it.
        </p>
      </form>
    </div>
  )
}
