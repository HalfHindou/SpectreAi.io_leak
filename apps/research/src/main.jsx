/**
 * Spectre AI Trading Platform - Main entry point
 */
import { Buffer } from 'buffer'
window.Buffer = Buffer

import '@/lib/glass-scrollbars'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
// PR (perf, 2026-06-11): the Privy + WalletConnect + viem + Coinbase + Solana
// wallet stack (~67% of the entry chunk) is no longer eagerly imported here.
// `PrivyBoundary` lazy-mounts the real PrivyProvider after first paint (idle /
// login click / auth-gate showing login UI). privy-config (incl.
// toSolanaWalletConnectors) and applyPrivyModalHacks now live in the lazy
// provider chunk, so the whole stack leaves the entry graph. See
// lib/privy-boundary.jsx + lib/use-privy-safe.js.
import PrivyBoundary from '@/lib/privy-boundary'
// `init` / `loadBinanceCatalog` / `initTooltipSystem` are dynamic-imported
// inside __idle below — their MODULES (PostHog SDK, Binance fetch helpers,
// the tooltip DOM observer) shouldn't sit in the initial JS bundle just
// because they're called later. `track` / `Events` are still eager via the
// analytics service (no-op when posthog isn't init'd) so first-paint event
// fire-and-forget calls still work.
import { track, Events } from '@/services/analytics'
import App from './App'
import { dismissBootSkeleton, whenEntryCssLoaded } from '@/lib/lazy-with-retry'
import { isChunkLoadError } from '@/lib/chunk-recovery'
import { upgradeSettingsStorage } from '@/store/migrateOldSettings'
import './i18n'
// Self-hosted fonts (replaces Google Fonts CDN link in index.html since
// 2026-05-19 ZAP follow-up - closes SRI MED + drops fonts.googleapis.com
// from CSP script-src/style-src and fonts.gstatic.com from font-src).
// Only the 4 above-the-fold Inter weights load eagerly; the other 14 weights
// (extra Inter, Space Grotesk, Instrument Serif, Playfair, JetBrains Mono)
// are deferred to idle below so they never block first paint. The design
// tokens list -apple-system first, so UI/LCP text renders instantly anyway.
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import './index.css'
import '@/styles/app-store-ready.css'
import '@/styles/unified-chips.css'

// Idle scheduler - runs after the browser has painted and gone idle, so
// nothing below blocks LCP. Fallback to a 1ms timeout where unsupported.
const __idle = window.requestIdleCallback || ((cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 1))

// mobile-2026.css (5697 lines) is only used under 768px - skip the parse on
// desktop (the common case) entirely. Loaded immediately on mobile (it's
// layout-critical there); matchMedia 'change' covers a desktop->narrow resize.
;(() => {
  try {
    const mq = window.matchMedia('(max-width: 768px)')
    const ensureMobileCss = () => {
      if (mq.matches) {
        import('@/styles/mobile-2026.css')
        mq.removeEventListener?.('change', ensureMobileCss)
      }
    }
    ensureMobileCss()
    mq.addEventListener?.('change', ensureMobileCss)
  } catch (_) { import('@/styles/mobile-2026.css') }
})()

// In dev, proactively kill any service worker registered from a prior prod visit
// to localhost - it intercepts module fetches and fails with stale chunk URLs.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    if (regs.length === 0) return
    Promise.all(regs.map((r) => r.unregister())).then(() => {
      if ('caches' in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)))
      console.warn('[dev] Unregistered stale service worker(s). Reload to pick up fresh modules.')
    })
  }).catch(() => { /* ignore */ })
}

// Stale-chunk recovery after a redeploy. The attempt counter rides on the URL
// (?_reload=N) so it self-heals across nav and never gets stuck in storage,
// but we read it and strip the params SYNCHRONOUSLY on boot so the user never
// sees ?_reload/_cbust in the address bar. A single auto-attempt purges the
// service worker + Cache Storage (the prod culprit) and reloads once. If the
// next boot still fails, PageErrorBoundary shows the "New version" UI and the
// user takes over.
const RELOAD_PARAM = '_reload'
const CBUST_PARAM = '_cbust'
// Legacy boundary recovery counter (PR #601). Pre-#615 boundaries wrote this
// to the URL and we still need to strip it on boot for any user landing with
// it stuck in their address bar (bookmark, share-link, cached SW serving the
// old bundle). The current boundary uses sessionStorage instead.
const CHUNK_RECOVER_PARAM = '_chunkrecover'

