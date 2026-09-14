/**
 * One-time migration: reads legacy spectre-* localStorage keys
 * and writes them into the Zustand persist format under "spectre-settings".
 * Must be called BEFORE ReactDOM.createRoot() so the store hydrates
 * with the migrated data on first render.
 */
export function upgradeSettingsStorage() {
  try {
    // If the new key already exists, migration has already run (or user started fresh)
    if (localStorage.getItem('spectre-settings')) return

    const migrated = {}

    // dayMode
    const dayMode = localStorage.getItem('spectre-day-mode')
    if (dayMode !== null) migrated.dayMode = dayMode === 'true'

    // appDisplayMode
    const displayMode = localStorage.getItem('spectre-app-display-mode')
    if (displayMode !== null) migrated.appDisplayMode = displayMode === 'cinema' ? 'cinema' : 'terminal'

    // marketMode
    const market = localStorage.getItem('spectre-market-mode')
    if (market !== null) migrated.marketMode = market === 'stocks' ? 'stocks' : 'crypto'

    // navSidebarCollapsed
    const navCollapsed = localStorage.getItem('spectre-nav-sidebar-collapsed')
    if (navCollapsed !== null) migrated.navSidebarCollapsed = navCollapsed === 'true'

    // chartViewMode
    const chartView = localStorage.getItem('spectre-chartViewMode')
    if (chartView !== null) migrated.chartViewMode = chartView

    // chartTimeframe
    const timeframe = localStorage.getItem('spectre-timeframe')
    if (timeframe !== null) migrated.chartTimeframe = timeframe

    // chartType
    const chartType = localStorage.getItem('spectre-chartType')
    if (chartType !== null) migrated.chartType = chartType

    // currency
    const currency = localStorage.getItem('spectre-currency')
    if (currency !== null) migrated.currency = currency

    // language
    const language = localStorage.getItem('spectre-language')
    if (language !== null) migrated.language = language

    // profile
    const profile = localStorage.getItem('spectre-profile')
    if (profile) {
      try {
        const p = JSON.parse(profile)
        if (p && (p.name != null || p.imageUrl != null)) {
          migrated.profile = {
            name: p.name ?? 'Daryl Wilson',
            imageUrl: p.imageUrl ?? 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=80&h=80&fit=crop&crop=face',
          }
        }
      } catch { /* skip */ }
    }

    // tempUnit
    const tempUnit = localStorage.getItem('spectre-temp-unit')
    if (tempUnit !== null) migrated.tempUnit = tempUnit

    // timeFormat
    const timeFormat = localStorage.getItem('spectre-time-format')
    if (timeFormat !== null) migrated.timeFormat = timeFormat

    // gamification
    const gamification = localStorage.getItem('spectre-gamification')
    if (gamification) {
      try {
        const g = JSON.parse(gamification)
        if (g && typeof g === 'object') migrated.gamification = g
      } catch { /* skip */ }
    }

    // Only write if we found at least one old key
    if (Object.keys(migrated).length === 0) return

    // Write in Zustand persist format: { state: { ... }, version: 1 }
    localStorage.setItem('spectre-settings', JSON.stringify({
      state: migrated,
      version: 1,
    }))

    // Clean up old keys
    const oldKeys = [
      'spectre-day-mode',
      'spectre-app-display-mode',
      'spectre-market-mode',
      'spectre-nav-sidebar-collapsed',
      'spectre-chartViewMode',
      'spectre-timeframe',
      'spectre-chartType',
      'spectre-currency',
      'spectre-language',
      'spectre-profile',
      'spectre-temp-unit',
      'spectre-time-format',
      'spectre-gamification',
    ]
    oldKeys.forEach((key) => localStorage.removeItem(key))
  } catch (err) {
    // silently handled
  }
}
