import { useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePrivySafe } from '@/lib/use-privy-safe'
import WelcomePage from './components/welcome-page'
import { useAppState } from '@/contexts/AppStateContext'
import { useIsMobile } from '@/hooks/useMediaQuery'
import useSettingsStore from '@/store/useSettingsStore'
import { useWatchlists } from '@/contexts/WatchlistsContext'
import { getPathForPageId } from '@/constants/pageRoutes'
import { getTokenSlug } from '@/lib/tokenSlugs'
import { openTradingTerminal } from '@/lib/trading-terminal'
import { getPrivyDisplayInfo } from '@/lib/privy-user'
import { detectShowcaseEmbed, isShowcasePathAllowed, fireShowcaseLockToast } from '@/App'

// Symbols the Trading Lite embed (Codex/DEX terminal) can render WITHOUT an
// on-chain contract address — it maps them to a wrapped/indexed Codex token
// internally (mirrors MAJOR_TOKEN_ADDR in apps/trading/src/hooks/useCodexData.js).
// Every OTHER CEX-only major (XLM, XRP, ADA, DOGE, DOT, AVAX...) and every stock
// has no Codex DEX data, so the terminal renders $0 + an empty chart. Those are
// routed to the research-native (CoinGecko-backed) Research Zone instead.
const TERMINAL_MAJOR_SYMBOLS = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'USDT', 'USDC', 'LINK', 'UNI', 'AAVE', 'ARB'])