const __reloadAttempt = (() => {
  try {
    const url = new URL(window.location.href)
    const n = Number(url.searchParams.get(RELOAD_PARAM) || 0)
    const had = url.searchParams.has(RELOAD_PARAM) || url.searchParams.has(CBUST_PARAM) || url.searchParams.has(CHUNK_RECOVER_PARAM)
    if (had) {
      url.searchParams.delete(RELOAD_PARAM)
      url.searchParams.delete(CBUST_PARAM)
      url.searchParams.delete(CHUNK_RECOVER_PARAM)
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : '') + url.hash)
    }
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch (_) { return 0 }
})()

// Shared chunk-recovery counter. PageErrorBoundary writes
// sessionStorage['__spectre_chunk_recover'] for its own retry budget; the
// handlers in this file used to track via URL `_reload` only, which the
// boundary's plain reload() didn't carry forward. Result: vite-handler,
// PageErrorBoundary, and the unhandledrejection/controllerchange handlers
// added below could each fire independently for the same stale-SW visit
// and the user saw up to 4 reloads in a row (the "looping" symptom).
// Reading + bumping the same sessionStorage key from all paths caps total
// auto-reloads per tab at 2 — after that, the boundary surfaces UI.
const CHUNK_RECOVER_KEY = '__spectre_chunk_recover'
const MAX_CHUNK_RECOVER_ATTEMPTS = 2
const getChunkRecoverAttempt = () => {
  try { return Number(sessionStorage.getItem(CHUNK_RECOVER_KEY) || 0) } catch (_) { return 0 }
}
const bumpChunkRecoverAttempt = () => {
  try { sessionStorage.setItem(CHUNK_RECOVER_KEY, String(getChunkRecoverAttempt() + 1)) } catch (_) { /* quota — ignore */ }
}

async function purgePwaCaches() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)))
    }
  } catch (_) { /* ignore */ }
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)))
    }
  } catch (_) { /* ignore */ }
}

let __reloadInFlight = false
window.addEventListener('vite:preloadError', (event) => {
  // CRITICAL: only preventDefault when we're actually going to handle the
  // error (reload). If we cancel the event but don't reload, Vite's preload
  // helper sees defaultPrevented and resolves the dynamic import with
  // `undefined` instead of throwing - then React.lazy stores _result = undefined
  // and accessing `.default` throws "can't access property 'default',
  // e._result is undefined", which AppErrorBoundary catches with a yellow
  // crash screen. Letting Vite throw means React.lazy rejects normally and
  // PageErrorBoundary's stale-chunk recovery handles it cleanly.
  if (__reloadAttempt >= 1 || getChunkRecoverAttempt() >= MAX_CHUNK_RECOVER_ATTEMPTS) {
    console.error('vite:preloadError at max auto-reloads - surfacing UI', event)
    return // do NOT preventDefault - let it throw so PageErrorBoundary catches
  }
  if (__reloadInFlight) {
    event.preventDefault?.()
    return
  }
  event.preventDefault?.()
  __reloadInFlight = true
  bumpChunkRecoverAttempt()
  console.warn('vite:preloadError - purging PWA caches and reloading once')
  purgePwaCaches().finally(() => {
    const url = new URL(window.location.href)
    url.searchParams.set(RELOAD_PARAM, '1')
    url.searchParams.set(CBUST_PARAM, String(Date.now()))
    window.location.replace(url.toString())
  })
})

