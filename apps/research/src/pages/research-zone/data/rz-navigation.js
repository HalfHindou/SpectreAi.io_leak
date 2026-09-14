// 'intelligence' has no button in the desktop nav (removed in 4d5b5bcb3), so
// nothing can dispatch it today - but research-zone-pro.jsx still renders a
// full IntelligenceTab for it, so the id stays whitelisted rather than being
// quietly dropped. Re-adding the nav entry is all it takes to reach it again.
const DESKTOP = new Set(['markets', 'project', 'intelligence', 'sentiment', 'technicals'])
const MOBILE = new Set(['overview', 'markets', 'technicals', 'sentiment', 'social', 'news'])
const SHARED = new Set(['markets', 'sentiment', 'technicals'])

export const INITIAL_RESEARCH_NAVIGATION = { desktopSection: 'markets', mobileTab: 'overview' }

export function normalizeResearchNavigation(state, isStock) {
  if (!isStock) return state
  const desktopSection = SHARED.has(state.desktopSection) ? state.desktopSection : 'markets'
  const mobileTab = state.mobileTab === 'social' ? 'overview' : state.mobileTab
  return desktopSection === state.desktopSection && mobileTab === state.mobileTab
    ? state : { desktopSection, mobileTab }
}

// Selection belongs to the route, not the conditionally mounted layout.
// Only equivalent sections sync; layout-specific sections retain their own place.
export function researchNavigationReducer(state, action) {
  const current = normalizeResearchNavigation(state, action.isStock)
  if (action.type === 'asset') return current
  const { id } = action
  if (action.type === 'desktop' && DESKTOP.has(id) && (!action.isStock || SHARED.has(id))) {
    return { desktopSection: id, mobileTab: SHARED.has(id) ? id : current.mobileTab }
  }
  if (action.type === 'mobile' && MOBILE.has(id) && !(action.isStock && id === 'social')) {
    return { mobileTab: id, desktopSection: SHARED.has(id) ? id : current.desktopSection }
  }
  return current
}
