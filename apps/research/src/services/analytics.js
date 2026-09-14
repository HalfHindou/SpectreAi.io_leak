/**
 * Centralized PostHog analytics module for the Research app.
 * All event tracking goes through this module - never import posthog-js directly.
 *
 * PR-2 (perf): posthog-js is dynamic-imported inside init() instead of a
 * top-level import. The static import bundled ~55KB gz into the entry chunk
 * even though init() was already idle-deferred in main.jsx. Calls that fire
 * before the SDK finishes loading are queued (capped) and flushed after init
 * so no early events are lost; analytics must never block or break boot.
 */
const APP_NAME = 'research'
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY || ''

// Loaded SDK instance (null until init()'s dynamic import resolves)
let _ph = null
// Ops queued before the SDK is ready: array of (ph) => void, capped.
const _pendingOps = []
const MAX_PENDING_OPS = 100

// Run an operation against the SDK now, or queue it until init() completes.
// No key configured -> analytics disabled -> drop silently (never queue).
function _call(op) {
  if (_ph) {
    try { op(_ph) } catch (_) { /* analytics must never break the app */ }
    return
  }
  if (!POSTHOG_KEY) return
  if (_pendingOps.length < MAX_PENDING_OPS) _pendingOps.push(op)
}

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
  // Generic per-page control tracking (filters, sorts, tabs, toggles).
  // page_area is a super-prop, so {control, value} is enough to answer
  // "which buttons/filters do users click on each page". Use trackUi().
  UI_INTERACTION: 'UI Interaction',
  LAUNCH_AI: 'Launch AI',
  AI_DISMISSED: 'AI Dismissed',
  AI_PROMPT_SENT: 'AI Prompt Sent',
  AI_RESPONSE_SENT: 'AI Response Sent',
  ERROR: 'Error',
  // X-Dash (social intelligence dashboard at /x-dash) — per-page beta
  // tracking. autocapture is off, so these explicit events are the only
  // way to see which views, filters, tokens and creators testers engage.
  XDASH_VIEWED: 'X-Dash Viewed',
  XDASH_VIEW_CHANGED: 'X-Dash View Changed',
  XDASH_FILTER_CHANGED: 'X-Dash Filter Changed',
  XDASH_TOKEN_OPENED: 'X-Dash Token Opened',
  XDASH_AUTHOR_OPENED: 'X-Dash Author Opened',
  XDASH_SEARCHED: 'X-Dash Searched',
  XDASH_REFRESHED: 'X-Dash Refreshed',
  XDASH_DRAWER_FULLSCREEN: 'X-Dash Drawer Fullscreen Toggled',
  // Website surface (legacy /website2 + /lp routes in this app — real
  // marketing traffic goes to spectre-website repo at spectreai.io)
  WEBSITE_SECTION_VIEWED: 'Website Section Viewed',
  WEBSITE_SECTION_DWELL: 'Website Section Dwell',
  WEBSITE_CTA_CLICKED: 'Website CTA Clicked',
  WEBSITE_VIDEO_EVENT: 'Website Video Event',
  WEBSITE_DEMO_INTERACTED: 'Website Demo Interacted',
  WEBSITE_PRICING_VIEWED: 'Website Pricing Viewed',
  WEBSITE_BETA_INTEREST: 'Website Beta Interest',
  WEBSITE_BETA_SUBMITTED: 'Website Beta Submitted',
  WEBSITE_SCROLL_DEPTH: 'Website Scroll Depth',
  WEBSITE_EXTERNAL_CLICK: 'Website External Click',
  WEBSITE_NAV_CLICKED: 'Website Nav Clicked',
  // Spectre LITE (RAW beta at /lite) — explicit per-surface events so the
  // beta tells us which of the 21 tabs, looks and knobs people actually use.
  LITE_VIEWED: 'Lite Viewed',
  LITE_TAB_CHANGED: 'Lite Tab Changed',
  LITE_LOOK_CHANGED: 'Lite Look Changed',
  LITE_ZOOM_TOGGLED: 'Lite Zoom Toggled',
  LITE_THEME_CHANGED: 'Lite Theme Changed',
  LITE_PRO_DOOR: 'Lite PRO Door Clicked',
  LITE_BETA_ACK: 'Lite Beta Acknowledged',
  LITE_FEEDBACK_CLICKED: 'Lite Feedback Clicked',
}