export default function HomePage() {
  const navigate = useNavigate()
  const { selectToken, setResearchZoneToken } = useAppState()
  const appDisplayMode = useSettingsStore((s) => s.appDisplayMode)
  const isMobile = useIsMobile()
  const storeProfile = useSettingsStore((s) => s.profile)
  const handleProfileChange = useSettingsStore((s) => s.setProfile)
  const privy = usePrivySafe()
  const isAuthenticated = privy?.authenticated
  const privyInfo = useMemo(() => getPrivyDisplayInfo(privy?.user), [privy?.user])
  const profile = useMemo(() => {
    const storeName = storeProfile?.name
    const storeImg = storeProfile?.imageUrl
    if (storeName) return { name: storeName, imageUrl: storeImg || privyInfo.avatar || '' }
    if (isAuthenticated && privyInfo.name) return { name: privyInfo.name, imageUrl: privyInfo.avatar || '' }
    return storeProfile || { name: '', imageUrl: '' }
  }, [storeProfile, isAuthenticated, privyInfo])
  const welcomeDayMode = useSettingsStore((s) => s.dayMode)
  const marketMode = useSettingsStore((s) => s.marketMode)
  const {
    watchlist, watchlistsSummary, activeWatchlistId,
    setActiveWatchlist, addToWatchlist, removeFromWatchlist,
    isInWatchlist, togglePinWatchlist, reorderWatchlist,
  } = useWatchlists()

  const [discoverOnly, setDiscoverOnly] = useState(true)
  const [assistantActions, setAssistantActions] = useState(null)
  const [assistantContext, setAssistantContext] = useState(null)
  const [pendingChartToken, setPendingChartToken] = useState(null)
  const [pendingCommandCenterTab, setPendingCommandCenterTab] = useState(null)

  const showcaseBlock = useCallback((targetPath, source) => {
    if (!detectShowcaseEmbed()) return false
    if (targetPath && isShowcasePathAllowed(targetPath)) return false
    fireShowcaseLockToast({ source, path: targetPath })
    return true
  }, [])

  const handlePageChange = useCallback((pageId) => {
    const path = getPathForPageId(pageId)
    if (showcaseBlock(path, `home:onPageChange:${pageId}`)) return
    navigate(path, { state: { fromWelcome: true } })
  }, [navigate, showcaseBlock])

  return (
    <WelcomePage
      cinemaMode={appDisplayMode === 'cinema' && !isMobile}
      profile={profile}
      onProfileChange={handleProfileChange}
      dayMode={welcomeDayMode}
      marketMode={marketMode}
      selectToken={(tokenData) => {
        const sym = (tokenData?.symbol || '').toUpperCase()
        const isStockSel = !!(tokenData?.isStock || tokenData?.assetClass === 'stock' || tokenData?.type === 'stock' || marketMode === 'stocks')
        // Trading Lite (the /token Codex/DEX terminal) only has data for on-chain
        // tokens + a handful of wrapped majors. A CEX-only major (XLM, XRP, ADA,
        // DOGE...) or a stock has no Codex pair, so it loads as $0 + a ghost
        // chart. Route those to the CoinGecko-backed Research Zone, which has
        // real price + chart for them.
        const terminalCapable = !isStockSel && (!!tokenData?.address || TERMINAL_MAJOR_SYMBOLS.has(sym))
        if (!terminalCapable) {
          const slug = tokenData?.cgId || tokenData?.token_id || getTokenSlug(sym, isStockSel, null, tokenData?.name)
          const rzPath = `/research-zone/${slug}`
          if (showcaseBlock(rzPath, 'home:selectToken:research-zone')) return
          selectToken(tokenData)
          setResearchZoneToken(tokenData)
          navigate(rzPath, { state: { fromWelcome: true } })
          return
        }
        const path = getPathForPageId('ai-screener')
        if (showcaseBlock(path, 'home:selectToken')) return
        // On-chain token (has a contract): open the standalone trading terminal
        // (better charts) by contract in a new tab. Majors matched by SYMBOL
        // carry no address, so the helper no-ops and they stay on Trading Lite,
        // which resolves them by symbol (avoids the empty-`#token/` bounce).
        if (openTradingTerminal(tokenData?.address)) return
        selectToken(tokenData)
        navigate(path, { state: { fromWelcome: true } })
      }}
      onOpenResearchZone={(tokenData) => {
        const slug = tokenData.cgId || tokenData.token_id || getTokenSlug(tokenData.symbol, marketMode === 'stocks', null, tokenData.name)
        const path = `/research-zone/${slug}`
        if (showcaseBlock(path, 'home:onOpenResearchZone')) return
        selectToken(tokenData)
        setResearchZoneToken(tokenData)
        navigate(path, { state: { fromWelcome: true } })
      }}
      onOpenAIScreener={(tokenData) => {
        const path = getPathForPageId('ai-screener')
        if (showcaseBlock(path, 'home:onOpenAIScreener')) return
        // On-chain token: open the standalone trading terminal (better charts)
        // by contract in a new tab. The earlier attempt that "bounced to the
        // landing view" did so because it built `#token/` for majors with NO
        // address — the helper's strict contract validation prevents that, so a
        // major/CEX coin (no address) falls through to the in-app /token embed,
        // which resolves it by symbol via postMessage.
        if (openTradingTerminal(tokenData?.address)) return
        selectToken(tokenData)
        navigate(path, { state: { fromWelcome: true } })
      }}
      discoverOnly={discoverOnly}
      watchlist={watchlist}
      watchlists={watchlistsSummary}
      activeWatchlistId={activeWatchlistId}
      onSwitchWatchlist={setActiveWatchlist}
      addToWatchlist={addToWatchlist}
      removeFromWatchlist={removeFromWatchlist}
      isInWatchlist={isInWatchlist}
      togglePinWatchlist={togglePinWatchlist}
      reorderWatchlist={reorderWatchlist}
      onPageChange={handlePageChange}
      setAssistantActions={setAssistantActions}
      setAssistantContext={setAssistantContext}
      pendingChartToken={pendingChartToken}
      setPendingChartToken={setPendingChartToken}
      pendingCommandCenterTab={pendingCommandCenterTab}
      setPendingCommandCenterTab={setPendingCommandCenterTab}
    />
  )
}
