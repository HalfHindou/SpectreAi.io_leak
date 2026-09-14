const normalizePath = (path = '/') => {
  const cleaned = (path || '/').replace(/\/+$/, '')
  return cleaned || '/'
}

export const PAGE_PATHS = {
  'research-platform': '/',
  'you': '/you',
  discover: '/discover',
  'research-zone': '/research-zone',
  'search-engine': '/search-engine',
  'ai-screener': '/trade',
  watchlists: '/watchlists',
  'fear-greed': '/fear-greed',
  'social-zone': '/social-zone',
  'ai-media-center': '/ai-media-center',
  'x-dash': '/x-dash',
  'potential-gainers': '/potential-gainers',
  'x-bubbles': '/x-bubbles',
  'ai-charts': '/ai-charts',
  heatmaps: '/heatmaps',
  bubbles: '/bubbles',
  'alt-rotation': '/alt-rotation',
  'why': '/why',
  categories: '/categories',
  'ai-market-analysis': '/ai-market-analysis',
  'economic-calendar': '/economic-calendar',
  'user-dashboard': '/user-dashboard',
  'structure-guide': '/structure-guide',
  'roi-calculator': '/roi-calculator',
  'gm-dashboard': '/gm-dashboard',
  lite: '/lite',
  ventures: '/ventures',
  'private-markets': '/private-markets',
  'tokenized-assets': '/tokenized-assets',
  intelligence: '/intelligence',
  newsroom: '/newsroom',
  lens: '/lens',
  'traders-corner': '/traders-corner',
  news: '/news',
  'liquidation-heatmap': '/liquidation-heatmap',
  'monarch-ai-chat': '/monarch-chat',
  world: '/world',
  'x-intel': '/x-intel',
  'wallets': '/wallets',
  'etf-flows': '/etfs',
  'x-intelligence': '/x-intelligence',
  zigchain: '/zigchain',
  pulse: '/pulse',
  'intelligence-feed': '/insights',
  predictions: '/predictions',
  pricing: '/pricing',
  auth: '/auth',
  brain: '/brain',
  dossier: '/dossier',
  arena: '/arena',
  'market-cinema': '/cinema',
  'world-state': '/world-state',
  vitals: '/vitals',
}

const PAGE_ID_BY_PATH = Object.entries(PAGE_PATHS).reduce((acc, [pageId, path]) => {
  acc[normalizePath(path)] = pageId
  return acc
}, {})

const PAGE_ID_ALIASES = {
  '/search': 'search-engine',
  '/intelligence-feed': 'intelligence-feed',
  // Legacy path for Trading Lite (canonical is /trade since 2026-07-17).
  // Old shared /token links keep resolving; the page normalizes the URL.
  '/token': 'ai-screener',
}

export const getPathForPageId = (pageId) => PAGE_PATHS[pageId] || PAGE_PATHS['research-platform']

export const getPageIdFromPath = (path) => {
  const normalized = normalizePath(path)
  // Exact match first
  if (PAGE_ID_BY_PATH[normalized]) return PAGE_ID_BY_PATH[normalized]
  if (PAGE_ID_ALIASES[normalized]) return PAGE_ID_ALIASES[normalized]
  // Dynamic sub-routes: /intelligence/:type/:slug → 'intelligence'
  if (normalized.startsWith('/intelligence/')) return 'intelligence'
  if (normalized.startsWith('/research-zone/')) return 'research-zone'
  if (normalized.startsWith('/categories/')) return 'categories'
  if (normalized.startsWith('/trade/')) return 'ai-screener'
  if (normalized.startsWith('/token/')) return 'ai-screener'
  if (normalized.startsWith('/x-dash/')) return 'x-dash'
  if (normalized.startsWith('/news/')) return 'news'
  if (normalized.startsWith('/predictions/')) return 'predictions'
  if (normalized.startsWith('/dossier/')) return 'dossier'
  if (normalized.startsWith('/vitals/')) return 'vitals'
  // /private-markets/<company> is the roster's full-page view — same page id, so
  // the nav rail stays lit on the surface the reader came from.
  if (normalized.startsWith('/private-markets/')) return 'private-markets'
  return null
}

export const isTokenPath = (path) => {
  const normalized = normalizePath(path)
  // Canonical /trade + /trade/<address>, plus the legacy /token forms
  return normalized === PAGE_PATHS['ai-screener'] || normalized.startsWith('/trade/')
    || normalized === '/token' || normalized.startsWith('/token/')
}
