/**
 * navTree.js — Canonical navigation registry for the research app shell.
 *
 * Single source of truth for the navigation tree shown in:
 *  - navigation-sidebar.jsx (desktop left rail)
 *  - mobile-header.jsx (mobile top dropdown)
 *  - mobile-bottom-nav.jsx (mobile bottom strip — uses MOBILE_BOTTOM_NAV_IDS filter)
 *  - side-drawer.jsx (mobile drawer)
 *  - mission-control-sheet.jsx (command sheet)
 *
 * header.jsx is intentionally NOT a consumer (owned by INFRA-5).
 *
 * Item IDs MUST match keys in `pageRoutes.js` (used by getPathForPageId) and
 * analytics. Do not rename IDs without a migration.
 *
 * Translation:
 *  - `labelKey` is an i18next key (must exist in `i18n/locales/*.json`).
 *  - `badgeKey` is optional, also an i18next key.
 *
 * Flags:
 *  - `requiresDesktop`: only rendered when `window.spectre?.isDesktop` is true
 *    (the Lens entry — Electron-only).
 */

export const NAV_SECTIONS = [
  {
    id: 'home',
    labelKey: 'nav.section.home',
    items: [
      { id: 'research-platform', labelKey: 'nav.researchPlatform' },
      { id: 'research-zone', labelKey: 'nav.researchZone' },
      { id: 'ai-screener', labelKey: 'nav.aiScreener' },
      { id: 'watchlists', labelKey: 'nav.watchlists' },
      { id: 'monarch-ai-chat', labelKey: 'nav.monarchAiChat', badgeKey: 'nav.badge.comingSoon' },
      { id: 'you', labelKey: 'nav.you', badgeKey: 'nav.badge.comingSoon' },
    ],
  },
  {
    id: 'research',
    labelKey: 'nav.section.research',
    items: [
      { id: 'brain', labelKey: 'nav.brain', badgeKey: 'nav.badge.comingSoon' },
      // 2026-08-16 (Sunny): 'arena' + 'world-state' PULLED from the nav — they
      // shipped to users in 99b4d0492 by mistake and shouldn't be seen at all,
      // not even as Coming Soon. The pages and their routes stay in the tree
      // (locked in comingSoonPages.js, still open on localhost). To bring them
      // back, restore the two rows here:
      //   { id: 'arena', labelKey: 'nav.arena' },
      //   { id: 'world-state', labelKey: 'nav.worldState' },
      { id: 'discover', labelKey: 'nav.discover', badgeKey: 'nav.badge.comingSoon' },
      { id: 'ventures', labelKey: 'nav.ventures' },
      { id: 'private-markets', labelKey: 'nav.privateMarkets' },
      { id: 'vitals', labelKey: 'nav.vitals' },
      { id: 'intelligence', labelKey: 'nav.intelligence' },
      { id: 'intelligence-feed', labelKey: 'nav.intelDesk' },
      { id: 'news', labelKey: 'nav.news' },
      { id: 'tokenized-assets', labelKey: 'nav.tokenizedAssets' },
      { id: 'zigchain', labelKey: 'nav.zigchain' },
      { id: 'search-engine', labelKey: 'nav.searchEngine', badgeKey: 'nav.badge.comingSoon' },
    ],
  },
  {
    id: 'trading',
    labelKey: 'nav.section.trading',
    items: [
      { id: 'traders-corner', labelKey: 'nav.tradersCorner' },
      { id: 'wallets', labelKey: 'nav.wallets' },
      { id: 'etf-flows', labelKey: 'nav.etfFlows' },
      { id: 'liquidation-heatmap', labelKey: 'nav.liquidationHeatmap' },
      { id: 'predictions', labelKey: 'nav.predictions' },
    ],
  },
  {
    id: 'analysis',
    labelKey: 'nav.section.analysis',
    items: [
      { id: 'ai-charts', labelKey: 'nav.aiCharts' },
      { id: 'ai-market-analysis', labelKey: 'nav.aiMarketAnalysis', badgeKey: 'nav.badge.comingSoon' },
      { id: 'economic-calendar', labelKey: 'nav.economicCalendar' },
    ],
  },
  {
    id: 'visualize',
    labelKey: 'nav.section.visualize',
    items: [
      { id: 'world', labelKey: 'nav.world', badgeKey: 'nav.badge.comingSoon' },
      // 2026-08-16 (Sunny): 'market-cinema' PULLED from the nav for the same
      // reason as arena / world-state above. Restore with:
      //   { id: 'market-cinema', labelKey: 'nav.marketCinema' },
      { id: 'heatmaps', labelKey: 'nav.heatmaps' },
      { id: 'bubbles', labelKey: 'nav.bubbles' },
      { id: 'alt-rotation', labelKey: 'nav.microcaps' },
      { id: 'why', labelKey: 'nav.why' },
      { id: 'fear-greed', labelKey: 'nav.fearGreed' },
    ],
  },
  {
    id: 'social',
    labelKey: 'nav.section.social',
    items: [
      { id: 'pulse', labelKey: 'nav.pulse', badgeKey: 'nav.badge.comingSoon' },
      { id: 'social-zone', labelKey: 'nav.socialZone', badgeKey: 'nav.badge.comingSoon' },
      { id: 'ai-media-center', labelKey: 'nav.aiMediaCenter' },
      { id: 'x-dash', labelKey: 'nav.xDash' },
      { id: 'potential-gainers', labelKey: 'nav.potentialGainers' },
      // 2026-06-14: 'x-intelligence' is the PUBLIC Social-Intelligence dashboard
      // (route /x-intelligence -> component pages/x-bubbles, bound in App.jsx).
      // 'x-bubbles' (route /x-bubbles -> pages/x-intelligence legacy graph) stays gated.
      { id: 'x-intelligence', labelKey: 'nav.xIntelligence' },
      { id: 'x-bubbles', labelKey: 'nav.xBubbles', badgeKey: 'nav.badge.comingSoon' },
      { id: 'x-intel', labelKey: 'nav.xIntel', badgeKey: 'nav.badge.comingSoon' },
    ],
  },
  {
    id: 'tools',
    labelKey: 'nav.section.tools',
    items: [
      { id: 'categories', labelKey: 'nav.categories' },
      { id: 'gm-dashboard', labelKey: 'nav.gmDashboard' },
      { id: 'roi-calculator', labelKey: 'nav.roiCalculator' },
      { id: 'lens', labelKey: 'nav.lens', requiresDesktop: true },
    ],
  },
  {
    id: 'account',
    labelKey: 'nav.section.account',
    items: [
      { id: 'user-dashboard', labelKey: 'nav.userDashboard' },
      { id: 'structure-guide', labelKey: 'nav.structureGuide' },
    ],
  },
]

