import { useNavigate } from 'react-router-dom'
import VenturesPageComponent from './components/ventures-page'
import { useAppState } from '@/contexts/AppStateContext'
import useSettingsStore from '@/store/useSettingsStore'
import { useWatchlists } from '@/contexts/WatchlistsContext'
import { getTokenSlug } from '@/lib/tokenSlugs'
import { useIsMobile } from '@/hooks/useMediaQuery'

export default function VenturesPage() {
  const navigate = useNavigate()
  const { selectToken, setResearchZoneToken } = useAppState()
  const dayMode = useSettingsStore((s) => s.dayMode)
  const marketMode = useSettingsStore((s) => s.marketMode)
  const { addToWatchlist, isInWatchlist } = useWatchlists()
  const isMobile = useIsMobile()

  return (
    <VenturesPageComponent
      dayMode={dayMode}
      marketMode={marketMode}
      isMobile={isMobile}
      selectToken={(tokenData) => {
        selectToken(tokenData)
        navigate('/trade')
      }}
      onOpenResearchZone={(tokenData) => {
        selectToken(tokenData)
        setResearchZoneToken(tokenData)
        navigate(`/research-zone/${getTokenSlug(tokenData.symbol, marketMode === 'stocks', tokenData.cgId, tokenData.name)}`)
      }}
      addToWatchlist={addToWatchlist}
      isInWatchlist={isInWatchlist}
    />
  )
}