// Track timed events (start time stored here, duration computed on capture)
const _timedEvents = new Map()

function detectPlatform() {
  const ua = navigator.userAgent
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) return 'tablet'
  if (/Android/.test(ua) && !/Mobile/.test(ua)) return 'tablet'
  if (/Mobi|iPhone|iPod/.test(ua)) return 'mobile'
  return 'desktop'
}

// Replace anything that looks like a wallet or token contract address with
// a fixed placeholder so PostHog never stores per-user identifiers correlated
// to on-chain graphs.
const EVM_ADDR_RE = /0x[a-fA-F0-9]{40}/g
const SOL_ADDR_RE = /\/[1-9A-HJ-NP-Za-km-z]{32,44}(?=\/|$|\?|#)/g

function scrubAddresses(value) {
  if (typeof value !== 'string') return value
  return value
    .replace(EVM_ADDR_RE, '[addr]')
    .replace(SOL_ADDR_RE, '/[addr]')
}

// PostHog calls this for every event before it goes over the wire.
// Scrub addresses out of URL-like fields; strip user-typed query text.
function sanitizeProperties(props) {
  if (!props || typeof props !== 'object') return props
  const out = { ...props }
  for (const k of ['$current_url', '$pathname', '$referrer', '$host', '$initial_current_url', '$initial_pathname', '$initial_referrer']) {
    if (typeof out[k] === 'string') out[k] = scrubAddresses(out[k])
  }
  // Raw user-typed search text is a privacy footgun; keep only the length.
  if (typeof out.query === 'string') {
    out.query_len = out.query.length
    delete out.query
  }
  return out
}

/**
 * Detect how this page is being loaded. The marketing site at spectreai.io
 * embeds this app as its "live demo" iframe (?embed=showcase&demo=true) -
 * that traffic is WEBSITE visitors watching a demo, not Research users, and
 * it inflated Research MAU ~5x (2,037 of 3,144 "visitors" in the first 30
 * beta days were the demo iframe). The website's own analytics already
 * track the demo section (Website Demo Interacted), so here we skip
 * PostHog entirely for showcase loads and tag any OTHER iframe embed with
 * an `embed_context` super-prop so dashboards can segment it.
 */
function detectEmbedContext() {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('embed') === 'showcase' || params.get('demo') === 'true') return 'showcase'
    if (window.self !== window.top) return 'iframe'
  } catch (_) {
    // cross-origin frame access throws - that IS an iframe
    return 'iframe'
  }
  return 'top'
}

