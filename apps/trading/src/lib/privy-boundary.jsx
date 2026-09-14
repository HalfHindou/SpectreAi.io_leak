/**
 * privy-boundary — wraps the entire app tree in the STABLE SafePrivyContext
 * provider, and mounts the REAL PrivyProvider in a SIBLING branch (next to the
 * app, with no app children of its own). Until the real provider mounts, the app
 * renders against the usePrivySafe() stub; once it mounts, RealPrivyBridge pushes
 * the live values into SafePrivyContext and consumers re-render. Trading port of
 * apps/research/src/lib/privy-boundary.jsx.
 *
 * WHY a sibling (not a wrapper): if the real PrivyProvider wrapped the app
 * subtree, mounting it would change the app's position/ancestry in the React tree
 * → React unmounts + remounts the whole subtree → every boot mount effect re-runs
 * (a 3x one-shot-fetch regression). By rendering the app as a stable sibling of
 * the provider host, the app's tree position is invariant across the lazy mount,
 * so it never remounts. See use-privy-safe.jsx.
 *
 * Mount triggers (whichever fires first):
 *   (a) FAST — a session hint exists (Privy localStorage keys), so an authed
 *       returning user gets their wallet the moment after first paint (~100ms).
 *   (b) idle ~2s after first paint — a fresh visitor gets Privy shortly after,
 *       indistinguishable in practice.
 *   (c) requestPrivyMount() — the AuthGate showing the login UI, or a "Sign in"
 *       click (the stub login() calls it; the login is replayed once ready).
 *
 * TRADING vs RESEARCH: research SKIPS the provider entirely when embedded (its
 * showcase iframe refuses Privy's auth iframe). Trading does the OPPOSITE — the
 * research /token embed (?embedded=true) STILL needs Privy because embed swaps
 * sign with the embedded wallet. So we only skip mounting when there is no
 * PRIVY_APP_ID; the embed mounts idle-deferred like everyone else.
 */
import React, { Suspense, useEffect, useMemo, Component, lazy } from 'react'
import { isChunkLoadError } from './chunk-recovery'
import { PRIVY_APP_ID } from './privy-app-id'
import { PrivyMountProvider, usePrivyMountControls } from './use-privy-safe'

// A no-op provider — what the host renders when Privy can't load. The app is
// fully interactive on the SafePrivyContext stub, so this is indistinguishable
// from the "no PRIVY_APP_ID" path that already returns null.
const NullPrivyProvider = () => null

/**
 * Privy-specific resilient lazy loader.
 *
 * Privy is OPTIONAL: the entire app runs against the usePrivySafe() stub until
 * (and whether or not) the real provider mounts. So a failed provider-chunk fetch
 * MUST degrade to the stub — it must never reload the page or crash the app.
 *
 * Why NOT the shared lazyWithRetry: that helper escalates a repeated chunk-load
 * failure to triggerChunkRecovery() — a full-page reload, then a hard reject that
 * bubbles to an error boundary. Correct for a ROUTE chunk on a stale deploy, but
 * wrong for this idle, background, optional provider (esp. in dev, where Vite
 * re-optimizing the huge @privy-io dep tree makes the first load a common
 * transient blip). Here we retry the same URL a few times with backoff and, if it
 * still fails, resolve to a no-op so Suspense settles and the app keeps running.
 */
const PRIVY_LOAD_RETRIES = 3
const LazyPrivyProvider = lazy(async () => {
  for (let attempt = 0; attempt <= PRIVY_LOAD_RETRIES; attempt++) {
    try {
      return await import('./privy-provider-lazy')
    } catch (err) {
      const lastAttempt = attempt >= PRIVY_LOAD_RETRIES
      if (!lastAttempt && isChunkLoadError(err)) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
        continue
      }
      // eslint-disable-next-line no-console
      console.warn('[privy] provider chunk unavailable — app continues on the safe stub:', err?.message || err)
      return { default: NullPrivyProvider }
    }
  }
  return { default: NullPrivyProvider }
})

