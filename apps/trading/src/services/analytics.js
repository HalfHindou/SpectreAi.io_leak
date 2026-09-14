/**
 * Centralized PostHog analytics module for the Trading app.
 * All event tracking goes through this module - never import posthog-js directly.
 *
 * PERF (2026-06-08): posthog-js (~340KB raw) is dynamically imported and
 * initialized on idle instead of statically at boot - it was riding the
 * critical main chunk and its init ran before ReactDOM.createRoot. Every
 * exported function keeps its signature; calls made before the SDK loads
 * are queued (capped) and flushed in order on init, and a pagehide /
 * tab-hidden listener force-starts the SDK so short bounce sessions still
 * ship their queued events. Do NOT convert the import back to static.
 */

const APP_NAME = 'trading'
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY || ''

// ── Event Name Constants ──
export const Events = {
  SEARCH: 'Search',
  SIGN_IN: 'Sign In',
  TOKEN_VIEWED: 'Token Viewed',
  WATCHLIST_ACTION: 'Watchlist Action',
  SETTINGS_CHANGED: 'Settings Changed',
  CONTENT_SHARED: 'Content Shared',
  CHART_INTERACTION: 'Chart Interaction',
  COMPARE_USED: 'Compare Used',
  PROFILE_UPDATED: 'Profile Updated',
  CINEMA_MODE_TOGGLED: 'Cinema Mode Toggled',
  PWA_INSTALLED: 'PWA Installed',
  SWAP_STARTED: 'Swap Started',
  // Fired by useSwapExecution on on-chain confirmation / failure. These were
  // referenced there WITHOUT being defined here, so live swaps were landing
  // in PostHog as `undefined`-named events - do not remove.
  SWAP_COMPLETED: 'Swap Completed',
  SWAP_FAILED: 'Swap Failed',
  // Generic per-page control tracking (filters, sorts, tabs, toggles).
  // page_area is a super-prop, so {control, value} is enough to answer
  // "which buttons/filters do users click on each page". Use trackUi().
  UI_INTERACTION: 'UI Interaction',
  LAUNCH_AI: 'Launch AI',
  AI_DISMISSED: 'AI Dismissed',
  AI_PROMPT_SENT: 'AI Prompt Sent',
  AI_RESPONSE_SENT: 'AI Response Sent',
  // Spectre Agent (token-page copilot)
  AGENT_OPENED: 'Agent Opened',
  AGENT_CLOSED: 'Agent Closed',
  AGENT_PROMPT_SENT: 'Agent Prompt Sent',
  AGENT_TRADE_PROPOSED: 'Agent Trade Proposed',
  AGENT_TRADE_CONFIRMED: 'Agent Trade Confirmed',
  AGENT_ORDER_PROPOSED: 'Agent Order Proposed',
  AGENT_ORDER_PLACED: 'Agent Order Placed',
  AGENT_ORDER_CANCELLED: 'Agent Order Cancelled',
  AGENT_SIGNER_ENABLED: 'Agent Signer Enabled',
  AGENT_SIGNER_REVOKED: 'Agent Signer Revoked',
  AGENT_BRIEF_SHOWN: 'Agent Brief Shown',
  AGENT_VOICE_OPTIN: 'Agent Voice Opt-In',
  AGENT_VOICE_PLAYED: 'Agent Voice Played',
  AGENT_VOICE_SESSION: 'Agent Voice Session',
  AGENT_VOICE_SYNC: 'Agent Voice Sync',
  AGENT_WAKE_WORD: 'Agent Wake Word',
  ERROR: 'Error',
}

// Track timed events (start time stored here, duration computed on capture)
const _timedEvents = new Map()

// ── Deferred SDK state ──
let _ph = null            // the loaded posthog instance (null until init completes)
let _startPromise = null  // in-flight dynamic import + init
const _pending = []       // queued calls made before the SDK loaded
const _PENDING_CAP = 20

/** Run fn now if the SDK is ready, else queue it (FIFO, capped). */
function withPh(fn) {
  if (_ph) {
    try { fn(_ph) } catch (_) { /* analytics must never break the app */ }
    return
  }
  if (_pending.length < _PENDING_CAP) _pending.push(fn)
}

function detectPlatform() {
  const ua = navigator.userAgent
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) return 'tablet'
  if (/Android/.test(ua) && !/Mobile/.test(ua)) return 'tablet'
  if (/Mobi|iPhone|iPod/.test(ua)) return 'mobile'
  return 'desktop'
}

