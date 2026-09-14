// Keep mobile market tabs available across resizing and market-mode changes.
export function getWelcomeDiscoveryTabs(isStocks, t, showcase = false) {
  const label = (key, fallback) => t?.(key, fallback) || fallback
  const tabs = isStocks ? [
    { id: 'topcoins', label: label('topSection.stocksCommodities', 'Stocks & Commodities') },
    { id: 'predictions', label: label('topSection.predictionMarkets', 'Predictions') },
  ] : [
    { id: 'topcoins', label: label('topSection.topCoins', 'Top Coins') },
    { id: 'onchain', label: label('topSection.onChain', 'On-Chain') },
    { id: 'predictions', label: label('topSection.predictionMarkets', 'Predictions') },
    { id: 'social', label: label('topSection.social', 'Social') },
    { id: 'aiagents', label: label('topSection.aiAgents', 'AI Agents') },
    { id: 'aimodels', label: label('topSection.aiModels', 'AI Models') },
    { id: 'warroom', label: label('topSection.marketSummary', 'Market Summary') },
  ]
  return tabs.map(tab => ({ ...tab, locked: showcase && ['social', 'aiagents', 'aimodels', 'warroom'].includes(tab.id) }))
}

export function nextWelcomeTabIndex(tabs, activeIndex, key, rtl = false) {
  const enabled = tabs.map((tab, index) => tab.locked ? -1 : index).filter(index => index >= 0)
  if (!enabled.length) return activeIndex
  if (key === 'Home') return enabled[0]
  if (key === 'End') return enabled[enabled.length - 1]
  const step = key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1
    : key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 0
  if (!step) return null
  return step > 0 ? enabled.find(index => index > activeIndex) ?? activeIndex
    : [...enabled].reverse().find(index => index < activeIndex) ?? activeIndex
}