/** Initialize PostHog - call once from main.jsx */
export async function init() {
  if (!POSTHOG_KEY || _ph) {
    // analytics disabled (no key) or already initialized
    return
  }

  const embedContext = detectEmbedContext()
  if (embedContext === 'showcase') {
    // Marketing demo iframe - do not track as Research traffic at all.
    _pendingOps.length = 0
    return
  }

  let posthog
  try {
    ({ default: posthog } = await import('posthog-js'))
  } catch (_) {
    // chunk failed (offline, ad-blocker, stale deploy) - analytics degrades
    // silently; the app must never notice.
    _pendingOps.length = 0
    return
  }

  posthog.init(POSTHOG_KEY, {
    // Same-origin reverse proxy (see vercel.json /ingest rewrite). Routes
    // capture through app.spectreai.io/ingest -> PostHog cloud so
    // ad-blockers (uBlock/Brave/AdGuard) that block us.i.posthog.com
    // directly cannot drop our beta users' events. ui_host keeps
    // PostHog deep-links (session replay etc) pointing at the real domain.
    api_host: '/ingest',
    ui_host: 'https://us.posthog.com',
    persistence: 'localStorage',
    // Autocapture off: we only want events we explicitly track(). Autocapture
    // would otherwise record click text, form field labels, and other content
    // that can contain user-typed data or PII.
    autocapture: false,
    // Belt and suspenders: if autocapture is ever re-enabled, mask DOM text.
    mask_all_text: true,
    capture_pageview: 'history_change',  // auto-track SPA route changes via React Router
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
        name: 'Spectre Research',
        type: 'web',
      })

      const platform = detectPlatform()
      const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'

      // Super properties - attached to every event automatically.
      // `surface` defaults to 'research-app' here so the very first events
      // (the $pageview fired during init, before SurfaceTracker's route
      // effect runs) aren't tagged surface=null. SurfaceTracker in App.jsx
      // overrides to 'website' on the legacy marketing routes (/lp, /website).
      ph.register({
        app: APP_NAME,
        app_version: appVersion,
        platform,
        surface: 'research-app',
        // 'top' for a normal browser tab; 'iframe' when embedded somewhere
        // other than the marketing showcase (which skips tracking entirely).
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
    },
  })

  _ph = posthog
  // Flush ops queued while the SDK chunk was downloading (in order).
  const pending = _pendingOps.splice(0, _pendingOps.length)
  for (const op of pending) {
    try { op(_ph) } catch (_) { /* ignore */ }
  }
}

/** Track an event with dev logging */
export function track(eventName, props = {}) {
  if (import.meta.env.DEV) {
    // dev analytics logging disabled
  }
  // Attach duration if this was a timed event (resolved at call time so a
  // queued capture still carries the duration measured when track() fired)
  const startTime = _timedEvents.get(eventName)
  if (startTime) {
    props.$duration = ((Date.now() - startTime) / 1000).toFixed(2)
    _timedEvents.delete(eventName)
  }
  _call((ph) => ph.capture(eventName, props))
}

/**
 * Track a generic UI control interaction (filter, sort, tab, toggle).
 * page_area super-prop identifies the page; {control, value} identify the
 * control. Example: trackUi('heatmap_timeframe', '7d')
 */
export function trackUi(control, value, extra = {}) {
  track(Events.UI_INTERACTION, { control, value, ...extra })
}

/** Set user profile properties (overwrites existing) */
export function setUserProps(props) {
  _call((ph) => ph.setPersonProperties(props))
}

/** Set user profile properties only if not already set */
export function setUserPropsOnce(props) {
  _call((ph) => ph.setPersonProperties({}, props))
}

/** Increment a numeric user profile property (tracked as event for PostHog aggregation) */
export function incrementUserProp(prop, by = 1) {
  _call((ph) => ph.capture('$increment', { [prop]: by }))
}

/** Register super properties (attached to all future events) */
export function registerSuperProps(props) {
  _call((ph) => ph.register(props))
}

/**
 * Set the current surface super property so all subsequent events are
 * tagged as `website` / `research-app` / `trading-app`. Called from
 * App.jsx when the route changes.
 */
export function setSurface(surface) {
  _call((ph) => ph.register({ surface }))
}

/**
 * Set the `page_area` super-property — a human-readable label for the
 * current route so PostHog reports show `app_home` / `app_research_zone`
 * / `website_landing_page` instead of raw `$pathname` values.
 * Called from App.jsx on every route change.
 */
export function setPageArea(area) {
  _call((ph) => ph.register({ page_area: area }))
}

/** Update theme as super property + user profile */
export function updateThemeSuperProp(theme) {
  _call((ph) => {
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
  _timedEvents.clear()
  _pendingOps.length = 0
  _call((ph) => ph.reset())
}
