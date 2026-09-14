/**
 * Spectre AI Trading Platform - Main entry point
 */
// MUST stay the FIRST import - see lib/buffer-polyfill.js for the ESM
// evaluation-order contract that makes the privy-vendor chunk split safe.
import './lib/buffer-polyfill'

import './lib/glassScrollbars'
import React from 'react'
import ReactDOM from 'react-dom/client'
import PrivyBoundary from './lib/privy-boundary'
import { init } from './services/analytics'
import App from './App'
import { installDemoFetchHeader, expectDemoToken } from './services/demoSession'
import { whenIdle } from './utils/whenIdle'
import './index.css'

// i18n is idle-deferred: the locale stack (i18next + react-i18next + 20 JSON
// bundles, ~2MB raw) was the single largest slice of the critical main chunk
// and the app has zero useTranslation consumers today. See the deferred-init
// contract in src/i18n/index.js before adding translated components.
whenIdle(() => import('./i18n'), { timeout: 3000 })

// Initialize centralized analytics
init()

// Privy modal UX customizations (email tile auto-expand + wallet list scroll) now
// run inside the lazy privy-provider chunk (lib/privy-provider-lazy.jsx) — the
// observers only matter once the Privy modal can appear, i.e. after the SDK
// mounts. Keeping applyPrivyModalHacks off the entry keeps the wallet stack off
// the boot path.

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

// Trading Lite embed (research /token iframe): install the demo-session header
// transport SYNCHRONOUSLY, before any module-load fetch (the deep-link prefetch
// below, the left-panel screener, etc.), so boot-time read-only /api GETs
// retry-on-401 once research postMessages the demo token (SEC-20260521-DEMOTOKEN-R2).
// Inert for standalone trading (no token ever arrives). App.jsx re-calls these
// when embedded - idempotent.
if (new URLSearchParams(window.location.search).get('embedded') === 'true') {
  installDemoFetchHeader()
  expectDemoToken()
}

// Early prefetch for deep-link tokens - fires before React tree mounts
;(() => {
  const hashMatch = window.location.hash.match(/^#token\/(.+)$/)
  if (!hashMatch) return
  const addr = decodeURIComponent(hashMatch[1])
  const isAddress = (addr.startsWith('0x') && addr.length === 42) ||
                    (addr.length >= 32 && addr.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(addr))
  if (!isAddress) return
  // GP6: when the index.html boot script fired the aggregate snapshot for
  // this address (window.__SPECTRE_BOOT) WITHOUT a direct-bars handoff, the
  // snapshot carries the bars - a separate prefetchChartBars would
  // re-transfer them. When the boot script ALSO fired the direct /api/bars
  // (boot.bars - 2026-08-05, lands 300-500ms before the snapshot's fast
  // phase), prefetchChartBars is exactly its consumer: codexApi.getBars
  // adopts the promise and the result seeds chartBarsCache, which the chart
  // datafeed reads on firstDataRequest. Use the boot's networkId so the
  // adoption guards match (EVM saved-token case is not inferable here).
  const boot = window.__SPECTRE_BOOT
  if (boot?.address === addr.toLowerCase() && !boot.bars) return
  import('./hooks/useCodexData').then(({ prefetchChartBars }) => {
    const networkId = (boot?.address === addr.toLowerCase() && boot.networkId)
      ? boot.networkId
      : ((!addr.startsWith('0x') && addr.length >= 32) ? 1399811149 : 1)
    prefetchChartBars(addr, networkId)
  })
})()

// StrictMode disabled in dev - it double-fires effects which creates/destroys
// EventSource SSE connections faster than the browser can open them, exhausting
// the 6-connection HTTP/1.1 limit and blocking all real-time streams.
// Production builds are unaffected (StrictMode is dev-only anyway).
const Wrapper = import.meta.env.PROD ? React.StrictMode : React.Fragment

// Mount the app wrapped in a Privy host. Default = PrivyBoundary (lazy-mounts the
// real PrivyProvider in a SIBLING branch after first paint; the app boots on a
// safe stub — the wallet stack never touches the boot chunk). The whole Privy SDK
// therefore stays off the critical path (see lib/privy-boundary.jsx +
// use-privy-safe.jsx). PrivyBoundary is SDK-free, so importing it statically is
// safe on the entry path.
function mount(PrivyHost) {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <Wrapper>
      <PrivyHost>
        <App />
      </PrivyHost>
    </Wrapper>
  )
}

// KILL SWITCH: VITE_PRIVY_EAGER=1 restores the old eager-mount behaviour (real
// PrivyProvider wraps the app synchronously). The eager provider chunk is loaded
// ONLY when the flag is set, so its static @privy-io imports never leak onto the
// normal boot path.
if (import.meta.env.VITE_PRIVY_EAGER === '1') {
  import('./lib/privy-provider-eager').then(({ default: EagerPrivyProvider }) => {
    mount(EagerPrivyProvider)
  })
} else {
  mount(PrivyBoundary)
}