// Stale-chunk recovery layer #2: unhandled promise rejections.
// `vite:preloadError` fires for module-preload failures during initial load,
// but React.lazy() does its own runtime `import()` and surfaces chunk
// failures as Promise rejections that bubble to `unhandledrejection`
// instead. That gap was the "black screen until refresh" symptom: the
// route component failed to mount, no boundary caught the Promise, and
// the page rendered nothing.
window.addEventListener('unhandledrejection', (event) => {
  const msg = String(event?.reason?.message || event?.reason || '')
  if (!isChunkLoadError(event?.reason)) return
  if (__reloadAttempt >= 1 || getChunkRecoverAttempt() >= MAX_CHUNK_RECOVER_ATTEMPTS) {
    // Let it surface - either main.jsx already auto-reloaded once in this
    // URL session, or PageErrorBoundary already burned through its retry
    // budget. The boundary will render its visible "New version" UI.
    return
  }
  if (__reloadInFlight) {
    event.preventDefault?.()
    return
  }
  __reloadInFlight = true
  bumpChunkRecoverAttempt()
  console.warn('chunk-load rejection - purging caches and reloading once:', msg)
  event.preventDefault?.()
  purgePwaCaches().finally(() => {
    const url = new URL(window.location.href)
    url.searchParams.set(RELOAD_PARAM, '1')
    url.searchParams.set(CBUST_PARAM, String(Date.now()))
    window.location.replace(url.toString())
  })
})

// iOS PWA / tab-focus SW update poke.
// `registerType: 'autoUpdate'` only checks for new SWs on actual page
// loads. An iOS home-screen webapp stays "open" for days without a real
// load — the user reopens the standalone app and sees stale code until
// they force-quit. Asking the SW to update on visibilitychange / focus /
// BFCache restore makes the resume path detect new deploys.
let __swUpdateCheckInFlight = false
const __maybeCheckSWUpdate = () => {
  if (__swUpdateCheckInFlight) return
  if (!('serviceWorker' in navigator)) return
  __swUpdateCheckInFlight = true
  navigator.serviceWorker.getRegistration()
    .then((reg) => reg?.update?.())
    .catch(() => { /* offline or no SW yet — silent */ })
    .finally(() => { __swUpdateCheckInFlight = false })
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') __maybeCheckSWUpdate()
})
window.addEventListener('focus', __maybeCheckSWUpdate)
window.addEventListener('pageshow', (e) => {
  // BFCache restore on iOS — Safari kept the page suspended in memory.
  // Treat the restore as if it were a fresh visit for SW-update purposes.
  if (e.persisted) __maybeCheckSWUpdate()
})

// Auto-apply a new deploy WITHOUT interrupting a visible view.
// skipWaiting + clientsClaim make a freshly-installed SW take over the
// running page and fire `controllerchange`. We used to do nothing here, on
// the theory that "the next navigation / manual refresh picks up the new
// code naturally" — but SPA navigation is client-side and never re-fetches
// index.html, and the SW serves a PRECACHED index.html, so a single refresh
// often still hands back the OLD shell (the new SW only becomes the
// controller on the load AFTER it installs). Net effect: users sat on stale
// code until they HARD-refreshed / cleared cache to see new features.
//
// Fix: reload exactly once when a NEW controller takes over, but ONLY while
// the tab is hidden — a visible view is never yanked out from under the user
// (the regression that previously looked like a random "page reloaded
// itself"). If the swap happens while the tab is visible, defer the reload
// to the next time it goes hidden. Either way the user lands on fresh code
// on their next glance, and a plain refresh now works in one shot — no cache
// clear, no hard refresh.
if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
  // A page with no controller at startup is a FIRST install (or a hard
  // reload that bypassed the SW). The claim that follows is the initial
  // takeover, NOT a redeploy — reloading then is a pointless extra load, so
  // only arm the handler when an OLD SW was already in control.
  const __hadController = !!navigator.serviceWorker.controller
  let __swReloadHandled = false
  const __applySwUpdate = () => {
    if (__swReloadHandled || __reloadInFlight) return
    __swReloadHandled = true
    if (document.hidden) {
      window.location.reload()
      return
    }
    // VISIBLE. Deferring silently until the app is next backgrounded left a
    // user who simply keeps the app open running old code indefinitely — they
    // ask why a shipped change is missing, and when they finally do background
    // it the page reloads behind them and loses their place. So: offer it.
    // AppUpdateBar listens for this and shows a quiet, dismissible bar; the
    // hidden-reload fallback below still applies if they ignore it.
    try {
      window.dispatchEvent(new CustomEvent('spectre:update-ready'))
    } catch (_) { /* CustomEvent unsupported — the fallback still covers it */ }
    const onHide = () => {
      if (!document.hidden) return
      document.removeEventListener('visibilitychange', onHide)
      window.location.reload()
    }
    document.addEventListener('visibilitychange', onHide)
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!__hadController) return // initial claim, not a redeploy
    __applySwUpdate()
  })
}

