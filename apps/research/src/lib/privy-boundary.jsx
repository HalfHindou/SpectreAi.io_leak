/**
 * privy-boundary — wraps the entire app tree in the STABLE SafePrivyContext
 * provider, and mounts the REAL PrivyProvider in a SIBLING branch (next to the
 * app, with no app children of its own). Until the real provider mounts, the
 * app renders against the usePrivySafe() stub; once it mounts, RealPrivyBridge
 * pushes the live values into SafePrivyContext and consumers re-render.
 *
 * WHY a sibling (not a wrapper): if the real PrivyProvider wrapped the app
 * subtree, mounting it would change the app's position/ancestry in the React
 * tree → React unmounts + remounts the whole subtree → every boot mount effect
 * re-runs (the 3x one-shot-fetch regression). Wrapping the app in <Suspense>
 * + the provider flipped the subtree's parent TWICE (Suspense fallback swap +
 * provider element swap) → TWO remounts → 3 total fetch waves. By rendering the
 * app as a stable sibling of the provider host, the app's tree position is
 * invariant across the lazy mount, so it never remounts. See use-privy-safe.jsx.
 *
 * Mount triggers (whichever fires first):
 *   (a) idle ~2s after first paint — an already-authenticated user gets
 *       profile/wallet features moments later, indistinguishable in practice.
 *   (b) AuthGate showing the login UI (unauthenticated) — via
 *       requestPrivyMount() in auth-gate.jsx, so the provider is ready before
 *       the user can submit.
 *   (c) explicit requestPrivyMount() — e.g. a header "Sign in" click before
 *       idle fired (the stub login() calls it; the login is replayed once
 *       ready via RealPrivyBridge).
 *
 * Showcase embed: Privy's auth iframe refuses to load grand-nested inside the
 * spectreai.io demo iframe ("Frame ancestor is not allowed"). The old main.jsx
 * skipped the provider in that case; we mirror that by never mounting it when
 * embedded.
 */
import React, { Suspense, useEffect, useMemo, Component, lazy } from 'react'
import { isChunkLoadError, triggerChunkRecovery } from '@/lib/chunk-recovery'
import { PrivyMountProvider, usePrivyMountControls, privyChunkGate, releasePrivyChunk } from '@/lib/use-privy-safe'
import { whenBootComplete } from '@/lib/lazy-with-retry'

// A no-op provider — what the host renders when Privy can't load. The app is
// fully interactive on the SafePrivyContext stub, so this is indistinguishable
// from the "no PRIVY_APP_ID" path that already returns null.
const NullPrivyProvider = () => null

/**
 * Privy-specific resilient lazy loader.
 *
 * Privy is OPTIONAL: the entire app runs against the usePrivySafe() stub until
 * (and whether or not) the real provider mounts. So a failed provider-chunk
 * fetch MUST degrade to the stub — it must never reload the page or crash the
 * app.
 *
 * Why this is NOT the shared `lazyWithRetry`: that helper escalates a repeated
 * chunk-load failure to `triggerChunkRecovery()` — a full-page reload (twice),
 * then a hard reject that bubbles to the app-level error boundary ("The app
 * failed to load"). That is correct for a ROUTE chunk on a stale prod deploy,
 * but wrong for this idle, background, optional provider. In dev especially,
 * Vite re-optimizing the huge @privy-io/react-auth + wallet dep tree the first
 * time this chunk loads makes "Failed to fetch dynamically imported module" a
 * common, transient blip — which the old path turned into a fatal app crash.
 *
 * Here we retry the same URL a few times with backoff (covers the Vite
 * re-optimize window and any CDN propagation blip in prod) and, if it still
 * fails, resolve to a no-op so Suspense settles cleanly and the app keeps
 * running on the stub.
 */
const PRIVY_LOAD_RETRIES = 3
const LazyPrivyProvider = lazy(async () => {
  // Hard boot guard: never fetch the ~1.8MB wallet chunk while the app is
  // still painting. Whatever caused this lazy element to render, the download
  // waits for the gate (released after the app settles, on first interaction,
  // or immediately on an explicit requestPrivyMount). Suspense fallback is
  // null and the app runs on the stub, so waiting here is invisible.
  await privyChunkGate
  for (let attempt = 0; attempt <= PRIVY_LOAD_RETRIES; attempt++) {
    try {
      return await import('@/lib/privy-provider-lazy')
    } catch (err) {
      const lastAttempt = attempt >= PRIVY_LOAD_RETRIES
      if (!lastAttempt && isChunkLoadError(err)) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
        continue
      }
      // A stale-deploy chunk error is fixable by a purge+reload — running on
      // the stub means sign-in silently NEVER renders (the gate slot stays a
      // dead loader). Budget-capped: when recovery reloads, this promise never
      // resolves (the page is navigating); when the budget is spent it rejects
      // and we fall through to the stub as before.
      if (isChunkLoadError(err)) {
        try { await triggerChunkRecovery(err) } catch (_) { /* budget spent — stub below */ }
      }
      // eslint-disable-next-line no-console
      console.warn('[privy] provider chunk unavailable — app continues on the safe stub:', err?.message || err)
      return { default: NullPrivyProvider }
    }
  }
  return { default: NullPrivyProvider }
})

