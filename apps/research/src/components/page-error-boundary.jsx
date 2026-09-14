import React from 'react'
import { useLocation } from 'react-router-dom'
import { getPageIdFromPath } from '@/constants/pageRoutes'
import {
  isChunkLoadError as isSharedChunkLoadError,
  CHUNK_RECOVER_KEY,
  MAX_CHUNK_RECOVER_ATTEMPTS,
  getMirrorUrl,
  isOnMirror,
} from '@/lib/chunk-recovery'

/**
 * Page-level error boundary — catches errors in individual pages
 * so the rest of the app (sidebar, header) stays functional.
 *
 * Exported default is wrapped with a location-keyed reset so the boundary
 * state CLEARS on every navigation. Without this, a single page crash
 * would leave the "Try again" UI stuck across every page until the user
 * manually clicked it, masking the next page entirely and producing the
 * "spurious errors during navigation" symptom Sunny reported.
 */

// Stale-chunk detection. Delegates to the SHARED matcher in chunk-recovery.js
// (the single source of truth — it covers every browser's phrasing, incl.
// Firefox's "error loading dynamically imported module" which a stale local
// copy here used to miss → Firefox users got the dead-end "Try again" card
// after a deploy instead of the auto-recover) plus the React-lazy
// missing-default-export shapes the SW can produce.
function isChunkLoadError(error) {
  if (isSharedChunkLoadError(error)) return true
  const msg = error?.message || ''
  const name = error?.name || ''
  return msg.includes('MIME type') ||
    // React's lazy() machinery throws this when the resolved module is missing
    // its default export — happens when the PWA service worker serves a stale
    // chunk that no longer matches the current code shape.
    msg.includes('_result.default') ||
    (msg.includes('_result') && name === 'TypeError') ||
    // React 18's lazyInitializer does `return moduleObject.default` — when a
    // dynamic import resolves to `undefined` (stale/mismatched chunk), V8 throws
    // "Cannot read properties of undefined (reading 'default')" and Firefox
    // "can't access property \"default\", moduleObject is undefined".
    (name === 'TypeError' && /reading 'default'|can't access property "default"|undefined is not an object \(evaluating '[^']*\.default/.test(msg)) ||
    // Safari minified variant of the same error
    msg.includes("undefined is not an object (evaluating 'e._result")
}

/**
 * Manual-reload marker. Set when the user presses the visible Reload button,
 * read back if the SAME chunk error surfaces again within the TTL. A recent
 * marker means purge + cache-bust reload did NOT fix it — so the failure is
 * not a stale deploy at all (Cloudflare/WAF blocking the asset request for
 * VPN/flagged IPs, a firewall, an ad-blocker, a captive portal). In that
 * state "New version available" is a lie and reloading is a treadmill; we
 * show the honest network-blocked copy instead. TTL-stamped so a genuine
 * stale-deploy error weeks later in the same tab gets the normal copy.
 */
const MANUAL_RELOAD_KEY = '__spectre_chunk_manual_reload'
const MANUAL_RELOAD_TTL_MS = 10 * 60 * 1000
function wasManualReloadRecent() {
  try {
    const t = Number(sessionStorage.getItem(MANUAL_RELOAD_KEY) || 0)
    return t > 0 && Date.now() - t < MANUAL_RELOAD_TTL_MS
  } catch (_) { return false }
}

/**
 * Hard reload - bypass HTTP cache AND purge PWA caches + service workers.
 * A soft reload() keeps stale Vite chunks alive; this one doesn't.
 * Tracking moved to sessionStorage so the user's URL stays clean (was ?_reload /
 * ?_chunkrecover / ?_cbust which polluted history + back-button).
 */
async function hardReloadAndPurge() {
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
  // Max out the auto-retry budget instead of clearing it. Clearing re-armed
  // the 2 silent auto-reloads, so when the chunk failure was NOT staleness
  // (network/WAF block) every Reload press became reload -> auto-reload ->
  // auto-reload -> same card: the "screen skips and can't open" loop. With
  // the budget spent, a still-failing chunk surfaces the card immediately
  // after ONE reload, and the marker below switches it to honest copy.
  try {
    sessionStorage.setItem(CHUNK_RECOVER_KEY, String(MAX_CHUNK_RECOVER_ATTEMPTS))
    sessionStorage.setItem(MANUAL_RELOAD_KEY, String(Date.now()))
  } catch (_) { /* ignore */ }
  // SW + Cache Storage are wiped, but the browser's HTTP cache may still
  // hold a stale index.html that references dead chunk hashes (the actual
  // failure mode seen in prod: index-XXXX.js 404s because the cached HTML
  // is from a previous deploy). Cache-bust the document fetch so the next
  // request goes all the way to origin. _cbust is stripped by main.jsx's
  // IIFE on the next boot so the URL stays clean.
  cacheBustReload()
}

function cacheBustReload() {
  try {
    const u = new URL(window.location.href)
    u.searchParams.set('_cbust', String(Date.now()))
    window.location.replace(u.toString())
  } catch (_) {
    window.location.reload()
  }
}

// Auto-reload attempts are tracked in sessionStorage (per-tab, survives reload)
// instead of the URL so the user never sees ?_chunkrecover in their address bar
// or back-button history. sessionStorage survives window.location.reload().
// CHUNK_RECOVER_KEY is imported from chunk-recovery.js — same counter the
// main.jsx handlers and lazy-with-retry bump.
function getChunkRecoverAttempt() {
  try { return Number(sessionStorage.getItem(CHUNK_RECOVER_KEY) || 0) } catch (_) { return 0 }
}

async function autoRecoverFromStaleChunk() {
  const attempt = getChunkRecoverAttempt()
  try { sessionStorage.setItem(CHUNK_RECOVER_KEY, String(attempt + 1)) } catch (_) { /* ignore */ }
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
  // Same cache-bust as hardReloadAndPurge — the visible bug was the boundary
  // reloading via plain reload() and getting served the same cached stale
  // index.html, exhausting its 2 retries to land on this UI.
  cacheBustReload()
}

class PageErrorBoundary extends React.Component {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[PageError]', error, info?.componentStack)
    if (!isChunkLoadError(error)) return
    // Auto-recover from stale-chunk errors on the FIRST hit. main.jsx's
    // vite:preloadError listener only fires when the chunk fetch itself
    // errors (404); when the service worker hands back a cached-but-mismatched
    // chunk, React throws inside lazy() and main.jsx never sees it. So we
    // own that recovery here. Up to 2 auto-retries (URL-tracked), then we
    // surface the visible UI so the user can decide.
    const attempt = getChunkRecoverAttempt()
    if (attempt >= 2) {
      console.error('[PageError] chunk error at max auto-retries - surfacing UI')
      return
    }
    console.warn(`[PageError] chunk error detected (attempt ${attempt + 1}/2) - auto-purging SW caches and reloading`)
    autoRecoverFromStaleChunk() // navigates away, this component never re-renders
  }

  render() {
    if (this.state.hasError) {
      const isStaleChunk = isChunkLoadError(this.state.error)
      // A manual purge+reload just happened and the chunk STILL failed:
      // this is a blocked request (VPN/firewall/ad-blocker/WAF), not a
      // stale deploy. Say so instead of promising a new version again,
      // and offer the mirror (same deployment, direct Vercel origin,
      // bypasses the blocking CDN layer) as a one-click way out.
      const isBlockedFetch = isStaleChunk && wasManualReloadRecent()
      const offerMirror = isBlockedFetch && !isOnMirror()
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 400,
          padding: 32,
          textAlign: 'center',
        }}>
          <div style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
            padding: '32px 40px',
            maxWidth: 420,
          }}>
            <h2 style={{ color: '#f5f5f7', fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
              {isBlockedFetch
                ? 'Still can\'t load this section'
                : isStaleChunk ? 'New version available' : 'Something went wrong'}
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, marginBottom: 20, lineHeight: 1.5 }}>
              {isBlockedFetch
                ? offerMirror
                  ? 'Reloading didn\'t fix it, so this isn\'t an outdated version. Something between you and our servers - a VPN, ad blocker, firewall, or network filter - is blocking the app\'s files. Open the backup version to keep working (you may need to sign in again), or turn off your VPN and reload.'
                  : 'Reloading didn\'t fix it. Something on your connection - a VPN, ad blocker, or firewall - is blocking the app\'s files. Try turning off your VPN or switching networks, then reload.'
                : isStaleChunk
                  ? 'A new version was deployed. Reload to get the latest.'
                  : 'This section encountered an error. The rest of the app is still working.'}
            </p>
            {!isStaleChunk && this.state.error && (
              <p style={{ color: 'rgba(239,68,68,0.8)', fontSize: 11, marginBottom: 16, lineHeight: 1.4, fontFamily: 'monospace', wordBreak: 'break-all', textAlign: 'left', background: 'rgba(239,68,68,0.06)', padding: '8px 12px', borderRadius: 6 }}>
                {this.state.error.name}: {this.state.error.message}
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              {offerMirror && (
                <button
                  onClick={() => { try { window.location.replace(getMirrorUrl()) } catch (_) { /* ignore */ } }}
                  style={{
                    padding: '10px 24px',
                    background: 'rgba(255,255,255,0.14)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: 10,
                    color: '#f5f5f7',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Open backup version
                </button>
              )}
              <button
                onClick={() => isStaleChunk ? hardReloadAndPurge() : this.setState({ hasError: false, error: null })}
                style={{
                  padding: '10px 24px',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 10,
                  color: '#f5f5f7',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {isBlockedFetch ? 'Reload again' : isStaleChunk ? 'Reload' : 'Try again'}
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// Wrapper that resets the boundary on every pathname change. Keying a
// component by its key prop forces React to unmount + remount it, which
// clears `state.hasError`. Cheap and explicit — no useEffect dance.
//
// EXCEPTION: the /x-dash tree keys once for the WHOLE page. Its sub-routes
// (/x-dash/token/:id drawer, /x-dash/author/:id, kol profile) are overlays
// over ONE mounted board - a per-pathname key remounted the entire page on
// every row click, throwing the scroll to the top and repainting everything
// before the drawer opened. Every other page keeps the per-pathname reset.
function PageErrorBoundaryWithReset(props) {
  const location = useLocation()
  const key = getPageIdFromPath(location.pathname) === 'x-dash' ? 'x-dash' : location.pathname
  return <PageErrorBoundary key={key} {...props} />
}

export default PageErrorBoundaryWithReset
