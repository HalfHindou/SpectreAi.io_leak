/**
 * AuthGate Component (trading app)
 *
 * Two-path gate (2026-05-28 beta launch):
 *   1. Beta users sign in via Privy. After login the client posts the
 *      access token to /api/beta-access; on a Firestore waitlist match,
 *      the server mints a spectre-beta cookie and the app unlocks.
 *   2. Team members click the discrete "Team access" link to reveal the
 *      existing TEAM_GATE_PASSWORD prompt - unchanged from the old gate.
 *
 * Either cookie (spectre-gate from team password, spectre-beta from
 * Privy+waitlist) satisfies /api/auth-gate?action=check.
 *
 * DEFERRED-PRIVY ARCHITECTURE: the Privy SDK is lazy-mounted to keep the wallet
 * stack off the boot path, and the REAL PrivyProvider mounts in a SIBLING branch
 * (NOT around the app — see lib/privy-boundary.jsx) so it never remounts the app
 * subtree. AuthGate drives the REAL email-OTP flow (useLoginWithEmail) which can't
 * be stubbed and DOES need the real provider as an ancestor, so it splits in two:
 *   - BetaAccessShell : no Privy hooks. Does the cookie check, dev-bypass /
 *                       beta-closed handling, and the team password fallback. An
 *                       already-authenticated user never triggers the Privy mount.
 *                       When the login UI is needed, it renders an empty SLOT div
 *                       and registers it (with the flow's props) via registerGateSlot.
 *   - BetaAccessFlow  : the Privy-driven email/OTP + waitlist verify UI (in
 *                       components/auth-gate-flow.jsx). Lives INSIDE the sibling
 *                       provider branch and is portaled into the shell's slot
 *                       (lib/privy-provider-lazy.jsx GateFlowPortal), so
 *                       usePrivy()/useLoginWithEmail() are safe there.
 * The shell calls requestPrivyMount() the moment it needs the login UI, so the
 * provider is ready before the user can interact.
 */
import React, { useState, useEffect, useRef } from 'react'
import { requestPrivyMount, usePrivyMounted, usePrivyGateSlotRegister } from '../lib/use-privy-safe'
import { track, Events } from '../services/analytics'
import { isDev } from '../utils/env'
import './AuthGate.css'

// "Trading Lite" embeds this terminal inside the (already gated) research app
// via iframe. Bypass the team-password gate ONLY when we're framed by a trusted
// research origin — verified via ancestorOrigins (Chrome/Safari) with a
// document.referrer fallback (Firefox). This is NOT a bare ?embedded=true switch:
// a direct (non-iframed) load fails window.self !== window.top, and an embed from
// any untrusted parent fails the origin allowlist. Fail-closed on any error.
const RESEARCH_EMBED_ORIGINS = [
  'https://spectre-app-research.vercel.app',
  'https://app.spectreai.io',
]
function isEmbeddedByResearch() {
  if (typeof window === 'undefined') return false
  try {
    if (window.self === window.top) return false
    const ao = window.location.ancestorOrigins
    if (ao && ao.length) return Array.from(ao).every((o) => RESEARCH_EMBED_ORIGINS.includes(o))
    if (document.referrer) return RESEARCH_EMBED_ORIGINS.includes(new URL(document.referrer).origin)
  } catch { /* cross-origin access threw -> treat as untrusted */ }
  return false
}

const _devBypassEligible = typeof window !== 'undefined' &&
  (import.meta.env?.DEV === true ||
   isDev ||
   window.location.hostname === '0.0.0.0' ||
   window.location.hostname === '' ||
   (typeof window.location.hostname === 'string' && window.location.hostname.includes('localhost')) ||
   /^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[01])\./.test(window.location.hostname || '') ||
   isEmbeddedByResearch())

// `?gate=force` URL param forces the gate to render even when we'd normally
// bypass it (localhost / private networks / research embed). Used to test
// gate UI changes locally before deploying. No effect in production.
const _forceGate = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('gate') === 'force'

const isDevBypass = _devBypassEligible && !_forceGate

const PRIVY_AVAILABLE = !!import.meta.env?.VITE_PRIVY_APP_ID

// Last-known-good auth hint. sessionStorage 'spectre-auth' is written after a
// successful server check / login. The server cookie stays the source of truth
// (every data API requires it), but seeding from this hint avoids a flash of the
// gate on reload, and on a TRANSIENT check failure keeps a previously-authed user
// in instead of a false logout.
function readAuthHint() {
  try { return sessionStorage.getItem('spectre-auth') === 'true' } catch { return false }
}

