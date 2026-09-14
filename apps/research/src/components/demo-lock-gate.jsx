/**
 * DemoLockGate
 *
 * When the app is embedded on the public marketing site (/website2 iframe),
 * we allow free navigation within a strict allowlist of surfaces and render
 * a "Coming Soon" curtain for everything else.
 *
 * Locked surfaces (allowed):
 *   /                 (landing/home)
 *   /research-zone    (day-mode forced)
 *   /news
 *   /bubbles
 *   /heatmaps
 *   /monarch-chat     (read-only curtain — mission control is locked)
 *   /search-engine
 *
 * Everything else renders a Coming Soon shade that links back to allowed surfaces.
 * Keyboard / devtools / iframe-busting is NOT a security boundary — this is
 * purely a product-shaping layer so the demo shows a curated story.
 */
import { useEffect, useMemo } from 'react'
import { useLocation, Link } from 'react-router-dom'
import useSettingsStore from '@/store/useSettingsStore'
import './demo-lock-gate.css'

const DEMO_PARAM = 'demo'
const DEMO_STORAGE_KEY = 'spectre-demo-locked'

// Surfaces the public demo is allowed to show. Paths are matched by prefix
// so dynamic segments like /research-zone/bitcoin are included.
const ALLOWED_PATHS = [
  '/',
  '/bubbles',
  '/heatmaps',
  '/fear-greed',
  '/economic-calendar',
  '/categories',
  // Mission control (GM dashboard) is allowed to render in locked/read-only
  '/gm-dashboard',
  // Marketing routes always allowed
  '/website',
  '/website2',
  '/lp',
]

// Mission-control surfaces render but with a locked overlay so the user can
// see them exist without touching any controls. GM dashboard (mission control)
// is read-only. Monarch Chat is fully interactive in the demo (its own page
// enforces a 5-prompt limit for anonymous sessions).
const LOCKED_READONLY_PATHS = ['/gm-dashboard']

const friendlyName = (path) => {
  const map = {
    '/': 'Dashboard',
    '/research-zone': 'Research Zone',
    '/news': 'News',
    '/bubbles': 'Bubble Maps',
    '/heatmaps': 'Heatmaps',
    '/monarch-chat': 'Monarch Chat',
    '/search-engine': 'Search Engine',
    '/token': 'Token',
    '/trade': 'Token',
    '/ventures': 'Ventures',
    '/predictions': 'Predictions',
    '/intelligence': 'Intelligence',
    '/world': 'War Room',
    '/x-intelligence': 'X Intelligence',
    '/pulse': 'Pulse',
    '/alerts': 'Alerts',
    '/brain': 'The Brain',
    '/lens': 'Lens',
    '/watchlists': 'Watchlists',
    '/ai-charts': 'AI Charts',
  }
  const segs = path.split('/').filter(Boolean)
  return map['/' + (segs[0] || '')] || (segs[0] ? segs[0].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'This surface')
}

const isAllowed = (pathname) => {
  return ALLOWED_PATHS.some((p) =>
    p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(p + '/')
  )
}

const isReadOnly = (pathname) => {
  return LOCKED_READONLY_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

const detectDemoMode = () => {
  if (typeof window === 'undefined') return false
  // A signed-in user is NEVER demo-locked: the curtain exists for the anonymous
  // marketing iframe, and the ?demo=true flag latching in sessionStorage was
  // locking real users (incl. the founder) out of gated surfaces after any
  // demo link opened in the same tab session.
  let authed = false
  try { authed = sessionStorage.getItem('spectre-auth') === 'true' } catch (_) { /* private browsing */ }
  const url = new URLSearchParams(window.location.search)
  const demoParam = url.get(DEMO_PARAM)
  if (authed || demoParam === 'false') {
    try { sessionStorage.removeItem(DEMO_STORAGE_KEY) } catch (_) { /* non-critical */ }
    return false
  }
  if (demoParam === 'true') {
    // Silent: sessionStorage may be unavailable in private browsing - non-critical
    try { sessionStorage.setItem(DEMO_STORAGE_KEY, '1') } catch (_) { console.error(_) }
    return true
  }
  // Silent: sessionStorage may be unavailable in private browsing - non-critical
  try { return sessionStorage.getItem(DEMO_STORAGE_KEY) === '1' } catch (_) { console.error(_) }
  return false
}

const DemoLockGate = ({ children }) => {
  const location = useLocation()
  const demoMode = useMemo(() => detectDemoMode(), [])
  const setDayMode = useSettingsStore((s) => s.setDayMode)

  // Demo is ALWAYS dark mode across every surface (research-zone included).
  // Prior builds forced day mode on /research-zone; reverted per design feedback.
  useEffect(() => {
    if (!demoMode) return
    setDayMode(false)
  }, [demoMode, location.pathname, setDayMode])

  // Disable external links + right-click context menu in demo (non-security shaping)
  useEffect(() => {
    if (!demoMode) return
    const handleContext = (e) => e.preventDefault()
    document.addEventListener('contextmenu', handleContext)
    return () => document.removeEventListener('contextmenu', handleContext)
  }, [demoMode])

  if (!demoMode) return children

  const allowed = isAllowed(location.pathname)
  const readOnly = isReadOnly(location.pathname)

  return (
    <div className="spectre-demo-lock-root" data-demo-locked="true">
      {/* Always render the page so the aesthetic shows through */}
      <div className={`spectre-demo-lock-viewport${!allowed ? ' spectre-demo-lock-viewport--dim' : ''}`}>
        {children}
      </div>

      {/* Read-only curtain over mission control */}
      {allowed && readOnly && (
        <div className="spectre-demo-readonly" aria-hidden="true">
          <div className="spectre-demo-readonly-badge">
            <span className="spectre-demo-dot" />
            Read-only preview
          </div>
        </div>
      )}

      {/* Coming soon wall for restricted paths */}
      {!allowed && (
        <div className="spectre-demo-wall" role="dialog" aria-modal="true" aria-label="Coming soon">
          <div className="spectre-demo-wall-inner">
            <div className="spectre-demo-wall-eyebrow">
              <span className="spectre-demo-dot" />
              Locked in this preview
            </div>
            <h2 className="spectre-demo-wall-title">{friendlyName(location.pathname)} is coming soon to the public demo.</h2>
            <p className="spectre-demo-wall-sub">
              The full platform is live for invited traders. Request early access or keep exploring the open surfaces below.
            </p>
            <div className="spectre-demo-wall-ctas">
              <Link to="/?demo=true" className="spectre-demo-btn spectre-demo-btn--primary">
                Back to Dashboard
              </Link>
              <Link to="/research-zone?demo=true" className="spectre-demo-btn">Research Zone</Link>
              <Link to="/news?demo=true" className="spectre-demo-btn">News</Link>
              <Link to="/bubbles?demo=true" className="spectre-demo-btn">Bubbles</Link>
              <Link to="/heatmaps?demo=true" className="spectre-demo-btn">Heatmaps</Link>
              <Link to="/search-engine?demo=true" className="spectre-demo-btn">Search</Link>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default DemoLockGate