const EVM_ADDR_RE = /0x[a-fA-F0-9]{40}/g
const SOL_ADDR_RE = /\/[1-9A-HJ-NP-Za-km-z]{32,44}(?=\/|$|\?|#)/g

function scrubAddresses(value) {
  if (typeof value !== 'string') return value
  return value
    .replace(EVM_ADDR_RE, '[addr]')
    .replace(SOL_ADDR_RE, '/[addr]')
}

function sanitizeProperties(props) {
  if (!props || typeof props !== 'object') return props
  const out = { ...props }
  for (const k of ['$current_url', '$pathname', '$referrer', '$host', '$initial_current_url', '$initial_pathname', '$initial_referrer']) {
    if (typeof out[k] === 'string') out[k] = scrubAddresses(out[k])
  }
  if (typeof out.query === 'string') {
    out.query_len = out.query.length
    delete out.query
  }
  return out
}

/** Dynamic-import posthog-js and initialize it. Idempotent. */
function start() {
  if (_startPromise || _ph) return _startPromise
  _startPromise = import('posthog-js').then(({ default: posthog }) => {
    posthog.init(POSTHOG_KEY, {
      // Same-origin reverse proxy (see vercel.json /ingest rewrite). Routes
      // capture through trade.spectreai.io/ingest -> PostHog cloud so
      // ad-blockers (uBlock/Brave/AdGuard) that block us.i.posthog.com
      // directly cannot drop our beta users' events. ui_host keeps
      // PostHog deep-links (session replay etc) pointing at the real domain.
      api_host: '/ingest',
      ui_host: 'https://us.posthog.com',
      persistence: 'localStorage',
      autocapture: false,
      mask_all_text: true,
      capture_pageview: 'history_change',  // auto-track SPA route changes
      capture_pageleave: true,
      capture_performance: true,           // web vitals (LCP, FID, CLS)
      sanitize_properties: sanitizeProperties,
      loaded: (ph) => {
        let userId = localStorage.getItem('spectre-user-id')
        if (!userId) {
          userId = 'spectre-' + crypto.randomUUID()
          localStorage.setItem('spectre-user-id', userId)
        }
        ph.identify(userId)

        // Group analytics - compare research vs trading in PostHog dashboards
        ph.group('app', APP_NAME, {
          name: 'Spectre Trading',
          type: 'web',
        })

        const platform = detectPlatform()
        const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'

        // Super properties - attached to every event automatically.
        // embed_context separates real trade.spectreai.io tabs ('top') from
        // the research app's /token iframe and the marketing showcase
        // ('iframe') so dashboards can segment - unlike research we keep
        // tracking iframe loads, because the /token embed IS the AI
        // Screener product experience.
        let embedContext = 'top'
        try {
          if (window.self !== window.top) embedContext = 'iframe'
        } catch (_) { embedContext = 'iframe' }
        ph.register({
          app: APP_NAME,
          app_version: appVersion,
          platform,
          surface: 'trading-app',
          embed_context: embedContext,
        })

        // First-touch properties (only set once, never overwritten)
        ph.setPersonProperties({}, {
          first_created: new Date().toISOString(),
          first_landing_page: window.location.pathname,
          first_referrer: document.referrer || 'direct',
          first_platform: platform,
          first_app_version: appVersion,
        })

        // Last-touch properties (updated every visit)
        ph.setPersonProperties({
          last_seen: new Date().toISOString(),
          app: APP_NAME,
          app_version: appVersion,
          platform,
        })

        // SDK ready - flush calls queued during the deferred window, in order.
        _ph = ph
        while (_pending.length) {
          const fn = _pending.shift()
          try { fn(ph) } catch (_) { /* never break the app */ }
        }
      },
    })
  }).catch(() => { /* analytics unavailable - app unaffected */ })
  return _startPromise
}

/** Initialize PostHog - call once from main.jsx. Defers the SDK to idle. */
export function init() {
  if (!POSTHOG_KEY) {
    // Analytics disabled when no key configured
    return
  }

  // Idle-defer the SDK load so it never competes with the token page's
  // critical path (bundle parse, snapshot fetch, chart boot).
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => start(), { timeout: 4000 })
  } else {
    setTimeout(() => start(), 2000)
  }

  // Bounce protection: if the user leaves before idle fires, start
  // immediately so queued events still ship via capture_pageleave/flush.
  const forceStart = () => start()
  window.addEventListener('pagehide', forceStart, { once: true })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') forceStart()
  }, { once: true })
}

/** Track an event with dev logging */
export function track(eventName, props = {}) {
  try {
    // Attach duration if this was a timed event (computed at call time,
    // not flush time, so queued events keep accurate durations)
    const startTime = _timedEvents.get(eventName)
    if (startTime) {
      props.$duration = ((Date.now() - startTime) / 1000).toFixed(2)
      _timedEvents.delete(eventName)
    }
    withPh((ph) => ph.capture(eventName, props))
  } catch (_) { /* analytics must never break the app */ }
}

/**
 * Track a generic UI control interaction (filter, sort, tab, toggle).
 * page_area super-prop identifies the page; {control, value} identify the
 * control. Example: trackUi('chain_filter', 'solana')
 */
export function trackUi(control, value, extra = {}) {
  track(Events.UI_INTERACTION, { control, value, ...extra })
}

/** Set user profile properties (overwrites existing) */
export function setUserProps(props) {
  withPh((ph) => ph.setPersonProperties(props))
}

/** Set user profile properties only if not already set */
export function setUserPropsOnce(props) {
  withPh((ph) => ph.setPersonProperties({}, props))
}

/** Increment a numeric user profile property (tracked as event for PostHog aggregation) */
export function incrementUserProp(prop, by = 1) {
  withPh((ph) => ph.capture('$increment', { [prop]: by }))
}

/** Register super properties (attached to all future events) */
export function registerSuperProps(props) {
  withPh((ph) => ph.register(props))
}

/**
 * Set the `page_area` super-property — a human-readable label for the
 * current view so PostHog reports show `trading_terminal` /
 * `trading_discover` / `trading_dashboard` instead of raw hash values.
 * Called from App.jsx whenever currentView changes.
 */
export function setPageArea(area) {
  withPh((ph) => ph.register({ page_area: area }))
}

/** Update theme as super property + user profile */
export function updateThemeSuperProp(theme) {
  withPh((ph) => {
    ph.register({ theme })
    ph.setPersonProperties({ preferred_theme: theme })
  })
}

/** Start a timer for an event - duration auto-captured when track() fires */
export function timeEvent(eventName) {
  _timedEvents.set(eventName, Date.now())
}

/** Reset PostHog state (call on sign-out) */
export function reset() {
  try {
    _timedEvents.clear()
    withPh((ph) => ph.reset())
  } catch (_) { console.error(_) }
}
