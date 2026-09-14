/**
 * auth-gate-flow — the Privy-driven email/OTP + waitlist-verify UI for the trading
 * beta gate. Split out of AuthGate.jsx and React.lazy-loaded (inside
 * lib/privy-provider-lazy.jsx) so the static `@privy-io/react-auth` import
 * (usePrivy + useLoginWithEmail) stays OFF the entry path. Rendered only once the
 * shell has decided login UI is needed AND the lazy PrivyProvider is mounted, so
 * these hooks are safe to call — it lives INSIDE the real provider and is portaled
 * into the shell's gate slot. Trading port of apps/research/src/components/auth-gate-flow.jsx.
 */
import React, { useState, useEffect, useCallback } from 'react'
import { usePrivy, useLoginWithEmail } from '@privy-io/react-auth'
import { track, Events } from '../services/analytics'

// ─── Beta access FLOW (Privy-driven email/OTP + waitlist verify) ─────
// beta_closed is handled by the SHELL (onBetaClosed); this component renders the
// not_on_waitlist + default (email/OTP) screens. teamPwdForm + showTeamPwd come
// from the shell so the team-password fallback stays a single source of truth.
export default function BetaAccessFlow({ onAuthenticated, onBetaClosed, showTeamPwd, setShowTeamPwd, teamPwdForm }) {
  const { ready: privyReady, authenticated, login, logout, getAccessToken } = usePrivy()
  // Headless email OTP flow - skips the redundant Privy "confirm email" modal
  // between our precheck and the OTP entry.
  const { sendCode, loginWithCode } = useLoginWithEmail({
    onComplete: () => {
      // Privy authenticated. Reset stage to 'idle' so the verifyBetaAccess effect
      // can pass its guard and run. Without this, gate stays on "Verifying..."
      // because stage is still 'submitting_code'.
      setStage('idle')
    },
    onError: (err) => {
      setCodeError(typeof err?.message === 'string' ? err.message : 'Verification failed. Try again.')
      setStage((prev) => (prev === 'submitting_code' ? 'code_input' : prev))
    },
  })

  const [verified, setVerified] = useState(false)
  const [stage, setStage] = useState('idle') // idle | prechecking | sending_code | code_input | submitting_code | verifying | not_on_waitlist | service_error
  const [stageEmail, setStageEmail] = useState('')
  const [emailInput, setEmailInput] = useState('')
  const [emailError, setEmailError] = useState('')
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')

  // After Privy login, verify against the waitlist exactly once per session. 15s
  // timeout so a slow Privy or cold-start lambda never leaves the user stuck on
  // "Verifying..." forever.
  //
  // Guard MUST cover every non-idle stage. `stage` is a useCallback dep, so every
  // state transition creates a new callback, which retriggers the useEffect below.
  // If the guard misses (e.g. service_error not excluded), we hammer
  // /api/beta-access in a tight loop. `stage !== 'idle'` covers all
  // terminal/intermediate states.
  const verifyBetaAccess = useCallback(async () => {
    if (verified) return
    if (!privyReady || !authenticated) return
    if (stage !== 'idle') return
    setStage('verifying')
    const ctrl = new AbortController()
    const timeoutId = setTimeout(() => ctrl.abort(), 15000)
    try {
      // Privy's getAccessToken() has been observed to hang after social-login
      // popups close before the SDK fully syncs. Race against an 8s timeout.
      const token = await Promise.race([
        getAccessToken(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('privy_token_timeout')), 8000)),
      ])
      if (!token) { setStage('service_error'); return }
      const res = await fetch('/api/beta-access', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      })
      const body = await res.json().catch(() => ({}))
      // eslint-disable-next-line no-console
      console.log('[beta-gate] /api/beta-access ->', res.status, body)
      if (res.ok) {
        try { sessionStorage.setItem('spectre-auth', 'true') } catch { /* swallow */ }
        setVerified(true)
        onAuthenticated()
        setStage('idle')
        try { track(Events.SIGN_IN, { success: true, login_method: 'privy_beta' }) } catch { /* swallow */ }
      } else if (res.status === 403 && body.error === 'beta_closed') {
        onBetaClosed()
      } else if (res.status === 403) {
        setStageEmail(typeof body.email === 'string' ? body.email : '')
        setStage('not_on_waitlist')
        try { track(Events.SIGN_IN, { success: false, login_method: 'privy_beta', reason: 'not_on_waitlist' }) } catch { /* swallow */ }
      } else if (res.status === 401) {
        setStage('idle')
        try { await logout() } catch { /* swallow */ }
      } else {
        setStage('service_error')
      }
    } catch {
      setStage('service_error')
    } finally {
      clearTimeout(timeoutId)
    }
  }, [authenticated, getAccessToken, logout, onAuthenticated, onBetaClosed, privyReady, stage, verified])

  useEffect(() => {
    if (!privyReady || !authenticated || verified) return
    verifyBetaAccess()
  }, [privyReady, authenticated, verified, verifyBetaAccess])

  // Precheck email BEFORE opening the Privy modal so non-waitlist users see "not
  // on the list" without burning a Privy magic-link.
  const handleEmailSubmit = async (e) => {
    e.preventDefault()
    setEmailError('')
    const email = emailInput.trim().toLowerCase()
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setEmailError('Enter a valid email address')
      return
    }
    setStage('prechecking')
    try {
      const ctrl = new AbortController()
      const timeoutId = setTimeout(() => ctrl.abort(), 10000)
      const res = await fetch('/api/beta-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
        signal: ctrl.signal,
      })
      clearTimeout(timeoutId)
      const body = await res.json().catch(() => ({}))
      // eslint-disable-next-line no-console
      console.log('[beta-gate] precheck ->', res.status, body)
      if (res.ok && body.eligible) {
        // Email is on the waitlist - fire Privy OTP send and switch to the inline
        // code input. No Privy modal in between.
        setStageEmail(email)
        setStage('sending_code')
        try {
          await sendCode({ email })
          setStage('code_input')
          setCode('')
          setCodeError('')
        } catch {
          setEmailError('Could not send code. Try again.')
          setStage('idle')
        }
        return
      }
      if (res.status === 403 && body.error === 'beta_closed') {
        onBetaClosed()
        return
      }
      if (res.status === 403) {
        setStageEmail(typeof body.email === 'string' ? body.email : email)
        setStage('not_on_waitlist')
        return
      }
      if (res.status === 429) {
        setEmailError('Too many attempts. Try again in a minute.')
        setStage('idle')
        return
      }
      setEmailError('Sign-in temporarily unavailable. Try again.')
      setStage('idle')
    } catch {
      setEmailError('Sign-in temporarily unavailable. Try again.')
      setStage('idle')
    }
  }

  // OTP submit. After loginWithCode resolves, Privy flips `authenticated` to true,
  // which triggers the verifyBetaAccess effect → mints the spectre-beta cookie →
  // unlocks the app.
  const handleCodeSubmit = async (e) => {
    e.preventDefault()
    const trimmed = code.trim()
    if (trimmed.length < 4) {
      setCodeError('Enter the code from your email')
      return
    }
    setCodeError('')
    setStage('submitting_code')
    try {
      await loginWithCode({ code: trimmed })
    } catch { /* onError handles UI */ }
  }

  const handleResendCode = async () => {
    if (!stageEmail) return
    setCodeError('')
    setStage('sending_code')
    try {
      await sendCode({ email: stageEmail })
      setStage('code_input')
    } catch {
      setCodeError('Could not resend. Try again.')
      setStage('code_input')
    }
  }

  const handleChangeEmail = () => {
    setCode('')
    setCodeError('')
    setStage('idle')
  }

  // ── "You're on the waitlist" screen ──────────────────────────────
  if (stage === 'not_on_waitlist') {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <div className="auth-logo">
            <img src="/round-logo.png" alt="Spectre AI" />
            <div className="logo-glow"></div>
          </div>
          <h1 className="auth-title">Not on the beta list</h1>
          <p className="auth-subtitle">
            {stageEmail ? <><span style={{ color: 'var(--text-primary)' }}>{stageEmail}</span> isn't part of the current beta cohort.</> : 'This account isn\'t part of the current beta cohort.'}
          </p>
          <p className="auth-subtitle" style={{ marginTop: 8 }}>
            If there are new beta spots available, we'll announce on our X and Telegram.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 32 }}>
            <button
              type="button"
              className="auth-btn"
              onClick={async () => { try { await logout() } catch { /* swallow */ } setStage('idle'); setStageEmail(''); setEmailInput('') }}
            >
              <span>Try a different email</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
            <a
              href="https://telegram.me/AI_SPECTRE"
              target="_blank"
              rel="noopener noreferrer"
              className="auth-secondary-link"
              style={{ textAlign: 'center' }}
            >
              Reach us on Telegram
            </a>
          </div>
          <p className="auth-footer auth-yc-row" style={{ marginTop: 24 }}>
            <svg className="auth-yc-logo" viewBox="0 0 100 100" aria-hidden focusable="false">
              <rect width="100" height="100" rx="14" fill="#F26625" />
              <text x="50" y="70" textAnchor="middle" fontFamily="system-ui, -apple-system, Segoe UI, sans-serif" fontSize="62" fontWeight="700" fill="#FFFFFF">Y</text>
            </svg>
            Y Combinator? <button type="button" className="auth-secondary-link" onClick={() => setShowTeamPwd(true)}>Get access</button>
          </p>
          {teamPwdForm}
        </div>
      </div>
    )
  }

  // ── Default unauthenticated screen ───────────────────────────────
  return (
    <div className="auth-gate">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/round-logo.png" alt="Spectre AI" />
          <div className="logo-glow"></div>
        </div>
        <h1 className="auth-title">Spectre AI Beta Test</h1>
        <p className="auth-subtitle">
          {stage === 'code_input' || stage === 'sending_code' || stage === 'submitting_code'
            ? <>We sent a code to <span style={{ color: 'var(--text-primary)' }}>{stageEmail}</span></>
            : 'Sign in with the email you registered with'}
        </p>

        {stage === 'code_input' || stage === 'sending_code' || stage === 'submitting_code' ? (
          <form onSubmit={handleCodeSubmit} className="auth-form" style={{ marginTop: 32 }}>
            <div className="input-group">
              <input
                type="text"
                autoComplete="one-time-code"
                inputMode="numeric"
                value={code}
                onChange={(e) => { setCode(e.target.value.replace(/\s+/g, '')); if (codeError) setCodeError('') }}
                placeholder="Enter 6-digit code"
                className={codeError ? 'error' : ''}
                maxLength={10}
                disabled={stage === 'submitting_code' || stage === 'sending_code'}
                autoFocus
              />
              {codeError && <span className="error-message">{codeError}</span>}
            </div>
            <button
              type="submit"
              className="auth-btn"
              disabled={!code || stage === 'submitting_code' || stage === 'sending_code'}
            >
              <span>
                {stage === 'sending_code' ? 'Sending...' : stage === 'submitting_code' ? 'Verifying...' : 'Continue'}
              </span>
              {stage !== 'sending_code' && stage !== 'submitting_code' && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              )}
            </button>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: '0.8125rem' }}>
              <button
                type="button"
                className="auth-secondary-link"
                onClick={handleChangeEmail}
                disabled={stage === 'submitting_code' || stage === 'sending_code'}
              >
                Use a different email
              </button>
              <button
                type="button"
                className="auth-secondary-link"
                onClick={handleResendCode}
                disabled={stage === 'submitting_code' || stage === 'sending_code'}
              >
                Resend code
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleEmailSubmit} className="auth-form" style={{ marginTop: 32 }}>
            <div className="input-group">
              <input
                type="email"
                autoComplete="email"
                inputMode="email"
                value={emailInput}
                onChange={(e) => { setEmailInput(e.target.value); if (emailError) setEmailError('') }}
                placeholder="Enter email"
                className={emailError ? 'error' : ''}
                disabled={stage === 'prechecking' || stage === 'verifying'}
                autoFocus
              />
              {emailError && <span className="error-message">{emailError}</span>}
            </div>
            <button
              type="submit"
              className="auth-btn"
              disabled={!privyReady || !emailInput || stage === 'prechecking' || stage === 'verifying'}
            >
              <span>
                {stage === 'prechecking' ? 'Checking...' : stage === 'verifying' ? 'Verifying...' : 'Continue'}
              </span>
              {stage !== 'prechecking' && stage !== 'verifying' && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              )}
            </button>
            {stage === 'service_error' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                <p className="error-message" style={{ textAlign: 'center' }}>
                  Sign-in didn't go through. Try again, or use Team access.
                </p>
                <button
                  type="button"
                  className="auth-secondary-link"
                  onClick={async () => { try { await logout() } catch { /* swallow */ } setStage('idle') }}
                >
                  Reset and try again
                </button>
              </div>
            )}
          </form>
        )}

        <p className="auth-footer auth-yc-row" style={{ marginTop: 32 }}>
          <svg className="auth-yc-logo" viewBox="0 0 100 100" aria-hidden focusable="false">
            <rect width="100" height="100" rx="14" fill="#F26625" />
            <text x="50" y="70" textAnchor="middle" fontFamily="system-ui, -apple-system, Segoe UI, sans-serif" fontSize="62" fontWeight="700" fill="#FFFFFF">Y</text>
          </svg>
          Y Combinator? <button type="button" className="auth-secondary-link" onClick={() => setShowTeamPwd(v => !v)}>Get access</button>
        </p>

        {teamPwdForm}
      </div>
    </div>
  )
}
