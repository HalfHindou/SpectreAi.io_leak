/**
 * AuthGate Component
 *
 * Two-path gate (2026-05-28 beta launch):
 *   1. Beta users sign in via Privy. After login the client posts the
 *      access token to /api/beta-access; if the user's email is in the
 *      new-era-beta-waitlist Firestore collection, the server mints a
 *      spectre-beta cookie and the app unlocks.
 *   2. Team members click the discrete "Team access" link to reveal the
 *      existing TEAM_GATE_PASSWORD prompt - unchanged from the old gate.
 *
 * Either cookie (spectre-gate from team password, spectre-beta from
 * Privy+waitlist) satisfies /api/auth-gate?action=check, so downstream
 * code does not need to know which path the visitor took.
 *
 * When VITE_PRIVY_APP_ID is not set (rare - mostly local dev without
 * Privy configured) we fall back to the password-only UI so the gate
 * still works.
 *
 * DEFERRED-PRIVY ARCHITECTURE (2026-06-11): the Privy SDK is lazy-mounted to
 * keep the wallet stack off the boot path, and the REAL PrivyProvider mounts in
 * a SIBLING branch (NOT around the app — see lib/privy-boundary.jsx) so it never
 * remounts the app subtree. AuthGate drives the REAL email-OTP flow
 * (useLoginWithEmail) which can't be stubbed and DOES need the real provider as
 * an ancestor, so it splits in two:
 *   - BetaAccessShell  : no Privy hooks. Does the cookie check, public-route /
 *                        demo / dev-bypass / beta-closed handling, and the team
 *                        password fallback. An already-authenticated user never
 *                        triggers the Privy mount. When the login UI is needed,
 *                        it renders an empty SLOT div and registers it (with the
 *                        flow's props) via registerGateSlot.
 *   - BetaAccessFlow   : the Privy-driven email/OTP + waitlist verify UI. Lives
 *                        INSIDE the sibling provider branch and is portaled into
 *                        the shell's slot (lib/privy-provider-lazy.jsx
 *                        GateFlowPortal), so usePrivy()/useLoginWithEmail() are
 *                        safe because the provider is its ancestor.
 * The shell calls requestPrivyMount() the moment it needs the login UI, so the
 * provider is ready before the user can interact.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { requestPrivyMount, usePrivyMounted, usePrivyGateSlotRegister } from '@/lib/use-privy-safe'
import { isDev } from '@/utils/env'
import { logError } from '@/lib/logger'
import { dismissBootSkeleton } from '@/lib/lazy-with-retry'
import { consumeEarlyFetch } from '@/lib/early-fetch'
import './auth-gate.css'

// Public routes that bypass password protection (marketing pages, newsroom, etc.)
const PUBLIC_ROUTES = ['/website', '/website2', '/newsroom', '/embed']

// Bypass auth in dev so the app is visible immediately (no blank loading screen).
// Only bypass for local/dev environments and Electron desktop - production web requires team password.
const _devBypassEligible = typeof window !== 'undefined' &&
  (import.meta.env?.DEV === true ||
   window.spectre?.isDesktop === true ||
   isDev ||
   window.location.hostname === '0.0.0.0' ||
   window.location.hostname === '' ||
   (typeof window.location.hostname === 'string' && window.location.hostname.includes('localhost')) ||
   (typeof window.location.origin === 'string' && (window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1'))) ||
   /^192\.168\.|^10\.|^172\.(1[6-9]|2[0-9]|3[01])\./.test(window.location.hostname || ''))

// `?gate=force` URL param forces the gate to render even when we'd normally
// bypass it (localhost / Electron / private networks). Used to test gate UI
// changes locally before deploying. Has no effect in production - there
// isDevBypass is already false so the override is a no-op.
const _forceGate = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('gate') === 'force'

const isDevBypass = _devBypassEligible && !_forceGate

const PRIVY_AVAILABLE = !!import.meta.env?.VITE_PRIVY_APP_ID

// Demo mode — iframe from website2 bypasses auth. Restricted to:
//   1. the demo iframe origin (referrer = website2 origin), OR
//   2. dev/localhost.
// Production app.spectreai.io previously honored any ?demo=true query
// regardless of referrer — that was a public bypass anyone could append
// to the URL. Now we require the referrer to actually be the website2
// origin (which embeds us in an iframe).
//
// 2026-05-12 hardening: parse the referrer as a URL and compare ORIGIN
// exactly. The previous `startsWith(o)` check let an attacker register
// `https://spectreai.io.attacker.com` (a subdomain of attacker.com) and
// use it as a referrer to bypass — `'https://spectreai.io.attacker.com'
// .startsWith('https://spectreai.io')` is TRUE. URL.origin comparison
// closes that boundary.
const DEMO_REFERRER_ORIGINS = new Set([
  'https://spectreai.io',
  'https://www.spectreai.io',
])
function isAllowedDemoReferrer() {
  if (typeof document === 'undefined' || !document.referrer) return false
  try {
    const refOrigin = new URL(document.referrer).origin
    return DEMO_REFERRER_ORIGINS.has(refOrigin)
  } catch {
    return false
  }
}
const isDemoMode = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('demo') === 'true' && (
    isDevBypass || isAllowedDemoReferrer()
  )

// Last-known-good auth hint. sessionStorage 'spectre-auth' is written after a
// successful server check / login. The server cookie is still the source of
// truth (every data API requires it), but on a TRANSIENT check failure (offline,
// 8s timeout, cold serverless, PWA relaunch on a flaky network) we trust this
// hint instead of dumping a previously-authed user to the login screen. This is
// the "logs out + I see an error" symptom on iOS homescreen.
function readAuthHint() {
  try { return sessionStorage.getItem('spectre-auth') === 'true' } catch (_) { return false }
}

// Optimistic boot seed: sessionStorage hint (this session) OR the presence of
// a localStorage resume token (this device authed before - survives the iOS
// PWA force-quit that wipes sessionStorage). Either one means "almost
// certainly still authed", so the shells render the APP immediately and let
// the server check run in the background - it still corrects to the gate if
// the server says no. Before this, `if (isLoading)` rendered a loading screen
// ahead of the `isAuthenticated` branch, so EVERY open - even fully authed -
// blocked on the /api/auth-gate round-trip (cold serverless + phone radio =
// the reported 3s PWA open delay). A never-authed visitor has neither signal
// and still waits for the check as before.
function readOptimisticAuthSeed() {
  if (readAuthHint()) return true
  try { return !!localStorage.getItem(RESUME_KEY) } catch (_) { return false }
}

// iOS/iCloud Keychain (and every desktop password manager) only offers to SAVE
// and later AUTOFILL a password when the form exposes a username field paired
// with the password. The team gate has no per-user account, so we pair a stable
// hidden "spectre-team" username with the password input - both with proper
// name/id/autocomplete. Visually hidden but NOT display:none (WebKit skips
// display:none fields for autofill association).
const SR_ONLY_STYLE = {
  position: 'absolute', width: '1px', height: '1px', padding: 0,
  margin: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap', border: 0,
}
function HiddenGateUsername() {
  return (
    <input
      type="text" name="username" id="spectre-team-username"
      defaultValue="spectre-team" readOnly tabIndex={-1} aria-hidden="true"
      autoComplete="username" style={SR_ONLY_STYLE}
    />
  )
}

// ─── Force-quit-proof session resume ─────────────────────────────────────────
// readAuthHint() (sessionStorage) covers a TRANSIENT check failure, but
// sessionStorage is WIPED when an iOS PWA is force-quit ("clear from app
// switcher") - and the cookie can be evicted on that path too, so the user came
// back to the password screen. localStorage DOES survive a force-quit, so on a
// successful auth we stash the signed gate token here; on a cold launch where
// the cookie is gone, tryResumeSession() replays it to /api/auth-gate?action=
// resume, which re-verifies + re-mints the cookie. No password re-entry.
const RESUME_KEY = 'spectre-gate-resume'
function storeResumeToken(data) {
  try {
    if (data && typeof data.resume === 'string' && data.resume) {
      localStorage.setItem(RESUME_KEY, data.resume)
    }
  } catch (_) { /* quota / disabled - non-fatal */ }
}
// Returns true iff the server accepted the stored token and re-minted a cookie.
// Clears the token only on a definitive 401 (expired/forged); a network error
// keeps it so the next launch can retry.
async function tryResumeSession() {
  let token = null
  try { token = localStorage.getItem(RESUME_KEY) } catch (_) { return false }
  if (!token) return false
  try {
    const res = await fetch('/api/auth-gate?action=resume', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: token }),
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(8000)
        : undefined,
    })
    if (res.ok) {
      const data = await res.json().catch(() => ({}))
      storeResumeToken(data)
      return true
    }
    if (res.status === 401) { try { localStorage.removeItem(RESUME_KEY) } catch (_) { /* noop */ } }
    return false
  } catch (_) {
    return false
  }
}

