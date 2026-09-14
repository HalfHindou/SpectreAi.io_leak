import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import WatchlistsPageComponent from './components/watchlists-page'
import { useAppState } from '@/contexts/AppStateContext'
import useSettingsStore from '@/store/useSettingsStore'
import { useWatchlists } from '@/contexts/WatchlistsContext'
import { getTokenSlug } from '@/lib/tokenSlugs'
import { useIsMobile } from '@/hooks/useMediaQuery'

export default function WatchlistsPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { selectToken, setResearchZoneToken } = useAppState()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const marketMode = useSettingsStore((s) => s.marketMode)
  const isMobile = useIsMobile()
  const {
    watchlist, watchlists, activeWatchlistId, activeWatchlist,
    renameWatchlist, addWatchlist, removeWatchlist, setActiveWatchlist,
    addToWatchlist, removeFromWatchlist, togglePinWatchlist, reorderWatchlist,
  } = useWatchlists()

  const defaultName = t('watchlist.myWatchlist', 'My Watchlist')

  return (
    <WatchlistsPageComponent
      dayMode={dayMode}
      marketMode={marketMode}
      isMobile={isMobile}
      watchlist={watchlist}
      watchlistName={activeWatchlist?.name ?? defaultName}
      watchlists={watchlists.map(w => ({ id: w.id, name: w.name === 'My Watchlist' ? defaultName : w.name, tokenCount: w.tokens?.length ?? 0, updatedAt: w.updatedAt ?? Date.now() }))}
      activeWatchlistId={activeWatchlistId}
      onRenameWatchlist={renameWatchlist}
      onAddWatchlist={addWatchlist}
      onRemoveWatchlist={removeWatchlist}
      onSwitchWatchlist={setActiveWatchlist}
      addToWatchlist={addToWatchlist}
      removeFromWatchlist={removeFromWatchlist}
      togglePinWatchlist={togglePinWatchlist}
      reorderWatchlist={reorderWatchlist}
      onTokenClick={(tokenData, viewMode) => {
        selectToken(tokenData)
        if (viewMode === 'major') {
          setResearchZoneToken(tokenData)
          navigate(`/research-zone/${getTokenSlug(tokenData.symbol, marketMode === 'stocks', tokenData.cgId, tokenData.name)}`)
        } else {
          navigate('/trade')
        }
      }}
    />
  )
}