/**
 * Build a flat list of all items across sections, optionally filtered.
 * @param {(item, section) => boolean} predicate
 * @returns {Array<{ id, labelKey, badgeKey?, requiresDesktop?, sectionId }>}
 */
export function flattenNav(predicate) {
  const out = []
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      const entry = { ...item, sectionId: section.id }
      if (!predicate || predicate(entry, section)) out.push(entry)
    }
  }
  return out
}

/**
 * Find a single nav item by id (returns entry with sectionId attached, or null).
 */
export function findNavItem(id) {
  for (const section of NAV_SECTIONS) {
    const item = section.items.find((i) => i.id === id)
    if (item) return { ...item, sectionId: section.id }
  }
  return null
}

/**
 * Filter sections by predicate, dropping any section that ends up empty.
 * @param {(item, section) => boolean} predicate
 * @returns {typeof NAV_SECTIONS}
 */
export function filterNavSections(predicate) {
  return NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !predicate || predicate(item, section)),
    }))
    .filter((section) => section.items.length > 0)
}

/**
 * Mobile bottom-nav (Robinhood 4+1) shows a small curated subset across three
 * dropdowns. These IDs control which items appear in the bottom-nav's Markets,
 * Social, and Profile groups respectively. Order is preserved.
 */
export const MOBILE_BOTTOM_NAV_MARKETS_IDS = [
  'discover',
  'research-zone',
  'ai-screener',
  'heatmaps',
  'bubbles',
  'fear-greed',
  'economic-calendar',
  'traders-corner',
  'liquidation-heatmap',
]

export const MOBILE_BOTTOM_NAV_SOCIAL_IDS = [
  'social-zone',
  'x-dash',
  'x-bubbles',
  'x-intelligence',
  'ai-media-center',
  'gm-dashboard',
]

export const MOBILE_BOTTOM_NAV_PROFILE_IDS = [
  'watchlists',
  'categories',
  'ai-charts',
  'user-dashboard',
  'roi-calculator',
]