// Shared boot-skeleton shimmer (used by the loading state + the mount wait).
function GateLoading({ t }) {
  return (
    <div className="auth-gate">
      <div className="auth-loading">
        <div className="animate-shimmer" aria-hidden style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-elevated) 50%, var(--bg-surface) 75%)', backgroundSize: '200% 100%' }} />
        <p className="auth-loading-text">{t('auth.loading')}</p>
      </div>
    </div>
  )
}

// ─── Beta access SHELL (no Privy hooks) ──────────────────────────────
// Owns the cookie check + public/demo/dev-bypass + beta-closed + team-password
// fallback. An authenticated user returns children WITHOUT mounting Privy. Only
// when the login UI is actually needed do we requestPrivyMount() and hand off
// to BetaAccessFlow (which safely calls the real Privy hooks).
const BetaAccessShell = ({ children }) => {
  const { t } = useTranslation()
  const location = useLocation()
  const privyMounted = usePrivyMounted()
  const registerGateSlot = usePrivyGateSlotRegister()
  // DOM node the (portaled) BetaAccessFlow renders into. Set via a callback ref
  // so registration fires exactly when the slot div mounts/unmounts.
  const gateSlotRef = useRef(null)

  // Cookie verification state (server is source of truth - sessionStorage
  // is only a hint to avoid a flash of gate UI on reload).
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    if (typeof window === 'undefined') return false
    if (isDevBypass) {
      try { sessionStorage.setItem('spectre-auth', 'true') } catch (_) { /* swallow */ }
      return true
    }
    // Seed from the last-known-good signals so a returning/authed user renders
    // the app instantly while the cookie check is in flight. The check below
    // still runs and corrects this if the server says the cookie is gone.
    return readOptimisticAuthSeed()
  })
  const [isLoading, setIsLoading] = useState(() => !isDevBypass)
  const [betaClosed, setBetaClosed] = useState(false)
  const [showTeamPwd, setShowTeamPwd] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Initial cookie check on mount. Server-side verify; if a valid spectre-gate
  // OR spectre-beta cookie is present, unlock without any further round-trip.
  useEffect(() => {
    if (isDevBypass) return
    let cancelled = false
    ;(async () => {
      try {
        // PR-3 (perf): the index.html boot script fires this exact check at
        // HTML-parse time - adopt that in-flight result instead of paying a
        // fresh round-trip here (this is the one render-blocking request at
        // boot). Falls through to a normal fetch when absent or failed.
        let resOk = null
        let data = null
        const early = consumeEarlyFetch('/api/auth-gate?action=check')
        if (early) {
          // Bound the adopted early-fetch. index.html fires this check at
          // HTML-parse time with NO timeout, so a stalled request (CF edge
          // hiccup, cold function, flaky link) leaves `await early` pending
          // forever -> isLoading stuck true -> the boot skeleton / GateLoading
          // never clears -> a permanent black screen that a reload can't fix
          // (every reload re-stalls the same request). The 8s timeout on the
          // fallback fetch below was added for exactly this, but the early
          // adoption path bypassed it. Race a 6s cap so a stall falls through
          // to that bounded fetch instead of hanging.
          const result = await Promise.race([
            early,
            new Promise((resolve) => setTimeout(() => resolve(null), 6000)),
          ])
          if (result && result.json !== null) {
            resOk = result.ok
            data = result.json
          }
        }
        if (data === null) {
          // 8s bound (audit 2026-06-10): with no signal, a hung check held the
          // whole app on the boot skeleton indefinitely. On abort the catch
          // below falls through to the gate screen, same as any network error.
          // Feature-detected because older Safari (<16) lacks AbortSignal.timeout.
          const res = await fetch('/api/auth-gate?action=check', {
            credentials: 'include',
            signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
              ? AbortSignal.timeout(8000)
              : undefined,
          })
          if (cancelled) return
          resOk = res.ok
          data = await res.json().catch(() => ({}))
        }
        if (cancelled) return
        // SEC-20260520-001: only a FULL team-gate cookie unlocks the app.
        // `check` returns { ok:true, demo:true } for a `dc_demo` showcase
        // cookie (scoped .spectreai.io). Previously `if (res.ok)` treated that
        // as full auth, so anyone who loaded spectreai.io (which mints the
        // demo cookie) could then open app.spectreai.io and bypass the team
        // password. The legit showcase still renders via `isDemoMode` (which
        // requires ?demo=true + referrer), NOT this check - so gating on
        // !data.demo here closes the bypass without breaking the showcase.
        if (resOk && data.ok && !data.demo) {
          setIsAuthenticated(true)
          try { sessionStorage.setItem('spectre-auth', 'true') } catch (_) { /* swallow */ }
          storeResumeToken(data) // keep the localStorage copy as fresh as the cookie
        } else {
          // Cookie is gone/invalid (classic iOS PWA force-quit eviction). Before
          // dropping to the gate, try to silently restore from the localStorage
          // resume token so the founder isn't re-prompted on every quick-clear.
          const resumed = await tryResumeSession()
          if (cancelled) return
          if (resumed) {
            setIsAuthenticated(true)
            try { sessionStorage.setItem('spectre-auth', 'true') } catch (_) { /* swallow */ }
          } else {
            setIsAuthenticated(false)
            try { sessionStorage.removeItem('spectre-auth') } catch (_) { /* swallow */ }
            // Server hint: BETA_OPEN=false and no team cookie. Jump straight to
            // the "Beta launches soon" screen instead of showing the email form
            // that would just bounce to the same screen after user submits.
            if (data.betaClosed) setBetaClosed(true)
          }
        }
      } catch (_) {
        // The fetch THREW (offline / abort / timeout / cold function) — we did
        // NOT get a "you're not authed" answer from the server, so we don't
        // actually know the cookie is gone. Try a durable resume first (survives
        // force-quit where the sessionStorage hint doesn't); otherwise keep a
        // previously-authed user in via the hint instead of a false logout. A
        // never-authed user has neither and still lands on the gate.
        const resumed = await tryResumeSession().catch(() => false)
        if (cancelled) return
        if (resumed) {
          setIsAuthenticated(true)
          try { sessionStorage.setItem('spectre-auth', 'true') } catch (_) { /* swallow */ }
        } else {
          setIsAuthenticated(readAuthHint())
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Fallback: if still loading after 2s in dev, show app anyway so user never sees blank screen
  useEffect(() => {
    if (!isDevBypass) return
    const timer = setTimeout(() => setIsLoading(false), 2000)
    return () => clearTimeout(timer)
  }, [])

  // Hard watchdog (prod): the gate's loading state is a near-black screen
  // (#boot-skeleton at #09090b, then GateLoading). It must NEVER be terminal.
  // The check above is now double-bounded (6s early-race + 8s fallback), but
  // if both somehow stall, force the loading state off after 15s so the user
  // lands on the login/gate UI and can act, instead of staring at black.
  useEffect(() => {
    if (isDevBypass || !isLoading) return
    const timer = setTimeout(() => setIsLoading(false), 15000)
    return () => clearTimeout(timer)
  }, [isLoading])

  // Public routes and demo mode bypass auth entirely (checked AFTER hooks)
  const isPublicRoute = PUBLIC_ROUTES.some(r => location.pathname === r || location.pathname.startsWith(r + '/'))
  const needsLoginUi = !isLoading && !isAuthenticated && !isPublicRoute && !isDemoMode && !betaClosed

  // The moment we know the user needs the Privy login UI, pull the provider in
  // so it's hydrated before they can submit an email. Drop the boot skeleton so
  // the (loading) gate / login form is visible instead of a frozen skeleton.
  useEffect(() => {
    if (needsLoginUi) requestPrivyMount('gate')
  }, [needsLoginUi])
  useEffect(() => {
    if (!isLoading && !isAuthenticated) dismissBootSkeleton()
  }, [isLoading, isAuthenticated])

  // Stable callbacks handed to the portaled BetaAccessFlow. Inline arrows here
  // would get a fresh identity every render → new flowProps → the slot's
  // registration effect re-runs and re-registers on every render. Stable
  // identities keep the portaled flow's own memoized hooks (verifyBetaAccess)
  // from thrashing. (The infinite-loop guard itself lives in the gateFlow
  // context split - see lib/use-privy-safe.jsx.)
  const handleAuthenticated = useCallback(() => setIsAuthenticated(true), [])
  const handleBetaClosed = useCallback(() => setBetaClosed(true), [])

  // Team-password submit handler (same logic as legacy gate). No Privy.
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
        const data = await res.json().catch(() => ({}))
        storeResumeToken(data) // persist for force-quit-proof resume
        try { sessionStorage.setItem('spectre-auth', 'true') } catch (_) { /* swallow */ }
        setIsAuthenticated(true)
      } else if (res.status === 429) {
        setPasswordError(t('auth.tooManyAttempts', { defaultValue: 'Too many attempts. Try again in 15 minutes.' }))
        setPassword('')
      } else {
        setPasswordError(t('auth.invalidPassword'))
        setPassword('')
      }
    } catch (err) {
      logError('authGate:teamSubmit', err)
      setPasswordError(t('auth.invalidPassword'))
      setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  const teamPwdForm = (
    showTeamPwd && (
      <form onSubmit={handleTeamSubmit} className="auth-form" style={{ marginTop: 16 }}>
        <HiddenGateUsername />
        <div className="input-group">
          <input
            type="password" name="password" id="spectre-team-password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('auth.placeholder')}
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

  if (isPublicRoute || isDemoMode) return children
  // isAuthenticated BEFORE isLoading: the optimistic seed (hint / resume
  // token) renders the app immediately; the background check corrects to the
  // gate only on a definitive server "no". Loading screen is reserved for
  // visitors with no auth signal at all.
  if (isAuthenticated) return children
  if (isLoading) return <GateLoading t={t} />

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
  // gateSlotRef. We render an empty slot div + register it (with the flow's
  // props) for the portal. Until the provider mounts (brief — the chunk is
  // already downloading from requestPrivyMount above) we show the boot shimmer,
  // same as the old eager path, so there's no visible regression.
  return (
    <BetaAccessFlowSlot
      registerGateSlot={registerGateSlot}
      gateSlotRef={gateSlotRef}
      ready={privyMounted}
      loading={<GateLoading t={t} />}
      flowProps={{
        onAuthenticated: handleAuthenticated,
        onBetaClosed: handleBetaClosed,
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
 * boot shimmer over the slot until the provider has mounted + filled it. Kept as
 * its own component so the registration effect's deps are explicit and the slot
 * div is the only thing the shell renders for the login state.
 */
function BetaAccessFlowSlot({ registerGateSlot, gateSlotRef, ready, loading, flowProps }) {
  // Register on slot mount + whenever the flow props change; deregister on
  // unmount. The portal reads { node, props } from context and renders into node.
  const { onAuthenticated, onBetaClosed, showTeamPwd, setShowTeamPwd, teamPwdForm } = flowProps
  useEffect(() => {
    const node = gateSlotRef.current
    if (node) registerGateSlot(node, flowProps)
    return () => registerGateSlot(null)
    // flowProps is rebuilt each render; depend on its stable-ish members so we
    // re-register when the team-password form/toggle changes (so the portaled
    // flow sees fresh props) without thrashing on unrelated renders.
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
  const { t } = useTranslation()
  const location = useLocation()

  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    if (typeof window === 'undefined') return false
    if (isDevBypass) {
      try { sessionStorage.setItem('spectre-auth', 'true') } catch (_) { /* swallow */ }
      return true
    }
    // Seed from last-known-good signals (hint / resume token) so a returning
    // user renders the app instantly; the mount check corrects if revoked.
    return readOptimisticAuthSeed()
  })
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(() => !isDevBypass)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (isDevBypass) return
    let cancelled = false
    ;(async () => {
      try {
        // Same 8s bound as the beta gate's mount check above - render-blocking
        // fetch must never hang the boot skeleton indefinitely.
        const res = await fetch('/api/auth-gate?action=check', {
          credentials: 'include',
          signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(8000)
            : undefined,
        })
        if (cancelled) return
        if (res.ok) {
          const data = await res.json().catch(() => ({}))
          storeResumeToken(data)
          setIsAuthenticated(true)
          try { sessionStorage.setItem('spectre-auth', 'true') } catch (_) { /* swallow */ }
        } else {
          const resumed = await tryResumeSession()
          if (cancelled) return
          if (resumed) {
            setIsAuthenticated(true)
            try { sessionStorage.setItem('spectre-auth', 'true') } catch (_) { /* swallow */ }
          } else {
            setIsAuthenticated(false)
            try { sessionStorage.removeItem('spectre-auth') } catch (_) { /* swallow */ }
          }
        }
      } catch (_) {
        // Network failure (not a server "no") — try a durable resume first
        // (survives force-quit), else trust the last-known-good hint instead of
        // a false logout. See the matching note in BetaAccessShell.
        const resumed = await tryResumeSession().catch(() => false)
        if (cancelled) return
        setIsAuthenticated(resumed || readAuthHint())
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!isDevBypass) return
    const timer = setTimeout(() => setIsLoading(false), 2000)
    return () => clearTimeout(timer)
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
        const data = await res.json().catch(() => ({}))
        storeResumeToken(data) // persist for force-quit-proof resume
        sessionStorage.setItem('spectre-auth', 'true')
        setIsAuthenticated(true)
      } else if (res.status === 429) {
        setError(t('auth.tooManyAttempts', { defaultValue: 'Too many attempts. Try again in 15 minutes.' }))
        setPassword('')
      } else {
        setError(t('auth.invalidPassword'))
        setPassword('')
      }
    } catch (err) {
      logError('authGate:submit', err)
      setError(t('auth.invalidPassword'))
      setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  const isPublicRoute = PUBLIC_ROUTES.some(r => location.pathname === r || location.pathname.startsWith(r + '/'))
  if (isPublicRoute || isDemoMode) return children

  // isAuthenticated BEFORE isLoading (optimistic render - see BetaAccessShell).
  if (isAuthenticated) return children

  if (isLoading) {
    return (
      <div className="auth-gate">
        <div className="auth-loading">
          <div className="animate-shimmer" aria-hidden style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-elevated) 50%, var(--bg-surface) 75%)', backgroundSize: '200% 100%' }} />
          <p className="auth-loading-text">{t('auth.loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-gate">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/round-logo.png" alt="Spectre AI" />
          <div className="logo-glow"></div>
        </div>
        <h1 className="auth-title">{t('auth.title')}</h1>
        <p className="auth-subtitle">{t('auth.subtitle')}</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <HiddenGateUsername />
          <div className="input-group">
            <input
              type="password" name="password" id="spectre-team-password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.placeholder')}
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
  // Decision is made once at module load - the env var doesn't change at runtime.
  // Keeping the two components separate avoids calling usePrivy() outside a
  // PrivyProvider when Privy isn't configured (which would throw).
  if (PRIVY_AVAILABLE) return <BetaAccessShell>{children}</BetaAccessShell>
  return <TeamPasswordOnlyGate>{children}</TeamPasswordOnlyGate>
}

export default AuthGate
