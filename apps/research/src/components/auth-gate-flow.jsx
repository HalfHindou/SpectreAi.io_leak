/**
 * auth-gate-flow — the Privy-driven email/OTP + waitlist-verify UI for the beta
 * gate. Split out of auth-gate.jsx and React.lazy-loaded so the static
 * `@privy-io/react-auth` import (usePrivy + useLoginWithEmail) stays OFF the
 * entry path. Rendered only once the shell has decided login UI is needed AND
 * the lazy PrivyProvider is mounted, so these hooks are safe to call.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { usePrivy, useLoginWithEmail } from '@privy-io/react-auth'
import { logError } from '@/lib/logger'

// ─── Beta access FLOW (Privy-driven email/OTP + waitlist verify) ─────
// Rendered only when the shell has decided the login UI is needed AND the lazy
// PrivyProvider is mounted, so usePrivy()/useLoginWithEmail() are safe to call.
export default function BetaAccessFlow({ onAuthenticated, onBetaClosed, showTeamPwd, setShowTeamPwd, teamPwdForm }) {
  const { t } = useTranslation()
  const { ready: privyReady, authenticated, login, logout, getAccessToken } = usePrivy()
  // Headless email OTP flow: lets us send + verify the code inline in our
  // own gate UI instead of opening the Privy modal (which adds a redundant
  // "confirm your email" screen between the precheck and OTP entry).
  const { sendCode, loginWithCode } = useLoginWithEmail({
    onComplete: () => {
      // Privy authenticated. Reset stage to 'idle' so the verifyBetaAccess
      // effect can pass its guard (`if (stage !== 'idle') return`) and run.
      // Without this, the gate stays stuck on "Verifying..." after a valid
      // OTP because stage is still 'submitting_code' when authenticated
      // flips to true.
      setStage('idle')
    },
    onError: (err) => {
      // Most common cause: bad/expired code. Stay on the code-input screen
      // and surface a message; user can retry up to ~5 times per code.
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

  // Bounded auto-retry for the post-login waitlist verify. The user is already
  // Privy-authenticated by the time verifyBetaAccess runs, so a TRANSIENT failure
  // (cold serverless start, 503, 429, flaky mobile network, getAccessToken hang)
  // shouldn't dead-end a correct OTP at the service_error screen and force a full
  // re-login. We retry the verify ONCE, then give up — this stays inside the
  // anti-hammering-loop contract the verifyBetaAccess guard documents (the count
  // is the hard ceiling; definitive 401/403 answers never retry). Reset per fresh
  // sign-in attempt in handleEmailSubmit.
  const MAX_VERIFY_ATTEMPTS = 2 // initial + 1 auto-retry
  const verifyAttemptRef = useRef(0)
  const retryTimerRef = useRef(null)
  useEffect(() => () => { if (retryTimerRef.current) clearTimeout(retryTimerRef.current) }, [])

  // After Privy login completes, automatically verify against the waitlist.
  // Wrapped in a 15s timeout so a slow Privy or slow Vercel cold-start never
  // leaves the user stuck on "Verifying..." with no feedback.
  //
  // Guard MUST cover every terminal state, otherwise the effect below loops:
  // - stage flips to 'service_error' on failure
  // - useCallback's `stage` dep changes → new callback identity
  // - useEffect re-runs (verifyBetaAccess is in its deps)
  // - new callback runs, falls through guard, fires fetch again
  // We previously only excluded verifying/not_on_waitlist - a 429 or 503
  // would trigger a hammering loop that burned a ton of Vercel invocations.
  const verifyBetaAccess = useCallback(async () => {
    if (verified) return
    if (!privyReady || !authenticated) return
    if (stage !== 'idle') return // covers verifying, prechecking, not_on_waitlist, service_error
    setStage('verifying')
    verifyAttemptRef.current += 1

    // Transient failure: cold serverless / 503 / 429 / network blip / token hang.
    // The OTP was correct and the user is authenticated, so retry once before
    // surfacing the dead-end. Bounded by MAX_VERIFY_ATTEMPTS so it can never
    // hammer /api/beta-access. Dropping back to 'idle' re-fires the effect (the
    // `stage` dep changes verifyBetaAccess's identity) for the retry.
    const failTransient = () => {
      if (verifyAttemptRef.current < MAX_VERIFY_ATTEMPTS) {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
        retryTimerRef.current = setTimeout(() => setStage('idle'), 1200)
      } else {
        setStage('service_error')
      }
    }

    const ctrl = new AbortController()
    const timeoutId = setTimeout(() => ctrl.abort(), 15000)
    try {
      // Privy's getAccessToken() has been observed to hang after social-login
      // popups close before the SDK fully syncs. Race against an 8s timeout.
      const token = await Promise.race([
        getAccessToken(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('privy_token_timeout')), 8000)),
      ])
      if (!token) { failTransient(); return }
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
        try { sessionStorage.setItem('spectre-auth', 'true') } catch (_) { /* swallow */ }
        setVerified(true)
        onAuthenticated()
        setStage('idle')
      } else if (res.status === 403 && body.error === 'beta_closed') {
        onBetaClosed() // definitive — no retry
      } else if (res.status === 403) {
        setStageEmail(typeof body.email === 'string' ? body.email : '')
        setStage('not_on_waitlist') // definitive — no retry
      } else if (res.status === 401) {
        // Privy token rejected — definitive. Force re-login.
        setStage('idle')
        try { await logout() } catch (_) { /* swallow */ }
      } else {
        // 429 / 5xx / anything else = transient → bounded retry.
        failTransient()
      }
    } catch (err) {
      logError('authGate:betaAccess', err)
      failTransient()
    } finally {
      clearTimeout(timeoutId)
    }
  }, [authenticated, getAccessToken, logout, onAuthenticated, onBetaClosed, privyReady, stage, verified])

  useEffect(() => {
    if (!privyReady || !authenticated || verified) return
    verifyBetaAccess()
  }, [privyReady, authenticated, verified, verifyBetaAccess])

  // Precheck email against the waitlist BEFORE asking Privy to send a
  // magic link. Saves the user a confusing "enter code, get rejected"
  // round trip if their email isn't allowlisted, and saves us a Privy
  // magic-link send. On success, opens the Privy modal pre-filled with
  // the email so the user only enters the OTP code.
  const handleEmailSubmit = async (e) => {
    e.preventDefault()
    setEmailError('')
    const email = emailInput.trim().toLowerCase()
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setEmailError('Enter a valid email address')
      return
    }
    setStage('prechecking')
    verifyAttemptRef.current = 0 // fresh sign-in attempt → restore the retry budget
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
        // Email is on the waitlist - fire Privy OTP send and switch to the
        // inline code input. No Privy modal in between.
        setStageEmail(email)
        setStage('sending_code')
        try {
          await sendCode({ email })
          setStage('code_input')
          setCode('')
          setCodeError('')
        } catch (err) {
          logError('authGate:sendCode', err)
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
    } catch (err) {
      logError('authGate:precheck', err)
      setEmailError('Sign-in temporarily unavailable. Try again.')
      setStage('idle')
    }
  }

  // OTP submit. After loginWithCode resolves, Privy flips `authenticated` to
  // true, which triggers the verifyBetaAccess effect → mints the spectre-beta
  // cookie → unlocks the app. Errors are surfaced via the hook's onError above.
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
      // success path: verifyBetaAccess effect takes over from here
    } catch (err) {
      // onError handles UI - this catch is just to avoid an unhandled rejection
      logError('authGate:loginWithCode', err)
    }
  }

  // Resend OTP (same email)
  const handleResendCode = async () => {
    if (!stageEmail) return
    setCodeError('')
    setStage('sending_code')
    try {
      await sendCode({ email: stageEmail })
      setStage('code_input')
    } catch (err) {
      logError('authGate:resendCode', err)
      setCodeError('Could not resend. Try again.')
      setStage('code_input')
    }
  }

  // Back to email input
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
              onClick={async () => { try { await logout() } catch (_) { /* swallow */ } setStage('idle'); setStageEmail(''); setEmailInput('') }}
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

  // ── Default / unauthenticated screen ─────────────────────────────
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
                  onClick={async () => { try { await logout() } catch (_) { /* swallow */ } setStage('idle') }}
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