// ─── Beta access SHELL (no Privy hooks) ──────────────────────────────
// Owns the cookie check + dev-bypass + beta-closed + team-password fallback. An
// authenticated user returns children WITHOUT mounting Privy. Only when the login
// UI is actually needed do we requestPrivyMount() and hand off to the portaled
// BetaAccessFlow (which safely calls the real Privy hooks).
const BetaAccessShell = ({ children }) => {
  const privyMounted = usePrivyMounted()
  const registerGateSlot = usePrivyGateSlotRegister()
  // DOM node the (portaled) BetaAccessFlow renders into. Set via a callback ref so
  // registration fires exactly when the slot div mounts/unmounts.
  const gateSlotRef = useRef(null)

  // Optimistic render for returning users: the sessionStorage hint seeds the
  // initial auth state so chrome + token page render INSTANTLY instead of blocking
  // on the /api/auth-gate round-trip. The server cookie stays the source of truth;
  // a definitive server "no" still drops the user to the gate.
  const _authHint = readAuthHint()
  const [isAuthenticated, setIsAuthenticated] = useState(() => isDevBypass || _authHint)
  const [isLoading, setIsLoading] = useState(() => !isDevBypass && !_authHint)
  const [betaClosed, setBetaClosed] = useState(false)
  const [showTeamPwd, setShowTeamPwd] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Initial cookie check on mount - accepts both spectre-gate and spectre-beta.
  useEffect(() => {
    if (isDevBypass) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/auth-gate?action=check', { credentials: 'include' })
        if (cancelled) return
        if (res.ok) {
          setIsAuthenticated(true)
          try { sessionStorage.setItem('spectre-auth', 'true') } catch { /* swallow */ }
        } else {
          setIsAuthenticated(false)
          try { sessionStorage.removeItem('spectre-auth') } catch { /* swallow */ }
          // Server hint: BETA_OPEN=false and no team cookie. Jump straight to the
          // "Beta launches soon" screen instead of showing the email form that
          // would just bounce to the same screen after the user submits.
          try {
            const data = await res.json().catch(() => ({}))
            if (data?.betaClosed) setBetaClosed(true)
          } catch { /* swallow */ }
        }
      } catch {
        // Check THREW (network blip / cold serverless) - not a server "no".
        // Keep a hinted returning user in instead of false-logging them out;
        // the cookie still gates every data API, so this is UX-only.
        if (!_authHint) setIsAuthenticated(false)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // The moment we know the user needs the Privy login UI, pull the provider in so
  // it's hydrated before they can submit an email.
  const needsLoginUi = !isLoading && !isAuthenticated && !betaClosed
  useEffect(() => {
    if (needsLoginUi) requestPrivyMount('gate')
  }, [needsLoginUi])

  const handleTeamSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setPasswordError('')
    try {
      const res = await fetch('/api/auth-gate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        sessionStorage.setItem('spectre-auth', 'true')
        setIsAuthenticated(true)
        track(Events.SIGN_IN, { success: true, login_method: 'password' })
      } else {
        const msg = res.status === 429 ? 'Too many attempts. Try again later.' : 'Invalid password'
        setPasswordError(msg)
        setPassword('')
        track(Events.SIGN_IN, { success: false, login_method: 'password' })
      }
    } catch {
      setPasswordError('Invalid password')
      setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  // Single team-password form, shared by the shell's beta_closed screen and the
  // portaled BetaAccessFlow (not_on_waitlist + default screens) so there's one
  // source of truth for the fallback.
  const teamPwdForm = (
    showTeamPwd && (
      <form onSubmit={handleTeamSubmit} className="auth-form" style={{ marginTop: 16 }}>
        <div className="input-group">
          <input
            type="password" autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter team password"
            className={passwordError ? 'error' : ''}
            autoFocus
          />
          {passwordError && <span className="error-message">{passwordError}</span>}
        </div>
        <button type="submit" className="auth-btn" disabled={submitting || !password}>
          <span>Unlock</span>
        </button>
      </form>
    )
  )

  if (isLoading) {
    return (
      <div className="auth-gate">
        <div className="auth-loading">
          <div className="spinner"></div>
        </div>
      </div>
    )
  }

  if (isAuthenticated) return children

  // ── "Beta launches soon" screen (BETA_OPEN=false on the server) ──
  if (betaClosed) {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <div className="auth-logo">
            <img src="/round-logo.png" alt="Spectre AI" />
            <div className="logo-glow"></div>
          </div>
          <h1 className="auth-title">Beta launches soon</h1>
          <p className="auth-subtitle">
            The Spectre AI Beta is not yet open.
          </p>
          <p className="auth-subtitle" style={{ marginTop: 8 }}>
            We'll announce the launch on our X and Telegram. Keep an eye out.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 32 }}>
            <a
              href="https://x.com/Spectre__AI"
              target="_blank"
              rel="noopener noreferrer"
              className="auth-btn"
              style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <span>Follow on X</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </a>
            <a
              href="https://telegram.me/AI_SPECTRE"
              target="_blank"
              rel="noopener noreferrer"
              className="auth-secondary-link"
              style={{ textAlign: 'center' }}
            >
              Join the Telegram
            </a>
          </div>
          <p className="auth-footer" style={{ marginTop: 24 }}>
            <button type="button" className="auth-secondary-link" onClick={() => setShowTeamPwd(true)}>Team access</button>
          </p>
          {teamPwdForm}
        </div>
      </div>
    )
  }

  // Login UI needed: the Privy-driven flow renders INSIDE the sibling provider
  // branch (so its useLoginWithEmail is safe) and is portaled here into
  // gateSlotRef. We render an empty slot div + register it (with the flow's props)
  // for the portal. Until the provider mounts (brief — the chunk is already
  // downloading from requestPrivyMount above) we show the loading spinner.
  return (
    <BetaAccessFlowSlot
      registerGateSlot={registerGateSlot}
      gateSlotRef={gateSlotRef}
      ready={privyMounted}
      loading={
        <div className="auth-gate">
          <div className="auth-loading">
            <div className="spinner"></div>
          </div>
        </div>
      }
      flowProps={{
        onAuthenticated: () => setIsAuthenticated(true),
        onBetaClosed: () => setBetaClosed(true),
        showTeamPwd,
        setShowTeamPwd,
        teamPwdForm,
      }}
    />
  )
}

/**
 * Renders the empty portal slot for the login flow and registers it (with the
 * flow's props) so the sibling-mounted BetaAccessFlow can portal in. Shows the
 * loading spinner over the slot until the provider has mounted + filled it.
 */
function BetaAccessFlowSlot({ registerGateSlot, gateSlotRef, ready, loading, flowProps }) {
  const { onAuthenticated, onBetaClosed, showTeamPwd, setShowTeamPwd, teamPwdForm } = flowProps
  useEffect(() => {
    const node = gateSlotRef.current
    if (node) registerGateSlot(node, flowProps)
    return () => registerGateSlot(null)
    // flowProps is rebuilt each render; depend on its members so we re-register
    // when the team-password form/toggle changes (so the portaled flow sees fresh
    // props) without thrashing on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerGateSlot, onAuthenticated, onBetaClosed, showTeamPwd, setShowTeamPwd, teamPwdForm])

  return (
    <div ref={gateSlotRef} className="auth-gate-flow-slot">
      {!ready && loading}
    </div>
  )
}

// ─── Legacy team-password-only gate (no Privy configured) ───────────
const TeamPasswordOnlyGate = ({ children }) => {
  // Same optimistic-render seed as BetaAccessShell: a hinted returning user
  // paints chrome instantly; the server check below still runs and a definitive
  // "no" drops them to the gate.
  const _authHint = readAuthHint()
  const [isAuthenticated, setIsAuthenticated] = useState(() => isDevBypass || _authHint)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(() => !isDevBypass && !_authHint)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (isDevBypass) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/auth-gate?action=check', { credentials: 'include' })
        if (cancelled) return
        if (res.ok) {
          setIsAuthenticated(true)
          try { sessionStorage.setItem('spectre-auth', 'true') } catch { /* swallow */ }
        } else {
          setIsAuthenticated(false)
          try { sessionStorage.removeItem('spectre-auth') } catch { /* swallow */ }
        }
      } catch {
        // Thrown check (network blip / cold serverless) - keep a hinted returning
        // user in; the cookie still gates every data API.
        if (!_authHint) setIsAuthenticated(false)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/auth-gate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        sessionStorage.setItem('spectre-auth', 'true')
        setIsAuthenticated(true)
        track(Events.SIGN_IN, { success: true, login_method: 'password' })
      } else {
        const msg = res.status === 429 ? 'Too many attempts. Try again later.' : 'Invalid password'
        setError(msg)
        setPassword('')
        track(Events.SIGN_IN, { success: false, login_method: 'password' })
      }
    } catch {
      setError('Invalid password')
      setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="auth-gate">
        <div className="auth-loading">
          <div className="spinner"></div>
        </div>
      </div>
    )
  }

  if (isAuthenticated) return children

  return (
    <div className="auth-gate">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/round-logo.png" alt="Spectre AI" />
          <div className="logo-glow"></div>
        </div>
        <h1 className="auth-title">Spectre AI</h1>
        <p className="auth-subtitle">Team Access Only</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="input-group">
            <input
              type="password" autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter team password"
              className={error ? 'error' : ''}
              autoFocus
            />
            {error && <span className="error-message">{error}</span>}
          </div>
          <button type="submit" className="auth-btn" disabled={submitting || !password}>
            <span>Access Platform</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </form>

        <p className="auth-footer">
          Contact your team lead for access credentials
        </p>
      </div>
    </div>
  )
}

const AuthGate = ({ children }) => {
  if (PRIVY_AVAILABLE) return <BetaAccessShell>{children}</BetaAccessShell>
  return <TeamPasswordOnlyGate>{children}</TeamPasswordOnlyGate>
}

export default AuthGate