/**
 * Belt-and-suspenders: if the real PrivyProvider throws at RENDER time, catch it
 * here and render nothing rather than crashing the app. Optional provider → never
 * fatal. The app falls back to the safe stub exactly as if Privy never mounted.
 */
class PrivyErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err) {
    // eslint-disable-next-line no-console
    console.warn('[privy] provider errored — app continues on the safe stub:', err?.message || err)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

const __idle =
  (typeof window !== 'undefined' && window.requestIdleCallback) ||
  ((cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 1))

// Detect a persisted Privy session so an authed returning user gets their wallet
// right after first paint instead of waiting the full idle window. Covers both
// modes: localStorage token storage (privy:token / privy:refresh_token) AND
// server-cookie mode on the custom auth domain (only privy:caid / privy:connections
// survive in localStorage — see privy.md D12.1).
function hasPrivySessionHint() {
  if (typeof window === 'undefined') return false
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || k.indexOf('privy:') !== 0) continue
      if (k.includes('token') || k.includes('refresh_token') || k.includes('caid') || k.includes('connections')) return true
    }
  } catch (_) { /* storage blocked — fall through to idle mount */ }
  return false
}

// The sibling provider host. Reads `mounted` from the mount context and renders
// the lazy real PrivyProvider — which has NO app children, only RealPrivyBridge
// (+ the portaled gate flow). Lives next to the app subtree, never around it, so
// its lazy resolve / Suspense fallback swap can't remount the app.
//
// Suspense fallback is `null`: the app keeps running on the stub while the
// provider chunk downloads (the stub is fully interactive), so there's no flash.
function PrivyProviderHost() {
  const { mounted, setReal, setWallets, setSolanaWallets, setActions } = usePrivyMountControls()

  // Memoize the provider element. This host consumes the SAME mount context that
  // RealPrivyBridge pushes live values into. Each push creates a new context value
  // → this host re-renders. Without the memo, that re-render would re-render the
  // real <PrivyProvider> subtree, which re-renders Privy's always-mounted HIDDEN
  // Telegram widget — whose effect removes + re-injects telegram-login.js on EVERY
  // provider render, and the re-render also re-runs the bridge which pushes again
  // → a feedback loop that re-downloads telegram-login.js hundreds of times.
  //
  // The setters are referentially stable (useCallback in PrivyMountProvider), so
  // this element is built once when `mounted` flips true and then reused.
  return useMemo(() => {
    if (!mounted || !PRIVY_APP_ID) return null
    return (
      <PrivyErrorBoundary>
        <Suspense fallback={null}>
          <LazyPrivyProvider
            setReal={setReal}
            setWallets={setWallets}
            setSolanaWallets={setSolanaWallets}
            setActions={setActions}
          />
        </Suspense>
      </PrivyErrorBoundary>
    )
  }, [mounted, setReal, setWallets, setSolanaWallets, setActions])
}

// Mount driver, kept separate so it can call setMounted from the mount controls
// without re-rendering the provider host on every idle tick.
function PrivyMounter() {
  const { mounted, setMounted } = usePrivyMountControls()
  useEffect(() => {
    if (mounted || !PRIVY_APP_ID) return
    let cancelled = false
    const fire = () => { if (!cancelled) setMounted(true) }
    // Authed returning user → mount right after first paint so the wallet is
    // ready before they can interact.
    if (hasPrivySessionHint()) {
      const t = setTimeout(fire, 100)
      return () => { cancelled = true; clearTimeout(t) }
    }
    // Fresh visitor → idle-defer.
    const id = __idle(fire, { timeout: 2500 })
    return () => {
      cancelled = true
      if (typeof window !== 'undefined' && window.cancelIdleCallback && typeof id === 'number') {
        try { window.cancelIdleCallback(id) } catch (_) { /* ignore */ }
      }
    }
  }, [mounted, setMounted])
  return null
}

export default function PrivyBoundary({ children }) {
  return (
    <PrivyMountProvider>
      {children}
      <PrivyMounter />
      <PrivyProviderHost />
    </PrivyMountProvider>
  )
}
