// Regression fence for the global search bar's page index.
// Every navigable <Route> in App.jsx must have a matching entry in
// src/constants/pageCatalog.js, or the page ships invisible to search
// (the exact rot that hid Microcaps/ETFs/Lite/Why for two months —
// fixed 2026-07-30). Fails the build with a ready-to-paste stub when
// a route is missing. Runs first in the build script so the feedback
// is instant, before the vite build spends its minutes.
//
// Also warns (non-fatal) about catalog entries whose path no longer
// matches any route — stale entries silently misroute users.
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_JSX = process.env.CHECK_PC_APP_JSX || path.join(appDir, 'src', 'App.jsx')
const CATALOG = process.env.CHECK_PC_CATALOG || path.join(appDir, 'src', 'constants', 'pageCatalog.js')

// Routes that are deliberately NOT searchable. Each needs a reason —
// remove a line here only if the surface should become a search result.
const EXCLUDED = new Map([
  ['/embed/chart', 'headless embed, no chrome'],
  ['/admin/tg-onboard', 'internal admin'],
  ['/dev/spectre-audit', 'internal dev tool'],
  ['/dev/freshness', 'internal dev tool'],
  ['/vs', 'SEO marketing page (parameterized)'],
  ['/how-to', 'SEO marketing page (parameterized)'],
  ['/lp', 'legacy landing page'],
  ['/website', 'legacy marketing page (website2 IS indexed)'],
  ['/website2/api/signup', 'auth form, not a destination'],
  ['/website2/api/login', 'auth form, not a destination'],
  ['/token', 'alias route of /trade (indexed as AI Screener)'],
  ['/search', 'alias route of /search-engine'],
  ['/intelligence-feed', 'alias route of /insights'],
])

// Reduce a route path to its static base: '/dossier/:chain/:ca' -> '/dossier',
// '/x-dash/*' -> '/x-dash', '/research-zone/:coinSlug?' -> '/research-zone'.
function routeBase(p) {
  const cut = p.split('/').findIndex((seg) => seg.startsWith(':') || seg === '*')
  const base = cut === -1 ? p : p.split('/').slice(0, cut).join('/')
  return base === '' ? '/' : base
}

const appSrc = readFileSync(APP_JSX, 'utf8')
const routePaths = [...appSrc.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1])
const routeBases = new Set(
  routePaths.filter((p) => p !== '*').map(routeBase)
)

const catalogSrc = readFileSync(CATALOG, 'utf8')
const catalogPaths = [...catalogSrc.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1])
// '/?tab=brief' -> '/', '/tokenized-assets?tab=credit' -> '/tokenized-assets'
const catalogBases = new Set(catalogPaths.map((p) => p.split('?')[0] || '/'))

if (routeBases.size < 30) {
  console.error(`[check-page-catalog] FAIL: only ${routeBases.size} routes parsed from App.jsx — the route regex is probably broken, fix this script before trusting it`)
  process.exit(1)
}

const missing = [...routeBases]
  .filter((r) => !EXCLUDED.has(r))
  .filter((r) => !catalogBases.has(r))
  .sort()

// Stale: catalog bases that no route base covers. Wildcard routes cover
// their whole subtree ('/x-dash/*' covers '/x-dash/creators').
const wildcardBases = [...new Set(
  routePaths.filter((p) => p.includes('*') && p !== '*').map(routeBase)
)]
const stale = [...catalogBases]
  .filter((c) => !routeBases.has(c))
  .filter((c) => !wildcardBases.some((w) => c === w || c.startsWith(w + '/')))
  .sort()

if (stale.length) {
  console.warn(`[check-page-catalog] WARN: ${stale.length} catalog path(s) match no route (stale entries misroute users):`)
  for (const s of stale) console.warn(`  - ${s}`)
}

if (missing.length) {
  console.error(`[check-page-catalog] FAIL: ${missing.length} route(s) in App.jsx have no pageCatalog.js entry.`)
  console.error('New pages must be searchable from the global search bar.')
  console.error('Paste a filled-in version of this stub into src/constants/pageCatalog.js:')
  for (const p of missing) {
    const slug = p === '/' ? 'home' : p.slice(1).replace(/\//g, '-')
    const title = slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
    console.error(`
  {
    id: '${slug}',
    path: '${p}',
    title: '${title}', // TODO: the name users see in the sidebar
    aliases: [], // TODO: what users TYPE (typos, abbreviations, jargon)
    description: 'TODO one-line summary shown under the title',
    keywords: [], // TODO: concepts the page touches
    section: 'Market', // Market | Discovery | AI | Social | Tools | Profile
    iconHint: '${slug}',
    tier: 2,
  },`)
  }
  console.error('\nIf the route genuinely should not be searchable (admin/embed/alias),')
  console.error('add it to EXCLUDED in scripts/check-page-catalog.mjs with a reason.')
  process.exit(1)
}

console.log(`[check-page-catalog] OK - ${routeBases.size} routes, ${catalogPaths.length} catalog entries, all navigable routes searchable`)