// Privy modal UX customizations (email tile auto-expand + wallet list scroll)
// now attach inside the lazy Privy provider chunk (lib/privy-provider-lazy.jsx)
// the moment the provider mounts — before any login click can surface a modal.
// They no longer sit on the entry path. See lib/privy-modal-hacks.js.

// Deferred boot work - none of this is needed for first paint, so push it
// past LCP via the idle scheduler defined above. The dynamic imports here
// keep their full module trees (PostHog SDK, Binance helpers, tooltip DOM
// observer) OUT of the initial JS bundle entirely; the cost is paid only
// once the browser is idle.
__idle(async () => {
  try {
    const { init } = await import('@/services/analytics')
    init()
  } catch (_) { /* analytics must never break the app */ }
  try {
    const { loadBinanceCatalog } = await import('@/services/binanceCatalog')
    loadBinanceCatalog()
  } catch (_) { /* ignore */ }
  try {
    const { initTooltipSystem } = await import('@/lib/tooltip-system')
    initTooltipSystem()
  } catch (_) { /* ignore */ }
  // Remaining font weights (the 4 eager Inter weights load at the top).
  // Literal specifiers so Vite emits each as its own chunk; allSettled
  // swallows any individual failure.
  Promise.allSettled([
    import('@fontsource/inter/300.css'),
    import('@fontsource/inter/800.css'),
    import('@fontsource/space-grotesk/400.css'),
    import('@fontsource/space-grotesk/500.css'),
    import('@fontsource/space-grotesk/600.css'),
    import('@fontsource/space-grotesk/700.css'),
    import('@fontsource/instrument-serif/400.css'),
    import('@fontsource/instrument-serif/400-italic.css'),
    import('@fontsource/playfair-display/400.css'),
    import('@fontsource/playfair-display/600.css'),
    import('@fontsource/playfair-display/700.css'),
    import('@fontsource/jetbrains-mono/400.css'),
    import('@fontsource/jetbrains-mono/500.css'),
    import('@fontsource/jetbrains-mono/600.css'),
  ])
}, { timeout: 2000 })

// Safety net for the boot skeleton (#boot-skeleton, sibling of #root).
// lazy-with-retry dismisses it when the first lazy route chunk resolves —
// that covers the authenticated cold-load path. But the AuthGate password
// screen (prod, unauthenticated users) renders BEFORE any lazy chunk fires,
// and a fatal early error would leave the skeleton stuck on top of the
// AppErrorBoundary fallback. 8 seconds is enough headroom for a slow 3G
// initial chunk; after that, hand off to whatever React has rendered.
setTimeout(dismissBootSkeleton, 8000)

// Capture PWA install prompt early (before React mounts) so the Header can use it
window.__pwaInstallPrompt = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  window.__pwaInstallPrompt = e
})

// Capture referral code from URL parameter (?ref=CODE) before React mounts
;(() => {
  const params = new URLSearchParams(window.location.search)
  const ref = params.get('ref')
  if (ref) {
    localStorage.setItem('spectre-referral-code', ref.trim())
    params.delete('ref')
    const clean = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (clean ? '?' + clean : ''))
  }
})()

// Upgrade legacy scattered spectre-* localStorage keys into unified Zustand store format
upgradeSettingsStorage()