/**
 * Belt-and-suspenders: if the real PrivyProvider throws at RENDER time (a Privy
 * internal error, a bad config, etc.), catch it here and render nothing rather
 * than letting it propagate to the app-level error boundary. Optional provider →
 * never fatal. The app falls back to the safe stub exactly as if Privy never
 * mounted.
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

// 🪤 The fallback MUST honour the caller's timeout intent. It used to be
// `setTimeout(cb, 1)`, so on any engine without requestIdleCallback - which
// includes iOS Safari before 16.4, i.e. a real slice of the iPhone install
// base - the "idle" mount fired ~immediately and dragged the 1.8MB wallet
// chunk straight into the boot critical path.
const __idle =
  (typeof window !== 'undefined' && window.requestIdleCallback) ||
  ((cb, opts) => setTimeout(
    () => cb({ didTimeout: true, timeRemaining: () => 0 }),
    (opts && opts.timeout) || 2000,
  ))

function isShowcaseEmbed() {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('embed') === 'showcase') return true
    if (window.self !== window.top) return true
  } catch {
    return true
  }
  return false
}

// The sibling provider host. Reads `mounted` from the mount context and renders
// the lazy real PrivyProvider — which has NO app children, only RealPrivyBridge
// (+ the portaled gate flow). Lives next to the app subtree, never around it, so
// its lazy resolve / Suspense fallback swap can't remount the app.
//
// Suspense fallback is `null`: the app keeps running on the stub while the
// provider chunk downloads (the stub is fully interactive), so there's no flash
// and — critically — nothing in the app subtree is suspended by this boundary.
function PrivyProviderHost() {
  const { mounted, setReal, setWallets, setActions } = usePrivyMountControls()
  const showcase = isShowcaseEmbed()

  // Memoize the provider element. This host consumes the SAME mount context that
  // RealPrivyBridge pushes live values into (setReal/setWallets/setActions). Each
  // push creates a new context value → this host re-renders. Without the memo,
  // that re-render would re-render the real <PrivyProvider> subtree, which
  // re-renders Privy's always-mounted HIDDEN Telegram widget. That widget's
  // effect is keyed on its whole props object, so it removes + re-injects
  // https://auth.privy.io/js/telegram-login.js on EVERY provider render — and the
  // re-render also re-runs the bridge, which pushes again → a feedback loop that
  // re-downloads telegram-login.js hundreds of times.
  //
  // The setters are referentially stable (useCallback in PrivyMountProvider), so
  // this element is built once when `mounted` flips true and then reused — value
  // pushes can no longer re-render the provider subtree. Privy still re-renders
  // internally on its own state changes (bounded), but the amplifier is gone.
  return useMemo(() => {
    if (!mounted || showcase) return null
    return (
      <PrivyErrorBoundary>
        <Suspense fallback={null}>
          <LazyPrivyProvider setReal={setReal} setWallets={setWallets} setActions={setActions} />
        </Suspense>
      </PrivyErrorBoundary>
    )
  }, [mounted, showcase, setReal, setWallets, setActions])
}

// Idle-mount driver, kept separate so it can call setMounted from the mount
// controls without re-rendering the provider host on every idle tick.
//
// The wallet chunk is ~1.8MB raw - the single heaviest asset in the app, and
// nothing above the fold needs it. Measured on the prod build (4x CPU, phone
// viewport) it was being fetched at ~770ms, i.e. straight through the middle
// of the first render, because a brief idle gap right after mount satisfied
// requestIdleCallback. Its download + parse then competed with the route
// chunk for both bandwidth and main thread - a large part of the "3 second"
// open. Now it waits for BOTH:
//   1. boot completion (skeleton handed off - the app is actually on screen), then
//   2. a genuine idle window after that (or the 4s timeout backstop).
// First real user interaction short-circuits straight to mount: someone
// touching the screen may be reaching for Sign in, and the explicit
// requestPrivyMount() paths (auth gate, stub login replay) are unchanged and
// still bypass all of this.
const INTERACTION_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'wheel']
const POST_BOOT_SETTLE_MS = 1800

function PrivyIdleMounter() {
  const { mounted, setMounted } = usePrivyMountControls()
  useEffect(() => {
    if (mounted) return
    if (isShowcaseEmbed()) return
    let cancelled = false
    let idleId = null
    let settleTimer = null
    const mount = () => {
      releasePrivyChunk()
      if (!cancelled) { cancelled = true; setMounted(true) }
    }

    // Any real interaction -> mount now (they may be about to sign in).
    const onInteract = () => mount()
    for (const evt of INTERACTION_EVENTS) {
      window.addEventListener(evt, onInteract, { once: true, passive: true, capture: true })
    }

    // Boot handoff alone is NOT enough: measured, requestIdleCallback fires
    // the very next tick after the skeleton leaves, while the freshly-painted
    // page is still hydrating (data lands, images decode, lists paint). Give
    // the app a settle window first, THEN ask for idle. Nothing above the
    // fold depends on the provider, and any touch short-circuits it.
    whenBootComplete().then(() => {
      if (cancelled) return
      settleTimer = setTimeout(() => {
        if (cancelled) return
        idleId = __idle(mount, { timeout: 4000 })
      }, POST_BOOT_SETTLE_MS)
    })

    return () => {
      cancelled = true
      for (const evt of INTERACTION_EVENTS) {
        window.removeEventListener(evt, onInteract, { capture: true })
      }
      if (settleTimer) clearTimeout(settleTimer)
      if (typeof window !== 'undefined' && window.cancelIdleCallback && typeof idleId === 'number') {
        try { window.cancelIdleCallback(idleId) } catch (_) { /* ignore */ }
      }
    }
  }, [mounted, setMounted])
  return null
}

export default function PrivyBoundary({ children }) {
  return (
    <PrivyMountProvider>
      {children}
      <PrivyIdleMounter />
      <PrivyProviderHost />
    </PrivyMountProvider>
  )
}
