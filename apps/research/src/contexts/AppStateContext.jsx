import { createContext, useContext, useState, useCallback, useMemo } from 'react'

const AppStateContext = createContext()

export const useAppState = () => useContext(AppStateContext)

export function AppStateProvider({ children }) {
  // ─── Token selection ───
  const defaultToken = useMemo(() => ({
    symbol: 'SPECTRE',
    name: 'Spectre AI',
    address: '0x9cf0ed013e67db12ca3af8e7506fe401aa14dad6',
    networkId: 1,
    description: '',
    price: 0,
    change: 0,
    verified: true,
    socials: {}
  }), [])

  const defaultBTCToken = useMemo(() => ({
    symbol: 'BTC',
    name: 'Bitcoin',
    address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC on Ethereum
    networkId: 1,
    description: '',
    price: 0,
    change: 0,
    verified: true,
    socials: {},
    cgId: 'bitcoin',
  }), [])

  const [token, setToken] = useState(() => {
    const saved = localStorage.getItem('spectre-selected-token')
    if (saved) {
      try { return JSON.parse(saved) } catch { return defaultToken }
    }
    return defaultToken
  })

  const [researchZoneToken, _setResearchZoneToken] = useState(() => ({
    symbol: 'BTC', name: 'Bitcoin', address: '', networkId: 1,
    description: '', price: 0, change: 0, verified: true, socials: {}
  }))

  const setResearchZoneToken = useCallback((tokenData) => {
    if (!tokenData) return
    _setResearchZoneToken({
      symbol: tokenData.symbol || tokenData.token?.symbol || 'BTC',
      name: tokenData.name || tokenData.token?.name || '',
      address: tokenData.address || tokenData.token?.address || '',
      networkId: tokenData.networkId || tokenData.token?.networkId || 1,
      description: tokenData.description || '',
      price: tokenData.price || 0,
      change: tokenData.change ?? tokenData.change24h ?? 0,
      verified: tokenData.verified || false,
      socials: tokenData.socials || {},
      logo: tokenData.logo || tokenData.token?.info?.imageThumbUrl || null,
      cgId: tokenData.cgId || tokenData.cg_id || null,
      codexId: tokenData.codexId || tokenData.codex_id || tokenData.address || tokenData.token?.address || null,
      tokenId: tokenData.tokenId || tokenData.token_id || null,
      marketCap: tokenData.marketCap || null,
      volume: tokenData.volume || null,
    })
  }, [])

  const selectToken = useCallback((tokenData) => {
    const newToken = {
      symbol: tokenData.symbol || tokenData.token?.symbol,
      name: tokenData.name || tokenData.token?.name,
      address: tokenData.address || tokenData.token?.address,
      networkId: tokenData.networkId || tokenData.token?.networkId || 1,
      description: tokenData.description || '',
      price: tokenData.price || 0,
      change: tokenData.change ?? tokenData.change24h ?? 0,
      verified: tokenData.verified || false,
      socials: tokenData.socials || {},
      logo: tokenData.logo || tokenData.token?.info?.imageThumbUrl,
      cgId: tokenData.cgId || tokenData.cg_id || null,
      codexId: tokenData.codexId || tokenData.codex_id || tokenData.address || tokenData.token?.address || null,
      tokenId: tokenData.tokenId || tokenData.token_id || null,
    }
    setToken(newToken)
    localStorage.setItem('spectre-selected-token', JSON.stringify(newToken))
  }, [])

  // ─── Panel states (ephemeral UI) ───
  const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState(false)
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false)
  const [isDataTabsExpanded, setIsDataTabsExpanded] = useState(false)

  // ─── Mobile ───
  const [mobileTokenTab, setMobileTokenTab] = useState('all')

  const value = useMemo(() => ({
    token, setToken, selectToken, defaultToken, defaultBTCToken,
    researchZoneToken, setResearchZoneToken,
    isLeftPanelCollapsed, setIsLeftPanelCollapsed,
    isRightPanelCollapsed, setIsRightPanelCollapsed,
    isDataTabsExpanded, setIsDataTabsExpanded,
    mobileTokenTab, setMobileTokenTab,
  }), [
    token, selectToken, defaultToken, defaultBTCToken,
    researchZoneToken, setResearchZoneToken,
    isLeftPanelCollapsed, isRightPanelCollapsed,
    isDataTabsExpanded,
    mobileTokenTab,
  ])

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  )
}

export default AppStateContext