class AppErrorBoundary extends React.Component {
  state = { hasError: false, error: null }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    console.error('App failed to render:', error, info)
    // Skeleton sits at z-index 2147483646 — pull it down so the user can
    // see the error UI instead of a frozen skeleton for 8s.
    dismissBootSkeleton()
    try {
      track(Events.ERROR, {
        error_type: 'react_crash',
        error_message: error?.message || String(error),
        page_url: window.location.href,
      })
    } catch (_) { /* analytics should never break the app */ }
  }
  render() {
    if (this.state.hasError) {
      const err = this.state.error
      const message = err?.message || String(err)
      const stack = err?.stack || ''
      return (
        <div style={{
          minHeight: '100vh',
          background: '#fef3c7',
          color: '#1f2937',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
          zIndex: 99999,
        }}>
          <h1 style={{ marginBottom: 8, fontSize: '1.5rem' }}>Something went wrong</h1>
          <p style={{ color: '#374151', marginBottom: 8 }}>
            The app failed to load. Try refreshing the page.
          </p>
          {message && (
            <pre style={{ fontSize: 12, background: 'rgba(0,0,0,0.06)', padding: 12, borderRadius: 8, maxWidth: '90%', overflow: 'auto', marginBottom: 16, textAlign: 'left' }}>
              {message}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 24px',
              background: '#8B5CF6',
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// PR-1 (perf): the entry stylesheet is loaded non-render-blocking in prod
// (media="print" swap injected at build time - see nonBlockingEntryCss in
// vite.config.js) so the boot skeleton paints at TTFB. React should not mount
// long before that CSS has loaded, but a 3s cap keeps mount from deadlocking -
// mounting unstyled is SAFE now because dismissBootSkeleton (lazy-with-retry)
// holds the skeleton over the app until the CSS is genuinely on. One shared
// implementation: whenEntryCssLoaded in lib/lazy-with-retry.js.
const waitForEntryCss = () => whenEntryCssLoaded(3000)

const rootEl = document.getElementById('root')
if (!rootEl) {
  document.body.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0c;color:#fff;font-family:system-ui">No #root element. Check index.html.</div>'
} else {
  try {
    // PrivyBoundary owns the wallet-stack mount decision now: it lazy-loads
    // the real PrivyProvider after first paint, and internally no-ops when the
    // app id is unset (dev without keys) or when iframed in showcase mode
    // (Privy's auth iframe refuses to load grand-nested in the spectreai.io
    // demo, throwing "Frame ancestor is not allowed"). Until it mounts, the
    // tree runs on the usePrivySafe() stub. See lib/privy-boundary.jsx.
    const appTree = (
      <PrivyBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </PrivyBoundary>
    )

    // PR-3 (perf): start downloading the current route's lazy chunk NOW, in
    // parallel with the AuthGate cookie check. Without this the route chunk
    // only starts fetching after the gate check resolves and React commits -
    // a full serialized round-trip on every cold load.
    Promise.all([
      import('@/lib/route-prefetch'),
      import('@/constants/pageRoutes'),
    ]).then(([{ prefetchRoute }, { getPageIdFromPath }]) => {
      const pageId = getPageIdFromPath(window.location.pathname)
      if (pageId) prefetchRoute(pageId)
    }).catch(() => { /* prefetch is best-effort */ })

    waitForEntryCss().then(() => {
      ReactDOM.createRoot(rootEl).render(
        <React.StrictMode>
          <AppErrorBoundary>
            <HelmetProvider>
              {appTree}
            </HelmetProvider>
          </AppErrorBoundary>
        </React.StrictMode>
      )
    })
  } catch (err) {
    console.error('App failed to mount:', err)
    dismissBootSkeleton()
    rootEl.innerHTML = `<div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fef3c7;color:#1f2937;font-family:system-ui;padding:24;text-align:center;">
      <h1 style="margin-bottom:8;">Failed to start app</h1>
      <p style="margin-bottom:16;">${(err && err.message) || String(err)}</p>
      <button onclick="location.reload()" style="padding:12px 24px;background:#8B5CF6;border:none;border-radius:8;color:#fff;font-weight:600;cursor:pointer;">Reload</button>
    </div>`
  }
}
